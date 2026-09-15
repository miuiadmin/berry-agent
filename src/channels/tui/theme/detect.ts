/**
 * 主题探测件（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * 三块纯函数：
 * - **色域档探测**：COLORTERM / TERM 组合 → 三档（真彩判据 = COLORTERM 含
 *   truecolor|24bit；tmux 内层按 TERM 256color 尾判——R2「tmux 内层按
 *   TERM/COLORTERM 组合判」的兑现位）；
 * - **OSC 11 应答解析**：`11;rgb:RRRR/GGGG/BBBB`（每通道 1-4 位十六进制——
 *   xterm/iTerm2/kitty 主流形）→ 通道值按位宽归一到 0-255；
 * - **明暗裁定**：WCAG 相对亮度 < 0.5 = 暗底（R2「亮度判据〔YIQ 或同族〕」
 *   ——同族取 WCAG 感知线性化；探测编舞与超时降 dark 归 backend 件）。
 */
import { relativeLuminance, type RgbChannels } from '../../engine/index.js';
import { builtinPalette, type BuiltinPalette } from './palette.js';

/** 色域探测入参（宿主 env 的两键投影——确定性测试的注入面） */
export interface ColorEnv {
  readonly COLORTERM?: string;
  readonly TERM?: string;
}

/** 色域档探测：truecolor（COLORTERM 判）/ 256（COLORTERM 有值非真彩 或 TERM 256color）/ 16（兜底） */
export function detectColorDepth(env: ColorEnv): 'truecolor' | '256' | '16' {
  const colorterm = env.COLORTERM ?? '';
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 'truecolor';
  // COLORTERM 有值但非真彩标记：至少 256 扩展色在位（保守中档——不虚报真彩）
  if (colorterm !== '') return '256';
  const term = env.TERM ?? '';
  if (term.includes('256color')) return '256'; // tmux/screen 内层主流形（screen-256color / tmux-256color）
  return '16';
}

/** OSC 11 应答正则（xterm 主流形：`11;rgb:` + 三段 1-4 位十六进制 / 分隔） */
const OSC11_RE = /^11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})$/;

/**
 * OSC 11 应答解析 → 通道值（非 11 码 / 非 rgb 形 / 越界 → null 诚实拒——
 * 调用方按无应答处理维持现主题）。位宽归一：v / (16^len - 1) × 255 四舍五入
 * （1 位 [0,15] 与 4 位 [0,65535] 同归 [0,255]）。
 */
export function parseOsc11Reply(data: string): RgbChannels | null {
  const m = OSC11_RE.exec(data);
  if (m === null) return null;
  const scale = (hex: string): number => Math.round((parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);
  return { r: scale(m[1]!), g: scale(m[2]!), b: scale(m[3]!) };
}

/** 明暗裁定：相对亮度 < 0.5 = 暗底（阈值惯例值——R2 亮度判据定明暗） */
export function isDarkBackground(bg: RgbChannels): boolean {
  return relativeLuminance(bg) < 0.5;
}

/** 背景色 → 板（明暗裁定单源——auto 档与 probe 回执路共用） */
export function paletteForBackground(bg: RgbChannels): BuiltinPalette {
  return builtinPalette(isDarkBackground(bg) ? 'dark' : 'light');
}
