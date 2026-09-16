/**
 * host/plugin-market/update 测试——mp-4 update/upgrade 服务面（03 §9.6
 * 源清单与缓存节失效降级 + upgrade 语义段）。
 *
 * update 面（memFs + 注假 fetch——add.test 同形）：git/url/local 三源换血
 * promote / up-to-date 判据（git 同 commit / url 同文本 / local 同 catalog
 * 文本——已最新不换血但 updatedAt 刷新重置 TTL）/ 改名漂移拒全腿 / 点名
 * 缺席 / 全量部分失败不 brick。
 *
 * upgrade 面（真 fs + marketInstall 真跑 + 假 npm spawn——install.test 同形）：
 * 单件 force 换血重装 / 全量 catalog 对拍（semver 序比较、非 semver 不等即
 * 新、无 version 跳过、账本 version 缺席视不等）/ 上游下架跳过 / 翻译拒
 * try 跳败（路径逃逸 + ref 注入两线在 upgrade 通道的接线锁）/ 24h TTL 惰性
 * 门控（鲜缓存零网络、过龄才回源）/ 寻址硬拒谱。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { refreshMarketplaceSource, updateMarketplaceSources, upgradeMarketplacePlugins } from './update.js';
import { createMarketFs } from './fs.js';
import { marketInstall } from './install.js';
import { readMarketplaceSources, writeMarketplaceSources } from './registry.js';
import type { MarketFetchFace, MarketFs, MarketplaceSourceRecord } from './types.js';
import { createPluginStoreFs, mountRow, readEnabledRowsForEdit, readLedger } from '../plugin-store.js';
import type { PluginLedgerEntry } from '../plugin-store.js';
import type { InstallExecutorDeps, SpawnRunner } from '../plugin-install.js';

const testRoot = mkdtempSync(join(tmpdir(), 'berry-market-update-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

const T0 = new Date('2026-09-16T12:00:00.000Z');
const T1 = new Date('2026-09-16T14:00:00.000Z'); // +2h——updatedAt 前进锚

/** 内存 fs（add.test 同形） */
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
      // 目录形 rename（前缀整移——staging promote 落位消费；真身 renameSync 目录原生支持）
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

function catalogText(name: string, entries: readonly object[]): string {
  return JSON.stringify({ name, owner: { name: 'o' }, plugins: entries });
}

/** git 腿假 fetch：往 memFs 的 '/tmp/clone' 物化 catalog（add.test 同形） */
function gitFetchReturning(fs: MarketFs, commit: string, text: string): MarketFetchFace {
  return {
    fetchGitCatalog: async () => {
      fs.write('/tmp/clone/.claude-plugin/marketplace.json', text);
      return { cloneDir: '/tmp/clone', catalogPath: '.claude-plugin/marketplace.json', text, commit };
    },
    fetchUrlCatalog: async () => {
      throw new Error('本用例不达');
    },
  };
}

describe('update 服务面——git 源（memFs + 注假 fetch）', () => {
  const baseRecord: MarketplaceSourceRecord = {
    name: 'official',
    sourceType: 'github',
    sourceUri: 'owner/repo',
    catalogPath: '.claude-plugin/marketplace.json',
    addedAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    commit: 'aaa1111',
  };

  it('新 commit = 整目录换血 promote + record 更新（commit/catalogPath/updatedAt）', async () => {
    const fs = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
      '/data/marketplaces/official/obsolete-file.txt': '旧快照残留', // 换血必删锚
    });
    writeMarketplaceSources('/data', [baseRecord], fs);
    const newText = catalogText('official', [
      { name: 'p-one', source: './plugins/one' },
      { name: 'p-two', source: './plugins/two' },
    ]);
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs, fetch: gitFetchReturning(fs, 'bbb2222', newText), now: () => T1 },
      baseRecord,
    );
    expect(outcome).toEqual({ status: 'updated', name: 'official', entryCount: 2, commit: 'bbb2222' });
    // 换血锁：旧文件消失、新 catalog 在场（半拷贝永不复用）
    expect(fs.read('/data/marketplaces/official/obsolete-file.txt')).toBeNull();
    expect(fs.read('/data/marketplaces/official/.claude-plugin/marketplace.json')).toBe(newText);
    // 源清单 record 更新（commit 前进 + updatedAt 刷新）
    const sources = readMarketplaceSources('/data', fs);
    expect(sources.ok && sources.sources[0]).toMatchObject({ commit: 'bbb2222', updatedAt: T1.toISOString() });
    // tmp 清场
    expect(fs.isDir('/tmp/clone')).toBe(false);
  });

  it('同 commit = 已最新（不换血、updatedAt 刷新重置 TTL、tmp 清场）', async () => {
    const fs = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
      '/data/marketplaces/official/local-note.txt': '缓存内文件必须原样保留',
    });
    writeMarketplaceSources('/data', [baseRecord], fs);
    const sameText = catalogText('official', []);
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs, fetch: gitFetchReturning(fs, 'aaa1111', sameText), now: () => T1 },
      baseRecord,
    );
    expect(outcome).toEqual({ status: 'up-to-date', name: 'official', commit: 'aaa1111' });
    expect(fs.read('/data/marketplaces/official/local-note.txt')).toBe('缓存内文件必须原样保留');
    const sources = readMarketplaceSources('/data', fs);
    expect(sources.ok && sources.sources[0]).toMatchObject({ commit: 'aaa1111', updatedAt: T1.toISOString() });
    expect(fs.isDir('/tmp/clone')).toBe(false);
  });

  it('改名漂移拒：新 catalog 自报名 ≠ 源清单名——record 不动、tmp 清场', async () => {
    const fs = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
    });
    writeMarketplaceSources('/data', [baseRecord], fs);
    const outcome = await refreshMarketplaceSource(
      {
        dataDir: '/data',
        fs,
        fetch: gitFetchReturning(fs, 'ccc3333', catalogText('renamed-market', [])),
        now: () => T1,
      },
      baseRecord,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('改名漂移');
    const sources = readMarketplaceSources('/data', fs);
    expect(sources.ok && sources.sources[0]).toMatchObject({
      name: 'official',
      commit: 'aaa1111',
      updatedAt: T0.toISOString(),
    });
    expect(fs.isDir('/tmp/clone')).toBe(false);
  });

  it('fetch 失败 = failed 结局（异常不外泄、record 不动、tmp 清场）', async () => {
    const fs = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
    });
    writeMarketplaceSources('/data', [baseRecord], fs);
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        fs.write('/tmp/clone/README.md', '克隆中途失败');
        throw new Error('network unreachable');
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const outcome = await refreshMarketplaceSource({ dataDir: '/data', fs, fetch, now: () => T1 }, baseRecord);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('network unreachable');
    // 失败位 tmp 清场归 fetch 面契约（fetch.test.ts「clone 失败传播 + tmp 自清」已锁）
    // ——注入面抛出时克隆目录位不可知，本面只保异常不外泄 + record 不动：
    const sources = readMarketplaceSources('/data', fs);
    expect(sources.ok && sources.sources[0]).toMatchObject({ commit: 'aaa1111', updatedAt: T0.toISOString() });
  });

  it('promote 段写失败（磁盘 IO 形）= failed + tmp 克隆清场（修前红——catch 不清 cloneDir）', async () => {
    const base = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
    });
    writeMarketplaceSources('/data', [baseRecord], base);
    // 假 git fetch：物化克隆树（写进 base——fetch 产物不走包装面）+ 新 commit（进 promote 段）
    const newText = catalogText('official', [{ name: 'p-one', source: './plugins/one' }]);
    const fetch = gitFetchReturning(base, 'bbb2222', newText);
    // 缓存目录写失败形（ENOSPC/EACCED 同族）：包装 fs 对缓存位写入抛——staging
    // promote 律下拦截面前缀须盖 official/ 与 official.staging/ 两目录（中转
    // 同源盘位，无尾斜杠前缀即双盖）
    const fs: MarketFs = {
      ...base,
      write: (path, text) => {
        if (path.startsWith('/data/marketplaces/official')) throw new Error('ENOSPC: 磁盘已满');
        base.write(path, text);
      },
    };
    const outcome = await refreshMarketplaceSource({ dataDir: '/data', fs, fetch, now: () => T1 }, baseRecord);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('ENOSPC');
    // tmp 克隆中转站清场——「成功返回后清场归调用方」契约对 promote 抛出位的兑现
    expect(base.isDir('/tmp/clone')).toBe(false);
    // 旧缓存原样不动（staging promote 律——失败刷新不得自毁既有缓存）+ 中转零残影
    expect(base.read('/data/marketplaces/official/.claude-plugin/marketplace.json')).toBe(catalogText('official', []));
    expect(base.readdir('/data/marketplaces/official.staging')).toBeNull();
    // record 不动（不虚报刷新）
    const sources = readMarketplaceSources('/data', base);
    expect(sources.ok && sources.sources[0]).toMatchObject({ commit: 'aaa1111', updatedAt: T0.toISOString() });
  });
});

