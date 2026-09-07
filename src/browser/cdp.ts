/**
 * CDP 连接件（03 §10.3 形态条款——手写 CDP 桥，零新增依赖）。
 *
 * 线形：browser 级单连接上的 JSON 文本帧（Chrome DevTools Protocol）——
 * 命令帧 {id, method, params, sessionId?} / 应答帧 {id, result|error} /
 * 事件帧 {method, params, sessionId?}。flat 模式下 per-session 命令带
 * sessionId 字段、事件按 sessionId 分流路由（Target.attachToTarget
 * {flatten:true} 产物）。
 *
 * 失败语义分账：连接级失败（ws 关闭/建立失败）= BROWSER_CONNECT_FAILED
 * （在途全结清 + onDown 通知）；单命令超时 = 普通 Error（连接仍活，调用方
 * 自决重试）——两分防「慢命令」误杀活连接。
 */
import { BaseError } from '../contracts/index.js';
import type { BrowserLoggerFace, BrowserWsConnection, BrowserWsFace } from './types.js';
import { BROWSER_CDP_COMMAND_TIMEOUT_MS } from './types.js';

/** CDP 事件帧归一形（路由面——事件按 sessionId 分流） */
export interface CdpEvent {
  readonly method: string;
  readonly params: unknown;
  readonly sessionId?: string;
}

/** CDP 命令应答错误（wire error 对象） */
export class CdpCommandError extends Error {
  constructor(
    readonly cdpCode: number,
    readonly cdpMessage: string,
  ) {
    super(`CDP 命令被拒（code ${cdpCode}）：${cdpMessage}`);
  }
}

/** CDP 连接公开面 */
export interface CdpConnection {
  /** 发命令（sessionId 在场 = flat 模式路由到该附着会话） */
  send(method: string, params?: object, opts?: { sessionId?: string; timeoutMs?: number }): Promise<unknown>;
  /** 事件挂线（全事件路由——监听者按 method/sessionId 自筛） */
  onEvent(listener: (event: CdpEvent) => void): () => void;
  /** 等待指定事件（method + sessionId 配对；超时 reject 普通 Error） */
  waitEvent(method: string, sessionId: string | undefined, timeoutMs: number): Promise<unknown>;
  /** 连接已死旗（ws 关闭即真——后续 send 快拒） */
  readonly isDead: boolean;
  /** 连接级降级通知（一次性收口：ws 关闭/进程退——幂等闸） */
  onDown(listener: (reason: string) => void): void;
  /** 主动关（幂等——ws.close + 在途结清） */
  close(): void;
}

/** 连接构造依赖 */
export interface CdpConnectionDeps {
  readonly logger?: BrowserLoggerFace;
  /** 单命令缺省钟（缺省 BROWSER_CDP_COMMAND_TIMEOUT_MS） */
  readonly commandTimeoutMs?: number;
}

/** 在途命令账 */
interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * 组 CDP 连接（ws 面之上——请求关联表 + 事件分流路由）。
 * ws.opened 由调用方（引擎层）先行 await——本件只消费已建立的连接。
 */
