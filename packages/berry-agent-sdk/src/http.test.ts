/**
 * http 传输测试（批 13f-3）——真实 node:http fake face：路由/鉴权头/体去 verb
 * 执法、204 无应答档、非 2xx 错误体还原错误帧、SSE 直播档（重放→界标→resolve→
 * 直播帧、ping 注释行跳过、建流失败投形拒绝）。
 *
 * 传输错误面回归锁四件（sweep-4 idx 17/20/21/24）：
 * - noDelta 布尔词面宿主对拍——face 镜像宿主解码位只认字面 true/false（idx 17）；
 * - 应答阶段连接夭折 → 限期 reject（res error 接线——不悬挂，idx 20）；
 * - replay-end 界标前断连/干净收流 → openLive reject（建立期守卫，idx 21）；
 * - liveClose 流账纪律——摘账先于销毁（模块缝单测，idx 24）。
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';

import { createSdkClient } from './client.js';
import { httpSdkTransport } from './http.js';
import * as httpModule from './http.js';
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
        if (body.sessionId === 's-sever') {
          // 应答中断谱（idx 20）：写部分体后斩 socket——错误只发在客户端 res
          // （ECONNRESET），req error 不触发——不挂 res.on('error') 即悬挂
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.write('{"kind":"ack","sessionI');
          setTimeout(() => res.socket?.destroy(), 20);
          return;
        }
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
      // 宿主对拍锚（idx 17）：镜像宿主解码位（src/sdk/http.ts 的 noDelta
      // 解析）——只认字面 true/false，其余一律 400 SDK_DECODE。'1'/'0' 形
      // 在宿主真面恒被拒，face 不执法即把编码漂移放行成「绿」。
      const noDeltaRaw = url.searchParams.get('noDelta');
      if (noDeltaRaw !== null && noDeltaRaw !== 'true' && noDeltaRaw !== 'false') {
        sendJson(res, 400, {
          kind: 'error',
          code: 'SDK_DECODE',
          message: `noDelta 查询参非布尔（true/false）：${noDeltaRaw}`,
        });
        return;
      }
      const sessionId = url.searchParams.get('sessionId');
      if (sessionId === 's-missing') {
        sendJson(res, 404, { kind: 'error', code: 'SESSION_NOT_FOUND', message: '无此会话' });
        return;
      }
      if (sessionId === 's-cut-live') {
        // 建立期断连谱（idx 21）：200 + hello 后斩 socket，replay-end 永不至
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        res.write(`data: ${JSON.stringify({ kind: 'hello', protocolVersion: 1, sessionId, highWaterSeq: 3 })}\n\n`);
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      if (sessionId === 's-end-live') {
        // 建立期干净收流谱（idx 21）：200 + hello 后 res.end()，replay-end 永不至
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        res.write(`data: ${JSON.stringify({ kind: 'hello', protocolVersion: 1, sessionId, highWaterSeq: 3 })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      const data = (frame: unknown): void => {
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      };
      res.write(': ping\n\n'); // 注释行——客户端须跳过
      data({ kind: 'hello', protocolVersion: 1, sessionId, highWaterSeq: 9 });
      data({ kind: 'entries', sessionId, entries: [] });
      data({ kind: 'replay-end', sessionId, lastReplayedSeq: 8 });
      setTimeout(() => {
        data({
          kind: 'event',
          seq: 9,
          sessionId,
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

/** 限期落定锚：传输错误路径必须 fail-loud——悬挂 Promise 以超时错红出（非 SdkError 即不匹配断言） */
function withDeadline<T>(pending: Promise<T>, budgetMs = 1500): Promise<T> {
  return Promise.race([
    pending,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`限期 ${budgetMs}ms 未落定——Promise 悬挂`)), budgetMs);
    }),
  ]);
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
    // 布尔词面 = 宿主解码位字面（true/false）——'1'/'0' 形在宿主恒 400 SDK_DECODE
    expect(log.eventsQueries[0]).toContain('noDelta=true');
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

  it('noDelta 布尔词面宿主对拍：true/false 双字面皆被 face（镜像宿主解码位）受理建流（idx 17）', async () => {
    const { transport, log } = await face();
    const before = log.eventsQueries.length;
    // 显式 true / false 两形都要能建流——face 已镜像宿主字面门，'1'/'0' 即 400
    const hTrue = await transport.openLive({ sessionId: 's-1', noDelta: true }, () => {});
    await hTrue.close();
    const hFalse = await transport.openLive({ sessionId: 's-1', noDelta: false }, () => {});
    await hFalse.close();
    expect(log.eventsQueries[before]).toContain('noDelta=true');
    expect(log.eventsQueries[before + 1]).toContain('noDelta=false');
  });

  it('应答阶段连接夭折：部分体后 socket 被斩 → 限期 reject SDK_TRANSPORT（res error 接线，不悬挂）（idx 20）', async () => {
    const { transport } = await face();
    const client = createSdkClient(transport);
    // face 写部分体后斩 socket——错误只发在 res 上，req.on('error') 不救；
    // 限期锚：悬挂 Promise 以裸超时错落定 → 不匹配 SdkError 断言即红
    const pending = client.prompt({ sessionId: 's-sever', messageId: 'm-cut', content: 'x' });
    await expect(withDeadline(pending)).rejects.toMatchObject({
      name: 'SdkError',
      code: 'SDK_TRANSPORT',
    });
  });

  it('replay-end 界标前断连 → openLive reject SDK_TRANSPORT（SSE 流在 replay-end 前终止）（idx 21）', async () => {
    const { transport } = await face();
    // face 发 hello 后斩 socket，replay-end 永不至——建流 Promise 必须 fail-loud
    const pending = transport.openLive({ sessionId: 's-cut-live' }, () => {});
    await expect(withDeadline(pending)).rejects.toMatchObject({
      name: 'SdkError',
      code: 'SDK_TRANSPORT',
      message: expect.stringContaining('replay-end 前终止'),
    });
  });

  it('replay-end 界标前对端干净收流（res end）→ openLive reject SDK_TRANSPORT（idx 21）', async () => {
    const { transport } = await face();
    // face 发 hello 后 res.end()（干净终局，无 error 事件）——end/close 亦须拒绝
    const pending = transport.openLive({ sessionId: 's-end-live' }, () => {});
    await expect(withDeadline(pending)).rejects.toMatchObject({
      name: 'SdkError',
      code: 'SDK_TRANSPORT',
      message: expect.stringContaining('replay-end 前终止'),
    });
  });

  it('close 幂等（无长连可收——在场 SSE 流销毁）', async () => {
    const { transport } = await face();
    await transport.close();
    await transport.close();
  });
});

