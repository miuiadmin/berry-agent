/**
 * Markdown 行内解析件（07 §4.1 引擎节件 6 Markdown 件——批 10d-4）。
 *
 * 手写扫描器四标记（v1 平面——嵌套标记不递归）：
 * `**bold**` / `*italic*` / `` `code` `` / `[label](url)`（呈现取 label +
 * underline——TUI 中性形，URL 不入呈现面）。未闭合标记按普通文本回退（坏输入
 * 不丢字）；空标记体（`****`）不产空 span。
 *
 * 挖掘 36 轮〔5〕OSC-8：链接目标以 href 元数据随 span 携带（呈现零变——
 * 渲染管线发射位译 OSC-8 超链）；裸 URL 文本段出口后注（annotateBareUrls——
 * 仅元数据，裸段不增任何观感样式）。
 */

/** 行内样式段（text 为纯呈现文本，样式位互斥组合） */
export interface InlineSpan {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  /** 行内代码（呈现面着 ANSI 中性色——markdown.ts 渲染位并入） */
  readonly code?: boolean;
  /**
   * 链接目标（OSC-8 元数据——呈现零变）：仅 http/https 且已剥控制字节
   * （webHref 单源）；缺席 = 非链段。裸 URL 后注段同携（裸段零观感变——
   * 无样式位仅 href）。
   */
  readonly href?: string;
}

/**
 * web 链接目标判据（挖掘 36 轮〔5〕单源）：http/https 白名单 + C0/C1 控制
 * 字节消毒。非 web scheme（mailto/file/相对路径）返回 undefined——诚实不链
 * （codex web_destination/sanitized_destination 同构）。发射位（osc8Open）
 * 与解析位（链接/裸 URL 后注）双消费——本函数是唯一放行口。
 */
export function webHref(raw: string): string | undefined {
  if (!/^https?:\/\//.test(raw)) return undefined; // 白名单外拒链
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f-\x9f]/g, ''); // C0/DEL + C1 剥除（OSC 载荷注入防御）
}

/** 尾随标点剥离集（裸 URL 后注尾腿）：ASCII 标点 + CJK 尾随标点 */
const URL_TRAILING = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  "'",
  '"',
  ')',
  ']',
  '}',
  '>',
  '…',
  '，',
  '。',
  '；',
  '：',
  '！',
  '？',
  '、',
  '）',
  '】',
  '」',
  '』',
  '〉',
  '》',
]);
/** 闭合界符 → 开界符（平衡判据用——closer 仅在 URL 体内无未配对 opener 时剥离） */
const URL_CLOSER_OPENER = new Map<string, string>([
  [')', '('],
  [']', '['],
  ['}', '{'],
  ['>', '<'],
  ['）', '（'],
  ['】', '【'],
  ['」', '「'],
  ['』', '『'],
  ['〉', '〈'],
  ['》', '《'],
]);

/**
 * 裸 URL 尾随剥离：从游程尾起逐字符判——尾随标点集内且（闭合界符形时 URL
 * 体内 opener 计数 ≤ closer 计数——即无未配对 opener）才剥。'(a.com/F_(x))'
 * 形外层 ')' 因体内 '(' 已配对而落 plain（平衡判据）。
 */
function trimUrlEnd(text: string, start: number, end: number): number {
  while (end > start && URL_TRAILING.has(text[end - 1]!)) {
    const ch = text[end - 1]!;
    const opener = URL_CLOSER_OPENER.get(ch);
    if (opener !== undefined) {
      // 平衡判据：URL 体内（不含本候选 closer）opener 多于 closer → 本 closer
      // 是 opener 的配对闭合——属 URL，停剥
      let opens = 0;
      let closes = 0;
      for (let i = start; i < end - 1; i++) {
        if (text[i] === opener) opens++;
        else if (text[i] === ch) closes++;
      }
      if (opens > closes) break;
    }
    end--;
  }
  return end;
}

/**
 * 裸 URL 后注（parseInline 出口单点——模块内私有）：段内 `https?://` 游程切出
 * 携 href 的子段（文本保原样——显示层自消毒；href 经 webHref 消毒）。
 * - 游程 = 起自匹配位的非空白极大段；尾随标点剥离（URL_TRAILING + 平衡判据）；
 * - 已携 href 的 span 不复注（链接 label 即 URL 形保语义目标不覆写）；
 * - code 段照注（词法域分立只及代码块——行内 code 是段非块）；
 * - 其余样式位（bold/italic/code）原样随 URL 子段携带（裸 URL 仅加 href
 *   零新增观感）。
 */
/** 裸 URL 游程头扫描正则（annotateBareUrls 专用——exec 循环 lastIndex 驱动） */
const BARE_URL_HEAD = /https?:\/\//g;

function annotateBareUrls(spans: readonly InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const span of spans) {
    if (span.href !== undefined || !/https?:\/\//.test(span.text)) {
      out.push(span); // 已链不复注 / 无游程快路（多数 span 零成本过路）
      continue;
    }
    const text = span.text;
    let cursor = 0; // 已结算位（前一 URL 尾）
    BARE_URL_HEAD.lastIndex = 0;
    for (let m = BARE_URL_HEAD.exec(text); m !== null; m = BARE_URL_HEAD.exec(text)) {
      const start = m.index;
      let end = start;
      while (end < text.length && !/\s/.test(text[end]!)) end++; // 非空白极大游程
      const urlEnd = trimUrlEnd(text, start, end);
      const href = webHref(text.slice(start, urlEnd));
      if (href === undefined || urlEnd <= start + 'https://'.length) {
        BARE_URL_HEAD.lastIndex = end; // 空体防御（纯 scheme 游程）：整游程跳过
        continue;
      }
      if (start > cursor) out.push({ ...span, text: text.slice(cursor, start), href: undefined });
      out.push({ ...span, text: text.slice(start, urlEnd), href });
      cursor = urlEnd;
      BARE_URL_HEAD.lastIndex = urlEnd; // 跳过已切出的 URL 体（体内不再匹配）
    }
    if (cursor === 0)
      out.push(span); // 全程无切出——原 span 原样（引用保同）
    else if (cursor < text.length) out.push({ ...span, text: text.slice(cursor), href: undefined });
  }
  return out;
}

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
    // [label](url) → label + underline（url 经 webHref——非 web scheme 拒链
    // href 缺席，label underline 照常呈现）
    if (ch === '[') {
      const close = text.indexOf('](', i + 1);
      if (close > i) {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd > close + 1) {
          flush();
          const href = webHref(text.slice(close + 2, urlEnd));
          spans.push(
            href === undefined
              ? { text: text.slice(i + 1, close), underline: true }
              : { text: text.slice(i + 1, close), underline: true, href },
          );
          i = urlEnd + 1;
          continue;
        }
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return annotateBareUrls(spans); // 出口单点后注（裸 URL 元数据化）
}
