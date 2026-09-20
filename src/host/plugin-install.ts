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
 * 市场拷贝腿（03 §9.6 mp-3 装机咬合——唯一物理面新增）：marketplace install
 * 编舞经 opts.subdirCopy 进本执行器，落位 `plugins/market/<市场名>/<条目
 * 名>/`（无版本段——幂等 rm 重放）。字节源三境分派：git 语境相对源带
 * copyFrom = 市场缓存目录直拷（零 spawn，commit 取 ref 钉的 catalog sha）；
 * local 语境相对源 = 缓存目录内子目录直拷（B2 定形——拷贝腿落位独立于缓存
 * 目录，marketplace remove 清缓存不悬空装机物）；git-subdir 独立仓 = tmp
 * 克隆抽拷（clone → checkout → rev-parse HEAD 收割 commit）。拷贝经 fs
 * read/write 文本面——与 mp-2 缓存快照同限（v1 文本域；二进制资产市场分发
 * 超出缓存保真域，保真增强留后续批）。市场名段词法与 subpath 段折叠在本件
 * 自带本地小助手复验（§9.6 防线表同律——translate 层单源之外的第二执法
 * 位；本件不 import plugin-market——防上层回指成环）。
 *
 * 收割（§5.4 词表账本）：jiti 求值入口模块读 `events` 导出——「装机零生效」
 * 的唯一例外（仅模块求值，零 apply 零注册）；jiti 参数与装载器同形（虚拟面
 * 四键直注 + import 门禁 transform + fsCache 关——同律不因装机时点放宽）。
 * 纯声明包（declared-payload 态）零码收割（declaredEvents = []）。
 *
 * 失败回滚：装机物落位后清单校验/收割失败 = rm 装机物再拒（不留半装机残影
 * ——账本未落，回滚后两账一致空态）；update npm 重装腿旧树装前 rename 备份
 * （plugins/ 下点前缀同卷位），installPlugin 失败回迁归位——更新失败不坏
 * 旧版（npm 腿修笔，与 git 腿 tmp 克隆后落位的旧树保全律对齐）。
 *
 * spawn 注入面：测试注假件零真网络（npm/git 两执行器的 argv 断言 + 落账
 * 编舞可测）；local 源与收割真跑（本地 fixture 零网络）。
 */
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { promisify } from 'node:util';

import { createJiti } from 'jiti';

import { BaseError } from '../contracts/index.js';
import {
  assertInsideInstallSubtree,
  installPathForGit,
  installPathForLocal,
  installPathForNpm,
  ledgerPath,
  migrateEnabledRow,
  parentDir,
  readLedger,
  removeLedgerEntry,
  resolveInstallPath,
  upsertLedgerEntry,
} from './plugin-store.js';
import type { LifecycleAuditSink, PluginLedgerEntry, PluginLedgerMarket, PluginStoreFs } from './plugin-store.js';
import { parseManifest } from './manifest.js';
import type { PluginManifest } from './manifest.js';
import { createGateTransform } from './import-gate.js';
import { loadDefaultVirtualFaces, resolvePkgMain } from './loader.js';
// web 卫生件单源消费（market 腿 git 克隆守卫——§9.6 攻击表行；host→web 边
// 既有〔assembly/core-plugins 同族〕，ssrf 判定不另起炉灶）
import { assertPublicHost, defaultDnsResolver } from '../web/index.js';
import type { DnsResolver } from '../web/types.js';

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
 *
 * argv 选项位拒（mp 收尾批安全硬化——词法面单源，直装/市场两腿同执法）：
 * spec/url/ref 任一 '-' 起头即拒——这些字段最终落子进程 argv 的**位置参数
 * 位**（npm install `<spec>` / git clone `<url>` / git checkout `<ref>`），
 * '-' 起头会被 npm（nopt last-wins——可掀 '--ignore-scripts'/'--prefix'）
 * 或 git（'-oX://y' 解析为选项）按旗标解析，属 argv 注入面非坏词法豁免域
 * （与 market 装机腿主机校验的「显式动作豁免」分立——用户手打 '-x://y'
 * 同拒，因它从来不是合法 url/ref 形）。
 */
