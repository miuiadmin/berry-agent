/**
 * channels 件类型契约（L4 宿主固定件——02 篇席 10；机制真源 07 篇 §4.1/§4.3、
 * 03 篇 §2.2 命令面、04 篇 §4 队列、04 篇 §9 审批归属）。
 *
 * 批 10a 落通道核（多会话信封分流 + 投影拉取注入 + 命令面 + ui 原语分发 +
 * 提问队列——通道无关逻辑，零渲染依赖〔2026-09-06 改裁弃 pi-tui 后天然
 * 满足——TUI 实装已落件内自研栈，批 10e〕）。
 * 单向 DAG：channels → contracts, context, agent（02 §4.1——投影类型经装配侧
 * 泛型钉入，不 import session）。
 */

// UI 后端契约族归位 contracts（2026-09-08 U3 落码批——插件侧类型可达路径定形：
// UiBackend/SessionEnvelope/UI 原语词汇随 AgentEvent 族上 contracts，虚拟主键
// `berry-agent` 面可达；批 11b ApprovalAsk 归位同款先例）；本面 re-export
// 维持通道侧公开面不变
export type {
  SessionEnvelope,
  NotifyLevel,
  UiAskOptions,
  UiSelectChoice,
  UiInputOptions,
  UiCapabilities,
  UiBackend,
  UiSessionSummary,
  UiSessionPreviewLine,
  UiUsageSummary,
  UiCallStatus,
  UiCallLedgerEntry,
  UiCallLedger,
  UiRewindEntry,
  UiRewindPreview,
  UiRewindActions,
  UiSessionDeleteResult,
  UiForkEditAnchor,
  UiForkBeforeMessageResult,
  UiForkEditReceipt,
  UiClipboardResult,
} from '../contracts/index.js';

