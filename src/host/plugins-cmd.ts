/**
 * host/plugins-cmd — `plugins` 子命令族 CLI 入口（03 §5.8 三面同源之 CLI 面；
 * 07 §5 命令族；批 12f-3 骨架 → 成熟度缺口 #10 装机面落码批写真身）。
 *
 * 子动词分账：
 *  - **list**：装载态清单三分区（启用/失败/禁用）。走与 dump-config **同一
 *    合成代码路径**（真数据目录读侧 + 主库零落盘 + 不占标记）——装载面必须
 *    跑（报告语义）。
 *  - **check**：API 治理三色体检真身（03 §8.9 ag 批落码定形注——纯只读
 *    零装配：装机账本 × 杄件装机目录 package.json api 块 × 宿主 apiVersion
 *    三源纯文件面 + 黄腿 durable 事件直查，不走装载器不 boot 运行时）。
 *  - **install <ref>**：三源装机（plugin-install 执行器——ref 单参自含源前缀
 *    与账本同词法；--min-release-age 旗标逐次覆盖 env 静置窗）。
 *  - **uninstall <id>**：双相（无 --confirm = inspect 只读报告 / 加 = execute
 *    四段清算——plugin-uninstall 编舞；--data keep|purge 缺省 keep，--data
 *    单独在场即拒——execute 载荷不静默猜）。开库走 Persistence 直开 +
 *    HOST_MIGRATION_TAIL 全链（零装配直开库纪律——sessions/credentials 同形）。
 *  - **mount/unmount/toggle <id>**：enabled.yaml 行编辑（plugin-store 行编辑
 *    面；mount 前置查账本——core: id 或已装机 id 才可挂）。
 *  - **update <id>**：按源分派（plugin-install updatePlugin）。
 *
 * 写动词生效时点：CLI 短命进程不装配装载器——写侧动作**下次启动装载生效**
 * （「装机零生效」语义的 CLI 面呈现；TUI 侧 /reload 排队编舞已落——assembly
 * 编舞器 + 'reload' 命令注册，/reload 批收官）。
 *
 * 退出码：0 成功 / 1 执行失败（结算文本含原因）/ 用法错 2 归解析层。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdout as processStdout, stderr as processStderr } from 'node:process';
import { fileURLToPath } from 'node:url';

import { Persistence, createAuditFace, resolveDataDir } from '../persist/index.js';
import { adjudicateApiGate, compareApiVersions } from '../contracts/api.js';

import type { PluginsCommand } from './cli.js';
import { assembleHostStack } from './assembly.js';
import { formatPluginFailureText } from './boot-failures.js';
import type { CorePluginReference } from './loader.js';
import { checkPluginId, parseManifest } from './manifest.js';
import { installPlugin, updatePlugin, createDefaultSpawnRunner } from './plugin-install.js';
import type { InstallExecutorDeps } from './plugin-install.js';
import { executeUninstall, inspectUninstall } from './plugin-uninstall.js';
import type { UninstallDataAction, UninstallDeps } from './plugin-uninstall.js';
import {
  ledgerPath,
  mountRow,
  readLedger,
  resolveInstallPath,
  toggleRow,
  unmountRow,
  createPluginStoreFs,
} from './plugin-store.js';
import type { LifecycleAuditSink } from './plugin-store.js';
import type { HostRuntime } from './runtime.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';

/** 入口选项（main 分派接线 + 测试注入面） */
export interface PluginsEntryOptions {
  /** 宿主版本（list 装配路径消费） */
  readonly version: string;
  /** 数据目录（缺省 resolveDataDir()——list 同构读侧/check 账本读侧） */
  readonly dataDir?: string;
  /** env 面（缺省 process.env） */
  readonly env?: Record<string, string | undefined>;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** core: 官方件注册表（测试注入面——main 现状空注册表，15 件入册归装载集成批） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
}

