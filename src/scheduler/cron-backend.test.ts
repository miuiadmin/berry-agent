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

  it('every：整除形照放（60%n / 24%h 整除——步进节奏等价「每 n 单位」）', () => {
    expect(scheduleToCron({ kind: 'every', seconds: 900 })).toBe('*/15 * * * *'); // 15m
    expect(scheduleToCron({ kind: 'every', seconds: 1200 })).toBe('*/20 * * * *'); // 20m
    expect(scheduleToCron({ kind: 'every', seconds: 43200 })).toBe('0 */12 * * *'); // 12h
    expect(scheduleToCron({ kind: 'every', seconds: 28800 })).toBe('0 */8 * * *'); // 8h（16→0 亦 8h）
  });

  it('every：非整除步进形拒（修前红——*/n 域内重置产生错误节奏）', () => {
    // every:45m→*/45 每小时 :00+:45 双发（日均 48 次 vs 配置语义 32 次）
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 2700 }), 'SCHEDULER_CRON_UNSUPPORTED');
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 1500 }), 'SCHEDULER_CRON_UNSUPPORTED'); // 25m 末段缩到 10m
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 420 }), 'SCHEDULER_CRON_UNSUPPORTED'); // 7m
    // every:5h→0 */5 只在 0/5/10/15/20 时触发——20→0 间隔仅 4h
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 18000 }), 'SCHEDULER_CRON_UNSUPPORTED');
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 25200 }), 'SCHEDULER_CRON_UNSUPPORTED'); // 7h
    expectCode(() => scheduleToCron({ kind: 'every', seconds: 172800 }), 'SCHEDULER_CRON_UNSUPPORTED'); // 48h 少发形
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
    // 注入命令名取新 bin 名（与生产缺省 'berry' 同代——2026-09-14 bin 改裁审计观感统一；
    // 缺省路径另有专例直构不注入 command 锁住，见下「缺省命令名」用例）
    return { execCrontab: fake.execCrontab, authorize: () => true, command: '/usr/local/bin/berry', ...extra };
  }

  it('register：他人行保留 + 自有条目挂尾（标记判据）', () => {
    const exec = fakeCrontab({ initial: '0 9 * * * echo morning\n' });
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.register(rowOf({ kind: 'daily', time: '09:30' }, 'daily-review'));
    expect(exec.writes).toHaveLength(1);
    expect(exec.writes[0]).toContain('0 9 * * * echo morning'); // 他人行保留
    expect(exec.writes[0]).toContain(
      '30 9 * * * /usr/local/bin/berry run --read-only --background --tick daily-review',
    );
    expect(exec.writes[0]).toContain(cronMarker('daily-review'));
    expect(exec.writes[0]?.endsWith('\n')).toBe(true);
  });

  it('register：命令段带 --background（修前红——N8：乙案无头腿后台道记账入口）', () => {
    // 缺该旗标则 run-entry 的 daily_budget 预检对 cron 腿恒为死条件、用量
    // 按前台道记账永不入后台日池（04 §12 律 3 ③）。行级锚锁完整命令段形。
    const exec = fakeCrontab({});
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.register(rowOf({ kind: 'every', seconds: 3600 }, 'bg-lock'));
    const line = exec.writes[0]?.split('\n').find((l) => l.includes(cronMarker('bg-lock'))) ?? '';
    expect(line).toBe(
      `0 * * * * /usr/local/bin/berry run --read-only --background --tick bg-lock ${cronMarker('bg-lock')}`,
    );
  });

  it('register：缺省命令名 = berry（bin 改裁缺省锁——不注入 command 即走生产缺省）', () => {
    const exec = fakeCrontab({});
    // 直构 deps 不带 command 键——触发生产缺省（cron-backend.ts `deps.command ?? 'berry'`）；
    // 2026-09-14 bin 改裁审计补锁：此前全部用例经 depsWith 注入绕开缺省分支，
    // 缺省被误改回旧名或误拼时四门禁不红
    const reg = createOsCronRegistrar({ execCrontab: exec.execCrontab, authorize: () => true });
    reg.register(rowOf({ kind: 'daily', time: '09:30' }, 'default-cmd'));
    expect(exec.writes[0]).toContain(' berry run --read-only --background --tick default-cmd');
    expect(exec.writes[0]).not.toContain('berry-agent run'); // marker `# berry-agent:` 是值位不受此断言影响
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
    // 旧装机现场夹具：alpha.1 装机 crontab 命令段为旧 bin 名 `berry-agent`（07 §5 F7 迁移
    // 叙事）——unregister 识别判据是行尾 marker（# berry-agent:<名>）与命令名无关，
    // 旧装机行同样被摘除。保留旧名即锁「旧装机自愈对账」语义（2026-09-14 bin 改裁
    // 审计注：非应改未改）
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

  it('unregister：前缀名任务不误摘（行级锚）——删 job 不动 job-2', () => {
    // 病灶复现：job-2 行 .includes('# berry-agent:job') === true——子串匹配把
    // 前缀名他任务行一并摘掉（宿主停机期保活腿静默失效）；行级锚 = marker 须
    // 恒在行尾（register 写入形即行尾注释），前缀名不再误中
    const jobLine = `*/5 * * * * berry run --read-only --tick job ${cronMarker('job')}`;
    const job2Line = `*/5 * * * * berry run --read-only --tick job-2 ${cronMarker('job-2')}`;
    expect(job2Line.includes(cronMarker('job'))).toBe(true); // 子串匹配病灶实证
    const exec = fakeCrontab({ initial: `${jobLine}\n${job2Line}\n` });
    const reg = createOsCronRegistrar(depsWith(exec));
    reg.unregister('job');
    expect(exec.writes).toHaveLength(1);
    const written = exec.writes[0] ?? '';
    // job 行整行摘除（判据 = 行级：写回内容无以 job marker 收尾的行）
    expect(written.split('\n').some((l) => l.trimEnd().endsWith(cronMarker('job')))).toBe(false);
    // job-2 行原样保留
    expect(written.split('\n').some((l) => l.trimEnd().endsWith(cronMarker('job-2')))).toBe(true);
    expect(written).toContain('--tick job-2');
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
