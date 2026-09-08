/**
 * host/plugin-store — 装机面写侧存储件（03 §5.3/§5.4/§5.5——成熟度缺口 #10
 * 装机面落码批 10a）。
 *
 * 职责四块（纯逻辑 + fs 注入零 spawn——三源执行器归 plugin-install，四段
 * 清算编舞归 plugin-uninstall，本件只供两件共用的存储基座）：
 *  - **装机账本 CRUD**（§5.4）：完整条目形（写侧单源——示例全字段）；读侧
 *    宽容两式（条目数组形 + id 键映射形——与 boot 读侧同律）；写侧恒出
 *    **条目数组形**（§5.4 写侧容器形定形——不产第二种表示）；原子写
 *    tmp+rename（§5.4 账本写面条款）。
 *  - **enabled.yaml 行编辑**（§5.3）：mount append / unmount 删行 / toggle
 *    翻 disabled——读-改-写整文件（yaml 序列化输出顶层 { plugins: [...] }），
 *    原子写同律。行校验复用 manifest.parseEnabledRows（拒绝式单源）。
 *  - **installPath 推导**（§5.4 归一路径载体——写侧执法）：npm 相对
 *    `plugins/node_modules/<包名>`、git 相对 `plugins/git/<host>/<首段>/<repo>`、
 *    local 绝对 canonical 化值；三源不产第二种表示。
 *  - **清算双路径断言**（§5.5 段②③防线）：assertInsideInstallSubtree（删除
 *    目标必须落 `plugins/` 装机子树内）/ assertInsidePluginData（purge 目标
 *    必须解析落在 `data/<id>/` 该插件子目录内）——逃逸即拒，防账本/参数
 *    手编坏形的越界删除。
 *
 * CLI 短命进程形态（零装配直开库同款纪律）：本件不开运行时、不装配装载器
 * ——写侧动作的生效时点是下次启动装载（「下次启动生效」诚实回执归
 * plugins-cmd 编排）。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { BaseError } from '../contracts/index.js';
import { canonicalPath } from '../safety/index.js';
import { enabledYamlPath, parseEnabledRows } from './manifest.js';
import type { EnabledRow } from './manifest.js';

/* ---------------- fs 注入面 ---------------- */

/**
 * 存储件 fs 面（写侧比 PluginBootFs 宽：原子写要 rename、装机树要 mkdir/rm、
 * dataSize 要递归量、DROP 域表清单要 readdir——全部真盘语义可注入，测试注
 * 内存形）。缺省真盘实现；任何方法失败抛（Node 原生错误——调用方按
 * CLI 退 1 呈现）。
 */
export interface PluginStoreFs {
  /** 读文本（缺席 = null——ENOENT 同义） */
  readonly read: (path: string) => string | null;
  readonly write: (path: string, text: string) => void;
  readonly rename: (from: string, to: string) => void;
  readonly mkdir: (path: string, options: { readonly recursive: true }) => void;
  readonly rm: (path: string, options: { readonly recursive: true; readonly force: true }) => void;
  /** 目录列举（非目录/缺席 = null） */
  readonly readdir: (path: string) => readonly string[] | null;
  /** 路径递归字节量（缺席 = null） */
  readonly size: (path: string) => number | null;
}

/** 缺省真盘实现 */
function defaultStoreFs(): PluginStoreFs {
  const sizeOf = (path: string): number | null => {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path);
    } catch {
      return null;
    }
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const name of readdirSync(path)) total += sizeOf(join(path, name)) ?? 0;
    return total;
  };
  return {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    write: (path, text) => writeFileSync(path, text),
    rename: (from, to) => renameSync(from, to),
    mkdir: (path, options) => mkdirSync(path, options),
    rm: (path, options) => rmSync(path, options),
    readdir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return null;
      }
    },
    size: sizeOf,
  };
}

/** 原子写（tmp+rename——§5.4 账本写面条款；同目录 tmp 保 rename 同卷原子性） */
function atomicWrite(fs: PluginStoreFs, path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  fs.write(tmp, text);
  fs.rename(tmp, path);
}

