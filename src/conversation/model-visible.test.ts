/**
 * 「模型可见即已记录」请求关口总拍测试（05 §1.2 对拍断言——2026-09-11
 * 运行时断言批）。
 *
 * 两层：
 *  - 单元层（纯逻辑）：规范形白名单豁免（timestamp/source/dedupeKey/usage
 *    兜底不参与）、toolCall 归尾与键序不敏感、漂移必红（多一/少一/角色异/
 *    内容异）、预算刀豁免位结构降级、自定义角色暗通道红、降级掩码从投影
 *    原始形判（标记在重建形蒸发的位）；
 *  - 驱动层（组合根口径——真 session/wiring/reseed/loop，mock 只停
 *    streamFn 注入位）：合法流零误报锁——多轮工具流/steer 顶注/重试遮蔽
 *    续入/冷启动 resume 全形态过请求关口不抛（规范形对真实管线形状的
 *    忠实性反向锁：总拍恒开后既有全部用例面即本锁的放大器）。
 *
 * 禁断言 AI 生成文本——只断言结构与编舞行为。
 */
import { describe, it, expect } from 'vitest';
import type {
  AgentMessage,
  AgentTool,
  AssistantMessage,
  AssistantStream,
  AssistantStreamEvent,
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
import type { ProjectedMessage } from '../session/index.js';
import { ConversationDriver } from './driver.js';
import type { ConversationDriverOptions } from './types.js';
import { assertModelVisibleTimeline, degradationMask } from './model-visible.js';

/* ---------------- 测试构造件（driver.test 同族——本件自持最小面） ---------------- */

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
function call(id: string, name: string, args?: ToolCallBlock['arguments']): ToolCallBlock {
  return { type: 'toolCall', id, name, arguments: args ?? {} };
}

/** 文本块构造 */
function text(value: string): TextContent {
  return { type: 'text', text: value };
}

/** toolResult 消息构造 */
function toolResult(toolCallId: string, output: string, isError = false): Message {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'echo',
    content: [text(output)],
    isError,
    timestamp: 0,
  };
}

/** 单次流（真协议形状：start → delta → done/error——error 终值走 error 事件） */
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

