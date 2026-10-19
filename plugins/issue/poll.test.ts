/**
 * issue 轮询翻页收口回归锁（03 §10.7 issue 条「入队与调度」2026-10-19
 * 挖掘 70 轮件C 批注）。
 *
 * 修前红形：pollOnce 单页不翻页（listIssues 恒一次调用、永不携 page）而
 * 水位照推首页 max(updatedAt)——GitHub issues API 单页 100（per_page=100、
 * sort=created desc，首页系最新建非最新更），增量窗内更新数 >100 时第 2 页
 * 起 issue 若 updatedAt ≤ 新水位即永久静默跳过（github.ts 头注「溢出诚实
 * 注记于 PollReport」无码面兑现）。批注收口三段的锁面：
 * - 红锁一（①页满即翻）：首页恰 100 携 page 续取至短页——第 2 页 issue
 *   全量入队、水位 = 全页 max（收敛不分新旧建序）；
 * - 红锁二（②页护栏帽 fail-loud）：恒返 100 的仓恰 30 页（缺省护栏值——
 *   批注定值，刻意硬编：护栏值漂移应红此处而非随常量静默同漂）后停，
 *   report.overflow 诚实注记该仓；
 * - 回归锁：单页常规短窗（<100）零行为变——请求形（首请求不携 page）、
 *   水位/计数/入队逐位与修前同；
 * - ③溢出仓水位仍推进至已收账页 max（重扫重入有害——dedupeKey 系在飞
 *   互斥非永久幂等，批注明裁）并入队不弃。
 *
 * 假件纪律：mock 只停在注入位（IssuePollerDeps 四注入位——backend/state/
 * config/enqueue），零真网络。
 */
import { describe, expect, it } from 'vitest';

import type { GithubBackend } from './github.js';
import { createIssuePoller, watermarkKey } from './poll.js';
import type { IssueConfig, IssueRef, IssueStoreStateFace } from './types.js';

/** listIssues 调用记录形（断言面：page 位翻页驱动 + since 水位线的可观测证） */
interface ListCall {
  repo: string;
  since?: string;
  page?: number;
}

/** 测试配置（精确单仓——labels/assignees 维不约束，过滤只执法 closed/仓域） */
const CONFIG: IssueConfig = {
  mode: 'draft',
  schedule: 'every:120s',
  repos: ['o/r'],
  perIssueBudgetMessages: 400,
  baseBranch: 'main',
  maxDeliveriesPerDay: 10,
  verifyTimeoutMs: 120_000,
};

/** 递增 ISO 时戳（n 秒——同形定宽串，字典序 = 时间序：水位单调判据的构造源） */
function ts(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
}

/** issue 构造快捷（repo 固定 o/r；state 缺省 open——closed 由调用方显式注入） */
function mkIssue(number: number, updatedAt: string, state: 'open' | 'closed' = 'open'): IssueRef {
  return {
    repo: 'o/r',
    number,
    title: `t-${number}`,
    body: '',
    labels: [],
    assignees: [],
    state,
    updatedAt,
    htmlUrl: `https://github.com/o/r/issues/${number}`,
  };
}

/**
 * backend 假件（注入位 = IssuePollerDeps.backend）：listIssues 行为注入
 * （script 收 (req, callIndex)——恒返满页的护栏形需 callIndex 派生递增
 * number/updatedAt）；其余面桩空（轮询域不触达）。script 返回双形：数组 =
 * 无 PR 混列便捷形（自动包 `{issues, rawCount: 长度}`）；对象形 = 原始行数
 * 注入位（71 轮件2 PR 混列判据锁——rawCount ≠ issues 长度）。
 */
function makeBackend(
  script: (
    req: { repo: string; since?: string; page?: number },
    callIndex: number,
  ) => IssueRef[] | { issues: IssueRef[]; rawCount: number },
) {
  const calls: ListCall[] = [];
  const backend: GithubBackend = {
    listIssues: async (req) => {
      const callIndex = calls.length; // 本调用的页序号源（0 起——script 派生数据用）
      calls.push({ repo: req.repo, since: req.since, page: req.page });
      const out = script(req, callIndex);
      return Array.isArray(out) ? { issues: out, rawCount: out.length } : out;
    },
    listComments: async () => [],
    postComment: async () => ({ id: 1 }),
    createPullRequest: async () => ({ number: 1, htmlUrl: 'https://github.com/o/r/pull/1' }),
    getIssue: async () => undefined,
  };
  return { backend, calls };
}

/** store_state 假件（Map 直通——返回形与真身 StoreStateEntry 同形；注入位 = IssuePollerDeps.state） */
function fakeState(): IssueStoreStateFace & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    getStoreState: (key) => (map.has(key) ? { key, value: map.get(key) } : undefined),
    setStoreState: (key, value) => map.set(key, value),
    deleteStoreState: (key) => map.delete(key),
  };
}

/**
 * 组装 rig（四注入位齐装）：enqueue 记录入队号序、恒返 started（dedupe/
 * budget 归 service 收口——本层不重复执法，互斥/预算形不属本测试面）。
 */
