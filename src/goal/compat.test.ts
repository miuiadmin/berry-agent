/**
 * 结构兼容互证测试（04 §12 词面独立律 / 03 §10.5 计划态跨轮）——
 *  - goal 件自铸 GoalJobsFace ↔ scheduler 侧同名接口：type-level 双向互赋
 *    + 真 scheduler goalJobs 面接 goal 服务的运行时互操作（真库双迁移同笔）；
 *  - GoalTodoItem 前四字段 ↔ conversation TodoItemData：goal 段 fold
 *    （foldGoalTodos）与 conversation fold（foldTodoTable + scope）同语义。
 *
 * 本件是「词面独立、结构兼容」的执法锚——漂移即 typecheck/断言红。
 * （*.test.ts 拓扑豁免——goal↔scheduler/conversation 跨面互证唯一合法位。）
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { foldTodoTable, type TodoItemData, type TodoGoalScope } from '../conversation/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from '../scheduler/migration.js';
import { createSchedulerService, type GoalJobsFace as SchedulerGoalJobsFace } from '../scheduler/service.js';
import { foldGoalTodos } from './fold.js';
import { GOAL_MIGRATION } from './migration.js';
import { createGoalService, type GoalService } from './service.js';
import type { GoalJobsFace, GoalScope, GoalSessionFace, GoalTodoItem } from './types.js';

// ── type-level 互赋（编译期即验——结构漂移 typecheck 红） ────────────────────
// goal 件自铸 GoalJobsFace 可作 scheduler 侧同名接口用（组合根注入位）；
// 反向亦然——双向兼容无窄化。
const _schedulerAcceptsGoalFace: SchedulerGoalJobsFace = null as unknown as GoalJobsFace;
const _goalAcceptsSchedulerFace: GoalJobsFace = null as unknown as SchedulerGoalJobsFace;
void _schedulerAcceptsGoalFace;
void _goalAcceptsSchedulerFace;
// GoalTodoItem 前四字段与 conversation TodoItemData 同形（扩展字段可选腿不破兼容）
const _convAcceptsGoalItem: TodoItemData = null as unknown as GoalTodoItem;
void _convAcceptsGoalItem;
// GoalScope 与 TodoGoalScope 词面独立、结构兼容（组合根闭包注入零转换）
const _convScopeAcceptsGoalScope: TodoGoalScope = null as unknown as GoalScope;
const _goalScopeAcceptsConvScope: GoalScope = null as unknown as TodoGoalScope;
void _convScopeAcceptsGoalScope;
void _goalScopeAcceptsConvScope;

// ── 运行时互操作（真库双迁移 + 真 scheduler goalJobs 面 + 真 goal 服务） ──────

let dir: string;
let store: Store | null = null;
let nowIso: string;
const warn = vi.fn();
let idSeq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-goal-compat-'));
  nowIso = '2026-09-07T08:00:00.000Z';
  idSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 假会话日志（goal 服务激活锚/fold 面） */
