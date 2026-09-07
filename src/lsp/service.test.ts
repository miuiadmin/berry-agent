/**
 * createLspService 编排测试（03 §10.2——惰性实例 + 3 连败熔断 + scope 回卷
 * 不计熔断 + apply 整值替换 + queryDiagnostics seam + 诊断注入面）。
 * FakeLspChild 帧式脚本化（instance.test 同律异脚本——全文件零真进程）；
 * 消息队列回放模式：脚本迟到不丢帧（initialize 在 spawn 同拍已写入）。
 */
import { describe, expect, it } from 'vitest';
import type { AgentToolResult, PostExecuteInput, ToolDefinition } from '../contracts/index.js';
import { TOOL_POST_EXECUTE_EVENT } from '../contracts/index.js';
import { createDiagnosticsInjector } from './inject.js';
import { createLspService } from './service.js';
import { encodeFrame, FrameDecoder } from './frame.js';
import { languageIdForPath, routeServer } from './types.js';
import type {
  LspEventsFace,
  LspFsFace,
  LspRegisterToolsFace,
  LspScopeFace,
  LspServerConfig,
  LspSpawnFace,
} from './types.js';

/* ---------------- 假件族（窄面注入——零真进程零盘） ---------------- */

interface ServerMsg {
  id?: number;
  method?: string;
  params?: unknown;
}

class FakeLspChild {
  readonly written: Buffer[] = [];
  killed = false;
  private readonly decoder = new FrameDecoder();
  private exitCb: ((info: { code: number | null; spawnError?: Error }) => void) | undefined;
  private dataCb: ((chunk: Buffer) => void) | undefined;
  private script: ((msg: ServerMsg) => void) | undefined;
  private readonly queued: ServerMsg[] = [];

  readonly stdin = {
    write: (data: Buffer): void => {
      this.written.push(data);
      const { frames } = this.decoder.feed(data);
      for (const f of frames) {
        const msg = JSON.parse(f) as ServerMsg;
        if (this.script !== undefined) this.script(msg);
        else this.queued.push(msg); // 脚本未挂——排队回放
      }
    },
    end: (): void => {},
  };
  readonly stdout = {
    on: (_e: 'data', cb: (chunk: Buffer) => void): void => {
      this.dataCb = cb;
    },
    destroy: (): void => {},
  };
  readonly stderr = { on: (): void => {} };

  /** 服务器脚本（迟到挂载自动回放排队消息） */
  set onServerMsg(fn: ((msg: ServerMsg) => void) | undefined) {
    this.script = fn;
    if (fn !== undefined) for (const m of this.queued.splice(0)) fn(m);
  }

  onExit(cb: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCb = cb;
  }

  kill(): void {
    this.killed = true;
  }

  serverSend(obj: unknown): void {
    this.dataCb?.(encodeFrame(JSON.stringify(obj)));
  }

  emitExit(code: number | null): void {
    this.exitCb?.({ code });
  }

  sentMessages(): ServerMsg[] {
    const d = new FrameDecoder();
    const out: ServerMsg[] = [];
    for (const buf of this.written) for (const f of d.feed(buf).frames) out.push(JSON.parse(f) as ServerMsg);
    return out;
  }
}

class FakeRegistry {
  readonly registered: ToolDefinition[] = [];
  readonly face: LspRegisterToolsFace = {
    register: (def) => {
      this.registered.push(def);
      return () => {
        const idx = this.registered.indexOf(def);
        if (idx >= 0) this.registered.splice(idx, 1);
      };
    },
  };
}

class FakeScope {
  private readonly cleanups: Array<() => void> = [];
  private _disposed = false;
  readonly face: LspScopeFace;
  constructor() {
    const scope = this; // getter 的 this 指 face 字面量——闭包捕获外层
    this.face = {
      effect: (register: () => () => void) => {
        scope.cleanups.push(register());
        return undefined;
      },
      get isDisposed(): boolean {
        return scope._disposed;
      },
    };
  }
  dispose(): void {
    this._disposed = true;
    for (const cleanup of [...this.cleanups]) cleanup();
  }
}

