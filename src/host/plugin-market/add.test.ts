/**
 * host/plugin-market/add 测试——add 编舞（§9.6 源分类五规则序·add 解析位 +
 * 源清单与缓存节）：本地目录源全链零网络（读 catalog → 快照缓存 → 落源清
 * 单）/ git/url 源 fetch 注入位（mp-2 零网络——缺席诚实拒、在场注假件全链
 * commit 落账）/ 撞名拒 / 坏 catalog 拒零残影。
 */
import { describe, expect, it } from 'vitest';

import { addMarketplaceSource } from './add.js';
import type { MarketFs, MarketFetchFace } from './types.js';

/** 内存 fs（真盘语义 Map 形 + 目录树快照支持——拷贝腿在内存形上真跑） */
function memFs(initial: Record<string, string> = {}): MarketFs {
  const files = new Map(Object.entries(initial));
  const isUnder = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
  return {
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
}

const NOW = new Date('2026-09-16T12:00:00.000Z');
const now = () => new Date(NOW);

/** 本地市场仓 fixture：.claude-plugin/marketplace.json + 一条相对源条目目录 */
const LOCAL_MARKET = {
  '/src/alpha/.claude-plugin/marketplace.json': JSON.stringify({
    name: 'alpha',
    owner: { name: 'o' },
    plugins: [{ name: 'hello-plugin', source: './plugins/hello' }],
  }),
  '/src/alpha/plugins/hello/package.json': '{"name":"hello","version":"1.0.0"}',
};

describe('add 编舞——本地目录源全链（零网络）', () => {
  it('local 源：catalog 读 → 快照缓存 → 源清单落账（name=catalog 自报名）', async () => {
    const fs = memFs({ ...LOCAL_MARKET });
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual({
      name: 'alpha',
      sourceType: 'local',
      sourceUri: '/src/alpha',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    // 缓存快照在场：marketplaces/alpha/ 内 catalog + 插件子目录可读
    expect(fs.read('/data/marketplaces/alpha/.claude-plugin/marketplace.json')).toContain('alpha');
    expect(fs.read('/data/marketplaces/alpha/plugins/hello/package.json')).toContain('hello');
    // 源清单文件落盘（version 1 + 单条目）
    const doc = JSON.parse(fs.read('/data/marketplaces.json')!) as { version: number; marketplaces: unknown[] };
    expect(doc.version).toBe(1);
    expect(doc.marketplaces).toHaveLength(1);
  });

  it('同名竞态窗兜底：checkNameClash 通过后落账位撞名 → result 面诚实拒不裸抛（修前红）', async () => {
    // 竞态窗复现：包装 fs 只在「第二次」读源清单（commitRecord 读位——前次
    // 是 checkNameClash）注入他 add 已落账的同名 record，模拟前置检查通过
    // 后、落账前的并发交错
    const base = memFs({ ...LOCAL_MARKET });
    let reads = 0;
    const racingFs: MarketFs = {
      ...base,
      read: (path) => {
        if (path === '/data/marketplaces.json') {
          reads += 1;
          if (reads === 2) {
            // 落账读窗——他 lane 赢家已落同名源
            return JSON.stringify({
              version: 1,
              marketplaces: [
                {
                  name: 'alpha',
                  sourceType: 'local',
                  sourceUri: '/other/mirror',
                  catalogPath: '.claude-plugin/marketplace.json',
                  addedAt: NOW.toISOString(),
                  updatedAt: NOW.toISOString(),
                },
              ],
            });
          }
        }
        return base.read(path);
      },
    };
    const result = await addMarketplaceSource({ dataDir: '/data', fs: racingFs, now }, '/src/alpha');
    // 修前：addSourceRecord 同名 throw 裸逃出 result 面（rejects 形——CLI
    // 呈现为未捕获异常）；修后：与 checkNameClash 同词面 {ok:false} 诚实拒
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('alpha');
    expect(result.message).toContain('remove');
    expect(reads).toBeGreaterThanOrEqual(2); // 注入确落在落账读位
    // 拒时不落任何写——赢家的源清单不被覆写（坏形拒改同律，无 base=[] 静默洗）
    expect(base.read('/data/marketplaces.json')).toBeNull();
  });

  it('双路径读序参与 add（仅 .omp-plugin 在场同样可 add）', async () => {
    const fs = memFs({
      '/src/omp-mkt/.omp-plugin/marketplace.json': JSON.stringify({
        name: 'omp-one',
        owner: { name: 'o' },
        plugins: [],
      }),
    });
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/omp-mkt');
    expect(result.ok && result.record.catalogPath).toBe('.omp-plugin/marketplace.json');
  });

  it('撞名拒（同 catalog 自报名已 add——信任裁决是用户显式动作，不静默换血）', async () => {
    const fs = memFs({ ...LOCAL_MARKET });
    const first = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha');
    expect(first.ok).toBe(true);
    const second = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.message).toContain('alpha');
    expect(second.message).toContain('remove');
  });

  it('坏 catalog = 拒且零残影（不落源清单、不留缓存目录）', async () => {
    const fs = memFs({ '/src/bad/.claude-plugin/marketplace.json': '{bad' });
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/bad');
    expect(result.ok).toBe(false);
    expect(fs.read('/data/marketplaces.json')).toBeNull(); // 不落账
    expect(fs.isDir('/data/marketplaces/bad')).toBe(false); // 无缓存残影
  });

  it('catalog 双路径全缺席 = 拒（报文含两候选路径）', async () => {
    const fs = memFs({ '/src/empty/README.md': 'x' });
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/empty');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('.omp-plugin/marketplace.json');
    expect(result.message).toContain('.claude-plugin/marketplace.json');
  });

  it('源目录本身缺席 = 拒（诚实报错不造空缓存）', async () => {
    const result = await addMarketplaceSource({ dataDir: '/data', fs: memFs(), now }, '/src/nothere');
    expect(result.ok).toBe(false);
  });

  it('重 add 同源不同名路径 = 独立两源（name 域=catalog 自报名）', async () => {
    const fs = memFs({
      ...LOCAL_MARKET,
      '/src/alpha-copy/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'alpha-copy',
        owner: { name: 'o' },
        plugins: [],
      }),
    });
    expect((await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha')).ok).toBe(true);
    expect((await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha-copy')).ok).toBe(true);
    const doc = JSON.parse(fs.read('/data/marketplaces.json')!) as { marketplaces: { name: string }[] };
    expect(doc.marketplaces.map((m) => m.name)).toEqual(['alpha', 'alpha-copy']);
  });
});

describe('add 编舞——网络源 fetch 注入位（mp-2 零网络；mp-4 落真身）', () => {
  it('git/url 源 + fetch 缺席 = 诚实拒（真因 = 装配面未注入——报文不再指路已落地批次）', async () => {
    for (const source of [
      'https://github.com/anthropics/claude-plugins-official',
      'git@github.com:owner/repo.git',
      'https://example.com/catalog.json',
      'owner/repo',
    ]) {
      const result = await addMarketplaceSource({ dataDir: '/data', fs: memFs(), now }, source);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // 诚实拒报文描述当下真因（装配面未注入 MarketFetchFace——嵌入式宿主须自注）
      expect(result.message).toContain('装配面未注入 MarketFetchFace');
      expect(result.message).not.toContain('mp-4'); // 不再以已落地批次为词（修前红位）
      // 指路当下可用替代（本地路径源）
      expect(result.message).toContain('本地路径源');
    }
  });

  it('git 源 + 注假 fetcher：全链落账 + commit 位锁定（零网络）', async () => {
    const fs = memFs();
    const fetched: string[] = [];
    const fetch: MarketFetchFace = {
      // 假件：模拟 mp-4 真身契约——克隆到 tmp、双路径读 catalog、锁 commit
      fetchGitCatalog: async (url) => {
        fetched.push(url);
        fs.write(
          '/tmp/clone/.claude-plugin/marketplace.json',
          JSON.stringify({
            name: 'official',
            owner: { name: 'o' },
            plugins: [{ name: 'p', source: './plugins/p' }],
          }),
        );
        return { cloneDir: '/tmp/clone', catalogPath: '.claude-plugin/marketplace.json', text: '', commit: 'c0mmit1' };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const result = await addMarketplaceSource(
      { dataDir: '/data', fs, now, fetch },
      'https://github.com/a/official.git',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetched).toEqual(['https://github.com/a/official.git']);
    expect(result.record).toEqual({
      name: 'official',
      sourceType: 'git',
      sourceUri: 'https://github.com/a/official.git',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      commit: 'c0mmit1', // berry 增 commit 位——两次 fetch 漂移防线
    });
    // clone 目录 promote 进缓存（换血语义：tmp clone → marketplaces/<name>/）
    expect(fs.read('/data/marketplaces/official/.claude-plugin/marketplace.json')).toContain('official');
    expect(fs.isDir('/tmp/clone')).toBe(false); // tmp 清场
  });

  it('github 短手源 + 注假 fetcher：短手展开后进 fetch（url 单形）', async () => {
    const fs = memFs();
    const fetched: string[] = [];
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async (url) => {
        fetched.push(url);
        fs.write(
          '/tmp/clone/.omp-plugin/marketplace.json',
          JSON.stringify({ name: 'gh-one', owner: { name: 'o' }, plugins: [] }),
        );
        return { cloneDir: '/tmp/clone', catalogPath: '.omp-plugin/marketplace.json', text: '', commit: 'abc0001' };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now, fetch }, 'owner/repo');
    expect(result.ok).toBe(true);
    expect(fetched).toEqual(['https://github.com/owner/repo.git']);
    if (result.ok) expect(result.record.sourceType).toBe('github');
  });

  it('url 源（.json 尾）+ 注假 fetcher：只存 JSON 快照不克隆全仓 + 无 commit', async () => {
    const fs = memFs();
    const text = JSON.stringify({ name: 'url-one', owner: { name: 'o' }, plugins: [] });
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('本用例不达');
      },
      fetchUrlCatalog: async (url) => {
        expect(url).toBe('https://example.com/cat.json');
        return { text };
      },
    };
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now, fetch }, 'https://example.com/cat.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.sourceType).toBe('url');
    expect(result.record.catalogPath).toBe('marketplace.json'); // 缓存平铺形
    expect(result.record.commit).toBeUndefined(); // URL 源无 commit 位
    // 缓存只存 JSON（无仓结构）
    expect(fs.read('/data/marketplaces/url-one/marketplace.json')).toBe(text);
  });

  it('git 源 fetch 后 catalog 坏形 = 拒零残影（不落账不留缓存不留 tmp）', async () => {
    const fs = memFs();
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        fs.write('/tmp/clone/.claude-plugin/marketplace.json', '{bad');
        return { cloneDir: '/tmp/clone', catalogPath: '.claude-plugin/marketplace.json', text: '{bad', commit: 'x' };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now, fetch }, 'https://a/b.git');
    expect(result.ok).toBe(false);
    expect(fs.read('/data/marketplaces.json')).toBeNull();
    expect(fs.isDir('/data/marketplaces')).toBe(false);
    expect(fs.isDir('/tmp/clone')).toBe(false); // tmp 清场
  });
});

