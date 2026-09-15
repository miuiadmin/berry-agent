/**
 * 主题解析件（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * 色板 + 终端色域档 → ResolvedTheme：**构造期一次性降采**（渲染路径零降采
 * 开销——样式恒等比较不被降采抖动破坏；07 R2 降采语义条款的执法位）。
 * 降采算法单源 = engine color 件（rgbTo256 饱和度感知 / rgbTo16 最近邻）；
 * AnsiColor 源值全档直通（终端色板位——尊重用户自定义色板）。
 */
import {
  colorRgbOf,
  rgbTo16,
  rgbTo256,
  type AnsiColor,
  type ColorValue,
  type RgbChannels,
} from '../../engine/index.js';
import { DARK_PALETTE, type BuiltinPalette } from './palette.js';
import { SEMANTIC_KEYS, type SemanticKey } from './semantic.js';

/** 终端色域三档（探测归 detect 件——truecolor / 256 / 16） */
export type ColorDepth = 'truecolor' | '256' | '16';

/**
 * 解析后主题（消费者唯一注入面）：语义键全键位已定值（text 可 undefined =
 * 终端缺省前景）。**冻结对象**——probe 换装走整体换引用（setTheme 幂等替换），
 * 不在原对象上改值（渲染中途主题漂移不可见）。
 */
export interface ResolvedTheme {
  /** 解析时的色域档（降采依据——观测面） */
  readonly depth: ColorDepth;
  /** 暗底板旗标（板 id 单源——探测件裁定 auto 档用） */
  readonly dark: boolean;
  readonly accent: ColorValue;
  readonly text: ColorValue | undefined;
  readonly secondary: ColorValue;
  readonly thinkingText: ColorValue;
  readonly success: ColorValue;
  readonly error: ColorValue;
  readonly diffAdded: ColorValue;
  readonly diffRemoved: ColorValue;
  readonly link: ColorValue;
  readonly tableRule: ColorValue;
  readonly codeInline: ColorValue;
}

/** 单键源值降采（undefined / AnsiColor 直通；RgbChannels 按档降采） */
function toDepthValue(value: RgbChannels | AnsiColor | undefined, depth: ColorDepth): ColorValue | undefined {
  if (value === undefined || typeof value === 'number') return value; // AnsiColor 是 number brand——直通
  switch (depth) {
    case 'truecolor':
      return colorRgbOf(value.r, value.g, value.b);
    case '256':
      return rgbTo256(value);
    case '16':
      return rgbTo16(value);
  }
}

/**
 * 色板 + 色域档 → ResolvedTheme（构造期一次降采、全键冻结）。
 * 键遍历单源 = SEMANTIC_KEYS 表——增键只动 semantic/palette 两件，本函数零改。
 * 完整性契约：SEMANTIC_KEYS 覆盖 ResolvedTheme 全部语义键（semantic 件头注
 * 两处清单同步义务）——编译器不核此约束，越键漏值属编程错、fail-loud 于消费。
 */
export function resolveTheme(palette: BuiltinPalette, depth: ColorDepth): ResolvedTheme {
  const colors = {} as Record<SemanticKey, ColorValue | undefined>;
  for (const key of SEMANTIC_KEYS) {
    colors[key] = toDepthValue(palette.colors[key], depth);
  }
  return Object.freeze({ depth, dark: palette.id === 'dark', ...colors }) as ResolvedTheme;
}

/**
 * 缺省主题（组件构造的无注入回退位 = dark 板 16 色档）：accent 落 ANSI 6
 * cyan——与批 10g 前 ACCENT_INDEX=ansiColor(6) 字节同源（既有快照/字节断言
 * 不动的确定性基线）。
 */
export const DEFAULT_THEME: ResolvedTheme = resolveTheme(DARK_PALETTE, '16');
