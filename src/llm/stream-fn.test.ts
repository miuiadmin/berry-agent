/**
 * llm — StreamFn 适配层测试（04 §3「永不抛」契约 + §3.6 在飞帽 + §3.8 idle 帽）。
 *
 * faux provider 走真实 pi-ai streamSimple 路径（mock 只停模型层——脚本响应）。
 * 五面钉死：错误编码为流内数据（两前置环节）、直通零拷贝、参数组装、
 * 在飞名额释放双保险、流活性 watchdog（帽停滞不帽时长 + 释放第四路径）。
 */
import { describe, expect, it } from 'vitest';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type {
  AssistantMessage,
  AssistantStream,
  AssistantStreamEvent,
  LlmContext,
  Message,
  UserMessage,
} from '../contracts/index.js';
import { classifyError } from './recovery.js';
import { createStreamFn, withIdleTimeout } from './stream-fn.js';
import { createLlmRuntime } from './runtime.js';
import { InFlightTracker } from './inflight.js';

/* ---------------- 测试基建 ---------------- */

/** 用户消息工厂 */
function userMsg(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: 1 };
}

/** 建一个 faux 测试运行时（两模型 m1/m2） */
function makeFauxRuntime(providerName = 'faux-test') {
  const faux = fauxProvider({ provider: providerName, models: [{ id: 'm1' }, { id: 'm2' }] });
  const runtime = createLlmRuntime({ providers: [faux.provider] });
  return { faux, runtime };
}

/** 捕获型响应工厂：记录每次调用的 pi-ai 请求面（context/options），恒回固定文本 */
function capturingFactory(
  captures: Array<{ context: PiContext; options: SimpleStreamOptions | undefined }>,
  text = 'ok',
) {
  return (context: PiContext, options: SimpleStreamOptions | undefined) => {
    captures.push({ context, options });
    return fauxAssistantMessage(text);
  };
}

