/**
 * Markdown 折行布局件（批 10h 自 markdown.ts 拆出——布局算术单源）。
 *
 * 字素级折行三规则承 width 件：宽字不产半字、不悬挂、行满开新行；折点后
 * 行首空格游程跳过。样式随字素携带（样式段跨折行保持）；相邻同样式游程
 * 由渲染位合并。
 */
import { graphemeWidth, splitGraphemes, type CellStyle } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import type { InlineSpan } from './inline.js';

/** 单字素 + 样式（折行布局的原子单位——样式跨折行保持） */
export interface StyledGrapheme {
  readonly grapheme: string;
  readonly style: Readonly<CellStyle> | undefined;
}

/** 直携样式的文本段（layoutParts 入参——代码高亮 token 流同形消费） */
export interface StylePart {
  readonly text: string;
  readonly style: Readonly<CellStyle> | undefined;
}

/** 引用块基础样式（dim——存在感弱于正文） */
export const DIM_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** span 样式解析（与块基础样式合并——行内位覆盖 base 的同名位；主题键单源） */
export function spanStyle(
  span: InlineSpan,
  base: Readonly<CellStyle> | undefined,
  theme: Readonly<ResolvedTheme>,
): Readonly<CellStyle> | undefined {
  // 可变工作副本（CellStyle readonly——spread 保型不可写，本地可变形中转）
  const style: { -readonly [K in keyof CellStyle]: CellStyle[K] } = base !== undefined ? { ...base } : {};
  if (span.code === true) style.fg = theme.codeInline;
  else if (span.underline === true) style.fg = theme.link; // underline 位唯一产地 = 行内链接
  if (span.bold === true) style.bold = true;
  if (span.italic === true) style.italic = true;
  if (span.underline === true) style.underline = true;
  return Object.keys(style).length > 0 ? Object.freeze(style) : undefined;
}

/** 样式段序列按显示宽折行（行满开新行；折点后行首空格游程跳过） */
export function layoutParts(parts: readonly StylePart[], width: number): StyledGrapheme[][] {
  const rows: StyledGrapheme[][] = [];
  let current: StyledGrapheme[] = [];
  let used = 0;
  const openRow = (): void => {
    current = [];
    used = 0;
  };
  for (const part of parts) {
    for (const g of splitGraphemes(part.text)) {
      if (g === ' ' && used === 0 && rows.length > 0) continue; // 折点后行首空格跳过
      const w = graphemeWidth(g);
      if (w > width) continue; // 防御位：比行宽还宽的字素丢弃（width 件三规则外的不可能格）
      if (used + w > width) {
        rows.push(current);
        openRow();
        if (g === ' ') continue; // 恰在折点上的空格不进新行
      }
      current.push({ grapheme: g, style: part.style });
      used += w;
    }
  }
  if (current.length > 0 || rows.length === 0) rows.push(current); // 尾行收口（空段落落一行空行）
  return rows;
}

/** 行内 span 序列折行（spanStyle 解析后归 layoutParts） */
export function layoutSpans(
  spans: readonly InlineSpan[],
  width: number,
  theme: Readonly<ResolvedTheme>,
  base?: Readonly<CellStyle>,
): StyledGrapheme[][] {
  return layoutParts(
    spans.map((span) => ({ text: span.text, style: spanStyle(span, base, theme) })),
    width,
  );
}

/** 纯文本行折行（恒定样式整体替换——开栏代码退单色路径同用） */
export function layoutPlain(text: string, width: number, style?: Readonly<CellStyle>): StyledGrapheme[][] {
  return layoutParts([{ text, style }], width);
}

/** 前缀串 → 字素列（列表标记/引用竖线/表格框线等固定前缀） */
export function prefixCells(prefix: string, style?: Readonly<CellStyle>): StyledGrapheme[] {
  return splitGraphemes(prefix).map((grapheme) => ({ grapheme, style }));
}

/** 行显示宽（折行算术复用——字素宽求和） */
export function rowWidth(row: readonly StyledGrapheme[]): number {
  return row.reduce((sum, cell) => sum + graphemeWidth(cell.grapheme), 0);
}

/** span 序列自然宽（表格列宽测量——不折行前提下的整格宽） */
export function spansWidth(spans: readonly InlineSpan[]): number {
  let sum = 0;
  for (const span of spans) for (const g of splitGraphemes(span.text)) sum += graphemeWidth(g);
  return sum;
}
