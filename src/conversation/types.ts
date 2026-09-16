/**
 * ConversationDriver 契约面（02 §2.3 对话本体 / 04 §2-§4 运行时骨架）。
 *
 * contract-first（批 11b）：本文件钉构造面与注入族签名——实现分批落码
 * （11c durable 接线与重试 / 11d 三通道与取消 / 11e 工具与审批 / 11f
 * ctx.agent 与多会话），批 12 host 装配根消费本面接线。
 *
 * 装配注入族：conversation 依 02 §4.1 边表（deps = contracts, context,
 * agent, session, persist, tools, safety）不可达 llm / compaction /
 * channels / host——一切跨边依赖经 host 装配根闭包注入回调面（04 §11
 * environmentDisclosure 先例同族），缺席语义在各字段位定义保守行为。
 */
import type { AgentEventSink, AgentLoopConfig } from '../agent/index.js';
import type { EventDispatch, Scope } from '../context/index.js';
import type { SessionLog } from '../session/index.js';
import type {
  AgentTool,
  ApprovalAskAnswer,
  ApprovalAskRequest,
  AssistantMessage,
  ErrorBucket,
  Message,
  RunStatus,
  StreamFn,
  ThinkingLevel,
  ToolDefinition,
} from '../contracts/index.js';
import type { ApprovalRequest, ApprovalOutcome, SandboxMode, SandboxService } from '../safety/index.js';

/**
 * turn 级 auto-retry 策略（04 §3.3 条 6）：conversation 自持声明——值配置
 * 非单源逻辑（分桶单源在 llm classifyError，经注入消费），结构兼容即可。
 */
export interface RetryPolicyConfig {
  /** 总开关（false = 一切错误直接 run failed 收场） */
  readonly enabled: boolean;
  /** transient 桶重试名额上限（1/1 溢出分账另计，不占本名额） */
  readonly maxRetries: number;
  /** 指数退避基值 ms：delay = base·2^(n-1)·(0.5 + random·0.5) */
  readonly baseDelayMs: number;
}

/** RetryPolicy 缺省（04 §3.3 条 6 定值：enabled / 3 次 / 1000ms 基值） */
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicyConfig> = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
};

/**
 * ConversationDriver 构造面。字段按「直接依赖（边表内件）」与「装配注入面
 * （跨边件，host 装配根闭包注入）」两组排列；可缺席注入的都在缺席侧定义
 * 保守行为（缺什么都不炸对话本体——降级语义见各字段 JSDoc）。
 */
export interface ConversationDriverOptions {
  // —— 直接依赖（02 §4.1 边表内件）——

  /** 会话日志（durable 接线目标——一切落账与投影回放的单源） */
  readonly session: SessionLog;
  /** 装载运行时 scope（ctx 服务面——open 域 bash 工具经 tryGet 诚实缺席消费 exec） */
  readonly scope: Scope;
  /** 事件总线（safety ApprovalService waterfall 挂点——审批 ask/answer 事件面） */
  readonly dispatch: EventDispatch;

  // —— 装配注入面（跨边件——host 装配根闭包注入，04 §11 先例同族）——

