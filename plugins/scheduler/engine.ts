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
 * fire 起跑 claimActive 条件记账（activePid = runner 句柄 pid——甲案宿主
 * pid/乙案子进程 pid；claimActive(expect=durablePid) 即条件化的 setActive
 * 记账——易主让位不抹他实例新占）、settle 清账——「执行前抢占」条款的
 * durable 对偶（进程内注册表管进程内防双跑，activePid 管跨进程可见性）；
 * start() 僵行清扫
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

import { BaseError } from '../../src/contracts/index.js';
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
  /**
   * 本引擎进程 pid（缺省真身 process.pid——甲案宿主单实例形）。67 轮批注乙
   * 测试注异 pid 模拟乙案并存双实例（同进程内两引擎互视为「他进程」——
   * 跨进程判占/让位判定的测试驱动面）；生产恒缺省。
   */
  pid?: number;
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
  /** 钟在跑（start 置位 / stop 摘除——观察面；挖掘 20 轮 /reload 换代接钟回归锁消费） */
  readonly running: boolean;
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
  // 本实例 pid（缺省真身 process.pid；测试注异 pid 模拟乙案并存双实例——见 deps.pid 注释）
  const ownPid = deps.pid ?? processPid;

  /** 同名在飞注册表（键=行名——抢占判据面） */
  const active = new Map<string, RunnerHandle>();
  /**
   * 同名起跑预留位（fireRow 入口同步置、收场清——计数形）——sweep 判
   * active ∪ 本位：active.set 落在首个 await（spawn）之后，无预留位时同步
   * 连呼 sweep 会在微任务窗内重复起同名任务（在飞判据穿透）。manual 道不判
   * 本位（抢占语义）。计数不交叠 Set：十六役扫 #3 修后同名 body 头尾可重叠
   * （先到者收场尾与后到者关键段并存），Set 单票会被先到者 finally 误清——
   * 计数各持各票，末位收场才真清。
   */
  const reserved = new Map<string, number>();
  /**
   * 同名关键段串行链（十六役扫 #3）：抢占检查→spawn→active.set 注册段按名
   * 互斥（链尾 promise 接力）。修前双 manual /tick 在 kill 宽限窗（秒级）内
   * 并发进入同挂同一 prev.settled、prev 收场后同批微任务先后恢复即各自
   * spawn——同任务双跑 + activePid 账目互毁（先收场者 finally 按键删后者
   * 注册、清后者 durable 占用——跨进程在飞判定失明可叠第三实例；sweep 道
   * 有 reserved 拦、manual 道裸奔——修前假件实证 3 spawns）。互斥使后到者
   * 整段排在先到者注册完成之后：读到的是先到者新实例、抢占语义照常（杀旧
   * 起新），同任务恒串行；settled 序 = 注册序，finally 永远只删更旧实例。
   */
  const nameChains = new Map<string, Promise<unknown>>();

  /** 预留位计数 +1（fireRow 入口同步置） */
  function reserveName(name: string): void {
    reserved.set(name, (reserved.get(name) ?? 0) + 1);
  }

  /** 预留位计数 -1（body 收场清——末位才真出册） */
  function releaseName(name: string): void {
    const n = (reserved.get(name) ?? 1) - 1;
    if (n <= 0) reserved.delete(name);
    else reserved.set(name, n);
  }

  /**
   * 关键段按名入链：空链同步直入（段同步起跑——保 fireRow 原同步可见面：
   * sweep 后同步断言、kill('preempted') 同步落账；段体 async，首个 await
   * 前的执行仍同步）；有在飞段则排其收场后执行（成败都放行——段内自管
   * 错误）。链尾吞错保序不传染。出册在段体 finally 同步落（beginInstance
   * 尾调 stillOwn——promise 反应式出册晚一跳，会让紧随段收场的到达者误排
   * 队丢同步面；被后继顶替则不出册，由后继自理。唯同步全完段〔gated 无
   * await 形〕出册先于注册落——下到达者排一跳微任务后自愈，无同步断言面）。
   */
  function enqueueName<T>(name: string, section: (stillOwn: () => boolean) => Promise<T>): Promise<T> {
    const prev = nameChains.get(name);
    let settle!: Promise<unknown>;
    const stillOwn = () => nameChains.get(name) === settle;
    const run = () => section(stillOwn);
    const next = prev === undefined ? run() : prev.then(run, run);
    settle = next.catch(() => {});
    nameChains.set(name, settle);
    return next;
  }
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
    let ms = MAX_POLL_MS;
    try {
      const earliest = dao.earliestNextFire();
      if (earliest !== null) {
        const delta = Date.parse(earliest) - Date.parse(now());
        ms = Math.min(Math.max(delta, MIN_POLL_MS), MAX_POLL_MS);
      }
    } catch (err) {
      // 下一拍计算读抛错兜底（挖掘 20 轮——earliestNextFire 同为裸同步 dao 读）：
      // 按最大巡检间隔直落 belt 定时重拍（钟不死）。不递归重调本函数——earliest
      // 再读会再抛同错；belt 拍到的 doSweep 自带吞错收口，行照常补觉
      warn(`[scheduler] 下一拍计算异常（按最大巡检间隔兜底重拍）：${err instanceof Error ? err.message : String(err)}`);
      ms = MAX_POLL_MS;
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
      // 活 + 超钟形（pid 复用误判险）不清、下轮 fire 的 claimActive 条件
      // 覆写自愈（自愈路径语义仍真——经 claim 位条件覆写，易主让位不抹新占）。
      for (const row of dao.list()) {
        if (row.activePid === null || row.activePid === ownPid) continue; // 己 pid = 甲案在飞（进程内注册表管辖）
        const startedAtMs = row.activeStartedAt !== null ? Date.parse(row.activeStartedAt) : 0;
        const expired = Date.parse(now()) - startedAtMs > wallTimeoutMs;
        if (!expired || isPidAlive(row.activePid)) continue;
        // 条件清账（68 轮批注丙——清账对偶律）：期望值 = 快照观察到的死 pid。
        // 快照→清账窗内他进程可经 beginInstance 条件判占接管死/超钟残账落新
        // pid——修前无条件清账直接抹其新 claim（被抹后该实例真在飞而行面
        // idle → 第三进程再判占同名双跑）。changes=0 即易主——清账与 settle
        // 双弃整让（settle 会给他进程在飞行记 killed 结局 + 携行快照陈旧
        // next 回写，皆非本引擎该做的事），warn 留痕
        if (!dao.clearActiveIf(row.name, row.activePid, now())) {
          warn(
            `[scheduler] 僵行清扫让位：${row.name}（快照 activePid ${row.activePid} 已易主——他进程已接管残账，本轮弃清弃结算）`,
          );
          continue;
        }
        const outcome: RunOutcome = {
          trigger: 'clock',
          reason: 'killed',
          error: `僵行回收（activePid ${row.activePid} 已死且超墙钟——乙案子进程 kill -9 残账/宿主重启旧账）`,
          finishedAt: now(),
        };
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
      return new Set([...active.keys(), ...reserved.keys()]).size;
    },
    get running() {
      return running; // 观察面直读（start 置位 / stop 摘除）
    },
  };

  /**
   * 单行触发入口（三道共核经此并入）：同名在飞合并（十六役扫 #3）——修前
   * 双 manual /tick 并发直入体内双跑 + activePid 账目互毁（先 settle 者清
   * 账、后 spawn 者覆写）。收场即出册（finally 先于调用方 await 恢复）。
   */
  function fireRow(row: JobRow, trigger: TriggerKind): Promise<RunOutcome> {
    const name = row.name;
    reserveName(name); // 同步占位（见 reserved 注释——防 sweep 微任务窗重触）
    return fireRowTail(row, trigger, name);
  }

  /**
   * 单行触发共核尾段（clock/manual/cron 三道同编舞）：关键段（抢占检查→
   * 闸→spawn→注册）经同名串行链互斥（十六役扫 #3——见 nameChains 注释）；
   * 结算/收场清账在链外——后到者关键段可与先到者收场尾并存（预留位计数
   * 覆盖该重叠窗，sweep 判据不穿透）。
   */
  async function fireRowTail(row: JobRow, trigger: TriggerKind, name: string): Promise<RunOutcome> {
    try {
      const begun = await enqueueName(name, (stillOwn) => beginInstance(row, trigger, stillOwn));
      if (begun.kind === 'done') return begun.outcome; // 闸拦/跨进程让位——已结算直收
      const { handle, firedAt, wallHandle, claimedPid } = begun;
      let outcome: RunOutcome;
      try {
        outcome = await handle.settled;
      } catch (err) {
        // settled 破约折 error 结局照结算（04 §12 律 3 67 轮批注甲——一切收场
        // 形必结算）：runner settled 契约恒 resolve，真拒绝形 = run 回执真拒绝
        // 穿透（scheduler-tick runSession 尾段 submitText 回执——配置坏词
        // THINKING_LEVEL_INVALID 等非瞬态族）。修前裸 await 拒绝穿透 finally
        // 只清账不结算——next 不推进、last_fire_at 恒空（cooldown 闸失判据）
        // → 行持续 due 每 MIN_POLL_MS 重 fire：每拍新 durable 会话无界累积 +
        // 热循环刷屏。折 exit_code/1 error 结局（词形对齐 runSession failed
        // 分支），结算单点不因收场形旁路；外层 doSweep catch 不再是承接面。
        const msg = err instanceof Error ? err.message : String(err);
        outcome = {
          reason: 'exit_code',
          exitCode: 1,
          // 摘要整串截 200（types RunOutcome.error 文档帽——前缀「run 回执拒绝：」
          // 计入帽内，避免 msg 段恰 200 时整串超帽）
          error: `run 回执拒绝：${msg}`.slice(0, 200),
          trigger,
          finishedAt: now(),
        };
      } finally {
        timers.clear(wallHandle);
        active.delete(name);
        // 条件清账（68 轮批注丙——清账对偶律·真对偶位）：期望值 = 本 fire 落账
        // 的占用 pid（claim 时 ownPid、spawn 后记账号覆写为 runner 句柄 pid——
        // 取本 fire 最后写入值；甲案同值幂等、乙案 spawn 形 = 子进程 pid）。A
        // 超钟被 B 接管后 A 尾段修前无条件清账会抹 B 的新 claim（B 真在飞而
        // 行面 idle → 第三进程再判占同名双跑——旧注释自称「claim 对偶」实为
        // 谎，本笔补真对偶）。changes=0 = 易主或已自清（乙案子进程收场自清后
        // 的幂等对账）——留新 claim 不抹；真易主（他 pid 在册）才 warn 留痕，
        // 已自清（NULL）静默不刷屏
        // 清账吞错（挖掘 21 轮件10——fire 起跑记账对偶位同律）：durable 清账
        // 抛错不吞已结算 outcome（穿透即调用方收 reject、结果丢失）——降
        // warn，残留 durable 账由跨进程「死/超钟不拦」+ 僵行清扫自愈
        try {
          if (!dao.clearActiveIf(name, claimedPid, now())) {
            const after = dao.get(name);
            if (after !== undefined && after.activePid !== null) {
              warn(
                `[scheduler] activePid 清账让位（任务 ${name}——占用已易主 pid ${after.activePid}，留新 claim 不抹）`,
              );
            }
          }
        } catch (err) {
          warn(
            `[scheduler] activePid 清账失败（任务 ${name}，降 warn——残留账由僵行清扫自愈）：${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
      releaseName(name);
    }
  }

  /**
   * 关键段产物：起跑注册完（含墙钟守卫柄——随注册同步挂，盖住链跳窗）/
   * 闸拦·跨进程让位已结算（fireRowTail 直收）。claimedPid = 本 fire 落账的
   * durable 占用 pid（claim 时 ownPid、spawn 后记账号覆写为 runner 句柄
   * pid）——尾段条件清账的期望值（68 轮批注丙——判占者方清己账）。
   */
  type BeginResult =
    | {
        readonly kind: 'spawned';
        readonly handle: RunnerHandle;
        readonly firedAt: string;
        readonly wallHandle: unknown;
        readonly claimedPid: number;
      }
    | { readonly kind: 'done'; readonly outcome: RunOutcome };

  /**
   * 关键段（同名链内互斥执行）：执行前抢占同任务旧实例 → 闸评估（clock/cron
   * 道；manual 直通）→ 跨进程在飞判定 + 条件判占（claim 先行——67 轮批注乙）
   * → spawn（拒绝回卷）→ active 注册 + 起跑记账。段内单次抢占检查即完整：
   * 注册在本段尾、持链期间无人能再注册——后来者排在链上，恢复时读到的是
   * 本段新实例（杀旧起新——抢占语义不变）。
   */
  async function beginInstance(row: JobRow, trigger: TriggerKind, stillOwn: () => boolean): Promise<BeginResult> {
    const name = row.name;
    // try/finally 与段体同函数（收场出册零一跳——await 包装会把 finally 推迟
    // 一个微任务，紧随段收场的到达者即丢同步可见面）
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
          return { kind: 'done', outcome };
        }
      }
      const firedAt = now();
      // 判定基面重读（67 轮批注乙）：上方抢占可能 await 过收场尾（旧实例
      // finally 已清 activePid），行快照 row 系 doSweep/fireNow 读面——占用
      // 判据与判占期望值须取当下库面（陈旧快照会误让位/误期望致 claim 恒败）
      const current = dao.get(name) ?? row;
      // 跨进程在飞判定（定形注③乙案并存窗的引擎侧对偶——u-2）+ 换代残窗
      // 扩形（69 轮批注丁——claim 面代际盲区）：占用判据 = activePid 非空且
      //（异 pid 或〔同 pid 而本代在飞注册表不知该名〕）。同 pid 形 = /reload
      // 换代后旧代引擎在飞占用（claim/清账以 pid 值为期不辨代际——修前让位
      // 判对旧代占用同值短路、claimActive(expect=ownPid) 同值直通 → 新旧两
      // 代并发双跑）。「本代注册表不知该名」的证词只认 active（在飞注册表
      // ——占用判据要回答的是「这笔在册占用是否本代所写」）：reserved/
      // nameChains 描述的是本次尝试自身（fireRow 入口同步占位——判定时恒在
      // 场），计入即令扩形对恰好要收口的跨引擎形永不触发；本实例 claim→注册
      // 窗不受误伤——判定在本段先于 claimActive 且同名关键段经 nameChains
      // 互斥（段内无第二判读位），自身 claim 值不会被本段读到。跨进程不
      // kill（pid 复用误杀险——「执行前抢占」条款对跨进程实例不越权）；
      // 死/超钟残账不拦——经下方条件判占接管（接管失败 = 他实例竞速先占，
      // 同走让位收口）。
      if (current.activePid !== null && (current.activePid !== ownPid || !active.has(name))) {
        const startedAtMs = current.activeStartedAt !== null ? Date.parse(current.activeStartedAt) : 0;
        const expired = Date.parse(now()) - startedAtMs > wallTimeoutMs;
        // 同 pid 形恒活（本进程在跑即该 pid 的活体证明——换代新旧两代同
        // process.pid，探活无信息量直接恒活）；异 pid 形照探活（乙案并存窗
        // 真值）
        const occupiedAlive = current.activePid === ownPid || isPidAlive(current.activePid);
        if (occupiedAlive && !expired) {
          const next = nextFireAt(row.schedule, new Date(firedAt));
          const outcome: RunOutcome = {
            trigger,
            reason: 'gated',
            // 同 pid 形注明前代语义（批注丁——让位留痕可诊断）；异 pid 形维持
            // 既有文案（67 轮批注乙锁形）
            error:
              current.activePid === ownPid
                ? `前代实例正在运行（activePid ${current.activePid} 与本实例同 pid——换代残窗，本代注册表不知该名）——本轮让位不双跑`
                : `另一进程实例正在运行（activePid ${current.activePid}）——本轮让位不双跑`,
            finishedAt: firedAt,
          };
          dao.settleGated(name, outcome, next, now());
          return { kind: 'done', outcome };
        }
      }
      // 条件判占（67 轮批注乙——claim 先行）：判定过即条件 UPDATE 原子判占，
      // 期望值 = 判定基面的 activePid（null = 空面首占；死/超钟残账 = 在册
      // 旧值接管）。竞速负者（他实例已判占/已自清）让位不双跑——乙案并存窗
      // check-then-act 双穿（修前形：读行判定 → spawn/wake 长窗 → 无条件
      // setActive 追认）的收口位：spawn/wake 移 claim 后，双侧恰一胜者。
      if (!dao.claimActive(name, ownPid, firedAt, firedAt, current.activePid)) {
        const next = nextFireAt(row.schedule, new Date(firedAt));
        const outcome: RunOutcome = {
          trigger,
          reason: 'gated',
          error: '另一进程实例已判占（activePid 竞速）——本轮让位不双跑',
          finishedAt: firedAt,
        };
        dao.settleGated(name, outcome, next, now());
        return { kind: 'done', outcome };
      }
      // durable 占用 pid 的末次成功写入值追踪（69 轮补笔——期望值口径 = 本
      // fire 末次**成功**写入值）：claim 落 ownPid 为基线；记账号成功写句柄
      // pid 后升值；瞬态失败/句柄 pid 缺席留原值与库面一致（残账留 claim 值，
      // 清账期望随库面真值走）。修前静态取句柄 pid：记账号瞬态失败时库面仍
      // ownPid → 尾段 clearActiveIf(句柄 pid) 失配残 ownPid 己账无家清 + 误报
      // 易主（实为己方残账非他进程接管）
      let durablePid = ownPid;
      // spawn 拒绝回卷（67 轮批注乙——claim 先行对偶）：修前裸 await 拒绝穿
      // 透 fireRow 由 doSweep catch-warn 兜——行零结算永 due 每拍重试；claim
      // 已落则占用滞留死账。折 spawn 结局（types 词域真源——「子进程没起来」
      // 专值；CLI abortTick/scheduler-tick 同概念形同词；gated 留让位/零跑判定
      // 族——推进 next 行下拍再试）+ 回卷清账（吞错同下方记账位——清账失败
      // 由僵行清扫自愈，结局仍照结算）
      let handle: RunnerHandle;
      try {
        handle = await runner.spawn({ row, trigger, wallTimeoutMs });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          // 条件回卷清账（68 轮批注丙 + 69 轮补笔——清账对偶律·防御性对偶位）：
          // 期望值 = 本引擎 claim 落账的 ownPid（生产形 claim→spawn 窗内
          // activePid 恒 = ownPid，条件形幂等不换语义；exotic 拓扑窗内他实例
          // 对死/超钟残账条件判占接管时弃清不抹新 claim——旧注释自称「claim
          // 对偶」实为无条件清账，本笔勘正为真对偶）。changes=0 即易主——
          // warn 让位留痕
          if (!dao.clearActiveIf(name, ownPid, now())) {
            warn(`[scheduler] activePid 回卷清账让位（任务 ${name}——占用已易主，留新占用不抹）`);
          }
        } catch (clearErr) {
          warn(
            `[scheduler] activePid 回卷清账失败（任务 ${name}，降 warn——残留账由僵行清扫自愈）：${clearErr instanceof Error ? clearErr.message : String(clearErr)}`,
          );
        }
        const rollbackNext = nextFireAt(row.schedule, new Date(now()));
        const outcome: RunOutcome = {
          trigger,
          reason: 'spawn',
          error: `run 起跑失败（spawn 拒绝）：${msg}`.slice(0, 200),
          finishedAt: now(),
        };
        dao.settleGated(name, outcome, rollbackNext, now());
        return { kind: 'done', outcome };
      }
      active.set(name, handle);
      // claim-then-advance 记账（定形注③）：spawn 成功后条件覆写自占位为
      // runner 句柄 pid（甲案 = 宿主 pid 同值幂等；乙案 spawn 形 = 子进程
      // pid 真值）+ 起跑墙钟；settle 清（对偶位）。
      // 记账吞错（挖掘 21 轮件10——与 settle 对偶位同律）：dao 瞬态错
      // （SQLITE_BUSY/IOERR——跨进程写 jobs 表系 04 §12 设计内场景）穿透即
      // fireRow 抛——active 表项已落而 tail 未返 spawned 不接管清账 → 表项
      // 泄漏 + 行被 sweep 的 active.has 判据恒 skip（饿死）。记账是观察面
      // （跨进程在飞判定有「死/超钟不拦」自愈兜底），降 warn 不杀 fire 流
      try {
        if (handle.pid !== null) {
          // 条件自覆写（04 §12 律 3 批注丙 69 轮补笔「枚举非穷尽：一切自覆写
          // 写位同律」——70 轮件E 收口，与 --tick 起跑记账覆写〔run-entry〕同
          // 律）：期望值 = 本刻 durablePid（己方末次成功写入值——claim 基线
          // ownPid）。修前无条件 setActive 可抹窗内他实例经 claimActive 接管
          // 落的新 pid（被抹后该实例真在飞而行面归本引擎假账——跨进程在飞
          // 判定失明）。changes=0 即易主——warn 让位留痕 + durablePid 不升值
          // （清账期望随库面真值走，尾段失配自然弃清）。生产不可达（69 轮闸
          // 已逻辑闭合——claim→记账号窗内活跃占用皆本引擎所写；本笔系防御性
          // 对偶收口，exotic 拓扑回穿免役）
          if (dao.claimActive(name, handle.pid, now(), now(), durablePid)) {
            durablePid = handle.pid; // 写成功才升值（69 轮补笔——末次成功写入值口径；瞬态失败留 claim 值）
          } else {
            warn(`[scheduler] activePid 起跑记账让位（任务 ${name}——占用已易主，留新占用不抹）`);
          }
        }
      } catch (err) {
        warn(
          `[scheduler] activePid 起跑记账失败（任务 ${name}，降 warn 继续——durable 账由 settle 段清账/僵行清扫自愈）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // 墙钟超时守卫（kill('timeout')——TERM→宽限→KILL 由 runner 实装升级）。
      // 随注册同步挂（段体内——不落 fireRowTail 的链返回 await 后一跳）：守卫
      // 面更宽（盖住段收场到尾段接管间的链跳窗），同步可见面与旧 fireRow 齐
      const wallHandle = timers.set(wallTimeoutMs, () => handle.kill('timeout'));
      // 本 fire 落账的 durable 占用 pid（末次成功写入值——claim 的 ownPid 或
      // 记账号成功后的句柄 pid；记账号瞬态失败/句柄 pid 缺席留 ownPid）——
      // 尾段条件清账的期望值（68 轮批注丙：清账腿只清己账，易主即弃清不抹
      // 新 claim）
      const claimedPid = durablePid;
      return { kind: 'spawned', handle, firedAt, wallHandle, claimedPid };
    } finally {
      // 段体收场同步出册（仍是在飞段则让位后继自理——见 enqueueName 注释）
      if (stillOwn()) nameChains.delete(name);
    }
  }

  /** 巡检体（定时回调与公开 sweep 直呼同体——函数声明提升供 scheduleNextPoll 前向引用） */
  function doSweep(): void {
    if (!running || sweeping) return; // 重入闸：定时回调与手动直呼不叠跑
    sweeping = true;
    try {
      try {
        const due = dao.due(now());
        // 帽初值同观察面：起跑预留位（spawn 的 await 前瞬态）也占帽——同帽语义
        let launched = new Set([...active.keys(), ...reserved.keys()]).size;
        for (const row of due) {
          // 在飞/起跑预留不重触：settle 前 next_fire_at 仍 due，若重触会自踏
          // 活锁（重复抢占自家实例）——抢占只留给 manual 新实例道。在飞期间
          // 持续 poll 是廉价 belt 巡检（settle 即推进）。
          if (active.has(row.name) || reserved.has(row.name)) continue;
          if (launched >= maxConcurrent) break; // 帽满留 due——下轮 sweep 补觉（定时夹取防自旋）
          launched += 1;
          // 火种链防崩（G1）：fireRow 体内 dao 结算写库等任一拒绝，void 调用
          // 无接即 unhandledRejection——崩溃编舞 exit(1) 会连杀在飞会话（无人
          // 值守宿主不可接受）。catch 记账（行名+火种）不重抛：单行单次失败
          // 不阻轮询编舞（结算未推进的行下轮 sweep 照常补觉）。67 轮批注甲/乙
          // 后 runner spawn/settled 拒绝已折结局照结算（不再依赖本 catch 补觉
          // ——本位收容面收窄为 dao 写库等残余异常）。
          void fireRow(row, 'clock').catch((err) => {
            warn(
              `[scheduler] fire 失败（任务 ${row.name}，clock 道）：${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        // 轮询腿异常不炸进程（挖掘 20 轮——G1 同理由唯独未施于本位）：dao.due
        // 瞬态错（busy 越过 busy_timeout / IOERR——跨进程写 jobs 表系 04 §12
        // 设计内场景）穿透定时回调即 uncaughtException，崩溃编舞 exit(1) 连杀
        // 在飞会话。吞进 warn 下一拍重试（obs/service 定时腿同律）；due 未推进
        // 的行由重臂后的下一拍 sweep 照常补觉
        warn(`[scheduler] 轮询拍异常（吞进 warn 下一拍重试）：${err instanceof Error ? err.message : String(err)}`);
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
