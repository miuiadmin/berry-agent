/**
 * host/single-instance — 单活跃机执法件（05 篇 §6.6；04 §1 运行时侧语义）。
 *
 * 同一数据目录同一时刻恰一活跃进程：启动即写活跃标记（pid + 启动时戳），
 * 二次启动标记在场且 pid 活 → `HOST_DATA_DIR_BUSY` 拒入；pid 死 → 接管
 * （陈旧标记清理后覆写）。serve 宿主（含 --daemon）是合法持有者——标记语义
 * 对 TUI/serve 两宿主同形；daemon 猝死 = 标记随进程亡，下次启动 pid 判死后
 * 接管（既有语义零新增）。豁免面（只读诊断/管理动词）由调用方裁——本件只
 * 提供 acquire/release 原语不预判豁免。
 *
 * 裁量钉位（规范未明文、本笔定形）：标记文件名 `active.json`（05 §6.6 只钉
 * 「数据目录下活跃标记文件（pid + 启动时戳）」未定名）；记录形
 * `{ pid, startedAt }` 单 JSON 行。
 *
 * 〔2026-11-09 ACP/MCP 无头多实例批——**共享租约形**〕hapi 等 ACP 客户端按
 * 会话 spawn `berry acp`（一会话一进程）、外部 agent 亦可并行 spawn 多个
 * `berry mcp`——无头形态合法多实例共存，独占标记把它们互相拒之门外（生产
 * 实锤：第二个 hapi berry 会话 HOST_DATA_DIR_BUSY）。本批加第二租约类：
 * - **独占租约**（legacy 形，语义原样）：`active.json` 单文件，恰一持有者；
 * - **共享租约**：`active.d/<pid>-<startedAt>.json` 逐进程一文件，计数共存
 *   无互斥；acquire 时机会清扫死 pid 条目（判死即删——无属主可比的清扫面，
 *   活 pid 条目永不误删）；release 只删己文件。
 * 两类互斥**对称执法**（保 05 §6.6 的 TUI/serve 世界不变量——交互宿主仍恰一）：
 * 共享 acquire 见活的独占持有者 → 拒；独占 acquire 见任一活共享持有者 → 拒
 * （TUI 世界〔输入史去重律/世代线性律〕的前提是独占，不能与无头群混跑）。
 */
import { readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BaseError } from '../contracts/index.js';

/** 活跃标记文件名（数据目录下——本笔裁量钉位） */
export const ACTIVE_MARKER_BASENAME = 'active.json';

/** 共享租约目录名（数据目录下——无头多实例批裁量钉位） */
export const SHARED_LEASE_DIR_BASENAME = 'active.d';

/** 活跃标记记录形（pid + 启动时戳——05 §6.6） */
export interface ActiveMarkerRecord {
  readonly pid: number;
  readonly startedAt: number;
}

/** acquire 失败面——标记在场且 pid 活（拒入；不打既有进程——fail-loud 不执法） */
export class DataDirBusyError extends BaseError {
  constructor(busy: ActiveMarkerRecord) {
    super(
      'HOST_DATA_DIR_BUSY',
      `数据目录已有活跃进程（pid ${busy.pid}，启动于 ${new Date(busy.startedAt).toISOString()}）——同一数据目录同一时刻恰一活跃进程；如确系残留标记且该 pid 已死会自动接管`,
    );
  }
}

/** 进程探活缺省实现：信号 0 探测（ESRCH = 死；EPERM = 活但非属主——按活计） */
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * tryUnlink 缺省实现（第十五役 α4 修——对齐注释 fail-loud）：ENOENT 幂等
 * 静默；其余错上抛。原实现裸 catch 全吞与注释宣称相悖——吞 EACCES/EROFS
 * 类错会把「标记清不掉」伪装成「已清」，数据目录病态被静默掩盖。serve-daemon
 * 的 pid/sock 清扫同律复用本实现（同句注释同缺陷双址同修）。
 */
export function defaultTryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // ENOENT 幁等（目标已是缺席态——并发清或未写过）
  }
}

/** acquire 选项（测试注入位：pid/时钟/探活/fs 动作均注） */
export interface AcquireOptions {
  readonly pid?: number;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
  /** 目录建（缺省 mkdirSync recursive——测试注 noop 免真目录） */
  readonly ensureDir?: (dir: string) => void;
  /**
   * 独占写标记（挖掘 20 轮竞窗收口——语义升级）：目标在场必须抛
   * code='EEXIST' 错（缺省 writeFileSync flag 'wx' 同律）。首读与写之间的
   * TOCTOU 竞窗（两进程同读缺席标记、先后盲覆写双开）由本语义收口——撞
   * EEXIST 触发重读重判（活拒/死接管清障重写）
   */
  readonly writeFile?: (path: string, text: string) => void;
  readonly readFile?: (path: string) => string;
  readonly tryUnlink?: (path: string) => void;
  /** 目录条目枚举（共享租约清扫面——缺省 readdirSync；测试注 stub 免真盘） */
  readonly listDir?: (dir: string) => string[];
}

