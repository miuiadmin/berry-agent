/**
 * /goal 命令面测试——wake/list/show 观察面渲染 + 守卫错折文本
 * （tick.test.ts 同 idiom：假 service 手搓行，纯函数直击）+ create 生产
 * 创建入口（U10——位参形/会话锚/用法错守卫面分工）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { GOAL_USAGE, runGoalCommand } from './command.js';
import type { ActivateGoalRequest, GoalService } from './service.js';
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
    writeApproved: false,
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

/** 假 service（手搓行 + 可编排 wake/approve/activate 结局） */
function fakeService(
  options: {
    rows?: GoalRow[];
    wakes?: GoalWakeRow[];
    wakeImpl?: (goalId: string) => WakeDecision;
    approveImpl?: (goalId: string) => GoalRow;
    activateImpl?: (req: ActivateGoalRequest) => GoalRow;
  } = {},
): GoalService {
  const rows = options.rows ?? [];
  const wakeRows = options.wakes ?? [];
  const byId = (goalId: string) => rows.find((r) => r.id === goalId)!;
  return {
    async activate(req) {
      if (options.activateImpl !== undefined) return options.activateImpl(req);
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
    async approve(goalId) {
      if (options.approveImpl !== undefined) return options.approveImpl(goalId);
      return byId(goalId);
    },
    commandGateStatus(goalId) {
      const r = rows.find((row) => row.id === goalId);
      if (r === undefined || !r.needsWrite) return { allowed: false, reason: 'not-declared' as const };
      if (!r.writeApproved) return { allowed: false, reason: 'not-approved' as const };
      return { allowed: true, reason: 'ok' as const };
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
    async parkForBudget() {
      throw new Error('测试不触');
    },
    isParkedForBudget() {
      return false;
    },
    unparkForBudget() {
      /* 测试不触 */
    },
    async reviveClock() {
      /* 测试不触 */
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
    expect(text).toContain('needsWrite：未申报（command 判据门不可用）');
    expect(text).toContain('open 项：1（[pending] 待办甲）');
    expect(text).toContain('（无唤醒记录）');
    expect(text).not.toContain('终态回执');
  });

  it('needsWrite 双位三态渲染（f-1——/goal show 呈现申报/批准位）', async () => {
    const declared = fakeService({ rows: [row({ id: 'g-1', needsWrite: true })] });
    const text1 = await runGoalCommand(['show', 'g-1'], { service: declared, eventsFor: NO_EVENTS });
    expect(text1).toContain('已申报·未批准（/goal approve 后可用）');
    const approved = fakeService({ rows: [row({ id: 'g-1', needsWrite: true, writeApproved: true })] });
    const text2 = await runGoalCommand(['show', 'g-1'], { service: approved, eventsFor: NO_EVENTS });
    expect(text2).toContain('已申报·已批准（command 判据门可用）');
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

describe('/goal approve', () => {
  it('f-1 人面批准动词：缺 id 折 usage；成功渲染解锁回执；守卫错折文本', async () => {
    const service = fakeService({ rows: [row({ id: 'g-1', needsWrite: true })] });
    expect(await runGoalCommand(['approve'], { service, eventsFor: NO_EVENTS })).toBe(`缺 goalId。\n${GOAL_USAGE}`);
    const text = await runGoalCommand(['approve', 'g-1'], { service, eventsFor: NO_EVENTS });
    expect(text).toContain('已批准 goal「g-1」的 needsWrite 申报');
    expect(text).toContain('command 判据门申报解锁');
    const refused = fakeService({
      rows: [row({ id: 'g-1', needsWrite: true })],
      approveImpl: () => {
        throw new BaseError('GOAL_TRANSITION_INVALID', 'goal「g-1」已终态（completed）——批准无对象');
      },
    });
    const refusedText = await runGoalCommand(['approve', 'g-1'], { service: refused, eventsFor: NO_EVENTS });
    expect(refusedText).toBe('GOAL_TRANSITION_INVALID：goal「g-1」已终态（completed）——批准无对象');
  });
});

describe('/goal create（U10 生产创建入口——03 §10.5 U10 落码定形注）', () => {
  it('位参形全链：objective join 复原全文 + 会话锚透传 + 通用回执「挂钟行已排」（未申报无帽零尾行）', async () => {
    const seen: ActivateGoalRequest[] = [];
    const service = fakeService({
      rows: [row({ id: 'g-9', objective: '写完发布文档', schedule: 'every:60s' })],
      activateImpl: (req) => {
        seen.push(req);
        return row({ id: 'g-9', objective: req.objective, schedule: req.schedule });
      },
    });
    // objective 含空格整体引号（argv 引号感知切分后 join 复原——/tick add prompt 同律）
    const text = await runGoalCommand(
      ['create', 'every:60s', '写完', '发布', '文档'],
      { service, eventsFor: NO_EVENTS },
      's1',
    );
    // 请求形：锚/全文 join/schedule 透传 + needsWrite·budgetMessagesCap 显式缺省形
    expect(seen).toEqual([
      {
        sessionId: 's1',
        objective: '写完 发布 文档',
        schedule: 'every:60s',
        needsWrite: false,
        budgetMessagesCap: null,
      },
    ]);
    expect(text).toContain('已建 goal「g-9」');
    expect(text).toContain('挂钟行已排'); // 通用文案——回执不探测装配态（定形注⑤）
    expect(text).not.toContain('/goal approve'); // 未申报零指路
    expect(text).not.toContain('预算帽');
  });

  it('--write 申报（申报非授权——approve 指路）与 --budget <n> 帽透传 + 回执呈现', async () => {
    const seen: ActivateGoalRequest[] = [];
    const service = fakeService({
      activateImpl: (req) => {
        seen.push(req);
        return row({
          id: 'g-9',
          objective: req.objective,
          schedule: req.schedule,
          needsWrite: req.needsWrite === true,
          budgetMessagesCap: req.budgetMessagesCap ?? null,
        });
      },
    });
    const text = await runGoalCommand(
      ['create', 'daily@09:00', '晨报', '--write', '--budget', '5'],
      { service, eventsFor: NO_EVENTS },
      's-2',
    );
    expect(seen[0]).toMatchObject({ sessionId: 's-2', needsWrite: true, budgetMessagesCap: 5 });
    expect(text).toContain('/goal approve g-9'); // f-1 文案同源指路
    expect(text).toContain('预算帽 5');
  });

  it('缺会话锚诚实拒（定形注③——CLI 面/防御位，不猜默认会话源）；activate 零调用', async () => {
    const seen: ActivateGoalRequest[] = [];
    const service = fakeService({
      activateImpl: (req) => {
        seen.push(req);
        return row({ id: 'g-9' });
      },
    });
    const text = await runGoalCommand(['create', 'every:60s', '目标'], { service, eventsFor: NO_EVENTS });
    expect(text).toContain('缺会话锚');
    expect(text).toContain(GOAL_USAGE);
    expect(seen).toHaveLength(0);
  });

  it('用法错族无码折 usage（守卫面分工——位参/空白/选项/值域全在命令层）；activate 零调用', async () => {
    const seen: ActivateGoalRequest[] = [];
    const service = fakeService({
      activateImpl: (req) => {
        seen.push(req);
        return row({ id: 'g-9' });
      },
    });
    const deps = { service, eventsFor: NO_EVENTS };
    const cases: [string[], RegExp][] = [
      [['create'], /create 须带两段位参/], // 全缺
      [['create', 'every:60s'], /create 须带两段位参/], // 缺 objective
      [['create', 'every:60s', ' ', ' '], /create 须带两段位参/], // objective 仅空白（service length 判不辖——命令层 trim 判）
      [['create', 'every:60s', '目标', '--bogus'], /未知选项「--bogus」/],
      [['create', 'every:60s', '目标', '--budget'], /--budget 须带正整数值/], // 缺值
      [['create', 'every:60s', '目标', '--budget', '0'], /--budget 须带正整数值/], // 0 = 建即死帽（used+folded>=cap 恒真）
      [['create', 'every:60s', '目标', '--budget', '-3'], /--budget 须带正整数值/],
      [['create', 'every:60s', '目标', '--budget', 'abc'], /--budget 须带正整数值/],
    ];
    for (const [argv, pattern] of cases) {
      const text = await runGoalCommand(argv, deps, 's1');
      expect(text, `argv=${JSON.stringify(argv)}`).toMatch(pattern);
      expect(text).toContain(GOAL_USAGE);
    }
    expect(seen).toHaveLength(0);
  });

  it('服务面守卫错折文本不抛：单 active 撞席/挂钟坏串回执（GOAL_TRANSITION_INVALID 码直呈）', async () => {
    const clash = fakeService({
      activateImpl: () => {
        throw new BaseError(
          'GOAL_TRANSITION_INVALID',
          '会话 s1 已有 active goal（单 active 守卫——先 complete/abandon 再建新）',
        );
      },
    });
    expect(await runGoalCommand(['create', 'every:60s', '目标'], { service: clash, eventsFor: NO_EVENTS }, 's1')).toBe(
      'GOAL_TRANSITION_INVALID：会话 s1 已有 active goal（单 active 守卫——先 complete/abandon 再建新）',
    );
    const badClock = fakeService({
      activateImpl: () => {
        throw new BaseError('GOAL_TRANSITION_INVALID', '挂钟注册失败（goal g-x）：schedule 词法不识');
      },
    });
    // schedule 透传律（定形注⑤——命令层零词法执法，坏串判据 = register 回执折码）
    expect(
      await runGoalCommand(['create', 'bogus@串', '目标'], { service: badClock, eventsFor: NO_EVENTS }, 's1'),
    ).toBe('GOAL_TRANSITION_INVALID：挂钟注册失败（goal g-x）：schedule 词法不识');
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