// 审批 ask 词汇归位 contracts（批 11b——conversation 消费同形而边表不可达
// channels）；本面 re-export 维持通道侧公开面不变
export type { ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';

// 本面内用的契约类型（R7 批 10k——ChannelsOptions 两注入位的载荷形；re-export
// 块不进本文件作用域，值用须显式 import）
import type { UiSessionSummary, UiUsageSummary, UiCallLedger, UiSessionPreviewLine } from '../contracts/index.js';
import type { UiSessionDeleteResult } from '../contracts/index.js';
import type { UiForkBeforeMessageResult } from '../contracts/index.js';

/**
 * todo 条目（07 §4.1 呈现面件 4——todoFor 注入载荷）：items 全量快照真源 =
 * 05 §1.1 todo/write 事件载荷，本形是呈现投影（装配从 todo 状态映射注入；
 * webui SPA 同源折叠产物）。
 */
export interface TodoItem {
  /** 四态（呈现记号：☐ 待办 / ◐ 进行中 / ☑ 已完成·暗淡 / ⊙ 缓办·暗淡） */
  readonly status: 'pending' | 'in-progress' | 'completed' | 'deferred';
  /** 条目内容 */
  readonly content: string;
  /** 进行文案（进行中态优先于 content 呈现——CC 式 activeForm 语义） */
  readonly activeForm?: string;
}

/** 命令参数（03 §2.2 签名定形：raw 原文引号原样 / argv 引号感知词切分） */
export interface CommandArgs {
  /** 命令名后的输入原文（引号形态原样保留） */
  readonly raw: string;
  /** 引号感知切分的词数组（单引号保字面、双引号保内部空格、裸词按空白切） */
  readonly argv: readonly string[];
  /**
   * 发起会话 id（07 §4.3 消费腿条款档位 2 配套——交互动词族批 ix-2 新建）：
   * 命令由会话输入框发起时通道核透传发起会话；CLI 面命令（无会话语境）
   * 缺席——缺席即无锚语境，ctx.ui 阻塞三件须显式 opts.sessionId。
   */
  readonly sessionId?: string;
}

/** TUI 命令 handler 形（03 §2.2：void/Promise 双形） */
export type CommandHandler = (args: CommandArgs) => void | Promise<void>;

/** 命令注册条目（/help 与补全面消费——description 可选） */
export interface CommandSpec {
  readonly name: string;
  readonly handler: CommandHandler;
  readonly description?: string;
}

/** 提问队列项 kind（07 §4.3 提问队列：阻塞原语与审批 ask 统一入队） */
export type AskKind = 'confirm' | 'select' | 'input' | 'approval';

/**
 * ask 收场落史总线词（挖掘 36 轮 [2]——07 §4.1 问答落史行词条；approval/
 * settled 同构先例）。住本面非 contracts：活体总线词册在 host dispatch
 * （check-api 快照射程零漂移），host 侧经 channels 公开面 import（DAG 边表
 * channels→conversation 禁使词单源 import 不可达——词住被消费域）。
 */
export const ASK_SETTLED_EVENT = 'ask/settled';

/**
 * ask 收场通知（UiCore 收场单汇点发射——阻塞三件专属；审批族走
 * approval/settled 自有面）。后端面 confirm/select/input 无会话语境——
 * 后端层记录会跨会话错挂 + 竞速败腿误记已取消，两害皆结构性不可救，
 * 记录位定谳归核单汇点（07 §4.1 词条记录位定谳句）。
 */
export interface AskSettledNotice {
  readonly sessionId: string;
  /** 原语词（approval 不产本通知——durable 词对另立挂账） */
  readonly kind: 'confirm' | 'select' | 'input';
  /** 原问题文（降级腿记原问题非降级提示文——UiCore 入参单源，免问题失真） */
  readonly question: string;
  /** 收场态：answered = present 胜出（含他端竞速答走——真相在单汇点可辨）；cancelled = 保守收场（外 signal/队收口/present 异常伞形） */
  readonly outcome: 'answered' | 'cancelled';
  /** 答案呈现段（answered 在场）：confirm→是/否；select→label 缺席回 value；input→原文/（空） */
  readonly answer?: string;
}

/**
 * 通道核装配选项。投影拉取经注入回调（host 装配侧钉 session 面——channels
 * 不依赖 session 是 02 §4.1 边表的刻意设计，投影类型 TProjection 由装配钉入）。
 */
export interface ChannelsOptions<TProjection> {
  /**
   * 投影拉取注入（焦点切换清屏重画的数据源——07 §4.1 通道契约）。
   * 缺席时 focus 仍可切（焦点态生效）、repaint 以空投影收场——装配错误
   * 呈现缺真源是核可观察态，不静默假装有历史。
   */
  readonly fetchProjection?: (sessionId: string) => Promise<readonly TProjection[]>;
  /**
   * 审批 always 的策略表回写注入（07 §4.3 提问队列条款 / 04 §9 ③ 既有
   * 条款的通道侧接法）：用户答 `always` 且载荷带 suggestedEntry 草案 → 本
   * 回调落跨会话策略表 allow 条目（用户显式按键后机器只执行写入——装配接
   * safety 侧写入面）。无草案 always 不触发（零草案零副作用）。
   */
  readonly onApprovalAlways?: (entry: string) => void;
  /**
   * 历史正文拉取注入（07 §4.1 件 8 /history——批 10f-4 接线位）：与
   * fetchProjection 同层同形（通道核只消费注入回调不依赖 session——边表
   * 执法的刻意设计；真源接线归批 12 host 装配）。在场 = 通道核注册
   * /history 命令（真源 = 聚焦会话 → 拉全量 durable 正文投影 → 扇出后端
   * openHistory）；缺席 = 不注册不虚报（件 8 条款注册面律）。
   */
  readonly history?: (sessionId: string) => Promise<readonly TProjection[]>;
  /**
   * 用户消息回溯 fork 注入（挖掘 36 轮件 8 回溯 fork 批——session-rewind-fork）：
   * 在场 = 通道核 /history 扇出时铸 openHistory 第三参回调（回看器「e 回溯」
   * 键行为的机器面）；缺席 = 第三参 undefined（缺席注入律——键无效零行为变，
   * /history 注册面仍只系 history 注入在场）。机器路 = manager.fork
   * (sessionId,{upToSeq: beforeSeq−1})（05 §5.1 钩子/洪水闸 + 04 §1 封印位
   * 全律承接）；回执三态（forked/vetoed/error）由核 wrapper 路由 notify/focus。
   */
  readonly forkBeforeMessage?: (sessionId: string, beforeSeq: number) => Promise<UiForkBeforeMessageResult>;
  /**
   * 记忆管理面注册位（06 §7 `/memory`——mm 批）：与 history 同层同律的
   * 注入在场判（在场 = 通道核注册 /memory 命令；缺席 = 不注册不虚报）。
   * true 形非回调——管理面数据不经通道核流转（后端装配自持材料，openMemory
   * 零参形），通道核只做命令受理与扇出；扇出 falsy（后端不支持或缺材料）
   * 时 notify 降级提示。装配真值 = 座位在位（persistence 在场 ⇒ memory 件
   * 将装载；件缺席由降级提示诚实兜底）。
   */
  readonly memory?: true;
  /**
   * 会话清单拉取注入（07 §4.1 R7 批 10k `/sessions`——注册面律同 history：
   * 在场即注册、缺席不注册不虚报）。真源 = 拉会话清单 → 扇出后端
   * openSessions；选定回调在核内铸（registry.focus() 既有权威路——未注册
   * 会话 focus 视同注册，焦点即活跃声明）。
   */
  readonly sessions?: () => Promise<readonly UiSessionSummary[]>;
  /**
   * 会话全量总数注入（B2 截断披露——清单注入有默认 100 窗，总数独立单源：
   * 超窗时切换器头行注记「N/M（仅显示最近）」；缺席 = 不披露〔与清单长度
   * 同〕，与 sessions 注入同装配层成对出现）。
   */
  readonly sessionsTotal?: () => Promise<number>;
  /**
   * 会话用量聚合注入（07 §4.1 R7 批 10k `/usage`——注册面律同上）：数据源
   * = 件 6 同数据源（message.usage）但独立聚合——会话全 run 累计，非复用
   * 件 6 清账态。真源 = 聚焦会话 → 拉汇总 → 扇出后端 openUsage。
   */
  readonly usage?: (sessionId: string) => Promise<UiUsageSummary>;
  /**
   * 会话调用台账注入（07 §4.1 ZCode TUI 对标批 B3 定形注——`/calls`——
   * 注册面律同 usage：注入在场即注册、缺席不注册不虚报）。真源 = 聚焦会话
   * → 双事实源折叠台账（conversation 侧 foldCallLedger 尾窗产物 + 全量
   * 计数）→ 扇出后端 openCalls；快照档语义（dispatch 时现读——开屏后新
   * 调用不进在场面板，重开重取；无订阅无推送面）。
   */
  readonly calls?: (sessionId: string) => Promise<UiCallLedger>;
  /**
   * 会话显式题改名注入（07 §4.1 2026-09-30 会话管理命令批 `/rename`——
   * 注册面律同 sessions：注入在场即注册、缺席不注册不虚报）。写面净化+200
   * 帽不属通道核（核不懂净化——呈现编排者只透传原始名，净化组合单源
   * clampTitleText 归注入侧装配层；CLI `sessions rename` 动词同源）；
   * 返值三态归核统一回执路由。
   */
  readonly renameSession?: (sessionId: string, rawTitle: string) => Promise<RenameSessionResult>;
  /**
   * 会话续接注入（2026-09-30 会话管理命令批批2 `/resume`——注册面律同上：
   * 注入在场即注册、缺席不注册不虚报）。机器路 = manager.open 幂等续接
   * （装配侧——已 open 直达活体零成本；open 的 SESSION_NOT_FOUND 折
   * false 诚实拒，其他错误上抛）。true 时核走 registry.focus 权威路切焦
   * （切焦不打断——in-flight run 跨切焦继续）。双消费位：`/resume` 带参
   * 直通 + `/sessions` 选定回调升级（在场时选定即续接可写；缺席保持纯
   * focus 查看器——零行为变）。
   */
  readonly resumeSession?: (sessionId: string) => Promise<boolean>;
  /**
   * 会话删除注入（05 §2.5 会话删除编排定形注①②——注入模板 = resumeSession/
   * renameSession 同款「注入在场即注册、缺席不虚报」）。机器路 = manager
   * .deleteSession 六步编排（装配侧 seam 闭包——busy 守卫→channels 收口→
   * 登记拆除→物理三删→授予回收→焦点处置）。回执三态归核统一路由
   * （busy→warn 指路等待或先打断 / missing→warn 不存在 / deleted→成功回执）。
   * 消费位 = `/sessions` 面板删除键回调（picker onDelete——缺席键无效）。
   */
  readonly deleteSession?: (sessionId: string) => Promise<UiSessionDeleteResult>;
  /**
   * 会话尾段预览注入（挖掘 35 轮 B5 `/sessions` 切换器展开键——注册面律
   * 同 sessions 族：注入在场才有键行为，缺席 = 键无效零行为变）。真源 =
   * 光标行会话 → 投影读面过滤 user/assistant 正文消息取尾段（升序旧→新，
   * 单行化+200 字素帽归装配侧）；异步回执归呈现件缓存（不经核路由）。
   */
  readonly sessionPreview?: (sessionId: string) => Promise<readonly UiSessionPreviewLine[]>;
  /**
   * 整轮回复拉取注入（挖掘 36 轮批 [2] `/copy`——注册面律同 usage 族：
   * 在场即注册、缺席不注册不虚报）。真源 = 聚焦会话（或 args.sessionId
   * 显式锚）→ 双事实源拉末条带正文 assistant 消息（driver 活体 → durable
   * 回退）→ 消毒文本（与 /export 单源 textOf 同律）；全空返 null 诚实 warn
   * （非静默）。快照档语义：dispatch 时现读，无订阅无推送面。
   */
  readonly lastResponse?: (sessionId: string) => Promise<string | null>;
  /**
   * ask 收场落史单汇点注入（挖掘 36 轮 [2]——07 §4.1 问答落史行）：装配根经
   * dispatch 总线词 `ask/settled` 扇出（TUI 直播腿订阅——approval/settled
   * 同构；晚绑定由总线解：UiCore 建于 createChannels、TUI 后端建于
   * tui-entry，直连不可达）。缺席注入律：缺席 = 零通知零行为。
   */
  readonly askSettledSink?: (notice: AskSettledNotice) => void;
  /**
   * 敏感值兜底扫描集（挖掘 37 轮件 3——04 §7 掩码词条）：已知秘密值册活值
   * getter（credentials 库 live 读，与出口消毒值基腿同源装配、多会话共享）。
   * 消费位 = UiCore answerOf 产出口两腿扫描之值基腿源（词条旗治调用方已知、
   * 扫描腿治漏报——并集制）。缺席 = 值基腿空集（模式腿 redactSensitiveText
   * 照常恒在场）。
   */
  readonly sensitiveValues?: () => readonly string[];
}

/**
 * `/rename` 改名写面结果三态（注入面 → 通道核回执路由）：
 *  - `ok`——写入成功（title = 净化+帽后的落库名，回执呈显用）；
 *  - `empty`——净化归空（控制字节/零宽字素剥光——拒不落库）；
 *  - `missing`——目标会话不存在（诚实拒，不虚报成功）。
 */
export type RenameSessionResult =
  { readonly status: 'ok'; readonly title: string } | { readonly status: 'empty' } | { readonly status: 'missing' };
