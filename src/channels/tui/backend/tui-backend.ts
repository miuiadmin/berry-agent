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
 *   底栈扩段对端注〕）：todo 面板（件 4）→ 补全弹层（维持编辑器上方弹出位
 *   ——规范明文不迁）→ 任务状态行（件 12）→ 排队常驻面板 → 编辑器（动态量
 *   高 + 光标声明——setFixed 声明位落 cup）→ **应答段**（input-ask 提示行
 *   + overlay 面板栈〔审批/confirm/select 浮层——自屏顶迁编辑器下方，与
 *   footer/子 Agent 同区域；栈序叠放，锚定自由定位路已整域清退〔fx2-D +
 *   第五役 F3 一刀清〕；视口帽收口 fx2-B；占焦模态律与键路由不变——呈现
 *   位迁移非交互语义迁移〕，在场才占行）→ 工具进度面板（件 5——与状态行
 *   分职互补相邻）→ 状态行底栏三行栈（行1 仪表 + 行2 环境，1-2 行）→ 后台
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
  UiInputOptions,
  UiSelectChoice,
  UiSessionDeleteResult,
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
  stringWidth,
  truncateToWidth,
  wrapText,
  type RgbChannels,
  type TerminalIO,
} from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import { LiveTranscript, shortIdOf, type TranscriptBlock } from './transcript.js';
import { OscDisplay, buildOsc52Copy } from './osc.js';
import { allocateFixedBudget, EDITOR_MIN_HEIGHT, fixedBudgetRows } from './fixed-budget.js';
import { StatusLine } from '../status/status-line.js';
import { TaskStatusLine } from '../status/task-status-line.js';
import { createStreamingTokenEstimator } from '../status/streaming-token-estimator.js';
import { TodoPanel } from '../panels/todo-panel.js';
import { ToolProgressPanel } from '../panels/tool-progress-panel.js';
import { JobPanel } from '../panels/job-panel.js';
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
import { OverlayStack, type OverlayContent, type OverlayHandle } from '../overlay/overlay.js';
import { AltScreenHost, type AltScreenPrimary } from '../overlay/alt-screen.js';
import { HistoryViewer } from '../history/history-viewer.js';
import { SessionPicker } from '../history/session-picker.js';
import { HelpViewer, type HelpCommandEntry } from '../panels/help-viewer.js';
import { CallsViewer } from '../panels/calls-viewer.js';
import { formatCount, formatTokensCompact, formatTokensPerSecond, UsageViewer } from '../panels/usage-viewer.js';
import { gitHeadSuffix, readGitHead } from '../status/footer.js';
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
import { ConfirmPanel, SelectPanel, type ViewportCapAware } from '../overlay/select-confirm.js';
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
   * 持久化史透传（B1——07 §4.1 呈现面件 2 定形注⑦种写双路）：seed = 启动
   * 种子（host 装配根构造期一次 recentTexts〔启动锚根〕满灌——编辑器内存
   * 史跨进程存活位）；onRecord = 写路镜像（编辑器真入册位触发、装配闭包
   * 直写库——ask 应答/退出词/本地命令三叉不达 onSubmit，镜像取编辑器级保
   * 两集恒等；写失败 best-effort 归闭包）。缺席 = 纯内存旧形零扰动；数据
   * 面全经装配注入（backend/persist 零触感——28 席 DAG 零新边）。
   */
  readonly history?: {
    readonly seed: readonly string[];
    readonly onRecord: (text: string) => void;
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
 * 流式帧字节帽（批 10h——R1 perf 护栏落码定值）：冻结编舞下常态帧 ≈ 视口
 * 行 × 转义开销（24×80 档 < 10KB）；256KB 帽只拦病理性整档重排。超标降档
 * 纯文本（旧路径为降档开关——R1 分句原文），下条 message_start 复位重试。
 */
const STREAM_FRAME_BYTE_CAP = 256 * 1024;
/** lone-ESC 判定窗缺省（对齐 Engine DEFAULT_ESCAPE_WINDOW_MS） */
const DEFAULT_ESCAPE_WINDOW_MS = 30;
/** footer 教学提示闲态文案（V-3 注⑦④——`?` 键投影与 footer 提示同文单源） */
const FOOTER_HINT_TEXT = '? 快捷键';
/**
 * footer 教学提示忙态文案（07 §4.1 教学位扩双态注 2026-10-05）：忙态空稿
 * （应答进行中输入仍可用）——Enter 追加本轮 / Alt+Enter 排队后继 run 的
 * 键位教学，与闲态文案同位（footer 行 2 教学位）分态呈现。`?` 教学键仍
 * 闲态专属（忙态 `?` 落编辑器是字符——提示面与键位实况对齐，键位门控
 * 不随本批扩忙态）。
 */
const FOOTER_HINT_BUSY_TEXT = '回复进行中——输入仍可用：Enter 追加 / Alt+Enter 排队后继';
/**
 * footer 教学提示待续态文案（B4——2026-10-05 ZCode TUI 对标批 07 §4.1 定形
 * 注）：ctrl+x 入待续态期间示分支菜单（待续提示随窗定时退场——不搬 ZCode
 * 提示滞留 wart）；三键名与册面复合投影串同文（b 任务 / m 模型 / h 帮助）。
 */
const FOOTER_HINT_LEADER = 'Ctrl+X 已按 · b 任务 · m 模型 · h 帮助';
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
interface InputAsk {
  readonly message: string;
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
  /** 撤销说明行文案（曾在屏的 abort 收场才写——07 §4.3 撤销面） */
  readonly cancelLine: string;
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
  /** 三源合一补全器（token 路由 + union 收口——R6 批 10j 调度器查询位） */
  private readonly autocompleteProvider: CombinedAutocompleteProvider;
  /** 补全防抖调度器（R6 批 10j：尾沿 20ms / AbortSignal / 错序丢弃三律） */
  private readonly autocompleteCompleter: AutocompleteCompleter;
  private readonly stack = new OverlayStack();
  /** 装配柄（07 §4.3 两柄 + 命令柄 + 模型循环柄〔挂账解挂批 2026-09-15〕+ 档位模式循环柄〔2026-10-05 ZCode 对标批〕） */
  private readonly onSubmit: ((sessionId: string, text: string, opts?: EditorSubmitOptions) => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private readonly onModelCycle: (() => void) | undefined;
  private readonly onModeCycle: (() => void) | undefined;
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
  /**
   * 自上次权威重建起已落屏的瞬时行账（/resume e2e 竞窗根因修——瞬时行账
   * 不丢不变式的「已落帧」半边）：瞬时行「不进行集不记 writtenBlocks，
   * repaint 不重建」（main-screen 件自述），屏面即其唯一载体——repaint/
   * resize/复起重画三路 CLEAR_SCREEN 按投影行集重建即抹屏，已落屏行无账
   * 可补（不入 scrollback 不复显）。修前 collectPendingTransients 只收
   * pendingOps（未落帧）半边，与 suspendMain 挂起转账律不对称——本账补
   * 「flush 已达成 / appendTransientCapped 已直写」的落屏行，权威清点时
   * 与 pending 合并（到达序：先落屏在前）重放。重放产物经同路再入账
   * （下次重建再补吐），循环自洽不双记。
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
  /** 排队面板最新在队预览串（帧首拉取缓存——renderFixed 单次读源） */
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

  /* ---- 主题态（批 10g——07 R2 三档色域 + 语义键 + OSC 11 自动明暗；/themes 批运行时切档扩） ---- */
  /** 主题档（auto = start 时 OSC 11 探测裁定；显式内置档短路；自定义名探测照开）——/themes 选定可运行时改 */
  private themeSetting: ThemeSetting;
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
  /** 行2 目录短名缓存（rebuildFooter 低频锚拉 cwdLabel 闭包） */
  private footerCwd = '';
  /** 行2 ⎇ 支名@短哈希缓存（refreshFooterGit 低频锚——'⎇ dev @a1b2c3d' 单源 gitHeadSuffix().trim()：⎇ 支名两侧空格 + @ 记形随单源） */
  private footerGitSuffix = '';
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

  constructor(io: TerminalIO, options: TuiBackendOptions = {}) {
    this.io = io;
    this.sessionId = options.sessionId ?? 'main';
    this.onSubmit = options.onSubmit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onModelCycle = options.onModelCycle;
    this.onModeCycle = options.onModeCycle;
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
      // 持久化史透传（B1）：缺席 = undefined 直落编辑器缺省（纯内存旧形）
      historySeed: options.history?.seed,
      onHistoryAdd: options.history?.onRecord,
    });
    // 教学提示首画锚（V-3 注⑦②）：构造期空稿闲态即期翻转 footerHint
    //（refreshFooter 先行走 hint-off 基线——editor 就位后此处收敛真态）
    this.syncFooterHint();
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
      elapsedMs: () => (this.runStartedAt === null ? null : (this.runEndedAt ?? this.now()) - this.runStartedAt),
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
    // 后台任务面板（界面美化役批6）：jobs 注入缺席 = 段缺席零变化；本地钟
    // 注入（时长基准——测试确定性）；须早于 injectTheme（主题注入位消费）
    this.jobsSource = options.jobs;
    // 排队常驻面板（2026-10-05 ZCode TUI 对标批）：queueFor 注入缺席 = 段缺席零变化
    this.queueFor = options.queueFor;
    this.jobPanel = new JobPanel({ now: () => this.now() });
    this.injectTheme(); // 构造期注入（accent 派生样式定值；重画归 start 首帧）
    this.stack.onChange = () => this.touchFixed();
    this.screen = new MainScreen(io, { fixedHeight: 4 }); // 初始高：编辑器 3 + 状态行 1（动态更新经 setFixed）
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
    this.cancelTimer('frame');
    this.cancelTimer('tick');
    this.cancelTimer('escape');
    this.disarmLeaderWindow(); // leader 待续窗收口（B4——提示定时器同收、复起陈窗不续）
    this.autocompleteCompleter.cancel(); // 补全在途全收（停机后零迟到交付）
    this.osc.restore(); // 件 7：复原两写点（title 基线 + 进度清零）+ 保活停针（名册语义）
    this.disarmExitRestore?.();
    this.io.pause();
    // 终退无条件复 raw 先验（挂起期不再复——换防恒 raw 律见 suspendMain 注；
    // 从挂起态直接终退亦须交还，条件位随换防批删除）
    this.io.setRawMode(this.priorRaw);
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
    if (this.scheduleFn !== null) this.armTick(); // 任务行转轮复摆
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
        theme: this.theme, // 头行 accent 着色（界面美化役——主会话接线）
        onExit: () => this.closeAlt(),
        onInterrupt: () => this.onInterrupt?.(this.sessionId), // 零参形——装配闭包已知目标会话
        onQuit: this.onQuit,
        // OSC 52 复制写出柄（挂账解挂批①）：release 选区行间拼 LF 到达 → 铸
        // 序列直写 io（与 openHistory 同柄同律——终端支持不可探测，尽力写出
        // 无反馈，件 8 细则）
        onCopy: (text) => this.io.write(buildOsc52Copy(text)),
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
   * 经 requestRepaint 请帧）。已在副屏 / 主屏不在 running 返 false
   * （核侧 notify 降级）。打断柄锚当前交互会话位（切焦前语义）。
   */
  openSessions(
    sessions: readonly UiSessionSummary[],
    onSelect: (sessionId: string) => void,
    totalCount?: number,
    onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>,
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
        requestRepaint: () => this.altHost.requestRepaint(),
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
   * 条目 = providers × models 全列 spec 与当前模型装配位现取注入（清单单源
   * = ctrl+p 循环同一读面——本件收纯数据行，DAG 边表 channels 不入 llm）；
   * 打字过滤 + provider 分组头件内自持；选定先收副屏再回调（件族同序律），
   * setModel/回执/footer 活写归装配闭包。返 boolean 同 openThemes 律。
   */
  openModelPicker(
    entries: readonly ModelPickEntry[],
    current: string | undefined,
    onSelect: (spec: string) => void,
  ): boolean {
    if (this.altHandle !== null) return false;
    const handle = this.altHost.open(
      new ModelPicker({
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
   * 行1 上下文槽文案（注⑪② 三件套）：max 在场 = `上下文 12 K / 1 M · 38%`
   * （K/M 单源 formatTokensCompact；百分比向下取整）；缺席 = 二件套（无帽
   * 无百分比）；双缺席整段缩位。流中平滑 = settled + 估值器（contextStreamLive
   * 门控——流式窗内开、真值收口关，防 turn 间双计）。
   */
  private contextSlotText(): string {
    const settled = this.contextUsedTokens;
    if (settled === null) return '';
    const used = settled + (this.contextStreamLive ? this.turnEstimator.estimate() : 0);
    const max = this.contextMaxTokens;
    if (max === null || max <= 0) return `上下文 ${formatTokensCompact(used)}`;
    return `上下文 ${formatTokensCompact(used)} / ${formatTokensCompact(max)} · ${Math.floor((used / max) * 100)}%`;
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
   * ⎇ 槽 git 读盘低频锚（注⑪③——refreshFooterGit；07 注⑪③ 追注定形
   * 三枚）：构造期 + onRepaint（切焦 cwd 漂移）+ 会话复起 resumeMain
   * （复起重画路不触发 onRepaint——挂起期 checkout 换支须此锚收敛）；
   * readGitHead 零子进程直读 refs，gitHeadSuffix 单源
   * 拼形去 lead 空格（'⎇ dev@a1b2c3d'）。**不进 setStatus/resize 高频锚**
   * （07 定值「避 resize 高频读盘」承 V-3 前律）；闭包缺席/非库/抛错 =
   * 槽缩位不虚报。
   */
  private refreshFooterGit(): void {
    if (!this.footerEnabled || this.footerGitRoot === undefined) {
      this.footerGitSuffix = '';
      return;
    }
    try {
      this.footerGitSuffix = gitHeadSuffix(readGitHead(this.footerGitRoot())).trim();
    } catch {
      // fail-open：⎇ 槽缩位
      this.footerGitSuffix = '';
    }
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
    const on =
      this.editor.model.isEmpty() &&
      this.transcript.snapshot.length === 0 &&
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

  /** 等回声复位（块集非零 = 用户块回声已落——onEnvelope/onRepaint 两锚共用） */
  private settleAwaitingEcho(): void {
    if (this.awaitingEcho && this.transcript.snapshot.length > 0) this.awaitingEcho = false;
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
    // 模型半场照常（repaint 是新真相——挂起期也不丢投影：复起全帧重画携带）
    this.transcript.loadProjection(projection);
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
    if (!this.taskLine.isBusy) return;
    this.taskLine.tick();
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

  /** 是/否确认：ConfirmPanel 浮层（Enter → true / Esc → false；signal abort 保守值 + 关层 + 撤销说明行） */
  confirm(message: string, opts?: UiAskOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // onQuit 透传（ctrl+d 浮层期退出——副屏件族「先收屏再转 onQuit」同路）
      const panel = new ConfirmPanel({ message, onQuit: this.onQuit });
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
        onQuit: this.onQuit, // ctrl+d 浮层期退出（confirm/askApproval 三路同接）
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
   *
   * 异会话 FIFO 队列化（07 §4.1 路由序条 input() 异会话 FIFO 定形注——十六役
   * 扫 #2；节号勘正 2026-10-04：原引 §4.3 系错引，该定形注真源在 §4.1）：
   * 在飞问未收场时新问入队候接（不抢占队首——修前直覆使先问 promise 永悬）；
   * 应答/取消收场后队首自动晋升接续。排队问 abort = 静默出队保守值 ''（提示
   * 行从未上屏——不落撤销说明行）。
   */
  input(message: string, opts?: UiInputOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      // 入参 signal 已中止早检（openAskLayer 同族对称兜底）：abort 事件是
      // 一次性广播——已发毕的 signal 再挂监听永不再触发（Node 实证），激活
      // 即占应答车成僵尸问（无人能收、promise 永悬）。ui-core 侧 ask 入口
      // 已有早退护栏，UiBackend 是公开面——其他装配方直传时由此兜底：零
      // 呈现直收保守值（从未上屏——不落撤销说明行、不清框）
      if (opts?.signal?.aborted) {
        resolve('');
        return;
      }
      const ask: InputAsk = { message, resolve };
      // abort 分派按收场时态判（排队→激活两态同一监听——入队后才 abort 的
      // 排队问仍走激活态撤销面，不因注册时态漏接）
      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (this.inputAsk === ask) {
            // 激活态 abort：撤销说明行 + 残稿清框（07 §4.3 撤销面）
            this.inputAsk = null;
            this.appendTransientLine('⏹ 已取消提问', { persist: true });
            this.editor.setText('');
            this.autocompleteCompleter.cancel();
            this.popup.applyResult(null);
            resolve('');
            this.continueInputQueue();
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
    this.inputAsk = ask;
    this.editor.setText(''); // 应答起始清框（草稿让位——提交路模型自清）
    this.autocompleteCompleter.cancel(); // 应答期弹层抑制：撤窗 + 在途作废
    this.popup.applyResult(null); // 在层即刻收层
    this.touchFixed();
  }

  /** 出队接续（应答/取消收场后队首晋升——FIFO 串行链不断） */
  private continueInputQueue(): void {
    const next = this.inputQueue.shift();
    if (next !== undefined) this.activateInputAsk(next);
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
      const title =
        // ⚙ 走 HEAD_MARKS.tool 单源（panel-chrome 符号册——选型翻档只改一处）
        request.toolName !== undefined
          ? `${HEAD_MARKS.tool} ${toolFaceZh(request.toolName)}：${request.summary}`
          : request.summary;
      const panel = new SelectPanel({
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
   * 教学窗五闸（`?` 教学键与 leader arm 共用门判——B4「复用门判函数勿复制」）：
   * 空稿 + 闲态 + overlay 不在场 + 弹层不在场 + 无 input-ask 应答窗。任一
   * 不满足 = 键透传编辑器（终局丢弃——零打扰）。
   */
  private teachingGatesOpen(): boolean {
    return (
      this.inputAsk === null &&
      this.editor.model.isEmpty() &&
      !this.progressBusy &&
      this.stack.size === 0 &&
      !this.popup.visible
    );
  }

  /**
   * leader 分支门四闸（B4——arm 门减闲态）：忙期不设闸——arm 后忙态起、窗内
   * 分支照开（忙期查 /jobs 任务清单正是高频用法）。
   */
  private leaderBranchGatesOpen(): boolean {
    return this.inputAsk === null && this.editor.model.isEmpty() && this.stack.size === 0 && !this.popup.visible;
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
    }
    // 主屏 overlay 栈吃键即返——补帧对齐副屏路（mp-5 家族修同形）：SelectPanel
    // 光标/滚动窗随键变更，不补帧则闲态零帧源（tick 有 busy 闸）光标纹丝不动、
    // busy 态迟滞 ≤100ms；与弹层路 touchFixed/副屏路无条件请帧对称
    if (this.stack.routeEvent(ev)) {
      this.touchFixed(); // 面板态变更（光标/勾选/翻页）——固定区重建
      return;
    }
    if (this.popup.visible && this.popup.handleEvent(ev)) {
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
      // 后台任务段光标翻页态（界面美化役批6——UX 批6 B 件）：alt+↑/↓ 段内
      // 移动光标（键位册零在册动作、编辑器只绑 alt+y/alt+enter——无争键，
      // 直达判形）；jobs 段在场且有行才劫（空段/注入缺席透传——既有键语义
      // 零扰动）；enter 光标激活期开 /jobs 副屏定位在选任务（未激活不劫——
      // 提交语义零扰动；开屏失败〔副屏已占〕清光标消费不透传）
      if (this.jobsSource !== undefined && this.jobPanel.hasRows) {
        if (ev.alt && !ev.ctrl && !ev.shift && !ev.meta && (ev.key === 'up' || ev.key === 'down')) {
          this.jobPanel.moveCursor(ev.key === 'up' ? -1 : 1);
          this.touchFixed();
          return;
        }
        if (!ev.alt && !ev.ctrl && !ev.shift && !ev.meta && ev.key === 'enter' && this.jobPanel.cursorActive) {
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
    // 的 enter 是收窗非提交，不入本预置
    if (
      ev.kind === 'key' &&
      ev.phase === 'press' &&
      ev.key === 'enter' &&
      !ev.ctrl &&
      !ev.shift &&
      !ev.meta &&
      this.inputAsk === null &&
      !this.editor.model.isEmpty() &&
      !(this.editor.model.getLines()[0] ?? '').startsWith('/')
    ) {
      this.awaitingEcho = true;
    }
    if (this.editor.handleEvent(ev)) this.touchFixed(); // 稿件变更对账走 handleEditorChange 单源锚
  }

  /**
   * 思考块会话级开关（ctrl+t 批 10i）：transcript 翻态改写已落账块 +
   * screen.repaint 全量重渲（2J 清屏不清 scrollback——已交滚回的旧行物理
   * 不可回改，屏幕面与模型账立即一致；冻结账随 repaint 重置后按新态重建）。
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
      ask.resolve(text);
      this.autocompleteCompleter.cancel(); // 应答收场：撤窗 + 在途作废（下轮 ask 重开）
      this.popup.applyResult(null); // 应答期抑制的补全层即刻收层
      this.continueInputQueue(); // 队首晋升接续（FIFO——十六役扫 #2）
      // 收窗后门控对账（B2 对称面）：模型清稿的 change 先于本分支到达（editor
      // 侧先 model.submit 后 onSubmit），彼时 inputAsk 仍在场——教学提示未随清稿
      // 复现；此处补对账（队列接续时 activateInputAsk 的 setText 会再翻回，
      // 缓存短路零重画）
      this.syncFooterHint();
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
          // lifecycle 闸（迟到续链防——头注窄窗形）：续链后到时已停机则不触
          // 达 onSubmit（false 兜底与闸合判——两条件皆真才落）
          if (!handled && this.running) this.onSubmit?.(this.sessionId, text, opts); // 未命中兜底（03 §2.2 驱动侧语义）
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
    if (this.running) this.onSubmit?.(this.sessionId, text, opts);
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

  /** 编辑器内容变更：补全层重发查询（尾沿防抖——R6 批 10j）+ 固定区脏位 */
  private handleEditorChange(): void {
    if (this.inputAsk === null) this.autocompleteCompleter.request();
    // 门控对账先于触脏（2026-10-04 B2 序修正）：翻转自带 rebuildFooter+touchFixed
    // ——若 touchFixed 在前，同步直出档会先落一帧旧 hint 态再落新态（应答窗
    // 开窗帧混入假键位残影）；注入调度档两请求虽合并无害，序仍以对账先行定形
    this.syncFooterHint(); // 教学提示门控对账（空稿翻转单源锚——一切稿件变更经此）
    // 等回声复位（非空稿 = 新键入意图）：提交流的抑制位不复位会永锁空态引导
    if (!this.editor.model.isEmpty()) this.awaitingEcho = false;
    this.syncEmptyGuide(); // 空态引导对账（稿件翻转锚——同 B2 序：对账先于触脏）
    this.touchFixed();
  }

  /* ---------------- 内部：ask 浮层 ---------------- */

  /**
   * 开 ask 浮层：内联回退锚（fx2-D）+ signal abort 保守值收口 + 撤销说明行 +
   * 重绘请求。confirm / select / askApproval 三路共用本层。
   *
   * 「曾在屏者」判据（07 §4.3 语义纪律撤销面——三路统一处理）：abort 传播到
   * 后端呈现时层仍未关（在 overlay 栈中）= 曾在屏 → 撤销说明行入正文流；面板
   * 已 done（onFinish 先关层）后迟到的 abort 是 no-op，不误写。说明行只标撤销
   * 收场本身——保守值收口（与提问队列收口三则「保守值同撤销面」同源条款：审批
   * 项收 'cancel'、阻塞件各收保守值）由 promise 回值承载，行文不重复。
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
    cancelLine: string,
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
          // 激活态 abort：层仍在屏才写（07 §4.3 撤销面）
          if (!waiter.handle.closed) this.appendTransientLine(cancelLine, { persist: true });
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
    this.askLayerOwner = waiter;
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
        this.screen.present(op.blocks, op.offset);
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
        if (op.persist) this.landedTransients.push(...op.lines); // 保全档落屏入账（权威重建补吐源——竞窗根因修）
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
  private appendTransientCapped(lines: readonly string[], opts?: { persist?: boolean }): void {
    const columns = this.io.size().columns;
    // 保全档入账取原始行（非截宽产物）——重放走本路按重建时刻新宽收口（与
    // 第五役「抢救行是清点前旧宽产物、重放逐行重截」同语义——账面恒存原文）
    if (opts?.persist === true) this.landedTransients.push(...lines); // 落屏入账（权威重建补吐源——竞窗根因修）
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

  /** 定时器收口（frame/tick/escape 三名） */
  private cancelTimer(which: 'frame' | 'tick' | 'escape'): void {
    const handle = which === 'frame' ? this.frameHandle : which === 'tick' ? this.tickHandle : this.escapeHandle;
    if (handle !== null) this.cancelFn(handle);
    if (which === 'frame') this.frameHandle = null;
    else if (which === 'tick') this.tickHandle = null;
    else this.escapeHandle = null;
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
        this.runEndedAt = this.now(); // 批C：终点时戳冻结分母（终态后 speedView 保持终值不随墙钟漂移）
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
          this.runEndedAt = this.now();
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
   * turn 收尾行（界面美化役批 5 件 9 + V-0 注⑥翻形——codex 记账线）：
   * 不占正文滚动帽、repaint 不重建、重放不可见的瞬时追加行。成功形
   * `── 用时 1m 12s · 工具 3 次 · 重试 1 ──`（**段缺席形**：工具计数零省
   * 「工具」段、重试计数零省「重试」段、双零即纯对话轮**整行缺席**——不设
   * 时长门；切焦中途附着无起点 → 耗时段诚实缺席、行仍落）；取消形
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
    if (this.runToolCount === 0 && this.runRetryCount === 0) return; // 纯对话轮：整行缺席（双零判据）
    const elapsedMs =
      durationMs ??
      (this.runStartedAt !== null && this.runEndedAt !== null ? this.runEndedAt - this.runStartedAt : null);
    // 段集/整行构造走 contracts runRecapLine 单源（三段序/段缺席形/重试段
    // 无「次」字等段形知识归单源头注；双零整行缺席判据留调用侧上一行）；
    // 部分观察判据 = runStartedAt === null || runCountsPartial（TUI 侧第二支
    // 结构性冗余——见字段诚实化注；词面归 contracts 单源）
    const line = runRecapLine({
      durationMs: elapsedMs,
      toolCount: this.runToolCount,
      retryCount: this.runRetryCount,
      partialObserved: this.runStartedAt === null || this.runCountsPartial,
    });
    // 弱线色优先（V-3 注⑨②）：weakRule 在场整行混合现算弱线色、键缺席回退 DIM
    const weakSgr = this.theme.weakRule !== undefined ? buildSgr({ fg: this.theme.weakRule }) : DIM_SGR;
    this.appendTransientLine(`${weakSgr}${line}${SGR_RESET}`);
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
      this.syncFooterHint(); // 教学提示门控对账（忙闲翻转锚——缓存短路零重画）
    }
  }

  /**
   * 固定区 v2 重建（自上而下段序——V-4 注⑪① 笔3 定序 + 2026-10-08 TUI 对标
   * Codex 五件批 D 件应答段底部迁移〔07 §4.3 呈现位翻档 + V-3 注⑦ ⑤ 底栈
   * 扩段对端注〕）：todo 面板（件 4——todoFor 缺席/空表即零行）→ 补全弹层
   * （维持编辑器上方弹出位——规范明文不迁）→ 任务状态行（件 12——编辑器
   * 正上方）→ 排队常驻面板 → 编辑器（动态量高；聚焦态 = 无 overlay 占焦）
   * → **应答段**（input-ask 提示行 + overlay 面板栈——审批/confirm/select
   * 浮层自固定区顶部段迁编辑器下方，与 footer/子 Agent 同区域；在场才占行、
   * 入恒保底族〔段内超帽走 fx2-B 滚动窗——不整段隐没〕；占焦模态律与键
   * 路由不变——呈现位迁移非交互语义迁移，键路由按 stack.size 判定与渲染
   * 位零耦合）→ 工具进度面板（件 5——与状态行分职互补相邻）→ 状态行底栏
   * 三行栈（行1 仪表 + 行2 环境——1-2 行，注⑪①）→ 后台任务面板（注⑪①
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
    // overlay 视口帽（fx2-B）：一次性问答面板选项数超可用预算时开滚动窗——
    // 固定区总高恒 ≤ 截断预算（绝不让固定区超高触发 MainScreen 陈货守卫
    // 整段不写——修前 24 行屏 21 选项 = 面板 22 + 编辑器 3 + 状态 1 = 26 >
    // 预算 23，守卫整段不写 = 模态开屏即黑）。帽 = 预算 - 任务行 - 排队行 -
    // 状态行 statusWanted - ask 行 - 编辑器必保下限（编辑器恒保底对话本体；
    // todo/tool/popup/jobs 属更低优先级段、分配梯先牺牲——按梯降底值保守
    // 计算保证梯降到底 total 恰 ≤ 预算〔任务行/排队行缺席时预留归零——极小
    // 终端保守 1 行可容忍〕）
    const overlayCap = Math.max(
      0,
      fixedBudgetRows(this.io.size().rows) -
        (taskPresent ? 1 : 0) -
        (queuePresent ? 1 : 0) -
        statusWanted -
        askRows -
        editorFloor,
    );
    const overlayHeights = this.measureOverlayStack(contents, columns, overlayCap);
    const overlaySum = overlayHeights.reduce((sum, h) => sum + h, 0);
    const taskRows =
      taskPresent && overlaySum + askRows + editorFloor + 1 + statusWanted <= fixedBudgetRows(this.io.size().rows)
        ? 1
        : 0;
    // 排队段占行裁决（2026-10-05 ZCode TUI 对标批）：分配梯不改面（梯键集无
    // queue 槽——任务行同形外挂腿）。队列非空即 1 行（已排队 N 计数 + 首条
    // 预览——单行契约不量高）；任务行优先（忙态指示高于排队预览——taskRows
    // 判定不回看排队行，两外挂腿同竞争时排队段先让位）；最小必保段（overlay
    // 实高 + ask 行 + 编辑器下限 + 任务行 + 排队行 + 状态行）超截断预算时排
    // 队段整段隐（极小终端让位——「先缩后隐」梯末位语义）
    const queueRows =
      queuePresent &&
      overlaySum + askRows + editorFloor + (taskRows > 0 ? 1 : 0) + 1 + statusWanted <=
        fixedBudgetRows(this.io.size().rows)
        ? 1
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

    // 段二：补全弹层（可见才占位——非模态浮层；截断隐 = 零高度；维持编辑器
    // 上方弹出位——2026-10-08 D 件应答段迁移的规范明文不迁面）
    if (budget.popup > 0) {
      this.popup.render(grid, { row, col: 0, width: columns, height: budget.popup });
      row += budget.popup;
    }

    // 段三：任务状态行（件 12——编辑器正上方固定段；忙态在场闲态离场，
    // 占行裁决见上；编辑器聚焦态不受影响——overlay 占焦判定与任务行无涉）
    if (taskRows > 0) {
      this.taskLine.render(grid, { row, col: 0, width: columns, height: 1 });
      row += 1;
    }

    // 段四：排队常驻面板（2026-10-05 ZCode TUI 对标批——07 §4.1 装配向
    // 接线排队常驻面板翻档注）：已排队 N 计数 + 首条预览（ellipsize 收口防
    // 越列硬截断——应答段 ask 行同形）；N≥2 加 +M 折叠计数形（+M = N-1，单
    // 件形零折叠尾巴）；dim 档（待命性质 = 次要信息——ask 行同档）。入列/
    // 消费增删即时刷新、队列清空即退场（帧首拉取 + 占行裁决见上）；极
    // 小终端整段隐（先缩后隐梯末位）。
    if (queueRows > 0) {
      const folded = this.queuePreviews.length > 1 ? ` +${this.queuePreviews.length - 1}` : '';
      grid.writeText(
        row,
        0,
        ellipsize(`已排队 ${this.queuePreviews.length}：${this.queuePreviews[0] ?? ''}${folded}`, columns),
        { dim: true },
      );
      row += 1;
    }

    // 段五：编辑器（overlay 占焦期非聚焦——› 提示符降档 secondary 态 +
    // 不抢光标声明；截断收缩至内容高〔五件批 A+B〕——EditorView render 垫
    // 分档让路：高足上垫+内容+下垫、高不足垫先行退、深截断内容区收窄至
    // 下限 1；V-0 注③ 框退役后 innerH ≤ 0 防御在位）
    this.editor.setFocused(this.stack.size === 0);
    this.editor.render(grid, { row, col: 0, width: columns, height: budget.editor });
    row += budget.editor;

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

    // 段六：overlay 段（应答面板栈——2026-10-08 D 件自屏顶迁编辑器下方应答
    // 段：审批/confirm/select 浮层与 footer/子 Agent 同区域；栈序自上而下
    // 叠放、量高已按视口帽收口——fx2-B/D 注；占焦模态律与键路由不变〔按
    // stack.size 判定，与渲染位零耦合〕）
    for (let i = 0; i < contents.length; i++) {
      const height = overlayHeights[i]!;
      contents[i]!.render(grid, { row, col: 0, width: columns, height });
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
   * 同写）。仅真 ProcessTerminalIO 武装（注入 io 零污染）；resumeMain 经
   * armExitRestore 换回全档体（arm 幂等——先解除旧钩再挂）。
   */
  private armSuspendExitRestore(): void {
    if (!(this.io instanceof ProcessTerminalIO)) return;
    this.disarmExitRestore?.();
    const restore = (): void => {
      try {
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
}

/**
 * 摘要行 ANSI 序列化（已退役——07 §4.1 V-0 注①聚合律：非聚焦摘要行瀑布
 * 通道整体拆除，非聚焦呈现归 JobPanel 固定区与终态收口行）。
 */