/** 收集流事件序列（以 done/error 收尾后自然结束） */
async function drainStream(stream: AsyncIterable<AssistantStreamEvent>): Promise<AssistantStreamEvent[]> {
  const events: AssistantStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** 单次调用上下文（最简形：一条用户消息） */
function simpleContext(messages: Message[]): LlmContext {
  return { systemPrompt: '测试系统提示词', messages };
}

/* ---------------- 永不抛：错误编码为流内数据 ---------------- */

describe('永不抛契约（模型解析失败 → 错误流）', () => {
  it('模型不存在：单 error 终止事件 + 终值带 errorCode（分类归 non-retryable）', async () => {
    const { runtime } = makeFauxRuntime();
    const streamFn = createStreamFn(runtime);
    // 调用本身不抛（同步面）——错误在流内
    const stream = await streamFn(simpleContext([userMsg('hi')]), { model: 'faux-test/m9' });
    const events = await drainStream(stream);
    // 合成错误流自洽形：start 占位先行 → error 收尾（04 §3——消费面须容无 start
    // 前导形，但产出面仍按理想序供给）
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    const start = events[0] as Extract<AssistantStreamEvent, { type: 'start' }>;
    expect(start.partial.role).toBe('assistant');
    const error = events[1] as Extract<AssistantStreamEvent, { type: 'error' }>;
    expect(error.error.stopReason).toBe('error');
    // 终值同一错误消息：errorMessage 携 [CODE] 前缀（人读）+ errorCode 机器判定位
    const final = await stream.result();
    expect(final.stopReason).toBe('error');
    expect(final.errorCode).toBe('LLM_MODEL_NOT_FOUND');
    expect(final.errorMessage).toContain('[LLM_MODEL_NOT_FOUND]');
    // 解析失败是确定性错误——归 non-retryable（重试无意义）
    expect(classifyError(final)).toBe('non-retryable');
  });

  it('格式非法同路（LLM_MODEL_SPEC_INVALID）', async () => {
    const { runtime } = makeFauxRuntime();
    const streamFn = createStreamFn(runtime);
    const stream = await streamFn(simpleContext([userMsg('hi')]), { model: 'no-slash' });
    const final = await stream.result();
    expect(final.errorCode).toBe('LLM_MODEL_SPEC_INVALID');
  });
});

describe('永不抛契约（在飞帽达帽 → 错误流，transient 桶）', () => {
  it('达帽显式拒绝：errorCode=LLM_INFLIGHT_LIMIT、分类 transient（退避后槽已释放重试成功）', async () => {
    const { runtime } = makeFauxRuntime();
    const tracker = new InFlightTracker(1);
    const held = tracker.tryAcquire('faux-test'); // 占满帽
    expect(held).not.toBeNull();
    const streamFn = createStreamFn(runtime, {}, tracker);
    const stream = await streamFn(simpleContext([userMsg('hi')]), { model: 'faux-test/m1' });
    const events = await drainStream(stream);
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    const final = await stream.result();
    expect(final.errorCode).toBe('LLM_INFLIGHT_LIMIT');
    expect(final.errorMessage).toContain('在飞请求达帽');
    expect(classifyError(final)).toBe('transient');
    // 我方持有的名额不受影响（拒绝路径不碰计数）
    expect(tracker.inFlight('faux-test')).toBe(1);
    held!.release();
  });
});

/* ---------------- 钩子派发段执法（03 §3.4——LLM_CALL_IN_HOOK 接线，ca-3） ---------------- */

describe('钩子派发段前置查（钩子 handler 内流式调用 → 错误流携码）', () => {
  it('窗内命中：errorCode=LLM_CALL_IN_HOOK、分类 non-retryable（违例非瞬态）', async () => {
    const { runtime } = makeFauxRuntime();
    const streamFn = createStreamFn(runtime, {}, undefined, { inHookDispatch: () => true });
    const stream = await streamFn(simpleContext([userMsg('hi')]), { model: 'faux-test/m1' });
    const events = await drainStream(stream);
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    const final = await stream.result();
    expect(final.errorCode).toBe('LLM_CALL_IN_HOOK');
    expect(final.errorMessage).toContain('钩子执行段禁模型调用');
    expect(classifyError(final)).toBe('non-retryable');
  });

  it('窗外放行（inHookDispatch false = 正常路径不受执法面影响）；不传第四参 = 执法缺席', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('正常'), () => fauxAssistantMessage('正常')]);
    const inWindow = createStreamFn(runtime, {}, undefined, { inHookDispatch: () => false });
    const finalA = await (await inWindow(simpleContext([userMsg('hi')]), { model: 'faux-test/m1' })).result();
    expect(finalA.errorCode).toBeUndefined(); // 窗外零拦截
    const noGuard = createStreamFn(runtime);
    const finalB = await (await noGuard(simpleContext([userMsg('hi')]), { model: 'faux-test/m1' })).result();
    expect(finalB.errorCode).toBeUndefined(); // 缺席形同窗外
  });
});

/* ---------------- 成功路：直通零拷贝与参数组装 ---------------- */

