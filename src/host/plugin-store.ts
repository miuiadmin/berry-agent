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
 *    原子写同律。行校验复用 manifest.parseEnabledRows（拒绝式单源）；toggle
 *    造新行前过 checkPluginId 词法闸（同判据单源——防坏词法行落盘 brick
 *    下次 boot 读侧，CLI/TUI/模型工具三面单源收口）。
 *  - **installPath 推导**（§5.4 归一路径载体——写侧执法）：npm 相对
 *    `plugins/node_modules/<包名>`、git 相对 `plugins/git/<host>/<首段>/<repo>`、
 *    local 绝对 canonical 化值；三源不产第二种表示。
 *  - **清算双路径断言**（§5.5 段②③防线）：assertInsideInstallSubtree（删除
 *    目标必须落 `plugins/` 装机子树内）/ assertInsidePluginData（purge 目标
 *    必须解析落在 `data/<id>/` 该插件子目录内）——逃逸即拒，防账本/参数
 *    手编坏形的越界删除。
 *  - **编辑面跨进程互斥**（§5.3 73 轮批注——RMW 丢更新防护）：enabled.yaml
 *    与 ledger.json 全部写者的「读 → 改 → 写回」整段同目录 lockfile 互斥
 *    （O_EXCL 探测 + 有界重试 + 崩溃残锁 pid 判死破锁；超限 fail-loud 拒写）。
 *
 * CLI 短命进程形态（零装配直开库同款纪律）：本件不开运行时、不装配装载器
 * ——写侧动作的生效时点是下次启动装载（「下次启动生效」诚实回执归
 * plugins-cmd 编排）。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { BaseError } from '../contracts/index.js';
import { DOORS_SEGMENT_V1_DOMAIN } from '../contracts/api.js';
import { canonicalPath } from '../safety/index.js';
import { isPidAlive } from '../../plugins/exec/index.js';
import { enabledYamlPath, checkPluginId, parseEnabledRows } from './manifest.js';
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
  /**
   * 写文本（可选 options 位承载 mode——缺省实现透传 writeFileSync options）：
   * atomicWrite 经此传 0600（05 §6.6——2026-10-18 60 轮 L2 批扩列敏感产物
   * 落盘 0600：建即 0600、随 rename 承袭、在场旧文件不追溯——语义归扩列
   * 注）。可选位不破注入面兼容（内存桩零感知）。
   */
  readonly write: (path: string, text: string, options?: { readonly mode?: number }) => void;
  readonly rename: (from: string, to: string) => void;
  readonly mkdir: (path: string, options: { readonly recursive: true }) => void;
  readonly rm: (path: string, options: { readonly recursive: true; readonly force: true }) => void;
  /** 目录列举（非目录/缺席 = null） */
  readonly readdir: (path: string) => readonly string[] | null;
  /** 路径递归字节量（缺席 = null） */
  readonly size: (path: string) => number | null;
  /**
   * O_EXCL 独占建文件（编辑面跨进程互斥原语——03 §5.3 73 轮批注 lockfile 腿）：
   * true = 建成即持锁（text = 持锁 pid 载荷）；false = 目标已在场（EEXIST
   * 探测语义，不抛——「在场等待 / stale 破锁 / 有界重试超限拒写」编舞单源
   * 在 withEditLock，注入面只供单发探测）。其余错误照抛（真盘 writeFileSync
   * flag 'wx' 缺省实现——与 single-instance 活跃标记独占写同律）。
   */
  readonly openExclusive: (path: string, text: string) => boolean;
  /**
   * 删单文件（锁释放/破锁位）：缺席静默不炸（force 语义——破锁竞窗里对方
   * 可能已先行删除同一残锁，静默容错后由随后的 O_EXCL 重探终判胜负）；
   * 其余错误（EACCES 等）照抛（fail-loud——锁清不掉不该被伪装成已清）。
   */
  readonly unlink: (path: string) => void;
}

