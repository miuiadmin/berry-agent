/**
 * host/plugin-market/catalog 测试——catalog 解析矩阵/双路径读序/名词法边界/
 * pluginRoot 改写/版本四级回落（03 §9.6 catalog 兼容形节；mp-2 读侧核心）。
 *
 * 零网络零真盘：fixture 内联 JSON + 内存 fs 注入。
 */
import { describe, expect, it } from 'vitest';

import {
  applyPluginRoot,
  loadCatalogFromRoot,
  CATALOG_RELATIVE_PATHS,
  parseMarketplaceCatalog,
  resolveEntryVersion,
  resolveRelativeSubpath,
} from './catalog.js';
import type { MarketFs } from './types.js';

/** 内存 fs（文件树 Map 形——目录隐含于路径前缀） */
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

/** 好形 catalog 全字段 fixture（含未知扩展字段——保留不拒面） */
const VALID_CATALOG = JSON.stringify({
  name: 'test-marketplace',
  owner: { name: 'Test Author', email: 'test@example.com' },
  metadata: { description: 'A test marketplace', version: '1.0.0' },
  ompExtensions: { lspServers: {}, strict: true }, // omp 扩展字段——零解读零拒绝
  plugins: [
    {
      name: 'hello-plugin',
      source: './plugins/hello-plugin',
      description: 'greets',
      version: '1.0.0',
      strict: false, // 条目级未知字段
    },
    { name: 'remote-plugin', source: { source: 'github', repo: 'owner/repo', sha: 'abc123def0' } },
    { name: 'npm-plugin', source: { source: 'npm', package: 'acme-widgets', version: '2.1.0' } },
  ],
});

