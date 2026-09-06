/**
 * sdk/security 三防线判定器测试（批 13e-1）。
 *
 * 钉死：Host 主机部剥端口/IPv6 括号形 / 回环三形穷举与裸 `::1` 归一 /
 * 回环绑定只受回环 Host（rebinding 拒）/ 非回环绑定恰等绑定地址（含括号形）/
 * Origin 无头放行·跨源 403·同源过 / token 64 hex 且互异 / 非回环无凭证
 * fail-closed 拒启。
 */
import { describe, expect, it } from 'vitest';

import {
  generateToken,
  hostPartOf,
  isLoopbackHost,
  judgeHostHeader,
  judgeListenConfig,
  originAllowed,
} from './security.js';

describe('hostPartOf（Host 头主机部归一）', () => {
  it('IPv4/域名形剥可选端口 + 小写归一', () => {
    expect(hostPartOf('127.0.0.1:7860')).toBe('127.0.0.1');
    expect(hostPartOf('LOCALHOST')).toBe('localhost');
    expect(hostPartOf('localhost:80')).toBe('localhost');
  });

  it('IPv6 括号形只剥闭括号后段（括号内冒号不剥）', () => {
    expect(hostPartOf('[::1]:7860')).toBe('[::1]');
    expect(hostPartOf('[::1]')).toBe('[::1]');
    // 未闭括号防御形——原样返回不产半段
    expect(hostPartOf('[::1')).toBe('[::1');
  });

  it('无端口裸主机原样（小写）', () => {
    expect(hostPartOf('192.168.1.5')).toBe('192.168.1.5');
  });
});

describe('isLoopbackHost（回环三形穷举）', () => {
  it('三形全真', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('裸 `::1` 归一同判；非回环与伪形全假', () => {
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(false);
    expect(isLoopbackHost('evil.example.com')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
  });
});

describe('judgeHostHeader（防线②——Host 白名单）', () => {
  it('回环绑定形态：回环三形（带端口）全过', () => {
    for (const bind of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(judgeHostHeader('127.0.0.1:7860', bind).ok).toBe(true);
      expect(judgeHostHeader('localhost', bind).ok).toBe(true);
      expect(judgeHostHeader('[::1]:7860', bind).ok).toBe(true);
    }
  });

  it('回环绑定形态：非回环 Host 拒（DNS rebinding 防线原义）', () => {
    const r = judgeHostHeader('evil.example.com:7860', '127.0.0.1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('evil.example.com');
  });

  it('非回环绑定形态：恰等绑定地址过（含 IPv6 括号归一双形）', () => {
    expect(judgeHostHeader('192.168.1.5:7860', '192.168.1.5').ok).toBe(true);
    expect(judgeHostHeader('192.168.1.5', '192.168.1.5').ok).toBe(true);
    expect(judgeHostHeader('[fd00::5]:7860', 'fd00::5').ok).toBe(true);
    expect(judgeHostHeader('[fd00::5]', '[fd00::5]').ok).toBe(true);
  });

  it('非回环绑定形态：他址 Host 拒（不接受任意 Host）', () => {
    expect(judgeHostHeader('evil.example.com', '192.168.1.5').ok).toBe(false);
    expect(judgeHostHeader('127.0.0.1', '192.168.1.5').ok).toBe(false); // 回环值域不扩入非回环绑定
  });

  it('Host 头缺席/空串拒（HTTP/1.1 必在场）', () => {
    expect(judgeHostHeader(undefined, '127.0.0.1').ok).toBe(false);
    expect(judgeHostHeader('', '127.0.0.1').ok).toBe(false);
  });
});

describe('originAllowed（防线③——Origin 硬防线）', () => {
  it('无 Origin 放行（程序调用方——SDK 恒无 Origin）', () => {
    expect(originAllowed(undefined, '127.0.0.1', 7860)).toBe(true);
    expect(originAllowed('', '127.0.0.1', 7860)).toBe(true);
  });

  it('回环绑定：同源三形过、跨源拒', () => {
    expect(originAllowed('http://localhost:7860', '127.0.0.1', 7860)).toBe(true);
    expect(originAllowed('http://127.0.0.1:7860', 'localhost', 7860)).toBe(true);
    expect(originAllowed('http://[::1]:7860', '[::1]', 7860)).toBe(true);
    expect(originAllowed('http://evil.example.com', '127.0.0.1', 7860)).toBe(false);
    expect(originAllowed('http://localhost:9999', '127.0.0.1', 7860)).toBe(false); // 端口不同即跨源
    expect(originAllowed('https://localhost:7860', '127.0.0.1', 7860)).toBe(false); // scheme 不同即跨源
  });

  it('非回环绑定：恰等绑定地址同源过、回环三形不扩入', () => {
    expect(originAllowed('http://192.168.1.5:7860', '192.168.1.5', 7860)).toBe(true);
    expect(originAllowed('http://127.0.0.1:7860', '192.168.1.5', 7860)).toBe(false);
    expect(originAllowed('http://evil.example.com', '192.168.1.5', 7860)).toBe(false);
  });
});

describe('generateToken（token 鉴权件）', () => {
  it('32 字节 hex = 64 字符且全 hex 域', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('两次生成互异（随机性底线锁——不可退化为常量）', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('judgeListenConfig（防线①——启动断言 fail-closed）', () => {
  it('缺席 TCP（纯 sock 形）与回环 TCP 恒过（凭证可选）', () => {
    expect(judgeListenConfig({ socketPath: '/tmp/x.sock' }).ok).toBe(true);
    expect(judgeListenConfig({ socketPath: '/tmp/x.sock', tcp: { host: '127.0.0.1', port: 7860 } }).ok).toBe(true);
    expect(judgeListenConfig({ socketPath: '/tmp/x.sock', tcp: { host: 'localhost', port: 7860 } }).ok).toBe(true);
  });

  it('非回环 TCP 无凭证拒启（报因含 BERRY_AGENT_SDK_TOKEN）', () => {
    const r = judgeListenConfig({ socketPath: '/tmp/x.sock', tcp: { host: '0.0.0.0', port: 7860 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('BERRY_AGENT_SDK_TOKEN');
  });

  it('非回环 TCP 配凭证过；空串凭证视同缺席（拒启）', () => {
    expect(judgeListenConfig({ socketPath: '/tmp/x.sock', tcp: { host: '0.0.0.0', port: 7860 }, token: 'k' }).ok).toBe(
      true,
    );
    expect(judgeListenConfig({ socketPath: '/tmp/x.sock', tcp: { host: '0.0.0.0', port: 7860 }, token: '' }).ok).toBe(
      false,
    );
  });
});
