/**
 * SDK 线协议核心测试（03 篇 §10.6 线协议七原则运转面——批 13b-2）。
 *
 * 锁九腿：①hello 版本握手/连接级/订阅三步（hello→重放→replay-end→挂直播）
 * ②游标三查执法（越界拒订阅）③prompt admit 三档（连接内快速档 + durable
 * 跨重启档 + 冲突拒收）④自动订阅（ack 携句柄事件即流）⑤interrupt/decide/
 * getEntries/sessions 四动词受理 ⑥心跳静默填充（三阶段推导 + retry probe
 * 优先 + 假钟推进）⑦noDelta 退订 ⑧背压 shedding（纯活体帧让位）/过载断连
 * （线控帧不可丢）/FIFO drain ⑨closed 后残行同码直写重申。
 *
 * 注入面全桩（mock 只停在注入位——组合根纪律）；时钟假钟注入确定性。
 */
import { describe, expect, it } from 'vitest';
import type { RetryProbe } from '../../contracts/index.js';
import type { SdkDurableEntry, SdkWireFrame } from './protocol.js';
import { SdkWireCore, type SdkSessionState, type SdkSubmitInput, type SdkWireOptions } from './wire-core.js';

/** durable 平铺样本工厂（seq 直携——窗口切片按 seq 判） */
function entry(seq: number, type = 'user/message'): SdkDurableEntry {
  return { type, seq, time: 1_690_000_000_000 + seq, data: { seq } };
}

/** 流式消息最小合法桩（CustomMessage 域名两段式——形状纪律面最小形） */
function partialMsg(): { role: string; content: unknown; timestamp: number } {
  return { role: 'test/partial', content: '', timestamp: 0 };
}

/** 会话台账桩（状态/高水位/日志/dedupe 索引——装配桥 13c 的最小同构） */
interface SessionStub {
  state: SdkSessionState;
  highWater: number;
  log: SdkDurableEntry[];
  dedupe: Map<string, string>;
}

interface Harness {
  core: SdkWireCore;
  /** sink 受纳帧账（write 返回 true 的帧） */
  frames: SdkWireFrame[];
  /** sink 尝试账（含被拒帧——过载直写/断连重申的观测位） */
  attempted: SdkWireFrame[];
  calls: {
    submit: SdkSubmitInput[];
    interrupt: string[];
    decide: Array<{ approvalId: string; answer: string; note?: string }>;
    subscribed: string[];
    overload: number[];
  };
  sessions: Map<string, SessionStub>;
  retryProbes: Map<string, RetryProbe | null>;
  clock: { now: number };
  setSinkWritable: (writable: boolean) => void;
  /** decide 应答档序（逐次弹尽后恒 applied） */
  decideOutcomes: Array<'applied' | 'superseded'>;
}

/** 装配桩 + 受检核（全注入面记账——断言只对行为不对内部态） */
function createHarness(
  options?: SdkWireOptions & {
    sinkWritable?: boolean;
    submitOutcome?: { sessionId: string; routedChannel?: 'steer' | 'followUp' };
  },
): Harness {
  const frames: SdkWireFrame[] = [];
  const attempted: SdkWireFrame[] = [];
  let sinkWritable = options?.sinkWritable ?? true;
  const h: Harness = {
    frames,
    attempted,
    calls: { submit: [], interrupt: [], decide: [], subscribed: [], overload: [] },
    sessions: new Map(),
    retryProbes: new Map(),
    clock: { now: 1_000_000 },
    setSinkWritable: (w) => {
      sinkWritable = w;
    },
    decideOutcomes: [],
    core: undefined!,
  };
  h.core = new SdkWireCore(
    {
      sink: {
        write: (frame) => {
          attempted.push(frame);
          if (!sinkWritable) return false;
          frames.push(frame);
          return true;
        },
      },
      submitPrompt: (input) => {
        h.calls.submit.push(input);
        const sid = input.sessionId ?? 's-new';
        // 桩侧落账新会话（装配桥同构——fresh 受理后会话即在册，重发反查定位可过状态门）
        if (!h.sessions.has(sid)) {
          h.sessions.set(sid, { state: 'open', highWater: 0, log: [], dedupe: new Map() });
        }
        return options?.submitOutcome ?? { sessionId: sid };
      },
      lookupDedupeKey: (sessionId, messageId) => h.sessions.get(sessionId)?.dedupe.get(messageId),
      interruptSession: (sessionId) => {
        h.calls.interrupt.push(sessionId);
      },
      queryEntries: (sessionId, since) => {
        const s = h.sessions.get(sessionId);
        // 窗口 (since, 高水位)——高水位 = 下一将分配 seq，无事件占位（文件头约定）
        return { entries: (s?.log ?? []).filter((e) => e.seq > since && e.seq < s!.highWater) };
      },
      listSessions: () => [],
      highWaterOf: (sessionId) => h.sessions.get(sessionId)?.highWater,
      sessionStateOf: (sessionId) => h.sessions.get(sessionId)?.state ?? 'missing',
      retryProbeOf: (sessionId) => h.retryProbes.get(sessionId) ?? null,
      decideApproval: (approvalId, answer, note) => {
        h.calls.decide.push({ approvalId, answer, note });
        return h.decideOutcomes.shift() ?? 'applied';
      },
      onSubscribed: (sessionId) => {
        h.calls.subscribed.push(sessionId);
      },
      onOverload: (retryAfterMs) => {
        h.calls.overload.push(retryAfterMs);
      },
    },
    { now: () => h.clock.now, heartbeatIntervalMs: 5_000, overloadRetryAfterMs: 777, ...options },
  );
  return h;
}

