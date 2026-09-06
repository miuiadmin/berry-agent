/**
 * sdk/mcp 件测试（批 13f——MCP server 包装面）。
 *
 * 协议级全注入：假装配桥（内存会话宇宙）+ PassThrough 传输对——受理/
 * admit/深校验/错误码全走真协议核（单源验证），只桥面为假。锁：五方法
 * 受理/两工具映射投影/幂等 admit 两档/业务错 isError 位/协议错码位/
 * 通知零应答/版本回显制/零直播面（事务外活体帧弃）/EOF 优雅收口。
 *
 * 应答等待位：PassThrough 'data' 事件异步派发——ask() 以 id 关联 promise
 * 逐请求等待（发号器模块级自增），通知/坏行等无 id 面走 tick 刷帧后断言。
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { SdkDurableEntry } from '../channels/index.js';

import { MCP_POLL_TOOL_NAME, MCP_PROMPT_TOOL_NAME, runMcpFace, type McpFaceHandle, type SdkMcpBridge } from './mcp.js';

/** JSON-RPC 应答帧形（测试断言面） */
interface RpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: {
    protocolVersion?: string;
    capabilities?: { tools?: unknown };
    serverInfo?: { name: string; version: string };
    tools?: Array<{ name: string; inputSchema?: { required?: string[] } }>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** 内存会话事件（假桥宇宙） */
interface MemEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

/** id 发号器（ask 关联位——模块级自增；各 rig 间唯一即可） */
let seq = 0;

/** 测试速记：假桥 + 传输对 + 应答账 */
function rig() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding('utf8');
  const responses: RpcResponse[] = [];
  /** id → 应答等待者（ask 逐请求等待位） */
  const waiters = new Map<number, (r: RpcResponse) => void>();
  let buf = '';
  output.on('data', (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      const resp = JSON.parse(line) as RpcResponse;
      responses.push(resp);
      const waiter = typeof resp.id === 'number' ? waiters.get(resp.id) : undefined;
      if (waiter !== undefined) {
        waiters.delete(resp.id as number);
        waiter(resp);
      }
    }
  });

  const sessions = new Map<string, MemEvent[]>();

  // 假装配桥：受理语义（admit/先决门/深校验/错误码）全在真协议核单源——
  // 桥面只兑现内存会话宇宙（submit 建会话落事件/查面窗口投影同语义）
  const bridge: SdkMcpBridge = {
    submitPrompt: (submit) => {
      let sid = submit.sessionId;
      if (sid === undefined) {
        sid = `s-${sessions.size + 1}`;
        sessions.set(sid, []);
      }
      const log = sessions.get(sid)!;
      log.push({
        type: 'user/message',
        seq: log.length,
        time: 1,
        data: { content: submit.content, dedupeKey: submit.messageId, source: 'channel:sdk' },
      });
      return { sessionId: sid, routedChannel: 'followUp' };
    },
    lookupDedupeKey: (sessionId, messageId) => {
      for (const event of sessions.get(sessionId) ?? []) {
        if (event.type !== 'user/message') continue;
        const data = event.data as { dedupeKey?: string; content?: unknown };
        if (data.dedupeKey === messageId) return typeof data.content === 'string' ? data.content : '';
      }
      return undefined;
    },
    interruptSession: () => {},
    queryEntries: (sessionId, since) => {
      const log = sessions.get(sessionId) ?? [];
      const entries: SdkDurableEntry[] = log
        .filter((e) => e.seq > since && e.seq < log.length)
        .map((e) => ({ type: e.type, seq: e.seq, time: e.time, data: e.data }));
      return { entries };
    },
    listSessions: () => [],
    highWaterOf: (sessionId) => sessions.get(sessionId)?.length,
    sessionStateOf: (sessionId) => (sessions.has(sessionId) ? 'open' : 'missing'),
    retryProbeOf: () => null,
  };

  const face: McpFaceHandle = runMcpFace({
    io: { input, output },
    bridge,
    serverInfo: { name: 'berry-agent', version: 'test' },
  });

  return {
    responses,
    face,
    sessions,
    /** 发一条 JSON-RPC 请求并等待该 id 应答（'data' 异步派发的等待位） */
    ask: (method: string, params?: unknown): Promise<RpcResponse> =>
      new Promise((resolve) => {
        const id = ++seq;
        waiters.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
    /** 发通知（id 缺席——零应答面） */
    notify: (method: string): void => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
    /** 发裸行（坏行注入） */
    sendRaw: (line: string): void => {
      input.write(`${line}\n`);
    },
    /** 刷一拍（无 id 面的等待位：让 'data' 事件落地） */
    tick: async (): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve));
    },
    end: (): void => {
      input.end();
    },
  };
}

