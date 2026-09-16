/**
 * host/plugin-market/ttl + discover 测试——24h TTL 惰性刷新判据纯函数 +
 * 聚合呈现服务（§9.6 源清单与缓存节·失效降级）：多源拼接/无跨仓去重/
 * 单源失败 warn 跳过不 brick/stale 照用（离线 OK）/零源出厂空聚合。
 */
import { describe, expect, it } from 'vitest';

import { discoverMarketplaces } from './discover.js';
import { isCatalogStale, MARKETPLACE_TTL_MS } from './ttl.js';
import type { MarketFetchFace, MarketFs } from './types.js';

/** 内存 fs（文件树 Map 形） */
function memFs(initial: Record<string, string> = {}): MarketFs {
  const files = new Map(Object.entries(initial));
  const isUnder = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
  return {
    read: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    rename: (from, to) => {
      const text = files.get(from);
      if (text !== undefined) {
        // 文件形直移（registry 原子写消费）
        files.delete(from);
        files.set(to, text);
        return;
      }
      // 目录形 rename（前缀整移——local 腿换血 staging promote 落位消费；
      // 真身 renameSync 目录原生支持——update.test 同形 face）
      const under = [...files.keys()].filter((key) => key.startsWith(`${from}/`));
      if (under.length === 0) throw new Error(`ENOENT: ${from}`);
      for (const key of under) {
        const body = files.get(key)!;
        files.delete(key);
        files.set(`${to}${key.slice(from.length)}`, body);
      }
    },
    mkdir: () => undefined,
    rm: (path) => {
      for (const key of [...files.keys()]) if (isUnder(key, path)) files.delete(key);
    },
    readdir: (path) => {
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(`${path}/`)) names.add(key.slice(path.length + 1).split('/')[0]!);
      }
      return names.size === 0 ? null : [...names];
    },
    isDir: (path) => [...files.keys()].some((key) => isUnder(key, path)),
  };
}

const HOUR = 60 * 60 * 1000;
/** 固定挂钟（2026-09-16T12:00:00Z）——stale 判据可复算 */
const NOW = Date.parse('2026-09-16T12:00:00.000Z');
const now = () => new Date(NOW);

/** catalog fixture 速记 */
function catalogJson(name: string, plugins: readonly { name: string; source: string }[]): string {
  return JSON.stringify({ name, owner: { name: 'o' }, plugins });
}

/** 源清单文件速记 */
function sourcesFile(entries: readonly unknown[]): string {
  return JSON.stringify({ version: 1, marketplaces: entries });
}

const GOOD_LOCAL = {
  name: 'alpha',
  sourceType: 'local',
  sourceUri: '/src/alpha',
  catalogPath: '.claude-plugin/marketplace.json',
  addedAt: '2026-09-15T00:00:00.000Z',
  updatedAt: new Date(NOW - 2 * HOUR).toISOString(), // 新鲜（未过 24h）
};

