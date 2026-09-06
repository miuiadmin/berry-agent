/**
 * Markdown 渲染件（07 §4.1 引擎节件 6 + 呈现面件 1——批 10d-4）。
 *
 * - 两段语义的「定稿」腿：流式期纯文本直推（装配策略，批 10e 接）、
 *   message_end 定稿换装本件（流式槽原位差分的换入对象）；
 * - 内置中性 ANSI 配色、不接语法高亮库：行内代码 ANSI 6（cyan）、引用
 *   dim、标题 bold、链接 underline——**不触 accent**（引擎节件 3 着色纪律：
 *   accent 只用于焦点指示面，正文不混用）；
 * - 滚动帽语义 = 块数（呈现面件 1）——`blockCount` 即帽额度计数面；
 * - 折行按显示宽字素硬折（复用 width 件三规则——宽字不产半字、不悬挂）；
 *   折点后的行首空格游程跳过（软换行折叠的呈现收口）。
 */
import {
  ansiColor,
  graphemeWidth,
  splitGraphemes,
  type AnsiColor,
  type CellBuffer,
  type CellStyle,
  type Region,
  type Renderable,
} from '../../engine/index.js';
import { parseMarkdown, type MarkdownBlock } from './blocks.js';
import type { InlineSpan } from './inline.js';

/** 行内代码配色（ANSI 2 绿——终端代码传统色；与 accent〔cyan 6〕分立，正文不触 accent 家族） */
const CODE_COLOR = ansiColor(2);
/** 引用块基础样式（dim——存在感弱于正文） */
const DIM_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** 单字素 + 样式（折行布局的原子单位——样式跨折行保持） */
interface StyledGrapheme {
  readonly grapheme: string;
  readonly style: Readonly<CellStyle> | undefined;
}

/** span 样式解析（与块基础样式合并——行内位覆盖 base 的同名位） */
function spanStyle(span: InlineSpan, base: Readonly<CellStyle> | undefined): Readonly<CellStyle> | undefined {
  const style: { fg?: AnsiColor; bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean } =
    base !== undefined ? { ...base } : {};
  if (span.code === true) style.fg = CODE_COLOR;
  if (span.bold === true) style.bold = true;
  if (span.italic === true) style.italic = true;
  if (span.underline === true) style.underline = true;
  return Object.keys(style).length > 0 ? Object.freeze(style) : undefined;
}

/** spans 按显示宽折行（行满开新行；折点后行首空格游程跳过） */
function layoutSpans(spans: readonly InlineSpan[], width: number, base?: Readonly<CellStyle>): StyledGrapheme[][] {
  const rows: StyledGrapheme[][] = [];
  let current: StyledGrapheme[] = [];
  let used = 0;
  const openRow = (): void => {
    current = [];
    used = 0;
  };
  for (const span of spans) {
    const style = spanStyle(span, base);
    for (const g of splitGraphemes(span.text)) {
      if (g === ' ' && used === 0 && rows.length > 0) continue; // 折点后行首空格跳过
      const w = graphemeWidth(g);
      if (w > width) continue; // 防御位：比行宽还宽的字素丢弃（width 件三规则外的不可能格）
      if (used + w > width) {
        rows.push(current);
        openRow();
        if (g === ' ') continue; // 恰在折点上的空格不进新行
      }
      current.push({ grapheme: g, style });
      used += w;
    }
  }
  if (current.length > 0 || rows.length === 0) rows.push(current); // 尾行收口（空段落落一行空行）
  return rows;
}

/** 纯文本行折行（代码块体——无行内解析，样式恒定整体替换） */
function layoutPlain(text: string, width: number, style?: Readonly<CellStyle>): StyledGrapheme[][] {
  return layoutSpans([{ text }], width).map((row) => row.map((cell) => ({ grapheme: cell.grapheme, style })));
}

