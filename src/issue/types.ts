/**
 * core:issue 类型面（03 §10.7——无人值守 issue→PR 编排件；批 16）。
 *
 * 词面独立律（02 §4.1 #27 席 deps = contracts + context）：本件与
 * scheduler/subagent/goal/tools/exec/checkpoint 零 DAG 边——全部兄弟件经
 * **窄面注入**消费（GoalJobsFace 先例同律）：
 * - `IssueJobsFace` 与 subagent JobRegistry 词面独立、结构兼容（组合根直接
 *   传注册表真身，兼容性互证测试在 compat.test.ts）；
 * - `IssueSchedulerFace`（registerPollJob/removePollJob 两动词）经装配闭包
 *   适配 SchedulerService；
 * - `IssueStoreStateFace` 与 persist Store 三法（getStoreState/setStoreState/
 *   deleteStoreState）同名同形——Store 真身直接结构可赋；
 * - `IssueWorktreeFace` 与 tools WorktreeService 结构兼容（create/clean/list/
 *   diffPatch/grant/releaseSession 子面）；
 * - `IssueSessionFace`（headless 起跑面）装配批实装——本批测试假件。
 *
 * context 席边为占位声明（装载态接线随装配批消费——goal 先例同型）。
 */
import type { JobKind, JobTerminal, ToolDefinition } from '../contracts/index.js';

/* ---------------- 常量（缺省值单源——03 §10.7 落码定形注） ---------------- */

/** 轮询挂钟行名（builtin 行——装配 RunnerFactory 对该名程序化分派 pollOnce） */
export const ISSUE_POLL_JOB_NAME = 'issue-poll';

/** 轮询缺省周期（120s——schedule 串形态承 scheduler 词法） */
export const ISSUE_DEFAULT_SCHEDULE = 'every:120s';

/** Job kind issue 并行帽缺省（04 §10 定值注——装配 createJobRegistry parallelLimits 槽用） */
export const ISSUE_PARALLEL_LIMIT_DEFAULT = 2;

/** 每 issue 预算帽缺省（消息条数——实测定值校准挂账） */
export const ISSUE_PER_ISSUE_MESSAGES_DEFAULT = 400;

/** 回执评论补丁字符帽（GitHub 评论体 64KiB 上限内留余量——超限截断注记） */
export const ISSUE_RECEIPT_PATCH_CHARS = 60_000;

/** issue_get 工具上下文帽字节（外部文本进上下文的总闸——出口治理④字段瘦身同律） */
export const ISSUE_CONTEXT_CAP_BYTES = 64 * 1024;

/** webhook 端点路径（POST——`/webhooks/*` 入站外部投递路由族首径；03 §10.7 批 18a-4' 落码定形） */
export const ISSUE_WEBHOOK_ENDPOINT = '/webhooks/issue';

/** webhook 请求体帽（per-route bodyLimitBytes 位——GitHub issue 载荷 64KiB 级 + 元数据余量） */
export const ISSUE_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;

/** GitHub token 凭证名（host 域——03 §10.9「env 与库优先级」c-5 迁移：凭证库
 * 优先、env `BERRY_AGENT_GITHUB_TOKEN` 过渡载体回落——/credentials add
 * github-token <token> 录入即生效） */
export const ISSUE_GITHUB_TOKEN_NAME = 'github-token';

/** webhook HMAC secret 凭证名（host 域——同上律：库优先、env
 * `BERRY_AGENT_ISSUE_WEBHOOK_SECRET` 过渡载体回落） */
export const ISSUE_WEBHOOK_SECRET_NAME = 'issue-webhook-secret';

/** 交付日成功帽缺省（04 §13——mandate maxPerDay 原料；正整数律在
 * normalizeIssueConfig 执法：0/负数/坏形 = 空帽即坏形拒，彻底关停走 HALT
 * 哨兵或撤 consent 不走空帽） */
export const ISSUE_MAX_DELIVERIES_PER_DAY_DEFAULT = 10;

/* ---------------- 配置面（mount config 键——用户可配域） ---------------- */

/** 运行档位（03 §10.7 裁决④⑤：两档可配、缺省草稿先行——fail-closed 缺省律） */
export type IssueMode = 'draft' | 'auto';

/**
 * 件配置（normalizeIssueConfig 产物——坏形不入此形）。repos 槽语义：
 * 精确 `owner/name` 串 = 轮询 + 匹配两用；含 `*` 的 glob = 仅匹配面
 * （webhook 路由判定——轮询无法枚举 glob 域，跳过并在报告计数）。
 */
