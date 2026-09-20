/**
 * Markdown 块解析件（07 §4.1 引擎节件 6——批 10d-4；表格 + 开栏标记 +
 * 结构相等 批 10h 增补）。
 *
 * 块模型 = 滚动帽单位（呈现面件 1：一个 Markdown 块一子行——blockCount
 * 即帽额度计数）。v1 支持面（CommonMark 子集，边界注释在案）：
 * 标题 #..######、段落（段内软换行折叠为空格——标准语义）、无序/有序
 * 列表（嵌套缩进 2 空格一层）、围栏代码块（```/~~~）、引用（>，连续行
 * 归块）、水平线（三连 - 或 * 或 _）、GFM 表格（批 10h——表头 + 定界行
 * + 数据行，单元格行内解析，转义竖线 `\|` 不支撑）。缩进四空格代码块、
 * 脚注不支撑（未列形按段落回退——坏输入不丢字）。
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
  | {
      readonly type: 'code';
      readonly lines: string[];
      readonly language?: string;
      /** 开栏未闭标记（流式半截形——渲染退单色不高亮、永不入稳定面） */
      readonly open?: true;
    }
  | { readonly type: 'quote'; readonly lines: InlineSpan[][] }
  | {
      /** GFM 表格：header/rows 单元格已行内解析；align 逐列（null = 缺省左） */
      readonly type: 'table';
      readonly header: InlineSpan[][];
      readonly rows: InlineSpan[][][];
      readonly align: readonly ('left' | 'center' | 'right' | null)[];
    }
  | { readonly type: 'hr' };

/** 围栏开行（```/~~~ 可 repetitions——闭栏同字符等长以上） */
const FENCE_RE = /^(`{3,}|~{3,})\s*(\S*)\s*$/;
/** 标题行（# 1-6 个 + 空格） */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** 水平线（同字符 ≥3、容忍符间空格） */
const HR_RE = /^(?:[-*_])(?:\s*[-*_]){2,}$/;
/** 列表项（前导缩进 + 无序符或有序序号符 + 空格 + 内容） */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
/** 表格定界行（:---: 形——仅 | : - 与空白、至少一杠一竖线） */
const TABLE_SEP_RE = /^[\s|:-]+$/;

/**
 * 行闭栏判据（与主解析同律：同字符、等长以上——封段扫描共用单源）。
 * CommonMark 闭栏形：trim 后**整行全为围栏字符**且长度 ≥ 开栏长度——
 * 围栏体内 '`bold` means emphasis' 类反引号起首行（首字符同、总长 ≥3 但
 * 非全围栏字符）不得误闭栏（B-render 批——修前只查首字符与总长）。
 */
function closesFence(line: string, marker: string): boolean {
  const t = line.trim();
  return t.length >= marker.length && [...t].every((ch) => ch === marker[0]!);
}

/** 单元格切分（剥外缘竖线 + 竖线分位 + trim——`\|` 转义形 v1 不支撑） */
function splitCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

/** 定界行 → 逐列对齐位（:--- 左 / :---: 中 / ---: 右 / --- null） */
function alignsOf(sepLine: string): ('left' | 'center' | 'right' | null)[] {
  return splitCells(sepLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/** 定界行判据：字符面合规 + 含至少一竖线一横线 */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && t.includes('-') && TABLE_SEP_RE.test(t);
}

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
      const code: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i]!, marker)) {
        code.push(lines[i]!);
        i++;
      }
      const closed = i < lines.length; // 文末防御——闭栏缺席标开栏
      i++; // 越过闭栏（开栏时此步越界无害）
      blocks.push(
        closed ? { type: 'code', lines: code, language } : { type: 'code', lines: code, language, open: true },
      );
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
    // GFM 表格：当前行含竖线 + 次行定界行 → 表头 + 定界 + 连续数据行
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushParagraph();
      const header = splitCells(line).map((cell) => parseInline(cell));
      const align = alignsOf(lines[i + 1]!);
      const rows: InlineSpan[][][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i]!.trim();
        // 空行或无竖线行结束表（GFM 行连续律）
        if (rowLine === '' || !rowLine.includes('|')) break;
        rows.push(splitCells(rowLine).map((cell) => parseInline(cell)));
        i++;
      }
      blocks.push({ type: 'table', header, rows, align });
      continue;
    }
    // 其余 → 段落累积（相邻块型出现时由各自 flush 断段）
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return blocks;
}

/** 行内段结构相等（blockEquals 的 span 位支路） */
function spanEquals(a: InlineSpan, b: InlineSpan): boolean {
  return (
    a.text === b.text && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.code === b.code
  );
}

/** span 序列结构相等（逐位全等） */
function spansEquals(a: readonly InlineSpan[], b: readonly InlineSpan[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (!spanEquals(a[k]!, b[k]!)) return false;
  }
  return true;
}

/**
 * 块结构相等（深比较无引用相等捷径——流式增量件的块级缓存命中判据，
 * R1「(text,width) 块级缓存」的 text 侧；同构同内容即命中）。
 */
export function blockEquals(a: MarkdownBlock, b: MarkdownBlock): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'heading':
      return a.level === (b as typeof a).level && spansEquals(a.spans, (b as typeof a).spans);
    case 'paragraph':
      return spansEquals(a.spans, (b as typeof a).spans);
    case 'list-item':
      return (
        a.ordered === (b as typeof a).ordered &&
        a.marker === (b as typeof a).marker &&
        a.indent === (b as typeof a).indent &&
        spansEquals(a.spans, (b as typeof a).spans)
      );
    case 'code': {
      const other = b as typeof a;
      return (
        a.language === other.language &&
        a.open === other.open &&
        a.lines.length === other.lines.length &&
        a.lines.every((line, k) => line === other.lines[k])
      );
    }
    case 'quote':
      return (
        a.lines.length === (b as typeof a).lines.length &&
        a.lines.every((spans, k) => spansEquals(spans, (b as typeof a).lines[k]!))
      );
    case 'table': {
      const other = b as typeof a;
      return (
        a.header.length === other.header.length &&
        a.header.every((spans, k) => spansEquals(spans, other.header[k]!)) &&
        a.rows.length === other.rows.length &&
        a.rows.every(
          (row, r) =>
            row.length === other.rows[r]!.length && row.every((spans, k) => spansEquals(spans, other.rows[r]![k]!)),
        ) &&
        a.align.length === other.align.length &&
        a.align.every((v, k) => v === other.align[k])
      );
    }
    case 'hr':
      return true;
  }
}
