/**
 * host/allowlist-store — 跨会话 allowlist 文件读写件（04 §9 粘性第 3 款
 * 2026-09-07 定形块的装配侧执法；批 12f-4）。
 *
 * 载体 = 数据目录 `allowlist.json`（单一用途用户资产文件——与 boot-failures
 * /ledger 同族 JSON）。本件只管文件 IO 与行校验；匹配判定归 safety 域纯函数
 * 半边（matchAllowlist——engine 不碰文件），草案生成归审批服务（suggestedEntry）。
 *
 * 读写三律（定形块原文执法）：
 * - 读侧装配期载入：缺席 = 空清单零负担；**文件级坏形 = warn 降级视同空
 *   清单**（advisory 免问面坏形降级方向 = 更严〔多问〕不是更松，fail-closed
 *   同向——与 enabled.yaml 拒启律分立）；**行级坏形 = 剔除该行 + warn 点名**
 *   （防类型脏行进匹配引擎；文件不因读侧改写——机器永不覆写用户手写面）。
 * - 写侧唯一正门（装配注入 persistAllowlist 回调）：append 幂等去重（同
 *   tool+pattern 不二写）+ **原子替换**（临时文件 + rename——防撕裂丢条目）；
 *   **坏形期回写拒**（机器不在坏形文件上追加——防覆写扩大破坏，修复归用户手面）。
 * - fence（§7/§8 carve-out）：本文件属数据目录族恒不可写——模型不可改自己
 *   的免问面；本件写入只经装配层回调（用户显式按键触发），文件级只读校验
 *   前置即坏形拒写的第一道闸。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AllowlistDraft, AllowlistEntry } from '../safety/index.js';

/** allowlist 文件名（数据目录单段——04 §9 定形块定名） */
export const ALLOWLIST_BASENAME = 'allowlist.json';

/** 读侧产物（healthy=false = 文件级坏形已降级——写侧拒写依据） */
export interface AllowlistLoad {
  readonly entries: readonly AllowlistEntry[];
  /** false = 文件级坏形（视同空清单 + 回写拒）；true = 缺席或好形 */
  readonly healthy: boolean;
}

/** 读侧选项 */
export interface ReadAllowlistOptions {
  /** 警示面（坏形 warn 落点——缺省 stderr；装配层接 logger.warn） */
  readonly warn?: (message: string) => void;
}

/**
 * 装配期载入 allowlist（04 §9 定形块读侧律）。缺席 = 空清单 healthy（零负担
 * 首启）；文件级坏形 = 空 + warn + unhealthy；行级坏形 = 剔行 + warn 点名。
 */
export function readAllowlist(dataDir: string, options: ReadAllowlistOptions = {}): AllowlistLoad {
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));
  const path = join(dataDir, ALLOWLIST_BASENAME);
  if (!existsSync(path)) return { entries: [], healthy: true }; // 首启零文件零负担
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    warn(`allowlist 读取失败（${path}）：${err instanceof Error ? err.message : String(err)}——视同空清单`);
    return { entries: [], healthy: false };
  }
  // 文件级三检：JSON 可解析 / 顶层对象 / entries 为数组——任一违例整文件降级
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    warn(
      `allowlist 坏形（${path}，JSON 解析失败：${err instanceof Error ? err.message : String(err)}）——视同空清单；手改修复前回写拒（防机器覆写扩大破坏）`,
    );
    return { entries: [], healthy: false };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    warn(`allowlist 坏形（${path}，顶层须为对象 { "entries": [...] }）——视同空清单；手改修复前回写拒`);
    return { entries: [], healthy: false };
  }
  const rows = (doc as { entries?: unknown }).entries;
  if (!Array.isArray(rows)) {
    warn(`allowlist 坏形（${path}，entries 须为数组）——视同空清单；手改修复前回写拒`);
    return { entries: [], healthy: false };
  }
  // 行级校验（拒绝式 schema：tool/pattern 字符串必填、expiresAt 可选数值、
  // 未知键拒）——违例剔行 warn 点名（文件不动：机器永不改写用户手写面）
  const entries: AllowlistEntry[] = [];
  rows.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) {
      warn(`allowlist 第 ${index + 1} 行非对象——剔除（文件未改动）`);
      return;
    }
    const { tool, pattern, expiresAt, ...rest } = row as Record<string, unknown>;
    if (typeof tool !== 'string' || tool.length === 0) {
      warn(`allowlist 第 ${index + 1} 行 tool 缺失或非字符串——剔除（文件未改动）`);
      return;
    }
    if (typeof pattern !== 'string' || pattern.length === 0) {
      warn(`allowlist 第 ${index + 1} 行 pattern 缺失或非字符串——剔除（文件未改动）`);
      return;
    }
    if (expiresAt !== undefined && typeof expiresAt !== 'number') {
      warn(`allowlist 第 ${index + 1} 行 expiresAt 须为数值——剔除（文件未改动）`);
      return;
    }
    const unknownKeys = Object.keys(rest);
    if (unknownKeys.length > 0) {
      warn(`allowlist 第 ${index + 1} 行未知键 ${unknownKeys.join('、')}——剔除（文件未改动）`);
      return;
    }
    entries.push(expiresAt === undefined ? { tool, pattern } : { tool, pattern, expiresAt });
  });
  return { entries, healthy: true };
}

/** append 回执（三态——审计/测试面可分辨） */
export type AllowlistAppendResult = 'appended' | 'duplicate' | 'rejected';

/**
 * 写侧唯一正门：追加条目（04 §9 定形块写侧律——装配注入 persistAllowlist
 * 回调的文件侧执行体）。幂等去重（同 tool+pattern 不二写）；原子替换落盘
 * （tmp + rename）；文件级坏形期拒写（修复归用户手面）。
 */
export function appendAllowlistEntry(dataDir: string, draft: AllowlistDraft): AllowlistAppendResult {
  const path = join(dataDir, ALLOWLIST_BASENAME);
  // 坏形拒写第一闸：复用读侧全套校验（坏形期在坏文件上追加 = 覆写扩大破坏）
  const load = readAllowlist(dataDir);
  if (!load.healthy) return 'rejected';
  if (load.entries.some((e) => e.tool === draft.tool && e.pattern === draft.pattern)) return 'duplicate';
  const entries = [...load.entries, { tool: draft.tool, pattern: draft.pattern }];
  // 原子替换：临时文件写全量后 rename——撕裂窗口不暴露半文件（用户资产完整性）
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  return 'appended';
}