/**
 * acquire 产物：release 释放标记（幂等——崩溃后下次启动判死接管兜底）
 */
export interface ActiveMarkerLease {
  readonly tookOver: boolean;
  readonly record: ActiveMarkerRecord;
  /** 删除标记文件（ENOENT 静默——幂等） */
  readonly release: () => void;
}

/**
 * 占据活跃标记（启动序第一步——先占标记再开库，拒双开于开库之前）。
 *
 * 判序：标记文件在场且可解析 → pid 活（isAlive 注入判）→ 拒（DataDirBusyError
 * / HOST_DATA_DIR_BUSY）；pid 死 → 接管覆写（tookOver = true）；标记残缺
 * （坏 JSON/缺字段）→ 视同陈旧接管（宁接管勿误拒——标记非真相源，durable
 * 日志才是）。标记缺席 → 直写（tookOver = false）。
 *
 * 竞窗收口（挖掘 20 轮）：写一律独占形（'wx'——在场即 EEXIST），首读与写
 * 之间他人落标时撞 EEXIST 重读重判（活拒/死接管清障重写）——read-then-
 * write 盲覆写竞窗下两进程可同时过闸双开。release 带属主比对（pid+
 * startedAt 全等才拆）——标记被接管者覆写后盲拆会把其保护一并拆掉。
 *
 * 清障防误删（挖掘 21 轮件9）：判死与 unlink 之间隔整个判活窗（调度抢占可
 * 任意拉宽）——并发接管者窗内落新标时，无条件 unlink 会毁掉其活标记且 wx
 * 不撞 EEXIST（路径已清空）重判腿永不触发 → 双开。两清障腿（接管腿与
 * EEXIST 重判腿）统一先重读确认在场仍是判死时读到的那条；已变 = 他人已
 * 接管 → 重走判序（有界递归——标记持续变更超帽时 fail-loud 拒入，宁拒不
 * 双开）。release 带属主比对（pid+startedAt 全等才拆）——标记被接管者覆写
 * 后盲拆会把其保护一并拆掉。
 */
export function acquireActiveMarker(dataDir: string, opts: AcquireOptions = {}): ActiveMarkerLease {
  return acquireMarkerInner(dataDir, opts, 0);
}

/** 判序重入深度帽：标记持续变更（连环并发接管）超帽 fail-loud 拒入 */
const RETRY_DEPTH_MAX = 3;