describe('直通与参数组装（超集兼容子集）', () => {
  it('messages 引用相等（零拷贝）、systemPrompt 原样、工具描述收口', async () => {
    const { faux, runtime } = makeFauxRuntime();
    const captures: Array<{ context: PiContext; options: SimpleStreamOptions | undefined }> = [];
    faux.setResponses([capturingFactory(captures)]);
    const streamFn = createStreamFn(runtime);
    const messages = [userMsg('你好')];
    const final = await (
      await streamFn(
        {
          systemPrompt: '系统提示词甲',
          messages,
          tools: [{ name: 'lookup', description: '查词典', parameters: { type: 'object', properties: {} } }],
        },
        { model: 'faux-test/m1' },
      )
    ).result();
    expect(final.stopReason).toBe('stop');
    const seen = captures[0]!;
    expect(seen.context.messages).toBe(messages); // 引用同一数组——零转换零拷贝
    expect(seen.context.systemPrompt).toBe('系统提示词甲');
    expect(seen.context.tools?.[0]?.name).toBe('lookup');
  });

  it('thinkingLevel → reasoning 映射：非 off 档透传；off/缺省 = undefined（关闭）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    const captures: Array<{ context: PiContext; options: SimpleStreamOptions | undefined }> = [];
    faux.setResponses([capturingFactory(captures), capturingFactory(captures), capturingFactory(captures)]);
    const streamFn = createStreamFn(runtime);
    const ctx = simpleContext([userMsg('x')]);
    await (await streamFn(ctx, { model: 'faux-test/m1', thinkingLevel: 'high' })).result();
    expect(captures[0]!.options?.reasoning).toBe('high');
    await (await streamFn(ctx, { model: 'faux-test/m1', thinkingLevel: 'off' })).result();
    expect(captures[1]!.options?.reasoning).toBeUndefined();
    await (await streamFn(ctx, { model: 'faux-test/m1' })).result();
    expect(captures[2]!.options?.reasoning).toBeUndefined();
  });

  it('defaults 打底 + apiKey/signal 透传（signal 引用同体）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    const captures: Array<{ context: PiContext; options: SimpleStreamOptions | undefined }> = [];
    faux.setResponses([capturingFactory(captures)]);
    const streamFn = createStreamFn(runtime, { temperature: 0.7, maxTokens: 128, timeoutMs: 11111 });
    const controller = new AbortController();
    await (
      await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1', apiKey: 'sk-test' }, controller.signal)
    ).result();
    const options = captures[0]!.options as Record<string, unknown>;
    expect(options['temperature']).toBe(0.7); // defaults 打底
    expect(options['maxTokens']).toBe(128);
    expect(options['timeoutMs']).toBe(11111);
    expect(options['apiKey']).toBe('sk-test'); // 具名键透传
    expect(options['signal']).toBe(controller.signal); // 引用同体
  });
});

/* ---------------- 在飞名额：释放双保险 ---------------- */

describe('名额释放双保险（迭代 return() 与 result() 任一先到）', () => {
  it('完整消费路：for-await 耗尽后名额归零', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('ok')]);
    const tracker = new InFlightTracker(4);
    const streamFn = createStreamFn(runtime, {}, tracker);
    const stream = await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' });
    expect(tracker.inFlight('faux-test')).toBe(1); // 在飞中
    const events = await drainStream(stream);
    expect(events.at(-1)?.type).toBe('done');
    expect(tracker.inFlight('faux-test')).toBe(0); // 迭代 return() 已释放
  });

  it('result() 兜底路：只取终值不迭代也释放（早 break 不调 return 的消费形态）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('ok')]);
    const tracker = new InFlightTracker(4);
    const streamFn = createStreamFn(runtime, {}, tracker);
    const stream = await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' });
    const final = await stream.result(); // 不迭代
    expect(final.stopReason).toBe('stop');
    expect(tracker.inFlight('faux-test')).toBe(0);
  });

  it('双路径并走只减一次（幂等）：耗尽迭代后再取 result()', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('ok')]);
    const tracker = new InFlightTracker(4);
    const streamFn = createStreamFn(runtime, {}, tracker);
    const stream = await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' });
    await drainStream(stream);
    await stream.result(); // 第二路——幂等不多减
    expect(tracker.inFlight('faux-test')).toBe(0);
  });

  it('早断流（break）触发迭代 return() 释放', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('一段较长的文本内容')]);
    const tracker = new InFlightTracker(4);
    const streamFn = createStreamFn(runtime, {}, tracker);
    const stream = await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' });
    for await (const _event of stream) {
      break; // 首事件即断
    }
    expect(tracker.inFlight('faux-test')).toBe(0);
  });

  it('释放后名额可复用（连续两次调用各占各还）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('a'), () => fauxAssistantMessage('b')]);
    const tracker = new InFlightTracker(1); // 帽 1——串行复用是唯一通路
    const streamFn = createStreamFn(runtime, {}, tracker);
    const first = await (await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' })).result();
    expect(first.stopReason).toBe('stop');
    const second = await (await streamFn(simpleContext([userMsg('y')]), { model: 'faux-test/m1' })).result();
    expect(second.stopReason).toBe('stop'); // 帽 1 下第二次成功 = 第一次确已释放
  });

  it('不传 tracker = 不限流（直通形态）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => fauxAssistantMessage('ok')]);
    const streamFn = createStreamFn(runtime);
    const final = await (await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' })).result();
    expect(final.stopReason).toBe('stop');
  });
});

/* ---------------- 流活性 watchdog（04 §3.8 idle 帽） ---------------- */

