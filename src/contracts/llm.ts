/**
 * L0 contracts — LLM 边界消息基础件（04 篇 §3 StreamFn 契约 + §5 模型层）。
 *
 * 承 berry 同款关键决策：agent loop 不 import llm（02 篇 §4.2 关键不依赖第
 * 一条），StreamFn 签名与消息形状收进 contracts——pi-ai 产生的消息值可原样
 * 赋给这里的类型（标准三角色零转换直通）。
 *
 * 兼容策略：字段取 pi-ai 0.84.4 对应接口的**超集兼容子集**——本文件要求的
 * 必填字段在 pi-ai 中全部存在且同名同型；pi-ai 独有的字段（api/responseModel/
 * deferred 等）不在此收口，多出的字段对结构化赋值透明。
 */

/* ---------------- 内容块（assistant 内联 / user 附件） ---------------- */

/** 文本块（user/assistant/toolResult 通用） */
export interface TextContent {
  type: 'text';
  text: string;
  /** 供应商侧文本签名（回放用；透传） */
  textSignature?: string;
}

/** 思考块（仅 assistant；供应商推理内容回放） */
export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  /** 供应商不透明签名（推理上下文复用；透传） */
  thinkingSignature?: string;
  /** 安全过滤已遮蔽的思考（加密载荷存 thinkingSignature 透传回 API） */
  redacted?: boolean;
}

/** 图片块（多模态附件；base64 数据） */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** 工具调用块（仅 assistant 内联；arguments 已是解析后的对象） */
export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/* ---------------- 用量与终态 ---------------- */

/**
 * 一次 LLM 调用的 token 用量（pi-ai 同构）：cacheRead/cacheWrite 独立拆桶，
 * cacheWrite1h（仅 Anthropic 上报拆分）与 reasoning（已含于 output，供应商
 * 不报则缺省）为可选子集。
 */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** cacheWrite 中 1h 保留的子集（仅 Anthropic 上报拆分） */
  cacheWrite1h?: number;
  /** 推理 token 子集（已含于 output；供应商不报则缺省） */
  reasoning?: number;
  totalTokens: number;
  /** 费用（供应商可解析时填充） */
  cost?: { total: number; input?: number; output?: number; currency?: string };
}

/**
 * 计量四桶形（05 篇 §1.1 llm/usage 事件载荷 usage 字段形）：input/output/
 * cacheRead/cacheWrite 四桶必落（供应商恒报），cacheWrite1h/reasoning 上报才落；
 * totalTokens（派生）与 cost（折算）**不入账**——token 原始值入账、货币折算
 * 在投影查询做（价格表更新不回改历史）。
 */
export interface UsageBuckets {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** cacheWrite 中 1h 保留的子集（仅 Anthropic 上报拆分；上报才落） */
  cacheWrite1h?: number;
  /** 推理 token 子集（已含于 output；上报才落） */
  reasoning?: number;
}

/**
 * LLM 调用终态（pi-ai 同构七值）。
 * loop 只消费 error/aborted（终态短路）与 length（截断防御）；
 * deferred 是 pi-ai 原生延迟工具装载透传值，v1 不产生但词汇保留。
 */
export type StopReason = 'pending' | 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'deferred';

/* ---------------- 三角色消息 ---------------- */

/**
 * 用户消息（content 允许纯文本或图文块数组）。
 * source 归因复用会话事件词汇闭集 EventSource（05 §3.1 单源——durable 落账
 * 与 LLM 边界同一名；pi-ai UserMessage 不带此字段，多出字段对直通透明）。
 */
export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 输入归因（缺省视为 'user'；投影带出、durable 原样落账） */
  source?: import('./types.js').EventSource;
}

/** 助手消息（流式组装终值；stopReason=error/aborted 时错误即数据，见 AssistantStream） */
export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCallBlock)[];
  usage: Usage;
  stopReason: StopReason;
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 模型标识（provider 内模型 id；llm 模块解析） */
  model?: string;
  /** 供应商标识 */
  provider?: string;
  /** stopReason=error/aborted 时的错误说明（错误是数据契约之一） */
  errorMessage?: string;
  /**
   * 错误码（04 §3.5 判定序的机器判定位）：宿主合成错误携带 LLM_ 码（如
   * LLM_INFLIGHT_LIMIT 帽拒绝）；provider 真错误码归一挂 provider 钩子纵切。
   * classifyError 判定时在场码优先、文案正则兜底。
   */
  errorCode?: string;
  /** 脱敏诊断（恢复与审计用） */
  diagnostics?: unknown[];
}