export interface IssueConfig {
  /** 档位（缺省 'draft'——全自动显式 opt-in） */
  readonly mode: IssueMode;
  /** 轮询周期 schedule 串（缺省 'every:120s'） */
  readonly schedule: string;
  /** 监听仓库域（必填非空——精确串轮询+匹配、glob 仅匹配） */
  readonly repos: readonly string[];
  /** label 白名单（至少一命中——空/缺省 = 该维不约束） */
  readonly labels?: readonly string[];
  /** 指派白名单（至少一命中——空/缺省 = 该维不约束） */
  readonly assignees?: readonly string[];
  /** 每 issue 预算帽（消息条数——缺省 400） */
  readonly perIssueBudgetMessages: number;
  /** 补丁基线分支（diffPatch base——缺省 'main'） */
  readonly baseBranch: string;
  /** 交付日成功帽（04 §13 mandate maxPerDay 原料——缺省 10，正整数律） */
  readonly maxDeliveriesPerDay: number;
}

/* ---------------- 数据面（GitHub 归一形——轮询/webhook 共用） ---------------- */

/** issue 归一形（两触发源收敛同一形——触发源可换、入队纪律不变） */
export interface IssueRef {
  /** `owner/name` */
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly state: 'open' | 'closed';
  /** ISO UTC（GitHub updated_at——轮询水位键） */
  readonly updatedAt: string;
  readonly htmlUrl: string;
}

