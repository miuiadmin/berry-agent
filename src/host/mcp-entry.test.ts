/**
 * host/mcp-entry 组合根测试——MCP server 包装宿主全环（真盘真库 + faux
 * provider + PassThrough 传输对——mock 只停在模型层）。
 *
 * 钉死：装配序（运行时 → conversation 栈 → 装配桥 → face → backend 注册）
 * 下的 JSON-RPC 全环——initialize 版本透传 / tools/call 受理回执（异步档：
 * 受理即回执不阻塞）/ 轮询读面 durable 投影（user/message 归因落账 + run
 * 终态 turn/end 可观察 + lastSeq 续读位步进）/ 幂等重发 duplicate 收执 /
 * 续接轮事件面续长 / EOF 优雅退 0。断言只对协议面与事件类型位（禁断言
 * AI 生成文本）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';

import { runMcpEntry } from './mcp-entry.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（pi-ai 面形状——'ok' 文本终态） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** JSON-RPC 应答帧形（断言面） */
interface RpcResponse {
  jsonrpc: string;
  id: number | null;
  result?: {
    serverInfo?: { name: string; version: string };
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

/** durable 投影事件（断言面——type/seq/data 三位） */
interface PollEntry {
  type: string;
  seq: number;
  data?: unknown;
}

/** JSON-RPC 传输对（出站行聚帧账 + id 关联逐请求等待） */
class JsonRpcRig {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  private seq = 0;
  private buf = '';
  /** 出站行计数（零帧断言面——拒启档拒在 face 装配前） */
  outbound = 0;
  private readonly waiters = new Map<number, (r: RpcResponse) => void>();

  constructor() {
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      this.buf += chunk;
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        this.outbound += 1;
        const resp = JSON.parse(line) as RpcResponse;
        const waiter = resp.id !== null ? this.waiters.get(resp.id) : undefined;
        if (waiter !== undefined) {
          this.waiters.delete(resp.id!);
          waiter(resp);
        }
      }
    });
  }

  /** 发一条 JSON-RPC 请求并等待该 id 应答 */
  ask(method: string, params?: unknown): Promise<RpcResponse> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.waiters.set(id, resolve);
      this.input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** 收线（EOF 语义——对端 agent 退出） */
  end(): void {
    this.input.end();
  }
}

/** 临时目录账（afterAll 清场） */
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** mcp 速记（faux provider 预脚本 + PassThrough 传输对；cwd 锚临时目录） */
function rigMcp() {
  const faux = fauxProvider({ provider: 'faux-mcp', models: [{ id: 'm1' }] });
  faux.setResponses([() => messageOf(), () => messageOf(), () => messageOf(), () => messageOf()]); // 多轮余量
  const dataDir = mkdtempSync(join(tmpdir(), 'mcp-data-'));
  dirs.push(dataDir);
  const rig = new JsonRpcRig();
  const providers: readonly Provider[] = [faux.provider];
  const entry = runMcpEntry({
    io: { input: rig.input, output: rig.output },
    dataDir,
    cwd: mkdtempSync(join(tmpdir(), 'mcp-ws-')), // 新会话工作区根锚（数据目录已隔离）
    providers,
    model: 'faux-mcp/m1', // faux-only 运行时必须点名模型
    env: {},
    version: 'v-test',
  });
  return { rig, entry };
}

/** 工具调用速记（tools/call → content[0].text JSON 解析） */
async function callTool(
  rig: JsonRpcRig,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await rig.ask('tools/call', { name, arguments: args });
  expect(resp.result?.content?.[0]?.type).toBe('text');
  return JSON.parse(resp.result!.content![0]!.text!) as Record<string, unknown>;
}

/**
 * 轮询至第 turnEndCount 个 run 终态并归集 durable 事件（lastSeq 续读位
 * 步进——MCP 调用方跟尽义务的行为面）。
 *
 * 词汇注意：durable 投影是 SessionEvent 词面（turn/start·request/header·
 * assistant/message·turn/end）——agent_start/agent_end 属活体帧词面，MCP
 * 形零直播面不外达；run 终态的 durable 标记 = turn/end。
 */
