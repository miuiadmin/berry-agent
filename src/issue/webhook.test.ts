/**
 * webhook 测试——HMAC 验签（常时比对/篡改/缺头）+ 载荷解析坏形 + 路由三型
 * （issues 触发集/issue_comment 留位/pull_request·其余 ignore）。
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IssueConfig, IssueEnqueueResult, IssueRef } from './types.js';
import { computeSignature, handleWebhookRequest, parseWebhookPayload, signatureMatches } from './webhook.js';

const SECRET = 'whsec-test';

/** 测试基线配置（精确仓 o/r、无 labels/assignees 维约束） */
const CONFIG: IssueConfig = {
  mode: 'draft',
  schedule: 'every:120s',
  repos: ['o/r'],
  perIssueBudgetMessages: 10,
  baseBranch: 'main',
};

/** issues 事件原始载荷 */
function issuesBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'opened',
    issue: {
      number: 7,
      title: 'bug found',
      body: 'steps...',
      labels: [],
      assignees: [],
      state: 'open',
      updated_at: '2026-09-06T00:00:00Z',
      html_url: 'https://github.com/o/r/issues/7',
    },
    repository: { full_name: 'o/r' },
    ...over,
  });
}

/** 入队假件（记录调用；可注裁决覆写） */
function fakeEnqueue(result?: IssueEnqueueResult) {
  const seen: IssueRef[] = [];
  const fn = async (issue: IssueRef): Promise<IssueEnqueueResult> => {
    seen.push(issue);
    return result ?? { status: 'started', key: `${issue.repo}#${issue.number}` };
  };
  return { seen, fn };
}

describe('验签原语', () => {
  it('computeSignature 形（sha256= 前缀 + HMAC-SHA256 hex——独立重算对拍）', () => {
    const expected = `sha256=${createHmac('sha256', SECRET).update('raw-body', 'utf8').digest('hex')}`;
    expect(computeSignature(SECRET, 'raw-body')).toBe(expected);
  });

  it('signatureMatches：合法真 / 篡改假 / 缺头假 / 长度不等假', () => {
    const good = computeSignature(SECRET, 'raw-body');
    expect(signatureMatches(SECRET, 'raw-body', good)).toBe(true);
    expect(signatureMatches(SECRET, 'raw-body-tampered', good)).toBe(false);
    expect(signatureMatches(SECRET, 'raw-body', '')).toBe(false);
    expect(signatureMatches(SECRET, 'raw-body', 'sha256=deadbeef')).toBe(false);
  });
});

describe('载荷解析', () => {
  it('issues 载荷归一 IssueRef', () => {
    const payload = parseWebhookPayload(
      'issues',
      issuesBody({
        action: 'labeled',
        issue: {
          number: 3,
          title: 'x',
          body: null,
          labels: [{ name: 'urgent' }],
          assignees: [{ login: 'bob' }],
          state: 'open',
          updated_at: '2026-09-06T01:00:00Z',
          html_url: 'u',
        },
        repository: { full_name: 'o/r' },
      }),
    );
    expect(payload.kind).toBe('issues');
    if (payload.kind !== 'issues') return;
    expect(payload.action).toBe('labeled');
    expect(payload.issue).toMatchObject({ repo: 'o/r', number: 3, body: '', labels: ['urgent'], assignees: ['bob'] });
  });

  it('坏 JSON / 非对象 / 缺域 → ISSUE_WEBHOOK_INVALID', () => {
    expect(() => parseWebhookPayload('issues', 'not-json')).toThrow();
    expect(() => parseWebhookPayload('issues', '"str"')).toThrow();
    expect(() =>
      parseWebhookPayload('issues', JSON.stringify({ issue: { number: 1, title: 't', updated_at: 'x' } })),
    ).toThrow(); // 缺 repository
    expect(() => parseWebhookPayload('issues', JSON.stringify({ repository: { full_name: 'o/r' } }))).toThrow(); // 缺 issue
    expect(() => parseWebhookPayload('issue_comment', JSON.stringify({ repository: { full_name: 'o/r' } }))).toThrow(); // 缺 issue.number
  });
});

