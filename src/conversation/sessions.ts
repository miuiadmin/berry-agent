/**
 * SessionManager——多会话编排面（02 §2.3「多会话单焦点」/ 03 §2.2 能力面表
 * ctx.sessions 注记 / 05 §5 fork 编排 + §9 会话内 FTS 首发口径）。
 *
 * 职责 = drivers 登记表（单焦点幂等：同 id 重复 open 回同一活体驱动）+ 五动词：
 *  - list：会话列表透传（workspaceRoot / limit 选取面——「按 cwd 取最新会话」）；
 *  - create：新开（origin 缺省 'conversation'）+ 驱动构造；
 *  - open：resume——装载日志 → closer 合成（05 §4「合成归调用方」条款的消费
 *    位：recoverClosers 草稿经 appendSynthetic 收形，合成物同权入日志）→
 *    驱动构造（resumed 形——批 11d 冷启动续接的先手位）；
 *  - fork：种子编排（05 §5.0/§5.2）——内存种子组装（forkPrefix 前缀拷贝 +
 *    end-seed 字面尾事件，源日志零污染——05 §5.0 落码裁决注记）+ isSeededPrefix
 *    断言 + createSeededSession 同步落库（不返回幻影 id）+ session_before_fork
 *    钩子（03 主表：waterfall 可否决——否决走联合回执不造新错误码）；
 *  - search：flush 屏障先行（write-behind 在飞事件不进 FTS 索引）+ 会话内
 *    全文检索（05 §9 首发：session_id 限定）。
 *
 * 事实源纪律：源会话已 open 时 fork 直接取**活体 SessionLog** 的事件流（内存态
 * 最新鲜）；未 open 才 loadSession——避免同 id 双附着制造第二事实源（读侧以
 * 先开者为准）。驱动构造经注入工厂（createDriver——streamFn/convertToLlm 等
 * 装配注入族归 host 装配根闭包，本件不持 LLM 边界任何依赖）。
 */
import type { EventDispatch } from '../context/index.js';
import type { AgentTool, ApprovalAskAnswer, ApprovalAskRequest, SessionOrigin } from '../contracts/index.js';
import type { Persistence, SessionRow } from '../persist/index.js';
import { forkPrefix, isSeededPrefix, recoverClosers } from '../session/index.js';
import type { SessionLog } from '../session/index.js';
import type { ConversationDriver } from './driver.js';

/** 会话编排钩子词汇（03 主表在册——本面消费的 waterfall 事件名单源） */
export const SESSION_HOOK_NAMES = ['session_before_fork'] as const;

/**
 * session_before_fork 载荷（waterfall 形——监听器可校验种子边界）：
 * 否决 = 置 veto 位后不调 next（管线短路语义），或置位后照常 next（管理器
 * 只认 veto 位——两种写法等价）；不置位即放行。
 */
export interface SessionBeforeForkInput {
  /** 分叉源会话 */
  readonly sourceSessionId: string;
  /** 前缀边界 seq（含）——快照时点（缺省边界已解析为具体值） */
  readonly upToSeq: number;
  /** 否决位（否决回执携 reason——fork 返回 {status:'vetoed'}） */
  veto?: { reason: string };
}

/** 驱动构造工厂注入（host 装配根闭包——装配注入族不进本件） */
export type DriverFactory = (input: {
  readonly session: SessionLog;
  readonly origin: SessionOrigin;
  readonly resumed: boolean;
  /**
   * 本会话模型覆盖（create init.model 透传；缺省 undefined = 走装配根缺省
   * 模型解析）。纯内存载体——不进 durable 行（触发器 starter 的 per-fresh-
   * session 模型通道；open/resume 不携带——resume 回落栈缺省，C 批 C-3）。
   */
  readonly model?: string;
  /**
   * 本会话系统提示覆盖（批 19c-1——in-process 子代理 per-session 通道）。
   * 纯内存载体同 model 律：不进 durable、open/resume 不携带；缺省 =
   * 装配根系统提示基线（per-session 位胜出）。
   */
  readonly systemPrompt?: string;
  /**
   * 会话工具面整形钩子（批 19c-1——子代理派生面白名单执法位）：装配产物
   * 在进驱动前经此整形（语义归调用方——本件与栈只透传不立法；子代理形 =
   * fs 四自持 + bash 结构性排除 + 白名单过滤余面，04 §10）。
   */
  readonly shapeTools?: (tools: readonly AgentTool[]) => readonly AgentTool[];
  /**
   * 审批呈现路由覆盖（批 19c-1——委派边界①审批升父面）：缺省 = 本会话
   * 通道队列；在场时胜出（子代理形 = 父会话队列 + 挂起通知注入）。
   */
  readonly askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;
}) => ConversationDriver;

/** 已开会话回执（create/open 共形） */
export interface OpenedSession {
  readonly sessionId: string;
  readonly driver: ConversationDriver;
  readonly origin: SessionOrigin;
}

