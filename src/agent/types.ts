/**
 * agent 件 — loop 骨架的类型面（04 篇 §2 回调面 11 项 + 入口两式签名）。
 *
 * loop 是纯机制：全部策略经注入回调表达、全部状态经事件与投影回流——
 * conversation 是缺省供给方（组装回调并注入），loop 不知道 conversation 存在。
 * 类型独立成件：loop.ts 只留双 while 骨架本体（≤150 行形态铁律的码面兑现）。
 */

import type { AgentMessage } from '../contracts/index.js';
import type {
  AssistantMessage,
  LlmContext,
  Message,
  StreamFn,
  ThinkingLevel,
  ToolResultMessage,
} from '../contracts/index.js';
import type { AgentTool, AgentToolCall, AgentToolResult, ToolUpdateCallback } from '../contracts/index.js';
import type { AgentEvent, AgentEventSink } from './events.js';

/** loop 运行上下文（messages 是活数组——loop 读写、驱动侧共享同引用） */
export interface AgentContext {
  /** 系统提示词（每次请求组装进 LlmContext） */
  systemPrompt?: string;
  /** 会话消息活数组（种子/流终值/工具结果都在此累积） */
  messages: AgentMessage[];
  /** 本 run 可用工具集（缺省空——纯对话 run） */
  tools?: AgentTool[];
  /**
   * 闸①幂等账本（04 §2 call_id 幂等决策）：call_id → 既有结果消息。挂
   * context（driver 终身单实例持有）→ 批内 + 跨轮 + 重试续入三域同律共享
   * （重试续入 = 新 startRun 同 context——已执行条目直接回执既有结果）。
   * 只持既有结果消息的引用（消息本就活在 messages 数组——零复制零逐出）；
   * 超帽丢尾腿与中止配对腿不进账本（未执行条目无「既有结果」可回执）。
   * 懒初始化（executeToolBatch 首达建账）。
   */
  toolResultLedger?: Map<string, ToolResultMessage>;
}

/** beforeToolCall 决策（守门行安装点）：block = 不执行直接回错误结果；terminate 记账批内一致裁决 */
export interface BeforeToolCallDecision {
  /** 拒因（进 isError 结果 content；守门 deny 面） */
  block?: string;
  /** 终止旗标——批内全 terminate 才 terminate（单件否决不放大） */
  terminate?: boolean;
}

/** turn 间换装变更（prepareNextTurn 返回——换 context/model/thinkingLevel 的唯一时机） */
export interface TurnAdjustment {
  /** 换模型（下一 turn 起生效） */
  model?: string;
  /** 换思考档位（下一 turn 起生效） */
  thinkingLevel?: ThinkingLevel;
}

/**
 * loop 回调面（04 §2 全部注入点——缺省供给方 conversation）。
 * loop 层零重试：失败即 run failed；turn auto-retry/overflow 兜底归 conversation 件。
 */
export interface AgentLoopConfig {
  /** 流式调用体（永不抛——契约见 contracts/llm.ts StreamFn；金样回放轨 seam） */
  streamFn: StreamFn;
  /** 模型 id（prepareNextTurn 可逐轮换装） */
  model: string;
  /** 思考档位（会话态投影入 run——run 内经 prepareNextTurn 可换） */
  thinkingLevel?: ThinkingLevel;

  /** timeline 消息 → LLM 消息转写（自定义角色降写、瞬态注入剥离；null = 剥离） */
  convertToLlm: (message: AgentMessage) => Message | Message[] | null;
  /** 请求组装最后关口（记忆检索瞬态注入在此挂） */
  transformContext?: (context: LlmContext) => LlmContext | Promise<LlmContext>;
  /**
   * 每次模型请求前钩（03 §2.4 agent_pre_step 发射窗——04 §2/§5）：loop
   * while 体顶、steering 消费与 turn_start 之前调用；返回 'stop' 即本 turn
   * 不起模型请求、run 以 stopReason 'stop' 收 completed（预算刹停不产生
   * dangling turn）。驱动侧分派 waterfall（载荷 PreStepInput——提醒注入
   * 槽 + 刹车位）。
   */
  preModelRequest?: (context: AgentContext) => 'stop' | void | Promise<'stop' | void>;
  /** 凭证取用（缺省 undefined 走 llm 层持久化凭证链） */
  getApiKey?: (model: string) => string | undefined;
  /** turn 终止裁决（停止词、预算尽、打断——返回 true 优雅停 completed） */
  shouldStopAfterTurn?: (context: AgentContext, lastMessage: AssistantMessage) => boolean | Promise<boolean>;
  /** turn 间准备（todo 同段回显/goal 轮间沉淀注入窗 + 换装唯一时机） */
  prepareNextTurn?: (context: AgentContext) => void | TurnAdjustment | Promise<void | TurnAdjustment>;
  /** busy 注入通道取件（每 turn 顶查——返回空数组即无） */
  getSteeringMessages?: () => AgentMessage[];
  /** idle 起跑通道取件（自然停候选时查——空即 run 收 completed） */
  getFollowUpMessages?: () => AgentMessage[];
  /** 工具调用前置钩子（守门行安装点；可返回 block 拒因或 terminate 旗标） */
  beforeToolCall?: (
    toolCall: AgentToolCall,
    context: AgentContext,
  ) => BeforeToolCallDecision | void | Promise<BeforeToolCallDecision | void>;
  /** 工具结果后置钩子（字段级整体替换——返回新消息替换默认组装形） */
  afterToolCall?: (
    toolCall: AgentToolCall,
    result: AgentToolResult,
    message: AgentContext['messages'][number],
    context: AgentContext,
  ) => AgentMessage | void | Promise<AgentMessage | void>;
  /** 工具执行体替换点（测试注金样 seam 同族；缺省走 tool.execute） */
  toolExecution?: (
    tool: AgentTool,
    toolCallId: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<AgentToolResult>;

  /** 活体事件汇（10 型内存直推） */
  onEvent?: AgentEventSink;
  /** 中止信号（透传 streamFn 与工具 execute——协作面） */
  signal?: AbortSignal;
  /**
   * 单响应工具批调用数上限（04 §2 闸②）：单次模型响应的工具批超帽即丢尾
   * ——被丢 calls 逐个配对 isError toolResult（原因注明超限）+ 丢弃计数暴露
   * （ToolBatchOutcome.droppedCount，非静默）。缺省
   * DEFAULT_MAX_TOOL_CALLS_PER_RESPONSE（32）；负值按 0 处理（0 = 拒全批）。
   */
  maxToolCallsPerResponse?: number;
}

/** run 结算（终态恰三值——Job 结算、审批对收口、预算记账截断的锚） */
export interface RunResult {
  status: import('./events.js').RunStatus;
  /** 末次流终态（诊断面；status 三值与 stopReason 的映射见 loop.ts endRun） */
  stopReason?: import('../contracts/llm.js').StopReason;
  /** stopReason=error 时的错误文本（终值消息 errorMessage 同源） */
  errorMessage?: string;
}

/** 活体事件发射器（loop 与辅助件共用的小闭包形——void/Promise 双形兼容） */
export type EmitFn = (event: AgentEvent) => void;
