/**
 * agent 件 — 工具批执行器（loop 骨架的工具腿；04 §2 批语义的执法位）。
 *
 * 本件是 loop 零 try/catch 形态铁律的配套执法位：插件工具 execute 可抛错，
 * 包装在此（错误 → isError 结果数据面），loop 骨架只见结果不见异常。
 * 批语义三条：①任一工具 sequential 即整批串行（全 parallel 才并行）；
 * ②beforeToolCall block → immediate isError 结果；③terminate 批内一致裁决
 * （批内全 terminate 才 terminate——单件否决不放大）。abort 余量配对（落批
 * 中间时未执行 calls 逐个配对 isError toolResult，防下一轮孤儿 toolUse）。
 */

import { BaseError } from '../contracts/index.js';
import type { TextContent, ToolResultMessage } from '../contracts/index.js';
import type { AgentTool, AgentToolCall, AgentToolResult, ToolUpdateCallback } from '../contracts/index.js';
import type { AgentContext, AgentLoopConfig, EmitFn } from './types.js';

/** 批执行结算：结果消息（与 calls 恒配对——含 block/isError/中止配对腿）+ 批内一致 terminate */
export interface ToolBatchOutcome {
  results: ToolResultMessage[];
  /** 批内全 terminate 才 true（04 §2 批内一致裁决） */
  terminate: boolean;
}

/**
 * 组装一条工具结果消息（block/错误/中止配对/正常四腿共用的组装面）。
 *
 * @param call 配对的 toolCall 块 @param content 文本腿 @param isError 错误标记
 * @param details 结构化明细（可选）
 */
function buildResult(call: AgentToolCall, content: string, isError: boolean, details?: unknown): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: content } satisfies TextContent],
    isError,
    timestamp: Date.now(),
    ...(details !== undefined ? { details } : {}),
  };
}

/**
 * 执行单条工具调用（含 beforeToolCall 守门、执行体替换、迟到进度丢弃、
 * execute 抛错包装、afterToolCall 字段级整体替换）。
 */
async function executeOne(
  config: AgentLoopConfig,
  context: AgentContext,
  tool: AgentTool | undefined,
  call: AgentToolCall,
  emit: EmitFn,
): Promise<{ message: ToolResultMessage; terminate: boolean }> {
  emit({ type: 'tool_execution_start', toolCallId: call.id, name: call.name, arguments: call.arguments });
  // 工具不在场：结果数据面直接回错（工具清单在 run 内静态——不可达名即配置漂移）
  if (!tool) {
    const message = buildResult(call, `工具 ${call.name} 不在本 run 工具集（配置漂移——清单与调用不同源）`, true);
    emit({ type: 'tool_execution_end', toolCallId: call.id, result: { content: message.content, isError: true } });
    return { message, terminate: false };
  }
  // 守门行安装点：block 拒因 → immediate isError 结果（不执行）
  const decision = (await config.beforeToolCall?.(call, context)) ?? {};
  if (decision.block !== undefined) {
    const message = buildResult(call, decision.block, true);
    emit({ type: 'tool_execution_end', toolCallId: call.id, result: { content: message.content, isError: true } });
    return { message, terminate: decision.terminate === true };
  }
  // 参数预处理（执行前最后一改参数的机会）
  const args = tool.prepareArguments ? await tool.prepareArguments(call.arguments) : call.arguments;
  // 迟到进度丢弃：promise 结算后 onUpdate 静默（accepting 旗——终值已落，迟到腿不重放）
  let accepting = true;
  const onUpdate: ToolUpdateCallback = (update) => {
    if (accepting) emit({ type: 'tool_execution_update', toolCallId: call.id, update });
  };
  let result: AgentToolResult;
  try {
    // 执行体替换点（测试注金样 seam）；缺省走 tool.execute（signal 协作面透传）
    result = config.toolExecution
      ? await config.toolExecution(tool, call.id, args, config.signal, onUpdate)
      : await tool.execute(call.id, args, config.signal, onUpdate);
  } catch (err) {
    // 插件工具抛错包装位（loop 零 try/catch 的配套——错误转数据面）
    const text = err instanceof BaseError ? `${err.code}: ${err.message}` : String(err);
    result = { content: [{ type: 'text', text: `工具 ${call.name} 执行异常：${text}` }], isError: true };
  } finally {
    accepting = false;
  }
  // 结果组装（一次到位：正常腿与错误腿同形——错误是数据契约之一）
  let message: ToolResultMessage = {
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: result.content,
    isError: result.isError === true,
    timestamp: Date.now(),
    ...(result.details !== undefined ? { details: result.details } : {}),
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    ...(result.addedToolNames !== undefined ? { addedToolNames: result.addedToolNames } : {}),
  };
  // 后置钩子：字段级整体替换（返回新消息替换默认组装形）
  const replaced = await config.afterToolCall?.(call, result, message, context);
  if (replaced !== undefined && replaced !== null) message = replaced as ToolResultMessage;
  emit({ type: 'tool_execution_end', toolCallId: call.id, result });
  return { message, terminate: result.terminate === true };
}

/**
 * 执行一批工具调用（串行判定 + abort 余量配对 + 批内一致 terminate）。
 *
 * @param config loop 配置 @param context 运行上下文 @param calls assistant 批内全部调用
 * @param emit 活体事件发射器
 */
export async function executeToolBatch(
  config: AgentLoopConfig,
  context: AgentContext,
  calls: AgentToolCall[],
  emit: EmitFn,
): Promise<ToolBatchOutcome> {
  // 任一工具 sequential（或缺省）即整批串行——全 parallel 才并行
  const parallel = calls.every((call) => {
    const tool = context.tools?.find((t) => t.name === call.name);
    return tool?.executionMode === 'parallel';
  });
  const outcome: ToolBatchOutcome = { results: [], terminate: false };
  if (parallel) {
    const settled = await Promise.all(
      calls.map((call) => executeOne(config, context, lookup(context, call), call, emit)),
    );
    outcome.results = settled.map((s) => s.message);
    outcome.terminate = settled.length > 0 && settled.every((s) => s.terminate); // 空批不终止
  } else {
    let allTerminate = true;
    for (const call of calls) {
      // 串行腿逐件查中止：落批中间时余量配对 isError（原因注明打断——无孤儿 toolUse）
      if (config.signal?.aborted) {
        outcome.results.push(buildResult(call, '工具批已被打断（run 中止——余量配对收口）', true));
        continue;
      }
      const settled = await executeOne(config, context, lookup(context, call), call, emit);
      outcome.results.push(settled.message);
      allTerminate = allTerminate && settled.terminate;
    }
    outcome.terminate = calls.length > 0 && allTerminate;
  }
  return outcome;
}

/** 按名查工具（批内 lookup 单源） */
function lookup(context: AgentContext, call: AgentToolCall): AgentTool | undefined {
  return context.tools?.find((t) => t.name === call.name);
}
