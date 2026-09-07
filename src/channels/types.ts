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
} from '../contracts/index.js';

// 审批 ask 词汇归位 contracts（批 11b——conversation 消费同形而边表不可达
// channels）；本面 re-export 维持通道侧公开面不变
export type { ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';

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
   * 审批 always 的 allowlist 回写注入（07 §4.3 提问队列条款 / 04 §9 ③ 既有
   * 条款的通道侧接法）：用户答 `always` 且载荷带 suggestedEntry 草案 → 本
   * 回调落跨会话 allowlist 条目（用户显式按键后机器只执行写入——装配接
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
}
