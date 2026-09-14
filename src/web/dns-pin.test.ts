/**
 * web/dns-pin 连接级钉死件测试（03 §10.3 安全卫生条 2026-09-14 定形注——
 * DNS rebinding TOCTOU 闭合批 rb-3）。
 *
 * 覆盖：首钉保留（重复入钉不覆盖——裁决 1「一经校验钉值恒定」）/hostname
 * 小写归一/在钉用钉（net.connect 兼容单形 + all 形两应答形）/无钉即错
 * fail-closed 不回落真 DNS（裁决 2）/family 过滤与无匹配族即错（不静默放宽）/
 * dispatcher 单例恒等（进程级单例——连接池复用零生命周期编舞）/真连接
 * e2e 正负例 + 挂账 tripwire（undici Agent connect.lookup 通行 + fetch
 * dispatcher 认位——07 §129 精确锁纪律：任一传输面契约点变迁即钉死链失效面）。
 *
 * 进程级登记是有意设计（非每请求隔离）——测试用独立 hostname 防交叉污染，
 * 不设重置钩（单例语义本身即被测对象之一）。
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent, fetch as undici8Fetch } from 'undici';

import { getPinnedDispatcher, pinnedAddressesOf, pinnedFetch, pinnedLookup, pinDnsAddresses } from './dns-pin.js';

/** lookup 包装：callback 形折 Promise（单形/all 形/错形三态归一） */
function lookupOf(
  hostname: string,
  options: { family?: number | 'IPv4' | 'IPv6'; all?: boolean } = {},
): Promise<
  | { err: Error; single?: undefined; all?: undefined }
  | { err?: undefined; single: { address: string; family: number }; all?: undefined }
  | { err?: undefined; single?: undefined; all: Array<{ address: string; family: number }> }
> {
  return new Promise((resolve) => {
    pinnedLookup(hostname, options, (err, address, family) => {
      if (err !== null) {
        resolve({ err });
        return;
      }
      if (Array.isArray(address)) {
        resolve({ all: address });
        return;
      }
      resolve({ single: { address, family: family ?? 0 } });
    });
  });
}

describe('入钉登记（pinDnsAddresses + pinnedAddressesOf）', () => {
  it('入钉即登记、只读面同值直返', () => {
    pinDnsAddresses('register-a.rb.test', ['93.184.216.34']);
    expect(pinnedAddressesOf('register-a.rb.test')).toEqual(['93.184.216.34']);
  });

  it('首钉保留——重复入钉不覆盖（裁决 1「一经校验钉值恒定」）', () => {
    pinDnsAddresses('first-pin-wins.rb.test', ['93.184.216.34']);
    pinDnsAddresses('first-pin-wins.rb.test', ['198.51.100.9']); // 后写不入
    expect(pinnedAddressesOf('first-pin-wins.rb.test')).toEqual(['93.184.216.34']);
  });

  it('hostname 小写归一（大小写异形同键——URL.hostname 亦恒小写，防御双保险）', () => {
    pinDnsAddresses('MiXeD.CaSe.rb.test', ['93.184.216.34']);
    expect(pinnedAddressesOf('mixed.case.rb.test')).toEqual(['93.184.216.34']);
    expect(pinnedAddressesOf('MIXED.CASE.RB.TEST')).toEqual(['93.184.216.34']);
  });

  it('v6 包裹形防御剥壳（[..] 形同键）', () => {
    pinDnsAddresses('[2606-odd.rb.test]', ['2606:4700::1']);
    expect(pinnedAddressesOf('2606-odd.rb.test')).toEqual(['2606:4700::1']);
  });

  it('空地址集不入钉（空值防呆——不产空钉占键）', () => {
    pinDnsAddresses('empty-pin.rb.test', []);
    expect(pinnedAddressesOf('empty-pin.rb.test')).toBeUndefined();
  });
});