async function pollToSettled(rig: JsonRpcRig, sessionId: string, turnEndCount: number): Promise<PollEntry[]> {
  const all: PollEntry[] = [];
  let since = -1;
  const t0 = Date.now();
  for (;;) {
    const payload = await callTool(rig, 'berry-agent-reply', { sessionId, since });
    all.push(...(payload.entries as PollEntry[]));
    since = payload.lastSeq as number;
    const ends = all.filter((e) => e.type === 'turn/end').length;
    if (ends >= turnEndCount) return all;
    if (Date.now() - t0 > 4_000) throw new Error(`轮询超时：turn/end×${turnEndCount} 未达（已见 ×${ends}）`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/* ---------------- 测试面 ---------------- */

describe('runMcpEntry 装配全环（异步档：受理即回执 + 轮询读面）', () => {
  it('initialize → 受理回执 → 轮询 durable 投影至 run 终态 → 幂等重发 → EOF 退 0', async () => {
    const { rig, entry } = rigMcp();

    // initialize：serverInfo 版本透传（版本真值归宿主装配层）
    const init = await rig.ask('initialize', { protocolVersion: '2025-06-18' });
    expect(init.result?.serverInfo).toEqual({ name: 'berry-agent', version: 'v-test' });

    // 受理回执：异步档——受理即回执（不阻塞至 run 终态）
    const ack = await callTool(rig, 'berry-agent', { message: '问', messageId: 'm-1' });
    expect(typeof ack.sessionId).toBe('string');
    expect(ack.sessionId).not.toBe('');
    expect(ack.duplicate).toBe(false);
    const sessionId = ack.sessionId as string;

    // 轮询读面：durable 投影至 run 终态
    const all = await pollToSettled(rig, sessionId, 1);
    // 受理归因落账：同键 user/message 恰一 + dedupeKey/来源归因（bridge 落账位）
    const userMsgs = all.filter((e) => e.type === 'user/message');
    expect(userMsgs).toHaveLength(1);
    expect((userMsgs[0]!.data as { dedupeKey?: string; source?: string }).dedupeKey).toBe('m-1');
    expect((userMsgs[0]!.data as { source?: string }).source).toBe('channel:sdk');
    expect(all.map((e) => e.type)).toContain('assistant/message'); // 定稿锚定帧在场（durable 兜底）

    // 幂等重发：同键同内容 → duplicate 收执（不重跑）
    const again = await callTool(rig, 'berry-agent', { message: '问', messageId: 'm-1' });
    expect(again.duplicate).toBe(true);

    // EOF 优雅退 0（运行时六步退出序走毕）
    rig.end();
    await expect(entry).resolves.toBe(0);
  });

  it('续接轮：第二 prompt 显式携句柄 → 事件面续长（turn/end×2）', async () => {
    const { rig, entry } = rigMcp();

    const first = await callTool(rig, 'berry-agent', { message: '一', messageId: 'c-1' });
    const sessionId = first.sessionId as string;
    await pollToSettled(rig, sessionId, 1); // 第一轮至终态

    // 显式携句柄续接（fresh 键 c-2）
    const second = await callTool(rig, 'berry-agent', { message: '二', messageId: 'c-2', sessionId });
    expect(second.duplicate).toBe(false);

    // 事件面续长：两轮 user/message + turn/end×2 同线可观察
    const all = await pollToSettled(rig, sessionId, 2);
    expect(all.filter((e) => e.type === 'user/message')).toHaveLength(2);

    rig.end();
    await expect(entry).resolves.toBe(0);
  });

  it('装载面活（批 19a-3 迁 assembly 公共段）：坏形清单 fail-loud 退 1——零帧出站拒在 face 装配前', async () => {
    const faux = fauxProvider({ provider: 'faux-mcp2', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'mcp-data-'));
    dirs.push(dataDir);
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins: [ Oops'); // 启用清单损坏 = 用户可自修配置错
    const rig = new JsonRpcRig();
    const entry = runMcpEntry({
      io: { input: rig.input, output: rig.output },
      dataDir,
      providers: [faux.provider],
      model: 'faux-mcp2/m1',
      env: {},
      version: 'v-test',
    });
    await expect(entry).resolves.toBe(1); // 干净退出档（不写 crash.log）
    expect(rig.outbound).toBe(0); // 拒在传输面装配前（迁移前直调栈不读清单——本例即装载真跑回归锁）
  });
});
