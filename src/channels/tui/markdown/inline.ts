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
 */
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
      if (end > i + 2) {
        flush();
        spans.push({ text: text.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
    }
    // *italic*
    if (ch === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
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