describe('add 编舞——入口校验（classify 前置）', () => {
  it('不识形源 = fail-loud 拒（报文指路两候选）', async () => {
    const result = await addMarketplaceSource({ dataDir: '/data', fs: memFs(), now }, 'plainword');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('./');
  });

  it('~/ 前缀源展开后走 local 腿', async () => {
    const fs = memFs({
      '/home/u/mkt/.claude-plugin/marketplace.json': JSON.stringify({
        name: 'home-mkt',
        owner: { name: 'o' },
        plugins: [],
      }),
    });
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now, home: '/home/u' }, '~/mkt');
    expect(result.ok && result.record.name).toBe('home-mkt');
  });
});

describe('add 编舞——残留缓存前置清场（换血同律：缓存即真相，残留不与新快照混合）', () => {
  /** 残留现场铸造：账本无此名 + 缓存目录有旧文件（remove 两步中断形/手删账本形） */
  it('local 腿：残留缓存目录 re-add 同名源时先整目录清场（上游已删内容不复活）', async () => {
    const fs = memFs({
      ...LOCAL_MARKET,
      // 残留：上次快照里有、当前源目录已删的插件子目录与文件
      '/data/marketplaces/alpha/obsolete-plugin/package.json': '{"name":"gone"}',
      '/data/marketplaces/alpha/stale-note.txt': '残留',
    });
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha');
    expect(result.ok).toBe(true);
    // 残留必须随换血消失——copyTree 合并语义（只写同名不删多余）不先 rm 即混合
    expect(fs.read('/data/marketplaces/alpha/obsolete-plugin/package.json')).toBeNull();
    expect(fs.read('/data/marketplaces/alpha/stale-note.txt')).toBeNull();
    expect(fs.read('/data/marketplaces/alpha/.claude-plugin/marketplace.json')).toContain('alpha');
  });

  it('git 腿 promote：残留缓存目录 re-add 同名源时整目录换血（先 rm 后拷）', async () => {
    const fs = memFs({
      '/data/marketplaces/official/obsolete-entry.txt': '残留', // 账本无 official、缓存残留
    });
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        fs.write(
          '/tmp/clone/.claude-plugin/marketplace.json',
          JSON.stringify({ name: 'official', owner: { name: 'o' }, plugins: [] }),
        );
        return { cloneDir: '/tmp/clone', catalogPath: '.claude-plugin/marketplace.json', text: '', commit: 'c1' };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const result = await addMarketplaceSource(
      { dataDir: '/data', fs, now, fetch },
      'https://github.com/a/official.git',
    );
    expect(result.ok).toBe(true);
    expect(fs.read('/data/marketplaces/official/obsolete-entry.txt')).toBeNull(); // 残留随换血消失
    expect(fs.read('/data/marketplaces/official/.claude-plugin/marketplace.json')).toContain('official');
  });

  it('url 腿：残留缓存目录 re-add 同名源时清场（缓存只含新快照）', async () => {
    const fs = memFs({ '/data/marketplaces/url-one/stale.json': '残留' });
    const text = JSON.stringify({ name: 'url-one', owner: { name: 'o' }, plugins: [] });
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('本用例不达');
      },
      fetchUrlCatalog: async () => ({ text }),
    };
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now, fetch }, 'https://example.com/cat.json');
    expect(result.ok).toBe(true);
    expect(fs.read('/data/marketplaces/url-one/stale.json')).toBeNull();
    expect(fs.read('/data/marketplaces/url-one/marketplace.json')).toBe(text);
  });
});

