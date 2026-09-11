/**
 * host/scheduler-tick 测试——u-2 G0 修复笔（04 §12 无人值守执行链定形注
 * ①②的码面兑现回归锁）。
 *
 * **修复前必红锁**（先写先跑红——「真 spawnFn 计数断言子进程零孵化 +
 * 占位串入模型断言」的 e2e 形态）：
 * - 用户 tick 行：fire 走进程内 headless run（faux provider streamFn 收行
 *   prompt——行内提示词经 submitText 入模型，非子进程 argv）；
 * - builtin 行（issue-poll）：fire 走程序化分派位（issue 件缺席 = 诚实
 *   gated 拒——绝不 spawn 子进程把占位串发往模型）。
 *
 * 修复前两锁必红：装配位 runner = createProcessRunnerFactory → spawn
 * 'berry-agent'（测试环境 PATH 缺席 → ENOENT）→ 行结局 reason 'spawn'
 * ≠ 断言的进程内/分派形态。
 *
 * 纪律：mock 只停在模型层（faux provider）；装载管线/引擎编舞/行管理全真。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { fauxProvider } from '../llm/index.js';
import type { JobRow, Schedule } from '../scheduler/index.js';

import { assembleHostStack } from './assembly.js';
import type { ConversationStack } from './conversation-stack.js';
import {
  createSchedulerTickRunner,
  type GoalParkFace,
  type GoalWakeFace,
  type IssuePollFace,
} from './scheduler-tick.js';
import type { SchedulerFace } from './core-plugins.js';

/* ---------------- 测试基建 ---------------- */

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 造临时目录（统一入清账） */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 零用量终态 assistant 消息（faux 响应脚本用） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/**
 * e2e 锁装配（faux provider + 缺省 BERRY_AGENT_BIN——PATH 名缺席使修复前
 * spawn 形可判别归 spawn 失败结局，零真进程）
 */
async function tickRig() {
  const faux = fauxProvider({ provider: 'faux-tick', models: [{ id: 'm1' }] });
  faux.setResponses([() => messageOf()]);
  const dataDir = tmpDir('tick-data-');
  const ws = tmpDir('tick-ws-');
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-tick/m1',
  });
  if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
  const sched = assembly.scope.tryGet<SchedulerFace>('scheduler');
  if (sched === undefined) throw new Error('scheduler 件未装载');
  return { assembly, sched, ws, shutdown: () => assembly.runtime.shutdown() };
}

/* ---------------- 修复前必红锁（04 §12 定形注①②） ---------------- */

describe('u-2 G0 回归锁：甲案进程内推进（04 §12 定形注①——修复前必红）', () => {
  it('用户 tick 行：fire 经 conversation-stack 起 headless run——行 prompt 入模型（streamFn 真收），非子进程', async () => {
    const rig = await tickRig();
    try {
      rig.sched.service.addJob({
        name: 'inproc-job',
        prompt: '到点巡检：检查依赖版本',
        cwd: rig.ws,
        schedule: 'every:30m',
        enabled: true,
      });
      const outcome = await rig.sched.engine.fireNow('inproc-job', 'clock');
      // 进程内推进：faux 模型真收行内提示词 → completed → exit_code 0
      //（修复前：spawn 'berry-agent' ENOENT → reason 'spawn' → 红）
      expect(outcome.reason).toBe('exit_code');
      expect(outcome.exitCode).toBe(0);
      // 占位锁补强：行 prompt 是经 submitText 入模型的真提示词——streamFn
      // 捕获面（faux provider 记录请求；此处经 outcome 绿面锁，负锁在
      // builtin 行测：占位串永不入模型）
    } finally {
      await rig.shutdown();
    }
  });

  it('用户 tick 行：faux streamFn 收到的末条 user 消息 = 行 prompt（进程内提交链证据）', async () => {
    const rig = await tickRig();
    try {
      rig.sched.service.addJob({
        name: 'inproc-prompt-job',
        prompt: '唯一标记：inproc-prompt-marker',
        cwd: rig.ws,
        schedule: 'every:30m',
        enabled: true,
      });
      await rig.sched.engine.fireNow('inproc-prompt-job', 'clock');
      // 进程内提交链证据：run 落的会话事件里 user/message 载行 prompt 标记
      //（修复前：spawn 形零会话事件 → 红）
      let found = false;
      for (const row of rig.assembly.stack.manager.list({})) {
        const log = rig.assembly.stack.driverOf(row.id)?.session;
        if (!log) continue;
        for (const ev of log.events()) {
          if (ev.type === 'user/message' && JSON.stringify(ev.data).includes('inproc-prompt-marker')) {
            found = true;
          }
        }
      }
      expect(found).toBe(true);
    } finally {
      await rig.shutdown();
    }
  });
});

