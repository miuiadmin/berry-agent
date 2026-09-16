/**
 * host/plugin-market/install 测试——mp-3 装机咬合编舞（03 §9.6 装机咬合节）。
 *
 * 覆盖：寻址解析/源缺席/缓存缺席/改名漂移/条目缺席/翻译拒的拒形谱 + 三拷贝
 * 腿字节源分境（B2 local 缓存直拷零 spawn / git 语境缓存直拷 commit 取 ref
 * sha / git-subdir 独立仓克隆抽拷）+ direct 腿 installPlugin 复用锁（「零新
 * 装机机制」——边界钉死②：npm direct 腿走既有 npm 执行器 argv 编舞 + market
 * 注记落账）+ resolveMarketLedgerId 三态（零中拒/恰一/多中诚实拒）。
 *
 * 真盘 tmp 数据目录 + 真双 fs 面（市场面 MarketFs 与装机面 PluginStoreFs 各自
 * 真身）；spawn 全假件零真网络——缓存直拷两腿断言零 spawn 调用。
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import { addMarketplaceSource } from './add.js';
import { createMarketFs } from './fs.js';
import { marketInstall, resolveMarketLedgerId } from './install.js';
import { writeMarketplaceSources } from './registry.js';
import type { MarketplaceSourceRecord } from './types.js';
import { createPluginStoreFs, readLedger } from '../plugin-store.js';
import type { PluginLedgerEntry } from '../plugin-store.js';
import type { InstallExecutorDeps, SpawnRunner } from '../plugin-install.js';

/** 测试根 tmp（vitest 每文件钉数据目录纪律——自管 tmp 收尾自清） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-market-install-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** 数据目录速记 */
function dataDirOf(name: string): string {
  const dir = join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 声明载荷插件 fixture（berryAgent.skills 在场 = declared-payload——零码收割零 jiti） */
function declaredPkgJson(id: string, version = '1.0.0'): string {
  return `${JSON.stringify({ name: id, version, berryAgent: { id, skills: ['greet'] } }, null, 2)}\n`;
}

/** 零 spawn 假件（缓存直拷腿字节源锁——任何 spawn 调用即测试红） */
const noSpawn: SpawnRunner = {
  run: (cmd) => Promise.reject(new Error(`拷贝腿不应 spawn（收到 ${cmd}）——缓存即字节源`)),
};

/** 市场安装 deps 速记（双 fs 真身 + 注入 spawn + 钉时钟） */
function depsOf(dataDir: string, spawn: SpawnRunner): Parameters<typeof marketInstall>[0] {
  const install: InstallExecutorDeps = {
    dataDir,
    fs: createPluginStoreFs(),
    spawn,
    now: () => new Date('2026-09-16T12:00:00.000Z'),
  };
  return { dataDir, fs: createMarketFs(), install };
}

/** npm 假 spawn：写装机产物（node_modules/<pkg>/package.json + lock）+ argv 记录 */
function npmFakeSpawn(dataDir: string): { readonly spawn: SpawnRunner; readonly argvLog: string[][] } {
  const argvLog: string[][] = [];
  const spawn: SpawnRunner = {
    run: (cmd, args) => {
      argvLog.push([cmd, ...args]);
      if (cmd !== 'npm') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
      const spec = args[args.length - 1]!;
      const pkg = spec.startsWith('@') ? spec.slice(0, spec.lastIndexOf('@')) : spec.split('@')[0]!;
      const pkgDir = join(dataDir, 'plugins', 'node_modules', ...pkg.split('/'));
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'package.json'), declaredPkgJson(pkg === 'scoped-demo' ? 'scoped-demo' : pkg));
      writeFileSync(
        join(dataDir, 'plugins', '.package-lock.json'),
        JSON.stringify({ packages: { [`node_modules/${pkg}`]: { version: '1.2.3', integrity: 'sha512-abc' } } }),
      );
      return Promise.resolve({ stdout: '', stderr: '' });
    },
  };
  return { spawn, argvLog };
}

