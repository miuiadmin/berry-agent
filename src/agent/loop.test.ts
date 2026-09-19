/**
 * agent/loop 测试 — loop 骨架全景（04 §2：双 while、终态三值、批语义三律、
 * 三通道、入口两式校验）。
 *
 * 纪律：mock 只停 streamFn 注入位（scripted 终值序列）——金样 seam 同族；
 * 其余（队列/工具批/事件流）全走真实现。工具用最小真执行体。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssistantMessage,
  AssistantStream,
  AssistantStreamEvent,
  LlmContext,
  Message,
  StreamFn,
  StreamFnOptions,
  TextContent,
  ThinkingContent,
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

/**
 * 最小真工具（可覆写 execute；effect 可选声明——读写批调度档位面，缺省不携带
 * 字段：批次层在场未声明走屏障腿，同 tools-batch.test.ts gatedTool 的语义分立）。
 */
function makeTool(name: string, execute?: AgentTool['execute'], effect?: AgentTool['effect']): AgentTool {
  return {
    name,
    description: '测试工具',
    parameters: { type: 'object' },
    ...(effect !== undefined ? { effect } : {}),
    execute: execute ?? (async () => ({ content: [{ type: 'text', text: 'ok' } satisfies TextContent] })),
  };
}

/** 受控门：release 前执行体挂起（读写批调度时序探针——同 tools-batch.test.ts gate 形） */
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
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

/** 无 start 前导流（provider 前置失败形：仅单 error 事件即收尾——pi-ai 请求
 * 创建失败 catch 路径实证形；04 §3 定形：error 可无 start 前导） */
function noStartErrorStream(final: AssistantMessage): AssistantStream {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
      yield { type: 'error', reason: 'error', error: final };
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

  it('中止竞速败者形重归因 aborted（error + signal.aborted + abort 文案——真 bug 修前必红）', async () => {
    // 真缺陷形（issue-session ⑤ flake 根因）：watchdog abort() 后 pi-ai 层 response
    // promise 与 abort 信号竞速——败者形 = stopReason 'error' + errorMessage 系
    // AbortError 文案（'This operation was aborted'）。signal 已 aborted 即实证善意
    // 中止在途（issue watchdog 预算帽 / TUI Esc / webui stop），终态重归因 aborted——
    // 消费面善意词面（『每 issue 预算帽耗尽』等）全靠 aborted 分支承载。
    const controller = new AbortController();
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([assistant({ stopReason: 'error', errorMessage: 'This operation was aborted' })]),
      signal: controller.signal,
    });
    controller.abort();
    const result = await startRun(context, config, [user('q')]);
    expect(result).toMatchObject({ status: 'aborted', stopReason: 'aborted' });
    const end = events[events.length - 1]!;
    expect(end.type === 'agent_end' && end.status).toBe('aborted');
    expect(end.type === 'agent_end' && end.stopReason).toBe('aborted');
  });

  it('重归因反向锁：signal 缺席 / signal 在场未中止 / 文案非 abort 三形均不触发（真 error 仍 failed）', async () => {
    // 三形对照：① signal 缺席（金样回放等无中止面）② signal 在场但未中止 ③ signal
    // 已中止但 errorMessage 非 abort 文案——任何一形都不满足重归因全条件，按 error
    // 原映射 failed（重归因是窄判据三合一，不是 error 泛化）。
    const cases: Array<{ signal?: AbortSignal; message: string }> = [
      { message: 'This operation was aborted' }, // ① 缺席
      { signal: new AbortController().signal, message: 'This operation was aborted' }, // ② 未中止
      { signal: AbortSignal.abort(), message: 'net down' }, // ③ 文案不符
    ];
    for (const { signal, message } of cases) {
      const { context, config } = rig({
        streamFn: scriptedStreamFn([assistant({ stopReason: 'error', errorMessage: message })]),
        ...(signal !== undefined ? { signal } : {}),
      });
      const result = await startRun(context, config, [user('q')]);
      expect(result, message).toMatchObject({ status: 'failed', stopReason: 'error', errorMessage: message });
    }
  });

  it('length → 整批配对 isError 后 failed（残缺批不进下一轮）', async () => {
    const { context, config, events } = rig({
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
    // 截断兜底落消息本体（第十一役 finding 10——修前红锚：修前 errorMessage 只进
    // agent_end 事件正文，assistant 消息本体缺席 → durable 落库/投影拉取/
    // message_end 事件三路皆盲，TUI/webui 错误块判据全失收——兜底须在 stream
    // 终值落位时写进消息本体，三路同源。种子 user 与截断配对 toolResult 各有
    // message_end，按 assistant 角色定位）
    const messageEnd = events.find(
      (e) => e.type === 'message_end' && (e.message as { role?: string }).role === 'assistant',
    ) as { message: { errorMessage?: string } } | undefined;
    expect(messageEnd?.message.errorMessage).toBe('输出被上下文窗口截断（stopReason=length）');
  });
});

