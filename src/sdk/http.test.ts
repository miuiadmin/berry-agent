/**
 * sdk/http 传输面集成测试（批 13e-2）。
 *
 * 全环真监听（sock + 127.0.0.1 实配 TCP 双面；port 0 由内核指派）——fetch/
 * node:http 真请求；桥注入面全桩（mock 只停在注入位）。锁七面——
 * ①POST 六动词受理与应答映射（ack/204/decide-result/entries/sessions）
 * ②闸门三道（鉴权 401 / 版本 400 SDK_PROTOCOL_MISMATCH / 体解码 400 SDK_DECODE）
 * ③TCP 三防线（Host/Origin 拒 403——sock 面免防线）
 * ④SSE 全语义（hello→重放→replay-end→直播 pushEvent；noDelta 剥 delta）
 * ⑤订阅生命周期与真观众同步（流撤即退订 / prompt-only 孤儿即清 / SSE 在场
 * 则保留）
 * ⑥体限幅 413 ⑦sock 面接入（Unix socket 真请求 + 陈旧死迹自动清）
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SdkDurableEntry, SdkWireFrame } from '../channels/index.js';
import { createSdkHttpFace, type SdkHttpFaceHandle, type SdkListenInfo } from './http.js';
import type { SdkHttpBridge } from './types.js';

/** durable 平铺样本（seq 直携——重放窗按 seq 切） */
function entry(seq: number): SdkDurableEntry {
  return { type: 'user/message', seq, time: 1_690_000_000_000 + seq, data: { seq } };
}

/** 桥桩台账（状态/高水位/日志/受理记账——装配桥 13c 的最小同构） */
interface BridgeStub {
  readonly bridge: SdkHttpBridge;
  readonly submitted: Array<{ sessionId?: string; messageId: string; content: string }>;
  readonly interrupted: string[];
  setSession(sessionId: string, state: 'open' | 'closed' | 'missing', log?: SdkDurableEntry[]): void;
}

function makeBridge(): BridgeStub {
  const sessions = new Map<string, { state: 'open' | 'closed'; log: SdkDurableEntry[] }>();
  const submitted: BridgeStub['submitted'] = [];
  const interrupted: string[] = [];
  const bridge: SdkHttpBridge = {
    submitPrompt: (input) => {
      submitted.push(input);
      if (input.sessionId === undefined) sessions.set('s-new', { state: 'open', log: [] });
      return { sessionId: input.sessionId ?? 's-new' };
    },
    lookupDedupeKey: () => undefined,
    interruptSession: (sessionId) => {
      interrupted.push(sessionId);
    },
    queryEntries: (sessionId, since) => ({
      entries: (sessions.get(sessionId)?.log ?? []).filter((e) => e.seq > since),
    }),
    listSessions: () => [],
    highWaterOf: (sessionId) => sessions.get(sessionId)?.log.length,
    sessionStateOf: (sessionId) => (sessions.get(sessionId)?.state ?? 'missing') as 'open' | 'closed' | 'missing',
    retryProbeOf: () => null,
  };
  return {
    bridge,
    submitted,
    interrupted,
    setSession: (sessionId, state, log = []) => {
      if (state === 'missing') sessions.delete(sessionId);
      else sessions.set(sessionId, { state, log });
    },
  };
}

/** SSE 读取腿（后台泵 + 顺序 next；ping 注释行天然跳过） */
interface SseReader {
  next(): Promise<SdkWireFrame | undefined>;
  /** 顺序取至指定 kind（跳过心跳等中间帧——超时/流尽返 undefined） */
  nextOf(kind: SdkWireFrame['kind']): Promise<SdkWireFrame | undefined>;
  abort(): void;
}