describe('catalog 解析（容错分级——catalog 级整仓拒 / 条目级 warn 跳过）', () => {
  it('好形全字段解析绿 + 未知字段保留（原对象随行）', () => {
    const result = parseMarketplaceCatalog(VALID_CATALOG, 'fixture.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.name).toBe('test-marketplace');
    expect(result.catalog.owner.name).toBe('Test Author');
    expect(result.catalog.plugins).toHaveLength(3);
    expect(result.skipped).toEqual([]);
    // 未知字段保留：catalog 级扩展字段直读可达（不重建对象）
    const raw = JSON.parse(VALID_CATALOG) as Record<string, unknown>;
    expect((result.catalog as unknown as Record<string, unknown>)['ompExtensions']).toEqual(raw['ompExtensions']);
  });

  it('catalog 级必填缺席各级 = 整仓拒（name/owner/owner.name/plugins）', () => {
    const base = JSON.parse(VALID_CATALOG) as Record<string, unknown>;
    expect(parseMarketplaceCatalog(JSON.stringify({ ...base, name: undefined }), 'x.json').ok).toBe(false);
    expect(parseMarketplaceCatalog(JSON.stringify({ ...base, owner: undefined }), 'x.json').ok).toBe(false);
    expect(parseMarketplaceCatalog(JSON.stringify({ ...base, owner: { email: 'a@b.c' } }), 'x.json').ok).toBe(false);
    expect(parseMarketplaceCatalog(JSON.stringify({ ...base, plugins: undefined }), 'x.json').ok).toBe(false);
    // 基线自检：未缺席时恒 ok
    expect(parseMarketplaceCatalog(JSON.stringify({ ...base }), 'x.json').ok).toBe(true);
  });

  it('catalog name 坏名词法 = 整仓拒（外源名域同律执法）', () => {
    const doc = JSON.stringify({ ...JSON.parse(VALID_CATALOG), name: 'Bad Name' });
    expect(parseMarketplaceCatalog(doc, 'x.json').ok).toBe(false);
  });

  it('坏 JSON / 顶层非对象 = 整仓拒（报文带源标签）', () => {
    expect(parseMarketplaceCatalog('{not json', 'label.json').ok).toBe(false);
    expect(parseMarketplaceCatalog('[]', 'label.json').ok).toBe(false);
    expect(parseMarketplaceCatalog('null', 'label.json').ok).toBe(false);
    const bad = parseMarketplaceCatalog('{oops', 'm.json');
    if (!bad.ok) expect(bad.reason).toContain('m.json');
  });

  it('条目坏形 warn 跳过、好条目照常可用', () => {
    const doc = {
      name: 'm',
      owner: { name: 'o' },
      plugins: [
        { name: 'good', source: './plugins/good' },
        { name: 'no-source' }, // source 缺席
        { name: 'bad-name-', source: './x', extra: 1 }, // 名词法拒（-尾）
        { name: 123, source: './x' }, // name 非串
        { source: './x' }, // name 缺席
        { name: 'abs-path', source: '/abs/path' }, // 字符串 source 非 ./ 开头
        { name: 'no-discriminant', source: { pkg: 'x' } }, // 对象 source 无判别字段
        { name: 'gh-no-repo', source: { source: 'github' } }, // github 缺 repo
        { name: 'url-no-url', source: { source: 'url' } }, // url 缺 url
        { name: 'sub-no-path', source: { source: 'git-subdir', url: 'https://a/b.git' } }, // git-subdir 缺 path
        { name: 'npm-no-pkg', source: { source: 'npm' } }, // npm 缺 package
        { name: 'unknown-variant', source: { source: 'cpan', url: 'x' } }, // 未知 variant
        { name: 'also-good', source: { source: 'url', url: 'https://example.com/r.git', ref: 'v1' } },
      ],
    };
    const result = parseMarketplaceCatalog(JSON.stringify(doc), 'x.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.plugins.map((p) => p.name)).toEqual(['good', 'also-good']);
    expect(result.skipped).toHaveLength(11);
    // 跳过报文点名条目与原因域
    expect(result.skipped.some((s) => s.name === 'bad-name-')).toBe(true);
    expect(result.skipped.some((s) => s.reason.includes('source'))).toBe(true);
  });
});

describe('名词法边界（omp docs Naming rules 全例收编）', () => {
  const VALID = ['my-plugin', 'code-review', 'wordpress.com', 'ai-firstify', 'a', 'a1', '1a', 'x.y-z.9'];
  const INVALID = ['-bad', 'bad-', '.bad', 'Bad', 'under_score', 'bad_name', 'a b', 'a/b', '', 'x'.repeat(65)];
  it.each(VALID)('合法名 %s 过 catalog 解析', (name) => {
    const doc = JSON.stringify({ name: 'm', owner: { name: 'o' }, plugins: [{ name, source: './p' }] });
    const result = parseMarketplaceCatalog(doc, 'x.json');
    expect(result.ok && result.catalog.plugins).toHaveLength(1);
  });
  it.each(INVALID)('非法名 %s 条目跳过', (name) => {
    const doc = JSON.stringify({ name: 'm', owner: { name: 'o' }, plugins: [{ name, source: './p' }] });
    const result = parseMarketplaceCatalog(doc, 'x.json');
    expect(result.ok && result.skipped).toHaveLength(1);
  });
  it('64 字符恰在帽内合法', () => {
    const doc = JSON.stringify({
      name: 'm',
      owner: { name: 'o' },
      plugins: [{ name: 'a'.repeat(64), source: './p' }],
    });
    expect(parseMarketplaceCatalog(doc, 'x.json').ok).toBe(true);
  });
});

describe('双路径读序（.omp-plugin 优先 → .claude-plugin 回落，无第三路径）', () => {
  const OMP = '.omp-plugin/marketplace.json';
  const CLAUDE = '.claude-plugin/marketplace.json';

  it('双路径常量恰两序（不自造 berry 第三路径）', () => {
    expect(CATALOG_RELATIVE_PATHS).toEqual([OMP, CLAUDE]);
  });

  it('双在场 = omp 优先', () => {
    const fs = memFs({
      [`/root/${OMP}`]: JSON.stringify({ name: 'omp-one', owner: { name: 'o' }, plugins: [] }),
      [`/root/${CLAUDE}`]: JSON.stringify({ name: 'claude-one', owner: { name: 'o' }, plugins: [] }),
    });
    const result = loadCatalogFromRoot('/root', fs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalogPath).toBe(OMP);
    expect(result.parse.ok && result.parse.catalog.name).toBe('omp-one');
  });

  it('仅 .claude 在场 = 回落命中', () => {
    const fs = memFs({
      [`/root/${CLAUDE}`]: JSON.stringify({ name: 'claude-one', owner: { name: 'o' }, plugins: [] }),
    });
    const result = loadCatalogFromRoot('/root', fs);
    expect(result.ok && result.catalogPath).toBe(CLAUDE);
  });

  it('双缺席 = 拒（报文含两候选路径）', () => {
    const result = loadCatalogFromRoot('/root', memFs());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(OMP);
    expect(result.reason).toContain(CLAUDE);
  });

  it('catalog 级坏形透传整仓拒（读序命中但内容坏）', () => {
    const fs = memFs({ [`/root/${CLAUDE}`]: '{bad' });
    const result = loadCatalogFromRoot('/root', fs);
    expect(result.ok).toBe(true); // 读序命中（读侧 ok）
    if (!result.ok) return;
    expect(result.parse.ok).toBe(false); // 解析面整仓拒
  });
});

describe('pluginRoot 前缀改写（metadata.pluginRoot = 相对源路径前缀位）', () => {
  it('缺席 pluginRoot 原样直通', () => {
    expect(applyPluginRoot('./plugins/foo')).toEqual({ ok: true, rewritten: './plugins/foo' });
  });

  it('在场 pluginRoot 前缀拼接（monorepo 布局）', () => {
    expect(applyPluginRoot('./plugins/foo', 'packages')).toEqual({ ok: true, rewritten: './packages/plugins/foo' });
  });

  it('pluginRoot 自身逃逸段 = 拒（路径注入防线）', () => {
    expect(applyPluginRoot('./plugins/foo', '../evil').ok).toBe(false);
    expect(applyPluginRoot('./plugins/foo', '..').ok).toBe(false);
  });
});

describe('相对子路径解析（逃逸拒——pathIsWithin 同族防线）', () => {
  it('好形 ./plugins/foo → plugins/foo', () => {
    const result = resolveRelativeSubpath('./plugins/foo');
    expect(result).toEqual({ ok: true, subpath: 'plugins/foo' });
  });

  it('逃逸形 ../../x / .. 出界 / 内折逃逸 a/../../.. = 拒', () => {
    expect(resolveRelativeSubpath('../../x').ok).toBe(false);
    expect(resolveRelativeSubpath('./..').ok).toBe(false);
    expect(resolveRelativeSubpath('./a/../../..').ok).toBe(false);
    expect(resolveRelativeSubpath('./a/../../../etc/passwd').ok).toBe(false);
  });

  it('词法折叠加固形不误伤：..x 合法目录名（非出界段）', () => {
    expect(resolveRelativeSubpath('./..weird-name/pkg').ok).toBe(true);
  });

  it('pluginRoot 改写后再逃逸校验（改写产物出界 = 拒）', () => {
    expect(resolveRelativeSubpath('./plugins/foo', '../../etc').ok).toBe(false);
    expect(resolveRelativeSubpath('./plugins/foo', 'packages').ok).toBe(true);
  });
});

describe('版本四级回落（catalog 条目 version → manifest 三位序 → sha 前 7 → 0.0.0）', () => {
  it('第 1 级：catalog 条目 version 在场直用', () => {
    const fs = memFs({
      '/src/.claude-plugin/plugin.json': '{"version":"9.9.9"}', // 不应被读——条目 version 优先
    });
    expect(resolveEntryVersion({ name: 'p', source: './p', version: '1.2.3' }, '/src', fs)).toBe('1.2.3');
  });

  it('第 2 级：manifest 三位序（.claude-plugin/plugin.json → plugin.json → package.json）', () => {
    const onlyPkg = memFs({ '/src/package.json': '{"version":"2.0.0"}' });
    expect(resolveEntryVersion({ name: 'p', source: './p' }, '/src', onlyPkg)).toBe('2.0.0');
    const midAlso = memFs({
      '/src/package.json': '{"version":"2.0.0"}',
      '/src/plugin.json': '{"version":"1.5.0"}',
    });
    expect(resolveEntryVersion({ name: 'p', source: './p' }, '/src', midAlso)).toBe('1.5.0');
    const topAlso = memFs({
      '/src/package.json': '{"version":"2.0.0"}',
      '/src/plugin.json': '{"version":"1.5.0"}',
      '/src/.claude-plugin/plugin.json': '{"version":"1.0.0"}',
    });
    expect(resolveEntryVersion({ name: 'p', source: './p' }, '/src', topAlso)).toBe('1.0.0');
  });

  it('manifest 坏 JSON / version 非串 = 跳下一位（不炸）', () => {
    const fs = memFs({
      '/src/.claude-plugin/plugin.json': '{bad',
      '/src/plugin.json': '{"version": 42}',
      '/src/package.json': '{"version":"3.1.4"}',
    });
    expect(resolveEntryVersion({ name: 'p', source: './p' }, '/src', fs)).toBe('3.1.4');
  });

  it('第 3 级：条目 source 对象 sha 前 7 位', () => {
    expect(
      resolveEntryVersion(
        { name: 'p', source: { source: 'github', repo: 'o/r', sha: 'abc123def0000' } },
        '/src',
        memFs(),
      ),
    ).toBe('abc123d');
  });

  it('第 4 级：全缺席 → 0.0.0', () => {
    expect(resolveEntryVersion({ name: 'p', source: './p' }, '/src', memFs())).toBe('0.0.0');
    // 相对串形无 sha——同落 0.0.0
    expect(resolveEntryVersion({ name: 'p', source: './p' }, '/absent', memFs())).toBe('0.0.0');
  });
});
