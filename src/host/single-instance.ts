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
 */
import { readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BaseError } from '../contracts/index.js';

/** 活跃标记文件名（数据目录下——本笔裁量钉位） */
export const ACTIVE_MARKER_BASENAME = 'active.json';

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
    // ENOENT 幂等（目标已是缺席态——并发清或未写过）
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
}

/** acquire 产物：release 释放标记（幂等——崩溃后下次启动判死接管兜底） */
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
 */
export function acquireActiveMarker(dataDir: string, opts: AcquireOptions = {}): ActiveMarkerLease {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? (() => Date.now());
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const ensureDir = opts.ensureDir ?? ((dir) => mkdirSync(dir, { recursive: true }));
  const writeFile = opts.writeFile ?? ((path, text) => writeFileSync(path, text, { flag: 'wx' }));
  const readFile = opts.readFile ?? ((path) => readFileSync(path, 'utf8'));
  const tryUnlink = opts.tryUnlink ?? defaultTryUnlink;

  const markerPath = join(dataDir, ACTIVE_MARKER_BASENAME);
  ensureDir(dataDir);

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
  if (tookOver) {
    // 判死接管：先清陈旧标记再独占写（原盲覆写形在清判与写之间给他人让位）
    tryUnlink(markerPath);
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
    tryUnlink(markerPath); // ENOENT 幂等（标记已撤形 no-op）
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
