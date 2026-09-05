/**
 * 提问队列（07 §4.3 提问队列机制正文——2026-09-06 channels 纵切批补写）：
 * 阻塞原语（confirm/select/input）与审批 ask 统一入 per-session FIFO——
 * 队首才呈现、应答即出队、后继顶上（「无并存态」即此律）。
 *
 * 收口三则（规范同条）：会话关闭按 sessionId 清队（余项按取消语义收场——
 * 保守值同撤销面）；run 打断信号穿透队内该 run 发起的 ask（signal 由调用方
 * ui-core 携带，队列不感知 run）；队列是内存态、崩溃即丢（durable 真相在
 * 审批日志不在队列——与 04 §4 PendingMessageQueue 同纪）。
 *
 * 队列持在通道核、呈现形态归后端（TUI overlay 是队首呈现之一）——本类只管
 * 排序与收口，backend 编舞（竞速/撤销说明行）归 ui-core。
 */

import type { AskKind } from './types.js';

/** 队项钩子：start = 晋升队首（发后端）；cancel = 取消收场（含在飞态——保守值 + 撤销归 ui-core） */
export interface AskHooks {
  /** 晋升队首：真正发给后端（overlay 占焦等呈现态由此起） */
  readonly start: () => void;
  /** 取消收场：排队中（未 start）与在飞（已 start 未 settle）两态都可达——保守值结算 + 后端撤销 */
  readonly cancel: () => void;
}

/** per-session 队列内部态 */
interface SessionQueue {
  /** 排队项（不含在飞队首） */
  readonly pending: { kind: AskKind; hooks: AskHooks }[];
  /** 在飞队首（null = 该会话队列空转） */
  active: { kind: AskKind; hooks: AskHooks } | null;
}

/**
 * 提问队列（per-session FIFO）。同会话严格串行（队首在飞时后继排队）；
 * 异会话队列独立（各自队首并行——呈现并存的裁决归后端 overlay 层）。
 */
export class AskQueue {
  private readonly sessions = new Map<string, SessionQueue>();

  private ensure(sessionId: string): SessionQueue {
    let q = this.sessions.get(sessionId);
    if (q === undefined) {
      q = { pending: [], active: null };
      this.sessions.set(sessionId, q);
    }
    return q;
  }

  /** 入队：会话队列空闲即直晋队首（start 同步调用——FIFO 无空转窗）；否则排队 */
  enqueue(sessionId: string, kind: AskKind, hooks: AskHooks): void {
    const q = this.ensure(sessionId);
    if (q.active === null) {
      q.active = { kind, hooks };
      hooks.start();
    } else {
      q.pending.push({ kind, hooks });
    }
  }

  /**
   * 队首落定（应答/保守值收场都算——由 ui-core 在 promise 链尾调用）：
   * 出队、后继顶上。未知会话/已清队 no-op（clearSession 后迟到落定不炸）。
   */
  settled(sessionId: string): void {
    const q = this.sessions.get(sessionId);
    if (q === undefined) return;
    if (q.active === null) return; // 空转（迟到落定）——幂等
    const next = q.pending.shift();
    if (next === undefined) {
      q.active = null; // 队列清空（会话条目留存——防高频重建；clearSession 才真清）
    } else {
      q.active = next;
      next.hooks.start();
    }
  }

  /**
   * 会话收口（04 §9 归属围栏通道侧执法）：清排队项 + 取消在飞队首——
   * 全部走 cancel（保守值同撤销面：confirm→false / select·input→''、
   * approval→cancelled 语义由 ui-core 落）。
   */
  clearSession(sessionId: string): void {
    const q = this.sessions.get(sessionId);
    if (q === undefined) return;
    const all = q.active === null ? [...q.pending] : [q.active, ...q.pending];
    q.pending.length = 0;
    q.active = null;
    this.sessions.delete(sessionId);
    // 逐项 cancel：在飞与排队同语义收场（cancel 实现须幂等——settled 迟到不双结）
    for (const item of all) item.hooks.cancel();
  }

  /** 观察面：会话在飞+排队项 kind 序列（测试与 /help 类诊断面消费） */
  pending(sessionId: string): readonly AskKind[] {
    const q = this.sessions.get(sessionId);
    if (q === undefined) return [];
    return q.active === null ? q.pending.map((p) => p.kind) : [q.active.kind, ...q.pending.map((p) => p.kind)];
  }
}
