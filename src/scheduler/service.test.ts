/**
 * ScheduleService 测试——六动词守卫/行管理 + GoalJobsFace 四法 + cron 联动
 * 「不半态」（04 §12；真 better-sqlite3 临时目录库跑 v2 迁移）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from './migration.js';
import { createSchedulerService, type GoalJobsFace, type SchedulerService } from './service.js';
import type { CronRegistrar } from './cron-backend.js';
import type { JobRow } from './types.js';

let dir: string;
let store: Store | null = null;
/** 可拨时钟（ISO UTC） */
let nowIso: string;
const warn = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-scheduler-test-'));
  nowIso = '2026-09-07T08:00:00.000Z';
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开库+迁移+jobs 面装配助手 */
function openService(
  options: {
    pathExists?: (p: string) => boolean;
    cronRegistrar?: CronRegistrar | null;
  } = {},
): {
  service: SchedulerService;
  goalJobs: GoalJobsFace;
  getRow: (name: string) => JobRow | undefined;
} {
  store = openStore({
    dbPath: join(dir, 'test.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [SCHEDULER_MIGRATION],
  });
  const { service, dao, goalJobs } = createSchedulerService({
    db: store.sqlite(),
    now: () => nowIso,
    warn,
    pathExists: options.pathExists ?? (() => true),
    cronRegistrar: options.cronRegistrar ?? null,
  });
  return { service, goalJobs, getRow: (name) => dao.get(name) };
}

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

describe('add 守卫与缺省', () => {
  it('缺省建行停用、next 不排；--enable 形排刻', () => {
    const { service, getRow } = openService();
    const row = service.addJob({ name: 'daily-review', schedule: 'daily@09:30', prompt: '复盘' });
    expect(row.enabled).toBe(false);
    expect(row.builtin).toBe(false);
    expect(row.nextFireAt).toBeNull();
    expect(getRow('daily-review')?.enabled).toBe(false);

    const on = service.addJob({ name: 'every-job', schedule: 'every:10m', prompt: 'p', enabled: true });
    expect(on.enabled).toBe(true);
    expect(on.nextFireAt).toBe(new Date(Date.parse(nowIso) + 600_000).toISOString());
  });

  it('名词法/名冲突/prompt 帽/cwd 三守卫', () => {
    const { service } = openService();
    expectCode(() => service.addJob({ name: '_bad', schedule: 'daily@09:30', prompt: 'p' }), 'SCHEDULER_NAME_INVALID');
    expectCode(
      () => service.addJob({ name: 'a'.repeat(65), schedule: 'daily@09:30', prompt: 'p' }),
      'SCHEDULER_NAME_INVALID',
    );
    service.addJob({ name: 'dup', schedule: 'daily@09:30', prompt: 'p' });
    expectCode(() => service.addJob({ name: 'dup', schedule: 'daily@10:00', prompt: 'q' }), 'SCHEDULER_NAME_EXISTS');
    expectCode(() => service.addJob({ name: 'empty', schedule: 'daily@09:30', prompt: '' }), 'SCHEDULER_JOB_INVALID');
    expectCode(
      () => service.addJob({ name: 'huge', schedule: 'daily@09:30', prompt: 'x'.repeat(16 * 1024 + 1) }),
      'SCHEDULER_JOB_INVALID',
    );
    expectCode(
      () => service.addJob({ name: 'rel', schedule: 'daily@09:30', prompt: 'p', cwd: 'relative/path' }),
      'SCHEDULER_JOB_INVALID',
    );
  });

  it('cwd 建行时不存在拒（pathExists 注入假件）', () => {
    const { service } = openService({ pathExists: () => false });
    expectCode(
      () => service.addJob({ name: 'gone', schedule: 'daily@09:30', prompt: 'p', cwd: '/definitely/not/here' }),
      'SCHEDULER_JOB_INVALID',
    );
  });

  it('once 相对形建行即锚定（at 为绝对 ISO）', () => {
    const { service } = openService();
    const row = service.addJob({ name: 'once-job', schedule: 'once@+30s', prompt: 'p', enabled: true });
    expect(row.schedule).toEqual({ kind: 'once', at: '2026-09-07T08:00:30.000Z' });
    expect(row.nextFireAt).toBe('2026-09-07T08:00:30.000Z');
  });

  it('schedule 坏串建行拒（SCHEDULER_SCHEDULE_INVALID）', () => {
    const { service } = openService();
    expectCode(
      () => service.addJob({ name: 'bad', schedule: 'daily@9:30', prompt: 'p' }),
      'SCHEDULER_SCHEDULE_INVALID',
    );
  });
});

describe('enable/disable/rm 直打行', () => {
  it('幽灵名零行守卫三动词同拒', () => {
    const { service } = openService();
    expectCode(() => service.setJobEnabled('ghost', true), 'SCHEDULER_NOT_FOUND');
    expectCode(() => service.setJobEnabled('ghost', false), 'SCHEDULER_NOT_FOUND');
    expectCode(() => service.removeJob('ghost'), 'SCHEDULER_NOT_FOUND');
  });

  it('enable 排刻、disable 摘排行留史', () => {
    const { service, getRow } = openService();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p' });
    service.setJobEnabled('j', true);
    expect(getRow('j')?.enabled).toBe(true);
    expect(getRow('j')?.nextFireAt).not.toBeNull();
    service.setJobEnabled('j', false);
    expect(getRow('j')?.enabled).toBe(false);
    expect(getRow('j')?.nextFireAt).toBeNull();
    expect(getRow('j')).toBeDefined(); // 行留史
    service.setJobEnabled('j', true); // 复活重排
    expect(getRow('j')?.enabled).toBe(true);
  });

  it('rm 删行；list 名序全量 + describeSchedule 人读串', () => {
    const { service } = openService();
    service.addJob({ name: 'b', schedule: 'daily@09:30', prompt: 'p' });
    service.addJob({ name: 'a', schedule: 'every:1h', prompt: 'q' });
    expect(service.listJobs().map((r) => r.name)).toEqual(['a', 'b']);
    expect(service.describeSchedule('a')).toBe('every:1h');
    service.removeJob('a');
    expect(service.getJob('a')).toBeUndefined();
  });
});

describe('GoalJobsFace 四法（第五槽窄面）', () => {
  it('register：建 goal-<goalId> 行 builtin=1 启用即排刻', async () => {
    const { service, goalJobs, getRow } = openService();
    const r = await goalJobs.register({ goalId: 'g1', sessionId: 's1', schedule: 'daily@09:30', promptSnapshot: 'p' });
    expect(r.ok).toBe(true);
    const row = getRow('goal-g1');
    expect(row?.builtin).toBe(true);
    expect(row?.enabled).toBe(true);
    expect(service.getJob('goal-g1')?.builtin).toBe(true);
  });

  it('register：schedule 坏串 {ok:false,message} 引 SCHEDULE_ 码不炸装配', async () => {
    const { goalJobs, getRow } = openService();
    const r = await goalJobs.register({ goalId: 'g2', sessionId: 's1', schedule: 'nonsense', promptSnapshot: 'p' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('SCHEDULER_SCHEDULE_INVALID');
    expect(getRow('goal-g2')).toBeUndefined(); // 未建行
  });

  it('disable 行留史 enable 复活 remove 删行；无行静默 no-op', async () => {
    const { goalJobs, getRow } = openService();
    await goalJobs.register({ goalId: 'g3', sessionId: 's1', schedule: 'daily@09:30', promptSnapshot: 'p' });
    await goalJobs.disable('g3');
    expect(getRow('goal-g3')?.enabled).toBe(false); // 行留史
    await goalJobs.enable('g3');
    expect(getRow('goal-g3')?.enabled).toBe(true);
    await goalJobs.remove('g3');
    expect(getRow('goal-g3')).toBeUndefined();
    // 三动词幽灵 no-op 不抛
    await expect(goalJobs.disable('g3')).resolves.toBeUndefined();
    await expect(goalJobs.enable('g3')).resolves.toBeUndefined();
    await expect(goalJobs.remove('g3')).resolves.toBeUndefined();
  });
});

describe('cron 联动「不半态」', () => {
  /** 假 registrar——可编排失败 */
  function fakeRegistrar(failRegister = false): CronRegistrar & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      register(row) {
        calls.push(`register:${row.name}`);
        if (failRegister) throw new BaseError('SCHEDULER_CRON_WRITE_FAILED', '测试编排失败');
      },
      unregister(name) {
        calls.push(`unregister:${name}`);
      },
    };
  }

  it('enable→OS 注册先行；OS 失败行不翻转（不半态）', () => {
    const reg = fakeRegistrar(true);
    const { service, getRow } = openService({ cronRegistrar: reg });
    service.addJob({ name: 'cronjob', schedule: 'daily@09:30', prompt: 'p' });
    expectCode(() => service.setJobEnabled('cronjob', true), 'SCHEDULER_CRON_WRITE_FAILED');
    expect(getRow('cronjob')?.enabled).toBe(false); // 行未动
    expect(reg.calls).toEqual(['register:cronjob']);
  });

  it('disable→OS 注销先行；rm 启用行注销后删行', () => {
    const reg = fakeRegistrar();
    const { service, getRow } = openService({ cronRegistrar: reg });
    service.addJob({ name: 'cronjob', schedule: 'daily@09:30', prompt: 'p', enabled: true });
    service.setJobEnabled('cronjob', false);
    expect(reg.calls).toEqual(['unregister:cronjob']);
    service.setJobEnabled('cronjob', true);
    expect(reg.calls).toEqual(['unregister:cronjob', 'register:cronjob']);
    service.removeJob('cronjob');
    expect(reg.calls).toEqual(['unregister:cronjob', 'register:cronjob', 'unregister:cronjob']);
    expect(getRow('cronjob')).toBeUndefined();
  });

  it('rm 停用行不触 OS（无注册可注销）', () => {
    const reg = fakeRegistrar();
    const { service } = openService({ cronRegistrar: reg });
    service.addJob({ name: 'off', schedule: 'daily@09:30', prompt: 'p' });
    service.removeJob('off');
    expect(reg.calls).toEqual([]);
  });

  it('goalJobs.register 启用即挂 OS（乙案形态）', async () => {
    const reg = fakeRegistrar();
    const { goalJobs } = openService({ cronRegistrar: reg });
    const r = await goalJobs.register({ goalId: 'g9', sessionId: 's', schedule: 'daily@09:30', promptSnapshot: 'p' });
    expect(r.ok).toBe(true);
    expect(reg.calls).toEqual(['register:goal-g9']);
  });
});
