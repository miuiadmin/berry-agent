/**
 * runner 测试——RunnerFactory 进程实装（argv 形/结局分类/preview 截断/kill
 * 语义）。spawnFn 假件（EventEmitter 拟 child）驱动主面；TERM→KILL 升级用
 * 真 node 子进程腿（本地进程零外联）。
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createProcessRunnerFactory, type ProcessRunnerOptions } from './runner.js';
import type { JobRow } from './types.js';

/** 行构造助手 */
function rowOf(name = 'j'): JobRow {
  return {
    name,
    prompt: '干活',
    cwd: null,
    schedule: { kind: 'every', seconds: 60 },
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

/** 假 child（EventEmitter 拟：stdout/stderr 流 + close/error 事件测试驱动） */
interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

/** spawnFn 假件工厂：捕获 argv/options、返拟 child */
function fakeSpawn(): {
  spawn: ReturnType<typeof vi.fn>;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  const spawn = vi.fn(((
    _cmd: string,
    argv: string[],
    options: { cwd?: string; env?: Record<string, string>; detached?: boolean } | undefined,
  ) => {
    const child = new EventEmitter() as FakeChild;
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    children.push(child);
    void argv;
    void options;
    return child;
  }) as unknown as typeof import('node:child_process').spawn);
  return { spawn, children };
}

const NOW = '2026-09-07T08:00:00.000Z';

/** 装配 runner 工厂（假 spawn + 固定时钟——Mock 与 spawn 重载签名不结构兼容，单点断言后收窄） */
function factory(spawn: ReturnType<typeof vi.fn>, extra: Partial<ProcessRunnerOptions> = {}) {
  return createProcessRunnerFactory({
    spawnFn: spawn as unknown as ProcessRunnerOptions['spawnFn'],
    now: () => NOW,
    ...extra,
  });
}

describe('spawn 请求形', () => {
  it('argv 缺省 = run --read-only --tick <名>；detached 进程组；cwd/env 透传', async () => {
    const { spawn, children } = fakeSpawn();
    const runner = factory(spawn);
    const handle = await runner.spawn({
      row: { ...rowOf('daily-review'), cwd: '/tmp' },
      trigger: 'clock',
      wallTimeoutMs: 1000,
    });
    expect(handle.pid).toBe(4242);
    const [cmd, argv, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd?: string; detached?: boolean },
    ];
    expect(cmd).toBe('berry-agent');
    expect(argv).toEqual(['run', '--read-only', '--tick', 'daily-review']);
    expect(options.cwd).toBe('/tmp');
    expect(options.detached).toBe(true);
    // close 收场
    children[0]!.emit('close', 0, null);
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('exit_code');
  });

  it('buildArgv 可注入换形（装配批可换）；env 透传', async () => {
    const { spawn, children } = fakeSpawn();
    const runner = factory(spawn, {
      command: '/abs/berry-agent',
      buildArgv: (row, trigger) => ['go', row.name, trigger],
      env: { BERRY_AGENT_DATA_DIR: '/data' },
    });
    const handle = await runner.spawn({ row: rowOf('x'), trigger: 'cron', wallTimeoutMs: 1000 });
    const [cmd, argv, options] = spawn.mock.calls[0] as unknown as [string, string[], { env?: Record<string, string> }];
    expect(cmd).toBe('/abs/berry-agent');
    expect(argv).toEqual(['go', 'x', 'cron']);
    expect(options.env).toEqual({ BERRY_AGENT_DATA_DIR: '/data' });
    children[0]!.emit('close', 0, null);
    await handle.settled;
  });
});

describe('结局分类', () => {
  it('exit_code：stdout 尾窗取 preview、≤200 截断', async () => {
    const { spawn, children } = fakeSpawn();
    const runner = factory(spawn);
    const handle = await runner.spawn({ row: rowOf(), trigger: 'clock', wallTimeoutMs: 1000 });
    children[0]!.stdout.emit('data', Buffer.from('a'.repeat(300)));
    children[0]!.emit('close', 0, null);
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('exit_code');
    expect(outcome.exitCode).toBe(0);
    // 尾窗 4096 保全文 300 → preview 截 200
    expect(outcome.finalTextPreview).toBe('a'.repeat(200));
  });

  it('非零退出带 stderr 末行 error 摘要', async () => {
    const { spawn, children } = fakeSpawn();
    const runner = factory(spawn);
    const handle = await runner.spawn({ row: rowOf(), trigger: 'manual', wallTimeoutMs: 1000 });
    children[0]!.stderr.emit('data', Buffer.from('第一行\n第二行'));
    children[0]!.emit('close', 1, null);
    const outcome = await handle.settled;
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toBe('第二行');
  });

  it('外部信号终止归 killed', async () => {
    const { spawn, children } = fakeSpawn();
    const runner = factory(spawn);
    const handle = await runner.spawn({ row: rowOf(), trigger: 'clock', wallTimeoutMs: 1000 });
    children[0]!.emit('close', null, 'SIGUSR1');
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('killed');
  });

  it('spawn 同步抛归 spawn 结局（进程从未存在）', async () => {
    const spawn = vi.fn(() => {
      throw new Error('ENOENT');
    });
    const runner = factory(spawn); // factory 单点收窄——无需逐处转型
    const handle = await runner.spawn({ row: rowOf(), trigger: 'clock', wallTimeoutMs: 1000 });
    expect(handle.pid).toBeNull();
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('spawn');
    expect(outcome.error).toContain('ENOENT');
  });

  it('kill 后收场归 kill reason（timeout/preempted 原样）', async () => {
    const { spawn, children } = fakeSpawn();
    const runner = factory(spawn);
    const handle = await runner.spawn({ row: rowOf(), trigger: 'clock', wallTimeoutMs: 1000 });
    handle.kill('timeout');
    children[0]!.emit('close', null, 'SIGTERM');
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('timeout');
    expect(handle.kill('preempted')); // 幂等：再杀不改结局
    expect((await handle.settled).reason).toBe('timeout');
  });
});

describe('TERM→KILL 升级（真 node 子进程腿——本地零外联）', () => {
  /** 真进程装配：node -e <脚本>（绕开缺席的 berry-agent bin） */
  function nodeRunner(script: string, killGraceMs: number) {
    return {
      runner: createProcessRunnerFactory({
        now: () => NOW,
        killGraceMs,
        command: process.execPath,
        buildArgv: () => ['-e', script],
      }),
    };
  }

  it('TERM 被陷阱捕获不退 → 宽限后 KILL 升级收场', async () => {
    vi.useFakeTimers();
    try {
      // SIGTERM 陷阱吞信号不退——只有 KILL 能收（升级路径真值）
      const { runner } = nodeRunner("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);", 100);
      const handle = await runner.spawn({ row: rowOf('stubborn'), trigger: 'clock', wallTimeoutMs: 1000 });
      handle.kill('timeout');
      // 宽限内未收场（TERM 被吞）——快进触发 KILL 升级
      await vi.advanceTimersByTimeAsync(300);
      const outcome = await handle.settled;
      expect(outcome.reason).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it('TERM 即杀的普通进程宽限内收场（KILL 升级空放无害）', async () => {
    const { runner } = nodeRunner('setTimeout(()=>{},30000);', 5_000);
    const handle = await runner.spawn({ row: rowOf('polite'), trigger: 'clock', wallTimeoutMs: 1000 });
    handle.kill('preempted');
    const outcome = await handle.settled;
    expect(outcome.reason).toBe('preempted');
  }, 20_000);
});
