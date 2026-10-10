/**
 * 主题语义键面（07 §4.1 引擎节件 3 R2——批 10g）。
 *
 * 着色纪律语义化：色**值**不再散落组件常量，改经语义键间接引用（板级切换
 * 非键级）；accent 仍是焦点指示专属键、正文不混用律不变（R2 改裁原句
 * 「accent 无用户配置面」废止）。
 *
 * 键面清单（11 核心键批 10g 定值 + 高亮键族五键批 10h 定值——07 §4.1 R2
 * 「清单随落码批定值回填注记」兑现位；自定义主题文件形随 /themes 命令批
 * 落码——custom 件承载）：
 * - `accent` 焦点指示（输入件提示符 / 任务行转轮〔V-3 笔1 状态行退役——转轮
 *   现唯任务行 task-status-line 件消费〕/ overlay 占焦族 / 弹层空态）
 * - `text` 正文（undefined = 终端缺省前景——着色克制：正文恒随终端用户配置）
 * - `secondary` 次文（弱存在感段——工具卡中止态复用本键，专键不设：定稿形
 *   三态无 pending 期、中止卡与次文同档弱存在感〔R2「复用次文键或专键随
 *   10g 定」的 10g 裁〕）
 * - `thinkingText` 思考块文字（10i 消费）
 * - `success` / `error` 工具卡终态 ✓ / ✗（10i 消费）
 * - `diffAdded` / `diffRemoved` 词级 diff 增 / 删（10i 消费）
 * - `quoteText` 引用块行级基础色（R-3 批——markdown blockquote 整行 green
 *   档基础色，行内样式叠加非整行覆盖；codex blockquote green 同构）
 * - `diffAddedBg` / `diffRemovedBg` diff 行级全宽 bg 色带（R-3 批——codex
 *   diff 静态定值键，非 OSC 11 探测混合族）：源值恒 `ExactBgColor` 形——
 *   truecolor rgb 直出 / 256 档 color256 覆写（22 / 52，非最近邻）/ 16 档
 *   undefined 回退纯前景（低档位宁可无带不错色）
 * - `link` 链接（markdown 行内链接——10h 消费；R-3 批迁 cyan 系 + underline
 *   属性位辨链接）
 * - `tableRule` 表格线（GFM 表格框线——10h 消费）
 * - `codeInline` 行内代码（原 ANSI 2 绿中性定值的语义键承接位）
 * - `codeKeyword` / `codeString` / `codeComment` / `codeNumber` / `codeFunction`
 *   高亮键族五键（10h 定值——自研词法器五类 token 各一键；覆盖语言外诚实
 *   退单色不发明半高亮）
 * - `userMessageBg` user 块背景带（界面美化役批⑦ + R2 扩键注——**首个背景
 *   键**）：源值语义与前景键分立——两内置板恒 `undefined`（无静态定值位），
 *   值由 resolve 件在解析期按 OSC 11 探测背景动态混合产出（dark 板白 12%
 *   alpha / light 板黑 4%）；探测失败/缺席、16 档降采、自定义板缺本键 =
 *   无背景回退（不扩 ExactColor 对位表）。旧主题文件无新键非破坏性——缺键
 *   即无背景，新键随更新自然生效。
 * - `toolCardBg` 工具卡卡面背景带（TUI 对标 Codex 五件批 C 件 R2——**第二
 *   背景键**）：机制与降级全律援引 userMessageBg 既有款——两内置板恒
 *   `undefined`（无静态定值位），值由 resolve 件按 OSC 11 探测背景动态混合
 *   产出（dark 板白 8% / light 板黑 3%——比 userMessageBg 弱一档：卡面是
 *   密集块面，同档带与 user 块并置时层级不可辨）；探测缺席、16 档降采、
 *   自定义板缺本键 = 无卡面带（供血同门——探测传值门单源，无独立门）。
 * - `weakRule` 弱存在感线（V-3 注⑨——**首个混合键**）：回合记账分隔线 /
 *   markdown 表格线 / 面板分段线三线族共用的通用弱线色，值由 resolve 件
 *   在解析期按「主题 fg @ 20% alpha 混 OSC 11 探测 bg」动态现算（与
 *   userMessageBg 同走 toDepthValue 降深链）；混合基缺席（内置板 text 恒
 *   undefined / fg 色板位 RGB 不可知）、探测缺席、16 档、亮底对比不足 =
 *   键缺席（消费位回退 tableRule 或 fg+dim 既有形）；与 tableRule 分工不
 *   合并——后者兼回退位与 16 深人工覆写位。旧主题文件缺本键非破坏——
 *   text+userMessageBg 两键齐的自定义板才实质生效（探测传值门统辖动态
 *   键族 bg 供血）。
 */
