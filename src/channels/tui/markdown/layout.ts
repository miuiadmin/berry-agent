/**
 * Markdown 折行布局件（批 10h 自 markdown.ts 拆出——布局算术单源）。
 *
 * 字素级折行三规则承 width 件：宽字不产半字、不悬挂、行满开新行；折点后
 * 行首空格游程跳过。样式随字素携带（样式段跨折行保持）；相邻同样式游程
 * 由渲染位合并。
 *
 * 2026-09-20 TUI 修复组 1 批同律增两件（与 width 件 wrapText 同律单源）：
 * - CJK 折行禁则（kinsoku）——折点行首禁则回送/行尾禁则推下，判据单源
 *   消费 width 件 isLineStartProhibited / isLineEndProhibited（字集不在此
 *   重复定义）；
 * - 控制字符消毒——段文本先经 sanitizeDisplayText（tab 展开 2 空格 / CR 与
 *   ESC 序列剥除）再折行，残余 LF 跳过（行模型拆分归调用方）。
 */
// 禁则谓词与消毒经 engine 聚合面（index）消费——TUI 第四役残腿收纳
// （批内注释例注撤除：聚合面已收录，子目录直达形不复存在）
import {
  graphemeWidth,
  isLineEndProhibited,
  isLineStartProhibited,
  sanitizeDisplayText,
  splitGraphemes,
} from '../../engine/index.js';
import type { CellStyle } from '../../engine/index.js';
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

/**
 * 样式段序列按显示宽折行（行满开新行；折点后行首空格游程跳过；
 * CJK 禁则回送携样式下移；段文本先消毒——tab 展开 / 控制字剥除）。
 */
export function layoutParts(parts: readonly StylePart[], width: number): StyledGrapheme[][] {
  const rows: StyledGrapheme[][] = [];
  let current: StyledGrapheme[] = [];
  let used = 0;
  const openRow = (): void => {
    current = [];
    used = 0;
  };
  for (const part of parts) {
    // 段文本源头消毒（单源 sanitizeDisplayText——tab 展开 2 空格 / CR 与 ESC 序列剥除）
    for (const g of splitGraphemes(sanitizeDisplayText(part.text))) {
      if (g === '\n') continue; // 残余 LF 跳过（多行拆分归行模型——布局只在行内折）
      if (g === ' ' && used === 0 && rows.length > 0) continue; // 折点后行首空格跳过
      const w = graphemeWidth(g);
      if (w > width) continue; // 防御位：比行宽还宽的字素丢弃（width 件三规则外的不可能格）
      if (used + w > width) {
        // 折点恰为空格：收行不转行（空格不占新行行首）
        if (g === ' ') {
          rows.push(current);
          openRow();
          continue;
        }
        // CJK 禁则回送（与 wrapText 同律）：行首禁则（折点后字素不可起行）与
        // 行尾禁则（当行末字素不可收行）同一操作——当行末字素弹出携下移
        //（样式随图素原样携带）；回送后新行 [carry…+g] 越帽即放弃硬断
        const carry: StyledGrapheme[] = [];
        let carryWidth = 0;
        while (current.length > 0) {
          const nextFirst = carry.length > 0 ? carry[0]!.grapheme : g; // 新行行首候选
          const currentLast = current[current.length - 1]!; // 当行行末候选
          if (!isLineStartProhibited(nextFirst) && !isLineEndProhibited(currentLast.grapheme)) break;
          const head = currentLast;
          const headW = graphemeWidth(head.grapheme);
          if (carryWidth + headW + w > width) break; // 回送无解——放弃硬断（原折点保持）
          current.pop();
          used -= headW;
          carry.unshift(head);
          carryWidth += headW;
        }
        rows.push(current);
        openRow();
        for (const c of carry) {
          current.push(c); // 回送图素回填新行头（宽度账同步）
          used += graphemeWidth(c.grapheme);
        }
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
