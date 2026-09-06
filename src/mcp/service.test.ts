/**
 * MCP 服务编排测试（03 §10.1 连接语义——假桥面驱动，零真进程）。
 *
 * 覆盖面：apply 零阻塞（同步返回即后台发现）/ 发现完成注册进「全局层」/
 * 单服务器失败降级（warn + ui.notify，不阻同行其余）/ 目录降级阈值（合计
 * >20 单件 mcp）/ crash 撤工具 + notify + 不自动重连 / scope 回卷全撤 /
 * 续段 scope 死——协议化关停不计失败（安静退场）/ 重复 apply 整值替换。
 */
import { describe, expect, it } from 'vitest';
import type { AgentToolResult } from '../contracts/index.js';
import { createMcpService } from './service.js';
import type {
  McpChildFace,
  McpConfig,
  McpRegisterToolsFace,
  McpScopeFace,
  McpServerConfig,
  McpSpawnFace,
} from './types.js';
import { MCP_DIRECTORY_TOOL_NAME } from './tools.js';
import { MCP_NATIVE_TOOL_LIMIT } from './types.js';

/** 假作用域（isDisposed 可控 + effect 登记收集） */
class FakeScope implements McpScopeFace {
  disposed = false;
  readonly disposers: (() => void)[] = [];
  get isDisposed(): boolean {
    return this.disposed;
  }
  effect(register: () => () => void): unknown {
    this.disposers.push(register());
    return undefined;
  }
}

/** 假注册表（活集语义——register 入活表、disposer 出活表 + 注销记录） */
class FakeRegistry implements McpRegisterToolsFace {
  readonly live = new Map<string, { name: string }>();
  readonly unregistered: string[] = [];
  get registered(): { name: string }[] {
    return [...this.live.values()];
  }
  register(def: { name: string }): () => void {
    this.live.set(def.name, def);
    return () => {
      this.live.delete(def.name);
      this.unregistered.push(def.name);
    };
  }
}

/** 假子进程（service 测试复用 bridge 的假件形——握手应答脚本化） */
class ScriptedChild implements McpChildFace {
  readonly written: string[] = [];
  autoExitOnEnd = true;
  killed = false;
  destroyed = false;
  ended = false;
  private readonly dataCallbacks: ((chunk: Buffer) => void)[] = [];
  private readonly exitCallbacks: ((info: { code: number | null; spawnError?: Error }) => void)[] = [];
  /** 脚本开关：装死不答握手（失败腿用） */
  dead = false;
  tools: readonly { name: string }[] = [];

  readonly stdin = {
    write: (data: string) => {
      this.written.push(data);
      for (const piece of data.split('\n')) {
        if (piece.trim() === '') continue;
        const msg = JSON.parse(piece) as { id?: number; method?: string; params?: { cursor?: string } };
        if (this.dead) continue;
        if (msg.method === 'initialize' && msg.id !== undefined) {
          this.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        } else if (msg.method === 'tools/list' && msg.id !== undefined) {
          const tools = this.tools.map((t) => ({ ...t, inputSchema: { type: 'object' } }));
          this.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } }));
        }
      }
    },
    end: () => {
      this.ended = true;
      if (this.autoExitOnEnd) setTimeout(() => this.exitCallbacks.forEach((cb) => cb({ code: 0 })), 5);
    },
  };
  readonly stdout = {
    on: (_e: 'data', cb: (chunk: Buffer) => void) => {
      this.dataCallbacks.push(cb);
    },
    destroy: () => {
      this.destroyed = true;
    },
  };
  readonly stderr = { on: () => undefined };
  emit(line: string): void {
    for (const cb of [...this.dataCallbacks]) cb(Buffer.from(`${line}\n`));
  }
  crash(): void {
    for (const cb of [...this.exitCallbacks]) cb({ code: 1 });
  }
  onExit(cb: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCallbacks.push(cb);
  }
  kill(): void {
    this.killed = true;
  }
}