describe('liveClose 流账纪律（单订阅收口工厂——idx 24）', () => {
  it('摘账先于销毁：streams.delete(res) 在 res.destroy() 之前、账内无残留', async () => {
    // 命名空间访问而非具名导入：修前工厂未导出时本例以「非函数」红出，
    // 不因缺导出名炸整件模块装载（包公开面 index.ts 不转发——仅模块缝）
    const factory = (httpModule as unknown as Record<string, unknown>).liveClose as
      ((res: IncomingMessage, streams: Set<IncomingMessage>) => () => Promise<void>) | undefined;
    expect(typeof factory).toBe('function');
    if (typeof factory !== 'function') throw new Error('liveClose 未导出（测试缝缺位）');
    // 记序 Set：delete 调用先于 destroy 即「摘账先于销毁」
    const ops: string[] = [];
    class RecordingSet extends Set<IncomingMessage> {
      override delete(value: IncomingMessage): boolean {
        ops.push('delete');
        return super.delete(value);
      }
    }
    const streams = new RecordingSet();
    const res = { destroy: () => ops.push('destroy') } as unknown as IncomingMessage;
    streams.add(res);
    await factory(res, streams)();
    expect(ops).toEqual(['delete', 'destroy']);
    expect(streams.has(res)).toBe(false);
  });
});
