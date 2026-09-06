/**
 * SchedulerEngine 测试——进程内挂钟编舞（due sweep/闸拦/抢占/墙钟/帽/启停）
 * 假 TimerSeam 手推时序 + 假 RunnerFactory 零进程 + 真临时目录库。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from './migration.js';
import { createSchedulerEngine, type SchedulerEngine, type TimerSeam } from './engine.js';
import { createSchedulerService, type JobsDao, type SchedulerService } from './service.js';
import type { RunnerFactory, RunnerHandle, RunnerRequest } from './runner.js';
import type { GateFacts } from './gates.js';
import type { JobRow, RunOutcome } from './types.js';

/** 假钟：记录每枚定时器（ms 到点回调），测试手动 fire */
class FakeTimers implements TimerSeam {
  seq = 0;
  pending = new Map<number, { ms: number; fn: () => void }>();
  set(ms: number, fn: () => void): unknown {
    const id = ++this.seq;
    this.pending.set(id, { ms, fn });
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  /** 触发最早的待火定时器（挂钟推进一轮） */
  fireEarliest(): void {
    const earliest = [...this.pending.entries()].sort((a, b) => a[1].ms - b[1].ms)[0];
    if (!earliest) throw new Error('无待火定时器可触发');
    this.pending.delete(earliest[0]);
    earliest[1].fn();
  }
}

/**
 * 假 runner：每 spawn 记请求；resolve(i, outcome) 手动收场第 i 枚；
 * kill 记 reason 并可 resolveWith 使 settled 收场。
 */
function fakeRunner(): RunnerFactory & {
  requests: RunnerRequest[];
  kills: Array<{ index: number; reason: string }>;
  resolve: (index: number, outcome?: Partial<RunOutcome>) => void;
} {
  const requests: RunnerRequest[] = [];
  const kills: Array<{ index: number; reason: string }> = [];
  const pending: Array<{ resolve: (o: RunOutcome) => void; kill: (reason: string) => void }> = [];
  return {
    requests,
    kills,
    resolve(index, outcome) {
      pending[index]?.resolve({
        trigger: requests[index]?.trigger ?? 'clock',
        reason: 'exit_code',
        exitCode: 0,
        finishedAt: '2026-09-07T08:00:00.000Z',
        ...outcome,
      });
    },
    async spawn(req) {
      const index = requests.length;
      requests.push(req);
      let settledResolve!: (o: RunOutcome) => void;
      const settled = new Promise<RunOutcome>((resolve) => {
        settledResolve = resolve;
      });
      pending[index] = {
        resolve: settledResolve,
        kill: (reason) => kills.push({ index, reason }),
      };
      const handle: RunnerHandle = {
        pid: 1000 + index,
        kill(reason) {
          pending[index]?.kill(reason);
        },
        settled,
      };
      return handle;
    },
  };
}

let dir: string;
let store: Store | null = null;
let nowMs: number;
const warn = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-engine-test-'));
  nowMs = Date.parse('2026-09-07T08:00:00.000Z');
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 装配全家（真库 + 服务 + 引擎 + 假件注入） */
function assemble(
  options: {
    gateFacts?: (row: JobRow) => GateFacts;
    maxConcurrent?: number;
    wallTimeoutMs?: number;
  } = {},
): {
  service: SchedulerService;
  dao: JobsDao;
  engine: SchedulerEngine;
  timers: FakeTimers;
  runner: ReturnType<typeof fakeRunner>;
} {
  store = openStore({
    dbPath: join(dir, 'test.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [SCHEDULER_MIGRATION],
  });
  const { service, dao } = createSchedulerService({
    db: store.sqlite(),
    now: () => new Date(nowMs).toISOString(),
    warn,
    pathExists: () => true,
  });
  const timers = new FakeTimers();
  const runner = fakeRunner();
  const engine = createSchedulerEngine({
    dao,
    runner,
    now: () => new Date(nowMs).toISOString(),
    warn,
    timers,
    gateFacts: options.gateFacts,
    maxConcurrent: options.maxConcurrent,
    wallTimeoutMs: options.wallTimeoutMs,
  });
  return { service, dao, engine, timers, runner };
}

/** 时钟步进（毫秒） */
function advance(ms: number): void {
  nowMs += ms;
}

describe('start 重启补推进', () => {
  it('启机时既 due 的行静默 advance 不 fire（错过不重放）', () => {
    const { service, dao, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    // 建行时刻 next=+10m；推 11m 令其过期（模拟停机期错过）
    advance(11 * 60_000);
    engine.start();
    expect(runner.requests).toHaveLength(0); // 不补跑
    const row = dao.get('j');
    expect(row?.nextFireAt).not.toBeNull();
    expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(nowMs); // 已跳下一刻
  });

  it('start 幂等（重复 start 不重复补推进）', () => {
    const { service, engine, timers } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    const first = timers.seq;
    engine.start();
    expect(timers.seq).toBe(first); // 未再排定时器
  });
});

describe('挂钟 sweep fire 编舞', () => {
  it('到点 sweep 起 runner；结算回写 last/next 推进', async () => {
    const { service, dao, engine, timers, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    expect(timers.pending.size).toBe(1);
    advance(10 * 60_000 + 1000); // 过到点
    await vi.waitFor(() => {
      engine.sweep();
      expect(runner.requests).toHaveLength(1);
    });
    expect(runner.requests[0]?.trigger).toBe('clock');
    expect(engine.inFlightCount).toBe(1);
    runner.resolve(0, { finalTextPreview: '干活收场' });
    await vi.waitFor(() => {
      const row = dao.get('j');
      expect(row?.lastFireAt).not.toBeNull();
      expect(row?.lastOutcome?.reason).toBe('exit_code');
      expect(row?.lastOutcome?.finalTextPreview).toBe('干活收场');
      // next 从结算时刻 +10m（结算时 now 未步进——即 sweep 时刻 +10m）
      expect(row?.nextFireAt).toBe(new Date(nowMs + 600_000).toISOString());
    });
    expect(engine.inFlightCount).toBe(0);
  });

  it('停用行不入 due（enabled 滤）', () => {
    const { service, engine, runner } = assemble();
    service.addJob({ name: 'off', schedule: 'every:5s', prompt: 'p' }); // 缺省停用
    engine.start();
    advance(60_000);
    engine.sweep();
    expect(runner.requests).toHaveLength(0);
  });

  it('并发帽：双 due 只起一枚；帽外留下轮补觉', async () => {
    const { service, engine, runner } = assemble({ maxConcurrent: 1 });
    service.addJob({ name: 'a', schedule: 'every:5s', prompt: 'p', enabled: true });
    service.addJob({ name: 'b', schedule: 'every:5s', prompt: 'p', enabled: true });
    engine.start();
    advance(10_000);
    engine.sweep();
    expect(runner.requests).toHaveLength(1); // 帽 1
    runner.resolve(0);
    await vi.waitFor(() => expect(engine.inFlightCount).toBe(0));
    engine.sweep(); // 下一轮——b 补觉（a 的 next 也重排过，仍 due 与否看推进）
    // b 此轮必起（a 在飞已清）
    expect(runner.requests.some((r) => r.row.name === 'b')).toBe(true);
  });

  it('在飞行不重触（同任务 clock 不自踏）', async () => {
    const { service, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:5s', prompt: 'p', enabled: true });
    engine.start();
    advance(10_000);
    engine.sweep();
    expect(runner.requests).toHaveLength(1);
    advance(30_000); // 仍在飞（未 resolve）——多轮 sweep 不重触不抢占
    engine.sweep();
    engine.sweep();
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]?.row.name).toBe('j');
  });
});

describe('闸拦（clock 道独辖）', () => {
  it('agent_busy 拦：gated 结局 + advance、不动 last_fire_at', () => {
    const { service, dao, engine, runner } = assemble({
      gateFacts: () => ({ agentBusy: true }),
    });
    service.addJob({ name: 'j', schedule: 'every:5s', prompt: 'p', enabled: true });
    engine.start();
    advance(10_000);
    engine.sweep();
    expect(runner.requests).toHaveLength(0); // 未起
    const row = dao.get('j');
    expect(row?.lastOutcome?.reason).toBe('gated');
    expect(row?.lastOutcome?.gate).toBe('agent_busy');
    expect(row?.lastFireAt).toBeNull(); // gated 非真跑——last_fire_at 不动
    expect(row?.nextFireAt).not.toBeNull(); // 已推进
  });

  it('manual 道不走闸直通', async () => {
    const { service, engine, runner } = assemble({
      gateFacts: () => ({ agentBusy: true, canAfford: false }),
    });
    service.addJob({ name: 'j', schedule: 'every:5s', prompt: 'p', enabled: true });
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    runner.resolve(0);
    const outcome = await p;
    expect(outcome.reason).toBe('exit_code');
  });
});

describe('执行前抢占', () => {
  it('manual 新实例抢占在飞旧实例：kill(preempted)+等收场再起新', async () => {
    const { service, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    advance(60_000);
    const first = engine.fireNow('j', 'manual'); // 旧实例
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    // 旧在飞时 manual 再呼——同步段即 kill('preempted')，再等旧收场才起新
    const second = engine.fireNow('j', 'manual');
    expect(runner.kills).toEqual([{ index: 0, reason: 'preempted' }]);
    runner.resolve(0, { reason: 'preempted' }); // 旧收场（真实 runner 由 close 事件自结）
    await vi.waitFor(() => expect(runner.requests).toHaveLength(2)); // 新实例接棒
    runner.resolve(1, { reason: 'exit_code' });
    const [o1, o2] = await Promise.all([first, second]);
    expect(o1.reason).toBe('preempted');
    expect(o2.reason).toBe('exit_code');
  });
});

describe('墙钟超时', () => {
  it('超时守卫 kill(timeout)；超时前收场则守卫空放', async () => {
    const { service, engine, timers, runner } = assemble({ wallTimeoutMs: 30_000 });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    expect(timers.pending.size).toBeGreaterThanOrEqual(1); // 挂钟轮询 + 墙钟守卫
    advance(31_000);
    // 手推墙钟到点：触发 kill('timeout')
    const wallTimer = [...timers.pending.entries()].find(([, v]) => v.ms === 30_000);
    expect(wallTimer).toBeDefined();
    timers.pending.delete(wallTimer![0]);
    wallTimer![1].fn();
    expect(runner.kills).toEqual([{ index: 0, reason: 'timeout' }]);
    runner.resolve(0, { reason: 'timeout' });
    const outcome = await p;
    expect(outcome.reason).toBe('timeout');
  });
});

describe('启停与幽灵守卫', () => {
  it('stop 摘轮询定时器；在飞自然收场照常结算', async () => {
    const { service, dao, engine, timers, runner } = assemble({ wallTimeoutMs: 30_000 });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    advance(60_000);
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    engine.stop();
    // 轮询已摘；墙钟守卫仍在场（在飞收场守卫不撤——stop 不杀在飞）
    const wallTimers = [...timers.pending.values()].map((t) => t.ms);
    expect(wallTimers).toEqual([30_000]);
    runner.resolve(0);
    await p;
    expect(timers.pending.size).toBe(0); // 收场后墙钟守卫亦清
    expect(dao.get('j')?.lastFireAt).not.toBeNull(); // 结算照写
  });

  it('fireNow 幽灵名响亮拒', async () => {
    const { engine } = assemble();
    await expect(engine.fireNow('ghost', 'manual')).rejects.toMatchObject({ code: 'SCHEDULER_NOT_FOUND' });
  });

  it('poke 重排轮询（enable 后外部戳一下）', () => {
    const { service, engine, timers } = assemble();
    engine.start();
    const before = timers.seq;
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p' });
    engine.poke();
    expect(timers.seq).toBeGreaterThan(before);
  });
});
