/**
 * Job 注册表机器（04 §10——ctx.jobs 的注册表面）。
 *
 * 进程内状态，终态不镜像落库（明文豁免条款——durable 面由各消费件自落）。
 * 状态机 running →（可选 stopping）→ 唯一终态 completed/killed/failed；
 * first-wins：首个终态落定即封，后续结算静默弃；done promise 永不 reject
 * （等待方只处理终值，异常面走 failed 终态不走红 Promise）。
 *
 * 归属围栏：条目带 owner sessionId——会话关闭按 owner 收口其在飞 Job
 * （打断/杀并落 killed）。registerKind 未登记种类拒 JOB_KIND_UNKNOWN；
 * 登记带 kind 归属记录（五役 d3-1——03 §2.2 五役执法补笔：宿主直调 =
 * 宿主席归属、bindForPlugin fork 绑定注入插件 id——ownerOfKind 查询面供
 * trigger starter 谱系闸判「宿主/他插件预登记 kind 不可复用」）+ def 帽槽
 * （五役 d3-2——登记期 parallelLimits 并入 per-kind 帽表即执法）。
 * 六役 CL-C 执法补笔（03 §2.2 第九面）：① 帽值归属律——异主重登不夺籍
 * 亦不夺帽（def 随籍 first-wins，同主重登 last-write 照旧）；② fork 绑面
 * register 的 owner 由宿主绑定闭包注入、非调用方自报（自报形系缺陷）；
 * ③ def 值域运行期校验 fail-loud（parallelLimits 非负有限——违例拒
 * JOB_DEF_INVALID，02 §5.3 补登笔；kind 词汇开放面照旧——「登怪词」不拒
 * 「用未登词」拒）。
 * 活体通知 job_settled（总线词，内存直推——emit 注入位，装配根接线到
 * context 事件总线并预注册词汇）。终态条目保序保留帽 256 FIFO（进程
 * 生命周期内跨会话有界——供 UI 回看与结算对账，超帽即弃最老）。
 */
import { BaseError, type JobEntry, type JobKind, type JobSettledEvent, type JobTerminal } from '../contracts/index.js';

/** 终态条目保序保留帽（04 §10——FIFO 截断） */
export const JOB_RETENTION_CAP = 256;

/**
 * 宿主席归属标记（五役 d3-1）：宿主直调 registerKind（装配序自登
 * trigger/subagent 等 + host 接线腿）= 宿主位归属；bindForPlugin fork 绑定面
 * 注入插件 id 为生态归属。starter 谱系闸以归属记录判复用拒。
 * 值取 'HOST'（大写）——刻意落在合法插件 id 字符集（manifest PLUGIN_ID_RE
 * 仅小写/数字/连字符）之外的 id 语法外哨兵：防第三方插件 id 恰为 'host'
 * 时归属值与宿主席不可区分（五役复核 minor 收口——谱系执法对单 id 失效）。
 */
export const JOB_KIND_HOST_OWNER = 'HOST';

/**
 * registerKind def 形（03 §2.2「Job 登记面」def 槽——行号免锚；五役 d3-2 兑现：修前码面
 * 单参签名静默丢 def 实参）。def 随籍 first-wins（六役 CL-C ①——03 §2.2 第九面
 * 帽值归属律）：同主重登 def 后写胜出、异主重登 def 整体不落。
 */
export interface JobKindDef {
  /** per-kind 并行帽（与构造期 options.parallelLimits 同表并入——登记期值生效即执法，同主重登后写胜出、异主不落） */
  readonly parallelLimits?: number;
}

/**
 * parallelLimits 值域校验单点（六役 CL-C ③——03 §2.2 第九面 + 02 §5.3
 * JOB_DEF_INVALID 补登笔）：非负有限数。JS 直调形无 TS 位兜底——运行期
 * fail-loud；构造期 options.parallelLimits 与登记期 def.parallelLimits 同
 * helper 同律（单源复用）。
 */
function assertParallelLimit(value: number, source: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BaseError(
      'JOB_DEF_INVALID',
      `parallelLimits 值域违例拒（${source} = ${String(value)}）——须非负有限数（03 §2.2 第九面六役 CL-C ③；02 §5.3）`,
    );
  }
}

