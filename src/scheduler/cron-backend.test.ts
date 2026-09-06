/**
 * cron 可选后端测试——scheduleToCron 映射纯函数 + OS 注册器读改写编舞
 * （execCrontab 假件零进程；平台/授权/写失败三亮拒；他人行保留）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createOsCronRegistrar, cronMarker, scheduleToCron, type CronBackendDeps } from './cron-backend.js';
import type { Schedule } from './schedule.js';
import type { JobRow } from './types.js';

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

/** 行构造助手（schedule 注入即可） */
function rowOf(schedule: Schedule, name = 'job-x'): JobRow {
  return {
    name,
    prompt: 'p',
    cwd: null,
    schedule,
    enabled: true,
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

describe('scheduleToCron 映射', () => {
  it('every：分钟/小时档全形', () => {
    expect(scheduleToCron({ kind: 'every', seconds: 60 })).toBe('* * * * *');
    expect(scheduleToCron({ kind: 'every', seconds: 300 })).toBe('*/5 * * * *');
    expect(scheduleToCron({ kind: 'every', seconds: 3600 })).toBe('0 * * * *');
    expect(scheduleToCron({ kind: 'every', seconds: 7200 })).toBe('0 */2 * * *');
  });

  it('every：sub-minute 与非 60 倍数拒（分钟粒度诚实）', () => {
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 5 }), 'SCHEDULER_CRON_UNSUPPORTED');
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 90 }), 'SCHEDULER_CRON_UNSUPPORTED');
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 5400 }), 'SCHEDULER_CRON_UNSUPPORTED');
  });

  it('daily：HH:MM → 分 时 * * *（域序换位）', () => {
    expect(scheduleToCron({ kind: 'daily', time: '09:30' })).toBe('30 9 * * *');
    expect(scheduleToCron({ kind: 'daily', time: '00:00' })).toBe('0 0 * * *');
  });

  it('weekly：day 编号直通（0=周日 Date.getDay 同系）', () => {
    expect(scheduleToCron({ kind: 'weekly', days: [1, 5], time: '09:30' })).toBe('30 9 * * 1,5');
    expect(scheduleToCron({ kind: 'weekly', days: [0], time: '23:59' })).toBe('59 23 * * 0');
  });

  it('once：单发拒（cron 表达不了——进程内挂钟独辖）', () => {
    expectCode(() => scheduleToCron({ kind: 'once', at: '2026-12-25T00:00:00.000Z' }), 'SCHEDULER_CRON_UNSUPPORTED');
  });
});

