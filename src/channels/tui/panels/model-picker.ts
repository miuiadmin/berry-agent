/**
 * /model 模型选择器副屏件（2026-09-30 UX 对标批 ux-4——TUI 本地拦截族）：
 * ThinkingPicker 形选择器 + provider 分组头 + 打字过滤。
 *
 * - **条目 = providers 装配序 × provider 内 model 序的 `provider/model` 全列**
 *   （清单单源 = ctrl+p 循环同一读面——装配位注入纯数据行，本件不 import llm）；
 * - **provider 分组头**（dim 行——opencode/zcode 分组先例；组头不可停光标）；
 * - **当前模型 ● 标记**（光标 ▸ 与当前 ● 两记分立——ThinkingPicker 同律）；
 * - **打字过滤**（query 子串匹配 spec 即时过滤——pi/opencode/codex 面板先例；
 *   过滤词呈现于底行 + backspace 删词；过滤后分组头随条目重算）；
 * - **选定先收副屏再回调**（件族同序律）：onSelect 收 spec 全形——setModel +
 *   回执 + footer 活写全归装配闭包，本件零边外面；
 * - **退出键面**：q/Esc 退出（kitty text 'q' 双轨）、Ctrl+C 打断在飞 run
 *   （不退屏）、Ctrl+D 退出进程（先收副屏再转退出柄）——副屏键面件族律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { fitRowSegments } from '../row-segments.js';
import type { OverlayContent } from '../overlay/overlay.js';

/** 模型条目（装配位从 llmRuntime 目录合成——本件不 import llm） */
export interface ModelPickEntry {
  /** 全形 spec（`provider/model`——onSelect 原样回传；ctrl+p 宇宙同一串） */
  readonly spec: string;
  /** provider id（分组头判据——条目按装配序已排，同 provider 连续） */
  readonly provider: string;
  /** model 裸 id（行呈现右段） */
  readonly model: string;
}

/** 模型选择器装配选项 */
export interface ModelPickerOptions {
  /** 条目快照（装配序——本件原样呈现；过滤只在屏内视图不重排底单） */
  readonly entries: readonly ModelPickEntry[];
  /** 当前模型 spec（● 标记判据；undefined = 诚实无锚） */
  readonly current: string | undefined;
  /** 选定回调（spec 全形——先收副屏再回调；setModel/回执/footer 归装配闭包） */
  readonly onSelect: (spec: string) => void;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 分组头样式（dim——provider 域名行） */
const HEAD_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 当前模型标记 */
const CURRENT_MARK = '●';
/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——件族面） */
const WHEEL_LINES = 3;

/** 渲染行（视口展开形：组头行不可停光标、条目行可停） */
type RowLine = { readonly type: 'head'; readonly label: string } | { readonly type: 'item'; readonly index: number };

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 模型选择器内容件（OverlayContent——副屏 root 直收全屏 region；自持光标、
 * 视口窗口与过滤词）。快照档——构造后条目底单静态，过滤只在屏内视图。
 */
export class ModelPicker implements OverlayContent {
  private readonly entries: readonly ModelPickEntry[];
  private readonly current: string | undefined;
  private readonly onSelect: (spec: string) => void;
  private readonly sessionId: string;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 过滤词（空串 = 全量；子串匹配 spec 不区分大小写） */
  private query = '';
  /** 光标位（**过滤后条目集**的下标——过滤重算时夹取） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 视口高实测（render 回写——翻页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（选定与取消两路共闭——竞发防御位） */
  private exited = false;

  constructor(options: ModelPickerOptions) {
    this.entries = options.entries;
    this.current = options.current;
    this.onSelect = options.onSelect;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /** 过滤后条目集（query 空 = 全量；装配序保持） */
  private filtered(): readonly ModelPickEntry[] {
    if (this.query === '') return this.entries;
    const q = this.query.toLowerCase();
    return this.entries.filter((entry) => entry.spec.toLowerCase().includes(q));
  }

  /** 视口展开行集：provider 分组头 + 条目行（同 provider 连续——头行只出组首） */
  private rows(items: readonly ModelPickEntry[]): readonly RowLine[] {
    const rows: RowLine[] = [];
    let lastProvider: string | undefined;
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]!;
      if (entry.provider !== lastProvider) {
        rows.push({ type: 'head', label: `── ${entry.provider} ──` });
        lastProvider = entry.provider;
      }
      rows.push({ type: 'item', index: i });
    }
    return rows;
  }

