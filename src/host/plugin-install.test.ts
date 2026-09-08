/**
 * host/plugin-install 三源装机执行器测试（成熟度缺口 #10 装机面落码批 10b）。
 *
 * 覆盖四块：ref 词法全矩阵、min-release-age 三级解析（缺省/env/cliFlag 覆盖
 * + env 坏形 fail-loud）、npm 执行器假 spawn 编舞（argv 供应链四件套断言 +
 * 锚 package.json + lock 收割 + 失败指路 + 撞名拒 + core: 前缀拒 + 回滚）、
 * local 源与收割真跑（本地 fixture 零网络——declaredEvents 收割/纯声明包零码
 * 收割/events 坏形拒）、update 分派三态（local no-op/npm 重装换装豁免/查无拒）。
 *
 * 真盘 tmp 数据目录 + 真 fs 注入；spawn 全假件——npm/git 两执行器零真网络。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_MIN_RELEASE_AGE_MINUTES,
  MIN_RELEASE_AGE_ENV,
  installPlugin,
  parsePluginRef,
  resolveMinReleaseAge,
  updatePlugin,
} from './plugin-install.js';
import type { InstallExecutorDeps, SpawnRunner } from './plugin-install.js';
import { createPluginStoreFs, ledgerPath, readLedger } from './plugin-store.js';
import type { LifecycleAuditSink, PluginLedgerEntry } from './plugin-store.js';

/** 测试根 tmp（每文件钉数据目录纪律——BERRY_AGENT_DATA_DIR 之外的自管 tmp） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-install-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** 数据目录速记 */
function dataDirOf(name: string): string {
  const dir = join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 插件 fixture package.json 最小合法形（berryAgent 块在场——§1.2 清单载体） */
function pluginPkgJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name: 'demo-pkg', version: '1.0.0', main: 'index.js', berryAgent: {}, ...overrides }, null, 2)}\n`;
}

/** 常规入口 fixture（events 导出字符串数组——收割真源） */
const INDEX_WITH_EVENTS = `export const events = ['demo/event-a', 'demo/event-b'];\nexport default function apply() {}\n`;

/** npm 假 spawn：on npm 写装机产物（node_modules/<pkg>/package.json + lock）+ argv 记录 */
interface NpmRecorder {
  readonly spawn: SpawnRunner;
  readonly argvLog: string[][];
}

function npmFakeSpawn(
  dataDir: string,
  opts: { readonly pkgJson?: string; readonly lockVersion?: string } = {},
): NpmRecorder {
  const argvLog: string[][] = [];
  const spawn: SpawnRunner = {
    run: (cmd, args) => {
      argvLog.push([cmd, ...args]);
      if (cmd !== 'npm') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
      // argv 尾参 = pkg spec；写装机产物（真 fs——与执行器同一 dataDir）
      const spec = args[args.length - 1]!;
      const pkg = spec.startsWith('@') ? spec.slice(0, spec.lastIndexOf('@')) : spec.split('@')[0]!;
      const pkgDir = join(dataDir, 'plugins', 'node_modules', ...pkg.split('/'));
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'package.json'), opts.pkgJson ?? pluginPkgJson());
      writeFileSync(join(pkgDir, 'index.js'), INDEX_WITH_EVENTS);
      const lock = {
        packages: {
          [`node_modules/${pkg}`]: { version: opts.lockVersion ?? '1.2.3', integrity: 'sha512-abc' },
        },
      };
      writeFileSync(join(dataDir, 'plugins', '.package-lock.json'), JSON.stringify(lock));
      return Promise.resolve({ stdout: '', stderr: '' });
    },
  };
  return { spawn, argvLog };
}

/** 执行器 deps 速记（真 fs + 注入 spawn） */
function depsOf(dataDir: string, spawn: SpawnRunner, extra: Partial<InstallExecutorDeps> = {}): InstallExecutorDeps {
  return { dataDir, fs: createPluginStoreFs(), spawn, ...extra };
}

/** 账本 entries 窄化读 */
function entriesOf(dataDir: string): readonly PluginLedgerEntry[] {
  const read = readLedger(dataDir, createPluginStoreFs());
  if (!read.ok) throw new Error(`坏账本：${read.reason}`);
  return read.entries;
}

describe('ref 词法全矩阵（CLI 与账本同形单源）', () => {
  it('npm：裸包名/@版本/scoped 包三形', () => {
    expect(parsePluginRef('npm:acme-widgets')).toEqual({ ok: true, parsed: { source: 'npm', pkg: 'acme-widgets' } });
    expect(parsePluginRef('npm:acme-widgets@1.2.0')).toEqual({
      ok: true,
      parsed: { source: 'npm', pkg: 'acme-widgets', version: '1.2.0' },
    });
    // scoped：@ 在位 0 是 scope 前缀非版本分隔
    expect(parsePluginRef('npm:@scope/pkg@2.0.0')).toEqual({
      ok: true,
      parsed: { source: 'npm', pkg: '@scope/pkg', version: '2.0.0' },
    });
    expect(parsePluginRef('npm:@scope/pkg')).toEqual({ ok: true, parsed: { source: 'npm', pkg: '@scope/pkg' } });
  });

  it('git：url/#ref 两形 + 尾 # 空 ref 拒；local：路径直通', () => {
    expect(parsePluginRef('git:https://github.com/o/r.git')).toEqual({
      ok: true,
      parsed: { source: 'git', url: 'https://github.com/o/r.git' },
    });
    expect(parsePluginRef('git:https://github.com/o/r.git#v1.2.0')).toEqual({
      ok: true,
      parsed: { source: 'git', url: 'https://github.com/o/r.git', gitRef: 'v1.2.0' },
    });
    expect(parsePluginRef('git:https://x#').ok).toBe(false);
    expect(parsePluginRef('local:/abs/path')).toEqual({ ok: true, parsed: { source: 'local', path: '/abs/path' } });
  });

  it('无前缀/空前缀各拒（不猜默认源）', () => {
    for (const bad of ['acme-widgets', 'npm:', 'git:', 'local:', '']) {
      expect(parsePluginRef(bad).ok).toBe(false);
    }
  });
});

describe('min-release-age 三级解析', () => {
  it('缺省 1440 / env 值 / env 0 显式关窗 / cliFlag 胜 env', () => {
    expect(resolveMinReleaseAge({})).toBe(DEFAULT_MIN_RELEASE_AGE_MINUTES);
    expect(resolveMinReleaseAge({ env: {} })).toBe(1440);
    expect(resolveMinReleaseAge({ env: { [MIN_RELEASE_AGE_ENV]: '60' } })).toBe(60);
    expect(resolveMinReleaseAge({ env: { [MIN_RELEASE_AGE_ENV]: '0' } })).toBe(0);
    expect(resolveMinReleaseAge({ env: { [MIN_RELEASE_AGE_ENV]: '60' }, cliFlag: 30 })).toBe(30);
    expect(resolveMinReleaseAge({ cliFlag: 0 })).toBe(0);
  });

  it('env 坏形 fail-loud（非数字/负数/小数——当场红优于静默降级）', () => {
    for (const bad of ['x', '-5', '1.5']) {
      expect(() => resolveMinReleaseAge({ env: { [MIN_RELEASE_AGE_ENV]: bad } })).toThrowError(/坏形/);
    }
    // ' 60' 经 Number 归一合法（前后空白剥离）——非坏形面
    expect(resolveMinReleaseAge({ env: { [MIN_RELEASE_AGE_ENV]: ' 60' } })).toBe(60);
  });
});

describe('npm 执行器编舞（假 spawn——argv 与落账可测，零真网络）', () => {
  it('全链：argv 供应链四件套 + 锚 package.json + lock 收割 + events 收割 + 落账', async () => {
    const dataDir = dataDirOf('data-a');
    const rec = npmFakeSpawn(dataDir, { lockVersion: '1.2.3' });
    const outcome = await installPlugin(depsOf(dataDir, rec.spawn), 'npm:demo-pkg@1.2.3');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 账本条目全字段（version = manifest 优先 lock；integrity 从 lock 收割；
    // declaredEvents 真跑 jiti 收割）
    expect(outcome.entry).toMatchObject({
      id: 'demo-pkg',
      source: 'npm',
      ref: 'npm:demo-pkg@1.2.3',
      version: '1.0.0',
      integrity: 'sha512-abc',
      installPath: join('plugins', 'node_modules', 'demo-pkg'),
      declaredEvents: ['demo/event-a', 'demo/event-b'],
    });
    // argv：七旗标族 + 版本钉定 spec（--prefix 指向数据目录装机树）
    expect(rec.argvLog[0]).toEqual([
      'npm',
      'install',
      '--prefix',
      join(dataDir, 'plugins'),
      '--save-exact',
      '--omit=dev',
      '--omit=peer',
      '--legacy-peer-deps',
      '--ignore-scripts',
      '--min-release-age',
      '1440',
      'demo-pkg@1.2.3',
    ]);
    // 锚 package.json（缺席即写——防 npm 向上爬父目录）
    const anchor = JSON.parse(readFileSync(join(dataDir, 'plugins', 'package.json'), 'utf8'));
    expect(anchor.private).toBe(true);
    // 账本条目数组形落盘
    const onDisk = JSON.parse(readFileSync(ledgerPath(dataDir), 'utf8'));
    expect(Array.isArray(onDisk)).toBe(true);
  });

  it('min-release-age 三态：env 0 → 不传旗标；cliFlag 覆盖 env', async () => {
    const dataDir = join(testRoot, 'data-a'); // 同目录撞名——换包名隔离
    const rec0 = npmFakeSpawn(dataDir);
    await installPlugin(depsOf(dataDir, rec0.spawn, { env: { [MIN_RELEASE_AGE_ENV]: '0' } }), 'npm:zero-window-pkg');
    expect(rec0.argvLog[0]!.includes('--min-release-age')).toBe(false); // 0 = 显式关窗
    const recO = npmFakeSpawn(dataDir);
    await installPlugin(
      depsOf(dataDir, recO.spawn, { env: { [MIN_RELEASE_AGE_ENV]: '60' }, minReleaseAgeOverride: 30 }),
      'npm:override-pkg',
    );
    const i = recO.argvLog[0]!.indexOf('--min-release-age');
    expect(recO.argvLog[0]![i + 1]).toBe('30');
  });

  it('npm 失败（Unknown cli flag）→ 指路 npm ≥11.5 + env 关窗', async () => {
    const dataDir = dataDirOf('data-b');
    const failing: SpawnRunner = {
      run: () => {
        const err = new Error('command failed') as Error & { stderr: string };
        err.stderr = 'npm error Unknown cli flag --min-release-age';
        return Promise.reject(err);
      },
    };
    const outcome = await installPlugin(depsOf(dataDir, failing), 'npm:demo-pkg');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('npm install 失败');
    expect(outcome.message).toContain('npm ≥11.5');
    expect(outcome.message).toContain(`${MIN_RELEASE_AGE_ENV}=0`);
  });

  it('撞名拒指路 update + 装机物回滚不留残影；core: 前缀 id 拒同回滚', async () => {
    const dataDir = dataDirOf('data-b');
    const rec = npmFakeSpawn(dataDir, { pkgJson: pluginPkgJson({ name: 'dup-pkg' }) });
    await installPlugin(depsOf(dataDir, rec.spawn), 'npm:dup-pkg');
    const again = await installPlugin(depsOf(dataDir, rec.spawn), 'npm:dup-pkg');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.message).toContain('已装机');
    expect(again.message).toContain('update');
    // core: 前缀：清单 id 带官方前缀 → 拒 + 回滚（node_modules 目录被 rm）
    const recCore = npmFakeSpawn(dataDir, {
      pkgJson: pluginPkgJson({ name: 'evil-pkg', berryAgent: { id: 'core:evil' } }),
    });
    const core = await installPlugin(depsOf(dataDir, recCore.spawn), 'npm:evil-pkg');
    expect(core.ok).toBe(false);
    if (core.ok) return;
    expect(core.message).toContain('core: 为官方插件保留');
    expect(existsSync(join(dataDir, 'plugins', 'node_modules', 'evil-pkg'))).toBe(false);
    // 撞名拒路径：npm 重写产物后拒——回滚把同路径装机物一并清（不留残影；
    // 账本条目仍指路 update）
    expect(existsSync(join(dataDir, 'plugins', 'node_modules', 'dup-pkg'))).toBe(false);
    expect(entriesOf(dataDir).map((e) => e.id)).toContain('dup-pkg');
  });
});

describe('local 源与收割真跑（本地 fixture 零网络）', () => {
  /** local fixture 插件目录速记（name 逐 fixture 独立——防撞自家账本） */
  function localFixture(name: string, pkgJson: string, indexJs?: string): string {
    const dir = join(testRoot, `fixture-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), pkgJson);
    if (indexJs !== undefined) writeFileSync(join(dir, 'index.js'), indexJs);
    return dir;
  }
  const noopSpawn: SpawnRunner = { run: () => Promise.reject(new Error('local 源不 spawn')) };

  it('local 直引：installPath 绝对 canonical + declaredEvents 收割 + 落账', async () => {
    const dataDir = dataDirOf('data-c');
    const src = localFixture('ok', pluginPkgJson({ name: 'local-ok-pkg' }), INDEX_WITH_EVENTS);
    const outcome = await installPlugin(depsOf(dataDir, noopSpawn), `local:${src}`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entry.installPath).toBe(realpathSync(src)); // canonical 绝对（符号链归一）
    expect(outcome.entry.declaredEvents).toEqual(['demo/event-a', 'demo/event-b']);
    expect(outcome.entry.source).toBe('local');
    // 直引不拷贝——源目录在场即装机物
    expect(existsSync(join(src, 'index.js'))).toBe(true);
  });

  it('纯声明包（declared-payload）零码收割 declaredEvents = []', async () => {
    const dataDir = join(testRoot, 'data-c');
    const src = localFixture('declared', pluginPkgJson({ name: 'declared-pkg', berryAgent: { skills: ['skills'] } })); // 无 entry → declared-payload
    const outcome = await installPlugin(depsOf(dataDir, noopSpawn), `local:${src}`);
    expect(outcome.ok && outcome.entry.declaredEvents).toEqual([]);
  });

  it('events 坏形（非字符串数组）= 收割失败拒 + local 源不删用户目录', async () => {
    const dataDir = join(testRoot, 'data-c');
    const src = localFixture('badev', pluginPkgJson({ name: 'badev-pkg' }), `export const events = 'oops';\n`);
    const outcome = await installPlugin(depsOf(dataDir, noopSpawn), `local:${src}`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('词表账本容不得坏形');
    expect(existsSync(join(src, 'index.js'))).toBe(true); // local 直引永不删
    expect(entriesOf(dataDir).some((e) => e.id === 'badev-pkg')).toBe(false); // 坏形不落账
  });

  it('清单缺席（无 berryAgent 块）/ 目录无 package.json 拒', async () => {
    const dataDir = join(testRoot, 'data-c');
    const notPlugin = localFixture(
      'notplugin',
      `${JSON.stringify({ name: 'notplugin-pkg', version: '1.0.0' }, null, 2)}\n`,
    );
    const r1 = await installPlugin(depsOf(dataDir, noopSpawn), `local:${notPlugin}`);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.message).toContain('不是插件包');
    const empty = join(testRoot, 'fixture-empty');
    mkdirSync(empty, { recursive: true });
    const r2 = await installPlugin(depsOf(dataDir, noopSpawn), `local:${empty}`);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.message).toContain('装机目录无 package.json');
  });
});