/**
 * 缺省真盘实现；导出 = 防线直测位（createPluginStoreFs）与两件（install/
 * uninstall）真盘复用（单源）。
 *
 * read 读侧错误码分档（点名纪律——与 plugin-boot defaultFs 同律）：ENOENT =
 * 文件缺席语义（首启零文件零负担——静默折 null 照旧，readLedger 读侧「缺席
 * = 空账本」条款的消费面）；其余错误码（EACCES/EMFILE/EISDIR 等）≠ 缺席——
 * 先点名 warn 再折 null 降级（不炸 CLI 短命进程，但「权限坏被当缺席、装机
 * 账本/启用清单静默按空处理、已装插件全部消失零线索」的哑面不再）。warn
 * 通道 = console.warn 最简形：本函数无注入 warn 位（三件消费面 warn 通道
 * 各异），装配根 logger 不在 leaf 位拉依赖（仓库「缺省 console.warn、装配
 * 根接 logger」既有惯例）。
 */
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
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          // 点名后再降级——缺席与坏权限在 CLI 叙事里必须可区分（头注「读侧
          // 错误码分档」）；折 null 后 readLedger 视为空账本、启用清单视为空
          console.warn(
            `[host] 读取 ${path} 失败（${code ?? '未知错误'}）——按文件不存在继续；` +
              `若是权限问题，装机记录/启用清单将按空处理（已装插件可能不装载），请检查该文件的访问权限`,
          );
        }
        return null;
      }
    },
    write: (path, text, options) => writeFileSync(path, text, options),
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
    // O_EXCL 探测：EEXIST 折 false（在场探测非异常档）；其余照抛
    openExclusive: (path, text) => {
      try {
        writeFileSync(path, text, { flag: 'wx' });
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw err;
      }
    },
    unlink: (path) => rmSync(path, { force: true }),
  };
}

/** 原子写（tmp+rename——§5.4 账本写面条款；同目录 tmp 保 rename 同卷原子性） */
function atomicWrite(fs: PluginStoreFs, path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  // 敏感产物落盘 0600 纵深档（05 §6.6——2026-10-18 60 轮 L2 批扩列）：
  // enabled.yaml（行内 config 无「不得含鉴权材料」定性护栏、可含第三方服务
  // 凭证）与 ledger.json（装机溯源账）两消费同享——atomicWrite 单形连带，
  // per-caller mode 分叉不作；mode 落 tmp 写位、随 rename 承袭终名；「建即」
  // 辖建时点，在场旧文件不追溯。
  fs.write(tmp, text, { mode: 0o600 });
  fs.rename(tmp, path);
}

/* ---------------- 编辑面跨进程互斥（03 §5.3 73 轮批注——RMW 丢更新防护） ---------------- */

/** 锁重试间隔（有界等待帽的粒度——CLI 短命进程与宿主回合内写动词共用） */
const EDIT_LOCK_RETRY_INTERVAL_MS = 100;
/** 锁重试次数帽（100ms × 20 ≈ 2s 等待上限——超限 fail-loud 拒写不静默） */
const EDIT_LOCK_RETRY_MAX_ATTEMPTS = 20;

/**
 * 同步睡眠（Atomics.wait——本件锁重试等待专用；与 persist/store.ts syncSleep
 * 同形私有：该处未导出、persist 边不经本件拉依赖，两处各自内聚）。
 */
function lockSleep(ms: number): void {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}

/**
 * 编辑锁超限拒绝（withEditLock 取锁失败档的内部载体——各写腿 catch 后折
 * 本腿失败形：行动词折 `{ ok:false, message }` 拒文、账本腿折 BaseError
 * 拒抛；不外泄类形——「宁拒服务不丢数据」的 message 才是呈现面）。
 */
class EditLockBusy extends Error {
  constructor(readonly lockPath: string) {
    super(`编辑锁重试超限：${lockPath}`);
  }
}

/**
 * 编辑面跨进程互斥原语（模块私有——03 §5.3 73 轮批注行为律的执法位）：
 * 包住「读 → 改 → 写回」**整段** RMW（只罩 atomicWrite 不够——A 读 → B 读
 * → B 写 → A 写的交错丢更新发生在读位与写位之间）。形态 = 同目录 lockfile
 * （`<目标>.lock`）：
 *  - 取锁 = O_EXCL 独占建文件（fs.openExclusive 单发探测），载荷 = 持锁
 *    pid（stale 判定用）；
 *  - 在场 = 读持锁 pid 判活（isPidAlive——exec 件公开面单源，信号 0 探测
 *    ESRCH 折死）：活 = 有界等待重试（100ms × 20 帽）；死 = 崩溃残锁破锁
 *    重试；内容不可解析 = 按活计（保守——无法证明 stale 即不破，超限拒写
 *    兜底）；
 *  - 破锁-重取竞窗自愈：unlink 后 O_EXCL 重试，失败（对方先取得）则重读
 *    重判（unlink 缺席静默语义由 fs 面承载）；
 *  - 互斥不可得（重试超限）= throw EditLockBusy——调用腿折 fail-loud 拒写，
 *    绝不退化为无锁写（丢更新面比暂拒服务更坏）；
 *  - 释放 = finally unlink（缺席静默——外扰清场后的幂等收口）。
 *
 * 同进程重入（嵌套写者）无自持锁豁免：自身 pid 判活走等待支，超限即拒——
 * 现无嵌套写者（各写腿互不调用），该形是防御位非工作流。
 */
