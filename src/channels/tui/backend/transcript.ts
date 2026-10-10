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
 *   正文行），toolResult 按 toolCallId 配对落三态卡（✓/✗/⏹——中止走
 *   details 结构化标记）；折叠 = 卡头 + 尾 5 行预览（ctrl+o 会话级展开）；
 *   投影走查毕的在飞孤儿兜底 ⚙ 简行、配对到达撤销——两路收敛同形；
 * - **exec 折叠组**（07 §4.1 V-3 注⑩ 符号册词条——R4 到达即落在 exec 族
 *   翻档）：bash 族 toolResult 到达不即时落卡、窗内暂存；窗收口（直播路 =
 *   agent_end / user 消息边界，投影路 = user 消息段切分近似）统一求值——
 *   窗内已完成配对条数 N≥3 落一张组卡（卡头 `• Ran N commands` + 组级最差
 *   态 + 各命令一行 `$ ` 摘要体），N<3 逐条补落 R4 既有卡形；孤儿在飞不
 *   入 N 不入组卡；非 exec 工具到达即落律不变；
 * - **流式三段**（呈现面件 1 批 10h R1 三段化）：流式期 **markdown 直推**
 *   （streaming 槽携 StreamingMarkdown——增量装配 + 稳定面计量；doc = null
 *   为纯文本降档——字节帽超标回退形）、message_end 定稿换装（摘槽 →
 *   markdown 定稿块 + ⚙ 行）；槽携 **epoch**（每条 message_start 递增——
 *   main-screen 冻结账的槽同一性判据）；
 * - **流式单槽守卫**：repaint 切入 running 条目开的占位槽遇下一条 assistant
 *   message_start 重开时先摘旧槽（占位容器不孤儿滞留正文）；
 * - **帽 = 块数**（一个 Markdown 块一子行——呈现面件 1 滚动帽语义）：行集保留
 *   帽内最近段（内存上限语义；v1 保守值——实测定值回填挂主屏实装批校准）；
 * - **非聚焦摘要行**（呈现面件 9——机制已退役：V-1 笔2 瀑布退役 / V-0 注①
 *   聚合律）：曾在 agent_start ⧗ 瞬时追加、agent_end 按终态 ✓/✗/⏹ 各追加
 *   一行（不进行集、行首段 = 档位符号 + 会话短 id）；现非聚焦事件在
 *   applyEvent 全忽略——非聚焦呈现归 JobPanel 固定区与收口行（见 applyEvent
 *   注），不进行集不占帽。
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
  DIM_STYLE,
  EMPTY_STYLE,
  ellipsize,
  graphemeWidth,
  styleEquals,
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
import { renderThinkingStyledLines, type ThinkingView } from '../blocks/thinking.js';
import {
  cardBodyOf,
  humanizeGuardedOutput,
  renderToolCardStyledLines,
  sanitizeLineText,
  type ToolCardGroupCommand,
  type ToolCardGroupData,
  type ToolCardRenderInput,
  type ToolCardStatus,
} from '../blocks/tool-card.js';
import {
  argKeyZh,
  TOOL_RUN_MARK,
  toolFaceZh,
  lastCcrEntryOf,
  compactionSeparatorLine,
} from '../../../contracts/index.js';
import { CURSOR_MARK } from '../panels/panel-chrome.js';
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
  | {
      /** user 块（界面美化役批⑦三要素：› 前缀 bold+dim / 背景带 / 上下空行包夹） */
      readonly kind: 'user';
      readonly text: string;
      /** 主题（背景带键源——userMessageBg 探测缺席/降采形 = 无背景） */
      readonly theme: ResolvedTheme;
    }
  | { readonly kind: 'markdown'; readonly doc: MarkdownDoc }
  | {
      /** 思考块（批 10i R1——定稿形：斜体 + thinkingText 色，折叠标签/展开体两档） */
      readonly kind: 'thinking';
      readonly text: string;
      readonly expanded: boolean;
      readonly theme: ResolvedTheme;
      readonly toggleHint: string;
      /**
       * 思考段时长 ms（V-2 笔2 注④——本地钟：thinking 首增量到达 → settled）。
       * 缺席 = repaint 投影形（历史消息无消费端钟账）——标签诚实无时长形。
       */
      readonly durationMs?: number;
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
      /**
       * diff 段行号源（07 §4.3 ⑥——edit 成功回执注入）：operations[].startLine
       * 按补丁段序对齐（undefined 填充——add/delete/缺席段）；整缺席 = 号槽
       * 整列空白（诚实缺席）。铸入位 = buildToolCard edit 补丁腿。
       */
      readonly diffStartLines?: ReadonlyArray<number | undefined>;
      readonly expanded: boolean;
      readonly theme: ResolvedTheme;
      /**
       * 执行时长近似（UX 五问题批③——状态行消费）：toolResult.timestamp −
       * assistant.timestamp 差值（ms；契约零扩的诚实近似——含调度延迟非纯执行
       * 时长）。缺席（旧投影形/孤儿兜底）= 无状态行。
       */
      readonly durationMs?: number;
      /** 展开键提示（tools.toggle-expand 键名——预览省略行文案随册） */
      readonly toggleHint: string;
      /** 插件渲染腿载荷（renderResult 现调事实——2026-09-17 收官批③；缺席 = 宿主缺省卡体） */
      readonly renderInput?: ToolCardRenderInput;
      /**
       * exec 折叠组数据（07 §4.1 V-3 注⑩ 符号册词条）：在场 = 组卡变体
       * （窗收口 N≥3 时铸入）；缺席 = R4 逐卡既有形。组卡不携 renderInput/
       * durationMs（组级聚合面——插件腿与单卡状态行机制不进组卡）。
       */
      readonly group?: ToolCardGroupData;
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
      /**
       * 压缩时间线分隔块（07 B2 批 2——摘要载体 user 消息的替换呈现形）：
       * 载体本体（source='compaction' 的 user 消息——可能是数千字摘要）零
       * user 块直呈，落一行 dim 分隔线「── 已压缩 N 条对话 ──」（回合记账
       * 线族同款）。count = CCR 标记段末行解析的遮蔽条数；缺席 = CCR 批前
       * 历史载体降级形「── 已压缩 ──」。
       */
      readonly kind: 'compaction';
      /** 已压缩对话条数（旧载体降级形缺席） */
      readonly count?: number;
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
      /** 思考首增量到达时戳 ms（注④本地钟起点——'' → 非空首翻一次定格） */
      readonly thinkingStartAt: number | null;
      /** 思考最近 settled 时戳 ms（false→true 每次翻转重戳——交错形取末次收敛） */
      readonly thinkingSettledAt: number | null;
      readonly theme: ResolvedTheme;
      readonly toggleHint: string;
    };

