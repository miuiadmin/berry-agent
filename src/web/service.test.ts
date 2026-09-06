/**
 * WebFetchService 测试——五卫生件编排序全腿（mock 停在注入位：fetchImpl/
 * resolveDns/now/sink 皆桩，网络面零真实外联）。
 *
 * 覆盖：在飞门拒/URL 与协议拒/私网双查/重定向逐跳复检与跳数帽/字节帽截断
 * （含多字节劈尾回退）/归因落账三结局（ok/blocked/error）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createWebFetchService } from './service.js';
import type { FetchLike, WebAttributionRecord, WebFetchInit, WebFetchResponse } from './types.js';

/** 全公网解析桩（记录被查主机名——跨跳复检断言用） */
function publicResolver(log?: string[]) {
  return async (hostname: string): Promise<string[]> => {
    log?.push(hostname);
    return ['93.184.216.34'];
  };
}

/** 受控分块流 Response（字节帽测试需要确定 chunk 边界） */
function streamResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, init);
}

/** 记录型 fetch 桩工厂：按 URL 序列回放应答，捕获全部调用入参 */
function scriptedFetch(
  responses: Array<Response | Error>,
  calls?: Array<{ url: string; init?: WebFetchInit }>,
): FetchLike {
  let index = 0;
  return async (url, init) => {
    calls?.push({ url, ...(init ? { init: init as WebFetchInit } : {}) });
    const next = responses[index];
    index += 1;
    if (next === undefined) throw new Error(`fetch 桩脚本耗尽（第 ${index} 次调用无应答）`);
    if (next instanceof Error) throw next;
    return next;
  };
}

const baseInit = { resolveDns: publicResolver(), now: () => 1_000 } as const;

describe('卫生件 2/3：URL 解析 + 协议白名单 + 私网双查', () => {
  it('公网 GET 直达（ok 结局归因）', async () => {
    const records: WebAttributionRecord[] = [];
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => new Response('hello', { headers: { 'content-type': 'text/plain' } }),
      sink: (record) => records.push(record),
    });
    const result = await service.fetch('https://example.com/a');
    expect(result.status).toBe(200);
    expect(result.body).toBe('hello');
    expect(result.finalUrl).toBe('https://example.com/a');
    expect(result.truncated).toBe(false);
    expect(result.bytes).toBe(5);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      consumer: 'service',
      method: 'GET',
      url: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      status: 200,
      bytes: 5,
      redirects: 0,
      outcome: 'ok',
      at: 1_000,
    });
  });

  it('协议白名单外拒（blocked 落账带码）', async () => {
    const records: WebAttributionRecord[] = [];
    const service = createWebFetchService({ ...baseInit, sink: (r) => records.push(r) });
    const error = await service.fetch('file:///etc/passwd').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BaseError);
    expect((error as BaseError).code).toBe('WEB_PROTOCOL_REJECTED');
    expect(records).toEqual([
      expect.objectContaining({ outcome: 'blocked', errorCode: 'WEB_PROTOCOL_REJECTED', bytes: 0 }),
    ]);
  });

  it('DNS 解析命中私网拒（rebinding 首跳防御腿）', async () => {
    const service = createWebFetchService({
      ...baseInit,
      resolveDns: async () => ['93.184.216.34', '169.254.169.254'],
    });
    const error = await service.fetch('https://metadata.mitm.attacker/').catch((e: unknown) => e);
    expect((error as BaseError).code).toBe('WEB_PRIVATE_ADDRESS');
  });
});

