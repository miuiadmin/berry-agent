/**
 * Markdown 块解析件（07 §4.1 引擎节件 6——批 10d-4）。
 *
 * 块模型 = 滚动帽单位（呈现面件 1：一个 Markdown 块一子行——blockCount
 * 即帽额度计数）。v1 支持面（CommonMark 子集，边界注释在案）：
 * 标题 #..######、段落（段内软换行折叠为空格——标准语义）、无序/有序
 * 列表（嵌套缩进 2 空格一层）、围栏代码块（```/~~~）、引用（>，连续行
 * 归块）、水平线（三连 - 或 * 或 _）。缩进四空格代码块、表格、脚注不
 * 支撑（未列形按段落回退——坏输入不丢字）。
 */
import { parseInline, type InlineSpan } from './inline.js';

/** Markdown 块（代数和：块型各携自身载荷；spans 已行内解析） */
export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: number; readonly spans: InlineSpan[] }
  | { readonly type: 'paragraph'; readonly spans: InlineSpan[] }
  | {
      readonly type: 'list-item';
      readonly ordered: boolean;
      /** 序号/圆点呈现（无序 '•'、有序原样如 '1.'） */
      readonly marker: string;
      /** 嵌套层级（前导空格 / 2，向下取整） */
      readonly indent: number;
      readonly spans: InlineSpan[];
    }
  | { readonly type: 'code'; readonly lines: string[]; readonly language?: string }
  | { readonly type: 'quote'; readonly lines: InlineSpan[][] }
  | { readonly type: 'hr' };

/** 围栏开行（```/~~~ 可 repetitions——闭栏同字符等长以上） */
const FENCE_RE = /^(`{3,}|~{3,})\s*(\S*)\s*$/;
/** 标题行（# 1-6 个 + 空格） */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** 水平线（同字符 ≥3、容忍符间空格） */
const HR_RE = /^(?:[-*_])(?:\s*[-*_]){2,}$/;
/** 列表项（前导缩进 + 无序符或有序序号符 + 空格 + 内容） */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/**
 * 块解析：全文 → 块序列。CRLF/CR 统一 LF；未闭围栏收至文末（防御——
 * 流式半截文本换装前的定稿才进本件，但防御不依赖调用方）。
 */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      // 段内软换行折叠为空格（Markdown 标准语义——渲染时按宽重折）
      blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trimEnd();
    if (line.trim() === '') {
      flushParagraph(); // 空行断段
      i++;
      continue;
    }
    // 围栏代码块：吃到闭栏（同字符等长以上）或文末
    const fence = FENCE_RE.exec(line.trim());
    if (fence !== null) {
      flushParagraph();
      const marker = fence[1]!;
      const language = fence[2] !== '' ? fence[2] : undefined;
      const closeChar = marker[0]!;
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const inner = lines[i]!;
        if (inner.trimStart().startsWith(closeChar) && inner.trim().length >= marker.length) break;
        code.push(inner);
        i++;
      }
      i++; // 越过闭栏（文末防御——闭栏缺席时此步越界无害）
      blocks.push({ type: 'code', lines: code, language });
      continue;
    }
    // 标题
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1]!.length, spans: parseInline(heading[2]!) });
      i++;
      continue;
    }
    // 水平线
    if (HR_RE.test(line.trim())) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    // 引用（连续 > 行归一块）
    if (line.startsWith('>')) {
      flushParagraph();
      const quoted: InlineSpan[][] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        // 剥 '> ' 或 '>' 前缀（无空格紧贴形同剥）
        const body = lines[i]!.replace(/^>\s?/, '');
        quoted.push(body.trim() === '' ? [] : parseInline(body));
        i++;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }
    // 列表项（每项一块——滚动帽子行单位）
    const list = LIST_RE.exec(line);
    if (list !== null) {
      flushParagraph();
      blocks.push({
        type: 'list-item',
        ordered: /\d/.test(list[2]!),
        marker: /\d/.test(list[2]!) ? list[2]! : '•',
        indent: Math.floor(list[1]!.length / 2),
        spans: parseInline(list[3]!),
      });
      i++;
      continue;
    }
    // 其余 → 段落累积（相邻块型出现时由各自 flush 断段）
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return blocks;
}
