/**
 * 工具卡定稿形渲染（07 §4.1 R4 批 10i——三态卡）。
 *
 * 三态卡头：✓ success（isError=false）/ ✖ error（isError=true）/ ⏹ aborted
 * （details.aborted 结构化标记——tools-batch 中止合成位铸入；dim 档与次文
 * 同档弱存在感〔semantic 件 10g 裁〕）。卡头 = 终态符号（语义色）+ 工具名 +
 * 参数简述（dim）；卡体两档：缺省**折叠**（卡头 + 尾 N 视觉行预览——批 10i
 * 落码定值 N=5，预览整面 dim），ctrl+o 会话级展开（全量行、正常亮度）。
 *
 * diff 档（edit 类工具——patch 体卡）：卡体行按 patch 判形渲染，1 删 1 增
 * 相邻对走词级高亮（删行变更词红 / 增行变更词绿——word-diff 件 LCS），
 * 孤立删/增整行红/绿，'***' 头行 dim。纯函数：同一 (卡数据, columns) 恒同
 * 行集（repaint / 回看器同管线零漂移）。
 *
 * 插件卡体（2026-09-17 TUI 余量收官批③——07 §4.1 插件工具渲染钩子签名
 * 钉位）：查表命中且 renderResult 钩子在场 → **每次渲染现调**（定稿渲染与
 * repaint 投影重渲各一次——不缓存、不落 durable、不进事件流，直播路与
 * repaint 恒一致律保持）；返回非空行集 = 插件卡体（tone → 批 10g 语义键
 * 着色直取）。**卡头恒宿主单源形**（终态符号 + 工具名 + 参数简述——终态
 * 判定/中止分档属宿主裁决面，插件不可覆写）。**回落恒在律**：渲染器缺席/
 * 抛错/返回空行集/载荷缺席 → 宿主缺省卡体（插件渲染器结构性不可劣化呈现
 * 面）。折叠预览 N=5 与卡体帽 200 行对插件行集同律。
 */
import { truncateToWidth, wrapText, type CellStyle, type ColorValue } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import { capStyledLine, clampRuns, type StyledLine, type StyleRun } from '../backend/ansi-rows.js';
import { diffWords, parsePatchLines, type PatchLine } from './word-diff.js';
import { lookupToolRenderer, type RendererLine, type ToolRenderResultInput } from '../../renderers.js';

/** 卡终态（↔ ToolResultMessage isError / details.aborted 的呈现分档） */
export type ToolCardStatus = 'success' | 'error' | 'aborted';

/** 折叠档预览尾视觉行数（07 §4.1 R4「N 随 10i 落码定值」——定值 5） */
export const CARD_PREVIEW_LINES = 5;

/** 卡体存账行帽（尾留——超帽截头保尾：预览取尾行、展开档亦不失最近输出） */
export const CARD_BODY_MAX_LINES = 200;

/**
 * 插件渲染腿载荷（renderResult 现调事实——toolName 单源 = card.name 故载荷
 * 不含名）。由 transcript 落卡时从 toolCall 参数与 toolResult 消息面铸入；
 * 缺席 = 无插件腿走宿主缺省卡体。
 */
export type ToolCardRenderInput = Omit<ToolRenderResultInput, 'toolName'>;

/** 卡渲染视图面（块数据与本件渲染的窄接口） */
export interface ToolCardView {
  readonly name: string;
  readonly brief: string;
  readonly status: ToolCardStatus;
  /** 卡体行（result 文本或 edit 的 patch 体——cardBodyOf 产物） */
  readonly body: readonly string[];
  /** diff 档旗标（true = body 是 patch 体——词级高亮渲染） */
  readonly diff: boolean;
  readonly expanded: boolean;
  readonly theme: ResolvedTheme;
  /** 插件渲染腿载荷（07 §4.1 钉位注——缺席 = 宿主缺省卡体） */
  readonly renderInput?: ToolCardRenderInput;
}

/** 终态符号（卡头首段——状态分档可辨形） */
const STATUS_SYMBOL: Readonly<Record<ToolCardStatus, string>> = { success: '✓', error: '✖', aborted: '⏹' };

/** 卡体文本 → 存账行（尾留帽 + 截断标记首行——内存上限语义） */
export function cardBodyOf(text: string): readonly string[] {
  const lines = text.split('\n');
  if (lines.length <= CARD_BODY_MAX_LINES) return lines;
  const dropped = lines.length - CARD_BODY_MAX_LINES;
  return [`⋯（前文已省 ${dropped} 行）`, ...lines.slice(-CARD_BODY_MAX_LINES)!];
}

