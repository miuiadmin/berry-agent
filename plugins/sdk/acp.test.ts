/**
 * core:sdk/acp 面协议级测试（03 §10.6 第四形态·CLI/SDK 进化批 A3）。
 *
 * 协议级全注入（mcp.test.ts 同族纪律）：假装配桥（内存会话宇宙）+
 * PassThrough 传输对——受理/admit/先决门语义全走真协议核单源，桥面只兑现
 * 内存宇宙；直播腿经 backend.onEnvelope 注入（UiBackend 契约位——与生产
 * conversation-stack onEvent 同入口）。
 *
 * 词面锚定（官方 v1 schema 核验位）：session/request_permission 带前缀、
 * permission option kind = allow_always（非 always_allow）、stopReason 闭集
 * （end_turn/cancelled）——断言按官方词面锁，防映射层漂移。
 */
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import type { SdkDurableEntry } from '../../src/channels/index.js';
import type { AgentEvent } from '../../src/contracts/index.js';

import { runAcpFace, type AcpFaceHandle } from './acp.js';
import type { SdkHttpBridge } from './types.js';

/** JSON-RPC 出站帧形（应答/通知/服务端请求三类断言面） */
interface RpcMessage {
  jsonrpc: string;
  id?: number | string | null;
  method?: string;
  params?: {
    sessionId?: string;
    update?: { sessionUpdate?: string; [key: string]: unknown };
    toolCall?: { toolCallId?: string; title?: string };
    options?: Array<{ optionId: string; kind: string }>;
    [key: string]: unknown;
  };
  result?: unknown;
  error?: { code: number; message: string; data?: { code?: string } };
}

/** 内存会话事件（假桥宇宙） */
interface MemEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
}

let idSeq = 0;

/**
 * 背压受控 sink（写出背压测试——确定性注入面）：highWaterMark 1 + 写回调
 * 挂起 → 每次 write 恒返 false（塞写形）；块滞 `held` 账不入 `received`；
 * release() 冲出全部挂起块并放 drain 事件——drain 恢复冲刷的断言面。
 */
class GatedSink extends Writable {
  private readonly held: Array<{ chunk: string; cb: (error?: Error | null) => void }> = [];
  readonly received: string[] = [];
  /** 累计达 _write 的块数（含挂起——「死面零再写」断言面） */
  writeCount = 0;

  constructor() {
    super({ highWaterMark: 1 });
  }

  get heldCount(): number {
    return this.held.length;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.writeCount++;
    this.held.push({ chunk: chunk.toString('utf8'), cb });
  }

  /** 冲出挂起块（回调全放——缓冲清空）+ 放 drain（手工事件——Node 自动腿之外的双保险） */
  release(): void {
    const held = this.held.splice(0);
    for (const { chunk, cb } of held) {
      this.received.push(chunk);
      cb(null);
    }
    this.emit('drain');
  }
}

/** rig 选项（背压/多连接复用注入面——缺省全 PassThrough 直通形） */
interface RigOpts {
  /** 出站流替换位（GatedSink 注入——背压确定性） */
  readonly output?: Writable;
  /** 后端 id 注入位（多连接复用形——唯一档断言面） */
  readonly backendId?: string;
  /** 写出背压 drain 超帽注入位（缺省 5s——测试确定性缩短） */
  readonly writeDrainTimeoutMs?: number;
}

