/**
 * 泛型 undo 栈直锁单测（UndoStack 纯数据面）：clone-on-push 深隔离 /
 * LIFO 弹出序 / 空栈与清空 / 上限丢最旧（含缺省帽 100 与帽 0 边界）。
 * 快照用纯数据形（嵌套对象 + 数组）——structuredClone 可克隆域。
 */
import { describe, expect, it } from 'vitest';
import { UndoStack } from './undo-stack.js';

describe('UndoStack 基本往返', () => {
  it('LIFO 弹出序 + 空弹 undefined + 长度随弹递减', () => {
    const s = new UndoStack<number>();
    s.push(1);
    s.push(2);
    s.push(3);
    expect(s.length).toBe(3);
    expect(s.pop()).toBe(3);
    expect(s.pop()).toBe(2);
    expect(s.pop()).toBe(1);
    expect(s.length).toBe(0);
    expect(s.pop()).toBeUndefined();
  });

  it('新建即空：长度 0、弹 undefined', () => {
    const s = new UndoStack<string>();
    expect(s.length).toBe(0);
    expect(s.pop()).toBeUndefined();
  });
});

describe('UndoStack clone-on-push 深隔离', () => {
  it('入栈后改原对象：弹出仍是入栈时刻快照', () => {
    const s = new UndoStack<{ a: { b: number } }>();
    const original = { a: { b: 1 } };
    s.push(original);
    original.a.b = 2; // 入栈后原地深改
    expect(s.pop()).toEqual({ a: { b: 1 } });
  });

  it('同对象两次入栈：两弹各自独立（时点快照互不串改）', () => {
    const s = new UndoStack<{ items: number[]; v: number }>();
    const state = { items: [1], v: 1 };
    s.push(state);
    state.v = 2;
    state.items.push(9);
    s.push(state);
    expect(s.pop()).toEqual({ items: [1, 9], v: 2 }); // 第二次入栈时刻
    expect(s.pop()).toEqual({ items: [1], v: 1 }); // 第一次入栈时刻
    // 弹出件再改也不影响栈内（已脱钩直付）——此处栈空仅证不抛
    expect(s.length).toBe(0);
  });

  it('弹出件与栈内其余快照互不共享引用', () => {
    const s = new UndoStack<{ nested: { deep: string[] } }>();
    const base = { nested: { deep: ['x'] } };
    s.push(base);
    s.push(base);
    const first = s.pop()!;
    first.nested.deep.push('mutated');
    expect(s.pop()).toEqual({ nested: { deep: ['x'] } });
  });
});

describe('UndoStack 清空', () => {
  it('clear 弃撤回域：长度归 0、弹 undefined', () => {
    const s = new UndoStack<number>();
    s.push(1);
    s.push(2);
    s.clear();
    expect(s.length).toBe(0);
    expect(s.pop()).toBeUndefined();
  });

  it('空栈 clear 不抛（幂等）', () => {
    const s = new UndoStack<number>();
    expect(() => s.clear()).not.toThrow();
    expect(s.length).toBe(0);
  });

  it('clear 后可重新服役', () => {
    const s = new UndoStack<number>();
    s.push(1);
    s.clear();
    s.push(7);
    expect(s.length).toBe(1);
    expect(s.pop()).toBe(7);
  });
});

describe('UndoStack 上限丢最旧', () => {
  it('超帽丢最旧：只留最近 limit 份（最近编辑永远可撤）', () => {
    const s = new UndoStack<number>(3);
    for (let i = 1; i <= 5; i++) s.push(i);
    expect(s.length).toBe(3);
    expect(s.pop()).toBe(5);
    expect(s.pop()).toBe(4);
    expect(s.pop()).toBe(3); // 1、2 已被挤出
    expect(s.pop()).toBeUndefined();
  });

  it('恰在帽上不丢', () => {
    const s = new UndoStack<number>(3);
    for (let i = 1; i <= 3; i++) s.push(i);
    expect(s.length).toBe(3);
    expect(s.pop()).toBe(3);
  });

  it('缺省帽 100：超量后首弹为最新一份', () => {
    const s = new UndoStack<number>();
    for (let i = 1; i <= 105; i++) s.push(i);
    expect(s.length).toBe(100);
    expect(s.pop()).toBe(105); // 最近编辑永远可撤
  });

  it('帽 1：每次入栈即顶替（恒留最新一份）', () => {
    const s = new UndoStack<number>(1);
    s.push(1);
    s.push(2);
    expect(s.length).toBe(1);
    expect(s.pop()).toBe(2);
  });

  it('帽 0：不保留任何快照', () => {
    const s = new UndoStack<number>(0);
    s.push(1);
    expect(s.length).toBe(0);
    expect(s.pop()).toBeUndefined();
  });
});
