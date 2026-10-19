/**
 * issue 轮询腿（03 §10.7 触发面——轮询打底缺省形态）。
 *
 * 单轮纪律（pollOnce，RunnerFactory 程序化分派零 token）：
 * 1. 精确 repo 逐仓 listIssues(since=水位)——**页满即翻**（GitHub issues
 *    API 单页帽 100：返回恰 100 即携 page 续取至短页，水位取全页 max——
 *    收敛不分新旧建序；翻页护栏缺省 30 页〔= 3000 件/窗〕fail-loud：耗尽
 *    即停、溢出仓入 PollReport.overflow 诚实注记不静默，水位仍推进至已收
 *    账页 max〔重扫同窗重入已完 Job 有害——dedupeKey 系在飞互斥非永久幂
 *    等〕——03 §10.7 issue 条「入队与调度」2026-10-19 挖掘 70 轮件C 批注）；
 *    glob 形不入轮询域（计数 globSkipped——匹配面归 webhook 路）；
 * 2. 逐 issue 匹配过滤（closed/域外/维不命中即弃）；
 * 3. 候选交 enqueue（dedupe/budget 由 service 收口——本层不重复执法）；
 * 4. 水位推进 = 本轮**见过**的 max(updatedAt)（含被过滤弃的——被弃 issue
 *    的后续更新不该因水位跳过被永久无视：见过即推进，重开靠 updated_at
 *    再动）。
 *
 * 容错：单仓失败不炸整轮（错误进报告——轮询是长跑面，一仓坏全家停摆不可
 * 接受）；水位只在成功见到数据后推进。
 */
import type { GithubBackend } from './github.js';
import type { IssueConfig, IssueEnqueueResult, IssueRef, IssueStoreStateFace } from './types.js';
import { exactRepos, issueMatchesFilter } from './filter.js';

/** issues API 单页帽（与 github.ts per_page=100 同值——「页满即翻」判据源） */
const ISSUES_API_PAGE_SIZE = 100;

/**
 * 轮询翻页护栏页数（缺省 30 页 = 3000 件/窗——03 §10.7 issue 条「入队与调
 * 度」2026-10-19 挖掘 70 轮件C 批注② fail-loud 帽定值）：护栏末页仍满即停
 * （不无限拉取），溢出仓入 PollReport.overflow 诚实注记。
 */
const POLL_PAGE_GUARD_PAGES = 30;

/** 单轮报告（回执可见面——enqueue/duplicates/rejected 分类计数 + 错误清单） */
export interface PollReport {
  /** 本轮纳入轮询的精确仓（glob 已剔除） */
  readonly repos: readonly string[];
  /** 源返回的 issue 总数（过滤前） */
  readonly seen: number;
  /** 过滤命中数（入队裁决前） */
  readonly candidates: number;
  /** 成功入队数 */
  readonly enqueued: number;
  /** 在飞互斥撞锁数 */
  readonly duplicates: number;
  /** 入队裁决拒数（预算/closed 等非互斥拒） */
  readonly rejected: number;
  /** glob 形仓数（不轮询——计数可见不静默） */
  readonly globSkipped: number;
  /**
   * 翻页护栏溢出仓清单（70 轮件C 批注②——空清单 = 无溢出）。
   *
   * 语义：护栏缺省 30 页（= 3000 件/窗，poll.ts POLL_PAGE_GUARD_PAGES 单
   * 源）末页仍满即耗尽——**已收账页照常入队、水位照常推进至已收账页
   * max**（不让位：重扫同窗会重入已完 Job——dedupeKey 系在飞互斥非永久
   * 幂等，重跑有害）；护栏耗尽系极端形，本注记即可见、人工收窗（缩小
   * since 窗/手动分批）可解——不静默丢。
   */
  readonly overflow: readonly string[];
  /** 单仓失败清单（repo + message——不炸整轮） */
  readonly errors: readonly { repo: string; message: string }[];
}