  /** LLM 流面（agent loop 只认 StreamFn 签名——llm 件经装配根供入） */
  readonly streamFn: StreamFn;
  /**
   * 标准三角色 + 自定义角色的 LLM 降写器（loop 必填回调）：装配根从
   * contracts 角色注册表（registerMessageRole）组装供入——标准消息直通、
   * 自定义角色分派定义的 toLlm。
   */
  readonly convertToLlm: AgentLoopConfig['convertToLlm'];
  /**
   * 模型 id（会话态——request/header 快照与每次请求共用）。两种形态：
   * 定值 string（缺省——per-session 覆盖与测试注入形）；活体取值器
   * `() => string`（挂账解挂批 2026-09-15——ctrl+p 模型循环的栈基线活读面：
   * 每 run 起跑现取一次随 run 钉定〔在飞 run 不中途换模型〕，run 间换档
   * 即生效〔消费 = 下一 run 起跑〕）。
   */
  readonly model: string | (() => string);
  /** 思考档位（会话态非 run 态——session/thinking-level 档位切换面） */
  readonly thinkingLevel?: ThinkingLevel;
  /**
   * 系统提示词（04 §11 快照序钉死）：取装配面原始值——环境披露段是
   * transformContext 关口的瞬态层，永不进本值（否则违反披露段「不落日志」
   * 且 resume 重建双重追加）。
   */
  readonly systemPrompt?: string;
  /**
   * 插件提示词段物化取值器（批 19a 消费腿——03 §2.5）：每请求组装时调用
   * 重取（注册即生效面），物化文本拼于 systemPrompt 尾（cache 经济批
   * RP1——披露段已迁消息尾瞬态层，本段区即 systemPrompt 恒定面主体）；
   * 与披露段同属瞬态层不落快照。sessionId 参透传 registry.materialize
   * （每会话懒冻结类段消费——ca-2）。空串/缺席 = 零段不打扰。
   */
  readonly pluginSections?: (sessionId: string) => string;
  /**
   * 本会话可用工具集（04 §2 AgentContext.tools 的组装面）：标准工具经装配
   * 根供入；open 域工具族与审批守门钩（beforeToolCall）归 11e。缺席 = 纯
   * 对话 run（loop 缺省空工具集）。
   */
  readonly tools?: readonly AgentTool[];
  /**
   * 工具归因取值器（T9 案一批 t-1——05 §1.1 tool/call 载荷 owner 位取数
   * seam）：name → 注册面铸造的 owner；装配根从会话注册表（listFor 两层
   * 并集）构造闭包注入，live 查询形覆盖装配后动态注册。缺席 = tool/call
   * 载荷不带 owner（独立 stack 测试形/纯对话 run——渐进增强零破口）。
   */
  readonly resolveToolOwner?: (name: string) => string | undefined;
  /**
   * lane 帽闸（04 §4 宿主级 run 并发帽——channels 消息语义批 m-2 seam
   * 注入形，resolveToolOwner 同形先例；结构契约单源在此，host 侧
   * createRunLaneGate 产物零 import 同构）：followUp 起跑前取位、run 终态
   * 释放（释放器由取位载回）；**steer/inject 腿不经闸**（busy 腿搭车在飞
   * run、停摆腿落账不跑——闸只拦「新 run 诞生」形）。**排队不计在飞**：
   * 取位成功后才置 currentRun——排队期 busy 判据 / interrupt 回执 / 后续
   * 消息路由皆读已起跑形（同会话排队期新消息以独立 run 再排队，帽下串行
   * 不合批）。缺席 = 无帽渐进增强（测试/嵌装零破口——含回执 promise 引用
   * 恒等与「受理即已落账」同步段：在场且帽内有位时走 tryAcquire 同步直通
   * 同样零微任务边界）。
   */
  readonly acquireRunSlot?: RunSlotGate;
  /**
   * 错误分桶器（04 §3.5 消费通路条款）：llm classifyError 单源实现注入；
   * 缺席 = 一切错误按 non-retryable 保守收场（装配残缺不放大重试面）。
   */
  readonly classifyError?: (message: AssistantMessage) => ErrorBucket;
  /**
   * 溢出压缩（04 §3.4 注入通路条款）：CompactionService.compactForOverflow
   * 注入（结构兼容——OverflowOutcome 三值联合内联于此，conversation 不
   * import compaction）；缺席 = 溢出直接终态（05 §2.3 门三道第三道装配面）。
   */
  readonly compactForOverflow?: (log: SessionLog) => Promise<'compacted' | 'nothing' | 'failed'>;
  /**
   * 环境披露段（04 §11 装配注入条款）：五件组装为单一文本块供给，驱动在
   * transformContext 最后关口追加；返回 null / 缺席 = 无披露段（零强求）。
   */
  readonly environmentDisclosure?: () => string | null;
  /**
   * 审批 ask 呈现面（07 §4.3 提问队列条款）：channels UiBackend.askApproval
   * 同构经装配注入；缺席 = 无应答者 fail-closed（审批不可静默通过）。
   */
  readonly askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;

