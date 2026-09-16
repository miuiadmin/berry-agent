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

  it("npm '@' 位执法：package 非 scoped 前缀位含 @ 拒 + version 含 @ 拒（保 lastIndexOf 往返一致律）", () => {
    // 形 a：version 含 '@' → ref 'npm:foo@1.0.0@x' 会被 parsePluginRef lastIndexOf
    // 拆成 pkg='foo@1.0.0'/version='x'——pkg 位污染（往返一致律破），翻译位拒
    expect(
      translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: 'foo', version: '1.0.0@x' } })).ok,
    ).toBe(false);
    // 形 b：package 中段 '@'（非 scoped 前缀）→ ref 'npm:foo@next' 静默漂移为
    // 「包 foo 的 next dist-tag」语义装机成功——坏形包名拒
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: 'foo@next' } })).ok).toBe(false);
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: 'a@b/c' } })).ok).toBe(false);
    // scoped 正常形不受影响（'@' 仅段 0 位 0 一枚）
    expect(
      translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: '@scope/pkg', version: '1.0.0' } })).ok,
    ).toBe(true);
  });

  it('scp 直通形（git@host:path 无 ://）direct 腿拒——指路 https/ssh 完整形（与布局层受理面对齐）；拷贝腿不受限', () => {
    // direct 腿：装机布局层 installPathForGit 只识 <scheme>:// 形——scp 形克隆
    // 成功后才抛「git url 坏形」（网络白花）；翻译位前置拒
    const direct = translateEntrySource(
      gitCtx({ entrySource: { source: 'url', url: 'git@github.com:owner/repo.git' } }),
    );
    expect(direct.ok).toBe(false);
    if (!direct.ok) {
      expect(direct.message).toContain('scp');
      expect(direct.message).toContain('https://');
    }
    // ssh:// 完整形（带 ://）direct 照走
    const ssh = translateEntrySource(
      gitCtx({ entrySource: { source: 'url', url: 'ssh://git@github.com/owner/repo.git' } }),
    );
    expect(ssh.ok && ssh.target.ref).toBe('git:ssh://git@github.com/owner/repo.git');
    // git-subdir 拷贝腿不经布局解析（布局恒 plugins/market/）——scp 形照走
    const sub = translateEntrySource(
      gitCtx({ entrySource: { source: 'git-subdir', url: 'git@github.com:owner/mono.git', path: 'plugins/foo' } }),
    );
    expect(sub.ok && sub.target.leg).toBe('subdir-copy');
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

  it('git url 点段穿越拒（§9.6 布局段四处全验——url 拆段段值 `.`/`..` 翻译位前置拒）', () => {
    // 攻击形：direct 腿 url 含 `..` 段 → 布局层 installPathForGit join 内折吞父树
    // （https://evil.com/../.. → 'plugins' 本身）；翻译位前置拒省白花网络
    for (const url of ['https://evil.com/../..', 'https://evil.com/../repo.git', 'https://evil.com/./repo.git']) {
      const direct = translateEntrySource(gitCtx({ entrySource: { source: 'url', url } }));
      expect(direct.ok).toBe(false);
    }
    // git-subdir 拷贝腿同律（url 同一守卫面——克隆目标与布局虽异，坏形一致拒）
    const sub = translateEntrySource(
      gitCtx({ entrySource: { source: 'git-subdir', url: 'https://evil.com/../..', path: 'plugins/foo' } }),
    );
    expect(sub.ok).toBe(false);
    // 正常 url 形不受影响（回归锚）
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'url', url: 'https://a/b.git' } })).ok).toBe(true);
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

