/**
 * 会话审批装配测试 — 审批对 durable / 粘性短路 / 归属路由 / run 信号桥 /
 * settlePending 收口 / 呈现面缺席与异常 fail-closed。
 *
 * 纪律：mock 只停在 askApproval 呈现注入位（手动结算 promise / signal 监听
 * 桩——channels AskQueue 的行为契约镜像）；approval service / dispatch /
 * session 全走真实现（组合根口径）。
 */
import { describe, it, expect } from 'vitest';
import { EventDispatch } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import { APPROVAL_ANSWER_EVENT } from '../safety/index.js';
import type { ApprovalAnswerEnvelope } from '../safety/index.js';
import type { ApprovalAskRequest, SessionEvent } from '../contracts/index.js';
import {
  wireSessionApproval,
  APPROVAL_SETTLED_EVENT,
  foldApprovalDecisions,
  isUserApprovalDecision,
} from './approval-wiring.js';
import type { SessionApprovalOptions, ApprovalSettledNotice } from './approval-wiring.js';

/* ---------------- 测试构造件 ---------------- */

function makeWiring(overrides?: Partial<SessionApprovalOptions>) {
  const session = new SessionLog({ sessionId: 's-ap' });
  const dispatch = new EventDispatch();
  const wiring = wireSessionApproval({
    sessionId: 's-ap',
    dispatch,
    session,
    ...overrides,
  });
  return { session, dispatch, wiring };
}

