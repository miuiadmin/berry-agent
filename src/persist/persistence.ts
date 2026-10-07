/**
 * persist — Persistence 门面（05 篇 §6 的进程级编排面）。
 *
 * 组合 Store（物理读写）与 WriteBehind（批落编舞），向 host 装配根暴露：
 * 会话创建/装载/种子创建（§5 fork·导入的物理腿）/ flush 屏障 / close 退出序 /
 * 跨会话查询透传。SessionLog 经 onAppend 回调接入（append 热路径零 I/O——
 * 落库异步在写队列）。
 *
 * 退出钩子（exit 前强制 flush + 失败退出非零码）归 host 装配根（07 篇进程
 * 模型批接线）——本文件只提供 flush/close 两个编舞原语。
 */
import { randomUUID } from 'node:crypto';
import { BaseError, type SessionEvent, type SessionOrigin } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import type { MigrationSpec } from './migrations.js';
import { resolveDataDir, resolveDatabasePath } from './paths.js';
import {
  openStore,
  type QueryEventsFilter,
  type QueryEventsResult,
  type SessionRegistration,
  type SessionRow,
  type Store,
} from './store.js';
import { WriteBehind } from './write-behind.js';

/** Persistence 构造选项 */
export interface PersistenceOptions {
  /** 库文件路径（缺省 resolveDatabasePath() 三级梯子；':memory:' = 诊断形态） */
  readonly dbPath?: string;
  /** 数据目录（缺省 resolveDataDir()；secret.key 归属地） */
  readonly dataDir?: string;
  /** 聚合迁移链（host 装配根机械聚合 core: 插件声明——本批恒空） */
  readonly migrations?: readonly MigrationSpec[];
  /** 告警面（透传 Store/WriteBehind：权限修复/毒丸/撕裂尾） */
  readonly warn?: (message: string) => void;
  /**
   * durable 事件活体镜像观察者（03 §2.4 钩子主表 `session/event` 行的发射位
   * ——host 装配根注入 dispatch.emit 桥；载荷 `{sessionId, event}`）。
   * 每条 append（含合成补形）写入内存日志后回调；种子前缀不重放（历史上
   * 首写时已发过）。观察者异常隔离不影响提交（发射侧 try/catch 兜底 +
   * dispatch.emit 监听器互隔离双保险）。
   */
  readonly onDurableEvent?: (payload: { sessionId: string; event: SessionEvent }) => void;
  /** 时间注入（缺省 Date.now——测试假钟） */
  readonly clock?: () => number;
  /** 凭证密钥注入（测试位） */
  readonly secretKey?: Buffer;
  /**
   * 关库终态晚到写失败观测位（件D1——05 §6.3#6 N3）：close 后晚到事件
   * （停机序与在飞 run 收尾的竞速窗）折此回调（宿主装配根并计非零退出
   * 码）而非 fail-loud 重抛（对已关库重试耗尽 = 未捕获拒绝进程带栈崩溃）。
   * 缺省 noop（warn 兜底仍在）。
   */
  readonly onLateWriteFailure?: (err: BaseError) => void;
  /** write-behind 旋钮透传（测试位——尺寸帽/退避/睡眠注入） */
  readonly writeBehind?: {
    maxBatchSize?: number;
    retryLimit?: number;
    backoffBaseMs?: number;
    sleep?: (ms: number) => Promise<void>;
  };
}

/** 新会话创建面（createSession 的登记参数） */
export interface CreateSessionInit {
  /** 血缘形态（新开对话 = 'conversation'） */
  readonly origin: SessionOrigin;
  /** 血缘父会话（根会话 = undefined） */
  readonly parentId?: string;
  /** 种子前缀长度（非种子创建 = 0） */
  readonly seedLength?: number;
  /** 工作区根（「按 cwd 取最新会话」选取键） */
  readonly workspaceRoot?: string;
  /** 初始标题（可空） */
  readonly title?: string;
}

