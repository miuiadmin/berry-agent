/**
 * obs — 契约面（03 §10.8 core:obs 件章；02 §4.1 席 #24）。
 *
 * 词面独立律：本件不 import persist 类型面重导出——三窄面（events/notify/
 * audience）以本件自有词面声明，结构兼容宿主真身（Store.queryEvents /
 * ctx.ui.notify / ctx.ui.hasAudience），装配批直传即可（compat 互证归
 * host 装配批）。obs deps = {contracts, persist}——persist 边只消费
 * openAuxDatabase 开库面，事件流经 ObsEventsFace 窄面注入。
 */
import type { SessionEvent } from '../contracts/index.js';

/* ---------------- 三窄面（装配注入缝） ---------------- */

/**
 * 事件流读面（结构兼容 Store.queryEvents——05 §3.4 原语的宿主面消费位；
 * 装配批直传 Store 实例）。obs 一切数据是 durable 事件流的派生物。
 */
export interface ObsEventsFace {
  /** 跨会话事件查询（过滤维 + 游标分页；签名与 Store.queryEvents 同构） */
  queryEvents(filter: {
    readonly sessionId?: string;
    readonly types?: readonly string[];
    readonly sinceMs?: number;
    readonly untilMs?: number;
    readonly fromSeq?: number;
    readonly toSeq?: number;
    readonly limit?: number;
    readonly cursor?: string | null;
  }): { readonly events: SessionEvent[]; readonly nextCursor: string | null };
}

/** 通知面（结构兼容 ctx.ui.notify——告警「只通知不执法」的唯一出口） */
export interface ObsNotifyFace {
  /** 一次性通知（level 三档子集——success 档与告警语义无关不收） */
  notify(message: string, opts?: { level?: 'info' | 'warn' | 'error' }): void;
}

/** 观众探针面（结构兼容 ctx.ui.hasAudience——无观众跳过评估且不耗冷却） */
export interface ObsAudienceFace {
  /** 本刻是否有观众（false = 告警评估整跳） */
  hasAudience(): boolean;
}

/* ---------------- 告警规则族 ---------------- */

/**
 * 告警规则（mount config 键 `alerts` 数组元素；v1 单规则）。
 * 执法禁律（03 §10.8）：告警路径只 notify——不 block、不 interrupt、
 * 不写 durable、不改任何闸门。
 */
export interface ObsAlertRule {
  /** 规则种（v1 单值——判别位，扩规则族不改消费面形状） */
  readonly kind: 'token_spend_hourly';
  /** 当前小时主计费桶（input+output；cache 桶不进阈值）超阈即告警 */
  readonly thresholdTokens: number;
  /** 冷却窗毫秒（缺省 1h——与规则小时粒度对齐；窗内抑制不重复通知） */
  readonly cooldownMs?: number;
}

/* ---------------- 查询面 ---------------- */

/** obs_query 输入（granularity 必填、其余可选过滤） */
export interface ObsQueryInput {
  /** 粒度：小时桶 / 日桶（闭日物化） */
  readonly granularity: 'hour' | 'day';
  /** 指标：事件计数（缺省）/ llm 用量聚合 */
  readonly metric?: 'events' | 'usage';
  /** 窗口下界（epoch ms 含；缺省无下界） */
  readonly from?: number;
  /** 窗口上界（epoch ms 含；缺省无上界） */
  readonly to?: number;
  /** 事件类型过滤（仅 metric='events' 有效）：精确匹配或尾通配 <族前缀>/* 一形（03 §10.8 RP5） */
  readonly eventType?: string;
  /** 行上限（缺省 100、硬帽 1000） */
  readonly limit?: number;
}

/** 事件计数行（metric='events'） */
export interface ObsEventsRow {
  /** 桶起点（UTC 整点/整日对齐——epoch ms） */
  readonly bucket: number;
  /** durable 事件类型 */
  readonly eventType: string;
  /** 桶内事件数 */
  readonly count: number;
}

/**
 * 用量聚合行（metric='usage'；token 原始值聚合——货币折算在呈现投影做，
 * 本面不折算）。主计费桶 input+output 与 cache 桶分列（04 §5 预算闸门口径）。
 */
