/**
 * 引擎生命周期测试（03 §10.3——惰性 spawn 编舞：stderr 侦听行 → ws →
 * Browser.getVersion 握手；失败收口树杀；协议化关停宽限兜底）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { launchBrowserEngine } from './engine.js';
import type { EngineHandle } from './engine.js';
import type { BrowserChildFace, BrowserFsFace, BrowserSpawnFace, BrowserWsConnection, BrowserWsFace } from './types.js';

/** 脚本化引擎子进程（exit 监听多挂线——Set 账忠实现面） */
class FakeChild implements BrowserChildFace {
  killed = false;
  private dataCb: ((chunk: Buffer) => void) | undefined;
  private readonly exitCbs = new Set<(info: { code: number | null; spawnError?: Error }) => void>();

  readonly stderr = {
    on: (_event: 'data', cb: (chunk: Buffer) => void): void => {
      this.dataCb = cb;
    },
  };

  onExit(callback: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCbs.add(callback);
  }

  kill(): void {
    this.killed = true;
  }

  /* ---- 测试驱动面 ---- */
  emitStderr(text: string): void {
    this.dataCb?.(Buffer.from(text, 'utf8'));
  }

  emitExit(code: number | null, spawnError?: Error): void {
    for (const cb of [...this.exitCbs]) cb({ code, ...(spawnError !== undefined ? { spawnError } : {}) });
  }
}

/** 内存文件面（只需 stat——发现序腿） */
const fakeFs = (files: readonly string[]): BrowserFsFace => ({
  access: async () => {},
  readFile: async () => '',
  writeFile: async () => {},
  mkdir: async () => {},
  readdir: async () => [],
  stat: async (path) => {
    if (!files.includes(path)) throw new Error(`ENOENT: ${path}`);
    return { isFile: () => true };
  },
  unlink: async () => {},
});

/** 脚本化 ws（同 cdp.test FakeWs 形——本文件独立副本） */
class FakeWs implements BrowserWsConnection {
  readonly sent: string[] = [];
  closed = false;
  readonly url: string;
  private msgCb: ((text: string) => void) | undefined;
  private closeCb: (() => void) | undefined;
  private openResolve!: () => void;
  private openReject!: (err: Error) => void;
  readonly opened = new Promise<void>((resolve, reject) => {
    this.openResolve = resolve;
    this.openReject = reject;
  });

  constructor(url: string) {
    this.url = url;
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.emitClose();
  }

  onMessage(listener: (text: string) => void): void {
    this.msgCb = listener;
  }

  onClose(listener: () => void): void {
    this.closeCb = listener;
  }

  /* ---- 测试驱动面 ---- */
  openNow(): void {
    this.openResolve();
  }

  failOpen(): void {
    this.openReject(new BaseError('BROWSER_CONNECT_FAILED', `WebSocket 建立失败：${this.url}`));
  }

  serverSend(obj: unknown): void {
    this.msgCb?.(JSON.stringify(obj));
  }

  emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb?.();
  }
}

/** 微任务排空（setImmediate 不在 toFake 域——假钟下照常可用） */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** 组启动依赖（引擎路径钉 /opt/chrome——发现序第①步显式腿） */
function makeHarness(over: { closeGraceMs?: number; startupTimeoutMs?: number } = {}) {
  const child = new FakeChild();
  let spawnArgv: readonly string[] = [];
  const spawn: BrowserSpawnFace = {
    spawnInteractive: (request) => {
      expect(request.owner).toBe('browser:engine');
      spawnArgv = request.argv;
      return child;
    },
  };
  const connections: FakeWs[] = [];
  const ws: BrowserWsFace = {
    connect: (url) => {
      const conn = new FakeWs(url);
      connections.push(conn);
      return conn;
    },
  };
  const launch = (): Promise<EngineHandle> =>
    launchBrowserEngine({
      spawn,
      ws,
      fs: fakeFs(['/opt/chrome']),
      readEnv: () => undefined,
      platform: 'linux',
      homeDir: '/home/tester',
      dataDir: '/data',
      config: { executablePath: '/opt/chrome' },
      ...(over.closeGraceMs !== undefined ? { closeGraceMs: over.closeGraceMs } : {}),
      ...(over.startupTimeoutMs !== undefined ? { startupTimeoutMs: over.startupTimeoutMs } : {}),
    });
  return { child, connections, launch, getSpawnArgv: () => spawnArgv };
}

