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
  type Color256,
  type ColorValue,
  type RgbChannels,
} from '../../engine/index.js';
import { DARK_PALETTE, type ThemeBoard } from './palette.js';
import { SEMANTIC_KEYS, type ExactColor, type SemanticKey, type SemanticPalette } from './semantic.js';

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
  /** 高亮键族五键（批 10h——keyword/string/comment/number/function） */
  readonly codeKeyword: ColorValue;
  readonly codeString: ColorValue;
  readonly codeComment: ColorValue;
  readonly codeNumber: ColorValue;
  readonly codeFunction: ColorValue;
  /**
   * user 块背景带（界面美化役批⑦ R2 扩键注——首个背景键）：undefined = 无
   * 背景（探测失败/缺席、16 档降采、自定义板缺本键四形同落本位）。
   */
  readonly userMessageBg: ColorValue | undefined;
  /**
   * 弱存在感线（V-3 注⑨——回合记账分隔线/表格线/面板分段线三线族通用）：
   * undefined = 键缺席（板显式带值之外——混合基缺席〔text undefined 或色板
   * 位不可知〕/ 探测缺席 / 16 档 / 亮底对比不足四形），消费位回退 tableRule
   * 或 fg+dim 既有形。
   */
  readonly weakRule: ColorValue | undefined;
}

/**
 * xterm 256 色板索引 → 真彩通道展开（/themes 批——Color256 源值 16 档降采的
 * 前置步）：16-231 = 6×6×6 cube（通道 5 级锚点 0/95/135/175/215/255）、
 * 232-255 = 24 级灰阶（8+10i 均匀带）。0-15 恒指标准 16 色（engine color
 * isAnsi16 律——本函数不被该值域调用）。表值与 engine rgbTo256 量化锚点
 * 同源（xterm 标准色板公式）。
 */
function color256ToRgb(index: Color256): RgbChannels {
  const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;
  if (index >= 232) {
    // 灰阶带：232-255 → 8-238 均匀 10 级步进
    const gray = 8 + (index - 232) * 10;
    return { r: gray, g: gray, b: gray };
  }
  const i = index - 16;
  return {
    r: CUBE_LEVELS[Math.floor(i / 36)]!,
    g: CUBE_LEVELS[Math.floor(i / 6) % 6]!,
    b: CUBE_LEVELS[i % 6]!,
  };
}

/**
 * 单键源值降采：undefined / AnsiColor（0-15）直通；Color256（16-255）
 * truecolor/256 档直通、16 档展开回真彩走 rgbTo16 单源最近邻；ExactColor
 * 16 档走覆写位；RgbChannels 按档降采。
 */
function toDepthValue(
  value: RgbChannels | AnsiColor | Color256 | ExactColor | undefined,
  depth: ColorDepth,
): ColorValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    // 数值色双 brand 运行时同形：0-15 = 终端色板位全档直通；≥16 = 256 索引
    //（truecolor/256 档 38;5;n 两档同受支持直通；16 档须降采）
    if (value <= 15 || depth !== '16') return value;
    return rgbTo16(color256ToRgb(value as Color256));
  }
  if ('ansi16' in value) {
    // 精确对位形：rgb 主值两档照常（truecolor 直出 / 256 最近邻）、16 档覆写
    if (depth === '16') return value.ansi16;
    return depth === '256' ? rgbTo256(value.rgb) : colorRgbOf(value.rgb.r, value.rgb.g, value.rgb.b);
  }
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
 * user 块背景带混合（界面美化役批⑦ R2 扩键注——theme 侧纯函数，backend 只
 * 传探测值）：终端背景与板档决定混合方向——dark 板混白 12% alpha（每通道
 * c + 0.12 × (255 − c)）、light 板混黑 4%（c × 0.96）。逐通道四舍五入。
 */
function blendUserMessageBg(bg: RgbChannels, dark: boolean): RgbChannels {
  return dark
    ? {
        r: Math.round(bg.r + 0.12 * (255 - bg.r)),
        g: Math.round(bg.g + 0.12 * (255 - bg.g)),
        b: Math.round(bg.b + 0.12 * (255 - bg.b)),
      }
    : { r: Math.round(bg.r * 0.96), g: Math.round(bg.g * 0.96), b: Math.round(bg.b * 0.96) };
}

/**
 * 弱存在感线混合（V-3 注⑨②——theme 侧纯函数）：主题 fg @ 20% alpha 混探测
 * bg，逐通道 round(fg×0.2 + bg×0.8)——量级对齐 userMessageBg 白 12% 形（线
 * 比带更弱：前景占比更低）。
 */
function blendWeakRule(fg: RgbChannels, bg: RgbChannels): RgbChannels {
  return {
    r: Math.round(fg.r * 0.2 + bg.r * 0.8),
    g: Math.round(fg.g * 0.2 + bg.g * 0.8),
    b: Math.round(fg.b * 0.2 + bg.b * 0.8),
  };
}

