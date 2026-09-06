/**
 * SSRF 卫生件纯函数测试（私网判定全表/协议白名单/URL 解析）+ 在飞门测试。
 *
 * 纪律：纯函数直击语义零 mock——私网表逐段覆盖 v4/v6/字面/DNS 四腿；在飞
 * 门走计数断言（异步任务用真 Promise 占位不落网络）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createInFlightGate } from './gate.js';
import { assertPublicHost, isPrivateHostLiteral, parseWebUrl, WEB_PROTOCOLS } from './hygiene.js';

/** 断言某调用抛指定 WEB_ 码（BaseError 面直击——非文本匹配） */
async function expectWebError(promise: Promise<unknown>, code: string): Promise<BaseError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BaseError);
    expect((error as BaseError).code).toBe(code);
    return error as BaseError;
  }
  throw new Error(`预期抛 ${code} 但未抛`);
}

describe('协议白名单与 URL 解析（parseWebUrl）', () => {
  it('http/https 放行', () => {
    expect(parseWebUrl('http://example.com').protocol).toBe('http:');
    expect(parseWebUrl('https://example.com/path?q=1').protocol).toBe('https:');
  });

  it('白名单外协议拒（WEB_PROTOCOL_REJECTED）——file/ftp/javascript/data', () => {
    for (const raw of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(() => parseWebUrl(raw)).toThrowError(expect.objectContaining({ code: 'WEB_PROTOCOL_REJECTED' }));
    }
  });

  it('不可解析拒（WEB_URL_INVALID）——空串/裸主机名/垃圾串', () => {
    // 裸主机名（example.com 无协议）在 URL 构造红——保守拒，补全归工具面
    for (const raw of ['', 'example.com', 'not a url at all', 'http://']) {
      expect(() => parseWebUrl(raw)).toThrowError(expect.objectContaining({ code: 'WEB_URL_INVALID' }));
    }
  });

  it('白名单常量恰两协议', () => {
    expect([...WEB_PROTOCOLS].sort()).toEqual(['http:', 'https:']);
  });
});

describe('私网判定字面腿（isPrivateHostLiteral）——IPv4 段全表', () => {
  it.each([
    ['127.0.0.1', true], // 环回
    ['127.255.255.254', true], // 环回 /8 全段
    ['0.0.0.0', true], // 未指定
    ['10.0.0.1', true], // 私网 A
    ['172.16.0.1', true], // 私网 B 下界
    ['172.31.255.254', true], // 私网 B 上界
    ['192.168.1.1', true], // 私网 C
    ['169.254.169.254', true], // 链路本地（云元数据端点——SSRF 头号目标）
    ['100.64.0.1', true], // CGNAT 下界
    ['100.127.255.254', true], // CGNAT 上界
    ['224.0.0.1', true], // 组播
    ['255.255.255.255', true], // 广播（240/4 保留段）
    // 公网负例
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.32.0.1', false], // B 段上界外
    ['172.15.255.254', false], // B 段下界外
    ['100.63.255.254', false], // CGNAT 下界外
    ['100.128.0.1', false], // CGNAT 上界外
    ['93.184.216.34', false],
  ])('%s → %s', (host, expected) => {
    expect(isPrivateHostLiteral(host)).toBe(expected);
  });
});

describe('私网判定字面腿——IPv6 段', () => {
  it.each([
    ['::1', true], // 环回
    ['::', true], // 未指定
    ['[::1]', true], // URL 包裹形
    ['fc00::1', true], // 唯一本地 fc00::/7
    ['fd12:3456:789a::1', true], // 唯一本地 fd 前缀
    ['fe80::1', true], // 链路本地
    ['febf::1', true], // 链路本地上界 febf
    ['::ffff:10.0.0.1', true], // v4 映射私网
    ['::ffff:127.0.0.1', true], // v4 映射环回
    ['64:ff9b::192.168.0.1', true], // v4 翻译段私网
    ['::10.0.0.1', true], // v4 兼容（弃用段）私网
    // 公网负例
    ['::ffff:8.8.8.8', false], // v4 映射公网
    ['2606:4700:4700::1111', false], // 公网 v6
    ['2001:db8::1', false], // 文档段（RFC 3849——全球单播文档用，非保留判定段）
    ['fec0::1', false], // 弃用 site-local（fe80::/10 外——fe c 不在 8-b）
    ['fe00::1', false], // fe 0 头非链路本地
  ])('%s → %s', (host, expected) => {
    expect(isPrivateHostLiteral(host)).toBe(expected);
  });

  it('zone 尾形直接拒（%zone 链路本地惯用形）', () => {
    expect(isPrivateHostLiteral('fe80::1%eth0')).toBe(true);
  });
});