function withEditLock<T>(fs: PluginStoreFs, targetPath: string, body: () => T): T {
  const lockPath = `${targetPath}.lock`;
  // 锁文件同目录先在（首启零文件形：ledger 的 plugins/ 子目录由本笔前置建，
  // enabled.yaml 的数据目录同律——recursive 幂等）
  fs.mkdir(dirname(targetPath), { recursive: true });
  let attempts = 0;
  for (;;) {
    if (fs.openExclusive(lockPath, `${process.pid}\n`)) break; // 取得——进临界段
    const held = fs.read(lockPath);
    const pid = held === null ? Number.NaN : Number(held.trim());
    // stale 判定（pid 判死 = 崩溃残锁）：破锁立即重试（不睡——残锁不是竞争）
    if (Number.isInteger(pid) && pid > 0 && !isPidAlive(pid)) {
      fs.unlink(lockPath);
      continue;
    }
    if (++attempts > EDIT_LOCK_RETRY_MAX_ATTEMPTS) throw new EditLockBusy(lockPath);
    lockSleep(EDIT_LOCK_RETRY_INTERVAL_MS);
  }
  try {
    return body();
  } finally {
    fs.unlink(lockPath);
  }
}

/** 锁超限拒文（带锁路径与重试帽——两载体（启用清单/装机账本）名位各异） */
function editLockBusyText(name: string, lockPath: string): string {
  return (
    `${name}正被另一进程编辑（锁 ${lockPath}，等待重试 ${EDIT_LOCK_RETRY_MAX_ATTEMPTS} 次 × ` +
    `${EDIT_LOCK_RETRY_INTERVAL_MS}ms 超限）——已拒写以防丢更新；确认无其他进程在编辑时，可删除该锁文件后重试`
  );
}

/**
 * 行编辑腿的锁包装（enabled.yaml 写动词共用收口）：body = 原「读-改-写回」
 * 段；EditLockBusy 折本腿失败形（RowEditResult message——CLI 退 1 / 工具面
 * ok:false 呈现，fail-loud 拒写不静默）。
 */
function rowEditUnderLock<T extends { readonly ok: true } | { readonly ok: false; readonly message: string }>(
  dataDir: string,
  fs: PluginStoreFs,
  body: () => T,
): T | { readonly ok: false; readonly message: string } {
  try {
    return withEditLock(fs, enabledYamlPath(dataDir), body);
  } catch (err) {
    if (err instanceof EditLockBusy) return { ok: false, message: editLockBusyText('启用清单', err.lockPath) };
    throw err;
  }
}

/* ---------------- 装机账本（§5.4） ---------------- */

/**
 * 装机账本完整条目（写侧单源——§5.4 示例全字段）。id/source/ref/
 * installedAt/installPath/declaredEvents 恒在；version/integrity（npm）与
 * commit（git）按源在场；local 源无凭证字段；market（§9.6 mp-3 装机咬合）
 * = 市场装机溯源注记——marketplace install 编舞写入，字段缺席容错读（老账
 * 本零迁移：非市场装机恒无此字段）。
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
  /**
   * install 时收割入口模块 inject 导出（66 轮件G——§5.4 inject 预收割同笔）：
   * 装载排序位（loader Kahn 轮次）对磁盘插件行的 inject 信号唯一来自本位
   * （入口模块装载期才可求值——排序位不得为排序而装载）。缺席视零 inject
   * 排序（两段式不变：排序位尽力、装载位执法）；坏形拒装在收割腿
   * （PLUGIN_SHAPE_INVALID 同族），读侧宽容消毒（照 declaredEvents 形）。
   */
  readonly inject?: readonly string[];
  /** 市场溯源（§9.6 mp-3）：name = 市场名、entry = catalog 条目名——uninstall 寻址与呈现用 */
  readonly market?: PluginLedgerMarket;
}

/**
 * 市场溯源注记（03 §9.6 mp-3——marketplace install 落账形）：name = 源清单
 * 市场名（与缓存目录 `marketplaces/<name>/` 同名段）；entry = catalog 条目名
 * （与拷贝腿布局叶段 `plugins/market/<name>/<entry>/` 同名段——寻址
 * `entry@name` 与 CLI uninstall 解析单源）。两段皆过市场名段词法（同
 * plugin-market isValidNameSegment 律——本件只做形状非空执法，词法单源在
 * 翻译层与装机防御位）。
 */
