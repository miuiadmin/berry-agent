/**
 * memory 模块公开面（core:memory——06 篇 §1-§10 使用进化机制落码件；批 18c）。
 *
 * 单向 DAG（02 §4.1 memory 席 deps = contracts + context + session + persist）。
 * 批 18c-1 域 = 表族三迁移槽 + 入库单点 DAO（secret 扫描 + 版本链拍照）+
 * 合并三分支纯函数 + 效用综合分；18c-2 域 = 持有面动词 + 检索/访问面 +
 * 工具面九件（createMemoryTools）；18c-3 域 = 提取即时路（纠正检测纯函数 +
 * fire-and-forget 编排件——机器源滤除 + owner 恒 global + 精确事件位溯源）；
 * 注入两路/周期路/跨会话检索/晋升桥/简报差分随 18c-4..8 逐笔扩本面。
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
} from './types.js';
export { MEMORY_MIGRATIONS } from './migration.js';
export { scanForSecrets } from './scan.js';
export type { SecretScanHit } from './scan.js';
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
