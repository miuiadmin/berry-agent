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
import type { IssueCommentRef, IssueEscalation, IssueRef } from './types.js';

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

/** issue 归一形快捷（G4/G5 翻页锁具） */
function refOf(number: number): IssueRef {
  return {
    repo: 'o/r',
    number,
    title: `t-${number}`,
    body: `b-${number}`,
    labels: [],
    assignees: [],
    state: 'open',
    updatedAt: '2026-09-06T00:00:00Z',
    htmlUrl: `https://github.com/o/r/issues/${number}`,
  };
}

/** 评论归一形快捷 */
function commentOf(id: number, body = `c-${id}`): IssueCommentRef {
  return { id, author: `u${id}`, body, createdAt: '2026-09-06T00:00:00Z' };
}

/** 满页 issues（100 条——自 number 起编号，不含绑定号 7） */
const fullIssuePage = (start: number): IssueRef[] => Array.from({ length: 100 }, (_, i) => refOf(start + i));

/** 满页评论（100 条） */
const fullCommentPage = (): IssueCommentRef[] => Array.from({ length: 100 }, (_, i) => commentOf(i + 1));

/**
 * 页感知假 backend（G4/G5 回归锁）：listIssues/listComments 按 req.page 回
 * 对应页（缺页 = 首页——与修前调用形兼容）；反查未配时首页即含绑定 issue。
 */
function pagedBackend(opts: { issuePages?: IssueRef[][]; commentPages?: IssueCommentRef[][] }): GithubBackend {
  return {
    listIssues: async (req) => {
      const pages = opts.issuePages ?? [[refOf(7)]];
      return pages[(req.page ?? 1) - 1] ?? [];
    },
    listComments: async (req) => {
      const pages = opts.commentPages ?? [[]];
      return pages[(req.page ?? 1) - 1] ?? [];
    },
    postComment: async () => ({ id: 1 }),
    createPullRequest: async () => ({ number: 1, htmlUrl: 'https://github.com/o/r/pull/1' }),
  };
}

/** 组 issue_get 单件（页感知假件绑定） */
function makeGet(backend: GithubBackend) {
  const tools = createIssueTools({ backend, repo: 'o/r', number: 7, onEscalate: () => undefined });
  return tools.find((t) => t.name === 'issue_get')!;
}

/** 工具回执文本抽取 */
function textOf(r: Awaited<ReturnType<ReturnType<typeof makeGet>['execute']>>): string {
  return r.content[0]!.type === 'text' ? r.content[0]!.text : '';
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

describe('issue_get 反查翻页（G4 回归锁——单页 newest-100 假缺席封堵）', () => {
  it('绑定 issue 在第二页（满 100 首页外）：修前单页假报「已关闭或删除」，修后翻页命中', async () => {
    // 首页满 100 条 open issue（#8..#107——不含绑定号 7），第二页才含 7：
    // open 数超 100 的仓里旧 issue 落在长尾——修前反查只取单页 newest-100
    const get = makeGet(pagedBackend({ issuePages: [fullIssuePage(8), [refOf(7)]] }));
    const r = await get.execute({}, { toolCallId: 'tc-g4a' });
    expect(r.isError).not.toBe(true); // 修前红锚：单页未命中 → isError
    const text = textOf(r);
    expect(text).toContain('# t-7（o/r#7）'); // 修后翻页命中正文
    expect(text).toContain('b-7');
  });

  it('反查短页列尽：缺席话术保持（不在源返回集内——可能已关闭或删除）', async () => {
    // 短页 = open 集列尽的诚实信号（无更深页）——话术不升级不误导
    const get = makeGet(pagedBackend({ issuePages: [[refOf(8), refOf(9)]] }));
    const r = await get.execute({}, { toolCallId: 'tc-g4b' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('不在源返回集内（可能已关闭或删除）');
  });

  it('反查达翻页帽（5 页恒满未命中）：诚实缺席话术区分「不在最新 500 条内」', async () => {
    const alwaysFull = [
      fullIssuePage(1000),
      fullIssuePage(1100),
      fullIssuePage(1200),
      fullIssuePage(1300),
      fullIssuePage(1400),
      fullIssuePage(1500),
    ];
    const get = makeGet(pagedBackend({ issuePages: alwaysFull }));
    const r = await get.execute({}, { toolCallId: 'tc-g4c' });
    expect(r.isError).toBe(true);
    // 修前红锚：话术是「不在源返回集内」——恒满页时该话术是假列尽（还有
    // 更深页只是不翻了），须诚实区分翻页帽射程
    expect(textOf(r)).toContain('不在最新 500 条');
  });
});

describe('issue_get 评论跟尽（G5 回归锁——超 100 条不静默丢最新段）', () => {
  it('评论跨两页（101 条）：修前只回首页 100 条丢尾段，修后拼齐', async () => {
    const commentPages = [fullCommentPage(), [commentOf(101, '尾段评论')]];
    const get = makeGet(pagedBackend({ commentPages }));
    const r = await get.execute({}, { toolCallId: 'tc-g5a' });
    const text = textOf(r);
    expect(text).toContain('尾段评论'); // 修前红锚：单页只回首页，尾段静默丢
    expect((r as { details?: { comments?: number } }).details?.comments).toBe(101); // 修前 100
  });

  it('评论单页列尽（短页）：零翻页直过（翻页只在满页后续）', async () => {
    const get = makeGet(pagedBackend({ commentPages: [[commentOf(1, '唯一'), commentOf(2, '第二')]] }));
    const r = await get.execute({}, { toolCallId: 'tc-g5b' });
    expect(textOf(r)).toContain('唯一');
    expect((r as { details?: { comments?: number } }).details?.comments).toBe(2);
  });

  it('评论达跟尽帽（10 页恒满）：溢出注记在场（不静默丢）', async () => {
    const alwaysFull = Array.from({ length: 12 }, () => fullCommentPage());
    const get = makeGet(pagedBackend({ commentPages: alwaysFull }));
    const r = await get.execute({}, { toolCallId: 'tc-g5c' });
    // 修前红锚：无任何溢出注记——模型不自知信息不全
    expect(textOf(r)).toContain('未收录');
    expect((r as { details?: { comments?: number } }).details?.comments).toBe(1000); // 帽内拼齐
  });
});
