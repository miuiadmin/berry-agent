/**
 * issue 服务测试——全假件装配（真件互证归 compat.test.ts）：
 * 入队纪律四闸（capabilities/closed/dedupe/budget）、runOne 编舞五结局
 * （draft·completed/auto·completed/failed/needs-human/paused）、worktree
 * 撞名让位、dirty 保留、编舞异常兜底、孤儿扫描、start/stop。
 */
import { BaseError } from '../contracts/index.js';
import { describe, expect, it, vi } from 'vitest';
import type { GithubBackend } from './github.js';
import { createIssueService } from './service.js';
import type {
  IssueBudgetFace,
  IssueConfig,
  IssueJobsFace,
  IssueRunOutcome,
  IssueSchedulerFace,
  IssueSessionFace,
  IssueSessionStartResult,
  IssueStoreStateFace,
  IssueWorktreeFace,
} from './types.js';

/* ---------------- 假件族 ---------------- */

/** Job 注册表假件（settle 记录——first-wins 模拟归真件语义） */
function fakeJobs() {
  const kinds: string[] = [];
  const runningNames = new Set<string>();
  const settled: { name: string; terminal: { status: string; detail?: string } }[] = [];
  const jobs: IssueJobsFace = {
    registerKind: (kind) => kinds.push(kind),
    register: (input) => {
      runningNames.add(input.name);
      return {
        settle: (terminal) => {
          if (!runningNames.has(input.name)) return false; // 已终态——first-wins
          runningNames.delete(input.name);
          settled.push({ name: input.name, terminal });
          return true;
        },
      };
    },
    running: () => [...runningNames].map((name) => ({ name })),
  };
  return { jobs, kinds, settled, runningNames };
}

/** scheduler 假件（挂/摘钟记录） */
function fakeScheduler() {
  const registered: { name: string; schedule: string }[] = [];
  const removed: string[] = [];
  const scheduler: IssueSchedulerFace = {
    registerPollJob: (req) => registered.push({ name: req.name, schedule: req.schedule }),
    removePollJob: (name) => removed.push(name),
  };
  return { scheduler, registered, removed };
}

/** store_state 假件（Map 直通——返回形与真身 StoreStateEntry 同形） */
function fakeState(): IssueStoreStateFace & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    getStoreState: (key) => (map.has(key) ? { key, value: map.get(key) } : undefined),
    setStoreState: (key, value) => map.set(key, value),
    deleteStoreState: (key) => map.delete(key),
  };
}

/** worktree 假件（调用记录 + 可注行为覆写） */
function fakeWorktree(behavior?: {
  existsFirst?: number; // 前 N 次 create 折 FS_WORKTREE_EXISTS（撞名让位测试）
  dirtyOnClean?: boolean; // clean 折 FS_WORKTREE_DIRTY
}) {
  const created: { name: string }[] = [];
  const cleaned: string[] = [];
  const granted: { sessionId: string; path: string }[] = [];
  const released: string[] = [];
  const grantMap = new Map<string, Set<string>>();
  let createCalls = 0;
  const wt: IssueWorktreeFace = {
    create: async (req) => {
      createCalls += 1;
      if (behavior?.existsFirst !== undefined && createCalls <= behavior.existsFirst) {
        throw new BaseError('FS_WORKTREE_EXISTS', `[FS_WORKTREE_EXISTS] 撞名（第 ${createCalls} 次）`);
      }
      created.push({ name: req.name });
      return { name: req.name, path: `/wt/${req.name}`, branch: req.name };
    },
    clean: async (req) => {
      if (behavior?.dirtyOnClean) throw new BaseError('FS_WORKTREE_DIRTY', '[FS_WORKTREE_DIRTY] 未提交变更');
      cleaned.push(req.name);
      return { name: req.name, path: `/wt/${req.name}` };
    },
    list: async () => created.map((c) => ({ name: c.name, path: `/wt/${c.name}`, branch: c.name })),
    diffPatch: async (req) => `diff --git a/f b/f（base=${req.baseRef}）\n+新行`,
    grant: async (req) => {
      granted.push(req);
      let set = grantMap.get(req.sessionId);
      if (set === undefined) {
        set = new Set();
        grantMap.set(req.sessionId, set);
      }
      set.add(req.path);
    },
    releaseSession: (sessionId) => {
      const releasedPaths = [...(grantMap.get(sessionId) ?? [])];
      grantMap.delete(sessionId);
      released.push(sessionId);
      return releasedPaths;
    },
  };
  return { wt, created, cleaned, granted, released, grantMap };
}

