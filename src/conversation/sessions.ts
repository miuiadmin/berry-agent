/**
 * SessionManager——多会话编排面（02 §2.3「多会话单焦点」/ 03 §2.2 能力面表
 * ctx.sessions 注记 / 05 §5 fork 编排 + §9 会话内 FTS 首发口径）。
 *
 * 职责 = drivers 登记表（单焦点幂等：同 id 重复 open 回同一活体驱动）+ 六动词：
 *  - list：会话列表透传（workspaceRoot / limit 选取面——「按 cwd 取最新会话」）；
 *  - create：新开（origin 缺省 'conversation'）+ 驱动构造；
 *  - open：resume——装载日志 → closer 合成（05 §4「合成归调用方」条款的消费
 *    位：recoverClosers 草稿经 appendSynthetic 收形，合成物同权入日志）→
 *    驱动构造（resumed 形——批 11d 冷启动续接的先手位）；
 *  - fork：种子编排（05 §5.0/§5.2）——内存种子组装（forkPrefix 前缀拷贝 +
 *    end-seed 字面尾事件，源日志零污染——05 §5.0 落码裁决注记）+ isSeededPrefix
 *    断言 + createSeededSession 同步落库（不返回幻影 id）+ session_before_fork
 *    钩子（03 主表：waterfall 可否决——否决走联合回执不造新错误码）+ 洪水闸
 *    （05 §5.1 fork 位对齐条款——veto 判后 acquire，超限 SESSION_SPAWN_RATE_LIMIT）；
 *  - search：flush 屏障先行（write-behind 在飞事件不进 FTS 索引）+ 会话内
 *    全文检索（05 §9 首发：session_id 限定）；
 *  - delete：删除编排（05 §2.5 会话删除编排定形注②——六步单源：busy 守卫
 *    → channels 收口 → 登记拆除 → 物理三删 → 授予回收 → 焦点处置；回执
 *    三态 deleted/busy/missing）。
 *
 * 事实源纪律：源会话已 open 时 fork 直接取**活体 SessionLog** 的事件流（内存态
 * 最新鲜）；未 open 才 loadSession——避免同 id 双附着制造第二事实源（读侧以
 * 先开者为准）。驱动构造经注入工厂（createDriver——streamFn/convertToLlm 等
 * 装配注入族归 host 装配根闭包，本件不持 LLM 边界任何依赖）。
 */
import { BaseError } from '../contracts/index.js';
import type { EventDispatch } from '../context/index.js';
import type {
  AgentTool,
  ApprovalAskAnswer,
  ApprovalAskRequest,
  SessionOrigin,
  ToolDefinition,
} from '../contracts/index.js';
import type { Persistence, SessionRow } from '../persist/index.js';
import { forkPrefix, isSeededPrefix, recoverClosers, SessionSpawnLimiter } from '../session/index.js';
import type { SessionLog } from '../session/index.js';
import type { AgentEventSink } from '../agent/index.js';
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
  /**
   * 会话维追加工具面（成熟度缺口 #5——issue 起会腿消费位）：ToolDefinition
   * 清单经会话装配并入 open 域管道注册位（真三段管道——守门/审计/消毒与
   * 驱动层同律，零旁路）。纯内存载体同 model 律：不进 durable 行、open/resume
   * 不携带；缺省 = 无追加。与 shapeTools 分立两通道：shapeTools 整形**既有**
   * 面、extraTools 追加**新**面（追加位经管道注册非直拼 AgentTool——插件
   * 工具定义无执行器自装路径）。
   */
  readonly extraTools?: () => readonly ToolDefinition[];
  /**
   * 会话活体事件外部汇（07 §4.1 V-0 注①供数链——子代理重试计数供数桥）：
   * 在场时驱动 onEvent 组合（channels.emit 先 + 本汇尾调——实现方见
   * conversation-stack createDriver）；纯内存载体同 model 律：不进 durable、
   * open/resume 不携带。
   */
  readonly onEvent?: AgentEventSink;
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

