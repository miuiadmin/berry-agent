/**
 * 会话事件信封与归因词汇类型（05 篇 §1.1 信封定稿 + §3.1 source 闭集定稿）。
 *
 * 本文件是 SessionEvent 形态的唯一权威——02 篇词汇表钉、05 篇 §1.1 重述，
 * 此处逐字段转录；LLM 消息/流/角色与工具/插件/子代理/Job 类型随对应模块
 * 落码批按 pi-ai 实形定义（contract-first：纵切批内先契约后实现）。
 */
import type { Usage } from './llm.js';

/**
 * 表面遮蔽指令（改历史的唯一合法形态——追加 replace 指令事件遮蔽旧区间，
 * 原文保留可审计）。区间 [start, end] 为被遮蔽事件的 seq 闭区间。
 */
export interface SurfaceOp {
  /** 指令形态——v1 唯一值 'replace'（词汇预留扩展） */
  op: 'replace';
  /** 被遮蔽区间起始 seq（含） */
  start: number;
  /** 被遮蔽区间结束 seq（含） */
  end: number;
}

/**
 * 会话事件信封：日志唯一条目形态（append-only，写入即冻结）。
 */
export interface SessionEvent<T = unknown> {
  /** 事件类型词汇（核心清单 events.ts + 插件显式注册扩展） */
  type: string;
  /** = 写入时 log.length，强制连续、0 起（只在尾部追加结构保证，无独立分配器） */
  seq: number;
  /** 毫秒时间戳；合成事件复用最后真实事件的 time（确定性——金样回放友好） */
  time: number;
  /** 已冻结的 JSON 快照（写入时单遍校验 + deepFreeze——从冻结快照读 = 免拷贝投影） */
  data: T;
  /** true = 读侧可以不认识此类型（向前兼容）；缺省 = 必须认识 */
  ignorable?: boolean;
  /** 遮蔽指令——仅改历史事件携带（§2 surfaceOp 协议） */
  surfaceOp?: SurfaceOp;
  /** 遮蔽溯源：被遮蔽节点 + 依据事件的完整 seq 列表 */
  sourceEventSeqs?: number[];
}

/**
 * user/message 的 source 归因词汇闭集（05 §3.1 表全列）：
 * 五字面量 ∪ 两前缀模板串。TS 模板字面量类型即闭集执法——已知前缀的
 * 任意后缀（`plugin:未来插件`）类型合法，语义按前缀行展开。
 */
export type EventSource =
  | 'user' // 真用户输入经缺省交互通道（TUI）
  | `channel:${string}` // 真用户输入经具名通道（webui 提交、CLI 管道喂入等）——投影同视 user
  | 'schedule' // 挂钟调度触发（scheduler 插件注入的到点输入）
  | 'subagent-settled' // 委派子会话结算回流
  | 'subagent-approval-pending' // background 委派子会话审批挂起通知（04 §10——UserMessage 注入位，纯信息位应答权钉死用户；2026-09-06 技术调研消化批增补、遗漏审计批回填）
  | 'compaction' // 压缩摘要载体（§2.1）
  | `plugin:${string}`; // 插件注入的受控输入（经受理制写面）——投影不视为用户话语

/** source 归一化种类（前缀型归并到 kind；字面量一一对应） */
export type EventSourceKind =
  'user' | 'channel' | 'schedule' | 'subagent-settled' | 'subagent-approval-pending' | 'compaction' | 'plugin';

/** parseEventSource 结果：归一化种类 + 原值 + 投影位判别 */
export interface ParsedEventSource {
  /** 归一化种类（未知字面量归 'user'——旧日志向前兼容按 user 同视） */
  kind: EventSourceKind;
  /** 原始字符串（审计保真） */
  raw: string;
  /**
   * 投影是否以用户话语位展开（05 §3.1「投影同视 user」判据）：
   * user/channel/schedule/subagent-settled = true（都是输入位，仅审计可辨入口）；
   * compaction/plugin = false（摘要载体与受控注入不视为用户话语——渲染与
   * 记忆提取归因区分显示）。
   */
  treatedAsUser: boolean;
}

/** 字面量五值 → 归一化种类映射（前缀型经 startsWith 归并） */
const LITERAL_SOURCE_KINDS: Readonly<Record<string, EventSourceKind>> = {
  user: 'user',
  schedule: 'schedule',
  'subagent-settled': 'subagent-settled',
  'subagent-approval-pending': 'subagent-approval-pending',
  compaction: 'compaction',
};

