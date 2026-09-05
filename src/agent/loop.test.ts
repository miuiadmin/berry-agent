/**
 * agent/loop 测试 — loop 骨架全景（04 §2：双 while、终态三值、批语义三律、
 * 三通道、入口两式校验）。
 *
 * 纪律：mock 只停 streamFn 注入位（scripted 终值序列）——金样 seam 同族；
 * 其余（队列/工具批/事件流）全走真实现。工具用最小真执行体。
 */
import { describe, it, expect } from 'vitest';
import type {
  AssistantMessage,
  AssistantStream,
  AssistantStreamEvent,
  LlmContext,
  Message,
  StreamFn,
  StreamFnOptions,
  TextContent,
  ToolCallBlock,
  ToolResultMessage,
  UserMessage,
} from '../contracts/index.js';
import { BaseError, isStandardMessage } from '../contracts/index.js';
import type { AgentMessage } from '../contracts/index.js';
import type { AgentTool } from '../contracts/index.js';
import { startRun, continueRun } from './loop.js';
import type { AgentContext, AgentLoopConfig } from './types.js';
import type { AgentEvent } from './events.js';

/* ---------------- 测试构造件 ---------------- */

/** 用户消息构造 */
function user(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: 0 };
}

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

/** 单次流（终值事件序列：start → text_delta → done/error——真协议形状） */
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

/** scripted streamFn：按序弹终值 + 记录每次调用的 options（换装断言面） */
function scriptedStreamFn(scripts: AssistantMessage[], seen: StreamFnOptions[] = []): StreamFn {
  let i = 0;
  return (_context: LlmContext, options: StreamFnOptions): AssistantStream => {
    seen.push({ ...options });
    const final = scripts[i++];
    if (!final) throw new Error(`脚本耗尽（第 ${i} 次调用无终值）`);
    return makeStream(final);
  };
}

/** 缺省 convertToLlm：标准直通、自定义剥离（null） */
const passthrough = (m: AgentMessage): Message | null => (isStandardMessage(m) ? m : null);

/** 测试台（每用例新建——事件收集 + 基础 config） */
function rig(overrides?: Partial<AgentLoopConfig>): {
  context: AgentContext;
  config: AgentLoopConfig;
  events: AgentEvent[];
} {
  const context: AgentContext = { messages: [] };
  const events: AgentEvent[] = [];
  const config: AgentLoopConfig = {
    streamFn: scriptedStreamFn([]),
    model: 'test/model',
    convertToLlm: passthrough,
    onEvent: (e) => void events.push(e),
    ...overrides,
  };
  return { context, config, events };
}

/** 事件型序列（断言面——message_update 除外，见各用例点名） */
function typesOf(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

/* ---------------- 入口两式 ---------------- */

describe('startRun/continueRun 入口两式', () => {
  it('基本流：种子 → assistant stop → completed；事件族顺序严格', async () => {
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([assistant({ content: [{ type: 'text', text: 'hi' }] })]),
    });
    const result = await startRun(context, config, [user('q')]);
    expect(result.status).toBe('completed');
    expect(result.stopReason).toBe('stop');
    // 消息轨迹：种子 + 终值
    expect(context.messages).toHaveLength(2);
    expect(typesOf(events)).toEqual([
      'message_start',
      'message_end',
      'agent_start',
      'turn_start',
      'message_start',
      'message_update',
      'message_end',
      'turn_end',
      'agent_end',
    ]);
    // agent_end 载荷
    const end = events[events.length - 1]!;
    expect(end.type === 'agent_end' && end.status).toBe('completed');
  });

  it('continueRun 末角色校验红：末 assistant 违者 AGENT_CONTINUE_INVALID', () => {
    const { context, config } = rig();
    context.messages.push(assistant({}));
    expect(() => continueRun(context, config)).toThrowError(BaseError);
    try {
      continueRun(context, config);
    } catch (err) {
      expect((err as BaseError).code).toBe('AGENT_CONTINUE_INVALID');
    }
  });

  it('continueRun 末 toolResult 通过（恢复续入形状前提）', async () => {
    const { context, config } = rig({ streamFn: scriptedStreamFn([assistant({})]) });
    context.messages.push(assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }));
    context.messages.push({
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'probe',
      content: [],
      isError: false,
      timestamp: 0,
    });
    const result = await continueRun(context, config);
    expect(result.status).toBe('completed');
  });

  it('continueRun 空会话同红（转换后末角色为空）', () => {
    const { context, config } = rig();
    try {
      continueRun(context, config);
      expect.unreachable('应抛 AGENT_CONTINUE_INVALID');
    } catch (err) {
      expect((err as BaseError).code).toBe('AGENT_CONTINUE_INVALID');
    }
  });
});

/* ---------------- 终态三值 ---------------- */

