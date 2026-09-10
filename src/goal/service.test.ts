/**
 * GoalService 测试——生命周期编舞（activate 守卫+回卷/resume 重锚+撞席/
 * complete 机器否决/wake 双帽+停滞硬停）+ 预算双轨 + 挂钟窄面迟到注入
 * （04 §12 / 03 §10.5；真 better-sqlite3 临时目录库跑 v3 迁移——
 * scheduler/service.test.ts 同 idiom）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { GOAL_MIGRATION } from './migration.js';
import { createGoalService, type GoalService } from './service.js';
import type { GoalJobsFace, GoalSessionFace, GoalSummarizerFace } from './types.js';

let dir: string;
let store: Store | null = null;
/** 可拨时钟（ISO UTC） */
let nowIso: string;
const warn = vi.fn();
/** goal id 固定序列（newId 注入——预知 id 编排 failFor） */
let idSeq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-goal-test-'));
  nowIso = '2026-09-07T08:00:00.000Z';
  idSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 假会话日志读面（内存事件数组——seq 按数组下标单源） */
class FakeSession implements GoalSessionFace {
  private readonly logs = new Map<string, SessionEvent[]>();
  events(sessionId: string): readonly SessionEvent[] {
    return this.logs.get(sessionId) ?? [];
  }
  length(sessionId: string): number {
    return (this.logs.get(sessionId) ?? []).length;
  }
  push(sessionId: string, type: string, data: unknown): void {
    const arr = this.logs.get(sessionId) ?? [];
    arr.push({ type, seq: arr.length, time: 0, data });
    this.logs.set(sessionId, arr);
  }
}

/** 开库+迁移+服务装配（face 不自动挂——迟到注入各例显式 attach） */
function openService(
  options: {
    stallLimit?: number;
    wakeBudgetLimit?: number;
    statMap?: Record<string, { exists: boolean; size: number }>;
    summarizer?: GoalSummarizerFace;
  } = {},
): { service: GoalService; session: FakeSession; face: GoalJobsFace; calls: string[]; registerFailFor: Set<string> } {
  store = openStore({
    dbPath: join(dir, 'test.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [GOAL_MIGRATION],
  });
  const session = new FakeSession();
  const calls: string[] = [];
  const registerFailFor = new Set<string>();
  const face: GoalJobsFace = {
    async register(req) {
      calls.push(`register:${req.goalId}`);
      return registerFailFor.has(req.goalId) ? { ok: false, message: '坏串' } : { ok: true, message: 'ok' };
    },
    async disable(goalId) {
      calls.push(`disable:${goalId}`);
    },
    async enable(goalId) {
      calls.push(`enable:${goalId}`);
    },
    async remove(goalId) {
      calls.push(`remove:${goalId}`);
    },
  };
  const service = createGoalService({
    db: store.sqlite(),
    now: () => nowIso,
    warn,
    session,
    newId: () => `g-${++idSeq}`,
    gates: {
      workspaceRoot: '/ws',
      statFile: (p) => options.statMap?.[p] ?? { exists: false, size: 0 },
    },
    ...(options.stallLimit !== undefined ? { stallLimit: options.stallLimit } : {}),
    ...(options.wakeBudgetLimit !== undefined ? { wakeBudgetLimit: options.wakeBudgetLimit } : {}),
    ...(options.summarizer !== undefined ? { summarizer: options.summarizer } : {}),
  });
  return { service, session, face, calls, registerFailFor };
}

/** 断言 async 抛指定码（返错误供 message 断言） */
async function expectCode(promise: Promise<unknown>, code: string): Promise<BaseError> {
  try {
    await promise;
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return err as BaseError;
  }
}

/** 断言同步抛指定码 */
function expectCodeSync(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

describe('activate（建行守卫 + 挂钟注册编舞）', () => {
  it('建行缺省面：prompt 由 objective 派生、needsWrite false、帽 null、锚=会话长度', async () => {
    const { service, session } = openService();
    session.push('s1', 'user/message', {});
    const goal = await service.activate({ sessionId: 's1', objective: '跑通测试', schedule: 'every:10m' });
    expect(goal).toMatchObject({ status: 'active', activatedSeq: 1, needsWrite: false, budgetMessagesCap: null });
    expect(goal.promptSnapshot).toBe('继续推进目标：跑通测试');
    expect(service.activeFor('s1')?.id).toBe(goal.id);
  });

  it('objective 空/超 16KiB 拒（GOAL_GOAL_INVALID）', async () => {
    const { service } = openService();
    await expectCode(service.activate({ sessionId: 's1', objective: '', schedule: 'x' }), 'GOAL_GOAL_INVALID');
    await expectCode(
      service.activate({ sessionId: 's1', objective: 'x'.repeat(16 * 1024 + 1), schedule: 'x' }),
      'GOAL_GOAL_INVALID',
    );
  });

  it('单 active 撞席拒；他会话不撞', async () => {
    const { service } = openService();
    await service.activate({ sessionId: 's1', objective: 'a', schedule: 'every:1h' });
    await expectCode(
      service.activate({ sessionId: 's1', objective: 'b', schedule: 'every:1h' }),
      'GOAL_TRANSITION_INVALID',
    );
    await expect(service.activate({ sessionId: 's2', objective: 'b', schedule: 'every:1h' })).resolves.toBeDefined();
  });

  it('注册失败回卷：goal 行与挂钟行同笔生死（不半态）', async () => {
    const { service, face, registerFailFor } = openService();
    registerFailFor.add('g-1');
    await service.attachGoalJobsFace(face);
    await expectCode(service.activate({ sessionId: 's1', objective: 'o', schedule: 'bad' }), 'GOAL_TRANSITION_INVALID');
    expect(service.list()).toEqual([]);
    registerFailFor.clear(); // 回卷后同会话可再建（id 续号不回收）
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'every:5m' });
    expect(goal.id).toBe('g-2');
  });
});

