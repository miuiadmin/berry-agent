/**
 * Markdown 块解析件（07 §4.1 引擎节件 6——批 10d-4；表格 + 开栏标记 +
 * 结构相等 批 10h 增补）。
 *
 * 块模型 = 滚动帽单位（呈现面件 1：一个 Markdown 块一子行——blockCount
 * 即帽额度计数）。v1 支持面（CommonMark 子集，边界注释在案）：
 * 标题 #..######、段落（段内软换行折叠为空格——标准语义）、无序/有序
 * 列表（嵌套缩进 4 空格一层——R-3 渲染每层 4 列缩进同构；tight/loose
 * 逐邻近似记录源文形态——R-3 起呈现层不消费，见 list-item.loose 注）、
 * 围栏代码块（```/~~~）、引用（>，连续行归块——子块化：剥一层前缀递归
 * 解析，引用内表格/代码/列表/多层引用结构化，42 轮件 C）、水平线（三连
 * - 或 * 或 _）、GFM 表格（批 10h——表头 + 定界行 + 数据行，单元格行内
 * 解析，转义竖线 `\|` 不支撑）。缩进四空格代码块、
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
      /** 序号/圆点呈现（无序 '•'、有序原样如 '1.'——渲染位按深度翻梯度形） */
      readonly marker: string;
      /** 嵌套层级（前导空格 / 2，向下取整） */
      readonly indent: number;
      /**
       * 松散项标记（CommonMark tight/loose 近似——界面美化役批）：前源行非
       * 列表项行（空行或异型内容行）→ 松散；前源行是列表项行（源文相邻）
       * → 紧凑（缺省不设位）。R-3 起呈现层**不消费**（块间空距改前项渲染
       * 行数判据——多行项补空行、与源文 tight/loose 无关）；字段保留 = 源文
       * 形态数据面记录 + blockEquals 承载（位差仍一票否决——缓存承接防错位）。
       */
      readonly loose?: true;
      readonly spans: InlineSpan[];
    }
  | {
      readonly type: 'code';
      readonly lines: string[];
      readonly language?: string;
      /** 开栏未闭标记（流式半截形——渲染退单色不高亮、永不入稳定面） */
      readonly open?: true;
    }
  | {
      readonly type: 'quote';
      /**
       * 子块列表（42 轮件 C——子块化）：剥一层 '>' 前缀后的体文本递归
       * parseMarkdown 产物（引用内标题/表格/代码/列表/多层引用结构化）；
       * 引用内空行 = 子块分隔、软换行折叠与顶层段落同律。空数组 = 空
       * 引用（渲染单行 '> ' 占位）。
       */
      readonly children: MarkdownBlock[];
    }
  | {
      /** GFM 表格：header/rows 单元格已行内解析；align 逐列（null = 缺省左） */
      readonly type: 'table';
      readonly header: InlineSpan[][];
      readonly rows: InlineSpan[][][];
      readonly align: readonly ('left' | 'center' | 'right' | null)[];
    }
  | { readonly type: 'hr' };

/**
 * 围栏开行（```/~~~ 可 repetitions——闭栏同字符等长以上）。info 串取首词
 * 为语言、行尾剩余忽略（CommonMark 语义）——「```python title=x」多词形
 * 不得整块退化段落（修前单捕获组 + $ 行尾锚定只认单词形）。
 */
const FENCE_RE = /^(`{3,}|~{3,})[ \t]*([^`\s]*).*$/;
/** 标题行（# 1-6 个 + 空格） */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * setext 下划线行（挖掘 51 轮件 B——=+/-+ 纯串）：段落已累积内容行时使
 * 段落整体翻标题（'='→H1 / '-'→H2，CommonMark setext 律）；单横线短下划
 * 线同翻 H2（setext 下划线无最短长）。
 */
const SETEXT_RE = /^(=+|-+)$/;
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

/** md/markdown 围栏语言键字面二键集（解包判据——不走 ALIASES：高亮域≠解析变换域，防别名扩充静默放宽解包） */
const MD_FENCE_LANGS = new Set(['md', 'markdown']);

