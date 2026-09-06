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
import type { ApprovalAskRequest } from '../contracts/index.js';
import { wireSessionApproval } from './approval-wiring.js';
import type { SessionApprovalOptions } from './approval-wiring.js';

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
      persistAllowlist: () => undefined,
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
      persistAllowlist: (draft) => void drafts.push(draft),
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