/** 标准会话 s1：durable 三条（seq 0..2）/高水位 3 */
function seedS1(h: Harness, overrides?: Partial<SessionStub>): void {
  h.sessions.set('s1', {
    state: 'open',
    highWater: 3,
    log: [entry(0), entry(1), entry(2)],
    dedupe: new Map(),
    ...overrides,
  });
}

describe('hello 腿（⑤ 版本握手 + ③ 订阅三步 + 游标执法）', () => {
  it('版本不符拒连：SDK_PROTOCOL_MISMATCH 错误帧，残行同码直写重申', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'hello', protocolVersion: 9 });
    expect(h.frames[0]).toMatchObject({ kind: 'error', code: 'SDK_PROTOCOL_MISMATCH' });
    h.core.handleRequest({ verb: 'sessions' }); // 残行——同码直写重申（不经队列）
    expect(h.frames).toHaveLength(2);
    expect(h.frames[1]).toMatchObject({ kind: 'error', code: 'SDK_PROTOCOL_MISMATCH' });
    expect(h.frames.some((f) => f.kind === 'sessions')).toBe(false);
  });

  it('连接级握手（无会话订阅）：hello 帧 sessionId 空串、高水位 0', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, noDelta: true });
    expect(h.frames).toEqual([{ kind: 'hello', protocolVersion: 1, sessionId: '', highWaterSeq: 0 }]);
    expect(h.calls.subscribed).toEqual([]);
  });

  it('订阅三步：hello（高水位）→ entries 窗口投影 → replay-end（重放尾=末条 seq）→ onSubscribed', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1', after: 1 });
    expect(h.frames.map((f) => f.kind)).toEqual(['hello', 'entries', 'replay-end']);
    expect(h.frames[0]).toMatchObject({ sessionId: 's1', highWaterSeq: 3 });
    expect(h.frames[1]).toMatchObject({ entries: [entry(2)] });
    expect(h.frames[2]).toMatchObject({ lastReplayedSeq: 2 });
    expect(h.calls.subscribed).toEqual(['s1']);
  });

  it('完全追平档（after=末条 seq）：空窗不发 entries 帧，replay-end 尾=after 原值', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1', after: 2 });
    expect(h.frames.map((f) => f.kind)).toEqual(['hello', 'replay-end']);
    expect(h.frames[1]).toMatchObject({ lastReplayedSeq: 2 });
  });

  it('after 缺席 = 只直播：replay-end 尾 −1 仍发（订阅受理界标确定性）', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' });
    expect(h.frames.map((f) => f.kind)).toEqual(['hello', 'replay-end']);
    expect(h.frames[1]).toMatchObject({ lastReplayedSeq: -1 });
  });

  it('after ≥ 高水位：SDK_CURSOR_INVALID 拒订阅（不挂监听——push 无帧）', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1', after: 3 });
    expect(h.frames.at(-1)).toMatchObject({ kind: 'error', code: 'SDK_CURSOR_INVALID' });
    expect(h.calls.subscribed).toEqual([]);
    h.core.pushEvent('s1', { type: 'agent_start' });
    expect(h.frames).toHaveLength(2); // hello + error——未订阅 push 丢弃
  });

  it('missing 会话订阅：SESSION_NOT_FOUND', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 'nope' });
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0]).toMatchObject({ kind: 'error', code: 'SESSION_NOT_FOUND', sessionId: 'nope' });
  });
});

