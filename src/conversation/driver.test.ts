/**
 * ConversationDriver 测试 — 11c/11d 纵切全景（durable 接线 / runTurns 重试 /
 * 溢出兜底 / 队列通道 / 三通道路由与取消模型 / 唤醒预算与工具面收窄 /
 * resume 冷启动续接）。
 *
 * 纪律：mock 只停 streamFn 注入位（scripted 终值序列 + 门控挂起）——金样
 * seam 同族；session/wiring/reseed/queue/loop 全走真实现（组合根口径）。
 * 禁断言 AI 生成文本——只断言结构与编舞行为。
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  AgentTool,
  AssistantMessage,
  AssistantStream,
  AssistantStreamEvent,
  ErrorBucket,
  LlmContext,
  Message,
  StreamFn,
  StreamFnOptions,
  TextContent,
  ToolCallBlock,
} from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import type { AgentEvent } from '../agent/index.js';
import { ConversationDriver } from './driver.js';
import type { ConversationDriverOptions } from './types.js';
import { provideAgentService } from './agent-service.js';
import { createTodoTool } from './todo.js';

/* ---------------- 测试构造件 ---------------- */

/** assistant 终值构造（缺省 stop 空内容） */
function assistant(partial: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 0,
    ...partial,
  };
}

/** toolCall 块构造 */
function call(id: string, name: string): ToolCallBlock {
  return { type: 'toolCall', id, name, arguments: {} };
}

/** 最小真工具（可覆写 execute） */
function makeTool(name: string, execute?: AgentTool['execute']): AgentTool {
  return {
    name,
    description: '测试工具',
    parameters: { type: 'object' },
    execute: execute ?? (async () => ({ content: [{ type: 'text', text: 'ok' } satisfies TextContent] })),
  };
}

/** 单次流（真协议形状：start → delta → done/error） */
function makeStream(final: AssistantMessage): AssistantStream {
  const partial = { ...final, content: [...final.content] };
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
      yield { type: 'start', partial };
      yield { type: 'text_delta', contentIndex: 0, delta: 'x', partial };
      if (final.stopReason === 'error' || final.stopReason === 'aborted') {
        yield { type: 'error', reason: final.stopReason, error: final };
      } else {
        yield { type: 'done', reason: final.stopReason as 'stop', message: final };
      }
    },
    result: async () => final,
  };
}

/**
 * scripted streamFn：第 i 次调用产 scripts[i] 终值；gates[i] 提供时先挂起
 * （busy 注入窗口的时序控制面）。seen 记录每次请求的 LlmContext（断言面）。
 */
function scriptedStreamFn(
  scripts: AssistantMessage[],
  options?: { gates?: Array<Promise<void> | undefined>; seen?: LlmContext[] },
): StreamFn {
  const gates = options?.gates ?? [];
  const seen = options?.seen ?? [];
  let i = 0;
  return (context: LlmContext, _options: StreamFnOptions): AssistantStream => {
    seen.push(context);
    const final = scripts[i];
    const gate = gates[i];
    i += 1;
    if (!final) throw new Error(`脚本耗尽（第 ${i} 次调用无终值）`);
    if (!gate) return makeStream(final);
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
        await gate;
        yield* makeStream(final);
      },
      result: async () => final,
    };
  };
}

/** 缺省 convertToLlm：标准直通、自定义剥离（null） */
const passthrough = (m: import('../contracts/index.js').AgentMessage): Message | null =>
  isStandardMessage(m) ? m : null;

/** 驱动测试台（每用例新建——真 session + 真 wiring + 外部事件收集） */
function makeDriver(
  overrides?: Partial<ConversationDriverOptions> & {
    scripts?: AssistantMessage[];
    gates?: Array<Promise<void> | undefined>;
    seen?: LlmContext[];
  },
): { driver: ConversationDriver; live: AgentEvent[]; seen: LlmContext[] } {
  const seen: LlmContext[] = [];
  const live: AgentEvent[] = [];
  const { scripts, gates, ...rest } = overrides ?? {};
  const driver = new ConversationDriver({
    session: new SessionLog({ sessionId: 's-driver' }),
    scope: Scope.createRoot(),
    dispatch: new EventDispatch(),
    streamFn: scriptedStreamFn(scripts ?? [], { gates, seen }),
    convertToLlm: passthrough,
    model: 'test/model',
    systemPrompt: 'sys',
    onEvent: (event) => void live.push(event),
    ...rest,
  });
  return { driver, live, seen };
}

/** durable 事件类型序（断言简写） */
function types(driver: ConversationDriver): string[] {
  return driver.session.events().map((event) => event.type);
}