describe('钉值 lookup（pinnedLookup——net.connect 兼容形）', () => {
  it('在钉用钉：单形应答（address + family）', async () => {
    pinDnsAddresses('single-lookup.rb.test', ['93.184.216.34']);
    await expect(lookupOf('single-lookup.rb.test')).resolves.toEqual({
      single: { address: '93.184.216.34', family: 4 },
    });
  });

  it('在钉用钉：all 形应答（地址族对数组——node autoSelectFamily 消费形）', async () => {
    pinDnsAddresses('all-lookup.rb.test', ['93.184.216.34', '2606:4700::1111']);
    await expect(lookupOf('all-lookup.rb.test', { all: true })).resolves.toEqual({
      all: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700::1111', family: 6 },
      ],
    });
  });

  it('无钉即错 fail-closed——不回落真 DNS（裁决 2；报文自述接线位缺失）', async () => {
    const result = await lookupOf('never-pinned.rb.test');
    expect(result.err).toBeInstanceOf(Error);
    expect(result.err!.message).toContain('never-pinned.rb.test');
    expect(result.err!.message).toContain('fail-closed');
  });

  it('family 过滤：请求 4/6 按族筛（混钉取族内首值）', async () => {
    pinDnsAddresses('family-filter.rb.test', ['93.184.216.34', '2606:4700::1111']);
    await expect(lookupOf('family-filter.rb.test', { family: 6 })).resolves.toEqual({
      single: { address: '2606:4700::1111', family: 6 },
    });
    await expect(lookupOf('family-filter.rb.test', { family: 4 })).resolves.toEqual({
      single: { address: '93.184.216.34', family: 4 },
    });
  });

  it('family 无匹配族即错——不静默放宽（v6 请求打 v4-only 钉拒）', async () => {
    pinDnsAddresses('v4only.rb.test', ['93.184.216.34']);
    const result = await lookupOf('v4only.rb.test', { family: 6 });
    expect(result.err).toBeInstanceOf(Error);
    expect(result.err!.message).toContain('family 6');
  });
});

describe('dispatcher 单例（getPinnedDispatcher——进程级）', () => {
  it('恒等单例（多次调用同一 Agent——连接池复用零生命周期编舞）', () => {
    expect(getPinnedDispatcher()).toBe(getPinnedDispatcher());
    expect(getPinnedDispatcher()).toBeInstanceOf(Agent);
  });
});