  /**
   * 审批挂起收口面（04 §9 审批对条款 + 04 §3 终态=结算边界）：runTurns 结算
   * 时调用——未决 ask 统一落 unavailable（通道没了问也无从答）。装配根接
   * wireSessionApproval 产物 settlePending（11e 装配面）；缺席 = 无收口面
   * （无审批装配的纯对话形态）。
   */
  readonly settleApprovals?: () => void;

  /**
   * 后台唤醒批的工具面供应商（04 §4「合批收窄工具面」）：唤醒触发的 run
   * 工具面 = 本供应面产出（goal 续跑/tick 编排的窄面经装配根供入——批 12
   * 接线）；**缺席 = 后台 run 零工具**（纯对话——「防后台 run 自由动用全部
   * 工具」的最保守兑现；前台 run 不经本面恒取全量 tools）。
   */
  readonly backgroundTools?: () => AgentTool[];

  /**
   * goal 段窄面供应商（03 §10.5 chat↔goal 数据通道）：todo fold 边界升格
   * 「goal 生命周期段」的判据面——装配根注入 goal 件 `goalScopeFor` 闭包
   * （词面独立零 import、结构兼容编译期即验）；**缺席 = fold 退化 run-scoped
   * 现行为**（goal 未装载/无 active goal 同形）。15b 落码批起用。
   */
  readonly goalScopeFor?: (sessionId: string) => { goalId: string; activatedSeq: number } | undefined;

  /**
   * goal 轮间沉淀供应商（04 §3.7 complete 单发——03 §10.5 挂账件批 #99 兑现）：
   * 每请求组装时经 onTransformContext 取用，返回文本注入于 todo 快照之前
   * （注入序定律：插件段 → 披露段 → context_transform 瀑布 → goal 沉淀 →
   * todo 恒最后）。瞬态层不落 durable——goalScopeFor 供锚 + 指纹缓存限频
   * 都归 goal 件侧闭包。缺席/返回 null = 零注入。
   */
  readonly goalDeposit?: () => string | null;

  /**
   * 预算预警取值器（04 §5 软着陆层——遗漏审计批 H + 2026-09-13 修复批
   * run 级后台性判据）：每请求组装时取用（携当前 run 后台道声明位——
   * 前台 run 恒 false），非空文本以瞬态 UserMessage 注入消息尾（注入序：
   * reminders → 预算预警 → goal 沉淀 → todo 恒最后）——不落 durable 不进
   * 快照（与披露段/todo 回看同律）。文案铸造与分族判定归装配位闭包
   * （origin 会话级两判 + backgroundLane run 级声明位）；本层只管注入位
   * 与序。缺席/返回 null = 零注入（前台 run 无池可警同形）。
   */
  readonly budgetAdvisory?: (backgroundLane: boolean) => string | null;

  /**
   * run 结算钩（04 §5 记账腿——批 #99 三入口统一）：launch settled 链内
   * 嵌（run 回执 promise 引用恒等不破）；settle 时窗扫 durable 事件计数
   * 前台 assistant/message（04 §176 记账单位 = 消息非 run）。双计防线：
   * CLI run 入口的既有挂点已随本钩上移移除。缺席 = 零记账（goal 件未
   * 装载同形）。
   */
  readonly onRunSettled?: (receipt: RunSettledReceipt) => void;

  /**
   * 警示面（唤醒预算拒收等运行时护栏 warn 的落点）：缺省 stderr 直写
   * （护栏不静默）；装配根接 logger。
   */
  readonly warn?: (message: string) => void;

