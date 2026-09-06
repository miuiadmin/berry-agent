/**
 * 行级差分件（07 篇 §4.1 自研引擎节件 3——批 10b 引擎核心）。
 *
 * 帧差分增量写出纪律：
 * - 无变更帧零写出、未变行零写出（行粒度比较——cellEquals 逐格直比）；
 * - 行尾变空白一律 EL 清行**禁空格填充**（空格填充闪烁史反课——擦除只走
 *   EL，永不写空格游程）；
 * - EL 前置样式复位（BCE 语义——EL 以当前背景色擦除，带背景样式发 EL 会
 *   把擦除区染上底色污染行尾，故先 SGR 复位再 EL）；
 * - 帧尾光标统一落位（定位 + 显 / 隐），显隐态跨帧去重——同态零冗余序列；
 *   **双零（内容与光标均零变更）才整帧零写出**。
 *
 * 纯函数：from / to 两帧只读比对产 ANSI 字节串；帧管线（请求合并 / 帧率帽）
 * 归引擎编排件（批 10c）。前置条件：两帧同几何——resize 路径编排侧清屏全量
 * 重绘不走本函数，几何不同即编程错、fail-loud。
 */
import { cellEquals, EMPTY_STYLE, styleEquals } from './cell.js';
import type { CellBuffer, CellStyle } from './types.js';

const ESC = '\x1b';
/** 光标定位（1 基转义序列——row/col 为 0 基入参） */
const cup = (row: number, col: number): string => `${ESC}[${row + 1};${col + 1}H`;
const EL_TO_EOL = `${ESC}[K`; // EL 0：自光标至行尾
const SGR_RESET = `${ESC}[0m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

/** 样式 → SGR 序列（全量形——属性位 + 16 色前景背景；空样式返回空串由调用方复位） */
function buildSgr(style: CellStyle): string {
  const params: string[] = [];
  if (style.bold) params.push('1');
  if (style.dim) params.push('2');
  if (style.italic) params.push('3');
  if (style.underline) params.push('4');
  if (style.inverse) params.push('7');
  if (style.fg !== undefined) {
    // 前景 16 色：0-7 标准位 30+n / 8-15 亮位 90+(n-8)
    params.push(String(style.fg < 8 ? 30 + style.fg : 82 + style.fg));
  }
  if (style.bg !== undefined) {
    // 背景 16 色：0-7 标准位 40+n / 8-15 亮位 100+(n-8)
    params.push(String(style.bg < 8 ? 40 + style.bg : 92 + style.bg));
  }
  return params.length > 0 ? `${ESC}[${params.join(';')}m` : '';
}

/** 单帧行级差分：返回本帧应写出的 ANSI 字节串（零变更返回空串） */
export function renderFrameDiff(from: CellBuffer, to: CellBuffer): string {
  if (from.columns !== to.columns || from.rows !== to.rows) {
    // 几何不同是编程错（resize 路径编排侧清屏全量重绘）——fail-loud 不产半帧
    throw new Error(
      `renderFrameDiff: 两帧几何不同（${from.columns}x${from.rows} vs ${to.columns}x${to.rows}）——resize 路径不走帧差分`,
    );
  }
  let out = '';
  /** 帧首光标抑制是否已发（有写出才发——防写内容过程光标跳；幂等只发一次） */
  let cursorSuppressed = false;
  const suppress = () => {
    if (!cursorSuppressed) {
      out += HIDE_CURSOR;
      cursorSuppressed = true;
    }
  };

  for (let row = 0; row < to.rows; row++) {
    if (rowEquals(from, to, row)) continue; // 未变行零写出
    suppress();
    out += renderRowDiff(from, to, row);
  }

  // 帧尾光标统一落位（显隐跨帧去重——同态零冗余序列）
  out += renderCursorDiff(from, to, cursorSuppressed);
  return out;
}

/** 行相等判定（逐格 cellEquals 直比——null 归一语义在 cellEquals 内） */
function rowEquals(from: CellBuffer, to: CellBuffer, row: number): boolean {
  for (let col = 0; col < to.columns; col++) {
    if (!cellEquals(from.getCell(row, col), to.getCell(row, col))) return false;
  }
  return true;
}

/** 单变行差分：定位 + 写内容 + 行尾残留 EL（禁空格填充——擦除只走 EL） */
function renderRowDiff(from: CellBuffer, to: CellBuffer, row: number): string {
  let out = '';
  // 内容末列 = 最右语义非空格格（无样式空格与未写格语义等价、不算内容）；
  // 续格（width 0）属首格字素占位、算内容延伸
  let lastContentCol = -1;
  for (let col = to.columns - 1; col >= 0; col--) {
    if (!cellEquals(to.getCell(row, col), null)) {
      lastContentCol = col;
      break;
    }
  }

  if (lastContentCol < 0) {
    // 新帧整行空：定位行首 + 样式复位 + EL 清行（旧帧有残留才到得了本分支）
    return cup(row, 0) + SGR_RESET + EL_TO_EOL;
  }

  // 定位行首并复位样式（跨行样式残留归零——确定态起写）
  out += cup(row, 0) + SGR_RESET;
  let currentStyle: CellStyle = EMPTY_STYLE;
  for (let col = 0; col <= lastContentCol; col++) {
    const cell = to.getCell(row, col);
    if (cell !== null && cell.width === 0) continue; // 续格跳过——首格字素已携双宽
    const style = cell?.style ?? EMPTY_STYLE;
    if (!styleEquals(currentStyle, style)) {
      // 样式变更点：先复位再全量设（差量 SGR 优化不预造——闪烁面留给组件批实证）
      out += SGR_RESET + buildSgr(style);
      currentStyle = style;
    }
    out += cell === null ? ' ' : cell.grapheme; // 语义空格（行中内容洞）写字面空格
  }

  // 行尾残留：旧帧在内容末之后还有语义非空格格 → 复位 + EL（BCE：复位后擦除
  // 才不染背景色）。内容写满至行尾列则无擦除空间、天然无残留可清。
  for (let col = lastContentCol + 1; col < to.columns; col++) {
    if (!cellEquals(from.getCell(row, col), null)) {
      out += SGR_RESET + EL_TO_EOL;
      break;
    }
  }
  return out;
}

/** 帧尾光标落位（跨帧同态去重——值全等即零序列） */
function renderCursorDiff(from: CellBuffer, to: CellBuffer, cursorSuppressed: boolean): string {
  const fromCursor = from.cursor;
  const toCursor = to.cursor;
  // 同态（含双 null / 值全等）零冗余序列——「显隐态跨帧去重」执法位
  if (fromCursor === null && toCursor === null) return '';
  if (fromCursor !== null && toCursor !== null && cursorSame(fromCursor, toCursor)) {
    // 内容有写出且帧首已抑制光标、声明仍显 → 恢复显示在原位（抑制的反向配对）
    if (cursorSuppressed) return SHOW_CURSOR + cup(toCursor.row, toCursor.col);
    return '';
  }
  if (toCursor === null) return HIDE_CURSOR; // 显 → 隐
  // 隐 → 显 / 位置迁移：显 + 定位（SHOW 幂等——重复发无害；帧首抑制已发则仍显式定位）
  return SHOW_CURSOR + cup(toCursor.row, toCursor.col);
}

/** 光标声明值相等（row / col / visible 三元） */
function cursorSame(
  a: { row: number; col: number; visible: boolean },
  b: { row: number; col: number; visible: boolean },
): boolean {
  return a.row === b.row && a.col === b.col && a.visible === b.visible;
}
