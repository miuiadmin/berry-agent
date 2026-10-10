/**
 * 内置双主题色板（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * dark / light 两套（自定义主题文件形随 /themes 命令批落码——custom 件
 * 承载，缺键回退本件基板同位键）。取值基调：GitHub Primer 明暗两系的低饱和工程色——三档降采
 * 后仍可辨（256 cube 量化级距 > 阈值）、16 色最近邻落点集中（accent 例外
 * ——终端色板位直通，见 semantic 件注）。
 */
import { ansiColor, color256, colorRgb, rgbChannels } from '../../engine/index.js';
import type { ExactBgColor, ExactColor, SemanticPalette } from './semantic.js';

/**
 * 解析输入板形（resolveTheme / applyPalette 换装消费——/themes 批泛化）：
 * 内置板与自定义板共形。`dark` 是 **ResolvedTheme.dark 的单源**（明暗旗标
 * ——auto/自定义档经 OSC 11 探测基板裁定；自定义板 = 基板 dark 旗标 +
 * 文件键级覆盖，缺键回退基板同位键）。
 */
export interface ThemeBoard {
  /** 明暗旗标（ResolvedTheme.dark 单源） */
  readonly dark: boolean;
  readonly colors: SemanticPalette;
}

/**
 * 内置色板元数据载体（ThemeBoard 特化：`id` 是板身份位——builtinPalette
 * 映射与 auto 档基板选择消费；明暗裁定走 `dark` 解析位与自定义板同律）。
 */
export interface BuiltinPalette extends ThemeBoard {
  readonly id: 'dark' | 'light';
}

/** 色板源值简写（`#rrggbb` 构造校验 + 通道拆解——静态表错值启动即抛、测试直锁） */
function rgb(hex: string) {
  return rgbChannels(colorRgb(hex));
}

/**
 * 精确对位简写（批 10k 遗漏修 + 七役扫描批扩面）：rgb 主值 + 16 档覆写位。
 * 最近邻降采在低饱和蓝灰域系统性塌缩——高亮五键族（dark 板 4/5 键合流
 * ANSI 7）与非高亮同域塌缩键（七役扫描批：dark 板 tableRule → 0 黑零对比）
 * 照收。覆写值按「同键两板同色相族 + 互离 + 可见」人工定值：高亮五键
 * dark 9/6/8/12/13、light 1/4/8/12/5；非高亮键 dark tableRule→8（暗灰
 * 暗底可见）；R-3 行内色翻档——link/codeInline 由绿/蓝系迁 cyan 系（codex
 * 行内同构，16 档覆写位随迁 6；七役批注「codeInline→2 复绿」半句随批勘正）。
 */
function exact(hex: string, ansi16: number): ExactColor {
  return { rgb: rgbChannels(colorRgb(hex)), ansi16: ansiColor(ansi16) };
}

/**
 * 背景精确对位简写（R-3 批——diff bg 双键专用）：truecolor rgb 直出 +
 * 256 档 color256 直通覆写（22 绿暗底 / 52 红暗底——codex diff 静态定值，
 * 非最近邻降采）。16 档由 resolve 件 toDepthValue 专腿回退 undefined
 *（纯前景律——ExactBgColor 形语义位，不进本简写参数面）。
 */
function bgExact(hex: string, color256Idx: number): ExactBgColor {
  return { rgb: rgbChannels(colorRgb(hex)), color256: color256(color256Idx) };
}

/**
 * dark 板：accent = ANSI 6 cyan 终端色板位（R2「dark 的 accent 沿 ANSI 6
 * cyan」——全档直通，尊重终端用户自定义 cyan；真彩键取 GitHub dark 系）。
 */