/** git-subdir 假 spawn：clone 在 argv 尾参（tmp 克隆位）写含子目录的仓 fixture */
function gitSubdirFakeSpawn(opts: { readonly subpath: string; readonly headCommit: string }): {
  readonly spawn: SpawnRunner;
  readonly argvLog: string[][];
} {
  const argvLog: string[][] = [];
  const spawn: SpawnRunner = {
    run: (cmd, args) => {
      argvLog.push([cmd, ...args]);
      if (cmd !== 'git') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
      if (args[0] === 'clone') {
        // clone 目标 = argv 尾参（执行器 mkdtemp tmp）——写子目录插件 fixture
        const cloneDir = args[args.length - 1]!;
        const pluginDir = join(cloneDir, ...opts.subpath.split('/'));
        mkdirSync(pluginDir, { recursive: true });
        writeFileSync(join(pluginDir, 'package.json'), declaredPkgJson('subrepo-pkg'));
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (args[2] === 'rev-parse') return Promise.resolve({ stdout: `${opts.headCommit}\n`, stderr: '' });
      return Promise.resolve({ stdout: '', stderr: '' }); // checkout 记 argv 退 0
    },
  };
  return { spawn, argvLog };
}

/** 本地市场仓 fixture：.claude-plugin/marketplace.json + 相对源条目目录 */
function seedMarketRepo(
  root: string,
  name: string,
  plugins: readonly { readonly name: string; readonly source: unknown; readonly description?: string }[],
): string {
  const repo = join(root, `${name}-repo`);
  mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(repo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name, owner: { name: 'o' }, plugins }),
  );
  for (const plugin of plugins) {
    if (typeof plugin.source === 'string' && plugin.source.startsWith('./')) {
      const dir = join(repo, plugin.source.slice(2));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), declaredPkgJson(plugin.name));
    }
  }
  return repo;
}

/** 直接落源清单记录（不经 add——git 语境源用例手工铸缓存现场） */
function seedSource(dataDir: string, record: MarketplaceSourceRecord): void {
  writeMarketplaceSources(dataDir, [record], createMarketFs());
}

/** 直接落缓存文件（marketplaces/<name>/ 下相对路径） */
function seedCache(dataDir: string, name: string, files: Record<string, string>): void {
  const fs = createMarketFs();
  for (const [rel, text] of Object.entries(files)) {
    fs.write(join(dataDir, 'marketplaces', name, rel), text);
  }
}

/** 账本读取速记（ok 恒断言——调用位免判别噪音） */
function ledgerOf(dataDir: string): readonly PluginLedgerEntry[] {
  const read = readLedger(dataDir, createPluginStoreFs());
  expect(read.ok).toBe(true);
  return read.ok ? read.entries : [];
}

describe('marketInstall 拒形谱（寻址/源/缓存/条目/翻译）', () => {
  it('寻址形坏（无 @ / 空段）拒——报文指路 name@marketplace 形', async () => {
    const dataDir = dataDirOf('bad-id');
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'no-at-segment');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('no-at-segment');
    expect(outcome.message).toContain('name@marketplace');
  });

  it('市场未 add 拒——报文含市场名与 add 指路', async () => {
    const dataDir = dataDirOf('no-source');
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'hello-plugin@nowhere');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('nowhere');
    expect(outcome.message).toContain('marketplace add');
  });

  it('源缓存 catalog 缺席拒——报文指路 remove 后重新 add', async () => {
    const dataDir = dataDirOf('cache-missing');
    seedSource(dataDir, {
      name: 'alpha',
      sourceType: 'local',
      sourceUri: '/gone/repo',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    });
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'hello-plugin@alpha');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('缓存');
    expect(outcome.message).toContain('remove');
  });

  it('缓存 catalog 改名漂移拒（自报名 ≠ 源清单名）', async () => {
    const dataDir = dataDirOf('rename-drift');
    seedSource(dataDir, {
      name: 'alpha',
      sourceType: 'local',
      sourceUri: '/repo',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    });
    seedCache(dataDir, 'alpha', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'beta', // 自报名漂移
        owner: { name: 'o' },
        plugins: [],
      }),
    });
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'hello-plugin@alpha');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('漂移');
  });

  it('条目缺席拒——报文列在售条目名', async () => {
    const dataDir = dataDirOf('entry-missing');
    const repo = seedMarketRepo(dataDir, 'alpha', [{ name: 'hello-plugin', source: './plugins/hello' }]);
    const added = await addMarketplaceSource(
      { dataDir, fs: createMarketFs(), now: () => new Date('2026-09-16T12:00:00.000Z') },
      repo,
    );
    expect(added.ok).toBe(true);
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'other-plugin@alpha');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('other-plugin');
    expect(outcome.message).toContain('hello-plugin'); // 在售名单
  });

  it('翻译拒透传（URL 源相对串结构性不可解析）', async () => {
    const dataDir = dataDirOf('url-context');
    seedSource(dataDir, {
      name: 'flat',
      sourceType: 'url',
      sourceUri: 'https://example.com/market.json',
      catalogPath: 'marketplace.json',
      addedAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    });
    seedCache(dataDir, 'flat', {
      'marketplace.json': JSON.stringify({
        name: 'flat',
        owner: { name: 'o' },
        plugins: [{ name: 'hello-plugin', source: './plugins/hello' }],
      }),
    });
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'hello-plugin@flat');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('结构性不可解析');
  });
});

