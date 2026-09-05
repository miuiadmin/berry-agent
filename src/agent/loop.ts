/**
 * agent 件 — loop 骨架（04 §2 形态铁律：双 while、≤150 行、零 try/catch、零存储感知）。
 *
 * 外层 turn 循环：steering 注入 → 流消费 → 终态判定 → 工具批 → followUp 续跑裁决。
 * 内层流消费与工具批执行分别住在 stream.ts / tools-batch.ts（骨架只留控制流）。
 * 全部策略经注入回调（AgentLoopConfig 11 项）、全部状态经活体事件回流——
 * loop 不知道 conversation 存在；错误不就地 try/catch（StreamFn 永不抛契约 +
 * 执行器包装位），失败由 run 终态承载（04 篇 §2/§3）。
 */

import { BaseError } from '../contracts/index.js';
import type { AgentMessage } from '../contracts/index.js';
import type { AssistantMessage, StopReason, ToolResultMessage } from '../contracts/index.js';
import type { AgentToolCall } from '../contracts/index.js';
import type { RunStatus } from './events.js';
import type { AgentContext, AgentLoopConfig, EmitFn, RunResult } from './types.js';
import { streamAssistantResponse } from './stream.js';
import { executeToolBatch } from './tools-batch.js';

/** 种子/续跑消息入列（steering 顶注与 followUp 续跑共用——channel 随事件披露） */
function pushAll(context: AgentContext, messages: AgentMessage[], emit: EmitFn, channel?: 'steer' | 'followUp'): void {
  for (const message of messages) {
    context.messages.push(message);
    emit({ type: 'message_start', role: message.role, ...(channel ? { channel } : {}) });
    emit({ type: 'message_end', message, ...(channel ? { channel } : {}) });
  }
}

/** assistant 内联 toolCall 块直取（工具批与截断配对的公共提取面） */
function toolCallsOf(message: AssistantMessage): AgentToolCall[] {
  return message.content.filter((block): block is AgentToolCall => block.type === 'toolCall');
}

/**
 * 种子起跑：seeds 逐条入列（用户直发——channel 缺省）后进主循环。
 * @param context 运行上下文（messages 活数组） @param config 回调面
 * @param seeds 种子消息（缺省空——纯续入形走 continueRun）
 */
export function startRun(
  context: AgentContext,
  config: AgentLoopConfig,
  seeds: AgentMessage[] = [],
): Promise<RunResult> {
  const emit: EmitFn = (event) => void config.onEvent?.(event);
  pushAll(context, seeds, emit);
  return runLoop(context, config, emit);
}

/**
 * 续入起跑：末角色校验（经 convertToLlm 转换后须 user/toolResult——违者
 * AGENT_CONTINUE_INVALID fail-loud，防把 assistant 尾直接重发 provider）。
 */
export function continueRun(context: AgentContext, config: AgentLoopConfig): Promise<RunResult> {
  const last = context.messages[context.messages.length - 1];
  const converted = last === undefined ? null : config.convertToLlm(last);
  const role = Array.isArray(converted) ? converted[converted.length - 1]?.role : converted?.role;
  if (role !== 'user' && role !== 'toolResult') {
    throw new BaseError(
      'AGENT_CONTINUE_INVALID',
      `continueRun 末角色校验红：转换后末角色为 ${String(role ?? '空')}（须 user/toolResult——恢复续入的上下文形状前提）`,
    );
  }
  return runLoop(context, config, (event) => void config.onEvent?.(event));
}

/** 主循环（双 while 的外层本体——内层流消费在 streamAssistantResponse 内） */
async function runLoop(context: AgentContext, config: AgentLoopConfig, emit: EmitFn): Promise<RunResult> {
  emit({ type: 'agent_start' });
  let turn = 0;
  let stopReason: StopReason | undefined;
  let errorMessage: string | undefined;
  while (true) {
    // turn 顶：steering 注入（busy 中插入的消息进本轮上下文）
    pushAll(context, config.getSteeringMessages?.() ?? [], emit, 'steer');
    turn += 1;
    emit({ type: 'turn_start', turn });
    const assistant = await streamAssistantResponse(config, context, emit);
    stopReason = assistant.stopReason;
    errorMessage = assistant.errorMessage;
    emit({ type: 'turn_end', turn, stopReason: assistant.stopReason });
    // 终态短路：error/aborted → run 收场（status 映射见函数尾）
    if (assistant.stopReason === 'error' || assistant.stopReason === 'aborted') break;
    // 截断防御：length → 整批配对 isError 后收 failed（残缺批不进下一轮）
    if (assistant.stopReason === 'length') {
      errorMessage = assistant.errorMessage ?? '输出被上下文窗口截断（stopReason=length）';
      pushAll(
        context,
        toolCallsOf(assistant).map((call): ToolResultMessage => ({
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: 'text', text: '输出被上下文窗口截断——整批配对收口，不进下一轮' }],
          isError: true,
          timestamp: Date.now(),
        })),
        emit,
      );
      break;
    }
    if (assistant.stopReason === 'toolUse') {
      const outcome = await executeToolBatch(config, context, toolCallsOf(assistant), emit);
      pushAll(context, outcome.results, emit);
      if (outcome.terminate) break; // 批内一致 terminate → 优雅停
    }
    // turn 终止裁决（停止词/预算尽/打断）——先于 followUp 消费：停则 followUp
    // 留在驱动侧队列不入列（未消费消息不悬空在本 run 上下文里）
    if (await config.shouldStopAfterTurn?.(context, assistant)) break;
    if (assistant.stopReason !== 'toolUse') {
      // stop/deferred：followUp 是 idle 起跑通道——空即自然停 completed
      const followUps = config.getFollowUpMessages?.() ?? [];
      if (followUps.length === 0) break;
      pushAll(context, followUps, emit, 'followUp');
    }
    // turn 间准备窗：换 model/thinkingLevel 唯一时机（todo/goal 注入同窗）
    const adjustment = await config.prepareNextTurn?.(context);
    if (adjustment) {
      if (adjustment.model !== undefined) config.model = adjustment.model;
      if (adjustment.thinkingLevel !== undefined) config.thinkingLevel = adjustment.thinkingLevel;
    }
  }
  // 终态映射：error/length → failed；aborted → aborted；其余（stop/toolUse/deferred）→ completed
  const status: RunStatus =
    stopReason === 'error' || stopReason === 'length' ? 'failed' : stopReason === 'aborted' ? 'aborted' : 'completed';
  emit({
    type: 'agent_end',
    status,
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  });
  return {
    status,
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}
