/**
 * 内置双主题色板（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * dark / light 两套（用户自定义 JSON 主题文件挂账不预造——承「配置面不
 * 预造」律）。取值基调：GitHub Primer 明暗两系的低饱和工程色——三档降采
 * 后仍可辨（256 cube 量化级距 > 阈值）、16 色最近邻落点集中（accent 例外
 * ——终端色板位直通，见 semantic 件注）。
 */
import { ansiColor, colorRgb, rgbChannels } from '../../engine/index.js';
import type { ExactColor, SemanticPalette } from './semantic.js';

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
 * 精确对位简写（批 10k 遗漏修 + 七役扫描批扩面）：rgb 主值 + 16 档覆写位。
 * 最近邻降采在低饱和蓝灰域系统性塌缩——高亮五键族（dark 板 4/5 键合流
 * ANSI 7）与非高亮同域塌缩键（七役扫描批：dark 板 link/codeInline → 7、
 * tableRule → 0 黑零对比）照收。覆写值按「同键两板同色相族 + 互离 + 可见」
 * 人工定值：高亮五键 dark 9/6/8/12/13、light 1/4/8/12/5；非高亮三键
 * dark codeInline→2（复绿承批 10g 前 CODE_COLOR=ANSI 2）/tableRule→8（暗灰
 * 暗底可见）/link→12（亮蓝与前景互离）、light link→4（最近邻落 6 青亮底
 * 对比不足——10g accent 同由 6 改 4 的判据同源）。
 */
function exact(hex: string, ansi16: number): ExactColor {
  return { rgb: rgbChannels(colorRgb(hex)), ansi16: ansiColor(ansi16) };
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
    // 非高亮塌缩键三键 16 档覆写（七役扫描批 A1——最近邻塌缩：link/codeInline
    // 合流 7 亮灰、tableRule 落 0 黑暗底零对比）；thinkingText 维持最近邻
    // （#94a3b8→7 亮灰：italic 属性位已可辨，不占覆写位——规范笔定裁）
    link: exact('#58a6ff', 12),
    tableRule: exact('#30363d', 8),
    codeInline: exact('#7ee787', 2),
    // 高亮键族（GitHub dark 语法色系——keyword 红 / string 浅蓝 / comment 灰
    // / number 蓝青 / function 紫；五键 256 降采落点互离、16 档走精确对位覆写
    // 互离——最近邻在低饱和蓝灰域塌缩，见 exact 简写注）
    codeKeyword: exact('#ff7b72', 9),
    codeString: exact('#a5d6ff', 6),
    codeComment: exact('#8b949e', 8),
    codeNumber: exact('#79c0ff', 12),
    codeFunction: exact('#d2a8ff', 13),
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
    // 非高亮塌缩键对位（七役扫描批 A1）：link 最近邻落 6 青——亮底对比不足，
    // 覆写 4 蓝（亮底经典强调位，与 dark 12 亮蓝同蓝族两板互离）；tableRule
    // 最近邻恰落 7 亮灰（亮底表格线弱存在感正合真彩源 #d0d7de 意图）、
    // codeInline 恰落 2（与 dark 覆写位 2 同绿族）——两键最近邻已正，保留
    link: exact('#0969da', 4),
    tableRule: rgb('#d0d7de'),
    codeInline: rgb('#116329'),
    // 高亮键族（GitHub light 语法色系——与 dark 对位同键同语义；16 档走精确
    // 对位覆写 1/4/8/12/5——同色相族对板互离，见 exact 简写注）
    codeKeyword: exact('#cf222e', 1),
    codeString: exact('#0a3069', 4),
    codeComment: exact('#57606a', 8),
    codeNumber: exact('#0550ae', 12),
    codeFunction: exact('#8250df', 5),
  },
};

/** 显式档 → 内置板（auto 档的裁定归探测件，不经本函数） */
export function builtinPalette(setting: 'dark' | 'light'): BuiltinPalette {
  return setting === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}