/** 假 spawn 面（逐 server 建 ScriptedChild——配置抓取用） */
function makeFakeSpawn(): { spawn: McpSpawnFace; children: Map<string, ScriptedChild> } {
  const children = new Map<string, ScriptedChild>();
  const spawn: McpSpawnFace = {
    spawnInteractive: (request) => {
      const owner = request.owner; // mcp:<server>
      const child = new ScriptedChild();
      children.set(owner, child);
      return child;
    },
  };
  return { spawn, children };
}

const SERVER_CONFIG = (command = '/usr/local/bin/fake-mcp'): McpServerConfig => ({ command });

/** 轮询直至谓词真 */
async function until(predicate: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect.unreachable('轮询超时');
}

/** 组服务三件套 */
function makeService() {
  const { spawn, children } = makeFakeSpawn();
  const registry = new FakeRegistry();
  const scope = new FakeScope();
  const notified: string[] = [];
  const service = createMcpService({ spawn, registry, scope, notify: (m) => notified.push(m) });
  return { service, registry, scope, notified, children };
}

describe('createMcpService 编排', () => {
  it('apply 零阻塞——同步返回即注册面空，发现后台完成后注册进全局层', async () => {
    const { service, registry, children } = makeService();
    const config: McpConfig = { demo: SERVER_CONFIG() };
    service.apply(config);
    expect(registry.registered).toHaveLength(0); // 同步时刻——发现未完成
    const child = children.get('mcp:demo');
    expect(child).toBeDefined();
    child!.tools = [{ name: 'search' }, { name: 'write' }];
    await until(() => registry.registered.length === 2);
    expect(registry.registered.map((d) => d.name).sort()).toEqual(['demo__search', 'demo__write']);
    expect(service.liveServers()).toEqual([{ server: 'demo', toolCount: 2 }]);
  });

  it('单服务器失败降级——warn + ui.notify，不阻同行其余', async () => {
    const { service, registry, notified, children } = makeService();
    service.apply({
      bad: { ...SERVER_CONFIG(), startup_timeout_sec: 0.05 }, // 装死——握手超时快失败
      good: SERVER_CONFIG(),
    });
    children.get('mcp:bad')!.dead = true;
    const good = children.get('mcp:good')!;
    good.tools = [{ name: 'q' }];
    await until(() => notified.length >= 1);
    expect(notified[0]).toContain('bad');
    await until(() => registry.registered.length === 1);
    expect(registry.registered[0]!.name).toBe('good__q');
    expect(service.liveServers()).toEqual([{ server: 'good', toolCount: 1 }]);
  });

  it('目录降级——两服务器合计 >20 → 单件 mcp（schema 恒定）', async () => {
    const { service, registry, children } = makeService();
    service.apply({ a: SERVER_CONFIG(), b: SERVER_CONFIG() });
    children.get('mcp:a')!.tools = Array.from({ length: MCP_NATIVE_TOOL_LIMIT }, (_, i) => ({ name: `t${i}` }));
    children.get('mcp:b')!.tools = [{ name: 'extra' }];
    await until(() => registry.registered.length === 1);
    expect(registry.registered[0]!.name).toBe(MCP_DIRECTORY_TOOL_NAME);
    expect(
      service
        .liveServers()
        .map((s) => s.toolCount)
        .reduce((a, b) => a + b, 0),
    ).toBe(MCP_NATIVE_TOOL_LIMIT + 1);
  });

  it('crash——撤该服务器全部工具 + ui.notify warn + 不自动重连', async () => {
    const { service, registry, notified, children } = makeService();
    service.apply({ a: SERVER_CONFIG(), b: SERVER_CONFIG() });
    children.get('mcp:a')!.tools = [{ name: 'x' }];
    children.get('mcp:b')!.tools = [{ name: 'y' }];
    await until(() => registry.registered.length === 2);
    children.get('mcp:a')!.crash();
    await until(() => notified.length === 1);
    expect(notified[0]).toContain('a');
    expect(notified[0]).toContain('/reload');
    // b 工具照册（不阻同行）；a 的 x 已撤
    expect(service.liveServers()).toEqual([{ server: 'b', toolCount: 1 }]);
    // 不自动重连：a 的子进程不再有新握手帧
    const writtenA = children.get('mcp:a')!.written.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(children.get('mcp:a')!.written.length).toBe(writtenA);
  });

  it('scope 回卷——disposer 全撤（工具注销 + 桥关停告别）', async () => {
    const { service, registry, scope, children } = makeService();
    service.apply({ demo: SERVER_CONFIG() });
    const child = children.get('mcp:demo')!;
    child.tools = [{ name: 't' }];
    await until(() => registry.registered.length === 1);
    scope.disposed = true;
    scope.disposers.forEach((d) => d());
    expect(registry.unregistered).toEqual(['demo__t']); // 工具面全撤
    expect(child.ended).toBe(true); // 桥协议化告别（stdin.end）已落
    await new Promise((r) => setTimeout(r, 50)); // 宽限内自退（autoExit）——不树杀
    expect(child.killed).toBe(false);
    expect(service.liveServers()).toEqual([]);
  });

  it('续段 scope 死——协议化关停不入活表不计失败（安静退场）', async () => {
    const { service, registry, scope, notified, children } = makeService();
    service.apply({ demo: SERVER_CONFIG() });
    const child = children.get('mcp:demo')!;
    // 发现在途置死（握手将成而 scope 已卷——异步边界护栏腿）
    scope.disposed = true;
    child.tools = [{ name: 't' }];
    await new Promise((r) => setTimeout(r, 150)); // 发现腿自然推进（握手成）
    expect(child.ended).toBe(true); // 死即协议化关停（不入活表先 close）
    expect(registry.registered).toHaveLength(0); // 死后不铺
    expect(notified).toHaveLength(0); // 不计失败（非降级语义）
    expect(service.liveServers()).toEqual([]);
  });

  it('重复 apply——整值替换（旧桥撤、旧面清、新发现起）', async () => {
    const { service, registry, children } = makeService();
    service.apply({ old: SERVER_CONFIG() });
    const oldChild = children.get('mcp:old')!;
    oldChild.tools = [{ name: 't' }];
    await until(() => registry.registered.length === 1);
    service.apply({ new: SERVER_CONFIG() });
    expect(registry.unregistered).toContain('old__t'); // 旧面即撤
    expect(service.liveServers()).toEqual([]); // 旧桥出活表
    const newChild = children.get('mcp:new')!;
    newChild.tools = [{ name: 'u' }];
    await until(() => registry.registered.some((d) => d.name === 'new__u'));
  });
});