/* ---------------- 装机账本（§5.4） ---------------- */

/**
 * 装机账本完整条目（写侧单源——§5.4 示例全字段）。id/source/ref/
 * installedAt/installPath/declaredEvents 恒在；version/integrity（npm）与
 * commit（git）按源在场；local 源无凭证字段。
 */
export interface PluginLedgerEntry {
  readonly id: string;
  readonly source: 'npm' | 'git' | 'local';
  /** 自含源前缀完整 ref（npm:<pkg>[@<ver>] | git:<url>#<ref> | local:<abs>） */
  readonly ref: string;
  readonly version?: string;
  /** npm 装机凭证（tarball integrity——.package-lock.json 收割） */
  readonly integrity?: string;
  /** git 装机凭证（精确 commit——克隆后 HEAD 收割） */
  readonly commit?: string;
  /** 装机时刻（ISO 8601——注入时钟单源） */
  readonly installedAt: string;
  /** 归一路径（npm/git 相对数据目录、local 绝对——§5.4 表示法） */
  readonly installPath: string;
  /** install 时收割入口模块 events 导出（§5.4 词表账本） */
  readonly declaredEvents: readonly string[];
}

/** 账本文件路径（数据目录 plugins/ 子树——与 boot 读侧/check 读侧同源） */
export function ledgerPath(dataDir: string): string {
  return join(dataDir, 'plugins', 'ledger.json');
}

/** 账本读结果：缺席 = 空账本（首启零文件）；损坏 = invalid（写侧拒写防覆盖） */
export type LedgerReadResult =
  | { readonly ok: true; readonly entries: readonly PluginLedgerEntry[] }
  | { readonly ok: false; readonly reason: string };

/**
 * 账本读侧（宽容两式与 boot 读侧同律：条目数组形 / id 键映射形——读宽容是
 * 历史文件兼容面；boot 对损坏 warn 降级，本面返回 invalid 让 CLI 决定降级
 * 还是拒写——写动词对坏账本 fail-loud 拒绝防覆盖装机真相）。
 */
export function readLedger(dataDir: string, fs: PluginStoreFs): LedgerReadResult {
  const text = fs.read(ledgerPath(dataDir));
  if (text === null) return { ok: true, entries: [] }; // 缺席 = 空账本
  const invalid = (reason: string): LedgerReadResult => ({ ok: false, reason });
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return invalid(`坏 JSON（${err instanceof Error ? err.message : String(err)}）`);
  }
  const out: PluginLedgerEntry[] = [];
  if (Array.isArray(doc)) {
    for (const entry of doc) {
      const checked = checkEntryShape(entry);
      if (checked === null) return invalid('数组条目形含坏形条目');
      out.push(checked);
    }
    return { ok: true, entries: dedupeById(out) };
  }
  if (typeof doc === 'object' && doc !== null) {
    for (const [, entry] of Object.entries(doc as Record<string, unknown>)) {
      const checked = checkEntryShape(entry);
      if (checked === null) return invalid('键映射形条目坏形');
      out.push(checked);
    }
    return { ok: true, entries: dedupeById(out) };
  }
  return invalid('顶层非数组/对象');
}

/** 条目形状校验（最小必填面——id/source/ref/installedAt/installPath 恒在） */
function checkEntryShape(entry: unknown): PluginLedgerEntry | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const r = entry as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || r['id'].length === 0) return null;
  if (r['source'] !== 'npm' && r['source'] !== 'git' && r['source'] !== 'local') return null;
  if (typeof r['ref'] !== 'string' || r['ref'].length === 0) return null;
  if (typeof r['installedAt'] !== 'string') return null;
  if (typeof r['installPath'] !== 'string' || r['installPath'].length === 0) return null;
  return {
    id: r['id'],
    source: r['source'],
    ref: r['ref'],
    version: typeof r['version'] === 'string' ? r['version'] : undefined,
    integrity: typeof r['integrity'] === 'string' ? r['integrity'] : undefined,
    commit: typeof r['commit'] === 'string' ? r['commit'] : undefined,
    installedAt: r['installedAt'],
    installPath: r['installPath'],
    declaredEvents: Array.isArray(r['declaredEvents'])
      ? r['declaredEvents'].filter((e): e is string => typeof e === 'string')
      : [],
  };
}