/** scripted streamFn（driver.test 同族——gates[i] 提供时首挂起，busy 注入窗时序控制面） */
function scriptedStreamFn(
  scripts: AssistantMessage[],
  gates: Array<Promise<void> | undefined>,
  seen: LlmContext[],
): StreamFn {
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

/** 最小真工具 */
function makeTool(name: string): AgentTool {
  return {
    name,
    description: '测试工具',
    parameters: { type: 'object' },
    execute: async () => ({ content: [text('ok')] }),
  };
}

/** 缺省 convertToLlm：标准直通、自定义剥离（null） */
const passthrough = (m: AgentMessage): Message | null => (isStandardMessage(m) ? m : null);

/** 驱动测试台（组合根口径——真 session + 真 wiring + 总拍恒开） */
function makeDriver(
  overrides?: Partial<ConversationDriverOptions> & {
    scripts?: AssistantMessage[];
    gates?: Array<Promise<void> | undefined>;
    session?: SessionLog;
  },
): { driver: ConversationDriver; seen: LlmContext[] } {
  const seen: LlmContext[] = [];
  const { scripts, gates, session, ...rest } = overrides ?? {};
  const driver = new ConversationDriver({
    session: session ?? new SessionLog({ sessionId: 's-model-visible' }),
    scope: Scope.createRoot(),
    dispatch: new EventDispatch(),
    streamFn: scriptedStreamFn(scripts ?? [], gates ?? [], seen),
    convertToLlm: passthrough,
    model: 'test/model',
    systemPrompt: 'sys',
    ...rest,
  });
  return { driver, seen };
}

/* ---------------- 单元层：规范形与漂移红 ---------------- */

describe('model-visible 总拍断言（单元）', () => {
  it('等价两侧零抛：timestamp/source/dedupeKey/usage 兜底不参与（白名单豁免锁）', () => {
    const live: AgentMessage[] = [
      { role: 'user', content: '问', timestamp: 111, source: 'user', dedupeKey: 'k1' },
      assistant({ content: [text('答')] }),
      toolResult('c1', 'ok'),
    ];
    const expected: Message[] = [
      // 重建形：timestamp 异、无 source/dedupeKey（审计位——白名单外）
      { role: 'user', content: '问', timestamp: 999 },
      assistant({ content: [text('答')], timestamp: 888 }),
      { role: 'toolResult', toolCallId: 'c1', toolName: 'echo', content: [text('ok')], isError: false, timestamp: 777 },
    ];
    expect(() => assertModelVisibleTimeline(live, expected)).not.toThrow();
  });

  it('usage 缺省 ≡ 零用量兜底（两侧同归一后比）', () => {
    // 经 unknown 双转模拟活侧 usage 缺席脏形（归一语义的靶点——undefined ≡ 零用量）
    const liveNoUsage = {
      role: 'assistant',
      content: [],
      stopReason: 'stop',
      timestamp: 1,
    } as unknown as AssistantMessage;
    const expected: Message[] = [assistant({})];
    expect(() => assertModelVisibleTimeline([liveNoUsage], expected)).not.toThrow();
  });

  it('toolCall 归尾 + 键序不敏感：live 交错形 vs 重建归尾形零抛', () => {
    const live: AgentMessage[] = [
      assistant({
        // 交错序（provider 侧原形）：toolCall 在 text 前 + arguments 键序异
        content: [call('c1', 'echo', { b: 2, a: 1 }), text('先说明')],
      }),
    ];
    const expected: Message[] = [
      assistant({
        // 重建归一形：toolCalls 装回尾部 + 键序无关
        content: [text('先说明'), call('c1', 'echo', { a: 1, b: 2 })],
      }),
    ];
    expect(() => assertModelVisibleTimeline(live, expected)).not.toThrow();
  });

  it('多一红（长度差——暗通道方向诊断）', () => {
    const live: AgentMessage[] = [{ role: 'user', content: '一', timestamp: 1 }, assistant({}), assistant({})];
    const expected: Message[] = [{ role: 'user', content: '一', timestamp: 2 }, assistant({})];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/长度差：live 3 条 vs 重建 2 条.*暗通道/s);
  });

  it('少一红（长度差——重建 surplus 方向诊断）', () => {
    const live: AgentMessage[] = [{ role: 'user', content: '一', timestamp: 1 }];
    const expected: Message[] = [{ role: 'user', content: '一', timestamp: 2 }, assistant({})];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/长度差：live 1 条 vs 重建 2 条.*surplus/s);
  });

  it('角色异红（首分歧位诊断）', () => {
    const live: AgentMessage[] = [{ role: 'user', content: '一', timestamp: 1 }, assistant({})];
    const expected: Message[] = [
      { role: 'user', content: '一', timestamp: 2 },
      { role: 'user', content: '二', timestamp: 3 },
    ];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(
      /内容异.*首分歧位 1：live assistant vs 重建 user/s,
    );
  });

  it('内容异红：assistant 文本变异', () => {
    const live: AgentMessage[] = [assistant({ content: [text('甲')] })];
    const expected: Message[] = [assistant({ content: [text('乙')] })];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/内容异/);
  });

  it('内容异红：toolResult 输出变异', () => {
    const live: AgentMessage[] = [toolResult('c1', '甲')];
    const expected: Message[] = [toolResult('c1', '乙')];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/内容异/);
  });

  it('内容异红：toolCall arguments 变异', () => {
    const live: AgentMessage[] = [assistant({ content: [call('c1', 'echo', { a: 1 })] })];
    const expected: Message[] = [assistant({ content: [call('c1', 'echo', { a: 2 })] })];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/内容异/);
  });

  it('自定义角色活侧在场即红（wiring 零 durable 写点位——暗通道候选）', () => {
    const live: AgentMessage[] = [
      { role: 'user', content: '一', timestamp: 1 },
      { role: 'memory/recall', content: { q: 'x' }, timestamp: 2 },
    ];
    const expected: Message[] = [{ role: 'user', content: '一', timestamp: 3 }];
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/长度差.*暗通道/s);
  });

  it('预算刀豁免：降级位内容腿豁免（刀后字节级对拍永假）', () => {
    const full = 'X'.repeat(1000);
    const clipped = `${'X'.repeat(880)}…[truncated 120 chars]`;
    const live: AgentMessage[] = [assistant({ content: [text(full)] })];
    const expected: Message[] = [assistant({ content: [text(clipped)] })];
    // 无掩码必红（掩码必要性前提——内容确实不等价）
    expect(() => assertModelVisibleTimeline(live, expected)).toThrowError(/内容异/);
    // 掩码位降为结构对拍 → 零抛
    expect(() => assertModelVisibleTimeline(live, expected, [true])).not.toThrow();
  });

  it('预算刀豁免：降级位结构仍执法（toolCallId 异照红）', () => {
    const live: AgentMessage[] = [assistant({ content: [text('X'.repeat(1000)), call('c1', 'echo')] })];
    const expected: Message[] = [
      assistant({ content: [text(`${'X'.repeat(880)}…[truncated 120 chars]`), call('c2', 'echo')] }),
    ];
    expect(() => assertModelVisibleTimeline(live, expected, [true])).toThrowError(/结构异/);
  });

  it('arguments 被截豁免：重建解析兜底 {} 与真值对拍（掩码从投影原始形判的动因）', () => {
    const live: AgentMessage[] = [assistant({ content: [call('c1', 'echo', { real: '参数' })] })];
    const expected: Message[] = [assistant({ content: [call('c1', 'echo', {})] })];
    expect(() => assertModelVisibleTimeline(live, expected, [true])).not.toThrow();
  });

  it('degradationMask 从投影原始形判（标记在重建形已蒸发的位也能判）', () => {
    const projection: ProjectedMessage[] = [
      {
        type: 'assistant',
        seq: 0,
        content: [],
        // arguments 原串被截——reseed 解析兜底 {} 后标记蒸发，唯投影形保真
        toolCalls: [{ type: 'toolCall', toolCallId: 'c1', toolName: 'echo', arguments: '{"a":1…[truncated 5 chars]' }],
        stopReason: 'stop',
      },
      { type: 'user', seq: 1, content: '干净位' },
    ];
    expect(degradationMask(projection)).toEqual([true, false]);
  });

  it('degradationMask：image 占位与 errorMessage 截断同判', () => {
    const projection: ProjectedMessage[] = [
      {
        type: 'user',
        seq: 0,
        content: [{ type: 'text', text: '[image-blob-dropped: durable budget]' }],
      },
      {
        type: 'assistant',
        seq: 1,
        content: [],
        toolCalls: [],
        stopReason: 'error',
        errorMessage: `${'E'.repeat(2040)}…[truncated 8 chars]`,
      },
    ];
    expect(degradationMask(projection)).toEqual([true, true]);
  });
});

