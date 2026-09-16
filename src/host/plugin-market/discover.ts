/**
 * host/plugin-market/discover —— 聚合呈现服务（03 §9.6 聚合呈现节·mp-2 读
 * 侧核心）：**缓存即真相，呈现不拉插件本体、不预检可装性**；catalog 缓存
 * 过龄时按失效降级段 **24h TTL 惰性刷新腿**回源（§9.6：discover/upgrade
 * 触发时点查过龄才刷——非启动期后台动作；07 §5 discover 行「拼接零网络，
 * TTL 过龄才惰性刷新」两分法——鲜缓存零网络）。
 *
 * 失效降级（§9.6 定形）：单源失败（缓存缺席/catalog 坏形/改名漂移）= 该源
 * skipped 行（点名原因），不 brick 整个聚合；刷新失败降级 stale 照用
 * （离线 OK——refreshFailures 注记供 CLI warn，不拒呈现）；无跨仓去重
 * （同名条目两源并呈，`name@market` 寻址隔离）；源清单文件本身坏形 = 单
 * skipped 行（fail-loud result 面降级呈现，不炸宿主）。
 */
import { parseMarketplaceCatalog, resolveEntryVersion, resolveRelativeSubpath } from './catalog.js';
import { readMarketplaceSources } from './registry.js';
import { isCatalogStale } from './ttl.js';
import { refreshMarketplaceSource } from './update.js';
import type {
  DiscoveryResult,
  DiscoveredMarketSource,
  MarketFetchFace,
  MarketFs,
  MarketplaceSourceRecord,
} from './types.js';

/**
 * discover 注入面：fs + 时钟（stale 判据用）。fetch 缺席 = 纯读零网络
 * （list 计数位等只读消费面）；在场才启用 24h TTL 惰性刷新腿（CLI discover
 * 动词传真身——git/url 源回源刷新、local 源零网络重读快照）。home = local
 * 源 `~` 展开基（刷新腿需要）。
 */
export interface DiscoverDeps {
  readonly dataDir: string;
  readonly fs: MarketFs;
  readonly now: () => Date;
  /** 网络抓取位（可选——缺席 = 恒零网络纯读） */
  readonly fetch?: MarketFetchFace;
  /** `~` 展开基（local 源刷新腿需要——CLI 传 os.homedir()） */
  readonly home?: string;
}

/**
 * 聚合呈现：可选 TTL 惰性刷新（fetch 在场且过龄才回源——刷新失败降级
 * stale 照用不拒呈现）→ 重读源清单拿刷新后 record → 逐源按
 * record.catalogPath 直读缓存（读位单源——add 时锁定的 catalogPath 即
 * 缓存内真相位）→ 解析 → 条目呈现（id 寻址形 + 版本四级回落）。only
 * 给定时单源过滤（查无 = 空聚合；刷新射程随过滤收窄）。
 */
export async function discoverMarketplaces(deps: DiscoverDeps, only?: string): Promise<DiscoveryResult> {
  const { dataDir, fs, now } = deps;
  const refreshFailures: string[] = [];

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
    return { sources: [row], refreshFailures };
  }

  // —— 24h TTL 惰性刷新腿（§9.6 失效降级——discover 触发时点查过龄才刷）：
  // fetch 注入位缺席 = 恒零网络纯读（list 计数位）；过龄源逐个回源
  // （refreshMarketplaceSource 与 update/upgrade 同源——local 重读快照 /
  // git 重克隆 / url 重拉，up-to-date 则 updatedAt 前进 TTL 窗重启）；
  // 刷新失败降级 stale 照用（离线 OK——注记供 CLI warn，不拒呈现）。
  // 刷新射程随 only 过滤收窄（未命中源零网络零注记）。
  let records = read.sources;
  if (deps.fetch !== undefined && read.sources.length > 0) {
    const scoped = only === undefined ? read.sources : read.sources.filter((r) => r.name === only);
    let refreshedAny = false; // 是否发生刷新动作（updated/up-to-date 均落盘 record；failed 不动）
    for (const record of scoped) {
      if (!isCatalogStale(record.updatedAt, now().getTime())) continue; // 鲜缓存——零网络
      refreshedAny = true;
      const outcome = await refreshMarketplaceSource(
        {
          dataDir,
          fs,
          fetch: deps.fetch,
          now,
          ...(deps.home !== undefined ? { home: deps.home } : {}),
        },
        record,
      );
      if (outcome.status === 'failed') {
        // 刷新失败不拒呈现——既有缓存照用（stale 照用，离线 OK）
        refreshFailures.push(`${record.name}：${outcome.message}`);
      }
    }
    if (refreshedAny) {
      // 重读源清单拿前进后的 catalogPath/updatedAt 再聚合（上游 catalog
      // 换位形对拍/读缓存均须走新 record——旧快照即陈化）；重读坏形理论
      // 不可达（commitRecordUpdate 只 patch 不增删）——降级沿用旧快照
      const fresh = readMarketplaceSources(dataDir, fs);
      if (fresh.ok) records = fresh.sources;
    }
  }

  const nowMs = now().getTime();
  const rows: DiscoveredMarketSource[] = [];
  for (const record of records) {
    if (only !== undefined && record.name !== only) continue; // 单源过滤（查无=空）
    rows.push(discoverSource(record, dataDir, fs, nowMs));
  }
  return { sources: rows, refreshFailures };
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
      skippedReason: `源 ${record.name} 缓存缺席（${record.catalogPath} 读不到）——刷新走 berry marketplace update ${record.name}`,
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
