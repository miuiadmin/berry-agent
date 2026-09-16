/**
 * 自定义主题文件件（/themes 批——07 §4.1 R2 挂账解挂批文件形 + 命令面增补批
 * 合流落码）。
 *
 * 文件形：`数据目录/themes/<名>.json`（BERRY_AGENT_DATA_DIR 随动——数据目录
 * 由装配传入）；文件名即主题名（`.json` 后缀剥除）。键值面 = R2 语义键面 16
 * 键的**部分覆盖**——缺键回退基板同位键（基板按 OSC 11 探测明暗选、与文件
 * 选择正交——「自定义名直指文件零探测」只属文件选择面；回退合成在消费位
 * 展开，本件只产覆盖表）。
 *
 * 色值四形（「色值收 truecolor RGB 与 256 索引两形、16 色形保留——语义键
 * 值域同宽」）：
 * - 字符串 `'#rrggbb'` / `'#rgb'` → RgbChannels（真彩形）；
 * - 数字 0-15 → AnsiColor（16 色板位形）；16-255 → Color256（256 索引形）；
 * - 对象 `{rgb, ansi16}` → ExactColor（精确对位形——rgb 收 hex 串或
 *   `{r,g,b}` 通道对象、ansi16 收 0-15）。
 *
 * 坏文件处置（承 settings 键级坏值律——不炸进程不弃整板）：
 * - 文件缺席 / 读失败 / 非法 JSON / 顶层非对象 / **任一色值坏形** = warn 一行
 *   点名 + 返 null（调用位回退既有档——整文件拒载，好键不捡拾）；
 * - 未知键（非 16 语义键）= warn 点名 + 忽略该键（文件照常载——未知键非坏值）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ansiColor, color256, colorRgb, rgbChannels, type RgbChannels } from '../../engine/index.js';
import type { BuiltinPalette, ThemeBoard } from './palette.js';
import { SEMANTIC_KEYS, type ExactColor, type PartialSemanticPalette } from './semantic.js';

/** themes 子目录名（数据目录下——文件形真源） */
export const CUSTOM_THEME_DIR = 'themes';

/**
 * 主题名合法形（settings `theme` 键值域的自定义名判据）：单段路径形
 * `^[A-Za-z0-9][A-Za-z0-9._-]*$`、帽 64 字符——禁路径分隔符与首点
 *（`.`/`..` 陷阱拒入）。内置三值为保留词（dark/light/auto——同名文件被
 * 内置档遮蔽不可达，装配位先判内置再入自定义路）。
 */
const CUSTOM_THEME_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 主题名合法形判（单段 + 无路径 traversal——settings 值域校验与目录清单共源） */
export function isValidCustomThemeName(name: string): boolean {
  return CUSTOM_THEME_NAME_RE.test(name);
}

/**
 * 列主题名（themes/ 目录快照——/themes 副屏条目源）：目录缺席 = 空表零
 * 负担；只收 `.json` 文件且名合法形；字典序稳定（内置三档在前由装配拼接）。
 */
export function listCustomThemeNames(dataDir: string): string[] {
  const dir = join(dataDir, CUSTOM_THEME_DIR);
  let files: string[];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return []; // 目录缺席 / 读失败 = 无自定义主题（诚实空表不炸）
  }
  const names = files
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .filter((name) => isValidCustomThemeName(name));
  names.sort();
  return names;
}

/** 读侧选项（warn 面——坏形点名落点；缺省 stderr） */
export interface LoadCustomThemeOptions {
  readonly warn?: (message: string) => void;
}

/** JSON 值 → RgbChannels 通道对象（`{r,g,b}` 整数三通道 0-255；坏形 null） */
function parseChannels(value: unknown): RgbChannels | null {
  if (typeof value !== 'object' || value === null) return null;
  const { r, g, b } = value as Record<string, unknown>;
  if (
    typeof r !== 'number' ||
    typeof g !== 'number' ||
    typeof b !== 'number' ||
    !Number.isInteger(r) ||
    !Number.isInteger(g) ||
    !Number.isInteger(b) ||
    r < 0 ||
    r > 255 ||
    g < 0 ||
    g > 255 ||
    b < 0 ||
    b > 255
  ) {
    return null;
  }
  return { r, g, b };
}

