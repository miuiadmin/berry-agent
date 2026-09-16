/**
 * TUI 后端（UiBackend 的终端实装——07 §4.3 通道后端面的 tui 腿）。
 *
 * 批 10e-1 呈现纵切落直播呈现/状态面/固定区静态形；批 10e-2 交互纵切接
 * 输入管线与交互件（本批）：
 * - **输入管线自持**（不经 Engine——Engine 是全屏帧管线〔清屏锤/帧差分〕，
 *   与主屏 append-only 编舞直接冲突；07「两形态进出场模式串分立」条款正合
 *   本件自定义主屏形模式串：粘贴开 + kitty 推栈/弹栈 + 探测哨兵——无光标
 *   藏、无 1049）：InputDecoder 喂入 + lone-ESC 判定窗 + raw 模式 + 硬退
 *   复原钩；
 * - **路由四层**（07 §4.3 拦截链序）：①全局键（ctrl+c 打断 / ctrl+d 空框
 *   退出——overlay 在场或框有文时 ctrl+d 让路）→ ②overlay 模态独占（未消费
 *   键不穿透）→ ③补全弹层（非模态——未消费穿透）→ ④编辑器（未消费键终局
 *   丢弃）；提交路由：input-ask 应答优先 → 退出词本地拦截（/exit//quit
 *   ——07 §4.1 2026-09-15 /exit 批，先于通道命令分发）→ '/' 起手命令柄（false 落
 *   onSubmit 兜底——03 §2.2 驱动侧语义归 conversation）→ onSubmit；
 * - **固定区 v2 动态布局**（自上而下）：overlay 段（锚定注册表 = 本件
 *   renderFixed 行账——开层锚定闭包读注册表）→ todo 面板（件 4）→
 *   input-ask 提示行 → 补全弹层 → 编辑器（动态量高 + 光标声明——setFixed
 *   声明位落 cup）→ 工具进度面板（件 5——与状态行分职互补相邻）→ 状态行；
 * - **渲染合并**：调度注入后 op 队列合并（连续 present 留末次、transient
 *   到达序保持、固定区脏位重建一帧一次）+ fps 帽 60 + tick 100ms 自重排
 *   驱动状态行转轮；**无注入调度 = 同步直出**（测试语义——合并与自驱 tick
 *   关闭，10e-1 同步断言原样成立；生产装配须注入宿主调度）；
 * - **件 7 终端外显**（本纵切）：OscDisplay 自持件——起屏基线 title、
 *   onEnvelope 按会话净计数忙态（OSC 9;4 + 1s 保活）、onRepaint title 点缀
 *   会话短 id、stop/硬退复原两写点；
 * - **阻塞原语撤销面**（批 10f-3）：ask 四路 signal abort 收口时曾在屏者
 *   正文流落 ⏹ 撤销说明行（07 §4.3 语义纪律「曾在屏者由通道上撤销说明行」
 *   ——保守值收口之外的可感知收场；迟到 abort 不误写）。
 * - **主屏挂起面**（批 10f-4）：suspendMain / resumeMain 自持挂起交出面
 *   （AltScreenPrimary 窄介面实装——件 8 副屏编舞消费）。挂起 = 出屏串 +
 *   卸监听 + 停流 + raw 复先验 + 渲染请求安全 no-op + 定时器全收（件 7 osc
 *   保活不停——终端级外显非主屏内容）；停屏期瞬时行入缓冲、durable 事件照
 *   常归约行集模型（账不丢）。复起 = 进屏串 + 重装 + 放流 + **全帧重画不走
 *   （通道）repaint**（主屏既有权威全量重建路 + 瞬时行缓冲补吐——repaint 按
 *   投影重建不含停屏期瞬时行，07 件 8 条款 + 2026-09-07 勘正笔）。
 * - **副屏装配面**（批 10f-4 特性腿）：AltScreenHost 自持（共享本件 io——
 *   副屏 Engine 重装输入与主屏换防）+ openHistory / collapseAltScreen
 *   （UiBackend 可选能力面两钩的实装——/history 命令到达即挂起主屏进 1049
 *   副屏 HistoryViewer；ask 到达先收副屏，件 8 注意力优先级条款）。副屏
 *   Engine 的调度半场与主屏同源注入（假钟直通；无注入调度 = 同步直出——
 *   首帧确定性与 lone-ESC 即决同测试语义）。
 *
 * 批内边界：setWidget 不支撑（报 false）；主屏滚动帽实测定值挂装配批 12
 * 实机；件 8 副屏内容件已随批 10f-4 特性腿落（history-viewer.ts——本件只
 * 装配不复刻呈现）；鼠标滚轮 / 选区 OSC 52 随鼠标批。
 */
import type { AgentEvent } from '../../../agent/index.js';
import { isStandardMessage, type AgentMessage, type Usage } from '../../../contracts/index.js';
import type {
  ApprovalAskAnswer,
  ApprovalAskRequest,
  NotifyLevel,
  SessionEnvelope,
  TodoItem,
  UiAskOptions,
  UiBackend,
  UiInputOptions,
  UiSelectChoice,
  UiSessionSummary,
  UiUsageSummary,
} from '../../types.js';
import { CellGrid, InputDecoder, ProcessTerminalIO, type TerminalIO } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import { LiveTranscript, shortIdOf, type SummaryLine, type TranscriptBlock } from './transcript.js';
import { OscDisplay, buildOsc52Copy } from './osc.js';
import { StatusLine } from '../status/status-line.js';
import { TodoPanel } from '../panels/todo-panel.js';
import { ToolProgressPanel } from '../panels/tool-progress-panel.js';
import {
  builtinPalette,
  detectColorDepth,
  paletteForBackground,
  parseOsc11Reply,
  resolveTheme,
  sessionColor,
  type BuiltinPalette,
  type ColorDepth,
  type ColorEnv,
  type ResolvedTheme,
  type ThemeSetting,
} from '../theme/index.js';
import { buildSgr, SGR_RESET } from './ansi-rows.js';
import { Keymap, type KeybindingRejection } from '../keys/registry.js';
import { Editor, type EditorSubmitOptions } from '../editor/editor.js';
import { editorHeightCap } from '../editor/height-cap.js';
import { OverlayStack, type OverlayAnchor, type OverlayContent, type OverlayHandle } from '../overlay/overlay.js';
import { AltScreenHost, type AltScreenPrimary } from '../overlay/alt-screen.js';
import { HistoryViewer } from '../history/history-viewer.js';
import { SessionPicker } from '../history/session-picker.js';
import { HelpViewer, type HelpCommandEntry } from '../panels/help-viewer.js';
import { UsageViewer } from '../panels/usage-viewer.js';
import { StatusViewer, type StatusPanelData } from '../panels/status-viewer.js';
import { DebugViewer, type DebugPanelData } from '../panels/debug-viewer.js';
import { SkillsViewer, type SkillListEntry } from '../panels/skills-viewer.js';
import { MemoryViewer, type MemoryViewerDataDeps } from '../memory/memory-viewer.js';
import { ConfirmPanel, SelectPanel } from '../overlay/select-confirm.js';
import { AutocompletePopup } from '../autocomplete/popup.js';
import { CombinedAutocompleteProvider, type AutocompleteSources } from '../autocomplete/autocomplete.js';
import { AutocompleteCompleter } from '../autocomplete/async.js';

/**
 * TUI 本地命令注入件（07 §4.1 命令面增补批——装配根到达 UiBackend 实装层）：
 * 一切边外面（skills registry / settings 读面 / daemon.log / 插件清单）经
 * run 闭包现取——本件只认词干命中与终局消费，不触任何边外面。
 */
export interface TuiLocalCommand {
  /** 命令名词干（词法同通道核 COMMAND_NAME_RE——^[a-z][a-z0-9-]*$） */
  readonly name: string;
  /** 说明（补全条目与 /help 命令册两消费面同文——装配位单源） */
  readonly description: string;
  /** 恰零参命中执行体（开副屏等——终局消费；带参形不达此位） */
  readonly run: () => void;
}

