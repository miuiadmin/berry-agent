/**
 * sdk/acp 单元测试——ACP face 协议面全环（结构化注入面假桩 + PassThrough
 * 传输对；信封经 backend.onEnvelope 直喂——mock 不涉模型层，纯协议翻译面）。
 *
 * 钉死：initialize 幂等与能力位 / session:new 的 models+configOptions 双面 /
 * prompt 挂终态回执（stopReason 映射四档）/ 直播翻译（delta 剥取、工具双段、
 * usage_update、信封会话过滤）/ request_permission 应答映射与收口 unavailable /
 * set_mode 闭集与 set_config_option 回显 / 未知方法 -32601、坏行 -32700。
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { runAcpFace, type AcpFaceDeps, type AcpSubmitOutcome } from './acp.js';
import type { SessionEnvelope, UiBackend } from '../../src/channels/index.js';
import type { AgentEvent } from '../../src/contracts/index.js';

/* ---------------- 测试基建 ---------------- */

/** 采到的出站帧（请求/通知/应答三态共账——按需过滤） */
interface WireFrame {
  jsonrpc: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** 假注入面（脚本化终态 + 呼叫记录） */
interface FakeDeps extends AcpFaceDeps {
  readonly calls: {
    submit: Array<{ sessionId: string; content: string }>;
    sandbox: Array<{ sessionId: string; mode: string }>;
    model: Array<{ sessionId: string; spec: string }>;
  };
  /** submitPrompt 落定器（测试逐案 resolve——默认立即 completed/stop） */
  resolveSubmit?: (input: { sessionId: string; content: string }) => AcpSubmitOutcome;
  sandboxError?: Error;
}

function fakeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps {
  const deps: FakeDeps = {
    calls: { submit: [], sandbox: [], model: [] },
    createSession: () => 's-1',
    openSession: () => {},
    submitPrompt: async (input) => {
      deps.calls.submit.push({ sessionId: input.sessionId, content: input.content });
      return deps.resolveSubmit?.(input) ?? { kind: 'run', status: 'completed', stopReason: 'stop' };
    },
    interruptSession: () => {},
    listSessions: () => [{ id: 's-1', title: '第一问', lastActivityAt: 5 }],
    setSandboxMode: (sessionId, mode) => {
      deps.calls.sandbox.push({ sessionId, mode });
      if (deps.sandboxError) throw deps.sandboxError;
    },
    setModelSpec: (sessionId, spec) => {
      deps.calls.model.push({ sessionId, spec });
    },
    modelCatalog: () => [
      { id: 'faux-a/m1', name: 'Model One' },
      { id: 'faux-a/m2', name: 'Model Two' },
    ],
    modelOf: () => 'faux-a/m1',
    ...overrides,
  };
  return deps;
}

/** rig：face + 传输对 + 帧账（请求等待器 + 通知账 + 入站请求应答器） */
function makeRig() {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: WireFrame[] = [];
  const notifications: WireFrame[] = [];
  const serverRequests: WireFrame[] = [];
  let seq = 0;
  const waiters = new Map<number, (frame: WireFrame) => void>();

  output.setEncoding('utf8');
  let buf = '';
  output.on('data', (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      const frame = JSON.parse(line) as WireFrame;
      frames.push(frame);
      if (frame.method !== undefined && frame.id !== undefined) serverRequests.push(frame);
      else if (frame.method !== undefined) notifications.push(frame);
      if (frame.id !== undefined && frame.id !== null && typeof frame.id === 'number') {
        const waiter = waiters.get(frame.id);
        if (waiter !== undefined) {
          waiters.delete(frame.id);
          waiter(frame);
        }
      }
    }
  });