/** 测试速记：假桥 + 传输对 + 出站帧账（应答/通知/服务端请求三分账） */
function rig(opts: RigOpts = {}) {
  const input = new PassThrough();
  const output = opts.output ?? new PassThrough();
  const messages: RpcMessage[] = [];
  const waiters = new Map<number | string, (m: RpcMessage) => void>();
  let buf = '';
  if (output instanceof PassThrough) {
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        const msg = JSON.parse(line) as RpcMessage;
        messages.push(msg);
        if (msg.id !== undefined && msg.id !== null) {
          const waiter = waiters.get(msg.id);
          if (waiter !== undefined) {
            waiters.delete(msg.id);
            waiter(msg);
          }
        }
      }
    });
  }

  const sessions = new Map<string, MemEvent[]>();
  const createdCWds = new Map<string, string>();
  const interrupted: string[] = [];

  const bridge: SdkHttpBridge = {
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
    interruptSession: (sessionId) => interrupted.push(sessionId),
    queryEntries: (sessionId, since) => {
      const log = sessions.get(sessionId) ?? [];
      const entries: SdkDurableEntry[] = log
        .filter((e) => e.seq > since && e.seq < log.length)
        .map((e) => ({ type: e.type, seq: e.seq, time: e.time, data: e.data }));
      return { entries };
    },
    listSessions: () => [],
    countSessions: () => 0,
    highWaterOf: (sessionId) => sessions.get(sessionId)?.length,
    sessionStateOf: (sessionId) => (sessions.has(sessionId) ? 'open' : 'missing'),
    retryProbeOf: () => null,
  };

  const face: AcpFaceHandle = runAcpFace({
    io: { input, output },
    bridge,
    createSession: (cwd) => {
      const sid = `s-new-${sessions.size + 1}`;
      sessions.set(sid, []);
      createdCWds.set(sid, cwd);
      return sid;
    },
    serverInfo: { name: 'berry-agent', version: 'test' },
    ...(opts.backendId !== undefined ? { backendId: opts.backendId } : {}),
    ...(opts.writeDrainTimeoutMs !== undefined ? { writeDrainTimeoutMs: opts.writeDrainTimeoutMs } : {}),
  });

  return {
    face,
    messages,
    sessions,
    createdCWds,
    interrupted,
    /** 发请求并等该 id 应答 */
    ask: (method: string, params?: unknown): Promise<RpcMessage> =>
      new Promise((resolve) => {
        const id = ++idSeq;
        waiters.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
    /** 应答服务端→客户端请求（request_permission 等） */
    respond: (id: string, result: unknown): void => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    },
    notify: (method: string, params?: unknown): void => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    sendRaw: (line: string): void => {
      input.write(`${line}\n`);
    },
    /** 直播事件注入（UiBackend.onEnvelope 生产入口同位——focused 位生产由核传） */
    emit: (sessionId: string, event: AgentEvent): void => {
      face.backend.onEnvelope?.({ sessionId, event }, true);
    },
    tick: async (): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve));
    },
    end: (): void => {
      input.end();
    },
  };
}

/** 先 initialize + session/new 起手（多数用例公共序） */
async function bootSession(): Promise<ReturnType<typeof rig> & { sessionId: string }> {
  const r = rig();
  const init = await r.ask('initialize', { protocolVersion: 1, clientCapabilities: {} });
  expect(init.error).toBeUndefined();
  const created = await r.ask('session/new', { cwd: '/tmp/ws', mcpServers: [] });
  const sessionId = (created.result as { sessionId: string }).sessionId;
  return { ...r, sessionId };
}

describe('ACP 面：initialize（握手与能力位）', () => {
  it('protocolVersion 已知值回显 + 能力位诚实（loadSession/image 在场、未承载位缺席）', async () => {
    const r = rig();
    const resp = await r.ask('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const result = resp.result as {
      protocolVersion: number;
      agentCapabilities: Record<string, unknown>;
      agentInfo: { name: string };
    };
    expect(result.protocolVersion).toBe(1);
    expect(result.agentCapabilities.loadSession).toBe(true);
    expect((result.agentCapabilities.promptCapabilities as { image: boolean }).image).toBe(true);
    expect(result.agentCapabilities.promptCapabilities).not.toHaveProperty('audio');
    expect(result.agentInfo.name).toBe('berry-agent'); // 对外声明值位
  });

  it('未知版本回服务端缺省（回显制——最新支持版 1）', async () => {
    const r = rig();
    const resp = await r.ask('initialize', { protocolVersion: 99 });
    expect((resp.result as { protocolVersion: number }).protocolVersion).toBe(1);
  });

  it('initialize 先行律：未初始化请求 -32002', async () => {
    const r = rig();
    const resp = await r.ask('session/new', { cwd: '/tmp/ws' });
    expect(resp.error?.code).toBe(-32002);
  });
});

