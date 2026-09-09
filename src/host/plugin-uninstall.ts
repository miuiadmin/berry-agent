/**
 * host/plugin-uninstall — 卸载四段清算编舞（03 §5.5——成熟度缺口 #10 装机面
 * 落码批 10c）。
 *
 * 双相动词：`inspectUninstall`（只读零副作用——UninstallReport 全量呈报）
 * → `executeUninstall`（人面独占——CLI `--confirm` 两段式；模型面只到 inspect
 * 为止，§5.6 表格条款）。四段执行序（幂等 = 残迹收尾式——任一段已空则跳过
 * 继续，重跑收敛到全清）：
 *  ① 删启用行（行不在 = 跳过不报错）；
 *  ② 装机物必删——`assertInsideInstallSubtree` 防线（逃逸拒）+ 同包引用计数
 *    （多引用同物者最后引用删尽才删物）+ local 源不删用户目录；**连带** DROP
 *    该插件域前缀（`<id>__`）全部表——痕迹可清算（§5.5 段②连带清算条款）；
 *  ③ 数据域处置 `dataAction: keep|purge` 缺省 keep（Docker 卷律）——purge 恒
 *    只删 `data/<id>/` 单插件子目录（`assertInsidePluginData` 防线）+ store_state
 *    本域前缀键连带删（keep 留待 LRU 自然逐出——§4.5 第四正门对称清算）；
 *  ④ 落账回执——`plugin/uninstalled` durable 审计事件（audit_events 载体，
 *    载荷 = id/source/version/dataAction/affected）+ `affectedSessionCounts`
 *    诚实缺席（durable 装载史载体 v1 未落——§5.5 注记，不虚构计数 0）。
 *
 * 数据面接线（零装配直开库同款纪律）：本件不开运行时不装载插件——调用方
 * （plugins-cmd）以 Persistence 直开 + HOST_MIGRATION_TAIL 全链开库后传
 * `store.sqlite()` 同实例窄面进来（域表 DROP 是宿主固定件正当消费——store.ts
 * sqlite() 注记）。短命进程与运行时同库同链，链尾单源防短链降级。
 */
import { BaseError } from '../contracts/index.js';
import type { SqliteDatabase } from '../persist/index.js';
import { createAuditFace, createLoadHistoryFace } from '../persist/index.js';

import {
  assertInsideInstallSubtree,
  assertInsidePluginData,
  pluginDataDir,
  readLedger,
  readEnabledRowsForEdit,
  relativizeAgainst,
  removeLedgerEntry,
  resolveInstallPath,
  unmountRow,
} from './plugin-store.js';
import type { PluginLedgerEntry, PluginStoreFs } from './plugin-store.js';

/** 卸载执行面（全受局面——测试替身据此还原四段序） */
export interface UninstallDeps {
  readonly dataDir: string;
  readonly fs: PluginStoreFs;
  /** 同实例窄面（调用方 Persistence 直开 + 全链迁移后传 store.sqlite()） */
  readonly db: SqliteDatabase;
  /** 审计挂钟（缺省 Date.now——event time 位单源） */
  readonly now?: () => number;
}

/** 数据域处置（§5.5 段③——缺省 keep；execute 不静默猜 purge） */
export type UninstallDataAction = 'keep' | 'purge';

/**
 * inspect 回执（§5.5 UninstallReport——execute 前全量呈报将删项）。
 * `affectedSessionCounts` 有源（装载史批 h-4——05 §9 load_generations 世代
 * 快照时间窗 join 推算；措辞钉死「装载过该插件的会话」——共现语义非「使用
 * 过」，§5.5 ④ h-1 定形）。
 */
export interface UninstallReport {
  readonly id: string;
  readonly source: 'npm' | 'git' | 'local';
  readonly version?: string;
  /** 启用行在场数（§5.3 行 schema 单行 per id——值域 0|1） */
  readonly enabledRows: number;
  /** 装机物清单（sharedWith 非空 = 引用计数在——物保留只删账） */
  readonly installPaths: readonly {
    readonly ledgerPath: string;
    readonly absolute: string;
    readonly sharedWith: readonly string[];
    readonly willDelete: boolean;
  }[];
  /** 段②连带将 DROP 的域表清单 */
  readonly domainTables: readonly string[];
  /** store_state 本域前缀键数（purge 连带删 / keep 留待 LRU） */
  readonly storeStateKeys: number;
  /** 数据域体量（文件域字节 + SQLite 域表页量 + store_state 域键值字节）；无可测面 = 缺席 */
  readonly dataSizeBytes?: number;
  /** 装载过该插件的会话数（03 §5.5 ④——判据恒 activated ∩ 会话存活窗；0 = 诚实零非虚构） */
  readonly affectedSessionCounts: { readonly available: true; readonly count: number };
}

