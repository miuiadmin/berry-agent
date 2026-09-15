import { readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  INJECT_SPECTRUM,
  PACKAGES,
  judgeDistTag,
  judgeDistTagCi,
  judgeEpochIgnitionDrill,
  judgePackList,
  judgeReadme,
  judgeRegistryProbe,
  judgeTarballTrees,
  parseReleaseArgs,
  resolveReleaseForm,
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
    // 出厂技能四件（2026-09-15 落位批——随必在件断言同步入基线）
    'skills/coding-persona/SKILL.md',
    'skills/plugins-quickstart/SKILL.md',
    'skills/goal-unattended/SKILL.md',
    'skills/memory-tools/SKILL.md',
  ],
  sdk: [
    'package.json',
    'README.md',
    // npm always-included 族（12aa56d 落 LICENSE 后 npm pack 恒自动收——
    // 2026-09-15 白名单同步批入册，CI run 34962693484 drill 红修）
    'LICENSE',
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
  const calls = {
    build: 0,
    publish: [],
    distTagAdd: [],
    gitTagCreate: [],
    gitTagPush: [],
    fetch: 0,
    ciWait: [],
  };
  const base = {
    calls,
    // 纪元彩排缺省假缝面（W8 纪元彩排批）：档案族空 → 休眠态——与仓内现行
    // 真态同形（api/snapshots 档案族尚未成形，检查 9 基线闸在点火日之前休眠）
    epochDrillFaces: () => ({ surface: { apiVersion: '1.0', enforcement: 'pre-ignition' }, archives: [] }),
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
      return { status: 0 };
    },
    // 触发腿 CI 轮询缺省绿（假缝——失败/超时/缺席场景经 INJECT_SPECTRUM.ci:* 或覆写注入）
    ciWaitRun: (tag) => {
      calls.ciWait.push(tag);
      return { status: 'success', runUrl: 'https://github.com/miuiadmin/berry-agent/actions/runs/1' };
    },
  };
  return { ...base, ...overrides };
}

/**
 * runRelease 直跑快捷（静默 log；pkgKey 透传双包；extra 透传执行形参数——
 * env 钉 {} 缺省隔离宿主环境变量〔BERRY_AGENT_RELEASE_MODE 宿主泄漏会改道
 * 执行形〕，localPublish / env 经 extra 注入）
 */
async function run(seams, version = '0.1.0-alpha.1', dryRun = true, pkgKey = 'main', extra = {}) {
  const report = [];
  const result = await runRelease(seams, {
    version,
    pkgKey,
    dryRun,
    env: {},
    ...extra,
    log: (l) => report.push(l),
  });
  return { ...result, report };
}

/**
 * 触发腿假缝工厂：probe 两态翻转（契约 2 缺席 → 收口复探在场——CI 已发布的
 * 真形）+ 深对照腿配套（拉取可行；双树走 fakeSeams 缺省固定树——本地/远端
 * 恒同即「仅溯源戳差异」等价形）。fetchTarball 覆写不挂 calls.fetch 计数
 * （闭包取不到 base.calls——收口断言走报告面非 fetch 计数）。
 */
