/**
 * safety/approval 测试 — 审批对全编舞（04 §9：粘性短路 / 信封派发 / never /
 * 审计对完整）。
 *
 * 纪律：EventDispatch 全真（context 件）；answerer 即被测机制的参与者（注入
 * 行为非替身）；无模型层故零 mock。
 */
import { describe, it, expect } from 'vitest';
import { EventDispatch } from '../context/index.js';
import { BaseError } from '../contracts/index.js';
import {
  APPROVAL_ANSWER_EVENT,
  bridgeApprovalSignal,
  createApprovalService,
  type ApprovalAnswerEnvelope,
  type ApprovalDecisionSink,
} from './approval.js';
import type { ApprovalAnswer, ApprovalRequest } from './types.js';

/** 审批对双腿记录器（durable sink 的测试注入形） */
function makeSink() {
  const asked: { approvalId: string; summary: string }[] = [];
  const decided: { approvalId: string; decision: string; source: string }[] = [];
  const sink: ApprovalDecisionSink = {
    asked: (p) => asked.push({ ...p }),
    decided: (p) => decided.push({ ...p }),
  };
  return { asked, decided, sink };
}

/** 组装「分派器 + 服务 + 可编程 answerer」一套（每用例独立——词汇撞名执法要求如此） */
function makeRig(answer: ApprovalAnswer | undefined | Error, opts?: { policy?: 'ask' | 'never' }) {
  const dispatch = new EventDispatch();
  const rec = makeSink();
  const asks: ApprovalRequest[] = []; // answerer 侧捕获的请求（织入面断言用）
  const written: unknown[] = [];
  // 服务先建（构造时注册 approval/answer 词汇——挂监听前必须已注册），
  // answerer 后挂（装配真实序：通道面晚于服务装配）
  const service = createApprovalService(dispatch, {
    sink: rec.sink,
    policy: opts?.policy,
    persistAllowlist: (draft) => written.push(draft),
  });
  if (answer !== undefined) {
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      if (answer instanceof Error) throw answer;
      asks.push(envelope.req);
      envelope.answer = answer; // 能答者写答案且不调 next（已答短路）
      return envelope;
    });
  }
  return { dispatch, rec, asks, written, service };
}

/** 最小请求形（粘性指纹按用例自选携带） */
const req = (extra?: Partial<ApprovalRequest>): ApprovalRequest => ({
  summary: '测试动作',
  ...extra,
});

/* ---------------- ask 主编舞 ---------------- */

describe('createApprovalService.ask', () => {
  it('answerer 批准 → allowed-once（source=user）+ 审批对两腿落账（decided=approve）', async () => {
    const rig = makeRig('approve');
    const result = await rig.service.ask(req());
    expect(result).toEqual({ outcome: 'allowed-once', source: 'user' });
    expect(rig.rec.asked).toHaveLength(1);
    expect(rig.rec.decided).toEqual([
      { approvalId: rig.rec.asked[0]!.approvalId, decision: 'approve', source: 'user' },
    ]);
  });

  it('answerer 织入面：approvalId 与 ownership 闭包装载进载荷', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, { sink: rec.sink, ownership: { sessionId: 's-1' } });
    const seen: ApprovalRequest[] = [];
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      seen.push(envelope.req);
      envelope.answer = 'reject';
      return envelope;
    });
    await service.ask(req());
    expect(seen[0]!.approvalId).toBeTruthy();
    expect(seen[0]!.ownership).toEqual({ sessionId: 's-1' });
  });

  it('reject / cancel → 对应 outcome', async () => {
    const rejected = makeRig('reject');
    expect(await rejected.service.ask(req())).toMatchObject({ outcome: 'rejected' });
    const cancelled = makeRig('cancel');
    expect(await cancelled.service.ask(req())).toMatchObject({ outcome: 'cancelled' });
  });

  it('无人应答 → unavailable（source=timeout——headless 无人挂与超时同源）', async () => {
    const rig = makeRig(undefined);
    const result = await rig.service.ask(req());
    expect(result).toEqual({ outcome: 'unavailable', source: 'timeout' });
    expect(rig.rec.decided[0]).toMatchObject({ decision: 'unavailable', source: 'timeout' });
  });

  it('answerer 抛错 → 先落 decided 闭合审计对（unavailable）再原样上抛', async () => {
    const rig = makeRig(new Error('answerer 崩溃'));
    await expect(rig.service.ask(req())).rejects.toThrow('answerer 崩溃');
    expect(rig.rec.decided).toEqual([
      { approvalId: rig.rec.asked[0]!.approvalId, decision: 'unavailable', source: 'timeout' },
    ]);
  });
});

/* ---------------- never 档（确定性拒绝，问都不问） ---------------- */

describe('never 档', () => {
  it('不发 asked、不派发 answerer、decided 单腿 source=policy-never', async () => {
    const rig = makeRig('approve', { policy: 'never' });
    const result = await rig.service.ask(req());
    expect(result).toEqual({ outcome: 'rejected', source: 'policy-never' });
    expect(rig.rec.asked).toHaveLength(0); // 问都没问——asked 不落
    expect(rig.rec.decided[0]).toMatchObject({ decision: 'reject', source: 'policy-never' });
    expect(rig.asks).toHaveLength(0); // answerer 从未被派发
  });
});

/* ---------------- 粘性第 1/2 款（会话键缓存 + 子集预批） ---------------- */

