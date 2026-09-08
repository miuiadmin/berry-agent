/**
 * host/plugin-install — 三源装机执行器 + 收割 + update 分派（03 §5.4——
 * 成熟度缺口 #10 装机面落码批 10b）。
 *
 * 三源（§5.4 物理布局/凭证纪律）：
 *  - **npm**：`npm install --prefix <dataDir>/plugins` 进程外 spawn（07 §5
 *    「用户显式动作族」——不进 exec 沙箱体系）；供应链四件套执法——
 *    `--save-exact`（依赖记录钉版落锚）/`--omit=dev`/`--min-release-age`
 *    （静置窗，缺省 1440 分钟）/`--ignore-scripts`（安装期脚本缺省禁跑）
 *    + `--omit=peer --legacy-peer-deps`（承 berry 实践条款）；装机树锚
 *    package.json（缺锚 npm 会向上爬找父 package.json 污染用户文件——锚
 *    是防线非装饰）；integrity 从 `<prefix>/.package-lock.json` 收割落账
 *    （tarball 凭证——§5.4「dist-tag 不算凭证」）。
 *  - **git**：tmp 克隆 → checkout ref → HEAD commit 收割落账（精确 commit
 *    锁定）→ rename 落 `plugins/git/<host>/<首段>/<repo>/`（分层防撞名）。
 *  - **local**：直引不拷贝（installPath = canonical 绝对；§5.5 不删用户
 *    目录）——无凭证字段。
 *
 * 收割（§5.4 词表账本）：jiti 求值入口模块读 `events` 导出——「装机零生效」
 * 的唯一例外（仅模块求值，零 apply 零注册）；jiti 参数与装载器同形（虚拟面
 * 四键直注 + import 门禁 transform + fsCache 关——同律不因装机时点放宽）。
 * 纯声明包（declared-payload 态）零码收割（declaredEvents = []）。
 *
 * 失败回滚：装机物落位后清单校验/收割失败 = rm 装机物再拒（不留半装机残影
 * ——账本未落，回滚后两账一致空态）。
 *
 * spawn 注入面：测试注假件零真网络（npm/git 两执行器的 argv 断言 + 落账
 * 编舞可测）；local 源与收割真跑（本地 fixture 零网络）。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createJiti } from 'jiti';

import { BaseError } from '../contracts/index.js';
import {
  installPathForGit,
  installPathForLocal,
  installPathForNpm,
  ledgerPath,
  parentDir,
  readLedger,
  resolveInstallPath,
  upsertLedgerEntry,
} from './plugin-store.js';
import type { PluginLedgerEntry, PluginStoreFs } from './plugin-store.js';
import { parseManifest } from './manifest.js';
import type { PluginManifest } from './manifest.js';
import { createGateTransform } from './import-gate.js';
import { loadDefaultVirtualFaces, resolvePkgMain } from './loader.js';

/* ---------------- ref 词法（CLI 与账本同形单源——§5.4 ref 字段） ---------------- */

/** 解析后 ref 三源形（spec = 进执行器的安装说明符） */
export type ParsedPluginRef =
  | { readonly source: 'npm'; readonly pkg: string; readonly version?: string }
  | { readonly source: 'git'; readonly url: string; readonly gitRef?: string }
  | { readonly source: 'local'; readonly path: string };

export type PluginRefParse =
  { readonly ok: true; readonly parsed: ParsedPluginRef } | { readonly ok: false; readonly message: string };

/**
 * ref 单源词法（CLI `plugins install <ref>` 与账本 ref 字段同一表示——
 * 无变换直通）：`npm:<pkg>[@<version>]` / `git:<url>[#<ref>]` /
 * `local:<abs-path>`。前缀三选一强制（无前缀 = 用法错——不猜默认源）。
 */
