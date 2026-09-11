/**
 * scheduler 引擎（04 §12 缺省甲案：进程内挂钟）。
 *
 * 编舞：轮询求 due 集 → 闸评估（clock 道独辖）→ 执行前抢占（同任务在飞先
 * kill 'preempted' 再起新——同任务不并发双跑）→ runner spawn → 墙钟超时
 * 守卫 → 结算回写（last_fire_at/last_outcome/next_fire_at 推进）。
 *
 * 语义钉死（与 schedule.ts 三钉同源）：
 *   - 错过不重放：start() 重启补推进——启机时既 due 的行静默 advance 到
 *     下一刻（不补跑、只 warn 留痕）；
 *   - gated 拦截也推进：闸拦的行 settleGated 记结局 + advance（不动
 *     last_fire_at——gated 非真跑，冷却闸判据不被污染）；
 *   - manual 道不走闸（用户显式意图）也不受并发帽辖（pi-tick manual 同律）；
 *     帽只辖 clock sweep 的自动并发。
 *
 * claim-then-advance 接线律（04 §12 无人值守执行链定形注③——u-2 落码）：
 * fire 起跑 setActive 记账（activePid = runner 句柄 pid——甲案宿主 pid/
 * 乙案子进程 pid）、settle 清账——「执行前抢占」条款的 durable 对偶（进程
 * 内注册表管进程内防双跑，activePid 管跨进程可见性）；start() 僵行清扫
 * （pid 死 + 超墙钟 → 行回 idle 可重发）+ fire 前跨进程在飞判定（乙案
 * 并存窗让位的引擎侧对偶——见 fireRow）。墙钟 kill 语义由 runner 实装
 * 定义（定形注④两形：进程内实装 = interrupt 协作中止；进程实装 = TERM
 * →KILL）——引擎只认 kill 接口零感知。
 *
 * 定时器全接缝注入（TimerSeam——测试假钟驱动；缺省真身 setTimeout）。
 * 停钟不杀在飞：stop 只摘轮询定时器，在飞实例自然收场照常结算回写
 * （宿主退出编舞若需「杀在飞」属 host 装配批 killAll 编舞，不在本件）。
 */
import { kill as processKill, pid as processPid } from 'node:process';

import { BaseError } from '../contracts/index.js';
import { evaluateGates, type GateFacts } from './gates.js';
import { nextFireAt } from './schedule.js';
import type { JobsDao } from './service.js';
import type { RunnerFactory, RunnerHandle } from './runner.js';
import type { JobRow, RunOutcome, TriggerKind } from './types.js';

/** 墙钟超时缺省（毫秒）——单次 fire 的最长在飞时帽（30min；pi-tick 同量级） */
export const FIRE_WALL_TIMEOUT_MS = 30 * 60_000;
/** 轮询下限（毫秒）——due 等待的定时夹取下限（防零毫秒自旋；every:5s 粒度下无害） */
export const MIN_POLL_MS = 500;
/** 轮询上限（毫秒）——无近期 due 时的 belt 巡检间隔（行可能被外部 enable，最迟此距补觉） */
export const MAX_POLL_MS = 60_000;
/** clock sweep 并发帽缺省（1——单并发保守档：同时至多一个自动任务在飞） */
export const DEFAULT_MAX_CONCURRENT = 1;

/** 定时器接缝（挂钟与墙钟守卫共用——测试假钟全驱动） */
export interface TimerSeam {
  set(ms: number, fn: () => void): unknown;
  clear(handle: unknown): void;
}

/** 缺省真身定时器 */
export function realTimerSeam(): TimerSeam {
  return {
    set(ms, fn) {
      return setTimeout(fn, ms);
    },
    clear(handle) {
      clearTimeout(handle as NodeJS.Timeout);
    },
  };
}

