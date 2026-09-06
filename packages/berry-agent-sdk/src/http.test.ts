/**
 * http 传输测试（批 13f-3）——真实 node:http fake face：路由/鉴权头/体去 verb
 * 执法、204 无应答档、非 2xx 错误体还原错误帧、SSE 直播档（重放→界标→resolve→
 * 直播帧、ping 注释行跳过、建流失败投形拒绝）。
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';

import { createSdkClient } from './client.js';
import { httpSdkTransport } from './http.js';
import type { SdkTransport } from './types.js';

/** fake face 录账（服务端视角断言位） */
interface FaceLog {
  prompts: Array<{ headers: IncomingMessage['headers']; body: Record<string, unknown> }>;
  interrupts: number;
  entriesCalls: Array<Record<string, unknown>>;
  decideCalls: Array<Record<string, unknown>>;
  eventsQueries: string[];
}

const TOKEN = 't-test-1';

/** 起 fake face（127.0.0.1:0 随机口）——路由语义与 13e HTTP face 一一对应 */
async function startFace(): Promise<{ transport: SdkTransport; log: FaceLog; close: () => Promise<void> }> {
  const log: FaceLog = { prompts: [], interrupts: 0, entriesCalls: [], decideCalls: [], eventsQueries: [] };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://face.test');
    const readJson = async (): Promise<Record<string, unknown>> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    };
    const sendJson = (r: ServerResponse, status: number, payload: unknown): void => {
      r.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      r.end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && url.pathname === '/v1/prompt') {
      void readJson().then((body) => {
        log.prompts.push({ headers: { ...req.headers }, body });
        if (body.sessionId === 's-none') {
          sendJson(res, 404, { kind: 'error', code: 'SESSION_NOT_FOUND', message: '无此会话' });
          return;
        }
        sendJson(res, 200, {
          kind: 'ack',
          sessionId: body.sessionId ?? 's-1',
          messageId: body.messageId,
          duplicate: false,
          highWaterSeq: 5,
        });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/interrupt') {
      log.interrupts += 1;
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/entries') {
      void readJson().then((body) => {
        log.entriesCalls.push(body);
        sendJson(res, 200, { kind: 'entries', sessionId: body.sessionId, entries: [] });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/decide') {
      void readJson().then((body) => {
        log.decideCalls.push(body);
        sendJson(res, 200, { kind: 'decide-result', approvalId: body.approvalId, outcome: 'applied' });
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/sessions') {
      sendJson(res, 200, { kind: 'sessions', sessions: [{ id: 's-1', title: 't', lastActivityAt: 1 }] });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      log.eventsQueries.push(url.search);
      if (url.searchParams.get('sessionId') === 's-missing') {
        sendJson(res, 404, { kind: 'error', code: 'SESSION_NOT_FOUND', message: '无此会话' });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      const data = (frame: unknown): void => {
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      };
      res.write(': ping\n\n'); // 注释行——客户端须跳过
      data({ kind: 'hello', protocolVersion: 1, sessionId: url.searchParams.get('sessionId'), highWaterSeq: 9 });
      data({ kind: 'entries', sessionId: url.searchParams.get('sessionId'), entries: [] });
      data({ kind: 'replay-end', sessionId: url.searchParams.get('sessionId'), lastReplayedSeq: 8 });
      setTimeout(() => {
        data({
          kind: 'event',
          seq: 9,
          sessionId: url.searchParams.get('sessionId'),
          event: { type: 'turn_end', turn: 1, stopReason: 'end_turn' },
        });
      }, 30);
      return;
    }
    sendJson(res, 404, { kind: 'error', code: 'SDK_DECODE', message: '未知路由' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const transport = httpSdkTransport({ host: '127.0.0.1', port, token: TOKEN });
  return {
    transport,
    log,
    close: () =>
      new Promise<void>((resolve) => {
        transport.close().finally(() => server.close(() => resolve()));
      }),
  };
}

let rigPromise: ReturnType<typeof startFace> | undefined;
const face = (): ReturnType<typeof startFace> => {
  rigPromise ??= startFace();
  return rigPromise;
};
afterAll(async () => {
  const rig = await rigPromise;
  await rig?.close();
});

/** 等直播帧到齐（SSE 异步面） */
async function waitFor(ready: () => boolean, budgetMs = 4000): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > budgetMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('httpSdkTransport 直连 HTTP 传输', () => {
  it('prompt：POST /v1/prompt、Bearer/x-sdk-protocol 头执法、体无 verb 字段', async () => {
    const { transport, log } = await face();
    const client = createSdkClient(transport);
    const ack = await client.prompt({ messageId: 'm-1', content: '你好' });
    expect(ack).toMatchObject({ kind: 'ack', sessionId: 's-1', messageId: 'm-1' });
    expect(log.prompts).toHaveLength(1);
    expect(log.prompts[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(log.prompts[0]?.headers['x-sdk-protocol']).toBe('1');
    expect(log.prompts[0]?.body).toEqual({ messageId: 'm-1', content: '你好' }); // 无 verb
  });

  it('非 2xx 错误体还原错误帧 → client 投形 SdkError', async () => {
    const { transport } = await face();
    const client = createSdkClient(transport);
    await expect(client.prompt({ sessionId: 's-none', messageId: 'm-x', content: 'x' })).rejects.toMatchObject({
      name: 'SdkError',
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('interrupt：POST /v1/interrupt → 204 写后即决', async () => {
    const { transport, log } = await face();
    const client = createSdkClient(transport);
    await client.interrupt('s-1');
    expect(log.interrupts).toBe(1);
  });

  it('getEntries：POST /v1/entries 体去 verb（since 透传）', async () => {
    const { transport, log } = await face();
    const client = createSdkClient(transport);
    const frame = await client.getEntries({ sessionId: 's-1', since: 7 });
    expect(frame.kind).toBe('entries');
    expect(log.entriesCalls[0]).toEqual({ sessionId: 's-1', since: 7 });
  });

  it('decide：POST /v1/decide outcome 直出', async () => {
    const { transport, log } = await face();
    const client = createSdkClient(transport);
    await expect(client.decide('a-1', 'approve')).resolves.toBe('applied');
    expect(log.decideCalls[0]).toEqual({ approvalId: 'a-1', answer: 'approve' });
  });

  it('sessions：GET /v1/sessions 无体', async () => {
    const { transport } = await face();
    const client = createSdkClient(transport);
    const rows = await client.sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 's-1', title: 't' });
  });

  it('SSE 直播档：查询参承载 hello 载荷、ping 行跳过、replay-end 后 resolve、直播帧续入', async () => {
    const { transport, log } = await face();
    const seen: string[] = [];
    const handle = await transport.openLive({ sessionId: 's-1', after: 4, noDelta: true }, (frame) =>
      seen.push(frame.kind),
    );
    expect(handle).toMatchObject({ sessionId: 's-1', highWaterSeq: 9 });
    expect(log.eventsQueries[0]).toContain('sessionId=s-1');
    expect(log.eventsQueries[0]).toContain('after=4');
    expect(log.eventsQueries[0]).toContain('noDelta=1');
    // resolve 位 = replay-end 落定后：重放段已入监听面、直播 event 未至（时序承诺）
    expect(seen).toEqual(['entries', 'replay-end']);
    await waitFor(() => seen.includes('event'));
    expect(seen).toEqual(['entries', 'replay-end', 'event']);
    await handle.close();
  });

  it('SSE 建流失败：错误体投形拒绝', async () => {
    const { transport } = await face();
    await expect(transport.openLive({ sessionId: 's-missing' }, () => {})).rejects.toMatchObject({
      name: 'SdkError',
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('close 幂等（无长连可收——在场 SSE 流销毁）', async () => {
    const { transport } = await face();
    await transport.close();
    await transport.close();
  });
});
