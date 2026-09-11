/**
 * host/tool-policy-store — 跨会话工具策略表文件读写件（04 §9 粘性第 3 款
 * 2026-09-07 定形块的装配侧执法；批 12f-4；2026-09-11 审批分档批六字段行形
 * 扩 + 载体更名 tool-policy.json——本件即更名执法与旧文件升格迁移所在）。
 *
 * 载体 = 数据目录 `tool-policy.json`（单一用途用户资产文件——与
 * boot-failures/ledger 同族 JSON；原名 `allowlist.json`，本批更名）。本件只
 * 管文件 IO 与行校验；匹配判定归 safety 域纯函数半边（matchToolPolicy——
 * engine 不碰文件），草案生成归审批服务（suggestedEntry）。
 *
 * 新旧文件共存序（04 §9 定形块③）：**新文件在场即唯一源**（旧文件在场也
 * 不读）；**唯旧在场且新缺席才升格读入**（旧三字段形 decision 缺席归一
 * allow——ap-1 读侧归一语义）；**旧文件留置不删**（机器永不写入旧名——
 * 升格只发生在读侧，新条目追加恒落新文件名；首次追加即把升格条目物化进
 * 新文件，旧文件自此为惰性遗存。生态未启动实际零存量，防御性迁移）。
 *
 * 读写三律（定形块原文执法）：
 * - 读侧装配期载入：缺席 = 空清单零负担；**文件级坏形 = warn 降级视同空
 *   清单**（advisory 免问面坏形降级方向 = 更严〔多问〕不是更松，fail-closed
 *   同向——与 enabled.yaml 拒启律分立）；**行级坏形 = 剔除该行 + warn 点名**
 *   （防类型脏行进匹配引擎；含 deny 条目带 expiresAt 的方向性坏形；文件不
 *   因读侧改写——机器永不覆写用户手写面）。升格读入语境下旧文件即当前
 *   源——旧文件坏形同律（坏形期回写拒，修复归用户手面）。
 * - 写侧唯一正门（装配注入 persistToolPolicy 回调）：**只产 allow 条目**
 *   （deny 唯用户手写）；append 幂等去重（同 tool+pattern 不二写）+
 *   **原子替换**（临时文件 + rename——防撕裂丢条目）；**坏形期回写拒**
 *   （机器不在坏形文件上追加——防覆写扩大破坏，修复归用户手面）。
 * - fence（§7/§8 carve-out）：本文件属数据目录族恒不可写——模型不可改自己
 *   的免问面；本件写入只经装配层回调（用户显式按键触发），文件级只读校验
 *   前置即坏形拒写的第一道闸。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ToolEffect } from '../contracts/index.js';
import type { ToolPolicyDraft, ToolPolicyEntry } from '../safety/index.js';

/** 策略表文件名（数据目录单段——04 §9 定形块③定名，2026-09-11 审批分档批更名） */
export const TOOL_POLICY_BASENAME = 'tool-policy.json';

/**
 * 旧载体名（更名前遗留）——升格读入用，**本件永不写入此名**（旧文件留置
 * 不删；读侧敏感件保护两名单同列——safety/sensitive 防旧文件读敞门）。
 */
export const LEGACY_ALLOWLIST_BASENAME = 'allowlist.json';

/** 读侧产物（healthy=false = 文件级坏形已降级——写侧拒写依据） */
export interface ToolPolicyLoad {
  readonly entries: readonly ToolPolicyEntry[];
  /** false = 文件级坏形（视同空清单 + 回写拒）；true = 缺席或好形 */
  readonly healthy: boolean;
}

/** 读侧选项 */
export interface ReadToolPolicyOptions {
  /** 警示面（坏形 warn 落点——缺省 stderr；装配层接 logger.warn） */
  readonly warn?: (message: string) => void;
}

/**
 * 单文件解析 + 行级校验（新旧文件同律——升格语境下旧三字段形 decision 缺席
 * 归一 allow）。返回 healthy=false = 文件级坏形（调用方定降级语义）。
 */