describe('update 服务面——url 源与 local 源', () => {
  const urlRecord: MarketplaceSourceRecord = {
    name: 'url-one',
    sourceType: 'url',
    sourceUri: 'https://example.com/cat.json',
    catalogPath: 'marketplace.json',
    addedAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
  };
  const localRecord: MarketplaceSourceRecord = {
    name: 'local-mkt',
    sourceType: 'local',
    sourceUri: '/src/local-mkt',
    catalogPath: '.claude-plugin/marketplace.json',
    addedAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
  };

  it('url 源：文本不变 = 已最新；文本变化 = 快照换血', async () => {
    const fs = memFs({ '/data/marketplaces/url-one/marketplace.json': catalogText('url-one', []) });
    writeMarketplaceSources('/data', [urlRecord], fs);
    const same = await refreshMarketplaceSource(
      {
        dataDir: '/data',
        fs,
        fetch: {
          fetchGitCatalog: async () => {
            throw new Error('不达');
          },
          fetchUrlCatalog: async () => ({ text: catalogText('url-one', []) }),
        },
        now: () => T1,
      },
      urlRecord,
    );
    expect(same.status).toBe('up-to-date');
    const newText = catalogText('url-one', [{ name: 'new-entry', source: { source: 'npm', package: 'new-entry' } }]);
    const changed = await refreshMarketplaceSource(
      {
        dataDir: '/data',
        fs,
        fetch: {
          fetchGitCatalog: async () => {
            throw new Error('不达');
          },
          fetchUrlCatalog: async () => ({ text: newText }),
        },
        now: () => T1,
      },
      urlRecord,
    );
    expect(changed).toEqual({ status: 'updated', name: 'url-one', entryCount: 1 });
    expect(fs.read('/data/marketplaces/url-one/marketplace.json')).toBe(newText);
  });

  it('local 源：目录不变 = 已最新；目录变化 = 快照换血（零网络）', async () => {
    const fs = memFs({
      '/src/local-mkt/.claude-plugin/marketplace.json': catalogText('local-mkt', []),
      '/data/marketplaces/local-mkt/.claude-plugin/marketplace.json': catalogText('local-mkt', []),
    });
    writeMarketplaceSources('/data', [localRecord], fs);
    const noFetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('local 源不消费网络腿');
      },
      fetchUrlCatalog: async () => {
        throw new Error('local 源不消费网络腿');
      },
    };
    const same = await refreshMarketplaceSource({ dataDir: '/data', fs, fetch: noFetch, now: () => T1 }, localRecord);
    expect(same.status).toBe('up-to-date');
    // 源目录推进：新条目 + 删旧文件——缓存随之换血
    const nextText = catalogText('local-mkt', [{ name: 'added', source: './plugins/added' }]);
    fs.write('/src/local-mkt/.claude-plugin/marketplace.json', nextText);
    fs.write('/src/local-mkt/plugins/added/package.json', '{"name":"added"}');
    fs.write('/data/marketplaces/local-mkt/stale-cache.txt', '换血必删锚');
    const changed = await refreshMarketplaceSource(
      { dataDir: '/data', fs, fetch: noFetch, now: () => T1 },
      localRecord,
    );
    expect(changed).toEqual({ status: 'updated', name: 'local-mkt', entryCount: 1 });
    expect(fs.read('/data/marketplaces/local-mkt/stale-cache.txt')).toBeNull();
    expect(fs.read('/data/marketplaces/local-mkt/.claude-plugin/marketplace.json')).toBe(nextText);
    expect(fs.read('/data/marketplaces/local-mkt/plugins/added/package.json')).toContain('added');
  });

  it('local 腿 catalog 路径漂移（内容不变）= 换血非 up-to-date——账本不得指向缓存缺席位', async () => {
    const T = catalogText('local-mkt', []);
    // add 时锁定 .claude-plugin 路径；此后源目录 catalog 迁到 .omp-plugin（内容
    // 不变）并删原路径；缓存快照仍是旧路径旧内容（remove 两步中断/换机残留形同族）
    const fs = memFs({
      '/src/local-mkt/.omp-plugin/marketplace.json': T,
      '/data/marketplaces/local-mkt/.claude-plugin/marketplace.json': T,
      '/data/marketplaces/local-mkt/stale-cache.txt': '换血必删锚',
    });
    writeMarketplaceSources('/data', [localRecord], fs);
    const noFetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('local 源不消费网络腿');
      },
      fetchUrlCatalog: async () => {
        throw new Error('local 源不消费网络腿');
      },
    };
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs, fetch: noFetch, now: () => T1 },
      localRecord,
    );
    // 修前红：内容相等即 up-to-date + 账本 catalogPath 前进到新路径——而缓存树
    // 一字未动（无新路径文件）→ discover/install 随即报「缓存缺席」自相矛盾
    expect(outcome.status).toBe('updated');
    // 换血锁：缓存 = 源目录新快照（新路径在场、旧残留消失）
    expect(fs.read('/data/marketplaces/local-mkt/.omp-plugin/marketplace.json')).toBe(T);
    expect(fs.read('/data/marketplaces/local-mkt/stale-cache.txt')).toBeNull();
    const sources = readMarketplaceSources('/data', fs);
    expect(sources.ok && sources.sources[0]).toMatchObject({
      catalogPath: '.omp-plugin/marketplace.json',
      updatedAt: T1.toISOString(),
    });
  });
});

