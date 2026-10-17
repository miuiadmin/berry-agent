/**
 * MCP 服务器桥测试（03 §10.1 连接语义——假子进程驱动，零真进程依赖）。
 *
 * 覆盖面：initialize 握手与 initialized 通知序 / tools/list 分页跟尽 /
 * call 映射（text/image/其余折 JSON）与 error 折 isError / spawn 失败与握手
 * 超时分类 MCP_CONNECT_FAILED / crash 在途拒 + onDown / 行帧超帽载体级收场
 * （封读 + 树杀）/ close 编舞（stdin.end 告别 → 宽限 → 树杀兜底；已退不杀；
 * 幂等）。
 */
import { describe, expect, it, vi } from 'vitest';
import { connectMcpServer } from './bridge.js';
import type { McpChildFace, McpSpawnFace } from './types.js';

/** 假子进程（脚本化服务器——onWrite 回调驱动「服务器侧行为」） */
class FakeChild implements McpChildFace {
  readonly written: string[] = [];
  ended = false;
  killed = false;
  destroyed = false;
  /** stdin.end 后自退开关（真 stdio server 语义——告别即退；兜底例关旗测树杀） */
  autoExitOnEnd = true;
  private readonly exitCallbacks: ((info: { code: number | null; spawnError?: Error }) => void)[] = [];
  private readonly dataCallbacks: ((chunk: Buffer) => void)[] = [];
  /** 服务器侧行为钩（默认空实现——测试逐例注入） */
  onServerLine: (line: string) => void = () => undefined;

  readonly stdin = {
    write: (data: string) => {
      this.written.push(data);
      for (const piece of data.split('\n')) {
        if (piece.trim() !== '') this.onServerLine(piece);
      }
    },
    end: () => {
      this.ended = true;
      if (this.autoExitOnEnd) setTimeout(() => this.exit({ code: 0 }), 10);
    },
  };
  readonly stdout = {
    on: (_event: 'data', listener: (chunk: Buffer) => void) => {
      this.dataCallbacks.push(listener);
    },
    destroy: () => {
      this.destroyed = true;
    },
  };
  readonly stderr = {
    on: () => undefined,
  };
  /** 服务器侧发一行（喂桥） */
  emit(line: string): void {
    this.emitRaw(Buffer.from(`${line}\n`));
  }
  /** 服务器侧发原始字节（巨行用——零字符串展开） */
  emitRaw(chunk: Buffer): void {
    for (const cb of [...this.dataCallbacks]) cb(chunk);
  }
  /** 触发退出（crash 编舞） */
  exit(info: { code: number | null; spawnError?: Error }): void {
    for (const cb of [...this.exitCallbacks]) cb(info);
  }
  onExit(callback: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCallbacks.push(callback);
  }
  kill(): void {
    this.killed = true;
  }
}

/** 起假 spawn 面（抓 child 引用供驱动） */
function makeFakeSpawn(): { spawn: McpSpawnFace; child: FakeChild } {
  const child = new FakeChild();
  const spawn: McpSpawnFace = {
    spawnInteractive: () => child,
  };
  return { spawn, child };
}

/** 标准握手应答器（initialize 响应 + tools/list 单页 N 工具） */
function scriptHandshake(child: FakeChild, tools: readonly { name: string; description?: string }[]): void {
  child.onServerLine = (line) => {
    const msg = JSON.parse(line) as { id?: number; method?: string };
    if (msg.method === 'initialize' && msg.id !== undefined) {
      child.emit(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }),
      );
    } else if (msg.method === 'tools/list' && msg.id !== undefined) {
      child.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } }));
    }
  };
}

/** 轮询直至谓词真（deadline ms） */
async function until(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect.unreachable('轮询超时');
}

const BASE_CONFIG = { command: '/usr/local/bin/fake-mcp' };

