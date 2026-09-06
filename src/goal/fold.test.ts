/**
 * goal 段 fold 测试——计划态跨轮语义（边界升格/user 不重置/遮蔽同律）+
 * open 项判据 + 投影指纹 + resume_when 词法。字面 SessionEvent 数组直击
 * 纯函数面（conversation/todo.test.ts 同 idiom）。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { foldGoalTodos, openGoalItems, parseResumeWhen, progressFingerprint, validateGoalTodoItems } from './fold.js';
import type { GoalTodoItem } from './types.js';

/** 字面事件构造（occlude 携遮蔽指令——occludedSeqs 消费面） */
function ev(type: string, data: unknown, occlude?: { start: number; end: number }): SessionEvent {
  return {
    type,
    seq: 0,
    time: 0,
    data,
    ...(occlude !== undefined ? { surfaceOp: { op: 'replace', start: occlude.start, end: occlude.end } } : {}),
  };
}

/** goal 段条目简写 */
function gi(partial: Partial<GoalTodoItem> & Pick<GoalTodoItem, 'content'>): GoalTodoItem {
  return { status: 'pending', ...partial };
}

describe('foldGoalTodos（goal 生命周期段倒扫）', () => {
  it('锚后最后一条 todo/write 成表（last-write-wins）；锚前历史不成表', () => {
    const events = [
      ev('user/message', {}),
      ev('todo/write', { items: [{ status: 'pending', content: '锚前旧表' }] }),
      ev('user/message', {}), // seq 3 = 激活锚（此锚起新段）
      ev('todo/write', { items: [{ status: 'in-progress', content: '第一版' }] }),
      ev('todo/write', { items: [{ status: 'pending', content: '第二版' }] }),
    ];
    expect(foldGoalTodos(events, 3).map((i) => i.content)).toEqual(['第二版']);
    // 锚落在表之后但段内无表 → 空表（goal 段从未建表）
    expect(foldGoalTodos(events, 5)).toEqual([]);
  });

  it('续跑轮 user/message 不再重置表（跨轮存活——升格语义核心）', () => {
    const events = [
      ev('todo/write', { items: [{ status: 'pending', content: '段内表' }] }),
      ev('user/message', {}), // 用户出手——run-scoped 会重置，goal 段不重置
      ev('assistant/message', {}),
      ev('user/message', {}),
    ];
    expect(foldGoalTodos(events, 0).map((i) => i.content)).toEqual(['段内表']);
  });

  it('遮蔽的 todo/write 不成表（occluded 两向同律）；遮蔽前更早的表可透出', () => {
    const events = [
      ev('todo/write', { items: [{ status: 'pending', content: '旧表' }] }),
      ev('assistant/message', {}),
      ev('todo/write', { items: [{ status: 'pending', content: '被遮表' }] }),
      ev('assistant/message', {}, { start: 2, end: 2 }), // 遮蔽 seq2（指令由后续事件携带）
    ];
    expect(foldGoalTodos(events, 0).map((i) => i.content)).toEqual(['旧表']);
  });

  it('扩展字段载荷收窄：核心四字段健康即保留、扩展型别不符剔除该字段', () => {
    const items = validateGoalTodoItems([
      {
        status: 'completed',
        content: '带全扩展',
        resumeWhen: 'after@+5m',
        role: 'user',
        taskClass: 'fix',
        followUp: '回访',
        activeForm: '做',
      },
      { status: 'deferred', content: '坏 role 剔除', role: 42, resumeWhen: 'after@2026-12-01T00:00:00.000Z' },
      { status: 'bogus', content: '坏 status 弃整条' },
      { status: 'pending' }, // 缺 content 弃整条
      'not-object',
      { status: 'pending', content: '带 gate', gate: { kind: 'files', paths: ['a.ts'] } },
      { status: 'pending', content: '坏 gate 剔除', gate: { kind: 'command', command: 7 } },
    ]);
    expect(items.map((i) => i.content)).toEqual(['带全扩展', '坏 role 剔除', '带 gate', '坏 gate 剔除']);
    expect(items[0]).toMatchObject({ resumeWhen: 'after@+5m', role: 'user', taskClass: 'fix', followUp: '回访' });
    expect(items[1]!.role).toBeUndefined();
    expect(items[2]!.gate).toEqual({ kind: 'files', paths: ['a.ts'] });
    expect(items[3]!.gate).toBeUndefined();
  });

  it('非数组载荷 → 空表（保守降级不崩读侧）', () => {
    expect(foldGoalTodos([ev('todo/write', { items: 'oops' })], 0)).toEqual([]);
    expect(foldGoalTodos([ev('todo/write', {})], 0)).toEqual([]);
  });
});

