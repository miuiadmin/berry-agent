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
 * - **组窗两族**（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条 + 探索组卡批
 *   词条——R4 到达即落在 exec/探索两族翻档）：exec（bash）与探索（read/
 *   ls/find/grep——宿主内建只读族白名单）toolResult 到达不即时落卡、**单
 *   组窗**内暂存；**异族 toolResult 到达即收口**（窗边界泛化——单窗账，
 *   呈现序保真；探索族另失败封闭：窗内已见失败/中止后续探索开新窗）；窗
 *   收口余位（直播路 = agent_end / 真用户消息边界，投影路 = user 消息段
 *   切分近似）统一求值——exec 族 N≥3 落 `• Ran N commands` 组卡、探索族
 *   N≥2 落探索组卡（`已探索 N 项` + 归并动词子行——同工具相邻成功归并去
 *   重），N<阈值逐条补落 R4 既有卡形；孤儿在飞不入 N 不入组卡；其他工
 *   具到达即落律不变；
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
  DIM_STYLE,
  ellipsize,
  sanitizeDisplayText,
  stringWidth,
  wrapText,
  type CellStyle,
  type ColorValue,
} from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { capStyledLine, docRowToStyledLine, styledLineToAnsi, type StyleRun, type StyledLine } from './ansi-rows.js';
import { MarkdownDoc, type RowsSource } from '../markdown/markdown.js';
import { renderThinkingStyledLines, type ThinkingView } from '../blocks/thinking.js';
import {
  cardBodyOf,
  humanizeGuardedOutput,
  renderToolCardStyledLines,
  sanitizeLineText,
  type ExploringGroupEntry,
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
  type UiForkEditAnchor,
} from '../../../contracts/index.js';
import { CURSOR_MARK } from '../panels/panel-chrome.js';
import { DIM_STATUSES, STATUS_MARKS } from '../panels/todo-panel.js';
import { ACTION_CATALOG } from '../keys/registry.js';
import type { SessionEnvelope, TodoItem } from '../../types.js';

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
      /**
       * 会话头卡（07 §4.1 2026-10-10 Codex 样式复刻批 R-7——durable 首块）：
       * 转录区首块的单块自定界卡（codex session header 同构）。值随会话装配
       * 快照、构造期一次定格（repaint 投影 loadProjection 同源前插重建）。
       * 「框语言退役」（V-0 注③）的**显式例外**——头卡是单块自定界非面板
       * chrome，╭╮╰╯ 圆角框即其全部装饰；top:0 无前分隔空行（块间空行制
       * 首块豁免位——main-screen B 段 leadingGap=false 同判据）。
       */
      readonly kind: 'session-header';
      /** 宿主版本（空串 = 无版本缀裸名形） */
      readonly version: string;
      /** 初始模型全形（空串 = model 行诚实缺席） */
      readonly model: string;
      /** 工作目录全路径（空串 = directory 行诚实缺席） */
      readonly directory: string;
    }
  | {
      /**
       * 审批决策行块（挖掘 31 轮 [1]——07 §4.1 审批决策落史行词条）：人批
       * 决议（approve/always/reject × source=user）的 durable 落史呈现——
       * 非消息源 durable 块族（与头卡同属直播路渲染单源的第二豁免类：不经
       * message 事件——直播腿总线追加、重建腿 fold 按 seq 归位）。一行制：
       * 首游程 ✓/✗ 词面（语义色）+ 次游程 ` · ` 配对摘要（dim、折空一行化）。
       */
      readonly kind: 'approval-decision';
      /** 决议档（呈现子集三值——谓词滤除在消费侧单源 isUserApprovalDecision） */
      readonly decision: 'approve' | 'always' | 'reject';
      /** asked 配对摘要（一行化后直存；空串 = 单腿形裸词面） */
      readonly summary: string;
      readonly theme: ResolvedTheme;
    }
  | {
      /**
       * todo 清单快照块（挖掘 35 轮 B8——07 §4.1 todo-snapshot 词条）：
       * todo/write durable 轨迹的转录呈现（durable 非消息源块族第三员——
       * 头卡/审批决策行之后，直播腿 tool_execution_end 锚追加、重建腿
       * loadProjection 按 seq 归位）。多行块：卡头一行 + 条目每条一行；
       * 签名 diff 闸在 transcript 消费位（todoSignature——收集位不做闸）。
       */
      readonly kind: 'todo-snapshot';
      /** durable 位锚（todo/write 事件 seq——闸幂等判据；呈现不消费） */
      readonly seq: number;
      /** 快照条目（呈现投影形 TodoItem——装配从 TodoItemData 映射） */
      readonly items: readonly TodoItem[];
      readonly theme: ResolvedTheme;
    }
  | {
      /**
       * 问答落史行块（挖掘 36 轮 [2]——07 §4.1 问答落史行词条）：ctx.ui 阻塞
       * 三件（confirm/select/input）收场的即时一行落史——ask 收场单汇点
       * （UiCore）经 dispatch 总线词 ask/settled 回灌的 **live-only 旁支**：
       * 无 seq 归位锚、不进 durable 投影源（ask 族零 durable 事件——掩码
       * 策略另立挂账），onRepaint 重建后诚实消失 = 语义（scrollback 是呈现
       * 缓存非事实源）。一行制：首游程 ↳ 词面（语义色）+ 次游程 ` · `+问题
       * （dim）+ answered 另附 ` · `+答案（accent）。
       */
      readonly kind: 'ask-decision';
      /** 收场态（单汇点真相——answered 含他端竞速答走；cancelled = 保守收场伞形） */
      readonly outcome: 'answered' | 'cancelled';
      /** 原问题文（渲染位消毒+一行化——块内存原文） */
      readonly question: string;
      /** 答案呈现段（answered 在场；cancelled 缺席） */
      readonly answer?: string;
      readonly theme: ResolvedTheme;
    }
  | {
      /**
       * 回合收尾记账线块（挖掘 43 轮件 A——29 轮批 B 瞬时行 durable 化）：
       * agent_end completed 腿的 recap 行（runRecapLine 产物）从瞬时行迁块账
       * 载体——**live-only 旁支**（同 ask-decision 律）：无 seq 归位锚、不进
       * durable 投影源（agent_end 信号非投影源成员），onRepaint 重建后诚实
       * 消失 = 语义（scrollback 是呈现缓存非事实源）。一行制：label + 右缘 ─
       * 补至列宽（**渲染时合成**——resize 后按新宽重算，瞬时行按写时宽定格）；
       * 样式弱线双档（weakRule 在场 fg 单游程 / 缺席回退 DIM——收尾行 V-3
       * 注⑨② 同律）。
       */
      readonly kind: 'turn-recap';
      /** recap 词面（runRecapLine 产物；空串 = 纯线形全宽 ─） */
      readonly label: string;
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
      /** 思考首增量到达时戳 ms（注④本地钟起点——'' → 非空首翻一次定格） */
      readonly thinkingStartAt: number | null;
      /** 思考最近 settled 时戳 ms（false→true 每次翻转重戳——交错形取末次收敛） */
      readonly thinkingSettledAt: number | null;
      readonly theme: ResolvedTheme;
      readonly toggleHint: string;
    };

