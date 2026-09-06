/**
 * GitHub 源后端（03 §10.7 触发面——轮询/webhook 两源共用的取数腿）。
 *
 * 只走 REST v3（议题/评论面够用——GraphQL 引入零必要）；fetch 注入式
 * （`fetchImpl` 缺省全局 fetch——测试注假件，零真网络纪律）；分页单页帽
 * 100、不翻页（轮询 since 增量窗内单页 100 通常覆盖；溢出诚实注记于
 * PollReport——不静默丢）。PR 混列：GitHub issues API 把 PR 计入 issues 列
 * 表，`pull_request` 字段在场即过滤。
 *
 * 不可信外部文本：title/body/comments 进上下文一律经调用方帽（issue_get 面
 * ISSUE_CONTEXT_CAP_BYTES）；本层只取数不渲染。
 */
import { BaseError } from '../contracts/index.js';
import type { IssueCommentRef, IssueRef } from './types.js';

/** GitHub 后端选项（装配注入——token 必填：无 token 的匿名轮询不受支持） */
export interface GithubBackendOptions {
  /** GitHub token（PAT/classic 皆可——公开仓也要求 token：匿名限额太低不可运营） */
  readonly token: string;
  /** fetch 注入（缺省全局 fetch——测试注假件） */
  readonly fetchImpl?: typeof fetch;
  /** API 基址（缺省 https://api.github.com——GitHub Enterprise / 测试面覆写） */
  readonly apiBase?: string;
}

/** 源后端窄面（poll/webhook/tools/service 四消费方——service 组装注入） */
export interface GithubBackend {
  /** 列仓 issues（state=open；since 增量窗；单页帽 100） */
  listIssues(req: { repo: string; since?: string }): Promise<IssueRef[]>;
  /** 列 issue 评论（升序——issue_get 数据源） */
  listComments(req: { repo: string; number: number }): Promise<IssueCommentRef[]>;
  /** issue 评论投递（回执面——draft 贴补丁/终态回执；折码律同 list*） */
  postComment(req: { repo: string; number: number; body: string }): Promise<{ id: number }>;
}

/** repo 串词法（`owner/name`——防注入：两段、字符域限字母数字连字符下划线点） */
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** repo 串守卫（坏形 = 参数面问题——TOOL_INVALID_ARGS 语义域） */
export function assertRepoValid(repo: string): void {
  if (!REPO_RE.test(repo)) {
    throw new BaseError(
      'TOOL_INVALID_ARGS',
      `[TOOL_INVALID_ARGS] repo 串坏形：${repo}（须 owner/name 两段、字符域限字母数字与 ._-'）`,
    );
  }
}

/** GitHub issues API 行形（REST v3——消费字段子集；其余字段忽略） */
interface GhIssueRow {
  number: number;
  title: string;
  body: string | null;
  labels?: { name?: string }[];
  assignees?: { login?: string }[];
  state: string;
  updated_at: string;
  html_url: string;
  /** PR 混列判别字段（issues API 把 PR 计入——在场即过滤） */
  pull_request?: unknown;
}

/** GitHub comments API 行形 */
interface GhCommentRow {
  id: number;
  user?: { login?: string };
  body: string | null;
  created_at: string;
}

/**
 * 组 GitHub 后端。错误折码：
 * - 403/429 → ISSUE_SOURCE_RATE_LIMITED（detail 携 retryAfter 秒——
 *   x-ratelimit-reset 头优先，缺席 60s 缺省）；
 * - 网络异常/其余非 2xx → ISSUE_SOURCE_UNREACHABLE。
 */
export function createGithubBackend(opts: GithubBackendOptions): GithubBackend {
  const apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  /** 单请求（通用头 + JSON 解析；非 2xx/网络错折码上抛；POST 形携 body） */
  async function requestJson<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const hasBody = init?.body !== undefined;
    let response: Response;
    try {
      response = await doFetch(`${apiBase}${path}`, {
        method: init?.method ?? (hasBody ? 'POST' : 'GET'),
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${opts.token}`,
          'x-github-api-version': '2022-11-28',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(init?.body) } : {}),
      });
    } catch (err) {
      // fetch 抛 = 网络层折（DNS/连接/超时）——非 HTTP 状态域
      throw new BaseError(
        'ISSUE_SOURCE_UNREACHABLE',
        `[ISSUE_SOURCE_UNREACHABLE] GitHub 不可达（${path}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      // reset 头是 epoch 秒；缺席/坏值回 60s 缺省退避
      const retryAfter = Number.isFinite(reset) && reset > 0 ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 60;
      throw new BaseError(
        'ISSUE_SOURCE_RATE_LIMITED',
        `[ISSUE_SOURCE_RATE_LIMITED] GitHub 限额（${path}，HTTP ${response.status}）——${retryAfter}s 后退避`,
      );
    }
    if (!response.ok) {
      throw new BaseError(
        'ISSUE_SOURCE_UNREACHABLE',
        `[ISSUE_SOURCE_UNREACHABLE] GitHub 非预期状态（${path}，HTTP ${response.status}）`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    async listIssues(req) {
      assertRepoValid(req.repo);
      const params = new URLSearchParams({ state: 'open', per_page: '100' });
      if (req.since !== undefined) params.set('since', req.since);
      const rows = await requestJson<GhIssueRow[]>(`/repos/${req.repo}/issues?${params.toString()}`);
      // PR 混列过滤（pull_request 字段在场即 PR——issues API 语义）
      return rows
        .filter((r) => r.pull_request === undefined)
        .map((r) => ({
          repo: req.repo,
          number: r.number,
          title: r.title ?? '',
          body: r.body ?? '',
          labels: (r.labels ?? []).map((l) => l.name ?? '').filter((n) => n !== ''),
          assignees: (r.assignees ?? []).map((a) => a.login ?? '').filter((n) => n !== ''),
          state: r.state === 'closed' ? ('closed' as const) : ('open' as const),
          updatedAt: r.updated_at,
          htmlUrl: r.html_url,
        }));
    },

    async listComments(req) {
      assertRepoValid(req.repo);
      const rows = await requestJson<GhCommentRow[]>(
        `/repos/${req.repo}/issues/${req.number}/comments?per_page=100&sort=created&direction=asc`,
      );
      return rows.map((r) => ({
        id: r.id,
        author: r.user?.login ?? '(unknown)',
        body: r.body ?? '',
        createdAt: r.created_at,
      }));
    },

    async postComment(req) {
      assertRepoValid(req.repo);
      // POST 回执 201——非 2xx 已在 requestJson 折码；body 帽由调用方执（ISSUE_RECEIPT_PATCH_CHARS）
      const created = await requestJson<{ id?: unknown }>(`/repos/${req.repo}/issues/${req.number}/comments`, {
        body: { body: req.body },
      });
      return { id: typeof created.id === 'number' ? created.id : 0 };
    },
  };
}
