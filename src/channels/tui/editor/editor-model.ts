/**
 * 多行输入编辑模型（Editor 件族核心——纯状态机，零渲染依赖）。
 *
 * 07 §4.1 引擎节件 6（组件与呈现装配件） 多行输入件条款的语义载体：字素光标算术（永不落半字）、
 * 词级删除、undo（上限 100）、输入历史（100 帽 + draft 保底）、IME 预编辑
 * 挂起态、垂直移动 sticky 列（显示列制——CJK 双宽对齐）。机制语义承 pi
 * Editor（裁 ⓪ 从零重写：粘贴标记机制不采纳——本仓规范「多行粘贴整段入框
 * 呈现」；视觉列按显示宽非码元差）。
 *
 * 坐标系：cursorCol 为 UTF-16 下标（字符串切片高效），但一切移动 / 删除
 * 原语经 visual-lines 件的字素边界函数——结构上保证光标恒在字素边界。
 */
import {
  buildVisualLineMap,
  colAtDisplayColumn,
  findVisualLineAt,
  nextGraphemeBoundary,
  prefixDisplayWidth,
  prevGraphemeBoundary,
  type VisualSegment,
} from './visual-lines.js';
import { findWordBackward, findWordForward } from './word-nav.js';
import { UndoStack } from './undo-stack.js';

/** 编辑器状态（undo 快照单元——可 structuredClone 的纯数据形） */
export interface EditorState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
}

/** 输入历史帽（07 呈现面件 2 语义：输入历史 100 条） */
export const HISTORY_LIMIT = 100;

/** undo 上限（码面定值——与历史帽同值，规范只钉「有上限」） */
export const UNDO_LIMIT = 100;

/** 文本规范化：CRLF / CR → LF（粘贴与程序设值共用路） */
function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 编辑模型：状态自持、变更方法驱动；onChange 通知（渲染侧组装请求重绘）。
 */
export class EditorModel {
  private state: EditorState = { lines: [''], cursorLine: 0, cursorCol: 0 };
  private readonly undoStack = new UndoStack<EditorState>(UNDO_LIMIT);
  /** undo 合并判据（fish 式）：连续词字符插入合并一单元；空白段、词接空白后各独立成步 */
  private lastAction: 'type-word' | 'type-whitespace' | null = null;
  private readonly history: string[] = [];
  private historyIndex = -1; // -1 = 不在浏览态
  private historyDraft: EditorState | null = null;
  /** 垂直移动 sticky 列（显示列——非垂直移动清空） */
  private preferredVisualCol: number | null = null;
  /** IME 预编辑挂起段（null = 无组字；渲染呈现、不并入正文） */
  private preedit: string | null = null;
  /** 布局宽（视图渲染时回写——垂直导航的折行依据，与渲染同宽） */
  private layoutWidth = 80;

  /** 变更通知（订阅面——由持有方装配） */
  onChange: ((text: string) => void) | null = null;

  /* ---------------- 查询面 ---------------- */

  getText(): string {
    return this.state.lines.join('\n');
  }

  getLines(): string[] {
    return [...this.state.lines];
  }

  getCursor(): { line: number; col: number } {
    return { line: this.state.cursorLine, col: this.state.cursorCol };
  }

  /** IME 预编辑挂起段（渲染面消费） */
  get pendingPreedit(): string | null {
    return this.preedit;
  }

  /** 视觉行映射（视图渲染与视口滚动共用——与模型内部导航同宽同源） */
  visualLines(): VisualSegment[] {
    return buildVisualLineMap(this.state.lines, this.layoutWidth);
  }

  /** 光标所在视觉行下标 */
  currentVisualLine(map: VisualSegment[]): number {
    return findVisualLineAt(map, this.state.cursorLine, this.state.cursorCol);
  }

  /** 光标的视觉列（显示列——含预编辑宽：组字期光标在预编辑段尾） */
  cursorDisplayColumn(): number {
    const line = this.state.lines[this.state.cursorLine] ?? '';
    let cols = prefixDisplayWidth(line, this.state.cursorCol);
    if (this.preedit !== null) cols += prefixDisplayWidth(this.preedit, this.preedit.length);
    return cols;
  }

  /** 布局宽回写（视图渲染时——垂直导航用，须与渲染宽一致） */
  setLayoutWidth(width: number): void {
    this.layoutWidth = Math.max(1, width);
  }

  /* ---------------- 设值与提交 ---------------- */

