import { describe, expect, it } from 'vitest';

import {
  INJECT_SPECTRUM,
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
 */

/** 假缝工厂——全绿基线 + 调用留痕（断言「未触写面」用） */
function fakeSeams(overrides = {}) {
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
    packList: () => [
      'package.json',
      'README.md',
      'LICENSE',
      'dist/host/main.js',
      'dist/webui/index.html',
      'dist/api/surface.json',
      'dist/.build-meta.json',
    ],
    pack: () => ({ tarballPath: '/tmp/fake/berry-agent-0.1.0-alpha.1.tgz' }),
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

/** runRelease 直跑快捷（静默 log） */
async function run(seams, version = '0.1.0-alpha.1', dryRun = true) {
  const report = [];
  const result = await runRelease(seams, { version, dryRun, log: (l) => report.push(l) });
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
});

describe('judgeTarballTrees（契约 4 深对照）', () => {
  it('仅溯源戳差异 → 等价跳', () => {
    const local = { 'package.json': 'a', 'dist/.build-meta.json': 'm1' };
    const remote = { 'package.json': 'a', 'dist/.build-meta.json': 'm2' };
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
  it('空参 = 真发；--dry-run = 演习', () => {
    expect(parseReleaseArgs([])).toEqual({ dryRun: false, inject: undefined, errors: [] });
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