/**
 * 解析 source 归因字符串（闭集执法的读侧判据，05 §3.1）：
 *  - 已知前缀的未知后缀（如 'plugin:未来插件'）按前缀行语义展开；
 *  - 未知字面量（旧日志向前兼容）按 user 同视；
 *  - append 侧新值必须先扩闭集（类型 + 本函数）——写入纪律归 session 落码批。
 */
export function parseEventSource(source: string): ParsedEventSource {
  if (source.startsWith('channel:')) {
    return { kind: 'channel', raw: source, treatedAsUser: true };
  }
  if (source.startsWith('plugin:')) {
    return { kind: 'plugin', raw: source, treatedAsUser: false };
  }
  const literal = LITERAL_SOURCE_KINDS[source];
  if (literal) {
    // compaction 是摘要载体：不是人说的——投影位与 plugin 同判 false；
    // subagent-approval-pending 与 subagent-settled 同通道同型（04 §10
    // UserMessage 注入位）——投影同视用户话语
    const treatedAsUser =
      literal === 'user' ||
      literal === 'schedule' ||
      literal === 'subagent-settled' ||
      literal === 'subagent-approval-pending';
    return { kind: literal, raw: source, treatedAsUser };
  }
  // 未知字面量：旧日志向前兼容——按 user 同视（读侧宽容，append 侧严进）
  return { kind: 'user', raw: source, treatedAsUser: true };
}

/**
 * turn/end 的 reason 闭集（05 §1.1 表：completed / aborted / blocked / error /
 * max-tokens / interrupted，可扩展）。`(string & {})` 保留字面量自动补全的
 * 同时不拒扩展值——新增终态值属词汇演进，须先扩 05 篇表格。
 */
export type TurnEndReason =
  'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted' | (string & {});

/**
 * 会话血缘 origin 闭集（05 §5.1）：'conversation'（普通对话）/ 'delegation'
 * （委派子会话）/ 'import'（外部导入）/ 'fork'（显式 fork）/ 'trigger'（触发器
 * starter 起的无头会话——首 turn 非人触，2026-09-07 触发器面 C 批落码扩词；
 * 05 §9 sessions.origin 与 03 §2.4 session_start 载荷三处闭集同笔）。无插件
 * 域——会话直归 agent（05 §0 会话归属模型）。
 */
export type SessionOrigin = 'conversation' | 'delegation' | 'import' | 'fork' | 'trigger';

/** 血缘三元组（fork 动作的分层返回外层，05 §5.2；不返回幻影 id） */
export interface SessionLineage {
  /** 源会话 id（根会话 = undefined） */
  readonly parentId: string | undefined;
  /** 种子前缀长度（首条新 append 事件恰落此位，05 §5.2） */
  readonly seedLength: number;
  /** 血缘形态 */
  readonly origin: SessionOrigin;
}

/**
 * 重试进行态只读小面（04 §3.3 注记 seam——批 13a 落码位）：conversation 驱动
 * 重试循环的只读探针，SDK 线协议心跳载荷是该 seam 的**唯一线面出口**
 * （03 §10.6 线协议②：`retry <attempt>/<next>` 不可从事件流推导——活体层
 * 「重试续入零新事件型」维持不破；非事件型、不进 durable）。
 *
 * 归位 contracts：producer（conversation）与 consumer（channels SDK 通道
 * 后端）边表互不可达（02 §4.1），结构共享零 import 边——ApprovalAskRequest
 * 归位同款先例（批 11b）。
 */
export interface RetryProbe {
  /** 当前重试序（1 起——attempt 计数生命周期 = 单次 runTurns 调用） */
  readonly attempt: number;
  /** 名额上限（RetryPolicy.maxRetries 面——transient/overflow 各自分账） */
  readonly maxAttempts: number;
  /** 下次续入时间戳（epoch ms）；null = 不在退避等待（重试已续入/取消/耗尽） */
  readonly nextAt: number | null;
}

/* ---------------- 子代理与 Job 注册表（04 §10——批 15c 契约先行） ---------------- */

/**
 * 委派深度帽（04 §10 委派边界③）：根会话委派 = 深度 1；子代理再委派逐层 +1；
 * 超帽 3 拒（SUBAGENT_DEPTH_EXCEEDED——防自嵌套爆栈）。
 */
export const SUBAGENT_DEPTH_MAX = 3;

/**
 * SubagentProvider 能力协商面（04 §10——五布尔）：注册方声明，消费方
 * （委派机器/呈现面）据以决定可用形态（如 background=false 的 provider
 * 不受理后台收场）。in-process 真工厂五项恒真（独立装配全套）。
 */