export interface ObsUsageRow {
  /** 桶起点（UTC 整点/整日对齐——epoch ms） */
  readonly bucket: number;
  /** llm/usage 事件数 */
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** cacheWrite 中 1h 保留子集（未上报聚合为 0） */
  readonly cacheWrite1h: number;
  /** 推理 token 子集（未上报聚合为 0；已含于 output） */
  readonly reasoning: number;
  /**
   * 缓存命中率派生列（cache 经济批 RP5——查询期派生零 rollup 列）：
   * `cacheRead / (input + cacheRead + cacheWrite)` 桶内聚合比值（非均值）；
   * null = 分母零守卫（桶内无 token 流——诚实缺席非 0%）。
   */
  readonly hitRate: number | null;
}

/** 查询结果行二态 */
export type ObsQueryRow = ObsEventsRow | ObsUsageRow;

/* ---------------- 服务面 ---------------- */

/** obs 服务句柄（装配批持；dispose 幂等） */
export interface ObsService {
  /**
   * 增量摄取 + 闭日物化 + 告警评估（单入口编舞——自驱 interval 与手动
   * 调用同路径）。脏桶整体重算幂等（03 §10.8：水位−1h 重叠窗）。
   */
  refresh(): void;
  /** 只读聚合查询（坏行 fail-loud = OBS_ROLLUP_CORRUPT） */
  query(input: ObsQueryInput): readonly ObsQueryRow[];
  /** 注销：停 interval + 关库；再调 refresh/query 拒（fail-loud） */
  dispose(): void;
}

/** createObsService 依赖注入面（全缝可注入——测试零真网络零真挂钟） */
export interface ObsServiceDeps {
  /** rollup 自管库文件路径（`<dataDir>/data/obs/rollup.db`——装配面算好） */
  readonly dbPath: string;
  /** 事件流读面（结构兼容 Store——装配批直传） */
  readonly events: ObsEventsFace;
  /** 通知面（装配批接 ctx.ui.notify） */
  readonly notify: ObsNotifyFace;
  /** 观众探针面（装配批接 ctx.ui.hasAudience） */
  readonly audience: ObsAudienceFace;
  /** 告警规则（缺省空 = 告警面在场而静默——诚实缺省） */
  readonly alerts?: readonly ObsAlertRule[];
  /** 自驱 interval 毫秒（缺省 60s；0 = 不自驱——测试手动驱动） */
  readonly refreshMs?: number;
  /** 时间注入（缺省 Date.now——测试假钟） */
  readonly clock?: () => number;
  /** 告警面（开库/WAL 降级等——缺省 console.error） */
  readonly warn?: (message: string) => void;
}

/* ---------------- 会话维（03 §10.8 会话维扩展——e-2 观测腿） ---------------- */

/**
 * 会话行读面（结构兼容 Store 的 getSessionRow——装配批直传 Store 实例；
 * 词面独立律：本件不 import persist 类型面，ObsSessionRow 为结构子集自
 * 有词面，宿主真身含更多字段可赋）。会话维树判定（parent_id 链）与元
 * 数据（updatedAt）的数据源。
 */
export interface ObsSessionsFace {
  /** 单会话行读（缺席 = undefined——零事件新会话/不存在的 id） */
  getSessionRow(sessionId: string): ObsSessionRow | undefined;
}

/** 会话行形态（persist SessionRow 的结构子集——obs 消费面最小词面） */
export interface ObsSessionRow {
  readonly id: string;
  readonly title: string | undefined;
  /** 血缘形态（五值闭集词面以 contracts SessionOrigin 为源——obs 侧透传字符串） */
  readonly origin: string;
  /** 血缘父会话（根会话 = undefined） */
  readonly parentId: string | undefined;
  /** 行末次更新毫秒（事件写批推进） */
  readonly updatedAt: number;
  /** 该会话事件流最高 seq（与事件行同批推进——尾条推导的精确定位键） */
  readonly lastSeq: number;
}

/**
 * 进程内会话记录面（结构兼容宿主 SessionManager records 投影——装配批
 * 构造闭包）。session_list 的数据面锚 = 进程内在管会话（03 §10.8 原句
 * 「进程内会话清单」——活会话枚举不从 durable 全史回放）。
 */