describe('u-2 G0 回归锁：builtin 行程序化分派（04 §12 定形注②——修复前必红）', () => {
  it('issue-poll 行（issue 件缺席）：fire 走分派位诚实 gated 拒——零 spawn 零模型（占位串不进模型）', async () => {
    const rig = await tickRig();
    try {
      // 直接建 builtin 轮询行（issue 件未装配——config 缺席零装载）：分派位
      // 查处理器缺席 → 诚实 gated；修复前 spawn ENOENT → reason 'spawn' → 红
      rig.sched.service.addBuiltinJob({
        name: 'issue-poll',
        prompt: '(builtin) issue 轮询占位——挂钟行由 issue 件程序化分派（pollOnce），本 prompt 不发往任何模型',
        schedule: 'every:120s',
      });
      await rig.sched.service.setJobEnabled('issue-poll', true);
      const outcome = await rig.sched.engine.fireNow('issue-poll', 'clock');
      expect(outcome.reason).toBe('gated'); // 分派位在场 + 处理器缺席诚实拒
      expect(outcome.error).toContain('issue'); // 拒因载件缺席说明
      // 占位串不入模型（负锁）：全库会话事件零含占位串
      let leaked = false;
      for (const row of rig.assembly.stack.manager.list({})) {
        const log = rig.assembly.stack.driverOf(row.id)?.session;
        if (!log) continue;
        for (const ev of log.events()) {
          if (JSON.stringify(ev.data).includes('issue 轮询占位')) leaked = true;
        }
      }
      expect(leaked).toBe(false);
    } finally {
      await rig.shutdown();
    }
  });
});

/* ---------------- 单元组（假 stack 全编舞——04 §12 定形注①③④逐面锁） ---------------- */

/** 假会话事件（seq = 数组序——真源 driver 落账同构） */
interface FakeEvent {
  seq: number;
  type: string;
  data: unknown;
}

/**
 * 假 ConversationStack（tick runner 消费窄面投影）：manager.create/open、
 * driverOf(session.events/append)、submitText、interrupt、model。全记录可断言。
 */
function fakeStack() {
  const sessions = new Map<string, FakeEvent[]>();
  const submits: Array<{ sessionId: string; text: string; source?: string }> = [];
  const interrupts: string[] = [];
  const deferreds = new Map<string, Array<(result: unknown) => void>>();
  let n = 0;
  const stack = {
    model: 'faux-unit/m1',
    manager: {
      create(_opts: { workspaceRoot: string }) {
        const sessionId = `sess-${++n}`;
        sessions.set(sessionId, [{ seq: 0, type: 'session/created', data: {} }]);
        return { sessionId };
      },
      open(sessionId: string) {
        if (!sessions.has(sessionId)) throw new Error(`会话不存在：${sessionId}`);
        return { sessionId };
      },
    },
    driverOf(sessionId: string) {
      const events = sessions.get(sessionId);
      if (events === undefined) return undefined;
      return {
        session: {
          events: () => [...events],
          append: (type: string, data: unknown) => {
            events.push({ seq: events.length, type, data }); // 追加序 = 前长（会话内单调）
          },
        },
      };
    },
    submitText(sessionId: string, text: string, opts?: { source?: string }) {
      submits.push({ sessionId, text, source: opts?.source });
      if (!sessions.has(sessionId)) return undefined;
      return new Promise<unknown>((resolve) => {
        const queue = deferreds.get(sessionId) ?? [];
        queue.push(resolve);
        deferreds.set(sessionId, queue);
      });
    },
    interrupt(sessionId: string) {
      interrupts.push(sessionId);
    },
  } as unknown as ConversationStack;
  /** 落一条 assistant 消息事件（usage/text 自定）并 settle 最早未决 run */
  function settleAssistant(
    sessionId: string,
    result: unknown,
    content: { type: string; text?: string }[],
    usage?: unknown,
  ) {
    const events = sessions.get(sessionId);
    if (events === undefined) throw new Error(`会话不存在：${sessionId}`);
    events.push({ seq: events.length, type: 'assistant/message', data: { content, usage } });
    const queue = deferreds.get(sessionId);
    queue?.shift()?.(result);
  }
  return { stack, submits, interrupts, settleAssistant };
}

/** 造 JobRow（全字段——测试值） */
function jobRow(name: string, opts: { builtin?: boolean; prompt?: string } = {}): JobRow {
  return {
    name,
    prompt: opts.prompt ?? '行内提示词',
    cwd: null,
    schedule: { kind: 'every', seconds: 600 } as Schedule,
    enabled: true,
    builtin: opts.builtin ?? false,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    nextFireAt: '2026-09-11T00:10:00.000Z',
    lastFireAt: null,
    lastOutcome: null,
    activePid: null,
    activeStartedAt: null,
  };
}

