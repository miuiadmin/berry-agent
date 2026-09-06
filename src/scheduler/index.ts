/**
 * scheduler 件公开面（02 §4.1 席 22 [L3, deps contracts+context+persist]：
 * jobs 表 + 进程内挂钟 + /tick + DiscoveryGates + cron 可选后端；04 §12）。
 *
 * 装载态集成归批 12 装载面后装配批：ctx.schedule 消费面（03 §10.7）、
 * channels /tick 注册、--tick CLI 编舞、真 bin spawn 接线、GateFacts 从宿主
 * 面收集（agentBusy/lastUserMessageAt/canAfford）——本件纯逻辑 + 全接缝注入。
 */
import './codes.js';

// 类型与常量
export type { JobRow, RunOutcome, SchedulerDeps, TriggerKind } from './types.js';

// schedule 串词法/校验/推刻（纯函数）
export {
  formatSchedule,
  MIN_INTERVAL_SECONDS,
  nextFireAt,
  parseSchedule,
  resolveRelativeOnce,
  type Schedule,
} from './schedule.js';

// 迁移
export { SCHEDULER_MIGRATION } from './migration.js';

// DiscoveryGates 触发前置条件门
export {
  evaluateGates,
  GATE_ORDER,
  JOB_COOLDOWN_MS,
  USER_QUIET_WINDOW_MS,
  type GateBlock,
  type GateContext,
  type GateFacts,
  type GateId,
} from './gates.js';

// jobs 表 DAO + 六动词服务面 + GoalJobsFace 第五槽
export {
  createSchedulerService,
  JobsDao,
  type AddJobRequest,
  type GoalJobsFace,
  type SchedulerService,
  type SchedulerServiceDeps,
} from './service.js';

// runner（执行接缝 + 进程实装）
export {
  createProcessRunnerFactory,
  type ProcessRunnerOptions,
  type RunnerFactory,
  type RunnerHandle,
  type RunnerRequest,
} from './runner.js';

// 进程内挂钟引擎
export {
  createSchedulerEngine,
  DEFAULT_MAX_CONCURRENT,
  FIRE_WALL_TIMEOUT_MS,
  MAX_POLL_MS,
  MIN_POLL_MS,
  realTimerSeam,
  type SchedulerEngine,
  type SchedulerEngineDeps,
  type TimerSeam,
} from './engine.js';

// cron 可选后端（OS 注册器乙案）
export {
  createOsCronRegistrar,
  cronMarker,
  scheduleToCron,
  type CronBackendDeps,
  type CronRegistrar,
  type CrontabResult,
} from './cron-backend.js';

// /tick 命令处理器（纯程序面——argv → 人读文本）
export { describeOutcome, runTickCommand, TICK_USAGE, type TickCommandDeps } from './tick.js';