describe('marketInstall direct 腿——installPlugin 复用锁（零新装机机制）', () => {
  it('npm 形条目走既有 npm 执行器：四件套 argv + market 注记落账', async () => {
    const dataDir = dataDirOf('npm-direct');
    const repo = seedMarketRepo(dataDir, 'alpha', [
      { name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } },
    ]);
    const added = await addMarketplaceSource(
      { dataDir, fs: createMarketFs(), now: () => new Date('2026-09-16T12:00:00.000Z') },
      repo,
    );
    expect(added.ok).toBe(true);
    const { spawn, argvLog } = npmFakeSpawn(dataDir);
    const outcome = await marketInstall(depsOf(dataDir, spawn), 'demo-pkg@alpha');
    expect(outcome.ok).toBe(true);
    // 既有 npm 执行器编舞原样复用（argv 含四件套与 spec 尾参）
    expect(argvLog.length).toBe(1);
    expect(argvLog[0]![0]).toBe('npm');
    expect(argvLog[0]!).toContain('--save-exact');
    expect(argvLog[0]!).toContain('--ignore-scripts');
    expect(argvLog[0]![argvLog[0]!.length - 1]).toBe('demo-pkg@1.2.3');
    // 落账：三源字段照既有 + market 注记 {name, entry}
    const entries = ledgerOf(dataDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'demo-pkg',
      source: 'npm',
      ref: 'npm:demo-pkg@1.2.3',
      market: { name: 'alpha', entry: 'demo-pkg' },
    });
  });
});