  /**
   * 活体事件外部汇（04 §2 onEvent 的转发腿）：驱动把活体 AgentEvent 双腿
   * 转发——durable 接线腿（同步序即落账序）+ 本腿（channels 信封包装归批 12
   * 装配）。缺席 = 零外部转发（纯落账形态）。
   */
  readonly onEvent?: AgentEventSink;

  /** turn 级 auto-retry 策略（缺省 DEFAULT_RETRY_POLICY） */
  readonly retry?: RetryPolicyConfig;
}

/**
 * 用户输入入口选项（04 §4 三通道注入——发送方只声明 backgroundWake /
 * backgroundLane，steer/followUp/inject 三通道判定是驱动单源职责，按 run
 * 状态路由）。
 */
export interface SubmitOptions {
  /**
   * 唤醒位（04 §4）：true = 本条是后台唤醒输入——run 静默期到达计入
   * maxConsecutiveWakes 唤醒预算（防自激励环）；缺省 false = 前台输入。
   */
  readonly backgroundWake?: boolean;
  /**
   * 后台道声明位（04 §5——run 级后台性单源，2026-09-13 全面复盘修复批）：
   * true = 本条起跑的 run 消耗后台道预算。起跑方声明（tick 用户行与 goal
   * 挂钟行共用 scheduler-tick runSession、`run --background` 入口）；缺省
   * false = 前台。纯 run 级载体：不落 durable、不进 user/message 载荷；
   * 预算预警分族判据消费（assembly 闭包），记账仍归各调用方 seq 锚窗扫
   * （本位不是记账面）。steer 入列与搁浅件随新起 run 车道（批次级近似——
   * 预警是软着陆层非记账面，精度足够）。
   */
  readonly backgroundLane?: boolean;
  /**
   * 候跑位（04 §4——挂账解挂批 2026-09-15，alt+enter 排队的发送方标记）：
   * true = busy 期本条显式排队候跑——不入在飞 run 的 steer 取件集（不顶注
   * 不打断），候 run 终态由候跑取件点消费种子新起 run；idle 期提交与无标记
   * 同形。纯内存态不落 durable（`backgroundLane` 同形先例）。
   */
  readonly queueFollowUp?: boolean;
  /**
   * 幂等 admit 去重键（05 §3.5 第二腿——两词一字段两面）：调用方自选、
   * 随 user/message 落 durable data.dedupeKey。serve/SDK 线面受理时以
   * messageId 透传（受理即落账）；UI 侧不带零影响（data 审计字段不进
   * 模型上下文——05 §3.1）。缺省不带。
   */
  readonly dedupeKey?: string;
}

/**
 * run 结算回执（onRunSettled 载荷——04 §5 记账腿消费面）：窗扫
 * [seqAtLaunch, settle) durable 事件的前台 assistant/message 计数 +
 * 种子归因单源（seeds 逐条 treatedAsUser——'schedule'（tick）源 false、
 * 'channel:cli'/'user' 源 true）。
 */
export interface RunSettledReceipt {
  readonly sessionId: string;
  /** 本窗 durable assistant/message 条数（settle 时窗扫——04 §176 记账单位） */
  readonly assistantMessages: number;
  /**
   * 记账窗锚（04 §5 记账桥接单点——2026-09-13 复盘修复 #41/#44 定形）：
   * 窗 = (seqFromLaunch, settle] 的 durable 事件（种子 user/message 不入窗——
   * 捕获位在种子落账前）。usage 桥接落账与 assistant 计数同窗单源。
   */
  readonly seqFromLaunch: number;
  /**
   * run 级预算道快照（起跑 submit 声明位——04 §5）：桥接落账的 priority 源
   * （true → 'background'、false → 'foreground'）。快照时点 = launch 起跑
   * （随 run 结算清位前捕获——回执消费面不读驱动活态）。
   */
  readonly backgroundLane: boolean;
  /** 种子含任一 treatedAsUser 源（用户在场轮——goal 唤醒预算复位判据） */
  readonly userInitiated: boolean;
  /** run 终态（RunResult 收窄——崩溃路径缺席不虚构） */
  readonly status?: RunStatus;
}