/** 会话事件 data 按类型取列（断言简写） */
function dataOf(session: SessionLog, type: string): unknown[] {
  return session
    .events()
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

/** 恒答呈现面 */
const answer =
  (
    value: Awaited<ReturnType<NonNullable<SessionApprovalOptions['askApproval']>>>,
  ): NonNullable<SessionApprovalOptions['askApproval']> =>
  async () =>
    value;

/** 呈现面行为契约镜像（channels AskQueue 同款）：已 abort 的 signal 同步收 cancel */
function signalAwareApproval(
  onAsk?: (request: ApprovalAskRequest) => void,
): NonNullable<SessionApprovalOptions['askApproval']> {
  return (_request, opts) =>
    new Promise((resolve) => {
      onAsk?.(_request);
      if (opts?.signal?.aborted) {
        resolve('cancel');
        return;
      }
      opts?.signal?.addEventListener('abort', () => resolve('cancel'), { once: true });
    });
}

/* ---------------- 审批对与策略 ---------------- */

describe('wireSessionApproval 审批对', () => {
  it('ask→approve：approval/asked + approval/decided 成对落账（decision=approve/source=user）', async () => {
    const { session, wiring } = makeWiring({ askApproval: answer('approve') });
    const result = await wiring.approval.ask({
      summary: '写入 /tmp/x',
      stickyKey: { target: '/tmp/x', tier: 'workspace-write' },
    });
    expect(result).toEqual({ outcome: 'allowed-once', source: 'user' });
    const asked = dataOf(session, 'approval/asked');
    const decided = dataOf(session, 'approval/decided');
    expect(asked).toHaveLength(1);
    expect(decided).toHaveLength(1);
    expect(asked[0]).toMatchObject({ summary: '写入 /tmp/x' });
    expect((asked[0] as { approvalId: string }).approvalId).toBe((decided[0] as { approvalId: string }).approvalId);
    expect(decided[0]).toMatchObject({ decision: 'approve', source: 'user' });
  });

  it('粘性第 2 款（子集预批）：always 授宽档后，同目标更严档免问（source=subset）', async () => {
    const { session, wiring } = makeWiring({
      askApproval: answer('always'),
      persistToolPolicy: () => undefined,
    });
    const target = '/tmp/x';
    // 宽档 always（粘性表入账 grantedTier=danger）
    await wiring.approval.ask({
      summary: '宽档授',
      stickyKey: { target, tier: 'danger' },
      suggestedEntry: { tool: 'bash', pattern: 'git push' },
    });
    // 同目标更严档请求：被既有宽批包含 → 免问放行
    const strict = await wiring.approval.ask({
      summary: '严档同目标',
      stickyKey: { target, tier: 'read-only' },
    });
    expect(strict).toEqual({ outcome: 'allowed-once', source: 'subset' });
    expect(dataOf(session, 'approval/asked')).toHaveLength(1); // 第二问免问零审批对
    expect(dataOf(session, 'approval/decided')).toHaveLength(1);
  });

  it('never 档：不问不落 asked，decided 单腿 {reject, policy-never}', async () => {
    const { session, wiring } = makeWiring({ policy: 'never', askApproval: answer('approve') });
    const result = await wiring.approval.ask({ summary: '写' });
    expect(result).toEqual({ outcome: 'rejected', source: 'policy-never' });
    expect(dataOf(session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(session, 'approval/decided')).toEqual([
      expect.objectContaining({ decision: 'reject', source: 'policy-never' }),
    ]);
  });

  it('always + 草案：persistAllowlist 收结构形草案，decided 落 always + 粘性入账', async () => {
    const drafts: unknown[] = [];
    const { session, wiring } = makeWiring({
      askApproval: answer('always'),
      persistToolPolicy: (draft) => void drafts.push(draft),
    });
    const key = { target: 'bash git push', tier: 'danger' as const };
    const first = await wiring.approval.ask({
      summary: 'bash git push',
      stickyKey: key,
      suggestedEntry: { tool: 'bash', pattern: 'git push' },
    });
    expect(first).toEqual({ outcome: 'allowed-once', source: 'user' });
    expect(drafts).toEqual([{ tool: 'bash', pattern: 'git push' }]);
    expect(dataOf(session, 'approval/decided')[0]).toMatchObject({ decision: 'always' });
    // 粘性第 1 款：同指纹后续免问
    const second = await wiring.approval.ask({ summary: '再推', stickyKey: key });
    expect(second).toEqual({ outcome: 'allowed-once', source: 'sticky' });
  });
});

/* ---------------- fail-closed 与载荷映射 ---------------- */

describe('wireSessionApproval 呈现面', () => {
  it('缺席 → unavailable（fail-closed——审批不可静默通过）', async () => {
    const { session, wiring } = makeWiring();
    const result = await wiring.approval.ask({ summary: '写' });
    expect(result).toEqual({ outcome: 'unavailable', source: 'timeout' });
    expect(dataOf(session, 'approval/decided')[0]).toMatchObject({ decision: 'unavailable', source: 'timeout' });
  });

  it('抛错 → 无答案交棒（unavailable——不静默放行）', async () => {
    const { wiring } = makeWiring({
      askApproval: async () => {
        throw new Error('呈现面崩');
      },
    });
    const result = await wiring.approval.ask({ summary: '写' });
    expect(result).toEqual({ outcome: 'unavailable', source: 'timeout' });
  });

  it('呈现面答 unavailable（降级到底自报无人）→ 短路写 answer 非 undefined 交棒，decided 落 unavailable/timeout', async () => {
    // 2026-09-13 真模型实测批：headless 零能力后端时通道核答 'unavailable'——
    // 桥层必须把它当「已答」短路（非 undefined 交棒），不能当「没答」传给下一环
    const { session, wiring } = makeWiring({
      askApproval: async () => 'unavailable',
    });
    const result = await wiring.approval.ask({ summary: '写' });
    expect(result).toEqual({ outcome: 'unavailable', source: 'timeout' });
    expect(dataOf(session, 'approval/decided')[0]).toMatchObject({ decision: 'unavailable', source: 'timeout' });
  });

  it('载荷映射：呈现面收到 contracts 同形（suggestedEntry 草案折人可读一行）', async () => {
    const seen: ApprovalAskRequest[] = [];
    const { wiring } = makeWiring({
      askApproval: async (request) => {
        seen.push(request);
        return 'approve';
      },
    });
    await wiring.approval.ask({
      summary: '写入 /w/a.ts',
      reason: 'fs write 审批',
      toolName: 'write',
      stickyKey: { target: '/w/a.ts', tier: 'workspace-write' },
      suggestedEntry: { tool: 'write', pattern: '/w/a.ts' },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      summary: '写入 /w/a.ts',
      reason: 'fs write 审批',
      toolName: 'write',
      suggestedEntry: 'write /w/a.ts',
    });
    expect(typeof seen[0]?.approvalId).toBe('string'); // 挂起身份短形织入
  });

  it('run 信号桥：run abort → 呈现面收 cancel（打断非拒绝）', async () => {
    const controller = new AbortController();
    const { session, wiring } = makeWiring({ askApproval: signalAwareApproval() });
    const askPromise = wiring.approval.ask({
      summary: '写',
      stickyKey: { target: '/w/b', tier: 'workspace-write' },
      signal: controller.signal,
    });
    controller.abort('run 打断');
    const result = await askPromise;
    expect(result).toEqual({ outcome: 'cancelled', source: 'user' });
    expect(dataOf(session, 'approval/decided')[0]).toMatchObject({ decision: 'cancel', source: 'user' });
  });
});

/* ---------------- 收口与拆解 ---------------- */

describe('wireSessionApproval 收口', () => {
  it('settlePending：挂起 ask 统一 unavailable，迟到答案不回写', async () => {
    let lateResolve: (value: 'approve') => void = () => {};
    const { session, wiring } = makeWiring({
      askApproval: () =>
        new Promise((resolve) => {
          lateResolve = resolve;
        }),
    });
    const askPromise = wiring.approval.ask({
      summary: '写',
      stickyKey: { target: '/w/c', tier: 'workspace-write' },
    });
    // 微拍让 answerer 起跑挂起后再收口
    await Promise.resolve();
    wiring.settlePending();
    const result = await askPromise;
    expect(result).toEqual({ outcome: 'unavailable', source: 'timeout' });
    // 迟到答案到达：决议已是既成事实，不重写
    lateResolve('approve');
    await Promise.resolve();
    expect(dataOf(session, 'approval/decided')).toHaveLength(1);
    expect(dataOf(session, 'approval/decided')[0]).toMatchObject({ decision: 'unavailable' });
  });

  it('归属路由：他会话的 ask 交棒下游（不越权代答）；本会话的 ask 本行应答', async () => {
    const downstream: string[] = [];
    const { dispatch } = makeWiring({ askApproval: answer('approve') });
    // 下游 answerer（本会话 answerer 之后注册——next 交棒的落点）
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (input) => {
      downstream.push(input.req.ownership?.sessionId ?? '无主');
      input.answer = 'reject';
      return Promise.resolve(input);
    });
    // 本会话：本行应答（approve），下游不被触
    const own = await dispatch.waterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, {
      req: { summary: '本会话', ownership: { sessionId: 's-ap' } },
    });
    expect(own.answer).toBe('approve');
    expect(downstream).toHaveLength(0);
    // 他会话：本行交棒，下游代答
    const foreign = await dispatch.waterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, {
      req: { summary: '他会话', ownership: { sessionId: 's-other' } },
    });
    expect(foreign.answer).toBe('reject');
    expect(downstream).toEqual(['s-other']);
  });

  it('dispose：摘 answerer——后续 ask 无应答（unavailable）', async () => {
    const { session, wiring } = makeWiring({ askApproval: answer('approve') });
    wiring.dispose();
    const result = await wiring.approval.ask({ summary: '写' });
    expect(result).toEqual({ outcome: 'unavailable', source: 'timeout' });
    expect(dataOf(session, 'approval/decided')[0]).toMatchObject({ decision: 'unavailable' });
  });
});

