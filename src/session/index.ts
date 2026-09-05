/**
 * session 模块公开面（L1 会话事件日志——02 §2.2 席 9；机制真源 05 篇）。
 *
 * 本批落码：append 七步流水线（词汇/信封/快照冻结/预算刀/尾部追加/入队回调）
 * + surfaceOp 遮蔽（appendWithSurfaceOp 正门 + 边缘纪律执法）+ 投影（derive/
 * FoldState 增量/occludedSeqs）+ 崩溃恢复（recoverClosers 合成）+ fork 前缀
 * 种子（forkPrefix/slicePrefix/ensureSeeded）+ 导入四闸。
 * 物理落盘（write-behind 批落/SQLite）在 persist（L2，依赖本模块）；ctx.sessions
 * 只读服务面随 host 装配批接线。
 */
import './codes.js';

export { SessionLog } from './session.js';
export type { SessionLogOptions, AppendOptions } from './session.js';
export * from './snapshot.js';
export * from './budget.js';
export type {
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ImageBlock,
  TurnStartData,
  TurnEndData,
  UserMessageData,
  AssistantMessageData,
  ToolCallData,
  ToolResultData,
  RequestHeaderData,
  EndSeedData,
  LlmRetryData,
} from './event-data.js';
export {
  createFoldState,
  stepFold,
  snapshotProjection,
  applyOcclusion,
  occludedSeqs,
  deriveMessages,
  projectedJsonChars,
} from './derive.js';
export type { ProjectedMessage, ProjectedToolCall, FoldState } from './derive.js';
export { recoverClosers, firstSeqBreak, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from './recover.js';
export type { SyntheticDraft } from './recover.js';
export { forkPrefix, slicePrefix, isSeededPrefix } from './fork.js';
export { parseImportFile, vocabularyGate, pairingGate, SessionSpawnLimiter, runImportGates } from './import-gates.js';
export type { ImportMeta, ParsedImport } from './import-gates.js';
