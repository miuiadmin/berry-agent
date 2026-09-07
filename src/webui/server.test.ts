/**
 * webui/server 传输面集成测试（批 18a-1；批 18a-2' 改形迁移——承载位改
 * 注册 sdk 路由扩展位）。
 *
 * 全环真监听（127.0.0.1 实配 TCP；port 0 由内核指派）——fetch / node:http
 * 真请求；注入面全桩（mock 只停在注入位）。装配形 = **面注册器直注互证**：
 * createSdkHttpFace 起真面 + mountWebui({...deps, register: face.register})
 * ——WebuiRouteDescriptor → SdkRouteDescriptor 方向性结构兼容（03 §10.4
 * 改形注⑤词面独立律）经真请求链双向互证（tests 不计边表账）。
 *
 * 改形断言面收窄注记（面级接管位）：三防线 403/鉴权 401 应答改面级 plain
 * text（原 JSON error 形）——Host/Origin 例只断状态码；in-handler 错误
 * （not_found/closed/too_large/overloaded/no_spa/bad_request）仍 JSON 形
 * 断言不变。锁八面——
 * ①三防线执法序（Host 403 / Origin 403·无 Origin 放行·同源过——面级先行）
 * ②鉴权门（无凭证/错 token 401 / Bearer 过 / auth cookie 桥 Set-Cookie 属性
 * 与 cookie 形复用）
 * ③微路由五撮（探活/会话族含 closed·missing 分账/补全族缺席诚实空）
 * ④体限幅 413 且应答不早于收完（排空后应答——拿到应答即证无 RST 连坐）
 * ⑤SSE 信封分档（display 活体 / session 终结镜像 / asked 镜像）与按会话
 * 路由（status 定向 / notify 广播）
 * ⑥跨入口审批全环（ask → approvals 清单 → decide applied → 再 decide
 * superseded → 清单出清；abort 撤销清槽；未知 id superseded）
 * ⑦连接帽 503 / 静态面（index/内容型/SPA fallback/穿越拒/未装配 404）
 * ⑧收场丢弃性结算（未决 ask 不 resolve——行回卷语义；监听关停归面）
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace, type SdkHttpFaceHandle } from '../sdk/http.js';
import type { SdkHttpBridge } from '../sdk/types.js';
import type { AgentMessage } from '../contracts/index.js';
import type { SessionEnvelope } from '../channels/index.js';
import type {
  WebuiDeps,
  WebuiEnvelope,
  WebuiMountHandle,
  WebuiMountOptions,
  WebuiSessionState,
  WebuiSubmitInput,
} from './index.js';
import { mountWebui } from './server.js';

/* ---------------- 注入面桩（装配桥最小同构） ---------------- */

/** 会话族/读面桩台账 */
interface DepsStub {
  readonly deps: WebuiDeps;
  readonly submitted: WebuiSubmitInput[];
  readonly interrupted: string[];
  readonly created: string[];
  setSession(sessionId: string, state: WebuiSessionState): void;
}

function makeDeps(opts?: { readonly withoutTodo?: boolean; readonly withoutCompletion?: boolean }): DepsStub {
  const states = new Map<string, WebuiSessionState>([
    ['s-1', 'open'],
    ['s-closed', 'closed'],
  ]);
  const messages = new Map<string, AgentMessage[]>([
    ['s-1', [{ role: 'user', content: '问', timestamp: 1_690_000_000_000 }]],
    ['s-closed', [{ role: 'user', content: '旧账', timestamp: 1_680_000_000_000 }]],
  ]);
  const submitted: WebuiSubmitInput[] = [];
  const interrupted: string[] = [];
  const created: string[] = [];
  let seq = 0;
  const deps: WebuiDeps = {
    sessions: {
      createSession: () => {
        const id = `s-new-${++seq}`;
        created.push(id);
        states.set(id, 'open');
        return id;
      },
      listSessions: () => [{ id: 's-1', title: null, lastActivityAt: 1_690_000_000_001 }],
      sessionStateOf: (id) => states.get(id) ?? 'missing',
      submitPrompt: (input) => {
        submitted.push(input);
        return { sessionId: input.sessionId };
      },
      interruptSession: (id) => {
        interrupted.push(id);
      },
    },
    read: {
      fetchMessages: async (id) => messages.get(id) ?? [],
      ...(opts?.withoutTodo === true ? {} : { todoOf: () => [{ status: 'in-progress', content: '跑测' }] }),
    },
    ...(opts?.withoutCompletion === true ? {} : { completion: { workspaceFiles: (q) => [`a/${q}.ts`] } }),
  };
  return {
    deps,
    submitted,
    interrupted,
    created,
    setSession: (id, state) => {
      if (state === 'missing') states.delete(id);
      else states.set(id, state);
    },
  };
}