/**
 * inject 通道投递收执（04 §4 inject 行：dismantled 停摆期投递只追加会话
 * 日志/投影、不触发任何模型调用——「随下次启动带入」的 durable 承载）。
 */
export interface InjectedReceipt {
  status: 'injected';
  /** durable user/message 落账 seq（下次启动 timeline 重播种自然带入） */
  readonly seq: number;
}

/** 唤醒预算拒收（04 §4：连续后台唤醒超帽即拒绝再唤醒并落 warn） */
export interface WakeRefusedReceipt {
  status: 'wake-refused';
  /** 拒因（闭集当前仅 wake-budget 一值） */
  readonly reason: 'wake-budget';
}

/** 唤醒预算帽（04 §4 定值：连续后台唤醒计数上限——批消费位记账） */
export const MAX_CONSECUTIVE_WAKES = 3;

/**
 * context_transform 钩子事件词（03 §2.4 主表 message 层行——mode waterfall）。
 * LLM 请求组装最后关口：驱动发射、插件经 ctx.on 挂管线监听器（不调 next 即
 * 短路——管线语义）。词汇注册双源幂等：bootPlugins 预注册 41 词在前，驱动
 * 构造器自举在后（已注册词跳过——一词两册不撞名，open-tools 同律）。
 */
export const CONTEXT_TRANSFORM_EVENT = 'context_transform';

/**
 * agent_pre_step 钩子事件词（03 §2.4 主表 message 层行——mode waterfall）。
 * 每次模型请求前发射（loop while 体顶、steering 消费与 turn_start 之前——
 * 预算刹停不产生 dangling turn）：驱动发射、插件经 ctx.on 挂瀑布监听器。
 * 消费例：goal 预算复验（04 §5 双轨第二腿——budgetExceeded 步间复查防
 * 记账腿与执行腿竞速漏刹）、压缩压力挂点。词汇注册双源幂等：
 * bootPlugins 预注册在前，驱动构造器自举在后（CONTEXT_TRANSFORM_EVENT
 * 同律）。
 */
export const AGENT_PRE_STEP_EVENT = 'agent_pre_step';

/**
 * agent_request_error 钩子事件词（03 §2.5 主表 agent 层行——mode waterfall；
 * 批 E 兑现）。模型请求失败时发射（runTurns error settle 位——04 §3.3 条 7：
 * 判桶之后、三腿分派之前）：驱动发射、插件经 ctx.on 挂瀑布监听器。决策消费
 * 律（retry 不限 transient 桶但 attempt 并 transient 分账 / stop 终止 /
 * overflow 桶 decision 不消费）单源归 04 §3.3 条 7。词汇注册双源幂等：
 * bootPlugins 预注册在前，驱动构造器自举在后（AGENT_PRE_STEP_EVENT 同律）。
 */
export const AGENT_REQUEST_ERROR_EVENT = 'agent_request_error';

/**
 * agent_request_error 瀑布载荷（03 §2.5 签名「载荷含结构化错误体（LLM_ 码族）」
 * 承载——批 E 定形）：错误体三键取自 lastErrorAssistant、bucket 取
 * classifyError 判得值（注入缺席 = 'non-retryable' 保守）；attempt = 已耗
 * transient 重试数（首次 error settle = 0）、maxAttempts = retry.maxRetries。
 * 决策字段 = 输出可选平键：handler 置 decision 即表态（瀑布串行后位覆盖
 * 前位）；不设 = 不表态放行下游。
 */