/** inspect/execute 结果：查无/拒 = message 呈现 CLI 退 1 */
export type UninstallOutcome<T> =
  { readonly ok: true; readonly report: T; readonly text: string } | { readonly ok: false; readonly message: string };

/**
 * 受影响会话计数单源（03 §5.5 ④——装载史批 h-4 有源化）：装载史面时间窗
 * join 推算「装载过该插件的会话」数（05 §9 load_generations；判据恒
 * activated ∩ 会话存活窗——共现非「使用过」）。件内构造面（audit 同律——
 * 调用方已全链开库，load_generations 恒在场）；世代行不随 uninstall 删
 * ⇒ 对已卸插件回执同源可考（立题档裁决 4）。
 */
function affectedOf(deps: UninstallDeps, id: string): UninstallReport['affectedSessionCounts'] {
  return { available: true, count: createLoadHistoryFace(deps.db).querySessionsWithPlugin(id) };
}

/** 核心前缀（官方件非装机物——uninstall 吃装机 id） */
const CORE_PREFIX = 'core:';

/* ---------------- 域面查询（段②连带 + 段③对称清算的判据源） ---------------- */

/**
 * 该插件域前缀全部表（sqlite_master 全表列举 + JS 前缀过滤——id 字符集
 * `[a-z0-9-]` 无 `%`/`_` 通配符，但 `__` 分隔后表名自由段可含任意字符，
 * 前缀判走 JS 精确 startsWith 不走 LIKE 模式串，通配符注入结构性不可达）。
 */
function domainTablesOf(db: SqliteDatabase, id: string): string[] {
  const prefix = `${id}__`;
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return rows.map((r) => r.name).filter((name) => name.startsWith(prefix));
}

/** store_state 本域前缀键（同 JS 前缀判——LRU 帽 256 全表列举代价可忽略） */
function domainStoreStateKeys(db: SqliteDatabase, id: string): string[] {
  const prefix = `${id}__`;
  const rows = db.prepare('SELECT key FROM store_state').all() as { key: string }[];
  return rows.map((r) => r.key).filter((key) => key.startsWith(prefix));
}

/**
 * 数据域体量三源合计（§5.5「表数据量计入 dataSizeBytes」条款）：
 *  ① 文件域 `data/<id>/` 递归字节（fs.size 注入面）；
 *  ② SQLite 域表页量（dbstat 虚表 SUM(pgsize)——better-sqlite3 内建可用）；
 *  ③ store_state 域键的 key+value 字节量（该表系宿主私产共享表——按行归属
 *     计值不按页计，页量不可归属于单插件）。
 * 三源皆零/缺 → undefined（报告字段缺席——诚实空非伪造 0 字节）。
 */
function measureDataSizeBytes(
  deps: UninstallDeps,
  id: string,
  tables: readonly string[],
  keys: readonly string[],
): number | undefined {
  let total = 0;
  let measured = false;
  const fileBytes = deps.fs.size(pluginDataDir(deps.dataDir, id));
  if (fileBytes !== null) {
    total += fileBytes;
    measured = true;
  }
  for (const table of tables) {
    const row = deps.db.prepare('SELECT SUM(pgsize) AS n FROM dbstat WHERE name = ?').get(table) as {
      n: number | null;
    };
    if (row.n !== null && row.n > 0) {
      total += row.n;
      measured = true;
    }
  }
  if (keys.length > 0) {
    const placeholders = keys.map(() => '?').join(', ');
    const row = deps.db
      .prepare(
        `SELECT COALESCE(SUM(length(key) + length(value)), 0) AS n FROM store_state WHERE key IN (${placeholders})`,
      )
      .get(...keys) as { n: number };
    total += row.n;
    measured = true;
  }
  return measured ? total : undefined;
}

/* ---------------- 段②引用计数（同物多引用最后删尽才删物） ---------------- */

/** 与目标条目同归一路径的其他账本条目 id（引用计数——多 id 同物共享装机目录） */
function sharedReferrers(dataDir: string, entries: readonly PluginLedgerEntry[], target: PluginLedgerEntry): string[] {
  const targetAbs = resolveInstallPath(dataDir, target.installPath);
  return entries
    .filter((e) => e.id !== target.id && resolveInstallPath(dataDir, e.installPath) === targetAbs)
    .map((e) => e.id);
}

/* ---------------- inspect（只读零副作用） ---------------- */

/**
 * 卸载预检（§5.5 UninstallReport）。装机 id 查无 = ok:false（core: 前缀专报
 * 「官方件非装机物」）；坏账本/坏启用清单 = ok:false 拒 inspect（与写动词同律
 * ——真相面缺席不猜）。
 */