function loadPolicyFile(path: string, warn: (message: string) => void): ToolPolicyLoad {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    warn(`策略表读取失败（${path}）：${err instanceof Error ? err.message : String(err)}——视同空清单`);
    return { entries: [], healthy: false };
  }
  // 文件级三检：JSON 可解析 / 顶层对象 / entries 为数组——任一违例整文件降级
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    warn(
      `策略表坏形（${path}，JSON 解析失败：${err instanceof Error ? err.message : String(err)}）——视同空清单；手改修复前回写拒（防机器覆写扩大破坏）`,
    );
    return { entries: [], healthy: false };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    warn(`策略表坏形（${path}，顶层须为对象 { "entries": [...] }）——视同空清单；手改修复前回写拒`);
    return { entries: [], healthy: false };
  }
  const rows = (doc as { entries?: unknown }).entries;
  if (!Array.isArray(rows)) {
    warn(`策略表坏形（${path}，entries 须为数组）——视同空清单；手改修复前回写拒`);
    return { entries: [], healthy: false };
  }
  // 行级校验（拒绝式 schema——2026-09-11 审批分档批六字段扩：tool 非空字符串
  // 必填、pattern 可选〔在场须为字符串——空串/缺席对整名族合法；fs/bash 族
  // 条目缺席 = 引擎恒 miss 的惰性行，fail-closed 方向无害〕、decision 闭集
  // 'allow'|'deny'〔缺席 = allow——旧三字段形升格读入语义〕、effect 闭集
  // read|write|exec 可选、reason 可选字符串、expiresAt 可选数值〔**deny 条目带
  // expiresAt = 坏形剔除**——deny 无 TTL，04 §9 定形块③方向性条款〕、未知键
  // 拒）——违例剔行 warn 点名（文件不动：机器永不改写用户手写面）
  const entries: ToolPolicyEntry[] = [];
  rows.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) {
      warn(`策略表第 ${index + 1} 行非对象——剔除（文件未改动）`);
      return;
    }
    const { tool, pattern, decision, effect, reason, expiresAt, ...rest } = row as Record<string, unknown>;
    if (typeof tool !== 'string' || tool.length === 0) {
      warn(`策略表第 ${index + 1} 行 tool 缺失或非字符串——剔除（文件未改动）`);
      return;
    }
    if (pattern !== undefined && typeof pattern !== 'string') {
      warn(`策略表第 ${index + 1} 行 pattern 须为字符串——剔除（文件未改动）`);
      return;
    }
    if (decision !== undefined && decision !== 'allow' && decision !== 'deny') {
      warn(`策略表第 ${index + 1} 行 decision 闭集外（allow|deny）——剔除（文件未改动）`);
      return;
    }
    if (effect !== undefined && effect !== 'read' && effect !== 'write' && effect !== 'exec') {
      warn(`策略表第 ${index + 1} 行 effect 闭集外（read|write|exec）——剔除（文件未改动）`);
      return;
    }
    if (reason !== undefined && typeof reason !== 'string') {
      warn(`策略表第 ${index + 1} 行 reason 须为字符串——剔除（文件未改动）`);
      return;
    }
    if (expiresAt !== undefined && typeof expiresAt !== 'number') {
      warn(`策略表第 ${index + 1} 行 expiresAt 须为数值——剔除（文件未改动）`);
      return;
    }
    if (decision === 'deny' && expiresAt !== undefined) {
      warn(`策略表第 ${index + 1} 行 deny 条目带 expiresAt 属坏形（deny 无 TTL——永久至手删）——剔除（文件未改动）`);
      return;
    }
    const unknownKeys = Object.keys(rest);
    if (unknownKeys.length > 0) {
      warn(`策略表第 ${index + 1} 行未知键 ${unknownKeys.join('、')}——剔除（文件未改动）`);
      return;
    }
    // 塑形落位：可选字段缺席即不带（JSON 面?键不落盘）；decision 缺席归一 allow
    entries.push({
      tool,
      decision: decision ?? 'allow',
      ...(pattern !== undefined ? { pattern } : {}),
      ...(effect !== undefined ? { effect: effect as ToolEffect } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  });
  return { entries, healthy: true };
}

/**
 * 装配期载入工具策略表（04 §9 定形块读侧律 + 更名升格序）。新文件在场即
 * 唯一源；唯旧在场且新缺席才升格读入（旧文件留置不删）；两文件皆缺席 =
 * 空清单 healthy（零负担首启）；文件级坏形 = 空 + warn + unhealthy；行级
 * 坏形 = 剔行 + warn 点名。
 */
export function readToolPolicy(dataDir: string, options: ReadToolPolicyOptions = {}): ToolPolicyLoad {
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));
  // 共存优先序：新名在场即唯一源（旧名在场也不读——防止双源漂移）
  const path = join(dataDir, TOOL_POLICY_BASENAME);
  if (existsSync(path)) return loadPolicyFile(path, warn);
  // 升格读入：唯旧在场且新缺席——旧三字段形经行级归一（decision 缺省 allow）
  const legacyPath = join(dataDir, LEGACY_ALLOWLIST_BASENAME);
  if (existsSync(legacyPath)) {
    warn(
      `allowlist.json 已更名 tool-policy.json（2026-09-11 审批分档批）——旧文件条目升格读入，旧文件留置不动（机器永不写旧名；新条目追加落新文件 ${TOOL_POLICY_BASENAME}）`,
    );
    return loadPolicyFile(legacyPath, warn);
  }
  return { entries: [], healthy: true };
}

/** append 回执（三态——审计/测试面可分辨） */
export type ToolPolicyAppendResult = 'appended' | 'duplicate' | 'rejected';

/**
 * 写侧唯一正门：追加 **allow 条目**（04 §9 定形块写侧律 + 审批分档批③——
 * 机器永不写 deny，deny 是用户主权面唯用户手写）。幂等去重（同 tool+pattern
 * 的 allow 条目不二写——手写 deny 条目不参与去重键：引擎 deny 优先律下机器
 * allow 追加恒 inert，但去重误报 duplicate 会吞掉用户按键的真实意图呈现）；
 * 原子替换落盘（tmp + rename）；文件级坏形期拒写（修复归用户手面——升格
 * 语境下旧文件坏形同拒）。写入恒落新名 tool-policy.json（升格条目随首次
 * 追加物化进新文件，旧文件自此为惰性遗存）。
 */
export function appendToolPolicyEntry(dataDir: string, draft: ToolPolicyDraft): ToolPolicyAppendResult {
  const path = join(dataDir, TOOL_POLICY_BASENAME);
  // 坏形拒写第一闸：复用读侧全套校验（坏形期在坏文件上追加 = 覆写扩大破坏）
  const load = readToolPolicy(dataDir);
  if (!load.healthy) return 'rejected';
  if (load.entries.some((e) => e.decision !== 'deny' && e.tool === draft.tool && e.pattern === draft.pattern)) {
    return 'duplicate';
  }
  // 机器写入恒带 decision:'allow'（正门只产 allow 条目——六字段形自证）
  const entries = [...load.entries, { tool: draft.tool, pattern: draft.pattern, decision: 'allow' as const }];
  // 原子替换：临时文件写全量后 rename——撕裂窗口不暴露半文件（用户资产完整性）
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  return 'appended';
}