/**
 * 启动并驱动到握手请求就位，返回 (pending, ws)。
 * 约定：launch 后一拍发侦听行（stderr 监听挂线完成）、再一拍取连接。
 */
async function launched(
  h: ReturnType<typeof makeHarness>,
  url = 'ws://127.0.0.1:9223/devtools/browser/guid-1',
): Promise<{ pending: Promise<EngineHandle>; ws: FakeWs }> {
  const pending = h.launch();
  await tick();
  h.child.emitStderr(`DevTools listening on ${url}`);
  await tick();
  const ws = h.connections[0]!;
  ws.openNow();
  return { pending, ws };
}

/** 应答握手帧并取引擎句柄（内部先排空——getVersion 帧入账） */
async function answerHandshake(ws: FakeWs, pending: Promise<EngineHandle>): Promise<EngineHandle> {
  await tick();
  const frame = JSON.parse(ws.sent[0] ?? '{}') as { id: number; method: string };
  expect(frame.method).toBe('Browser.getVersion');
  ws.serverSend({ id: frame.id, result: { protocolVersion: '1.3' } });
  return pending;
}

describe('启动编舞', () => {
  it('spawn argv 三钉 + 侦听行 → ws open → Browser.getVersion 握手', async () => {
    const h = makeHarness();
    const { pending, ws } = await launched(h);
    expect(ws.url).toBe('ws://127.0.0.1:9223/devtools/browser/guid-1');
    const handle = await answerHandshake(ws, pending);
    expect(handle.alive).toBe(true);
    expect(handle.discovered).toEqual({ path: '/opt/chrome', source: 'config' });
    const argv = h.getSpawnArgv();
    expect(argv).toContain('--headless=new');
    expect(argv).toContain('--remote-debugging-port=0');
    expect(argv).toContain('--user-data-dir=/data/browser/profile');
    await handle.close();
  });

  it('侦听行跨 stderr chunk 拼接（分片不丢）', async () => {
    const h = makeHarness();
    const pending = h.launch();
    await tick();
    h.child.emitStderr('DevTools liste');
    h.child.emitStderr('ning on ws://127.0.0.1:99/devtools/browser/g2\n');
    await tick();
    const ws = h.connections[0]!;
    expect(ws.url).toBe('ws://127.0.0.1:99/devtools/browser/g2');
    ws.openNow();
    await answerHandshake(ws, pending);
  });

  it('进程在侦听行前退出 → BROWSER_CONNECT_FAILED（spawnError 位归因）+ 树杀', async () => {
    const h = makeHarness();
    const pending = h.launch().then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await tick();
    h.child.emitExit(null, new Error('ENOENT'));
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    const err = outcome.ok ? undefined : outcome.err;
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('BROWSER_CONNECT_FAILED');
    expect((err as BaseError).message).toContain('spawn 失败');
    expect(h.child.killed).toBe(true);
  });

  it('启动预算钟尽（无侦听行）→ BROWSER_CONNECT_FAILED + 树杀不留孤儿', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = makeHarness({ startupTimeoutMs: 50 });
    const observed = h.launch().then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await vi.advanceTimersByTimeAsync(51);
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    const err = outcome.ok ? undefined : outcome.err;
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('BROWSER_CONNECT_FAILED');
    expect((err as BaseError).message).toContain('超时');
    expect(h.child.killed).toBe(true); // 预算尽树杀（头注承诺——不留孤儿）
    vi.useRealTimers();
  });

  it('ws 建立失败 → BROWSER_CONNECT_FAILED + 树杀不留孤儿', async () => {
    const h = makeHarness();
    const observed = h.launch().then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await tick();
    h.child.emitStderr('DevTools listening on ws://127.0.0.1:99/devtools/browser/g3');
    await tick();
    h.connections[0]!.failOpen();
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    expect((outcome.ok ? undefined : outcome.err) instanceof BaseError).toBe(true);
    expect(h.child.killed).toBe(true);
  });

  it('握手被拒（引擎在但 CDP 不应答）→ BROWSER_CONNECT_FAILED + 树杀', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = makeHarness({ startupTimeoutMs: 40 });
    const observed = h.launch().then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await tick();
    h.child.emitStderr('DevTools listening on ws://127.0.0.1:99/devtools/browser/g4');
    await tick();
    const ws = h.connections[0]!;
    ws.openNow();
    await vi.advanceTimersByTimeAsync(41); // getVersion 超时（命令级——握手窗内折连接级）
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    const err = outcome.ok ? undefined : outcome.err;
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('BROWSER_CONNECT_FAILED');
    expect(h.child.killed).toBe(true);
    vi.useRealTimers();
  });
});