export interface PluginLedgerMarket {
  readonly name: string;
  readonly entry: string;
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
      if (checked === null) return invalid('数组条目中存在格式异常条目');
      out.push(checked);
    }
    return { ok: true, entries: dedupeById(out) };
  }
  if (typeof doc === 'object' && doc !== null) {
    for (const [, entry] of Object.entries(doc as Record<string, unknown>)) {
      const checked = checkEntryShape(entry);
      if (checked === null) return invalid('键映射形条目格式异常');
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
  // market 溯源（§9.6 mp-3）：在场即严格形——对象 + name/entry 两非空串；
  // 坏形整账本 invalid（重建对象只保留已知字段，此处必须显式携带否则读写
  // 往返丢失——checkEntryShape 重建坑的 market 位执法）
  let market: PluginLedgerMarket | undefined;
  if (r['market'] !== undefined) {
    const raw = r['market'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const m = raw as Record<string, unknown>;
    if (typeof m['name'] !== 'string' || m['name'].length === 0) return null;
    if (typeof m['entry'] !== 'string' || m['entry'].length === 0) return null;
    market = { name: m['name'], entry: m['entry'] };
  }
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
    // inject 预收割位（66 轮件G——§5.4）：在场才携带（重建对象显式列位律——
    // 缺席不凭空造位）；消毒照 declaredEvents 现形——数组滤逐项 string，非
    // 数组手编坏形宽容视零（undefined，不整账本 invalid——排序信号失真只降
    // 级为行序装载，装机真相不吞）
    ...(Array.isArray(r['inject']) ? { inject: r['inject'].filter((v): v is string => typeof v === 'string') } : {}),
    ...(market !== undefined ? { market } : {}),
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
  // 账本追加腿同「读-改-写回」形（03 §5.3 73 轮批注：ledger 追加腿同律同治）
  // ——互斥包 read→filter→write 整段；锁超限折装机失败档 fail-loud 拒写
  try {
    withEditLock(fs, ledgerPath(dataDir), () => {
      const read = readLedger(dataDir, fs);
      // 写前置读已由调用方核过 ok（install/update 编舞先查撞名/查在场）——此处
      // fail-loud 防双检竞速残影（坏账本拒写不覆盖）
      if (!read.ok) throw new BaseError('PLUGIN_INSTALL_FAILED', `安装记录损坏，拒写防覆盖：${read.reason}`);
      const rest = read.entries.filter((e) => e.id !== entry.id);
      writeLedger(dataDir, [...rest, entry], fs);
    });
  } catch (err) {
    if (err instanceof EditLockBusy)
      throw new BaseError('PLUGIN_INSTALL_FAILED', editLockBusyText('装机账本', err.lockPath));
    throw err;
  }
}

/** 删条目（uninstall 段②后账面收口；id 查无 = no-op 幂等） */
export function removeLedgerEntry(dataDir: string, id: string, fs: PluginStoreFs): void {
  // 撤账腿同律（读-改-写整段互斥）；锁超限折卸载拒绝档（与坏账本拒写同码）
  try {
    withEditLock(fs, ledgerPath(dataDir), () => {
      const read = readLedger(dataDir, fs);
      if (!read.ok) throw new BaseError('PLUGIN_UNINSTALL_REFUSED', `安装记录损坏，拒写防覆盖：${read.reason}`);
      writeLedger(
        dataDir,
        read.entries.filter((e) => e.id !== id),
        fs,
      );
    });
  } catch (err) {
    if (err instanceof EditLockBusy) {
      throw new BaseError('PLUGIN_UNINSTALL_REFUSED', editLockBusyText('装机账本', err.lockPath));
    }
    throw err;
  }
}

/* ---------------- enabled.yaml 行编辑（§5.3） ---------------- */

/** mount 结果 tagged union（行级语义拒——撞名/账本查无由编舞层前置，此处只报文件面真相） */
export type RowEditResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * 生命周期归因账 sink（05 §1.1 生命周期归因面行——audit 落账批）：库件
 * （本件 + plugin-install）成功尾回调；真身 = CLI 面构造（惰性开
 * Persistence + createAuditFace 落 audit_events——库件零 db 依赖，词形
 * 映射在库件单源〔动作语义与终态数据在手〕）。落账失败由 sink 自吞
 * （warn 不阻塞主流程——行编辑已生效不回滚，与 llm/usage append 异常
 * warn 同哲学）。
 */
export type LifecycleAuditSink = (
  type: 'plugin/installed' | 'plugin/mounted' | 'plugin/unmounted' | 'plugin/toggled' | 'plugin/updated',
  data: Record<string, unknown>,
) => void;

/**
 * 读启用行集 + 顶层 doors 段（缺席 = 空集——§5.3 缺席语义；损坏 = fail-loud
 * result 面：CLI 呈现修复指引退 1，boot 装载序同判据拒启——两律分立但判据
 * 单源）。doors 段随行集一并读出（开门制扩展批 2026-09-09——行编辑腿全文件
 * 形状往返保真：写侧必须原样携带 doors 段，静默抹段 = 静默收回用户授予）。
 */
export function readEnabledRowsForEdit(
  dataDir: string,
  fs: PluginStoreFs,
):
  | { readonly ok: true; readonly rows: readonly EnabledRow[]; readonly doors: readonly string[] | undefined }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  const text = fs.read(enabledYamlPath(dataDir));
  if (text === null) return { ok: true, rows: [], doors: undefined };
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
      message: `启用清单校验失败：${result.message}——修复指引：顶层 { plugins: [{ id, config?, disabled?, opens? }], doors?: [...] }`,
    };
  }
  return { ok: true, rows: result.rows, doors: parseDoorsPresence(doc) };
}