/** 单元装配（假 stack + 可换分派处理器假件） */
function unitRig(opts: { goal?: GoalWakeFace; issue?: IssuePollFace; park?: GoalParkFace } = {}) {
  const fake = fakeStack();
  const warns: string[] = [];
  const runner = createSchedulerTickRunner({
    stack: fake.stack,
    resolveGoal: () => opts.goal,
    resolveIssuePoll: () => opts.issue,
    ...(opts.park !== undefined ? { resolveGoalPark: () => opts.park } : {}), // u-3 池检腿——缺席即不注入
    now: () => '2026-09-11T08:00:00.000Z',
    warn: (m) => warns.push(m),
  });
  const spawn = (row: JobRow, trigger: 'clock' | 'manual' | 'cron' = 'clock') =>
    runner.spawn({ row, trigger, wallTimeoutMs: 30 * 60_000 });
  return { fake, warns, spawn };
}

describe('scheduler-tick 单元：用户行全编舞（定形注①）', () => {
  it('completed：exit_code 0 + 末条 assistant 预览 + 后台道记账（callId tick:<sid>:<seq>）', async () => {
    const rig = unitRig();
    const handle = await rig.spawn(jobRow('u1'));
    expect(handle.pid).toBe(process.pid); // 甲案进程内形——宿主 pid 即占用面
    // 在飞未决——settled 不收口
    expect(rig.fake.submits).toEqual([{ sessionId: 'sess-1', text: '行内提示词', source: 'schedule' }]);
    rig.fake.settleAssistant('sess-1', { status: 'completed' }, [{ type: 'text', text: '巡检完毕' }], {
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 3,
      totalTokens: 20,
    });
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('exit_code');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.finalTextPreview).toBe('巡检完毕'); // 末条 assistant 文本预览
    // 后台道记账：新增 assistant 消息逐条落 llm/usage（priority background）
    const driver = rig.fake.stack.driverOf('sess-1');
    const events = driver?.session.events() ?? [];
    const usageEvent = events.find((e) => e.type === 'llm/usage');
    expect(usageEvent).toBeDefined();
    const ledger = usageEvent!.data as Record<string, unknown>;
    expect(ledger['callId']).toMatch(/^tick:sess-1:\d+$/); // deterministic 幂等身份
    expect(ledger['priority']).toBe('background');
    expect(ledger['model']).toBe('faux-unit/m1');
    expect(ledger['usage']).toMatchObject({ input: 10, output: 5 }); // 计量四桶入账
  });

  it('failed：exit_code 1 + error 摘要（errorMessage 截 200）', async () => {
    const rig = unitRig();
    const handle = await rig.spawn(jobRow('u2'));
    rig.fake.settleAssistant('sess-1', { status: 'failed', errorMessage: '模型面不可达' }, [
      { type: 'text', text: '半截' },
    ]);
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('exit_code');
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toContain('模型面不可达');
  });

  it('kill 折叠（定形注④甲案形）：kill=interrupt 协作中止 + reason 折中止形', async () => {
    const rig = unitRig();
    const handle = await rig.spawn(jobRow('u3'));
    handle.kill('timeout');
    expect(rig.fake.interrupts).toEqual(['sess-1']); // 协作中止（driver.abort）
    rig.fake.settleAssistant('sess-1', { status: 'aborted' }, [{ type: 'text', text: '中断' }]);
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('timeout'); // kill 已先行——reason 折 kill 形
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.error).toContain('墙钟超时');
  });

  it('goal 挂钟行：wake 不落 → gated 诚实零跑（零模型零提交）', async () => {
    const goal: GoalWakeFace = {
      wake: async () => ({
        landed: false,
        reason: 'wake_budget',
        message: '唤醒预算已尽',
        goal: { sessionId: 'sess-x' },
      }),
    };
    const rig = unitRig({ goal });
    const handle = await rig.spawn(jobRow('goal-g1', { builtin: true }));
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('gated');
    expect(outcome.error).toContain('wake_budget');
    expect(rig.fake.submits).toHaveLength(0); // 零提交
  });

  it('goal 挂钟行：wake 落地 → 幂等开 goal 会话 + promptSnapshot 提交（source=schedule）', async () => {
    const goal: GoalWakeFace = {
      wake: async () => ({ landed: true, reason: 'due', message: '到点', goal: { sessionId: 'sess-1' } }),
    };
    const rig = unitRig({ goal });
    // 预置 goal 会话在册（open 幂等开需在场——goal 绑定会话的 durable 形）
    rig.fake.stack.manager.create({ workspaceRoot: '/tmp/ws' });
    const handle = await rig.spawn(jobRow('goal-g2', { builtin: true, prompt: 'goal 快照提示词' }));
    expect(rig.fake.submits[0]).toMatchObject({ sessionId: 'sess-1', text: 'goal 快照提示词', source: 'schedule' });
    rig.fake.settleAssistant('sess-1', { status: 'completed' }, [{ type: 'text', text: 'goal 收口' }]);
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('exit_code');
    expect(outcome.exitCode).toBe(0);
  });

  it('goal 挂钟行 u-3 池检：wake 落地而日池尽 → park true → gated 预算停靠（零提交零开——04 §5 定形注③第二形态）', async () => {
    const goal: GoalWakeFace = {
      wake: async () => ({ landed: true, reason: 'due', message: '到点', goal: { sessionId: 'sess-1' } }),
    };
    const parked: string[] = [];
    const park: GoalParkFace = async (goalId) => {
      parked.push(goalId);
      return true; // 起跑前日池尽——停靠成立
    };
    const rig = unitRig({ goal, park });
    const handle = await rig.spawn(jobRow('goal-g3', { builtin: true, prompt: 'goal 快照提示词' }));
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('gated');
    expect(outcome.error).toContain('预算停靠'); // 停靠-唤醒形（非硬拒）
    expect(outcome.error).toContain('budget_extended');
    expect(parked).toEqual(['g3']); // 池检以 goalId 直调（tick 侧零预算知识）
    expect(rig.fake.submits).toHaveLength(0); // 零提交——不进模型
  });

  it('goal 挂钟行 u-3 池检对照：park false（日池可负担）→ 直接起跑；park 面缺席 → 池检腿跳过照常起跑（独立装配形零降级）', async () => {
    const goal: GoalWakeFace = {
      wake: async () => ({ landed: true, reason: 'due', message: '到点', goal: { sessionId: 'sess-1' } }),
    };
    // park false：日池可负担——正常起跑
    const afford = unitRig({ goal, park: async () => false });
    afford.fake.stack.manager.create({ workspaceRoot: '/tmp/ws' });
    const ok = await afford.spawn(jobRow('goal-g4', { builtin: true }));
    afford.fake.settleAssistant('sess-1', { status: 'completed' }, [{ type: 'text', text: '照常' }]);
    expect((await ok.settled).exitCode).toBe(0);
    // park 缺席：池检腿不注入——wake 落地直接起跑（既有例②形态的显式锁）
    const absent = unitRig({ goal });
    absent.fake.stack.manager.create({ workspaceRoot: '/tmp/ws' });
    const bare = await absent.spawn(jobRow('goal-g5', { builtin: true }));
    expect(absent.fake.submits[0]).toMatchObject({ sessionId: 'sess-1', source: 'schedule' });
    absent.fake.settleAssistant('sess-1', { status: 'completed' }, [{ type: 'text', text: '裸配' }]);
    expect((await bare.settled).exitCode).toBe(0);
  });

  it('issue-poll：pollOnce 摘要入 finalTextPreview（零模型——定形注②正位）', async () => {
    const issue: IssuePollFace = {
      pollOnce: async () => ({
        repos: ['a/b', 'c/d'],
        seen: 10,
        candidates: 4,
        enqueued: 2,
        duplicates: 1,
        rejected: 1,
      }),
    };
    const rig = unitRig({ issue });
    const handle = await rig.spawn(jobRow('issue-poll', { builtin: true }));
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('exit_code');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.finalTextPreview).toContain('入队 2'); // PollReport 摘要
    expect(rig.fake.submits).toHaveLength(0); // 零提交——占位串不进模型
  });

  it('issue-poll 处理器缺席 + memory-review 前瞻位 + 未知 builtin 名：三形全 gated 诚实拒', async () => {
    const rig = unitRig(); // 分派处理器全缺席
    const poll = await rig.spawn(jobRow('issue-poll', { builtin: true }));
    expect((await poll.settled).reason).toBe('gated');
    const review = await rig.spawn(jobRow('memory-review', { builtin: true }));
    expect((await review.settled).reason).toBe('gated');
    expect((await review.settled).error).toContain('前瞻');
    const ghost = await rig.spawn(jobRow('weird-row', { builtin: true }));
    expect((await ghost.settled).reason).toBe('gated');
    expect((await ghost.settled).error).toContain('未知 builtin');
    expect(rig.fake.submits).toHaveLength(0); // 三形零提交
  });
});
