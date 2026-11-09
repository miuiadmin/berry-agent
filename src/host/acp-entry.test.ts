/**
 * acp/mcp 两入口的面亡执法 + ACP 面·真装配冒烟（「sdk 禁 ⇒ 面亡」族
 * 第四/五入口——03 §10.6 A3 条与 MCP 形同批批注的落码锁）。
 *
 * 修前红锚：mcp-entry 先行直调恒活（从不查装载态）——disabled 形必红；
 * acp-entry 为新件同判式同批落地。真装配冒烟走完整组合根（faux provider
 * 真跑一轮 turn——initialize/session/new/prompt→end_turn 全链）。
 */
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';
import { fauxProvider } from '../llm/index.js';

import { runAcpEntry } from './acp-entry.js';
import { runMcpEntry } from './mcp-entry.js';

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