/**
 * JSON 色值 → 源色值（四形收一）：hex 串 / 数值（0-15 与 16-255 分档）/
 * ExactColor 对象。坏形 = null（调用位整文件拒载）。
 */
function parseColorValue(value: unknown): RgbChannels | number | ExactColor | null {
  // 真彩形：'#rrggbb' / '#rgb'（colorRgb 构造校验——坏形抛错转 null）
  if (typeof value === 'string') {
    try {
      return rgbChannels(colorRgb(value));
    } catch {
      return null;
    }
  }
  // 数值形：0-15 = 16 色板位（AnsiColor）；16-255 = 256 索引（Color256）
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    return value <= 15 ? ansiColor(value) : color256(value);
  }
  // 精确对位形：{rgb: hex|通道对象, ansi16: 0-15}
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const { rgb, ansi16 } = value as Record<string, unknown>;
    if (typeof ansi16 !== 'number' || !Number.isInteger(ansi16) || ansi16 < 0 || ansi16 > 15) return null;
    let channels: RgbChannels | null = null;
    if (typeof rgb === 'string') {
      try {
        channels = rgbChannels(colorRgb(rgb));
      } catch {
        channels = null;
      }
    } else {
      channels = parseChannels(rgb);
    }
    if (channels === null) return null;
    return { rgb: channels, ansi16: ansiColor(ansi16) } satisfies ExactColor;
  }
  return null;
}

/**
 * 基板 + 覆盖表 → 合成板（/themes 批合成单源）：缺键回退基板同位键——展开
 * 合成 `{...基板, ...覆盖}`。消费位两处（backend 构造期下装与 OSC 11 回执
 * 重合成——明暗翻转基板换、覆盖恒在）。
 */
export function overlayBoard(base: BuiltinPalette, overlay: PartialSemanticPalette): ThemeBoard {
  return { dark: base.dark, colors: { ...base.colors, ...overlay } };
}

/**
 * 载入自定义主题覆盖表：返回**只在场键**的部分色板（缺键即回退位——调用侧
 * 与基板展开合成）。坏文件返 null + warn 一行点名（文件缺席 / 非法 JSON /
 * 顶层非对象 / 任一色值坏形 / 未知键忽略照载）。
 */
export function loadCustomThemeColors(
  dataDir: string,
  name: string,
  options: LoadCustomThemeOptions = {},
): PartialSemanticPalette | null {
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));
  const path = join(dataDir, CUSTOM_THEME_DIR, `${name}.json`);
  if (!existsSync(path)) {
    warn(`主题文件缺席（${path}）——回退既有档`);
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    warn(`主题文件读取失败（${path}）：${err instanceof Error ? err.message : String(err)}——回退既有档`);
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    warn(`主题文件坏形（${path}，JSON 解析失败：${err instanceof Error ? err.message : String(err)}）——回退既有档`);
    return null;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    warn(`主题文件坏形（${path}，顶层须为对象）——回退既有档`);
    return null;
  }
  const known = new Set<string>(SEMANTIC_KEYS);
  const overlay: PartialSemanticPalette = {};
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (!known.has(key)) {
      warn(`主题文件未知键 ${key}（${path}）——忽略该键`);
      continue;
    }
    const color = parseColorValue(value);
    if (color === null) {
      // 任一色值坏形 = 整文件拒载（不捡拾好键——settings 键级坏值律同源不弃整板）
      warn(`主题文件坏值（${path}，键 ${key} 非法色形）——回退既有档`);
      return null;
    }
    (overlay as Record<string, unknown>)[key] = color;
  }
  return overlay;
}
