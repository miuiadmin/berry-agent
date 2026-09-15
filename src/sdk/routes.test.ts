/**
 * sdk/http 路由扩展位测试（批 18a-1'；03 §10.6 路由扩展位段——2026-09-07
 * webui 插件化批）。
 *
 * 全环真监听（回环 TCP 双面 + 非回环 TCP 单面）——node:http/fetch 真请求；
 * 桥桩同 http.test.ts 最小同构。锁六面——
 * ①注册期校验（/v1/ 保留字拒 / open purpose 越界拒 / path 形非法拒 / 重复注册拒）
 * ②匹配器（:param 提取 / catch-all 尾 + 单 * 吞一切 / 具名先于 catch-all /
 * method 不符 404 / 摘除 fn 摘后 404 可重注册）
 * ③gate 序倒转（**未匹配 404 免凭证**——安全面行为变化的显式回归锁，旧序 401）
 * ④鉴权档四值（token / token-or-cookie 双通道 / open / self）+ Host/Origin
 * 面级先行适用于一切路由
 * ⑤loopbackOnly 挂载规则（非回环 TCP 不挂载 404 同未注册 + start warn）
 * ⑥helper 三件（readBody 排空纪律 413 / verifyToken / openSse 帧形与收口）
 * + isClosed 扩展路由 503 同律 + 多监听并存（sock 缺席 / TCP×N）
 * ⑦flaky 真案锁（连接 host 缺省钉 v4 字面——[::1] 同号端口劫持面闭死）
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace, type SdkHttpFaceHandle, type SdkListenInfo } from './http.js';
import type { SdkHttpBridge, SdkRouteDescriptor } from './types.js';

/** 桥桩最小同构（扩展路由测试不触核——八面惰性桩） */
function makeBridge(): SdkHttpBridge {
  return {
    submitPrompt: () => ({ sessionId: 's' }),
    lookupDedupeKey: () => undefined,
    interruptSession: () => {},
    queryEntries: () => ({ entries: [] }),
    listSessions: () => [],
    highWaterOf: () => undefined,
    sessionStateOf: () => 'missing',
    retryProbeOf: () => null,
  };
}

/** 应答记账 handler 工厂（JSON 回显 params/wildcard——匹配器断言位） */
function echoHandler(log: Array<{ params: Record<string, string>; wildcard?: string }>) {
  return (
    _req: unknown,
    res: import('node:http').ServerResponse,
    ctx: { params: Record<string, string>; wildcard?: string },
  ): void => {
    log.push({ params: { ...ctx.params }, ...(ctx.wildcard !== undefined ? { wildcard: ctx.wildcard } : {}) });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ params: ctx.params, wildcard: ctx.wildcard ?? null }));
  };
}

/**
 * 裸请求（Host/Origin 防线位——fetch 禁改两头；POST 形可写体）。
 *
 * 连接 host 缺省钉 127.0.0.1 字面（flaky 真案修——2026-09-15 收口）：node
 * http.request 缺省 host 为 localhost，本机解析序 ::1 先行；当测试面经 port:0
 * 拿到的瞬态端口号恰与某 [::1] 回环占用者（实证 Sangfor O+Connect [::1]:64000，
 * 对未知路径应 403）同号时，::1 先试即被劫持——「未匹配路径 404」断言得 403
 * （四问评估 verify 全量 1/20 真案）。v4/v6 跨族同号并存内核不视为冲突，故
 * 撞号结构性可能；连接 host 钉绑定侧字面即无 family 二义，永不旁落（⑦ 真案锁）。
 * 显式传 host 的调用（防线用例/0.0.0.0 形）不受影响。
 */