describe('prompt 腿（④ admit 三档 + 自动订阅 + 会话受理门）', () => {
  it('fresh 新会话：桥受理 → ack 携桥落定句柄 → 自动订阅（push 即流）', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'prompt', messageId: 'm-1', content: '帮我看看' });
    expect(h.calls.submit).toEqual([{ sessionId: undefined, content: '帮我看看', messageId: 'm-1' }]);
    expect(h.frames).toEqual([
      { kind: 'ack', sessionId: 's-new', messageId: 'm-1', duplicate: false, highWaterSeq: 0 },
    ]);
    expect(h.calls.subscribed).toEqual(['s-new']);
    h.core.pushEvent('s-new', { type: 'agent_start' });
    expect(h.frames[1]).toMatchObject({ kind: 'event', sessionId: 's-new', seq: 0 }); // 桩高水位缺省 0
  });

  it('连接内快速档幂等：同键同内容重发 duplicate=true 且不再受理', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'prompt', messageId: 'm-1', content: 'a' });
    h.core.handleRequest({ verb: 'prompt', messageId: 'm-1', content: 'a' });
    expect(h.calls.submit).toHaveLength(1);
    expect(h.frames.at(-1)).toMatchObject({ kind: 'ack', duplicate: true, messageId: 'm-1' });
  });

  it('durable 跨重启档：连接首见键经 lookupDedupeKey 命中同内容 = duplicate 不重跑', () => {
    const h = createHarness();
    seedS1(h, { dedupe: new Map([['m-x', '旧内容']]) });
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-x', content: '旧内容' });
    expect(h.calls.submit).toEqual([]);
    expect(h.frames.at(-1)).toMatchObject({
      kind: 'ack',
      sessionId: 's1',
      messageId: 'm-x',
      duplicate: true,
      highWaterSeq: 3,
    });
    // 种子入账后重发走连接内快速档（同一判定）
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-x', content: '旧内容' });
    expect(h.calls.submit).toEqual([]);
  });

  it('同键异内容 = SDK_MESSAGE_CONFLICT 拒收（durable 命中异内容）', () => {
    const h = createHarness();
    seedS1(h, { dedupe: new Map([['m-x', '旧内容']]) });
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-x', content: '新内容' });
    expect(h.calls.submit).toEqual([]);
    expect(h.frames.at(-1)).toMatchObject({ kind: 'error', code: 'SDK_MESSAGE_CONFLICT', sessionId: 's1' });
  });

  it('显式会话受理门：missing → SESSION_NOT_FOUND；closed → SESSION_CLOSED（均不受理）', () => {
    const h = createHarness();
    seedS1(h);
    h.sessions.set('s-closed', { state: 'closed', highWater: 1, log: [entry(0)], dedupe: new Map() });
    h.core.handleRequest({ verb: 'prompt', sessionId: 'nope', messageId: 'm', content: 'x' });
    expect(h.frames.at(-1)).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    h.core.handleRequest({ verb: 'prompt', sessionId: 's-closed', messageId: 'm', content: 'x' });
    expect(h.frames.at(-1)).toMatchObject({ code: 'SESSION_CLOSED' });
    expect(h.calls.submit).toEqual([]);
  });

  it('routedChannel 观察字段透传（驱动侧单源路由——ack 回示非控制）', () => {
    const h = createHarness({ submitOutcome: { sessionId: 's1', routedChannel: 'steer' } });
    seedS1(h);
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-2', content: '并发注入' });
    expect(h.frames.at(-1)).toMatchObject({ kind: 'ack', sessionId: 's1', routedChannel: 'steer', duplicate: false });
  });

  it('prompt 不覆写既有 hello 订阅（订阅参数胜出——noDelta 不被连接缺省冲掉）', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1', noDelta: true });
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-3', content: 'x' });
    expect(h.calls.subscribed).toEqual(['s1']); // 既有订阅不重挂
    h.core.pushEvent('s1', { type: 'message_update', role: 'assistant', partial: partialMsg() });
    expect(h.frames.filter((f) => f.kind === 'event')).toEqual([]); // hello 订阅的 noDelta 仍执法
    h.core.pushEvent('s1', { type: 'message_end', message: partialMsg() });
    expect(h.frames.filter((f) => f.kind === 'event')).toHaveLength(1); // 定稿锚定帧不受 noDelta 影响
  });
});