describe('ACP 面：session/new（cwd 受理律 + mcpServers 拒收形）', () => {
  it('cwd 受理 → 会话铸造（createSession 收归一 cwd）', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    const resp = await r.ask('session/new', { cwd: '/tmp/project-x' });
    const sessionId = (resp.result as { sessionId: string }).sessionId;
    expect(typeof sessionId).toBe('string');
    expect(r.createdCWds.get(sessionId)).toBe('/tmp/project-x');
  });

  it('cwd 非绝对/缺席 = -32602（官方 MUST absolute）', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    expect((await r.ask('session/new', { cwd: 'relative/path' })).error?.code).toBe(-32602);
    expect((await r.ask('session/new', {})).error?.code).toBe(-32602);
  });

  it('mcpServers 非空 = -32602 拒收 + 指路（v1 有意边界）；缺席/空数组受理', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    const rejected = await r.ask('session/new', {
      cwd: '/tmp/ws',
      mcpServers: [{ name: 'fs', command: '/bin/mcp', args: [] }],
    });
    expect(rejected.error?.code).toBe(-32602);
    expect(rejected.error?.message).toContain('插件');
    expect((await r.ask('session/new', { cwd: '/tmp/ws', mcpServers: [] })).result).toBeDefined();
    expect((await r.ask('session/new', { cwd: '/tmp/ws-2' })).result).toBeDefined();
  });
});

describe('ACP 面：session/prompt（晚应答 + 直播映射）', () => {
  it('完整 turn：chunk 流 + 工具族投影 + agent_end(completed) → end_turn', async () => {
    const r = await bootSession();
    const promptPromise = r.ask('session/prompt', {
      sessionId: r.sessionId,
      prompt: [{ type: 'text', text: '分析一下' }],
    });
    await r.tick();
    // 直播序（onEnvelope 注入——message_update delta 形）
    r.emit(r.sessionId, { type: 'agent_start' });
    r.emit(r.sessionId, { type: 'message_start', role: 'assistant' });
    r.emit(r.sessionId, {
      type: 'message_update',
      role: 'assistant',
      partial: {
        role: 'assistant',
        content: [{ type: 'text', text: '开始分析' }],
        usage: undefined,
        stopReason: 'stop',
        timestamp: 1,
      } as never,
    });
    r.emit(r.sessionId, {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      name: 'read_file',
      arguments: { path: '/tmp/ws/a.ts' },
    });
    r.emit(r.sessionId, {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      result: { content: [{ type: 'text', text: '文件内容' }] },
    });
    r.emit(r.sessionId, { type: 'agent_end', status: 'completed', stopReason: 'stop' });
    const resp = await promptPromise;
    // 晚应答：stopReason end_turn（completed 映射）
    expect(resp.result).toEqual({ stopReason: 'end_turn' });
    // 通知投影序锁
    const updates = r.messages
      .filter((m) => m.method === 'session/update' && m.params?.sessionId === r.sessionId)
      .map((m) => m.params!.update as { sessionUpdate: string; [k: string]: unknown });
    const kinds = updates.map((u) => u.sessionUpdate);
    expect(kinds).toContain('agent_message_chunk');
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('tool_call_update');
    // tool_call 形锁（官方词面：toolCallId/title/kind/status）
    const toolCall = updates.find((u) => u.sessionUpdate === 'tool_call') as unknown as {
      toolCallId: string;
      title: string;
      kind: string;
      status: string;
    };
    expect(toolCall).toMatchObject({ toolCallId: 'call-1', title: 'read_file', kind: 'read', status: 'pending' });
    // 工具收口：completed + content 投影
    const done = updates.filter((u) => u.sessionUpdate === 'tool_call_update').pop() as unknown as {
      status: string;
      content: Array<{ type: string; content: { text: string } }>;
    };
    expect(done.status).toBe('completed');
    expect(done.content[0]?.content.text).toBe('文件内容');
  });

  it('thinking 块 → agent_thought_chunk（分立词面）', async () => {
    const r = await bootSession();
    const p = r.ask('session/prompt', { sessionId: r.sessionId, prompt: [{ type: 'text', text: 'q' }] });
    await r.tick();
    r.emit(r.sessionId, { type: 'message_start', role: 'assistant' });
    r.emit(r.sessionId, {
      type: 'message_update',
      role: 'assistant',
      partial: { role: 'assistant', content: [{ type: 'thinking', thinking: '先想一步' }] } as never,
    });
    r.emit(r.sessionId, { type: 'agent_end', status: 'completed' });
    await p;
    const kinds = r.messages
      .filter((m) => m.method === 'session/update')
      .map((m) => (m.params!.update as { sessionUpdate: string }).sessionUpdate);
    expect(kinds).toContain('agent_thought_chunk');
  });

  it('agent_end(failed) → 错误应答（非 stopReason——错误面两分）', async () => {
    const r = await bootSession();
    const p = r.ask('session/prompt', { sessionId: r.sessionId, prompt: [{ type: 'text', text: 'q' }] });
    await r.tick();
    r.emit(r.sessionId, { type: 'agent_end', status: 'failed', errorMessage: '上游 500' });
    const resp = await p;
    expect(resp.error?.code).toBe(-32603);
    expect(resp.error?.message).toContain('上游 500');
  });

  it('未知会话 = 业务错档（-32000 + data.code SESSION_NOT_FOUND）', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    const resp = await r.ask('session/prompt', {
      sessionId: 's-nope',
      prompt: [{ type: 'text', text: 'q' }],
    });
    expect(resp.error?.code).toBe(-32000);
    expect(resp.error?.data?.code).toBe('SESSION_NOT_FOUND');
  });

  it('image 内容块受理（promptCapabilities.image 的兑现）+ 不支持类型拒 -32602', async () => {
    const r = await bootSession();
    const bad = await r.ask('session/prompt', {
      sessionId: r.sessionId,
      prompt: [{ type: 'audio', data: 'x', mimeType: 'audio/wav' }],
    });
    expect(bad.error?.code).toBe(-32602);
    // image 形受理（ack 后挂 pending——正常晚应答序）
    const p = r.ask('session/prompt', {
      sessionId: r.sessionId,
      prompt: [
        { type: 'text', text: '看图' },
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
      ],
    });
    await r.tick();
    r.emit(r.sessionId, { type: 'agent_end', status: 'completed' });
    expect((await p).result).toEqual({ stopReason: 'end_turn' });
    // 受理事实：durable 落 user/message（假桥宇宙账）
    const userEntry = r.sessions.get(r.sessionId)?.find((e) => e.type === 'user/message');
    expect(userEntry).toBeDefined();
  });
});