describe("argv 旗标/选项位注入拒（'-' 起头——mp 收尾批安全硬化·§9.6 防线表）", () => {
  it("npm package '-' 起头拒：nopt last-wins 可掀 --ignore-scripts/--prefix（供应链④）——修前红", () => {
    // '--ignore-scripts=false' 落 spec 槽位（argv 尾参）会被 npm 按旗标解析——
    // last-wins 掀翻执行器自带的 --ignore-scripts；'--prefix=.' 重定向装机树
    for (const pkg of ['--ignore-scripts=false', '--prefix=.', '-lead-pkg']) {
      const result = translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: pkg } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('起头');
    }
    // 正常连字符包名不误伤（'-' 只在首位才是选项位）
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'npm', package: 'left-pad-cli' } })).ok).toBe(true);
  });

  it("git url '-' 起头拒：'-oX://y' 形落 clone 位置参数会被 git 解析为选项位——修前红", () => {
    for (const url of ['-oProxy=x://y', '-c:x://y', '-upload-pack=x://y']) {
      const result = translateEntrySource(gitCtx({ entrySource: { source: 'url', url } }));
      expect(result.ok).toBe(false);
    }
    // git-subdir 拷贝腿同过 url 词法面——同拒
    expect(translateEntrySource(gitCtx({ entrySource: { source: 'git-subdir', url: '-oX://y', path: 'p' } })).ok).toBe(
      false,
    );
  });

  it("git ref '-' 起头拒：checkout 位置参数的选项位混淆（'-b'/'--detach' 形）——修前红", () => {
    for (const ref of ['-b', '--detach', '--upload-pack=x']) {
      expect(translateEntrySource(gitCtx({ entrySource: { source: 'url', url: 'https://x/y.git', ref } })).ok).toBe(
        false,
      );
    }
    // 正常 tag 形不误伤（'v1-x' 连字符中位合法）
    expect(
      translateEntrySource(gitCtx({ entrySource: { source: 'url', url: 'https://x/y.git', ref: 'v1-x' } })).ok,
    ).toBe(true);
  });
});

describe('拒绝报文消毒（mp 收尾批 sec——catalog 原始字段内插位单出口剥控制字符）', () => {
  it('恶意字段进拒绝报文：ESC/BEL/换行剥除（message 不携控制字符出函数）——修前红', () => {
    // 恶意 catalog 字段经词法拒后进报文内插位：报文原样携带 \x1b/\x07/\n 经
    // CLI writeErr 入终端 = OSC 52/标题/伪行注入面；构造位单出口消毒（CLI
    // sanitizeLine 皮带是纵深非独扛位——§9.6 mp 收尾批 security 三笔 ③）
    const cases: readonly MarketEntrySource[] = [
      { source: 'npm', package: 'p\x1b]0;pwned\nX' }, // 包名域：空白拒 + 报文内插 raw
      { source: 'npm', package: 'p', version: '1.0.0 \x07bell' }, // 版本域：空白拒
      { source: 'github', repo: 'a/b', sha: 'deadbee\x1b[31m' }, // sha 域：hex 词法拒
      { source: 'github', repo: 'a/b\x1bc' }, // repo 域：短手段词法拒（经 classify 报文链）
      { source: 'git-subdir', url: 'https://x/y.git', path: '../../es\x1bcape' }, // path 域：逃逸拒
    ];
    for (const entrySource of cases) {
      const result = translateEntrySource(gitCtx({ entrySource }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).not.toContain('\x1b');
        expect(result.message).not.toContain('\x07');
        expect(result.message).not.toContain('\n');
      }
    }
    // 相对串坏形同律（catalog 层 sub.message 内插位随外层报文同过消毒）
    const rel = translateEntrySource(gitCtx({ entrySource: './../../etc\nFAKE\x1b]0;pwned' }));
    expect(rel.ok).toBe(false);
    if (!rel.ok) {
      expect(rel.message).not.toContain('\x1b');
      expect(rel.message).not.toContain('\n');
    }
    // 正常拒形报文语义不变（回归锚——消毒不吞拒因词）
    const normal = translateEntrySource(gitCtx({ entrySource: { source: 'github', repo: 'a/b/c' } }));
    expect(normal.ok).toBe(false);
    if (!normal.ok) expect(normal.message).toContain('github');
  });
});
