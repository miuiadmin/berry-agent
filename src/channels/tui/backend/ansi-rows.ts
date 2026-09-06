/**
 * 主屏 inline 形态 ANSI 编舞基件（07 §4.1「屏幕模型双形态」主屏条——批 10e）。
 *
 * 主屏物理形态：DECSTBM 滚动区承载正文（区底写满自动滚——滚出视口整行交
 * 终端原生 scrollback），固定区（输入框 + 状态行）钉屏底区外、绝对位可知。
 * 本件提供四组原语：
 * - 网格行 → ANSI 序列化（cell 样式 + 字素——与 diff 件行写出同语义：续格
 *   跳过、语义空格字面、行尾不填充）；
 * - 网格行 → 带样式行（StyleRun 段族——批 10f-4 件 8 回看器 cell 写出形的
 *   数据源；带样式行 → ANSI 序列化同件在位，主屏直写与回看器零第二渲染器）；
 * - 定位序列（绝对 CUP / 相对 CUU·CUD / CR / EL）与光标保存恢复；
 * - 行级差分（固定区重画——变行重写、未变行零写出，行粒度复用 cellEquals）。
 */
import { cellEquals, EMPTY_STYLE, styleEquals, type CellGrid, type CellStyle } from '../../engine/index.js';

/** ESC 前缀 */
const ESC = '\x1b';

/**
 * 样式段（批 10f-4 件 8 回看器——带样式行的呈现词汇）：逻辑行内同样式连续
 * 区间，端点 = plain 文本的 UTF-16 下标（start 含 / end 不含）。段间空隙 =
 * 裸文本（无样式），段升序不交叠由构造方（gridRowToStyled / 各块序列化）保证。
 */
export interface StyleRun {
  readonly start: number;
  readonly end: number;
  readonly style: CellStyle;
}

/**
 * 带样式行：plain 纯文本供折叠宽算术 / 搜索消费（零转义零样式混入）；
 * runs 供 cell 网格呈现消费。主屏 ANSI 直写形（gridRowToAnsi / 简行 dim）
 * 与件 8 回看器 cell 写出形共用同一数据源——零第二渲染器（07 件 8 数据源
 * 条款的结构位）。
 */
export interface StyledLine {
  readonly plain: string;
  readonly runs: readonly StyleRun[];
}

/** 缺省样式判据：styleEquals 对 EMPTY_STYLE 单源（CellStyle 增字段自动同步——
 * 勿手工罗列字段判缺省，10f-4 核验轮勘正） */
function isDefaultStyle(style: CellStyle): boolean {
  return styleEquals(style, EMPTY_STYLE);
}
/** SGR 全复位 */
export const SGR_RESET = `${ESC}[0m`;
/** EL 0：自光标至行尾 */
export const EL_TO_EOL = `${ESC}[K`;
/** 回行首（列 0——不滚行） */
export const CR = '\r';
/** 换行（滚动区内：区底自动滚、区外/中部只下移） */
export const LF = '\n';
/** 光标保存 / 恢复（DECSC/DECRC——编舞对（擦写远端区）后还原位） */
export const SAVE_CURSOR = `${ESC}7`;
export const RESTORE_CURSOR = `${ESC}8`;
/** 清全屏 + 光标归位（repaint 路） */
export const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
/** 设滚动区 DECSTBM（1 基行号——底部固定区留区外） */
export function setScrollRegion(bottomRow1Based: number): string {
  return `${ESC}[1;${bottomRow1Based}r`;
}
/** 绝对定位（0 基入参——固定区专用：区外钉屏底、绝对位可知） */
export function cup(row: number, col: number): string {
  return `${ESC}[${row + 1};${col + 1}H`;
}
/** 相对上移 n 行（CUU——滚动区内槽位重画定位；边缘安全不滚） */
export function cuu(n: number): string {
  return n > 0 ? `${ESC}[${n}A` : '';
}
/** 相对下移 n 行（CUD——边缘安全不滚） */
export function cud(n: number): string {
  return n > 0 ? `${ESC}[${n}B` : '';
}

/** 样式 → SGR（与 diff 件 buildSgr 同语义：属性位 + 16 色前景背景全量形；简行块直拼消费） */
export function buildSgr(style: {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  fg?: number;
  bg?: number;
}): string {
  const params: string[] = [];
  if (style.bold) params.push('1');
  if (style.dim) params.push('2');
  if (style.italic) params.push('3');
  if (style.underline) params.push('4');
  if (style.inverse) params.push('7');
  if (style.fg !== undefined) params.push(String(style.fg < 8 ? 30 + style.fg : 82 + style.fg));
  if (style.bg !== undefined) params.push(String(style.bg < 8 ? 40 + style.bg : 92 + style.bg));
  return params.length > 0 ? `${ESC}[${params.join(';')}m` : '';
}

/**
 * 网格行 → ANSI 文本（无内容返回空串——调用方据此跳过写出）。
 * 行尾变空白不产 EL（直写正文行是追加语义、行尾从无旧残留——EL 归擦区编舞）。
 */