type AnyListener = (value: never, next: (value: never) => Promise<never>) => Promise<never>;

class FakeEvents {
  private readonly map = new Map<string, AnyListener[]>();
  readonly face: LspEventsFace = {
    onWaterfall: ((name: string, listener: never) => {
      const list = this.map.get(name) ?? [];
      list.push(listener);
      this.map.set(name, list);
      return () => {
        const idx = list.indexOf(listener);
        if (idx >= 0) list.splice(idx, 1);
      };
    }) as unknown as LspEventsFace['onWaterfall'],
  };
  /** 手推 waterfall（监听者链嵌套 next——装配根 dispatch 同语义） */
  async dispatch<T>(name: string, value: T): Promise<T> {
    const listeners = (this.map.get(name) ?? []) as unknown as Array<(v: T, next: (v: T) => Promise<T>) => Promise<T>>;
    const run = (i: number, v: T): Promise<T> =>
      i >= listeners.length ? Promise.resolve(v) : Promise.resolve(listeners[i]!(v, (nv) => run(i + 1, nv)));
    return run(0, value);
  }
}

class FakeFs {
  readonly files = new Map<string, string>();
  readonly face: LspFsFace = {
    readFile: async (path: string): Promise<Buffer> => {
      const text = this.files.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return Buffer.from(text, 'utf8');
    },
    realpath: async (path: string): Promise<string> => path, // 测试根即物理根
  };
}

/** 测试 harness（服务 + 全假件） */
function makeHarness(servers: Record<string, LspServerConfig>, diagTimeoutMs?: number) {
  const registry = new FakeRegistry();
  const scope = new FakeScope();
  const events = new FakeEvents();
  const fs = new FakeFs();
  const children: FakeLspChild[] = [];
  const notifications: string[] = [];
  const spawn: LspSpawnFace = {
    spawnInteractive: () => {
      const child = new FakeLspChild();
      children.push(child);
      return child;
    },
  };
  const service = createLspService({
    spawn,
    registry: registry.face,
    scope: scope.face,
    events: events.face,
    fs: fs.face,
    rootPath: '/ws',
    notify: (m) => notifications.push(m),
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
    closeGraceMs: 10, // 测试宽限收紧（真缺省 3000——关停编舞不拖测试）
  });
  service.apply({ servers, ...(diagTimeoutMs !== undefined ? { diagnostics_timeout_ms: diagTimeoutMs } : {}) });
  return { service, registry, scope, events, fs, children, notifications };
}

/** 等到第 count 个 spawn 发生（宏任务轮询——服务内部异步链完成后才 spawn） */
async function untilSpawned(h: { children: FakeLspChild[] }, count = 1): Promise<FakeLspChild> {
  for (let i = 0; i < 200 && h.children.length < count; i++) await new Promise((r) => setImmediate(r));
  if (h.children.length < count) throw new Error(`spawn 未发生（期待第 ${count} 个）`);
  return h.children[count - 1]!;
}

const TSSERVER: LspServerConfig = { command: '/bin/fake-tsserver', languages: ['ts'] };

/**
 * 自动脚本：initialize/shutdown 响应 + exit 自退 + didOpen/didChange 后回发
 * publishDiagnostics（version 对齐——用发送方的 textDocument.version）。
 */
