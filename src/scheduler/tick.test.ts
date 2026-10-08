/**
 * /tick 处理器测试——六动词 argv → 人读文本（守卫折文本不抛；run 收场渲染）。
 * service/engine 均假件（行为面各有专测——本件只测动词分派与文本形态）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from './migration.js';
import { runTickCommand, TICK_USAGE, type TickCommandDeps } from './tick.js';
import { createSchedulerService, type SchedulerService } from './service.js';
import type { SchedulerEngine } from './engine.js';
import type { JobRow, RunOutcome } from './types.js';

/** 服务假件：add 直通记录 + 按请求造行（enabled → 排刻形） */
function fakeService(rows: JobRow[] = []): SchedulerService & { added: unknown[] } {
  const added: unknown[] = [];
  const byName = new Map(rows.map((r) => [r.name, r]));
  return {
    added,
    addJob(req) {
      added.push(req);
      const row = makeRow(req.name);
      if (req.enabled) {
        row.enabled = true;
        row.nextFireAt = '2026-09-07T09:30:00.000Z';
      }
      return byName.get(req.name) ?? row;
    },
    // builtin 正门与 addJob 同核（/tick 面不触——占位满足接口形）
    addBuiltinJob(req) {
      added.push(req);
      return makeRow(req.name);
    },
    listJobs: () => rows,
    getJob: (name) => byName.get(name),
    removeJob: vi.fn(),
    setJobEnabled: vi.fn(),
    describeSchedule: () => 'every:10m',
  };
}

/** 引擎假件：fireNow 可编排结局 */
function fakeEngine(outcome?: RunOutcome): SchedulerEngine {
  return {
    start: () => {},
    stop: () => {},
    poke: () => {},
    sweep: () => {},
    fireNow: vi.fn(
      async () =>
        outcome ??
        ({
          trigger: 'manual',
          reason: 'exit_code',
          exitCode: 0,
          finishedAt: '2026-09-07T08:00:00.000Z',
        } as RunOutcome),
    ),
    inFlightCount: 0,
    running: false, // 观察面（start 置位/stop 摘除——/tick 面不消费，占位满足接口形）
  };
}

function makeRow(name: string): JobRow {
  return {
    name,
    prompt: 'p',
    cwd: null,
    schedule: { kind: 'every', seconds: 600 },
    enabled: false,
    builtin: false,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    nextFireAt: null,
    lastFireAt: null,
    lastOutcome: null,
    activePid: null,
    activeStartedAt: null,
  };
}

/** deps 装配 */
function deps(service: SchedulerService, engine: SchedulerEngine): TickCommandDeps {
  return { service, engine };
}

describe('动词分派与守卫折文本', () => {
  it('空参/help 返回用法；未知动词带用法', async () => {
    const d = deps(fakeService(), fakeEngine());
    expect(await runTickCommand([], d)).toBe(TICK_USAGE);
    expect(await runTickCommand(['help'], d)).toBe(TICK_USAGE);
    const bad = await runTickCommand(['dance'], d);
    expect(bad).toContain('未知动词');
    expect(bad).toContain(TICK_USAGE);
  });

  it('add：位参透传 service + 缺省停用文案；--enable/--cwd 选项解析', async () => {
    const svc = fakeService();
    const out = await runTickCommand(['add', 'j', 'every:10m', '干', '活'], deps(svc, fakeEngine()));
    expect(out).toContain('已建任务 j');
    expect(out).toContain('停用态');
    expect(svc.added).toEqual([{ name: 'j', schedule: 'every:10m', prompt: '干 活', cwd: null, enabled: false }]);
  });

  it('add --enable 排刻文案；--cwd 透传', async () => {
    const svc = fakeService();
    const out = await runTickCommand(
      ['add', 'k', 'daily@09:30', 'p', '--cwd', '/tmp', '--enable'],
      deps(svc, fakeEngine()),
    );
    expect(out).toContain('下次到点'); // 启用即排刻
    expect(svc.added).toEqual([{ name: 'k', schedule: 'daily@09:30', prompt: 'p', cwd: '/tmp', enabled: true }]);
  });

  it('add 守卫错折 SCHEDULER_ 文本（不抛）', async () => {
    const svc = fakeService();
    svc.addJob = () => {
      throw new BaseError('SCHEDULER_SCHEDULE_INVALID', 'schedule 串「nonsense」坏形');
    };
    const out = await runTickCommand(['add', 'x', 'nonsense', 'p'], deps(svc, fakeEngine()));
    expect(out).toContain('SCHEDULER_SCHEDULE_INVALID');
  });

  it('list：空表/有行两态；内置标记呈现', async () => {
    const empty = await runTickCommand(['list'], deps(fakeService(), fakeEngine()));
    expect(empty).toContain('无任务');
    const row = { ...makeRow('daily-review'), enabled: true, builtin: true };
    const out = await runTickCommand(['list'], deps(fakeService([row]), fakeEngine()));
    expect(out).toContain('daily-review');
    expect(out).toContain('内置');
    expect(out).toContain('启用');
  });

  it('rm/enable/disable 透传 + 幽灵守卫折文本', async () => {
    const svc = fakeService();
    const d = deps(svc, fakeEngine());
    expect(await runTickCommand(['rm', 'j'], d)).toContain('已删除任务 j');
    expect(await runTickCommand(['enable', 'j'], d)).toContain('已启用');
    expect(await runTickCommand(['disable', 'j'], d)).toContain('停用');
    svc.removeJob = () => {
      throw new BaseError('SCHEDULER_NOT_FOUND', '任务「ghost」不存在');
    };
    const out = await runTickCommand(['rm', 'ghost'], d);
    expect(out).toContain('SCHEDULER_NOT_FOUND');
  });

  it('动词名缺席折用法错文本', async () => {
    const out = await runTickCommand(['rm'], deps(fakeService(), fakeEngine()));
    expect(out).toContain('SCHEDULER_JOB_INVALID');
  });

  it('未知选项拒', async () => {
    const out = await runTickCommand(['add', 'j', 'every:10m', 'p', '--bogus'], deps(fakeService(), fakeEngine()));
    expect(out).toContain('未知选项');
  });
});

