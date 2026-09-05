/**
 * compaction 模块公开面（L3 宿主固定件——02 篇席 9，随裁决①入宿主；机制真源 05 篇 §2.1/§2.3）。
 *
 * 本批落码：五步骨架两事件形（摘要普通 append + compaction/surface 正门信封）
 * + 阈值/溢出双触发路 + 全局串行队列 + per-session 防抖分账（帽 256 空闲逐出）。
 * host 装配四件（阈值配置/触发器接线/complete 通道 provide/防抖参数）随 host 批。
 */
export * from './types.js';
export {
  SUMMARY_PREFIX,
  buildSummaryPrompt,
  evaluateThreshold,
  inCooldown,
  planSegment,
  previousSummaryText,
  summaryBudgetFor,
} from './policy.js';
export { createCompactionService } from './service.js';
export type { CompactionServiceOptions } from './service.js';