describe('connectMcpServer 连接编舞', () => {
  it('握手序：initialize 请求 → initialized 通知 → tools/list → 工具归一', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, [
      { name: 'search', description: '搜索' },
      { name: 'bad' }, // 无 description——归一容错
    ]);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn });
    expect(bridge.tools).toHaveLength(2);
    expect(bridge.tools[0]).toMatchObject({ name: 'search', description: '搜索' });
    // 帧序断言：initialize → initialized 通知 → tools/list
    const methods = child.written.map((w) => (JSON.parse(w) as { method: string }).method);
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    // 握手参数面（protocolVersion/clientInfo 披露）
    const init = JSON.parse(child.written[0]!) as { params: Record<string, unknown> };
    expect(init.params.protocolVersion).toBe('2024-11-05');
    expect(init.params.clientInfo).toMatchObject({ name: 'berry-agent' });
    await bridge.close();
  });

  it('tools/list 分页跟尽（nextCursor 两页合并）', async () => {
    const { spawn, child } = makeFakeSpawn();
    let listCalls = 0;
    child.onServerLine = (line) => {
      const msg = JSON.parse(line) as { id?: number; method?: string; params?: { cursor?: string } };
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      } else if (msg.method === 'tools/list' && msg.id !== undefined) {
        listCalls += 1;
        if (listCalls === 1) {
          expect(msg.params?.cursor).toBeUndefined(); // 首页无 cursor
          child.emit(
            JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'a' }], nextCursor: 'p2' } }),
          );
        } else {
          expect(msg.params?.cursor).toBe('p2');
          child.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'b' }] } }));
        }
      }
    };
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn });
    expect(bridge.tools.map((t) => t.name)).toEqual(['a', 'b']);
    expect(listCalls).toBe(2);
    await bridge.close();
  });

  it('注入腿 verbatim 透传锁——config env 引用形原文直达 spawn 面（桥不展开）', async () => {
    // 03 §10.9 注入腿（c-4）：@credentials:<name> 引用形在配置/桥/registry
    // 任何一环恒保持原文——展开唯一执法点 = exec buildChildEnv spawn 时刻。
    // 假 spawn 抓 request.env.set：值必须仍是引用形（若此层展开即违单点律）
    const child = new FakeChild();
    scriptHandshake(child, []);
    const seenRequests: Array<{ env?: { set?: Record<string, string> } }> = [];
    const spawn: McpSpawnFace = {
      spawnInteractive: (request) => {
        seenRequests.push(request);
        return child;
      },
    };
    const bridge = await connectMcpServer(
      'demo',
      { ...BASE_CONFIG, env: { GITHUB_TOKEN: '@credentials:github-token', LANG: 'C' } },
      { spawn },
    );
    expect(bridge.tools).toEqual([]);
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.env?.set).toEqual({
      GITHUB_TOKEN: '@credentials:github-token', // 引用形原文——桥面零展开
      LANG: 'C', // 普通值原样同车
    });
    await bridge.close();
  });

  it('spawn 失败（spawnError 位）→ MCP_CONNECT_FAILED', async () => {
    const { spawn, child } = makeFakeSpawn();
    const pending = connectMcpServer('demo', BASE_CONFIG, { spawn });
    child.exit({ code: null, spawnError: new Error('ENOENT') });
    await expect(pending).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
  });

  it('initialize 握手超时 → MCP_CONNECT_FAILED + 子进程收场（树杀不留孤儿）', async () => {
    const { spawn, child } = makeFakeSpawn();
    child.onServerLine = () => undefined; // 服务器装死——不答握手
    const pending = connectMcpServer('demo', { ...BASE_CONFIG, startup_timeout_sec: 0.05 }, { spawn });
    await expect(pending).rejects.toMatchObject({
      code: 'MCP_CONNECT_FAILED',
      message: expect.stringContaining('超时'),
    });
    await until(() => child.killed, 1_000);
  });

  it('行帧超帽——载体级失败收场：封读 + 树杀 + onFatal 语义（pending 拒）', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn });
    const callP = bridge.call('t', {});
    // 9MiB 单行原始字节（fatal 在 JSON 解析前发生——无需真 JSON 形）
    child.emitRaw(Buffer.concat([Buffer.alloc(9 * 1024 * 1024, 0x61), Buffer.from('\n')]));
    const result = await callP;
    expect(result.isError).toBe(true);
    await until(() => child.killed && child.destroyed, 1_000); // 封读 + 树杀双落
    await bridge.close(); // 幂等——不二次杀（已死 no-op 面）
  });
});

