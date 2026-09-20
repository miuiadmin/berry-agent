/**
 * 多行输入件视图（Editor 件族渲染件）：边框 + 视口滚动 + 光标声明。
 *
 * 渲染职责（07 §4.1 引擎节件 6（组件与呈现装配件））：
 * - 边框两态——聚焦 accent 高亮 / 非聚焦普通（theme 定值单源）；
 * - 长行字素硬折的视觉行视口——光标恒可视（渲染时滚动夹取）；
 * - 滚动指示 ↑n / ↓n 直接写入边框（有溢出才显）；
 * - IME 预编辑段以下划线样式呈现于光标处（不并入正文——正文归模型提交路）；
 * - 聚焦时本帧光标声明（宽字素首列——显示列算术保证不落半字）。
 */
import type { CellBuffer, Region, Renderable } from '../../engine/index.js';
import { graphemeWidth, splitGraphemes } from '../../engine/index.js';
import { prefixDisplayWidth } from './visual-lines.js';
import type { EditorModel } from './editor-model.js';
import { presentedLineCount } from './height-cap.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import type { CellStyle } from '../../engine/index.js';

/** 边框字符（制表符单宽——写格按字素推进） */
const BORDER_TOP_LEFT = '┌';
const BORDER_TOP_RIGHT = '┐';
const BORDER_BOTTOM_LEFT = '└';
const BORDER_BOTTOM_RIGHT = '┘';
const BORDER_H = '─';
const BORDER_V = '│';

/** 最大可视行数缺省（装配层按终端高 30% 注入覆盖——pi 同形 max(5, rows*0.3)） */
const DEFAULT_MAX_VISIBLE_LINES = 8;

/**
 * 编辑器视图：模型只读消费 + 自持视口偏移；measure / render 双段协商。
 */
