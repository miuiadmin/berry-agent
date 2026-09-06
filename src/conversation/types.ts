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
  StreamFn,
  ThinkingLevel,
  ToolDefinition,
} from '../contracts/index.js';

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
  /** 模型 id（会话态——request/header 快照与每次请求共用） */
  readonly model: string;
  /** 思考档位（会话态非 run 态——session/thinking-level 档位切换面） */
  readonly thinkingLevel?: ThinkingLevel;
  /**
   * 系统提示词（04 §11 快照序钉死）：取装配面原始值——环境披露段是
   * transformContext 关口的瞬态层，永不进本值（否则违反披露段「不落日志」
   * 且 resume 重建双重追加）。
   */
  readonly systemPrompt?: string;
  /**
   * 本会话可用工具集（04 §2 AgentContext.tools 的组装面）：标准工具经装配
   * 根供入；open 域工具族与审批守门钩（beforeToolCall）归 11e。缺席 = 纯
   * 对话 run（loop 缺省空工具集）。
   */
  readonly tools?: readonly AgentTool[];
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
 * 用户输入入口选项（04 §4 三通道注入——发送方只声明 backgroundWake，
 * steer/followUp/inject 三通道判定是驱动单源职责，按 run 状态路由）。
 */
export interface SubmitOptions {
  /**
   * 唤醒位（04 §4）：true = 本条是后台唤醒输入——run 静默期到达计入
   * maxConsecutiveWakes 唤醒预算（防自激励环）；缺省 false = 前台输入。
   */
  readonly backgroundWake?: boolean;
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

/** 重播种产物：重建的 timeline 活数组种子（标准消息——自定义角色是每请求瞬态注入，不进重播种） */
export type ReseededTimeline = Message[];

/**
 * exec 服务面（02 §4.1 #16 core:exec 插件经 scope.provide('exec', …) 供给的
 * 结构契约——04 §8 bash 工具件的宿主）：spawn 管道 + bash 工具件。结构 typing
 * 而非 import（conversation 边表不可达 exec——服务面契约单源在此，exec 件
 * 落码时按本形实现 provide）。装配层 scope.tryGet('exec') 诚实缺席消费：
 * exec 禁用 = bash 工具静默缺席（coding 降级，对话本体仍通）。
 */
export interface ExecToolService {
  /** bash 工具件（04 §8 参数面：command/timeoutMs/cwd/sandbox_permissions/justification 成对必填） */
  readonly bashTool: ToolDefinition;
}
