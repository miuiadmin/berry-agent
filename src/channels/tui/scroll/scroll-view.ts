/**
 * 滚动视口件（07 §4.1 呈现面件 6）：行集 + 视口窗口化 + 键盘滚动 + 滚动条按需显隐。
 *
 * - 内容溢出视口才显滚动条（承 pi-tui `scrollbar:'auto'` 语义）：先按全宽折
 *   视觉行判溢出，溢出则让出一列重折 + 画 thumb（两遍折叠换「按需占列」的
 *   布局自洽——折宽分槽缓存，帧间零重折）；
 * - follow 尾随模式（初始 true——回看器开屏显尾）：内容更替贴尾；上滚破随；
 *   再滚到底复随（判据：偏移到达 maxOffset）；
 * - 键盘滚动 ↑/↓ 单行、PgUp/PgDn 翻页、Home/End 到首尾（press/repeat 动作、
 *   release 归上层）；滚轮随鼠标解码批接入；
 * - 滚动条渐隐计时随组件批定形（07 挂账）——v1 溢出期间常显。
 */
import type { CellBuffer, CellStyle, InputEvent, Region, Renderable } from '../../engine/index.js';
import { buildVisualLineMap, type VisualSegment } from '../editor/visual-lines.js';

/** 滚动条 thumb 样式（dim——存在感弱于正文） */
const SCROLLBAR_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** 滚动条 thumb 字符 */
const THUMB = '┃';

/** 未渲染过时的防御缺省（render 后由实测回写） */
const DEFAULT_WIDTH = 80;
const DEFAULT_PAGE_SIZE = 10;

/** 单步滚动键位表（无修饰——ctrl/meta/shift 组合归上层） */
const SCROLL_ACTIONS: Readonly<
  Record<string, 'line-up' | 'line-down' | 'page-up' | 'page-down' | 'to-top' | 'to-bottom'>
> = Object.freeze({
  up: 'line-up',
  down: 'line-down',
  pageup: 'page-up',
  pagedown: 'page-down',
  home: 'to-top',
  end: 'to-bottom',
});

/** 滚动动作类型 */
type ScrollAction = (typeof SCROLL_ACTIONS)[string];

/** 滚动视口选项 */
export interface ScrollViewOptions {
  /** 量高帽（嵌入 Flex 布局时限制分配；缺省全量——副屏 root 直收全屏 region） */
  readonly maxHeight?: number;
}

/**
 * 滚动视口：逻辑行集为数据源，字素硬折视觉行（复用 editor 基件折行算术），
 * 自持视口偏移与尾随态。
 */
export class ScrollView implements Renderable {
  private lines: string[] = [];
  /** 折叠缓存（行集引用失效 + 折宽分槽——同一行集多折宽并存零抖动） */
  private cacheLines: string[] | null = null;
  private cacheMaps = new Map<number, VisualSegment[]>();
  /** 视口首行（视觉行下标） */
  private offset = 0;
  /** 尾随模式（true = 内容更替贴尾） */
  private follow = true;
  /** 折宽与视口高实测（render / measure 回写——显式滚动的即时夹取依据） */
  private lastWidth = DEFAULT_WIDTH;
  private viewportHeight = DEFAULT_PAGE_SIZE;
  /** 量高帽（嵌入 Flex 布局时限制分配；缺省全量——副屏 root 直收全屏 region） */
  private readonly maxHeight: number | undefined;
  /** 滚动通知（装配层接重绘请求） */
  onScroll?: () => void;

  constructor(options: ScrollViewOptions = {}) {
    this.maxHeight = options.maxHeight;
  }

  /* ---------------- 数据面 ---------------- */

  /** 行集整体替换（回看器快照档——新事件不追加、整档重设） */
  setLines(lines: string[]): void {
    this.lines = lines;
    this.cacheLines = null; // 缓存失效（引用比对落空即整缓存弃）
    if (this.follow) {
      this.offset = Number.MAX_SAFE_INTEGER; // 尾随贴尾
      this.clampNow(); // 即时夹到视觉底
    }
  }

  /* ---------------- 滚动控制面 ---------------- */

  /** 绝对滚动（视觉行下标——越界即时夹取） */
  scrollTo(viewportRow: number): void {
    this.applyOffset(viewportRow);
  }

  /** 相对滚动（负向上 / 正向下；0 无动作） */
  scrollBy(delta: number): void {
    if (delta !== 0) this.applyOffset(this.offset + delta);
  }

  /** 滚到顶部（破随） */
  scrollToTop(): void {
    this.applyOffset(0);
  }

  /** 滚到底部（复随） */
  scrollToEnd(): void {
    this.applyOffset(Number.MAX_SAFE_INTEGER);
  }

  /** 视口首行（夹取后的观测值） */
  get scrollOffset(): number {
    return this.offset;
  }

  /** 尾随态（回看器判断是否在追新） */
  get isFollowing(): boolean {
    return this.follow;
  }