/**
 * doors 段在场性判别（往返保真位——parseEnabledRows 已把缺席归一为 []，本函数
 * 从原文档辨「段缺席」与「段显式空」：显式 `doors: []` 编辑后仍写回显式空段
 * （用户手编形状原样保真），段缺席则不凭空造段）。
 */
function parseDoorsPresence(doc: unknown): readonly string[] | undefined {
  const raw = (doc as Record<string, unknown> | null | undefined)?.['doors'];
  return raw === undefined ? undefined : Array.isArray(raw) ? (raw as readonly string[]) : undefined;
}

/**
 * mount：append 启用行（§5.3——行不在场才合法；撞名拒由编舞层前置查账，
 * 本面保底双检）。core: id 合法（overlay 用户行——覆盖内置默认态的主用例）。
 * 成功尾落 plugin/mounted（生命周期归因账——本账含 core: 行：mount 对
 * core: 行是 overlay 合法动作，与 opens diff 排除 core: 分立）。
 */
export function mountRow(
  dataDir: string,
  id: string,
  config: unknown,
  fs: PluginStoreFs,
  onLifecycleAudit?: LifecycleAuditSink,
): RowEditResult {
  // 读-改-写整段互斥（03 §5.3 73 轮批注——CLI/宿主并存竞窗的丢更新防护）
  return rowEditUnderLock(dataDir, fs, () => {
    const read = readEnabledRowsForEdit(dataDir, fs);
    if (!read.ok) return read;
    if (read.rows.some((row) => row.id === id)) {
      return { ok: false, message: `插件 ${id} 的启用行已存在——mount 拒绝重名（改配置 = 先 unmount 再 mount）` };
    }
    const row: EnabledRow = { id, ...(config !== undefined ? { config } : {}) };
    writeEnabledRows(dataDir, [...read.rows, row], read.doors, fs);
    onLifecycleAudit?.('plugin/mounted', { id });
    return { ok: true };
  });
}

/**
 * unmount：删启用行保装机（§5.3）。行不在场：core: id = 内置态不可删（指路
 * toggle——unmount 语义是移出启用面，core: 内置全启无行可删）；用户 id =
 * 幂等跳过（已不在启用面）。幂等跳过不落账（无变更不造账——与 update
 * local no-op 同律）；真删行成功尾落 plugin/unmounted。
 */
export function unmountRow(
  dataDir: string,
  id: string,
  fs: PluginStoreFs,
  onLifecycleAudit?: LifecycleAuditSink,
): RowEditResult {
  // 读-改-写整段互斥（幂等跳过腿在锁内判——行不在场即无写回，锁只占瞬时不写盘）
  return rowEditUnderLock(dataDir, fs, () => {
    const read = readEnabledRowsForEdit(dataDir, fs);
    if (!read.ok) return read;
    if (!read.rows.some((row) => row.id === id)) {
      if (id.startsWith('core:')) {
        return { ok: false, message: `官方插件 ${id} 内置全启、无启用行可删——临时停用请用 toggle` };
      }
      return { ok: true }; // 幂等（已不在启用面）
    }
    writeEnabledRows(
      dataDir,
      read.rows.filter((row) => row.id !== id),
      read.doors,
      fs,
    );
    onLifecycleAudit?.('plugin/unmounted', { id });
    return { ok: true };
  });
}

/**
 * 启用行随迁（03 §9.6 mp 收尾批定形）：换血豁免 id 漂移时，旧 id 启用行
 * （若在场）改写 id 为新 id——行是用户既有启用意图的记录，行 id 是行对
 * 装机物的引用，装机物换代改 id 则引用跟物走（随迁非新启用动作，§5.2
 * 「装机零生效」辖新启用不辖既有意图随迁）。不随迁即悬空行——boot 对账
 * 永续 warn + 插件静默停载 + 两 uninstall 动词均清不掉。
 *  - 全字段保形：config/disabled/opens 原样迁走；
 *  - 幂等两形：旧 id 行缺席 = 无动作（从未启用）；新 id 行已在场（用户
 *    另行启用了同 id 的他装机物）= 只删旧行不覆写既有意图；
 *  - 不落独立审计词：换装事实审计词 plugin/updated 已由分派腿承载——行侧
 *    伴随面非用户显式动词，与 config 编辑同律。
 */
/**
 * 启用行随迁结局：carried = 行面有动作（随迁改写或防撞名清旧行）——装机回执
 * 「启用行已随换代迁移」注记与 CLI mount 指路行抑制的判定源；carried=false =
 * 旧 id 无启用行（no-op）。失败形 = enabled.yaml 坏形（fail-loud 报文）。
 */
