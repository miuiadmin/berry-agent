/**
 * persist — write-behind 批落链（05 篇 §6.3）。
 *
 * append 热路径零 I/O（session 侧 onAppend 直通 enqueue——纯内存入队）；
 * 落库编舞全在本文件：微任务节流 + 批尺寸帽 64、事务序 = 入队序（单全局
 * 队列——多会话事件按全局入队序交织落库，同会话序天然保真）、批级失败
 * 退避重试（指数退避，耗尽 3 次 fail-loud）、毒丸分类（约束违例逐行诊断：
 * 单条隔离不重试 + durable 标记 + 会话 durability 切断）、flush 屏障、
 * 单会话同步排干面（drainSessionNow——loadSession 读前屏障，05 §5.0
 * 2026-10-04 注：retire→reopen 竞窗的陈旧前缀消除）。
 *
 * 关库终态（件D1——05 §6.3#6）：close() 后链入 closed 态——晚到事件（停机
 * 序与在飞 run 收尾的竞速窗）不再 fail-loud（对已关库重试耗尽重抛 = 未捕获
 * 拒绝带栈崩溃），折观测位（onLateWriteFailure 记账 + warn 兜底——宿主装配
 * 根并计非零退出码）。
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
  /** 关库终态晚到写失败观测位（件D1——05 §6.3#6 N3）：close 后 enqueue/在飞
   *  drain 的丢弃与放弃不再 fail-loud，折此回调（宿主装配根并计非零退出码）；
   *  缺省 noop（warn 兜底仍在——可见性不缺位） */
  readonly onLateWriteFailure?: (err: BaseError) => void;
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
 * 生命周期态四枚：queued（队列本体）/ draining（在飞 drain 任务——enqueue
 * 只入队 + 按需点火）/ broken（fatal 熔断——此后 enqueue 即抛，诚实拒写）/
 * closed（关库终态——此后晚到事件折观测不重抛，件D1）。
 */
export class WriteBehind {
  private readonly target: WriteTarget;
  private readonly maxBatchSize: number;
  private readonly retryLimit: number;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onFatal: (err: BaseError) => void;
  private readonly onLateWriteFailure: (err: BaseError) => void;
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
  /** 关库终态旗（Persistence.close 序在 store.close 前置位——此后晚到事件折观测） */
  private closed = false;
  /** 已切断 durability 的会话（毒丸后——后续事件静默丢弃，不再入队落库） */
  private readonly severed = new Set<string>();
  /**
   * 已删除会话集（05 §2.5 del-gap 定形注——挖掘 15 轮）：deleteSession 在
   * flush 排干后、物理三删前登记；此后该会话一切迟到写笔按「已删世界遗物」
   * 静默丢弃（enqueue 前置判 + drainSessionNow 早退）。与 severed 分立——
   * 彼系毒丸切断诊断语义（severedSessions 只读面供 incident 对账），此系
   * 用户主权删除终决语义，不混集。
   */
  private readonly dropped = new Set<string>();

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
    this.onLateWriteFailure = options.onLateWriteFailure ?? (() => {});
    this.warn = options.warn ?? ((message) => console.error(message));
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * 入队（append 热路径直通——O(1) 内存操作 + 按需点火微任务）。
   * 前置四判的优先级序（第九轮深扫件2/件3 定形 severed→closed→broken 三判；
   * 2026-10-08 del-gap 批插入 dropped 于 severed 后——同为静默丢弃面，序理由
   * 同 severed 优先：已终会话不折 closed 观测/不逐条刷账）：
   *  1. severed（毒丸切断）最优先——incident 已一笔在案、该会话 durability
   *     已终，迟到事件按切断纪律静默丢弃；若 closed 判在前，会把本应静默
   *     丢弃的事件折成晚到失败观测（warn + 退出失败态并计）——对已终会话
   *     重复刷账，违「一笔 incident 概括，不逐条刷账」；
   *  1b. dropped（已删除会话）同前——删除是用户主权终决，迟到笔静默丢弃；
   *  2. closed 次之——关库终态后 fail-loud 让位退出记账（件D1）：flush 失败
   *     变体里关库标记已置而链亦熔断（close 的 finally 两步同达），晚到事件
   *     须折观测而非同步抛栈——closed 判必须前于 broken 判（熔断的诚实拒写
   *     只对「进程还在跑」的世界有意义，库已关即进程正在退出）；
   *  3. broken 最后——诚实拒写（调用方立即知道持久化已死）。
   */
  enqueue(write: EventWrite): void {
    // 切断会话静默丢弃（incident 已自述——毒丸后该会话 durability 已终）
    if (this.severed.has(write.sessionId)) return;
    // 已删除会话迟到笔静默丢弃（05 §2.5 del-gap 定形注——用户主权删除后
    // settle 链尾环的竞窗遗物；纪律同 severed 一笔不逐刷账）
    if (this.dropped.has(write.sessionId)) return;
    // 关库终态：晚到事件（在飞 run 收尾竞速窗）不抛不点火——折观测后丢弃
    //（修前形：照常入队点火 → 对已关库重试耗尽 → onFatal 重抛 = 未捕获
    //  拒绝进程带栈崩溃；件D1 ②层）
    if (this.closed) {
      this.recordLateFailure(
        new BaseError(
          'PERSIST_WRITE_EXHAUSTED',
          `关库后晚到事件丢弃（会话 ${write.sessionId} seq#${write.event.seq} ${write.event.type}）——库已关，折退出失败态`,
        ),
      );
      return;
    }
    if (this.broken) {
      throw new BaseError('PERSIST_WRITE_EXHAUSTED', '写链已熔断（批级重试耗尽）——进程应退出，拒绝继续假写');
    }
    this.queue.push(write);
    this.scheduleDrain();
  }