import type { AnsiColor, Color256, RgbChannels } from '../../engine/index.js';

/**
 * 主题档设置值（settings.json `theme` 键值）：内置三值 dark / light / auto
 * （auto = OSC 11 背景探测裁定）+ **自定义主题名**（/themes 批——07 §4.1
 * 挂账解挂批值域扩名：`数据目录/themes/<名>.json` 文件名即主题名；自定义名
 * 直指文件零探测〔文件选择面〕、键级缺键回退基板的探测恒在〔与文件选择
 * 正交〕）。`(string & {})` 形保三内置值的字面量补全。
 */
export type ThemeSetting = 'dark' | 'light' | 'auto' | (string & {});

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
  'quoteText',
  'diffAddedBg',
  'diffRemovedBg',
  'link',
  'tableRule',
  'codeInline',
  'codeKeyword',
  'codeString',
  'codeComment',
  'codeNumber',
  'codeFunction',
  'userMessageBg',
  'toolCardBg',
  'weakRule',
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
 * 背景精确对位形（R-3 批——diff bg 双键专用载体）：`rgb` truecolor 直出、
 * `color256` 256 档**直通覆写位**（非最近邻——diff 色带落点人工定值）、16 档
 * **合法 undefined**（回退纯前景律——diff 增删前景色 16 档本就在册，低档位
 * 宁可无带不错色）。与 ExactColor 分立的判据：后者 ansi16 必填（前景塌缩
 * 修正形——16 档必有对位），本形 16 档缺席是设计语义而非回退。
 */
export interface ExactBgColor {
  readonly rgb: RgbChannels;
  readonly color256: Color256;
}

/**
 * 语义色板（键 → 源色值）。源值五形：
 * - `RgbChannels` 自带色值——随终端色域档降采（truecolor 直出 / 256→16 降采）；
 * - `AnsiColor` 终端色板位（0-15）——**全档直通不降采**（尊重终端用户自定义
 *   色板——dark accent 沿 ANSI 6 cyan 的载体形）；
 * - `Color256` xterm 256 索引（16-255）——truecolor/256 档直通（38;5;n 两档
 *   同受支持）、16 档展开回真彩走最近邻单源降采（/themes 批——自定义主题
 *   文件「色值收 truecolor RGB 与 256 索引两形」条款；运行时与 AnsiColor 同
 *   为 number，按值域 0-15 / 16-255 分档——engine color 件 isAnsi16 律）；
 * - `ExactColor` 精确对位——rgb 主值两档照常、16 档覆写位（塌缩修正形）；
 * - `ExactBgColor` 背景精确对位（R-3 批——diff bg 双键专用）——truecolor rgb
 *   直出 / 256 color256 直通 / 16 档 undefined 回退；
 * - `undefined` 终端缺省（`text` 专用——正文恒随终端前景配置）。
 */
export type SemanticPalette = Readonly<
  Record<SemanticKey, RgbChannels | AnsiColor | Color256 | ExactColor | ExactBgColor | undefined>
>;

/**
 * 部分覆盖色板（自定义主题文件的键级覆盖载体——/themes 批）：文件只须覆盖
 * 关心的键，**缺键回退基板同位键**（回退合成在消费位展开：`{...基板, ...覆盖}`
 * ——undefined 值不进覆盖表，防展开时压掉基板键）。
 */
export type PartialSemanticPalette = Partial<SemanticPalette>;
