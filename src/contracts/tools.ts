/**
 * L0 contracts — AgentTool 工具族类型（agent 件三段管道的执行体契约）。
 *
 * 裁决（本仓 vs berry 蓝本差异②）：蓝本 AgentTool 族先落 agent 件后迁
 * contracts——本仓一步到位直上 contracts（插件 defineTool 的参数类型消费面，
 * 避免落码即迁的双写窗口）。工具面三段管道（schema→守门→执行）本体在
 * tools 件（后续批）；本件只钉**执行体形状**——loop 工具批的直接消费面。
 */

import type { ImageContent, TextContent, ToolCallBlock, Usage } from './llm.js';

/** 工具执行结果（终值——错误也走 isError 数据面不走异常面） */
export interface AgentToolResult {
  /** 结果内容（与 ToolResultMessage.content 同形；空结果传空数组） */
  content: (TextContent | ImageContent)[];
  /** 供日志/UI 的结构化明细（不进主上下文计费） */
  details?: unknown;
  /** 错误标记（错误是数据契约之一：isError=true 的结果照常进上下文配对） */
  isError?: boolean;
  /** 工具执行自身的用量（若可得上报） */
  usage?: Usage;
  /** 本次结果后新可用的工具名（延迟装载透传） */
  addedToolNames?: string[];
  /** 终止旗标：批内全 terminate 才 terminate（批内一致裁决——单件否决不放大） */
  terminate?: boolean;
}

/** 工具执行进度回调（tool_execution_update 事件的载荷源；promise 结算后的迟到进度被丢弃） */
export type ToolUpdateCallback = (update: unknown) => void;

/**
 * 工具执行体（loop 工具批消费的最小形状——完整 defineTool 形在 tools 件）。
 * execute 契约：一切失败编码为 isError 结果（数据面），同步抛错由执行器
 * 包装兜底（tools-batch——loop 骨架零 try/catch 的配套执法位）。
 */