/**
 * 弱线可见性判据（V-3 注⑨⑤亮底安全——判据定值）：混合产色与背景逐通道差
 * 绝对值的均值 < 8（0-255 域 ~3%）→ 视为对比不足，键缺席（消费位回退
 * fg+dim 既有形——dim 属性位在任意底上可见，不依赖色差）。
 */
function weakRuleVisible(blend: RgbChannels, bg: RgbChannels): boolean {
  const meanDelta = (Math.abs(blend.r - bg.r) + Math.abs(blend.g - bg.g) + Math.abs(blend.b - bg.b)) / 3;
  return meanDelta >= 8;
}

/**
 * 混合基通道展开（V-3 注⑨②）：text 源值 → 可参与混合的 RGB 通道。RgbChannels
 * 直取 / ExactColor 取 rgb 主值 / Color256 经 color256ToRgb 展开；undefined 与
 * AnsiColor（0-15 色板位——RGB 随终端用户配置不可知）→ 无混合基（键缺席，
 * 不猜未知 fg）。
 */
function textRgbOf(value: SemanticPalette['text']): RgbChannels | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    // 数值色双 brand 运行时同形：0-15 色板位不可知；≥16 = 256 索引可展开
    return value <= 15 ? undefined : color256ToRgb(value as Color256);
  }
  if ('ansi16' in value) return value.rgb; // 精确对位形——rgb 主值即混合基
  return value;
}

/**
 * 色板 + 色域档 → ResolvedTheme（构造期一次降采、全键冻结）。
 * 入参形 = ThemeBoard（内置板与自定义板共形——自定义板由 custom 件合成：
 * 基板同位键 + 文件键级覆盖）。键遍历单源 = SEMANTIC_KEYS 表——增键动
 * semantic/palette/本件 interface 三处（遍历零改）。完整性契约：SEMANTIC_KEYS
 * 覆盖 ResolvedTheme 全部语义键（semantic 件头注两处清单同步义务）——编译器
 * 不核此约束，越键漏值属编程错、fail-loud 于消费。
 *
 * `terminalBg`（OSC 11 探测背景——界面美化役批⑦ R2 扩键注）喂两动态键的
 * 混合腿：userMessageBg（板缺本键 + 探测在场 + 非 16 档 → 按板档混合；16 档
 * 降采回退 undefined——背景带真彩近似混色不降采对位，低档位宁可无带不可错
 * 色；自定义板显式带本键值则板值优先）与 weakRule（V-3 注⑨——板缺本键 +
 * 主题 fg 可展 + 探测在场 + 非 16 档 → fg @ 20% alpha 现算，走 toDepthValue
 * 与 userMessageBg 同链降深；对比不足键缺席）。
 */
export function resolveTheme(board: ThemeBoard, depth: ColorDepth, terminalBg?: RgbChannels): ResolvedTheme {
  const colors = {} as Record<SemanticKey, ColorValue | undefined>;
  for (const key of SEMANTIC_KEYS) {
    colors[key] = toDepthValue(board.colors[key], depth);
  }
  // userMessageBg 动态混合腿（唯一背景键——表驱动遍历后的特例单写位）：
  // 板缺本键 + 探测背景在场 + 非 16 档 → 按板档混合产出；否则维持 undefined
  if (board.colors.userMessageBg === undefined && terminalBg !== undefined && depth !== '16') {
    colors.userMessageBg = toDepthValue(blendUserMessageBg(terminalBg, board.dark), depth);
  }
  // weakRule 动态混合腿（V-3 注⑨——第二个特例单写位）：板缺本键 + 主题 fg
  // 可展（text 直值/256 展开/ExactColor 主值——色板位与缺席同无基）+ 探测
  // 背景 + 非 16 档 → 混合现算；对比不足（亮底安全判据）维持 undefined
  if (board.colors.weakRule === undefined && depth !== '16' && terminalBg !== undefined) {
    const fg = textRgbOf(board.colors.text);
    if (fg !== undefined) {
      const blend = blendWeakRule(fg, terminalBg);
      if (weakRuleVisible(blend, terminalBg)) colors.weakRule = toDepthValue(blend, depth);
    }
  }
  return Object.freeze({ depth, dark: board.dark, ...colors }) as ResolvedTheme;
}

/**
 * 缺省主题（组件构造的无注入回退位 = dark 板 16 色档）：accent 落 ANSI 6
 * cyan——与批 10g 前 ACCENT_INDEX=ansiColor(6) 字节同源（既有快照/字节断言
 * 不动的确定性基线）。
 */
export const DEFAULT_THEME: ResolvedTheme = resolveTheme(DARK_PALETTE, '16');