describe('run 收场渲染', () => {
  it('manual 收场人读行（trigger/reason/退出码/末文）', async () => {
    const engine = fakeEngine({
      trigger: 'manual',
      reason: 'exit_code',
      exitCode: 3,
      finishedAt: '2026-09-07T08:00:00.000Z',
      finalTextPreview: '任务完成总结',
    });
    const out = await runTickCommand(['run', 'j'], deps(fakeService(), engine));
    expect(out).toContain('任务 j 结束');
    expect(out).toContain('manual 道 exit_code');
    expect(out).toContain('退出码 3');
    expect(out).toContain('任务完成总结');
  });

  it('gated 结局呈现闸 id 与原因', async () => {
    const engine = fakeEngine({
      trigger: 'clock',
      reason: 'gated',
      gate: 'agent_busy',
      error: '宿主前台对话运行中',
      finishedAt: '2026-09-07T08:00:00.000Z',
    });
    const out = await runTickCommand(['run', 'j'], deps(fakeService(), engine));
    expect(out).toContain('clock 道 gated');
    expect(out).toContain('agent_busy');
    expect(out).toContain('宿主前台对话运行中');
  });
});

/**
 * 下次到点呈现（十六役补扫 N29——本地时刻渲染）。TZ seam 与 schedule.test
 * 同机制（自证锚先行防假绿）：存储 ISO UTC 而排刻语义本地——原始 UTC 串
 * 直出令「9 点任务显示 1 点」，锁本地渲染 + 原始串不直出。
 */
describe('下次到点呈现（TZ seam——America/New_York）', () => {
  /** 进 describe 前的 TZ 原值（精确还原——原值缺席则删除键） */
  const prevTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });

  afterEach(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('自证锚：TZ seam 生效（EDT=UTC-4）', () => {
    expect(new Date('2026-07-01T04:00:00Z').getHours()).toBe(0);
  });

  it('list：下次列渲染本地时刻非原始 UTC ISO（修前红——9 点任务不再显示 1 点）', async () => {
    const row = { ...makeRow('daily-review'), enabled: true, nextFireAt: '2026-09-30T01:00:00.000Z' };
    const out = await runTickCommand(['list'], deps(fakeService([row]), fakeEngine()));
    // UTC 01:00 = EDT 前日 21:00——本地语义（daily@09:00 族）与呈现口径一致
    expect(out).toContain('下次 2026-09-29 21:00（本地）');
    expect(out).not.toContain('2026-09-30T01:00:00.000Z'); // 原始 UTC 串不再直出
  });

  it('add --enable 回执：下次到点本地渲染（修前红）', async () => {
    const svc = fakeService(); // 假件排刻 2026-09-07T09:30:00.000Z
    const out = await runTickCommand(['add', 'k', 'daily@09:30', 'p', '--enable'], deps(svc, fakeEngine()));
    expect(out).toContain('下次到点 2026-09-07 05:30（本地）'); // EDT=UTC-4
    expect(out).not.toContain('09:30:00.000Z');
  });

  it('停用态/无排刻文案不受渲染影响', async () => {
    const out = await runTickCommand(['list'], deps(fakeService([makeRow('off')]), fakeEngine()));
    expect(out).toContain('下次 —');
    const added = await runTickCommand(['add', 'j', 'every:10m', 'p'], deps(fakeService(), fakeEngine()));
    expect(added).toContain('停用态');
  });
});