export interface ObsLiveSessionsFace {
  /** 进程内在管会话清单（装配侧帽 100——防御帽，03 §10.8 e-2 定形注） */
  listActive(): readonly ObsLiveSessionInfo[];
}

/** 进程内会话记录项（零事件新会话 durable 行缺席时的 origin 兜底源） */
export interface ObsLiveSessionInfo {
  readonly sessionId: string;
  readonly origin: string;
}

/** 在飞粗状态四态（尾条推导——03 §10.8 e-2 定形注映射表单源 + u-1 定形注 paused 第四值〔u-3 落码〕） */
export type SessionLiveState = 'idle' | 'running' | 'waiting-approval' | 'paused';

/** session_list 行（进程内清单 × durable 行元数据 join + 尾条推导） */
export interface SessionSummaryRow {
  readonly id: string;
  readonly title: string | undefined;
  readonly origin: string;
  readonly parentId: string | undefined;
  /** 在飞粗状态（尾条推导） */
  readonly live: SessionLiveState;
  /** 近次请求模型（最后一条 request/header 的 config.model——缺席 undefined） */
  readonly model: string | undefined;
  readonly updatedAt: number;
}

/** session_read / session_trace 尾窗行（呈现摘要——data 不整吐） */
export interface SessionTailItem {
  readonly seq: number;
  readonly time: number;
  readonly type: string;
  /** 单行呈现摘要（事件型感知提取；文本截断帽 200 字符） */
  readonly summary: string;
}

/** session_read 结果（尾窗 + 目标在场性——「查无此档」不冒充「空档案」） */
export interface SessionTailWindow {
  /** 目标会话行是否在场（进程内 ∪ durable 任一在场即 true） */
  readonly exists: boolean;
  readonly items: readonly SessionTailItem[];
}

/** session_trace 报告（在飞会话当前进行态） */
export interface SessionTraceReport {
  readonly sessionId: string;
  readonly exists: boolean;
  readonly live: SessionLiveState;
  /** 当前回合尾窗（定值 20 条——03 §10.8 e-2 定形注） */
  readonly recent: readonly SessionTailItem[];
  /** 在飞工具名清单（尾窗内未闭合的 tool/call——name@seq） */
  readonly inflightTools: readonly string[];
}

/** session_status 自身坐标（「我是谁在哪」——e-3 并入工具清单/能力自省） */
export interface SessionSelfStatus {
  readonly sessionId: string;
  readonly origin: string;
  readonly parentId: string | undefined;
  /** 工作区根（装配注入取值器；缺席 = undefined——无工作区会话） */
  readonly workspaceRoot: string | undefined;
  readonly live: SessionLiveState;
  readonly model: string | undefined;
}

/**
 * 工具清单行（e-3 工具面自省——模型侧「我现在有哪些工具」；普查候选 E
 * D3 缺缝①的只读查询面）。name 单列 v1：描述已在工具 schema 面向模型，
 * 本查询的价值 = 确认**整形后有效可见集**（子代理派生面白名单后）。
 */
export interface SessionToolListingEntry {
  readonly name: string;
}

/**
 * 能力门态行（e-3 能力自省快照 + 诊断 reason——普查候选 E / letta system/init
 * 握手快照对位）。open 状态面 + 闭门 reason（门检 verdict message 同源——
 * 查询面预演拒绝理由，openclaw 诊断 reason 代数对位）+ scope（该门统摄的
 * 模型面语义描述——负面能力声明文案的锚）。
 */
export interface SessionDoorStateEntry {
  /** 高危面名（03 §4.6——USER_GRANTABLE_CAPABILITIES 值域） */
  readonly capability: string;
  /** 门态（按调用方开门集裁决） */
  readonly open: boolean;
  /** 闭门诊断 reason（缺席 = 装配侧未供——呈现退「未开门」） */
  readonly reason?: string;
  /** 该门统摄的模型面语义描述（负面声明文案锚——如「跨树会话枚举与读取」） */
  readonly scope: string;
}

/**
 * 工具策略表条目行（ap-3 第四段——纯数据面：obs 零 safety 依赖，条目形状
 * 经此窄面转录；六字段同 ToolPolicyEntry 结构但独立声明〔DAG 边表不变——
 * obs 不 import safety〕）。
 */