/** execute 面互证（注册的 def 可真调用——落桥原名） */
describe('注册面 execute 联动', () => {
  it('注册的 def execute 走桥 call（结果透传）', async () => {
    const { service, registry, children } = makeService();
    service.apply({ demo: SERVER_CONFIG() });
    const child = children.get('mcp:demo')!;
    child.tools = [{ name: 'echo' }];
    await until(() => registry.registered.length === 1);
    const def = registry as unknown as {
      registered: { name: string; execute?: (args: Record<string, unknown>) => Promise<AgentToolResult> }[];
    };
    const target = def.registered.find((d) => d.name === 'demo__echo');
    expect(target?.execute).toBeDefined();
    const callP = target!.execute!({ x: 1 });
    // 应答（下一帧 tools/call——从 written 尾部找 id）
    const callFrame = child.written
      .map((w) => JSON.parse(w) as { id?: number; method?: string; params?: { name?: string } })
      .reverse()
      .find((f) => f.method === 'tools/call');
    expect(callFrame?.params?.name).toBe('echo'); // 原名落桥
    child.emit(
      JSON.stringify({ jsonrpc: '2.0', id: callFrame!.id, result: { content: [{ type: 'text', text: '回声' }] } }),
    );
    const result = await callP;
    expect((result.content[0] as { text: string }).text).toBe('回声');
  });
});
