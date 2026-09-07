/**
 * memory 模块公开面（core:memory——06 篇 §1-§10 使用进化机制落码件；批 18c）。
 *
 * 单向 DAG（02 §4.1 memory 席 deps = contracts + context + session + persist）。
 * 批 18c-1 域 = 表族三迁移槽 + 入库单点 DAO（secret 扫描 + 版本链拍照）+
 * 合并三分支纯函数 + 效用综合分；18c-2 域 = 持有面动词 + 检索/访问面 +
 * 工具面九件（createMemoryTools）；18c-3 域 = 提取即时路（纠正检测纯函数 +
 * fire-and-forget 编排件——机器源滤除 + owner 恒 global + 精确事件位溯源）；
 * 18c-4 域 = 注入两路（常驻简报 memory/core builder + 按需检索 recall 瞬态
 * 注入——读出消毒统一罩工具读面与注入面、流水 op='recall' 分账）；
 * 18c-5 域 = 周期路（review 编排 + 审阅窗转录 + JSON 三试）+ consolidation
 * 整理拍（absorb/decay/sweepExpired 物理承载 + 护栏四件）+ polluted 会话
 * 资格（判据通配 + 状态机 + 两路入口挂检）；18c-6 域 = 跨会话检索
 * （session_fts 消费件——激活期对账策略位 ensureFtsIndex + snippet 切窗
 * + memory_search 联合检索扩面 [历史会话] 行）；18c-7 域 = 晋升桥候选
 * 点名（简报尾行两形 + BriefBaseline.candidates 权威流）+ 效用进化
 * （cite 引用回写件 cite.ts + dao markUsed/resolveShortId）+ 简报差分
 * （memory/diff durable 词汇 + 纪元 tracker epochs LRU + 懒派生自愈）；
 * 18c-8 域 = 持有面收口（sweep 双清同拍——TTL 物化 + 访问日志 90 天窗口清扫）
 * + 导入导出件（port.ts JSONL 序列化/解析 + command.ts 两命令处理器；
 * provenance 写入面与 skill_manage 三动作经对账钉死已随 14b 落）。
 * 迁移 export-only（host 装配根机械聚合入
 * 宿主单链——05 §6.4）；错误码注册（codes.ts）随本面引入生效。
 */
import './codes.js';