describe('McpBridge 调用与 crash', () => {
  it('call 成功映射：text 直映 / image 直映 / 其余形折 JSON 文本', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn });
    child.onServerLine = (line) => {
      const msg = JSON.parse(line) as { id?: number; method?: string; params?: { name?: string } };
      if (msg.method === 'tools/call' && msg.id !== undefined) {
        const results: Record<string, unknown> = {
          text: { content: [{ type: 'text', text: 'hello' }] },
          image: { content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }] },
          other: { content: [{ type: 'resource', resource: { uri: 'file:///x' } }] },
        };
        child.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: results[msg.params?.name ?? ''] }));
      }
    };
    const r1 = await bridge.call('text', {});
    expect(r1).toMatchObject({ content: [{ type: 'text', text: 'hello' }] });
    expect(r1.isError).toBeUndefined();
    const r2 = await bridge.call('image', {});
    expect(r2.content[0]).toMatchObject({ type: 'image', data: 'aGk=', mimeType: 'image/png' });
    const r3 = await bridge.call('other', {});
    expect(r3.content[0]).toMatchObject({ type: 'text' });
    await bridge.close();
  });

  it('call error 响应与 isError 位都折 isError 结果（数据面不改抛出面）', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn });
    child.onServerLine = (line) => {
      const msg = JSON.parse(line) as { id?: number; method?: string; params?: { name?: string } };
      if (msg.method === 'tools/call' && msg.id !== undefined) {
        if (msg.params?.name === 'boom') {
          child.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: '内部错' } }));
        } else {
          child.emit(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { content: [{ type: 'text', text: '半失败' }], isError: true },
            }),
          );
        }
      }
    };
    const r1 = await bridge.call('boom', {});
    expect(r1.isError).toBe(true);
    expect((r1.content[0] as { text: string }).text).toContain('boom');
    const r2 = await bridge.call('soft', {});
    expect(r2.isError).toBe(true);
    await bridge.close();
  });

  it('crash（close 事件）→ 在途 call 拒 isError + onDown 一次送达 + 后续 call 快拒', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn });
    const down = vi.fn();
    bridge.onDown(down);
    const callP = bridge.call('t', {});
    child.exit({ code: 1 });
    const result = await callP;
    expect(result.isError).toBe(true);
    expect(down).toHaveBeenCalledTimes(1);
    expect(down.mock.calls[0]![0]).toContain('code=1');
    // 后续调用：快拒（服务器已断——不悬挂）
    const after = await bridge.call('t', {});
    expect(after.isError).toBe(true);
    expect((after.content[0] as { text: string }).text).toContain('已断开');
    // 迟到订阅即回调（不丢事件）
    const late = vi.fn();
    bridge.onDown(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

describe('McpBridge.close 协议化关停', () => {
  it('编舞：stdin.end 告别 → 宽限尽未退 → 树杀兜底', async () => {
    const { spawn, child } = makeFakeSpawn();
    child.autoExitOnEnd = false; // 挂死 server——宽限尽必树杀
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn, closeGraceMs: 50 });
    const closing = bridge.close();
    expect(child.ended).toBe(true); // 告别即时落
    await closing;
    expect(child.killed).toBe(true); // 宽限 50ms 尽——树杀
  });

  it('宽限内自退——不树杀', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn, closeGraceMs: 2_000 });
    const closing = bridge.close();
    setTimeout(() => child.exit({ code: 0 }), 30); // 宽限内自退
    await closing;
    expect(child.killed).toBe(false);
  });

  it('幂等——二次 close 复用首次结算（告别不双发）', async () => {
    const { spawn, child } = makeFakeSpawn();
    scriptHandshake(child, []);
    const bridge = await connectMcpServer('demo', BASE_CONFIG, { spawn, closeGraceMs: 30 });
    const p1 = bridge.close();
    const p2 = bridge.close();
    expect(p1).toBe(p2); // 同一结算 promise
    await p1;
    expect(child.ended).toBe(true);
  });
});
