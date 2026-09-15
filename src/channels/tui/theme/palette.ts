/**
 * 内置双主题色板（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * dark / light 两套（用户自定义 JSON 主题文件挂账不预造——承「配置面不
 * 预造」律）。取值基调：GitHub Primer 明暗两系的低饱和工程色——三档降采
 * 后仍可辨（256 cube 量化级距 > 阈值）、16 色最近邻落点集中（accent 例外
 * ——终端色板位直通，见 semantic 件注）。
 */
import { ansiColor, colorRgb, rgbChannels } from '../../engine/index.js';
import type { SemanticPalette } from './semantic.js';

/** 内置色板元数据载体（id 参与主题解析的明暗裁定——ResolvedTheme.dark 单源） */
export interface BuiltinPalette {
  readonly id: 'dark' | 'light';
  readonly colors: SemanticPalette;
}

/** 色板源值简写（`#rrggbb` 构造校验 + 通道拆解——静态表错值启动即抛、测试直锁） */
function rgb(hex: string) {
  return rgbChannels(colorRgb(hex));
}

/**
 * dark 板：accent = ANSI 6 cyan 终端色板位（R2「dark 的 accent 沿 ANSI 6
 * cyan」——全档直通，尊重终端用户自定义 cyan；真彩键取 GitHub dark 系）。
 */
export const DARK_PALETTE: BuiltinPalette = {
  id: 'dark',
  colors: {
    accent: ansiColor(6),
    text: undefined,
    secondary: rgb('#8b949e'),
    thinkingText: rgb('#94a3b8'),
    success: rgb('#3fb950'),
    error: rgb('#f85149'),
    diffAdded: rgb('#3fb950'),
    diffRemoved: rgb('#f85149'),
    link: rgb('#58a6ff'),
    tableRule: rgb('#30363d'),
    codeInline: rgb('#7ee787'),
    // 高亮键族（GitHub dark 语法色系——keyword 红 / string 浅蓝 / comment 灰
    // / number 蓝青 / function 紫；五键 256 降采落点互离、16 档键合流亦可辨）
    codeKeyword: rgb('#ff7b72'),
    codeString: rgb('#a5d6ff'),
    codeComment: rgb('#8b949e'),
    codeNumber: rgb('#79c0ff'),
    codeFunction: rgb('#d2a8ff'),
  },
};

/**
 * light 板：accent = ANSI 4 blue（10g 定值——cyan 6 在亮底对比不足，蓝 4 是
 * 16 色板亮底经典强调位、暗底 cyan 的亮底对位；同为终端色板位全档直通）。
 */
export const LIGHT_PALETTE: BuiltinPalette = {
  id: 'light',
  colors: {
    accent: ansiColor(4),
    text: undefined,
    secondary: rgb('#57606a'),
    thinkingText: rgb('#64748b'),
    success: rgb('#1a7f37'),
    error: rgb('#cf222e'),
    diffAdded: rgb('#1a7f37'),
    diffRemoved: rgb('#cf222e'),
    link: rgb('#0969da'),
    tableRule: rgb('#d0d7de'),
    codeInline: rgb('#116329'),
    // 高亮键族（GitHub light 语法色系——与 dark 对位同键同语义）
    codeKeyword: rgb('#cf222e'),
    codeString: rgb('#0a3069'),
    codeComment: rgb('#57606a'),
    codeNumber: rgb('#0550ae'),
    codeFunction: rgb('#8250df'),
  },
};

/** 显式档 → 内置板（auto 档的裁定归探测件，不经本函数） */
export function builtinPalette(setting: 'dark' | 'light'): BuiltinPalette {
  return setting === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}