function rawRequest(
  options: { port: number; host?: string },
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ ...options, host: options.host ?? '127.0.0.1', method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('sdk/http 路由扩展位（18a-1）', () => {
  let face: SdkHttpFaceHandle;
  let info: SdkListenInfo;
  let dir: string;
  /** handler 记账（匹配器断言位） */
  let hits: Array<{ params: Record<string, string>; wildcard?: string }>;
  /** warn 行账（挂载规则断言位） */
  const warnings: string[] = [];

  /** 惯例路由族（匹配器 + 鉴权档断言用——每次 beforeEach 重注） */
  const sampleRoutes = (): SdkRouteDescriptor[] => [
    {
      method: 'GET',
      path: '/api/echo/:id',
      auth: { mode: 'open', purpose: 'static-shell' } as const,
      handler: echoHandler(hits),
    },
    {
      method: 'GET',
      path: '/api/*',
      auth: { mode: 'open', purpose: 'static-shell' } as const,
      handler: echoHandler(hits),
    },
  ];

  beforeEach(async () => {
    hits = [];
    warnings.length = 0;
    dir = await mkdtemp(join(tmpdir(), 'sdk-routes-'));
    face = createSdkHttpFace({
      config: { socketPath: join(dir, 'test.sock'), tcp: { host: '127.0.0.1', port: 0 } },
      bridge: makeBridge(),
      routes: sampleRoutes(),
      warn: (m) => warnings.push(m),
    });
    info = await face.start();
  });

  afterEach(async () => {
    await face.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const port = (): number => info.tcp[0]!.port;

  /* ---------------- ① 注册期校验（fail-loud——构造/注册即抛） ---------------- */

  it('/v1/ 前缀保留字：注册即拒 fail-loud', () => {
    expect(() =>
      face.register({
        method: 'GET',
        path: '/v1/anything',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).toThrow(/保留字/);
    expect(() =>
      face.register({ method: 'GET', path: '/v1', auth: { mode: 'open', purpose: 'static-shell' }, handler: () => {} }),
    ).toThrow(/保留字/);
  });

  it('open 档 purpose 越界：注册即拒（射界枚举钉死——代码可执法）', () => {
    expect(() =>
      face.register({
        method: 'GET',
        path: '/api/who',
        auth: { mode: 'open', purpose: 'admin' as never },
        handler: () => {},
      }),
    ).toThrow(/open/);
  });

  it('path 形非法：中段通配 / 双通配 / 非 / 开头——注册即拒', () => {
    expect(() =>
      face.register({
        method: 'GET',
        path: '/api/*/tail',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).toThrow();
    expect(() =>
      face.register({
        method: 'GET',
        path: '/a/*/b/*',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).toThrow();
    expect(() =>
      face.register({
        method: 'GET',
        path: 'api/x',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).toThrow();
  });

  it('method+path 重复注册即拒；摘除后可重注册', () => {
    expect(() =>
      face.register({
        method: 'GET',
        path: '/api/dup',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).not.toThrow();
    expect(() =>
      face.register({
        method: 'GET',
        path: '/api/dup',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).toThrow(/重复/);
    // method 异形不冲突（method+path 双键）
    expect(() =>
      face.register({
        method: 'POST',
        path: '/api/dup',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).not.toThrow();
    expect(() =>
      face.register({
        method: 'GET',
        path: '/api/dup2',
        auth: { mode: 'open', purpose: 'static-shell' },
        handler: () => {},
      }),
    ).not.toThrow();
  });

  /* ---------------- ② 匹配器 ---------------- */

  it(':param 段提取进 ctx.params；catch-all 尾 wildcard 吞余段', async () => {
    const named = await rawRequest({ port: port() }, 'GET', '/api/echo/s-42', {});
    expect(named.status).toBe(200);
    expect(JSON.parse(named.body)).toEqual({ params: { id: 's-42' }, wildcard: null });

    const tail = await rawRequest({ port: port() }, 'GET', '/api/assets/js/app.js', {});
    expect(tail.status).toBe(200);
    expect(JSON.parse(tail.body)).toEqual({ params: {}, wildcard: 'assets/js/app.js' });
  });

  it('匹配序：具名路由先于 catch-all（同请求双可匹配时具名赢）', async () => {
    await rawRequest({ port: port() }, 'GET', '/api/echo/x', {});
    expect(hits).toHaveLength(1);
    expect(hits[0]!.params).toEqual({ id: 'x' }); // 非 catch-all 的 {} + wildcard
  });

  it('method 不符 → 404（method+path 双键）', async () => {
    const res = await rawRequest({ port: port() }, 'POST', '/api/echo/x', {});
    expect(res.status).toBe(404);
  });

  it('摘除 fn：摘除后 404 同未注册', async () => {
    // 路径取 /api/ 射界外（sample catch-all `/api/*` 会吞掉 /api/* 内一切——摘除例须独立路径）
    const detach = face.register({
      method: 'GET',
      path: '/detach/tmp',
      auth: { mode: 'open', purpose: 'static-shell' },
      handler: () => {},
    });
    detach();
    const res = await rawRequest({ port: port() }, 'GET', '/detach/tmp', {});
    expect(res.status).toBe(404);
  });

  it('单 * 路由吞一切（SPA fallback 承载位——根与深层路径皆达）', async () => {
    const detach = face.register({
      method: 'GET',
      path: '*',
      auth: { mode: 'open', purpose: 'static-shell' },
      handler: echoHandler(hits),
    });
    const root = await rawRequest({ port: port() }, 'GET', '/', {});
    const deep = await rawRequest({ port: port() }, 'GET', '/some/deep/path', {});
    detach();
    expect(root.status).toBe(200);
    expect(deep.status).toBe(200);
    expect(JSON.parse(deep.body).wildcard).toBe('some/deep/path');
  });

  /* ---------------- ③ gate 序倒转（回归锁——修复前必红） ---------------- */

  it('未匹配路径 404 免凭证（gate 序倒转——旧序 401；安全面行为变化显式锁）', async () => {
    const res = await rawRequest({ port: port() }, 'GET', '/nowhere', {});
    expect(res.status).toBe(404); // 旧序：gate 先行 → 401
  });

  it('未匹配路径免 Host 防线（防线不执法于未注册路径）', async () => {
    const res = await rawRequest(
      { port: port(), host: '127.0.0.1' },
      'GET',
      '/nowhere',
      { host: 'evil.example.com' }, // 坏 Host + 未匹配
    );
    expect(res.status).toBe(404); // 非旧序 403
  });

  /* ---------------- ④ 鉴权档四值 + 面级防线 ---------------- */

  it('token 档：无凭证 401 / 错 token 401 / Bearer 实效过（verifyToken 常时比对）', async () => {
    const detach = face.register({
      method: 'GET',
      path: '/api/secured',
      auth: 'token',
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      },
    });
    const none = await rawRequest({ port: port() }, 'GET', '/api/secured', {});
    expect(none.status).toBe(401);
    const wrong = await rawRequest({ port: port() }, 'GET', '/api/secured', { authorization: 'Bearer deadbeef' });
    expect(wrong.status).toBe(401);
    const ok = await rawRequest({ port: port() }, 'GET', '/api/secured', { authorization: `Bearer ${face.token}` });
    expect(ok.status).toBe(200);
    detach();
  });

  it('token-or-cookie 档：Bearer ∪ cookie 双通道、双缺席 401（EventSource 无 Authorization 位）', async () => {
    const detach = face.register({
      method: 'GET',
      path: '/api/dual',
      auth: { mode: 'token-or-cookie', cookie: 'webui_token' },
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      },
    });
    const bearer = await rawRequest({ port: port() }, 'GET', '/api/dual', { authorization: `Bearer ${face.token}` });
    expect(bearer.status).toBe(200);
    const cookie = await rawRequest({ port: port() }, 'GET', '/api/dual', { cookie: `webui_token=${face.token}` });
    expect(cookie.status).toBe(200);
    const none = await rawRequest({ port: port() }, 'GET', '/api/dual', {});
    expect(none.status).toBe(401);
    detach();
  });

  it('open 档与 self 档：无凭证可达 handler（self = 件侧自验语义——只跳 token 闸）', async () => {
    const detachOpen = face.register({
      method: 'GET',
      path: '/api/health',
      auth: { mode: 'open', purpose: 'liveness' },
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      },
    });
    const detachSelf = face.register({
      method: 'POST',
      path: '/hooks/issue',
      auth: 'self',
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      },
    });
    const health = await rawRequest({ port: port() }, 'GET', '/api/health', {});
    expect(health.status).toBe(200);
    const hook = await rawRequest({ port: port() }, 'POST', '/hooks/issue', {});
    expect(hook.status).toBe(200);
    detachOpen();
    detachSelf();
  });

  it('Host 防线面级先行适用于一切路由（open 档坏 Host 同拒 403）', async () => {
    const res = await rawRequest({ port: port(), host: '127.0.0.1' }, 'GET', '/api/echo/x', {
      host: 'evil.example.com',
    });
    expect(res.status).toBe(403);
    expect(hits).toHaveLength(0); // 防线拒于 handler 前
  });

  it('Origin 同源判定用实绑口（port 0 内核指派后回填——配置口 0 不入判据）', async () => {
    // 18a-2' webui 迁移揭出的 18a-1' 真缺陷回归锁：listenPort 曾恒为配置口
    // （port 0 形态同源 Origin 恒 403）；修前必红——实绑口回填后同源过
    const res = await rawRequest({ port: port() }, 'GET', '/api/echo/x', {
      host: '127.0.0.1',
      origin: `http://127.0.0.1:${port()}`,
    });
    expect(res.status).toBe(200);
    expect(hits).toHaveLength(1); // 同源过防线达 handler
  });

  /* ---------------- ⑥ helper 三件 + isClosed ---------------- */

  it('ctx.readBody：per-route 帽超限 413 且应答不早于体收完（排空纪律——无 RST 连坐）', async () => {
    const detach = face.register({
      method: 'POST',
      path: '/api/payload',
      auth: { mode: 'open', purpose: 'static-shell' },
      bodyLimitBytes: 64,
      handler: async (req, res, ctx) => {
        const body = await ctx.readBody(req);
        res.writeHead(body.ok ? 200 : body.status);
        res.end(body.ok ? body.body : body.message);
      },
    });
    // 分块发送 300B（帽 64B）：第二块写入不被 RST 打断、应答 413 且正文收尽
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest(
        { port: port(), host: '127.0.0.1', method: 'POST', path: '/api/payload', headers: { 'content-length': '300' } },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0 }));
        },
      );
      req.on('error', reject);
      req.write('a'.repeat(100));
      req.write('b'.repeat(200));
      req.end();
    });
    expect(res.status).toBe(413);
    detach();
  });

  it('ctx.verifyToken：实效 true / 错 false（面 token 唯一验换位）', async () => {
    const detach = face.register({
      method: 'GET',
      path: '/api/verify',
      auth: { mode: 'open', purpose: 'static-shell' },
      handler: (_req, res, ctx) => {
        res.writeHead(200);
        res.end(JSON.stringify({ yes: ctx.verifyToken(face.token), no: ctx.verifyToken('deadbeef') }));
      },
    });
    const res = await rawRequest({ port: port() }, 'GET', '/api/verify', {});
    expect(JSON.parse(res.body)).toEqual({ yes: true, no: false });
    detach();
  });

  it('ctx.openSse：帧形 data: 单行 JSON + 面级 ping/看门狗基建 + stop 全流收口', async () => {
    const detach = face.register({
      method: 'GET',
      path: '/api/stream',
      auth: { mode: 'open', purpose: 'static-shell' },
      handler: (_req, res, ctx) => {
        const stream = ctx.openSse(res);
        stream.write({ kind: 'hello', n: 1 });
      },
    });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port()}/api/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // 读首帧：`data: {"kind":"hello","n":1}\n\n` 单行合成钉死
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const idx = buffer.indexOf('\n\n');
      if (idx !== -1) {
        expect(buffer.slice(0, idx)).toBe('data: {"kind":"hello","n":1}');
        break;
      }
    }
    // 宿主 stop 收口：流随面收场终结（EOF）
    await face.stop();
    const { done } = await reader.read();
    expect(done).toBe(true);
    controller.abort();
    detach();
  });

  it('ctx.openSse 零首帧静默流：头即达不挂起（flushHeaders——webui events 静默流消费位）', async () => {
    // 18a-2' webui 迁移揭出的 18a-1' 真缺陷回归锁：writeHead 后头缓到首写
    // 才发（/v1/events 有 hello 首帧掩蔽；静默流头挂到 30s ping）；修前必红
    const detach = face.register({
      method: 'GET',
      path: '/api/silent-stream',
      auth: { mode: 'open', purpose: 'static-shell' },
      handler: (_req, res, ctx) => {
        ctx.openSse(res); // 开流零写——头必须独立于首帧达客户端
      },
    });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port()}/api/silent-stream`, { signal: controller.signal });
    expect(res.status).toBe(200); // fetch 头到位 = flushHeaders 兑现
    controller.abort();
    detach();
  });

  it('isClosed 后扩展路由 503 同律（新请求一律拒服务——含 open 档）', async () => {
    await face.core.close();
    const res = await rawRequest({ port: port() }, 'GET', '/api/echo/x', {});
    expect(res.status).toBe(503);
    expect(hits).toHaveLength(0);
  });

  /* ---------------- 多监听并存 ---------------- */

  it('sock 缺省 + TCP 单形起面（socketPath 可选化）；SdkListenInfo.tcp 数组形', async () => {
    const bare = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } }, // 无 socketPath
      bridge: makeBridge(),
    });
    const bareInfo = await bare.start();
    expect(bareInfo.socketPath).toBeUndefined();
    expect(bareInfo.tcp).toHaveLength(1);
    // sock 缺席位不残留未定义行为：直接请求 TCP 面可达
    const res = await fetch(`http://127.0.0.1:${bareInfo.tcp[0]!.port}/v1/sessions`, {
      headers: { authorization: `Bearer ${bare.token}`, 'x-sdk-protocol': '1' },
    });
    expect(res.status).toBe(200);
    await bare.stop();
  });

  it('TCP×N 多监听并存（数组形）——双 port 皆可达；loopbackOnly 挂载规则随监听器分账', async () => {
    const warnings2: string[] = [];
    const multi = createSdkHttpFace({
      config: {
        tcp: [
          { host: '127.0.0.1', port: 0 },
          { host: '127.0.0.1', port: 0 },
        ],
      },
      bridge: makeBridge(),
      routes: [
        {
          method: 'GET',
          path: '/api/lb',
          auth: { mode: 'open', purpose: 'static-shell' },
          loopbackOnly: true,
          handler: (_r, s) => {
            s.writeHead(200);
            s.end('ok');
          },
        },
      ],
      warn: (m) => warnings2.push(m),
    });
    const multiInfo = await multi.start();
    expect(multiInfo.tcp).toHaveLength(2);
    for (const t of multiInfo.tcp) {
      const res = await fetch(`http://${t.host}:${t.port}/api/lb`);
      expect(res.status).toBe(200); // 回环 TCP 挂全路由
    }
    await multi.stop();
  });

  it('loopbackOnly 路由：非回环 TCP 不挂载 404 同未注册 + start warn；同面非 loop 路由可达', async () => {
    // 非回环必配凭证（judgeListenConfig fail-closed）——token 注入起面
    const remote = createSdkHttpFace({
      config: { tcp: { host: '0.0.0.0', port: 0 }, token: 'preset-token-1' },
      bridge: makeBridge(),
      routes: [
        {
          method: 'GET',
          path: '/api/lb',
          auth: 'token',
          loopbackOnly: true,
          handler: (_r, s) => {
            s.writeHead(200);
            s.end('lb');
          },
        },
        {
          method: 'GET',
          path: '/api/open-any',
          auth: 'token',
          handler: (_r, s) => {
            s.writeHead(200);
            s.end('any');
          },
        },
      ],
      warn: (m) => warnings.push(m),
    });
    const remoteInfo = await remote.start();
    const base = { authorization: 'Bearer preset-token-1' };
    // 0.0.0.0 绑定非回环 host——loopbackOnly 不挂载；显式 host 0.0.0.0（node 客户端
    // 缺省 localhost Host 会撞非回环绑定的 Host 防线——本例测挂载规则非防线）
    const lb = await rawRequest({ port: remoteInfo.tcp[0]!.port, host: '0.0.0.0' }, 'GET', '/api/lb', base);
    expect(lb.status).toBe(404);
    const any = await rawRequest({ port: remoteInfo.tcp[0]!.port, host: '0.0.0.0' }, 'GET', '/api/open-any', base);
    expect(any.status).toBe(200);
    expect(warnings.some((w) => w.includes('loopbackOnly'))).toBe(true);
    await remote.stop();
  });

  /* ---------- ⑦ flaky 真案锁（连接 host family 钉死——2026-09-15 收口） ---------- */

  it('v6 同号端口占用者不劫持：连接 host 缺省钉 127.0.0.1 字面（403 劫持真案锁）', async ({ skip }) => {
    // 真案（2026-09-15 四问评估 verify 干净 clone 全量 1/20）：「未匹配路径 404
    // 免凭证」404 断言得 403。根因 = 三条件撞号，缺一不触发——
    // ①本机存在 [::1] 回环占用者钉在瞬态端口范围内（实证 Sangfor O+Connect
    //   [::1]:64000——对未知路径应 403；事发时 verify 日志里测试端口恰在
    //   63954-64049 邻域扫过）；
    // ②测试面 port:0 内核指派端口号——v4 侧与 [::1]:Q 跨族不冲突，同号并存
    //   可成立（本锁第一断言面：pinned face 在 127.0.0.1:Q 起面成功即实证裂缝）；
    // ③裸请求连接 host 缺省 = node 的 localhost——本机解析序 ::1 先行（dns.lookup
    //   实测 [::1, 127.0.0.1]），::1 先试即被劫持。
    // 修法 = rawRequest 缺省连接 host 钉 v4 字面（family 二义闭死，恒达本面）；
    // 本锁锁修后契约。v6 回环不可用 / 跨族同号并存被平台拒的环境：劫持面
    // 在该环境结构性不存在，退位跳过（skip 理由明示）。
    const squatter = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('squatter-mark');
    });
    const squatted = await new Promise<{ ok: true; port: number } | { ok: false }>((resolve) => {
      squatter.once('error', () => resolve({ ok: false }));
      squatter.listen(0, '::1', () => {
        const addr = squatter.address();
        resolve(typeof addr === 'object' && addr !== null ? { ok: true, port: addr.port } : { ok: false });
      });
    });
    if (!squatted.ok) {
      skip('v6 回环 [::1] 不可用——同号劫持面在本环境不存在，锁退位');
      return;
    }
    const q = squatted.port;
    let pinned: SdkHttpFaceHandle;
    try {
      pinned = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: q } }, bridge: makeBridge() });
      await pinned.start(); // 与 [::1]:Q 同号 v4 起面成功 = 跨族并存裂缝实证
    } catch (err) {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        skip('v4 同号并存被平台拒（EADDRINUSE）——劫持裂缝在本环境不存在，锁退位');
        return;
      }
      throw err;
    }
    try {
      // 修后契约：缺省连接 host = 127.0.0.1 字面——无 family 二义恒达本面
      const res = await rawRequest({ port: q }, 'GET', '/nowhere', {});
      expect(res.status).toBe(404); // 被劫持形 = 占位者 403
      expect(res.body).toBe('not found'); // 本面 404 词面（占位者词面 squatter-mark）
    } finally {
      await pinned.stop();
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });
});