describe('卫生件 4：重定向逐跳跟随', () => {
  it('跟随 302 相对 Location——跨主机跳逐跳复检', async () => {
    const dnsLog: string[] = [];
    const service = createWebFetchService({
      ...baseInit,
      resolveDns: publicResolver(dnsLog),
      fetchImpl: scriptedFetch([
        new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/final' } }),
        new Response('landed'),
      ]),
    });
    const result = await service.fetch('https://example.com/start');
    expect(result.finalUrl).toBe('https://cdn.example.org/final');
    expect(result.redirects).toBe(1);
    expect(result.body).toBe('landed');
    // 每跳主机名都过 DNS 腿（入口 + 跳目标各一）
    expect(dnsLog).toEqual(['example.com', 'cdn.example.org']);
  });

  it('相对路径 Location 以当前 URL 为基解析', async () => {
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: scriptedFetch([
        new Response(null, { status: 301, headers: { location: '/final?x=1' } }),
        new Response('ok'),
      ]),
    });
    const result = await service.fetch('https://example.com/deep/path');
    expect(result.finalUrl).toBe('https://example.com/final?x=1');
  });

  it('跳目标私网拒（重定向是 SSRF 主载体）', async () => {
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: scriptedFetch([
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } }),
      ]),
    });
    const error = await service.fetch('https://example.com/').catch((e: unknown) => e);
    expect((error as BaseError).code).toBe('WEB_PRIVATE_ADDRESS');
  });

  it('跳数触帽拒（WEB_REDIRECT_LIMIT）', async () => {
    const redirect = () => new Response(null, { status: 302, headers: { location: 'https://example.com/next' } });
    const service = createWebFetchService({
      ...baseInit,
      limits: { maxRedirects: 2 },
      // 三次 302：跟 2 跳后第 3 个 Location 出现即触帽
      fetchImpl: scriptedFetch([redirect(), redirect(), redirect(), new Response('never')]),
    });
    const error = await service.fetch('https://example.com/').catch((e: unknown) => e);
    expect((error as BaseError).code).toBe('WEB_REDIRECT_LIMIT');
  });

  it('303 恒转 GET 弃体；307 保方法保体', async () => {
    const calls: Array<{ url: string; init?: WebFetchInit }> = [];
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: scriptedFetch(
        [new Response(null, { status: 303, headers: { location: 'https://example.com/after' } }), new Response('ok')],
        calls,
      ),
    });
    await service.fetch('https://example.com/form', { method: 'POST', body: 'a=1' });
    // 第二跳：GET + 无体
    expect(calls[1]?.init?.method).toBe('GET');
    expect(calls[1]?.init?.body).toBeUndefined();

    const calls307: Array<{ url: string; init?: WebFetchInit }> = [];
    const service307 = createWebFetchService({
      ...baseInit,
      fetchImpl: scriptedFetch(
        [new Response(null, { status: 307, headers: { location: 'https://example.com/after' } }), new Response('ok')],
        calls307,
      ),
    });
    await service307.fetch('https://example.com/form', { method: 'POST', body: 'a=1' });
    expect(calls307[1]?.init?.method).toBe('POST');
    expect(calls307[1]?.init?.body).toBe('a=1');
  });

  it('3xx 无 Location 按终态返回（宽容不发明跳转）', async () => {
    // 304 等空体状态码 undici Response 构造拒带体——用 302 无 Location 表同一分支
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => new Response('not moved', { status: 302 }),
    });
    const result = await service.fetch('https://example.com/');
    expect(result.status).toBe(302);
    expect(result.body).toBe('not moved');
    expect(result.redirects).toBe(0);
  });
});

