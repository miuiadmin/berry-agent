/**
 * host/plugin-market/translate 测试——源翻译层五形→三源 ref 矩阵（§9.6 源
 * 翻译层与装机咬合节）。核心锁：翻译产物 ref 与既有 plugin-install
 * parsePluginRef 词法**逐词兼容**（同词法单源往返——零第二词法）+ 逃逸/注入
 * 必红例（相对源 `../../x` / git-subdir path 逃逸 / 名段与版本恶意形）。
 */
import { describe, expect, it } from 'vitest';

import { parsePluginRef } from '../plugin-install.js';

import { translateEntrySource } from './translate.js';
import type { MarketEntrySource, TranslateInput } from './types.js';

/** 翻译输入速记（git 语境市场仓缺省形） */
function gitCtx(overrides: Partial<TranslateInput> = {}): TranslateInput {
  return {
    entrySource: './plugins/foo',
    pluginRoot: undefined,
    marketplaceSourceType: 'git',
    marketplaceUri: 'https://github.com/owner/market-repo.git',
    catalogCommit: 'c0ffee1',
    marketCacheDir: '/data/marketplaces/market-repo',
    ...overrides,
  };
}

/** 词法单源往返锁帮手：翻译产物 ref 须被 parsePluginRef 接受且字段一致还原 */
function roundtrip(ref: string) {
  const parsed = parsePluginRef(ref);
  expect(parsed.ok).toBe(true);
  return parsed;
}