/** 错误因果链折串（fetch failed 包裹形剥到根因——钉值 lookup 的 fail-closed 自述报文藏在 cause 链里） */
function causeChainOf(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  while (cursor instanceof Error) {
    parts.push(cursor.message);
    cursor = (cursor as Error & { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

/**
 * 真连接 e2e（rb-1 补锁——钉死链传输面两契约点，07 §129 精确锁纪律：
 * 任一契约点变迁即钉死链失效面，须本 e2e 全量重跑）：
 * ① undici Agent `connect.lookup` 真通行（钉值 lookup 经真实 Agent 连接被
 *    消费——非只 lookupOf 直调 callback 形）；
 * ② fetch `init.dispatcher` 真认位（dispatcher 被传输层消费而非静默忽略）。
 *
 * 手法：127.0.0.1 回环 server（listen(0) 内核指派端口）+ 专用假名入钉
 * （`*.rb.test` 保留 TLD 真 DNS 不可达——假名连通即证连接地址完全来自钉
 * 登记，若 lookup 未被 Agent 消费，真 DNS 路径连不出本回环 server）。
 * 全程回环零真外联。
 *
 * **传输 harness = 同包 undici 8 fetch（`undici8Fetch` / `pinnedFetch`）=
 * 生产终态形（rb-2 批修法已落：fetch 与 dispatcher 同包律）**：rb-1 补锁
 * e2e 首跑当场抓获——现役配对下全局 fetch（Node 24.18 内置 undici 7.28 旧
 * handler 接口 onConnect/onHeaders 族）× npm undici 8 Agent（新
 * RequestHandler 接口）**确定性互斥**：全局 fetch 派发的旧 handler 过不了
 * 包 8 dispatcher 的 assertRequestHandler → 每次必抛 UND_ERR_INVALID_ARG
 * 「invalid onRequestStart method」（rb 批「全局 fetch 认 init.dispatcher」
 * 实验定案方向记反、随批废止——03 §10.3 ② 勘正注 + 07 §2.1 行同笔），且
 * 生产真实外联自 rb 批起即坏而全测试仍绿（测试全注入桩 fetchImpl）——正
 * 是本锁存在之目的。修法（主程四象限 node 实证复核后定）：生产外联 fetch
 * 恒走同包 undici 8 fetch（`pinnedFetch` 单源自携单例 dispatcher——service
 * 缺省 fetchImpl 与 ssrf-guard 装配注入两消费位同源消费）；跨包形（全局
 * fetch × 包 Agent）列结构性禁区，由下方 tripwire 例持续锁「互斥必抛」
 * 事实——若 Node/npm undici 版本配对变迁使互斥消解，tripwire 翻红强制
 * 重评（届时本注释与 07 定形注一并再勘）。
 */
describe('真连接 e2e（connect.lookup 通行 + dispatcher 认位——07 §129 精确锁纪律）', () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      // 回体携 Host 头折返——证据面：URL hostname 原样保留为假名（连接地址来自钉，非 URL 改写直连 IP）
      response.end(`e2e-ok host=${request.headers.host ?? ''}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    // 收尾先断全部连接再关监听（undici 池 keep-alive socket 不自放——不剥则句柄悬挂拖尾 worker）
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  // 登记清理说明：dns-pin 件进程级登记有意无 unpin 面（本批零生产码改动）——
  // 循本件既定卫生先例（头注：独立 hostname 防交叉污染、不设重置钩）：本块
  // 专用 hostname 无共置消费者，残留钉在本文件生命周期内无害。

  it('正例：钉名经单例 dispatcher 真连接 200（connect.lookup 通行——假名连通即证连接地址完全来自钉登记）', async () => {
    pinDnsAddresses('pin-e2e.rb.test', ['127.0.0.1']);
    const response = await undici8Fetch(`http://pin-e2e.rb.test:${port}/`, {
      dispatcher: getPinnedDispatcher(),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('e2e-ok');
    // Host 头证据面：请求 URL hostname 恒为假名（连接走钉值 127.0.0.1，URL 未被改写成 IP）
    expect(body).toContain('host=pin-e2e.rb.test:');
  });

  it('正例（rb-2 生产终态形）：pinnedFetch 不显式携 dispatcher 亦恒钉（自携单例——service 缺省腿/ssrf-guard 装配腿同源单源）', async () => {
    // 生产外联单源的真连接锁：调用面零 dispatcher 传参，连接仍走钉值——
    // 证明 pinnedFetch 自携面成立（未来第三消费位忘携 dispatcher 的面闭死）
    pinDnsAddresses('pin-e2e-pinned-fetch.rb.test', ['127.0.0.1']);
    const response = await pinnedFetch(`http://pin-e2e-pinned-fetch.rb.test:${port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('e2e-ok');
    // 同包律静态事实：生产腿非全局 fetch（全局形互斥必抛——见下方 tripwire）
    expect(pinnedFetch).not.toBe(globalThis.fetch);
  });

  it('负例：无钉名同形即拒且因果实为 fail-closed（不静默绕行回落真 DNS——与裸 fetch 形拒可区分）', async () => {
    const failure = await undici8Fetch(`http://never-pinned.rb.test:${port}/`, {
      dispatcher: getPinnedDispatcher(),
    }).then(
      () => {
        throw new Error('预期拒绝却连通——fail-closed 腿缺席');
      },
      (error: unknown) => error,
    );
    // 因果链须含生产 fail-closed 自述报文（产品固定报文——非 AI 生成文本）：
    // 若 dispatcher 未被消费走真 DNS，拒因是连接层错误（ENOTFOUND/不可达）而非钉死件报错——本断言即红
    const chain = causeChainOf(failure);
    expect(chain).toContain('fail-closed');
    expect(chain).toContain('never-pinned.rb.test');
  });

  // 结构性禁区 tripwire：锁「全局 fetch × 包 Agent 互斥必抛」契约点事实——
  // rb-2 批修法已落（生产外联恒走同包 pinnedFetch，跨包形列为禁区），本例
  // 保留 it.fails 形持续锁「互斥仍成立」：若 Node/npm undici 版本配对变迁
  // 使互斥消解（全局 fetch 真能消费本件 Agent），此例翻红——强制持修者重
  // 评同包律是否仍须维持（届时同步 07 §2.1 行与 03 §10.3 ② 勘正注再勘）。
  it.fails(
    '〔挂账 tripwire——生产配对修复即红，届时翻正例〕全局 fetch + npm undici 8 Agent 现役接口互斥（Node 24.18 内置 undici 7.28 旧 handler 族 vs undici 8 RequestHandler 族）',
    async () => {
      pinDnsAddresses('pin-e2e-tripwire.rb.test', ['127.0.0.1']);
      const response = await fetch(`http://pin-e2e-tripwire.rb.test:${port}/`, {
        dispatcher: getPinnedDispatcher(),
      });
      expect(response.status).toBe(200);
    },
  );
});