/** 延时零件（paced 流测试） */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 正常终值消息工厂（直测用——零用量即简形） */
function okMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  };
}

/** 手搓 AssistantStream（direct 测试形）：iterator 与 result 分别注入 */
function handStream(
  iterator: AsyncIterator<AssistantStreamEvent>,
  result: () => Promise<AssistantMessage>,
): AssistantStream {
  return { [Symbol.asyncIterator]: () => iterator, result };
}

/** 停滞流基建：产 start 后挂死（永不产下一事件）；return 调用可观测 */
function hungStream(): { stream: AssistantStream; returnCalled: () => boolean } {
  let returnCalled = false;
  async function* events(): AsyncGenerator<AssistantStreamEvent> {
    yield { type: 'start', partial: okMessage('挂死前快照') };
    await new Promise(() => {}); // 挂死——流停滞（模拟流中段 body 断供）
    yield { type: 'done', reason: 'stop', message: okMessage('不可达') };
  }
  const underlying = events();
  const tracked: AsyncIterator<AssistantStreamEvent> = {
    next: (value) => underlying.next(value),
    // 观测位：watchdog 超帽收口必经底层 return（fire-and-forget 不 await——
    // async generator 挂死在体内 await 时 return() 悬置，await 会假死）
    return: (value) => {
      returnCalled = true;
      return underlying.return(value);
    },
    throw: (error) => underlying.throw(error),
  };
  return {
    stream: handStream(tracked, () => new Promise<AssistantMessage>(() => {})),
    returnCalled: () => returnCalled,
  };
}