export function parsePluginRef(ref: string): PluginRefParse {
  if (ref.startsWith('npm:')) {
    const spec = ref.slice('npm:'.length);
    if (spec.length === 0) return { ok: false, message: 'npm ref 缺包名（形如 npm:acme-widgets@1.2.0）' };
    const at = spec.lastIndexOf('@');
    // scoped 包 @scope/pkg：@ 在位 0 是 scope 前缀非版本分隔——只认 >0 的 @
    if (at > 0) {
      return { ok: true, parsed: { source: 'npm', pkg: spec.slice(0, at), version: spec.slice(at + 1) } };
    }
    return { ok: true, parsed: { source: 'npm', pkg: spec } };
  }
  if (ref.startsWith('git:')) {
    const spec = ref.slice('git:'.length);
    if (spec.length === 0)
      return { ok: false, message: 'git ref 缺 url（形如 git:https://github.com/o/r.git#v1.2.0）' };
    const hash = spec.lastIndexOf('#');
    if (hash >= 0) {
      const gitRef = spec.slice(hash + 1);
      if (gitRef.length === 0) return { ok: false, message: 'git ref 的 # 后为空（分支/tag/commit）' };
      return { ok: true, parsed: { source: 'git', url: spec.slice(0, hash), gitRef } };
    }
    return { ok: true, parsed: { source: 'git', url: spec } };
  }
  if (ref.startsWith('local:')) {
    const spec = ref.slice('local:'.length);
    if (spec.length === 0) return { ok: false, message: 'local ref 缺路径（形如 local:/abs/path/to/plugin）' };
    return { ok: true, parsed: { source: 'local', path: spec } };
  }
  return { ok: false, message: `ref 须自含源前缀 npm:/git:/local:（得 "${ref}"）——与装机账本 ref 字段同形` };
}

/* ---------------- min-release-age 配置解析（§5.4 供应链③） ---------------- */

/** 静置窗缺省（分钟）——24h，03 §5.4 装机面落码批定形 */
export const DEFAULT_MIN_RELEASE_AGE_MINUTES = 1440;

/** env 名（07 §2.1 名册在册位——BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE） */
export const MIN_RELEASE_AGE_ENV = 'BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE';

/**
 * 静置窗解析（CLI 旗标 > env > 缺省 1440）。无效值（非数字/负数/NaN）=
 * fail-loud（短命装机动作当场红优于静默降级——与 LOG_LEVEL 长跑让位律
 * 分立两律）。
 */
export function resolveMinReleaseAge(input: {
  readonly env?: Record<string, string | undefined>;
  readonly cliFlag?: number;
}): number {
  if (input.cliFlag !== undefined) return input.cliFlag; // CLI 解析层已验正整数
  const raw = input.env?.[MIN_RELEASE_AGE_ENV];
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new BaseError(
        'PLUGIN_INSTALL_FAILED',
        `${MIN_RELEASE_AGE_ENV}="${raw}" 坏形——须为非负整数分钟数（0 = 显式关窗）`,
      );
    }
    return n;
  }
  return DEFAULT_MIN_RELEASE_AGE_MINUTES;
}

/* ---------------- spawn 注入面 ---------------- */

/** 子进程执行面（缺省 execFile promisify；测试注假件零真网络） */
export interface SpawnRunner {
  run(
    cmd: string,
    args: readonly string[],
    options: { readonly cwd?: string },
  ): Promise<{ readonly stdout: string; readonly stderr: string }>;
}

/** 缺省真身（maxBuffer 放大——npm 安装输出可观；非零退出 = reject 带 stderr） */
export function createDefaultSpawnRunner(): SpawnRunner {
  const runFile = promisify(execFile);
  return {
    run: (cmd, args, options) =>
      runFile(cmd, [...args], { cwd: options.cwd, maxBuffer: 64 * 1024 * 1024 }) as Promise<{
        stdout: string;
        stderr: string;
      }>,
  };
}

/** 装机执行器注入面（全受局面——测试替身据此还原编舞） */
export interface InstallExecutorDeps {
  readonly dataDir: string;
  readonly fs: PluginStoreFs;
  readonly spawn: SpawnRunner;
  /** env 面（min-release-age 解析源之一；缺省 process.env 归 plugins-cmd 传） */
  readonly env?: Record<string, string | undefined>;
  /** --min-release-age CLI 旗标逐次覆盖（07 §5——CLI > env > 缺省三级的最顶级） */
  readonly minReleaseAgeOverride?: number;
  /** 挂钟（缺省 Date——installedAt 单源） */
  readonly now?: () => Date;
  /** tmp 目录（git 克隆中转站；缺省系统 tmp） */
  readonly tmpRoot?: string;
  /** jiti 工厂注入位（收割腿测试替身；缺省真 jiti） */
  readonly jitiFactory?: (pluginDir: string, pluginId: string) => ReturnType<typeof createJiti>;
}

/** install 结果（ok = 落账条目；拒 = message 呈现 CLI 退 1） */
export type InstallOutcome =
  | { readonly ok: true; readonly entry: PluginLedgerEntry; readonly text: string }
  | { readonly ok: false; readonly message: string };