/** 判序真身（depth = 清障重读已变的重走轮次） */
function acquireMarkerInner(dataDir: string, opts: AcquireOptions, depth: number): ActiveMarkerLease {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? (() => Date.now());
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const ensureDir = opts.ensureDir ?? ((dir) => mkdirSync(dir, { recursive: true }));
  const writeFile = opts.writeFile ?? ((path, text) => writeFileSync(path, text, { flag: 'wx' }));
  const readFile = opts.readFile ?? ((path) => readFileSync(path, 'utf8'));
  const tryUnlink = opts.tryUnlink ?? defaultTryUnlink;

  const markerPath = join(dataDir, ACTIVE_MARKER_BASENAME);
  ensureDir(dataDir);

  // 对称执法②：活共享持有者（无头群）在场拒独占（TUI/serve 世界前提独占，
  // 与无头群混跑会破输入史去重律/世代线性律的前提——05 §6.6 不变量保形）
  const shared = liveSharedHolders(dataDir, opts);
  const firstShared = shared[0];
  if (firstShared !== undefined) {
    throw new DataDirBusyError(firstShared);
  }

  /** 标记读（缺席/读失败一律 null——两者都非拒入判据） */
  const readMarker = (): string | null => {
    try {
      return readFile(markerPath);
    } catch {
      return null;
    }
  };

  let tookOver = false;
  const prevText = readMarker();
  if (prevText !== null) {
    let prev: Partial<ActiveMarkerRecord> | null = null;
    try {
      prev = JSON.parse(prevText) as Partial<ActiveMarkerRecord>;
    } catch {
      prev = null; // 坏 JSON——残缺标记
    }
    if (prev !== null && typeof prev.pid === 'number' && Number.isInteger(prev.pid) && prev.pid > 0) {
      if (isAlive(prev.pid)) {
        // 活进程持锁——拒入（携带既有记录供诊断面呈现）
        throw new DataDirBusyError({
          pid: prev.pid,
          startedAt: typeof prev.startedAt === 'number' ? prev.startedAt : 0,
        });
      }
      tookOver = true; // pid 判死 → 陈旧标记接管
    } else {
      tookOver = true; // 残缺（坏 JSON / pid 字段坏）→ 视同陈旧（宁接管勿误拒）
    }
  }

  const record: ActiveMarkerRecord = { pid, startedAt: now() };
  const text = `${JSON.stringify(record)}\n`;
  /** 独占写（在场即 EEXIST——竞窗判据面） */
  const writeExclusive = (): void => {
    writeFile(markerPath, text);
  };
  /**
   * 清障安全闸（挖掘 21 轮件9）：判死（judgeText = 判序读到的那条）与
   * unlink 之间隔判活窗——并发接管者窗内落新标时无条件 unlink 会毁其活标
   * 记（wx 不撞 EEXIST、重判腿永不触发 → 双开）。清障前重读确认在场仍是
   * judgeText 那条；已变 = 他人已接管 → 'raced'（调用方重走判序）
   */
  const unlinkIfStill = (judgeText: string | null): 'cleared' | 'raced' => {
    if (readMarker() !== judgeText) return 'raced';
    tryUnlink(markerPath);
    return 'cleared';
  };
  /** 清障撞变更（他人接管落标）→ 有界重走判序；超帽 fail-loud 拒入不双开 */
  const onRaced = (): ActiveMarkerLease => {
    if (depth >= RETRY_DEPTH_MAX) {
      throw new BaseError(
        'HOST_DATA_DIR_BUSY',
        `数据目录活跃标记在接管窗内持续变更（连环并发接管超 ${RETRY_DEPTH_MAX} 轮）——fail-loud 拒入不双开，请重试启动`,
      );
    }
    return acquireMarkerInner(dataDir, opts, depth + 1);
  };
  if (tookOver) {
    // 判死接管：清障安全闸确认后独占写（原形在清判与写之间给他人让位）
    if (unlinkIfStill(prevText) === 'raced') return onRaced();
  }
  try {
    writeExclusive();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // 竞窗败者腿（挖掘 20 轮）：首读后他进程已写标记——重读重判单轮（再竞
    // 败 EEXIST 直穿——fail-loud 不双开，下次启动再战）
    const racedText = readMarker();
    let raced: ActiveMarkerRecord | null = null;
    try {
      const parsed = JSON.parse(racedText ?? '') as Partial<ActiveMarkerRecord>;
      if (parsed !== null && typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0) {
        raced = { pid: parsed.pid, startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0 };
      }
    } catch {
      raced = null; // 残缺——清障重试
    }
    if (raced !== null && isAlive(raced.pid)) {
      throw new DataDirBusyError(raced);
    }
    tookOver = true; // 竞窗发现的标记判死/残缺/已撤 → 接管语义
    // 清障安全闸（挖掘 21 轮件9 同律）：raced 判死与 unlink 之间他人仍可能
    // 落新标——已变则重走判序（ENOENT 幂等位：已撤形 judgeText=null 与当前
    // null 相等照走 no-op 清障，与旧语义同）
    if (unlinkIfStill(racedText) === 'raced') return onRaced();
    writeExclusive();
  }
  let released = false;
  return {
    tookOver,
    record,
    release: () => {
      if (released) return;
      released = true;
      // 属主比对（挖掘 20 轮）：标记可能已被他进程接管覆写（本进程曾被误判
      // 死/竞窗让位形）——盲 unlink 会拆掉接管者的保护（第三者随之可入双
      // 开）。只拆 pid+startedAt 全等己属的标记；非己属/残缺/已缺席一律不
      // 拆（残缺标记留给下回启动的接管判——宁留勿误拆）
      const current = readMarker();
      if (current === null) return;
      try {
        const parsed = JSON.parse(current) as Partial<ActiveMarkerRecord>;
        if (parsed.pid !== record.pid || parsed.startedAt !== record.startedAt) return; // 非己属
      } catch {
        return; // 残缺——不可证己属不拆
      }
      tryUnlink(markerPath);
    },
  };
}

/* ======================= 共享租约（无头多实例批） ======================= */

/** 共享租约条目文件名（`<pid>-<startedAt>.json`——属主键即文件名） */
function sharedLeaseFileName(record: ActiveMarkerRecord): string {
  return `${record.pid}-${record.startedAt}.json`;
}

/** 共享租约条目解析（坏名/坏形一律 null——清扫面宁跳勿炸） */
function parseSharedLeaseEntry(name: string): ActiveMarkerRecord | null {
  const m = /^(\d+)-(\d+)\.json$/.exec(name);
  if (m === null) return null;
  return { pid: Number(m[1]), startedAt: Number(m[2]) };
}

