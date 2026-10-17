/**
 * 行帧 JSON-RPC 协议腿测试（03 §10.1 手写最小桥——纯逻辑零载体依赖）。
 *
 * 覆盖面：行劈跨 chunk 拼接 / 空行丢弃 / 行帧卫生两防线（残段累积超帽 +
 * 完整单行超帽——fatal 一次后恒死）/ 请求-响应关联往返 / error 响应折形 /
 * 请求超时结清 / failAll 总清 / 服务器方向分派（ping 照答、其余 -32601、
 * 通知忽略）/ 坏 JSON 行跳过。
 */
import { describe, expect, it, vi } from 'vitest';
import { JsonRpcConnection, LineDecoder } from './jsonrpc.js';

/** 喂多段字节（模拟流式 chunk 边界任意劈） */
function feedAll(decoder: LineDecoder, chunks: readonly Buffer[]): { lines: string[]; fatal: boolean } {
  const lines: string[] = [];
  let fatal = false;
  for (const chunk of chunks) {
    const r = decoder.feed(chunk);
    lines.push(...r.lines);
    if (r.fatal) fatal = true;
  }
  return { lines, fatal };
}

describe('LineDecoder 行劈', () => {
  it('多行一 chunk 整批劈出（空行丢弃）', () => {
    const decoder = new LineDecoder(1024);
    const r = decoder.feed(Buffer.from('{"a":1}\n\n{"b":2}\n'));
    expect(r.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(r.fatal).toBe(false);
  });

  it('一行多 chunk 跨界拼回', () => {
    const decoder = new LineDecoder(1024);
    const r = feedAll(decoder, [Buffer.from('{"hel'), Buffer.from('lo":"w'), Buffer.from('orld"}\n')]);
    expect(r.lines).toEqual(['{"hello":"world"}']);
  });

  it('残段 + 新 chunk 内两行——首段与历史拼接、尾段成新残段', () => {
    const decoder = new LineDecoder(1024);
    const r1 = decoder.feed(Buffer.from('head')); // 残段入账
    expect(r1.lines).toEqual([]);
    const r2 = decoder.feed(Buffer.from('-line1\ntail')); // 首行闭、新残段 tail
    expect(r2.lines).toEqual(['head-line1']);
    const r3 = decoder.feed(Buffer.from('-line2\n'));
    expect(r3.lines).toEqual(['tail-line2']);
  });

  it('防线一：无换行持续巨流——残段累积超帽 fatal 一次后恒死', () => {
    const decoder = new LineDecoder(64);
    const r1 = feedAll(decoder, [Buffer.alloc(32, 0x61), Buffer.alloc(32, 0x62)]); // 64 ≤ 帽未触
    expect(r1.fatal).toBe(false);
    const r2 = decoder.feed(Buffer.from('x')); // 65 > 64——fatal
    expect(r2.fatal).toBe(true);
    expect(r2.lines).toEqual([]);
    // 死后：再喂正常行恒空恒不报（一次语义）
    const r3 = decoder.feed(Buffer.from('ok\n'));
    expect(r3.lines).toEqual([]);
    expect(r3.fatal).toBe(false);
  });

  it('防线二：一次到位的完整巨行超帽——行不发 fatal 上报', () => {
    const decoder = new LineDecoder(64);
    const big = Buffer.concat([Buffer.alloc(80, 0x61), Buffer.from('\n')]);
    const r = decoder.feed(big);
    expect(r.fatal).toBe(true);
    expect(r.lines).toEqual([]); // 超帽行不外发（pending 由连接层结清）
  });

  it('同批先正常行后巨行——fatal 即全弃（半批不发）', () => {
    const decoder = new LineDecoder(64);
    const batch = Buffer.concat([Buffer.from('{"ok":1}\n'), Buffer.alloc(80, 0x61), Buffer.from('\n')]);
    const r = decoder.feed(batch);
    expect(r.fatal).toBe(true);
    expect(r.lines).toEqual([]);
  });
});

/** 起一座连接（send 收集产出帧——回环观察面） */
function makeConnection(options?: { lineLimitBytes?: number }) {
  const sent: string[] = [];
  const warn = vi.fn();
  const onFatal = vi.fn();
  const connection = new JsonRpcConnection({
    send: (line) => sent.push(line),
    warn,
    onFatal,
    ...(options?.lineLimitBytes !== undefined ? { lineLimitBytes: options.lineLimitBytes } : {}),
  });
  return { connection, sent, warn, onFatal };
}

/** 服务器侧响应帧喂入 */
function respond(conn: JsonRpcConnection, id: number, result: unknown): void {
  conn.feed(Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`));
}

describe('JsonRpcConnection 请求-响应关联', () => {
  it('往返：request 登记发帧、响应按 id 结清', async () => {
    const { connection, sent } = makeConnection();
    const p = connection.request('tools/list', { cursor: 'c1' });
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]!);
    expect(frame).toMatchObject({ jsonrpc: '2.0', method: 'tools/list', params: { cursor: 'c1' } });
    expect(typeof frame.id).toBe('number');
    respond(connection, frame.id, { tools: [] });
    await expect(p).resolves.toEqual({ tools: [] });
  });

  it('error 响应折 JsonRpcError（code/message/data 透传）', async () => {
    const { connection, sent } = makeConnection();
    const p = connection.request('tools/call', { name: 't' });
    const id = (JSON.parse(sent[0]!) as { id: number }).id;
    connection.feed(
      Buffer.from(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool', data: { n: 't' } } })}\n`,
      ),
    );
    await expect(p).rejects.toMatchObject({ rpcCode: -32602, message: expect.stringContaining('unknown tool') });
  });

  it('请求超时——按拒绝结清且迟到响应无副作用', async () => {
    vi.useFakeTimers();
    try {
      const { connection, sent } = makeConnection();
      const p = connection.request('tools/list', undefined, 100);
      const id = (JSON.parse(sent[0]!) as { id: number }).id;
      const assertion = expect(p).rejects.toThrow('请求超时');
      vi.advanceTimersByTime(150);
      await assertion;
      // 迟到响应：未知 id 分支静默（pending 已摘）——不炸不挂
      respond(connection, id, { late: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('failAll——pending 全拒（crash 结清面）；死后 request 快拒', async () => {
    const { connection } = makeConnection();
    const p1 = connection.request('tools/list');
    const p2 = connection.request('tools/call', { name: 'x' });
    const err = new Error('server 退出（code=1）');
    connection.failAll(err);
    await expect(p1).rejects.toBe(err);
    await expect(p2).rejects.toBe(err);
    await expect(connection.request('tools/list')).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
  });

  it('行帧超帽——onFatal 上报一次 + pending 拒 + 后续喂恒静默', async () => {
    const { connection, onFatal } = makeConnection({ lineLimitBytes: 64 });
    const p = connection.request('tools/list');
    connection.feed(Buffer.concat([Buffer.alloc(80, 0x61), Buffer.from('\n')]));
    await expect(p).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
    expect(onFatal).toHaveBeenCalledTimes(1);
    connection.feed(Buffer.from('more\n')); // 死后喂——无新 fatal 无新拒
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it('坏 JSON 行跳过（warn 计）——好行照常结清', async () => {
    const { connection, warn } = makeConnection();
    const p = connection.request('tools/list');
    connection.feed(Buffer.from('not-json\n'));
    expect(warn).toHaveBeenCalledTimes(1);
    respond(connection, 1, { ok: true }); // 首请求 id=1——好行照常
    await expect(p).resolves.toEqual({ ok: true });
  });
});

describe('JsonRpcConnection 服务器方向分派（transport v1 stdio-only）', () => {
  it('ping 照答——result null 帧回写', () => {
    const { connection, sent } = makeConnection();
    connection.feed(Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', id: 7, result: null });
  });

  it('sampling/elicitation 类请求一律 -32601 拒答（id 回显）', () => {
    const { connection, sent } = makeConnection();
    connection.feed(Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 's1', method: 'sampling/createMessage' })}\n`));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({
      jsonrpc: '2.0',
      id: 's1',
      error: { code: -32601, message: expect.stringContaining('sampling/createMessage') },
    });
  });

  it('通知忽略（tools/list_changed 不热刷——零产出零 fatal）', () => {
    const { connection, sent, warn } = makeConnection();
    connection.feed(Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n`));
    expect(sent).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('notify 发通知帧（无 id——initialized 消费面）', () => {
    const { connection, sent } = makeConnection();
    connection.notify('notifications/initialized');
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
  });
});