describe('updateMarketplaceSources——点名与全量分形', () => {
  it('点名缺席 = missingName 指路（不碰任何源）', async () => {
    const fs = memFs();
    writeMarketplaceSources('/data', [], fs);
    const result = await updateMarketplaceSources(
      { dataDir: '/data', fs, fetch: gitFetchReturning(fs, 'x', '{}'), now: () => T1 },
      'ghost',
    );
    expect(result.missingName).toBe('ghost');
    expect(result.outcomes).toHaveLength(0);
  });

  it('全量：两源独立结局（一换血一失败互不 brick）', async () => {
    const good: MarketplaceSourceRecord = {
      name: 'good',
      sourceType: 'url',
      sourceUri: 'https://example.com/good.json',
      catalogPath: 'marketplace.json',
      addedAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    };
    const bad: MarketplaceSourceRecord = { ...good, name: 'bad', sourceUri: 'https://example.com/bad.json' };
    const fs = memFs({
      '/data/marketplaces/good/marketplace.json': catalogText('good', []),
      '/data/marketplaces/bad/marketplace.json': catalogText('bad', []),
    });
    writeMarketplaceSources('/data', [good, bad], fs);
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('本用例不达');
      },
      fetchUrlCatalog: async (url) => {
        if (url.includes('bad')) throw new Error('boom');
        return { text: catalogText('good', [{ name: 'n', source: { source: 'npm', package: 'n' } }]) };
      },
    };
    const result = await updateMarketplaceSources({ dataDir: '/data', fs, fetch, now: () => T1 });
    expect(result.missingName).toBeNull();
    expect(result.outcomes.map((o) => [o.name, o.status])).toEqual([
      ['good', 'updated'],
      ['bad', 'failed'],
    ]);
    // 失败源 record 的 updatedAt 不动（不虚报刷新）
    const sources = readMarketplaceSources('/data', fs);
    const byName = new Map((sources.ok ? sources.sources : []).map((r) => [r.name, r]));
    expect(byName.get('good')).toMatchObject({ updatedAt: T1.toISOString() });
    expect(byName.get('bad')).toMatchObject({ updatedAt: T0.toISOString() });
  });
});

/* ---------------- upgrade 面（真 fs + marketInstall 真跑 + 假 npm spawn） ---------------- */

const COMMIT1 = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const NOW0 = new Date('2026-09-16T12:00:00.000Z');

function dataDirOf(name: string): string {
  const dir = join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 声明载荷插件 fixture（ berryAgent.skills 在场 = 零码收割） */
function declaredPkgJson(id: string, version: string): string {
  return `${JSON.stringify({ name: id, version, berryAgent: { id, skills: ['greet'] } }, null, 2)}\n`;
}

/**
 * 智能假 npm spawn：从 spec 尾参解析 pkg[@version]，物化 node_modules 产物
 * 与 lock（lock version = spec 版本——upgrade 版本对拍的收割锚）。
 */
function npmFakeSpawn(dataDir: string): { readonly spawn: SpawnRunner; readonly argvLog: string[][] } {
  const argvLog: string[][] = [];
  const spawn: SpawnRunner = {
    run: (cmd, args) => {
      argvLog.push([cmd, ...args]);
      if (cmd !== 'npm') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
      const spec = args[args.length - 1]!;
      const at = spec.lastIndexOf('@');
      const pkg = spec.startsWith('@') ? spec.slice(0, at) : spec.split('@')[0]!;
      const version = spec.startsWith('@') || at <= 0 ? '1.0.0' : spec.slice(at + 1)!;
      const pkgDir = join(dataDir, 'plugins', 'node_modules', ...pkg.split('/'));
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'package.json'), declaredPkgJson(pkg, version));
      writeFileSync(
        join(dataDir, 'plugins', '.package-lock.json'),
        JSON.stringify({ packages: { [`node_modules/${pkg}`]: { version, integrity: 'sha512-abc' } } }),
      );
      return Promise.resolve({ stdout: '', stderr: '' });
    },
  };
  return { spawn, argvLog };
}

/** 现场铸造：源清单（github 源带 commit）+ 缓存 catalog（npm 条目可定制） */
function seedMarket(
  dataDir: string,
  plugins: readonly { readonly name: string; readonly source: unknown; readonly version?: string }[],
  updatedAt: Date = NOW0,
): void {
  const record: MarketplaceSourceRecord = {
    name: 'official',
    sourceType: 'github',
    sourceUri: 'owner/repo',
    catalogPath: '.claude-plugin/marketplace.json',
    addedAt: NOW0.toISOString(),
    updatedAt: updatedAt.toISOString(),
    commit: COMMIT1,
  };
  const fs = createMarketFs();
  writeMarketplaceSources(dataDir, [record], fs);
  fs.write(
    join(dataDir, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'official', owner: { name: 'o' }, plugins }),
  );
}

/** 市场装机一条（marketInstall 真跑——npm direct 腿假 spawn） */
async function installEntry(dataDir: string, id: string, spawn: SpawnRunner): Promise<void> {
  const outcome = await marketInstall(
    { dataDir, fs: createMarketFs(), install: { dataDir, fs: createPluginStoreFs(), spawn, now: () => NOW0 } },
    id,
  );
  expect(outcome.ok).toBe(true);
}

function ledgerOf(dataDir: string): readonly PluginLedgerEntry[] {
  const read = readLedger(dataDir, createPluginStoreFs());
  expect(read.ok).toBe(true);
  return read.ok ? read.entries : [];
}

/** upgrade deps 速记（含挂钟——TTL 门控与 updatedAt 刷新的判定源） */
function upgradeDepsOf(
  dataDir: string,
  spawn: SpawnRunner,
  fetch: MarketFetchFace,
  ledger: readonly PluginLedgerEntry[],
) {
  return {
    dataDir,
    fs: createMarketFs(),
    fetch,
    install: { dataDir, fs: createPluginStoreFs(), spawn, now: () => NOW0 } satisfies InstallExecutorDeps,
    ledger,
    now: () => NOW0,
  };
}

