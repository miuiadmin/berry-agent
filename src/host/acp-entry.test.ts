/**
 * host/acp-entry 组合根测试——ACP server 包装宿主全环（真盘真库 + faux
 * provider + PassThrough 传输对——mock 只停在模型层）。
 *
 * 钉死：initialize 版本透传 / session:new 双面（models + configOptions）/
 * prompt 挂终态回执 + 直播 agent_message_chunk 外达 / 审批全链（write 工具
 * ask → session/request_permission 外推 → 应答后工具真执行 + 第二轮收口）/
 * session:resume 未知 id 注册码折 -32602 / set_model 落账与 fail-loud /
 * 凭证就绪过滤宇宙（models 块第四消费位 + 设置位就绪闸——07 ux-4 批注）/
 * session:list 首问快照投影 / EOF 优雅退 0。断言只对协议面与事件类型位。
 */
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';

import { runAcpEntry } from './acp-entry.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（pi-ai 面形状——'ok' 文本终态） */
function messageOf(text = 'ok'): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** faux 响应脚本件（工具调用形——write 工具执行产生 ask） */
function toolCallOf(id: string, name: string, args: Record<string, unknown>): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    usage: NO_USAGE,
    stopReason: 'toolUse',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 出站帧（请求/通知/应答三态共账） */
interface WireFrame {
  jsonrpc: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** ACP 传输 rig（id 关联请求等待 + 通知/入站请求账 + 入站请求应答器） */
class AcpRig {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  private seq = 0;
  private buf = '';
  readonly frames: WireFrame[] = [];
  readonly notifications: WireFrame[] = [];
  readonly serverRequests: WireFrame[] = [];
  private readonly waiters = new Map<number, (frame: WireFrame) => void>();

