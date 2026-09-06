/**
 * 件 8 /history 全屏回看器（07 §4.1 呈现面件 8——批 10f-4 特性腿）：
 * 副屏只读内容件（OverlayContent——经 AltScreenHost 装载入 1049 备屏）。
 *
 * - **数据源 = 复用主屏同一渲染管线**（07 件 8 条款）：history() 注入拉取的
 *   全量 durable 正文投影 → LiveTranscript 全量档（blockCap = Infinity——
 *   恒一致的是管线非范围，主屏按滚动帽 / 回看器全量）→ renderBlockStyledLines
 *   带样式行集（同输入同行集、零第二渲染器）；瞬时面（状态行/todo/活动面板）
 *   不进回看器——数据腿只有 durable 投影，结构上即不进；
 * - **快照档 v1**（条款）：行集构造后静态——回看期新事件不进副屏（无追加
 *   路），返回主屏全帧补显（resumeMain 自持）；活体跟随挂账未落；
 * - **键盘滚动**（首版键盘先行——滚轮随鼠标批接）：ScrollView 装载
 *   （↑/↓/PgUp/PgDn/Home/End——折叠与偏移算术恒归 ScrollView，样式呈现经
 *   writeSlice 覆写接缝注入，零第二滚动引擎）；
 * - **搜索三动作**（条款锁能力不锁键位——缺省 Ctrl+Shift+F）：开（搜索框
 *   在场——Editor 单行档复用，IME/粘贴/字素光标白得）/ 跳匹配（Enter 下一、
 *   Shift+Enter 上一、循环；当前匹配反色高亮）/ 关（Esc——高亮清、查询文
 *   本保留续搜）；
 * - **退出让位判据**（条款）：q/Esc 退出只在搜索框不在场时消费——否则打
 *   不出字母 q；
 * - **副屏键面补丁**（与主屏同键面——07 §4.3 输入路由拦截链条款）：Ctrl+C
 *   = 打断在飞 run（滤 kitty release）、Ctrl+D = 退出（先收副屏——onExit
 *   先于 onQuit；搜索框有文不退，与主屏空框闸同律）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { Editor } from '../editor/editor.js';
import { prefixDisplayWidth, type VisualSegment } from '../editor/visual-lines.js';
import { LiveTranscript, renderBlockStyledLines, shortIdOf } from '../backend/transcript.js';
import type { StyledLine } from '../backend/ansi-rows.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { AgentMessage } from '../../../contracts/index.js';
import { sessionColor } from '../theme.js';

/** 回看器装配选项 */
export interface HistoryViewerOptions {
  /** 会话归属（呈现会话短 id——header 行） */
  readonly sessionId: string;
  /** 全量 durable 正文投影（history() 注入拉取的快照——构造后静态，快照档 v1） */
  readonly messages: readonly AgentMessage[];
  /** 行集构建折宽锚（开屏时终端列宽——渲染期 ScrollView 按实际 region 宽重折） */
  readonly columns: number;
  /** 退出回看器（q/Esc/Ctrl+D——装配接线：收副屏〔AltScreenHost close〕） */
  readonly onExit: () => void;
  /** 打断在飞 run（Ctrl+C 副屏键面补丁——与主屏同键面，装配柄透传） */
  readonly onInterrupt?: (sessionId: string) => void;
  /** 退出进程（Ctrl+D——先收副屏〔onExit 已先调〕再转装配退出柄） */
  readonly onQuit?: () => void;
}

/** 搜索匹配定位（逻辑行 + UTF-16 区间〔start 含 end 不含〕） */
interface MatchSpan {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

/** 当前匹配高亮样式（整段反色——视口内最强存在感） */
const MATCH_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 提示行样式（dim——存在感弱于正文） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 常态底行键面提示 */
const HINT_TEXT = 'q/esc 返回 · ctrl+shift+f 搜索 · ↑↓/pgup/pgdn/home/end 滚动';

/** key 事件窄化（其他事件形归各分路——text/ime/paste） */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判（让位判据与退出键消费的判据面） */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 回看器内容件：ScrollView 子类（滚动/折叠/偏移算术继承）+ OverlayContent
 * （副屏 root——render 直收全屏 region，量高不经布局路）。
 */
export class HistoryViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly shortId: string;
  /** 带样式行集（构造后静态——快照档 v1：回看期新事件不进副屏） */
  private readonly styledLines: readonly StyledLine[];
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;

  /* ---- 搜索态（开/跳/关三动作状态机） ---- */
  private searchOpen = false;
  private readonly searchEditor: Editor;
  private matches: readonly MatchSpan[] = [];
  private matchIndex = -1;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发的防御位） */
  private exited = false;