/** 按类型取 durable 事件 data（断言简写——重复型取全部） */
function dataOf(driver: ConversationDriver, type: string): unknown[] {
  return driver.session
    .events()
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

/* ---------------- durable 接线（正路径族） ---------------- */

describe('ConversationDriver durable 接线', () => {
  it('一问一答：durable 序 = user/message → turn/start → request/header(initial) → assistant/message → turn/end(completed)', async () => {
    const { driver } = makeDriver({ scripts: [assistant({ content: [{ type: 'text', text: '答' }] })] });
    const result = await driver.submit('问');
    expect(result.status).toBe('completed');
    expect(types(driver)).toEqual(['user/message', 'turn/start', 'request/header', 'assistant/message', 'turn/end']);
    // header 边界制：首请求 initial 形，快照含 model/systemPrompt/空工具面
    expect(dataOf(driver, 'request/header')).toEqual([
      { config: { model: 'test/model' }, systemPrompt: 'sys', toolSchemas: [], reason: 'initial' },
    ]);
    expect(dataOf(driver, 'turn/end')).toEqual([{ reason: 'completed' }]);
    // 投影形状：user + assistant 各一
    const projection = driver.session.projection();
    expect(projection.map((m) => m.type)).toEqual(['user', 'assistant']);
  });

  it('工具批：一 durable turn 内 assistant/toolCall/toolResult/二 assistant（turn_end=toolUse 不闭）', async () => {
    const { driver, seen } = makeDriver({
      scripts: [
        assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }),
        assistant({ content: [{ type: 'text', text: '收' }] }),
      ],
      tools: [makeTool('probe')],
    });
    const result = await driver.submit('跑工具');
    expect(result.status).toBe('completed');
    expect(types(driver)).toEqual([
      'user/message',
      'turn/start',
      'request/header',
      'assistant/message',
      'tool/call',
      'tool/result',
      'assistant/message',
      'turn/end',
    ]);
    // tool/call 分立落账（arguments 回写串）
    expect(dataOf(driver, 'tool/call')).toEqual([{ toolCallId: 't1', name: 'probe', arguments: '{}' }]);
    // 工具面进 header 快照
    const headers = dataOf(driver, 'request/header') as Array<{ toolSchemas: Array<{ name: string }> }>;
    expect(headers[0]!.toolSchemas.map((t) => t.name)).toEqual(['probe']);
    // LLM 请求两次（工具批后第二轮），header 只一条（稳态不落——边界制）
    expect(seen).toHaveLength(2);
    expect(types(driver).filter((t) => t === 'request/header')).toHaveLength(1);
    expect(dataOf(driver, 'turn/end')).toEqual([{ reason: 'completed' }]);
  });

  it('length 路径：合成配对 toolResult 落 turn 内 + turn/end(max-tokens) 安全网 + failed 零 llm/retry', async () => {
    const { driver } = makeDriver({
      scripts: [assistant({ stopReason: 'length', content: [call('t1', 'probe')] })],
      tools: [makeTool('probe')],
    });
    const result = await driver.submit('长输出');
    // run 终态判别收窄（11d 起 SubmitResult 含通道收执两形——toMatchObject 免收窄）
    expect(result).toMatchObject({ status: 'failed', stopReason: 'length' });
    expect(types(driver)).toEqual([
      'user/message',
      'turn/start',
      'request/header',
      'assistant/message',
      'tool/call',
      'tool/result',
      'turn/end',
    ]);
    // 配对结果 isError 落账（error: true）——合成文案是本仓常数，不锁字面只锁形状
    const results = dataOf(driver, 'tool/result') as Array<{ toolCallId: string; error?: boolean }>;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolCallId: 't1', error: true });
    expect(dataOf(driver, 'turn/end')).toEqual([{ reason: 'max-tokens' }]);
    expect(types(driver)).not.toContain('llm/retry');
  });

  it('活体事件双腿：外部汇收到 10 型流（durable 只落消息级终值与轮边界）', async () => {
    const { driver, live } = makeDriver({
      scripts: [assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }), assistant({})],
      tools: [makeTool('probe')],
    });
    await driver.submit('q');
    const liveTypes = live.map((e) => e.type);
    // 活体面有流式与执行事件（message_start/update、tool_execution_*、agent_*）
    for (const expected of [
      'agent_start',
      'turn_start',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_end',
      'turn_end',
      'agent_end',
    ]) {
      expect(liveTypes).toContain(expected);
    }
    // durable 面恒小于活体面（分层不变式：delta 不落日志）
    expect(driver.session.events().length).toBeLessThan(live.length);
  });
});

/* ---------------- runTurns 重试（04 §3.3）与溢出兜底（04 §3.4） ---------------- */