/** job_settled 活体通知注入位（装配根接 context 总线——词汇预注册归装配） */
export type JobSettledEmitter = (event: JobSettledEvent) => Promise<void> | void;

/** Job 注册表构造选项 */
export interface JobRegistryOptions {
  /** 时钟（epoch ms——缺省 Date.now；测试可注固定钟） */
  readonly now?: () => number;
  /** Job 并行帽（按 kind 分帽——04 §10 注册表面口；缺省无帽，值随 issue 件落码批定） */
  readonly parallelLimits?: Partial<Record<JobKind, number>>;
  /** job_settled 活体通知发射位（缺省零动作——纯逻辑腿无总线） */
  readonly emit?: JobSettledEmitter;
  /** warn 面（缺省 console.warn——first-wins 静默弃等诊断） */
  readonly warn?: (message: string) => void;
}

/** 在飞 Job 句柄（settle/stop 的操作面 + done 等待面） */
export interface JobHandle {
  /** 条目快照（状态随生命周期演进；终态后不可变） */
  readonly entry: JobEntry;
  /** 终值等待（永不 reject——04 §10） */
  readonly done: Promise<JobTerminal>;
  /** 协作停止请求（running → stopping；已终态零动作） */
  stop(): void;
  /**
   * 结算（first-wins）：首个终态落定即封、发射 job_settled、移入保留列；
   * 后续结算静默弃（返回 false——竞速收口）。
   */
  settle(terminal: Omit<JobTerminal, 'at'>): boolean;
}

/** Job 注册表（ctx.jobs 服务面本体） */
export interface JobRegistry {
  /**
   * 登记种类型（装载期调用——subagent/issue 各消费件自登；exec 子进程治理
   * 不走 Job 表，无自有 kind——六役勘正笔）。def 帽槽（03 §2.2「Job 登记面」
   * ——五役 d3-2）：登记期 parallelLimits 并入 per-kind 帽表即执法（与构造期
   * options.parallelLimits 同表）。
   */
  registerKind(kind: JobKind, def?: JobKindDef): void;
  /** 种类是否已登记（装配断言/诊断面） */
  hasKind(kind: JobKind): boolean;
  /** 注册在飞 Job（并行帽按 kind 计在飞数；owner 围栏由收口面执法） */
  register(input: {
    kind: JobKind;
    name: string;
    owner: string;
    /** 协作中止路由（04 §10 定形：stop 置 stopping 后调用——路由到该 Job 托管 run 的中止真源；异常 warn 隔离） */
    onStop?: () => void;
  }): JobHandle;
  /** 按 owner 收口在飞 Job（会话关闭——打断/杀并落 killed；返回收口条目） */
  closeOwner(owner: string): Promise<readonly JobEntry[]>;
  /** 条目总览（在飞 + 保留终态，注册序；终态帽 256 FIFO） */
  list(): readonly JobEntry[];
  /** 在飞（running/stopping）清单（finish gate 对账①核对面） */
  running(): readonly JobEntry[];
  /** 单条目查（在飞与保留均查——结算对账面） */
  get(id: string): JobEntry | undefined;
}

/**
 * 插件可见 jobs 窄面（03 §2.2 第九面六役执法补笔 ④——2026-09-15）：fork
 * 绑面自报位除名两枚——closeOwner/bindForPlugin 不入插件面。收口动词宿主
 * 单方执掌（插件卸载 disposer 与会话 dispose 两路宿主闭包单源调用）：fork
 * 面暴露 closeOwner(owner) 即任意 owner 收口直通、bindForPlugin(another)
 * 即为他人绑定直通，均系 in-process 同特权纵深防御缺口。基面 JobRegistry
 * 维持原成员集（宿主自用/测试替身不受影响）——除名只发生在 fork 绑面形状。
 */
