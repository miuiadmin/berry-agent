/**
 * memory 模块公开面（core:memory——06 篇 §1-§10 使用进化机制落码件；批 18c）。
 *
 * 单向 DAG（02 §4.1 memory 席 deps = contracts + context + session + persist）。
 * 批 18c-1 域 = 表族三迁移槽 + 入库单点 DAO（secret 扫描 + 版本链拍照）+
 * 合并三分支纯函数 + 效用综合分；提取/注入/工具面/跨会话检索/晋升桥/简报差分
 * /持有面动词随 18c-2..8 逐笔扩本面。迁移 export-only（host 装配根机械聚合入
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
