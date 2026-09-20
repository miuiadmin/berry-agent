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
 * **超视口冻结提交**（批 10h R1——流式 markdown 直推的 append-only 相容
 * 编舞）：槽稳定面前缀溢出可变区时逐行**升格 durable 直写**（写行即交
 * scrollback，物理不可回改——冻结额 = min(溢出量, StreamingMarkdown
 * stableLineCount - 已冻结)；回流/开栏形不稳定止冻于其开行前）；message_end
 * 定稿换装时 B 段跳过已冻结行数（流式 doc 与定稿 doc 同文同宽同行集——
 * 定位差零，冻结行不重写不重复）；槽代次（epoch）变更即冻结账清零；稳定
 * 面前缀收缩（settled 非单调——后到思考翻回 false 形）时冻结账让位重算
 * 收缩、让位行回换装重写域（交错思考标签字数勘正，2026-09-15 挂账解挂批
 * 让位形）。
 *
 * v1 已知边界：流式槽 partial 回缩（新行数少于旧）按余行 EL 清——inline
 * 终端无删行机制；固定区高度变化时光标账按区底钳制（内容可能被固定区
 * 覆盖——装配宜随高度变化触发 repaint 重建）；不稳定尾自身超视口时接受
 * 滚动（尾行样式陈旧不回改——开栏 fence 闭合高亮回翻即此形的代价注记）。
 */