  constructor(options: HistoryViewerOptions) {
    super(); // 无 maxHeight——副屏 root 直收 region 全高
    this.sessionId = options.sessionId;
    this.shortId = shortIdOf(options.sessionId);
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    // 全量档行集：投影 → LiveTranscript（Infinity 帽恒不截）→ 带样式行（管线单源）
    const transcript = new LiveTranscript({ blockCap: Number.POSITIVE_INFINITY });
    transcript.loadProjection(options.messages);
    const styled: StyledLine[] = [];
    for (const block of transcript.snapshot) {
      styled.push(...renderBlockStyledLines(block, options.columns));
    }
    this.styledLines = styled;
    super.setLines(styled.map((line) => line.plain)); // 开屏贴尾（follow 初始 true）
    this.searchEditor = new Editor({
      maxVisibleLines: 1, // 单行档——搜索框
      onChange: () => this.recomputeMatches(),
    });
    this.searchEditor.setFocused(false);
  }

  /** 量高：头行 + 视口全量 + 底铬（副屏 root 不经布局路——契约的诚实实现） */
  measure(width: number): number {
    return 1 + super.measure(width) + (this.searchOpen ? this.searchEditor.measure(width) : 1);
  }

  /**
   * 落位（副屏全屏 region 自底盘向上三段）：头行（档名 + 会话短 id 会话区分色
   * + 搜索计数）→ 滚动视口（super.render——折叠/偏移/滚动条恒归 ScrollView）→
   * 底铬（搜索在场 = 单行 Editor；否则键面提示行）。
   */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端——头行 + 视口都不够）
    // 头行
    const headPrefix = '↩ 历史回看 · ';
    buffer.writeText(region.row, region.col, headPrefix);
    // 会话短 id 起列 = 前缀显示宽（CJK 双宽——UTF-16 长度直减不可靠）
    buffer.writeText(region.row, region.col + prefixDisplayWidth(headPrefix, headPrefix.length), this.shortId, {
      fg: sessionColor(this.shortId),
    });
    if (this.searchOpen) {
      // 搜索计数（当前/总数；无匹配如实 0）
      const count = `${this.matchIndex + 1}/${this.matches.length}`;
      buffer.writeText(region.row, region.col + region.width - 1 - count.length, count, HINT_STYLE);
    }
    // 滚动视口（头行与底铬之间）
    const chromeBottom = this.searchOpen ? this.searchEditor.measure(region.width) : 1;
    const viewHeight = region.height - 1 - chromeBottom;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    // 底铬
    if (this.searchOpen) {
      this.searchEditor.setFocused(true);
      this.searchEditor.render(buffer, {
        row: region.row + region.height - chromeBottom,
        col: region.col,
        width: region.width,
        height: chromeBottom,
      });
    } else {
      buffer.writeText(region.row + region.height - 1, region.col, HINT_TEXT, HINT_STYLE);
    }
  }

  /**
   * 事件分发（副屏内容终局消费——未消费键不穿透，模态独占）。
   * 序：Ctrl+C / Ctrl+D 副屏键面补丁 → 搜索开关键 → 搜索在场模态（让位判据：
   * q/Esc 不退出）→ 常态退出键（q/Esc）→ 滚动键（ScrollView）。
   */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（press/repeat 相动作滤 kitty release——与滚动键/编辑键的相过滤同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出（先收副屏再转退出柄；搜索框有文不退——主屏空框闸同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd' && this.searchEditor.model.isEmpty()) {
        this.exit();
        this.onQuit?.();
        return true;
      }
      // 搜索开键（条款锁能力不锁键位）：kitty 轨 ctrl+shift+f；legacy 轨 0x06
      // 归一 ctrl+f（shift 不可辨）——搜索关态两形同判，开态 ctrl+f 让路编辑器
      if (k.ctrl && !k.alt && !k.meta && k.key === 'f' && (k.shift || !this.searchOpen)) {
        if (!this.searchOpen) this.openSearch();
        return true; // 已开态的 ctrl+shift+f = no-op（层内终局）
      }
    }
    if (this.searchOpen) {
      // 让位判据（条款）：搜索框在场时 Esc 先关搜索、q 落框内——退出键不消费
      if (k !== null && k.phase !== 'release' && !k.ctrl && !k.alt && !k.meta) {
        if (isPlainKey(k, 'escape')) {
          this.closeSearch();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          this.jumpMatch(1); // 跳匹配：Enter 下一
          return true;
        }
        if (k.shift && k.key === 'enter') {
          this.jumpMatch(-1); // Shift+Enter 上一
          return true;
        }
      }
      // 其余（文本/IME/粘贴/编辑键）入搜索框；未消费键层内终局（模态）
      this.searchEditor.handleEvent(event);
      return true;
    }
    // 常态退出键（搜索不在场——让位判据的另一面）：q（text 路为主——kitty
    // disambiguate 轨纯键打字走 text 事件；key 路防御同判）与 Esc
    if (k !== null && k.phase !== 'release') {
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    if (event.kind === 'text' && event.text === 'q') {
      this.exit();
      return true;
    }
    // 滚动键（↑/↓/PgUp/PgDn/Home/End——ScrollView 自持；未消费键终局吞）
    this.handleEventSuper(event);
    return true;
  }

  /** super.handleEvent 直呼（子类覆写同名面后仍需触达基类滚动路的显式位） */
  private handleEventSuper(event: InputEvent): void {
    super.handleEvent(event);
  }

  /* ---------------- 搜索三动作 ---------------- */

  /** 开：搜索框在场 + 按在框文本重算匹配并跳首匹配 */
  private openSearch(): void {
    this.searchOpen = true;
    this.recomputeMatches();
  }

  /** 关：框退场 + 高亮清（查询文本保留——重开续搜的增量检索延续） */
  private closeSearch(): void {
    this.searchOpen = false;
    this.matches = [];
    this.matchIndex = -1;
    this.searchEditor.setFocused(false);
  }

  /** 匹配重算（查询变更路）：全行不区分大小写子串扫描 + 跳首匹配 */
  private recomputeMatches(): void {
    const query = this.searchEditor.getText();
    const found: MatchSpan[] = [];
    if (query !== '') {
      const q = query.toLowerCase();
      for (let i = 0; i < this.styledLines.length; i++) {
        const plain = this.styledLines[i]!.plain.toLowerCase();
        let at = plain.indexOf(q);
        while (at !== -1) {
          found.push({ line: i, start: at, end: at + q.length });
          at = plain.indexOf(q, at + 1);
        }
      }
    }
    this.matches = found;
    this.matchIndex = found.length > 0 ? 0 : -1;
    if (this.matchIndex >= 0) this.scrollToLine(found[0]!.line, found[0]!.start);
  }

  /** 跳匹配（±1 循环——尾后回首、首前到尾） */
  private jumpMatch(delta: 1 | -1): void {
    if (this.matches.length === 0) return;
    this.matchIndex = (this.matchIndex + delta + this.matches.length) % this.matches.length;
    const m = this.matches[this.matchIndex]!;
    this.scrollToLine(m.line, m.start);
  }

  /** 退出（闭锁——单次） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }

  /* ---------------- 带样式切片写出（writeSlice 覆写接缝） ---------------- */

  /**
   * 视口切片带样式写出：样式段（管线单源产物）按切片边界分段落格 + 当前匹配
   * 反色高亮叠加。列位经 prefixDisplayWidth 换算（UTF-16 切片下标 → 显示列
   * ——CJK 双宽对齐与折叠算术同源）。
   */
  protected writeSlice(buffer: CellBuffer, region: Region, displayRow: number, seg: VisualSegment): void {
    const styled = this.styledLines[seg.line];
    if (styled === undefined) return;
    const start = seg.startCol;
    const end = seg.startCol + seg.length;
    // 当前匹配与本切片的交叠段（无匹配/异行 = 空区间）
    const match = this.matchIndex >= 0 ? this.matches[this.matchIndex] : undefined;
    const hlStart = match !== undefined && match.line === seg.line ? Math.max(match.start, start) : end;
    const hlEnd = match !== undefined && match.line === seg.line ? Math.min(match.end, end) : start;
    // 分段边界：切片端点 ∪ 样式段端点 ∪ 高亮端点（升序去重）
    const cuts = new Set<number>([start, end]);
    for (const run of styled.runs) {
      if (run.start > start && run.start < end) cuts.add(run.start);
      if (run.end > start && run.end < end) cuts.add(run.end);
    }
    if (hlStart > start && hlStart < end) cuts.add(hlStart);
    if (hlEnd > start && hlEnd < end) cuts.add(hlEnd);
    const bounds = [...cuts].sort((a, b) => a - b);
    const baseCols = prefixDisplayWidth(styled.plain, start);
    for (let i = 0; i + 1 < bounds.length; i++) {
      const from = bounds[i]!;
      const to = bounds[i + 1]!;
      // 段样式：覆写 from 起点的样式段（段间空隙 = 裸文本）
      let style: CellStyle | undefined;
      for (const run of styled.runs) {
        if (run.start <= from && from < run.end) {
          style = run.style;
          break;
        }
      }
      if (from >= hlStart && from < hlEnd) {
        style = style === undefined ? MATCH_STYLE : { ...style, inverse: true };
      }
      buffer.writeText(
        region.row + displayRow,
        region.col + prefixDisplayWidth(styled.plain, from) - baseCols,
        styled.plain.slice(from, to),
        style,
      );
    }
  }
}