function triggerSeams(overrides = {}) {
  const answers = [
    { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' },
    { status: 0, stdout: '"2222222222222222222222222222222222222222"\n', stderr: '' },
  ];
  let n = 0;
  return fakeSeams({
    probe: () => answers[Math.min(n++, 1)],
    fetchTarball: () => '/tmp/fake/fetch/berry-agent-0.1.0-alpha.1.tgz',
    ...overrides,
  });
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

  // 2026-09-15 出厂技能落位批回归锁（07 §8.6 射程注记②④）——skills/ 挂账资产位
  // 在场恰收 + 出厂四件 SKILL.md 必在件断言（「在场才入」升「在场必在」：缺席
  // 即 pack 验收红——出厂层自此是发布物契约面）
  it('skills 件在场 → 恰收过（出厂四件全录）', () => {
    const v = judgePackList([
      ...fakeSeams().packList(),
      'skills/coding-persona/SKILL.md',
      'skills/plugins-quickstart/SKILL.md',
      'skills/goal-unattended/SKILL.md',
      'skills/memory-tools/SKILL.md',
    ]);
    expect(v.ok).toBe(true);
  });

  it('出厂四件 SKILL.md 任一缺席 → 红（必在件——在场必在）', () => {
    // 基线含全四件，摘掉一件代表「任一缺席」形——missing 面恰为被摘件
    const v = judgePackList(
      fakeSeams()
        .packList()
        .filter((f) => f !== 'skills/memory-tools/SKILL.md'),
    );
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['skills/memory-tools/SKILL.md']);
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
    expect(parseReleaseArgs([])).toEqual({
      pkg: 'main',
      dryRun: false,
      inject: undefined,
      localPublish: false,
      epochDrill: false,
      errors: [],
    });
    expect(parseReleaseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--local-publish 旗标解析（令牌腿应急）', () => {
    expect(parseReleaseArgs(['--local-publish']).localPublish).toBe(true);
    expect(parseReleaseArgs(['--dry-run', '--local-publish']).localPublish).toBe(true);
    expect(parseReleaseArgs(['--local-publish']).dryRun).toBe(false);
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
    // 触发腿谱族同律（CI 段位于交棒/publish 之后）
    expect(parseReleaseArgs(['--inject', 'ci:fail']).errors[0]).toContain('--dry-run');
    // publish 前谱项无此限
    expect(parseReleaseArgs(['--inject', 'probe:network']).errors).toEqual([]);
  });

  // rl 批双包发布道——--package 词面（缺省 main 零参兼容 + 未知/缺参用法错）
  it('--package sdk 合法；--package 缺参/未知包名 → 用法错', () => {
    expect(parseReleaseArgs(['--package', 'sdk'])).toEqual({
      pkg: 'sdk',
      dryRun: false,
      inject: undefined,
      localPublish: false,
      epochDrill: false,
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

  it('README 占位符在演习态不拦（dry-run 不拦条款）、令牌腿真发态拦', async () => {
    const dirty = { readmeText: () => '# berry\nnpm install -g berry-agent <!-- placeholder -->' };
    expect((await run(fakeSeams(dirty), '0.1.0-alpha.1', true)).code).toBe(0);
    const real = await run(fakeSeams(dirty), '0.1.0-alpha.1', false, 'main', { localPublish: true });
    expect(real.code).toBe(1);
    expect(real.report.join('\n')).toContain('占位符');
  });
});

describe('runRelease 令牌腿真发（--local-publish 应急形 / SDK 常轨——全套旧序）', () => {
  it('prerelease：publish --tag next + dist-tag add latest + 打 tag 推 tag', async () => {
    const s = fakeSeams();
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { localPublish: true });
    expect(r.code).toBe(0);
    expect(r.report.join('\n')).toContain('（执行形=令牌全本地）');
    expect(s.calls.publish).toEqual([
      { tarball: '/tmp/fake/berry-agent-0.1.0-alpha.1.tgz', next: true, dryRun: false },
    ]);
    expect(s.calls.distTagAdd).toEqual([['0.1.0-alpha.1', 'latest']]);
    expect(s.calls.gitTagCreate).toEqual(['v0.1.0-alpha.1']);
    expect(s.calls.gitTagPush).toEqual(['v0.1.0-alpha.1']);
  });

  it('正式版：publish 默认 latest、不 dist-tag add、next 不动', async () => {
    const s = fakeSeams({ distTagLs: () => ({ latest: '1.0.0', next: '0.9.0-beta.9' }) });
    const r = await run(s, '1.0.0', false, 'main', { localPublish: true });
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

  it('SDK 必在件缺 → 红（入口面缺件即拒，LICENSE 缺亦红——在场必在律）；白名单外件（语言族 README）照拒', () => {
    const missing = judgePackList(
      PACK_BASELINES.sdk.filter((f) => f !== 'dist/packages/berry-agent-sdk/src/index.d.ts'),
      PACKAGES.sdk,
    );
    expect(missing.ok).toBe(false);
    expect(missing.missing).toContain('dist/packages/berry-agent-sdk/src/index.d.ts');
    // LICENSE 在场必在（2026-09-15 白名单同步批——缺件即红）
    const noLicense = judgePackList(
      PACK_BASELINES.sdk.filter((f) => f !== 'LICENSE'),
      PACKAGES.sdk,
    );
    expect(noLicense.ok).toBe(false);
    expect(noLicense.missing).toContain('LICENSE');
    // 语言族 README 照拒（SDK 无语言族——差分① v1 定案；LICENSE 已入白名单非禁件）
    const v = judgePackList([...PACK_BASELINES.sdk, 'README.zh.md'], PACKAGES.sdk);
    expect(v.forbidden).toEqual(['README.zh.md']);
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

  // 2026-09-15 CI 化批——publishMode 描述符锁（N4：枚举面随批扩入描述符定形块）
  it('publishMode 描述符锁：main=ci（缺省形 = 本机触发腿）/ sdk=token（全本地旧序）', () => {
    expect(PACKAGES.main.publishMode).toBe('ci');
    expect(PACKAGES.sdk.publishMode).toBe('token');
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

// ---------------------------------------------------------------------------
// 执行形三分（2026-09-15 CI 化批——07 §8.3 末定形注第 1-3 款：OIDC trusted
// publishing 常轨）。触发腿 = 本机预检→交棒 tag→gh 轮询 CI→registry 复探收口
// →preview latest 挪位〔npm/cli#8547 结构性外置〕→契约 5 本机复断；CI 腿 =
// release.yml 内 OIDC publish（契约 5 只读断言 next / 契约 6 只校验既有 tag）；
// 令牌腿 = 全本地旧序（SDK 缺省 + --local-publish 应急）。
// ---------------------------------------------------------------------------

describe('resolveReleaseForm（执行形解析——旗标 > env > 描述符）', () => {
  it('缺省：main→trigger（本机触发腿）/ sdk→token（全本地旧序）', () => {
    expect(resolveReleaseForm({ pkgKey: 'main', env: {} })).toBe('trigger');
    expect(resolveReleaseForm({ pkgKey: 'sdk', env: {} })).toBe('token');
  });

  it('旗标压过 env 与描述符：--local-publish 恒 token（应急腿）', () => {
    expect(resolveReleaseForm({ pkgKey: 'main', localPublish: true, env: {} })).toBe('token');
    expect(resolveReleaseForm({ pkgKey: 'main', localPublish: true, env: { BERRY_AGENT_RELEASE_MODE: 'ci' } })).toBe(
      'token',
    );
  });

  it('env=ci + main → ci（release.yml 发布腿形）；env=ci + sdk → 用法错（无 CI 腿）', () => {
    expect(resolveReleaseForm({ pkgKey: 'main', env: { BERRY_AGENT_RELEASE_MODE: 'ci' } })).toBe('ci');
    expect(() => resolveReleaseForm({ pkgKey: 'sdk', env: { BERRY_AGENT_RELEASE_MODE: 'ci' } })).toThrow(/无 CI 腿/);
  });

  it('env 非法取值 → 用法错（仅认 ci——fail-loud 不猜）', () => {
    expect(() => resolveReleaseForm({ pkgKey: 'main', env: { BERRY_AGENT_RELEASE_MODE: 'local' } })).toThrow(
      /取值非法/,
    );
  });
});

describe('judgeDistTagCi（契约 5 CI 形只读断言）', () => {
  it('prerelease：next 指 version 即过（latest 未挪不断言——挪位外置本机腿）', () => {
    expect(judgeDistTagCi({ latest: '0.0.9', next: '0.1.0-alpha.1' }, '0.1.0-alpha.1', true).ok).toBe(true);
  });

  it('prerelease：next 分叉 → 红（CI publish 未落 next 即异常）', () => {
    const v = judgeDistTagCi({ latest: '0.1.0-alpha.1', next: '0.0.9' }, '0.1.0-alpha.1', true);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('CI 形 preview 断言');
  });

  it('正式版：latest 指 version 过；不指红（next 不动）', () => {
    expect(judgeDistTagCi({ latest: '1.0.0', next: '0.9.0-beta.1' }, '1.0.0', false).ok).toBe(true);
    expect(judgeDistTagCi({ latest: '0.9.9', next: '0.9.0-beta.1' }, '1.0.0', false).ok).toBe(false);
  });
});

describe('runRelease 触发腿（主包缺省形——交棒/轮询/收口/挪位全谱）', () => {
  it('全绿：本机零上传（publish 单点在 CI）+ 交棒 tag + CI 绿 + 深对照收口 + latest 挪位', async () => {
    const s = triggerSeams();
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(0);
    const text = r.report.join('\n');
    expect(text).toContain('（执行形=本机触发腿）');
    expect(text).toContain('交棒：tag v0.1.0-alpha.1 已打并 push');
    expect(text).toContain('CI 绿');
    expect(text).toContain('深对照等价（仅溯源戳差异）');
    expect(text).toContain('preview latest 挪位完成');
    expect(s.calls.publish).toEqual([]); // 本机零 publish——版本字节上传单点在 CI（OIDC）
    expect(s.calls.gitTagCreate).toEqual(['v0.1.0-alpha.1']);
    expect(s.calls.gitTagPush).toEqual(['v0.1.0-alpha.1']);
    expect(s.calls.ciWait).toEqual(['v0.1.0-alpha.1']);
    expect(s.calls.distTagAdd).toEqual([['0.1.0-alpha.1', 'latest']]); // npm/cli#8547——dist-tag 走不了 OIDC
  });

  it('正式版：无 latest 挪位步（CI publish 默认 tag 已落位 latest）', async () => {
    const s = triggerSeams({ distTagLs: () => ({ latest: '1.0.0', next: '0.9.0-beta.9' }) });
    const r = await run(s, '1.0.0', false);
    expect(r.code).toBe(0);
    expect(s.calls.distTagAdd).toEqual([]);
    expect(s.calls.gitTagCreate).toEqual(['v1.0.0']);
  });

  it('幂等重跑：registry 在场且 shasum 等价 → 跳过交棒直收口（零 tag 写零等待）', async () => {
    const s = triggerSeams({
      probe: () => ({ status: 0, stdout: '"2222222222222222222222222222222222222222"\n', stderr: '' }),
      fileShasum: () => '2222222222222222222222222222222222222222',
    });
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(0);
    const text = r.report.join('\n');
    expect(text).toContain('跳过交棒直收口');
    expect(s.calls.gitTagCreate).toEqual([]);
    expect(s.calls.ciWait).toEqual([]);
    expect(s.calls.distTagAdd).toEqual([['0.1.0-alpha.1', 'latest']]); // 收口挪位照跑
  });

  it('tag 已在同 commit（上次交棒未收口）→ 续跑重等 CI 不重打', async () => {
    const s = triggerSeams({ gitTagState: () => ({ commit: 'aaaa0000' }) });
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(0);
    expect(s.calls.gitTagCreate).toEqual([]);
    expect(s.calls.ciWait).toEqual(['v0.1.0-alpha.1']);
  });

  it('tag 已在异 commit → 响亮拒（交棒面前）', async () => {
    const s = triggerSeams({ gitTagState: () => ({ commit: 'deadbeef' }) });
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('异 commit 响亮拒');
    expect(s.calls.ciWait).toEqual([]); // 未进等待段
  });

  it('tag push 失败 → 拒且 CI 未触发（本地 tag 已打的恢复手续在报告面）', async () => {
    const s = triggerSeams({ gitTagPush: () => ({ status: 1 }) });
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('push 失败——CI 未触发');
    expect(s.calls.ciWait).toEqual([]);
  });

  it('README 占位符在交棒前预检拦（拦在出门前非交棒后——CI 带病跑完再拦即半成功态）', async () => {
    const s = triggerSeams({ readmeText: () => '# berry\n<!-- placeholder -->' });
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('交棒前预检拦');
    expect(s.calls.gitTagCreate).toEqual([]);
    expect(s.calls.ciWait).toEqual([]);
  });

  it('谱项 ci:fail → 响亮拒附 run URL + 恢复手续指路（交棒已成——失败在 CI 段）', async () => {
    const s = INJECT_SPECTRUM['ci:fail'].patch(triggerSeams());
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(1);
    const text = r.report.join('\n');
    expect(text).toContain('actions/runs/999');
    expect(text).toContain('恢复手续');
    expect(s.calls.gitTagCreate).toEqual(['v0.1.0-alpha.1']);
  });

  it('谱项 ci:timeout → 30 分钟帽响亮拒附人工核指路', async () => {
    const s = INJECT_SPECTRUM['ci:timeout'].patch(triggerSeams());
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('30 分钟未出终态');
  });

  it('谱项 ci:green-absent → CI 绿但复探缺席响亮拒（半成功必须被看见）', async () => {
    const s = INJECT_SPECTRUM['ci:green-absent'].patch(
      triggerSeams({ probe: () => ({ status: 1, stdout: '', stderr: 'npm error code E404' }) }),
    );
    const r = await run(s, '0.1.0-alpha.1', false);
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('复探非在场');
  });
});

describe('runRelease CI 形（env BERRY_AGENT_RELEASE_MODE=ci——release.yml 发布腿）', () => {
  const ciEnv = { BERRY_AGENT_RELEASE_MODE: 'ci' };

  it('全绿：publish OIDC 单点（prerelease --tag next）+ 零 dist-tag add + 零 tag 写', async () => {
    const s = fakeSeams({ gitTagState: () => ({ commit: 'aaaa0000' }) });
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: ciEnv });
    expect(r.code).toBe(0);
    const text = r.report.join('\n');
    expect(text).toContain('（执行形=CI 发布腿）');
    expect(text).toContain('CI 形只读断言过');
    expect(text).toContain('tag v0.1.0-alpha.1 在场且同 commit（CI 只校验不打）');
    expect(s.calls.publish).toEqual([
      { tarball: '/tmp/fake/berry-agent-0.1.0-alpha.1.tgz', next: true, dryRun: false },
    ]);
    expect(s.calls.distTagAdd).toEqual([]); // npm/cli#8547——dist-tag 走不了 OIDC，latest 挪位在本机腿
    expect(s.calls.gitTagCreate).toEqual([]); // tag 即触发器——CI 不打 tag
    expect(s.calls.gitTagPush).toEqual([]);
  });

  it('CI 中间态（latest 未挪、next 已指）照过——latest≡next 终态复断归本机腿非 CI', async () => {
    const s = fakeSeams({
      distTagLs: () => ({ latest: '0.0.9', next: '0.1.0-alpha.1' }),
      gitTagState: () => ({ commit: 'aaaa0000' }),
    });
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: ciEnv });
    expect(r.code).toBe(0);
  });

  it('正式版：publish 默认 latest + judgeDistTagCi 断 latest', async () => {
    const s = fakeSeams({
      distTagLs: () => ({ latest: '1.0.0', next: '0.9.0-beta.9' }),
      gitTagState: () => ({ commit: 'aaaa0000' }),
    });
    const r = await run(s, '1.0.0', false, 'main', { env: ciEnv });
    expect(r.code).toBe(0);
    expect(s.calls.publish[0].next).toBe(false);
  });

  it('next 分叉 → 契约 5 红（CI 形断言件）', async () => {
    const s = fakeSeams({
      distTagLs: () => ({ latest: '0.0.9', next: '0.0.9' }),
      gitTagState: () => ({ commit: 'aaaa0000' }),
    });
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: ciEnv });
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('CI 形 preview 断言');
  });

  it('tag 缺席（dispatch 直跑形）→ 契约 6 拒（tag 即触发器）', async () => {
    const s = fakeSeams(); // gitTagState 缺省 absent
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: ciEnv });
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('tag 即触发器');
  });

  it('tag 异 commit → 契约 6 拒', async () => {
    const s = fakeSeams({ gitTagState: () => ({ commit: 'deadbeef' }) });
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: ciEnv });
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('异 commit 响亮拒');
  });

  it('env ci 撞 SDK → 用法错退 1（SDK 无 CI 腿）', async () => {
    const s = fakeSeams({}, 'sdk');
    const r = await run(s, '0.1.0-alpha.1', false, 'sdk', { env: ciEnv });
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('无 CI 腿');
  });

  it('env 非法值 → 用法错退 1（fail-loud）', async () => {
    const s = fakeSeams();
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: { BERRY_AGENT_RELEASE_MODE: 'local' } });
    expect(r.code).toBe(1);
    expect(r.report.join('\n')).toContain('取值非法');
  });

  it('--local-publish 旗标在 runRelease 层照压过 env ci（模式轴单源）', async () => {
    const s = fakeSeams();
    const r = await run(s, '0.1.0-alpha.1', false, 'main', { env: ciEnv, localPublish: true });
    expect(r.code).toBe(0);
    expect(r.report.join('\n')).toContain('（执行形=令牌全本地）');
    expect(s.calls.publish.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 纪元点火彩排（epoch drill——W8 纪元彩排批）
// ---------------------------------------------------------------------------

/**
 * 纪元彩排面定形：以「已点火」形状投影 03 §8.8 检查 9「面动号不动」的
 * 点火前休眠面——语义单源 = classifyFaceDiff（与 check-api 同源）；门条件
 * = 面动 ∧ 当前快照 apiVersion 与最新档案相同（检查 9 内联条件的镜像式）。
 * 彩排链 report-only：只出报告行，不改退出码（CI 形零旗标零噪音）。
 */
describe('纪元点火彩排（epoch drill——检查 9 点火前投影，report-only）', () => {
  /** 已归档基线面（上一版发布时的快照形态——两导出 + 一能力） */
  const EPOCH_ARCHIVED_SURFACE = {
    apiVersion: '1.0',
    enforcement: 'pre-ignition',
    exports: [
      { symbol: 'A', module: 'berry-agent', tier: 'stable', since: '1.0', sig: 'aaaa1111' },
      { symbol: 'B', module: 'berry-agent', tier: 'stable', since: '1.0', sig: 'bbbb2222' },
    ],
    capabilities: [{ name: 'cap-x', providedBy: 'core:x' }],
  };
  const EPOCH_ARCHIVE = [{ version: '0.1.0-alpha.2', surface: EPOCH_ARCHIVED_SURFACE }];
  /** 漂移面：新增 C + B 形变（面动）——apiVersion 未动 → 点火日将红 */
  const EPOCH_DRIFTED_SURFACE = {
    apiVersion: '1.0',
    enforcement: 'pre-ignition',
    exports: [
      { symbol: 'A', module: 'berry-agent', tier: 'stable', since: '1.0', sig: 'aaaa1111' },
      { symbol: 'B', module: 'berry-agent', tier: 'stable', since: '1.0', sig: 'cccc3333' },
      { symbol: 'C', module: 'berry-agent', tier: 'stable', since: '1.0', sig: 'dddd4444' },
    ],
    capabilities: [{ name: 'cap-x', providedBy: 'core:x' }],
  };

  it('judgeEpochIgnitionDrill：面动号不动 → will-red（分桶计数 + 同 apiVersion 坐标）', () => {
    const v = judgeEpochIgnitionDrill({ surface: EPOCH_DRIFTED_SURFACE, archives: EPOCH_ARCHIVE });
    expect(v.state).toBe('will-red');
    expect(v.diff.added).toEqual(['berry-agent::C']);
    expect(v.diff.changed).toEqual(['berry-agent::B']);
    expect(v.diff.removed).toEqual([]);
    expect(v.diff.reTiered).toEqual([]);
    expect(v.apiVersion).toBe('1.0');
    expect(v.lastVersion).toBe('0.1.0-alpha.2');
  });

  it('面动号也动（同一漂移 + apiVersion 升 1.1）→ will-pass 合法形', () => {
    const v = judgeEpochIgnitionDrill({
      surface: { ...EPOCH_DRIFTED_SURFACE, apiVersion: '1.1' },
      archives: EPOCH_ARCHIVE,
    });
    expect(v.state).toBe('will-pass');
  });

  it('面静止（仅 enforcement 纪元章翻转）→ will-pass 零面差（纪元章不是面）', () => {
    const v = judgeEpochIgnitionDrill({
      surface: { ...EPOCH_ARCHIVED_SURFACE, enforcement: 'ignited' },
      archives: EPOCH_ARCHIVE,
    });
    expect(v.state).toBe('will-pass');
    expect(v.diff.added).toEqual([]);
  });

  it('档案族空 → dormant（基线未成形——检查 9 点火日仍休眠，如实呈现非误报）', () => {
    const v = judgeEpochIgnitionDrill({ surface: EPOCH_DRIFTED_SURFACE, archives: [] });
    expect(v.state).toBe('dormant');
    expect(v.reason).toContain('档案族空');
  });

  it('彩排链常开：--dry-run 报告带纪元彩排段且 report-only 不改退出码（will-red 形仍退 0）', async () => {
    const s = fakeSeams({
      epochDrillFaces: () => ({ surface: EPOCH_DRIFTED_SURFACE, archives: EPOCH_ARCHIVE }),
    });
    const r = await run(s); // dryRun = true——彩排常开
    expect(r.code).toBe(0);
    const text = r.report.join('\n');
    expect(text).toContain('[纪元彩排]');
    expect(text).toContain('面动号不动');
    expect(text).toContain('berry-agent::C');
    expect(text).toContain('berry-agent::B');
    expect(text).toContain('apiVersion 均 1.0');
  });

  it('真发形缺省静默（缝不被调）；--epoch-drill 显式开——带报告且不改退出码', async () => {
    // 缺省真发（令牌腿）：彩排缝被调即抛——证零噪音
    const silent = await run(
      fakeSeams({
        epochDrillFaces: () => {
          throw new Error('真发缺省不应触彩排缝');
        },
      }),
      '0.1.0-alpha.1',
      false,
      'main',
      { localPublish: true },
    );
    expect(silent.code).toBe(0);
    expect(silent.report.join('\n')).not.toContain('[纪元彩排]');
    // --epoch-drill 显式开：报告在场 + report-only 退 0
    const on = await run(
      fakeSeams({
        epochDrillFaces: () => ({ surface: EPOCH_DRIFTED_SURFACE, archives: EPOCH_ARCHIVE }),
      }),
      '0.1.0-alpha.1',
      false,
      'main',
      { localPublish: true, epochDrill: true },
    );
    expect(on.code).toBe(0);
    expect(on.report.join('\n')).toContain('[纪元彩排]');
  });

  it('SDK 包不跑彩排（API 面治理是主包坐标系——SDK 无独立快照档案族）', async () => {
    const s = fakeSeams(
      {
        epochDrillFaces: () => {
          throw new Error('SDK 包不应触纪元彩排缝');
        },
      },
      'sdk',
    );
    const r = await run(s, '0.1.0-alpha.1', true, 'sdk');
    expect(r.code).toBe(0);
    expect(r.report.join('\n')).not.toContain('[纪元彩排]');
  });

  it('档案族空（仓内现行真态）→ 休眠报告行如实呈现——不为静默而吞', async () => {
    const r = await run(fakeSeams()); // 缺省缝即休眠形
    expect(r.code).toBe(0);
    const text = r.report.join('\n');
    expect(text).toContain('[纪元彩排]');
    expect(text).toContain('休眠');
  });

  it('注入谱 epoch:will-red：CLI --inject 同物——谱语义漂移在此当场红（注入证可红）', async () => {
    const s = INJECT_SPECTRUM['epoch:will-red'].patch(fakeSeams());
    const r = await run(s); // dry-run 缺省——谱项无 publish 后段（afterPublish: false）
    expect(r.code).toBe(0); // report-only：注入的红面彩排不改退出码
    const text = r.report.join('\n');
    expect(text).toContain('[纪元彩排]');
    expect(text).toContain('面动号不动');
  });

  it('parseReleaseArgs：--epoch-drill 布尔旗标解析 + 未知参数指引语含旗标', () => {
    expect(parseReleaseArgs(['--epoch-drill']).epochDrill).toBe(true);
    expect(parseReleaseArgs(['--dry-run', '--epoch-drill']).epochDrill).toBe(true);
    expect(parseReleaseArgs([]).epochDrill).toBe(false);
    expect(parseReleaseArgs(['--wat']).errors[0]).toContain('--epoch-drill');
  });
});