describe('挂钟窄面迟到注入（第五槽——先 goal 后 scheduler 装载序）', () => {
  it('缺席暂存不抛 → attach 冲洗补登记 → detach 后再暂存（双序对称）', async () => {
    const { service, face, calls } = openService();
    const first = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'every:5m' });
    expect(calls).toEqual([]); // face 缺席：需求暂存不抛
    await service.attachGoalJobsFace(face);
    expect(calls).toEqual([`register:${first.id}`]);
    const second = await service.activate({ sessionId: 's2', objective: 'p', schedule: 'every:5m' });
    expect(calls).toEqual([`register:${first.id}`, `register:${second.id}`]); // face 在场直注
    service.detachGoalJobsFace();
    const third = await service.activate({ sessionId: 's3', objective: 'q', schedule: 'every:5m' });
    expect(calls).toHaveLength(2); // 再暂存
    await service.attachGoalJobsFace(face);
    expect(calls).toHaveLength(3); // 冲洗
    expect(calls[2]).toBe(`register:${third.id}`);
  });

  it('冲洗失败 warn 亮拒不炸装配（goal 行留场）；终态行需求蒸发', async () => {
    const { service, face, calls, registerFailFor } = openService();
    const dead = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'bad' });
    await service.abandon(dead.id); // 暂存后终态——迟到需求蒸发
    const live = await service.activate({ sessionId: 's1', objective: 'p', schedule: 'bad2' });
    registerFailFor.add(live.id);
    await service.attachGoalJobsFace(face);
    expect(calls).toEqual([`register:${live.id}`]); // 只有 active 行被冲洗
    expect(warn).toHaveBeenCalled();
    expect(service.get(live.id)).toBeDefined(); // 行留场交用户处置
  });
});

