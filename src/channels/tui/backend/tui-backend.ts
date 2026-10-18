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
 *   丢弃）；提交路由：input-ask 应答优先 → 退出词本地拦截（/exit
 *   ——07 §4.1 /exit 批，先于通道命令分发；/quit 别名已随 2026-09-21 三反馈
 *   批A 退役）→ '/' 起手命令柄（false 落
 *   onSubmit 兜底——03 §2.2 驱动侧语义归 conversation）→ onSubmit；
 * - **固定区 v2 动态布局**（自上而下——V-4 注⑪① 笔3 定序 + 2026-10-08 TUI
 *   对标 Codex 五件批 D 件应答段底部迁移〔07 §4.3 呈现位翻档 + V-3 注⑦ ⑤
 *   底栈扩段对端注〕）：todo 面板（件 4）→ 任务状态行（件 12）→ 排队常驻
 *   面板 → 编辑器（动态量高 + 光标声明——setFixed 声明位落 cup）→ 补全弹层
 *   （2026-10-10 Codex 样式复刻批 R-6 弹出位翻档——自编辑器上方迁编辑器
 *   下方，段五.四；梯末位牺牲序不变）→ **应答段**（input-ask 提示行
 *   + overlay 面板栈常规组〔confirm/select 浮层——自屏顶迁编辑器下方；
 *   审批面板已随件 B〔2026-10-16 用户三反馈〕再迁底栈带〔段八之一.五〕；
 *   栈序叠放，锚定自由定位路已整域清退〔fx2-D +
 *   第五役 F3 一刀清〕；视口帽收口 fx2-B；占焦模态律与键路由不变——呈现
 *   位迁移非交互语义迁移〕，在场才占行）→ 工具进度面板（件 5——与状态行
 *   分职互补相邻）→ 状态行底栏三行栈（行1 仪表 + 行2 环境，1-2 行）→
 *   审批组（件 B——ApprovalPanel 呈现带，与 JobPanel 同带相邻）→ 后台
 *   任务面板（注⑪① 行3——迁最底行）；
 * - **渲染合并**：调度注入后 op 队列合并（连续 present 留末次、transient
 *   到达序保持、固定区脏位重建一帧一次）+ fps 帽 60 + tick 80ms 自重排
 *   驱动任务行转轮；**无注入调度 = 同步直出**（测试语义——合并与自驱 tick
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
 * 装配不复刻呈现）；选区 OSC 52 复制已随 mu-2 批落（/history 与 /memory
 * 副屏 onCopy 同柄装配——挂账解挂批①对齐补齐 memory 面）。
 */
import type { AgentEvent } from '../../../agent/index.js';
import {
  formatClockHM,
  isStandardMessage,
  runRecapLine,
  type AgentMessage,
  type Usage,
} from '../../../contracts/index.js';
import type {
  ApprovalAskAnswer,
  ApprovalAskRequest,
  NotifyLevel,
  SessionEnvelope,
  TodoItem,
  UiAskOptions,
  UiBackend,
  UiCallLedgerEntry,
  UiClipboardResult,
  UiForkEditAnchor,
  UiForkEditReceipt,
  UiInputOptions,
  UiSelectChoice,
  UiSessionDeleteResult,
  UiSessionArchiveResult,
  UiSessionListView,
  UiSessionPreviewLine,
  UiSessionSummary,
  UiUsageSummary,
  UiRewindEntry,
  UiRewindActions,
} from '../../types.js';
import { foldErrorText } from '../../service.js';
import {
  CellGrid,
  InputDecoder,
  ProcessTerminalIO,
  ellipsize,
  sanitizeDisplayText,
  stringWidth,
  truncateToWidth,
  wrapText,
  type RgbChannels,
  type TerminalIO,
} from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import {
  dialogueBlockCount,
  HISTORY_PAGE_MESSAGES,
  LiveTranscript,
  shortIdOf,
  sliceHistoryWindow,
  type ApprovalDecisionLineInput,
  type AskDecisionLineInput,
  type ModelChangeLineInput,
  type NoticeLineInput,
  type ReviewLineInput,
  type TodoSnapshotLineInput,
  type TranscriptBlock,
} from './transcript.js';
import { OscDisplay, buildOsc52Copy, buildOsc52CopyDcs, detectNotifyCarrier, sanitizeNotifyText } from './osc.js';
import { allocateFixedBudget, EDITOR_MIN_HEIGHT, fixedBudgetRows } from './fixed-budget.js';
import { StatusLine } from '../status/status-line.js';
import { TaskStatusLine } from '../status/task-status-line.js';
import { createStreamingTokenEstimator } from '../status/streaming-token-estimator.js';
import { TodoPanel } from '../panels/todo-panel.js';
import { ToolProgressPanel } from '../panels/tool-progress-panel.js';
import { JobPanel, type GoalPanelRow } from '../panels/job-panel.js';
import { JobsViewer } from '../panels/jobs-viewer.js';
import type { JobEntry } from '../../../contracts/index.js';
import {
  builtinPalette,
  detectColorDepth,
  overlayBoard,
  paletteForBackground,
  parseOsc11Reply,
  resolveTheme,
  type ColorDepth,
  type ColorEnv,
  type PartialSemanticPalette,
  type ResolvedTheme,
  type ThemeBoard,
  type ThemeSetting,
} from '../theme/index.js';
import { buildSgr, capAnsiLine, cup, SGR_RESET } from './ansi-rows.js';
import { sanitizeLineText } from '../blocks/tool-card.js';
import { toolFaceZh } from '../../../contracts/index.js';
import { keyEventToBinding, Keymap, type ActionView, type KeybindingRejection } from '../keys/registry.js';
import { LEADER_WINDOW_MS, resolveLeaderIntent, type LeaderBranch, type LeaderIntent } from '../keys/leader.js';
import { Editor, type EditorSubmitOptions } from '../editor/editor.js';
import { editorHeightCap } from '../editor/height-cap.js';
import { runExternalEditor, type ExternalEditorOutcome } from '../editor/external-editor.js';
import { spawnSync } from 'node:child_process';
import { OverlayStack, type OverlayContent, type OverlayHandle } from '../overlay/overlay.js';
import { AltScreenHost, type AltScreenPrimary } from '../overlay/alt-screen.js';
import { HistoryViewer, SELECTION_CAP_BYTES } from '../history/history-viewer.js';
import { SessionPicker } from '../history/session-picker.js';
import { HelpViewer, type HelpCommandEntry } from '../panels/help-viewer.js';
import { CallsViewer } from '../panels/calls-viewer.js';
import {
  contextRemainingPercent,
  formatCount,
  formatTokensCompact,
  formatTokensPerSecond,
  UsageViewer,
} from '../panels/usage-viewer.js';
import { gitHeadSuffix, readGitHead, type GitHeadInfo } from '../status/footer.js';
import { computeBranchStats, type GitQuery } from '../status/branch-stats.js';
import { planNativeClipboard, type NativeClipboardSpawn } from './native-clipboard.js';
import {
  clipboardImageReadUnsupportedReason,
  COMPOSER_IMAGE_PLACEHOLDER,
  PASTE_IMAGE_MAX_STAGED,
  pastedImagePath,
  readImageFilePayload,
  splitImageMarkerLines,
  type ClipboardImagePayload,
  type ClipboardImageReader,
} from './clipboard-image.js';
import type { ImageRefContent } from '../../../contracts/index.js';
import { StatusViewer, type StatusPanelData } from '../panels/status-viewer.js';
import { DebugViewer, type DebugPanelData } from '../panels/debug-viewer.js';
import { GuideViewer, type GuidePanelData } from '../panels/guide-viewer.js';
import {
  FeedbackViewer,
  renderFeedbackDiagnosticReport,
  scanFeedbackErrors,
  type FeedbackScreenSources,
} from '../panels/feedback-viewer.js';
import { SkillsViewer, type SkillListEntry } from '../panels/skills-viewer.js';
import { ThemePicker, type ThemePickEntry } from '../panels/theme-picker.js';
import { ThinkingPicker, type ThinkingPickEntry } from '../panels/thinking-picker.js';
import { ModelPicker, type ModelPickEntry } from '../panels/model-picker.js';
import { RewindPicker } from '../panels/rewind-picker.js';
import { SandboxPicker, type SandboxPickEntry } from '../panels/sandbox-picker.js';
import { DiffViewer, type DiffProjectionMessage } from '../panels/diff-viewer.js';
import { MarketPicker, type MarketPanelActions, type MarketPanelModel } from '../panels/market-picker.js';
import { SetupWizardPanel } from '../panels/setup-wizard.js';
// ⚙ 头符单源（panel-chrome 符号册——askApproval 审批标题消费位；history-viewer 同形跨目录先例）
import { HEAD_MARKS } from '../panels/panel-chrome.js';
import type { WizardPrompter } from '../../wizard-prompter.js';
import { MemoryViewer, type MemoryViewerDataDeps } from '../memory/memory-viewer.js';
import { ApprovalPanel, ConfirmPanel, SelectPanel, type ViewportCapAware } from '../overlay/select-confirm.js';
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

/** 进程信号 seam（挖掘 41 轮件 III——ctrl+z SIGTSTP 真挂起可测注入面） */
export interface ProcessSignalsSeam {
  /** 平台名（win32 守卫判据——SIGTSTP 非 Windows 语义，键消费不生效） */
  readonly platform: string;
  /** 本进程 pid（自发 SIGTSTP——self-pid 不轰进程组，exec 工具子进程续跑） */
  readonly pid: number;
  /** 发信号（自发合法——ISIG 只辖内核代产生；tmux 内 SIGTSTP 由 tmux 转发 leaf 同形） */
  kill(pid: number, signal: string): void;
  /** 订阅信号（返退订——SIGCONT 单次消费纪律的收柄面） */
  on(signal: string, cb: () => void): () => void;
}

/**
 * 进程信号 seam 缺省真身（真 process 最小面封装——41 轮件 III）：测试注入
 * MemorySignals 收账（MemoryTerminalIO 测试面零真进程纪律——externalEditor
 * seam 同例）。
 */
function makeProcessSignals(): ProcessSignalsSeam {
  return {
    platform: process.platform,
    pid: process.pid,
    kill: (pid, signal) => process.kill(pid, signal as NodeJS.Signals),
    on: (signal, cb) => {
      process.on(signal, cb);
      return () => process.removeListener(signal, cb);
    },
  };
}

/** 后端构造选项 */
export interface TuiBackendOptions {
  /** 当前交互会话位（提交/打断柄的 sessionId 机器位——装配焦点联动可改） */
  readonly sessionId?: string;
  /**
   * 装配向接线柄（07 §4.3 两柄）：提交（非命令形文本——驱动 conversation）。
   * 第三参候跑标记（挂账解挂批 2026-09-15——alt+enter 提交形）：随
   * SubmitOptions.queueFollowUp 同义透传（busy 期排队候 run 终态种子新 run）。
   * 第四参剪贴板图（TUI 剪贴板图片直贴批——ctrl+v 直贴/路径变体面两路共出）：
   * 受理链铸形的 image-ref 引用块族（image-only 合法——空文本不铸空块）；
   * 缺席/空数组 = 纯文本旧形零漂移。
   */
  readonly onSubmit?: (
    sessionId: string,
    text: string,
    opts?: EditorSubmitOptions,
    images?: readonly ImageRefContent[],
  ) => void;
  /** 装配向接线柄：打断当前 run（ctrl+c——run 打断经装配侧折入 ask 链收口） */
  readonly onInterrupt?: (sessionId: string) => void;
  /**
   * 装配向接线柄：模型循环（挂账解挂批 2026-09-15——ctrl+p 层③.5 应用动作
   * 路）。缺席 = 键不劫持不炸（透传编辑器——无绑定归终局丢弃）。
   */
  readonly onModelCycle?: () => void;
  /**
   * 装配向接线柄：档位模式循环（2026-10-05 ZCode TUI 对标批——shift+tab
   * 层③.5 应用动作路，ctrl+p onModelCycle 同构接法）。语义 = 沙箱档位模式
   * 循环前进（数据源与 footer 行1 模式词同源单源——装配闭包现取 fold 现值）；
   * 缺席 = 键不劫持不炸（透传编辑器——无绑定归终局丢弃）。
   */
  readonly onModeCycle?: () => void;
  /**
   * 装配向接线柄：闲态教学键（V-3 注⑦④——`?` 开 /help 帮助副屏）。`?` 是
   * 可打印字符走 text 事件（引擎地面态——key 路恒不命中；键位册条目仅投影
   * 可发现性）；门控 = 空稿 + 闲态 + overlay/弹层不在场；柄缺席不劫键（'?'
   * 作普通字符入稿——确定性测试基线零扰动）。
   */
  readonly onHelpShortcut?: () => void;
  /**
   * 装配向接线柄：leader 前缀键分支（B4——2026-10-05 ZCode TUI 对标批：
   * ctrl+x 待续窗内裸字母 b/m/h 分发）。分支语义 = 装配位命令 dispatch 单源
   *（jobs/model 查 localCommands 表、help 与 `?` 教学键同一开屏本体——
   * backend 不自持面板路由）；缺席 = 族不激活（ctrl+x 透传编辑器——无绑定
   * 归终局丢弃，不劫键不炸）。ctrl+x 硬编码不可配置（键串文法不扩）。
   */
  readonly onLeaderBranch?: (branch: LeaderBranch) => void;
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
  /**
   * 后台任务面板数据源（界面美化役批6——UX 批6 A 件）：running 闭包供固定
   * 区段快照（帧首拉取 + job_settled 推送锚）、list 闭包供 /jobs 副屏全量
   * 清单（运行中 + 近期终态）。注入缺席 = 面板缺席零变化（既有装配/测试零
   * 扰动）；backend 零 subagent/scheduler/goal 触感——数据面全经装配注入
   * （Job 注册表投影，28 席 DAG 零新边）。
   */
  readonly jobs?: {
    readonly running: () => readonly JobEntry[];
    readonly list: () => readonly JobEntry[];
  };
  /**
   * 排队常驻面板数据源（2026-10-05 ZCode TUI 对标批——07 §4.1 装配向接线
   * 排队常驻面板翻档注）：聚焦会话在队件预览串 pull 闭包（真源 = driver
   * 只读队列观察 peekWaiting——数据面全经装配注入，backend 零 conversation
   * 触感）；帧首拉取（jobs 同路——run 边界与提交帧锚自然收敛即时刷新）。
   * 注入缺席 = 段缺席零变化（既有装配/测试零扰动）；null / undefined /
   * 空数组同义 = 面板退场（队列清空即退场条款的供数形）。
   */
  readonly queueFor?: (sessionId: string) => readonly string[] | null | undefined;
  /**
   * 弹回排队末条数据源（挖掘 47 轮件 A——07 §4.1 装配向接线收回半环）：
   * 聚焦会话弹回末条可弹件全文投影（真源 = driver popWaitingLast——纯
   * 文本 user 件尾出，操控件/图片件跳过）；数据面全经装配注入，backend
   * 零 conversation 触感。注入缺席 = 功能关（alt+↑ 落编辑器终局零扰动）。
   */
  readonly queuePopLast?: (sessionId: string) => string | null;
  /**
   * shell 直达执行柄（挖掘 47 轮件 B——07 §4.1 shell 直达条款）：`!` 起头
   * 提交的路由去向（剥 `!` 后的命令串）；执行与回执归 host 装配
   * （direct-shell 机制件——spawn/notify/cwd 全宿主域）。注入缺席 = 诚实拒
   * （「当前界面不支持」warn——不兜底进模型消息）。判态路由在 backend、
   * 执行面零 backend 触感（mechanism-policy 分离）。
   */
  readonly runDirectShell?: (command: string) => void;
  /**
   * 审批决策折面数据源（挖掘 31 轮 [1]——回看/投影重建路决策行）：聚焦会话
   * durable 审批对 fold 投影（载体 = backend 闭包注入——UiBackend 公开面
   * openHistory 签名零改）；呈现谓词滤除（isUserApprovalDecision）在装配
   * 注入位单源执行，backend 收到的已是呈现子集。注入缺席 = 重建路零决策
   * 行（直播腿总线追加不受影响）零变化。
   */
  readonly approvalDecisionsOf?: (sessionId: string) => readonly ApprovalDecisionLineInput[];
  /**
   * todo 快照读面（挖掘 35 轮 B8——todo/write 转录轨迹数据源）：[{seq,
   * items}] 升序全序列（collectTodoSnapshots 产物映射——收集位不做闸，闸
   * 单源在 transcript 消费位）；直播腿 tool_execution_end 拉取迭代过闸
   * （全序列幂等）+ 重建腿 onRepaint/openHistory 随投影传参两路共用。注入
   * 缺席 = 快照块零变化（兼容锁——旧装配/测试零扰动）。
   */
  readonly todoSnapshotsOf?: (sessionId: string) => readonly TodoSnapshotLineInput[];
  /**
   * 模型切线读面（挖掘 52 轮件 B——回看/投影重建路切线块数据源）：[{seq,
   * model}] 升序全序列（collectModelChanges 产物——坏形防御跳过已在收集位，
   * backend 收到干净子集）；重建腿 onRepaint/openHistory 随投影传参两路共用。
   * 注入缺席 = 切线块零变化（兼容锁——旧装配/测试零扰动；直播腿总线追加
   * 不受影响）。
   */
  readonly modelChangesOf?: (sessionId: string) => readonly ModelChangeLineInput[];
  /**
   * 宿主通知读面（挖掘 53 轮件 C——回看/投影重建路通知块数据源）：[{seq,
   * level, text}] 升序全序列（collectSessionNotices 产物——坏形防御跳过已在
   * 收集位，backend 收到干净子集）；重建腿 onRepaint/openHistory 随投影传参
   * 两路共用。注入缺席 = 通知块零变化（兼容锁——旧装配/测试零扰动；直播腿
   * 经 appendNoticeLine 直灌不受影响）。
   */
  readonly noticesOf?: (sessionId: string) => readonly NoticeLineInput[];
  /**
   * 评审 findings 读面（35 池件 9——回看/投影重建路评审卡数据源）：[{seq,
   * findings}] 升序全序列（collectSessionReviews 产物——坏形两级防御跳过已在
   * 收集位，backend 收到干净子集）；重建腿 onRepaint/openHistory 随投影传参
   * 两路共用。注入缺席 = 评审卡零变化（兼容锁——旧装配/测试零扰动；直播腿
   * 经 appendReviewLine 直灌不受影响）。
   */
  readonly reviewsOf?: (sessionId: string) => readonly ReviewLineInput[];
  /**
   * 外部编辑器执行器（挖掘 31 轮 [9]——ctrl+g 挂起交出形，codex
   * external_editor 对标）：seed = 当前草稿全文，返结局三态（edited /
   * missing-editor / failed）由 backend 分诊（edited 走 editor.setText 整替、
   * 余两态就地 notify 呈报）。缺席 = 生产缺省闭包
   * runExternalEditor(seed, process.env)（**调时取 env 现值**非 import 时
   * 绑定）；测试装配注入受控桩（MemoryTerminalIO 测试面零真进程纪律）。
   */
  readonly externalEditor?: (seed: string) => Promise<ExternalEditorOutcome>;
  /**
   * tmux 子进程执行器（挖掘 38 轮件 A——OSC 52 tmux 三层分诊）：args +
   * 可选 stdin 文本 → { status, stdout }。缺省真身封装 spawnSync（stdout
   * **trim 归一在封装内**——spawnSync 输出带尾随换行，分诊比较裸值
   * 'on'/'external'/'off'；**5s 帽 + SIGKILL**——59 轮件 D-2，死 socket
   * 悬挂不冻结整屏）；测试装配注入受控桩（MemoryTerminalIO 零真
   * 进程纪律——externalEditor seam 同例）。
   */
  readonly tmuxSpawn?: (args: readonly string[], input?: string) => { status: number; stdout: string };
  /**
   * git 只读查询注入（挖掘 39 轮件 II——⎇ 槽 +N/−M 异步统计腿）：args +
   * cwd → { status, stdout } | null（null = git 不在场/超时）。**缺席 = 统计
   * 腿整体缺席**——⎇ 槽维持支名@短哈希现状零行为变（测试基线零真进程纪
   * 律；生产装配显式传 createDefaultGitQuery() 真身——GIT_OPTIONAL_LOCKS=0
   * 只读档 + 10s 超时 kill + stdout trim 归一在封装内）。
   */
  readonly gitQuery?: GitQuery;
  /**
   * 进程信号 seam（挖掘 41 轮件 III——ctrl+z SIGTSTP 真挂起）：platform /
   * pid / kill / on 最小面，缺省真 process 封装（makeProcessSignals 工厂）；
   * 测试注入受控桩收账（MemoryTerminalIO 测试面零真进程纪律——externalEditor
   * seam 同例）。
   */
  readonly processSignals?: ProcessSignalsSeam;
  /**
   * 本地原生剪贴板执行器（挖掘 40 轮件 A——copyToClipboard 第⓪层原生腿）：
   * 平台矩阵计划 + 文本 → 'ok' | 'failed'。**缺席 = 原生腿整体缺席**——
   * 分诊直落三层终端介导原序零行为变（测试基线零真进程纪律；生产装配
   * 显式传 createDefaultNativeClipboardSpawn() 真身——wl-copy detach 形
   * 与确认形分派在封装内）。
   */
  readonly nativeClipboardSpawn?: NativeClipboardSpawn;
  /**
   * 剪贴板图片读器 seam（TUI 剪贴板图片直贴批——ctrl+v 直贴读链）：
   * () → base64 载荷或 null（null = 无图/无命令/读失败/超时四静默形合流——
   * 调用方零弹错零入稿）。**缺席 = ctrl+v 键不劫持零行为变**（测试基线零真
   * 子进程纪律；生产装配显式传 createClipboardImageReader() 真身——平台矩阵
   * 计划 + spawn 2s 超时帽 + 临时 PNG 用后即删，nativeClipboardSpawn 同形）。
   */
  readonly clipboardImageReader?: ClipboardImageReader;
  /**
   * 读链平台支持回执缝（56 轮件 1a——win32 空集显式化）：() → 回执词或
   * null（null = 走读链四静默形域）。缺省闭包 = clipboardImageReadUnsupported-
   * Reason(process.env, process.platform) **调时读现值**（planNativeClipboard
   * 同律）；非 null 时 ctrl+v 在 spawn 前即 notify info 呈报（「此平台暂不
   * 支持读剪贴板图」——07 §4.1 R5 读链面 56 轮件 1a 翻档补注）。测试注入
   * 受控桩（平台矩阵外环境可驱动 notify 路锁——processSignals.platform 同理）。
   */
  readonly clipboardImageUnsupportedReason?: () => string | null;
  /**
   * 图片受理缝（TUI 剪贴板图片直贴批——ctrl+v 直贴与路径变体面共消费）：
   * 载荷清单 → image-ref 引用块族。真身 = host 装配闭包 admitPasteImages
   * （受理链单源：能力门→数量帽→base64→字节帽→魔数→MIME→尺寸→内容寻址
   * 落盘——webui-bridge submitPrompt 同构）；**拒形上抛**（AttachmentIntake
   * RejectionError 用户面中文文案）由 backend 分诊：ctrl+v 路就地 notify 呈报
   * （显式图片意图）、路径变体面静默回退原文本粘贴。channels 不 import host
   * （28 席 DAG）——载荷/引用块均结构类型桥接。**缺席 = 两路整体关**。
   */
  readonly imageIntake?: (images: readonly ClipboardImagePayload[]) => readonly ImageRefContent[];
  /**
   * 持久化史透传（B1——07 §4.1 呈现面件 2 定形注⑦种写双路）：seed = 启动
   * 种子（host 装配根构造期一次 recentTexts〔启动锚根〕满灌——编辑器内存
   * 史跨进程存活位）；onRecord = 写路镜像（编辑器真入册位触发、装配闭包
   * 直写库——ask 应答/退出词/本地命令三叉不达 onSubmit，镜像取编辑器级保
   * 普通形两集恒等；**sensitive 形双跳**（挖掘 37 轮件 3——07 §4.1 两集分
   * 立律）：内存册+持久镜像均不入（编辑器跳 addToHistory、onRecord 携
   * sensitive 位由装配回调自判跳写——第二参）。写失败 best-effort 归闭
   * 包）。缺席 = 纯内存旧形零扰动；数据面全经装配注入（backend/persist
   * 零触感——28 席 DAG 零新边）。
   */
  readonly history?: {
    readonly seed: readonly string[];
    readonly onRecord: (text: string, opts?: { sensitive?: boolean }) => void;
  };
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
   * 主题档（批 10g——07 R2 扩 /themes 批）：dark / light / auto 三内置 +
   * 自定义主题名。auto = start 时 OSC 11 背景查询裁定（无应答自然维持缺省
   * dark 即超时语义）；显式内置档短路零探测；自定义名探测照开（键级回退
   * 基板明暗走探测——探测与文件选择正交）。缺省 dark（注入缺席的确定性
   * 测试基线——与批 10g 前 accent 字节同源）。
   */
  readonly theme?: ThemeSetting;
  /**
   * 动效门（挖掘 35 轮 B2+B4——07 §4.1 呈现面动效门控）：缺省 true；false =
   * 禁用形（转轮退 • dim 静态符 + 忙态 tick 定时器不摆——态变/供数变才触
   * 重绘）。真源 = settings.json `animations` 键 + env
   * `BERRY_AGENT_TUI_ANIMATIONS=0|1` 逐次覆盖（env 胜——tui-entry 装配铸
   * 单值注入本键）。
   */
  readonly animations?: boolean;
  /**
   * 桌面通知门（挖掘 36 轮 notify-osc9——07 §4.1 件 7 第三写点）：缺席或
   * 'off' = 通道整体关闭（零通知字节零合并账——缺席注入律，旧测试/旧装配
   * 零扰动）；生产 tui-entry 恒传（对位——BERRY_AGENT_TUI_NOTIFY 解析值）。
   * 'auto' = 载波探测（detectNotifyCarrier——TERM_PROGRAM 五家 osc9 / TMUX
   * 在场 bel 诚实降级）；'osc9' / 'bel' 明示直用（明示 osc9 且 TMUX 在场 →
   * DCS 包裹透传）。
   */
  readonly desktopNotify?: 'auto' | 'osc9' | 'bel' | 'off';
  /** 载波探测环境快照（TERM_PROGRAM/TMUX——tui-entry 装配时定值注入，colorEnv 同例） */
  readonly notifyEnv?: { readonly TERM_PROGRAM?: string; readonly TMUX?: string };
  /**
   * 触发档白名单（挖掘 37 轮 settings-notify-key——settings 第七键装配注入）：
   * 缺席 = 四档全集（缺席注入律，现行为零变化）；空数组 = 合法显式全静默。
   * 与载波门 desktopNotify 两维分立：载波定「经哪条道发」、本键定「哪些事
   * 值得发」，载波关先于档位短路。档位-事件映射：turn-failed 档辖
   * retry_wait_end 非 resumed 全 outcome 形（含 aborted——揭示延后律下的真
   * 失败终态）；turn-aborted 档仅辖 agent_end status=aborted（同为「中止」
   * 词跨两档）。档位判断单点收口 enqueueNotice（四处入账点前置传档位）。
   */
  readonly notifyTriggers?: readonly NotifyTrigger[];
  /**
   * 自定义主题覆盖表（/themes 批）：theme 值为自定义名时装配位载入注入
   * （loadCustomThemeColors 产物；坏文件装配位 warn 后回退内置档——本键缺席
   * 即内置形）。在场景 = 键级回退基板 OSC 重合成（handleOscReply）+ 探测
   * 编舞照开（「键级回退探测恒在」）。
   */
  readonly customThemeOverlay?: PartialSemanticPalette;
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
   * footer 底栏三行栈供数（V-4 注⑪ 笔3——行1 仪表栈 + 行2 环境栈；今日段
   * 退役迁 /status 副屏〔注⑪⑤〕）：低频值（档位 fold/git 读盘/cwd 查库）
   * 经闭包由本件低频锚缓存（rebuildFooter/refreshFooterGit），活值（累计/
   * 速度/上下文）经供数器渲染期 pull（流中随 tick/触帧直取现值——承
   * TaskStatusProviders 先例）。注入缺席 = 无 footer（状态行旧形零扰动——
   * 确定性测试基线）。
   */
  readonly footer?: {
    /**
     * 档位段 pull 闭包（批B→V-4 注⑪② 翻档三行栈）：mode = 模式词（MODE_
     * SHORT 装配侧换词——计划/Auto/YOLO，行1 首槽坍缩梯恒保位）；thinking/
     * sandbox = 短词/原词两表示（行1 思考槽 / 行2 沙箱原词槽）；子段 null =
     * 独立缩位（诚实缺席）；闭包抛错 fail-open 整段缩位（呈现面不反噬渲染
     * 路）。刷新锚拉取（构造期/切焦/resize/agent_end/档位切换点）。
     * sandboxDanger：沙箱 danger 档标记——行1 模式槽 error 警示色判据。
     */
    readonly tiers?: () => {
      mode: string | null;
      thinking: string | null;
      sandbox: string | null;
      sandboxDanger?: boolean;
    };
    /**
     * 会话累计段 pull 闭包（注⑪②——行1 `累计 N`）：数据面 = 会话全 run
     * token 耗（sessionSpentOf 聚合读面——⑥a）；渲染期活拉；零耗不显段
     * （冷启动零噪声）。
     */
    readonly sessionSpent?: () => number;
    /**
     * 模型初始全形（注⑪②——行1 模型槽）：行1 呈短名 = id 尾段（全形归
     * /status 副屏）；运行期换模经 setFooterModel 活写（ctrl+p 联动回迁）。
     */
    readonly modelLabel?: string;
    /**
     * 目录槽 pull 闭包（注⑪③——行2 首槽）：返回短名（canonicalWorkspaceRoot
     * 尾段）；切焦 cwd 漂移随 onRepaint 低频锚重拉缓存。
     */
    readonly cwdLabel?: () => string;
    /**
     * git 根 pull 闭包（注⑪③——行2 ⎇ 槽）：readGitHead 零子进程直读
     * refs（支名@短哈希）；git IO 只进构造期/onRepaint/会话复起 resumeMain
     * 低频锚三枚（07 注⑪③ 追注定形——复起重画路不触发 onRepaint；不进
     * setStatus 高频锚），结果缓存渲染期纯读。
     */
    readonly gitRoot?: () => string;
  };
  /**
   * goal 持续态数据源（件 G——挖掘 45 轮）：注入缺席 = 段缺席零变化（footer
   * 态词与 JobPanel goal 段两消费面同判此位）；在场时帧首拉取持续态行集
   * （供数器恒返数组，null/undefined 归一空）。
   */
  readonly goalStatus?: () => readonly GoalPanelRow[] | null | undefined;
  /**
   * 流式帧字节帽（批 10h R1 perf 护栏）：缺省 STREAM_FRAME_BYTE_CAP 定值
   * 256KB（只拦病理性整档重排——常态帧为视口量级）。注入面 = 测试语义
   * （生产帽量级下「超帽降档纯文本」触发路径结构性不可测——小帽注入使
   * 降档路可证；缺省行为不变）。
   */
  readonly streamFrameByteCap?: number;
  /**
   * 瞬时行保全账帽（挖掘 26 轮 [10]）：缺省 LANDED_TRANSIENT_CAP 定值
   * （同族帽量级）。注入面 = 测试语义（生产帽量级下裁旧腿结构性不可测——
   * 小帽注入使 FIFO 裁旧可证；缺省行为不变）。
   */
  readonly landedTransientCap?: number;
  /**
   * 会话头卡数据（07 §4.3 R-7——07 §4.1 2026-10-10 Codex 样式复刻批）：
   * 注入在场 = transcript 构造即带 durable 头卡块（值一次定格——version/
   * model/directory 会话装配快照；空串 = 对应行诚实缺席）。注入缺席 =
   * 无头卡旧形（footer 门控同律：既有测试基线零扰动，生产 tui-entry
   * 恒传）。
   */
  readonly sessionHeader?: {
    readonly version: string;
    readonly model: string;
    readonly directory: string;
  };
}

/**
 * 回溯编辑回执编排柄（挖掘 36 轮件 8 回溯 fork 批——session-rewind-fork）：
 * 把通道核 wrapper 的异步回执链接到 backend 动作面（独立导出函数——单测可
 * 锚接缝，不依赖 TuiBackend 实例）。回执路由：
 * - **forked + 空稿** → seed 原文（setText 整替 + syncEmptyGuide 对账一体——
 *   外编回填先例同律）+ 成功 notify（含新会话短 id——fork 血缘呈现位）；
 * - **forked + 草稿非空** → 不覆盖（破坏性保守面——warn 指路保留草稿）；
 * - **failed**（vetoed/error 合并终态）→ 零动作（notify 已由通道核 wrapper
 *   发出——呈现层不重复报）。
 * 不自动提交（提交路归用户 enter——条款②）；图附件不回填（锚 text 纯文本
 * 直拼，诚实缺席）。
 */
export function wireForkEdit(
  core: (anchor: UiForkEditAnchor) => Promise<UiForkEditReceipt>,
  deps: {
    /** 草稿空判（forked 回执的门控位——非空不 seed） */
    readonly draftEmpty: () => boolean;
    /** 原文回填（setText + syncEmptyGuide 对账一体——单动作注入） */
    readonly seed: (text: string) => void;
    /** 呈现通知（成功/指路 warn） */
    readonly notify: (message: string, opts?: { level?: NotifyLevel }) => void;
    /** 会话短 id 单源（血缘注记） */
    readonly shortIdOf: (sessionId: string) => string;
  },
): (anchor: UiForkEditAnchor) => void {
  return (anchor) => {
    void core(anchor)
      .then((receipt) => {
        if (receipt.status !== 'forked') return; // failed——零动作（wrapper 已 notify）
        const shortId = deps.shortIdOf(receipt.sessionId);
        if (!deps.draftEmpty()) {
          deps.notify(`已回溯到新会话 ${shortId}——当前草稿非空，原文未回填（草稿已保留，清空后可重试）`, {
            level: 'warn',
          });
          return;
        }
        deps.seed(anchor.text);
        deps.notify(`已回溯到新会话 ${shortId}——原文已回填，编辑后发送`, { level: 'success' });
      })
      .catch(() => {
        // 回执 promise 自身异常兜底吞（通道核 wrapper 已全 catch——此为防御位：
        // 异步链异常不外溢杀主循环）
      });
  };
}

/** 主屏形进屏模式串：粘贴开 + 焦点开（1004——notify-osc9）+ kitty 推栈（disambiguate+REPORT_ALTERNATE_KEYS 位并 >5u——52 轮件 C）+ 探测哨兵（无光标藏无 1049——与 Engine 全屏形分立） */
const ENTER_MAIN = '\x1b[?2004h' + '\x1b[?1004h' + '\x1b[>5u' + '\x1b[?u' + '\x1b[c';
/** 出屏模式串（与进屏严格对称反序——单源常量；1004 位对称收口） */
const LEAVE_MAIN = '\x1b[<u' + '\x1b[?1004l' + '\x1b[?2004l';
/**
 * DECSTBM 滚动区复位（挖掘 26 轮 [7]）：MainScreen applyScrollRegion 反复写
 * 1;{rows-fixedHeight}r 设区——终端侧状态不随进程退出自复位，出屏不复位则
 * shell 继承 margins（光标在区外 LF 不滚、长输出覆写屏底；tmux pane 退出由
 * tmux 重置幸免，裸终端必现）。复位按 DECSTBM 规范归位光标，调用位随后
 * cup 回屏底（复位不孤写）。
 */
const SCROLL_REGION_RESET = '\x1b[r';
/** OSC 11 背景色查询（BEL 终结形——xterm 主流；auto 档 start 时发） */
const OSC11_QUERY = '\x1b]11;?\x07';
/** 明暗变化通知订阅开/关（CSI ?2031——支持终端主题切换即时跟随、不支持无感） */
const THEME_CHANGE_ENABLE = '\x1b[?2031h';
const THEME_CHANGE_DISABLE = '\x1b[?2031l';

/** 渲染合并帧率帽缺省（对齐 Engine DEFAULT_FPS_CAP——批 10f-3 性能回归锁校准定值 60，实机校准后收紧留批 12） */
const DEFAULT_FPS_CAP = 60;

/**
 * resize 尾随防抖窗（41 轮件 I——codex 同值 75ms）：SIGWINCH 风暴（拖拽期连
 * 发）窗内只认末次事件——纯尾随重置（窗内新事件重开窗，已到期未执行的也顺
 * 延）。权威重建全量重画成本高，逐事件同步重画即旧宽/新宽双卷交错的成因之一。
 */
const RESIZE_DEBOUNCE_MS = 75;

/**
 * tmux 子进程帽（59 轮件 D-2）：defaultTmuxSpawn 的 spawnSync 同步阻塞事件
 * 循环——tmux 常态毫秒级快返，但死 socket 形可挂（server 停摆/套接字残废），
 * 无帽即 TUI 整屏冻结（帧/输入/信号全停）。帽在原生层点火（JS 线程同步阻塞
 * 不影响其计时——tools/spawn-sync-cap.mjs 头注同源谱）；killSignal=SIGKILL
 * 非 SIGTERM（悬挂子进程可忽略 SIGTERM）。
 */
const TMUX_SPAWN_TIMEOUT_MS = 5_000;

/**
 * tmux 子进程缺省真身（件 A 分诊 seam）：spawnSync 阻塞形（复制是用户显式
 * 动作、tmux 子进程毫秒级——codex 同阻塞形）；**stdout trim 归一在此**
 * （spawnSync 输出带尾随换行——'external\n'/'off\n'，分诊比较裸值）。
 * spawn 失败（无 tmux 可执行）/ 帽点被杀 → status -1（分诊落 DCS 降级腿
 * ——死 socket 悬挂 5s 帽强杀后诚实降级，不冻结整屏）。
 */
function defaultTmuxSpawn(args: readonly string[], input?: string): { status: number; stdout: string } {
  const r = spawnSync('tmux', args, {
    input,
    encoding: 'utf8',
    // 5s 帽 + SIGKILL 强杀（59 轮件 D-2）：死 socket 悬挂不冻结整屏；
    // 帽点 r.status=null → 下方 ?? -1 → 分诊落 DCS 降级腿（诚实失败不静默吞）
    timeout: TMUX_SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  return { status: r.status ?? -1, stdout: (r.stdout ?? '').trim() };
}
/**
 * 流式帧字节帽（批 10h——R1 perf 护栏落码定值）：冻结编舞下常态帧 ≈ 视口
 * 行 × 转义开销（24×80 档 < 10KB）；256KB 帽只拦病理性整档重排。超标降档
 * 纯文本（旧路径为降档开关——R1 分句原文），下条 message_start 复位重试。
 */
const STREAM_FRAME_BYTE_CAP = 256 * 1024;
/**
 * 瞬时行保全账帽缺省（挖掘 26 轮 [10]）：账的使命是单次权威重建竞窗不丢
 * （repaint/resize/复起补吐源——bac1320），非历史全保——无帽则长会话随
 * 通知量单调增长且每次重画全账 O(N) 重放渐卡。定值 200 对齐同族帽量级
 * （转录块帽 500/卡体行帽 200/编辑器史帽 100）；FIFO 裁旧（最旧让位）。
 */
const LANDED_TRANSIENT_CAP = 200;
/** lone-ESC 判定窗缺省（对齐 Engine DEFAULT_ESCAPE_WINDOW_MS） */
const DEFAULT_ESCAPE_WINDOW_MS = 30;
/**
 * drainInput 缺省窗（对齐 Engine.drainInput 同源值——07 §4.1 件5 终退排空
 * 行为预算：总帽 1000 / 闲窗 50 承 berry 实证值）。主屏输入管线自持（不经
 * Engine——本件头注），故主屏终退排空由本件自持同舞非借 Engine。
 */
const DRAIN_MAX_MS = 1000;
const DRAIN_IDLE_MS = 50;
/** footer 教学提示闲态文案（V-3 注⑦④——`?` 键投影与 footer 提示同文单源） */
const FOOTER_HINT_TEXT = '? 快捷键';
/**
 * 桌面通知同窗合并窗（挖掘 36 轮 notify-osc9 拍板④）：首入起窗、窗内后续
 * 入账只改账不重挂，到点整条裁决（聚焦弃 / 未聚焦发最高优先级）——轮完成
 * 与审批近邻到达时只扰铃一次（codex pending_notification 同窗合并同参）。
 */
const NOTICE_COALESCE_MS = 250;
/** 排队清单可见预览条数帽（首条计入——挖掘 31 轮 [7]：逐条清单形；超帽折叠尾行） */
const QUEUE_PREVIEW_LIMIT = 3;
/**
 * footer 教学提示忙态文案（07 §4.1 教学位扩双态注 2026-10-05）：忙态空稿
 * （应答进行中输入仍可用）——Enter 追加本轮 / Alt+Enter 排队后继 run 的
 * 键位教学，与闲态文案同位（footer 行 2 教学位）分态呈现。`?` 教学键仍
 * 闲态专属（忙态 `?` 落编辑器是字符——提示面与键位实况对齐，键位门控
 * 不随本批扩忙态）。
 */
const FOOTER_HINT_BUSY_TEXT =
  // 宽度预算（行2 hint 槽与 env 短 id 共存 ≤80 列）：三键教学位全保——
  // 「进行/后继」省 8 列（键名教学为主、语义细节由实操验证；全保形 79 列
  // 在 80 列标准宽与 env 槽共存必被坍缩梯⑧整槽挤丢——教学位先丢律）
  '回复中——输入仍可用：Enter 追加 / Alt+Enter 排队 / Alt+↑ 弹回';
/**
 * footer 教学提示待续态文案（B4——2026-10-05 ZCode TUI 对标批 07 §4.1 定形
 * 注）：ctrl+x 入待续态期间示分支菜单（待续提示随窗定时退场——不搬 ZCode
 * 提示滞留 wart）；三键名与册面复合投影串同文（b 任务 / m 模型 / h 帮助）。
 */
const FOOTER_HINT_LEADER = 'Ctrl+X 已按 · b 任务 · c 复制 · m 模型 · h 帮助';
/**
 * 主屏空态引导行集（07 §4.1 空转写态注 2026-10-05）：零块空稿态转录区引
 * 导——logo 字形随启动动画字形语系（纯文本零 CSI）+ 提示行。与 ob-2 启动
 * 引导面板分职（彼系零凭证 boot 期一次性 cooked 窗，此系就绪后空会话常
 * 态）；呈现归 MainScreen E' 段编舞（本件只持文案与门控）。
 */
const EMPTY_GUIDE_LINES: readonly string[] = ['   _', '  (_)', ' berry-agent', '', ' 输入消息开始对话——? 查看快捷键'];
/**
 * 模型全形 → 短名（V-4 注⑪②——行1 模型槽）：id 尾段（`zai/glm-4.7` →
 * `glm-4.7`；裸 id 自返）。全形呈现归 /status 副屏——footer 只持短名。
 */
function modelShortOf(spec: string): string {
  return spec.split('/').pop() ?? '';
}
/**
 * 任务行转轮自驱间隔（ms——注入调度后自重排；状态行转轮已随 V-3 笔1 退役）。
 * 界面美化役批 4：100ms → 80ms（07 §4.1 件 12——帧距定值；一处常量、
 * 件内零自驱时钟纪律不破）
 */
const TICK_INTERVAL_MS = 80;

/**
 * 行1 速度槽显示节流窗（ms——TUI 对标 Codex 五件批 E 件）：500ms 内速度值
 * 变而显示持旧。**节流位 = 呈现层显示缓存，供数层零降频**（tick 80ms 维持
 * 转轮/耗时现算现拉——只冻结速度槽文本，不冻帧率）；相位切换（流中↔
 * settled）即失效——语义边界不吞首帧。
 */
const SPEED_SLOT_REFRESH_MS = 500;

/**
 * 桌面通知触发档闭集（挖掘 37 轮 settings-notify-key——04 §9 定形块⑥ 第七键
 * 值域单源）：档名对齐规范文案四词语域（轮完成/已中止/失败/等待审批）非事件
 * 名语域。channels 侧单源定义、两级公开面 re-export（tui/index → channels/
 * index），host settings-store 反向 import 消费（ThemeSetting 同形先例）——
 * 禁 host/channels 双源。
 */
export const NOTIFY_TRIGGER_VALUES = ['turn-completed', 'turn-aborted', 'turn-failed', 'approval-waiting'] as const;
/** 触发档类型（NOTIFY_TRIGGER_VALUES 值域推导——settings 第七键值域） */
export type NotifyTrigger = (typeof NOTIFY_TRIGGER_VALUES)[number];

/** notify 档位符号（正文着色纪律——纯符号不配色，与摘要行会话色分立；注⑩：info • 列点位/error ✗ 形） */
const NOTIFY_SYMBOLS: Readonly<Record<NotifyLevel, string>> = Object.freeze({
  info: '•',
  success: '✓',
  warn: '⚠',
  error: '✗',
});

/** 渲染合并 op 两形（repaint/resize 权威重建不走队列——同步直出） */
type PendingOp =
  | {
      readonly kind: 'present';
      readonly blocks: readonly TranscriptBlock[];
      /** 入队时的裁块累计（绝对位对账——enqueue 与 flush 间 trim 可再进，帧内自洽） */
      readonly offset: number;
    }
  | {
      readonly kind: 'transient';
      readonly lines: readonly string[];
      /**
       * 跨权威重建立位（/resume 竞窗根因修——瞬时行两档语义）：true = 保全档
       * （notify 回执 / ask 撤销行 / 取消回执——用户动作回执族，07「曾在屏」
       * 律 + 挂起转账律对称面，repaint/resize 后补吐重放）；false = 当场档
       * （turn 收尾行 / Job 收口行——run 级结算线，切焦重画零复现即消散，
       * 「repaint 不重建」既有测试锁语义）。
       */
      readonly persist: boolean;
    };

/** input-ask 在飞体（提示行呈现 + 提交应答路） */
/** input-ask 应答车缺省占位文（挖掘 29 轮件 4——R-6 占位文族第四位：应答窗
 *  enter 是收窗非提交，composer 缺省「输入消息…」在该窗误导为新消息；值位
 *  白话律（07 §4.4 查四——「应答」工程语不入用户面）） */
const INPUT_ASK_PLACEHOLDER_TEXT = '输入回复…';

interface InputAsk {
  readonly message: string;
  /** 应答车占位文（UiInputOptions.placeholder 透传——挖掘 29 轮件 4 契约死位激活；缺席 = 应答缺省「输入应答…」） */
  readonly placeholder?: string;
  /**
   * 敏感形旗（UiInputOptions.sensitive 透传——挖掘 37 轮件 3）：true = 应答
   * 车点符回显（editor.setSensitive——呈现面等宽掩码）+ 提交路双跳豁免位。
   */
  readonly sensitive?: boolean;
  readonly resolve: (text: string) => void;
}

/**
 * ask 浮层呈现等待体（07 §4.3 提问队列条「异会话 overlay 呈现串行化」定形注
 * ——2026-10-04）：TUI overlay 呈现位全局单槽（跨会话亦单——「用户同一时刻
 * 只答一个问题」的跨会话推广）被占时的候呈记录。confirm/select/askApproval
 * 三路共用；「首次呈现到达序」= 入队序——先呈者占槽至落定（应答/保守值
 * 收场），后到者进呈现等待位、先呈者落定即顶上。
 */
interface AskLayerWaiter {
  /** 浮层内容件（面板——ask 到达即构造，开层延迟到槽获取后） */
  readonly content: OverlayContent;
  /** 保守值收口回调（调用方 promise 的保守 resolve） */
  readonly abort: () => void;
  /** 撤销说明行文案（曾在屏的 abort 收场才写——07 §4.3 撤销面；审批 ask 专属词面，undefined = 阻塞三件形不落瞬时行——挖掘 36 轮 [2] ⏹ 退役） */
  readonly cancelLine: string | undefined;
  /** 本件已落定（应答/撤销收场）——槽释放扫队的败腿锁判据（07 §4.3） */
  settled: boolean;
  /** 已开层的真句柄（null = 尚在等待位——从未在屏） */
  handle: OverlayHandle | null;
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

/**
 * dim 前缀 SGR（turn 收尾行专用——appendTransientLine 纯文本路的样式面：
 * 正文瞬时行不带 cell 网格样式，dim 经 SGR 直拼、行尾 SGR_RESET 复原）。
 */
const DIM_SGR = buildSgr({ dim: true });

/**
 * 累计快照尾块分诊（V-4 注⑪⑦ 态② 细分驱动面）：message_update 载荷
 * partial 是累计快照（stream.ts 就地替换律）——尾块型即当前流相位：
 * thinking 尾块 = 思考相位 / text 尾块 = 生成相位（toolCall 等其他尾块与
 * 空 content 返 null——维持现词面，不误迁）。零新事件型（生产流 delta 已
 * 折叠为快照——路三冷读闸定谳）。
 */
function tailBlockKind(partial: AgentMessage): 'thinking' | 'text' | null {
  const content = partial.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const last = content[content.length - 1];
  if (last.type === 'thinking') return 'thinking';
  if (last.type === 'text') return 'text';
  return null;
}

/**
 * 思考活状态头提取（挖掘 31 轮 [2]——codex extract_first_bold 律移植）：首个
 * `**粗体**` 段内文（trim 非空）；无粗体/无闭合/空内文均返 null（不硬造——
 * 无闭合待后续增量，闭合到达即出头；空粗体内文同缺席）。
 */
function firstBoldHeader(text: string): string | null {
  const open = text.indexOf('**');
  if (open < 0) return null;
  const start = open + 2;
  const close = text.indexOf('**', start);
  if (close < 0) return null;
  const inner = text.slice(start, close).trim();
  return inner === '' ? null : inner;
}

/**
 * 末思考块活头（partial 累计快照——倒扫 content 取末 thinking 块）：末块换段
 * 即天然清头从新段重提（块界清头重建律——与 tailBlockKind 同依赖 stream.ts
 * 就地替换律）；redacted/无 thinking 块形自然走 null 兜底。
 */
function thinkingTailHeader(partial: AgentMessage): string | null {
  const content = partial.content;
  if (!Array.isArray(content)) return null;
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]!;
    if (block.type === 'thinking') return firstBoldHeader(block.thinking);
  }
  return null;
}

/**
 * 活头呈现消毒：engine sanitize 单源（ESC 序列/C0 剥除——tool-card 同源）+
 * 空白折叠单空格（任务行单行几何律——段内换行不落行；codex trim-only 的必要
 * 偏离）。超宽由文案段 ellipsize 既有帽收口（零新机制）。
 */
function singleLineHeader(text: string): string {
  return sanitizeDisplayText(text).replace(/\s+/g, ' ').trim();
}

/**
 * 键位串 → 显示名（任务行中断提示段消费）：escape → ESC、ctrl+c → Ctrl+C
 * （首段大写 + 单字符大写——global.interrupt 系不可覆盖位恒缺省键集，此处
 * 仅呈现面规范化不涉解析语义）。
 */
function displayKeyName(binding: string): string {
  if (binding === 'escape') return 'ESC';
  return binding
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}

/**
 * 占位行对账纯函数（57 轮件③修B）：prev/next 两帧全文按行差分——公共前缀 +
 * 公共后缀锚定（单步编辑的行变更必落两锚之间的中段，锚外行恒等免疫索引
 * 平移）→ prev 中段被删除的占位行按其在 prev 占位全序中的位次从 staged 弹除
 * （从大到小 splice 免前移偏移）。占位判据与 splitImageMarkerLines 同形（行
 * trim 后恰等于占位词面——真源在 clipboard-image.ts，此处同形实现不扩彼
 * 导出面）。只对删除动作弹除；新增占位（贴图/手敲/撤销恢复）零动作。
 *
 * 设计边界（对拍不可区分形）：同形占位行文本互不可分辨——差分只承诺「删
 * 一条占位即弹一张图、序保持」，不承诺具体弹哪张（幸存占位与幸存图按序
 * 对位）；手敲占位与直贴占位混排时 prev 占位全序可长于 staged，超界 splice
 * 落空即天然无害（弹除数恒 ≤ 被删占位数）。
 */
function dropStagedImagesForDeletedMarkers(
  prev: string,
  next: string,
  staged: readonly ImageRefContent[],
): ImageRefContent[] {
  const prevLines = prev.split('\n');
  const nextLines = next.split('\n');
  // 公共前缀（行级恒等）
  let prefix = 0;
  while (prefix < prevLines.length && prefix < nextLines.length && prevLines[prefix] === nextLines[prefix]) {
    prefix += 1;
  }
  // 公共后缀（不与前缀重叠——中段在 prev/next 各留至少零行的对齐界）
  let suffix = 0;
  while (
    suffix < prevLines.length - prefix &&
    suffix < nextLines.length - prefix &&
    prevLines[prevLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // 中段 = prev 侧删除区 [prefix, len - suffix)；其中的占位行即被删占位
  const isMarkerLine = (line: string): boolean => line.trim() === COMPOSER_IMAGE_PLACEHOLDER;
  const deletedLineNos = new Set<number>();
  for (let i = prefix; i < prevLines.length - suffix; i += 1) {
    if (isMarkerLine(prevLines[i]!)) deletedLineNos.add(i);
  }
  if (deletedLineNos.size === 0) return [...staged];
  // prev 占位全序（行号升序）一遍扫描——被删占位的序位即 staged 弹除下标
  const dropOrders: number[] = [];
  let order = 0;
  for (let i = 0; i < prevLines.length; i += 1) {
    if (!isMarkerLine(prevLines[i]!)) continue;
    if (deletedLineNos.has(i)) dropOrders.push(order);
    order += 1;
  }
  // 从大到小 splice（后位先弹免前移偏移）
  const out = [...staged];
  for (let k = dropOrders.length - 1; k >= 0; k -= 1) out.splice(dropOrders[k]!, 1);
  return out;
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
  /**
   * 任务状态行（界面美化役批 4——件 12：编辑器正上方固定段，忙态在场闲态
   * 离场；构造须晚于 keymap/now 赋值〔供数器闭包消费〕、早于 injectTheme）。
   */
  private readonly taskLine: TaskStatusLine;
  private readonly editor: Editor;
  private readonly popup: AutocompletePopup;
  /**
   * 弹层本帧实占行数（渲染门缓存——挖掘 29 轮件 5）：键路门吃键判据与
   * renderFixed 渲染门（budget.popup > 0）同源——极矮屏梯末位牺牲（渲染
   * 缺席）时键透传编辑器，幽灵层不吃键。初值 0（首帧前不吃键——弹层
   * 首现必经渲染帧，窄窗行为退化面为零键透传非误吃）。
   */
  private popupFrameRows = 0;
  /** 三源合一补全器（token 路由 + union 收口——R6 批 10j 调度器查询位） */
  private readonly autocompleteProvider: CombinedAutocompleteProvider;
  /** 补全防抖调度器（R6 批 10j：尾沿 20ms / AbortSignal / 错序丢弃三律） */
  private readonly autocompleteCompleter: AutocompleteCompleter;
  private readonly stack = new OverlayStack();
  /** 装配柄（07 §4.3 两柄 + 命令柄 + 模型循环柄〔挂账解挂批 2026-09-15〕+ 档位模式循环柄〔2026-10-05 ZCode 对标批〕） */
  private readonly onSubmit:
    | ((sessionId: string, text: string, opts?: EditorSubmitOptions, images?: readonly ImageRefContent[]) => void)
    | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private readonly onModelCycle: (() => void) | undefined;
  private readonly onModeCycle: (() => void) | undefined;
  /** 外部编辑器执行器（挖掘 31 轮 [9]——构造缺省闭包 runExternalEditor：调时取 process.env 现值） */
  private readonly externalEditor: (seed: string) => Promise<ExternalEditorOutcome>;
  /** tmux 子进程执行器（件 A 分诊 seam——缺省真身 defaultTmuxSpawn） */
  private readonly tmuxSpawn: (args: readonly string[], input?: string) => { status: number; stdout: string };
  /** 闲态教学键柄（V-3 注⑦④——`?` text 路分诊消费；缺席不劫键） */
  private readonly onHelpShortcut: (() => void) | undefined;
  /** leader 前缀键分支柄（B4——层⓪ 待续分诊消费；缺席族不激活） */
  private readonly onLeaderBranch: ((branch: LeaderBranch) => void) | undefined;
  /**
   * ctrl+x 占用者（B4 装配期一次判定）：用户覆盖把某动作挪上 ctrl+x 即
   * 非 null——leader 族整体禁用（arm 键被占则前缀语义不成立，fail-loud
   * 呈报归装配位 leaderArmBlockedNotice）。
   */
  private readonly leaderArmOccupant: ActionView | null;
  private readonly dispatchCommand: ((input: string) => Promise<boolean>) | undefined;

  /* ---- 输入管线态 ---- */
  private readonly decoder: InputDecoder;
  private readonly escapeWindowMs: number;
  private escapeHandle: unknown = null;
  /**
   * leader 待续窗到期锚（B4——2026-10-05 ZCode TUI 对标批）：null = 未待续；
   * 窗判恒惰性（nowMs <= armedUntilMs）无自愈定时器位，陈锚不碍事（下次
   * arm 覆写；解除/stop/挂起随手清——stop/suspend 全收面）。
   */
  private leaderArmedUntilMs: number | null = null;
  /**
   * 待续提示退场定时器柄（B4）：窗到点重建 footer 收提示（armEscapeWindow
   * 自愈形——不搬 ZCode 提示滞留 wart）。同步直出档（schedule 无注入）无
   * 定时器——提示位由后续 syncFooterHint 对账收敛（lone-ESC 先例同律）。
   */
  private leaderHintHandle: unknown = null;
  private unsubInput: (() => void) | null = null;
  private unsubResize: (() => void) | null = null;
  /**
   * resize 防抖定时器柄（41 轮件 I）：onResize 回调不再同步直呼 handleResize
   * ——经 scheduleResizeRepaint 尾随防抖（75ms 窗内只认末次）；走 scheduleFn
   * seam（注入钟 rig 以 clock.advance 自然驱动）。挂起期 timer 到点 →
   * handleResize 挂起闸早退零写出（几何真值由复起重取吸收——无害悬挂）。
   */
  private resizeDebounceHandle: unknown = null;
  private running = false;
  /** 起动过位（lifecycle 的 idle / disposed 分权——一次性事实，start 幂等位之外） */
  private startedOnce = false;
  private priorRaw = false;
  private disarmExitRestore: (() => void) | null = null;

  /* ---- 主屏挂起态（批 10f-4——AltScreenPrimary 交出面） ---- */
  /** 挂起位（suspendMain 置位：渲染请求安全 no-op 闸 + 输入已卸订） */
  private suspendedMain = false;
  /**
   * shell 真挂起位（挖掘 41 轮件 III）：suspendToShell 置位——suspendedMain
   * 的「因」注记位（副屏换防与 shell 交出两「因」分立），SIGCONT 路由判据
   * （单次消费——resumeFromShell 首行清位 + 退订）。
   */
  private shellSuspended = false;
  /** SIGCONT 订阅退订柄（懒注册首挂时挂、复起/终退单次收） */
  private unsubSigcont: (() => void) | null = null;
  /**
   * 外编编舞在飞位（挖掘 31 轮 [9]）：ctrl+g 异步挂起期同键再按零响应
   * （防重入——resumeMain 复起前第二击会叠挂起编舞）；编舞收口 finally
   * 复位（执行器 reject 一切归 failed 分诊不破闸）。
   */
  private externalEditorInFlight = false;
  /** 停屏期到达的瞬时行缓冲（notify / 件 9 摘要行 / 撤销说明行——复起补显射界，2026-09-07 勘正笔） */
  private suspendedTransients: string[] = [];
  /**
   * 自上次权威重建起已落屏的瞬时行账（/resume e2e 竞窗根因修——瞬时行账
   * 不丢不变式的「已落帧」半边）：瞬时行「不进行集不记 writtenBlocks，
   * repaint 不重建」（main-screen 件自述），屏面即其唯一载体——repaint/
   * resize/复起重画三路 CLEAR_SCREEN 按投影行集重建即抹屏，已落屏行无账
   * 可补（不入 scrollback 不复显）。修前 collectPendingTransients 只收
   * pendingOps（未落帧）半边，与 suspendMain 挂起转账律不对称——本账补
   * 「flush 已达成 / appendTransientCapped 已直写」的落屏行，权威清点时
   * 与 pending 合并（到达序：先落屏在前）重放。重放产物经同路再入账
   * （下次重建再补吐），循环自洽不双记。账帽 FIFO 裁旧（挖掘 26 轮 [10]——
   * 入账单源 landTransientLines 执法，最旧让位）。
   */
  private landedTransients: string[] = [];

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
  /** ask 生命周期悬置的模态编辑旗（冷读闸 P1：开窗悬置、空队退役恢复——接续窗续悬置） */
  private modalSuspendedByAsk = false;
  /** 排队问（异会话 FIFO——07 §4.1 路由序条 input() 异会话 FIFO 定形注〔节号勘正 2026-10-04：原引 §4.3 系错引，该定形注真源在 §4.1〕：在飞问未收场时新问入队不抢占） */
  private inputQueue: InputAsk[] = [];
  /**
   * ask 浮层槽持槽者（null = 槽空闲）——overlay 呈现位全局单槽（07 §4.3
   * 异会话 overlay 呈现串行化定形注：跨会话亦单；input 族 FIFO 与 overlay
   * 族单槽两律并存不悖——07 §4.1 路由序条恢复注）。
   */
  private askLayerOwner: AskLayerWaiter | null = null;
  /** ask 浮层呈现等待队列（首次呈现到达序 FIFO——槽释放按序激活） */
  private askLayerQueue: AskLayerWaiter[] = [];

  /* ---- 呈现面件 4/5/6 态 ---- */
  private readonly todoFor: ((sessionId: string) => readonly TodoItem[] | null | undefined) | undefined;
  private readonly todoPanel = new TodoPanel();
  private readonly toolPanel = new ToolProgressPanel();
  /**
   * 后台任务面板（界面美化役批6——UX 批6 A 件：running 快照固定区段）。
   * 构造须晚于 now 赋值〔时长计算基准闭包消费〕、早于 injectTheme
   * 〔主题注入位消费 jobPanel.setTheme〕。
   */
  private readonly jobPanel: JobPanel;
  /**
   * 后台任务数据源（批6）：注入缺席 = 段缺席零变化（键路由/渲染两消费面
   * 同判此位）；在场时帧首拉取 running 快照 + refreshJobs 推送锚。
   */
  private readonly jobsSource:
    { readonly running: () => readonly JobEntry[]; readonly list: () => readonly JobEntry[] } | undefined;
  /**
   * 排队常驻面板数据源（2026-10-05 ZCode TUI 对标批）：注入缺席 = 段缺席
   * 零变化（与 jobsSource 同判位形）；在场时帧首拉取聚焦会话在队预览串。
   */
  private readonly queueFor: ((sessionId: string) => readonly string[] | null | undefined) | undefined;
  /** 弹回排队末条数据源（47 轮件 A；缺席 = 功能关） */
  private readonly queuePopLast: ((sessionId: string) => string | null) | undefined;
  /** shell 直达执行柄（47 轮件 B；缺席 = 诚实拒） */
  private readonly runDirectShell: ((command: string) => void) | undefined;
  /** 审批决策折面数据源（挖掘 31 轮 [1]——onRepaint/openHistory 重建路共用） */
  private readonly approvalDecisionsSource: ((sessionId: string) => readonly ApprovalDecisionLineInput[]) | undefined;
  /** todo 快照读面（挖掘 35 轮 B8——直播腿/重建路共用） */
  private readonly todoSnapshotsSource: ((sessionId: string) => readonly TodoSnapshotLineInput[]) | undefined;
  /** 模型切线读面（挖掘 52 轮件 B——重建路共用；直播腿经 appendModelChangeLine 直灌） */
  private readonly modelChangesSource: ((sessionId: string) => readonly ModelChangeLineInput[]) | undefined;
  /** 宿主通知读面（挖掘 53 轮件 C——重建路共用；直播腿经 appendNoticeLine 直灌） */
  private readonly noticesSource: ((sessionId: string) => readonly NoticeLineInput[]) | undefined;
  /** 评审 findings 读面（35 池件 9——重建路共用；直播腿经 appendReviewLine 直灌） */
  private readonly reviewsSource: ((sessionId: string) => readonly ReviewLineInput[]) | undefined;
  /**
   * goal 持续态数据源（件 G）：注入缺席 = 段缺席零变化（footer 态词与
   * JobPanel goal 段两消费面同判此位）；在场时帧首拉取持续态行集。
   */
  private readonly goalStatus: (() => readonly GoalPanelRow[]) | undefined;
  /** goal 持续段最新行集（帧首拉取缓存——footer 供数器与 JobPanel 单次读源） */
  private goalRowsCache: readonly GoalPanelRow[] = [];
  /**
   * 排队面板最新在队预览串（帧首拉取缓存——renderFixed 单次读源）
   */
  private queuePreviews: readonly string[] = [];
  /** 当前 turn 的 assistant 消息用量暂存（turn_end 累加——件 6 等价性条款） */
  private pendingUsage: Usage | null = null;
  /**
   * 流中 token 估值器（V-4 注⑪⑥c——本轮 N 供数）：message_update 快照差分
   * 累计、message_end 真值收口（onSettled）；reset 时点 = message_start（每
   * turn 起跑）+ resetUsage 单源（新 run/切焦清账连清——中途附着本轮诚实缺席）。
   */
  private readonly turnEstimator = createStreamingTokenEstimator();
  private usageTotal: UsageAccumulation = ZERO_USAGE;
  /** 当前 run 起点时戳（agent_start 落——三反馈批C 速度段分母；repaint/切焦清账连清，中途附着即无起点） */
  private runStartedAt: number | null = null;
  /** 当前 run 终点时戳（agent_end 落——分母冻结，终态后 speedView 保持终值不随墙钟漂移；resetUsage 清） */
  private runEndedAt: number | null = null;
  /** 阻塞浮层/应答窗占用深度（挖掘 31 轮 [8]——审批等待计时暂停）：overlay 族
   * 与应答车两族独立单槽，并存时深度化不覆锚；0 = 计时走表 */
  private askPauseDepth = 0;
  /** 暂停锚（深度 0→1 时刻落——null = 计时走表；run 终态折段清锚、fresh
   * agent_start 重锚） */
  private elapsedPauseAt: number | null = null;
  /** 本 run 累计暂停墙钟（供数分母扣除项——resetUsage 单源清；开窗深度与锚
   * 保留：窗在场跨切焦/run 界存活） */
  private elapsedPausedMs = 0;
  /**
   * 本轮流式起点时戳（message_start 落——行1 速度槽流中相位分母〔注⑪⑥c
   * 「一机制喂两槽」速度腿：本轮估值 token ÷ 本轮流式已历时〕）；下一
   * message_start 重开新账、resetUsage 连清（repaint/切焦中途附着本轮无起点）。
   */
  private turnStreamStartedAt: number | null = null;
  /**
   * 重试续入标记（界面美化役批 4——retry_wait_end(resumed) 置位、下一
   * agent_start 消费即复位：续入是同一 run 的断点续跑非新 run——run 级账
   * （usageTotal/起止时戳/工具计数/种子时戳）不清零，整 run 口径律）。
   */
  private retryContinuation = false;
  /** 本 run 工具执行计数（tool_execution_start 递增；重试续入不清——收尾行工具段供数 + 双零缺席判据半边） */
  private runToolCount = 0;
  /** 本 run 重试计数（retry_wait_start 递增；重试续入不清——收尾行重试段供数 + 双零缺席判据半边——V-0 注⑥） */
  private runRetryCount = 0;
  /**
   * run 级计数部分观察旗（收尾行中途附着计数段加注形——webui frames
   * runCountsPartial 跨通道同律）：工具/重试计数在未见 agent_start 的窗
   * （runStartedAt === null——repaint/切焦中途附着）内累加即置位——计数是
   * 接入点起算的部分观察值标记；fresh agent_start 清位（resetUsage 单源）、
   * repaint/切焦清账连清（新观察窗完整口径）、retry 续入 agent_start 不清
   * （续入不清 run 级账——旗跨续入存活）。收尾行计数段加注判据 =
   * runStartedAt === null || 本旗（旗形判据两形皆盖——加注词面收 contracts
   * runRecapLine partialObserved 位单源）。
   *
   * 诚实化注（2026-10-06 复盘件3——07 定值注已裁「纯防御维持」，不删旗）：
   * TUI 侧本旗置位仅在 runStartedAt === null 窗内（置位锚两处皆带此前置
   * 条件），而清位唯一路 fresh agent_start 恰同拍置 runStartedAt——续入
   * agent_start 又不重开观察窗（runStartedAt 维持 null，webui frames 侧
   * 续入重开观察窗属异构实现）。故本旗为真时 runStartedAt 恒 null：判据
   * 第二析取支（|| 本旗）在 TUI 结构性不可独立生效，删旗全测试仍绿——旗
   * 位系跨通道同名防御冗余（判据真源 = runStartedAt === null 支）。
   */
  private runCountsPartial = false;
  /**
   * 失败原因**持有档**（失败直呈律 V-0 注②）：agent_end failed 的 errorMessage
   * 存账（终态揭示延后——批 4 持有档），retry_wait_end {aborted|exhausted} 揭示
   * 时消费（任务行态④单源承载〔V-3 注⑧：footer 尾注腿已退役〕）；消费即清、
   * agent_start 新 run 起清账（陈原因不残留）。
   */
  private pendingFailReason: string | null = null;
  /**
   * 本 run 种子用户消息时戳（收尾行时刻源——message_end 首条 channel 缺席的
   * user 消息；null = 中途附着无种子，回退 runEndedAt 诚实呈现）。
   */
  private runSeedAt: number | null = null;
  /**
   * 种子时戳**暂存位**（界面美化役批 5）：种子 message_end 先于 agent_start
   * 到达（loop.pushAll → runLoop 发射序），而 fresh agent_start 走 resetUsage
   * 清 runSeedAt——直存会被自家清账抹掉。暂存位在 fresh agent_start 晋升
   * （staging → runSeedAt），repaint/终态连清防跨 run/跨会话泄漏。
   */
  private pendingSeedAt: number | null = null;

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

  /* ---- 桌面通知态（挖掘 36 轮 notify-osc9——07 §4.1 件 7 第三写点） ---- */
  /**
   * 终端焦点位（DECSET 1004 应答 CSI I/O 维护）：缺省聚焦（乐观律——
   * codex 同参：应答未到前不发伪通知）。主/副屏两解码器共指本位（换防
   * 无盲窗）。
   */
  private terminalFocused = true;
  /**
   * 通知定值（构造期由 desktopNotify/notifyEnv 解析）：null = 通道关闭
   * （enqueueNotice 恒零账、osc.notify 恒零写——缺席注入律）。
   */
  private readonly notifyConf: { readonly carrier: 'osc9' | 'bel'; readonly tmux: boolean } | null;
  /**
   * 触发档白名单集（构造期由 notifyTriggers 铸）：null = 缺席档 = 四档全集
   * （不滤——缺席注入律）；Set 形按档滤（空集 = 显式全静默）。档位判断单点
   * 在 enqueueNotice（载波关短路优先级先于档位判断——两维分立）。
   */
  private readonly notifyTriggersSet: ReadonlySet<NotifyTrigger> | null;
  /**
   * 同窗合并账（250ms 窗）：审批（优先级 1）压过轮完成（0）——低不覆盖高
   * （codex pending_notification 同律）；窗到点整条裁决（聚焦则弃）。
   */
  private pendingNotice: { readonly text: string; readonly priority: 0 | 1 } | null = null;
  /** 合并窗定时器句柄（null = 无在飞——首入起窗、窗内后续只改账不重挂） */
  private noticeHandle: unknown = null;
  /**
   * 轮完成预览单源（按 sessionId 归账）：message_end assistant 正文首个
   * 非空行；agent_start 清 + 终态消费即清（「本轮」语义——陈摘要不跨 run）。
   */
  private readonly lastAssistantLine = new Map<string, string>();
  /**
   * 失败原因预存账（按 sessionId 归账——与任务行持有档 pendingFailReason
   * 分立两账）：agent_end failed 时 errorMessage 预存（retry_wait_end 契约
   * 无原因字段）、retry_wait_end {aborted|exhausted} 消费即清、agent_start 清。
   */
  private readonly noticeFailReason = new Map<string, string>();

  /* ---- 主题态（批 10g——07 R2 三档色域 + 语义键 + OSC 11 自动明暗；/themes 批运行时切档扩） ---- */
  /** 主题档（auto = start 时 OSC 11 探测裁定；显式内置档短路；自定义名探测照开）——/themes 选定可运行时改 */
  private themeSetting: ThemeSetting;
  /** 动效门单值（挖掘 35 轮 B2+B4——false = tick 定时器不摆 + taskLine 禁用形） */
  private readonly animationsEnabled: boolean;
  /**
   * 自定义主题覆盖表（/themes 批）：theme 值为自定义名时在场——OSC 回执按
   * 探测基板重合成（overlayBoard 单源）；null = 内置形。运行时切档可改。
   */
  private customOverlay: PartialSemanticPalette | null;
  /** 色域档（构造期一次探测——env 注入面，渲染路径零探测） */
  private readonly colorDepth: ColorDepth;
  /**
   * OSC 11 探测背景（界面美化役批⑦ R2 扩键注——userMessageBg 动态混合腿的
   * 数据位）：null = 探测未应答/缺席（→ 无背景带）。应答入账后随明暗换板/
   * 背景值变化重算（解析位混合，本件只传值）；离开探测档清位（显式内置档
   * 无探测语义——带随档消失）。
   */
  private terminalBg: RgbChannels | null = null;
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
   * 档位段 pull 闭包（批B→V-4 注⑪② 三行栈）：null 子段独立缩位（诚实
   * 缺席）；低频锚（rebuildFooter）现拉缓存——fold 不进渲染期；sandboxDanger
   * 标记供行1 模式槽 error 警示色判据。
   */
  private readonly footerTiers:
    | (() => { mode: string | null; thinking: string | null; sandbox: string | null; sandboxDanger?: boolean })
    | undefined;
  /**
   * 会话累计段 pull 闭包（注⑪②——行1 `累计 N` 供数）：渲染期活拉
   * （sessionSpentOf 聚合读面——O(1) 频拉无害）；零耗缩位。
   */
  private readonly footerSessionSpent: (() => number) | undefined;
  /** 目录槽 pull 闭包（注⑪③——行2 首槽）：低频锚缓存（切焦 cwd 漂移随 onRepaint 重拉） */
  private readonly footerCwdLabel: (() => string) | undefined;
  /** git 根 pull 闭包（注⑪③——行2 ⎇ 槽）：git IO 只进 refreshFooterGit 低频锚 */
  private readonly footerGitRoot: (() => string) | undefined;
  /** 行1 模型短名缓存（注⑪②——id 尾段；setFooterModel 活写，ctrl+p 联动回迁） */
  private footerModelShort = '';
  /** 行1 模式词缓存（rebuildFooter 低频锚拉 tiers.mode——MODE_SHORT 装配侧换词） */
  private footerMode: string | null = null;
  /** 行1 思考短词缓存（rebuildFooter 低频锚拉） */
  private footerThinking: string | null = null;
  /** 行2 沙箱原词缓存（rebuildFooter 低频锚拉——原词表示，SANDBOX_MODE_SHORT） */
  private footerSandbox: string | null = null;
  /** 行1 模式槽警示档缓存（tiers.sandboxDanger——YOLO error 色） */
  private footerModeDanger = false;
  /**
   * shell 直达态缓存（47 轮件 B——syncShellMode 翻转守卫）：modeDanger 是
   * setFooter 快照值非供数器，态翻转必须触发 rebuildFooter（不能只活算
   * instrumentSlots 词——色档位在 seg 快照）。
   */
  private shellModeOn = false;
  /**
   * 模态编辑指示词缓存（39 池 P4·L——syncModalCursor 对账位）：null = 关
   * （零占位）；'-- 普通 --' / '-- 插入 --' / '-- 操作 --' 三词。态去抖单源
   * 在模态层（同指示态零发），此处再对账（同词零重建零字节）。
   */
  private modalIndicatorCache: string | null = null;
  /** 行2 目录短名缓存（rebuildFooter 低频锚拉 cwdLabel 闭包） */
  private footerCwd = '';
  /** 行2 ⎇ 支名@短哈希缓存（refreshFooterGit 低频锚——'⎇ dev @a1b2c3d' 单源 buildFooterGitSuffix 拼形：⎇ 支名两侧空格 + @ 记形随单源 + 统计段命中追加） */
  private footerGitSuffix = '';
  /**
   * ⎇ 槽统计段缓存（挖掘 39 轮件 II——` +N −M` 追加段）：键 = `${cwd} ${shortHash}`
   * → 统计文本（null = 缺席负缓存——失败/双零同键不重试直到键变）；**回执只写
   * 缓存永不动 suffix**（呈现走 buildFooterGitSuffix 当前键查缓存——同 cwd
   * checkout 竞窗下旧 HEAD 回执结构性不虚报）。
   */
  private readonly branchStatsCache = new Map<string, string | null>();
  /** 统计腿单飞旗（在途不叠发；回执 finally 清位后 refreshFooterGit 重检收敛） */
  private branchStatsInFlight = false;
  /**
   * 上下文三件套供数（注⑪②——E-4 context_usage turn 收口随发）：used/
   * max 双可选（缺席 = 未知不显示）；切焦清位（首轮前整段缺席律 per
   * focus）；流中平滑 = settled + 估值器（contextStreamLive 门控——见其注）。
   */
  private contextUsedTokens: number | null = null;
  private contextMaxTokens: number | null = null;
  /**
   * 上下文流中平滑门控（注⑪②）：assistant 流式窗内开（message_start/update
   * 置）、message_end 真值收口关——关位显示 settled 纯值，防 context_usage
   * 落账后估值器残值叠加双计（turn 间工具相位的长窗 overshoot）。
   */
  private contextStreamLive = false;
  /**
   * 速度段呈现抑制标记（注⑪②——批C 诚实缺席律**呈现面**专属）：aborted/
   * failed 终态置真（行1 速度段缩位），completed/新 run/切焦清账复位；观
   * 测面 speedView 保持 raw（G5-#10 契约——呈现缺席 ≠ 数据缺席）。
   */
  private speedSuppressed = false;
  /**
   * 速度槽显示缓存（E 件——SPEED_SLOT_REFRESH_MS 节流）：500ms 窗内速度
   * 供数值变而显示持旧（供数层照常现算——getter 每帧现拉零降频）。相位键
   * （流中 stream / settled）随缓存存——相位切换即判失效强制刷新；速度
   * 缺席（null——亚秒/零 token 诚实缺席）就地清缓存（再现在场即刷新）；
   * resetUsage 连清（新 run 首帧刷新）。
   */
  private speedDisplayCache: { text: string; phase: 'stream' | 'settled' } | null = null;
  /** 速度槽显示缓存落账时刻（节流窗判定——注入钟） */
  private speedDisplayAt = 0;
  /**
   * 教学提示门控三态位（V-3 注⑦② + 07 §4.1 教学位扩双态注 2026-10-05）：
   * 'off' 非空稿或应答窗；'idle' 空稿闲态（`? 快捷键`）；'busy' 空稿忙态
   * （「输入仍可用」教学——忙态恰是空稿可输入的教学窗）。syncFooterHint
   * 翻转才重建（缓存短路——编辑器每键消费后/agent 起停锚对账，未翻转零重画）。
   */
  private footerHint: 'off' | 'idle' | 'busy' | 'leader' = 'off';
  /**
   * 空态引导门控位（07 §4.1 空转写态注 2026-10-05）：零块（快照空 + 无裁块
   * 前史）× 空稿 × 闲态 × 非等回声窗 → 主屏转录区呈引导；syncEmptyGuide
   * 翻转才推屏（缓存短路零重画——与 footerHint 同形单源对账模式）。
   */
  private emptyGuideOn = false;
  /**
   * 等回声抑制位（空态引导闪现防线——07 §4.1 空转写态注落码定值）：提交清
   * 稿瞬间块集仍零，用户块回声信封（host 契约必达）到达前引导会闪现一帧；
   * 提交键在编辑器清稿**前**置位（routeEvent 层④尾——清稿 change 先于
   * onSubmit 到达，事后置位拦不住），回声落地（块集非零）或再键入（非空
   * 稿）复位。'/' 起草稿走命令族（无用户块回声）不置位——命令清稿后引导
   * 复现是正确终态。切焦即新观察窗（2026-10-06 修）：onRepaint 的 sessionId
   * 与前次不同 = 切焦——本位无条件清账（旧焦在途稿件不携带，新焦空会话引
   * 导即时在场）；同焦 refresh 重画维持条件复位（见 onRepaint 分治注）。
   */
  private awaitingEcho = false;
  /**
   * 瞬时行落地门（空态引导第四门——07 §4.1 空转写态注落码定值）：任何瞬时行
   * （notify / 任务收条 / 摘要行——当场档与保全档同律）在零块态落屏即收引导
   * 不沉底追画——瞬时行推进 durable 末，引导逐次随底重画即逐次下潜、触区底
   * 即滚（durable 账漂移族——多行 notify 回执不漂账锁抓获形）。权威清点
   * （onRepaint/handleResize）重置为清点量：rescued 空 = 重建后转录区纯净，
   * 引导按门复现。置位锚 = flush 瞬时 op 直写位 + appendTransientCapped
   * （重放/排空共通收口路——replayTransients 全系经此）。
   */
  private transientLanded = false;
  /**
   * footer 门控位（挂载解挂批 2026-09-15 显式化）：footer 选项注入在场才开
   * 常驻段——注入缺席 = 状态行旧形零扰动。
   */
  private readonly footerEnabled: boolean;
  /** 流式帧字节帽（选项注入面——缺省 STREAM_FRAME_BYTE_CAP 生产定值 256KB） */
  private readonly streamFrameByteCap: number;
  /** 瞬时行保全账帽（选项注入面——缺省 LANDED_TRANSIENT_CAP 生产定值） */
  private readonly landedTransientCap: number;
  /** git 只读查询注入（挖掘 39 轮件 II——⎇ 槽统计腿；undefined = 腿缺席零行为变） */
  private readonly gitQuery: GitQuery | undefined;
  /** 原生剪贴板执行器注入（挖掘 40 轮件 A——第⓪层腿；undefined = 腿缺席零行为变） */
  private readonly nativeClipboardSpawn: NativeClipboardSpawn | undefined;
  /** 剪贴板图片读器注入（TUI 剪贴板图片直贴批；undefined = ctrl+v 键不劫持零行为变） */
  private readonly clipboardImageReader: ClipboardImageReader | undefined;
  /** 读链平台支持回执查询（56 轮件 1a；缺省闭包调时读 process 现值） */
  private readonly clipboardImageUnsupportedReason: () => string | null;
  /** 图片受理缝注入（TUI 剪贴板图片直贴批；undefined = ctrl+v/路径变体面两路整体关） */
  private readonly imageIntake: ((images: readonly ClipboardImagePayload[]) => readonly ImageRefContent[]) | undefined;
  /**
   * 暂存图清单（读得图受理铸形后、提交消费前的驻留位）：稿面 `[图片]` 占位行
   * 是其可见代理——提交期占位行计数 × 本清单长度取小定附图数（占位行删除/撤销
   * 即解除挂附）；每提交清账不跨提交滞留。
   */
  private stagedImages: ImageRefContent[] = [];
  /**
   * 占位行对账上一帧全文（57 轮件③修B）：编辑器每变必经 onChange 单源滚帧
   * ——与现帧差分定位「被删除的占位行」位次，从暂存清单弹除对应图（占位行
   * 是图的可见代理，删占位即解除挂附）。构造期空稿起帧（首帧零 diff）。
   */
  private imageMarkerFrameText = '';
  /** ctrl+v 读链在飞位（防重入——异步读期同键再按零响应） */
  private pasteImageInFlight = false;
  /** 进程信号 seam（挖掘 41 轮件 III——真挂起 SIGTSTP/SIGCONT；缺省真 process 封装） */
  private readonly processSignals: ProcessSignalsSeam;

  constructor(io: TerminalIO, options: TuiBackendOptions = {}) {
    this.io = io;
    this.sessionId = options.sessionId ?? 'main';
    this.onSubmit = options.onSubmit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onModelCycle = options.onModelCycle;
    this.onModeCycle = options.onModeCycle;
    // 缺省闭包调时读 process.env（用户中途 export 新编辑器即时生效——import 时绑定会钉死启动快照）
    this.externalEditor = options.externalEditor ?? ((seed) => runExternalEditor(seed, process.env));
    this.tmuxSpawn = options.tmuxSpawn ?? defaultTmuxSpawn;
    // 统计腿 seam（39 轮件 II）：缺席不造真身——测试基线零真进程；生产装配显式传
    this.gitQuery = options.gitQuery;
    // 原生剪贴板腿 seam（40 轮件 A）：同律缺席不造真身——生产装配显式传真身
    this.nativeClipboardSpawn = options.nativeClipboardSpawn;
    // 剪贴板图片两 seam（TUI 剪贴板图片直贴批）：同律缺席不造真身——生产装配
    // 显式传真身（createClipboardImageReader / admitPasteImages 闭包）
    this.clipboardImageReader = options.clipboardImageReader;
    // 读链支持回执缝（56 轮件 1a）：缺省闭包调时读 process 现值——SSH 判先、
    // win32 返显式回执词（processSignals.platform 注桩面同理可测）
    this.clipboardImageUnsupportedReason =
      options.clipboardImageUnsupportedReason ??
      (() => clipboardImageReadUnsupportedReason(process.env, process.platform));
    this.imageIntake = options.imageIntake;
    // 进程信号 seam（41 轮件 III）：缺省真 process 封装（真挂起生产路——
    // 自发 SIGTSTP + SIGCONT 订阅）；测试注入受控桩
    this.processSignals = options.processSignals ?? makeProcessSignals();
    this.onHelpShortcut = options.onHelpShortcut;
    this.onLeaderBranch = options.onLeaderBranch;
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
    // 瞬时行保全账帽：注入面（测试小帽证 FIFO 裁旧）缺席 = 生产定值
    this.landedTransientCap = options.landedTransientCap ?? LANDED_TRANSIENT_CAP;
    // 件 7：title 基线（version 注入缺席 = 裸名）；外显件复用本件调度注入
    // （schedule 缺席 = 保活缺位——同步测试语义，与渲染合并同构）
    this.titleBaseline = options.version ? `berry-agent ${options.version}` : 'berry-agent'; // 空串同缺席归裸名（无尾随空格脏基线）
    // 桌面通知定值（挖掘 36 轮 notify-osc9）：门缺席/'off' = 通道关（null）；
    // auto = 探测（TMUX 在场 bel 诚实降级 / TERM_PROGRAM 五家 osc9）；明示
    // osc9/bel 直用——明示 osc9 且 TMUX 在场 → DCS 包裹（tmux:true）
    const notifyGate = options.desktopNotify ?? 'off';
    if (notifyGate === 'off') {
      this.notifyConf = null;
    } else {
      const notifyEnv = options.notifyEnv ?? {};
      const carrier = notifyGate === 'auto' ? detectNotifyCarrier(notifyEnv) : notifyGate;
      this.notifyConf = { carrier, tmux: carrier === 'osc9' && notifyEnv.TMUX !== undefined };
    }
    // 触发档白名单铸集（挖掘 37 轮）：缺席 = null = 四档全集不滤（旧装配零
    // 扰动）；在场铸 Set（空数组 = 空集 = 显式全静默——合法形非坏值）
    this.notifyTriggersSet = options.notifyTriggers === undefined ? null : new Set(options.notifyTriggers);
    // 动效门（挖掘 35 轮 B2+B4）：单值注入（缺省 true）——osc 注意拍门（件 C）
    // 在构造位消费，须先于 osc 构造赋值；tick 定时器摆/不摆与 taskLine 禁用
    // 形两消费位在 start/装配尾
    this.animationsEnabled = options.animations ?? true;
    this.osc = new OscDisplay(io, {
      baseline: this.titleBaseline,
      schedule: this.scheduleFn ?? undefined,
      cancel: this.cancelFn,
      // 注意拍动效门同源透传（件 C——挖掘 46 轮）：禁用形显形帧静态常驻
      animations: this.animationsEnabled,
      notify: this.notifyConf ?? undefined, // 通道关 = 定值缺席（osc.notify 恒零写）
    });
    this.decoder = new InputDecoder({
      now: this.now,
      escapeWindowMs: this.escapeWindowMs,
      onOsc: (data) => this.handleOscReply(data), // OSC 11 应答上抛（批 10g——显式档回调内短路）
      onFocus: (focused) => {
        this.terminalFocused = focused; // 通知门控焦点位（notify-osc9——副屏解码器另指同位）
      },
    });
    // 主题基座（批 10g + /themes 批）：档位 + 色域构造期一次解析（显式内置档
    // 零探测；auto 先 dark 缺省、probe 回执换装；自定义名 = dark 基板 + 覆盖
    // 表合成、探测回执重合成换基板——「键级回退探测恒在」）；注入缺席缺省 =
    // dark@16 与批 10g 前 accent 字节同源——既有确定性测试零扰动
    this.themeSetting = options.theme ?? 'dark';
    this.customOverlay = options.customThemeOverlay ?? null;
    this.colorDepth = detectColorDepth(options.colorEnv ?? {});
    this.theme = resolveTheme(this.currentBoard(), this.colorDepth);
    // 键位注册表（批 10i R5 基座 + 10k 用户覆盖）：settings keybindings 键
    // 透传——四形拒载 fail-loud（拒载弃该键回退缺省，rejections 观测面呈报）
    this.keymap = new Keymap(options.keybindings);
    // leader arm 键占用判定（B4——构造期一次）：册面复合投影串（'ctrl+x b'
    // 形）与单段 'ctrl+x' 恒不等不误咬；用户覆盖占用即族禁用 + 装配位点名
    this.leaderArmOccupant = this.keymap.actionOccupying('ctrl+x');
    // footer 三行栈供数闭包（批B→V-4 注⑪ 笔3）：注入缺席缩位（老形选项零
    // 扰动——既有测试不传新键常驻段不变）；模型短名自全形取尾段（modelShortOf）
    this.footerTiers = options.footer?.tiers;
    this.footerSessionSpent = options.footer?.sessionSpent;
    this.footerCwdLabel = options.footer?.cwdLabel;
    this.footerGitRoot = options.footer?.gitRoot;
    this.footerModelShort = modelShortOf(options.footer?.modelLabel ?? '');
    // footer 门控（R6 批 10k 承袭）：footer 选项注入在场才开常驻段；注入
    // 缺席 = 无 footer 状态行旧形（确定性测试基线零扰动）。git IO 低频锚
    // 首跑先于段集组装（⎇ 槽缓存入场）
    this.footerEnabled = options.footer !== undefined;
    if (this.footerEnabled) {
      this.refreshFooterGit();
      this.refreshFooter();
    }
    // 直播行集（批 10h/10i）：主题随构造定着——流式 markdown 直推档与定稿块同源；
    // 头卡随 sessionHeader 注入（R-7——缺席 = 无头卡旧形，构造期即定格首块）
    this.transcript =
      options.sessionHeader === undefined
        ? new LiveTranscript({ theme: this.theme, keyText: (id) => this.keymap.keyText(id) })
        : new LiveTranscript({
            theme: this.theme,
            keyText: (id) => this.keymap.keyText(id),
            header: options.sessionHeader,
          });
    // 编辑器高度帽单点解析（批 10k 遗漏修）：显式注入帽（测试语义）恒尊注入
    // 值；缺席 = 帽公式单源按构造期几何解析（resize 随动见 handleResize）
    this.fixedEditorCap = options.maxVisibleLines ?? null;
    this.editor = new Editor({
      onSubmit: (text, opts) => this.handleSubmit(text, opts),
      onChange: () => this.handleEditorChange(),
      // 提交帽拒绝反馈（件 B——挖掘 46 轮）：瞬时提示行 = 输入错误单源面
      //（「命令异常」error 同位先例）——三段式含出路句（07 §4.4 律二）
      onSubmitRejected: ({ cap, actual }) =>
        this.notify(`输入超长：当前 ${actual.toLocaleString()} 字符，上限 ${cap.toLocaleString()} 字符——删短后再发送`, {
          level: 'error',
        }),
      maxVisibleLines: this.fixedEditorCap ?? editorHeightCap(this.io.size().rows),
      // 键位注册表注入（批 10k 遗漏修——此前缺注 = 用户覆盖对编辑器不生效，
      // Editor 自建缺省册与 backend 册两册分叉）；子编辑器（副屏搜索/导出行）
      // 经 viewer options 同册注入
      keymap: this.keymap,
      // 持久化史透传（B1）：缺席 = undefined 直落编辑器缺省（纯内存旧形）
      historySeed: options.history?.seed,
      onHistoryAdd: options.history?.onRecord,
      // 入史净稿缝（56 轮件 1e——重发即真值律）：暂存在场的提交入史剥 `[图片]`
      // 占位行后净稿（图不随史重建——召回重发不携幻影占位词面；内存册 + B1
      // 持久镜像同源单值）；暂存空恒等（手敲 `[图片]` 词面零误伤）。onSubmit
      // 不经本缝——提交流剥除单源仍在 consumeStagedImages。
      historyText: (text) => (this.stagedImages.length > 0 ? splitImageMarkerLines(text).text : text),
      // 弹回排队末条（47 轮件 A）：门序判据全归本闭包（编辑器只司键分发）
      onQueueEditLast: () => this.handleQueueEditLast(),
      // 模态态翻转（39 池 P4·L）：footer 指示词重建 + DECSCUSR 光标形写出
      onModalChange: () => this.syncModalCursor(),
    });
    // 教学提示首画锚（V-3 注⑦②）：构造期空稿闲态即期翻转 footerHint
    //（refreshFooter 先行走 hint-off 基线——editor 就位后此处收敛真态）
    this.syncFooterHint();
    // shell 直达态首画锚（47 轮件 B——同位收敛：种子稿起头 `!` 构造期即态）
    this.syncShellMode();
    // 补全三件（R6 批 10j 异步形）：provider 路由单源 → 弹层纯落位面 → 防抖
    // 调度器居中编舞。query 闭包 fire 时自取编辑器现态（防抖窗内连打取最新
    // 态）；schedule 注入缺席 = 立即发（同步测试语义——既有确定性测试零扰动）
    this.autocompleteProvider = new CombinedAutocompleteProvider(options.autocomplete ?? {});
    this.popup = new AutocompletePopup(this.editor.model);
    // escape 关层联动（组 2 修「闪回」）：弹层消费 escape 关本轮时撤防抖窗 +
    // 作废在途——否则 kitty 轨 escape 即达即决后，20ms 窗内已武装的查询迟到
    // fire 会重开刚关的弹层
    this.popup.onDismiss = () => this.autocompleteCompleter.cancel();
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
        if (this.stack.size > 0) return; // 模态浮层占焦窗——迟到在途结果不落层（死显残留防线）
        if (this.editor.isSearchingHistory()) return; // 回搜态（挖掘 31 轮 [3]）——稿件被预览占据、锚失效，迟到结果不落层
        this.popup.applyResult(result);
        this.touchFixed();
      },
      schedule: this.scheduleFn ?? undefined,
      cancelSchedule: this.scheduleFn !== null ? this.cancelFn : undefined,
    });
    // 任务状态行（界面美化役批 4——件 12 装配位；V-4 注⑪⑦ 翻档）：供数器
    // 全注入——run 级账（elapsed 整 run 口径：runStartedAt 起、重试续入不清
    // 零、终态才冻结 runEndedAt）/本轮 N（流中估值器 ⑥c 供数——零 token 形
    // 缺席缩位）/keyText 单源中断提示（escape 居首 → ESC 显示名）/注入钟。
    // 速度段退役（注⑪⑦——速度面归行1 笔3 speedView 消费）。状态变更即触
    // 固定区重画。（须早于 injectTheme——主题注入位消费 taskLine.setTheme）
    this.taskLine = new TaskStatusLine({
      // 浮层等待期不计（挖掘 31 轮 [8]——审批等待计时暂停批）：终点取值序
      // runEndedAt（终态冻结）→ elapsedPauseAt（浮层暂停锚）→ 墙钟；分母扣
      // 累计暂停墙钟 elapsedPausedMs
      elapsedMs: () => {
        if (this.runStartedAt === null) return null;
        const end = this.runEndedAt ?? this.elapsedPauseAt ?? this.now();
        return end - this.runStartedAt - this.elapsedPausedMs;
      },
      turnTokensText: () => {
        const tokens = this.turnEstimator.estimate();
        return tokens > 0 ? `本轮 ${formatCount(tokens)}` : '';
      },
      interruptHint: () => {
        const key = this.keymap.keyText('global.interrupt');
        return key === '' ? '' : `按 ${displayKeyName(key)} 取消对话`;
      },
      now: () => this.now(),
    });
    this.taskLine.onChange = () => this.touchFixed();
    // 动效门下装（挖掘 35 轮 B2+B4——禁用形转轮退静态符；早于首 render）
    this.taskLine.setAnimations(this.animationsEnabled);
    // 后台任务面板（界面美化役批6）：jobs 注入缺席 = 段缺席零变化；本地钟
    // 注入（时长基准——测试确定性）；须早于 injectTheme（主题注入位消费）
    this.jobsSource = options.jobs;
    // 排队常驻面板（2026-10-05 ZCode TUI 对标批）：queueFor 注入缺席 = 段缺席零变化
    this.queueFor = options.queueFor;
    // 弹回排队末条（47 轮件 A）：注入缺席 = 功能关
    this.queuePopLast = options.queuePopLast;
    // shell 直达（47 轮件 B）：注入缺席 = 诚实拒（/exit onQuit 缺席形同律）
    this.runDirectShell = options.runDirectShell;
    // goal 持续态数据源（件 G）：缺席 = 两呈现位零扰动；归一 null/undefined
    // 返值为空数组（供数器恒返数组——类字段契约收窄，帧首拉取零再判）
    const goalSource = options.goalStatus;
    this.goalStatus = goalSource !== undefined ? () => goalSource() ?? [] : undefined;
    // 审批决策折面数据源（挖掘 31 轮 [1]）：缺席 = 重建路零决策行（直播腿不受影响）
    this.approvalDecisionsSource = options.approvalDecisionsOf;
    // todo 快照读面（挖掘 35 轮 B8）：缺席 = 快照块零变化（两路同判此位）
    this.todoSnapshotsSource = options.todoSnapshotsOf;
    // 模型切线读面（挖掘 52 轮件 B）：缺席 = 重建路切线块零变化（直播腿不受影响）
    this.modelChangesSource = options.modelChangesOf;
    this.noticesSource = options.noticesOf;
    this.reviewsSource = options.reviewsOf;
    this.jobPanel = new JobPanel({ now: () => this.now() });
    this.injectTheme(); // 构造期注入（accent 派生样式定值；重画归 start 首帧）
    // 浮层开/关两触点：重绘请求 + 注意态对账（件 C——stack 尺寸迁移即 sync；
    // 开层单源 = activateAskLayer 的 stack.open，关层经句柄 close）
    this.stack.onChange = () => {
      this.touchFixed();
      this.syncAttentionTitle();
    };
    // 装配（43 轮件 B）：节律门 = 注入调度在场 && 动画开——同步直出档
    //（scheduleFn null）帧即 flush 无节拍窗、关动画档零推帧，两形零节拍；
    // 内容可见性不依赖动画开关（pacing off 恒全量冻结）
    this.screen = new MainScreen(io, {
      fixedHeight: 4, // 初始高：编辑器 3 + 状态行 1（动态更新经 setFixed）
      streamReleasePacing: this.scheduleFn !== null && this.animationsEnabled,
    });
    // 空态引导置态锚（07 §4.1 空转写态注 2026-10-05）：构造期零块空稿即置
    // 态入队（screen 就位后——起屏首画随 start 驱达；requestRender 未启
    // no-op，op 在队候 flush）
    this.syncEmptyGuide();
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
        // 焦点续报（notify-osc9）：副屏解码器同指主屏焦点位——换防无盲窗
        onFocus: (focused) => {
          this.terminalFocused = focused;
        },
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
    // 进屏序律（2026-09-20 TUI DA1 回显泄漏批——07 篇交出面换防例外注）：raw
    // 先于一切探测类写出（ENTER_MAIN 含 DA1 探测、OSC 11 主题查询）——应答
    // 在 raw-off 窗内到达会被内核 ECHOCTL 回显上屏（tmux 实红在案）
    this.io.setRawMode(true);
    this.io.write(ENTER_MAIN);
    this.armExitRestore();
    this.osc.setTitle(this.titleBaseline); // 件 7：起屏基线 title（OSC 0——值缓存首写）
    // 主题探测（批 10g）：auto 档发 OSC 11 背景查询 + 明暗变化通知订阅（2031
    // ——支持终端切换即时跟随）；显式档短路零写出。无应答超时降缺省 dark =
    // 自然维持构造期 dark 板（无钟不设窗——应答迟到照常换装，语义等价且免竞）
    if (this.probeActive) {
      this.io.write(OSC11_QUERY + THEME_CHANGE_ENABLE);
    }
    this.unsubInput = this.io.onInput(this.handleInput);
    // 显式放流（共享 io 换防接缝——副屏 Engine 复用同 io 场景；首启 no-op）
    this.io.resume();
    this.screen.start();
    // 固定区首画**先于**空态引导首画（sweep23-件3）：构造期 MainScreen 预置
    // fixedHeight 4（编辑器 3 + 状态 1 的旧缺省），真几何（编辑器量高 + 垫）
    // 由 renderFixed 首次 setFixed 落位——引导首画若先于此 flush，「放不下不
    // 写」缺席守卫会在预备几何下误判可容（10 行屏：预备 6 行区 ≥ 引导 5 行
    // → 画出），真几何就位后仅清接管的末行、余行残 logo 永驻（零块态零后
    // 续帧不自愈）。几何先定，守卫按真几何裁决——小屏诚实缺席、大屏照常。
    this.renderFixed();
    // 空态引导首画锚（07 §4.1 空转写态注 2026-10-05）：构造期已置态（syncEmptyGuide
    // 入队 present op），起屏清屏后驱动 flush 落画（同步直出档立即；注入调度档随
    // 首帧——repaint 权威重建路随后覆盖同态）
    if (this.emptyGuideOn) {
      this.enqueuePresent();
      this.requestRender();
    }
    this.unsubResize = this.io.onResize(() => this.scheduleResizeRepaint());
    // 动效门（挖掘 35 轮 B2+B4）：禁用形 tick 定时器不摆——忙态零 80ms 自
    // 重排（态变/供数变才触重绘，慢 SSH/前庭静止回退）
    if (this.scheduleFn !== null && this.animationsEnabled) this.armTick();
  }

  /** 对称出屏：模式串反序 + 输入卸订 + 定时器全收 + 外显复原 + raw 复原（终退不可复用） */
  stop(): void {
    if (!this.running) return;
    // 先置停再收副屏（挖掘 27 轮 [8]）：closeAlt→primary.resumeMain 守卫即
    // skip——终退路复起编舞（ENTER_MAIN 含 DA1/kitty 探测 + auto 档 OSC 11
    // 重查 + 清屏重画闪帧）本就被随后的终退收口覆盖；且探测应答落在输入
    // 卸订/raw 交还之后到达，cooked+ECHOCTL 下内核回显应答字节进 shell
    this.running = false;
    this.closeAlt(); // 防御位：在场副屏先收（装配纪律先收再退——泄漏则副屏 Engine 残活）
    // 挂起期主屏已出屏（suspendMain 已写出屏串）——重写会污染在场副屏；
    // 装配纪律恒「先收副屏再退出」，本闸是防御位非编舞路
    if (!this.suspendedMain) {
      this.io.write(LEAVE_MAIN);
      if (this.probeActive) this.io.write(THEME_CHANGE_DISABLE); // 2031 复原（显式内置档从未开）
    }
    // DECSTBM 复位无条件写（[7]）：两路径此时主屏缓冲皆已回前台（非挂起路本就
    // 前台；挂起路 closeAlt 已收副屏）——margins 皆须清，否则 shell 继承破退出后输出
    const { rows } = this.io.size();
    this.io.write(SCROLL_REGION_RESET + cup(rows - 1, 0));
    this.unsubInput?.();
    this.unsubInput = null;
    this.unsubResize?.();
    this.unsubResize = null;
    if (this.resizeDebounceHandle !== null) {
      // resize 防抖柄收口（41 轮件 I）：终退后 timer 到点即 handleResize 空
      // 转（running 闸外再写出）——显式取消
      this.cancelFn(this.resizeDebounceHandle);
      this.resizeDebounceHandle = null;
    }
    this.cancelTimer('frame');
    this.cancelTimer('tick');
    this.cancelTimer('escape');
    this.cancelTimer('notice'); // 通知合并窗收口（notify-osc9——窗内未 flush 零写出）
    this.disarmLeaderWindow(); // leader 待续窗收口（B4——提示定时器同收、复起陈窗不续）
    this.autocompleteCompleter.cancel(); // 补全在途全收（停机后零迟到交付）
    this.osc.restore(); // 件 7：复原两写点（title 基线 + 进度清零）+ 保活停针（名册语义）
    this.disarmExitRestore?.();
    // SIGCONT 订阅收柄（41 轮件 III——挂起态直接终退的双杀险兜底：先退订再
    // 终退，shell fg 恢复信号不再路由进已停 backend；shellSuspended 旗随终
    // 退失义不须清位）
    this.unsubSigcont?.();
    this.unsubSigcont = null;
    this.io.pause();
    // 终退无条件复 raw 先验（挂起期不再复——换防恒 raw 律见 suspendMain 注；
    // 从挂起态直接终退亦须交还，条件位随换防批删除）
    this.io.setRawMode(this.priorRaw);
  }

  /**
   * 排空 stdin 缓冲（终退回 shell 前——07 §4.1 件5「终退排空已裁做」；主屏
   * 形与 Engine.drainInput 同源舞）：临时吞处理器 + 放流 → 闲窗（idleMs 无
   * 新数据）或总帽（maxMs）到点收手。raw 期连打字节交回 shell 会被误执行
   * （berry desktop 线实证同款）——终退编舞（排空 → 出屏 → 进程退出）由
   * 装配侧 closer 显式调用（tui-entry tui-backend closer——挖掘 26 轮 [9]
   * 接线）。未启/已停 = no-op（无 raw 接管即无残账可排）；挂起期主屏处理器
   * 已卸（unsubInput null）——不重装（副屏编舞归 closeAlt）。
   */
  async drainInput(maxMs: number = DRAIN_MAX_MS, idleMs: number = DRAIN_IDLE_MS): Promise<void> {
    if (!this.startedOnce || !this.running) return;
    const hadHandler = this.unsubInput !== null;
    this.unsubInput?.();
    this.unsubInput = null;
    let lastData = this.now();
    const swallow = (): void => {
      lastData = this.now();
    };
    const unsubSwallow = this.io.onInput(swallow);
    this.io.resume(); // 放流：缓冲数据事件化（被吞处理器吃掉）
    const deadline = this.now() + maxMs;
    // 闲窗轮询调度：注入 schedule 缺席（同步直出测试语义）兜底真定时器——
    // 非同步即决（同步执行会把轮询旋成热自旋到总帽）
    const schedule = this.scheduleFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    while (this.now() < deadline && this.now() - lastData < idleMs) {
      await new Promise<void>((res) => void schedule(res, idleMs));
    }
    unsubSwallow();
    this.io.pause();
    if (hadHandler) {
      // 运行态调用后恢复：处理器重装 + 流复起（终退形随后 stop 再卸——幂等无害）
      this.unsubInput = this.io.onInput(this.handleInput);
      this.io.resume();
    }
  }

  /**
   * 主屏挂起（AltScreenPrimary 交出半场——批 10f-4；07 §4.1 件 8「主屏挂起 /
   * 复起交出面（UiBackend 实装件自持）」条款）：
   * 出屏模式串 + 卸输入监听 + 在途转义一窗全丢 + 停流 + raw 复先验（Engine
   * suspend 三件套同形——共享 io 换防，副屏随后 start 重装重放流）；渲染请求
   * 安全 no-op（requestRender / flush 挂起闸——停屏期零写出）；帧合并 / tick /
   * lone-ESC 窗定时器全收（防后台空转）；硬退复原钩换挂起档（屏形复原归副屏
   * Engine 自家钩，本件挂起期特意保活的终端级写点〔2031 / OSC title / OSC
   * 9;4〕硬退收口仍归本件——A2 复原对称律）。
   *
   * 件 7 osc 保活不停（批内裁）：外显态（title / 忙态 OSC 9;4）属终端级非
   * 主屏 cell 内容——停屏期终端标签页注意力语义照常（onEnvelope 照常归账），
   * OSC 序列不落 cell 网格不扰动副屏画面。
   *
   * 停屏期账不丢：durable 事件照常归约行集模型（复起全帧重画携带——树已含
   * 停屏期全部事件）；瞬时行（notify / 件 9 摘要行 / 撤销说明行）入
   * suspendedTransients 缓冲——复起补显射界含瞬时行（树按字面不含不入树的
   * 瞬时行，2026-09-07 遗漏审计批补笔）；挂起前已入队未落帧的瞬时行（注入
   * 调度档帧合并窗内挂起——生产竞窗）经转账同入缓冲，账不丢射界含帧合并窗。
   */
  suspendMain(): void {
    if (!this.running || this.suspendedMain) return; // 幂等 + 无挂起对象防御
    this.suspendedMain = true;
    this.io.write(LEAVE_MAIN); // 出屏模式串（与 start 进屏严格对称反序——单源常量）
    this.unsubInput?.();
    this.unsubInput = null;
    this.decoder.discardPending(); // 在途转义 / 粘贴 / 预编辑一窗全丢（Engine 换防同形）
    this.io.pause();
    // 换防恒 raw（2026-09-20 TUI DA1 回显泄漏批——07 篇交出面换防例外注）：
    // 不复 priorRaw——副屏同 tick 接管（AltScreenHost.open 紧跟 alt.start），
    // 中途关 raw 只开内核 ECHO 窗（挂起瞬间在途应答 / 连击被 ECHOCTL 回显
    // 上屏）；「raw 复先验」射程 = 交终端给子进程的挂起形，终退 stop 自复。
    // 副屏 Engine start 记 priorRaw=true → dispose 复 true（no-op）——主副
    // 屏全换防周期 raw 恒持、ECHO 门全周期关闭
    // 挂起前已入队未落帧的瞬时行转账（注入调度档帧合并窗内挂起可达）：
    // transient op 已入 pendingOps 而帧回调未落地，在飞帧即将被
    // cancelTimer('frame') 取消——这些行既不入 scrollback（screen.appendTransient
    // 才入账）也不入 suspendedTransients，若不转账则唯一载体 pendingOps 被
    // resumeMain 清空即永久丢失（本函数明示的瞬时行账不丢不变式破口）。只转
    // transient op（按入队序并入，到达序保持）；present op 不转——复起全帧
    // 重画按行集重建覆盖，丢弃无害（收集件 collectPendingTransients——
    // onRepaint/handleResize 权威清点同律共用）
    this.suspendedTransients.push(...this.collectAllTransients());
    // 转账即清队（第六役 S1——双转账封口）：瞬时行唯一载体 pendingOps 若不
    // 同刻清空，挂起位 onRepaint 的权威清点会把同一 transient op 再收再转一
    // 遍（collectPendingTransients 只读不清）——复起补吐同一行写出两遍。队列
    // 残余 present op 同刻丢弃无害：挂起期 flush/requestRender 全闸死、复起
    // 全帧重画按行集重建覆盖（resumeMain 清队兜底同语义——此清使「挂起期
    // onRepaint 队列理论空」成真）
    this.pendingOps = [];
    this.cancelTimer('frame'); // 在飞帧收口（挂起期零写出的调度半边）
    this.cancelTimer('tick'); // 任务行转轮停摆（防后台空转——复起重摆）
    this.cancelTimer('escape'); // lone-ESC 窗收口（decoder 已弃在途态）
    this.disarmLeaderWindow(); // leader 待续窗收口（B4——复起后陈窗不续，挂起期提示定时器零后台空转）
    // 待靶臂/组字呈现同收（56 轮闸 P2——与 activateAskLayer 同判据两路同治）：
    // 副屏期主编辑器输入流已断流，「续收」结构性不可达——陈臂劫复起后首
    // 字素（jumpToChar 吞字）、组字悬空残呈两泄漏面同形。decoder 侧预编辑
    // 已随 discardPending 全丢，此处补 editor 侧两窄面（幂等无害）。单点
    // 覆盖 model-picker/themes//diff/外编挂起等全部副屏与交出路。
    this.editor.cancelPendingJump();
    this.editor.clearPendingPreedit();
    // 硬退复原钩换挂起档（不 disarm）：副屏 Engine 的 exit 钩只复原其屏形
    //（LEAVE_MODES[alt] + raw），本件挂起期保活的终端级写点无人接管——挂起档
    // 收口体见 armSuspendExitRestore
    this.armSuspendExitRestore();
  }

  /**
   * 主屏复起（AltScreenPrimary 交出半场的对称复位）：进屏模式串 + 硬退钩
   * 重武装 + raw 重设 + 输入重装 + 显式放流（已被 pause 的流再挂监听不自动回
   * flowing——Engine resume 同形）+ **全帧重画不走（通道）repaint**：主屏既有
   * 权威全量重建路（几何真值重取 + 清屏 + 行集全量重写）+ 瞬时行缓冲补吐 +
   * resize 收敛锚同款两附件（fx2-E：编辑器高度帽随新几何重算 + footer 支名重读）。
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
    // 进屏序律（start 注同源）：raw 先于 ENTER_MAIN（含 DA1 探测）与 OSC 11
    // 重查写出——应答不落内核 ECHO 窗（换防关屏期副屏 dispose 已复 raw=true，
    // 此处重设是防御位非翻转）
    this.io.setRawMode(true);
    this.io.write(ENTER_MAIN); // 进屏模式串（与出屏对称）
    this.armExitRestore(); // 复进屏重武装（arm 幂等——先解除旧钩再挂）
    // OSC 11 重查（七役扫描批 A3）：挂起窗副屏 decoder 无 onOsc 透传、2031
    // 明暗通知丢弃（v1 已知边界——副屏在场期即时跟随不做），复起重查即补偿。
    // 同板应答 handleOscReply 短路零重画（零噪声）、迟到照常换装（无钟不设窗
    // 语义同源）；2031 订阅挂起期未关（suspendMain 不写 disable）无须重开
    if (this.probeActive) this.io.write(OSC11_QUERY);
    this.unsubInput = this.io.onInput(this.handleInput);
    this.io.resume(); // 显式放流（副屏 dispose 已 pause——共享 io 换防接缝）
    // 排队旧帧作废 + 固定区脏位重建（全帧重画是新真相——挂起期积压 op 合并无意义）
    this.pendingOps = [];
    this.needFixed = false;
    // 编辑器高度帽随新几何重算（fx2-E——handleResize 同款附件，序同其位）：
    // 修前帽停挂起前旧值——缩窗复起编辑器量高虚胖 → 固定区超屏（陈货守卫
    // 整段不写 / 编辑器内部滚动指示滥用）；显式注入帽恒尊注入值（同 handleResize）
    this.editor.setMaxVisibleLines(this.fixedEditorCap ?? editorHeightCap(this.io.size().rows));
    // 全帧重画：几何真值重取（吸收停屏期 resize）+ 清屏 + 行集全量重写（含停屏期 durable 事件）
    this.screen.handleResize(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    // footer 常驻段重算（fx2-E——resize 收敛锚同款附件，序同其位）：⎇ 槽 git
    // 读盘经 refreshFooterGit 独立低频锚复起重读（注⑪③——复起路不触发
    // onRepaint，挂起期 checkout 换支须此锚收敛；git IO 不在 refreshFooter
    // 路内）；**后于 screen.handleResize** 同 handleResize 注——缺省同步
    // flush 档 touchFixed 即触发写出，Screen 几何未先收敛则中途全量写出按
    // 旧行位落杯（缩窗后越屏定位）
    this.refreshFooterGit();
    this.refreshFooter();
    // 瞬时行缓冲补吐（复起补显射界含停屏期瞬时行——2026-09-07 勘正笔；挂起前
    // 已入队未落帧的瞬时行经 suspendMain 转账同在此账）；槽在场（停屏期起流
    // 未收口）走槽期缓冲路（关槽帧补吐——同 flush 编舞；补吐编舞单源
    // replayTransients——权威清点抢救路同律共用）
    const transients = this.suspendedTransients;
    this.suspendedTransients = [];
    this.replayTransients(transients);
    this.renderFixed();
    if (this.scheduleFn !== null && this.animationsEnabled) this.armTick(); // 任务行转轮复摆（动效门——挖掘 35 轮 B2+B4 禁用形不摆）
  }

  /**
   * 开外部编辑器（挖掘 31 轮 [9]——ctrl+g 挂起交出形）：主屏挂起 → raw 复
   * 先验（交终端给子进程——suspendMain 换防恒 raw 律的明示例外射程，cooked
   * 态编辑器自理回显）→ 执行器（seed = 展开投影——标记行展开回原文）→ resumeMain 复起（全帧
   * 重画 + 瞬时行补吐）→ 三态分诊：edited 走 editor.setText 整替（单源路：
   * undo 单步可撤 + onChange 记账 + 空稿引导对账自然走通）；missing-editor /
   * failed 就地 notify 呈报（草稿未被动过——原稿只读播种临时文件，编辑器
   * 现货整场零触）。在飞位贯穿编舞防重入；执行器 reject 归 failed 不破闸
   * （finally 复位）。
   */
  private async openExternalEditor(): Promise<void> {
    this.externalEditorInFlight = true;
    // 种子走展开投影（非 getText）：标记态粘贴原文随种入编——占位串出框
    // 且读回 setText 清登记后 submit 查不到登记，原文丢失（挖掘 32 轮修）
    const seed = this.editor.getExpandedText();
    try {
      this.suspendMain();
      // 交终端给子进程：raw 复先验态（挂起交出形——07 交出面换防例外注射程）
      this.io.setRawMode(this.priorRaw);
      let outcome: ExternalEditorOutcome;
      try {
        outcome = await this.externalEditor(seed);
      } catch (err) {
        // 执行器异常（真 spawn 抛错等）归 failed 分诊——编舞仍对称收口
        outcome = { status: 'failed', message: err instanceof Error ? err.message : String(err) };
      }
      this.resumeMain();
      if (outcome.status === 'edited') {
        this.editor.setText(outcome.text); // 整替单源路（jumpPending 连清在 setText 内）
        this.syncEmptyGuide(); // 空稿引导对账（外编清空草稿 → 引导复现）
      } else if (outcome.status === 'missing-editor') {
        this.notify(
          `未打开外部编辑器：还没设置 $VISUAL 或 $EDITOR——设置后重按 ${displayKeyName(this.keymap.keyText('editor.external-edit'))}`,
        );
      } else {
        this.notify(`外部编辑器异常：${outcome.message}。草稿未改动——可重试`, { level: 'warn' });
      }
    } finally {
      this.externalEditorInFlight = false;
    }
  }

  /* ---------------- 副屏装配面（批 10f-4 特性腿——件 8 /history；mm 批 /memory 并席） ---------------- */

  /**
   * 真挂起回 shell（挖掘 41 轮件 III——ctrl+z SIGTSTP 交终端给 shell；codex
   * job_control 对标）：复用 suspendMain 换防底座（出屏 + 卸订 + 瞬时行转账 +
   * 定时器全收 + 硬退钩换挂起档）+ 分立差异面（openExternalEditor 同法先例）：
   * DECSTBM 复原（suspendMain 不写 margins——不清则挂起期 shell 输出受限滚动
   * 区）→ drainInput 前排（raw 期连打字节排空——复 cooked 后不回灌 shell）→
   * raw 复先验（交终端给 shell：换防恒 raw 律的例外射程，cooked 态 shell 自理
   * 回显/作业控制）→ SIGCONT 先注册后自发 SIGTSTP（kill 阻塞即态——无持久
   * suspended 布尔；self-pid 不轰进程组，exec 工具子进程续跑输出走管道不写
   * tty，codex 组式 kill 的组语义差异留注）。挂起期 exit 由 armSuspendExitRestore
   * 档兜底（raw(false) + DECSTBM 复原即终退编舞——恰合已出屏态）。
   *
   * async：drainInput 尾部 io.pause 后落（不 await 会留 swallow 双监听窗）；
   * routeEvent fire-and-forget 调用。win32 早退（SIGTSTP 非 Windows 语义——
   * 键消费不生效）；副屏期主 backend 输入订阅已卸 ctrl+z 天然不辖（Engine
   * 独立键面——另件拍板残账）。
   */
  async suspendToShell(): Promise<void> {
    if (this.processSignals.platform === 'win32') return;
    if (!this.running || this.suspendedMain || this.shellSuspended) return; // 幂等 + 非运行/副屏态防御
    this.suspendMain(); // 换防底座（LEAVE_MAIN 出屏 + 瞬时行转账 + 定时器收 + 挂起档 exit 钩）
    // DECSTBM 复原 + 光标落底（stop 终退同款写——margins 清则 shell 输出全区滚动）
    const { rows } = this.io.size();
    this.io.write(SCROLL_REGION_RESET + cup(rows - 1, 0));
    await this.drainInput(); // raw 期在途字节排空（挂起交出前排——终退 closer 同源舞）
    this.io.setRawMode(this.priorRaw); // 交终端给 shell（例外射程——openExternalEditor 同款）
    this.shellSuspended = true;
    // SIGCONT 先注册后自杀（复起路由——单次消费旗 + 退订柄双保险）
    this.unsubSigcont = this.processSignals.on('SIGCONT', () => void this.resumeFromShell());
    this.processSignals.kill(this.processSignals.pid, 'SIGTSTP');
  }

  /**
   * shell 复起（SIGCONT handler 入口——fg 作业恢复；codex resume 对标）：旗
   * 守卫单次消费（shellSuspended 清 + SIGCONT 退订——codex resume_pending
   * take 同义）→ drainInput 复排（挂起期 shell 回显/误击字节——tcflush 同
   * 义）→ resumeMain 整复用（raw 先于 ENTER_MAIN 进屏序律 + 全帧重画几何真
   * 值重取〔挂起期零 resize 事件、shell 全屏程序改过尺寸也吸收〕+ 瞬时行
   * 补吐）。**无 CPR 探测**（codex 分立点）：codex 保 inline 视口需 ESC[6n
   * 对位，berry 重画首写清屏+归位绝对锚（CLEAR_SCREEN 含归位），挂起期
   * shell 输出滚入 scrollback、复起重画绝对重锚——探测零必要（decoder
   * CSI R 显式吞现状保持）。async：drainInput pause 尾落（同 suspend 侧）。
   */
  private async resumeFromShell(): Promise<void> {
    if (!this.shellSuspended) return; // 单次消费旗（迟到/双发防御）
    this.shellSuspended = false;
    this.unsubSigcont?.();
    this.unsubSigcont = null;
    await this.drainInput(); // 挂起期误击字节排空（不回灌 handleInput）
    this.resumeMain(); // 换防底座对称复位（全帧重画含清屏——件 I purge 语义辖 repaint 一致）
  }

  /**
   * 开副屏回看器（UiBackend 可选能力面实装——通道核 /history 命令到达扇出）：
   * 挂起主屏 → 1049 副屏 HistoryViewer（同一渲染管线——件 8 数据源条款）。
   * 已在副屏 no-op（无嵌套备屏）；主屏不在 running 态 open 被拒（句柄
   * null——保持无副屏态）。Ctrl+C / Ctrl+D 副屏键面经 viewer 装配柄透传本件
   * 两柄（与主屏同键面）。
   *
   * 分页加载（挖掘 52 轮件 A）：messages 全带 seq（生产装配投影恒带）时只装
   * 尾窗 + 续页复切（内装合成见体内注）；免 seq 形 = 全量单发静态档。
   *
   * 第三参 onForkEdit（挖掘 36 轮件 8 回溯 fork 批）：注入在场才铸回溯回调
   * （缺席注入律——viewer 不见键行为）；回执编排经 wireForkEdit（seed 对账
   * + 血缘 notify）。第四参 onCloseReopen（挖掘 50 轮件 C）：退出时复原钩
   * ——onExit 双步（closeAlt 后触发；键面退出路专属，ask/stop 外部收屏路
   * 不经 viewer onExit 不触发〔承认丢失——ask 优先级高于复原〕）；缺席
   * onExit 单步现行为零变。
   */
  openHistory(
    sessionId: string,
    messages: readonly AgentMessage[],
    onForkEdit?: (anchor: UiForkEditAnchor) => Promise<UiForkEditReceipt>,
    onCloseReopen?: () => void,
  ): void {
    if (this.altHandle !== null) return;
    // 回看器分页（挖掘 52 轮件 A——backend 内装合成，零新增注入位：三族源已
    // 在本件、切窗函数与页帽在 transcript 同域，合成闭包不需 host 材料）：
    // 投影恒带 seq（createChannels 泛型钉形——契约面 AgentMessage 上界宽形，
    // 运行时窄化判据）→ sliceHistoryWindow 只装尾窗（beforeSeq = Infinity 免
    // 过滤直取尾帽窗）+ 续页按 viewer 游标复切同一投影快照（同步零 I/O——
    // 快照档语义：续页与首窗同源零漂移）；五族随窗同 seq 域切片（deps 键在场
    // 镜像注入在场——缺席族页产物无键，兼容锁逐族成立，不叠加全量族防窗外
    // seq 错位；notices 增员 = 挖掘 53 轮件 C、reviews 增员 = 35 池件 9）。免 seq 形（旧装配/测试直呼 openHistory）= 全量单发静态档
    // 现行为零变（兼容锁）。
    const seqMessages = messages.filter(
      (m): m is AgentMessage & { readonly seq: number } => typeof (m as { readonly seq?: number }).seq === 'number',
    );
    const paged = seqMessages.length === messages.length;
    const page = paged
      ? (beforeSeq: number) =>
          sliceHistoryWindow(seqMessages, beforeSeq, {
            cap: HISTORY_PAGE_MESSAGES,
            ...(this.approvalDecisionsSource !== undefined
              ? { decisions: this.approvalDecisionsSource(sessionId) }
              : {}),
            ...(this.todoSnapshotsSource !== undefined ? { todoSnapshots: this.todoSnapshotsSource(sessionId) } : {}),
            ...(this.modelChangesSource !== undefined ? { modelChanges: this.modelChangesSource(sessionId) } : {}),
            ...(this.noticesSource !== undefined ? { notices: this.noticesSource(sessionId) } : {}),
            ...(this.reviewsSource !== undefined ? { reviews: this.reviewsSource(sessionId) } : {}),
          })
      : undefined;
    const firstPage = page?.(Number.POSITIVE_INFINITY);
    const handle = this.altHost.open(
      new HistoryViewer({
        sessionId,
        messages: firstPage !== undefined ? firstPage.messages : messages,
        // 审批决策行随回看重建（挖掘 31 轮 [1]——openHistory 签名零改：数据
        // 经 backend 闭包数据源注入，缺席零变化）；todo 快照块同路（挖掘 35
        // 轮 B8——todoSnapshotsOf 同源，缺席零变化）。分页在场时三族改走页产物
        // （切窗已随窗切片）；缺席 = 全量注入现行为
        decisions: firstPage !== undefined ? firstPage.decisions : this.approvalDecisionsSource?.(sessionId),
        todoSnapshots: firstPage !== undefined ? firstPage.todoSnapshots : this.todoSnapshotsSource?.(sessionId),
        // 模型切线块同路（挖掘 52 轮件 B——modelChangesOf 同源，缺席零变化）
        modelChanges: firstPage !== undefined ? firstPage.modelChanges : this.modelChangesSource?.(sessionId),
        // 宿主通知块同路（挖掘 53 轮件 C——noticesOf 同源，缺席零变化）
        notices: firstPage !== undefined ? firstPage.notices : this.noticesSource?.(sessionId),
        // 评审卡同路（35 池件 9——reviewsOf 同源，缺席零变化）
        reviews: firstPage !== undefined ? firstPage.reviews : this.reviewsSource?.(sessionId),
        columns: this.io.size().columns,
        theme: this.theme, // 会话主题快照（批 10i——回看器行集与主屏同板，含思考块/工具卡烙印）
        onExit: () => {
          // 键面退出双步（挖掘 50 轮件 C）：先收副屏（现行为），再复原钩——
          // 'o' 开史路的切换器光标复原（reopen 重发 openSessions 带 initialCursor）
          this.closeAlt();
          onCloseReopen?.();
        },
        onInterrupt: this.onInterrupt,
        onQuit: this.onQuit,
        // OSC 52 复制写出柄（mu-2）：release 选区行间拼 LF 到达 → 分诊单源
        //（件 A——tmux 三层分诊，件 8 细则；与 openMemory 同柄同律）
        onCopy: (text) => this.copyToClipboard(text),
        // 键位册同源注入（批 10k 遗漏修——搜索行子编辑器同册，用户覆盖通效）
        keymap: this.keymap,
        // 回溯编辑回调（挖掘 36 轮件 8）：注入在场才铸——wireForkEdit 编排
        // 空稿 seed + 血缘 notify（draftEmpty 门控在内）；缺席 undefined
        //（viewer e 键无效零行为变）
        onForkEdit:
          onForkEdit === undefined
            ? undefined
            : wireForkEdit(onForkEdit, {
                draftEmpty: () => this.editor.model.isEmpty(),
                seed: (text) => {
                  this.editor.setText(text); // 整替单源路（斜杠回填对账律位——setText 旁路必随 syncEmptyGuide）
                  this.syncEmptyGuide();
                },
                notify: (message, opts) => this.notify(message, opts),
                shortIdOf,
              }),
        // 分页三件套（挖掘 52 轮件 A——两参同现形同 openSessions 51 轮件 A 先例：
        // 注入缺席零分页零占位）；onLoadOlder 复切同一投影快照（真身同步——
        // Promise.resolve 包装，viewer 异步签名面向未来异步源）
        ...(page !== undefined
          ? {
              onLoadOlder: (beforeSeq: number) => Promise.resolve(page(beforeSeq)),
              nextBeforeSeq: firstPage !== undefined ? firstPage.nextBeforeSeq : null,
              requestRepaint: () => this.altHost.requestRepaint(),
            }
          : {}),
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
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
        onExit: () => this.closeAlt(),
        onInterrupt: () => this.onInterrupt?.(this.sessionId), // 零参形——装配闭包已知目标会话
        onQuit: this.onQuit,
        // OSC 52 复制写出柄（挂账解挂批①）：release 选区行间拼 LF 到达 → 分
        // 诊单源（件 A——与 openHistory 同柄同律，件 8 细则）
        onCopy: (text) => this.copyToClipboard(text),
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
   * 既有权威路——本件呈现不触焦点态）。totalCount = 全量总数（B2 截断披露
   * ——通道核 sessionsTotal 注入缺席时回退清单长度；超清单长时切换器头行
   * 注记「N/M（仅显示最近）」）。onDelete = 删除回调（05 §2.5 会话删除编排
   * 定形注①——通道核 wrapper 透传，注入缺席 undefined 键无效；回执异步落位
   * 经 requestRepaint 请帧）。onOpenHistory = 'o' 开史回调（挖掘 50 轮件 C
   * ——透传前包装即收形：先同步 closeAlt 收切换器再入回调链，竞窗结构性
   * 消解）。initialCursor = 光标复原位（'o' 开史退出复原时重开传入）。
   * 已在副屏 / 主屏不在 running 返 false（核侧 notify 降级）。打断柄锚当前
   * 交互会话位（切焦前语义）。onArchive = 归档回调（53 轮件 B 'a' 键——通道
   * 核 wrapper 透传，注入缺席 undefined 键无效）；onSwitchView = 视图切换
   * 闭包（53 轮件 B 's' 键——sessions 注入自合成同源，回执带视图域 total）。
   */
  openSessions(
    sessions: readonly UiSessionSummary[],
    onSelect: (sessionId: string) => void,
    totalCount?: number,
    onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>,
    onPreview?: (sessionId: string) => Promise<readonly UiSessionPreviewLine[]>,
    onOpenHistory?: (sessionId: string, cursorAt: number) => void,
    initialCursor?: number,
    onLoadMore?: (cursor: string) => Promise<{
      rows: readonly UiSessionSummary[];
      nextCursor: string | null;
    }>,
    moreCursor?: string | null,
    onArchive?: (sessionId: string, archive: boolean) => Promise<UiSessionArchiveResult>,
    onSwitchView?: (view: UiSessionListView) => Promise<{
      rows: readonly UiSessionSummary[];
      nextCursor: string | null;
      total: number;
    }>,
  ): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new SessionPicker({
        sessions,
        totalCount,
        onSelect,
        onExit: () => this.closeAlt(),
        onInterrupt: () => this.onInterrupt?.(this.sessionId),
        onQuit: this.onQuit,
        ...(onDelete !== undefined ? { onDelete } : {}),
        ...(onPreview !== undefined ? { onPreview } : {}),
        ...(onOpenHistory !== undefined
          ? {
              // 即收形（挖掘 50 轮件 C 竞窗终案）：透传前包装先同步收切换器
              // 再入回调链——连续 'o' 结构性不可能（picker 已收无键源）、
              // 回调链开回看器时 altHandle 恒 null 可开；拉取失败 = error
              // notify 诚实（用户重开 /sessions）；免 in-flight 旗 /
              // instanceof 判定 / 标签位三件
              onOpenHistory: (id: string, cursorAt: number) => {
                this.closeAlt();
                onOpenHistory(id, cursorAt);
              },
            }
          : {}),
        ...(initialCursor !== undefined ? { initialCursor } : {}),
        // 续页拉对（挖掘 51 轮件 A——两参同现形：注入缺席零分页零占位）
        ...(onLoadMore !== undefined ? { onLoadMore, moreCursor: moreCursor ?? null } : {}),
        // 归档/视图切换（53 轮件 B——注入缺席键无效零行为变，onDelete 同律）
        ...(onArchive !== undefined ? { onArchive } : {}),
        ...(onSwitchView !== undefined ? { onSwitchView } : {}),
        requestRepaint: () => this.altHost.requestRepaint(),
        theme: this.theme,
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
    // 上下文余量快照（挖掘 31 轮 [6]）：开屏单源现算——contextUsedNow 与 footer
    // 三件套同链（settled + 流中估值）；未落账 null = 行集维持既有 10 行。
    // 快照档静态律（HelpViewer 同族）——面板开屏后不活跟新值
    const contextUsed = this.contextUsedNow();
    const handle = this.altHost.open(
      new UsageViewer({
        sessionId,
        summary,
        context: contextUsed === null ? null : { used: contextUsed, max: this.contextMaxTokens },
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏调用台账（UiBackend 可选能力面实装——07 §4.1 ZCode TUI 对标批 B3
   * `/calls`）：模型调用明细（最近 50 条 + 全量计数截断披露——装配位
   * foldCallLedger 快照档现读）。返 boolean 同 openUsage 律：true = 已开；
   * false = 不支持或已在副屏（核侧 notify 降级）。键面三件套面板自持
   * （q/Esc/Ctrl+C/Ctrl+D——本件只挂载零键位接线）；entries 同形直传
   * （UiCallLedgerEntry 结构兼容 CallsViewerEntry——零映射层）。打断柄锚
   * 台账会话位（onInterrupt 面板自携 sessionId——聚焦会话即目标）。
   */
  openCalls(sessionId: string, entries: readonly UiCallLedgerEntry[], totalCount?: number): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new CallsViewer({
        sessionId,
        entries,
        totalCount,
        theme: this.theme, // 头行 accent 着色（rewind-picker 同形——装配位接线）
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
   * 写系统剪贴板（UiBackend 可选能力面实装——挖掘 36 轮批 [2] `/copy`）：
   * OSC 52 复用（件 8 选区复制同族——buildOsc52Copy io.write 直出尽力无反馈）；
   * 64 KiB 帽单源 SELECTION_CAP_BYTES（选区帽同值——零重抄条款；按 utf-8
   * 字节计〔Buffer.byteLength——多字节字符按字节非字符数〕，超帽拒写返
   * too-large 由核指路 /export）。OSC 52 尽力语义：终端支持不可探测（iTerm2
   * 默认禁 / tmux 需 set-clipboard on 属用户面已知边界——件 8 同族）——
   * written 是尽力声明非确定成功。
   */
  writeClipboard(_sessionId: string, text: string): UiClipboardResult {
    // _sessionId：后端面签名携带会话归属——TUI 单终端单剪贴板不消费（setStatus 同律）
    if (Buffer.byteLength(text, 'utf8') > SELECTION_CAP_BYTES) return { status: 'too-large' };
    this.copyToClipboard(text); // 分诊单源（件 A——消费位同柄单源，计数随批增删不写死）
    return { status: 'written' };
  }

  /**
   * 剪贴板写出分诊单源（挖掘 38 轮件 A——tmux 三层分诊，07 §4.1 件 8 细则；
   * 挖掘 40 轮件 A 增第⓪层原生腿）：
   * ⓪ 非 SSH 本地会话且平台矩阵命中（darwin→pbcopy / linux+WAYLAND→
   *    wl-copy / linux+X11→xclip / win32→clip.exe）且 seam 在场 → 原生
   *    子进程腿首选、'ok' 即早退（SSH 会话原生剪贴板属本地机不可达——
   *    判定先于平台；缺席/失败落穿下述三层，三层原序不动作终腿）；
   * ① TMUX env 缺席（**调时读现值**——externalEditor 同律，中途进/出 tmux
   *    即时生效）→ 裸 OSC 52 直写（现行为不变）；
   * ② TMUX 在场 → 预检 set-clipboard（on/external）→ `tmux load-buffer -w -`
   *    子进程首选举荐（stdin 喂文本——转发由 tmux 承担；off 时 load-buffer
   *    同样 exit 0 但不转发，故必预检防静默吞）；
   * ③ off/预检失败/load-buffer 失败 → DCS 包裹形 OSC 52 直穿 tmux 至外层
   *    终端（外层支持 OSC 52 即成）。
   * 终端介导三层皆尽力写出无反馈（外层终端支持性不可探测——件 8 语义）；
   * 第⓪层子进程面有确认（'ok'/'failed'）但失败亦只落穿不报——writeClipboard
   * 回执语义两腿归一。消费位（/history 选区、openMemory 选区、writeClipboard、
   * /themes 复制名——计数随批增删不写死）单源。
   */
  private copyToClipboard(text: string): void {
    // 第⓪层（40 轮件 A）——原生腿首选：SSH 判定与平台矩阵在计划函数内
    // （env 调时读现值）；seam 缺席 = 腿缺席（计划可算不执行——测试基线
    // 零真进程），任一不中落穿三层终端介导原序
    const nativePlan = planNativeClipboard(process.env);
    if (
      nativePlan !== null &&
      this.nativeClipboardSpawn !== undefined &&
      this.nativeClipboardSpawn(nativePlan, text) === 'ok'
    ) {
      return; // 原生子进程面已写出——不再终端介导
    }
    if (process.env.TMUX === undefined) {
      this.io.write(buildOsc52Copy(text));
      return;
    }
    const probe = this.tmuxSpawn(['show-options', '-gv', 'set-clipboard']);
    if (probe.status === 0 && (probe.stdout === 'on' || probe.stdout === 'external')) {
      const load = this.tmuxSpawn(['load-buffer', '-w', '-'], text);
      if (load.status === 0) return; // tmux 面转发成功——不再直写序列
    }
    this.io.write(buildOsc52CopyDcs(text));
  }

  /**
   * 开副屏回退点选择器（UiBackend 可选能力面实装——2026-09-30 会话管理命令
   * 批批3 `/rewind` 无参形；机制真源 05 §5.3 该批翻案笔）：manifest 成品行 +
   * 两步确认回调组经 host deps 注入流转（openSessions 同律——本件呈现零
   * checkpoint 依赖）；确认回退选定先收副屏再回调（SessionPicker 同序律——
   * busy 守卫→restore→adopt 编舞全闭包在插件域）。已在副屏 / 主屏不在
   * running 返 false（核侧 usage 文本兜底）。打断柄锚当前交互会话位。
   */
  openRewindPicker(entries: readonly UiRewindEntry[], actions: UiRewindActions): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new RewindPicker({
        entries,
        actions,
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
        // onPreview 异步落位后的重画柄（openMarketplace/openSetupWizard 同形
        // ——面板不自驱重画，异步账目就位经此请帧）
        requestRepaint: () => this.altHost.requestRepaint(),
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
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
        // 行集截宽锚（挖掘 44 轮件 C——openHistory 先例同律）：开屏时终端列宽
        columns: this.io.size().columns,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线；data.theme 档位串另键不撞）
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
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
          this.syncEmptyGuide(); // 空态引导对账（setText 旁路——回填非空稿引导即收）
          this.touchFixed();
        },
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏快速上手参考（07 §8.5 第 2 条 /guide——TUI 本地拦截族，2026-09-19
   * 启动版本检查批）：版本 + 核心命令清单 + 文档地图 + 升级/卸载一句——段
   * 集装配位单源注入（本件收纯数据行，静态快照档）。返 boolean 同 openHelp 律。
   */
  openGuide(data: GuidePanelData): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new GuideViewer({
        data,
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏反馈页（UX 五问题批 ④拍板 /feedback——TUI 本地拦截族，界面美化役
   * 2026-10-01 落码）：数据源集装配位单源注入——开屏扫一次错误史（快照档，
   * e 导出复用同快照），导出柄回传装配闭包本地落盘（零上报腿）。返 boolean
   * 同 openHelp 律（副屏占用 false——装配位 notify 降级）。
   */
  openFeedback(sources: FeedbackScreenSources): boolean {
    if (this.altHandle !== null) return false;
    // 开屏单次扫描（快照档律——副屏静态行集，重开重扫）
    const { errors, truncated } = scanFeedbackErrors(sources);
    const data = {
      windowDays: sources.windowDays,
      sessionsTotal: sources.sessionsTotal,
      scannedSessions: sources.sessions.length,
      errors,
      truncated,
      // daemon.log 段随导出件出（V-0 注⑤）——装配位快照直传（掩码执法在 viewer 件内）
      daemonLogPath: sources.daemonLogPath,
      daemonLogTail: sources.daemonLogTail,
    };
    const handle = this.altHost.open(
      new FeedbackViewer({
        data,
        sessionId: this.sessionId,
        theme: this.theme,
        // e 导出：诊断包全文经装配闭包落盘，回执串回填行集（件内已单行消毒）
        onExport: () =>
          sources.writeFile(
            renderFeedbackDiagnosticReport({
              exportedAt: Date.now(),
              data,
              env: sources.env,
              pageLimit: sources.pageLimit,
              maxEntries: sources.maxEntries,
            }),
          ),
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
   * 开副屏主题切换（07 §4.1 命令面增补批 /themes——TUI 本地拦截族）：条目与
   * 当前档装配位现取注入（本件不触文件面——坏文件 ⚠ 标注在装配位合成）；
   * 选定先收副屏再回调（SessionPicker 同序律），换装/持久化归装配闭包
   * （setThemeChoice 单入口）。返 boolean 同 openHelp 律。
   */
  openThemes(entries: readonly ThemePickEntry[], current: string, onSelect: (name: string) => void): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new ThemePicker({
        entries,
        current,
        onSelect,
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
        // 'c' 复制主题名（56 轮件 3 复制回执）：剪贴板写链 copyToClipboard 单源
        // （第⓪~③层同链——消费位计数随批增删不写死，56 轮闸 P3 勘正旧「三消费位」）+ notify 回执（「已复制最近一条回复」/copy
        // 回执同族词面·info 档）；副屏期 notify 走 suspendedTransients 缓冲、
        // 收屏 resumeMain 时落主屏（market-picker notifyWarn 同路径——件族律）
        onCopy: (name) => {
          this.copyToClipboard(name);
          this.notify(`已复制主题名：${name}`);
        },
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
   * 开副屏思考档位切换（2026-09-17 会话档位切换面批 F1 /thinking——TUI 本地
   * 拦截族）：七档条目与当前档装配位现取注入（词表单源在 conversation——
   * 本件收纯数据行，DAG 边表 channels 不入 conversation）；选定先收副屏再
   * 回调（SessionPicker 同序律），append durable 事件 + setStatus 回执归装配
   * 闭包。返 boolean 同 openThemes 律。
   */
  openThinking(
    entries: readonly ThinkingPickEntry[],
    current: string | undefined,
    onSelect: (level: string) => void,
  ): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new ThinkingPicker({
        entries,
        current,
        onSelect,
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏模型选择器（2026-09-30 UX 对标批 ux-4 /model——TUI 本地拦截族）：
   * 条目 = 装配位过滤后快照注入（2026-10-16 ux-4 翻档——凭证就绪过滤宇宙；
   * 清单单源 = ctrl+p 循环同一读面——本件收纯数据行，DAG 边表 channels 不入
   * llm）；打字过滤 + provider 分组头件内自持；选定先收副屏再回调（件族同序
   * 律），setModel/回执/footer 活写归装配闭包。notice（可选）= 过滤宇宙指路
   * 文案透传（头部 dim 指路行 + 底行逃生口段——件内零边外面）。返 boolean
   * 同 openThemes 律。
   */
  openModelPicker(
    entries: readonly ModelPickEntry[],
    current: string | undefined,
    onSelect: (spec: string) => void,
    notice?: string,
  ): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new ModelPicker({
        entries,
        current,
        onSelect,
        notice,
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏沙箱档位切换（2026-09-17 会话档位切换面批 F2 /sandbox——TUI 本地
   * 拦截族第九枚）：三档条目与当前档装配位现取注入（词表单源在 safety
   * SANDBOX_MODES——本件收纯数据行，DAG 边表 channels 不入 safety）；选定
   * 先收副屏再回调（SessionPicker 同序律），append durable 事件 + setStatus
   * 回执归装配闭包。返 boolean 同 openThemes 律。
   */
  openSandbox(
    entries: readonly SandboxPickEntry[],
    current: string | undefined,
    onSelect: (mode: string) => void,
  ): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new SandboxPicker({
        entries,
        current,
        onSelect,
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏改动总览（07 §4.1 命令面增补批 /diff——TUI 本地拦截族）：投影
   * 快照装配位现取注入（foldSessionDiff 在 viewer 构造期一次聚合——快照档）；
   * 词级高亮复用 R4 单源（viewer 内消费本件当前 theme——换装后开屏随新板）。
   * 返 boolean 同 openHelp 律。
   */
  openDiff(messages: readonly DiffProjectionMessage[]): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new DiffViewer({
        messages,
        theme: this.theme,
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
   * 开副屏后台任务清单（界面美化役批6 /jobs——TUI 本地拦截族）：清单快照
   * 装配位现取注入（JobsViewer 构造期一次聚合——快照档）；initialJobId
   * 定位在选任务（JobPanel 光标态 enter 消费——进屏光标直落该行）。返
   * boolean 同 openDiff 律（副屏已占如实 false）。
   */
  openJobs(initialJobId?: string): boolean {
    if (this.jobsSource === undefined) return false; // 段缺席 = 命令面缺席（装配未接即无此屏）
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new JobsViewer({
        entries: this.jobsSource.list(),
        now: () => this.now(),
        theme: this.theme,
        initialJobId,
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
   * 模态编辑开关（39 池 P4·L——07 §4.1 R5 mode 域；/vim 命令面消费位）：
   * 会话内开关、跨进程不持久（默认关拍板句——关时零呈现零拦截零字节）。
   * 翻转后指示词与 DECSCUSR 光标形即时收敛（syncModalCursor）。
   */
  setModalEditing(on: boolean): void {
    this.editor.setModalEditing(on);
    this.syncModalCursor();
  }

  /** 模态编辑开关态观测面（/vim 回执词判据位——host 装配消费） */
  isModalEditing(): boolean {
    return this.editor.isModalEditing();
  }

  /**
   * 模态指示词 + 光标形对账（onModalChange 态翻转 / setModalEditing 开关
   * 翻转两消费点）：指示词（null = 关零占位）变才重建 footer + DECSCUSR
   * 写出（insert = SteadyBar / normal·pending = SteadyBlock / 关 = 复位
   * 缺省——osc 件值去重同形零字节）。态去抖单源在模态层（同指示态零发），
   * 此处缓存对账再去抖（开关翻转/态翻转收敛单点）。
   */
  private syncModalCursor(): void {
    const mode = this.editor.modalMode;
    const indicator =
      mode === null ? null : mode === 'insert' ? '-- 插入 --' : mode === 'pending' ? '-- 操作 --' : '-- 普通 --';
    if (indicator === this.modalIndicatorCache) return;
    this.modalIndicatorCache = indicator;
    this.rebuildFooter();
    this.osc.setCursorShape(mode === null ? 'default' : mode === 'insert' ? 'bar' : 'block');
  }

  /**
   * 开副屏插件市场选装面（03 §9.6 mp-5 TUI 选装面——/marketplace 本地拦截
   * 族第七件）：可变模型（rows/tail/results/busyLabel）与动作面由 host 侧
   * face 注入（本件零市场触感——装配位单源）；锁键/指路 warn 走 notify warn
   * 位；程序化重画两路合一——面板自持态（光标/视口）经注入的 requestRepaint
   * 自请、host 侧模型变更经 requestAltRepaint 公开面（同到 altHost）。返
   * boolean 同 openThemes 律（副屏已占/主屏非 running 如实 false）。
   */
  openMarketplace(model: MarketPanelModel, actions: MarketPanelActions): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new MarketPicker({
        model,
        actions,
        notifyWarn: (text) => this.notify(text, { level: 'warn' }),
        requestRepaint: () => this.altHost.requestRepaint(),
        sessionId: this.sessionId,
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
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
   * 开副屏配置向导（onboarding ob-3 /setup——TUI 本地拦截族第十件）：面板
   * 本体实现 WizardPrompter（host 侧 runSetupWizard 流程件持本回值驱动七法
   * 相态机——multiselect/busy 两法后续增补已实装；交互契约居 channels 公开
   * 面）。返回 prompter 面；副屏占用返 null（调用位 notify 诚实降级——
   * open* 族同律）。
   */
  openSetupWizard(): WizardPrompter | null {
    if (this.altHandle !== null) return null;
    const panel = new SetupWizardPanel({
      sessionId: this.sessionId,
      requestRepaint: () => this.altHost.requestRepaint(),
      onExit: () => this.closeAlt(),
      onInterrupt: this.onInterrupt,
      onQuit: this.onQuit,
      theme: this.theme,
    });
    const handle = this.altHost.open(panel);
    if (handle === null) return null;
    this.altHandle = handle;
    return panel;
  }

  /**
   * 副屏程序化重画公开面（mp-5）：host 侧 face 在模型变更（busy 置位/结算
   * 块回填/刷新换行集）后请帧——面板只现读模型，host 变更须经此路才可见
   * （面板自持态〔光标/视口〕已由 AltScreenHost 输入监听统一补帧——mp-5
   * 家族修）。副屏缺席 no-op（调用面无须自查开屏态）。
   */
  requestAltRepaint(): void {
    this.altHost.requestRepaint();
  }

  /**
   * 键位拒载观测面（R5 批 10k）：Keymap 构造期四形拒载清单——装配位逐条
   * notify warn 呈报（拒载键不生效但点名可见——fail-loud；缺省恒空）。
   */
  get keybindingRejections(): readonly KeybindingRejection[] {
    return this.keymap.rejections;
  }

  /**
   * leader arm 键占用观测面（B4——2026-10-05 ZCode TUI 对标批）：ctrl+x 被
   * 用户覆盖占用某动作时非 null（占用者点名——装配位 warn 呈报「前缀键族
   * 不可用」；族已整体禁用——占用者保其既有语义）。null = leader 族可用。
   * 占用不是键位拒载第五形（覆盖本身合法生效）——呈报位独立于此四形闭集。
   */
  get leaderArmBlockedNotice(): string | null {
    const occupant = this.leaderArmOccupant;
    return occupant === null ? null : `ctrl+x 已被 ${occupant.label}（${occupant.id}）占用——前缀键族不可用`;
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
    const level = opts?.level ?? 'info';
    const symbol = NOTIFY_SYMBOLS[level];
    // 回执 dim 化（V-0 注③ 斜杠命令回执弱化——07 零条款真空白补落码定值）：
    // info/success 档整行 dim——回执是次级确认信息非对话本体，弱化层级与
    // 转写摘要对齐；warn/error 不动——V-1 笔3 失败直呈律（错误是用户当下
    // 最需看见的内容，不弱化）。notify 面恒纯文本，dim 经 SGR 直拼、行尾
    // SGR_RESET 复原（turn 收尾行 DIM_SGR 同律）
    const dim = level === 'info' || level === 'success';
    // 多行/超宽回执折行后逐行入流（2026-09-20 TUI 混流修复）：单串整塞会让
    // 内嵌 LF / 终端 autowrap 产超出 appendTransient 记账的物理行——后续
    // durable 块从回执中段起笔覆写正文（doors 帮助形 tmux 实红）。首行带
    // 档位符号、续行两空格缩进（user/error 块续行同律）；notify 面恒纯文本
    // （样式面归 summaryToAnsi），wrapText 直用安全
    const width = Math.max(1, this.io.size().columns - 2);
    const lines = wrapText(message, width).map((line, i) => {
      const body = i === 0 ? `${symbol} ${line}` : `  ${line}`;
      return dim ? `${DIM_SGR}${body}${SGR_RESET}` : body;
    });
    this.appendTransientLines(lines, { persist: true });
  }

  /**
   * Job 终态收口单行（07 §4.1 V-0 注①聚合律——TUI 视觉重设计批 V-1 笔2）：
   * 子代理 Job 结算的正文流收口呈现。成功 `✓ 名 · 完成`（success 色 ✓ 段）/
   * 失败 `✗ 名 · 一句话原因`〔terminal.detail 截断〕（error 色 ✗ 段）/停止
   * `⏹ 名 · 已停止〔 · detail〕`。瞬时行同 notify 律（追加即定稿、不占帽
   * 不回收——「让位」= JobPanel 运行行移除，非本行回收）；未终态防御位
   * 零呈现。调用判据（kind/owner 焦点滤）归 tui-entry 订阅位。
   */
  appendJobSettledLine(entry: JobEntry): void {
    const terminal = entry.terminal;
    if (terminal === undefined) return;
    const columns = this.io.size().columns;
    // 名段与原因段各吃行宽半（一句话帽——整行可见宽不超屏宽，防漂账物理行）
    const nameBudget = Math.max(4, Math.floor((columns - 6) / 2));
    const name = truncateToWidth(sanitizeLineText(entry.name), nameBudget);
    if (terminal.status === 'completed') {
      this.appendTransientLine(`${buildSgr({ fg: this.theme.success })}✓${SGR_RESET} ${name} · 完成`);
      return;
    }
    if (terminal.status === 'failed') {
      const reason = truncateToWidth(
        sanitizeLineText(terminal.detail ?? '未知原因'),
        Math.max(0, columns - stringWidth(name) - 6),
      );
      this.appendTransientLine(`${buildSgr({ fg: this.theme.error })}✗${SGR_RESET} ${name} · ${reason}`);
      return;
    }
    // killed：已停止（detail 在场附归因——收口/打断的归因语）
    // detail 预算收口算式（防再漂——2026-10-04 亲算定谳）：固定前缀 = 停止符(1)
    // + 空格(1) + nameW + " · "(3) + 已停止(6) = nameW+11，detail 段再自带
    // " · "(3) 合计 nameW+14——预算须减 14；只减 10 时 detail 填满预算整行
    // 超宽（appendTransientLine 瞬时路无帽直写，终端 autowrap 产未入账物理行
    // ——cursorRow 漂账族）。对照 failed 腿核算形：固定 nameW+5、减 6 → 整行
    // 恒 columns-1。
    const detail =
      terminal.detail !== undefined
        ? ` · ${truncateToWidth(sanitizeLineText(terminal.detail), Math.max(0, columns - stringWidth(name) - 14))}`
        : '';
    this.appendTransientLine(`${buildSgr({ fg: this.theme.secondary })}⏹${SGR_RESET} ${name} · 已停止${detail}`);
  }

  /**
   * 直播腿审批决策行追加（挖掘 31 轮 [1]——approval/settled 总线消费位）：
   * **块账路**非瞬时行（appendJobSettledLine 那一路）——入 transcript 块集
   * 计 dialogueBlockCount、占 blockCap 帽，repaint 投影重建自愈（fold 按
   * seq 归位同构）。调用判据（焦点滤 + isUserApprovalDecision 谓词滤）归
   * tui-entry 订阅位。
   */
  appendApprovalDecisionLine(input: { decision: 'approve' | 'always' | 'reject'; summary: string }): void {
    this.transcript.appendApprovalDecision({ ...input, theme: this.theme });
    // 块账入 present 链（onEnvelope 同形三步——apply/present/render；present
    // 携块集快照驱动主屏增量对账，缺此步新块不入帧）
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 直播腿问答落史行追加（挖掘 36 轮 [2]——ask/settled 总线消费位）：ask
   * 收场落史经宿主订阅腿回灌（**非后端自主记录**——后端面 confirm/select/
   * input 无会话语境，跨会话错挂 + 竞速败腿误记两害使记录位定谳归 UiCore
   * 收场单汇点）；appendApprovalDecisionLine 同形（块账入 present 链）。
   * live-only 块——onRepaint 重建后诚实消失（transcript 块型律）。调用位
   * 过滤（聚焦限定）归 tui-entry 订阅位。
   */
  appendAskDecisionLine(input: AskDecisionLineInput): void {
    this.transcript.appendAskDecision(input);
    // 块账入 present 链（appendApprovalDecisionLine 同律——缺此步新块不入帧）
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 直播腿模型切线块追加（挖掘 52 轮件 B——选择器/循环柄单源闭包消费位）：
   * appendApprovalDecisionLine 同形三步（块账入 present 链——缺 enqueue
   * 新块不入帧）。**槽感知归位**在 transcript.appendModelChange 单源（mid-run
   * 切线让槽居尾）；调用位过滤（聚焦限定）归 tui-entry 闭包位。
   */
  appendModelChangeLine(input: ModelChangeLineInput): void {
    this.transcript.appendModelChange(input);
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 直播腿宿主通知块追加（挖掘 53 轮件 C——tui-entry 升级腿闭包消费位）：
   * appendApprovalDecisionLine 同形三步（块账入 present 链——缺 enqueue 新块
   * 不入帧）。**槽感知归位**在 transcript.appendNotice 单源（mid-run 通知让槽
   * 居尾）；调用位过滤（聚焦限定）归 tui-entry 闭包位。
   */
  appendNoticeLine(input: NoticeLineInput): void {
    this.transcript.appendNotice(input);
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 直播腿评审卡追加（35 池件 9——渠道/插件侧经装配位闭包消费）：
   * appendNoticeLine 同形三步（块账入 present 链——缺 enqueue 新块不入帧）。
   * **槽感知归位**在 transcript.appendReview 单源（mid-run 评审卡让槽居尾）；
   * 调用位过滤（聚焦限定）归装配闭包位。
   */
  appendReviewLine(input: ReviewLineInput): void {
    this.transcript.appendReview(input);
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 直播腿回合收尾块追加（挖掘 43 轮件 A——agent_end completed 腿消费位）：
   * recap 行从瞬时行迁 turn-recap 块载体（词面单源 runRecapLine 不动——只迁
   * 载体）；appendApprovalDecisionLine 同形三步（块账入 present 链——缺
   * enqueue 新块不入帧）。live-only 块——onRepaint 重建后诚实消失（transcript
   * 块型律）。aborted 形不走本路（瞬时回执维持——回执非记账线，V-0 注⑥）。
   */
  private appendTurnRecapLine(label: string): void {
    this.transcript.appendTurnRecap({ label });
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 瞬时说明行入正文流（notify 与 ask 撤销说明行共用路——07 §4.3「曾在屏
   * 者由通道上撤销说明行」）：槽判定按**到达时刻**真相分流（2026-09-22 修复）
   * ——槽在场直推 slotTransients 让位（关槽帧排空，到达序保持），无槽入
   * 合并队列 + 渲染请求（同步直出模式立即落地；注入调度随帧合并——transient
   * 到达序保持）。挂起期入缓冲账不丢（复起补显射界含瞬时行——批 10f-4）。
   */
  private appendTransientLine(line: string, opts?: { persist?: boolean }): void {
    this.appendTransientLines([line], opts);
  }

  /**
   * 多行瞬时行入流（notify 折行产物——逐元素一行契约由 wrapText 保证）。
   * opts.persist = 保全档位（两档语义见 PendingOp transient 形注释——
   * 缺省当场档）。
   */
  private appendTransientLines(lines: readonly string[], opts?: { persist?: boolean }): void {
    if (this.suspendedMain) {
      this.suspendedTransients.push(...lines); // 停屏期瞬时行缓冲（不入 op 队列——复起不走合并直补吐）
      return;
    }
    // 槽判定用到达时刻 snapshot（非 flush 期回看）：入队与 flush 之间 snapshot
    // 可被同帧后续事件推进（[transient, present] 交错序两方向）——flush 期回看
    // 未来态会双向判错（① 关槽 present 已定稿 → 误判无槽直写嵌槽首行位破槽形；
    // ② 开槽 present 已起流 → 误判有槽入缓冲延迟到关槽帧、排到整条流式消息
    // 之后）。槽在场（末块 streaming）直推 slotTransients 让位（与
    // replayTransients 同判定形——既有编舞保序：关槽帧 flush 的 present 落地后
    // drainSlotTransients 排空），不入 pendingOps；此路零屏面变化故不请帧
    if (this.transcript.snapshot.at(-1)?.kind === 'streaming') {
      if (lines.length > 0) this.slotTransients.push(...lines);
      return;
    }
    this.pendingOps.push({ kind: 'transient', lines: [...lines], persist: opts?.persist === true });
    this.requestRender();
  }

  /**
   * 帧合并窗内瞬时行抢救收集（权威清点共通件——第五役 S1-a）：按入队序收集
   * pendingOps 中 transient op 的行。present op 不收——权威重建（repaint/
   * resize 全量重画）按行集重建覆盖，丢弃无害（同 suspendMain 转账律）。
   * 修前 onRepaint/handleResize 裸清 pendingOps：合并窗内已入队未落帧的
   * notify 行既不入 scrollback（screen.appendTransient 未达）也不复显即
   * 永失——与瞬时行账不丢不变式破口（suspendMain 挂起转账律的不对称面）。
   */
  private collectPendingTransients(): string[] {
    const lines: string[] = [];
    for (const op of this.pendingOps) {
      if (op.kind === 'transient' && op.persist) lines.push(...op.lines);
    }
    return lines;
  }

  /**
   * 瞬时行权威清点全收（竞窗根因修——onRepaint/handleResize/suspendMain 三路
   * 共用）：已落屏账（landedTransients）与未落帧队列（pendingOps 半边——
   * collectPendingTransients）合并收取，两账同刻清空（单次收取单次重放，防
   * 再收双转——第六役 S1「转账即清队」律同源）。到达序 = 先落屏在前、后入队
   * 在后；重放产物经 appendTransientCapped/flush 再入账，循环自洽。
   */
  private collectAllTransients(): string[] {
    const all = [...this.landedTransients, ...this.collectPendingTransients()];
    this.landedTransients = [];
    return all;
  }

  /**
   * 瞬时行补吐共通编舞（resumeMain 复起 / 权威清点抢救共用）：槽在场（末块
   * streaming）让位 slotTransients（嵌入槽首行位破槽形——关槽帧排空），无槽
   * 先排空既有槽期缓冲（到达序保持——早到的先吐）再现宽收口直写（抢救行
   * 可能是清点前旧宽折行产物——appendTransientCapped 逐行重截保账）。
   */
  private replayTransients(lines: readonly string[]): void {
    if (this.transcript.snapshot.at(-1)?.kind === 'streaming') {
      if (lines.length > 0) this.slotTransients.push(...lines);
      return;
    }
    this.drainSlotTransients();
    if (lines.length > 0) this.appendTransientCapped(lines, { persist: true });
  }

  /** 状态行文案（last-writer-wins——StatusLine 件语义；footer 在场 = 行1 尾注⑨） */
  setStatus(_sessionId: string, status: string): void {
    this.statusLine.setStatus(status);
    // 全域清扫 G1-#3 扇出锚：状态扇出面统一重拉 footer 低频缓存（档位段随
    // 闭包现值收敛——webui 双开切档的远端 setStatus 扇出修前只写尾注不刷段；
    // 本地 /thinking、/sandbox 切档点的显式 refreshFooter 并入本锚单源。活值
    // 段〔累计/速度/上下文〕供数器渲染期自拉；git IO 不进此高频锚）
    this.refreshFooter();
    this.touchFixed();
  }

  /**
   * footer 底栏三行栈重算（V-4 注⑪ 笔3——低频锚全量重算路：构造期/切焦联动
   * onRepaint / agent_end / 档位切换 setStatus / resize）：低频值缓存刷新
   * （tiers fold / cwdLabel 闭包——git 归 refreshFooterGit 独立锚不在此路）
   * + 段集组装（活值供数器注入）。**公开面**：档位切换点（装配侧选定闭包）
   * 经本面即时收敛。
   */
  refreshFooter(): void {
    if (!this.footerEnabled) return;
    this.rebuildFooter();
  }

  /**
   * footer 段集组装（缓存变体——resize 高频路同走零读盘〔git〕）：低频值
   * （mode/thinking/sandbox/cwd）低频锚拉闭包入缓存字段，活值（累计/速度/
   * 上下文）经供数器闭包渲染期 pull（流中随 tick/触帧直取现值——承
   * TaskStatusProviders 先例）。fail-open：闭包抛错缩位不虚报（渲染路不因
   * 数据面异常断流——装配侧闭包已自裹，此处兜底防御层）。
   */
  private rebuildFooter(): void {
    if (!this.footerEnabled) return;
    if (this.footerTiers !== undefined) {
      try {
        const pulled = this.footerTiers();
        this.footerMode = pulled.mode;
        this.footerThinking = pulled.thinking;
        this.footerSandbox = pulled.sandbox;
        this.footerModeDanger = pulled.sandboxDanger === true;
      } catch {
        // fail-open：三段缩位不虚报
        this.footerMode = null;
        this.footerThinking = null;
        this.footerSandbox = null;
        this.footerModeDanger = false;
      }
    }
    // shell 直达态覆写（47 轮件 B——行1 模式槽换词 + danger 档）：`!` 命令绕过
    // 模型与沙箱直达用户 shell——沙箱档词在 shell 直达态本不适用，换词是诚实
    // 呈现非遮蔽（YOLO 警示色基建复用 footerModeDanger）
    if (this.shellModeOn) {
      this.footerMode = 'shell';
      this.footerModeDanger = true;
    }
    try {
      this.footerCwd = this.footerCwdLabel !== undefined ? this.footerCwdLabel() : '';
    } catch {
      // fail-open：目录槽缩位
      this.footerCwd = '';
    }
    this.statusLine.setFooter({
      instruments: () => this.instrumentSlots(),
      env: () => this.envSlots(),
      // 教学位多态文案（07 §4.1 教学位扩双态注 2026-10-05 + B4 待续态同批）：
      // 闲态 `? 快捷键` / 忙态「输入仍可用」/ 待续态分支菜单（leader）——off 空串
      hint:
        this.footerHint === 'leader'
          ? FOOTER_HINT_LEADER
          : this.footerHint === 'idle'
            ? FOOTER_HINT_TEXT
            : this.footerHint === 'busy'
              ? FOOTER_HINT_BUSY_TEXT
              : '',
      modeDanger: this.footerModeDanger,
      // goal 态词供数器（件 G——行2 首槽）：读帧首缓存（goalRowsCache——SQL
      // 不进渲染帧同律），goalStatus 注入缺席 = 恒 null 零占位旧槽序
      goalState: () => this.goalFooterWord(this.goalRowsCache),
    });
    this.touchFixed();
  }

  /**
   * 行1 仪表槽列（注⑪② 定序——模式/思考/模型/累计/速度/上下文；'' 槽
   * 缺席过滤）：模式/思考/模型读低频缓存；累计/速度/上下文活值现拉。抛错
   * 由 StatusLine pullSafe 兜底整段缩位（防御层——此处逐段自裹优先）。
   */
  private instrumentSlots(): string[] {
    const slots: string[] = [];
    if (this.footerMode !== null) slots.push(this.footerMode);
    // 模态编辑指示词（39 池 P4·L——第 2 位：模式词后。null = 关零占位；
    // 坍缩梯保位——右起丢非模式槽，本槽居首段坍缩最后失位）
    if (this.modalIndicatorCache !== null) slots.push(this.modalIndicatorCache);
    if (this.footerThinking !== null) slots.push(this.footerThinking);
    if (this.footerModelShort !== '') slots.push(this.footerModelShort);
    if (this.footerSessionSpent !== undefined) {
      try {
        const spent = this.footerSessionSpent();
        if (spent > 0) slots.push(`累计 ${formatCount(spent)}`);
      } catch {
        // fail-open：累计段缩位不虚报
      }
    }
    if (!this.speedSuppressed) {
      // 速度槽双相位供数（注⑪⑥c「一机制喂两槽」）：流中相位（assistant
      // 流式窗内）读估值平滑（本轮估值 ÷ 本轮流式已历时——settled 账在首个
      // turn_end 落账前恒零，纯认 settled 则流中整段缺席）；流中窗外（turn
      // 间工具相位/终态）读 settled 真值（speedView——run 级平均）
      const speed = this.contextStreamLive ? this.streamSpeedView : this.speedView;
      if (speed !== null) {
        // 显示节流 500ms（E 件）：窗内显示持旧、供数层零降频（speed 照常
        // 现算——缺省相位值恒可再算）；相位切换即刷新（语义边界不吞首帧）
        const phase = this.contextStreamLive ? 'stream' : 'settled';
        const now = this.now();
        if (
          this.speedDisplayCache === null ||
          this.speedDisplayCache.phase !== phase ||
          now - this.speedDisplayAt >= SPEED_SLOT_REFRESH_MS
        ) {
          this.speedDisplayCache = { text: formatTokensPerSecond(speed), phase };
          this.speedDisplayAt = now;
        }
        slots.push(`${this.speedDisplayCache.text} tok/s`);
      } else {
        this.speedDisplayCache = null; // 速度缺席即缓存失效（再现在场即刷新——缺席窗不承旧值）
      }
    }
    const context = this.contextSlotText();
    if (context !== '') slots.push(context);
    return slots;
  }

  /**
   * 行1 上下文槽文案（注⑪② 三件套）：max 在场 = `上下文 12 K / 1 M · 剩 62%`
   * （K/M 单源 formatTokensCompact；百分比 = 剩余口径带向标词——挖掘 44 轮
   * 件 B 与 /usage 余量行同式同值，单源 contextRemainingPercent，已用率裸形
   * 退役）；缺席 = 二件套（无帽无百分比）；双缺席整段缩位。流中平滑 =
   * settled + 估值器（contextStreamLive 门控——流式窗内开、真值收口关，防
   * turn 间双计）。
   */
  private contextSlotText(): string {
    const used = this.contextUsedNow();
    if (used === null) return '';
    const max = this.contextMaxTokens;
    if (max === null || max <= 0) return `上下文 ${formatTokensCompact(used)}`;
    return `上下文 ${formatTokensCompact(used)} / ${formatTokensCompact(max)} · 剩 ${contextRemainingPercent(used, max)}%`;
  }

  /**
   * 上下文已用单源（挖掘 31 轮 [6] 上提——footer 槽与 /usage 余量条形行共
   * 消费）：settled 真值缺席返 null；在场 = settled + 流中估值
   * （contextStreamLive 门控——流式窗内开、真值收口关，防 turn 间双计）。
   * 算式自 contextSlotText 逐字搬移（既有 footer 字面锚护体）。
   */
  private contextUsedNow(): number | null {
    const settled = this.contextUsedTokens;
    if (settled === null) return null;
    return settled + (this.contextStreamLive ? this.turnEstimator.estimate() : 0);
  }

  /**
   * 行2 环境槽列（注⑪③ 定序——目录/短 id/⎇ 支名@短哈希/沙箱原词；'' 槽
   * 缺席过滤）：全读低频缓存字段（fold/git IO/查库不进渲染期）；短 id 恒
   * 在场（会话锚——注入 footer 即开）。
   */
  private envSlots(): string[] {
    const slots: string[] = [];
    if (this.footerCwd !== '') slots.push(this.footerCwd);
    slots.push(shortIdOf(this.sessionId));
    if (this.footerGitSuffix !== '') slots.push(this.footerGitSuffix);
    if (this.footerSandbox !== null) slots.push(this.footerSandbox);
    return slots;
  }

  /**
   * footer goal 态词聚合（件 G——§3.10 词面拍板表单源）：空行集 null（零
   * 占位旧槽序）；相位优先序 budget-paused > stalled > running（任一暂停
   * 即警示——整组 footer 只担相位不含账，账在面板行尾任务分职）；多目标
   * 缀 ` · N 项`。attention = 暂停两相 true（首槽警示色——承行1 模式词
   * danger 色律）。
   */
  private goalFooterWord(rows: readonly GoalPanelRow[]): { word: string; attention: boolean } | null {
    if (rows.length === 0) return null;
    let paused = false;
    let stalled = false;
    for (const row of rows) {
      if (row.phase === 'budget-paused') paused = true;
      else if (row.phase === 'stalled') stalled = true;
    }
    // 相位词（优先序 budget-paused > stalled > running）+ 多目标项数缀
    const base = paused ? '目标暂停 · 预算到上限' : stalled ? '目标暂停 · 连续无进展' : '目标运行中';
    const word = rows.length > 1 ? `${base} · ${rows.length} 项` : base;
    return { word, attention: paused || stalled };
  }

  /**
   * ⎇ 槽 git 读盘低频锚（注⑪③——refreshFooterGit；07 注⑪③ 追注定形
   * 三枚）：构造期 + onRepaint（切焦 cwd 漂移）+ 会话复起 resumeMain
   * （复起重画路不触发 onRepaint——挂起期 checkout 换支须此锚收敛）；
   * 支名@短哈希腿 readGitHead 零子进程直读 refs（gitHeadSuffix 单源拼形
   * 去 lead 空格）；**+N/−M 统计段异步腿**（挖掘 39 轮件 II——经 gitQuery
   * seam 子进程只读查询，拼形走 buildFooterGitSuffix 当前键查缓存——缓存
   * 命中锚保形不丢段、旧键回执结构性不虚报；seam 缺席/非库/初生支零行为
   * 变）。**不进 setStatus/resize 高频锚**（07 定值「避 resize 高频读盘」
   * 承 V-3 前律）；闭包缺席/非库/抛错 = 槽缩位不虚报。
   */
  private refreshFooterGit(): void {
    if (!this.footerEnabled || this.footerGitRoot === undefined) {
      this.footerGitSuffix = '';
      return;
    }
    try {
      const head = readGitHead(this.footerGitRoot());
      this.footerGitSuffix = this.buildFooterGitSuffix(head);
      this.ensureBranchStats(head);
    } catch {
      // fail-open：⎇ 槽缩位
      this.footerGitSuffix = '';
    }
  }

  /**
   * ⎇ 槽拼形单源（39 轮件 II）：支名@短哈希（gitHeadSuffix）+ 当前键缓存
   * 命中统计段（` +N −M`——缓存消费的是 stats 值非「跳过一切」，锚上缓存
   * 命中保形不丢段）。detached（branch null、shortHash 在场）不属缺席族
   * ——统计段照常可贴。
   */
  private buildFooterGitSuffix(head: GitHeadInfo): string {
    const base = gitHeadSuffix(head).trim();
    if (base === '') return ''; // 非库/双缺席——槽整体缩位（不虚报）
    const stats = this.cachedBranchStatsText(head);
    return stats === null ? base : base + stats;
  }

  /** 统计缓存键（cwd + shortHash；shortHash null〔初生支/畸形〕退化键——统计腿不 fire） */
  private branchStatsKey(cwd: string, shortHash: string | null): string {
    return `${cwd} ${shortHash ?? 'null'}`;
  }

  /** 当前键查缓存（未命中 undefined 与 null 负缓存分立——null 是缺席值非未算） */
  private cachedBranchStatsText(head: GitHeadInfo): string | null {
    if (this.footerGitRoot === undefined) return null;
    const cached = this.branchStatsCache.get(this.branchStatsKey(this.footerGitRoot(), head.shortHash));
    return cached === undefined ? null : cached;
  }

  /**
   * 统计腿编排（39 轮件 II）：seam 缺席/非库/初生支（shortHash null）no-op；
   * 键命中（含负缓存）零重算；单飞旗在途不叠发（窗内新键 miss 由回执
   * finally 的 refreshFooterGit 重检收敛——有界缺席缩一窗）。**回执只写缓存
   * 永不动 suffix**；回执落地后经 refreshFooterGit 重拼（当前键=回执键才贴
   * 段）+ touchFixed 落帧。失败/双零写 null 负缓存（同键不重试直到键变——
   * 防失败无限重 fire）。
   */
  private ensureBranchStats(head: GitHeadInfo): void {
    if (this.gitQuery === undefined || this.footerGitRoot === undefined) return;
    if (head.shortHash === null) return; // 初生支/畸形——失败缺席（键退化注记）
    const cwd = this.footerGitRoot();
    const key = this.branchStatsKey(cwd, head.shortHash);
    if (this.branchStatsCache.has(key)) return; // 命中（含负缓存）零重算
    if (this.branchStatsInFlight) return; // 单飞——回执 finally 重检收敛
    if (this.branchStatsCache.size > 64) this.branchStatsCache.clear(); // checkout 换支积键防胀（低频量级粗帽）
    this.branchStatsInFlight = true;
    void computeBranchStats(this.gitQuery, cwd)
      .then((stats) => {
        // 双零（在默认支无累计差）= 缺席形；− 为 U+2212（diffCountRuns 计数词汇同源）
        this.branchStatsCache.set(
          key,
          stats === null || (stats.added === 0 && stats.removed === 0) ? null : ` +${stats.added} −${stats.removed}`,
        );
      })
      .catch(() => {
        this.branchStatsCache.set(key, null); // 异常负缓存
      })
      .finally(() => {
        this.branchStatsInFlight = false;
        // 清位即重检（单飞窗内新键被挡的补偿）+ 回执键若为当前键经重拼贴段；
        // refreshFooterGit 内部 catch 兜底（fail-open 槽缩位）
        this.refreshFooterGit();
        this.touchFixed();
      });
  }

  /**
   * 行1 模型短名活写（注⑪② 回迁——ctrl+p 联动）：spec 全形取 id 尾段即写
   * 即触重画；注入缺席（footer 无）no-op 零扰动。全形呈现归 /status 副屏。
   */
  setFooterModel(spec: string): void {
    if (!this.footerEnabled) return;
    this.footerModelShort = modelShortOf(spec);
    this.touchFixed();
  }

  /**
   * 教学提示门控对账（V-3 注⑦② + 07 §4.1 教学位扩双态注 2026-10-05 + B4
   * leader 待续态同批扩四态）：期望态翻转才重建（缓存短路——编辑器每键
   * 消费后/agent 起停锚高频对账零重画）。四态收敛：非空稿或应答窗
   * （inputAsk）恒 off——应答窗 Enter 是收窗非提交，两态文案皆示假键位
   * （overlay 在场性不入判——浮层收屏后随下一键对账）；待续态（B4——
   * ctrl+x 窗内）leader 优先于忙闲（窗内恰是分支菜单呈现窗——arm 后转忙
   * 仍示分支）；余按忙闲分态：闲态 `? 快捷键`（`?` 键教学投影）、忙态
   * 「输入仍可用」（忙态恰是空稿可输入的教学窗——Enter 追加/Alt+Enter
   * 排队键位实况）。
   */
  private syncFooterHint(): void {
    if (!this.footerEnabled) return;
    let next: 'off' | 'idle' | 'busy' | 'leader';
    if (!this.editor.model.isEmpty() || this.inputAsk !== null) next = 'off';
    else if (this.leaderArmedUntilMs !== null) next = 'leader';
    else if (this.progressBusy) next = 'busy';
    else next = 'idle';
    if (next === this.footerHint) return;
    this.footerHint = next;
    this.rebuildFooter();
  }

  /**
   * shell 直达态门控对账（47 轮件 B——07 §4.1 shell 直达条款呈现面）：
   * 期望态翻转才 rebuildFooter（同 syncFooterHint 谱——编辑器每键零重画；
   * 态消费位 rebuildFooter 覆写读 shellModeOn）。判据派生态非存储态：
   * 打 `!` 即进、删 `!` 即退（稿件文本判据无模式机）；应答窗/回搜态排除
   *（应答非编辑、预览稿不闪词）。单锚 = handleEditorChange（syncFooterHint
   * 邻位）——setText 全调用位经 editor-model 尾部无条件 notify() 收敛进
   * onChange 对账路，稿件位翻转全覆盖（设计档单锚定谳）。
   */
  private syncShellMode(): void {
    if (!this.footerEnabled) return;
    const draft = this.editor.model.getText();
    const next =
      this.inputAsk === null &&
      !this.editor.isSearchingHistory() &&
      !this.editor.model.isEmpty() &&
      draft.trimStart().startsWith('!');
    if (next === this.shellModeOn) return;
    this.shellModeOn = next;
    this.rebuildFooter();
  }

  /**
   * 空态引导门控对账（07 §4.1 空转写态注 2026-10-05）：零块（快照空且无
   * 裁块前史——trimmed 计数非零即曾有块，非「空会话」语义）× 空稿 × 闲态
   * × 非等回声窗 × 无瞬时行落地 → 主屏转录区空态引导；任一破即收。翻转才
   * 推屏（缓存短路）：状态置 MainScreen.setEmptyGuide（纯状态零写出）+
   * present 入队（E' 段编舞收敛——首块到达 D 段并账 EL 清零滞退场）。锚位 =
   * 构造期/ start 首画 / onEnvelope（块集与忙闲翻转源之后）/ onRepaint 与
   * handleResize（权威清点——瞬时行清点量重置第四门后、全量重画前）/
   * handleEditorChange（稿件翻转）/ ctrl+d 清稿与 /skills 回填两 setText
   * 旁路位。瞬时行落地路的收引导不走本对账（retireEmptyGuideAtLanding
   * ——appendTransient 自身以旧 guideRows 并账清尾，零额外帧）。
   */
  private syncEmptyGuide(): void {
    // R-7 零块判据收窄：头卡不计对话块——头卡在场零对话仍示引导（与空态引导
    // 并存条款）；trimmed 计数维持块位账（头卡在场零对话恒无裁块——判据不交叉）
    const on =
      this.editor.model.isEmpty() &&
      dialogueBlockCount(this.transcript.snapshot) === 0 &&
      this.transcript.trimmedBlockCount === 0 &&
      !this.awaitingEcho &&
      !this.progressBusy &&
      !this.transientLanded;
    if (on === this.emptyGuideOn) return;
    this.emptyGuideOn = on;
    this.screen.setEmptyGuide(on ? EMPTY_GUIDE_LINES : null);
    this.enqueuePresent();
    this.requestRender();
  }

  /**
   * 瞬时行落地即收空态引导（第四门置位 + 无帧翻转——flush 直写位与
   * appendTransientCapped 收口路的前置调用）：先置 MainScreen 状态 null 再
   * 进 appendTransient——其余行清除上界仍以旧 guideRows 并账（引导尾行随
   * 瞬时行 EL 清），随后走「无引导」支清账；不 enqueue present（清尾由
   * appendTransient 本帧完成，追加帧只产空转重画噪声）。
   */
  private retireEmptyGuideAtLanding(): void {
    this.transientLanded = true;
    if (!this.emptyGuideOn) return;
    this.emptyGuideOn = false;
    this.screen.setEmptyGuide(null);
  }

  /**
   * 等回声复位（对话块非零 = 用户块回声已落——onEnvelope/onRepaint 两锚共用；
   * R-7 头卡不计对话块：头卡在场不得误判「块已落」即刻复位——等回声抑制位
   * 须待真用户块回声落地才收）
   */
  private settleAwaitingEcho(): void {
    if (this.awaitingEcho && dialogueBlockCount(this.transcript.snapshot) > 0) this.awaitingEcho = false;
  }

  /**
   * 后台任务面板刷新（界面美化役批6——job_settled 推送锚）：settle 瞬间
   * 即时收敛 running 快照（否则闲态零帧源面板滞留至下一次交互）。公开面
   * 留装配侧订阅位（dispatch.on('job_settled')）；jobs 注入缺席 = no-op。
   */
  refreshJobs(): void {
    if (this.jobsSource === undefined) return;
    this.jobPanel.update(this.jobsSource.running());
    this.touchFixed();
  }

  /**
   * 清后台任务段光标（escape 让路族——界面美化役批6）：在场才触重画并返
   * true（路由层分诊消费）；不在场/段缺席返 false 零扰动（分诊续走）。
   */
  private clearJobsCursor(): boolean {
    if (this.jobsSource === undefined) return false;
    const cleared = this.jobPanel.clearCursor();
    if (cleared) this.touchFixed();
    return cleared;
  }

  /** 活体信封呈现：渲染归约 + 聚焦态状态面消费（非聚焦摘要行瀑布已退役——07 §4.1 V-0 注①） */
  onEnvelope(env: SessionEnvelope, focused: boolean): void {
    this.transcript.applyEvent(env, focused);
    this.settleAwaitingEcho(); // 等回声复位（用户块回声落地——空态引导闪现防线解锁）
    this.enqueuePresent();
    this.requestRender();
    this.trackProgress(env); // 件 7：按会话净计数（终端级注意力——任一会话在飞即忙）
    this.trackDesktopNotice(env); // 件 7 第三写点：桌面通知触发路由（notify-osc9——不问聚焦位，后台终态可达）
    if (focused) this.applyFocusedEvent(env.event);
    this.syncEmptyGuide(); // 空态引导对账（块集/忙闲两翻转源之后——本帧驱动收敛）
  }

  /** 重画呈现：投影重建行集 + 清屏全量重写（widget 槽值不支撑——忽略） */
  onRepaint(sessionId: string, projection: readonly AgentMessage[], _widget: { node: unknown } | null): void {
    // repaint 是焦点切换的权威信号（focus() 未注册视同注册——首次注册同路）：
    // 交互会话位跟随（提交/打断柄机器位锚新焦——/sessions 选定切焦路）。
    // 切焦判定须在位覆盖**前**比对（等回声分治支消费）
    const focusSwitched = sessionId !== this.sessionId;
    this.sessionId = sessionId;
    this.refreshTodo(); // 件 4：todo 源锚新焦（refreshTodo 三时点之外的本位）
    // 模型半场照常（repaint 是新真相——挂起期也不丢投影：复起全帧重画携带）；
    // 审批决策行随投影重建（挖掘 31 轮 [1]——数据源装配注入闭包，缺席零变化）；
    // todo 快照块随投影重建（挖掘 35 轮 B8——同数据源两路共用，缺席零变化）
    this.transcript.loadProjection(
      projection,
      this.approvalDecisionsSource?.(sessionId),
      this.todoSnapshotsSource?.(sessionId),
      this.modelChangesSource?.(sessionId), // 模型切线块随投影重建（52 轮件 B——缺席零变化）
      this.noticesSource?.(sessionId), // 宿主通知块随投影重建（53 轮件 C——缺席零变化）
      this.reviewsSource?.(sessionId), // 评审卡随投影重建（35 池件 9——缺席零变化）
    );
    // 等回声复位分治（切焦 vs 同焦 refresh——2026-10-06 切焦清账修）：切焦即
    // 新观察窗——旧焦提交流的抑制位无条件清账（新焦零块空会话时条件 settle
    // 恒不触发，引导被旧焦瞬态抑制到「编辑器再键入」才解锁）；同焦 refresh
    // seam 重画维持条件 settle（submissions 的 user 块 write-behind 窗内投影
    // 回写未含在途稿件——无条件清会在重画帧闪引导一帧）
    if (focusSwitched) this.awaitingEcho = false;
    else this.settleAwaitingEcho();
    this.resetUsage(); // 件 6：清行并归零（切焦清账重计——尾注射界）
    // 全域清扫 G2：repaint 清账面连清转轮与工具名——旧焦 run 的 agent_end 以
    // 非聚焦态到达不触 applyFocusedEvent 的停帧（修前转轮/旧工具名跨会话永久
    // 残留）；新焦在飞（trackProgress 按会话净计数——聚焦位不参账）重建忙态
    // （界面美化役批 4：忙态呈现归任务行——中途附着 elapsed 无起点诚实缺席）
    this.taskLine.goIdle();
    if ((this.inFlightBySession.get(sessionId) ?? 0) > 0) this.taskLine.enterWorking();
    this.toolPanel.clear(); // 件 5：瞬时面不跨 repaint 保存
    // 切焦低频锚族（注⑪②③）：⎇ 槽 git 重读（cwd 漂移——git IO 三锚之一：
    // 构造期/本位 onRepaint/会话复起 resumeMain）
    // + 上下文清位（首轮前整段缺席律 per focus——新焦首轮 context_usage 落
    // 账前不虚承旧焦窗口占用；resetUsage 不清此对——上下文是会话级量，跨
    // run 边界幸存供下一 run 平滑基线）
    this.refreshFooterGit();
    this.contextUsedTokens = null;
    this.contextMaxTokens = null;
    this.refreshFooter(); // footer 低频缓存随切焦重拉（tiers fold/cwd 现值）
    this.osc.setTitle(`${this.titleBaseline} · ${shortIdOf(sessionId)}`); // 件 7：title 点缀会话短 id（终端级外显——挂起期照常，批 10f-4 裁）
    // 权威全量重建——排队旧帧作废（repaint 是新真相，合并无意义）；清点前先
    // 抢救合并窗内未落帧瞬时行（第五役 S1-a——suspendMain 挂起转账律的对称
    // 面：裸清会永失竞窗内 notify 行，不入 scrollback 不复显）
    const rescued = this.collectAllTransients();
    // 空态引导第四门随权威清点重置（07 §4.1 空转写态注）：rescued 全量即将
    // 重放落地——清点空 = 重建后转录区纯净（引导按门复现）；对账随后、
    // repaint 全量重画前（present 编舞按态落画/清账；挂起闸支翻转的
    // present op 入队即弃——suspendMain/resumeMain/复起 handleResize 前恒清队）
    this.transientLanded = rescued.length > 0;
    this.syncEmptyGuide();
    this.pendingOps = [];
    this.needFixed = false;
    if (this.suspendedMain) {
      // 挂起闸：屏上零写出（复起全帧重画携带新投影）——抢救行转账复起补吐
      //（防御位：挂起期瞬时行恒直入 suspendedTransients，队列理论空）
      this.suspendedTransients.push(...rescued);
      return;
    }
    this.screen.repaint(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    this.replayTransients(rescued); // 重建后按到达序补吐（槽让位/现宽收口编舞单源）
    this.renderFixed();
  }

  /**
   * 任务行动画推帧（自驱定时器内调；公开面留装配侧手动驱动——忙态外
   * 零开销）。界面美化役批 4：忙态呈现（转轮/速度/耗时）迁移至任务行——
   * 状态行专注 footer 常驻段 + 闲态尾注，忙态不再驱动故不推帧。
   */
  tick(): void {
    if (!this.animationsEnabled) return; // 禁用形零推帧零重绘（挖掘 35 轮 B2+B4）
    if (!this.taskLine.isBusy) return;
    this.taskLine.tick();
    // 溢出释放排空腿（挖掘 43 轮件 B——首例 tick 触转录面）：停流期
    //（message_update 静默）积压仍在——tick 读主屏帧末快照推帧续释放（释放
    // 步进按「目标−已释放」差值驱动非每 tick 定增；与 message_update 帧同窗
    // 合并由 enqueuePresent 既有语义承载；停流积压最坏 120ms 龄门 + 80ms
    // tick 周期 ≈200ms 追平）。scheduleFn null ⇒ 装配 pacing off ⇒ 快照恒
    // false 恒惰性——公开手动驱动面语义不变
    if (this.screen.releaseBacklogActive) {
      this.enqueuePresent();
      this.requestRender();
    }
    this.touchFixed();
  }

  /** run 级用量累计观测面（件 6——装配/宿主侧二次消费） */
  get usageView(): UsageAccumulation {
    return { ...this.usageTotal };
  }

  /**
   * run 级平均速度观测面（tok/s——三反馈批C；V-4 注⑪⑦ 任务行/尾注双消费位
   * 退役后为宿主侧二次消费位：行1 速度段〔笔3〕）：run 中 = 刷新锚时刻现算
   * running average；终态后保持终值（终点时戳冻结分母）至下次清账；无起点/
   * 亚秒/零 token 返 null（诚实缺席——消费面自行省段）。流中相位的速度呈现
   * 走 streamSpeedView（估值平滑腿——本面仍 settled 口径不动）。
   */
  get speedView(): number | null {
    return this.runSpeedTokensPerSecond();
  }

  /**
   * 流中速度（行1 速度槽流中相位——注⑪⑥c「一机制喂两槽」速度腿）：本轮
   * 估值 token ÷ 本轮流式已历时（turnStreamStartedAt 起注入钟）。诚实缺席
   * 三形返 null：无流式起点（repaint/切焦中途附着）、零估值 token、亚秒窗
   * （与 settled 速度同律——亚秒平均速度无意义）。终态与流中窗外不走本路
   * （speedView settled 真值）；终态呈现抑制归 speedSuppressed 既有律。
   */
  private get streamSpeedView(): number | null {
    if (this.turnStreamStartedAt === null) return null;
    const tokens = this.turnEstimator.estimate();
    if (tokens <= 0) return null;
    const elapsedMs = this.now() - this.turnStreamStartedAt;
    if (elapsedMs < 1000) return null;
    return (tokens * 1000) / elapsedMs;
  }

  /**
   * resize 尾随防抖（41 轮件 I）：onResize 回调经 75ms 尾随重置窗汇流——SIGWINCH
   * 风暴（拖拽期连发）只认末次事件后执行 handleResize（窗内新事件重开窗）。
   * 走 scheduleFn seam（照 drainInput :1606 先例——注入钟 rig 以
   * clock.advance(75) 自然驱动，缺省真 setTimeout）；handleResize 非事件路
   * （resumeMain 直呼）不受辖。
   */
  private scheduleResizeRepaint(): void {
    const schedule = this.scheduleFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    if (this.resizeDebounceHandle !== null) this.cancelFn(this.resizeDebounceHandle);
    this.resizeDebounceHandle = schedule(() => {
      this.resizeDebounceHandle = null;
      this.handleResize();
    }, RESIZE_DEBOUNCE_MS);
  }

  /** resize 编舞：几何重取 + 主屏全量重画 + 固定区按新几何重建（权威重建不走队列） */
  handleResize(): void {
    if (this.suspendedMain) return; // 挂起闸：停屏期零写出（此刻写出污染在场副屏）——几何真值由复起全帧重画重取吸收
    // 编辑器高度帽随几何重算（批 10k 遗漏修——此前构造期一算永不随动：缩窗后
    // 帽仍按初始行数，固定区总高可超屏行）；显式注入帽恒尊注入值（测试语义）
    this.editor.setMaxVisibleLines(this.fixedEditorCap ?? editorHeightCap(this.io.size().rows));
    // 清点前抢救合并窗内未落帧瞬时行（第五役 S1-a——onRepaint 同律注）；重建
    // 后补吐走 replayTransients 现宽收口（抢救行可能是 resize 前旧宽折行产物
    //——新几何逐行重截，保账优先截宽非丢行）
    const rescued = this.collectAllTransients();
    // 空态引导第四门随权威清点重置 + 对账（07 §4.1 空转写态注——序同
    // onRepaint）：清点后、几何重取全量重画前（引导按新态新几何落画）
    this.transientLanded = rescued.length > 0;
    this.syncEmptyGuide();
    this.pendingOps = [];
    this.needFixed = false;
    this.screen.handleResize(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    // footer 段集（V-4 注⑪ 笔3——resize 高频路只刷低频缓存零 git 读盘〔⎇ 槽
    // 归 refreshFooterGit 独立低频锚〕；坍缩几何随渲染期现宽自适应）。**必须
    // 后于 screen.handleResize**：缺省同步 flush 档（scheduleFn null）下拼段的
    // touchFixed 即触发 flush——Screen 几何若未先收敛，中途全量写出按旧行位
    // 落杯 = 缩窗后越屏定位（挂账解挂批 C② 修前红实证——极小终端固定区截断
    // 测试抓获：12 行屏杯位写上 5 行屏）。
    this.rebuildFooter();
    this.replayTransients(rescued); // 重建后按到达序补吐（槽让位/现宽收口编舞单源）
    this.renderFixed();
  }

  /* ---------------- 阻塞四件（浮层面板呈现——07 §4.3） ---------------- */

  /**
   * 是/否确认：ConfirmPanel 浮层（Enter → true / Esc → false；signal abort
   * 保守值 + 关层——撤销呈现归 ask-decision 落史行，挖掘 36 轮 [2] ⏹ 瞬时行
   * 退役：不传撤销词面即不落瞬时行）
   */
  confirm(message: string, opts?: UiAskOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // onQuit 透传（ctrl+d 浮层期退出——副屏件族「先收屏再转 onQuit」同路）
      const panel = new ConfirmPanel({ message, onQuit: this.onQuit });
      const handle = this.openAskLayer(panel, () => resolve(false), opts?.signal);
      panel.onFinish = (confirmed) => {
        handle.close();
        resolve(confirmed);
      };
    });
  }

  /** 单选：SelectPanel 浮层（Enter → value / Esc → ''；ui-core 校验不在集保守值同收 ''——撤销呈现归 ask-decision 落史行同 confirm 律） */
  select(message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      const panel = new SelectPanel({
        title: message,
        options: choices.map((c) => ({ value: c.value, label: c.label })),
        theme: this.theme, // 一次性面板构造期定值（当前主题快照）
        onQuit: this.onQuit, // ctrl+d 浮层期退出（confirm/askApproval 三路同接）
      });
      const handle = this.openAskLayer(panel, () => resolve(''), opts?.signal);
      panel.onFinish = (value) => {
        handle.close();
        resolve(value);
      };
    });
  }

  /**
   * 自由文本：input-ask 形——提示行入固定区 + 编辑器转应答车（提交即应答，
   * 弹层抑制）；signal abort → '' 保守值 + 残稿清框（撤销呈现归 ask-decision
   * 落史行——挖掘 36 轮 [2] ⏹ 瞬时行退役，07 §4.3 撤销面句翻档为审批 ask
   * 专属）。
   *
   * 异会话 FIFO 队列化（07 §4.1 路由序条 input() 异会话 FIFO 定形注——十六役
   * 扫 #2；节号勘正 2026-10-04：原引 §4.3 系错引，该定形注真源在 §4.1）：
   * 在飞问未收场时新问入队候接（不抢占队首——修前直覆使先问 promise 永悬）；
   * 应答/取消收场后队首自动晋升接续。排队问 abort = 静默出队保守值 ''（提示
   * 行从未上屏——零撤销痕迹：落史路单汇点侧同判「从未问出」零记录）。
   */
  input(message: string, opts?: UiInputOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      // 入参 signal 已中止早检（openAskLayer 同族对称兜底）：abort 事件是
      // 一次性广播——已发毕的 signal 再挂监听永不再触发（Node 实证），激活
      // 即占应答车成僵尸问（无人能收、promise 永悬）。ui-core 侧 ask 入口
      // 已有早退护栏，UiBackend 是公开面——其他装配方直传时由此兜底：零
      // 呈现直收保守值（从未上屏——零撤销痕迹、不清框）
      if (opts?.signal?.aborted) {
        resolve('');
        return;
      }
      const ask: InputAsk = { message, placeholder: opts?.placeholder, sensitive: opts?.sensitive, resolve };
      // abort 分派按收场时态判（排队→激活两态同一监听——入队后才 abort 的
      // 排队问仍走激活态撤销面，不因注册时态漏接）
      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (this.inputAsk === ask) {
            // 激活态 abort：残稿清框 + 保守值收口（撤销呈现归 ask-decision
            // 落史行——挖掘 36 轮 [2] ⏹ 瞬时行退役，此处不再落瞬时行）
            this.inputAsk = null;
            this.resumeElapsedClock(); // 应答窗关——耗时恢复走表（挖掘 31 轮 [8]；比对位=单汇点盖四值收口）
            this.editor.setText('');
            this.autocompleteCompleter.cancel();
            this.popup.applyResult(null);
            resolve('');
            this.continueInputQueue();
            // 注意态对账在接续之后（件 C）：接续激活会话开新窗——先 sync 会写
            // 一次假收态帧（接续窗即刻又开），置后则接续的 activateInputAsk
            // sync 直开真态，零中间帧
            this.syncAttentionTitle();
          } else {
            // 排队态 abort：静默出队（从未上屏——不落撤销说明行）
            const idx = this.inputQueue.indexOf(ask);
            if (idx === -1) return; // 已应答收场——迟到 abort no-op
            this.inputQueue.splice(idx, 1);
            resolve('');
          }
          this.touchFixed(); // 提示行排队数缀标随帧刷新
        },
        { once: true },
      );
      if (this.inputAsk !== null) {
        this.inputQueue.push(ask); // 在飞问在场：入队候接（FIFO）
        this.touchFixed(); // 提示行排队数缀标随帧刷新
      } else {
        this.activateInputAsk(ask);
      }
    });
  }

  /** 队首问激活（首问直入与队列出队接续共用——清框 + 弹层抑制 + 请帧） */
  private activateInputAsk(ask: InputAsk): void {
    // 开窗位 lone-ESC 挂起隔离（39 池 P4 typeahead 竞窗批）：开窗前按下的
    // ESC 判定窗（30ms）定时器尚在飞——不隔离则窗到点 settle 成键落入新开
    // 窗的键面（应答车无层栈可让路，busy 时直落打断腿——陈键改写为打断意
    // 图）。弃置与换防吞在途同律（suspendMain 先例）；粘贴/预编辑态不动——
    // 应答车续用主编辑器，续收语境须保全。取消定时器在前（漏收则 settle
    // 恒无挂起、空转无害）。
    this.cancelTimer('escape');
    this.decoder.discardPendingEscape();
    this.inputAsk = ask;
    // 模态编辑悬置（冷读闸 P1）：应答车复用主编辑器（路由层④无条件落
    // editor.handleEvent）——模态 normal 态会把应答文本吃成命令（字母静默丢、
    // 'x' 删应答字符、审批/提问生命线失能）。开窗即卸模态层（态随卸装重置
    // 可接受——恢复位归 continueInputQueue 空队退役；接续窗在悬置态续开）。
    // 对照纪律：粘贴图路径对 inputAsk 显式让位同形（模态是另一层输入语义，
    // 应答车道一票让位）。
    if (this.editor.isModalEditing()) {
      this.modalSuspendedByAsk = true;
      this.editor.setModalEditing(false);
    }
    this.pauseElapsedClock(); // 应答车开窗——耗时暂停（挖掘 31 轮 [8]：浮层等待期不计）
    this.editor.setText(''); // 应答起始清框（草稿让位——提交路模型自清）
    this.stagedImages = []; // 暂存图同笔让位（56 轮闸 P2）：应答提交走 ask 早退支不经 consumeStagedImages——不清则陈账孤儿化（无占位提交=图静默消失；先再贴新图则 min 帽顶掉旧账反挂错图）。图随稿弃与 ctrl+v/路径变体两贴图路对 inputAsk 的让位姿态对齐（草稿车道一票让位）
    this.disarmLeaderWindow(); // leader 待续窗同收（56 轮闸 P3）：开窗前武装的 2s 窗跨窗滞留——分支字母虽有 inputAsk 闸挡（leaderBranchGatesOpen），闲态 ESC 被⓪ cancel 消费吞一击 + 提示位陈显待续态；开窗即拥有完整键面（陈窗不跨窗续）
    // 应答车占位文换装（挖掘 29 轮件 4）：enter 是收窗非提交——composer 缺省
    // 「输入消息…」在应答窗误导；opts.placeholder 透传优先、缺席用应答缺省
    this.editor.setPlaceholder(ask.placeholder ?? INPUT_ASK_PLACEHOLDER_TEXT);
    // 敏感形点符回显换装（挖掘 37 轮件 3）：sensitive 旗开 → editor 等宽
    // '*' 掩码 + 提交路自动携位；复位在 continueInputQueue（每窗重设）
    this.editor.setSensitive(ask.sensitive === true);
    this.autocompleteCompleter.cancel(); // 应答期弹层抑制：撤窗 + 在途作废
    this.popup.applyResult(null); // 在层即刻收层
    this.clearJobsCursor(); // jobs 光标让位（挖掘 26 轮 [5]——应答窗 enter 属应答车道，劫持面随激活拆除）
    this.syncAttentionTitle(); // 注意态开（件 C——应答车在场判据位）
    this.touchFixed();
  }

  /** 出队接续（应答/取消收场后队首晋升——FIFO 串行链不断；空队退役占位文回 composer 缺省） */
  private continueInputQueue(): void {
    const next = this.inputQueue.shift();
    if (next !== undefined) this.activateInputAsk(next);
    else {
      // 收场对称位 lone-ESC 挂起同收（56 轮件 ④——54B 补两开窗位漏收本位）：
      // 应答窗期按下、判定窗（30ms）定时器在飞的 ESC 在收场后到点 settle 成
      // 键落回主屏键面（busy 时直落打断腿）——用户已答完问，陈键改写为打断
      // 意图。与开窗位同律（activateInputAsk）；接续位（next !== undefined）
      // 不走本位——接续的 activateInputAsk 开窗位已同收。取消定时器在前
      // （漏收则 settle 恒无挂起、空转无害）。收场三汇点（submit / 激活态
      // abort / 停机后迟到 abort）同走本位——单一收口覆盖三路。
      this.cancelTimer('escape');
      this.decoder.discardPendingEscape();
      this.editor.setPlaceholder(undefined); // 应答车退役——占位文回 composer 缺省（队列接续时 activate 再换装）
      this.editor.setSensitive(false); // 敏感模式复位（挖掘 37 轮件 3——队列空退役位；接续窗 activate 按新 ask 重设）
      // 模态编辑恢复（冷读闸 P1 对称位——与占位文/敏感位同「空队退役」时序）：
      // ask 窗悬置的模态在队列真空时复装（fresh normal 态——态随装卸重置）。
      // 接续窗不走此位（activateInputAsk 续悬置）；abort 收口两路（激活/排队）
      // 与 submit 收口同汇本位，单一恢复点覆盖三收场。
      if (this.modalSuspendedByAsk) {
        this.modalSuspendedByAsk = false;
        this.editor.setModalEditing(true);
      }
    }
  }

  /**
   * 审批：SelectPanel 浮层四值（批准/拒绝/总是批准/取消——Esc 面板保守值 ''
   * 映射 cancel，与 07 §4.3 收口律对齐）；always 草案经 hint 段呈现（回写
   * 归通道核 settleApprovalAlways——本件只呈现与回值）。signal abort 收口
   * 'cancel' 保守值 + 撤销说明行（文案「审批」区分于 input/confirm/select
   * 三件——07 §4.3 撤销面）。
   *
   * 件 B（2026-10-16 用户三反馈）：构造位用 ApprovalPanel 呈现带标记
   * （SelectPanel 零逻辑子类）——renderFixed 据此把审批面板分组迁底栈带
   * （footer 之后、JobPanel 之前）；confirm/select 不随标维持应答段现位。
   */
  askApproval(_sessionId: string, request: ApprovalAskRequest, opts?: UiAskOptions): Promise<ApprovalAskAnswer> {
    // _sessionId：会话归属位随批 13b-3 后端面签名携带——TUI 呈现不消费（单屏
    // 焦点态无会话路由需求），SDK 通道后端以此路由 ask 帧
    // 桌面通知（notify-osc9）：审批到达即入账（优先级 1——同窗压过轮完成 0）；
    // 文案 = 工具中文名优先、摘要兜底（title 同源词料，纯呈现层零审批语义改动）
    this.enqueueNotice(
      `等待审批：${sanitizeNotifyText(request.toolName !== undefined ? toolFaceZh(request.toolName) : request.summary, 40)}`,
      1,
      'approval-waiting',
    );
    return new Promise<ApprovalAskAnswer>((resolve) => {
      const title =
        // ⚙ 走 HEAD_MARKS.tool 单源（panel-chrome 符号册——选型翻档只改一处）
        request.toolName !== undefined
          ? `${HEAD_MARKS.tool} ${toolFaceZh(request.toolName)}：${request.summary}`
          : request.summary;
      const panel = new ApprovalPanel({
        title,
        options: [
          { value: 'approve', label: '批准' },
          { value: 'reject', label: '拒绝' },
          { value: 'always', label: '总是批准', hint: request.suggestedEntry },
          { value: 'cancel', label: '取消' },
        ],
        theme: this.theme, // 一次性面板构造期定值（当前主题快照）
        onQuit: this.onQuit, // ctrl+d 浮层期退出（confirm/select 三路同接）
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
    this.armEscapeWindow();
    this.flushDecoderEvents();
  };

  /**
   * lone-ESC 判定窗定时器装排（锚点剩余延时 + 到点自愈重排——2026-09-21
   * 修复批，Engine armEscapeWindow 同款；主屏自持输入管线的门复制位同修）：
   * - 同步直出档（schedule 无注入）无窗即决（测试语义——单 chunk 不拆序）。
   * - 装排延时按 decoder 挂起锚点（escapePendingAt）算剩余量，非恒整窗；
   *   定时器到点 settle 后仍挂起 = 挂起锚点被换新（「旧挂起被续段消解 +
   *     chunk 尾起新挂起」形：装排被在飞门拒、旧定时器早到空转）→ 按当前
   *   锚点差值重排到新窗点。修前该形无人重装——新挂起永失 Esc 裁决、后续
   *   可打印键误判 alt+*（编辑器终局丢弃）。
   */
  private armEscapeWindow(): void {
    if (!this.decoder.hasPendingEscape) return;
    if (this.scheduleFn === null) {
      this.decoder.settle(); // 同步直出无窗即决（测试语义——单 chunk 喂入不拆序）
      return;
    }
    if (this.escapeHandle !== null) return; // 在飞门（自愈重排兜换锚形）
    const anchor = this.decoder.escapePendingAt ?? this.now();
    this.escapeHandle = this.scheduleFn(
      () => {
        this.escapeHandle = null;
        this.decoder.settle();
        this.flushDecoderEvents();
        if (this.decoder.hasPendingEscape) this.armEscapeWindow(); // 窗未满——自愈重排
      },
      Math.max(0, anchor + this.escapeWindowMs - this.now()),
    );
  }

  /**
   * leader 族激活位（B4——2026-10-05 ZCode TUI 对标批）：分支柄在场 + arm
   * 键未被占用两条件同时成立。柄缺席 = 族不激活（ctrl+x 透传编辑器——无
   * 绑定归终局丢弃，`?` 教学键 / ctrl+p 循环族「柄缺席不劫键」同律）；占用
   * = 族整体禁用（fail-loud 呈报归装配位 leaderArmBlockedNotice）。
   */
  private leaderFamilyActive(): boolean {
    return this.onLeaderBranch !== undefined && this.leaderArmOccupant === null;
  }

  /**
   * 教学窗七闸（`?` 教学键与 leader arm 共用门判——B4「复用门判函数勿复制」）：
   * 空稿 + 闲态 + overlay 不在场 + 弹层不在场 + 无 input-ask 应答窗 + 非 jump
   * 待靶期 + 非回搜态（挖掘 31 轮 [3]——搜索期 `?` 应入 query 作搜索词，劫去
   * 开帮助面板会把搜索态跨开/关残留）。任一不满足 = 键透传编辑器（终局丢弃
   * ——零打扰；待靶期透传则键作跳靶字符入编辑器消费——挖掘 27 轮 [4]：劫持
   * 开帮助面板会使待靶态跨开/关残留，关面板后首字素被吞作跳靶）。
   */
  private teachingGatesOpen(): boolean {
    return (
      this.inputAsk === null &&
      this.editor.model.isEmpty() &&
      !this.progressBusy &&
      this.stack.size === 0 &&
      !this.popup.visible &&
      !this.editor.hasPendingJump() &&
      !this.editor.isSearchingHistory()
    );
  }

  /**
   * leader 分支门五闸（B4——arm 门减闲态）：忙期不设闸——arm 后忙态起、窗内
   * 分支照开（忙期查 /jobs 任务清单正是高频用法）。回搜态闸（挖掘 31 轮 [3]）
   * ：搜索期 ctrl+x 后续字母应入 query（编辑器搜索态消费丢弃）而非误开分支。
   */
  private leaderBranchGatesOpen(): boolean {
    return (
      this.inputAsk === null &&
      this.editor.model.isEmpty() &&
      this.stack.size === 0 &&
      !this.popup.visible &&
      !this.editor.isSearchingHistory()
    );
  }

  /**
   * leader 事件分诊单源（B4）：头部（层⓪——armed 分诊）与层③.4（arm 位）
   * 两调用位共用同一纯函数（keys/leader.ts resolveLeaderIntent——机制语义
   * 照搬 ZCode leader 态机）。escape 忙态例外判据 = taskLine.isBusy（与层①
   * escape 打断判据同源——打断生命线优先）。
   */
  private leaderIntentFor(ev: import('../../engine/types.js').InputEvent): LeaderIntent {
    return resolveLeaderIntent({ armedUntilMs: this.leaderArmedUntilMs }, ev, this.now(), {
      armGatesOpen: this.teachingGatesOpen(),
      branchGatesOpen: this.leaderBranchGatesOpen(),
      busy: this.taskLine.isBusy,
    });
  }

  /**
   * leader 待续窗装排（B4）：锚 + 提示位翻待续态 + 窗到点退场定时器
   * （armEscapeWindow 自愈形——不搬 ZCode 提示滞留 wart）。重按重排（旧
   * 提示定时器先收再装，无重叠定时器）。同步直出档
   * （schedule 无注入）无定时器——提示位由后续 syncFooterHint 对账收敛。
   */
  private armLeaderWindow(): void {
    this.leaderArmedUntilMs = this.now() + LEADER_WINDOW_MS;
    this.syncFooterHint(); // 提示位升待续态（缓存守——翻转才重建）
    if (this.scheduleFn === null) return;
    if (this.leaderHintHandle !== null) this.cancelFn(this.leaderHintHandle);
    this.leaderHintHandle = this.scheduleFn(() => {
      this.leaderHintHandle = null;
      this.leaderArmedUntilMs = null; // 窗到点收锚（惰性窗判的主动清账半边）
      this.syncFooterHint(); // 提示随窗退场（重建 footer 收分支菜单）
    }, LEADER_WINDOW_MS);
  }

  /**
   * leader 待续窗收口（锚 + 提示定时器双清 + 提示位对账）：分支命中/取消/
   * 非匹配解除随手清账 / stop 定时器全收面 / suspend 复起陈窗不续。幂等
   * ——未装窗调用零副作用（syncFooterHint 缓存短路）。
   */
  private disarmLeaderWindow(): void {
    this.leaderArmedUntilMs = null;
    if (this.leaderHintHandle !== null) {
      this.cancelFn(this.leaderHintHandle);
      this.leaderHintHandle = null;
    }
    this.syncFooterHint();
  }

  /** 排空 decoder 事件队列并逐件路由 */
  private flushDecoderEvents(): void {
    for (const ev of this.decoder.take()) this.routeEvent(ev);
  }

  /**
   * 事件路由四层（07 §4.3 拦截链序）。
   * 层⓪ leader 待续态分诊（B4——2026-10-05 ZCode TUI 对标批）：armed 态对
   * 每输入事件先判——分支字母命中即消费（字母不入稿）、escape 取消即消费、
   * 其余任意事件解除 + 透传（吞零键——层①②③先消费的键也在此解除，待续
   * 态不滞留成陈态）；arm 意图在此不消费（归层③.4——模态期间不 arm 的
   * 结构位）；
   * 层① 全局键先于 overlay（ctrl+c 打断 run——ask 链收口经装配侧信号折入；
   * ctrl+d 两步序——浮层在场让路、非空草稿首击清稿+回执、空稿单击直退，
   * 2026-10-05 ZCode 对标批翻档；2026-10-06 死面收口窗维度退役）；
   * 层② overlay 模态独占（未消费键不穿透）；层③ 补全弹层非模态穿透；
   * 层③.4 leader arm 位（B4——ctrl+x 五闸入待续态，见下点位注）；
   * 层④ 编辑器（未消费键终局丢弃——escape 等无全局绑定）。
   */
  private routeEvent(ev: import('../../engine/types.js').InputEvent): void {
    // 层⓪ leader 待续态分诊（B4）：族激活（柄在场 + ctrl+x 未被占用）才参与。
    // followup 分发复用装配柄（命令 dispatch 单源——backend 不自持面板路由）；
    // 合并游程余字素补入稿（jump 待靶态同律——不随分支字母丢字）
    if (this.leaderFamilyActive()) {
      const intent = this.leaderIntentFor(ev);
      if (intent.kind === 'followup') {
        this.disarmLeaderWindow(); // 分支命中随手收窗
        if (intent.rest !== '') {
          this.editor.model.insertText(intent.rest); // 余字素入稿（'bm' 合并形）
          this.touchFixed();
        }
        this.onLeaderBranch!(intent.branch); // 族激活位已保柄在场（非空断言安全）
        return;
      }
      if (intent.kind === 'cancel') {
        this.disarmLeaderWindow(); // escape 取消（闲态）——消费
        return;
      }
      if (intent.kind === 'disarm') this.disarmLeaderWindow(); // 解除 + 透传（吞零键）
      // 'arm' / 'none' 透传——arm 归层③.4（模态期间不 arm 结构位）
    }
    // 层① 全局键经键位注册表解析（批 10i R5——册单源取代硬编码判键；ctrl+d
    // 两步序的浮层让路/草稿分诊留在路由层：册只管键匹配、分层消解
    // 归层序——不可覆盖动作无用户改键面）。ESC 接线让路（界面美化役批 2）：
    // escape 扩入中断键集后在此分诊——浮层（overlay/补全弹层）在场归浮层
    // 收屏（不穿透打断）、栈空且忙态才打断、闲态终局丢弃（编辑器无绑定）；
    // ctrl+c 恒打断（与 escape 分诊无关——生命线键无让路面）。退避窗内
    // escape 同走打断（onInterrupt → 驱动侧 abortableSleep 收假 → aborted）。
    if (ev.kind === 'key' && ev.phase === 'press') {
      if (this.keymap.actionMatches(ev, 'global.interrupt')) {
        const isEscape = keyEventToBinding(ev) === 'escape';
        // 三分诊（+ 后台任务光标态收场位——界面美化役批6）：浮层在场 →
        // 让路收屏（不穿透打断）；escape 且任务段光标态在场 → 收光标
        //（导航模式退出优先于打断——收场非打断意图）；escape 且闲态 →
        // 丢弃（透传编辑器终局丢弃）；其余（ctrl+c 恒 / escape 忙态）→ 打断
        if (isEscape && (this.stack.size > 0 || this.popup.visible)) {
          // 让路（落层② overlay / 层③ 弹层收屏——不吃中断）
        } else if (isEscape && this.clearJobsCursor()) {
          // 后台任务段光标态在场——escape 收光标即消费（清后态）；
          // 不在场时 clearJobsCursor 返 false 落入后续分诊零扰动
        } else if (isEscape && this.editor.isSearchingHistory()) {
          // 回搜态让路（挖掘 31 轮 [3]）：escape 收搜还原草稿——搜索模态
          // 收场优先于打断与丢弃（含忙态——忙期回搜备稿是正态，收场非中断）
        } else if (!isEscape || this.taskLine.isBusy) {
          this.onInterrupt?.(this.sessionId);
          return;
        }
      }
      // ctrl+d 防误退两步序（2026-10-05 ZCode TUI 对标批——07 §4.1 R5 ctrl+d
      // 翻档注）：自「三条件闸单击直退」翻档为序判——①浮层在场=让路不退
      // （不变——透传浮层，面板族自持「先收屏再转 onQuit」）；②非空草稿
      // =清稿 + notify「已清空——再按 Ctrl+D 退出」（次击落空稿腿直退）；
      // ③空稿+无浮层=单击直退（空稿无清稿步、维持即时性——②清稿后的次击
      // 同归此腿）。global.quit 不可覆盖位语义不变（册面零动）。
      // 2026-10-06 死面收口（复盘件1·零行为变删除）：原②装 2 秒双击窗、③
      // 按窗内/窗外分「二击进退闸/直退」两分支——两分支体逐语句全等（窗维
      // 度零读位差异），且 arm 窗零视觉面（纯置旗 + 定时器清旗），属机械死
      // 面；窗五标识符（armed 位/定时器柄/装窗/收窗两方法/窗常量）全删，两
      // 分支合一为空稿直退单腿。
      if (this.keymap.actionMatches(ev, 'global.quit')) {
        if (this.stack.size > 0) {
          // ① 让路：浮层模态先消费（ctrl+d 归面板——不在此退）
        } else if (!this.editor.model.isEmpty()) {
          // ② 首击：清稿 + 回执（次击直退——见③）
          this.editor.setText('');
          // 暂存图同笔让位（57 轮件③修A）：清稿腿是稿 wipe 位——占位随稿灭而
          // 图账不清则陈账孤儿化（与 activateInputAsk 让位位对称——草稿车道
          // 一票让位；占位对账器不辖空稿终态帧，本位是显式清账位）
          this.stagedImages = [];
          this.autocompleteCompleter.cancel(); // 补全弹层锚在草稿前缀——清稿即撤层
          this.popup.applyResult(null);
          this.notify('已清空——再按 Ctrl+D 退出');
          this.syncFooterHint(); // 教学提示门控对账（setText 绕 handleEvent 单源锚）
          this.syncEmptyGuide(); // 空态引导对账（同 setText 旁路——零块态清稿即复现）
          this.touchFixed();
          return;
        } else {
          // ③ 直退（空稿——②清稿后的次击同归此腿，无窗维度）
          this.onQuit?.();
          return;
        }
      }
      // 真挂起（挖掘 41 轮件 III）：ctrl+z SIGTSTP 交终端给 shell——SIGCONT
      // 复起（fire-and-forget 异步链，handler 内 resumeFromShell）。win32
      // 键消费不生效（suspendToShell 平台守卫早退）；浮层在场不拦——挂起
      // 编舞先出屏，复起重画浮层按行集重建（与 resize 同形）
      if (this.keymap.actionMatches(ev, 'global.suspend')) {
        void this.suspendToShell();
        return;
      }
    }
    // 主屏 overlay 栈吃键即返——补帧对齐副屏路（mp-5 家族修同形）：SelectPanel
    // 光标/滚动窗随键变更，不补帧则闲态零帧源（tick 有 busy 闸）光标纹丝不动、
    // busy 态迟滞 ≤100ms；与弹层路 touchFixed/副屏路无条件请帧对称
    if (this.stack.routeEvent(ev)) {
      this.touchFixed(); // 面板态变更（光标/勾选/翻页）——固定区重建
      return;
    }
    // 弹层键路门（挖掘 29 轮件 5——与渲染门同源）：popupFrameRows 是上帧
    // budget.popup 的缓存——极矮屏梯牺牲位（渲染缺席）不吃键，透传编辑器
    if (this.popupFrameRows > 0 && this.popup.visible && this.popup.handleEvent(ev)) {
      this.touchFixed(); // 弹层高亮/隐层——固定区重建
      return;
    }
    // 层③.4 leader arm 位（B4——2026-10-05 ZCode TUI 对标批）：ctrl+x 经五闸
    //（= `?` 教学键同门——teachingGatesOpen 单源）入待续态。插入位结构性保
    //「模态期间不 arm」：overlay/弹层先消费的键到不了此（门判与层序各执
    // 一半——双保险）；门不开透传编辑器（ctrl+x 无绑定终局丢弃——零打扰）。
    // 待续中再按 ctrl+x 已在层⓪解除——此处恒为全新装窗（重按续窗语义）
    if (this.leaderFamilyActive() && this.leaderIntentFor(ev).kind === 'arm') {
      this.armLeaderWindow();
      return;
    }
    // 层③.5 应用动作键（批 10i——思考块/工具卡会话级折叠展开；overlay 模态
    // 已在上层独占、补全弹层未消费才达此，编辑器不绑 ctrl+t/ctrl+o 无争键）。
    // 模型循环（挂账解挂批 2026-09-15——ctrl+p）与档位模式循环（2026-10-05
    // ZCode 对标批——shift+tab）同层入册：柄缺席不劫键不炸
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
      // 档位模式循环（2026-10-05 ZCode TUI 对标批——shift+tab 层③.5 应用动作
      // 路，ctrl+p 同构接法）：动作体在装配闭包（单源消费 fold 现值 + 走
      // selectSandbox 写面——两入口一动作）；路由层只判键分发
      if (this.onModeCycle !== undefined && this.keymap.actionMatches(ev, 'global.mode-cycle')) {
        this.onModeCycle();
        return;
      }
      // 外部编辑器（挖掘 31 轮 [9]——ctrl+g 挂起交出形）：input-ask 应答窗
      // 不触发（应答期编辑器作应答车——稿位属应答车道，ctrl+g 让位）；回搜
      // 态让位（挖掘 32 轮修——稿位被预览占据非用户草稿，劫稿会把历史预览
      // 当种子外流且读回整替静默丢开搜前草稿；[3] 守卫族补位：搜索态事件
      // 被编辑器吃尽、上层分诊须让位）；在飞位防重入（异步编舞期同键再按
      // 零响应）；编舞与三态分诊在 openExternalEditor（suspendMain + raw
      // 复先验交子进程 + resumeMain）
      if (
        this.inputAsk === null &&
        !this.externalEditorInFlight &&
        !this.editor.isSearchingHistory() &&
        this.keymap.actionMatches(ev, 'editor.external-edit')
      ) {
        void this.openExternalEditor();
        return;
      }
      // 剪贴板图片直贴（TUI 剪贴板图片直贴批——ctrl+v）：读链+受理缝双在场才
      // 劫键（缺席透传编辑器——无绑定归终局丢弃，seam 关 = 功能关）；input-ask
      // 应答窗让位（应答车道同 ctrl+g 判）；回搜态让位（稿位被预览占据——搜索
      // 态守卫族同款）；在飞位防重入（异步读期同键再按零响应）。异步读不阻塞
      // 编辑器——回执期入稿（四静默形零弹错零入稿）
      if (
        this.inputAsk === null &&
        !this.externalEditorInFlight &&
        !this.editor.isSearchingHistory() &&
        !this.pasteImageInFlight &&
        this.clipboardImageReader !== undefined &&
        this.imageIntake !== undefined &&
        this.keymap.actionMatches(ev, 'editor.paste-image')
      ) {
        this.handlePasteImageKey();
        return;
      }
      // 后台任务段光标翻页态（界面美化役批6——UX 批6 B 件）：alt+↑/↓ 段内
      // 移动光标（直达判形）；jobs 段在场且有行才劫（空段/注入缺席透传——
      // 既有键语义零扰动）；enter 光标激活期开 /jobs 副屏定位在选任务（未激活
      // 不劫——提交语义零扰动；开屏失败〔副屏已占〕清光标消费不透传）。
      // alt+↑ 双语义窗分割（挖掘 47 轮件 A 键位裁决）：光标未激活时让位编辑器
      // （弹回排队末条 editor.queue-edit-last 在册——弹回可用窗 = jobs 无行 ||
      // 光标未激活）；alt+↓ 恒劫持（首按激活光标现状保留）。input-ask
      // 应答窗闸（挖掘 26 轮 [5]——「?」教学键 teachingGatesOpen 同款门）：
      // 应答期编辑器作应答车接管提交首序，enter 属应答车道——alt+↑/↓ 与
      // enter 两劫持腿皆让位
      if (this.jobsSource !== undefined && this.jobPanel.hasRows && this.inputAsk === null) {
        const isAltUp = ev.alt && !ev.ctrl && !ev.shift && !ev.meta && ev.key === 'up';
        const isAltDown = ev.alt && !ev.ctrl && !ev.shift && !ev.meta && ev.key === 'down';
        if (isAltDown || (isAltUp && this.jobPanel.cursorActive)) {
          this.jobPanel.moveCursor(isAltUp ? -1 : 1);
          this.touchFixed();
          return;
        }
        if (
          !ev.alt &&
          !ev.ctrl &&
          !ev.shift &&
          !ev.meta &&
          ev.key === 'enter' &&
          this.jobPanel.cursorActive &&
          !this.editor.isSearchingHistory() // 回搜期 enter 归编辑器采编（挖掘 32 轮——搜索态让位守卫族）
        ) {
          const selectedId = this.jobPanel.selectedId;
          const opened = selectedId !== null && this.openJobs(selectedId);
          if (!opened) this.clearJobsCursor();
          return;
        }
      }
    }
    // 层③.7 闲态教学键（V-3 注⑦④——`?` 开 /help 帮助副屏）：`?` 是可打印
    // 字符走 text 事件（引擎地面态恒产 text——key 路永不命中；键位册条目仅
    // 投影可发现性）。门控 = 柄在场 + 五闸（teachingGatesOpen——B4 起 leader
    // arm 同门复用此判：空稿 + 闲态 + overlay/弹层不在场 + 无 input-ask 应答
    // 窗〔应答期问题行在场、编辑器空、闲态——三闸全开但稿位属应答车道，`?`
    // 应作普通字符入应答稿而非劫去开 /help〕）——任一不满足透传编辑器
    //（'?' 作普通字符入稿——确定性测试基线零扰动）。
    if (ev.kind === 'text' && ev.text === '?' && this.onHelpShortcut !== undefined && this.teachingGatesOpen()) {
      this.onHelpShortcut();
      return;
    }
    // 空态引导等回声预置（07 §4.1 空转写态注落码定值）：非 '/' 起草稿的提交
    // 键（enter / alt+enter 候跑腿同形）在编辑器清稿**前**置位——清稿的
    // change 事件先于 onSubmit 到达，事后置位拦不住零块空稿瞬间的引导闪现帧。
    // '/' 起草稿走命令族（exit/本地/通道命令——无用户块回声）不置位：命令
    // 清稿后引导复现是正确终态；未注册 '/' 词兜底进消息（03 §2.2 驱动侧语
    // 义）形接受一次瞬现（回声到达即收——罕见形注记）。应答窗（inputAsk）
    // 的 enter 是收窗非提交，不入本预置；回搜态（挖掘 31 轮 [3]）enter 是采编
    // 预览非提交（无清稿无回声——预置会成永锁残留），亦不入
    if (
      ev.kind === 'key' &&
      ev.phase === 'press' &&
      ev.key === 'enter' &&
      !ev.ctrl &&
      !ev.shift &&
      !ev.meta &&
      this.inputAsk === null &&
      !this.editor.isSearchingHistory() &&
      !this.editor.model.isEmpty() &&
      !(this.editor.model.getLines()[0] ?? '').startsWith('/')
    ) {
      this.awaitingEcho = true;
    }
    // 粘贴路径变体面（39 轮 normalize_pasted_path——TUI 剪贴板图片直贴批）：
    // bracketed paste 文本恰为图片绝对路径/file:// URL 且文件在场（四族扩展名
    // + 5MiB 帽预检 + 受理链铸形）→ 转附件占位（与 ctrl+v 路同受理链同入稿形
    // 单源）；一切拒形（非路径/非四族/文件缺席/超帽/受理拒）静默回退原文本
    // 粘贴——旧粘贴行为零漂移。ask 应答窗让位（应答可能是路径文本本体——劫走
    // 即污染应答稿）；回搜态让位（query 输入面——搜索态守卫族）
    if (
      ev.kind === 'paste' &&
      this.inputAsk === null &&
      !this.editor.isSearchingHistory() &&
      this.imageIntake !== undefined &&
      this.tryPasteImagePath(ev.text)
    ) {
      return;
    }
    // 开搜转移检测（挖掘 31 轮 [3]）：层④调用前后搜态对照——开搜瞬间撤补全
    // 防抖窗与弹层（弹层锚在草稿前缀，搜索态稿件被预览占据锚即失效）
    const wasSearching = this.editor.isSearchingHistory();
    if (this.editor.handleEvent(ev)) {
      if (!wasSearching && this.editor.isSearchingHistory()) {
        this.autocompleteCompleter.cancel();
        this.popup.applyResult(null);
      }
      this.touchFixed();
    } // 稿件变更对账走 handleEditorChange 单源锚
  }

  /**
   * 思考块会话级开关（ctrl+t 批 10i）：transcript 翻态改写已落账块 +
   * screen.repaint 全量重渲（41 轮件 I 起 repaint 清屏走 REPAINT_PURGE_CLEAR
   * 连 scrollback 一并清——重画 = 权威重建 ⇒ scrollback 镜像最新重建，屏幕
   * 面与模型账立即一致；冻结账随 repaint 重置后按新态重建）。
   */
  private toggleThinking(): void {
    this.transcript.toggleThinking();
    this.authoritativeRepaint();
  }

  /** 工具卡会话级开关（ctrl+o 批 10i）——同律：改写 + repaint */
  private toggleToolCards(): void {
    this.transcript.toggleToolCards();
    this.authoritativeRepaint();
  }

  /**
   * 权威全量重画收口（挖掘 26 轮 [6]——toggle 两路抽单源）：翻转前入队的
   * present op 持翻转前块对象（rewriteExpandedFlags 换新块非原地改），迟到
   * 的帧回调会按旧 expanded 态重渲在飞流式槽尾窗——刚达成的翻转在屏面翻回。
   * 同 onRepaint/handleResize/suspendMain/resumeMain 四路权威重建律：清点前
   * 抢救合并窗内未落帧瞬时行（S1-a——裸清永失竞窗 notify 行）→ 清队
   * （pendingOps/needFixed）→ repaint → 补吐。
   */
  private authoritativeRepaint(): void {
    // 浮层挂起期不可达定谳（56 轮件 ③——本收口无 suspendedMain 闸非疏漏）：
    // 唯二触发路 = 路由层③.5 的 ctrl+t / ctrl+o 两键（toggleThinking /
    // toggleToolCards 单源，别无调用方），两键在两类浮层挂起期的命运——
    // - suspendedMain 态（副屏 / 外编 / 挂壳）：suspendMain 已解订输入——stdin
    //   事件零到达，键面整体不存在；
    // - ask 浮层态（askApproval / SelectPanel 族）：面板不置 suspendedMain
    //   （主屏固定区组成、editor 仍渲染），但路由层② overlay 栈模态独占先吃
    //   （栈非空恒返 true）——ctrl+t/o 到不了层③.5。
    // 故「repaint 位在浮层挂起期恒不达」，无须闸。对照 onRepaint / handleResize
    // 两路保留 suspendedMain 闸：其触发源不全是键（present 流式重渲 / 终端
    // resize 信号），浮层期外部可达、须闸。inputAsk 应答车期两键可达——但
    // 应答车非挂起态（主屏全活：editor 渲染 + 提交键面照常），重画合法。
    const rescued = this.collectAllTransients();
    this.transientLanded = rescued.length > 0;
    this.syncEmptyGuide();
    this.pendingOps = [];
    this.needFixed = false;
    this.screen.repaint(this.transcript.snapshot, this.transcript.trimmedBlockCount);
    this.replayTransients(rescued); // 重建后按到达序补吐（槽让位/现宽收口编舞单源）
  }

  /**
   * 编辑器提交路由：input-ask 应答优先 → 退出词本地拦截 → TUI 本地命令族
   * 拦截 → '/' 命令柄（false 兜底）→ onSubmit。候跑标记随两落点透传（挂账
   * 解挂批 2026-09-15——alt+enter 提交形第三参）。
   *
  /**
   * 弹回排队末条（挖掘 47 轮件 A——alt+↑ 收回编辑，onQueueEditLast 闭包体）：
   * 门序判据全归本闭包（编辑器只司键分发）。返回是否消费——应答窗/seam
   * 缺席返 false 键落终局无害；其余终局消费（保守拒/空弹诚实呈报/成功弹回）。
   * 回搜态不需守卫（editor.handleEvent 搜索态先拦吃尽一切键——结构性不可达）。
   */
  private handleQueueEditLast(): boolean {
    // ① 应答窗是应答车非编辑——弹回污染应答稿（「?」教学键同款门）
    if (this.inputAsk !== null) return false;
    // ② seam 缺席 = 功能关（键落终局无害——queueFor 同族注入律）
    if (this.queuePopLast === undefined) return false;
    // ③ 草稿非空保守拒（外编种子「非空稿不 seed」同律——写稿动作对非空稿
    // 是破坏性面）；终局消费防双弹
    if (!this.editor.model.isEmpty()) {
      this.notify('草稿非空——清空后再弹回（防覆稿丢失）', { level: 'warn' });
      return true;
    }
    // ④ 弹回：无可弹件（空队/仅图片或操控件）诚实呈报——专用键静默无反应
    // 是困惑面；终局消费
    const text = this.queuePopLast(this.sessionId);
    if (text === null) {
      this.notify('没有可弹回的排队文本件（空队或仅图片/操控件）', { level: 'info' });
      return true;
    }
    // ⑤ 成功：整替编辑稿（setText 旁路对账——ctrl+d 清稿双对账同形：syncFooterHint
    // + syncEmptyGuide）；成功不 notify（草稿可见填充即反馈）；touchFixed 帧首
    // 重拉 queueFor 面板自然缩容（renderFixed 帧首锚——手动重拉冗余）
    this.editor.setText(text);
    this.syncFooterHint(); // 教学提示门控对账（setText 绕 handleEvent 单源锚）
    this.syncEmptyGuide(); // 空态引导对账（零块态弹回填稿即退引导）
    this.touchFixed();
    return true;
  }

  /**
   * lifecycle 闸（迟到续链防——2026-09-23 B5）：onSubmit 两触达位（dispatch
   * 兜底 .then 续链位 + '/' 外直落位）前置 this.running 闸。真实窄窗 = 同
   * stdin chunk 粘贴形 quit 先行 + '/' 命令后随（如 '/exit\n/unknown\n' 单
   * chunk）：事件队列同批已取走、路由不受 stop 卸订影响，'/exit' 提交同步
   * onQuit → quitResolve 的 shutdown 级联（closer 内 backend.stop）是先排
   * 微任务、先于后随 dispatch .then 续链落地——续链在停机态（running=false、
   * 装配侧 manager 已 dispose）触达 onSubmit 可启新 LLM run。闸形 = 停机后
   * 提交静默丢弃（终退不可复用语义：退出即停一切续链）。
   */
  private handleSubmit(text: string, opts?: EditorSubmitOptions): void {
    const ask = this.inputAsk;
    if (ask !== null) {
      this.inputAsk = null;
      this.resumeElapsedClock(); // 应答窗关——耗时恢复走表（挖掘 31 轮 [8]；同拍 FIFO 接续若开新窗则同拍再暂停，零段折叠无害）
      ask.resolve(text);
      this.autocompleteCompleter.cancel(); // 应答收场：撤窗 + 在途作废（下轮 ask 重开）
      this.popup.applyResult(null); // 应答期抑制的补全层即刻收层
      this.continueInputQueue(); // 队首晋升接续（FIFO——十六役扫 #2）
      // 注意态对账在接续之后（件 C——与 abort 清位同律）：接续开新窗直开真态
      this.syncAttentionTitle();
      // 收窗后门控对账（B2 对称面）：模型清稿的 change 先于本分支到达（editor
      // 侧先 model.submit 后 onSubmit），彼时 inputAsk 仍在场——教学提示未随清稿
      // 复现；此处补对账（队列接续时 activateInputAsk 的 setText 会再翻回，
      // 缓存短路零重画）
      this.syncFooterHint();
      this.touchFixed();
      return;
    }
    // —— 暂存图消费（TUI 剪贴板图片直贴批）：占位行计数 × 暂存数取小定附图数
    // + 占位行剥除（暂存空不剥——手敲 `[图片]` 文本零误伤）。本位在 ask 收窗
    // 后、退出词/本地命令/`!` 直达前——剥除形单文本流贯通下游全分支（占位随
    // 草稿属提交语义，命令形吞稿路径图一并弃——「[图片]+/cmd」极端混合稿的可
    // 接受形）。暂存每提交清账（未附图一并弃——不跨提交滞留：防陈图错挂后续
    // 提交）
    const staged = this.consumeStagedImages(text);
    const submitText = staged.text;
    // 退出词先于通道命令分发（前端生命周期词不进通道核命令表——07 §4.1
    // 2026-09-15 /exit 批定形注：本地终局消费，永不兜底进模型消息）
    if (this.maybeHandleExitWord(submitText)) {
      return;
    }
    // TUI 本地命令族拦截（07 §4.1 命令面增补批——副屏/瞬时交互族同律：
    // 通道命令分发前本地终局消费，webui 面零污染）
    if (this.maybeHandleLocalCommand(submitText)) {
      return;
    }
    // shell 直达拦截（47 轮件 B——`!` 起头本地终局消费族：/exit 同律不穿透
    // 不兜底进模型消息；分支序 = '!' 判先、停机闸后——与 onSubmit 闸同构，
    // 闸在判据后只兜最终落点不前置吞后续 '/' 路由）
    if (this.maybeHandleBangCommand(submitText)) {
      return;
    }
    if (submitText.startsWith('/') && this.dispatchCommand !== undefined) {
      this.dispatchCommand(submitText)
        .then((handled) => {
          // lifecycle 闸（迟到续链防——头注窄窗形）：续链后到时已停机则不触
          // 达 onSubmit（false 兜底与闸合判——两条件皆真才落）
          if (!handled && this.running) this.onSubmit?.(this.sessionId, submitText, opts, staged.images); // 未命中兜底（03 §2.2 驱动侧语义）
        })
        .catch((err: unknown) => {
          // 命令处理器异常不静默不崩进程——呈现面兜底（命令面纪律归命令面）；
          // foldErrorText 单源折面（wf_3c8b00b8 组α）：BaseError 码直呈（裸
          // String 丢码）+ Error 腿免「Error: 」前缀噪音
          this.notify(`命令异常：${foldErrorText(err)}`, { level: 'error' });
        });
      return;
    }
    // lifecycle 闸（同上——同步停机形防：onQuit 直停装配下第二命直落位同闸）
    if (this.running) this.onSubmit?.(this.sessionId, submitText, opts, staged.images);
  }

  /* ---------------- 剪贴板图片直贴（ctrl+v 读链 + 路径变体面 + 提交消费） ---------------- */

  /**
   * ctrl+v 键路（TUI 剪贴板图片直贴批）：异步读剪贴板不阻塞编辑器 → 有图受理
   * 入稿占位。四静默形（无图/无命令/读失败/超时）零弹错零入稿——缝契约 null
   * 合流 + 异常面兜底同静默。在飞位由路由层门控 + finally 复位双保险。
   * win32 矩阵外先判（56 轮件 1a）：spawn 前即知不支持——notify info 显式回执
   * 非静默空集（ctrl+v 是显式图片意图，静默丢键反成暗亏——受理拒同姿态分职）。
   */
  private handlePasteImageKey(): void {
    const reader = this.clipboardImageReader;
    if (reader === undefined || this.pasteImageInFlight) return; // 路由层双 seam 门后的防御位
    const unsupported = this.clipboardImageUnsupportedReason();
    if (unsupported !== null) {
      this.notify(unsupported, { level: 'info' }); // 平台不支持——显式呈报（不设在飞位：零异步编舞）
      return;
    }
    this.pasteImageInFlight = true;
    void Promise.resolve(reader())
      .then((payload) => {
        if (payload === null) return; // 四静默形——零弹错零入稿
        if (this.inputAsk !== null || this.editor.isSearchingHistory() || this.externalEditorInFlight) {
          return;
        }
        // 回执期状态复查（冷读闸 P3①——ask 竞窗）：读链在飞最长 2s，期间
        // input-ask 开窗（应答车 setText('') 清稿复用主编辑器）后回执落地
        // 会把占位插进应答稿、且 ask 分支先返不消费暂存——应答原文带字面
        // 占位上行 + 真图静默孤儿化。复查路由层同判（ask 窗/回搜态/外编
        // 在飞任一在场 = 意图已让位）——静默弃，与四静默形同姿态。
        this.stageClipboardImage(payload);
      })
      .catch(() => undefined) // 读器异常面同静默（缝契约四静默形的兜底位）
      .finally(() => {
        this.pasteImageInFlight = false;
      });
  }

  /**
   * 受理入稿（ctrl+v 路）：受理缝铸引用块 → 暂存清单 + 稿面插占位行。
   * 拒形就地 notify 呈报——ctrl+v 是显式图片意图，静默丢图反成暗亏（路径变体
   * 面保守静默分立——两路姿态分职）；foldErrorText 折面（AttachmentIntake
   * RejectionError 用户面中文文案单源）。
   */
  private stageClipboardImage(payload: ClipboardImagePayload): void {
    const intake = this.imageIntake;
    if (intake === undefined) return;
    // 每消息累积帽（冷读闸 P3②）：超帽在受理前拒——先受理后弃会孤儿化已
    // 落盘附件。ctrl+v 显式图片意图 → notify 呈报（与受理拒同姿态分职）。
    if (this.stagedImages.length >= PASTE_IMAGE_MAX_STAGED) {
      this.notify(`图片未附加：一条消息最多带 ${PASTE_IMAGE_MAX_STAGED} 张图片`, { level: 'error' });
      return;
    }
    let refs: readonly ImageRefContent[];
    try {
      refs = intake([payload]);
    } catch (err: unknown) {
      this.notify(`图片未附加：${foldErrorText(err)}`, { level: 'error' });
      return;
    }
    if (refs.length === 0) return; // 空回执防御位（受理缝契约：非空即铸或抛）
    this.stagedImages.push(...refs);
    this.insertImagePlaceholder();
  }

  /**
   * 稿面插 `[图片]` 独占占位行：insertPaste 标记支路同款省侧劈行形（行首免
   * 前导/行尾免尾随换行——不留空行残骸），经 paste 事件单源路入模——undo
   * 单步可撤 + onChange 记账 + 标记行守卫族全量复用（不用 setText：其清粘贴
   * 标记登记不可追加形）。
   */
  private insertImagePlaceholder(): void {
    const cursor = this.editor.model.getCursor();
    const line = this.editor.model.getLines()[cursor.line] ?? '';
    const atStart = cursor.col === 0;
    const atEnd = cursor.col >= line.length;
    this.editor.handleEvent({
      kind: 'paste',
      text: `${atStart ? '' : '\n'}${COMPOSER_IMAGE_PLACEHOLDER}${atEnd ? '' : '\n'}`,
    });
    this.touchFixed();
  }

  /**
   * 路径变体面（39 轮 normalize_pasted_path）：粘贴文本恰为在场图片路径 →
   * 受理入稿返 true（消费不透传）；一切拒形返 false（静默回退原文本粘贴——
   * 旧行为零漂移）。受理拒也回退（变体面无显式图片意图——保守姿态与 ctrl+v
   * 路分职）。
   */
  private tryPasteImagePath(text: string): boolean {
    const intake = this.imageIntake;
    if (intake === undefined) return false;
    const path = pastedImagePath(text);
    if (path === null) return false;
    const payload = readImageFilePayload(path);
    if (payload === null) return false;
    // 每消息累积帽（冷读闸 P3②）：变体面保守姿态——超帽静默回退原文本粘贴
    if (this.stagedImages.length >= PASTE_IMAGE_MAX_STAGED) return false;
    let refs: readonly ImageRefContent[];
    try {
      refs = intake([payload]);
    } catch {
      return false; // 受理拒静默回退原文本粘贴
    }
    if (refs.length === 0) return false;
    this.stagedImages.push(...refs);
    this.insertImagePlaceholder();
    return true;
  }

  /**
   * 占位行对账滚帧（57 轮件③修B）：编辑器每变必经（onChange 单源——model
   * notify() 契约），prev/next 两帧占位行差分 → 被删占位从暂存清单弹除
   * （FIFO 取首在「多图部分删占位」形错挂——被删的图上行、留下的图被弃）。
   * 三让位形（让位也滚帧——帧连续是差分前提）：
   * ① 暂存空：纯记账零对账（对账只服务在账图）；
   * ② 回搜态 + 历史浏览态：预览/还原与 ↑↓ 浏览换稿均非用户删稿（57 轮
   *   闸 P1——browse 换稿帧 prev 占位「消失」会被判删弹空账、↓ 还原不可
   *   逆，让位保「浏览不伤图账」零漂移；浏览态编辑必先弃 draft，该形由
   *   提交期 markerCount 兜底清账）；
   * ③ 空稿帧（next === ''）：终态清稿两义位不辖——提交清（editor 先
   *   model.submit 清稿后 onSubmit，彼时暂存待 consumeStagedImages 消费，
   *   此帧弹除即全灭）/ 程序清稿（ctrl+d 与 ask 窗两腿自持显式清账）/ 用户
   *   删空（提交期 markerCount=0 兜底不附图）。
   */
  private reconcileStagedImageMarkers(): void {
    const next = this.editor.model.getText();
    const prev = this.imageMarkerFrameText;
    this.imageMarkerFrameText = next;
    if (this.stagedImages.length === 0 || prev === next) return;
    if (this.editor.isSearchingHistory() || this.editor.model.isBrowsingHistory() || next === '') return;
    this.stagedImages = dropStagedImagesForDeletedMarkers(prev, next, this.stagedImages);
  }

  /**
   * 提交期暂存图消费：占位行计数 × 暂存数取小定附图数 + 占位行剥除 + 清账。
   * 多图部分删占位的**身份化解挂**发生在编辑期（reconcileStagedImageMarkers
   * 按被删占位序位弹对应暂存图——57 轮件③修B）；本方法的计数 × 取小只是
   * 提交期残帽（对账后两数恒等的兜底——手敲占位混排形防幽灵挂附）。「删占
   * 位即解除挂附」的交互承诺由编辑期对账兑现；撤销恢复占位不复挂（新增占位
   * 零动作）。暂存空不剥（手敲 `[图片]` 文本零误伤——剥除只在真有暂存图的
   * 提交发生）；占位多于暂存时剥全部占位（手敲+直贴混合稿归直贴数——保守
   * 防幽灵占位）。
   */
  private consumeStagedImages(text: string): { text: string; images: readonly ImageRefContent[] } {
    const staged = this.stagedImages;
    if (staged.length === 0) return { text, images: [] };
    this.stagedImages = []; // 每提交清账（未附图一并弃——不跨提交滞留）
    const split = splitImageMarkerLines(text);
    const attachCount = Math.min(split.markerCount, staged.length);
    if (attachCount === 0) return { text, images: [] };
    return { text: split.text, images: staged.slice(0, attachCount) };
  }

  /**
   * 退出词拦截：`/exit` 恰零参命中即走 onQuit——与 Ctrl+D 空框同一优雅
   * 退出路（07 §4.1 /exit 批定形注；/quit 别名已随 2026-09-21 三反馈批A
   * 退役——退役词与一切未注册 /词 同路，走 '/' 起手命令柄兜底语义）。
   * 带参形 = 用法 fail-loud 提示不退出；onQuit 柄缺席 = 诚实拒（不虚报律）。
   * 返回 true = 已终局消费（调用位不再下渗）。ask 接管窗由调用序天然
   * 排除（应答优先——'/' 开头文本是应答非命令，既有裁决）。
   */
  private maybeHandleExitWord(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed !== '/exit') {
      // 带参形（/exit xxx）——用法提示后终局消费，不退不出也不兜底进消息
      if (trimmed.startsWith('/exit ')) {
        this.notify('/exit 不带参数（退出 TUI——效果同 Ctrl+D）', { level: 'warn' });
        return true;
      }
      return false;
    }
    if (this.onQuit === undefined) {
      this.notify('当前界面不支持 /exit——可按 Ctrl+D 退出', { level: 'warn' });
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
    try {
      spec.run();
    } catch (err: unknown) {
      // 执行体异常不静默不崩进程——呈现面兜底（dispatchCommand 路同句单源：
      // 同为提交路由的命令执行体，错误面处理不分叉；真装配下无此包会升格
      // uncaughtException 走崩溃编舞 exit(1)）；foldErrorText 同源（组α）
      this.notify(`命令异常：${foldErrorText(err)}`, { level: 'error' });
    }
    return true;
  }

  /**
   * shell 直达拦截（挖掘 47 轮件 B——07 §4.1 shell 直达条款）：`!` 起头提交
   * 剥前缀净命令走 runDirectShell seam（执行与回执归 host 装配——direct-shell
   * 机制件）。分支序：①非 `!` 起头 → false 落后续路（'/' dispatch / onSubmit）；
   * ②停机闸 → true 静默丢弃（onSubmit 同闸语义——终退不可复用）；③剥后空 →
   * 用法 fail-loud（/exit 带参同律）；④seam 缺席 → 诚实拒（不虚报律——不兜底
   * 进模型消息）；⑤执行。queueFollowUp 旗忽略（直跑无排队义——'!' 态
   * alt+enter 同走本路由）；`!` 文不入 timeline、编辑器历史册照入（↑ 可回灌）。
   * ask 应答窗由调用序天然排除（ask 分支先行——'!' 开头应答是应答）。
   */
  private maybeHandleBangCommand(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('!')) return false;
    // 停机闸（在判据后——与 onSubmit 闸同构：闸只兜最终落点）
    if (!this.running) return true;
    const command = trimmed.slice(1).trim();
    if (command === '') {
      this.notify('! 后接命令——如 !git status', { level: 'warn' });
      return true;
    }
    if (this.runDirectShell === undefined) {
      this.notify('当前界面不支持 shell 直达（! 前缀）', { level: 'warn' });
      return true;
    }
    this.runDirectShell(command);
    return true;
  }

  /** 编辑器内容变更：补全层重发查询（尾沿防抖——R6 批 10j）+ 固定区脏位 */
  private handleEditorChange(): void {
    // 占位行对账滚帧（57 轮件③修B）——先于其余对账（纯暂存账面，无呈现序约束）
    this.reconcileStagedImageMarkers();
    // 补全门（挖掘 31 轮 [3]）：回搜态的 change 是预览/还原翻转（applySearchPreview
    // 换稿、cancel 还原草稿）非用户编辑——不重发补全（弹层已随开搜撤，锚也失效）
    if (this.inputAsk === null && !this.editor.isSearchingHistory()) this.autocompleteCompleter.request();
    // 门控对账先于触脏（2026-10-04 B2 序修正）：翻转自带 rebuildFooter+touchFixed
    // ——若 touchFixed 在前，同步直出档会先落一帧旧 hint 态再落新态（应答窗
    // 开窗帧混入假键位残影）；注入调度档两请求虽合并无害，序仍以对账先行定形
    this.syncFooterHint(); // 教学提示门控对账（空稿翻转单源锚——一切稿件变更经此）
    this.syncShellMode(); // shell 直达态对账（47 轮件 B——同谱单锚：一切稿件变更经此）
    // 等回声复位（非空稿 = 新键入意图）：提交流的抑制位不复位会永锁空态引导
    if (!this.editor.model.isEmpty()) this.awaitingEcho = false;
    this.syncEmptyGuide(); // 空态引导对账（稿件翻转锚——同 B2 序：对账先于触脏）
    this.touchFixed();
  }

  /* ---------------- 内部：ask 浮层 ---------------- */

  /**
   * 开 ask 浮层：内联回退锚（fx2-D）+ signal abort 保守值收口 + 撤销说明行
   * （审批 ask 专属）+ 重绘请求。confirm / select / askApproval 三路共用本层。
   *
   * 「曾在屏者」判据（07 §4.3 语义纪律撤销面——三路统一处理；2026-10-14 挖掘
   * 36 轮 [2] 翻档：撤销说明行语义此后**审批 ask 专属**——阻塞三件〔confirm/
   * select/input〕的撤销呈现改记 ask-decision 落史行，本层 cancelLine 缺席形
   * 即不落瞬时行）：abort 传播到后端呈现时层仍未关（在 overlay 栈中）= 曾在
   * 屏 → cancelLine 在场才写撤销说明行入正文流 + 关层；面板已 done（onFinish
   * 先关层）后迟到的 abort 是 no-op，不误写。说明行只标撤销收场本身——保守
   * 值收口（与提问队列收口三则「保守值同撤销面」同源条款：审批项收 'cancel'、
   * 阻塞件各收保守值）由 promise 回值承载，行文不重复。
   *
   * 异会话 overlay 呈现串行化（07 §4.3 提问队列条 2026-10-04 定形注）：TUI
   * overlay 呈现位全局单槽——槽获取守卫在后端呈现层（present() 仍在 start 时
   * 即调，per-session 队列律在通道核不动——「通道核通道无关」纪律不破）。槽
   * 被占即入呈现等待队列（首次呈现到达序），先呈者占槽至落定（应答/保守值
   * 收场）即顶上；等待位收场（abort 传播/他后端先应答经信号折入）= 从未在屏
   * → 静默撤销——不开层、不落撤销说明行（「曾在屏者」判据的等待态推广）。
   */
  private openAskLayer(
    content: OverlayContent,
    abort: () => void,
    signal: AbortSignal | undefined,
    cancelLine?: string,
  ): OverlayHandle {
    // 入参 signal 已中止早检（纵深防御——十六役 N1 同族在 ask 浮层位的兜底）：
    // abort 事件是一次性广播，已发毕的 signal 再挂监听永不再触发——开层即成
    // 僵尸浮层（无人能答也无人能收）。ui-core 侧已有两道早检（入参已中止早退
    // + 排队件 abort 不晋升），但 UiBackend 是公开面——其他装配方直传已中止
    // signal 时由此兜底：零呈现直收保守值（从未在屏——不落撤销说明行）。
    if (signal?.aborted) {
      abort();
      return { close: () => {}, closed: true }; // 预关死句柄：调用方 onFinish 迟到 close 幂等 no-op
    }
    const waiter: AskLayerWaiter = { content, abort, cancelLine, settled: false, handle: null };
    // abort 收场编舞（等待/激活两态分治——同一监听按触发时态走面）：
    // - 激活态（已开层）：曾在屏 → 撤销说明行 + 关层（关层内含槽释放扫队）；
    // - 等待态（未开层）：从未在屏 → 静默撤销——出等待队列，零呈现零撤销行。
    signal?.addEventListener(
      'abort',
      () => {
        if (waiter.settled) return; // 已落定——迟到 abort no-op（面板 done 后不误写）
        waiter.settled = true;
        if (waiter.handle !== null) {
          // 激活态 abort：层仍在屏、cancelLine 在场才写（审批 ask 专属——
          // 阻塞三件缺席形零瞬时行，撤销呈现归 ask-decision 落史行）
          if (waiter.cancelLine !== undefined && !waiter.handle.closed)
            this.appendTransientLine(waiter.cancelLine, { persist: true });
          waiter.handle.close();
        } else {
          // 等待态 abort：静默撤销——出等待队列（从未在屏——不落撤销说明行）
          const idx = this.askLayerQueue.indexOf(waiter);
          if (idx !== -1) this.askLayerQueue.splice(idx, 1);
        }
        abort(); // 保守值收口（面板 done 锁下迟到 abort 是 no-op）
        this.touchFixed();
      },
      { once: true },
    );
    if (this.askLayerOwner !== null) {
      // 槽被占：入呈现等待队列（首次呈现到达序 FIFO）。「等待位可观测」匿名
      // 提示——阻塞三件后端面无 sessionId 位（规范注：匿名提示形可无签名变更
      // 落地），措辞取规范原句「他会话有待答问题」
      this.askLayerQueue.push(waiter);
      this.appendTransientLine('⏳ 他会话有待答问题（待当前问收场后呈现）', { persist: true });
      this.touchFixed();
    } else {
      this.activateAskLayer(waiter);
    }
    // 返预约句柄：closed 以落定为准（等待期收场即闭）；close 在等待期 = 静默
    // 撤销（调用方应答路 onFinish 不达等待位——防御位），激活后透传真句柄
    //（幂等 + 内含槽释放扫队）
    return {
      close: () => {
        if (waiter.settled) return;
        waiter.settled = true;
        if (waiter.handle !== null) {
          waiter.handle.close(); // 真句柄 close（含槽释放 + 等待队列接续）
          return;
        }
        const idx = this.askLayerQueue.indexOf(waiter);
        if (idx !== -1) this.askLayerQueue.splice(idx, 1);
      },
      get closed() {
        return waiter.settled;
      },
    };
  }

  /**
   * 占槽开层（槽空闲首呈 / 释放扫队激活两路共用）：真句柄包一层槽释放编舞
   * ——close 即释放单槽并按首次呈现到达序接续等待队列（「先呈者占槽至落定」
   * 的落定执法位；持槽者比对守卫使释放幂等）。
   */
  private activateAskLayer(waiter: AskLayerWaiter): void {
    // 开层位 lone-ESC 挂起隔离（39 池 P4 typeahead 竞窗批）：开层前按下的
    // ESC 判定窗（30ms）定时器尚在飞——不隔离则窗到点 settle 成键经层②占焦
    // 面板裁决（SelectPanel escape → 保守值 '' → cancel）：用户从未见过面板
    // 即被陈键收场。弃置与换防吞在途同律（suspendMain 先例）；取消定时器在
    // 前（漏收则 settle 恒无挂起、空转无害）。
    this.cancelTimer('escape');
    this.decoder.discardPendingEscape();
    this.disarmLeaderWindow(); // leader 待续窗同收（56 轮闸 P3）：层⓪ 先于层② 分诊——闲态窗内 ESC 被⓪ cancel 消费吞一击（面板 ESC 失灵）；分支字母虽有 stack 闸挡，开层即拥有完整键面（陈窗不跨层续——suspendMain/stop 收口同律）
    // 引臂窗残位同收（56 轮件 ②——54B 只收 lone-ESC）：ctrl+] 待靶臂与 IME
    // 组字态跨层存活是陈态泄漏——面板期事件先经路由层⓪/①再入层②模态吃尽
    // （⓪ 的 leader 窗即此缝——上方同收），对编辑器态「续收」结构性不可达
    //（对照 inputAsk 位：应答车续用主编辑器，续收真可达、不动）。
    // 陈臂泄漏面 = 收场后首字素被劫为跳靶（静默吞字）；组字泄漏面 = 面板期
    // 按键触发的冲刷提交被吃尽后 model 悬空预编辑残呈（裁决事件永无到达位）。
    // 粘贴蓄积仍不动——跨层粘贴体整段原子交付归层面板吃（56 轮件 ① 定谳，
    // 非劈叉残臂）。收场位（真句柄 close）无对称收集需求：面板期键面被吃尽，
    // 臂/组字无从新装，可装态只可能在开层前——本位单点覆盖。
    this.editor.cancelPendingJump();
    this.decoder.discardPendingPreedit();
    this.editor.clearPendingPreedit();
    this.askLayerOwner = waiter;
    this.pauseElapsedClock(); // 模态浮层开层——耗时暂停（挖掘 31 轮 [8]：浮层等待期不计）
    // 模态浮层开层即收补全弹层（与 input() 路「应答期弹层抑制」同形——组 2
    // 修死显残留）：overlay 占焦后弹层键面不可达（模态独占），不收层则建议
    // 列表死显在浮层段下、且 20ms 窗内已武装的在途查询迟到还会刷新死显列表
    this.autocompleteCompleter.cancel(); // 撤防抖窗 + 在途作废
    this.popup.applyResult(null); // 在场弹层即刻收层
    // 开层（位形归装配层栈序叠放——锚定签名已随 OverlayAnchor 一刀清，第五役 F3）
    const real = this.stack.open(waiter.content);
    waiter.handle = {
      close: () => {
        real.close();
        // 槽释放（持槽者比对——幂等）：释放即接续等待队列（后继顶上）
        if (this.askLayerOwner === waiter) {
          this.askLayerOwner = null;
          this.resumeElapsedClock(); // 浮层落定关层——耗时恢复走表（挖掘 31 轮 [8]；比对位=单汇点盖 approve/deny/abort 四值收口）
          this.continueAskLayerQueue();
        }
      },
      get closed() {
        return real.closed;
      },
    };
    this.touchFixed();
  }

  /**
   * 等待队列接续（槽释放扫队——先呈者落定即顶上）：跳过已落定件后激活队首。
   * 败腿锁（07 §4.3 定形注落码批承载锚）：「槽释放时本件已落定 → 不开层不落
   * 撤销行」——ui-core start 钩子 done 早检零呈现让位的同构位（等待件收场
   * 即时出队是常态清理，此处守卫是同判据的兜底：任何落定残位不阻后继顶上）。
   */
  private continueAskLayerQueue(): void {
    while (this.askLayerOwner === null && this.askLayerQueue.length > 0) {
      const next = this.askLayerQueue.shift()!;
      if (next.settled) continue; // 败腿锁：已落定残位——不开层不落撤销行，扫向后继
      this.activateAskLayer(next);
    }
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
    // 帧序真源：present op 的行集是入队时的真相（transcript.snapshot 可能已前进
    // ——本循环只按 op 自带快照判定，不回看 flush 时刻 snapshot）
    for (const op of ops) {
      if (op.kind === 'present') {
        this.screen.present(op.blocks, op.offset, { now: this.now() });
        // 流式帧字节帽（批 10h R1 perf 护栏）：冻结编舞下常态帧为视口量级，
        // 超帽即病理性重排（巨表/超长开栏）——降档纯文本直推，下条消息重试
        //（帽值经选项注入面可测——缺省生产定值，见 streamFrameByteCap）
        if (this.screen.lastSlotFrameBytes > this.streamFrameByteCap) this.transcript.setStreamingPlain();
        // 关槽帧（入队时真相末块非 streaming）补吐槽期缓冲瞬时行（到达序保持——定稿块之后）
        if (op.blocks.at(-1)?.kind !== 'streaming') this.drainSlotTransients();
      } else {
        // transient op 的槽判定已在入队时刻完成（appendTransientLines——到达时刻
        // 真相）：op 在队即到达时无槽，此处无条件直写（到达序呈现位——同帧后续
        // 开槽 present 在其下起笔）；drainSlotTransients 防御序保留（snapshot 现
        // 判无槽时排空陈缓冲——replayTransients 同形）
        if (op.persist) this.landTransientLines(op.lines); // 保全档落屏入账（权威重建补吐源——竞窗根因修）
        // 空态引导第四门：瞬时行落地即收引导（先置态 null——appendTransient
        // 余行清除仍以旧 guideRows 并账清引导尾，随后走无引导支清账）
        this.retireEmptyGuideAtLanding();
        this.screen.appendTransient(op.lines);
        this.drainSlotTransients();
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
    // 补吐位按当前列宽收口（fx2-A）：槽期缓冲行按缓冲时刻宽度折行序列化，
    // 缩窗复起后直写超宽行会 autowrap 漂账——逐行截宽（保账优先，截宽非丢行）；
    // 槽缓冲本身跨 repaint/挂起存活（既有语义），重放恒保全档同律
    this.appendTransientCapped(lines, { persist: true });
  }

  /**
   * 瞬时行按当前列宽截宽后直写（fx2-A——M2 残宽面）：补吐缓冲行（notify
   * 折行产物 / 摘要行）是**旧宽**（挂起/槽缓冲时刻）折行序列化产物，复起/
   * 排空时几何可能已缩——超宽行直写交终端 autowrap 产未记账物理行
   * （cursorRow 漂移 → 后续 durable 从中段起笔覆写正文）。逐行 capAnsiLine
   * （ANSI 感知——合法 SGR 配色零宽透传不丢色）按当前列截宽。活跃路
   * （flush 瞬时 op 直写位）不走此收口：live 行构造位即按当前宽折行。权威
   * 清点（repaint/resize）的抢救行是清点前旧宽产物，经 replayTransients
   * 走此收口重截（第五役 S1-a 起清点不再裸丢瞬时行）。
   */
  /**
   * 保全档入账单源（挖掘 26 轮 [10]）：flush 直写位与 appendTransientCapped
   * 收口位共用——入账 + FIFO 裁旧（超帽最旧让位）。帽执法只在此一处，两路
   * 入账同律不分叉。
   */
  private landTransientLines(lines: readonly string[]): void {
    this.landedTransients.push(...lines);
    if (this.landedTransients.length > this.landedTransientCap) {
      this.landedTransients.splice(0, this.landedTransients.length - this.landedTransientCap);
    }
  }

  private appendTransientCapped(lines: readonly string[], opts?: { persist?: boolean }): void {
    const columns = this.io.size().columns;
    // 保全档入账取原始行（非截宽产物）——重放走本路按重建时刻新宽收口（与
    // 第五役「抢救行是清点前旧宽产物、重放逐行重截」同语义——账面恒存原文）
    if (opts?.persist === true) this.landTransientLines(lines); // 落屏入账（权威重建补吐源——竞窗根因修）
    // 空态引导第四门（重放/排空共通收口路——replayTransients 全系经此）：瞬时
    // 行落地即收引导，同 flush 直写位前置形
    this.retireEmptyGuideAtLanding();
    this.screen.appendTransient(lines.map((line) => capAnsiLine(line, columns)));
  }

  /** 任务行转轮自驱定时器（注入调度后自重排；忙态外 tick 零开销） */
  private armTick(): void {
    this.tickHandle = this.scheduleFn!(() => {
      this.tickHandle = null;
      this.tick();
      this.armTick();
    }, TICK_INTERVAL_MS);
  }

  /** 定时器收口（frame/tick/escape/notice 四名） */
  private cancelTimer(which: 'frame' | 'tick' | 'escape' | 'notice'): void {
    const handle =
      which === 'frame'
        ? this.frameHandle
        : which === 'tick'
          ? this.tickHandle
          : which === 'escape'
            ? this.escapeHandle
            : this.noticeHandle;
    if (handle !== null) this.cancelFn(handle);
    if (which === 'frame') this.frameHandle = null;
    else if (which === 'tick') this.tickHandle = null;
    else if (which === 'escape') this.escapeHandle = null;
    else this.noticeHandle = null;
  }

  /* ---------------- 内部：主题面（批 10g + /themes 批） ---------------- */

  /**
   * 探测档判（auto ∪ 自定义名——「键级回退探测恒在」）：探测 = OSC 11 查询
   * + 2031 订阅两编舞的开关位。显式内置档（dark/light）恒 false 零写出。
   */
  private get probeActive(): boolean {
    return this.themeSetting === 'auto' || this.customOverlay !== null;
  }

  /**
   * 当前档基板解析（构造/切档/OSC 回执三消费单源）：内置档 = builtinPalette
   * 按档名（light 显指、auto 缺省 dark）；自定义名 = dark 基板 + 覆盖表合成
   * （overlayBoard——缺键回退基板同位键；基板明暗交 OSC 回执重合成裁定）。
   */
  private currentBoard(): ThemeBoard {
    if (this.customOverlay !== null) return overlayBoard(builtinPalette('dark'), this.customOverlay);
    return builtinPalette(this.themeSetting === 'light' ? 'light' : 'dark');
  }

  /** 主题注入长存组件（editor 视图 / 状态行 / 任务行 / 补全弹层 / 工具面板 / 后台任务面板——accent 派生样式重建） */
  private injectTheme(): void {
    this.editor.view.setTheme(this.theme);
    this.statusLine.setTheme(this.theme);
    this.taskLine.setTheme(this.theme);
    this.popup.setTheme(this.theme);
    this.toolPanel.setTheme(this.theme); // 插件面板行 tone 语义键直取——渲染时现取
    this.jobPanel.setTheme(this.theme); // 在选行 accent 派生（界面美化役批6）
  }

  /**
   * 换板换装（applyPalette 单入口换装单源路——07 §4.1 /themes 条款）：整体换
   * theme 引用 + 组件重注入 + 固定区重画（transcript / popup / editor / 状态
   * 行四面全集；accent 载体全在固定区/浮层；durable 正文已交 scrollback 物理
   * 不可回改——零重排义务）。
   */
  private applyPalette(board: ThemeBoard): void {
    this.theme = resolveTheme(board, this.colorDepth, this.terminalBgForTheme());
    this.transcript.setTheme(this.theme); // 行集换装——后续新建 doc 生效（durable 已交 scrollback 不回改）
    this.injectTheme();
    this.touchFixed();
  }

  /**
   * 探测背景传值门（界面美化役批⑦ R2 扩键注 + V-3 注⑨② 动态键族统辖——
   * applyPalette 与同板零换装判定共源）：内置探测档照传（解析位混合 dark 白
   * 12% / light 黑 4% + toolCardBg 白 8% / 黑 3%〔五件批 C 件 R2——第二背景
   * 键供血同门无独立门：显式带键则板值静态在位不需探测〕+ weakRule fg@20%
   * 现算）；自定义板缺 bg 键 = 无背景回退（旧主题文件缺新键非破坏性——不倒
   * 退内置板混合值，weakRule 同门：缺 userMessageBg 键即无探测 bg 供血、混
   * 合腿不产），显式带键则板值在解析位优先、传值同腿无害；探测缺席恒
   * undefined（16 档降采由解析位收——低档位宁可无带不可错色）。
   */
  private terminalBgForTheme(): RgbChannels | undefined {
    if (this.terminalBg === null) return undefined;
    if (this.customOverlay !== null && this.customOverlay.userMessageBg === undefined) return undefined;
    return this.terminalBg;
  }

  /**
   * 运行时切档（/themes 批——装配闭包单入口，选定即换装）：换档值 + 换覆盖
   * 表 + applyPalette 单入口换装一步。**运行时切档 = 重走下装同律**（07 §4.1
   * /themes 条款）：入探测档（auto 或自定义名）补发 OSC 11 查询 + 订 2031
   * 通知、出探测档复原对称（2031 disable——显式内置档从未订）；自定义名入
   * 档先 dark 基板合成、探测回执重合成换基板（探测即重跑不沿用缓存）。
   * 坏文件选定不达此位（装配位 loadCustomThemeColors null 即 warn 回退零切）。
   */
  setThemeChoice(setting: ThemeSetting, overlay: PartialSemanticPalette | null): void {
    const priorProbe = this.probeActive;
    this.themeSetting = setting;
    this.customOverlay = overlay;
    // 切档即作废旧探测应答（「探测即重跑不沿用缓存」——含离开探测档清位：
    // 显式内置档无探测语义，userMessageBg 背景带随档消失）
    this.terminalBg = null;
    this.applyPalette(this.currentBoard());
    if (!this.running) return; // 未启动零 OSC 编舞（start 下装路自带）
    const probe = this.probeActive;
    if (probe && !priorProbe) this.io.write(OSC11_QUERY + THEME_CHANGE_ENABLE);
    else if (!probe && priorProbe) this.io.write(THEME_CHANGE_DISABLE);
    else if (setting === 'auto') this.io.write(OSC11_QUERY); // auto 重选——探测即重跑（2031 已在无须重订）
  }

  /** 当前主题档观测面（/themes 副屏 ● 当前档标记的装配注入源） */
  get themeChoice(): ThemeSetting {
    return this.themeSetting;
  }

  /**
   * OSC 串上抛消费（decoder onOsc 接线）：OSC 11 背景色应答 → 明暗裁定换板。
   * 内置 auto 档 = 探测基板切换；自定义名档 = 探测基板 + 覆盖表重合成（键级
   * 回退基板随探测翻转——「键级回退探测恒在」）。显式内置档短路（2031 未
   * 开、查询未发——防御位）；非 11 码/畸形诚实忽略。同明暗且动态键
   * 呈现值无变 = 零换装（2031 通知的冗余应答与噪声不触发无谓重画——16 档/
   * 自定义缺键/同值应答恒无带变）；**背景值变化 → 带随新值重出**（界面美化
   * 役批⑦：动态键族混合随新值重算，applyPalette 单入口换装）。
   */
  private handleOscReply(data: string): void {
    if (!this.probeActive) return;
    const bg = parseOsc11Reply(data);
    if (bg === null) return;
    this.terminalBg = bg; // 探测背景入账（动态键族混合腿数据位）
    const baseBoard = paletteForBackground(bg); // 探测基板（明暗裁定）
    const board = this.customOverlay !== null ? overlayBoard(baseBoard, this.customOverlay) : baseBoard;
    if (board.dark === this.theme.dark) {
      // 同明暗：动态键呈现值有变才换装（解析单源现算比对——不在 backend 复
      // 刻混合算式；动态键族全键比对：任一键值变即换装）
      const next = resolveTheme(board, this.colorDepth, this.terminalBgForTheme());
      if (
        this.theme.userMessageBg === next.userMessageBg &&
        this.theme.toolCardBg === next.toolCardBg &&
        this.theme.weakRule === next.weakRule
      )
        return; // 同板三键零变零重画（userMessageBg/toolCardBg/weakRule）
    }
    this.applyPalette(board);
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
        if (this.retryContinuation) {
          // 重试续入（界面美化役批 4——整 run 口径律）：同一 run 的断点续跑
          // 非新 run——run 级账（用量/起止时戳/工具计数/种子时戳）零清零，
          // 速度分母与耗时连续累计
          this.retryContinuation = false;
        } else {
          // 种子暂存位先取（resetUsage 连清暂存位——同调用内先读后清防自噬）
          const seedAt = this.pendingSeedAt;
          this.resetUsage(); // 件 6：归零清行（上一 run 尾注不跨 run；速度时戳连清）
          this.runStartedAt = this.now(); // 批C：run 起点时戳（注入钟——速度段分母起点）
          // 暂停锚重钉（挖掘 31 轮 [8]）：跨 run 边界浮层窗仍开（切焦/迟到事件
          // 形）时锚随 run 起点重锚——新 run 计时从零走表、开窗段归新 run 扣除
          if (this.askPauseDepth > 0) this.elapsedPauseAt = this.now();
          // 种子时戳晋升（界面美化役批 5）：种子 message_end 先于 agent_start
          // 到达、resetUsage 已清 runSeedAt——暂存位在此转正（无种子置 null：
          // 搁浅件续跑/中途重放形回退 runEndedAt 诚实呈现）
          this.runSeedAt = seedAt;
        }
        this.pendingFailReason = null; // 失败原因持有档清账（V-0 注②——新 run 起陈原因不残留）
        this.toolPanel.clear(); // 件 5：瞬时面清板（静默先行——enterWorking 即帧，序倒中间帧重绘陈旧行）
        this.taskLine.enterWorking(); // 态① 正在对话中（工具段让位律——见 tool_execution_start）
        this.touchFixed();
        break;
      case 'agent_end':
        if (event.status === 'failed') {
          // ⚠ 持有档（界面美化役批 4）：failed 终态揭示延后——驱动侧保证
          // failed 后必随发 retry_wait_start（退避窗开）、retry_wait_end
          // {aborted|exhausted}（终态收口）或孤儿 retry_wait_end{resumed}
          // （overflow compacted 续入——07 件 12 扩第三形〔第七轮深扫批〕，
          // 04 §3.4 尾注真源）。揭示前账不冻结（run 仍在跑——
          // 退避窗计时计入 run 时长）、任务行保持忙态转轮不停（不闪「✗」）、
          // footer 尾注不落（防翻档前一帧伪终态）
          this.pendingFailReason = event.errorMessage ?? null; // 失败直呈律（V-0 注②）：原因存账随揭示同句供位
          this.toolPanel.clear();
          this.refreshTodo(); // 件 4：刷新（失败收场 todo 状态可能推进）
          this.refreshFooter(); // 低频锚：累计段随 run 落账拉现值（⑥a 刷新锚）
          this.touchFixed();
          break;
        }
        // completed / aborted：真终态——账冻结 + 任务行离场 + footer 尾注 + 收尾行。
        // 变更序（同步直出模式 flush 即时性——中间帧防）：toolPanel/refreshTodo
        // 先行静默突变，goIdle() 的 onChange 才触发首帧——届时工具面板已空、
        // todo 已新，中间帧不重绘陈旧行（任务行离场使行位上移、陈旧面板行会
        // 以新行位重画——序倒即假残影）
        this.markRunEnded(); // 批C：终点时戳冻结分母（终态后 speedView 保持终值不随墙钟漂移；挖掘 31 轮 [8] 起折入在途暂停段）
        this.toolPanel.clear(); // 件 5：瞬时面清板（静默先行——见上变更序注）
        this.refreshTodo(); // 件 4：刷新三时点之三
        // 行1 速度段呈现抑制先置（注⑪②——aborted 终态同 failed 律〔批C 诚实缺席律
        // 呈现面专属；speedView 观测面保持 raw〕）：须在 goIdle 首帧前落位，防
        // 中途帧携带终态已废速度；completed 复位（成功形终值冻结进仪表）
        this.speedSuppressed = event.status === 'aborted';
        // 终态帧无条件失效显示缓存（sweep23-件2）：末轮 message_end 中间帧可
        // 在 turn_end 落账前按旧 usageTotal 强刷缓存（相位翻转/空窗两路同险），
        // 终帧若同相位且在 500ms 窗内持旧，陈值即冻结为 run 终读数（run 后
        // tick 忙态门控零周期帧不自愈——与同排「✓ 用量」矛盾共处）；终帧
        // 现算此刻全账已齐（accumulateUsage 已于各 turn_end 落账完毕）
        this.speedDisplayCache = null;
        this.taskLine.goIdle(); // 忙态离场（零高度缺席；onChange → 首帧）
        // 件 6：落行（与 setStatus 同载体 last-writer-wins）——终态分档
        // （2026-09-19 P0 静默链修复批：failed ✗ / aborted ⏹ 不显用量成功形——
        // 与件 9 摘要行「失败与中止显式分档、不得伪装成功」同律；failed 腿的
        // ✗ 揭示归 retry_wait_end 分支且仅件 12 态④ 承载〔V-3 注⑧：footer 尾注腿退役〕）
        if (event.status === 'aborted') {
          this.statusLine.setStatus('⏹ 已中止');
          this.appendClosingLine('aborted', event.durationMs);
        } else {
          // V-4 注⑪⑦：尾注速段退役（速度面归行1 笔3——speedView 观测面保留）
          this.statusLine.setStatus(`✓ 用量 ${formatCount(this.usageTotal.totalTokens)}`);
          this.appendClosingLine('completed', event.durationMs);
        }
        this.runSeedAt = null; // 种子消费即清（防无后继 fresh start 的残值复用）
        this.refreshFooter(); // 低频锚：累计段随 run 落账拉现值（注⑪⑥a——尾注与仪表同帧收敛）
        this.touchFixed();
        break;
      case 'retry_wait_start':
        // 态③ 重试中（E-1）：转轮不停 + 倒计时本地钟现算（nextAt 绝对时刻律）
        this.runRetryCount += 1; // 收尾行重试段计数（整 run 口径——resetUsage 才清）
        if (this.runStartedAt === null) this.runCountsPartial = true; // 部分观察旗：未见 agent_start 窗内累加即置位（计数=接入点起算的部分值）
        this.taskLine.enterRetry(event.attempt, event.maxAttempts, event.nextAt);
        this.touchFixed();
        break;
      case 'retry_wait_end':
        if (event.outcome === 'resumed') {
          // 续入：下一 agent_start 消费标记（run 账不清）+ 任务行归态①
          this.retryContinuation = true;
          this.taskLine.enterWorking();
        } else {
          // aborted / exhausted：终态揭示——红 ✗ 驻留 + 账冻结（V-3 注⑧：
          // footer 尾注腿退役——件 12 态④ 输入框上方位为失败唯一主呈位，
          // 「输入框上方 + footer 尾」双位收敛为单位）；失败直呈律（V-0 注②）
          // 携因由任务行态④单源承载——pendingFailReason 缺席兜底裸形
          // （诚实缺席非陈因）；failed 无收尾行（错误块与任务行已足，不叠装饰行）
          this.markRunEnded(); // 挖掘 31 轮 [8]：终点落账共用（failed 形窗内浮层在途段同样折入）
          this.speedSuppressed = true; // 行1 速度段呈现抑制（注⑪②——失败终态同 aborted 律）
          this.taskLine.enterError(this.pendingFailReason ?? undefined);
          this.pendingFailReason = null; // 消费即清（终态后账不复用）
          this.runSeedAt = null; // 种子账收口（failed 无收尾行——种子不复用）
          this.refreshFooter(); // 低频锚：累计段随 run 落账拉现值（失败腿同样落账）
        }
        this.touchFixed();
        break;
      case 'message_start':
        // 态② 思考中（V-4 注⑪⑦ 细分起跑缺省——首 update 尾块分诊纠正，零空窗；
        // assistant 流式窗口开，message_end 归态①）
        if (event.role === 'assistant') {
          this.turnEstimator.reset(); // 本轮重置（每 turn 起跑——基线重建，重试续入同律新账）
          this.turnStreamStartedAt = this.now(); // 流中相位分母起跑（注⑪⑥c 速度腿——行1 速度槽流中读数）
          this.contextStreamLive = true; // 上下文流中平滑开窗（注⑪②——settled + 估值器）
          this.taskLine.enterThinking();
        }
        break; // 正文流式归直播路——固定区零扰动（任务行 onChange 自触重画）
      case 'message_update':
        // 态② 词面细分驱动（V-4 注⑪⑦）：尾块分诊 thinking/text → 思考中/
        // 生成中（词面迁移才触任务行通知——同词零重复 onChange）；同帧喂估值器
        // （本轮 N 差分累计——⑥c）。touchFixed 随帧收口本轮读数（渲染合并路
        // fps 帽合帧——非逐 delta 全帧）。正文流式归直播路——固定区其余零扰动
        if (event.role === 'assistant') {
          this.turnEstimator.onUpdate(event.partial);
          const tail = tailBlockKind(event.partial);
          if (tail === 'thinking') {
            if (this.taskLine.taskState !== 'thinking') this.taskLine.enterThinking();
            // 活状态头（挖掘 31 轮 [2]）：末思考块首个粗体段替位「思考中」——无
            // 粗体保持兜底词面不硬造；末块换段即清头从新段重提（块界律）
            const header = thinkingTailHeader(event.partial);
            this.taskLine.setThinkingHeader(header === null ? null : singleLineHeader(header));
          } else if (tail === 'text') {
            if (this.taskLine.taskState !== 'generating') this.taskLine.enterGenerating();
          }
          this.touchFixed();
        }
        break;
      case 'tool_execution_start':
        this.runToolCount += 1; // 收尾行纯对话轮判据（重试续入不清——整 run 口径）
        if (this.runStartedAt === null) this.runCountsPartial = true; // 部分观察旗：未见 agent_start 窗内累加即置位（计数=接入点起算的部分值）
        this.taskLine.setTool(toolFaceZh(event.name)); // 态① 工具段 `⚙ 动词 …` 优先（V-0 注⑤用户面动词）
        this.toolPanel.begin(event.toolCallId, event.name, event.arguments); // 件 5：建档不建行（原始名建档——插件腿查表依赖；行呈现位转写）
        this.touchFixed();
        break;
      case 'tool_execution_end':
        this.taskLine.setTool(null);
        this.toolPanel.end(event.toolCallId); // 件 5：end 即摘行
        this.refreshTodo(); // 件 4：刷新三时点之二（写后即显）
        this.appendTodoSnapshotsLive(); // 件 B8：todo 快照落史直播腿（写后即落块）
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
          this.turnEstimator.onSettled(event.message.usage); // 真值收口（⑥c——本轮 N 收口读真值，误差吸收不回跳）
          this.contextStreamLive = false; // 平滑窗关（注⑪②——context_usage 即将落账 settled，防估值器残值双计）
          this.taskLine.enterWorking(); // 流式窗关——归态①（下一 message_start 再入态②）
        } else if (isStandardMessage(event.message) && event.message.role === 'user' && event.channel === undefined) {
          // run 种子用户消息时戳入**暂存位**（收尾行时刻源）：channel 缺席 =
          // 用户直发种子（steer/followUp/inject 通道投递不覆盖）；暂存位由
          // fresh agent_start 晋升（种子先于 agent_start 到达——发射序见字段注）
          this.pendingSeedAt = event.message.timestamp;
        }
        break; // 正文换装已走直播路——固定区零扰动
      case 'turn_end':
        this.accumulateUsage(); // 件 6：累加时点（非呈现时点）
        break;
      case 'context_usage':
        // 行1 上下文三件套供数（E-4——turn 收口随发，turn_end 前）：字段缺席
        // = 未知不显示（codex 语义——双可选）；供数器渲染期活拉，本位落账
        // + 触帧收敛（单发事件即帧——供数链测试面直锁）
        this.contextUsedTokens = event.usedTokens ?? null;
        this.contextMaxTokens = event.maxTokens ?? null;
        this.touchFixed();
        break;
      default:
        break; // 消息族其余/turn 族其余不触固定区
    }
  }

  /**
   * usage 归零清行（agent_start 全新 run / repaint——件 6 清账重计条款；速度时戳
   * 连清）。界面美化役批 4/5：run 账面连革新位随本单源清——工具计数（收尾行
   * 纯对话轮判据）、种子时戳（收尾行时刻源）、重试续入标记（防跨 run 泄漏）。
   * 重试续入的 agent_start **不走本路**（applyFocusedEvent 分诊——整 run 口径律）。
   */
  private resetUsage(): void {
    this.pendingUsage = null;
    this.usageTotal = ZERO_USAGE;
    this.turnEstimator.reset(); // V-4 注⑪⑦：本轮账连清（新 run/切焦清账——中途附着本轮诚实缺席）
    this.runStartedAt = null; // 批C：清账连清起点（repaint/切焦中途附着即无起点——速度段诚实缺席）
    this.runEndedAt = null;
    this.elapsedPausedMs = 0; // 累计暂停墙钟连清（挖掘 31 轮 [8]）——开窗深度与锚
    // 保留：窗在场跨切焦存活（切焦不清他人窗），fresh agent_start 侧重锚
    this.turnStreamStartedAt = null; // 流中相位分母连清（注⑪⑥c——中途附着本轮无起点，与估值器 reset 同刻）
    this.runToolCount = 0;
    this.runRetryCount = 0;
    this.runCountsPartial = false; // 部分观察旗连清（fresh agent_start / repaint 切焦——新观察窗完整口径）
    this.runSeedAt = null;
    this.pendingSeedAt = null; // 暂存位连清（切焦防上一焦种子泄漏到新焦收尾行）
    this.retryContinuation = false;
    this.speedSuppressed = false; // 行1 速度段呈现抑制复位（新 run 成功形重开——切焦同清）
    this.speedDisplayCache = null; // 速度槽显示缓存连清（E 件——新 run 首帧刷新，不承上一 run 终值）
    this.statusLine.setStatus('');
    // 注⑪② 上下文对**不入本清账族**：used/max 是会话级量（窗口占用跨 run
    // 边界连续），新 run 流中平滑以其为基线；清位归切焦锚 onRepaint（per
    // focus 首轮前整段缺席律）
  }

  /**
   * turn 收尾行（界面美化役批 5 件 9 + V-0 注⑥翻形——codex 记账线；⑧ 两级
   * 门制 + 全宽补齐形——挖掘 29 轮批 B 规范立法兑现）：不占正文滚动帽、
   * repaint 不重建、重放不可见的瞬时追加行。成功形 `── 用时 1m 12s · 工具
   * 3 次 · 重试 1 ──` **全宽 dim 补齐**（文案形右缘 ─ 补至列宽；段缺席形：
   * 工具计数零省「工具」段、重试计数零省「重试」段、双零即纯对话轮**整行
   * 缺席**——行呈现门 = 作业判据与时长无关；**文案标签门 >60s**（contracts
   * runRecapLine 单源——≤60s 返空串，本侧落全宽 ─ 纯线）；切焦中途附着无
   * 起点 → 耗时段诚实缺席、行仍落（门不可判文案照常）；取消形
   * `⏹ 对话已取消——14:32`（取消回执非记账行——时刻段保留形维持；时刻源 =
   * 本 run 种子 user 消息时戳，中途附着无种子回退 runEndedAt）；failed 终态
   * 无收尾行（错误块本体呈现——调用面分档）。elapsed = durationMs（驱动
   * 结算账——A-3 唯一真源）?? 本地观察账（runStartedAt/runEndedAt 差）。
   * 段集/整行构造走 contracts runRecapLine 单源（2026-10-04 双站收编——webui
   * runCloseLine 同源，段形知识归单源头注；formatElapsedCompact 同件族
   * 任务行/SPA/超时三面同源）。**部分观察加注**（收尾行中途附着计数段加注形
   * ——webui frames 跨通道同律）：本屏未亲见 run 开头（runStartedAt === null
   * 中途附着）或部分观察旗在场（中途接入窗内累加过计数——retry 续入重开
   * 观察窗而 run 级账不清）→ 计数段逐段尾注「（自本次接入起算）」（加注
   * 词面随 partialObserved 位收 contracts 单源）；耗时段恒不加注（口径分立）。
   * dim 经 SGR 直拼（瞬时行纯文本路——appendTransientCapped 的 ANSI 感知收口
   * 保样式存活）：weakRule 在场整行混合现算弱线色（V-3 注⑨②）、键缺席回退
   * DIM 既有形（取消形 ⏹ 回执非记账线——恒 DIM 不沿线色）。
   */
  private appendClosingLine(status: 'completed' | 'aborted', durationMs?: number): void {
    if (status === 'aborted') {
      const clockAt = this.runSeedAt ?? this.runEndedAt ?? this.now();
      this.appendTransientLine(`${DIM_SGR}⏹ 对话已取消——${formatClockHM(clockAt)}${SGR_RESET}`, { persist: true });
      return;
    }
    if (this.runToolCount === 0 && this.runRetryCount === 0) return; // 纯对话轮：整行缺席（双零判据——行呈现门）
    const elapsedMs =
      durationMs ??
      (this.runStartedAt !== null && this.runEndedAt !== null ? this.runEndedAt - this.runStartedAt : null);
    // 段集/整行构造走 contracts runRecapLine 单源（三段序/段缺席形/重试段
    // 无「次」字等段形知识 + 文案标签门归单源头注；双零整行缺席判据留调用侧
    // 上一行）；部分观察判据 = runStartedAt === null || runCountsPartial（TUI
    // 侧第二支结构性冗余——见字段诚实化注；词面归 contracts 单源）
    const recap = runRecapLine({
      durationMs: elapsedMs,
      toolCount: this.runToolCount,
      retryCount: this.runRetryCount,
      partialObserved: this.runStartedAt === null || this.runCountsPartial,
    });
    // 载体迁块（挖掘 43 轮件 A）：成功形 recap 走 turn-recap 块（live-only——
    // 占帽、repaint 重建后诚实消失）；全宽补齐（⑧）与弱线双档（V-3 注⑨②）
    // 移渲染位单源 turnRecapLine——resize 后按新宽重算，不再写时宽定格
    //（label 空 = 纯线全宽 ─ 的渲染等价形）
    this.appendTurnRecapLine(recap);
  }

  /**
   * run 级平均速度（tok/s）——三反馈批C：run 累计 totalTokens ÷ run 时长（终点
   * 缺席按当下墙钟现算 = run 中刷新锚的 running average）。诚实缺席四形返
   * null：无起点时戳（repaint/切焦中途附着）、时长 <1s（亚秒 run 平均速度无
   * 意义）、零 token、（呈现面专属）failed/aborted 终态不显段。
   */
  private runSpeedTokensPerSecond(): number | null {
    if (this.runStartedAt === null) return null;
    const elapsedMs = (this.runEndedAt ?? this.now()) - this.runStartedAt;
    if (elapsedMs < 1000) return null;
    if (this.usageTotal.totalTokens <= 0) return null;
    return (this.usageTotal.totalTokens * 1000) / elapsedMs;
  }

  /**
   * 暂停耗时计时（挖掘 31 轮 [8]——审批等待计时暂停批）：深度 +1——overlay
   * 族与应答车两族独立单槽，并存时深度化（0→1 才落锚——嵌套不覆锚，避免
   * 内层先关把外层仍在途的暂停段折断漏计）。
   */
  private pauseElapsedClock(): void {
    if (this.askPauseDepth === 0) this.elapsedPauseAt = this.now();
    this.askPauseDepth += 1;
  }

  /**
   * 恢复耗时计时（挖掘 31 轮 [8]）：深度 -1，归零且锚在场才折入累计暂停墙钟
   * （now-锚 取 max(0,·) 防倒钟）；未归零保持暂停（外层窗仍开）。任一落定
   * 路径（approve/deny/abort/应答收口）都过此单汇点——比对位持有者防迟到
   * 路径误收他人槽。
   */
  private resumeElapsedClock(): void {
    if (this.askPauseDepth === 0) return;
    this.askPauseDepth -= 1;
    if (this.askPauseDepth === 0 && this.elapsedPauseAt !== null) {
      this.elapsedPausedMs += Math.max(0, this.now() - this.elapsedPauseAt);
      this.elapsedPauseAt = null;
    }
  }

  /**
   * run 终点落账（挖掘 31 轮 [8] 起 agent_end/retry_wait_end 共用）：终态时戳
   * 冻结 + 在途暂停段折入累计（run 落窗内收口——终态后再无浮层占用语义）。
   */
  private markRunEnded(): void {
    if (this.elapsedPauseAt !== null) {
      this.elapsedPausedMs += Math.max(0, this.now() - this.elapsedPauseAt);
      this.elapsedPauseAt = null;
    }
    this.runEndedAt = this.now();
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
   * todo 快照落史直播腿（挖掘 35 轮 B8——tool_execution_end 锚，refreshTodo
   * 邻位）：拉读面全序列逐条过闸（闸在 transcript——seq 已录位/同签均跳过，
   * 故全量迭代幂等；批内多次 todo 调用中间态不丢）。落块才入 present 链：
   * onEnvelope 的 present 快照先于 applyFocusedEvent（2611 序），本位须自补
   * present + render 两步（appendApprovalDecisionLine 同律）——缺此步新块
   * 不入帧。注入缺席 = no-op 零变化。
   */
  private appendTodoSnapshotsLive(): void {
    if (this.todoSnapshotsSource === undefined) return;
    const before = this.transcript.blockCount;
    for (const entry of this.todoSnapshotsSource(this.sessionId)) {
      this.transcript.appendTodoSnapshot(entry);
    }
    if (this.transcript.blockCount === before) return; // 闸全跳过——零帧源不扰动
    this.enqueuePresent();
    this.requestRender();
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
      this.syncFooterHint(); // 教学提示门控对账（忙闲翻转锚——缓存短路零重画）
    }
  }

  /**
   * 终端 title 待处置态对账（件 C——挖掘 46 轮）：应答车在场或模态浮层在场
   * 即开注意态（1s 交替拍 `[ ! ] 待处置`——终端标签页外显面：挂起/切走期
   * 屏内提示不可见，title 是唯一外显位），否则收。判据单源现取（inputAsk /
   * stack 两账），四调用位：activateInputAsk / input abort 清位〔sync 恒在
   * continueInputQueue 接续之后〕 / handleSubmit ask 收场〔同律〕 /
   * stack.onChange〔浮层开/关两触点〕。首行停机闸：stop 后迟到 abort/接续
   * 事件不得重启注意针（终退后零写出——trackProgress 同闸）。
   */
  private syncAttentionTitle(): void {
    if (!this.running) return; // 停机闸——迟到事件不重启针不写字节
    this.osc.setAttention(this.inputAsk !== null || this.stack.size > 0);
  }

  /**
   * 触发入账（挖掘 36 轮 notify-osc9）：通道关（notifyConf null）恒零账；
   * 同窗合并——在账优先级高于新入则弃（审批 1 压过轮完成 0，低不覆盖高）。
   * scheduleFn 缺席 = 同步直出（测试语义——零窗即发，armEscapeWindow 同构）。
   * 文案消毒归调用方（动态段帽前置），本方法只承合并与排程。
   * 档位收口（挖掘 37 轮 settings-notify-key）：单点档位判断——白名单不含
   * 该档即零账（缺席白名单 = 全集不滤；载波关短路优先级先于档位判断——两
   * 维分立）。四处入账点（trackDesktopNotice 三腿 + askApproval 审批档）前
   * 置传档位，散点漏判结构性消除；两记账腿（lastAssistantLine/
   * noticeFailReason）不辖档位（零行为耦合——预览/原因账照记）。
   */
  private enqueueNotice(text: string, priority: 0 | 1, trigger: NotifyTrigger): void {
    if (this.notifyConf === null) return; // 通道关——零账零排程（缺席注入律；先于档位判断）
    if (this.notifyTriggersSet !== null && !this.notifyTriggersSet.has(trigger)) return; // 档白名单不含——零账
    if (this.pendingNotice !== null && this.pendingNotice.priority > priority) return; // 低不覆盖高
    if (this.pendingNotice === null && this.scheduleFn !== null) {
      // 首入起窗（窗内后续只改账不重挂）
      this.noticeHandle = this.scheduleFn(() => {
        this.noticeHandle = null;
        this.flushNotice();
      }, NOTICE_COALESCE_MS);
    }
    this.pendingNotice = { text, priority };
    if (this.scheduleFn === null) this.flushNotice(); // 同步直出档（无注入调度）——零窗即发（armEscapeWindow 同构）
  }

  /**
   * 窗到点裁决：聚焦则整条弃（不补发不重挂——用户在场即零扰铃，codex 弃律
   * 同参）；未聚焦 → osc.notify 发最高优先级文案（写失败闩死归 osc 自持）。
   */
  private flushNotice(): void {
    const notice = this.pendingNotice;
    this.pendingNotice = null;
    if (notice === null) return;
    if (this.terminalFocused) return; // 聚焦弃——整条不补发
    this.osc.notify(notice.text);
  }

  /**
   * 桌面通知触发路由（挖掘 36 轮 notify-osc9——onEnvelope 新腿，trackProgress
   * 旁挂；不问聚焦位——后台会话终态可达同语义）：触发四档——
   * - message_end（assistant 正文）→ 记首行摘要账（轮完成预览单源）；
   * - agent_start → 清两账（「本轮」语义——陈摘要/陈原因不跨 run）；
   * - agent_end completed → 「本轮完成：{预览}」（预览缺席裸词）；aborted →
   *   「本轮已中止」；failed → 只记原因账不通知（V-0 注② 揭示延后——重试
   *   路上不响假警报）；
   * - retry_wait_end {aborted|exhausted} → 「本轮失败：{原因}」（原因缺席
   *   裸词——两账分立）；resumed → 零通知。
   * 通道关时首行短路（三账全零——缺席注入律专项锁锚）。
   */
  private trackDesktopNotice(env: SessionEnvelope): void {
    if (this.notifyConf === null) return; // 通道关——零账零通知
    const { event } = env;
    if (event.type === 'agent_start') {
      this.lastAssistantLine.delete(env.sessionId);
      this.noticeFailReason.delete(env.sessionId);
      return;
    }
    if (event.type === 'message_end' && isStandardMessage(event.message) && event.message.role === 'assistant') {
      // 正文首个非空行（text 块拼接——thinking 块不参摘要）
      const parts: string[] = [];
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text.trim() !== '') parts.push(block.text);
      }
      const firstLine = parts
        .join('\n')
        .split('\n')
        .find((line) => line.trim() !== '');
      if (firstLine !== undefined) this.lastAssistantLine.set(env.sessionId, firstLine.trim());
      return;
    }
    if (event.type === 'agent_end') {
      if (event.status === 'failed') {
        // 原因预存（retry_wait_end 契约无原因字段）——不通知（揭示延后）
        this.noticeFailReason.set(env.sessionId, event.errorMessage ?? '');
        return;
      }
      if (event.status === 'aborted') {
        this.lastAssistantLine.delete(env.sessionId); // 消费即清（陈摘要不跨 run）
        this.enqueueNotice('本轮已中止', 0, 'turn-aborted');
        return;
      }
      // completed：预览缺席 → 裸词（诚实缺席非陈摘要）
      const preview = this.lastAssistantLine.get(env.sessionId);
      this.lastAssistantLine.delete(env.sessionId); // 消费即清
      this.enqueueNotice(
        preview === undefined ? '本轮完成' : `本轮完成：${sanitizeNotifyText(preview, 80)}`,
        0,
        'turn-completed',
      );
      return;
    }
    if (event.type === 'retry_wait_end') {
      if (event.outcome === 'resumed') return; // 续入——真终态未达，零通知
      // aborted / exhausted：真失败终态——原因消费即清（缺席裸词诚实形）
      const reason = this.noticeFailReason.get(env.sessionId) ?? '';
      this.noticeFailReason.delete(env.sessionId);
      this.lastAssistantLine.delete(env.sessionId);
      // 档位 turn-failed（非 turn-aborted）：retry_wait_end 非 resumed 全 outcome 形
      // （含 aborted）皆「揭示延后后的真失败终态」——档位-事件映射见 TuiBackendOptions
      this.enqueueNotice(reason === '' ? '本轮失败' : `本轮失败：${sanitizeNotifyText(reason, 80)}`, 0, 'turn-failed');
    }
  }

  /**
   * 固定区 v2 重建（自上而下段序——V-4 注⑪① 笔3 定序 + 2026-10-08 TUI 对标
   * Codex 五件批 D 件应答段底部迁移〔07 §4.3 呈现位翻档 + V-3 注⑦ ⑤ 底栈
   * 扩段对端注〕）：todo 面板（件 4——todoFor 缺席/空表即零行）→ 任务状态行
   * （件 12——编辑器正上方）→ 排队常驻面板 → 编辑器（动态量高；聚焦态 = 无
   * overlay 占焦）→ 补全弹层（R-6 弹出位翻档——自编辑器上方迁编辑器下方，
   * 段五.四；fixed-budget 梯不动〔popup 仍梯末位——牺牲序不变〕）→
   * **应答段**（input-ask 提示行 + overlay 面板栈常规组——confirm/select
   * 浮层自固定区顶部段迁编辑器下方；件 B〔2026-10-16 用户三反馈〕审批面板
   * 再迁底栈带〔段八之一.五〕、应答段收缩为常规组；在场才占行、
   * 入恒保底族〔段内超帽走 fx2-B 滚动窗——不整段隐没〕；占焦模态律与键
   * 路由不变——呈现位迁移非交互语义迁移，键路由按 stack.size 判定与渲染
   * 位零耦合）→ 工具进度面板（件 5——与状态行分职互补相邻）→ 状态行底栏
   * 三行栈（行1 仪表 + 行2 环境——1-2 行，注⑪①）→ **审批组**（件 B——
   * ApprovalPanel 呈现带：footer 之后、JobPanel 之前钉位，用户令「跟子代理
   * 是一个区域的」）→ 后台任务面板（注⑪①
   * 行3——迁最底行，V-1 漂移补列）。编辑光标经 EditorView setCursor 声明 →
   * MainScreen.setFixed 声明位落 cup。
   *
   * 段量高经固定区段优先级截断（07 §4.1 挂账解挂批 C②）：极小终端固定区
   * 总高 > 视口时依牺牲步序截断（2026-10-03 三轮深扫批注释翻档：原粗排序
   * 「行2 让位 > 输入框收窄」与实装相抵——实装行2 先于输入框让位）——
   * 低段 todo/工具进度先缩后隐 → 状态行行2 隐〔注⑪⑧ 垂直牺牲梯，行1
   * 仪表恒保底〕→ 输入框收缩至内容高〔五件批 A+B 语义收窄——弃垫与最小
   * 高铺垫不噬内容行，下限 1 不变〕→ 补全弹层隐——分配律
   * 单源 fixed-budget.ts；生效锚即本件段高重算既有路（touchFixed/
   * requestRender 收敛 + repaint/resize 全量重画同收敛）。
   */
  private renderFixed(): void {
    const columns = this.io.size().columns;
    // 后台任务快照帧首拉取（界面美化役批6——UX 批6 A 件）：jobs 注入在场才
    // 拉（注入缺席零扰动）；帧频 O(n) 滤除终态——注册表帽 256 量级无害。
    // settle 推送锚另在 refreshJobs 公开面（闲态零帧源的即时收敛路）
    if (this.jobsSource !== undefined) this.jobPanel.update(this.jobsSource.running());
    // goal 持续态帧首拉取（件 G——单点单读，footer 供数器与 JobPanel 两消费
    // 面共帧缓存；闭包抛错 fail-open 空数组——pullSafe 同律不反噬渲染路）
    if (this.goalStatus !== undefined) {
      try {
        this.goalRowsCache = this.goalStatus() ?? [];
      } catch {
        this.goalRowsCache = [];
      }
      this.jobPanel.updateGoals(this.goalRowsCache);
    }
    // 排队面板帧首拉取（2026-10-05 ZCode TUI 对标批——07 §4.1 装配向接线排队
    // 常驻面板翻档注）：queueFor 注入在场才拉、聚焦会话（todoFor 同形——
    // this.sessionId 由 onRepaint 维护聚焦位）；入列/消费增删即时刷新锚 =
    // 既有 touchFixed 帧源（提交清稿 onChange / run 边界 applyFocusedEvent），
    // 帧首重拉自然收敛，无需新推送锚。null / undefined / 空数组同义 = 退场。
    this.queuePreviews = this.queueFor !== undefined ? (this.queueFor(this.sessionId) ?? []) : [];
    const contents = this.stack.contents;
    // 编辑器量高单次（fx2-B——帽计算与分配梯共用；measure 幂等无帧账副作用）；
    // 量高含帽钳呈现高 + 上下空行垫 2（五件批 A+B），帽内内容行数另取
    // （contentRows 夹呈现帽——sweep23-件1：超帽不可呈现，裸值令垫行借内容
    // 地板永不退让）——梯「收缩至内容高」目标位与最小必保段预留共用
    const editorMeasure = this.editor.measure(columns);
    const editorContentRows = this.editor.contentRows();
    // 编辑器必保下限（梯降底值——五件批 A+B 后梯收缩至帽内内容高：空稿形 = 1
    // 〔同旧〕、多行稿保帽内内容行；四处最小必保段预留共用同一算术〔fx2-B 不变
    // 式：梯降到底 total 恒 ≤ 截断预算〕）
    const editorFloor = Math.min(editorMeasure, Math.max(EDITOR_MIN_HEIGHT, editorContentRows));
    const askRows = this.inputAsk !== null ? 1 : 0;
    // 状态行想占行数（V-4 注⑪⑧ 笔3——三行栈量高原值 1-2：仪表行恒 1 +
    // 环境行数据在场 1；宽度不驱退场防行跳动）；三处最小必保段预留共用
    const statusWanted = this.statusLine.measure(columns);
    // 任务行占行裁决（界面美化役批 4——件 12）：fixed-budget.ts 分配梯不在本批
    // 改面（梯键集无 task 槽），任务行作**预算梯外挂腿**——先按在场性预留 1
    // 行，最小必保段（overlay 实高 + ask 行 + 编辑器下限 + 任务行 + 状态行）
    // 超截断预算时任务行整段隐（极小终端让位——「先缩后隐」梯末位语义）。
    const taskPresent = this.taskLine.measure(columns) === 1;
    // 排队段在场性（2026-10-05 ZCode TUI 对标批）：数据源注入在场且队列非空
    // 才占行（队列清空即退场 = 零高度零文案——段缺席不虚报）
    const queuePresent = this.queueFor !== undefined && this.queuePreviews.length > 0;
    // 排队清单想占行数（挖掘 31 轮 [7]——逐条清单形）：帽内条数 + 超帽折行
    // 1（上限 = 帽 3 + 1 = 4）；预留与实高同步——overlay 视口帽扣减同用此值
    const queueWantedRows = queuePresent
      ? Math.min(this.queuePreviews.length, QUEUE_PREVIEW_LIMIT) +
        (this.queuePreviews.length > QUEUE_PREVIEW_LIMIT ? 1 : 0)
      : 0;
    // overlay 视口帽（fx2-B）：一次性问答面板选项数超可用预算时开滚动窗——
    // 固定区总高恒 ≤ 截断预算（绝不让固定区超高触发 MainScreen 陈货守卫
    // 整段不写——修前 24 行屏 21 选项 = 面板 22 + 编辑器 3 + 状态 1 = 26 >
    // 预算 23，守卫整段不写 = 模态开屏即黑）。帽 = 预算 - 任务行 - 排队行 -
    // 状态行 statusWanted - ask 行 - 编辑器必保下限（编辑器恒保底对话本体；
    // todo/tool/popup/jobs 属更低优先级段、分配梯先牺牲——按梯降底值保守
    // 计算保证梯降到底 total 恰 ≤ 预算〔任务行/排队行缺席时预留归零——极小
    // 终端保守 1 行可容忍——挖掘 31 轮 [7] 起预留随想占行数（≤4 封顶，深队列
    // 帽最多再收 3 行 = 设计内退化）〕）
    const overlayCap = Math.max(
      0,
      fixedBudgetRows(this.io.size().rows) -
        (taskPresent ? 1 : 0) -
        queueWantedRows -
        statusWanted -
        askRows -
        editorFloor,
    );
    // 审批组与常规组分带测量（件 B——2026-10-16 用户三反馈：审批面板迁底栈
    // 带，renderFixed 渲染位分两组、量高仍入 overlay 预算单源）：审批组先量
    // 占满帽、常规组以残余帽再量——两组之和 ≤ overlayCap，「梯总额 + 三外挂
    // 腿恒 ≤ 截断预算」不变式与修前逐层测量同界保持。ask 单槽律
    // （openAskLayer askLayerOwner 判占）保证两组至多一组非空——
    // measureOverlayStack 的 unawareAbove 跨组保留语义在分组形不可达（冷读
    // 闸 MINOR-B1 注记钉边界；未来多面板并陈须回审）
    const approvalContents = contents.filter((c): c is ApprovalPanel => c instanceof ApprovalPanel);
    const regularContents = contents.filter((c) => !(c instanceof ApprovalPanel));
    const approvalHeights = this.measureOverlayStack(approvalContents, columns, overlayCap);
    const approvalSum = approvalHeights.reduce((sum, h) => sum + h, 0);
    const overlayHeights = this.measureOverlayStack(regularContents, columns, Math.max(0, overlayCap - approvalSum));
    const overlaySum = approvalSum + overlayHeights.reduce((sum, h) => sum + h, 0);
    const taskRows =
      taskPresent && overlaySum + askRows + editorFloor + 1 + statusWanted <= fixedBudgetRows(this.io.size().rows)
        ? 1
        : 0;
    // 排队段占行裁决（2026-10-05 ZCode TUI 对标批 + 挖掘 31 轮 [7] 逐条清单
    // 翻档）：分配梯不改面（梯键集无 queue 槽——任务行同形外挂腿）。想占 =
    // 帽内条数 + 超帽折行（上限 4），jobs 段同形钳幅（Math.min(想占, 预算
    // 余量)）——预留同步后常规态恒得满高，钳幅是窄带（overlay 触底小屏）
    // **部分呈现**：恰 1 行时退化为原单行形（首条 + ` +M` 折叠尾巴回缀首行
    // ——M = 隐藏数），多行不足全高时可见条数收窄、折叠数回缀首行；任务行
    // 优先（忙态指示高于排队预览——taskRows 判定不回看排队行）；最小必保段
    // 超截断预算时排队段整段隐（极小终端让位——「先缩后隐」梯末位语义）
    const queueRows = queuePresent
      ? Math.max(
          0,
          Math.min(
            queueWantedRows,
            fixedBudgetRows(this.io.size().rows) -
              (overlaySum + askRows + editorFloor + (taskRows > 0 ? 1 : 0) + statusWanted),
          ),
        )
      : 0;
    // 后台任务段占行裁决（界面美化役批6——UX 批6 A 件 + V-4 注⑪① 迁最底
    // 行）：分配梯不改面（梯键集无 jobs 槽——任务行同形外挂腿）。想占行数
    // = 面板量高原值（帽 5 + 溢出行）；最小必保段（overlay 实高 + ask 行 +
    // 编辑器下限 + 任务行 + 排队行 + 状态行）外算余量，正数即得、负数整段隐
    // （极小终端让位——「先缩后隐」梯末位语义，todo/tool 同档牺牲序；段内低
    // 段高收口在 JobPanel.render 容量自洽）
    const jobsWanted = this.jobsSource !== undefined ? this.jobPanel.measure(columns) : 0;
    const jobRows =
      this.jobsSource !== undefined && jobsWanted > 0
        ? Math.max(
            0,
            Math.min(
              jobsWanted,
              fixedBudgetRows(this.io.size().rows) -
                (overlaySum + askRows + editorFloor + (taskRows > 0 ? 1 : 0) + queueRows + statusWanted),
            ),
          )
        : 0;
    // 量高原值 → 优先级截断分配（预算 = 视口 - 1：正文滚动区至少 1 行；任务
    // 行/排队行/后台任务行占行从梯预算外扣——梯总额 + 三外挂腿恒 ≤ 截断预算
    // 不变式保持）
    const budget = allocateFixedBudget({
      viewportRows: this.io.size().rows - taskRows - queueRows - jobRows,
      overlay: overlaySum,
      ask: askRows,
      popup: this.popup.visible ? this.popup.measure(columns) : 0,
      editor: editorMeasure,
      editorContent: editorContentRows,
      todo: this.todoPanel.measure(columns),
      tool: this.toolPanel.measure(columns),
      statusWanted,
    });
    const total = budget.total + taskRows + queueRows + jobRows;
    const grid = new CellGrid(columns, total);
    let row = 0;

    // 段一：todo 面板（件 4——输入框上方紧凑面板；清板即零行；截断隐 = 零高度）
    if (budget.todo > 0) {
      this.todoPanel.render(grid, { row, col: 0, width: columns, height: budget.todo });
      row += budget.todo;
    }

    // 段二：（已迁——2026-10-10 Codex 样式复刻批 R-6 弹出位翻档：补全弹层
    // 自编辑器上方迁编辑器下方〔段五后〕——渲染段序「…编辑器 → 补全弹层 →
    // ask 提示行/应答段…」；fixed-budget 梯不动〔popup 仍梯末位——牺牲序
    // 不变〕，只动 renderFixed 段序；弹层展开吃转录区、编辑器随固定区增高
    // 上移，footer/状态行不随让位）

    // 段三：任务状态行（件 12——编辑器正上方固定段；忙态在场闲态离场，
    // 占行裁决见上；编辑器聚焦态不受影响——overlay 占焦判定与任务行无涉）
    if (taskRows > 0) {
      this.taskLine.render(grid, { row, col: 0, width: columns, height: 1 });
      row += 1;
    }

    // 段四：排队常驻面板（2026-10-05 ZCode TUI 对标批 + 挖掘 31 轮 [7] 逐条
    // 清单批——07 §4.1 装配向接线排队逐条清单翻档注）：首行 `已排队 N：<首
    // 条预览>`、次条起每条独占一行 `  ↳ <预览>`（可见帽 3——首条计入）；
    // 超帽尾行 `  + M 条更多`（M = N-3）；dim 档（待命性质 = 次要信息）+
    // ellipsize 单源（含 ↳ 前缀整行收口——窄屏预览收窄不越列）。**部分呈现
    // 退化**：余量不足全高时可见条数收窄、隐藏数（首条外不可见数）回缀首行
    // ` +M`（恰 1 行时与旧单行形逐字同）；入列/消费增删即时刷新、队列清空
    // 即退场（帧首拉取 + 占行裁决见上）；极小终端整段隐（先缩后隐梯末位）。
    if (queueRows > 0) {
      const n = this.queuePreviews.length;
      const full = queueRows === queueWantedRows; // 满高判定（钳幅形 = 部分呈现）
      // 可见次条数：满高取帽内余额、部分呈现按实得行数收窄
      const itemRows = full ? Math.min(n - 1, QUEUE_PREVIEW_LIMIT - 1) : Math.min(n - 1, queueRows - 1);
      const hidden = n - 1 - itemRows; // 首条外不可见数（部分形回缀首行、满高形折行尾注）
      const headFold = !full && hidden > 0 ? ` +${hidden}` : ''; // 退化单行形折叠尾巴（回缀首行）
      grid.writeText(row, 0, ellipsize(`已排队 ${n}：${this.queuePreviews[0] ?? ''}${headFold}`, columns), {
        dim: true,
      });
      for (let i = 1; i <= itemRows; i++) {
        grid.writeText(row + i, 0, ellipsize(`  ↳ ${this.queuePreviews[i]}`, columns), { dim: true });
      }
      if (full && hidden > 0) {
        grid.writeText(row + 1 + itemRows, 0, `  + ${hidden} 条更多`, { dim: true }); // 超帽折叠尾行
      }
      row += queueRows;
    }

    // 段五：编辑器（overlay 占焦期非聚焦——› 提示符降档 secondary 态 +
    // 不抢光标声明；截断收缩至内容高〔五件批 A+B〕——EditorView render 垫
    // 分档让路：高足上垫+内容+下垫、高不足垫先行退、深截断内容区收窄至
    // 下限 1；V-0 注③ 框退役后 innerH ≤ 0 防御在位）
    this.editor.setFocused(this.stack.size === 0);
    this.editor.render(grid, { row, col: 0, width: columns, height: budget.editor });
    row += budget.editor;

    // 段五.四：补全弹层（R-6 弹出位翻档——自段二〔编辑器上方〕迁编辑器下方：
    // 可见才占位非模态浮层；截断隐 = 零高度〔fixed-budget 梯末位——牺牲序
    // 不变〕；弹层在场时 footer/状态行不随让位〔popup 只是段序成员非让位源〕）。
    // 占位账同步键路门缓存（挖掘 29 轮件 5——两门单源：牺牲位键不吃）
    this.popupFrameRows = budget.popup;
    if (budget.popup > 0) {
      this.popup.render(grid, { row, col: 0, width: columns, height: budget.popup });
      row += budget.popup;
    }

    // 段五.五：input-ask 提示行（应答段首行——2026-10-08 D 件自固定区顶部段
    // 迁编辑器下方：与编辑器〔应答期转应答车〕上下相邻成对话组；恒保不截）。
    // overlay 占焦期明示（件 3）：栈非空时键盘路由进栈顶面板、编辑器收不到
    // 字——裸问句呈现为「可作答」与路由矛盾，补「待收场」标注让「问不丢
    // 但要等」对用户诚实（缀语方位中性——面板现居提示行下方）；异会话 FIFO
    // 队列化（十六役扫 #2——07 §4.1 路由序条 input() 异会话 FIFO 定形注
    // 〔节号勘正 2026-10-04：原引 §4.3 系错引〕）：排队问不上屏，队首提示行
    // 缀排队数明示「后面还有几问」
    if (this.inputAsk !== null) {
      const waiting = this.stack.size > 0 ? '（等面板关闭后作答）' : '';
      const queued = this.inputQueue.length > 0 ? `（后面还有 ${this.inputQueue.length} 个提问在排队）` : '';
      // ellipsize … 收口（wf_3c8b00b8 组δ X-3）——长问句 + 排队缀标超列时 raw
      // writeText 越界静默吸收硬截断无提示；收口只动呈现不动键路
      grid.writeText(row, 0, ellipsize(`? ${this.inputAsk.message}${waiting}${queued}`, columns), { dim: true });
      row += 1;
    }

    // 段六：overlay 段（应答面板栈常规组——confirm/select 浮层；2026-10-08
    // D 件自屏顶迁编辑器下方应答段，件 B〔2026-10-16 用户三反馈〕审批面板
    // 再迁底栈带〔段八之一.五〕、本段收缩为常规组；栈序自上而下叠放、量高
    // 已按视口帽收口——fx2-B/D 注；占焦模态律与键路由不变〔按 stack.size
    // 判定，与渲染位零耦合〕）
    for (let i = 0; i < regularContents.length; i++) {
      const height = overlayHeights[i]!;
      regularContents[i]!.render(grid, { row, col: 0, width: columns, height });
      row += height;
    }

    // 段七：工具进度面板（件 5——正在流 partial 的工具各占一行；清板即零行）
    if (budget.tool > 0) {
      this.toolPanel.render(grid, { row, col: 0, width: columns, height: budget.tool });
      row += budget.tool;
    }

    // 段八之一：状态行底栏三行栈（V-4 注⑪① 笔3——行1 仪表 + 尾注让位⑨ /
    // 行2 环境；量高 1-2 经 budget.status——极小终端行2 让位可 1）
    this.statusLine.render(grid, { row, col: 0, width: columns, height: budget.status });
    row += budget.status;

    // 段八之一.五：审批组（件 B——2026-10-16 用户三反馈：审批 ask 应答面板
    // 自段六应答段迁底栈带，footer 之后、JobPanel 之前钉位——用户令「输入
    // 框底部的那个区域，就跟子代理是一个区域的」；confirm/select 与 ask
    // 提示行不随迁〔段六现位维持〕。量高已分组测量入 overlay 预算单源
    // 〔恒保底族——量高 0 极小终端形与 fx2-B 不变式同界〕；占焦模态律与键
    // 路由零改〔按 stack.size 判定，与渲染位零耦合〕）
    for (let i = 0; i < approvalContents.length; i++) {
      const height = approvalHeights[i]!;
      approvalContents[i]!.render(grid, { row, col: 0, width: columns, height });
      row += height;
    }

    // 段八之二：后台任务面板（注⑪① 行3——迁最底行：running 快照紧凑面板
    // 在状态行之下钉屏底；清板即零行；截断隐 = 零高度；段内低段高容量收口
    // 自洽）
    if (jobRows > 0) {
      this.jobPanel.render(grid, { row, col: 0, width: columns, height: jobRows });
      row += jobRows;
    }
    this.screen.setFixed(grid);
  }

  /**
   * overlay 各层量高 + 视口帽注入（fx2-B）：栈低到高逐层先注入「剩余帽」
   * 再量高——支持 ViewportCapAware（SelectPanel 滚动窗）的层在帽内自适
   * 收缩，未实现协议的层（ConfirmPanel 等矮面板）不受扰恒满高。返回各层
   * 实际高。
   *
   * 逐层截断（不变量恢复——多层叠开/极小终端缝）：未实装协议层与帽 0 保底
   * 层（aware 层光标行保底量 ≥1）可越剩余帽——若照单分配则固定区总高 >
   * 截断预算，命中 MainScreen 陈货守卫整段不写（多层叠开瞬间固定区全冻结、
   * 键盘路由进隐形层）。故逐层以剩余帽硬截：层高恒 ≤ 剩余帽 ⇒ 总高恒 ≤
   * 预算（fx2-B 立法意图「绝不让固定区超高触发守卫」在多层形恢复成立）。
   *
   * 上层保留（多层可见性）：aware 层吃满帽后新开 unaware 层（ConfirmPanel
   * 恒量 2）在硬截下得 0 行成盲层（键盘照路由、文案永不可见）。故 aware 层
   * 注入帽先扣「上方 unaware 层自然高之和」——底层收缩让位、新开层在残余
   * 预算内可见；余量不足时不变量优先（总高恒 ≤ 预算仍成立，盲层只退化为
   * 极小终端形）。
   */
  private measureOverlayStack(contents: readonly OverlayContent[], columns: number, cap: number): number[] {
    // 上方 unaware 层自然高累计（自顶向下预扫——unaware 量高与帽无关可先取）
    const unawareAbove: number[] = new Array<number>(contents.length).fill(0);
    let reserve = 0;
    for (let i = contents.length - 1; i >= 0; i--) {
      unawareAbove[i] = reserve;
      const upper = contents[i] as Partial<ViewportCapAware>;
      if (typeof upper.setMaxHeight !== 'function') reserve += contents[i]!.measure(columns);
    }
    const heights: number[] = [];
    let remaining = cap;
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i]!;
      const aware = content as Partial<ViewportCapAware>;
      if (typeof aware.setMaxHeight === 'function') {
        aware.setMaxHeight(Math.max(0, remaining - unawareAbove[i]!)); // 剩余帽扣上方保留（层内窗口化自适）
      }
      const capped = Math.min(content.measure(columns), remaining); // 剩余帽硬截（不变量）
      heights.push(capped);
      remaining = Math.max(0, remaining - capped);
    }
    return heights;
  }

  /** 硬退复原钩子（仅真 ProcessTerminalIO——注入 io 零污染；Engine 同形） */
  private armExitRestore(): void {
    if (!(this.io instanceof ProcessTerminalIO)) return;
    this.disarmExitRestore?.();
    const restore = (): void => {
      try {
        this.io.write(LEAVE_MAIN);
        // [7] 同 stop 收口：硬退钩与正常退出同写 DECSTBM 复位（复原面不得留单边缺口）
        this.io.write(SCROLL_REGION_RESET + cup(this.io.size().rows - 1, 0));
        // 2031 复原（七役扫描批 A2——复原对称律）：终端私有模式不随进程退出
        // 自复位，stop 既写关则硬退钩同写关、复原面不得留单边缺口。条件与
        // stop() 同形（auto 档才开过订阅）；挂起态本钩已换挂起档收口体
        //（armSuspendExitRestore——不写 LEAVE_MAIN），主屏在场态无须
        // stop() 的 suspendedMain 分闸
        if (this.probeActive) this.io.write(THEME_CHANGE_DISABLE);
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

  /**
   * 挂起档硬退复原钩（副屏在场窗终端级收口）：suspendMain 期主屏模式串已
   * 写出收口、副屏屏形由副屏 Engine 自家 exit 钩复原——本档不写 LEAVE_MAIN
   *（挂起期写出会污染在场副屏），只收口本件挂起期特意保活的终端级写点：
   * 2031 订阅关（probeActive 条件与 stop 同形——显式档从未开不写关）+
   * osc.restore（title 基线 + 进度清零）+ raw 交还（幂等——副屏 Engine 钩
   * 同写）+ DECSTBM 复位（挖掘 27 轮 [7]——主屏 margins 无人清则 shell 继承
   * 破 margins；复位前先收在场副屏，保证落在 1049l 回主屏缓冲之后——margins
   * 按 grid 的 tmux 形裸写在副屏期 no-op；与 stop()/armExitRestore 两路同形）。
   * 仅真 ProcessTerminalIO 武装（注入 io 零污染）；resumeMain 经
   * armExitRestore 换回全档体（arm 幂等——先解除旧钩再挂）。
   */
  private armSuspendExitRestore(): void {
    if (!(this.io instanceof ProcessTerminalIO)) return;
    this.disarmExitRestore?.();
    const restore = (): void => {
      try {
        // 先置停再收副屏（挖掘 28 轮 [2]——stop() 同律）：closeAlt→
        // primary.resumeMain 守卫即 skip——exit 钩内不复起主屏编舞
        //（ENTER_MAIN 含 DA1/kitty 探测 + auto 档 OSC 11 重查 + 清屏重画；
        // 探测应答在进程死后到达被 cooked+ECHOCTL 回显进 shell 成乱码）
        this.running = false;
        if (this.probeActive) this.io.write(THEME_CHANGE_DISABLE);
        this.io.setRawMode(false);
        this.osc.restore(); // 件 7：硬退复原两写点（title 基线 + 进度清零——与 stop 同收口）
        // [7]（挖掘 27 轮）屏形收口：先收在场副屏（handle.close 写 1049l 退场
        //——回主屏缓冲；幂等——无副屏直返），复位随写必落其后
        this.closeAlt();
        // 副屏 Engine dispose 把 raw 复位成进屏前的 true——钩尾重申交还 shell
        this.io.setRawMode(false);
        this.io.write(SCROLL_REGION_RESET + cup(this.io.size().rows - 1, 0));
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
 * 摘要行 ANSI 序列化（已退役——07 §4.1 V-0 注①聚合律：非聚焦摘要行瀑布
 * 通道整体拆除，非聚焦呈现归 JobPanel 固定区与终态收口行）。
 */