/* ---------------- 无 start 前导错误流（04 §3 定形——终值落位判占位在场） ---------------- */

describe('无 start 前导错误流', () => {
  it('error 先于 start 到达：终值 append 不覆写上一条活消息 + 补配对 message_start（真 bug 修前必红）', async () => {
    // provider 前置失败形（pi-ai 请求创建失败 catch 路径只发 error 不发 start）：
    // 修前缺陷 = 终值无条件尾替换把种子 user 消息顶替（数组少一条、用户输入在
    // 活面消失）+ message_end 无配对 message_start（活体事件序违例）。04 §3
    // 2026-09-14 定形：消费面终值落位须判占位在场——未见 start 时终值走
    // append 不替换尾元素。
    const boom = assistant({ stopReason: 'error', errorMessage: 'net down' });
    const streamFn: StreamFn = () => noStartErrorStream(boom);
    const { context, config, events } = rig({ streamFn });
    const result = await startRun(context, config, [user('q')]);
    expect(result).toMatchObject({ status: 'failed', stopReason: 'error', errorMessage: 'net down' });
    // 种子存活 + 终值 append（修前红锚：种子被顶替，长度 1）
    expect(context.messages).toHaveLength(2);
    expect(context.messages[0]).toMatchObject({ role: 'user', content: 'q' });
    expect(context.messages[1]).toMatchObject({ role: 'assistant', stopReason: 'error' });
    // 事件序：终值补配对 message_start——message_end 不裸奔（修前：无此 start）
    expect(typesOf(events)).toEqual([
      'message_start',
      'message_end', // 种子入列
      'agent_start',
      'turn_start',
      'message_start', // 无 start 前导终值的补配对（修前缺）
      'message_end',
      'turn_end',
      'agent_end',
    ]);
  });
});

/* ---------------- 永不抛契约反向锁（违约 throw 显形——批 A C2） ---------------- */

describe('永不抛契约反向锁（违约 throw 显形）', () => {
  // 04 §2 loop 零 try/catch 铁律的另一面：契约内失败（错误终值）→ run 终态
  // failed（上簇已锁）；契约外违约（StreamFn throw）→ 无兜底、沿 await 链
  // 上抛给调用方（driver kick 面 .catch 承接）。本簇钉住「即刻 reject 非挂死」
  // 这一不变式——违约不得把消费面拖成假死（与 watchdog 治的挂死形同向）。

  it('StreamFn 同步 throw：startRun 即刻 reject 非挂死（契约外违约沿 await 链上抛）', async () => {
    const boom: StreamFn = () => {
      throw new Error('违约同步抛（永不抛契约外）');
    };
    const { context, config } = rig({ streamFn: boom });
    await expect(startRun(context, config, [user('q')])).rejects.toThrow('违约同步抛');
  });

  it('流迭代中 throw（体内异常）：同样即刻 reject——区别于流内 error 事件（那是数据，收 failed 终态）', async () => {
    // 迭代器体内 throw：for-await 即刻上抛（不走 result() 终值路）——与
    // noStartErrorStream 形（error 事件 → failed 终态）成对照：事件是数据、
    // 异常是违约，两路消费行为分立
    const throwingStream: AssistantStream = {
      async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
        yield { type: 'start', partial: assistant({}) };
        throw new Error('违约迭代抛（体内异常）');
      },
      result: async () => assistant({}),
    };
    const streamFn: StreamFn = () => throwingStream;
    const { context, config } = rig({ streamFn });
    await expect(startRun(context, config, [user('q')])).rejects.toThrow('违约迭代抛');
  });
});

/* ---------------- preModelRequest 刹车（03 §2.4 agent_pre_step 窗消费位） ---------------- */

