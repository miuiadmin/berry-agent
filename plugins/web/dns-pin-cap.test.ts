/**
 * web/dns-pin 钉面恒帽测试（03 §10.3 安全卫生条 2026-09-14 第四役勘正注——
 * 「钉面恒帽」：pins Map 条目数设帽、首钉保留律维持〔在钉 host 钉值永驻
 * 不覆盖〕、帽满余钉 LRU 逐最旧条目、被逐 host 下次外联重走「校验→入钉」
 * 全链；帽值落码批定 = 1024）。
 *
 * 三锁（第四役落码路 D）：
 * ① 入钉超帽后 LRU 最旧（最久未刷新）条目被逐——被逐 host lookup 即
 *    fail-closed（无钉即错不回落真 DNS = 重走「校验→入钉」链的执法位）；
 * ② 任意 host 首钉值永在——重复入钉携互异地址集不覆盖（首钉保留律，
 *    含刷新路径与帽压下）；
 * ③ 重复 host 刷新 LRU 位不增计数——同 host 多次重钉只占一席，帽满时
 *    刷新者免逐（被逐的是更久未刷新者）。
 *
 * 帽值对拍：码面帽常量未导出（公开面零扩张），本文件硬编码同值——帽值
 * 变更即本锁红，须同笔改两处。
 *
 * 钉态卫生：循 dns-pin.test.ts 头注先例（进程级单例有意无重置钩、独立
 * hostname 防交叉污染）——本文件专用 `*.cap.test` 假名域（.test 保留 TLD
 * 真 DNS 不可达）；vitest 缺省按文件隔离模块注册表，本文件 2k+ 量级入钉
 * 不与共置测试文件钉态互扰。锁①例首段 1024 席排干自带清场（任何背景钉
 * 恒旧于本例入钉、逐出位全落背景）——两例先后序无关。
 */
import { describe, expect, it } from 'vitest';

import { pinnedAddressesOf, pinnedLookup, pinDnsAddresses } from './dns-pin.js';

/** 帽值对拍常量（= dns-pin.ts 码面 PIN_CAP 1024——同值双写，漂移即红） */
const PIN_CAP = 1024;

/** 同步收 lookup 回调错误面（被逐 host 的 fail-closed 报文断言用） */
function lookupErrorOf(host: string): Error | null {
  let captured: Error | null = null;
  pinnedLookup(host, {}, (err) => {
    captured = err;
  });
  return captured;
}

describe('钉面恒帽（03 §10.3 2026-09-14 第四役勘正注——帽满 LRU 逐最旧）', () => {
  it('锁②③：首钉值永驻不覆盖 + 重复入钉不占多席（恰满帽零逐出）', () => {
    // ② 值恒：首钉后携互异地址集重钉 50 次，钉值恒首钉集（首钉保留律——
    // 刷新路径若误用后到地址集即此处红）
    pinDnsAddresses('cap-anchor.cap.test', ['198.51.100.1']);
    for (let i = 1; i <= 50; i += 1) {
      pinDnsAddresses('cap-anchor.cap.test', [`203.0.113.${i}`]);
    }
    expect(pinnedAddressesOf('cap-anchor.cap.test')).toEqual(['198.51.100.1']);
    // ③ 不增计数：anchor（1 席）+ 1023 席新 host 恰满帽（1024）——若 50 次
    // 重钉曾占席，填帽途中即触发逐出（anchor 与首填位属最旧先死）；三哨兵
    // 俱在 = 恰满帽零逐出、重钉零占席
    for (let i = 0; i < PIN_CAP - 1; i += 1) {
      pinDnsAddresses(`cap-fill-a-${i}.cap.test`, ['198.51.100.2']);
    }
    expect(pinnedAddressesOf('cap-anchor.cap.test')).toEqual(['198.51.100.1']);
    expect(pinnedAddressesOf('cap-fill-a-0.cap.test')).toBeDefined();
    expect(pinnedAddressesOf(`cap-fill-a-${PIN_CAP - 2}.cap.test`)).toBeDefined();
  });

  it('锁①：超帽入钉逐 LRU 最旧——刷新者免逐、被逐者 fail-closed 重走校验链', () => {
    // 清场：1024 席排干钉表（背景钉恒旧于本例入钉，逐出位先落背景——
    // 排干后钉表恰为 drain 1024 席，本例序确定性成立）
    for (let i = 0; i < PIN_CAP; i += 1) {
      pinDnsAddresses(`cap-drain-${i}.cap.test`, ['192.0.2.1']);
    }
    // 两新 host 各占一席（各逐一位最旧 drain）；v1 先入、随后携互异地址集
    // 刷新（值不变 + 位刷新到最新）
    pinDnsAddresses('cap-v1.cap.test', ['192.0.2.10']);
    pinDnsAddresses('cap-v2.cap.test', ['192.0.2.11']);
    pinDnsAddresses('cap-v1.cap.test', ['192.0.2.99']); // 刷新 LRU 位（钉值应仍首钉）
    // 排干余下 drain 位（1022 席）→ 钉表序 [v2(未刷新), 1022 席 sweep, v1(已刷新)]
    for (let i = 0; i < PIN_CAP - 2; i += 1) {
      pinDnsAddresses(`cap-sweep-${i}.cap.test`, ['192.0.2.2']);
    }
    // 超帽一席：最旧未刷新者 v2 被逐；v1 后入于 v2 但已刷新 → 免逐且钉值
    // 恒首钉（['192.0.2.10']——刷新未覆盖值）
    pinDnsAddresses('cap-overflow.cap.test', ['192.0.2.3']);
    expect(pinnedAddressesOf('cap-v2.cap.test')).toBeUndefined();
    expect(pinnedAddressesOf('cap-v1.cap.test')).toEqual(['192.0.2.10']);
    expect(pinnedAddressesOf('cap-overflow.cap.test')).toBeDefined();
    // 逐出恰一位（不株连）：次旧侧 sweep 首席仍在
    expect(pinnedAddressesOf('cap-sweep-0.cap.test')).toBeDefined();
    // 被逐 host 连接面 fail-closed（裁决 2——重走「校验→入钉」前的执法位）
    const error = lookupErrorOf('cap-v2.cap.test');
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('登记缺席');
  });
});
