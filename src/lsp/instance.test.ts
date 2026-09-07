/**
 * connectLspInstance 实例层测试（03 §10.2——握手/文档同步/诊断 version
 * 对齐/协议化关停/crash 幂等闸）。FakeLspChild 帧式脚本化（mcp 件
 * FakeChild 同律异帧——Content-Length 编解码走真 FrameDecoder）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { connectLspInstance } from './instance.js';
import type { LspInstance } from './instance.js';
import { encodeFrame, FrameDecoder } from './frame.js';
import type { LspChildFace, LspServerConfig, LspSpawnFace } from './types.js';

/* ---------------- FakeLspChild（帧式脚本化子进程） ---------------- */

/** 服务器侧收到的消息（已 JSON.parse） */
interface ServerMsg {
  id?: number;
  method?: string;
  params?: unknown;
  error?: { code: number; message: string };
}

class FakeLspChild implements LspChildFace {
  readonly written: Buffer[] = [];
  killed = false;
  stdoutDestroyed = false;
  private readonly decoder = new FrameDecoder();
  private exitCb: ((info: { code: number | null; spawnError?: Error }) => void) | undefined;
  dataCb: ((chunk: Buffer) => void) | undefined;
  /** 服务器脚本（收消息回调——测试闭包内 switch method） */
  onServerMsg: ((msg: ServerMsg) => void) | undefined;

  readonly stdin = {
    write: (data: Buffer): void => {
      this.written.push(data);
      const { frames, fatal } = this.decoder.feed(data);
      if (fatal) {
        this.emitExit(1); // 服务器侧遇坏帧死（真进程语义近似）
        return;
      }
      for (const f of frames) this.onServerMsg?.(JSON.parse(f) as ServerMsg);
    },
    end: (): void => {},
  };
  readonly stdout = {
    on: (_event: 'data', cb: (chunk: Buffer) => void): void => {
      this.dataCb = cb;
    },
    destroy: (): void => {
      this.stdoutDestroyed = true;
    },
  };
  readonly stderr = {
    on: (): void => {},
  };

  onExit(callback: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCb = callback;
  }

  kill(): void {
    this.killed = true;
  }

  /** 服务器 → 客户端发帧 */
  serverSend(obj: unknown): void {
    this.dataCb?.(encodeFrame(JSON.stringify(obj)));
  }

  /** 进程退出事件（code 0 = 正常；非 0 = crash） */
  emitExit(code: number | null): void {
    this.exitCb?.({ code });
  }

  /** 客户端已发消息清单（全部 written 帧解析） */
  sentMessages(): ServerMsg[] {
    const d = new FrameDecoder();
    const out: ServerMsg[] = [];
    for (const buf of this.written) {
      for (const f of d.feed(buf).frames) out.push(JSON.parse(f) as ServerMsg);
    }
    return out;
  }
}

/** 造 spawn 假件（吐脚本化 child） */
function fakeSpawn(child: FakeLspChild): LspSpawnFace {
  return {
    spawnInteractive: (request) => {
      expect(request.owner).toMatch(/^lsp:/);
      return child;
    },
  };
}

/** 缺省脚本：initialize 响应 + 记账（测试内可覆写 onServerMsg 前置） */
function defaultScript(child: FakeLspChild): void {
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
    }
  };
}

/** 微任务排空（握手完成等异步结算等待） */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const CONFIG: LspServerConfig = { command: '/bin/fake-lsp', languages: ['ts'] };

describe('握手编舞', () => {
  it('initialize 携 rootUri/capabilities → 响应后发 initialized 通知', async () => {
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('tsserver', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    const sent = child.sentMessages();
    expect(sent[0]!.method).toBe('initialize');
    expect(sent[0]!.params).toMatchObject({ processId: null, rootUri: 'file:///ws' });
    expect(sent[1]!.method).toBe('initialized');
    expect(sent[1]!.id).toBeUndefined(); // 通知无 id
    expect(inst.server).toBe('tsserver');
    await inst.close();
  });

  it('握手超时抛 LSP_CONNECT_FAILED + 子进程树杀（不留孤儿）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    child.onServerMsg = () => {}; // 不响应 initialize——钟尽
    const observed = connectLspInstance('s', { ...CONFIG, startup_timeout_sec: 0.001 }, 'file:///ws', {
      spawn: fakeSpawn(child),
    }).then(
      () => ({ ok: true as const, inst: undefined }),
      (err: unknown) => ({ ok: false as const, err }),
    ); // 先挂 handler——假钟推进的结算不落 unhandled 窗口
    await vi.advanceTimersByTimeAsync(5);
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    const err = outcome.ok ? undefined : outcome.err;
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('LSP_CONNECT_FAILED');
    expect((err as BaseError).message).toContain('超时');
    expect(child.killed).toBe(true);
    vi.useRealTimers();
  });
});

