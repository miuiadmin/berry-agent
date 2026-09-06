/**
 * Job 注册表机器（04 §10——ctx.jobs 的注册表面）。
 *
 * 进程内状态，终态不镜像落库（明文豁免条款——durable 面由各消费件自落）。
 * 状态机 running →（可选 stopping）→ 唯一终态 completed/killed/failed；
 * first-wins：首个终态落定即封，后续结算静默弃；done promise 永不 reject
 * （等待方只处理终值，异常面走 failed 终态不走红 Promise）。
 *
 * 归属围栏：条目带 owner sessionId——会话关闭按 owner 收口其在飞 Job
 * （打断/杀并落 killed）。registerKind 未登记种类拒 JOB_KIND_UNKNOWN。
 * 活体通知 job_settled（总线词，内存直推——emit 注入位，装配根接线到
 * context 事件总线并预注册词汇）。终态条目保序保留帽 256 FIFO（进程
 * 生命周期内跨会话有界——供 UI 回看与结算对账，超帽即弃最老）。
 */
import {
  BaseError,
  type JobEntry,
  type JobKind,
  type JobSettledEvent,
  type JobStatus,
  type JobTerminal,
} from '../contracts/index.js';

/** 终态条目保序保留帽（04 §10——FIFO 截断） */
export const JOB_RETENTION_CAP = 256;

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
  /** 登记种类型（装载期调用——subagent/process/issue 各消费件自登） */
  registerKind(kind: JobKind): void;
  /** 种类是否已登记（装配断言/诊断面） */
  hasKind(kind: JobKind): boolean;
  /** 注册在飞 Job（并行帽按 kind 计在飞数；owner 围栏由收口面执法） */
  register(input: { kind: JobKind; name: string; owner: string }): JobHandle;
  /** 按 owner 收口在飞 Job（会话关闭——打断/杀并落 killed；返回收口条目） */
  closeOwner(owner: string): Promise<readonly JobEntry[]>;
  /** 条目总览（在飞 + 保留终态，注册序；终态帽 256 FIFO） */
  list(): readonly JobEntry[];
  /** 在飞（running/stopping）清单（finish gate 对账①核对面） */
  running(): readonly JobEntry[];
  /** 单条目查（在飞与保留均查——结算对账面） */
  get(id: string): JobEntry | undefined;
}

/** 机器内部条目（句柄的私产——外部只见快照） */
interface LiveJob {
  entry: JobEntry;
  resolveDone: (terminal: JobTerminal) => void;
}

/**
 * 建 Job 注册表。并发语义：单进程内 JS 单线执行保证 register/settle/
 * closeOwner 的检查-落定区间原子（无 await 穿插）；done promise 链与
 * emit 异步腿在终态落定后异步推进，不回染状态机。
 */
export function createJobRegistry(options: JobRegistryOptions = {}): JobRegistry {
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const kinds = new Set<JobKind>();
  /** 在飞条目（注册序） */
  const live = new Map<string, LiveJob>();
  /** 终态保留列（注册序 FIFO——帽 256 截尾） */
  const settledHistory: JobEntry[] = [];
  let idSeq = 0;

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

  return {
    registerKind(kind) {
      kinds.add(kind);
    },
    hasKind(kind) {
      return kinds.has(kind);
    },
    register(input) {
      if (!kinds.has(input.kind)) {
        throw new BaseError(
          'JOB_KIND_UNKNOWN',
          `Job kind「${input.kind}」未登记——装载期先 registerKind（词汇注册表纪律）`,
        );
      }
      const limit = options.parallelLimits?.[input.kind];
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
      const job: LiveJob = { entry, resolveDone };
      live.set(id, job);
      return {
        get entry() {
          return job.entry;
        },
        done,
        stop() {
          // 协作停止请求：仅 running 态置 stopping（结算权归 runner——stop
          // 不直接终态）；已终态/stopping 零动作（幂等）
          if (job.entry.status === 'running') {
            job.entry = { ...job.entry, status: 'stopping' };
          }
        },
        settle(terminal) {
          return finalize(job, terminal);
        },
      };
    },
    async closeOwner(owner) {
      const owned = [...live.values()].filter((job) => job.entry.owner === owner);
      for (const job of owned) {
        // 归属收口：打断/杀并落 killed（detail 载归因——会话关闭收口）
        finalize(job, { status: 'killed', detail: `会话 ${owner} 关闭——归属围栏收口` });
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
}

/** 终态判定读面（状态词汇闭集外判——呈现/对账面共用） */
export function isTerminalStatus(status: JobStatus): status is Extract<JobStatus, 'completed' | 'killed' | 'failed'> {
  return status === 'completed' || status === 'killed' || status === 'failed';
}