function autoScript(child: FakeLspChild, diagOf: (uri: string) => Array<Record<string, unknown>>): void {
  child.onServerMsg = (msg) => {
    if (msg.method === 'initialize' && msg.id !== undefined) {
      child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
      return;
    }
    if (msg.method === 'shutdown' && msg.id !== undefined) {
      child.serverSend({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }
    if (msg.method === 'exit') {
      child.emitExit(0);
      return;
    }
    if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
      const p = (msg.params ?? {}) as { textDocument?: { uri?: string; version?: number } };
      if (p.textDocument?.uri !== undefined) {
        child.serverSend({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: { uri: p.textDocument.uri, version: p.textDocument.version, diagnostics: diagOf(p.textDocument.uri) },
        });
      }
    }
  };
}

/** 挂起脚本：initialize 只记不响应（握手窗内挂死——熔断/回卷用例） */
function hangingScript(child: FakeLspChild): { respond(): void } {
  let pendingId: number | undefined;
  child.onServerMsg = (msg) => {
    if (msg.method === 'initialize' && msg.id !== undefined) pendingId = msg.id;
  };
  return {
    respond: () => {
      if (pendingId !== undefined) child.serverSend({ jsonrpc: '2.0', id: pendingId, result: { capabilities: {} } });
    },
  };
}

const ERR_DIAG = { severity: 1, message: '类型不匹配', range: { start: { line: 1, character: 2 } }, source: 'ts' };
const WARN_DIAG = { severity: 2, message: '未使用变量', range: { start: { line: 3, character: 0 } } };

function resultText(result: AgentToolResult): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
}

describe('路由与静态注册', () => {
  it('routeServer 声明序首 + 扩展名归一（.TS 与 ts 同形）', () => {
    const config = { a: { ...TSSERVER, languages: ['.ts'] }, b: { ...TSSERVER, languages: ['ts', 'tsx'] } };
    expect(routeServer(config, '/ws/x.TS')).toBe('a'); // 声明序首裁决
    expect(routeServer(config, '/ws/x.tsx')).toBe('b');
    expect(routeServer(config, '/ws/x.js')).toBeNull();
    expect(routeServer(config, '/ws/noext')).toBeNull(); // 无扩展名不路由
  });

  it('languageIdForPath：内置表 + 扩展名回退 + 空回退 plaintext', () => {
    expect(languageIdForPath('/a/b.ts')).toBe('typescript');
    expect(languageIdForPath('/a/b.weird')).toBe('weird'); // 诚实回退不猜语义
    expect(languageIdForPath('/a/noext')).toBe('plaintext');
  });

  it('服务创建即静态注册四件（无发现步）；scope 回卷注销清零', () => {
    const h = makeHarness({});
    expect(h.registry.registered.map((d) => d.name)).toEqual(['diagnostics', 'symbols', 'definitions', 'references']);
    expect(h.registry.registered.every((d) => d.effect === 'read')).toBe(true);
    h.scope.dispose();
    expect(h.registry.registered).toHaveLength(0);
  });
});

