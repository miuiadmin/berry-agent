/**
 * 主题语义键面（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * 着色纪律语义化：色**值**不再散落组件常量，改经语义键间接引用（板级切换
 * 非键级）；accent 仍是焦点指示专属键、正文不混用律不变（R2 改裁原句
 * 「accent 无用户配置面」废止）。
 *
 * 键面清单（11 核心键批 10g 定值 + 高亮键族五键批 10h 定值——07 §4.1 R2
 * 「清单随落码批定值回填注记」兑现位；用户自定义主题文件挂账不预造）：
 * - `accent` 焦点指示（输入件边框 / 状态行转轮 / overlay 占焦族 / 弹层空态）
 * - `text` 正文（undefined = 终端缺省前景——着色克制：正文恒随终端用户配置）
 * - `secondary` 次文（弱存在感段——工具卡中止态复用本键，专键不设：定稿形
 *   三态无 pending 期、中止卡与次文同档弱存在感〔R2「复用次文键或专键随
 *   10g 定」的 10g 裁〕）
 * - `thinkingText` 思考块文字（10i 消费）
 * - `success` / `error` 工具卡终态 ✓ / ✖（10i 消费）
 * - `diffAdded` / `diffRemoved` 词级 diff 增 / 删（10i 消费）
 * - `link` 链接（markdown 行内链接——10h 消费）
 * - `tableRule` 表格线（GFM 表格框线——10h 消费）
 * - `codeInline` 行内代码（原 ANSI 2 绿中性定值的语义键承接位）
 * - `codeKeyword` / `codeString` / `codeComment` / `codeNumber` / `codeFunction`
 *   高亮键族五键（10h 定值——自研词法器五类 token 各一键；覆盖语言外诚实
 *   退单色不发明半高亮）
 */
import type { AnsiColor, RgbChannels } from '../../engine/index.js';

/** 主题档设置值（settings.json `theme` 键三值——dark / light / auto；auto = OSC 11 背景探测裁定） */
export type ThemeSetting = 'dark' | 'light' | 'auto';

/** 语义键全集（值面单源——遍历消费只认本表） */
export const SEMANTIC_KEYS = [
  'accent',
  'text',
  'secondary',
  'thinkingText',
  'success',
  'error',
  'diffAdded',
  'diffRemoved',
  'link',
  'tableRule',
  'codeInline',
  'codeKeyword',
  'codeString',
  'codeComment',
  'codeNumber',
  'codeFunction',
] as const;

/** 语义键（SEMANTIC_KEYS 的元素类型） */
export type SemanticKey = (typeof SEMANTIC_KEYS)[number];

/**
 * 精确对位形（批 10k 遗漏修——16 档塌缩修正）：`rgb` 主值照常降采
 * （truecolor 直出 / 256 最近邻），16 档走 `ansi16` 覆写位——最近邻降采在
 * 低饱和蓝灰域系统性塌缩（GitHub 系语法色 dark 板 4/5 键合流 ANSI 7），
 * 五键互离是可辨性硬需求，人工对板位定值（palette 件注记值表）。
 */
export interface ExactColor {
  readonly rgb: RgbChannels;
  readonly ansi16: AnsiColor;
}

/**
 * 语义色板（键 → 源色值）。源值四形：
 * - `RgbChannels` 自带色值——随终端色域档降采（truecolor 直出 / 256→16 降采）；
 * - `AnsiColor` 终端色板位——**全档直通不降采**（尊重终端用户自定义色板——
 *   dark accent 沿 ANSI 6 cyan 的载体形）；
 * - `ExactColor` 精确对位——rgb 主值两档照常、16 档覆写位（塌缩修正形）；
 * - `undefined` 终端缺省（`text` 专用——正文恒随终端前景配置）。
 */
export type SemanticPalette = Readonly<Record<SemanticKey, RgbChannels | AnsiColor | ExactColor | undefined>>;