export function parsePluginRef(ref: string): PluginRefParse {
  if (ref.startsWith('npm:')) {
    const spec = ref.slice('npm:'.length);
    if (spec.length === 0) return { ok: false, message: 'npm ref 缺包名（形如 npm:acme-widgets@1.2.0）' };
    // '-' 起头拒：spec 整体落 npm install 位置参数位（'--ignore-scripts=false'
    // 形会被 npm 按旗标解析——last-wins 掀执行器自带防线）
    if (spec.startsWith('-')) {
      return {
        ok: false,
        message: `npm spec '-' 起头拒（"${spec}"）——spec 落 npm install 位置参数位会被按旗标解析（nopt last-wins 可掀 --ignore-scripts/--prefix）`,
      };
    }
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
    // '-' 起头拒：url 头段落 git clone 位置参数位（'-oX://y' 形会被 git 解析为选项位）
    if (spec.startsWith('-')) {
      return {
        ok: false,
        message: `git url '-' 起头拒（"${spec}"）——url 落 git clone 位置参数位会被按选项解析`,
      };
    }
    const hash = spec.lastIndexOf('#');
    if (hash >= 0) {
      const gitRef = spec.slice(hash + 1);
      if (gitRef.length === 0) return { ok: false, message: 'git ref 的 # 后为空（分支/tag/commit）' };
      // '-' 起头拒：ref 落 git checkout 位置参数位（'-b'/'--detach' 形选项位混淆）
      if (gitRef.startsWith('-')) {
        return {
          ok: false,
          message: `git ref '-' 起头拒（"${gitRef}"）——ref 落 git checkout 位置参数位会被按选项解析`,
        };
      }
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
  /**
   * DNS 解析位（market 腿 git url 克隆守卫的私网判定——web 卫生件
   * assertPublicHost 消费；缺省 node:dns 真身，测试注桩零网络）。
   */
  readonly resolveDns?: DnsResolver;
  /** git 克隆超时帽 ms（缺省 GIT_CLONE_TIMEOUT_MS——测试收紧用） */
  readonly cloneTimeoutMs?: number;
  /** jiti 工厂注入位（收割腿测试替身；缺省真 jiti） */
  readonly jitiFactory?: (pluginDir: string, pluginId: string) => ReturnType<typeof createJiti>;
  /**
   * 生命周期归因账 sink（05 §1.1 生命周期归因面行）：install 成功尾落
   * plugin/installed、update 成功尾落 plugin/updated（npm 重装腿经
   * replacingId 进 installPlugin 前必剥——错词防护）；缺席 = 零落账
   * （库件单机可用，CLI 面注入真身）。
   */
  readonly onLifecycleAudit?: LifecycleAuditSink;
}

/** install 结果（ok = 落账条目；拒 = message 呈现 CLI 退 1） */
export type InstallOutcome =
  | {
      readonly ok: true;
      readonly entry: PluginLedgerEntry;
      readonly text: string;
      /** 市场换血 id 漂移且旧 id 启用行随迁发生（§9.6 定形）——回执注记与 mount 指路行抑制的判定位 */
      readonly enabledCarried?: boolean;
    }
  | { readonly ok: false; readonly message: string };

/* ---------------- 装机编舞主入口 ---------------- */

/**
 * install 编舞（§5.4）：撞名拒（同 id 已装指路 update）→ 按源执行 → 清单
 * 校验 → 收割 → 落账。执行器产出 installPath + 凭证字段；收割失败/清单坏形
 * = 回滚装机物再拒（不留半装机残影）。core: 前缀 id 拒（官方件身份——非
 * 装机物）。`replacingId` = update 分派的换装豁免位（npm 重装腿复用本编舞
 * 时旧条目尚在场——恰是被替换者，不构成撞名；其余 id 照拒）。市场换血豁免
 * （§9.6 mp-3）：`market` 注记在场时同 provenance 旧条目自动充 replacingId
 * ——`marketplace install` 即换血重装（updatePlugin 拒文指路终点）。
 *
 * 市场咬合 opts（§9.6 mp-3——装机编舞恒复用零新机制，本函数是唯一装机入
 * 口）：`market` = 溯源注记落账位（direct/拷贝两腿皆落）；`subdirCopy` =
 * 拷贝腿参数（在场分派 runSubdirCopyInstall——仅 marketplace install 编舞
 * 传入，CLI `plugins install` 直装恒缺席）。
 */
export async function installPlugin(
  deps: InstallExecutorDeps,
  ref: string,
  opts: {
    readonly replacingId?: string;
    /** 市场溯源注记（§9.6 mp-3）——名段词法本地复验后落账 */
    readonly market?: PluginLedgerMarket;
    /** 拷贝腿参数（§9.6 mp-3——subpath 段折叠本地复验；copyFrom = git 语境缓存目录） */
    readonly subdirCopy?: { readonly subpath: string; readonly copyFrom?: string };
  } = {},
): Promise<InstallOutcome> {
  const parsed = parsePluginRef(ref);
  if (!parsed.ok) return parsed;
  // 市场溯源名段词法本地复验（§9.6 防线表——translate 层单源之外的第二执法
  // 位：market 名段直进 installPath 布局段，词法坏 = 布局路径注入面）
  if (opts.market !== undefined && !isValidMarketProvenance(opts.market)) {
    return {
      ok: false,
      message: `market 注记坏词法（name="${opts.market.name}" entry="${opts.market.entry}"）——名段须小写字母数字连字符点、首尾字母数字、≤64 字符`,
    };
  }
  // 账本前置读（坏账本拒写防覆盖——与 upsertLedgerEntry 内防线双检）
  const ledgerRead = readLedger(deps.dataDir, deps.fs);
  if (!ledgerRead.ok) {
    return {
      ok: false,
      message: `装机账本损坏（${ledgerPath(deps.dataDir)}）：${ledgerRead.reason}——拒写防覆盖（03 §5.4）`,
    };
  }
  // 市场换血豁免（§9.6 mp-3）：同 provenance（market.name + market.entry）旧条
  // 目恰是被替换者——`marketplace install` 是 updatePlugin 两拒文的换血指路
  // 终点，缺此豁免指路即死链。寻址键恒 provenance 非 id（装机 id 由清单承载
  // 与条目名解耦——git-subdir 形可装出 id ≠ 条目名的产物）；其余 id 照撞名律拒
  const marketReplacing =
    opts.market === undefined
      ? undefined
      : ledgerRead.entries.find(
          (e) => e.market !== undefined && e.market.name === opts.market!.name && e.market.entry === opts.market!.entry,
        );
  const replacingId = opts.replacingId ?? marketReplacing?.id;
  // 执行器先行（装机物落位 + manifest 读——失败红即拒，账面零动作）；
  // 拷贝腿在场优先分派（npm 源 + subdirCopy 组合结构性不可达——翻译层恒
  // direct，防御位拒不猜）
  let product: InstallProduct;
  try {
    if (opts.subdirCopy !== undefined) {
      if (parsed.parsed.source === 'npm') {
        throw new BaseError(
          'PLUGIN_INSTALL_FAILED',
          `npm 源与拷贝腿组合不可达（${ref}）——npm 形条目恒 direct 腿，翻译层产物异常`,
        );
      }
      if (opts.market === undefined) {
        throw new BaseError(
          'PLUGIN_INSTALL_FAILED',
          '拷贝腿须带 market 注记——布局段 plugins/market/<市场名>/<条目名>/ 需要名段（§9.6 mp-3）',
        );
      }
      product = await runSubdirCopyInstall(deps, parsed.parsed, opts.market, opts.subdirCopy);
    } else {
      product =
        parsed.parsed.source === 'npm'
          ? await runNpmInstall(deps, parsed.parsed)
          : parsed.parsed.source === 'git'
            ? await runGitInstall(deps, parsed.parsed, opts.market !== undefined) // market 腿受 SSRF 守卫
            : runLocalInstall(deps, parsed.parsed);
    }
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
  if (ledgerRead.entries.some((e) => e.id === manifest.id && e.id !== replacingId)) {
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
  // 落账（条目数组形原子写——plugin-store 执法）；market 溯源在场即落
  // （§9.6 mp-3——uninstall 寻址与呈现消费）
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
    ...(opts.market !== undefined ? { market: opts.market } : {}),
  };
  upsertLedgerEntry(deps.dataDir, entry, deps.fs);
  // 市场换血换代收尾（§9.6 mp-3）：装机 id 漂移（清单换代改名）时旧条目须撤
  // 账——否则同 provenance 双条目并存，`marketplace uninstall` 寻址恒多中拒；
  // 旧装机树为相对表示（装机子树内）且无他条目共享时连带清（引用计数判据与
  // uninstall 段② 同源；新树落位已由执行器幂等 rm 重放承载，此处只清旧位差集）。
  // mp 收尾批修笔（03 §9.6 mp-3 定形注④）：连带清判据放宽为「id 漂移 或
  // installPath 落位变化」——市场条目换源形（npm↔拷贝腿）重装时 id 稳定而落位
  // 换位（plugins/node_modules/<pkg> ↔ plugins/market/<市场名>/<条目名>/），旧位
  // 无人清即成无主残影（账本已覆写指新位，uninstall/upgrade 恒走新位）；撤账
  // （removeLedgerEntry）仍仅 id 漂移时执行——id 稳定时 upsert 已覆盖同一条目
  let rowMigrateNote = ''; // 启用行随迁失败注记（空 = 无随迁失败或无漂移）
  let enabledCarried = false; // 随迁是否发生（行面有动作）——回执尾行与 CLI mount 指路抑制的判定位
  let carriedFromId = ''; // 漂移源 id（随迁发生时必在场——回执换代注记用）
  if (marketReplacing !== undefined) {
    const oldAbs = resolveInstallPath(deps.dataDir, marketReplacing.installPath);
    const newAbs = resolveInstallPath(deps.dataDir, product.installPath);
    if (marketReplacing.id !== manifest.id) {
      removeLedgerEntry(deps.dataDir, marketReplacing.id, deps.fs);
      // 启用行随迁（§9.6 mp 收尾批定形）：旧 id 启用行（若在场）改写 id 为
      // 新 id（config/disabled/opens 全字段保形）——不随迁即悬空行（boot 对账
      // 永续 warn + 插件静默停载 + marketplace/plugins 两 uninstall 动词均清
      // 不掉）。随迁失败（enabled.yaml 坏形）不吞装机油——装机事实已落账，坏
      // 形行编辑面 readEnabledRowsForEdit fail-loud 已辖，此处以结文注记呈现
      const migrated = migrateEnabledRow(deps.dataDir, marketReplacing.id, manifest.id, deps.fs);
      if (!migrated.ok) {
        rowMigrateNote = `；注意：启用行随迁失败（${migrated.message}）`;
      } else {
        enabledCarried = migrated.carried;
        carriedFromId = marketReplacing.id;
      }
    }
    if (
      !isAbsolute(marketReplacing.installPath) &&
      oldAbs !== newAbs &&
      !ledgerRead.entries.some(
        (e) =>
          e.id !== marketReplacing.id &&
          e.id !== manifest.id &&
          resolveInstallPath(deps.dataDir, e.installPath) === oldAbs,
      )
    ) {
      assertInsideInstallSubtree(deps.dataDir, oldAbs); // 逃逸防线（同 uninstall 段②）
      deps.fs.rm(oldAbs, { recursive: true, force: true });
    }
  }
  // 生命周期归因账（05 §1.1）：装机成功事实落 audit_events——词形
  // {id, source, version}；version 位缺席不落键（git/local 源清单可能无
  // 版本位）。update npm 重装腿已在调用侧剥 sink；市场换血腿（mp-3）动词即
  // install——词形落 installed 属实（换装语义的 updated 词归 update 分派）
  deps.onLifecycleAudit?.('plugin/installed', {
    id: manifest.id,
    source: parsed.parsed.source,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
  });
  // 回执尾行随迁分形（§9.6 mp 收尾批定形）：随迁发生 = 启用态跨换代连续——
  // 尾行呈换代注记（指路 mount 会撞名拒，不再指）；未随迁 = 通用两步制尾行
  const tail = enabledCarried
    ? `——换血换代：${carriedFromId} → ${manifest.id}，启用行已随换代迁移（下次启动装载生效）`
    : '——装机零生效，启用走 mount（下次启动装载生效）';
  return {
    ok: true,
    entry,
    text: `已装机：${manifest.id}（源 ${parsed.parsed.source}，${product.installPath}）${tail}${rowMigrateNote}`,
    ...(enabledCarried ? { enabledCarried: true } : {}),
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

/**
 * npm 失败增补指路（两形分流——07 §5 provider 文案律落角）：
 *  - 真拒装形：stderr 含 eligible 词面（npm ≥11.5 静置窗判据生效的正当拒绝
 *    ——包龄不满窗，报文常伴 --min-release-age 字面）→ 指路等窗龄/调窗；
 *  - 旗标不识形：stderr 含 min-release-age / Unknown cli flag / unknown
 *    option（旧版 npm 不识旗标）→ 指路升级 npm ≥11.5 或 env 关窗。
 * 判序真拒装形先于旗标不识形：两形词面可同现（真拒装报文含旗标名），若旗标
 * 不识分支先判会给真拒装形「升级 npm」误诊（npm 已识旗标、判据正当生效）。
 */
function npmFailureMessage(err: unknown, flagText: string): string {
  const stderr = err instanceof Error ? ((err as Error & { stderr?: string }).stderr ?? '') : '';
  const message = err instanceof Error ? err.message : String(err);
  if (stderr.toLowerCase().includes('eligible')) {
    return `npm install 失败：${message}——包龄未满静置窗（真拒装非旗标不识）：等发布窗龄后再试，或设 ${MIN_RELEASE_AGE_ENV}=<分钟> 调窗（0 = 显式关窗）`;
  }
  const ageHint =
    stderr.includes('min-release-age') || stderr.includes('Unknown cli flag') || stderr.includes('unknown option')
      ? `——npm 不识 ${flagText}：--min-release-age 须 npm ≥11.5（npm -v 自查），或设 ${MIN_RELEASE_AGE_ENV}=0 关窗`
      : '';
  return `npm install 失败：${message}${ageHint}`;
}

/* ---------------- git 源执行器 ---------------- */

/**
 * git 克隆超时帽（ms）——与 plugin-market/fetch.ts MARKET_CLONE_TIMEOUT_MS
 * 同值（300s，§9.6 mp-4 定值）。本地重复定值非漂移：本件不 import
 * plugin-market（防上层回指成环——文件头注），跨文件同律单源以注释互指
 * 承载（MARKET_SEGMENT_RE 本地复验同先例）。
 */
const GIT_CLONE_TIMEOUT_MS = 300_000;

/** market 腿 git url 克隆协议白名单（http/https/git/ssh——file:// 等本地/特权协议拒） */
const MARKET_CLONE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'git:', 'ssh:']);

/**
 * 竞速超时执法（注入位安全）：本件 SpawnRunner 面无 signal 通道（真子进程
 * 与注桩假件同形），外层竞速保证帽值恒被执法（黑洞地址挂死也收口）；子进程
 * 本体由 OS 自理（v1 不持 kill 句柄——与 plugin-market/fetch.ts 同律）。
 */
function withTimeoutMs<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时帽（${ms}ms）触发——中止等待`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * market 腿 git url 克隆守卫（SSRF 防线——§9.6 攻击表「market 装机腿 git
 * clone 新外联面」行）：catalog 授权 url 的装机克隆前置受检——
 *  1. 协议白名单 http/https/git/ssh（file:// 等本地/特权协议拒）；
 *  2. 私网/保留段拒（字面 + DNS——web 卫生件 assertPublicHost 单源消费；
 *     scp 短手形〔git@host:path〕无协议位，合成 ssh:// 伪 url 受检）。
 * 用户手打直装腿（market 注记缺席）不经本守卫——显式动作豁免（add 源
 * fetch 腿同裁决）；DNS 解析位全注入（测试零网络律）。
 */
async function assertClonableMarketGitUrl(deps: InstallExecutorDeps, url: string): Promise<void> {
  // scp 短手形：git@host:path → ssh://git@host/path（new URL 不识 scp 形）
  const candidate = /^git@[^/:]+:.+$/.test(url) ? `ssh://${url.replace(/^git@([^/:]+):/, 'git@$1/')}` : url;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BaseError('PLUGIN_INSTALL_FAILED', `market 腿 git url 不可解析（${url}）`);
  }
  if (!MARKET_CLONE_PROTOCOLS.has(parsed.protocol)) {
    throw new BaseError(
      'PLUGIN_INSTALL_FAILED',
      `market 腿 git url 协议拒（${parsed.protocol} 不在白名单 http/https/git/ssh）：${url}`,
    );
  }
  await assertPublicHost(parsed, deps.resolveDns ?? defaultDnsResolver);
}

/**
 * git 源执行：tmp 克隆（默认 branch）→ checkout gitRef（detach——branch/
 * tag/commit 皆可）→ HEAD commit 收割 → 落位 `plugins/git/<host>/<首段>/
 * <repo>/`（目标在场先 rm——幂等重装/撞名目录收敛）。克隆浅化不启用
 * （checkout 任意历史 commit 需全史——--depth 与 commit ref 冲突）。
 */
async function runGitInstall(
  deps: InstallExecutorDeps,
  parsed: { readonly url: string; readonly gitRef?: string },
  guarded: boolean, // market 腿守卫位——catalog 授权 url 受检，用户手打直装显式动作豁免
): Promise<InstallProduct> {
  // 守卫前置（mkdtemp 之前——拒形零 tmp 开销，clone 永不发出）
  if (guarded) await assertClonableMarketGitUrl(deps, parsed.url);
  const tmp = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), 'berry-git-install-'));
  try {
    await withTimeoutMs(
      deps.spawn.run('git', ['clone', parsed.url, tmp], {}),
      deps.cloneTimeoutMs ?? GIT_CLONE_TIMEOUT_MS,
      'git clone',
    );
    if (parsed.gitRef !== undefined) {
      await deps.spawn.run('git', ['-C', tmp, 'checkout', '--detach', parsed.gitRef], {});
    }
    const head = await deps.spawn.run('git', ['-C', tmp, 'rev-parse', 'HEAD'], {});
    const commit = head.stdout.trim();
    const installPath = installPathForGit(parsed.url); // 坏 url 抛 PLUGIN_INSTALL_FAILED——ref 前置已校，保底
    const target = resolveInstallPath(deps.dataDir, installPath);
    // rm 前装机子树断言（防线双保险——§9.6 布局段四处全验）：installPathForGit
    // 已点段拒，此处再拦 target 落装机子树外的任何形（与 uninstall 段②/
    // installPlugin 换装位同防线）——无断言时下句 rm 递归可抹任意目录
    assertInsideInstallSubtree(deps.dataDir, target);
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

/* ---------------- 市场拷贝腿执行器（§9.6 mp-3——唯一物理面新增） ---------------- */

/** 市场名段词法（本地复验位——与 plugin-market isValidNameSegment 同律单源对拍） */
const MARKET_SEGMENT_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** 市场名段长度帽（同 plugin-market MAX_NAME_SEGMENT_LENGTH=64） */
const MAX_MARKET_SEGMENT_LENGTH = 64;

/** 溯源注记两段词法复验（布局段拼接位——坏词法 = 路径注入面） */
function isValidMarketProvenance(market: PluginLedgerMarket): boolean {
  const ok = (s: string) => s.length > 0 && s.length <= MAX_MARKET_SEGMENT_LENGTH && MARKET_SEGMENT_RE.test(s);
  return ok(market.name) && ok(market.entry);
}

/**
 * subpath 段折叠（本地复验位——与 plugin-market foldRelativeSegments 同律）：
 * '.' 段丢弃、'..' 段出界返 null（逃逸拒）、'..x' 等合法目录名不误伤；
 * 折叠后空 = 拒（拷贝腿须指非根子目录）。
 */
function foldSubdirSegments(subpath: string): readonly string[] | null {
  const folded: string[] = [];
  for (const segment of subpath.split('/')) {
    if (segment === '' || segment === '.') continue; // 空段（'//'）与自指段丢弃
    if (segment === '..') {
      if (folded.length === 0) return null; // 出界——逃逸拒
      folded.pop();
    } else {
      folded.push(segment);
    }
  }
  return folded.length > 0 ? folded : null;
}

/** sha 词法（本地复验位——copyFrom 腿 commit 取 ref 钉的 catalog sha 前校） */
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/;

/** 市场布局段前缀（§9.6 布局：`plugins/market/<市场名>/<条目名>/`——无版本段） */
const MARKET_SEGMENT_PREFIX = join('plugins', 'market');

/** installPath 是否市场布局段（update 分派拷贝腿拒判据——布局签名单源） */
function isMarketLayoutPath(installPath: string): boolean {
  return installPath.startsWith(`${MARKET_SEGMENT_PREFIX}${sep}`);
}

/**
 * 目录树拷贝（fs read/write 文本面——与 mp-2 缓存快照同限的 v1 文本域）：
 * 眺空目录保形（mkdir）；非目录非文件的悬挂缺席物不拷（readdir 与 read 双
 * null = 缺席——不造物不猜）。
 */
function copyTreeViaFs(fs: PluginStoreFs, src: string, dst: string): void {
  fs.mkdir(dst, { recursive: true });
  for (const name of fs.readdir(src) ?? []) {
    const from = join(src, name);
    const to = join(dst, name);
    const children = fs.readdir(from);
    if (children !== null && children.length > 0) {
      copyTreeViaFs(fs, from, to); // 子目录——递归
    } else {
      const text = fs.read(from);
      if (text !== null) {
        fs.write(to, text); // 文件——拷贝
      } else if (children !== null) {
        fs.mkdir(to, { recursive: true }); // 空目录——保形
      }
    }
  }
}

/**
 * 市场拷贝腿执行（§9.6 mp-3）：字节源三境分派 → staging 拷贝 → rename 落
 * 位 `plugins/market/<市场名>/<条目名>/`（目标在场先 rm——幂等重放；无版本
 * 段）。三境：
 *  - copyFrom 在场（git 语境相对源）：缓存目录直拷零 spawn；commit 取 ref
 *    钉的 catalog sha（7-40 位十六进制校验通过才落）；
 *  - local ref：源目录 = ref 路径内子目录（B2 定形——缓存目录即字节源）；
 *  - git ref 无 copyFrom（git-subdir 独立仓）：tmp 克隆 → checkout →
 *    rev-parse HEAD 收割 commit → 抽拷子目录。
 * staging 同 runGitInstall 律（tmpRoot mkdtemp + rename；finally force rm
 * 收尾幂等——rename 成功后 tmp 已不存在）。
 */
async function runSubdirCopyInstall(
  deps: InstallExecutorDeps,
  parsed: ParsedPluginRef,
  market: PluginLedgerMarket,
  subdirCopy: { readonly subpath: string; readonly copyFrom?: string },
): Promise<InstallProduct> {
  // subpath 段折叠复验（防线第二执法位——逃逸拒）
  const folded = foldSubdirSegments(subdirCopy.subpath);
  if (folded === null) {
    throw new BaseError(
      'PLUGIN_INSTALL_FAILED',
      `拷贝腿 subpath 逃逸拒（"${subdirCopy.subpath}"）——'..' 段出装机源目录（§9.6 防线表）`,
    );
  }
  // 布局段（名段词法已在 installPlugin 前置复验——此处仅拼接）
  const installPath = join('plugins', 'market', market.name, market.entry);
  const target = resolveInstallPath(deps.dataDir, installPath);

  // —— 字节源三境分派 ——
  let sourceDir: string;
  let commit: string | undefined;
  let cloneTmp: string | undefined; // 克隆境中转站（finally 清场锚）
  if (subdirCopy.copyFrom !== undefined) {
    // 境一：git 语境缓存直拷——ref 钉的 catalog sha 即 commit 凭证（缓存无
    // .git 可收割，sha 由翻译层从源清单 commit 位钉入 ref）
    if (parsed.source !== 'git') {
      throw new BaseError(
        'PLUGIN_INSTALL_FAILED',
        `copyFrom 拷贝腿仅适用 git ref（得 "${parsed.source}"）——编舞参数错配`,
      );
    }
    if (parsed.gitRef === undefined || !COMMIT_SHA_RE.test(parsed.gitRef)) {
      throw new BaseError(
        'PLUGIN_INSTALL_FAILED',
        `copyFrom 拷贝腿 ref 须钉 sha（得 "${parsed.gitRef ?? '空'}"）——缓存直拷的 commit 凭证位`,
      );
    }
    sourceDir = join(subdirCopy.copyFrom, ...folded);
    commit = parsed.gitRef;
  } else if (parsed.source === 'local') {
    // 境二：B2 定形——local 缓存目录内子目录直拷（零 spawn 零凭证）
    sourceDir = join(parsed.path, ...folded);
  } else if (parsed.source === 'git') {
    // 境三：git-subdir 独立仓——tmp 克隆抽拷（HEAD commit 收割）。三笔 spawn
    // 全程在清场保护内：克隆网络失败等任意 throw 位先自清中转站再上浮
    //（fetch.ts「失败位 tmp 自清」同契约——mkdtemp 与 staging 落位间不得留
    // 无主 berry-market-clone-* 残影；637 行「finally 清场锚」的完整兑现）
    cloneTmp = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), 'berry-market-clone-'));
    try {
      // market 腿守卫（拷贝腿恒市场 provenance——§9.6 攻击表 market 装机腿行；
      // 拒形由本块 catch 位 tmp 自清承接）
      await assertClonableMarketGitUrl(deps, parsed.url);
      await withTimeoutMs(
        deps.spawn.run('git', ['clone', parsed.url, cloneTmp], {}),
        deps.cloneTimeoutMs ?? GIT_CLONE_TIMEOUT_MS,
        'git clone',
      );
      if (parsed.gitRef !== undefined) {
        await deps.spawn.run('git', ['-C', cloneTmp, 'checkout', '--detach', parsed.gitRef], {});
      }
      const head = await deps.spawn.run('git', ['-C', cloneTmp, 'rev-parse', 'HEAD'], {});
      commit = head.stdout.trim();
    } catch (err) {
      deps.fs.rm(cloneTmp, { recursive: true, force: true }); // 克隆失败位 tmp 自清
      throw err;
    }
    sourceDir = join(cloneTmp, ...folded);
  } else {
    // npm + subdirCopy 组合防御（分派位已拒——类型穷尽后的不可达防线，不静默）
    throw new BaseError(
      'PLUGIN_INSTALL_FAILED',
      `拷贝腿不适用 npm ref（不可达防线——npm+subdirCopy 组合应已在分派位拒）`,
    );
  }

  // 源缺席诚实拒（缓存失联/子目录漂移——不猜不静默空拷）
  if (deps.fs.readdir(sourceDir) === null) {
    if (cloneTmp !== undefined) deps.fs.rm(cloneTmp, { recursive: true, force: true });
    throw new BaseError(
      'PLUGIN_INSTALL_FAILED',
      `拷贝源目录缺席（${sourceDir}）——市场缓存失联，先 marketplace remove 该源后重新 add`,
    );
  }

  // staging 拷贝 → rename 落位（同 runGitInstall 律；目标在场先 rm 幂等）
  const staging = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), 'berry-market-install-'));
  try {
    copyTreeViaFs(deps.fs, sourceDir, staging);
    deps.fs.mkdir(parentDir(target), { recursive: true });
    deps.fs.rm(target, { recursive: true, force: true }); // 幂等（在场旧树先清）
    deps.fs.rename(staging, target);
    return { installPath, manifest: readManifestAt(deps, installPath), commit, version: undefined };
  } finally {
    if (cloneTmp !== undefined) deps.fs.rm(cloneTmp, { recursive: true, force: true }); // 克隆中转站清场
    deps.fs.rm(staging, { recursive: true, force: true }); // rename 成功后 staging 已不存在——force 幂等
  }
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

