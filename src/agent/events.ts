/**
 * agent 件 — AgentEvent 活体事件族（04 篇 §2 机制真源）。
 *
 * 归位注记（2026-09-08 U3 落码批）：类型族（RunStatus/DeliverChannel/
 * AgentEvent/AgentEventSink）归位 contracts/agent-events.ts——插件侧 UI 后端
 * 类型可达（03 §2.2 registerUiBackend 定形注记：虚拟主键 `berry-agent` 面只达
 * contracts）；本件 re-export 维持 agent 公开面与件内消费路径不变（批 11b
 * ApprovalAsk 归位同款先例）。顺序铁律与活体流纪律的成文真源随类型走
 * （contracts/agent-events.ts 件头）。
 */
export type { AgentEvent, AgentEventSink, DeliverChannel, RunStatus } from '../contracts/index.js';