async function openSse(port: number, query: string, headers: Record<string, string>): Promise<SseReader> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/v1/events${query}`, {
    headers,
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const pending: SdkWireFrame[] = [];
  const waiters: Array<(frame: SdkWireFrame | undefined) => void> = [];
  let buffer = '';
  let done = false;
  // 后台泵（IIFE 即起）：块切分 → data 行解析 → 等待者/暂存队列分发
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
          const frame = JSON.parse(dataLine.slice(6)) as SdkWireFrame;
          const waiter = waiters.shift();
          if (waiter !== undefined) waiter(frame);
          else pending.push(frame);
        }
      }
    } catch {
      // abort 收线——泵终止
    }
    done = true;
    for (const waiter of waiters.splice(0)) waiter(undefined);
  })();
  const next = (): Promise<SdkWireFrame | undefined> =>
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
  return {
    next,
    nextOf: async (kind) => {
      for (;;) {
        const frame = await next();
        if (frame === undefined) return undefined;
        if (frame.kind === kind) return frame;
      }
    },
    abort: () => {
      controller.abort();
    },
  };
}

/** node:http 裸请求（Host/Origin 防线测试位——fetch 禁改两头） */
function rawRequest(
  options: { socketPath?: string; port?: number; host?: string },
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ ...options, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('sdk/http 传输面（一核多流）', () => {
  let face: SdkHttpFaceHandle;
  let stub: BridgeStub;
  let info: SdkListenInfo;
  let dir: string;

  beforeEach(async () => {
    stub = makeBridge();
    dir = await mkdtemp(join(tmpdir(), 'sdk-http-'));
    face = createSdkHttpFace({
      config: { socketPath: join(dir, 'test.sock'), tcp: { host: '127.0.0.1', port: 0 } },
      bridge: stub.bridge,
      coreOptions: { heartbeatIntervalMs: 60 }, // 提速（心跳测试 + 短测时长）
    });
    info = await face.start();
  });

  afterEach(async () => {
    await face.stop();
    await rm(dir, { recursive: true, force: true });
  });

  /** 公共头（版本 + 鉴权——恒在场两闸） */
  const baseHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    'content-type': 'application/json',
    'x-sdk-protocol': '1',
    authorization: `Bearer ${face.token}`,
    ...extra,
  });

  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`http://127.0.0.1:${info.tcp[0]!.port}${path}`, {
      method: 'POST',
      headers: baseHeaders(headers),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  it('prompt 受理 → 200 ack（受理入桥记账）', async () => {
    stub.setSession('s-1', 'open', [entry(0), entry(1)]);
    const r = await post('/v1/prompt', { messageId: 'm-1', content: '问', sessionId: 's-1' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'ack', sessionId: 's-1', messageId: 'm-1', duplicate: false });
    expect(stub.submitted).toEqual([{ sessionId: 's-1', messageId: 'm-1', content: '问' }]);
  });

  it('prompt sessionId 缺席新建（桥落句柄回示）', async () => {
    const r = await post('/v1/prompt', { messageId: 'm-2', content: '新开' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'ack', sessionId: 's-new', duplicate: false });
  });

  it('prompt 重复 messageId → duplicate 幂等重收执（不再入桥）', async () => {
    stub.setSession('s-1', 'open');
    await post('/v1/prompt', { messageId: 'm-1', content: '问', sessionId: 's-1' });
    const r = await post('/v1/prompt', { messageId: 'm-1', content: '问', sessionId: 's-1' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'ack', duplicate: true });
    expect(stub.submitted).toHaveLength(1);
  });

  it('prompt 未知会话 → 404 SESSION_NOT_FOUND', async () => {
    const r = await post('/v1/prompt', { messageId: 'm-1', content: '问', sessionId: 'nope' });
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ kind: 'error', code: 'SESSION_NOT_FOUND' });
  });

  it('版本头缺席/不符 → 400 SDK_PROTOCOL_MISMATCH', async () => {
    const miss = await post('/v1/prompt', { messageId: 'm', content: 'c' }, { 'x-sdk-protocol': '' });
    expect(miss.status).toBe(400);
    expect(miss.json).toMatchObject({ code: 'SDK_PROTOCOL_MISMATCH' });
    const wrong = await post('/v1/prompt', { messageId: 'm', content: 'c' }, { 'x-sdk-protocol': '99' });
    expect(wrong.status).toBe(400);
    expect(wrong.json).toMatchObject({ code: 'SDK_PROTOCOL_MISMATCH' });
  });

  it('鉴权：缺席/错 token → 401 SDK_UNAUTHORIZED；实效 token 过', async () => {
    const none = await post('/v1/prompt', { messageId: 'm', content: 'c' }, { authorization: '' });
    expect(none.status).toBe(401);
    expect(none.json).toMatchObject({ code: 'SDK_UNAUTHORIZED' });
    const wrong = await post('/v1/prompt', { messageId: 'm', content: 'c' }, { authorization: 'Bearer deadbeef' });
    expect(wrong.status).toBe(401);
  });

  it('体解码三档拒：非 JSON / 非对象 / 深校验拒 → 400 SDK_DECODE', async () => {
    expect((await post('/v1/prompt', '{oops')).status).toBe(400);
    expect((await post('/v1/prompt', '[1,2]')).status).toBe(400);
    const deep = await post('/v1/prompt', { messageId: 'm', content: 'c', extra: 1 });
    expect(deep.status).toBe(400);
    expect(deep.json).toMatchObject({ kind: 'error', code: 'SDK_DECODE' });
  });

  it('interrupt open → 204 空体；missing → 404', async () => {
    stub.setSession('s-1', 'open');
    const ok = await post('/v1/interrupt', { sessionId: 's-1' });
    expect(ok.status).toBe(204);
    expect(ok.json).toBeNull();
    expect(stub.interrupted).toEqual(['s-1']);
    const miss = await post('/v1/interrupt', { sessionId: 'nope' });
    expect(miss.status).toBe(404);
    expect(miss.json).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('decide 未决账空 → 200 decide-result superseded', async () => {
    const r = await post('/v1/decide', { approvalId: 'a-1', answer: 'approve' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'decide-result', approvalId: 'a-1', outcome: 'superseded' });
  });

  it('entries → 200 (since, 高水位] 窗投影', async () => {
    stub.setSession('s-1', 'open', [entry(0), entry(1), entry(2)]);
    const r = await post('/v1/entries', { sessionId: 's-1', since: 0 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ kind: 'entries', sessionId: 's-1' });
    expect((r.json as { entries: SdkDurableEntry[] }).entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('sessions → 200 sessions 帧', async () => {
    const res = await fetch(`http://127.0.0.1:${info.tcp[0]!.port}/v1/sessions`, { headers: baseHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: 'sessions', sessions: [] });
  });

  it('路由不识别 → 404 纯文本', async () => {
    const res = await fetch(`http://127.0.0.1:${info.tcp[0]!.port}/v1/none`, { headers: baseHeaders() });
    expect(res.status).toBe(404);
  });

  it('SSE 全语义：hello → 重放 → replay-end → 直播 pushEvent', async () => {
    stub.setSession('s-1', 'open', [entry(0), entry(1)]);
    const sse = await openSse(info.tcp[0]!.port, '?sessionId=s-1&after=-1', baseHeaders());
    expect(await sse.next()).toMatchObject({ kind: 'hello', sessionId: 's-1', highWaterSeq: 2 });
    const replay = await sse.next();
    expect(replay).toMatchObject({ kind: 'entries', sessionId: 's-1' });
    expect((replay as { entries: SdkDurableEntry[] }).entries).toHaveLength(2);
    expect(await sse.next()).toMatchObject({ kind: 'replay-end', sessionId: 's-1', lastReplayedSeq: 1 });
    // 直播腿：核 pushEvent → 扇出至订阅流
    face.core.pushEvent('s-1', { type: 'agent_start' });
    expect(await sse.nextOf('event')).toMatchObject({ kind: 'event', sessionId: 's-1' });
    expect(face.core.isSubscribed('s-1')).toBe(true);
    sse.abort();
  });

  it('SSE noDelta=true 剥 message_update 直播（定稿帧照达）', async () => {
    stub.setSession('s-1', 'open');
    const sse = await openSse(info.tcp[0]!.port, '?sessionId=s-1&noDelta=true', baseHeaders());
    await sse.nextOf('replay-end');
    const partial = { role: 'test/partial', content: '', timestamp: 0 };
    face.core.pushEvent('s-1', { type: 'message_update', role: 'assistant', partial });
    face.core.pushEvent('s-1', { type: 'message_end', message: partial });
    const live = await sse.nextOf('event');
    expect(live?.kind).toBe('event');
    if (live?.kind === 'event') expect(live.event.type).toBe('message_end'); // delta 帧被剥——首达即定稿帧
    sse.abort();
  });

  it('SSE sessionId 缺席 → 400（诚实拒——流未开）', async () => {
    const res = await fetch(`http://127.0.0.1:${info.tcp[0]!.port}/v1/events`, { headers: baseHeaders() });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'SDK_DECODE' });
  });

  it('SSE 未知会话 → 200 开流 + 流内 error 帧 + 流尽', async () => {
    const sse = await openSse(info.tcp[0]!.port, '?sessionId=nope', baseHeaders());
    expect(await sse.next()).toMatchObject({ kind: 'error', code: 'SESSION_NOT_FOUND' });
    expect(await sse.next()).toBeUndefined(); // 流收线
  });

  it('流撤即退订：abort → 核订阅随撤（订阅生命周期与真观众同步）', async () => {
    stub.setSession('s-1', 'open');
    const sse = await openSse(info.tcp[0]!.port, '?sessionId=s-1', baseHeaders());
    await sse.nextOf('replay-end');
    expect(face.core.isSubscribed('s-1')).toBe(true);
    sse.abort();
    // 收线传播（服务端 close 事件异步达）——轮询至退订成立
    for (let i = 0; i < 50 && face.core.isSubscribed('s-1'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(face.core.isSubscribed('s-1')).toBe(false);
  });

  it('prompt-only 孤儿订阅即清（无 SSE 观众即撤——ask fail-closed 同步）', async () => {
    const r = await post('/v1/prompt', { messageId: 'm-1', content: '问' });
    expect(r.json).toMatchObject({ kind: 'ack', sessionId: 's-new' });
    expect(face.core.isSubscribed('s-new')).toBe(false); // 应答即撤（零观众）
  });

  it('prompt 时 SSE 在场则订阅保留', async () => {
    stub.setSession('s-1', 'open');
    const sse = await openSse(info.tcp[0]!.port, '?sessionId=s-1', baseHeaders());
    await sse.nextOf('replay-end');
    await post('/v1/prompt', { messageId: 'm-1', content: '问', sessionId: 's-1' });
    expect(face.core.isSubscribed('s-1')).toBe(true);
    sse.abort();
  });

  it('心跳静默填充：idle 超阈即 heartbeat 帧达流', async () => {
    stub.setSession('s-1', 'open');
    const sse = await openSse(info.tcp[0]!.port, '?sessionId=s-1', baseHeaders());
    await sse.nextOf('replay-end');
    const beat = await sse.nextOf('heartbeat'); // heartbeatIntervalMs=60——2s 窗内必达
    expect(beat).toMatchObject({ kind: 'heartbeat', sessionId: 's-1', runState: 'idle' });
    sse.abort();
  });

  it('TCP 三防线：非回环 Host → 403；跨源 Origin → 403（10.4 同律）', async () => {
    const host = await rawRequest({ port: info.tcp[0]!.port }, '/v1/sessions', {
      ...baseHeaders(),
      Host: 'evil.example.com:80',
    });
    expect(host.status).toBe(403);
    expect(JSON.parse(host.body)).toMatchObject({ code: 'SDK_FORBIDDEN' });
    const origin = await rawRequest({ port: info.tcp[0]!.port }, '/v1/sessions', {
      ...baseHeaders(),
      Origin: 'http://evil.example.com',
    });
    expect(origin.status).toBe(403);
  });

  it('sock 面接入：Unix socket 真请求过（免 Host/Origin 防线）；错 token 同拒 401', async () => {
    const ok = await rawRequest({ socketPath: info.socketPath }, '/v1/sessions', baseHeaders());
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ kind: 'sessions' });
    const bad = await rawRequest(
      { socketPath: info.socketPath },
      '/v1/sessions',
      baseHeaders({ authorization: 'Bearer x' }),
    );
    expect(bad.status).toBe(401);
  });

  it('陈旧 sock 死迹自动清再监听（活迹才上抛）', async () => {
    // beforeEach 已起 face（占住 sock）；再起第二枚撞活迹 → 启动失败上抛
    const face2 = createSdkHttpFace({
      config: { socketPath: info.socketPath },
      bridge: stub.bridge,
    });
    await expect(face2.start()).rejects.toThrow();
    await face2.stop().catch(() => {});
  });
});

describe('sdk/http 体限幅注入位', () => {
  it('bodyLimitBytes 小值注入生效（64B 档）', async () => {
    const stub = makeBridge();
    const dir = await mkdtemp(join(tmpdir(), 'sdk-http-limit-'));
    const face = createSdkHttpFace({
      config: { socketPath: join(dir, 'x.sock'), tcp: { host: '127.0.0.1', port: 0 } },
      bridge: stub.bridge,
      bodyLimitBytes: 64,
    });
    const info = await face.start();
    try {
      const res = await fetch(`http://127.0.0.1:${info.tcp[0]!.port}/v1/prompt`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sdk-protocol': '1',
          authorization: `Bearer ${face.token}`,
        },
        body: JSON.stringify({ messageId: 'm', content: 'x'.repeat(128) }),
      });
      expect(res.status).toBe(413);
    } finally {
      await face.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