export function createCdpConnection(ws: BrowserWsConnection, deps: CdpConnectionDeps = {}): CdpConnection {
  const logger = deps.logger;
  const commandTimeout = deps.commandTimeoutMs ?? BROWSER_CDP_COMMAND_TIMEOUT_MS;
  const pending = new Map<number, PendingEntry>();
  /** 事件等待账（`${method}\0${sessionId ?? ''}` → 等待者队列） */
  const eventWaiters = new Map<
    string,
    Array<{ resolve: (params: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>
  >();
  const eventListeners = new Set<(event: CdpEvent) => void>();
  /** 已注册的 onDown 监听者（settleDown 快照送达 + 迟到订阅即回调共用账） */
  const downListeners = new Set<(reason: string) => void>();
  let downGate = false; // 幂等闸（true = 已收口）
  let deadReason = '';
  let nextId = 1;

  const isDead = (): boolean => downGate;

  /** 连接级收口（幂等闸）：在途命令 + 事件等待全结清 + onDown 一次性送达 */
  const settleDown = (reason: string): void => {
    if (downGate) return;
    downGate = true;
    deadReason = reason;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new BaseError('BROWSER_CONNECT_FAILED', `CDP 连接已断（${reason}）——在途命令 ${entry.method} 结清`));
    }
    pending.clear();
    for (const queue of eventWaiters.values()) {
      for (const waiter of queue) {
        clearTimeout(waiter.timer);
        // 事件流随连接死而终结（普通 Error——单事件等待非连接码域）
        waiter.reject(new Error(`CDP 连接已断（${reason}）——事件等待结清`));
      }
    }
    eventWaiters.clear();
    for (const listener of downListeners) listener(deadReason);
  };

  /** 事件分发：等待账优先（配对即清）→ 广播监听者 */
  const dispatchEvent = (event: CdpEvent): void => {
    const key = `${event.method}\0${event.sessionId ?? ''}`;
    const queue = eventWaiters.get(key);
    if (queue !== undefined && queue.length > 0) {
      const waiter = queue.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(event.params);
      if (queue.length === 0) eventWaiters.delete(key);
      return; // 配对等待者独占（loadEventFired 一类单发事件不容双消费）
    }
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch (err) {
        logger?.warn?.(`CDP 事件监听者抛错（contained 吞）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  /** 入站文本帧路由：应答帧（带 id）→ 关联表；事件帧（带 method）→ 分发 */
  ws.onMessage((text) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      logger?.warn?.(`CDP 入站帧非 JSON（丢弃）：${text.slice(0, 120)}`);
      return;
    }
    if (typeof msg.id === 'number') {
      const entry = pending.get(msg.id);
      if (entry === undefined) return; // 迟到应答（超时已结清）——静默
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error !== null && msg.error !== undefined) {
        const err = msg.error as { code?: unknown; message?: unknown };
        entry.reject(
          new CdpCommandError(
            typeof err.code === 'number' ? err.code : 0,
            typeof err.message === 'string' ? err.message : '未知错误',
          ),
        );
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    if (typeof msg.method === 'string') {
      dispatchEvent({
        method: msg.method,
        params: msg.params,
        ...(typeof msg.sessionId === 'string' ? { sessionId: msg.sessionId } : {}),
      });
    }
    // 既无 id 又无 method——协议面外噪声，静默
  });

  ws.onClose(() => settleDown('WebSocket 已关闭'));

  const conn: CdpConnection = {
    get isDead() {
      return isDead();
    },

    onDown(listener) {
      if (downGate) {
        listener(deadReason); // 迟到订阅即回调（mcp/lsp onExit 同律）
        return;
      }
      downListeners.add(listener);
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    waitEvent(method, sessionId, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (isDead()) {
          reject(new BaseError('BROWSER_CONNECT_FAILED', `CDP 连接已断（${deadReason}）——等待 ${method} 不可达`));
          return;
        }
        const key = `${method}\0${sessionId ?? ''}`;
        const waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const queue = eventWaiters.get(key);
            if (queue !== undefined) {
              const idx = queue.indexOf(waiter);
              if (idx >= 0) queue.splice(idx, 1);
              if (queue.length === 0) eventWaiters.delete(key);
            }
            reject(new Error(`CDP 事件 ${method} 等待超时（${timeoutMs}ms）`));
          }, timeoutMs),
        };
        const queue = eventWaiters.get(key);
        if (queue !== undefined) queue.push(waiter);
        else eventWaiters.set(key, [waiter]);
      });
    },

    send(method, params = {}, opts = {}) {
      return new Promise((resolve, reject) => {
        if (isDead()) {
          reject(new BaseError('BROWSER_CONNECT_FAILED', `CDP 连接已断（${deadReason}）——命令 ${method} 快拒`));
          return;
        }
        const id = nextId++;
        const timeoutMs = opts.timeoutMs ?? commandTimeout;
        const entry: PendingEntry = {
          resolve,
          reject,
          method,
          timer: setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP 命令 ${method} 超时（${timeoutMs}ms）——连接仍在，单命令结清`));
          }, timeoutMs),
        };
        pending.set(id, entry);
        const frame: Record<string, unknown> = { id, method, params };
        if (opts.sessionId !== undefined) frame.sessionId = opts.sessionId;
        try {
          ws.send(JSON.stringify(frame));
        } catch (err) {
          pending.delete(id);
          clearTimeout(entry.timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },

    close() {
      settleDown('主动关闭');
      ws.close();
    },
  };
  return conn;
}

/* ---------------- 生产 ws 面（Node ≥22 原生 WebSocket 包装） ---------------- */

/**
 * 缺省 ws 面：全局 WebSocket（undici 产物，Node ≥22 免 flag）。只暴露桥所需
 * 最小子集——opened 建立门 + 文本帧收发 + 关闭挂线。
 */
export function defaultWsFace(): BrowserWsFace {
  return {
    connect(url) {
      const socket = new WebSocket(url);
      let messageListener: ((text: string) => void) | undefined;
      let closeListener: (() => void) | undefined;
      let closed = false;
      socket.addEventListener('message', (event: MessageEvent) => {
        // CDP 线形恒文本帧；二进制帧（协议面外）丢弃
        if (typeof event.data === 'string') messageListener?.(event.data);
      });
      socket.addEventListener('close', () => {
        if (closed) return;
        closed = true;
        closeListener?.();
      });
      socket.addEventListener('error', () => {
        // error 不单独语义化：close 必随后到（undici 生命周期）——关联回归一处
      });
      const connection: BrowserWsConnection = {
        send: (text) => socket.send(text),
        close: () => {
          if (closed) return;
          try {
            socket.close();
          } catch {
            /* CLOSING 期重复 close——吞 */
          }
        },
        onMessage: (listener) => {
          messageListener = listener;
        },
        onClose: (listener) => {
          closeListener = listener;
        },
        opened: new Promise<void>((resolve, reject) => {
          socket.addEventListener('open', () => resolve());
          socket.addEventListener('close', () =>
            reject(new BaseError('BROWSER_CONNECT_FAILED', `WebSocket 建立失败（连接即关闭）：${url}`)),
          );
          socket.addEventListener('error', () =>
            reject(new BaseError('BROWSER_CONNECT_FAILED', `WebSocket 建立失败：${url}`)),
          );
        }),
      };
      return connection;
    },
  };
}