/**
 * 删除回执三态（05 §2.5 会话删除编排定形注②——编排真身 = 本管理器删除动词）：
 *  - `deleted`——编排六步全成（busy 守卫过 → 收口 → 登记拆除 → 物理三删 →
 *    授予回收 → 焦点处置）；
 *  - `busy`——在飞 run 拒删（强删必撕裂在飞写笔——回执指路等待或先打断归
 *    呈现面路由）；
 *  - `missing`——物理删步缺席诚实拒（行不在库）。
 * 与呈现契约面 UiSessionDeleteResult 结构同构（contracts 不依赖 conversation
 * 是分层刻意的——RenameSessionResult 自持律同族）。
 */
export type DeleteSessionResult =
  { readonly status: 'deleted' } | { readonly status: 'busy' } | { readonly status: 'missing' };

/** SessionManager 构造面 */
export interface SessionManagerOptions {
  readonly persistence: Persistence;
  readonly dispatch: EventDispatch;
  readonly createDriver: DriverFactory;
  /**
   * 单会话收口观察 seam（宿主内部 DI 位——非插件可见 API；2026-09-13 复盘
   * 发现 ⑯）：retire 成功路（dismantle + 摘登记后）恰一笔发射；观察者异常
   * 吞隔离不回卷收口序。消费位 = 装配根订阅面穿线（memory 件简报冻结缓存
   * 收口摘除——会话收口后复续首物化重冻结取新值，不困旧冻结）。
   */
  readonly onRetired?: (sessionId: string) => void;
  /**
   * 会话关闭收口 seam（六役 CL-C ④——04 §10 closeOwner 段消费位接线）：
   * 会话终态收口序（retire 成功路 + dispose 全量拆解路——涉及单会话拆除的
   * 位）逐会话发射、携会话 id；观察者异常吞隔离不回卷收口序。与 onRetired
   * 分立：彼只走 retire 路（发现 ⑯ 冻结缓存语义不动），此两路同发（Job
   * 归属围栏「宿主位两路同源」——插件卸载 closer + 会话 dispose）。
   * 消费位 = 装配根注入 () => void jobs.closeOwner(sessionId) 形闭包
   * （owner = 会话 id 形的收口执法位）；缺席 = 零行为（测试替身形）。
   */
  readonly onSessionClosed?: (sessionId: string) => void;
  /**
   * 删除编排 seam①（05 §2.5 定形注②——channels 收口步）：编排第②步发射
   * （busy 守卫之后、登记拆除之前——守卫先于收口不可倒）。装配位接
   * channels.unregisterSession（提问队列收口 + widget 清空）。缺席 = 零动作
   * （缺席会话 / 测试替身形）；观察者异常吞隔离不回卷编排序。
   */
  readonly onSessionChannelsClosed?: (sessionId: string) => void;
  /**
   * 删除编排 seam②（05 §2.5 定形注②——授予回收步）：物理删成功后发射。
   * 装配位接 WorktreeService.releaseSession（槽缺席跳过）。缺席 = 零动作；
   * 异常吞隔离同上。
   */
  readonly onSessionGrantsReleased?: (sessionId: string) => void;
  /**
   * 删除编排 seam③（05 §2.5 定形注②——焦点处置步）：物理删 + 授予回收后
   * 发射，携被删会话工作区锚（在册活体镜像优先，未 open 会话读库行；两皆
   * 缺席 = undefined）。装配位判聚焦态：删聚焦会话 → openStartupSession 缺省
   * 策略复用（cwd = 被删会话工作区锚——归一根最新续接 / 无则新建）；删非
   * 聚焦焦点不动（判定归装配闭包——本件不持焦点态，02 §2.3）。缺席 = 零动作。
   */
  readonly onFocusCleared?: (sessionId: string, workspaceRoot?: string) => void;
  /**
   * 洪水闸注入位（05 §5.1 洪水闸 fork 位对齐条款——2026-10-07 装配批）：
   * fork 新建限速器（SessionSpawnLimiter 纯进程态滑动窗——防失控脚本以
   * fork 洪水填库；长驻进程限速语义在 manager 位——一处闸位辖进程全部
   * fork 新建）。缺省新例（100/分钟）；测试假钟注入位。create 动词不辖
   * （限流对象是「批量复制形新建」fork/import 两形——正常起话不在射程）。
   */
  readonly spawnLimiter?: SessionSpawnLimiter;
}

