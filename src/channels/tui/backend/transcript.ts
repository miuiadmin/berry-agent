/**
 * 直播路行集模型与渲染归约（07 §4.1 直播路渲染单源 + 呈现面件 1/9——批 10e）。
 *
 * - **消息事件是唯一渲染源**：assistant 文本/思考/工具调用随 message_start/
 *   update/end、工具结果随 toolResult 的 message_end（本仓消息载荷在 end——事件
 *   形 2026-09-06 冷读注记对齐）；`tool_execution_*` 是执行层锚点正文零渲染
 *   （状态面消费归 TuiBackend）；
 * - **思考前缀行**（批 10i R1）：流式槽渲染 = 思考行前缀 + doc 行——折叠单行
 *   标签（缺省，省 scrollback）/ 展开体两档，ctrl+t 会话级开关；定稿换装时
 *   思考行升位独立 thinking 块（同函数两渲染——冻结跳行不漂移）；
 * - **工具卡定稿形**（批 10i R4）：toolCall 入在飞账不落行（直播路在飞期零
 *   正文行），toolResult 按 toolCallId 配对落三态卡（✓/✖/⏹——中止走
 *   details 结构化标记）；折叠 = 卡头 + 尾 5 行预览（ctrl+o 会话级展开）；
 *   投影走查毕的在飞孤儿兜底 ⚙ 简行、配对到达撤销——两路收敛同形；
 * - **流式三段**（呈现面件 1 批 10h R1 三段化）：流式期 **markdown 直推**
 *   （streaming 槽携 StreamingMarkdown——增量装配 + 稳定面计量；doc = null
 *   为纯文本降档——字节帽超标回退形）、message_end 定稿换装（摘槽 →
 *   markdown 定稿块 + ⚙ 行）；槽携 **epoch**（每条 message_start 递增——
 *   main-screen 冻结账的槽同一性判据）；
 * - **流式单槽守卫**：repaint 切入 running 条目开的占位槽遇下一条 assistant
 *   message_start 重开时先摘旧槽（占位容器不孤儿滞留正文）；
 * - **帽 = 块数**（一个 Markdown 块一子行——呈现面件 1 滚动帽语义）：行集保留
 *   帽内最近段（内存上限语义；v1 保守值——实测定值回填挂主屏实装批校准）；
 * - **非聚焦摘要行**（呈现面件 9）：瞬时追加行——agent_start ⧗ / agent_end
 *   按终态 ✓/✖/⏹ 各追加一行、不进行集（不占帽、repaint 不重建），行首段 =
 *   档位符号 + 会话短 id、失败与中止显式分档不伪装成功。
 * - **渲染行提取单源**（批 10f-4）：renderBlockStyledLines 块 → 带样式行集
 *   （管线本体）——主屏 MainScreen 直写（renderBlockLines 的 ANSI 序列化形）
 *   与件 8 回看器 cell 写出（StyledLine 直消费）共用同一管线（07 件 8「数据源
 *   = 复用主屏同一渲染管线——同输入同行集、零第二渲染器」条款）；恒一致的
 *   是管线非范围（主屏按帽 / 回看器全量——帽经 LiveTranscriptOptions 参数化）。
 */
import type { AgentEvent } from '../../../agent/index.js';
import { isStandardMessage, type AgentMessage } from '../../../contracts/index.js';
import {
  CellGrid,
  EMPTY_STYLE,
  graphemeWidth,
  styleEquals,
  truncateToWidth,
  wrapText,
  type CellStyle,
  type ColorValue,
  type Renderable,
} from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { gridRowToStyled, capStyledLine, styledLineToAnsi, type StyleRun, type StyledLine } from './ansi-rows.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import type { StyledGrapheme } from '../markdown/layout.js';
import { renderThinkingStyledLines } from '../blocks/thinking.js';
import {
  cardBodyOf,
  renderToolCardStyledLines,
  sanitizeLineText,
  type ToolCardRenderInput,
  type ToolCardStatus,
} from '../blocks/tool-card.js';
import { ACTION_CATALOG } from '../keys/registry.js';
import type { SessionEnvelope } from '../../types.js';

export type { StyleRun, StyledLine } from './ansi-rows.js';

/**
 * 主屏滚动帽定值（07 §4.1「屏幕模型双形态」：帽值随主屏实装批实测定值回填、
 * 规范不预写数字。批 10f-3 性能回归锁建锁：四指标 wall-time 面不覆盖块帽
 * 〔内存上限语义〕——v1 维持保守值 500 块，实机校准注记留批 12 host 装配）。
 * 批 10f-4 参数化：本值降级为缺省帽（主屏调用面零变化）；回看器全量档经
 * LiveTranscriptOptions.blockCap 传 Number.POSITIVE_INFINITY（全量 durable
 * 正文不被截——perf-lock 全量档回归锁）。
 */
export const TRANSCRIPT_BLOCK_CAP = 500;

/**
 * 错误块行数帽（2026-09-20 TUI 修复组 1 批 F5——首行摘要语义定值 5：
 * 保 4 行详情 + 1 行截断标记；与工具卡折叠预览 CARD_PREVIEW_LINES=5 同档）。
 */
const ERROR_PREVIEW_LINES = 5;

/** ⚙ 行 / ↳ 行的参数与结果简述显示宽帽（列） */
const BRIEF_WIDTH = 40;

/**
 * 行块（帽单位——blockCount 即帽额度）。streaming 槽是行集末块的瞬时态
 * （定稿摘槽换装）；其余为 durable 块（repaint 投影重建的同构物）。
 */