/** 后端构造选项 */
export interface TuiBackendOptions {
  /** 当前交互会话位（提交/打断柄的 sessionId 机器位——装配焦点联动可改） */
  readonly sessionId?: string;
  /**
   * 装配向接线柄（07 §4.3 两柄）：提交（非命令形文本——驱动 conversation）。
   * 第三参候跑标记（挂账解挂批 2026-09-15——alt+enter 提交形）：随
   * SubmitOptions.queueFollowUp 同义透传（busy 期排队候 run 终态种子新 run）。
   */
  readonly onSubmit?: (sessionId: string, text: string, opts?: EditorSubmitOptions) => void;
  /** 装配向接线柄：打断当前 run（ctrl+c——run 打断经装配侧折入 ask 链收口） */
  readonly onInterrupt?: (sessionId: string) => void;
  /**
   * 装配向接线柄：模型循环（挂账解挂批 2026-09-15——ctrl+p 层③.5 应用动作
   * 路）。缺席 = 键不劫持不炸（透传编辑器——无绑定归终局丢弃）。
   */
  readonly onModelCycle?: () => void;
  /** 装配向接线柄：退出（ctrl+d 空框） */
  readonly onQuit?: () => void;
  /** 命令柄（'/' 起手文本——03 §2.2 dispatch；false = 未命中落 onSubmit 兜底） */
  readonly dispatchCommand?: (input: string) => Promise<boolean>;
  /**
   * TUI 本地命令族（07 §4.1 命令面增补批——副屏/瞬时交互族本地拦截，/exit
   * 批先例扩编）：词干恰零参命中即 run() 终局消费；带参形 = 用法 fail-loud
   * 提示后终局（不执行也不兜底进模型消息）；未命中落通道命令柄。不进通道
   * 核命令表（webui 零污染——六词在非 TUI 面未注册，落驱动侧普通消息路）；
   * 一切边外面经装配根注入到达（run 闭包现取数据开副屏）。
   */
  readonly localCommands?: readonly TuiLocalCommand[];
  /** 补全三源注入（命令名源注入查询函数接 CommandRegistry.list()；@ 文件段源归装配批） */
  readonly autocomplete?: AutocompleteSources;
  /** todo 面板数据源（件 4——装配接 deps 同名面；注入缺席 = 面板缺席零变化） */
  readonly todoFor?: (sessionId: string) => readonly TodoItem[] | null | undefined;
  /** 调度注入（启用渲染合并 + fps 帽 + tick 自驱——缺省同步直出测试语义） */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  /** 取消调度注入（与 schedule 配对——stop 时收在飞帧/tick/ESC 窗） */
  readonly cancelSchedule?: (handle: unknown) => void;
  /** 时钟注入（缺省 Date.now——fps 帽锚） */
  readonly now?: () => number;
  /** lone-ESC 判定窗（ms；缺省 30） */
  readonly escapeWindowMs?: number;
  /** 帧率帽 fps（缺省 60——与 Engine DEFAULT_FPS_CAP 对齐） */
  readonly fpsCap?: number;
  /** 编辑器最大可视行（装配按终端高 30% 注入；缺省 8） */
  readonly maxVisibleLines?: number;
  /** 宿主版本（件 7——title 基线 `berry-agent <版本>`；缺席或空串 = 无版本缀裸名。真值归批 12 host 装配传 HostFace.version） */
  readonly version?: string;
  /**
   * 主题档（批 10g——07 R2）：dark / light / auto。auto = start 时 OSC 11
   * 背景查询裁定（无应答自然维持缺省 dark 即超时语义）；显式档短路零探测。
   * 缺省 dark（注入缺席的确定性测试基线——与批 10g 前 accent 字节同源）。
   */
  readonly theme?: ThemeSetting;
  /** 色域探测 env 投影（COLORTERM/TERM——批 10g 三档降采判据；缺省 {} = 16 色档） */
  readonly colorEnv?: ColorEnv;
  /**
   * 键位用户覆盖（R5 批 10k——settings.json `keybindings` 键透传）：形 = 动作
   * id → 键串；四形拒载经 Keymap fail-loud（unknown-action / not-overridable
   * / malformed-binding / conflict——拒载弃该键回退缺省），rejections 经
   * keybindingRejections 观测面呈报（装配位 notify warn 点名）。
   */
  readonly keybindings?: Readonly<Record<string, string>>;
  /**
   * footer 常驻段标签（R6 批 10k）：cwd 短名 / 模型名——缺席段缩位不虚报
   * （拼段执法）；会话短 id 段本件自持随切焦联动。注入缺席 = 无 footer
   * （状态行旧形零扰动——确定性测试基线）。
   */
  readonly footer?: { readonly cwdLabel?: string; readonly modelLabel?: string };
  /**
   * 流式帧字节帽（批 10h R1 perf 护栏）：缺省 STREAM_FRAME_BYTE_CAP 定值
   * 256KB（只拦病理性整档重排——常态帧为视口量级）。注入面 = 测试语义
   * （生产帽量级下「超帽降档纯文本」触发路径结构性不可测——小帽注入使
   * 降档路可证；缺省行为不变）。
   */
  readonly streamFrameByteCap?: number;
}

/** 主屏形进屏模式串：粘贴开 + kitty 推栈（disambiguate 最小位）+ 探测哨兵（无光标藏无 1049——与 Engine 全屏形分立） */
const ENTER_MAIN = '\x1b[?2004h' + '\x1b[>1u' + '\x1b[?u' + '\x1b[c';
/** 出屏模式串（与进屏严格对称反序——单源常量） */
const LEAVE_MAIN = '\x1b[<u' + '\x1b[?2004l';
/** OSC 11 背景色查询（BEL 终结形——xterm 主流；auto 档 start 时发） */
const OSC11_QUERY = '\x1b]11;?\x07';
/** 明暗变化通知订阅开/关（CSI ?2031——支持终端主题切换即时跟随、不支持无感） */
const THEME_CHANGE_ENABLE = '\x1b[?2031h';
const THEME_CHANGE_DISABLE = '\x1b[?2031l';

/** 渲染合并帧率帽缺省（对齐 Engine DEFAULT_FPS_CAP——批 10f-3 性能回归锁校准定值 60，实机校准后收紧留批 12） */
const DEFAULT_FPS_CAP = 60;
/**
 * 流式帧字节帽（批 10h——R1 perf 护栏落码定值）：冻结编舞下常态帧 ≈ 视口
 * 行 × 转义开销（24×80 档 < 10KB）；256KB 帽只拦病理性整档重排。超标降档
 * 纯文本（旧路径为降档开关——R1 分句原文），下条 message_start 复位重试。
 */
const STREAM_FRAME_BYTE_CAP = 256 * 1024;
/** lone-ESC 判定窗缺省（对齐 Engine DEFAULT_ESCAPE_WINDOW_MS） */
const DEFAULT_ESCAPE_WINDOW_MS = 30;
/** 状态行转轮自驱间隔（ms——注入调度后自重排） */
const TICK_INTERVAL_MS = 100;

/** notify 档位符号（正文着色纪律——纯符号不配色，与摘要行会话色分立） */
const NOTIFY_SYMBOLS: Readonly<Record<NotifyLevel, string>> = Object.freeze({
  info: '·',
  success: '✓',
  warn: '⚠',
  error: '✖',
});

/** 渲染合并 op 两形（repaint/resize 权威重建不走队列——同步直出） */
type PendingOp =
  | {
      readonly kind: 'present';
      readonly blocks: readonly TranscriptBlock[];
      /** 入队时的裁块累计（绝对位对账——enqueue 与 flush 间 trim 可再进，帧内自洽） */
      readonly offset: number;
    }
  | { readonly kind: 'transient'; readonly lines: readonly string[] };

/** input-ask 在飞体（提示行呈现 + 提交应答路） */
interface InputAsk {
  readonly message: string;
  readonly resolve: (text: string) => void;
}

/**
 * run 级用量累计（件 6——agent_start/repaint 归零、turn_end 累加、agent_end
 * 落行；观测面供装配/宿主侧二次消费，`/usage` 全量面板分职不互替）。
 */
export interface UsageAccumulation {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  /** 累计货币额（cost 在场才累——spec 条款） */
  readonly cost: number;
  /** 币种（首见 cost.currency 定着） */
  readonly currency: string | null;
}

/** 零账（归零基线） */
const ZERO_USAGE: UsageAccumulation = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: 0,
  currency: null,
});

/** token 数千位分组（1,234,567——usage 行「格式化」定形） */
function formatTokenCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * TUI 后端：单终端 inline 主屏 + 自持输入管线。构造后须 start()（模式串 +
 * 清屏 + 滚动区确立）再接核事件；stop() 对称出屏（模式串反序 + raw 复原）。
 */
export class TuiBackend implements UiBackend<AgentMessage>, AltScreenPrimary {
  readonly id = 'tui';
  readonly capabilities = Object.freeze({
    notify: true,
    confirm: true, // 浮层面板呈现（批 10e-2 交互纵切实装）
    select: true,
    input: true,
    approval: true,
    setStatus: true,
    setWidget: false,
  });

  /** 当前交互会话位（装配焦点联动可改——提交/打断柄的机器位） */
  sessionId: string;

