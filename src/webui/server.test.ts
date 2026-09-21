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
 * ③微路由五撮（探活/会话族含 closed·missing 分账/补全族缺席诚实空；/export
 *   markdown 直出三态——2026-09-17 TUI 余量收官批②；档位面三端点——2026-09-18
 *   webui 档位面受理批：501 判先于会话态 404 / GET 全形状含无锚 null 形 /
 *   fold 坏词面级 500 / PUT 坏词 400 码族词面 / 体帽显式 256KiB 位）
 * ④体限幅 413 且应答不早于收完（排空后应答——拿到应答即证无 RST 连坐）
 * ⑤SSE 信封分档（display 活体 / session 终结镜像 / asked 镜像）与按会话
 * 路由（status 定向 / notify 广播）
 * ⑥跨入口审批全环（ask → approvals 清单 → decide applied → 再 decide
 * superseded → 清单出清；abort 撤销清槽；未知 id superseded）
 * ⑦连接帽 503 / 静态面（index/内容型/SPA fallback/穿越拒/未装配 404）
 * ⑧收场丢弃性结算（未决 ask 不 resolve——行回卷语义；监听关停归面）
 * ⑨WEBUI_ENDPOINTS 双表对拍（客户端副本 vs 服务端单源整表恒等——词面单源执法）
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace, type SdkHttpFaceHandle } from '../sdk/http.js';
import type { SdkHttpBridge } from '../sdk/types.js';
import { BaseError } from '../contracts/index.js';
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
import { WEBUI_ENDPOINTS as WEBUI_ENDPOINTS_SERVER } from './types.js';
import { WEBUI_ENDPOINTS as WEBUI_ENDPOINTS_CLIENT } from './client/protocol.js';

/* ---------------- 注入面桩（装配桥最小同构） ---------------- */

/** 会话族/读面/档位面桩台账 */
interface DepsStub {
  readonly deps: WebuiDeps;
  readonly submitted: WebuiSubmitInput[];
  readonly interrupted: string[];
  readonly created: string[];
  /** 档位面 PUT 受理记账（thinking 侧——回执与坏词形的对拍锚） */
  readonly setLevels: Array<{ readonly sessionId: string; readonly level: string }>;
  /** 档位面 PUT 受理记账（sandbox 侧） */
  readonly setModes: Array<{ readonly sessionId: string; readonly mode: string }>;
  setSession(sessionId: string, state: WebuiSessionState): void;
}

