/**
 * llm — provider 观测桩位测试（04 §3 provider 观测桩位——provider-event-6+pi-7 件 B）。
 *
 * 锁面两层：
 *  - L1 组装与包装锁（faux 零网络——mock 只停模型层）：stream 路三回调经
 *    observationCallbacks 包装进入 pi-ai 请求面（包装体≠裸回调——组装位后置
 *    覆盖）+包装三律（onPayload 恒返 undefined〔pi-ai 替换语义禁用〕/三回调
 *    故障隔离〔第二道防线〕/实参直通）+缺席锁（无回调 → 零键扩）+complete
 *    路同笔（两出口同源——complete 是后台件唯一模型面，单挂流路即观测盲区）；
 *    faux 真派发 onResponse {200,{}}（faux 缺席律：onPayload/onProviderStreamEvent
 *    faux 腿不挂——两键真派发锁归 L2）。
 *  - L2 真适配器锁（04 §3 条款钦定形：真适配器+fetch 注入 mock——faux 形恒
 *    假绿）：custom 渠道 anthropic-messages 协议腿（@anthropic-ai/sdk 真客户端
 *    +真 SSE 解析），vi.spyOn(globalThis,'fetch') 截传输层——SDK 缺省 fetch 于
 *    客户端构造时点取全局值（shims.getDefaultFetch 调用时解析非 import 期
 *    绑定），spy 先装即截获：
 *      L2a 网络错形——fetch 拒绝 → onPayload 已派发（挂点在请求发出前）+
 *      onResponse 零调用（SDK 腿失败不可见：onResponse 挂在 retryProviderRequest
 *      之后，04 §3 真源）+错误终值收场（错误是数据非异常）；
 *      L2b 成功面——200 SSE 六帧手写 → onResponse {status:200}+
 *      onProviderStreamEvent 逐帧派发（六型全到）+result() stopReason 'stop'。
 */
import { describe, expect, it, vi } from 'vitest';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type { AssistantStreamEvent, LlmContext, UserMessage } from '../contracts/index.js';
import { createStreamFn, observationCallbacks } from './stream-fn.js';
import { createLlmService } from './complete.js';
import { createCustomChannelProvider, unregisterCustomProviderDef } from './index.js';
import { createLlmRuntime } from './runtime.js';

/* ---------------- 测试基建 ---------------- */

/** 捕获面形：faux 响应工厂记录的 pi-ai 请求面 */
type Captures = Array<{
  context: import('@earendil-works/pi-ai').TranscriptContext;
  options: import('@earendil-works/pi-ai').SimpleStreamOptions | undefined;
}>;

/** 用户消息工厂 */
function userMsg(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: 1 };
}

/** 单次调用上下文（最简形：一条用户消息） */
function simpleContext(messages: UserMessage[]): LlmContext {
  return { systemPrompt: '观测测试系统提示词', messages };
}

/** 建一个 faux 测试运行时（单模型 m1——观测锁不需要多模型） */
function makeFauxRuntime(providerName = 'faux-obs') {
  const faux = fauxProvider({ provider: providerName, models: [{ id: 'm1' }] });
  const runtime = createLlmRuntime({ providers: [faux.provider] });
  return { faux, runtime };
}

