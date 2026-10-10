/**
 * 工具卡定稿形渲染（07 §4.1 R4 批 10i——三态卡）。
 *
 * 三态卡头：✓ success（isError=false）/ ✗ error（isError=true）/ ⏹ aborted
 * （details.aborted 结构化标记——tools-batch 中止合成位铸入；dim 档与次文
 * 同档弱存在感〔semantic 件 10g 裁〕）。卡头两形（UX 五问题批①——exec 卡头
 * 复刻）：bash 族 = 终态符号（语义色）+ 动词 `Ran` bold + 命令文本自研 bash
 * 词法器高亮（`bash -lc` 外壳剥除、折行帽 2 + 超出省略行）；其余工具 = 终态
 * 符号 + 工具名（平前景——界面美化役批② 名不被 dim 淹没）+ 参数简述（dim）。
 * 卡体两档：缺省**折叠**（卡头 + exec 状态行 + 「头 2 + 省略行 + 尾 2」中段
 * 截断预览〔UX 五问题批⑤——总帽 5，省略行提示 ctrl+o〕，预览整面 dim），
 * ctrl+o 会话级展开（全量行、正常亮度）。exec 卡族卡体首行状态行（批③）：
 * 退出码数值 + ` · {时长}` dim——两档恒在。
 *
 * ⑤（R-5 件 B）：组卡折叠态收敛单行 ` • Ran N commands · hint 展开`（• =
 * 最差态语义色、Ran bold、hint dim、无终态符号位）——失败/未完成组不收敛
 * 恒逐条展开（失败可见性优先）；组卡折叠预览帽路退役（折叠即单行、展开即
 * 全量）；终态符号族 ✓/✗ 恒加 bold（⏹ 维持次文档——statusSymbolStyle 单源）。
 *
 * ④⑦（Codex 样式复刻批 R-5 件 A）：exec 卡头命令续行翻 `  │ ` 独立窄槽
 * （dim 档——续行折宽 columns−4 不对齐命令起始列、超帽省略行同获槽）；bash
 * 卡族卡体翻 exec 输出窗（`  └ ` 转折首行 + 4 空格槽续行 + **整窗 dim 两档
 * 皆然** + 折叠帽 5 中段截断 + 空输出 `(no output)` 形）——替代通用
 * previewWindow/addDim 路（插件腿优先律维持）。
 *
 * diff 档（edit 类工具——patch 体卡；⑥ Codex 样式复刻批 R-5 件 C）：patch
 * 体段结构化（word-diff 件 parsePatchSections）→ 专用卡头（`• ` dim + 动词
 * bold + 路径 + `(+N −M)` 计数红绿——成功卡；失败/中止腿通用头维持）+ 段
 * 几何体（4 空格缩进 + 右对齐行号槽〔edit 回执 startLine 注入，缺席空槽
 * 诚实缺席〕+ 符号列 + 续行对齐内容列 + 行级 bg 色带〔fillBg 尾腿 + 文本
 * extent 洞补——双通道，bg 键缺席腿前景独行〕+ 硬折行〔字素硬切、游程跨
 * 折行边界保留〕+ tab 4 档）；1 删 1 增相邻对词级高亮维持（word-diff 件
 * LCS），孤立删/增整行红/绿；多文件段 `  └` 子头 + 段间空行；非段形回落
 * 通用头 + plain 体。纯函数：同一 (卡数据, columns) 恒同行集（repaint /
 * 回看器同管线零漂移）。
 *
 * 插件卡体（2026-09-17 TUI 余量收官批③——07 §4.1 插件工具渲染钩子签名
 * 钉位）：查表命中且 renderResult 钩子在场 → **每次渲染现调**（定稿渲染与
 * repaint 投影重渲各一次——不缓存、不落 durable、不进事件流，直播路与
 * repaint 恒一致律保持）；返回非空行集 = 插件卡体（tone → 批 10g 语义键
 * 着色直取）。**卡头恒宿主单源形**（终态符号 + 工具名 + 参数简述——终态
 * 判定/中止分档属宿主裁决面，插件不可覆写）。**回落恒在律**：渲染器缺席/
 * 抛错/返回空行集/载荷缺席 → 宿主缺省卡体（插件渲染器结构性不可劣化呈现
 * 面）。折叠预览 N=5 与卡体帽 200 行对插件行集同律。
 *
 * 卡面染色带（TUI 对标 Codex 五件批 C 件 R4）：toolCardBg 语义键在场时**整
 * 卡铺底**（卡头 + 卡体——组卡 / exec / diff 档 / 插件卡体 / 回落全变体在
 * renderToolCardStyledLines 出口统一施加），既有前景游程并入 bg（前景律全维
 * 持——分档与语义键引用零改）+ 游程间洞（平前景裸段）补裸 bg 游程；带覆
 * 文本 extent（0..plain.length）非全宽——与 user 块背景带同设计语言；空行
 * 裸行无带。键缺席（16 档降采 / 探测缺席 / 自定义板缺键——resolve 件三形
 * 同落 undefined）恒零施加，既有 runs 形原样（回落恒在律不变）。
 */
import {
  DIM_STYLE,
  ellipsize,
  graphemeWidth,
  sanitizeDisplayText,
  splitGraphemes,
  truncateToWidth,
  wrapText,
  type CellStyle,
  type ColorValue,
} from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import { capStyledLine, clampRuns, type StyledLine, type StyleRun } from '../backend/ansi-rows.js';
import { highlight, tokenStyle } from '../markdown/highlight/index.js';
import { diffWords, parsePatchSections, type PatchSection } from './word-diff.js';
import { lookupToolRenderer, type RendererLine, type ToolRenderResultInput } from '../../renderers.js';
import { toolFaceZh } from '../../../contracts/index.js';

/** 卡终态（↔ ToolResultMessage isError / details.aborted 的呈现分档） */
export type ToolCardStatus = 'success' | 'error' | 'aborted';

