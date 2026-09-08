/**
 * github 后端测试——fetchImpl 全注入（零真网络纪律）：归一/PR 过滤/since
 * 透传/限额折码/不可达折码/POST 形/词法守卫。
 */
import { describe, expect, it } from 'vitest';
import { createGithubBackend } from './github.js';

const API = 'http://github.test';

/** 路由式 fetch 假件（path 前缀匹配；无路由 = 网络级失败模拟位） */
function fakeFetch(routes: Record<string, Response | Error>): {
  fetch: typeof fetch;
  calls: { path: string; init?: RequestInit }[];
} {
  const calls: { path: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const path = input.toString().slice(API.length);
    calls.push({ path, init });
    for (const [prefix, outcome] of Object.entries(routes)) {
      if (path.startsWith(prefix)) {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
    }
    throw new Error(`no route for ${path}`);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** JSON Response 快捷 */
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers });

/** GitHub issues API 原始行（REST v3 形——未归一） */
function ghRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 't',
    body: 'b',
    labels: [{ name: 'bug' }],
    assignees: [{ login: 'alice' }],
    state: 'open',
    updated_at: '2026-09-06T00:00:00Z',
    html_url: 'https://github.com/o/r/issues/7',
    ...over,
  };
}

describe('listIssues 归一与过滤', () => {
  it('字段归一（labels/assignees 名抽取、body null 折空串、state 归二值）', async () => {
    const ff = fakeFetch({
      '/repos/o/r/issues': json([ghRow({ body: null, labels: [{}, { name: '' }, { name: 'x' }] })]),
    });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const [issue] = await backend.listIssues({ repo: 'o/r' });
    expect(issue).toMatchObject({
      repo: 'o/r',
      number: 7,
      body: '',
      labels: ['x'],
      state: 'open',
      updatedAt: '2026-09-06T00:00:00Z',
    });
  });

  it('PR 混列过滤（pull_request 字段在场即弃）', async () => {
    const ff = fakeFetch({
      '/repos/o/r/issues': json([ghRow({ number: 1 }), ghRow({ number: 2, pull_request: { url: 'x' } })]),
    });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const issues = await backend.listIssues({ repo: 'o/r' });
    expect(issues.map((i) => i.number)).toEqual([1]);
  });

  it('since 透传 query + per_page=100 + 认证头携带', async () => {
    const ff = fakeFetch({ '/repos/o/r/issues': json([]) });
    const backend = createGithubBackend({ token: 'tk-secret', apiBase: API, fetchImpl: ff.fetch });
    await backend.listIssues({ repo: 'o/r', since: '2026-09-01T00:00:00Z' });
    const call = ff.calls[0]!;
    expect(decodeURIComponent(call.path)).toContain('since=2026-09-01T00:00:00Z');
    expect(call.path).toContain('per_page=100');
    expect(call.path).toContain('state=open');
    expect((call.init?.headers as Record<string, string>)['authorization']).toBe('Bearer tk-secret');
  });

  it('repo 坏形拒（TOOL_INVALID_ARGS——防注入）', async () => {
    const ff = fakeFetch({});
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    await expect(backend.listIssues({ repo: 'o/r/evil' })).rejects.toMatchObject({ code: 'TOOL_INVALID_ARGS' });
    await expect(backend.listComments({ repo: '../etc', number: 1 })).rejects.toMatchObject({
      code: 'TOOL_INVALID_ARGS',
    });
    expect(ff.calls).toHaveLength(0); // 坏形不发请求
  });
});

describe('listComments 归一', () => {
  it('升序取回 + author 抽取 + body null 折空', async () => {
    const ff = fakeFetch({
      '/repos/o/r/issues/7/comments': json([
        { id: 11, user: { login: 'bob' }, body: null, created_at: '2026-09-05T00:00:00Z' },
        { id: 12, user: {}, body: 'hi', created_at: '2026-09-06T00:00:00Z' },
      ]),
    });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const comments = await backend.listComments({ repo: 'o/r', number: 7 });
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ id: 11, author: 'bob', body: '' });
    expect(comments[1]).toMatchObject({ author: '(unknown)', body: 'hi' });
  });
});

