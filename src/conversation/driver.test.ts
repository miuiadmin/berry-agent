/**
 * ConversationDriver 测试 — 11c 纵切全景（durable 接线 / runTurns 重试 /
 * 溢出兜底 / 队列通道）。
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
    expect(result.status).toBe('failed');
    expect(result.stopReason).toBe('length');
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
