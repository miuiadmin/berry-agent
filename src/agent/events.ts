/**
 * agent 件 — AgentEvent 活体事件（10 型，内存直推、不落日志；04 篇 §2）。
 *
 * 顺序铁律：每族严格 `start → update* → end`；流式 delta 与工具进度经 update
 * 携带。活体流单向消费、不可逆写 durable（05 篇 §7 分层不变式）——「活体呈现」
 * 与「durable 真相」两条线永不合流。重试续入零新事件型：续入即新
 * agent_start/message 流，用户看到重跑。
 */

import type { AgentMessage } from '../contracts/index.js';
import type { StopReason } from '../contracts/index.js';
import type { AgentToolResult } from '../contracts/index.js';

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