/** sdk 面桥桩最小同构（webui 全族走扩展路由不触核——八面惰性桩） */
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

/* ---------------- SSE 读取腿（后台泵 + 顺序 next；ping 注释行天然跳过） ---------------- */

interface SseReader {
  next(): Promise<WebuiEnvelope | undefined>;
  abort(): void;
}

async function openSse(port: number, sessionId: string, token: string): Promise<SseReader> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const pending: WebuiEnvelope[] = [];
  const waiters: Array<(frame: WebuiEnvelope | undefined) => void> = [];
  let buffer = '';
  let done = false;
  (async (): Promise<void> => {
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) break;
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine === undefined) continue; // ping 注释行
          pending.push(JSON.parse(dataLine.slice(6)) as WebuiEnvelope);
          const waiter = waiters.shift();
          if (waiter !== undefined) waiter(pending.pop());
        }
      }
    } catch {
      // abort 收线——泵终止
    }
    done = true;
    for (const waiter of waiters.splice(0)) waiter(undefined);
  })();
  const next = (): Promise<WebuiEnvelope | undefined> =>
    new Promise((resolve) => {
      const frame = pending.shift();
      if (frame !== undefined || done) {
        resolve(frame);
        return;
      }
      waiters.push(resolve);
      setTimeout(() => {
        const at = waiters.indexOf(resolve);
        if (at !== -1) {
          waiters.splice(at, 1);
          resolve(undefined);
        }
      }, 2_000);
    });
  return { next, abort: () => controller.abort() };
}

/** 静默断言腿（「不该来的帧」——足额等 reader 自带 2s 静默窗：竞态短窗的
 * 残留 waiter 会偷走后续帧，静默断言必须等窗自尽） */
async function expectSilence(reader: SseReader): Promise<void> {
  expect(await reader.next()).toBeUndefined();
}

/** node:http 裸请求（Host/Origin/cookie 防线测试位——fetch 禁改受限头） */
function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

