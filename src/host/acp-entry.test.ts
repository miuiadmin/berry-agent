/**
 * acp/mcp 两入口的面亡执法 + ACP 面·真装配冒烟（「sdk 禁 ⇒ 面亡」族
 * 第四/五入口——03 §10.6 A3 条与 MCP 形同批批注的落码锁）。
 *
 * 修前红锚：mcp-entry 先行直调恒活（从不查装载态）——disabled 形必红；
 * acp-entry 为新件同判式同批落地。真装配冒烟走完整组合根（faux provider
 * 真跑一轮 turn——initialize/session/new/prompt→end_turn 全链）；多连接
 * 复用批补 socket 第二连接独立 face / 信封路由亲和 / 全连接退场才收进程 /
 * busy 撞锁代理整链四锁。
 */
import { PassThrough } from 'node:stream';
import net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';
import { fauxProvider } from '../llm/index.js';

import { runAcpEntry } from './acp-entry.js';
import { runMcpEntry } from './mcp-entry.js';
import { acpSocketPath } from './acp-share.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 造禁用 core:sdk 的数据目录（enabled.yaml 单层 overlay——03 §5.3） */
function dataDirWithSdkDisabled(): string {
  const dir = tmpDir('acp-seat-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: core:sdk\n    disabled: true\n');
  return dir;
}

/** 行账流（协议行收集——出站帧断言通道） */
class LineRig {
  readonly stream = new PassThrough();
  readonly lines: string[] = [];
  private pending = '';
  constructor() {
    this.stream.setEncoding('utf8');
    this.stream.on('data', (chunk: string) => {
      this.pending += chunk;
      const parts = this.pending.split('\n');
      this.pending = parts.pop() ?? '';
      for (const line of parts) if (line.length > 0) this.lines.push(line);
    });
  }
  json(i: number): Record<string, unknown> {
    return JSON.parse(this.lines[i]!) as Record<string, unknown>;
  }
}

describe('「sdk 禁 ⇒ 面亡」族第四/五入口执法（CLI/SDK 进化批 A3）', () => {
  it('acp：core:sdk 禁用 → 拒启退 2（daemon 同码——修前恒活形必红的对偶新件）', async () => {
    const code = await runAcpEntry({
      io: { input: new PassThrough(), output: new PassThrough() },
      dataDir: dataDirWithSdkDisabled(),
      version: 'test',
    });
    expect(code).toBe(2);
  });

  it('mcp：core:sdk 禁用 → 拒启退 2（第五入口补齐——修前恒活必红锚）', async () => {
    const code = await runMcpEntry({
      io: { input: new PassThrough(), output: new PassThrough() },
      dataDir: dataDirWithSdkDisabled(),
      version: 'test',
    });
    expect(code).toBe(2);
  });
});

