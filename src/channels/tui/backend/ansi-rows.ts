/**
 * 主屏 inline 形态 ANSI 编舞基件（07 §4.1「屏幕模型双形态」主屏条——批 10e）。
 *
 * 主屏物理形态：DECSTBM 滚动区承载正文（区底写满自动滚——滚出视口整行交
 * 终端原生 scrollback），固定区（输入框 + 状态行）钉屏底区外、绝对位可知。
 * 本件提供三组原语：
 * - 网格行 → ANSI 序列化（cell 样式 + 字素——与 diff 件行写出同语义：续格
 *   跳过、语义空格字面、行尾不填充）；
 * - 定位序列（绝对 CUP / 相对 CUU·CUD / CR / EL）与光标保存恢复；
 * - 行级差分（固定区重画——变行重写、未变行零写出，行粒度复用 cellEquals）。
 */
import { cellEquals, type CellGrid } from '../../engine/index.js';

/** ESC 前缀 */
const ESC = '\x1b';
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