describe('五形 → 三源 ref 矩阵（§9.6 翻译矩阵逐行）', () => {
  it('形 1a：npm 无版本 → npm:<pkg>（往返一致）', () => {
    const result = translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: 'acme-widgets' } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toEqual({ ref: 'npm:acme-widgets', leg: 'direct' });
    const parsed = roundtrip(result.target.ref);
    expect(parsed.ok && parsed.parsed.source === 'npm' && parsed.parsed.pkg === 'acme-widgets').toBe(true);
  });

  it('形 1b：npm 带版本 → npm:<pkg>@<version>（含 scoped 包）', () => {
    const result = translateEntrySource(
      gitCtx({ entrySource: { source: 'npm', package: 'acme-widgets', version: '2.1.0' } }),
    );
    expect(result.ok && result.target.ref).toBe('npm:acme-widgets@2.1.0');
    const scoped = translateEntrySource(
      gitCtx({ entrySource: { source: 'npm', package: '@scope/pkg', version: '1.0.0-rc.1+build' } }),
    );
    expect(scoped.ok && scoped.target.ref).toBe('npm:@scope/pkg@1.0.0-rc.1+build');
    const parsed = roundtrip(scoped.ok ? scoped.target.ref : '');
    // scoped 包 @ 在位 0 是 scope 前缀——lastIndexOf 取版本分隔（既有词法同律）
    expect(
      parsed.ok &&
        parsed.parsed.source === 'npm' &&
        parsed.parsed.pkg === '@scope/pkg' &&
        parsed.parsed.version === '1.0.0-rc.1+build',
    ).toBe(true);
  });

  it('形 2a：github 短手展开 + sha 优先于 ref', () => {
    const both = translateEntrySource(
      gitCtx({ entrySource: { source: 'github', repo: 'owner/tool', ref: 'v1.2.0', sha: 'deadbee' } }),
    );
    expect(both.ok && both.target.ref).toBe('git:https://github.com/owner/tool.git#deadbee'); // sha 优先
    const refOnly = translateEntrySource(
      gitCtx({ entrySource: { source: 'github', repo: 'owner/tool', ref: 'v1.2.0' } }),
    );
    expect(refOnly.ok && refOnly.target.ref).toBe('git:https://github.com/owner/tool.git#v1.2.0');
    const bare = translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'owner/tool' } }));
    expect(bare.ok && bare.target.ref).toBe('git:https://github.com/owner/tool.git'); // 裸 url 形
    const parsed = roundtrip(both.ok ? both.target.ref : '');
    expect(
      parsed.ok &&
        parsed.parsed.source === 'git' &&
        parsed.parsed.url === 'https://github.com/owner/tool.git' &&
        parsed.parsed.gitRef === 'deadbee',
    ).toBe(true);
  });

  it('形 2b：url 形直通（sha 优先）', () => {
    const result = translateEntrySource(
      gitCtx({ entrySource: { source: 'url', url: 'https://gitlab.com/a/b.git', ref: 'main', sha: '1234abc' } }),
    );
    expect(result.ok && result.target.ref).toBe('git:https://gitlab.com/a/b.git#1234abc');
    const noPin = translateEntrySource(gitCtx({ entrySource: { source: 'url', url: 'https://gitlab.com/a/b.git' } }));
    expect(noPin.ok && noPin.target.ref).toBe('git:https://gitlab.com/a/b.git');
  });

  it('形 3：git-subdir → git ref + 子目录拷贝腿参数', () => {
    const result = translateEntrySource(
      gitCtx({
        entrySource: {
          source: 'git-subdir',
          url: 'https://github.com/o/mono.git',
          path: 'plugins/foo',
          sha: 'beefcafe',
        },
      }),
    );
    expect(result.ok && result.target).toEqual({
      ref: 'git:https://github.com/o/mono.git#beefcafe',
      subpath: 'plugins/foo',
      leg: 'subdir-copy',
    });
    // git-subdir url 短手同展开（omp 同律）
    const shorthand = translateEntrySource(
      gitCtx({ entrySource: { source: 'git-subdir', url: 'owner/mono', path: 'plugins/foo' } }),
    );
    expect(shorthand.ok && shorthand.target.ref).toBe('git:https://github.com/owner/mono.git');
  });

  it('形 4：相对串（git 语境市场仓）→ git:<市场仓 url>#<catalog commit>（一致性红利）', () => {
    const result = translateEntrySource(gitCtx());
    expect(result.ok && result.target).toEqual({
      ref: 'git:https://github.com/owner/market-repo.git#c0ffee1',
      subpath: 'plugins/foo',
      leg: 'subdir-copy',
    });
    const parsed = roundtrip(result.ok ? result.target.ref : '');
    expect(
      parsed.ok &&
        parsed.parsed.source === 'git' &&
        parsed.parsed.url === 'https://github.com/owner/market-repo.git' &&
        parsed.parsed.gitRef === 'c0ffee1',
    ).toBe(true);
  });

  it('形 4 边界：catalog commit 缺席 = 拒（源清单坏形——git 语境 commit 恒在）', () => {
    const result = translateEntrySource(gitCtx({ catalogCommit: undefined }));
    expect(result.ok).toBe(false);
  });

  it('形 5：相对串（本地市场仓 sourceType local）→ local 缓存目录 + 拷贝腿', () => {
    const result = translateEntrySource(
      gitCtx({ marketplaceSourceType: 'local', marketplaceUri: '/home/u/my-market', catalogCommit: undefined }),
    );
    expect(result.ok && result.target).toEqual({
      ref: 'local:/data/marketplaces/market-repo',
      subpath: 'plugins/foo',
      leg: 'subdir-copy',
    });
    const parsed = roundtrip(result.ok ? result.target.ref : '');
    expect(
      parsed.ok && parsed.parsed.source === 'local' && parsed.parsed.path === '/data/marketplaces/market-repo',
    ).toBe(true);
  });

  it('相对串（URL 源）= 结构性不可解析——诚实拒并指路换 git 地址重 add', () => {
    const result = translateEntrySource(
      gitCtx({
        marketplaceSourceType: 'url',
        marketplaceUri: 'https://example.com/cat.json',
        catalogCommit: undefined,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('git');
    expect(result.message).toContain('add');
  });

  it('pluginRoot 改写参与翻译（subpath = 改写产物）', () => {
    const result = translateEntrySource(gitCtx({ pluginRoot: 'packages' }));
    expect(result.ok && result.target.subpath).toBe('packages/plugins/foo');
  });

  it('github 语境市场仓相对串同走 git 源（短手展开后锁 commit）', () => {
    const result = translateEntrySource(
      gitCtx({ marketplaceSourceType: 'github', marketplaceUri: 'owner/market-repo', catalogCommit: 'abc0001' }),
    );
    expect(result.ok && result.target.ref).toBe('git:https://github.com/owner/market-repo.git#abc0001');
  });
});

describe('注入/逃逸必红（§9.6 供应链防线表——缓存/布局路径注入 + 相对路径逃逸）', () => {
  it('相对源逃逸 ../../x / .. / 内折出界 = 拒', () => {
    expect(translateEntrySource(gitCtx({ entrySource: '../../evil' })).ok).toBe(false);
    expect(translateEntrySource(gitCtx({ entrySource: './..' })).ok).toBe(false);
    expect(translateEntrySource(gitCtx({ entrySource: './a/../../../etc' })).ok).toBe(false);
  });

  it('git-subdir path 逃逸 = 拒（pathIsWithin 同族）', () => {
    const result = translateEntrySource(
      gitCtx({ entrySource: { source: 'git-subdir', url: 'https://a/b.git', path: '../../escape' } }),
    );
    expect(result.ok).toBe(false);
    // 绝对 path 同拒（子目录须相对仓内）
    expect(
      translateEntrySource(gitCtx({ entrySource: { source: 'git-subdir', url: 'https://a/b.git', path: '/abs' } })).ok,
    ).toBe(false);
  });

  it('npm version 恶意形拒（.. / 空白 / # / 换行——缓存路径注入防线）', () => {
    for (const version of ['../x', 'a b', 'a#b', 'a\nb', '', '.hidden', '-lead']) {
      const result = translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: 'p', version } }));
      expect(result.ok).toBe(false);
    }
  });

  it('npm package 恶意形拒（.. 段 / # / 空白 / 斜线尾空段）', () => {
    for (const pkg of ['..', '../x', 'a/../b', 'a#b', 'a b', 'a/', '/a', '']) {
      const result = translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: pkg } }));
      expect(result.ok).toBe(false);
    }
  });

  it('github repo 坏形拒（多段 / 逃逸段 / 空白 / #）', () => {
    for (const repo of ['a/b/c', '../evil', 'a b', 'a#b', '', 'a/']) {
      const result = translateEntrySource(gitCtx({ entrySource: { source: 'github', repo } }));
      expect(result.ok).toBe(false);
    }
  });

  it('url 形坏形拒（含 # / 空白——# 是 git ref 分隔符，url 内含即破坏词法单源往返）', () => {
    for (const url of ['https://a/b#frag', 'https://a b', '', 'a#b']) {
      const result = translateEntrySource(gitCtx({ entrySource: { source: 'url', url } }));
      expect(result.ok).toBe(false);
    }
  });

  it('sha 坏词法拒（非 hex / 超长）；ref 坏词法拒（# / 空白 / .. / ~ 前缀）', () => {
    expect(
      translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b', sha: 'xyz-not-hex' } })).ok,
    ).toBe(false);
    expect(
      translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b', sha: 'g'.repeat(41) } })).ok,
    ).toBe(false);
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b', ref: 'v1#2' } })).ok).toBe(
      false,
    );
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b', ref: 'v 1' } })).ok).toBe(false);
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b', ref: 'a..b' } })).ok).toBe(
      false,
    );
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b', ref: '' } })).ok).toBe(false);
  });

  it('全部 ok 产物词法单源锁：ref 恒可被 parsePluginRef 解析（矩阵全形扫描）', () => {
    const okCases: readonly MarketEntrySource[] = [
      { source: 'npm', package: 'p1' },
      { source: 'npm', package: '@s/p2', version: '1.0.0' },
      { source: 'github', repo: 'a/b' },
      { source: 'github', repo: 'a/b', ref: 'v1' },
      { source: 'github', repo: 'a/b', sha: 'abc1230' },
      { source: 'url', url: 'https://x/y.git' },
      { source: 'git-subdir', url: 'https://x/y.git', path: 'sub/dir' },
      './plugins/foo',
    ];
    for (const entrySource of okCases) {
      const result = translateEntrySource(gitCtx({ entrySource }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(parsePluginRef(result.target.ref).ok).toBe(true);
    }
  });
});