  private readonly io: TerminalIO;
  private readonly screen: MainScreen;
  /** 直播行集（构造晚于主题解析——主题注入构造位，applyPalette 换装传导） */
  private readonly transcript: LiveTranscript;
  private readonly statusLine = new StatusLine();
  private readonly editor: Editor;
  private readonly popup: AutocompletePopup;
  /** 三源合一补全器（token 路由 + union 收口——R6 批 10j 调度器查询位） */
  private readonly autocompleteProvider: CombinedAutocompleteProvider;
  /** 补全防抖调度器（R6 批 10j：尾沿 20ms / AbortSignal / 错序丢弃三律） */
  private readonly autocompleteCompleter: AutocompleteCompleter;
  private readonly stack = new OverlayStack();
  /** overlay 锚定注册表（content 身份键 → 本帧 region——renderFixed 行账重建） */
  private readonly overlayLayout = new Map<
    OverlayContent,
    { row: number; col: number; width: number; height: number }
  >();
  /** 装配柄（07 §4.3 两柄 + 命令柄 + 模型循环柄〔挂账解挂批 2026-09-15〕） */
  private readonly onSubmit: ((sessionId: string, text: string, opts?: EditorSubmitOptions) => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private readonly onModelCycle: (() => void) | undefined;
  private readonly dispatchCommand: ((input: string) => Promise<boolean>) | undefined;

  /* ---- 输入管线态 ---- */
  private readonly decoder: InputDecoder;
  private readonly escapeWindowMs: number;
  private escapeHandle: unknown = null;
  private unsubInput: (() => void) | null = null;
  private unsubResize: (() => void) | null = null;
  private running = false;
  /** 起动过位（lifecycle 的 idle / disposed 分权——一次性事实，start 幂等位之外） */
  private startedOnce = false;
  private priorRaw = false;
  private disarmExitRestore: (() => void) | null = null;

  /* ---- 主屏挂起态（批 10f-4——AltScreenPrimary 交出面） ---- */
  /** 挂起位（suspendMain 置位：渲染请求安全 no-op 闸 + 输入已卸订） */
  private suspendedMain = false;
  /** 停屏期到达的瞬时行缓冲（notify / 件 9 摘要行 / 撤销说明行——复起补显射界，2026-09-07 勘正笔） */
  private suspendedTransients: string[] = [];

  /* ---- 副屏装配态（批 10f-4 特性腿——件 8 /history；mm 批 /memory 并席） ---- */
  /** 副屏宿主（构造晚于 io 赋值——类字段初始化序：宿主构造须见 io 实值） */
  private readonly altHost: AltScreenHost;
  /** 在场副屏句柄（单值承载 /history /memory /help /sessions /usage 五件——无嵌套备屏律；开、q/Esc/Ctrl+D/ask 收四路共闭） */
  private altHandle: OverlayHandle | null = null;
  /**
   * 记忆管理面材料位（mm 批——后置注入）：构造期不可达（memory 件的 dao
   * 生命周期在插件 apply 内、且 channels 不可 import memory——边表），装配
   * 根 boot 完成后经 setMemoryScreen 注入真身；null = 材料缺席（openMemory
   * 返 false——/memory 命令核侧 notify 降级提示）。
   */
  private memoryScreen: MemoryViewerDataDeps | null = null;

  /* ---- 渲染合并态（schedule 注入后活——否则同步直出） ---- */
  private readonly scheduleFn: ((fn: () => void, ms: number) => unknown) | null;
  private readonly cancelFn: (handle: unknown) => void;
  private readonly now: () => number;
  private readonly minFrameMs: number;
  /**
   * 显式注入的编辑器高度帽（批 10k 遗漏修）：null = 帽公式按几何动态解析
   * （resize 随动——handleResize 重算）；非 null = 测试/装配注入帽恒尊注入值。
   */
  private readonly fixedEditorCap: number | null;
  /**
   * 流式槽在场期的瞬时行缓冲（批 10k 遗漏修）：槽在场时 appendTransient 直
   * 写会落槽首行位（gotoRow(durableEndRow) 起笔——嵌入槽内破槽形），缓冲至
   * 关槽帧（present 无槽）后补吐——与 suspendedTransients 同形互补。
   */
  private slotTransients: string[] = [];
  private pendingOps: PendingOp[] = [];
  private needFixed = false;
  private frameHandle: unknown = null;
  private tickHandle: unknown = null;
  private lastFlushAt = Number.NEGATIVE_INFINITY;

  /** input-ask 在飞体（null = 常态——提交落 onSubmit） */
  private inputAsk: InputAsk | null = null;

  /* ---- 呈现面件 4/5/6 态 ---- */
  private readonly todoFor: ((sessionId: string) => readonly TodoItem[] | null | undefined) | undefined;
  private readonly todoPanel = new TodoPanel();
  private readonly toolPanel = new ToolProgressPanel();
  /** 当前 turn 的 assistant 消息用量暂存（turn_end 累加——件 6 等价性条款） */
  private pendingUsage: Usage | null = null;
  private usageTotal: UsageAccumulation = ZERO_USAGE;

  /* ---- 呈现面件 7 态（终端外显） ---- */
  /** title 基线（`berry-agent` 或 `berry-agent <版本>`——起屏与复原落点） */
  private readonly titleBaseline: string;
  private readonly osc: OscDisplay;
  /**
   * 各会话在飞净计数（agent_start +1 / agent_end -1——按信封 sessionId 归
   * 账，clamp ≥ 0；归零删条目防会话退出残键）。聚焦位不参账：run 跨切焦时
   * start/end 恒落同一会话账——按事件时刻聚焦位分两路会跨路不对称（末路
   * end 被 clamp 吞致忙态永残留，07 件 7 判据勘正）。
   */
  private readonly inFlightBySession = new Map<string, number>();
  /** 进度态上次写出（忙闲迁移门——同态静默，周期重发归保活自持） */
  private progressBusy = false;

  /* ---- 主题态（批 10g——07 R2 三档色域 + 语义键 + OSC 11 自动明暗） ---- */
  /** 主题档（auto = start 时 OSC 11 探测裁定；显式档短路） */
  private readonly themeSetting: ThemeSetting;
  /** 色域档（构造期一次探测——env 注入面，渲染路径零探测） */
  private readonly colorDepth: ColorDepth;
  /** 当前主题（构造期解析 auto 先 dark；probe 回执换装走整体换引用） */
  private theme: ResolvedTheme;
  /**
   * 键位注册表（批 10i R5 基座 + 10k 用户覆盖接线）：Keymap 构造受理覆盖 +
   * 四形拒载（rejections 观测面呈报——拒载键不生效但点名可见）；
   * keyText 单源下装 transcript（思考标签提示等显示面随册取键名）
   */
  private readonly keymap: Keymap;
  /**
   * TUI 本地命令族（07 §4.1 命令面增补批——/exit 批退出词扩编为通用族）：
   * 提交路由在通道命令分发前按词干拦截（注入缺席 = 空表零扰动）。
   */
  private readonly localCommands: readonly TuiLocalCommand[];
  /**
   * footer 常驻段标签（R6 批 10k——cwd 短名/模型名；会话短 id 段随切焦联动）。
   * 模型段可变（挂账解挂批 2026-09-15——ctrl+p 模型循环经 setFooterModel 活写）。
   */
  private readonly footerCwd: string | undefined;
  private footerModel: string | undefined;
  /**
   * footer 门控位（挂载解挂批 2026-09-15 显式化）：footer 选项注入在场才开
   * 常驻段——setFooterModel 活写的 no-op 判据（注入缺席 = 状态行旧形零扰动）。
   */
  private readonly footerEnabled: boolean;
  /** 流式帧字节帽（选项注入面——缺省 STREAM_FRAME_BYTE_CAP 生产定值 256KB） */
  private readonly streamFrameByteCap: number;

  constructor(io: TerminalIO, options: TuiBackendOptions = {}) {
    this.io = io;
    this.sessionId = options.sessionId ?? 'main';
    this.onSubmit = options.onSubmit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onModelCycle = options.onModelCycle;
    this.dispatchCommand = options.dispatchCommand;
    this.localCommands = options.localCommands ?? [];
    this.todoFor = options.todoFor;
    this.scheduleFn = options.schedule ?? null;
    this.cancelFn = options.cancelSchedule ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.now = options.now ?? Date.now;
    this.minFrameMs = 1000 / (options.fpsCap ?? DEFAULT_FPS_CAP);
    this.escapeWindowMs = options.escapeWindowMs ?? DEFAULT_ESCAPE_WINDOW_MS;
    // 流式帧字节帽：注入面（测试小帽证降档路）缺席 = 生产定值 256KB
    this.streamFrameByteCap = options.streamFrameByteCap ?? STREAM_FRAME_BYTE_CAP;
    // 件 7：title 基线（version 注入缺席 = 裸名）；外显件复用本件调度注入
    // （schedule 缺席 = 保活缺位——同步测试语义，与渲染合并同构）
    this.titleBaseline = options.version ? `berry-agent ${options.version}` : 'berry-agent'; // 空串同缺席归裸名（无尾随空格脏基线）
    this.osc = new OscDisplay(io, {
      baseline: this.titleBaseline,
      schedule: this.scheduleFn ?? undefined,
      cancel: this.cancelFn,
    });
    this.decoder = new InputDecoder({
      now: this.now,
      escapeWindowMs: this.escapeWindowMs,
      onOsc: (data) => this.handleOscReply(data), // OSC 11 应答上抛（批 10g——显式档回调内短路）
    });
    // 主题基座（批 10g）：档位 + 色域构造期一次解析（显式档零探测；auto 先
    // dark 缺省、probe 回执换装）；注入缺席缺省 = dark@16 与批 10g 前 accent
    // 字节同源——既有确定性测试零扰动
    this.themeSetting = options.theme ?? 'dark';
    this.colorDepth = detectColorDepth(options.colorEnv ?? {});
    this.theme = resolveTheme(builtinPalette(this.themeSetting === 'light' ? 'light' : 'dark'), this.colorDepth);
    // 键位注册表（批 10i R5 基座 + 10k 用户覆盖）：settings keybindings 键
    // 透传——四形拒载 fail-loud（拒载弃该键回退缺省，rejections 观测面呈报）
    this.keymap = new Keymap(options.keybindings);
    // footer 常驻段标签（R6 批 10k）：空串同缺席缩位（不虚报空段）
    this.footerCwd =
      options.footer?.cwdLabel !== undefined && options.footer.cwdLabel !== '' ? options.footer.cwdLabel : undefined;
    this.footerModel =
      options.footer?.modelLabel !== undefined && options.footer.modelLabel !== ''
        ? options.footer.modelLabel
        : undefined;
    // footer 门控（R6 批 10k）：footer 选项注入在场才开常驻段（短 id 段恒在——
    // 缺席段缩位不虚报指两标签）；注入缺席 = 无 footer 状态行旧形（确定性测试
    // 基线零扰动）
    this.footerEnabled = options.footer !== undefined;
    if (this.footerEnabled) this.refreshFooter();
    // 直播行集（批 10h/10i）：主题随构造定着——流式 markdown 直推档与定稿块同源
    this.transcript = new LiveTranscript({ theme: this.theme, keyText: (id) => this.keymap.keyText(id) });
    // 编辑器高度帽单点解析（批 10k 遗漏修）：显式注入帽（测试语义）恒尊注入
    // 值；缺席 = 帽公式单源按构造期几何解析（resize 随动见 handleResize）
    this.fixedEditorCap = options.maxVisibleLines ?? null;
    this.editor = new Editor({
      onSubmit: (text, opts) => this.handleSubmit(text, opts),
      onChange: () => this.handleEditorChange(),
      maxVisibleLines: this.fixedEditorCap ?? editorHeightCap(this.io.size().rows),
      // 键位注册表注入（批 10k 遗漏修——此前缺注 = 用户覆盖对编辑器不生效，
      // Editor 自建缺省册与 backend 册两册分叉）；子编辑器（副屏搜索/导出行）
      // 经 viewer options 同册注入
      keymap: this.keymap,
    });
    // 补全三件（R6 批 10j 异步形）：provider 路由单源 → 弹层纯落位面 → 防抖
    // 调度器居中编舞。query 闭包 fire 时自取编辑器现态（防抖窗内连打取最新
    // 态）；schedule 注入缺席 = 立即发（同步测试语义——既有确定性测试零扰动）
    this.autocompleteProvider = new CombinedAutocompleteProvider(options.autocomplete ?? {});
    this.popup = new AutocompletePopup(this.editor.model);
    this.autocompleteCompleter = new AutocompleteCompleter({
      query: (signal) => {
        const cursor = this.editor.model.getCursor();
        return this.autocompleteProvider.getCompletions(
          {
            lines: this.editor.model.getLines(),
            cursorLine: cursor.line,
            cursorCol: cursor.col,
          },
          signal,
        );
      },
      onResult: (result) => {
        if (this.inputAsk !== null) return; // 应答接管窗——迟到在途结果不落层
        this.popup.applyResult(result);
        this.touchFixed();
      },
      schedule: this.scheduleFn ?? undefined,
      cancelSchedule: this.scheduleFn !== null ? this.cancelFn : undefined,
    });
    this.injectTheme(); // 构造期注入（accent 派生样式定值；重画归 start 首帧）
    this.stack.onChange = () => this.touchFixed();
    this.screen = new MainScreen(io, { fixedHeight: 4 }); // 初始高：编辑器 3 + 状态行 1（动态更新经 setFixed）
    // 副屏宿主（构造放 constructor 尾——io 与注入面已赋值；引擎选项与主屏同源：
    // 假钟 / 帧帽 / lone-ESC 窗直通，调度无注入时给同步直出包装——副屏首帧
    // 确定性与 lone-ESC 即决同主屏测试语义）
    this.altHost = new AltScreenHost(this, io, {
      engineOptions: {
        now: this.now,
        fpsCap: options.fpsCap,
        escapeWindowMs: this.escapeWindowMs,
        schedule:
          this.scheduleFn ??
          ((fn: () => void) => {
            fn();
            return null;
          }),
        cancelSchedule: this.scheduleFn !== null ? this.cancelFn : () => {},
      },
    });
  }

  /** TUI 恒有观众（07 §4.3 观众探针定值） */
  hasAudience(): boolean {
    return true;
  }

  /** 生命周期判定位（AltScreenPrimary 窄介面面：idle 未启 / running 持屏 / suspended 挂起 / disposed 终退） */
  get lifecycle(): 'idle' | 'running' | 'suspended' | 'disposed' {
    if (!this.startedOnce) return 'idle';
    if (!this.running) return 'disposed';
    return this.suspendedMain ? 'suspended' : 'running';
  }

  /** 启动：主屏形模式串 + raw + 输入订阅 + 清屏滚动区 + 固定区首画 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedOnce = true; // 一次性事实（stop 后 disposed——start 不再可回）
    this.priorRaw = this.io.isRaw();
    this.io.write(ENTER_MAIN);
    this.armExitRestore();
    this.osc.setTitle(this.titleBaseline); // 件 7：起屏基线 title（OSC 0——值缓存首写）
    // 主题探测（批 10g）：auto 档发 OSC 11 背景查询 + 明暗变化通知订阅（2031
    // ——支持终端切换即时跟随）；显式档短路零写出。无应答超时降缺省 dark =
    // 自然维持构造期 dark 板（无钟不设窗——应答迟到照常换装，语义等价且免竞）
    if (this.themeSetting === 'auto') {
      this.io.write(OSC11_QUERY + THEME_CHANGE_ENABLE);
    }
    this.io.setRawMode(true);
    this.unsubInput = this.io.onInput(this.handleInput);
    // 显式放流（共享 io 换防接缝——副屏 Engine 复用同 io 场景；首启 no-op）
    this.io.resume();
    this.screen.start();
    this.renderFixed();
    this.unsubResize = this.io.onResize(() => this.handleResize());
    if (this.scheduleFn !== null) this.armTick();
  }

  /** 对称出屏：模式串反序 + 输入卸订 + 定时器全收 + 外显复原 + raw 复原（终退不可复用） */
  stop(): void {
    if (!this.running) return;
    this.closeAlt(); // 防御位：在场副屏先收（装配纪律先收再退——泄漏则副屏 Engine 残活）
    this.running = false;
    // 挂起期主屏已出屏（suspendMain 已写出屏串）——重写会污染在场副屏；
    // 装配纪律恒「先收副屏再退出」，本闸是防御位非编舞路
    if (!this.suspendedMain) {
      this.io.write(LEAVE_MAIN);
      if (this.themeSetting === 'auto') this.io.write(THEME_CHANGE_DISABLE); // 2031 复原（显式档从未开）
    }
    this.unsubInput?.();
    this.unsubInput = null;
    this.unsubResize?.();
    this.unsubResize = null;
    this.cancelTimer('frame');
    this.cancelTimer('tick');
    this.cancelTimer('escape');
    this.autocompleteCompleter.cancel(); // 补全在途全收（停机后零迟到交付）
    this.osc.restore(); // 件 7：复原两写点（title 基线 + 进度清零）+ 保活停针（名册语义）
    this.disarmExitRestore?.();
    this.io.pause();
    if (!this.suspendedMain) this.io.setRawMode(this.priorRaw); // 挂起期 raw 已复先验——不二次复原
  }

  /**
   * 主屏挂起（AltScreenPrimary 交出半场——批 10f-4；07 §4.1 件 8「主屏挂起 /
   * 复起交出面（UiBackend 实装件自持）」条款）：
   * 出屏模式串 + 卸输入监听 + 在途转义一窗全丢 + 停流 + raw 复先验（Engine
   * suspend 三件套同形——共享 io 换防，副屏随后 start 重装重放流）；渲染请求
   * 安全 no-op（requestRender / flush 挂起闸——停屏期零写出）；帧合并 / tick /
   * lone-ESC 窗定时器全收（防后台空转）；硬退复原钩解除（挂起期副屏自担其屏
   * 的退出复原）。
   *
   * 件 7 osc 保活不停（批内裁）：外显态（title / 忙态 OSC 9;4）属终端级非
   * 主屏 cell 内容——停屏期终端标签页注意力语义照常（onEnvelope 照常归账），
   * OSC 序列不落 cell 网格不扰动副屏画面。
   *
   * 停屏期账不丢：durable 事件照常归约行集模型（复起全帧重画携带——树已含
   * 停屏期全部事件）；瞬时行（notify / 件 9 摘要行 / 撤销说明行）入
   * suspendedTransients 缓冲——复起补显射界含瞬时行（树按字面不含不入树的
   * 瞬时行，2026-09-07 遗漏审计批补笔）。
   */
  suspendMain(): void {
    if (!this.running || this.suspendedMain) return; // 幂等 + 无挂起对象防御
    this.suspendedMain = true;
    this.io.write(LEAVE_MAIN); // 出屏模式串（与 start 进屏严格对称反序——单源常量）
    this.unsubInput?.();
    this.unsubInput = null;
    this.decoder.discardPending(); // 在途转义 / 粘贴 / 预编辑一窗全丢（Engine 换防同形）
    this.io.pause();
    this.io.setRawMode(this.priorRaw); // raw 复先验（副屏随后自设 raw）
    this.cancelTimer('frame'); // 在飞帧收口（挂起期零写出的调度半边）
    this.cancelTimer('tick'); // 状态行转轮停摆（防后台空转——复起重摆）
    this.cancelTimer('escape'); // lone-ESC 窗收口（decoder 已弃在途态）
    this.disarmExitRestore?.(); // 出屏解除硬退复原钩（挂起期副屏自担）
  }

  /**
   * 主屏复起（AltScreenPrimary 交出半场的对称复位）：进屏模式串 + 硬退钩
   * 重武装 + raw 重设 + 输入重装 + 显式放流（已被 pause 的流再挂监听不自动回
   * flowing——Engine resume 同形）+ **全帧重画不走（通道）repaint**：主屏既有
   * 权威全量重建路（几何真值重取 + 清屏 + 行集全量重写）+ 瞬时行缓冲补吐。
   *
   * 不走（通道）repaint 的行为锁：通道 repaint 按投影重建行集，投影不含停屏
   * 期直写主屏的瞬时行——全帧重画以行集 + 瞬时缓冲为真相，瞬时行在场即补显
   * （07 件 8「repaint 清树会抹掉停屏期入树的瞬时行」+ 2026-09-07 勘正笔）。
   * 停屏期 resize 由几何真值重取吸收（挂起期 handleResize 安全 no-op——此刻
   * 写出会污染在场副屏）。
   */
  resumeMain(): void {
    if (!this.running || !this.suspendedMain) return; // 幂等 + 非挂起态防御
    this.suspendedMain = false;
    this.io.write(ENTER_MAIN); // 进屏模式串（与出屏对称）
    this.armExitRestore(); // 复进屏重武装（arm 幂等——先解除旧钩再挂）
    // OSC 11 重查（七役扫描批 A3）：挂起窗副屏 decoder 无 onOsc 透传、2031
    // 明暗通知丢弃（v1 已知边界——副屏在场期即时跟随不做），复起重查即补偿。
    // 同板应答 handleOscReply 短路零重画（零噪声）、迟到照常换装（无钟不设窗
    // 语义同源）；2031 订阅挂起期未关（suspendMain 不写 disable）无须重开
    if (this.themeSetting === 'auto') this.io.write(OSC11_QUERY);
    this.io.setRawMode(true);
    this.unsubInput = this.io.onInput(this.handleInput);
    this.io.resume(); // 显式放流（副屏 dispose 已 pause——共享 io 换防接缝）
    // 排队旧帧作废 + 固定区脏位重建（全帧重画是新真相——挂起期积压 op 合并无意义）
    this.pendingOps = [];
    this.needFixed = false;
    // 全帧重画：几何真值重取（吸收停屏期 resize）+ 清屏 + 行集全量重写（含停屏期 durable 事件）
    this.screen.handleResize(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    // 瞬时行缓冲补吐（复起补显射界含停屏期瞬时行——2026-09-07 勘正笔）；槽在
    // 场（停屏期起流未收口）走槽期缓冲路（关槽帧补吐——同 flush 编舞）
    const transients = this.suspendedTransients;
    this.suspendedTransients = [];
    if (transients.length > 0) {
      if (this.transcript.snapshot.at(-1)?.kind === 'streaming') this.slotTransients.push(...transients);
      else this.screen.appendTransient(transients);
    }
    this.renderFixed();
    if (this.scheduleFn !== null) this.armTick(); // 状态行转轮复摆
  }

  /* ---------------- 副屏装配面（批 10f-4 特性腿——件 8 /history；mm 批 /memory 并席） ---------------- */

  /**
   * 开副屏回看器（UiBackend 可选能力面实装——通道核 /history 命令到达扇出）：
   * 挂起主屏 → 1049 副屏 HistoryViewer（同一渲染管线全量档——件 8 数据源
   * 条款）。已在副屏 no-op（无嵌套备屏）；主屏不在 running 态 open 被拒
   * （句柄 null——保持无副屏态）。Ctrl+C / Ctrl+D 副屏键面经 viewer 装配柄
   * 透传本件两柄（与主屏同键面）。
   */
  openHistory(sessionId: string, messages: readonly AgentMessage[]): void {
    if (this.altHandle !== null) return;
    const handle = this.altHost.open(
      new HistoryViewer({
        sessionId,
        messages,
        columns: this.io.size().columns,
        theme: this.theme, // 会话主题快照（批 10i——回看器行集与主屏同板，含思考块/工具卡烙印）
        onExit: () => this.closeAlt(),
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
        // OSC 52 复制写出柄（mu-2）：release 选区行间拼 LF 到达 → 铸序列直写
        // io（终端支持不可探测——尽力写出无反馈，件 8 细则）
        onCopy: (text) => this.io.write(buildOsc52Copy(text)),
        // 键位册同源注入（批 10k 遗漏修——搜索行子编辑器同册，用户覆盖通效）
        keymap: this.keymap,
      }),
    );
    this.altHandle = handle; // null = 主屏未 running 被拒——如实保持无副屏
  }

  /**
   * 记忆管理面材料注入（mm 批——后置 init 位）：装配根 boot 完成后从
   * core:memory 服务面取材料注入（ownerKeys/DAO 窄面/消毒函数/导出闭包——
   * 真身经装配传真）。null = 撤材料（件卸载形——后续 openMemory 返 false）。
   */
  setMemoryScreen(deps: MemoryViewerDataDeps | null): void {
    this.memoryScreen = deps;
  }

  /**
   * 开副屏记忆管理面（UiBackend 可选能力面实装——通道核 /memory 命令到达
   * 扇出；06 §7 形态定形注）：材料缺席或已在副屏返 false（核侧 notify 降级
   * 提示）；退出三柄本件自持（打断 = 当前交互会话位——与提交柄同锚）。
   */
  openMemory(): boolean {
    if (this.memoryScreen === null || this.altHandle !== null) return false;
    const deps = this.memoryScreen;
    const handle = this.altHost.open(
      new MemoryViewer({
        ...deps,
        onExit: () => this.closeAlt(),
        onInterrupt: () => this.onInterrupt?.(this.sessionId), // 零参形——装配闭包已知目标会话
        onQuit: this.onQuit,
        // 键位册同源注入（批 10k 遗漏修——导出行子编辑器同册，用户覆盖通效）
        keymap: this.keymap,
      }),
    );
    if (handle === null) return false; // 主屏未 running 被拒——如实报 false
    this.altHandle = handle;
    return true;
  }

  /**
   * 开副屏会话切换器（UiBackend 可选能力面实装——R7 批 10k /sessions）：清单
   * 载荷经通道核流转（openHistory 同律）；选定回调核闭包透传（registry.focus
   * 既有权威路——本件呈现不触焦点态）。已在副屏 / 主屏不在 running 返 false
   * （核侧 notify 降级）。打断柄锚当前交互会话位（切焦前语义）。
   */
  openSessions(sessions: readonly UiSessionSummary[], onSelect: (sessionId: string) => void): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new SessionPicker({
        sessions,
        onSelect,
        onExit: () => this.closeAlt(),
        onInterrupt: () => this.onInterrupt?.(this.sessionId),
        onQuit: this.onQuit,
      }),
    );
    if (handle === null) return false;
    this.altHandle = handle;
    return true;
  }