/** 工具结果文本解析（content[0].text → JSON） */
function toolJson(resp: RpcResponse): Record<string, unknown> {
  expect(resp.result?.content?.[0]?.type).toBe('text');
  return JSON.parse(resp.result!.content![0]!.text!) as Record<string, unknown>;
}

describe('MCP 五方法协议面（10.1 反向位同集）', () => {
  it('initialize：已知集回显 + capabilities/serverInfo', async () => {
    const r = rig();
    const resp = await r.ask('initialize', { protocolVersion: '2024-11-05' });
    expect(resp.result?.protocolVersion).toBe('2024-11-05'); // 已知集内回显
    expect(resp.result?.capabilities?.tools).toEqual({}); // 工具面在场
    expect(resp.result?.serverInfo).toEqual({ name: 'berry-agent', version: 'test' });
    r.end();
  });

  it('initialize：未知/缺席版本 → 服务端缺省', async () => {
    const r = rig();
    expect((await r.ask('initialize', { protocolVersion: '1999-01-01' })).result?.protocolVersion).toBe('2025-06-18');
    expect((await r.ask('initialize', {})).result?.protocolVersion).toBe('2025-06-18');
    r.end();
  });

  it('notifications/initialized：通知零应答（id 缺席不回）', async () => {
    const r = rig();
    r.notify('notifications/initialized');
    await r.tick();
    expect(r.responses).toHaveLength(0);
    r.end();
  });

  it('ping → 空结果；未知方法 -32601；坏行 -32700 id null', async () => {
    const r = rig();
    expect((await r.ask('ping')).result).toEqual({});
    expect((await r.ask('resources/list')).error?.code).toBe(-32601);
    r.sendRaw('{broken');
    await r.tick();
    expect(r.responses.find((resp) => resp.id === null)?.error?.code).toBe(-32700);
    r.end();
  });

  it('tools/list：两件收窄面 + required 位', async () => {
    const r = rig();
    const tools = (await r.ask('tools/list')).result?.tools;
    expect(tools?.map((t) => t.name)).toEqual([MCP_PROMPT_TOOL_NAME, MCP_POLL_TOOL_NAME]);
    expect(tools?.[0]?.inputSchema?.required).toEqual(['message']);
    expect(tools?.[1]?.inputSchema?.required).toEqual(['sessionId']);
    r.end();
  });
});