/** exec 折叠组命令条目（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条——窗收口时铸入） */
export interface ToolCardGroupCommand {
  /** 命令文本（bash 调用参数 command 键——数据面事实，呈现层只读） */
  readonly command: string;
  /** 条目终态（组级最差态聚合的数据源） */
  readonly status: ToolCardStatus;
  /** 退出码（bash 数据面卡体首行 `Exit code: N` 解析值；缺席 = 无码形） */
  readonly exitCode?: number;
}

/**
 * exec 折叠组卡数据（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条——tool-card 块
 * 新变体）：count = 窗内**已完成 toolResult 配对**条数 N（卡头 `• Ran N
 * commands` 消费——孤儿在飞不入 N）；commands = 各命令一行摘要的数据源。
 */
export interface ToolCardGroupData {
  readonly count: number;
  readonly commands: readonly ToolCardGroupCommand[];
}

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
  /** diff 档旗标（true = body 是 patch 体——⑥ 段几何渲染） */
  readonly diff: boolean;
  /**
   * diff 档行号序列（07 §4.3 ⑥——edit 成功回执 operations 段序注入）：与
   * patch 段序同源对齐，update 段取 startLine（1-based 旧侧起点）、add/delete
   * 段 undefined。整席缺席（失败/中止/回执非法形）= 行号槽空白整列（诚实
   * 缺席非伪号——apply_patch 文法无 @@ hunk 头，渲染面不可推导 Update 偏移）。
   */
  readonly diffStartLines?: ReadonlyArray<number | undefined>;
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
  /**
   * exec 折叠组数据（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条）：在场 = 组卡
   * 变体（卡头 `• Ran N commands` + 组级最差态符号 + 各命令一行摘要体）；
   * 缺席 = 单卡三态形（R4 既有律）。组卡是宿主组级聚合面——不铸 renderInput
   * （插件腿不进组卡）。
   */
  readonly group?: ToolCardGroupData;
}

/** 终态符号（卡头首段——状态分档可辨形；注⑩：失败位 ✗ 形〔✖ 退役〕） */
const STATUS_SYMBOL: Readonly<Record<ToolCardStatus, string>> = { success: '✓', error: '✗', aborted: '⏹' };

/**
 * 终态符号段样式（⑤——终态符号族 ✓/✗ 恒加 bold；⏹ 中止维持次文档不加）。
 * 三消费位单源：exec 单卡头 / 通用卡头 / 组卡展开头（收敛行无终态符号位
 * 不消费）。
 */
function statusSymbolStyle(status: ToolCardStatus, fg: ColorValue): CellStyle {
  return status === 'aborted' ? { fg } : { fg, bold: true };
}

/**
 * 输出护栏注记行识别（V-2 笔2 注④双轨分层）：pipeline 固定链尾步对超帽
 * 文本产物追加 `[输出 N 字节超 M 字节上限，已保尾截断…]` 注记行（含外溢
 * 路径形——04 §7 模型面语义不动：模型循路径自取全文的指令面）。用户面
 * 呈现层对该行做转写（字节计量 → 行计量人读形），勿直改 pipeline 注记。
 */
