/**
 * SchedulerEngine 测试——进程内挂钟编舞（due sweep/闸拦/抢占/墙钟/帽/启停）
 * 假 TimerSeam 手推时序 + 假 RunnerFactory 零进程 + 真临时目录库。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pid as processPid } from 'node:process';
import { ephemeralSecretKey, openStore, type Store } from '../../src/persist/index.js';
import { SCHEDULER_MIGRATION } from './migration.js';
import { createSchedulerEngine, MAX_POLL_MS, type SchedulerEngine, type TimerSeam } from './engine.js';
import { createSchedulerService, JobsDao, type SchedulerService } from './service.js';
import { runTickCommand } from './tick.js';
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
function fakeRunner(spawnOverride?: RunnerFactory['spawn']): RunnerFactory & {
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
      // spawn 位覆写（G1 火种链防崩测试注拒绝形——绕过记录机制直注行为形）
      if (spawnOverride) return spawnOverride(req);
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
        // 大基值假 pid（900001+——与测试进程真 pid 撞值概率零：claim-then-advance
        // 记账断言面可安全断 activePid = 假件 pid）
        pid: 900001 + index,
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
    isPidAlive?: (pid: number) => boolean;
    /** spawn 位覆写（火种链防崩测试注拒绝形——缺省 fakeRunner 记录形） */
    spawnOverride?: RunnerFactory['spawn'];
    /** dao 包装位（挖掘 20 轮轮询裸奔回归锁——Proxy 覆写单方法抛错模拟 SQLITE 瞬态错） */
    daoWrap?: (dao: JobsDao) => JobsDao;
    /** 引擎 pid 注缝（SchedulerEngineDeps.pid——69 轮批注丁换代残窗/丙清账对偶注入位） */
    pid?: number;
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
  const { service, dao: rawDao } = createSchedulerService({
    db: store.sqlite(),
    now: () => new Date(nowMs).toISOString(),
    warn,
    pathExists: () => true,
  });
  const dao = options.daoWrap === undefined ? rawDao : options.daoWrap(rawDao);
  const timers = new FakeTimers();
  const runner = fakeRunner(options.spawnOverride);
  const engine = createSchedulerEngine({
    dao,
    runner,
    now: () => new Date(nowMs).toISOString(),
    warn,
    timers,
    gateFacts: options.gateFacts,
    maxConcurrent: options.maxConcurrent,
    wallTimeoutMs: options.wallTimeoutMs,
    isPidAlive: options.isPidAlive,
    ...(options.pid !== undefined ? { pid: options.pid } : {}),
  });
  return { service, dao, engine, timers, runner };
}

/** 时钟步进（毫秒） */
function advance(ms: number): void {
  nowMs += ms;
}