describe('ACP 面：session/cancel（B-2 cancelled 收口律）', () => {
  it('通知受理 → interrupt 同蒙 → agent_end(aborted) → cancelled 终值', async () => {
    const r = await bootSession();
    const p = r.ask('session/prompt', { sessionId: r.sessionId, prompt: [{ type: 'text', text: '长任务' }] });
    await r.tick();
    r.notify('session/cancel', { sessionId: r.sessionId });
    await r.tick();
    expect(r.interrupted).toEqual([r.sessionId]); // interrupt 桥已触达
    r.emit(r.sessionId, { type: 'agent_end', status: 'aborted' });
    const resp = await p;
    expect(resp.result).toEqual({ stopReason: 'cancelled' }); // 官方 MUST 词面
  });
});

describe('ACP 面：session/load（全量重放 + 订阅挂接；B-13 定谳：loadSession 系 agent 自声明能力——官方语义客户端先验、agent 侧无检查义务，本面恒声明 true 故 load 恒可调）', () => {
  it('durable 全量投影为 session/update 序（user/assistant/thinking/工具族）→ 空应答 + 直播订阅', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    const created = await r.ask('session/new', { cwd: '/tmp/ws' });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    // 假桥宇宙预落 durable 四族
    const log = r.sessions.get(sessionId)!;
    log.push({ type: 'user/message', seq: 0, time: 1, data: { content: '问个问题' } });
    log.push({
      type: 'assistant/message',
      seq: 1,
      time: 2,
      data: {
        content: [
          { type: 'thinking', thinking: '想一想' },
          { type: 'text', text: '答一句' },
        ],
      },
    });
    log.push({ type: 'tool/call', seq: 2, time: 3, data: { callId: 'c-1', name: 'search', arguments: { q: 'x' } } });
    log.push({
      type: 'tool/result',
      seq: 3,
      time: 4,
      data: { callId: 'c-1', result: { content: [{ type: 'text', text: '命中 3 条' }] } },
    });

    const before = r.messages.filter((m) => m.method === 'session/update').length;
    const resp = await r.ask('session/load', { sessionId, cwd: '/tmp/ws', mcpServers: [] });
    expect(resp.result).toEqual({});
    const updates = r.messages
      .filter((m) => m.method === 'session/update')
      .slice(before)
      .map((m) => m.params!.update as { sessionUpdate: string; [k: string]: unknown });
    // 全量重放序锁（官方 MUST replay 整段）
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      'user_message_chunk',
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
    ]);
    expect((updates[0] as unknown as { content: { text: string } }).content.text).toBe('问个问题');
    // 重放毕挂直播订阅（hello after=尾 seq——后续 prompt 事件直达）
    expect(r.face.core.isSubscribed(sessionId)).toBe(true);
  });

  it('mcpServers 非空同拒；未知会话业务错', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    const bad = await r.ask('session/load', {
      sessionId: 's-x',
      cwd: '/tmp',
      mcpServers: [{ name: 'x', command: '/x', args: [] }],
    });
    expect(bad.error?.code).toBe(-32602);
    const missing = await r.ask('session/load', { sessionId: 's-none', cwd: '/tmp' });
    expect(missing.error?.data?.code).toBe('SESSION_NOT_FOUND');
  });
});