/** loadSession 结果（closer 合成归调用方——conversation/host 装配序编排，§4） */
export interface LoadedSession {
  /** 就绪的会话日志（种子前缀已建——后续 append 直通写队列） */
  readonly log: SessionLog;
  /** 血缘三元组（从 sessions 行现读） */
  readonly lineage: { parentId: string | undefined; seedLength: number; origin: SessionOrigin } | undefined;
  /** 会话行原始读形态 */
  readonly row: SessionRow;
}

/**
 * Persistence——进程级单例门面（05 §6.1 律 2：进程内多会话共用）。
 *
 * 会话 id 发放纪律（§5.2「不返回幻影 id」的分层落地）：
 *  - createSession：新开空会话——id 即刻发放但**零持久化承诺**（行随首事件
 *    落库；无事件即无行——空会话本就无可读内容）；
 *  - createSeededSession：fork/导入种子——**先同步落库再返回 id**（调用方
 *    拿到的 id 必可读——半导入状态不可见，§5.1 flush 前置）。
 */
export class Persistence {
  readonly store: Store;
  readonly writeBehind: WriteBehind;
  private readonly warn: (message: string) => void;
  /** durable 事件活体镜像（缺省零回调——纯库形态/测试面） */
  private readonly onDurableEvent: (payload: { sessionId: string; event: SessionEvent }) => void;
  /** 已打开会话的登记快照（onAppend 闭包捕获用——首登身份，与 sessions 行首登同源） */
  private readonly registrations = new Map<string, SessionRegistration>();
  private closed = false;

  private constructor(
    store: Store,
    writeBehind: WriteBehind,
    warn: (message: string) => void,
    onDurableEvent: (payload: { sessionId: string; event: SessionEvent }) => void,
  ) {
    this.store = store;
    this.writeBehind = writeBehind;
    this.warn = warn;
    this.onDurableEvent = onDurableEvent;
  }

  /**
   * 开库并装配（openStore 门禁序 + 写队列接线）。
   * 失败面全部 fail-loud（TOO_NEW/UNRECOGNIZED/密钥不可读——半装配不留残）。
   */
  static open(options: PersistenceOptions = {}): Persistence {
    const warn = options.warn ?? ((message) => console.error(message));
    const store = openStore({
      dbPath: options.dbPath ?? resolveDatabasePath(),
      dataDir: options.dataDir ?? resolveDataDir(),
      migrations: options.migrations,
      warn,
      clock: options.clock,
      secretKey: options.secretKey,
    });
    const writeBehind = new WriteBehind({
      target: store,
      warn,
      clock: options.clock,
      // 关库终态晚到写失败观测位透传（件D1——折退出失败态不重抛）
      onLateWriteFailure: options.onLateWriteFailure,
      ...options.writeBehind,
    });
    return new Persistence(store, writeBehind, warn, options.onDurableEvent ?? (() => undefined));
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('Persistence 已关闭（close 后不得再用——调用序 bug）');
  }

  /**
   * 新会话创建（零 I/O——行随首事件经写队列落库）。
   * @returns 接好 onAppend 的 SessionLog（append 即入队）
   */
  createSession(init: CreateSessionInit): SessionLog {
    this.ensureOpen();
    const sessionId = randomUUID();
    const registration: SessionRegistration = {
      origin: init.origin,
      parentId: init.parentId,
      seedLength: init.seedLength ?? 0,
      workspaceRoot: init.workspaceRoot,
      title: init.title,
    };
    return this.attachSession(sessionId, [], registration);
  }

  /**
   * 会话行在场判定（e-4 操控轴幽灵守卫的判据位——loadSession 的零副作用
   * 读面：只查行不 attach、不合成 closer、不建驱动）。
   */
  hasSession(sessionId: string): boolean {
    this.ensureOpen();
    return this.store.getSessionRow(sessionId) !== undefined;
  }