export function gridRowToAnsi(grid: CellGrid, row: number): string {
  // 内容末列 = 最右非空格格（续格属首格字素占位、算内容延伸）
  let last = -1;
  for (let col = grid.columns - 1; col >= 0; col--) {
    if (!cellEquals(grid.getCell(row, col), null)) {
      last = col;
      break;
    }
  }
  if (last < 0) return '';
  let out = '';
  // 当前样式序列（'' = 裸文本态；同样式零冗余、变化点复位再设——与 diff 件同纪律）
  let currentSgr = '';
  for (let col = 0; col <= last; col++) {
    const cell = grid.getCell(row, col);
    if (cell !== null && cell.width === 0) continue; // 续格跳过
    if (cell === null) {
      out += ' '; // 语义空格（行中内容洞）字面写
      continue;
    }
    const sgr = buildSgr(cell.style);
    if (sgr !== currentSgr) {
      out += (currentSgr !== '' ? SGR_RESET : '') + sgr;
      currentSgr = sgr;
    }
    out += cell.grapheme;
  }
  if (currentSgr !== '') out += SGR_RESET; // 行尾归零——不染后续写出
  return out;
}

/**
 * 网格行 → 带样式行（批 10f-4 件 8——回看器 cell 写出形的数据源）。
 * 行走序与 gridRowToAnsi 同构（末列内容界 + 续格跳过 + 空洞空格），相邻同样式
 * 格合并为单段；缺省样式段不产段（与空隙同形——序列化零冗余的基础）。
 * 无内容行返回 null（调用方按需补空行——与 gridRowToAnsi 空串约定同构）。
 */
export function gridRowToStyled(grid: CellGrid, row: number): StyledLine | null {
  // 内容末列 = 最右非空格格（续格属首格字素占位、算内容延伸）
  let last = -1;
  for (let col = grid.columns - 1; col >= 0; col--) {
    if (!cellEquals(grid.getCell(row, col), null)) {
      last = col;
      break;
    }
  }
  if (last < 0) return null;
  let plain = '';
  const runs: StyleRun[] = [];
  for (let col = 0; col <= last; col++) {
    const cell = grid.getCell(row, col);
    if (cell !== null && cell.width === 0) continue; // 续格跳过（首格已携整字素）
    const grapheme = cell === null ? ' ' : cell.grapheme; // 语义空格（行中内容洞）
    const style = cell === null ? EMPTY_STYLE : cell.style;
    const start = plain.length;
    plain += grapheme; // 全字素入 plain（缺省样式字素是空隙文本——不丢字）
    if (isDefaultStyle(style)) continue; // 缺省段不产段（gap 即裸文本）
    // 同样式紧邻续段合并（段端点连续才并——中间有缺省格即断开）
    const prev = runs[runs.length - 1];
    if (prev !== undefined && styleEquals(prev.style, style) && prev.end === start) {
      runs[runs.length - 1] = { start: prev.start, end: start + grapheme.length, style };
    } else {
      runs.push({ start, end: start + grapheme.length, style });
    }
  }
  return { plain, runs };
}

/**
 * 带样式行 → ANSI 串（主屏直写形——与 gridRowToAnsi 同语义的行序列化：
 * 样式变化点复位再设、同样式零冗余、行尾归零不染后续写出）。
 * renderBlockLines 经本函数从带样式行导出 ANSI 形——两形零第二渲染器。
 */
export function styledLineToAnsi(line: StyledLine): string {
  const { plain, runs } = line;
  if (runs.length === 0) return plain;
  let out = '';
  let currentSgr = '';
  let pos = 0;
  for (const run of runs) {
    if (run.start > pos) {
      // 段前空隙：在身样式先归零再写裸文本
      if (currentSgr !== '') {
        out += SGR_RESET;
        currentSgr = '';
      }
      out += plain.slice(pos, run.start);
    }
    const sgr = buildSgr(run.style);
    if (sgr !== currentSgr) {
      out += (currentSgr !== '' ? SGR_RESET : '') + sgr;
      currentSgr = sgr;
    }
    out += plain.slice(run.start, run.end);
    pos = run.end;
  }
  if (pos < plain.length) {
    // 段尾空隙：归零后写裸文本
    if (currentSgr !== '') {
      out += SGR_RESET;
      currentSgr = '';
    }
    out += plain.slice(pos);
  }
  if (currentSgr !== '') out += SGR_RESET;
  return out;
}

/**
 * 固定区行级差分（行粒度——变行整行重写、未变行零写出）。
 * 返回 ANSI 串（含定位与行尾 EL——擦除只走 EL 禁空格填充）；行位以
 * baseRow 屏偏移绝对定位（固定区钉屏底、区外位可知）。
 */
export function renderFixedRegionDiff(from: CellGrid | null, to: CellGrid, baseRow: number): string {
  let out = '';
  for (let row = 0; row < to.rows; row++) {
    if (from !== null && row < from.rows && gridRowEquals(from, to, row)) continue; // 未变行零写出
    const text = gridRowToAnsi(to, row);
    // 定位行首 → 复位 →（有内容写内容）→ 无条件 EL（行尾残留擦除——与 diff 件同律）
    out += cup(baseRow + row, 0) + SGR_RESET + (text !== '' ? text + SGR_RESET : '') + EL_TO_EOL;
  }
  return out;
}

/** 行相等判定（逐格 cellEquals 直比） */
function gridRowEquals(a: CellGrid, b: CellGrid, row: number): boolean {
  for (let col = 0; col < b.columns; col++) {
    if (!cellEquals(a.getCell(row, col), b.getCell(row, col))) return false;
  }
  return true;
}
