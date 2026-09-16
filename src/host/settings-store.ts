/**
 * host/settings-store — 数据目录用户配置文件 `<dataDir>/settings.json` 读写件
 * （04 §9 定形块⑥·M3 兜缝——2026-09-11 审批分档批 ap-3）。
 *
 * 定位：sandbox 缺省档**持久用户配置层**——§8 三级解析挂第四层的载体：
 * 工具参数 > 会话策略 > CLI 旗标（逐次） > **本文件（持久缺省）** > 代码常量。
 * 持久位不覆盖逐次显式位（装配根做 gaps 填充，run-entry 只传显式胜者）。
 *
 * 键面（四键）：`sandboxMode?` / `approvalPolicy?`——预设展开的持久
 * 缺省位；**非敏感件**（两旋钮无秘密，不入 SENSITIVE_READ_DATA_PATHS——
 * 模型可读面不设防，恰四件敏感清单测试锁不动；2026-09-14 五役 CL-1 集员
 * 扩容 + 数组名自 BASENAMES 勘正后注笔随勘）。
 *
 * 第三键 `theme?`（批 10g——07 §4.1 R2 / 04 §9 ⑥ 注记；/themes 批值域扩）：
 * TUI 主题档 dark/light/auto 三内置 + **自定义主题名**（数据目录 themes/
 * `<名>.json` 文件名——07 §4.1 R2 挂账解挂批；合法形单源 isValidCustom
 * ThemeName），TUI 主入口装配消费（缺席 = auto 由 tui-entry 定缺省——本件
 * 零行为耦合，只存取与值域校验）。
 *
 * 第四键 `keybindings?`（批 10k——07 §4.1 R5）：TUI 键位用户覆盖（动作
 * id → 键串）。本面只做形校验（对象 + string→string），语义校验（未知
 * 动作/不可覆盖/冲突）归 Keymap fail-loud 呈报——见 HostSettings 头注。
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

import { isValidCustomThemeName, type ThemeSetting } from '../channels/index.js';
import type { ApprovalPolicyMode, SandboxMode } from '../safety/index.js';

/** 配置文件名（数据目录单段——04 §9 ⑥「本批定名」） */
export const SETTINGS_BASENAME = 'settings.json';

/** 配置面形状（四键均可选——缺席走代码常量层） */
export interface HostSettings {
  readonly sandboxMode?: SandboxMode;
  readonly approvalPolicy?: ApprovalPolicyMode;
  /** TUI 主题档（批 10g——dark/light/auto；消费位 = tui-entry 装配） */
  readonly theme?: ThemeSetting;
  /**
   * 键位用户覆盖（R5 批 10k——动作 id → 键串）：值域校验两分——本面只做
   * **形校验**（对象 + string→string 条目，坏形忽略点名），语义校验（未知
   * 动作/不可覆盖/畸形键串/冲突）归 Keymap resolveKeybindings fail-loud
   * （tui-entry 装配位呈报拒载清单）。非敏感件（键位无秘密）。
   */
  readonly keybindings?: Readonly<Record<string, string>>;
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
const THEME_SETTINGS: readonly string[] = ['dark', 'light', 'auto'];

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
  // 键级校验：四键值域/形校验外忽略点名；未知键 warn 保留不动（读侧不区分
  // 「保留在内存」与否——本面只产四键，未知键经写侧合并律存活）
  const record = doc as Record<string, unknown>;
  const { sandboxMode, approvalPolicy, theme, keybindings, ...rest } = record;
  const unknownKeys = Object.keys(rest);
  if (unknownKeys.length > 0) {
    warn(`配置含未知键 ${unknownKeys.join('、')}（${path}）——本面不消费、保留不动`);
  }
  const settings: {
    sandboxMode?: SandboxMode;
    approvalPolicy?: ApprovalPolicyMode;
    theme?: ThemeSetting;
    keybindings?: Readonly<Record<string, string>>;
  } = {};
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
  if (theme !== undefined) {
    // 值域 = 三内置 + 自定义主题名（/themes 批——07 §4.1 R2 挂账解挂批：文件名
    // 即主题名，合法形单源 isValidCustomThemeName；内置三值为保留词同合法）
    if (typeof theme === 'string' && (THEME_SETTINGS.includes(theme) || isValidCustomThemeName(theme))) {
      settings.theme = theme;
    } else {
      warn(`配置键 theme 值域外（dark|light|auto|<自定义主题名>）——忽略该键`);
    }
  }
  // keybindings 形校验（本面只做形——语义归 Keymap fail-loud）：非对象忽略整键；
  // 条目值非字符串丢该条点名（好条目照常生效）
  if (keybindings !== undefined) {
    if (typeof keybindings === 'object' && keybindings !== null && !Array.isArray(keybindings)) {
      const entries: Record<string, string> = {};
      for (const [action, keys] of Object.entries(keybindings)) {
        if (typeof keys === 'string') {
          entries[action] = keys;
        } else {
          warn(`配置键 keybindings.${action} 值非字符串——丢该条`);
        }
      }
      settings.keybindings = entries;
    } else {
      warn('配置键 keybindings 须为对象（动作 id → 键串）——忽略该键');
    }
  }
  return { settings, healthy: true };
}

/** 写侧回执（与 appendToolPolicyEntry 同族三态） */
export type HostSettingsWriteResult = 'written' | 'rejected';

/**
 * 写侧合并面：**只动 patch 携带键**（在场键落值、缺席键不动现状——预设展开
 * 只写该预设携带的旋钮），未知键原样保留（用户手编面不因预设切换损毁）；原子
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
  // 的原始对象（readHostSettings 产物只含四键，未知键需原始面承载）
  const path = join(dataDir, SETTINGS_BASENAME);
  let base: Record<string, unknown> = {};
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) base = parsed;
  }
  const next: Record<string, unknown> = { ...base };
  if (patch.sandboxMode !== undefined) next.sandboxMode = patch.sandboxMode;
  if (patch.approvalPolicy !== undefined) next.approvalPolicy = patch.approvalPolicy;
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.keybindings !== undefined) next.keybindings = patch.keybindings;
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  return 'written';
}
