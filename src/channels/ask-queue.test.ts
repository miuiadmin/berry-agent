/**
 * AskQueue 直接单测（07 §4.3 提问队列——批 10a 至今仅经组合根 channels.test.ts
 * 间接覆盖；本件补队列自身单元边界：直晋同步性 / FIFO 顶上 / settled 幂等 /
 * 条目留存行为回归 / clearSession 全 cancel 与条目真清）。
 */
import { describe, expect, it } from 'vitest';
import { AskQueue } from './ask-queue.js';
import type { AskHooks } from './ask-queue.js';
import type { AskKind } from './types.js';

/** 入队素材：start/cancel 钩子各记一行日志（顺序即编舞时序） */
function hooks(kind: AskKind, log: string[]): AskHooks {
  return {
    start: () => log.push(`start:${kind}`),
    cancel: () => log.push(`cancel:${kind}`),
  };
}

describe('AskQueue（per-session FIFO）', () => {
  it('空闲入队直晋队首：start 同步调用（FIFO 无空转窗）', () => {
    const q = new AskQueue();
    const log: string[] = [];
    q.enqueue('s1', 'confirm', hooks('confirm', log));
    expect(log).toEqual(['start:confirm']);
    expect(q.pending('s1')).toEqual(['confirm']);
  });

  it('同会话 FIFO：队首在飞后继排队，settled 逐个顶上、清空后无新 start', () => {
    const q = new AskQueue();
    const log: string[] = [];
    q.enqueue('s1', 'confirm', hooks('confirm', log));
    q.enqueue('s1', 'select', hooks('select', log));
    q.enqueue('s1', 'input', hooks('input', log));
    expect(log).toEqual(['start:confirm']); // 仅队首 start
    expect(q.pending('s1')).toEqual(['confirm', 'select', 'input']);
    q.settled('s1');
    expect(log).toEqual(['start:confirm', 'start:select']);
    q.settled('s1');
    expect(log).toEqual(['start:confirm', 'start:select', 'start:input']);
    q.settled('s1'); // 队列已空——no-op
    expect(log).toEqual(['start:confirm', 'start:select', 'start:input']);
    expect(q.pending('s1')).toEqual([]);
  });

  it('异会话队列独立：各自队首并行直晋（互不阻塞）', () => {
    const q = new AskQueue();
    const log: string[] = [];
    q.enqueue('s1', 'confirm', hooks('confirm', log));
    q.enqueue('s2', 'select', hooks('select', log));
    expect(log).toEqual(['start:confirm', 'start:select']);
  });

  it('settled 幂等：未知会话与空转（迟到落定）都 no-op 不炸', () => {
    const q = new AskQueue();
    const log: string[] = [];
    expect(() => q.settled('nobody')).not.toThrow(); // 未知会话
    q.enqueue('s1', 'confirm', hooks('confirm', log));
    q.settled('s1');
    q.settled('s1'); // 空转迟到落定——不重复顶上
    expect(log).toEqual(['start:confirm']);
  });

  it('队列清空后会话条目留存不碍事：再入队仍直晋（「防高频重建」注记的行为回归）', () => {
    const q = new AskQueue();
    const log: string[] = [];
    q.enqueue('s1', 'confirm', hooks('confirm', log));
    q.settled('s1'); // 清空——条目留存（clearSession 才真清）
    q.enqueue('s1', 'select', hooks('select', log));
    expect(log).toEqual(['start:confirm', 'start:select']);
  });

  it('clearSession：在飞+排队全 cancel（在飞先、排队依序）、条目真清、幂等', () => {
    const q = new AskQueue();
    const log: string[] = [];
    q.enqueue('s1', 'confirm', hooks('confirm', log));
    q.enqueue('s1', 'select', hooks('select', log));
    q.enqueue('s1', 'input', hooks('input', log));
    q.clearSession('s1');
    expect(log).toEqual(['start:confirm', 'cancel:confirm', 'cancel:select', 'cancel:input']);
    expect(q.pending('s1')).toEqual([]);
    q.settled('s1'); // 条目已删——迟到落定 no-op
    q.clearSession('s1'); // 幂等：无条目零 cancel
    expect(log).toEqual(['start:confirm', 'cancel:confirm', 'cancel:select', 'cancel:input']);
  });

  it('pending 观察面：四种 kind 全谱 + 未知会话空数组', () => {
    const q = new AskQueue();
    expect(q.pending('nobody')).toEqual([]);
    const log: string[] = [];
    for (const kind of ['confirm', 'select', 'input', 'approval'] as const) {
      q.enqueue('s1', kind, hooks(kind, log));
    }
    expect(q.pending('s1')).toEqual(['confirm', 'select', 'input', 'approval']);
  });
});
