/**
 * thinking 块渲染（07 §4.1 R1 批 10i——思考块渲染档位；V-2 笔2 注④翻形）。
 *
 * 两档：缺省**折叠单行标签**（省 scrollback，批 10i 落码定值）；展开态 =
 * 标签行 + markdown 体全量（体渲染走既有 doc 管线后**整面改妆**——全部游程
 * fg=thinkingText + italic，斜体与专用色双位齐 R1 条款；bold 位保留——标题
 * 粗体在单色面仍有层级信息）。R-4（Codex 样式复刻批）：思考行扩 dim 增补位
 * ——标签与体行 dim+italic 同构（斜体与 thinkingText 键维持、键不退役）。
 *
 * 标签三档（V-0 注④计量人读律——`✻ 思考 N 字` 字符计量退役；件 C
 * 〔2026-10-16 用户三反馈〕三档嵌内容首行预览——「已思考」行可知所思）：
 * 流式档 `思考中 · {preview}（ctrl+t 展开）`（进行中无计量——字数不再
 * 逐帧变；原尾省略号随预览退役——与截断省略号语义相撞）；定稿档
 * `思考 · 4s · {preview}（ctrl+t 展开）`（时长 = TUI 消费端本地钟——
 * thinking 首增量到达 → settled，注入钟 now() 可测；与 run 级 durationMs
 * （A-3 结算账）口径分立——冷读闸注）；repaint/历史形无钟账 →
 * `思考 · {preview}（ctrl+t 展开）`（时长诚实缺席不虚构、内容不缺席）；
 * 预览缺席（columns 缺席 ∨ 预算 ≤0 ∨ 空文）退化回无预览形逐字零回归
 * （流式省略号随缺席归位）。标签行两档（折叠全量/展开头行）同一函数
 * 同词面（展开态体行全量在场、头行预览冗余无害）。
 *
 * 纯函数：同一 (text, expanded, phase, durationMs, columns, theme, hint, doc)
 * 恒同行集——流式槽前缀行与定稿 thinking 块**同一函数两用**（换装跳行不漂移
 * 的定位前提，见 main-screen 冻结账注）；doc 参数为预构行集源（RowsSource
 * ——挖掘 36 轮〔5〕，流式槽传 StreamingMarkdown 增量件、定稿块持
 * MarkdownDoc——缺席则内部即时构档）。
 */
import { ellipsize, sanitizeDisplayText, stringWidth, type CellStyle } from '../../engine/index.js';
import { MarkdownDoc, type RowsSource } from '../markdown/markdown.js';
import type { ResolvedTheme } from '../theme/index.js';
import { docRowToStyledLine, type StyleRun, type StyledLine } from '../backend/ansi-rows.js';
import { formatElapsedCompact } from '../../../contracts/index.js';

/** 思考块渲染视图面（块数据与本件渲染的窄接口——流式槽/定稿块共用） */
export interface ThinkingView {
  /** 思考全文（多思考块合并形——'\n\n' 串接） */
  readonly text: string;
  /** 展开态（会话级开关的快照——渲染纯函数化，态归 transcript） */
  readonly expanded: boolean;
  /** 标签档（注④：流式 `思考中` / 定稿携时长——settled 后槽内即转定稿档；件 C 三档可嵌内容预览——见 thinkingLabelText） */
  readonly phase: 'streaming' | 'settled';
  /** 思考段时长 ms（settled 档呈现位；缺席 = repaint 历史形无钟账——诚实缺席） */
  readonly durationMs?: number;
  readonly theme: ResolvedTheme;
  /** 开关键名提示（keyText(动作id) 动态取——用户覆盖后随动） */
  readonly toggleHint: string;
}

/** 预览分隔段（` · `——3 列；与 footer 仪表槽连接符同形） */
const PREVIEW_SEPARATOR = ' · ';

/**
 * 思考内容首行预览（件 C——2026-10-16 用户三反馈：「已思考」行可知所思；
 * codex ReasoningSummaryCell 折叠态内容可见先例族）：首非空行 → 剥
 * markdown 记号（`**` 对/行首 `#+` 标题/反引号对/`[文](址)` 链接对——呈现
 * 文不呈现址）→ sanitizeDisplayText 消毒（ESC 序列整段/C0 剥除——呈现面
 * 单源）+ 空白折叠单空格（单行几何律——段内换行已由取首行消解）→
 * ellipsize 预算宽截断（显示宽整字不产半字）。budget ≤ 0 返 ''（预览缺席
 * ——词面退化回无预览形）。纯函数导出（测试直锁）。
 */
