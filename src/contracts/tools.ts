/**
 * L0 contracts — AgentTool 工具族类型（agent 件三段管道的执行体契约）。
 *
 * 裁决（本仓 vs berry 蓝本差异②）：蓝本 AgentTool 族先落 agent 件后迁
 * contracts——本仓一步到位直上 contracts（插件 defineTool 的参数类型消费面，
 * 避免落码即迁的双写窗口）。工具面三段管道（schema→守门→执行）本体在
 * tools 件（后续批）；本件只钉**执行体形状**——loop 工具批的直接消费面。
 */

import type { ImageContent, TextContent, ToolCallBlock, Usage } from './llm.js';

/** 工具执行模式：sequential = 串行（缺省）；parallel = 并行。批内任一工具 sequential 即整批串行 */
export type ToolExecutionMode = 'sequential' | 'parallel';

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
  /** 执行模式（缺省 sequential；批内任一 sequential 即整批串行） */
  executionMode?: ToolExecutionMode;
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