/** 同 id 去重（后见胜出——账本手编残影容错，键映射形语义等价） */
function dedupeById(entries: readonly PluginLedgerEntry[]): PluginLedgerEntry[] {
  const byId = new Map<string, PluginLedgerEntry>();
  for (const e of entries) byId.set(e.id, e);
  return [...byId.values()];
}

/** 账本原子写（条目数组形——写侧恒出单一规范形） */
export function writeLedger(dataDir: string, entries: readonly PluginLedgerEntry[], fs: PluginStoreFs): void {
  fs.mkdir(join(dataDir, 'plugins'), { recursive: true });
  atomicWrite(fs, ledgerPath(dataDir), `${JSON.stringify(entries, null, 2)}\n`);
}

/** upsert（同 id 后见胜出——install/update 共用；保序：新条目尾追加） */
export function upsertLedgerEntry(dataDir: string, entry: PluginLedgerEntry, fs: PluginStoreFs): void {
  const read = readLedger(dataDir, fs);
  // 写前置读已由调用方核过 ok（install/update 编舞先查撞名/查在场）——此处
  // fail-loud 防双检竞速残影（坏账本拒写不覆盖）
  if (!read.ok) throw new BaseError('PLUGIN_INSTALL_FAILED', `装机账本损坏，拒写防覆盖：${read.reason}`);
  const rest = read.entries.filter((e) => e.id !== entry.id);
  writeLedger(dataDir, [...rest, entry], fs);
}

/** 删条目（uninstall 段②后账面收口；id 查无 = no-op 幂等） */
export function removeLedgerEntry(dataDir: string, id: string, fs: PluginStoreFs): void {
  const read = readLedger(dataDir, fs);
  if (!read.ok) throw new BaseError('PLUGIN_UNINSTALL_REFUSED', `装机账本损坏，拒写防覆盖：${read.reason}`);
  writeLedger(
    dataDir,
    read.entries.filter((e) => e.id !== id),
    fs,
  );
}

/* ---------------- enabled.yaml 行编辑（§5.3） ---------------- */

/** mount 结果 tagged union（行级语义拒——撞名/账本查无由编舞层前置，此处只报文件面真相） */
export type RowEditResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * 读启用行集（缺席 = 空集——§5.3 缺席语义；损坏 = fail-loud result 面：
 * CLI 呈现修复指引退 1，boot 装载序同判据拒启——两律分立但判据单源）。
 */
export function readEnabledRowsForEdit(
  dataDir: string,
  fs: PluginStoreFs,
): { readonly ok: true; readonly rows: readonly EnabledRow[] } | { readonly ok: false; readonly message: string } {
  const text = fs.read(enabledYamlPath(dataDir));
  if (text === null) return { ok: true, rows: [] };
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    return {
      ok: false,
      message: `启用清单损坏：${err instanceof Error ? err.message : String(err)}——修复或删除 ${enabledYamlPath(dataDir)}（删除即回全 core: 内置态）`,
    };
  }
  const result = parseEnabledRows(doc);
  if (!result.ok) {
    return {
      ok: false,
      message: `启用清单校验失败：${result.message}——修复指引：顶层 { plugins: [{ id, config?, disabled?, opens? }] }`,
    };
  }
  return { ok: true, rows: result.rows };
}

/**
 * mount：append 启用行（§5.3——行不在场才合法；撞名拒由编舞层前置查账，
 * 本面保底双检）。core: id 合法（overlay 用户行——覆盖内置默认态的主用例）。
 */