  /**
   * 关库终态标记（件D1 ②层）：Persistence.close 序在 store.close 前调用——
   * 此后晚到事件（enqueue 位）与在飞 drain 余队（drain 回环顶）一律折观测
   * 不重试不熔断不重抛（05 §6.3#6 N3「落盘步永达记失败态」的关库侧推论）。
   */
  close(): void {
    this.closed = true;
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
   * 已删除会话登记（05 §2.5 del-gap 定形注——挖掘 15 轮）：deleteSession 在
   * flush 排干**之后**、物理三删之前调用——此后该会话迟到写笔（settle 链
   * 尾环经 enqueue 入队的竞窗遗物）静默丢弃，不再对已删 sessions 行续写
   * （修前形：游标已随三删出册 → cursorFor 孤儿腿自 -1 重启 → expected=0
   * 与迟到笔高位 seq 撞 PERSIST_DATA_CORRUPT 写序违约 → 退避耗尽熔断进程
   * 崩溃——用户主权删除反致 daemon 全局死）。幂等——重复登记零副作用。
   * 调用序律：**flush 之后**（flush 前登记会把合法在队笔一并丢弃——删除
   * 前的笔属「当刻在队」合法面，必须先落库再删）。
   */
  dropSession(sessionId: string): void {
    this.dropped.add(sessionId);
    // 登记即滤在队残留（防御形——deleteSession 调用位在 flush 后，队列理应
    // 无该会话条目；异常序残留一并清，防 drain 批对孤儿写）
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.sessionId === sessionId) this.queue.splice(i, 1);
    }
  }

  /** 已删除会话清单（诊断只读面——与 severedSessions 分立语义） */
  get droppedSessions(): readonly string[] {
    return [...this.dropped];
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
   * 指定会话在队事件同步排干（05 §5.0 2026-10-04 读前屏障注——loadSession
   * 装载读面的前置腿）：把该会话尚未落库的在队事件按既定入队序单批同步
   * 写出并出队。返回后 store 对该会话的读面即含全部已 append 事件——
   * retire→reopen 竞窗的陈旧 durable 前缀消除（recoverClosers 不再对在队
   * 真实收尾事件误判孤儿、合成物不与真身撞 seq）。
   *
   * 与异步 drain 的互斥论证（单线程事件环，本方法全程同步零挂起）：
   * drain() 唯一的挂起点是批级失败的退避等待（failOrBackoff 的 sleep），
   * 而两处挂起前，失败批/行都已原样放回队首（unshift）——即**任何同步
   * 代码运行的时刻，queue 恰含全部未成功写出的事件且原序保持**（批内的
   * store 写全发生在 drain 的同步段，同步段内他者无从插入执行）。故本
   * 方法不可能与 drain 的写段交错：抽走的会话事件单独成批写成功，与
   * 「留在队列等异步 drain 落」在事务序上等价（单会话序的保真不因跨会话
   * 交织而变）；剩余队列原序不动，挂起中的 drain 恢复后照旧消费。
   *
   * 失败面（fail-loud，不改任何静默纪律）：
   *  - 链已熔断：抛 PERSIST_WRITE_EXHAUSTED——在队事件无从落库，装载读面
   *    不能对着永远落不了的前缀合成 closer，诚实拒读；
   *  - 同步写失败（瞬态错/写序违约/约束违例皆同路）：事件按原索引放回
   *    队列（数组形完全还原——异步 drain 照旧退避重试或行模式毒丸分类，
   *    本层不做第二套账务）后原样重抛，loadSession fail-loud 不吞不猜；
   *  - 切断会话（severed）不在排干面：其 durable 前缀已终（incident 在案），
   *    在队事件留给异步 drain 按既有纪律静默丢弃；
   *  - 已删除会话（dropped）同早退——已删世界遗物不合成 closer（05 §2.5
   *    del-gap 定形注）。
   */
  drainSessionNow(sessionId: string): void {
    if (this.broken) {
      throw new BaseError(
        'PERSIST_WRITE_EXHAUSTED',
        '写链已熔断——会话在队事件无从同步排干，装载读面拒读（进程应退出）',
      );
    }
    // 切断会话早退（见头注——静默丢弃纪律归异步 drain）
    if (this.severed.has(sessionId)) return;
    // 已删除会话早退（del-gap 定形注——迟到笔不进排干面，静默丢弃）
    if (this.dropped.has(sessionId)) return;
    // 收集该会话在队条目的原索引与引用（原序——入队序即 per-session seq 序）
    const indices: number[] = [];
    const writes: EventWrite[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i]!.sessionId === sessionId) {
        indices.push(i);
        writes.push(this.queue[i]!);
      }
    }
    if (writes.length === 0) return;
    // 先出队再写（降序 splice 摘除）；失败按原索引升序放回——数组形完全还原
    for (let j = indices.length - 1; j >= 0; j--) this.queue.splice(indices[j]!, 1);
    try {
      // 单批单事务同步写出（与异步 drain 批路径同一写面——游标推进/行
      // upsert/FTS 同批皆由 Store.writeEvents 自持，本层零额外面）
      this.target.writeEvents(writes);
    } catch (err) {
      for (let j = 0; j < indices.length; j++) this.queue.splice(indices[j]!, 0, writes[j]!);
      throw err;
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
      // 关库终态短路（close 落在退避等待/重试点火窗时）：余队无处可写——
      // 整批折观测后放弃清空（不重试不熔断不 onFatal——修前形：对已关库
      // 连败耗尽重抛 = 未捕获拒绝带栈崩溃；件D1 ②层）
      if (this.closed) {
        const dropped = this.queue.splice(0);
        this.recordLateFailure(
          new BaseError(
            'PERSIST_WRITE_EXHAUSTED',
            `关库后晚到队列放弃（${dropped.length} 条，首条会话 ${dropped[0]!.sessionId} seq#${dropped[0]!.event.seq}）——库已关，折退出失败态`,
          ),
        );
        this.rowMode = false;
        this.consecutiveFailures = 0;
        return;
      }
      if (this.rowMode) {
        const write = this.queue.shift()!;
        if (this.severed.has(write.sessionId)) continue; // 切断会话：静默丢弃（incident 已记）
        if (this.dropped.has(write.sessionId)) continue; // 已删除会话：静默丢弃（del-gap 定形注）
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
        `write-behind 批级重试耗尽（连续 ${this.consecutiveFailures} 次失败）——写不进库的会话继续跑 = 谎称已保存，进程 fail-loud`,
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

  /**
   * 关库终态晚到写失败折观测（件D1 ②层）：记 onLateWriteFailure 观测位
   * （宿主装配根并计非零退出码——05 §6.3#6 N3）+ warn 兜底（观测面缺席也
   * 不静默）。观测回调自身异常不反噬（try/catch 隔离——晚到链只折不炸）。
   */
  private recordLateFailure(err: BaseError): void {
    try {
      this.onLateWriteFailure(err);
    } catch (observerErr) {
      this.warn(`[persist] 关库后晚到写失败观测回调异常（隔离不反噬）：${String(observerErr)}`);
    }
    this.warn(`[persist] 关库后晚到事件丢弃（不重试不熔断——已折退出失败态）：${err.message}`);
  }
}
