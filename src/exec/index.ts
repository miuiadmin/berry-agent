/**
 * exec 件公开面（02 §4.1 席 16：spawn 管道 + bash 工具件 + environment 披露
 * 段 git 摘要件；deps {contracts, context, safety, tools}）。
 *
 * 装载态集成归批 12 装载面后装配批：core:exec 插件装载时经 scope.provide
 * ('exec', { bashTool }) 供给 conversation 的 ExecToolService 结构契约（见
 * conversation/types.ts——契约单源在对端，本件刻意不 import 对端：conversation
 * 边表不可达 exec，反向引用会破 DAG 单向）。
 */
import './codes.js';

// 类型与常量
export type {
  EnvPolicy,
  ExecOutcome,
  ExecResult,
  InteractiveChild,
  InteractiveExit,
  InteractiveSpawnRequest,
  ProcessEntry,
  ProcessRegistry,
  SpawnPipeline,
  SpawnRequest,
  SweepDeps,
} from './types.js';
export { BASH_TIMEOUT_DEFAULT_MS, BASH_TIMEOUT_MAX_MS, OUTPUT_TAIL_BYTES } from './types.js';

// 输出保尾 + env 白名单
export { OutputTail } from './tail.js';
export { buildChildEnv, DEFAULT_ENV_ALLOW } from './env.js';

// 登记簿与孤儿清扫
export { createProcessRegistry, sweepOrphans } from './registry.js';
export type { RegistryOptions, SweepReport } from './registry.js';

// spawn 管道与平台真身
export { createSpawnPipeline, isPidAlive, killProcessTree, readCmdlineSync } from './spawn.js';
export type { SpawnPipelineOptions } from './spawn.js';

// bash 工具件
export { assertNoBackgroundCommand, createBashTool, discoverBash } from './bash.js';
export type { BashToolDeps } from './bash.js';

// environment 披露段 git 摘要
export { gitSummary } from './environment.js';
export type { GitSummary } from './environment.js';