/**
 * 工具卡 → 带样式行集。卡头行恒在场（状态符号语义色 + 名/简述 dim——宿主
 * 单源恒形）且**恒受屏宽帽**（2026-09-20 TUI 修复组 1 批 F6——超长名/简述
 * 整行截断 capStyledLine，游程同步钳制；旧形无帽——超长工具名直写交终端
 * autowrap 产未记账物理行）；卡体折叠 = 尾 CARD_PREVIEW_LINES 视觉行（dim），
 * 展开 = 全量行。插件腿现调在卡体源选择之前（07 钉位注）——命中即插件
 * 卡体，回落形与宿主缺省同走下方两档渲染（折叠/展开/预览对插件行集同律）。
 */
export function renderToolCardStyledLines(card: ToolCardView, columns: number): StyledLine[] {
  const header = ` ${STATUS_SYMBOL[card.status]} ${card.name}${card.brief}`;
  const statusColor =
    card.status === 'success' ? card.theme.success : card.status === 'error' ? card.theme.error : card.theme.secondary;
  // 卡头屏宽帽（F6）：plain 整字截断 + 两段游程同步钳制（符号段/名段跨界收尾）
  const headerLine: StyledLine = capStyledLine(
    {
      plain: header,
      runs: [
        { start: 0, end: 2, style: { fg: statusColor } }, // 符号段（含首空格——符号色延至名前）
        { start: 2, end: header.length, style: DIM_STYLE }, // 名 + 参数简述段
      ],
    },
    columns,
  );
  // 插件卡体现调（null = 回落——未命中/抛错/空行集/载荷缺席四形同落宿主缺省）
  const pluginBody = renderPluginBodyLines(card, columns);
  const bodyLines =
    pluginBody ??
    (card.diff ? renderDiffBodyLines(card.body, columns, card.theme) : renderPlainBodyLines(card.body, columns));
  const shown = card.expanded ? bodyLines : bodyLines.slice(-CARD_PREVIEW_LINES);
  const body = card.expanded ? shown : shown.map(addDim);
  return [headerLine, ...body];
}

/**
 * 插件卡体行集（2026-09-17 TUI 余量收官批③——回落恒在律单源 try/catch）。
 *
 * 查表命中且 renderResult 在场 → 以卡面事实现调（toolName 单源 = card.name）；
 * 返回非空行集 = 插件卡体（行集是呈现态非事实源——本函数每次渲染现调，
 * 不缓存不落 durable）。抛错 / 空行集 / 未命中 / 载荷缺席 / 坏形返回 →
 * null 走宿主缺省卡体（插件渲染器结构性不可劣化呈现面）。
 */
function renderPluginBodyLines(card: ToolCardView, columns: number): StyledLine[] | null {
  // 载荷缺席 = 无定稿期事实（孤儿兜底 ↳ 形不携载荷、防御位直落宿主）
  if (card.renderInput === undefined) return null;
  const hook = lookupToolRenderer(card.name)?.renderResult;
  if (hook === undefined) return null; // 未命中 / renderResult 钩子缺席
  try {
    const lines = hook({
      toolCallId: card.renderInput.toolCallId,
      toolName: card.name,
      arguments: card.renderInput.arguments,
      content: card.renderInput.content,
      isError: card.renderInput.isError,
      aborted: card.renderInput.aborted,
    });
    // 空行集回落 + 坏形返回（非数组/段非字符串文本）同回落档——渲染路径零崩
    if (!Array.isArray(lines) || lines.length === 0) return null;
    // 卡体帽同律（cardBodyOf 同语义：超帽截头保尾 + 截断标记首行——作用于行集）
    const capped =
      lines.length > CARD_BODY_MAX_LINES
        ? [
            [{ text: `⋯（前文已省 ${lines.length - CARD_BODY_MAX_LINES} 行）` }] as RendererLine,
            ...lines.slice(-CARD_BODY_MAX_LINES),
          ]
        : lines;
    return capped.map((line) => pluginLineToStyled(line, columns, card.theme));
  } catch {
    return null; // 抛错回落（含坏形段取值炸——整体降宿主缺省，不碎一行）
  }
}

/**
 * 插件行 → 带样式行（tone → 语义键直取；缺省与 'text' 档在 text 键 undefined
 * 时无前景游程——正文恒随终端前景）。超宽截断不折行 + 游程钳制（diff 档同律
 * ——游程几何保简）。
 */
function pluginLineToStyled(line: RendererLine, columns: number, theme: ResolvedTheme): StyledLine {
  let plain = '';
  const runs: StyleRun[] = [];
  for (const seg of line) {
    const start = plain.length;
    plain += seg.text;
    // tone 缺省 = 'text' 中性前景档；theme.text 可 undefined（无前景游程）
    const fg: ColorValue | undefined = theme[seg.tone ?? 'text'];
    if (fg !== undefined && seg.text !== '') {
      runs.push({ start, end: plain.length, style: { fg } });
    }
  }
  const clipped = truncateToWidth(plain, columns);
  return { plain: clipped, runs: clampRuns(runs, clipped.length) };
}