const noFetch: MarketFetchFace = {
  fetchGitCatalog: async () => {
    throw new Error('本用例不达网络腿');
  },
  fetchUrlCatalog: async () => {
    throw new Error('本用例不达网络腿');
  },
};

describe('upgrade 服务面——catalog 对拍 + 换装分派', () => {
  it('全量：semver 序比较升级（1.2.3 → 1.3.0 换血重装，账本单条换新 ref）', async () => {
    const dataDir = dataDirOf('up-semver');
    seedMarket(dataDir, [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }]);
    const { spawn, argvLog } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    expect(ledgerOf(dataDir)[0]).toMatchObject({ version: '1.2.3', ref: 'npm:demo-pkg@1.2.3' });
    // catalog 推进 1.3.0（缓存直改——updatedAt 鲜、零网络）
    const fs = createMarketFs();
    fs.write(
      join(dataDir, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'official',
        owner: { name: 'o' },
        plugins: [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.3.0' } }],
      }),
    );
    const result = await upgradeMarketplacePlugins(upgradeDepsOf(dataDir, spawn, noFetch, ledgerOf(dataDir)));
    expect(result.rejected).toBeNull();
    expect(result.outcomes).toEqual([{ status: 'upgraded', id: 'demo-pkg', from: '1.2.3', to: '1.3.0' }]);
    // 换血锁：账本仍单条、ref/version 随换装更新（market 注记保留）
    const ledger = ledgerOf(dataDir);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      version: '1.3.0',
      ref: 'npm:demo-pkg@1.3.0',
      market: { name: 'official', entry: 'demo-pkg' },
    });
    expect(argvLog.some((argv) => argv.includes('demo-pkg@1.3.0'))).toBe(true);
  });

  it('全量：版本未变 = current 零动作；非 semver 不等即新 = 升级；无 version 跳过', async () => {
    const dataDir = dataDirOf('up-mixed');
    seedMarket(dataDir, [
      { name: 'stable-pkg', source: { source: 'npm', package: 'stable-pkg', version: '1.2.3' } },
      { name: 'loose-pkg', source: { source: 'npm', package: 'loose-pkg', version: '1.2.3' } },
      { name: 'unversioned-pkg', source: { source: 'npm', package: 'unversioned-pkg' } },
    ]);
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'stable-pkg@official', spawn);
    await installEntry(dataDir, 'loose-pkg@official', spawn);
    await installEntry(dataDir, 'unversioned-pkg@official', spawn);
    const before = ledgerOf(dataDir).length;
    expect(before).toBe(3);
    // catalog：stable 不动；loose 改非 semver 'nightly'；unversioned 仍无 version
    const fs = createMarketFs();
    fs.write(
      join(dataDir, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'official',
        owner: { name: 'o' },
        plugins: [
          { name: 'stable-pkg', source: { source: 'npm', package: 'stable-pkg', version: '1.2.3' } },
          { name: 'loose-pkg', source: { source: 'npm', package: 'loose-pkg', version: 'nightly' } },
          { name: 'unversioned-pkg', source: { source: 'npm', package: 'unversioned-pkg' } },
        ],
      }),
    );
    const { spawn: spawn2, argvLog } = npmFakeSpawn(dataDir);
    const result = await upgradeMarketplacePlugins(upgradeDepsOf(dataDir, spawn2, noFetch, ledgerOf(dataDir)));
    const byId = new Map(result.outcomes.map((o) => [o.id, o]));
    expect(byId.get('stable-pkg')).toMatchObject({ status: 'current', version: '1.2.3' });
    expect(byId.get('loose-pkg')).toMatchObject({ status: 'upgraded', from: '1.2.3', to: 'nightly' });
    const unversioned = byId.get('unversioned-pkg');
    expect(unversioned?.status).toBe('skipped');
    if (unversioned?.status === 'skipped') {
      expect(unversioned.reason).toContain('未声明版本');
    }
    // current/skipped 零装机动作（argv 只含 loose 的重装）
    expect(argvLog.filter((argv) => argv[0] === 'npm')).toHaveLength(1);
    expect(argvLog[0]!.includes('loose-pkg@nightly')).toBe(true);
  });

  it('全量：上游下架跳过 + 翻译拒 try 跳败（路径逃逸/ref 注入两线接线锁——其余条目照常升级）', async () => {
    const dataDir = dataDirOf('up-evil');
    seedMarket(dataDir, [
      { name: 'good-pkg', source: { source: 'npm', package: 'good-pkg', version: '1.0.0' } },
      { name: 'gone-pkg', source: { source: 'npm', package: 'gone-pkg', version: '1.0.0' } },
      { name: 'escape-pkg', source: { source: 'npm', package: 'escape-pkg', version: '1.0.0' } },
      { name: 'inject-pkg', source: { source: 'npm', package: 'inject-pkg', version: '1.0.0' } },
    ]);
    const { spawn } = npmFakeSpawn(dataDir);
    for (const id of ['good-pkg', 'gone-pkg', 'escape-pkg', 'inject-pkg']) {
      await installEntry(dataDir, `${id}@official`, spawn);
    }
    // 恶意 catalog 推进：escape 条目源改仓外逃逸相对串（路径逃逸面）；inject 条目源改 '..' 段 npm 包名（ref 注入面）；gone 条目下架。
    // 恶意条目带更新 version（1.1.0 > 1.0.0）——对拍放行后翻译拒才可达（无 version 会被「未声明版本」先行跳过）
    const fs = createMarketFs();
    fs.write(
      join(dataDir, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'official',
        owner: { name: 'o' },
        plugins: [
          { name: 'good-pkg', source: { source: 'npm', package: 'good-pkg', version: '1.1.0' } },
          { name: 'escape-pkg', version: '1.1.0', source: './../../etc/passwd' },
          { name: 'inject-pkg', version: '1.1.0', source: { source: 'npm', package: 'evil/../evil' } },
        ],
      }),
    );
    const { spawn: spawn2 } = npmFakeSpawn(dataDir);
    const result = await upgradeMarketplacePlugins(upgradeDepsOf(dataDir, spawn2, noFetch, ledgerOf(dataDir)));
    const byId = new Map(result.outcomes.map((o) => [o.id, o]));
    expect(byId.get('good-pkg')).toMatchObject({ status: 'upgraded', to: '1.1.0' }); // try 跳败——其余照常
    expect(byId.get('gone-pkg')).toMatchObject({ status: 'skipped' }); // 上游下架
    // 逃逸拒：相对串出界——翻译拒诚实报文
    const escape = byId.get('escape-pkg');
    expect(escape?.status).toBe('failed');
    if (escape?.status === 'failed') expect(escape.message).toContain('逃逸');
    // ref 注入拒：npm 包名 '..' 段注入形——翻译拒
    const inject = byId.get('inject-pkg');
    expect(inject?.status).toBe('failed');
    if (inject?.status === 'failed') expect(inject.message).toContain('npm 包名坏词法');
  });

  it('单件点名 = force 换血重装（版本未变也重装——「拉最新」唯经 upgrade）', async () => {
    const dataDir = dataDirOf('up-single');
    seedMarket(dataDir, [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }]);
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    const { spawn: spawn2, argvLog } = npmFakeSpawn(dataDir);
    const result = await upgradeMarketplacePlugins(
      upgradeDepsOf(dataDir, spawn2, noFetch, ledgerOf(dataDir)),
      'demo-pkg@official',
    );
    expect(result.rejected).toBeNull();
    expect(result.outcomes).toEqual([{ status: 'upgraded', id: 'demo-pkg', from: '1.2.3', to: '1.2.3' }]);
    expect(argvLog.some((argv) => argv.includes('demo-pkg@1.2.3'))).toBe(true); // force 重装真发生
    expect(ledgerOf(dataDir)).toHaveLength(1); // 换血非新增
  });

  it('寻址硬拒谱：词法坏 / 市场缺席 / 无装机条目 / 多中诚实拒', async () => {
    const dataDir = dataDirOf('up-reject');
    seedMarket(dataDir, [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }]);
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    // 词法坏
    const bad = await upgradeMarketplacePlugins(upgradeDepsOf(dataDir, spawn, noFetch, ledgerOf(dataDir)), 'no-at');
    expect(bad.rejected).toContain('name@marketplace');
    // 市场缺席
    const ghostMarket = await upgradeMarketplacePlugins(
      upgradeDepsOf(dataDir, spawn, noFetch, ledgerOf(dataDir)),
      'demo-pkg@nowhere',
    );
    expect(ghostMarket.rejected).toContain('不在源清单');
    // 无装机条目（市场在册但未装机）
    const notInstalled = await upgradeMarketplacePlugins(
      upgradeDepsOf(dataDir, spawn, noFetch, ledgerOf(dataDir)),
      'ghost-entry@official',
    );
    expect(notInstalled.rejected).toContain('无装机条目');
  });

  it('24h TTL 惰性门控：鲜缓存零网络、过龄才回源刷新', async () => {
    // 鲜缓存：updatedAt = NOW0，now = NOW0 + 1h——upgrade 零 fetch
    const freshDir = dataDirOf('up-ttl-fresh');
    seedMarket(
      freshDir,
      [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }],
      NOW0,
    );
    const { spawn: freshSpawn } = npmFakeSpawn(freshDir);
    await installEntry(freshDir, 'demo-pkg@official', freshSpawn);
    let fetchCalls = 0;
    const countingFetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        fetchCalls += 1;
        throw new Error('鲜缓存不应回源');
      },
      fetchUrlCatalog: async () => {
        fetchCalls += 1;
        throw new Error('鲜缓存不应回源');
      },
    };
    const fresh = await upgradeMarketplacePlugins({
      ...upgradeDepsOf(freshDir, freshSpawn, countingFetch, ledgerOf(freshDir)),
      now: () => new Date(NOW0.getTime() + 60 * 60 * 1000),
    });
    expect(fetchCalls).toBe(0);
    expect(fresh.outcomes).toEqual([{ status: 'current', id: 'demo-pkg', version: '1.2.3' }]);

    // 过龄：updatedAt = NOW0，now = NOW0 + 25h——先刷新后对拍（假 fetch 回同 commit 不换血）
    const staleDir = dataDirOf('up-ttl-stale');
    seedMarket(
      staleDir,
      [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }],
      NOW0,
    );
    const { spawn: staleSpawn } = npmFakeSpawn(staleDir);
    await installEntry(staleDir, 'demo-pkg@official', staleSpawn);
    let staleCalls = 0;
    const staleFs = createMarketFs();
    const staleFetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        staleCalls += 1;
        // 同 commit 重放——物化克隆（真 fs）供 promote 路径读
        const cloneDir = join(staleDir, 'clone-tmp');
        staleFs.mkdir(join(cloneDir, '.claude-plugin'));
        staleFs.write(
          join(cloneDir, '.claude-plugin', 'marketplace.json'),
          JSON.stringify({
            name: 'official',
            owner: { name: 'o' },
            plugins: [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }],
          }),
        );
        return { cloneDir, catalogPath: '.claude-plugin/marketplace.json', text: '', commit: COMMIT1 };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const stale = await upgradeMarketplacePlugins({
      ...upgradeDepsOf(staleDir, staleSpawn, staleFetch, ledgerOf(staleDir)),
      now: () => new Date(NOW0.getTime() + 25 * 60 * 60 * 1000),
    });
    expect(staleCalls).toBe(1); // 过龄回源恰一次
    expect(stale.outcomes).toEqual([{ status: 'current', id: 'demo-pkg', version: '1.2.3' }]);
    // 回源后 updatedAt 已重置（TTL 窗重启）
    const sources = readMarketplaceSources(staleDir, staleFs);
    expect(sources.ok && sources.sources[0]).toMatchObject({
      updatedAt: new Date(NOW0.getTime() + 25 * 60 * 60 * 1000).toISOString(),
    });
  });

  it('刷新换 catalogPath + 同批 upgrade：对拍走新路径（上游 catalog 换位形不误报缓存缺席）', async () => {
    const dataDir = dataDirOf('up-relocate');
    // 种源即过龄（updatedAt = NOW0 - 25h）——同批 upgrade 必触发回源刷新
    seedMarket(
      dataDir,
      [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }],
      new Date(NOW0.getTime() - 25 * 60 * 60 * 1000),
    );
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    const later = new Date(NOW0.getTime() + 25 * 60 * 60 * 1000);
    // 上游 catalog 换位（.claude-plugin/ → .omp-plugin/）+ 新 commit + 版本推进 1.3.0
    const fs = createMarketFs();
    const relocated: MarketFetchFace = {
      fetchGitCatalog: async () => {
        const cloneDir = join(dataDir, 'clone-relocate');
        fs.mkdir(join(cloneDir, '.omp-plugin'));
        fs.write(
          join(cloneDir, '.omp-plugin', 'marketplace.json'),
          JSON.stringify({
            name: 'official',
            owner: { name: 'o' },
            plugins: [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.3.0' } }],
          }),
        );
        return {
          cloneDir,
          catalogPath: '.omp-plugin/marketplace.json',
          text: '',
          commit: 'cccc2222dddd3333eeee4444ffff5555aaaa6666',
        };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const { spawn: spawn2, argvLog } = npmFakeSpawn(dataDir);
    const result = await upgradeMarketplacePlugins({
      ...upgradeDepsOf(dataDir, spawn2, relocated, ledgerOf(dataDir)),
      now: () => later,
    });
    // 换位不误报「缓存缺席」——对拍按刷新后的新 catalogPath 走，版本推进真升级
    expect(result.rejected).toBeNull();
    expect(result.outcomes).toEqual([{ status: 'upgraded', id: 'demo-pkg', from: '1.2.3', to: '1.3.0' }]);
    expect(argvLog.some((argv) => argv.includes('demo-pkg@1.3.0'))).toBe(true); // 换装真发生
    // 源清单 record 已前进到新 catalogPath（刷新腿 commitRecordUpdate 落盘）
    const sources = readMarketplaceSources(dataDir, createMarketFs());
    expect(sources.ok && sources.sources[0]).toMatchObject({ catalogPath: '.omp-plugin/marketplace.json' });
  });

  it('零市场装机物 = 空对拍面（outcomes 空、非拒）', async () => {
    const dataDir = dataDirOf('up-empty');
    seedMarket(dataDir, []);
    const { spawn } = npmFakeSpawn(dataDir);
    const result = await upgradeMarketplacePlugins(upgradeDepsOf(dataDir, spawn, noFetch, []));
    expect(result.rejected).toBeNull();
    expect(result.outcomes).toHaveLength(0);
  });
});

