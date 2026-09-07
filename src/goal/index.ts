/**
 * goal 模块公开面（L3——02 §4.1 席 23；机制真源 03 §10.5 + 04 §12）。
 *
 * 本批落码：goals 表族（migration v3）+ 计划态跨轮 fold（goal 段倒扫）+
 * todo 工具换装件（GOAL_TODO_SCOPE 段约束双向执法）+ goal_update 终态申报件
 * （完成否决律机器面）+ 判据门三源评测（fail-closed）+ GoalService（生命周期/
 * wake 双帽/停滞硬停/重绑护栏/归因落账/预算双轨/挂钟迟到注入）+ /goal 命令。
 * 装载态集成（批 19c-3 部分兑现）：todo 换装（openTools todoTool 注入位）、
 * goalScopeFor 注入（组合根闭包 → 驱动 fold 升格锚）、挂钟引擎消费（双序
 * 迟到注入）三件已入册 core:goal；prepareNextTurn 轮间沉淀与 agent_pre_step
 * 预算复验挂账 run 入口批——两发射位在 agent 域驱动循环编舞（waterfall 词
 * 无发射者 + turn 间 seam），与 scheduler 起停编舞同笔归入口。
 */
import './codes.js';

export { GOAL_MIGRATION } from './migration.js';
export type {
  GoalStatus,
  GoalRow,
  GoalWakeRow,
  GoalTodoItem,
  GateSpec,
  GateOutcome,
  GoalJobsFace,
  GoalScope,
  GoalSessionFace,
  WakeDecision,
} from './types.js';
export { foldGoalTodos, openGoalItems, progressFingerprint, parseResumeWhen, validateGoalTodoItems } from './fold.js';
export {
  evaluateGoalGates,
  GATE_COMMAND_TIMEOUT_MS,
  type GoalGateDeps,
  type GateExecSeam,
  type GateLspSeam,
} from './gates.js';
export { createGoalTodoTool, type GoalTodoToolDeps } from './todo-tool.js';
export { createGoalUpdateTool, type GoalUpdateToolDeps } from './update-tool.js';
export {
  createGoalService,
  DEFAULT_STALL_LIMIT,
  DEFAULT_WAKE_BUDGET_LIMIT,
  type ActivateGoalRequest,
  type GoalServiceDeps,
  type GoalService,
} from './service.js';
export { runGoalCommand, GOAL_USAGE, type GoalCommandDeps } from './command.js';
