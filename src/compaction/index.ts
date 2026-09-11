/**
 * compaction 模块公开面（L3 宿主固定件——02 篇席 9，随裁决①入宿主；机制真源 05 篇 §2.1/§2.3）。
 *
 * 本批落码：五步骨架两事件形（摘要普通 append + compaction/surface 正门信封）
 * + 阈值/溢出双触发路 + 全局串行队列 + per-session 防抖分账（帽 256 空闲逐出）。
 * host 装配四件（阈值配置/触发器接线/complete 通道 provide/防抖参数）随 host 批。
 * 2026-09-09 U4 批：槽位化三类型（SummarizerFn/SessionBeforeCompactInput）+
 * COMPACTION_ 码族注册（import 发生才注册——公开面引入即注册纪律）+ U4-3
 * 装配件（席位容器 slots——createCompactionSlots 席位状态机 + 值链归因铸造
 * 两律机制件，host 装配层消费）。
 */
import './codes.js';
export * from './types.js';
export {
  BEFORE_COMPACT_ATTRIB,
  createCompactionSlots,
  forgeBeforeCompactIdentity,
  markBeforeCompactRewrite,
  type BeforeCompactAttribution,
  type CompactionPluginFace,
  type CompactionSlotsHandle,
  type CompactionSlotsOptions,
} from './slots.js';
export {
  SUMMARY_PREFIX,
  buildSummaryPrompt,
  evaluateThreshold,
  inCooldown,
  planFromRange,
  planSegment,
  previousSummaryText,
  summaryBudgetFor,
  validateAdjustedRange,
} from './policy.js';
export { createCompactionService } from './service.js';
export type { CompactionServiceOptions } from './service.js';
export {
  CCR_MARKER_PREFIX,
  ccrDirectoryOf,
  ccrHashOf,
  stripCcrSection,
  withCcrSection,
  type CcrDirectoryEntry,
} from './ccr.js';
export { createCcrRetrieveTool, type CcrToolsDeps } from './ccr-tools.js';