/** npm 重装腿备份位前缀（plugins/ 下点前缀目录——npm --prefix 不动未知点目录，同卷保 rename） */
const NPM_UPDATE_BACKUP_PREFIX = '.npm-update-bak-';

/**
 * 旧装机树走位到备份（update npm 重装腿前置修笔——先 rm 后装失败即装机树
 * 尽失坏态）：target 在场才动作——rename 到 plugins/ 下点前缀临时目录
 * （与装机树同卷——rename 不跨设备；npm --prefix 装机不扫描点前缀未知
 * 目录）；缺席返回 undefined（与旧 rm force 幂等语义等价——无旧树可失）。
 * 顺带收敛历史残影（进程崩溃等遗留的备份位目录——幂等 rm，与「半装残影
 * 经重装收敛」同律）。
 */
function stageOldNpmTreeForUpdate(deps: InstallExecutorDeps, target: string): string | undefined {
  if (deps.fs.readdir(target) === null) return undefined; // 旧树缺席——无可备份
  const pluginsDir = join(deps.dataDir, 'plugins');
  for (const name of deps.fs.readdir(pluginsDir) ?? []) {
    if (!name.startsWith(NPM_UPDATE_BACKUP_PREFIX)) continue;
    try {
      deps.fs.rm(join(pluginsDir, name), { recursive: true, force: true });
    } catch {
      // 残影收敛失败不挡本次 update（新备份 mkdtemp 唯一名不冲突）
    }
  }
  const backupRoot = mkdtempSync(join(pluginsDir, NPM_UPDATE_BACKUP_PREFIX));
  deps.fs.rename(target, join(backupRoot, 'tree'));
  return backupRoot;
}

