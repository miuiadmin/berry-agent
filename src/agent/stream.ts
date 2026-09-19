/**
 * agent 件 — 流消费辅助（loop 骨架的内层腿；04 §2 双 while 的内层本体）。
 *
 * 组装序（承蓝本）：convertToLlm 全量转写 → transformContext 最后关口 →
 * getApiKey → streamFn（永不抛——错误编码为流终值）→ 迭代（start 占位入列、
 * delta 就地替换、终值 result() 落位）。partial 就地替换：流中每事件的
 * partial 即累计快照，尾元素直接替换即活体更新——不重建数组。
 * 终值落位判占位在场（04 §3 定形）：error 终值可无 start 前导（provider 前置
 * 失败形），未见 start 时终值走 append——无条件尾替换会覆写上一条活消息。
 */

import type { AgentMessage } from '../contracts/index.js';
import type { AssistantMessage, LlmContext, LlmTool, Message } from '../contracts/index.js';
import type { AgentContext, AgentLoopConfig, EmitFn } from './types.js';

/**
 * length 截断宿主兜底文案（单源——loop 截断防御腿同串消费）：
 * 供应商 stopReason=length 且 errorMessage 缺席时写进消息本体，使 durable
 * 落库/投影拉取/message_end 事件三路同源可见（第十一役 finding 10——修前
 * 兜底只发生在 loop 局部变量，截断原因零持久呈现）。
 */
export const LENGTH_TRUNCATED_MESSAGE = '输出被上下文窗口截断（stopReason=length）';

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
  // ⑤ 消费流：start 占位入列 → 带 partial 事件就地替换尾 → 终值 result() 落位。
  // sawStart 追踪（04 §3 定形）：error 终值可无 start 前导——provider 前置失败形
  // （pi-ai 请求创建失败 catch 路径只发 error 不发 start），「start 先行」非流的
  // 隐含序约束；终值落位据此判占位在场。
  let sawStart = false;
  for await (const event of stream) {
    if (event.type === 'start') {
      sawStart = true;
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
  const result = await stream.result();
  // length 截断宿主兜底（第十一役 finding 10）：供应商报 length 而未给
  // errorMessage 时补写消息本体——终值落位/落库/message_end 事件同一引用，
  // 此处补一次即三路同源（loop 层防御腿消费同常量单源）
  const final: AssistantMessage =
    result.stopReason === 'length' && result.errorMessage === undefined
      ? { ...result, errorMessage: LENGTH_TRUNCATED_MESSAGE }
      : result;
  if (sawStart) {
    // 正常形：占位在场——终值就地替换占位
    context.messages[context.messages.length - 1] = final;
  } else {
    // 无 start 前导形：无占位可替换——终值走 append（无条件尾替换会覆写上一条
    // 活消息：种子 user 消息被 error assistant 顶替即此形），并补发配对
    // message_start（否则 message_end 裸奔——活体事件序违例与覆写同源）
    context.messages.push(final);
    emit({ type: 'message_start', role: 'assistant' });
  }
  emit({ type: 'message_end', message: final });
  return final;
}
