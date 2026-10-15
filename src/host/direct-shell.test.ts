/**
 * shell 直达执行件测试（挖掘 47 轮件 B——`!` 前缀命令直达用户 shell）。
 *
 * 纯机制件单测：spawn/notify 全注假（零真子进程零真网络）；锁编舞用
 * 可控 deferred 形精确驱动在飞窗。修前红锚：本文件先于实现落（模块
 * 缺席即红）——回执文案/截断帽/超时兜底诊断/单飞锁全链锁死。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DIRECT_SHELL_TAIL_CAP,
  DIRECT_SHELL_TIMEOUT_MS,
  runDirectShellCommand,
  tailOf,
  type DirectShellDeps,
} from './direct-shell.js';
import type { SpawnRunner } from './plugin-install.js';

/** 通知记录器（level 伴记——断言档位用） */
interface NotifyRecorder {
  readonly notes: { readonly text: string; readonly level: string }[];
  readonly notify: DirectShellDeps['notify'];
}

function makeNotify(): NotifyRecorder {
  const notes: { text: string; level: string }[] = [];
  return {
    notes,
    notify: (text, opts) => notes.push({ text, level: opts?.level ?? 'info' }),
  };
}

/** 可控假 spawn（deferred 应答——在飞窗精确驱动） */
interface FakeSpawn {
  readonly spawn: SpawnRunner;
  /** 已收调用记录（cmd / args / options） */
  readonly calls: {
    readonly cmd: string;
    readonly args: readonly string[];
    readonly options: { cwd?: string; timeoutMs?: number };
  }[];
  /** 下一笔调用的应答柄（resolve stdout / reject err） */
  next(): { resolve(stdout: string, stderr?: string): void; reject(err: unknown): void };
}