/** 轮询器依赖（service 组装注入——backend/store 经窄面） */
export interface IssuePollerDeps {
  readonly backend: GithubBackend;
  readonly state: IssueStoreStateFace;
  readonly config: IssueConfig;
  /** 入队裁决（service.enqueue——本层不重复执法 dedupe/budget） */
  readonly enqueue: (issue: IssueRef) => IssueEnqueueResult | Promise<IssueEnqueueResult>;
}

/** 水位键（store_state 承载——kind 'issue-poll'） */
export function watermarkKey(repo: string): string {
  return `issue:poll:watermark:${repo}`;
}

/** 组轮询器（单轮 = pollOnce 一次调用；无自驱时钟——挂钟归 scheduler 行） */
export function createIssuePoller(deps: IssuePollerDeps): { pollOnce(): Promise<PollReport> } {
  const { backend, state, config } = deps;

  return {
    async pollOnce(): Promise<PollReport> {
      const repos = exactRepos(config);
      const globSkipped = config.repos.length - repos.length;
      let seen = 0;
      let candidates = 0;
      let enqueued = 0;
      let duplicates = 0;
      let rejected = 0;
      const errors: { repo: string; message: string }[] = [];
      // 翻页护栏溢出仓清单（70 轮件C 批注②——诚实注记位，报告恒在场）
      const overflow: string[] = [];

      for (const repo of repos) {
        // 水位读取（缺席 = 首轮全量窗；值坏形视同缺席——防御旧数据）
        const stored = state.getStoreState(watermarkKey(repo));
        const since = typeof stored?.value === 'string' ? stored.value : undefined;

        // —— 翻页收口（70 轮件C 批注①②）：页满（= 单页帽 100）即携 page 续
        //    取至短页；续取至多护栏 30 页、末页仍满即耗尽停——overflow 诚实
        //    注记不静默。单页短窗（<100）首请求即短页：零翻页零行为变 ——
        const issues: IssueRef[] = [];
        let overflowed = false;
        try {
          for (let page = 1; page <= POLL_PAGE_GUARD_PAGES; page += 1) {
            // 首请求不携 page（与修前形逐位同——缺省即第 1 页）；第 2 页起显式携带
            const batch = await backend.listIssues(page === 1 ? { repo, since } : { repo, since, page });
            issues.push(...batch);
            if (batch.length < ISSUES_API_PAGE_SIZE) break; // 短页 = 窗收尽（含空页）
            // 护栏末页仍满 = 耗尽：停拉注记（水位仍推进至已收账页 max——见 PollReport.overflow）
            if (page === POLL_PAGE_GUARD_PAGES) overflowed = true;
          }
        } catch (err) {
          // 单仓失败不炸整轮——记录进报告继续下一仓（翻页中途失败同律：整仓
          // 让位、水位不推进——下轮重扫同窗，不丢数据）
          errors.push({ repo, message: err instanceof Error ? err.message : String(err) });
          continue;
        }
        if (overflowed) overflow.push(repo);

        // 水位推进 = 本轮见过的 max(updatedAt)（含被弃的——见 types 头注纪律；
        // 全页收敛不分新旧建序——溢出仓同推进至已收账页 max）
        let maxUpdated = since ?? '';
        for (const issue of issues) {
          if (issue.updatedAt > maxUpdated) maxUpdated = issue.updatedAt;
        }
        if (issues.length > 0 && maxUpdated !== since) {
          state.setStoreState(watermarkKey(repo), maxUpdated, { kind: 'issue-poll' });
        }

        seen += issues.length;
        for (const issue of issues) {
          if (!issueMatchesFilter(issue, config)) continue;
          candidates += 1;
          const result = await deps.enqueue(issue);
          if (result.status === 'started') enqueued += 1;
          else if (result.status === 'duplicate') duplicates += 1;
          else rejected += 1;
        }
      }

      return { repos, seen, candidates, enqueued, duplicates, rejected, globSkipped, overflow, errors };
    },
  };
}