  function ask(method: string, params?: unknown): Promise<WireFrame> {
    return new Promise((resolve) => {
      const id = ++seq;
      waiters.set(id, resolve);
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** 应答 face 发来的 agent→client 请求（session/request_permission 一族） */
  function respondServerRequest(frame: WireFrame, result: unknown): void {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })}\n`);
  }

  function notify(method: string, params?: unknown): void {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  return { input, output, frames, notifications, serverRequests, ask, respondServerRequest, notify };
}

/** 信封速记 */
function envelope(sessionId: string, event: AgentEvent): SessionEnvelope {
  return { sessionId, event };
}

/** 部分快照消息速记（assistant 文本累积形——宽形铸型进 AgentEvent 联合） */
function partial(text: string): AgentEvent {
  return {
    type: 'message_update',
    role: 'assistant',
    partial: { role: 'assistant', content: text.length > 0 ? [{ type: 'text', text }] : [] },
  } as unknown as AgentEvent;
}

/* ---------------- 测试面 ---------------- */

describe('runAcpFace 协议面', () => {
  it('initialize 幂等并广播 resume 能力位', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;

    for (let i = 0; i < 2; i += 1) {
      const resp = await rig.ask('initialize', { protocolVersion: 1, clientInfo: { name: 'hapi', version: '1' } });
      const result = resp.result as {
        protocolVersion: number;
        agentCapabilities: { sessionCapabilities: Record<string, unknown> };
      };
      expect(result.protocolVersion).toBe(1);
      expect(Object.keys(result.agentCapabilities.sessionCapabilities)).toContain('resume');
    }
    face.dispose();
  });

  it('session/new 携 models 块与 model config option 双面', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;

    const resp = await rig.ask('session/new', { cwd: '/tmp/ws', mcpServers: [] });
    const result = resp.result as {
      sessionId: string;
      models: { availableModels: Array<{ modelId: string }>; currentModelId: string };
      configOptions: Array<{ id: string; category: string; currentValue: string; options: Array<{ value: string }> }>;
    };
    expect(result.sessionId).toBe('s-1');
    expect(result.models.availableModels.map((model) => model.modelId)).toEqual(['faux-a/m1', 'faux-a/m2']);
    expect(result.models.currentModelId).toBe('faux-a/m1');
    const modelOption = result.configOptions.find((option) => option.category === 'model');
    expect(modelOption?.id).toBe('model');
    expect(modelOption?.currentValue).toBe('faux-a/m1');
    expect(modelOption?.options.map((option) => option.value)).toEqual(['faux-a/m1', 'faux-a/m2']);
    face.dispose();
  });

  it('session/prompt 挂终态回执并外推直播翻译（delta 剥取）', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;
    const backend = face.backend as UiBackend<never>;

    // prompt 挂起：先喂信封再落定终态。
    deps.resolveSubmit = () => ({ kind: 'run', status: 'completed', stopReason: 'stop' });
    const promptPromise = rig.ask('session/prompt', {
      sessionId: 's-1',
      prompt: [{ type: 'text', text: '你好' }],
    });

    backend.onEnvelope?.(envelope('s-1', { type: 'message_start', role: 'assistant' }), true);
    backend.onEnvelope?.(envelope('s-1', partial('He')), true);
    backend.onEnvelope?.(envelope('s-1', partial('Hello')), true);
    backend.onEnvelope?.(envelope('s-1', { type: 'agent_end', status: 'completed' }), true);
    // 非本 face 会话的信封零外泄（后台 job 过滤）。
    backend.onEnvelope?.(envelope('s-other', partial('leak')), true);

    const resp = await promptPromise;
    expect((resp.result as { stopReason: string }).stopReason).toBe('end_turn');
    expect(deps.calls.submit).toEqual([{ sessionId: 's-1', content: '你好' }]);

    const chunks = rig.notifications
      .filter((frame) => frame.method === 'session/update')
      .map(
        (frame) =>
          frame.params as { sessionId: string; update: { sessionUpdate: string; content?: { text?: string } } },
      );
    expect(chunks.filter((update) => update.sessionId === 's-other')).toEqual([]);
    const messageDeltas = chunks
      .filter((update) => update.update.sessionUpdate === 'agent_message_chunk' && update.sessionId === 's-1')
      .map((update) => update.update.content?.text);
    // 累积快照剥 delta：He → llo（两次推送只外达增量）。
    expect(messageDeltas).toEqual(['He', 'llo']);
    face.dispose();
  });

  it('工具双段与 usage_update 翻译', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;
    const backend = face.backend as UiBackend<never>;

    // 会话先进本 face 账（信封过滤判据——resume 即注册）。
    await rig.ask('session/resume', { sessionId: 's-1' });
    rig.notifications.length = 0;

    backend.onEnvelope?.(
      envelope('s-1', { type: 'tool_execution_start', toolCallId: 't1', name: 'bash', arguments: { command: 'ls' } }),
      true,
    );
    backend.onEnvelope?.(envelope('s-1', { type: 'tool_execution_update', toolCallId: 't1', update: 'working' }), true);
    backend.onEnvelope?.(
      envelope('s-1', {
        type: 'tool_execution_end',
        toolCallId: 't1',
        result: { content: [{ type: 'text', text: 'done' }] },
      }),
      true,
    );
    backend.onEnvelope?.(envelope('s-1', { type: 'context_usage', usedTokens: 100, maxTokens: 1000 }), true);

    const updates = rig.notifications
      .filter((frame) => frame.method === 'session/update')
      .map((frame) => frame.params as { update: Record<string, unknown> })
      .map((params) => params.update);
    const start = updates.find((update) => update.sessionUpdate === 'tool_call') as {
      toolCallId: string;
      title: string;
      kind: string;
      rawInput: Record<string, unknown>;
    };
    expect(start.toolCallId).toBe('t1');
    expect(start.kind).toBe('execute');
    expect(start.rawInput).toEqual({ command: 'ls' });
    expect(start.title).toContain('bash');
    const end = updates.find(
      (update) => update.sessionUpdate === 'tool_call_update' && update.status === 'completed',
    ) as { rawOutput: string };
    expect(end.rawOutput).toBe('done');
    const usage = updates.find((update) => update.sessionUpdate === 'usage_update') as {
      sessionUpdate: string;
      used: number;
      size: number;
    };
    expect(usage.used).toBe(100);
    expect(usage.size).toBe(1000);
    face.dispose();
  });

  it('审批 ask 经 request_permission 外推并消费应答', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;
    const backend = face.backend as UiBackend<never>;

    // 会话先经 session/new 入本 face 名单（审批亲和闸——未知名单会话投
    // unavailable 弃权票不外推，2026-11-09 ACP 多连接复用批）。
    await rig.ask('session/new', { cwd: '/tmp/ws', mcpServers: [] });

    const askPromise = backend.askApproval!('s-1', { summary: 'run dangerous command', reason: 'bash rm' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.serverRequests.length).toBe(1);
    const request = rig.serverRequests[0]!;
    expect(request.method).toBe('session/request_permission');
    const params = request.params as { sessionId: string; options: Array<{ optionId: string; kind: string }> };
    expect(params.sessionId).toBe('s-1');
    expect(params.options.map((option) => option.optionId)).toEqual(['allow_once', 'allow_always', 'reject']);

    rig.respondServerRequest(request, { outcome: { outcome: 'selected', optionId: 'allow_always' } });
    await expect(askPromise).resolves.toBe('always');
    face.dispose();
  });

  it('审批亲和闸：未知名单会话投 unavailable 弃权票、零外推', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;
    const backend = face.backend as UiBackend<never>;

    // 's-other' 未经 session/new/resume 入名单——立即 unavailable（多连接下
    // 他人会话的审批不越权外推本连接客户端）。
    await expect(
      backend.askApproval!('s-other', { summary: 'run dangerous command', reason: 'bash rm' }),
    ).resolves.toBe('unavailable');
    expect(rig.serverRequests.length).toBe(0);
    face.dispose();
  });

  it('连接收口时在飞 ask 全部 unavailable', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;
    const backend = face.backend as UiBackend<never>;

    // 先入名单（保「连接收口」语义本体——非亲和闸的 unavailable）。
    await rig.ask('session/new', { cwd: '/tmp/ws', mcpServers: [] });
    const askPromise = backend.askApproval!('s-1', { summary: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    face.dispose();
    await expect(askPromise).resolves.toBe('unavailable');
  });

  it('set_mode 闭集映射与 set_config_option 回显', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;

    const modeResp = await rig.ask('session/set_mode', { sessionId: 's-1', modeId: 'dont_ask' });
    expect(modeResp.result).toEqual({});
    expect(deps.calls.sandbox).toEqual([{ sessionId: 's-1', mode: 'danger' }]);

    const badMode = await rig.ask('session/set_mode', { sessionId: 's-1', modeId: 'yolo' });
    expect(badMode.error?.code).toBe(-32602);

    const configResp = await rig.ask('session/set_config_option', {
      sessionId: 's-1',
      configId: 'model',
      value: 'faux-a/m2',
    });
    const result = configResp.result as { configOptions: Array<{ id: string; currentValue: string }> };
    expect(result.configOptions[0]?.id).toBe('model');
    expect(deps.calls.model).toEqual([{ sessionId: 's-1', spec: 'faux-a/m2' }]);

    const badConfig = await rig.ask('session/set_config_option', {
      sessionId: 's-1',
      configId: 'effort',
      value: 'high',
    });
    expect(badConfig.error?.code).toBe(-32602);
    face.dispose();
  });

  it('stopReason 四档映射（max_tokens / cancelled / refused）', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;

    const table: Array<[AcpSubmitOutcome, string]> = [
      [{ kind: 'run', status: 'completed', stopReason: 'length' }, 'max_tokens'],
      [{ kind: 'run', status: 'aborted' }, 'cancelled'],
      [{ kind: 'run', status: 'failed' }, 'refusal'],
      [{ kind: 'ignored' }, 'end_turn'],
    ];
    for (const [outcome, expected] of table) {
      deps.resolveSubmit = () => outcome;
      const resp = await rig.ask('session/prompt', { sessionId: 's-1', prompt: [{ type: 'text', text: 'q' }] });
      expect((resp.result as { stopReason: string }).stopReason).toBe(expected);
    }
    face.dispose();
  });

  it('session/list 投影与 cancel 通知、未知方法 -32601、坏行 -32700', async () => {
    const deps = fakeDeps();
    const rig = makeRig();
    const face = runAcpFace({
      io: { input: rig.input, output: rig.output },
      deps,
      serverInfo: { name: 'berry-agent', version: 'v-test' },
    });
    void face.done;

    const listResp = await rig.ask('session/list', { cwd: '/tmp/ws' });
    const sessions = (listResp.result as { sessions: Array<{ sessionId: string; title?: string }> }).sessions;
    expect(sessions[0]?.sessionId).toBe('s-1');
    expect(sessions[0]?.title).toBe('第一问');

    rig.notify('session/cancel', { sessionId: 's-1' });
    const unknown = await rig.ask('no/such/method', {});
    expect(unknown.error?.code).toBe(-32601);

    rig.input.write('{not json}\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const parseError = rig.frames.find((frame) => frame.error?.code === -32700);
    expect(parseError).toBeDefined();
    face.dispose();
  });
});