  /** 整体设值（程序面：清历史浏览 + undo 快照 + 光标归尾） */
  setText(text: string): void {
    this.exitHistoryBrowsing();
    const normalized = normalizeText(text);
    if (this.getText() !== normalized) this.pushUndo();
    this.state = { lines: normalized.split('\n'), cursorLine: 0, cursorCol: 0 };
    const last = this.state.lines[this.state.lines.length - 1] ?? '';
    this.state.cursorLine = this.state.lines.length - 1;
    this.state.cursorCol = last.length;
    this.lastAction = null;
    this.notify();
  }

  /**
   * 提交：取 trim 后全文、全清（状态 / undo / 历史浏览 / 预编辑）返回。
   * 历史入册归调用方（组件层 onSubmit 消费方决定）。
   */
  submit(): string {
    const result = this.getText().trim();
    this.state = { lines: [''], cursorLine: 0, cursorCol: 0 };
    this.undoStack.clear();
    this.lastAction = null;
    this.preedit = null;
    this.preferredVisualCol = null;
    this.exitHistoryBrowsing();
    this.notify();
    return result;
  }

  /* ---------------- 插入路（text 游程 / IME 提交 / 粘贴共用） ---------------- */

  /**
   * 光标处插入文本（可多行——拆行落位、光标落插入段尾）。
   * undo 合并：连续非空白段合并一单元（打字游程）、空白段独立成步。
   */
  insertText(text: string): void {
    if (text === '') return;
    this.exitHistoryBrowsing();
    const isWhitespace = text.trim().length === 0;
    if (isWhitespace || this.lastAction !== 'type-word') this.pushUndo();
    this.lastAction = isWhitespace ? 'type-whitespace' : 'type-word';
    this.insertTextRaw(normalizeText(text));
    this.notify();
  }

  /** 原子插入（无 undo 编排——内部路） */
  private insertTextRaw(text: string): void {
    const inserted = text.split('\n');
    const current = this.state.lines[this.state.cursorLine] ?? '';
    const before = current.slice(0, this.state.cursorCol);
    const after = current.slice(this.state.cursorCol);
    if (inserted.length === 1) {
      this.state.lines[this.state.cursorLine] = before + inserted[0] + after;
      this.setCursorCol(this.state.cursorCol + inserted[0]!.length);
    } else {
      this.state.lines = [
        ...this.state.lines.slice(0, this.state.cursorLine),
        before + inserted[0]!,
        ...inserted.slice(1, -1),
        inserted[inserted.length - 1]! + after,
        ...this.state.lines.slice(this.state.cursorLine + 1),
      ];
      this.state.cursorLine += inserted.length - 1;
      this.setCursorCol(inserted[inserted.length - 1]!.length);
    }
  }

  /**
   * 整 token 代换（补全弹层唯一写路径）：指定行 [start,end) 段整段替换、
   * 光标落代换尾。独立 undo 步（不与前后输入合并）、退出历史浏览、清预编辑
   * 与水平粘滞链。
   */
  replaceToken(line: number, start: number, end: number, replacement: string): void {
    this.exitHistoryBrowsing();
    this.pushUndo();
    this.preedit = null;
    this.preferredVisualCol = null;
    this.lastAction = null;
    const text = this.state.lines[line] ?? '';
    this.state.lines[line] = text.slice(0, start) + replacement + text.slice(end);
    this.state.cursorLine = line;
    this.state.cursorCol = start + replacement.length;
    this.notify();
  }

  /* ---------------- 删除族（字素算术 + 行合并） ---------------- */