export interface AgentRequestErrorInput {
  /** 目标会话（插件绑会话判据位） */
  readonly sessionId: string;
  /** 失败说明（取错误 assistant 的 errorMessage——可在场缺席） */
  readonly errorMessage?: string;
  /** 结构化错误码（LLM_ 码族——AssistantMessage.errorCode 数据面） */
  readonly errorCode?: string;
  /** 错误 assistant 的 stopReason */
  readonly stopReason: string;
  /** classifyError 判得桶（04 §3.5 四桶） */
  readonly bucket: ErrorBucket;
  /** 已耗 transient 重试数（首次 error settle = 0） */
  readonly attempt: number;
  /** 重试帽（retry.maxAttempts） */
  readonly maxAttempts: number;
  /** 决策位：'retry'（重试续入——不限 transient 桶但 attempt 并 transient 分账）/ 'stop'（终止）；不设 = 不表态 */
  decision?: 'retry' | 'stop';
  /** decision 'retry' 伴生：非空串生效——重试起新流换模型（非法模型名由下一次流 fail-loud 自证，attempt 帽兜底） */
  model?: string;
}

/**
 * agent_pre_step 瀑布载荷（03 §2.4 签名「可注入提醒、检查目标」承载）。
 * 载荷对象整链固定；handler 就地 push 注入提醒 / 置 stop 即刹车（不调
 * next 也短路——管线语义）。reminders 由驱动暂存、于同请求的
 * transformContext 关口以瞬态 UserMessage 注入（不落 durable）。
 */
export interface PreStepInput {
  /** 目标会话（注入面绑会话的判据位） */
  readonly sessionId: string;
  /** 提醒注入槽（handler 就地 push——驱动消费后清空，跨请求不残留） */
  readonly reminders: string[];
  /** 刹车位：置 {reason} 即本 turn 不起模型请求、run 以 stop 收 completed */
  stop?: { reason: string };
}

/**
 * context_transform 瀑布载荷（03 §2.4 签名「双参 `(messages, sessionId)`」＝
 * 对象载荷承载）。messages 为**可变数组就地改写**（GateInput 同律）：载荷对象
 * 整链固定、handler 就地 push 注入消息即全链可见；注入体须已转写为 LLM 形
 * Message[]（convertToLlm 先于 transformContext——组装序）。
 */
export interface ContextTransformInput {
  /** 目标会话（注入面绑会话的判据位） */
  readonly sessionId: string;
  /** LLM 形消息批（handler 就地追加——注入序：memory/diff → memory/recall → todo 恒最后） */
  readonly messages: Message[];
}

/**
 * session/lifecycle 活体事件词（04 §6 在飞状态活体词——e-2 观测腿）。
 * run 起/终态广播：驱动 kick 起拍 + runTurns finally 终态拍两发、宿主包装层
 * 按订阅作用域（self|tree|all）过滤派发。**活体不落日志**（dispatch 内存
 * 直推——job_settled 同律；durable 真源 = 事件流尾条推导〔03 §10.8〕——推送
 * 是推导的投影非第二真相源）。词汇注册双源幂等：装配根预注册（插件装载期
 * 订阅可达——boot 先于首会话起跑）在前、驱动构造器自举在后（已注册词跳过
 * ——CONTEXT_TRANSFORM_EVENT 同律）。
 */
export const SESSION_LIFECYCLE_EVENT = 'session/lifecycle';

/** session/lifecycle 载荷（run 起/终态两拍） */
export interface SessionLifecycleEvent {
  readonly sessionId: string;
  /** run-started = kick 起跑；run-settled = runTurns 收口（含崩溃路径） */
  readonly phase: 'run-started' | 'run-settled';
  /** run-started 携带：唤醒起跑（后台道——04 §4 合批面） */
  readonly wake?: true;
  /** run-settled 携带：终态三值；崩溃路径（无 RunResult 收场）缺席——只报收口不虚构终值 */
  readonly status?: RunStatus;
}

/** 重播种产物：重建的 timeline 活数组种子（标准消息——自定义角色是每请求瞬态注入，不进重播种） */
export type ReseededTimeline = Message[];