describe('OS 注册器编舞（execCrontab 假件）', () => {
  /** 假 crontab：可编程现有内容与失败点（execCrontab 方法 + writes 落值留痕） */
  function fakeCrontab(options: { initial?: string; readFail?: boolean; writeFail?: boolean }): {
    execCrontab: CronBackendDeps['execCrontab'];
    writes: string[];
  } {
    const writes: string[] = [];
    let current = options.initial ?? '';
    return {
      writes,
      execCrontab(args, input) {
        if (args[0] === '-l') {
          if (options.readFail) {
            return { stdout: '', stderr: 'crontab: 读炸了', code: 2 };
          }
          return { stdout: current, stderr: '', code: current === '' ? 1 : 0 };
        }
        // 写：失败编排或落值
        if (options.writeFail) {
          return { stdout: '', stderr: 'crontab: 写被拒', code: 1 };
        }
        current = input ?? '';
        writes.push(current);
        return { stdout: '', stderr: '', code: 0 };
      },
    };
  }

  /** 装配依赖（取假件的 execCrontab 方法引用——非假件对象本身） */
  function depsWith(
    fake: { execCrontab: CronBackendDeps['execCrontab'] },
    extra: Partial<CronBackendDeps> = {},
  ): CronBackendDeps {
    return { execCrontab: fake.execCrontab, authorize: () => true, command: '/usr/local/bin/berry-agent', ...extra };
  }

  it('register：他人行保留 + 自有条目挂尾（标记判据）', () => {
    const exec = fakeCrontab({ initial: '0 9 * * * echo morning\n' });
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.register(rowOf({ kind: 'daily', time: '09:30' }, 'daily-review'));
    expect(exec.writes).toHaveLength(1);
    expect(exec.writes[0]).toContain('0 9 * * * echo morning'); // 他人行保留
    expect(exec.writes[0]).toContain('30 9 * * * /usr/local/bin/berry-agent run --read-only --tick daily-review');
    expect(exec.writes[0]).toContain(cronMarker('daily-review'));
    expect(exec.writes[0]?.endsWith('\n')).toBe(true);
  });

  it('register：空 crontab 直挂单行；重复 register 同名替换不叠行', () => {
    const exec = fakeCrontab({});
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.register(rowOf({ kind: 'every', seconds: 300 }, 'poller'));
    reg.register(rowOf({ kind: 'every', seconds: 600 }, 'poller')); // 重挂改频
    expect(exec.writes).toHaveLength(2);
    expect(exec.writes[1]!.split('\n').filter((l) => l.includes(cronMarker('poller')))).toHaveLength(1);
    expect(exec.writes[1]).toContain('*/10 * * * *'); // 新频替换旧频
  });

  it('unregister：摘自有行留他人行；无条目 no-op 不写', () => {
    const exec = fakeCrontab({
      initial: `0 9 * * * echo morning\n*/5 * * * * berry-agent run --read-only --tick poller ${cronMarker('poller')}\n`,
    });
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.unregister('poller');
    expect(exec.writes).toHaveLength(1);
    expect(exec.writes[0]).toContain('echo morning');
    expect(exec.writes[0]).not.toContain(cronMarker('poller'));
    reg.unregister('not-there'); // 无条目
    expect(exec.writes).toHaveLength(1); // 未再写
  });

  it('win32 诚实拒（两动词同判）', () => {
    const exec = fakeCrontab({});
    const deps = depsWith(exec, { platform: 'win32' });
    const reg = createOsCronRegistrar(deps);
    expectCode(() => reg.register(rowOf({ kind: 'daily', time: '09:30' })), 'SCHEDULER_CRON_UNSUPPORTED');
    expectCode(() => reg.unregister('x'), 'SCHEDULER_CRON_UNSUPPORTED');
    expect(exec.writes).toHaveLength(0);
  });

  it('未授权亮拒（authorize 缺席 = 未授权不猜）；可表达性判先于授权', () => {
    const exec = fakeCrontab({});
    const reg = createOsCronRegistrar({ execCrontab: exec.execCrontab }); // authorize 缺席
    expectCode(() => reg.register(rowOf({ kind: 'daily', time: '09:30' })), 'SCHEDULER_CRON_UNAUTHORIZED');
    // once 形未授权也先报 UNSUPPORTED（形不行先知）
    expectCode(
      () => reg.register(rowOf({ kind: 'once', at: '2026-12-25T00:00:00.000Z' })),
      'SCHEDULER_CRON_UNSUPPORTED',
    );
    const regDenied = createOsCronRegistrar({ execCrontab: exec.execCrontab, authorize: () => false });
    expectCode(() => regDenied.register(rowOf({ kind: 'daily', time: '09:30' })), 'SCHEDULER_CRON_UNAUTHORIZED');
    expect(exec.writes).toHaveLength(0);
  });

  it('读失败与写失败亮拒 SCHEDULER_CRON_WRITE_FAILED', () => {
    const readFail = fakeCrontab({ readFail: true });
    const regRead = createOsCronRegistrar(depsWith(readFail));
    expectCode(() => regRead.register(rowOf({ kind: 'daily', time: '09:30' })), 'SCHEDULER_CRON_WRITE_FAILED');

    const writeFail = fakeCrontab({ writeFail: true });
    const regWrite = createOsCronRegistrar(depsWith(writeFail));
    expectCode(() => regWrite.register(rowOf({ kind: 'daily', time: '09:30' })), 'SCHEDULER_CRON_WRITE_FAILED');
  });

  it('crontab -l exit 1 空输出 = 无 crontab 常态（非错误）', () => {
    const exec = fakeCrontab({}); // initial 空 → read 返回 code 1 空 stdout
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.register(rowOf({ kind: 'daily', time: '09:30' }, 'first-ever'));
    expect(exec.writes).toHaveLength(1); // 未因 exit 1 炸
  });
});