/* ---------------- 驱动层：合法流零误报锁（组合根口径） ---------------- */

describe('model-visible 总拍（驱动层——合法流零误报锁）', () => {
  it('多轮工具流 + 瞬态注入段全请求过关口', async () => {
    const { driver, seen } = makeDriver({
      scripts: [
        assistant({ content: [call('c1', 'echo')], stopReason: 'toolUse' }),
        assistant({ content: [text('完')] }),
      ],
      tools: [makeTool('echo')],
      // 瞬态注入段在场（05 §1.2 既定豁免面——注入于对拍点之后不破拍）
      pluginSections: () => '插件提示词段',
      environmentDisclosure: () => '环境披露段',
    });
    const result = await driver.submit('问');
    expect(result.status).toBe('completed');
    // 两次模型请求都过总拍（任一漂移即 fail-loud 上抛）
    expect(seen.length).toBe(2);
    const durableTypes = driver.session.events().map((event) => event.type);
    expect(durableTypes).toContain('tool/call');
    expect(durableTypes).toContain('tool/result');
  });

  it('busy steer 顶注续轮过关口', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { driver, seen } = makeDriver({
      scripts: [
        assistant({ content: [call('c1', 'echo')], stopReason: 'toolUse' }),
        assistant({ content: [text('复')] }),
      ],
      tools: [makeTool('echo')],
      // 首请求挂起窗：busy steer 注入发生在模型在飞期（对偶纪律的真考位）
      gates: [gate, undefined],
    });
    const running = driver.submit('首');
    driver.submit('插话');
    release();
    const result = await running;
    expect(result.status).toBe('completed');
    expect(seen.length).toBe(2);
    expect(driver.session.events().filter((event) => event.type === 'user/message').length).toBe(2);
  });

  it('transient 重试遮蔽重播种后续入过关口', async () => {
    const { driver, seen } = makeDriver({
      scripts: [
        assistant({ stopReason: 'error', errorMessage: '#transient 网络抖动' }),
        assistant({ content: [text('复')] }),
      ],
      classifyError: (message) => (message.errorMessage?.includes('#transient') ? 'transient' : 'non-retryable'),
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    });
    const result = await driver.submit('问');
    expect(result.status).toBe('completed');
    expect(driver.session.events().map((event) => event.type)).toContain('llm/retry');
    expect(seen.length).toBe(2);
  });

  it('冷启动 resume 首请求过关口（重建 = 活数组同路同形）', async () => {
    const session = new SessionLog({ sessionId: 's-mv-resume' });
    const first = makeDriver({
      session,
      scripts: [assistant({ content: [text('一答')] })],
    });
    await first.driver.submit('一问');
    // 冷启动：同 session 新驱动——resume 续接首请求即总拍（重建链与活数组同路）
    const second = makeDriver({
      session,
      scripts: [assistant({ content: [text('二答')] })],
    });
    const result = await second.driver.submit('二问');
    expect(result.status).toBe('completed');
    expect(second.seen.length).toBe(1);
    expect(session.events().filter((event) => event.type === 'assistant/message').length).toBe(2);
  });
});