export type TranscriptBlock =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'markdown'; readonly doc: MarkdownDoc }
  | {
      /** 思考块（批 10i R1——定稿形：斜体 + thinkingText 色，折叠标签/展开体两档） */
      readonly kind: 'thinking';
      readonly text: string;
      readonly expanded: boolean;
      readonly theme: ResolvedTheme;
      readonly toggleHint: string;
      /** 体 doc（换装时一构——repaint 免重解析） */
      readonly doc: MarkdownDoc;
    }
  | {
      /** 工具卡（批 10i R4——toolResult 按 toolCallId 配对落卡的三态定稿形） */
      readonly kind: 'tool-card';
      readonly name: string;
      readonly brief: string;
      readonly status: ToolCardStatus;
      readonly body: readonly string[];
      readonly diff: boolean;
      readonly expanded: boolean;
      readonly theme: ResolvedTheme;
      /** 插件渲染腿载荷（renderResult 现调事实——2026-09-17 收官批③；缺席 = 宿主缺省卡体） */
      readonly renderInput?: ToolCardRenderInput;
    }
  | { readonly kind: 'tool-call'; readonly name: string; readonly brief: string; readonly toolCallId?: string }
  | { readonly kind: 'tool-result'; readonly brief: string }
  | {
      /**
       * 错误块（2026-09-19 P0 静默链修复批——07 §4.1）：assistant 失败终态的
       * errorMessage 正文落位（stopReason=error 形——模型调用失败是消息数据非
       * 异常）；直播（message_end 定稿展开）与投影重建（loadProjection）两路
       * 同源经 appendAssistantFinal 单点收敛。
       */
      readonly kind: 'error';
      readonly text: string;
      readonly theme: ResolvedTheme;
    }
  | {
      readonly kind: 'streaming';
      /** 槽代次（每条 assistant message_start 递增——冻结账同一性判据） */
      readonly epoch: number;
      readonly text: string;
      /** 流式 markdown 直推档（null = 纯文本降档——字节帽超标回退形） */
      readonly doc: StreamingMarkdown | null;
      /** 思考前缀（批 10i——合并思考文，槽渲染 = 思考行 + doc 行同前缀拼接） */
      readonly thinking: string;
      /** 思考体增量档（流式展开档的逐帧成本承接——与 doc 同件同律） */
      readonly thinkingDoc: StreamingMarkdown | null;
      /** 思考行已定判据（思考块全在末文本块前——冻结面可纳思考行的前提） */
      readonly thinkingSettled: boolean;
      /** 思考行渲染档（会话级开关快照——toggle 改写 + repaint 重渲） */
      readonly thinkingExpanded: boolean;
      readonly theme: ResolvedTheme;
      readonly toggleHint: string;
    };

/** 非聚焦摘要行（瞬时——呈现侧直写后即交 scrollback，不存账） */
export interface SummaryLine {
  readonly symbol: '⧗' | '✓' | '✖' | '⏹';
  readonly shortId: string;
  readonly label: string;
}

