/**
 * UI 通道后端契约（07 篇 §4.1/§4.3 机制真源；03 §2.2 registerUiBackend
 * 插件注册面）。
 *
 * 归位注记（2026-09-08 U3 落码批）：本族类型原住 channels 件
 * （src/channels/types.ts），为插件侧类型可达（虚拟主键 `berry-agent` 面只达
 * contracts——03 §2.2 定形注记）随 U3-1 归位本件（批 11b ApprovalAsk 归位
 * 同款先例）；channels 公开面 re-export 维持不变。
 *
 * 插件实装形 = `UiBackend<never>`：投影泛型 TProjection 由宿主装配钉入
 * （session 域投影类型，插件结构性不可达），插件后端走信封驱动呈现
 * （onEnvelope 活体流）、不参与投影重画（onRepaint/openHistory——
 * SDK/webui 后端 `UiBackend<never>` 同形先例）。
 */

import type { AgentEvent } from './agent-events.js';
import type { ApprovalAskAnswer, ApprovalAskRequest } from './approval.js';

/**
 * 多会话信封（07 §4.1 channels 纵切批定形三则②）：AgentEvent 不带会话归属
 * 是刻意的——loop 是单 run 视角无多会话概念；归属信封的包装位 = host 装配
 * 的 per-run sink 包装器（conversation 侧 sink 签名零 channels 感知、纯
 * AgentEvent 回调注册面，host 汇入 channels 分发器时附加信封——装配根是
 * 唯一允许 import 全部宿主模块的横切层，2026-09-06 冷读裁决 C-1），channels
 * 消费分流。
 */
export interface SessionEnvelope {
  readonly sessionId: string;
  readonly event: AgentEvent;
}

/** notify 通知档（07 §4.3 签名定稿；'success' = 任务完成语义档） */
export type NotifyLevel = 'info' | 'success' | 'warn' | 'error';

/** 阻塞原语公共选项（07 §4.3 撤销面：abort 按取消收场取保守值） */
export interface UiAskOptions {
  /** 可选中止信号——abort 时 confirm→false / select·input→''（保守值收场） */
  readonly signal?: AbortSignal;
}

/** select 单选项（07 §4.3 签名定稿形） */
export interface UiSelectChoice {
  readonly value: string;
  readonly label: string;
}

/** input 原语选项 */
export interface UiInputOptions extends UiAskOptions {
  /**
   * 应答车占位文（挖掘 29 轮件 4 消费面激活——TUI input-ask 编辑器空稿占位：
   * 透传优先；缺席 = 通道缺省应答占位文。07 §4.3 input 条款「编辑器转应答车」
   * 呈现面的参数位）。
   */
  readonly placeholder?: string;
}

/**
 * 通道能力声明（07 §4.3 通道降级规则的判定面）：不支持的原语按
 * 「notify 化」降级（select→input→notify、setWidget→notify）——插件不感知
 * 通道能力差异，降级判定与编舞在核。
 */
export interface UiCapabilities {
  /** 一次性通知（一切通道的最后降级目标——接口上仍声明，装配健全性由核校验） */
  readonly notify: boolean;
  readonly confirm: boolean;
  readonly select: boolean;
  readonly input: boolean;
  /** 审批 ask（07 §4.3 提问队列条款——阻塞原语与审批统一入队的第四原语位） */
  readonly approval: boolean;
  readonly setStatus: boolean;
  readonly setWidget: boolean;
}

/**
 * 通道后端接口（通道核的呈现消费面）。TUI 实装 = channels 件内自研 TuiBackend
 * （批 10e 已落）、webui 件同面接入；核经此面驱动一切呈现——阻塞原语多后端并发竞速（04 §9 跨入口竞速
 * 先答先得），败腿经 signal 撤销收场（07 §4.3 撤销面同链）。
 */