export const DARK_PALETTE: BuiltinPalette = {
  id: 'dark',
  dark: true,
  colors: {
    accent: ansiColor(6),
    text: undefined,
    secondary: rgb('#8b949e'),
    thinkingText: rgb('#94a3b8'),
    success: rgb('#3fb950'),
    error: rgb('#f85149'),
    diffAdded: rgb('#3fb950'),
    diffRemoved: rgb('#f85149'),
    // 引用块行级基础色（R-3 批）：green 档与 success 同源值、16 档覆写 2 暗绿
    //（最近邻 #3fb950 偏亮落 10——引用块行级大面积用暗绿档更克制）
    quoteText: exact('#3fb950', 2),
    // diff 行级全宽 bg 色带（R-3 批）：codex diff 静态定值——truecolor 直出 /
    // 256 档覆写 22·52 / 16 档 undefined 回退纯前景（resolve 件专腿）
    diffAddedBg: bgExact('#213a2b', 22),
    diffRemovedBg: bgExact('#4a221d', 52),
    // 非高亮塌缩键 16 档覆写（七役扫描批 A1——最近邻塌缩：tableRule 落 0 黑
    // 暗底零对比）；link/codeInline R-3 批迁 cyan 系（codex 行内同构——真彩源
    // #39c5cf、16 档覆写 14 亮青：恰为最近邻落点且与 accent 6 互离——「accent
    // 色不入场」纪律在 16 档 dark 板的防线）；thinkingText 维持最近邻
    // （#94a3b8→7 亮灰：italic 属性位已可辨，不占覆写位——规范笔定裁）
    link: exact('#39c5cf', 14),
    tableRule: exact('#30363d', 8),
    codeInline: exact('#39c5cf', 14),
    // 高亮键族（GitHub dark 语法色系——keyword 红 / string 浅蓝 / comment 灰
    // / number 蓝青 / function 紫；五键 256 降采落点互离、16 档走精确对位覆写
    // 互离——最近邻在低饱和蓝灰域塌缩，见 exact 简写注）
    codeKeyword: exact('#ff7b72', 9),
    codeString: exact('#a5d6ff', 6),
    codeComment: exact('#8b949e', 8),
    codeNumber: exact('#79c0ff', 12),
    codeFunction: exact('#d2a8ff', 13),
    // user 块背景带（界面美化役批⑦ R2 扩键注）：内置板无静态定值位——恒
    // undefined，值由 resolve 件按 OSC 11 探测背景动态混合（dark 白 12%）
    userMessageBg: undefined,
    // 工具卡卡面带（TUI 对标 Codex 五件批 C 件 R2——第二背景键）：同
    // userMessageBg 注——恒 undefined 由 resolve 件动态混合（dark 白 8%
    // 弱一档），探测缺席/16 档 = 无卡面带
    toolCardBg: undefined,
    // 弱存在感线（V-3 注⑨）：内置板 text 恒 undefined → 无混合基 → 键恒缺席
    //（消费位回退 tableRule / fg+dim 既有形）；值只在自定义板定义 text 时
    // 由 resolve 件动态现算——本键无静态定值位
    weakRule: undefined,
  },
};

/**
 * light 板：accent = ANSI 4 blue（10g 定值——cyan 6 在亮底对比不足，蓝 4 是
 * 16 色板亮底经典强调位、暗底 cyan 的亮底对位；同为终端色板位全档直通）。
 */
export const LIGHT_PALETTE: BuiltinPalette = {
  id: 'light',
  dark: false,
  colors: {
    accent: ansiColor(4),
    text: undefined,
    secondary: rgb('#57606a'),
    thinkingText: rgb('#64748b'),
    success: rgb('#1a7f37'),
    error: rgb('#cf222e'),
    diffAdded: rgb('#1a7f37'),
    diffRemoved: rgb('#cf222e'),
    // 引用块行级基础色（R-3 批）：green 档与 success 同源值、16 档覆写 2 暗绿
    quoteText: exact('#1a7f37', 2),
    // diff 行级全宽 bg 色带（R-3 批）：亮板 codex 定值——256 档覆写与 dark 板
    // 同 22·52（色带档位语义一致，明暗差由 truecolor 主值承载）
    diffAddedBg: bgExact('#dafbe1', 22),
    diffRemovedBg: bgExact('#ffebe9', 52),
    // 非高亮塌缩键对位（七役扫描批 A1 + R-3 翻档）：link/codeInline 迁 cyan 系
    //（真彩源 #1b7c83 深青——亮底可见、16 档覆写 6）；tableRule 最近邻恰落 7
    // 亮灰（亮底表格线弱存在感正合真彩源 #d0d7de 意图）保留最近邻
    link: exact('#1b7c83', 6),
    tableRule: rgb('#d0d7de'),
    codeInline: exact('#1b7c83', 6),
    // 高亮键族（GitHub light 语法色系——与 dark 对位同键同语义；16 档走精确
    // 对位覆写 1/4/8/12/5——同色相族对板互离，见 exact 简写注）
    codeKeyword: exact('#cf222e', 1),
    codeString: exact('#0a3069', 4),
    codeComment: exact('#57606a', 8),
    codeNumber: exact('#0550ae', 12),
    codeFunction: exact('#8250df', 5),
    // user 块背景带（同 dark 板注——light 档混合黑 4%，resolve 件动态产出）
    userMessageBg: undefined,
    // 工具卡卡面带（同 dark 板注——light 档混合黑 3% 弱一档，resolve 件动态产出）
    toolCardBg: undefined,
    // 弱存在感线（V-3 注⑨，同 dark 板注——混合基缺席恒 undefined）
    weakRule: undefined,
  },
};

/** 显式档 → 内置板（auto 档的裁定归探测件，不经本函数） */
export function builtinPalette(setting: 'dark' | 'light'): BuiltinPalette {
  return setting === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}