  /** 量高：头行 + 全量展开行数（过滤后行少底部留白——measure 快照形）+ 底行 */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.rows(this.entries).length) + 1;
  }

  /** 落位：头行 → 展开行视口（组头 dim / 条目 ▸ ● spec · model 右段）→ 底行 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const items = this.filtered();
    const rows = this.rows(items);
    buffer.writeText(region.row, region.col, `◆ 切换模型 · ${items.length} 个${this.query !== '' ? '（过滤中）' : ''}`);
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampOffset(rows.length);
    if (rows.length === 0) {
      buffer.writeText(region.row + 1, region.col, `（无匹配「${this.query}」的模型）`, HINT_STYLE);
    } else {
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= rows.length) break;
        const row = rows[index]!;
        const line = region.row + 1 + i;
        if (row.type === 'head') {
          buffer.writeText(line, region.col, row.label, HEAD_STYLE);
        } else {
          this.renderItemRow(buffer, line, region.col, region.width, items[row.index]!, row.index === this.cursor);
        }
      }
    }
    // 底行：键路提示 + 过滤词呈现（过滤面在屏可感知）。过滤态换简化提示——
    // 过滤词是首要信息（全量态长提示 + 过滤词会挤爆窄屏行宽）
    if (this.query !== '') {
      buffer.writeText(
        region.row + region.height - 1,
        region.col,
        `过滤：${this.query}_ · ↑↓ 移动 · enter 选定 · backspace 删词 · esc 返回`,
        HINT_STYLE,
      );
    } else {
      buffer.writeText(
        region.row + region.height - 1,
        region.col,
        `↑↓ 移动 · enter 选定（下一轮对话起生效） · 打字过滤 · esc/q 返回`,
        HINT_STYLE,
      );
    }
  }

  /** 条目行落位：左段（光标 + 当前标记 + spec）+ 右段（model 裸名）右对齐 */
  private renderItemRow(
    buffer: CellBuffer,
    row: number,
    col: number,
    width: number,
    entry: ModelPickEntry,
    isCursor: boolean,
  ): void {
    const prefix = isCursor ? `${CURSOR_MARK} ` : '  ';
    const mark = this.current !== undefined && entry.spec === this.current ? `${CURRENT_MARK} ` : '  ';
    const left = `${prefix}${mark}${entry.spec}`;
    const fit = fitRowSegments(left, entry.model, width);
    buffer.writeText(row, col, fit.left);
    if (fit.rightWidth > 0) buffer.writeText(row, col + width - fit.rightWidth, fit.right, HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费）：滚轮 → Ctrl+C/Ctrl+D 补丁 → 移动/选定/取消 → 打字过滤 */
  handleEvent(event: InputEvent): boolean {
    if (this.exited) return true; // 闭锁后终局吞
    if (event.kind === 'mouse') {
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.filtered().length > 0) {
          this.moveCursor(event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES);
        }
        return true;
      }
      return true; // 非滚轮鼠标相零动作吞（模态独占）
    }
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（不退屏——件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄——件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      const items = this.filtered();
      if (items.length > 0) {
        if (isPlainKey(k, 'up')) {
          this.moveCursor(-1);
          return true;
        }
        if (isPlainKey(k, 'down')) {
          this.moveCursor(1);
          return true;
        }
        if (isPlainKey(k, 'pageup')) {
          this.moveCursor(-this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'pagedown')) {
          this.moveCursor(this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'home')) {
          this.cursor = 0;
          this.clampOffset(this.rows(items).length);
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = items.length - 1;
          this.clampOffset(this.rows(items).length);
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const chosen = items[this.cursor]!.spec;
          this.exit(); // 先收副屏再选定（setModel/回执归装配闭包）
          this.onSelect(chosen);
          return true;
        }
      }
      if (isPlainKey(k, 'escape')) {
        this.exit();
        return true;
      }
      if (isPlainKey(k, 'backspace')) {
        // 过滤词删尾（空词零动作）
        if (this.query !== '') this.query = this.query.slice(0, -1);
        this.cursor = 0; // 过滤集重算——光标归首防越界
        this.clampOffset(this.rows(this.filtered()).length);
        return true;
      }
      // legacy 轨打字（kitty 轨走 text 事件——双轨同收）；q 在无过滤词时是退出
      // 捷键（ThinkingPicker 同律），有过滤词时 q 入过滤词（打字面优先）
      const ch = plainChar(k);
      if (ch !== null) {
        this.typeFilter(ch);
        return true;
      }
      return true; // 未消费键终局吞（模态独占）
    }
    if (event.kind === 'text') {
      const text = (event as InputEvent & { kind: 'text'; text: string }).text;
      // kitty text 轨：单字符入过滤；q 语义同 key 轨（无过滤词 = 退出捷键）
      if (text.length === 1) {
        this.typeFilter(text);
        return true;
      }
      return true;
    }
    return true;
  }

  /** 打字入过滤词（q 特例：无过滤词时 = 退出——件族 q 捷键与过滤面共存律） */
  private typeFilter(ch: string): void {
    if (ch === 'q' && this.query === '') {
      this.exit();
      return;
    }
    this.query += ch;
    this.cursor = 0; // 过滤集重算——光标归首
    this.clampOffset(this.rows(this.filtered()).length);
  }

  /** 光标移动（越界夹取不循环；移动后光标行恒在窗内） */
  private moveCursor(delta: number): void {
    const items = this.filtered();
    this.cursor = Math.max(0, Math.min(items.length - 1, this.cursor + delta));
    this.clampOffset(this.rows(items).length);
  }

  /** 视口夹取：光标行恒在窗内 + 窗长条目行回拉（陈窗深 offset 防御） */
  private clampOffset(rowCount: number): void {
    const maxOffset = Math.max(0, rowCount - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    // 光标条目行号（展开行集内）：光标前有组头行——行号 ≤ 展开下标。窗判定用
    // 展开行集：光标行号 = rows 中第 cursor 个 item 行的位置。近似窗判定以
    // 「光标条目展开行号」夹取——重扫展开行集取位（条目数小，O(n) 无妨）
    const items = this.filtered();
    const rows = this.rows(items);
    let cursorRow = 0;
    let seen = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.type === 'item') {
        if (seen === this.cursor) {
          cursorRow = i;
          break;
        }
        seen++;
      }
    }
    if (cursorRow < this.offset) this.offset = cursorRow;
    else if (cursorRow >= this.offset + this.viewportHeight) {
      this.offset = cursorRow - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——选定与取消单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}

/** legacy key 轨可打印字符提取（无修饰单字符——kitty text 轨之外的老终端轨） */
function plainChar(e: InputEvent & { kind: 'key' }): string | null {
  if (e.ctrl || e.alt || e.meta) return null;
  if (e.key.length !== 1) return null;
  return e.key;
}
