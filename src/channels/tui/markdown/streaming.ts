/**
 * 流式 markdown 直推件（07 §4.1 呈现面件 1 R1 三段化——批 10h）。
 *
 * message_update 每帧全量换入 → 增量装配：parseMarkdown 重解析（行扫描
 * 便宜）+ MarkdownDoc.fromBlocks 块级缓存承接（append-only 前提下前缀块
 * 结构恒同——布局算术只跑尾块）。message_end 定稿换装走 MarkdownDoc 直
 * 构，不经本件。
 *
 * **稳定面判据（冻结提交粒度 = 块）**：除尾块外全稳定（后随块的开工即
 * 前块的终态——块序无法回插）；尾块终态判三形：
 * - 闭栏代码：高亮样式已定（闭栏才高亮），后续追加必为新块 → 稳定；
 * - 标题/列表项/引用/水平线 + 文本尾随换行：尾行已终，追加必为新块，
 *   既有行集不可变（引用追加行不改前行布局）→ 稳定；
 * - 段落（软折行回流）/ 表格（列宽回流）/ 开栏代码（闭栏样式回翻）→
 *   恒不稳定，冻结面止于其开行之前。
 */
import type { CellBuffer, Region, Renderable } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { blockEquals, parseMarkdown, type MarkdownBlock } from './blocks.js';
import { blockRows } from './block-rows.js';
import { MarkdownDoc } from './markdown.js';
import type { StyledGrapheme } from './layout.js';

/** 流式 markdown 状态件（文本件纪律：不可变快照链，换入即换代） */
export class StreamingMarkdown implements Renderable {
  private readonly theme: ResolvedTheme;
  /** 最近换入全文（null = 未起步；幂等短路判据） */
  private lastText: string | null = null;
  private doc: MarkdownDoc;
  /**
   * 渲染热路径 D2——逐块行数算术缓存：measure/stableLineCount 只消费行数，
   * 修前经 doc.prefixRows 全量装配行集再取 .length（O(行数) 引用摊销 + 空行
   * 分配每帧白算）；改为逐块行数缓存 + 算术求和（块间空行律同构：前缀已有
   * 行才补——零行块不改判据）。承接判据 = 宽键相同 + 块序 blockEquals 前缀
   * 全等（append-only 前提下前缀块结构恒同——与 MarkdownDoc 块级缓存同律）；
   * 分歧行起经 blockRows 重算行数（尾块布局与 doc 渲染腿各算一次——仅
   * tailSafe 尾块逐帧增长形〔引用块追加〕有此双算，量界 = 尾块）。
   */
  private countedWidth = -1;
  private countedBlocks: readonly MarkdownBlock[] = [];
  private countedCounts: number[] = [];

  constructor(theme: ResolvedTheme = DEFAULT_THEME) {
    this.theme = theme;
    this.doc = MarkdownDoc.fromBlocks([], null, theme);
  }

  /** 全量换入（append-only 前提——非追加形缓存自然失效，功能不损） */
  update(text: string): void {
    if (text === this.lastText) return;
    this.doc = MarkdownDoc.fromBlocks(parseMarkdown(text), this.doc, this.theme);
    this.lastText = text;
  }

  /** 最近全文（观测面——纯文本降档路径的渲染源） */
  get text(): string | null {
    return this.lastText;
  }

  /** 量高（Renderable——算术求和：Σ逐块行数 + 块间空行，与 doc.layout 同律） */
  measure(width: number): number {
    const counts = this.ensureBlockCounts(width);
    let total = 0;
    for (const count of counts) {
      if (total > 0) total += 1; // 块间空行（前缀已有行才补）
      total += count;
    }
    return total;
  }

  /** 落位渲染（Renderable——delegate 底座 doc） */
  render(buffer: CellBuffer, region: Region): void {
    this.doc.render(buffer, region);
  }

  /**
   * 全块装配行集（渲染热路径 D1——尾窗渲染的行源）：delegate doc.prefixRows
   * （块级缓存承接：稳定块直承旧行集引用，布局只跑尾块）。消费方自此走
   * 行集直转（docRowToStyledLine），不再经 CellGrid 往返整面转换。
   */
  rowsFor(width: number): StyledGrapheme[][] {
    return this.doc.prefixRows(width, this.doc.blockCount);
  }

  /** 稳定行数（冻结提交面——main-screen 超视口编舞的冻结额度计量） */
  stableLineCount(width: number): number {
    const blocks = this.doc.blocks;
    if (blocks.length === 0) return 0;
    const stableBlocks = blocks.length - 1 + (this.tailSafe(blocks[blocks.length - 1]!) ? 1 : 0);
    // D2：逐块行数算术求和——计数腿不装配行集；空行律与 prefixRows 同构
    //（前缀已有行才补——零行块〔空代码围栏〕不改判据，非 B-1 简形）
    const counts = this.ensureBlockCounts(width);
    let total = 0;
    for (let i = 0; i < stableBlocks; i++) {
      if (total > 0) total += 1;
      total += counts[i]!;
    }
    return total;
  }

  /** 尾块终态判（三形头注——回流/样式回翻形恒不稳） */
  private tailSafe(tail: MarkdownBlock): boolean {
    if (tail.type === 'code') return tail.open !== true; // 闭栏 = 高亮已定
    // 尾行未终（无换行收尾）——行内容仍可延伸，标题/列表/引用/横线全不稳
    if (this.lastText === null || !this.lastText.endsWith('\n')) return false;
    return tail.type === 'heading' || tail.type === 'list-item' || tail.type === 'quote' || tail.type === 'hr';
  }

  /**
   * 逐块行数缓存保位（D2）：换宽清账（防错位命中——与 MarkdownDoc.openWidth
   * 同律）；块序前缀 blockEquals 承接（append-only 前提下前缀结构恒同），
   * 分歧行起 blockRows 重算。与 doc 自身块级缓存分立（doc.parsed 私有面不可
   * 达）——稳定块双账皆直承零重算，仅 tailSafe 尾块增长形有双算（见字段注）。
   */
  private ensureBlockCounts(width: number): number[] {
    const blocks = this.doc.blocks;
    if (this.countedWidth !== width) {
      this.countedWidth = width;
      this.countedBlocks = [];
      this.countedCounts = [];
    }
    let carry = 0;
    const maxCarry = Math.min(this.countedBlocks.length, blocks.length);
    while (
      carry < maxCarry &&
      this.countedCounts[carry] !== undefined &&
      blockEquals(this.countedBlocks[carry]!, blocks[carry]!)
    ) {
      carry++;
    }
    if (carry === blocks.length && this.countedCounts.length === blocks.length) return this.countedCounts; // 全承快路（幂等帧零分配）
    const counts = this.countedCounts.slice(0, carry);
    for (let i = carry; i < blocks.length; i++) {
      // 行数键与 doc.blockLayout 同形（Math.max(1, width)——窄宽钳位同律）
      counts.push(blockRows(blocks[i]!, Math.max(1, width), this.theme).length);
    }
    this.countedBlocks = blocks;
    this.countedCounts = counts;
    return counts;
  }
}