export interface UiBackend<TProjection> {
  /** 后端身份（'tui' / 'webui'——日志与调试面，非能力位） */
  readonly id: string;
  readonly capabilities: UiCapabilities;
  /** 观众探针：本后端自报有观众（TUI 恒真 / webui 报在线连接数 > 0——07 §4.3） */
  hasAudience(): boolean;
  /** 一次性通知（level 档通道不识别时向后端自身归一 info） */
  notify(message: string, opts?: { level?: NotifyLevel }): void;
  /** 是/否确认（仅 capable 后端被调——缺席面降级判定在核） */
  confirm?(message: string, opts?: UiAskOptions): Promise<boolean>;
  /** 单选（Enter 选定 / Esc 取消收 ''——TUI 原生实装语义） */
  select?(message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string>;
  /** 自由文本输入 */
  input?(message: string, opts?: UiInputOptions): Promise<string>;
  /**
   * 审批 ask（仅 capable 后端被调——呈现形态归后端：TUI 主屏浮层是队首呈现之一）。
   * sessionId 首参 = 会话归属承载位（批 13b-3 随 SDK 通道后端定形——ask 帧信封
   * 必携会话归属；核心面 07 §4.3 `askApproval(sessionId, request)` 本含会话位，
   * 后端面同携）。
   */
  askApproval?(sessionId: string, request: ApprovalAskRequest, opts?: UiAskOptions): Promise<ApprovalAskAnswer>;
  /** 状态行更新（last-writer-wins——多写者自然覆盖） */
  setStatus?(sessionId: string, status: string): void;
  /** 自定义渲染槽呈现（会话级单槽值由核维护——见 UiCore.setWidget） */
  setWidget?(sessionId: string, node: unknown | null): void;
  /** 活体信封呈现（focused 位由核路由——聚焦全渲染/非聚焦摘要行，形态归后端） */
  onEnvelope?(env: SessionEnvelope, focused: boolean): void;
  /** 重画呈现（焦点切换/初始——载荷 = 投影快照 + 该会话当前 widget 槽值） */
  onRepaint?(sessionId: string, projection: readonly TProjection[], widget: { node: unknown } | null): void;
  /**
   * 收起副屏（07 §4.1 件 8「ask 强制收起（注意力优先级 ask > 回看）：通道
   * ask 入口先收副屏再入提问队列」条款的可选能力面——批 10f-4）。在场即
   * 实现 = 后端自报有副屏可收（TUI = 1049 备屏退出 + 主屏复起）；核 ask
   * 入口扇出本钩。缺席 = 无副屏可收零义务（非 TUI 后端不受影响）。
   */
  collapseAltScreen?(): void;
  /**
   * 开副屏回看器（07 §4.1 件 8 /history 命令的呈现面——命令注册在通道核按
   * ChannelsOptions.history 注入在场判）。载荷 = 全量 durable 正文投影
   * （history() 拉取）；呈现形态归后端（TUI = 1049 副屏整屏回看，同一渲染
   * 管线零第二渲染器）。缺席 = 不支持整屏回看的后端。
   */
  openHistory?(sessionId: string, messages: readonly TProjection[]): void;
  /**
   * 开副屏记忆管理面（06 §7 `/memory` 命令的呈现面——命令注册在通道核按
   * ChannelsOptions.memory 注入在场判；mm 批）。零参形——材料归后端装配
   * 自持（数据不经通道核流转：TuiBackend 经后置 setMemoryScreen 注入位持
   * 有 DAO 窄面/消毒函数/导出闭包，与 openHistory 的载荷经核流转分立）。
   * 返 boolean：true = 已开（支持且有材料）；false = 不支持或缺材料——核
   * 据此走 notify 降级提示（不静默）。缺席 = 不支持管理面的后端。
   */
  openMemory?(): boolean;
  /**
   * 开副屏会话切换器（07 §4.1 R7 批 10k `/sessions` 命令的呈现面——命令
   * 注册在通道核按 ChannelsOptions.sessions 注入在场判，注册面律同
   * openHistory）。载荷 = 会话清单 + 选定回调；选定经通道核闭包走
   * registry.focus() 既有权威路（后端呈现不触焦点态）。返 boolean 同
   * openMemory 律：true = 已开；false = 不支持或已在副屏——核据此 notify
   * 降级提示。缺席 = 不支持切换器的后端。
   */
  openSessions?(
    sessions: readonly UiSessionSummary[],
    onSelect: (sessionId: string) => void,
    totalCount?: number,
    /**
     * 删除回调（05 §2.5 会话删除编排定形注① `/sessions` 面板删除键——注入
     * 在场才有键行为，缺席 = 键无效零行为变）。确认位归呈现件（破坏性动作
     * 必有确认——确认文案明示「含审批记录在内的全部会话史将被删除且不可
     * 恢复」）；回执三态路由归通道核 wrapper（后端只透传）。
     */
    onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>,
  ): boolean;
  /**
   * 开副屏用量面板（07 §4.1 R7 批 10k `/usage` 命令的呈现面——数据源 =
   * 件 6 同数据源〔message.usage〕但独立聚合：会话全 run 累计分表，非复用
   * 件 6 清账态）。返 boolean 同 openSessions 律。缺席 = 不支持面板的后端。
   */
  openUsage?(sessionId: string, summary: UiUsageSummary): boolean;
  /**
   * 开副屏调用台账（07 §4.1 ZCode TUI 对标批 B3 定形注——`/calls` 命令的
   * 呈现面；三职分立：件 6 = run 级清账态、/usage = 会话全 run 累计分表、
   * /calls = 调用明细台账——聚合与明细分职不互替）。载荷 = fold 尾窗行集
   * （entries 最新在尾）+ 全量计数（totalCount——截断披露位：超窗时头行
   * 注记「N 条（仅显示最近 50）」）；快照档开屏现读（开屏后新调用不进在
   * 场面板，重开重取）。返 boolean 同 openSessions 律：true = 已开；false
   * = 不支持或已在副屏——核据此 notify 降级提示。缺席 = 不支持台账的后端
   * （webui 等——openCalls 缺席 = 不支持，既有 law）。
   */
  openCalls?(sessionId: string, entries: readonly UiCallLedgerEntry[], totalCount?: number): boolean;
  /**
   * 开副屏回退点选择器（2026-09-30 会话管理命令批批3 `/rewind` 无参形的
   * 呈现面——机制/事务真源 05 §5.3 该批翻案笔；命令处理器留 core:checkpoint
   * 插件域，面板载荷经 host deps 注入流转——非通道核注册）。载荷 = manifest
   * 成品行清单（行文本渲染单源 manifestLine——插件域组装，后端零 checkpoint
   * 依赖）+ 两步确认回调组（onPreview 预演对账 / onRestore 确认回退——
   * 选定先收屏再回调，回调内 busy 守卫→restore→adopt 编舞全闭包在插件域）。
   * 返 boolean 同 openSessions 律：true = 已开；false = 不支持或已在副屏
   * ——调用侧 usage 文本兜底（不虚报律）。缺席 = 不支持选择器的后端（serve 形）。
   */
  openRewindPicker?(entries: readonly UiRewindEntry[], actions: UiRewindActions): boolean;
}

/**
 * `/sessions` 删除回执三态（05 §2.5 会话删除编排定形注②——编排真身 =
 * 会话管理器删除动词：busy 守卫拒删 → 呈现面收口 → 登记拆除 → 物理三删
 * → 授予回收 → 焦点处置）。本类型系呈现契约面的回执形，与编排侧回执结构
 * 同构——contracts 不依赖 conversation 是分层刻意的（RenameSessionResult
 * 自持律同族）。
 */
export type UiSessionDeleteResult =
  { readonly status: 'deleted' } | { readonly status: 'busy' } | { readonly status: 'missing' };

/**
 * 回退点选择器条目（批3 `/rewind` 副屏载荷——插件域 manifestLine 成品行）。
 * id = manifest 全形 id（回调锚——preview/restore 直达）；line = 成品行文本
 * （id 短形 + ISO 时刻 + 触发形中文 + 规模——渲染单源复用命令面 list 行，
 * 呈现零重拼）。
 */
export interface UiRewindEntry {
  readonly id: string;
  readonly line: string;
}

/**
 * 回退点预演对账（批3 两步确认段一——previewRewind 的面板呈现形）：三账
 * 计数由面板渲染「恢复 N · 删除 M · 不动 U」行；errorText 在场 = 预演失败/
 * 拒绝（面板只显该行、Enter 不进 restore——诚实拒零误执行）。
 */
export interface UiRewindPreview {
  readonly restoreCount: number;
  readonly deleteCount: number;
  readonly untouchedCount: number;
  readonly errorText?: string;
}

/** 回退点选择器回调组（批3——两步确认的异步数据面，闭包真源在插件域） */
export interface UiRewindActions {
  /** 段一预演（零改动对账——面板 Enter 触发、加载态面板自持） */
  onPreview(id: string): Promise<UiRewindPreview>;
  /** 段二确认回退（面板先收屏再回调——busy 守卫→restore→adopt→回执 notify 全闭包内） */
  onRestore(id: string): Promise<void>;
}

/**
 * 会话清单条目（R7 批 10k `/sessions` 副屏切换器载荷——通道核拉取注入
 * 数据源的产物形；装配从 SessionRow 映射）。
 */
export interface UiSessionSummary {
  readonly id: string;
  /**
   * 会话标题（在场即显示，缺席如实缺段）。值位语义（05 §9 v13 分家）：显式题
   * 优先（headless 起源传入 / 人面 updateSessionTitle），否则首条真用户输入
   * （source ∈ user/channel:*）的 200 字符截断快照物化——首条用户消息截断的
   * 契约承诺由 persist 写路物化兑现（firstQuestionSummaryOf → 专列
   * first_question_summary）；装配层合并单源 = sessionDisplayTitleOf
   * （title ?? 专列——八装配位一律经此，禁各自手写）。
   */
  readonly title?: string;
  /** 工作区根（显示用——呈现侧取短名） */
  readonly workspaceRoot?: string;
  /** 最近活动时间（epoch ms） */
  readonly updatedAt: number;
  /** 活跃位（当前进程内有 driver 在场——行级标记显示用） */
  readonly active: boolean;
}

/**
 * 会话用量汇总（R7 批 10k `/usage` 副屏面板载荷）：会话全 run 累计
 * （token 四分表 + 合计 + 货币），与件 6 run 级清账态分职不互替。
 */
export interface UiUsageSummary {
  /** turn 数（turn/end 计数——含中止/错误收场） */
  readonly turns: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  /** 累计货币额（cost 在场才累） */
  readonly cost: number;
  /** 币种（首见定着；null = 无 cost 上报） */
  readonly currency: string | null;
}

/**
 * 台账行状态键（07 §4.1 ZCode TUI 对标批 B3 定形注——stopReason 五终值
 * 闭集原样透传）：用户面词族（完成/调工具/截断/失败/中止）的分档映射归
 * 呈现层（TUI CallsViewer），数据层零翻译。
 */
export type UiCallStatus = 'stop' | 'toolUse' | 'length' | 'error' | 'aborted';

/**
 * 调用台账行（07 §4.1 ZCode TUI 对标批 B3 `/calls` 副屏载荷——行两类同型，
 * source 判别）：①主对话轮行（conversation——源 = assistant/message 事件，
 * 含被遮蔽 retry 形）；②单发路行（oneshot——源 = 归因本会话的 llm/usage
 * 事件，run: 桥接条目已去重）。字段缺席 = durable 无此事实（呈现诚实缺席
 * 不冒充——如主路无 per-request 耗时位）。conversation 侧 foldCallLedger
 * 产物 CallLogEntry 的结构兼容真源形（同形直传零映射层——装配透传）。
 */
export interface UiCallLedgerEntry {
  /** 行来源：conversation = 主对话轮行；oneshot = 单发路行 */
  readonly source: 'conversation' | 'oneshot';
  /** 时刻（信封 time 毫秒） */
  readonly time: number;
  /** 信封 seq（两路行并序锚） */
  readonly seq: number;
  /** 模型（provider+model 响应实录全形；实录缺席不带——不冒充请求标识） */
  readonly model?: string;
  /** 状态（主路 = stopReason 五终值透传；单发路 = 'stop'——成功路才落账） */
  readonly status?: UiCallStatus;
  /** 失败短因（stopReason=error 携带——失败行呈现位） */
  readonly errorMessage?: string;
  /** 尝试序号（前位 llm/retry(scheduled) 推继 attempt+1；缺省 1 = 首试） */
  readonly attempt: number;
  /** 重试帽（配对 llm/retry 的 maxAttempts 在场才带） */
  readonly maxAttempts?: number;
  /** tokens（主路 = usage.totalTokens 累计口径含缓存桶；单发路 = 四桶合计） */
  readonly tokens?: number;
  /** 耗时毫秒（单发路在场必带；主路 durable 无 per-request 位——诚实缺席不带） */
  readonly elapsedMs?: number;
  /** 归因前缀（单发路 callId 冒号前段——probe 等调用位宽容透传） */
  readonly attribution?: string;
}

/**
 * 调用台账折叠产物（07 §4.1 ZCode TUI 对标批 B3——`/calls` 注入载荷）：
 * 尾窗行集（帽 50——呈现面只持尾窗）+ 全量计数（截断披露真源，帽内恒 =
 * entries.length）。conversation 侧 CallLedger 的结构兼容真源形。
 */
export interface UiCallLedger {
  /** 尾窗行集（seq 升序——呈现层自定新旧序〔最新在前〕） */
  readonly entries: readonly UiCallLedgerEntry[];
  /** 全量行数（截断披露位——超帽行「N 条（仅显示最近 50）」） */
  readonly total: number;
}
