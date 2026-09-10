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
}