describe('文档同步（Full 全文——盘真相）', () => {
  it('首触 didOpen version 1 携 languageId；后续 didChange version 递增 Full 全文', async () => {
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    const v1 = inst.syncDocument('file:///ws/a.ts', 'let a = 1;', '/ws/a.ts');
    const v2 = inst.syncDocument('file:///ws/a.ts', 'let a = 2;', '/ws/a.ts');
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    const sent = child.sentMessages();
    const open = sent.find((m) => m.method === 'textDocument/didOpen');
    expect(open?.params).toMatchObject({
      textDocument: { uri: 'file:///ws/a.ts', languageId: 'typescript', version: 1, text: 'let a = 1;' },
    });
    const change = sent.find((m) => m.method === 'textDocument/didChange');
    expect(change?.params).toMatchObject({
      textDocument: { uri: 'file:///ws/a.ts', version: 2 },
      contentChanges: [{ text: 'let a = 2;' }], // Full 全文（无 range = 增量不进 v1）
    });
    await inst.close();
  });

  it('closeDocument 发 didClose；未开不关（幂等）', async () => {
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    inst.closeDocument('file:///ws/never-opened.ts'); // 未开——零消息
    inst.syncDocument('file:///ws/b.ts', 'x', '/ws/b.ts');
    inst.closeDocument('file:///ws/b.ts');
    inst.closeDocument('file:///ws/b.ts'); // 二次关——幂等
    const closes = child.sentMessages().filter((m) => m.method === 'textDocument/didClose');
    expect(closes).toHaveLength(1);
    await inst.close();
  });
});

