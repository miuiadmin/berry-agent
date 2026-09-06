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

import type { AgentEvent } from '../agent/index.js';

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

// 审批 ask 词汇归位 contracts（批 11b——conversation 消费同形而边表不可达
// channels）；本面 re-export 维持通道侧公开面不变
export type { ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';

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

/** input 原语选项 */
export interface UiInputOptions extends UiAskOptions {
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
 * 通道后端接口（通道核的呈现消费面）。TUI 实装 = 件内自研 TuiBackend（批
 * 10e 已落）、webui 件同面接入；核经此面驱动一切呈现——阻塞原语多后端并发竞速（04 §9 跨入口竞速
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