export class EditorView implements Renderable {
  private focused = false;
  /** 视口首行（视觉行下标——render 时对光标夹取自愈） */
  private scrollOffset = 0;
  /** 最大可视行数（resize 随动可变——批 10k 遗漏修：装配层按新几何 setMaxVisibleLines） */
  private maxVisibleLines: number;
  /** 上次呈现行数（迟滞带决策输入——R3 批 10j） */
  private lastShownLines = 0;
  /** 聚焦态边框样式（accent 派生——主题单源，setTheme 整体重建） */
  private focusedBorder: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent });

  constructor(
    private readonly model: EditorModel,
    options: { maxVisibleLines?: number } = {},
  ) {
    this.maxVisibleLines = Math.max(1, options.maxVisibleLines ?? DEFAULT_MAX_VISIBLE_LINES);
  }

  /** 帽随几何重设（批 10k 遗漏修——同值早退不重置迟滞带账） */
  setMaxVisibleLines(cap: number): void {
    const next = Math.max(1, cap);
    if (next === this.maxVisibleLines) return;
    this.maxVisibleLines = next;
  }

  /** 主题换装（OSC 11 probe 裁定后 backend 注入——accent 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.focusedBorder = Object.freeze({ fg: theme.accent });
  }

  /** 聚焦态切换（事件路由裁决后由组件调用） */
  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  /**
   * 量高：边框 2 + 呈现行数（迟滞带——R3 批 10j：增长即时夹帽、恰降 1 行
   * 保持上次防抖、降 2 行才缩；量高即分配承诺——不超卖）。
   */
  measure(width: number): number {
    this.model.setLayoutWidth(innerWidth(width));
    const count = this.model.visualLines().length;
    const shown = presentedLineCount(count, this.maxVisibleLines, this.lastShownLines);
    this.lastShownLines = shown;
    return 2 + shown;
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
    const style = this.focused ? this.focusedBorder : undefined;
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
    // 滚动指示（有溢出才显——R3 批 10j ` ↑ N more ` 居中形；窄框放不下回退紧凑形）
    const above = this.scrollOffset;
    const below = totalLines - this.scrollOffset - (region.height - 2);
    if (above > 0) this.writeIndicator(buffer, region.row, region.col, region.width, above, '↑', style);
    if (below > 0) this.writeIndicator(buffer, lastRow, region.col, region.width, below, '↓', style);
  }

  /**
   * 滚动指示写入（R3 批 10j——` ↑ N more ` 形居中覆盖边框横格，两侧横边
   * 自然延续成 `─── ↑ N more ──` 视觉；指示文本宽超内容区 = 窄框回退
   * 右端紧凑 ` ↑N` 形——不劈角不溢出）。
   */
  private writeIndicator(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    count: number,
    arrow: '↑' | '↓',
    style?: CellStyle,
  ): void {
    const innerW = width - 2;
    const full = ` ${arrow} ${count} more `;
    if (full.length <= innerW) {
      const start = col + 1 + Math.floor((innerW - full.length) / 2);
      buffer.writeText(row, start, full, style);
      return;
    }
    const compact = ` ${arrow}${count}`;
    buffer.writeText(row, col + width - 1 - compact.length, compact, style); // 紧凑回退（右端——旧形）
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
    const innerW = innerWidth(region.width);
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
        // 组字三段钳内容区右界：预编辑不计入模型折行宽，三段合成宽（段宽 +
        // 预编辑宽）可超 innerW——越界部分按右界整字截断（宽字素放不下整字
        // 放弃，与引擎 truncateToWidth 同律），右边框列恒不被组字字素覆写、
        // 行尾内容不被推出屏外。截断是组字期临时呈现取舍：提交 / 取消后
        // 正文并入 / 还原，按模型折行自愈全量呈现
        const rightEdge = region.col + 1 + innerW; // 越界位 = 最后内容格 + 1
        const next = writeTextClamped(buffer, row, region.col + 1, prefix, rightEdge);
        const afterPreedit = writeTextClamped(buffer, row, next, preedit, rightEdge, PREEDIT_STYLE);
        writeTextClamped(buffer, row, afterPreedit, suffix, rightEdge);
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
    let col = region.col + 1 + displayCol;
    if (preedit !== null) {
      // 组字期光标在预编辑段尾：预编辑宽计入后可越内容区右界（三段呈现右界
      // 截断的算术镜像）——钳到最后内容格，不压右边框列、不越网格右界
      // （setCursor 不查界，越界列由发射层直写终端——视图层守门）
      const preeditCols = prefixDisplayWidth(preedit, preedit.length);
      col = Math.min(col + preeditCols, region.col + region.width - 2);
    }
    buffer.setCursor(region.row + 1 + (cursorVL - this.scrollOffset), col);
  }
}

/** 预编辑段样式（下划线——组字中的挂起提示） */
const PREEDIT_STYLE: Readonly<CellStyle> = Object.freeze({ underline: true });

/**
 * 右界钳制写入（组字三段呈现专用）：从 col 起写 text，字素累计越过
 * rightEdge（绝对列，不含）即整字截断——宽字素放不下整字放弃不产半字
 * （与引擎 truncateToWidth 同律）。控制字素不占格亦不计宽（与
 * CellGrid.writeText 跳过律同步——宽度账与落格账一致，返回值可续写）。
 * 返回下一可用列（= 实写末格右邻；全截断时原样返回 col）。
 */
function writeTextClamped(
  buffer: CellBuffer,
  row: number,
  col: number,
  text: string,
  rightEdge: number,
  style?: CellStyle,
): number {
  let take = ''; // 可写前缀（按字素累宽拼接）
  let used = 0; // 可写前缀显示宽
  for (const g of splitGraphemes(text)) {
    const code = g.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue; // 控制字素：writeText 同律跳过——宽度账同步不计
    const w = graphemeWidth(g);
    if (col + used + w > rightEdge) break; // 右界整字截断（宽字素不劈半）
    take += g;
    used += w;
  }
  buffer.writeText(row, col, take, style);
  return col + used;
}

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