describe('ConversationDriver turn 级 auto-retry', () => {
  /** transient 分桶器（errorMessage 带 #transient 标记即 transient 桶） */
  const transientBucket = (message: AssistantMessage): ErrorBucket =>
    message.errorMessage?.includes('#transient') ? 'transient' : 'non-retryable';

  it('transient 全链：遮蔽区间+surfaceOp+溯源 → 投影摘除 → header(resume) → completed', async () => {
    const { driver } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'net down #transient' }),
        assistant({ content: [{ type: 'text', text: '好了' }] }),
      ],
      classifyError: transientBucket,
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    });
    const result = await driver.submit('q');
    expect(result.status).toBe('completed');
    expect(types(driver)).toEqual([
      'user/message',
      'turn/start',
      'request/header',
      'assistant/message',
      'turn/end',
      'llm/retry',
      'turn/start',
      'request/header',
      'assistant/message',
      'turn/end',
    ]);
    // 遮蔽信封：区间 = [错误 assistant seq=3, 高水位=turn/end seq=4]；溯源全列
    const retryEvent = driver.session.events().find((event) => event.type === 'llm/retry')!;
    expect(retryEvent.data).toMatchObject({ attempt: 1, maxAttempts: 1, phase: 'scheduled' });
    expect(typeof (retryEvent.data as { delayMs: number }).delayMs).toBe('number');
    expect(retryEvent.surfaceOp).toEqual({ op: 'replace', start: 3, end: 4 });
    expect(retryEvent.sourceEventSeqs).toEqual([3, 4]);
    // 重开 turn 的 header 落 resume 形（timeline 重建后的首请求）
    expect(dataOf(driver, 'request/header').map((d) => (d as { reason: string }).reason)).toEqual([
      'initial',
      'resume',
    ]);
    // 投影摘除：错误 assistant 不在（只剩 user + 成功 assistant）
    const projection = driver.session.projection();
    expect(projection.map((m) => m.type)).toEqual(['user', 'assistant']);
    expect((projection[1] as { stopReason?: string }).stopReason).toBe('stop');
  });

  it('transient 达帽：exhausted 落账（attempt=已消费）+ 末次错误 assistant 留投影', async () => {
    const { driver } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'net down #transient' }),
        assistant({ stopReason: 'error', errorMessage: 'still down #transient' }),
      ],
      classifyError: transientBucket,
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    });
    const result = await driver.submit('q');
    expect(result.status).toBe('failed');
    const retries = dataOf(driver, 'llm/retry');
    expect(retries).toHaveLength(2); // scheduled + exhausted
    expect(retries[1]).toMatchObject({
      attempt: 1,
      maxAttempts: 1,
      delayMs: 0,
      phase: 'exhausted',
      errorMessage: 'still down #transient',
    });
    // 末次错误 assistant 留投影（遮蔽只盖第一次失败）
    const projection = driver.session.projection();
    expect(projection[projection.length - 1]).toMatchObject({ type: 'assistant', stopReason: 'error' });
  });

  it('classifyError 缺席 = 一切 non-retryable：零 llm/retry 事件、错误 assistant 留投影', async () => {
    const { driver } = makeDriver({
      scripts: [assistant({ stopReason: 'error', errorMessage: 'quota exceeded' })],
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    });
    const result = await driver.submit('q');
    expect(result.status).toBe('failed');
    expect(types(driver)).not.toContain('llm/retry');
    expect(driver.session.projection().map((m) => m.type)).toEqual(['user', 'assistant']);
  });

  it('quota 桶：不可重试（零事件直接终态）', async () => {
    const { driver } = makeDriver({
      scripts: [assistant({ stopReason: 'error', errorMessage: 'quota' })],
      classifyError: () => 'quota',
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    });
    const result = await driver.submit('q');
    expect(result.status).toBe('failed');
    expect(types(driver)).not.toContain('llm/retry');
  });

  it('退避中止：abort() → llm/retry(aborted) 落账 + run 终态 failed', async () => {
    const { driver } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'net down #transient' }),
        assistant({ content: [{ type: 'text', text: '不应到达' }] }),
      ],
      classifyError: transientBucket,
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 60_000 }, // 退避窗口内 abort
    });
    const pending = driver.submit('q');
    // 等遮蔽落账（scheduled 已现 = 已进退避睡眠）
    await vi.waitFor(() => {
      expect(types(driver)).toContain('llm/retry');
    });
    driver.abort();
    const result = await pending;
    expect(result.status).toBe('failed');
    const retries = dataOf(driver, 'llm/retry');
    expect(retries).toHaveLength(2);
    expect(retries[1]).toMatchObject({ attempt: 1, maxAttempts: 1, phase: 'aborted' });
    // 续入未发生（第二条脚本未消费——streamFn 只被调一次）
    expect(types(driver).filter((t) => t === 'assistant/message')).toHaveLength(1);
  });

  it('重试探针 seam（04 §3.3 只读小面——SDK 心跳载荷唯一线面出口，批 13a）', async () => {
    // —— 闲态：无 run 即无探针 ——
    const idleDriver = makeDriver({ scripts: [] }).driver;
    expect(idleDriver.retryState).toBeNull();

    // —— 窗开：退避等待期可观测 attempt/maxAttempts/nextAt；run 收口即蒸发 ——
    const { driver } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'net down #transient' }),
        assistant({ content: [{ type: 'text', text: '好了' }] }),
      ],
      classifyError: transientBucket,
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 60_000 }, // 长窗保证观测点落在退避期内
    });
    const before = Date.now();
    const pending = driver.submit('q');
    await vi.waitFor(() => {
      expect(driver.retryState).not.toBeNull();
    });
    const probe = driver.retryState!;
    // 单形断言（contracts RetryProbe）：attempt 计数 + 名额上限 + 下次续入时刻
    // 落抖动窗内（backoff.jitteredBackoff：attempt 1 延迟 ∈ [base·0.5, base)）
    expect(probe.attempt).toBe(1);
    expect(probe.maxAttempts).toBe(2);
    expect(probe.nextAt).toBeGreaterThanOrEqual(before + 30_000); // 抖动下界
    expect(probe.nextAt).toBeLessThan(before + 60_000); // 上开区间（恒 < 满额）
    driver.abort();
    const result = await pending;
    expect(result.status).toBe('failed');
    // aborted break 路探针不悬空——finally 防御位收口
    expect(driver.retryState).toBeNull();

    // —— 窗关：短窗续入成功后探针蒸发（375 行窗关清 + finally 兜底） ——
    const { driver: quickDriver } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'net down #transient' }),
        assistant({ content: [{ type: 'text', text: '好了' }] }),
      ],
      classifyError: transientBucket,
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    });
    const quick = await quickDriver.submit('q');
    expect(quick.status).toBe('completed');
    expect(quickDriver.retryState).toBeNull();
  });

  it('overflow 兜底成功：遮蔽(reason=overflow) → compacted → 重播种续入 → completed', async () => {
    const compactionCalls: number[] = [];
    const { driver } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'context length exceeded' }),
        assistant({ content: [{ type: 'text', text: '压缩后续入' }] }),
      ],
      classifyError: () => 'overflow',
      compactForOverflow: async (log) => {
        compactionCalls.push(log.events().length);
        return 'compacted';
      },
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    });
    const result = await driver.submit('长上下文');
    expect(result.status).toBe('completed');
    const retryEvent = driver.session.events().find((event) => event.type === 'llm/retry')!;
    expect(retryEvent.data).toMatchObject({ attempt: 1, phase: 'scheduled', reason: 'overflow' });
    expect(compactionCalls).toHaveLength(1); // 名额 1/1
    expect(dataOf(driver, 'request/header').map((d) => (d as { reason: string }).reason)).toEqual([
      'initial',
      'resume',
    ]);
  });

  it('overflow nothing：区间不足压无可压 → exhausted(reason=overflow) + failed', async () => {
    const { driver } = makeDriver({
      scripts: [assistant({ stopReason: 'error', errorMessage: 'context length exceeded' })],
      classifyError: () => 'overflow',
      compactForOverflow: async () => 'nothing',
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    });
    const result = await driver.submit('q');
    expect(result.status).toBe('failed');
    const retries = dataOf(driver, 'llm/retry');
    expect(retries).toHaveLength(2); // scheduled + exhausted
    expect(retries[1]).toMatchObject({ attempt: 1, delayMs: 0, phase: 'exhausted', reason: 'overflow' });
  });

  it('overflow 注入缺席：溢出直接终态（零 llm/retry 事件）', async () => {
    const { driver } = makeDriver({
      scripts: [assistant({ stopReason: 'error', errorMessage: 'context length exceeded' })],
      classifyError: () => 'overflow',
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    });
    const result = await driver.submit('q');
    expect(result.status).toBe('failed');
    expect(types(driver)).not.toContain('llm/retry');
  });
});

