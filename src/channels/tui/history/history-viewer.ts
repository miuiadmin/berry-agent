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
 * - **鼠标选区 + 滚轮**（2026-09-11 鼠标解码批 mu-2——07 件 8 细则）：线性
 *   选区（press 左键锚定 → motion 按住拖动扩展 → release 触发复制），锚/焦点
 *   存逻辑行 + 行内 UTF-16 下标（渲染无关坐标系——滚动/重折/resize 后仍指同
 *   一正文位）；release 行间拼 LF 经 onCopy 注入柄写出（OSC 52——装配层铸序
 *   列）；选区帽 64 KiB 按明文 UTF-8 字节数计，超帽拒复制 + 底行提示常显至
 *   选区清除；视口外命中（头行/底铬/滚动条列）零动作；搜索框在场拖选禁用
 *   （输入模态优先）；双击词选/越视口自动滚动/滚动条拖拽挂账不预造。滚轮归
 *   ScrollView wheel 消费路（搜索在场也照常滚——禁的是拖选）；
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
import type { CellBuffer, CellStyle, InputEvent, MouseEvent, Region } from '../../engine/index.js';
import { graphemeWidth, splitGraphemes, stringWidth } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { Editor } from '../editor/editor.js';
import { Keymap } from '../keys/registry.js';
import { hintLine } from '../keys/hint.js';
import { prefixDisplayWidth, type VisualSegment } from '../editor/visual-lines.js';
import { fitLine } from '../row-segments.js';
import { LiveTranscript, renderBlockStyledLines, shortIdOf } from '../backend/transcript.js';
import type { StyledLine } from '../backend/ansi-rows.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { AgentMessage } from '../../../contracts/index.js';
import { sessionColor, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js';
import { HEAD_MARKS } from '../panels/panel-chrome.js';

/** 回看器装配选项 */
export interface HistoryViewerOptions {
  /** 会话归属（呈现会话短 id——header 行） */
  readonly sessionId: string;
  /** 全量 durable 正文投影（history() 注入拉取的快照——构造后静态，快照档 v1） */
  readonly messages: readonly AgentMessage[];
  /** 行集构建折宽锚（开屏时终端列宽——渲染期 ScrollView 按实际 region 宽重折） */
  readonly columns: number;
  /** markdown 主题（批 10i——行集构建档与主屏同板；缺席 DEFAULT_THEME 旧形） */
  readonly theme?: ResolvedTheme;
  /** 退出回看器（q/Esc/Ctrl+D——装配接线：收副屏〔AltScreenHost close〕） */
  readonly onExit: () => void;
  /** 打断在飞 run（Ctrl+C 副屏键面补丁——与主屏同键面，装配柄透传） */
  readonly onInterrupt?: (sessionId: string) => void;
  /** 退出进程（Ctrl+D——先收副屏〔onExit 已先调〕再转装配退出柄） */
  readonly onQuit?: () => void;
  /** OSC 52 复制写出柄（release 选区触发——onExit/onInterrupt 装配柄同形先例；装配层包 buildOsc52Copy 铸序列） */
  readonly onCopy?: (text: string) => void;
  /**
   * 键位注册表注入（批 10k 遗漏修——搜索行子编辑器同册）：缺席 = 子编辑器
   * 自建缺省册（单测语义）；装配位注入会话册——用户覆盖对子编辑器同样生效。
   */
  readonly keymap?: Keymap;
}

/** 搜索匹配定位（逻辑行 + UTF-16 区间〔start 含 end 不含〕） */
interface MatchSpan {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

/** 选区定位点（逻辑行 + 行内 UTF-16 下标——渲染无关坐标系：滚动/重折/resize 后仍指同一正文位） */
interface SelPoint {
  readonly line: number;
  readonly col: number;
}

/** 当前匹配高亮样式（整段反色——视口内最强存在感；选区高亮同载体叠加） */
const MATCH_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 提示行样式（dim——存在感弱于正文） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 常态底行键面提示（拼装走 hintLine 单源——07 §4.4 律三全局统一形） */
const HINT_TEXT = hintLine('q/esc 返回', 'ctrl+shift+f 搜索', '↑↓/pgup/pgdn/home/end 滚动', '拖选复制');
/** 选区帽（64 KiB——07 件 8 细则码面缺省参数；计量面 = 选中明文 UTF-8 字节数，与 xterm 100,000 解码后上限同基准）。挂账解挂批①起 /memory 管理面同值单源引用（export——零重抄条款） */
export const SELECTION_CAP_BYTES = 64 * 1024;
/** 超帽底行提示（spec 定文——常显至选区清除；/memory 管理面同文单源引用） */
export const SELECTION_CAP_NOTICE = '选区过大未复制';

/** key 事件窄化（其他事件形归各分路——text/ime/paste） */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判（让位判据与退出键消费的判据面） */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 长度保形小写（挖掘 28 轮 [5]）：搜索比对副本与原文逐 UTF-16 下标对齐的
 * 保证——变长小写字（İ U+0130 → i+U+0307，1 码元→2）使小写副本坐标
 * indexOf 的匹配区间在原文坐标消费时右漂（高亮/跳转同漂）。等长全串快路
 * （长度不变的串与全串 toLowerCase 逐字节等价——希腊尾 sigma 语境归一等
 * 全保留）+ 变长串逐码点保形回退（变长位保原字——诚实 miss 优于坐标漂
 * 移；查询同源保形，İ 查询照匹配 İ 原字）。
 */
function lowercaseAligned(text: string): string {
  const full = text.toLowerCase();
  if (full.length === text.length) return full;
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
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
  /** 行集明文小写副本（搜索比对预算——构造期一次铸形；快照档行集静态无需随动，击键重算零逐行重铸） */
  private readonly plainLowerLines: readonly string[];
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private readonly onCopy: ((text: string) => void) | undefined;

  /* ---- 搜索态（开/跳/关三动作状态机） ---- */
  private searchOpen = false;
  private readonly searchEditor: Editor;
  /** 会话键位册（单行守卫册驱动判据用——与 searchEditor 同实例） */
  private readonly keymap: Keymap;
  private matches: readonly MatchSpan[] = [];
  private matchIndex = -1;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发的防御位） */
  private exited = false;

  /* ---- 选区态（press 锚定 → motion 扩展 → release 复制——线性选区状态机） ---- */
  private selAnchor: SelPoint | null = null;
  private selFocus: SelPoint | null = null;
  /** 底行提示文案（超帽拒复制——常显至选区清除；null = 常态键面提示） */
  private selectionNotice: string | null = null;

  constructor(options: HistoryViewerOptions) {
    super(); // 无 maxHeight——副屏 root 直收 region 全高
    this.sessionId = options.sessionId;
    this.shortId = shortIdOf(options.sessionId);
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onCopy = options.onCopy;
    // 会话键位册自持（守卫判据与子编辑器同实例——缺席自建缺省册，单测语义）
    this.keymap = options.keymap ?? new Keymap();
    // 全量档行集：投影 → LiveTranscript（Infinity 帽恒不截）→ 带样式行（管线单源）
    const transcript = new LiveTranscript({ blockCap: Number.POSITIVE_INFINITY, theme: options.theme });
    transcript.loadProjection(options.messages);
    const styled: StyledLine[] = [];
    for (const block of transcript.snapshot) {
      styled.push(...renderBlockStyledLines(block, options.columns));
    }
    this.styledLines = styled;
    // 小写副本构造期预算（搜索比对单源——击键只走 indexOf 比对，不对静态行集
    // 逐行重铸小写串；长度保形：与原文逐下标对齐——İ 等变长小写字不破匹配
    // 坐标系，见 lowercaseAligned）
    this.plainLowerLines = styled.map((line) => lowercaseAligned(line.plain));
    super.setLines(styled.map((line) => line.plain)); // 开屏贴尾（follow 初始 true）
    this.searchEditor = new Editor({
      maxVisibleLines: 1, // 单行档——搜索框
      // minPresentedLines 1 + padRows 0 = 底铬瞬时输入行 opt-out（五件批 A+B
      // 呈现策略辖主 composer 不辖底铬——单行形设计锁，量高恒 1 回归旧几何）
      minPresentedLines: 1,
      padRows: 0,
      onChange: () => this.recomputeMatches(),
      keymap: this.keymap, // 同册注入（缺席 = 缺省册单测语义）
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
    // 头行：整行（前缀 + 会话短 id）拼好后经 fitLine 收口（viewer 族单源——
    // 窄窗裸直写 = 硬截断无省略号的漏网面）；短 id 段仍携会话区分色——前缀
    // 段裸写 + 其余段着色，两段合计即收口后整行
    const headPrefix = `${HEAD_MARKS.history} 历史回看 · `;
    const headLine = fitLine(`${headPrefix}${this.shortId}`, region.width);
    // 前缀与收口行的公共前缀长：常态 = 整前缀在场；极窄截进前缀域时前缀
    // 段即整行（着色段缺席——零写）
    const prefixLen = headLine.startsWith(headPrefix) ? headPrefix.length : headLine.length;
    buffer.writeText(region.row, region.col, headLine.slice(0, prefixLen));
    if (prefixLen < headLine.length) {
      // 短 id 起列 = 前缀显示宽（CJK 双宽——UTF-16 长度直减不可靠）
      buffer.writeText(region.row, region.col + prefixDisplayWidth(headLine, prefixLen), headLine.slice(prefixLen), {
        fg: sessionColor(this.shortId),
      });
    }
    if (this.searchOpen) {
      // 搜索计数（当前/总数；无匹配如实 0）——右对齐起列按显示宽算（CJK
      // 位数不误算）；窄窗守卫：计数区放不下（宽 < 计数宽 + 末列留白 1）
      // 干脆不写——负起列会被 CellGrid 静默吸收（首字符吞、余段左漂）致
      // 计数左移截断，不如不放
      const count = `${this.matchIndex + 1}/${this.matches.length}`;
      const countWidth = stringWidth(count);
      if (countWidth + 1 <= region.width) {
        const start = Math.max(region.col, region.col + region.width - 1 - countWidth);
        buffer.writeText(region.row, start, count, HINT_STYLE);
      }
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
      // 底行：超帽提示优先（常显至选区清除），否则常态键面提示——fitLine
      // 收口（viewer 族单源：提示行 ≈69 列窄窗裸直写即硬截断无省略号的
      // 漏网面）
      buffer.writeText(
        region.row + region.height - 1,
        region.col,
        fitLine(this.selectionNotice ?? HINT_TEXT, region.width),
        HINT_STYLE,
      );
    }
  }

  /**
   * 事件分发（副屏内容终局消费——未消费键不穿透，模态独占）。
   * 序：Ctrl+C / Ctrl+D 副屏键面补丁 → 搜索开关键 → 搜索在场模态（让位判据：
   * q/Esc 不退出）→ 常态退出键（q/Esc）→ 滚动键（ScrollView）。
   */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') return this.handleMouse(event); // mouse 路（终局消费——模态独占）
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
      }
      // enter 族含 alt 修饰（挖掘 26 轮 [3]）+ 册驱动确认键（挖掘 27 轮 [5]/[6]）：
      // 字面 Enter 族（!ctrl/!meta——alt/shift 组合全兼容，alt+enter 候跑习惯键
      // 与 shift 定向既有锁）或册内 submit/queue-followup 命中（改键面习惯提交键
      // ——修前字面拦截对改键盲视，穿透命中 handleSubmit 全清取文静默丢查询）
      // 同语义归并跳匹配
      if (k !== null && k.phase !== 'release') {
        const confirmHit =
          this.keymap.actionMatches(k, 'editor.submit') || this.keymap.actionMatches(k, 'editor.queue-followup');
        if (confirmHit || (k.key === 'enter' && !k.ctrl && !k.meta)) {
          this.jumpMatch(k.shift ? -1 : 1); // Enter/Alt+Enter 下一、Shift(+Alt)+Enter 上一
          return true;
        }
        // 其余换行键（出厂 ctrl+j / 改键形——非字面 enter）吞：单行框无换行
        // 语义（挖掘 27 轮 [5]：修前穿透插不可见 LF，查询被 LF 污染恒 0 匹配
        // 且已输文本滚出 1 行视口）
        if (this.keymap.actionMatches(k, 'editor.new-line')) {
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

  /* ---------------- 鼠标选区（mu-2——07 件 8 细则） ---------------- */

  /**
   * mouse 事件路（副屏内容件终局消费——未消费 mouse 不穿透，模态独占）：
   * 滚轮归 ScrollView（搜索在场也照常滚——禁的是拖选）；选区 = 左键 press
   * 锚定 → motion 扩展 → release 复制（release 后选区高亮保留，下次 press
   * 清除/重锚）。
   */
  private handleMouse(event: MouseEvent): boolean {
    if (event.button === 'wheel-up' || event.button === 'wheel-down') {
      this.handleEventSuper(event); // 滚轮消费路（±3 视觉行——显式滚动路）
      return true;
    }
    if (this.searchOpen) return true; // 搜索框在场拖选禁用（输入模态优先）——吞
    if (event.button !== 'left') return true; // v1 选区只有左键——中/右零动作吞
    if (event.phase === 'press') {
      // 新选区起手：旧选区与超帽提示随清（「常显至选区清除」的清除位）
      this.selectionNotice = null;
      const hit = this.screenToLogical(event.row, event.col);
      this.selAnchor = hit; // 视口外起手 = null（无锚——motion/release 零动作）
      this.selFocus = hit; // 零宽起手（拖动才扩）
      return true;
    }
    if (this.selAnchor === null) return true; // 无锚——motion/release 零动作
    if (event.phase === 'motion') {
      const hit = this.screenToLogical(event.row, event.col);
      if (hit !== null) this.selFocus = hit; // 拖出视口（头行/底铬/滚动条列）保焦点不扩
      return true;
    }
    // release：空选区零动作；超帽拒复制 + 底行提示；在帽行间拼 LF 经注入柄写出
    const text = this.selectionText();
    if (text.length === 0) return true;
    if (Buffer.byteLength(text, 'utf8') > SELECTION_CAP_BYTES) {
      this.selectionNotice = SELECTION_CAP_NOTICE;
      return true;
    }
    this.onCopy?.(text);
    return true;
  }

  /**
   * 屏幕坐标 → 选区定位点（逻辑行 + 行内 UTF-16 下标）：视口外命中（头行/
   * 底铬/滚动条列/界外）返 null 零动作；列反查走字素宽累加（与折叠算术同源
   * ——CJK 双宽对齐，命中字素含半格命中归该字素首）。
   */
  private screenToLogical(row: number, col: number): SelPoint | null {
    const geo = this.viewportGeometry;
    if (row < 1 || row >= 1 + geo.height) return null; // 头行 / 底铬（拖选仅在搜索不在场——底铬恒提示行 1 行）
    if (col < 0 || col >= geo.width) return null; // 界外防御位
    if (this.hitScrollbar(col)) return null; // 滚动条列（溢出让列时末列）零动作
    const seg = this.segmentAt(row - 1);
    if (seg === null) return null;
    const text = this.styledLines[seg.line]?.plain ?? '';
    let index = seg.startCol;
    let seen = 0;
    for (const g of splitGraphemes(text.slice(seg.startCol, seg.startCol + seg.length))) {
      if (seen + graphemeWidth(g) > col) break; // 命中字素（含双宽字素半格）归该字素首
      seen += graphemeWidth(g);
      index += g.length;
    }
    return { line: seg.line, col: index };
  }

  /** 选区规范化（锚/焦点 → 升序两端点；无选区 null） */
  private selectionBounds(): readonly [SelPoint, SelPoint] | null {
    if (this.selAnchor === null || this.selFocus === null) return null;
    const flip =
      this.selFocus.line < this.selAnchor.line ||
      (this.selFocus.line === this.selAnchor.line && this.selFocus.col < this.selAnchor.col);
    return flip ? [this.selFocus, this.selAnchor] : [this.selAnchor, this.selFocus];
  }

  /** 选区明文（行间拼 LF——release 复制与帽计量的单源；空选区空串） */
  private selectionText(): string {
    const bounds = this.selectionBounds();
    if (bounds === null) return '';
    const [from, to] = bounds;
    const parts: string[] = [];
    for (let line = from.line; line <= to.line; line++) {
      const plain = this.styledLines[line]?.plain ?? '';
      const start = line === from.line ? from.col : 0;
      const end = line === to.line ? to.col : plain.length;
      parts.push(plain.slice(start, end));
    }
    return parts.join('\n');
  }

  /**
   * 本逻辑行的选中区间（端点含头不含尾；end = Infinity 表行尾开放——跨行尾
   * 段；无选区/异行 null）。writeSlice 高亮与 selectionText 共用此规范化。
   */
  private selectionSpanFor(line: number): { start: number; end: number } | null {
    const bounds = this.selectionBounds();
    if (bounds === null) return null;
    const [from, to] = bounds;
    if (line < from.line || line > to.line) return null;
    return {
      start: line === from.line ? from.col : 0,
      end: line === to.line ? to.col : Number.POSITIVE_INFINITY,
    };
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

  /** 匹配重算（查询变更路）：全行不区分大小写子串扫描 + 跳首匹配（比对面 = 构造期预算小写副本——击键零重铸） */
  private recomputeMatches(): void {
    const query = this.searchEditor.getText();
    const found: MatchSpan[] = [];
    if (query !== '') {
      const q = lowercaseAligned(query);
      for (let i = 0; i < this.plainLowerLines.length; i++) {
        const plain = this.plainLowerLines[i]!;
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
    // 选区段（本切片所在逻辑行的选中区间——与当前匹配同 inverse 载体叠加）
    const sel = this.selectionSpanFor(seg.line);
    const selStart = sel !== null ? Math.max(sel.start, start) : end;
    const selEnd = sel !== null ? Math.min(sel.end, end) : start;
    // 分段边界：切片端点 ∪ 样式段端点 ∪ 高亮端点 ∪ 选区端点（升序去重）
    const cuts = new Set<number>([start, end]);
    for (const run of styled.runs) {
      if (run.start > start && run.start < end) cuts.add(run.start);
      if (run.end > start && run.end < end) cuts.add(run.end);
    }
    if (hlStart > start && hlStart < end) cuts.add(hlStart);
    if (hlEnd > start && hlEnd < end) cuts.add(hlEnd);
    if (selStart > start && selStart < end) cuts.add(selStart);
    if (selEnd > start && selEnd < end) cuts.add(selEnd);
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
      if (from >= selStart && from < selEnd) {
        // 选区高亮（与搜索匹配同 inverse 载体——叠加处同 inverse 幂等）
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
