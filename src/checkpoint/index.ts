/**
 * checkpoint 模块公开面（05 §5.3 批 15d——工作区快照/回退件）。
 *
 * 消费面：gate 监听器（host 装配根挂 tools_pre_execute waterfall，位于
 * safety 守门行之后）+ /rewind 命令（TUI 命令注册挂批 12）。codes.js 的
 * import 副作用 = 错误码注册纪律（import 发生才注册）。
 */
import './codes.js';

export {
  CHECKPOINT_RETENTION_PER_WORKSPACE,
  CHECKPOINT_WALK_FILE_CAP,
  type CheckpointFileEntry,
  type CheckpointManifest,
  type CheckpointTrigger,
  type GateInputWithSession,
  type RewindForkFace,
  type SessionContextFace,
} from './types.js';

export { readWorkspaceFile, walkWorkspaceFiles, type WalkedFile } from './walk.js';

export { contentHash, openCheckpointStore, type CheckpointStore } from './store.js';

export { createCapture, type CaptureFn, type CaptureOptions } from './capture.js';

export { createCheckpointGate, type CheckpointGateDeps, type CheckpointGateListener } from './gate.js';

export {
  previewRewind,
  restoreRewind,
  type RewindPreviewResult,
  type RewindRestoreDeps,
  type RewindRestoreReceipt,
} from './restore.js';

export { REWIND_USAGE, runRewindCommand, type RewindCommandDeps } from './command.js';