describe('24h TTL 判据纯函数（惰性刷新——discover/upgrade 触发时点查过龄才刷）', () => {
  it('常量 = 恰 24h', () => {
    expect(MARKETPLACE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('23h 新鲜 = 不 stale；25h 过龄 = stale；恰 24h 边界 = stale（≥ 语义）', () => {
    const fresh = new Date(NOW - 23 * HOUR).toISOString();
    const stale = new Date(NOW - 25 * HOUR).toISOString();
    const edge = new Date(NOW - MARKETPLACE_TTL_MS).toISOString();
    expect(isCatalogStale(fresh, NOW)).toBe(false);
    expect(isCatalogStale(stale, NOW)).toBe(true);
    expect(isCatalogStale(edge, NOW)).toBe(true);
  });

  it('坏 ISO 时间戳 = stale（刷新更安全——防坏形永不过龄）', () => {
    expect(isCatalogStale('not-a-date', NOW)).toBe(true);
    expect(isCatalogStale('', NOW)).toBe(true);
  });
});

describe('聚合呈现（discover——缓存即真相，呈现零网络）', () => {
  it('零源出厂：清单缺席 = 空聚合零报错', async () => {
    const result = await discoverMarketplaces({ dataDir: '/data', fs: memFs(), now });
    expect(result.sources).toEqual([]);
  });

  it('多源拼接 + 无跨仓去重（同名条目两源并呈——name@marketplace 寻址隔离）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([
        GOOD_LOCAL,
        {
          ...GOOD_LOCAL,
          name: 'beta',
          sourceUri: '/src/beta',
          catalogPath: '.omp-plugin/marketplace.json', // 各源 catalogPath 各读各的（读位单源）
          updatedAt: new Date(NOW - 2 * HOUR).toISOString(),
        },
      ]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [
        { name: 'shared-name', source: './plugins/shared' },
      ]),
      '/data/marketplaces/beta/.omp-plugin/marketplace.json': catalogJson('beta', [
        { name: 'shared-name', source: './plugins/shared' },
      ]),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources).toHaveLength(2);
    const ids = result.sources.flatMap((s) => s.entries.map((e) => e.id));
    expect(ids).toEqual(['shared-name@alpha', 'shared-name@beta']); // 同名不去重
  });

  it('条目 version 四级回落参与呈现（manifest 位缺席 → 0.0.0）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([GOOD_LOCAL]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [
        { name: 'p1', source: './plugins/p1' }, // 无 version、缓存内无 manifest → 0.0.0
      ]),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources[0]?.entries[0]?.version).toBe('0.0.0');
  });

  it('单源失败 warn 跳过不 brick 聚合（缓存目录缺席 = 该源 skipped，其余照常）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([GOOD_LOCAL, { ...GOOD_LOCAL, name: 'beta' }]),
      // alpha 缓存在场；beta 缓存目录缺席
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [
        { name: 'a-plugin', source: './plugins/a' },
      ]),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources).toHaveLength(2);
    const alpha = result.sources.find((s) => s.marketplace === 'alpha');
    const beta = result.sources.find((s) => s.marketplace === 'beta');
    expect(alpha?.status).toBe('ok');
    expect(alpha?.entries[0]?.id).toBe('a-plugin@alpha');
    expect(beta?.status).toBe('skipped');
    expect(beta?.skippedReason).toContain('beta');
    expect(beta?.entries).toEqual([]);
  });

  it('catalog 坏形 = 该源 skipped（整仓拒语义——报文点名该源）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([GOOD_LOCAL]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': '{bad json',
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources[0]?.status).toBe('skipped');
    expect(result.sources[0]?.skippedReason).toContain('alpha');
  });

  it('改名漂移 = 该源 skipped（缓存 catalog name ≠ 源清单 name——腐蚀条目拒呈现）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([GOOD_LOCAL]),
      // 缓存内 catalog 自报名 drifted ≠ 源清单名 alpha
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('drifted', [
        { name: 'p', source: './p' },
      ]),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources[0]?.status).toBe('skipped');
    expect(result.sources[0]?.skippedReason).toContain('改名');
  });

  it('stale 照用（过 24h 条目仍列出——离线 OK；status 标 stale 供 CLI 提示刷新）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([
        { ...GOOD_LOCAL, updatedAt: new Date(NOW - 30 * HOUR).toISOString() }, // 过龄
      ]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [
        { name: 'old-plugin', source: './plugins/old' },
      ]),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources[0]?.status).toBe('stale');
    expect(result.sources[0]?.entries[0]?.id).toBe('old-plugin@alpha'); // 照用
  });

  it('单源过滤（name 参数命中独呈现；查无 = 空）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([GOOD_LOCAL, { ...GOOD_LOCAL, name: 'beta' }]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', []),
      '/data/marketplaces/beta/.claude-plugin/marketplace.json': catalogJson('beta', []),
    });
    const only = await discoverMarketplaces({ dataDir: '/data', fs, now }, 'beta');
    expect(only.sources.map((s) => s.marketplace)).toEqual(['beta']);
    expect((await discoverMarketplaces({ dataDir: '/data', fs, now }, 'nope')).sources).toEqual([]);
  });

  it('源清单文件本身坏形 = 整体 skipped 单行（不炸宿主——fail-loud result 面降级呈现）', async () => {
    const fs = memFs({ '/data/marketplaces.json': '{bad' });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.status).toBe('skipped');
    expect(result.sources[0]?.marketplace).toBe('');
    expect(result.sources[0]?.skippedReason).toContain('marketplaces.json');
  });

  it('条目级坏形 warn 跳过面透传（skippedEntries 呈现）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([GOOD_LOCAL]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'alpha',
        owner: { name: 'o' },
        plugins: [
          { name: 'good-one', source: './p' },
          { name: 'Bad Entry', source: './p' }, // 坏名词法跳过
        ],
      }),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now });
    const alpha = result.sources[0]!;
    expect(alpha.status).toBe('ok');
    expect(alpha.entries.map((e) => e.name)).toEqual(['good-one']);
    expect(alpha.skippedEntries).toHaveLength(1);
  });
});