describe('run 终态三值', () => {
  it('error → failed（errorMessage 随终值与 agent_end）', async () => {
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([assistant({ stopReason: 'error', errorMessage: 'net down' })]),
    });
    const result = await startRun(context, config, [user('q')]);
    expect(result).toMatchObject({ status: 'failed', stopReason: 'error', errorMessage: 'net down' });
    const end = events[events.length - 1]!;
    expect(end.type === 'agent_end' && end.errorMessage).toBe('net down');
  });

  it('aborted → aborted', async () => {
    const { context, config } = rig({ streamFn: scriptedStreamFn([assistant({ stopReason: 'aborted' })]) });
    const result = await startRun(context, config, [user('q')]);
    expect(result).toMatchObject({ status: 'aborted', stopReason: 'aborted' });
  });

  it('length → 整批配对 isError 后 failed（残缺批不进下一轮）', async () => {
    const { context, config } = rig({
      streamFn: scriptedStreamFn([
        assistant({ stopReason: 'length', content: [call('t1', 'probe'), call('t2', 'probe')] }),
      ]),
    });
    const result = await startRun(context, config, [user('q')]);
    expect(result.status).toBe('failed');
    expect(result.stopReason).toBe('length');
    // 末两条 = 截断配对（恒配对——两 call 两 toolResult，全 isError；CustomMessage.role 是
    // string 故判别式不窄化，显式收型）
    const tail = context.messages.slice(-2) as ToolResultMessage[];
    expect(tail.every((m) => m.role === 'toolResult' && m.isError === true)).toBe(true);
    expect((tail[0] as { toolCallId: string }).toolCallId).toBe('t1');
  });
});

/* ---------------- 工具批三律 ---------------- */

describe('工具批语义', () => {
  it('toolUse → 执行 → toolResult 入列 → 二轮 stop → completed', async () => {
    const calls: string[] = [];
    const tool = makeTool('probe', async (id) => {
      calls.push(id);
      return { content: [{ type: 'text', text: 'did' }] };
    });
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([
        assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }),
        assistant({ content: [{ type: 'text', text: 'done' }] }),
      ]),
    });
    context.tools = [tool];
    const result = await startRun(context, config, [user('q')]);
    expect(result.status).toBe('completed');
    expect(calls).toEqual(['t1']);
    // tool_execution 族在列
    expect(typesOf(events)).toContain('tool_execution_start');
    expect(typesOf(events)).toContain('tool_execution_end');
    const tr = context.messages.find((m) => m.role === 'toolResult') as { toolCallId: string; isError: boolean };
    expect(tr).toMatchObject({ toolCallId: 't1', isError: false });
  });

  it('beforeToolCall block → immediate isError（execute 不被调）', async () => {
    let executed = 0;
    const tool = makeTool('probe', async () => {
      executed += 1;
      return { content: [] };
    });
    const { context, config } = rig({
      streamFn: scriptedStreamFn([assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }), assistant({})]),
    });
    context.tools = [tool];
    config.beforeToolCall = () => ({ block: '守门拒绝：测试拒因' });
    await startRun(context, config, [user('q')]);
    expect(executed).toBe(0);
    const tr = context.messages.find((m) => m.role === 'toolResult') as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(tr.isError).toBe(true);
    expect(tr.content[0]!.text).toContain('守门拒绝');
  });

  it('terminate 批内一致：单件否决不放大 / 全 terminate 才停', async () => {
    // 单件 terminate（批 2 件 1 terminate）→ 不停 → 二轮续入
    const tools = [
      makeTool('a', async () => ({ content: [], terminate: true })),
      makeTool('b', async () => ({ content: [], terminate: false })),
    ];
    const seen: StreamFnOptions[] = [];
    const { context, config } = rig({
      streamFn: scriptedStreamFn(
        [assistant({ stopReason: 'toolUse', content: [call('t1', 'a'), call('t2', 'b')] }), assistant({})],
        seen,
      ),
    });
    context.tools = tools;
    const result = await startRun(context, config, [user('q')]);
    expect(result.status).toBe('completed'); // 单件否决不放大——run 续到自然停
    expect(seen).toHaveLength(2); // 二轮流调用在场（terminate 未停）
  });

  it('串行批中止余量配对：signal 已 abort → 未执行 calls 逐件 isError', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const callsDone: string[] = [];
    const tool = makeTool('probe', async (id) => {
      callsDone.push(id);
      return { content: [] };
    });
    const { context, config } = rig({
      streamFn: scriptedStreamFn([
        assistant({ stopReason: 'toolUse', content: [call('t1', 'probe'), call('t2', 'probe')] }),
      ]),
      signal: ctl.signal,
    });
    context.tools = [tool];
    const result = await startRun(context, config, [user('q')]);
    expect(callsDone).toEqual([]); // 一件未执行
    expect(result.status).toBe('completed'); // 余量配对非 failed（工具面 isError 是数据面）
    const tail = context.messages.filter((m) => m.role === 'toolResult') as { toolCallId: string; isError: boolean }[];
    expect(tail).toHaveLength(2);
    expect(tail.every((m) => m.isError)).toBe(true);
  });

  it('execute 抛错 → 包装 isError 结果（loop 零 try/catch 配套）', async () => {
    const tool = makeTool('probe', async () => {
      throw new Error('插件炸了');
    });
    const { context, config } = rig({
      streamFn: scriptedStreamFn([assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }), assistant({})]),
    });
    context.tools = [tool];
    await startRun(context, config, [user('q')]);
    const tr = context.messages.find((m) => m.role === 'toolResult') as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(tr.isError).toBe(true);
    expect(tr.content[0]!.text).toContain('插件炸了');
  });

  it('工具不在场 → 配置漂移 isError（不炸 run）', async () => {
    const { context, config } = rig({
      streamFn: scriptedStreamFn([assistant({ stopReason: 'toolUse', content: [call('t1', 'ghost')] }), assistant({})]),
    });
    const result = await startRun(context, config, [user('q')]);
    expect(result.status).toBe('completed');
    const tr = context.messages.find((m) => m.role === 'toolResult') as { isError: boolean };
    expect(tr.isError).toBe(true);
  });
});

