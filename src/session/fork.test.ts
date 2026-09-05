/**
 * fork 与前缀种子单元测试（05 篇 §5.0——forkPrefix / slicePrefix / isSeededPrefix）。
 *
 * 执法面红锁：前缀原样引用（结构共享）、切片 seq 重编、遮蔽载体平移
 * （跨界截断/整体在前丢弃/溯源过滤）、种子尾界校验三形态。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { forkPrefix, isSeededPrefix, slicePrefix } from './fork.js';

/** 造事件 helper */
function evt(seq: number, type: string, data: unknown = {}): SessionEvent {
  return { type, seq, time: seq, data };
}

/** 带遮蔽指令的样例日志：两轮对话 + 第二轮后落一条遮 [1,2] 的指令 + 尾随 user */
function occludedLog(): SessionEvent[] {
  return [
    evt(0, 'turn/start'),
    evt(1, 'user/message', { content: 'a' }),
    evt(2, 'assistant/message', { content: [{ type: 'text', text: 'r' }] }),
    evt(3, 'turn/end', { reason: 'completed' }),
    // 遮蔽指令：遮 [1,2]（第一轮的消息体）
    {
      ...evt(4, 'llm/retry', { attempt: 1, phase: 'exhausted', reason: 'overflow' }),
      surfaceOp: { op: 'replace', start: 1, end: 2 },
      sourceEventSeqs: [1, 2, 3],
    },
    evt(5, 'user/message', { content: 'b' }),
  ];
}

describe('forkPrefix 普通前缀拷贝', () => {
  it('[0, upToSeq] 原样引用拷贝（seq 不重编、结构共享——data 冻结态免拷贝）', () => {
    const events = occludedLog();
    const prefix = forkPrefix(events, 4);
    expect(prefix.length).toBe(5);
    for (let i = 0; i <= 4; i++) {
      expect(prefix[i]).toBe(events[i]); // 同一引用（冻结态结构共享）
    }
  });

  it('upToSeq 越界按日志长度收敛（不炸）', () => {
    const events = occludedLog();
    expect(forkPrefix(events, 99).length).toBe(events.length);
  });

  it('遮蔽载体随种子走（前缀内指令与区间原样保留）', () => {
    const prefix = forkPrefix(occludedLog(), 4);
    expect(prefix[4]!.surfaceOp).toEqual({ op: 'replace', start: 1, end: 2 });
  });
});

describe('slicePrefix 中段切片重编', () => {
  it('seq 从 0 重编 + 遮蔽区间/溯源同步平移', () => {
    const sliced = slicePrefix(occludedLog(), 1, 5);
    // 新序：user(a)@0, assistant@1, turn/end@2, 指令@3, user(b)@4
    expect(sliced.map((e) => e.type)).toEqual([
      'user/message',
      'assistant/message',
      'turn/end',
      'llm/retry',
      'user/message',
    ]);
    expect(sliced.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    // 遮蔽区间 [1,2] 平移 fromSeq=1 → [0,1]
    expect(sliced[3]!.surfaceOp).toEqual({ op: 'replace', start: 0, end: 1 });
    // 溯源 [1,2,3] 平移过滤 → [0,1,2]
    expect(sliced[3]!.sourceEventSeqs).toEqual([0, 1, 2]);
  });

  it('遮蔽区间整体落在切片前：指令事件整体丢弃（指令失去对象）', () => {
    // fromSeq=5：指令@4 的区间 [1,2] 全在前 → 只剩 user(b) 重编 @0
    const sliced = slicePrefix(occludedLog(), 5, 5);
    expect(sliced.length).toBe(1);
    expect(sliced[0]!.type).toBe('user/message');
    expect(sliced[0]!.seq).toBe(0);
  });

  it('遮蔽跨界：区间截断到切点（遮蔽者不越界遮到不存在的前史）', () => {
    // fromSeq=2：新序 = assistant@0, turn/end@1, 指令@2, user@3；
    // 指令区间 [1,2] → newStart=max(1-2,0)=0, newEnd=2-2=0 → [0,0]
    const sliced = slicePrefix(occludedLog(), 2, 5);
    expect(sliced[2]!.surfaceOp).toEqual({ op: 'replace', start: 0, end: 0 });
    // 溯源 [1,2,3] 平移 → [-1,0,1] 过滤负值 → [0,1]
    expect(sliced[2]!.sourceEventSeqs).toEqual([0, 1]);
  });

  it('toSeq 越界按日志长度收敛；无遮蔽事件原样重编', () => {
    const sliced = slicePrefix(occludedLog(), 0, 99);
    expect(sliced.length).toBe(6);
    expect(sliced[5]!.seq).toBe(5);
    expect(sliced[5]!.surfaceOp).toBeUndefined();
  });
});

describe('isSeededPrefix 种子前缀校验', () => {
  it('end-seed 形态：尾条 session/end-seed 且 seq 对齐', () => {
    const seed = [evt(0, 'turn/start'), evt(1, 'user/message', { content: 'x' }), evt(2, 'session/end-seed')];
    expect(isSeededPrefix(seed, 3, true)).toBe(true);
  });

  it('切片形态（无 end-seed 尾条）：seedLength 锚定校验通过', () => {
    const seed = [evt(0, 'user/message', { content: 'x' }), evt(1, 'turn/end', { reason: 'completed' })];
    expect(isSeededPrefix(seed, 2, false)).toBe(true);
  });

  it('长度不符拒绝', () => {
    const seed = [evt(0, 'turn/start')];
    expect(isSeededPrefix(seed, 2, false)).toBe(false);
  });

  it('尾条 seq 不对齐拒绝（裸拷贝不走正门）', () => {
    const seed = [evt(0, 'turn/start'), evt(5, 'session/end-seed')];
    expect(isSeededPrefix(seed, 2, true)).toBe(false);
  });

  it('要求 end-seed 而尾条不是：拒绝', () => {
    const seed = [evt(0, 'turn/start'), evt(1, 'turn/end', { reason: 'completed' })];
    expect(isSeededPrefix(seed, 2, true)).toBe(false);
  });

  it('空前缀：仅无尾界要求时合法（新建会话形态）', () => {
    expect(isSeededPrefix([], 0, false)).toBe(true);
    expect(isSeededPrefix([], 0, true)).toBe(false);
  });
});