export interface JobsPluginFace {
  /** 登记种类型（fork 绑定携本插件 id 入 kind 归属记录——starter 谱系闸判籍面；exec 子进程治理不走 Job 表、无自有 kind——六役勘正笔） */
  registerKind(kind: JobKind, def?: JobKindDef): void;
  /** 种类是否已登记（装配断言/诊断面） */
  hasKind(kind: JobKind): boolean;
  /** kind 归属查询（谱系执法读面）：宿主直调 = 宿主席、fork 绑定 = 插件 id；未登记 undefined */
  ownerOfKind(kind: JobKind): string | undefined;
  /**
   * 注册在飞 Job 得句柄（并行帽按 kind 计在飞数）。input.owner 参数保留在
   * 签名里但语义 = 宿主绑定闭包固化注入——自报值不采信（六役 CL-C ②）。
   */
  register(input: {
    kind: JobKind;
    name: string;
    owner: string;
    /** 协作中止路由（04 §10 定形：stop 置 stopping 后调用——路由到该 Job 托管 run 的中止真源；异常 warn 隔离） */
    onStop?: () => void;
  }): JobHandle;
  /** 条目总览（在飞 + 保留终态，注册序；终态帽 256 FIFO） */
  list(): readonly JobEntry[];
  /** 在飞（running/stopping）清单（finish gate 对账①核对面） */
  running(): readonly JobEntry[];
  /** 单条目查（在飞与保留均查——结算对账面） */
  get(id: string): JobEntry | undefined;
}

/**
 * 谱系执法扩展面（五役 d3-1）：createJobRegistry 产物独有——基面 JobRegistry
 * 维持原成员集（既有结构实现/替身〔service.test captureHandles 等〕不因执法
 * 腿扩面被迫跟随）；跨模块窄面消费以结构位拾取（trigger starter 谱系闸的
 * ownerOfKind / plugin-boot fork 绑定的 bindForPlugin）。
 */
export interface KindOwningJobRegistry extends JobRegistry {
  /**
   * kind 归属查询（谱系执法读面）：宿主直调 registerKind = 宿主席
   * （JOB_KIND_HOST_OWNER）、bindForPlugin fork 绑定 = 插件 id；未登记
   * undefined。消费位 = trigger starter 谱系闸。
   */
  ownerOfKind(kind: JobKind): string | undefined;
  /**
   * fork 级绑定（'jobs' 席位 fork 绑定，'secrets' 席同构先例）：返回委托
   * 真身的注册表视图，改写位两枚（六役 CL-C ② 后）——registerKind 携
   * 本插件 id（kind 归属记录）+ register 的 owner 由绑定闭包固化注入
   * （调用方自报值不采信）；宿主直调真身 = 宿主席归属。自报位除名两枚
   * （2026-09-15 ④ 笔）——closeOwner/bindForPlugin 不入 fork 绑面
   * （宿主单方执掌动词）。plugin-boot 装载序逐插件 fork provide 'jobs'
   * 消费（共享根 provideJobsService 真身不动——Kahn 可满足判与宿主消费
   * 面走真身）。
   */
  bindForPlugin(pluginId: string): JobsPluginFace;
}

/** 机器内部条目（句柄的私产——外部只见快照） */
interface LiveJob {
  entry: JobEntry;
  resolveDone: (terminal: JobTerminal) => void;
  /** 协作中止路由位（register 受纳——stop 置 stopping 后调用） */
  onStop?: () => void;
}

/**
 * 建 Job 注册表（产物 = 谱系执法扩展面 KindOwningJobRegistry——kind 归属
 * 记录 + fork 绑定，五役 d3-1）。并发语义：单进程内 JS 单线执行保证
 * register/settle/closeOwner 的检查-落定区间原子（无 await 穿插）；done
 * promise 链与 emit 异步腿在终态落定后异步推进，不回染状态机。
 */