const GUARD_NOTE_PATTERN = /^\[输出 \d+ 字节超 \d+ 字节上限，已保尾截断[^\n]*$/;

/**
 * 护栏注记呈现层转写（注④——纯函数）：剥字节注记行、前置 `⋯ +N 行`
 * （N = 实际保留行数现算——「此下共 N 行」的省略提示形）。注记自带的排版
 * 空行（pipeline 形 `产物\n\n[输出…]`）随注记一并收口；产物正文的空行
 * **保留**（全量去空行越界修）。无注记原样返回（regex 不中零改写——非
 * 护栏产物不受影响）。
 */
export function humanizeGuardedOutput(text: string): string {
  if (!text.includes('[输出 ')) return text; // 速径：无注记候选零成本
  const raw = text.split('\n');
  if (!raw.some((line) => GUARD_NOTE_PATTERN.test(line))) return text; // 无命中原样（速径含 '[输出 ' 但 regex 不中——非护栏产物）
  // 只剥注记行 + 其邻接排版空行段（正文空行保留——N 按实际保留行数计）
  const kept = raw.filter((line, i) => !GUARD_NOTE_PATTERN.test(line) && !(line === '' && noteAdjacent(raw, i)));
  return kept.length === 0 ? '' : `⋯ +${kept.length} 行\n${kept.join('\n')}`;
}

/**
 * 空行的注记邻接判词（pipeline.ts 注记形 `产物\n\n[输出…]`——`\n\n` 铸出的
 * 排版空行段）：空行下方穿过连续空行后直通注记行即属邻接段（tail 末自带
 * `\n` 时注记前成段多行同剥）。修前 `line !== ''` 全量去空行越界——正文
 * 空行被抹且 N 只计非空行失真；本判词把剥除面收口到注记自带排版空行。
 */
function noteAdjacent(raw: readonly string[], i: number): boolean {
  for (let j = i + 1; j < raw.length; j++) {
    if (raw[j] === '') continue; // 连续空行段内继续下探
    return GUARD_NOTE_PATTERN.test(raw[j]!); // 段下首个非空行定分：注记 = 邻接、正文 = 保留
  }
  return false; // 下方全空行（文末）——非注记邻接，正文空行保留
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
 * 卡体首行状态行（UX 五问题批③——exec 卡族）：退出码数值 + ` · {时长}` dim
 * （时长近似 = durationMs——transcript 铸入），折叠展开两档恒在（钉在预览
 * 窗上方）。卡体折叠 = 头 2 + 省略行 + 尾 2 中段截断（UX 五问题批⑤），展开
 * = 全量行。插件腿现调在卡体源选择之前（07 钉位注）——命中即插件卡体，
 * 回落形与宿主缺省同走下方两档渲染（折叠/展开/预览对插件行集同律）。
 */
export function renderToolCardStyledLines(card: ToolCardView, columns: number): StyledLine[] {
  // 组卡变体先分诊（07 §4.1 V-3 注⑩ exec 折叠组词条）：组级形是宿主聚合面
  // ——exec 单卡头/插件腿/状态行三机制均不进组卡（renderInput 不铸入，故
  // 插件腿结构性缺席）；折叠/展开/预览帽复用单卡机制（零新呈现机制）；卡
  // 面染色出口统一施加（组卡同律——变体零遗漏）
  if (card.group !== undefined) {
    return renderGroupCardStyledLines(card, card.group, columns).map((line) => withCardBg(line, card.theme.toolCardBg));
  }
  const statusColor =
    card.status === 'success' ? card.theme.success : card.status === 'error' ? card.theme.error : card.theme.secondary;
  const headerLines = renderExecHeaderLines(card, columns, statusColor) ?? [
    renderGenericHeaderLine(card, columns, statusColor),
  ];
  // 插件卡体现调（null = 回落——未命中/抛错/空行集/载荷缺席四形同落宿主缺省）
  const pluginBody = renderPluginBodyLines(card, columns);
  // 状态行（exec 卡族恒 dim——折叠/展开两档同形，钉卡头之后卡体之前）
  const statusLine = renderExecStatusLine(card);
  // ④ 分路：bash 卡族（插件腿缺席——插件渲染钩子优先律维持）卡体 = exec 输出
  // 窗终形（└ 槽 + 整窗 dim + 折叠帽自持——两档皆窗，绕过下方通用两档路；
  // diff 档恒非 bash——edit 族卡，不另判）
  if (card.name === 'bash' && pluginBody === null) {
    const window = renderExecOutputWindow(card.body, columns, card.expanded);
    const body = statusLine === null ? window : [statusLine, ...window];
    return [...headerLines, ...body].map((line) => withCardBg(line, card.theme.toolCardBg));
  }
  // ⑥ diff 档分路：patch 体段结构化成功 → 专用卡头 + 段几何体（4 空格缩进 +
  // 右对齐行号槽 + 符号列 + 行级 bg 色带 + 硬折行 + tab 4 档）；非段形（模型
  // 输出坏形防御）回落下方通用路（通用头 + plain 体——不装 diff 几何）。
  // 成功卡换专用头（• 动词 路径/计数——edit 族专用形不破 argsBrief 白名单
  // 面）；失败/中止腿通用头维持（失败可见性优先——✗/⏹ 符号位保留）。edit
  // 族恒非 bash → statusLine 结构性缺席（renderExecStatusLine 判 bash）
  if (card.diff) {
    const sections = parsePatchSections(card.body.join('\n'));
    if (sections.length > 0) {
      const headerLines =
        card.status === 'success'
          ? [renderDiffHeaderLine(sections, columns, card.theme)]
          : [renderGenericHeaderLine(card, columns, statusColor)];
      const bodyLines = renderDiffSectionLines(sections, columns, card.theme, card.diffStartLines);
      const body = card.expanded ? bodyLines : previewWindow(bodyLines, card.toggleHint, columns).map(addDim);
      return [...headerLines, ...body].map((line) => withCardBg(line, card.theme.toolCardBg));
    }
    // 非段形回落（模型坏形防御）：通用头 + 逐行截断裸体（不装 diff 几何、
    // 不折行——窄宽截断帽与段形路径同律，1 列极端窄无单字素例外）
    const bodyLines = card.body.map((line) => {
      const clipped = truncateToWidth(sanitizeLineText(line, DIFF_TAB_WIDTH), columns);
      return { plain: clipped, runs: [] };
    });
    const headerLines = [renderGenericHeaderLine(card, columns, statusColor)];
    const body = card.expanded ? bodyLines : previewWindow(bodyLines, card.toggleHint, columns).map(addDim);
    return [...headerLines, ...body].map((line) => withCardBg(line, card.theme.toolCardBg));
  }
  // 通用路（含 diff 非段形回落）：插件腿 ?? plain 体（diff 段形已在上方分路）
  const bodyLines = pluginBody ?? renderPlainBodyLines(card.body, columns);
  const body = card.expanded
    ? statusLine === null
      ? bodyLines
      : [statusLine, ...bodyLines]
    : statusLine === null
      ? previewWindow(bodyLines, card.toggleHint, columns).map(addDim)
      : [statusLine, ...previewWindow(bodyLines, card.toggleHint, columns).map(addDim)];
  return [...headerLines, ...body].map((line) => withCardBg(line, card.theme.toolCardBg));
}

/**
 * 卡面染色带施加（TUI 对标 Codex 五件批 C 件 R4——toolCardBg 整卡铺底单源）：
 * bg 缺席（16 档降采/探测缺席/自定义板缺键）或空行（裸行——user 块包夹空行
 * 同形）原样返回；在场则既有游程样式并入 bg（前景分档与语义键引用全维持
 * ——addDim 游程并入同构范式）+ 游程间洞（平前景裸段）补裸 bg 游程，带覆文
 * 本 extent（0..plain.length）非全宽。纯施加——plain 与游程几何零改。
 */
function withCardBg(line: StyledLine, bg: ColorValue | undefined): StyledLine {
  // fillBg 在场行（⑥ diff 行 bg 带）整行跳过：该行自持 bg 面（runs 已含
  // diffAddedBg/diffRemovedBg + fillBg 尾腿），卡面 bg 不覆写（局部覆盖律）
  if (bg === undefined || line.plain === '' || line.fillBg !== undefined) return line;
  const runs: StyleRun[] = [];
  let cursor = 0;
  for (const run of line.runs) {
    // 洞补：上一游程尾与本游程头之间的裸段铺裸 bg（文本 extent 内）
    if (run.start > cursor) runs.push({ start: cursor, end: run.start, style: { bg } });
    runs.push({ start: run.start, end: run.end, style: { ...run.style, bg } });
    cursor = Math.max(cursor, run.end);
  }
  // 尾洞：末游程尾至行尾的裸段铺裸 bg（runs 空集时 = 整行单 bg 游程）
  if (cursor < line.plain.length) runs.push({ start: cursor, end: line.plain.length, style: { bg } });
  return { plain: line.plain, runs };
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
  const runs: StyleRun[] = [{ start: 0, end: 2, style: statusSymbolStyle(card.status, statusColor) }]; // 符号段（含首空格）
  if (brief !== '') runs.push({ start: 3 + name.length, end: header.length, style: DIM_STYLE }); // 简述段（名段平前景无游程——' ✓ ' 前缀 3 + 名长，名末字符不被 dim 淹没）
  // 卡头屏宽帽（F6）：plain 整字截断 + 游程同步钳制（符号段/简述段跨界收尾）
  return capStyledLine({ plain: header, runs }, columns);
}

/** exec 卡头命令折行帽（UX 五问题批①——超出走省略行；⑦ 帽语义 = 首行 + 续行总视觉行帽） */
const EXEC_HEADER_COMMAND_LINES = 2;

/** exec 卡头前缀宽（` ✓ Ran $ ` ——1+1+1+3+1+1+1 = 9 列；`$ ` 命令位〔注⑩〕；首行命令预算让位） */
const EXEC_HEADER_PREFIX_WIDTH = 9;

/** exec 卡头续行轨道前缀（⑦——`  │ ` 独立窄槽：2 空格 + 轨道线 + 空格；④ 符号册 │ 新符，dim 档） */
const EXEC_TRACK_PREFIX = '  │ ';

/**
 * exec 卡头行集（bash 族——UX 五问题批① 复刻 codex 形；⑦ 续行翻独立窄槽）。
 * 命令源 = 卡面 renderInput.arguments 的 `command` 键（数据面事实——呈现层
 * 只读）；缺席/非字符串返 null（调用方回落常量卡头）。序：消毒 → `bash -lc`
 * 外壳剥除 → **两段折行**（⑦：首段在卡头前缀让位预算 columns−9 内纯截断
 * 〔truncateToWidth 纯前缀形——余量 slice 精确衔接〕；余量进续行窄槽
 * columns−4 折行——**不对齐命令起始列**）→ 总视觉行帽 2 → 超帽省略行（同获
 * `  │ ` 槽 + 整行 dim）→ 逐行词法高亮（自研 bash 词法器——codeKeyword 键
 * 族，串接恒等原文律保证游程进位无漂移）。
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
  // ⑦ 两段折行：首段纯截断（前缀让位预算）、余量窄槽折行（独立域不与首行
  // 折行耦合——续行视觉行 = wrapText(rest) 段集）
  const first = truncateToWidth(command, Math.max(1, columns - EXEC_HEADER_PREFIX_WIDTH));
  const rest = command.slice(first.length);
  const wrappedRest = rest === '' ? [] : wrapText(rest, Math.max(1, columns - EXEC_TRACK_PREFIX.length));
  const shownRest = wrappedRest.slice(0, EXEC_HEADER_COMMAND_LINES - 1);
  // 首行（既有形维持）：符号段语义色 + 动词 Ran bold + `$` 位符 dim + 命令高亮
  const firstPlain = ` ${STATUS_SYMBOL[card.status]} Ran $ ${first}`;
  const firstRuns: StyleRun[] = [
    { start: 0, end: 2, style: statusSymbolStyle(card.status, statusColor) }, // 符号段（含首空格——失败红系/中止次文维持）
    { start: 3, end: 6, style: { bold: true } }, // 动词段 Ran bold（成功/失败同词）
    { start: 7, end: 8, style: DIM_STYLE }, // `$` 命令位符 dim（注⑩——位符弱存在感，命令文本主体亮度）
  ];
  firstRuns.push(...commandRuns(first, EXEC_HEADER_PREFIX_WIDTH, card.theme));
  const lines: StyledLine[] = [capStyledLine({ plain: firstPlain, runs: firstRuns }, columns)];
  // 续行（⑦）：`  │ ` 轨道前缀 dim 游程 + 命令段高亮自槽后起（无动词/位符段）
  for (const seg of shownRest) {
    const plain = EXEC_TRACK_PREFIX + seg;
    const runs: StyleRun[] = [{ start: 0, end: EXEC_TRACK_PREFIX.length, style: DIM_STYLE }];
    runs.push(...commandRuns(seg, EXEC_TRACK_PREFIX.length, card.theme));
    lines.push(capStyledLine({ plain, runs }, columns));
  }
  const totalVisual = 1 + wrappedRest.length;
  if (totalVisual > EXEC_HEADER_COMMAND_LINES) {
    // 命令超折行帽：省略行收口（⑦——同获 │ 槽 + 整行 dim；文案与 ④ 输出窗
    // 省略行 `⋯ +N 行` 同族：N = 帽外省略的视觉行数）
    const dropped = totalVisual - (1 + shownRest.length);
    const marker = `${EXEC_TRACK_PREFIX}⋯ +${dropped} 行`;
    lines.push(capStyledLine({ plain: marker, runs: [{ start: 0, end: marker.length, style: DIM_STYLE }] }, columns));
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
 * 组级最差态聚合（词条三态序：任一 aborted ⏹ > 任一 error ✗ > 全成 ✓——
 * 中止优先于失败）：渲染位从组数据现算（数据单源——与铸卡位同式，块面
 * status 字段是账面冗余位非渲染源）。
 */
function worstGroupStatus(group: ToolCardGroupData): ToolCardStatus {
  if (group.commands.some((command) => command.status === 'aborted')) return 'aborted';
  if (group.commands.some((command) => command.status === 'error')) return 'error';
  return 'success';
}

/**
 * exec 折叠组卡渲染（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条——组级形；
 * ⑤ 收敛翻档）：折叠态 × 全成功组 → **收敛单行** ` • Ran {N} commands ·
 * {hint} 展开`（• = 组内最差态语义色〔非新键〕含首空格段、Ran 动词段
 * bold 〔exec 单卡先例〕、` · hint 展开` 段 dim；**无终态符号位**——「组级
 * 最差态符号」半句随 ⑤ 翻档）；**失败/未完成组不收敛**（worst ∈ error/
 * aborted——失败可见性优先，恒逐条展开形）；展开态逐条形维持（头 = 终态
 * 符号 + `• Ran {N} commands`）。逐条行 = 各命令一行摘要（`$ ` 前缀 dim +
 * 命令文本截断〔ellipsize `…` 单源——界面美化役注① 全域律〕+ 退出码位
 * 〔失败腿非零码 ` (N)` 后缀 error 色；成功零码不显——UX 批④ 信息零值不
 * 占屏同律〕）；卡体帽 200 行同律；折叠/展开走 ctrl+o 会话级既有律（组卡
 * 即卡零新展开机制——折叠预览帽路在组卡随 ⑤ 退役：折叠即单行、展开即
 * 全量）。纯函数：同 (组数据, columns) 恒同行集（repaint 投影重建同管线
 * 零漂移）。
 */
function renderGroupCardStyledLines(card: ToolCardView, group: ToolCardGroupData, columns: number): StyledLine[] {
  const status = worstGroupStatus(group);
  // ⑤ 收敛判据：折叠档 × 全成功组——失败/未完成（error/aborted）组不收敛
  //（失败可见性优先——命令列表恒可见），走下方展开形
  if (!card.expanded && status === 'success') {
    return [collapsedGroupLine(group, columns, card.toggleHint, card.theme.success)];
  }
  const statusColor =
    status === 'success' ? card.theme.success : status === 'error' ? card.theme.error : card.theme.secondary;
  const headerPlain = ` ${STATUS_SYMBOL[status]} • Ran ${group.count} commands`;
  const header = capStyledLine(
    {
      plain: headerPlain,
      runs: [
        { start: 0, end: 2, style: statusSymbolStyle(status, statusColor) }, // 符号段（含首空格——语义色，✓/✗ 恒 bold）
        { start: 5, end: 8, style: { bold: true } }, // Ran 动词段（exec 单卡先例——成功/失败同词）
      ],
    },
    columns,
  );
  return [header, ...groupCommandLines(group.commands, columns, card.theme)];
}

/**
 * 组卡折叠收敛单行（⑤）：` • Ran {N} commands · {hint} 展开`——• 段（含首
 * 空格——组内最差态语义色，非终态符号族不 bold）+ Ran 动词段 bold + ` ·
 * hint 展开` 段 dim（hint 空回退 'ctrl+o'——previewWindow 同律）。行恒受
 * 屏宽帽（卡头族 F6 律）。
 */
function collapsedGroupLine(group: ToolCardGroupData, columns: number, toggleHint: string, fg: ColorValue): StyledLine {
  const head = ` • Ran ${group.count} commands`;
  const hint = toggleHint !== '' ? toggleHint : 'ctrl+o';
  const tail = ` · ${hint} 展开`;
  return capStyledLine(
    {
      plain: head + tail,
      runs: [
        { start: 0, end: 2, style: { fg } },
        { start: 3, end: 6, style: { bold: true } },
        { start: head.length, end: head.length + tail.length, style: DIM_STYLE },
      ],
    },
    columns,
  );
}

/**
 * 组卡体命令行集：各命令一行摘要 + 卡体帽同律（超帽截头保尾 + 截断标记首行
 * ——CARD_BODY_MAX_LINES 同语义；组命令数超帽属病理性长窗，防御位在册）。
 */
function groupCommandLines(
  commands: readonly ToolCardGroupCommand[],
  columns: number,
  theme: Readonly<ResolvedTheme>,
): StyledLine[] {
  const lines = commands.map((command) => groupCommandLine(command, columns, theme));
  if (lines.length <= CARD_BODY_MAX_LINES) return lines;
  const dropped = lines.length - CARD_BODY_MAX_LINES;
  const marker = `⋯（前文已省 ${dropped} 行）`;
  return [
    { plain: marker, runs: [{ start: 0, end: marker.length, style: DIM_STYLE }] },
    ...lines.slice(-CARD_BODY_MAX_LINES),
  ];
}

/**
 * 单命令摘要行：`$ ` 前缀（`$` 位符 dim——注⑩ 命令位，同 exec 单卡头）+
 * 命令文本（消毒 + `bash -lc` 外壳剥除 + ellipsize 截到剩余宽）+ 退出码位。
 * 预算 = columns − `$ ` 前缀 2 − 退出码后缀宽（后缀在场恒保——失败定位可辨）。
 */
function groupCommandLine(command: ToolCardGroupCommand, columns: number, theme: Readonly<ResolvedTheme>): StyledLine {
  // 退出码位：非零码 ` (N)` 后缀（零码不显——UX 批④ 同律；无码形〔aborted/
  // EXEC_TIMEOUT 族〕无后缀）
  const suffix = command.exitCode !== undefined && command.exitCode !== 0 ? ` (${command.exitCode})` : '';
  const text = ellipsize(
    stripShellWrapper(sanitizeLineText(command.command)),
    Math.max(1, columns - 2 - suffix.length),
  );
  const plain = `$ ${text}${suffix}`;
  const runs: StyleRun[] = [{ start: 0, end: 1, style: DIM_STYLE }]; // `$` 位符段
  if (suffix !== '' && command.status === 'error') {
    // 退出码段失败可辨（` (N)` 的括号段——前导空格不染色，弱存在感同 `$` 位）
    runs.push({ start: plain.length - suffix.length + 1, end: plain.length, style: { fg: theme.error } });
  }
  return capStyledLine({ plain, runs }, columns);
}

/**
 * exec 卡族状态行（UX 五问题批③——卡体首行）：`({退出码}) · {时长}` / 成功
 * 腿 `• {时长}`（Exit code: 0 渲染层不显——数据面由装配位渲染器过滤，本行
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
  const plain =
    codeSegment === '' ? `• ${formatDuration(card.durationMs)}` : `${codeSegment} · ${formatDuration(card.durationMs)}`;
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

/** exec 输出窗首行转折前缀（④——`  └ `：2 空格 + 转折符 + 空格；与 4 空格续行槽同 4 列对齐） */
const EXEC_WINDOW_PREFIX = '  └ ';

/**
 * exec 输出窗槽宽（④——`  └ ` 首行与 4 空格续行/省略行槽同宽；窗行折宽
 * columns − 4 让位）。挖掘 29 轮件 3 单源化：前缀长派生（前缀两空格+转折符
 * +空格 = 4 码位恒与显示列同值）——前缀变槽宽随动，三源（exec 窗前缀/槽宽
 * /diff 段头）归一。
 */
const EXEC_WINDOW_SLOT_WIDTH = EXEC_WINDOW_PREFIX.length;

/**
 * exec 输出窗（④——Codex 样式复刻批）：bash 卡族卡体专用形（装配位
 * renderToolCardStyledLines 分路启用——插件腿缺席时，插件渲染钩子优先律
 * 维持）。首视觉行 `  └ ` 转折前缀、其余视觉行 4 空格槽（└ 词条扩例——
 * ④ 符号册）；折宽 columns − 4（槽宽让位）；**整窗 DIM 档**——前缀与内容
 * 同档单游程（批 10i「展开正常亮度」两档律于 exec 输出窗翻档：折叠/展开
 * 两档皆 dim）。折叠帽 5 = 头 2 + 省略行（4 空格槽 `⋯ +N 行`——N = 中段
 * 省略的视觉行数；文案与 ⑦ 卡头省略行同族）+ 尾 2（中段截断既有律）；
 * 展开 = 全量窗行。空输出（全行皆空——含 cardBodyOf('') 的 [''] 形）→
 * `  └ (no output)` dim 单行（§4.4 文案律——落码定值）。
 */
function renderExecOutputWindow(body: readonly string[], columns: number, expanded: boolean): StyledLine[] {
  // 空输出判据：全行皆空串（多空行形同落——「无输出」语义不看行数看内容）
  if (body.every((line) => line === '')) {
    const plain = `${EXEC_WINDOW_PREFIX}(no output)`;
    return [{ plain, runs: [{ start: 0, end: plain.length, style: DIM_STYLE }] }];
  }
  // 体行 join 整体折行（wrapText 显式 \n 分段保留空行段——窗内空行语义不
  // 丢）；首视觉行 └、其余视觉行 4 空格槽——源行界与折行续行界同形（视觉
  // 行序 ≥ 1 恒槽，两界无需区分）
  const wrapped = wrapText(body.join('\n'), Math.max(1, columns - EXEC_WINDOW_SLOT_WIDTH));
  const visual: StyledLine[] = wrapped.map((line, i): StyledLine => {
    const plain = (i === 0 ? EXEC_WINDOW_PREFIX : ' '.repeat(EXEC_WINDOW_SLOT_WIDTH)) + line;
    // 整窗 dim 单游程（纯空格槽行同律——前缀槽也是窗体）
    return { plain, runs: [{ start: 0, end: plain.length, style: DIM_STYLE }] };
  });
  if (expanded || visual.length <= CARD_PREVIEW_LINES) return visual;
  const dropped = visual.length - (CARD_PREVIEW_LINES - 1); // 头 2 + 尾 2 之外的省略视觉行数
  const marker = truncateToWidth(`${' '.repeat(EXEC_WINDOW_SLOT_WIDTH)}⋯ +${dropped} 行`, Math.max(0, columns));
  return [
    ...visual.slice(0, 2),
    ...(marker === '' ? [] : [{ plain: marker, runs: [{ start: 0, end: marker.length, style: DIM_STYLE }] }]),
    ...visual.slice(-2),
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

/* ---------------- ⑥ diff 档段几何与 bg 双通道（R-5 件 C——codex 对标） ---------------- */

/** diff 块体 4 空格缩进（codex diff 前缀位——块体各行共享） */
const DIFF_INDENT = '    ';
/** diff 位 tab 展开档（07 §4.3 ⑥——全域缺省 2 维持，diff 位专用 4） */
const DIFF_TAB_WIDTH = 4;

/** 段行 kind（渲染位形——meta 已被段结构化消费） */
type DiffRowKind = 'ctx' | 'del' | 'add';

/** 计数括号串与游程（`(+N −M)`——+N 绿/−M 红/括号默认色；runs 相对串起点） */
function diffCountRuns(added: number, removed: number, theme: ResolvedTheme): { text: string; runs: StyleRun[] } {
  const addedText = `+${added}`;
  const removedText = `−${removed}`;
  return {
    text: `(${addedText} ${removedText})`,
    runs: [
      { start: 1, end: 1 + addedText.length, style: { fg: theme.diffAdded } },
      {
        start: 2 + addedText.length,
        end: 2 + addedText.length + removedText.length,
        style: { fg: theme.diffRemoved },
      },
    ],
  };
}

/** 段 added 行数（'+' 标记行——计数括号与卡头总计数消费） */
function sectionAdded(section: PatchSection): number {
  return section.lines.filter((line) => line.kind === 'add').length;
}

/** 段 removed 行数（'-' 标记行） */
function sectionRemoved(section: PatchSection): number {
  return section.lines.filter((line) => line.kind === 'del').length;
}

/**
 * diff 卡头行（成功卡专用形）：`• ` dim + 动词 bold + 路径 + `(+N −M)` 计数
 * 括号。单文件动词随段（Added/Deleted/Edited）+ 路径在头（无段头）；多文件
 * `Edited N files` + 总计数（N = 去重路径数——同文件多段罕见形按路径数计）。
 * delete 段无行体 → 无计数括号（无行体无计数——诚实）。
 */
function renderDiffHeaderLine(sections: readonly PatchSection[], columns: number, theme: ResolvedTheme): StyledLine {
  const verbOf = (section: PatchSection): string =>
    section.kind === 'add' ? 'Added' : section.kind === 'delete' ? 'Deleted' : 'Edited';
  let plain: string;
  let runs: StyleRun[];
  if (sections.length === 1) {
    const section = sections[0]!;
    const verb = verbOf(section);
    plain = `• ${verb} ${sanitizeLineText(section.path)}`;
    runs = [
      { start: 0, end: 2, style: DIM_STYLE }, // '• '
      { start: 2, end: 2 + verb.length, style: { bold: true } }, // 动词段
    ];
    if (section.kind !== 'delete') {
      const counts = diffCountRuns(sectionAdded(section), sectionRemoved(section), theme);
      const base = plain.length + 1;
      plain += ` ${counts.text}`;
      runs.push(...counts.runs.map((run) => ({ ...run, start: run.start + base, end: run.end + base })));
    }
  } else {
    const fileCount = new Set(sections.map((section) => section.path)).size;
    plain = `• Edited ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
    runs = [
      { start: 0, end: 2, style: DIM_STYLE },
      { start: 2, end: 8, style: { bold: true } }, // 'Edited'
    ];
    const totalAdded = sections.reduce((sum, section) => sum + sectionAdded(section), 0);
    const totalRemoved = sections.reduce((sum, section) => sum + sectionRemoved(section), 0);
    const counts = diffCountRuns(totalAdded, totalRemoved, theme);
    const base = plain.length + 1;
    plain += ` ${counts.text}`;
    runs.push(...counts.runs.map((run) => ({ ...run, start: run.start + base, end: run.end + base })));
  }
  return capStyledLine({ plain, runs }, columns);
}

/** 多文件段头行：`  └ ` dim + 路径裸 + 计数红绿（delete 段无计数括号）；前缀引 exec 窗常量单源（挖掘 29 轮件 3） */
function renderDiffSectionHeaderLine(section: PatchSection, columns: number, theme: ResolvedTheme): StyledLine {
  let plain = `${EXEC_WINDOW_PREFIX}${sanitizeLineText(section.path)}`;
  const runs: StyleRun[] = [{ start: 0, end: EXEC_WINDOW_PREFIX.length, style: DIM_STYLE }]; // '  └ ' dim 前缀
  if (section.kind !== 'delete') {
    const counts = diffCountRuns(sectionAdded(section), sectionRemoved(section), theme);
    const base = plain.length + 1;
    plain += ` ${counts.text}`;
    runs.push(...counts.runs.map((run) => ({ ...run, start: run.start + base, end: run.end + base })));
  }
  return capStyledLine({ plain, runs }, columns);
}

/**
 * diff 段集 → 行集：多文件逐段 `  └` 段头 + 段间空行（单文件段头 skip——
 * 路径已在卡头）；段体行号流见 renderDiffSectionBodyLines 注。
 */
function renderDiffSectionLines(
  sections: readonly PatchSection[],
  columns: number,
  theme: ResolvedTheme,
  startLines: ReadonlyArray<number | undefined> | undefined,
): StyledLine[] {
  const lines: StyledLine[] = [];
  sections.forEach((section, i) => {
    if (i > 0) lines.push({ plain: '', runs: [] }); // 段间空行
    if (sections.length > 1) lines.push(renderDiffSectionHeaderLine(section, columns, theme));
    lines.push(...renderDiffSectionBodyLines(section, columns, theme, startLines?.[i]));
  });
  return lines;
}

/**
 * 段体行集：行号流 + 逐行几何。行号流——update 段双计数器自 startLine 起
 * （ctx 显旧侧号两侧同进、del 旧侧、add 新侧；add 段自 1；startLine 缺席
 * 〔失败/回执缺席〕全空号——诚实缺席非伪号）。1 删 1 增相邻对走词级
 * intra-line 高亮（R4 主形态维持）；孤立删/增整行红/绿（R4 前景律——含
 * 号槽/符号列整行着色）；ctx 裸。tab 4 档消毒先行。
 */
function renderDiffSectionBodyLines(
  section: PatchSection,
  columns: number,
  theme: ResolvedTheme,
  startLine: number | undefined,
): StyledLine[] {
  if (section.kind === 'delete') return []; // 纯删除段无行体（只有卡头/段头）
  // 行号计数器：update 双侧同起 startLine；add 段新侧自 1（旧侧不在场）
  let oldNo: number | undefined = section.kind === 'update' ? startLine : undefined;
  let newNo: number | undefined = section.kind === 'add' ? 1 : startLine;
  const rows: Array<{ kind: DiffRowKind; text: string; lineNo: number | undefined }> = [];
  for (const line of section.lines) {
    // ctx 行剥文法前导空格（apply_patch ctx 标记列——符号列自置空格）
    const text = line.kind === 'ctx' && line.text.startsWith(' ') ? line.text.slice(1) : line.text;
    if (line.kind === 'ctx') {
      // add 段宽容 ctx 按内容收（号随新侧）；update 段 ctx 显旧侧号
      rows.push({ kind: 'ctx', text, lineNo: section.kind === 'add' ? newNo : oldNo });
      if (oldNo !== undefined) oldNo++;
      if (newNo !== undefined) newNo++;
    } else if (line.kind === 'del') {
      rows.push({ kind: 'del', text, lineNo: oldNo });
      if (oldNo !== undefined) oldNo++;
    } else {
      rows.push({ kind: 'add', text, lineNo: newNo });
      if (newNo !== undefined) newNo++;
    }
  }
  // 号槽宽 = 段内显号最大位数（min 1——无号段空槽 1，符号列跨行恒对齐）
  const gutterWidth = Math.max(1, ...rows.map((row) => (row.lineNo === undefined ? 0 : String(row.lineNo).length)));
  const lines: StyledLine[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind === 'del' && rows[i + 1]?.kind === 'add') {
      // 词级对（R4 主形态）：del 行 + add 行各带号与 bg，变字段段着色锚段裸
      const add = rows[i + 1]!;
      const delText = sanitizeLineText(row.text, DIFF_TAB_WIDTH);
      const addText = sanitizeLineText(add.text, DIFF_TAB_WIDTH);
      const segs = diffWords(delText, addText);
      lines.push(
        ...diffRowStyledLines(
          'del',
          delText,
          row.lineNo,
          gutterWidth,
          columns,
          theme,
          segRuns(segs, 'del', theme.diffRemoved, 0),
          false,
        ),
      );
      lines.push(
        ...diffRowStyledLines(
          'add',
          addText,
          add.lineNo,
          gutterWidth,
          columns,
          theme,
          segRuns(segs, 'add', theme.diffAdded, 0),
          false,
        ),
      );
      i += 2;
      continue;
    }
    // 孤立行整行红/绿（含号槽/符号列——R4 整行前景律）；ctx 裸（无色无 bg）
    const text = sanitizeLineText(row.text, DIFF_TAB_WIDTH);
    const fg = row.kind === 'del' ? theme.diffRemoved : row.kind === 'add' ? theme.diffAdded : undefined;
    lines.push(
      ...diffRowStyledLines(
        row.kind,
        text,
        row.lineNo,
        gutterWidth,
        columns,
        theme,
        fg === undefined ? [] : wholeRun(text, { fg }),
        fg !== undefined, // 整行着色旗（前缀段并入 fg——词级对行前缀恒裸）
      ),
    );
    i++;
  }
  return lines;
}

/**
 * 单 diff 行 → 带样式行集（⑥ 行几何核心）：首行 = 4 空格 + 右对齐号槽（缺
 * 席 = 空槽）+ 空格 + 符号列（+/−/空格）+ 内容；续行 = 内容列对齐（4 +
 * gutterWidth + 2 空格）。内容列**硬折行**（字素推进硬切——整字截断退役，
 * 前导空格保留：内容对齐是代码 diff 的语义）；contentRuns 相对内容串起点，
 * 按源区间交集平移到各折行段（游程跨折行边界保留）。paintWholeRow = 整行
 * 着色旗（孤立行——各折行段整行单游程 fg）。bg 双通道：del/add 行 bg 键在
 * 场 → 文本 extent runs 洞补 + fillBg 尾腿（BCE 全宽）；缺席腿前景独行。
 * 全行恒过整行帽（极窄屏 < 8 列兜底截断——发射宽恒 ≤ 屏宽）。
 */
function diffRowStyledLines(
  kind: DiffRowKind,
  content: string,
  lineNo: number | undefined,
  gutterWidth: number,
  columns: number,
  theme: ResolvedTheme,
  contentRuns: StyleRun[],
  paintWholeRow: boolean,
): StyledLine[] {
  const sign = kind === 'del' ? '-' : kind === 'add' ? '+' : ' ';
  const gutter = lineNo === undefined ? ' '.repeat(gutterWidth) : String(lineNo).padStart(gutterWidth);
  const contentCol = DIFF_INDENT.length + gutterWidth + 2; // 首行内容列 = 续行内容列
  const segments = wrapByGraphemes(content, Math.max(1, columns - contentCol));
  const bg = kind === 'add' ? theme.diffAddedBg : kind === 'del' ? theme.diffRemovedBg : undefined;
  const lines: StyledLine[] = [];
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    const prefix = s === 0 ? `${DIFF_INDENT}${gutter} ${sign}` : ' '.repeat(contentCol);
    const plain = `${prefix}${seg.text}`;
    const rowRuns = paintWholeRow
      ? wholeRun(plain, contentRuns[0]?.style ?? {}) // 孤立行：整行（含号槽/符号列）单游程
      : mapRunsOntoSegment(contentRuns, seg.start, seg.end, prefix.length);
    if (bg !== undefined) {
      // bg 在场：文本 extent 全覆盖（前缀/游程间洞补裸 bg）+ fillBg 尾腿铺屏宽
      const merged: StyleRun[] = [];
      let cursor = 0;
      for (const run of rowRuns) {
        if (run.start > cursor) merged.push({ start: cursor, end: run.start, style: { bg } });
        merged.push({ ...run, style: { ...run.style, bg } });
        cursor = Math.max(cursor, run.end);
      }
      if (cursor < plain.length) merged.push({ start: cursor, end: plain.length, style: { bg } });
      // cap 后回填 fillBg（capStyledLine 重建行对象不带尾腿字段）
      lines.push({ ...capStyledLine({ plain, runs: merged }, columns), fillBg: bg });
    } else {
      lines.push(capStyledLine({ plain, runs: rowRuns }, columns)); // bg 缺席腿：前景独行
    }
  }
  return lines;
}

/**
 * 内容列硬折行（字素推进硬切）：产出源串 UTF-16 区间随段携带（供游程交集
 * 映射）；空内容单空段（首行仍出——bg 带形）。与 wrapText 分立：diff 内容
 * 列保真优先（wrapText 续行跳行首空格会丢字符——内容对齐是代码 diff 的语义）。
 */
function wrapByGraphemes(text: string, avail: number): Array<{ text: string; start: number; end: number }> {
  if (text === '') return [{ text: '', start: 0, end: 0 }];
  const segments: Array<{ text: string; start: number; end: number }> = [];
  let current = '';
  let start = 0;
  let width = 0;
  for (const grapheme of splitGraphemes(text)) {
    const w = graphemeWidth(grapheme);
    // 硬切：累计宽超内容列即断段（当前段非空——单字素超列直接入段由整行帽兜底）
    if (current !== '' && width + w > avail) {
      segments.push({ text: current, start, end: start + current.length });
      start += current.length;
      current = '';
      width = 0;
    }
    current += grapheme;
    width += w;
  }
  if (current !== '') segments.push({ text: current, start, end: start + current.length });
  return segments;
}

/** 内容游程 → 折行段源区间交集平移（游程跨折行边界保留——各段各持交集片） */
function mapRunsOntoSegment(runs: readonly StyleRun[], segStart: number, segEnd: number, offset: number): StyleRun[] {
  const out: StyleRun[] = [];
  for (const run of runs) {
    const start = Math.max(run.start, segStart);
    const end = Math.min(run.end, segEnd);
    if (start < end) out.push({ start: start - segStart + offset, end: end - segStart + offset, style: run.style });
  }
  return out;
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

// dim 样式（卡头简述段与折叠预览共用——SGR 2；注⑩：engine DIM_STYLE 正典单源）

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
export function sanitizeLineText(text: string, tabWidth = 2): string {
  return sanitizeDisplayText(text, tabWidth).replace(/\n/g, ' ');
}

/** 折叠预览整面 dim（既有游程样式并入 dim——diff 色保留亮度降档；fillBg 尾腿
 *  透传〔挖掘 29 轮件 1〕：diff 行自持 bg 面不随档位丢失——丢了即被 withCardBg
 *  以卡面 bg 覆写，局部覆盖律破） */
function addDim(line: StyledLine): StyledLine {
  if (line.runs.length === 0) {
    return line.plain === ''
      ? line
      : { plain: line.plain, runs: [{ start: 0, end: line.plain.length, style: DIM_STYLE }], fillBg: line.fillBg };
  }
  return {
    plain: line.plain,
    runs: line.runs.map((run) => ({ ...run, style: { ...run.style, dim: true } })),
    fillBg: line.fillBg,
  };
}