/**
 * 审批决策行注入窄形（挖掘 31 轮 [1]）：投影/回看路的决策载荷（seq 归位
 * 锚 + 呈现子集三值 + 配对摘要）——直播腿追加（appendApprovalDecision）与
 * 重建腿归位（loadProjection decisions 参）两消费位同形；theme 由
 * LiveTranscript 自持（消费位不传）。文件内导出窄形——contracts 零改。
 */
export interface ApprovalDecisionLineInput {
  /** 归位锚（decided 事件 durable seq——其后首条消息之前呈现；直播腿缺席不用） */
  readonly seq: number;
  readonly decision: 'approve' | 'always' | 'reject';
  readonly summary: string;
}

/**
 * todo 快照注入窄形（挖掘 35 轮 B8）：投影/回看路的快照载荷（seq 归位锚 +
 * 呈现投影条目）——直播腿追加（appendTodoSnapshot）与重建腿归位
 * （loadProjection todoSnapshots 参）两消费位同形；theme 由 LiveTranscript
 * 自持。文件内导出窄形——contracts 零改（ApprovalDecisionLineInput 同律）。
 */
export interface TodoSnapshotLineInput {
  /** 归位锚（todo/write 事件 durable seq） */
  readonly seq: number;
  readonly items: readonly TodoItem[];
}

/**
 * 问答落史行注入窄形（挖掘 36 轮 [2]）：ask 收场通知的呈现载荷（收场态 +
 * 问题 + 答案段）——tui-backend 直注追加（appendAskDecisionLine）单消费位
 * （live-only 无投影路——区别于 approval/todo 直播/回放双消费位族）。theme
 * 由 LiveTranscript 自持（消费位不传）。文件内导出窄形——contracts 零改。
 */
export interface AskDecisionLineInput {
  /** 收场态（answered = present 胜出含竞速；cancelled = 保守收场伞形） */
  readonly outcome: 'answered' | 'cancelled';
  readonly question: string;
  /** 答案呈现段（answered 在场；cancelled 缺席） */
  readonly answer?: string;
}

/**
 * todo 快照签名（B8 签名 diff 闸单源）：条目 (status, content) 序列串——
 * activeForm 呈现辅助不进签名（同表不同 activeForm 不重复落块）；增项/删项/
 * 状态翻转/内容改才落。直播腿与投影 flush 两路同用本函数（同一闸结果）。
 */
export function todoSignature(items: readonly TodoItem[]): string {
  return items.map((item) => `${item.status} ${item.content}`).join('\n');
}

/**
 * todo 快照块行集（B8 渲染本体）：卡头 `• 任务清单已更新`（• dim 前缀 +
 * 词 bold——codex「• Updated Plan」同构）+ 条目行（两空格缩进 + 四态记号 +
 * 内容——单行制无折行，超宽走出口帽 capStyledLine 整字截断，简行族同律）。
 * 四态样式：in-progress = accent bold（activeForm 优先词面——面板同律）；
 * 暗淡档基底 = TodoPanel DIM_STATUSES 单源（completed/deferred）+ pending
 * 快照加档（历史轨迹非活跃态整体弱化——与面板当面表 pending 不暗分立）；
 * completed 在暗淡档上另加划线（strikethrough——SGR 9 首消费，codex
 * crossed_out 对位）。空表形 = 仅卡头（诚实呈现「已更新为零项」）。
 */
function renderTodoSnapshotLines(block: Extract<TranscriptBlock, { kind: 'todo-snapshot' }>): StyledLine[] {
  const header = '任务清单已更新';
  const lines: StyledLine[] = [
    {
      plain: `• ${header}`,
      runs: [
        { start: 0, end: 1, style: DIM_STYLE },
        { start: 2, end: 2 + header.length, style: BOLD_STYLE },
      ],
    },
  ];
  for (const item of block.items) {
    const mark = STATUS_MARKS[item.status];
    const body = item.status === 'in-progress' && item.activeForm !== undefined ? item.activeForm : item.content;
    const plain = `  ${mark} ${body}`;
    // 暗淡基底：DIM_STATUSES 单源 + pending 快照加档（非暗淡档仅 in-progress）
    const dimmed = DIM_STATUSES.has(item.status) || item.status === 'pending';
    const style: Readonly<CellStyle> = !dimmed
      ? Object.freeze({ fg: block.theme.accent, bold: true })
      : item.status === 'completed'
        ? Object.freeze({ dim: true, strikethrough: true })
        : DIM_STYLE;
    lines.push({ plain, runs: [{ start: 2, end: plain.length, style }] });
  }
  return lines;
}

