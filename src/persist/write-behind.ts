/**
 * persist — write-behind 批落链（05 篇 §6.3）。
 *
 * append 热路径零 I/O（session 侧 onAppend 直通 enqueue——纯内存入队）；
 * 落库编舞全在本文件：微任务节流 + 批尺寸帽 64、事务序 = 入队序（单全局
 * 队列——多会话事件按全局入队序交织落库，同会话序天然保真）、批级失败
 * 退避重试（指数退避，耗尽 3 次 fail-loud）、毒丸分类（约束违例逐行诊断：
 * 单条隔离不重试 + durable 标记 + 会话 durability 切断）、flush 屏障。
 *
 * 毒丸切断语义（§6.3 终态条款的实现推论）：被隔离事件不落库，其会话日志
 * 即现空洞——seq 连续律（恢复重放的前缀语义）下，洞后事件重放不可达；故
 * 毒丸一旦确认，该会话后续事件一并不再落库（每会话一笔 incident 自述，
 * 不逐条刷账）。其他会话不受牵连（「不阻塞整队列」的另一半）。
 */
import { BaseError } from '../contracts/index.js';
import type { EventWrite, IncidentEntry, WriteTarget } from './store.js';

/** write-behind 构造选项 */
export interface WriteBehindOptions {
  /** 写入目标（Store 真身或测试假目标） */
  readonly target: WriteTarget;
  /** 批尺寸帽（缺省 64，05 §6.3） */
  readonly maxBatchSize?: number;
  /** 批级失败重试帽（缺省 3——连续失败计数，成功即清零，05 §6.3「首版 3 次」） */
  readonly retryLimit?: number;
  /** 指数退避基（缺省 50ms——第 n 次失败后睡 base*2^(n-1)） */
  readonly backoffBaseMs?: number;
  /** 睡眠注入（测试假钟/即时直通；缺省 setTimeout） */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 重试耗尽回调（缺省重抛——微任务链未捕获拒绝 = 进程 fail-loud；宿主装配
   *  根接 exitCode=1 编舞在 07 篇进程模型批接线） */
  readonly onFatal?: (err: BaseError) => void;
  /** 告警面（毒丸隔离告警——缺省 console.error） */
  readonly warn?: (message: string) => void;
  /** 时间注入（incident 落账时刻；缺省 Date.now） */
  readonly clock?: () => number;
}

/**
 * 判别是否 SQLite 约束违例类（确定性失败——重试必再败，毒丸分类入口）。
 * 结构化判别（code 字符串前缀）而非 instanceof：better-sqlite3 的 SqliteError
 * 在 @types 里是构造器类型属性，instanceof 收窄面失真；code 前缀是稳定契约。
 */
function isConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

/**
 * WriteBehind——进程级单写队列（Persistence 构造并持有；跨会话共用，
 * 05 §6.1 律 2「单进程内所有打开的会话共享同一 write-behind 队列」）。
 *
 * 生命周期态三枚：queued（队列本体）/ draining（在飞 drain 任务——enqueue
 * 只入队 + 按需点火）/ broken（fatal 熔断——此后 enqueue 即抛，诚实拒写）。
 */
export class WriteBehind {
  private readonly target: WriteTarget;
  private readonly maxBatchSize: number;
  private readonly retryLimit: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onFatal: (err: BaseError) => void;
  private readonly warn: (message: string) => void;
  private readonly clock: () => number;
  /** 待写队列（全局序 = 事务序） */
  private readonly queue: EventWrite[] = [];
  /** 在飞 drain 任务（null = 空闲；finally 补射防「drain 收尾与 enqueue 竞速」漏项） */
  private drainTask: Promise<void> | null = null;
  /** 微任务节流旗（已排队未点火——同 tick 内连续 enqueue 合一批） */
  private drainScheduled = false;
  /** 毒丸诊断模式旗（本 drain 周期内逐行写——批路径在毒丸后不可回用：前段已逐行落账） */
  private rowMode = false;
  /** 连续批级失败计数（成功清零；达 retryLimit 熔断） */
  private consecutiveFailures = 0;
  /** 熔断旗（fatal 后诚实拒写——写链已死，再入队 = 谎报持久化） */
  private broken = false;
  /** 已切断 durability 的会话（毒丸后——后续事件静默丢弃，不再入队落库） */
  private readonly severed = new Set<string>();

