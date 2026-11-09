/**
 * safety/approval 测试 — 审批对全编舞（04 §9：粘性短路 / 信封派发 / never /
 * 审计对完整）。
 *
 * 纪律：EventDispatch 全真（context 件）；answerer 即被测机制的参与者（注入
 * 行为非替身）；无模型层故零 mock。
 */
import { describe, it, expect } from 'vitest';
import { EventDispatch } from '../context/index.js';
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
  // B1 扩字段形（A-2 收口——asked/decided 审计位可选字段随载荷透传）
  const asked: Array<{
    approvalId: string;
    summary: string;
    toolCall?: { callId: string; toolName: string; arguments: Record<string, unknown> };
    suggestions?: string[];
  }> = [];
  const decided: Array<{
    approvalId: string;
    decision: string;
    source: string;
    updatedInput?: Record<string, unknown>;
    suggestionIndex?: number;
  }> = [];
  const sink: ApprovalDecisionSink = {
    asked: (p) => asked.push({ ...p } as (typeof asked)[number]),
    decided: (p) => decided.push({ ...p } as (typeof decided)[number]),
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
    persistToolPolicy: (draft) => written.push(draft),
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

  it('answerer 显式答 unavailable（呈现面自报无人——通道核降级到底的答案）→ 同 unavailable/timeout', async () => {
    // 与全链无答（answer 缺席）同归——2026-09-13 真模型实测批：headless 零
    // approval capability 后端时 ui-core 降级到底答 'unavailable'（修前误答
    // 'cancel'），service 侧映射必须与「无人应答」同语义非「用户取消」
    const rig = makeRig('unavailable');
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
  it('同分派器重复组装 → 词汇幂等跳过合法（批 19c-1 语义修正）：多会话各装配一份共享词汇', () => {
    const dispatch = new EventDispatch();
    createApprovalService(dispatch);
    // in-process 子代理真工厂首例：同栈父子两会话各装配一份审批服务，词汇
    // 层不承担装配检测（归属路由恰一键在 answerer 侧隔离他会话 ask）
    expect(() => createApprovalService(dispatch)).not.toThrow();
    expect(dispatch.isRegistered('approval/answer')).toBe(true); // 恰一册
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

describe('B1 工具级审批双向协议（04 §9 重裁形——decision 袋消费四路）', () => {
  it('approve 伴 updatedInput：折进 ask 返回值（守门改写实参供源）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, { sink: rec.sink });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'approve';
      // B1 结构形伴行：approve 伴改写值
      envelope.decision = { updatedInput: { path: '/ws/改写后.txt', content: '改写内容' } };
      return envelope;
    });
    const result = await service.ask({ summary: '写入', stickyKey: { target: '/ws/a', tier: 'workspace-write' } });
    expect(result.outcome).toBe('allowed-once');
    expect(result.updatedInput).toEqual({ path: '/ws/改写后.txt', content: '改写内容' });
  });

  it('approve 无伴行 = 返回值无 updatedInput（旧路零漂移）', async () => {
    const { service } = makeRig('approve');
    const result = await service.ask({ summary: 'x' });
    expect(result.updatedInput).toBeUndefined();
  });

  it('always 伴 suggestionIndex：结构快照查回选定条目经 persistToolPolicy 回写（B-2 链）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const written: { tool: string; pattern: string }[] = [];
    const service = createApprovalService(dispatch, {
      sink: rec.sink,
      persistToolPolicy: (draft) => written.push(draft as { tool: string; pattern: string }),
    });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'always';
      envelope.decision = { suggestionIndex: 0 };
      return envelope;
    });
    const result = await service.ask({
      summary: '执行命令 git status',
      suggestedEntry: { tool: 'bash', pattern: 'git status' },
    });
    expect(result.outcome).toBe('allowed-once');
    expect(written).toEqual([{ tool: 'bash', pattern: 'git status' }]); // 快照查回 = 草案同条
    expect(rec.decided[0]?.decision).toBe('always'); // 真实写入才落 always（既有律维持）
  });

  it('always 越界 suggestionIndex = 防御回落单条草案（不炸不静默丢）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const written: unknown[] = [];
    const service = createApprovalService(dispatch, {
      sink: rec.sink,
      persistToolPolicy: (draft) => written.push(draft),
    });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'always';
      envelope.decision = { suggestionIndex: 99 }; // 越界
      return envelope;
    });
    await service.ask({ summary: 'x', suggestedEntry: { tool: 'write', pattern: '/ws/a.txt' } });
    expect(written).toEqual([{ tool: 'write', pattern: '/ws/a.txt' }]); // 回落单条
  });

  it('reject 伴行袋：service 侧照常结算（schema 层拒在 decide 入口——纵深位不重复执法）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, { sink: rec.sink });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'reject';
      envelope.decision = { updatedInput: {} }; // 纵深假设已破形到达
      return envelope;
    });
    const result = await service.ask({ summary: 'x' });
    expect(result.outcome).toBe('rejected');
    expect(result.updatedInput).toBeUndefined(); // 非 approve 形伴行不折入返回值
  });
});