/* ---------------- 装机编舞主入口 ---------------- */

/**
 * install 编舞（§5.4）：撞名拒（同 id 已装指路 update）→ 按源执行 → 清单
 * 校验 → 收割 → 落账。执行器产出 installPath + 凭证字段；收割失败/清单坏形
 * = 回滚装机物再拒（不留半装机残影）。core: 前缀 id 拒（官方件身份——非
 * 装机物）。`replacingId` = update 分派的换装豁免位（npm 重装腿复用本编舞
 * 时旧条目尚在场——恰是被替换者，不构成撞名；其余 id 照拒）。
 */
export async function installPlugin(
  deps: InstallExecutorDeps,
  ref: string,
  opts: { readonly replacingId?: string } = {},
): Promise<InstallOutcome> {
  const parsed = parsePluginRef(ref);
  if (!parsed.ok) return parsed;
  // 账本前置读（坏账本拒写防覆盖——与 upsertLedgerEntry 内防线双检）
  const ledgerRead = readLedger(deps.dataDir, deps.fs);
  if (!ledgerRead.ok) {
    return {
      ok: false,
      message: `装机账本损坏（${ledgerPath(deps.dataDir)}）：${ledgerRead.reason}——拒写防覆盖（03 §5.4）`,
    };
  }
  // 执行器先行（装机物落位 + manifest 读——失败红即拒，账面零动作）
  let product: InstallProduct;
  try {
    product =
      parsed.parsed.source === 'npm'
        ? await runNpmInstall(deps, parsed.parsed)
        : parsed.parsed.source === 'git'
          ? await runGitInstall(deps, parsed.parsed)
          : runLocalInstall(deps, parsed.parsed);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  // 清单校验（§1.2 拒绝式——装机时点红优于装载时点）
  if (!product.manifest.ok) {
    rollbackInstall(deps, product.installPath);
    return { ok: false, message: `清单校验失败（${ref}）：${product.manifest.message}` };
  }
  const manifest = product.manifest.manifest;
  if (manifest.id.startsWith('core:')) {
    rollbackInstall(deps, product.installPath);
    return { ok: false, message: `清单 id "${manifest.id}" 带官方前缀——core: 为官方插件保留（03 §1.2），装机拒` };
  }
  if (ledgerRead.entries.some((e) => e.id === manifest.id && e.id !== opts.replacingId)) {
    rollbackInstall(deps, product.installPath);
    return {
      ok: false,
      message: `插件 ${manifest.id} 已装机（源 ${ledgerRead.entries.find((e) => e.id === manifest.id)!.source}）——换版本走 update，先卸走 uninstall（03 §5.4）`,
    };
  }
  // 收割（§5.4 词表账本——装机零生效唯一例外：仅模块求值读 events 导出）
  let declaredEvents: readonly string[];
  try {
    declaredEvents = await harvestEvents(
      deps,
      resolveInstallPath(deps.dataDir, product.installPath),
      product.installPath,
      manifest,
    );
  } catch (err) {
    rollbackInstall(deps, product.installPath);
    return {
      ok: false,
      message: `收割失败（${ref}）——装机回滚：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // 落账（条目数组形原子写——plugin-store 执法）
  const now = deps.now ?? (() => new Date()); // Date 构造子裸调用返 string（JS 遗留）——显式闭包归一
  const entry: PluginLedgerEntry = {
    id: manifest.id,
    source: parsed.parsed.source,
    ref,
    version: manifest.version ?? product.version,
    ...(product.integrity !== undefined ? { integrity: product.integrity } : {}),
    ...(product.commit !== undefined ? { commit: product.commit } : {}),
    installedAt: now().toISOString(),
    installPath: product.installPath,
    declaredEvents,
  };
  upsertLedgerEntry(deps.dataDir, entry, deps.fs);
  return {
    ok: true,
    entry,
    text: `已装机：${manifest.id}（源 ${parsed.parsed.source}，${product.installPath}）——装机零生效，启用走 mount（下次启动装载生效）`,
  };
}

/** 执行器产物（installPath 已是账本表示——npm/git 相对、local 绝对） */
interface InstallProduct {
  readonly installPath: string;
  readonly manifest: ReturnType<typeof parseManifest>;
  readonly version?: string;
  readonly integrity?: string;
  readonly commit?: string;
}

/** 装机物回滚（清单/收割失败腿——local 源不删〔直引非装机物〕） */
function rollbackInstall(deps: InstallExecutorDeps, installPath: string): void {
  if (installPath === '' || installPath.startsWith('/')) return; // local 绝对表示 = 用户源不删
  try {
    deps.fs.rm(resolveInstallPath(deps.dataDir, installPath), { recursive: true, force: true });
  } catch {
    // 回滚失败不吞装机油——主错误照呈（残影目录下次 install 前置 rm 收敛）
  }
}

/* ---------------- npm 源执行器 ---------------- */

/**
 * npm 源执行（§5.4 四件套执法）。锚 package.json 缺席即写最小锚（防 npm
 * 向上爬父目录污染用户文件）；`--prefix` 装进装机树；integrity/version 从
 * `.package-lock.json` 收割（tarball 凭证真源）。
 */
async function runNpmInstall(
  deps: InstallExecutorDeps,
  parsed: { readonly pkg: string; readonly version?: string },
): Promise<InstallProduct> {
  const pluginsDir = join(deps.dataDir, 'plugins');
  deps.fs.mkdir(pluginsDir, { recursive: true });
  // 锚 package.json（缺席才写——在场保用户/前次装机产物，不覆盖）
  if (deps.fs.read(join(pluginsDir, 'package.json')) === null) {
    deps.fs.write(
      join(pluginsDir, 'package.json'),
      `${JSON.stringify({ name: 'berry-agent-plugin-tree', private: true }, null, 2)}\n`,
    );
  }
  const argv = [
    'install',
    '--prefix',
    pluginsDir,
    '--save-exact', // ① 直接依赖钉版（依赖记录 exact 无 ranges）
    '--omit=dev', // ② devDependencies 不装
    '--omit=peer',
    '--legacy-peer-deps',
    '--ignore-scripts', // ④ 安装期脚本禁跑（白名单开面归点火日）
    ...buildMinReleaseAgeFlags(deps),
    parsed.version !== undefined ? `${parsed.pkg}@${parsed.version}` : parsed.pkg,
  ];
  try {
    await deps.spawn.run('npm', argv, {});
  } catch (err) {
    throw new BaseError('PLUGIN_INSTALL_FAILED', npmFailureMessage(err, buildMinReleaseAgeFlags(deps).join(' ')), {
      cause: err,
    });
  }
  // 凭证收割：.package-lock.json 的 packages[<装机目录>].integrity + version
  const installPath = installPathForNpm(parsed.pkg);
  const lockText = deps.fs.read(join(pluginsDir, '.package-lock.json'));
  const lock =
    lockText === null
      ? undefined
      : (JSON.parse(lockText) as {
          packages?: Record<string, { version?: string; integrity?: string }>;
        });
  const lockEntry = lock?.packages?.[`node_modules/${parsed.pkg}`];
  return {
    installPath,
    manifest: readManifestAt(deps, installPath),
    version: lockEntry?.version,
    integrity: lockEntry?.integrity,
  };
}

/** min-release-age 旗标族（0 = 显式关窗 → 不传旗标——npm 无「关闭」值形） */
function buildMinReleaseAgeFlags(deps: InstallExecutorDeps): readonly string[] {
  const minutes = resolveMinReleaseAge({
    ...(deps.env !== undefined ? { env: deps.env } : {}),
    ...(deps.minReleaseAgeOverride !== undefined ? { cliFlag: deps.minReleaseAgeOverride } : {}),
  });
  return minutes <= 0 ? [] : ['--min-release-age', String(minutes)];
}

/** npm 失败增补指路（--min-release-age 旧版不识 → 指路升级） */
function npmFailureMessage(err: unknown, flagText: string): string {
  const stderr = err instanceof Error ? ((err as Error & { stderr?: string }).stderr ?? '') : '';
  const message = err instanceof Error ? err.message : String(err);
  const ageHint =
    stderr.includes('min-release-age') || stderr.includes('Unknown cli flag') || stderr.includes('unknown option')
      ? `——npm 不识 ${flagText}：--min-release-age 须 npm ≥11.5（npm -v 自查），或设 ${MIN_RELEASE_AGE_ENV}=0 关窗`
      : '';
  return `npm install 失败：${message}${ageHint}`;
}

/* ---------------- git 源执行器 ---------------- */

/**
 * git 源执行：tmp 克隆（默认 branch）→ checkout gitRef（detach——branch/
 * tag/commit 皆可）→ HEAD commit 收割 → 落位 `plugins/git/<host>/<首段>/
 * <repo>/`（目标在场先 rm——幂等重装/撞名目录收敛）。克隆浅化不启用
 * （checkout 任意历史 commit 需全史——--depth 与 commit ref 冲突）。
 */
async function runGitInstall(
  deps: InstallExecutorDeps,
  parsed: { readonly url: string; readonly gitRef?: string },
): Promise<InstallProduct> {
  const tmp = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), 'berry-git-install-'));
  try {
    await deps.spawn.run('git', ['clone', parsed.url, tmp], {});
    if (parsed.gitRef !== undefined) {
      await deps.spawn.run('git', ['-C', tmp, 'checkout', '--detach', parsed.gitRef], {});
    }
    const head = await deps.spawn.run('git', ['-C', tmp, 'rev-parse', 'HEAD'], {});
    const commit = head.stdout.trim();
    const installPath = installPathForGit(parsed.url); // 坏 url 抛 PLUGIN_INSTALL_FAILED——ref 前置已校，保底
    const target = resolveInstallPath(deps.dataDir, installPath);
    deps.fs.mkdir(parentDir(target), { recursive: true });
    deps.fs.rm(target, { recursive: true, force: true }); // 幂等（在场旧树先清）
    deps.fs.rename(tmp, target);
    return {
      installPath,
      manifest: readManifestAt(deps, installPath),
      commit,
      version: undefined,
    };
  } finally {
    // rename 成功后 tmp 已不存在——force rm 幂等收尾
    deps.fs.rm(tmp, { recursive: true, force: true });
  }
}

/* ---------------- local 源执行器 ---------------- */

/** local 源执行：直引不拷贝（installPath = canonical 绝对；§5.4 表示法） */
function runLocalInstall(deps: InstallExecutorDeps, parsed: { readonly path: string }): InstallProduct {
  let installPath: string;
  try {
    installPath = installPathForLocal(parsed.path);
  } catch (err) {
    throw new BaseError(
      'PLUGIN_INSTALL_FAILED',
      `local 路径坏形（${parsed.path}）：${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    );
  }
  return { installPath, manifest: readManifestAt(deps, installPath) };
}

/* ---------------- 清单读取（三源共用） ---------------- */

/** 装机目录读 package.json 过清单校验（§1.2 拒绝式——官方位 false） */
function readManifestAt(deps: InstallExecutorDeps, installPath: string): ReturnType<typeof parseManifest> {
  const pluginDir = resolveInstallPath(deps.dataDir, installPath);
  const text = deps.fs.read(join(pluginDir, 'package.json'));
  if (text === null) {
    return {
      ok: false,
      code: 'PLUGIN_SHAPE_INVALID',
      message: `装机目录无 package.json（${pluginDir}）——三源执行产物异常`,
    };
  }
  try {
    return parseManifest(JSON.parse(text));
  } catch (err) {
    return {
      ok: false,
      code: 'PLUGIN_SHAPE_INVALID',
      message: `package.json 坏 JSON（${pluginDir}）：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/* ---------------- 收割（§5.4 词表账本） ---------------- */

/**
 * install 收割：jiti 求值入口模块读 `events` 导出（§1.3——装机零生效唯一
 * 例外）。与装载器同形：虚拟面四键直注（顶层 import 'berry-agent' 不炸）+
 * import 门禁 transform（03 §3.3 同律——装机时点不放宽）+ fsCache 关（门
 * 禁身份不入缓存键）。纯声明包（declared-payload）零码收割。非字符串数组
 * events 导出 = 收割失败（词表账本容不得坏形）。
 */
async function harvestEvents(
  deps: InstallExecutorDeps,
  pluginDir: string,
  installPath: string,
  manifest: PluginManifest,
): Promise<readonly string[]> {
  if (manifest.entryPlan.kind === 'declared-payload') return []; // 纯声明包零码
  const entryFile = manifest.entryPlan.kind === 'entry-file' ? manifest.entryPlan.entry : resolvePkgMain(pluginDir);
  const entryId = join(pluginDir, entryFile);
  const jiti =
    deps.jitiFactory?.(pluginDir, manifest.id) ??
    createJiti(join(pluginDir, 'package.json'), {
      transform: createGateTransform({ pluginId: manifest.id, pluginDir }),
      interopDefault: true,
      moduleCache: true,
      fsCache: false, // 与装载器同律（门禁身份不入缓存键）
      virtualModules: await loadDefaultVirtualFaces(),
    });
  let namespace: Record<string, unknown>;
  try {
    namespace = (await jiti.import(entryId)) as Record<string, unknown>;
  } catch (err) {
    throw new BaseError(
      'PLUGIN_INSTALL_FAILED',
      `收割求值入口模块失败（${installPath}/${entryFile}）：${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const events = namespace['events'];
  if (events === undefined) return [];
  if (!Array.isArray(events) || events.some((e) => typeof e !== 'string' || e.length === 0)) {
    throw new BaseError(
      'PLUGIN_SHAPE_INVALID',
      `入口 events 导出须字符串数组（插件 ${manifest.id}）——词表账本容不得坏形`,
    );
  }
  return events as readonly string[];
}

/* ---------------- update 分派（§5.4 按源） ---------------- */

/**
 * update 编舞（§5.4 按源分派）：npm 重装（拉最新满足窗龄版——`--save-exact`
 * 锚树 + 无版本 spec = latest 受 min-release-age 窗检；新 integrity/version
 * 落账）；git 删目录按原 ref 重克隆（新 commit）；local no-op（源动了下次
 * 装载即新——§5.4 既有条款）。enabled 行不动（装机物换血、行引用 id 不变）。
 */
export async function updatePlugin(deps: InstallExecutorDeps, id: string): Promise<InstallOutcome> {
  const ledgerRead = readLedger(deps.dataDir, deps.fs);
  if (!ledgerRead.ok) {
    return { ok: false, message: `装机账本损坏：${ledgerRead.reason}——拒写防覆盖（03 §5.4）` };
  }
  const current = ledgerRead.entries.find((e) => e.id === id);
  if (current === undefined) {
    return { ok: false, message: `插件 ${id} 未装机——无可更新（装机清单见 plugins list）` };
  }
  if (current.source === 'local') {
    return { ok: true, entry: current, text: `local 源直引不拷贝——源目录变更下次装载即生效（03 §5.4 no-op 分派）` };
  }
  // local 之外的 ref 重解析（账本 ref 与 CLI 同词法——单源往返）
  const parsed = parsePluginRef(current.ref);
  if (!parsed.ok) {
    return { ok: false, message: `账本 ref 坏形（${current.ref}）：${parsed.message}——重装可重建` };
  }
  if (parsed.parsed.source === 'local') {
    // 病理态保底（local 已在上方 no-op 返回——账本 source 与 ref 前缀不一致）
    return { ok: false, message: `账本 source 与 ref 前缀不一致（${current.ref}）——重装可重建` };
  }
  if (parsed.parsed.source === 'npm') {
    // 重装：旧装机物先清（spec 无版本 = 拉最新满足窗龄；upsert 后见胜出）。
    // 换装豁免位传被替换 id——旧条目恰是替换目标不构成撞名（缺此豁免则
    // installPlugin 撞名检查恒拒自家重装腿）
    const installPath = installPathForNpm(parsed.parsed.pkg);
    deps.fs.rm(resolveInstallPath(deps.dataDir, installPath), { recursive: true, force: true });
    return installPlugin(deps, current.ref, { replacingId: id });
  }
  // git 重克隆（runGitInstall 目标在场先 rm——幂等腿复用）
  let product: InstallProduct;
  try {
    product = await runGitInstall(deps, parsed.parsed);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!product.manifest.ok) {
    rollbackInstall(deps, product.installPath);
    return { ok: false, message: `更新后清单校验失败（${id}）：${product.manifest.message}` };
  }
  const manifest = product.manifest.manifest;
  if (manifest.id !== id) {
    rollbackInstall(deps, product.installPath);
    return { ok: false, message: `更新后清单 id 变更（${id} → ${manifest.id}）——装机身份漂移拒（卸后重装走两步）` };
  }
  let declaredEvents: readonly string[];
  try {
    declaredEvents = await harvestEvents(
      deps,
      resolveInstallPath(deps.dataDir, product.installPath),
      product.installPath,
      manifest,
    );
  } catch (err) {
    rollbackInstall(deps, product.installPath);
    return {
      ok: false,
      message: `更新收割失败（${id}）——装机回滚：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const entry: PluginLedgerEntry = {
    ...current,
    commit: product.commit,
    installedAt: (deps.now ?? (() => new Date()))().toISOString(),
    installPath: product.installPath,
    declaredEvents,
  };
  upsertLedgerEntry(deps.dataDir, entry, deps.fs);
  return {
    ok: true,
    entry,
    text: `已更新：${id}（源 git，commit ${product.commit?.slice(0, 7) ?? '?'}）——下次启动装载生效`,
  };
}