/* ---------------- mp 收尾批修复批回归锁（修前必红——correctness 五笔） ---------------- */

/** 修复批用 git 源基准记录（与上文 git describe 的 baseRecord 同形） */
const gitBaseRecord: MarketplaceSourceRecord = {
  name: 'official',
  sourceType: 'github',
  sourceUri: 'owner/repo',
  catalogPath: '.claude-plugin/marketplace.json',
  addedAt: T0.toISOString(),
  updatedAt: T0.toISOString(),
  commit: 'aaa1111',
};

/** 修复批用 url 源基准记录 */
const urlBaseRecord: MarketplaceSourceRecord = {
  name: 'url-one',
  sourceType: 'url',
  sourceUri: 'https://example.com/cat.json',
  catalogPath: 'marketplace.json',
  addedAt: T0.toISOString(),
  updatedAt: T0.toISOString(),
};

/** local 源刷新不消费网络腿——任何 fetch 调用即失败 */
const noNetworkFetch: MarketFetchFace = {
  fetchGitCatalog: async () => {
    throw new Error('local 源不消费网络腿');
  },
  fetchUrlCatalog: async () => {
    throw new Error('local 源不消费网络腿');
  },
};

describe('mp 收尾批修复批——update 面回归锁', () => {
  it('local 源 catalog 双路径搬移（同文本）= 有变化走换血——up-to-date 判据带路径前置条件', async () => {
    // 源仓把 catalog 从 .claude-plugin 迁到 .omp-plugin（内容逐字节不变——纯
    // 文件搬移；双路径读序 CATALOG_RELATIVE_PATHS 明确支持两形互迁）。若按
    // 「文本相同即已最新」判，record.catalogPath 会被补丁到缓存中不存在的新
    // 路径 → discover/install/upgrade 整体「缓存缺席」失读。
    const sameText = catalogText('moved-mkt', []);
    const fs = memFs({
      '/src/moved-mkt/.omp-plugin/marketplace.json': sameText,
      '/data/marketplaces/moved-mkt/.claude-plugin/marketplace.json': sameText,
    });
    const record: MarketplaceSourceRecord = {
      name: 'moved-mkt',
      sourceType: 'local',
      sourceUri: '/src/moved-mkt',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    };
    writeMarketplaceSources('/data', [record], fs);
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs, fetch: noNetworkFetch, now: () => T1 },
      record,
    );
    // 路径搬移 = 有变化——换血而非「已是最新」（catalogPath 前进属换血分支）
    expect(outcome).toEqual({ status: 'updated', name: 'moved-mkt', entryCount: 0 });
    const sources = readMarketplaceSources('/data', fs);
    expect(sources.ok && sources.sources[0]).toMatchObject({
      catalogPath: '.omp-plugin/marketplace.json',
      updatedAt: T1.toISOString(),
    });
    // 换血后缓存按新路径可读、旧路径清场（读位即恢复——不再「缓存缺席」）
    expect(fs.read('/data/marketplaces/moved-mkt/.omp-plugin/marketplace.json')).toBe(sameText);
    expect(fs.read('/data/marketplaces/moved-mkt/.claude-plugin/marketplace.json')).toBeNull();
  });

  it('换血失败位：copyTree 中途抛 = failed + 旧缓存原样不动 + staging/tmp 克隆场清场（record 不动——修前红：rm 先行自毁既有缓存）', async () => {
    const fs = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
    });
    writeMarketplaceSources('/data', [gitBaseRecord], fs);
    // fetch 物化克隆正常、promote 拷贝写位抛（模拟盘满 ENOSPC——真抛源为
    // fs.write/mkdir/rm 侧；read/readdir 缺席语义返 null 不抛）。拦截面须盖
    // official/ 与 official.staging/ 两目录（staging promote 中转同源盘位）
    const flaky: MarketFs = {
      ...fs,
      write: (path, text) => {
        if (path.startsWith('/data/marketplaces/official')) {
          throw new Error('ENOSPC: mock disk full');
        }
        return fs.write(path, text);
      },
    };
    const fetch = gitFetchReturning(flaky, 'bbb2222', catalogText('official', []));
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs: flaky, fetch, now: () => T1 },
      gitBaseRecord,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('update'); // 自愈指路注记
    // tmp 克隆场清场（fetch 契约「成功返回后清场归调用方」——换血失败位不漏清）
    expect(flaky.isDir('/tmp/clone')).toBe(false);
    // 旧缓存原样不动（03 §9.6 换血 promote 故障防护注——失败刷新不得自毁既有
    // 缓存：upgrade「刷新失败按既有缓存对拍」降级律的故障防护前提）
    expect(flaky.read('/data/marketplaces/official/.claude-plugin/marketplace.json')).toBe(catalogText('official', []));
    // 半拷贝永不 promote——staging 中转清场（成或湮，无残影）
    expect(flaky.readdir('/data/marketplaces/official.staging')).toBeNull();
    // record 不动（不虚报刷新）
    const sources = readMarketplaceSources('/data', flaky);
    expect(sources.ok && sources.sources[0]).toMatchObject({
      commit: 'aaa1111',
      updatedAt: T0.toISOString(),
    });
  });

  it('落账失败位：promote 已成而落账抛 = failed 注记自愈 + 已 promote 缓存保持在场 + tmp/staging 清场', async () => {
    const fs = memFs({
      '/data/marketplaces/official/.claude-plugin/marketplace.json': catalogText('official', []),
    });
    writeMarketplaceSources('/data', [gitBaseRecord], fs);
    // 换血 promote 成功后、源清单原子写（tmp+rename）时抛——模拟账本写位盘满
    const flaky: MarketFs = {
      ...fs,
      write: (path, text) => {
        if (path.startsWith('/data/marketplaces.json')) {
          throw new Error('ENOSPC: mock ledger full');
        }
        return fs.write(path, text);
      },
    };
    const upstream = catalogText('official', [
      { name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '9.9.9' } },
    ]);
    const fetch = gitFetchReturning(flaky, 'bbb2222', upstream);
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs: flaky, fetch, now: () => T1 },
      gitBaseRecord,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('update'); // 自愈指路注记
    // tmp 克隆场清场 + staging 中转清场（promote 已 rename 落位——中转不复在场）
    expect(flaky.isDir('/tmp/clone')).toBe(false);
    expect(flaky.readdir('/data/marketplaces/official.staging')).toBeNull();
    // 已 promote 新内容保持在场（03 §9.6 修笔：record 落后于内容为良性窗——
    // 下次 update commit 对拍不等自然收敛，不采「清场回缺席」形）
    expect(flaky.read('/data/marketplaces/official/.claude-plugin/marketplace.json')).toBe(upstream);
    // record 不动
    const sources = readMarketplaceSources('/data', flaky);
    expect(sources.ok && sources.sources[0]).toMatchObject({
      commit: 'aaa1111',
      updatedAt: T0.toISOString(),
    });
  });

  it('local 腿换血失败位同律：拷贝中途抛 = 旧缓存原样不动 + staging 清场（修前红——rm 先行自毁）', async () => {
    const upstream = catalogText('zeta', [
      { name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '9.9.9' } },
    ]);
    const fs = memFs({
      '/src/zeta/.claude-plugin/marketplace.json': upstream,
      '/src/zeta/keep-me.txt': 'keep',
      // 旧缓存在场（升级逃生门要保的既有内容——附属文件随缓存整树存活）
      '/data/marketplaces/zeta/.claude-plugin/marketplace.json': catalogText('zeta', []),
      '/data/marketplaces/zeta/keep-me.txt': 'old',
    });
    const record: MarketplaceSourceRecord = {
      name: 'zeta',
      sourceType: 'local',
      sourceUri: '/src/zeta',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    };
    writeMarketplaceSources('/data', [record], fs);
    // promote 拷贝到第二文件（keep-me.txt）写位抛——模拟盘满/EACCES（拦截面盖
    // zeta/ 与 zeta.staging/ 两目录）
    const flaky: MarketFs = {
      ...fs,
      write: (path, text) => {
        if (path.startsWith('/data/marketplaces/zeta') && path.endsWith('keep-me.txt')) {
          throw new Error('EACCES: mock write denied');
        }
        return fs.write(path, text);
      },
    };
    const outcome = await refreshMarketplaceSource(
      { dataDir: '/data', fs: flaky, fetch: noFetch, now: () => T1 },
      record,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('EACCES');
    // 旧缓存原样不动（三腿同律——失败刷新不得自毁既有缓存）
    expect(flaky.read('/data/marketplaces/zeta/keep-me.txt')).toBe('old');
    expect(flaky.read('/data/marketplaces/zeta/.claude-plugin/marketplace.json')).toBe(catalogText('zeta', []));
    // staging 中转清场（半拷贝永不 promote——中转成或湮）
    expect(flaky.readdir('/data/marketplaces/zeta.staging')).toBeNull();
    const sources = readMarketplaceSources('/data', flaky);
    expect(sources.ok && sources.sources[0]).toMatchObject({ updatedAt: T0.toISOString() });
  });

  it('url 腿换血失败位同律：写入位抛 = 旧缓存原样不动（修前红——rm 先行自毁）', async () => {
    const upstream = catalogText('url-two', [
      { name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '9.9.9' } },
    ]);
    const fs = memFs({
      '/data/marketplaces/url-two/marketplace.json': catalogText('url-two', []),
    });
    const record: MarketplaceSourceRecord = {
      name: 'url-two',
      sourceType: 'url',
      sourceUri: 'https://example.com/marketplace.json',
      catalogPath: 'marketplace.json',
      addedAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    };
    writeMarketplaceSources('/data', [record], fs);
    const flaky: MarketFs = {
      ...fs,
      write: (path, text) => {
        if (path.startsWith('/data/marketplaces/url-two')) {
          throw new Error('ENOSPC: mock disk full');
        }
        return fs.write(path, text);
      },
    };
    const outcome = await refreshMarketplaceSource(
      {
        dataDir: '/data',
        fs: flaky,
        fetch: { ...noFetch, fetchUrlCatalog: async () => ({ text: upstream }) },
        now: () => T1,
      },
      record,
    );
    expect(outcome.status).toBe('failed');
    // 旧缓存原样不动 + staging 中转清场
    expect(flaky.read('/data/marketplaces/url-two/marketplace.json')).toBe(catalogText('url-two', []));
    expect(flaky.readdir('/data/marketplaces/url-two.staging')).toBeNull();
    const sources = readMarketplaceSources('/data', flaky);
    expect(sources.ok && sources.sources[0]).toMatchObject({ updatedAt: T0.toISOString() });
  });

  it('源清单窗内坏形 = 刷新落账拒写防覆盖（fail-loud——不以空账本兜底抹除全账本）', async () => {
    const fs = memFs({ '/data/marketplaces/url-one/marketplace.json': catalogText('url-one', []) });
    // 两源在册——刷新窗内账本被写坏（并行 CLI 进程/手编：文件域账本人类可读可直查）
    writeMarketplaceSources(
      '/data',
      [urlBaseRecord, { ...urlBaseRecord, name: 'other-mkt', sourceUri: 'https://example.com/other.json' }],
      fs,
    );
    fs.write('/data/marketplaces.json', '{corrupted');
    const outcome = await refreshMarketplaceSource(
      {
        dataDir: '/data',
        fs,
        fetch: {
          fetchGitCatalog: async () => {
            throw new Error('本用例不达');
          },
          fetchUrlCatalog: async () => ({ text: catalogText('url-one', []) }),
        },
        now: () => T1,
      },
      urlBaseRecord,
    );
    // 坏账本拒写——failed 而非「已是最新」静默落空账本
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('坏形');
    // 坏账本原样保留——未被 {version:1,marketplaces:[]} 覆盖（其余源记录不抹除）
    expect(fs.read('/data/marketplaces.json')).toBe('{corrupted');
  });
});

