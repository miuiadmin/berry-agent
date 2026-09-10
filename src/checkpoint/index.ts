/**
 * checkpoint 模块公开面（05 §5.3 批 15d——工作区快照/回退件）。
 *
 * 消费面（批 19c-4 装载态入册兑现）：gate 监听器（core:checkpoint 件经
 * 插件钩子正门 ctx.on('tools_pre_execute') 挂 waterfall——装载期注册先于
 * per-session safety 行，序差无害注记见 core-plugins.ts 装配序注记）+
 * /rewind 命令（ctx.channels.registerCommand——发起会话 = 焦点会话；
 * adopt 切前台编舞 v1 未落——restore 回执的 forkedSessionId 先经命令输出
 * 面呈报，焦点切换随 TUI adopt 命令立题〔2026-09-11 遗漏扫描批勘正——
 * 原注指向已飞的 run 入口批，失锚〕）。codes.js 的 import 副作用 = 错误码
 * 注册纪律（import 发生才注册）。
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