  /** 退格：删光标前一字素；行首与前行合并（换行删除语义） */
  backspace(): void {
    this.lastAction = null;
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol > 0) {
      this.pushUndo();
      const boundary = prevGraphemeBoundary(line, this.state.cursorCol);
      this.state.lines[this.state.cursorLine] = line.slice(0, boundary) + line.slice(this.state.cursorCol);
      this.setCursorCol(boundary);
    } else if (this.state.cursorLine > 0) {
      this.pushUndo();
      const prev = this.state.lines[this.state.cursorLine - 1] ?? '';
      this.state.lines[this.state.cursorLine - 1] = prev + line;
      this.state.lines.splice(this.state.cursorLine, 1);
      this.state.cursorLine--;
      this.setCursorCol(prev.length);
    } else {
      return; // 空框行首——无操作（不空通知）
    }
    this.exitHistoryBrowsing();
    this.notify();
  }

  /** 前删：删光标处一字素；行尾与下一行合并 */
  deleteForward(): void {
    this.lastAction = null;
    this.exitHistoryBrowsing();
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol < line.length) {
      this.pushUndo();
      const boundary = nextGraphemeBoundary(line, this.state.cursorCol);
      this.state.lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol) + line.slice(boundary);
    } else if (this.state.cursorLine < this.state.lines.length - 1) {
      this.pushUndo();
      const next = this.state.lines[this.state.cursorLine + 1] ?? '';
      this.state.lines[this.state.cursorLine] = line + next;
      this.state.lines.splice(this.state.cursorLine + 1, 1);
    } else {
      return; // 末行行尾——无操作
    }
    this.notify();
  }

  /** 删至行首：光标前段整删；行首与前行合并 */
  deleteToLineStart(): void {
    this.lastAction = null;
    this.exitHistoryBrowsing();
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol > 0) {
      this.pushUndo();
      this.state.lines[this.state.cursorLine] = line.slice(this.state.cursorCol);
      this.setCursorCol(0);
    } else if (this.state.cursorLine > 0) {
      this.pushUndo();
      const prev = this.state.lines[this.state.cursorLine - 1] ?? '';
      this.state.lines[this.state.cursorLine - 1] = prev + line;
      this.state.lines.splice(this.state.cursorLine, 1);
      this.state.cursorLine--;
      this.setCursorCol(prev.length);
    } else {
      return;
    }
    this.notify();
  }

  /** 删至行尾：光标后段整删；行尾与下一行合并 */
  deleteToLineEnd(): void {
    this.lastAction = null;
    this.exitHistoryBrowsing();
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol < line.length) {
      this.pushUndo();
      this.state.lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol);
    } else if (this.state.cursorLine < this.state.lines.length - 1) {
      this.pushUndo();
      const next = this.state.lines[this.state.cursorLine + 1] ?? '';
      this.state.lines[this.state.cursorLine] = line + next;
      this.state.lines.splice(this.state.cursorLine + 1, 1);
    } else {
      return;
    }
    this.notify();
  }

  /** 词级退删：删光标前一词（词边界 = word-nav 单源）；行首与前行合并 */
  deleteWordBackward(): void {
    this.lastAction = null;
    this.exitHistoryBrowsing();
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol === 0) {
      if (this.state.cursorLine > 0) {
        this.pushUndo();
        const prev = this.state.lines[this.state.cursorLine - 1] ?? '';
        this.state.lines[this.state.cursorLine - 1] = prev + line;
        this.state.lines.splice(this.state.cursorLine, 1);
        this.state.cursorLine--;
        this.setCursorCol(prev.length);
        this.notify();
      }
      return;
    }
    this.pushUndo();
    const boundary = findWordBackward(line, this.state.cursorCol);
    this.state.lines[this.state.cursorLine] = line.slice(0, boundary) + line.slice(this.state.cursorCol);
    this.setCursorCol(boundary);
    this.notify();
  }

  /** 词级前删：删光标后一词；行尾与下一行合并 */
  deleteWordForward(): void {
    this.lastAction = null;
    this.exitHistoryBrowsing();
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol >= line.length) {
      if (this.state.cursorLine < this.state.lines.length - 1) {
        this.pushUndo();
        const next = this.state.lines[this.state.cursorLine + 1] ?? '';
        this.state.lines[this.state.cursorLine] = line + next;
        this.state.lines.splice(this.state.cursorLine + 1, 1);
        this.notify();
      }
      return;
    }
    this.pushUndo();
    const boundary = findWordForward(line, this.state.cursorCol);
    this.state.lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol) + line.slice(boundary);
    this.notify();
  }

  /* ---------------- 换行 ---------------- */

  /** 插入换行：当前行光标处劈开、光标落新行首 */
  addNewLine(): void {
    this.lastAction = null;
    this.exitHistoryBrowsing();
    this.pushUndo();
    const line = this.state.lines[this.state.cursorLine] ?? '';
    this.state.lines[this.state.cursorLine] = line.slice(0, this.state.cursorCol);
    this.state.lines.splice(this.state.cursorLine + 1, 0, line.slice(this.state.cursorCol));
    this.state.cursorLine++;
    this.setCursorCol(0);
    this.notify();
  }

  /* ---------------- 移动族（字素边界 + 视觉行 sticky 列） ---------------- */

  /** 左移一字素（行首 wrap 到前行行尾） */
  moveLeft(): void {
    this.lastAction = null;
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol > 0) {
      this.setCursorCol(prevGraphemeBoundary(line, this.state.cursorCol));
    } else if (this.state.cursorLine > 0) {
      this.state.cursorLine--;
      this.setCursorCol((this.state.lines[this.state.cursorLine] ?? '').length);
    }
  }

  /** 右移一字素（行尾 wrap 到下一行行首） */
  moveRight(): void {
    this.lastAction = null;
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol < line.length) {
      this.setCursorCol(nextGraphemeBoundary(line, this.state.cursorCol));
    } else if (this.state.cursorLine < this.state.lines.length - 1) {
      this.state.cursorLine++;
      this.setCursorCol(0);
    }
  }

  /** 上移一视觉行（sticky 列——显示列制双宽对齐） */
  moveUp(): void {
    this.lastAction = null;
    const map = this.visualLines();
    this.moveToVisualLine(map, this.currentVisualLine(map) - 1);
  }

  /** 下移一视觉行 */
  moveDown(): void {
    this.lastAction = null;
    const map = this.visualLines();
    this.moveToVisualLine(map, this.currentVisualLine(map) + 1);
  }

  /** 上 / 下翻页（页大小 = 视觉行数；光标随页夹取） */
  pageUp(pageSize: number): void {
    this.lastAction = null;
    const map = this.visualLines();
    this.moveToVisualLine(map, this.currentVisualLine(map) - Math.max(1, pageSize));
  }

  pageDown(pageSize: number): void {
    this.lastAction = null;
    const map = this.visualLines();
    this.moveToVisualLine(map, this.currentVisualLine(map) + Math.max(1, pageSize));
  }

  /** 词向后移（行首 wrap 到前行行尾） */
  moveWordBackward(): void {
    this.lastAction = null;
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol === 0) {
      if (this.state.cursorLine > 0) {
        this.state.cursorLine--;
        this.setCursorCol((this.state.lines[this.state.cursorLine] ?? '').length);
      }
      return;
    }
    this.setCursorCol(findWordBackward(line, this.state.cursorCol));
  }

  /** 词向前移（行尾 wrap 到下一行行首） */
  moveWordForward(): void {
    this.lastAction = null;
    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (this.state.cursorCol >= line.length) {
      if (this.state.cursorLine < this.state.lines.length - 1) {
        this.state.cursorLine++;
        this.setCursorCol(0);
      }
      return;
    }
    this.setCursorCol(findWordForward(line, this.state.cursorCol));
  }

  /** 行首 */
  moveHome(): void {
    this.lastAction = null;
    this.setCursorCol(0);
  }

  /** 行尾 */
  moveEnd(): void {
    this.lastAction = null;
    this.setCursorCol((this.state.lines[this.state.cursorLine] ?? '').length);
  }

  /**
   * jump 词向：跳到指定字符的下 / 上一处出现（多行搜索、跳过光标当前位）。
   * 无匹配光标不动。
   */
  jumpToChar(ch: string, direction: 'forward' | 'backward'): void {
    this.lastAction = null;
    const isForward = direction === 'forward';
    const step = isForward ? 1 : -1;
    const end = isForward ? this.state.lines.length : -1;
    for (let li = this.state.cursorLine; li !== end; li += step) {
      const line = this.state.lines[li] ?? '';
      const isCurrent = li === this.state.cursorLine;
      const from = isCurrent ? (isForward ? this.state.cursorCol + 1 : this.state.cursorCol - 1) : undefined;
      const idx = isForward ? line.indexOf(ch, from) : line.lastIndexOf(ch, from);
      if (idx !== -1) {
        this.state.cursorLine = li;
        this.setCursorCol(idx);
        return;
      }
    }
  }

  /* ---------------- undo ---------------- */

  undo(): void {
    this.exitHistoryBrowsing();
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.state = snapshot;
    this.lastAction = null;
    this.preedit = null;
    this.preferredVisualCol = null;
    this.notify();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /* ---------------- IME 预编辑 ---------------- */

  /** 挂起 / 清除预编辑段（committed = false 增量路——渲染呈现不并入正文） */
  setPreedit(text: string | null): void {
    this.preedit = text !== null && text.length > 0 ? text : null;
  }

  /* ---------------- 输入历史 ---------------- */

  /** 入册（提交后调用）：trim 空不加、连续重复不加、100 帽 */
  addToHistory(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.history[0] === trimmed) return;
    this.history.unshift(trimmed);
    if (this.history.length > HISTORY_LIMIT) this.history.pop();
  }

  /** 翻阅（-1 向旧 / +1 向新）：draft 保底、尽头 no-op */
  navigateHistory(direction: -1 | 1): void {
    this.lastAction = null;
    if (this.history.length === 0) return;
    const newIndex = this.historyIndex - direction;
    if (newIndex < -1 || newIndex >= this.history.length) return;
    // 首入浏览态：快照草稿（回新态时恢复未提交编辑）
    if (this.historyIndex === -1 && newIndex >= 0) {
      this.pushUndo();
      this.historyDraft = structuredClone(this.state);
    }
    this.historyIndex = newIndex;
    if (this.historyIndex === -1) {
      const draft = this.historyDraft;
      this.historyDraft = null;
      if (draft) {
        this.state = draft;
        this.preferredVisualCol = null;
        this.notify();
      }
    } else {
      // 向旧翻光标归首、向新翻归尾（浏览方向语义）
      const text = this.history[this.historyIndex] ?? '';
      const lines = text.split('\n');
      this.state.lines = lines.length === 0 ? [''] : lines;
      const goingOld = direction === -1;
      this.state.cursorLine = goingOld ? 0 : this.state.lines.length - 1;
      const target = this.state.lines[this.state.cursorLine] ?? '';
      this.setCursorCol(goingOld ? 0 : target.length);
      this.notify();
    }
  }

  /** 退出浏览态（任何编辑动作先行——draft 弃） */
  exitHistoryBrowsing(): void {
    this.historyIndex = -1;
    this.historyDraft = null;
  }

  /** 是否在历史浏览态（↑ 触发判据之一） */
  isBrowsingHistory(): boolean {
    return this.historyIndex > -1;
  }

  /** 空框判（↑ 触发判据之一） */
  isEmpty(): boolean {
    return this.state.lines.length === 1 && this.state.lines[0] === '';
  }

  /** 光标在首视觉行判（↑ 于首行顶端才触发历史——呈现面件 2 语义） */
  isOnFirstVisualLine(): boolean {
    return this.currentVisualLine(this.visualLines()) === 0;
  }

  /** 光标在末视觉行判（↓ 触发历史回新的判据） */
  isOnLastVisualLine(): boolean {
    const map = this.visualLines();
    return this.currentVisualLine(map) === map.length - 1;
  }

  /* ---------------- 内部 ---------------- */

  /** 非垂直移动统一清 sticky 列（所有光标落位走此路） */
  private setCursorCol(col: number): void {
    this.state.cursorCol = col;
    this.preferredVisualCol = null;
  }

  /** 落位目标视觉行（sticky 列决策——显示列制；越界 no-op） */
  private moveToVisualLine(map: VisualSegment[], target: number): void {
    if (target < 0 || target >= map.length) return;
    const curIdx = this.currentVisualLine(map);
    const curVL = map[curIdx]!;
    const tgtVL = map[target]!;
    const curLine = this.state.lines[curVL.line] ?? '';
    // 源显示列（光标在本段内的显示列）
    const curCols = prefixDisplayWidth(curLine, this.state.cursorCol) - prefixDisplayWidth(curLine, curVL.startCol);
    // sticky 决策（pi 表简化形）：
    // - 链中（源行已夹到尾）：目标放得下回 sticky 位（清链）、放不下保持夹尾（留链）；
    // - 无链或编辑中途起链：源显示列放得下平移（不启链）、放不下落目标尾并起链
    const preferred = this.preferredVisualCol;
    let wantCols: number;
    if (preferred !== null && curCols >= curVL.width) {
      wantCols = Math.min(preferred, tgtVL.width);
      this.preferredVisualCol = preferred > tgtVL.width ? preferred : null;
    } else {
      wantCols = Math.min(curCols, tgtVL.width);
      this.preferredVisualCol = curCols > tgtVL.width ? curCols : null;
    }
    const tgtLine = this.state.lines[tgtVL.line] ?? '';
    // 显示列反查（相对段起点计——与 curCols 同坐标系；夹段宽，半字防线由反查内建）
    const col = colAtDisplayColumn(tgtLine, tgtVL.startCol, wantCols);
    this.state.cursorLine = tgtVL.line;
    // 垂直落位直写（不经 setCursorCol——sticky 生命周期归本路，落位不得自清）
    this.state.cursorCol = col;
  }

  private pushUndo(): void {
    this.undoStack.push(this.state);
  }

  private notify(): void {
    if (this.onChange !== null) this.onChange(this.getText());
  }
}
