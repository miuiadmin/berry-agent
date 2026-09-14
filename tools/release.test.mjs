import { readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  INJECT_SPECTRUM,
  PACKAGES,
  judgeDistTag,
  judgePackList,
  judgeReadme,
  judgeRegistryProbe,
  judgeTarballTrees,
  parseReleaseArgs,
  runRelease,
  isPrerelease,
} from './release.mjs';

/**
 * 发布机器注入谱测试（07 §8.3——演习完成判据 = 注入谱场景收进常规测试面
 * 全绿，测试即留档）。零网络零 git 写：runRelease 消费假缝（fake seam
 * table），谱项经 INJECT_SPECTRUM.patch 同一机器施加——与 CLI --inject
 * 同物，谱语义漂移在此当场红。
 *
 * 双包发布道（2026-09-14 rl 批）：fakeSeams 按 pkgKey 参数化（packList 基线 /
 * tarball 名 / 解包树键随 PACKAGES 描述符分叉）；既有例全走 main 缺省形回归。
 */

/** 各包全绿 packList 基线（pack 真实产物形态的最小代表集） */
const PACK_BASELINES = {
  main: [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/host/main.js',
    'dist/webui/index.html',
    'dist/api/surface.json',
    'dist/.build-meta.json',
  ],
  sdk: [
    'package.json',
    'README.md',
    'dist/packages/berry-agent-sdk/src/index.js',
    'dist/packages/berry-agent-sdk/src/index.d.ts',
    'dist/packages/berry-agent-sdk/src/client.js',
    'dist/packages/berry-agent-sdk/src/http.js',
    'dist/packages/berry-agent-sdk/src/stdio.js',
    'dist/packages/berry-agent-sdk/src/types.js',
    'dist/src/channels/sdk/protocol.js',
  ],
};

