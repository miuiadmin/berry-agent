/**
 * 主屏 inline 形态编舞件（07 §4.1「屏幕模型双形态」主屏条——批 10e）。
 *
 * 物理形态（与副屏全屏网格分立、共用 cell/diff/width 基座——07 篇定形）：
 * - **DECSTBM 滚动区**承载正文（顶行到固定区上方）：区底写满自动滚、
 *   滚出视口整行交终端原生 scrollback（历史真相在 durable 事件日志，行集
 *   是帽内最近段的内存上限语义）；
 * - **固定区钉屏底**（区外行不被滚动卷入、绝对位可知）：输入框 + 状态行，
 *   行级差分重画（变行整行重写、未变行零写出——擦除只走 EL 禁空格填充）；
 * - **正文块直写**：块 → 行序列化 → 追加写（追加不回改——直播路「消息事件
 *   唯一渲染源」的物理形）；流式槽原位换装是视口内唯一差分。序列化单源走
 *   renderBlockLines（批 10f-4 提取——件 8 回看器全量档复用同一渲染管线，
 *   零第二渲染器）。
 *
 * 编舞状态模型：**绝对行跟踪**。件内维护光标绝对行 cursorRow 与 durable
 * 末行 durableEndRow（= 下一条追加的落笔行 = 流式槽首行），每次写行经
 * writeLine 单点维护（区底 LF 触滚钉区底——滚动量不外显）；present 尾光标
 * 归固定区末行行首（呈现不变式——编舞内相对定位全由此出发；固定区自身用
 * 绝对 CUP，钉屏底位可知）。
 *
 * v1 已知边界：流式槽 partial 回缩（新行数少于旧）按余行 EL 清——inline
 * 终端无删行机制；固定区高度变化时光标账按区底钳制（内容可能被固定区
 * 覆盖——装配宜随高度变化触发 repaint 重建）。
 */
import { CellGrid, type TerminalIO } from '../../engine/index.js';
import { CLEAR_SCREEN, CR, cud, cuu, EL_TO_EOL, LF, renderFixedRegionDiff, setScrollRegion, cup } from './ansi-rows.js';
import { renderBlockLines, type TranscriptBlock } from './transcript.js';

/** 主屏选项 */
export interface MainScreenOptions {
  /** 固定区高（行——输入框 + 状态行；随内容折行动态变化经 setFixed 更新） */
  readonly fixedHeight: number;
}

/** 缺省几何（真值以 io.size() 为准——resize 路装配调 handleResize） */
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/**
 * 主屏编舞：正文直写 + 槽换装 + 固定区差分。无自驱时钟（请求合并归装配），
 * 所有公开方法同步产写出（测试经 MemoryTerminalIO 收帧断言）。
 */
export class MainScreen {
  private readonly io: TerminalIO;
  private columns = DEFAULT_COLUMNS;
  private rows = DEFAULT_ROWS;
  private fixedHeight: number;
  /** 已直写 durable 块数（增量追加起点——repaint 归零全量重写） */
  private writtenBlocks = 0;
  /** 光标绝对行（0 基——写行/定位单点维护） */
  private cursorRow = 0;
  /** durable 末行（追加落笔行 = 槽首行；滚动时钉区底） */
  private durableEndRow = 0;
  /** 当前槽直写行数（余行清除上界依据） */
  private slotLineCount = 0;
  /** 固定区网格（装配画好交入——null = 固定区未装配只归位光标） */
  private fixedGrid: CellGrid | null = null;
  /** 固定区上次呈现网格（行级差分基准；null = 全量重画） */
  private prevFixed: CellGrid | null = null;

  constructor(io: TerminalIO, options: MainScreenOptions) {
    this.io = io;
    this.fixedHeight = options.fixedHeight;
    const size = io.size();
    this.columns = size.columns;
    this.rows = size.rows;
  }

