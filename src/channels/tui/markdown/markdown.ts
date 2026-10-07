/**
 * Markdown 渲染件（07 §4.1 引擎节件 6 + 呈现面件 1——批 10d-4；主题注入 +
 * (text,width) 块级缓存 批 10h）。
 *
 * - 两段语义（R1 批 10h 三段化后）：流式期 markdown 直推由 streaming 件承
 *   （本件为其 pending/committed 底座），message_end 定稿换装仍走本件；
 * - 主题键单源（ResolvedTheme 构造注入——codeInline/link/tableRule/高亮
 *   键族五键消费位；不触 accent：引擎节件 3 着色纪律，正文不混用）；
 * - 块级缓存：同宽 + 结构同块（blockEquals）直承旧行集——本件上一代
 *   （prevDoc）或结构比对双路命中，布局算术只跑增量块（流式件帧路径）；
 *   缓存基链深恒 1（fromBlocks 剪链——防流式换代全史可达的内存二次方）；
 * - 滚动帽语义 = 块数（呈现面件 1）——`blockCount` 即帽额度计数面；
 * - 折行按显示宽字素硬折（layout 件三规则——宽字不产半字、不悬挂）。
 */
import { graphemeWidth, type CellBuffer, type Region, type Renderable } from '../../engine/index.js';
import { blockEquals, blockGap, parseMarkdown, type MarkdownBlock } from './blocks.js';
import { blockRows } from './block-rows.js';
import type { StyledGrapheme } from './layout.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/** 构造入参（theme 缺省 = DEFAULT_THEME——消费位：thinking 块展开体行 view.theme〔主会话装配 tui-backend theme: this.theme 链〕） */
interface DocOptions {
  readonly theme?: ResolvedTheme;
}

/** Markdown 渲染件：构造后静态不可变（文本件纪律——状态归持有方自管） */
export class MarkdownDoc implements Renderable {
  /* parsed 构造期两路赋值（文本解析 / fromBlocks 直入）故去 readonly——
     构造后不再变（类内纪律）。 */
  private parsed: MarkdownBlock[];
  private readonly theme: ResolvedTheme;
  /** 增量缓存基（fromBlocks 传入的上一代——同宽同构块直承；只保一代：
   *  fromBlocks 构造期对 prev 的一次性退役写见其剪链注） */
  private prevDoc: MarkdownDoc | null = null;
  /** 块级布局缓存（width 键——逐块存，块间空行装配期并入；换宽清） */
  private cacheWidth = -1;
  private cacheBlockRows: (StyledGrapheme[][] | undefined)[] = [];
  private cacheAssembled: StyledGrapheme[][] | null = null;

  constructor(text: string, options?: DocOptions) {
    this.parsed = parseMarkdown(text);
    this.theme = options?.theme ?? DEFAULT_THEME;
  }

  /** 便捷构造（换装装配点直呼） */
  static of(text: string, theme?: ResolvedTheme): MarkdownDoc {
    return new MarkdownDoc(text, theme === undefined ? undefined : { theme });
  }

  /**
   * 增量装配（流式件消费）：块序列直入（不经文本再解析）+ 旧件为缓存基。
   * 同宽时结构同块（blockEquals）直承旧行——布局算术只跑增量块。
   */
  static fromBlocks(blocks: readonly MarkdownBlock[], prev?: MarkdownDoc | null, theme?: ResolvedTheme): MarkdownDoc {
    const doc = new MarkdownDoc('', theme === undefined ? undefined : { theme });
    doc.parsed = [...blocks];
    doc.prevDoc = prev ?? null;
    // 剪链保深度 1（内存二次方剪除）：承接只读一代——blockLayout 仅读 prev
    // 自有缓存（一层，不溯祖），且继承行集经本件 openWidth 先行必转存自有
    // 缓存（归纳：每代被布局后自有缓存即全量），祖代链再无读者。流式每帧
    // 全量新块 + 换入即换代，无界链 = 全史代可达（每代全量块 + 布局缓存）
    // → 长消息内存二次方。此为 fromBlocks 构造期对 prev 的一次性退役写
    // （旧代此后只作新代缓存基、不再被布局），不违「构造后静态不可变」的
    // 持有方语义；换宽重算不溯祖（openWidth 清账后本件直算）。
    if (doc.prevDoc !== null) doc.prevDoc.prevDoc = null;
    return doc;
  }