describe('惰性实例与四工具全流程', () => {
  it('apply 后零 spawn；首用才 spawn', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    expect(h.children).toHaveLength(0);
    h.fs.files.set('/ws/a.ts', 'let a = 1;');
    const pending = h.service.tools.diagnostics('a.ts');
    await untilSpawned(h);
    autoScript(h.children[0]!, () => []);
    const result = await pending;
    expect(result.isError).toBeFalsy();
    expect(h.service.liveServers()).toEqual([{ server: 'tsserver', state: 'live' }]);
  });

  it('diagnostics 全流程：didOpen 携 languageId + error/warning 计数行 + 相对路径锚根', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    h.fs.files.set('/ws/a.ts', 'let a = 1;');
    const pending = h.service.tools.diagnostics('a.ts');
    await untilSpawned(h);
    autoScript(h.children[0]!, (uri) => (uri.endsWith('a.ts') ? [ERR_DIAG, WARN_DIAG] : []));
    const result = await pending;
    expect(result.isError).toBeFalsy();
    const text = resultText(result);
    expect(text).toContain('error ×1、warning ×1');
    expect(text).toContain('[error] L2:3 类型不匹配（ts）');
    expect(text).toContain('[warning] L4:1 未使用变量');
    const open = h.children[0]!.sentMessages().find((m) => m.method === 'textDocument/didOpen');
    expect(open?.params).toMatchObject({
      textDocument: { uri: 'file:///ws/a.ts', languageId: 'typescript', text: 'let a = 1;' },
    });
  });

  it('无路由 isError 诚实回执（未配置扩展名）', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    const result = await h.service.tools.diagnostics('/ws/x.unknownext');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('无语言服务器路由');
    expect(h.children).toHaveLength(0); // 无路由不 spawn
  });

  it('symbols/definitions/references 三面（请求形 + 位置格式化）', async () => {
    const h = makeHarness({ tsserver: { ...TSSERVER, request_timeout_sec: 1 } });
    h.fs.files.set('/ws/a.ts', 'const f = () => {};');
    const pending = h.service.tools.symbols('a.ts');
    const child = await untilSpawned(h);
    child.onServerMsg = (msg) => {
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
        return;
      }
      if (msg.method === 'textDocument/documentSymbol' && msg.id !== undefined) {
        child.serverSend({
          jsonrpc: '2.0',
          id: msg.id,
          result: [
            {
              name: 'f',
              kind: 13,
              range: { start: { line: 0, character: 6 } },
              children: [{ name: 'inner', kind: 12, range: { start: { line: 0, character: 6 } } }],
            },
          ],
        });
        return;
      }
      if (msg.method === 'textDocument/definition' && msg.id !== undefined) {
        child.serverSend({
          jsonrpc: '2.0',
          id: msg.id,
          result: { uri: 'file:///ws/def.ts', range: { start: { line: 4, character: 7 } } },
        });
        return;
      }
      if (msg.method === 'textDocument/references' && msg.id !== undefined) {
        child.serverSend({
          jsonrpc: '2.0',
          id: msg.id,
          result: [{ uri: 'file:///ws/r1.ts', range: { start: { line: 9, character: 0 } } }],
        });
      }
    };
    const symbols = await pending;
    expect(resultText(symbols)).toContain('f（Variable）L1');
    expect(resultText(symbols)).toContain('inner（Function）L1');
    const defs = await h.service.tools.definitions('a.ts', 0, 6);
    const defText = resultText(defs);
    expect(defText).toContain('定义 1 处');
    expect(defText).toContain('/ws/def.ts：5:8'); // file:// 剥离 + 1-based
    const refs = await h.service.tools.references('a.ts', 0, 6);
    expect(resultText(refs)).toContain('/ws/r1.ts：10:1');
  });

  it('诊断超钟：非 isError 诚实降级回执', async () => {
    const h = makeHarness({ tsserver: TSSERVER }, 20); // 竞速钟 20ms
    h.fs.files.set('/ws/a.ts', 'x');
    const pending = h.service.tools.diagnostics('a.ts');
    const child = await untilSpawned(h);
    child.onServerMsg = (msg) => {
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
      } // 不发 publishDiagnostics——超钟
    };
    const result = await pending;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain('未在 20ms 内回流');
  });
});

describe('熔断（3 连败）', () => {
  it('握手 3 连败 → 熔断开 LSP_CIRCUIT_OPEN；每败重 spawn（下用再试）', async () => {
    const h = makeHarness({ tsserver: { ...TSSERVER, startup_timeout_sec: 0.01 } });
    h.fs.files.set('/ws/a.ts', 'x');
    for (let i = 0; i < 3; i++) {
      const pending = h.service.tools.diagnostics('a.ts');
      const child = await untilSpawned(h, i + 1);
      child.onServerMsg = () => {}; // 挂死——握手钟尽（10ms）
      const result = await pending;
      expect(result.isError).toBe(true);
    }
    expect(h.children).toHaveLength(3); // 每败重 spawn
    expect(h.notifications.some((m) => m.includes('熔断'))).toBe(true);
    const fourth = await h.service.tools.diagnostics('a.ts');
    expect(resultText(fourth)).toContain('熔断');
    expect(h.children).toHaveLength(3); // 熔断后不再 spawn
  });

  it('行内他服务器不受累（熔断旗标实例级）', async () => {
    const h = makeHarness({
      tsserver: { ...TSSERVER, startup_timeout_sec: 0.01 },
      pylsp: { command: '/bin/fake-pylsp', languages: ['py'] },
    });
    h.fs.files.set('/ws/a.ts', 'x');
    h.fs.files.set('/ws/b.py', 'y = 1');
    for (let i = 0; i < 3; i++) {
      const pending = h.service.tools.diagnostics('a.ts');
      const child = await untilSpawned(h, i + 1);
      child.onServerMsg = () => {};
      await pending;
    }
    // tsserver 已熔断——py 文件仍正常
    const pending = h.service.tools.diagnostics('b.py');
    const pyChild = await untilSpawned(h, 4);
    autoScript(pyChild, () => []);
    const result = await pending;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain('error ×0'); // 空诊断回执
  });
});

