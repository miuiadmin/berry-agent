/**
 * host/boot-guard — crash-loop 守卫判定件（04 §5 2026-10-07 无人值守深化批
 * 规范先行定谳②：supervisor 防环连续性——判 **crash-loop 形态本身**，非持久化
 * wakeStreak）。
 *
 * 防环跨进程失效在停靠-唤醒登记重建面的唯一 boot 侧入口 = 自动恢复面两腿
 * （goal 侧 boot 重挂扫描 / issue 侧 boot 停靠扫描）在 crash-loop 下每轮重启
 * 重建唤醒登记——「唤醒→run→超帽停靠→crash→boot 重挂→再唤醒」环的 boot 侧
 * 断点即本守卫辖面（运行期环受进程内三帽 + run 存活约束照常执法，不入辖）。
 *
 * 机制 = durable boot 史单键 + 启动判序：store_state 单键 `host:boot:guard`
 * （kind 'boot-guard'、无 ttl；**同步直写面**——store_state 系 better-sqlite3
 * 同步直写非 write-behind 队列，closer 内写 clean 标记不依赖退出序 flush 步）；
 * 值 = {lastBootAt, cleanExit, shortLiveStreak}。启动判序（assembly 装配序早期
 * 单点判，结果经 CorePluginHostDeps 可选槽 bootRecoveryGuard 传两件——进程
 * boot 判一次全程不变，/reload 换代重读同值）。
 *
 * 自愈三源（定谳④——守卫非永久态）：正常退出（clean 标记翻真）/ 长命猝死
 * （差值 ≥ 阈归零）/ 守卫生效轮长跑后猝死（同前）——「时间自愈 + 人工不受阻」
 * 双路径保证无「永久死亡」面。
 *
 * store face 全注入（结构兼容 persist Store 两法——issue 件 state 注入同形；
 * 内存 Map 可测，单测免库）；host 内部件零新席零新边（boot-failures.ts 先例）。
 */
/** boot 史 durable 单键（store_state key——值位 magic 允许） */
export const BOOT_GUARD_STATE_KEY = 'host:boot:guard';
/** boot 史行 kind 标签（值位 magic） */
export const BOOT_GUARD_STATE_KIND = 'boot-guard';
/**
 * 短命猝死连击生效阈 K（定谳②：K=3 锚三帽 MAX_CONSECUTIVE_WAKES 同值精神；
 **码面缺省参数非契约常数**——测试经 opts.streakLimit 注入覆盖，不设 env 面）。
 */
export const CRASH_LOOP_STREAK_LIMIT = 3;
/**
 * 短命猝死判阈（缺省 10 分钟；**码面缺省参数非契约常数**——测试经
 * opts.shortLiveMs 注入覆盖，不设 env 面）。
 */
export const BOOT_SHORT_LIVE_MS = 10 * 60 * 1000;

/** boot 史行值形（store_state 单键承载） */
export interface BootGuardState {
  /** 上次 boot 判定时点（ms epoch） */
  readonly lastBootAt: number;
  /** 上次进程是否正常退出（clean 位——由退出 closer 翻真） */
  readonly cleanExit: boolean;
  /** 短命猝死连击计数（判后值） */
  readonly shortLiveStreak: number;
}

/**
 * store 注入窄面（结构兼容 persist Store 的 getStoreState/setStoreState 两法
 * ——issue 件 deps.state 用法同形；测试注内存 Map 免库）。
 */
export interface BootGuardStore {
  getStoreState(key: string): { value: unknown } | undefined;
  setStoreState(key: string, value: unknown, options: { kind?: string }): void;
}

/** judgeBootGuard/markCleanExit 可注入参数（缺省真时钟 + 码面缺省阈 + console.warn） */
export interface BootGuardOpts {
  /** 时钟注入面（测试形——缺省 Date.now） */
  now?: () => number;
  /** 短命猝死判阈注入面（测试形——缺省 BOOT_SHORT_LIVE_MS） */
  shortLiveMs?: number;
  /** 生效阈 K 注入面（测试形——缺省 CRASH_LOOP_STREAK_LIMIT） */
  streakLimit?: number;
  /** warn 出口（缺省 console.warn——生产经装配根注入宿主 logger.warn） */
  warn?: (message: string) => void;
}

/**
 * 读旧值并做行形校验（坏形视同缺席——定谳⑤d「值撕裂」归缺席 streak=0 一格，
 * 宁失守卫不误伤：boot 史非真相源，残缺不拦启动序）。
 */