describe('add 编舞——缓存落位 IO 失败零残影（写位 try 包裹：result 面诚实拒 + 半缓存清除 + tmp 清场）', () => {
  /** IO 故障注入 fs：写 marker 路径时抛（ENOSPC/EACCES 形——真身 MarketFs 裸 writeFileSync 直抛） */
  function enospcOn(base: MarketFs, marker: string): MarketFs {
    return {
      ...base,
      write: (path, text) => {
        if (path.includes(marker)) throw new Error('ENOSPC: 磁盘满（注入）');
        base.write(path, text);
      },
    };
  }

  it('local 腿拷贝中途 IO 失败 = ok:false 拒（不上抛）+ 不落账 + 半缓存目录清除', async () => {
    const base = memFs({ ...LOCAL_MARKET });
    const fs = enospcOn(base, '/data/marketplaces/alpha/plugins/'); // catalog 拷成功、插件子目录中途抛
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now }, '/src/alpha');
    expect(result.ok).toBe(false); // 修前红：IO 异常上抛破 result 契约面
    if (!result.ok) expect(result.message).toContain('ENOSPC');
    expect(fs.read('/data/marketplaces.json')).toBeNull(); // 不落账
    expect(fs.isDir('/data/marketplaces/alpha')).toBe(false); // 半缓存清除——零残影
  });

  it('git 腿 promote 中途 IO 失败 = ok:false 拒 + tmp 克隆场清场 + 半缓存清除', async () => {
    const base = memFs();
    const fs = enospcOn(base, '/data/marketplaces/official/');
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        base.write(
          '/tmp/clone/.claude-plugin/marketplace.json',
          JSON.stringify({ name: 'official', owner: { name: 'o' }, plugins: [] }),
        );
        return { cloneDir: '/tmp/clone', catalogPath: '.claude-plugin/marketplace.json', text: '', commit: 'c1' };
      },
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const result = await addMarketplaceSource(
      { dataDir: '/data', fs, now, fetch },
      'https://github.com/a/official.git',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('ENOSPC');
    expect(fs.isDir('/tmp/clone')).toBe(false); // tmp 克隆场清场——零残影
    expect(fs.isDir('/data/marketplaces/official')).toBe(false);
    expect(fs.read('/data/marketplaces.json')).toBeNull();
  });

  it('url 腿写缓存 IO 失败 = ok:false 拒 + 不落账 + 缓存目录清除', async () => {
    const base = memFs();
    const fs = enospcOn(base, '/data/marketplaces/url-one/');
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => {
        throw new Error('本用例不达');
      },
      fetchUrlCatalog: async () => ({ text: JSON.stringify({ name: 'url-one', owner: { name: 'o' }, plugins: [] }) }),
    };
    const result = await addMarketplaceSource({ dataDir: '/data', fs, now, fetch }, 'https://example.com/cat.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('ENOSPC');
    expect(fs.read('/data/marketplaces.json')).toBeNull();
    expect(fs.isDir('/data/marketplaces/url-one')).toBe(false);
  });
});
