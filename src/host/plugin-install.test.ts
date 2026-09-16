/**
 * host/plugin-install 三源装机执行器测试（成熟度缺口 #10 装机面落码批 10b）。
 *
 * 覆盖：ref 词法全矩阵、min-release-age 三级解析（缺省/env/cliFlag 覆盖
 * + env 坏形 fail-loud）、npm 执行器假 spawn 编舞（argv 供应链四件套断言 +
 * 锚 package.json + lock 收割 + 失败指路 + 撞名拒 + core: 前缀拒 + 回滚）、
 * npm 失败两形分流（非旗标失败零指路 + 真拒装等窗龄指路——修前红形）、
 * git 执行器假 spawn 编舞（clone/checkout/rev-parse 三笔序 + tmp 清尾 +
 * 坏 ref 拒 + update 幂等重克隆）、local 源与收割真跑（本地 fixture 零网络
 * ——declaredEvents 收割/纯声明包零码收割/events 坏形拒）、update 分派三态
 * （local no-op/npm 重装换装豁免/查无拒）、生命周期归因账落词（05 §1.1）。
 *
 * 真盘 tmp 数据目录 + 真 fs 注入；spawn 全假件——npm/git 两执行器零真网络。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

/**
 * git 假 spawn：按 argv 前缀分派（runGitInstall 三笔编舞的逐笔应答）——
 * clone 在目标 tmp（argv 尾参）写真 fixture、checkout 记 argv 退 0、
 * rev-parse 记 argv 回 headCommit。headCommit/fail 可变（update 换代与
 * clone/checkout 失败用例注入）。git 腿 fixture 无 version 键——git 源账本
 * commit 即版本标识（manifest version 位「git 源可缺席」）。
 */
interface GitRecorder {
  readonly spawn: SpawnRunner;
  readonly argvLog: string[][];
  /** rev-parse 应答 commit（可变——update 用例换新值断言换代） */
  headCommit: string;
  /** 指定腿失败词面（clone/checkout 失败用例注入——message 承载词面） */
  readonly fail: { clone?: string; checkout?: string };
}

function gitFakeSpawn(opts: { readonly pkgJson?: string } = {}): GitRecorder {
  const argvLog: string[][] = [];
  const rec: GitRecorder = {
    argvLog,
    headCommit: 'fake-commit-1111',
    fail: {},
    spawn: {
      run: (cmd, args) => {
        argvLog.push([cmd, ...args]);
        if (cmd !== 'git') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
        /** 按注入词面构造非 0 退错误（stderr 同形——git 腿错误原样上浮 message 面） */
        const failErr = (stage: string, text: string): Error & { stderr: string } => {
          const err = new Error(`git ${stage} 退出非 0：${text}`) as Error & { stderr: string };
          err.stderr = text;
          return err;
        };
        if (args[0] === 'clone') {
          if (rec.fail.clone !== undefined) return Promise.reject(failErr('clone', rec.fail.clone));
          // clone 目标 = argv 尾参（runGitInstall 的 mkdtemp tmp）——写真 fixture
          const target = args[args.length - 1]!;
          mkdirSync(target, { recursive: true });
          writeFileSync(join(target, 'package.json'), opts.pkgJson ?? pluginPkgJson({ version: undefined }));
          writeFileSync(join(target, 'index.js'), INDEX_WITH_EVENTS);
          return Promise.resolve({ stdout: '', stderr: '' });
        }
        if (args[2] === 'checkout') {
          if (rec.fail.checkout !== undefined) return Promise.reject(failErr('checkout', rec.fail.checkout));
          return Promise.resolve({ stdout: '', stderr: '' });
        }
        if (args[2] === 'rev-parse') {
          return Promise.resolve({ stdout: `${rec.headCommit}\n`, stderr: '' });
        }
        return Promise.reject(new Error(`假 spawn 不识别 git 子命令：${args.join(' ')}`));
      },
    },
  };
  return rec;
}

