/**
 * /tick 处理器测试——六动词 argv → 人读文本（守卫折文本不抛；run 收场渲染）。
 * service/engine 均假件（行为面各有专测——本件只测动词分派与文本形态）。
 */
import { describe, expect, it, vi } from 'vitest';
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