describe('私网判定字面腿——主机名形', () => {
  it('localhost 族恒拒（RFC 6761）', () => {
    expect(isPrivateHostLiteral('localhost')).toBe(true);
    expect(isPrivateHostLiteral('LOCALHOST')).toBe(true);
    expect(isPrivateHostLiteral('api.localhost')).toBe(true);
  });

  it('普通主机名字面腿放行（交 DNS 腿）', () => {
    expect(isPrivateHostLiteral('example.com')).toBe(false);
    expect(isPrivateHostLiteral('api.github.com')).toBe(false);
  });
});

describe('私网判定全腿（assertPublicHost——字面 + DNS 双查）', () => {
  /** 全公网桩解析器 */
  const publicResolver = async (hostname: string) => {
    expect(hostname).toBe('example.com'); // 桩只应被非字面主机触发
    return ['93.184.216.34', '2606:4700:4700::1111'];
  };

  it('字面私网命中拒（DNS 腿不触发）', async () => {
    const resolver = async () => {
      throw new Error('字面腿命中不应触发 DNS');
    };
    await expectWebError(assertPublicHost(new URL('http://10.0.0.5/'), resolver), 'WEB_PRIVATE_ADDRESS');
    await expectWebError(assertPublicHost(new URL('http://[::1]/'), resolver), 'WEB_PRIVATE_ADDRESS');
  });

  it('DNS 解析结果含私网地址拒（rebinding 首跳防御）', async () => {
    const mixedResolver = async () => ['93.184.216.34', '192.168.0.1'];
    await expectWebError(assertPublicHost(new URL('http://example.com/'), mixedResolver), 'WEB_PRIVATE_ADDRESS');
  });

  it('全公网解析放行', async () => {
    await expect(assertPublicHost(new URL('https://example.com/'), publicResolver)).resolves.toBeUndefined();
  });

  it('DNS 解析失败原样上抛（非卫生拦截——无 WEB_ 码）', async () => {
    const failingResolver = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const error = await assertPublicHost(new URL('https://example.com/'), failingResolver).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BaseError);
  });
});

describe('在飞门（createInFlightGate）', () => {
  it('容量内占门计数、放门回位', () => {
    const gate = createInFlightGate(2);
    expect(gate.capacity).toBe(2);
    gate.acquire();
    gate.acquire();
    expect(gate.inFlight).toBe(2);
    gate.release();
    expect(gate.inFlight).toBe(1);
  });

  it('满拒（WEB_RATE_LIMITED）', () => {
    const gate = createInFlightGate(1);
    gate.acquire();
    expect(() => gate.acquire()).toThrowError(expect.objectContaining({ code: 'WEB_RATE_LIMITED' }));
  });

  it('run 包装：异常也放门（finally 义务）', async () => {
    const gate = createInFlightGate(1);
    await expect(
      gate.run(async () => {
        throw new Error('业务炸');
      }),
    ).rejects.toThrow('业务炸');
    expect(gate.inFlight).toBe(0);
    // 放门后可再占（未泄漏）
    gate.acquire();
    expect(gate.inFlight).toBe(1);
  });

  it('run 包装：成功放门', async () => {
    const gate = createInFlightGate(2);
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
    expect(gate.inFlight).toBe(0);
  });

  it('容量坏形钳制为 1（0/负数不放大并发面）', () => {
    expect(createInFlightGate(0).capacity).toBe(1);
    expect(createInFlightGate(-3).capacity).toBe(1);
  });

  it('过量 release 不负计数（防御位——finally 路径不 fail-loud）', () => {
    const gate = createInFlightGate(1);
    gate.release();
    gate.release();
    expect(gate.inFlight).toBe(0);
    gate.acquire();
    expect(gate.inFlight).toBe(1);
  });
});