function rig(script: Parameters<typeof makeBackend>[0]) {
  const f = makeBackend(script);
  const state = fakeState();
  const enqueued: number[] = [];
  const poller = createIssuePoller({
    backend: f.backend,
    state,
    config: CONFIG,
    enqueue: (issue) => {
      enqueued.push(issue.number);
      return { status: 'started', key: `${issue.repo}#${issue.number}` };
    },
  });
  return { calls: f.calls, state, enqueued, poller };
}

describe('红锁一：页满即翻（首页恰 100 携 page 续取至短页——水位取全页 max）', () => {
  it('第 2 页短页：page=2 请求发出、全量入队、水位 = 全页 max（非首页 max）', async () => {
    // 首页恰 100（含较旧者 ts(1) 级）；首页 max = ts(120)（首条）
    const page1 = Array.from({ length: 100 }, (_, i) => mkIssue(i + 1, i === 0 ? ts(120) : ts(i + 1)));
    // 第 2 页短页 5 条：101 最新（ts(600) > 首页 max——全页 max 判据源）、
    // 三条较旧、一条 closed（过滤面跨页照常执法——终态不入队）
    const page2 = [
      mkIssue(101, ts(600)),
      mkIssue(102, ts(10)),
      mkIssue(103, ts(11)),
      mkIssue(104, ts(12)),
      mkIssue(105, ts(5), 'closed'),
    ];
    const { calls, state, enqueued, poller } = rig((req) => (req.page === 2 ? page2 : page1));

    const report = await poller.pollOnce();

    // 翻页驱动可观测证：恰两请求、首请求不携 page（修前形逐位同）、第 2 页携 page=2
    expect(calls).toHaveLength(2); // 修前红：单页不翻页（恰 1 次调用、第 2 页零入队）
    expect(calls[0]).toEqual({ repo: 'o/r', since: undefined });
    expect(calls[1]?.page).toBe(2); // 修前红：请求永不携 page
    // 全量收账：seen 105（含第 2 页）、closed 一条过滤弃
    expect(report.seen).toBe(105); // 修前红：100（第 2 页 5 条静默丢）
    expect(report.candidates).toBe(104);
    expect(report.enqueued).toBe(104); // 修前红：100（首页 100 全 open——closed 的 105 号在第 2 页修前不收账）
    expect(report.duplicates).toBe(0);
    expect(report.rejected).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.overflow).toEqual([]); // 短页收尽——护栏未触（修前红：无 overflow 位）
    // 水位 = 全页 max：ts(600) 在第 2 页——修前水位只推首页 max(ts(120)) 即
    // 令第 2 页 issue 永久静默跳过（70 轮件C 批注修前红锚）
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(600));
    expect(enqueued).toContain(101); // 第 2 页最新者入队（修前红：零入队）
    expect(enqueued).not.toContain(105); // closed 弃
  });

  it('第 2 页全旧于首页时水位取首页 max——收敛不分新旧建序', async () => {
    // 首页 max ts(500)；第 2 页短页但全旧（首页系最新建非最新更——created desc
    // 不保证 updated 序，全页 max 收敛必须跨页取）
    const page1 = Array.from({ length: 100 }, (_, i) => mkIssue(i + 1, i === 0 ? ts(500) : ts(i + 1)));
    const page2 = [mkIssue(201, ts(90)), mkIssue(202, ts(91))];
    const { calls, state, poller } = rig((req) => (req.page === 2 ? page2 : page1));

    const report = await poller.pollOnce();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.page).toBe(2);
    expect(report.seen).toBe(102);
    // 全页 max = ts(500)（首页）——非末页 max：跨页收敛的正确性锁
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(500));
  });
});

describe('红锁二：页护栏帽 fail-loud（恒返满页——恰 30 页后停 + overflow 诚实注记）', () => {
  it('护栏耗尽：恰 30 页停、overflow 含该仓、已收账页照常入队且水位推进至已收账页 max', async () => {
    // 恒返满页 100：issue number = 页序 ×100 内递增、updatedAt = ts(number)
    // （严格递增——全页 max = 末页末条 ts(3000)，水位推进判据源）
    const fullPage = (callIndex: number) =>
      Array.from({ length: 100 }, (_, i) => {
        const number = callIndex * 100 + i + 1;
        return mkIssue(number, ts(number));
      });
    const { calls, state, enqueued, poller } = rig((_req, callIndex) => fullPage(callIndex));

    const report = await poller.pollOnce();

    // 恰护栏 30 页（缺省护栏值——批注②定值 30 页 = 3000 件/窗）后停，不无限拉取
    expect(calls).toHaveLength(30); // 修前红：恒 1 次调用（单页不翻页）
    expect(calls[0]?.page).toBeUndefined(); // 首请求不携 page
    expect(calls[29]?.page).toBe(30); // 末请求恰为护栏末页
    // ②fail-loud：护栏耗尽诚实注记该仓（不静默）——修前红：无 overflow 位
    expect(report.overflow).toEqual(['o/r']);
    // ③已收账页不弃：3000 条全入队、水位推进至已收账页 max（ts(3000) 在末
    // 页——溢出仓水位不让位：重扫同窗重入已完 Job 有害，人工收窗可解）
    expect(report.seen).toBe(3000);
    expect(report.enqueued).toBe(3000);
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(3000));
    expect(enqueued).toContain(3000); // 末页末条在队
    expect(report.errors).toEqual([]);
  });
});