describe('interrupt / decide / getEntries / sessions 四动词', () => {
  it('interrupt：受理无应答帧（经事件流可观察）；missing 拒', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'interrupt', sessionId: 's1' });
    expect(h.calls.interrupt).toEqual(['s1']);
    expect(h.frames).toEqual([]);
    h.core.handleRequest({ verb: 'interrupt', sessionId: 'nope' });
    expect(h.frames.at(-1)).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('decide：decide-result 回执（applied / superseded 两档透传 + note 过桥）', () => {
    const h = createHarness();
    h.decideOutcomes.push('superseded');
    h.core.handleRequest({ verb: 'decide', approvalId: 'a-1', answer: 'always', note: '信任此工具' });
    expect(h.calls.decide).toEqual([{ approvalId: 'a-1', answer: 'always', note: '信任此工具' }]);
    expect(h.frames).toEqual([{ kind: 'decide-result', approvalId: 'a-1', outcome: 'superseded' }]);
    h.core.handleRequest({ verb: 'decide', approvalId: 'a-2', answer: 'reject' });
    expect(h.frames.at(-1)).toMatchObject({ approvalId: 'a-2', outcome: 'applied' }); // 档序尽回缺省
  });

  it('getEntries：窗口投影 + 游标执法（since 越高水位 = SDK_CURSOR_INVALID）', () => {
    const h = createHarness();
    seedS1(h);
    // after/since = 已收末 seq（0 基）：since 0 = 已收 seq 0 → 窗口 {1,2}；−1 = 全量
    h.core.handleRequest({ verb: 'getEntries', sessionId: 's1', since: 0 });
    expect(h.frames.at(-1)).toMatchObject({
      kind: 'entries',
      sessionId: 's1',
      entries: [entry(1), entry(2)],
    });
    h.core.handleRequest({ verb: 'getEntries', sessionId: 's1', since: -1 });
    expect(h.frames.at(-1)).toMatchObject({ entries: [entry(0), entry(1), entry(2)] });
    h.core.handleRequest({ verb: 'getEntries', sessionId: 's1', since: 3 });
    expect(h.frames.at(-1)).toMatchObject({ kind: 'error', code: 'SDK_CURSOR_INVALID' });
    h.core.handleRequest({ verb: 'getEntries', sessionId: 'nope', since: 0 });
    expect(h.frames.at(-1)).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('sessions：清单帧直出', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'sessions' });
    expect(h.frames).toEqual([{ kind: 'sessions', sessions: [] }]);
  });
});

describe('心跳腿（② 静默填充 + 三阶段推导 + retry probe 优先）', () => {
  function subscribe(h: Harness): void {
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' });
    h.frames.length = 0; // 清握手帧——只观测心跳/事件
  }

  it('running + thinking：静默超阈即拍，elapsedMs 假钟推进', () => {
    const h = createHarness();
    seedS1(h);
    subscribe(h);
    h.core.pushEvent('s1', { type: 'agent_start' }); // t=1_000_000 起跑
    h.core.pushEvent('s1', { type: 'message_start', role: 'assistant' });
    h.frames.length = 0; // 清事件帧账——只观测心跳
    h.clock.now += 4_999;
    h.core.heartbeatTick();
    expect(h.frames).toEqual([]); // 未超阈不补拍（事件帧已刷静默账）
    h.clock.now += 1;
    h.core.heartbeatTick();
    expect(h.frames).toEqual([
      { kind: 'heartbeat', sessionId: 's1', runState: 'running', stage: { type: 'thinking' }, elapsedMs: 5_000 },
    ]);
  });

  it('tool 阶段：工具名 + 阶段耗时（stageElapsedMs = now − since）', () => {
    const h = createHarness();
    seedS1(h);
    subscribe(h);
    h.core.pushEvent('s1', { type: 'agent_start' });
    h.core.pushEvent('s1', { type: 'tool_execution_start', toolCallId: 'tc-1', name: 'write', arguments: {} });
    h.frames.length = 0;
    h.clock.now += 5_000;
    h.core.heartbeatTick();
    expect(h.frames[0]).toMatchObject({
      kind: 'heartbeat',
      runState: 'running',
      stage: { type: 'tool', name: 'write', stageElapsedMs: 5_000 },
      elapsedMs: 5_000,
    });
  });

  it('retry probe 优先于事件推导阶段（退避等待期——非事件型源的唯一线面出口）', () => {
    const h = createHarness();
    seedS1(h);
    subscribe(h);
    h.core.pushEvent('s1', { type: 'agent_start' });
    h.core.pushEvent('s1', { type: 'message_start', role: 'assistant' }); // 事件推导 = thinking
    h.frames.length = 0;
    const probe: RetryProbe = { attempt: 1, maxAttempts: 2, nextAt: h.clock.now + 30_000 };
    h.retryProbes.set('s1', probe);
    h.clock.now += 5_000;
    h.core.heartbeatTick();
    expect(h.frames[0]).toMatchObject({ kind: 'heartbeat', stage: { type: 'retry', probe } });
  });

  it('idle：agent_end 落定尾值 elapsed、stage null；nextAt=null 的 probe 不占阶段', () => {
    const h = createHarness();
    seedS1(h);
    subscribe(h);
    h.core.pushEvent('s1', { type: 'agent_start' });
    h.clock.now += 2_000;
    h.core.pushEvent('s1', { type: 'agent_end', status: 'completed' }); // 尾值 2_000
    h.frames.length = 0;
    h.retryProbes.set('s1', { attempt: 2, maxAttempts: 2, nextAt: null }); // 不在退避等待
    h.clock.now += 5_000;
    h.core.heartbeatTick();
    expect(h.frames).toEqual([
      {
        kind: 'heartbeat',
        sessionId: 's1',
        runState: 'idle',
        stage: null,
        elapsedMs: 2_000,
      },
    ]);
  });

  it('未订阅会话不拍心跳（连接级握手零订阅——tick 无帧）', () => {
    const h = createHarness();
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1 });
    h.frames.length = 0;
    h.clock.now += 10_000;
    h.core.heartbeatTick();
    expect(h.frames).toEqual([]);
  });
});