export function inspectUninstall(deps: UninstallDeps, id: string): UninstallOutcome<UninstallReport> {
  if (id.startsWith(CORE_PREFIX)) {
    return {
      ok: false,
      message: `官方件 ${id} 非 uninstall 对象（uninstall 吃装机 id；官方件停用走 toggle——03 §5.5）`,
    };
  }
  const ledgerRead = readLedger(deps.dataDir, deps.fs);
  if (!ledgerRead.ok) {
    return { ok: false, message: `装机账本损坏：${ledgerRead.reason}——inspect 拒猜（03 §5.4）` };
  }
  const entry = ledgerRead.entries.find((e) => e.id === id);
  if (entry === undefined) {
    return { ok: false, message: `插件 ${id} 未装机——装机清单见 plugins list（uninstall 吃装机 id，非启用行 id）` };
  }
  const rowsRead = readEnabledRowsForEdit(deps.dataDir, deps.fs);
  if (!rowsRead.ok) {
    return { ok: false, message: rowsRead.message };
  }
  const sharedWith = sharedReferrers(deps.dataDir, ledgerRead.entries, entry);
  const absolute = resolveInstallPath(deps.dataDir, entry.installPath);
  const domainTables = domainTablesOf(deps.db, id);
  const storeKeys = domainStoreStateKeys(deps.db, id);
  const dataSizeBytes = measureDataSizeBytes(deps, id, domainTables, storeKeys);
  const report: UninstallReport = {
    id,
    source: entry.source,
    ...(entry.version !== undefined ? { version: entry.version } : {}),
    enabledRows: rowsRead.rows.filter((row) => row.id === id).length,
    installPaths: [
      {
        ledgerPath: entry.installPath,
        absolute,
        sharedWith,
        // local 直引不删用户目录；共享引用在——物保留只删账（§5.5 段②）
        willDelete: entry.source !== 'local' && sharedWith.length === 0,
      },
    ],
    domainTables,
    storeStateKeys: storeKeys.length,
    ...(dataSizeBytes !== undefined ? { dataSizeBytes } : {}),
    affectedSessionCounts: affectedOf(deps, id),
  };
  return { ok: true, report, text: formatReport(deps, report) };
}

/** inspect 人面文本（全量将删项——execute 前知情面） */
function formatReport(deps: UninstallDeps, report: UninstallReport): string {
  const lines: string[] = [];
  lines.push(`卸载预检（inspect）：${report.id}`);
  lines.push(`  源：${report.source}${report.version !== undefined ? `（version ${report.version}）` : ''}`);
  lines.push(`  启用行：${report.enabledRows > 0 ? '在场（段①删）' : '不在场（段①跳过）'}`);
  for (const p of report.installPaths) {
    if (p.sharedWith.length > 0) {
      lines.push(
        `  装机物：${relativizeAgainst(deps.dataDir, p.absolute)}——共享引用（${p.sharedWith.join('、')}）在，物保留只删账`,
      );
    } else if (!p.willDelete) {
      lines.push(`  装机物：${p.absolute}——local 直引源，不删用户目录（只删账本条目）`);
    } else {
      lines.push(`  装机物：${relativizeAgainst(deps.dataDir, p.absolute)}（段②删）`);
    }
  }
  lines.push(
    `  域表：${report.domainTables.length > 0 ? `${report.domainTables.length} 张连带 DROP（${report.domainTables.join('、')}）` : '无'}`,
  );
  lines.push(`  store_state：${report.storeStateKeys} 个域键（purge 连带删 / keep 留待 LRU）`);
  lines.push(
    `  数据域：${report.dataSizeBytes !== undefined ? `${report.dataSizeBytes} 字节（文件域 + 域表页量 + 域键值）` : '无可测面（缺席非 0）'}——--data keep（缺省）保留 / purge 清除`,
  );
  lines.push(`  受影响会话：装载过该插件的会话 ${report.affectedSessionCounts.count} 个`);
  lines.push('execute 走 --confirm（人面独占）：berry-agent plugins uninstall <id> --confirm [--data purge]');
  return lines.join('\n');
}

/* ---------------- execute（四段清算——人面独占） ---------------- */

/**
 * 卸载执行（§5.5 四段——幂等残迹收尾式：任一段已空跳过继续，重跑收敛全清）。
 * dataAction 缺省 keep（execute 不静默猜 purge——③ 段是唯一问用户的门）。
 * 段②③防线拒（逃逸/坏账本）收口为 ok:false 回执（`PLUGIN_UNINSTALL_REFUSED`
 * 文本直呈）——CLI 面不裸崩；其余 IO 失败同收口（短命进程重跑收敛）。
 */