export interface SubagentCapabilities {
  /** 子代理有自己的工具面（非纯文本模型） */
  readonly tools: boolean;
  /** 支持流式过程可见（父可观察中间输出） */
  readonly streaming: boolean;
  /** 支持协作取消（stop → stopping → killed） */
  readonly cancel: boolean;
  /** 支持后台收场（Job 注册表托管；one-shot-only provider 恒 false） */
  readonly background: boolean;
  /** 支持结构化输出（SubagentResult.structured 面） */
  readonly structuredOutput: boolean;
}

/**
 * 委派请求（04 §10：请求含 prompt、工具白名单、模型覆盖——其余为机器
 * 注入位，模型侧工具 schema 不暴露）。
 */
export interface SubagentRequest {
  /** 委派目标提示（子代理的唯一任务输入） */
  readonly prompt: string;
  /** 工具白名单（与 def 的 tools 交集执法——子代理可用面 ⊆ 交集） */
  readonly tools?: readonly string[];
  /** 模型覆盖（缺省回落宿主模型） */
  readonly model?: string;
  /** 子代理系统提示（声明式子代理正文直传；通用 agent 工具不设） */
  readonly systemPrompt?: string;
  /** 诊断名（Job 名与通知文案的显示位；缺省机器派生） */
  readonly name?: string;
  /** 机器注入位——父会话 id（background 结算通知路由） */
  readonly parentSessionId?: string;
  /** 机器注入位——收场形态（one-shot 缺省 / background 托管） */
  readonly background?: boolean;
  /** 机器注入位——委派深度（根 = 1；超帽拒——模型不可直设） */
  readonly depth?: number;
  /**
   * 机器注入位——审批挂起通知闭包（in-process 子栈审批闸的父路由）：
   * background 形注入（one-shot 不注入——挂着等待即知情）；实现方执法
   * 恰一条幂等（driver dedupeKey 面）。
   */
  readonly notifyApproval?: (info: { approvalId: string; toolName: string; reason?: string }) => Promise<unknown>;
  /**
   * 机器注入位——协作停止观察面（background 形注入）：JobHandle.stop()
   * 置 stopping 后本闭包变真；in-process 工厂据此桥子栈中止（abort 子 run）。
   * 只读观察非信号——轮询/桥接形态由工厂自选。
   */
  readonly stopRequested?: () => boolean;
}

/**
 * 委派结算（04 §10：子代理是黑盒——结果不重试，立即结算给父）。
 */
export interface SubagentResult {
  /** 最终输出（黑盒面——父只见结果不见内部过程） */
  readonly output: string;
  /** 结构化输出（capabilities.structuredOutput 时有效） */
  readonly structured?: unknown;
  /** 降级上报（≤4096 截断——哪些工具被拒、以何降级路径完成；禁伪装执法位） */
  readonly diagnostic?: string;
  /** 用量（子栈计量上报；缺席 = 未计量） */
  readonly usage?: Usage;
  /** 收场原因（error 形 = 结果即错误数据——重试是父的策略不是子代理机制） */
  readonly stopReason: SubagentStopReason;
}

/** 子代理收场原因闭集（StopReason 子集——委派语境三值；'killed' 承 Job 终态词） */
export type SubagentStopReason = 'stop' | 'error' | 'aborted';

/**
 * SubagentProvider 契约（04 §10——subagent 件提供，core:）：能力协商 +
 * 单一委派动词。in-process provider 是真工厂——每子代理独立装配全套
 * （自己的 loop/scope/工具面/凭证），运行期无「我是谁派来的」识别。
 */
export interface SubagentProvider {
  readonly capabilities: SubagentCapabilities;
  run(request: SubagentRequest): Promise<SubagentResult>;
}

/**
 * Job 种类闭集（04 §10——kind 现设四值；registerKind 显式登记后方可使用）。
 * `'trigger'` = 触发器 starter 的缺省托管 kind（jobKind 缺省即隐式进此 kind；
 * host 装配期自登 + 缺省并行帽 4——2026-09-07 触发器面 C 批落码定形）。
 */
export type JobKind = 'subagent' | 'process' | 'issue' | 'trigger';

/** Job 状态机（04 §10：running →（可选 stopping）→ 唯一终态；first-wins） */
export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