describe('背压腿（⑦ 有界队列：shedding / 过载断连 / FIFO drain）', () => {
  it('sink 背压期入队，writable 后 drain 按序冲刷', () => {
    const h = createHarness({ sinkWritable: false });
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1', after: 1 });
    expect(h.frames).toEqual([]); // 全入队
    h.setSinkWritable(true);
    expect(h.core.drain()).toBe(3);
    expect(h.frames.map((f) => f.kind)).toEqual(['hello', 'entries', 'replay-end']);
    expect(h.core.drain()).toBe(0); // 队清
  });

  it('溢出 shedding：纯活体帧（delta/工具进度）让位，dropped 计数、无断连', () => {
    const h = createHarness({ sinkWritable: false, queueCap: 4 });
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' }); // 队 2（hello+replay-end）
    h.core.pushEvent('s1', { type: 'message_update', role: 'assistant', partial: partialMsg() });
    h.core.pushEvent('s1', { type: 'message_update', role: 'assistant', partial: partialMsg() }); // 队满 4
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-1', content: 'x' }); // ack 不可丢
    expect(h.calls.overload).toEqual([]);
    expect(h.core.droppedFrameCount).toBe(1); // 最旧 delta 被让位（较新 delta 存活）
    h.setSinkWritable(true);
    h.core.drain();
    expect(h.frames.map((f) => f.kind)).toEqual(['hello', 'replay-end', 'event', 'ack']);
  });

  it('队满无可丢可让：线控帧不可丢 ⇒ SDK_OVERLOADED 直写 + onOverload 断连档', () => {
    const h = createHarness({ sinkWritable: false, queueCap: 2 });
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' }); // 队 2（hello+replay-end——均不可丢）
    h.core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-1', content: 'x' }); // ack 入队触发过载
    expect(h.calls.overload).toEqual([777]);
    const overloadFrame = h.attempted.find((f) => f.kind === 'error' && f.code === 'SDK_OVERLOADED');
    expect(overloadFrame).toMatchObject({ code: 'SDK_OVERLOADED', willRetry: true, retryAfterMs: 777 });
    // 断连档：后续 push 静默、残行同码直写重申（宿主即将关传输）
    h.core.pushEvent('s1', { type: 'agent_start' });
    h.core.handleRequest({ verb: 'sessions' });
    expect(h.attempted.at(-1)).toMatchObject({ code: 'SDK_OVERLOADED' });
  });

  it('tool_execution_update 进度帧同属纯活体可丢档（入站自弃——最廉 shedding）', () => {
    const h = createHarness({ sinkWritable: false, queueCap: 2 });
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' }); // 队 2 满
    h.core.pushEvent('s1', { type: 'tool_execution_update', toolCallId: 'tc', update: { done: 3 } });
    expect(h.core.droppedFrameCount).toBe(1); // 队满即弃入站可丢帧
    expect(h.calls.overload).toEqual([]); // 可丢不触发过载
  });
});

describe('close 生命周期间隙', () => {
  it('宿主 close 后：push 静默、请求静默（无因收口不重申——装配纪律位）', () => {
    const h = createHarness();
    seedS1(h);
    h.core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' });
    h.frames.length = 0;
    h.attempted.length = 0; // 清订阅期账——只观测 close 后行为
    h.core.close();
    h.core.pushEvent('s1', { type: 'agent_start' });
    h.core.heartbeatTick();
    h.core.handleRequest({ verb: 'sessions' });
    expect(h.frames).toEqual([]);
    expect(h.attempted).toHaveLength(0); // 无因收口：直写重申也不发
  });
});