export function mountRow(dataDir: string, id: string, config: unknown, fs: PluginStoreFs): RowEditResult {
  const read = readEnabledRowsForEdit(dataDir, fs);
  if (!read.ok) return read;
  if (read.rows.some((row) => row.id === id)) {
    return { ok: false, message: `插件 ${id} 启用行已在场——mount 拒撞名（改配置 = unmount 后重 mount；03 §5.6）` };
  }
  const row: EnabledRow = { id, ...(config !== undefined ? { config } : {}) };
  writeEnabledRows(dataDir, [...read.rows, row], fs);
  return { ok: true };
}

/**
 * unmount：删启用行保装机（§5.3）。行不在场：core: id = 内置态不可删（指路
 * toggle——unmount 语义是移出启用面，core: 内置全启无行可删）；用户 id =
 * 幂等跳过（已不在启用面）。
 */
export function unmountRow(dataDir: string, id: string, fs: PluginStoreFs): RowEditResult {
  const read = readEnabledRowsForEdit(dataDir, fs);
  if (!read.ok) return read;
  if (!read.rows.some((row) => row.id === id)) {
    if (id.startsWith('core:')) {
      return { ok: false, message: `官方件 ${id} 内置全启无启用行可删——临时停用走 toggle（03 §5.2 三态语义）` };
    }
    return { ok: true }; // 幂等（已不在启用面）
  }
  writeEnabledRows(
    dataDir,
    read.rows.filter((row) => row.id !== id),
    fs,
  );
  return { ok: true };
}

/**
 * toggle：翻禁用旗标（§5.2 第三态）。行在场翻 disabled（absent ↔ true——
 * 无 false 态：行缺 disabled 键即启用）；行不在场写 `{id, disabled: true}`
 * 行（disable 内置 core: 件的主路径；用户插件同形）。
 */
export function toggleRow(dataDir: string, id: string, fs: PluginStoreFs): RowEditResult {
  const read = readEnabledRowsForEdit(dataDir, fs);
  if (!read.ok) return read;
  const rows = [...read.rows];
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) {
    rows.push({ id, disabled: true });
  } else {
    const current = rows[index]!;
    if (current.disabled === true) {
      // 已禁用 → 回启用（行保场、旗标撤——config/opens 等字段原样保留）
      const { disabled: _drop, ...rest } = current;
      rows[index] = rest;
    } else {
      // 启用中 → 禁用（字段原样保留，只翻旗标）
      rows[index] = { ...current, disabled: true };
    }
  }
  writeEnabledRows(dataDir, rows, fs);
  return { ok: true };
}

/** enabled.yaml 原子写（yaml 序列化顶层 { plugins: [...] }——与读侧形状对偶） */
function writeEnabledRows(dataDir: string, rows: readonly EnabledRow[], fs: PluginStoreFs): void {
  const doc = {
    plugins: rows.map((row) => {
      const out: Record<string, unknown> = { id: row.id };
      if (row.config !== undefined) out['config'] = row.config;
      if (row.disabled !== undefined) out['disabled'] = row.disabled;
      if (row.opens !== undefined) out['opens'] = [...row.opens];
      return out;
    }),
  };
  atomicWrite(fs, enabledYamlPath(dataDir), stringifyYaml(doc));
}

/* ---------------- installPath 推导（§5.4 归一路径载体——写侧执法） ---------------- */

/**
 * npm 源归一路径（相对数据目录）：`plugins/node_modules/<包名>`——scoped 包
 * 照包名原形嵌套 `plugins/node_modules/@scope/pkg/`（§5.4 物理布局——账本
 * id 与目录名解耦，无隐式映射变换）。
 */
export function installPathForNpm(pkgName: string): string {
  return join('plugins', 'node_modules', ...pkgName.split('/'));
}

/**
 * git 源归一路径（相对数据目录）：`plugins/git/<host>/<首段>/<repo 名>`——
 * 分层防撞名（§5.4 物理布局）。url 解析：剥 scheme 后取 host 与 path 首两段；
 * `.git` 尾缀剥除。解析失败（无 host/段不足）抛 BaseError——ref 坏形属
 * CLI 解析层前置校验射程，此处保底。
 */