import { CellGrid, type TerminalIO } from '../../engine/index.js';
import { CLEAR_SCREEN, CR, cud, cuu, EL_TO_EOL, LF, renderFixedRegionDiff, setScrollRegion, cup } from './ansi-rows.js';
import { renderBlockLines, stableSlotLineCount, type TranscriptBlock } from './transcript.js';

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
  /**
   * 已直写 durable 绝对块位（批 10k 遗漏修——相对块数改绝对位）：绝对位 =
   * blocksOffset（transcript 历史裁块累计）+ 块下标。trim 卸前缀后相对块数
   * 恒 ≤ 帽值，`durableCount > writtenBlocks` 会误判零新增漏写新块；绝对位
   * 对账在裁块下不漂移。repaint 重置为本帧 blocksOffset（全量重写）。
   */
  private writtenAbsolute = 0;
  /** 光标绝对行（0 基——写行/定位单点维护） */
  private cursorRow = 0;
  /** durable 末行（追加落笔行 = 槽首行；滚动时钉区底） */
  private durableEndRow = 0;
  /** 当前槽直写行数（余行清除上界依据） */
  private slotLineCount = 0;
  /** 当前槽已冻结升格 durable 的行数（epoch 变更清零 + 稳定面收缩让位重算——槽同一性与前缀稳定性双账） */
  private frozenSlotLines = 0;
  /** 在场槽代次（null = 无槽——epoch 判据） */
  private slotEpoch: number | null = null;
  /** 本帧槽写出字节数（冻结 + 换装两段合计——字节帽判据观测面） */
  private slotFrameBytes = 0;
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
   * 增量呈现（追加块直写 → 稳定面冻结 → 槽换装 → 余行清除 → 固定区差分）。
   * 前置：光标在固定区末行行首（start / setFixed / 上次 present 归位）。
   *
   * @param blocks 当前行集（帽内最近段——trim 可卸前缀）
   * @param blocksOffset 行集首块的历史裁块累计（绝对位对账输入——装配层取
   *   transcript.trimmedBlockCount；缺席 0 = 无裁块旧形）
   */
  present(blocks: readonly TranscriptBlock[], blocksOffset = 0): void {
    this.slotFrameBytes = 0;
    // 末块为 streaming 时即流式槽（const 绑定经 kind 判别收窄）
    const last = blocks.length > 0 ? blocks[blocks.length - 1]! : null;
    const slot = last !== null && last.kind === 'streaming' ? last : null;
    // 槽代次变更 = 新槽开账：冻结行数清零（旧槽冻结行已交 scrollback 不回收）
    if (slot !== null && slot.epoch !== this.slotEpoch) {
      this.slotEpoch = slot.epoch;
      this.frozenSlotLines = 0;
    }
    const durableCount = slot === null ? blocks.length : blocks.length - 1;
    // 余行清除上界：上次呈现的槽末行（= durable 末 + 槽行数 - 1——本帧前的账）
    const prevBottomRow = Math.min(this.rows - this.fixedHeight - 1, this.durableEndRow + this.slotLineCount - 1);

    // 光标归 durable 末（B/C 共同起点——无新增块时 C 段也从这里起笔）
    this.gotoRow(this.durableEndRow);

    // B. 追加块直写（每行 CR 起笔 + LF 推进，区底触滚交 scrollback）。槽关帧
    //    （message_end 定稿换装）首块行集与冻结行同源同宽——跳过已冻结行数
    //    （定稿不重写冻结行：append-only 物理律；冻结超额的回缩残行留
    //    scrollback，v1 边界头注）。对账走绝对位（blocksOffset + 块下标——
    //    trim 裁前缀后相对块数失真，见 writtenAbsolute 注）
    const newAbsolute = blocksOffset + durableCount;
    if (newAbsolute > this.writtenAbsolute) {
      let skip = this.frozenSlotLines;
      const start = Math.max(0, this.writtenAbsolute - blocksOffset);
      for (let i = start; i < durableCount; i++) {
        for (const line of renderBlockLines(blocks[i]!, this.columns)) {
          if (skip > 0) {
            skip--;
            continue;
          }
          this.writeLine(line);
        }
      }
      this.writtenAbsolute = newAbsolute;
      this.durableEndRow = this.cursorRow;
    }
    // 槽不在场即冻结账收口（残值防御清——epoch 账只在槽在场期有意义）
    if (slot === null) {
      this.frozenSlotLines = 0;
      this.slotEpoch = null;
    }

    // C. 槽换装（光标已在槽尾段首 = durable 末；partial 是完整快照——逐行整写）
    const slotLines = slot === null ? [] : this.renderSlotLines(slot);
    if (slot !== null) {
      // 让位重算（2026-09-15 挂账解挂批——交错思考标签字数勘正）：稳定面前缀
      // 收缩（settled 非单调：后到思考使已冻思考行变不稳内容；doc 降档同形）
      // 时冻结账为不稳头行让位——收缩到当前稳定面，让位行回换装重写域（新
      // 标签字数帧内重画、终值标签随定稿换装收敛）；durableEndRow 随让位行
      // 回抬同量（首未冻行落笔位上移），负值钳 0——深溢出形让位行已滚出
      // scrollback 物理不可回改，重写自视口顶起笔、新内容顺流出窗（scrollback
      // 留旧行副本是 append-only 物理律的接受代价，非账面失真）
      const stableNow = stableSlotLineCount(slot, this.columns);
      if (stableNow < this.frozenSlotLines) {
        this.durableEndRow = Math.max(0, this.durableEndRow - (this.frozenSlotLines - stableNow));
        this.frozenSlotLines = stableNow;
      }
      // 稳定面冻结：可视余量外的稳定前缀升格 durable 直写（写行即交
      // scrollback 不可回改——冻结额 = min(溢出量, 稳定行数 - 已冻结)）；
      // 稳定面含思考前缀行（批 10i——thinkingSettled 判据下思考行全稳，
      // stableSlotLineCount 单源；降档 doc = null 走 doc 面 0 + 思考行稳面）
      const regionBottom = this.rows - this.fixedHeight - 1;
      const capacity = regionBottom - this.durableEndRow + 1;
      const overflow = slotLines.length - this.frozenSlotLines - capacity;
      const freezable = stableNow - this.frozenSlotLines;
      const freezeNow = Math.max(0, Math.min(overflow, freezable));
      if (freezeNow > 0) {
        this.gotoRow(this.durableEndRow);
        for (let i = this.frozenSlotLines; i < this.frozenSlotLines + freezeNow; i++) {
          this.writeSlotLine(slotLines[i]!);
        }
        this.frozenSlotLines += freezeNow;
        this.durableEndRow = this.cursorRow;
      }
      // 尾段整写（回流/开栏不稳定尾恒在此重绘；自身超视口时接受滚动）
      this.gotoRow(this.durableEndRow);
      for (let i = this.frozenSlotLines; i < slotLines.length; i++) {
        this.writeSlotLine(slotLines[i]!);
      }
    }

    // D. 余行清除（新槽末到上次槽末之间的 stale 行——EL 擦除禁空格填充）
    const fixedTop = this.rows - this.fixedHeight;
    const clearEnd = Math.min(fixedTop - 1, prevBottomRow);
    for (let row = this.cursorRow; row <= clearEnd; row++) {
      this.io.write((row > this.cursorRow ? cud(1) : '') + CR + EL_TO_EOL);
    }

    // E. 固定区差分重画 + 光标归位（呈现不变式）
    this.redrawFixed();
    this.slotLineCount = slot === null ? 0 : Math.max(0, slotLines.length - this.frozenSlotLines);
  }

  /** 本帧槽写出字节数（冻结 + 换装合计——装配层字节帽判据） */
  get lastSlotFrameBytes(): number {
    return this.slotFrameBytes;
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

  /**
   * repaint（焦点切换）：清屏 + 行集全量重写（投影即真相——scrollback 旧内容
   * 不参与）。绝对位账重置为本帧 blocksOffset（全量重写后账尾 = 行集末块）。
   */
  repaint(blocks: readonly TranscriptBlock[], blocksOffset = 0): void {
    this.writtenAbsolute = blocksOffset;
    this.slotLineCount = 0;
    this.frozenSlotLines = 0;
    this.slotEpoch = null;
    this.durableEndRow = 0;
    this.prevFixed = null; // 差分基准随清屏失效（2026-09-17 收官批）：清屏抹掉屏上固定区而模型 grid 不变——基准不失效则同值 diff 零写出、屏恒空白（tmux e2e 抓获启动抹屏形：会话注册即 repaint 空 transcript + 调用方 renderFixed 同值 grid 再 diff；resize 同高度形同洞）
    this.io.write(CLEAR_SCREEN);
    this.applyScrollRegion();
    this.present(blocks, blocksOffset);
  }

  /** resize 编舞：几何重取 + 滚动区重设 + 全量重画（弃旧换新——宽字符 reflow 必失真） */
  handleResize(blocks: readonly TranscriptBlock[], blocksOffset = 0): void {
    const size = this.io.size();
    this.columns = size.columns;
    this.rows = size.rows;
    this.repaint(blocks, blocksOffset);
  }

  /* ---------------- 内部编舞 ---------------- */

  /** 滚动区确立/重设（DECSTBM 规范行为是光标归 home——随后显式归位呈现不变式位） */
  private applyScrollRegion(): void {
    const bottom = Math.max(1, this.rows - this.fixedHeight);
    this.io.write(setScrollRegion(bottom));
    this.io.write(cup(this.rows - 1, 0));
    this.cursorRow = this.rows - 1;
  }

  /**
   * 写一行（CR 起笔 + LF 推进）并维护 cursorRow；区底 LF 触滚——内容整体上移一格、durableEndRow 同步减一（账不漂移）。
   * 内嵌 LF 拆段逐行写（2026-09-20 TUI 混流修复）：调用方可能传入多行文本
   * 单串（如 notify 多行回执——doors 帮助形），单次 io.write 产 N 个物理行
   * 而账只 +1 即漂账——后续追加块从回执中段起笔覆写正文（tmux 实红在案）。
   * 拆段后物理行账与终端一致；raw 模式 LF 纯行进不回列，每段显式 CR 起笔。
   */
  private writeLine(text: string): void {
    const regionBottom = this.rows - this.fixedHeight - 1;
    for (const line of text.split('\n')) {
      // 控制字节兜底（2026-09-20 TUI 修复组 1 批 F2）：残余 C0/DEL 剥除——
      // CR 落屏即回列覆写正文、其余 C0 终端误解执行；LF 已按段拆分入账、
      // ESC 保留（appendTransient 调用方可携合法 SGR 配色序列——inline 面
      // 落屏末道防线，构造位消毒后实践上恒空转）
      const clean = line.replace(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g, '');
      this.io.write(CR + clean + LF);
      if (this.cursorRow < regionBottom) this.cursorRow++;
      else if (this.durableEndRow > 0) this.durableEndRow--; // 触滚：已写内容上移（B 段随后整账重赋、槽写路保持真值）
    }
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
    // 几何失配守卫（2026-09-17 收官批）：缩窗后、调用方 renderFixed 重建前，
    // fixedGrid 仍是旧几何的陈货（行数可超新屏）——写出即越屏废定位 + 闪烁，
    // 权威截断重建随后由 renderFixed 全量落（onRepaint/handleResize 两路必跟）；
    // toggles 路不跟但恒同几何不可达本守卫。失配即只归位不写
    if (this.fixedGrid !== null && this.fixedGrid.rows > this.rows) {
      this.io.write(cup(this.rows - 1, 0));
      this.cursorRow = this.rows - 1;
      return;
    }
    if (this.fixedGrid !== null) {
      // baseRow 钳 0（畸形几何防御位——段总高 > 行数时固定区越屏顶，负行 cup
      // 是废字节；段优先级截断归装配层，此处只兜不产错位定位）
      const baseRow = Math.max(0, this.rows - this.fixedGrid.rows);
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

  /** 槽行直写（含帧字节计量——冻结段与换装段共用；编舞同 writeLine） */
  private writeSlotLine(text: string): void {
    this.slotFrameBytes += text.length;
    this.writeLine(text);
  }

  /** 流式槽行（markdown 直推档与降档纯文本同源——renderBlockLines 单源；epoch/doc 随块型走） */
  private renderSlotLines(slot: Extract<TranscriptBlock, { kind: 'streaming' }>): string[] {
    return renderBlockLines(slot, this.columns);
  }
}