  constructor(options: WriteBehindOptions) {
    this.target = options.target;
    this.maxBatchSize = options.maxBatchSize ?? 64;
    this.retryLimit = options.retryLimit ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 50;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onFatal =
      options.onFatal ??
      ((err) => {
        throw err;
      });
    this.warn = options.warn ?? ((message) => console.error(message));
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * 入队（append 热路径直通——O(1) 内存操作 + 按需点火微任务）。
   * 熔断后抛 PERSIST_WRITE_EXHAUSTED（诚实拒写：调用方立即知道持久化已死）。
   * 切断会话静默丢弃（incident 已自述——毒丸后该会话 durability 已终）。
   */
  enqueue(write: EventWrite): void {
    if (this.broken) {
      throw new BaseError('PERSIST_WRITE_EXHAUSTED', '写链已熔断（批级重试耗尽）——进程应退出，拒绝继续假写');
    }
    if (this.severed.has(write.sessionId)) return;
    this.queue.push(write);
    this.scheduleDrain();
  }

  /** 队列深度（诊断面/测试断言） */
  get pending(): number {
    return this.queue.length;
  }

  /** 毒丸切断会话清单（诊断只读面） */
  get severedSessions(): readonly string[] {
    return [...this.severed];
  }

  /**
   * flush 屏障（05 §4/§6.3#5）：等待队列写尽并确认全部落库（含在飞 drain 与
   * 退避等待——屏障后崩溃 = 已落库）。失败原样抛（毒丸不视为失败——其终态
   * 在 incident 账，队列照常清空）。
   */
  async flush(): Promise<void> {
    if (this.broken) {
      throw new BaseError('PERSIST_WRITE_EXHAUSTED', '写链已熔断——flush 无从屏障（进程应退出）');
    }
    this.scheduleDrain();
    while (this.drainTask !== null || this.queue.length > 0 || this.drainScheduled) {
      if (this.broken) {
        throw new BaseError('PERSIST_WRITE_EXHAUSTED', 'flush 期间写链熔断——屏障失败（进程应退出）');
      }
      const task = this.drainTask;
      if (task) {
        await task;
      } else {
        // 节流旗在排但 drain 未点火——让一个微任务（点火位先行）后再查
        await new Promise<void>((resolve) => queueMicrotask(resolve));
      }
    }
  }

  /**
   * 点火 drain——微任务节流（05 §6.3）：enqueue 只入队不写（append 热路径零
   * I/O 的兑现位），同一 tick 内的连续 append 合一批；已排队或在飞则不重复点火。
   */
  private scheduleDrain(): void {
    if (this.drainScheduled || this.drainTask !== null || this.broken) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      // 点火时队列已空（flush 消费完）或已熔断——本次空转
      if (this.broken || this.queue.length === 0) return;
      this.drainTask = this.drain()
        .catch((err: unknown) => {
          // fatal 熔断：标记后交 onFatal（缺省重抛 → 未捕获拒绝 → 进程 fail-loud）
          this.broken = true;
          this.onFatal(
            err instanceof BaseError ? err : new BaseError('PERSIST_WRITE_EXHAUSTED', String(err), { cause: err }),
          );
        })
        .finally(() => {
          this.drainTask = null;
          if (!this.broken && this.queue.length > 0) this.scheduleDrain();
        });
    });
  }

  /**
   * 落库主循环（微任务链上跑——非真后台线程；节流 = 每轮微任务一批）：
   * 批模式（快路径）→ 约束违例翻行模式逐行诊断 → 非约束错走退避重试。
   */
  private async drain(): Promise<void> {
    for (;;) {
      if (this.queue.length === 0) {
        this.rowMode = false; // 队列清空——下一周期恢复批模式
        this.consecutiveFailures = 0;
        return;
      }
      if (this.rowMode) {
        const write = this.queue.shift()!;
        if (this.severed.has(write.sessionId)) continue; // 切断会话：静默丢弃（incident 已记）
        try {
          this.target.writeEventSingle(write);
          this.consecutiveFailures = 0;
        } catch (err) {
          if (isConstraintError(err)) {
            this.isolatePoison(write, err);
          } else {
            this.queue.unshift(write); // 放回队首——事务序保持
            if (!(await this.failOrBackoff(err))) return;
          }
        }
      } else {
        const batch = this.queue.splice(0, this.maxBatchSize);
        try {
          this.target.writeEvents(batch);
          this.consecutiveFailures = 0;
        } catch (err) {
          if (isConstraintError(err)) {
            // 批内含毒丸：整批放回 + 翻行模式逐行定位（批事务已回滚，无损）
            this.queue.unshift(...batch);
            this.rowMode = true;
          } else {
            this.queue.unshift(...batch);
            if (!(await this.failOrBackoff(err))) return;
          }
        }
      }
    }
  }

  /**
   * 批级失败处置：计数 → 达帽熔断（抛出 = drain 链拒绝 → onFatal）；
   * 未达帽则指数退避后继续。
   * @returns false = 已熔断（调用方即刻收场）
   */
  private async failOrBackoff(err: unknown): Promise<boolean> {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.retryLimit) {
      throw new BaseError(
        'PERSIST_WRITE_EXHAUSTED',
        `write-behind 批级重试耗尽（连续 ${this.consecutiveFailures} 次失败）——写不进库的会话继续跑 = 谎报持久化，进程 fail-loud`,
        { cause: err },
      );
    }
    const delay = this.backoffBaseMs * 2 ** (this.consecutiveFailures - 1);
    await this.sleep(delay);
    return true;
  }

  /**
   * 毒丸隔离（§6.3 终态条款）：单条不重试 + durable 标记（persist_incidents）
   * + 进程级告警 + 会话 durability 切断（后续事件不再落库——seq 连续律推论，
   * 见文件头注）。游标跳记账（accountDropped）让其他会话的连续性断言不受牵连。
   */
  private isolatePoison(write: EventWrite, err: unknown): void {
    const { sessionId, event } = write;
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'SQLITE_CONSTRAINT';
    const message = err instanceof Error ? err.message : String(err);
    this.severed.add(sessionId);
    this.target.accountDropped(sessionId, event.seq);
    const entry: IncidentEntry = {
      time: this.clock(),
      sessionId,
      seq: event.seq,
      type: event.type,
      reason: `${code}: ${message}；毒丸隔离不落库丢弃，该会话后续事件一并停写（seq 连续律破——durable 前缀止于 seq<${event.seq}）`,
    };
    try {
      this.target.recordIncident(entry);
    } catch (recordErr) {
      // 标记面自身失败：告警面兜底（进程还活着就让人看得见——审计优先于静默）
      this.warn(`[persist] 毒丸标记落账失败（审计缺口）：${String(recordErr)}`);
    }
    this.warn(
      `[persist] 毒丸隔离：会话 ${sessionId} seq#${event.seq} ${event.type} 约束违例不落库（${message}）——durable 标记已落 persist_incidents，该会话后续事件停写`,
    );
  }
}