/* ---------------- 队列通道（busy steer / followUp 搭车 / 搁浅件续跑） ---------------- */

describe('ConversationDriver 待发队列通道', () => {
  it('busy submit → 队列搭车：同 run 内 followUp 续跑（第二 turn 顶注消费）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver, seen } = makeDriver({
      scripts: [
        assistant({ content: [{ type: 'text', text: '一答' }] }),
        assistant({ content: [{ type: 'text', text: '二答' }] }),
      ],
      gates: [gate],
    });
    const first = driver.submit('一问');
    // busy 窗口内注入（首流挂起）——入列 + 搭同一 run 结算
    const second = driver.submit('二问');
    expect(second).toBe(first);
    release();
    const result = await first;
    expect(result.status).toBe('completed');
    // 两条 user/message 都落账，两枚 durable turn
    expect(types(driver).filter((t) => t === 'user/message')).toHaveLength(2);
    expect(types(driver).filter((t) => t === 'turn/start')).toHaveLength(2);
    expect(dataOf(driver, 'turn/end')).toEqual([{ reason: 'completed' }, { reason: 'completed' }]);
    // 第二次 LLM 请求上下文含搭车消息（followUp 通道进本轮）
    expect(seen).toHaveLength(2);
    const secondMessages = seen[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(secondMessages.some((m) => m.role === 'user' && m.content === '二问')).toBe(true);
  });

  it('搁浅件续跑：失败收场搁浅 → 下次 submit 作种子前置续跑（一 run 双种子）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver, seen } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: 'hard fail' }), // 不可重试 → failed 搁浅 B
        assistant({ content: [{ type: 'text', text: '续跑答' }] }),
      ],
      gates: [gate],
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    });
    const first = driver.submit('一问');
    const second = driver.submit('搁浅件'); // busy → 入列（failed 收场不消费 → 搁浅）
    expect(second).toBe(first);
    release();
    expect((await first).status).toBe('failed');
    expect(driver.running).toBe(false);
    // 搁浅件未落账（消息级终值未发生）
    expect(types(driver).filter((t) => t === 'user/message')).toHaveLength(1);
    // 下次 submit：搁浅件在前、新输入在后作种子（单次 runTurns 双种子）
    const result = await driver.submit('新输入');
    expect(result.status).toBe('completed');
    expect(types(driver).filter((t) => t === 'user/message')).toHaveLength(3);
    const lastMessages = seen[1]!.messages as Array<{ role: string; content: unknown }>;
    const userTexts = lastMessages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userTexts).toEqual(['一问', '搁浅件', '新输入']);
  });
});

/* ---------------- 三通道路由与取消模型（11d：inject / 唤醒预算 / 工具面收窄 / resume） ---------------- */