describe('回归锁：单页常规短窗（<100）零行为变（请求形/水位/计数/入队逐位同修前）', () => {
  it('短窗单请求（首请求不携 page）、水位 = max、报告逐位同形（overflow 恒在场空清单）', async () => {
    const window = [mkIssue(1, ts(1)), mkIssue(2, ts(5)), mkIssue(3, ts(3))];
    const { calls, state, enqueued, poller } = rig(() => window);

    const report = await poller.pollOnce();

    // 恰一请求、形与修前逐位同（不携 page——短页即窗收尽，零翻页）
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ repo: 'o/r', since: undefined });
    // 报告逐位（含 overflow 空清单恒在场——fail-loud 位的常规形）
    expect(report).toEqual({
      repos: ['o/r'],
      seen: 3,
      candidates: 3,
      enqueued: 3,
      duplicates: 0,
      rejected: 0,
      globSkipped: 0,
      errors: [],
      overflow: [],
    });
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(5)); // max(updatedAt)
    expect(enqueued).toEqual([1, 2, 3]);
  });

  it('二轮 since 线：推进后的水位作 since 透传（首请求照旧不携 page）', async () => {
    const window = [mkIssue(1, ts(1)), mkIssue(2, ts(5))];
    const { calls, state, poller } = rig(() => window);

    await poller.pollOnce();
    await poller.pollOnce();

    // 第二轮首请求携 since = 一轮推进值（水位线 threading 修前形不变）
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ repo: 'o/r', since: ts(5) });
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(5));
  });
});

/* ---------------- 71 轮件2：页满判据真源 = rawCount（PR 混列不架空翻页） ---------------- */

describe('红锁三：页满判据 = rawCount——原始满页混 PR 不早停（71 轮件2·修前红）', () => {
  it('原始页 100 行（40 PR 混列 → 滤后 60）+ 第 2 页短页：续翻第 2 页、水位收全页 max（修前红：以滤后长度判满 → 首页即 break）', async () => {
    // 首页原始 100 行：40 行 PR（backend 滤除）+ 60 行 issue——归一返回形
    // {issues: 60 行, rawCount: 100}（判据真源 = 原始行数、过滤后清单只作内容）
    const page1Issues = Array.from({ length: 60 }, (_, i) => mkIssue(i + 1, ts(i + 1)));
    const page2 = [mkIssue(101, ts(600)), mkIssue(102, ts(10))];
    const { calls, state, enqueued, poller } = rig((req) =>
      req.page === 2 ? { issues: page2, rawCount: page2.length } : { issues: page1Issues, rawCount: 100 },
    );

    const report = await poller.pollOnce();

    // 翻页驱动不被滤后长度架空（修前红：滤后 60 < 100 → 首页即 break 恰 1 调）
    expect(calls).toHaveLength(2);
    expect(calls[1]?.page).toBe(2);
    // 第 2 页数据收账（修前红：更深层页不取——水位缺第 2 页数据即穿透面）
    expect(report.seen).toBe(62);
    expect(report.enqueued).toBe(62);
    expect(report.errors).toEqual([]); // 修前红：新返回形非数组，整仓让位落 errors
    expect(report.overflow).toEqual([]); // 第 2 页短页——护栏未触
    // 水位 = 全页 max：ts(600) 在第 2 页（修前红：水位只推首页 max → 第 2 页
    // issue 永久穿透——sort=created desc 下被弃页 updatedAt 可 > 已收 max）
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(600));
    expect(enqueued).toContain(101);
  });

  it('原始页连续 30 页满且混 PR（各页 rawCount 100 / 滤后 60）：护栏耗尽 overflow 置真（修前红：滤后判满恒 false → 溢出永不可置真）', async () => {
    // 恒返原始满页（PR 混列被滤不影响判据）：滤后 60/页 × 30 页、updatedAt 递增
    const mixedPage = (callIndex: number) => ({
      issues: Array.from({ length: 60 }, (_, i) => mkIssue(callIndex * 100 + i + 1, ts(callIndex * 100 + i + 1))),
      rawCount: 100,
    });
    const { calls, state, poller } = rig((_req, callIndex) => mixedPage(callIndex));

    const report = await poller.pollOnce();

    // 恰护栏 30 页后停（修前红：首页即停恰 1 调——滤后 60 < 100 恒判短页）
    expect(calls).toHaveLength(30);
    expect(calls[29]?.page).toBe(30);
    // fail-loud 兑现（修前红：overflow 恒空——fail-loud 降级 fail-silent）
    expect(report.overflow).toEqual(['o/r']);
    // 已收账页照常：60 × 30 收账、水位推进至已收账页 max（末页末条 number 2960）
    expect(report.seen).toBe(1800);
    expect(report.enqueued).toBe(1800);
    expect(report.errors).toEqual([]);
    expect(state.getStoreState(watermarkKey('o/r'))?.value).toBe(ts(2960));
  });
});