describe('TTL 惰性刷新腿（§9.6 失效降级——discover 触发时点查过龄才刷；刷新失败降级 stale 照用）', () => {
  /** local 腿不消费网络腿——注桩恒抛证明零网络 */
  const throwFetch: MarketFetchFace = {
    fetchGitCatalog: async () => {
      throw new Error('本用例不达网络腿');
    },
    fetchUrlCatalog: async () => {
      throw new Error('本用例不达网络腿');
    },
  };

  it('fetch 在场 + 过龄源：回源刷新拿新 catalog 呈现（record 前进 TTL 窗重启——status 回鲜）', async () => {
    // 上游源目录已换代（新条目）；缓存仍是旧条目 + 源过龄 30h
    const newCatalog = catalogJson('alpha', [{ name: 'new-plugin', source: './plugins/new' }]);
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([{ ...GOOD_LOCAL, updatedAt: new Date(NOW - 30 * HOUR).toISOString() }]),
      '/src/alpha/.claude-plugin/marketplace.json': newCatalog,
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [
        { name: 'old-plugin', source: './plugins/old' },
      ]),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now, fetch: throwFetch, home: '' });
    expect(result.sources[0]?.status).toBe('ok'); // 刷新后 updatedAt = now——不再 stale
    expect(result.sources[0]?.entries.map((e) => e.id)).toEqual(['new-plugin@alpha']); // 新 catalog 即真相
    expect(result.refreshFailures).toEqual([]);
    // 缓存换血（local 腿整目录快照重拷——旧 catalog 内容被换新）
    expect(fs.read('/data/marketplaces/alpha/.claude-plugin/marketplace.json')).toBe(newCatalog);
    // 源清单 record 前进（updatedAt = now）
    const sources = JSON.parse(fs.read('/data/marketplaces.json')!) as {
      marketplaces: { updatedAt: string }[];
    };
    expect(sources.marketplaces[0]!.updatedAt).toBe(new Date(NOW).toISOString());
  });

  it('刷新失败降级：照用既有缓存呈现 + refreshFailures 注记（不拒呈现——离线 OK）', async () => {
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([
        {
          ...GOOD_LOCAL,
          sourceType: 'github',
          sourceUri: 'owner/repo',
          commit: 'aaa1111',
          updatedAt: new Date(NOW - 30 * HOUR).toISOString(), // 过龄触发回源
        },
      ]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [
        { name: 'cached-plugin', source: './plugins/cached' },
      ]),
    });
    const failing: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('network unreachable');
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now, fetch: failing });
    // 降级呈现：条目照列（status stale——刷新未成 TTL 窗未重启）+ 失败注记供 CLI warn
    expect(result.sources[0]?.status).toBe('stale');
    expect(result.sources[0]?.entries[0]?.id).toBe('cached-plugin@alpha');
    expect(result.refreshFailures).toHaveLength(1);
    expect(result.refreshFailures[0]).toContain('alpha');
  });

  it('鲜缓存零网络：未过龄源不回源（fetch 计数恒 0）', async () => {
    let fetchCalls = 0;
    const counting: MarketFetchFace = {
      fetchGitCatalog: async () => {
        fetchCalls += 1;
        throw new Error('鲜缓存不应回源');
      },
      fetchUrlCatalog: async () => {
        fetchCalls += 1;
        throw new Error('鲜缓存不应回源');
      },
    };
    const fs = memFs({
      // GOOD_LOCAL updatedAt = NOW - 2h——鲜
      '/data/marketplaces.json': sourcesFile([
        { ...GOOD_LOCAL, sourceType: 'github', sourceUri: 'owner/repo', commit: 'aaa1111' },
      ]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', []),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now, fetch: counting });
    expect(fetchCalls).toBe(0);
    expect(result.sources[0]?.status).toBe('ok');
    expect(result.refreshFailures).toEqual([]);
  });

  it('单源过滤：刷新射程随过滤收窄（未命中源零网络零注记）', async () => {
    let fetchCalls = 0;
    const counting: MarketFetchFace = {
      fetchGitCatalog: async () => {
        fetchCalls += 1;
        throw new Error('本用例不达');
      },
      fetchUrlCatalog: async () => {
        fetchCalls += 1;
        throw new Error('本用例不达');
      },
    };
    const fs = memFs({
      '/data/marketplaces.json': sourcesFile([
        { ...GOOD_LOCAL, updatedAt: new Date(NOW - 30 * HOUR).toISOString() }, // alpha：过龄 local（可刷）
        {
          ...GOOD_LOCAL,
          name: 'beta',
          sourceType: 'github',
          sourceUri: 'owner/beta',
          commit: 'aaa1111',
          updatedAt: new Date(NOW - 30 * HOUR).toISOString(), // beta：过龄 github（进射程即 fetch 抛错）
        },
      ]),
      '/src/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', [{ name: 'a-plugin', source: './plugins/a' }]),
      '/data/marketplaces/alpha/.claude-plugin/marketplace.json': catalogJson('alpha', []),
      '/data/marketplaces/beta/.claude-plugin/marketplace.json': catalogJson('beta', []),
    });
    const result = await discoverMarketplaces({ dataDir: '/data', fs, now, fetch: counting }, 'alpha');
    expect(fetchCalls).toBe(0); // beta 未进刷新射程——github 腿未被触碰
    expect(result.refreshFailures).toEqual([]);
    expect(result.sources.map((s) => s.marketplace)).toEqual(['alpha']);
  });
});