describe('ConversationDriver 三通道与取消模型', () => {
  it('inject 通道：dismantle 后 submit 只落 durable user/message（零 turn/header）+ injected 收执', async () => {
    const warns: string[] = [];
    const { driver } = makeDriver({ scripts: [assistant({})], warn: (m) => warns.push(m) });
    driver.dismantle();
    expect(driver.dismantled).toBe(true);
    const receipt = await driver.submit('停摆期投递');
    expect(receipt).toEqual({ status: 'injected', seq: expect.any(Number) });
    expect(driver.running).toBe(false);
    // durable 只落 user/message——零 turn/start、零 request/header（不触发任何模型调用）
    expect(types(driver)).toEqual(['user/message']);
    expect((dataOf(driver, 'user/message')[0] as { content: string }).content).toBe('停摆期投递');
    expect(warns).toHaveLength(0); // inject 非拒收
  });

  it('dismantle 打断在飞：协作流收 aborted + 队列清空 + 此后投递转 inject', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver } = makeDriver({
      // 协作中止面：流 honor signal（生产 llm 层行为）——门控与中止竞速
      streamFn: (_context, _options, signal): AssistantStream => {
        const final = assistant({ stopReason: 'aborted' });
        return {
          async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
            const aborted = new Promise<void>((resolve) => {
              if (signal?.aborted) resolve();
              else signal?.addEventListener('abort', () => resolve(), { once: true });
            });
            await Promise.race([gate, aborted]);
            yield { type: 'start', partial: final };
            yield { type: 'error', reason: 'aborted', error: final };
          },
          result: async () => final,
        };
      },
    });
    const first = driver.submit('在飞问');
    driver.submit('忙碌中件'); // busy → 入列（dismantle 时被清——内存态不承诺）
    driver.dismantle(); // 置位 + abort + 清队列
    const result = await first;
    expect(result).toMatchObject({ status: 'aborted' });
    // 被清件不落账（只有种子）；turn 收 aborted
    expect(types(driver).filter((t) => t === 'user/message')).toHaveLength(1);
    expect(dataOf(driver, 'turn/end')).toEqual([{ reason: 'aborted' }]);
    // 此后一切投递转 inject
    const receipt = await driver.submit('停摆期投递');
    expect(receipt).toEqual({ status: 'injected', seq: expect.any(Number) });
    const userTexts = dataOf(driver, 'user/message').map((d) => (d as { content: string }).content);
    expect(userTexts).toEqual(['在飞问', '停摆期投递']);
    void release; // 门永不放（中止腿独赢——防悬挂 promise）
  });

  it('backgroundWake idle 起跑：工具面收窄（backgroundTools 供应商）+ header 快照载窄面', async () => {
    const { driver, seen } = makeDriver({
      scripts: [assistant({})],
      tools: [makeTool('full')],
      backgroundTools: () => [makeTool('narrow')],
    });
    const result = await driver.submit('后台唤醒', { backgroundWake: true });
    expect(result.status).toBe('completed');
    expect(seen[0]!.tools?.map((t) => t.name)).toEqual(['narrow']);
    expect(dataOf(driver, 'request/header')[0]).toMatchObject({ toolSchemas: [{ name: 'narrow' }], reason: 'initial' });
  });

  it('backgroundTools 缺席 = 后台 run 零工具（最保守）', async () => {
    const { driver, seen } = makeDriver({ scripts: [assistant({})], tools: [makeTool('full')] });
    await driver.submit('后台唤醒', { backgroundWake: true });
    expect(seen[0]!.tools).toEqual([]);
    expect(dataOf(driver, 'request/header')[0]).toMatchObject({ toolSchemas: [] });
  });

  it('唤醒预算达帽：3 连唤醒后第 4 次唤醒 submit 拒收回执 + warn + 零新 durable 事件', async () => {
    const warns: string[] = [];
    const { driver } = makeDriver({
      scripts: [assistant({}), assistant({}), assistant({})],
      warn: (m) => warns.push(m),
    });
    for (let i = 0; i < 3; i += 1) {
      expect((await driver.submit(`唤醒${i}`, { backgroundWake: true })).status).toBe('completed');
    }
    const before = types(driver).length;
    const receipt = await driver.submit('唤醒3', { backgroundWake: true });
    expect(receipt).toEqual({ status: 'wake-refused', reason: 'wake-budget' });
    expect(warns).toHaveLength(1);
    expect(types(driver).length).toBe(before); // 拒收零落账
    expect(driver.running).toBe(false);
  });

  it('前台输入复位预算：3 连唤醒后前台 run 归零 → 唤醒重新受理', async () => {
    const { driver } = makeDriver({
      scripts: [assistant({}), assistant({}), assistant({}), assistant({}), assistant({}), assistant({})],
      warn: () => {
        throw new Error('复位后不应拒收');
      },
    });
    await driver.submit('唤醒1', { backgroundWake: true });
    await driver.submit('唤醒2', { backgroundWake: true });
    await driver.submit('唤醒3', { backgroundWake: true });
    expect((await driver.submit('前台')).status).toBe('completed'); // 复位点
    expect((await driver.submit('唤醒4', { backgroundWake: true })).status).toBe('completed');
    expect((await driver.submit('唤醒5', { backgroundWake: true })).status).toBe('completed');
  });

  it('busy 唤醒合批：busy 期 wake×2+前台×1 → followUp 一次消费全量（同请求 + 窄面 + 整批计 1）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver, seen } = makeDriver({
      // 脚本 0：gated 首 turn；1：合批续跑 turn；2/3：复位验证用两次唤醒探针
      scripts: [assistant({}), assistant({}), assistant({}), assistant({})],
      gates: [gate],
      tools: [makeTool('full')],
      backgroundTools: () => [makeTool('narrow')],
    });
    const first = driver.submit('前台一问');
    driver.submit('唤醒A', { backgroundWake: true }); // busy → 入列
    driver.submit('唤醒B', { backgroundWake: true }); // busy → 入列
    driver.submit('前台二问'); // busy → 入列（合批不辨——首件唤醒位触发取全量）
    release();
    expect((await first).status).toBe('completed');
    // 合批：三件全进第二请求（followUp 通道一次消费）
    const second = seen[1]!;
    const userTexts = (second.messages as Array<{ role: string; content: unknown }>)
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(userTexts).toEqual(['前台一问', '唤醒A', '唤醒B', '前台二问']);
    expect(second.tools?.map((t) => t.name)).toEqual(['narrow']);
    // 整批计 1（合批 5 唤醒 = 1 run 计 1 的兑现锁）：本 run 后 streak=1，
    // 其后两次唤醒到 3、第 4 次才拒——若按件计 3 则唤醒 A 后立刻达帽拒收
    await driver.submit('唤醒C', { backgroundWake: true });
    await driver.submit('唤醒D', { backgroundWake: true });
    const receipt = await driver.submit('唤醒E', { backgroundWake: true });
    expect(receipt).toEqual({ status: 'wake-refused', reason: 'wake-budget' });
  });

  it('消费位拒收：达帽后 busy 入列的唤醒件在 followUp 消费被滤（warn + 不起空续跑）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const warns: string[] = [];
    const { driver, seen } = makeDriver({
      scripts: [assistant({}), assistant({}), assistant({})],
      gates: [undefined, undefined, gate],
      warn: (m) => warns.push(m),
    });
    await driver.submit('唤醒1', { backgroundWake: true });
    await driver.submit('唤醒2', { backgroundWake: true });
    const third = driver.submit('唤醒3', { backgroundWake: true }); // gated → 消费后 streak=3
    driver.submit('忙碌唤醒', { backgroundWake: true }); // busy 入列（预算在消费位执法）
    release();
    expect((await third).status).toBe('completed');
    expect(seen).toHaveLength(3); // 无第四请求（空消费防御——不起无新消息的 LLM 调用）
    expect(warns).toHaveLength(1);
    expect(types(driver).filter((t) => t === 'turn/start')).toHaveLength(3);
    expect(types(driver).filter((t) => t === 'user/message')).toHaveLength(3); // 被滤件不落账
  });

  it('resume 冷启动：同 session 新驱动 submit → header(resume) + timeline 含前史', async () => {
    const session = new SessionLog({ sessionId: 's-resume' });
    const run1 = makeDriver({ session, scripts: [assistant({})] });
    await run1.driver.submit('旧问');
    const run2 = makeDriver({ session, scripts: [assistant({})] });
    const result = await run2.driver.submit('新问');
    expect(result.status).toBe('completed');
    // header 边界制：冷启动（日志已有 header）首请求落 resume 形——不重落 initial
    const reasons = session
      .events()
      .filter((event) => event.type === 'request/header')
      .map((event) => (event.data as { reason: string }).reason);
    expect(reasons).toEqual(['initial', 'resume']);
    // timeline 续接：新请求上下文含前史 user
    const userTexts = (run2.seen[0]!.messages as Array<{ role: string; content: unknown }>)
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(userTexts).toEqual(['旧问', '新问']);
  });

  it('open durable turn 冷启动合并：种子 turn 不重开、首 turn/end 闭合并承载', async () => {
    // 模拟进程崩溃于 turn 中（durable 落有未闭 turn/start——恢复合成 recoverClosers
    // 归 host 侧；本测只锁驱动行为：续接不重开 turn、旧 turn 合并承载新轮）
    const session = new SessionLog({ sessionId: 's-open-turn' });
    session.append('user/message', { content: '崩溃前问' });
    session.append('turn/start', {});
    session.append('request/header', {
      config: { model: 'test/model' },
      systemPrompt: 'sys',
      toolSchemas: [],
      reason: 'initial',
    });
    session.append('assistant/message', {
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
    });
    const { driver } = makeDriver({ session, scripts: [assistant({})] });
    const result = await driver.submit('续问');
    expect(result.status).toBe('completed');
    // turn/start 不重开（种子那枚合并承载）；turn/end 一枚闭收
    expect(types(driver).filter((t) => t === 'turn/start')).toHaveLength(1);
    expect(dataOf(driver, 'turn/end')).toEqual([{ reason: 'completed' }]);
    const reasons = session
      .events()
      .filter((event) => event.type === 'request/header')
      .map((event) => (event.data as { reason: string }).reason);
    expect(reasons).toEqual(['initial', 'resume']);
  });
});