/** git 克隆中转站残影清点（tmpRoot 下 berry-git-install-* 目录——finally rm 回归锁的断言面） */
function gitTmpResidue(root: string): string[] {
  return readdirSync(root).filter((name) => name.startsWith('berry-git-install-'));
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

describe('npm 失败两形分流（非旗标失败零指路 + 真拒装等窗龄指路）', () => {
  it('spawn 中途失败（非旗标形）：不给「升级 npm」指路 + 零落账；半装残影经重装收敛落账', async () => {
    const dataDir = dataDirOf('data-half');
    const pkg = 'half-pkg';
    const pkgDir = join(dataDir, 'plugins', 'node_modules', pkg);
    let fail = true; // 首发失败（网络中断形）→ 重试成功
    const spawn: SpawnRunner = {
      run: () => {
        if (fail) {
          const err = new Error('command failed') as Error & { stderr: string };
          err.stderr = 'npm error network tunnel closed';
          return Promise.reject(err);
        }
        // 成功形：仿真 npm 树替换语义（重装先清半装树再落全树——npm 幂等腿）
        rmSync(pkgDir, { recursive: true, force: true });
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'package.json'), pluginPkgJson({ name: pkg }));
        writeFileSync(join(pkgDir, 'index.js'), INDEX_WITH_EVENTS);
        writeFileSync(
          join(dataDir, 'plugins', '.package-lock.json'),
          JSON.stringify({ packages: { [`node_modules/${pkg}`]: { version: '1.0.0', integrity: 'sha512-half' } } }),
        );
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    };
    const deps = depsOf(dataDir, spawn);
    const failed = await installPlugin(deps, `npm:${pkg}`);
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    // 非旗标形失败：不命中 min-release-age 指路分支——零升级 hint（分流反断言）
    expect(failed.message).toContain('npm install 失败');
    expect(failed.message).not.toContain('≥11.5');
    expect(failed.message).not.toContain('npm 不识');
    expect(entriesOf(dataDir)).toHaveLength(0); // 失败零落账
    // 半装残影（spawn 中断遗留半 node_modules 树——无清理腿的现状行为）：
    // 重装成功后残影收敛（npm 树替换）+ 落账恰一条
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'half.txt'), '半装残影');
    fail = false;
    const retried = await installPlugin(deps, `npm:${pkg}`);
    expect(retried.ok).toBe(true);
    expect(entriesOf(dataDir).map((e) => e.id)).toEqual([pkg]);
    expect(existsSync(join(pkgDir, 'half.txt'))).toBe(false); // 残影收敛
    expect(existsSync(join(pkgDir, 'package.json'))).toBe(true); // 全树落位
  });

  it('npm 真拒装（窗龄未满）：等窗龄/调窗指路、不给「升级 npm」误诊（修前红——现实现同词面误走旗标不识分支）', async () => {
    const dataDir = dataDirOf('data-eligible');
    const spawn: SpawnRunner = {
      run: () => {
        // npm ≥11.5 真拒装报文：包龄不满静置窗——词面含 eligible 且常伴
        // --min-release-age 字面（正是误诊源：旧分支按 min-release-age 字面
        // 命中「npm 不识旗标」升级指路）
        const err = new Error('command failed') as Error & { stderr: string };
        err.stderr =
          'npm error eligible-pkg@1.0.0 not yet eligible: published 2 hours ago is within --min-release-age 1440';
        return Promise.reject(err);
      },
    };
    const outcome = await installPlugin(depsOf(dataDir, spawn), 'npm:eligible-pkg');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('npm install 失败');
    expect(outcome.message).toContain('等发布窗龄'); // 等窗龄指路
    expect(outcome.message).toContain(MIN_RELEASE_AGE_ENV); // 调窗指路
    expect(outcome.message).not.toContain('≥11.5'); // 分流反断言（修前红位）
    expect(outcome.message).not.toContain('npm 不识');
    expect(entriesOf(dataDir)).toHaveLength(0); // 拒装零落账
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

describe('git 执行器编舞（假 spawn——clone/checkout/rev-parse 零真网络）', () => {
  /** 本 describe 专用：数据目录 + git 克隆中转站 tmpRoot（mkdtemp 前提父目录在场） */
  function gitDirs(name: string): { readonly dataDir: string; readonly gitTmp: string } {
    const dataDir = dataDirOf(`data-git-${name}`);
    const gitTmp = join(testRoot, `git-tmp-${name}`);
    mkdirSync(gitTmp, { recursive: true });
    return { dataDir, gitTmp };
  }

  it('全链：clone→checkout --detach ref→rev-parse 三笔序 + commit 落账（version 位缺席）', async () => {
    const { dataDir, gitTmp } = gitDirs('a');
    const rec = gitFakeSpawn();
    const outcome = await installPlugin(
      depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }),
      'git:https://github.com/o/r.git#v1.2.0',
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // argv 恰三笔且序为：clone url → -C <tmp> checkout --detach <ref> → -C <tmp> rev-parse HEAD
    const tmp = rec.argvLog[0]?.[3];
    expect(tmp).toBeDefined();
    expect(tmp!.startsWith(join(gitTmp, 'berry-git-install-'))).toBe(true);
    expect(rec.argvLog).toEqual([
      ['git', 'clone', 'https://github.com/o/r.git', tmp],
      ['git', '-C', tmp, 'checkout', '--detach', 'v1.2.0'],
      ['git', '-C', tmp, 'rev-parse', 'HEAD'],
    ]);
    // 账本条目：git 源 commit 即版本标识（version/integrity 位缺席）
    expect(outcome.entry).toMatchObject({
      id: 'demo-pkg',
      source: 'git',
      ref: 'git:https://github.com/o/r.git#v1.2.0',
      commit: 'fake-commit-1111',
      installPath: join('plugins', 'git', 'github.com', 'o', 'r'),
      declaredEvents: ['demo/event-a', 'demo/event-b'],
    });
    expect(outcome.entry.version).toBeUndefined();
    // tmp 已随 rename 搬空 + 装机树落位（tmp→target 真目录搬家）
    expect(gitTmpResidue(gitTmp)).toEqual([]);
    expect(existsSync(join(dataDir, 'plugins', 'git', 'github.com', 'o', 'r', 'index.js'))).toBe(true);
  });

  it('clone 失败：拒（词面上浮）+ tmp 清尾（finally rm 回归锁）+ 零落账', async () => {
    const { dataDir, gitTmp } = gitDirs('b');
    const rec = gitFakeSpawn();
    rec.fail.clone = 'fatal: repository https://github.com/o/missing.git/ not found';
    const outcome = await installPlugin(
      depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }),
      'git:https://github.com/o/missing.git',
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('fatal: repository'); // git 腿错误原样上浮
    expect(rec.argvLog).toHaveLength(1); // clone 即败——checkout/rev-parse 不发
    expect(gitTmpResidue(gitTmp)).toEqual([]); // finally rm 清尾
    expect(entriesOf(dataDir)).toHaveLength(0);
  });

  it('坏 ref：checkout 失败拒 + tmp 清尾 + 目标未建（mkdir 在 rev-parse 后）', async () => {
    const { dataDir, gitTmp } = gitDirs('c');
    const rec = gitFakeSpawn();
    rec.fail.checkout = 'fatal: invalid reference: no-such-tag';
    const outcome = await installPlugin(
      depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }),
      'git:https://github.com/o/r.git#no-such-tag',
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('invalid reference');
    expect(rec.argvLog).toHaveLength(2); // clone 过、checkout 败——rev-parse 不发
    expect(gitTmpResidue(gitTmp)).toEqual([]);
    // 目标目录未建（runGitInstall 的 mkdir/rm/rename 全在 rev-parse 之后）
    expect(existsSync(join(dataDir, 'plugins', 'git', 'github.com', 'o', 'r'))).toBe(false);
    expect(entriesOf(dataDir)).toHaveLength(0);
  });

  it('幂等重克隆（update 腿）：目标在场先 rm 再落新树——账本恰一条且 commit 换新', async () => {
    const { dataDir, gitTmp } = gitDirs('d');
    const rec = gitFakeSpawn();
    await installPlugin(depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }), 'git:https://github.com/o/r.git#v1.2.0');
    rec.headCommit = 'fake-commit-2222'; // 上游前进（同一假仓 HEAD 换新）
    const updated = await updatePlugin(depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }), 'demo-pkg');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    // upsert 后见胜出：账本恰一条且 commit 为新值（旧树 rm + 新树 rename 换代）
    const after = entriesOf(dataDir).filter((e) => e.id === 'demo-pkg');
    expect(after).toHaveLength(1);
    expect(after[0]!.commit).toBe('fake-commit-2222');
    expect(updated.entry.commit).toBe('fake-commit-2222');
    // 两轮各三笔编舞 + tmp 无残影 + 落位树在场
    expect(rec.argvLog).toHaveLength(6);
    expect(gitTmpResidue(gitTmp)).toEqual([]);
    expect(existsSync(join(dataDir, 'plugins', 'git', 'github.com', 'o', 'r', 'package.json'))).toBe(true);
  });
});