/** 假缝工厂——全绿基线 + 调用留痕（断言「未触写面」用）；pkgKey 随包分叉基线 */
function fakeSeams(overrides = {}, pkgKey = 'main') {
  const calls = { build: 0, publish: [], distTagAdd: [], gitTagCreate: [], gitTagPush: [], fetch: 0 };
  const base = {
    calls,
    gates: () => [
      { name: 'typecheck', ok: true },
      { name: 'test', ok: true },
      { name: 'lint:topology', ok: true },
      { name: 'format:check', ok: true },
    ],
    gitStatusPorcelain: () => '',
    probe: () => ({ status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' }),
    build: () => {
      calls.build++;
      return { ok: true };
    },
    packList: () => [...PACK_BASELINES[pkgKey]],
    pack: () => ({ tarballPath: `/tmp/fake/${PACKAGES[pkgKey].tarballName('0.1.0-alpha.1')}` }),
    fileShasum: () => 'localsha',
    smoke: async () => ({ ok: true, failures: [] }),
    fetchTarball: () => {
      calls.fetch++;
      return null;
    },
    tarballTree: () => ({ 'package.json': 'a', 'dist/host/main.js': 'b', 'dist/.build-meta.json': 'm1' }),
    readmeText: () => '# berry-agent\n真实 README（无占位符）',
    publish: (tarball, opts) => {
      calls.publish.push({ tarball, ...opts });
      return { status: 0, stdout: '', stderr: '' };
    },
    distTagLs: () => ({ latest: '0.1.0-alpha.1', next: '0.1.0-alpha.1' }),
    distTagAdd: (v, tag) => {
      calls.distTagAdd.push([v, tag]);
      return { status: 0 };
    },
    headCommit: () => 'aaaa0000',
    gitTagState: () => 'absent',
    gitTagCreate: (t) => {
      calls.gitTagCreate.push(t);
    },
    gitTagPush: (t) => {
      calls.gitTagPush.push(t);
    },
  };
  return { ...base, ...overrides };
}

/** runRelease 直跑快捷（静默 log；pkgKey 透传双包） */
async function run(seams, version = '0.1.0-alpha.1', dryRun = true, pkgKey = 'main') {
  const report = [];
  const result = await runRelease(seams, { version, pkgKey, dryRun, log: (l) => report.push(l) });
  return { ...result, report };
}

// ---------------------------------------------------------------------------
// 纯判定器
// ---------------------------------------------------------------------------

describe('judgeRegistryProbe（契约 2 三态）', () => {
  it('E404 → absent（正常发）', () => {
    expect(judgeRegistryProbe({ status: 1, stdout: '', stderr: 'npm error code E404' }).state).toBe('absent');
  });

  it('退 0 + JSON 串 → present 记 shasum', () => {
    expect(judgeRegistryProbe({ status: 0, stdout: '"abc123"\n', stderr: '' })).toEqual({
      state: 'present',
      shasum: 'abc123',
    });
  });

  it('网络错（同为退 1 但非 E404）→ fatal 拒发——退码一刀切禁令的锁面', () => {
    const v = judgeRegistryProbe({ status: 1, stdout: '', stderr: 'npm error code ENOTFOUND' });
    expect(v.state).toBe('fatal');
    expect(v.reason).toContain('ENOTFOUND');
  });

  it('退 0 但应答非 JSON → fatal', () => {
    expect(judgeRegistryProbe({ status: 0, stdout: 'garbage', stderr: '' }).state).toBe('fatal');
  });
});

describe('judgePackList（契约 3 白名单机器验收）', () => {
  it('全绿基线过', () => {
    expect(judgePackList(fakeSeams().packList()).ok).toBe(true);
  });

  it('必在件缺席 → 红', () => {
    const v = judgePackList(['package.json', 'README.md']);
    expect(v.ok).toBe(false);
    expect(v.missing).toContain('dist/.build-meta.json');
  });

  it('白名单外件（src/tools/test/map）→ 红', () => {
    const v = judgePackList([
      ...fakeSeams().packList(),
      'src/host/main.ts',
      'tools/release.mjs',
      'dist/x.test.js',
      'dist/x.js.map',
    ]);
    expect(v.ok).toBe(false);
    expect(v.forbidden).toEqual(['src/host/main.ts', 'tools/release.mjs', 'dist/x.test.js', 'dist/x.js.map']);
  });

  // eco-3 落位漏扩补笔的回归锁（2026-09-14 首发真发契约 3 咬住）——examples 挂账位
  // 在场恰收（07 §8.3 白名单验收律）；eco-3 形五件全录防漂移
  it('examples 件在场 → 恰收过（eco-3 两形全件）', () => {
    const v = judgePackList([
      ...fakeSeams().packList(),
      'examples/README.md',
      'examples/minimal-code-plugin/package.json',
      'examples/minimal-code-plugin/entry.js',
      'examples/pure-skill-pack/package.json',
      'examples/pure-skill-pack/skills/markdown-table/SKILL.md',
    ]);
    expect(v.ok).toBe(true);
  });

  it('examples 内 test/map 件照样禁（三禁全域执法不问目录）', () => {
    const v = judgePackList([...fakeSeams().packList(), 'examples/x.test.js', 'examples/y.js.map']);
    expect(v.ok).toBe(false);
    expect(v.forbidden).toEqual(['examples/x.test.js', 'examples/y.js.map']);
  });

  // 2026-09-14 多语言 README 批回归锁——npm always-included 族：根目录 README 变体
  // 自动入包（files 白名单拦不住，npm pack --dry-run 实证），语言集枚举恰收五件；
  // 缺席语言件（de）照拒 = 不预占律执法面（新语言随落位批同步扩）
  it('README 语言变体五件恰收过；缺席语言件照拒', () => {
    const langs = ['README.zh.md', 'README.ko.md', 'README.fr.md', 'README.es.md', 'README.ru.md'];
    expect(judgePackList([...fakeSeams().packList(), ...langs]).ok).toBe(true);
    const v = judgePackList([...fakeSeams().packList(), ...langs, 'README.de.md']);
    expect(v.ok).toBe(false);
    expect(v.forbidden).toEqual(['README.de.md']);
  });
});

describe('judgeTarballTrees（契约 4 深对照）', () => {
  it('仅溯源戳差异 → 等价跳', () => {
    const local = { 'package.json': 'a', 'dist/.build-meta.json': 'm1' };
    const remote = { 'package.json': 'a', 'dist/.build-meta.json': 'm2' };
    expect(judgeTarballTrees(local, remote).equivalent).toBe(true);
  });

  // 2026-09-14 首发幂等收口咬住补笔——api-emit.stamp 亦时间戳溯源值，同入剥离集
  it('仅 api-emit.stamp 溯源戳差异 → 等价跳（剥离集两件）', () => {
    const local = { 'package.json': 'a', 'dist/.api-emit.stamp': 't1', 'dist/.build-meta.json': 'm1' };
    const remote = { 'package.json': 'a', 'dist/.api-emit.stamp': 't2', 'dist/.build-meta.json': 'm2' };
    expect(judgeTarballTrees(local, remote).equivalent).toBe(true);
  });

  it('实质差异（多一件/少一件/内容异）→ 拒', () => {
    const local = { 'package.json': 'a', 'dist/x.js': 'x' };
    const remote = { 'package.json': 'b', 'dist/y.js': 'y' };
    const v = judgeTarballTrees(local, remote);
    expect(v.equivalent).toBe(false);
    expect(v.diffs.sort()).toEqual(['dist/x.js', 'dist/y.js', 'package.json']);
  });
});

describe('judgeDistTag（契约 5 终态断言）', () => {
  it('preview 期两 tag 同指 → 过', () => {
    expect(judgeDistTag({ latest: '0.1.0-alpha.1', next: '0.1.0-alpha.1' }, '0.1.0-alpha.1', true).ok).toBe(true);
  });

  it('preview 期 latest 落后 → 红（半成功态必须被看见）', () => {
    const v = judgeDistTag({ latest: '0.0.9', next: '0.1.0-alpha.1' }, '0.1.0-alpha.1', true);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('0.0.9');
  });

  it('正式版 latest 单指 → 过（next 不动）', () => {
    expect(judgeDistTag({ latest: '1.0.0', next: '0.9.0-beta.1' }, '1.0.0', false).ok).toBe(true);
    expect(judgeDistTag({ latest: '0.9.9', next: '0.9.0-beta.1' }, '1.0.0', false).ok).toBe(false);
  });
});

describe('judgeReadme / isPrerelease', () => {
  it('占位符命中 → 红；干净 → 过', () => {
    expect(judgeReadme('npm install -g berry-agent <!-- placeholder -->').ok).toBe(false);
    expect(judgeReadme('# real\nnpm install -g berry-agent').ok).toBe(true);
  });

  it('prerelease 判定：带 prerelease 段为真', () => {
    expect(isPrerelease('0.1.0-alpha.1')).toBe(true);
    expect(isPrerelease('1.0.0-beta.3')).toBe(true);
    expect(isPrerelease('1.0.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// argv 解析（用法错三档）
// ---------------------------------------------------------------------------

describe('parseReleaseArgs', () => {
  it('空参 = 真发 + 缺省主包；--dry-run = 演习', () => {
    expect(parseReleaseArgs([])).toEqual({ pkg: 'main', dryRun: false, inject: undefined, errors: [] });
    expect(parseReleaseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('合法谱项带 --dry-run → 过', () => {
    const p = parseReleaseArgs(['--dry-run', '--inject', 'probe:network']);
    expect(p.errors).toEqual([]);
    expect(p.inject).toBe('probe:network');
  });

  it('未知谱项 / 未知参数 / 缺谱项名 → 用法错', () => {
    expect(parseReleaseArgs(['--inject', 'nope']).errors[0]).toContain('未知注入谱项');
    expect(parseReleaseArgs(['--wat']).errors[0]).toContain('未知参数');
    expect(parseReleaseArgs(['--inject']).errors.length).toBeGreaterThan(0);
  });

  it('publish 之后的谱项无 --dry-run → 用法错（防真上传后撞注入终态）', () => {
    expect(parseReleaseArgs(['--inject', 'disttag:diverged']).errors[0]).toContain('--dry-run');
    expect(parseReleaseArgs(['--inject', 'tag:conflict']).errors.length).toBe(1);
    // publish 前谱项无此限
    expect(parseReleaseArgs(['--inject', 'probe:network']).errors).toEqual([]);
  });

  // rl 批双包发布道——--package 词面（缺省 main 零参兼容 + 未知/缺参用法错）
  it('--package sdk 合法；--package 缺参/未知包名 → 用法错', () => {
    expect(parseReleaseArgs(['--package', 'sdk'])).toEqual({
      pkg: 'sdk',
      dryRun: false,
      inject: undefined,
      errors: [],
    });
    expect(parseReleaseArgs(['--package', 'sdk', '--dry-run']).pkg).toBe('sdk');
    expect(parseReleaseArgs(['--package']).errors[0]).toContain('--package 需要包名');
    expect(parseReleaseArgs(['--package', 'nope']).errors[0]).toContain('未知包名');
  });
});

// ---------------------------------------------------------------------------
// runRelease 全链（假缝——逐契约红绿证）
// ---------------------------------------------------------------------------

describe('runRelease 演习（--dry-run）', () => {
  it('全绿基线：publish 走 dry-run+next、零 dist-tag add、零 tag 写', async () => {
    const s = fakeSeams();
    const r = await run(s);
    expect(r.code).toBe(0);
    expect(r.report.join('\n')).toContain('[契约1] 绿');
    expect(s.calls.publish).toEqual([{ tarball: '/tmp/fake/berry-agent-0.1.0-alpha.1.tgz', next: true, dryRun: true }]);
    expect(s.calls.distTagAdd).toEqual([]);
    expect(s.calls.gitTagCreate).toEqual([]);
    expect(s.calls.gitTagPush).toEqual([]);
    expect(r.report.join('\n')).toContain('演习：tag v0.1.0-alpha.1 缺席');
  });

  it('门禁红 → 退 1 且不 build（前置不可绕）', async () => {
    const s = fakeSeams({
      gates: () => [
        { name: 'typecheck', ok: true },
        { name: 'test', ok: false },
        { name: 'lint:topology', ok: true },
        { name: 'format:check', ok: true },
      ],
    });
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('门禁 test 未过');
    expect(s.calls.build).toBe(0);
  });

  it('工作树非净空 → 退 1', async () => {
    const s = fakeSeams({ gitStatusPorcelain: () => ' M src/x.ts' });
    expect((await run(s)).code).toBe(1);
  });

  it('谱项 probe:network → 拒发且不 build（探测先行于构建）', async () => {
    const s = INJECT_SPECTRUM['probe:network'].patch(fakeSeams());
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('拒发');
    expect(s.calls.build).toBe(0);
  });

  it('谱项 probe:present + shasum 等值 → 等价已发跳 publish、后续契约照跑', async () => {
    const s = INJECT_SPECTRUM['probe:present'].patch(
      fakeSeams({ fileShasum: () => '1111111111111111111111111111111111111111' }),
    );
    const r = await run(s);
    expect(r.code).toBe(0);
    expect(s.calls.publish).toEqual([]);
    expect(r.report.join('\n')).toContain('等价已发');
  });

  it('在场 + shasum 不等 + 拉取不可行 → 维持拒 fail-closed', async () => {
    const s = INJECT_SPECTRUM['probe:present'].patch(fakeSeams());
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('fail-closed');
    expect(s.calls.fetch).toBe(1);
  });

  it('在场 + 不等 + 深对照等价（仅溯源戳）→ 等价跳', async () => {
    const s = INJECT_SPECTRUM['probe:present'].patch(
      fakeSeams({
        fetchTarball: () => '/tmp/fake/fetch/berry-agent-0.1.0-alpha.1.tgz',
        tarballTree: (p) =>
          p.includes('fetch')
            ? { 'package.json': 'a', 'dist/host/main.js': 'b', 'dist/.build-meta.json': 'm2' }
            : { 'package.json': 'a', 'dist/host/main.js': 'b', 'dist/.build-meta.json': 'm1' },
      }),
    );
    const r = await run(s);
    expect(r.code).toBe(0);
    expect(s.calls.publish).toEqual([]);
    expect(r.report.join('\n')).toContain('深对照全同');
  });

  it('pack 白名单外件 → 退 1', async () => {
    const s = fakeSeams({ packList: () => [...fakeSeams().packList(), 'src/host/main.ts'] });
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('src/host/main.ts');
  });

  it('安装冒烟失败（--version 漂移）→ 退 1', async () => {
    const s = fakeSeams({
      smoke: async () => ({ ok: false, failures: ['--version 0.1.0 ≠ package.json 0.1.0-alpha.1'] }),
    });
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('安装冒烟失败');
  });

  it('谱项 publish:fail → 退 1（上传单点失败）', async () => {
    const s = INJECT_SPECTRUM['publish:fail'].patch(fakeSeams());
    expect((await run(s)).code).toBe(1);
  });

  it('谱项 disttag:diverged → 退 1（半成功态被看见）', async () => {
    const s = INJECT_SPECTRUM['disttag:diverged'].patch(fakeSeams());
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('latest(0.0.9-old)');
  });

  it('谱项 tag:conflict → 退 1 响亮拒', async () => {
    const s = INJECT_SPECTRUM['tag:conflict'].patch(fakeSeams());
    const r = await run(s);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('异 commit 响亮拒');
  });

  it('tag 已在且同 commit → 幂等跳过（不重打不重推）', async () => {
    const s = fakeSeams({ gitTagState: () => ({ commit: 'aaaa0000' }), headCommit: () => 'aaaa0000' });
    const r = await run(s);
    expect(r.code).toBe(0);
    expect(s.calls.gitTagCreate).toEqual([]);
    expect(r.report.join('\n')).toContain('幂等');
  });

  it('README 占位符在演习态不拦（dry-run 不拦条款）、真发态拦', async () => {
    const dirty = { readmeText: () => '# berry\nnpm install -g berry-agent <!-- placeholder -->' };
    expect((await run(fakeSeams(dirty), '0.1.0-alpha.1', true)).code).toBe(0);
    const real = await run(fakeSeams(dirty), '0.1.0-alpha.1', false);
    expect(real.code).toBe(1);
    expect(real.report.join('\n')).toContain('占位符');
  });
});

describe('runRelease 真发形态（假缝全绿）', () => {
  it('prerelease：publish --tag next + dist-tag add latest + 打 tag 推 tag', async () => {
    const s = fakeSeams();
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(0);
    expect(s.calls.publish).toEqual([
      { tarball: '/tmp/fake/berry-agent-0.1.0-alpha.1.tgz', next: true, dryRun: false },
    ]);
    expect(s.calls.distTagAdd).toEqual([['0.1.0-alpha.1', 'latest']]);
    expect(s.calls.gitTagCreate).toEqual(['v0.1.0-alpha.1']);
    expect(s.calls.gitTagPush).toEqual(['v0.1.0-alpha.1']);
  });

  it('正式版：publish 默认 latest、不 dist-tag add、next 不动', async () => {
    const s = fakeSeams({ distTagLs: () => ({ latest: '1.0.0', next: '0.9.0-beta.9' }) });
    const r = await run(s, '1.0.0', false);
    expect(r.code).toBe(0);
    expect(s.calls.publish[0].next).toBe(false);
    expect(s.calls.distTagAdd).toEqual([]);
    expect(s.calls.gitTagCreate).toEqual(['v1.0.0']);
  });
});

// ---------------------------------------------------------------------------
// 双包发布道（rl 批——07 §8.3 差分六则：描述符/tag 域/白名单 map 分叉/空剥离集/值链依赖律）
// ---------------------------------------------------------------------------

describe('双包发布道（PACKAGES 描述符 + SDK 差分面）', () => {
  it('描述符对拍锁：name/tagPrefix/treeStrip 两包分立不得漂移', () => {
    expect(PACKAGES.main.name).toBe('berry-agent');
    expect(PACKAGES.main.tagPrefix).toBe('v');
    expect(PACKAGES.main.treeStrip).toEqual(['dist/.build-meta.json', 'dist/.api-emit.stamp']);
    expect(PACKAGES.sdk.name).toBe('berry-agent-sdk');
    expect(PACKAGES.sdk.tagPrefix).toBe('sdk-v'); // tag 域分立主锁——同号真发不撞（差分③）
    expect(PACKAGES.sdk.treeStrip).toEqual([]); // 纯 tsc 确定性编译无溯源件（差分③）
  });

  it('judgePackList SDK 基线全绿（含同编译跟进树件 + map 放行）', () => {
    const files = [
      ...PACK_BASELINES.sdk,
      'dist/packages/berry-agent-sdk/src/index.js.map',
      'dist/src/channels/sdk/protocol.js.map',
    ];
    expect(judgePackList(files, PACKAGES.sdk).ok).toBe(true);
  });

  it('SDK 三禁：test 件照禁（map 放行不豁免测试件）；主包缺省 profile 照禁 map', () => {
    const withTest = [...PACK_BASELINES.sdk, 'dist/src/x.test.js'];
    expect(judgePackList(withTest, PACKAGES.sdk).forbidden).toEqual(['dist/src/x.test.js']);
    // 同一 map 件：SDK 放行（调试栈帧产品面）、主包拒（瘦身律）——分叉成文即非漂移
    expect(judgePackList(['dist/x.js.map'], PACKAGES.main).forbidden).toEqual(['dist/x.js.map']);
  });

  it('SDK 必在件缺 → 红（入口面缺件即拒）；SDK 白名单外件（语言族 README/LICENSE）照拒', () => {
    const missing = judgePackList(
      PACK_BASELINES.sdk.filter((f) => f !== 'dist/packages/berry-agent-sdk/src/index.d.ts'),
      PACKAGES.sdk,
    );
    expect(missing.ok).toBe(false);
    expect(missing.missing).toContain('dist/packages/berry-agent-sdk/src/index.d.ts');
    const v = judgePackList([...PACK_BASELINES.sdk, 'README.zh.md', 'LICENSE'], PACKAGES.sdk);
    expect(v.forbidden).toEqual(['README.zh.md', 'LICENSE']); // SDK 无语言族无 LICENSE 文本件（差分① v1 定案）
  });

  it('judgeTarballTrees SDK 空剥离集：map 差异 = 实质差异拒（无溯源件可剥）', () => {
    const local = { 'package.json': 'a', 'dist/packages/berry-agent-sdk/src/index.js': 'x' };
    const remote = { 'package.json': 'a', 'dist/packages/berry-agent-sdk/src/index.js': 'x' };
    expect(judgeTarballTrees(local, remote, PACKAGES.sdk.treeStrip).equivalent).toBe(true);
    const drifted = { ...remote, 'dist/packages/berry-agent-sdk/src/index.js': 'y' };
    const v = judgeTarballTrees(local, drifted, PACKAGES.sdk.treeStrip);
    expect(v.equivalent).toBe(false);
    expect(v.diffs).toEqual(['dist/packages/berry-agent-sdk/src/index.js']);
  });

  it('runRelease SDK 演习全绿：tarball 名/tag 域/log 面随包分叉', async () => {
    const s = fakeSeams({}, 'sdk');
    const r = await run(s, '0.1.0-alpha.1', true, 'sdk');
    expect(r.code).toBe(0);
    expect(r.report.join('\n')).toContain('berry-agent-sdk@0.1.0-alpha.1');
    expect(s.calls.publish).toEqual([
      { tarball: '/tmp/fake/berry-agent-sdk-0.1.0-alpha.1.tgz', next: true, dryRun: true },
    ]);
    expect(r.report.join('\n')).toContain('演习：tag sdk-v0.1.0-alpha.1 缺席'); // tag 域分立（差分③）
    expect(s.calls.gitTagCreate).toEqual([]);
  });

  it('runRelease SDK 真发：打 sdk-v tag 推送 + dist-tag 同律', async () => {
    const s = fakeSeams({}, 'sdk');
    const r = await run(s, '0.1.0-alpha.1', false, 'sdk');
    expect(r.code).toBe(0);
    expect(s.calls.gitTagCreate).toEqual(['sdk-v0.1.0-alpha.1']);
    expect(s.calls.gitTagPush).toEqual(['sdk-v0.1.0-alpha.1']);
    expect(s.calls.distTagAdd).toEqual([['0.1.0-alpha.1', 'latest']]); // preview 期 latest 跟 prerelease 同律（契约 5 包无关）
  });

  it('注入谱 SDK 道同律：probe:network 拒发且不 build（谱项包无关）', async () => {
    const s = INJECT_SPECTRUM['probe:network'].patch(fakeSeams({}, 'sdk'));
    const r = await run(s, '0.1.0-alpha.1', true, 'sdk');
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('拒发');
    expect(s.calls.build).toBe(0);
  });

  // 2026-09-14 SDK 首演咬住的真缺陷回归锁——值链依赖声明律（07 §8.3 差分⑥）：
  // SDK 跟进树值链（http/stdio → jsonl → schema）裸 import typebox，包却零
  // dependencies，消费者安装后 import 必挂（ERR_MODULE_NOT_FOUND）；修 = 包内
  // 声明 typebox（版本对齐主包）。此静态锁防依赖面再漂移——运行时终验在
  // runSmokeSdk import 冒烟（每次演习真装真引）。
  // 锁形（2026-09-14 勘正批）：双包对账——读根 package.json 与 SDK 包
  // package.json 两处 dependencies.typebox，断言全等 + 均非空串；不硬编码
  // 具体版本字面量（旧形只读 SDK 侧锚 '1.3.25'，主包漂移时漏检——对齐律
  // 本身是锁面，主包升级无须改此测试，任一侧缺席/漂移即自红）。
  it('SDK 值链依赖声明在册：dependencies.typebox 锁版对齐主包（缺即红）', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    // 双包 typebox 取值器（相对本测试文件定位两处 package.json 真源）
    const readTypebox = async (rel) => {
      const pkg = JSON.parse(await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
      return pkg.dependencies?.typebox;
    };
    const sdkTypebox = await readTypebox('../packages/berry-agent-sdk/package.json');
    const mainTypebox = await readTypebox('../package.json');
    // 非空串两断言：缺席（undefined）或空串都在此红——「声明在册」的字面锁面
    expect(typeof sdkTypebox).toBe('string');
    expect(sdkTypebox.length).toBeGreaterThan(0);
    // 全等一断言：双包版本对齐——漂移在此红（对齐即锁，不锚具体号）
    expect(sdkTypebox).toBe(mainTypebox);
  });
});

// ---------------------------------------------------------------------------
// 描述符参数化收口 + pack 失败契约式红（2026-09-14 遗漏扫描四役修复批）
// idx 8：07 §8.3 定形句把「冒烟形」列为描述符第 9 项（连同 build 链 / readme
// 读面），realSeams 内联 pkgKey 三处 if 分叉系参数化遗漏——本批收进 PACKAGES
// 单源表；idx 9：realSeams.pack() 检查 npm pack 退出码，非零抛含 stderr 摘录
// 的错（runRelease 契约 3 位收口成红报告——非契约式裸栈/裸 ENOENT 禁）。
// ---------------------------------------------------------------------------

describe('描述符参数化收口（冒烟形 + build 链 + readme 读面入表）', () => {
  it('描述符静态断言：buildScript 两包分立、readmeText/smoke 皆函数入表', () => {
    expect(PACKAGES.main.buildScript).toBe('build');
    expect(PACKAGES.sdk.buildScript).toBe('build:sdk');
    expect(PACKAGES.main.readmeText).toBeInstanceOf(Function);
    expect(PACKAGES.sdk.readmeText).toBeInstanceOf(Function);
    expect(PACKAGES.main.smoke).toBeInstanceOf(Function);
    expect(PACKAGES.sdk.smoke).toBeInstanceOf(Function);
  });

  // 源级漂移锁：realSeams 实装缝体内不得再出现 pkgKey 条件分叉——包差异的
  // 唯一承载 = PACKAGES 描述符（第三包入册/冷读对拍时此锁咬住新内联分叉）
  it('realSeams 源零 pkgKey 分叉：包差异唯一承载 = PACKAGES 描述符', async () => {
    const src = await readFile(fileURLToPath(new URL('./release.mjs', import.meta.url)), 'utf8');
    const at = src.indexOf('export function realSeams');
    expect(at).toBeGreaterThan(0); // 切片锚在场（锚漂移时防静默全绿假通过）
    expect(src.slice(at)).not.toContain('pkgKey ===');
  });

  // readme 读面真源对拍（动态取转抄值须同源断言律）：主包面 = 根 README 全
  // 语言族排序拼合（同源重算，非臆断字符串）；SDK 面 = 包目录单件全等
  it('readmeText 读面真源对拍：主包根 glob 族排序拼合 / SDK 包目录单件', () => {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const readmes = readdirSync(repoRoot)
      .filter((f) => /^README.*\.md$/.test(f))
      .sort();
    // 语言族在场（>1 件）——主包读面静默退化成单件时此断言先红
    expect(readmes.length).toBeGreaterThan(1);
    expect(PACKAGES.main.readmeText(repoRoot)).toBe(
      readmes.map((f) => readFileSync(join(repoRoot, f), 'utf8')).join('\n\n'),
    );
    const sdkRoot = join(repoRoot, 'packages', 'berry-agent-sdk');
    expect(PACKAGES.sdk.readmeText(sdkRoot)).toBe(readFileSync(join(sdkRoot, 'README.md'), 'utf8'));
  });
});

describe('pack 失败契约式红（退出码检查——非裸栈/裸 ENOENT）', () => {
  it('pack 缝抛含 stderr 摘录的错 → [契约3] 红退 1，上传面未触', async () => {
    const s = fakeSeams({
      pack: () => {
        throw new Error('npm pack 失败（退出码 1）：npm error code ENOTFOUND');
      },
    });
    const r = await run(s);
    expect(r.code).toBe(1);
    const text = r.report.join('\n');
    expect(text).toContain('[契约3] 红');
    expect(text).toContain('npm pack 失败');
    expect(s.calls.publish).toEqual([]); // 未走到上传面
  });
});