describe('流活性 watchdog（04 §3.8——帽停滞不帽时长）', () => {
  it('停滞流超帽：合成 error 终值携 idle 码 → transient 桶 + 底层 return 收口被调', async () => {
    const hung = hungStream();
    const wrapped = withIdleTimeout(hung.stream, 20); // 短帽 20ms——start 后停滞
    const events = await drainStream(wrapped);
    // 合成收口形：error 终止事件收尾（start 是真实事件——合成只补尾部，不重发 start）
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
    const final = await wrapped.result();
    expect(final.stopReason).toBe('error');
    expect(final.errorCode).toBe('LLM_STREAM_IDLE_TIMEOUT');
    expect(final.errorMessage).toContain('[LLM_STREAM_IDLE_TIMEOUT]');
    // 流停滞是瞬态（换新连接即恢复路径）——transient 桶，turn 级 auto-retry 承担
    expect(classifyError(final)).toBe('transient');
    expect(hung.returnCalled()).toBe(true); // 底层迭代收口被调
  });

  it('消费面 break 不被底层 return 拖死：终值事件即 break（agent loop 同形）即刻退出', async () => {
    const hung = hungStream();
    const wrapped = withIdleTimeout(hung.stream, 20);
    // agent/stream.ts 消费形：收 done/error 终值事件即 break——break 触发迭代
    // return()。底层挂死流的 return() 永不 settle（async generator 体内 await
    // 悬置）——wrapper 不得 await 底层（修前红形：break 卡死即测试超时红）
    const types: string[] = [];
    for await (const event of wrapped) {
      types.push(event.type);
      if (event.type === 'error') break;
    }
    expect(types).toEqual(['start', 'error']);
    const final = await wrapped.result(); // break 后 result() 走 hung 短路面
    expect(final.errorCode).toBe('LLM_STREAM_IDLE_TIMEOUT');
    expect(hung.returnCalled()).toBe(true); // 底层转发被调（fire-and-forget，同步段即调）
  });

  it('正常流零扰动：事件与终值原样透传（帽只治停滞不治慢）', async () => {
    const finalMsg = okMessage('正常');
    async function* paced(): AsyncGenerator<AssistantStreamEvent> {
      await delay(5);
      yield { type: 'start', partial: finalMsg };
      await delay(5);
      yield { type: 'text_delta', contentIndex: 0, delta: 'x', partial: finalMsg };
      await delay(5);
      yield { type: 'done', reason: 'stop', message: finalMsg };
    }
    const wrapped = withIdleTimeout(
      handStream(paced(), async () => finalMsg),
      50,
    );
    const events = await drainStream(wrapped);
    expect(events.map((e) => e.type)).toEqual(['start', 'text_delta', 'done']);
    await expect(wrapped.result()).resolves.toBe(finalMsg); // 引用同体——终值零扰动
  });

  it('帽停滞不帽时长：段间事件到刷新钟（总时长超帽不误杀）', async () => {
    const finalMsg = okMessage('慢而活的流');
    async function* slowButAlive(): AsyncGenerator<AssistantStreamEvent> {
      for (let i = 0; i < 3; i++) {
        await delay(30); // 每段 30ms < 帽 40ms——逐段刷新
        yield { type: 'text_delta', contentIndex: 0, delta: String(i), partial: finalMsg };
      }
      yield { type: 'done', reason: 'stop', message: finalMsg };
    }
    // 总时长 90ms 远超 40ms 帽——若帽治时长必误杀；帽治停滞则全程无虞
    const wrapped = withIdleTimeout(
      handStream(slowButAlive(), async () => finalMsg),
      40,
    );
    const events = await drainStream(wrapped);
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'text_delta', 'done']);
  });

  it('result() 直取形兜底：不迭代直接取终值同样受 idle 帽（自调用起算）', async () => {
    const wrapped = withIdleTimeout(
      handStream(
        (async function* idleNeverIterated(): AsyncGenerator<AssistantStreamEvent> {})(),
        () => new Promise<AssistantMessage>(() => {}), // 终值挂死——直取形下唯一活性面
      ),
      20,
    );
    const final = await wrapped.result();
    expect(final.stopReason).toBe('error');
    expect(final.errorCode).toBe('LLM_STREAM_IDLE_TIMEOUT');
  });

  it('hung 位一次性：收口后重复 next/result 短路到同一合成终值（不重复计时）', async () => {
    const hung = hungStream();
    const wrapped = withIdleTimeout(hung.stream, 20);
    const first = await drainStream(wrapped);
    expect(first.at(-1)?.type).toBe('error');
    // 收口后再迭代：立即 done（不再等帽、不再产第二枚合成事件）
    const iterator = wrapped[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(wrapped.result()).resolves.toMatchObject({ errorCode: 'LLM_STREAM_IDLE_TIMEOUT' });
  });

  it('createStreamFn 接线：defaults.idleTimeoutMs 生效（帽外层 + 释放走内层 withRelease）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    // 永不 resolve 的响应工厂——真 pi-ai streamSimple 路径上流停滞
    faux.setResponses([() => new Promise<PiAssistantMessage>(() => {})]);
    const tracker = new InFlightTracker(4);
    const streamFn = createStreamFn(runtime, { idleTimeoutMs: 20 }, tracker);
    const stream = await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' });
    expect(tracker.inFlight('faux-test')).toBe(1); // 在飞中
    const events = await drainStream(stream);
    expect(events.at(-1)?.type).toBe('error');
    const final = await stream.result();
    expect(final.errorCode).toBe('LLM_STREAM_IDLE_TIMEOUT');
    expect(classifyError(final)).toBe('transient');
    // §3.6 释放幂等律第四路径：超帽收口经底层 return → 内层 withRelease 释放
    expect(tracker.inFlight('faux-test')).toBe(0);
  });

  it('idleTimeoutMs 缺席 = 不设帽（watchdog 不接线——挂死由上层编排帽兜底）', async () => {
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([() => new Promise<PiAssistantMessage>(() => {})]);
    const tracker = new InFlightTracker(4);
    const streamFn = createStreamFn(runtime, {}, tracker); // 无 idleTimeoutMs
    const stream = await streamFn(simpleContext([userMsg('x')]), { model: 'faux-test/m1' });
    // 200ms 无首事件 = 无 watchdog 的直通形态（有帽则 20ms 量级已合成收口）
    const raced = await Promise.race([
      stream[Symbol.asyncIterator]().next(),
      delay(200).then(() => 'no-watchdog' as const),
    ]);
    expect(raced).toBe('no-watchdog');
    // 测试收尾释放槽：经迭代 return 路（withRelease release）——不泄漏到后续用例
    await stream[Symbol.asyncIterator]().return?.({ value: undefined, done: true });
    expect(tracker.inFlight('faux-test')).toBe(0);
  });
});
