/**
 * kill-ring 单元测试（07 §4.1 R3 批 10j——环语义直锁：压头/回绕/帽淘汰/
 * 区间账自校验）。模型集成路（kill 原语入环 / yank / yankPop / undo 交互）
 * 归 editor-model.test.ts。
 */
import { describe, it, expect } from 'vitest';
import { KillRing, KILL_RING_LIMIT } from './kill-ring.js';

describe('KillRing 环语义', () => {
  it('push 压头、current 取环头、空段不入', () => {
    const ring = new KillRing();
    expect(ring.current()).toBeNull();
    ring.push('首条');
    ring.push('次条');
    expect(ring.size).toBe(2);
    expect(ring.current()).toBe('次条'); // 压头——最近 kill 在环头
    ring.push(''); // 空段不入
    expect(ring.size).toBe(2);
  });

  it('step 回绕：两条环 0→1→0 循环', () => {
    const ring = new KillRing();
    ring.push('a');
    ring.push('b'); // 环序 [b, a]
    expect(ring.step()).toBe('a'); // 游标 0→1
    expect(ring.step()).toBe('b'); // 1→0（回绕）
    expect(ring.current()).toBe('b');
  });

  it('push 归零游标（新 kill 后 yank 取新条目）', () => {
    const ring = new KillRing();
    ring.push('a');
    ring.push('b');
    ring.step(); // 游标 →1（a）
    ring.push('c'); // 新 kill 压头 + 游标归零
    expect(ring.current()).toBe('c');
  });

  it('环帽 32：第 33 条压入淘汰最旧', () => {
    const ring = new KillRing();
    for (let i = 0; i < KILL_RING_LIMIT + 1; i++) ring.push(`条${i}`);
    expect(ring.size).toBe(KILL_RING_LIMIT);
    expect(ring.current()).toBe(`条${KILL_RING_LIMIT}`); // 最新在环头
    // 最旧「条0」已淘汰——步进全环取不到
    let seen: (string | null)[] = [];
    for (let i = 0; i < KILL_RING_LIMIT; i++) seen.push(ring.step());
    expect(seen).not.toContain('条0');
    expect(seen).toContain('条1'); // 次旧仍在
  });

  it('step 空环返 null', () => {
    const ring = new KillRing();
    expect(ring.step()).toBeNull();
  });

  it('takeHead 恒取环头并归零游标（yank 取值面——pop 会话残留游标不复用）', () => {
    const ring = new KillRing();
    ring.push('旧条');
    ring.push('新条'); // 环序 [新条, 旧条]
    ring.step(); // 游标 →1（旧条）——pop 会话残留位
    expect(ring.takeHead()).toBe('新条'); // 恒环头 + 游标归零
    expect(ring.step()).toBe('旧条'); // 步进自环头起（0→1）——yank 后 pop 循环序一致
  });

  it('takeHead 空环返 null', () => {
    const ring = new KillRing();
    expect(ring.takeHead()).toBeNull();
  });
});

describe('KillRing yank 区间账', () => {
  it('spanIsValid：文本吻合 true / 区间被编辑 false / 行结构变化 false', () => {
    const ring = new KillRing();
    const lines = ['hello world'];
    ring.markYank({ line: 0, start: 6, end: 11, text: 'world' });
    expect(ring.spanIsValid(lines)).toBe(true);
    expect(ring.spanIsValid(['hello worlx'])).toBe(false); // 区间被编辑
    expect(ring.spanIsValid([])).toBe(false); // 行结构变化（行消失）
    expect(ring.activeSpan).toEqual({ line: 0, start: 6, end: 11, text: 'world' });
  });

  it('无在案区间账 spanIsValid 恒 false', () => {
    const ring = new KillRing();
    expect(ring.spanIsValid(['x'])).toBe(false);
  });
});
