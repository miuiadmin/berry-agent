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
 *   （值等价换引，呈现零变化）；transcript 孤儿简行与 webui frames 状态/
 *   终结行三位已同批收编走 TOOL_RUN_MARK（2026-10-04 收编批 7ecdb0e——
 *   待办句随收编落地勘正删）。
 * - **溢出指示统一律（美学注②）**：「↑/↓ N 更多」中文形全域单形。
 * - **光标符统一律（美学注③→V-3 注⑩ 翻档）**：› 全域单形（▸/❯ 时代符形
 *   退役）——picker 族、overlay 弹层（popup / select-confirm）、editor 输入
 *   提示符与 transcript user 块前缀皆引本件 CURSOR_MARK 单源（boot 动画
 *   装载行同字形语境分立——零依赖纯文本件，不引本件）。
 */
import { TOOL_RUN_MARK } from '../../../contracts/index.js';
import type { CellStyle } from '../../engine/index.js';
import { DIM_STYLE } from '../../engine/index.js';
import { fitRowSegments } from '../row-segments.js';
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

/** picker 族溢出指示视口收敛产出形（fitIndicatorViewport 返回——消费位按 cap 实占 + on 判边行在立） */
export interface IndicatorViewportFit {
  /** 收敛后视口首行（光标恒在收窄窗内——预留行不遮在选行） */
  readonly offset: number;
  /** 条目实占行数（扣除上/下边行预留——条目+边行实占恰满视口，零行外溢） */
  readonly cap: number;
  /** 边行在立判据（视口 ≥3 行且溢出——矮窗/不足视口零边行原窗直排） */
  readonly on: boolean;
}

/**
 * picker 族溢出指示视口收敛（39 池 P4 件收编单源）：溢出时视口上/下各让一行
 * 给 dim 边行「↑/↓ N 更多」（moreHint 单源词面）；预留翻转可能把光标挤出
 * 收窄窗——逐轮重夹取收敛（预留位随 offset 变动重算，三轮封顶防振荡）。
 * 消费位约定：先经全窗 clampOffset（maxOffset 上界），再入本段；返回 offset
 * 回写调用方视口位（render 内收敛——与 clampOffset 同一 offset 账）。
 * 谱系：界面美化役 2026-10-01 美学批在 theme-picker 首创（「三行预留收窄窗」
 * ——溢出时视口让一行给边行），rewind/model picker 同构复写；本段将其提为
 * 共享段（stepCursorWrap 收编同谱——件间不一致封堵），offset/cursor/count
 * 三参同一行空间即可（model picker 组头展开行空间同适）。
 */
export function fitIndicatorViewport(
  viewHeight: number,
  offset: number,
  cursor: number,
  count: number,
): IndicatorViewportFit {
  const on = viewHeight >= 3 && count > viewHeight;
  let off = offset;
  let cap = viewHeight;
  for (let round = 0; round < 3; round++) {
    const topReserve = on && off > 0;
    const afterTop = viewHeight - (topReserve ? 1 : 0);
    const bottomReserve = on && count - off - afterTop > 0;
    cap = afterTop - (bottomReserve ? 1 : 0);
    // 光标恒在收窄窗内（越窗提窗/压窗——预留翻转后再收敛，三轮封顶）
    if (cursor < off) {
      off = cursor;
      continue;
    }
    if (cursor >= off + cap) {
      off = cursor - cap + 1;
      continue;
    }
    break;
  }
  return { offset: off, cap, on };
}

/**
 * picker 族光标步进单源（挖掘 35 轮 B6——codex scroll_state 单步环绕/翻页
 * 夹取分立律 berry 化）：|delta|=1 **环绕**（顶行 ↑ 绕底、底行 ↓ 绕顶——长
 * 清单肌肉记忆闭环，到头不必回按反向）；大步（翻页 PgUp/PgDn/滚轮 ±3/
 * 端跳）仍**夹取**（codex 原文注释「Page movement intentionally does not
 * wrap」——大步环绕是迷路不是导航）。七件 picker 族 moveCursor 收编换引；
 * viewer 族（memory/skills）与向导/弹层不随迁（阅读模型与表单模型分立，
 * 保留首末停驻夹取形）。
 */
export function stepCursorWrap(cursor: number, delta: number, count: number): number {
  if (count <= 0) return 0; // 空表守卫（调用方另有 length>0 门——内置防御位）
  if (delta === 1) return (cursor + 1) % count;
  if (delta === -1) return (cursor - 1 + count) % count;
  return Math.max(0, Math.min(count - 1, cursor + delta)); // 大步夹取
}

/**
 * 副屏头行样式（accent 派生——美学注④头行层级律：头行 accent 着色、分段头
 * dim、正文随档）。主题经各面板可选注入位传入（缺省 DEFAULT_THEME 系测试
 * 装配形——主会话装配位已接线〔tui-backend theme: this.theme〕，真值随
 * /themes 换装）。
 */
export function headStyleOf(theme: ResolvedTheme): Readonly<CellStyle> {
  return Object.freeze({ fg: theme.accent });
}

/**
 * 在选行整行样式（2026-10-12 Codex 样式复刻批 R-9——07 §4.1 全域观感注③
 * 光标符统一律 R-9 扩档）：全屏 picker/viewer 族光标行整行 accent bold，›
 * 光标符保留（光标导航位与选中强调两账分立——弹层位 R-6 弃符、全屏族保符）；
 * 语义色段（diff ±N 计数/词级着色/色样带）不参与覆写——语义色优先于装饰律。
 * select-confirm R-6 弹层位同律（其自铸 activeStyle 由本单源收编换引）。
 */
export function activeRowStyleOf(theme: ResolvedTheme): Readonly<CellStyle> {
  return Object.freeze({ fg: theme.accent, bold: true });
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

/** 读数窄窗退场地板（挖掘 31 轮 [5]）：行宽低于此值读数让位——键面提示独占 */
const SCROLL_PERCENT_FLOOR_WIDTH = 24;

/**
 * viewer 底行渲染单源（挖掘 31 轮 [5]——codex pager 底铬读数 berry 化）：
 * 键面提示段（fitRowSegments 左段 … 收口）+ 溢出时右对齐 dim 滚动位置读数
 * `NN%`（同行右对齐省一行——不取 codex 独立 dim ─ 分隔线形：底行键面提示
 * 铬已在场〔07 §4.4 律三载体〕，第二条装饰线只挤视口）。排版走
 * fitRowSegments 单源（右段预算 + 左段帽——负起列结构性封堵继承）；窄于
 * 地板读数退场（提示行是不可省铬）。与 picker「↑/↓ N 更多」分职：彼 =
 * 离散条目清单隐藏计数（还有多少未见——行动信息）；此 = 连续滚动视口
 * 位置快读锚点（现在看到哪）。两形语域分立不互替不混用（溢出指示统一律
 * 批注记——非静默第二指示形）。
 */
export function renderViewerHintBar(
  buffer: import('../../engine/index.js').CellBuffer,
  region: import('../../engine/index.js').Region,
  text: string,
  scrollPercent: number | null,
): void {
  const right = scrollPercent !== null && region.width >= SCROLL_PERCENT_FLOOR_WIDTH ? `${scrollPercent}%` : undefined;
  const fit = fitRowSegments(text, right, region.width);
  buffer.writeText(region.row + region.height - 1, region.col, fit.left, DIM_STYLE);
  if (fit.rightWidth > 0) {
    buffer.writeText(region.row + region.height - 1, region.col + region.width - fit.rightWidth, fit.right, DIM_STYLE);
  }
}
