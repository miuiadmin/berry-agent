/**
 * 缓冲件（07 篇 §4.1 自研引擎节件 3——批 10b 引擎核心）。
 *
 * cell 网格模型：每格「码点面 + 样式 + 列宽」三元；宽字符续格与主流终端
 * 续格形同构（差分按格直比无需行结构感知）；多码点字素覆写摘痕防新旧混叠；
 * 字素面参与差分自证（同首码点不同字素不得判等——grapheme 存整素串，格直比
 * 即字素比对，结构自证）。帧路径零分配：网格跨帧复用、clear 只摘格、
 * resize 是唯一重分配点。
 */
import type { Cell, CellBuffer, CellStyle, CursorState } from './types.js';
import { graphemeWidth, splitGraphemes } from './width.js';

/** 全缺省样式常量（格的缺省样式——比较归一用，冻结防漂） */
export const EMPTY_STYLE: Readonly<CellStyle> = Object.freeze({});

/** 默认格（未写格的语义投影：缺省空格——cellEquals 归一基准） */
const DEFAULT_CELL: Readonly<Cell> = Object.freeze({
  grapheme: ' ',
  style: EMPTY_STYLE,
  width: 1 as const,
});

/** 样式相等（缺省位归一比较——undefined 与 false 同为缺省） */
export function styleEquals(a: CellStyle, b: CellStyle): boolean {
  return (
    (a.fg ?? null) === (b.fg ?? null) &&
    (a.bg ?? null) === (b.bg ?? null) &&
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.dim === !!b.dim &&
    !!a.inverse === !!b.inverse
  );
}

/**
 * 单格相等（差分按格直比原语）：null 归一到默认空格格后三元比对——
 * 「写入的缺省空格」与「未写格」判等（不产生假变更帧）；
 * 续格（width 0）与空格格判不等（续格是宽字素一部分，占位语义不可丢）。
 */
export function cellEquals(a: Cell | null, b: Cell | null): boolean {
  const na = a ?? DEFAULT_CELL;
  const nb = b ?? DEFAULT_CELL;
  return na.grapheme === nb.grapheme && na.width === nb.width && styleEquals(na.style, nb.style);
}

/**
 * CellGrid——CellBuffer 协议实装（一维数组行主序网格；行 / 列界外静默吸收）。
 *
 * 摘痕算法（setCell 内执法）：覆写区 [col, col+w) 内既有格若属某宽字素
 * （首格或续格），先整字摘除（首格 + 全部续格）再写新字素——防「旧宽字素
 * 右半残留在新字素续格下」的新旧混叠。
 */
export class CellGrid implements CellBuffer {
  public columns: number;
  public rows: number;
  /** 网格（行主序一维；null = 未写格——语义投影为缺省空格） */
  private grid: (Cell | null)[];
  /** 本帧光标声明终值（末次声明为准；clearCursor 置 null） */
  private cursorState: CursorState | null = null;

  constructor(columns = 80, rows = 24) {
    this.columns = columns;
    this.rows = rows;
    this.grid = new Array<Cell | null>(columns * rows).fill(null);
  }

  /** 摘格清屏（网格结构复用零分配——帧间清屏 / 全量重绘入口） */
  clear(): void {
    this.grid.fill(null);
    this.cursorState = null;
  }

  getCell(row: number, col: number): Cell | null {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.columns) return null;
    return this.grid[row * this.columns + col] ?? null; // noUncheckedIndexedAccess 归一
  }

  setCell(row: number, col: number, grapheme: string, style: CellStyle = EMPTY_STYLE): void {
    // 越界写静默吸收（渲染契约「越界写由缓冲吸收」——组件可信任缓冲兜底）
    if (row < 0 || row >= this.rows || col < 0 || col >= this.columns) return;
    const width = graphemeWidth(grapheme);
    if (width === 0) return; // 零宽字素不占格（splitGraphemes 已合流，防御位）
    // 摘痕：覆写区内既有宽字素整字摘除（见类注——防新旧混叠）
    this.eraseWideGraphemes(row, col, width);
    // 写首格 + 续格（宽字素右界越界时续格截断丢弃——缓冲兜底；渲染层
    // truncateToWidth 已保证整字不跨界，此为双保险）
    const base = row * this.columns;
    this.grid[base + col] = { grapheme, style, width: width as 1 | 2 };
    if (width === 2 && col + 1 < this.columns) {
      this.grid[base + col + 1] = { grapheme: '', style, width: 0 };
    }
  }

  writeText(row: number, col: number, text: string, style?: CellStyle): number {
    let cursor = col;
    for (const g of splitGraphemes(text)) {
      this.setCell(row, cursor, g, style);
      cursor += graphemeWidth(g);
    }
    return cursor;
  }

  setCursor(row: number, col: number): void {
    this.cursorState = { row, col, visible: true };
  }

  clearCursor(): void {
    this.cursorState = null;
  }

  get cursor(): CursorState | null {
    return this.cursorState;
  }

  /**
   * 几何变更（唯一重分配点）：网格整体弃置重分配、内容不搬运——
   * 「resize 弃旧换新（不做原地搬运——宽字符 reflow 后必失真）」的缓冲侧
   * 承接，清屏 + 全量重绘兜底归引擎编排件（批 10c）。
   */
  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.grid = new Array<Cell | null>(columns * rows).fill(null);
    this.cursorState = null;
  }

  /**
   * 摘痕原语：把 [col, col+span) 区间（含右邻溢出格——被覆字素可能右探一格）
   * 内牵连的既有宽字素整字摘除。逐格查：续格回溯首格、首格顺摘续格。
   */
  private eraseWideGraphemes(row: number, col: number, span: number): void {
    const base = row * this.columns;
    for (let i = col; i <= Math.min(col + span, this.columns - 1); i++) {
      const cell = this.grid[base + i];
      if (!cell) continue;
      if (cell.width === 0) {
        // 续格：回溯其首格并整字摘除
        let head = i - 1;
        while (head >= 0) {
          const probe = this.grid[base + head];
          if (probe && probe.width !== 0) break;
          head--;
        }
        if (head >= 0 && this.grid[base + head]?.width === 2) {
          this.grid[base + head] = null;
          // 顺摘首格右侧全部续格（可能多格？——续格恰一格，但防御性扫到非续格止）
          let tail = head + 1;
          while (tail < this.columns && this.grid[base + tail]?.width === 0) {
            this.grid[base + tail] = null;
            tail++;
          }
        }
        this.grid[base + i] = null;
      } else if (cell.width === 2) {
        // 首格：摘自己 + 右侧续格
        this.grid[base + i] = null;
        if (i + 1 < this.columns && this.grid[base + i + 1]?.width === 0) {
          this.grid[base + i + 1] = null;
        }
      }
    }
  }
}