/** 会话短 id（呈现层自截——散列映射色板键同源） */
export function shortIdOf(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** dim 样式（简行块的整行样式——SGR 2；注⑩：engine 正典单源） */

/** bullet 槽前缀宽（注⑩——`• ` 首行与 `  ` 续行同宽 2 列） */
const BULLET_PREFIX_WIDTH = 2;

/** 素空行单例（块间空行制度 R-1 垫行——plain 空零游程，主屏空行直写形字节不变） */
const BLANK_LINE: StyledLine = { plain: '', runs: [] };

/**
 * 块前垫施加（Codex 样式复刻批 R-1——07 §4.1 直播路注①：块间空行制度）：
 * 每块渲染层行首垫 1 素空行（块账不动——垫是渲染层行）；首块豁免位
 * leadingGap=false（top:0 无垫，头卡即首块）；流式续接块豁免对齐冻结面前缀
 * 连续律（续接块不另起垫——垫只在槽组合的腿界插入，见 streaming case）。
 * 五件批「卡间上空行垫」与本制度同律（tool-card case 既有垫即制度行）。
 */
function withPad(lines: readonly StyledLine[], leadingGap: boolean): StyledLine[] {
  return leadingGap ? [BLANK_LINE, ...lines] : [...lines];
}

/**
 * agent 消息 bullet 槽行（注⑩ 符号册——• 列点前缀位）：doc/降档内容按
 * columns−2 折行后首行 `• `、续行两空格缩进（user 块 › 同构）；游程整段
 * 右移 2 列；空行保空行（前缀不携——主屏空行直写形字节不变）。定稿 markdown
 * 块与流式槽两路同轴消费（冻结跳行前提：live 槽与定稿块逐行同形）。
 * R-4（07 §4.3 ③）：首行 `• ` 前缀 dim 游程（bullet 槽符位弱化、正文照常
 * ——codex 同构；续行缩进两空格无墨迹不携游程）。
 */
function bulletSlotLine(line: StyledLine, rowIndex: number): StyledLine {
  if (line.plain === '') return { plain: '', runs: [] };
  const shifted = line.runs.map((run) => ({
    start: run.start + BULLET_PREFIX_WIDTH,
    end: run.end + BULLET_PREFIX_WIDTH,
    style: run.style,
  }));
  return {
    plain: (rowIndex === 0 ? '• ' : '  ') + line.plain,
    runs: rowIndex === 0 ? [{ start: 0, end: BULLET_PREFIX_WIDTH, style: DIM_STYLE }, ...shifted] : shifted,
  };
}

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
export function renderBlockStyledLines(block: TranscriptBlock, columns: number, leadingGap = true): StyledLine[] {
  return renderBlockStyledLinesUncapped(block, columns, leadingGap).map((line) => capStyledLine(line, columns));
}

/** 各块类型本体渲染（无帽——出口帽单点在 renderBlockStyledLines；leadingGap = 块前垫开关，R-1 块间空行制度——首块豁免位 false） */
function renderBlockStyledLinesUncapped(block: TranscriptBlock, columns: number, leadingGap = true): StyledLine[] {
  switch (block.kind) {
    case 'markdown':
      // bullet 槽（注⑩）：内容按 columns−2 折行 + `• `/`  ` 前缀（agent 消息
      // 列点位——user 块 › 同构的左缘结构）；块前垫 1 素空行（R-1 制度行）
      return withPad(
        renderDocLines(block.doc, columns - BULLET_PREFIX_WIDTH).map((line, i) => bulletSlotLine(line, i)),
        leadingGap,
      );
    case 'user': {
      // user 块三要素（界面美化役批⑦——UX 五问题批 2026-09-30）：`› ` 前缀
      // bold+dim 游程（续行两空格缩进既有）+ 背景带（userMessageBg 语义键
      // ——R2 扩键注：探测缺席/16 档降采/自定义缺键 = 无背景回退）+ 上下空行
      // 包夹（空行是块内行——块账不动，帽语义零变）。R-1 制度：三明治之上
      // 另加通用块前垫（前视觉 2 空行 = 外素垫 + 内包夹——codex「外 1 素 +
      // 内 1 染」同构）；豁免位剥通用垫、包夹空行保留（块内行不属制度垫）。
      // 斜杠兜底回显弱化（V-0 注③——斜杠命令提交回显 07 零条款真空白，
      // 补落码定值）：命令文本以 '/' 开头（本地命令族外的斜杠输入兜底落
      // user 块路）按回执层级呈现——整块 dim、无背景带（不占全宽染色块，
      // 与 notify 回执 dim 化同层级）；正常对话文本维持三要素形
      const slashEcho = block.text.trimStart().startsWith('/');
      const bg = slashEcho ? undefined : block.theme.userMessageBg;
      const prefixStyle: Readonly<CellStyle> =
        bg === undefined ? Object.freeze({ bold: true, dim: true }) : Object.freeze({ bold: true, dim: true, bg });
      // 折行宽 columns−3（R-1——前缀 2 + 右缘 1 列恒空，与 composer innerWidth 同口径）
      const lines = wrapText(block.text, columns - 3);
      const styled = lines.map((line, i): StyledLine => {
        // 前缀符 = panel-chrome CURSOR_MARK 单源（V-3 注⑩ ›——与 editor 输入
        // 提示符同字符，codex composer 形）
        const plain = (i === 0 ? `${CURSOR_MARK} ` : '  ') + line;
        if (slashEcho) {
          // 回执层级：整行 dim（前缀含在内）——弱存在感与转写摘要对齐
          return plain.length > 0
            ? { plain, runs: [{ start: 0, end: plain.length, style: DIM_STYLE }] }
            : { plain, runs: [] };
        }
        if (bg === undefined) {
          // 无背景带：首行仅前缀段 bold+dim，续行裸
          return i === 0 ? { plain, runs: [{ start: 0, end: 2, style: prefixStyle }] } : { plain, runs: [] };
        }
        // 背景带：首行前缀段（bold+dim+bg）+ 其余整段 bg；续行整行 bg
        const runs: StyleRun[] = [{ start: 0, end: 2, style: prefixStyle }];
        if (plain.length > 2) runs.push({ start: 2, end: plain.length, style: Object.freeze({ bg }) });
        return { plain, runs };
      });
      // R-2 全宽带（fillBg 行级尾腿）：bg 在场 → 三明治空行与正文行各携
      // fillBg（行尾残区铺满至屏宽——外素内染：块前垫是制度行不染）；
      // slashEcho / 无 bg 形维持素行（尾腿缺席零变）
      if (bg !== undefined) {
        return withPad(
          [
            { plain: '', runs: [], fillBg: bg },
            ...styled.map((line): StyledLine => ({ ...line, fillBg: bg })),
            { plain: '', runs: [], fillBg: bg },
          ],
          leadingGap,
        );
      }
      return withPad([{ plain: '', runs: [] }, ...styled, { plain: '', runs: [] }], leadingGap);
    }
    case 'thinking':
      // 思考块两档渲染（blocks/thinking 纯函数——槽前缀行同函数两用）；定稿块
      // 恒 settled 档（durationMs 缺席 = 投影形——标签诚实无时长）；块前垫
      // 1 素空行（R-1 制度行——与槽组合腿间垫镜像同形）
      return withPad(
        renderThinkingStyledLines(
          {
            text: block.text,
            expanded: block.expanded,
            phase: 'settled',
            durationMs: block.durationMs,
            theme: block.theme,
            toggleHint: block.toggleHint,
          },
          columns,
          block.doc,
        ),
        leadingGap,
      );
    case 'tool-card':
      // 块前垫（TUI 对标 Codex 五件批 C 件 R4 起垫——R-1 块间空行制度并入：
      // 卡间分离垫即制度行不再单列）：渲染层块前空行垫 1 行、块账不动
      // （append-only 律——与 user 块上下空行包夹同构的单侧形，无条件前置保
      // 渲染纯函数性）；卡面染色由 tool-card 件出口统一施加（toolCardBg
      // ——键缺席恒零施加）
      return withPad(
        [
          ...renderToolCardStyledLines(
            {
              name: block.name,
              brief: block.brief,
              status: block.status,
              body: block.body,
              diff: block.diff,
              expanded: block.expanded,
              theme: block.theme,
              durationMs: block.durationMs,
              toggleHint: block.toggleHint,
              renderInput: block.renderInput,
              group: block.group,
            },
            columns,
          ),
        ],
        leadingGap,
      );
    case 'tool-call':
      // ⚙ 简行（孤儿兜底）：名段用户面动词（V-0 注⑤——呈现位转写，账存原始名）
      // + 块前垫（R-1 制度行）
      return withPad([dimStyledLine(` ${TOOL_RUN_MARK} ${toolFaceZh(block.name)}${block.brief}`)], leadingGap);
    case 'tool-result':
      return withPad([dimStyledLine(` ↳ ${block.brief}`)], leadingGap);
    case 'error': {
      // 错误块（P0 静默链修复批——07 §4.1）：行首 ✗ 前缀（注⑩——✗ 形退役）+
      // error 语义键前景整行（与 tool-card.ts 语义色消费同源）；折行续行两空格
      // 缩进（user 块同律）。
      // JSON 可读化前置（界面美化役批⑦）：401/403 类应答体先提取可读形首行
      // （message 字段优先），原文随后展开可见。行数帽（2026-09-20 TUI 修复
      // 组 1 批 F5）：网关 403 类错误体是整段裸 JSON（单「行」折开后数十行噪声
      // 全量上屏）——首行摘要语义：保前 ERROR_PREVIEW_LINES-1 行 + 截断标记行
      // 收口（剩余行数明示），error 前景同游程保持错误语义可辨
      // 护栏注记同转写（注④双轨分层——错误块若含超帽产物同律人读化）
      const lines = wrapText(humanizeGuardedOutput(errorReadableText(block.text)), columns - 2);
      const style: Readonly<{ fg: ColorValue }> = Object.freeze({ fg: block.theme.error });
      const renderErrorLine = (line: string, i: number): StyledLine => {
        const plain = (i === 0 ? '✗ ' : '  ') + line;
        return { plain, runs: [{ start: 0, end: plain.length, style }] };
      };
      if (lines.length <= ERROR_PREVIEW_LINES) return withPad(lines.map(renderErrorLine), leadingGap);
      const kept = lines.slice(0, ERROR_PREVIEW_LINES - 1).map(renderErrorLine);
      const dropped = lines.length - (ERROR_PREVIEW_LINES - 1);
      const marker = `  ⋯（错误详情已省 ${dropped} 行）`;
      return withPad([...kept, { plain: marker, runs: [{ start: 0, end: marker.length, style }] }], leadingGap);
    }
    case 'compaction':
      // 压缩时间线分隔行（B2 批 2）：dim 单行（回合记账线族同款——不占全宽
      // 染色、无背景带）；N 缺席 = 旧载体降级形。词面单源 compactionSeparatorLine
      // （contracts/ccr-marker——B2 webui 对端迁移批起 TUI/webui 双消费，本位
      // 原两形模板串收敛单源）+ 块前垫（R-1 制度行）
      return withPad([dimStyledLine(compactionSeparatorLine(block.count))], leadingGap);
    case 'streaming': {
      // 槽渲染 = 思考前缀行 + doc 行（拼接序与定稿换装块序一致——冻结跳行前提）；
      // markdown 直推档走网格管线（bullet 槽同轴——与定稿 markdown 块逐行同形）；
      // 降档（doc = null）纯文本直推（bullet 前缀同律）；空文本零行。
      // R-1 槽组合镜像：[头垫]+think+[腿间垫]+doc——每腿各前 1 素空行（闭槽
      // 拆块后 thinking 块+[垫]+markdown 块逐行同形）；leadingGap=false 首槽
      // top:0 无头垫（首块豁免位——B 段/C 段同参冻结跳行不漂移）
      const lines: StyledLine[] = [];
      if (leadingGap) lines.push(BLANK_LINE);
      if (block.thinking !== '')
        lines.push(...renderThinkingStyledLines(slotThinkingView(block), columns, block.thinkingDoc));
      if (block.thinking !== '' && (block.doc !== null || block.text !== '')) lines.push(BLANK_LINE); // 腿间垫（两腿在场才插——思考未 settled 全槽不冻定律护住前缀稳定性）
      if (block.doc !== null)
        lines.push(
          ...renderDocLines(block.doc, columns - BULLET_PREFIX_WIDTH).map((line, i) => bulletSlotLine(line, i)),
        );
      else if (block.text !== '')
        lines.push(
          ...wrapText(block.text, columns - BULLET_PREFIX_WIDTH).map((text, i): StyledLine =>
            bulletSlotLine({ plain: text, runs: [] }, i),
          ),
        );
      return lines;
    }
  }
}

/**
 * 槽思考视图折算（注④标签档——全量渲染与尾窗渲染两腿单源）：settled 即转
 * 定稿档（时长 = settledAt − startAt 双戳齐备才算，缺任一戳诚实缺席）；
 * 未 settled 流式档无计量。
 */
function slotThinkingView(slot: Extract<TranscriptBlock, { kind: 'streaming' }>): ThinkingView {
  const durationMs =
    slot.thinkingSettled && slot.thinkingStartAt !== null && slot.thinkingSettledAt !== null
      ? slot.thinkingSettledAt - slot.thinkingStartAt
      : undefined;
  return {
    text: slot.thinking,
    expanded: slot.thinkingExpanded,
    phase: slot.thinkingSettled ? 'settled' : 'streaming',
    durationMs,
    theme: slot.theme,
    toggleHint: slot.toggleHint,
  };
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
export function stableSlotLineCount(
  slot: Extract<TranscriptBlock, { kind: 'streaming' }>,
  columns: number,
  leadingGap = true,
): number {
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
  // R-1 槽组合镜像账（与 renderBlockStyledLinesUncapped streaming case 逐行同形）：
  // [头垫]+think+[腿间垫]+doc——两垫各 1 行；腿间垫两腿在场才插（思考
  // append-only → 垫出现即不消失，且出现时 doc 腿零行在账、无既有行移位）
  const gap = leadingGap ? 1 : 0;
  const interGap = slot.thinking !== '' && (slot.doc !== null || slot.text !== '') ? 1 : 0;
  // doc 腿计量宽 = 渲染腿同宽（bullet 槽前缀宽 2——renderDocLines/rowsFor 均
  // 按 columns−2 折行；修前全宽计量使折行数与渲染行集漂移，窄形边界文本
  // 冻结账错位）
  return (
    gap + thinkingRows + interGap + (slot.doc !== null ? slot.doc.stableLineCount(columns - BULLET_PREFIX_WIDTH) : 0)
  );
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
 * leadingGap = 槽头垫开关（R-1 槽组合镜像——与全量渲染 streaming case 的
 * [头垫]+think+[腿间垫]+doc 同形同账；首槽 top:0 豁免位 false）。
 *
 * 动机：修前 present() 每帧全量渲染整槽（含冻结前缀）——已冻结行是
 * append-only 升格 durable 的不可回改内容（升格后永不再写），重渲染纯白算
 * 且不进 slotFrameBytes 帽（冻结面白算不可观测）；3600 行槽实测 75ms/帧 =
 * 60fps 预算 4.5 倍。
 *
 * 字节等价契约：`(total, lines) ≡ (renderBlockLines(slot, columns, leadingGap).length,
 * renderBlockLines(slot, columns, leadingGap).slice(startRow))`——对拍锁在
 * transcript.test.ts（多形语料 × 多宽 × 多起点 × 双 leadingGap）。legs：
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
  leadingGap = true,
): SlotTailLines {
  // R-1 槽组合镜像账（renderBlockStyledLinesUncapped streaming case 同形）：
  // [头垫]+think+[腿间垫]+doc——startRow 偏移映射随两垫前移；垫行 ANSI 空串
  // （主屏空行直写形字节不变——BLANK_LINE 序列化同形）
  const gap = leadingGap ? 1 : 0;
  const interGap = slot.thinking !== '' && (slot.doc !== null || slot.text !== '') ? 1 : 0;
  const thinkingRows =
    slot.thinking !== ''
      ? thinkingRowCount(
          { text: slot.thinking, expanded: slot.thinkingExpanded, theme: slot.theme },
          columns,
          slot.thinkingDoc,
        )
      : 0;
  const lines: string[] = [];
  // 头垫尾窗段（startRow = 0 落垫上——仅全量形触达，垫行单字节空串）
  if (startRow < gap) lines.push('');
  // thinking 尾窗段（startRow 落思考区内——超出则思考行全在冻结前缀，零渲染）
  if (slot.thinking !== '' && startRow < gap + thinkingRows) {
    const thinkingLines = renderThinkingStyledLines(slotThinkingView(slot), columns, slot.thinkingDoc).map((line) =>
      styledLineToAnsi(capStyledLine(line, columns)),
    );
    for (let i = Math.max(0, startRow - gap); i < thinkingLines.length; i++) lines.push(thinkingLines[i]!);
  }
  // 腿间垫尾窗段（垫行槽位 = gap+thinkingRows——startRow 未越过才发；空串与
  // BLANK_LINE 序列化同形）
  if (interGap === 1 && startRow < gap + thinkingRows + interGap) lines.push('');
  // doc 尾窗段（行集直转——自 docStart 起逐行；bullet 槽前缀同轴〔注⑩〕；
  // 行宽 = columns−2 内容 + 前缀 2 = columns——出口帽 + 序列化与全量管线同律）
  const docStart = Math.max(0, startRow - gap - thinkingRows - interGap);
  let docRowCount = 0;
  if (slot.doc !== null) {
    const rows = slot.doc.rowsFor(columns - BULLET_PREFIX_WIDTH);
    docRowCount = rows.length;
    for (let r = docStart; r < rows.length; r++) {
      lines.push(
        styledLineToAnsi(
          capStyledLine(bulletSlotLine(docRowToStyledLine(rows[r]!, columns - BULLET_PREFIX_WIDTH), r), columns),
        ),
      );
    }
  } else if (slot.text !== '') {
    // 降档纯文本腿（零样式直推——bullet 前缀同律；切片同律）
    const wrapped = wrapText(slot.text, columns - BULLET_PREFIX_WIDTH);
    docRowCount = wrapped.length;
    for (let i = docStart; i < wrapped.length; i++)
      lines.push(styledLineToAnsi(capStyledLine(bulletSlotLine({ plain: wrapped[i]!, runs: [] }, i), columns)));
  }
  return { total: gap + thinkingRows + interGap + docRowCount, lines };
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
export function renderBlockLines(block: TranscriptBlock, columns: number, leadingGap = true): string[] {
  return renderBlockStyledLines(block, columns, leadingGap).map(styledLineToAnsi);
}

/** 消息文本块拼接（user/assistant/toolResult 通用；自定义角色与无文本块返 ''） */
function textOf(message: AgentMessage): string {
  // isStandardMessage 守卫先行——CustomMessage role: string 非字面判别位，
  // 相等/开关收窄均排不掉，经守卫归一到标准三角色（自定义角色呈现侧宽容跳过）
  if (!isStandardMessage(message)) return '';
  if (typeof message.content === 'string') return message.content; // user 纯文本形
  return joinTextBlocks(message.content);
}

/**
 * 图片占位行文案（03 §10.4 剪贴板附件批注⑦——TUI 对端呈现）：终端无图呈现
 * 面，user 块 image/image-ref 块降本占位行在场（webui 粘贴的图在 TUI 侧以
 * 占位行可见——同一 durable 事件两通道呈现）；joinTextBlocks 现状静默丢图
 * 升格诚实占位。
 */
const IMAGE_PLACEHOLDER_LINE = '[图片]';

/**
 * 文本块抽取拼接（图文/思考/工具块族里 text 块的串接——无文本块返 ''）。
 * image/image-ref 块降「[图片]」占位行：每块一行、图序保留——与文本行序
 * 交织按 content 块序（03 §10.4 剪贴板附件批注⑦）。文本块相邻仍零分隔直
 * 拼（既有行为不变——占位行只求自身独占一行，行界只在占位两侧按需补齐）。
 */
function joinTextBlocks(blocks: readonly { type: string; text?: string }[]): string {
  let out = '';
  let lastWasPlaceholder = false; // 上一块是否图占位——其后文本块须另起一行
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      // 占位后首文本块补行界（占位行不被后续文本粘连——每块一行的「块」语义）
      if (lastWasPlaceholder) out += '\n';
      out += block.text;
      lastWasPlaceholder = false;
    } else if (block.type === 'image' || block.type === 'image-ref') {
      // 图块占位（type 字符串直判——image-ref 块形由剪贴板附件批扩，本位不依赖联合收窄）
      if (out !== '' && !out.endsWith('\n')) out += '\n';
      out += IMAGE_PLACEHOLDER_LINE;
      lastWasPlaceholder = true;
    }
  }
  return out;
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
 * 参数键值短显白名单（UX 五问题批②——codex 对标复刻）：白名单键取值截 40
 * 列短显（command/path/pattern 等高频可读键），非白名单键维持键名形（呈现面
 * 克制不倒任意参数值——白名单外值面不进简述）。V-0 注⑤扩容：prompt（agent
 * 任务——裸键名形 → `任务=…` 人读）与 background（boolean 直显 `后台=true`）。
 */
const ARG_VALUE_KEYS: ReadonlySet<string> = new Set(['command', 'path', 'pattern', 'file', 'prompt', 'background']);

/**
 * 工具简述：参数键名/键值序列。白名单键值短显（UX 五问题批②）：string 值
 * `${键}=${值截 40 列}`、number/boolean 值直显，其余形回退键名；整段仍受
 * BRIEF_WIDTH 帽（界面美化役批①：截断走 ellipsize `…` 单源口径——裸截无省略
 * 号的「悄然吃字」不可辨）。构造位消毒律（2026-09-21 补修批）：键名/值是
 * JSON 任意字符串可含 tab/LF——先 sanitizeLineText（tab 展开 2 空格 + LF 归
 * 一）再测宽截断（修前 tab 记宽 1 误过帽、简行发射位展开漂物理行账）。
 */
function argsBrief(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  const parts = keys.map((key) => {
    if (!ARG_VALUE_KEYS.has(key)) return argKeyZh(key); // 非白名单键：键名形（值不进简述；键位用户面中文化 V-0 注⑤）
    const value = args[key];
    const label = argKeyZh(key); // 白名单键位同样经映射（prompt→任务 等——参数签名键位）
    if (typeof value === 'string') return `${label}=${ellipsize(sanitizeLineText(value), BRIEF_WIDTH)}`;
    if (typeof value === 'number' || typeof value === 'boolean') return `${label}=${String(value)}`;
    return label; // 对象/数组等复合值：键名形（不发明序列化）
  });
  return ellipsize(sanitizeLineText(`(${parts.join(', ')})`), BRIEF_WIDTH);
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
  /**
   * 注入钟（V-2 笔2 注④——思考段时长 = 消费端本地钟：thinking 首增量到达 →
   * settled；非事件载荷真源、与 run 级 durationMs 口径分立——冷读闸注）。
   * 测试注入可控钟；缺省墙钟。
   */
  readonly now?: () => number;
}

/** 缺省键名回退表（册单源派生——直构档〔测试/回看器〕无 Keymap 时的取键面） */
const DEFAULT_KEY_TEXT: ReadonlyMap<string, string> = new Map(ACTION_CATALOG.map((def) => [def.id, def.keys[0]!]));

/** 在飞工具调用账（批 10i R4——toolCallId → 调用面，配对落卡的账本） */
interface PendingToolCall {
  readonly name: string;
  readonly brief: string;
  readonly arguments: Record<string, unknown>;
  /** 请求时戳（ms——assistant 消息 timestamp；卡状态行时长近似式的减数） */
  readonly requestedAt: number;
}

/** 在飞账帽（防御位——异常形消息序列下不无限滞留；超帽最旧让位） */
const MAX_PENDING_CALLS = 64;

/**
 * exec 折叠组阈值（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条）：窗内已完成
 * toolResult 配对条数 N ≥ 3 → 窗收口落一张组卡；N < 3 逐条补落 R4 逐卡形
 * （短窗不聚合——两三条逐卡更可读）。
 */
export const EXEC_GROUP_THRESHOLD = 3;

/**
 * exec 内建族判据（词条——exec（bash）族）：工具名 === 'bash'（载荷保原始
 * 名，判断位单源；插件若注册同名渲染腿只作用于单卡面——组卡是宿主组级
 * 聚合面不铸 renderInput，结构性无插件腿）。其余工具（read/edit/插件名）
 * 到达即落律不变。
 */
function isExecToolCallName(name: string): boolean {
  return name === 'bash';
}

/** 工具结果三态判定（R4 既有序——aborted 结构化标记 > isError > success） */
function toolResultStatus(message: Extract<AgentMessage, { role: 'toolResult' }>): ToolCardStatus {
  if (isAbortedDetails(message.details)) return 'aborted';
  return message.isError ? 'error' : 'success';
}

/**
 * exec 退出码解析（组卡命令条目消费）：bash 数据面卡体首行 `Exit code: N`
 * （null〔信号终止〕/错误族无码形 → undefined——词条退出码位缺席 = 无码形）。
 * 与 exec 单卡状态行（renderExecStatusLine）同数据面同解析式。
 */
function parseExecExitCode(message: Extract<AgentMessage, { role: 'toolResult' }>): number | undefined {
  const first = cardBodyOf(textOf(message))[0] ?? '';
  const m = /^Exit code: (\d+)$/.exec(first);
  return m !== null ? Number(m[1]) : undefined;
}

/** exec 折叠组窗条目（窗收口求值的数据源——调用面 + 结果消息全存，收口现铸卡） */
interface ExecWindowEntry {
  readonly call: PendingToolCall;
  readonly message: Extract<AgentMessage, { role: 'toolResult' }>;
}

/**
 * 机器注入 source 族（TUI 视觉重设计批 V-1 笔2——07 §4.1 V-0 注① source
 * 过滤位）：subagent 结算/审批挂起注入的 user 块用户面零呈现（终态呈现归
 * JobPanel 收口行）；真用户消息（source 缺省/user/channel:/schedule 等用户
 * 通道族）渲染律不变。durable 注入维持（模型面知情不动——呈现层过滤）。
 * B2 批 2 扩 'compaction'（07 B2 定形注——V-0 注① 集扩位）：压缩摘要载体
 * user 块零呈现（替换为 compaction 分隔块——见 compactionSeparatorBlockOf；
 * ZCode inputVisibility=model-only 同构：durable 注入与模型面不动）。
 */
const MACHINE_INJECTED_USER_SOURCES: ReadonlySet<string> = new Set([
  'subagent-settled',
  'subagent-approval-pending',
  'compaction',
]);

/** user 消息呈现判据（直播/投影两路单源——机器注入族滤除） */
function rendersAsUserBlock(message: AgentMessage): boolean {
  if (!isStandardMessage(message)) return false;
  return message.role === 'user' && !MACHINE_INJECTED_USER_SOURCES.has(message.source ?? 'user');
}

/**
 * 压缩摘要载体 → 分隔块（B2 批 2 呈现层单源——两路消费同判据）：判据 =
 * 标准 user 消息且 source='compaction'（摘要载体专用源——fiveStep 落账形）；
 * N 解析自 CCR 标记段末行（contracts/ccr-marker 单源解析——呈现层零复刻
 * 格式串），CCR 批前历史载体无标记段 → count 缺席（渲染降级形）。非载体
 * 返回 null（真用户/其余机器注入族各归其位）。
 */
function compactionSeparatorBlockOf(message: AgentMessage): TranscriptBlock | null {
  if (!isStandardMessage(message)) return null;
  if (message.role !== 'user' || message.source !== 'compaction') return null;
  const entry = lastCcrEntryOf(textOf(message));
  return { kind: 'compaction', ...(entry !== null ? { count: entry.messages } : {}) };
}

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
  /** 注入钟（注④思考时长本地钟——测试可控注入） */
  private readonly now: () => number;
  /** 槽代次计数器（每条 assistant message_start 递增） */
  private epochCounter = 0;
  private blocks: TranscriptBlock[] = [];
  /** 流式槽在场位（true = 末块是 streaming——message_start/message_end 配对守卫） */
  private slotOpen = false;
  /** 在飞工具调用账（assistant toolCall 入账 → toolResult 配对出账落卡） */
  private pendingCalls = new Map<string, PendingToolCall>();
  /**
   * exec 折叠组窗（07 §4.1 V-3 注⑩）：窗内已完成配对的 bash 条目暂存账——
   * toolResult 到达不即时落卡（R4 到达即落在 exec 族翻档），窗收口
   * （agent_end/user 边界；投影路 user 段切分）统一求值落卡。直播/投影
   * 两路共用本账（loadProjection 起步清窗）。
   */
  private execWindow: ExecWindowEntry[] = [];
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
    this.now = options.now ?? (() => Date.now());
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
   * 直播路归约：活体信封 → 聚焦会话行集更新（非聚焦零呈现——07 §4.1 V-0
   * 注①聚合律：过程事件零入对话流，非聚焦呈现归 JobPanel 固定区与收口行；
   * 旧「非聚焦摘要行」瀑布通道退役）。非聚焦会话的 durable 事件全忽略
   * （行集是聚焦会话的账——投影重建走 loadProjection）。
   */
  applyEvent(env: SessionEnvelope, focused: boolean): void {
    if (!focused) return;
    this.applyFocused(env.event);
  }

  /** 投影重建（repaint 路——清账按投影重拉帽内段；直播/repaint 行集同构） */
  loadProjection(messages: readonly AgentMessage[]): void {
    const rebuilt: TranscriptBlock[] = [];
    this.pendingCalls.clear(); // 配对账随投影重建（走查中 assistant 入账、toolResult 出账）
    this.execWindow = []; // exec 折叠组窗随投影重建（走查中暂存、段切分/走查毕收口）
    for (const message of messages) {
      switch (message.role) {
        case 'user': {
          // 压缩摘要载体 → 分隔块（B2 批 2——判据先于 user 块路：载体零直呈）
          const separator = compactionSeparatorBlockOf(message);
          if (separator !== null) {
            rebuilt.push(separator);
            break;
          }
          // 机器注入 source 族零呈现（V-0 注① source 过滤位——两路单源判据）
          if (rendersAsUserBlock(message)) {
            // exec 折叠组窗段切分（07 §4.1 V-3 注⑩——投影路窗边界近似：投影
            // 序列无 agent_end 信号，user 消息段即窗；判据与直播路 user 收口
            // 同源 rendersAsUserBlock——机器注入不切窗两路对齐。近似缝：直播
            // 路 retry 续跑在 agent_end 收口、投影路同段并窗——重试缝两路分
            // 歧是词条已注记的近似非回归）
            this.flushExecWindow(rebuilt);
            rebuilt.push({ kind: 'user', text: textOf(message), theme: this.theme });
          }
          break;
        }
        case 'assistant':
          this.appendAssistantFinal(rebuilt, message);
          break;
        case 'toolResult':
          this.appendToolResult(rebuilt, message);
          break;
        // 自定义角色：content unknown 宽容跳过（不猜形状——件 1 自定义渲染器优先级语义）
      }
    }
    // exec 折叠组窗走查毕收口（直播路 agent_end 收口位的投影对位——末段窗
    // 不滞留；先于孤儿 ⚙ 扫描：组卡位在前、孤儿兜底在后与直播路同序）
    this.flushExecWindow(rebuilt);
    // 在飞孤儿兜底：走查毕未见结果的调用照旧 ⚙ 简行（与直播路在飞期零正文行
    // 收敛同形——投影把「在飞」显形为 ⚙；结果到达配对落卡时 ⚙ 留账留屏）
    for (const [toolCallId, call] of this.pendingCalls) {
      rebuilt.push({ kind: 'tool-call', name: call.name, brief: call.brief, toolCallId });
    }
    this.blocks = rebuilt;
    this.slotOpen = false; // 投影是 durable 快照——无在飞槽
    this.trimToCap();
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
          thinkingStartAt: null,
          thinkingSettledAt: null,
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
        // 思考钟戳位（注④本地钟）：首增量 '' → 非空一次定格；settled 每次
        // false→true 翻转重戳（交错形取末次收敛——跨度诚实含思考间隔期）
        const startAt = slot.thinkingStartAt === null && thinking !== '' ? this.now() : slot.thinkingStartAt;
        const settledNow = thinkingSettledOf(event.partial);
        const settledAt = settledNow && !slot.thinkingSettled ? this.now() : slot.thinkingSettledAt;
        this.blocks[this.blocks.length - 1] = {
          ...slot,
          text,
          thinking,
          thinkingSettled: settledNow,
          thinkingStartAt: startAt,
          thinkingSettledAt: settledAt,
        };
        break;
      }
      case 'message_end': {
        // 判别位在载荷 message.role（事件自身不带 role 字段——轻载荷事件形）
        const { message } = event;
        if (message.role === 'assistant') {
          // 摘槽折算思考钟（注④本地钟——直播路槽戳位随摘除传给定稿块；
          // 投影路 appendAssistantFinal 不传 → durationMs 缺席诚实形）
          let thinkingClock: { readonly startAt: number; readonly settledAt: number } | null = null;
          if (this.slotOpen) {
            const slot = this.blocks.pop();
            this.slotOpen = false;
            if (
              slot !== undefined &&
              slot.kind === 'streaming' &&
              slot.thinkingStartAt !== null &&
              slot.thinkingSettledAt !== null
            ) {
              thinkingClock = { startAt: slot.thinkingStartAt, settledAt: slot.thinkingSettledAt };
            }
          }
          this.appendAssistantFinal(this.blocks, message, thinkingClock);
        } else if (message.role === 'user') {
          // 压缩摘要载体 → 分隔块（B2 批 2——判据先于 user 块路；载体不切
          // exec 窗〔机器注入族同律——窗边界只认真用户消息〕）
          const separator = compactionSeparatorBlockOf(message);
          if (separator !== null) {
            this.blocks.push(separator);
          } else if (rendersAsUserBlock(message)) {
            // 机器注入 source 族零呈现（V-0 注①——两路单源判据）
            // exec 折叠组窗收口（07 §4.1 V-3 注⑩——窗不跨 user 消息）：先收口
            // 落卡、user 块在后（agent_end 之外的防御位收口锚——转写打断形窗
            // 不跨轮滞留；与投影路 user 段切分同边界判据 rendersAsUserBlock）
            this.flushExecWindow(this.blocks);
            this.blocks.push({ kind: 'user', text: textOf(message), theme: this.theme });
          }
        } else if (message.role === 'toolResult') {
          this.appendToolResult(this.blocks, message);
        }
        this.trimToCap();
        break;
      }
      case 'agent_end':
        // exec 折叠组窗收口主锚（07 §4.1 V-3 注⑩——直播路窗边界）：agent_end
        // 经 onEnvelope 先 transcript.applyEvent 后渲染触发——收口卡在终帧重绘
        // 前已落账，backend 零改（正文零渲染射界不破：本位只收口 exec 暂存账
        // 不产正文行）。任一终态（completed/aborted/failed）都收口。
        this.flushExecWindow(this.blocks);
        this.trimToCap();
        break;
      default:
        break; // turn_*/tool_execution_* 正文零渲染（状态面消费）；agent_start 等其余 agent_* 同零渲染
    }
  }

  /**
   * assistant 定稿展开（批 10i R1/R4 形）：思考文非空 → 思考块（折叠标签/
   * 展开体——槽前缀行的换装对位块）；文本非空 → markdown 块；toolCall 块 →
   * 在飞账入账（**不落 ⚙ 简行**——直播路在飞期零正文行，结果到达配对落卡；
   * repaint 投影走查毕孤儿兜底 ⚙）。
   */
  private appendAssistantFinal(
    target: TranscriptBlock[],
    message: AgentMessage,
    thinkingClock?: { readonly startAt: number; readonly settledAt: number } | null,
  ): void {
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
        // 直播路槽钟随摘除传入（注④本地钟定稿位）；投影路缺席 = 无时长形
        durationMs: thinkingClock ? thinkingClock.settledAt - thinkingClock.startAt : undefined,
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
          // 请求时戳入账（UX 五问题批③——状态行时长近似式的减数）
          requestedAt: message.timestamp,
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
   * 工具结果配对落卡（批 10i R4 + exec 折叠组翻档）：账内在飞 → exec 族
   * 入窗暂存（到达不落卡——窗收口统一求值）/ 其余到达即落三态卡（换卡时
   * 撤销投影期同 id 孤儿 ⚙ 行——repaint 后到达的结果两路收敛同形）；账外
   * 兜底 ↳ 简行（未配对结果不伪装成卡）。
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
    // exec 族改窗内暂存（07 §4.1 V-3 注⑩——R4 到达即落对本族翻档）
    if (isExecToolCallName(call.name)) {
      this.execWindow.push({ call, message });
      return;
    }
    target.push(this.buildToolCard(call, message));
  }

  /**
   * exec 折叠组窗收口（07 §4.1 V-3 注⑩ 符号册词条）：窗内条目统一求值落卡
   * ——N ≥ 阈值落一张组卡（组级最差态聚合 + 各命令一行摘要）、N < 阈值逐条
   * 补落 R4 既有卡形（保序）；孤儿在飞不在窗内（无 toolResult 不入 N——
   * 直播路在飞可见性归面板/状态行，投影路走查毕 ⚙ 兜底照旧族）。收口后清窗。
   * 调用位：直播路 agent_end / user 边界（先收口后落 user 块——窗不跨 user
   * 消息）；投影路 user 段切分 + 走查毕（孤儿 ⚙ 扫描前——组卡位与直播路
   * agent_end 收口位对齐）。
   */
  private flushExecWindow(target: TranscriptBlock[]): void {
    if (this.execWindow.length === 0) return;
    const entries = this.execWindow;
    this.execWindow = [];
    if (entries.length >= EXEC_GROUP_THRESHOLD) {
      target.push(this.buildExecGroupCard(entries));
      return;
    }
    // N < 阈值：逐条补落 R4 既有卡形（buildToolCard 现铸——窗期 toggle/theme
    // 变更不滞留旧快照）
    for (const entry of entries) target.push(this.buildToolCard(entry.call, entry.message));
  }

  /**
   * exec 组卡铸造（词条——组级形）：status = 组级最差态（aborted > error >
   * success，与渲染位 worstGroupStatus 同式——块面字段是账面冗余位）；
   * commands = 各条目一行摘要数据源（命令文本 = call 参数 command 键只读
   * + 三态 + 退出码解析）；组卡不铸 renderInput/durationMs（插件腿与单卡
   * 状态行机制不进组卡——组级聚合面）。
   */
  private buildExecGroupCard(entries: readonly ExecWindowEntry[]): TranscriptBlock {
    const commands: ToolCardGroupCommand[] = entries.map((entry) => ({
      command: typeof entry.call.arguments.command === 'string' ? entry.call.arguments.command : '',
      status: toolResultStatus(entry.message),
      exitCode: parseExecExitCode(entry.message),
    }));
    const status: ToolCardStatus = commands.some((c) => c.status === 'aborted')
      ? 'aborted'
      : commands.some((c) => c.status === 'error')
        ? 'error'
        : 'success';
    return {
      kind: 'tool-card',
      name: 'bash',
      brief: '',
      status,
      body: [],
      diff: false,
      expanded: this.toolCardsExpanded,
      theme: this.theme,
      toggleHint: this.keyText('tools.toggle-expand'),
      group: { count: commands.length, commands },
    };
  }

  /** 卡面铸造：三态判定（aborted 标记 → isError → success）+ 卡体源选择（edit patch / 结果文本） */
  private buildToolCard(
    call: PendingToolCall,
    message: Extract<AgentMessage, { role: 'toolResult' }>,
  ): TranscriptBlock {
    const status: ToolCardStatus = toolResultStatus(message);
    // edit 词级 diff 档：patch 参数体作卡体（R4「参数对」语义——呈现的是改了什么）
    const isEditPatch = call.name === 'edit' && typeof call.arguments.patch === 'string';
    const bodyText = isEditPatch ? (call.arguments.patch as string) : textOf(message);
    // ⑥ diff 行号源：成功回执 operations 段序提取（update 注 startLine；失败/
    // 回执缺席/非法形 → undefined——渲染面行号槽空白整列，诚实缺席非伪号）
    const diffStartLines = isEditPatch ? extractDiffStartLines(message.details) : undefined;
    // background 委派卡体抑制（07 §4.1 V-0 注①——起跑回执退役入面板行）：
    // 模型面结果文本不动（回执是模型的委派知情位），用户面卡体零行（过程
    // 呈现归 JobPanel 运行行）；one-shot agent / 普通工具卡体照常
    const isBackgroundDelegation = call.name === 'agent' && call.arguments.background === true;
    // 状态行时长近似（UX 五问题批③——契约零扩的诚实近似）：toolResult 时戳
    // 减 assistant 请求时戳，含调度延迟（工具排队/审批等待计入——非纯执行
    // 时长）；钳非负（时钟回退防御）
    const durationMs = Math.max(0, message.timestamp - call.requestedAt);
    return {
      kind: 'tool-card',
      name: call.name,
      brief: call.brief,
      status,
      body: isBackgroundDelegation ? [] : cardBodyOf(bodyText),
      diff: isEditPatch,
      ...(diffStartLines !== undefined ? { diffStartLines } : {}),
      expanded: this.toolCardsExpanded,
      theme: this.theme,
      durationMs,
      // 展开键提示随册（tools.toggle-expand——预览省略行文案用）
      toggleHint: this.keyText('tools.toggle-expand'),
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
 * edit 回执 operations → diff 档行号序列（07 §4.3 ⑥——纯函数）：与 patch 段
 * 序同源对齐（同一 patch 体两侧解析，段序一致），update 段取 startLine、
 * add/delete 段 undefined 占位。防御：details 非法形（operations 非数组/项非
 * 对象/startLine 非数）整席缺席返回 undefined——渲染面以 undefined 判「行号
 * 不可知」走空槽腿（诚实缺席，不造伪号）。
 */
function extractDiffStartLines(details: unknown): ReadonlyArray<number | undefined> | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const operations = (details as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length === 0) return undefined;
  const starts: Array<number | undefined> = [];
  for (const item of operations) {
    if (typeof item !== 'object' || item === null) return undefined;
    const startLine = (item as { startLine?: unknown }).startLine;
    starts.push(typeof startLine === 'number' ? startLine : undefined);
  }
  return starts;
}

/**
 * 错误文本 JSON 可读化（界面美化役批⑦——纯函数）：模型 API 401/403 类错误的
 * errorMessage 是整段裸 JSON 应答体——提取可读形前置成首行摘要（message 字段
 * 优先：doc.message → doc.error.message → doc.error 字符串形 → doc.status），
 * 原文随后保留（经折行展开可见——行数帽既有律维持）。非 JSON / 无可提取字段
 * 原样返回（诚实退原形）。
 */
function errorReadableText(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return text; // 无 JSON 候选段
  let doc: unknown;
  try {
    doc = JSON.parse(text.slice(start, end + 1));
  } catch {
    return text; // 候选段非合法 JSON——原样
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return text;
  const record = doc as Record<string, unknown>;
  let message: string | undefined;
  if (typeof record.message === 'string') message = record.message;
  else if (typeof record.error === 'string') message = record.error;
  else if (typeof record.error === 'object' && record.error !== null) {
    const inner = (record.error as Record<string, unknown>).message;
    if (typeof inner === 'string') message = inner;
  }
  if (message === undefined && typeof record.status === 'number') message = String(record.status);
  if (message === undefined) return text; // 无可提取字段——原文保真
  // 引导语（JSON 前的叙述段，如 "Provider 401: "）剥尾空白/冒号收编为摘要前缀
  const head = text.slice(0, start).replace(/[\s:：]+$/, '');
  const summary = head === '' ? message : `${head}：${message}`;
  return `${summary}\n${text}`;
}

/**
 * ↳ 工具结果简述：文本块首行按显示宽截断（无文本块返占位）。
 * 构造位消毒律（2026-09-21 补修批）：工具输出首行含源码缩进 tab 是日常形
 * ——先 sanitizeLineText（tab 展开 2 空格 + LF 归一）再测宽截断（修前 tab
 * 记宽 1 误过帽、简行发射位展开漂物理行账——物理行账漂移族）。截断走
 * ellipsize `…` 单源口径（界面美化役批①——省略号可辨）。
 */
function resultBrief(message: AgentMessage): string {
  const text = textOf(message);
  if (text === '') return '(无文本输出)';
  const firstLine = text.split('\n').find((line) => line.trim() !== '') ?? '';
  return ellipsize(sanitizeLineText(firstLine.trim()), BRIEF_WIDTH);
}