describe('complete（完成否决律机器面）', () => {
  it('幽灵 id / 已终态 / evidence 空白三守卫', async () => {
    const { service, face } = openService();
    await service.attachGoalJobsFace(face);
    await expectCode(service.complete('ghost', 'ev'), 'GOAL_NOT_FOUND');
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    const err = await expectCode(service.complete(goal.id, '   '), 'GOAL_TRANSITION_INVALID');
    expect(err.message).toContain('evidence');
    await service.abandon(goal.id);
    await expectCode(service.complete(goal.id, 'ev'), 'GOAL_TRANSITION_INVALID');
  });

  it('open 项机器否决：响亮列 open 项（deferred 含内无论窗到否）', async () => {
    const { service, session } = openService();
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    session.push('s1', 'todo/write', {
      items: [
        { status: 'pending', content: '待办甲' },
        { status: 'completed', content: '已完', noFollowUp: true },
        { status: 'deferred', content: '缓办乙', resumeWhen: 'after@+1h' },
      ],
    });
    const err = await expectCode(service.complete(goal.id, 'ev'), 'GOAL_TRANSITION_INVALID');
    expect(err.message).toContain('2 个 open 项');
    expect(err.message).toContain('待办甲');
    expect(err.message).toContain('缓办乙');
  });

  it('判据门未全绿否决（files 门缺席——fail-closed）', async () => {
    const { service, session } = openService(); // statMap 空 → files 门恒 fail
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    session.push('s1', 'todo/write', {
      items: [
        { status: 'completed', content: '验收', noFollowUp: true, gate: { kind: 'files', paths: ['ghost.txt'] } },
      ],
    });
    const err = await expectCode(service.complete(goal.id, 'ev'), 'GOAL_TRANSITION_INVALID');
    expect(err.message).toContain('判据门未全绿');
    expect(err.message).toContain('files 门');
  });

  it('全绿路：落终态 + endingNote=evidence + 挂钟同笔停摆', async () => {
    const { service, session, face, calls } = openService({
      statMap: { '/ws/out.txt': { exists: true, size: 10 } },
    });
    await service.attachGoalJobsFace(face);
    const goal = await service.activate({ sessionId: 's1', objective: '写文档', schedule: 'every:10m' });
    session.push('s1', 'todo/write', {
      items: [
        { status: 'completed', content: '产出文档', noFollowUp: true, gate: { kind: 'files', paths: ['out.txt'] } },
      ],
    });
    const done = await service.complete(goal.id, 'docs/out.txt 已产出');
    expect(done).toMatchObject({ status: 'completed', endingNote: 'docs/out.txt 已产出' });
    expect(done.endedAt).toBe(nowIso);
    expect(calls).toContain(`disable:${goal.id}`);
    expect(service.activeFor('s1')).toBeUndefined();
  });
});