export type MigrateRowResult =
  { readonly ok: true; readonly carried: boolean } | { readonly ok: false; readonly message: string };

export function migrateEnabledRow(dataDir: string, fromId: string, toId: string, fs: PluginStoreFs): MigrateRowResult {
  // 读-改-写整段互斥（随迁腿同 enabled.yaml 写者家族——幂等无迁移动作腿在
  // 锁内判，无写回即零更新面）
  return rowEditUnderLock(dataDir, fs, () => {
    const read = readEnabledRowsForEdit(dataDir, fs);
    if (!read.ok) return read;
    const from = read.rows.find((row) => row.id === fromId);
    if (from === undefined) {
      return { ok: true, carried: false }; // 幂等——旧 id 无启用行（从未启用），无迁移动作
    }
    const rest = read.rows.filter((row) => row.id !== fromId);
    if (rest.some((row) => row.id === toId)) {
      // 新 id 行已在场——只清旧行（不覆写既有意图），doors 段照原样往返
      writeEnabledRows(dataDir, rest, read.doors, fs);
      return { ok: true, carried: true };
    }
    // 随迁：全字段保形、只改行 id（行位序保持——其余行原序）
    writeEnabledRows(dataDir, [...rest, { ...from, id: toId }], read.doors, fs);
    return { ok: true, carried: true };
  });
}

/**
 * toggle：翻禁用旗标（§5.2 第三态）。行在场翻 disabled（absent ↔ true——
 * 无 false 态：行缺 disabled 键即启用）；行不在场写 `{id, disabled: true}`
 * 行（disable 内置 core: 件的主路径；用户插件同形）。造新行前过 id 词法闸
 * （checkPluginId 单源——与读侧 parseEnabledRows/boot 读侧同判据）：坏词法
 * 行一旦落盘，下次启动读侧即 PLUGIN_ROW_INVALID 全入口拒启、且行编辑面同
 * 判据 fail-loud 连撤销动词自身全废（唯一出路手改/删文件）——与 mount 腿
 * 防线同律，收口在库件单源位（CLI/TUI/模型工具三面同时覆盖）。成功尾落
 * plugin/toggled {id, disabled 终态}——审计词形双态 true|false 独立于
 * enabled.yaml 行形（行内无 false 键，翻回启用需 false 位表达）。
 */
export function toggleRow(
  dataDir: string,
  id: string,
  fs: PluginStoreFs,
  onLifecycleAudit?: LifecycleAuditSink,
): RowEditResult {
  // 读-改-写整段互斥（造新行词法闸在锁内——拒路径无写回，锁只占瞬时）
  return rowEditUnderLock(dataDir, fs, () => {
    const read = readEnabledRowsForEdit(dataDir, fs);
    if (!read.ok) return read;
    const rows = [...read.rows];
    const index = rows.findIndex((row) => row.id === id);
    let disabled: boolean;
    if (index === -1) {
      // 造新行前 id 词法闸（防写死行 brick 下次 boot 读侧）：行不在场 = 本动词
      // 即将把该 id 首次落盘，坏词法（大写/下划线 typo 等）诚实拒——不写盘
      // 不落账；行在场分支无需重复校验（读侧 parseEnabledRows 已逐行把关）。
      if (!checkPluginId(id, { official: true })) {
        return {
          ok: false,
          message: `插件 id 格式不对（${id}——小写字母/数字/连字符，首字符非连字符；官方插件 core:<name> 后段同规则）——拒绝写入：格式不对的行落盘会使下次启动读侧拒启`,
        };
      }
      rows.push({ id, disabled: true });
      disabled = true;
    } else {
      const current = rows[index]!;
      if (current.disabled === true) {
        // 已禁用 → 回启用（行保场、旗标撤——config/opens 等字段原样保留）
        const { disabled: _drop, ...rest } = current;
        rows[index] = rest;
        disabled = false;
      } else {
        // 启用中 → 禁用（字段原样保留，只翻旗标）
        rows[index] = { ...current, disabled: true };
        disabled = true;
      }
    }
    writeEnabledRows(dataDir, rows, read.doors, fs);
    onLifecycleAudit?.('plugin/toggled', { id, disabled });
    return { ok: true };
  });
}

/**
 * setRowConfig：行 config 键整值替换（ix-3——03 §1.2 表单腿写盘位）。
 * 保行内其余字段原样（disabled/opens——整值替换只及 config 键）+ doors 段
 * 往返保真。行不在场：core: id = overlay 新行合法（内置态无行，写 config
 * 即立 overlay 行）；用户 id = 拒（未启用行编辑 = 先 mount——表单对不在
 * 启用面的用户插件诚实指路，不凭空造行）。
 *
 * 审计词缺席注记：生命周期五词（05 §1.1）辖装机/挂载/卸下/翻转/更新五
 * 动词——config 编辑不在六动词面（ix-1 规范笔未立词）；secret 写凭证盒
 * 有自有审计道（credentials/changed seam——表单腿装配位接线）。
 */