/** 工具结果消息（与 assistant 内 toolCall 按 toolCallId 配对） */
export interface ToolResultMessage {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 供日志/UI 的结构化明细（不进主上下文计费） */
  details?: unknown;
  /** 工具执行自身的用量（若可得上报；不进主上下文计费） */
  usage?: Usage;
  /** 本次结果后新可用的工具名（延迟装载透传） */
  addedToolNames?: string[];
}

/** LLM 边界标准三角色（convertToLlm 透传的标准半边） */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/* ---------------- 请求上下文与工具描述 ---------------- */

/** LLM 工具描述（parameters 为 JSON Schema——typebox 产物即此形状） */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema 参数描述（typebox 产物或等价 JSON Schema 对象；宽收 object 兼容构建器类型） */
  parameters: object;
}

/** 单次 LLM 请求上下文（StreamFn 第一参数；04 §3.1） */
export interface LlmContext {
  systemPrompt?: string;
  messages: Message[];
  tools?: LlmTool[];
}

/* ---------------- 模型层调用接缝（agent 与 llm 在此会合） ---------------- */

/**
 * 模型目录只读投影（listModels()/getModel() 返回形）：pi-ai Model 的应用友好
 * 子集——枚举/展示/能力判别所需字段直通，传输与 provider 配置面（baseUrl/
 * headers/samplingParams/compat）不披露（宿主数据只经服务面，03 篇 §3.2
 * 「防双实例」纪律的读侧配套）。
 */
export interface ModelInfo {
  /** 模型标识（"provider/model-id" 全形——resolveModel 可解析的同一名） */
  readonly id: string;
  /** 展示名（人类可读） */
  readonly name: string;
  /** 所属 provider id（目录分组用） */
  readonly provider: string;
  /** 是否推理模型（思考档位面可用性判据） */
  readonly reasoning: boolean;
  /** 输入模态清单 */
  readonly input: readonly ('text' | 'image')[];
  /** 上下文窗口（tokens） */
  readonly contextWindow: number;
  /** 单请求输出上限（tokens） */
  readonly maxTokens: number;
}

/** 思考档位（pi-ai 同构七值；xhigh/max 仅部分模型家族支持——会话态非 run 态，04 §5） */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** StreamFn 每次调用的选项（model 为模型 id 字符串——解析归 llm 模块，loop 不持模型对象） */
export interface StreamFnOptions {
  /** 模型 id（llm 模块解析为具体 provider/model；可逐轮替换） */
  model: string;
  thinkingLevel?: ThinkingLevel;
  /** 凭证（缺省 undefined 由 llm 层走持久化凭证链） */
  apiKey?: string;
}

/**
 * 模型层注入签名（llm 模块整体替换位——agent 与 llm 两模块的唯一会合点，故落在
 * contracts）。契约：**永不抛错**（04 §3）——一切失败编码为返回流的 error 终止
 * 事件 + 最终消息 stopReason='error'|'aborted' + errorMessage（AssistantStream
 * 契约注释）。这是 loop 零 try/catch 的契约根基：错误是数据不是异常。
 */
export type StreamFn = (
  context: LlmContext,
  options: StreamFnOptions,
  signal?: AbortSignal,
) => AssistantStream | Promise<AssistantStream>;

/* ---------------- 流式事件协议（AssistantStream） ---------------- */

/**
 * 流式事件（pi-ai AssistantMessageEvent 同构 12 型）。
 * 协议：`start` 先行 → 各内容块 start/delta/end 交错（partial 携带累计快照）→
 * 以 `done`（成功）或 `error`（stopReason=error/aborted）收尾。
 */
export type AssistantStreamEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCallBlock; partial: AssistantMessage }
  | {
      type: 'done';
      reason: Extract<StopReason, 'stop' | 'length' | 'toolUse' | 'deferred'>;
      message: AssistantMessage;
    }
  | { type: 'error'; reason: Extract<StopReason, 'aborted' | 'error'>; error: AssistantMessage };

/**
 * 流式响应：异步迭代事件 + 最终消息取值口。
 * 契约（04 §3「永不抛」，loop 零 try/catch 的根基）：**永不抛错**——一切失败
 * 编码为流内 `error` 终止事件 + 最终 AssistantMessage 的 stopReason='error'|
 * 'aborted' + errorMessage。错误是数据不是异常（金样回放轨的替换点 seam）。
 */
export interface AssistantStream {
  /** 迭代流事件（以 done/error 收尾后结束） */
  [Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent>;
  /** 取最终 AssistantMessage（流耗尽后 resolve；失败编码在 stopReason/errorMessage 上） */
  result(): Promise<AssistantMessage>;
}