export function thinkingPreviewText(text: string, budget: number): string {
  if (budget <= 0) return '';
  // 首非空行（跨行思考取首段——多思考块合并形首块首行即此；后文不进预览）
  let first = '';
  for (const line of text.split('\n')) {
    if (line.trim() !== '') {
      first = line;
      break;
    }
  }
  if (first === '') return ''; // 空文/纯空白 = 预览缺席
  const stripped = first
    .replace(/\*\*(.+?)\*\*/g, '$1') // 粗体对
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接对（呈现文不呈现址）
    .replace(/^#+\s*/, '') // 行首标题记号（含前导空白）
    .replace(/`([^`]*)`/g, '$1'); // 行内码反引号对
  const preview = sanitizeDisplayText(stripped)
    .replace(/\s+/g, ' ') // 空白折叠单空格（tab 展开后一并归一）
    .trim();
  if (preview === '') return ''; // 剥记号+消毒后空（首行纯记号/控制字符）——缺席
  return ellipsize(preview, budget);
}

/**
 * 预览嵌位（件 C 内部件）：词面 = `prefix · {preview}hint`——预览嵌在态词
 * 与键名提示段之间（hint 恒居尾）；预算 = 列宽 − **新词面**非预览段显示宽
 * （prefix + hint）− 分隔段宽 3（冷读闸 MINOR-C1——按新词面精确计，不按含
 * 退役省略号的原词面）；columns 缺席（直呼面两参形）/预算 ≤0/空文三态
 * 预览缺席 → fallback 词面逐字零回归。
 */
function withPreview(
  text: string,
  prefix: string,
  hint: string,
  columns: number | undefined,
  fallback: string,
): string {
  if (columns === undefined) return fallback;
  const budget = columns - stringWidth(prefix) - stringWidth(hint) - stringWidth(PREVIEW_SEPARATOR);
  const preview = thinkingPreviewText(text, budget);
  if (preview === '') return fallback;
  return `${prefix}${PREVIEW_SEPARATOR}${preview}${hint}`;
}

/**
 * 思考标签行（单行——折叠档全量 + 展开档首行；时长 = 本地钟整秒档单源）。
 * 件 C：columns 在场且预览预算有余时嵌内容首行预览（词面见头注三档）。
 */
export function thinkingLabelText(view: ThinkingView, action: '展开' | '收起', columns?: number): string {
  const hint = `（${view.toggleHint} ${action}）`;
  if (view.phase === 'streaming') {
    // 流式档：预览在场去原尾省略号（与预览截断省略号语义撞）；缺席省略号归位
    return withPreview(view.text, '思考中', hint, columns, `思考中…${hint}`);
  }
  // 定稿档：本地钟时长；repaint/历史形无钟账诚实缺席（不虚构时长）——两形
  // 的预览嵌位对称（prefix 态词、hint 同构）
  const prefix = view.durationMs !== undefined ? `思考 · ${formatElapsedCompact(view.durationMs)}` : '思考';
  return withPreview(view.text, prefix, hint, columns, `${prefix}${hint}`);
}

/**
 * 思考块 → 带样式行集。折叠 = 单标签行（整行 dim+italic + thinkingText 色
 * ——R-4 dim 增补位）；展开 = 标签行 + 改妆 doc 体行。空 text 零行（守卫位
 * ——调用面不落空块，防御性双保险）。
 */
export function renderThinkingStyledLines(view: ThinkingView, columns: number, doc?: RowsSource | null): StyledLine[] {
  if (view.text === '') return [];
  const thinkStyle: CellStyle = { fg: view.theme.thinkingText, italic: true, dim: true }; // dim = R-4 增补位（体行改妆 spread 承载）
  const label = thinkingLabelText(view, view.expanded ? '收起' : '展开', columns); // 件 C：columns 透传（transcript 三消费位零改）
  const labelLine: StyledLine = {
    plain: label,
    runs: [{ start: 0, end: label.length, style: thinkStyle }],
  };
  if (!view.expanded) return [labelLine];
  // 展开档：体行 = doc 行集直转（挖掘 36 轮〔5〕——rowsFor + docRowToStyledLine
  // 单源，CellGrid 往返退役：链接 href 随字素贯通，改妆后仍在）后整面改妆
  //（斜体 + thinkingText——bold 保留）
  const bodyDoc = doc ?? MarkdownDoc.of(view.text, view.theme);
  const rows = bodyDoc.rowsFor(columns);
  const body: StyledLine[] = [];
  if (rows.length === 0) {
    body.push(restyleThinking({ plain: '', runs: [] }, thinkStyle)); // 空体保底行（镜像修前 Math.max(1,…) 量高语义）
  } else {
    for (let r = 0; r < rows.length; r++) {
      // 无内容行保空行（doc 管线同律——docRowToStyledLine 空行形直出）
      body.push(restyleThinking(docRowToStyledLine(rows[r]!, columns), thinkStyle));
    }
  }
  return [labelLine, ...body];
}

/**
 * 体行改妆：整面覆盖重建——既有游程换思考样式（start/end 几何保留、bold
 * 层级保留），**游程间隙补思考样式段**（挖掘 34 轮：markdown 行内样式段
 * 〔bold/code/链接〕只为非默认样式格产游程，段两侧裸文本间隙无游程——
 * 修前改妆后间隙走 SGR_RESET 默认前景/正体/非 dim，与同块体行割裂；零
 * 游程裸行的整行补妆为间隙补妆的退化形，同函数两形归一）。
 */
function restyleThinking(line: StyledLine, style: CellStyle): StyledLine {
  const runs: StyleRun[] = [];
  let pos = 0;
  for (const run of line.runs) {
    if (run.start > pos) {
      runs.push({ start: pos, end: run.start, style }); // 前间隙裸文本补妆（间隙无链——href 缺席）
    }
    // bold 层级保留——单色面仍有语义；href 随段保留（挖掘 36 轮〔5〕——改妆不改链）
    runs.push({ start: run.start, end: run.end, style: { ...style, bold: run.style.bold }, href: run.href });
    pos = Math.max(pos, run.end); // 防御：乱序/重叠游程不回退
  }
  if (pos < line.plain.length) {
    runs.push({ start: pos, end: line.plain.length, style }); // 尾间隙补妆
  }
  return { plain: line.plain, runs };
}
