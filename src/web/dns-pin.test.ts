/**
 * web/dns-pin 连接级钉死件测试（03 §10.3 安全卫生条 2026-09-14 定形注——
 * DNS rebinding TOCTOU 闭合批 rb-3）。
 *
 * 覆盖：首钉保留（重复入钉不覆盖——裁决 1「一经校验钉值恒定」）/hostname
 * 小写归一/在钉用钉（net.connect 兼容单形 + all 形两应答形）/无钉即错
 * fail-closed 不回落真 DNS（裁决 2）/family 过滤与无匹配族即错（不静默放宽）/
 * dispatcher 单例恒等（进程级单例——连接池复用零生命周期编舞）。
 *
 * 进程级登记是有意设计（非每请求隔离）——测试用独立 hostname 防交叉污染，
 * 不设重置钩（单例语义本身即被测对象之一）。
 */
import { describe, expect, it } from 'vitest';
import { Agent } from 'undici';

import { getPinnedDispatcher, pinnedAddressesOf, pinnedLookup, pinDnsAddresses } from './dns-pin.js';

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