describe('openGoalItems（完成否决判据）', () => {
  it('open = 一切非 completed 项——deferred 含内无论窗到否', () => {
    const items = [
      gi({ status: 'completed', content: '完', noFollowUp: true }),
      gi({ status: 'pending', content: '待' }),
      gi({ status: 'in-progress', content: '进' }),
      gi({ status: 'deferred', content: '缓', resumeWhen: 'after@2020-01-01T00:00:00.000Z' }), // 窗早已到
      gi({ status: 'deferred', content: '缓未到窗', resumeWhen: 'after@2099-01-01T00:00:00.000Z' }), // 窗未到
    ];
    expect(openGoalItems(items).map((i) => i.content)).toEqual(['待', '进', '缓', '缓未到窗']);
  });
});

describe('progressFingerprint（停滞判据面）', () => {
  it('状态翻转或内容改写即变；扩展字段改窗亦变', () => {
    const base = [gi({ content: '甲' }), gi({ status: 'completed', content: '乙', noFollowUp: true })];
    expect(progressFingerprint(base)).toBe(progressFingerprint([...base])); // 恒等
    expect(progressFingerprint(base)).not.toBe(
      progressFingerprint([gi({ status: 'in-progress', content: '甲' }), base[1]!]),
    );
    expect(progressFingerprint(base)).not.toBe(progressFingerprint([gi({ content: '甲（改写）' }), base[1]!]));
    expect(progressFingerprint([gi({ content: '甲' })])).not.toBe(
      progressFingerprint([gi({ content: '甲', resumeWhen: 'after@+1m' })]),
    );
  });

  it('空表与增删条目指纹不同（计数分桶入指纹）', () => {
    expect(progressFingerprint([])).not.toBe(progressFingerprint([gi({ content: '新条' })]));
  });
});

describe('parseResumeWhen（词法：可 parse 可判窗）', () => {
  const ANCHOR = Date.parse('2026-09-07T08:00:00.000Z');

  it('绝对 ISO 形：合法解析出 dueAt；非法串拒', () => {
    expect(parseResumeWhen('after@2026-12-01T09:30:00.000Z', ANCHOR)).toEqual({
      ok: true,
      dueAtMs: Date.parse('2026-12-01T09:30:00.000Z'),
    });
    const bad = parseResumeWhen('after@not-a-date', ANCHOR);
    expect(bad.ok).toBe(false);
  });

  it('相对形 +<n>[mhd]：锚 + n·单位；非法单位/零散形拒', () => {
    expect(parseResumeWhen('after@+5m', ANCHOR)).toEqual({ ok: true, dueAtMs: ANCHOR + 5 * 60_000 });
    expect(parseResumeWhen('after@+2h', ANCHOR)).toEqual({ ok: true, dueAtMs: ANCHOR + 2 * 3_600_000 });
    expect(parseResumeWhen('after@+3d', ANCHOR)).toEqual({ ok: true, dueAtMs: ANCHOR + 3 * 86_400_000 });
    expect(parseResumeWhen('after@+5s', ANCHOR).ok).toBe(false); // 秒单位不在词法
    expect(parseResumeWhen('after@+m', ANCHOR).ok).toBe(false);
    expect(parseResumeWhen('after@5m', ANCHOR).ok).toBe(false); // 缺 + 前缀
    expect(parseResumeWhen('+5m', ANCHOR).ok).toBe(false); // 缺 after@ 头
  });
});