describe('卫生件 5：字节上限（截断非拒）', () => {
  it('触帽截断——恰收帽值、truncated 置真、归因 bytes=帽', async () => {
    const records: WebAttributionRecord[] = [];
    const encoder = new TextEncoder();
    const service = createWebFetchService({
      ...baseInit,
      limits: { maxBytes: 10 },
      fetchImpl: async () => streamResponse([encoder.encode('0123456789'), encoder.encode('ABCDEF')]),
      sink: (r) => records.push(r),
    });
    const result = await service.fetch('https://example.com/big');
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(10);
    expect(result.body).toBe('0123456789');
    expect(records[0]).toMatchObject({ outcome: 'ok', bytes: 10, status: 200 });
  });

  it('多字节字符劈在帽界——剥尾 ≤3 字节回退解码不误报', async () => {
    const encoder = new TextEncoder();
    // '中' = E4 B8 AD 三字节；帽 11 = 10 个 ASCII + '中' 首字节（劈尾形）
    const service = createWebFetchService({
      ...baseInit,
      limits: { maxBytes: 11 },
      fetchImpl: async () => streamResponse([encoder.encode('0123456789中'), encoder.encode('tail')]),
    });
    const result = await service.fetch('https://example.com/cjk');
    expect(result.bytes).toBe(11);
    expect(result.body).toBe('0123456789'); // 劈掉的半字回退剥除
    expect(result.truncated).toBe(true);
  });

  it('非 UTF-8 体拒（普通失败——error 结局无码）', async () => {
    const records: WebAttributionRecord[] = [];
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => streamResponse([new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03])]),
      sink: (r) => records.push(r),
    });
    const error = await service.fetch('https://example.com/bin').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BaseError);
    expect(records[0]).toMatchObject({ outcome: 'error', bytes: 6 });
  });

  it('空体形（HEAD 语义）零字节非截断', async () => {
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    const result = await service.fetch('https://example.com/head', { method: 'HEAD' });
    expect(result.body).toBe('');
    expect(result.bytes).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe('卫生件 1：在飞门', () => {
  it('门满拒（WEB_RATE_LIMITED）+ blocked 落账；先占未完不泄漏语义', async () => {
    const records: WebAttributionRecord[] = [];
    const service = createWebFetchService({
      ...baseInit,
      limits: { maxConcurrent: 1 }, // 缺省容量 4——单槽才可一占即满
      sink: (r) => records.push(r),
      fetchImpl: (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          // 首调用永悬（占门不还）；次调用本可答但门已满
          if (calls === 1) return new Promise<Response>(() => {});
          return new Response('second');
        };
      })(),
    });
    const first = service.fetch('https://example.com/hold'); // 同步占门（gate.run 内 acquire 先于一切 await）
    const error = await service.fetch('https://example.com/blocked').catch((e: unknown) => e);
    expect((error as BaseError).code).toBe('WEB_RATE_LIMITED');
    expect(records).toEqual([
      expect.objectContaining({
        outcome: 'blocked',
        errorCode: 'WEB_RATE_LIMITED',
        url: 'https://example.com/blocked',
        bytes: 0,
      }),
    ]);
    // 悬置 promise 不 settle 也无碍——每测试独立 service 实例，无跨例泄漏
    void first;
  });
});

describe('归因落账兜底面', () => {
  it('网络失败（fetch 抛 TypeError）→ error 结局无码', async () => {
    const records: WebAttributionRecord[] = [];
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: scriptedFetch([new TypeError('fetch failed')]),
      sink: (r) => records.push(r),
    });
    const error = await service.fetch('https://example.com/down').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(records).toEqual([expect.objectContaining({ outcome: 'error', url: 'https://example.com/down' })]);
    expect(records[0]?.errorCode).toBeUndefined();
  });

  it('sink 自身异常不绑架数据面（静默吞——观测面不绑架数据面）', async () => {
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => new Response('fine'),
      sink: () => {
        throw new Error('sink broken');
      },
    });
    const result = await service.fetch('https://example.com/');
    expect(result.body).toBe('fine');
  });

  it('consumer 标注透传（navigate——browser 第三消费位同一路径）', async () => {
    const records: WebAttributionRecord[] = [];
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => new Response('page'),
      sink: (r) => records.push(r),
    });
    await service.fetch('https://example.com/', { consumer: 'navigate' });
    expect(records[0]?.consumer).toBe('navigate');
  });
});

describe('注入面缺省腿', () => {
  it('缺省 service 形——fetchImpl/now 走缺省位不炸构造（DNS 桩断在卫生件——零外联）', async () => {
    // DNS 桩返回私网段：缺省 fetchImpl（全局 fetch）永不触达——断在私网
    // 判定（更早段）。夹具教训：返回公网段时缺省腿会打真实网络，禁之。
    const service = createWebFetchService({ resolveDns: async () => ['10.0.0.5'] });
    const error = await service.fetch('https://example.com/').catch((e: unknown) => e);
    expect((error as BaseError).code).toBe('WEB_PRIVATE_ADDRESS');
  });

  it('应答形全字段契约（WebFetchResponse 恒等快照）', async () => {
    const service = createWebFetchService({
      ...baseInit,
      fetchImpl: async () => new Response('body', { headers: { 'content-type': 'application/json; charset=utf-8' } }),
    });
    const result: WebFetchResponse = await service.fetch('https://example.com/x');
    expect(Object.keys(result).sort()).toEqual(
      ['body', 'bytes', 'contentType', 'finalUrl', 'redirects', 'status', 'truncated', 'url'].sort(),
    );
  });
});