export function setRowConfig(dataDir: string, id: string, config: unknown, fs: PluginStoreFs): RowEditResult {
  // 读-改-写整段互斥（config 非对象防御位与造行词法闸在锁内——拒路径无写回）
  return rowEditUnderLock(dataDir, fs, () => {
    const read = readEnabledRowsForEdit(dataDir, fs);
    if (!read.ok) return read;
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      return { ok: false, message: 'config 须为对象（整值替换非合并）——表单腿产物恒对象，此处为防御位' };
    }
    const rows = [...read.rows];
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      if (!id.startsWith('core:')) {
        return { ok: false, message: `插件 ${id} 不在启用面——config 编辑先走 /plugins mount（不凭空造行）` };
      }
      // 造新行前 id 词法闸（toggleRow 同判据——写侧造行通律）：core: 后段坏
      // 词法（大写/下划线 typo 等）诚实拒不写盘——坏行落盘 = 下次 boot 读侧
      // PLUGIN_ROW_INVALID 全入口拒启，与行编辑面同判据 fail-loud 同锁死。
      if (!checkPluginId(id, { official: true })) {
        return {
          ok: false,
          message: `插件 id 格式不对（${id}——小写字母/数字/连字符，首字符非连字符；官方插件 core:<name> 后段同规则）——拒绝写入：格式不对的行落盘会使下次启动读侧拒启`,
        };
      }
      rows.push({ id, config });
    } else {
      rows[index] = { ...rows[index]!, config };
    }
    writeEnabledRows(dataDir, rows, read.doors, fs);
    return { ok: true };
  });
}

/**
 * enabled.yaml 原子写（yaml 序列化——与读侧形状对偶）。doors 段原样携带
 * （开门制扩展批 2026-09-09——03 §5.3 行编辑与段编辑全文件形状往返保真律：
 * 行编辑腿〔mount/uninstall/toggle〕重写本文件时 doors 段必须保真，静默抹段
 * = 静默收回用户授予，结构性禁止）；doors 缺席（段不在场）不凭空造段。
 */
function writeEnabledRows(
  dataDir: string,
  rows: readonly EnabledRow[],
  doors: readonly string[] | undefined,
  fs: PluginStoreFs,
): void {
  const doc = {
    plugins: rows.map((row) => {
      const out: Record<string, unknown> = { id: row.id };
      if (row.config !== undefined) out['config'] = row.config;
      if (row.disabled !== undefined) out['disabled'] = row.disabled;
      if (row.opens !== undefined) out['opens'] = [...row.opens];
      return out;
    }),
    ...(doors !== undefined ? { doors: [...doors] } : {}),
  };
  atomicWrite(fs, enabledYamlPath(dataDir), stringifyYaml(doc));
}

/* ---------------- doors 段编辑（03 §4.6 段编辑腿——g-2） ---------------- */

/**
 * doors/updated 落账 sink（段编辑腿成功真变更尾恰一次——载荷 = 去重排序后
 * 全量快照，与 recordDoorsDiff 审计形同形；origin 由装配位盖章〔TUI 位
 * 'tui-cmd'〕；CLI 面无此腿零落账）。落账失败由包装方自吞 warn（段编辑已
 * 生效不回滚——LifecycleAuditSink 同哲学）。
 */
export type DoorsAuditSink = (doors: readonly string[]) => void;

/**
 * doors 段编辑（03 §4.6 /doors 人面命令 = enabled.yaml 的编辑腿——g-2 落码）：
 * open/close **只动段不动行**（行集原样携带——与行编辑腿全文件形状往返保真律
 * 对偶方向）；值域执法 door ∈ DOORS_SEGMENT_V1_DOMAIN（射程即值域——七枚
 * 全宽将致三读分叉，拒绝式单源同 manifest 段校验）。
 *
 * 幂等律：open 已开 / close 未开 = no-op 成功**不写文件不落账**（无变更不
 * 造账——与 mount 幂等跳过、update local no-op 同律）；段缺席时 close 天然
 * 幂等（现集空不含任何位）、open 造段（`doors: [<位>]`——用户开门动作即段
 * 在场事实）；close 到空集写回**显式空段** `doors: []`（保真 + boot diff
 * `doors: []` 收口形的文件侧真相——03 §4.6「撤位 doors:[] 收口」）。
 * 写回形 = 去重排序稳态形（手编任意序在首编辑后归一——审计快照排序形一致）。
 */