describe('wake（双帽 + 停滞硬停 + 归因落账）', () => {
  it('重绑护栏：终态 goal 唤醒不落地且不落账', async () => {
    const { service } = openService();
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    await service.abandon(goal.id, '不要了');
    const decision = await service.wake(goal.id, { trigger: 'clock', attribution: 'job' });
    expect(decision).toMatchObject({ landed: false, reason: 'inactive' });
    expect(service.wakes(goal.id)).toEqual([]);
  });

  it('clock 首唤 progressed（null 基线）；无进展轮计数落地；再进展双复位', async () => {
    const { service, session } = openService();
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    const first = await service.wake(goal.id, { trigger: 'clock', attribution: 'clock:每10分' });
    expect(first).toMatchObject({ landed: true, reason: 'ok' });
    expect(service.get(goal.id)?.lastFingerprint).not.toBeNull();
    const stalled = await service.wake(goal.id, { trigger: 'clock', attribution: 'clock:每10分' }); // 无进展
    expect(stalled.landed).toBe(true);
    expect(service.get(goal.id)).toMatchObject({ stallStreak: 1, wakeStreak: 1 });
    session.push('s1', 'todo/write', { items: [{ status: 'in-progress', content: '推进' }] }); // 计划态变了
    const recovered = await service.wake(goal.id, { trigger: 'clock', attribution: 'clock:每10分' });
    expect(recovered).toMatchObject({ landed: true, reason: 'ok' });
    expect(service.get(goal.id)).toMatchObject({ stallStreak: 0, wakeStreak: 0 });
    expect(service.wakes(goal.id).map((w) => w.progressed)).toEqual([true, false, true]); // 归因 durable 落账
  });

  it('停滞硬停：连续无进展达帽即停摆挂钟、行保持 active 留复位道、拒轮不落账', async () => {
    const { service, face, calls } = openService({ stallLimit: 2 });
    await service.attachGoalJobsFace(face);
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // 基线
    const counting = await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // stall 1
    expect(counting.landed).toBe(true);
    const halted = await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // stall 2 ≥ 帽
    expect(halted).toMatchObject({ landed: false, reason: 'stalled' });
    expect(service.get(goal.id)).toMatchObject({ status: 'active', stallStreak: 2 }); // active 留复位道
    expect(calls).toContain(`disable:${goal.id}`);
    expect(warn).toHaveBeenCalled();
    expect(service.wakes(goal.id)).toHaveLength(2); // 拒轮不落账
  });

  it('唤醒预算帽：连续无进展 clock 唤醒达帽即拒（落 warn 不硬停）', async () => {
    const { service } = openService({ wakeBudgetLimit: 2 });
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // 基线
    const second = await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // wake 1
    expect(second.landed).toBe(true);
    const rejected = await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // wake 2 ≥ 帽
    expect(rejected).toMatchObject({ landed: false, reason: 'wake_budget' });
    expect(service.get(goal.id)?.status).toBe('active'); // 不硬停——挂钟仍在
    expect(warn).toHaveBeenCalled();
  });

  it('manual 道：双帽不辖、双复位、挂钟复活、归因落 trigger=manual', async () => {
    const { service, face, calls } = openService({ stallLimit: 2, wakeBudgetLimit: 2 });
    await service.attachGoalJobsFace(face);
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // 基线
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // stall 1
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // stall 2 → 硬停
    const manual = await service.wake(goal.id, { trigger: 'manual', attribution: '/goal wake' });
    expect(manual).toMatchObject({ landed: true, reason: 'ok' });
    expect(service.get(goal.id)).toMatchObject({ stallStreak: 0, wakeStreak: 0 });
    expect(calls).toContain(`enable:${goal.id}`); // 挂钟复活
    const rows = service.wakes(goal.id);
    expect(rows.at(-1)).toMatchObject({ trigger: 'manual', attribution: '/goal wake' });
  });
});

describe('resume（重锚 + 易主守卫）', () => {
  it('幽灵/终态守卫；重锚 activatedSeq=当前会话长度 + 停滞计数复位', async () => {
    const { service, session } = openService();
    await expectCode(service.resume('ghost'), 'GOAL_NOT_FOUND');
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    expect(goal.activatedSeq).toBe(0);
    session.push('s1', 'user/message', {});
    session.push('s1', 'user/message', {});
    const resumed = await service.resume(goal.id);
    expect(resumed.activatedSeq).toBe(2);
    await service.complete(goal.id, 'ev');
    await expectCode(service.resume(goal.id), 'GOAL_TRANSITION_INVALID'); // 终态不复活
  });

  it('易主撞席拒（目标会话已有别的 active goal）；同席自 resume 放行', async () => {
    const { service } = openService();
    const a = await service.activate({ sessionId: 's1', objective: 'a', schedule: 'x' });
    await service.activate({ sessionId: 's2', objective: 'b', schedule: 'x' });
    await expectCode(service.resume(a.id, { sessionId: 's2' }), 'GOAL_TRANSITION_INVALID');
    const same = await service.resume(a.id, { sessionId: 's1' });
    expect(same.sessionId).toBe('s1');
  });
});