export function installPathForGit(url: string): string {
  const stripped = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ''); // ssh:// 或 https:// 形
  const [hostPart, ...pathParts] = stripped.split('/');
  if (hostPart === undefined || hostPart.length === 0 || pathParts.length < 2) {
    throw new BaseError('PLUGIN_INSTALL_FAILED', `git url 坏形（${url}）——期望 https://<host>/<首段>/<repo> 形`);
  }
  const first = pathParts[0]!;
  const repoRaw = pathParts[pathParts.length - 1]!;
  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -'.git'.length) : repoRaw;
  if (first.length === 0 || repo.length === 0) {
    throw new BaseError('PLUGIN_INSTALL_FAILED', `git url 坏形（${url}）——首段或仓段为空`);
  }
  return join('plugins', 'git', hostPart, first, repo);
}

/**
 * local 源归一路径（绝对——canonical 化值；§5.4 表示法：直引源即真相）。
 * canonicalPath 解析失败（病理形态）抛——install 编舞 catch 归 ref 坏形档。
 */
export function installPathForLocal(absPath: string): string {
  return canonicalPath(absPath);
}

/* ---------------- 清算双路径断言（§5.5 段②③防线） ---------------- */

/**
 * 段②防线（§5.5）：删除目标必须落在 `plugins/` 装机子树内。canonical 解析
 * （符号链归一——防 alias 逃逸）后前缀判；恰等装机树根本身亦合法（幂等重跑
 * 的空树形）。逃逸抛 PLUGIN_UNINSTALL_REFUSED（防线拒绝档——非业务失败）。
 */
export function assertInsideInstallSubtree(dataDir: string, target: string): void {
  const subtree = canonicalPath(join(dataDir, 'plugins'));
  const resolved = canonicalPath(target);
  if (resolved !== subtree && !resolved.startsWith(`${subtree}${sep}`)) {
    throw new BaseError(
      'PLUGIN_UNINSTALL_REFUSED',
      `清算防线：删除目标 ${target}（解析 ${resolved}）逸出装机子树 ${subtree}——账本坏形，拒删（03 §5.5 段②）`,
    );
  }
}

/**
 * 段③防线（§5.5）：purge 目标必须解析落在 `data/<id>/` 该插件子目录内（恰
 * 等子目录本身或其内路径——幂等重跑兼容）。逃逸抛 PLUGIN_UNINSTALL_REFUSED。
 */
export function assertInsidePluginData(dataDir: string, id: string, target: string): void {
  const own = canonicalPath(join(dataDir, 'data', id));
  const resolved = canonicalPath(target);
  if (resolved !== own && !resolved.startsWith(`${own}${sep}`)) {
    throw new BaseError(
      'PLUGIN_UNINSTALL_REFUSED',
      `purge 防线：删除目标 ${target}（解析 ${resolved}）逸出插件数据子目录 ${own}——拒删（03 §5.5 段③）`,
    );
  }
}

/** 数据域子目录路径构造（purge 物理动作唯一合法目标——构造即受 §5.5 断言保护） */
export function pluginDataDir(dataDir: string, id: string): string {
  return join(dataDir, 'data', id);
}

/** installPath 解析为绝对目录（读侧解析序单源：绝对直用/相对 join 数据目录） */
export function resolveInstallPath(dataDir: string, installPath: string): string {
  return isAbsolute(installPath) ? installPath : join(dataDir, installPath);
}

/** 相对数据目录表示（写侧反向——诊断/呈现用；不在数据目录内 = 原样绝对） */
export function relativizeAgainst(dataDir: string, absPath: string): string {
  const rel = relative(dataDir, absPath);
  return rel.startsWith('..') ? absPath : rel;
}

/** dirname 导出（调用方目录准备用——mkdir 装机树父目录） */
export { dirname as parentDir };

/** 缺省真盘 fs 单例工厂（plugins-cmd 直开真盘；测试注内存形） */
export function createPluginStoreFs(): PluginStoreFs {
  return defaultStoreFs();
}
