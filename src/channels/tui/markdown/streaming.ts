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
import { parseMarkdown, type MarkdownBlock } from './blocks.js';
import { MarkdownDoc } from './markdown.js';

/** 流式 markdown 状态件（文本件纪律：不可变快照链，换入即换代） */
export class StreamingMarkdown implements Renderable {
  private readonly theme: ResolvedTheme;
  /** 最近换入全文（null = 未起步；幂等短路判据） */
  private lastText: string | null = null;
  private doc: MarkdownDoc;

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

  /** 量高（Renderable——与定稿件同接口，装配面零分叉） */
  measure(width: number): number {
    return this.doc.measure(width);
  }

  /** 落位渲染（Renderable——delegate 底座 doc） */
  render(buffer: CellBuffer, region: Region): void {
    this.doc.render(buffer, region);
  }

  /** 稳定行数（冻结提交面——main-screen 超视口编舞的冻结额度计量） */
  stableLineCount(width: number): number {
    const blocks = this.doc.blocks;
    if (blocks.length === 0) return 0;
    const stableBlocks = blocks.length - 1 + (this.tailSafe(blocks[blocks.length - 1]!) ? 1 : 0);
    return this.doc.prefixRows(width, stableBlocks).length;
  }

  /** 尾块终态判（三形头注——回流/样式回翻形恒不稳） */
  private tailSafe(tail: MarkdownBlock): boolean {
    if (tail.type === 'code') return tail.open !== true; // 闭栏 = 高亮已定
    // 尾行未终（无换行收尾）——行内容仍可延伸，标题/列表/引用/横线全不稳
    if (this.lastText === null || !this.lastText.endsWith('\n')) return false;
    return tail.type === 'heading' || tail.type === 'list-item' || tail.type === 'quote' || tail.type === 'hr';
  }
}