describe('预算双轨（recordTurn 刹停腿 + foldDelegation 折叠腿）', () => {
  it('两腿先到先刹：fold 后 budgetExceeded 复验面即真；幽灵守卫', async () => {
    const { service } = openService();
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x', budgetMessagesCap: 3 });
    expect(service.recordTurn(goal.id)).toEqual({ braked: false, used: 1, cap: 3 });
    expect(service.recordTurn(goal.id).used).toBe(2); // 未刹
    service.foldDelegation(goal.id, 2); // 折叠腿先到：2+2 ≥ 3
    expect(service.budgetExceeded(goal.id)).toBe(true);
    expect(service.recordTurn(goal.id).braked).toBe(true); // 刹停腿复验同判
    expectCodeSync(() => service.recordTurn('ghost'), 'GOAL_NOT_FOUND');
    expectCodeSync(() => service.foldDelegation('ghost', 1), 'GOAL_NOT_FOUND');
    expectCodeSync(() => service.budgetExceeded('ghost'), 'GOAL_NOT_FOUND');
  });

  it('userInitiated 轮复位 wakeStreak；无帽 goal 永不刹', async () => {
    const { service } = openService();
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // 基线
    await service.wake(goal.id, { trigger: 'clock', attribution: 'job' }); // wakeStreak 1
    expect(service.get(goal.id)?.wakeStreak).toBe(1);
    service.recordTurn(goal.id, { userInitiated: true });
    expect(service.get(goal.id)?.wakeStreak).toBe(0); // 用户在场才复位
    for (let i = 0; i < 10; i += 1) service.recordTurn(goal.id);
    expect(service.budgetExceeded(goal.id)).toBe(false); // cap null 永不刹
  });

  it('recordTurn messages 批量记账：窗扫计数整批入账（缺省 1 兼容单笔形——04 §176 记账单位）', async () => {
    const { service } = openService();
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x', budgetMessagesCap: 5 });
    expect(service.recordTurn(goal.id, { messages: 3 })).toEqual({ braked: false, used: 3, cap: 5 });
    expect(service.recordTurn(goal.id, { messages: 2 })).toEqual({ braked: true, used: 5, cap: 5 }); // 整批先到帽即刹
    expect(service.get(goal.id)?.budgetMessagesUsed).toBe(5); // durable 落行
  });
});