  /**
   * 装载既有会话（恢复重放面）：**读前屏障**（write-behind 该会话在队事件
   * 同步排干——05 §5.0 2026-10-04 注）→ events 全量读（撕裂尾 heal 在
   * Store）→ 种子前缀重建 SessionLog → onAppend 接写队列续写。
   * closer 合成（孤儿 tool/未闭合 turn 等，§4）归调用方——在返回的 log 上
   * appendSynthetic 补形即可（合成物同权入日志）。
   * @throws 会话不存在（fail-loud——读未落库 id 属调用方 bug）
   * @throws 读前屏障失败（写链熔断 PERSIST_WRITE_EXHAUSTED / 同步排干写
   *   失败原样重抛——对着落不了库的前缀合成 closer 即造撞 seq 违约）
   */
  loadSession(sessionId: string): LoadedSession {
    this.ensureOpen();
    // 读前屏障（05 §5.0 2026-10-04 注）：retire→reopen 竞窗内该会话真实收尾
    // 事件可仍在 write-behind 在队未落——先同步排干再读，防 recoverClosers
    // 对在队事件误判孤儿（合成物与真身撞 seq → 写序违约熔断）。置于行读
    // 之前：行（last_seq/updated_at）同随排干刷新，装载快照整体一致。
    this.writeBehind.drainSessionNow(sessionId);
    const row = this.store.getSessionRow(sessionId);
    if (!row) {
      throw new BaseError('PERSIST_DATA_CORRUPT', `会话 ${sessionId} 不存在（读未保存 id 或已删除——调用序检视）`);
    }
    const events = this.store.loadEvents(sessionId);
    const registration: SessionRegistration = {
      origin: row.origin,
      parentId: row.parentId,
      seedLength: row.seedLength,
      workspaceRoot: row.workspaceRoot,
      title: row.title,
    };
    const log = this.attachSession(sessionId, events, registration);
    return {
      log,
      lineage:
        row.parentId !== undefined || row.seedLength > 0 || row.origin !== 'conversation'
          ? { parentId: row.parentId, seedLength: row.seedLength, origin: row.origin }
          : undefined,
      row,
    };
  }

  /**
   * 单会话在队事件同步排干公开面：loadSession 读前屏障（05 §5.0 2026-10-04
   * 注）之外的第二个消费位 = checkpoint 拍摄前屏障（05 §5.3 D② 治本批定形注
   * ——凡拍 boundarySeq 的触发位先排干，令边界拍下即有 durable 承载）。
   * 失败语义 fail-loud 原样重抛（写链熔断 PERSIST_WRITE_EXHAUSTED / 同步写
   * 失败——与 loadSession 读前屏障同面）。纯透传——close 编舞与生命周期
   * 不涉。
   */
  drainSessionNow(sessionId: string): void {
    this.ensureOpen();
    this.writeBehind.drainSessionNow(sessionId);
  }

  /**
   * 种子会话创建（fork/导入的物理腿，§5.0/§5.1）：**同步落库**（种子事件 +
   * sessions 行单事务——flush 语义内联，返回 id 必可读）后发放接好续写的
   * SessionLog。
   * @param seed 种子前缀（须为合法种子——ensureSeeded 校验归 session 侧导入闸；
   *   此处只保物理写：seq 从 0 连续）
   * @throws 内存会话（:memory:）→ SESSION_PERSISTENCE_REQUIRED（05 §5.1：
   *   fork 语义需要物理新会话，静默降级为拷贝 = 语义谎言）
   */
  createSeededSession(
    seed: readonly SessionEvent[],
    registration: { origin: SessionOrigin; parentId?: string; workspaceRoot?: string; title?: string },
  ): SessionLog {
    this.ensureOpen();
    if (this.store.inMemory) {
      throw new BaseError(
        'SESSION_PERSISTENCE_REQUIRED',
        '内存会话（:memory:）不支持 fork/导入种子——fork 语义需要物理新会话（05 §5.1）',
      );
    }
    const sessionId = randomUUID();
    const full: SessionRegistration = {
      origin: registration.origin,
      parentId: registration.parentId,
      seedLength: seed.length,
      workspaceRoot: registration.workspaceRoot,
      title: registration.title,
    };
    // 同步落库（绕过写队列——§5.2「不返回幻影 id」：行未提交前不发放 id）
    if (seed.length > 0) {
      this.store.writeEvents(seed.map((event) => ({ sessionId, event, registration: full })));
    } else {
      // 空种子（如 slice 出空段）：登记行仍须落（无行 = 幻影 id）
      this.store.registerSessionRow(sessionId, full);
    }
    return this.attachSession(sessionId, seed, full);
  }