/**
 * rm 内置 goal 挂钟行守卫（第七轮 H2——真 service 面：守卫落 service
 * removeJob 单点，/tick 面锁折文本与指路文案）。修前红：rm 直入 removeJob
 * 删成功零拒绝——删后 goal 行仍 active 而 GoalJobsFace.enable 对无行静默
 * no-op，resume/wake/预算广播三消费位全瘫且结构性不可恢复（prompt 快照
 * 只此一份）。
 */
describe('rm 内置 goal 挂钟行守卫（真 service——H2）', () => {
  let dir: string;
  let store: Store | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'berry-agent-tick-rm-test-'));
  });

  afterEach(() => {
    store?.close();
    store = null;
    rmSync(dir, { recursive: true, force: true });
  });

  /** 真 service 装配（service.test 同形——临时目录库跑 scheduler 迁移） */
  function openService(): { service: SchedulerService; getRow: (name: string) => JobRow | undefined } {
    store = openStore({
      dbPath: join(dir, 'test.db'),
      dataDir: join(dir, 'data'),
      secretKey: ephemeralSecretKey(),
      migrations: [SCHEDULER_MIGRATION],
    });
    const { service, dao } = createSchedulerService({
      db: store.sqlite(),
      now: () => '2026-09-07T08:00:00.000Z',
      warn: () => undefined,
      pathExists: () => true,
    });
    return { service, getRow: (name) => dao.get(name) };
  }

  it('builtin goal 行 removeJob 拒删 SCHEDULER_JOB_INVALID + 行不删（修前红：删成功零拒绝）', () => {
    const { service, getRow } = openService();
    service.addBuiltinJob({ name: 'goal-g1', schedule: 'every:10m', prompt: '挂钟快照', enabled: true });
    try {
      service.removeJob('goal-g1');
      expect.unreachable('应抛 SCHEDULER_JOB_INVALID（内置 goal 挂钟行拒删）');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('SCHEDULER_JOB_INVALID');
    }
    // 行不删——/tick rm 对 goal 挂钟行恒不受理（摘钟走 GoalJobsFace.remove
    // 单漏斗非本门）；终态分工（03 §10.5 第十一轮收官呈拍批定形②）：
    // complete = disable 行留史（「行即账」审计面）/ abandon = remove 摘钟
    // 删行（消费位 = goal/service.ts abandon 腿——remove 悬空设计位转活）。
    // /goal abandon 用户动词已开面（双通道并存——模型工具 goal update 同漏斗）
    expect(getRow('goal-g1')).toBeDefined();
  });

  it('/tick rm builtin goal 行折指路文本 + 行仍在 + enable 仍可复活（可恢复性锁）', async () => {
    const { service, getRow } = openService();
    service.addBuiltinJob({ name: 'goal-g2', schedule: 'every:10m', prompt: 'p', enabled: true });
    service.setJobEnabled('goal-g2', false); // 终态停摆形（行留史——resume 复活前常态）
    const out = await runTickCommand(['rm', 'goal-g2'], deps(service, fakeEngine()));
    // BaseError 折文本（命令道不抛）。指路文案翻档（03 §10.5 第十一轮收官
    // 呈拍批定形①③——/goal abandon 用户动词开面）：旧锚「在目标会话中让
    // 模型放弃该目标」废止，新锚指 /goal abandon 用户正道；分工句翻档 =
    // complete 停用保留 / abandon 移除摘钟（变更证据形——勿断言整句）
    expect(out).toContain('SCHEDULER_JOB_INVALID');
    expect(out).toContain('/goal abandon');
    expect(out).toContain('自动移除'); // abandon = 摘钟删行（旧「放弃…保留记录」半句成事实错误）
    expect(out).not.toContain('在目标会话中让模型放弃');
    expect(out).not.toContain('停止或删除该目标');
    expect(getRow('goal-g2')).toBeDefined(); // rm 不受理——行不删
    // 修前损害形锁 absent：删行后 enable 对无行静默 no-op 全瘫；治本后照常复活
    service.setJobEnabled('goal-g2', true);
    expect(getRow('goal-g2')?.enabled).toBe(true);
  });

  it('守卫面精准（builtin 位 × goal- 前缀两判）：同名非 builtin 用户行可删、issue-poll builtin 行可删（issue stop() 正门）', () => {
    const { service, getRow } = openService();
    // 用户行恰名 goal-mine（NAME_RE 合法）——非 builtin 不在守卫面
    service.addJob({ name: 'goal-mine', schedule: 'every:10m', prompt: 'p' });
    service.removeJob('goal-mine');
    expect(getRow('goal-mine')).toBeUndefined();
    // issue-poll builtin 行：issue 件 stop() 经 service.removeJob 正门摘行、
    // start() 幂等重挂可恢复——不落 goal 守卫面（不可恢复性是 goal 独有）
    service.addBuiltinJob({ name: 'issue-poll', schedule: 'every:120s', prompt: '(builtin) 占位', enabled: true });
    service.removeJob('issue-poll');
    expect(getRow('issue-poll')).toBeUndefined();
  });
});
