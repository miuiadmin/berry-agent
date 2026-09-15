/**
 * 会话用量折叠（07 §4.1 R7 批 10k `/usage`——数据源条款落码）：
 * SessionEvent 流 → 会话全 run 累计汇总。纯函数（foldTodoTable 同形先例
 * ——呈现投影归约，装配注入通道核；通道核 /usage 命令拉取扇出）。
 *
 * 计数口径（R7 条款 + 诚实账注）：
 * - **计 ALL assistant/message 事件**——含被遮蔽 retry 形。遮蔽是呈现层
 *   概念（投影回读拼装位跳过），token 已真实花费——用量账以全事件计，
 *   与件 6 run 级清账态（repaint 归零重计）分职不互替；
 * - turns = turn/end 计数（含 aborted / error 收场——真实发生过的轮）；
 * - cost 在场才累、currency 首见定着（与件 6 accumulateUsage 同律）；
 * - 载荷缺 usage（防御位——旧日志或非标准形）跳过不炸。
 */
import type { SessionEvent, Usage } from '../contracts/index.js';

/** 会话用量汇总（通道核 UiUsageSummary 的 conversation 侧真源形——结构兼容经装配透传） */
export interface SessionUsageSummary {
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

/** 零账基线（空事件流产物） */
export const ZERO_SESSION_USAGE: SessionUsageSummary = Object.freeze({
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: 0,
  currency: null,
});

/** usage 载荷形判（防御位——event.data 是 unknown，数值四键在场才算真载荷） */
function isUsageShape(value: unknown): value is Usage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.input === 'number' && typeof v.output === 'number' && typeof v.totalTokens === 'number';
}

/**
 * 折叠会话事件流为全 run 用量汇总。assistant/message 载荷 = 完整 assistant
 * 消息含 usage（05 §1.1 durable 事件序——wiring.appendMessage 落账形）。
 */
export function foldSessionUsage(events: readonly SessionEvent[]): SessionUsageSummary {
  let turns = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  let cost = 0;
  let currency: string | null = null;
  for (const event of events) {
    if (event.type === 'turn/end') turns += 1;
    if (event.type !== 'assistant/message') continue;
    const usage = (event.data as { usage?: unknown }).usage;
    if (!isUsageShape(usage)) continue; // 缺 usage 防御位——跳过不炸
    input += usage.input;
    output += usage.output;
    cacheRead += usage.cacheRead;
    cacheWrite += usage.cacheWrite;
    totalTokens += usage.totalTokens;
    cost += usage.cost?.total ?? 0;
    currency = currency ?? usage.cost?.currency ?? null;
  }
  return { turns, input, output, cacheRead, cacheWrite, totalTokens, cost, currency };
}