function makeDeps(opts?: {
  readonly withoutTodo?: boolean;
  readonly withoutCompletion?: boolean;
  readonly withoutExport?: boolean;
  /** 档位面整面缺席（三端点 501 诚实缺席形） */
  readonly withoutTiers?: boolean;
  /** fold 坏词形（tiersOf 抛 BaseError——面级 500 路；冷读 CR-TIER-2 边缘三形之三） */
  readonly foldBadWord?: boolean;
  /** submit 幂等冲突形（桥 submitPrompt 抛 SDK_MESSAGE_CONFLICT——409 结构码路） */
  readonly conflictSubmit?: boolean;
}): DepsStub {
  const states = new Map<string, WebuiSessionState>([
    ['s-1', 'open'],
    ['s-closed', 'closed'],
    // 档位面专用：thinking 无锚形会话（fold 与 boot 均缺席 → GET tiers 应答
    // thinkingLevel: null——冷读 CR-TIER-2 边缘三形之二）
    ['s-noanchor', 'open'],
  ]);
  const messages = new Map<string, AgentMessage[]>([
    ['s-1', [{ role: 'user', content: '问', timestamp: 1_690_000_000_000 }]],
    ['s-closed', [{ role: 'user', content: '旧账', timestamp: 1_680_000_000_000 }]],
  ]);
  // /export markdown 直出桩（renderSessionMarkdown 产出形的最小同构——内容
  // 面为注入面 opaque，拼装单源对拍归 host 桥测试件）
  const markdowns = new Map<string, string>([
    ['s-1', '# 会话导出 `s-1`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n'],
    ['s-closed', '# 会话导出 `s-closed`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n'],
  ]);
  const submitted: WebuiSubmitInput[] = [];
  const interrupted: string[] = [];
  const created: string[] = [];
  const setLevels: Array<{ readonly sessionId: string; readonly level: string }> = [];
  const setModes: Array<{ readonly sessionId: string; readonly mode: string }> = [];
  let seq = 0;
  // 档位面桩（host 装配桥真身最小同构——2026-09-18 webui 档位面受理批）：
  // 词表 = 七档/三档词汇（词法面与 conversation/safety 单源同形）；detail 行
  // 文案透传（内容面为注入面 opaque，host 侧文案表对拍归 host 桥测试件——
  // danger 行锚钉死措辞以证透传保真）；坏词抛 BaseError 码族（conversation
  // append 面词法校验 fail-loud 同构——码面即 HTTP 应答 error 词对拍锚）
  const tierLevels: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  const tierModes: readonly string[] = ['read-only', 'workspace-write', 'danger'];
  const tiers = {
    tiersOf: (id: string) => {
      // fold 坏词形：上抛不静默吞（服务端不 catch——面级 500 路）
      if (opts?.foldBadWord === true) {
        throw new BaseError(
          'SANDBOX_MODE_INVALID',
          'sandbox/mode 事件档位非法："danger-full"（三档词汇：read-only / workspace-write / danger）',
        );
      }
      return {
        // s-noanchor = 无锚形会话（thinkingLevel: null——行集照常全量）
        thinkingLevel: id === 's-noanchor' ? null : 'medium',
        sandboxMode: 'workspace-write',
        thinkingLevels: tierLevels.map((level) => ({ level, detail: `thinking 档 ${level}` })),
        sandboxModes: tierModes.map((mode) => ({
          mode,
          // danger 行文案 = 07 §4.1 钉死措辞（透传保真锚——SPA 零硬编码）
          detail: mode === 'danger' ? '无沙箱——任何命令直跑宿主' : `sandbox 档 ${mode}`,
        })),
      };
    },
    setThinkingLevel: (id: string, level: string) => {
      if (!tierLevels.includes(level)) {
        throw new BaseError(
          'THINKING_LEVEL_INVALID',
          `thinking 档位非法：${JSON.stringify(level)}（七档词汇：off / minimal / low / medium / high / xhigh / max）`,
        );
      }
      setLevels.push({ sessionId: id, level });
      return `thinking 已切 ${level}——下一 run 起生效（档位是否生效随模型能力）`;
    },
    setSandboxMode: (id: string, mode: string) => {
      if (!tierModes.includes(mode)) {
        throw new BaseError(
          'SANDBOX_MODE_INVALID',
          `sandbox 档位非法：${JSON.stringify(mode)}（三档词汇：read-only / workspace-write / danger）`,
        );
      }
      setModes.push({ sessionId: id, mode });
      return `sandbox 已切 ${mode}——即刻生效于后续工具调用`;
    },
  };
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
        // 幂等冲突形：同 messageId 异内容时桥 fail-loud 抛（admit 判据族与
        // SDK 线同源——0dcf5c9 接线）；HTTP 面应折 409 结构码而非面级 500
        if (opts?.conflictSubmit === true) {
          throw new BaseError('SDK_MESSAGE_CONFLICT', `messageId=${input.messageId} 同键异内容（幂等 admit 冲突档）`);
        }
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
      ...(opts?.withoutExport === true ? {} : { exportMarkdown: (id: string) => markdowns.get(id) }),
    },
    ...(opts?.withoutCompletion === true ? {} : { completion: { workspaceFiles: (q) => [`a/${q}.ts`] } }),
    // 档位面注入（缺席 = 三端点 501 诚实缺席——exportMarkdown 缺席同精神）
    ...(opts?.withoutTiers === true ? {} : { tiers }),
  };
  return {
    deps,
    submitted,
    interrupted,
    created,
    setLevels,
    setModes,
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

  /** PUT 腿（档位面两切档端点专用——体校验/回执对拍与 get/post 同形） */
  const put = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'PUT',
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

  it('export：markdown 直出三态——open 200（Content-Type 精确值）/ missing 404 not_found / closed 近史兜底 200', async () => {
    // open 会话：markdown 正文直出（不落盘——web 面消费语义 = 浏览器/curl 直接取文）
    const open = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export`, { headers: authHeaders() });
    expect(open.status).toBe(200);
    expect(open.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await open.text()).toBe('# 会话导出 `s-1`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n');
    // 缺席 404（error 词 not_found 同族；message 与 /api 兜底的「未知 API 路由」分立——锚真身非兜底）
    const missing = await fetch(`http://127.0.0.1:${port}/api/sessions/nope/export`, { headers: authHeaders() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'not_found', message: '会话缺席' });
    // 已闭会话 = 近史投影兜底照常返体（读面语义同 GET messages——只读腿不受闭态拦，host 桥真身内兜底）
    const closed = await fetch(`http://127.0.0.1:${port}/api/sessions/s-closed/export`, { headers: authHeaders() });
    expect(closed.status).toBe(200);
    expect(closed.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await closed.text()).toBe('# 会话导出 `s-closed`\n\n- 导出时间：2026-09-17T00:00:00.000Z\n- 事件数：1\n');
  });

  it('export 鉴权缺拒：无凭证 401（鉴权随全 API 面——cookie 桥/Bearer 双受理族）', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/export`);
    expect(anon.status).toBe(401);
  });

  it('export 注入窄面缺席：501 诚实缺席（WebuiCompletionFace? 缺席诚实空同精神）', async () => {
    const bare = await rig(makeDeps({ withoutExport: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/export`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({ error: 'not_implemented' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  /* ---- ③ 档位面三端点（2026-09-18 webui 档位面受理批——GET tiers + 两 PUT） ---- */

  it('档位面鉴权缺拒：三端点无凭证 401（鉴权随全 API 面——token-or-cookie）', async () => {
    const tiers = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/tiers`);
    expect(tiers.status).toBe(401);
    const thinking = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/thinking-level`, { method: 'PUT' });
    expect(thinking.status).toBe(401);
    const sandbox = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/sandbox-mode`, { method: 'PUT' });
    expect(sandbox.status).toBe(401);
  });

  it('tiers：GET 200 全形状（四键齐 + 行集 detail 透传 + danger 钉死措辞）', async () => {
    const r = await get('/api/sessions/s-1/tiers');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      thinkingLevel: 'medium',
      sandboxMode: 'workspace-write',
      thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => ({
        level,
        detail: `thinking 档 ${level}`,
      })),
      sandboxModes: [
        { mode: 'read-only', detail: 'sandbox 档 read-only' },
        { mode: 'workspace-write', detail: 'sandbox 档 workspace-write' },
        // danger 行 = 07 §4.1 钉死措辞透传（SPA 零硬编码的行文案单源证明）
        { mode: 'danger', detail: '无沙箱——任何命令直跑宿主' },
      ],
    });
  });

  it('tiers 无锚形：thinkingLevel = null（fold 与 boot 均缺席——行集照常全量、sandboxMode 恒有锚）', async () => {
    const r = await get('/api/sessions/s-noanchor/tiers');
    expect(r.status).toBe(200);
    const body = r.json as {
      thinkingLevel: string | null;
      sandboxMode: string;
      thinkingLevels: unknown[];
      sandboxModes: unknown[];
    };
    expect(body.thinkingLevel).toBeNull();
    expect(body.sandboxMode).toBe('workspace-write');
    expect(body.thinkingLevels).toHaveLength(7);
    expect(body.sandboxModes).toHaveLength(3);
  });

  it('tiers 会话态分账：missing 404 not_found / closed 404 closed（读写不分——档位面是会话活体交互面）', async () => {
    const missing = await get('/api/sessions/who-knows/tiers');
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: 'not_found' });
    // 已闭一律 404 closed：messages//export 的已闭放行系正文读面语义，tiers 非正文读面
    const closed = await get('/api/sessions/s-closed/tiers');
    expect(closed.status).toBe(404);
    expect(closed.json).toMatchObject({ error: 'closed' });
  });

  it('档位面注入窄面缺席：三端点 501 诚实缺席且 501 判先于会话态 404（GET /export 先例同序——冷读 CR-TIER-2）', async () => {
    const bare = await rig(makeDeps({ withoutTiers: true }).deps);
    try {
      // GET：missing 会话仍 501（面缺席优先于会话存在性分账——若序倒置则 404 即红）
      const g = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows/tiers`, {
        headers: { authorization: `Bearer ${bare.token}` },
      });
      expect(g.status).toBe(501);
      expect(await g.json()).toMatchObject({ error: 'not_implemented' });
      // 两 PUT 同序（501 先于会话态与体校验）
      const p1 = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows/thinking-level`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bare.token}` },
        body: JSON.stringify({ level: 'high' }),
      });
      expect(p1.status).toBe(501);
      expect(await p1.json()).toMatchObject({ error: 'not_implemented' });
      const p2 = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/who-knows/sandbox-mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bare.token}` },
        body: JSON.stringify({ mode: 'read-only' }),
      });
      expect(p2.status).toBe(501);
      expect(await p2.json()).toMatchObject({ error: 'not_implemented' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('tiers fold 坏词：面级 500 不静默吞（冷读 CR-TIER-2 钉死——TUI 开屏 notify 降级形分立如实）', async () => {
    const broken = await rig(makeDeps({ foldBadWord: true }).deps);
    try {
      // 面抛上抛 → sdk 面监听器 catch → 500（面级 plain text 应答——断状态码即可）
      const res = await fetch(`http://127.0.0.1:${broken.port}/api/sessions/s-1/tiers`, {
        headers: { authorization: `Bearer ${broken.token}` },
      });
      expect(res.status).toBe(500);
    } finally {
      broken.webui.detach();
      await broken.face.stop();
    }
  });

  it('thinking-level：PUT 200 {receipt} 透传 + 受理记账；坏词 400 码族词面（THINKING_LEVEL_INVALID 不吞码）', async () => {
    const ok = await put('/api/sessions/s-1/thinking-level', { level: 'high' });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ receipt: 'thinking 已切 high——下一 run 起生效（档位是否生效随模型能力）' });
    expect(stub.setLevels).toEqual([{ sessionId: 's-1', level: 'high' }]);
    // 坏词 fail-loud：400 + error 词 = 码族词面呈现（message 人读因透传）
    const bad = await put('/api/sessions/s-1/thinking-level', { level: 'ultra' });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: 'THINKING_LEVEL_INVALID' });
    expect((bad.json as { message: string }).message).toContain('ultra');
    // 坏词不入账（词法校验在 append 前——受理记账长度不变）
    expect(stub.setLevels).toHaveLength(1);
  });

  it('sandbox-mode：PUT 200 {receipt} 透传 + 受理记账；坏词 400 SANDBOX_MODE_INVALID', async () => {
    const ok = await put('/api/sessions/s-1/sandbox-mode', { mode: 'read-only' });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ receipt: 'sandbox 已切 read-only——即刻生效于后续工具调用' });
    expect(stub.setModes).toEqual([{ sessionId: 's-1', mode: 'read-only' }]);
    const bad = await put('/api/sessions/s-1/sandbox-mode', { mode: 'yolo' });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: 'SANDBOX_MODE_INVALID' });
    expect(stub.setModes).toHaveLength(1);
  });

  it('档位面 PUT 体校验：键缺失 / 未知字段 / 键错位 / 坏 JSON → 400（typebox 收窄律）', async () => {
    expect((await put('/api/sessions/s-1/thinking-level', { value: 'high' })).status).toBe(400);
    expect((await put('/api/sessions/s-1/thinking-level', { level: 'high', extra: 1 })).status).toBe(400);
    // sandbox-mode 携 thinking 键 = 键错位（mode 键缺失）
    expect((await put('/api/sessions/s-1/sandbox-mode', { level: 'read-only' })).status).toBe(400);
    const bad = await fetch(`http://127.0.0.1:${port}/api/sessions/s-1/thinking-level`, {
      method: 'PUT',
      headers: authHeaders(),
      body: 'not-json',
    });
    expect(bad.status).toBe(400);
    // 坏体不入账（校验先于执行体调用）
    expect(stub.setLevels).toHaveLength(0);
    expect(stub.setModes).toHaveLength(0);
  });

  it('档位面 PUT 会话态分账：missing 404 not_found / closed 404 closed（对照 submit 词面）', async () => {
    const missing = await put('/api/sessions/who-knows/thinking-level', { level: 'high' });
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: 'not_found' });
    const closed = await put('/api/sessions/s-closed/sandbox-mode', { mode: 'read-only' });
    expect(closed.status).toBe(404);
    expect(closed.json).toMatchObject({ error: 'closed' });
    // 两态均不入账
    expect(stub.setLevels).toHaveLength(0);
    expect(stub.setModes).toHaveLength(0);
  });

  it('档位面 PUT 体帽：描述符显式设值（sdk 面 10MiB 缺省不渗透——冷读 F2）超帽 413', async () => {
    // 件级帽注到 32B 的 rig：PUT 路由描述符显式携 bodyLimitBytes 才吃到件级帽；
    // 若描述符缺席该键则面级 10MiB 缺省渗透、本例不 413 即红——F2 防渗透牙
    const bare = await rig(stub.deps, { bodyLimitBytes: 32 });
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/thinking-level`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bare.token}`,
        },
        body: JSON.stringify({ level: 'x'.repeat(200) }),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'too_large' });
      const res2 = await fetch(`http://127.0.0.1:${bare.port}/api/sessions/s-1/sandbox-mode`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bare.token}`,
        },
        body: JSON.stringify({ mode: 'y'.repeat(200) }),
      });
      expect(res2.status).toBe(413);
      expect(await res2.json()).toMatchObject({ error: 'too_large' });
    } finally {
      bare.webui.detach();
      await bare.face.stop();
    }
  });

  it('submit：受理 200 + messageId 缺席 undefined 透传 / 显式透传（8572ccd 拍板——件侧不补生成）', async () => {
    const noId = await post('/api/sessions/s-1/submit', { text: '问' });
    expect(noId.status).toBe(200);
    expect(noId.json).toEqual({ sessionId: 's-1' });
    const withId = await post('/api/sessions/s-1/submit', { text: '再问', messageId: 'm-spa-1' });
    expect(withId.status).toBe(200);
    // 随真态翻档（原断言生成键 'webui-1'）：缺席形 = undefined 透传（无幂等
    // 不落账，桥侧容忍形 18a3cf8 前置判据收口）
    expect(stub.submitted).toEqual([
      { sessionId: 's-1', content: '问', messageId: undefined },
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

  it('submit 幂等冲突：桥抛 SDK_MESSAGE_CONFLICT → 409 结构码不吞码（tiers PUT catch 同形）', async () => {
    // SPA 重试携同 messageId 异内容时桥 admit fail-loud 抛（0dcf5c9 判据族
    // 与 SDK 线同源）——HTTP 面须折 409 + error=码族词（sdk/http.ts 码表
    // SDK_MESSAGE_CONFLICT→409 已有），修前无 catch 走面级 500 吞码
    const rigged = await rig(makeDeps({ conflictSubmit: true }).deps);
    try {
      const res = await fetch(`http://127.0.0.1:${rigged.port}/api/sessions/s-1/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rigged.token}` },
        body: JSON.stringify({ text: '问', messageId: 'm-spa-1' }),
      });
      expect(res.status).toBe(409); // 修前红：500
      expect(await res.json()).toMatchObject({ error: 'SDK_MESSAGE_CONFLICT' }); // 修前红：面级 500 无结构码
    } finally {
      rigged.webui.detach();
      await rigged.face.stop();
    }
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
    // 面在场而 symbols 键缺席（恰 = host 桥生产形——completion 只含
    // workspaceFiles）：symbols 路由键级缺省位回诚实空（与整面缺席分立锁）
    const symbols = await get('/api/workspace/symbols?q=x');
    expect(symbols.status).toBe(200);
    expect(symbols.json).toEqual({ items: [] });
    // q 缺参形：handler queryOf(req).get('q') ?? '' 缺省位——q='' 走桩的空查询腿
    const noQuery = await get('/api/workspace/files');
    expect(noQuery.status).toBe(200);
    expect(noQuery.json).toEqual({ items: ['a/.ts'] });
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

  it('断线重连一致性（D2①）：close 销账 hasAudience 翻 false → 断线窗事件零滞留 → 新流只收后续帧（live-only）', async () => {
    const r1 = await openSse(port, 's-1', token);
    // 在场观众登记（订阅即入册）
    expect(webui!.backend.hasAudience()).toBe(true);
    // 终结帧先达（session 镜像族——重连前事件锚）
    pushEnvelope({
      sessionId: 's-1',
      event: { type: 'message_end', message: { role: 'user', content: '一', timestamp: 2 } },
    });
    const f1 = await r1.next();
    expect(f1?.kind).toBe('session');
    // 断线：读者侧 abort → res close → 件侧销账（轮询至 hasAudience 翻 false——
    // 件侧销账位挂 res close，撤销即永不销账：hasAudience 恒 true 即缺陷）
    r1.abort();
    const t0 = Date.now();
    while (webui!.backend.hasAudience()) {
      if (Date.now() - t0 > 2_000) throw new Error('close 销账超时：hasAudience 恒 true（流账未摘）');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // 断线窗：事件照推不炸（无观众 = 按会话索引空集短路——零滞留零异常）
    pushEnvelope({ sessionId: 's-1', event: { type: 'message_start', role: 'assistant' } });
    // 重连：新流 live-only——断线前与断线窗的帧都不得补推（足额 2s 静默窗断言）
    const r2 = await openSse(port, 's-1', token);
    try {
      await expectSilence(r2);
      // 新流照常接收后续帧（重连不哑流）
      pushEnvelope({
        sessionId: 's-1',
        event: { type: 'message_end', message: { role: 'user', content: '二', timestamp: 3 } },
      });
      const f2 = await r2.next();
      expect(f2?.kind).toBe('session');
      expect((f2 as { payload: { type: string } }).payload.type).toBe('message_end');
    } finally {
      r2.abort();
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
    // 畸形百分号序列（decodeURIComponent 抛 URIError）：与未知路径同语义——
    // SPA fallback 回 index.html（非 500 internal 错误分档失真；未认证客户端可任意触发位）
    const malformed = await rawRequest(port, '/_%E0%A4', { host: '127.0.0.1' });
    expect(malformed.status).toBe(200);
    expect(malformed.headers['content-type']).toContain('text/html');
    expect(malformed.body).toContain('<!doctype html>');
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

/* ---------------- ⑨ 双表对拍锁（词面单源执法——tests 不计边表账） ---------------- */

describe('WEBUI_ENDPOINTS 双表对拍（客户端副本 vs 服务端单源）', () => {
  it('整表恒等：键集 + 逐键值（16 路径 17 端点口径——服务端改词面则客户端静默 404 的漂移面本例即红）', () => {
    // client/protocol.ts 头注承诺「与服务端 WEBUI_ENDPOINTS 同形同词面」——
    // 承诺升为可执行锁；toStrictEqual 整表锁含键集/逐键值/键序三面，
    // 任一侧改词面（含增删键）四门禁即红
    expect(WEBUI_ENDPOINTS_CLIENT).toStrictEqual(WEBUI_ENDPOINTS_SERVER);
  });
});