/* ---------------- 审批决策落史行（挖掘 31 轮 [1]）——总线词 + 折面 ---------------- */

describe('APPROVAL_SETTLED_EVENT 总线词（挖掘 31 轮 [1]——直播腿数据源）', () => {
  it('构造期词已注册 + decided 腿 append 先于 emit + 载荷 {sessionId, approvalId, decision, source, summary 配对}', async () => {
    // 修前红：词未注册——.on 即抛 EVENT_NOT_REGISTERED（emit/on 落未注册词
    // fail-loud 会断 ask 路，双保险注册必须先行）
    const session = new SessionLog({ sessionId: 's-ap' });
    const order: string[] = [];
    const origAppend = session.append.bind(session);
    session.append = (type: string, data: unknown) => {
      order.push(type);
      return origAppend(type, data);
    };
    const dispatch = new EventDispatch();
    const wiring = wireSessionApproval({ sessionId: 's-ap', dispatch, session, askApproval: answer('approve') });
    const notices: ApprovalSettledNotice[] = [];
    dispatch.on(APPROVAL_SETTLED_EVENT, (n) => {
      order.push('emit:approval/settled');
      notices.push(n as ApprovalSettledNotice);
    });
    await wiring.approval.ask({ summary: 'rm -rf /tmp/x' });
    // 时序锁：emit 殿后（durable append 真源先行——重放/直播两路同构前提）
    expect(order[order.length - 1]).toBe('emit:approval/settled');
    expect(order.filter((v) => v === 'approval/decided')).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      sessionId: 's-ap',
      decision: 'approve',
      source: 'user',
      summary: 'rm -rf /tmp/x',
    });
    expect((notices[0] as { approvalId: string }).approvalId).toBe(
      (dataOf(session, 'approval/asked')[0] as { approvalId: string }).approvalId,
    );
  });

  it('簿记 per-approvalId 配对不串（两问两对各配对 summary——consume 即清）', async () => {
    const { dispatch, wiring } = makeWiring({ askApproval: answer('reject') });
    const notices: ApprovalSettledNotice[] = [];
    dispatch.on(APPROVAL_SETTLED_EVENT, (n) => notices.push(n as ApprovalSettledNotice));
    await wiring.approval.ask({ summary: 'git push' });
    await wiring.approval.ask({ summary: 'rm -rf /' });
    expect(notices.map((n) => n.summary)).toEqual(['git push', 'rm -rf /']); // 各配对各 summary 零串账
    expect(notices.every((n) => n.decision === 'reject' && n.source === 'user')).toBe(true);
  });

  it('单腿形（policy-never）仍 emit——summary 空串诚实（谓词滤除在消费侧非总线侧）', async () => {
    const { session, dispatch, wiring } = makeWiring({ policy: 'never', askApproval: answer('approve') });
    const notices: ApprovalSettledNotice[] = [];
    dispatch.on(APPROVAL_SETTLED_EVENT, (n) => notices.push(n as ApprovalSettledNotice));
    await wiring.approval.ask({ summary: '写' });
    expect(dataOf(session, 'approval/asked')).toHaveLength(0); // 单腿零 asked——簿记天然无源
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ decision: 'reject', source: 'policy-never', summary: '' });
  });
});