function makeFakeSpawn(): FakeSpawn {
  const calls: FakeSpawn['calls'] = [];
  const pending: {
    resolve: (v: { stdout: string; stderr: string }) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const spawn: SpawnRunner = {
    run: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
  return {
    spawn,
    calls,
    next: () => ({
      resolve: (stdout, stderr = '') => pending.shift()!.resolve({ stdout, stderr }),
      reject: (err) => pending.shift()!.reject(err),
    }),
  };
}

/** 非零退出 reject 形（execFile promisify 真身形——Error 伴 stderr 属性） */
function execFileReject(message: string, stderr: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { stderr, ...extra });
}

function depsOf(over: Partial<DirectShellDeps> = {}): DirectShellDeps {
  return { spawn: makeFakeSpawn().spawn, cwd: () => '/tmp/wk', notify: () => {}, ...over };
}

describe('shell 直达执行件（挖掘 47 轮件 B）', () => {
  it('起跑回声 + 成功回执含 stdout 尾：$ 前缀命令词面单源', async () => {
    const rec = makeNotify();
    const fake = makeFakeSpawn();
    const run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn, notify: rec.notify });
    run('git status');
    expect(rec.notes[0]).toEqual({ text: 'shell 直达：$ git status', level: 'info' }); // 起跑回声（长命令无反馈窗的诚实呈报）
    fake.next().resolve('nothing to commit');
    await vi.waitFor(() => expect(rec.notes.length).toBe(2));
    expect(rec.notes[1]!.text).toContain('git status 完成');
    expect(rec.notes[1]!.text).toContain('nothing to commit');
    expect(rec.notes[1]!.level).toBe('info');
  });

  it('失败回执 error 档：stderr 尾非空取 stderr 尾诊断', async () => {
    const rec = makeNotify();
    const fake = makeFakeSpawn();
    const run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn, notify: rec.notify });
    run('npm run build');
    fake.next().reject(execFileReject('Command failed: npm run build', 'SyntaxError: unexpected token'));
    await vi.waitFor(() => expect(rec.notes.length).toBe(2));
    expect(rec.notes[1]!.level).toBe('error');
    expect(rec.notes[1]!.text).toContain('npm run build 失败');
    expect(rec.notes[1]!.text).toContain('SyntaxError: unexpected token'); // stderr 尾诊断在场
    expect(rec.notes[1]!.text).not.toContain('Command failed'); // 不取 message（stderr 非空优先）
  });

  it('超时拒可读诊断兜底：stderr 空串（SIGTERM 击杀形）→ err.message', async () => {
    const rec = makeNotify();
    const fake = makeFakeSpawn();
    const run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn, notify: rec.notify });
    run('sleep 999');
    // execFile 超时击杀真身形：killed 位 + message「Command failed」+ stderr 恒空串
    fake.next().reject(execFileReject('Command failed: sleep 999', '', { killed: true }));
    await vi.waitFor(() => expect(rec.notes.length).toBe(2));
    expect(rec.notes[1]!.level).toBe('error');
    expect(rec.notes[1]!.text).toContain('sleep 999 失败');
    expect(rec.notes[1]!.text).toContain('Command failed: sleep 999'); // err.message 兜底（stderr 空不呈空诊断）
  });

  it('spawn 调用形：shell -c 命令 + cwd 现读 + 超时帽透传', async () => {
    const fake = makeFakeSpawn();
    let cwdNow = '/tmp/wk-a';
    const run = runDirectShellCommand({
      ...depsOf(),
      spawn: fake.spawn,
      cwd: () => cwdNow,
      shellPath: '/bin/dash',
      timeoutMs: 5_000,
    });
    run('pwd');
    expect(fake.calls[0]).toEqual({
      cmd: '/bin/dash',
      args: ['-c', 'pwd'],
      options: { cwd: '/tmp/wk-a', timeoutMs: 5_000 },
    });
    fake.next().resolve('');
    await new Promise<void>((r) => setImmediate(r)); // 微任务+宏任务全 flush（finally 解锁落地）
    cwdNow = '/tmp/wk-b'; // cwd 每笔现读（非闭包冻结）
    run('pwd');
    expect(fake.calls[1]!.options.cwd).toBe('/tmp/wk-b');
    fake.next().resolve('');
  });

  it('超时帽/尾段帽缺省值：120s / 800 字符', async () => {
    const fake = makeFakeSpawn();
    const run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn });
    run('ls');
    expect(fake.calls[0]!.options.timeoutMs).toBe(DIRECT_SHELL_TIMEOUT_MS);
    expect(DIRECT_SHELL_TIMEOUT_MS).toBe(120_000); // 帽值锁死（规范定值）
    expect(DIRECT_SHELL_TAIL_CAP).toBe(800);
    fake.next().resolve('');
    await vi.waitFor(() => expect(true).toBe(true));
  });

  it('shellPath 缺省链：SHELL 环境键 → /bin/sh 兜底', async () => {
    vi.stubEnv('SHELL', '/usr/local/bin/fish');
    try {
      const fake = makeFakeSpawn();
      let run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn });
      run('echo 1');
      expect(fake.calls[0]!.cmd).toBe('/usr/local/bin/fish');
      vi.stubEnv('SHELL', ''); // 空串视同未设
      run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn });
      run('echo 2');
      expect(fake.calls[1]!.cmd).toBe('/bin/sh');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('in-flight 单飞锁：执行中二发 warn 拒 + 完成后解锁可再发', async () => {
    const rec = makeNotify();
    const fake = makeFakeSpawn();
    const run = runDirectShellCommand({ ...depsOf(), spawn: fake.spawn, notify: rec.notify });
    run('long-job');
    run('second-cmd'); // 在飞窗二发
    expect(fake.calls.length).toBe(1); // 二发不触 spawn
    expect(rec.notes.some((n) => n.text === 'shell 直达：上一条仍在执行（完成后再发）' && n.level === 'warn')).toBe(
      true,
    );
    fake.next().resolve('done');
    await vi.waitFor(() => expect(rec.notes.filter((n) => n.text.includes('long-job 完成')).length).toBe(1));
    run('next-cmd'); // 解锁后再发
    expect(fake.calls.length).toBe(2);
    fake.next().resolve('');
  });

  it('输出截断帽：超帽截头留尾 + 计数前注；帽内零前注', async () => {
    const rec = makeNotify();
    const fake = makeFakeSpawn();
    const run = runDirectShellCommand({
      ...depsOf(),
      spawn: fake.spawn,
      notify: rec.notify,
      outputTailCap: 10,
    });
    run('big-output');
    const big = 'x'.repeat(25);
    fake.next().resolve(big);
    await vi.waitFor(() => expect(rec.notes.some((n) => n.text.includes('big-output 完成'))).toBe(true));
    const receipt = rec.notes.find((n) => n.text.includes('big-output 完成'))!;
    expect(receipt.text).toContain('…（已截断，共 25 字符）'); // 计数前注
    expect(receipt.text).toContain('x'.repeat(10)); // 尾段 10 字符保真
    expect(receipt.text).not.toContain('x'.repeat(11)); // 头段已截
    // 帽内零前注
    run('small');
    fake.next().resolve('abc');
    await vi.waitFor(() => expect(rec.notes.some((n) => n.text.includes('small 完成'))).toBe(true));
    const small = rec.notes.find((n) => n.text.includes('small 完成'))!;
    expect(small.text).toContain('abc');
    expect(small.text).not.toContain('已截断');
  });

  it('tailOf 纯函数：空串原样 / 帽内原样 / 超帽截头留尾前注', () => {
    expect(tailOf('', 5)).toBe('');
    expect(tailOf('abc', 5)).toBe('abc');
    const out = tailOf('abcdefgh', 3);
    expect(out).toContain('…（已截断，共 8 字符）');
    expect(out.endsWith('fgh')).toBe(true); // 留尾
  });
});