describe('update 分派（§5.4 按源）', () => {
  it('local no-op（源动了下次装载即新）；查无拒', async () => {
    const dataDir = dataDirOf('data-update');
    // 自建 local fixture（default-export 入口 + events 导出——收割真跑过）
    const src = join(testRoot, 'fixture-update');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'package.json'), pluginPkgJson({ name: 'demo-pkg' }));
    writeFileSync(join(src, 'index.js'), INDEX_WITH_EVENTS);
    const noopSpawn: SpawnRunner = { run: () => Promise.reject(new Error('local 源不 spawn')) };
    await installPlugin(depsOf(dataDir, noopSpawn), `local:${src}`);
    const noop = await updatePlugin(depsOf(dataDir, noopSpawn), 'demo-pkg');
    expect(noop.ok).toBe(true);
    if (!noop.ok) return;
    expect(noop.text).toContain('no-op');
    const missing = await updatePlugin(depsOf(dataDir, noopSpawn), 'ghost-pkg');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.message).toContain('未装机');
  });

  it('npm 重装：换装豁免（旧条目在场不构成撞名）+ 新版本/integrity 落账 upsert 后见胜出', async () => {
    const dataDir = join(testRoot, 'data-update');
    // 先装 1.0.0（同目录撞名——独立包名）
    const rec1 = npmFakeSpawn(dataDir, { lockVersion: '1.0.0', pkgJson: pluginPkgJson({ name: 'upd-pkg' }) });
    await installPlugin(depsOf(dataDir, rec1.spawn), 'npm:upd-pkg');
    // 账本 ref 无版本形（latest 语义）——重装拉 2.0.0（manifest 与 lock 同步新版本）
    const rec2 = npmFakeSpawn(dataDir, {
      lockVersion: '2.0.0',
      pkgJson: pluginPkgJson({ name: 'upd-pkg', version: '2.0.0' }),
    });
    const updated = await updatePlugin(depsOf(dataDir, rec2.spawn), 'upd-pkg');
    expect(updated.ok).toBe(true); // 换装豁免位——修复前此处恒红（撞自家旧账）
    if (!updated.ok) return;
    expect(updated.entry.version).toBe('2.0.0');
    const after = entriesOf(dataDir).filter((e) => e.id === 'upd-pkg');
    expect(after).toHaveLength(1); // upsert 后见胜出非追加
    expect(after[0]!.version).toBe('2.0.0');
  });
});

