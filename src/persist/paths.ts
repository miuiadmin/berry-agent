/**
 * persist — 主库归属与数据目录解析（05 篇 §6.7 三级梯子 + §6.6 权限纪律）。
 *
 * 三级梯子：显式 BERRY_AGENT_DATA_DIR > 显式 BERRY_AGENT_DB_PATH > 缺省
 * ~/.berry-agent/sessions.db。环境变量优先级与命名全表在 07 篇；本文件是
 * 梯子的唯一实现（宿主各入口共用，禁止散落第二份解析）。
 */
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 数据目录环境变量（整目录覆盖——多数据目录 = 独立实例的正门，05 §6.6） */
export const DATA_DIR_ENV = 'BERRY_AGENT_DATA_DIR';

/** 库文件路径环境变量（单文件级覆盖——优先于数据目录拼接位） */
export const DB_PATH_ENV = 'BERRY_AGENT_DB_PATH';

/** 缺省数据目录名（家目录下） */
export const DEFAULT_DATA_DIR_BASENAME = '.berry-agent';

/** 缺省主库文件名 */
export const DEFAULT_DB_BASENAME = 'sessions.db';

/** 内存库哨兵值（CLI 组合诊断形态；better-sqlite3 原生 :memory: 语义） */
export const MEMORY_DB_PATH = ':memory:';

/**
 * 解析数据目录（梯子第 1/3 级）：BERRY_AGENT_DATA_DIR 显式值 > 缺省 ~/.berry-agent。
 * 注意：不解析 BERRY_AGENT_DB_PATH（那是库文件级覆盖，见 resolveDatabasePath）。
 */
export function resolveDataDir(): string {
  const override = process.env[DATA_DIR_ENV];
  if (override && override.trim() !== '') return override;
  return join(homedir(), DEFAULT_DATA_DIR_BASENAME);
}

/**
 * 解析主库文件路径（三级梯子全序）：
 * BERRY_AGENT_DB_PATH（完整文件路径，含 ':memory:' 哨兵直通）
 * > BERRY_AGENT_DATA_DIR 目录下 sessions.db
 * > 缺省 ~/.berry-agent/sessions.db。
 */
export function resolveDatabasePath(): string {
  const dbOverride = process.env[DB_PATH_ENV];
  if (dbOverride && dbOverride.trim() !== '') return dbOverride;
  return join(resolveDataDir(), DEFAULT_DB_BASENAME);
}

/**
 * 解析主库文件路径（锚定数据目录形——宿主装配根显式 dataDir 位的配套解析）：
 * BERRY_AGENT_DB_PATH 单文件级覆盖在场恒赢（tier-2 不被目录锚定吞掉）；
 * 否则库文件 = 传入目录下 sessions.db。
 *
 * 为什么需要本形（bug 回归锁的规范位）：resolveDatabasePath() 只看 env 梯子，
 * 完全无视调用方显式传入的 dataDir——宿主装配根（CLI --data-dir / 测试 rig）
 * 传了 dataDir 时库仍开在 env/家目录位，secret.key 与库分家（1e3a299 修过
 * CLI 直开库两处的同病，装配根主路径是漏网的第三处）。参数级语义：
 * 显式 dataDir > env BERRY_AGENT_DATA_DIR（常识序——显式参数先于 env）。
 */
export function resolveDatabasePathIn(dataDir: string): string {
  const dbOverride = process.env[DB_PATH_ENV];
  if (dbOverride && dbOverride.trim() !== '') return dbOverride;
  return join(dataDir, DEFAULT_DB_BASENAME);
}

/**
 * 确保数据目录在场且权限 0700（05 §6.6 自检修复 + warn——凭证是操作者状态
 * 五样之一，目录权限是第一道面）。幂等：在场且权限已符即静默通过。
 * @param dir 数据目录路径
 * @param warn 权限修复告警面（装配根接 logger.warn；缺省 console.error）
 */
export function ensureDataDir(dir: string, warn: (message: string) => void): void {
  if (!existsSync(dir)) {
    // mkdir 递归建链（父目录缺省权限随 umask——只执法数据目录自身 0700）
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  repairMode(dir, 0o700, '数据目录', warn);
}

/**
 * 单文件权限自检修复（0600 面——主库文件/secret.key 共用）：不符即 chmod
 * 修复 + warn（best-effort——chmod 失败也 warn 后继续，权限是加固面不是门禁）。
 * @param target 目标路径（须已存在）
 * @param name 告警文案里的目标名
 */
export function repairFileMode(target: string, name: string, warn: (message: string) => void): void {
  repairMode(target, 0o600, name, warn);
}

/** 权限位自检修复共用腿（目录 0700 / 文件 0600 同式） */
function repairMode(target: string, mode: number, name: string, warn: (message: string) => void): void {
  let bits: number;
  try {
    bits = statSync(target).mode & 0o777;
  } catch {
    return; // 不存在/不可 stat——创建方负责，此处不越权
  }
  if (bits === mode) return;
  try {
    chmodSync(target, mode);
    warn(`[persist] ${name}权限 ${bits.toString(8)} ≠ ${mode.toString(8)}，已修复（${target}）`);
  } catch (err) {
    warn(`[persist] ${name}权限 ${bits.toString(8)} ≠ ${mode.toString(8)}，修复失败：${String(err)}`);
  }
}

/** 数据目录派生位（secret.key 等数据目录内文件的定位面） */
export function dataFilePath(dataDir: string, basename: string): string {
  return join(dataDir, basename);
}

/** 库文件路径的数据目录推算（备份文件命名等邻接文件定位面） */
export function databaseDir(dbPath: string): string {
  return dirname(dbPath);
}
