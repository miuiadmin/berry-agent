/**
 * AgentEvent 活体事件族契约（04 篇 §2 机制真源——10 型，内存直推、不落日志）。
 *
 * 归位注记（2026-09-08 U3 落码批）：本族类型原住 agent 件（src/agent/events.ts），
 * 为插件侧 UI 后端类型可达（03 §2.2 registerUiBackend 定形注记——虚拟主键
 * `berry-agent` 面只达 contracts）随 U3-1 归位本件；类型闭包全 contracts 侧
 * （AgentMessage/StopReason/AgentToolResult 既在本域），机制真源仍 04 §2、
 * agent 件经 re-export 维持公开面与件内消费路径不变（批 11b ApprovalAsk
 * 归位同款先例）。
 *
 * 顺序铁律：每族严格 `start → update* → end`；流式 delta 与工具进度经 update
 * 携带。活体流单向消费、不可逆写 durable（05 篇 §7 分层不变式）——「活体呈现」
 * 与「durable 真相」两条线永不合流。重试续入零新事件型：续入即新
 * agent_start/message 流，用户看到重跑。
 */

import type { StopReason } from './llm.js';
import type { AgentMessage } from './messages.js';
import type { AgentToolResult } from './tools.js';

/** run 终态恰三值（04 篇 §2：终态是结算边界——Job 结算、审批对收口、预算记账截断都以它为锚） */
export type RunStatus = 'completed' | 'aborted' | 'failed';

/**
 * 三通道词表（04 篇 §4）：steer = busy 注入合批 / followUp = idle 起跑 /
 * inject = dismantled 停摆后注入。发送方只声明 backgroundWake、三通道判定是
 * 驱动侧单源（conversation）——本词表只承载判定结果（活体事件字段，用户能
 * 看到消息进了哪条道）。
 */
export type DeliverChannel = 'steer' | 'followUp' | 'inject';

/**
 * AgentEvent 10 型联合。message_start/message_end 携带 channel（可观测性：
 * 消息经哪条通道入列——04 §4；channel 缺省 = 用户直发种子消息）。
 */
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; status: RunStatus; stopReason?: StopReason; errorMessage?: string }
  | { type: 'turn_start'; turn: number }
  | { type: 'turn_end'; turn: number; stopReason: StopReason }
  | { type: 'message_start'; role: string; channel?: DeliverChannel }
  | { type: 'message_update'; role: string; partial: AgentMessage }
  | { type: 'message_end'; message: AgentMessage; channel?: DeliverChannel }
  | { type: 'tool_execution_start'; toolCallId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_execution_update'; toolCallId: string; update: unknown }
  | { type: 'tool_execution_end'; toolCallId: string; result: AgentToolResult };

/** 事件汇（消费面：TUI/SPA 活体呈现、金样录制器等；void/Promise 双形兼容） */
export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;
