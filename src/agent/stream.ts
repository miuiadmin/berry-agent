/**
 * agent 件 — 流消费辅助（loop 骨架的内层腿；04 §2 双 while 的内层本体）。
 *
 * 组装序（承蓝本）：convertToLlm 全量转写 → transformContext 最后关口 →
 * getApiKey → streamFn（永不抛——错误编码为流终值）→ 迭代（start 占位入列、
 * delta 就地替换、终值 result() 落位）。partial 就地替换：流中每事件的
 * partial 即累计快照，尾元素直接替换即活体更新——不重建数组。
 */

import type { AgentMessage } from '../contracts/index.js';
import type { AssistantMessage, LlmContext, LlmTool, Message } from '../contracts/index.js';
import type { AgentContext, AgentLoopConfig, EmitFn } from './types.js';

/**
 * 单轮流式请求：从 context 组装 LlmContext、消费流、终值落位并回推。
 *
 * @param config loop 配置（convertToLlm/transformContext/getApiKey/streamFn 消费面）
 * @param context 运行上下文（messages 活数组——assistant 占位与终值都入列）
 * @param emit 活体事件发射器
 * @returns 终值消息（stopReason=error/aborted 时错误即数据——loop 按终态短路）
 */
export async function streamAssistantResponse(
  config: AgentLoopConfig,
  context: AgentContext,
  emit: EmitFn,
): Promise<AssistantMessage> {
  // ① convertToLlm 全量转写（null = 剥离不进上下文；数组 = 一拆多）
  const messages: Message[] = [];
  for (const message of context.messages) {
    const converted = config.convertToLlm(message);
    if (converted === null) continue;
    if (Array.isArray(converted)) messages.push(...converted);
    else messages.push(converted);
  }
  let llmContext: LlmContext = {
    systemPrompt: context.systemPrompt,
    messages,
    tools: context.tools?.map((tool): LlmTool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  };
  // ② transformContext 最后关口（记忆检索瞬态注入位）
  if (config.transformContext) llmContext = await config.transformContext(llmContext);
  // ③ 凭证取用 + ④ 流式调用（永不抛契约——一切失败在流终值里）
  const stream = await config.streamFn(
    llmContext,
    { model: config.model, thinkingLevel: config.thinkingLevel, apiKey: config.getApiKey?.(config.model) },
    config.signal,
  );
  // ⑤ 消费流：start 占位入列 → 带 partial 事件就地替换尾 → 终值 result() 落位
  for await (const event of stream) {
    if (event.type === 'start') {
      context.messages.push(event.partial);
      emit({ type: 'message_start', role: 'assistant' });
    } else if (event.type === 'done' || event.type === 'error') {
      break; // 终值统一走 result()（流协议：done/error 后迭代自然收尾）
    } else {
      // 各内容块事件的 partial 均为累计快照——就地替换尾元素即活体更新
      context.messages[context.messages.length - 1] = event.partial;
      emit({ type: 'message_update', role: 'assistant', partial: event.partial as AgentMessage });
    }
  }
  const final = await stream.result();
  context.messages[context.messages.length - 1] = final;
  emit({ type: 'message_end', message: final });
  return final;
}
