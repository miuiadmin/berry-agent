/**
 * web/ssrf-guard 守卫 fetch 包裹件测试（03 §10.9 oauth 案「SSRF 守卫」
 * 挂账收口件——2026-09-09 守卫批）。
 *
 * 覆盖四块：私网拒族（字面腿全矩阵——环回/localhost 族/链路本地〔云元数据
 * 169.254.169.254〕/私网三段/CGNAT + DNS 腿解析命中）、协议白名单与坏 URL
 * 各拒、公网放行透传（init 原样 + redirect 钉 manual + 每调用重查——oauth
 * 轮询形态）、拦截时底层 fetch 零调用（先查后传 fail-closed）。
 *
 * DNS 注入桩 + fetch 底层记录桩——零真网络铁律。
 */
import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { createSsrfGuardedFetch } from './ssrf-guard.js';
import type { DnsResolver, FetchLike } from './types.js';

/** 公网解析桩（非字面主机恒解析到公网地址——字面腿不查 DNS） */
const publicDns: DnsResolver = async (hostname) => {
  if (hostname === 'dns-private.example') return ['10.0.0.7']; // 解析命中私网档
  if (hostname === 'dns-multi.example') return ['93.184.216.34', '192.168.1.9']; // 多地址任一命中
  return ['93.184.216.34'];
};

/** 底层 fetch 记录桩（url/init 逐调用记——透传断言判据源） */
function recordingFetch(): { fetch: FetchLike; calls: { url: string; init: Record<string, unknown> }[] } {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init: { ...(init ?? {}) } });
    return new Response('{"ok":1}', { status: 200 });
  };
  return { fetch, calls };
}

/** 守卫速记（记录桩 + 公网解析桩） */
function guardedOf() {
  const rec = recordingFetch();
  return { guarded: createSsrfGuardedFetch(rec.fetch, publicDns), rec };
}

/** 断言拒形：BaseError 携 WEB_ 族码且底层零调用 */
async function expectRejected(promise: Promise<unknown>, code: string, rec: { calls: unknown[] }): Promise<string> {
  await expect(promise).rejects.toMatchObject({ code });
  expect(rec.calls).toHaveLength(0); // 先查后传——拦截即零外联
  const err = (await promise.catch((e) => e)) as BaseError;
  return err.message;
}

describe('私网拒族（WEB_PRIVATE_ADDRESS——字面腿）', () => {
  it.each([
    ['环回', 'http://127.0.0.1/token'],
    ['环回段任意', 'http://127.8.9.1/token'],
    ['localhost 裸形', 'http://localhost:8080/token'],
    ['localhost 族子域', 'https://api.localhost/token'],
    ['链路本地（云元数据面）', 'http://169.254.169.254/latest/meta-data'],
    ['私网 A', 'http://10.1.2.3/token'],
    ['私网 B', 'http://172.16.0.1/token'],
    ['私网 B 上界', 'http://172.31.255.255/token'],
    ['私网 C', 'http://192.168.1.1/token'],
    ['CGNAT', 'http://100.64.0.1/token'],
    ['未指定地址', 'http://0.0.0.0/token'],
    ['v6 环回裸形', 'http://[::1]/token'],
    ['v6 唯一本地', 'http://[fd12::1]/token'],
    ['v6 v4 映射私网', 'http://[::ffff:10.0.0.1]/token'],
  ])('%s → 拒 + 底层零调用', async (_label, url) => {
    const { guarded, rec } = guardedOf();
    await expectRejected(guarded(url, { method: 'POST' }), 'WEB_PRIVATE_ADDRESS', rec);
  });

  it('172.32 段非私网 B（上界外——放行对照）', async () => {
    const { guarded, rec } = guardedOf();
    await guarded('http://172.32.0.1/token');
    expect(rec.calls).toHaveLength(1); // 放行对照——段边界精确性
  });
});

describe('DNS 腿（非字面主机解析结果查）', () => {
  it('解析命中私网段 → 拒（WEB_PRIVATE_ADDRESS + 消息含解析链）', async () => {
    const { guarded, rec } = guardedOf();
    const message = await expectRejected(guarded('https://dns-private.example/v1/token'), 'WEB_PRIVATE_ADDRESS', rec);
    expect(message).toContain('dns-private.example');
    expect(message).toContain('10.0.0.7');
  });

  it('多地址任一命中即拒（公网 + 私网混合解析）', async () => {
    const { guarded, rec } = guardedOf();
    await expectRejected(guarded('https://dns-multi.example/v1/token'), 'WEB_PRIVATE_ADDRESS', rec);
  });

  it('全公网解析放行（底层透传）', async () => {
    const { guarded, rec } = guardedOf();
    await guarded('https://github.com/login/device/code');
    expect(rec.calls).toHaveLength(1);
  });
});

describe('协议白名单与 URL 坏形', () => {
  it.each([
    ['file 协议', 'file:///etc/passwd'],
    ['ftp 协议', 'ftp://example.com/pub'],
    ['javascript 协议', 'javascript:alert(1)'],
  ])('%s → WEB_PROTOCOL_REJECTED', async (_label, url) => {
    const { guarded, rec } = guardedOf();
    await expectRejected(guarded(url), 'WEB_PROTOCOL_REJECTED', rec);
  });

  it('不可解析 URL → WEB_URL_INVALID', async () => {
    const { guarded, rec } = guardedOf();
    await expectRejected(guarded('not a url at all'), 'WEB_URL_INVALID', rec);
  });
});

describe('公网放行透传（oauth 调用形）', () => {
  it('init 原样 + redirect 钉 manual；应答 Response 三面（ok/status/text）直返', async () => {
    const { guarded, rec } = guardedOf();
    const res = await guarded('https://issuer.example/v1/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'client_id=abc&scope=read',
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('{"ok":1}');
    // 透传断言：url/method/headers/body 原样 + redirect manual 钉入
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.url).toBe('https://issuer.example/v1/device/code');
    expect(rec.calls[0]!.init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'client_id=abc&scope=read',
      redirect: 'manual',
    });
  });

  it('init 缺席调用形：只钉 redirect 不发明字段', async () => {
    const { guarded, rec } = guardedOf();
    await guarded('https://issuer.example/v1/token');
    expect(rec.calls[0]!.init).toEqual({ redirect: 'manual' });
  });

  it('多次调用每次重查（oauth 轮询形态——DNS 每次解析不缓存）', async () => {
    let resolveTo: string[] = ['93.184.216.34'];
    const dynamicDns: DnsResolver = async () => resolveTo;
    const rec = recordingFetch();
    const dynamic = createSsrfGuardedFetch(rec.fetch, dynamicDns);
    await dynamic('https://poll.example/v1/token'); // 首查公网放行
    resolveTo = ['10.0.0.9']; // 解析漂移——第二轮命中私网
    await expect(dynamic('https://poll.example/v1/token')).rejects.toMatchObject({ code: 'WEB_PRIVATE_ADDRESS' });
    expect(rec.calls).toHaveLength(1); // 仅首查放行抵达底层；漂移轮零外联
  });

  it('守卫错 = BaseError 直传（码不被吞——消费面按码分流的前提）', async () => {
    const { guarded } = guardedOf();
    const err = await guarded('http://192.168.0.1/token', { method: 'POST' }).catch((e) => e);
    expect(err).toBeInstanceOf(BaseError);
    expect(err.code).toBe('WEB_PRIVATE_ADDRESS');
  });
});
