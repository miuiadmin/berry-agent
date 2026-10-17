/**
 * mcp 兼容性互证——词面独立律的回归锁（词面独立于兄弟件、结构兼容真身）：
 * - 真 SpawnPipeline（node 真进程）直接结构赋 McpSpawnFace——spawnInteractive
 *   一法同形，桥零 exec import 可换真身；
 * - 真 node .cjs 假 MCP 服务器端到端：spawn → initialize 握手 → tools/list
 *   分页发现 → tools/call 往返 → close 协议化告别（stdin.end → 服务器真退）；
 * - 登记簿同册互证（owner=`mcp:<server>`——退出出册）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpawnPipeline } from '../exec/index.js';
import { connectMcpServer } from './bridge.js';
import type { McpSpawnFace } from './types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-mcp-compat-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * 假 MCP 服务器（.cjs——行帧 JSON-RPC 最小实现）：
 * initialize 应答 → tools/list 两页（首页 echo + nextCursor，次页 ping）→
 * tools/call 应答回声文本；stdin 结束（close 事件）即退——协议化告别语义。
 */
const SERVER_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n');
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  const msg = JSON.parse(t);
  if (msg.method === 'initialize' && msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } });
  } else if (msg.method === 'tools/list' && msg.id !== undefined) {
    const first = !msg.params || msg.params.cursor === undefined;
    if (first) {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: '回声', inputSchema: { type: 'object' } }], nextCursor: 'p2' } });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] } });
    }
  } else if (msg.method === 'tools/call' && msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + msg.params.name }] } });
  }
});
rl.on('close', () => process.exit(0));
`;

/** 轮询直至谓词真 */
async function until(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect.unreachable('轮询超时');
}

describe('真 SpawnPipeline ↔ McpSpawnFace（结构兼容）', () => {
  it('端到端：spawn → 握手 → 分页发现 → call 往返 → close 真退 + 登记簿出册', { timeout: 15_000 }, async () => {
    const serverPath = join(dir, 'fake-mcp.cjs');
    writeFileSync(serverPath, SERVER_SCRIPT);
    const pipeline = createSpawnPipeline();
    const face: McpSpawnFace = pipeline; // 直接结构赋值——零适配零包装

    const bridge = await connectMcpServer('demo', { command: execPath, args: [serverPath] }, { spawn: face });
    // 分页发现两页合并（echo + ping）
    expect(bridge.tools.map((t) => t.name)).toEqual(['echo', 'ping']);
    // 登记簿同册——owner 归属可见
    expect(pipeline.registry.list().some((e) => e.owner === 'mcp:demo')).toBe(true);
    // call 往返（真进程真回声）
    const result = await bridge.call('echo', {});
    expect((result.content[0] as { text: string }).text).toBe('echo:echo');
    expect(result.isError).toBeUndefined();

    // close：协议化告别 → 服务器自退（stdin end → exit 0）→ 登记簿出册
    await bridge.close();
    await until(() => pipeline.registry.list().length === 0, 5_000);
    expect(bridge.tools).toHaveLength(2); // 静态面不变（关停不洗白历史发现）
  });
});
