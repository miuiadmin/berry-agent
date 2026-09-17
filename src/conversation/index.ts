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
  AuthRefreshNotice,
  AuthRefreshOutcome,
  AuthRefreshSeam,
  AuthRefreshUnavailableReason,
  ContextTransformInput,
  ConversationDriverOptions,
  ExecToolService,
  ExecSessionDeps,
  PreStepInput,
  ReseededTimeline,
  RetryPolicyConfig,
  RunSettledReceipt,
  SessionLifecycleEvent,
  SubmitOptions,
} from './types.js';
export {
  AGENT_PRE_STEP_EVENT,
  CONTEXT_TRANSFORM_EVENT,
  DEFAULT_RETRY_POLICY,
  SESSION_LIFECYCLE_EVENT,
} from './types.js';
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
  ControlUsedRecord,
  ControlWithdrawReceipt,
  SessionInterruptInput,
  SessionsControlDeps,
  SessionsControlFace,
  SessionSendInput,
  SessionWithdrawInput,
} from './control.js';
export {
  A2A_ROUND_LIMIT_DEFAULT,
  bindControlForPlugin,
  CONTROL_CROSS_CAPABILITY,
  controlSourceOf,
  createSessionsControl,
  SESSIONS_CONTROL_SERVICE,
} from './control.js';
export type { PluginControlFace } from './control.js';
// 跨会话操控工具族（e-4 操控腿——宿主内建固定三件薄包装，恒挂载）
export type { ControlToolsDeps } from './control-tools.js';
export { createControlTools } from './control-tools.js';
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
// 会话用量折叠（R7 批 10k /usage——全 run 累计投影；装配注入通道核）
export type { SessionUsageSummary } from './usage.js';
export { foldSessionUsage, ZERO_SESSION_USAGE } from './usage.js';
// 档位切换面 thinking 半边（2026-09-17 会话档位切换面批 F1——05 §1.1
// session/thinking-level 行写入者兑现：append 面 + fold 读面 + 七档词表单源；
// 单写者律 = 宿主装配独占，host 跨模块消费走本公开面）
export type { ThinkingLevelEventData } from './thinking-level.js';
export {
  foldSessionThinkingLevel,
  isThinkingLevel,
  setSessionThinkingLevel,
  THINKING_LEVELS,
} from './thinking-level.js';
// 档位切换面 sandbox 半边（2026-09-17 会话档位切换面批 F2——05 §1.1
// sandbox/mode 行写入者兑现：append 面 + fold 读面〔委托 safety
// resolveEffectiveMode 零新 fold〕；单写者律 = 宿主装配独占，host 跨模块
// 消费走本公开面）
export type { SandboxModeEventData } from './session-mode.js';
export { foldSessionSandboxMode, setSessionMode } from './session-mode.js';
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
