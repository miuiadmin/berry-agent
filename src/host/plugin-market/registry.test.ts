/**
 * host/plugin-market/registry 测试——源清单账本 marketplaces.json（§9.6 源
 * 清单节）：形状校验 fail-loud 不炸宿主（result 面）/ 原子写（tmp+rename 同
 * ledger 律）/ 纯 CRUD（撞名拒/查无拒）/ berry 增 commit 位保真。
 */
import { describe, expect, it } from 'vitest';

import {
  addSourceRecord,
  marketplacesFilePath,
  readMarketplaceSources,
  removeSourceRecord,
  writeMarketplaceSources,
} from './registry.js';
import type { MarketFs, MarketplaceSourceRecord, MarketplaceSourcesFile } from './types.js';

/** 内存 fs（含 tmp 残影检测——write/rename 全记录） */
function memFs(initial: Record<string, string> = {}): MarketFs & { readonly paths: () => readonly string[] } {
  const files = new Map(Object.entries(initial));
  const isUnder = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
  const face: MarketFs = {
    read: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, text);
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
  return { ...face, paths: () => [...files.keys()] };
}

/** 样例源记录速记 */
function record(overrides: Partial<MarketplaceSourceRecord> & { readonly name: string }): MarketplaceSourceRecord {
  return {
    sourceType: 'local',
    sourceUri: `/src/${overrides.name}`,
    catalogPath: '.claude-plugin/marketplace.json',
    addedAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('源清单读侧（形状校验 fail-loud 不炸宿主）', () => {
  it('文件缺席 = 空清单（零源出厂——首启零文件零报错）', () => {
    const result = readMarketplaceSources('/data', memFs());
    expect(result).toEqual({ ok: true, sources: [] });
  });

  it('好形读回 + berry 增 commit 位保真', () => {
    const doc = {
      version: 1,
      marketplaces: [
        record({ name: 'official', sourceType: 'git', sourceUri: 'https://github.com/a/b.git', commit: 'abc1234' }),
        record({ name: 'local-one' }),
      ],
    };
    const result = readMarketplaceSources('/data', memFs({ '/data/marketplaces.json': JSON.stringify(doc) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.commit).toBe('abc1234');
    expect(result.sources[1]?.commit).toBeUndefined();
  });

  it('坏 JSON / 顶层非对象 / version≠1 / marketplaces 非数组 = invalid（不抛不静默空）', () => {
    const fs = memFs();
    for (const text of [
      '{bad',
      '[]',
      'null',
      '"str"',
      '{"version":2,"marketplaces":[]}',
      '{"version":1,"marketplaces":{}}',
    ]) {
      fs.write('/data/marketplaces.json', text);
      const result = readMarketplaceSources('/data', fs);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('条目坏形（name 非串/名词法拒/sourceType 越枚举/sourceUri 缺/catalogPath 缺/时间戳非串）= invalid', () => {
    const base = { version: 1 };
    const badEntries: unknown[] = [
      { sourceType: 'git', sourceUri: 'https://a/b', catalogPath: 'x', addedAt: 't', updatedAt: 't' }, // name 缺
      { name: 42, sourceType: 'git', sourceUri: 'https://a/b', catalogPath: 'x', addedAt: 't', updatedAt: 't' },
      { name: 'Bad Name', sourceType: 'git', sourceUri: 'https://a/b', catalogPath: 'x', addedAt: 't', updatedAt: 't' },
      { name: 'm', sourceType: 'cpan', sourceUri: 'https://a/b', catalogPath: 'x', addedAt: 't', updatedAt: 't' },
      { name: 'm', sourceType: 'git', catalogPath: 'x', addedAt: 't', updatedAt: 't' }, // sourceUri 缺
      { name: 'm', sourceType: 'git', sourceUri: 'https://a/b', addedAt: 't', updatedAt: 't' }, // catalogPath 缺
      { name: 'm', sourceType: 'git', sourceUri: 'https://a/b', catalogPath: 'x', addedAt: 't' }, // updatedAt 缺
      { name: 'm', sourceType: 'git', sourceUri: 'https://a/b', catalogPath: 'x', addedAt: 123, updatedAt: 't' },
      'not-an-object',
    ];
    for (const entry of badEntries) {
      const result = readMarketplaceSources(
        '/data',
        memFs({ '/data/marketplaces.json': JSON.stringify({ ...base, marketplaces: [entry] }) }),
      );
      expect(result.ok).toBe(false);
    }
  });
});

describe('源清单写侧（原子写 tmp+rename 同 ledger 律）', () => {
  it('写后读回往返一致 + 无 tmp 残影', () => {
    const fs = memFs();
    const sources = [record({ name: 'a' }), record({ name: 'b' })];
    writeMarketplaceSources('/data', sources, fs);
    const read = readMarketplaceSources('/data', fs);
    expect(read.ok && read.sources).toHaveLength(2);
    // tmp 文件（.tmp- 尾）不留残影
    expect(fs.paths().filter((p) => p.includes('.tmp-'))).toEqual([]);
    expect(fs.paths()).toEqual(['/data/marketplaces.json']);
  });

  it('写侧恒出顶层 version 1 + 条目数组规范形', () => {
    const fs = memFs();
    writeMarketplaceSources('/data', [record({ name: 'a' })], fs);
    const doc = JSON.parse(fs.read('/data/marketplaces.json')!) as MarketplaceSourcesFile;
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.marketplaces)).toBe(true);
  });

  it('路径构造：数据目录根下 marketplaces.json（文件域账本——不进 SQLite）', () => {
    expect(marketplacesFilePath('/data')).toBe('/data/marketplaces.json');
  });
});

describe('纯 CRUD（add/remove——写侧编舞的纯函数基座）', () => {
  const empty: MarketplaceSourcesFile = { version: 1, marketplaces: [] };

  it('add 追加保序 + 撞名拒', () => {
    const first = addSourceRecord(empty, record({ name: 'a' }));
    expect(first.marketplaces.map((m) => m.name)).toEqual(['a']);
    const second = addSourceRecord(first, record({ name: 'b' }));
    expect(second.marketplaces.map((m) => m.name)).toEqual(['a', 'b']); // 保序尾追加
    expect(() => addSourceRecord(second, record({ name: 'a' }))).toThrow(/a/);
  });

  it('remove 删行 + 查无拒', () => {
    const file = addSourceRecord(empty, record({ name: 'a' }));
    const removed = removeSourceRecord(file, 'a');
    expect(removed.marketplaces).toEqual([]);
    expect(() => removeSourceRecord(removed, 'a')).toThrow();
  });
});
