/**
 * host — 模型清单拉取腿测试（2026-09-28 模型渠道批 C-2；07 §8.4 拉取腿）。
 *
 * 锁面：协议分叉拼接（URL/头两维——评审 #6 的 /v1/v1 回归锁）/ 三态回执
 * （ok 去重保序、非 2xx、3xx 重定向提示——评审 #8）/ 坏形折叠 / SSRF 私网
 * 拒（守卫必经——桩底层 fetch 不被触达）/ 超时帽（注入 timeoutMs）。
 * 零网络（桩 fetch + 守卫真跑 DNS 位用字面私网段——assertPublicHost 字面
 * 拒先于 DNS 解析）。
 */
import { describe, expect, it, vi } from 'vitest';

import { channelModelsEndpoint, fetchChannelModels } from './channel-models-fetch.js';
import type { DnsResolver, FetchLike } from '../web/index.js';

/** 公网 DNS 桩（守卫测试同形——假域走通字面+DNS 两查；SSRF 拒锁用例字面拒先于 DNS，注入无害） */
const publicDns: DnsResolver = async () => ['93.184.216.34'];

/** 桩 fetch 捕获形（URL/init 断言位 + 可编程应答） */
function stubFetch(
  respond: (url: string) => { status: number; body?: string; headers?: Record<string, string> } = () => ({
    status: 200,
    body: JSON.stringify({ data: [{ id: 'm1' }] }),
  }),
): { fetchImpl: FetchLike; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = respond(String(url));
    return new Response(r.body ?? '', { status: r.status, headers: r.headers });
  };
  return { fetchImpl, calls };
}

describe('channelModelsEndpoint（协议分叉拼接——评审 #6 回归锁）', () => {
  it('openai 形：baseUrl 已含 /v1 只拼 /models（不重拼 /v1/v1/models）', () => {
    expect(channelModelsEndpoint('https://gw.test/v1', 'openai-completions')).toBe('https://gw.test/v1/models');
    expect(channelModelsEndpoint('https://gw.test/v1/', 'openai-completions')).toBe('https://gw.test/v1/models'); // 尾斜杠容错
  });
  it('anthropic 形：根地址拼 /v1/models', () => {
    expect(channelModelsEndpoint('https://gw.test', 'anthropic-messages')).toBe('https://gw.test/v1/models');
  });
});

describe('fetchChannelModels（三态回执 + 协议头分叉）', () => {
  it('openai 腿：Bearer 头 + /models 端点 + ok 清单去重保序', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm1' }, { id: '' }, { noId: true }] }),
    }));
    const result = await fetchChannelModels(
      { baseUrl: 'https://gw.test/v1', protocol: 'openai-completions', apiKey: 'sk-k' },
      { fetchImpl, resolveDns: publicDns },
    );
    expect(result).toEqual({ kind: 'ok', models: ['m1', 'm2'] }); // 去重 + 空串/坏条目跳过
    expect(calls[0]?.url).toBe('https://gw.test/v1/models');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-k');
  });

  it('anthropic 腿：x-api-key + anthropic-version 头 + /v1/models 端点', async () => {
    const { fetchImpl, calls } = stubFetch();
    await fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'sk-ant' },
      { fetchImpl, resolveDns: publicDns },
    );
    expect(calls[0]?.url).toBe('https://gw.test/v1/models');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('非 2xx 折 failed（含状态码提示）；非 JSON / data 缺席同折', async () => {
    const { fetchImpl: f1 } = stubFetch(() => ({ status: 401, body: 'nope' }));
    expect(
      await fetchChannelModels(
        { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
        { fetchImpl: f1, resolveDns: publicDns },
      ),
    ).toMatchObject({ kind: 'failed', message: expect.stringContaining('401') });
    const { fetchImpl: f2 } = stubFetch(() => ({ status: 200, body: 'not-json' }));
    expect(
      await fetchChannelModels(
        { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
        { fetchImpl: f2, resolveDns: publicDns },
      ),
    ).toMatchObject({ kind: 'failed', message: expect.stringContaining('非 JSON') });
    const { fetchImpl: f3 } = stubFetch(() => ({ status: 200, body: JSON.stringify({ object: 'list' }) }));
    expect(
      await fetchChannelModels(
        { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
        { fetchImpl: f3, resolveDns: publicDns },
      ),
    ).toMatchObject({ kind: 'failed', message: expect.stringContaining('data 键缺席') });
  });

  it('3xx 重定向折 failed + 不跟随提示（评审 #8——redirect:manual 钉死由守卫透传层）', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 302, headers: { location: 'https://other.test/login' } }));
    const result = await fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns },
    );
    expect(result).toMatchObject({ kind: 'failed', message: expect.stringContaining('不跟随重定向') });
  });

  it('体帽双闸：content-length 越帽先拒（不下载）', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 200, headers: { 'content-length': String(300 * 1024) } }));
    const result = await fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns },
    );
    expect(result).toMatchObject({ kind: 'failed', message: expect.stringContaining('清单文档过大') });
  });

  it('超时帽：应答慢于注入 timeoutMs 即折 failed（8s 缺省帽的注入位证明）', async () => {
    const fetchImpl: FetchLike = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return new Response('{}', { status: 200 });
    };
    const result = await fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns, timeoutMs: 30 },
    );
    expect(result.kind).toBe('failed');
  });

  it('SSRF 必经：字面私网 baseUrl 守卫拒（WEB_ 折 failed），底层桩不被触达', async () => {
    const spy = vi.fn();
    const fetchImpl: FetchLike = spy as unknown as FetchLike;
    const result = await fetchChannelModels(
      { baseUrl: 'http://127.0.0.1:8080', protocol: 'openai-completions', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns },
    );
    expect(result.kind).toBe('failed');
    expect(spy).not.toHaveBeenCalled(); // 守卫先拒——透传层零触达
  });
});

