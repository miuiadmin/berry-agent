/**
 * /tick 处理器测试——六动词 argv → 人读文本（守卫折文本不抛；run 收场渲染）。
 * service/engine 均假件（行为面各有专测——本件只测动词分派与文本形态）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { runTickCommand, TICK_USAGE, type TickCommandDeps } from './tick.js';
import type { SchedulerEngine } from './engine.js';
import type { SchedulerService } from './service.js';
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
    expect(out).toContain('任务 j 收场');
    expect(out).toContain('manual 道 exit_code');
    expect(out).toContain('退出码 3');
    expect(out).toContain('任务完成总结');
  });

  it('gated 结局呈现闸 id 与原因', async () => {
    const engine = fakeEngine({
      trigger: 'clock',
      reason: 'gated',
      gate: 'agent_busy',
      error: '宿主前台对话在飞',
      finishedAt: '2026-09-07T08:00:00.000Z',
    });
    const out = await runTickCommand(['run', 'j'], deps(fakeService(), engine));
    expect(out).toContain('clock 道 gated');
    expect(out).toContain('agent_busy');
    expect(out).toContain('宿主前台对话在飞');
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
