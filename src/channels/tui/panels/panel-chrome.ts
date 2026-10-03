/**
 * 副屏面板铬件单源（界面美化役 2026-10-01——07 §4.1 美学注②③④定形面）：
 * 头行图标词汇 / 头行样式派生 / 溢出指示文案 / 分段头判词——四族呈现常量
 * 从各面板散拷收编为单源（picker 族与 viewer 族共同消费位；overlay 与
 * editor 亦消费——channels/tui 域内共享，不上升 ui-core〔那是通道编排层，
 * 高度不符〕）。
 *
 * - **图标词汇收敛律（美学注④）**：副屏头行图标收敛为两符——◆ 选择器族
 *   （enter 选定/回填语义）/ ◉ 查看族（滚动阅读语义）；emoji 类宽度不稳符
 *   （❓ 等）弃用；⚙ 工具执行语义（工具卡/状态行）经 HEAD_MARKS.tool 位
 *   入册（值委派 contracts TOOL_RUN_MARK 单源——webui SPA 同源）——
 *   setup-wizard 面板头与 task-status-line 态① 工具段已收编消费
 *   （值等价换引，呈现零变化）；transcript 孤儿简行已改走 TOOL_RUN_MARK
 *   （2026-10-04 收编批），webui 帧族随其域批次收编。
 * - **溢出指示统一律（美学注②）**：「↑/↓ N 更多」中文形全域单形。
 * - **光标符统一律（美学注③→V-3 注⑩ 翻档）**：› 全域单形（▸/❯ 时代符形
 *   退役）——picker 族、overlay 弹层（popup / select-confirm）、editor 输入
 *   提示符与 transcript user 块前缀皆引本件 CURSOR_MARK 单源（boot 动画
 *   装载行同字形语境分立——零依赖纯文本件，不引本件）。
 */
import { TOOL_RUN_MARK } from '../../../contracts/index.js';
import type { CellStyle } from '../../engine/index.js';
import { DIM_STYLE } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';

/**
 * 副屏头符表（V-3 注⑩ 符号册——头符动物园收敛单源）：值位七符定值，散拷
 * 消费位（± ↩ ⇄ ⏳ ⚙ 各面板字面量）统一走本表；选型翻档只改一处。
 */
export const HEAD_MARKS = Object.freeze({
  /** 选择器族（enter 选定/回填语义——theme/model/market/rewind/thinking/sandbox/skills 族） */
  picker: '◆',
  /** 查看族（滚动阅读语义——help/status/usage/guide/debug/memory 族） */
  viewer: '◉',
  /** diff 改动总览 */
  diff: '±',
  /** 历史回看 */
  history: '↩',
  /** 会话切换 */
  session: '⇄',
  /** 忙等/装载中 */
  busy: '⏳',
  /** 工具/配置执行语义（⚙ 归工具卡语义族——美学注④；值委派 contracts 单源 TOOL_RUN_MARK） */
  tool: TOOL_RUN_MARK,
} as const);

/** 选择器族头符（HEAD_MARKS 派生位——既有出口保名承接） */
export const PICKER_HEAD_MARK = HEAD_MARKS.picker;
/** 查看族头符（HEAD_MARKS 派生位——既有出口保名承接） */
export const VIEWER_HEAD_MARK = HEAD_MARKS.viewer;
/**
 * 光标行标记（在选行——注⑩ 符号册 › 输入与选中位）：picker 族与 overlay
 * 弹层、job-panel/setup-wizard/session-picker/diff-viewer 全域单形（▸ 时代
 * 符形退役——美学注③ 光标符统一律的注⑩ 翻档）。
 */
export const CURSOR_MARK = '›';

/**
 * 溢出指示行文案（美学注②——「↑/↓ N 更多」中文形全域统一）：窗上/下方
 * 隐藏条目数的 dim 边行/指示段统一词面（select-confirm 与编辑器滚动指示、
 * picker 长清单滚动位置指示三族共用——英文 more 形废止）。
 */
export function moreHint(arrow: '↑' | '↓', count: number): string {
  return `${arrow} ${count} 更多`;
}

/**
 * 副屏头行样式（accent 派生——美学注④头行层级律：头行 accent 着色、分段头
 * dim、正文随档）。主题经各面板可选注入位传入（缺省 DEFAULT_THEME——装配
 * 位接线前呈现不缺色，真值随 /themes 换装）。
 */
export function headStyleOf(theme: ResolvedTheme): Readonly<CellStyle> {
  return Object.freeze({ fg: theme.accent });
}

/**
 * 分段头判词（ScrollView 行样式档 predicate——美学注④分段头弱律 + V-3 注⑨
 * 取色链）：`── … ──` 分段线与 `· …` 域标签（键位册域分组形）两形命中；命中
 * 行整行弱线色呈现（weakRule 在场）或 dim 回退（键缺席）。
 */
export function isSectionHeadLine(line: string): boolean {
  return line.startsWith('──') || line.startsWith('· ');
}

/** 告警行判词（debug 坏值 ⚠ 族——dim 恒可读不加色，rewind WARN_STYLE 同律） */
export function isWarningLine(line: string): boolean {
  return line.startsWith('⚠');
}

/** 弱线回退样式（键缺席消费位——dim 恒可读；注⑩：值位 = engine DIM_STYLE 单源 alias） */
const WEAK_FALLBACK_STYLE: Readonly<CellStyle> = DIM_STYLE;

/**
 * 弱线样式（V-3 注⑨①——weakRule 在场整行弱线色 / 键缺席回退 dim 既有形）：
 * 副屏分段头的 ScrollView lineStyle 主形。
 */
export function weakLineStyle(theme: ResolvedTheme): (line: string) => Readonly<CellStyle> | undefined {
  return theme.weakRule !== undefined
    ? (line) => (isSectionHeadLine(line) ? { fg: theme.weakRule } : undefined)
    : (line) => (isSectionHeadLine(line) ? WEAK_FALLBACK_STYLE : undefined);
}

/**
 * 分段头样式（V-3 注⑨①⑤——分诊形）：分段线走弱线取色链（weakLineStyle 同
 * 律）；⚠ 警示行**恒 dim 不混合**（警示语义优先于装饰弱线——语义色不参与
 * 混合，防弱线色淹没告警）。debug 副屏（分段线 + 告警两族并存）专用。
 */
export function sectionHeadLineStyle(theme: ResolvedTheme): (line: string) => Readonly<CellStyle> | undefined {
  const weak = weakLineStyle(theme);
  return (line) => (isWarningLine(line) ? WEAK_FALLBACK_STYLE : weak(line));
}
