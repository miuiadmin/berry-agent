/**
 * 帧式 JSON-RPC 连接（03 §10.2 帧层承载——Content-Length 帧上的请求关联表）。
 *
 * 与 mcp 件 JsonRpcConnection 同律异帧（行帧 vs 长度帧）——DAG 零边故平行
 * 实现，词面独立律（02 §4.1）：
 * - 请求关联表：id 递增登记、三源结清竞速先到即摘（响应/超时/failAll）；
 * - 服务器→客户端请求一律 -32601 拒答（v1 不承载 workspace/configuration
 *   等反向能力面）；
 * - 服务器通知按 method 分发给订阅面（publishDiagnostics 唯一真消费）；
 * - 帧 fatal（双帽超限/坏头）→ onFatal 上报一次 + pending 总清（载体级
 *   失败收场归实例侧：封读 + 同步树杀）。
 */
import { BaseError } from '../contracts/index.js';
import { FrameDecoder, encodeFrame } from './frame.js';

/** 连接构造依赖（全可注入——测试零真载体依赖） */
export interface LspWireOptions {
  /** 帧写出面（宿主接子进程 stdin——本层已完成帧编码） */
  readonly send: (frame: Buffer) => void;
  /** 帧 fatal 上报（实例侧收口：封读 + 同步树杀） */
  readonly onFatal?: (reason: string) => void;
  /** 坏帧/坏 JSON 告警面（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** 服务器通知载荷（publishDiagnostics 消费形） */
export interface LspNotification {
  readonly method: string;
  readonly params: unknown;
}

/** pending 登记项（关联表——超时/响应/载体死三源结清竞速，先到即摘） */
interface PendingEntry {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer?: NodeJS.Timeout;
}

/**
 * 单实例线协议连接。生命周期语义：dead 旗（载体死/fatal）后 request 即拒
 * （快失败不悬挂）；failAll 是 pending 的总结清面（crash/超限共用）。
 */
export class LspWire {
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly decoder = new FrameDecoder();
  private readonly notificationHandlers = new Map<string, ((n: LspNotification) => void)[]>();
  private readonly options: LspWireOptions;
  private dead = false;

  constructor(options: LspWireOptions) {
    this.options = options;
  }

  /** 发请求（关联表登记 + 可选超时执法——两钟接力：握手钟/请求钟各自传入） */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.dead) {
      return Promise.reject(new BaseError('LSP_CONNECT_FAILED', '连接已死（载体级失败/crash）——不再发请求'));
    }
    const id = this.nextId++;
    const frame: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) frame.params = params;
    return new Promise<unknown>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`LSP 请求超时（${method}，预算 ${timeoutMs}ms）`));
        }, timeoutMs);
      }
      this.pending.set(id, { resolve, reject, timer });
      this.options.send(encodeFrame(JSON.stringify(frame)));
    });
  }

  /** 发通知（无 id 不等回复——initialized/didOpen/didChange/didClose/exit） */
  notify(method: string, params?: unknown): void {
    if (this.dead) return;
    const frame: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) frame.params = params;
    this.options.send(encodeFrame(JSON.stringify(frame)));
  }

  /** 订阅服务器通知（method 分发；返回退订闭包） */
  onNotification(method: string, handler: (n: LspNotification) => void): () => void {
    const list = this.notificationHandlers.get(method) ?? [];
    list.push(handler);
    this.notificationHandlers.set(method, list);
    return () => {
      const current = this.notificationHandlers.get(method);
      if (current === undefined) return;
      const idx = current.indexOf(handler);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  /** stdout 字节喂入（帧劈 → 逐帧分派；帧 fatal 即载体级失败收口） */
  feed(chunk: Buffer): void {
    const { frames, fatal } = this.decoder.feed(chunk);
    if (fatal) {
      this.die(
        new BaseError('LSP_FRAME_INVALID', 'Content-Length 帧坏形或双帽超限（攒头 16KiB / 攒正文 16MiB）——载体级失败'),
        '帧双帽超限/坏头',
      );
      return;
    }
    for (const frame of frames) this.dispatch(frame);
  }

  /** 载体死结清（crash/close——pending 全拒；幂等） */
  failAll(error: Error): void {
    this.die(error, undefined);
  }

  /** 内部死面：dead 封口 + pending 总清（fatal 时另报 onFatal 一次） */
  private die(error: Error, fatalReason: string | undefined): void {
    if (this.dead) return;
    this.dead = true;
    for (const entry of this.pending.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    if (fatalReason !== undefined) this.options.onFatal?.(fatalReason);
  }

  /** 单帧分派（响应结清 / 服务器方向请求拒答 / 通知分发） */
  private dispatch(frame: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(frame);
    } catch {
      this.options.warn?.(`LSP 帧 JSON 坏形跳过：${frame.slice(0, 120)}`);
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };
    if (typeof m.method === 'string') {
      if (m.id !== undefined) {
        // 服务器→客户端请求：一律 -32601（v1 不承载反向能力面）
        if (!this.dead) {
          this.options.send(
            encodeFrame(
              JSON.stringify({
                jsonrpc: '2.0',
                id: m.id,
                error: { code: -32601, message: `v1 拒答服务器请求 ${m.method}` },
              }),
            ),
          );
        }
        return;
      }
      // 通知：按 method 分发给订阅面（publishDiagnostics 唯一真消费）
      for (const handler of [...(this.notificationHandlers.get(m.method) ?? [])]) {
        handler({ method: m.method, params: m.params });
      }
      return;
    }
    if (typeof m.id === 'number') {
      const entry = this.pending.get(m.id);
      if (entry === undefined) return; // 迟到/未知 id——超时已结清
      this.pending.delete(m.id);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      if (m.error !== undefined) {
        entry.reject(new Error(`LSP ${m.error.code}: ${m.error.message}`));
      } else {
        entry.resolve(m.result);
      }
    }
  }
}