describe('市场拷贝腿与 market 注记（03 §9.6 mp-3——装机咬合）', () => {
  /** 拷贝腿专用：市场仓 fixture（子目录插件声明载荷形——零 jiti 收割） */
  function marketRepoFixture(name: string): string {
    const root = join(testRoot, `market-repo-${name}`);
    const pluginDir = join(root, 'plugins', 'hello');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      pluginPkgJson({ name: 'hello-plugin', berryAgent: { id: 'hello-plugin', skills: ['greet'] } }),
    );
    writeFileSync(join(root, 'README.md'), 'market repo');
    return root;
  }

  const noopSpawn: SpawnRunner = { run: () => Promise.reject(new Error('拷贝腿缓存直拷不 spawn')) };
  const market = { name: 'alpha', entry: 'hello-plugin' };

  it('local ref + subdirCopy：market 段落位 + market 注记落账 + 账本读写往返保留（checkEntryShape 锁）', async () => {
    const dataDir = dataDirOf('market-copy');
    const repo = marketRepoFixture('a');
    const outcome = await installPlugin(depsOf(dataDir, noopSpawn), `local:${repo}`, {
      market,
      subdirCopy: { subpath: 'plugins/hello' },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entry.installPath).toBe(join('plugins', 'market', 'alpha', 'hello-plugin')); // 相对表示形
    expect(outcome.entry.source).toBe('local');
    expect(outcome.entry.market).toEqual(market);
    // 拷贝腿真拷贝：装机树在场（子目录内容），非直引
    expect(existsSync(join(dataDir, 'plugins', 'market', 'alpha', 'hello-plugin', 'package.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'plugins', 'market', 'alpha', 'hello-plugin', 'README.md'))).toBe(false); // 只拷子目录
    // 账本往返：market 字段经 checkEntryShape 重建保留（缺席 = 读写往返丢失）
    const roundtrip = entriesOf(dataDir);
    expect(roundtrip[0]!.market).toEqual(market);
  });

  it('拷贝腿幂等重装：目标在场先 rm 再落新树（无版本段布局）', async () => {
    const dataDir = dataDirOf('market-reinstall');
    const repo = marketRepoFixture('b');
    const deps = depsOf(dataDir, noopSpawn);
    const first = await installPlugin(deps, `local:${repo}`, { market, subdirCopy: { subpath: 'plugins/hello' } });
    expect(first.ok).toBe(true);
    // 源换代后重装：rm 重放（目录换新不叠残影）
    writeFileSync(
      join(repo, 'plugins', 'hello', 'package.json'),
      pluginPkgJson({ name: 'hello-plugin', version: '2.0.0', berryAgent: { id: 'hello-plugin', skills: ['greet'] } }),
    );
    const second = await installPlugin(deps, `local:${repo}`, { market, subdirCopy: { subpath: 'plugins/hello' } });
    expect(second.ok).toBe(true);
    const after = entriesOf(dataDir).filter((e) => e.id === 'hello-plugin');
    expect(after).toHaveLength(1); // 撞名律照旧——upsert 后见胜出
    expect(after[0]!.version).toBe('2.0.0');
  });

  it('防御位拒谱：npm 源 + subdirCopy / 缺 market 注记 / subpath 逃逸 / 名段坏词法', async () => {
    const dataDir = dataDirOf('market-defenses');
    const repo = marketRepoFixture('c');
    const deps = depsOf(dataDir, noopSpawn);
    // npm 源与拷贝腿组合结构性不可达（翻译层恒 direct）——防御位拒
    const npmRef = await installPlugin(deps, 'npm:any-pkg', {
      market,
      subdirCopy: { subpath: 'plugins/hello' },
    });
    expect(npmRef.ok).toBe(false);
    if (!npmRef.ok) expect(npmRef.message).toContain('npm');
    // 拷贝腿布局段需要 market 名段——缺席拒
    const noMarket = await installPlugin(deps, `local:${repo}`, { subdirCopy: { subpath: 'plugins/hello' } });
    expect(noMarket.ok).toBe(false);
    if (!noMarket.ok) expect(noMarket.message).toContain('market');
    // subpath 段逃逸（'..' 出界）拒——布局路径注入防线本件复验位
    const escape = await installPlugin(deps, `local:${repo}`, {
      market,
      subdirCopy: { subpath: '../../etc' },
    });
    expect(escape.ok).toBe(false);
    if (!escape.ok) expect(escape.message).toContain('逃逸');
    // market 名段坏词法（路径注入）拒
    const badName = await installPlugin(deps, `local:${repo}`, {
      market: { name: '../evil', entry: 'hello-plugin' },
      subdirCopy: { subpath: 'plugins/hello' },
    });
    expect(badName.ok).toBe(false);
  });

  it('拷贝源目录缺席 = 诚实拒（指路 remove 后重新 add——缓存坏形不猜）', async () => {
    const dataDir = dataDirOf('market-src-gone');
    const repo = marketRepoFixture('d');
    const outcome = await installPlugin(depsOf(dataDir, noopSpawn), `local:${repo}`, {
      market,
      subdirCopy: { subpath: 'plugins/not-exist' },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('not-exist');
      expect(outcome.message).toContain('remove');
    }
  });

  it('账本 market 字段坏形 = 整账本 fail-loud（readLedger invalid）', async () => {
    const dataDir = dataDirOf('market-bad-ledger');
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    // 手铸坏形账本：market 非对象形（词法纪律——新字段进坏形拒绝式）
    writeFileSync(
      ledgerPath(dataDir),
      JSON.stringify([
        {
          id: 'x',
          source: 'local',
          ref: 'local:/x',
          installedAt: '2026-09-16T00:00:00.000Z',
          installPath: '/x',
          declaredEvents: [],
          market: 'not-an-object',
        },
      ]),
    );
    const read = readLedger(dataDir, createPluginStoreFs());
    expect(read.ok).toBe(false);
  });

  it('update npm 腿 provenance 幸存：market 注记随重装透传（修前红——字段丢失形）', async () => {
    const dataDir = dataDirOf('market-update-npm');
    const rec = npmFakeSpawn(dataDir);
    const deps = depsOf(dataDir, rec.spawn);
    const installed = await installPlugin(deps, 'npm:demo-pkg', {
      market: { name: 'alpha', entry: 'demo-pkg' },
    });
    expect(installed.ok && installed.entry.market).toEqual({ name: 'alpha', entry: 'demo-pkg' });
    const updated = await updatePlugin(deps, 'demo-pkg');
    expect(updated.ok).toBe(true);
    const after = entriesOf(dataDir).find((e) => e.id === 'demo-pkg');
    expect(after!.market).toEqual({ name: 'alpha', entry: 'demo-pkg' }); // 换装后 provenance 不丢
  });

  it('update local 市场条目 no-op 指路重装动词（marketplace install——非直引语义）', async () => {
    const dataDir = dataDirOf('market-update-local');
    const repo = marketRepoFixture('e');
    const deps = depsOf(dataDir, noopSpawn);
    const installed = await installPlugin(deps, `local:${repo}`, {
      market,
      subdirCopy: { subpath: 'plugins/hello' },
    });
    expect(installed.ok).toBe(true);
    const updated = await updatePlugin(deps, 'hello-plugin');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    // B2 拷贝腿非直引——no-op 文案指路 marketplace install（诚实面：直引语义不适用）
    expect(updated.text).toContain('marketplace install');
  });
});

describe('market 拷贝腿 update 分派（03 §9.6 mp-3——拷贝参数不入账本）', () => {
  /** git-subdir 克隆假 spawn：clone 尾参位写子目录 fixture */
  function subdirCloneSpawn(subpath: string): SpawnRunner {
    return {
      run: (cmd, args) => {
        if (cmd !== 'git') return Promise.reject(new Error(`假 spawn 不受理 ${cmd}`));
        if (args[0] === 'clone') {
          const cloneDir = args[args.length - 1]!;
          mkdirSync(join(cloneDir, ...subpath.split('/')), { recursive: true });
          writeFileSync(
            join(cloneDir, ...subpath.split('/'), 'package.json'),
            pluginPkgJson({ berryAgent: { id: 'hello-plugin', skills: ['greet'] } }),
          );
          return Promise.resolve({ stdout: '', stderr: '' });
        }
        if (args[2] === 'rev-parse') return Promise.resolve({ stdout: 'cafebabe77\n', stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    };
  }

  it('git 拷贝腿装机物 update 拒——指路 marketplace install 重装（拷贝参数不可复算）', async () => {
    const dataDir = dataDirOf('market-update-git-copy');
    const deps = depsOf(dataDir, subdirCloneSpawn('packages/hello'));
    const installed = await installPlugin(deps, 'git:https://example.com/o/monorepo.git#deadbeef', {
      market: { name: 'sub', entry: 'hello-plugin' },
      subdirCopy: { subpath: 'packages/hello' },
    });
    expect(installed.ok).toBe(true);
    const updated = await updatePlugin(deps, 'hello-plugin');
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.message).toContain('marketplace install');
  });
});
