/**
 * host/settings-store — 数据目录用户配置文件 `<dataDir>/settings.json` 读写件
 * （04 §9 定形块⑥·M3 兜缝——2026-09-11 审批分档批 ap-3）。
 *
 * 定位：sandbox 缺省档**持久用户配置层**——§8 三级解析挂第四层的载体：
 * 工具参数 > 会话策略 > CLI 旗标（逐次） > **本文件（持久缺省）** > 代码常量。
 * 持久位不覆盖逐次显式位（装配根做 gaps 填充，run-entry 只传显式胜者）。
 *
 * 两键面（本批定形）：`sandboxMode?` / `approvalPolicy?`——预设展开的持久
 * 缺省位；**非敏感件**（两旋钮无秘密，不入 SENSITIVE_READ_BASENAMES——
 * 模型可读面不设防，恰三件敏感清单测试锁不动）。
 *
 * 读写纪律（与 tool-policy-store 同族——「文件即用户资产」律）：
 * - 读侧缺席 = {}（零负担首启）；文件级坏 JSON = warn 降级 {}（配置层坏形
 *   取缺省 = 现状常量，非 fail-stop 面）；键级坏值 = 忽略该键 + warn 点名
 *   （好键照常生效）；未知键 = warn 不动文件（人可手编他键，机器不覆写）。
 * - 写侧**合并保留未知键**（预设写盘只动两键，用户手编的其他键原样存活）；
 *   原子替换（tmp + rename——防撕裂）；坏形期拒写（'rejected'——与
 *   appendToolPolicyEntry 同律，机器不在坏文件上覆写扩大破坏）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ApprovalPolicyMode, SandboxMode } from '../safety/index.js';

/** 配置文件名（数据目录单段——04 §9 ⑥「本批定名」） */
export const SETTINGS_BASENAME = 'settings.json';

/** 配置面形状（两键均可选——缺席走代码常量层） */
export interface HostSettings {
  readonly sandboxMode?: SandboxMode;
  readonly approvalPolicy?: ApprovalPolicyMode;
}

/** 读侧选项 */
export interface ReadHostSettingsOptions {
  /** 警示面（坏形 warn 落点——缺省 stderr；装配层接 logger.warn） */
  readonly warn?: (message: string) => void;
}

/** 读侧产物（healthy=false = 文件级坏形——写侧拒写依据） */
export interface HostSettingsLoad {
  readonly settings: HostSettings;
  /** false = 文件级坏形（已降级 {}；手改修复前回写拒）；true = 缺席或好形 */
  readonly healthy: boolean;
}

const SANDBOX_MODES: readonly string[] = ['read-only', 'workspace-write', 'danger'];
const APPROVAL_POLICIES: readonly string[] = ['ask', 'never'];

/**
 * 装配期读用户配置（缺席 {} 零负担；坏 JSON 降级 {} + unhealthy；键级坏值
 * 忽略点名、未知键 warn 不动文件）。
 */
export function readHostSettings(dataDir: string, options: ReadHostSettingsOptions = {}): HostSettingsLoad {
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));
  const path = join(dataDir, SETTINGS_BASENAME);
  if (!existsSync(path)) return { settings: {}, healthy: true };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    warn(`配置读取失败（${path}）：${err instanceof Error ? err.message : String(err)}——视同缺席`);
    return { settings: {}, healthy: false };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    warn(
      `配置坏形（${path}，JSON 解析失败：${err instanceof Error ? err.message : String(err)}）——视同缺席；手改修复前回写拒（防机器覆写扩大破坏）`,
    );
    return { settings: {}, healthy: false };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    warn(`配置坏形（${path}，顶层须为对象）——视同缺席；手改修复前回写拒`);
    return { settings: {}, healthy: false };
  }
  // 键级校验：两键值域闭集外忽略点名；未知键 warn 保留不动（读侧不区分
  // 「保留在内存」与否——本面只产两键，未知键经写侧合并律存活）
  const record = doc as Record<string, unknown>;
  const { sandboxMode, approvalPolicy, ...rest } = record;
  const unknownKeys = Object.keys(rest);
  if (unknownKeys.length > 0) {
    warn(`配置含未知键 ${unknownKeys.join('、')}（${path}）——本面不消费、保留不动`);
  }
  const settings: { sandboxMode?: SandboxMode; approvalPolicy?: ApprovalPolicyMode } = {};
  if (sandboxMode !== undefined) {
    if (typeof sandboxMode === 'string' && SANDBOX_MODES.includes(sandboxMode)) {
      settings.sandboxMode = sandboxMode as SandboxMode;
    } else {
      warn(`配置键 sandboxMode 值域外（read-only|workspace-write|danger）——忽略该键`);
    }
  }
  if (approvalPolicy !== undefined) {
    if (typeof approvalPolicy === 'string' && APPROVAL_POLICIES.includes(approvalPolicy)) {
      settings.approvalPolicy = approvalPolicy as ApprovalPolicyMode;
    } else {
      warn(`配置键 approvalPolicy 值域外（ask|never）——忽略该键`);
    }
  }
  return { settings, healthy: true };
}

/** 写侧回执（与 appendToolPolicyEntry 同族三态） */
export type HostSettingsWriteResult = 'written' | 'rejected';

/**
 * 写侧合并面：**只动两键**（在场键落值、缺席键不动现状——预设展开只写该
 * 预设携带的旋钮），未知键原样保留（用户手编面不因预设切换损毁）；原子
 * 替换落盘（tmp + rename）；文件级坏形期拒写。
 */
export function writeHostSettings(
  dataDir: string,
  patch: HostSettings,
  options: ReadHostSettingsOptions = {},
): HostSettingsWriteResult {
  // 坏形拒写第一闸：复用读侧全套校验（在坏文件上合并 = 覆写扩大破坏）
  const load = readHostSettings(dataDir, options);
  if (!load.healthy) return 'rejected';
  // 合并基 = 原文件解析出的全键形（含未知键——保留律）。重读一次拿未剥离
  // 的原始对象（readHostSettings 产物只含两键，未知键需原始面承载）
  const path = join(dataDir, SETTINGS_BASENAME);
  let base: Record<string, unknown> = {};
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) base = parsed;
  }
  const next: Record<string, unknown> = { ...base };
  if (patch.sandboxMode !== undefined) next.sandboxMode = patch.sandboxMode;
  if (patch.approvalPolicy !== undefined) next.approvalPolicy = patch.approvalPolicy;
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  return 'written';
}
