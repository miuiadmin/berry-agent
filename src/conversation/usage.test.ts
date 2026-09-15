/**
 * 会话用量折叠测试（批 10k R7——纯函数直锁）：空流零账 / 多事件累计 /
 * 被遮蔽 retry 双计（口径条款）/ 缺 usage 防御 / turn 计数 / cost 在场才累
 * 与 currency 首见定着。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { foldSessionUsage, ZERO_SESSION_USAGE } from './usage.js';

/** 事件夹具（seq/time 非本 fold 消费面——零值占位） */
function ev(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data };
}

/** assistant/message 带 usage 载荷形（wiring.appendMessage 落账形） */
function assistantUsage(usage: unknown): SessionEvent {
  return ev('assistant/message', { stopReason: 'stop', usage });
}

/** 基线 usage 载荷（四分表 + 合计——cost 可选携带） */
function usageOf(
  over: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }>,
  cost?: { total: number; currency?: string },
): unknown {
  return {
    input: over.input ?? 0,
    output: over.output ?? 0,
    cacheRead: over.cacheRead ?? 0,
    cacheWrite: over.cacheWrite ?? 0,
    totalTokens: over.totalTokens ?? 0,
    ...(cost !== undefined ? { cost } : {}),
  };
}

describe('foldSessionUsage', () => {
  it('空事件流 = 零账基线（ZERO_SESSION_USAGE 同形）', () => {
    expect(foldSessionUsage([])).toEqual(ZERO_SESSION_USAGE);
  });

  it('多条 assistant/message 四分表 + 合计累计', () => {
    const events = [
      assistantUsage(usageOf({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165 })),
      assistantUsage(usageOf({ input: 200, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 230 })),
    ];
    expect(foldSessionUsage(events)).toMatchObject({
      turns: 0,
      input: 300,
      output: 80,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 395,
    });
  });

  it('被遮蔽 retry 双计（口径条款——token 已真实花费，遮蔽是呈现层概念）', () => {
    // 原始 assistant 与 retry 替换形都在事件流（surfaceOp 遮蔽归投影位管）
    const events = [
      assistantUsage(usageOf({ input: 100, output: 40, totalTokens: 140 })),
      assistantUsage(usageOf({ input: 100, output: 40, totalTokens: 140 })), // retry 形
    ];
    expect(foldSessionUsage(events)).toMatchObject({ input: 200, output: 80, totalTokens: 280 });
  });

  it('缺 usage 载荷防御位：跳过不炸（旧日志/非标准形）', () => {
    const events = [
      ev('assistant/message', { stopReason: 'stop' }), // 无 usage 键
      assistantUsage(null), // usage = null 坏形
      assistantUsage({ input: 'x', output: 1, totalTokens: 1 }), // 数值键缺——非真载荷
      assistantUsage(usageOf({ input: 10, output: 5, totalTokens: 15 })), // 好形
    ];
    expect(foldSessionUsage(events)).toMatchObject({ input: 10, output: 5, totalTokens: 15 });
  });

  it('turns = turn/end 计数（含 aborted/error 收场轮）', () => {
    const events = [
      assistantUsage(usageOf({ input: 1, output: 1, totalTokens: 2 })),
      ev('turn/end', { reason: 'completed' }),
      ev('turn/end', { reason: 'aborted' }),
      ev('turn/end', { reason: 'error' }),
    ];
    expect(foldSessionUsage(events).turns).toBe(3);
  });

  it('cost 在场才累、currency 首见定着（后续 cost 缺席不洗掉币种）', () => {
    const events = [
      assistantUsage(usageOf({ input: 10, output: 5, totalTokens: 15 }, { total: 0.5, currency: 'USD' })),
      assistantUsage(usageOf({ input: 10, output: 5, totalTokens: 15 })), // 无 cost——币种保持
      assistantUsage(usageOf({ input: 10, output: 5, totalTokens: 15 }, { total: 0.25, currency: 'EUR' })), // 非首见不理
    ];
    expect(foldSessionUsage(events)).toMatchObject({ cost: 0.75, currency: 'USD' });
  });

  it('全程无 cost 上报 = cost 0 + currency null（诚实空态）', () => {
    const events = [assistantUsage(usageOf({ input: 10, output: 5, totalTokens: 15 }))];
    expect(foldSessionUsage(events)).toMatchObject({ cost: 0, currency: null });
  });

  it('非 assistant/message 与非 turn/end 事件零参与（user/todo 等）', () => {
    const events = [
      ev('user/message', { content: '问' }),
      ev('todo/write', { items: [] }),
      ev('tool/call', { name: 'read' }),
    ];
    expect(foldSessionUsage(events)).toEqual(ZERO_SESSION_USAGE);
  });
});
