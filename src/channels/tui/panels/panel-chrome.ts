/**
 * 副屏面板铬件单源（界面美化役 2026-10-01——07 §4.1 美学注②③④定形面）：
 * 头行图标词汇 / 头行样式派生 / 溢出指示文案 / 分段头判词——四族呈现常量
 * 从各面板散拷收编为单源（picker 族与 viewer 族共同消费位；overlay 与
 * editor 亦消费——channels/tui 域内共享，不上升 ui-core〔那是通道编排层，
 * 高度不符〕）。
 *
 * - **图标词汇收敛律（美学注④）**：副屏头行图标收敛为两符——◆ 选择器族
 *   （enter 选定/回填语义）/ ◉ 查看族（滚动阅读语义）；emoji 类宽度不稳符
 *   （❓ 等）弃用；⚙ 保留工具执行语义（工具卡/状态行——本件不出）。
 * - **溢出指示统一律（美学注②）**：「↑/↓ N 更多」中文形全域单形。
 * - **光标符统一律（美学注③）**：▸ 全域单形——picker 族既有常量的单源化
 *   承接位（overlay 弹层 ❯ 随迁各件自理，本件只立词汇）。
 */
import type { CellStyle } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';

/** 选择器族头符（enter 选定/回填语义——theme/model/market/rewind/thinking/sandbox/skills 族） */
export const PICKER_HEAD_MARK = '◆';
/** 查看族头符（滚动阅读语义——help/status/usage/guide/debug/memory 族） */
export const VIEWER_HEAD_MARK = '◉';
/** 光标行标记（在选行——picker 族既有词汇单源承接；overlay 弹层随迁对齐） */
export const CURSOR_MARK = '▸';

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
 * 分段头判词（ScrollView dim 档 predicate——美学注④分段头 dim 律）：`── … ──`
 * 分段线与 `· …` 域标签（键位册域分组形）两形命中；命中行整行 dim 呈现。
 */
export function isSectionHeadLine(line: string): boolean {
  return line.startsWith('──') || line.startsWith('· ');
}

/** 告警行判词（debug 坏值 ⚠ 族——dim 恒可读不加色，rewind WARN_STYLE 同律） */
export function isWarningLine(line: string): boolean {
  return line.startsWith('⚠');
}