describe('R-2 加固批（体帽流式前置 + 外层 race 覆盖 DNS 腿 + 守卫拒人话化）', () => {
  /** 越帽流桩：首 chunk 已越帽 + 后续 chunk 挂起（修前 text() 全量读挂在流尾——被 signal 超时打断折超时形非越帽形） */
  function oversizedStream(firstChunkBytes: number): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(firstChunkBytes)); // 首块即越帽
        // 后续 chunk 永不 enqueue（挂起——只有 cancel 能终止）
      },
    });
  }

  it('体帽流式前置：无 content-length 声明 + 首 chunk 超限即拒（不等流尾）——修前红：text() 挂到 signal 超时折超时形（message 不含过大提示）', async () => {
    const fetchImpl: FetchLike = async () => new Response(oversizedStream(300 * 1024), { status: 200 }); // 无 content-length 头
    const result = await fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns, timeoutMs: 3_000 }, // 帽远大于正常返回——修前挂满 3s 折超时形
    );
    expect(result).toMatchObject({ kind: 'failed', message: expect.stringContaining('清单文档过大') });
  });

  it('外层 race 覆盖 DNS 腿：DNS 解析挂死也在帽内折 failed（AbortSignal 只管 fetch 管线不管守卫 DNS 腿）——修前红：await assertPublicHost 挂死测试侧兜赢', async () => {
    const hungDns: DnsResolver = () => new Promise(() => {}); // 永不 resolve
    const spy = vi.fn();
    const fetchImpl: FetchLike = spy as unknown as FetchLike;
    const underTest = fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
      { fetchImpl, resolveDns: hungDns, timeoutMs: 80 },
    );
    // 测试侧兜（修前红可终止形——挂死由兜收为「挂死」字样 reject）
    const guard = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('挂死：DNS 腿未被帽覆盖')), 1_000),
    );
    const result = await Promise.race([underTest, guard]);
    expect(result.kind).toBe('failed');
    expect(spy).not.toHaveBeenCalled(); // DNS 未过——透传层零触达
  });

  it('私网拒人话化：守卫拒含内网语境 + 手填指路——修前红：透传 WEB_ 原文无行动指引', async () => {
    const spy = vi.fn();
    const fetchImpl: FetchLike = spy as unknown as FetchLike;
    const result = await fetchChannelModels(
      { baseUrl: 'http://10.0.0.5:8080', protocol: 'openai-completions', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns },
    );
    expect(result.kind).toBe('failed');
    const message = result.kind === 'failed' ? result.message : '';
    expect(message).toContain('私网'); // 守卫原文保留
    expect(message).toContain('手填'); // 行动指引（内网网关仍可手填模型清单）
  });

  it('超时人话化：超时折「N 秒未应答」中文指引——修前红：TimeoutError 洋文技术句直透', async () => {
    const fetchImpl: FetchLike = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return new Response('{}', { status: 200 });
    };
    const result = await fetchChannelModels(
      { baseUrl: 'https://gw.test', protocol: 'anthropic-messages', apiKey: 'k' },
      { fetchImpl, resolveDns: publicDns, timeoutMs: 30 },
    );
    expect(result).toMatchObject({ kind: 'failed', message: expect.stringContaining('未应答') });
  });
});
