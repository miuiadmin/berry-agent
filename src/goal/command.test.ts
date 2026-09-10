/**
 * /goal 命令面测试——wake/list/show 观察面渲染 + 守卫错折文本
 * （tick.test.ts 同 idiom：假 service 手搓行，纯函数直击）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { GOAL_USAGE, runGoalCommand } from './command.js';
import type { GoalService } from './service.js';
import type { GoalRow, GoalWakeRow, WakeDecision } from './types.js';

/** 行构造简写（缺省 active） */
function row(partial: Partial<GoalRow> & Pick<GoalRow, 'id'>): GoalRow {
  return {
    sessionId: 's1',
    objective: '跑通目标',
    status: 'active',
    activatedSeq: 0,
    schedule: 'every:10m',
    promptSnapshot: 'p',
    needsWrite: false,
    budgetMessagesCap: null,
    budgetMessagesUsed: 0,
    budgetFoldedUnits: 0,
    stallStreak: 0,
    wakeStreak: 0,
    lastFingerprint: null,
    createdAt: '2026-09-07T08:00:00.000Z',
    updatedAt: '2026-09-07T08:00:00.000Z',
    endedAt: null,
    endingNote: null,
    ...partial,
  };
}

/** 唤醒账行简写 */
function wake(partial: Partial<GoalWakeRow> & Pick<GoalWakeRow, 'goalId'>): GoalWakeRow {
  return {
    id: 1,
    wokeAt: '2026-09-07T09:00:00.000Z',
    trigger: 'clock',
    attribution: 'job',
    fingerprint: 'fp',
    progressed: false,
    ...partial,
  };
}

/** 假 service（手搓行 + 可编排 wake 结局） */
function fakeService(
  options: { rows?: GoalRow[]; wakes?: GoalWakeRow[]; wakeImpl?: (goalId: string) => WakeDecision } = {},
): GoalService {
  const rows = options.rows ?? [];
  const wakeRows = options.wakes ?? [];
  const byId = (goalId: string) => rows.find((r) => r.id === goalId)!;
  return {
    async activate() {
      throw new Error('测试不触');
    },
    async resume(goalId) {
      return byId(goalId);
    },
    async complete(goalId) {
      return byId(goalId);
    },
    async abandon(goalId) {
      return byId(goalId);
    },
    async wake(goalId) {
      if (options.wakeImpl !== undefined) return options.wakeImpl(goalId);
      return { landed: true, reason: 'ok', message: '手动唤醒已落地（停滞计数复位）', goal: byId(goalId) };
    },
    get: (goalId) => rows.find((r) => r.id === goalId),
    activeFor: (sessionId) => rows.find((r) => r.sessionId === sessionId && r.status === 'active'),
    list: () => rows,
    wakes: (goalId) => wakeRows.filter((w) => w.goalId === goalId),
    recordTurn() {
      throw new Error('测试不触');
    },
    depositFor() {
      throw new Error('测试不触');
    },
    foldDelegation() {
      throw new Error('测试不触');
    },
    budgetExceeded() {
      return false;
    },
    goalScopeFor(sessionId) {
      const active = rows.find((r) => r.sessionId === sessionId && r.status === 'active');
      return active === undefined ? undefined : { goalId: active.id, activatedSeq: active.activatedSeq };
    },
    async attachGoalJobsFace() {
      /* 测试不触 */
    },
    detachGoalJobsFace() {
      /* 测试不触 */
    },
  };
}

/** 字面事件构造（show 渲染 open 项喂料） */
function ev(type: string, data: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data };
}

const NO_EVENTS = () => [];

describe('/goal wake', () => {
  it('缺 goalId 折 usage；落地/未落地双形态渲染', async () => {
    const service = fakeService({ rows: [row({ id: 'g-1' })] });
    expect(await runGoalCommand(['wake'], { service, eventsFor: NO_EVENTS })).toBe(`缺 goalId。\n${GOAL_USAGE}`);
    const landed = await runGoalCommand(['wake', 'g-1'], { service, eventsFor: NO_EVENTS });
    expect(landed).toContain('已手动唤醒 goal「g-1」');
    const rejected = fakeService({
      rows: [row({ id: 'g-1' })],
      wakeImpl: () => ({
        landed: false,
        reason: 'stalled',
        message: '停滞硬停：连续 5 轮无进展',
        goal: row({ id: 'g-1' }),
      }),
    });
    const text = await runGoalCommand(['wake', 'g-1'], { service: rejected, eventsFor: NO_EVENTS });
    expect(text).toContain('唤醒未落地');
    expect(text).toContain('停滞硬停');
  });

  it('服务面守卫错折文本不抛（BaseError 码直呈）', async () => {
    const service = fakeService({
      wakeImpl: () => {
        throw new BaseError('GOAL_NOT_FOUND', 'goal「ghost」不存在（wake 幽灵 id 零行守卫）');
      },
    });
    expect(await runGoalCommand(['wake', 'ghost'], { service, eventsFor: NO_EVENTS })).toBe(
      'GOAL_NOT_FOUND：goal「ghost」不存在（wake 幽灵 id 零行守卫）',
    );
  });
});

