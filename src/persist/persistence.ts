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
  /** 时间注入（缺省 Date.now——测试假钟） */
  readonly clock?: () => number;
  /** 凭证密钥注入（测试位） */
  readonly secretKey?: Buffer;
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
  /** 已打开会话的登记快照（onAppend 闭包捕获用——首登身份，与 sessions 行首登同源） */
  private readonly registrations = new Map<string, SessionRegistration>();
  private closed = false;

  private constructor(store: Store, writeBehind: WriteBehind, warn: (message: string) => void) {
    this.store = store;
    this.writeBehind = writeBehind;
    this.warn = warn;
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
      ...options.writeBehind,
    });
    return new Persistence(store, writeBehind, warn);
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
   * 装载既有会话（恢复重放面）：events 全量读（撕裂尾 heal 在 Store）→
   * 种子前缀重建 SessionLog → onAppend 接写队列续写。
   * closer 合成（孤儿 tool/未闭合 turn 等，§4）归调用方——在返回的 log 上
   * appendSynthetic 补形即可（合成物同权入日志）。
   * @throws 会话不存在（fail-loud——读未落库 id 属调用方 bug）
   */
  loadSession(sessionId: string): LoadedSession {
    this.ensureOpen();
    const row = this.store.getSessionRow(sessionId);
    if (!row) {
      throw new BaseError('PERSIST_DATA_CORRUPT', `会话 ${sessionId} 不存在（读未落库 id 或已删除——调用序检视）`);
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
      lineage:
        registration.parentId !== undefined || registration.seedLength > 0 || registration.origin !== 'conversation'
          ? { parentId: registration.parentId, seedLength: registration.seedLength, origin: registration.origin }
          : undefined,
      onAppend: (event) => {
        writeBehind.enqueue({ sessionId, event, registration });
      },
      warn: this.warn,
    });
    return log;
  }

  /** 会话删除（flush 先行——在飞事件落定后再三删同事务，§2.5） */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureOpen();
    await this.flush();
    const gone = this.store.deleteSession(sessionId);
    this.registrations.delete(sessionId);
    return gone;
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

  /** 会话列表透传（「按 cwd 取最新会话」选取面） */
  listSessions(options: { workspaceRoot?: string; limit?: number } = {}): SessionRow[] {
    this.ensureOpen();
    return this.store.listSessions(options);
  }

  /** 关库退出序：flush（失败即抛——调用方转非零退出，05 §6.3#6）→ checkpoint → close */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    this.store.close();
  }

  /** 只读判别（诊断面） */
  get inMemory(): boolean {
    return this.store.inMemory;
  }
}
