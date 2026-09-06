/**
 * DiscoveryGates 触发前置条件门（04 §12 /tick 瘦身条「照搬」——蓝本
 * pilotdeck always-on DiscoveryGates 的纯闸评估序：**序定 first-failing-wins**，
 * 单 Agent 场景裁多 project 位〔project_disabled/project_missing/
 * dormant_no_signal/lock_busy 四门系 pilotdeck 多项目形态私有〕留五门）。
 *
 * 闸序（序即语义——前面的门先判，先拦先报）：
 *   1. job_disabled     行启停位关（引擎 due 集已滤——belt 位，闸面仍判）
 *   2. agent_busy       宿主前台在飞（单活跃机——定时任务不与用户对话抢跑）
 *   3. recent_user_msg  用户静默窗内（刚说过话的窗口期不打扰）
 *   4. cooldown         同任务上次触发后的冷却窗内（防高频任务空转连发）
 *   5. daily_budget     当日后台预算 canAfford 闸（04 §5——缺预算跳本轮下周期再试）
 *
 * 判据全注入（GateFacts 由装配层从宿主面收集；评估器零 IO 零时钟）——
 * 缺席事实 = 闸放行（探针未装配的门不咬——fail-open 属实：这些门是打扰
 * 礼仪与预算面，非安全边界；安全边界在 runner 的 --read-only 与审批
 * fail-closed）。
 */

/** 闸评估输入事实（全可选——缺席即该门放行） */
export interface GateFacts {
  /** 行启停位（缺席 = 视为启用） */
  enabled?: boolean;
  /** 宿主前台是否有在飞对话轮（缺席 = 空闲） */
  agentBusy?: boolean;
  /** 最近一次用户消息时刻（ISO UTC；缺席 = 无近期消息） */
  lastUserMessageAt?: string | null;
  /** 同任务上次触发时刻（ISO UTC；缺席 = 从未触发） */
  lastFireAt?: string | null;
  /** 当日后台预算是否可负担（缺席 = 可负担——canAfford 未装配不拦） */
  canAfford?: boolean;
}

/** 闸评估时基（现在时刻 ISO UTC——调用方注入） */
export interface GateContext {
  now: string;
}

/** 拦截结果（first-failing-wins；null = 全门放行） */
export interface GateBlock {
  gate: GateId;
  reason: string;
}

/** 闸 id 序（评估序即语义序——勿重排：便宜的门在前、需要事实的门在后） */
export const GATE_ORDER = ['job_disabled', 'agent_busy', 'recent_user_msg', 'cooldown', 'daily_budget'] as const;

export type GateId = (typeof GATE_ORDER)[number];

/** 用户静默窗（毫秒）——窗内近期用户消息即拦（不打扰正在交互的用户） */
export const USER_QUIET_WINDOW_MS = 5 * 60_000;
/** 同任务冷却窗（毫秒）——上次触发后此窗内不再连发 */
export const JOB_COOLDOWN_MS = 60_000;

/**
 * 序定闸评估：依 GATE_ORDER 逐门判、先拦先报。
 *
 * manual 触发不走本评估（/tick run = 用户显式意图——04 §12 未辖手动道，
 * pi-tick manual 同律不设闸）；本函数只辖挂钟/cron 到点道。
 */
export function evaluateGates(facts: GateFacts, ctx: GateContext): GateBlock | null {
  const nowMs = Date.parse(ctx.now);
  // 1. job_disabled——行关即拦（belt：due 集已滤 enabled，闸面独立判一次）
  if (facts.enabled === false) {
    return { gate: 'job_disabled', reason: '任务行处于停用态' };
  }
  // 2. agent_busy——前台在飞即拦（本轮跳过，advance 到下一刻）
  if (facts.agentBusy === true) {
    return { gate: 'agent_busy', reason: '宿主前台对话在飞' };
  }
  // 3. recent_user_msg——静默窗内有用户消息即拦
  if (facts.lastUserMessageAt) {
    const at = Date.parse(facts.lastUserMessageAt);
    if (!Number.isNaN(at) && nowMs - at < USER_QUIET_WINDOW_MS) {
      return { gate: 'recent_user_msg', reason: `静默窗（${USER_QUIET_WINDOW_MS / 1000}s）内有用户消息` };
    }
  }
  // 4. cooldown——同任务冷却窗内即拦
  if (facts.lastFireAt) {
    const at = Date.parse(facts.lastFireAt);
    if (!Number.isNaN(at) && nowMs - at < JOB_COOLDOWN_MS) {
      return { gate: 'cooldown', reason: `上次触发后冷却窗（${JOB_COOLDOWN_MS / 1000}s）内` };
    }
  }
  // 5. daily_budget——canAfford 假即拦（跳本轮，下周期再试）
  if (facts.canAfford === false) {
    return { gate: 'daily_budget', reason: '当日后台预算不可负担（canAfford 假）' };
  }
  return null;
}
