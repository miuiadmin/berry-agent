/**
 * llm — token 401/quota 429 真协议腿恢复分类测试（W4 异常矩阵三缺口之三）。
 *
 * 现状背景：recovery.test.ts 对 classifyError/diagnoseProviderFailure 的判定序
 * 全用合成 errorMessage（纯函数表测试——合成形是一形）；但「真 401/真 quota
 * 经真 HTTP 状态码到达后，错误文案到底长什么样、恢复分类是否仍归对桶」
 * 此前零实证（评估实测：token 失效真腿全为零）。
 *
 * 本文件补真协议腿：本地 node:http 起真应答服务器（回环真网络栈 = 真传输
 * 非 mock——mock 只停模型层纪律不破，这里不 mock 模型也不 mock 传输），
 * 经宿主同款注入缝（createProvider + anthropicMessagesApi——GLM 中转 env
 * 先例同族，见 tools/golden-record.ts）造 baseUrl 指向本地的 provider，
 * 走真产品出口（createLlmRuntime + createStreamFn → 真 fetch → 真状态码），
 * 断言：
 *  - 401 invalid_api_key：终值 stopReason=error、errorMessage 含 401 与上游
 *    报文 → classifyError 归 non-retryable（fail-loud 不重试）+
 *    diagnoseProviderFailure 识 auth（产品级指路文案）；
 *  - 429 quota：errorMessage 含 insufficient_quota → classifyError 归 quota
 *    桶（重试治不了的诊断语义）；
 *  - 429 纯限流（无 quota 词）：归 transient 对照腿——证明不重试的断言不是
 *    「重试机制坏了」的假绿；
 *  - retryAssistantCall 对 401/quota 两腿零重试（produce 计数 = 1）；
 *  - SSE 中段断供两形（批 A C2 契约回归锁）：硬 destroy（发一半事件后断
 *    连接）与优雅 EOF（无 message_stop 提前收尾）——断言错误**终值**收场
 *    （非挂死非 throw，错误是数据）+ 归 transient（正则词面 terminated /
 *    stream ended before message_stop 两词真腿实证）；
 *  - 流中段 401（B3 行为锁半——在飞 token 失效形）：流先真走一段（start +
 *    delta 已抵达消费面）后以流内 error 事件收 401 语义尾（HTTP 头已发 200
 *    后网关撤销 token 的真形——pi-ai 对 SSE error 事件 throw → 流内 error
 *    终值）。断言与断供两形**分立**：同是「流走了一段后失败」，断供归
 *    transient（换连接即恢复），401 归 non-retryable + auth 诊断（重试只会
 *    再 401——「401 静默语义响亮」的在飞形行为锁）。
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AssistantMessage, AssistantStreamEvent, LlmContext, UserMessage } from '../contracts/index.js';
import { providerApiFace } from './provider-face.js';
import { classifyError, diagnoseProviderFailure, retryAssistantCall } from './recovery.js';
import { createLlmRuntime } from './runtime.js';
import { createStreamFn } from './stream-fn.js';

// 经宿主 provider 聚合面解构（provider-face 唯一导出——走聚合面 = 与宿主同
// 版本 pi-ai 工厂族，防双实例，03 §3.2 纪律）
const { createProvider, anthropicMessagesApi } = providerApiFace;

/* ---------------- 真应答服务器（回环——真协议腿） ---------------- */

/** 应答场景：路径前缀 → {状态码, Anthropic 形错误 JSON 体} */
const SCENARIOS: Record<string, { status: number; body: string }> = {
  // Anthropic 真形 401：authentication_error + invalid x-api-key 文案
  '/auth-401': {
    status: 401,
    body: JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    }),
  },
  // quota 族 429：OpenAI/网关常用 insufficient_quota 文案（quota 桶判据词）
  '/quota-429': {
    status: 429,
    body: JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'insufficient_quota: You exceeded your current quota' },
    }),
  },
  // 纯限流 429 对照腿：无 quota 词 → transient 桶（auto-retry 值得）
  '/rate-429': {
    status: 429,
    body: JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'rate limit exceeded, retry after 30s' },
    }),
  },
};

let server: Server;
let baseUrl = '';