/** issue 评论归一形（issue_get 工具数据源） */
export interface IssueCommentRef {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

/** dedupeKey（03 §10.7 入队条：`repo#issue`——进程内在飞互斥键非 durable 幂等键） */
export function issueDedupeKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/** worktree 名形（`issue-<n>` 首选、重跑递进 `-r<k>`——分支留史撞名让位） */
export const ISSUE_WORKTREE_NAME_RE = /^issue-\d+(-r\d+)?$/;

/* ---------------- 注入窄面（词面独立律——结构兼容真身） ---------------- */

/**
 * Job 注册表窄面（结构兼容 subagent JobRegistry——组合根传真身；settle/
 * running 收窄到本件消费的子面）。owner 围栏注记：04 §10 定 owner = headless
 * 会话 id，但入队时会话尚未存在（worktree 预建在前）——本批 owner = 合成键
 * `issue:<dedupeKey>`（围栏语义不破：closeOwner(合成键) 收口照常；随装配批
 * session face 实装对齐）。
 */
export interface IssueJobsFace {
  /** 登记种类型（start() 调——漏登记则 register 先红 JOB_KIND_UNKNOWN） */
  registerKind(kind: JobKind): void;
  /** 注册在飞 Job（返回 settle 子面——first-wins 终态封口） */
  register(input: { kind: JobKind; name: string; owner: string }): {
    settle(terminal: Omit<JobTerminal, 'at'>): boolean;
  };
  /** 在飞清单（dedupe 在飞互斥判定源——进程内语义） */
  running(): readonly { readonly name: string }[];
}

/** scheduler 窄面（两动词——装配闭包适配 SchedulerService.addBuiltinJob/removeJob） */
export interface IssueSchedulerFace {
  /** 挂钟行登记（builtin 行——schedule 坏串由 scheduler 守卫响亮拒） */
  registerPollJob(req: { name: string; schedule: string; prompt: string }): unknown;
  /** 摘钟（删行；无行守卫由 scheduler 执） */
  removePollJob(name: string): void;
}

/** store_state 窄面（与 persist Store 三法同名同形——真身直接可赋；轮询水位承载）。读返形 = StoreStateEntry 子集 */
export interface IssueStoreStateFace {
  getStoreState(key: string): { key: string; value: unknown; kind?: string; expiresAt?: number } | undefined;
  setStoreState(key: string, value: unknown, options?: { ttlMs?: number; kind?: string }): void;
  deleteStoreState(key: string): boolean;
}

/** 全局预算窄面（04 §5 日池判——装配批接真身；本批测试假件）。不可负担 = 入队侧 rejected（运行侧停靠是另一形态：paused） */
export interface IssueBudgetFace {
  canAffordIssue(): { ok: boolean; reason?: string };
}

/** worktree 窄面（结构兼容 tools WorktreeService 子面——组合根传真身） */
export interface IssueWorktreeFace {
  create(req: { name: string; baseRef?: string }): Promise<{ name: string; path: string; branch: string }>;
  clean(req: { name: string; force?: boolean }): Promise<{ name: string; path: string }>;
  list(): Promise<readonly { name: string; path: string; branch: string }[]>;
  diffPatch(req: { name: string; baseRef: string }): Promise<string>;
  grant(req: { sessionId: string; path: string }): Promise<void>;
  releaseSession(sessionId: string): string[];
}

/* ---------------- headless 会话面（装配批实装——本批测试假件） ---------------- */

/**
 * 单次 headless run 的结局（04 §10 issue 消费注·Job 收口三因与终态映射的
 * session 侧形态）：
 * - completed：目标达成（messagesUsed 供预算记账）；
 * - failed：run 失败（含每 issue 预算帽耗尽——reason 载明）；
 * - needs-human：无应答者审批拒/写动作无 allowlist 覆盖（04 §9 fail-closed）；
 * - paused：全局日池尽（04 §5 停靠——**不落终态**，待 budget_extended 唤醒；
 *   唤醒接线随装配批）。
 */
export type IssueRunOutcome =
  | { readonly status: 'completed'; readonly messagesUsed: number; readonly summary: string }
  | { readonly status: 'failed'; readonly messagesUsed: number; readonly reason: string }
  | { readonly status: 'needs-human'; readonly messagesUsed: number; readonly reason: string }
  | { readonly status: 'paused'; readonly reason: string };

/** headless 起跑产物（sessionId + 终局 promise——编排层 await 结局收口） */
export interface IssueSessionStartResult {
  readonly sessionId: string;
  readonly outcome: Promise<IssueRunOutcome>;
}

/** headless 会话面（run 流式通道经宿主装配起跑——03 §10.7 运行条；装配批实装） */
export interface IssueSessionFace {
  startHeadless(req: {
    /** 工作目录（worktree canonical 路径——会话绑定 cwd） */
    readonly cwd: string;
    readonly prompt: string;
    /** 每 issue 预算帽（消息条数——run 侧执法并上报 messagesUsed） */
    readonly budgetMessages: number;
    /** 件注册的只读工具面（issue_get 等——随会话装载） */
    readonly tools: readonly ToolDefinition[];
  }): Promise<IssueSessionStartResult>;
}

/* ---------------- 危险闸窄面（04 §13 装配窄面注入——词面独立律） ---------------- */

/**
 * 危险闸窄面（04 §13：auto 档交付腿的预授权执法面）。词面独立律——issue 不
 * import safety（零 DAG 边），本面结构兼容 createDangerGate 产物的装配位
 * 组合子集（compat 互证归测试）；GoalJobsFace 同句式。deliver = 闸包裹的
 * 执行腿（装配位组合「闸判定 + push/create-pr 执行」为单一闭包——消费件只
 * 见窄面不见裸腿，走正门 = 免组装闸序，绕闸 = 刻意行为而非疏忽可达）。
 * 闸拒 = BaseError 携 `DANGER_` 族码上抛（零外联）；过闸外部写失败 = 原错误
 * 直传（allow-failed 已记账）。
 */
export interface IssueDangerFace {
  /** 交付腿：push（推分支至 origin）/ create-pr（REST 开 PR——依赖 push 先成） */
  deliver(req: {
    readonly kind: 'push' | 'create-pr';
    readonly repo: string;
    readonly branch: string;
    /** push 腿 spawn cwd（worktree canonical 路径） */
    readonly worktreePath: string;
    /** create-pr：PR 标题 */
    readonly title?: string;
    /** create-pr：PR 正文 */
    readonly body?: string;
    /** create-pr：基线分支 */
    readonly base?: string;
  }): Promise<{ readonly prNumber?: number; readonly prUrl?: string }>;
  /** consent 签发（人面唯写——/danger approve 承载；绑活体 mandate 哈希） */
  approve(ttlDays?: number): Promise<{ ok: true; expiresAt: number } | { ok: false; message: string }>;
  /** 运维单命令呈现源（/danger status 承载） */
  status(): Promise<IssueDangerStatusFace>;
}

/** 危险闸状态呈现面（/danger status 五呈：mandate/consent/HALT/帽/账本） */
export interface IssueDangerStatusFace {
  readonly consumer: string;
  readonly mandateHash: string;
  readonly mandate: {
    readonly actions: readonly string[];
    readonly targets: readonly string[];
    readonly maxPerDay: number;
  };
  readonly consent: {
    readonly state: 'absent' | 'valid' | 'expired' | 'drifted';
    readonly approvedAt?: string;
    readonly expiresAt?: string;
  };
  readonly halt: { readonly tripped: boolean; readonly firstFiredAt?: string };
  /** 当日帽用量（UTC 日）；链坏 = null（不可派生——拒面恒在） */
  readonly cap: { readonly used: number | null; readonly max: number; readonly day: string };
  readonly ledger: { readonly healthy: boolean; readonly total: number };
}

/* ---------------- 入队结果（回执可见面——不静默丢） ---------------- */

/** 入队裁决结果（duplicate/rejected 的回执可见面：调用方报告 + 日志；终态评论另行）。started 携 dedupeKey——worktree 名在 runOne 异步选定（撞名让位），同步面不可知 */
export type IssueEnqueueResult =
  | { readonly status: 'started'; readonly key: string }
  | { readonly status: 'duplicate'; readonly key: string }
  | { readonly status: 'rejected'; readonly reason: string };