  /** 几何观测（装配层 resize 编舞消费） */
  get geometry(): { columns: number; rows: number } {
    return { columns: this.columns, rows: this.rows };
  }

  /** 启动编舞：清屏 + 滚动区确立 + 光标归位（呈现不变式自洽） */
  start(): void {
    this.io.write(CLEAR_SCREEN);
    this.applyScrollRegion();
  }

  /**
   * 增量呈现（追加块直写 → 槽换装 → 余行清除 → 固定区差分）。
   * 前置：光标在固定区末行行首（start / setFixed / 上次 present 归位）。
   */
  present(blocks: readonly TranscriptBlock[]): void {
    // 末块为 streaming 时即流式槽（const 绑定经 kind 判别收窄）
    const last = blocks.length > 0 ? blocks[blocks.length - 1]! : null;
    const slot = last !== null && last.kind === 'streaming' ? last : null;
    const durableCount = slot === null ? blocks.length : blocks.length - 1;
    // 余行清除上界：上次呈现的槽末行（= durable 末 + 槽行数 - 1——本帧前的账）
    const prevBottomRow = Math.min(this.rows - this.fixedHeight - 1, this.durableEndRow + this.slotLineCount - 1);

    // 光标归 durable 末（B/C 共同起点——无新增块时 C 段也从这里起笔）
    this.gotoRow(this.durableEndRow);

    // B. 追加块直写（每行 CR 起笔 + LF 推进，区底触滚交 scrollback）
    if (durableCount > this.writtenBlocks) {
      for (let i = this.writtenBlocks; i < durableCount; i++) {
        this.writeBlockLines(blocks[i]!);
      }
      this.writtenBlocks = durableCount;
      this.durableEndRow = this.cursorRow;
    }

    // C. 槽换装（光标已在槽首 = durable 末；partial 是完整快照——逐行整写）
    const slotLines = slot === null ? [] : this.renderSlotLines(slot);
    for (const line of slotLines) {
      this.writeLine(line);
    }

    // D. 余行清除（新槽末到上次槽末之间的 stale 行——EL 擦除禁空格填充）
    const fixedTop = this.rows - this.fixedHeight;
    const clearEnd = Math.min(fixedTop - 1, prevBottomRow);
    for (let row = this.cursorRow; row <= clearEnd; row++) {
      this.io.write((row > this.cursorRow ? cud(1) : '') + CR + EL_TO_EOL);
    }

    // E. 固定区差分重画 + 光标归位（呈现不变式）
    this.redrawFixed();
    this.slotLineCount = slotLines.length;
  }

  /**
   * 瞬时行直写（非聚焦摘要行 / notify 通知行——不进行集不记 writtenBlocks，
   * repaint 不重建）。编舞同追加块：归 durable 末 → 写行 → 余行清除 → 归位。
   * 行内容由调用方（TuiBackend）序列化——本件纯编舞不做着色决策。
   */
  appendTransient(lines: readonly string[]): void {
    if (lines.length === 0) return;
    this.gotoRow(this.durableEndRow);
    for (const line of lines) {
      this.writeLine(line);
    }
    this.durableEndRow = this.cursorRow;
    const fixedTop = this.rows - this.fixedHeight;
    const clearEnd = Math.min(fixedTop - 1, this.durableEndRow + this.slotLineCount - 1);
    for (let row = this.cursorRow; row <= clearEnd; row++) {
      this.io.write((row > this.cursorRow ? cud(1) : '') + CR + EL_TO_EOL);
    }
    this.redrawFixed();
  }

  /** 固定区网格更新（装配直呼——行级差分；几何变化时滚动区重设 + 差分基准失效） */
  setFixed(grid: CellGrid): void {
    if (grid.rows !== this.fixedHeight) {
      this.fixedHeight = grid.rows;
      this.applyScrollRegion();
      this.prevFixed = null; // 高度变化——差分基准失效全量重画；durable 末行按区底钳
      this.durableEndRow = Math.min(this.durableEndRow, this.rows - this.fixedHeight - 1);
      this.slotLineCount = 0;
    }
    this.fixedGrid = grid;
    this.redrawFixed();
  }