describe('apply 整值替换与 scope 回卷', () => {
  it('apply：旧实例协议化关停（shutdown/exit）不计熔断 + 新 config 生效', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    h.fs.files.set('/ws/a.ts', 'x');
    const warm = h.service.tools.diagnostics('a.ts');
    await untilSpawned(h);
    autoScript(h.children[0]!, () => []);
    await warm;
    // 整值替换：tsserver 下线、pylsp 上线
    h.service.apply({ servers: { pylsp: { command: '/bin/fake-pylsp', languages: ['py'] } } });
    await new Promise((r) => setImmediate(r)); // 关停编舞首帧（shutdown）在微任务内落
    const sent = h.children[0]!.sentMessages();
    expect(sent.some((m) => m.method === 'shutdown')).toBe(true);
    expect(sent.some((m) => m.method === 'exit')).toBe(true); // 协议化关停编舞
    expect(h.notifications.some((m) => m.includes('失败'))).toBe(false); // 不计熔断
    // 旧路由已撤、新路由生效
    const gone = await h.service.tools.diagnostics('a.ts');
    expect(resultText(gone)).toContain('无语言服务器路由');
    h.fs.files.set('/ws/b.py', 'y = 1');
    const pending = h.service.tools.diagnostics('b.py');
    const pyChild = await untilSpawned(h, 2);
    autoScript(pyChild, () => []);
    expect((await pending).isError).toBeFalsy();
  });

  it('scope 回卷在握手窗内：实例安静退场不计熔断', async () => {
    const h = makeHarness({ tsserver: { ...TSSERVER, startup_timeout_sec: 30 } });
    h.fs.files.set('/ws/a.ts', 'x');
    // 预热触发（注入面——fire-and-forget 后台预热路径）
    void h.service.inject.injectDiagnostics(['/ws/a.ts']).then(
      () => undefined,
      () => undefined,
    );
    const child = await untilSpawned(h);
    const hang = hangingScript(child); // initialize 已排队回放进挂起脚本
    h.scope.dispose(); // 握手窗内回卷
    hang.respond(); // 握手此刻完成——scope 已死：安静退场
    await new Promise((r) => setTimeout(r, 30));
    expect(h.notifications.some((m) => m.includes('失败'))).toBe(false); // 回卷不计熔断
    expect(child.sentMessages().some((m) => m.method === 'shutdown')).toBe(true); // 协议化关停仍走全编舞
  });

  it('scope 回卷：live 实例关停 + 工具注销', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    h.fs.files.set('/ws/a.ts', 'x');
    const warm = h.service.tools.diagnostics('a.ts');
    await untilSpawned(h);
    autoScript(h.children[0]!, () => []);
    await warm;
    h.scope.dispose();
    await new Promise((r) => setImmediate(r)); // 关停编舞首帧在微任务内落
    const sent = h.children[0]!.sentMessages();
    expect(sent.some((m) => m.method === 'shutdown')).toBe(true);
    expect(h.registry.registered).toHaveLength(0);
    expect(h.service.liveServers()).toHaveLength(0);
  });
});