/** plugins 子命令族主入口。返回进程退出码（0/1；用法错 2 归解析层） */
export async function runPluginsEntry(sub: PluginsCommand, options: PluginsEntryOptions): Promise<number> {
  switch (sub.sub) {
    case 'list':
      return runList(options);
    case 'check':
      return runCheck(options);
    case 'install':
      return runInstall(sub.ref, sub.minReleaseAge, options);
    case 'uninstall':
      return runUninstall(sub.id, sub.confirm, sub.dataAction, options);
    case 'mount':
    case 'unmount':
    case 'toggle':
      return runRowVerb(sub.sub, sub.id, options);
    case 'update':
      return runUpdate(sub.id, options);
  }
}

/** list：同一合成代码路径装载 → 三分区人读输出（07 §5「装载态清单」） */
async function runList(options: PluginsEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  // dataDir 解析与其他五动词同律（?? resolveDataDir()——env 梯子 BERRY_AGENT_DATA_DIR
  // 由此接通；2026-09-13 可观测性批 obs-c 修：修前条件展开在 undefined 时省略
  // dataDir ⇒ memory 诊断形 dataDir=null ⇒ enabled.yaml/账本整跳 ⇒ 磁盘装机
  // 行三区皆隐〔真模型六轮实机实证：装+mount 后 list 仍只呈 16 core 件〕）
  const dataDir = options.dataDir ?? resolveDataDir();
  const assembly = await assembleHostStack({
    runtime: {
      dataDir,
      memory: true, // 同构诊断形（与 dump-config 同形——真盘读侧 + 主库零落盘）
    },
    noPlugins: false, // list 语义 = 报告装载态——装载面必须跑（无 --no-plugins 旗标面）
    debug: false,
    version: options.version,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
    ...(options.corePlugins !== undefined ? { corePlugins: options.corePlugins } : {}),
  });
  if (!assembly.ok) {
    writeErr(assembly.message);
    return assembly.exitCode;
  }
  try {
    const { activated, failed, skipped } = assembly.boot.report;
    const lines: string[] = [];
    lines.push(`启用（${activated.length}）：`);
    for (const a of activated)
      lines.push(
        `  ${a.id}` +
          `${a.skillDirs.length > 0 ? `  技能目录：${a.skillDirs.join('、')}` : ''}` +
          `${a.agentDirs.length > 0 ? `  子代理目录：${a.agentDirs.join('、')}` : ''}`,
      );
    lines.push(`失败（${failed.length}）：`);
    for (const f of failed) lines.push(`  ${f.id}  ${formatPluginFailureText(f)}`);
    lines.push(`禁用（${skipped.length}）：`);
    for (const s of skipped) lines.push(`  ${s.id}  ${s.reason}`);
    writeOut(lines.join('\n'));
    return 0;
  } finally {
    await assembly.runtime.shutdown();
  }
}

/* ---------------- check：三色体检真身（03 §8.9 ag 批落码定形注） ---------------- */

/** check 行分桶（渲染序 = 分桶序：绿 → 红 → legacy → 黄） */
type CheckRow =
  | {
      readonly kind: 'green';
      readonly id: string;
      readonly min: string;
      readonly target: string;
      readonly effectiveTarget: string;
      /** 宿主 < target（钳制出口——行内注 min(宿主, target)） */
      readonly clamped: boolean;
    }
  | {
      readonly kind: 'red';
      readonly id: string;
      /** 断裂消息（出口 1 = 三段消息直呈；悬空/坏清单 = 自家诊断文本） */
      readonly message: string;
      /** 三值矩阵行（min/target/宿主）——仅版本断裂腿在场，悬空腿缺席 */
      readonly matrix: string | undefined;
    }
  | { readonly kind: 'legacy'; readonly id: string }
  | { readonly kind: 'yellow'; readonly id: string; readonly count: number };

/**
 * 宿主 apiVersion 直读（03 §8.1 独立号——API 面版本，与包 version 分立）。
 * **与 main.ts readVersion 同文件同源**：仓库根 package.json 的 version +
 * apiVersion 双值同文件（src 与 dist 同相对深度 '../../package.json'——
 * DP2「readVersion 同源补读」的同源位，本面不 import main.ts〔宿主入口
 * 归他件域〕）。缺席兜底 '1.0' = 首快照号（boot options.apiVersion 缺省
 * 同值——防御位，仓库 package.json 恒有该字段）。
 */
