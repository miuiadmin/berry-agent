/**
 * Markdown 行内解析件（07 §4.1 引擎节件 6 Markdown 件——批 10d-4）。
 *
 * 手写扫描器四标记（v1 平面——嵌套标记不递归）：
 * `**bold**` / `*italic*` / `` `code` `` / `[label](url)`（呈现取 label +
 * underline——TUI 中性形，URL 不外显）。未闭合标记按普通文本回退（坏输入
 * 不丢字）；空标记体（`****`）不产空 span。
 */

/** 行内样式段（text 为纯呈现文本，样式位互斥组合） */
export interface InlineSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  /** 行内代码（呈现面着 ANSI 中性色——markdown.ts 渲染位并入） */
  readonly code?: boolean;
}

/**
 * 行内解析：文本 → 样式段序列。
 *
 * 优先序：`**` 先于 `*`（前缀撞车时 bold 赢）；`[` 用 `](` 连续判据（label
 * 内含 `]` 的罕见形不支撑——v1 已知边界）。
 *
 * 翼判据（CommonMark 朴素近似）：开标记后一字符与闭标记前一字符均须非
 * 空白才吞标记成 span——散文乘号「a * b * c」的纯 indexOf 配对误吞星号
 * 即丢字（坏输入不丢字契约）。翼判不过时该 '*' 落入 plain 继续扫描。
 * 嵌套相邻形（'*a**b*'）按朴素近似处理（v1 词法子集——简化边界在案）。
 * code 分支不设翼判据（CommonMark 反引号码段本无贴边判据）。
 */

/** 空白判据（翼判据共用——CommonMark 左右翼空白排除） */
function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let plain = ''; // 普通文本累积（相邻同形合并——flush 才成段）
  let i = 0;
  const flush = (): void => {
    if (plain !== '') {
      spans.push({ text: plain });
      plain = '';
    }
  };
  while (i < text.length) {
    const ch = text[i]!;
    // **bold**（** 先试——命中即吞两字符，* 不会误抢）
    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      // 翼判据：开标记后（text[i+2]）与闭标记前（text[end-1]）均非空白
      // ——翼判不过则落入 plain 继续扫描（星号不丢）
      if (end > i + 2 && !isWhitespace(text[i + 2]) && !isWhitespace(text[end - 1])) {
        flush();
        spans.push({ text: text.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
    }
    // *italic*
    if (ch === '*') {
      const end = text.indexOf('*', i + 1);
      // 翼判据：开标记后（text[i+1]）与闭标记前（text[end-1]）均非空白
      if (end > i + 1 && !isWhitespace(text[i + 1]) && !isWhitespace(text[end - 1])) {
        flush();
        spans.push({ text: text.slice(i + 1, end), italic: true });
        i = end + 1;
        continue;
      }
    }
    // `code`
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        spans.push({ text: text.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }
    // [label](url) → label + underline
    if (ch === '[') {
      const close = text.indexOf('](', i + 1);
      if (close > i) {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd > close + 1) {
          flush();
          spans.push({ text: text.slice(i + 1, close), underline: true });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return spans;
}