export function createJobRegistry(options: JobRegistryOptions = {}): KindOwningJobRegistry {
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  /**
   * kind 登记册 + 归属记录（单源——五役 d3-1：keyset 即归属面，宿主直调 =
   * 宿主席、fork 绑定注入插件 id）。原独立 kinds Set 并入本 Map（双簿必漂移）。
   */
  const kindOwners = new Map<JobKind, string>();
  /** per-kind 并行帽表（构造期 options.parallelLimits 并入 + 登记期 def 值同主后写胜出——五役 d3-2 同表律；异主重登不落〔六役 ①〕） */
  const kindLimits = new Map<JobKind, number>();
  if (options.parallelLimits !== undefined) {
    for (const kind of Object.keys(options.parallelLimits) as JobKind[]) {
      const limit = options.parallelLimits[kind];
      // 构造期值域同律（单源 helper——六役 ③）：坏值建表即拒（装配期 fail-loud）
      if (limit !== undefined) {
        assertParallelLimit(limit, `options.parallelLimits[${kind}]`);
        kindLimits.set(kind, limit);
      }
    }
  }
  /** 在飞条目（注册序） */
  const live = new Map<string, LiveJob>();
  /** 终态保留列（注册序 FIFO——帽 256 截尾） */
  const settledHistory: JobEntry[] = [];
  let idSeq = 0;

  /**
   * 登记单点（宿主直调与 fork 绑定共用——五役 d3-1）：归属 first-wins
   * （首登者定籍——重登同主幂等、异主不夺籍仅 warn 可观测，词汇面维持
   * Set 语义）。def 帽值随籍 first-wins（六役 CL-C ①——03 §2.2 第九面帽值
   * 归属律）：同主重登 def 后写胜出照旧；异主重登 def 整体不落（含
   * parallelLimits——第三方改写宿主/他件帽值系缺陷，仅维持既有 warn 路径）。
   * 值域校验前置（六役 ③）：def.parallelLimits 违例即拒——不半落登记册。
   */
  const registerKindOwned = (owner: string, kind: JobKind, def?: JobKindDef): void => {
    if (def?.parallelLimits !== undefined) assertParallelLimit(def.parallelLimits, `def[${kind}]`);
    const existing = kindOwners.get(kind);
    if (existing === undefined) {
      kindOwners.set(kind, owner);
    } else if (existing !== owner) {
      // 异主重登：不夺籍亦不夺帽（六役 ①）——def 整体不落直接返回
      warn(`Job kind「${kind}」已归属 ${existing}——${owner} 重登不夺籍（首登者定籍，03 §2.2 五役执法补笔）`);
      return;
    }
    if (def?.parallelLimits !== undefined) kindLimits.set(kind, def.parallelLimits);
  };

  const countRunning = (kind: JobKind): number => {
    let n = 0;
    for (const job of live.values()) if (job.entry.kind === kind) n += 1;
    return n;
  };

  /** 落终态（first-wins 单点）：改条目、resolve done、移保留列、发射通知 */
  const finalize = (job: LiveJob, terminal: Omit<JobTerminal, 'at'>): boolean => {
    if (job.entry.terminal !== undefined) {
      warn(`Job ${job.entry.id} 已终态 ${job.entry.terminal.status}——后续结算 ${terminal.status} 静默弃（first-wins）`);
      return false;
    }
    const full: JobTerminal = { ...terminal, at: now() };
    // 条目快照换新（外部持有的旧快照保持终态前视图——快照语义非活引用）
    job.entry = { ...job.entry, status: full.status, terminal: full };
    live.delete(job.entry.id);
    settledHistory.push(job.entry);
    if (settledHistory.length > JOB_RETENTION_CAP) settledHistory.shift();
    job.resolveDone(full);
    // 活体通知异步腿不阻塞结算序（emit 异常隔离——通知失败不反卷终态）
    void Promise.resolve(options.emit?.({ entry: job.entry })).catch(() => undefined);
    return true;
  };

  /**
   * 协作停止内部单点（stop 与 closeOwner 共用）：置 stopping + 路由 onStop。
   * 路由异常 warn 隔离不反卷状态机（04 §10 定形——中止路由失联不废停止语义）。
   */
  const stopInternal = (job: LiveJob): void => {
    if (job.entry.status !== 'running') return; // 已终态/stopping 零动作（幂等）
    job.entry = { ...job.entry, status: 'stopping' };
    if (job.onStop !== undefined) {
      try {
        job.onStop();
      } catch (err) {
        warn(
          `Job ${job.entry.id} 协作中止路由抛错（已置 stopping 继续收口）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  // 扩展面具名（KindOwningJobRegistry）——基面消费位按 JobRegistry 结构窄取
  const registry: KindOwningJobRegistry = {
    registerKind(kind, def) {
      // 宿主直调 = 宿主席归属（fork 绑定面经 bindForPlugin 注入插件 id 走同单点）
      registerKindOwned(JOB_KIND_HOST_OWNER, kind, def);
    },
    hasKind(kind) {
      return kindOwners.has(kind);
    },
    ownerOfKind(kind) {
      return kindOwners.get(kind);
    },
    bindForPlugin(pluginId) {
      // fork 对象委托真身（'secrets' 席同构——五役 d3-1）：改写位两枚——
      // registerKind 携本插件 id（kind 归属记录）+ register 的 owner 由宿主
      // 绑定闭包注入（六役 CL-C ②——03 §2.2 第九面：fork 绑面 register 的
      // owner 非调用方自报，自报形系缺陷——冒名他 owner 即绕归属围栏收口；
      // 自报值被忽略，恒以绑定 pluginId 落格）；读面/写面全真身同表（单册
      // 非副本）。自报位除名两枚（2026-09-15 ④ 笔）——closeOwner/
      // bindForPlugin 不入返回视图（收口动词宿主单方执掌，纵深防御）
      return {
        registerKind: (kind, def) => registerKindOwned(pluginId, kind, def),
        hasKind: (kind) => kindOwners.has(kind),
        ownerOfKind: (kind) => kindOwners.get(kind),
        register: (input) => registry.register({ ...input, owner: pluginId }),
        list: () => registry.list(),
        running: () => registry.running(),
        get: (id) => registry.get(id),
      };
    },
    register(input) {
      if (!kindOwners.has(input.kind)) {
        throw new BaseError(
          'JOB_KIND_UNKNOWN',
          `Job kind「${input.kind}」未登记——装载期先 registerKind（词汇注册表纪律）`,
        );
      }
      const limit = kindLimits.get(input.kind);
      if (limit !== undefined && countRunning(input.kind) >= limit) {
        throw new BaseError(
          'JOB_LIMIT_REACHED',
          `Job kind「${input.kind}」在飞数已达并行帽 ${limit}——拒新注册（04 §10 注册表面口）`,
        );
      }
      const id = `job-${++idSeq}`;
      const entry: JobEntry = {
        id,
        name: input.name,
        kind: input.kind,
        owner: input.owner,
        status: 'running',
        startedAt: now(),
      };
      let resolveDone!: (terminal: JobTerminal) => void;
      // done 永不 reject：只 resolve 终值（等待方只处理终值——异常面走
      // failed 终态不走红 Promise）
      const done = new Promise<JobTerminal>((resolve) => {
        resolveDone = resolve;
      });
      const job: LiveJob = { entry, resolveDone, ...(input.onStop !== undefined ? { onStop: input.onStop } : {}) };
      live.set(id, job);
      return {
        get entry() {
          return job.entry;
        },
        done,
        stop() {
          // 协作停止请求：置 stopping + 协作中止路由（结算权归 runner——stop
          // 不直接终态）；已终态/stopping 零动作（幂等）
          stopInternal(job);
        },
        settle(terminal) {
          return finalize(job, terminal);
        },
      };
    },
    async closeOwner(owner) {
      const owned = [...live.values()].filter((job) => job.entry.owner === owner);
      for (const job of owned) {
        // 归属收口两拍（04 §10 定形）：先协作停止（置 stopping + onStop 路由
        // ——「打断」的机构位：run 侧中止回执晚到因 first-wins 静默弃属预期），
        // 再兜底 finalize killed（Job 条目立即终态不悬空；detail 载归因）
        stopInternal(job);
        finalize(job, { status: 'killed', detail: `归属围栏收口（owner ${owner}）` });
      }
      return owned.map((job) => job.entry);
    },
    list() {
      // 在飞在前（注册序）、终态保留在后（FIFO 序）——两侧条目形同源（快照）
      return [...[...live.values()].map((job) => job.entry), ...settledHistory];
    },
    running() {
      return [...live.values()]
        .filter((job) => job.entry.status === 'running' || job.entry.status === 'stopping')
        .map((job) => job.entry);
    },
    get(id) {
      return live.get(id)?.entry ?? settledHistory.find((job) => job.id === id);
    },
  };
  return registry;
}