/* ---------------- todo 快照注入（05 §1.1 跨 turn 回看） ---------------- */

describe('ConversationDriver todo 快照注入', () => {
  /**
   * 注入生效窗（fold 推导规则的直接推论）：durable 写序 = 种子 user/message
   * 先于 request/header，故「用户出手即重置」⇒ 任一 run 的首请求恒零注入；
   * 模型轮内经 todo 工具写表后，同 run 后续请求每轮尾注回看（跨轮持续，
   * CC 式）。最小装配 = 真 createTodoTool + append 闭包直写 durable——
   * 11e-2 装配面的复刻，驱动面零特设。
   */
  function makeTodoAgentTool(session: SessionLog): AgentTool {
    const def = createTodoTool((data) => session.append('todo/write', data));
    return {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      execute: (toolCallId, args) => def.execute(args, { toolCallId }),
    };
  }

  function todoCall(): AssistantMessage {
    return assistant({
      stopReason: 'toolUse',
      content: [
        {
          type: 'toolCall',
          id: 't-todo',
          name: 'todo',
          arguments: { items: [{ status: 'in-progress', content: '任务甲', activeForm: '正在任务甲' }] },
        },
      ],
    });
  }

  it('轮内写表 → 同 run 后续请求尾注清单 UserMessage（瞬态：不落 durable）', async () => {
    const session = new SessionLog({ sessionId: 's-todo' });
    const { driver, seen } = makeDriver({
      session,
      tools: [makeTodoAgentTool(session)],
      scripts: [todoCall(), assistant({ content: [{ type: 'text', text: '收' }] })],
    });
    const result = await driver.submit('问');
    expect(result.status).toBe('completed');
    // 首请求零注入（种子出手即重置——fold 倒扫先遇种子 user/message）
    expect(seen[0]!.messages[seen[0]!.messages.length - 1]).toMatchObject({ role: 'user', content: '问' });
    // 第二请求尾注清单（轮内 todo/write 在种子之后——fold 命中注入）
    const tail = seen[1]!.messages[seen[1]!.messages.length - 1];
    expect(tail).toMatchObject({ role: 'user' });
    expect((tail as { content?: unknown }).content).toContain('当前任务清单');
    expect((tail as { content?: unknown }).content).toContain('正在任务甲');
    // 瞬态纪律：durable 唯一 user/message = 种子本体；清单恰一笔 todo/write
    expect(types(driver).filter((type) => type === 'user/message')).toHaveLength(1);
    expect(dataOf(driver, 'todo/write')).toHaveLength(1);
  });

  it('无 todo/write → 零注入（上下文尾即种子，不打扰）', async () => {
    const { driver, seen } = makeDriver({ scripts: [assistant({})] });
    await driver.submit('问');
    expect(seen[0]!.messages).toHaveLength(1); // 请求时点流未产——仅种子 user
    expect(seen[0]!.messages[0]).toMatchObject({ role: 'user', content: '问' });
  });

  it('重置语义：run 内建表后用户再度出手 → 新 run 首请求零注入（推导承载 run 重置）', async () => {
    const session = new SessionLog({ sessionId: 's-todo-reset' });
    const { driver, seen } = makeDriver({
      session,
      tools: [makeTodoAgentTool(session)],
      scripts: [todoCall(), assistant({ content: [{ type: 'text', text: '收' }] }), assistant({})],
    });
    await driver.submit('第一问'); // run1：轮内建表（第二请求注入）
    const result = await driver.submit('第二问'); // run2：新种子出手 → 重置
    expect(result.status).toBe('completed');
    const tail = seen[2]!.messages[seen[2]!.messages.length - 1];
    expect(tail).toMatchObject({ role: 'user', content: '第二问' });
    expect((tail as { content?: unknown }).content ?? '').not.toContain('当前任务清单');
  });
});

