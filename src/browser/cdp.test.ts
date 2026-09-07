/**
 * CDP 连接件测试（03 §10.3——请求关联表 / 事件分流路由 / 连接级收口 /
 * 命令超时与连接失败分账）。FakeWs 脚本化文本帧（生产真身 = 全局 WebSocket，
 * compat.test 端到端互证）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createCdpConnection } from './cdp.js';
import type { CdpConnection } from './cdp.js';
import type { BrowserWsConnection } from './types.js';

/** 脚本化 ws 连接 */
class FakeWs implements BrowserWsConnection {
  readonly sent: string[] = [];
  closed = false;
  private msgCb: ((text: string) => void) | undefined;
  private closeCb: (() => void) | undefined;
  private openResolve!: () => void;
  readonly opened = new Promise<void>((resolve) => {
    this.openResolve = resolve;
  });

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
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

  serverSend(obj: unknown): void {
    this.msgCb?.(JSON.stringify(obj));
  }

  serverSendRaw(text: string): void {
    this.msgCb?.(text);
  }

  emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb?.();
  }
}

/** 微任务排空 */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function makeConn(): { ws: FakeWs; conn: CdpConnection } {
  const ws = new FakeWs();
  const conn = createCdpConnection(ws);
  return { ws, conn };
}

describe('请求关联表', () => {
  it('命令往返：id 配对应答、params 透传、sessionId 路由位在场', async () => {
    const { ws, conn } = makeConn();
    const pending = conn.send('Target.createTarget', { url: 'about:blank' }, { sessionId: 'S1', timeoutMs: 1000 });
    await tick();
    const frame = JSON.parse(ws.sent[0] ?? '{}') as { id: number; method: string; params: unknown; sessionId?: string };
    expect(frame.method).toBe('Target.createTarget');
    expect(frame.params).toEqual({ url: 'about:blank' });
    expect(frame.sessionId).toBe('S1');
    ws.serverSend({ id: frame.id, result: { targetId: 'T1' } });
    await expect(pending).resolves.toEqual({ targetId: 'T1' });
  });

  it('wire error 应答 → CdpCommandError（code/message 透传）', async () => {
    const { ws, conn } = makeConn();
    const pending = conn.send('DOM.getBoxModel', { backendNodeId: 7 });
    await tick();
    const id = (JSON.parse(ws.sent[0] ?? '{}') as { id: number }).id;
    ws.serverSend({ id, error: { code: -32000, message: 'Node not found' } });
    await expect(pending).rejects.toThrow('CDP 命令被拒（code -32000）');
  });

  it('命令超时：普通 Error（连接不死——慢命令不误杀活连接）+ 迟到应答静默', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { ws, conn } = makeConn();
    const pending = conn.send('Runtime.evaluate', {}, { timeoutMs: 40 });
    const observed = pending.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await vi.advanceTimersByTimeAsync(41);
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    expect((outcome.ok ? undefined : outcome.err) instanceof BaseError).toBe(false); // 普通超时非连接码
    expect(conn.isDead).toBe(false);
    // 迟到应答（超时已结清）——静默不炸
    const id = (JSON.parse(ws.sent[0] ?? '{}') as { id: number }).id;
    ws.serverSend({ id, result: {} });
    await tick();
    expect(conn.isDead).toBe(false);
    vi.useRealTimers();
  });
});

describe('事件分流路由', () => {
  it('事件帧派发监听者（method + sessionId 归一形）', async () => {
    const { ws, conn } = makeConn();
    const events: unknown[] = [];
    conn.onEvent((e) => events.push(e));
    ws.serverSend({ method: 'Runtime.consoleAPICalled', params: { type: 'log' }, sessionId: 'S1' });
    expect(events).toEqual([{ method: 'Runtime.consoleAPICalled', params: { type: 'log' }, sessionId: 'S1' }]);
  });

  it('waitEvent 配对独占：等待者取走后监听者不重复消费', async () => {
    const { ws, conn } = makeConn();
    const waiting = conn.waitEvent('Page.loadEventFired', 'S1', 100);
    const broadcast: string[] = [];
    conn.onEvent((e) => broadcast.push(e.method));
    ws.serverSend({ method: 'Page.loadEventFired', params: {}, sessionId: 'S1' });
    await expect(waiting).resolves.toEqual({});
    expect(broadcast).toEqual([]); // 配对等待者独占
    // 事件帧按 sessionId 配对（异 session 不误配）
    const waiting2 = conn.waitEvent('Page.loadEventFired', 'S2', 100);
    ws.serverSend({ method: 'Page.loadEventFired', params: {}, sessionId: 'S9' });
    await tick();
    let settled = false;
    void waiting2.then(() => {
      settled = true;
    });
    expect(settled).toBe(false); // S9 帧未唤醒 S2 等待者
    ws.serverSend({ method: 'Page.loadEventFired', params: {}, sessionId: 'S2' });
    await expect(waiting2).resolves.toEqual({});
  });

  it('waitEvent 超时 reject 普通 Error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { conn } = makeConn();
    const waiting = conn.waitEvent('Page.loadEventFired', undefined, 30);
    const observed = waiting.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await vi.advanceTimersByTimeAsync(31);
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    expect(String(outcome.ok ? '' : outcome.err)).toContain('等待超时');
    vi.useRealTimers();
  });

  it('监听者抛错 contained（warn 不炸分发链——后续监听者照常收）', async () => {
    const warns: string[] = [];
    const events: string[] = [];
    const ws = new FakeWs();
    const conn = createCdpConnection(ws, { logger: { warn: (m) => warns.push(m) } });
    conn.onEvent(() => {
      throw new Error('监听者自爆');
    });
    conn.onEvent((e) => events.push(e.method));
    ws.serverSend({ method: 'X', params: {} });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('contained');
    expect(events).toEqual(['X']); // 自爆者不吞后续监听者
  });

  it('非 JSON 帧丢弃（协议面外噪声静默）', async () => {
    const { ws, conn } = makeConn();
    const events: unknown[] = [];
    conn.onEvent((e) => events.push(e));
    ws.serverSendRaw('not-json{{');
    expect(events).toEqual([]);
  });
});

describe('连接级收口', () => {
  it('ws 关闭：在途命令结清 BROWSER_CONNECT_FAILED + 事件等待结清 + onDown 一次送达', async () => {
    const { ws, conn } = makeConn();
    const cmd = conn.send('Page.navigate', { url: 'https://example.com' }, { timeoutMs: 5000 });
    const waiting = conn.waitEvent('Page.loadEventFired', undefined, 5000);
    const downs: string[] = [];
    conn.onDown((r) => downs.push(r));
    const cmdObserved = cmd.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    ws.emitClose();
    const outcome = await cmdObserved;
    expect(outcome.ok).toBe(false);
    const err = outcome.ok ? undefined : outcome.err;
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('BROWSER_CONNECT_FAILED');
    await expect(waiting).rejects.toThrow('事件等待结清');
    expect(downs).toHaveLength(1);
    // 迟到订阅即回调
    conn.onDown((r) => downs.push(`late:${r}`));
    expect(downs).toHaveLength(2);
    // 死后快拒
    await expect(conn.send('X')).rejects.toSatisfy(
      (e: unknown) => e instanceof BaseError && (e as BaseError).code === 'BROWSER_CONNECT_FAILED',
    );
    expect(conn.isDead).toBe(true);
  });

  it('close() 主动关：幂等（二次同结算不重复送达）', async () => {
    const { conn } = makeConn();
    const downs: string[] = [];
    conn.onDown((r) => downs.push(r));
    conn.close();
    conn.close();
    expect(downs).toEqual(['主动关闭']);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
