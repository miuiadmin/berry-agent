/**
 * 引擎出口代理组合测（03 §10.3 引擎网络栈出口钉死——proxy 件防回归锁）。
 *
 * 谱形：resolveDns/netConnect 双注入 + 真回环 fake 上游 net server 组合——
 * 卫生拒形（字面私网 IP/DNS 解析私网/v6 字面/明文腿字面私网/origin-form
 * 未知腿）断「断连 fail-closed + 不触上游连接面 + 字面腿不触 DNS」；公网
 * 形断「连接目标 = 经校验地址集首址（校验结果即连接目标律）+ 双向字节管道
 * 保真（CONNECT 头块不抵上游、明文腿已读字节原样写）」。netConnect 桩重
 * 定向到回环 fake 上游（目标断言按经校验地址判——同源断言律）。
 */
import net from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createBrowserProxy, engineEgressProxy } from './proxy.js';
import type { ProxyConnectTarget } from './proxy.js';

/** 回环直连桩基元（netConnect 注入位消费——连真 fake 上游） */
function netConnectTo(port: number): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => resolve(sock));
    sock.once('error', reject);
  });
}

/** 回环 fake 上游（真 net server——收账累积 + 应答策略注入） */
async function fakeUpstream(
  respond: (chunk: Buffer, sock: net.Socket) => void,
): Promise<{ port: number; received: () => Buffer }> {
  let buffer = Buffer.alloc(0);
  const server = net.createServer((sock) => {
    sock.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      respond(chunk, sock);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, received: () => buffer };
}

/** 代理客户端探针（累积收账 + 收包含期望串等待 + 断连等待） */
async function connectProbe(port: number): Promise<{
  send: (data: string) => void;
  received: () => Buffer;
  until: (needle: string) => Promise<void>;
  closed: Promise<void>;
  destroy: () => void;
}> {
  const socket = net.connect({ host: '127.0.0.1', port });
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
  });
  const closed = new Promise<void>((resolve) => {
    socket.on('close', () => resolve());
  });
  return {
    send: (data) => {
      socket.write(data);
    },
    received: () => buffer,
    // 轮询等待（真定时器——本文件不用假钟；3s 帽内未见即抛真诊断）
    until: async (needle) => {
      const deadline = Date.now() + 3_000;
      while (!buffer.includes(needle)) {
        if (socket.destroyed) {
          throw new Error(`连接已断未收期望包：期望「${needle}」实收 ${buffer.toString('utf8')}`);
        }
        if (Date.now() > deadline) {
          throw new Error(`等待收包超时：期望「${needle}」实收 ${buffer.toString('utf8')}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    closed,
    destroy: () => socket.destroy(),
  };
}

/** 断言基元：断连（fail-closed 唯一观察面——拒不产协议面错误应答） */
async function expectClosed(probe: Awaited<ReturnType<typeof connectProbe>>): Promise<void> {
  await probe.closed;
}

describe('引擎出口代理（03 §10.3 引擎网络栈出口钉死）', () => {
  it('CONNECT 字面私网 IP → 断连 fail-closed（字面腿不触 DNS、不触上游连接面）', async () => {
    const dnsCalls: string[] = [];
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async (hostname) => {
        dnsCalls.push(hostname);
        return ['93.184.216.34'];
      },
      netConnect: async (t) => {
        connectCalls.push(t);
        throw new Error('不应触上游');
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n');
    await expectClosed(probe);
    expect(connectCalls).toEqual([]); // 拒在上游连接面之前
    expect(dnsCalls).toEqual([]); // 字面腿在 DNS 解析之前即拒
    probe.destroy();
  });

  it('CONNECT 主机名 DNS 解析私网 → 断连（DNS 全地址任一私网即拒——卫生单源同源）', async () => {
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async () => ['203.0.113.9', '10.0.0.5'], // 任一私网命中即拒
      netConnect: async (t) => {
        connectCalls.push(t);
        throw new Error('不应触上游');
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('CONNECT rebind.test:443 HTTP/1.1\r\nHost: rebind.test\r\n\r\n');
    await expectClosed(probe);
    expect(connectCalls).toEqual([]);
    probe.destroy();
  });

  it('CONNECT v6 字面 [::1] → 断连（v6 包裹形归一腿）', async () => {
    const dnsCalls: string[] = [];
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async (hostname) => {
        dnsCalls.push(hostname);
        return ['93.184.216.34'];
      },
      netConnect: async (t) => {
        connectCalls.push(t);
        throw new Error('不应触上游');
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]\r\n\r\n');
    await expectClosed(probe);
    expect(connectCalls).toEqual([]);
    expect(dnsCalls).toEqual([]);
    probe.destroy();
  });

  it('CONNECT 公网 → 200 应答 + 双向字节管道保真（连接目标 = 经校验地址集首址）', async () => {
    // fake 上游：逐块回显（echo: 前缀——双向管道保真观察面）
    const up = await fakeUpstream((chunk, sock) => {
      sock.write(Buffer.concat([Buffer.from('echo:'), chunk]));
    });
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async () => ['93.184.216.34', '8.8.4.4'], // 首址 = 连接目标（全公网形）
      netConnect: async (t) => {
        connectCalls.push(t);
        return netConnectTo(up.port); // 重定向回环真上游（目标断言按经校验地址判）
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('CONNECT tunnel.test:8443 HTTP/1.1\r\nHost: tunnel.test:8443\r\n\r\n');
    await probe.until('HTTP/1.1 200 Connection Established\r\n\r\n');
    // CONNECT 头块属代理语义——不抵上游（隧道载荷自头块后始）
    expect(up.received().length).toBe(0);
    probe.send('ping-up');
    await probe.until('echo:ping-up'); // 上游字节原样回抵客户端
    // 校验结果即连接目标：首址 + authority 显式端口（无二次解析窗口）
    expect(connectCalls).toEqual([{ host: '93.184.216.34', port: 8443 }]);
    probe.destroy();
  });

  it('http 明文 absolute-form 腿：公网原样透传（已读字节不改写 + 应答字节保真）', async () => {
    const up = await fakeUpstream((_chunk, sock) => {
      sock.write('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello');
    });
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async () => ['93.184.215.7'], // 公网形（真公网段——禁用 RFC 5737 文档段做夹具）
      netConnect: async (t) => {
        connectCalls.push(t);
        return netConnectTo(up.port);
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    const request = 'GET http://plain.test:8080/path?q=1 HTTP/1.1\r\nHost: plain.test:8080\r\nX-Probe: v\r\n\r\n';
    probe.send(request);
    await probe.until('hello');
    // 已读字节原样写（请求行 + 头序原样不改写——代理只加卫生查）
    expect(up.received().toString('latin1')).toBe(request);
    expect(connectCalls).toEqual([{ host: '93.184.215.7', port: 8080 }]);
    probe.destroy();
  });

  it('http absolute-form 字面私网 → 断连（明文腿同查）', async () => {
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async () => ['93.184.216.34'],
      netConnect: async (t) => {
        connectCalls.push(t);
        throw new Error('不应触上游');
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('GET http://10.0.0.9/x HTTP/1.1\r\nHost: 10.0.0.9\r\n\r\n');
    await expectClosed(probe);
    expect(connectCalls).toEqual([]);
    probe.destroy();
  });

  it('origin-form 非代理形（未知腿）→ 断连 fail-closed', async () => {
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async () => ['93.184.216.34'],
      netConnect: async (t) => {
        connectCalls.push(t);
        throw new Error('不应触上游');
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('GET /path HTTP/1.1\r\nHost: intruder.test\r\n\r\n');
    await expectClosed(probe);
    expect(connectCalls).toEqual([]);
    probe.destroy();
  });

  it('进程级单例 engineEgressProxy：endpoint 稳定 + 恒回环 bind（LAN 面不开口）', async () => {
    const a = await engineEgressProxy().endpoint();
    const b = await engineEgressProxy().endpoint();
    expect(a).toBe(b); // 单例——同一次侦听复用
    expect(a).toMatch(/^127\.0\.0\.1:\d+$/); // 回环 bind（开放代理红线锁）
  });

  it('明文腿非 http 协议（https absolute-form）→ 断连 fail-closed（协议面收紧锁）', async () => {
    const connectCalls: ProxyConnectTarget[] = [];
    const proxy = createBrowserProxy({
      resolveDns: async () => ['93.184.216.34'],
      netConnect: async (t) => {
        connectCalls.push(t);
        throw new Error('不应触上游');
      },
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    probe.send('GET https://intruder.test/path HTTP/1.1\r\nHost: intruder.test\r\n\r\n');
    await expectClosed(probe);
    expect(connectCalls).toEqual([]);
    probe.destroy();
  });
});

describe('校验窗内到达字节不丢（活量刷抵——快照视图形回归锁）', () => {
  /** 受控 DNS 门：两包都抵代理后才放行校验——校验窗确定性覆盖追包 */
  function gatedDns(): { resolveDns: () => Promise<string[]>; release: () => void } {
    let releaseDns!: () => void;
    const gate = new Promise<void>((r) => {
      releaseDns = r;
    });
    return {
      resolveDns: async () => {
        await gate;
        return ['93.184.216.34'];
      },
      release: releaseDns,
    };
  }

  it('明文腿跨包：第二包（请求体）在校验窗内到达 → 接管时全量抵上游', async () => {
    const up = await fakeUpstream(() => undefined);
    const gate = gatedDns();
    const proxy = createBrowserProxy({
      resolveDns: gate.resolveDns,
      netConnect: async () => netConnectTo(up.port),
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    const part1 = 'GET http://plain.test:8080/path HTTP/1.1\r\nHost: plain.test:8080\r\nContent-Length: 4\r\n\r\n';
    const part2 = 'BODY';
    probe.send(part1);
    await new Promise((r) => setTimeout(r, 50)); // 第一包已 dispatch（validating）——第二包在窗内到达
    probe.send(part2);
    await new Promise((r) => setTimeout(r, 50));
    gate.release(); // 放行 DNS → 连接 → 接管刷抵
    await new Promise((r) => setTimeout(r, 150));
    // 快照视图形缺陷锁：上游应收全量 part1+part2（旧形只抵 part1——窗内 BODY 滞留丢失）
    expect(up.received().toString('latin1')).toBe(part1 + part2);
    probe.destroy();
  });

  it('CONNECT 腿窗内追加载荷：头块后早发载荷 + 校验窗内续包 → 全量抵上游（头块不抵）', async () => {
    const up = await fakeUpstream(() => undefined);
    const gate = gatedDns();
    const proxy = createBrowserProxy({
      resolveDns: gate.resolveDns,
      netConnect: async () => netConnectTo(up.port),
    });
    const endpoint = await proxy.endpoint();
    const probe = await connectProbe(Number(endpoint.split(':')[1]));
    const head = 'CONNECT tunnel.test:443 HTTP/1.1\r\nHost: tunnel.test:443\r\n\r\n';
    const earlyPayload = 'EARLY-';
    const windowPayload = 'WINDOW';
    probe.send(head + earlyPayload); // 不合规急切客户端：头块后即发载荷（与头块同包）
    await new Promise((r) => setTimeout(r, 50));
    probe.send(windowPayload); // 校验窗内续包
    await new Promise((r) => setTimeout(r, 50));
    gate.release();
    await new Promise((r) => setTimeout(r, 150));
    // 隧道载荷全量抵上游；CONNECT 头块（代理语义前缀）不抵
    expect(up.received().toString('latin1')).toBe(earlyPayload + windowPayload);
    probe.destroy();
  });
});