  /* ---------------- 渲染协商 ---------------- */

  /** 量高：视觉行数夹 maxHeight（缺省全量——副屏 root 场景不经本路） */
  measure(width: number): number {
    this.lastWidth = width;
    const map = this.visualMap(width, false);
    const cap = this.maxHeight ?? map.length;
    if (map.length <= cap) return map.length;
    // 溢出预判：滚动条让列重折后行数只多不少——以折后行数夹帽（量高即承诺，不超卖）
    return Math.min(this.visualMap(width, true).length, cap);
  }

  /** 落位渲染：折行判溢出 → 夹取自愈 → 正文 → 滚动条（溢出才显） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.width <= 1 || region.height <= 0) return; // 一列给内容都不够——防御位
    this.lastWidth = region.width;
    this.viewportHeight = region.height;
    // 两遍折叠：全宽判溢出 → 溢出让一列重折（分槽缓存免抖动）
    let map = this.visualMap(region.width, false);
    const reservesBar = map.length > region.height;
    if (reservesBar) map = this.visualMap(region.width, true);
    this.clampOffset(map, region.height);
    // 正文（视口内视觉行——UTF-16 切片直写，宽字素由缓冲铺续格）
    const lines = this.lines;
    const end = Math.min(map.length, this.offset + region.height);
    for (let vi = this.offset; vi < end; vi++) {
      const seg = map[vi]!;
      const line = lines[seg.line] ?? '';
      buffer.writeText(
        region.row + (vi - this.offset),
        region.col,
        line.slice(seg.startCol, seg.startCol + seg.length),
      );
    }
    // 滚动条（溢出才显——右列 thumb 段按比例）
    if (reservesBar) this.drawScrollbar(buffer, region, map.length);
  }

  /* ---------------- 输入事件 ---------------- */

  /** 键盘滚动：仅 key 事件（其余归上层）；无修饰才触发 */
  handleEvent(event: InputEvent): boolean {
    if (event.kind !== 'key') return false;
    if (event.phase === 'release') return false;
    if (event.ctrl || event.alt || event.shift || event.meta) return false;
    const action: ScrollAction | undefined = SCROLL_ACTIONS[event.key];
    if (action === undefined) return false;
    switch (action) {
      case 'line-up':
        this.scrollBy(-1);
        break;
      case 'line-down':
        this.scrollBy(1);
        break;
      case 'page-up':
        this.scrollBy(-this.viewportHeight);
        break;
      case 'page-down':
        this.scrollBy(this.viewportHeight);
        break;
      case 'to-top':
        this.scrollToTop();
        break;
      case 'to-bottom':
        this.scrollToEnd();
        break;
    }
    return true;
  }

  /* ---------------- 内部算术 ---------------- */

  /** 折叠缓存取（行集引用 + 折宽双键——分槽并存） */
  private visualMap(width: number, reserveBar: boolean): VisualSegment[] {
    const foldWidth = Math.max(1, width - (reserveBar ? 1 : 0));
    if (this.cacheLines !== this.lines) {
      this.cacheLines = this.lines;
      this.cacheMaps.clear();
    }
    let map = this.cacheMaps.get(foldWidth);
    if (map === undefined) {
      map = buildVisualLineMap(this.lines, foldWidth);
      this.cacheMaps.set(foldWidth, map);
    }
    return map;
  }

  /** 以已知折宽即时夹取（显式滚动 / 尾随贴尾的收口路——渲染后缓存命中零成本） */
  private clampNow(): void {
    const map = this.visualMap(this.lastWidth, false);
    this.clampOffset(map, this.viewportHeight);
  }

  /** 偏移夹取（内容短于视口归零）+ 复随判据（到底即复随；破随只在显式滚动） */
  private clampOffset(map: VisualSegment[], viewportHeight: number): void {
    const maxOffset = Math.max(0, map.length - viewportHeight);
    this.offset = Math.min(Math.max(0, this.offset), maxOffset);
    if (this.offset >= maxOffset) this.follow = true;
  }

  /** 显式滚动统一路（先破随后即时夹取——夹到底自然复随） */
  private applyOffset(next: number): void {
    this.follow = false;
    this.offset = Math.max(0, next);
    this.clampNow();
    this.onScroll?.();
  }

  /** 滚动条：右列 thumb 段（size 按比例、start 按偏移比例） */
  private drawScrollbar(buffer: CellBuffer, region: Region, totalLines: number): void {
    const h = region.height;
    const maxOffset = Math.max(0, totalLines - h);
    if (maxOffset === 0) return; // 防御位（溢出判据已排除——双保险）
    const thumbSize = Math.max(1, Math.floor((h * h) / totalLines));
    const thumbStart = Math.round((this.offset / maxOffset) * (h - thumbSize));
    const col = region.col + region.width - 1;
    for (let r = 0; r < thumbSize; r++) {
      buffer.setCell(region.row + thumbStart + r, col, THUMB, SCROLLBAR_STYLE);
    }
  }
}