describe('queryDiagnostics（goal GateLspSeam 投影）', () => {
  it('多文件投影形（file/level/message 含行列）；severity 三档映射', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    h.fs.files.set('/ws/a.ts', 'x');
    h.fs.files.set('/ws/b.ts', 'y');
    const pending = h.service.tools.diagnostics('a.ts'); // 预热 tsserver
    await untilSpawned(h);
    autoScript(h.children[0]!, (uri) =>
      uri.endsWith('a.ts')
        ? [ERR_DIAG, WARN_DIAG]
        : [{ severity: 4, message: '提示条目', range: { start: { line: 0, character: 1 } } }],
    );
    await pending;
    const rows = await h.service.queryDiagnostics(['/ws/a.ts', '/ws/b.ts']);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ file: '/ws/a.ts', level: 'error' });
    expect(rows[0]!.message).toContain('L2:3');
    expect(rows[1]).toMatchObject({ file: '/ws/a.ts', level: 'warning' });
    expect(rows[2]).toMatchObject({ file: '/ws/b.ts', level: 'info' }); // hint 折 info 桶
  });

  it('超钟合成 error 级条目（fail-closed——缺席不得伪装全绿）', async () => {
    const h = makeHarness({ tsserver: TSSERVER }, 20);
    h.fs.files.set('/ws/a.ts', 'x');
    const pending = h.service.tools.diagnostics('a.ts');
    const child = await untilSpawned(h);
    child.onServerMsg = (msg) => {
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
      } // 不发诊断
    };
    await pending;
    const rows = await h.service.queryDiagnostics(['/ws/a.ts']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ file: '/ws/a.ts', level: 'error' });
    expect(rows[0]!.message).toContain('fail-closed');
  });

  it('无路由文件折 error 条目（不静默跳过）', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    const rows = await h.service.queryDiagnostics(['/ws/x.zzz']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe('error');
    expect(rows[0]!.message).toContain('无语言服务器路由');
  });
});