/** Anthropic SSE 事件行（event: 名 + data: JSON 体 + 空行分隔——pi-ai 解析形） */
function sseEvent(name: string, payload: object): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    // SSE 中段断供场景族（/stream-cut 硬断、/stream-eof 优雅收尾无终事件）——
    // 动态应答不走静态 SCENARIOS 表（需流式分段写 + 定时断）
    const cutMode = req.url?.startsWith('/stream-cut')
      ? 'destroy'
      : req.url?.startsWith('/stream-eof')
        ? 'eof'
        : undefined;
    if (cutMode !== undefined) {
      // Anthropic 真形 SSE 头（pi-ai iterateAnthropicEvents 依 event: 行过滤）
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        sseEvent('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_cut',
            type: 'message',
            role: 'assistant',
            model: 'probe-model',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 3, output_tokens: 1 },
          },
        }),
      );
      res.write(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      );
      res.write(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '断供前半句' },
        }),
      );
      // 前段事件先 flush 抵达客户端（硬断不吞已发段），80ms 后收场
      setTimeout(() => {
        if (cutMode === 'destroy')
          res.destroy(); // 硬断——传输层错误（undici terminated 形）
        else res.end(); // 优雅 EOF——无 message_stop（pi-ai 早断检查形）
      }, 80);
      return;
    }
    // 流中段 401 场景（/stream-mid-401——在飞 token 失效形，B3 行为锁半）：
    // 应答头已是 200（请求建立时 token 尚有效），流真走一段（start + delta
    // 已抵达消费面）后 token 被上游撤销——网关此时只能以**流内 error 事件**
    // 收 401 语义尾（HTTP 状态码位已不可用）。pi-ai iterateAnthropicEvents 对
    // SSE error 事件 throw(sse.data 原文) → catch 路径编为流内 error 终值。
    if (req.url?.startsWith('/stream-mid-401') === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        sseEvent('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_mid401',
            type: 'message',
            role: 'assistant',
            model: 'probe-model',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 3, output_tokens: 1 },
          },
        }),
      );
      res.write(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      );
      res.write(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '撤销前已抵达的正常增量' },
        }),
      );
      // 前段事件先 flush 抵达消费面（在飞形铁证——delta 已真消费），80ms 后
      // token 撤销生效：流内 error 事件收尾（Anthropic 形错误载荷，401 语义
      // 在 message 文案——状态码位已不可用是本场景的形态前提）
      setTimeout(() => {
        res.write(
          sseEvent('error', {
            type: 'error',
            error: { type: 'authentication_error', message: '401 oauth token revoked mid-stream' },
          }),
        );
        res.end();
      }, 80);
      return;
    }
    // 路径前缀选场景（SDK 会拼 /v1/messages 尾——前缀判即够）
    const scenario = Object.entries(SCENARIOS).find(([prefix]) => req.url?.startsWith(prefix))?.[1];
    if (scenario === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { message: `no scenario for ${req.url}` } }));
      return;
    }
    // 真状态码 + JSON 错误体（上游 provider 报文形态）
    res.writeHead(scenario.status, { 'content-type': 'application/json' });
    res.end(scenario.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('回环服务器地址形态异常');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  // 先断活动连接（keep-alive 持连接会挂 close 回调）再关监听
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/* ---------------- 真产品出口（baseUrl 注入缝——GLM 中转 env 先例同族） ---------------- */

/** 造指向本地场景路径的 StreamFn（每腿独立 provider id——模型解析面互不干扰） */
function makeStreamFn(scenarioPrefix: string): (context: LlmContext) => ReturnType<ReturnType<typeof createStreamFn>> {
  const provider = createProvider({
    id: `live-401-test-${scenarioPrefix.replace(/\W+/g, '-')}`,
    name: 'recovery live leg',
    baseUrl: `${baseUrl}${scenarioPrefix}`,
    auth: {
      apiKey: {
        name: 'test key',
        // 本腿不验钥值——服务器恒按场景应答；只走真实钥解析位（applyAuth 全链）
        resolve: async () => ({ auth: { apiKey: 'sk-test-not-the-real-one' }, source: 'test fixture' }),
      },
    },
    models: [
      {
        id: 'probe-model',
        name: 'probe model',
        api: 'anthropic-messages',
        provider: `live-401-test-${scenarioPrefix.replace(/\W+/g, '-')}`,
        baseUrl: `${baseUrl}${scenarioPrefix}`,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 1024,
      },
    ],
    api: anthropicMessagesApi(),
  });
  const runtime = createLlmRuntime({ providers: [provider] });
  const streamFn = createStreamFn(runtime, { timeoutMs: 5_000 });
  return (context: LlmContext) =>
    streamFn(context, { model: `live-401-test-${scenarioPrefix.replace(/\W+/g, '-')}/probe-model` });
}

/** 单次调用上下文（最简形：一条用户消息） */
function simpleContext(): LlmContext {
  const user: UserMessage = { role: 'user', content: 'probe', timestamp: 1 };
  return { systemPrompt: '测试', messages: [user] };
}

/** 跑一次真调用收终值（错误是数据不是异常——终值从流收口取） */
async function runOnce(streamFn: ReturnType<typeof makeStreamFn>): Promise<{
  final: AssistantMessage;
  events: AssistantStreamEvent[];
}> {
  const stream = await streamFn(simpleContext());
  const events: AssistantStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  const final = await stream.result();
  return { final, events };
}

/* ---------------- 断言族 ---------------- */

describe('401 invalid_api_key 真腿（fail-loud 非重试）', () => {
  it('真状态码 401 到达：终值 error、上游报文可见 → non-retryable + auth 产品级诊断', async () => {
    const fn = makeStreamFn('/auth-401');
    const { final, events } = await runOnce(fn);
    // 流内收口：error 终止事件在场（永不抛契约——错误是数据）
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(final.stopReason).toBe('error');
    // 上游真报文穿透到 errorMessage（状态码 + 上游 JSON——SDK APIError 面）
    expect(final.errorMessage).toContain('401');
    expect(final.errorMessage).toContain('invalid x-api-key');
    // 恢复分类：auth 类失败重试只会再失败 → non-retryable（fail-loud）
    expect(classifyError(final)).toBe('non-retryable');
    // 产品级诊断：识 auth + 指路凭证配置（07 §5 provider 文案律）
    const diag = diagnoseProviderFailure(final, 'live-401-test/auth-401/probe-model');
    expect(diag?.kind).toBe('auth');
    expect(diag?.hint).toContain('API');
  }, 20_000);

  it('retryAssistantCall 零重试（produce 恒 1 次——401 重试无意义）', async () => {
    const fn = makeStreamFn('/auth-401');
    let calls = 0;
    const settled = await retryAssistantCall(
      async () => {
        calls++;
        return (await runOnce(fn)).final;
      },
      { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    );
    expect(calls).toBe(1);
    expect(settled.stopReason).toBe('error');
  }, 20_000);
});

describe('429 quota 真腿（quota 桶——重试治不了）', () => {
  it('真 429 + insufficient_quota 报文：归 quota 桶 + 零重试', async () => {
    const fn = makeStreamFn('/quota-429');
    const { final } = await runOnce(fn);
    expect(final.stopReason).toBe('error');
    // 上游报文穿透（状态码 + quota 词在 errorMessage）
    expect(final.errorMessage).toContain('429');
    expect(final.errorMessage).toContain('insufficient_quota');
    // 恢复分类：quota 族细分诊断桶（在 transient 正则之前截获——判序 ③）
    expect(classifyError(final)).toBe('quota');
    // 零重试（quota 重试治不了）
    let calls = 0;
    const settled = await retryAssistantCall(
      async () => {
        calls++;
        return (await runOnce(fn)).final;
      },
      { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    );
    expect(calls).toBe(1);
    expect(settled.stopReason).toBe('error');
  }, 20_000);
});

describe('429 纯限流对照腿（transient——证明零重试断言非假绿）', () => {
  it('真 429 无 quota 词：归 transient + retryAssistantCall 真重试（calls=2）', async () => {
    const fn = makeStreamFn('/rate-429');
    const { final } = await runOnce(fn);
    expect(final.stopReason).toBe('error');
    expect(final.errorMessage).toContain('429');
    expect(classifyError(final)).toBe('transient');
    // 对照锚：同一重试零件对 transient 真发起重试——上两腿的 calls=1 是分类
    // 判据拦的，不是重试机制坏了
    let calls = 0;
    const settled = await retryAssistantCall(
      async () => {
        calls++;
        const { final: f } = await runOnce(fn);
        return f;
      },
      { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    );
    expect(calls).toBe(2);
    expect(settled.stopReason).toBe('error');
  }, 20_000);
});

/* ---------------- SSE 中段断供两形（批 A C2 契约回归锁） ---------------- */

describe('SSE 中段断供真腿（错误终值收场——非挂死非 throw + transient）', () => {
  it('硬 destroy：发一半事件后断连接——流内 error 终值收口 + transient + 真重试', async () => {
    const fn = makeStreamFn('/stream-cut');
    const { final, events } = await runOnce(fn); // 挂死形此处即测试超时红——非挂死本身是断言
    // 传输层中断进 pi-ai catch 路径：流内 error 终止事件在场（错误是数据不是异常）
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(final.stopReason).toBe('error');
    expect(final.errorMessage).toBeTruthy(); // 传输错误词面（undici 形）——只断在场不钉词
    // 网络中断换连接即恢复 → transient 桶（正则 terminated / fetch 族词面）
    expect(classifyError(final)).toBe('transient');
    // transient 即真重试（对照断连不进 non-retryable 假桶）
    let calls = 0;
    const settled = await retryAssistantCall(
      async () => {
        calls++;
        const { final: f } = await runOnce(fn);
        return f;
      },
      { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    );
    expect(calls).toBe(2);
    expect(settled.stopReason).toBe('error');
  }, 20_000);

  it('优雅 EOF：无 message_stop 提前收尾——同 error 终值收口 + transient（正则 #4433 词面真腿实证）', async () => {
    const fn = makeStreamFn('/stream-eof');
    const { final, events } = await runOnce(fn);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(final.stopReason).toBe('error');
    // pi-ai 早断检查：sawMessageStart && !sawMessageEnd → throw → catch → 流内 error
    expect(final.errorMessage).toContain('message_stop');
    // 「Anthropic stream ended before message_stop」在 RETRYABLE 正则显式列名——真腿实证归桶
    expect(classifyError(final)).toBe('transient');
  }, 20_000);
});

/* ---------------- 流中段 401（在飞 token 失效——B3 行为锁半） ---------------- */

describe('流中段 401 真腿（token 途中撤销——与断供 transient 分立）', () => {
  it('delta 已抵达后流内 error 事件收尾：error 终值 + non-retryable + auth 诊断（401 静默语义响亮）', async () => {
    const fn = makeStreamFn('/stream-mid-401');
    const { final, events } = await runOnce(fn); // 挂死形此处即测试超时红——非挂死本身是断言
    // 在飞形铁证：撤销前 delta 已真抵达消费面（流走了一段才失败——与请求
    // 建立即失败的 /auth-401 形分立的前提）
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    // 错误终值收口（永不抛契约——流内 error 终止事件在场，错误是数据不是异常）
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(final.stopReason).toBe('error');
    // 流内 error 事件载荷穿透 errorMessage（pi-ai throw(sse.data) 原文——含
    // 401 语义与 authentication_error 错误型）
    expect(final.errorMessage).toContain('401');
    expect(final.errorMessage).toContain('authentication_error');
    // 分立关键断言：同是「流走了一段后失败」，上节断供两形（destroy/EOF）归
    // transient（换连接即恢复），token 撤销 401 归 non-retryable（重试只会再 401）
    expect(classifyError(final)).toBe('non-retryable');
    // 「401 静默语义响亮」：产品级 auth 诊断在场（识鉴权失败 + 指路凭证配置）
    const diag = diagnoseProviderFailure(final, 'live-401-test-stream-mid-401/probe-model');
    expect(diag?.kind).toBe('auth');
    expect(diag?.hint).toContain('API');
  }, 20_000);

  it('retryAssistantCall 零重试（produce 恒 1 次——401 重试无意义不因中段形改变）', async () => {
    const fn = makeStreamFn('/stream-mid-401');
    let calls = 0;
    const settled = await retryAssistantCall(
      async () => {
        calls++;
        return (await runOnce(fn)).final;
      },
      { enabled: true, maxRetries: 3, baseDelayMs: 1 },
    );
    // 中段形不改变桶判定：non-retryable 不消费重试（对照 /rate-429 腿 calls=2
    // ——零重试是分类拦的不是机制坏的）
    expect(calls).toBe(1);
    expect(settled.stopReason).toBe('error');
  }, 20_000);
});