/** Job 终态载荷（settle 时落——first-wins 封口后的不可变值） */
export interface JobTerminal {
  /** 终态（三值闭集——completed/killed/failed） */
  readonly status: Extract<JobStatus, 'completed' | 'killed' | 'failed'>;
  /** 终态落定时刻（epoch ms） */
  readonly at: number;
  /** 终态说明（人读——killed 的归因/failed 的错误摘要等） */
  readonly detail?: string;
}

/** Job 注册表条目（进程内状态——04 §10 终态不镜像落库明文豁免） */
export interface JobEntry {
  /** 唯一 id（注册表自铸 `job-<n>` 序列） */
  readonly id: string;
  /** 显示名（子代理诊断名/进程命令行等） */
  readonly name: string;
  /** 种类（registerKind 登记词汇） */
  readonly kind: JobKind;
  /** 归属围栏（会话关闭按 owner 收口其在飞 Job 落 killed） */
  readonly owner: string;
  /** 当前状态（终态后不可变——first-wins） */
  readonly status: JobStatus;
  /** 起跑时刻（epoch ms） */
  readonly startedAt: number;
  /** 终态载荷（未终态 = undefined） */
  readonly terminal?: JobTerminal;
}

/** job_settled 活体事件载荷（04 §10——总线词，内存直推不落库） */
export interface JobSettledEvent {
  /** 终态条目快照（含 id/kind/owner/terminal） */
  readonly entry: JobEntry;
}

/**
 * 声明式子代理解析产物（06 §11.6 agents/*.md 纯数据 def）。
 * 归 contracts（02 §4.1 席 1 契约家）：解析层住 core:skills、机器住
 * core:subagent——两侧共享形状只可经契约面（skills→subagent 无边，
 * DAG 禁穿）；subagent 收纯数据 def 零 yaml（yaml 裸导入白名单不扩）。
 */
export interface SubagentDef {
  /** 身份键（frontmatter name 缺省回落文件基名；提供时须与基名一致） */
  readonly name: string;
  /** 描述（必填——披露段清单行 = 模型选择依据） */
  readonly description: string;
  /** 工具白名单（可选 include 名单——与派生面交集执法） */
  readonly tools?: readonly string[];
  /** 前置要求（04 §10 预检闸声明位——与 tools 白名单正交不混读） */
  readonly requires?: readonly string[];
  /** 模型覆盖（子代理启动参数直传工厂——不进能力协商面） */
  readonly model?: string;
  /** 正文即系统提示（frontmatter 闭合 --- 之后全文） */
  readonly systemPrompt: string;
  /** 来源文件绝对路径（诊断/溯源面） */
  readonly filePath: string;
}

/**
 * 程序化 named provider 注册 def（03 §2.2 第十二动词 ctx.agent.registerSubagentProvider
 * 单参——04 §10 程序化注册槽段机制真源）。**镜像 frontmatter 形** = SubagentDef 减
 * 来源文件位（程序化注册无文件载体——filePath 是声明式腿专属归因面）；注册即派生
 * 静态工具 `agent_<name>`（物化机器住 core:subagent）。形状归 contracts 同 SubagentDef
 * （消费方 = subagent 注册机器 + host ctx 面——经契约面共享，不私造双形）。
 */
export interface ProgrammaticSubagentDef {
  /** 身份键（裸词——06 §11.6 声明式 name 同形：小写字母/数字/连字符，词法真源 06 §11.2） */
  readonly name: string;
  /** 描述（必填——披露段清单行 = 模型选择依据） */
  readonly description: string;
  /** 工具白名单（可选 include 名单——与派生面交集执法） */
  readonly tools?: readonly string[];
  /** 前置要求（04 §10 预检闸声明位——与 tools 白名单正交不混读） */
  readonly requires?: readonly string[];
  /** 模型覆盖（子代理启动参数直传工厂——不进能力协商面） */
  readonly model?: string;
  /** 子代理系统提示（程序化腿无文件载体——正文直传） */
  readonly systemPrompt: string;
}

/**
 * 形状同构锁：ProgrammaticSubagentDef ≡ Omit<SubagentDef, 'filePath'>（双向可赋）。
 * 声明式 def 增删字段时此处编译红——「镜像形」由类型系统执法而非注释自觉
 * （漂移窗口零化）。
 */
type ProgrammaticDefMirrorsSubagentDef =
  ProgrammaticSubagentDef extends Omit<SubagentDef, 'filePath'>
    ? Omit<SubagentDef, 'filePath'> extends ProgrammaticSubagentDef
      ? true
      : never
    : never;
void (true satisfies ProgrammaticDefMirrorsSubagentDef);
