/**
 * conversation 模块公开面（02 §4.1 #11 对话本体——裁决①并入不可卸）。
 *
 * 批 11b 契约先行起面：构造契约（ConversationDriverOptions + 注入族）与
 * 重播种纯函数；批 11c 起 driver 本体入此面（durable 接线 + runTurns 重试
 * 循环 + 溢出兜底 + 队列通道机制面）；三通道路由收口/取消模型/resume 续接
 * 归 11d，open 域工具与审批三件归 11e，ctx.agent 服务面/多会话编排/披露段
 * 注入/审批挂起通知归 11f；批 12 host 装配根消费。
 */
export type {
  ContextTransformInput,
  ConversationDriverOptions,
  ExecToolService,
  ExecSessionDeps,
  ReseededTimeline,
  RetryPolicyConfig,
  SessionLifecycleEvent,
  SubmitOptions,
} from './types.js';
export { CONTEXT_TRANSFORM_EVENT, DEFAULT_RETRY_POLICY, SESSION_LIFECYCLE_EVENT } from './types.js';
export { reseedTimeline } from './reseed.js';
export { ConversationDriver } from './driver.js';
export type { SubmitResult } from './driver.js';
// 操控面码注册（02 §5.3 SESSION_ 族操控五码——e-4 落码批；import 发生才注册）
import './codes.js';
// 跨会话操控面（03 §2.2 第十一面 sessions-control——e-4 落码批：契约 + 受理器）
export type {
  ControlCaller,
  ControlInterruptReceipt,
  ControlSendReceipt,
  ControlWithdrawReceipt,
  SessionInterruptInput,
  SessionsControlFace,
  SessionSendInput,
  SessionWithdrawInput,
} from './control.js';
export {
  A2A_ROUND_LIMIT_DEFAULT,
  CONTROL_CROSS_CAPABILITY,
  controlSourceOf,
  SESSIONS_CONTROL_SERVICE,
} from './control.js';
// todo 机器（11e：fold 推导 + conversation/todo 角色 + 快照注入 + 工具件；
// 15b：goal 段升格窄面 TodoGoalScope——组合根 goalScopeFor 闭包注入位）
export type { TodoItemData, TodoGoalScope } from './todo.js';
export {
  TODO_ROLE,
  createTodoTool,
  ensureTodoRole,
  foldTodoTable,
  renderTodoTable,
  todoSnapshotMessage,
} from './todo.js';
// 审批三件 + open 域装配（11e：fresh 作用域审批 wiring + fs/检索/bash/todo 组装面）
export type { SessionApprovalOptions, SessionApprovalWiring } from './approval-wiring.js';
export { wireSessionApproval } from './approval-wiring.js';
export type { OpenToolsOptions, OpenToolsAssembly } from './open-tools.js';
export { assembleOpenTools } from './open-tools.js';
// ctx.agent 服务面 + 多会话编排（11f：onRunSettled 终态订阅 / SessionManager）
export type { AgentService, RunSettledEvent } from './agent-service.js';
export { AGENT_SERVICE_NAME, notifyRunSettled, provideAgentService } from './agent-service.js';
export type {
  DriverFactory,
  ForkOutcome,
  ForkVetoed,
  ForkedSession,
  OpenedSession,
  SessionBeforeForkInput,
  SessionManagerOptions,
} from './sessions.js';
export { SESSION_HOOK_NAMES, SessionManager } from './sessions.js';
