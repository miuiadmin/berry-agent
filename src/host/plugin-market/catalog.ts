/**
 * host/plugin-market/catalog —— catalog 解析与双路径读序（03 §9.6 catalog
 * 兼容形节；mp-2 读侧核心）。
 *
 * 容错分级（§9.6 定形）：
 *  - **catalog 级坏形 = 整仓拒**：坏 JSON / 顶层非对象 / 必填缺席（name、
 *    owner.name、plugins[]）/ catalog 名坏词法——result 面 {ok:false, reason}
 *    （带源标签）；
 *  - **条目级坏形 = warn 跳过**：name 缺席或坏词法 / source 五形之外——好
 *    条目照常可用，跳过账逐条透传（「坏条目跳过、坏目录拒收」）。
 *
 * 未知字段保留不拒（前向兼容——catalog 是外源数据）：解析产物持原对象引用
 * 不重建，omp/Claude 扩展字段零解读零拒绝、天然随行。
 */
import {
  isValidNameSegment,
  type CatalogSkipNote,
  type MarketplaceCatalog,
  type MarketplacePluginEntry,
  type MarketFs,
} from './types.js';

/** 双路径读序：`.omp-plugin` 优先 → `.claude-plugin` 回落（不自造第三路径） */
export const CATALOG_RELATIVE_PATHS = ['.omp-plugin/marketplace.json', '.claude-plugin/marketplace.json'] as const;

/** catalog 级解析产物：ok=true 时 skipped 为条目级跳过账（可为空数组） */
export type CatalogParseResult =
  | {
      readonly ok: true;
      readonly catalog: import('./types.js').MarketplaceCatalog;
      readonly skipped: readonly CatalogSkipNote[];
    }
  | { readonly ok: false; readonly reason: string };

/** 双路径读序产物：读序命中后解析面成败由 parse 字段透传 */
export interface CatalogLoadResult {
  readonly ok: true;
  readonly catalogPath: string;
  readonly parse: CatalogParseResult;
}

/**
 * 条目源五形形状校验（parse 侧只查形状——深度词法/逃逸执法在翻译层）。
 * 返回 null = 好形；否则返回跳过原因（进条目级跳过账）。
 */
function entrySourceShapeError(source: unknown): string | null {
  // 形 1：相对串——须 "./" 起头（市场仓内子目录形；"/abs" 裸相对等拒）
  if (typeof source === 'string') {
    return source.startsWith('./') ? null : '字符串 source 须 "./" 相对形';
  }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return 'source 缺席或非形';
  }
  const record = source as Record<string, unknown>;
  // 形 2-5：判别字段 source + 各形必填位
  switch (record['source']) {
    case 'github':
      return typeof record['repo'] === 'string' && record['repo'] !== '' ? null : 'github 形缺 repo';
    case 'url':
      return typeof record['url'] === 'string' && record['url'] !== '' ? null : 'url 形缺 url';
    case 'git-subdir':
      return typeof record['url'] === 'string' &&
        record['url'] !== '' &&
        typeof record['path'] === 'string' &&
        record['path'] !== ''
        ? null
        : 'git-subdir 形缺 url/path';
    case 'npm':
      return typeof record['package'] === 'string' && record['package'] !== '' ? null : 'npm 形缺 package';
    default:
      return '对象 source 无判别字段或未知 variant';
  }
}

/**
 * catalog 文档解析（容错分级执法位）。label = 源标签（catalog 相对路径或
 * 源名/路径），坏形 reason 携 label 供 CLI 归因。
 */
