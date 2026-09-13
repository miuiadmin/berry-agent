/**
 * issue 服务测试——全假件装配（真件互证归 compat.test.ts）：
 * 入队纪律四闸（capabilities/closed/dedupe/budget）、runOne 编舞五结局
 * （draft·completed/auto·completed/failed/needs-human/paused）、worktree
 * 撞名让位、dirty 保留、编舞异常兜底、孤儿扫描、start/stop、
 * ⑪ 三零件（交付验证门三态/escalation 收口双档/前次分支指路 prompt）、
 * ⑪ 遗漏修复批两件（非 completed 收口 escalation 附段双面——回执评论与
 * settle detail；验证四元组 settle detail 补齐——非零分支输出尾 + 异常
 * 分支时长）。
 */
import { BaseError } from '../contracts/index.js';
import { describe, expect, it, vi } from 'vitest';
import type { GithubBackend } from './github.js';
import { createIssueService } from './service.js';
import type {
  IssueBudgetFace,
  IssueConfig,
  IssueDangerFace,
  IssueJobsFace,
  IssueRunOutcome,
  IssueSchedulerFace,
  IssueSessionFace,
  IssueSessionStartResult,
  IssueStoreStateFace,
  IssueVerifyFace,
  IssueWorktreeFace,
} from './types.js';
import type { ToolDefinition } from '../contracts/index.js';

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
  return { wt, created, cleaned, granted, released, grantMap, createCalls: () => createCalls };
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

/** backend 假件（评论/PR 投递记录；listIssues 供 issue_get 面；createPullRequest 供危险闸交付腿） */
function fakeBackend(postFail?: boolean) {
  const comments: { repo: string; number: number; body: string }[] = [];
  const prs: { repo: string; title: string; body: string; head: string; base: string }[] = [];
  const backend: GithubBackend = {
    listIssues: async () => [],
    listComments: async () => [],
    postComment: async (req) => {
      if (postFail) throw new BaseError('ISSUE_SOURCE_UNREACHABLE', '[ISSUE_SOURCE_UNREACHABLE] 投递失败');
      comments.push(req);
      return { id: comments.length };
    },
    createPullRequest: async (req) => {
      prs.push(req);
      const n = prs.length;
      return { number: 800 + n, htmlUrl: `https://github.com/${req.repo}/pull/${800 + n}` };
    },
  };
  return { backend, comments, prs };
}

/** 内联 backend 假件的 createPullRequest 缺省桩（入队/起跑面测试不触交付腿） */
const prStub = async (): Promise<{ number: number; htmlUrl: string }> => ({
  number: 1,
  htmlUrl: 'https://github.com/o/r/pull/1',
});