/** headless 会话假件（可注结局；记录起跑面） */
function fakeSession(outcome: IssueRunOutcome) {
  let run = 0;
  const starts: { cwd: string; prompt: string; budgetMessages: number; toolsCount: number }[] = [];
  const session: IssueSessionFace = {
    startHeadless: async (req) => {
      run += 1;
      starts.push({
        cwd: req.cwd,
        prompt: req.prompt,
        budgetMessages: req.budgetMessages,
        toolsCount: req.tools.length,
      });
      const result: IssueSessionStartResult = { sessionId: `headless-${run}`, outcome: Promise.resolve(outcome) };
      return result;
    },
  };
  return { session, starts };
}

/** 预算假件（可注余量） */
function fakeBudget(ok = true, reason?: string): IssueBudgetFace {
  return { canAffordIssue: () => ({ ok, reason }) };
}

/** backend 假件（评论投递记录；listIssues 供 issue_get 面） */
function fakeBackend(postFail?: boolean) {
  const comments: { repo: string; number: number; body: string }[] = [];
  const backend: GithubBackend = {
    listIssues: async () => [],
    listComments: async () => [],
    postComment: async (req) => {
      if (postFail) throw new BaseError('ISSUE_SOURCE_UNREACHABLE', '[ISSUE_SOURCE_UNREACHABLE] 投递失败');
      comments.push(req);
      return { id: comments.length };
    },
  };
  return { backend, comments };
}

/** 测试基线 issue */
const ISSUE = {
  repo: 'o/r',
  number: 7,
  title: 'bug found',
  body: 'steps',
  labels: [],
  assignees: [],
  state: 'open' as const,
  updatedAt: '2026-09-06T00:00:00Z',
  htmlUrl: 'https://github.com/o/r/issues/7',
};

/** 组装（覆写位——mode/outcome/预算/行为） */
function makeService(over?: {
  mode?: 'draft' | 'auto';
  outcome?: IssueRunOutcome;
  budgetOk?: boolean;
  budgetReason?: string;
  worktreeBehavior?: { existsFirst?: number; dirtyOnClean?: boolean };
  postFail?: boolean;
  webhookSecret?: string;
}) {
  const fj = fakeJobs();
  const fsched = fakeScheduler();
  const fstate = fakeState();
  const fwd = fakeWorktree(over?.worktreeBehavior);
  const fsess = fakeSession(over?.outcome ?? { status: 'completed', messagesUsed: 12, summary: '改动完成' });
  const fbud = fakeBudget(over?.budgetOk ?? true, over?.budgetReason);
  const fback = fakeBackend(over?.postFail);
  const config: IssueConfig = {
    mode: over?.mode ?? 'draft',
    schedule: 'every:120s',
    repos: ['o/r'],
    perIssueBudgetMessages: 25,
    baseBranch: 'main',
  };
  const svc = createIssueService({
    config,
    backend: fback.backend,
    jobs: fj.jobs,
    scheduler: fsched.scheduler,
    state: fstate,
    worktree: fwd.wt,
    session: fsess.session,
    budget: fbud,
    capabilities: ['goal', 'exec', 'checkpoint'],
    webhookSecret: over?.webhookSecret,
  });
  return { svc, config, fj, fsched, fstate, fwd, fsess, fbud, fback };
}

describe('入队纪律（同步四闸）', () => {
  it('capabilities 缺席拒（goal/exec/checkpoint 任一缺席——经 pollOnce 通路）', async () => {
    const f = makeService();
    const backend: GithubBackend = {
      listIssues: async () => [ISSUE],
      listComments: async () => [],
      postComment: async () => ({ id: 1 }),
    };
    const svc = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: f.fbud,
      capabilities: ['goal', 'exec'], // checkpoint 缺席
    });
    const report = await svc.pollOnce();
    expect(report).toMatchObject({ candidates: 1, rejected: 1, enqueued: 0 });
    expect(f.fsess.starts).toHaveLength(0); // 未起跑
    expect(f.fj.settled).toHaveLength(0);
  });

  it('四闸执法：closed 拒 / 预算拒 / 重复拒 / 正常 started（经 pollOnce 通路）', async () => {
    // listIssues 假件返回三个 issue：一 closed、一 open、一 open
    const f = makeService({ budgetOk: false, budgetReason: '日池尽' });
    const backend: GithubBackend = {
      listIssues: async () => [ISSUE, { ...ISSUE, number: 8, state: 'closed' }],
      listComments: async () => [],
      postComment: async () => ({ id: 1 }),
    };
    const svc = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: f.fbud, // 预算尽
      capabilities: ['goal', 'exec', 'checkpoint'],
    });
    const report = await svc.pollOnce();
    expect(report).toMatchObject({ seen: 2, candidates: 1, rejected: 1, enqueued: 0 });
    // 二轮：预算恢复——open issue 入队（candidates 重见——水位推进但 since 模拟面恒返全量）
    const svc2 = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: fakeBudget(true),
      capabilities: ['goal', 'exec', 'checkpoint'],
    });
    const report2 = await svc2.pollOnce();
    expect(report2.enqueued).toBe(1);
    // 三轮：在飞互斥（running 见 issue-7 注册）——duplicate
    const report3 = await svc2.pollOnce();
    expect(report3).toMatchObject({ duplicates: 1, enqueued: 0 });
  });
});