describe('webui/server 传输面（微路由 + SSE + 跨入口审批）', () => {
  let face: SdkHttpFaceHandle | undefined;
  let webui: WebuiMountHandle | undefined;
  let stub: DepsStub;
  let port: number;
  let token: string;
  let dir: string | undefined;

  /** 单装配（面注册器直注——结构兼容互证位） */
  const rig = async (
    deps: WebuiDeps,
    mount?: WebuiMountOptions,
  ): Promise<{ face: SdkHttpFaceHandle; webui: WebuiMountHandle; port: number; token: string }> => {
    const f = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    // face.register（SdkRouteRegistrar）直注 WebuiMountDeps.register——
    // 方向性结构兼容（WebuiRouteDescriptor 可赋值 SdkRouteDescriptor）
    const w = mountWebui({ ...deps, register: f.register }, mount);
    const info = await f.start();
    return { face: f, webui: w, port: info.tcp[0]!.port, token: f.token };
  };

  const boot = async (opts?: {
    readonly extraDeps?: Pick<WebuiDeps, 'staticDir'>;
    readonly mount?: WebuiMountOptions;
    readonly stubOpts?: Parameters<typeof makeDeps>[0];
  }): Promise<void> => {
    // 重启面（静态面在场例）：先收口旧面——监听不泄漏
    if (face !== undefined) {
      webui?.detach();
      await face.stop();
    }
    stub = makeDeps(opts?.stubOpts);
    const r = await rig({ ...stub.deps, ...opts?.extraDeps }, opts?.mount);
    face = r.face;
    webui = r.webui;
    port = r.port;
    token = r.token;
  };

  beforeEach(async () => {
    await boot();
  });

  afterEach(async () => {
    webui?.detach();
    await face?.stop();
    face = undefined;
    webui = undefined;
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  /** 公共头（Bearer 鉴权形） */
  const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...extra,
  });

  /** 能力位解包腿（capabilities 自报真后直用——消费面与核同律；focused 位
   * webui 实装忽略、测试恒传 false 走核标准形） */
  const pushEnvelope = (env: SessionEnvelope): void => webui!.backend.onEnvelope!(env, false);

  const get = async (
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: authHeaders(headers) });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: authHeaders(headers),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  /* ---- ① 三防线（面级先行——403 应答为面级 plain text，断状态码） ---- */

  it('探活开面：GET /api/health 无鉴权 200 只回 ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('Host 防线：非回环 Host 403（DNS rebinding 面——面级 plain text 应答）', async () => {
    const r = await rawRequest(port, '/api/health', { host: 'evil.example.com' });
    expect(r.status).toBe(403);
  });

  it('Origin 硬防线：异源 403 / 无 Origin 放行 / 同源过', async () => {
    expect(
      (await rawRequest(port, '/api/health', { host: '127.0.0.1', origin: 'http://evil.example.com' })).status,
    ).toBe(403);
    expect((await rawRequest(port, '/api/health', { host: '127.0.0.1' })).status).toBe(200);
    expect(
      (await rawRequest(port, '/api/health', { host: '127.0.0.1', origin: `http://127.0.0.1:${port}` })).status,
    ).toBe(200);
  });

  /* ---- ② 鉴权门与 cookie 桥 ---- */

  it('鉴权门：/api/* 无凭证 401 / 错 token 401 / Bearer 实效过', async () => {
    const none = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    expect(none.status).toBe(401);
    const wrong = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { authorization: 'Bearer deadbeef' },
    });
    expect(wrong.status).toBe(401);
    expect((await get('/api/sessions')).status).toBe(200);
  });

  it('auth cookie 桥：对 token → 204 + Set-Cookie 三属性；cookie 形复用过鉴权', async () => {
    const wrong = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'nope' }),
    });
    expect(wrong.status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('webui_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    // cookie 形复用（EventSource 无头位——桥的存在性证明）
    const viaCookie = await rawRequest(port, '/api/sessions', {
      host: '127.0.0.1',
      cookie: `webui_token=${token}`,
    });
    expect(viaCookie.status).toBe(200);
  });

  it('体校验：auth 体缺 token 400（typebox 收窄律——未知字段拒收）', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tok: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  /* ---- ③ 微路由会话族 ---- */

  it('sessions：GET 清单 / POST 开新（受理入桩记账）', async () => {
    const list = await get('/api/sessions');
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ sessions: [{ id: 's-1', title: null, lastActivityAt: 1_690_000_000_001 }] });
    const created = await post('/api/sessions', {});
    expect(created.status).toBe(200);
    expect((created.json as { sessionId: string }).sessionId).toBe('s-new-1');
    expect(stub.created).toEqual(['s-new-1']);
  });

  it('messages：投影拉取；closed 会话兜底可拉（只读不受闭态拦）', async () => {
    const open = await get('/api/sessions/s-1/messages');
    expect(open.status).toBe(200);
    expect((open.json as { messages: AgentMessage[] }).messages).toHaveLength(1);
    const closed = await get('/api/sessions/s-closed/messages');
    expect(closed.status).toBe(200);
    expect((closed.json as { messages: AgentMessage[] }).messages[0]).toMatchObject({ role: 'user' });
  });

  it('todo：数据源在场回条目；缺席诚实回 null', async () => {
    const withFace = await get('/api/sessions/s-1/todo');
    expect(withFace.status).toBe(200);
    expect((withFace.json as { items: unknown[] }).items).toEqual([{ status: 'in-progress', content: '跑测' }]);
    // 缺席面：重建一无 todoOf 的装配
    const bare = await rig(makeDeps({ withoutTodo: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/todo`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: null });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('submit：受理 200 + messageId 缺席服务端生成 / 显式透传', async () => {
    const noId = await post('/api/sessions/s-1/submit', { text: '问' });
    expect(noId.status).toBe(200);
    expect(noId.json).toEqual({ sessionId: 's-1' });
    const withId = await post('/api/sessions/s-1/submit', { text: '再问', messageId: 'm-spa-1' });
    expect(withId.status).toBe(200);
    expect(stub.submitted).toEqual([
      { sessionId: 's-1', content: '问', messageId: 'webui-1' },
      { sessionId: 's-1', content: '再问', messageId: 'm-spa-1' },
    ]);
  });

  it('submit 体校验：缺 text / 未知字段 → 400', async () => {
    expect((await post('/api/sessions/s-1/submit', { content: 'x' })).status).toBe(400);
    expect((await post('/api/sessions/s-1/submit', { text: 'x', extra: 1 })).status).toBe(400);
    // 坏 JSON 同档
    const bad = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/submit`, {
      method: 'POST',
      headers: authHeaders(),
      body: 'not-json',
    });
    expect(bad.status).toBe(400);
  });

  it('interrupt：204 + 受理记账', async () => {
    const r = await post('/api/sessions/s-1/interrupt', {});
    expect(r.status).toBe(204);
    expect(r.json).toBeNull();
    expect(stub.interrupted).toEqual(['s-1']);
  });

  it('会话存在性分账：missing submit/events 404 not_found；closed submit 404 closed', async () => {
    const missingSubmit = await post('/api/sessions/nope/submit', { text: 'x' });
    expect(missingSubmit.status).toBe(404);
    expect(missingSubmit.json).toMatchObject({ error: 'not_found' });
    const missingEvents = await get('/api/sessions/nope/events');
    expect(missingEvents.status).toBe(404);
    const closedSubmit = await post('/api/sessions/s-closed/submit', { text: 'x' });
    expect(closedSubmit.status).toBe(404);
    expect(closedSubmit.json).toMatchObject({ error: 'closed' });
  });

  it('补全族：在场回注入面条目；缺席诚实空', async () => {
    const files = await get('/api/workspace/files?q=src');
    expect(files.status).toBe(200);
    expect(files.json).toEqual({ items: ['a/src.ts'] });
    const bare = await rig(makeDeps({ withoutCompletion: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/workspace/symbols?q=x`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('/api 兜底：未知 API 路径过鉴权门后 404 JSON（防 SPA fallback 吞程序面错路）', async () => {
    const unknown = await get('/api/who-knows');
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ error: 'not_found' });
    // 鉴权先行语义维持：无凭证 401（先过门再 404）
    const anon = await fetch(`http://127.0.0.1:${port}/api/who-knows`);
    expect(anon.status).toBe(401);
  });

  /* ---- ④ 体限幅 ---- */

  it('POST 体超帽 413 且应答不早于收完（拿到应答即证排空后回——无 RST 连坐）', async () => {
    const bare = await rig(stub.deps, { bodyLimitBytes: 32 });
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bare.token}`,
        },
        body: JSON.stringify({ text: 'x'.repeat(200) }),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'too_large' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  /* ---- ⑤ SSE 信封分档与路由 ---- */

  it('SSE 分档：update 走 display 族 / 终结型走 session 族（帧序保持）', async () => {
    const reader = await openSse(port, 's-1', token);
    try {
      pushEnvelope({ sessionId: 's-1', event: { type: 'message_start', role: 'assistant' } });
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'message_update', role: 'assistant', partial: { role: 'user', content: '部分', timestamp: 1 } },
      });
      pushEnvelope({
        sessionId: 's-1',
        event: {
          type: 'message_end',
          message: { role: 'user', content: '完', timestamp: 2 },
        },
      });
      const f1 = await reader.next();
      expect(f1).toMatchObject({ kind: 'display', sessionId: 's-1' });
      expect((f1 as { payload: { type: string } }).payload.type).toBe('message_start');
      const f2 = await reader.next();
      expect(f2?.kind).toBe('display');
      const f3 = await reader.next();
      expect(f3).toMatchObject({ kind: 'session', sessionId: 's-1' });
      expect((f3 as { payload: { type: string } }).payload.type).toBe('message_end');
      await expectSilence(reader);
    } finally {
      reader.abort();
    }
  });

  it('status 定向：只达订阅会话的流；notify 广播：全流皆达', async () => {
    const r1 = await openSse(port, 's-1', token);
    const r2 = await openSse(port, 's-closed', token);
    try {
      webui!.backend.setStatus!('s-1', '跑测中');
      const f1 = await r1.next();
      expect(f1).toEqual({ kind: 'status', sessionId: 's-1', payload: { status: '跑测中' } });
      await expectSilence(r2);
      webui!.backend.notify('你好', { level: 'info' });
      expect(await r1.next()).toMatchObject({ kind: 'notify' });
      expect(await r2.next()).toMatchObject({ kind: 'notify', payload: { message: '你好', level: 'info' } });
    } finally {
      r1.abort();
      r2.abort();
    }
  });

  it('未订阅会话零扇出（pushToSession 空索引短路——无观众不炸）', async () => {
    webui!.backend.setStatus!('s-1', '无人看');
    pushEnvelope({
      sessionId: 's-1',
      event: { type: 'message_start', role: 'assistant' },
    });
    webui!.backend.notify('无人听');
    expect(webui!.backend.hasAudience()).toBe(false);
  });

  /* ---- ⑥ 跨入口审批全环 ---- */

  it('审批全环：ask 镜像 → 清单 → decide applied → ask 落值 → 再 decide superseded → 清单出清', async () => {
    const reader = await openSse(port, 's-1', token);
    try {
      const asked = webui!.backend.askApproval!('s-1', { summary: '装插件 X', reason: '外部源' });
      // asked 镜像走 session 族（零新词汇——payload 复用 durable approval/asked 形）
      const mirror = await reader.next();
      expect(mirror?.kind).toBe('session');
      expect(mirror).toMatchObject({
        sessionId: 's-1',
        payload: { type: 'approval/asked', summary: '装插件 X', reason: '外部源' },
      });
      const approvalId = (mirror as { payload: { approvalId: string } }).payload.approvalId;
      expect(approvalId).toMatch(/^webui-\d+$/);
      // 清单投影
      const list = await get('/api/approvals');
      expect(list.json).toMatchObject({
        approvals: [{ approvalId, sessionId: 's-1', summary: '装插件 X', reason: '外部源' }],
      });
      // sessionId 过滤
      const filtered = await get('/api/approvals?sessionId=s-other');
      expect((filtered.json as { approvals: unknown[] }).approvals).toEqual([]);
      // decide：先到 applied
      const first = await post(`/api/approvals/${approvalId}/decide`, { answer: 'approve', note: '可以' });
      expect(first.status).toBe(200);
      expect(first.json).toEqual({ outcome: 'applied' });
      await expect(asked).resolves.toBe('approve');
      // 后到 superseded（幂等回执——先答先得）
      const second = await post(`/api/approvals/${approvalId}/decide`, { answer: 'reject' });
      expect(second.json).toEqual({ outcome: 'superseded' });
      // 清单出清
      const cleared = await get('/api/approvals');
      expect((cleared.json as { approvals: unknown[] }).approvals).toEqual([]);
    } finally {
      reader.abort();
    }
  });

  it('审批撤销：signal abort → ask 落 cancel + 清单出清；已决后迟到 abort 是 no-op', async () => {
    const reader = await openSse(port, 's-1', token);
    try {
      const controller = new AbortController();
      const asked = webui!.backend.askApproval!('s-1', { summary: '装 Y' }, { signal: controller.signal });
      const mirror = (await reader.next()) as { payload: { approvalId: string } };
      expect(mirror.payload.approvalId).toMatch(/^webui-\d+$/);
      controller.abort();
      await expect(asked).resolves.toBe('cancel');
      const afterAbort = await get('/api/approvals');
      expect((afterAbort.json as { approvals: unknown[] }).approvals).toEqual([]);
      // 已决后迟到 abort：ask 已落值不再改判
      const asked2 = webui!.backend.askApproval!('s-1', { summary: '装 Z' });
      const mirror2 = (await reader.next()) as { payload: { approvalId: string } };
      await post(`/api/approvals/${mirror2.payload.approvalId}/decide`, { answer: 'reject' });
      await expect(asked2).resolves.toBe('reject');
      expect(asked2).resolves.not.toBe('cancel');
    } finally {
      reader.abort();
    }
  });

  it('decide 未知 approvalId → superseded（幂等回执不造值）', async () => {
    const r = await post('/api/approvals/ghost/decide', { answer: 'approve' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ outcome: 'superseded' });
  });

  it('decide 体校验：answer 闭集外 → 400', async () => {
    expect((await post('/api/approvals/ghost/decide', { answer: 'maybe' })).status).toBe(400);
  });

  /* ---- ⑦ 连接帽与静态面 ---- */

  it('SSE 连接帽：超帽新连接 503 overloaded', async () => {
    const bare = await rig(stub.deps, { maxConnections: 1 });
    try {
      const r1 = await openSse(bare.port, 's-1', bare.token);
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/events`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'overloaded' });
      r1.abort();
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('静态面缺席（API-only 形）：GET / 404 no_spa', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'no_spa' });
  });

  it('静态面在场：index/内容型/SPA fallback/穿越拒', async () => {
    dir = await mkdtemp(join(tmpdir(), 'webui-spa-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>测</title>', 'utf8');
    await writeFile(join(dir, 'app.js'), 'console.log(1)', 'utf8');
    await boot({ extraDeps: { staticDir: dir } });
    const index = await fetch(`http://127.0.0.1:${port}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    const js = await fetch(`http://127.0.0.1:${port}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    // SPA fallback：未知深路径回 index.html（前端路由接管）
    const deep = await fetch(`http://127.0.0.1:${port}/some/deep/route`);
    expect(deep.status).toBe(200);
    expect(deep.headers.get('content-type')).toContain('text/html');
    // 路径穿越：编码形出根即拒（403 forbidden）
    const escape = await rawRequest(port, '/..%2F..%2Fetc%2Fpasswd', { host: '127.0.0.1' });
    expect(escape.status).toBe(403);
  });

  /* ---- ⑧ 收场丢弃性结算 ---- */

  it('收场：未决 ask 不 resolve（行回卷丢弃性）+ 监听归零（面收口）', async () => {
    const asked = webui!.backend.askApproval!('s-1', { summary: '悬而未决' });
    const reader = await openSse(port, 's-1', token);
    webui!.detach();
    await face!.stop();
    face = undefined; // afterEach 不再二次 stop（幂等亦无害，示洁）
    const settled = await Promise.race([
      asked.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 150)),
    ]);
    expect(settled).toBe(false); // 丢弃性结算——清槽不造值
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    reader.abort();
  });
});