/** 会话短 id（呈现层自截——散列映射色板键同源） */
export function shortIdOf(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** dim 样式（简行块的整行样式——SGR 2；呈现侧带样式形同值） */
const DIM_STYLE: Readonly<{ dim: true }> = Object.freeze({ dim: true });

/**
 * 块 → 带样式行集（管线单源本体——批 10f-4 件 8 提取）。
 *
 * 主屏 MainScreen 直写（经 renderBlockLines 的 ANSI 序列化形）与件 8 回看器
 * cell 写出（StyledLine 直消费）共用本函数：同输入同行集、零第二渲染器
 * （07 件 8 数据源条款）；markdown/streaming-doc 块经 CellGrid 渲染
 * （gridRowToStyled 提段）、user 块折行续挂对齐（宽算术单源走 wrapText）、
 * 简行块整行 dim、streaming 降档纯文本零样式、markdown 无内容行保空行
 * （主屏空行直写形字节不变）。
 *
 * 出口屏宽帽（2026-09-20 TUI 修复组 1 批 F4——序列化单源层 choke）：本函数
 * 是全部块类型的带样式行唯一出口，超宽行在此统一 capStyledLine 整字截断
 * （游程同步钳制）——超宽行直写交终端 autowrap 产未记账物理行即漂账
 * （801bdb0 同族）；折行族（user/error/streaming/网格管线）实践上恒不超帽
 * 走同引用快路，帽真实咬合的是无折行简行族（tool-call ⚙ / tool-result ↳）。
 */
export function renderBlockStyledLines(block: TranscriptBlock, columns: number): StyledLine[] {
  return renderBlockStyledLinesUncapped(block, columns).map((line) => capStyledLine(line, columns));
}

/** 各块类型本体渲染（无帽——出口帽单点在 renderBlockStyledLines） */
function renderBlockStyledLinesUncapped(block: TranscriptBlock, columns: number): StyledLine[] {
  switch (block.kind) {
    case 'markdown':
      return renderDocLines(block.doc, columns);
    case 'user': {
      // '> ' 前缀 + 折行续挂对齐（首行前缀、续行两空格缩进）
      const lines = wrapText(block.text, columns - 2);
      return lines.map((line, i) => ({ plain: (i === 0 ? '> ' : '  ') + line, runs: [] }));
    }
    case 'thinking':
      // 思考块两档渲染（blocks/thinking 纯函数——槽前缀行同函数两用）
      return renderThinkingStyledLines(
        { text: block.text, expanded: block.expanded, theme: block.theme, toggleHint: block.toggleHint },
        columns,
        block.doc,
      );
    case 'tool-card':
      return renderToolCardStyledLines(
        {
          name: block.name,
          brief: block.brief,
          status: block.status,
          body: block.body,
          diff: block.diff,
          expanded: block.expanded,
          theme: block.theme,
          renderInput: block.renderInput,
        },
        columns,
      );
    case 'tool-call':
      return [dimStyledLine(` ⚙ ${block.name}${block.brief}`)];
    case 'tool-result':
      return [dimStyledLine(` ↳ ${block.brief}`)];
    case 'error': {
      // 错误块（P0 静默链修复批——07 §4.1）：行首 ✖ 前缀 + error 语义键前景
      // 整行（与 tool-card.ts 语义色消费同源）；折行续行两空格缩进（user 块同律）。
      // 行数帽（2026-09-20 TUI 修复组 1 批 F5）：网关 403 类错误体是整段裸
      // JSON（单「行」折开后数十行噪声全量上屏）——首行摘要语义：保前
      // ERROR_PREVIEW_LINES-1 行 + 截断标记行收口（剩余行数明示），error
      // 前景同游程保持错误语义可辨
      const lines = wrapText(block.text, columns - 2);
      const style: Readonly<{ fg: ColorValue }> = Object.freeze({ fg: block.theme.error });
      const renderErrorLine = (line: string, i: number): StyledLine => {
        const plain = (i === 0 ? '✖ ' : '  ') + line;
        return { plain, runs: [{ start: 0, end: plain.length, style }] };
      };
      if (lines.length <= ERROR_PREVIEW_LINES) return lines.map(renderErrorLine);
      const kept = lines.slice(0, ERROR_PREVIEW_LINES - 1).map(renderErrorLine);
      const dropped = lines.length - (ERROR_PREVIEW_LINES - 1);
      const marker = `  ⋯（错误详情已省 ${dropped} 行）`;
      return [...kept, { plain: marker, runs: [{ start: 0, end: marker.length, style }] }];
    }
    case 'streaming': {
      // 槽渲染 = 思考前缀行 + doc 行（拼接序与定稿换装块序一致——冻结跳行前提）；
      // markdown 直推档走网格管线；降档（doc = null）纯文本直推；空文本零行
      const lines: StyledLine[] = [];
      if (block.thinking !== '') {
        lines.push(
          ...renderThinkingStyledLines(
            {
              text: block.thinking,
              expanded: block.thinkingExpanded,
              theme: block.theme,
              toggleHint: block.toggleHint,
            },
            columns,
            block.thinkingDoc,
          ),
        );
      }
      if (block.doc !== null) lines.push(...renderDocLines(block.doc, columns));
      else if (block.text !== '')
        lines.push(...wrapText(block.text, columns).map((text) => ({ plain: text, runs: [] })));
      return lines;
    }
  }
}

/**
 * 槽稳定行数（批 10i——main-screen 冻结账消费）：思考行稳定判据 =
 * thinkingSettled（思考块全在末文本块前——标签字数与体行此后不再变，全行
 * 皆稳）+ doc 稳定面（既有三判）。**思考在场未定 → 冻结面整体为空**：槽行
 * 头是逐帧变的标签行，冻结是前缀连续操作（头行不可跳）——其后 doc 稳定面
 * 不得越过不稳头行先冻（未冻起步形：settled 翻 false 即冻结面为零、帧帧
 * 全量重写）。settled 非单调（思考/文本交错——后到思考翻回 false）：已冻
 * 思考行随之变不稳内容，main-screen 冻结账按本值让位重算收缩、让位行回
 * 换装重写域（终值标签随定稿换装收敛——2026-09-15 挂账解挂批勘正：原
 * 「冻结面收缩到零、帧帧全量重写、正确性不破」句只述未冻起步形、漏
 * frozen-then-flip 形，冻结账不清即陈旧字数永久呈现缺陷）。
 */
export function stableSlotLineCount(slot: Extract<TranscriptBlock, { kind: 'streaming' }>, columns: number): number {
  if (slot.thinking !== '' && !slot.thinkingSettled) return 0; // 不稳头行止冻——前缀连续律
  // 渲染热路径 D2——思考行计数算术：修前经 renderThinkingStyledLines 全量
  // 渲染（展开档 = CellGrid 整面分配 + 落格 + 逐行读回）只为取 .length；改
  // 为行数算术（与渲染函数产出行数同源同律——见 thinkingRowCount 头注）
  const thinkingRows =
    slot.thinking !== ''
      ? thinkingRowCount(
          { text: slot.thinking, expanded: slot.thinkingExpanded, theme: slot.theme },
          columns,
          slot.thinkingDoc,
        )
      : 0;
  return thinkingRows + (slot.doc !== null ? slot.doc.stableLineCount(columns) : 0);
}

/**
 * thinking 前缀行数算术（D2 计数腿——与 stableSlotLineCount 注同役）：与
 * renderThinkingStyledLines 的产出行数同源同律镜像——空文 0 行；折叠档 =
 * 标签单行（体 doc 不触）；展开档 = 标签行 + max(1, 体 doc 量高)（体 doc
 * 缺席即时构档与渲染支路同形；max(1) 镜像其空体网格保底行）。计数从此
 * 不进网格管线——展开档大量高的网格分配/落格/读回从计数腿除名。
 */
function thinkingRowCount(
  view: { readonly text: string; readonly expanded: boolean; readonly theme: ResolvedTheme },
  columns: number,
  doc?: Renderable | null,
): number {
  if (view.text === '') return 0;
  if (!view.expanded) return 1; // 折叠档 = 单标签行（体 doc 缺席亦然——渲染支路折叠不触 doc）
  const bodyDoc = doc ?? MarkdownDoc.of(view.text, view.theme);
  return 1 + Math.max(1, bodyDoc.measure(columns));
}

/** Renderable doc → 带样式行集（markdown 定稿与流式 doc 共用——同管线律） */
function renderDocLines(doc: Renderable, columns: number): StyledLine[] {
  const grid = new CellGrid(columns, doc.measure(columns));
  doc.render(grid, { row: 0, col: 0, width: columns, height: grid.rows });
  const lines: StyledLine[] = [];
  for (let r = 0; r < grid.rows; r++) {
    lines.push(gridRowToStyled(grid, r) ?? { plain: '', runs: [] }); // 无内容行保空行
  }
  return lines;
}

/**
 * doc 装配行（StyledGrapheme[]）→ 带样式行（渲染热路径 D1——行集直转）：
 * 忠实镜像「doc.render 落格 CellGrid + gridRowToStyled 读回」的净效果，
 * 免去整面网格分配/落格/读回——逐行语义等价要点（与 cell.ts / ansi-rows.ts
 * 两件的单源语义逐条对齐）：
 * - 落格净效果：tab 展开两空格（携段样式）、其余 C0/DEL 跳过不占宽（行集
 *   在 layout 件已源头消毒——本位防御镜像）、零宽字素 setCell 丢弃、越列
 *   写静默吸收（col ≥ columns 截停；宽字素末列基格仍写——续格越界丢弃）；
 * - 读回净效果（gridRowToStyled 同律）：行尾缺省空格修剪（写入的缺省空格
 *   与未写格同判——尾部默认空格不入 plain）、缺省样式段不产段（gap 即裸
 *   文本）、相邻同样式且端点连续的段合并、无内容行返空行。
 */
function docRowToStyledLine(row: readonly StyledGrapheme[], columns: number): StyledLine {
  // 虚拟落格（dense 形——写入连续无洞：零宽/控制跳过不推进列位）
  const cells: { grapheme: string; style: Readonly<CellStyle> | undefined }[] = [];
  let col = 0;
  for (const cell of row) {
    const code = cell.grapheme.charCodeAt(0);
    if (code === 0x09) {
      // tab 展开两空格（writeText 同律——两格各自独立越界判定）
      if (col < columns) cells.push({ grapheme: ' ', style: cell.style });
      if (col + 1 < columns) cells.push({ grapheme: ' ', style: cell.style });
      col += 2;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue; // 控制字素落格跳过不占宽（防御镜像——行集已消毒）
    const w = graphemeWidth(cell.grapheme);
    if (w === 0) continue; // 零宽字素 setCell 丢弃（防御镜像——splitGraphemes 已合流）
    if (col >= columns) break; // 越列写静默吸收（整字独行超帽形与网格兜底同律）
    cells.push({ grapheme: cell.grapheme, style: cell.style });
    col += w;
  }
  // 行尾缺省空格修剪（cellEquals 归一基准：' ' + EMPTY_STYLE + width 1）
  let last = cells.length - 1;
  while (last >= 0) {
    const tailCell = cells[last]!;
    if (tailCell.grapheme !== ' ') break;
    if (tailCell.style !== undefined && !styleEquals(tailCell.style, EMPTY_STYLE)) break;
    last--;
  }
  if (last < 0) return { plain: '', runs: [] }; // 无内容行（gridRowToStyled null 同构——调用面保空行）
  let plain = '';
  const runs: StyleRun[] = [];
  for (let i = 0; i <= last; i++) {
    const cell = cells[i]!;
    const start = plain.length;
    plain += cell.grapheme;
    if (cell.style === undefined || styleEquals(cell.style, EMPTY_STYLE)) continue; // 缺省段不产段（gap 即裸文本）
    // 相邻同样式紧邻续段合并（端点连续才并——中间缺省格即断开）
    const prev = runs[runs.length - 1];
    if (prev !== undefined && styleEquals(prev.style, cell.style) && prev.end === start) {
      runs[runs.length - 1] = { start: prev.start, end: start + cell.grapheme.length, style: cell.style };
    } else {
      runs.push({ start, end: start + cell.grapheme.length, style: cell.style });
    }
  }
  return { plain, runs };
}

/** 槽尾窗渲染产出（渲染热路径 D1——尾窗渲染） */
export interface SlotTailLines {
  /** 槽总行数（thinking 前缀 + doc 行——与全量渲染 renderBlockLines 同源计数） */
  readonly total: number;
  /** 尾窗行（ANSI 串；索引 0 = 槽第 startRow 行——与全量渲染切片逐字节一致） */
  readonly lines: string[];
}

/**
 * 流式槽尾窗渲染（渲染热路径 D1——尾窗渲染）：只渲染 [startRow, total) 段。
 *
 * 动机：修前 present() 每帧全量渲染整槽（含冻结前缀）——已冻结行是
 * append-only 升格 durable 的不可回改内容（升格后永不再写），重渲染纯白算
 * 且不进 slotFrameBytes 帽（冻结面白算不可观测）；3600 行槽实测 75ms/帧 =
 * 60fps 预算 4.5 倍。
 *
 * 字节等价契约：`(total, lines) ≡ (renderBlockLines(slot, columns).length,
 * renderBlockLines(slot, columns).slice(startRow))`——对拍锁在
 * transcript.test.ts（多形语料 × 多宽 × 多起点）。legs：
 * - thinking 腿：行数走 thinkingRowCount 算术；startRow 落思考区内才渲染
 *   （折叠档 = 标签单行便宜；展开档 opt-in 走原渲染函数——ctrl+t 罕见路径，
 *   仍经 renderThinkingStyledLines 保字节同源）；
 * - doc 腿：doc.rowsFor 装配行集（块级缓存承接 + D4 尾块增量折叠）自
 *   docStart = startRow − thinkingRows 起逐行 docRowToStyledLine 直转
 *   （跳过 CellGrid 整面往返）+ 出口帽 capStyledLine + ANSI 序列化——
 *   与 renderBlockStyledLines 出口同律；
 * - 降档腿（doc = null）：纯文本 wrapText 切片（应急路径——字节帽超标回退
 *   形，wrapText 纯文本无网格往返，成本可忍）。
 *
 * 回退形（正确性优先）：startRow = 0 即全量渲染——repaint/resize/新槽开账/
 * 让位收缩后的首帧自然走全量（调用方 main-screen 注释在位）。
 */
export function renderSlotTailLines(
  slot: Extract<TranscriptBlock, { kind: 'streaming' }>,
  columns: number,
  startRow: number,
): SlotTailLines {
  const thinkingRows =
    slot.thinking !== ''
      ? thinkingRowCount(
          { text: slot.thinking, expanded: slot.thinkingExpanded, theme: slot.theme },
          columns,
          slot.thinkingDoc,
        )
      : 0;
  const lines: string[] = [];
  // thinking 尾窗段（startRow 落思考区内——超出则思考行全在冻结前缀，零渲染）
  if (slot.thinking !== '' && startRow < thinkingRows) {
    const thinkingLines = renderThinkingStyledLines(
      { text: slot.thinking, expanded: slot.thinkingExpanded, theme: slot.theme, toggleHint: slot.toggleHint },
      columns,
      slot.thinkingDoc,
    ).map((line) => styledLineToAnsi(capStyledLine(line, columns)));
    for (let i = startRow; i < thinkingLines.length; i++) lines.push(thinkingLines[i]!);
  }
  // doc 尾窗段（行集直转——自 docStart 起逐行；出口帽 + 序列化与全量管线同律）
  const docStart = Math.max(0, startRow - thinkingRows);
  let docRowCount = 0;
  if (slot.doc !== null) {
    const rows = slot.doc.rowsFor(columns);
    docRowCount = rows.length;
    for (let r = docStart; r < rows.length; r++) {
      lines.push(styledLineToAnsi(capStyledLine(docRowToStyledLine(rows[r]!, columns), columns)));
    }
  } else if (slot.text !== '') {
    // 降档纯文本腿（零样式直推——切片同律）
    const wrapped = wrapText(slot.text, columns);
    docRowCount = wrapped.length;
    for (let i = docStart; i < wrapped.length; i++) lines.push(wrapped[i]!);
  }
  return { total: thinkingRows + docRowCount, lines };
}

/** 简行块的带样式形（整行 dim——与 ANSI 形 dim() 字节同源） */
function dimStyledLine(text: string): StyledLine {
  return { plain: text, runs: [{ start: 0, end: text.length, style: DIM_STYLE }] };
}

/**
 * 块 → 行序列化（渲染管线单源——批 10f-4 提取为可复用函数；主屏直写消费形）。
 * 带样式行本体经 styledLineToAnsi 导出 ANSI 串——与回看器 cell 写出形零第二
 * 渲染器（renderBlockStyledLines 注）。
 */
export function renderBlockLines(block: TranscriptBlock, columns: number): string[] {
  return renderBlockStyledLines(block, columns).map(styledLineToAnsi);
}

/** 消息文本块拼接（user/assistant/toolResult 通用；自定义角色与无文本块返 ''） */
function textOf(message: AgentMessage): string {
  // isStandardMessage 守卫先行——CustomMessage role: string 非字面判别位，
  // 相等/开关收窄均排不掉，经守卫归一到标准三角色（自定义角色呈现侧宽容跳过）
  if (!isStandardMessage(message)) return '';
  if (typeof message.content === 'string') return message.content; // user 纯文本形
  return joinTextBlocks(message.content);
}

/** 文本块抽取拼接（图文/思考/工具块族里 text 块的串接——无文本块返 ''） */
function joinTextBlocks(blocks: readonly { type: string; text?: string }[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

/** 思考块抽取拼接（批 10i——连续思考块 '\n\n' 串接；redacted 无文本体跳过） */
function joinThinkingBlocks(blocks: readonly { type: string; thinking?: string }[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'thinking' && typeof block.thinking === 'string') parts.push(block.thinking);
  }
  return parts.join('\n\n');
}

/**
 * 思考已定判据（批 10i）：末思考块先于末文本块（文本已起且其后无思考）。
 * 纯思考期（无文本块）恒未定——标签字数逐帧变。判据非单调（思考/文本交错
 * 形：后到思考使 settled 翻回 false）——settled true 只是「此刻无后到思考」
 * 的观察、非终态承诺（「此后思考文不再变」前提被交错形证伪——2026-09-15
 * 挂账解挂批勘正：原句「冻结面收缩、正确性不破」与码行为不符，冻结账不清
 * 时陈旧字数永久呈现），已冻思考行随之变不稳内容、由 main-screen 冻结账
 * 让位重算兜底。
 */
function thinkingSettledBeforeText(content: readonly { type: string }[]): boolean {
  let lastText = -1;
  let lastThinking = -1;
  for (let i = 0; i < content.length; i++) {
    const type = content[i]!.type;
    if (type === 'text') lastText = i;
    else if (type === 'thinking') lastThinking = i;
  }
  return lastThinking !== -1 && lastText > lastThinking;
}

/** 思考文抽取（宽面消息守卫归一——非 assistant/自定义角色返 ''） */
function thinkingOf(message: AgentMessage): string {
  if (!isStandardMessage(message) || message.role !== 'assistant') return '';
  return joinThinkingBlocks(message.content);
}

/** 思考已定判据的宽面守卫形（同上——非 assistant 恒未定） */
function thinkingSettledOf(message: AgentMessage): boolean {
  if (!isStandardMessage(message) || message.role !== 'assistant') return false;
  return thinkingSettledBeforeText(message.content);
}

/** details 结构化中止标记判定（tools-batch 中止合成位铸入 {aborted: true}） */
function isAbortedDetails(details: unknown): boolean {
  return typeof details === 'object' && details !== null && (details as { aborted?: unknown }).aborted === true;
}

/**
 * 工具简述：参数键名序列（`path, content` 形——呈现面克制不倒参数值）。
 * BRIEF_WIDTH 帽（2026-09-20 TUI 修复组 1 批 F6——修前常量在案从未接线，
 * 超长键名/键列简述整段直写）：与 resultBrief 同律按显示宽截断。
 * 构造位消毒律（2026-09-21 补修批）：键名是 JSON 任意字符串可含 tab/LF
 * ——先 sanitizeLineText（tab 展开 2 空格 + LF 归一）再测宽截断（修前 tab
 * 记宽 1 误过帽、简行发射位展开漂物理行账——物理行账漂移族）。
 */
function argsBrief(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  return truncateToWidth(sanitizeLineText(`(${keys.join(', ')})`), BRIEF_WIDTH);
}

/** 行集选项（批 10f-4 帽参数化——主屏缺省帽之外的自定义档） */
export interface LiveTranscriptOptions {
  /**
   * 块帽（缺省 TRANSCRIPT_BLOCK_CAP = 500 主屏帽——主屏调用面零变化）。
   * 件 8 回看器全量档传 Number.POSITIVE_INFINITY（全量 durable 正文不截）。
   */
  readonly blockCap?: number;
  /**
   * markdown 主题（流式直推档与定稿块的渲染键源——批 10h；缺省
   * DEFAULT_THEME。换装经 setTheme——只影响后续新建 doc，已落账 doc 不回改
   * 〔durable 行已交 scrollback 物理不可回改〕）。批 10i 起思考块与工具卡
   * 同律（构造期烙印）。
   */
  readonly theme?: ResolvedTheme;
  /**
   * 动作键名取用面（批 10i——keyText(动作id) 单源消费；缺省册首键回退，
   * TuiBackend 装配位传 Keymap 实例的 keyText——用户覆盖后标签提示随动）。
   */
  readonly keyText?: (actionId: string) => string;
}

/** 缺省键名回退表（册单源派生——直构档〔测试/回看器〕无 Keymap 时的取键面） */
const DEFAULT_KEY_TEXT: ReadonlyMap<string, string> = new Map(ACTION_CATALOG.map((def) => [def.id, def.keys[0]!]));

/** 在飞工具调用账（批 10i R4——toolCallId → 调用面，配对落卡的账本） */
interface PendingToolCall {
  readonly name: string;
  readonly brief: string;
  readonly arguments: Record<string, unknown>;
}

/** 在飞账帽（防御位——异常形消息序列下不无限滞留；超帽最旧让位） */
const MAX_PENDING_CALLS = 64;

/**
 * 直播路行集（单聚焦会话一账——非聚焦会话不建账，摘要行直返）。
 * 纯状态件：无 IO、无时钟——applyEvent 同步归约，呈现编舞归 MainScreen。
 */
export class LiveTranscript {
  /** 块帽（构造定着——主屏 500 / 回看器全量 Infinity） */
  private readonly blockCap: number;
  /** markdown 主题（流式/定稿 doc 的构造注入源） */
  private theme: ResolvedTheme;
  /** 动作键名取用面（标签提示单源——装配位注入 Keymap.keyText） */
  private readonly keyText: (actionId: string) => string;
  /** 槽代次计数器（每条 assistant message_start 递增） */
  private epochCounter = 0;
  private blocks: TranscriptBlock[] = [];
  /** 流式槽在场位（true = 末块是 streaming——message_start/message_end 配对守卫） */
  private slotOpen = false;
  /** 在飞工具调用账（assistant toolCall 入账 → toolResult 配对出账落卡） */
  private pendingCalls = new Map<string, PendingToolCall>();
  /** 历史裁块累计（单调递增——trimmedBlockCount 观测面的真身） */
  private trimmedCount = 0;
  /** 思考块会话级展开态（批 10i——缺省折叠省 scrollback） */
  private thinkingExpanded = false;
  /** 工具卡会话级展开态（批 10i——缺省折叠尾 5 行预览） */
  private toolCardsExpanded = false;

  constructor(options: LiveTranscriptOptions = {}) {
    this.blockCap = options.blockCap ?? TRANSCRIPT_BLOCK_CAP;
    this.theme = options.theme ?? DEFAULT_THEME;
    this.keyText = options.keyText ?? ((actionId) => DEFAULT_KEY_TEXT.get(actionId) ?? '');
  }

  /** 主题换装（probe 应答/显式档切换——后续新建 doc 生效，已建 doc 不回改） */
  setTheme(theme: ResolvedTheme): void {
    this.theme = theme;
  }

  /**
   * 流式降档（字节帽超标应急——当前槽弃 doc 走纯文本直推，冻结账随换帧
   * 自然作废；下条 message_start 重建 doc 复位重试——降档是应急不是裁决）。
   * 思考前缀行不受降档（标签单行成本恒定）。
   */
  setStreamingPlain(): void {
    const slot = this.blocks[this.blocks.length - 1];
    if (slot !== undefined && slot.kind === 'streaming') {
      this.blocks[this.blocks.length - 1] = { ...slot, doc: null };
    }
  }

  /** 思考块会话级开关（批 10i ctrl+t——翻转 + 已落账块改写，呈现侧 repaint 收口） */
  toggleThinking(): void {
    this.thinkingExpanded = !this.thinkingExpanded;
    this.rewriteExpandedFlags();
  }

  /** 工具卡会话级开关（批 10i ctrl+o——同律） */
  toggleToolCards(): void {
    this.toolCardsExpanded = !this.toolCardsExpanded;
    this.rewriteExpandedFlags();
  }

  /** 展开态改写（思考块/工具卡/在飞槽——渲染纯函数化，态改数据随 repaint 重渲） */
  private rewriteExpandedFlags(): void {
    this.blocks = this.blocks.map((block) => {
      if (block.kind === 'thinking') return { ...block, expanded: this.thinkingExpanded };
      if (block.kind === 'tool-card') return { ...block, expanded: this.toolCardsExpanded };
      if (block.kind === 'streaming') {
        // D3 收口位：折叠期 thinkingDoc 停在旧快照（message_update 跳过更新）
        // ——翻转进展开档时重建承接最新思考（展开渲染读体 doc，陈旧即失真；
        // 重建一次性成本 = 单次解析，toggle 罕见路径可忍）。折叠向翻转不重建
        // （体 doc 不再被读，留旧账无害）
        if (!this.thinkingExpanded) return { ...block, thinkingExpanded: false };
        const freshThinkingDoc = new StreamingMarkdown(block.theme);
        freshThinkingDoc.update(block.thinking);
        return { ...block, thinkingExpanded: true, thinkingDoc: freshThinkingDoc };
      }
      return block;
    });
  }

  /** 行集快照（只读——呈现侧消费） */
  get snapshot(): readonly TranscriptBlock[] {
    return this.blocks;
  }

  /** 块计数（帽额度观测面） */
  get blockCount(): number {
    return this.blocks.length;
  }

  /**
   * 历史裁块累计（批 10k 遗漏修——呈现对账输入）：帽饱和 slice 卸前缀的
   * 累计块数，单调递增不回退（再投影重建重裁同段照加——绝对位不重影）。
   * MainScreen 增量对账以「绝对块位」计（blocksOffset + 块下标），相对块数
   * 在 trim 后会误判零新增漏写新块。
   */
  get trimmedBlockCount(): number {
    return this.trimmedCount;
  }

  /**
   * 直播路归约：活体信封 → 行集更新 + 瞬时行（非聚焦摘要行直返、聚焦返 null）。
   * 非聚焦会话的 durable 事件全忽略（行集是聚焦会话的账——投影重建走 loadProjection）。
   */
  applyEvent(env: SessionEnvelope, focused: boolean): SummaryLine | null {
    const { event } = env;
    if (!focused) return this.summaryFor(event, env.sessionId);
    this.applyFocused(event);
    return null;
  }

  /** 投影重建（repaint 路——清账按投影重拉帽内段；直播/repaint 行集同构） */
  loadProjection(messages: readonly AgentMessage[]): void {
    const rebuilt: TranscriptBlock[] = [];
    this.pendingCalls.clear(); // 配对账随投影重建（走查中 assistant 入账、toolResult 出账）
    for (const message of messages) {
      switch (message.role) {
        case 'user':
          rebuilt.push({ kind: 'user', text: textOf(message) });
          break;
        case 'assistant':
          this.appendAssistantFinal(rebuilt, message);
          break;
        case 'toolResult':
          this.appendToolResult(rebuilt, message);
          break;
        // 自定义角色：content unknown 宽容跳过（不猜形状——件 1 自定义渲染器优先级语义）
      }
    }
    // 在飞孤儿兜底：走查毕未见结果的调用照旧 ⚙ 简行（与直播路在飞期零正文行
    // 收敛同形——投影把「在飞」显形为 ⚙；结果到达配对落卡时 ⚙ 留账留屏）
    for (const [toolCallId, call] of this.pendingCalls) {
      rebuilt.push({ kind: 'tool-call', name: call.name, brief: call.brief, toolCallId });
    }
    this.blocks = rebuilt;
    this.slotOpen = false; // 投影是 durable 快照——无在飞槽
    this.trimToCap();
  }

  /** 非聚焦摘要行分档（agent_start/end 之外的事件零产出） */
  private summaryFor(event: AgentEvent, sessionId: string): SummaryLine | null {
    const shortId = shortIdOf(sessionId);
    switch (event.type) {
      case 'agent_start':
        return { symbol: '⧗', shortId, label: '后台工作中' };
      case 'agent_end':
        if (event.status === 'completed') return { symbol: '✓', shortId, label: '后台完成' };
        if (event.status === 'failed') return { symbol: '✖', shortId, label: '后台失败' };
        return { symbol: '⏹', shortId, label: '后台已中止' }; // aborted——失败与中止显式分档
      default:
        return null; // 消息族/turn 族：非聚焦零正文行（摘要行只由 run 生命周期驱动）
    }
  }

  /** 聚焦归约：消息事件族分派（唯一渲染源律——tool_execution_* 正文零渲染） */
  private applyFocused(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start':
        if (event.role !== 'assistant') return;
        // 流式单槽守卫：重开先摘旧槽（占位容器不孤儿滞留）
        if (this.slotOpen) this.blocks.pop();
        // 直推档随槽重建复位（降档是应急不是裁决——每条消息重试 markdown 档）；
        // 思考前缀行同槽重建（批 10i——thinking/thinkingDoc 从空起步）
        this.blocks.push({
          kind: 'streaming',
          epoch: ++this.epochCounter,
          text: '',
          doc: new StreamingMarkdown(this.theme),
          thinking: '',
          thinkingDoc: new StreamingMarkdown(this.theme),
          thinkingSettled: false,
          thinkingExpanded: this.thinkingExpanded,
          theme: this.theme,
          toggleHint: this.keyText('thinking.toggle'),
        });
        this.slotOpen = true;
        break;
      case 'message_update': {
        if (event.role !== 'assistant' || !this.slotOpen) return;
        const slot = this.blocks[this.blocks.length - 1];
        if (slot === undefined || slot.kind !== 'streaming') return;
        // partial 是完整快照——直换非追加；markdown 档经 StreamingMarkdown
        // 增量装配（append-only 前提下块级缓存承接，布局只跑尾块）；思考文
        // 同律增量（合并形 append-only——块间 '\n\n' 串接只增不改）。
        // 渲染热路径 D3——折叠期跳过 thinkingDoc 重建：折叠档渲染/计数两腿
        // 的折叠支路都不触体 doc（renderThinkingStyledLines 折叠即返标签行、
        // thinkingRowCount 折叠即 1），逐帧全量换入纯白算——跳过（体 doc 停
        // 在旧快照无害）；翻转进展开档时 rewriteExpandedFlags 重建承接最新。
        const text = textOf(event.partial);
        const thinking = thinkingOf(event.partial);
        slot.doc?.update(text);
        if (slot.thinkingExpanded) slot.thinkingDoc?.update(thinking);
        this.blocks[this.blocks.length - 1] = {
          ...slot,
          text,
          thinking,
          thinkingSettled: thinkingSettledOf(event.partial),
        };
        break;
      }
      case 'message_end': {
        // 判别位在载荷 message.role（事件自身不带 role 字段——轻载荷事件形）
        const { message } = event;
        if (message.role === 'assistant') {
          if (this.slotOpen) {
            this.blocks.pop();
            this.slotOpen = false;
          }
          this.appendAssistantFinal(this.blocks, message);
        } else if (message.role === 'user') {
          this.blocks.push({ kind: 'user', text: textOf(message) });
        } else if (message.role === 'toolResult') {
          this.appendToolResult(this.blocks, message);
        }
        this.trimToCap();
        break;
      }
      default:
        break; // turn_*/tool_execution_*/agent_* 正文零渲染（状态面消费）
    }
  }

  /**
   * assistant 定稿展开（批 10i R1/R4 形）：思考文非空 → 思考块（折叠标签/
   * 展开体——槽前缀行的换装对位块）；文本非空 → markdown 块；toolCall 块 →
   * 在飞账入账（**不落 ⚙ 简行**——直播路在飞期零正文行，结果到达配对落卡；
   * repaint 投影走查毕孤儿兜底 ⚙）。
   */
  private appendAssistantFinal(target: TranscriptBlock[], message: AgentMessage): void {
    // 守卫 + 判别收窄到 AssistantMessage（CustomMessage 判别位是 string——见 textOf 注）
    if (!isStandardMessage(message) || message.role !== 'assistant') return;
    const text = textOf(message);
    const thinking = joinThinkingBlocks(message.content);
    if (thinking !== '') {
      target.push({
        kind: 'thinking',
        text: thinking,
        expanded: this.thinkingExpanded,
        theme: this.theme,
        toggleHint: this.keyText('thinking.toggle'),
        doc: MarkdownDoc.of(thinking, this.theme),
      });
    }
    if (text !== '') target.push({ kind: 'markdown', doc: MarkdownDoc.of(text, this.theme) });
    // 错误块（P0 静默链修复批——07 §4.1）：失败终态 errorMessage 非空时正文落位
    // ——修前形 = errorMessage 在渲染层结构性零落位（transcript 只渲染非空 text，
    // 报错静默链第 4 层）。thinking/text 照常渲染、错误块追加于其后（正文先行
    // 错误收尾）；本函数是直播与投影重建的单点，加在此处即两路同源收敛
    if (message.errorMessage !== undefined && message.errorMessage !== '') {
      target.push({ kind: 'error', text: message.errorMessage, theme: this.theme });
    }
    for (const block of message.content) {
      if (block.type === 'toolCall') {
        this.pendingCalls.set(block.id, {
          name: block.name,
          brief: argsBrief(block.arguments),
          arguments: block.arguments,
        });
      }
    }
    // 在飞账帽：超帽最旧让位（Map 插入序——异常形序列防御，正常流配对即出）
    while (this.pendingCalls.size > MAX_PENDING_CALLS) {
      const oldest = this.pendingCalls.keys().next().value;
      if (oldest === undefined) break;
      this.pendingCalls.delete(oldest);
    }
  }

  /**
   * 工具结果配对落卡（批 10i R4）：账内在飞 → tool-card 三态卡（换卡时撤销
   * 投影期同 id 孤儿 ⚙ 行——repaint 后到达的结果两路收敛同形）；账外兜底
   * ↳ 简行（未配对结果不伪装成卡）。
   */
  private appendToolResult(target: TranscriptBlock[], message: AgentMessage): void {
    if (!isStandardMessage(message) || message.role !== 'toolResult') return;
    const call = this.pendingCalls.get(message.toolCallId);
    if (call === undefined) {
      target.push({ kind: 'tool-result', brief: resultBrief(message) });
      return;
    }
    this.pendingCalls.delete(message.toolCallId);
    // 孤儿留账（批 10k 遗漏修）：repaint 投影显形的 ⚙ 行不撤销——已交
    // scrollback 物理不可回改，splice 撤账是账屏失同步的假象收敛（屏上 ⚙
    // 残留而块账消失，下次 repaint 前两账错位）。留账留屏 + 卡追加 = 净 +1
    // 块（呈现侧 B 段照常写卡）；再投影自然收敛仅卡（pendingCalls 已出账）
    target.push(this.buildToolCard(call, message));
  }

  /** 卡面铸造：三态判定（aborted 标记 → isError → success）+ 卡体源选择（edit patch / 结果文本） */
  private buildToolCard(
    call: PendingToolCall,
    message: Extract<AgentMessage, { role: 'toolResult' }>,
  ): TranscriptBlock {
    const status: ToolCardStatus = isAbortedDetails(message.details)
      ? 'aborted'
      : message.isError
        ? 'error'
        : 'success';
    // edit 词级 diff 档：patch 参数体作卡体（R4「参数对」语义——呈现的是改了什么）
    const isEditPatch = call.name === 'edit' && typeof call.arguments.patch === 'string';
    const bodyText = isEditPatch ? (call.arguments.patch as string) : textOf(message);
    return {
      kind: 'tool-card',
      name: call.name,
      brief: call.brief,
      status,
      body: cardBodyOf(bodyText),
      diff: isEditPatch,
      expanded: this.toolCardsExpanded,
      theme: this.theme,
      // 插件渲染腿载荷（收官批③）：toolCall 参数 + toolResult 消息面全量事实
      // （toolName 单源 = 卡名故不含）；孤儿兜底 ↳ 形不携——renderInput 缺席
      // 即消费位回落宿主缺省卡体
      renderInput: {
        toolCallId: message.toolCallId,
        arguments: call.arguments,
        content: message.content,
        isError: message.isError,
        aborted: isAbortedDetails(message.details),
      },
    };
  }
  /** 帽卸载：超帽从头卸（保留帽内最近段——滚出视口交 scrollback 后内存上限语义；全量档 Infinity 恒不触发） */
  private trimToCap(): void {
    if (this.blocks.length > this.blockCap) {
      // 裁块累计单调入账（再投影重建重裁同段照加——绝对位不重影，见 getter 注）
      this.trimmedCount += this.blocks.length - this.blockCap;
      this.blocks = this.blocks.slice(this.blocks.length - this.blockCap);
    }
  }
}

/**
 * ↳ 工具结果简述：文本块首行按显示宽截断（无文本块返占位）。
 * 构造位消毒律（2026-09-21 补修批）：工具输出首行含源码缩进 tab 是日常形
 * ——先 sanitizeLineText（tab 展开 2 空格 + LF 归一）再测宽截断（修前 tab
 * 记宽 1 误过帽、简行发射位展开漂物理行账——物理行账漂移族）。
 */
function resultBrief(message: AgentMessage): string {
  const text = textOf(message);
  if (text === '') return '(无文本输出)';
  const firstLine = text.split('\n').find((line) => line.trim() !== '') ?? '';
  return truncateToWidth(sanitizeLineText(firstLine.trim()), BRIEF_WIDTH);
}