/**
 * 多会话管理器（进程级单例——Persistence 同生命周期；02 §2.3 多会话单焦点：
 * 并存多枚驱动、焦点唯 caller 视角，本件不持焦点态）。
 */
export class SessionManager {
  private readonly persistence: Persistence;
  private readonly dispatch: EventDispatch;
  private readonly createDriver: DriverFactory;
  /** 单会话收口观察位（构造面注入——缺省无观察） */
  private readonly onRetired?: (sessionId: string) => void;
  /** 会话关闭收口位（构造面注入——六役 CL-C ④；缺省零行为） */
  private readonly onSessionClosed?: (sessionId: string) => void;
  /** 删除编排 seam①（channels 收口——05 §2.5 定形注②；缺省零动作） */
  private readonly onSessionChannelsClosed?: (sessionId: string) => void;
  /** 删除编排 seam②（授予回收——05 §2.5 定形注②；缺省零动作） */
  private readonly onSessionGrantsReleased?: (sessionId: string) => void;
  /** 删除编排 seam③（焦点处置——05 §2.5 定形注②；携被删会话工作区锚；缺省零动作） */
  private readonly onFocusCleared?: (sessionId: string, workspaceRoot?: string) => void;
  /** 洪水闸（fork 新建限速——05 §5.1 fork 位对齐条款；缺省新例） */
  private readonly spawnLimiter: SessionSpawnLimiter;
  /** 已开会话登记（sessionId → 驱动 + 血缘形态 + 工作区锚活体镜像——幂等 open 的判据面；锚自日志登记值 adopt 时入册，03 §10.7「锚不能走库读」律） */
  private readonly records = new Map<
    string,
    { driver: ConversationDriver; origin: SessionOrigin; workspaceRoot?: string }
  >();
  /**
   * 停机 drain 窗封印位（六役停机窗补钉——02 §5.3 SESSION_MANAGER_DISPOSED）：
   * dispose 置位后 create/fork 拒。原「closer 序先 dispose 会话管理器、自持钟后停」
   * 的窗口内 scheduler tick 可在已 dispose 管理器上重造驱动——本位为该缺陷的
   * 管理器边界防线（abort 即停自持钟是第一道，04 §1 退出序同批补钉）。
   */
  private disposed = false;