export interface SessionToolPolicyEntry {
  /** 条目序（表内 0 基序——命中标注 policy-<decision>:<序> 同源） */
  readonly index: number;
  readonly tool: string;
  readonly pattern?: string;
  readonly effect?: string;
  readonly decision: 'allow' | 'deny';
  readonly reason?: string;
  readonly expiresAt?: number;
}

/**
 * 工具策略快照（ap-3 session_status 第四段数据源——装配期快照诚实〔非活体
 * 读〕；dryRun = 整名族干跑裁决闭包，由 host 侧注入〔matchToolPolicy 同源
 * ——obs 零 safety 依赖〕）。
 */
export interface SessionToolPolicySnapshot {
  /** 装配期载入的条目快照（含序） */
  readonly entries: readonly SessionToolPolicyEntry[];
  /** 载体文件路径（呈现注明——与 /approval entries 活体面分立的时点证据） */
  readonly path: string;
  /**
   * 整名族干跑（无实参依赖条目——fs/bash 族条目命中依赖调用实参恒 miss，
   * 不参与本面〔呈现为计数注记〕）：返 undefined = 无命中。
   */
  readonly dryRun: (
    tool: string,
    effect: 'read' | 'write' | 'exec',
  ) => { readonly decision: 'allow' | 'deny'; readonly index: number } | undefined;
}

/**
 * session_status 环境自感面（e-3——工具面/能力自省只读 + 负面能力声明文案
 * 的数据源；装配根 per-session 注入，缺席 = 基础坐标档诚实降级不虚构）。
 * 与 SessionView 分立：会话坐标/血缘是 durable 派生（视图服务），工具清单/
 * 门态是装配现场事实（非 durable——经此窄面注入保持 obs 件零装配知识）。
 */
export interface SessionEnvFace {
  /** 可用工具清单（整形后面快照——本会话模型可见有效集） */
  readonly listTools: () => readonly SessionToolListingEntry[];
  /** 能力门态快照（模型道可达的门面——v1 观测门一枚，操控门随 e-4 扩） */
  readonly doorStates: () => readonly SessionDoorStateEntry[];
  /**
   * 工具策略快照（ap-3 第四段——缺席 = 段不呈现，与 doorStates 同缺席
   * 语义；装配期快照 + 整名族干跑闭包）。
   */
  readonly toolPolicy?: () => SessionToolPolicySnapshot | undefined;
}

/**
 * 会话维视图服务（03 §10.8 会话维扩展——纯派生读面，零自管库零状态：
 * 一切数据经 deps 三窄面注入，尾条推导 + 树判定单源）。dispose 无义——
 * 无资源可释（与 rollup ObsService 分立，装载归装配批）。
 */
export interface SessionView {
  /** session_list 数据面（进程内记录为锚） */
  listSessions(): readonly SessionSummaryRow[];
  /** session_read 数据面（尾部窗口有帽有界） */
  readTail(sessionId: string, opts?: { readonly limit?: number }): SessionTailWindow;
  /** session_trace 数据面（在飞进行态尾窗） */
  trace(sessionId: string): SessionTraceReport;
  /** session_status 数据面（自身坐标） */
  selfStatus(sessionId: string): SessionSelfStatus;
  /**
   * 树内判定单源（03 §10.8 可见性分轴——e-2 定形：parent_id 链同根即同
   * 树；self 特例天然含。链断/超帽/行缺席 = 不可判 = false（fail-closed
   * 跨树——「不可判 = 跨树」既有句的细则兑现））。
   */
  isSameTree(a: string, b: string): boolean;
}

/** createSessionView 依赖注入面（装配/测试同构——零真库零真挂钟） */
export interface SessionViewDeps {
  /** 事件流读面（尾条推导/尾窗读——结构兼容 Store.queryEvents） */
  readonly events: ObsEventsFace;
  /** 会话行读面（树判定/元数据） */
  readonly sessions: ObsSessionsFace;
  /** 进程内记录面（session_list 锚） */
  readonly liveSessions: ObsLiveSessionsFace;
  /** 工作区根取值器（selfStatus 呈现；缺省 undefined——无工作区态） */
  readonly workspaceRoot?: () => string | undefined;
}