/** 独占标记的活持有读（缺席/残缺/死 pid → null——共享判据面只认活独占） */
function liveExclusiveHolder(dataDir: string, opts: AcquireOptions): ActiveMarkerRecord | null {
  try {
    const text =
      opts.readFile?.(join(dataDir, ACTIVE_MARKER_BASENAME)) ??
      readFileSync(join(dataDir, ACTIVE_MARKER_BASENAME), 'utf8');
    const parsed = JSON.parse(text) as Partial<ActiveMarkerRecord>;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    const isAlive = opts.isAlive ?? defaultIsAlive;
    if (!isAlive(parsed.pid)) return null;
    return { pid: parsed.pid, startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0 };
  } catch {
    return null;
  }
}

/**
 * 活共享持有者枚举（独占判据面——非空即有活无头客）。顺带机会清扫死 pid
 * 条目（删的恰是判死那条文件——活条目文件名与判据一一对应零误删面）。
 * 坏名/坏形条目跳过不删（非本 leasing 协议产物——宁留勿误删）。
 */
function liveSharedHolders(dataDir: string, opts: AcquireOptions): ActiveMarkerRecord[] {
  const dir = join(dataDir, SHARED_LEASE_DIR_BASENAME);
  const listDir =
    opts.listDir ??
    ((d: string) => {
      // 缺省 readdirSync——目录缺席 = 空集（首共享持有者尚未建目录）
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { readdirSync } = require('node:fs') as typeof import('node:fs');
        return readdirSync(d);
      } catch {
        return [];
      }
    });
  const tryUnlink = opts.tryUnlink ?? defaultTryUnlink;
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const alive: ActiveMarkerRecord[] = [];
  for (const name of listDir(dir)) {
    const entry = parseSharedLeaseEntry(name);
    if (entry === null) continue;
    if (isAlive(entry.pid)) {
      alive.push(entry);
    } else {
      // 机会清扫：判死条目即删（文件名即属主键——删的是判死那条本身）
      tryUnlink(join(dir, name));
    }
  }
  return alive;
}

/**
 * 占共享租约（无头多实例形态——ACP/MCP 客户端按会话 spawn 的合法共存）。
 *
 * 判序：活的独占持有者（active.json）在场 → 拒（TUI/serve 交互世界前提是
 * 独占，无头群不与混跑——05 §6.6 不变量对独占侧原样）；否则逐进程落
 * `active.d/<pid>-<startedAt>.json`（wx 独占写——同 pid 同毫秒双起才撞，
 * 现实不可达；撞则加一毫秒重试一轮）。**无共享互斥**——并发共享 acquire
 * 全通过（计数共存）。顺带机会清扫死 pid 条目（liveSharedHolders 内联）。
 * release 只删己文件（属主键 = 文件名——盲删零面）。
 */
export function acquireSharedLease(dataDir: string, opts: AcquireOptions = {}): ActiveMarkerLease {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? (() => Date.now());
  const ensureDir = opts.ensureDir ?? ((dir) => mkdirSync(dir, { recursive: true }));
  const writeFile = opts.writeFile ?? ((path, text) => writeFileSync(path, text, { flag: 'wx' }));
  const tryUnlink = opts.tryUnlink ?? defaultTryUnlink;

  // 对称执法①：活的独占持有者拒共享群
  const exclusive = liveExclusiveHolder(dataDir, opts);
  if (exclusive !== null) {
    throw new DataDirBusyError(exclusive);
  }

  const leaseDir = join(dataDir, SHARED_LEASE_DIR_BASENAME);
  ensureDir(leaseDir);
  // 机会清扫死条目 + 收集活持有（清扫不构成拒入判据——共享群内部无互斥）
  liveSharedHolders(dataDir, opts);

  let record: ActiveMarkerRecord = { pid, startedAt: now() };
  // 同键重试（pid+毫秒撞键——理论形；一轮加一毫秒即分离）
  for (let attempt = 0; ; attempt += 1) {
    const filePath = join(leaseDir, sharedLeaseFileName(record));
    try {
      writeFile(filePath, `${JSON.stringify(record)}\n`);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (attempt >= 3) {
        throw new BaseError(
          'HOST_DATA_DIR_BUSY',
          `共享租约条目键持续相撞（pid ${pid} 毫秒键 ${record.startedAt} 连撞 ${attempt + 1} 轮）——fail-loud 拒入，请重试启动`,
        );
      }
      record = { pid, startedAt: now() + attempt + 1 };
    }
  }

  let released = false;
  return {
    tookOver: false, // 共享形无接管语义（无互斥即无被接管物）
    record,
    release: () => {
      if (released) return;
      released = true;
      // 属主键 = 文件名——只删己文件（ENOENT 幂等：崩溃残条由后续 acquire 机会清扫）
      tryUnlink(join(leaseDir, sharedLeaseFileName(record)));
    },
  };
}