  constructor(options: SessionManagerOptions) {
    this.persistence = options.persistence;
    this.dispatch = options.dispatch;
    this.createDriver = options.createDriver;
    this.onRetired = options.onRetired;
    this.onSessionClosed = options.onSessionClosed;
    this.onSessionChannelsClosed = options.onSessionChannelsClosed;
    this.onSessionGrantsReleased = options.onSessionGrantsReleased;
    this.onFocusCleared = options.onFocusCleared;
    // 洪水闸（05 §5.1 fork 位对齐条款）：缺省新例——长驻 host 进程内管理器
    // 唯一，缺省实例即进程级单账本（CLI 短命进程形同恒过——与 import 位弱化
    // 披露同族）；测试经注入位换假钟小帽例
    this.spawnLimiter = options.spawnLimiter ?? new SessionSpawnLimiter();
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

  /** 会话全量计数（B2 截断披露单源——list 默认 100 窗，超窗披露的总数真源） */
  countSessions(): number {
    return this.persistence.countSessions();
  }

  /**
   * 单会话锚读面（03 §10.7 会话锚源律的消费位——委派子会话「子承父锚」
   * 取父锚用）：**活体面**——createSession 零 I/O（行首事件才落库），起会时
   * 库中行尚不可见、锚不能走库读（SessionLog.workspaceRoot 活体载体律）；
   * 故锚自 adopt 时随日志登记值入册。未在册（未开/已 retire/未知 id）与
   * 缺席 id（无父委派形）均诚实 undefined——回落栈级锚由调用方编排。
   */
  workspaceRootOf(sessionId: string | undefined): string | undefined {
    return sessionId !== undefined ? this.records.get(sessionId)?.workspaceRoot : undefined;
  }

  /** 新开会话（origin 缺省普通对话；model/systemPrompt/shapeTools/askApproval/extraTools/onEvent 为本会话装配覆盖——纯内存载体，批 19c-1 子代理通道同 model 律） */
  create(
    init: {
      origin?: SessionOrigin;
      workspaceRoot?: string;
      title?: string;
      model?: string;
      systemPrompt?: string;
      shapeTools?: (tools: readonly AgentTool[]) => readonly AgentTool[];
      askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;
      extraTools?: () => readonly ToolDefinition[];
      onEvent?: AgentEventSink;
    } = {},
  ): OpenedSession {
    // 封印位首查（六役停机窗补钉——02 §5.3）：dispose 后 create 响亮拒不静默
    // 重造驱动（drain 窗内 tick 防线——封印面 = create/fork 两动词〔铸新
    // 会话全动词〕，open/resume durable 复续照旧不受辖）
    if (this.disposed) {
      throw new BaseError(
        'SESSION_MANAGER_DISPOSED',
        '会话管理器已 dispose——create 拒（停机 drain 窗封印位，02 §5.3 六役停机窗批）',
      );
    }
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
   * @throws SESSION_MANAGER_DISPOSED（dispose 后拒——封印面辖铸新会话两动词，
   * durable 源在场亦拒；六役挂账收口批 02 §5.3 / 04 §1）
   * @throws SESSION_SPAWN_RATE_LIMIT（洪水闸超限——veto 判后 acquire、vetoed
   * 不占名额；05 §5.1 fork 位对齐条款，2026-10-07 装配批）
   */
  async fork(sourceSessionId: string, options: { upToSeq?: number; title?: string } = {}): Promise<ForkOutcome> {
    // 封印位首查（六役挂账收口——02 §5.3 / 04 §1）：dispose 后 fork 响亮拒不
    // 静默铸新会话（drain 窗防线——封印面 = create/fork 两动词〔铸新会话全
    // 动词〕；durable 源在场亦拒——fork 走 loadSession 重载仍系铸新，与
    // create 同一 drain 窗向量）
    if (this.disposed) {
      throw new BaseError(
        'SESSION_MANAGER_DISPOSED',
        '会话管理器已 dispose——fork 拒（停机 drain 窗封印位，02 §5.3 六役挂账收口批）',
      );
    }
    // —— 事实源选择：活体优先（双事实源纪律——未 open 才 loadSession）——
    const live = this.records.get(sourceSessionId);
    let sourceLog: SessionLog;
    let workspaceRoot: string | undefined;
    if (live !== undefined) {
      sourceLog = live.driver.session;
      // workspaceRoot 直读 records 活体镜像（adopt 入册值——与 workspaceRootOf
      // 同源零时差）。禁走 listSessions 行反查：默认 limit=100 截断窗 + 零 append
      // 活体（createSession 零 I/O 行未落库）双形态下反查落空恒 undefined，
      // 子会话静默丢工作区锚（03 §10.7「锚不能走库读」律）
      workspaceRoot = live.workspaceRoot;
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

    // 封印复查位（02 §5.3 封印不变式 + TOCTOU 复查位——await 窗让出宏任务：
    // 入口查不复核则窗内 dispose 后仍铸新会话回填已清空 records；复查过才
    // acquire/铸新。与入口查同码同文案形——vetoed 短路在前不受辖〔零新建
    // 无 TOCTOU 向量〕）
    if (this.disposed) {
      throw new BaseError(
        'SESSION_MANAGER_DISPOSED',
        '会话管理器已 dispose——fork 拒（停机 drain 窗封印位，02 §5.3 六役挂账收口批）',
      );
    }

    // —— 洪水闸（05 §5.1 fork 位对齐条款——veto 判后、种子组装前 acquire：
    // vetoed 的 fork 不新建故不占名额〔真要新建才记账〕；超限抛
    // SESSION_SPAWN_RATE_LIMIT 既有码，调用方按 BaseError 呈现族折报〔CLI
    // fork 动词 catch message 退 1 既有形〕；闸辖请求非辖成败——记账后遭
    // 物理层拒形名额已占系诚实现象）——
    this.spawnLimiter.acquire();

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

  /**
   * 目标会话在场判定（进程内在管 ∪ durable 行——e-4 操控轴幽灵守卫判据位，
   * 03 §2.2 第十一面：三动词共同前置「目标 id 无对应行拒
   * SESSION_TARGET_NOT_FOUND」）。零副作用：不 attach、不合成 closer、
   * 不构造驱动。
   */
  exists(sessionId: string): boolean {
    return this.records.has(sessionId) || this.persistence.hasSession(sessionId);
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

  /**
   * 已开会话清单投影（e-2 观测腿——宿主 SessionView deps.liveSessions 消费位；
   * 结构兼容 obs ObsLiveSessionsFace）。只含进程内在管（durable 未开不在场——
   * 会话维清单语义 = 进程内活体会话，历史会话归持久层 list）。
   */
  listActive(): readonly { sessionId: string; origin: SessionOrigin }[] {
    return [...this.records.entries()].map(([sessionId, { origin }]) => ({ sessionId, origin }));
  }

  /**
   * 全量拆解（进程收尾序）：逐驱动 dismantle（打断在飞 run）+ 清登记 +
   * 置封印位（六役停机窗补钉——02 §5.3：此后 create/fork 两动词拒
   * SESSION_MANAGER_DISPOSED，drain 窗内不得重造驱动）。封印置位在拆解前——fail-closed：
   * 拆解中途（任一驱动 teardown 异常）亦不再受理新会话。逐会话拆除位发射
   * onSessionClosed（六役 CL-C ④——与 retire 路两路同源；已 retire 会话不在
   * 册不重复发射）。观察者异常吞隔离不回卷拆解序。幂等——重复 dispose
   * 无害（空登记零动作、封印位重置同值）。
   */
  dispose(): void {
    this.disposed = true; // 封印先置（fail-closed——拆解异常亦不再起会话）
    for (const [sessionId, { driver }] of this.records) {
      driver.dismantle();
      try {
        this.onSessionClosed?.(sessionId);
      } catch {
        /* 收口观察异常不回卷拆解序（发射位随逐会话拆除） */
      }
    }
    this.records.clear();
  }

  /**
   * 单会话收口（run 生命周期收口——05 §7 retire 律 / 04 §12 第 5 律）：驱动
   * dismantle（终态停摆——打断在飞 run，dispose 同律）+ 摘活体登记。幂等——
   * 不在册回 false 零副作用（dispose 后再 retire / 重复收口均无害）。
   *
   * 与 dispose 分立：彼系进程收尾序全量拆解，此系单条无头编排会话的终态
   * 收口（tick 用户行 / subagent 子会话 / issue headless 会话三消费位——
   * 19c-1 头注「活体登记回收挂账」的销账动词）。durable 面不受影响：日志
   * 仍可查、open 可复续（幂等 open 对已摘行重造活体）。会话复用形（goal
   * 绑定会话——广播唤醒依赖活体登记）不走此收口。
   */
  retire(sessionId: string): boolean {
    const record = this.records.get(sessionId);
    if (record === undefined) return false;
    record.driver.dismantle();
    this.records.delete(sessionId);
    // 收口观察 seam：主流程（dismantle + 摘登记）已成——观察者异常吞隔离
    // 不回卷收口序（观察位当前 = 冻结缓存摘除〔Map.delete 不抛〕，防御位
    // 留给未来观察者）
    try {
      this.onRetired?.(sessionId);
    } catch {
      /* 观察者异常不回卷收口序（发射序末位） */
    }
    // 会话关闭收口 seam（六役 CL-C ④——04 §10 closeOwner 段）：retire 路与
    // dispose 路两路同发（宿主位两路同源）；独立 try 位——前位观察者炸不夺
    // 本位发射（Job 归属围栏收口是资源清理面非纯观察）
    try {
      this.onSessionClosed?.(sessionId);
    } catch {
      /* 收口观察异常不回卷收口序 */
    }
    return true;
  }

  /**
   * 删除会话（05 §2.5 会话删除编排定形注②——编排真身归本管理器会话生命
   * 周期域）：六步单源不可倒——
   *  ① busy 守卫：在飞 run 拒删（强删必撕裂在飞写笔——回执指路等待或先打断
   *     归呈现面路由；守卫先于收口不可倒）；
   *  ② channels 收口：onSessionChannelsClosed seam（装配位接
   *     unregisterSession——提问队列收口 + widget 清空；未知 id 幂等安全）；
   *  ③ 登记拆除：retire 复用（dismantle + 出册 + onRetired/onSessionClosed
   *     清账——open 的逆向；不在册返 false 零副作用覆盖未 open 会话形态）；
   *     在飞写排干由下一步物理删的 flush 先行承载（无另置排干屏障）；
   *  ④ 物理三删：persistence.deleteSession（flush 先行 + sessions/events/
   *     session_fts 三表删；缺席返 false → missing 诚实拒）；
   *  ⑤ 授予回收：onSessionGrantsReleased seam（worktree 槽缺席跳过归
   *     装配位；仅成功路触达）；
   *  ⑥ 焦点处置：onFocusCleared seam（删聚焦 → openStartupSession 缺省
   *     策略复用；删非聚焦焦点不动——判定归装配闭包，本件不持焦点态）。
   * ②⑤⑥ seam 观察者异常吞隔离不回卷编排序（deleteSession 不因收口面炸
   * 而半途停摆——物理删一旦完成即不可回卷）。
   */
  async deleteSession(sessionId: string): Promise<DeleteSessionResult> {
    // ① busy 守卫（首查位——在册且在飞即拒；未在册/未在飞直过）
    if (this.records.get(sessionId)?.driver.running === true) {
      return { status: 'busy' };
    }
    // 焦点处置输入捕获：被删会话工作区锚（在册活体镜像优先〔retire 前唯一
    // 时窗〕，未 open 会话读库行〔物理删前唯一时窗〕——两皆缺席 undefined）
    const workspaceRoot =
      this.records.get(sessionId)?.workspaceRoot ?? this.persistence.store.getSessionRow(sessionId)?.workspaceRoot;
    // ② channels 收口 seam（吞隔离——收口面异常不阻断后续拆除与物理删）
    try {
      this.onSessionChannelsClosed?.(sessionId);
    } catch {
      /* seam 观察者异常不回卷编排序 */
    }
    // ③ 登记拆除（retire 复用——幂等：不在册零副作用）
    this.retire(sessionId);
    // ④ 物理三删（flush 先行承载在飞写排干；缺席 → missing 诚实拒）
    const gone = await this.persistence.deleteSession(sessionId);
    if (!gone) {
      return { status: 'missing' };
    }
    // ⑤ 授予回收 seam（仅成功路触达——missing 时零发射）
    try {
      this.onSessionGrantsReleased?.(sessionId);
    } catch {
      /* seam 观察者异常不回卷编排序 */
    }
    // ⑥ 焦点处置 seam（删聚焦复焦归装配位判定；本件只保序）
    try {
      this.onFocusCleared?.(sessionId, workspaceRoot);
    } catch {
      /* seam 观察者异常不回卷编排序 */
    }
    return { status: 'deleted' };
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
      extraTools?: () => readonly ToolDefinition[];
      onEvent?: AgentEventSink;
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
      ...(overrides.extraTools !== undefined ? { extraTools: overrides.extraTools } : {}),
      ...(overrides.onEvent !== undefined ? { onEvent: overrides.onEvent } : {}),
    });
    // 锚活体镜像入册（workspaceRootOf 读面单源——日志登记值，非库行）
    this.records.set(log.sessionId, {
      driver,
      origin,
      ...(log.workspaceRoot !== undefined ? { workspaceRoot: log.workspaceRoot } : {}),
    });
    return { sessionId: log.sessionId, driver, origin };
  }
}