describe('berry-agent 工具（→ prompt 动词——受理即回执）', () => {
  it('受理回执投影：sessionId/messageId/duplicate/routedChannel/highWaterSeq', async () => {
    const r = rig();
    const resp = await r.ask('tools/call', {
      name: MCP_PROMPT_TOOL_NAME,
      arguments: { message: '问', messageId: 'm-1' },
    });
    const payload = toolJson(resp);
    expect(payload.sessionId).toBe('s-1');
    expect(payload.messageId).toBe('m-1');
    expect(payload.duplicate).toBe(false);
    expect(payload.routedChannel).toBe('followUp');
    expect(typeof payload.highWaterSeq).toBe('number');
    r.end();
  });

  it('messageId 缺省计数器形（每次全新——幂等语义未申请即不虚构）', async () => {
    const r = rig();
    const first = toolJson(await r.ask('tools/call', { name: MCP_PROMPT_TOOL_NAME, arguments: { message: 'a' } }));
    const second = toolJson(
      await r.ask('tools/call', {
        name: MCP_PROMPT_TOOL_NAME,
        arguments: { message: 'b', sessionId: String(first.sessionId) },
      }),
    );
    expect(String(first.messageId)).toMatch(/^mcp-\d+$/); // 计数器形
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.duplicate).toBe(false);
    r.end();
  });

  it('幂等 admit：同键同内容重发 → duplicate 收执', async () => {
    const r = rig();
    const first = toolJson(
      await r.ask('tools/call', { name: MCP_PROMPT_TOOL_NAME, arguments: { message: '问', messageId: 'k' } }),
    );
    const again = toolJson(
      await r.ask('tools/call', { name: MCP_PROMPT_TOOL_NAME, arguments: { message: '问', messageId: 'k' } }),
    );
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.sessionId).toBe(first.sessionId); // 重发走原会话（messageIndex 反查）
    r.end();
  });

  it('同键异内容 → SDK_MESSAGE_CONFLICT（isError 位——业务错非协议错）', async () => {
    const r = rig();
    await r.ask('tools/call', { name: MCP_PROMPT_TOOL_NAME, arguments: { message: '问', messageId: 'k' } });
    const resp = await r.ask('tools/call', {
      name: MCP_PROMPT_TOOL_NAME,
      arguments: { message: '别的', messageId: 'k' },
    });
    expect(resp.result?.isError).toBe(true);
    expect(resp.result?.content?.[0]?.text).toContain('SDK_MESSAGE_CONFLICT');
    r.end();
  });

  it('missing 会话续接 → SESSION_NOT_FOUND（isError 位）', async () => {
    const r = rig();
    const resp = await r.ask('tools/call', {
      name: MCP_PROMPT_TOOL_NAME,
      arguments: { message: '问', sessionId: 'ghost', messageId: 'm' },
    });
    expect(resp.result?.isError).toBe(true);
    expect(resp.result?.content?.[0]?.text).toContain('SESSION_NOT_FOUND');
    r.end();
  });

  it('参数形不符（message 非 string）→ 同源深校验拒（参数不符文案）', async () => {
    const r = rig();
    const resp = await r.ask('tools/call', { name: MCP_PROMPT_TOOL_NAME, arguments: { message: 42 } });
    expect(resp.result?.isError).toBe(true);
    expect(resp.result?.content?.[0]?.text).toContain('参数不符');
    r.end();
  });
});

describe('berry-agent-reply 工具（→ getEntries 投影）', () => {
  /** 预置会话 s1 事件 seq 0..3 */
  function seeded() {
    const r = rig();
    r.sessions.set(
      's1',
      Array.from({ length: 4 }, (_, i) => ({ type: 'assistant/message', seq: i, time: 1, data: { n: i } })),
    );
    return r;
  }

  it('窗口投影：since=1 → (1,4) 窗 + lastSeq = 末条', async () => {
    const r = seeded();
    const payload = toolJson(
      await r.ask('tools/call', { name: MCP_POLL_TOOL_NAME, arguments: { sessionId: 's1', since: 1 } }),
    );
    expect((payload.entries as Array<{ seq: number }>).map((e) => e.seq)).toEqual([2, 3]);
    expect(payload.lastSeq).toBe(3);
    r.end();
  });

  it('since 缺省 -1 从头全窗', async () => {
    const r = seeded();
    const payload = toolJson(await r.ask('tools/call', { name: MCP_POLL_TOOL_NAME, arguments: { sessionId: 's1' } }));
    expect((payload.entries as Array<{ seq: number }>).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    r.end();
  });

  it('空窗：entries 空 + lastSeq = 续读位原样回显', async () => {
    const r = seeded();
    const payload = toolJson(
      await r.ask('tools/call', { name: MCP_POLL_TOOL_NAME, arguments: { sessionId: 's1', since: 3 } }),
    );
    expect(payload.entries).toEqual([]);
    expect(payload.lastSeq).toBe(3); // 无进展不虚报
    r.end();
  });

  it('missing 会话 → SESSION_NOT_FOUND（isError 位）', async () => {
    const r = rig();
    const resp = await r.ask('tools/call', { name: MCP_POLL_TOOL_NAME, arguments: { sessionId: 'ghost' } });
    expect(resp.result?.isError).toBe(true);
    expect(resp.result?.content?.[0]?.text).toContain('SESSION_NOT_FOUND');
    r.end();
  });
});

describe('未知工具与收口', () => {
  it('未知工具 → -32602（协议参数错——两件闭集外）', async () => {
    const r = rig();
    const resp = await r.ask('tools/call', { name: 'codex', arguments: {} });
    expect(resp.error?.code).toBe(-32602);
    r.end();
  });

  it('EOF → done 优雅 0；dispose 幂等双调不抛', async () => {
    const r = rig();
    await r.ask('ping');
    r.end();
    await expect(r.face.done).resolves.toBe(0);
    r.face.dispose(); // 幂等（宿主 closer 双保险位）
    r.face.dispose();
  });
});