/** fork 成功回执（05 §5.2 fork 露头） */
export interface ForkedSession {
  readonly status: 'forked';
  readonly sessionId: string;
  readonly driver: ConversationDriver;
  /** 血缘三元组（sessions 行同源形态） */
  readonly lineage: { readonly parentId: string; readonly seedLength: number; readonly origin: 'fork' };
  /** 新会话首条新 append 事件的 seq（= seedLength——不含幻影承诺） */
  readonly firstAppendSeq: number;
}

/** fork 否决回执（钩子否决——非错误路径，不造新错误码） */
export interface ForkVetoed {
  readonly status: 'vetoed';
  readonly reason: string;
}

/** fork 联合回执（可否决语义的载荷面） */
export type ForkOutcome = ForkedSession | ForkVetoed;

/** SessionManager 构造面 */
export interface SessionManagerOptions {
  readonly persistence: Persistence;
  readonly dispatch: EventDispatch;
  readonly createDriver: DriverFactory;
}

/**
 * 多会话管理器（进程级单例——Persistence 同生命周期；02 §2.3 多会话单焦点：
 * 并存多枚驱动、焦点唯 caller 视角，本件不持焦点态）。
 */
export class SessionManager {
  private readonly persistence: Persistence;
  private readonly dispatch: EventDispatch;
  private readonly createDriver: DriverFactory;
  /** 已开会话登记（sessionId → 驱动 + 血缘形态——幂等 open 的判据面） */
  private readonly records = new Map<string, { driver: ConversationDriver; origin: SessionOrigin }>();

  constructor(options: SessionManagerOptions) {
    this.persistence = options.persistence;
    this.dispatch = options.dispatch;
    this.createDriver = options.createDriver;
    // 钩子词汇接线（一词两册幂等跳过——03 §2.4 装配序律：装载批预注册主表
    // 镜像在前，session_before_fork 已注册即共享登记；未注册自举保独立装配）；
    // 重复建管理器检测改经装配哨兵（永不 emit 的占位词——二次装配撞哨兵红）
    this.dispatch.registerEventNames([
      'conversation/session-manager-mounted',
      ...SESSION_HOOK_NAMES.filter((name) => !this.dispatch.isRegistered(name)),
    ]);
  }

  /** 会话列表（「按 cwd 取最新」选取面透传） */
  list(options: { workspaceRoot?: string; limit?: number } = {}): SessionRow[] {
    return this.persistence.listSessions(options);
  }

  /** 新开会话（origin 缺省普通对话；model/systemPrompt/shapeTools/askApproval 为本会话装配覆盖——纯内存载体，批 19c-1 子代理通道同 model 律） */
  create(
    init: {
      origin?: SessionOrigin;
      workspaceRoot?: string;
      title?: string;
      model?: string;
      systemPrompt?: string;
      shapeTools?: (tools: readonly AgentTool[]) => readonly AgentTool[];
      askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;
    } = {},
  ): OpenedSession {
    const origin = init.origin ?? 'conversation';
    const log = this.persistence.createSession({
      origin,
      ...(init.workspaceRoot !== undefined ? { workspaceRoot: init.workspaceRoot } : {}),
      ...(init.title !== undefined ? { title: init.title } : {}),
    });
    return this.adopt(log, origin, false, init);
  }

  /**
   * 打开（resume）既有会话：幂等——已 open 直接回活体驱动（单焦点，不造第二
   * 附着）。未 open 走 loadSession → closer 合成（崩溃收形——合成物复用最后
   * 真实 time 可审计辨）→ 驱动构造（resumed 形）。
   * @throws 会话不存在（fail-loud——读未落库 id 属调用方 bug）
   */
  open(sessionId: string): OpenedSession {
    const existing = this.records.get(sessionId);
    if (existing !== undefined) {
      return { sessionId, driver: existing.driver, origin: existing.origin };
    }
    const loaded = this.persistence.loadSession(sessionId);
    // closer 合成（05 §4——孤儿 tool/未闭合 turn 等补形；全日志扫描不设窗口）
    for (const draft of recoverClosers(loaded.log.events())) {
      loaded.log.appendSynthetic(draft);
    }
    return this.adopt(loaded.log, loaded.row.origin, true);
  }

