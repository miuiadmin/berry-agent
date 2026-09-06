/**
 * SDK 通道后端测试（批 13b-3——UiBackend 第三实装 + 03 §10.6 审批外推第三腿）。
 *
 * 锁四腿：①身份与能力面（唯 approval 一位）+ hasAudience 订阅探针
 * ②活体信封直推（onEnvelope → 直播腿）③审批 ask 编舞全谱——fail-closed
 * 无订阅零帧 / ask 帧指派与字段透传 / decide applied→resolve / 幂等与
 * unknown 归 superseded / abort 出账后 decide superseded / 调用方指派
 * approvalId 不改写 / 重连 onSubscribed 未决 ask 重推 / dispose 保守收场
 * ④UiCore 跨后端竞速组合（sdk 败腿 abort cancel——先答先得单测收口路）。
 *
 * 注入面全桩（mock 只停在注入位）；断言只对行为不对内部态。
 */
import { describe, expect, it } from 'vitest';
import type { UiBackend } from '../types.js';
import { AskQueue } from '../ask-queue.js';
import { UiCore } from '../ui-core.js';
import type { SdkDurableEntry, SdkWireFrame } from './protocol.js';
import { createSdkBackend, type SdkBackendHandle } from './backend.js';
import type { SdkSessionState } from './wire-core.js';

/** durable 平铺样本工厂（seq 直携） */
function entry(seq: number): SdkDurableEntry {
  return { type: 'user/message', seq, time: 1_690_000_000_000 + seq, data: {} };
}

interface Harness {
  handle: SdkBackendHandle;
  frames: SdkWireFrame[];
  sessions: Map<string, { state: SdkSessionState; highWater: number; log: SdkDurableEntry[] }>;
}

/** 装配桩（桥面最小同构——后端测试只走 hello 订阅与 ask/decide 路径） */
function createHarness(): Harness {
  const frames: SdkWireFrame[] = [];
  const sessions = new Map<string, { state: SdkSessionState; highWater: number; log: SdkDurableEntry[] }>();
  const handle = createSdkBackend({
    sink: {
      write: (frame) => {
        frames.push(frame);
        return true;
      },
    },
    submitPrompt: (input) => ({ sessionId: input.sessionId ?? 's-new' }),
    lookupDedupeKey: () => undefined,
    interruptSession: () => {},
    queryEntries: (sessionId, since) => {
      const s = sessions.get(sessionId);
      return { entries: (s?.log ?? []).filter((e) => e.seq > since && e.seq < (s?.highWater ?? 0)) };
    },
    listSessions: () => [],
    highWaterOf: (sessionId) => sessions.get(sessionId)?.highWater,
    sessionStateOf: (sessionId) => sessions.get(sessionId)?.state ?? 'missing',
    retryProbeOf: () => null,
  });
  return { handle, frames, sessions };
}

/** 标准会话 s1（open、高水位 3）+ hello 订阅（清帧——只观测后续） */
function subscribeS1(h: Harness): void {
  h.sessions.set('s1', { state: 'open', highWater: 3, log: [entry(0), entry(1), entry(2)] });
  h.handle.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' });
  h.frames.length = 0;
}

describe('身份与能力面 + 观众探针', () => {
  it('id=sdk、唯 approval 一位 true（线协议无其余原语帧词汇）', () => {
    const h = createHarness();
    expect(h.handle.backend.id).toBe('sdk');
    expect(h.handle.backend.capabilities).toEqual({
      notify: false,
      confirm: false,
      select: false,
      input: false,
      approval: true,
      setStatus: false,
      setWidget: false,
    });
  });

  it('hasAudience 随订阅翻转：零订阅假 → hello 订阅真', () => {
    const h = createHarness();
    expect(h.handle.backend.hasAudience()).toBe(false);
    subscribeS1(h);
    expect(h.handle.backend.hasAudience()).toBe(true);
  });

  it('onEnvelope 直推直播腿：订阅会话出 event 帧（seq=高水位）；未订阅丢弃', () => {
    const h = createHarness();
    subscribeS1(h);
    h.handle.backend.onEnvelope!({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0]).toMatchObject({ kind: 'event', sessionId: 's1', seq: 3 });
    h.handle.backend.onEnvelope!({ sessionId: 'nope', event: { type: 'agent_start' } }, false);
    expect(h.frames).toHaveLength(1); // 未订阅会话 pushEvent 丢弃
  });
});