/** 引擎装配依赖 */
export interface SchedulerEngineDeps {
  dao: JobsDao;
  runner: RunnerFactory;
  /** ISO UTC 时钟 */
  now: () => string;
  warn: (message: string) => void;
  /** 闸事实收集器（装配层从宿主面收集；缺省空事实 = 全门放行） */
  gateFacts?: (row: JobRow) => GateFacts;
  /** 定时器接缝（缺省真身） */
  timers?: TimerSeam;
  /** 墙钟超时（缺省 30min） */
  wallTimeoutMs?: number;
  /** clock sweep 并发帽（缺省 1） */
  maxConcurrent?: number;
  /**
   * pid 活死判（u-2——定形注③僵行清扫/跨进程在飞判定的探活面；缺省真身
   * 0 信号探活：ESRCH = 死、EPERM = 活但非己属。测试注假件零真信号）
   */
  isPidAlive?: (pid: number) => boolean;
}

/** scheduler 引擎公开面 */
export interface SchedulerEngine {
  /** 启钟：重启补推进（missed 静默 advance）→ 排首轮轮询 */
  start(): void;
  /** 停钟：只摘轮询定时器（在飞自然收场——见头注） */
  stop(): void;
  /** 立即重排轮询（enable 后外部戳一下——最迟 MIN_POLL_MS 内 sweep 补觉） */
  poke(): void;
  /**
   * 手动巡检一轮：求 due 集 → 逐行闸评估/抢占/fire（并发帽辖）→ 重排定时。
   * 定时器到点的回调即本面；测试与 host 装配可直呼驱动。
   */
  sweep(): void;
  /** 触发单行（manual 道不走闸不受帽；cron 道走闸——OS 后端形态回流编舞用） */
  fireNow(name: string, trigger: TriggerKind): Promise<RunOutcome>;
  /** 在飞实例数（含 manual——观察面） */
  readonly inFlightCount: number;
}