describe('runOne 编舞（draft 档 happy path）', () => {
  it('起跑面：cwd=worktree 路径、prompt 含纪律与预算、issue_get 装载、授予记账', async () => {
    const f = makeService();
    // 直接入队经 pollOnce 通路（backend 返 issue——enqueue 内墙面）
    const backend: GithubBackend = {
      listIssues: async () => [ISSUE],
      listComments: async () => [],
      postComment: async (req) => {
        f.fback.comments.push(req);
        return { id: 1 };
      },
    };
    const svc = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: f.fbud,
      capabilities: ['goal', 'exec', 'checkpoint'],
      webhookSecret: 's',
    });
    await svc.pollOnce();
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    // 起跑面断言
    expect(f.fsess.starts[0]).toMatchObject({ cwd: '/wt/issue-7', budgetMessages: 25, toolsCount: 1 });
    expect(f.fsess.starts[0]!.prompt).toContain('o/r#7');
    expect(f.fsess.starts[0]!.prompt).toContain('严禁 push');
    expect(f.fsess.starts[0]!.prompt).toContain('issue_get');
    // 授予→回收链
    expect(f.fwd.granted).toEqual([{ sessionId: 'headless-1', path: '/wt/issue-7' }]);
    expect(f.fwd.released).toEqual(['headless-1']);
    // 评论贴补丁 + settle completed + clean
    expect(f.fback.comments[0]!.body).toContain('issue-7');
    expect(f.fback.comments[0]!.body).toContain('```diff');
    expect(f.fj.settled[0]).toMatchObject({ name: 'o/r#7', terminal: { status: 'completed' } });
    expect(f.fwd.cleaned).toEqual(['issue-7']);
  });
});

describe('runOne 编舞（其余结局）', () => {
  /** 通路快捷：注 outcome → pollOnce → 等终态 */
  async function runWithOutcome(
    outcome: IssueRunOutcome,
    over?: { mode?: 'draft' | 'auto'; dirtyOnClean?: boolean; existsFirst?: number },
  ) {
    const f = makeService({
      outcome,
      mode: over?.mode,
      worktreeBehavior: { dirtyOnClean: over?.dirtyOnClean, existsFirst: over?.existsFirst },
    });
    const backend: GithubBackend = {
      listIssues: async () => [ISSUE],
      listComments: async () => [],
      postComment: async (req) => {
        f.fback.comments.push(req);
        return { id: 1 };
      },
    };
    const svc = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: f.fbud,
      capabilities: ['goal', 'exec', 'checkpoint'],
    });
    const report = await svc.pollOnce();
    return { f, svc, report };
  }

  it('auto 档 completed → 阻塞转人审：settle failed 需人审（危险闸缺席）', async () => {
    const { f } = await runWithOutcome({ status: 'completed', messagesUsed: 9, summary: 'ok' }, { mode: 'auto' });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('需人审');
    expect(f.fback.comments[0]!.body).toContain('阻塞转人审');
    expect(f.fj.settled[0]!.terminal.detail).not.toContain('push 已执行'); // 不 push——词面自证
  });

  it('failed 结局 → 评论贴原因 + settle failed + clean', async () => {
    const { f } = await runWithOutcome({ status: 'failed', messagesUsed: 3, reason: '每 issue 预算帽耗尽' });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed', detail: '每 issue 预算帽耗尽' });
    expect(f.fback.comments[0]!.body).toContain('每 issue 预算帽耗尽');
    expect(f.fwd.cleaned).toEqual(['issue-7']);
  });

  it('needs-human 结局 → settle failed 需人审', async () => {
    const { f } = await runWithOutcome({ status: 'needs-human', messagesUsed: 5, reason: '写动作无审批覆盖' });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal.detail).toContain('需人审');
    expect(f.fback.comments[0]!.body).toContain('需人审');
  });

  it('paused 结局 → 不 settle、不 clean、授予保留、在飞保留（orphanScan 免标）', async () => {
    const { f, svc } = await runWithOutcome({ status: 'paused', reason: '全局日池尽' });
    await new Promise((r) => setTimeout(r, 10)); // 停靠路径无终态可等——静默排空
    expect(f.fj.settled).toHaveLength(0);
    expect(f.fwd.cleaned).toHaveLength(0);
    expect(f.fwd.released).toHaveLength(0); // 授予未回收
    const orphans = await svc.orphanScan();
    expect(orphans).toHaveLength(0); // 在飞保留——非孤儿
  });

  it('worktree 撞名让位：首撞 -r2 起（分支留史重跑场景）', async () => {
    const { f } = await runWithOutcome({ status: 'completed', messagesUsed: 2, summary: 's' }, { existsFirst: 1 });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fwd.created.map((c) => c.name)).toEqual(['issue-7-r2']);
    expect(f.fsess.starts[0]!.cwd).toBe('/wt/issue-7-r2');
  });

  it('clean 遇 dirty 保留（FS_WORKTREE_DIRTY 不强拆）', async () => {
    const { f } = await runWithOutcome({ status: 'completed', messagesUsed: 2, summary: 's' }, { dirtyOnClean: true });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal.status).toBe('completed'); // 终态照落
    expect(f.fwd.cleaned).toHaveLength(0); // 保留
    // 授予仍回收（会话终了——worktree 留存但授予不留）
    expect(f.fwd.released).toEqual(['headless-1']);
  });

  it('评论投递失败不阻塞终态（回执后补语义）', async () => {
    const f = makeService({ postFail: true });
    const backend: GithubBackend = {
      listIssues: async () => [ISSUE],
      listComments: async () => [],
      postComment: async () => {
        throw new BaseError('ISSUE_SOURCE_UNREACHABLE', '[ISSUE_SOURCE_UNREACHABLE] down');
      },
    };
    const svc = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: f.fbud,
      capabilities: ['goal', 'exec', 'checkpoint'],
    });
    await svc.pollOnce();
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal.status).toBe('completed');
  });
});