  /** 统一装订：SessionLog 构造 + onAppend 写队列接线 + 登记快照入册 */
  private attachSession(
    sessionId: string,
    seed: readonly SessionEvent[],
    registration: SessionRegistration,
  ): SessionLog {
    this.registrations.set(sessionId, registration);
    const writeBehind = this.writeBehind;
    const log = new SessionLog({
      sessionId,
      seed,
      // 工作区锚透传（03 §10.7 六役定形注）：登记行 workspaceRoot 随日志活体
      // 直达驱动工厂——createSession 零 I/O（行首事件才落库），起会时库中行
      // 尚不可见，锚不能走库读（loadSession 形同源，行值即登记值）
      workspaceRoot: registration.workspaceRoot,
      lineage:
        registration.parentId !== undefined || registration.seedLength > 0 || registration.origin !== 'conversation'
          ? { parentId: registration.parentId, seedLength: registration.seedLength, origin: registration.origin }
          : undefined,
      onAppend: (event) => {
        writeBehind.enqueue({ sessionId, event, registration });
        // 活体镜像（03 §2.4 钩子主表 session/event 行——写入后即发；观察者
        // 异常隔离不影响提交，append 热路径零 I/O 律不破坏：观察者是内存
        // 分派桥非 I/O 面）
        try {
          this.onDurableEvent({ sessionId, event });
        } catch {
          // 镜像观察者故障不波及会话流（双保险腿——dispatch 桥自身另有
          // 监听器互隔离）
        }
      },
      warn: this.warn,
    });
    return log;
  }