describe('depositFor（04 §3.7 轮间沉淀——指纹缓存单发 + 确定性回退）', () => {
  it('无 active goal = null 零注入；零 summarizer 走确定性回退形（objective + 计划态计数）', async () => {
    const { service, session } = openService();
    expect(service.depositFor('s1')).toBeNull(); // 无 active goal
    await service.activate({ sessionId: 's1', objective: '写周报', schedule: 'x' });
    session.push('s1', 'todo/write', {
      items: [
        { status: 'completed', content: 'A' },
        { status: 'pending', content: 'B' },
      ],
    });
    expect(service.depositFor('s1')).toBe('目标：写周报\n计划态：open 1 项 / completed 1 项');
  });

  it('summarizer 成功路：缓存冷先回退、单发落地后同指纹取缓存；in-flight 守卫 + 指纹不变零重烧', async () => {
    let resolveOnce: ((text: string) => void) | undefined;
    const calls: number[] = [];
    const { service, session } = openService({
      summarizer: {
        complete: (req) => {
          calls.push(req.prompt.length);
          return new Promise((resolve) => {
            resolveOnce = (text: string) => resolve({ text });
          });
        },
      },
    });
    await service.activate({ sessionId: 's1', objective: '写周报', schedule: 'x' });
    expect(service.depositFor('s1')).toContain('目标：写周报'); // 缓存冷——确定性回退立即承载（零等待）
    expect(service.depositFor('s1')).toContain('目标：写周报'); // in-flight 守卫——不重发
    expect(calls).toHaveLength(1);
    resolveOnce?.('摘要：周报已成');
    await new Promise((resolve) => void setTimeout(resolve, 0)); // 后台单发落地的微任务冲刷
    expect(service.depositFor('s1')).toBe('摘要：周报已成'); // 同指纹命中缓存
    expect(calls).toHaveLength(1); // 指纹不变零重烧
    session.push('s1', 'todo/write', { items: [{ status: 'pending', content: 'C' }] }); // 指纹变
    // 指纹变期语义：旧缓存文本先承载（旧摘要含历史脉络，优于裸计数回退）
    // + 后台再单发刷新（缓存冷才用确定性回退）
    expect(service.depositFor('s1')).toBe('摘要：周报已成');
    expect(calls).toHaveLength(2); // 指纹变即再单发
    resolveOnce?.('摘要：新计划');
    await new Promise((resolve) => void setTimeout(resolve, 0));
    expect(service.depositFor('s1')).toBe('摘要：新计划'); // 新单发落地缓存
  });

  it('summarizer 失败路：失败也缓存回退（同指纹不重烧——warn 落面）', async () => {
    let rejectOnce: ((err: Error) => void) | undefined;
    const calls: number[] = [];
    const { service } = openService({
      summarizer: {
        complete: () => {
          calls.push(1);
          return new Promise((_resolve, reject) => {
            rejectOnce = (err: Error) => reject(err);
          });
        },
      },
    });
    await service.activate({ sessionId: 's1', objective: '写周报', schedule: 'x' });
    expect(service.depositFor('s1')).toContain('计划态：open 0 项');
    rejectOnce?.(new Error('单发炸'));
    await new Promise((resolve) => void setTimeout(resolve, 0));
    expect(warn.mock.calls.flat().join('\n')).toContain('沉淀摘要单发失败');
    expect(service.depositFor('s1')).toContain('计划态：open 0 项'); // 失败缓存回退
    expect(calls).toHaveLength(1); // 同指纹不重烧
  });

  it('summarizer 成功但空产出：回落确定性文本入缓存（空串不占缓存承载——第二回落路径）', async () => {
    let resolveOnce: ((text: string) => void) | undefined;
    const calls: number[] = [];
    const { service } = openService({
      summarizer: {
        complete: (req) => {
          calls.push(req.prompt.length);
          return new Promise((resolve) => {
            resolveOnce = (text: string) => resolve({ text });
          });
        },
      },
    });
    await service.activate({ sessionId: 's1', objective: '写周报', schedule: 'x' });
    expect(service.depositFor('s1')).toContain('计划态：open 0 项'); // 缓存冷——回退立即承载
    // 成功但产出纯空白（trim 后空串）——失败回落之外的第二条回落路径：该
    // ternary 被误删后空产出直入缓存（depositFor 返空白、goal 注入面失效）
    // 而全套测试无红（2026-09-11 遗漏扫描批 test-gap-6 补锁）。
    resolveOnce?.('   ');
    await new Promise((resolve) => void setTimeout(resolve, 0));
    expect(service.depositFor('s1')).toBe('目标：写周报\n计划态：open 0 项 / completed 0 项'); // fallback 入缓存
    expect(service.depositFor('s1')).toBe('目标：写周报\n计划态：open 0 项 / completed 0 项'); // 命中缓存
    expect(calls).toHaveLength(1); // 缓存位由 fallback 占据而非空产出——同指纹零重烧
  });
});

describe('goalScopeFor（chat↔goal 数据通道窄面）', () => {
  it('active 供 {goalId, activatedSeq}；无 goal/终态后 undefined（fold 退化 run-scoped）', async () => {
    const { service, session } = openService();
    expect(service.goalScopeFor('s1')).toBeUndefined();
    session.push('s1', 'user/message', {});
    session.push('s1', 'user/message', {});
    const goal = await service.activate({ sessionId: 's1', objective: 'o', schedule: 'x' });
    expect(service.goalScopeFor('s1')).toEqual({ goalId: goal.id, activatedSeq: 2 });
    await service.complete(goal.id, 'ev');
    expect(service.goalScopeFor('s1')).toBeUndefined();
  });
});