describe('handleWebhookRequest 路由', () => {
  /** 单次请求快捷（合法签名） */
  async function call(event: string, body: string, config = CONFIG, enqueueResult?: IssueEnqueueResult) {
    const q = fakeEnqueue(enqueueResult);
    const receipt = await handleWebhookRequest(
      { secret: SECRET, config, enqueue: q.fn },
      {
        event,
        signatureHeader: computeSignature(SECRET, body),
        rawBody: body,
      },
    );
    return { receipt, q };
  }

  it('issues opened 域内 → enqueued（enqueue 收归一形）', async () => {
    const { receipt, q } = await call('issues', issuesBody());
    expect(receipt).toEqual({ receipt: 'enqueued', key: 'o/r#7' });
    expect(q.seen[0]).toMatchObject({ repo: 'o/r', number: 7 });
  });

  it('域外仓 → out-of-scope（不 enqueue）', async () => {
    const { receipt, q } = await call('issues', issuesBody({ repository: { full_name: 'other/repo' } }));
    expect(receipt).toEqual({ receipt: 'out-of-scope' });
    expect(q.seen).toHaveLength(0);
  });

  it('labels 白名单未命中 → out-of-scope；命中 → enqueued', async () => {
    const cfg: IssueConfig = { ...CONFIG, labels: ['urgent'] };
    const miss = await call('issues', issuesBody({ action: 'labeled' }), cfg);
    expect(miss.receipt).toEqual({ receipt: 'out-of-scope' });
    const hit = await call(
      'issues',
      issuesBody({
        action: 'labeled',
        issue: { number: 7, title: 't', labels: [{ name: 'urgent' }], state: 'open', updated_at: 'x' },
      }),
      cfg,
    );
    expect(hit.receipt).toMatchObject({ receipt: 'enqueued' });
  });

  it('非触发动作（edited/closed/deleted）→ out-of-scope', async () => {
    for (const action of ['edited', 'closed', 'deleted', 'unlabeled']) {
      const { receipt } = await call('issues', issuesBody({ action }));
      expect(receipt).toEqual({ receipt: 'out-of-scope' });
    }
  });

  it('closed 状态 issue → out-of-scope', async () => {
    const { receipt } = await call(
      'issues',
      issuesBody({ issue: { number: 7, title: 't', state: 'closed', updated_at: 'x' } }),
    );
    expect(receipt).toEqual({ receipt: 'out-of-scope' });
  });

  it('issue_comment → comment-ignored（v1 留位——裁决⑧）', async () => {
    const body = JSON.stringify({ action: 'created', issue: { number: 7 }, repository: { full_name: 'o/r' } });
    const { receipt } = await call('issue_comment', body);
    expect(receipt).toEqual({ receipt: 'comment-ignored', repo: 'o/r', number: 7 });
  });

  it('pull_request / 其余事件 → ignored', async () => {
    const pr = await call('pull_request', JSON.stringify({ action: 'opened' }));
    expect(pr.receipt).toEqual({ receipt: 'ignored', event: 'pull_request' });
    const ping = await call('ping', JSON.stringify({ zen: 'x' }));
    expect(ping.receipt).toEqual({ receipt: 'ignored', event: 'ping' });
  });

  it('enqueue 裁决透传：duplicate / rejected 回执可见', async () => {
    const dup = await call('issues', issuesBody(), CONFIG, { status: 'duplicate', key: 'o/r#7' });
    expect(dup.receipt).toEqual({ receipt: 'duplicate', key: 'o/r#7' });
    const rej = await call('issues', issuesBody(), CONFIG, { status: 'rejected', reason: '预算尽' });
    expect(rej.receipt).toEqual({ receipt: 'rejected', reason: '预算尽' });
  });

  it('验签先行：签名不符/缺头抛 ISSUE_WEBHOOK_INVALID（不解析载荷）', async () => {
    const q = fakeEnqueue();
    await expect(
      handleWebhookRequest(
        { secret: SECRET, config: CONFIG, enqueue: q.fn },
        { event: 'issues', signatureHeader: 'sha256=bad', rawBody: issuesBody() },
      ),
    ).rejects.toMatchObject({ code: 'ISSUE_WEBHOOK_INVALID' });
    await expect(
      handleWebhookRequest(
        { secret: SECRET, config: CONFIG, enqueue: q.fn },
        { event: 'issues', signatureHeader: '', rawBody: issuesBody() },
      ),
    ).rejects.toMatchObject({ code: 'ISSUE_WEBHOOK_INVALID' });
    // 验签未过时坏 JSON 也不解析（信息不外泄——同一码不可判载荷内容）
    await expect(
      handleWebhookRequest(
        { secret: SECRET, config: CONFIG, enqueue: q.fn },
        { event: 'issues', signatureHeader: 'sha256=bad', rawBody: 'not-json' },
      ),
    ).rejects.toMatchObject({ code: 'ISSUE_WEBHOOK_INVALID' });
    expect(q.seen).toHaveLength(0);
  });
});