describe('marketInstall 拷贝腿——三境字节源分境（03 §9.6 B2 定形注）', () => {
  it('B2 local 语境相对源：缓存直拷零 spawn + market 段落位 + remove 缓存不悬空装机物', async () => {
    const dataDir = dataDirOf('b2-local');
    const repo = seedMarketRepo(dataDir, 'alpha', [{ name: 'hello-plugin', source: './plugins/hello' }]);
    const added = await addMarketplaceSource(
      { dataDir, fs: createMarketFs(), now: () => new Date('2026-09-16T12:00:00.000Z') },
      repo,
    );
    expect(added.ok).toBe(true);
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'hello-plugin@alpha');
    expect(outcome.ok).toBe(true);
    // 落账：source 'local'（源真相）+ market 段相对 installPath（装机子树内）
    const entries = ledgerOf(dataDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'hello-plugin',
      source: 'local',
      ref: `local:${join(dataDir, 'marketplaces', 'alpha')}`,
      installPath: join('plugins', 'market', 'alpha', 'hello-plugin'),
      market: { name: 'alpha', entry: 'hello-plugin' },
    });
    // 装机物在场（拷贝腿真拷贝——非直引）
    const installed = join(dataDir, 'plugins', 'market', 'alpha', 'hello-plugin');
    expect(existsSync(join(installed, 'package.json'))).toBe(true);
    // 拷贝腿落位独立于缓存目录：清缓存后装机物不悬空
    createMarketFs().rm(join(dataDir, 'marketplaces', 'alpha'));
    expect(existsSync(join(installed, 'package.json'))).toBe(true);
  });

  it('git 语境相对源：copyFrom=缓存直拷零 spawn + commit 取 ref 钉的 catalog sha', async () => {
    const dataDir = dataDirOf('git-context');
    const sha = 'abc1234567';
    seedSource(dataDir, {
      name: 'gitsrc',
      sourceType: 'git',
      sourceUri: 'https://example.com/o/market-repo.git',
      catalogPath: '.claude-plugin/marketplace.json',
      addedAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
      commit: sha,
    });
    seedCache(dataDir, 'gitsrc', {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'gitsrc',
        owner: { name: 'o' },
        plugins: [{ name: 'foo-plugin', source: './plugins/foo' }],
      }),
      'plugins/foo/package.json': declaredPkgJson('foo-plugin'),
    });
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'foo-plugin@gitsrc');
    expect(outcome.ok).toBe(true);
    const entries = ledgerOf(dataDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'foo-plugin',
      source: 'git',
      ref: `git:https://example.com/o/market-repo.git#${sha}`,
      commit: sha, // 缓存拷贝腿无 .git 可收割——commit 取翻译产物 ref 钉的 catalog sha
      installPath: join('plugins', 'market', 'gitsrc', 'foo-plugin'),
      market: { name: 'gitsrc', entry: 'foo-plugin' },
    });
    expect(existsSync(join(dataDir, 'plugins', 'market', 'gitsrc', 'foo-plugin', 'package.json'))).toBe(true);
  });

  it('git-subdir 独立仓：克隆抽拷（clone/checkout/rev-parse 编舞）+ HEAD commit 收割', async () => {
    const dataDir = dataDirOf('git-subdir');
    const repo = seedMarketRepo(dataDir, 'sub', [
      {
        name: 'foo-plugin',
        source: {
          source: 'git-subdir',
          url: 'https://example.com/o/monorepo.git',
          path: 'packages/foo',
          sha: 'deadbeef',
        },
      },
    ]);
    const added = await addMarketplaceSource(
      { dataDir, fs: createMarketFs(), now: () => new Date('2026-09-16T12:00:00.000Z') },
      repo,
    );
    expect(added.ok).toBe(true);
    const { spawn, argvLog } = gitSubdirFakeSpawn({ subpath: 'packages/foo', headCommit: 'cafebabe77' });
    const outcome = await marketInstall(depsOf(dataDir, spawn), 'foo-plugin@sub');
    expect(outcome.ok).toBe(true);
    // 克隆编舞三笔序（clone → checkout --detach sha → rev-parse HEAD）
    expect(argvLog).toHaveLength(3);
    expect(argvLog[0]![0]).toBe('git');
    expect(argvLog[0]![1]).toBe('clone');
    expect(argvLog[0]![2]).toBe('https://example.com/o/monorepo.git');
    expect(argvLog[1]).toEqual(['git', '-C', expect.any(String), 'checkout', '--detach', 'deadbeef']);
    expect(argvLog[2]).toEqual(['git', '-C', expect.any(String), 'rev-parse', 'HEAD']);
    const entries = ledgerOf(dataDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'subrepo-pkg', // fixture 自报 id（清单承载——条目名与装机 id 解耦）
      source: 'git',
      ref: 'git:https://example.com/o/monorepo.git#deadbeef',
      commit: 'cafebabe77',
      installPath: join('plugins', 'market', 'sub', 'foo-plugin'),
      market: { name: 'sub', entry: 'foo-plugin' },
    });
  });

  it('缓存目录被清后 local 语境拷贝源缺席 = 诚实拒（指路 remove 后重新 add）', async () => {
    const dataDir = dataDirOf('b2-cache-gone');
    const repo = seedMarketRepo(dataDir, 'alpha', [{ name: 'hello-plugin', source: './plugins/hello' }]);
    const added = await addMarketplaceSource(
      { dataDir, fs: createMarketFs(), now: () => new Date('2026-09-16T12:00:00.000Z') },
      repo,
    );
    expect(added.ok).toBe(true);
    // 模拟缓存子目录失联（catalog 在场、插件子目录被清）
    createMarketFs().rm(join(dataDir, 'marketplaces', 'alpha', 'plugins'));
    const outcome = await marketInstall(depsOf(dataDir, noSpawn), 'hello-plugin@alpha');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('remove');
    expect(outcome.message).toContain('add');
  });
});

describe('resolveMarketLedgerId（market 寻址 → 装机 id）三态', () => {
  const entry = (id: string, market?: { readonly name: string; readonly entry: string }): PluginLedgerEntry => ({
    id,
    source: 'local',
    ref: `local:/x/${id}`,
    installedAt: '2026-09-16T00:00:00.000Z',
    installPath: join('plugins', 'market', 'm', id),
    declaredEvents: [],
    ...(market !== undefined ? { market } : {}),
  });

  it('零中拒——报文指路 marketplace install', () => {
    const result = resolveMarketLedgerId([entry('a')], { name: 'x', marketplace: 'm' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('marketplace install');
  });

  it('恰一返回装机 id', () => {
    const result = resolveMarketLedgerId([entry('a'), entry('market-id', { name: 'm', entry: 'x' }), entry('plain')], {
      name: 'x',
      marketplace: 'm',
    });
    expect(result).toEqual({ ok: true, id: 'market-id' });
  });

  it('多中诚实拒——报文指路 plugins uninstall <id>', () => {
    const result = resolveMarketLedgerId(
      [entry('one', { name: 'm', entry: 'x' }), entry('two', { name: 'm', entry: 'x' })],
      { name: 'x', marketplace: 'm' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('plugins uninstall');
  });
});