/* ---------------- 11f 纵切：披露段注入 / 审批挂起通知 / onRunSettled ---------------- */

describe('ConversationDriver 环境披露段注入（04 §11）', () => {
  it('披露段拼 systemPrompt 尾（两 \n 分隔）；header 快照钉死原始值（披露永不入账）', async () => {
    const { driver, seen } = makeDriver({
      scripts: [assistant({})],
      environmentDisclosure: () => '【环境披露】工作区块',
    });
    await driver.submit('问');
    // 请求上下文：原始值 + 披露段两换行拼接（瞬态层——每请求重算）
    expect(seen[0]!.systemPrompt).toBe('sys\n\n【环境披露】工作区块');
    // 快照序钉死：request/header 落的是装配面原始 systemPrompt
    expect((dataOf(driver, 'request/header')[0] as { systemPrompt: string }).systemPrompt).toBe('sys');
  });

  it('无原始 systemPrompt：披露段独立成体（无前导换行）', async () => {
    const { driver, seen } = makeDriver({
      scripts: [assistant({})],
      systemPrompt: undefined,
      environmentDisclosure: () => '只有披露',
    });
    await driver.submit('问');
    expect(seen[0]!.systemPrompt).toBe('只有披露');
  });

  it('披露段返回 null = 零拼接（systemPrompt 维持原始值）', async () => {
    const { driver, seen } = makeDriver({
      scripts: [assistant({})],
      environmentDisclosure: () => null,
    });
    await driver.submit('问');
    expect(seen[0]!.systemPrompt).toBe('sys');
  });
});

