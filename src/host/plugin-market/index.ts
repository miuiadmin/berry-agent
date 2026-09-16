/**
 * host/plugin-market 公开面（03 §9.6 市场层——host 子件目录服务，零 DAG
 * 席位变化）。mp-2 读侧核心批出口：契约（types）+ catalog 解析/读序 + 源
 * 分类 + 源清单账本 + TTL 判据 + 聚合呈现 + add 编舞 + 翻译矩阵 + fs 真身
 * 工厂。mp-3 装机咬合（install/CLI）与 mp-4 网络源真身（fetch 抓取面 +
 * update/upgrade 服务面）从本面消费。
 */
export * from './types.js';
export {
  CATALOG_RELATIVE_PATHS,
  applyPluginRoot,
  foldRelativeSegments,
  loadCatalogFromRoot,
  parseMarketplaceCatalog,
  resolveEntryVersion,
  resolveRelativeSubpath,
} from './catalog.js';
export type { CatalogLoadResult, CatalogParseResult } from './catalog.js';
export { classifyMarketplaceSource, expandGitUri, expandHomePath, githubShorthandToUrl } from './classify.js';
export type { ClassifyResult } from './classify.js';
export {
  addSourceRecord,
  marketplacesFilePath,
  readMarketplaceSources,
  removeSourceRecord,
  writeMarketplaceSources,
} from './registry.js';
export type { ReadSourcesResult } from './registry.js';
export { translateEntrySource } from './translate.js';
export type { TranslateResult } from './translate.js';
export { MARKETPLACE_TTL_MS, isCatalogStale } from './ttl.js';
export { discoverMarketplaces } from './discover.js';
export type { DiscoverDeps } from './discover.js';
export { addMarketplaceSource } from './add.js';
export type { AddMarketplaceDeps, AddMarketplaceResult } from './add.js';
export { createMarketFs } from './fs.js';
export {
  MARKET_CATALOG_MAX_BYTES,
  MARKET_CLONE_TIMEOUT_MS,
  MARKET_FETCH_MAX_REDIRECTS,
  MARKET_FETCH_TIMEOUT_MS,
  createMarketFetchFace,
} from './fetch.js';
export type { MarketFetchOptions } from './fetch.js';
export { refreshMarketplaceSource, updateMarketplaceSources, upgradeMarketplacePlugins } from './update.js';
export type {
  SourceRefreshOutcome,
  UpdateMarketplaceDeps,
  UpgradeEntryOutcome,
  UpgradeMarketplaceDeps,
  UpgradeResult,
} from './update.js';
