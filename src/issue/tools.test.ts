/**
 * issue 工具面测试（⑪——双工具族 issue_get + issue_escalate）：
 * issue_get 冒烟（绑定面零参数 + 正文承载）；issue_escalate 登记面四验
 * （四字段全量/可选缺席不落键/schema 前置执法/effect read + 零外部写）。
 * backend 停在假件——工具件与编排层的分界即注桩位（mock 只停在数据源层）。
 */
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import type { GithubBackend } from './github.js';
import { createIssueTools } from './tools.js';
import type { IssueEscalation } from './types.js';

/** backend 假件（评论/PR 投递记录——escalate 零外部写的证伪面） */
function fakeBackend() {
  const comments: { repo: string; number: number; body: string }[] = [];
  const prs: { repo: string; title: string }[] = [];
  const backend: GithubBackend = {
    listIssues: async () => [
      {
        repo: 'o/r',
        number: 7,
        title: 'bug found',
        body: 'steps',
        labels: ['p1'],
        assignees: [],
        state: 'open',
        updatedAt: '2026-09-06T00:00:00Z',
        htmlUrl: 'https://github.com/o/r/issues/7',
      },
    ],
    listComments: async () => [{ id: 1, author: 'alice', body: '复现了', createdAt: '2026-09-06T01:00:00Z' }],
    postComment: async (req) => {
      comments.push(req);
      return { id: comments.length };
    },
    createPullRequest: async (req) => {
      prs.push(req);
      return { number: 1, htmlUrl: 'https://github.com/o/r/pull/1' };
    },
  };
  return { backend, comments, prs };
}

/** 组装快捷：登记表数组直录 + 返回工具族 */
function makeTools() {
  const registered: IssueEscalation[] = [];
  const fback = fakeBackend();
  const tools = createIssueTools({
    backend: fback.backend,
    repo: 'o/r',
    number: 7,
    onEscalate: (e) => registered.push(e),
  });
  return { tools, registered, fback };
}

describe('双工具族面（issue_get + issue_escalate）', () => {
  it('两件装载、全 effect read（恒免审批——登记面无外部写）', () => {
    const { tools } = makeTools();
    expect(tools.map((t) => t.name)).toEqual(['issue_get', 'issue_escalate']);
    expect(tools.every((t) => t.effect === 'read')).toBe(true);
  });

  it('issue_get 冒烟：零参数 + 正文/评论/状态行承载（绑定面——repo/number 闭包注入）', async () => {
    const { tools } = makeTools();
    const get = tools.find((t) => t.name === 'issue_get')!;
    const r = await get.execute({}, { toolCallId: 'tc-1' });
    const text = r.content[0]!.type === 'text' ? r.content[0]!.text : '';
    expect(text).toContain('# bug found（o/r#7）');
    expect(text).toContain('steps'); // 正文
    expect(text).toContain('## 评论');
    expect(text).toContain('alice'); // 评论作者
  });
});

describe('issue_escalate（登记面——⑪ 裁决 4）', () => {
  it('四字段全量登记 + 回执指收口 + 零外部写（backend 评论/PR 双零触达）', async () => {
    const { tools, registered, fback } = makeTools();
    const escalate = tools.find((t) => t.name === 'issue_escalate')!;
    const r = await escalate.execute(
      {
        question: 'API 形选 REST 还是 GraphQL？',
        options: ['REST', 'GraphQL'],
        recommendation: 'REST',
        continueWithDefault: 'REST 先行',
      },
      { toolCallId: 'tc-2' },
    );
    expect(registered).toEqual([
      {
        question: 'API 形选 REST 还是 GraphQL？',
        options: ['REST', 'GraphQL'],
        recommendation: 'REST',
        continueWithDefault: 'REST 先行',
      },
    ]);
    const text = r.content[0]!.type === 'text' ? r.content[0]!.text : '';
    expect(text).toContain('收口'); // 指收口语义——登记后 run 收口随回执转人审
    expect(fback.comments).toHaveLength(0); // 只登记不发评论
    expect(fback.prs).toHaveLength(0);
  });

  it('可选字段缺席不落键（载荷最小形——消费侧不辨「显式空」与「缺席」）', async () => {
    const { tools, registered } = makeTools();
    const escalate = tools.find((t) => t.name === 'issue_escalate')!;
    await escalate.execute({ question: '只问一句' }, { toolCallId: 'tc-3' });
    expect(registered).toEqual([{ question: '只问一句' }]);
  });

  it('schema 前置执法：question 必填（{} 拒 / {question} 过 / options 非串数组拒）', () => {
    const { tools } = makeTools();
    const escalate = tools.find((t) => t.name === 'issue_escalate')!;
    expect(Value.Check(escalate.parameters, {})).toBe(false); // question 缺席
    expect(Value.Check(escalate.parameters, { question: 'q' })).toBe(true); // 最小形
    expect(Value.Check(escalate.parameters, { question: 'q', options: ['a', 42] })).toBe(false); // 元素非串
    expect(Value.Check(escalate.parameters, { question: 'q', recommendation: 3 })).toBe(false); // 可选串档非串
  });
});