describe('postComment（回执投递）', () => {
  it('POST 形：JSON body + content-type + 201 回 id', async () => {
    const ff = fakeFetch({ '/repos/o/r/issues/7/comments': json({ id: 99 }, 201) });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const created = await backend.postComment({ repo: 'o/r', number: 7, body: 'done' });
    expect(created.id).toBe(99);
    const call = ff.calls[0]!;
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(call.init?.body as string)).toEqual({ body: 'done' });
    expect((call.init?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});

describe('createPullRequest（04 §13 create-pr 执行腿）', () => {
  it('POST /repos/:o/:r/pulls 五字段形 + 201 回 number/htmlUrl', async () => {
    const ff = fakeFetch({
      '/repos/o/r/pulls': json({ number: 42, html_url: 'https://github.com/o/r/pull/42' }, 201),
    });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const pr = await backend.createPullRequest({ repo: 'o/r', title: 't', body: 'b', head: 'issue-7', base: 'main' });
    expect(pr).toEqual({ number: 42, htmlUrl: 'https://github.com/o/r/pull/42' });
    const call = ff.calls[0]!;
    expect(call.path).toBe('/repos/o/r/pulls');
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(call.init?.body as string)).toEqual({ title: 't', body: 'b', head: 'issue-7', base: 'main' });
  });

  it('422 不特判折 ISSUE_SOURCE_UNREACHABLE 族携状态码（与 postComment 同形）', async () => {
    const ff = fakeFetch({ '/repos/o/r/pulls': json({ message: 'A pull request already exists' }, 422) });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const err = await backend
      .createPullRequest({ repo: 'o/r', title: 't', body: 'b', head: 'x', base: 'main' })
      .catch((e) => e);
    expect(err.code).toBe('ISSUE_SOURCE_UNREACHABLE');
    expect(err.message).toContain('422');
  });

  it('repo 坏形守卫同 list 族（TOOL_INVALID_ARGS）', async () => {
    const ff = fakeFetch({});
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    await expect(
      backend.createPullRequest({ repo: 'bad', title: 't', body: 'b', head: 'x', base: 'main' }),
    ).rejects.toMatchObject({ code: 'TOOL_INVALID_ARGS' });
  });
});

describe('折码（限额/不可达）', () => {
  it('403 → ISSUE_SOURCE_RATE_LIMITED，retryAfter 取 x-ratelimit-reset', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    const ff = fakeFetch({ '/repos': json({ message: 'rate' }, 403, { 'x-ratelimit-reset': String(reset) }) });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const err = await backend.listIssues({ repo: 'o/r' }).catch((e) => e);
    expect(err.code).toBe('ISSUE_SOURCE_RATE_LIMITED');
    expect(err.message).toContain('120s');
  });

  it('429 无 reset 头 → 缺省 60s 退避', async () => {
    const ff = fakeFetch({ '/repos': json({}, 429) });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    const err = await backend.listIssues({ repo: 'o/r' }).catch((e) => e);
    expect(err.code).toBe('ISSUE_SOURCE_RATE_LIMITED');
    expect(err.message).toContain('60s');
  });

  it('网络级失败（fetch 抛）→ ISSUE_SOURCE_UNREACHABLE', async () => {
    const ff = fakeFetch({ '/repos': new Error('ECONNREFUSED') });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    await expect(backend.listIssues({ repo: 'o/r' })).rejects.toMatchObject({ code: 'ISSUE_SOURCE_UNREACHABLE' });
  });

  it('非预期 5xx → ISSUE_SOURCE_UNREACHABLE', async () => {
    const ff = fakeFetch({ '/repos': json({ message: 'oops' }, 500) });
    const backend = createGithubBackend({ token: 'tk', apiBase: API, fetchImpl: ff.fetch });
    await expect(backend.listComments({ repo: 'o/r', number: 1 })).rejects.toMatchObject({
      code: 'ISSUE_SOURCE_UNREACHABLE',
    });
  });
});