/**
 * 体内是否含相邻「含竖线行 + 定界行」对（解包条件③）：空行重置配对
 * （codex previous_line 同律）——体内任意表格段命中即真（宽形非仅首块）；
 * 定界行自身不作后续配对前驱（表头位必是含竖线的数据形行）。
 */
function containsTablePair(body: readonly string[]): boolean {
  let prevPipe = false;
  for (const raw of body) {
    const t = raw.trim();
    if (t === '') {
      prevPipe = false; // 空行断配对
      continue;
    }
    if (isTableSeparator(t)) {
      if (prevPipe) return true; // 表头行紧邻定界行——表格段成立
      prevPipe = false;
      continue;
    }
    prevPipe = t.includes('|');
  }
  return false;
}

/**
 * md 围栏表格解包预扫 pass（挖掘 40 轮件 C——07 §4.1 引擎节件 6 Markdown
 * 件分句）：LLM 惯以 ```md/```markdown 围栏包管道表格，不解包则整块走
 * code 分支单色呈现（codex unwrap_markdown_fences 对标）。**四条件齐才删
 * 开/闭栏两行**、体行裸入主循环自然多块化（标题/段落/表格）：
 * ① 闭栏在文内（未闭栏原样零改动——流式半截期照旧 code）；
 * ② 语言键命中字面二键集（FENCE_RE info 首词小写）；
 * ③ 体内含相邻「含竖线行 + 定界行」对（判据复用表格分支单源）；
 * ④ **闭栏行非文末无尾换的末行**——闭栏行须后随换行或另有内容（防
 *    「闭栏即文末」瞬态帧解包后、粘字帧续写翻开栏致流式稳定面回缩已冻
 *    行改写；代价 = 终文恰以围栏收尾无尾换的保守漏解、续写到位即翻转
 *    ——对 codex 端-of-input 保守姿态的有意收窄）。
 * 任一不中照旧围栏（回退）；全无解包时返原数组引用（零改动快径——
 * 前缀块缓存/块比对零扰动）。删行后邻接行即原文相邻语义，一切合并形照
 * GFM 常规律（codex 同语义，不插空行防发明内容）。
 */
export function unwrapMarkdownTableFences(lines: readonly string[]): string[] {
  const out: string[] = [];
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const fence = FENCE_RE.exec(lines[i]!.trim());
    if (fence === null) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    // 找配对闭栏（同字符等长以上——主循环闭栏判据单源复用）
    const marker = fence[1]!;
    let j = i + 1;
    while (j < lines.length && !closesFence(lines[j]!, marker)) j++;
    const body = lines.slice(i + 1, j);
    // 四条件逐判（任一不中原样保留围栏块——开/体/闭全推 out）
    const keep = (): void => {
      out.push(lines[i]!, ...body);
      if (j < lines.length) out.push(lines[j]!);
    };
    if (
      j >= lines.length || // ① 闭栏缺席（文末防御——流式半截照旧 code）
      j === lines.length - 1 || // ④ 闭栏即末元素 = 文末无尾换（split 形：有尾换则末元素是空串）
      !MD_FENCE_LANGS.has((fence[2] ?? '').toLowerCase()) || // ② 语言键字面二键集
      !containsTablePair(body) // ③ 体内相邻表格对
    ) {
      keep();
      i = j + 1;
      continue;
    }
    // 解包：删开/闭栏两行、体行裸入（主循环自然多块化）
    out.push(...body);
    changed = true;
    i = j + 1;
  }
  return changed ? out : (lines as string[]);
}

/**
 * 块解析：全文 → 块序列。CRLF/CR 统一 LF；未闭围栏收至文末（防御——
 * 流式半截文本换装前的定稿才进本件，但防御不依赖调用方）。
 */