class RamSession implements GoalSessionFace {
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

/** 双件真装配（v2+v3 双迁移同库——组合根形态互证） */
function openBoth() {
  store = openStore({
    dbPath: join(dir, 'test.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [SCHEDULER_MIGRATION, GOAL_MIGRATION],
  });
  const session = new RamSession();
  const {
    service: scheduler,
    dao,
    goalJobs,
  } = createSchedulerService({
    db: store.sqlite(),
    now: () => nowIso,
    warn,
    cronRegistrar: null, // 无 OS 后端形态——行管理面照常
  });
  const goal: GoalService = createGoalService({
    db: store.sqlite(),
    now: () => nowIso,
    warn,
    session,
    newId: () => `g-${++idSeq}`,
    gates: { workspaceRoot: '/ws' }, // exec/lsp 缺席 fail-closed（本件不触 gate 面）
  });
  return { scheduler, dao, goalJobs, goal, session };
}

describe('真 scheduler goalJobs ↔ goal 服务互操作', () => {
  it('activate 经真面落挂钟行（goal-<id> 名型/enabled/prompt 面）；complete 同笔停摆', async () => {
    const { dao, goalJobs, goal } = openBoth();
    await goal.attachGoalJobsFace(goalJobs);
    const created = await goal.activate({ sessionId: 's1', objective: '跑通验收', schedule: 'every:10m' });
    const job = dao.get(`goal-${created.id}`);
    expect(job).toMatchObject({ prompt: '继续推进目标：跑通验收', enabled: true, builtin: true });
    expect(job!.nextFireAt).not.toBeNull(); // 启用行即排刻
    await goal.complete(created.id, '全部项完成');
    expect(dao.get(`goal-${created.id}`)?.enabled).toBe(false); // 行留史、停摆
  });

  it('坏 schedule：真面响亮拒不炸 goal 侧（activate 回卷不半态）；resume 后 enable 复活', async () => {
    const { dao, goalJobs, goal } = openBoth();
    await goal.attachGoalJobsFace(goalJobs);
    const bad = goal.activate({ sessionId: 's1', objective: 'o', schedule: 'bogus-schedule' });
    await expect(bad).rejects.toThrowError(/挂钟注册失败/);
    expect(goal.list()).toEqual([]); // 回卷
    expect(dao.list().length).toBe(0); // jobs 表无半态行
    const created = await goal.activate({ sessionId: 's1', objective: 'o', schedule: 'every:30m' });
    await goal.complete(created.id, 'ev');
    expect(dao.get(`goal-${created.id}`)?.enabled).toBe(false);
    await goal.wake(created.id, { trigger: 'manual', attribution: '/goal wake' }); // 终态护栏——manual 亦不落地
    expect(dao.get(`goal-${created.id}`)?.enabled).toBe(false);
    const second = await goal.activate({ sessionId: 's1', objective: '再跑', schedule: 'every:5m' });
    await goal.wake(second.id, { trigger: 'manual', attribution: '/goal wake' });
    expect(dao.get(`goal-${second.id}`)?.enabled).toBe(true); // manual 复活透传真面
  });
});

// ── fold 语义互证（goal 段两 fold 同语义——03 §10.5 升格条） ─────────────────

/** 字面事件构造（occlude 携遮蔽指令） */
function ev(type: string, data: unknown, occlude?: { start: number; end: number }): SessionEvent {
  return {
    type,
    seq: 0,
    time: 0,
    data,
    ...(occlude !== undefined ? { surfaceOp: { op: 'replace', start: occlude.start, end: occlude.end } } : {}),
  };
}

/** 投影到核心三字段（两 fold 输出的公共比较面） */
function core(items: ReadonlyArray<Pick<GoalTodoItem, 'status' | 'content' | 'activeForm'>>) {
  return items.map((i) => ({
    status: i.status,
    content: i.content,
    ...(i.activeForm !== undefined ? { activeForm: i.activeForm } : {}),
  }));
}

describe('goal 段 fold 语义互证（foldGoalTodos ↔ foldTodoTable+scope）', () => {
  const cases: ReadonlyArray<{ name: string; events: SessionEvent[]; activatedSeq: number }> = [
    {
      name: '锚后建表 + 续跑轮 user 出手不重置（升格语义核心）',
      events: [
        ev('todo/write', { items: [{ status: 'pending', content: '锚前旧表' }] }),
        ev('user/message', {}), // seq 1 = 激活锚
        ev('todo/write', { items: [{ status: 'in-progress', content: '段内表', activeForm: '推进' }] }),
        ev('user/message', {}),
        ev('assistant/message', {}),
      ],
      activatedSeq: 1,
    },
    {
      name: '遮蔽的 todo/write 不成表（occluded 两向同律）+ 扩展字段被 conversation 剥离',
      events: [
        ev('user/message', {}),
        ev('todo/write', {
          items: [{ status: 'pending', content: '带扩展', resumeWhen: 'after@+5m', followUp: 'x' }],
        }),
        ev('assistant/message', {}, { start: 1, end: 1 }), // 遮蔽 seq1 的表
      ],
      activatedSeq: 0,
    },
    {
      name: '锚后无表 → 空表（段内从未建表）',
      events: [ev('user/message', {}), ev('todo/write', { items: [{ status: 'pending', content: '锚前' }] })],
      activatedSeq: 1,
    },
  ];

  it.for(cases)('同语义：%s', ({ events, activatedSeq }) => {
    const goalSide = core(foldGoalTodos(events, activatedSeq));
    const convSide = core(foldTodoTable(events, { goalId: 'g-1', activatedSeq }));
    expect(convSide).toEqual(goalSide);
  });

  it('非空防退化：主例确产出表', () => {
    const events = [
      ev('user/message', {}),
      ev('todo/write', { items: [{ status: 'in-progress', content: '段内表' }] }),
      ev('user/message', {}),
    ];
    expect(foldGoalTodos(events, 0)).toHaveLength(1);
    expect(foldTodoTable(events, { goalId: 'g-1', activatedSeq: 0 })).toHaveLength(1);
  });
});
