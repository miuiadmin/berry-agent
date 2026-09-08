/**
 * conversation — 跨会话操控面（03 §2.2 第十一面 `sessions-control`——e-1
 * 规范先行批立面、2026-09-08 e-4 落码批兑现）。
 *
 * **双面同源**（题 7 拍板）：模型走宿主内建固定工具族（`session_send` /
 * `session_interrupt` / `session_withdraw`——恒挂载不随门开合动态挂载），
 * 插件代码走 `ctx.get("sessions-control")` 服务面；**两面同一实现源**——
 * 工具 = 服务面薄包装，动词语义单源本文件（受理器 + 契约）。
 *
 * 三动词（共同前置：幽灵守卫 `SESSION_TARGET_NOT_FOUND` → 门检
 * `SESSION_CONTROL_DENIED`〔操控轴无树内豁免、全域同门〕→ …动词各自位）：
 *  - `send`：跨会话输入注入——发送方不选通道（04 §4 三通道路由驱动侧
 *    单源：idle→followUp 起跑 / busy→steer 合批 / 停摆→inject 带入），
 *    回执 = 入列回执（被丢/被拒项呈报不静默）；`expectedTurnId?` 乐观
 *    并发位（翻页拒 `SESSION_TURN_STALE`）；a2a 链深超帽拒
 *    `SESSION_ROUND_LIMIT`。
 *  - `interrupt`：打断目标在飞 run（turn 终态 interrupted）；无在飞拒
 *    `SESSION_INACTIVE`（响亮拒不静默 no-op）。e-4 基础档回执；
 *    still-queued 后果清单词形随 e-5 定形（03 §2.2 同句）。
 *  - `withdraw`：在队撤回对称闭环（已出队 no-op 诚实回执；题 9 缺省案
 *    随 e-5 呈拍）。
 *
 * **provenance 盖章单源**（05 §3.1）：注入的 user/message `source` 由本
 * 受理面按调用方身份（ControlCaller）铸——模型工具道 `session:<送话会话id>`、
 * 插件服务道 `plugin:<插件id>`（既有前缀复用）；**调用方传入面无 source
 * 参数位**——伪造结构性不存在。
 */
import type { UserMessage } from '../contracts/index.js';

/** 操控轴高危面名（03 §4.6 v1 首批第六枚——操控全域无树内豁免，两轴分立） */
export const CONTROL_CROSS_CAPABILITY = 'sessions.control-cross';

/** 服务面名（scope.provide 键——插件经 `ctx.get("sessions-control")` 消费） */
export const SESSIONS_CONTROL_SERVICE = 'sessions-control';

/** a2a 回合护栏帽缺省（03 §2.2 第十一面题 8 呈拍定案：缺省 5 对齐 openclaw；装配可覆盖） */
export const A2A_ROUND_LIMIT_DEFAULT = 5;

/**
 * 调用方身份（provenance 盖章单源的输入面）：受理面据此铸 source 前缀——
 * `session` 道 → `session:<sessionId>`（05 §3.1 新前缀行）、`plugin` 道 →
 * `plugin:<pluginId>`（既有前缀复用）。两道 a2a 链深计数同律（plugin 道
 * 起跳链深 1——插件直唤即第一跳）。
 */
export type ControlCaller =
  { readonly kind: 'session'; readonly sessionId: string } | { readonly kind: 'plugin'; readonly pluginId: string };

/**
 * send 回执（04 §4 入列回执——受理与去向呈报不静默；类型化回执词归
 * contracts 词汇非错误码——02 §5.3 词形注）：
 *  - `delivered`：已投递——idle 腿 followUp 起跑（fire-and-forget，回执即
 *    时返）或停摆腿 inject 落账（携 durable seq）；
 *  - `queued`：busy 腿 steer 入列（drop-oldest 溢出时被丢旧件呈报——
 *    `droppedMessageId` 为被丢件 id）；
 *  - `dropped`：本件被拒（bounded 拒新档——驱动队列缺省 drop-oldest，
 *    此档为词形完备性防御位）。
 */
export type ControlSendReceipt =
  | { readonly status: 'delivered'; readonly messageId: string; readonly seq?: number }
  | { readonly status: 'queued'; readonly messageId: string; readonly droppedMessageId?: string }
  | { readonly status: 'dropped'; readonly reason: 'queue-full' };

/**
 * interrupt 回执（e-4 基础档）：打断已受理。still-queued 后果清单（在飞腿
 * 与排队件去向逐项呈报——claude-sdk 先例）词形随 e-5 定形注回写。
 */
export interface ControlInterruptReceipt {
  readonly status: 'interrupted';
  readonly targetSessionId: string;
}

/**
 * withdraw 回执：`withdrawn` = 在队件已移除；`delivered` = 已出队（已被
 * 消费或从未在队——no-op 诚实呈报，不虚构撤回成功）。
 */
export type ControlWithdrawReceipt =
  | { readonly status: 'withdrawn'; readonly messageId: string }
  | { readonly status: 'delivered'; readonly messageId: string };

/** send 入参（source 无参数位——provenance 受理面单源盖章） */
export interface SessionSendInput {
  readonly caller: ControlCaller;
  readonly targetSessionId: string;
  /** 注入文本（非空——空文本是调用方 bug，受理面拒收） */
  readonly text: string;
  /**
   * 乐观并发位（codex expected_turn_id 形）：给定而目标 turn 已翻页拒
   * `SESSION_TURN_STALE`。turnId 形 = 目标 durable 日志最近 turn/start
   * 事件 seq（单源 durable——session_read/session_trace 尾窗可见）。
   */
  readonly expectedTurnId?: number;
}

/** interrupt 入参 */
export interface SessionInterruptInput {
  readonly caller: ControlCaller;
  readonly targetSessionId: string;
}

/** withdraw 入参（messageId = send 回执所铸 id——受理器栈级自增序列） */
export interface SessionWithdrawInput {
  readonly caller: ControlCaller;
  readonly targetSessionId: string;
  readonly messageId: string;
}

/**
 * sessions-control 服务面契约（双面同源的单源实现面——工具族薄包装与
 * ctx.get 消费方共用本面）。受理序（send）：幽灵守卫 → 门检（全域）→
 * a2a 链深帽 → expectedTurnId 对拍 → 投递 + capability/used 审计；
 * interrupt/withdraw：幽灵守卫 → 门检 → 动词位。
 */
export interface SessionsControlFace {
  send(input: SessionSendInput): Promise<ControlSendReceipt>;
  interrupt(input: SessionInterruptInput): Promise<ControlInterruptReceipt>;
  withdraw(input: SessionWithdrawInput): Promise<ControlWithdrawReceipt>;
}

/**
 * 受理面铸 source（provenance 盖章——05 §3.1；唯一合法铸位：driver.submit
 * 对 `session:` 前缀 fail-loud 拒，结构性杜绝绕受理面伪造）。
 */
export function controlSourceOf(caller: ControlCaller): UserMessage['source'] {
  return caller.kind === 'session' ? `session:${caller.sessionId}` : `plugin:${caller.pluginId}`;
}