describe('审批 ask 编舞（03 §10.6 第三腿——独立帧族 + 幂等 decide）', () => {
  it('fail-closed：无订阅者立即 cancel、零帧出站（headless 不豁免）', async () => {
    const h = createHarness();
    h.sessions.set('s1', { state: 'open', highWater: 0, log: [] }); // 在册未订阅
    await expect(h.handle.backend.askApproval!('s1', { summary: '写文件' })).resolves.toBe('cancel');
    expect(h.frames).toEqual([]);
  });

  it('ask 帧指派 approvalId（sdk-N 计数）+ 在场字段全透传、缺席字段不携带', () => {
    const h = createHarness();
    subscribeS1(h);
    void h.handle.backend.askApproval!('s1', {
      summary: '写文件 /tmp/x',
      reason: '越过工作区边界',
      toolName: 'write',
      suggestedEntry: '/tmp/x',
    });
    expect(h.frames).toEqual([
      {
        kind: 'ask',
        sessionId: 's1',
        approvalId: 'sdk-1',
        summary: '写文件 /tmp/x',
        reason: '越过工作区边界',
        toolName: 'write',
        suggestedEntry: '/tmp/x',
      },
    ]);
    // 第二枚计数推进；缺席可选字段不携带（本例不结算——promise 永悬无 rejection）
    void h.handle.backend.askApproval!('s1', { summary: '二' });
    expect(h.frames[1]).toEqual({ kind: 'ask', sessionId: 's1', approvalId: 'sdk-2', summary: '二' });
  });

  it('decide applied：promise resolve 应答值 + decide-result applied 回执', async () => {
    const h = createHarness();
    subscribeS1(h);
    const p = h.handle.backend.askApproval!('s1', { summary: '删文件' });
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'always', note: '信任' });
    await expect(p).resolves.toBe('always');
    expect(h.frames.at(-1)).toEqual({ kind: 'decide-result', approvalId: 'sdk-1', outcome: 'applied' });
  });

  it('幂等账：已决后再 decide 同 id → superseded（promise 不二次结算）', async () => {
    const h = createHarness();
    subscribeS1(h);
    const p = h.handle.backend.askApproval!('s1', { summary: '一' });
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'approve' });
    await expect(p).resolves.toBe('approve');
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'reject' });
    expect(h.frames.at(-1)).toEqual({ kind: 'decide-result', approvalId: 'sdk-1', outcome: 'superseded' });
    await expect(p).resolves.toBe('approve'); // 首答胜出不变
  });

  it('unknown approvalId decide → superseded', () => {
    const h = createHarness();
    subscribeS1(h);
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'ghost', answer: 'approve' });
    expect(h.frames).toEqual([{ kind: 'decide-result', approvalId: 'ghost', outcome: 'superseded' }]);
  });

  it('signal abort：cancel 保守收场 + 出账——后续 decide 归 superseded', async () => {
    const h = createHarness();
    subscribeS1(h);
    const ac = new AbortController();
    const p = h.handle.backend.askApproval!('s1', { summary: '写' }, { signal: ac.signal });
    ac.abort();
    await expect(p).resolves.toBe('cancel');
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'approve' });
    expect(h.frames.at(-1)).toMatchObject({ kind: 'decide-result', outcome: 'superseded' });
  });

  it('调用方指派 approvalId 在场不改写（透传为帧身份）', () => {
    const h = createHarness();
    subscribeS1(h);
    void h.handle.backend.askApproval!('s1', { summary: '一', approvalId: 'conv-42' });
    expect(h.frames[0]).toMatchObject({ kind: 'ask', approvalId: 'conv-42' });
  });

  it('重连补推：同会话再 hello 落订阅 → 未决 ask 全量重推（异会话不推）', async () => {
    const h = createHarness();
    subscribeS1(h);
    void h.handle.backend.askApproval!('s1', { summary: '未决一' });
    void h.handle.backend.askApproval!('s1', { summary: '未决二' });
    h.frames.length = 0;
    h.sessions.set('s2', { state: 'open', highWater: 0, log: [] });
    h.handle.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's2' }); // 异会话订阅
    expect(h.frames.filter((f) => f.kind === 'ask')).toEqual([]);
    h.handle.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' }); // 重订
    expect(h.frames.filter((f) => f.kind === 'ask').map((f) => (f as { summary: string }).summary)).toEqual([
      '未决一',
      '未决二',
    ]);
    // 已决者不重推：应答其一后再重订，只余未决
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'approve' });
    h.frames.length = 0;
    h.handle.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' });
    expect(h.frames.filter((f) => f.kind === 'ask')).toHaveLength(1);
  });

  it('dispose：在飞 ask 全部 cancel 收场 + core.close（后续 push/decide 静默）', async () => {
    const h = createHarness();
    subscribeS1(h);
    const p = h.handle.backend.askApproval!('s1', { summary: '在飞' });
    h.handle.dispose();
    await expect(p).resolves.toBe('cancel');
    h.frames.length = 0;
    h.handle.backend.onEnvelope!({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'approve' });
    expect(h.frames).toEqual([]);
  });
});

describe('UiCore 跨后端竞速组合（先答先得——sdk 败腿 abort 收口）', () => {
  it('恒答 approve 的假 TUI 先答 → ui.askApproval 落 approve；sdk 侧出账后 decide superseded', async () => {
    const h = createHarness();
    subscribeS1(h);
    h.frames.length = 0;
    const fakeTui: UiBackend<never> = {
      id: 'tui-fake',
      capabilities: {
        notify: false,
        confirm: false,
        select: false,
        input: false,
        approval: true,
        setStatus: false,
        setWidget: false,
      },
      hasAudience: () => true,
      notify: () => {},
      askApproval: async () => 'approve',
    };
    const ui = new UiCore(() => [h.handle.backend, fakeTui], new AskQueue());
    await expect(ui.askApproval('s1', { summary: '竞速' })).resolves.toBe('approve');
    // sdk 腿 ask 帧已出站、败腿 abort 已出账——迟到 decide 归 superseded
    expect(h.frames[0]).toMatchObject({ kind: 'ask', approvalId: 'sdk-1' });
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'reject' });
    expect(h.frames.at(-1)).toMatchObject({ kind: 'decide-result', outcome: 'superseded' });
  });

  it('sdk 独场（无其他 capable 后端）：decide 是唯一应答路——reject 透传', async () => {
    const h = createHarness();
    subscribeS1(h);
    const ui = new UiCore(() => [h.handle.backend], new AskQueue());
    const p = ui.askApproval('s1', { summary: '独场' });
    await Promise.resolve(); // 入队 start 同步已发——ask 帧落 sink
    expect(h.frames[0]).toMatchObject({ kind: 'ask', sessionId: 's1' });
    h.handle.core.handleRequest({ verb: 'decide', approvalId: 'sdk-1', answer: 'reject' });
    await expect(p).resolves.toBe('reject');
  });
});
