/**
 * host/plugin-market/registry —— 源清单账本 marketplaces.json（03 §9.6 源
 * 清单节）：文件域账本（数据目录根、不进 SQLite）；形状校验 fail-loud 不炸
 * 宿主（result 面）；原子写 tmp+rename（同 ledger 律）；纯 CRUD 基座。
 *
 * 零源出厂：文件缺席 = 空清单（首启零文件零报错——不预置任何源）。
 */
import {
  isValidNameSegment,
  type MarketplaceSourceRecord,
  type MarketplaceSourceType,
  type MarketFs,
  type MarketplaceSourcesFile,
} from './types.js';

/** 源清单文件路径：数据目录根下 marketplaces.json */
export function marketplacesFilePath(dataDir: string): string {
  return `${dataDir}/marketplaces.json`;
}

/** 读侧产物：坏形 fail-loud（message 归因）——不静默空、不抛 */
export type ReadSourcesResult =
  | { readonly ok: true; readonly sources: readonly MarketplaceSourceRecord[] }
  | { readonly ok: false; readonly message: string };

/** 源分类四值执法集 */
const SOURCE_TYPES: readonly MarketplaceSourceType[] = ['github', 'git', 'url', 'local'];

/** 单条源记录形状校验（返回 null = 好形；否则坏形原因） */
function recordShapeError(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return '源条目非对象';
  }
  const record = entry as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || !isValidNameSegment(record['name'])) {
    return `源条目 name 缺席或坏词法（"${String(record['name'])}"）`;
  }
  if (
    typeof record['sourceType'] !== 'string' ||
    !SOURCE_TYPES.includes(record['sourceType'] as MarketplaceSourceType)
  ) {
    return `源条目 ${String(record['name'])} sourceType 越枚举（"${String(record['sourceType'])}"）`;
  }
  if (typeof record['sourceUri'] !== 'string' || record['sourceUri'] === '') {
    return `源条目 ${String(record['name'])} sourceUri 缺席`;
  }
  if (typeof record['catalogPath'] !== 'string' || record['catalogPath'] === '') {
    return `源条目 ${String(record['name'])} catalogPath 缺席`;
  }
  if (typeof record['addedAt'] !== 'string') {
    return `源条目 ${String(record['name'])} addedAt 非串`;
  }
  if (typeof record['updatedAt'] !== 'string') {
    return `源条目 ${String(record['name'])} updatedAt 非串`;
  }
  if (record['commit'] !== undefined && typeof record['commit'] !== 'string') {
    return `源条目 ${String(record['name'])} commit 非串`;
  }
  return null;
}

/**
 * 读源清单（形状校验 fail-loud）：文件缺席 = 空清单（零源出厂）；任何坏形
 * （坏 JSON / 顶层非对象 / version≠1 / marketplaces 非数组 / 条目坏形）=
 * ok:false——**不静默空**（坏账本静默空 = 源无故消失的失明面）。
 */
export function readMarketplaceSources(dataDir: string, fs: MarketFs): ReadSourcesResult {
  const text = fs.read(marketplacesFilePath(dataDir));
  if (text === null) {
    return { ok: true, sources: [] }; // 文件缺席——空清单（零源出厂）
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'marketplaces.json 坏 JSON（无法解析）' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'marketplaces.json 顶层须 JSON 对象' };
  }
  const doc = parsed as Record<string, unknown>;
  if (doc['version'] !== 1) {
    return { ok: false, message: `marketplaces.json version 须 1（实得 ${String(doc['version'])}）` };
  }
  if (!Array.isArray(doc['marketplaces'])) {
    return { ok: false, message: 'marketplaces.json marketplaces 须数组' };
  }
  // 逐条形状校验——单条坏形即整文件 fail-loud（账本是人可读小文件，全拒比半读诚实）
  for (const entry of doc['marketplaces']) {
    const shapeError = recordShapeError(entry);
    if (shapeError !== null) {
      return { ok: false, message: `marketplaces.json ${shapeError}` };
    }
  }
  return { ok: true, sources: doc['marketplaces'] as readonly MarketplaceSourceRecord[] };
}

/**
 * 写源清单（原子写 tmp+rename——同 ledger 律；写侧恒出顶层 version 1 规范形；
 * 人类可读缩进——账本定位是文件域可直查）。
 */
export function writeMarketplaceSources(
  dataDir: string,
  sources: readonly MarketplaceSourceRecord[],
  fs: MarketFs,
): void {
  const path = marketplacesFilePath(dataDir);
  const tmp = `${path}.tmp-${process.pid}`;
  fs.write(tmp, `${JSON.stringify({ version: 1, marketplaces: sources }, null, 2)}\n`);
  fs.rename(tmp, path);
}

/**
 * 纯 CRUD：追加源记录（保序尾追加；撞名抛——信任裁决是用户显式动作，静默
 * 换血等于改写用户已审计的源）。返回新账本（原账本不动——不可变更新）。
 */
export function addSourceRecord(file: MarketplaceSourcesFile, record: MarketplaceSourceRecord): MarketplaceSourcesFile {
  if (file.marketplaces.some((existing) => existing.name === record.name)) {
    throw new Error(`市场 "${record.name}" 已在源清单——如需重新装载请先 remove 再 add`);
  }
  return { version: 1, marketplaces: [...file.marketplaces, record] };
}

/** 纯 CRUD：删除源记录（查无抛——删除位点名失败须诚实，不静默幂等） */
export function removeSourceRecord(file: MarketplaceSourcesFile, name: string): MarketplaceSourcesFile {
  const index = file.marketplaces.findIndex((existing) => existing.name === name);
  if (index === -1) {
    throw new Error(`市场 "${name}" 不在源清单——无可删除`);
  }
  return { version: 1, marketplaces: file.marketplaces.filter((existing) => existing.name !== name) };
}
