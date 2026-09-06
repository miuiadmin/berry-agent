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

/** acquire 选项（测试注入位：pid/时钟/探活/fs 动作均注） */
export interface AcquireOptions {
  readonly pid?: number;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
  /** 目录建（缺省 mkdirSync recursive——测试注 noop 免真目录） */
  readonly ensureDir?: (dir: string) => void;
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
 */
export function acquireActiveMarker(dataDir: string, opts: AcquireOptions = {}): ActiveMarkerLease {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? (() => Date.now());
  const isAlive = opts.isAlive ?? defaultIsAlive;
  const ensureDir = opts.ensureDir ?? ((dir) => mkdirSync(dir, { recursive: true }));
  const writeFile = opts.writeFile ?? ((path, text) => writeFileSync(path, text));
  const readFile = opts.readFile ?? ((path) => readFileSync(path, 'utf8'));
  const tryUnlink =
    opts.tryUnlink ??
    ((path) => {
      try {
        unlinkSync(path);
      } catch {
        // ENOENT 幂等；其他错上抛（fail-loud——标记不可清是数据目录病态）
      }
    });

  const markerPath = join(dataDir, ACTIVE_MARKER_BASENAME);
  ensureDir(dataDir);

  let tookOver = false;
  let prevText: string | null = null;
  try {
    prevText = readFile(markerPath);
  } catch {
    prevText = null; // 标记缺席（ENOENT）——首占非接管
  }
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
  writeFile(markerPath, `${JSON.stringify(record)}\n`);
  let released = false;
  return {
    tookOver,
    record,
    release: () => {
      if (released) return;
      released = true;
      tryUnlink(markerPath);
    },
  };
}