/** 捕获型响应工厂：记录每次调用的 pi-ai 请求面（context/options），恒回固定文本 */
function capturingFactory(captures: Captures, text = 'ok') {
  return (
    context: import('@earendil-works/pi-ai').TranscriptContext,
    options: import('@earendil-works/pi-ai').SimpleStreamOptions | undefined,
  ) => {
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

/** pi-ai 钩子位 model 参类型（宽收窄用——窄面对象 {provider,id} 结构兼容全 Model） */
type PiHookModel = Parameters<NonNullable<import('@earendil-works/pi-ai').SimpleStreamOptions['onPayload']>>[1];

/** 窄面模型对象（宿主回调契约只承诺元数据级——包装体按窄面收参直通） */
function narrowModel(provider: string, id: string): PiHookModel {
  return { provider, id } as unknown as PiHookModel;
}

/* ---------------- L1：组装与包装锁（faux 零网络） ---------------- */

describe('L1 组装与包装锁（stream 路组装位）', () => {
  it('三回调经包装进入 pi-ai 请求面：包装体≠裸回调+恒返 undefined+实参直通+故障隔离', async () => {
    const onPayload = vi.fn();
    const onResponse = vi.fn();
    const onProviderStreamEvent = vi.fn();
    const { faux, runtime } = makeFauxRuntime();
    const captures: Captures = [];
    faux.setResponses([capturingFactory(captures)]);
    const streamFn = createStreamFn(runtime, { onPayload, onResponse, onProviderStreamEvent });
    await (await streamFn(simpleContext([userMsg('观测组装')]), { model: 'faux-obs/m1' })).result();

    const options = captures[0]!.options!;
    // 三键在场且是包装体非裸回调（组装位 spread 后置覆盖——04 §3 组装位）
    expect(typeof options.onPayload).toBe('function');
    expect(typeof options.onResponse).toBe('function');
    expect(typeof options.onProviderStreamEvent).toBe('function');
    expect(options.onPayload).not.toBe(onPayload);
    expect(options.onResponse).not.toBe(onResponse);
    expect(options.onProviderStreamEvent).not.toBe(onProviderStreamEvent);

    // 恒返 undefined（三律①：pi-ai 替换语义 Return undefined to keep the payload
    // unchanged——返回非 undefined 即整替换外发载荷，观测用途禁用）
    const piModel = narrowModel('faux-obs', 'm1');
    const payload = { model: 'm1', messages: [] };
    expect(options.onPayload!(payload, piModel)).toBeUndefined();
    // 实参直通：裸回调收到的正是同一对象（引用相等——零重建零拷贝）
    expect(onPayload).toHaveBeenCalledTimes(1);
    expect(onPayload).toHaveBeenCalledWith(payload, piModel);

    // 故障隔离（三律②第二道防线）：裸回调抛错 → 包装体不抛仍返 undefined
    //（pi-ai 适配器裸 await 派发无局部 try，回调抛错即杀请求——观测故障不拖垮请求）
    onPayload.mockImplementation(() => {
      throw new Error('观测回调故障（预期）');
    });
    expect(options.onPayload!(payload, piModel)).toBeUndefined();

    // onResponse / onProviderStreamEvent 同形（void 返回——只验直通+隔离）
    const response = { status: 200, headers: {} };
    options.onResponse!(response, piModel);
    expect(onResponse).toHaveBeenCalledWith(response, piModel);
    onResponse.mockImplementation(() => {
      throw new Error('观测回调故障（预期）');
    });
    expect(() => options.onResponse!(response, piModel)).not.toThrow();

    const event = { type: 'message_start' };
    options.onProviderStreamEvent!(event, piModel);
    expect(onProviderStreamEvent).toHaveBeenCalledWith(event, piModel);
    onProviderStreamEvent.mockImplementation(() => {
      throw new Error('观测回调故障（预期）');
    });
    expect(() => options.onProviderStreamEvent!(event, piModel)).not.toThrow();
  });

  it('缺席锁：无回调 defaults → 包装函数零键扩+请求面无三键（观测面不接不虚构）', async () => {
    // 纯函数面：observationCallbacks 对无回调 defaults 返回空对象；
    // 只挂一键 → 仅一键（零键扩的精确形）
    expect(observationCallbacks({})).toEqual({});
    expect(Object.keys(observationCallbacks({ maxRetries: 0 }))).toEqual([]);
    expect(Object.keys(observationCallbacks({ onPayload: vi.fn() }))).toEqual(['onPayload']);

    // 组装面同形：defaults 无回调 → pi-ai 请求面不出现三键
    const { faux, runtime } = makeFauxRuntime();
    const captures: Captures = [];
    faux.setResponses([capturingFactory(captures)]);
    const streamFn = createStreamFn(runtime, { maxRetries: 0 });
    await (await streamFn(simpleContext([userMsg('缺席形')]), { model: 'faux-obs/m1' })).result();
    const options = captures[0]!.options as Record<string, unknown>;
    expect(options).not.toHaveProperty('onPayload');
    expect(options).not.toHaveProperty('onResponse');
    expect(options).not.toHaveProperty('onProviderStreamEvent');
  });

  it('faux 真派发 onResponse：{status:200,headers:{}} 经包装到达裸回调（faux 缺席律对侧锁）', async () => {
    const onPayload = vi.fn();
    const onResponse = vi.fn();
    const onProviderStreamEvent = vi.fn();
    const { faux, runtime } = makeFauxRuntime();
    faux.setResponses([fauxAssistantMessage('ok')]);
    const streamFn = createStreamFn(runtime, { onPayload, onResponse, onProviderStreamEvent });
    await drainStream(await streamFn(simpleContext([userMsg('真派发')]), { model: 'faux-obs/m1' }));
    // faux 腿唯一在挂钩子：onResponse 合成 {200,{}}（faux.js onResponse 三挂点）
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onResponse.mock.calls[0]![0]).toMatchObject({ status: 200, headers: {} });
    expect(onResponse.mock.calls[0]![1]).toMatchObject({ provider: 'faux-obs', id: 'm1' });
    // faux 缺席律：onPayload/onProviderStreamEvent faux 腿不挂——缺席不误派发
    //（两键真派发锁归 L2 真适配器，此断言防「缺席腿伪造派发」的假绿）
    expect(onPayload).not.toHaveBeenCalled();
    expect(onProviderStreamEvent).not.toHaveBeenCalled();
  });
});

describe('L1 组装与包装锁（complete 路组装位——两出口同源）', () => {
  it('createLlmService defaults 三回调同经包装进入 pi-ai 请求面（单挂流路即观测盲区）', async () => {
    const onPayload = vi.fn();
    const onResponse = vi.fn();
    const onProviderStreamEvent = vi.fn();
    const { faux, runtime } = makeFauxRuntime('faux-obs-c');
    const captures: Captures = [];
    faux.setResponses([capturingFactory(captures)]);
    const service = createLlmService({
      runtime,
      defaultModel: () => 'faux-obs-c/m1',
      retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
      defaults: { onPayload, onResponse, onProviderStreamEvent },
    });
    const result = await service.complete({ messages: [userMsg('观测组装')] });
    expect(result.message.stopReason).toBe('stop');
    const options = captures[0]!.options!;
    // 与 stream 路同一 observationCallbacks 单源（两出口同形——勿单出口漏接）
    expect(options.onPayload).toBeDefined();
    expect(options.onResponse).toBeDefined();
    expect(options.onProviderStreamEvent).toBeDefined();
    expect(options.onPayload).not.toBe(onPayload);
    expect(options.onResponse).not.toBe(onResponse);
    expect(options.onProviderStreamEvent).not.toBe(onProviderStreamEvent);
  });
});

/* ---------------- L2：真适配器锁（custom 渠道 anthropic-messages 腿） ---------------- */

/** L2 渠道 id（finally 注销用——单文件内串行复用同 id） */
const L2_PROVIDER_ID = 'obs-anthropic';

/** 建一个 custom 渠道真适配器运行时（anthropic-messages 协议——@anthropic-ai/sdk 真客户端） */
function makeObsRuntime() {
  const provider = createCustomChannelProvider(
    L2_PROVIDER_ID,
    { protocol: 'anthropic-messages', baseUrl: 'https://observe.test/v1', models: ['model-a'] },
    () => 'sk-test',
  );
  return createLlmRuntime({ providers: [provider] });
}

describe('L2 真适配器锁（fetch 注入 mock——faux 形恒假绿的条款钦定形）', () => {
  it('L2a 网络错形：onPayload 已派发（请求发出前）+onResponse 零调用（SDK 腿失败不可见）+错误终值收场', async () => {
    const onPayload = vi.fn();
    const onResponse = vi.fn();
    const onProviderStreamEvent = vi.fn();
    // maxRetries:0 双保险：SDK 侧（anthropic-messages 腿 requestOptions）+pi-ai
    // retryProviderRequest 侧均零重试——连接错一次即失败，无退避时序
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused（观测 L2a 预期）'));
    try {
      const runtime = makeObsRuntime();
      const streamFn = createStreamFn(runtime, { maxRetries: 0, onPayload, onResponse, onProviderStreamEvent });
      const stream = await streamFn(simpleContext([userMsg('网络错形')]), {
        model: `${L2_PROVIDER_ID}/model-a`,
      });
      const final = await stream.result();
      // 错误是数据非异常：网络失败编码为错误终值（永不抛契约）
      expect(final.stopReason).toBe('error');
      expect(final.errorMessage).toBeTruthy();
      // onPayload 已派发：挂点在请求发出前（适配器 buildParams 之后、SDK create 之前）
      expect(onPayload).toHaveBeenCalledTimes(1);
      expect(onPayload.mock.calls[0]![0]).toMatchObject({ model: 'model-a' });
      expect(onPayload.mock.calls[0]![1]).toMatchObject({ provider: L2_PROVIDER_ID, id: 'model-a' });
      // onResponse 零调用：SDK 腿失败不可见——onResponse 挂在 retryProviderRequest
      // 之后，网络拒绝使该行永不到达（04 §3 腿级失败面真源）
      expect(onResponse).not.toHaveBeenCalled();
      expect(onProviderStreamEvent).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      unregisterCustomProviderDef(L2_PROVIDER_ID);
    }
  });

  it('L2b 成功面：200 SSE 六帧 → onResponse {status:200}+onProviderStreamEvent 六型全派发+stop 终值', async () => {
    const onPayload = vi.fn();
    const onResponse = vi.fn();
    const onProviderStreamEvent = vi.fn();
    // anthropic 真形 SSE 六帧（message_start → content_block 三段 → message_delta
    // → message_stop——足够拼出 stop 终值的最小完备流）
    const sse = (
      [
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: { id: 'msg_obs_1', model: 'model-a', usage: { input_tokens: 3, output_tokens: 0 } },
          },
        },
        {
          event: 'content_block_start',
          data: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '观测面 ok' } },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 2 },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ] as Array<{ event: string; data: unknown }>
    )
      .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
      .join('');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    try {
      const runtime = makeObsRuntime();
      const streamFn = createStreamFn(runtime, { maxRetries: 0, onPayload, onResponse, onProviderStreamEvent });
      const stream = await streamFn(simpleContext([userMsg('成功面')]), {
        model: `${L2_PROVIDER_ID}/model-a`,
      });
      await drainStream(stream);
      const final = await stream.result();
      // 真 SSE 全流收场：end_turn 映射 stop 终值+文本块聚合
      expect(final.stopReason).toBe('stop');
      expect(final.content[0]).toMatchObject({ type: 'text', text: '观测面 ok' });
      // onResponse 恰一次：响应头到达即派发（{status,headers} 元数据级形）
      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onResponse.mock.calls[0]![0]).toMatchObject({ status: 200 });
      expect(onResponse.mock.calls[0]![1]).toMatchObject({ provider: L2_PROVIDER_ID, id: 'model-a' });
      // onProviderStreamEvent 逐帧派发：六型按序全到（pi 归一化前的 provider 原始事件）
      expect(onProviderStreamEvent.mock.calls.map((call) => (call[0] as { type: string }).type)).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
      ]);
      expect(onPayload).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      unregisterCustomProviderDef(L2_PROVIDER_ID);
    }
  });
});