describe('/goal list', () => {
  it('空集；行渲染状态/目标/挂钟/预算', async () => {
    expect(await runGoalCommand(['list'], { service: fakeService(), eventsFor: NO_EVENTS })).toBe('无 goal。');
    const service = fakeService({
      rows: [
        row({ id: 'g-1', stallStreak: 2 }),
        row({
          id: 'g-2',
          status: 'completed',
          budgetMessagesCap: 10,
          budgetMessagesUsed: 4,
          budgetFoldedUnits: 2,
          endingNote: 'ev',
        }),
      ],
    });
    const text = await runGoalCommand(['list'], { service, eventsFor: NO_EVENTS });
    expect(text).toContain('共 2 个 goal');
    expect(text).toContain('- g-1〔active〕跑通目标 —— 挂钟（停滞 2） · 无预算帽');
    expect(text).toContain('- g-2〔completed〕跑通目标 —— 已停摆 · 预算 6/10');
  });
});

describe('/goal show', () => {
  it('幽灵 id；active goal 全景（open 项 + 唤醒审计）', async () => {
    const service = fakeService({ rows: [row({ id: 'g-1', activatedSeq: 2 })] });
    expect(await runGoalCommand(['show', 'ghost'], { service, eventsFor: NO_EVENTS })).toBe('goal「ghost」不存在。');
    const events = [
      ev('user/message', {}),
      ev('user/message', {}),
      ev('todo/write', {
        items: [
          { status: 'pending', content: '待办甲' },
          { status: 'completed', content: '已完', noFollowUp: true },
        ],
      }),
    ];
    const text = await runGoalCommand(['show', 'g-1'], {
      service,
      eventsFor: () => events,
    });
    expect(text).toContain('goal「g-1」〔active〕');
    expect(text).toContain('目标：跑通目标');
    expect(text).toContain('激活锚 seq=2');
    expect(text).toContain('预算：前台 0 + 委派折叠 0（无帽）');
    expect(text).toContain('open 项：1（[pending] 待办甲）');
    expect(text).toContain('（无唤醒记录）');
    expect(text).not.toContain('终态回执');
  });

  it('终态 goal：终态回执行在场 + open 项不叠（scope 已退化）', async () => {
    const service = fakeService({
      rows: [row({ id: 'g-1', status: 'abandoned', endedAt: 't', endingNote: '不要了' })],
      wakes: [
        wake({ goalId: 'g-1', id: 1, progressed: true, attribution: 'job-1' }),
        wake({ goalId: 'g-1', id: 2, trigger: 'manual', attribution: '/goal wake', progressed: false }),
      ],
    });
    const text = await runGoalCommand(['show', 'g-1'], {
      service,
      eventsFor: () => [ev('todo/write', { items: [{ status: 'pending', content: '遗留' }] })],
    });
    expect(text).toContain('终态回执：不要了');
    expect(text).toContain('open 项：0'); // 终态行 goalScopeFor undefined——段外不渲染 open
    expect(text).toContain('clock 道 · 有进展 · 归因 job-1');
    expect(text).toContain('manual 道 · 无进展 · 归因 /goal wake');
  });
});

describe('usage 面', () => {
  it('无动词/help 折 usage；未知动词报错并附 usage', async () => {
    const service = fakeService();
    expect(await runGoalCommand([], { service, eventsFor: NO_EVENTS })).toBe(GOAL_USAGE);
    expect(await runGoalCommand(['help'], { service, eventsFor: NO_EVENTS })).toBe(GOAL_USAGE);
    const text = await runGoalCommand(['bogus'], { service, eventsFor: NO_EVENTS });
    expect(text).toContain('未知动词「bogus」');
    expect(text).toContain(GOAL_USAGE);
  });
});