/**
 * run 并发闸结构契约（04 §4 lane 帽——acquireRunSlot 注入形）：双取位面
 * 分工「同步直通 / 异步排队」。不变量：等位队列非空 ⟺ 帽满（释放即 FIFO
 * 补位）——tryAcquire 成功时必无排队者，公平性不破。
 */
export interface RunSlotGate {
  /**
   * 同步试位：帽内有空位即取并返释放器；帽满返 undefined（不排队）。
   * 在位直通零微任务边界——「受理即已落账」投影一致性的同步段保持。
   */
  tryAcquire(): (() => void) | undefined;
  /** 异步取位：帽满排宿主级 FIFO 等位（排队非拒收——背压不拒服务） */
  acquire(): Promise<() => void>;
}

/**
 * exec 会话装配依赖（批 19a 装载态集成定形）：bash 工具件的四个会话级
 * 取值面/服务面——装载期（assembly 级）不可达，经 openTools 会话装配时
 * 注入工厂求值。结构 typing（safety 类型经 conversation 边表合法可达）。
 */
export interface ExecSessionDeps {
  /** 工作区根取值器（cwd 缺省腿 + 沙箱策略锚——会话装配位单源） */
  readonly workspaceRoot: () => string;
  /** 当前生效沙箱档（三级解析的会话档位腿——执行期每次调用求值） */
  readonly currentMode: () => SandboxMode;
  /** 沙箱服务（受限档包装；缺席则受限档 fail-closed 拒裸跑） */
  readonly sandboxService?: SandboxService;
  /** 升权审批面（缺席则升权请求 fail-closed 拒——不给「无审批静默放行」） */
  readonly approval?: { ask(req: ApprovalRequest): Promise<{ outcome: ApprovalOutcome }> };
  /**
   * 会话授予根 live 取值器（六役 A1 复核定形——两道防线同根集，04 §7 补钉①
   * 六役定形注）：在场时 bash 沙箱 workspace-write 档可写根并入授予根（与
   * fs fence 同 live 源同「仅 workspace-write、canonical 化去重」律）；缺省
   * 无授予面。纯透传字段——消费语义在 exec 件 createBashTool。
   */
  readonly grantedRoots?: () => string[];
  /** 环境源（bash 发现序读面） */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * exec 服务面（02 §4.1 #16 core:exec 插件经 scope.provide('exec', …) 供给的
 * 结构契约——04 §8 bash 工具件的宿主）：spawn 管道装载期自持（进程级单例），
 * bash 工具件经会话装配期工厂求值（会话级 deps 见 ExecSessionDeps——批 19a
 * 定形：装载期固定构造会丢会话档位/审批面）。结构 typing 而非 import
 * （conversation 边表不可达 exec——服务面契约单源在此，exec 件落码时按本形
 * 实现 provide）。装配层 scope.tryGet('exec') 诚实缺席消费：exec 禁用 =
 * bash 工具静默缺席（coding 降级，对话本体仍通）。
 */
export interface ExecToolService {
  /** bash 工具件工厂（04 §8 参数面：command/timeoutMs/cwd/sandbox_permissions/justification 成对必填） */
  createBashTool(deps: ExecSessionDeps): ToolDefinition;
  /**
   * goal gates command 源执行 seam 工厂（03 §10.5 ex 批——exec 判据门真接线）。
   * **可选键 + 结构 typing 内联零 import**（goal 席 GateExecSeam 真身不可
   * import——conversation 席无 goal 边；可选性兼容既有 fake 与旧代 exec 件）。
   * 档位恒 workspace-write、升权恒不可用、30s 帽固定（细则 = exec 件
   * gate-exec.ts + 03 §10.5 ex 定形注）。
   */
  createGateExec?(workspaceRoot: () => string): {
    execCommand(command: string): Promise<{ exitCode: number; timedOut: boolean; stderrTail: string }>;
  };
}