  /** 会话删除（flush 先行——在飞事件落定后再三删同事务，§2.5） */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureOpen();
    await this.flush();
    // 已删除会话登记（05 §2.5 del-gap 定形注——挖掘 15 轮）：须在 flush 之后
    // （当刻在队笔先落库再删）、三删之前——此后 settle 链尾环的迟到写笔经
    // write-behind 前置判静默丢弃（修前形：迟到笔对已删 sessions 行续写，
    // cursorFor 孤儿腿 expected=0 与高位 seq 撞写序违约 → 熔断进程崩溃）
    this.writeBehind.dropSession(sessionId);
    const gone = this.store.deleteSession(sessionId);
    this.registrations.delete(sessionId);
    return gone;
  }

  /**
   * 会话退役出册（05 retire 清账律——第十一轮深扫定形注）：retire 收口后
   * 进程级登记面的死键清账——registrations 登记快照与 store 侧 per-session
   * 写序游标（cursors）同笔出册，防逐会话单调滞留（修前仅 deleteSession
   * 物理删路出册；retire 路 durable 面保留 → 两键成死键，daemon tick 用户
   * 行高频 retire 下进程级累积）。
   *
   * 调用序律：**排干屏障之后**执行（drainSessionNow / flush 后）——在飞写笔
   * 事务成功即回写游标键，排干前出册会被在队写复活；排干后无在飞写，键即
   * 终清（此后迟到写笔经 loadSession 重附着属合法复活登记，非死键）。
   *
   * 与 deleteSession 分立：彼系物理删路的 flush + 三删 + 出册（既有不变）；
   * 此系 retire 路纯内存出册（durable 面不动）。幂等——重复调用零副作用
   * （deleteSession 后再 retireEntries 的 double-delete 同键无害）。
   */
  retireEntries(sessionId: string): void {
    this.ensureOpen();
    this.registrations.delete(sessionId);
    this.store.retireCursor(sessionId);
  }

  /** flush 屏障透传（05 §4——审批落账/压缩对/turn 收口等关键事务点调用） */
  async flush(): Promise<void> {
    this.ensureOpen();
    await this.writeBehind.flush();
  }

  /** 跨会话查询透传（05 §3.4——obs/goal/CLI 导出的底层原语） */
  queryEvents(filter: QueryEventsFilter): QueryEventsResult {
    this.ensureOpen();
    return this.store.queryEvents(filter);
  }

  /** 标题更新透传（auto-title 面） */
  updateSessionTitle(sessionId: string, title: string): boolean {
    this.ensureOpen();
    return this.store.updateSessionTitle(sessionId, title);
  }

  /**
   * 活体会话待落题更新（2026-09-30 人面改名批——/rename 零消息会话兜底）：
   * createSession 零 I/O（行首事件才落库），TUI 刚开的新会话行尚不在库——
   * updateSessionTitle 对其 misses。本面在活体 registration 在册时：①改挂
   * 活体 registration.title（后续 enqueue 现取新值）；②registerSessionRow
   * 立即预落行（幂等 ON CONFLICT DO NOTHING——写队列已排队的旧 registration
   * 项 flush 落行时行已在、不回写旧题，pending 窗竞态结构性关死）。显式
   * 改名才走此面——「createSession 零 I/O」承诺不破（无人改名的空会话行
   * 仍不落）。不在册（跨进程/未知 id）返 false 诚实 miss。
   */
  stageSessionTitle(sessionId: string, title: string): boolean {
    this.ensureOpen();
    const registration = this.registrations.get(sessionId);
    if (registration === undefined) return false;
    const next = { ...registration, title };
    this.registrations.set(sessionId, next);
    this.store.registerSessionRow(sessionId, next);
    return true;
  }

  /** 会话列表透传（「按 cwd 取最新会话」选取面） */
  listSessions(options: { workspaceRoot?: string; limit?: number } = {}): SessionRow[] {
    this.ensureOpen();
    return this.store.listSessions(options);
  }

  /** 会话全量计数（B2 截断披露单源——store 同名透传） */
  countSessions(): number {
    return this.store.countSessions();
  }

  /**
   * 会话内全文检索透传（05 §9 首发口径：查询面限定 session_id——跨会话检索
   * 非首发面）。**flush 先行归调用方编排**（write-behind 在飞事件不进 FTS
   * 索引，检索前须屏障）；命中返回 seq 升序列表（limit 缺省 50）。
   */
  searchSessionFts(sessionId: string, pattern: string, limit?: number): number[] {
    this.ensureOpen();
    return this.store.searchSessionFts(sessionId, pattern, limit);
  }

  /**
   * 关库退出序：flush（失败即抛——调用方转非零退出，05 §6.3#6）→ write-behind
   * 关库终态标记（件D1：置位先于 store.close——此后晚到事件折 onLateWriteFailure
   * 观测不重抛）→ checkpoint → close。flush 失败（写链 broken）时后三步在
   * finally 中永达（第九轮深扫件2：修前截断会使晚到事件撞熔断分支同步抛
   * 带栈错——件D1 要防的「关库后晚到写」崩溃在 flush 失败变体复活）；
   * flush 错照常外抛（调用方 runtime ⑥ 吞错记账）。
   */
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.flush();
    } finally {
      this.closed = true;
      // 关库终态标记先于 store.close：close() 后的晚到 enqueue/在飞 drain 余队
      // 在 write-behind 层折观测（不再对已关库重试耗尽重抛——件D1 ②层）
      this.writeBehind.close();
      this.store.close();
    }
  }

  /** 只读判别（诊断面） */
  get inMemory(): boolean {
    return this.store.inMemory;
  }
}