export interface AgentTool {
  /** 工具名（模型可见清单词法面） */
  name: string;
  /** 工具描述（模型可见） */
  description: string;
  /** UI 呈现标签（缺省用 name） */
  label?: string;
  /** JSON Schema 参数描述（typebox 产物或等价 JSON Schema 对象） */
  parameters: object;
  /**
   * 效果面（03 §2.3 一位两用——批调度与审批共此单键，不另设同义键）：
   * ① 调度语义（tools-batch 批消费序执法——04 §2 尾句）：read（含缺省）批内
   *   可并行调度、write 批边界串行（写前清空在飞只读）；
   * ② 审批语义：write 触发审批对（守门段校验，审批编舞归 safety 件）。
   */
  effect?: ToolEffect;
  /** 参数预处理钩子（执行前最后一改参数的机会；返回改后参数） */
  prepareArguments?: (
    arguments_: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * 执行体：@param toolCallId 调用 id（与 assistant 内 toolCall 配对键）
   * @param arguments_ 已解析参数 @param signal 中止信号（协作面）
   * @param onUpdate 进度回调（迟到进度被丢弃）
   */
  execute: (
    toolCallId: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<AgentToolResult>;
}

/** 工具批执行输入项（assistant 内联 toolCall 块的直取形） */
export type AgentToolCall = ToolCallBlock;

/* ------------------------------------------------------------------ */
/* 三段管道契约面（04 §7：schema → 守门 → 执行；fail-closed 不可绕）      */
/* ——类型上 contracts 的理由：safety（守门行）/ conversation（快照消费） */
/* 都是跨件消费方，契约面不得住 tools 实现件（DAG 只允许 tools 反向被依赖） */
/* ------------------------------------------------------------------ */

/** 工具效果面（03 §2.3 一位两用）：缺省 read；write 兼任批调度屏障（批边界串行）与审批对触发（审批编舞归 safety 件） */
export type ToolEffect = 'read' | 'write';

/** 工具执行语境（管道构造后传给 ToolDefinition.execute 的第 2 参） */
export interface ToolContext {
  /** 调用 id（与 assistant 内联 toolCall 配对键） */
  toolCallId: string;
  /** 中止信号（协作面——超时/取消传播） */
  signal?: AbortSignal;
  /** 进度回调（迟到的进度被丢弃——loop 工具批侧语义） */
  onUpdate?: ToolUpdateCallback;
  /** 会话语境键（驱动层工具的 per-session 状态路由键——fs 观察态等） */
  sessionId?: string;
}

/**
 * 注册表内工具定义（03 §2.3 defineTool 形——插件注册动词 ctx.tools.register
 * 的入参形状）。与 AgentTool（loop 直消费面）的分野：本形 execute 收
 * (args, toolCtx) 插件便利签名；注册表经 toAgentTool 包装成三段管道执行体。
 */
export interface ToolDefinition {
  /** 工具名（全局唯一；命名纪律与查重见 03 §2.7） */
  name: string;
  /** 模型可见描述（注册面注入模式扫描——03 §2.8） */
  description: string;
  /** JSON Schema 参数描述（typebox 产物或等价 JSON Schema 对象；根须 object） */
  parameters: object;
  /** 单次执行预算毫秒（正数；缺省走管道 60s——04 §7 执行段） */
  timeoutMs?: number;
  /** 效果面（一位两用——调度语义 + 审批触发；缺省 read。03 §2.3） */
  effect?: ToolEffect;
  /**
   * 幂等位（03 §2.3）：缺省 true；false = 禁静默重试——副作用型工具重放即
   * 重复执行，重试决策须回模型或上抛不静默。框架侧重放机制（04 §2 call_id
   * 幂等决策）落码前本位先锚定（词先锚定同律）。
   */
  repeatable?: boolean;
  /** 执行体：一切失败编码为 isError 结果（数据面）；抛错由管道/loop 包装兜底 */
  execute: (args: Record<string, unknown>, toolCtx: ToolContext) => Promise<AgentToolResult>;
}

/** 守门段决策词汇（03 §2.4——拦截族 handler 控制输出同一套） */
export type GateAction = { action: 'allow' } | { action: 'block'; reason: string };

/**
 * 守门段 waterfall 载荷（04 §7 段 2）。**可变入参就地改写**：链上 gateInput
 * 对象对整条链固定，守门者改 gateInput.args 即改执行段所见参数（mutate 语义
 * 依赖此——置 mutated 旗供 durable 落账判定）。放行 = next(input) 委托下游；
 * 拦截 = 不调 next 短路、置 outcome 后返回（waterfall 短路语义即 block 语义）。
 */
export interface GateInput {
  /** 被调用工具（只读参考） */
  tool: ToolDefinition;
  /** 调用参数（可变——mutate 就地改写） */
  args: Record<string, unknown>;
  /** 调用 id */
  toolCallId: string;
  /**
   * 会话键（管道签名本有——工具按会话键分派时透传进守门面；04 §7 批 15d
   * 补注。消费先例 = core:checkpoint pre-mutation 捕获按会话判 per-run；
   * 无会话场景〔测试/系统调用〕缺省不带）
   */
  sessionId?: string;
  /** 中止信号（守门面构造审批 ask 载荷时携带） */
  signal?: AbortSignal;
  /** 参数已被改写旗（改参的守门者维护；落账 decision=mutate 的判据） */
  mutated: boolean;
  /** 拦截决策（block 者置；缺省 undefined = 放行沿链） */
  outcome?: GateAction;
}

/** 执行段 waterfall 载荷（around-dispatch：T = 执行闭包，监听者包装后经 next 传播） */
export type ExecuteInput = () => Promise<AgentToolResult>;

/** 后处理段 waterfall 载荷（可就地改写 result——裁剪/spill/isError 改写） */
export interface PostExecuteInput {
  /** 被调用工具（只读参考） */
  tool: ToolDefinition;
  /** 调用参数（守门后终参） */
  args: Record<string, unknown>;
  /** 调用 id */
  toolCallId: string;
  /** 工具结果（可变——监听者就地改写） */
  result: AgentToolResult;
}

/** gate/decision durable 落账记录（05 §1.1 词汇表 gate/decision 行的 data 形状） */
export interface GateDecisionRecord {
  /** 调用 id（与 tool/call·tool/result 配对键） */
  toolCallId: string;
  /** 决策三值（allow / block / mutate） */
  decision: 'allow' | 'block' | 'mutate';
  /** 决策理由（block 原因 / 放行来源标注；缺省 'ok'） */
  reason: string;
}

/** gate/decision 落账 sink（装配根接 session.append；tools 不依赖 session——DAG 单向） */
export type GateDecisionSink = (record: GateDecisionRecord) => void;

/** 三段管道执行器（注册表 toAgentTool 的执行真身；抛 BaseError 由 loop 包装 isError） */
export type ToolPipelineExecutor = (
  def: ToolDefinition,
  toolCallId: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onUpdate?: ToolUpdateCallback,
  sessionId?: string,
) => Promise<AgentToolResult>;

/* 钩子词汇常量（03 §2.4 主表三段 + tools_change——词本体在 LIVE 词表，
 * 装配根 registerEventNames 消费本清单；tools 件自用 + safety 守门行订阅面） */
export const TOOL_PRE_EXECUTE_EVENT = 'tools_pre_execute';
export const TOOL_EXECUTE_EVENT = 'tools_execute';
export const TOOL_POST_EXECUTE_EVENT = 'tools_post_execute';
export const TOOLS_CHANGE_EVENT = 'tools_change';
/** tools 件经 ctx 事件面消费的词汇全集（装配根注册清单单源） */
export const TOOL_EVENT_NAMES: readonly string[] = [
  TOOL_PRE_EXECUTE_EVENT,
  TOOL_EXECUTE_EVENT,
  TOOL_POST_EXECUTE_EVENT,
  TOOLS_CHANGE_EVENT,
];