describe('ConversationDriver 子代理审批挂起通知（04 §10）', () => {
  it('idle：followUp 起跑——通知消息进 timeline 与 durable（source + dedupeKey 原样落账）', async () => {
    const { driver, seen } = makeDriver({ scripts: [assistant({})] });
    const receipt = await driver.notifySubagentApprovalPending({
      approvalId: 'ap1',
      jobName: '检索任务',
      toolName: 'bash',
    });
    expect(receipt.status).toBe('completed'); // 通知即种子——run 起跑收答
    // durable：恰一条通知 user/message，source 归因 + 幂等键随行
    const users = dataOf(driver, 'user/message');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ source: 'subagent-approval-pending', dedupeKey: 'subagent-approval:ap1' });
    expect((users[0] as { content: string }).content).toContain('检索任务');
    expect((users[0] as { content: string }).content).toContain('bash');
    expect((users[0] as { content: string }).content).toContain('请勿代答'); // 纯信息位文案
    // 通知进了模型请求上下文（timeline 种子）
    const seeded = seen[0]!.messages as Array<{ role: string; content: unknown }>;
    expect(seeded.some((m) => m.role === 'user' && String(m.content).includes('检索任务'))).toBe(true);
  });

  it('busy：steer 通道——在飞 run 搭车消费（同 run 续跑，通知不丢）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver, seen } = makeDriver({
      scripts: [assistant({ content: [{ type: 'text', text: '一答' }] }), assistant({})],
      gates: [gate],
    });
    const first = driver.submit('一问');
    const notified = driver.notifySubagentApprovalPending({ approvalId: 'ap2', jobName: '任务', toolName: 'write' });
    expect(notified).toBe(first); // busy → 同一 run 收执
    release();
    expect((await first).status).toBe('completed');
    expect(dataOf(driver, 'user/message')).toHaveLength(2); // 种子 + 通知
    const secondMessages = seen[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(secondMessages.some((m) => m.role === 'user' && String(m.content).includes('任务'))).toBe(true);
  });

  it('恰一条幂等：同 approvalId 二投 → injected 回执复用原 seq、零新落账；异 id 新通知', async () => {
    const { driver } = makeDriver({ scripts: [assistant({}), assistant({})] });
    await driver.notifySubagentApprovalPending({ approvalId: 'ap3', jobName: '甲', toolName: 'bash' });
    const seqBefore = driver.session.events().filter((e) => e.type === 'user/message').length;
    const dup = await driver.notifySubagentApprovalPending({ approvalId: 'ap3', jobName: '甲', toolName: 'bash' });
    expect(dup).toMatchObject({ status: 'injected' }); // 已在日志——幂等零动作
    expect(driver.session.events().filter((e) => e.type === 'user/message')).toHaveLength(seqBefore);
    // 不同审批 = 不同键 → 新通知照常注入
    const fresh = await driver.notifySubagentApprovalPending({ approvalId: 'ap4', jobName: '乙', toolName: 'bash' });
    expect(fresh.status).toBe('completed');
    expect(driver.session.events().filter((e) => e.type === 'user/message')).toHaveLength(seqBefore + 1);
  });

  it('dismantled：inject 通道——只落 durable 不起 run（dedupeKey 随行可幂等）', async () => {
    const { driver } = makeDriver({ scripts: [assistant({})] });
    driver.dismantle();
    const receipt = await driver.notifySubagentApprovalPending({ approvalId: 'ap5', jobName: '丙', toolName: 'read' });
    expect(receipt).toMatchObject({ status: 'injected' });
    expect(types(driver)).toEqual(['user/message']);
    const dup = await driver.notifySubagentApprovalPending({ approvalId: 'ap5', jobName: '丙', toolName: 'read' });
    expect(dup).toMatchObject({ status: 'injected' });
    expect(types(driver)).toEqual(['user/message']); // 幂等：不叠第二条
  });
});

describe('ConversationDriver run 终态回调（ctx.agent onRunSettled）', () => {
  it('每次 run 结算恰一回调：{result, sessionId} 信封；连续两 run 两回调', async () => {
    const scope = Scope.createRoot();
    const events: Array<{ result: string; sessionId: string }> = [];
    const agent = provideAgentService(scope);
    agent.onRunSettled((event) => void events.push({ result: event.result.status, sessionId: event.sessionId }));
    const { driver } = makeDriver({
      scope,
      scripts: [assistant({}), assistant({ stopReason: 'error', errorMessage: 'x' })],
    });
    await driver.submit('一问');
    expect(events).toEqual([{ result: 'completed', sessionId: 's-driver' }]);
    await driver.submit('二问');
    expect(events.map((e) => e.result)).toEqual(['completed', 'failed']);
  });

  it('订阅者异常隔离：单订阅者故障不反噬 run 结算与回执', async () => {
    const scope = Scope.createRoot();
    const service = provideAgentService(scope);
    const recorded: string[] = [];
    service.onRunSettled(() => {
      throw new Error('订阅者故障');
    });
    service.onRunSettled((event) => void recorded.push(event.result.status));
    const { driver } = makeDriver({ scope, scripts: [assistant({})] });
    const result = await driver.submit('问');
    expect(result.status).toBe('completed');
    expect(recorded).toEqual(['completed']);
  });
});
