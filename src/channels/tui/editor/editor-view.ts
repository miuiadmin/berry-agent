/**
 * 多行输入件视图（Editor 件族渲染件）：边框 + 视口滚动 + 光标声明。
 *
 * 渲染职责（07 §4.1 呈现面件 6）：
 * - 边框两态——聚焦 accent 高亮 / 非聚焦普通（theme 定值单源）；
 * - 长行字素硬折的视觉行视口——光标恒可视（渲染时滚动夹取）；
 * - 滚动指示 ↑n / ↓n 直接写入边框（有溢出才显）；
 * - IME 预编辑段以下划线样式呈现于光标处（不并入正文——正文归模型提交路）；
 * - 聚焦时本帧光标声明（宽字素首列——显示列算术保证不落半字）。
 */
import type { CellBuffer, Region, Renderable } from '../../engine/index.js';
import { prefixDisplayWidth } from './visual-lines.js';
import type { EditorModel } from './editor-model.js';
import { ACCENT_INDEX } from '../theme.js';
import { ansiColor, type CellStyle } from '../../engine/index.js';

/** 边框字符（制表符单宽——写格按字素推进） */
const BORDER_TOP_LEFT = '┌';
const BORDER_TOP_RIGHT = '┐';
const BORDER_BOTTOM_LEFT = '└';
const BORDER_BOTTOM_RIGHT = '┘';
const BORDER_H = '─';
const BORDER_V = '│';

/** 聚焦态边框样式（accent 定值——theme 单源） */
const FOCUSED_BORDER: Readonly<CellStyle> = Object.freeze({ fg: ansiColor(ACCENT_INDEX) });

/** 最大可视行数缺省（装配层按终端高 30% 注入覆盖——pi 同形 max(5, rows*0.3)） */
const DEFAULT_MAX_VISIBLE_LINES = 8;

/**
 * 编辑器视图：模型只读消费 + 自持视口偏移；measure / render 双段协商。
 */
export class EditorView implements Renderable {
  private focused = false;
  /** 视口首行（视觉行下标——render 时对光标夹取自愈） */
  private scrollOffset = 0;
  private readonly maxVisibleLines: number;

  constructor(
    private readonly model: EditorModel,
    options: { maxVisibleLines?: number } = {},
  ) {
    this.maxVisibleLines = Math.max(1, options.maxVisibleLines ?? DEFAULT_MAX_VISIBLE_LINES);
  }

  /** 聚焦态切换（事件路由裁决后由组件调用） */
  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  /** 量高：边框 2 + 视觉行数夹 maxVisibleLines（量高即分配承诺——不超卖） */
  measure(width: number): number {
    this.model.setLayoutWidth(innerWidth(width));
    const count = this.model.visualLines().length;
    return 2 + Math.min(count, this.maxVisibleLines);
  }

  /** 落位渲染：边框 → 视口行 → 预编辑段 → 光标声明 */
  render(buffer: CellBuffer, region: Region): void {
    const innerW = innerWidth(region.width);
    const innerH = region.height - 2;
    this.model.setLayoutWidth(innerW);
    if (innerH <= 0 || innerW <= 0) return; // 边框都容不下——防御位

    const map = this.model.visualLines();
    const cursorVL = this.model.currentVisualLine(map);
    // 视口夹取自愈：光标恒可视（滚出上方提顶 / 滚出下方沉底）
    this.scrollOffset = clampScroll(this.scrollOffset, cursorVL, innerH, map.length);

    this.drawBorder(buffer, region, map.length);
    this.drawContent(buffer, region, map, innerH);
    this.drawCursor(buffer, region, map, cursorVL);
  }

  /* ---------------- 边框（含滚动指示） ---------------- */