describe('preModelRequest 刹车', () => {
  it("'stop' → 零模型请求收场 completed + stopReason 'stop'（零 dangling turn）", async () => {
    const seen: StreamFnOptions[] = [];
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([], seen), // 脚本空——任何模型请求即耗尽抛红
      preModelRequest: () => 'stop',
    });
    const result = await startRun(context, config, [user('刹车')]);
    expect(seen).toHaveLength(0); // 模型请求零发出
    expect(result).toMatchObject({ status: 'completed', stopReason: 'stop' });
    // 事件面：种子入列 → agent_start →（刹车短循环零 turn）→ agent_end
    expect(typesOf(events)).toEqual(['message_start', 'message_end', 'agent_start', 'agent_end']);
    const end = events[events.length - 1]!;
    expect(end.type === 'agent_end' && end.status).toBe('completed');
  });

  it('void 不刹：正常起请求（对照锁）', async () => {
    const { context, config } = rig({
      streamFn: scriptedStreamFn([assistant({ content: [{ type: 'text', text: 'hi' }] })]),
      preModelRequest: () => undefined,
    });
    const result = await startRun(context, config, [user('通行')]);
    expect(result).toMatchObject({ status: 'completed', stopReason: 'stop' }); // 模型自然停
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

  it('混合 effect 批真调度：read 段重叠 + write 屏障经 startRun 全链（研究批 A5——缝合点集成锁）', async () => {
    // 缺口背景（研究批 A5）：读写批调度的真断言此前只在单元直测域
    // （tools-batch.test.ts 的 read 段重叠证明/write 屏障），loop 缝合点
    // （loop.ts 的 toolCallsOf 保序提取 → executeToolBatch 零变换直传 +
    // context.tools 披露 + loop 层 emit 事件时序）无集成锁——提取序破坏
    // 或 effect 披露丢失时单元直测不红。本例经 startRun 全链锁三面：
    // ① read 段内两件在飞重叠（并行档真调度）② write 屏障（read 段排干后
    // 屏障腿才起跑）③ toolResult 按批原序配对。时序探针 = 受控门
    // （不依赖真实时钟）：全链至 read 段挂门全走微任务，单个宏任务拍即到齐。
    const readGate = gate(); // 共同屏障：两 reader 各自 await 才放行（重叠证明）
    const started: string[] = []; // 起跑序探针（execute 体首拍记 id）
    const reader = makeTool(
      'reader',
      async (id) => {
        started.push(id);
        await readGate.promise; // 挂共同门——另一 reader 未起跑则本件永不结算（并行档判别锚）
        return { content: [{ type: 'text', text: 'read-done' }] };
      },
      'read',
    );
    const writer = makeTool(
      'writer',
      async (id) => {
        started.push(id);
        return { content: [{ type: 'text', text: 'write-done' }] };
      },
      'write',
    );
    const { context, config, events } = rig({
      streamFn: scriptedStreamFn([
        // 首轮终值：三块混合批（两 read + 一 write——批原序 r-1, r-2, w-1）
        assistant({
          stopReason: 'toolUse',
          content: [call('r-1', 'reader'), call('r-2', 'reader'), call('w-1', 'writer')],
        }),
        assistant({ content: [{ type: 'text', text: 'done' }] }),
      ]),
    });
    context.tools = [reader, writer];
    const pending = startRun(context, config, [user('q')]); // 全链起跑（时序探针窗——不即 await）
    await new Promise((resolve) => setTimeout(resolve, 0)); // 微任务排干：流消费毕 → read 段两件起跑挂门
    // ①read 段重叠证明：两 reader 均已起跑在飞（r-1 仍挂门未结算）且 writer 零起跑
    //（若 reader 未声明 read 走屏障腿串行：r-1 挂门不结算 → r-2 永不起跑——本断言必红）
    expect([...started].sort()).toEqual(['r-1', 'r-2']);
    readGate.release(); // 放行 → read 段 Promise.all 排干 → write 屏障腿起跑
    const result = await pending;
    // ②write 屏障：writer 的 tool_execution_start 严格晚于两 reader 的 start
    //（事件收集序；两 reader 段内起跑序确定，但断言容交错只锁「均在 writer 前」）
    const startIds = events
      .filter((e): e is Extract<AgentEvent, { type: 'tool_execution_start' }> => e.type === 'tool_execution_start')
      .map((e) => e.toolCallId);
    expect(startIds).toHaveLength(3);
    expect([...startIds.slice(0, 2)].sort()).toEqual(['r-1', 'r-2']); // 两 reader 先（序可交错）
    expect(startIds[2]).toBe('w-1'); // writer 严格殿后（read 段排干后屏障腿才起跑）
    // ③toolResult 按批原序 [r-1, r-2, w-1] 配对入列（全非 error——正常执行腿）
    const trs = context.messages.filter((m) => m.role === 'toolResult') as {
      toolCallId: string;
      isError: boolean;
    }[];
    expect(trs.map((t) => t.toolCallId)).toEqual(['r-1', 'r-2', 'w-1']);
    expect(trs.every((t) => t.isError === false)).toBe(true);
    // ④二轮 stop 收场 completed
    expect(result).toMatchObject({ status: 'completed', stopReason: 'stop' });
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

/* ---------------- 金样喂 loop（批 C A3——文件头「金样 seam 同族」的落码） ---------------- */

describe('金样喂 loop（真录制物重演 + 合成三场景——loop 流消费面 ↔ 金样事件序两面一致性）', () => {
  /**
   * 缺口背景（研究批 A3）：金样此前只在流层回放（src/llm/golden.test.ts 断
   * 协议序 + 终值结构），loop 消费面（stream.ts 的 start 占位入列 → partial
   * 就地替换尾 → 终值 result() 落位）从未吃过真录制事件序——两面漂移（loop
   * 改流消费语义 / 录制器改事件产出）无测试可红。本簇把金样重演为 StreamFn
   * seam 喂 startRun 真消费面：真录制物两件 + 合成三场景
   * （multi-tool/mixed/abort——录制器 SCENARIOS 已扩对应定义，真录属
   * record-once 人工动作待 GLM 凭证，合成夹具先锁消费面）。
   */
  /** 仓库根（src/agent 上两级——同 src/llm/golden.test.ts 布局） */
  const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
  /** 金样目录（零件 = 录制物丢失 fail-loud 红非 skip——同 golden.test.ts 收紧纪律） */
  const GOLDEN_DIR = join(REPO_ROOT, 'tools/golden');

  /** 读金样 JSONL → 事件数组（首行 meta 头行跳过） */
  function loadGoldenEvents(name: string): AssistantStreamEvent[] {
    const lines = readFileSync(join(GOLDEN_DIR, `${name}.jsonl`), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
      throw new Error(`金样 ${name} 行数不足——录制物丢失？（金样已随 15394ef 入库，重录 = npm run golden:record）`);
    }
    if (typeof (JSON.parse(lines[0]!) as { meta?: unknown }).meta !== 'object') {
      throw new Error(`金样 ${name} 首行不是 meta 头行`);
    }
    return lines.slice(1).map((line) => JSON.parse(line) as AssistantStreamEvent);
  }

  /**
   * 金样重演 seam：事件数组 → AssistantStream（yield 全序 + result() 取终值）
   * ——loop 真消费面吃的就是这个形状；「mock 只停 streamFn 注入位」纪律内
   * 金样与 scripted 终值同族，但事件序是录制物真形非简化三事件形。
   */
  function replayGoldenStream(events: AssistantStreamEvent[]): AssistantStream {
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
        for (const event of events) yield event;
      },
      result: async (): Promise<AssistantMessage> => {
        const final = events[events.length - 1];
        if (final?.type === 'done') return final.message;
        if (final?.type === 'error') return final.error;
        throw new Error('金样事件序未以 done/error 收尾（录制器契约违约——重录信号）');
      },
    };
  }

  /** 终事件收窄（真金样两件恒 done 形；非 done 即录制物形状漂移——fail-loud 重录信号） */
  function doneFinal(events: AssistantStreamEvent[]): {
    reason: 'stop' | 'length' | 'toolUse' | 'deferred';
    message: AssistantMessage;
  } {
    const final = events[events.length - 1];
    if (final?.type !== 'done')
      throw new Error(`金样终事件非 done（${String(final?.type)}）——录制物形状漂移，重录信号`);
    return final;
  }

  /**
   * 合成事件序（真协议 12 型形）：外层 start → 逐块 start/delta×2/end → 终
   * 事件（done 四 reason / error 二 reason）。partial 恒全量终值快照——真录
   * 金样实证形（pi-ai 每事件 partial 携带完整累计快照），loop 尾替换语义对
   * 任意合法快照成立。
   */
  function synthesizeEvents(final: AssistantMessage): AssistantStreamEvent[] {
    const snapshot = (): AssistantMessage => ({ ...final, content: final.content.map((b) => ({ ...b })) });
    const events: AssistantStreamEvent[] = [{ type: 'start', partial: snapshot() }];
    final.content.forEach((block, index) => {
      if (block.type === 'thinking') {
        events.push({ type: 'thinking_start', contentIndex: index, partial: snapshot() });
        events.push({ type: 'thinking_delta', contentIndex: index, delta: 'd1', partial: snapshot() });
        events.push({ type: 'thinking_delta', contentIndex: index, delta: 'd2', partial: snapshot() });
        events.push({ type: 'thinking_end', contentIndex: index, partial: snapshot() });
      } else if (block.type === 'text') {
        events.push({ type: 'text_start', contentIndex: index, partial: snapshot() });
        events.push({ type: 'text_delta', contentIndex: index, delta: 'd1', partial: snapshot() });
        events.push({ type: 'text_delta', contentIndex: index, delta: 'd2', partial: snapshot() });
        events.push({ type: 'text_end', contentIndex: index, content: block.text, partial: snapshot() });
      } else {
        events.push({ type: 'toolcall_start', contentIndex: index, partial: snapshot() });
        events.push({ type: 'toolcall_delta', contentIndex: index, delta: 'd1', partial: snapshot() });
        events.push({ type: 'toolcall_end', contentIndex: index, toolCall: { ...block }, partial: snapshot() });
      }
    });
    if (final.stopReason === 'error' || final.stopReason === 'aborted') {
      events.push({ type: 'error', reason: final.stopReason, error: final });
    } else {
      // done 族四 reason 硬收窄（'pending' 是流中间态 partial 专用 stopReason
      // ——合成终值恒 done 族，构造面已保证）
      const reason = final.stopReason as 'stop' | 'length' | 'toolUse' | 'deferred';
      events.push({ type: 'done', reason, message: final });
    }
    return events;
  }

  it('真金样 tool-call 重演喂 loop：thinking+toolCall 块序消费保真 → 工具真执行配对 → 二轮收场', async () => {
    const events = loadGoldenEvents('tool-call');
    const goldenFinal = doneFinal(events);
    // 自引用对拍源：金样终值里的 toolCall 块（id/name/块序全从录制物取——禁臆断录制内容）
    const goldenCall = goldenFinal.message.content.find((b): b is ToolCallBlock => b.type === 'toolCall');
    if (goldenCall === undefined) throw new Error('金样 tool-call 终值无 toolCall 块——场景退化（重录信号）');
    const executed: string[] = [];
    const tool = makeTool(goldenCall.name, async (id) => {
      executed.push(id);
      return { content: [{ type: 'text', text: 'ok' satisfies string }] };
    });
    let round = 0;
    const streamFn: StreamFn = () => {
      round += 1;
      // 首轮 = 金样重演（真录制事件序进 loop 流消费面）；二轮 = 既有 makeStream 简化形收场
      return round === 1
        ? replayGoldenStream(events)
        : makeStream(assistant({ content: [{ type: 'text', text: 'done' }] }));
    };
    const { context, config } = rig({ streamFn });
    context.tools = [tool];
    const result = await startRun(context, config, [user('金样重演')]);
    expect(result.status).toBe('completed');
    // 金样 toolCall 真穿到执行面（id 自引用对拍）
    expect(executed).toEqual([goldenCall.id]);
    // 两面一致性本体断言：loop 消费（占位入列 + 逐事件尾替换 + 终值落位）后的
    // 活消息终值与金样终值逐块同形
    const live = context.messages.find(
      (m) => m.role === 'assistant' && (m as AssistantMessage).stopReason === 'toolUse',
    ) as AssistantMessage;
    expect(live.content.map((b) => b.type)).toEqual(goldenFinal.message.content.map((b) => b.type));
    // thinking 块携带 thinkingSignature 键（真录制物特有形状——合成件没有的键位面）
    const think = live.content.find((b) => b.type === 'thinking');
    expect(think !== undefined && 'thinkingSignature' in think).toBe(true);
    // usage 真录非零形状
    expect(live.usage.totalTokens).toBeGreaterThan(0);
    // 配对：toolResult.toolCallId === 金样终值 toolCall.id
    const tr = context.messages.find((m) => m.role === 'toolResult') as { toolCallId: string; isError: boolean };
    expect(tr.toolCallId).toBe(goldenCall.id);
    expect(tr.isError).toBe(false);
  });

  it('真金样 plain-answer 重演喂 loop：纯答一轮收场 completed + 终值保真', async () => {
    const events = loadGoldenEvents('plain-answer');
    const goldenFinal = doneFinal(events);
    const streamFn: StreamFn = () => replayGoldenStream(events);
    const { context, config } = rig({ streamFn });
    const result = await startRun(context, config, [user('金样重演')]);
    expect(result.status).toBe('completed');
    expect(result.stopReason).toBe('stop');
    expect(context.messages).toHaveLength(2); // 种子 + 终值（无工具轮）
    const live = context.messages[1] as AssistantMessage;
    expect(live.content.map((b) => b.type)).toEqual(goldenFinal.message.content.map((b) => b.type));
    expect(live.usage.totalTokens).toBeGreaterThan(0);
  });

  it('合成 multi-tool：一消息两 toolCall → 批执行全配对（两 toolResult 非 error）→ 二轮收场', async () => {
    const first = assistant({ stopReason: 'toolUse', content: [call('mt-1', 'probe'), call('mt-2', 'probe')] });
    const callsDone: string[] = [];
    const tool = makeTool('probe', async (id) => {
      callsDone.push(id);
      return { content: [] };
    });
    let round = 0;
    const streamFn: StreamFn = () => {
      round += 1;
      return round === 1
        ? replayGoldenStream(synthesizeEvents(first))
        : makeStream(assistant({ content: [{ type: 'text', text: 'done' }] }));
    };
    const { context, config } = rig({ streamFn });
    context.tools = [tool];
    const result = await startRun(context, config, [user('multi-tool')]);
    expect(result.status).toBe('completed');
    expect(callsDone).toEqual(['mt-1', 'mt-2']); // 批内全执行
    const trs = context.messages.filter((m) => m.role === 'toolResult') as { toolCallId: string; isError: boolean }[];
    expect(trs.map((t) => t.toolCallId)).toEqual(['mt-1', 'mt-2']);
    expect(trs.every((t) => t.isError === false)).toBe(true);
  });

  it('合成 mixed：thinking+text+toolCall 三块混合序 → 终值三块全保真 + 工具执行配对', async () => {
    const first = assistant({
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: '思路', thinkingSignature: 'sig-x' } satisfies ThinkingContent,
        { type: 'text', text: '先说明再动手' },
        call('mx-1', 'probe'),
      ],
    });
    let round = 0;
    const streamFn: StreamFn = () => {
      round += 1;
      return round === 1
        ? replayGoldenStream(synthesizeEvents(first))
        : makeStream(assistant({ content: [{ type: 'text', text: 'done' }] }));
    };
    const { context, config } = rig({ streamFn });
    context.tools = [makeTool('probe')];
    const result = await startRun(context, config, [user('mixed')]);
    expect(result.status).toBe('completed');
    const live = context.messages.find(
      (m) => m.role === 'assistant' && (m as AssistantMessage).stopReason === 'toolUse',
    ) as AssistantMessage;
    // 三块序消费保真（前块不被逐事件尾替换链吃掉——partial 替换语义对混合块序的正确性）
    expect(live.content.map((b) => b.type)).toEqual(['thinking', 'text', 'toolCall']);
    const tr = context.messages.find((m) => m.role === 'toolResult') as { toolCallId: string };
    expect(tr.toolCallId).toBe('mx-1');
  });

  it('合成 abort：流中段 abort 收口（text 块后 error 事件 reason aborted）→ run 终态 aborted', async () => {
    // abort 收口形 = error 事件（reason 'aborted'）+ 载荷 stopReason 'aborted'
    // （contracts 12 型：done 四 reason 不含 aborted——中止恒走 error 事件腿）
    const abortedFinal = assistant({ stopReason: 'aborted', content: [{ type: 'text', text: '部分输出' }] });
    const streamFn: StreamFn = () => replayGoldenStream(synthesizeEvents(abortedFinal));
    const { context, config, events } = rig({ streamFn });
    const result = await startRun(context, config, [user('abort')]);
    expect(result).toMatchObject({ status: 'aborted', stopReason: 'aborted' });
    const end = events[events.length - 1]!;
    expect(end.type === 'agent_end' && end.status).toBe('aborted');
    // 流中段已产出的 text 块不被 abort 收口吞（活消息保真）
    const live = context.messages.find((m) => m.role === 'assistant') as AssistantMessage;
    expect(live.stopReason).toBe('aborted');
    expect(live.content.map((b) => b.type)).toEqual(['text']);
  });
});