describe('诊断注入面（tools_post_execute waterfall）', () => {
  function writeInput(path: string, isError = false): PostExecuteInput {
    return {
      tool: { name: 'write', description: '', parameters: {} } as unknown as ToolDefinition,
      args: { path },
      toolCallId: 'tc1',
      result: { content: [{ type: 'text', text: 'ok' }], ...(isError ? { isError: true } : {}) },
    };
  }

  function editInput(ops: Array<{ op: string; path: string }>): PostExecuteInput {
    return {
      tool: { name: 'edit', description: '', parameters: {} } as unknown as ToolDefinition,
      args: { patch: '...' },
      toolCallId: 'tc2',
      result: { content: [{ type: 'text', text: 'done' }], details: { operations: ops } },
    };
  }

  /** 预热 tsserver 到 live（注入用例公共前置） */
  async function warm(h: ReturnType<typeof makeHarness>): Promise<void> {
    h.fs.files.set('/ws/a.ts', 'let a = 1;');
    const pending = h.service.tools.diagnostics('a.ts');
    await untilSpawned(h);
    autoScript(h.children[0]!, (uri) => (uri.endsWith('a.ts') ? [ERR_DIAG] : []));
    await pending;
  }

  it('write 成功：诊断段追加进 result.content（管道返回前落定）', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    await warm(h);
    h.fs.files.set('/ws/a.ts', 'let a = 2;'); // write 后盘态
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, writeInput('/ws/a.ts'));
    expect(posted.result.content).toHaveLength(2); // 原 1 段 + 诊断 1 段
    const seg = (posted.result.content[1] as { text: string }).text;
    expect(seg).toContain('[lsp 诊断] /ws/a.ts');
    expect(seg).toContain('error ×1');
    // didChange 全文同步发生（盘真相）
    expect(h.children[0]!.sentMessages().some((m) => m.method === 'textDocument/didChange')).toBe(true);
  });

  it('write isError：跳过注入（失败写不注段）', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    await warm(h);
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, writeInput('/ws/a.ts', true));
    expect(posted.result.content).toHaveLength(1);
  });

  it('非 {write,edit} 工具：零注入零等待', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    await warm(h);
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, {
      tool: { name: 'read', description: '', parameters: {} } as unknown as ToolDefinition,
      args: { path: '/ws/a.ts' },
      toolCallId: 'tc3',
      result: { content: [{ type: 'text', text: 'data' }] },
    });
    expect(posted.result.content).toHaveLength(1);
  });

  it('edit 的 delete 路径：didClose 发出、零诊断注入', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    await warm(h);
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, editInput([{ op: 'delete', path: '/ws/a.ts' }]));
    expect(posted.result.content).toHaveLength(1); // 无诊断段
    expect(h.children[0]!.sentMessages().some((m) => m.method === 'textDocument/didClose')).toBe(true);
  });

  it('edit 的 add/update 路径走诊断注入', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    await warm(h);
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, editInput([{ op: 'update', path: '/ws/a.ts' }]));
    expect(posted.result.content).toHaveLength(2);
  });

  it('超钟：逐路径点名「未及回流」', async () => {
    const h = makeHarness({ tsserver: TSSERVER }, 20);
    await warm(h);
    // 换脚本：不再发诊断（initialize 已响应过——迟到 initialize 不再触发）
    h.children[0]!.onServerMsg = () => {};
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, writeInput('/ws/a.ts'));
    expect(posted.result.content).toHaveLength(2);
    expect((posted.result.content[1] as { text: string }).text).toContain('未及回流');
  });

  it('根外写入不诊断；无路由静默跳过', async () => {
    const h = makeHarness({ tsserver: TSSERVER });
    await warm(h);
    const posted = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, writeInput('/tmp/outside.ts'));
    expect(posted.result.content).toHaveLength(1);
    const noRoute = await h.events.dispatch(TOOL_POST_EXECUTE_EVENT, writeInput('/ws/x.rb'));
    expect(noRoute.result.content).toHaveLength(1);
  });

  it('未活：后台预热 + 首触一次性「预热中」注记（二次不重复；live 后正常注入）', async () => {
    const h = makeHarness({ tsserver: { ...TSSERVER, startup_timeout_sec: 30 } });
    h.fs.files.set('/ws/a.ts', 'x');
    // 第一次注入（触发后台预热——不 await 握手）
    const segs1 = await h.service.inject.injectDiagnostics(['/ws/a.ts']);
    expect(segs1).toHaveLength(1);
    expect(segs1[0]).toContain('预热中');
    const child = await untilSpawned(h);
    const hang = hangingScript(child); // 握手在途（initialize 已排队进挂起脚本）
    // 第二次注入（预热在途——跳过注入，注记不重复）
    const segs2 = await h.service.inject.injectDiagnostics(['/ws/a.ts']);
    expect(segs2).toHaveLength(0);
    // 握手完成 → live → 换自动脚本（发诊断）→ 正常注入
    hang.respond();
    await new Promise((r) => setTimeout(r, 20));
    child.onServerMsg = undefined; // 先摘挂起脚本
    autoScript(child, () => [ERR_DIAG]);
    const segs3 = await h.service.inject.injectDiagnostics(['/ws/a.ts']);
    expect(segs3).toHaveLength(1);
    expect(segs3[0]).toContain('[lsp 诊断]');
  });
});

describe('注入器 contained 铁律（createDiagnosticsInjector 单元）', () => {
  it('face 抛错：原样透传 + 不置 isError + warn 落面', async () => {
    const warns: string[] = [];
    const injector = createDiagnosticsInjector({
      face: {
        injectDiagnostics: async () => {
          throw new Error('注入面爆炸');
        },
        closeDocuments: () => {},
      },
      warn: (m) => warns.push(m),
    });
    const input: PostExecuteInput = {
      tool: { name: 'write', description: '', parameters: {} } as unknown as ToolDefinition,
      args: { path: '/ws/a.ts' },
      toolCallId: 't',
      result: { content: [{ type: 'text', text: 'ok' }] },
    };
    const posted = await injector(input, async (v) => ({ ...v, result: { ...v.result } }));
    expect(posted.result.content).toHaveLength(1); // 原样——无段追加
    expect(posted.result.isError).toBeFalsy(); // 绝不置 isError
    expect(warns.some((m) => m.includes('contained'))).toBe(true);
  });
});