describe('ACP 面：session/request_permission（审批双向）', () => {
  async function pendingAsk(r: ReturnType<typeof rig> & { sessionId: string }) {
    // 先 prompt 挂订阅（askApproval 的 fail-closed 判据位）
    const p = r.ask('session/prompt', { sessionId: r.sessionId, prompt: [{ type: 'text', text: '写文件' }] });
    await r.tick();
    const askPromise = r.face.backend.askApproval!(r.sessionId, {
      summary: '写入 /tmp/ws/out.txt',
      suggestedEntry: 'write:out.txt',
    });
    await r.tick();
    return { askPromise, promptPromise: p };
  }

  it('ask → 服务端请求（官方词面 session/request_permission + allow_always kind）→ 应答映射 always', async () => {
    const r = await bootSession();
    const { askPromise } = await pendingAsk(r);
    // 服务端请求帧锁
    const req = r.messages.find((m) => m.method === 'session/request_permission');
    expect(req).toBeDefined();
    expect(req?.params?.sessionId).toBe(r.sessionId);
    expect(req?.params?.toolCall?.title).toBe('写入 /tmp/ws/out.txt');
    const options = req?.params?.options ?? [];
    expect(options.map((o) => o.kind)).toEqual(['allow_always', 'allow_once', 'reject_once']); // 官方 kind 词面
    // B1：optionId 携索引后缀（allow-always-0 = suggestions 索引 0——决定性映射供 suggestionIndex）
    expect((options[0] as { optionId: string }).optionId).toBe('allow-always-0');
    // 应答 allow-always-0 → ApprovalAnswer 结构形（B1：always + suggestionIndex 0 伴行）
    r.respond(req!.id as string, { outcome: { outcome: 'selected', optionId: 'allow-always-0' } });
    await expect(askPromise).resolves.toEqual({ answer: 'always', decision: { suggestionIndex: 0 } });
  });

  it('reject-once 拒 / cancelled 撤 / 未识选项保守拒（三应答映射）', async () => {
    const r = await bootSession();
    const latestRequestId = (): string =>
      r.messages.filter((m) => m.method === 'session/request_permission').pop()?.id as string;
    // reject
    let pending = await pendingAsk(r);
    r.respond(latestRequestId(), { outcome: { outcome: 'selected', optionId: 'reject-once' } });
    await expect(pending.askPromise).resolves.toBe('reject');
    // cancelled
    pending = await pendingAsk(r);
    r.respond(latestRequestId(), { outcome: { outcome: 'cancelled' } });
    await expect(pending.askPromise).resolves.toBe('cancel');
    // 未识选项：保守拒（官方安全条款——不视为批准）
    pending = await pendingAsk(r);
    r.respond(latestRequestId(), { outcome: { outcome: 'selected', optionId: 'mystery' } });
    await expect(pending.askPromise).resolves.toBe('reject');
  });

  it('无 suggestedEntry 的 ask：两档选项（always 档不虚设）', async () => {
    const r = await bootSession();
    const p = r.ask('session/prompt', { sessionId: r.sessionId, prompt: [{ type: 'text', text: 'x' }] });
    await r.tick();
    const askPromise = r.face.backend.askApproval!(r.sessionId, { summary: '执行命令' });
    await r.tick();
    const req = r.messages.filter((m) => m.method === 'session/request_permission').pop();
    expect((req?.params?.options ?? []).map((o) => o.kind)).toEqual(['allow_once', 'reject_once']);
    r.respond(req!.id as string, { outcome: { outcome: 'selected', optionId: 'allow-once' } });
    await expect(askPromise).resolves.toBe('approve');
    r.emit(r.sessionId, { type: 'agent_end', status: 'completed' });
    await p;
  });
});