/** 等待谓词真（时间基轮询——真装配涉真 I/O，setImmediate 轮次不够） */
async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('ACP 入口·真装配冒烟（faux provider 全链）', () => {
  it('initialize → session/new → session/prompt → end_turn（真组合根一轮 turn）', async () => {
    const faux = fauxProvider({ provider: 'faux-acp', models: [{ id: 'm1' }] });
    const reply = {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok-from-faux' }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'stop',
      timestamp: 1,
    } as unknown as PiAssistantMessage;
    faux.setResponses([() => reply]);

    const input = new PassThrough();
    const out = new LineRig();
    const ws = tmpDir('acp-ws-');
    const dataDir = tmpDir('acp-data-');
    const entry = runAcpEntry({
      io: { input, output: out.stream },
      cwd: ws,
      dataDir,
      providers: [faux.provider],
      model: 'faux-acp/m1',
      env: {},
      version: 'test',
    });

    // 握手 + 建会话（cwd = 真临时工作区）
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } })}\n`);
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: ws, mcpServers: [] } })}\n`,
    );
    await waitFor(() => out.lines.length >= 2);
    const created = out.json(1) as { result?: { sessionId?: string } };
    expect(typeof created.result?.sessionId).toBe('string');

    // 发一轮 prompt → 晚应答 end_turn
    const sessionId = created.result!.sessionId!;
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: '跑一下' }] } })}\n`,
    );
    let settled: Record<string, unknown> | undefined;
    await waitFor(() => {
      for (const line of out.lines) {
        const msg = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
        if (msg.id === 3 && msg.result !== undefined) settled = msg.result;
      }
      return settled !== undefined;
    });
    expect(settled).toEqual({ stopReason: 'end_turn' });
    // 直播通知在场（agent_message_chunk——faux 回文经 conversation 核真流）
    const updates = out.lines
      .map((line) => JSON.parse(line) as { method?: string; params?: { update?: { sessionUpdate?: string } } })
      .filter((m) => m.method === 'session/update')
      .map((m) => m.params?.update?.sessionUpdate);
    expect(updates).toContain('agent_message_chunk');
    input.end();
    await expect(entry).resolves.toBe(0);
  });
});

/* ---------------- 多连接复用（撞锁代理形）测试基建 ---------------- */

/** 零用量（faux 响应脚本件共用） */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（pi-ai 面形状——文本终态） */
function messageOf(text: string): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 出站 JSON-RPC 帧行 → session/update 投影（亲和断言面——含 content 文本） */
function updateEntries(lines: readonly string[]): Array<{ sessionId: string; sessionUpdate: string; text: string }> {
  const out: Array<{ sessionId: string; sessionUpdate: string; text: string }> = [];
  for (const line of lines) {
    let msg: {
      method?: string;
      params?: { sessionId?: string; update?: { sessionUpdate?: string; content?: { text?: string } } };
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      continue;
    }
    if (
      msg.method === 'session/update' &&
      msg.params?.sessionId !== undefined &&
      msg.params.update?.sessionUpdate !== undefined
    )
      out.push({
        sessionId: msg.params.sessionId,
        sessionUpdate: msg.params.update.sessionUpdate,
        text: msg.params.update.content?.text ?? '',
      });
  }
  return out;
}

let rpcSeq = 100; // 多连接测试请求 id 游标（与冒烟测试硬编码 id 空间不撞）

/** PassThrough 入线 + LineRig 出账的请求等待速记（真装配多步对话用） */
async function rpcAsk(
  input: PassThrough,
  out: LineRig,
  method: string,
  params: unknown,
): Promise<Record<string, unknown>> {
  const id = ++rpcSeq;
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  await waitFor(() =>
    out.lines.some((line) => {
      try {
        return (JSON.parse(line) as { id?: number }).id === id;
      } catch {
        return false;
      }
    }),
  );
  return JSON.parse(
    out.lines.find((line) => {
      try {
        return (JSON.parse(line) as { id?: number }).id === id;
      } catch {
        return false;
      }
    })!,
  ) as Record<string, unknown>;
}

/** socket 客户端 rig（行帧账 + id 关联请求等待——多连接复用测试） */
class SocketRig {
  readonly lines: string[] = [];
  private pending = '';
  private seq = 0;
  private readonly waiters = new Map<number, (frame: Record<string, unknown>) => void>();

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.pending += chunk;
      const parts = this.pending.split('\n');
      this.pending = parts.pop() ?? '';
      for (const line of parts) {
        if (line.length === 0) continue;
        this.lines.push(line);
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
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

  ask(method: string, params?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.waiters.set(id, resolve);
      this.socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  end(): void {
    this.socket.end();
  }
}

/** socket 客户端接入（holder 听就绪竞窗——轮询重试 4s 帽） */
async function connectRig(path: string): Promise<SocketRig> {
  const t0 = Date.now();
  for (;;) {
    try {
      const socket = await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect(path);
        s.once('connect', () => resolve(s));
        s.once('error', reject);
      });
      return new SocketRig(socket);
    } catch {
      if (Date.now() - t0 > 4_000) throw new Error('socket 接入超时（holder 未就绪）');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** entry 早退探针（false = 仍活——全连接退场不变式的显影窗） */
async function settledEarly(entry: Promise<number>): Promise<boolean> {
  return Promise.race([entry.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))]);
}

describe('ACP 入口·多连接复用（撞锁代理形）', () => {
  it('holder 听 acp.sock：socket 第二连接独立 face；信封路由双亲和；全连接退场才收进程', async () => {
    const faux = fauxProvider({ provider: 'faux-mux', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf('answer-a'), () => messageOf('answer-b')]);
    const input = new PassThrough();
    const out = new LineRig();
    const ws = tmpDir('acp-mux-ws-');
    const dataDir = tmpDir('acp-mux-data-');
    const entry = runAcpEntry({
      io: { input, output: out.stream },
      cwd: ws,
      dataDir,
      providers: [faux.provider],
      model: 'faux-mux/m1',
      env: {},
      version: 'test',
    });

    // socket 第二客户端（真 unix socket——等 holder 听就绪后接入）
    const sockRig = await connectRig(acpSocketPath(dataDir));
    try {
      const init = await sockRig.ask('initialize', { protocolVersion: 1 });
      expect((init.result as { agentInfo: { name: string } }).agentInfo.name).toBe('berry-agent');
      const createdB = await sockRig.ask('session/new', { cwd: ws, mcpServers: [] });
      const sessionB = (createdB.result as { sessionId: string }).sessionId;

      const initA = await rpcAsk(input, out, 'initialize', { protocolVersion: 1 });
      expect(initA.error).toBeUndefined();
      const createdA = await rpcAsk(input, out, 'session/new', { cwd: ws, mcpServers: [] });
      const sessionA = (createdA.result as { sessionId: string }).sessionId;
      expect(sessionA).not.toBe(sessionB); // 独立 face 各自铸会话

      // 信封路由亲和：A 的直播只在 stdio 连接出现——socket 连接零外泄
      const promptA = await rpcAsk(input, out, 'session/prompt', {
        sessionId: sessionA,
        prompt: [{ type: 'text', text: '问A' }],
      });
      expect((promptA.result as { stopReason: string }).stopReason).toBe('end_turn');
      await waitFor(() =>
        updateEntries(out.lines).some((e) => e.sessionId === sessionA && e.sessionUpdate === 'agent_message_chunk'),
      );
      expect(updateEntries(sockRig.lines).some((e) => e.sessionId === sessionA)).toBe(false);

      // 反向亲和：B 的直播只在 socket 连接出现——stdio 连接零外泄
      const promptB = await sockRig.ask('session/prompt', {
        sessionId: sessionB,
        prompt: [{ type: 'text', text: '问B' }],
      });
      expect((promptB.result as { stopReason: string }).stopReason).toBe('end_turn');
      await waitFor(() =>
        updateEntries(sockRig.lines).some((e) => e.sessionId === sessionB && e.sessionUpdate === 'agent_message_chunk'),
      );
      expect(updateEntries(out.lines).some((e) => e.sessionId === sessionB)).toBe(false);

      // 退场条件 = 全部连接退场：stdio EOF 后进程仍活（socket face 在场——
      // 修前单 face 形 EOF 即退）
      input.end();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await settledEarly(entry)).toBe(false);

      // 末连接退场 → 进程收场退 0
      sockRig.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      input.end();
      sockRig.end();
      await entry.catch(() => 1);
    }
  });

  it('busy 撞锁代理整链：第二入口撞 HOST_DATA_DIR_BUSY → socket 透明代理承载全会话', async () => {
    const faux = fauxProvider({ provider: 'faux-busy', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf('answer-via-proxy')]);
    const input = new PassThrough();
    const out = new LineRig();
    const ws = tmpDir('acp-busy-ws-');
    const dataDir = tmpDir('acp-busy-data-');
    const entry = runAcpEntry({
      io: { input, output: out.stream },
      cwd: ws,
      dataDir,
      providers: [faux.provider],
      model: 'faux-busy/m1',
      env: {},
      version: 'test',
    });

    // 第二入口：同 dataDir 同进程撞锁（pid 活判成立）→ busy 代理路接管注入 io
    const input2 = new PassThrough();
    const out2 = new LineRig();
    const entry2 = runAcpEntry({ io: { input: input2, output: out2.stream }, dataDir, version: 'test' });
    try {
      // initialize 经代理透传到 holder 新 face——字节链即证
      const init = await rpcAsk(input2, out2, 'initialize', { protocolVersion: 1 });
      expect((init.result as { agentInfo: { name: string } }).agentInfo.name).toBe('berry-agent');

      const created = await rpcAsk(input2, out2, 'session/new', { cwd: ws, mcpServers: [] });
      const sessionB = (created.result as { sessionId: string }).sessionId;

      // 代理路承载真对话轮（holder 侧第二 face 的订阅在账）
      const prompt = await rpcAsk(input2, out2, 'session/prompt', {
        sessionId: sessionB,
        prompt: [{ type: 'text', text: '经代理问' }],
      });
      expect((prompt.result as { stopReason: string }).stopReason).toBe('end_turn');
      await waitFor(() =>
        updateEntries(out2.lines).some((e) => e.sessionId === sessionB && e.sessionUpdate === 'agent_message_chunk'),
      );
      expect(
        updateEntries(out2.lines)
          .filter((e) => e.sessionId === sessionB && e.sessionUpdate === 'agent_message_chunk')
          .map((e) => e.text)
          .join(''),
      ).toContain('answer-via-proxy'); // faux 直播多帧照透(累计 partial)——内容到位即证

      // 代理退场（注入 io EOF → 半关写向 → holder face 收口）→ 第二入口退 0；
      // holder 不受涉（stdio face 在场——entry 仍活）
      input2.end();
      await expect(entry2).resolves.toBe(0);
      expect(await settledEarly(entry)).toBe(false);

      input.end();
      await expect(entry).resolves.toBe(0);
    } finally {
      input2.end();
      input.end();
      await Promise.allSettled([entry, entry2]);
    }
  });
});