  /**
   * 分叉（05 §5.0 边界快照）：前缀种子 + 复制。边界缺省 lastClosedBoundary
   * （不在进行中 turn 中间切）；内存种子组装——end-seed 只随种子走（time 复用
   * 前缀尾事件时间，§4 合成确定性同律），源日志零污染。session_before_fork
   * 钩子可否决（联合回执）。源会话已 open 取活体事件流（最新鲜）。
   * @throws 源会话不存在 / upToSeq 越界（fail-loud 调用方 bug）
   */
  async fork(sourceSessionId: string, options: { upToSeq?: number; title?: string } = {}): Promise<ForkOutcome> {
    // —— 事实源选择：活体优先（双事实源纪律——未 open 才 loadSession）——
    const live = this.records.get(sourceSessionId);
    let sourceLog: SessionLog;
    let workspaceRoot: string | undefined;
    if (live !== undefined) {
      sourceLog = live.driver.session;
      // 活体驱动不携带行信息——workspaceRoot 经公开列表面反查（不为内部
      // 取值开新 persistence 读口）
      workspaceRoot = this.persistence.listSessions().find((row) => row.id === sourceSessionId)?.workspaceRoot;
    } else {
      const loaded = this.persistence.loadSession(sourceSessionId);
      sourceLog = loaded.log;
      workspaceRoot = loaded.row.workspaceRoot;
    }
    const sourceEvents = sourceLog.events();

    // —— 边界解析 + 合法性（缺省最后闭合边界；显式值须落在日志内）——
    const boundary = options.upToSeq ?? sourceLog.lastClosedBoundary();
    if (options.upToSeq !== undefined && (options.upToSeq < -1 || options.upToSeq >= sourceEvents.length)) {
      throw new Error(`fork 边界越界：upToSeq=${options.upToSeq} 日志长 ${sourceEvents.length}（调用方 bug）`);
    }

    // —— 钩子（waterfall 可否决——只认 veto 位；空链直通）——
    const hookInput: SessionBeforeForkInput = { sourceSessionId, upToSeq: boundary };
    const hookOutput = await this.dispatch.waterfall<SessionBeforeForkInput>('session_before_fork', hookInput);
    if (hookOutput.veto !== undefined) {
      return { status: 'vetoed', reason: hookOutput.veto.reason };
    }

    // —— 种子组装：前缀拷贝 + end-seed 字面尾事件（data 空对象——§1.1）——
    const seed = forkPrefix(sourceEvents, boundary);
    seed.push({
      type: 'session/end-seed',
      seq: seed.length,
      time: seed.length > 0 ? seed[seed.length - 1]!.time : 0,
      data: {},
    });
    // 合法种子断言（防御位——forkPrefix + 字面尾事件在构造上恒真，触达即实现回归）
    if (!isSeededPrefix(seed, seed.length, true)) {
      throw new Error('fork 种子不合法（isSeededPrefix 断言失败——实现回归，不应触达）');
    }

    // —— 物理腿：同步落库（返回 id 必可读——不返回幻影 id）+ 驱动构造 ——
    const forkedLog = this.persistence.createSeededSession(seed, {
      origin: 'fork',
      parentId: sourceSessionId,
      ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
    });
    const opened = this.adopt(forkedLog, 'fork', false);
    return {
      status: 'forked',
      ...opened,
      lineage: { parentId: sourceSessionId, seedLength: seed.length, origin: 'fork' },
      firstAppendSeq: seed.length,
    };
  }

  /**
   * 会话内全文检索（05 §9 首发口径）：flush 屏障先行（write-behind 在飞事件
   * 不进 FTS 索引——检索前先落定）→ Store.searchSessionFts。
   * @returns 命中事件 seq 升序列表（limit 缺省 50）
   */
  async search(sessionId: string, pattern: string, limit?: number): Promise<number[]> {
    await this.persistence.flush();
    return this.persistence.searchSessionFts(sessionId, pattern, limit);
  }

  /** 已开判据（幂等 open 的外部可读面） */
  isOpen(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  /** 已开驱动读取（缺席 undefined——焦点编排归调用方） */
  driverOf(sessionId: string): ConversationDriver | undefined {
    return this.records.get(sessionId)?.driver;
  }

  /** 任一已开驱动在飞（宿主 busy 判据读面——scheduler GateFacts agentBusy 源，批 20c） */
  anyRunning(): boolean {
    for (const { driver } of this.records.values()) {
      if (driver.running) return true;
    }
    return false;
  }

  /** 全量拆解（进程收尾序）：逐驱动 dismantle（打断在飞 run）+ 清登记 */
  dispose(): void {
    for (const { driver } of this.records.values()) {
      driver.dismantle();
    }
    this.records.clear();
  }

  /** 登记 + 驱动构造 + 入册（create/open/fork 共尾；装配覆盖位仅 create 腿携带——resume 不回放） */
  private adopt(
    log: SessionLog,
    origin: SessionOrigin,
    resumed: boolean,
    overrides: {
      model?: string;
      systemPrompt?: string;
      shapeTools?: (tools: readonly AgentTool[]) => readonly AgentTool[];
      askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;
    } = {},
  ): OpenedSession {
    const driver = this.createDriver({
      session: log,
      origin,
      resumed,
      ...(overrides.model !== undefined ? { model: overrides.model } : {}),
      ...(overrides.systemPrompt !== undefined ? { systemPrompt: overrides.systemPrompt } : {}),
      ...(overrides.shapeTools !== undefined ? { shapeTools: overrides.shapeTools } : {}),
      ...(overrides.askApproval !== undefined ? { askApproval: overrides.askApproval } : {}),
    });
    this.records.set(log.sessionId, { driver, origin });
    return { sessionId: log.sessionId, driver, origin };
  }
}