/** danger 假件（两腿行为可注——记录调用面；auto 档交付腿与 ⑪ escalation 降级共件） */
function fakeDanger(behavior?: { pushFail?: Error; prFail?: Error; denyCode?: string }) {
  const deliverCalls: {
    kind: 'push' | 'create-pr';
    repo: string;
    branch: string;
    base?: string;
    title?: string;
    body?: string;
  }[] = [];
  const face: IssueDangerFace = {
    deliver: async (req) => {
      deliverCalls.push(req);
      if (req.kind === 'push') {
        if (behavior?.denyCode !== undefined)
          throw new BaseError(behavior.denyCode, `[${behavior.denyCode}] 测试注入拒`);
        if (behavior?.pushFail !== undefined) throw behavior.pushFail;
        return {};
      }
      if (behavior?.prFail !== undefined) throw behavior.prFail;
      return { prNumber: 42, prUrl: 'https://github.com/o/r/pull/42' };
    },
    approve: async () => ({ ok: true, expiresAt: 1 }),
    status: async () => {
      throw new Error('status 不在编舞路径——不应触达');
    },
  };
  return { face, deliverCalls };
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

/** 组装（覆写位——mode/outcome/预算/行为/危险闸/验证门/会话） */
function makeService(over?: {
  mode?: 'draft' | 'auto';
  outcome?: IssueRunOutcome;
  budgetOk?: boolean;
  budgetReason?: string;
  worktreeBehavior?: { existsFirst?: number; dirtyOnClean?: boolean };
  postFail?: boolean;
  webhookSecret?: string;
  danger?: IssueDangerFace;
  verify?: IssueVerifyFace;
  verifyCommand?: string;
  session?: IssueSessionFace;
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
    maxDeliveriesPerDay: 10,
    ...(over?.verifyCommand !== undefined ? { verifyCommand: over.verifyCommand } : {}),
    verifyTimeoutMs: 120_000,
  };
  const svc = createIssueService({
    config,
    backend: fback.backend,
    jobs: fj.jobs,
    scheduler: fsched.scheduler,
    state: fstate,
    worktree: fwd.wt,
    session: over?.session ?? fsess.session,
    budget: fbud,
    capabilities: ['goal', 'exec', 'checkpoint'],
    ...(over?.danger !== undefined ? { danger: over.danger } : {}),
    ...(over?.verify !== undefined ? { verify: over.verify } : {}),
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
      createPullRequest: prStub,
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
      createPullRequest: prStub,
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
      createPullRequest: prStub,
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
    // 起跑面断言（双工具族：issue_get + issue_escalate——⑪ 裁决 4 第二件）
    expect(f.fsess.starts[0]).toMatchObject({ cwd: '/wt/issue-7', budgetMessages: 25, toolsCount: 2 });
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
      createPullRequest: prStub,
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

  it('九连撞耗尽：候选穷尽 → 折 lastExists settle failed（终态必落不悬挂）+ 起跑前零交付面', async () => {
    // 2026-09-14 扫描三役 F18 补锁：耗尽分支（service.ts 撞名让位循环尾）此前
    // 零测试触达——existsFirst 帽 99 使九候选全撞，锁「折 lastExists 原码面 +
    // settle 兜底 + 零回执零起会」三断言面
    const { f } = await runWithOutcome({ status: 'completed', messagesUsed: 2, summary: 's' }, { existsFirst: 99 });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fwd.createCalls()).toBe(9); // 候选序列穷尽（issue-7 + -r2..-r9）
    expect(f.fwd.created).toHaveLength(0); // 九试九撞——无 worktree 落成
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('FS_WORKTREE_EXISTS'); // 折 lastExists（第 9 次原码面）
    expect(f.fsess.starts).toHaveLength(0); // 起会未达
    expect(f.fback.comments).toHaveLength(0); // 起跑前折——零回执零交付
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
      createPullRequest: prStub,
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
      createPullRequest: prStub,
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

describe('auto 档危险闸交付腿（04 §13——闸在场三径）', () => {
  /**
   * 通路快捷：auto 档 + 注入 danger 假件 → 直接 enqueue（公开口）→ 等终态。
   * deliverCalls 记录两腿调用序（push 先于 create-pr——PR 依赖远端分支在场）。
   */
  async function runWithDanger(
    danger: IssueDangerFace,
    outcome: IssueRunOutcome = { status: 'completed', messagesUsed: 9, summary: '改动完成' },
  ) {
    const f = makeService({ outcome, mode: 'auto', danger });
    f.svc.enqueue(ISSUE);
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    return f;
  }

  /** danger 假件（模块级共件——见 fakeDanger） */

  it('成功径：push → create-pr 序 + PR 链接回执 + settle completed', async () => {
    const fd = fakeDanger();
    const f = await runWithDanger(fd.face);
    expect(fd.deliverCalls.map((c) => c.kind)).toEqual(['push', 'create-pr']); // 序律
    expect(fd.deliverCalls[1]).toMatchObject({ repo: 'o/r', base: 'main', title: 'bug found' }); // config 原料面
    expect(fd.deliverCalls[1]!.body).toContain('Closes #7'); // PR 正文闭环位
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'completed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('https://github.com/o/r/pull/42');
    expect(f.fback.comments[0]!.body).toContain('危险闸放行交付');
    expect(f.fback.prs).toHaveLength(0); // 交付走 danger 腿——backend.createPullRequest 不直触（装配位组合律）
  });

  it('闸拒径：DANGER_CONSENT_ABSENT → 转人审回执（指路 + 分支状态如实）+ settle failed', async () => {
    const fd = fakeDanger({ denyCode: 'DANGER_CONSENT_ABSENT' });
    const f = await runWithDanger(fd.face);
    expect(fd.deliverCalls).toHaveLength(1); // push 即拒——create-pr 零触达
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('DANGER_CONSENT_ABSENT');
    expect(f.fj.settled[0]!.terminal.detail).toContain('/danger approve'); // 指路表
    const body = f.fback.comments[0]!.body;
    expect(body).toContain('需人审');
    expect(body).toContain('本地未推'); // pushed=false 如实陈述
    expect(body).toContain('分支 `issue-7`');
  });

  it('非拒失败径：push 过闸但 git 失败 → allow-failed 语义（失败留分支可重试 + settle failed）', async () => {
    const fd = fakeDanger({ pushFail: new Error('git push 失败：网络断') });
    const f = await runWithDanger(fd.face);
    expect(fd.deliverCalls).toHaveLength(1); // push 败——create-pr 不触
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('交付失败');
    expect(f.fback.comments[0]!.body).toContain('git push 失败：网络断');
    expect(f.fback.comments[0]!.body).toContain('可重试');
    expect(f.fback.comments[0]!.body).toContain('本地未推');
  });

  it('半成径：push 成 create-pr 败 → 回执「已推远端可人工补开」如实陈述', async () => {
    const fd = fakeDanger({ prFail: new Error('422 PR 已在') });
    const f = await runWithDanger(fd.face);
    expect(fd.deliverCalls.map((c) => c.kind)).toEqual(['push', 'create-pr']);
    const body = f.fback.comments[0]!.body;
    expect(body).toContain('已推远端'); // pushed=true 如实陈述
    expect(body).toContain('可人工补开');
    expect(f.fj.settled[0]!.terminal.detail).toContain('交付失败');
  });
});

describe('⑪ 交付验证门（verifyCommand 在场即执法——编排层交付前一步）', () => {
  /** verify 假件（可注结局；记录调用面） */
  function fakeVerify(behavior?: { exitCode?: number; timedOut?: boolean; throwErr?: Error }) {
    const calls: { cwd: string; command: string; timeoutMs: number }[] = [];
    const face: IssueVerifyFace = {
      runVerify: async (req) => {
        calls.push({ cwd: req.cwd, command: req.command, timeoutMs: req.timeoutMs });
        if (behavior?.throwErr !== undefined) throw behavior.throwErr;
        return {
          exitCode: behavior?.exitCode ?? 0,
          timedOut: behavior?.timedOut ?? false,
          outputTail: 'FAIL  src/x.test.ts\n断言未过：期望 3 得 4',
          durationMs: 1234,
        };
      },
    };
    return { face, calls };
  }

  /** 通路快捷：verifyCommand 在场 + draft 档 → enqueue → 等终态 */
  async function runWithVerifyGate(verify?: IssueVerifyFace) {
    const f = makeService({
      outcome: { status: 'completed', messagesUsed: 9, summary: '改动完成' },
      verifyCommand: 'npm test',
      ...(verify !== undefined ? { verify } : {}),
    });
    f.svc.enqueue(ISSUE);
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    return f;
  }

  it('过门径：退出码 0 → 照常交付（draft 评论贴补丁）+ 真跑面 cwd/命令/时帽对拍', async () => {
    const fv = fakeVerify();
    const f = await runWithVerifyGate(fv.face);
    expect(fv.calls).toEqual([{ cwd: '/wt/issue-7', command: 'npm test', timeoutMs: 120_000 }]);
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'completed' });
    expect(f.fback.comments[0]!.body).toContain('```diff'); // 交付照走
  });

  it('非零拒：退出码 1 → settle failed 验证未过 + 回执贴输出尾 + 分支留存陈述', async () => {
    const fv = fakeVerify({ exitCode: 1 });
    const f = await runWithVerifyGate(fv.face);
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('验证未过');
    expect(f.fj.settled[0]!.terminal.detail).toContain('退出码 1');
    // 证据四元组双面律（03 §10.7 定形注 + types.ts IssueVerifyResult.outputTail
    // JSDoc「回执与 detail 双面证据」）：detail 面必须同载输出尾——2026-09-14
    // 扫描三役 F2 修前红锚（此前 detail 只载命令/判据/时长三段，尾段缺席）
    expect(f.fj.settled[0]!.terminal.detail).toContain('断言未过：期望 3 得 4');
    const body = f.fback.comments[0]!.body;
    expect(body).toContain('验证未过');
    expect(body).toContain('断言未过：期望 3 得 4'); // 输出尾证据面
    expect(body).toContain('分支 `issue-7` 留存供排查');
    expect(f.fback.comments[0]!.body).not.toContain('```diff'); // 未交付——无补丁段
    expect(f.fwd.cleaned).toEqual(['issue-7']); // 收尾清理照走（分支留史非 worktree 留存）
  });

  it('超时拒：timedOut → 同律拒交付（detail 载超时判据）', async () => {
    const fv = fakeVerify({ timedOut: true });
    const f = await runWithVerifyGate(fv.face);
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('超时');
  });

  it('执行体异常拒：runVerify 抛 → 门不放行（fail-closed 三拒形收口）', async () => {
    const fv = fakeVerify({ throwErr: new Error('spawn ENOENT') });
    const f = await runWithVerifyGate(fv.face);
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('执行体异常');
    expect(f.fj.settled[0]!.terminal.detail).toContain('spawn ENOENT');
  });

  it('face 注入缺席（verifyCommand 在场时）→ 同律拒交付转人审（不选「缺席=无门放行」）', async () => {
    const f = await runWithVerifyGate(undefined);
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('需人审');
    expect(f.fj.settled[0]!.terminal.detail).toContain('验证执行面缺席');
    expect(f.fback.comments[0]!.body).toContain('验证门缺席');
    expect(f.fback.comments[0]!.body).toContain('阻塞转人审');
  });

  it('verifyCommand 缺席 = 无门：completed 照常交付零拦截（渐进启用法）', async () => {
    // 既有 happy path 测试族即本例（makeService 缺省无 verifyCommand 无 verify）
    // ——此处显式锁「配置缺席时 verify 槽闲置不阻交付」
    const f = makeService({ outcome: { status: 'completed', messagesUsed: 5, summary: 's' } });
    f.svc.enqueue(ISSUE);
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'completed' });
  });
});

describe('⑪ escalation 收口消费（issue_escalate 登记面——runOne 闭包登记表）', () => {
  /**
   * 延迟结局会话假件：起跑后先让测试调 issue_escalate 登记、再放行终局——
   * 证登记表与编舞同域跨收口存活（工具工厂在 runOne 内组、回调闭包入表）。
   */
  function deferredSession() {
    let resolveOutcome!: (o: IssueRunOutcome) => void;
    const outcome = new Promise<IssueRunOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    let tools: ToolDefinition[] = [];
    const session: IssueSessionFace = {
      startHeadless: async (req) => {
        tools = [...req.tools];
        return { sessionId: 'headless-1', outcome };
      },
    };
    return { session, settle: (o: IssueRunOutcome) => resolveOutcome(o), toolsOf: () => tools };
  }

  /** 通路快捷：延迟会话 → enqueue → 等起跑 → 登记上报 → 放行 completed → 等终态 */
  async function runWithEscalation(over?: { mode?: 'draft' | 'auto'; danger?: IssueDangerFace }) {
    const ds = deferredSession();
    const f = makeService({
      outcome: { status: 'completed', messagesUsed: 9, summary: '改动完成' },
      mode: over?.mode,
      session: ds.session,
      ...(over?.danger !== undefined ? { danger: over.danger } : {}),
    });
    f.svc.enqueue(ISSUE);
    await vi.waitFor(() => expect(ds.toolsOf()).toHaveLength(2)); // 双工具族装载
    const escalate = ds.toolsOf().find((t) => t.name === 'issue_escalate')!;
    await escalate.execute(
      {
        question: 'API 形选 REST 还是 GraphQL？',
        options: ['REST', 'GraphQL'],
        recommendation: 'REST',
        continueWithDefault: 'REST 先行',
      },
      { toolCallId: 'tc-esc-1' },
    );
    await escalate.execute({ question: '要不要顺带修相邻 typo？' }, { toolCallId: 'tc-esc-2' });
    ds.settle({ status: 'completed', messagesUsed: 9, summary: '改动完成' });
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    return { f, ds };
  }

  it('draft 档：回执附全量四字段结构化段（多条累积非末条）+ settle 维持 completed + detail 注记', async () => {
    const { f } = await runWithEscalation();
    const body = f.fback.comments[0]!.body;
    expect(body).toContain('## ⚠️ 模型上报待裁决（2 条');
    expect(body).toContain('**上报 1**：API 形选 REST 还是 GraphQL？');
    expect(body).toContain('REST ｜ GraphQL'); // options 全量
    expect(body).toContain('- 建议：REST');
    expect(body).toContain('仅呈报不执行'); // continueWithDefault 呈报位
    expect(body).toContain('**上报 2**：要不要顺带修相邻 typo？');
    expect(body).toContain('```diff'); // 交付照走——draft 档终态不因附段翻档
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'completed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('escalation 在场 2 条');
  });

  it('auto 档：escalation 在场降级转人审——不 push（danger 零触达）+ 回执附结构化段', async () => {
    const fd = fakeDanger();
    const { f } = await runWithEscalation({ mode: 'auto', danger: fd.face });
    expect(fd.deliverCalls).toHaveLength(0); // 不 push——保守偏向
    expect(f.fj.settled[0]!.terminal).toMatchObject({ status: 'failed' });
    expect(f.fj.settled[0]!.terminal.detail).toContain('需人审：escalation 在场 2 条');
    const body = f.fback.comments[0]!.body;
    expect(body).toContain('不自动交付');
    expect(body).toContain('**上报 1**');
    expect(body).toContain('本地未 push'); // 分支状态如实陈述
  });
});

describe('⑪ 前次分支指路与对账纪律（prompt 两笔）', () => {
  it('撞名让位分支全列举进 prompt（两次残留——issue-7 与 issue-7-r2 都指路）+ 对账句在场', async () => {
    const f = makeService({
      outcome: { status: 'completed', messagesUsed: 2, summary: 's' },
      worktreeBehavior: { existsFirst: 2 }, // issue-7、issue-7-r2 连撞 → -r3 起跑
    });
    f.svc.enqueue(ISSUE);
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    const prompt = f.fsess.starts[0]!.prompt;
    expect(prompt).toContain('本任务此前跑过');
    expect(prompt).toContain('`issue-7`');
    expect(prompt).toContain('`issue-7-r2`'); // 全列举——单指首撞位漏后续史
    expect(prompt).toContain('git log');
    expect(prompt).toContain('也可从头独立解决');
    expect(prompt).toContain('逐条对账'); // 裁决 6 对账纪律句
    expect(prompt).toContain('未尽项');
    expect(f.fwd.created.map((c) => c.name)).toEqual(['issue-7-r3']);
  });

  it('零撞名（首跑）prompt 无指路段——不误导模型找不存在的前次分支', async () => {
    const f = makeService({ outcome: { status: 'completed', messagesUsed: 2, summary: 's' } });
    f.svc.enqueue(ISSUE);
    await vi.waitFor(() => expect(f.fj.settled).toHaveLength(1));
    expect(f.fsess.starts[0]!.prompt).not.toContain('本任务此前跑过');
  });
});