  constructor() {
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      this.buf += chunk;
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        const frame = JSON.parse(line) as WireFrame;
        this.frames.push(frame);
        if (frame.method !== undefined && frame.id !== undefined) this.serverRequests.push(frame);
        else if (frame.method !== undefined) this.notifications.push(frame);
        if (typeof frame.id === 'number') {
          const waiter = this.waiters.get(frame.id);
          if (waiter !== undefined) {
            this.waiters.delete(frame.id);
            waiter(frame);
          }
        }
      }
    });
  }

  ask(method: string, params?: unknown): Promise<WireFrame> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.waiters.set(id, resolve);
      this.input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    this.input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  respondServerRequest(frame: WireFrame, result: unknown): void {
    this.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })}\n`);
  }

  /** 等待某通知谓词成立（直播帧异步到达——轮询 10ms 4s 帽） */
  async until(pred: () => boolean): Promise<void> {
    const t0 = Date.now();
    for (;;) {
      if (pred()) return;
      if (Date.now() - t0 > 4_000) throw new Error('等待通知超时');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  end(): void {
    this.input.end();
  }
}

/** 临时目录账（afterAll 清场） */
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** rig 选项（凭证就绪族注入面——缺省 faux-acp 键在场 = 全目录就绪） */
interface RigAcpOpts {
  /** env 面（缺省注入 FAUX_ACP_API_KEY 使 faux-acp 就绪；显式 {} = 全渠道未就绪——空集态形） */
  readonly env?: Record<string, string>;
  /** 追加 provider（凭证缺席对照位——目录在册但零凭证） */
  readonly extraProviders?: readonly Provider[];
}

/** acp 速记（faux provider 预脚本 + PassThrough 传输对；cwd 锚临时目录） */
function rigAcp(responses: Array<() => PiAssistantMessage>, opts: RigAcpOpts = {}) {
  // 目录注册双模型（m1 起跑 / m2 切换目标——目录内 spec 才不触发悬空回落）。
  const faux = fauxProvider({ provider: 'faux-acp', models: [{ id: 'm1' }, { id: 'm2' }] });
  faux.setResponses(responses);
  const dataDir = mkdtempSync(join(tmpdir(), 'acp-data-'));
  dirs.push(dataDir);
  const ws = mkdtempSync(join(tmpdir(), 'acp-ws-'));
  dirs.push(ws);
  const rig = new AcpRig();
  const providers: readonly Provider[] = [faux.provider, ...(opts.extraProviders ?? [])];
  const entry = runAcpEntry({
    io: { input: rig.input, output: rig.output },
    dataDir,
    cwd: ws,
    providers,
    model: 'faux-acp/m1',
    // 凭证就绪律（tui-entry FAUX_KEY3_API_KEY 先例形）：FAUX_ACP_API_KEY 在场
    // = faux-acp 渠道就绪（一般律键名合成 providerApiKeyEnvNames）；缺省注入
    // 保全既有用例绿，显式 {} 造全渠道未就绪形。
    env: opts.env ?? { FAUX_ACP_API_KEY: 'k' },
    version: 'v-test',
  });
  return { rig, entry, ws };
}

/** session/update 通知投影速记 */
function updatesOf(rig: AcpRig): Array<{ sessionId: string; update: Record<string, unknown> }> {
  return rig.notifications
    .filter((frame) => frame.method === 'session/update')
    .map((frame) => frame.params as { sessionId: string; update: Record<string, unknown> });
}

/* ---------------- 测试面 ---------------- */

describe('runAcpEntry 组合根', () => {
  it('全环：initialize → session/new → prompt 直播回执；resume/list/set_model 接力', async () => {
    const { rig, entry, ws } = rigAcp([() => messageOf('answer-1'), () => messageOf('answer-2')]);
    try {
      const init = await rig.ask('initialize', { protocolVersion: 1, clientInfo: { name: 'hapi', version: '1' } });
      const initResult = init.result as { agentInfo: { name: string; version: string } };
      expect(initResult.agentInfo).toEqual({ name: 'berry-agent', version: 'v-test' });

      const created = await rig.ask('session/new', { cwd: ws, mcpServers: [] });
      const newResult = created.result as {
        sessionId: string;
        models: { currentModelId: string };
        configOptions: Array<{ id: string; currentValue: string }>;
      };
      const sessionId = newResult.sessionId;
      expect(newResult.models.currentModelId).toBe('faux-acp/m1');
      expect(newResult.configOptions.find((option) => option.id === 'model')?.currentValue).toBe('faux-acp/m1');

      // 第一轮：直播 delta + 终态回执。
      const prompt1 = await rig.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text: '第一问' }] });
      expect((prompt1.result as { stopReason: string }).stopReason).toBe('end_turn');
      await rig.until(() => updatesOf(rig).some((entry_) => entry_.update.sessionUpdate === 'agent_message_chunk'));
      const deltas = updatesOf(rig)
        .filter((entry_) => entry_.sessionId === sessionId && entry_.update.sessionUpdate === 'agent_message_chunk')
        .map((entry_) => (entry_.update.content as { text?: string }).text);
      expect(deltas.join('')).toBe('answer-1');

      // set_model 落账：configOptions 回显换档。
      const switched = await rig.ask('session/set_config_option', {
        sessionId,
        configId: 'model',
        value: 'faux-acp/m2',
      });
      const switchResult = switched.result as { configOptions: Array<{ currentValue: string }> };
      expect(switchResult.configOptions[0]?.currentValue).toBe('faux-acp/m2');
      // 模型目录外 spec（语法合法但不在册）也会回显同值——fold 单源。

      // resume：同 id 幂等续接 + models 面仍在。
      const resumed = await rig.ask('session/resume', { sessionId, cwd: ws, mcpServers: [] });
      expect((resumed.result as { sessionId: string }).sessionId).toBe(sessionId);

      // 未知 id：注册码族折 -32602（连接存活）。
      const badResume = await rig.ask('session/resume', { sessionId: 'no-such-session', cwd: ws, mcpServers: [] });
      expect(badResume.error?.code).toBe(-32602);

      // session/list：首问快照投影。
      const listResp = await rig.ask('session/list', { cwd: ws });
      const sessions = (listResp.result as { sessions: Array<{ sessionId: string; title?: string }> }).sessions;
      expect(sessions.some((row) => row.sessionId === sessionId)).toBe(true);

      // EOF 优雅退 0。
      rig.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      rig.end();
      await entry.catch(() => 1);
    }
  });

  it('审批链：write 工具 ask → request_permission 外推 → 应答后真执行', async () => {
    const { rig, entry, ws } = rigAcp([
      () => messageOf('open'),
      () => toolCallOf('a1-write', 'write', { path: 'a1-acp.txt', content: 'A1' }),
      () => messageOf('done'),
    ]);
    try {
      const created = await rig.ask('session/new', { cwd: ws, mcpServers: [] });
      const sessionId = (created.result as { sessionId: string }).sessionId;

      // 第一拍：文本终态开会话。
      const prompt1 = await rig.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text: '开场' }] });
      expect((prompt1.result as { stopReason: string }).stopReason).toBe('end_turn');

      // 第二拍：write 工具调用 → ask 外推为 agent→client 请求。
      const prompt2Promise = rig.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text: '写文件' }] });
      await rig.until(() => rig.serverRequests.some((frame) => frame.method === 'session/request_permission'));
      const request = rig.serverRequests.find((frame) => frame.method === 'session/request_permission')!;
      const params = request.params as { options: Array<{ optionId: string }> };
      expect(params.options.map((option) => option.optionId)).toContain('allow_once');
      rig.respondServerRequest(request, { outcome: { outcome: 'selected', optionId: 'allow_once' } });

      const prompt2 = await prompt2Promise;
      expect((prompt2.result as { stopReason: string }).stopReason).toBe('end_turn');
      // 物理写达成（相对路径锚会话工作区根）。
      expect(existsSync(join(ws, 'a1-acp.txt'))).toBe(true);
      // 工具双段外达（start + completed）。
      await rig.until(() =>
        updatesOf(rig).some(
          (entry_) => entry_.update.sessionUpdate === 'tool_call_update' && entry_.update.status === 'completed',
        ),
      );

      rig.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      rig.end();
      await entry.catch(() => 1);
    }
  });

  it('set_mode 落 durable 档位事件；坏 spec 与坏 modeId 拒收', async () => {
    const { rig, entry, ws } = rigAcp([() => messageOf()]);
    try {
      const created = await rig.ask('session/new', { cwd: ws, mcpServers: [] });
      const sessionId = (created.result as { sessionId: string }).sessionId;

      const mode = await rig.ask('session/set_mode', { sessionId, modeId: 'read_only' });
      expect(mode.result).toEqual({});

      const badMode = await rig.ask('session/set_mode', { sessionId, modeId: 'turbo' });
      expect(badMode.error?.code).toBe(-32602);

      // 坏模型 spec（语法段不足）：注册码 LLM_MODEL_SPEC_INVALID 折 -32602。
      const badModel = await rig.ask('session/set_model', { sessionId, modelId: 'no-slash' });
      expect(badModel.error?.code).toBe(-32602);
      expect(badModel.error?.message).toContain('LLM_MODEL_SPEC_INVALID');

      rig.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      rig.end();
      await entry.catch(() => 1);
    }
  });

  it('凭证就绪宇宙：models 块只含就绪渠道；无凭证 spec 拒收且连接存活', async () => {
    // 对照位：faux-bare 渠道目录在册但零凭证（env 键缺席且无绑定行——全滤除）。
    const bare = fauxProvider({ provider: 'faux-bare', models: [{ id: 'x1' }] });
    const { rig, entry, ws } = rigAcp([() => messageOf()], { extraProviders: [bare.provider] });
    try {
      const created = await rig.ask('session/new', { cwd: ws, mcpServers: [] });
      const newResult = created.result as {
        sessionId: string;
        models: { currentModelId: string; availableModels: Array<{ modelId: string }> };
      };
      const sessionId = newResult.sessionId;
      // 就绪过滤第四消费位：faux-acp 两模型在列、faux-bare 全滤除。
      const ids = newResult.models.availableModels.map((row) => row.modelId);
      expect(ids).toContain('faux-acp/m1');
      expect(ids).toContain('faux-acp/m2');
      expect(ids.some((id) => id.startsWith('faux-bare/'))).toBe(false);
      // currentModelId 不过滤照实回显（就绪档恰在列——与下条空集态形互补）。
      expect(newResult.models.currentModelId).toBe('faux-acp/m1');

      // 无凭证 spec（语法良形、渠道目录在册）：LLM_CREDENTIAL_UNCONFIGURED 折 -32602。
      const rejected = await rig.ask('session/set_model', { sessionId, modelId: 'faux-bare/x1' });
      expect(rejected.error?.code).toBe(-32602);
      expect(rejected.error?.message).toContain('LLM_CREDENTIAL_UNCONFIGURED');

      // 拒收即不落账：resume 读口回读 models.currentModelId 仍为原档（throw 先于 setSessionModel）。
      const reread = await rig.ask('session/resume', { sessionId, cwd: ws, mcpServers: [] });
      expect((reread.result as { models: { currentModelId: string } }).models.currentModelId).toBe('faux-acp/m1');

      // 连接存活证：拒收后同连接继续设置就绪模型（回显换档成功）。
      const switched = await rig.ask('session/set_config_option', {
        sessionId,
        configId: 'model',
        value: 'faux-acp/m2',
      });
      const switchResult = switched.result as { configOptions: Array<{ currentValue: string }> };
      expect(switchResult.configOptions[0]?.currentValue).toBe('faux-acp/m2');

      rig.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      rig.end();
      await entry.catch(() => 1);
    }
  });

  it('空集态：全渠道未就绪时 availableModels 照实为空、currentModelId 照实回显', async () => {
    const { rig, entry, ws } = rigAcp([() => messageOf()], { env: {} });
    try {
      const created = await rig.ask('session/new', { cwd: ws, mcpServers: [] });
      const newResult = created.result as {
        models: { currentModelId: string; availableModels: unknown[] };
      };
      // 空集态照实（不做兜底注入）：列表空 + 当前档仍诚实呈现（缺席于列合法）。
      expect(newResult.models.availableModels).toEqual([]);
      expect(newResult.models.currentModelId).toBe('faux-acp/m1');

      rig.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      rig.end();
      await entry.catch(() => 1);
    }
  });
});