/* ---------------- 三通道 ---------------- */

describe('三通道路由', () => {
  it('steering 注入：turn 顶入列 + message 事件携带 channel: steer', async () => {
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([assistant({}), assistant({})]),
      getSteeringMessages: (() => {
        let served = false;
        return () => (served ? [] : ((served = true), [user('插一句话')]));
      })(),
    });
    await startRun(context, config, [user('q')]);
    // 二轮 turn 顶：steering 消息入列（channel 披露）
    const steerStart = events.find((e) => e.type === 'message_start' && e.channel === 'steer');
    expect(steerStart).toBeDefined();
    expect(context.messages.some((m) => m.role === 'user' && m.content === '插一句话')).toBe(true);
  });

  it('followUp 续跑：自然停后消费 followUp 起二轮；再无即 completed', async () => {
    const followUps: AgentMessage[][] = [[user('再问一句')]];
    const seen: StreamFnOptions[] = [];
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([assistant({}), assistant({})], seen),
      getFollowUpMessages: () => followUps.shift() ?? [],
    });
    const result = await startRun(context, config, [user('q')]);
    expect(result.status).toBe('completed');
    expect(seen).toHaveLength(2); // 二轮流调用在场
    const fu = events.find((e) => e.type === 'message_start' && e.channel === 'followUp');
    expect(fu).toBeDefined();
  });

  it('shouldStopAfterTurn 先于 followUp 消费：停则 followUp 不入列', async () => {
    const pending: AgentMessage[] = [user('排队的')];
    const { context, config } = rig({
      streamFn: scriptedStreamFn([assistant({})]),
      shouldStopAfterTurn: () => true, // 预算尽形
      getFollowUpMessages: () => pending.splice(0),
    });
    await startRun(context, config, [user('q')]);
    // followUp 留在驱动侧（未消费不悬空在本 run 上下文）
    expect(context.messages.some((m) => m.role === 'user' && m.content === '排队的')).toBe(false);
    expect(pending).toHaveLength(1);
  });
});

/* ---------------- 换装窗 ---------------- */

describe('prepareNextTurn 换装', () => {
  it('换 model：下一轮流调用收到新 model（换装唯一时机）', async () => {
    const seen: StreamFnOptions[] = [];
    let served = false;
    const { context, config } = rig({
      streamFn: scriptedStreamFn(
        [assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }), assistant({})],
        seen,
      ),
      prepareNextTurn: () => (served ? undefined : ((served = true), { model: 'other/model' })),
    });
    context.tools = [makeTool('probe')];
    await startRun(context, config, [user('q')]);
    expect(seen[0]!.model).toBe('test/model');
    expect(seen[1]!.model).toBe('other/model');
  });

  it('transformContext 最后关口 + getApiKey 透传', async () => {
    const seen: { systemPrompt?: string; apiKey?: string }[] = [];
    const streamFn: StreamFn = (ctx, options) => {
      seen.push({ systemPrompt: ctx.systemPrompt, apiKey: options.apiKey });
      return makeStream(assistant({}));
    };
    const { context, config } = rig({
      streamFn,
      transformContext: (ctx) => ({ ...ctx, systemPrompt: `${ctx.systemPrompt ?? ''}+注入` }),
      getApiKey: () => 'sk-test',
    });
    await startRun(context, config, [user('q')]);
    expect(seen[0]).toEqual({ systemPrompt: '+注入', apiKey: 'sk-test' });
  });
});