export function parseMarketplaceCatalog(text: string, label: string): CatalogParseResult {
  // —— catalog 级：坏 JSON / 顶层非对象 = 整仓拒 ——
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${label}：catalog JSON 坏形（无法解析）` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: `${label}：catalog 顶层须 JSON 对象` };
  }
  const doc = parsed as Record<string, unknown>;

  // —— catalog 级：必填最小集缺席 = 整仓拒（name / owner.name / plugins[]）——
  if (typeof doc['name'] !== 'string' || !isValidNameSegment(doc['name'])) {
    return { ok: false, reason: `${label}：catalog name 缺席或坏词法（"${String(doc['name'])}"）` };
  }
  const owner = doc['owner'];
  if (
    owner === null ||
    typeof owner !== 'object' ||
    Array.isArray(owner) ||
    typeof (owner as Record<string, unknown>)['name'] !== 'string' ||
    (owner as Record<string, unknown>)['name'] === ''
  ) {
    return { ok: false, reason: `${label}：catalog owner.name 缺席或坏形` };
  }
  if (!Array.isArray(doc['plugins'])) {
    return { ok: false, reason: `${label}：catalog plugins 须数组` };
  }

  // —— 条目级：坏形 warn 跳过，好条目照常可用 ——
  const plugins: MarketplacePluginEntry[] = [];
  const skipped: CatalogSkipNote[] = [];
  for (const raw of doc['plugins']) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      skipped.push({ reason: '条目非对象——跳过' });
      continue;
    }
    const entry = raw as Record<string, unknown>;
    // 条目名词法（市场名域——多允许点号的 omp 律；装机侧 berry id 词法由插件清单自身承载）
    if (typeof entry['name'] !== 'string' || !isValidNameSegment(entry['name'])) {
      const note: { name?: string; reason: string } = {
        reason: `条目名缺席或坏词法（"${String(entry['name'])}"）——跳过`,
      };
      if (typeof entry['name'] === 'string') note.name = entry['name'];
      skipped.push(note);
      continue;
    }
    const shapeError = entrySourceShapeError(entry['source']);
    if (shapeError !== null) {
      skipped.push({ name: entry['name'], reason: `条目 source 坏形：${shapeError}` });
      continue;
    }
    // 原对象直通——未知字段（strict/commands 等）保留随行
    plugins.push(raw as MarketplacePluginEntry);
  }

  // 产物 = 原文档展开 + plugins 换滤后数组（顶层未知字段 spread 随行——
  // ompExtensions 等外源扩展零丢失；条目级原对象直通同保）
  const catalog = { ...doc, plugins } as unknown as MarketplaceCatalog;
  return { ok: true, catalog, skipped };
}

/**
 * 双路径读序：root 下按 CATALOG_RELATIVE_PATHS 序找 catalog 文件。
 * 双缺席 = ok:false（reason 含两候选路径）；命中后内容好坏由 parse 透传
 * （读侧只管「找到没有」，内容执法归 parse——分层各司其职）。
 */
export function loadCatalogFromRoot(
  root: string,
  fs: MarketFs,
): CatalogLoadResult | { readonly ok: false; readonly reason: string } {
  for (const relative of CATALOG_RELATIVE_PATHS) {
    const text = fs.read(`${root}/${relative}`);
    if (text === null) continue; // 该路径缺席——试下一序
    return { ok: true, catalogPath: relative, parse: parseMarketplaceCatalog(text, relative) };
  }
  return {
    ok: false,
    reason: `catalog 双路径全缺席（${CATALOG_RELATIVE_PATHS[0]} 与 ${CATALOG_RELATIVE_PATHS[1]}）——该目录非市场仓形`,
  };
}

/**
 * 相对路径段折叠加固（逃逸执法单源）：'.' 段丢弃；'..' 段出界（折叠深度
 * 负）即逃逸返 null；其余段原样保留（'..x' 是合法目录名——不误伤）。
 * 空 段（连续斜线/首尾斜线）丢弃。translate 的 git-subdir path 执法共用。
 */
export function foldRelativeSegments(path: string): string[] | null {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue; // 空段与自指段——丢弃
    if (segment === '..') {
      if (out.length === 0) return null; // 出界——逃逸
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out;
}

/**
 * pluginRoot 前缀改写（metadata.pluginRoot = monorepo 布局位）：缺席直通；
 * 在场则前缀拼接（产物保持 "./" 形）。pluginRoot 自身逃逸段/绝对形 = 拒
 * （路径注入防线——改写产物随后仍过 resolveRelativeSubpath 二次执法）。
 */
export function applyPluginRoot(
  source: string,
  pluginRoot?: string,
): { readonly ok: true; readonly rewritten: string } | { readonly ok: false; readonly message: string } {
  if (pluginRoot === undefined || pluginRoot === '') {
    return { ok: true, rewritten: source }; // 缺席——原样直通
  }
  if (pluginRoot.startsWith('/')) {
    return { ok: false, message: `pluginRoot 须相对形（"${pluginRoot}" 是绝对路径）` };
  }
  if (foldRelativeSegments(pluginRoot) === null) {
    return { ok: false, message: `pluginRoot 逃逸段拒（"${pluginRoot}"）` };
  }
  return { ok: true, rewritten: `./${pluginRoot}/${source.slice(2)}` };
}

/**
 * 相对子路径解析（逃逸拒——pathIsWithin 同族防线）：先 pluginRoot 前缀改写
 * 再段折叠。产物 subpath 为仓/目录根相对形（无 "./" 前缀——拷贝腿直接拼位）。
 */
export function resolveRelativeSubpath(
  source: string,
  pluginRoot?: string,
): { readonly ok: true; readonly subpath: string } | { readonly ok: false; readonly message: string } {
  if (!source.startsWith('./')) {
    return { ok: false, message: `相对源须 "./" 形（"${source}"）` };
  }
  const applied = applyPluginRoot(source, pluginRoot);
  if (!applied.ok) {
    return { ok: false, message: applied.message };
  }
  const folded = foldRelativeSegments(applied.rewritten);
  if (folded === null) {
    return { ok: false, message: `相对源路径逃逸出市场仓根——拒（"${source}"）` };
  }
  if (folded.length === 0) {
    return { ok: false, message: `相对源解析为空路径——拒（"${source}"）` };
  }
  return { ok: true, subpath: folded.join('/') };
}

/** 版本回落的 manifest 三位序（`.claude-plugin/plugin.json` → `plugin.json` → `package.json`） */
const MANIFEST_PATHS = ['.claude-plugin/plugin.json', 'plugin.json', 'package.json'] as const;

/**
 * 条目版本四级回落（omp 同序）：
 *  1. catalog 条目自带 version；
 *  2. 插件目录内 manifest 三位序（root = 插件目录；null = 跳过本级——
 *     相对源子路径不可信时用；**仅字符串源条目读本级**——远端形条目缓存内
 *     无插件目录，读市场根 manifest 会张冠李戴）；
 *  3. 条目源对象 sha 前 7 位；
 *  4. `0.0.0`。
 * manifest 坏 JSON / version 非串 = 跳下一位（不炸——呈现面宽松执法）。
 */
export function resolveEntryVersion(entry: MarketplacePluginEntry, root: string | null, fs: MarketFs): string {
  // 第 1 级：条目自带 version 直用
  if (typeof entry.version === 'string' && entry.version !== '') {
    return entry.version;
  }
  // 第 2 级：manifest 三位序（仅本地在场形——字符串源 + 可信 root）
  if (root !== null && typeof entry.source === 'string') {
    for (const manifestPath of MANIFEST_PATHS) {
      const text = fs.read(`${root}/${manifestPath}`);
      if (text === null) continue;
      try {
        const manifest = JSON.parse(text) as Record<string, unknown>;
        if (typeof manifest['version'] === 'string' && manifest['version'] !== '') {
          return manifest['version'];
        }
      } catch {
        // 坏 JSON——跳下一位
      }
    }
  }
  // 第 3 级：源对象 sha 前 7 位（'sha' in 窄化——npm 形无 sha 位自然落空）
  const source = entry.source;
  if (typeof source === 'object' && 'sha' in source && typeof source.sha === 'string' && source.sha.length >= 7) {
    return source.sha.slice(0, 7);
  }
  // 第 4 级：兜底
  return '0.0.0';
}