function readPrevState(store: BootGuardStore): BootGuardState | undefined {
  const value = store.getStoreState(BOOT_GUARD_STATE_KEY)?.value;
  if (typeof value !== 'object' || value === null) return undefined; // 非对象/缺席
  const candidate = value as Partial<BootGuardState>;
  if (
    typeof candidate.lastBootAt !== 'number' ||
    typeof candidate.cleanExit !== 'boolean' ||
    typeof candidate.shortLiveStreak !== 'number'
  ) {
    return undefined; // 字段缺失/类型错——视同缺席
  }
  return candidate as BootGuardState;
}

/**
 * 启动判序（定谳②判序四格——判毕即写新值，启动先自我标记非正常，clean 位
 * 由退出 closer 翻真）：
 *
 *  1. 上次值缺席或 cleanExit=true → 新 streak=0（正常退出自愈源）；
 *  2. cleanExit=false 且 now−lastBootAt ≥ 短命阈（**长命猝死**——天级长跑
 *     常态重启形，L4-1 主修场景不误伤）→ 新 streak=0；
 *  3. cleanExit=false 且差值 < 短命阈（**短命猝死**；时钟回拨差值 ≤ 0 同入
 *     此格保守向——定谳⑤b，最多多守卫一轮，自愈路径在）→ 新 streak=旧+1。
 *
 * 守卫生效 iff **判后** streak ≥ streakLimit——第 K 次短命猝死后的第 K+1 轮
 * 起跳过（off-by-one 定谳明文）。
 *
 * 整体降级律（定谳⑤d）：读失败（抛错）/ 值坏形（视同缺席，不降级）/ 写失败
 * → catch → warn 一行 + return { active: false }（降级 = 本轮不守卫——防线
 * 缺席非恢复断裂，回现行行为）。
 */
export function judgeBootGuard(store: BootGuardStore, opts: BootGuardOpts = {}): { active: boolean } {
  const now = opts.now?.() ?? Date.now();
  const shortLiveMs = opts.shortLiveMs ?? BOOT_SHORT_LIVE_MS;
  const streakLimit = opts.streakLimit ?? CRASH_LOOP_STREAK_LIMIT;
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  try {
    const prev = readPrevState(store);
    // 判序四格（见函数头注——缺席/clean 归零、长命归零、短命累加）
    let streak: number;
    if (prev === undefined || prev.cleanExit) {
      streak = 0; // 格①：上次缺席 / 正常退出——无连击事实
    } else if (now - prev.lastBootAt >= shortLiveMs) {
      streak = 0; // 格②：长命猝死——重启间隔超阈即非 crash-loop 形态
    } else {
      streak = prev.shortLiveStreak + 1; // 格③：短命猝死（含时钟回拨差值 ≤ 0 保守向）
    }
    // 守卫生效 iff 判后值 ≥ K（第 K 次短命猝死后的第 K+1 轮起跳过）
    const active = streak >= streakLimit;
    // 判毕即写新值：启动先自我标记非正常（clean 位由退出 closer 翻真）
    store.setStoreState(
      BOOT_GUARD_STATE_KEY,
      { lastBootAt: now, cleanExit: false, shortLiveStreak: streak },
      {
        kind: BOOT_GUARD_STATE_KIND,
      },
    );
    return { active };
  } catch (err) {
    // 降级 = 本轮不守卫（读抛/写抛——库满/锁/值撕裂皆归此；防线缺席非损坏）
    warn(`crash-loop 守卫判定降级（本轮不守卫，回现行行为）：${err instanceof Error ? err.message : String(err)}`);
    return { active: false };
  }
}

/**
 * 正常退出标记（退出序 closer 装配根注册集之尾位调用——定谳②：尾位最易因
 * drain 总帽尽被跳过，跳过即非正常归类正确——closer 未走完非正常退出）。
 * fn = 写 {cleanExit: true, shortLiveStreak: 0}（同步直写、保留 lastBootAt）。
 *
 * 旧值缺席 = noop（从未判过的库写 clean 无意义）；写失败 catch + warn（保守
 * 向：clean 位保持 false、下轮保守累加——至多多守卫一轮，定谳⑤d）。
 */
export function markCleanExit(store: BootGuardStore, opts: Pick<BootGuardOpts, 'warn'> = {}): void {
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  try {
    const prev = readPrevState(store);
    if (prev === undefined) return; // 旧值缺席（含坏形）——noop（无从保留 lastBootAt 的 clean 写无意义）
    store.setStoreState(
      BOOT_GUARD_STATE_KEY,
      { lastBootAt: prev.lastBootAt, cleanExit: true, shortLiveStreak: 0 },
      {
        kind: BOOT_GUARD_STATE_KIND,
      },
    );
  } catch (err) {
    // 保守向：clean 位保持 false（不写即不翻真）、下轮保守累加——不炸退出序
    warn(
      `crash-loop 守卫 clean 标记写失败（clean 位保持非正常，下轮保守判）：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