/** 微任务排空两轮（异步 fire 链落拍——promise 链穿透/结算判定前排干） */
async function drainMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
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

  it('kill 收场窗内双 manual 并发（十六役扫 #3）：同名恒串行不双跑——后到者排链等先到者注册再抢占（修前红：两条同挂 prev.settled、A 收场后 B/C 各自 spawn 双跑+账目互毁）', async () => {
    const { service, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const first = engine.fireNow('j', 'manual'); // A 实例
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    // A 在飞、kill 收场窗（秒级宽限）内连发两条：B 入关键段杀 A 等收场；
    // C 修前与 B 同挂 A.settled（A 收场后同批微任务各自 spawn——双跑实证
    // 3 spawns + 先收场者 finally 删后者注册清后者 durable 占用）；修后 C
    // 排同名链——B 注册完成才入段、读到的是 B 新实例（抢占语义照常）
    const second = engine.fireNow('j', 'manual');
    const third = engine.fireNow('j', 'manual');
    runner.resolve(0, { reason: 'preempted' }); // A 收场（真实 runner 由 close 事件自结）
    await vi.waitFor(() => expect(runner.requests).toHaveLength(2)); // B 接棒起跑；C 未起（修前直上 3）
    await vi.waitFor(() =>
      expect(runner.kills).toEqual([
        { index: 0, reason: 'preempted' }, // B 杀 A
        { index: 1, reason: 'preempted' }, // C 排链读新实例杀 B——先到者注册不被跳过
      ]),
    );
    runner.resolve(1, { reason: 'preempted' }); // B 收场
    await vi.waitFor(() => expect(runner.requests).toHaveLength(3)); // C 接棒（串行链不断）
    runner.resolve(2, { reason: 'exit_code' });
    const [o1, o2, o3] = await Promise.all([first, second, third]);
    expect(o1.reason).toBe('preempted');
    expect(o2.reason).toBe('preempted');
    expect(o3.reason).toBe('exit_code');
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

/**
 * add --enable 建行即戳行为锁（件C——命令面直跑：/tick add --enable 后
 * 引擎 pending 轮询即时重排）。修前红：tickAdd 零 poke——空表起跑后 belt
 * 巡检拍（MAX_POLL_MS 60s）钉死，every:5s 亚分钟级首醒须拖满 belt。假钟
 * 全控时序：建行拍恰为 5s（5.5s 为真钟近似口径——夹取下限不入场，delta
 * 5000ms 原样落拍）。
 */
describe('add --enable 建行即戳（件C——命令面行为锁）', () => {
  it('运行中 add every:5s --enable → 轮询重排 5s 拍非 60s belt 拍，首醒即触（修前红：belt 拍钉死）', async () => {
    const { service, engine, timers, runner } = assemble();
    engine.start();
    // 空表起跑——earliest null 落 belt 巡检拍（60s）
    expect([...timers.pending.values()].map((t) => t.ms)).toEqual([MAX_POLL_MS]);
    // 建行即启用一步形走命令面正门（service.addJob 直呼绕过 tick 面零戳面）
    const out = await runTickCommand(['add', 'j', 'every:5s', 'p', '--enable'], { service, engine });
    expect(out).toContain('下次到点'); // 启用即排刻（建行确成）
    const pollMs = [...timers.pending.values()].map((t) => t.ms);
    expect(pollMs).toContain(5000); // 5s 亚分钟拍在场（修前：仅 60s belt 拍）
    expect(pollMs).not.toContain(MAX_POLL_MS); // 旧 belt 拍已摘——不再空等
    // 推到 5s 拍 → sweep → 首醒 clock 道（非等 60s 拍）
    advance(5000);
    timers.fireEarliest();
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    expect(runner.requests[0]?.trigger).toBe('clock');
  });
});

describe('claim-then-advance 记账（u-2 定形注③）', () => {
  it('fire 起跑落 activePid + 起跑墙钟；settle 清账（对偶位）', async () => {
    const { service, dao, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    // 已 claim：activePid = runner 句柄 pid（乙案子进程 pid 形），起跑时刻在场
    await vi.waitFor(() => expect(dao.get('j')?.activePid).toBe(900001));
    expect(dao.get('j')?.activeStartedAt).not.toBeNull();
    runner.resolve(0);
    await p;
    // settle 清账（claim 对偶——行回 idle 可重发）
    expect(dao.get('j')?.activePid).toBeNull();
    expect(dao.get('j')?.activeStartedAt).toBeNull();
  });

  it('runner 内零跑判定（gated 结局）走 settleGated——不动 last_fire_at', async () => {
    const { service, dao, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    runner.resolve(0, { reason: 'gated', error: '处理器缺席（零跑判定）' });
    const outcome = await p;
    expect(outcome.reason).toBe('gated');
    const row = dao.get('j');
    expect(row?.lastOutcome?.reason).toBe('gated'); // 结局照记
    expect(row?.lastOutcome?.error).toContain('处理器缺席');
    expect(row?.lastFireAt).toBeNull(); // 非真跑不污染冷却闸判据
    expect(row?.activePid).toBeNull(); // claim 账面已清
    expect(row?.nextFireAt).not.toBeNull(); // next 推进照常
  });

  it('跨进程运行判定：activePid 存活未超钟 → gated 让位不 spawn 不 kill', async () => {
    const { service, dao, engine, runner } = assemble({ isPidAlive: () => true });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    // 预置他实例占用（乙案子进程 pid——非本进程、进程存活、起跑时刻新鲜）
    const startedAt = new Date(nowMs - 60_000).toISOString();
    dao.setActive('j', 4321, startedAt, startedAt);
    const outcome = await engine.fireNow('j', 'clock');
    expect(outcome.reason).toBe('gated');
    expect(outcome.error).toContain('另一进程实例正在运行');
    expect(runner.requests).toHaveLength(0); // 不 spawn
    expect(runner.kills).toHaveLength(0); // 跨进程不 kill（pid 复用误杀险）
    const row = dao.get('j');
    expect(row?.lastOutcome?.reason).toBe('gated'); // 让位照记结局
    expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
  });

  it('跨进程占用死残账/超钟残账：不拦照跑（覆写自愈）', async () => {
    // 死残账：pid 已死但未超钟——isPidAlive false 判死即不拦
    const dead = assemble({ isPidAlive: () => false });
    dead.service.addJob({ name: 'a', schedule: 'every:10m', prompt: 'p', enabled: true });
    const t0 = new Date(nowMs - 1_000).toISOString();
    dead.dao.setActive('a', 4321, t0, t0);
    const pa = dead.engine.fireNow('a', 'clock');
    await vi.waitFor(() => expect(dead.runner.requests).toHaveLength(1));
    expect(dead.dao.get('a')?.activePid).toBe(900001); // 覆写自愈
    dead.runner.resolve(0);
    await pa;
    // 超钟残账：活体但超墙钟（pid 复用误判险形）——不拦（下轮 fire 覆写）
    const stale = assemble({ isPidAlive: () => true, wallTimeoutMs: 30_000 });
    stale.service.addJob({ name: 'b', schedule: 'every:10m', prompt: 'p', enabled: true });
    const old = new Date(nowMs - 60_000).toISOString();
    stale.dao.setActive('b', 4321, old, old);
    const pb = stale.engine.fireNow('b', 'clock');
    await vi.waitFor(() => expect(stale.runner.requests).toHaveLength(1));
    stale.runner.resolve(0);
    await pb;
    expect(stale.dao.get('b')?.lastOutcome?.reason).toBe('exit_code');
  });
});

describe('start 僵行清扫（u-2 定形注③）', () => {
  it('activePid 死 + 超墙钟：清账回 idle + lastOutcome 记回收（killed）', () => {
    const { service, dao, engine } = assemble({ isPidAlive: () => false, wallTimeoutMs: 30_000 });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const old = new Date(nowMs - 60_000).toISOString();
    dao.setActive('j', 4321, old, old);
    engine.start();
    const row = dao.get('j');
    expect(row?.activePid).toBeNull(); // 占用清
    expect(row?.activeStartedAt).toBeNull();
    expect(row?.lastOutcome?.reason).toBe('killed'); // 回收结局照记
    expect(row?.lastOutcome?.error).toContain('僵行回收');
    expect(row?.lastFireAt).toBeNull(); // 非真跑不动 last_fire_at
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('僵行清扫'));
  });

  it('保守判：活+超钟不清（pid 复用误判险）；死+未超钟不清（在飞窗口内）', () => {
    const { service, dao, engine } = assemble({ isPidAlive: () => true, wallTimeoutMs: 30_000 });
    service.addJob({ name: 'alive', schedule: 'every:10m', prompt: 'p', enabled: true });
    const old = new Date(nowMs - 60_000).toISOString();
    dao.setActive('alive', 4321, old, old); // 活 + 超钟——不清挂账
    service.addJob({ name: 'fresh', schedule: 'every:10m', prompt: 'p', enabled: true });
    dao.setActive('fresh', 4321, new Date(nowMs).toISOString(), new Date(nowMs).toISOString()); // 活 + 未超钟——不清
    engine.start();
    expect(dao.get('alive')?.activePid).toBe(4321);
    expect(dao.get('fresh')?.activePid).toBe(4321);
  });

  it('己 pid 占用不清（甲案在飞——进程内注册表管辖）', () => {
    const { service, dao, engine } = assemble({ isPidAlive: () => false, wallTimeoutMs: 30_000 });
    service.addJob({ name: 'self', schedule: 'every:10m', prompt: 'p', enabled: true });
    const old = new Date(nowMs - 60_000).toISOString();
    dao.setActive('self', processPid, old, old); // 己 pid = 甲案宿主在飞
    engine.start();
    expect(dao.get('self')?.activePid).toBe(processPid); // 清扫跳过
  });
});

/**
 * 时钟回拨窗（注入假钟——先推进后回拨的确定性序列）。nextFireAt 层的回拨
 * 语义已由 schedule.test.ts「every 回拨形」锁（锚起算不前移）；此处锁引擎
 * 编舞面：回拨窗内 due 判定不重触发已 fire 行（在飞不抢占自家 + 结算后
 * next 恒未来）、恢复前跳越过 next 后 sweep 正常补跑。
 */
describe('时钟回拨窗（注入假钟——回拨不重触发、恢复后 sweep 正常）', () => {
  it('推进过到点 fire → 在飞窗内回拨 sweep 不重触 → 结算后回拨 next 不前移 → 恢复前跳补跑', async () => {
    const { service, dao, engine, runner } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    advance(10 * 60_000 + 1000); // 过到点（建行 next=+10m）
    engine.sweep();
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    // 回拨 30m（在飞窗内）：行 next_fire_at（未来刻）在回拨后更未来——due
    // 判定不含该行，sweep 不重触发不抢占自家实例
    advance(-30 * 60_000);
    engine.sweep();
    engine.sweep();
    expect(runner.requests).toHaveLength(1);
    // 结算：next 从结算时刻（回拨后的 now）+10m 起算
    runner.resolve(0);
    await vi.waitFor(() => expect(engine.inFlightCount).toBe(0));
    const settledNext = dao.get('j')?.nextFireAt;
    expect(settledNext).toBe(new Date(nowMs + 600_000).toISOString());
    // 再回拨 10m：next 不随回拨前移（仍是上一步落值）——sweep 零动作
    advance(-10 * 60_000);
    engine.sweep();
    expect(runner.requests).toHaveLength(1);
    expect(dao.get('j')?.nextFireAt).toBe(settledNext);
    // 恢复前跳 60m（越过 next）：sweep 正常起跑第二轮 + 结算照写
    advance(60 * 60_000);
    engine.sweep();
    await vi.waitFor(() => expect(runner.requests).toHaveLength(2));
    runner.resolve(1);
    await vi.waitFor(() => expect(engine.inFlightCount).toBe(0));
    expect(dao.get('j')?.lastOutcome?.reason).toBe('exit_code');
    expect(dao.get('j')?.lastFireAt).not.toBeNull();
  });
});

/**
 * 火种链防崩（G1 回归锁）：doSweep 对 fireRow 的 void 调用必须自带 catch——
 * spawn / dao 结算腿任一拒绝穿透 void 即 unhandledRejection，生产形 = 崩溃
 * 编舞 exit(1) 连杀在飞会话（无人值守宿主不可接受）。修前红：拒绝直穿
 * process 级 unhandledRejection 且 warn 零呼；修后 warn 记账（行名+错误）不重抛。
 */
describe('sweep 火种链防崩（void fireRow 拒绝必接）', () => {
  it('runner.spawn 拒绝：回卷清账 + spawn 结局推进（67 轮批注乙——claim 先行对偶），无 unhandledRejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const boom = new Error('spawn-boom');
      const { service, dao, engine } = assemble({
        spawnOverride: () => Promise.reject(boom),
      });
      service.addJob({ name: 'j', schedule: 'every:5s', prompt: 'p', enabled: true });
      engine.start();
      advance(10_000);
      engine.sweep();
      await drainMicrotasks();
      // 修前红锚：拒绝直穿 fireRow（void 无接即 unhandledRejection）；修后
      // spawn 抛折 spawn 结局回卷清账——行照结算（占位不滞留、next 推进）
      expect(unhandled).toHaveLength(0);
      const row = dao.get('j');
      expect(row?.lastOutcome?.reason).toBe('spawn');
      expect(row?.lastOutcome?.error).toContain('spawn-boom');
      expect(row?.nextFireAt).not.toBeNull();
      expect(row?.activePid).toBeNull();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('handle.settled 拒绝折 error 结局照结算（67 轮批注甲）：无 unhandledRejection、不依赖外层 catch 补觉', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // 真 runner 契约 settled 永不 reject——此处故意破约（submitText 回执真
      // 拒绝穿透 scheduler-tick runSession 尾段的形——配置坏词非瞬态族）
      const { service, dao, engine } = assemble({
        spawnOverride: async () => ({
          pid: 900099,
          kill: () => undefined,
          settled: Promise.reject(new Error('settled-boom')),
        }),
      });
      service.addJob({ name: 'j', schedule: 'every:5s', prompt: 'p', enabled: true });
      engine.start();
      advance(10_000);
      engine.sweep();
      await drainMicrotasks();
      expect(unhandled).toHaveLength(0);
      // 拒绝折 error 结局（settleFire 落账）——warn 不再是承接面
      const row = dao.get('j');
      expect(row?.lastOutcome?.reason).toBe('exit_code');
      expect(row?.lastOutcome?.error).toContain('settled-boom');
      expect(row?.nextFireAt).not.toBeNull();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

/**
 * 轮询拍异常收口（挖掘 20 轮回归锁）：定时回调直调 doSweep / scheduleNextPoll
 * 内 earliestNextFire 均为裸同步 dao 读——SQLITE 瞬态错（busy 越过 busy_timeout
 * /IOERR——跨进程写 jobs 表系 04 §12 设计内场景）穿透回调即 uncaughtException，
 * 崩溃编舞 exit(1) 连杀在飞会话（G1 同理由唯独未施于轮询腿）。修前红：异常
 * 直穿回调（测试面即抛）；修后吞进 warn + 钟必重臂（obs/service 定时腿同律）。
 */
describe('activePid 记账吞错（挖掘 21 轮件10——fire 位记账抛错不泄漏表项不饿死行）', () => {
  it('fire 位记账号 dao.claimActive 抛错：降 warn 续 fire 流——settle 清账照走、行不饿死（修前：fireNow reject + active 表项泄漏 + sweep 恒 skip）', async () => {
    // 70 轮件E 起记账号走 claimActive 条件覆写（修前 seam 为 setActive）——
    // 注入位随调用面迁移：记账号形 = 覆写句柄 pid（900001 ≠ 己 pid）
    let accountCalls = 0;
    let accountThrows = false;
    const { service, engine, timers, runner } = assemble({
      daoWrap: (d) =>
        new Proxy(d, {
          get(target, prop) {
            if (prop === 'claimActive' && accountThrows) {
              return (name: string, claimPid: number, startedAt: string, updatedAt: string, expect: number | null) => {
                if (claimPid === 900001) {
                  // 只锁记账号位（判占形 claimPid=己 pid 直通）
                  accountCalls += 1;
                  if (accountCalls === 1) throw new Error('SQLITE_BUSY: 测试注入写锁');
                }
                return target.claimActive(name, claimPid, startedAt, updatedAt, expect);
              };
            }
            return Reflect.get(target, prop) as unknown;
          },
        }),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    accountThrows = true; // start 腿正常跑完后再注入——锁 fire 记账位
    const fired = engine.fireNow('j', 'manual');
    // 修前红锚①：异常穿透 fireRow（active.set 已落而 tail 未返 spawned 不接管
    // 清账）→ fireNow 收 reject；修后：记账吞 warn，fire 流续行
    runner.resolve(0, { finalTextPreview: '记账瞬态错下照常收场' });
    const result = await fired;
    expect(result.reason).toBe('exit_code');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SQLITE_BUSY'));
    // settle 清账照走（对偶位第二调不抛——首调后闸关；第二 fire 句柄 pid 900002 不入闸）
    expect(engine.inFlightCount).toBe(0);
    // 行不饿死：修前 active 表项泄漏使 sweep :404 active.has 判据恒 skip——
    // 推进到下一刻 sweep 补觉（正常 spawn 第二实例）
    advance(10 * 60_000 + 1000);
    timers.fireEarliest();
    await new Promise((r) => setTimeout(r, 0)); // fire 异步链落拍
    expect(runner.requests.length).toBe(2);
    runner.resolve(1);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('轮询拍异常收口（dao 读抛错不炸进程不死钟）', () => {
  it('轮询拍 dao.due 抛错：吞进 warn + 钟重臂续巡（下一拍补觉 due 行）', () => {
    let dueThrows = false;
    const { service, engine, timers } = assemble({
      daoWrap: (d) =>
        new Proxy(d, {
          get(target, prop) {
            if (prop === 'due' && dueThrows) {
              return () => {
                throw new Error('SQLITE_BUSY: 测试注入瞬态锁');
              };
            }
            return Reflect.get(target, prop) as unknown;
          },
        }),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    dueThrows = true; // start 腿（重启补推进）正常跑完后再注入——锁轮询拍位
    advance(10 * 60_000 + 1000);
    // 修前红锚：裸回调直抛（异常穿透 fireEarliest 即测试红）——修后吞 warn 重臂
    timers.fireEarliest();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SQLITE_BUSY'));
    expect(timers.pending.size).toBe(1); // 钟重臂（死钟反面——未推进 due 行由下一拍补觉）
  });

  it('下一拍计算 earliestNextFire 抛错：按最大巡检间隔兜底重拍（钟不死）', () => {
    let earliestThrows = false;
    const { service, engine, timers } = assemble({
      daoWrap: (d) =>
        new Proxy(d, {
          get(target, prop) {
            if (prop === 'earliestNextFire' && earliestThrows) {
              return () => {
                throw new Error('SQLITE_IOERR: 测试注入读错');
              };
            }
            return Reflect.get(target, prop) as unknown;
          },
        }),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    earliestThrows = true; // start 尾首排正常跑完后再注入——锁重排位
    advance(10 * 60_000 + 1000);
    // 修前红锚：doSweep 正常收场后 scheduleNextPoll 内 earliestNextFire 直抛
    timers.fireEarliest();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SQLITE_IOERR'));
    // 兜底重拍 = belt 最大巡检间隔（不递归重调 scheduleNextPoll——会再抛同错）
    expect(timers.pending.size).toBe(1);
    const [belt] = timers.pending.values();
    expect(belt?.ms).toBe(MAX_POLL_MS);
  });
});

/**
 * 一切收场形必结算（04 §12 律 3 67 轮批注甲）：runner settled 契约破约形
 * （submitText 回执真拒绝——配置坏词 THINKING_LEVEL_INVALID 等非瞬态族穿透
 * scheduler-tick runSession 尾段）修前裸 await 穿透引擎尾段 finally 只清账
 * 不结算——next 不推进、last_fire_at 恒空（cooldown 闸失判据）→ 行持续 due
 * 每 MIN_POLL_MS 重 fire：每拍新 durable 会话行无界累积 + 热循环刷屏。修后
 * 拒绝折 error 结局照走 settleFire——结算单点不因收场形旁路。
 */
describe('一切收场形必结算（67 轮批注甲）', () => {
  it('settled 真拒绝折 error 结局：last_outcome 载拒绝因 + last_fire_at/next 推进 + 占用清 + 后续 sweep 不重 fire（修前红：穿透只清账不结算、每拍重 fire）', async () => {
    // 计数形拒绝 runner：每 spawn 记数、settled 恒 reject（铸真拒绝形）
    let spawns = 0;
    const { service, dao, engine } = assemble({
      spawnOverride: () => {
        spawns += 1;
        return Promise.resolve({
          pid: 900500,
          kill: () => undefined,
          settled: Promise.reject(new Error('THINKING_LEVEL_INVALID: 思考档位词无效（铸）')),
        });
      },
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    advance(10 * 60_000 + 1000);
    engine.sweep();
    await drainMicrotasks();
    const row = dao.get('j');
    // 修后锚①：拒绝折 error 结局照走 settleFire——词形对齐 runSession failed
    // 分支（reason=exit_code / exitCode=1 / error 载拒绝因）
    expect(row?.lastOutcome?.reason).toBe('exit_code');
    expect(row?.lastOutcome?.exitCode).toBe(1);
    expect(row?.lastOutcome?.error).toContain('run 回执拒绝');
    expect(row?.lastOutcome?.error).toContain('THINKING_LEVEL_INVALID');
    expect(row?.lastFireAt).not.toBeNull(); // 真跑面照推进（cooldown 闸判据复位）
    // 修后锚②：next 推进至未来刻（修前红锚：不结算仍 due）
    expect(row?.nextFireAt).not.toBeNull();
    expect(Date.parse(row?.nextFireAt ?? '')).toBeGreaterThan(nowMs);
    expect(row?.activePid).toBeNull(); // 清账对偶照走（finally 位不旁路）
    // 锁2 热循环刹停：再 sweep 一拍不重 fire（next 未来——due 集不含该行；
    // 修前红锚：行仍 due 每拍重 fire）
    engine.sweep();
    await drainMicrotasks();
    expect(spawns).toBe(1);
  });

  it('正常收场形零变（防过修）：settled 正常 resolve → exit_code 结局 + preview 照带', async () => {
    let spawns = 0;
    const { service, dao, engine } = assemble({
      spawnOverride: () => {
        spawns += 1;
        return Promise.resolve({
          pid: 900501,
          kill: () => undefined,
          settled: Promise.resolve({
            trigger: 'clock',
            reason: 'exit_code',
            exitCode: 0,
            finalTextPreview: '正常收场',
            finishedAt: '2026-09-07T08:00:00.000Z',
          } satisfies RunOutcome),
        });
      },
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engine.start();
    advance(10 * 60_000 + 1000);
    engine.sweep();
    await drainMicrotasks();
    const row = dao.get('j');
    expect(row?.lastOutcome?.reason).toBe('exit_code');
    expect(row?.lastOutcome?.exitCode).toBe(0);
    expect(row?.lastOutcome?.finalTextPreview).toBe('正常收场');
    expect(row?.nextFireAt).toBe(new Date(nowMs + 600_000).toISOString());
    expect(spawns).toBe(1);
  });
});

/**
 * claim 先行条件判占（04 §12 律 3 67 轮批注乙）：乙案并存形态（OS cron
 * 分拍与引擎定时器在 next_fire_at 同刻唤醒）下，双侧「读行判定 → goal
 * wake/用户行解析 → setActive」均不盖对方唤醒段（wake 读全量会话日志百
 * ms-秒级窗）——check-then-act 双穿、activePid 恒空、双双 landed → 同
 * goal 会话双进程双 run。修：判定过即条件 UPDATE 原子判占（SQLite 单写者
 * 下两进程 UPDATE 串行恰一胜者）、wake 移 claim 后；未落地/让位/异常形
 * 回卷清账 settleGated。
 */
describe('claim 先行条件判占（67 轮批注乙）', () => {
  it('dao.claimActive 乐观锁原子性：两连接同期望 null 判占恰一胜；旧值接管形同律（修前红：无此方法）', () => {
    // 两独立连接开同库（跨进程形——SQLite 单写者下两 UPDATE 串行恰一胜者）
    const dbPath = join(dir, 'claim.db');
    const s1 = openStore({
      dbPath,
      dataDir: join(dir, 'd1'),
      secretKey: ephemeralSecretKey(),
      migrations: [SCHEDULER_MIGRATION],
    });
    const s2 = openStore({
      dbPath,
      dataDir: join(dir, 'd2'),
      secretKey: ephemeralSecretKey(),
      migrations: [SCHEDULER_MIGRATION],
    });
    try {
      const svc1 = createSchedulerService({
        db: s1.sqlite(),
        now: () => new Date(nowMs).toISOString(),
        warn,
        pathExists: () => true,
      });
      svc1.service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
      const dao2 = new JobsDao(s2.sqlite(), warn);
      const t = new Date(nowMs).toISOString();
      // 同期望 null 并发判占：恰一胜一败
      const w1 = svc1.dao.claimActive('j', 910001, t, t, null);
      const w2 = dao2.claimActive('j', 910002, t, t, null);
      expect(w1).toBe(true); // 首判占胜
      expect(w2).toBe(false); // 竞速负者（WHERE IS NULL 不匹配已占位）
      expect(dao2.get('j')?.activePid).toBe(910001);
      // 接管形：期望=在册旧值 → 覆写胜（死/超钟残账自愈）；期望=陈旧值 → 败
      expect(dao2.claimActive('j', 910003, t, t, 910001)).toBe(true);
      expect(svc1.dao.claimActive('j', 910004, t, t, 910001)).toBe(false);
      expect(dao2.get('j')?.activePid).toBe(910003);
    } finally {
      s1.close();
      s2.close();
    }
  });

  /** 双引擎装配（同库同 dao、异注入 pid——乙案并存双实例形；runner 悬挂可计数） */
  function assembleDualEngine(): {
    service: SchedulerService;
    dao: JobsDao;
    engineA: SchedulerEngine;
    engineB: SchedulerEngine;
    countA: { n: number };
    countB: { n: number };
  } {
    store = openStore({
      dbPath: join(dir, 'dual.db'),
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
    // 悬挂形 runner（在飞窗——settled 永不落，测试只断言起跑计数与账面）。
    // 句柄 pid = 注入的本引擎 pid（对齐生产形——甲案 in-process runner 句柄
    // pid 恒 = 宿主 pid，spawn 后记账覆写幂等不换主）
    const makeRunner = (counter: { n: number }, pid: number): RunnerFactory => ({
      async spawn() {
        counter.n += 1;
        return {
          pid,
          kill: () => undefined,
          settled: new Promise<RunOutcome>(() => {}),
        };
      },
    });
    const countA = { n: 0 };
    const countB = { n: 0 };
    const clock = () => new Date(nowMs).toISOString();
    const engineA = createSchedulerEngine({
      dao,
      runner: makeRunner(countA, 910001),
      now: clock,
      warn,
      timers: new FakeTimers(),
      isPidAlive: () => true, // 互见活体（乙案并存形——占用面判定真值）
      pid: 910001,
    });
    const engineB = createSchedulerEngine({
      dao,
      runner: makeRunner(countB, 910002),
      now: clock,
      warn,
      timers: new FakeTimers(),
      isPidAlive: () => true,
      pid: 910002,
    });
    return { service, dao, engineA, engineB, countA, countB };
  }

  it('乙案并存窗双穿收口：两引擎（异 pid）同 due 行同刻 sweep → 恰一 fire、败方让位 gated（修前红：判定窗不盖对方唤醒段双双 spawn 2）', async () => {
    const { service, dao, engineA, engineB, countA, countB } = assembleDualEngine();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engineA.start();
    engineB.start();
    advance(10 * 60_000 + 1000);
    engineA.sweep();
    engineB.sweep(); // 同刻分拍（OS cron 与引擎定时器同拍唤醒形）
    await drainMicrotasks();
    // 修后：恰一 fire；修前红锚：双穿双跑（2 spawns）
    expect(countA.n + countB.n).toBe(1);
    const row = dao.get('j');
    expect(row?.lastOutcome?.reason).toBe('gated'); // 败方让位照记结局
    expect(row?.lastOutcome?.error).toContain('让位');
    expect([910001, 910002]).toContain(row?.activePid); // 胜者占用面在册
  });

  it('胜者在飞悬挂：他引擎同刻/再拍 sweep 不 fire 不抢占——让位反复记 gated、占用面保持胜者 pid', async () => {
    const { service, dao, engineA, engineB, countA, countB } = assembleDualEngine();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    engineA.start();
    engineB.start();
    advance(10 * 60_000 + 1000);
    // A 先起跑（悬挂在飞——claim 已落 activePid=910001）
    engineA.sweep();
    await drainMicrotasks();
    expect(countA.n).toBe(1);
    expect(dao.get('j')?.activePid).toBe(910001);
    // B 在 A 在飞窗内 sweep 同行 → 让位不 fire（runner 计数不增）
    engineB.sweep();
    await drainMicrotasks();
    expect(countB.n).toBe(0);
    const row = dao.get('j');
    expect(row?.lastOutcome?.reason).toBe('gated');
    expect(row?.lastOutcome?.error).toContain('另一进程实例正在运行');
    expect(row?.activePid).toBe(910001); // 让位不覆写胜者占用
    // 再拍 belt 巡检同律（在飞窗内反复让位——不抢占不双跑）
    engineB.sweep();
    await drainMicrotasks();
    expect(countB.n).toBe(0);
    expect(dao.get('j')?.activePid).toBe(910001);
  });
});

/**
 * 清账对偶律（04 §12 律 3 68 轮批注丙——判占者方清己账）：claimActive 条件
 * 判占的对偶缺位——修前引擎尾段 finally 清账 / start() 僵行清扫清账两腿均
 * 无条件 setActive，可抹他进程新落 claim（被抹后该实例真在飞而行面 idle →
 * 第三进程再判占同名双跑）。收口 = clearActiveIf(name, expectPid) 条件
 * UPDATE：期望匹配方真清、易主即弃清不抹。
 */
describe('清账对偶律（68 轮批注丙——判占者方清己账）', () => {
  it('dao.clearActiveIf 条件清账：期望匹配真清（changes=1）；易主弃清（changes=0）不抹新 claim——claimActive 的对偶位（修前红：无此方法）', () => {
    const { service, dao } = assemble();
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const t = new Date(nowMs).toISOString();
    dao.claimActive('j', 700001, t, t, null); // 占位在册
    expect(dao.clearActiveIf('j', 700001, t)).toBe(true); // 己账真清
    expect(dao.get('j')?.activePid).toBeNull();
    expect(dao.get('j')?.activeStartedAt).toBeNull();
    dao.claimActive('j', 700002, t, t, null); // 他进程新占
    expect(dao.clearActiveIf('j', 700001, t)).toBe(false); // 期望陈旧（易主）——弃清不抹
    expect(dao.get('j')?.activePid).toBe(700002); // 新 claim 保住
  });

  it('红锁A：start 僵行清扫——快照→清账窗内他进程接管落新 pid 后，清扫弃清弃结算不抹新 claim（修前红：无条件清账抹成 null + 给在飞行记 killed 结局）', () => {
    // daoWrap 注入位（既有 seam）：包 dao.list——真 list 返回快照（activePid=999）
    // 后立即以 expect=999 条件判占落 777，确定性压缩「快照→清账窗内接管」
    // （真身窗 = list 返回到清账语句之间的竞速窗）
    let tookOver = false;
    const { service, dao, engine } = assemble({
      isPidAlive: () => false, // 快照 pid 999 判死（死账形）
      wallTimeoutMs: 30_000,
      daoWrap: (raw) =>
        new Proxy(raw, {
          get(target, prop) {
            if (prop === 'list') {
              return (...args: Parameters<JobsDao['list']>) => {
                const rows = target.list(...args);
                const t = new Date(nowMs).toISOString();
                tookOver = target.claimActive('j', 777, t, t, 999);
                return rows;
              };
            }
            return Reflect.get(target, prop) as unknown;
          },
        }),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const old = new Date(nowMs - 60_000).toISOString();
    dao.setActive('j', 999, old, old); // 死 + 超钟残账（快照观察面）
    engine.start();
    expect(tookOver).toBe(true); // 窗内接管确落（expect=999 胜）
    const row = dao.get('j');
    expect(row?.activePid).toBe(777); // 修前红锚：无条件清账抹成 null
    expect(row?.activeStartedAt).not.toBeNull(); // 新 claim 起跑钟保住
    expect(row?.lastOutcome).toBeNull(); // 易主整让——不给他进程在飞行记 killed 结局
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('僵行清扫让位'));
  });

  it('红锁B：fireRowTail 尾段清账——A 悬挂被 B 接管后 A 尾段不抹 B 新 claim（修前红：无条件清账抹成 null）', async () => {
    // 真 JobsDao 双引擎（pid 注缝 111/222——乙案并存双实例形）
    store = openStore({
      dbPath: join(dir, 'clear-tail.db'),
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
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const clock = () => new Date(nowMs).toISOString();
    // A 引擎 runner：settled 悬挂 + 测试可控放行（句柄 pid = A 注缝 pid——甲案
    // 同值形：spawn 后记账覆写幂等不换主）
    let spawnedA = 0;
    let resolveA!: (o: RunOutcome) => void;
    const runnerA: RunnerFactory = {
      async spawn() {
        spawnedA += 1;
        return {
          pid: 111,
          kill: () => undefined,
          settled: new Promise<RunOutcome>((r) => {
            resolveA = r;
          }),
        };
      },
    };
    const runnerB: RunnerFactory = {
      async spawn() {
        return { pid: 222, kill: () => undefined, settled: new Promise<RunOutcome>(() => {}) };
      },
    };
    const engineA = createSchedulerEngine({
      dao,
      runner: runnerA,
      now: clock,
      warn,
      timers: new FakeTimers(),
      pid: 111,
    });
    const engineB = createSchedulerEngine({
      dao,
      runner: runnerB,
      now: clock,
      warn,
      timers: new FakeTimers(),
      pid: 222,
    });
    // A 起跑（manual 直通）：claim 落 111 → 悬挂在 handle.settled
    const pa = engineA.fireNow('j', 'manual');
    await vi.waitFor(() => {
      expect(spawnedA).toBe(1);
      expect(dao.get('j')?.activePid).toBe(111);
    });
    // B 接管（A 账鲜活未超钟——让位判定 !expired 短路不拦，残账判定过即
    // 条件判占 expect=111 落 222——同 claimActive 接管形）
    const pb = engineB.fireNow('j', 'manual');
    await vi.waitFor(() => expect(dao.get('j')?.activePid).toBe(222));
    // 放行 A 尾段：A 收场清账面对的是 B 的新 claim——不得抹
    resolveA({ trigger: 'manual', reason: 'exit_code', exitCode: 0, finishedAt: clock() });
    const outcomeA = await pa;
    expect(outcomeA.reason).toBe('exit_code'); // A 自身结算照走（settle 行为本笔不动）
    expect(dao.get('j')?.activePid).toBe(222); // 修前红锚：A 尾段无条件清账抹成 null
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('清账让位'));
    void pb; // B 悬挂在飞不收场（悬挂 promise 同 assembleDualEngine 形——进程收尾自理）
  });
});

/**
 * 清账对偶律枚举位收口（04 §12 律 3 69 轮补笔——枚举非穷尽）：一切己方清账
 * 写位（引擎 spawn 拒绝回卷）与自覆写写位同律——清账走 clearActiveIf(己 pid)
 * 条件形；期望值口径 = 本 fire 末次**成功**写入值（记账号瞬态失败不计——残账
 * 留 claim 值，清账期望随库面真值走）。
 */
describe('清账对偶律枚举位（69 轮补笔——spawn 回卷条件对偶 + claimedPid 末次成功写入值口径）', () => {
  it('红锁C2：spawn 拒绝回卷条件对偶——claim→spawn 窗内他实例接管（777）后回卷弃清不抹（修前红：无条件清账抹成 null）', async () => {
    let tookOver = false;
    const { service, dao, engine } = assemble({
      pid: 111, // 注缝异 pid——claim 落 111 后窗内注入他实例接管
      spawnOverride: () => Promise.reject(new Error('spawn-boom')),
      daoWrap: (raw) =>
        new Proxy(raw, {
          get(target, prop) {
            if (prop === 'claimActive') {
              return (name: string, claimPid: number, startedAt: string, updatedAt: string, expect: number | null) => {
                const won = target.claimActive(name, claimPid, startedAt, updatedAt, expect);
                // 窗内接管注入：本引擎 claim 落 ownPid（111）后立即以 expect=111
                // 条件判占落 777——「claim→spawn 窗内他实例对死/超钟残账接管」的
                // 确定性压缩形（真身窗 = claim 返回到 spawn 拒绝回卷之间）
                if (won && expect === null && claimPid === 111) {
                  tookOver = target.claimActive(name, 777, startedAt, updatedAt, 111);
                }
                return won;
              };
            }
            return Reflect.get(target, prop) as unknown;
          },
        }),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const outcome = await engine.fireNow('j', 'manual');
    expect(tookOver).toBe(true); // 窗内接管确落（expect=111 胜）
    expect(outcome.reason).toBe('spawn'); // spawn 结局照结算（既有行为不变）
    expect(dao.get('j')?.activePid).toBe(777); // 修前红锚：无条件回卷清账抹成 null
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('回卷清账让位')); // 让位留痕
  });

  it('红锁C4：claimedPid 口径 = 末次成功写入值——记账号瞬态失败后尾段按 claim 值清账（修前红：clearActiveIf(句柄 pid) 失配残 ownPid 账 + 误报易主）', async () => {
    // 独立装配（local warn——「无易主措辞」负断言不受共享 warn 他测试遗留调用干扰）
    store = openStore({
      dbPath: join(dir, 'c4-claim.db'),
      dataDir: join(dir, 'data'),
      secretKey: ephemeralSecretKey(),
      migrations: [SCHEDULER_MIGRATION],
    });
    const localWarn = vi.fn();
    const { service, dao: rawDao } = createSchedulerService({
      db: store.sqlite(),
      now: () => new Date(nowMs).toISOString(),
      warn: localWarn,
      pathExists: () => true,
    });
    // daoWrap 注入位：记账号条件覆写 claimActive（写句柄 pid 900001 时）恒抛
    // ——瞬态失败形（claim 值 ownPid 在库、记账号未覆写——期望值口径的真值
    // 面）。70 轮件E 起记账号走 claimActive 条件覆写（修前 seam 为 setActive）
    const dao = new Proxy(rawDao, {
      get(target, prop) {
        if (prop === 'claimActive') {
          return (name: string, claimPid: number, startedAt: string, updatedAt: string, expect: number | null) => {
            if (claimPid === 900001) throw new Error('SQLITE_BUSY: 测试注入记账号写锁');
            return target.claimActive(name, claimPid, startedAt, updatedAt, expect);
          };
        }
        return Reflect.get(target, prop) as unknown;
      },
    });
    const runner = fakeRunner();
    const engine = createSchedulerEngine({
      dao,
      runner,
      now: () => new Date(nowMs).toISOString(),
      warn: localWarn,
      timers: new FakeTimers(),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    // claim 值（本进程 pid）在库——记账号瞬态失败未覆写为句柄 pid
    expect(dao.get('j')?.activePid).toBe(processPid);
    expect(localWarn).toHaveBeenCalledWith(expect.stringContaining('起跑记账失败')); // 瞬态失败降 warn 续 fire 流（既有行为）
    runner.resolve(0);
    const outcome = await p;
    expect(outcome.reason).toBe('exit_code');
    expect(dao.get('j')?.activePid).toBeNull(); // 修前红锚：clearActiveIf(900001) 失配残 ownPid 账
    // 修前误报「已易主」（实为己方 claim 值残账非易主）——修后无此措辞
    expect(localWarn).not.toHaveBeenCalledWith(expect.stringContaining('已易主'));
  });
});

/**
 * claim 面代际盲区（04 §12 律 3 69 轮批注丁——同 pid 换代形）：/reload 换代
 * 后新代引擎同 process.pid——修前让位判（activePid ≠ ownPid 才入判）对旧代
 * 在飞占用同值短路、claimActive(expect=ownPid) 同值直通 → 新旧两代并发双跑。
 * 扩形：activePid === ownPid 而本代在飞注册表不知该名 → 视同他占入恒活/超钟
 * 判定（同 pid 恒活：未超钟让位 gated、超钟接管）。
 */
describe('换代残窗（69 轮批注丁——claim 面代际盲区）', () => {
  it('双引擎同 pid（111）：A 悬挂在飞、B 同名 fire → B 让位 gated（前代语义）零 spawn；A 收场按己账清（修前红：同值直通 claim 双跑 spawn）', async () => {
    store = openStore({
      dbPath: join(dir, 'gen-window.db'),
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
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const clock = () => new Date(nowMs).toISOString();
    let countA = 0;
    let countB = 0;
    let resolveA!: (o: RunOutcome) => void;
    // A（旧代）runner：句柄 pid = 引擎 pid（甲案同值形——记账覆写幂等不换主）
    const runnerA: RunnerFactory = {
      async spawn() {
        countA += 1;
        return {
          pid: 111,
          kill: () => undefined,
          settled: new Promise<RunOutcome>((r) => {
            resolveA = r;
          }),
        };
      },
    };
    const runnerB: RunnerFactory = {
      async spawn() {
        countB += 1;
        return { pid: 111, kill: () => undefined, settled: new Promise<RunOutcome>(() => {}) };
      },
    };
    const engineA = createSchedulerEngine({
      dao,
      runner: runnerA,
      now: clock,
      warn,
      timers: new FakeTimers(),
      pid: 111,
    });
    const engineB = createSchedulerEngine({
      dao,
      runner: runnerB,
      now: clock,
      warn,
      timers: new FakeTimers(),
      pid: 111,
    });
    // A（旧代）起跑悬挂：claim 落 111、记账号覆写 111（幂等）——占用面在场
    const pa = engineA.fireNow('j', 'manual');
    await vi.waitFor(() => {
      expect(countA).toBe(1);
      expect(dao.get('j')?.activePid).toBe(111);
    });
    // B（新代）同名 fire：activePid=111 同值——修前让位判同值短路直通
    // claimActive(expect=111) 双跑；修后本代注册表不知该名视同他占 → 同 pid
    // 恒活未超钟 → 让位 gated（前代语义）
    const pb = engineB.fireNow('j', 'manual');
    await drainMicrotasks();
    expect(countB).toBe(0); // 修前红锚：同值直通 spawn（双跑）
    const outcomeB = await pb;
    expect(outcomeB.reason).toBe('gated');
    expect(outcomeB.error).toContain('前代'); // 前代实例在飞语义（批注丁文案锚）
    expect(dao.get('j')?.lastOutcome?.reason).toBe('gated'); // 让位照记结局
    expect(dao.get('j')?.activePid).toBe(111); // 让位不覆写占用面
    // 放行 A 收场：尾段按末次成功写入值（111）清己账——行面终清 null
    resolveA({ trigger: 'manual', reason: 'exit_code', exitCode: 0, finishedAt: clock() });
    const outcomeA = await pa;
    expect(outcomeA.reason).toBe('exit_code');
    expect(dao.get('j')?.activePid).toBeNull();
  });
});

/**
 * removeJob 在飞 warn 观察位（69 轮件E）：行 activePid 非空时删行 = 悬挂 fire
 * 的收场结算将无处落账（行已删）；若他进程重建同名行，旧 fire 收场的结算/
 * 清账可能回写新行（账实错配）。纯观察 warn 留痕不拒删——拒删会使悬挂 fire
 * 把 rm 锁死（在飞窗可长达墙钟 30min）。
 */
describe('removeJob 在飞 warn 观察位（69 轮件E）', () => {
  it('删在飞行：warn 留痕（任务名+pid+结算去向语义）且行照删（修前红：零留痕）', () => {
    const { service, dao } = assemble();
    service.addJob({ name: 'fly-job', schedule: 'every:10m', prompt: 'p', enabled: true });
    const t = new Date(nowMs).toISOString();
    dao.setActive('fly-job', 999, t, t); // 在飞占用（他实例形——activePid 非空）
    service.removeJob('fly-job');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('删除在飞任务「fly-job」（activePid 999')); // 修前红锚：零留痕
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('收场结算将无处落账')); // 结算去向语义
    expect(dao.get('fly-job')).toBeUndefined(); // 不拒删——行已删
  });
});

/**
 * 记账号自覆写位条件化（04 §12 律 3 批注丙 69 轮补笔「枚举非穷尽：一切
 * 自覆写写位同律」——70 轮件E）：引擎起跑记账号修前无条件 setActive 覆写，
 * 可抹 claim→记账号窗内他实例经 claimActive 接管落的新 pid（被抹后该实例
 * 真在飞而行面归本引擎假账——跨进程在飞判定失明）。收口 = 覆写走
 * claimActive(expect=durablePid) 条件形（期望值 = 本刻 durablePid——己方
 * 末次成功写入值，claim 基线 ownPid）；changes=0 即易主——warn 让位留痕 +
 * durablePid 不升值（清账期望随库面真值走，尾段失配自然弃清）。生产不可
 * 达（69 轮闸已逻辑闭合——claim→记账号窗内活跃占用皆本引擎所写；本笔系
 * 防御性对偶收口，与 --tick 起跑记账覆写〔run-entry〕同律）。
 */
describe('记账号自覆写条件化（70 轮件E——claim→记账号窗内易主不抹新占用）', () => {
  it('红锁E：claim→记账号窗内他实例接管（777）后记账号弃覆写——777 在场 + warn 让位留痕 + 尾段清账失配弃清（修前红：setActive 覆写抹 777）', async () => {
    let tookOver = false;
    const { service, dao, engine, runner } = assemble({
      pid: 111, // 注缝异 pid——claim 落 111 后窗内注入他实例接管
      daoWrap: (raw) =>
        new Proxy(raw, {
          get(target, prop) {
            if (prop === 'claimActive') {
              return (name: string, claimPid: number, startedAt: string, updatedAt: string, expect: number | null) => {
                const won = target.claimActive(name, claimPid, startedAt, updatedAt, expect);
                // 窗内接管注入（69 轮 C2 同手法）：本引擎 claim 落 ownPid（111）
                // 后立即以 expect=111 条件判占落 777——「claim→记账号窗内他实例
                // 对死/超钟残账接管」的确定性压缩形（真身窗 = claim 返回到
                // 记账号覆写之间）
                if (won && expect === null && claimPid === 111) {
                  tookOver = target.claimActive(name, 777, startedAt, updatedAt, 111);
                }
                return won;
              };
            }
            return Reflect.get(target, prop) as unknown;
          },
        }),
    });
    service.addJob({ name: 'j', schedule: 'every:10m', prompt: 'p', enabled: true });
    const p = engine.fireNow('j', 'manual');
    await vi.waitFor(() => expect(runner.requests).toHaveLength(1));
    expect(tookOver).toBe(true); // 窗内接管确落（expect=111 胜——777 已在册）
    // 记账号已过（spawn 续段同步落）——占用面须仍是他实例新 claim
    //（修前红锚：无条件 setActive 覆写成句柄 pid 900001）
    expect(dao.get('j')?.activePid).toBe(777);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('起跑记账让位')); // 让位留痕
    runner.resolve(0);
    const outcome = await p;
    expect(outcome.reason).toBe('exit_code'); // 自身结算照走（settle 行为不动）
    // 尾段清账失配弃清（期望 durablePid=111 vs 库面 777）——他实例占用终在场
    expect(dao.get('j')?.activePid).toBe(777);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('清账让位'));
  });
});
