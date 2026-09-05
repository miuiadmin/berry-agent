/**
 * llm — StreamFn 适配层测试（04 §3「永不抛」契约 + §3.6 在飞帽）。
 *
 * faux provider 走真实 pi-ai streamSimple 路径（mock 只停模型层——脚本响应）。
 * 四面钉死：错误编码为流内数据（两前置环节）、直通零拷贝、参数组装、
 * 在飞名额释放双保险。
 */
import { describe, expect, it } from 'vitest';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type { Context as PiContext, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { AssistantStreamEvent, LlmContext, Message, UserMessage } from '../contracts/index.js';
import { classifyError } from './recovery.js';
import { createStreamFn } from './stream-fn.js';
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
    expect(events.map((e) => e.type)).toEqual(['error']);
    const error = events[0] as Extract<AssistantStreamEvent, { type: 'error' }>;
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
    expect(events.map((e) => e.type)).toEqual(['error']);
    const final = await stream.result();
    expect(final.errorCode).toBe('LLM_INFLIGHT_LIMIT');
    expect(final.errorMessage).toContain('在飞请求达帽');
    expect(classifyError(final)).toBe('transient');
    // 我方持有的名额不受影响（拒绝路径不碰计数）
    expect(tracker.inFlight('faux-test')).toBe(1);
    held!.release();
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
