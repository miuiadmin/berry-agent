/**
 * 工具卡定稿形渲染（07 §4.1 R4 批 10i——三态卡）。
 *
 * 三态卡头：✓ success（isError=false）/ ✖ error（isError=true）/ ⏹ aborted
 * （details.aborted 结构化标记——tools-batch 中止合成位铸入；dim 档与次文
 * 同档弱存在感〔semantic 件 10g 裁〕）。卡头两形（UX 五问题批①——exec 卡头
 * 复刻）：bash 族 = 终态符号（语义色）+ 动词 `Ran` bold + 命令文本自研 bash
 * 词法器高亮（`bash -lc` 外壳剥除、折行帽 2 + 超出省略行）；其余工具 = 终态
 * 符号 + 工具名（平前景——界面美化役批② 名不被 dim 淹没）+ 参数简述（dim）。
 * 卡体两档：缺省**折叠**（卡头 + exec 状态行 + 「头 2 + 省略行 + 尾 2」中段
 * 截断预览〔UX 五问题批⑤——总帽 5，省略行提示 ctrl+o〕，预览整面 dim），
 * ctrl+o 会话级展开（全量行、正常亮度）。exec 卡族卡体首行状态行（批③）：
 * 退出码数值 + ` • {时长}` dim——两档恒在。
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
import { sanitizeDisplayText, truncateToWidth, wrapText, type CellStyle, type ColorValue } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import { capStyledLine, clampRuns, type StyledLine, type StyleRun } from '../backend/ansi-rows.js';
import { highlight, tokenStyle } from '../markdown/highlight/index.js';
import { diffWords, parsePatchLines, type PatchLine } from './word-diff.js';
import { lookupToolRenderer, type RendererLine, type ToolRenderResultInput } from '../../renderers.js';
import { toolFaceZh } from '../../../contracts/index.js';

/** 卡终态（↔ ToolResultMessage isError / details.aborted 的呈现分档） */
export type ToolCardStatus = 'success' | 'error' | 'aborted';

/**
 * 折叠档预览帽（UX 五问题批⑤——帽值语义翻**总帽 5**）：修前语义 = 尾 5 行
 * 滑窗（只见尾不见头）；现语义 = 「头 2 + 省略行 + 尾 2」中段截断形，总视觉
 * 行数 ≤ 5。省略行提示真键位（tools.toggle-expand——toggleHint 随册注入）。
 */
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
  /**
   * 执行时长近似 ms（UX 五问题批③——exec 卡状态行消费）：toolResult 时戳减
   * assistant 请求时戳（含调度延迟的诚实近似）。缺席 = 无状态行。
   */
  readonly durationMs?: number;
  /** 展开键提示（tools.toggle-expand 键名——预览省略行文案随册） */
  readonly toggleHint: string;
  /** 插件渲染腿载荷（07 §4.1 钉位注——缺席 = 宿主缺省卡体） */
  readonly renderInput?: ToolCardRenderInput;
}

/** 终态符号（卡头首段——状态分档可辨形） */
const STATUS_SYMBOL: Readonly<Record<ToolCardStatus, string>> = { success: '✓', error: '✖', aborted: '⏹' };

/**
 * 输出护栏注记行识别（V-2 笔2 注④双轨分层）：pipeline 固定链尾步对超帽
 * 文本产物追加 `[输出 N 字节超 M 字节上限，已保尾截断…]` 注记行（含外溢
 * 路径形——04 §7 模型面语义不动：模型循路径自取全文的指令面）。用户面
 * 呈现层对该行做转写（字节计量 → 行计量人读形），勿直改 pipeline 注记。
 */