/**
 * 备份回迁（update npm 重装腿失败路径——installPlugin 全部失败形统一辖）：
 * 清 target 新装残影 → rename 旧树归位 → 清备份空壳。返回结文注记（空 =
 * 无备份可回迁；非空 = 回迁结果呈现——回迁成功注记旧版继续可用，回迁失败
 * 指路重试，均不吞主错误）。回迁后账本/启用行（失败路径本就未动）与旧树
 * 自洽——插件保持可用（装载判据 package.json 在场）。
 */
function restoreStagedNpmTree(deps: InstallExecutorDeps, target: string, backup: string | undefined): string {
  if (backup === undefined) return ''; // 装机树本就缺席——无回迁语义
  try {
    deps.fs.rm(target, { recursive: true, force: true }); // 新装残影清（rollbackInstall 多数路径已清——幂等）
    deps.fs.rename(join(backup, 'tree'), target); // 旧树归位
    deps.fs.rm(backup, { recursive: true, force: true }); // 备份空壳清
    return '——旧版装机树已回迁原位（更新失败，旧版继续可用）';
  } catch (err) {
    return `——警告：旧版装机树回迁失败（${err instanceof Error ? err.message : String(err)}）——重试 update 或卸载重装`;
  }
}

/**
 * update 编舞（§5.4 按源分派）：npm 重装（拉最新满足窗龄版——`--save-exact`
 * 锚树 + 无版本 spec = latest 受 min-release-age 窗检；新 integrity/version
 * 落账；旧树装前 rename 备份、失败回迁——npm 腿修笔，网络断等失败不再
 * 留文件缺失坏态）；git 删目录按原 ref 重克隆（新 commit）；local no-op
 * （源动了下次装载即新——§5.4 既有条款）。enabled 行不动（装机物换血、
 * 行引用 id 不变）。
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
    // 市场拷贝腿装机物（§9.6 mp-3 B2）：非直引——「源动即生效」文案不适用，
    // 换血走 marketplace install 重装（拷贝参数不入账本，no-op 腿不可复算）
    if (current.market !== undefined) {
      return {
        ok: true,
        entry: current,
        text: `市场拷贝腿装机物不走 local 直引 no-op——换血重装：berry marketplace install ${current.market.entry}@${current.market.name}（03 §9.6）`,
      };
    }
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
    // 重装：旧装机树 rename 备份走位后再装（spec 无版本 = 拉最新满足窗龄；
    // upsert 后见胜出）。修笔（npm 腿先删后装失败坏态）：此前 rm 先行——npm
    // 网络断等失败即旧树尽失、账本/启用行悬空引用 → 装载行级隔离降级（坏态
    // 直至重试成功或卸载重装）；staging 化后失败回迁旧树，旧版自洽可用。
    // 换装豁免位传被替换 id——旧条目恰是替换目标不构成撞名（缺此豁免则
    // installPlugin 撞名检查恒拒自家重装腿）。sink 剥离后再传——防
    // installPlugin 成功尾落错词 installed（本腿语义是 updated）。market
    // 溯源显式透传（§9.6 mp-3——installPlugin 落账以 opts 为准，缺此透传
    // 市场装机物换版即丢 provenance）
    const { onLifecycleAudit, ...rest } = deps;
    const installPath = installPathForNpm(parsed.parsed.pkg);
    const target = resolveInstallPath(rest.dataDir, installPath);
    const backup = stageOldNpmTreeForUpdate(rest, target); // 旧树在场才备份
    let outcome: InstallOutcome;
    try {
      outcome = await installPlugin(rest, current.ref, {
        replacingId: id,
        ...(current.market !== undefined ? { market: current.market } : {}),
      });
    } catch (err) {
      // 防御位（installPlugin 内部全 catch 理论不 throw）——回迁后原样上浮
      restoreStagedNpmTree(rest, target, backup);
      throw err;
    }
    if (!outcome.ok) {
      // 装失败（npm 抛错/清单拒/收割失败——installPlugin 全失败形统一辖）：
      // 回迁旧树，账本/启用行全程未动即与旧树自洽；回迁结果尾注呈现
      outcome = { ...outcome, message: `${outcome.message}${restoreStagedNpmTree(rest, target, backup)}` };
    } else if (backup !== undefined) {
      // 装成功——备份位清场（清场失败不吞装机成功：新树已落位落账，点前缀
      // 残影由下次 staging 前置收敛位幂等回收）
      try {
        rest.fs.rm(backup, { recursive: true, force: true });
      } catch {
        // 幂等收敛位兜底（见 stageOldNpmTreeForUpdate 残影清扫）
      }
    }
    if (outcome.ok && onLifecycleAudit !== undefined) {
      // 换装成功事实（05 §1.1）：from 缺席容许（旧账本无版本位）；npm 腿
      // version 恒在（lock 收割），to 缺席不设防（兜底与 git 腿同形）
      onLifecycleAudit('plugin/updated', {
        id,
        ...(current.version !== undefined ? { from: current.version } : {}),
        ...(outcome.entry.version !== undefined ? { to: outcome.entry.version } : {}),
      });
    }
    return outcome;
  }
  // git 重克隆（runGitInstall 目标在场先 rm——幂等腿复用）。市场拷贝腿装机
  // 物（布局段签名）拒：拷贝参数（subpath/copyFrom）不入账本，重克隆腿不可
  // 复算重拷——诚实拒指路 marketplace install 重装（§9.6 mp-3）；git direct
  // 腿市场装机物（plugins/git/ 布局）照走重克隆，provenance 经 ...current 展开幸存
  if (current.market !== undefined && isMarketLayoutPath(current.installPath)) {
    return {
      ok: false,
      message: `插件 ${id} 是市场拷贝腿装机物——拷贝参数不入账本，plugins update 不可复算重拷；重装走 berry marketplace install ${current.market.entry}@${current.market.name}（03 §9.6）`,
    };
  }
  let product: InstallProduct;
  try {
    // market 装机物（git direct 布局）照走守卫重克隆——provenance 在场即受检
    product = await runGitInstall(deps, parsed.parsed, current.market !== undefined);
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
  // 换装成功事实（05 §1.1）：git 溢词形 {id, from?, to}——但 git 源
  // entry.version 继承旧账恒不变（变更实质在 commit 位），落 version 会造
  // 「版本换血」误读；from/to 落 commit 值（git 源的版本标识即 commit——
  // 03 §5.4 精确锁定语义；npm 腿同键落 semver，源别可回 installed 词
  // source 位对拍）。旧 commit 缺席（早期账本）from 不落
  deps.onLifecycleAudit?.('plugin/updated', {
    id,
    ...(current.commit !== undefined ? { from: current.commit } : {}),
    ...(product.commit !== undefined ? { to: product.commit } : {}),
  });
  return {
    ok: true,
    entry,
    text: `已更新：${id}（源 git，commit ${product.commit?.slice(0, 7) ?? '?'}）——下次启动装载生效`,
  };
}