  /** 块序列（只读观测面） */
  get blocks(): readonly MarkdownBlock[] {
    return this.parsed;
  }

  /** 块计数——主屏滚动帽的额度单位（呈现面件 1：一个 Markdown 块一子行） */
  get blockCount(): number {
    return this.parsed.length;
  }

  /** 量高：全块行数 + 块间空行（n-1 段间距——量高即分配承诺） */
  measure(width: number): number {
    return this.layout(width).length;
  }

  /** 前缀行集（流式稳定面计量——首 k 块的装配行集，块间空距同律） */
  prefixRows(width: number, blockCount: number): StyledGrapheme[][] {
    this.openWidth(width); // 帧路径缓存键先开（稳定块布局一次即存）
    const clamped = Math.min(blockCount, this.parsed.length);
    const rows: StyledGrapheme[][] = [];
    for (let i = 0; i < clamped; i++) {
      // 块间空距（blockGap 单源——紧凑列表零空距；前缀已有行才补）
      if (rows.length > 0 && blockGap(this.parsed[i - 1]!, this.parsed[i]!) === 1) rows.push([]);
      rows.push(...this.blockLayout(i, width));
    }
    return rows;
  }

  /** 落位渲染：缓存行集逐行写（相邻同样式游程合并 writeText——省格级调用） */
  render(buffer: CellBuffer, region: Region): void {
    const rows = this.layout(region.width);
    const max = Math.min(rows.length, region.height);
    for (let r = 0; r < max; r++) {
      let col = region.col;
      let run = '';
      let runStyle: StyledGrapheme['style'] = undefined;
      // 游程起点显式跟踪（宽字素占两格——run 码位数算不出格位）
      let runStart = region.col;
      const flush = (): void => {
        if (run !== '') buffer.writeText(region.row + r, runStart, run, runStyle);
      };
      for (const cell of rows[r]!) {
        if (cell.style !== runStyle) {
          flush();
          run = cell.grapheme;
          runStyle = cell.style;
          runStart = col;
        } else {
          run += cell.grapheme;
        }
        col += graphemeWidth(cell.grapheme); // 按显示宽推进（宽字素两格）
      }
      flush();
    }
  }

  /** 单块布局（双路命中：本件缓存 / prevDoc 同宽同构承接） */
  private blockLayout(index: number, width: number): StyledGrapheme[][] {
    if (this.cacheWidth === width) {
      const hit = this.cacheBlockRows[index];
      if (hit !== undefined) return hit;
    }
    const prev = this.prevDoc;
    if (prev !== null && prev.cacheWidth === width && index < prev.parsed.length) {
      const prevBlock = prev.parsed[index]!;
      if (blockEquals(prevBlock, this.parsed[index]!) && prev.cacheBlockRows[index] !== undefined) {
        const rows = prev.cacheBlockRows[index]!;
        if (this.cacheWidth === width) this.cacheBlockRows[index] = rows;
        return rows;
      }
    }
    const rows = blockRows(this.parsed[index]!, Math.max(1, width), this.theme);
    if (this.cacheWidth === width) this.cacheBlockRows[index] = rows;
    return rows;
  }

  /** 全量装配（width 键缓存——块间空距并入行集，render 与 measure 同源） */
  private layout(width: number): StyledGrapheme[][] {
    if (this.cacheWidth === width && this.cacheAssembled !== null) return this.cacheAssembled;
    this.openWidth(width);
    const rows: StyledGrapheme[][] = [];
    for (let i = 0; i < this.parsed.length; i++) {
      // 块间空距（blockGap 单源——紧凑列表零空距；前缀已有行才补）
      if (rows.length > 0 && blockGap(this.parsed[i - 1]!, this.parsed[i]!) === 1) rows.push([]);
      rows.push(...this.blockLayout(i, width));
    }
    this.cacheAssembled = rows;
    return rows;
  }

  /** 缓存键开位（换宽清陈旧行集——防错位命中；prefixRows/layout 共用） */
  private openWidth(width: number): void {
    if (this.cacheWidth === width) return;
    this.cacheBlockRows = [];
    this.cacheAssembled = null;
    this.cacheWidth = width;
  }
}
