/**
 * client 件测试（批 13f-3）——fake 传输零 I/O：方法面 → 三档动词映射、
 * messageId 计数器形、错误帧投形 SdkError、缺省填充（since -1）。
 */
import { describe, expect, it } from 'vitest';

import { createSdkClient } from './client.js';
import { SdkError } from './types.js';
import type { SdkRequest, SdkTransport, SdkWireFrame } from './types.js';

/** fake 传输：录请求/记录写、按脚本应答 */
function fakeTransport() {
  const requests: SdkRequest[] = [];
  const sends: SdkRequest[] = [];
  let closed = 0;
  let respond: (req: SdkRequest) => SdkWireFrame = () => {
    throw new Error('fake 传输未设应答脚本');
  };
  const transport: SdkTransport = {
    request: async (req) => {
      requests.push(req);
      return respond(req);
    },
    send: async (req) => {
      sends.push(req);
    },
    openLive: async (params, onFrame) => {
      liveParams = params;
      liveListener = onFrame;
      return { sessionId: params.sessionId, highWaterSeq: 7, close: async () => {} };
    },
    close: async () => {
      closed += 1;
    },
  };
  let liveParams: Parameters<SdkTransport['openLive']>[0] | undefined;
  let liveListener: Parameters<SdkTransport['openLive']>[1] | undefined;
  return {
    transport,
    requests,
    sends,
    get closedCount() {
      return closed;
    },
    setResponder(fn: (req: SdkRequest) => SdkWireFrame): void {
      respond = fn;
    },
    get liveParams() {
      return liveParams;
    },
    get liveListener() {
      return liveListener;
    },
  };
}

const ackFrame: SdkWireFrame = {
  kind: 'ack',
  sessionId: 's-1',
  messageId: 'm-1',
  duplicate: false,
  highWaterSeq: 3,
};

describe('createSdkClient 方法面', () => {
  it('prompt：线形 verb/messageId/content、sessionId 缺席即省略', async () => {
    const fake = fakeTransport();
    fake.setResponder(() => ackFrame);
    const client = createSdkClient(fake.transport);
    const ack = await client.prompt({ messageId: 'm-1', content: '你好' });
    expect(ack.kind).toBe('ack');
    expect(fake.requests[0]).toEqual({ verb: 'prompt', messageId: 'm-1', content: '你好' });
  });

  it('prompt：messageId 缺省计数器形 sdk-N 每客户端独立自增', async () => {
    const fake = fakeTransport();
    fake.setResponder(() => ackFrame);
    const client = createSdkClient(fake.transport);
    await client.prompt({ content: '一' });
    await client.prompt({ content: '二' });
    expect(fake.requests[0]).toMatchObject({ verb: 'prompt', messageId: 'sdk-1' });
    expect(fake.requests[1]).toMatchObject({ verb: 'prompt', messageId: 'sdk-2' });
    // 续接形：显式 sessionId 透传
    await client.prompt({ sessionId: 's-9', content: '三' });
    expect(fake.requests[2]).toMatchObject({ sessionId: 's-9', messageId: 'sdk-3' });
  });

  it('错误帧 → 投形 SdkError（code/message/sessionId/name）', async () => {
    const fake = fakeTransport();
    fake.setResponder(() => ({ kind: 'error', code: 'SESSION_NOT_FOUND', message: '无此会话', sessionId: 's-x' }));
    const client = createSdkClient(fake.transport);
    await expect(client.prompt({ content: 'x' })).rejects.toMatchObject({
      name: 'SdkError',
      code: 'SESSION_NOT_FOUND',
      sessionId: 's-x',
      message: expect.stringContaining('无此会话') as unknown,
    });
    await expect(client.prompt({ content: 'x' })).rejects.toBeInstanceOf(SdkError);
  });

  it('getEntries：since 缺省 -1、显式值透传', async () => {
    const fake = fakeTransport();
    const entriesFrame: SdkWireFrame = { kind: 'entries', sessionId: 's-1', entries: [] };
    fake.setResponder(() => entriesFrame);
    const client = createSdkClient(fake.transport);
    await client.getEntries({ sessionId: 's-1' });
    await client.getEntries({ sessionId: 's-1', since: 41 });
    expect(fake.requests[0]).toEqual({ verb: 'getEntries', sessionId: 's-1', since: -1 });
    expect(fake.requests[1]).toEqual({ verb: 'getEntries', sessionId: 's-1', since: 41 });
  });

  it('sessions：应答帧取 sessions 数组直出', async () => {
    const fake = fakeTransport();
    fake.setResponder(() => ({
      kind: 'sessions',
      sessions: [{ id: 's-1', title: 't', lastActivityAt: 1 }],
    }));
    const client = createSdkClient(fake.transport);
    const rows = await client.sessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 's-1', title: 't' });
  });

  it('interrupt：走无应答档 send（不走 request 档）', async () => {
    const fake = fakeTransport();
    const client = createSdkClient(fake.transport);
    await client.interrupt('s-1');
    expect(fake.sends).toEqual([{ verb: 'interrupt', sessionId: 's-1' }]);
    expect(fake.requests).toHaveLength(0);
  });

  it('decide：线形 approvalId/answer、note 缺席即省略、outcome 直出', async () => {
    const fake = fakeTransport();
    fake.setResponder(() => ({ kind: 'decide-result', approvalId: 'a-1', outcome: 'applied' }));
    const client = createSdkClient(fake.transport);
    const outcome = await client.decide('a-1', 'approve');
    expect(outcome).toBe('applied');
    expect(fake.requests[0]).toEqual({ verb: 'decide', approvalId: 'a-1', answer: 'approve' });
    fake.setResponder(() => ({ kind: 'decide-result', approvalId: 'a-1', outcome: 'superseded' }));
    const outcome2 = await client.decide('a-1', 'reject', '不需要');
    expect(outcome2).toBe('superseded');
    expect(fake.requests[1]).toEqual({ verb: 'decide', approvalId: 'a-1', answer: 'reject', note: '不需要' });
  });

  it('subscribe/close：传输档透传', async () => {
    const fake = fakeTransport();
    const client = createSdkClient(fake.transport);
    const seen: string[] = [];
    const handle = await client.subscribe({ sessionId: 's-5', after: 2 }, (frame) => seen.push(frame.kind));
    expect(handle).toMatchObject({ sessionId: 's-5', highWaterSeq: 7 });
    expect(fake.liveParams).toEqual({ sessionId: 's-5', after: 2 });
    fake.liveListener?.({ kind: 'heartbeat', sessionId: 's-5', runState: 'idle', stage: null, elapsedMs: 0 });
    expect(seen).toEqual(['heartbeat']);
    await client.close();
    expect(fake.closedCount).toBe(1);
  });
});