export function editDoorsSegment(
  dataDir: string,
  action: { readonly verb: 'open' | 'close'; readonly door: string },
  fs: PluginStoreFs,
  onDoorsUpdated?: DoorsAuditSink,
): RowEditResult {
  // 值域执法（DOORS_SEGMENT_V1_DOMAIN 单源——与 manifest 段校验同源两执法位）；
  // 纯词法拒零 IO 零锁
  if (!DOORS_SEGMENT_V1_DOMAIN.includes(action.door)) {
    return {
      ok: false,
      message: `doors 段值域外能力位 "${action.door}"——值域 v1 = 两门枚举（现役：${DOORS_SEGMENT_V1_DOMAIN.join('、')}；§8.2 七枚高危面名单系上界，行 opens 位承载插件道五枚）`,
    };
  }
  // 幂等前置判（无锁读——先判幂等再取锁）：no-op 腿不写文件即无丢更新面，
  // 不占编辑锁（不与并行写者抢互斥位）；判有变更才进锁，锁内重读终判（无锁
  // 读与取锁间的竞窗以锁内快照为准——对方先改了段，本动词按新段复判幂等）
  const pre = readEnabledRowsForEdit(dataDir, fs);
  if (!pre.ok) return pre;
  const preContains = new Set(pre.doors ?? []).has(action.door); // 段缺席 = 空集（§5.3 缺席语义）
  if (action.verb === 'open' ? preContains : !preContains) {
    return { ok: true }; // 幂等 no-op——不写文件不落账（无变更不造账）
  }
  return rowEditUnderLock(dataDir, fs, () => {
    const read = readEnabledRowsForEdit(dataDir, fs);
    if (!read.ok) return read;
    const current = new Set(read.doors ?? []); // 段缺席 = 空集（§5.3 缺席语义）
    const contains = current.has(action.door);
    if (action.verb === 'open' ? contains : !contains) {
      return { ok: true }; // 锁内幂等复判（竞窗下终判以锁内快照为准）
    }
    if (action.verb === 'open') current.add(action.door);
    else current.delete(action.door);
    const doors = [...current].sort(); // 去重排序稳态形（Set 天然去重）
    writeEnabledRows(dataDir, read.rows, doors, fs);
    onDoorsUpdated?.(doors);
    return { ok: true };
  });
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
    throw new BaseError('PLUGIN_INSTALL_FAILED', `git url 格式不对（${url}）——应为 https://<host>/<首段>/<repo> 形`);
  }
  const first = pathParts[0]!;
  const repoRaw = pathParts[pathParts.length - 1]!;
  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -'.git'.length) : repoRaw;
  if (first.length === 0 || repo.length === 0) {
    throw new BaseError('PLUGIN_INSTALL_FAILED', `git url 格式不对（${url}）——首段或仓段为空`);
  }
  // 点段穿越拒（§9.6 布局段四处全验）：进 join 的三段值任一为 '.'/'..' 即拒
  // ——段值点形经 join 内折可吞父树（如 https://evil.com/../.. 折出 'plugins'
  // 本身，direct 落位 rm 递归即整 plugins/ 树抹除面）；'..x' 等非点形段不误伤
  for (const segment of [hostPart, first, repo]) {
    if (segment === '.' || segment === '..') {
      throw new BaseError('PLUGIN_INSTALL_FAILED', `git url 点段拒（${url}）——段值 '.'/'..' 内折吞父树面`);
    }
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
      `卸载安全防线：删除目标 ${target}（解析为 ${resolved}）不在插件安装目录 ${subtree} 内——安装记录异常，已拒绝删除`,
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

/**
 * 装机树结构位判定（删除腿窄防线——单源两腿共用）：目标词法归一（resolve
 * 折 './'/'..' 内折形）后等于装机子树根本身（`plugins/`）或其两分区根
 * （`plugins/node_modules/` / `plugins/market/`）之一即为结构位。
 *
 * 与 assertInsideInstallSubtree 的分工：恰等树根对逃逸断言**合法**（幂等
 * 重跑的空树形——断言只防逃逸不防等根）；但对 rm 递归删除腿等根是灾难位
 * ——rm 结构位 = ledger.json 与全量装机记录不可逆抹除。词法面防线（parse
 * 点段拒）被手改账本/旧账本 ref 绕过时这里是最后一道防御纵深。两消费腿：
 * install 回滚（rollbackInstall）跳 rm（回滚叙事是「清残影」非「摧毁」）；
 * uninstall 段② 拒清算（PLUGIN_UNINSTALL_REFUSED——坏账本叙事，人面收口）。
 */
export function isInstallStructurePath(dataDir: string, absoluteTarget: string): boolean {
  const structurePaths = [
    join(dataDir, 'plugins'),
    join(dataDir, 'plugins', 'node_modules'),
    join(dataDir, 'plugins', 'market'),
  ];
  const normalized = resolve(absoluteTarget);
  return structurePaths.some((p) => resolve(p) === normalized);
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