describe('生命周期归因账落词（05 §1.1 audit 落账批——install/updated 两词）', () => {
  /** sink 收集器（词形断言面） */
  function collector(): {
    readonly calls: Array<{ readonly type: string; readonly data: Record<string, unknown> }>;
    readonly sink: LifecycleAuditSink;
  } {
    const calls: Array<{ type: string; data: Record<string, unknown> }> = [];
    return { calls, sink: (type, data) => void calls.push({ type, data }) };
  }

  /** local fixture 速记（本 describe 专用目录隔离） */
  function localFixture(name: string): string {
    const dir = join(testRoot, `fixture-audit-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), pluginPkgJson({ name: `audit-${name}-pkg`, version: '3.1.4' }));
    writeFileSync(join(dir, 'index.js'), INDEX_WITH_EVENTS);
    return dir;
  }
  const noopSpawn: SpawnRunner = { run: () => Promise.reject(new Error('local 源不 spawn')) };

  it('install 成功尾落 plugin/installed {id, source, version}', async () => {
    const src = localFixture('install');
    const rec = collector();
    const outcome = await installPlugin(
      depsOf(dataDirOf('data-audit-install'), noopSpawn, { onLifecycleAudit: rec.sink }),
      `local:${src}`,
    );
    expect(outcome.ok).toBe(true);
    expect(rec.calls).toEqual([
      { type: 'plugin/installed', data: { id: 'audit-install-pkg', source: 'local', version: '3.1.4' } },
    ]);
  });

  it('install 失败零调（npm spawn 败 = 无变更不造账）', async () => {
    const failing: SpawnRunner = { run: () => Promise.reject(new Error('command failed')) };
    const rec = collector();
    const outcome = await installPlugin(
      depsOf(dataDirOf('data-audit-fail'), failing, { onLifecycleAudit: rec.sink }),
      'npm:ghost-pkg',
    );
    expect(outcome.ok).toBe(false);
    expect(rec.calls).toEqual([]);
  });

  it('update npm 重装腿：只落 plugin/updated {id, from, to} 不落 installed（npm 腿剥 sink 防错词——回归锁：缺剥即先落 installed 错词）', async () => {
    const dataDir = dataDirOf('data-audit-update');
    const rec1 = npmFakeSpawn(dataDir, { lockVersion: '1.0.0', pkgJson: pluginPkgJson({ name: 'audit-upd-pkg' }) });
    const installCalls = collector();
    await installPlugin(depsOf(dataDir, rec1.spawn, { onLifecycleAudit: installCalls.sink }), 'npm:audit-upd-pkg');
    expect(installCalls.calls).toHaveLength(1); // 首装 installed
    const rec2 = npmFakeSpawn(dataDir, {
      lockVersion: '2.0.0',
      pkgJson: pluginPkgJson({ name: 'audit-upd-pkg', version: '2.0.0' }),
    });
    const updateCalls = collector();
    const updated = await updatePlugin(
      depsOf(dataDir, rec2.spawn, { onLifecycleAudit: updateCalls.sink }),
      'audit-upd-pkg',
    );
    expect(updated.ok).toBe(true);
    expect(updateCalls.calls).toEqual([
      { type: 'plugin/updated', data: { id: 'audit-upd-pkg', from: '1.0.0', to: '2.0.0' } },
    ]);
  });

  it('update local no-op 零调（源直引无变更不造账）', async () => {
    const src = localFixture('noop');
    const dataDir = dataDirOf('data-audit-noop');
    await installPlugin(depsOf(dataDir, noopSpawn), `local:${src}`);
    const rec = collector();
    const noop = await updatePlugin(depsOf(dataDir, noopSpawn, { onLifecycleAudit: rec.sink }), 'audit-noop-pkg');
    expect(noop.ok).toBe(true);
    expect(rec.calls).toEqual([]);
  });

  it('sink 缺席 = 零落账零异常（库件单机可用）', async () => {
    const src = localFixture('absent');
    const outcome = await installPlugin(depsOf(dataDirOf('data-audit-absent'), noopSpawn), `local:${src}`);
    expect(outcome.ok).toBe(true);
  });
});