describe('ACP 面：行帧与错误面', () => {
  it('坏行 -32700（id null 形）；未知方法 -32601（v1 声明集外）', async () => {
    const r = rig();
    await r.ask('initialize', { protocolVersion: 1 });
    r.sendRaw('{bad json');
    await r.tick();
    const parseError = r.messages.find((m) => m.error?.code === -32700);
    expect(parseError).toBeDefined();
    expect(parseError?.id).toBeNull();
    const resp = await r.ask('session/resume', { sessionId: 's-1', cwd: '/tmp' });
    expect(resp.error?.code).toBe(-32601); // 不声明即不受理（挂账族）
  });

  it('EOF 收口 → done 0；dispose 幂等', async () => {
    const r = rig();
    r.end();
    await expect(r.face.done).resolves.toBe(0);
    r.face.dispose(); // 幂等——不炸
  });

  it('dispose：在飞 ask 保守 unavailable（客户端消失语义）；pending prompt 随连接消亡', async () => {
    const r = await bootSession();
    const p = r.ask('session/prompt', { sessionId: r.sessionId, prompt: [{ type: 'text', text: 'x' }] });
    await r.tick();
    const askPromise = r.face.backend.askApproval!(r.sessionId, { summary: '某审批' });
    await r.tick();
    r.face.dispose();
    await expect(askPromise).resolves.toBe('unavailable');
    // pending prompt 无应答面（连接已亡）——终态事件在核关闭后静默，p 永悬
    // 属预期（客户端断线语义）；不 await p（防悬挂），只证不炸
    r.emit(r.sessionId, { type: 'agent_end', status: 'aborted' });
    expect(r.messages.filter((m) => m.id !== undefined && m.result !== undefined)).toHaveLength(2); // initialize + session/new 应答恒在、prompt 应答缺席
    void p;
  });
});

describe('ACP 面：写出背压（write 返 false → 入队等 drain——多连接复用批）', () => {
  it('塞写即停直写：后续帧入队；drain 恢复按序冲刷', async () => {
    const sink = new GatedSink();
    const r = rig({ output: sink });
    r.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }));
    await r.tick();
    // 首帧已塞（write 返 false——回调挂起）背压位起
    expect(sink.heldCount).toBe(1);
    r.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/ws' } }));
    await r.tick();
    // 第二帧入队等 drain——未达 sink（直写停摆）
    expect(sink.heldCount).toBe(1);
    expect(sink.writeCount).toBe(1);
    sink.release();
    await r.tick();
    // 首轮 drain 冲出队首帧——GatedSink 恒塞形下该帧再度挂起（返 false）
    expect(sink.received.length).toBe(1);
    sink.release();
    await r.tick();
    // drain 恢复：两帧按序落账（FIFO 保序）
    expect(sink.received.length).toBe(2);
    expect((JSON.parse(sink.received[0]!) as { id: number }).id).toBe(1);
    expect((JSON.parse(sink.received[1]!) as { id: number }).id).toBe(2);
    r.end();
    await r.face.done;
  });

  it('drain 缺席逾帽：判传输面坏死退 1（死面零再写）', async () => {
    const sink = new GatedSink();
    const r = rig({ output: sink, writeDrainTimeoutMs: 60 });
    r.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }));
    await r.tick();
    expect(sink.heldCount).toBe(1); // 塞写位起——帽开始计时
    await expect(r.face.done).resolves.toBe(1); // 逾帽收口（传输面坏死档）
    // 收口后零再写：后续请求不再产出帧（死面不复活）
    const before = sink.writeCount;
    r.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/ws' } }));
    await r.tick();
    expect(sink.writeCount).toBe(before);
  });

  it('收口清队列：dispose 后余队零冲出（drain 迟到不复活死面）', async () => {
    const sink = new GatedSink();
    const r = rig({ output: sink });
    r.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }));
    await r.tick(); // 塞写背压位起（1 帧挂起）
    r.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp/ws' } }));
    await r.tick(); // 第二帧入队
    r.face.dispose();
    await expect(r.face.done).resolves.toBe(0);
    sink.release(); // 迟到 drain——监听已撤、队列已清
    await r.tick();
    // 仅首帧（塞写时已达 sink 者）冲出；入队帧被清零冲出
    expect(sink.received.length).toBe(1);
    expect(sink.writeCount).toBe(1);
  });
});

describe('ACP 面：backendId 唯一档（多连接复用形——净除义务素材）', () => {
  it('缺省 acp；宿主赋值透传（socket 连接 acp-sock-<n> 档）', () => {
    const r = rig();
    expect(r.face.backend.id).toBe('acp');
    const r2 = rig({ backendId: 'acp-sock-1' });
    expect(r2.face.backend.id).toBe('acp-sock-1');
    r.end();
    r2.end();
  });
});