const GUARD_NOTE_PATTERN = /^\[输出 \d+ 字节超 \d+ 字节上限，已保尾截断[^\n]*$/;

/**
 * 护栏注记呈现层转写（注④——纯函数）：剥字节注记行、前置 `⋯ +N 行`
 * （N = 保尾截断产物行数现算——「此下共 N 行」的省略提示形）。无注记
 * 原样返回（regex 不中零改写——非护栏产物不受影响）。
 */
export function humanizeGuardedOutput(text: string): string {
  if (!text.includes('[输出 ')) return text; // 速径：无注记候选零成本
  const lines = text.split('\n').filter((line) => !GUARD_NOTE_PATTERN.test(line));
  if (lines.length === text.split('\n').length) return text; // 无命中原样
  const kept = lines.filter((line) => line !== ''); // 注记前置空行对（\n\n 产物）一并收口
  return kept.length === 0 ? '' : `⋯ +${kept.length} 行\n${kept.join('\n')}`;
}

/** 卡体文本 → 存账行（尾留帽 + 截断标记首行——内存上限语义；护栏注记先转写） */
export function cardBodyOf(text: string): readonly string[] {
  const lines = humanizeGuardedOutput(text).split('\n');
  if (lines.length <= CARD_BODY_MAX_LINES) return lines;
  const dropped = lines.length - CARD_BODY_MAX_LINES;
  return [`⋯（前文已省 ${dropped} 行）`, ...lines.slice(-CARD_BODY_MAX_LINES)!];
}

/**
 * 工具卡 → 带样式行集。卡头行恒在场且**恒受屏宽帽**（2026-09-20 TUI 修复组
 * 1 批 F6——超长名/简述整行截断 capStyledLine，游程同步钳制）。
 *
 * 卡头两形（UX 五问题批①——exec 卡头复刻）：bash 族卡头 = 终态符号（语义色）
 * + 动词 `Ran` bold（成功/失败同词——失败腿符号段红系维持、中止 ⏹+次文维持）
 * + 命令文本经自研 bash 词法器高亮（codeKeyword 键族——markdown 高亮件复用
 * 零新依赖；`bash -lc` 外壳剥除、折行帽 2 视觉行 + 超出省略行）；其余工具 =
 * 常量卡头（符号语义色 + 工具名**平前景**不 dim〔界面美化役批②——名不被
 * dim 淹没〕+ 参数简述 dim）。
 *
 * 卡体首行状态行（UX 五问题批③——exec 卡族）：退出码数值 + ` • {时长}` dim
 * （时长近似 = durationMs——transcript 铸入），折叠展开两档恒在（钉在预览
 * 窗上方）。卡体折叠 = 头 2 + 省略行 + 尾 2 中段截断（UX 五问题批⑤），展开
 * = 全量行。插件腿现调在卡体源选择之前（07 钉位注）——命中即插件卡体，
 * 回落形与宿主缺省同走下方两档渲染（折叠/展开/预览对插件行集同律）。
 */
export function renderToolCardStyledLines(card: ToolCardView, columns: number): StyledLine[] {
  const statusColor =
    card.status === 'success' ? card.theme.success : card.status === 'error' ? card.theme.error : card.theme.secondary;
  const headerLines = renderExecHeaderLines(card, columns, statusColor) ?? [
    renderGenericHeaderLine(card, columns, statusColor),
  ];
  // 插件卡体现调（null = 回落——未命中/抛错/空行集/载荷缺席四形同落宿主缺省）
  const pluginBody = renderPluginBodyLines(card, columns);
  const bodyLines =
    pluginBody ??
    (card.diff ? renderDiffBodyLines(card.body, columns, card.theme) : renderPlainBodyLines(card.body, columns));
  // 状态行（exec 卡族恒 dim——折叠/展开两档同形，钉卡头之后预览窗之前）
  const statusLine = renderExecStatusLine(card);
  const body = card.expanded
    ? statusLine === null
      ? bodyLines
      : [statusLine, ...bodyLines]
    : statusLine === null
      ? previewWindow(bodyLines, card.toggleHint, columns).map(addDim)
      : [statusLine, ...previewWindow(bodyLines, card.toggleHint, columns).map(addDim)];
  return [...headerLines, ...body];
}

/**
 * 常量卡头行（通用工具形——界面美化役批② 名不被 dim 淹没）：符号段语义色
 * （含首空格延至名前）+ 工具名平前景（无 dim——正常亮度可辨）+ 参数简述段
 * dim。名/简述是模型生成面——构造位消毒先行（B-render 批），简述空则名段
 * 后无游程（裸收尾）。
 */
function renderGenericHeaderLine(card: ToolCardView, columns: number, statusColor: ColorValue): StyledLine {
  // 名段用户面动词（V-0 注⑤——呈现位转写）：数据面保原始名（exec 判断
  // card.name==='bash' 与插件腿查表在本函数族更早位——均消费原名，转写只在
  // 呈现串拼接位）
  const name = sanitizeLineText(toolFaceZh(card.name));
  const brief = sanitizeLineText(card.brief);
  const header = ` ${STATUS_SYMBOL[card.status]} ${name}${brief}`;
  const runs: StyleRun[] = [{ start: 0, end: 2, style: { fg: statusColor } }]; // 符号段（含首空格）
  if (brief !== '') runs.push({ start: 2 + name.length, end: header.length, style: DIM_STYLE }); // 简述段（名段平前景无游程）
  // 卡头屏宽帽（F6）：plain 整字截断 + 游程同步钳制（符号段/简述段跨界收尾）
  return capStyledLine({ plain: header, runs }, columns);
}

/** exec 卡头命令折行帽（UX 五问题批①——超出走省略行） */
const EXEC_HEADER_COMMAND_LINES = 2;

/** exec 卡头前缀宽（` ✓ Ran ` ——1+1+1+3+1 = 7 列；续行对齐位） */
const EXEC_HEADER_PREFIX_WIDTH = 7;

/**
 * exec 卡头行集（bash 族——UX 五问题批① 复刻 codex 形）。命令源 = 卡面
 * renderInput.arguments 的 `command` 键（数据面事实——呈现层只读）；缺席/
 * 非字符串返 null（调用方回落常量卡头）。序：消毒 → `bash -lc` 外壳剥除 →
 * 折行（前缀宽让位）→ 帽 2 视觉行 → 逐行词法高亮（自研 bash 词法器——
 * codeKeyword 键族，串接恒等原文律保证游程进位无漂移）。
 */
function renderExecHeaderLines(card: ToolCardView, columns: number, statusColor: ColorValue): StyledLine[] | null {
  // 命令源 = 卡面 renderInput.arguments 的 `command` 键（载荷面 unknown——
  // 宽形守卫取 string；缺席/非字符串返 null 回落常量卡头）
  const args = card.renderInput?.arguments;
  const commandArg =
    typeof args === 'object' && args !== null && typeof (args as Record<string, unknown>).command === 'string'
      ? ((args as Record<string, unknown>).command as string)
      : '';
  if (commandArg === '') return null;
  const command = stripShellWrapper(sanitizeLineText(commandArg));
  if (command === '') return null;
  const wrapped = wrapText(command, Math.max(1, columns - EXEC_HEADER_PREFIX_WIDTH));
  const shown = wrapped.slice(0, EXEC_HEADER_COMMAND_LINES);
  const lines: StyledLine[] = shown.map((line, i): StyledLine => {
    const plain = (i === 0 ? ` ${STATUS_SYMBOL[card.status]} Ran ` : ' '.repeat(EXEC_HEADER_PREFIX_WIDTH)) + line;
    const runs: StyleRun[] = [
      { start: 0, end: 2, style: { fg: statusColor } }, // 符号段（含首空格——失败红系/中止次文维持）
    ];
    if (i === 0) runs.push({ start: 3, end: 6, style: { bold: true } }); // 动词段 Ran bold（成功/失败同词）
    runs.push(...commandRuns(line, EXEC_HEADER_PREFIX_WIDTH, card.theme)); // 命令段词法高亮
    return capStyledLine({ plain, runs }, columns);
  });
  if (wrapped.length > shown.length) {
    // 命令超折行帽：省略行收口（续行对齐位 + dim——真实行数明示）
    const dropped = wrapped.length - shown.length;
    const marker = `${' '.repeat(EXEC_HEADER_PREFIX_WIDTH)}⋯（命令已省 ${dropped} 行）`;
    lines.push(
      capStyledLine(
        { plain: marker, runs: [{ start: EXEC_HEADER_PREFIX_WIDTH, end: marker.length, style: DIM_STYLE }] },
        columns,
      ),
    );
  }
  return lines;
}

/**
 * exec 卡头命令外壳剥除（显示层动作——bash 数据面不动）：嵌套形 `bash -lc
 * '...'` / `bash -c "..."` 剥外壳动词与一层外引号（全长成对才剥——内层引号
 * 保留）；非包装形原样。调用方序：消毒先行（本函数只做剥除）。
 */
function stripShellWrapper(command: string): string {
  const m = /^bash\s+-(?:lc|c)\s+(.*)$/s.exec(command);
  let body = m === null ? command : m[1]!;
  if (
    body.length >= 2 &&
    ((body.startsWith("'") && body.endsWith("'")) || (body.startsWith('"') && body.endsWith('"')))
  ) {
    body = body.slice(1, -1);
  }
  return body.trim();
}

/**
 * 单行命令 → 词法高亮游程（markdown 高亮件复用——token 串接恒等原文，游程
 * 进位 = token 文本长；plain token 无游程 = 裸段）。offset = 前缀字符位平移。
 */
function commandRuns(line: string, offset: number, theme: Readonly<ResolvedTheme>): StyleRun[] {
  const tokens = highlight(line, 'bash');
  if (tokens === null) return []; // 覆盖语言外诚实退单色（bash 表在册实践上不达）
  const runs: StyleRun[] = [];
  let cursor = offset;
  for (const token of tokens) {
    if (token.type !== 'plain' && token.text !== '') {
      runs.push({ start: cursor, end: cursor + token.text.length, style: { fg: tokenStyle(token.type, theme).fg } });
    }
    cursor += token.text.length;
  }
  return runs;
}

/**
 * exec 卡族状态行（UX 五问题批③——卡体首行）：`({退出码}) • {时长}` / 成功
 * 腿 ` • {时长}`（Exit code: 0 渲染层不显——数据面由装配位渲染器过滤，本行
 * 成功腿本就不显码）、`(信号终止)` null 形、错误族无码形（EXEC_TIMEOUT 等）
 * 仅时长；整行 dim。退出码解析自卡体首行（bash 数据面 `Exit code: N`——
 * 只读不改）。durationMs 缺席（孤儿/旧投影形）= 无状态行。
 */
function renderExecStatusLine(card: ToolCardView): StyledLine | null {
  if (card.name !== 'bash' || card.durationMs === undefined) return null;
  let codeSegment = '';
  if (card.status === 'error') {
    const first = card.body[0] ?? '';
    const m = /^Exit code: (\d+)$/.exec(first);
    codeSegment = m !== null ? `(${m[1]})` : first === 'Exit code: null（信号终止）' ? '（信号终止）' : '';
  }
  const plain = `${codeSegment}${codeSegment === '' ? '' : ' '}• ${formatDuration(card.durationMs)}`;
  return { plain, runs: [{ start: 0, end: plain.length, style: DIM_STYLE }] };
}

/**
 * 时长格式化（codex 形对齐）：< 1s `250ms` / < 60s `1.50s` / < 60m `1m 15s` /
 * 更长 `1h 05m`。秒以上保留两位小数到分位截断。
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m ${String(remSeconds).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * 折叠预览中段截断窗（UX 五问题批⑤）：超总帽行集 → 头 2 + 省略行 + 尾 2
 * （总帽 CARD_PREVIEW_LINES = 5——修前尾滑窗只见尾）。省略行提示展开真键位
 * （toggleHint 随册——空回退册首缺省 ctrl+o），dim 收口；行宽帽自持（体行已
 * 折行/截断入窗、省略行按 columns 截——直调面〔窄宽测试〕无外层 choke 亦不越帽）。
 */
function previewWindow(lines: readonly StyledLine[], toggleHint: string, columns: number): readonly StyledLine[] {
  if (lines.length <= CARD_PREVIEW_LINES) return lines;
  const dropped = lines.length - (CARD_PREVIEW_LINES - 1); // 头 2 + 尾 2 之外的省略行数
  const hint = toggleHint !== '' ? toggleHint : 'ctrl+o';
  const marker = truncateToWidth(`  ⋯（已省 ${dropped} 行——${hint} 展开）`, Math.max(0, columns));
  return [
    ...lines.slice(0, 2),
    ...(marker === '' ? [] : [{ plain: marker, runs: [{ start: 0, end: marker.length, style: DIM_STYLE }] }]),
    ...lines.slice(-2),
  ];
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
    // 段文本先消毒再拼接（B-render 批）：游程锚消毒后 plain——tab 展开改长
    // 后段几何仍一致（修前 plain 携 tab 记宽 1、发射展开 2 空格超帽）
    const text = sanitizeLineText(seg.text);
    plain += text;
    // tone 缺省 = 'text' 中性前景档；theme.text 可 undefined（无前景游程）
    const fg: ColorValue | undefined = theme[seg.tone ?? 'text'];
    if (fg !== undefined && plain.length > start) {
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
  // 构造位消毒先行（B-render 批）：词元切分与测宽截断都以消毒后文本为基
  // （tab 展开记宽 2——修前 tab 记宽 1、发射展开 2 空格致超帽行 autowrap
  // 漂移物理行账；游程进位 = 消毒后段长，段几何与 plain 一致）
  const delBody = sanitizeLineText(del.text);
  const addBody = sanitizeLineText(add.text);
  const segs = diffWords(delBody, addBody);
  const delRuns = segRuns(segs, 'del', theme.diffRemoved, 1); // 偏移 1 = '-' 前缀
  const addRuns = segRuns(segs, 'add', theme.diffAdded, 1); // 偏移 1 = '+' 前缀
  // 超宽走 … 记号（界面美化役批①——被切行与真实行尾可辨；尾段着色吞记号）
  const delText = `-${delBody}`;
  const addText = `+${addBody}`;
  return [
    capStyledLine({ plain: delText, runs: clampRuns(delRuns, delText.length) }, columns),
    capStyledLine({ plain: addText, runs: clampRuns(addRuns, addText.length) }, columns),
  ];
}

/** 孤立行整行着色：删红 / 增绿 / meta dim / ctx 裸行（超宽 … 记号——整行着色吞入） */
function renderSinglePatchLine(line: PatchLine, columns: number, theme: ResolvedTheme): StyledLine {
  const prefix = line.kind === 'del' || line.kind === 'add' ? (line.kind === 'del' ? '-' : '+') : '';
  // 构造位消毒先行（B-render 批）——patch 体是模型生成真源码、tab 缩进日常
  const text = sanitizeLineText(prefix + line.text);
  if (line.kind === 'del')
    return capStyledLine({ plain: text, runs: wholeRun(text, { fg: theme.diffRemoved }) }, columns);
  if (line.kind === 'add')
    return capStyledLine({ plain: text, runs: wholeRun(text, { fg: theme.diffAdded }) }, columns);
  if (line.kind === 'meta') return capStyledLine({ plain: text, runs: wholeRun(text, DIM_STYLE) }, columns);
  return capStyledLine({ plain: text, runs: [] }, columns);
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

/**
 * 单行构造位消毒（B-render 批）：sanitizeDisplayText 单源消毒（tab 语义展开
 * 2 空格 / CR 与 ESC 序列剥除 / 其余 C0 与 DEL 剥除）+ LF 归一空格（单行
 * 语义——消毒单源保留 LF 供折行族分段，本族单行构造 LF 落发射即未记账物理
 * 行）。修前构造位以原始文本测宽截断：tab 记宽 1、发射位消毒展开 2 空格
 * ——截断记宽放行的行实际发射宽超帽，终端 autowrap 产未记账物理行（物理
 * 行账漂移族）。卡头 / diff 档 / 插件行构造位统一先经本消毒再测宽截断。
 * 导出单源（backend/transcript 简行族 argsBrief/resultBrief 同律消费——
 * 2026-09-21 补修批升格；依赖方向 backend→blocks 既有）。
 */
export function sanitizeLineText(text: string): string {
  return sanitizeDisplayText(text).replace(/\n/g, ' ');
}

/** 折叠预览整面 dim（既有游程样式并入 dim——diff 色保留亮度降档） */
function addDim(line: StyledLine): StyledLine {
  if (line.runs.length === 0) {
    return line.plain === ''
      ? line
      : { plain: line.plain, runs: [{ start: 0, end: line.plain.length, style: DIM_STYLE }] };
  }
  return { plain: line.plain, runs: line.runs.map((run) => ({ ...run, style: { ...run.style, dim: true } })) };
}