describe('编舞异常兜底', () => {
  it('startHeadless 抛 → settle failed + worktree 清', async () => {
    const f = makeService();
    const session: IssueSessionFace = {
      startHeadless: async () => {
        throw new Error('起跑失败：无可用模型');
      },
    };
    const backend: GithubBackend = {
      listIssues: async () => [ISSUE],
      listComments: async () => [],
      postComment: async () => ({ id: 1 }),
    };
    const svc = createIssueService({
      config: f.config,
      backend,
      jobs: f.fj.jobs,
      scheduler: f.fsched.scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session,
      budget: f.fbud,
      capabilities: ['goal', 'exec', 'checkpoint'],
    });
    await svc.pollOnce();
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed', detail: expect.stringContaining('起跑失败') });
    expect(f.fwd.cleaned).toEqual(['issue-7']);
  });
});

describe('orphanScan / start / stop', () => {
  it('孤儿标注：名形匹配减在飞（issue-* 形；非形不标）', async () => {
    const f = makeService();
    // 假 worktree list 返混名清单（在飞 issue-7 + 残留 issue-9 + 非形 misc）
    const wt = f.fwd.wt;
    const originalList = wt.list.bind(wt);
    wt.list = async () => [
      ...(await originalList()),
      { name: 'issue-9', path: '/wt/issue-9', branch: 'issue-9' },
      { name: 'issue-9-r3', path: '/wt/issue-9-r3', branch: 'issue-9-r3' },
      { name: 'misc', path: '/wt/misc', branch: 'misc' },
      { name: 'feature-x', path: '/wt/feature-x', branch: 'feature-x' },
    ];
    const orphans = await f.svc.orphanScan();
    expect(orphans.map((o) => o.name).sort()).toEqual(['issue-9', 'issue-9-r3']);
  });

  it('start/stop：登记 kind + 挂钟（名/周期）+ 摘钟', () => {
    const f = makeService();
    f.svc.start();
    expect(f.fj.kinds).toEqual(['issue']);
    expect(f.fsched.registered).toEqual([{ name: 'issue-poll', schedule: 'every:120s' }]);
    f.svc.stop();
    expect(f.fsched.removed).toEqual(['issue-poll']);
  });

  it('start 幂等：挂钟抛不炸（行已在场景）', () => {
    const f = makeService();
    const scheduler: IssueSchedulerFace = {
      registerPollJob: () => {
        throw new Error('SCHEDULER_NAME_EXISTS: issue-poll');
      },
      removePollJob: () => undefined,
    };
    const svc = createIssueService({
      config: f.config,
      backend: f.fback.backend,
      jobs: f.fj.jobs,
      scheduler,
      state: f.fstate,
      worktree: f.fwd.wt,
      session: f.fsess.session,
      budget: f.fbud,
      capabilities: ['goal', 'exec', 'checkpoint'],
    });
    expect(() => svc.start()).not.toThrow();
  });

  it('handleWebhook secret 缺席 → ISSUE_WEBHOOK_INVALID 响亮拒', async () => {
    const f = makeService();
    await expect(
      f.svc.handleWebhook({ event: 'issues', signatureHeader: 'sha256=x', rawBody: '{}' }),
    ).rejects.toMatchObject({ code: 'ISSUE_WEBHOOK_INVALID' });
  });
});