/** 普通卡体行：折行续推（无缩进——正文态），无样式裸行 */
function renderPlainBodyLines(body: readonly string[], columns: number): StyledLine[] {
  const lines: StyledLine[] = [];
  for (const line of body) {
    for (const wrapped of wrapText(line, columns)) lines.push({ plain: wrapped, runs: [] });
  }
  return lines;
}

/** diff 卡体行：patch 判形 + 1 删 1 增词级高亮（长行截断不折行——游程几何保简） */
function renderDiffBodyLines(body: readonly string[], columns: number, theme: ResolvedTheme): StyledLine[] {
  const patch = parsePatchLines(body.join('\n'));
  const lines: StyledLine[] = [];
  let i = 0;
  while (i < patch.length) {
    const line = patch[i]!;
    // 1 删 1 增相邻对：词级 intra-line 高亮（R4 条款主形态）
    if (line.kind === 'del' && patch[i + 1]?.kind === 'add') {
      const add = patch[i + 1]!;
      lines.push(...renderWordDiffPair(line, add, columns, theme));
      i += 2;
      continue;
    }
    lines.push(renderSinglePatchLine(line, columns, theme));
    i++;
  }
  return lines;
}

/** 词级对行：删行（变更词红）+ 增行（变更词绿）——same 段裸、变段着色 */
function renderWordDiffPair(del: PatchLine, add: PatchLine, columns: number, theme: ResolvedTheme): StyledLine[] {
  const segs = diffWords(del.text, add.text);
  const delRuns = segRuns(segs, 'del', theme.diffRemoved, 1); // 偏移 1 = '-' 前缀
  const addRuns = segRuns(segs, 'add', theme.diffAdded, 1); // 偏移 1 = '+' 前缀
  const delText = truncateToWidth(`-${del.text}`, columns);
  const addText = truncateToWidth(`+${add.text}`, columns);
  return [
    { plain: delText, runs: clampRuns(delRuns, delText.length) },
    { plain: addText, runs: clampRuns(addRuns, addText.length) },
  ];
}

/** 孤立行整行着色：删红 / 增绿 / meta dim / ctx 裸行（截断保宽帽） */
function renderSinglePatchLine(line: PatchLine, columns: number, theme: ResolvedTheme): StyledLine {
  const prefix = line.kind === 'del' || line.kind === 'add' ? (line.kind === 'del' ? '-' : '+') : '';
  const text = truncateToWidth(prefix + line.text, columns);
  if (line.kind === 'del') return { plain: text, runs: wholeRun(text, { fg: theme.diffRemoved }) };
  if (line.kind === 'add') return { plain: text, runs: wholeRun(text, { fg: theme.diffAdded }) };
  if (line.kind === 'meta') return { plain: text, runs: wholeRun(text, DIM_STYLE) };
  return { plain: text, runs: [] };
}

/** 段族 → 游程（目标类段着色、其余裸；offset = 前缀字符位平移） */
/**
 * 段族 → 游程（目标类段着色、其余裸；offset = 前缀字符位平移）。进位只算
 * 本行在场的段（same + 目标类）——异侧段（del 行的 add 段）不在本行文本里，
 * 游标不随之推进（推进即行几何漂移）。
 */
function segRuns(
  segs: readonly { kind: 'same' | 'del' | 'add'; text: string }[],
  kind: 'del' | 'add',
  fg: CellStyle['fg'],
  offset: number,
): StyleRun[] {
  const runs: StyleRun[] = [];
  let cursor = offset;
  for (const seg of segs) {
    if (seg.kind === kind) {
      runs.push({ start: cursor, end: cursor + seg.text.length, style: { fg } });
      cursor += seg.text.length;
    } else if (seg.kind === 'same') {
      cursor += seg.text.length; // 锚段在场——进位
    }
  }
  return runs;
}

/** 整行单游程助手（空行返零游程——裸行形） */
function wholeRun(text: string, style: CellStyle): StyleRun[] {
  return text === '' ? [] : [{ start: 0, end: text.length, style }];
}

/** dim 样式（卡头简述段与折叠预览共用——SGR 2；与简行块 DIM_STYLE 字节同源） */
const DIM_STYLE: Readonly<{ dim: true }> = Object.freeze({ dim: true });

/** 折叠预览整面 dim（既有游程样式并入 dim——diff 色保留亮度降档） */
function addDim(line: StyledLine): StyledLine {
  if (line.runs.length === 0) {
    return line.plain === ''
      ? line
      : { plain: line.plain, runs: [{ start: 0, end: line.plain.length, style: DIM_STYLE }] };
  }
  return { plain: line.plain, runs: line.runs.map((run) => ({ ...run, style: { ...run.style, dim: true } })) };
}