export {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  MEMORY_FUZZY_JACCARD_THRESHOLD,
  MEMORY_POLARITY_JACCARD_THRESHOLD,
  MEMORY_SOURCE_REFS_CAP,
  MEMORY_SUMMARY_MAX_CHARS,
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_ACCESS_LOG_DEFAULT_LIMIT,
  MEMORY_ACCESS_LOG_MAX_LIMIT,
  MEMORY_ACCESS_AGGREGATE_TOP_N,
  MEMORY_SKILL_NAME_RE,
  MEMORY_SKILL_NAME_MAX,
  MEMORY_RECENT_LIMIT,
  MEMORY_DAY_MS,
  MEMORY_BRIEF_MARKER,
  MEMORY_BRIEF_CHAR_LIMIT,
  MEMORY_BRIEF_TOP_N,
  MEMORY_BRIEF_STALE_DAYS,
  MEMORY_RECALL_QUERY_MAX_CHARS,
  MEMORY_RECALL_TOP_K,
  MEMORY_RECALL_POOL_FACTOR,
  MEMORY_RECALL_ROLE,
  MEMORY_REVIEW_TURN_THRESHOLD,
  MEMORY_REVIEW_TOOL_CALL_THRESHOLD,
  MEMORY_REVIEW_WINDOW_TURNS,
  MEMORY_REVIEW_CONFIDENCE,
  MEMORY_CONSOLIDATION_STALE_DAYS,
  MEMORY_OWNER_CAPACITY,
  MEMORY_CONSOLIDATION_ANCHOR_MS,
  MEMORY_DECAY_FACTOR,
  MEMORY_POLLUTION_DEFAULT_PATTERNS,
  MEMORY_SNIPPET_BEFORE,
  MEMORY_SNIPPET_AFTER,
  MEMORY_PROMOTION_KINDS,
  MEMORY_PROMOTION_TOP_N,
  MEMORY_PROMOTION_EVIDENCE_MIN,
  MEMORY_PROMOTION_USAGE_MIN,
  MEMORY_DIFF_EPOCHS_LRU,
  MEMORY_ACCESS_WINDOW_DAYS,
  MEMORY_EXPORT_MAGIC,
  MEMORY_EXPORT_FORMAT_VERSION,
  REVIEW_KINDS,
  llmTextOf,
} from './types.js';
export type {
  MemoryKind,
  MemoryStatus,
  MemorySourceRef,
  MemoryCandidate,
  MemoryRow,
  MemoryVersionRow,
  MergeBranch,
  PolarityWinner,
  MergeDecision,
  IngestAction,
  IngestOutcome,
  MemoryAccessOp,
  MemorySearchHit,
  MemorySearchOptions,
  MemoryHealthCounts,
  MemoryReadOverview,
  MemoryAccessLogQuery,
  MemoryAccessFlowRow,
  MemoryAccessAggregate,
  MemoryAccessLogResult,
  ReviewKind,
  SessionEligibility,
  MemoryLlmFace,
  SessionFtsHit,
  SessionFtsSearchFace,
  FtsAuditReport,
  FtsRebuildReport,
  FtsMaintenanceFace,
  MemoryDiffOp,
  MemoryDiffEntry,
  MemoryDiffData,
  BriefFaceEntry,
  MemoryExportHeader,
  MemoryExportRow,
  MemoryImportOutcome,
} from './types.js';
export { MEMORY_MIGRATIONS } from './migration.js';
export { scanForSecrets, sanitizeEntryForReadout } from './scan.js';
export type { SecretScanHit, ReadoutVerdict } from './scan.js';
export {
  tokenizeForMerge,
  normalizeForMerge,
  jaccard,
  detectPolarityConflict,
  decideMerge,
  utilityScore,
  unionSourceRefs,
} from './merge.js';
export { createMemoryDao, uuidv7 } from './dao.js';
export type { MemoryDao, MemoryDaoDeps } from './dao.js';
export { createMemoryTools } from './tools.js';
export type { MemoryToolsDeps } from './tools.js';
export {
  isEligibleUserSource,
  userTextOf,
  detectCorrectionHit,
  buildCorrectionCandidate,
  createImmediateExtractor,
} from './extract.js';
export type {
  ExtractableUserMessage,
  ExtractableBlock,
  CorrectionHit,
  ImmediateExtractorDeps,
  ImmediateExtractor,
} from './extract.js';
export { MEMORY_CITE_RE, shortIdOf, briefBaseline, renderCoreBrief, buildCoreBrief, recallForQuery } from './inject.js';
export type { BriefEntry, BriefBaseline, CoreBriefDeps, RecallHit, RecallInjection, RecallDeps } from './inject.js';
export { matchesToolPattern, isPollutingToolName, createPollutionTracker } from './pollution.js';
export type { PollutionTracker, PollutionTrackerDeps } from './pollution.js';
export { parseJsonPayload, transcribeForReview, runMemoryReview } from './review.js';
export type { ReviewTranscriptItem, ReviewTranscript, MemoryReviewDeps, ReviewRunResult } from './review.js';
export { createConsolidator } from './consolidate.js';
export type { ConsolidateDeps, ConsolidateRunResult, Consolidator } from './consolidate.js';
export { sliceReviewWindow, createMemoryCycle } from './cycle.js';
export type { FetchEventsFn, MemoryCycleDeps, CycleFireResult, MemoryCycle } from './cycle.js';
export { snippetOf, ensureFtsIndex } from './fts.js';
export type { EnsureFtsDeps, FtsEnsureReport } from './fts.js';
export { parseCitations, createCiteRecorder } from './cite.js';
export type { CiteRecorderDeps, CiteRecorder } from './cite.js';
export {
  MEMORY_DIFF_EVENT_TYPE,
  MEMORY_DIFF_EVENT_META,
  faceOf,
  fingerprintOf,
  diffFace,
  renderDiffInjection,
  createDiffTracker,
} from './diff.js';
export type { DiffAppendEvent, DiffFetchEvents, MemoryDiffDeps, MemoryDiffTracker } from './diff.js';
export {
  isWithinRoots,
  exportRowOf,
  serializeMemoryExport,
  parseMemoryImportHeader,
  parseMemoryImportRow,
  runMemoryImport,
  buildMemoryExport,
} from './port.js';
export type { MemoryPortDaoFace } from './port.js';
export { MEMORY_EXPORT_USAGE, MEMORY_IMPORT_USAGE, runMemoryExportCommand, runMemoryImportCommand } from './command.js';
export type { MemoryExportCommandDeps, MemoryImportCommandDeps } from './command.js';