describe('诊断 version 对齐', () => {
  async function connected(child: FakeLspChild): Promise<LspInstance> {
    defaultScript(child);
    return connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
  }

  it('过期诊断不唤醒：version 1 帧对 minVersion 2 的 waiter 不结算', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    const inst = await connected(child);
    inst.syncDocument('file:///ws/a.ts', 'v1 text', '/ws/a.ts'); // version 1
    inst.syncDocument('file:///ws/a.ts', 'v2 text', '/ws/a.ts'); // version 2——等 version 2
    const waiting = inst.waitDiagnostics('file:///ws/a.ts', 2, 100);
    let settled: readonly unknown[] | null | undefined;
    void waiting.then((items) => {
      settled = items;
    });
    // 过期帧（version 1）——不唤醒
    child.serverSend({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///ws/a.ts',
        version: 1,
        diagnostics: [{ severity: 1, message: '旧', range: { start: { line: 0, character: 0 } } }],
      },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeUndefined(); // 未被过期帧唤醒
    // 对齐帧（version 2）——唤醒
    child.serverSend({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///ws/a.ts', version: 2, diagnostics: [] },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual([]);
    await inst.close();
    vi.useRealTimers();
  });

  it('不带 version 视为最新——直唤醒', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    const inst = await connected(child);
    inst.syncDocument('file:///ws/a.ts', 'text', '/ws/a.ts');
    inst.syncDocument('file:///ws/a.ts', 'text2', '/ws/a.ts');
    const waiting = inst.waitDiagnostics('file:///ws/a.ts', 2, 100);
    let settled: readonly unknown[] | null | undefined;
    void waiting.then((items) => {
      settled = items;
    });
    child.serverSend({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///ws/a.ts', diagnostics: [{ severity: 2, message: '无版本号帧' }] }, // 无 version 键
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveLength(1);
    await inst.close();
    vi.useRealTimers();
  });

  it('快路径：已满足对齐的最近帧直取（零等待）', async () => {
    const child = new FakeLspChild();
    const inst = await connected(child);
    inst.syncDocument('file:///ws/a.ts', 'text', '/ws/a.ts');
    child.serverSend({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///ws/a.ts', version: 5, diagnostics: [{ severity: 1, message: '快路径' }] },
    });
    await tick();
    const items = await inst.waitDiagnostics('file:///ws/a.ts', 3, 10); // 3 ≤ 5——直取
    expect(items).toHaveLength(1);
    expect(inst.latestDiagnostics('file:///ws/a.ts', 6)).toBeUndefined(); // 过期帧不算
    await inst.close();
  });

  it('超钟返 null（诚实降级）；坏条目跳过', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    const inst = await connected(child);
    inst.syncDocument('file:///ws/a.ts', 'text', '/ws/a.ts');
    const p = inst.waitDiagnostics('file:///ws/a.ts', 9, 50);
    const settled = vi.waitFor(() => expect(p).resolves.toBeNull());
    await vi.advanceTimersByTimeAsync(60);
    await settled;
    // 坏条目跳过：非对象/缺 message 的条目不入账
    child.serverSend({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///ws/a.ts',
        version: 9,
        diagnostics: [{ severity: 1 }, 'garbage', { message: '好条目', range: { start: { line: 3, character: 4 } } }],
      },
    });
    await tick();
    expect(await inst.waitDiagnostics('file:///ws/a.ts', 9, 10)).toHaveLength(1);
    await inst.close();
    vi.useRealTimers();
  });
});

describe('crash 与载体级失败', () => {
  it('进程退出：onDown 一次送达 + 在途请求拒 LSP_CONNECT_FAILED + 迟到订阅即回调', async () => {
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    const downs: string[] = [];
    inst.onDown((reason) => downs.push(reason));
    const inflight = inst.request('textDocument/documentSymbol', {}, 1000);
    child.emitExit(1); // crash
    await expect(inflight).rejects.toSatisfy(
      (err: unknown) => err instanceof BaseError && err.code === 'LSP_CONNECT_FAILED',
    );
    expect(downs).toHaveLength(1);
    inst.onDown((reason) => downs.push(`late:${reason}`)); // 迟到订阅即回调
    expect(downs).toHaveLength(2);
    // 二次退出事件——幂等闸不再送达
    child.emitExit(1);
    expect(downs).toHaveLength(2);
    // 死后新请求快拒
    await expect(inst.request('x')).rejects.toSatisfy(
      (err: unknown) => err instanceof BaseError && err.code === 'LSP_CONNECT_FAILED',
    );
  });

  it('帧 fatal：封读 + 同步树杀（onFatal 收口位）', async () => {
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    // 喂坏头帧（声明负数）——帧层 fatal
    child.dataCb?.(Buffer.from('Content-Length: -1\r\n\r\n', 'ascii'));
    expect(child.stdoutDestroyed).toBe(true); // 封读
    expect(child.killed).toBe(true); // 同步树杀
    await tick();
    const downs: string[] = [];
    inst.onDown((r) => downs.push(r));
    child.emitExit(null); // 树杀后的退出事件（真实世界 kill → exit）
    expect(downs).toHaveLength(1);
  });
});

describe('协议化关停 close', () => {
  it('编舞：shutdown 请求 → 响应 → exit 通知 → 服务器自退 → resolve；幂等复用', async () => {
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    const closed = inst.close();
    await closed;
    const sent = child.sentMessages();
    const shutdownIdx = sent.findIndex((m) => m.method === 'shutdown');
    const exitIdx = sent.findIndex((m) => m.method === 'exit');
    expect(shutdownIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThan(shutdownIdx); // shutdown 响应后发 exit
    expect(await inst.close()).toBeUndefined(); // 幂等——同结算
  });

  it('宽限尽树杀：exit 后不退 → 宽限钟尽 kill 兜底', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    child.onServerMsg = (msg) => {
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
        return;
      }
      if (msg.method === 'shutdown' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: null });
      }
      // exit 通知收到但不退——宽限钟执法
    };
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', {
      spawn: fakeSpawn(child),
      closeGraceMs: 50,
    });
    const closed = inst.close();
    await vi.advanceTimersByTimeAsync(51);
    expect(child.killed).toBe(true);
    child.emitExit(null);
    await closed;
    vi.useRealTimers();
  });

  it('shutdown 无响应不等满——钟与宽限同帽进 exit 段', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    let exited = false;
    child.onServerMsg = (msg) => {
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
        return;
      }
      if (msg.method === 'exit') {
        exited = true;
        child.emitExit(0);
      }
      // shutdown 不响应——挂死服务器
    };
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', {
      spawn: fakeSpawn(child),
      closeGraceMs: 30,
    });
    const closed = inst.close();
    await vi.advanceTimersByTimeAsync(31);
    expect(exited).toBe(true); // shutdown 钟尽即发 exit——不因坏服务器悬挂
    await closed;
    expect(child.killed).toBe(false); // 自退场景不树杀
    vi.useRealTimers();
  });
});

describe('wire 层（经实例消费面间接覆盖）', () => {
  it('服务器方向请求一律 -32601 拒答（v1 不承载反向能力面）', async () => {
    const child = new FakeLspChild();
    const seen: ServerMsg[] = [];
    child.onServerMsg = (msg) => {
      if (msg.method === 'initialize' && msg.id !== undefined) {
        child.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
        return;
      }
      seen.push(msg);
    };
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    // 服务器发请求（workspace/configuration 形）
    child.serverSend({ jsonrpc: '2.0', id: 99, method: 'workspace/configuration', params: {} });
    await tick();
    const reply = child.sentMessages().find((m) => m.id === 99);
    expect(reply?.error).toMatchObject({ code: -32601 });
    await inst.close();
  });

  it('请求超时 reject（单请求钟——与握手钟分账）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = new FakeLspChild();
    defaultScript(child);
    const inst = await connectLspInstance('s', CONFIG, 'file:///ws', { spawn: fakeSpawn(child) });
    const p = inst.request('textDocument/hover', {}, 40);
    const settled = vi.waitFor(() => expect(p).rejects.toThrow('超时'));
    await vi.advanceTimersByTimeAsync(41);
    await settled;
    await inst.close();
    vi.useRealTimers();
  });
});

/* 计时器卫生兜底：假钟用例各自收尾，此处防漏（真钟复位无副作用） */
afterEach(() => {
  vi.useRealTimers();
});
