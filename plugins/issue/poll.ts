/**
 * issue 轮询腿（03 §10.7 触发面——轮询打底缺省形态）。
 *
 * 单轮纪律（pollOnce，RunnerFactory 程序化分派零 token）：
 * 1. 精确 repo 逐仓 listIssues(since=水位)；glob 形不入轮询域（计数
 *    globSkipped——匹配面归 webhook 路）；
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

      for (const repo of repos) {
        // 水位读取（缺席 = 首轮全量窗；值坏形视同缺席——防御旧数据）
        const stored = state.getStoreState(watermarkKey(repo));
        const since = typeof stored?.value === 'string' ? stored.value : undefined;

        let issues: IssueRef[];
        try {
          issues = await backend.listIssues({ repo, since });
        } catch (err) {
          // 单仓失败不炸整轮——记录进报告继续下一仓
          errors.push({ repo, message: err instanceof Error ? err.message : String(err) });
          continue;
        }

        // 水位推进 = 本轮见过的 max(updatedAt)（含被弃的——见 types 头注纪律）
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

      return { repos, seen, candidates, enqueued, duplicates, rejected, globSkipped, errors };
    },
  };
}