export function executeUninstall(
  deps: UninstallDeps,
  id: string,
  dataAction: UninstallDataAction = 'keep',
): UninstallOutcome<UninstallReport> {
  // 前置预检复用（查无/坏账本/坏清单同拒——execute 不绕 inspect 判据）
  const pre = inspectUninstall(deps, id);
  if (!pre.ok) return pre;
  const report = pre.report;
  try {
    const ledgerRead = readLedger(deps.dataDir, deps.fs);
    if (!ledgerRead.ok) throw new BaseError('PLUGIN_UNINSTALL_REFUSED', `装机账本损坏：${ledgerRead.reason}`);
    const entry = ledgerRead.entries.find((e) => e.id === id)!; // inspect 已核在场

    // ① 删启用行（行不在 = 跳过不报错——幂等腿）
    const rowEdit = unmountRow(deps.dataDir, id, deps.fs);
    if (!rowEdit.ok) {
      return { ok: false, message: `段① 删启用行失败：${rowEdit.message}` };
    }

    // ② 装机物清算：防线 → 引用计数 → local 豁免 → 删物 + 删账；连带 DROP 域表
    const [pathInfo] = report.installPaths;
    if (pathInfo !== undefined && pathInfo.willDelete) {
      assertInsideInstallSubtree(deps.dataDir, pathInfo.absolute); // 逃逸拒（防线档）
      deps.fs.rm(pathInfo.absolute, { recursive: true, force: true });
    }
    for (const table of report.domainTables) {
      deps.db.exec(`DROP TABLE IF EXISTS "${table}"`); // 表名来自 sqlite_master 原值 + 引号包裹——标识符注入结构性不可达
    }
    removeLedgerEntry(deps.dataDir, id, deps.fs);

    // ③ 数据域处置（缺省 keep——Docker 卷律）：purge 恒只删 data/<id>/ 单插件
    // 子目录（防线）+ store_state 域键连带删
    if (dataAction === 'purge') {
      const dataDirAbs = pluginDataDir(deps.dataDir, id);
      assertInsidePluginData(deps.dataDir, id, dataDirAbs); // 构造即受防线（同构保底）
      deps.fs.rm(dataDirAbs, { recursive: true, force: true }); // 缺席 force 跳过——幂等腿
      const keys = domainStoreStateKeys(deps.db, id);
      if (keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        deps.db.prepare(`DELETE FROM store_state WHERE key IN (${placeholders})`).run(...keys);
      }
    }

    // ④ 落账回执：plugin/uninstalled durable 审计事件（四段成功尾——§5.5）
    const audit = createAuditFace(deps.db, deps.now ?? Date.now);
    audit.append('plugin/uninstalled', {
      id,
      source: entry.source,
      ...(entry.version !== undefined ? { version: entry.version } : {}),
      dataAction,
      affected: report.affectedSessionCounts, // 有源计数形（h-4——世代行时间窗 join 推算）
    });
    return { ok: true, report, text: formatExecuteReceipt(deps, report, entry, pathInfo, dataAction) };
  } catch (err) {
    const label = err instanceof BaseError ? `${err.code}：` : '';
    return { ok: false, message: `${label}${err instanceof Error ? err.message : String(err)}` };
  }
}

/** execute 结算文本（四段逐段点名——痕迹可清算的收口面） */
function formatExecuteReceipt(
  deps: UninstallDeps,
  report: UninstallReport,
  entry: PluginLedgerEntry,
  pathInfo: UninstallReport['installPaths'][number] | undefined,
  dataAction: UninstallDataAction,
): string {
  const lines: string[] = [];
  lines.push(`已卸载：${report.id}（源 ${entry.source}）`);
  lines.push(`  ① 启用行：${report.enabledRows > 0 ? '已删' : '不在场（跳过）'}`);
  if (pathInfo === undefined) {
    lines.push('  ② 装机物：账本条目已删（无物面）');
  } else if (pathInfo.sharedWith.length > 0) {
    lines.push(`  ② 装机物：保留（共享引用 ${pathInfo.sharedWith.join('、')} 在——最后引用删尽才删物）；账本条目已删`);
  } else if (!pathInfo.willDelete) {
    lines.push('  ② 装机物：保留（local 直引源不删用户目录）；账本条目已删');
  } else {
    lines.push(`  ② 装机物：已删（${relativizeAgainst(deps.dataDir, pathInfo.absolute)}）`);
  }
  lines.push(`  ②连带 域表：${report.domainTables.length > 0 ? `已 DROP ${report.domainTables.length} 张` : '无'}`);
  lines.push(
    dataAction === 'purge'
      ? `  ③ 数据域：已清除（${report.dataSizeBytes !== undefined ? `${report.dataSizeBytes} 字节` : '无可测面'} + store_state 域键 ${report.storeStateKeys} 个）`
      : `  ③ 数据域：保留（keep 缺省——Docker 卷律；store_state 域键 ${report.storeStateKeys} 个留待 LRU）`,
  );
  lines.push(
    `  ④ 痕迹：plugin/uninstalled 已落审计流；受影响会话——装载过该插件的会话 ${report.affectedSessionCounts.count} 个`,
  );
  return lines.join('\n');
}
