/**
 * 三档色域实现件（07 §4.1 引擎节件 3 R2 改裁——批 10g）。
 *
 * 职责三块（纯函数、零 IO）：
 * - **SGR 序列化**：ColorValue → SGR 参数段（16 色 30+n/90+(n-8) 与 38;5/38;2
 *   扩展形——与既有 buildSgr 双胞胎〔diff 件 / ansi-rows 件〕字节同源，本件
 *   是两处序列化的单源参数生成器）；
 * - **降采样**：真彩 → 256（6×6×6 cube + 24 灰阶 + 饱和度感知）与真彩 → 16
 *   （标准 xterm 16 色板最近邻）——主题层按终端档位在构造 ResolvedTheme 时
 *   一次性降采（渲染路径零降采开销，样式恒等比较不被降采抖动破坏）；
 * - **通道拆解与亮度**：ColorRgb → RgbChannels 与相对亮度判据（OSC 11 背景
 *   明暗裁定的数值面）。
 */
import type { AnsiColor, Color256, ColorRgb, ColorValue, RgbChannels } from './types.js';
import { ansiColor, color256 } from './types.js';

/** 真彩通道拆解（`#rrggbb` → 三通道；colorRgb 构造已保证形合法——此处零再校验） */
export function rgbChannels(hex: ColorRgb): RgbChannels {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * 相对亮度（WCAG 感知亮度——绿色权重最高贴合人眼；OSC 11 背景明暗裁定判据）。
 * 阈值惯例 0.5：低于即暗底（主题层消费，本件只产数值）。
 */
export function relativeLuminance({ r, g, b }: RgbChannels): number {
  // 感知线性化分段：≤0.03928 走斜率支（数值上 ≈ /12.92），否则幂律支
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 前景 SGR 参数段（'36' / '38;5;n' / '38;2;r;g;b'——buildSgr 消费拼段） */
export function colorSgrFg(color: ColorValue): string {
  if (typeof color === 'number') {
    return isAnsi16(color) ? String(color < 8 ? 30 + color : 82 + color) : `38;5;${color}`;
  }
  const { r, g, b } = rgbChannels(color);
  return `38;2;${r};${g};${b}`;
}

/** 背景 SGR 参数段（'46' / '48;5;n' / '48;2;r;g;b'——与前景同律） */
export function colorSgrBg(color: ColorValue): string {
  if (typeof color === 'number') {
    return isAnsi16(color) ? String(color < 8 ? 40 + color : 92 + color) : `48;5;${color}`;
  }
  const { r, g, b } = rgbChannels(color);
  return `48;2;${r};${g};${b}`;
}

/** 数值色判档：brand 无法在运行时区分（同为 number）——16 色域恒 0-15、256 色 16-255 全域交叠在 0-15 */
function isAnsi16(color: number): boolean {
  // ColorValue 联合在类型层已收口两 brand；运行时按值域分档：0-15 视作 16 色
  // （256 色板的 0-15 恒指标准 16 色——xterm 语义，两档在该值域同义无须区分）
  return color >= 0 && color <= 15;
}

/** 标准 xterm 16 色板（降采最近邻基准表——rgbTo16 单源；测试直锁表完整性） */
export const ANSI16_TABLE: readonly RgbChannels[] = [
  { r: 0x00, g: 0x00, b: 0x00 }, // 0 黑
  { r: 0x80, g: 0x00, b: 0x00 }, // 1 红
  { r: 0x00, g: 0x80, b: 0x00 }, // 2 绿
  { r: 0x80, g: 0x80, b: 0x00 }, // 3 黄
  { r: 0x00, g: 0x00, b: 0x80 }, // 4 蓝
  { r: 0x80, g: 0x00, b: 0x80 }, // 5 品红
  { r: 0x00, g: 0x80, b: 0x80 }, // 6 青（accent 缺省域）
  { r: 0xc0, g: 0xc0, b: 0xc0 }, // 7 亮灰
  { r: 0x80, g: 0x80, b: 0x80 }, // 8 暗灰
  { r: 0xff, g: 0x00, b: 0x00 }, // 9 亮红
  { r: 0x00, g: 0xff, b: 0x00 }, // 10 亮绿
  { r: 0xff, g: 0xff, b: 0x00 }, // 11 亮黄
  { r: 0x00, g: 0x00, b: 0xff }, // 12 亮蓝
  { r: 0xff, g: 0x00, b: 0xff }, // 13 亮品红
  { r: 0x00, g: 0xff, b: 0xff }, // 14 亮青
  { r: 0xff, g: 0xff, b: 0xff }, // 15 白
];

/** 平方距离（无开方比较——单调等价） */
function dist2(a: RgbChannels, b: RgbChannels): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * 真彩 → 16 色（标准 xterm 16 色板最近邻——三档降采兜底档）。
 * 8 色降级终端由 SGR 亮位（90+ 段）+ bold 亮色映射惯例兜底（07 支持矩阵）。
 */
export function rgbTo16({ r, g, b }: RgbChannels): AnsiColor {
  const target = { r, g, b };
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ANSI16_TABLE.length; i++) {
    const d = dist2(target, ANSI16_TABLE[i]!);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return ansiColor(best);
}

/**
 * 真彩 → 256 色（三档中档降采）。
 *
 * 饱和度感知（saturation-aware）：低饱和（灰系）优先 24 级灰阶带
 * 〔232-255——均匀灰阶，cube 端点灰只有 6 级〕，高饱和走 6×6×6 cube
 * 〔16-231，各通道 5 级量化 0/95/135/175/215/255〕。判据 = 最大通道差
 * （max-min < 8 ≈ 视觉无彩）——比 HSV 饱和度更稳定（零除支）。
 */
export function rgbTo256({ r, g, b }: RgbChannels): Color256 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 8) {
    // 灰系 → 24 级灰阶带：亮度线性映射 232-255
    const luma = Math.round(((r + g + b) / 3 / 255) * 23);
    return color256(232 + luma);
  }
  // cube 量化表：5 级均匀锚点 → 段位（含端点吸附防 254→4 段漂移）
  const quant = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : v < 155 ? 2 : v < 195 ? 3 : v < 235 ? 4 : 5);
  const r6 = quant(r);
  const g6 = quant(g);
  const b6 = quant(b);
  return color256(16 + 36 * r6 + 6 * g6 + b6);
}
