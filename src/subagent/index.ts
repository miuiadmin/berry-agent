/**
 * subagent 件公开面（04 §10——ctx.jobs 注册表 + SubagentProvider 委派机器）。
 *
 * 消费方：host 装配根（in-process 真工厂接线 + provideJobsService）、
 * exec/issue 同表消费件（registerKind 'process'/'issue'）、组合根（通知面
 * 与结算钩子桥接）。in-process 真工厂本体归 host 装配批——本件提供机器
 * 与 late-binding 接缝（15a/15b 先例：装载态挂账、批内机器先行）。
 */
import './codes.js';

export { isTerminalStatus, JOB_RETENTION_CAP, createJobRegistry } from './registry.js';
export type { JobRegistry, JobRegistryOptions, JobHandle, JobSettledEmitter } from './registry.js';

export {
  AGENT_TOOL_NAME,
  DEFAULT_SUBAGENT_PROVIDER,
  EXCLUDED_FROM_DERIVED_SURFACE,
  IN_PROCESS_CAPABILITIES,
} from './types.js';
export type {
  DelegationInput,
  DelegationOutcome,
  DelegationSettlement,
  ResolvedRequest,
  SubagentNotifyFace,
} from './types.js';
export type { SubagentDef } from '../contracts/index.js';

export { deriveToolSurface, findPrecheckGaps, intersectToolWhitelist } from './surface.js';

export { subagentSettledContent } from './notify.js';

export { createSubagentService } from './service.js';
export type { SubagentService, SubagentServiceOptions } from './service.js';

export { createAgentTool, createDeclarativeAgentTool } from './tool.js';
export type { DelegationToolDeps } from './tool.js';

export { defBoundProvider, materializeDeclarativeSubagents } from './declarative.js';
export type { MaterializedSubagents } from './declarative.js';

export { JOBS_SERVICE_NAME, provideJobsService } from './provide.js';