  private drawBorder(buffer: CellBuffer, region: Region, totalLines: number): void {
    const style = this.focused ? FOCUSED_BORDER : undefined;
    const lastRow = region.row + region.height - 1;
    const lastCol = region.col + region.width - 1;
    // 四角
    buffer.setCell(region.row, region.col, BORDER_TOP_LEFT, style);
    buffer.setCell(region.row, lastCol, BORDER_TOP_RIGHT, style);
    buffer.setCell(lastRow, region.col, BORDER_BOTTOM_LEFT, style);
    buffer.setCell(lastRow, lastCol, BORDER_BOTTOM_RIGHT, style);
    // 横边（顶 / 底）
    for (let c = region.col + 1; c < lastCol; c++) {
      buffer.setCell(region.row, c, BORDER_H, style);
      buffer.setCell(lastRow, c, BORDER_H, style);
    }
    // 竖边（左 / 右）
    for (let r = region.row + 1; r < lastRow; r++) {
      buffer.setCell(r, region.col, BORDER_V, style);
      buffer.setCell(r, lastCol, BORDER_V, style);
    }
    // 滚动指示（有溢出才显——写入边框行右端、覆盖既有横边格）
    const above = this.scrollOffset;
    const below = totalLines - this.scrollOffset - (region.height - 2);
    if (above > 0) this.writeIndicator(buffer, region.row, lastCol, ` ↑${above}`, style);
    if (below > 0) this.writeIndicator(buffer, lastRow, lastCol, ` ↓${below}`, style);
  }

  /** 右端对齐写入指示文本（覆盖边框横格；越界由缓冲吸收） */
  private writeIndicator(buffer: CellBuffer, row: number, lastCol: number, text: string, style?: CellStyle): void {
    buffer.writeText(row, lastCol - text.length, text, style);
  }

  /* ---------------- 正文（视口内视觉行） ---------------- */

  private drawContent(
    buffer: CellBuffer,
    region: Region,
    map: ReturnType<EditorModel['visualLines']>,
    innerH: number,
  ): void {
    const lines = this.model.getLines();
    const preedit = this.model.pendingPreedit;
    const cursor = this.model.getCursor();
    const end = Math.min(map.length, this.scrollOffset + innerH);
    for (let vi = this.scrollOffset; vi < end; vi++) {
      const seg = map[vi]!;
      const row = region.row + 1 + (vi - this.scrollOffset);
      const line = lines[seg.line] ?? '';
      const plain = line.slice(seg.startCol, seg.startCol + seg.length);
      // 光标在本段且组字中：前缀 + 预编辑（下划线）+ 后缀三段呈现
      if (
        preedit !== null &&
        seg.line === cursor.line &&
        cursor.col >= seg.startCol &&
        cursor.col <= seg.startCol + seg.length
      ) {
        const prefix = line.slice(seg.startCol, cursor.col);
        const suffix = line.slice(cursor.col, seg.startCol + seg.length);
        const next = buffer.writeText(row, region.col + 1, prefix);
        const afterPreedit = buffer.writeText(row, next, preedit, PREEDIT_STYLE);
        buffer.writeText(row, afterPreedit, suffix);
        continue;
      }
      buffer.writeText(row, region.col + 1, plain);
    }
  }

  /* ---------------- 光标声明（聚焦态独占） ---------------- */

  private drawCursor(
    buffer: CellBuffer,
    region: Region,
    map: ReturnType<EditorModel['visualLines']>,
    cursorVL: number,
  ): void {
    if (!this.focused) return; // 非聚焦不声明——不抢其他交互件的本帧声明
    const seg = map[cursorVL]!;
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[seg.line] ?? '';
    // 光标段内显示列（前缀宽差——宽字素边界由模型算术保证，落在首列）
    const displayCol = prefixDisplayWidth(line, cursor.col) - prefixDisplayWidth(line, seg.startCol);
    const preedit = this.model.pendingPreedit;
    const preeditCols = preedit !== null ? prefixDisplayWidth(preedit, preedit.length) : 0;
    buffer.setCursor(region.row + 1 + (cursorVL - this.scrollOffset), region.col + 1 + displayCol + preeditCols);
  }
}

/** 预编辑段样式（下划线——组字中的挂起提示） */
const PREEDIT_STYLE: Readonly<CellStyle> = Object.freeze({ underline: true });

/** 内容区宽（左右边框各 1） */
function innerWidth(width: number): number {
  return Math.max(0, width - 2);
}

/** 视口夹取：光标滚出上方提顶、滚出下方沉底；内容短于视口归零 */
function clampScroll(offset: number, cursorVL: number, innerH: number, total: number): number {
  let next = offset;
  if (cursorVL < next) next = cursorVL;
  if (cursorVL >= next + innerH) next = cursorVL - innerH + 1;
  const maxOffset = Math.max(0, total - innerH);
  return Math.min(Math.max(0, next), maxOffset);
}