function readHostApiVersion(): string {
  const pkgUrl = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { apiVersion?: string };
  return pkg.apiVersion ?? '1.0';
}

/**
 * 黄腿遥测：durable 事件 `plugin/deprecation-used` 直查（03 §8.7 obs 可禁用
 * 降级语义的正道形——不为可禁用 core:obs 件造静默依赖，queryEvents 可达即
 * 信息同构、聚合只省查询成本）。逐插件计数 → 黄行料源；**直查空集即无黄行**
 * （v1 写点延迟触发——首个 deprecated 符号进 DEP 窗日，结构性空集是正确态）。
 *
 * 纯只读纪律：sessions.db 缺席 = 零 durable 事件，**不开库不造文件**（首启/
 * 纯装机形零负担）；在场才经 Persistence 公开面（零装配直开库——uninstall
 * 同形）直查。开库/查询失败 = 降级（warn + 返回 null——黄腿不可用不拖垮
 * 绿/红主面，退出码仍以红为轴）。载荷插件 id 键 = `pluginId`（§8.7「插件
 * id + DEP 编号」——写点延迟触发，读侧宽容：缺席归「(未知插件)」桶不丢计数）。
 */
async function collectDeprecationUsed(
  dataDir: string,
  warn: (message: string) => void,
): Promise<Map<string, number> | null> {
  const dbPath = join(dataDir, 'sessions.db');
  if (!existsSync(dbPath)) return new Map(); // 库缺席 = 零事件——零开库（check 纯只读不造库）
  let persistence: Persistence;
  try {
    // dbPath 显式随 dataDir（CLI 语义同 uninstall/审计腿——库随 --data-dir 走）
    persistence = Persistence.open({
      dataDir,
      dbPath,
      migrations: HOST_MIGRATION_TAIL,
      warn: (message) => warn(`[check] ${message}`),
    });
  } catch (err) {
    warn(`warn：用废弃遥测库不可开（${err instanceof Error ? err.message : String(err)}）——本报告不含黄腿面`);
    return null;
  }
  try {
    const counts = new Map<string, number>();
    let cursor: string | null = null;
    let pages = 0;
    // 游标分页直查 + 页护栏（obs service 同律防坏游标死循环）。页帽显式传
    // limit: 10_000 = queryEvents 硬帽（缺省仅 1000/页——不传则真帽 6.4 万笔
    // 与宣称不符；显式传后 64 页 = 64 万笔封顶，与 obs service 同律）
    const pageLimit = 10_000;
    do {
      const page = persistence.store.queryEvents({ types: ['plugin/deprecation-used'], cursor, limit: pageLimit });
      for (const event of page.events) {
        const pid = (event.data as { pluginId?: unknown } | null)?.pluginId;
        const key = typeof pid === 'string' && pid.length > 0 ? pid : '(未知插件)';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      cursor = page.nextCursor;
    } while (cursor !== null && ++pages < 64);
    if (cursor !== null) {
      // 护栏到顶 = 尚有余页未扫——静默截断会让本计数（§8.7 删除时点裁决料源）
      // 低估在用面，warn 使截断可见
      warn('warn：用废弃遥测分页护栏到顶（64 页）——计数可能低估（尚有余页未扫）');
    }
    return counts;
  } catch (err) {
    warn(`warn：用废弃遥测查询失败（${err instanceof Error ? err.message : String(err)}）——本报告不含黄腿面`);
    return null;
  } finally {
    await persistence.close();
  }
}

/**
 * check：API 治理三色体检真身（03 §8.9——`berry plugins check` 只读体检）。
 *
 * 数据面纯只读零装配：装机账本 + 杄件装机目录 package.json api 块 + 宿主
 * apiVersion（readHostApiVersion 同源直读）三源纯文件面，不 boot 插件运行
 * 时；黄腿遥测 = durable 事件直查（collectDeprecationUsed）。裁决核 =
 * **adjudicateApiGate 纯函数直调**（import 自 contracts/api——判据与装载门
 * 单源，不走装载器）；清单面先经 parseManifest（与 boot 读侧同一校验单源
 * ——坏清单在此即断裂，与装载 failed 分区同真相）。
 *
 * 三色 + legacy 呈现形（§8.9 ag 批定形注——v1 射程）：
 *  - **绿** = admit（钳制/兼容两出口同绿——生效 target = min(宿主, target)，
 *    钳制时行内注明）；
 *  - **红** = 出口 1 拒载（三段消息 expected/actual/升级指引 + 三值矩阵行
 *    min/target/宿主；悬空装机记录/坏清单同归红族 fail-closed 拒猜）；
 *  - **legacy** = api 块缺席（未声明行单列不计红——点火前与装载门出口 4
 *    容忍态同口径，提示补声明）；
 *  - **黄** = plugin/deprecation-used 直查驱动（空集无黄行；替代指引与
 *    死期渲染料源 = 废弃注册簿，随写点延迟触发日到场）。
 *
 * 退出码恒以红为轴：任红 = 1，全绿 = 0——黄/legacy 不改退出码。
 * 账本缺席/为空 = 零装机无可体检项（exit 0——「无断裂」成立，既有行为保）。
 */
async function runCheck(options: PluginsEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  let raw: string | null = null;
  try {
    raw = readFileSync(ledgerPath(dataDir), 'utf8');
  } catch {
    raw = null; // 缺席 = 零装机（ENOENT 同义——首启零文件零负担）
  }
  if (raw === null || raw.trim() === '' || raw.trim() === '{}') {
    writeOut('装机账本缺席或为空——无可体检项（通过）');
    return 0;
  }
  const ledgerRead = readLedger(dataDir, createPluginStoreFs());
  if (!ledgerRead.ok) {
    // 坏账本 fail-closed：兼容面无法判定——不静默绿也不猜（写动词同源拒因）
    writeErr(`装机账本损坏：${ledgerRead.reason}——无法体检（03 §5.4，重装可重建）`);
    return 1;
  }
  if (ledgerRead.entries.length === 0) {
    // 非空原文但零条目（如空数组形 '[]'）——语义同空账本
    writeOut('装机账本缺席或为空——无可体检项（通过）');
    return 0;
  }
  const hostApiVersion = readHostApiVersion();
  const deprecations = await collectDeprecationUsed(dataDir, writeErr);

  /* 逐件裁决三色分桶（adjudicateApiGate 纯函数直调——四出口机器形态见 contracts/api） */
  const rows: CheckRow[] = [];
  for (const entry of ledgerRead.entries) {
    const abs = resolveInstallPath(dataDir, entry.installPath); // 绝对直用/相对 join 数据目录（§5.4）
    let pkg: unknown;
    try {
      pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8'));
    } catch (err) {
      // 悬空装机记录（目录失联/坏 JSON）——无法判定兼容面，红族 fail-closed 拒猜
      const detail = err instanceof Error ? err.message : String(err);
      rows.push({
        kind: 'red',
        id: entry.id,
        message: `装机目录 package.json 不可读（${abs}）：${detail}——装机记录悬空，兼容面无法判定；重装可重建（plugins install ${entry.ref}）`,
        matrix: undefined,
      });
      continue;
    }
    const parsed = parseManifest(pkg);
    if (!parsed.ok) {
      // 清单坏形——boot 装载同判据拒载，check 面同真相归红
      rows.push({ kind: 'red', id: entry.id, message: `清单坏形：${parsed.message}`, matrix: undefined });
      continue;
    }
    const api = parsed.manifest.api;
    if (api === undefined) {
      rows.push({ kind: 'legacy', id: entry.id });
      continue;
    }
    try {
      const verdict = adjudicateApiGate(api, hostApiVersion, entry.id);
      const target = api.targetApiVersion ?? api.minApiVersion; // 粘性锚：缺省 = min 的值
      rows.push({
        kind: 'green',
        id: entry.id,
        min: api.minApiVersion,
        target,
        effectiveTarget: verdict.effectiveTarget,
        clamped: compareApiVersions(hostApiVersion, target) < 0, // 宿主 < target 即钳制出口
      });
    } catch (err) {
      // 出口 1 拒载——BaseError 三段消息（expected/actual/升级指引）直呈 + 三值矩阵行
      rows.push({
        kind: 'red',
        id: entry.id,
        message: err instanceof Error ? err.message : String(err),
        matrix: `版本矩阵：min ${api.minApiVersion} / target ${api.targetApiVersion ?? api.minApiVersion} / 宿主 ${hostApiVersion}`,
      });
    }
  }

  /* 黄行 = 直查计数 ∩ 已装清单（已卸件的残遥测不进已装矩阵；未知插件桶保留计数） */
  if (deprecations !== null) {
    const installed = new Set(ledgerRead.entries.map((e) => e.id));
    for (const [id, count] of deprecations) {
      if (installed.has(id) || id === '(未知插件)') rows.push({ kind: 'yellow', id, count });
    }
  }

  /* 渲染（空段不渲染——零桶零噪音） */
  const lines: string[] = [];
  const green = rows.filter((r): r is Extract<CheckRow, { kind: 'green' }> => r.kind === 'green');
  const red = rows.filter((r): r is Extract<CheckRow, { kind: 'red' }> => r.kind === 'red');
  const legacy = rows.filter((r): r is Extract<CheckRow, { kind: 'legacy' }> => r.kind === 'legacy');
  const yellow = rows.filter((r): r is Extract<CheckRow, { kind: 'yellow' }> => r.kind === 'yellow');
  if (green.length > 0) {
    lines.push(`绿（通过，${green.length}）：`);
    for (const g of green) {
      lines.push(
        `  ${g.id}  通过——min ${g.min} ≤ 宿主 ${hostApiVersion}，生效 target ${g.effectiveTarget}` +
          (g.clamped
            ? `（target ${g.target} 高于宿主被钳制：min(宿主 ${hostApiVersion}, target ${g.target}) = ${g.effectiveTarget}）`
            : ''),
      );
    }
  }
  if (red.length > 0) {
    lines.push(`红（断裂，${red.length}）：`);
    for (const r of red) {
      lines.push(`  ${r.id}  ${r.message}`);
      if (r.matrix !== undefined) lines.push(`    ${r.matrix}`);
    }
  }
  if (legacy.length > 0) {
    lines.push(`legacy（api 块未声明，${legacy.length}——不计断裂）：`);
    for (const l of legacy) {
      lines.push(
        `  ${l.id}  api 块缺席——点火前容忍（与装载门出口 4 同口径）；建议补声明：package.json berryAgent.api.minApiVersion`,
      );
    }
  }
  if (yellow.length > 0) {
    lines.push(`用废弃（遥测 plugin/deprecation-used，${yellow.length}）：`);
    for (const y of yellow) {
      lines.push(`  ${y.id}  ${y.count} 笔——替代指引与死期料源 = 废弃注册簿（随首个 deprecated 符号进 DEP 窗日到场）`);
    }
  }
  lines.push(
    `体检汇总：已装 ${ledgerRead.entries.length}——绿 ${green.length} / 断裂 ${red.length} / 未声明 ${legacy.length} / 用废弃 ${yellow.length}` +
      `（宿主 apiVersion ${hostApiVersion}；退出码以断裂为轴——黄/未声明不改码）`,
  );
  writeOut(lines.join('\n'));
  return red.length > 0 ? 1 : 0;
}

/* ---------------- 写侧六动词（装机面落码批 #10 真身） ---------------- */

/**
 * 生命周期归因账真身（05 §1.1 生命周期归因面行——audit 落账批）：惰性开库
 * sink——动词成功尾首调才开 Persistence（只读路径 list/check 与失败路径零
 * 开库零负担）；Persistence.close 是 async，故配对 close 由调用层 finally
 * await（库件回调是同步面——close 责任在 CLI 编排层）。落账失败 warn 不
 * 阻塞主流程（行编辑已生效不回滚——与 llm/usage append 异常 warn 同哲学）。
 */
function lifecycleAuditOf(
  options: PluginsEntryOptions,
  writeErr: (text: string) => void,
): { readonly sink: LifecycleAuditSink; readonly close: () => Promise<void> } {
  let persistence: Persistence | undefined;
  return {
    sink: (type, data) => {
      try {
        if (persistence === undefined) {
          // dbPath 显式随 dataDir（Persistence 的 dbPath/dataDir 分立解析——
          // 缺省 dbPath 走 env 梯子不随 dataDir 选项；CLI 语义 = --data-dir
          // 指到哪库就在哪〔三级梯子第二级本意〕）
          persistence = Persistence.open({
            ...(options.dataDir !== undefined
              ? { dataDir: options.dataDir, dbPath: join(options.dataDir, 'sessions.db') }
              : {}),
            migrations: HOST_MIGRATION_TAIL,
            warn: (message) => writeErr(`warn：${message}`),
          });
        }
        createAuditFace(persistence.store.sqlite()).append(type, data);
      } catch (err) {
        writeErr(
          `warn：生命周期审计落账失败（${type}）：${err instanceof Error ? err.message : String(err)}——主流程不受影响（行编辑已生效）`,
        );
      }
    },
    close: async () => {
      if (persistence !== undefined) {
        const closing = persistence;
        persistence = undefined;
        await closing.close();
      }
    },
  };
}

/** 装机执行器 deps 构造（CLI 面——真盘真 spawn；env 缺省 process.env） */
function installDepsOf(
  options: PluginsEntryOptions,
  minReleaseAge: number | undefined,
  onLifecycleAudit?: LifecycleAuditSink,
): InstallExecutorDeps {
  return {
    dataDir: options.dataDir ?? resolveDataDir(),
    fs: createPluginStoreFs(),
    spawn: createDefaultSpawnRunner(),
    env: options.env ?? process.env,
    ...(minReleaseAge !== undefined ? { minReleaseAgeOverride: minReleaseAge } : {}),
    ...(onLifecycleAudit !== undefined ? { onLifecycleAudit } : {}),
  };
}

/** install <ref>：三源装机（§5.4——ref 词法坏形/撞名/收割失败各档结算文本直呈） */
async function runInstall(
  ref: string,
  minReleaseAge: number | undefined,
  options: PluginsEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const audit = lifecycleAuditOf(options, writeErr);
  try {
    const outcome = await installPlugin(installDepsOf(options, minReleaseAge, audit.sink), ref);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    // 两步制尾行（W8 装机文案批）：装机 ≠ 启用——装机只落账本+收割词汇，装载
    // 生效惟走 mount。执行器文本只给动词指路，此处补具体第二步命令（可直接
    // 复制执行）——「下次启动装载生效」只归属 mount 后语义（CLI 短命进程不装
    // 配装载器；宿主运行中经会话 /reload 即时生效）。
    writeOut(`装机 ≠ 启用——启用第二步：berry plugins mount ${outcome.entry.id}（mount 后下次启动装载生效）`);
    return 0;
  } finally {
    await audit.close();
  }
}

/** update <id>：按源分派（§5.4——npm 重装/git 重克隆/local no-op） */
async function runUpdate(id: string, options: PluginsEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const audit = lifecycleAuditOf(options, writeErr);
  try {
    const outcome = await updatePlugin(installDepsOf(options, undefined, audit.sink), id);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    return 0;
  } finally {
    await audit.close();
  }
}

/**
 * uninstall <id>：双相映射（§5.5——无 --confirm = inspect / 加 = execute）。
 * 开库走 Persistence 直开 + 迁移链尾单源（域表 DROP/审计落账走同实例窄面）；
 * --data 单独在场即拒（execute 载荷不静默猜——双相语义混淆当响亮指出）。
 */
async function runUninstall(
  id: string,
  confirm: boolean,
  dataAction: UninstallDataAction | undefined,
  options: PluginsEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  if (dataAction !== undefined && !confirm) {
    writeErr('--data 是 execute 载荷——须与 --confirm 同场（无 --confirm 即 inspect 只读报告，不携带数据处置）');
    return 1;
  }
  const dataDir = options.dataDir ?? resolveDataDir();
  // dbPath 显式随 dataDir（同 lifecycleAuditOf——Persistence 的 dbPath/dataDir
  // 分立解析，缺省 dbPath 走 env 梯子不随 dataDir 选项；CLI 语义 = --data-dir
  // 指到哪库就在哪。装机面落码批遗留真 bug——审计落账批写测试抓获，修前
  // 库恒开 env 梯子位、--data-dir 旗标形同虚设）
  const persistence = Persistence.open({
    ...(options.dataDir !== undefined
      ? { dataDir: options.dataDir, dbPath: join(options.dataDir, 'sessions.db') }
      : {}),
    migrations: HOST_MIGRATION_TAIL,
    warn: (message) => writeErr(`warn：${message}`),
  });
  try {
    const deps: UninstallDeps = { dataDir, fs: createPluginStoreFs(), db: persistence.store.sqlite() };
    const outcome = confirm
      ? executeUninstall(deps, id, dataAction ?? 'keep') // 缺省 keep——execute 不静默猜 purge
      : inspectUninstall(deps, id);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    return 0;
  } finally {
    await persistence.close();
  }
}

/**
 * mount/unmount/toggle <id>：enabled.yaml 行编辑（§5.3/§5.2——下次启动装载
 * 生效）。mount 前置两查：id 词法（enabled 行 id 空间——core: 前缀或用户
 * 词法）+ 装机在场（core: id 豁免查账——内置态天然在场；用户 id 未装机拒，
 * 防写死行 brick 下次 boot 读侧）。成功尾落生命周期归因账（unmount 幂等
 * 跳过腿由库件零调用——无变更不造账）。
 */
async function runRowVerb(
  verb: 'mount' | 'unmount' | 'toggle',
  id: string,
  options: PluginsEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const fs = createPluginStoreFs();
  if (verb === 'mount') {
    if (!checkPluginId(id, { official: true })) {
      writeErr(`插件 id 词法违例（${id}——小写字母数字连字符，官方件 core: 前缀同律）`);
      return 1;
    }
    if (!id.startsWith('core:')) {
      const ledgerRead = readLedger(dataDir, fs);
      if (!ledgerRead.ok) {
        writeErr(`装机账本损坏：${ledgerRead.reason}——拒写防覆盖（03 §5.4）`);
        return 1;
      }
      if (!ledgerRead.entries.some((e) => e.id === id)) {
        writeErr(`插件 ${id} 未装机——mount 先走 install（未装机挂行会在下次启动读侧降级，03 §5.3）`);
        return 1;
      }
    }
  }
  const audit = lifecycleAuditOf(options, writeErr);
  try {
    const result =
      verb === 'mount'
        ? mountRow(dataDir, id, undefined, fs, audit.sink)
        : verb === 'unmount'
          ? unmountRow(dataDir, id, fs, audit.sink)
          : toggleRow(dataDir, id, fs, audit.sink);
    if (!result.ok) {
      writeErr(result.message);
      return 1;
    }
    writeOut(
      verb === 'mount'
        ? `已挂载：${id}——下次启动装载生效（CLI 短命进程不装配装载器；改行时点生效归 TUI /reload，03 §5.2）`
        : verb === 'unmount'
          ? `已卸下：${id}（装机保留）——下次启动生效（03 §5.3）`
          : `已切换：${id} 禁用态翻转——下次启动生效（03 §5.2 三态语义）`,
    );
    return 0;
  } finally {
    await audit.close();
  }
}