describe('mp 收尾批修复批——upgrade 面回归锁', () => {
  it('TTL 刷新搬移 catalog 路径后，对拍用落账后的新 record（陈化快照不假「缓存缺席」）', async () => {
    const dataDir = dataDirOf('up-refresh-move');
    seedMarket(dataDir, [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }]);
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    // 过龄回源：上游新 commit 把 catalog 搬到 .omp-plugin（版本推进 1.3.0）——
    // 刷新换血会落新 catalogPath；逐条对拍若沿用刷新前内存快照（旧路径），
    // 读换血后的新缓存树即 null → 全部条目假「缓存缺席」跳过
    const cloneFs = createMarketFs();
    const movedCommit = 'eeee1111ffff2222cccc3333dddd4444aaaa5555';
    const movedFetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        const cloneDir = join(dataDir, 'clone-tmp');
        cloneFs.mkdir(join(cloneDir, '.omp-plugin'));
        cloneFs.write(
          join(cloneDir, '.omp-plugin', 'marketplace.json'),
          JSON.stringify({
            name: 'official',
            owner: { name: 'o' },
            plugins: [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.3.0' } }],
          }),
        );
        return { cloneDir, catalogPath: '.omp-plugin/marketplace.json', text: '', commit: movedCommit };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const { spawn: spawn2 } = npmFakeSpawn(dataDir);
    const result = await upgradeMarketplacePlugins({
      ...upgradeDepsOf(dataDir, spawn2, movedFetch, ledgerOf(dataDir)),
      now: () => new Date(NOW0.getTime() + 25 * 60 * 60 * 1000), // 过龄——触发 TTL 惰性刷新
    });
    expect(result.rejected).toBeNull();
    expect(result.refreshFailures).toHaveLength(0);
    // 对拍继续（升级成功）而非 skipped「缓存缺席」
    expect(result.outcomes).toEqual([{ status: 'upgraded', id: 'demo-pkg', from: '1.2.3', to: '1.3.0' }]);
    // 落账 record 已随换血前进（catalogPath 搬移 + commit + updatedAt）
    const sources = readMarketplaceSources(dataDir, createMarketFs());
    expect(sources.ok && sources.sources[0]).toMatchObject({ catalogPath: '.omp-plugin/marketplace.json' });
  });

  it('刷新 promote 失败降级：旧缓存原样不动 → 对拍照走既有缓存（非「缓存缺席」空跑——修前红：rm 先行自毁降级承诺）', async () => {
    const dataDir = dataDirOf('up-promote-fail-degrade');
    seedMarket(dataDir, [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }]);
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    // 过龄源 + 刷新腿 promote 写位失败（armed 拦截面盖 official/ 与 official.staging/）
    const real = createMarketFs();
    let armed = false;
    const flaky: MarketFs = {
      ...real,
      write: (path, text) => {
        if (armed && path.includes(join(dataDir, 'marketplaces', 'official'))) {
          throw new Error('EACCES: mock write denied');
        }
        return real.write(path, text);
      },
    };
    const newCommit = 'ffff1111eeee2222dddd3333cccc4444bbbb5555';
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        const cloneDir = join(dataDir, 'clone-tmp');
        real.mkdir(join(cloneDir, '.claude-plugin'));
        real.write(
          join(cloneDir, '.claude-plugin', 'marketplace.json'),
          JSON.stringify({
            name: 'official',
            owner: { name: 'o' },
            plugins: [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '9.9.9' } }],
          }),
        );
        return { cloneDir, catalogPath: '.claude-plugin/marketplace.json', text: '', commit: newCommit };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    armed = true;
    const result = await upgradeMarketplacePlugins(
      {
        ...upgradeDepsOf(dataDir, spawn, fetch, ledgerOf(dataDir)),
        fs: flaky,
        now: () => new Date(NOW0.getTime() + 25 * 60 * 60 * 1000), // 过龄——触发 TTL 惰性刷新
      },
      // 全量对拍（非单件点名——点名 = force 换血重装恒 upgraded，照不出对拍腿）
    );
    expect(result.rejected).toBeNull();
    // 刷新失败不拒整批——warn 注记（降级承诺兑现的观测位）
    expect(result.refreshFailures).toHaveLength(1);
    expect(result.refreshFailures[0]).toContain('official');
    // 对拍降级走既有缓存：旧 catalog 1.2.3 对账本 1.2.3 = current（rm 先行形
    // 此处读 null → 整条假「缓存缺席」跳过——降级承诺自毁即本锁修前红形）
    expect(result.outcomes).toEqual([{ status: 'current', id: 'demo-pkg', version: '1.2.3' }]);
    // 旧缓存整树在场 + staging 中转零残影
    expect(real.read(join(dataDir, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'))).toContain(
      '1.2.3',
    );
    expect(real.readdir(join(dataDir, 'marketplaces', 'official.staging'))).toBeNull();
  });

  it('id 漂移换装：upgrade 回执 idDrift 注记 + 撤账 + 启用行随迁（修前红——回执旧 id 无漂移指路）', async () => {
    const dataDir = dataDirOf('up-id-drift');
    seedMarket(dataDir, [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } }]);
    const { spawn } = npmFakeSpawn(dataDir);
    await installEntry(dataDir, 'demo-pkg@official', spawn);
    // 用户启用（mount 行——随迁断言的意图锚）
    expect(mountRow(dataDir, 'demo-pkg', undefined, createPluginStoreFs())).toMatchObject({ ok: true });
    // 上游换代：catalog 同条目换 npm 包名 → 新包清单 id = demo-pkg-next（id 漂移）
    const fs = createMarketFs();
    fs.write(
      join(dataDir, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'official',
        owner: { name: 'o' },
        plugins: [{ name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg-next', version: '1.3.0' } }],
      }),
    );
    const result = await upgradeMarketplacePlugins(
      upgradeDepsOf(dataDir, spawn, noFetch, ledgerOf(dataDir)),
      'demo-pkg@official', // 单件点名 = force 换血重装
    );
    expect(result.rejected).toBeNull();
    // 回执诚实：upgraded 态携带 idDrift（旧 id → 新 id——呈现面指路「下次以新 id 寻址」）
    expect(result.outcomes).toEqual([
      {
        status: 'upgraded',
        id: 'demo-pkg',
        from: '1.2.3',
        to: '1.3.0',
        idDrift: { from: 'demo-pkg', to: 'demo-pkg-next' },
      },
    ]);
    // 撤账恰一条（旧 id 出账、market 溯源保形）+ 启用行随迁
    const ledger = ledgerOf(dataDir);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: 'demo-pkg-next', market: { name: 'official', entry: 'demo-pkg' } });
    const rows = readEnabledRowsForEdit(dataDir, createPluginStoreFs());
    expect(rows.ok && rows.rows.map((row) => row.id)).toEqual(['demo-pkg-next']);
  });
});