/** 前缀串 → 字素列（列表标记/引用竖线等固定前缀） */
function prefixCells(prefix: string, style?: Readonly<CellStyle>): StyledGrapheme[] {
  return splitGraphemes(prefix).map((grapheme) => ({ grapheme, style }));
}

/** 单块布局 → 渲染行集（块型分派；行首前缀 + 折行 + 层级缩进） */
function blockRows(block: MarkdownBlock, width: number): StyledGrapheme[][] {
  switch (block.type) {
    case 'heading': {
      // 标题：整行强制 bold（行内样式位叠加保留——code 色不丢）；H1/H2 尾随分隔线
      const rows = layoutSpans(block.spans, width, { bold: true });
      if (block.level <= 2) {
        rows.push(splitGraphemes('─'.repeat(width)).map((grapheme) => ({ grapheme, style: DIM_STYLE })));
      }
      return rows;
    }
    case 'paragraph':
      return layoutSpans(block.spans, width);
    case 'list-item': {
      // 前缀 = 嵌套缩进 + 标记 + 空格；续行对齐前缀宽（视觉续挂）
      const prefix = `${'  '.repeat(block.indent)}${block.marker} `;
      const prefixWidth = splitGraphemes(prefix).reduce((sum, g) => sum + graphemeWidth(g), 0);
      const body = layoutSpans(block.spans, Math.max(1, width - prefixWidth));
      return body.map((row, index) => [
        ...(index === 0 ? prefixCells(prefix) : prefixCells(' '.repeat(prefixWidth))),
        ...row,
      ]);
    }
    case 'code': {
      // 代码块：竖线前缀贯通（含折行续行）+ 原样文本（无行内解析）
      const bodyWidth = Math.max(1, width - 2);
      const rows: StyledGrapheme[][] = [];
      for (const line of block.lines) rows.push(...layoutPlain(line, bodyWidth));
      return rows.map((row) => [...prefixCells('│ '), ...row]);
    }
    case 'quote': {
      // 引用：首列竖线 + dim 基础样式（行内样式位叠加）
      const rows: StyledGrapheme[][] = [];
      for (const line of block.lines) rows.push(...layoutSpans(line, Math.max(1, width - 2), DIM_STYLE));
      return rows.map((row) => [...prefixCells('┆ ', DIM_STYLE), ...row]);
    }
    case 'hr':
      return [splitGraphemes('─'.repeat(width)).map((grapheme) => ({ grapheme, style: DIM_STYLE }))];
  }
}

/** Markdown 渲染件：构造后静态不可变（文本件纪律——状态归持有方自管） */
export class MarkdownDoc implements Renderable {
  private readonly parsed: MarkdownBlock[];
  /** 布局缓存（width 单槽——文本不可变，换宽整体重算） */
  private cacheWidth = -1;
  private cacheRows: StyledGrapheme[][] = [];

  constructor(text: string) {
    this.parsed = parseMarkdown(text);
  }

  /** 便捷构造（换装装配点直呼） */
  static of(text: string): MarkdownDoc {
    return new MarkdownDoc(text);
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
    const rows = this.layout(width);
    return rows.length;
  }

  /** 落位渲染：缓存行集逐行写（相邻同样式游程合并 writeText——省格级调用） */
  render(buffer: CellBuffer, region: Region): void {
    const rows = this.layout(region.width);
    const max = Math.min(rows.length, region.height);
    for (let r = 0; r < max; r++) {
      let col = region.col;
      let run = '';
      let runStyle: Readonly<CellStyle> | undefined;
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

  /** 布局（width 键缓存——块间空行并入行集，render 与 measure 同源） */
  private layout(width: number): StyledGrapheme[][] {
    if (this.cacheWidth === width) return this.cacheRows;
    const rows: StyledGrapheme[][] = [];
    for (const block of this.parsed) {
      if (rows.length > 0) rows.push([]); // 块间空行
      rows.push(...blockRows(block, Math.max(1, width)));
    }
    this.cacheWidth = width;
    this.cacheRows = rows;
    return rows;
  }
}
