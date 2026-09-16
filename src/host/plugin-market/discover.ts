/**
 * host/plugin-market/discover —— 聚合呈现服务（03 §9.6 聚合呈现节·mp-2 读
 * 侧核心）：**缓存即真相，呈现零网络**——只读源清单 + 各源缓存 catalog 拼
 * 聚合，不触发任何抓取（刷新是 add/update 腿的事）。
 *
 * 失效降级（§9.6 定形）：单源失败（缓存缺席/catalog 坏形/改名漂移）= 该源
 * skipped 行（点名原因），不 brick 整个聚合；stale 照用（离线 OK——status
 * 标 stale 供 CLI 提示刷新）；无跨仓去重（同名条目两源并呈，`name@market`
 * 寻址隔离）；源清单文件本身坏形 = 单 skipped 行（fail-loud result 面降级
 * 呈现，不炸宿主）。
 */
import { parseMarketplaceCatalog, resolveEntryVersion, resolveRelativeSubpath } from './catalog.js';
import { readMarketplaceSources } from './registry.js';
import { isCatalogStale } from './ttl.js';
import type { DiscoveryResult, DiscoveredMarketSource, MarketFs, MarketplaceSourceRecord } from './types.js';

/** discover 注入面：fs + 时钟（stale 判据用）——零网络（无 fetch 位） */
export interface DiscoverDeps {
  readonly dataDir: string;
  readonly fs: MarketFs;
  readonly now: () => Date;
}

/**
 * 聚合呈现：读源清单 → 逐源按 record.catalogPath 直读缓存（读位单源——
 * add 时锁定的 catalogPath 即缓存内真相位）→ 解析 → 条目呈现（id 寻址形 +
 * 版本四级回落）。only 给定时单源过滤（查无 = 空聚合）。
 */
export function discoverMarketplaces(deps: DiscoverDeps, only?: string): DiscoveryResult {
  const { dataDir, fs, now } = deps;

  // 源清单本身坏形 = 单 skipped 行降级呈现（不炸宿主——fail-loud 面在 result）
  const read = readMarketplaceSources(dataDir, fs);
  if (!read.ok) {
    const row: DiscoveredMarketSource = {
      marketplace: '',
      status: 'skipped',
      entries: [],
      skippedEntries: [],
      skippedReason: `源清单文件 marketplaces.json 坏形——${read.message}`,
    };
    return { sources: [row] };
  }

  const nowMs = now().getTime();
  const rows: DiscoveredMarketSource[] = [];
  for (const record of read.sources) {
    if (only !== undefined && record.name !== only) continue; // 单源过滤（查无=空）
    rows.push(discoverSource(record, dataDir, fs, nowMs));
  }
  return { sources: rows };
}

/** 单源发现（读缓存 → 校验 → 条目呈现 + stale 判据） */
function discoverSource(
  record: MarketplaceSourceRecord,
  dataDir: string,
  fs: MarketFs,
  nowMs: number,
): DiscoveredMarketSource {
  const cacheRoot = `${dataDir}/marketplaces/${record.name}`;
  // 读位单源：按源清单记的 catalogPath 直读缓存（add 时锁定）
  const text = fs.read(`${cacheRoot}/${record.catalogPath}`);
  if (text === null) {
    return {
      marketplace: record.name,
      status: 'skipped',
      entries: [],
      skippedEntries: [],
      skippedReason: `源 ${record.name} 缓存缺席（${record.catalogPath} 读不到）——请 remove 后重新 add 或稍后刷新`,
    };
  }
  const parse = parseMarketplaceCatalog(text, `${record.name}/${record.catalogPath}`);
  if (!parse.ok) {
    return {
      marketplace: record.name,
      status: 'skipped',
      entries: [],
      skippedEntries: [],
      skippedReason: `源 ${record.name} catalog 坏形——${parse.reason}`,
    };
  }
  // 改名漂移拒：缓存 catalog 自报名 ≠ 源清单名——该源不呈现（防腐蚀条目冒名）
  if (parse.catalog.name !== record.name) {
    return {
      marketplace: record.name,
      status: 'skipped',
      entries: [],
      skippedEntries: [],
      skippedReason: `源 ${record.name} 缓存 catalog 自报名 "${parse.catalog.name}" 与源清单名不符——市场疑似改名漂移，请 remove 后按新名重新 add`,
    };
  }
  // 条目呈现：id 寻址形 + 版本四级回落（相对源条目 manifest 基 = 缓存内子目录）
  const pluginRoot = parse.catalog.metadata?.pluginRoot;
  const entries = parse.catalog.plugins.map((entry) => {
    let manifestRoot: string | null = cacheRoot;
    if (typeof entry.source === 'string') {
      const sub = resolveRelativeSubpath(entry.source, pluginRoot);
      manifestRoot = sub.ok ? `${cacheRoot}/${sub.subpath}` : null; // 子路径不可信——跳 manifest 级
    } else {
      manifestRoot = null; // 远端形条目缓存内无插件目录——不读 manifest（防市场根张冠李戴）
    }
    return {
      id: `${entry.name}@${record.name}`,
      name: entry.name,
      version: resolveEntryVersion(entry, manifestRoot, fs),
      description: entry.description,
    };
  });
  return {
    marketplace: record.name,
    // stale 照用（离线 OK）——status 供 CLI 提示刷新，条目照列
    status: isCatalogStale(record.updatedAt, nowMs) ? 'stale' : 'ok',
    entries,
    skippedEntries: parse.skipped,
  };
}