/** 引擎实装 */
export function createSchedulerEngine(deps: SchedulerEngineDeps): SchedulerEngine {
  const dao = deps.dao;
  const runner = deps.runner;
  const now = deps.now;
  const warn = deps.warn;
  const timers = deps.timers ?? realTimerSeam();
  const wallTimeoutMs = deps.wallTimeoutMs ?? FIRE_WALL_TIMEOUT_MS;
  const maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const gateFacts = deps.gateFacts ?? (() => ({}));
  const isPidAlive = deps.isPidAlive ?? realIsPidAlive;

  /** 同名在飞注册表（键=行名——抢占判据面） */
  const active = new Map<string, RunnerHandle>();
  /**
   * 同名起跑预留位（fireRow 入口同步置、收场清）——sweep 判 active ∪ 本位：
   * active.set 落在首个 await（spawn）之后，无预留位时同步连呼 sweep 会
   * 在微任务窗内重复起同名任务（在飞判据穿透）。manual 道不判本位（抢占语义）。
   */
  const reserved = new Set<string>();
  let pollHandle: unknown = null;
  let running = false;
  let sweeping = false;

  /** 下一轮轮询定时（夹取 [MIN_POLL_MS, MAX_POLL_MS]——null earliest 落 MAX belt 巡检） */
  function scheduleNextPoll(): void {
    if (!running) return;
    if (pollHandle !== null) {
      timers.clear(pollHandle);
      pollHandle = null;
    }
    const earliest = dao.earliestNextFire();
    let ms = MAX_POLL_MS;
    if (earliest !== null) {
      const delta = Date.parse(earliest) - Date.parse(now());
      ms = Math.min(Math.max(delta, MIN_POLL_MS), MAX_POLL_MS);
    }
    pollHandle = timers.set(ms, () => {
      pollHandle = null;
      doSweep();
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      // 僵行清扫（定形注③——u-2）：activePid 非空非己的行，pid 死 + 超起跑
      // 墙钟（activeStartedAt + wallTimeoutMs）→ 清账行回 idle + lastOutcome
      // 记回收（settleGated 形不动 last_fire_at——非真跑）。与关系保守判：
      // 活 + 超钟形（pid 复用误判险）不清、下轮 fire 的 setActive 覆写自愈。
      for (const row of dao.list()) {
        if (row.activePid === null || row.activePid === processPid) continue; // 己 pid = 甲案在飞（进程内注册表管辖）
        const startedAtMs = row.activeStartedAt !== null ? Date.parse(row.activeStartedAt) : 0;
        const expired = Date.parse(now()) - startedAtMs > wallTimeoutMs;
        if (!expired || isPidAlive(row.activePid)) continue;
        const outcome: RunOutcome = {
          trigger: 'clock',
          reason: 'killed',
          error: `僵行回收（activePid ${row.activePid} 已死且超墙钟——乙案子进程 kill -9 残账/宿主重启旧账）`,
          finishedAt: now(),
        };
        dao.setActive(row.name, null, null, now());
        dao.settleGated(row.name, outcome, row.nextFireAt, now());
        warn(`[scheduler] 僵行清扫：${row.name}（activePid ${row.activePid} 死 + 超墙钟——行回 idle 可重发）`);
      }
      // 重启补推进：既 due 行静默跳下一刻（错过不重放——warn 留痕不 fire）
      const missed = dao.due(now());
      for (const row of missed) {
        const next = nextFireAt(row.schedule, new Date(now()));
        dao.advanceNextFire(row.name, next, now());
        warn(`[scheduler] 重启补推进：${row.name} 错过到点 ${row.nextFireAt}，跳下一刻 ${next}`);
      }
      scheduleNextPoll();
    },
    stop() {
      running = false;
      if (pollHandle !== null) {
        timers.clear(pollHandle);
        pollHandle = null;
      }
    },
    poke() {
      if (!running) return;
      scheduleNextPoll();
    },
    sweep: doSweep,
    async fireNow(name, trigger) {
      const row = dao.get(name);
      if (!row) throw new BaseError('SCHEDULER_NOT_FOUND', `任务「${name}」不存在（run 幽灵名零行守卫）`);
      return fireRow(row, trigger);
    },
    get inFlightCount() {
      // 观察面诚实律：active.set 落在 spawn 的 await 之后，spawn 已发起但未上
      // 注册表的瞬态窗内单计 active 会给同步观察者假 0（fireRow 已在跑）——
      // 计 active ∪ reserved，「在飞 = 起跑中或已 spawn」。
      return new Set([...active.keys(), ...reserved]).size;
    },
  };

  /**
   * 单行触发共核（clock/manual/cron 三道同编舞）：
   * 抢占同任务旧实例 → 闸评估（clock/cron 道；manual 直通）→ spawn →
   * 墙钟守卫 → 结算回写（gated 走 settleGated 不动 last_fire_at）。
   */
  async function fireRow(row: JobRow, trigger: TriggerKind): Promise<RunOutcome> {
    const name = row.name;
    reserved.add(name); // 同步占位（见 reserved 注释——防 sweep 微任务窗重触）
    try {
      // 执行前抢占：同任务旧实例在飞先杀再起（kill 幂等 + 等收场——同任务不并发双跑）
      const prev = active.get(name);
      if (prev) {
        prev.kill('preempted');
        await prev.settled;
      }
      // 闸评估：manual 道不走（用户显式意图）；clock/cron 道序定五门
      if (trigger !== 'manual') {
        const block = evaluateGates(gateFacts(row), { now: now() });
        if (block) {
          const firedAt = now();
          const next = nextFireAt(row.schedule, new Date(firedAt));
          const outcome: RunOutcome = {
            trigger,
            reason: 'gated',
            gate: block.gate,
            error: block.reason,
            finishedAt: firedAt,
          };
          dao.settleGated(name, outcome, next, now());
          return outcome;
        }
      }
      const firedAt = now();
      // 跨进程在飞判定（定形注③乙案并存窗的引擎侧对偶——u-2）：行 activePid
      // 非空非己且活体未超墙钟 = 乙案子进程（或他宿主）真在飞 → 本轮让位
      // （gated 记结局 + 推进，不 kill 不双跑——跨进程 kill 有 pid 复用误杀
      // 险，「执行前抢占」条款对跨进程实例不越权；子进程侧对偶 = run-entry
      // --tick 让位律，双向对称）。死/超钟形不拦（settle 段覆写自愈）。
      if (row.activePid !== null && row.activePid !== processPid && isPidAlive(row.activePid)) {
        const startedAtMs = row.activeStartedAt !== null ? Date.parse(row.activeStartedAt) : 0;
        const expired = Date.parse(now()) - startedAtMs > wallTimeoutMs;
        if (!expired) {
          const next = nextFireAt(row.schedule, new Date(firedAt));
          const outcome: RunOutcome = {
            trigger,
            reason: 'gated',
            error: `跨进程实例在飞（activePid ${row.activePid}）——本轮让位不双跑`,
            finishedAt: firedAt,
          };
          dao.settleGated(name, outcome, next, now());
          return outcome;
        }
      }
      const handle = await runner.spawn({ row, trigger, wallTimeoutMs });
      active.set(name, handle);
      // claim-then-advance 记账（定形注③）：fire 起跑落 activePid（runner 句柄
      // pid——甲案宿主 pid/乙案子进程 pid）+ 起跑墙钟；settle 清（对偶位）
      if (handle.pid !== null) dao.setActive(name, handle.pid, now(), now());
      // 墙钟超时守卫（kill('timeout')——TERM→宽限→KILL 由 runner 实装升级）
      const wallHandle = timers.set(wallTimeoutMs, () => handle.kill('timeout'));
      let outcome: RunOutcome;
      try {
        outcome = await handle.settled;
      } finally {
        timers.clear(wallHandle);
        active.delete(name);
        dao.setActive(name, null, null, now()); // durable 在飞占用面清账（claim 对偶）
      }
      // next 从结算时刻取下一刻（every 形锚 now——错过不重放同律）；
      // runner 内零跑判定（gated——wake 未落地/分派处理器缺席）同走 settleGated
      // 不动 last_fire_at（与闸拦同律：非真跑不污染冷却闸判据）
      const next = nextFireAt(row.schedule, new Date(now()));
      if (outcome.reason === 'gated') {
        dao.settleGated(name, outcome, next, now());
      } else {
        dao.settleFire(name, firedAt, outcome, next, now());
      }
      return outcome;
    } finally {
      reserved.delete(name);
    }
  }

  /** 巡检体（定时回调与公开 sweep 直呼同体——函数声明提升供 scheduleNextPoll 前向引用） */
  function doSweep(): void {
    if (!running || sweeping) return; // 重入闸：定时回调与手动直呼不叠跑
    sweeping = true;
    try {
      const due = dao.due(now());
      // 帽初值同观察面：起跑预留位（spawn 的 await 前瞬态）也占帽——同帽语义
      let launched = new Set([...active.keys(), ...reserved]).size;
      for (const row of due) {
        // 在飞/起跑预留不重触：settle 前 next_fire_at 仍 due，若重触会自踏
        // 活锁（重复抢占自家实例）——抢占只留给 manual 新实例道。在飞期间
        // 持续 poll 是廉价 belt 巡检（settle 即推进）。
        if (active.has(row.name) || reserved.has(row.name)) continue;
        if (launched >= maxConcurrent) break; // 帽满留 due——下轮 sweep 补觉（定时夹取防自旋）
        launched += 1;
        void fireRow(row, 'clock');
      }
    } finally {
      sweeping = false;
    }
    scheduleNextPoll();
  }
}

/**
 * pid 活死判真身（0 信号探活——不投递信号只验存在性）：ESRCH = 进程不存在
 * （死）；EPERM = 存在但非己属（活——他用户/系统进程照算活体）。run-entry
 * --tick 让位律与引擎清扫/判定共用单源（u-2 定形注③）。
 */
export function realIsPidAlive(pid: number): boolean {
  try {
    processKill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