describe('运行期降级与协议化关停', () => {
  async function liveHarness(
    over: { closeGraceMs?: number } = {},
  ): Promise<{ h: ReturnType<typeof makeHarness>; handle: EngineHandle; ws: FakeWs }> {
    const h = makeHarness(over);
    const { pending, ws } = await launched(h, 'ws://127.0.0.1:9223/devtools/browser/guid-x');
    const handle = await answerHandshake(ws, pending);
    return { h, handle, ws };
  }

  it('引擎进程退出 → onDown 一次 + conn 死（下用快拒）+ 在途结清', async () => {
    const { h, handle } = await liveHarness();
    const downs: string[] = [];
    handle.onDown((r) => downs.push(r));
    const inflight = handle.conn.send('Page.navigate', { url: 'https://example.com' });
    h.child.emitExit(1); // crash
    await expect(inflight).rejects.toSatisfy(
      (err: unknown) => err instanceof BaseError && (err as BaseError).code === 'BROWSER_CONNECT_FAILED',
    );
    expect(downs).toEqual([expect.stringContaining('进程退出')]);
    expect(handle.alive).toBe(false);
    handle.onDown((r) => downs.push(`late:${r}`));
    expect(downs).toHaveLength(2);
  });

  it('ws 关闭源同样降级（连接关闭归因）', async () => {
    const { handle, ws } = await liveHarness();
    const downs: string[] = [];
    handle.onDown((r) => downs.push(r));
    ws.emitClose(); // 服务端侧断链（非主动 close 路径）
    expect(downs).toEqual([expect.stringContaining('连接关闭')]);
    expect(handle.alive).toBe(false);
  });

  it('close() 编舞：Browser.close 告别先行 → 引擎自退即结算（不树杀）', async () => {
    const { h, handle, ws } = await liveHarness();
    const closing = handle.close();
    // 告别帧在 close() 返回前已同步入账（send 执行体同步推帧）
    const frames = ws.sent.map((t) => JSON.parse(t) as { id: number; method: string });
    const farewell = frames.find((f) => f.method === 'Browser.close');
    expect(farewell).toBeDefined();
    ws.serverSend({ id: farewell!.id, result: {} }); // 引擎应答告别
    await tick(); // 告别结清 + 宽限监听挂线
    h.child.emitExit(0); // 引擎自退
    await closing;
    expect(h.child.killed).toBe(false); // 自退场景不树杀
    expect(await handle.close()).toBeUndefined(); // 幂等——同结算
  });

  it('close() 宽限尽树杀：告别超时且不退 → kill 兜底', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { h, handle } = await liveHarness({ closeGraceMs: 30 });
    const closing = handle.close();
    // t=30 告别超时（caught 落宽限腿）→ t=60 宽限钟尽树杀
    await vi.advanceTimersByTimeAsync(61);
    expect(h.child.killed).toBe(true);
    h.child.emitExit(null);
    await closing;
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
