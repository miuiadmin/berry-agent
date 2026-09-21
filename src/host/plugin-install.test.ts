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
import { createPluginStoreFs, ledgerPath, mountRow, readEnabledRowsForEdit, readLedger } from './plugin-store.js';
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

/** 执行器 deps 速记（真 fs + 注入 spawn；DNS 位缺省公网桩——git 腿主机校验零真网络） */
function depsOf(dataDir: string, spawn: SpawnRunner, extra: Partial<InstallExecutorDeps> = {}): InstallExecutorDeps {
  return {
    dataDir,
    fs: createPluginStoreFs(),
    spawn,
    // git 腿 SSRF 主机校验的 DNS 解析位——缺省公网应答桩（93.184.216.34 非
    // 私网非保留段；私网拒腿用例另注入私网应答覆盖）
    resolveDns: () => Promise.resolve(['93.184.216.34']),
    ...extra,
  };
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

function gitFakeSpawn(opts: { readonly pkgJson?: string; readonly indexJs?: string } = {}): GitRecorder {
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
          //（indexJs 可注入坏入口——收割失败腿构造真求值抛，非重写已缓存入口）
          const target = args[args.length - 1]!;
          mkdirSync(target, { recursive: true });
          writeFileSync(join(target, 'package.json'), opts.pkgJson ?? pluginPkgJson({ version: undefined }));
          writeFileSync(join(target, 'index.js'), opts.indexJs ?? INDEX_WITH_EVENTS);
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

describe('npm 更新腿失败回迁旧树（修笔——先删后装失败 = 装机树尽失坏态）', () => {
  /** 备份位残影清点（plugins/ 下 .npm-update-bak-* 目录——回迁/清场回归锁断言面） */
  function backupResidue(dataDir: string): string[] {
    return readdirSync(join(dataDir, 'plugins')).filter((n) => n.startsWith('.npm-update-bak-'));
  }

  /** 预装旧树速记：1.0.0 装机成功（返回旧树路径与旧 package.json 原文——回迁断言锚） */
  async function seedOldTree(
    dataDir: string,
    pkgName: string,
    seedPkgJson?: string,
  ): Promise<{ tree: string; pkgJson: string }> {
    const rec = npmFakeSpawn(dataDir, {
      lockVersion: '1.0.0',
      pkgJson: seedPkgJson ?? pluginPkgJson({ name: pkgName }),
    });
    const outcome = await installPlugin(depsOf(dataDir, rec.spawn), `npm:${pkgName}`);
    expect(outcome.ok).toBe(true);
    const tree = join(dataDir, 'plugins', 'node_modules', pkgName);
    return { tree, pkgJson: readFileSync(join(tree, 'package.json'), 'utf8') };
  }

  it('npm 抛网络错（update 最常见失败形）：旧树回迁原位 + 账本自洽 + 备份零残影——修前红（旧树被 rm 尽失）', async () => {
    const dataDir = dataDirOf('data-upd-fail-net');
    const { tree, pkgJson } = await seedOldTree(dataDir, 'failnet-pkg');
    // 假 npm spawn 网络断形（reject 带 stderr——npm 腿错误词面上浮面）
    const netErr = new Error('npm ERR! network request failed') as Error & { stderr: string };
    netErr.stderr = 'npm ERR! network request failed';
    const outcome = await updatePlugin(depsOf(dataDir, { run: () => Promise.reject(netErr) }), 'failnet-pkg');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // 修前红点：旧树 package.json 尽失（账本引用悬空 → 装载行级隔离降级）；
    // 修后：旧树原文回迁（装载判据 package.json 在场——旧版继续可用）
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    // 账本条目原样保留（引用旧树自洽——enabled 行/账本全程未动）
    const after = entriesOf(dataDir).filter((e) => e.id === 'failnet-pkg');
    expect(after).toHaveLength(1);
    expect(after[0]!.version).toBe('1.0.0');
    // 备份位零残影（回迁即清场）+ 回迁事实有呈现（message 尾注）
    expect(backupResidue(dataDir)).toEqual([]);
    expect(outcome.message).toContain('回迁');
  });

  it('新树清单拒：旧树回迁（同根三失败路径之二）——修前红', async () => {
    const dataDir = dataDirOf('data-upd-fail-manifest');
    const { tree, pkgJson } = await seedOldTree(dataDir, 'failman-pkg');
    // 假 npm「成功」但写出坏形产物（无 berryAgent 块）→ 清单校验拒 + rollbackInstall
    const badManifestSpawn: SpawnRunner = {
      run: (_cmd, args) => {
        const spec = args[args.length - 1]!;
        const pkgDir = join(dataDir, 'plugins', 'node_modules', ...spec.split('/'));
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'package.json'), `${JSON.stringify({ name: 'failman-pkg', version: '9.9.9' })}\n`);
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    };
    const outcome = await updatePlugin(depsOf(dataDir, badManifestSpawn), 'failman-pkg');
    expect(outcome.ok).toBe(false);
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    expect(backupResidue(dataDir)).toEqual([]);
    expect(entriesOf(dataDir).some((e) => e.id === 'failman-pkg')).toBe(true);
  });

  it('收割失败（新入口求值抛）：旧树回迁（同根三失败路径之三）——修前红', async () => {
    const dataDir = dataDirOf('data-upd-fail-harvest');
    // seed 装纯声明包（零码收割——入口路径从未被求值，规避 jiti/Node 进程级
    // 模块缓存命中旧模块的假形：收割缓存命中会静默成功，失败路径测不到）
    const { tree, pkgJson } = await seedOldTree(
      dataDir,
      'failharv-pkg',
      pluginPkgJson({ name: 'failharv-pkg', berryAgent: { skills: ['skills'] } }),
    );
    // 假 npm「成功」写合法清单（default-export 形）+ 求值即抛的入口 → 收割失败拒
    const badHarvestSpawn: SpawnRunner = {
      run: (_cmd, args) => {
        const spec = args[args.length - 1]!;
        const pkgDir = join(dataDir, 'plugins', 'node_modules', ...spec.split('/'));
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(join(pkgDir, 'package.json'), pluginPkgJson({ name: 'failharv-pkg', version: '9.9.9' }));
        writeFileSync(join(pkgDir, 'index.js'), 'throw new Error("harvest-boom");\n');
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    };
    const outcome = await updatePlugin(depsOf(dataDir, badHarvestSpawn), 'failharv-pkg');
    expect(outcome.ok).toBe(false);
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    expect(backupResidue(dataDir)).toEqual([]);
  });

  it('成功腿备份清场：update 成功后 plugins/ 无 .npm-update-bak-* 残影（修后锁）', async () => {
    const dataDir = dataDirOf('data-upd-ok');
    await seedOldTree(dataDir, 'updok-pkg');
    const rec = npmFakeSpawn(dataDir, {
      lockVersion: '2.0.0',
      pkgJson: pluginPkgJson({ name: 'updok-pkg', version: '2.0.0' }),
    });
    const updated = await updatePlugin(depsOf(dataDir, rec.spawn), 'updok-pkg');
    expect(updated.ok).toBe(true);
    expect(backupResidue(dataDir)).toEqual([]);
  });
});

describe('npm 更新腿直装清单 id 漂移拒（修笔——git 腿同款防线；市场注记腿换血不辖）', () => {
  it('直装条目更新出新清单 id：拒 + 撤新账 + 旧树回迁 + 零审计词——修前红（ok:true 且账本双条目）', async () => {
    const dataDir = dataDirOf('data-upd-npm-drift');
    // CLI 直装（无 market 注记）首装：manifest id = drift-src-pkg
    const rec1 = npmFakeSpawn(dataDir, {
      lockVersion: '1.0.0',
      pkgJson: pluginPkgJson({ name: 'drift-src-pkg' }),
    });
    await installPlugin(depsOf(dataDir, rec1.spawn), 'npm:drift-src-pkg');
    const tree = join(dataDir, 'plugins', 'node_modules', 'drift-src-pkg');
    const oldPkgJson = readFileSync(join(tree, 'package.json'), 'utf8');
    // 上游新版清单 id 漂移（name → drift-new-pkg；账本 ref 不变 → 新树落同位）
    const rec2 = npmFakeSpawn(dataDir, {
      lockVersion: '2.0.0',
      pkgJson: pluginPkgJson({ name: 'drift-new-pkg', version: '2.0.0' }),
    });
    const audit: Array<{ readonly type: string; readonly data: Record<string, unknown> }> = [];
    const outcome = await updatePlugin(
      depsOf(dataDir, rec2.spawn, { onLifecycleAudit: (type, data) => void audit.push({ type, data }) }),
      'drift-src-pkg',
    );
    // 修前红点①：installPlugin 撞名检查对 replacingId 豁免 → 新 id 畅通 upsert、
    // 回执「已更新」；修后：git 腿同款漂移拒
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('漂移拒');
      expect(outcome.message).toContain('两步');
    }
    // 修前红点②：新 id upsert + 旧 id 条目残留 = 双条目同指同树（list 双计 +
    // 陈旧条目可 mount + 审计 id 错位）；修后：撤新账、单条目（旧条目原样）
    const after = entriesOf(dataDir);
    expect(after.map((e) => e.id)).toEqual(['drift-src-pkg']);
    expect(after[0]!.version).toBe('1.0.0');
    // 旧树回迁原位（新树已清，内容 = 旧 package.json 原文——装载判据在场）
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(oldPkgJson);
    // 漂移拒非换装成功——updated 审计词不落（修前落词且 id 错位：词面旧 id、
    // 账本却是新 id）
    expect(audit).toEqual([]);
    // 备份位零残影（回迁即清场）
    expect(readdirSync(join(dataDir, 'plugins')).filter((n) => n.startsWith('.npm-update-bak-'))).toEqual([]);
  });

  it('市场注记腿同形漂移照走换血（漂移拒仅辖直装腿——撤账随迁 sanctioned 的 gate 锁）', async () => {
    const dataDir = dataDirOf('data-upd-npm-drift-market');
    const m = { name: 'legs', entry: 'demo-pkg' };
    const rec1 = npmFakeSpawn(dataDir, { pkgJson: pluginPkgJson({ name: 'mkt-drift-pkg' }) });
    await installPlugin(depsOf(dataDir, rec1.spawn), 'npm:mkt-drift-pkg', { market: m });
    // 同 provenance 换代：新版清单 id 漂移（mkt-drift-pkg → mkt-drift-next）——
    // installPlugin 换血撤账位（marketReplacing）可达，漂移属 sanctioned 换血
    const rec2 = npmFakeSpawn(dataDir, {
      lockVersion: '2.0.0',
      pkgJson: pluginPkgJson({ name: 'mkt-drift-next', version: '2.0.0' }),
    });
    const outcome = await updatePlugin(depsOf(dataDir, rec2.spawn), 'mkt-drift-pkg');
    expect(outcome.ok).toBe(true);
    const after = entriesOf(dataDir);
    expect(after.map((e) => e.id)).toEqual(['mkt-drift-next']);
    expect(after[0]!.market).toEqual(m); // provenance 幸存
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

  it('直装腿私网豁免锁（§9.6 market 腿裁决——market 注记缺席 = 用户手打显式动作，SSRF 守卫不辖）', async () => {
    const { dataDir, gitTmp } = gitDirs('sec-exempt');
    const rec = gitFakeSpawn();
    // 私网字面 url：market 腿会拒（install.test.ts 守卫谱）；直装腿照发 clone
    const outcome = await installPlugin(
      depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }),
      'git:http://169.254.169.254/a/b.git',
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(rec.argvLog[0]?.slice(0, 3)).toEqual(['git', 'clone', 'http://169.254.169.254/a/b.git']);
    expect(outcome.entry).toMatchObject({ id: 'demo-pkg', source: 'git' });
  });
});

describe('git 更新腿失败回迁旧树（修笔——runGitInstall 克隆成功后 rm 旧树先行，校验期失败两树俱失；npm 腿 d661ed4 同律泛化）', () => {
  /** 本 describe 专用：数据目录 + git 克隆中转站 tmpRoot（mkdtemp 前提父目录在场） */
  function gitDirs(name: string): { readonly dataDir: string; readonly gitTmp: string } {
    const dataDir = dataDirOf(`data-git-upd-${name}`);
    const gitTmp = join(testRoot, `git-tmp-upd-${name}`);
    mkdirSync(gitTmp, { recursive: true });
    return { dataDir, gitTmp };
  }

  /** git 备份位残影清点（plugins/ 下 .git-update-bak-* 目录——回迁/清场回归锁断言面） */
  function gitBackupResidue(dataDir: string): string[] {
    return readdirSync(join(dataDir, 'plugins')).filter((n) => n.startsWith('.git-update-bak-'));
  }

  /**
   * 预装健康旧树速记：git 直装成功（返回旧树路径与旧 package.json 原文——
   * 回迁断言锚）。pkgJson 可注入纯声明包形（收割失败腿用——seed 零码收割，
   * 规避 jiti/Node 进程级模块缓存：入口从未被求值即无缓存条目，新版坏入口
   * 的求值抛才是真收割失败，非缓存命中的静默成功）。
   */
  async function seedGitOldTree(
    dataDir: string,
    gitTmp: string,
    pkgJson?: string,
  ): Promise<{ tree: string; pkgJson: string }> {
    const rec = gitFakeSpawn(pkgJson === undefined ? {} : { pkgJson });
    const outcome = await installPlugin(
      depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }),
      'git:https://github.com/o/r.git#v1.2.0',
    );
    expect(outcome.ok).toBe(true);
    const tree = join(dataDir, 'plugins', 'git', 'github.com', 'o', 'r');
    return { tree, pkgJson: readFileSync(join(tree, 'package.json'), 'utf8') };
  }

  it('更新后清单校验失败：旧树回迁原位 + 备份零残影——修前红（旧树被 rm 尽失）', async () => {
    const { dataDir, gitTmp } = gitDirs('fail-manifest');
    const { tree, pkgJson } = await seedGitOldTree(dataDir, gitTmp);
    // 上游新 commit 清单改坏（berryAgent 块被删）→ 克隆成功、清单校验败
    const bad = gitFakeSpawn({
      pkgJson: `${JSON.stringify({ name: 'demo-pkg', version: '9.9.9', main: 'index.js' }, null, 2)}\n`,
    });
    const outcome = await updatePlugin(depsOf(dataDir, bad.spawn, { tmpRoot: gitTmp }), 'demo-pkg');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('清单校验失败');
    // 修前红点：runGitInstall 克隆成功后先 rm 旧树（唯一可用副本）再 rename
    // 新树，清单校验败只 rollbackInstall 删新树 → 两树俱失、账本悬空引用；
    // 修后：旧树原文回迁（装载判据 package.json 在场——旧版继续可用）
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    expect(outcome.message).toContain('回迁');
    expect(gitBackupResidue(dataDir)).toEqual([]);
    // 账本条目原样保留（引用旧树自洽——enabled 行/账本全程未动）
    expect(entriesOf(dataDir).map((e) => e.id)).toEqual(['demo-pkg']);
  });

  it('更新后清单 id 漂移拒：旧树回迁原位——修前红（拒照拒但旧树尽失）', async () => {
    const { dataDir, gitTmp } = gitDirs('drift');
    const { tree, pkgJson } = await seedGitOldTree(dataDir, gitTmp);
    // 上游清单换代改名（manifest id demo-pkg → drifted-pkg）→ 漂移拒路径
    const drift = gitFakeSpawn({ pkgJson: pluginPkgJson({ name: 'drifted-pkg', version: undefined }) });
    const outcome = await updatePlugin(depsOf(dataDir, drift.spawn, { tmpRoot: gitTmp }), 'demo-pkg');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('漂移拒');
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    expect(gitBackupResidue(dataDir)).toEqual([]);
  });

  it('更新收割失败（坏入口求值抛）：旧树回迁——修前红；seed 纯声明包规避 jiti 进程级模块缓存', async () => {
    const { dataDir, gitTmp } = gitDirs('fail-harvest');
    const { tree, pkgJson } = await seedGitOldTree(
      dataDir,
      gitTmp,
      pluginPkgJson({ name: 'demo-pkg', version: undefined, berryAgent: { skills: ['skills'] } }),
    );
    // 上游新版换执行入口形（berryAgent 空块 → default-export）+ 求值即抛 → 收割失败拒
    const bad = gitFakeSpawn({
      pkgJson: pluginPkgJson({ name: 'demo-pkg', version: '9.9.9' }),
      indexJs: 'throw new Error("git-harvest-boom");\n',
    });
    const outcome = await updatePlugin(depsOf(dataDir, bad.spawn, { tmpRoot: gitTmp }), 'demo-pkg');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('收割失败');
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    expect(gitBackupResidue(dataDir)).toEqual([]);
  });

  it('克隆失败（staging 后）：旧树回迁不因 staging 引入新损失面——修后锁（修前 tmp 克隆先行本就不动旧树）', async () => {
    const { dataDir, gitTmp } = gitDirs('clone-fail');
    const { tree, pkgJson } = await seedGitOldTree(dataDir, gitTmp);
    const failRec = gitFakeSpawn();
    failRec.fail.clone = 'fatal: 无法访问仓库';
    const outcome = await updatePlugin(depsOf(dataDir, failRec.spawn, { tmpRoot: gitTmp }), 'demo-pkg');
    expect(outcome.ok).toBe(false);
    // staging 把旧树走位到备份位后克隆才失败——回迁须归位（不归位 = 旧树搁浅
    // 备份位，账本同悬空）
    expect(existsSync(join(tree, 'package.json')), '旧树应回迁在场').toBe(true);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toBe(pkgJson);
    expect(gitBackupResidue(dataDir)).toEqual([]);
  });

  it('成功腿备份清场：git update 成功后 plugins/ 无 .git-update-bak-* 残影 + 账本 commit 换新', async () => {
    const { dataDir, gitTmp } = gitDirs('ok');
    const rec = gitFakeSpawn();
    await installPlugin(depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }), 'git:https://github.com/o/r.git#v1.2.0');
    rec.headCommit = 'fake-commit-3333'; // 上游前进
    const updated = await updatePlugin(depsOf(dataDir, rec.spawn, { tmpRoot: gitTmp }), 'demo-pkg');
    expect(updated.ok).toBe(true);
    expect(gitBackupResidue(dataDir)).toEqual([]);
    expect(entriesOf(dataDir)[0]!.commit).toBe('fake-commit-3333');
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

  it('境三克隆失败：cloneTmp 失败位自清（berry-market-clone-* 零残影——修前红：三笔 spawn 在清场保护外）', async () => {
    const dataDir = dataDirOf('market-clone-fail');
    const cloneTmpRoot = join(testRoot, 'market-clone-tmp-root');
    mkdirSync(cloneTmpRoot, { recursive: true });
    // git 网络失败形：clone 首笔即拒（仓库 404 / 网络不可达 / 认证失败同族）
    const failing: SpawnRunner = {
      run: () => Promise.reject(new Error('fatal: 无法解析主机 missing.example.com')),
    };
    const outcome = await installPlugin(
      depsOf(dataDir, failing, { tmpRoot: cloneTmpRoot }),
      'git:https://missing.example.com/o/monorepo.git',
      { market: { name: 'sub', entry: 'hello-plugin' }, subdirCopy: { subpath: 'packages/hello' } },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('无法解析主机'); // git 腿错误原样上浮
    // 克隆失败位 tmp 自清——与 runGitInstall finally 清场同律（每次失败泄一个即缺口）
    expect(readdirSync(cloneTmpRoot).filter((name) => name.startsWith('berry-market-clone-'))).toEqual([]);
  });

  it('市场换血腿形切换（npm→拷贝腿·id 稳定）：旧装机位连带清零残影（修前红——installPath 落位变化形）', async () => {
    const dataDir = dataDirOf('market-leg-switch');
    // 先装 npm 腿（manifest id = demo-pkg）带市场溯源注记
    const rec = npmFakeSpawn(dataDir);
    const first = await installPlugin(depsOf(dataDir, rec.spawn), 'npm:demo-pkg', {
      market: { name: 'legs', entry: 'demo-pkg' },
    });
    expect(first.ok).toBe(true);
    // 市场 catalog 同名条目换源形（npm 对象源 → 相对串）：id 不漂移、装机腿换
    // 拷贝腿、installPath 换位（node_modules → plugins/market 段）
    const repo = join(testRoot, 'market-leg-switch-repo');
    const pluginDir = join(repo, 'plugins', 'hello');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      pluginPkgJson({ name: 'demo-pkg', berryAgent: { id: 'demo-pkg', skills: ['greet'] } }),
    );
    const second = await installPlugin(depsOf(dataDir, noopSpawn), `local:${repo}`, {
      market: { name: 'legs', entry: 'demo-pkg' },
      subdirCopy: { subpath: 'plugins/hello' },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // 账本恰一条（id 稳定 → upsert 覆盖）且指向新拷贝腿落位
    const after = entriesOf(dataDir).filter((e) => e.id === 'demo-pkg');
    expect(after).toHaveLength(1);
    expect(after[0]!.installPath).toBe(join('plugins', 'market', 'legs', 'demo-pkg'));
    expect(after[0]!.market).toEqual({ name: 'legs', entry: 'demo-pkg' });
    // 旧 npm 落位（plugins/node_modules/demo-pkg）连带清——按②同判据组清旧位差集（§9.6 mp 收尾批修笔）
    expect(existsSync(join(dataDir, 'plugins', 'node_modules', 'demo-pkg'))).toBe(false);
  });

  it('换血豁免 id 漂移（拷贝腿同位）：撤账恰一条 + enabled 行随迁（修前红——旧行悬挂形）', async () => {
    const dataDir = dataDirOf('market-id-drift');
    const repo = marketRepoFixture('drift');
    const deps = depsOf(dataDir, noopSpawn);
    const first = await installPlugin(deps, `local:${repo}`, { market, subdirCopy: { subpath: 'plugins/hello' } });
    expect(first.ok).toBe(true);
    // 用户启用（mount 行落 enabled.yaml——随迁断言的意图锚）
    expect(mountRow(dataDir, 'hello-plugin', undefined, createPluginStoreFs())).toMatchObject({ ok: true });
    // 上游清单换代改名 id：hello-plugin → hello-plugin-next（同 provenance 换血）
    writeFileSync(
      join(repo, 'plugins', 'hello', 'package.json'),
      pluginPkgJson({ name: 'hello-plugin-next', berryAgent: { id: 'hello-plugin-next', skills: ['greet'] } }),
    );
    const second = await installPlugin(deps, `local:${repo}`, { market, subdirCopy: { subpath: 'plugins/hello' } });
    expect(second.ok).toBe(true);
    // 账本恰一条且 id = 新名（撤账段兑现——同 provenance 换血非新增）
    const after = entriesOf(dataDir);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe('hello-plugin-next');
    expect(after[0]!.market).toEqual(market);
    // enabled 行随迁：行 id 改写为新 id——不随迁即旧行悬挂（boot 永续 warn +
    // 静默停载 + 两 uninstall 动词均清不掉——§9.6 收尾批定形）
    const rows = readEnabledRowsForEdit(dataDir, createPluginStoreFs());
    expect(rows.ok && rows.rows.map((row) => row.id)).toEqual(['hello-plugin-next']);
    // 同位换血（entry 名不变 → installPath 不变）：装机树内容为新清单
    expect(readFileSync(join(dataDir, 'plugins', 'market', 'alpha', 'hello-plugin', 'package.json'), 'utf8')).toContain(
      'hello-plugin-next',
    );
  });

  it('换血豁免 id 漂移（npm 腿换包落位）：撤账 + 旧树连带清 + 行随迁（修前红）', async () => {
    const dataDir = dataDirOf('market-id-drift-npm');
    const legsMarket = { name: 'legs', entry: 'demo-pkg' };
    // 首装：npm:old-pkg（manifest id = old-id）带市场溯源注记
    const oldRec = npmFakeSpawn(dataDir, { pkgJson: pluginPkgJson({ name: 'old-pkg', berryAgent: { id: 'old-id' } }) });
    const first = await installPlugin(depsOf(dataDir, oldRec.spawn), 'npm:old-pkg', { market: legsMarket });
    expect(first.ok).toBe(true);
    expect(mountRow(dataDir, 'old-id', undefined, createPluginStoreFs())).toMatchObject({ ok: true });
    // 换代：catalog 同条目换 npm 包名（ref 变 → installPath 换位）且新包清单 id = new-id
    const newRec = npmFakeSpawn(dataDir, { pkgJson: pluginPkgJson({ name: 'new-pkg', berryAgent: { id: 'new-id' } }) });
    const second = await installPlugin(depsOf(dataDir, newRec.spawn), 'npm:new-pkg', { market: legsMarket });
    expect(second.ok).toBe(true);
    const after = entriesOf(dataDir);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe('new-id');
    expect(after[0]!.installPath).toBe(join('plugins', 'node_modules', 'new-pkg'));
    // 旧树连带清（oldAbs ≠ newAbs 且无共享——撤账段 rm 分支的漂移形首锁）
    expect(existsSync(join(dataDir, 'plugins', 'node_modules', 'old-pkg'))).toBe(false);
    // 行随迁（修前红锚——旧行 id 悬挂）
    const rows = readEnabledRowsForEdit(dataDir, createPluginStoreFs());
    expect(rows.ok && rows.rows.map((row) => row.id)).toEqual(['new-id']);
  });

  it('id 漂移随迁边界两形 + 回执携带：未启用 no-op / 新 id 行在场防双行 / config 保形 + enabledCarried 注记（修前红——回执位缺席）', async () => {
    // —— 形一：未启用物换代 = 无行可迁（no-op——不凭空造启用行） ——
    const dirA = dataDirOf('market-drift-no-row');
    const marketA = { name: 'legs-a', entry: 'demo-pkg' };
    const recA = npmFakeSpawn(dirA, { pkgJson: pluginPkgJson({ name: 'old-pkg', berryAgent: { id: 'old-id' } }) });
    expect(await installPlugin(depsOf(dirA, recA.spawn), 'npm:old-pkg', { market: marketA })).toMatchObject({
      ok: true,
    });
    const recA2 = npmFakeSpawn(dirA, { pkgJson: pluginPkgJson({ name: 'new-pkg', berryAgent: { id: 'new-id' } }) });
    const driftA = await installPlugin(depsOf(dirA, recA2.spawn), 'npm:new-pkg', { market: marketA });
    expect(driftA.ok).toBe(true);
    if (!driftA.ok) return;
    expect(driftA.enabledCarried).not.toBe(true); // 未启用——无随迁（回执不携带）
    expect(driftA.text).not.toContain('随换代迁移'); // 未随迁不注记
    const rowsA = readEnabledRowsForEdit(dirA, createPluginStoreFs());
    expect(rowsA.ok && rowsA.rows).toHaveLength(0); // 不凭空造行

    // —— 形二：新 id 行已在场 = 旧行移除防双行（用户显式 mount 的既有意图不覆写） ——
    const dirB = dataDirOf('market-drift-row-clash');
    const marketB = { name: 'legs-b', entry: 'demo-pkg' };
    const recB = npmFakeSpawn(dirB, { pkgJson: pluginPkgJson({ name: 'old-pkg', berryAgent: { id: 'old-id' } }) });
    expect(await installPlugin(depsOf(dirB, recB.spawn), 'npm:old-pkg', { market: marketB })).toMatchObject({
      ok: true,
    });
    expect(mountRow(dirB, 'old-id', undefined, createPluginStoreFs())).toMatchObject({ ok: true });
    expect(mountRow(dirB, 'new-id', undefined, createPluginStoreFs())).toMatchObject({ ok: true });
    const recB2 = npmFakeSpawn(dirB, { pkgJson: pluginPkgJson({ name: 'new-pkg', berryAgent: { id: 'new-id' } }) });
    const driftB = await installPlugin(depsOf(dirB, recB2.spawn), 'npm:new-pkg', { market: marketB });
    expect(driftB.ok).toBe(true);
    if (!driftB.ok) return;
    expect(driftB.enabledCarried).toBe(true); // 行面有动作（旧行清场）——回执携带
    expect(driftB.text).toContain('启用行已随换代迁移'); // 回执诚实位（§9.6 mp 收尾批定形）
    const rowsB = readEnabledRowsForEdit(dirB, createPluginStoreFs());
    expect(rowsB.ok && rowsB.rows.map((row) => row.id)).toEqual(['new-id']); // 恰一行——防双行

    // —— 形三：随迁保形——行内 config 字段原样迁走（启用意图跨换代连续） ——
    const dirC = dataDirOf('market-drift-row-config');
    const marketC = { name: 'legs-c', entry: 'demo-pkg' };
    const recC = npmFakeSpawn(dirC, { pkgJson: pluginPkgJson({ name: 'old-pkg', berryAgent: { id: 'old-id' } }) });
    expect(await installPlugin(depsOf(dirC, recC.spawn), 'npm:old-pkg', { market: marketC })).toMatchObject({
      ok: true,
    });
    expect(mountRow(dirC, 'old-id', { greeting: 'hi' }, createPluginStoreFs())).toMatchObject({ ok: true });
    const recC2 = npmFakeSpawn(dirC, { pkgJson: pluginPkgJson({ name: 'new-pkg', berryAgent: { id: 'new-id' } }) });
    const driftC = await installPlugin(depsOf(dirC, recC2.spawn), 'npm:new-pkg', { market: marketC });
    expect(driftC.ok).toBe(true);
    if (!driftC.ok) return;
    expect(driftC.enabledCarried).toBe(true);
    const rowsC = readEnabledRowsForEdit(dirC, createPluginStoreFs());
    expect(rowsC.ok && rowsC.rows[0]).toMatchObject({ id: 'new-id', config: { greeting: 'hi' } }); // 全字段保形
  });

  it('id 漂移撤账 + 旧树共享引用：树保留只撤账（引用计数判据——无主差集才清）', async () => {
    const dataDir = dataDirOf('market-drift-shared-tree');
    const legsMarket = { name: 'legs-shared', entry: 'demo-pkg' };
    // 首装：npm:old-pkg（manifest id = old-id）带市场溯源注记
    const oldRec = npmFakeSpawn(dataDir, { pkgJson: pluginPkgJson({ name: 'old-pkg', berryAgent: { id: 'old-id' } }) });
    const first = await installPlugin(depsOf(dataDir, oldRec.spawn), 'npm:old-pkg', { market: legsMarket });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // 手铸共享条目：另一装机物 installPath 指向同一段位（无 market 注记——
    // 不进换血寻址键；形拷首装条目保账本形状合法），旧树即「他条目共享」，
    // 连带清判据须放它过（§9.6 mp-3 定形注④：无主差集才清）
    const { market: _dropped, ...shadowBase } = first.entry;
    const shadow: PluginLedgerEntry = { ...shadowBase, id: 'shadow-pkg' };
    writeFileSync(ledgerPath(dataDir), JSON.stringify([first.entry, shadow]));
    // 换代：catalog 同条目换包（old-pkg → new-pkg）且新包清单 id = new-id——
    // id 漂移触发撤账；oldAbs ≠ newAbs 但共享条目在场 → 旧树保留
    const newRec = npmFakeSpawn(dataDir, { pkgJson: pluginPkgJson({ name: 'new-pkg', berryAgent: { id: 'new-id' } }) });
    const second = await installPlugin(depsOf(dataDir, newRec.spawn), 'npm:new-pkg', { market: legsMarket });
    expect(second.ok).toBe(true);
    // 撤账兑现：old-id 出账，账本恰 new-id + shadow-pkg 两条
    const after = entriesOf(dataDir);
    expect(after.map((e) => e.id).sort()).toEqual(['new-id', 'shadow-pkg']);
    // 共享旧树保留（他条目引用中——rm 分支被引用计数判据拦下）+ 新树在场
    expect(existsSync(join(dataDir, 'plugins', 'node_modules', 'old-pkg', 'package.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'plugins', 'node_modules', 'new-pkg', 'package.json'))).toBe(true);
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

describe('git 克隆目标主机校验（03 §9.6 mp 收尾批安全硬化——SSRF 红线 + argv 选项位拒）', () => {
  /** 记 argv 的假 spawn（任何 spawn 到达即红——三处校验位全须在 spawn 之前拒） */
  function recordingSpawn(): { readonly spawn: SpawnRunner; readonly argvLog: string[][] } {
    const argvLog: string[][] = [];
    const spawn: SpawnRunner = {
      run: (cmd, args) => {
        argvLog.push([cmd, ...args]);
        return Promise.resolve({ stdout: '', stderr: '' });
      },
    };
    return { spawn, argvLog };
  }

  it('私网目标 spawn 前拒（market 装机腿守卫——http 元数据端点字面 / ssh 内网字面 / scp 短手 DNS 私网命中）——修前红', async () => {
    // 三形覆盖：字面私网 IP（isPrivateHostLiteral 命中——零 DNS）×2 + scp 短手
    // 形主机名走 DNS 腿（应答私网地址命中拒）。§9.6 裁决：market 腿设守卫；
    // 用户手打直装腿（market 注记缺席）= 显式动作豁免——故用 market 注记腿驱动
    const cases: readonly { readonly ref: string; readonly dir: string }[] = [
      { ref: 'git:http://169.254.169.254/latest/meta-data', dir: 'ssrf-http-meta' },
      { ref: 'git:ssh://git@10.0.0.5/internal/repo.git', dir: 'ssrf-ssh-literal' },
      { ref: 'git:git@git.internal.example:owner/repo.git', dir: 'ssrf-scp-dns' },
    ];
    for (const { ref, dir } of cases) {
      const { spawn, argvLog } = recordingSpawn();
      const outcome = await installPlugin(
        depsOf(dataDirOf(dir), spawn, { resolveDns: () => Promise.resolve(['10.1.2.3']) }),
        ref,
        { market: { name: 'sec', entry: 'e' } },
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.message).toContain('私网');
      expect(argvLog).toEqual([]); // 拒在 spawn 之前——零外联（SSRF 红线断言面）
    }
  });

  it('协议白名单 fail-closed（market 装机腿守卫）：file:// 本地路径 / ext:: 外传执行全拒——修前红', async () => {
    // 白名单外不猜：file:// 直落本机协议面、ext:: 是 git 外传执行向量；裸
    // owner/repo 形（不可解析 url）同拒——fail-closed 消息按命中位分形
    const cases: readonly { readonly ref: string; readonly dir: string; readonly want: string }[] = [
      { ref: 'git:file:///etc/passwd', dir: 'gate-file', want: '白名单' },
      { ref: 'git:ext::sh -c id', dir: 'gate-ext', want: '白名单' },
      { ref: 'git:owner/repo', dir: 'gate-bare', want: '不可解析' },
    ];
    for (const { ref, dir, want } of cases) {
      const { spawn, argvLog } = recordingSpawn();
      const outcome = await installPlugin(depsOf(dataDirOf(dir), spawn), ref, { market: { name: 'sec', entry: 'e' } });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.message).toContain(want);
      expect(argvLog).toEqual([]);
    }
  });

  it("'-' 起头 url/ref 拒（argv 选项位混淆——翻译层词法拒之外的第二执法位）——修前红", async () => {
    const cases: readonly { readonly ref: string; readonly dir: string }[] = [
      { ref: 'git:-oProxy=x://y', dir: 'gate-dash-url' },
      { ref: 'git:https://example.com/o/r.git#-b', dir: 'gate-dash-ref' },
    ];
    for (const { ref, dir } of cases) {
      const { spawn, argvLog } = recordingSpawn();
      const outcome = await installPlugin(depsOf(dataDirOf(dir), spawn), ref);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.message).toContain('起头');
      expect(argvLog).toEqual([]);
    }
  });

  it('境三拷贝腿克隆目标同校验（私网拒——spawn 前零外联）——修前红', async () => {
    const { spawn, argvLog } = recordingSpawn();
    const outcome = await installPlugin(
      depsOf(dataDirOf('gate-subdir-ssrf'), spawn),
      'git:http://192.168.1.10/o/monorepo.git#deadbeef',
      { market: { name: 'sub', entry: 'hello-plugin' }, subdirCopy: { subpath: 'packages/hello' } },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('私网');
    expect(argvLog).toEqual([]);
  });

  it("npm spec 槽位 '-' 起头拒：'--ignore-scripts=false' 不得进 spawn（nopt last-wins 掀旗标面）——修前红", async () => {
    const { spawn, argvLog } = recordingSpawn();
    const outcome = await installPlugin(depsOf(dataDirOf('gate-npm-dash'), spawn), 'npm:--ignore-scripts=false');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('起头');
    expect(argvLog).toEqual([]); // npm spawn 零到达——spec 槽位拒在 spawn 前
  });
});