/** 会话短 id（呈现层自截——散列映射色板键同源） */
export function shortIdOf(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * 审批决策行构造（挖掘 31 轮 [1]——词面单源）：首游程三档词（✓ 已批准 /
 * ✓ 已总是批准 success / ✗ 已拒绝 error）+ 次游程 ` · `+一行化摘要（dim；
 * `\s*[\n\r]+\s*` 折空——块是一行制非多行）。超宽不预截——出口帽
 * capStyledLine 整字截断（简行族同律）。
 */
function approvalDecisionLine(block: Extract<TranscriptBlock, { kind: 'approval-decision' }>): StyledLine {
  const head = block.decision === 'reject' ? '✗ 已拒绝' : block.decision === 'always' ? '✓ 已总是批准' : '✓ 已批准';
  const fg: ColorValue = block.decision === 'reject' ? block.theme.error : block.theme.success;
  const summary = block.summary.replace(/\s*[\n\r]+\s*/g, ''); // 一行化（折空换行含围空白）
  if (summary === '') return { plain: head, runs: [{ start: 0, end: head.length, style: Object.freeze({ fg }) }] };
  const plain = `${head} · ${summary}`;
  return {
    plain,
    runs: [
      { start: 0, end: head.length, style: Object.freeze({ fg }) },
      { start: head.length, end: plain.length, style: DIM_STYLE },
    ],
  };
}

/**
 * 问答落史行构造（挖掘 36 轮 [2]——词面单源）：首游程两态词（↳ 已回复 /
 * ↳ 已取消——accent / secondary；问答非成败判定，不借 success/error 对）+
 * 次游程 ` · `+问题（dim）+ answered 另附 ` · `+答案（accent——主色强调
 * 「答了什么」）。段加工链（渲染位单源）：sanitizeDisplayText 消毒（answer
 * 是用户自由输入——OSC/C0 不入屏账）→ 一行化（approval 同款折空）→ 出口帽
 * capStyledLine 整字截断（简行族同律——超宽不预截）。空段折叠：问题/答案
 * 空串段不拼（空问题+无答案 = 裸词面单腿形，approval 同构）。
 */
function askDecisionLine(block: Extract<TranscriptBlock, { kind: 'ask-decision' }>): StyledLine {
  const head = block.outcome === 'answered' ? '↳ 已回复' : '↳ 已取消';
  const fg: ColorValue = block.outcome === 'answered' ? block.theme.accent : block.theme.secondary;
  const oneLine = (text: string) => sanitizeDisplayText(text).replace(/\s*[\n\r]+\s*/g, ''); // 消毒+一行化
  const question = oneLine(block.question);
  const answer = block.outcome === 'answered' && block.answer !== undefined ? oneLine(block.answer) : undefined;
  if (question === '' && (answer === undefined || answer === '')) {
    return { plain: head, runs: [{ start: 0, end: head.length, style: Object.freeze({ fg }) }] };
  }
  let plain = head;
  const runs: StyleRun[] = [{ start: 0, end: head.length, style: Object.freeze({ fg }) }];
  if (question !== '') {
    plain += ` · ${question}`;
    runs.push({ start: head.length, end: plain.length, style: DIM_STYLE });
  }
  if (answer !== undefined && answer !== '') {
    const start = plain.length; // 含前缀 ` · ` 的答案段起点
    plain += ` · ${answer}`;
    runs.push({ start, end: plain.length, style: Object.freeze({ fg: block.theme.accent }) });
  }
  return { plain, runs };
}

/**
 * 回合收尾行词面单源（挖掘 43 轮件 A）：label + 右缘 ─ 补至列宽——与
 * appendClosingLine 写时合成逐字节同形，但**合成移渲染时刻**（每渲染按现
 * columns 重算，resize 后新宽收口——瞬时行按写时宽定格，本件的正确性增益）。
 * label 空 = 纯线形全宽 ─（≤60s 无标签档的渲染等价形）。样式弱线双档：
 * weakRule 在场整行单游程 fg（V-3 注⑨②）、缺席回退 DIM（error 块 CellStyle
 * 先例同形）。超宽保护：label 已短串，极端窄（列宽 < label 宽）repeat 结果
 * 0 行宽恰满——出口帽 capStyledLine 整字截断兜底（简行族同律）。
 */
function turnRecapLine(block: Extract<TranscriptBlock, { kind: 'turn-recap' }>, columns: number): StyledLine {
  const plain = block.label + '─'.repeat(Math.max(0, columns - stringWidth(block.label)));
  // 弱线双档：weakRule 在场混合现算弱线色、键缺席回退 DIM（SGR 2）
  const style = block.theme.weakRule !== undefined ? Object.freeze({ fg: block.theme.weakRule }) : DIM_STYLE;
  return { plain, runs: [{ start: 0, end: plain.length, style }] };
}

/** dim 样式（简行块的整行样式——SGR 2；注⑩：engine 正典单源） */

/** bullet 槽前缀宽（注⑩——`• ` 首行与 `  ` 续行同宽 2 列） */
const BULLET_PREFIX_WIDTH = 2;

/**
 * bullet 槽内容腿有效宽（挖掘 29 轮件 2 单源钳）：columns−2 在极窄（≤2 列）
 * 为 0/负——修前 renderDocLines 经 new CellGrid(负宽) 抛 RangeError（挖掘
 * 36 轮〔5〕行集直转后 renderDocLines 不再分配网格，钳仍保留：docRowToStyledLine
 * 的越列写截停以正宽为前提，且计量/渲染两腿宽口径分立的账漂移风险仍在——
 * 本位继续单源钳 1）、计量/渲染两腿宽口径分立即账漂移。钳 1（markdown 件
 * blockRows 的 Math.max(1, width) 内钳同律——本位是「columns−2」消费侧的
 * 单源；能画就画，1-2 列下逐字整字独行）。
 */
function bulletDocWidth(columns: number): number {
  return Math.max(1, columns - BULLET_PREFIX_WIDTH);
}

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

/** bold 样式（会话头卡名段——engine 无 bold 单源，本件局部定） */
const BOLD_STYLE: Readonly<CellStyle> = Object.freeze({ bold: true });

/** 会话头卡内宽帽（R-7：内宽 = min(columns−4, 56)——窄终端随收、宽终端封顶 56） */
const SESSION_HEADER_INNER_CAP = 56;

/** 头卡名段（R-7 首行 `>_ berry-agent (v{version})`——名恒 berry-agent 零参数化） */
const SESSION_HEADER_NAME = 'berry-agent';

/**
 * 头卡内容行装箱（R-7）：内容宽感知垫空至内宽（CJK 显示宽算术——StyleRun
 * 端点是码位下标、垫空是显示宽算术，两账分立见 ansi-rows StyleRun 注），
 * 左右 │ 框符恒落 inner+2 列位；框符 dim、内容游程由调用方给（升序不交叠
 * 由构造保证——段间空隙 = 裸文本）。
 */
function sessionHeaderBoxedLine(content: string, runs: readonly StyleRun[], inner: number): StyledLine {
  const pad = ' '.repeat(Math.max(0, inner - stringWidth(content)));
  const plain = `│${content}${pad}│`;
  return {
    plain,
    runs: [
      { start: 0, end: 1, style: DIM_STYLE },
      ...runs,
      { start: plain.length - 1, end: plain.length, style: DIM_STYLE },
    ],
  };
}

/**
 * 会话头卡行集（07 §4.1 R-7——durable 首块渲染本体）：╭╮╰╯ 圆角框线 dim
 * （「框语言退役」的显式例外——单块自定界非面板 chrome）；内容首行
 * `>_ berry-agent (v{version})`（`>_ ` dim、名 bold、版本 dim——空版本 =
 * 无版本缀裸名形）+ `model: <模型>` / `directory: <工作目录>` 行（值空串
 * 该行诚实缺席；超宽 ellipsize 收口）；极窄终端（inner ≤ 0）零行诚实缺席。
 */
function renderSessionHeaderLines(
  block: Extract<TranscriptBlock, { kind: 'session-header' }>,
  columns: number,
): StyledLine[] {
  const inner = Math.min(Math.max(columns - 4, 0), SESSION_HEADER_INNER_CAP);
  if (inner <= 0) return []; // 极窄终端诚实缺席——框字符都容不下
  const bar = '─'.repeat(inner);
  const frameLine = (edgeL: string, edgeR: string): StyledLine => ({
    plain: `${edgeL}${bar}${edgeR}`,
    runs: [{ start: 0, end: inner + 2, style: DIM_STYLE }],
  });
  const lines: StyledLine[] = [frameLine('╭', '╮')];
  // 首行：>_ dim + 名 bold + (v…) dim；极窄放不下全形时整行 dim 退化（游程
  // 三段并一——宽度优先于样式档）
  const prefix = '>_ ';
  const ver = block.version === '' ? '' : ` (v${block.version})`;
  const head = `${prefix}${SESSION_HEADER_NAME}${ver}`;
  if (stringWidth(head) <= inner) {
    const nameStart = 1 + prefix.length;
    lines.push(
      sessionHeaderBoxedLine(
        head,
        [
          { start: 1, end: nameStart, style: DIM_STYLE },
          { start: nameStart, end: nameStart + SESSION_HEADER_NAME.length, style: BOLD_STYLE },
          ...(ver === ''
            ? []
            : [{ start: nameStart + SESSION_HEADER_NAME.length, end: 1 + head.length, style: DIM_STYLE }]),
        ],
        inner,
      ),
    );
  } else {
    const clamped = ellipsize(head, inner);
    lines.push(sessionHeaderBoxedLine(clamped, [{ start: 1, end: 1 + clamped.length, style: DIM_STYLE }], inner));
  }
  // model / directory 行（值空串该行缺席——诚实缺席非空标签）
  if (block.model !== '') lines.push(sessionHeaderBoxedLine(ellipsize(`model: ${block.model}`, inner), [], inner));
  if (block.directory !== '')
    lines.push(sessionHeaderBoxedLine(ellipsize(`directory: ${block.directory}`, inner), [], inner));
  lines.push(frameLine('╰', '╯'));
  return lines;
}

/**
 * 对话块计数（07 §4.1 R-7——头卡排除）：空态引导在场门控与等回声复位的
 * 零块判据真源（spec：零块判据随批收窄为非头卡块计数——头卡构造期即在账，
 * 不排除则空会话引导永不显示 / awaitingEcho 即时误复位）。写位对账
 * （writtenAbsolute）不消费本函数——头卡是已写块、计入块位账。
 */
export function dialogueBlockCount(blocks: readonly TranscriptBlock[]): number {
  return blocks.reduce((count, block) => (block.kind === 'session-header' ? count : count + 1), 0);
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
  // 位移造形补 href（挖掘 36 轮〔5〕OSC-8）：链接段 +2 右移 href 随段走——
  // 丢位即链元数据在 bullet 槽断流
  const shifted = line.runs.map((run) => ({
    start: run.start + BULLET_PREFIX_WIDTH,
    end: run.end + BULLET_PREFIX_WIDTH,
    style: run.style,
    href: run.href,
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
 * （07 件 8 数据源条款）；markdown/streaming-doc 块经 rowsFor 行集直转
 * （docRowToStyledLine 提段——挖掘 36 轮〔5〕OSC-8，CellGrid 往返退役）、
 * user 块折行续挂对齐（宽算术单源走 wrapText）、
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
        renderDocLines(block.doc, bulletDocWidth(columns)).map((line, i) => bulletSlotLine(line, i)),
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
    case 'session-header':
      // 会话头卡（R-7 durable 首块）：圆角框自定界——首块豁免位由调用侧
      // leadingGap=false 施加（main-screen B 段 !(i===0 && blocksOffset===0)
      // 同判据——头卡即首块 top:0 无垫）
      return withPad(renderSessionHeaderLines(block, columns), leadingGap);
    case 'approval-decision':
      // 审批决策行（挖掘 31 轮 [1]）：单行制（无折行族——超宽走出口帽
      // capStyledLine 整字截断）+ 块前垫（R-1 制度行）
      return withPad([approvalDecisionLine(block)], leadingGap);
    case 'todo-snapshot':
      // todo 快照块（挖掘 35 轮 B8）：多行制（卡头 + 条目行，单行制条目）
      // + 块前垫（R-1 制度行）
      return withPad(renderTodoSnapshotLines(block), leadingGap);
    case 'ask-decision':
      // 问答落史行（挖掘 36 轮 [2]）：单行制（无折行族——超宽走出口帽
      // capStyledLine 整字截断）+ 块前垫（R-1 制度行）；live-only 旁支
      //（重建后诚实消失——块型注释律）
      return withPad([askDecisionLine(block)], leadingGap);
    case 'turn-recap':
      // 回合收尾记账线（挖掘 43 轮件 A）：单行制 + 渲染时全宽补齐（resize 后
      // 按新宽重算）+ 块前垫（R-1 制度行）；live-only 旁支（重建后诚实消失）
      return withPad([turnRecapLine(block, columns)], leadingGap);
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
        lines.push(...renderDocLines(block.doc, bulletDocWidth(columns)).map((line, i) => bulletSlotLine(line, i)));
      else if (block.text !== '')
        lines.push(
          ...wrapText(block.text, bulletDocWidth(columns)).map((text, i): StyledLine =>
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
  return gap + thinkingRows + interGap + (slot.doc !== null ? slot.doc.stableLineCount(bulletDocWidth(columns)) : 0);
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
  doc?: RowsSource | null,
): number {
  if (view.text === '') return 0;
  if (!view.expanded) return 1; // 折叠档 = 单标签行（体 doc 缺席亦然——渲染支路折叠不触 doc）
  const bodyDoc = doc ?? MarkdownDoc.of(view.text, view.theme);
  return 1 + Math.max(1, bodyDoc.measure(columns));
}

/** RowsSource doc → 带样式行集（markdown 定稿与流式 doc 共用——同管线律）。
 * 行集直转（挖掘 36 轮批〔5〕OSC-8）：修前经 CellGrid 整面往返（render 落格
 * + gridRowToStyled 读回——engine Cell 三元无 href 位、链接元数据至此即丢）
 * 改 doc.rowsFor 装配行集逐行 docRowToStyledLine 直转——href 全程可达；
 * doc.render + gridRowToStyled 降级为测试锁定的参照实现（生产零调用）。 */
function renderDocLines(doc: RowsSource, columns: number): StyledLine[] {
  const rows = doc.rowsFor(columns);
  const lines: StyledLine[] = [];
  for (let r = 0; r < rows.length; r++) {
    lines.push(docRowToStyledLine(rows[r]!, columns));
  }
  return lines;
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
 * renderBlockLines(slot, columns, leadingGap).slice(effectiveStart))`——effectiveStart =
 * max(startRow, total − tailCap)（tailCap 缺省无穷 = startRow 本值——缺省调用形
 * 零变）；对拍锁在 transcript.test.ts（多形语料 × 多宽 × 多起点 × 双 leadingGap ×
 * 多 tailCap）。legs：
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
 * 回退形（正确性优先）：startRow = 0 且 tailCap ≥ total 即全量渲染——repaint/
 * resize/新槽开账/让位收缩后的首帧自然走全量（调用方 main-screen 注释在位）。
 */
export function renderSlotTailLines(
  slot: Extract<TranscriptBlock, { kind: 'streaming' }>,
  columns: number,
  startRow: number,
  leadingGap = true,
  /** 渲染帽（42 轮件 A——不稳尾段溢出尾窗化）：尾窗行数上限；缺省无穷零变 */
  tailCap = Number.POSITIVE_INFINITY,
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
  // doc 行集/降档行集先取 + total 前置折算：渲染帽判据 effectiveStart =
  // max(startRow, total − tailCap) 需先知 total（42 轮件 A——行集算术与全量
  // 渲染同源不变，仅取行前置）
  const docRows = slot.doc !== null ? slot.doc.rowsFor(bulletDocWidth(columns)) : null;
  const plainRows = slot.doc === null && slot.text !== '' ? wrapText(slot.text, bulletDocWidth(columns)) : null;
  const docRowCount = docRows !== null ? docRows.length : plainRows !== null ? plainRows.length : 0;
  const total = gap + thinkingRows + interGap + docRowCount;
  // 渲染帽（42 轮件 A——尾窗化）：帽外顶行流式期不渲染（mutable tail 语义
  // ——尾窗只保底段；调用方帽值 = 零触滚余量 + 冻结源）。缺省无穷时
  // effectiveStart ≡ startRow——三/四参既有调用形零变
  const effectiveStart = Math.max(startRow, total - tailCap);
  const lines: string[] = [];
  // 头垫尾窗段（effectiveStart = 0 落垫上——仅全量形触达，垫行单字节空串）
  if (effectiveStart < gap) lines.push('');
  // thinking 尾窗段（effectiveStart 落思考区内——超出则思考行全在冻结前缀，零渲染）
  if (slot.thinking !== '' && effectiveStart < gap + thinkingRows) {
    const thinkingLines = renderThinkingStyledLines(slotThinkingView(slot), columns, slot.thinkingDoc).map((line) =>
      styledLineToAnsi(capStyledLine(line, columns)),
    );
    for (let i = Math.max(0, effectiveStart - gap); i < thinkingLines.length; i++) lines.push(thinkingLines[i]!);
  }
  // 腿间垫尾窗段（垫行槽位 = gap+thinkingRows——effectiveStart 未越过才发；空串与
  // BLANK_LINE 序列化同形）
  if (interGap === 1 && effectiveStart < gap + thinkingRows + interGap) lines.push('');
  // doc 尾窗段（行集直转——自 docStart 起逐行；bullet 槽前缀同轴〔注⑩〕；
  // 行宽 = columns−2 内容 + 前缀 2 = columns——出口帽 + 序列化与全量管线同律）
  const docStart = Math.max(0, effectiveStart - gap - thinkingRows - interGap);
  if (docRows !== null) {
    for (let r = docStart; r < docRows.length; r++) {
      lines.push(
        styledLineToAnsi(
          capStyledLine(bulletSlotLine(docRowToStyledLine(docRows[r]!, bulletDocWidth(columns)), r), columns),
        ),
      );
    }
  } else if (plainRows !== null) {
    // 降档纯文本腿（零样式直推——bullet 前缀同律；切片同律）
    for (let i = docStart; i < plainRows.length; i++)
      lines.push(styledLineToAnsi(capStyledLine(bulletSlotLine({ plain: plainRows[i]!, runs: [] }, i), columns)));
  }
  return { total, lines };
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
  /**
   * 会话头卡数据（07 §4.1 2026-10-10 Codex 样式复刻批 R-7）：在场 = 构造期
   * 即注入 durable 首块（值一次定格）+ loadProjection 投影重建同源前插；
   * 缺席 = 无头卡旧形（件 8 回看器复用本件零头卡——头卡是主屏转录区概念；
   * 确定性测试基线零扰动——footer 门控同律）。
   */
  readonly header?: SessionHeaderData;
}

/**
 * 会话头卡数据（R-7——会话装配快照构造期定格三值）：version 宿主版本、
 * model 初始模型全形、directory 工作目录全路径（空串 = 对应行/版本缀诚实
 * 缺席）。
 */
export interface SessionHeaderData {
  readonly version: string;
  readonly model: string;
  readonly directory: string;
}

/** 头卡块铸造（构造注入与投影前插同源——值经 SessionHeaderData 定格快照） */
function sessionHeaderBlockOf(data: SessionHeaderData): TranscriptBlock {
  return { kind: 'session-header', version: data.version, model: data.model, directory: data.directory };
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
 * 探索组卡阈值（07 §4.1 V-3 注⑩ 探索组卡批词条）：N ≥ 2 落一张探索组卡；
 * N < 2 逐条补落 R4。与 exec 族阈值 3 分立（探索单卡信息量低——一串路径
 * 预览瀑布正是组卡要收敛的问题，2 即聚；exec 单卡信息量大，3 维持）。
 */
export const EXPLORE_GROUP_THRESHOLD = 2;

/**
 * exec 内建族判据（词条——exec（bash）族）：工具名 === 'bash'（载荷保原始
 * 名，判断位单源；插件若注册同名渲染腿只作用于单卡面——组卡是宿主组级
 * 聚合面不铸 renderInput，结构性无插件腿）。
 */
function isExecToolCallName(name: string): boolean {
  return name === 'bash';
}

/**
 * 探索族内建白名单判据（07 §4.1 V-3 注⑩ 探索组卡批词条）：read/ls/find/
 * grep 四员只读工具（宿主内建名单源——与 isExecToolCallName 同文件同形；
 * effect 位不借〔DAG 硬约束——channels 物理不可达 tools 注册面〕、插件
 * 工具不进组〔ΔA⇏ΔC〕；未入册新工具退化逐卡现状形——良性降级方向）。
 */
function isExploratoryToolCallName(name: string): boolean {
  return name === 'read' || name === 'ls' || name === 'find' || name === 'grep';
}

/** 组窗族标签（单窗账分诊——exec/探索两入窗族 + other 即落族） */
type GroupWindowFamily = 'exec' | 'exploring' | 'other';

/** 组窗族判定（单源分诊——appendToolResult 入窗/即落分支与续窗切窗共用） */
function windowFamilyOf(name: string): GroupWindowFamily {
  if (isExecToolCallName(name)) return 'exec';
  if (isExploratoryToolCallName(name)) return 'exploring';
  return 'other';
}

/**
 * 探索条目参数摘要键序表（词条——主语只取 path/pattern 两键族）：read
 * `[path]` / ls `[path ?? '.']`（缺省 `.` 显式呈现——诚实形）/ find·grep
 * `[pattern, path?]`；其余可选键不进摘要（argsBrief 白名单键值短显同哲
 * 学）；非 string 坏形诚实缺席值（不进摘要——子行退化裸动词行零崩）。
 */
function exploreArgsOf(name: string, args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value !== '') out.push(value);
  };
  if (name === 'read') {
    push(args.path);
  } else if (name === 'ls') {
    out.push(typeof args.path === 'string' && args.path !== '' ? args.path : '.');
  } else {
    push(args.pattern);
    push(args.path);
  }
  return out;
}

/**
 * 探索条目错误首行（嵌套诊断行数据源）：error 态取卡体首个非空行
 * （cardBodyOf 既有切行）；其余态/无文本 → undefined（缺席 = 无诊断行）。
 */
function errorFirstLineOf(message: Extract<AgentMessage, { role: 'toolResult' }>): string | undefined {
  for (const line of cardBodyOf(textOf(message))) {
    if (line.trim() !== '') return line;
  }
  return undefined;
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

/**
 * 失败条目输出窗首行剥除（挖掘 40 轮件 B——铸卡位配套）：`Exit code: N`
 * 码形首行已由条目退出码位呈现，窗内再显即双显——剥纯码形首行；信号终止
 * （Exit code: null 形文本）/EXEC_TIMEOUT 等无码形不剥（判据与
 * parseExecExitCode 同正则——首行命中才剥，中段出现不动）。
 */
function stripExitCodeHeadLine(lines: readonly string[]): readonly string[] {
  if (lines.length > 0 && /^Exit code: \d+$/.test(lines[0]!)) return lines.slice(1);
  return lines;
}

/** 组窗条目（窗收口求值的数据源——调用面 + 结果消息全存，收口现铸卡；exec/探索两族共形） */
interface GroupWindowEntry {
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
 * 纯文本块直拼（回溯锚原文形——挖掘 36 轮件 8 回溯 fork 批）：图块跳过不产
 * 「[图片]」占位（回填面诚实缺席不造假——joinTextBlocks 的呈现形含占位行，
 * 与本形分立）；文本块相邻零分隔直拼（与 joinTextBlocks 文本路径同律）。
 */
function plainTextOf(message: AgentMessage): string {
  if (!isStandardMessage(message)) return '';
  if (typeof message.content === 'string') return message.content; // user 纯文本形
  let out = '';
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') out += block.text;
  }
  return out;
}

/**
 * 回看器回溯编辑锚单源（挖掘 36 轮件 8 回溯 fork 批——session-rewind-fork）：
 * 判据 = rendersAsUserBlock 同集 + 投影 seq 在场（user/message 事件 seq——
 * 「第 n 条可见用户消息」按呈现投影解析非原始事件序，codex
 * backtrack_fork_before_turn_id 同构）。无 seq 的 user 消息不入锚——锚数与
 * user 块数由调用方 1:1 对账，不齐即降级禁用回溯面（防御位在回看器构造期）。
 */
export function forkEditAnchorsOf(messages: readonly (AgentMessage & { readonly seq?: number })[]): UiForkEditAnchor[] {
  const anchors: UiForkEditAnchor[] = [];
  for (const message of messages) {
    if (!rendersAsUserBlock(message)) continue;
    if (typeof message.seq !== 'number') continue;
    anchors.push({ seq: message.seq, text: plainTextOf(message) });
  }
  return anchors;
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
   * 组窗（07 §4.1 V-3 注⑩ 符号册 exec 折叠组词条 + 探索组卡批词条——单窗
   * 泛化）：窗内已完成配对的 exec/探索条目暂存账（同窗同族）——toolResult
   * 到达不即时落卡（R4 到达即落在两族翻档），异族到达先收口（窗边界泛化）
   * 、窗收口（agent_end/真用户边界；投影路 user 段切分）统一求值落卡。
   * 直播/投影两路共用本账（loadProjection 起步清窗）。
   */
  private groupWindow: GroupWindowEntry[] = [];
  /** 历史裁块累计（单调递增——trimmedBlockCount 观测面的真身） */
  private trimmedCount = 0;
  /** 思考块会话级展开态（批 10i——缺省折叠省 scrollback） */
  private thinkingExpanded = false;
  /** 工具卡会话级展开态（批 10i——缺省折叠尾 5 行预览） */
  private toolCardsExpanded = false;
  /** 头卡定格快照（R-7——null = 无头卡旧形：viewer 复用/确定性测试基线） */
  private readonly headerData: SessionHeaderData | null;

  constructor(options: LiveTranscriptOptions = {}) {
    this.blockCap = options.blockCap ?? TRANSCRIPT_BLOCK_CAP;
    this.theme = options.theme ?? DEFAULT_THEME;
    this.keyText = options.keyText ?? ((actionId) => DEFAULT_KEY_TEXT.get(actionId) ?? '');
    this.now = options.now ?? (() => Date.now());
    this.headerData = options.header ?? null;
    // 头卡即构造注入 durable 首块（值一次定格——后续 repaint 投影同源前插）
    this.blocks = this.headerData === null ? [] : [sessionHeaderBlockOf(this.headerData)];
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

  /**
   * 直播腿审批决策行追加（挖掘 31 轮 [1]——approval/settled 总线消费位）：
   * **块账在册**（计入 dialogueBlockCount、占 blockCap 帽）非瞬时行路
   * （appendTransientLine/appendJobSettledLine 那一路）——repaint 自投影
   * 重建自愈（fold 按 seq 归位同构）；调用位过滤已由消费侧谓词完成
   * （isUserApprovalDecision——本面不重复滤）。
   */
  appendApprovalDecision(entry: {
    decision: 'approve' | 'always' | 'reject';
    summary: string;
    theme: ResolvedTheme;
  }): void {
    this.blocks.push({
      kind: 'approval-decision',
      decision: entry.decision,
      summary: entry.summary,
      theme: entry.theme,
    });
    this.trimToCap();
  }

  /**
   * 直播腿问答落史行追加（挖掘 36 轮 [2]——ask/settled 总线消费位）：
   * **live-only 旁支**——无 seq 归位锚、不进 durable 投影源，onRepaint 投影
   * 重建后本块诚实消失（scrollback 是呈现缓存非事实源——规范词条明律，勿
   * 补 durable 化）。块账在册（计入 dialogueBlockCount、占 blockCap 帽）非
   * 瞬时行路；消毒+一行化归渲染位单源（askDecisionLine）。调用位过滤已由
   * tui-entry 订阅腿完成（聚焦限定）。
   */
  appendAskDecision(entry: AskDecisionLineInput): void {
    this.blocks.push({
      kind: 'ask-decision',
      outcome: entry.outcome,
      question: entry.question,
      ...(entry.answer !== undefined ? { answer: entry.answer } : {}),
      theme: this.theme,
    });
    this.trimToCap();
  }

  /**
   * 直播腿回合收尾块追加（挖掘 43 轮件 A——agent_end completed 腿消费位经
   * backend 包装法 appendTurnRecapLine）：**live-only 旁支**——无 seq 归位
   * 锚、不进 durable 投影源（agent_end 信号非投影源成员），onRepaint 投影
   * 重建后本块诚实消失（scrollback 是呈现缓存非事实源——同 ask-decision
   * 律，勿补 durable 化）。块账在册（计入 dialogueBlockCount、占 blockCap
   * 帽）非瞬时行路；全宽补齐与弱线双档归渲染位单源（turnRecapLine——
   * resize 后按新宽重算）。双零整行缺席判据（纯对话轮）留调用侧。
   */
  appendTurnRecap(entry: { label: string }): void {
    this.blocks.push({
      kind: 'turn-recap',
      label: entry.label,
      theme: this.theme,
    });
    this.trimToCap();
  }

  /**
   * 直播腿 todo 快照块追加（挖掘 35 轮 B8——tool_execution_end 锚消费位）：
   * **签名 diff 闸单源在此**（与 loadProjection flush 的 offer 形同一闸——
   * 直播/回放两路同一块集）：与块账最后 todo-snapshot 块比较——seq 已录位
   * （≤ 最后已落块 seq）幂等零重落、签名同跳过（增删改状态翻转才落）、首条
   * 必落。无额外闸状态（块账即状态——repaint 投影重建后闸随块账自愈；cap
   * 驱逐全体 todo 块时退化首块语义可接受——词条已注记）。调用侧全序列迭代
   * 幂等（批内多次 todo 调用中间态不丢）。
   */
  appendTodoSnapshot(entry: { seq: number; items: readonly TodoItem[] }): void {
    const last = this.lastTodoSnapshotBlock(this.blocks);
    if (last !== undefined) {
      if (entry.seq <= last.seq) return; // 已录位（含幂等重放）
      if (todoSignature(last.items) === todoSignature(entry.items)) return; // 同签跳过
    }
    this.blocks.push({ kind: 'todo-snapshot', seq: entry.seq, items: entry.items, theme: this.theme });
    this.trimToCap();
  }

  /** 块账最后 todo-snapshot 块（闸比较态真源——倒扫首中） */
  private lastTodoSnapshotBlock(
    blocks: readonly TranscriptBlock[],
  ): Extract<TranscriptBlock, { kind: 'todo-snapshot' }> | undefined {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i]!;
      if (block.kind === 'todo-snapshot') return block;
    }
    return undefined;
  }

  /**
   * 投影重建（repaint 路——清账按投影重拉帽内段；直播/repaint 行集同构）。
   * decisions（挖掘 31 轮 [1]——审批决策行重建腿）：按 seq 归位——逐消息
   * 前 flush 队首 seq < 该消息 seq 的决策块（与直播路 emit 时点追加同构：
   * 组窗卡延迟落位两路同形——决策块先入、窗卡后收口不误序）；循环尾
   * flush 先于组窗收口（直播路 agent_end 收口前的 emit 序对齐）。消息全
   * 零 seq（模型 timeline 种子形——projectionOf 路无锚）= 尾 flush 降级
   * （诚实不丢，锚定形两路同构不涉）。
   * todoSnapshots（挖掘 35 轮 B8——todo 快照块重建腿）：逐消息后 flush
   * seq < 下一消息 seq 的快照（「M_i 消息后 flush seq<seq(M_{i+1})」≡
   * 「M_{i+1} 消息前 flush seq<seq(M_{i+1})」——与 decisions 同实现形、
   * 分立队列；todo/write durable 位在 assistant/message 与 tool/result
   * 之间，落位 = 配对工具卡之前，与直播路实序〔tool_execution_end 先于
   * toolResult message_end〕同构）；flush 逐条过签名闸（offer 形与
   * appendTodoSnapshot 同闸——两路同一块集）；扫尾全 flush + 消息零 seq
   * 降级尾 flush（decisions 同律诚实不丢）。
   */
  loadProjection(
    messages: readonly (AgentMessage & { readonly seq?: number })[],
    decisions?: readonly ApprovalDecisionLineInput[],
    todoSnapshots?: readonly TodoSnapshotLineInput[],
  ): void {
    const rebuilt: TranscriptBlock[] = [];
    this.pendingCalls.clear(); // 配对账随投影重建（走查中 assistant 入账、toolResult 出账）
    this.groupWindow = []; // 组窗随投影重建（走查中暂存、段切分/走查毕收口）
    // 决策归位队列（升序——durable seq 单调，排序是导入/合成乱序形的防御位）
    const decisionQueue = [...(decisions ?? [])].sort((a, b) => a.seq - b.seq);
    const flushDecisionsBefore = (limit: number): void => {
      while (decisionQueue.length > 0 && decisionQueue[0]!.seq < limit) {
        const entry = decisionQueue.shift()!;
        rebuilt.push({
          kind: 'approval-decision',
          decision: entry.decision,
          summary: entry.summary,
          theme: this.theme,
        });
      }
    };
    // 快照归位队列（升序同律）+ 落块闸（appendTodoSnapshot 同闸单源——
    // 块账比较态在 rebuilt 尾扫，两路同一结果）
    const todoQueue = [...(todoSnapshots ?? [])].sort((a, b) => a.seq - b.seq);
    const offerTodoSnapshot = (entry: TodoSnapshotLineInput): void => {
      const last = this.lastTodoSnapshotBlock(rebuilt);
      if (last !== undefined) {
        if (entry.seq <= last.seq) return; // 已录位（防御——升序队列实践不达）
        if (todoSignature(last.items) === todoSignature(entry.items)) return; // 同签跳过
      }
      rebuilt.push({ kind: 'todo-snapshot', seq: entry.seq, items: entry.items, theme: this.theme });
    };
    const flushTodoSnapshotsBefore = (limit: number): void => {
      while (todoQueue.length > 0 && todoQueue[0]!.seq < limit) {
        offerTodoSnapshot(todoQueue.shift()!);
      }
    };
    for (const message of messages) {
      if (message.seq !== undefined) {
        flushDecisionsBefore(message.seq);
        flushTodoSnapshotsBefore(message.seq);
      }
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
            // 组窗段切分（07 §4.1 V-3 注⑩——投影路窗边界近似：投影
            // 序列无 agent_end 信号，user 消息段即窗；判据与直播路 user 收口
            // 同源 rendersAsUserBlock——机器注入不切窗两路对齐。近似缝：直播
            // 路 retry 续跑在 agent_end 收口、投影路同段并窗——重试缝两路分
            // 歧是词条已注记的近似非回归）
            this.flushGroupWindow(rebuilt);
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
    // 决策尾 flush（挖掘 31 轮 [1]）：晚于全部消息的决策块——先于组窗收口
    //（直播路 emit 在 agent_end 收口前，两路同构）；零 seq 消息的降级尾
    // flush 同在此收口（诚实不丢）
    for (const entry of decisionQueue) {
      rebuilt.push({ kind: 'approval-decision', decision: entry.decision, summary: entry.summary, theme: this.theme });
    }
    // 快照尾 flush（挖掘 35 轮 B8）：晚于全部消息的快照——同先于组窗收口
    //（直播路快照落块在 tool_execution_end、组卡收口在 agent_end——尾序
    // 同构）；零 seq 消息降级尾 flush 同在此（闸逐条过——offer 形同上）
    for (const entry of todoQueue) offerTodoSnapshot(entry);
    // 组窗走查毕收口（直播路 agent_end 收口位的投影对位——末段窗
    // 不滞留；先于孤儿 ⚙ 扫描：组卡位在前、孤儿兜底在后与直播路同序）
    this.flushGroupWindow(rebuilt);
    // 在飞孤儿兜底：走查毕未见结果的调用照旧 ⚙ 简行（与直播路在飞期零正文行
    // 收敛同形——投影把「在飞」显形为 ⚙；结果到达配对落卡时 ⚙ 留账留屏）
    for (const [toolCallId, call] of this.pendingCalls) {
      rebuilt.push({ kind: 'tool-call', name: call.name, brief: call.brief, toolCallId });
    }
    // 头卡前插（R-7）：投影重建与构造注入同源定格值——repaint 重拉不换头
    // （帽裁 slice 卸前缀时头卡与旧对话块同队让位——头卡是块账在册非特权位）
    if (this.headerData !== null) rebuilt.unshift(sessionHeaderBlockOf(this.headerData));
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
            // 组窗收口（07 §4.1 V-3 注⑩——窗不跨 user 消息）：先收口
            // 落卡、user 块在后（agent_end 之外的防御位收口锚——转写打断形窗
            // 不跨轮滞留；与投影路 user 段切分同边界判据 rendersAsUserBlock）
            this.flushGroupWindow(this.blocks);
            this.blocks.push({ kind: 'user', text: textOf(message), theme: this.theme });
          }
        } else if (message.role === 'toolResult') {
          this.appendToolResult(this.blocks, message);
        }
        this.trimToCap();
        break;
      }
      case 'agent_end':
        // 组窗收口主锚（07 §4.1 V-3 注⑩——直播路窗边界）：agent_end
        // 经 onEnvelope 先 transcript.applyEvent 后渲染触发——收口卡在终帧重绘
        // 前已落账，backend 零改（正文零渲染射界不破：本位只收口组窗暂存账
        // 不产正文行）。任一终态（completed/aborted/failed）都收口。
        this.flushGroupWindow(this.blocks);
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
   * 工具结果配对落卡（批 10i R4 + 组窗两族翻档）：账内在飞 → exec/探索族
   * 入窗暂存（到达不落卡——窗收口统一求值）/ 其他族到达即落三态卡（换卡时
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
    // 组窗族分诊（07 §4.1 V-3 注⑩ 探索组卡批——单窗泛化）：exec/探索两族
    // 入窗暂存；其他族到达即落（窗收口先行——异族 toolResult 到达即窗边界）
    const family = windowFamilyOf(call.name);
    if (family === 'other') {
      this.flushGroupWindow(target);
      target.push(this.buildToolCard(call, message));
      return;
    }
    this.cutGroupWindowIfNeeded(target, family);
    this.groupWindow.push({ call, message });
  }

  /**
   * 组窗续窗判定（窗边界泛化——词条探索组卡批 + exec 窗「连续段」勘正笔）：
   * 同窗需同族且（探索族）窗内未见失败/中止——异族到达先收口当前窗（呈现
   * 序保真：先收口后落本条）、探索族失败封闭（窗内已见失败/中止条目 → 后续
   * 探索开新窗——失败不被后续成功淹没；exec 族不封闭维持）。空窗无切。
   */
  private cutGroupWindowIfNeeded(target: TranscriptBlock[], family: Exclude<GroupWindowFamily, 'other'>): void {
    if (this.groupWindow.length === 0) return;
    const current = windowFamilyOf(this.groupWindow[0]!.call.name);
    if (current !== family) {
      this.flushGroupWindow(target);
      return;
    }
    if (family === 'exploring' && this.groupWindow.some((entry) => toolResultStatus(entry.message) !== 'success')) {
      this.flushGroupWindow(target);
    }
  }

  /**
   * 组窗收口（07 §4.1 V-3 注⑩ 符号册词条——两族同壳）：窗内条目统一求值
   * 落卡——N ≥ 阈值落一张组卡（exec `• Ran N commands` / 探索 `已探索
   * N 项`——组级最差态聚合；两族阈值分立：exec 3 / 探索 2）、N < 阈值逐条
   * 补落 R4 既有卡形（保序）；孤儿在飞不在窗内（无 toolResult 不入 N——
   * 直播路在飞可见性归面板/状态行，投影路走查毕 ⚙ 兜底照旧族）。收口后清
   * 窗。调用位：直播路 agent_end / user 边界（先收口后落 user 块——窗不跨
   * user 消息）/ 异族到达（appendToolResult 即落前）；投影路 user 段切分 +
   * 走查毕（孤儿 ⚙ 扫描前——组卡位与直播路 agent_end 收口位对齐）。
   */
  private flushGroupWindow(target: TranscriptBlock[]): void {
    if (this.groupWindow.length === 0) return;
    const entries = this.groupWindow;
    this.groupWindow = [];
    const family = windowFamilyOf(entries[0]!.call.name);
    const threshold = family === 'exec' ? EXEC_GROUP_THRESHOLD : EXPLORE_GROUP_THRESHOLD;
    if (entries.length >= threshold) {
      target.push(family === 'exec' ? this.buildExecGroupCard(entries) : this.buildExploreGroupCard(entries));
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
  private buildExecGroupCard(entries: readonly GroupWindowEntry[]): TranscriptBlock {
    const commands: ToolCardGroupCommand[] = entries.map((entry) => {
      const status = toolResultStatus(entry.message);
      return {
        command: typeof entry.call.arguments.command === 'string' ? entry.call.arguments.command : '',
        status,
        exitCode: parseExecExitCode(entry.message),
        // 失败条目输出窗（挖掘 40 轮件 B）：cardBodyOf 单源过账——头尾 100+100
        // 存账帽 + 2000 码点单行帽自动继承零新帽；首行 Exit code 码形剥除
        // （退出码位已显码防双显——只剥纯码形，信号终止/超时无码形不剥）
        ...(status !== 'success' ? { outputLines: stripExitCodeHeadLine(cardBodyOf(textOf(entry.message))) } : {}),
      };
    });
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
      group: { kind: 'exec', count: commands.length, commands },
    };
  }

  /**
   * 探索组卡铸造（07 §4.1 V-3 注⑩ 探索组卡批词条——组级形）：**归并住铸
   * 卡位**（组数据是摘要终形、渲染位零算法）——同工具 ∧ 相邻 ∧ 双侧成功
   * 条目归并一 entry（args 保序去重并集——Codex `Read a, b` 同构）、失败/
   * 中止条目恒独立行（可见性优先——✗/⏹ 前置 + 嵌套诊断行数据源）；count =
   * **归并前**条目数 N（卡头 `已探索 N 项` 消费）；name = 窗首条目工具名
   * （事实位不虚造）；status = 组级最差态（与 worstGroupStatus 同式）；组
   * 卡不铸 renderInput/durationMs（exec 组卡同律）。
   */
  private buildExploreGroupCard(entries: readonly GroupWindowEntry[]): TranscriptBlock {
    // 归并段（mutable 账——收口即弃，末尾整装冻结入组数据）
    const rows: {
      tool: string;
      args: string[];
      status: ToolCardStatus;
      errorFirstLine?: string;
    }[] = [];
    for (const entry of entries) {
      const status = toolResultStatus(entry.message);
      const last = rows[rows.length - 1];
      // 归并三条件：双侧成功 ∧ 同工具 ∧ 相邻（rows 末行即前一条目归宿）
      if (status === 'success' && last !== undefined && last.tool === entry.call.name && last.status === 'success') {
        for (const arg of exploreArgsOf(entry.call.name, entry.call.arguments)) {
          if (!last.args.includes(arg)) last.args.push(arg);
        }
        continue;
      }
      rows.push({
        tool: entry.call.name,
        args: exploreArgsOf(entry.call.name, entry.call.arguments),
        status,
        ...(status === 'error' ? { errorFirstLine: errorFirstLineOf(entry.message) } : {}),
      });
    }
    const groupEntries: ExploringGroupEntry[] = rows.map((row) => ({ ...row, args: [...row.args] }));
    const status: ToolCardStatus = groupEntries.some((e) => e.status === 'aborted')
      ? 'aborted'
      : groupEntries.some((e) => e.status === 'error')
        ? 'error'
        : 'success';
    return {
      kind: 'tool-card',
      name: entries[0]!.call.name,
      brief: '',
      status,
      body: [],
      diff: false,
      expanded: this.toolCardsExpanded,
      theme: this.theme,
      toggleHint: this.keyText('tools.toggle-expand'),
      group: { kind: 'exploring', count: entries.length, entries: groupEntries },
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
 * 不可知」走空槽腿（诚实缺席，不造伪号）。导出（挖掘 45 轮件 D）：/diff
 * 副屏（diff-viewer）同器单源复用——两侧段解析天然同器，「回执序 = 补丁段
 * 序」不可能分歧。
 */
export function extractDiffStartLines(details: unknown): ReadonlyArray<number | undefined> | undefined {
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