  /** repaint（焦点切换）：清屏 + 行集全量重写（投影即真相——scrollback 旧内容不参与） */
  repaint(blocks: readonly TranscriptBlock[]): void {
    this.writtenBlocks = 0;
    this.slotLineCount = 0;
    this.durableEndRow = 0;
    this.io.write(CLEAR_SCREEN);
    this.applyScrollRegion();
    this.present(blocks);
  }

  /** resize 编舞：几何重取 + 滚动区重设 + 全量重画（弃旧换新——宽字符 reflow 必失真） */
  handleResize(blocks: readonly TranscriptBlock[]): void {
    const size = this.io.size();
    this.columns = size.columns;
    this.rows = size.rows;
    this.repaint(blocks);
  }

  /* ---------------- 内部编舞 ---------------- */

  /** 滚动区确立/重设（DECSTBM 规范行为是光标归 home——随后显式归位呈现不变式位） */
  private applyScrollRegion(): void {
    const bottom = Math.max(1, this.rows - this.fixedHeight);
    this.io.write(setScrollRegion(bottom));
    this.io.write(cup(this.rows - 1, 0));
    this.cursorRow = this.rows - 1;
  }

  /** 写一行（CR 起笔 + LF 推进）并维护 cursorRow；区底 LF 触滚——内容整体上移一格、durableEndRow 同步减一（账不漂移） */
  private writeLine(text: string): void {
    this.io.write(CR + text + LF);
    const regionBottom = this.rows - this.fixedHeight - 1;
    if (this.cursorRow < regionBottom) this.cursorRow++;
    else if (this.durableEndRow > 0) this.durableEndRow--; // 触滚：已写内容上移（B 段随后整账重赋、槽写路保持真值）
  }

  /** 光标归行（present 入口光标在固定区末行——CUU 相对定位即可达全屏任意行） */
  private gotoRow(row: number): void {
    const distance = this.cursorRow - row;
    if (distance > 0) this.io.write(cuu(distance));
    else if (distance < 0) this.io.write(cud(-distance));
    this.cursorRow = row;
  }

  /** 固定区差分重画 + 光标落位（编辑光标外显的物理位） */
  private redrawFixed(): void {
    if (this.fixedGrid !== null) {
      const baseRow = this.rows - this.fixedGrid.rows;
      this.io.write(renderFixedRegionDiff(this.prevFixed, this.fixedGrid, baseRow));
      this.prevFixed = this.fixedGrid;
      // 光标声明位落位（EditorView 编辑位经 setCursor 声明）——绝对 CUP 且
      // 行账同步（gotoRow 相对定位数学依赖 cursorRow 真值）；无声明回退
      // 屏底行首（呈现不变式原样）
      const declared = this.fixedGrid.cursor;
      if (declared !== null) {
        const row = Math.min(baseRow + declared.row, this.rows - 1); // 越界声明防御钳屏底
        this.io.write(cup(row, declared.col));
        this.cursorRow = row;
        return;
      }
    }
    this.io.write(cup(this.rows - 1, 0));
    this.cursorRow = this.rows - 1;
  }

  /** 块 → 行序列化直写（序列化单源 renderBlockLines——件 8 回看器复用同一管线，批 10f-4） */
  private writeBlockLines(block: TranscriptBlock): void {
    for (const line of renderBlockLines(block, this.columns)) this.writeLine(line);
  }

  /** 流式槽行（纯文本直推——性能：不走网格不走样式；序列化同源 renderBlockLines） */
  private renderSlotLines(slot: { readonly kind: 'streaming'; readonly text: string }): string[] {
    return renderBlockLines(slot, this.columns);
  }
}
