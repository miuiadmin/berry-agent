/**
 * webui/security 判定器矩阵测试（批 18a-1）。
 *
 * 锁三面——
 * ① 三防线判定器语义（Host 白名单/Origin 硬防线/回环归一）逐例矩阵；
 * ② token 本体形状（32 字节 hex）与随机性（两次不撞）；
 * ③ fail-closed 拒启律（非回环绑定未配凭证拒启——启动断言预埋位）。
 *
 * 对拍律（03 §10.4 批 18a 落码定形注⑤「同律复用引证」的执法位）：sdk/
 * security 与本件同承原始条款、语义等价各自单源——漂移由本测试互证
 * （测试文件不计边表账——02 §4.1 用例证据口径）。
 */
import { describe, expect, it } from 'vitest';

import * as sdk from '../sdk/index.js';

import {
  generateToken,
  hostPartOf,
  isLoopbackHost,
  judgeHostHeader,
  judgeListenConfig,
  originAllowed,
} from './security.js';

describe('webui/security hostPartOf（Host 头归一）', () => {
  it('剥可选 :port（IPv4 形）', () => {
    expect(hostPartOf('127.0.0.1:7860')).toBe('127.0.0.1');
    expect(hostPartOf('localhost:8080')).toBe('localhost');
  });

  it('括号 IPv6 形只剥闭括号后端口段（括号内冒号不剥）', () => {
    expect(hostPartOf('[::1]:7860')).toBe('[::1]');
    expect(hostPartOf('[::1]')).toBe('[::1]');
  });

  it('无端口原样 + 大小写归一', () => {
    expect(hostPartOf('LOCALHOST')).toBe('localhost');
    expect(hostPartOf('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('webui/security isLoopbackHost（回环三形判定）', () => {
  it('回环三形皆真（::1 裸形归一同判）', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('非回环皆假（含全零绑定与域名）', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.2')).toBe(false);
    expect(isLoopbackHost('evil.example.com')).toBe(false);
  });
});

describe('webui/security judgeHostHeader（Host 白名单——DNS rebinding 防线）', () => {
  it('回环绑定形态受回环穷举（三形 × 带不带端口）', () => {
    for (const host of ['127.0.0.1', '127.0.0.1:7860', 'localhost', 'localhost:7860', '[::1]:7860']) {
      expect(judgeHostHeader(host, '127.0.0.1')).toEqual({ ok: true });
    }
  });

  it('回环绑定拒非回环 Host（rebinding 攻击面）', () => {
    expect(judgeHostHeader('evil.example.com:7860', '127.0.0.1').ok).toBe(false);
    expect(judgeHostHeader('0.0.0.0:7860', 'localhost').ok).toBe(false);
  });

  it('Host 头缺席/空串即拒（HTTP/1.1 必在场）', () => {
    expect(judgeHostHeader(undefined, '127.0.0.1').ok).toBe(false);
    expect(judgeHostHeader('', '127.0.0.1').ok).toBe(false);
  });

  it('非回环绑定只受绑定地址字面（含括号归一形）', () => {
    expect(judgeHostHeader('0.0.0.0:7860', '0.0.0.0')).toEqual({ ok: true });
    expect(judgeHostHeader('192.168.1.2', '192.168.1.2')).toEqual({ ok: true });
    // 非回环绑定不接受回环形 Host（值域 = 绑定地址——不接受任意 Host）
    expect(judgeHostHeader('127.0.0.1:7860', '0.0.0.0').ok).toBe(false);
  });
});

describe('webui/security originAllowed（Origin 硬防线）', () => {
  it('无 Origin 放行（防线判浏览器跨源，不判非浏览器客户端）', () => {
    expect(originAllowed(undefined, '127.0.0.1', 7860)).toBe(true);
    expect(originAllowed('', '127.0.0.1', 7860)).toBe(true);
  });

  it('回环绑定同源三形过（scheme 恒 http）', () => {
    expect(originAllowed('http://127.0.0.1:7860', '127.0.0.1', 7860)).toBe(true);
    expect(originAllowed('http://localhost:7860', '127.0.0.1', 7860)).toBe(true);
    expect(originAllowed('http://[::1]:7860', '127.0.0.1', 7860)).toBe(true);
  });

  it('错端口/https 形/异源皆拒', () => {
    expect(originAllowed('http://127.0.0.1:9999', '127.0.0.1', 7860)).toBe(false);
    expect(originAllowed('https://localhost:7860', '127.0.0.1', 7860)).toBe(false);
    expect(originAllowed('http://evil.example.com', '127.0.0.1', 7860)).toBe(false);
  });

  it('非回环绑定同源 = 恰等绑定地址:端口', () => {
    expect(originAllowed('http://0.0.0.0:7860', '0.0.0.0', 7860)).toBe(true);
    expect(originAllowed('http://127.0.0.1:7860', '0.0.0.0', 7860)).toBe(false);
  });
});

describe('webui/security generateToken（token 本体保证）', () => {
  it('32 字节 hex（64 字符）', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('两次生成不撞（随机性下限）', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('webui/security judgeListenConfig（fail-closed 拒启律预埋）', () => {
  it('缺省绑定（host 缺席）恒回环——放行', () => {
    expect(judgeListenConfig({})).toEqual({ ok: true });
    expect(judgeListenConfig({ token: 'abc' })).toEqual({ ok: true });
  });

  it('显式回环绑定无需凭证', () => {
    expect(judgeListenConfig({ host: '127.0.0.1' })).toEqual({ ok: true });
    expect(judgeListenConfig({ host: 'localhost' })).toEqual({ ok: true });
    expect(judgeListenConfig({ host: '[::1]' })).toEqual({ ok: true });
  });

  it('显式非回环绑定未配凭证即拒启（03 §10.4①）', () => {
    const verdict = judgeListenConfig({ host: '0.0.0.0' });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('0.0.0.0');
  });

  it('非回环绑定配凭证放行；空串凭证视同未配（拒）', () => {
    expect(judgeListenConfig({ host: '0.0.0.0', token: 't' }).ok).toBe(true);
    expect(judgeListenConfig({ host: '0.0.0.0', token: '' }).ok).toBe(false);
  });
});

describe('webui/security ↔ sdk/security 对拍律（同律复用引证互证）', () => {
  /** Host 头样本域（覆盖三形 × 端口 × 大小写 × 攻击形） */
  const HOST_SAMPLES = [
    '127.0.0.1',
    '127.0.0.1:7860',
    'localhost',
    'LOCALHOST:80',
    '[::1]',
    '[::1]:7860',
    '::1',
    '0.0.0.0:7860',
    '192.168.1.2',
    'evil.example.com:443',
    '',
  ];
  /** 绑定形态域（回环三形 + 非回环两形） */
  const BIND_SAMPLES = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0', '192.168.1.2'];
  /** Origin 样本域（无/同源三形/错端口/https/异源） */
  const ORIGIN_SAMPLES = [
    undefined,
    '',
    'http://127.0.0.1:7860',
    'http://localhost:7860',
    'http://[::1]:7860',
    'http://127.0.0.1:9999',
    'https://localhost:7860',
    'http://evil.example.com',
  ];

  it('hostPartOf / isLoopbackHost 逐样本同值', () => {
    for (const s of HOST_SAMPLES) {
      if (s === '') continue; // 空串 Host 在 judge 层拒——归一函数本身两件同义
      expect(hostPartOf(s), s).toBe(sdk.hostPartOf(s));
    }
    for (const s of HOST_SAMPLES) expect(isLoopbackHost(s), s).toBe(sdk.isLoopbackHost(s));
  });

  it('judgeHostHeader 判定布尔逐对同值（Host 样本 × 绑定形态全域）', () => {
    for (const host of [...HOST_SAMPLES, undefined]) {
      for (const bind of BIND_SAMPLES) {
        expect(judgeHostHeader(host, bind).ok, `${host} @ ${bind}`).toBe(sdk.judgeHostHeader(host, bind).ok);
      }
    }
  });

  it('originAllowed 逐对同值（Origin 样本 × 绑定 × 端口）', () => {
    for (const origin of ORIGIN_SAMPLES) {
      for (const bind of BIND_SAMPLES) {
        for (const port of [7860, 0]) {
          expect(originAllowed(origin, bind, port), `${origin} @ ${bind}:${port}`).toBe(
            sdk.originAllowed(origin, bind, port),
          );
        }
      }
    }
  });
});