describe('foldApprovalDecisions 折面（挖掘 31 轮 [1]——投影/回看路数据源）', () => {
  it('真 wiring 日志折面：asked+decided 配对 → {seq=decided 事件 seq, decision, source, summary}', async () => {
    const { session, wiring } = makeWiring({ askApproval: answer('always'), persistToolPolicy: () => undefined });
    await wiring.approval.ask({
      summary: 'bash git push',
      stickyKey: { target: 'bash git push', tier: 'danger' },
      suggestedEntry: { tool: 'bash', pattern: 'git push' },
    });
    const decidedSeq = session.events().find((event) => event.type === 'approval/decided')!.seq;
    // 修前红：foldApprovalDecisions 未导出——运行红（esbuild 只剥类型不查名）
    const folded = foldApprovalDecisions(session.events());
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      seq: decidedSeq,
      decision: 'always',
      source: 'user',
      summary: 'bash git push',
    });
  });

  it('遮蔽腿：asked 或 decided 落 surfaceOp 区间 → 记录缺席（压缩遮蔽随消息遮蔽同语义）', () => {
    // 合成事件数组（fold 是纯函数——事件形字面即可，无需真日志）
    const asked = (seq: number, id: string): SessionEvent => ({
      type: 'approval/asked',
      seq,
      time: 1,
      data: { approvalId: id, summary: `命令 ${id}` },
    });
    const decided = (seq: number, id: string, decision = 'approve'): SessionEvent => ({
      type: 'approval/decided',
      seq,
      time: 1,
      data: { approvalId: id, decision, source: 'user' },
    });
    const occluder = (seq: number, start: number, end: number): SessionEvent => ({
      type: 'compaction',
      seq,
      time: 1,
      data: {},
      surfaceOp: { op: 'replace', start, end },
    });
    // 对被整段遮蔽 → 缺席
    expect(foldApprovalDecisions([asked(0, 'a'), decided(1, 'a'), occluder(2, 0, 1)])).toEqual([]);
    // decided 被遮蔽（asked 在场）→ 缺席
    expect(foldApprovalDecisions([asked(0, 'a'), decided(1, 'a'), occluder(2, 1, 1)])).toEqual([]);
    // 第二对在场不被第一对遮蔽误伤（区间精确）
    const events = [asked(0, 'a'), decided(1, 'a'), asked(2, 'b'), decided(3, 'b'), occluder(4, 0, 1)];
    const folded = foldApprovalDecisions(events);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ seq: 3, approvalId: 'b', summary: '命令 b' });
  });

  it('isUserApprovalDecision 真值表：恰 user × {approve, always, reject} 为 true（五 source × 五 decision）', () => {
    const sources = ['user', 'sticky', 'subset', 'timeout', 'policy-never'] as const;
    const decisions = ['approve', 'reject', 'cancel', 'unavailable', 'always'] as const;
    for (const source of sources) {
      for (const decision of decisions) {
        const expected =
          source === 'user' && (decision === 'approve' || decision === 'always' || decision === 'reject');
        expect(isUserApprovalDecision({ decision, source })).toBe(expected);
      }
    }
  });
});