export function parseMarkdown(text: string): MarkdownBlock[] {
  // md 围栏表格解包预扫（挖掘 40 轮件 C——四条件判据见 unwrapMarkdownTableFences
  // 分句；单点收口本位：streaming 增量与 MarkdownDoc 构造两路自动同律）
  const lines = unwrapMarkdownTableFences(text.replace(/\r\n?/g, '\n').split('\n'));
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
    // setext 标题（挖掘 51 轮件 B）：段落已累积 ≥1 内容行 + 当前行纯 =/- 下划线
    // → 段落整体翻标题（'='→1 / '-'→2）；下划线行消费不入段。**位次在 HR 分支
    // 前即天然分界**：段落在场优先 setext（'---' 跟段落 = setext 2），段落缺席
    // （独立 '---'）仍 hr。段内软换行折叠 join(' ')——同 flushParagraph 同式
    //（拦截式铸 heading 位无法复用 flushParagraph——软折叠策略若变两处同笔改）
    const setext = SETEXT_RE.exec(line.trim());
    if (setext !== null && paragraph.length > 0) {
      blocks.push({
        type: 'heading',
        level: setext[1]![0] === '=' ? 1 : 2,
        spans: parseInline(paragraph.join(' ')),
      });
      paragraph = [];
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
    // 引用（连续 > 行归一块——子块化：剥一层前缀整段递归解析，42 轮件 C）
    if (line.startsWith('>')) {
      flushParagraph();
      const bodies: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        // 剥 '> ' 或 '>' 前缀（无空格紧贴形同剥）
        bodies.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      // 体行剥前缀 join 喂 parseMarkdown 递归——纯函数递归零共享态；引用内
      // 空行 = 子块分隔、软换行折叠与顶层同律；```md 围栏解包预扫天然重入
      //（条件④按子文本末行判——流式判稳侧 consequences 见 streaming tailSafe）
      blocks.push({ type: 'quote', children: parseMarkdown(bodies.join('\n')) });
      continue;
    }
    // 列表项（每项一块——滚动帽子行单位）
    const list = LIST_RE.exec(line);
    if (list !== null) {
      flushParagraph();
      // 紧凑/松散判据（界面美化役批 §⑥——CommonMark tight/loose 逐邻近似）：
      // 前源行是列表项行 → 紧凑（源文相邻项渲染零空距）；前源行为空行或非
      // 列表行 → 松散（项前维持空行）。逐邻读取而非整列表判定——与拍板措辞
      // 「源文项间有空行的松散列表维持空行」逐对一致（严格 CommonMark 的
      // 整列表传染形不采）
      const tight = i > 0 && LIST_RE.test(lines[i - 1]!.trim());
      blocks.push({
        type: 'list-item',
        ordered: /\d/.test(list[2]!),
        marker: /\d/.test(list[2]!) ? list[2]! : '•',
        indent: Math.floor(list[1]!.length / 4), // R-3：嵌套 4 空格一层（渲染每层 4 列缩进同构）
        loose: tight ? undefined : true,
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

/**
 * 块间空距单源（R-3 紧凑列表律收窄）：相邻两块均为列表项且**前项单视觉行**
 * （prevRowCount ≤ 1）→ 0（零空距）；其余块对（含多行列表项 → 后项，补 1
 * 空行——与源文 tight/loose 无关，呈现层统一）→ 1（空行）。
 *
 * 消费位四处必须同律（行数算术错位即冻结面漂移）：markdown.ts layout()/
 * prefixRows() 的装配空行插入、streaming.ts measure()/stableLineCount() 的
 * 计数空行累加——四路共消费本函数且传前项渲染行数，「前缀已有行才补空行」
 * 语义由各调用位自守（零行块不改判据）。
 */
export function blockGap(prev: MarkdownBlock, next: MarkdownBlock, prevRowCount = 1): 0 | 1 {
  if (prev.type === 'list-item' && next.type === 'list-item') {
    return prevRowCount > 1 ? 1 : 0;
  }
  return 1;
}

/** 行内段结构相等（blockEquals 的 span 位支路——href 第 6 字段随 OSC-8 批入册：
 *  流式块缓存承接判据含链接目标——目标漂移即结构漂移不承接） */
function spanEquals(a: InlineSpan, b: InlineSpan): boolean {
  return (
    a.text === b.text &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.href === b.href
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
        a.loose === (b as typeof a).loose && // 松散位参与相等（缓存承接防错位）
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
      // 子块化（42 轮件 C）：children 逐块递归结构相等
      return (
        a.children.length === (b as typeof a).children.length &&
        a.children.every((child, k) => blockEquals(child, (b as typeof a).children[k]!))
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