  /**
   * 开副屏用量面板（UiBackend 可选能力面实装——R7 批 10k /usage）：会话全
   * run 累计分表（装配独立聚合——非件 6 清账态）。返 boolean 同 openSessions 律。
   */
  openUsage(sessionId: string, summary: UiUsageSummary): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new UsageViewer({
        sessionId,
        summary,
        columns: this.io.size().columns,
        onExit: () => this.closeAlt(),
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
      }),
    );
    if (handle === null) return false;
    this.altHandle = handle;
    return true;
  }

  /**
   * 开副屏帮助面（R7 批 10k /help——命令册装配注入、键位册 = 本件 keymap
   * 投影，双源在装配位合流）：不经通道核流转（键位册 TUI 侧持有——/help 命令
   * 注册在装配位 tui-entry，与 openHistory 的核内注册分立）。已在副屏返
   * false（装配位 notify 降级）。
   */
  openHelp(commands: readonly HelpCommandEntry[]): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new HelpViewer({
        commands,
        actions: this.keymap.actions, // 键位册投影——解析后生效键集（覆盖随动）
        sessionId: this.sessionId,
        onExit: () => this.closeAlt(),
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
      }),
    );
    if (handle === null) return false;
    this.altHandle = handle;
    return true;
  }

  /**
   * 开副屏状态汇总（07 §4.1 命令面增补批 /status——TUI 本地拦截族，不经
   * 通道核流转）：数据快照装配位现取注入（开屏一次快照档）。返 boolean 同
   * openHelp 律（副屏占用 false——装配位 notify 降级）。
   */
  openStatus(data: StatusPanelData): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new StatusViewer({
        data,
        onExit: () => this.closeAlt(),
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
      }),
    );
    if (handle === null) return false;
    this.altHandle = handle;
    return true;
  }

  /**
   * 开副屏调试信息（07 §4.1 命令面增补批 /debug——TUI 本地拦截族）：日志
   * 尾快照（掩码在 viewer 行集构造执法）+ 生效配置 + 插件清单。返 boolean
   * 同 openHelp 律。
   */
  openDebug(data: DebugPanelData): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new DebugViewer({
        data,
        sessionId: this.sessionId, // 打断柄锚当前交互会话位（调试面 host 级、不呈会话段）
        onExit: () => this.closeAlt(),
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
      }),
    );
    if (handle === null) return false;
    this.altHandle = handle;
    return true;
  }

  /**
   * 开副屏技能清单（07 §4.1 命令面增补批 /skills——TUI 本地拦截族）：enter
   * = 回填调用形入输入框（不执行——提交与否归用户）；索引位回调经装配闭包
   * 铸 formatSkillInvocation 文本（skills 域真身在 host 侧，本件收纯数据行；
   * DAG 边表 channels 不入 skills——回填文本装配位单源）。选定先收副屏再
   * 回填（SessionPicker 同序律），回填后 touchFixed 固定区脏位随帧落地。
   * 返 boolean 同 openHelp 律。
   */
  openSkills(entries: readonly SkillListEntry[], invokeAt: (index: number) => string): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new SkillsViewer({
        entries,
        onSelect: (index) => {
          const invocation = invokeAt(index);
          this.editor.setText(invocation); // 回填调用形（不提交——提交路归用户 enter）
          this.touchFixed();
        },
        sessionId: this.sessionId,
        onExit: () => this.closeAlt(),
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
      }),
    );
    if (handle === null) return false;
    this.altHandle = handle;
    return true;
  }

  /**
   * 键位拒载观测面（R5 批 10k）：Keymap 构造期四形拒载清单——装配位逐条
   * notify warn 呈报（拒载键不生效但点名可见——fail-loud；缺省恒空）。
   */
  get keybindingRejections(): readonly KeybindingRejection[] {
    return this.keymap.rejections;
  }

  /**
   * 收副屏（UiBackend 可选能力面实装——UiCore ask 入口扇出「先收副屏再入
   * 提问队列」，07 §4.1 件 8 注意力优先级 ask > 回看条款；viewer 退出键
   * 同路收口；/history 与 /memory 两件共口——在场者谁收谁）。幂等：无副屏 no-op。
   */
  collapseAltScreen(): void {
    this.closeAlt();
  }

  /** 副屏统一收口：句柄 close（AltScreenHost 编舞：出副屏 + 主屏复起全帧重画） */
  private closeAlt(): void {
    const handle = this.altHandle;
    if (handle === null) return;
    this.altHandle = null; // 先置空防重入（viewer onExit 与 ask 收起竞发）
    handle.close(); // 幂等（句柄 closed 位自守）
  }

  /** 一次性通知：正文瞬时行直写（级别符号前缀——不进行集） */
  notify(message: string, opts?: { level?: NotifyLevel }): void {
    const symbol = NOTIFY_SYMBOLS[opts?.level ?? 'info'];
    this.appendTransientLine(`${symbol} ${message}`);
  }

  /**
   * 瞬时说明行入正文流（notify 与 ask 撤销说明行共用路——07 §4.3「曾在屏
   * 者由通道上撤销说明行」）：op 入合并队列 + 渲染请求（同步直出模式立即
   * 落地；注入调度随帧合并——transient 到达序保持）。挂起期入缓冲账不丢
   * （复起补显射界含瞬时行——批 10f-4）。
   */
  private appendTransientLine(line: string): void {
    if (this.suspendedMain) {
      this.suspendedTransients.push(line); // 停屏期瞬时行缓冲（不入 op 队列——复起不走合并直补吐）
      return;
    }
    this.pendingOps.push({ kind: 'transient', lines: [line] });
    this.requestRender();
  }

  /** 状态行文案（last-writer-wins——StatusLine 件语义） */
  setStatus(_sessionId: string, status: string): void {
    this.statusLine.setStatus(status);
    this.touchFixed();
  }

  /**
   * footer 常驻段重算（R6 批 10k）：cwd 短名 · 模型名 · 会话短 id 拼段
   * （缺席段缩位不虚报——两标签装配注入期定值、短 id 段随切焦联动）。
   * footer 选项注入缺席时状态行无常驻段（refreshFooter 只在门控内被调）。
   */
  private refreshFooter(): void {
    const parts: string[] = [];
    if (this.footerCwd !== undefined) parts.push(this.footerCwd);
    if (this.footerModel !== undefined) parts.push(this.footerModel);
    parts.push(shortIdOf(this.sessionId));
    this.statusLine.setFooter(parts.join(' · '));
    this.touchFixed();
  }

  /**
   * footer 模型段活写（挂账解挂批 2026-09-15——ctrl+p 模型循环消费面）：
   * 换名即时重画常驻段。footer 门控内才生效（注入缺席 = 无常驻段——活写
   * no-op 零扰动）；空串同缺席缩位（与构造期同判据——不虚报空段）。
   */
  setFooterModel(model: string): void {
    if (!this.footerEnabled) return;
    this.footerModel = model !== '' ? model : undefined;
    this.refreshFooter();
  }

  /** 活体信封呈现：渲染归约 + 摘要行分叉 + 聚焦态状态面消费 */
  onEnvelope(env: SessionEnvelope, focused: boolean): void {
    const summary = this.transcript.applyEvent(env, focused);
    if (summary !== null) {
      // 摘要行统一走 appendTransientLine（挂起期入缓冲不丢——批 10f-4 改道）
      this.appendTransientLine(summaryToAnsi(summary));
    } else {
      this.enqueuePresent();
    }
    this.requestRender();
    this.trackProgress(env); // 件 7：按会话净计数（终端级注意力——任一会话在飞即忙）
    if (focused) this.applyFocusedEvent(env.event);
  }

  /** 重画呈现：投影重建行集 + 清屏全量重写（widget 槽值不支撑——忽略） */
  onRepaint(sessionId: string, projection: readonly AgentMessage[], _widget: { node: unknown } | null): void {
    // repaint 是焦点切换的权威信号（focus() 未注册视同注册——首次注册同路）：
    // 交互会话位跟随（提交/打断柄机器位锚新焦——/sessions 选定切焦路）
    this.sessionId = sessionId;
    this.refreshTodo(); // 件 4：todo 源锚新焦（refreshTodo 三时点之外的本位）
    // 模型半场照常（repaint 是新真相——挂起期也不丢投影：复起全帧重画携带）
    this.transcript.loadProjection(projection);
    this.resetUsage(); // 件 6：清行并归零（切焦清账重计——尾注射界）
    this.toolPanel.clear(); // 件 5：瞬时面不跨 repaint 保存
    this.refreshFooter(); // footer 会话短 id 段随切焦联动（R6 批 10k）
    this.osc.setTitle(`${this.titleBaseline} · ${shortIdOf(sessionId)}`); // 件 7：title 点缀会话短 id（终端级外显——挂起期照常，批 10f-4 裁）
    // 权威全量重建——排队旧帧作废（repaint 是新真相，合并无意义）
    this.pendingOps = [];
    this.needFixed = false;
    if (this.suspendedMain) return; // 挂起闸：屏上零写出（复起全帧重画携带新投影）
    this.screen.repaint(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    this.renderFixed();
  }

  /** 状态行动画推帧（自驱定时器内调；公开面留装配侧手动驱动——忙态外零开销） */
  tick(): void {
    if (!this.statusLine.isBusy) return;
    this.statusLine.tick();
    this.touchFixed();
  }

  /** run 级用量累计观测面（件 6——装配/宿主侧二次消费） */
  get usageView(): UsageAccumulation {
    return { ...this.usageTotal };
  }

  /** resize 编舞：几何重取 + 主屏全量重画 + 固定区按新几何重建（权威重建不走队列） */
  handleResize(): void {
    if (this.suspendedMain) return; // 挂起闸：停屏期零写出（此刻写出污染在场副屏）——几何真值由复起全帧重画重取吸收
    // 编辑器高度帽随几何重算（批 10k 遗漏修——此前构造期一算永不随动：缩窗后
    // 帽仍按初始行数，固定区总高可超屏行）；显式注入帽恒尊注入值（测试语义）
    this.editor.setMaxVisibleLines(this.fixedEditorCap ?? editorHeightCap(this.io.size().rows));
    this.pendingOps = [];
    this.needFixed = false;
    this.screen.handleResize(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    this.renderFixed();
  }

  /* ---------------- 阻塞四件（浮层面板呈现——07 §4.3） ---------------- */

  /** 是/否确认：ConfirmPanel 浮层（Enter → true / Esc → false；signal abort 保守值 + 关层 + 撤销说明行） */
  confirm(message: string, opts?: UiAskOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const panel = new ConfirmPanel({ message });
      const handle = this.openAskLayer(panel, () => resolve(false), opts?.signal, '⏹ 已取消确认');
      panel.onFinish = (confirmed) => {
        handle.close();
        resolve(confirmed);
      };
    });
  }

  /** 单选：SelectPanel 浮层（Enter → value / Esc → ''；ui-core 校验不在集保守值同收 ''） */
  select(message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      const panel = new SelectPanel({
        title: message,
        options: choices.map((c) => ({ value: c.value, label: c.label })),
        theme: this.theme, // 一次性面板构造期定值（当前主题快照）
      });
      const handle = this.openAskLayer(panel, () => resolve(''), opts?.signal, '⏹ 已取消选择');
      panel.onFinish = (value) => {
        handle.close();
        resolve(value);
      };
    });
  }

  /**
   * 自由文本：input-ask 形——提示行入固定区 + 编辑器转应答车（提交即应答，
   * 弹层抑制）；signal abort → '' 保守值 + 残稿清框 + 撤销说明行（07 §4.3
   * 撤销面——提示行曾在固定区在屏，abort 收口正文流落 ⏹ 行）。
   */
  input(message: string, opts?: UiInputOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      const ask: InputAsk = { message, resolve };
      this.inputAsk = ask;
      this.editor.setText(''); // 应答起始清框（草稿让位——提交路模型自清）
      this.autocompleteCompleter.cancel(); // 应答期弹层抑制：撤窗 + 在途作废
      this.popup.applyResult(null); // 在层即刻收层
      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (this.inputAsk !== ask) return; // 已应答收场——迟到 abort no-op（无说明行）
          this.inputAsk = null;
          this.appendTransientLine('⏹ 已取消提问');
          this.editor.setText('');
          this.autocompleteCompleter.cancel();
          this.popup.applyResult(null);
          resolve('');
          this.touchFixed();
        },
        { once: true },
      );
      this.touchFixed();
    });
  }

  /**
   * 审批：SelectPanel 浮层四值（批准/拒绝/总是批准/取消——Esc 面板保守值 ''
   * 映射 cancel，与 07 §4.3 收口律对齐）；always 草案经 hint 段呈现（回写
   * 归通道核 settleApprovalAlways——本件只呈现与回值）。signal abort 收口
   * 'cancel' 保守值 + 撤销说明行（文案「审批」区分于 input/confirm/select
   * 三件——07 §4.3 撤销面）。
   */
  askApproval(_sessionId: string, request: ApprovalAskRequest, opts?: UiAskOptions): Promise<ApprovalAskAnswer> {
    // _sessionId：会话归属位随批 13b-3 后端面签名携带——TUI 呈现不消费（单屏
    // 焦点态无会话路由需求），SDK 通道后端以此路由 ask 帧
    return new Promise<ApprovalAskAnswer>((resolve) => {
      const title = request.toolName !== undefined ? `⚙ ${request.toolName}：${request.summary}` : request.summary;
      const panel = new SelectPanel({
        title,
        options: [
          { value: 'approve', label: '批准' },
          { value: 'reject', label: '拒绝' },
          { value: 'always', label: '总是批准', hint: request.suggestedEntry },
          { value: 'cancel', label: '取消' },
        ],
        theme: this.theme, // 一次性面板构造期定值（当前主题快照）
      });
      const handle = this.openAskLayer(panel, () => resolve('cancel'), opts?.signal, '⏹ 已取消审批');
      panel.onFinish = (value) => {
        handle.close();
        // 值集即 ApprovalAskAnswer 四值（面板 Esc 收 '' → cancel 映射）
        resolve(value === '' ? 'cancel' : (value as ApprovalAskAnswer));
      };
    });
  }

  /* ---------------- 内部：输入管线 ---------------- */

  /** 输入处理器：decoder 喂入 + lone-ESC 窗定时器（同步直出模式无窗即决） + 事件路由 */
  private readonly handleInput = (chunk: string): void => {
    if (!this.running) return; // stop 后残听防御
    this.decoder.feed(chunk);
    if (this.decoder.hasPendingEscape) {
      if (this.scheduleFn !== null) {
        if (this.escapeHandle === null) {
          this.escapeHandle = this.scheduleFn(() => {
            this.escapeHandle = null;
            this.decoder.settle();
            this.flushDecoderEvents();
          }, this.escapeWindowMs);
        }
      } else {
        this.decoder.settle(); // 同步直出无窗即决（测试语义——单 chunk 喂入不拆序）
      }
    }
    this.flushDecoderEvents();
  };

  /** 排空 decoder 事件队列并逐件路由 */
  private flushDecoderEvents(): void {
    for (const ev of this.decoder.take()) this.routeEvent(ev);
  }

  /**
   * 事件路由四层（07 §4.3 拦截链序）。
   * 层① 全局键先于 overlay（ctrl+c 打断 run——ask 链收口经装配侧信号折入；
   * ctrl+d 仅 overlay 空 + 编辑器空框才全局退出，否则让路面板/编辑器）；
   * 层② overlay 模态独占（未消费键不穿透）；层③ 补全弹层非模态穿透；
   * 层④ 编辑器（未消费键终局丢弃——escape 等无全局绑定）。
   */
  private routeEvent(ev: import('../../engine/types.js').InputEvent): void {
    // 层① 全局键经键位注册表解析（批 10i R5——册单源取代硬编码判键；ctrl+d
    // 的 overlay 在场/编辑器非空让路守卫留在路由层：册只管键匹配、分层消解
    // 归层序——不可覆盖动作无用户改键面）
    if (ev.kind === 'key' && ev.phase === 'press') {
      if (this.keymap.actionMatches(ev, 'global.interrupt')) {
        this.onInterrupt?.(this.sessionId);
        return;
      }
      if (this.keymap.actionMatches(ev, 'global.quit') && this.stack.size === 0 && this.editor.model.isEmpty()) {
        this.onQuit?.();
        return;
      }
    }
    if (this.stack.routeEvent(ev)) return;
    if (this.popup.visible && this.popup.handleEvent(ev)) {
      this.touchFixed(); // 弹层高亮/隐层——固定区重建
      return;
    }
    // 层③.5 应用动作键（批 10i——思考块/工具卡会话级折叠展开；overlay 模态
    // 已在上层独占、补全弹层未消费才达此，编辑器不绑 ctrl+t/ctrl+o 无争键）。
    // 模型循环（挂账解挂批 2026-09-15——ctrl+p）同层入册：柄缺席不劫键不炸
    // （透传编辑器——无绑定归终局丢弃）
    if (ev.kind === 'key' && ev.phase === 'press') {
      if (this.keymap.actionMatches(ev, 'thinking.toggle')) {
        this.toggleThinking();
        return;
      }
      if (this.keymap.actionMatches(ev, 'tools.toggle-expand')) {
        this.toggleToolCards();
        return;
      }
      if (this.onModelCycle !== undefined && this.keymap.actionMatches(ev, 'global.model-cycle')) {
        this.onModelCycle();
        return;
      }
    }
    if (this.editor.handleEvent(ev)) this.touchFixed();
  }

  /**
   * 思考块会话级开关（ctrl+t 批 10i）：transcript 翻态改写已落账块 +
   * screen.repaint 全量重渲（2J 清屏不清 scrollback——已交滚回的旧行物理
   * 不可回改，屏幕面与模型账立即一致；冻结账随 repaint 重置后按新态重建）。
   */
  private toggleThinking(): void {
    this.transcript.toggleThinking();
    this.screen.repaint(this.transcript.snapshot, this.transcript.trimmedBlockCount);
  }

  /** 工具卡会话级开关（ctrl+o 批 10i）——同律：改写 + repaint */
  private toggleToolCards(): void {
    this.transcript.toggleToolCards();
    this.screen.repaint(this.transcript.snapshot, this.transcript.trimmedBlockCount);
  }

  /**
   * 编辑器提交路由：input-ask 应答优先 → 退出词本地拦截 → TUI 本地命令族
   * 拦截 → '/' 命令柄（false 兜底）→ onSubmit。候跑标记随两落点透传（挂账
   * 解挂批 2026-09-15——alt+enter 提交形第三参）。
   */
  private handleSubmit(text: string, opts?: EditorSubmitOptions): void {
    const ask = this.inputAsk;
    if (ask !== null) {
      this.inputAsk = null;
      ask.resolve(text);
      this.autocompleteCompleter.cancel(); // 应答收场：撤窗 + 在途作废（下轮 ask 重开）
      this.popup.applyResult(null); // 应答期抑制的补全层即刻收层
      this.touchFixed();
      return;
    }
    // 退出词先于通道命令分发（前端生命周期词不进通道核命令表——07 §4.1
    // 2026-09-15 /exit 批定形注：本地终局消费，永不兜底进模型消息）
    if (this.maybeHandleExitWord(text)) {
      return;
    }
    // TUI 本地命令族拦截（07 §4.1 命令面增补批——副屏/瞬时交互族同律：
    // 通道命令分发前本地终局消费，webui 面零污染）
    if (this.maybeHandleLocalCommand(text)) {
      return;
    }
    if (text.startsWith('/') && this.dispatchCommand !== undefined) {
      this.dispatchCommand(text)
        .then((handled) => {
          if (!handled) this.onSubmit?.(this.sessionId, text, opts); // 未命中兜底（03 §2.2 驱动侧语义）
        })
        .catch((err: unknown) => {
          // 命令处理器异常不静默不崩进程——呈现面兜底（命令面纪律归命令面）
          this.notify(`命令异常：${String(err)}`, { level: 'error' });
        });
      return;
    }
    this.onSubmit?.(this.sessionId, text, opts);
  }

  /**
   * 退出词拦截：`/exit`（正名）与 `/quit`（别名）恰零参命中即走 onQuit——
   * 与 Ctrl+D 空框同一优雅退出路（07 §4.1 2026-09-15 定形注）。带参形 =
   * 用法 fail-loud 提示不退出；onQuit 柄缺席 = 诚实拒（不虚报律）。
   * 返回 true = 已终局消费（调用位不再下渗）。ask 接管窗由调用序天然
   * 排除（应答优先——'/' 开头文本是应答非命令，既有裁决）。
   */
  private maybeHandleExitWord(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed !== '/exit' && trimmed !== '/quit') {
      // 带参形（/exit xxx）——用法提示后终局消费，不退不出也不兜底进消息
      if (trimmed.startsWith('/exit ') || trimmed.startsWith('/quit ')) {
        this.notify('/exit 不带参数（退出 TUI——与 Ctrl+D 同路优雅退出）', { level: 'warn' });
        return true;
      }
      return false;
    }
    if (this.onQuit === undefined) {
      this.notify('当前通道不支持退出命令（onQuit 柄未接线）', { level: 'warn' });
      return true;
    }
    this.onQuit();
    return true;
  }

  /**
   * TUI 本地命令族拦截（07 §4.1 命令面增补批——/exit 同律不穿透）：`/name`
   * 恰零参命中 → run() 终局；带参形 = 用法 fail-loud 提示后终局（不执行也
   * 不兜底进模型消息）；未命中返 false 落通道命令柄。ask 应答窗由调用序
   * 天然排除（退出词先行同判——'/' 开头文本是应答非命令）。
   */
  private maybeHandleLocalCommand(text: string): boolean {
    const trimmed = text.trim();
    if (this.localCommands.length === 0 || !trimmed.startsWith('/')) return false;
    const stem = (trimmed.split(/\s+/, 1)[0] ?? '').slice(1); // 首 token 去斜杠（词干）
    const spec = this.localCommands.find((command) => command.name === stem);
    if (spec === undefined) return false;
    if (trimmed !== `/${stem}`) {
      // 带参形——用法提示后终局消费，不执行也不兜底进消息
      this.notify(`/${spec.name} 不带参数（${spec.description}）`, { level: 'warn' });
      return true;
    }
    spec.run();
    return true;
  }

  /** 编辑器内容变更：补全层重发查询（尾沿防抖——R6 批 10j）+ 固定区脏位 */
  private handleEditorChange(): void {
    if (this.inputAsk === null) this.autocompleteCompleter.request();
    this.touchFixed();
  }

  /* ---------------- 内部：ask 浮层 ---------------- */

  /**
   * 开 ask 浮层：锚定注册表锚 + signal abort 保守值收口 + 撤销说明行 + 重绘
   * 请求。
   *
   * 「曾在屏者」判据（07 §4.3 语义纪律撤销面——confirm / select / askApproval
   * 三路共用本层，统一处理）：abort 传播到后端呈现时层仍未关（在 overlay 栈
   * 中）= 曾在屏 → 撤销说明行入正文流；面板已 done（onFinish 先关层）后迟
   * 到的 abort 是 no-op，不误写。说明行只标撤销收场本身——保守值收口（与提
   * 问队列收口三则「保守值同撤销面」同源条款：审批项收 'cancel'、阻塞件各
   * 收保守值）由 promise 回值承载，行文不重复。
   */
  private openAskLayer(
    content: OverlayContent,
    abort: () => void,
    signal: AbortSignal | undefined,
    cancelLine: string,
  ): OverlayHandle {
    const handle = this.stack.open(content, this.anchorFor(content));
    signal?.addEventListener(
      'abort',
      () => {
        if (!handle.closed) this.appendTransientLine(cancelLine); // 曾在屏才写——面板 done 后迟到 abort 不误写
        handle.close();
        abort(); // 面板 done 锁下迟到 abort 是 no-op（已应答）
        this.touchFixed();
      },
      { once: true },
    );
    this.touchFixed();
    return handle;
  }

  /** 锚定闭包：读 renderFixed 行账（首帧前回退固定区顶整宽） */
  private anchorFor(content: OverlayContent): OverlayAnchor {
    return (frame) =>
      this.overlayLayout.get(content) ?? { row: 0, col: 0, width: frame.width, height: content.measure(frame.width) };
  }

  /* ---------------- 内部：渲染合并 ---------------- */

  /** present op 入队（连续 present 合并留末次——到达序相对 transient 保持） */
  private enqueuePresent(): void {
    const last = this.pendingOps[this.pendingOps.length - 1];
    if (last !== undefined && last.kind === 'present') this.pendingOps.pop();
    this.pendingOps.push({
      kind: 'present',
      blocks: [...this.transcript.snapshot],
      offset: this.transcript.trimmedBlockCount,
    });
  }

  /** 固定区脏位 + 渲染请求（touch 固定区的统一入口） */
  private touchFixed(): void {
    this.needFixed = true;
    this.requestRender();
  }

  /** 渲染请求（合并位）：同步直出立即 flush；注入调度则 fps 帽下排帧 */
  private requestRender(): void {
    if (!this.running || this.suspendedMain) return; // 挂起闸：渲染请求安全 no-op（停屏期零写出）
    if (this.scheduleFn === null) {
      this.flush();
      return;
    }
    if (this.frameHandle === null) {
      const due = Math.max(0, this.lastFlushAt + this.minFrameMs - this.now());
      this.frameHandle = this.scheduleFn(() => {
        this.frameHandle = null;
        this.flush();
      }, due);
    }
  }

  /** 帧落地：op 队列按到达序执行 + 固定区脏位一帧一次重建 */
  private flush(): void {
    if (!this.running || this.suspendedMain) return; // 挂起闸（防御位——suspendMain 已收在飞帧回调）
    this.lastFlushAt = this.now();
    const ops = this.pendingOps;
    this.pendingOps = [];
    // 帧序真源：present op 的行集是当时的真相（transcript.snapshot 可能已前进）
    let frameBlocks: readonly TranscriptBlock[] = this.transcript.snapshot;
    for (const op of ops) {
      if (op.kind === 'present') {
        frameBlocks = op.blocks;
        this.screen.present(op.blocks, op.offset);
        // 流式帧字节帽（批 10h R1 perf 护栏）：冻结编舞下常态帧为视口量级，
        // 超帽即病理性重排（巨表/超长开栏）——降档纯文本直推，下条消息重试
        //（帽值经选项注入面可测——缺省生产定值，见 streamFrameByteCap）
        if (this.screen.lastSlotFrameBytes > this.streamFrameByteCap) this.transcript.setStreamingPlain();
        // 关槽帧补吐槽期缓冲瞬时行（到达序保持——定稿块之后）
        if (frameBlocks.at(-1)?.kind !== 'streaming') this.drainSlotTransients();
      } else {
        // 槽在场（帧序真源末块）瞬时行缓冲让位（嵌入槽首行位会破槽形）
        if (frameBlocks.at(-1)?.kind === 'streaming') this.slotTransients.push(...op.lines);
        else {
          this.screen.appendTransient(op.lines);
          this.drainSlotTransients(); // 直写后无槽在场——缓冲清空（防御序）
        }
      }
    }
    if (this.needFixed) {
      this.needFixed = false;
      this.renderFixed();
    }
  }

  /** 槽期瞬时行缓冲补吐（无槽在场才吐——调用位已判；防御再判一次） */
  private drainSlotTransients(): void {
    if (this.slotTransients.length === 0) return;
    if (this.transcript.snapshot.at(-1)?.kind === 'streaming') return; // 槽又开（新消息起流）——续缓冲
    const lines = this.slotTransients;
    this.slotTransients = [];
    this.screen.appendTransient(lines);
  }

  /** 状态行转轮自驱定时器（注入调度后自重排；忙态外 tick 零开销） */
  private armTick(): void {
    this.tickHandle = this.scheduleFn!(() => {
      this.tickHandle = null;
      this.tick();
      this.armTick();
    }, TICK_INTERVAL_MS);
  }

  /** 定时器收口（frame/tick/escape 三名） */
  private cancelTimer(which: 'frame' | 'tick' | 'escape'): void {
    const handle = which === 'frame' ? this.frameHandle : which === 'tick' ? this.tickHandle : this.escapeHandle;
    if (handle !== null) this.cancelFn(handle);
    if (which === 'frame') this.frameHandle = null;
    else if (which === 'tick') this.tickHandle = null;
    else this.escapeHandle = null;
  }

  /* ---------------- 内部：主题面（批 10g） ---------------- */

  /** 主题注入长存组件（editor 视图 / 状态行 / 补全弹层——accent 派生样式重建） */
  private injectTheme(): void {
    this.editor.view.setTheme(this.theme);
    this.statusLine.setTheme(this.theme);
    this.popup.setTheme(this.theme);
  }

  /**
   * 换板换装：整体换 theme 引用 + 组件重注入 + 固定区重画（accent 载体全在
   * 固定区/浮层；durable 正文已交 scrollback 物理不可回改——零重排义务）。
   */
  private applyPalette(palette: BuiltinPalette): void {
    this.theme = resolveTheme(palette, this.colorDepth);
    this.transcript.setTheme(this.theme); // 行集换装——后续新建 doc 生效（durable 已交 scrollback 不回改）
    this.injectTheme();
    this.touchFixed();
  }

  /**
   * OSC 串上抛消费（decoder onOsc 接线）：OSC 11 背景色应答 → 明暗裁定换板。
   * 显式档短路（2031 未开、查询未发——防御位）；非 11 码/畸形诚实忽略；同板
   * 零换装（2031 通知的冗余应答与噪声不触发无谓重画）。
   */
  private handleOscReply(data: string): void {
    if (this.themeSetting !== 'auto') return;
    const bg = parseOsc11Reply(data);
    if (bg === null) return;
    const palette = paletteForBackground(bg);
    if (palette.id === (this.theme.dark ? 'dark' : 'light')) return;
    this.applyPalette(palette);
  }

  /* ---------------- 内部：状态面与固定区 ---------------- */

  /**
   * 聚焦事件的固定区消费面：run 启停驱动忙态与 usage 累计（件 6）、工具
   * 执行驱动状态行工具名与进度面板（件 3/5）、tool_execution_end/agent_end
   * 驱动 todo 刷新（件 4）。（执行层事件正文零渲染——07 §4.1 直播路渲染
   * 单源的刻意分立。）
   */
  private applyFocusedEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.statusLine.start();
        this.resetUsage(); // 件 6：归零清行（上一 run 尾注不跨 run）
        this.toolPanel.clear(); // 件 5：瞬时面清板
        this.touchFixed();
        break;
      case 'agent_end':
        this.statusLine.stop();
        // 件 6：落行（与 setStatus 同载体 last-writer-wins）
        this.statusLine.setStatus(`✓ 用量 ${formatTokenCount(this.usageTotal.totalTokens)}`);
        this.toolPanel.clear();
        this.refreshTodo(); // 件 4：刷新三时点之三
        this.touchFixed();
        break;
      case 'tool_execution_start':
        this.statusLine.setTool(event.name);
        this.toolPanel.begin(event.toolCallId, event.name); // 件 5：建档不建行
        this.touchFixed();
        break;
      case 'tool_execution_end':
        this.statusLine.setTool(null);
        this.toolPanel.end(event.toolCallId); // 件 5：end 即摘行
        this.refreshTodo(); // 件 4：刷新三时点之二（写后即显）
        this.touchFixed();
        break;
      case 'tool_execution_update':
        this.toolPanel.applyUpdate(event.toolCallId, event.update); // 件 5：首 update 建行
        this.touchFixed();
        break;
      case 'message_end':
        // 件 6 数据源：assistant 消息终值暂存（累加时点 turn_end——一 turn 恰
        // 一 assistant 消息，两时点等价；spec 条款按本仓轻载荷形取 message_end 面）
        if (isStandardMessage(event.message) && event.message.role === 'assistant') {
          this.pendingUsage = event.message.usage;
        }
        break; // 正文换装已走直播路——固定区零扰动
      case 'turn_end':
        this.accumulateUsage(); // 件 6：累加时点（非呈现时点）
        break;
      default:
        break; // 消息族其余/turn 族其余不触固定区
    }
  }

  /** usage 归零清行（agent_start / repaint——件 6 清账重计条款） */
  private resetUsage(): void {
    this.pendingUsage = null;
    this.usageTotal = ZERO_USAGE;
    this.statusLine.setStatus('');
  }

  /** turn_end 累加（暂存的 assistant 用量并入 run 级账本；cost 在场累货币额） */
  private accumulateUsage(): void {
    const pending = this.pendingUsage;
    if (pending === null) return;
    this.pendingUsage = null;
    const prev = this.usageTotal;
    this.usageTotal = {
      input: prev.input + pending.input,
      output: prev.output + pending.output,
      cacheRead: prev.cacheRead + pending.cacheRead,
      cacheWrite: prev.cacheWrite + pending.cacheWrite,
      totalTokens: prev.totalTokens + pending.totalTokens,
      cost: prev.cost + (pending.cost?.total ?? 0),
      currency: prev.currency ?? pending.cost?.currency ?? null,
    };
  }

  /** todo 面板刷新（todoFor 注入缺席 = 面板缺席零变化——件 4 条款） */
  private refreshTodo(): void {
    if (this.todoFor === undefined) return;
    this.todoPanel.update(this.todoFor(this.sessionId));
  }

  /**
   * 件 7 进度态按会话净计数（任一会话在飞即忙——终端标签页注意力模型）：
   * agent_start +1 / agent_end -1，均按信封 sessionId 归账、clamp ≥ 0（进程
   * 内事件无错过窗——clamp 只防重复 end 不穿底；归零删条目）。聚焦位不参
   * 账（07 件 7 判据勘正——事件时刻聚焦位分两路在切焦场景与主句背离）。
   * 忙闲迁移才写 progress 序列（同态静默——周期重发归 osc 保活自持）。
   * stop 后静默短路（终退不再写字节）。
   */
  private trackProgress(env: SessionEnvelope): void {
    if (!this.running) return; // 停后残事件防御——与 requestRender 同闸
    const { event } = env;
    if (event.type === 'agent_start') {
      this.inFlightBySession.set(env.sessionId, (this.inFlightBySession.get(env.sessionId) ?? 0) + 1);
    } else if (event.type === 'agent_end') {
      // clamp ≥ 0：净计数不越零（重复 end 不累积负账）；归零删条目
      const next = Math.max(0, (this.inFlightBySession.get(env.sessionId) ?? 0) - 1);
      if (next > 0) this.inFlightBySession.set(env.sessionId, next);
      else this.inFlightBySession.delete(env.sessionId);
    } else {
      return; // run 启停族之外零扰动
    }
    let busy = false;
    for (const count of this.inFlightBySession.values()) {
      if (count > 0) {
        busy = true;
        break;
      }
    }
    if (busy !== this.progressBusy) {
      this.progressBusy = busy;
      this.osc.setProgress(busy);
    }
  }

  /**
   * 固定区 v2 重建（自上而下段序）：overlay 段（各层量高叠放 + 锚定注册表
   * 行账）→ todo 面板（件 4——todoFor 缺席/空表即零行）→ input-ask 提示行
   * → 补全弹层 → 编辑器（动态量高；聚焦态 = 无 overlay 占焦）→ 工具进度
   * 面板（件 5——与状态行分职互补相邻）→ 状态行。编辑光标经 EditorView
   * setCursor 声明 → MainScreen.setFixed 声明位落 cup。
   */
  private renderFixed(): void {
    const columns = this.io.size().columns;
    const contents = this.stack.contents;
    const overlayHeights = contents.map((c) => c.measure(columns));
    const overlayHeight = overlayHeights.reduce((sum, h) => sum + h, 0);
    const todoHeight = this.todoPanel.measure(columns);
    const askHeight = this.inputAsk !== null ? 1 : 0;
    const popupHeight = this.popup.visible ? this.popup.measure(columns) : 0;
    const editorHeight = this.editor.measure(columns);
    const toolHeight = this.toolPanel.measure(columns);
    const total = overlayHeight + todoHeight + askHeight + popupHeight + editorHeight + toolHeight + 1;
    const grid = new CellGrid(columns, total);
    let row = 0;

    // 段一：overlay 段（栈序自上而下叠放；锚定注册表即本段行账）
    for (let i = 0; i < contents.length; i++) {
      const height = overlayHeights[i]!;
      this.overlayLayout.set(contents[i]!, { row, col: 0, width: columns, height });
      contents[i]!.render(grid, { row, col: 0, width: columns, height });
      row += height;
    }

    // 段二：todo 面板（件 4——输入框上方紧凑面板；清板即零行）
    if (todoHeight > 0) {
      this.todoPanel.render(grid, { row, col: 0, width: columns, height: todoHeight });
      row += todoHeight;
    }

    // 段三：input-ask 提示行（应答期编辑器转应答车的引导位）
    if (this.inputAsk !== null) {
      grid.writeText(row, 0, `? ${this.inputAsk.message}`, { dim: true });
      row += 1;
    }

    // 段四：补全弹层（可见才占位——非模态浮层）
    if (this.popup.visible) {
      this.popup.render(grid, { row, col: 0, width: columns, height: popupHeight });
      row += popupHeight;
    }

    // 段五：编辑器（overlay 占焦期非聚焦——边框普通态 + 不抢光标声明）
    this.editor.setFocused(this.stack.size === 0);
    this.editor.render(grid, { row, col: 0, width: columns, height: editorHeight });
    row += editorHeight;

    // 段六：工具进度面板（件 5——正在流 partial 的工具各占一行；清板即零行）
    if (toolHeight > 0) {
      this.toolPanel.render(grid, { row, col: 0, width: columns, height: toolHeight });
      row += toolHeight;
    }

    // 段七：状态行（固定区末行）
    this.statusLine.render(grid, { row, col: 0, width: columns, height: 1 });
    this.screen.setFixed(grid);
  }

  /** 硬退复原钩子（仅真 ProcessTerminalIO——注入 io 零污染；Engine 同形） */
  private armExitRestore(): void {
    if (!(this.io instanceof ProcessTerminalIO)) return;
    this.disarmExitRestore?.();
    const restore = (): void => {
      try {
        this.io.write(LEAVE_MAIN);
        // 2031 复原（七役扫描批 A2——复原对称律）：终端私有模式不随进程退出
        // 自复位，stop 既写关则硬退钩同写关、复原面不得留单边缺口。条件与
        // stop() 同形（auto 档才开过订阅）；挂起态本钩已解除（suspendMain
        // disarm——副屏自担其屏复原），无须 stop() 的 suspendedMain 分闸
        if (this.themeSetting === 'auto') this.io.write(THEME_CHANGE_DISABLE);
        this.io.setRawMode(false);
        this.osc.restore(); // 件 7：硬退复原两写点（title 基线 + 进度清零——与 stop 同收口）
      } catch {
        // 复位尽力而为——退出路径不允许二次异常
      }
    };
    process.on('exit', restore);
    this.disarmExitRestore = () => {
      process.removeListener('exit', restore);
      this.disarmExitRestore = null;
    };
  }
}

/**
 * 摘要行 ANSI 序列化：行首段（档位符号 + 会话短 id）着会话区分色——
 * 非 accent 家族的第二着色位（07 §4.1 呈现面件 9），label 段裸文本。
 */
function summaryToAnsi(line: SummaryLine): string {
  const head = `${line.symbol} ${line.shortId}`;
  return buildSgr({ fg: sessionColor(line.shortId) }) + head + SGR_RESET + ` ${line.label}`;
}