describe('A-1/A-2 收口锁（消毒装配 + durable 四字段）', () => {
  it('A-2 asked 落账携 toolCall 消毒后形与 suggestions 单条呈现形', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, { sink: rec.sink });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'approve';
      return envelope;
    });
    await service.ask({
      summary: '写入 /ws/a.txt',
      suggestedEntry: { tool: 'write', pattern: '/ws/a.txt' },
      toolCall: { callId: 'c-1', toolName: 'write', arguments: { path: '/ws/a.txt', content: 'x' } },
    });
    expect(rec.asked[0]?.toolCall).toEqual({
      callId: 'c-1',
      toolName: 'write',
      arguments: { path: '/ws/a.txt', content: 'x' },
    });
    expect(rec.asked[0]?.suggestions).toEqual(['write /ws/a.txt']);
  });

  it('A-2 decided 落账携 updatedInput 与 suggestionIndex（改写事实 durable 可查——审计对账腿闭合）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, {
      sink: rec.sink,
      persistToolPolicy: () => undefined,
    });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'always';
      envelope.decision = { suggestionIndex: 0 };
      return envelope;
    });
    await service.ask({
      summary: '执行命令 git status',
      suggestedEntry: { tool: 'bash', pattern: 'git status' },
    });
    expect(rec.decided[0]?.decision).toBe('always');
    expect(rec.decided[0]?.suggestionIndex).toBe(0);
    // 改写值例（approve 伴行——另一形）
    const dispatch2 = new EventDispatch();
    const rec2 = makeSink();
    const service2 = createApprovalService(dispatch2, { sink: rec2.sink });
    dispatch2.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'approve';
      envelope.decision = { updatedInput: { content: '改写后' } };
      return envelope;
    });
    await service2.ask({ summary: 'x' });
    expect(rec2.decided[0]?.updatedInput).toEqual({ content: '改写后' });
  });

  it('B-10 收口锁：粘性按本次 stickyKey 窄粒度入账（N-5——粘性面窄于策略面保守合法）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, {
      sink: rec.sink,
      persistToolPolicy: () => undefined,
    });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'always';
      return envelope;
    });
    await service.ask({
      summary: '写入 /ws/a.txt',
      stickyKey: { target: '/ws/a.txt', tier: 'workspace-write' },
      suggestedEntry: { tool: 'write', pattern: '/ws/a.txt' },
    });
    const askedBefore = rec.asked.length;
    const second = await service.ask({
      summary: '写入 /ws/a.txt',
      stickyKey: { target: '/ws/a.txt', tier: 'workspace-write' },
      suggestedEntry: { tool: 'write', pattern: '/ws/a.txt' },
    });
    expect(second.outcome).toBe('allowed-once');
    expect(second.source).toBe('sticky');
    expect(rec.asked.length).toBe(askedBefore);
  });

  it('B-10 收口锁：B1 路恰一笔 decided（无第二通道双写——onApprovalAlways 死路负断言）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, {
      sink: rec.sink,
      persistToolPolicy: () => undefined,
    });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'always';
      return envelope;
    });
    await service.ask({ summary: 'x', suggestedEntry: { tool: 'bash', pattern: 'git status' } });
    expect(rec.decided).toHaveLength(1);
    expect(rec.decided[0]?.decision).toBe('always');
  });

  it('A-2 reject 伴行纵深：decided 不落 updatedInput（非 approve 形不折入）', async () => {
    const dispatch = new EventDispatch();
    const rec = makeSink();
    const service = createApprovalService(dispatch, { sink: rec.sink });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, (envelope) => {
      envelope.answer = 'reject';
      envelope.decision = { updatedInput: {} };
      return envelope;
    });
    await service.ask({ summary: 'x' });
    expect(rec.decided[0]?.decision).toBe('reject');
    expect(rec.decided[0]?.updatedInput).toBeUndefined();
  });
});
