/**
 * agent 件公开面（loop 骨架 + 三通道队列 + 活体事件；04 篇 §2/§4）。
 *
 * 单向 DAG：agent → contracts 唯一边（不 import llm/session/context——02 篇
 * §4.2 关键不依赖第一条的码面执法）。驱动侧（conversation 件，后续批）经
 * startRun/continueRun 两入口消费；PendingMessageQueue 是三通道暂存机制件。
 */
export type {
  AgentContext,
  AgentLoopConfig,
  BeforeToolCallDecision,
  TurnAdjustment,
  RunResult,
  EmitFn,
} from './types.js';
export type { RunStatus, DeliverChannel, AgentEvent, AgentEventSink } from './events.js';
export type { QueueMode, OverflowPolicy, PendingItem, EnqueueReceipt } from './queue.js';
export { PendingMessageQueue, DEFAULT_QUEUE_CAPACITY } from './queue.js';
export { startRun, continueRun } from './loop.js';