describe('粘性短路（ask 之前，无审批对）', () => {
  it('always 后同指纹免问（source=sticky，不产生新审批对）', async () => {
    const rig = makeRig('always');
    const key = { target: '/ws/src/a.ts', tier: 'workspace-write' as const };
    const first = await rig.service.ask(
      req({ stickyKey: key, suggestedEntry: { tool: 'write', pattern: '/ws/src/a.ts' } }),
    );
    expect(first).toEqual({ outcome: 'allowed-once', source: 'user' });
    expect(rig.written).toEqual([{ tool: 'write', pattern: '/ws/src/a.ts' }]); // 条目真实写入
    expect(rig.rec.decided[0]).toMatchObject({ decision: 'always' });

    const askedBefore = rig.rec.asked.length;
    const second = await rig.service.ask(req({ stickyKey: key })); // 同指纹重复
    expect(second).toEqual({ outcome: 'allowed-once', source: 'sticky' });
    expect(rig.rec.asked).toHaveLength(askedBefore); // 没有问就没有 asked/decided
    expect(rig.rec.decided).toHaveLength(1);
  });

  it('子集预批：宽批（danger）覆盖后续严档请求（source=subset）', async () => {
    const rig = makeRig('always');
    await rig.service.ask(
      req({ stickyKey: { target: 'bash git', tier: 'danger' }, suggestedEntry: { tool: 'bash', pattern: 'git' } }),
    );
    const later = await rig.service.ask(req({ stickyKey: { target: 'bash git', tier: 'workspace-write' } }));
    expect(later).toEqual({ outcome: 'allowed-once', source: 'subset' });
  });

  it('请求宽于既有授予不命中（workspace-write 批过、danger 请求照问）', async () => {
    const rig = makeRig('always');
    await rig.service.ask(
      req({ stickyKey: { target: 'T', tier: 'workspace-write' }, suggestedEntry: { tool: 'write', pattern: 'T' } }),
    );
    const later = await rig.service.ask(req({ stickyKey: { target: 'T', tier: 'danger' } }));
    expect(later.source).toBe('user'); // 走了真实问询
    expect(rig.rec.asked).toHaveLength(2);
  });

  it('无草案的 always 防御收口视同 approve：不写条目、不落粘性面、decided=approve', async () => {
    const rig = makeRig('always');
    const result = await rig.service.ask(req({ stickyKey: { target: 'T', tier: 'workspace-write' } })); // 无 suggestedEntry
    expect(result).toEqual({ outcome: 'allowed-once', source: 'user' });
    expect(rig.written).toHaveLength(0);
    expect(rig.rec.decided[0]).toMatchObject({ decision: 'approve' });
    // 同指纹再来仍走真实问询（approve 是一次性的——粘性面未开）
    const again = await rig.service.ask(req({ stickyKey: { target: 'T', tier: 'workspace-write' } }));
    expect(again.source).toBe('user');
    expect(rig.rec.asked).toHaveLength(2);
  });

  it('无 stickyKey 的请求不参与粘性（answerer 答什么都不留会话免问面）', async () => {
    const rig = makeRig('always');
    await rig.service.ask(req({ suggestedEntry: { tool: 'write', pattern: 'P' } }));
    const again = await rig.service.ask(req({ suggestedEntry: { tool: 'write', pattern: 'P' } }));
    expect(again.source).toBe('user');
    expect(rig.rec.asked).toHaveLength(2);
  });
});

/* ---------------- 词汇执法 + 信号桥接 ---------------- */

describe('词汇执法与信号桥接', () => {
  it('同分派器重复组装 → EVENT_DUPLICATE fail-loud（单例装配纪律）', () => {
    const dispatch = new EventDispatch();
    createApprovalService(dispatch);
    expect(() => createApprovalService(dispatch)).toThrow(BaseError);
  });

  it('bridgeApprovalSignal：已 abort 的信号同步触发；后 abort 中继同 reason；摘除后不再中继', () => {
    // 已 abort：abort 事件只发一次，只挂监听是死路——必须同步触发
    const pre = new AbortController();
    pre.abort(new Error('run 取消'));
    const target1 = new AbortController();
    bridgeApprovalSignal({ summary: 'x', signal: pre.signal }, target1);
    expect(target1.signal.aborted).toBe(true);
    expect(target1.signal.reason).toBe(pre.signal.reason);

    // 正常路：挂监听中继 + 摘除后不再中继（ask 结算路径的监听回收）
    const run = new AbortController();
    const target2 = new AbortController();
    bridgeApprovalSignal({ summary: 'x', signal: run.signal }, target2); // 返回摘除函数本用例不消费
    expect(target2.signal.aborted).toBe(false);
    run.abort(new Error('打断'));
    expect(target2.signal.aborted).toBe(true);
    expect(target2.signal.reason).toBe(run.signal.reason);

    const runLater = new AbortController();
    const target3 = new AbortController();
    const detach3 = bridgeApprovalSignal({ summary: 'x', signal: runLater.signal }, target3);
    detach3(); // 结算摘除在先——迟到 abort 落在已结算提问上 no-op
    runLater.abort();
    expect(target3.signal.aborted).toBe(false);

    // 无信号载荷 → 空摘除函数（无 run 语境）
    expect(bridgeApprovalSignal({ summary: 'x' }, new AbortController())).toBeTypeOf('function');
  });
});
