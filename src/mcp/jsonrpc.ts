/**
 * 行帧 JSON-RPC 编解码与关联表（03 §10.1 手写最小桥的协议腿——零新增依赖）。
 *
 * 五方法面：initialize / notifications·initialized / tools/list / tools/call /
 * ping——id 关联表桥级数十行即覆盖，不引 @modelcontextprotocol/sdk。
 *
 * 行帧卫生：server stdout 单行字节上限（缺省 8MiB）——超限按载体级失败收场：
 * 本层停攒丢弃（静默巨行不进宿主堆）+ fatal 一次上报（桥侧收口 = 封读
 * destroy + 结清 pending + 树杀 server）。
 *
 * 服务器→客户端方向（transport v1 = stdio-only）：
 * - 请求一律回 -32601（sampling/elicitation capability 拒答——本仓不承载
 *   这些面），唯一例外 ping 照答（result null）；
 * - 通知忽略（tools/list_changed v1 不热刷——改配置走 /reload）；
 * - 宿主不主动 ping——crash 检测靠载体 close 事件（桥侧接线），本层只给
 *   failAll 结清面。
 */
import { BaseError } from '../contracts/index.js';
import { MCP_LINE_LIMIT_BYTES } from './types.js';

/** JSON-RPC error 对象（响应内嵌形） */
export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** JSON-RPC 层错误（服务器 error 响应折形——业务面消费 code/message） */
export class JsonRpcError extends Error {
  readonly rpcCode: number;
  readonly rpcData: unknown;
  constructor(error: JsonRpcErrorObject) {
    super(`JSON-RPC ${error.code}: ${error.message}`);
    this.name = 'JsonRpcError';
    this.rpcCode = error.code;
    this.rpcData = error.data;
  }
}

/**
 * 行劈解码器（字节面——攒段跨 chunk 拼行）。
 *
 * 防线两处：残段累积超帽（无换行的持续巨流）与完整单行超帽（一次到位的
 * 巨行响应）——任一触发行帧 fatal：此后解码器恒死（不再攒、不再上报——
 * 一次语义），fatal 后残余行不外发（pending 由连接层结清，行内容无意义）。
 */
export class LineDecoder {
  private chunks: Buffer[] = [];
  private size = 0;
  private fatal = false;

  constructor(private readonly limitBytes: number = MCP_LINE_LIMIT_BYTES) {}

  /**
   * 喂入一段字节；返回完整行（UTF-8 解码、空行丢弃）。
   * fatal = true 即载体级失败（本次起解码器死——后续 feed 恒空恒不报）。
   */
  feed(chunk: Buffer): { lines: string[]; fatal: boolean } {
    if (this.fatal) return { lines: [], fatal: false };
    // 换行只可能在本次 chunk 内新现（此前 chunk 已全扫无换行）——快路径零拷贝
    let idx = chunk.indexOf(0x0a);
    if (idx < 0) {
      this.chunks.push(chunk);
      this.size += chunk.length;
      if (this.size > this.limitBytes) {
        this.fatal = true;
        this.chunks = [];
        this.size = 0;
        return { lines: [], fatal: true };
      }
      return { lines: [], fatal: false };
    }
    // 劈完整行（首段与历史残段拼接；后续段即完整行；尾段成新残段）
    const rawLines: Buffer[] = [];
    let start = 0;
    let first = true;
    while (idx >= 0) {
      const seg = chunk.subarray(start, idx);
      if (first && this.chunks.length > 0) {
        rawLines.push(Buffer.concat([...this.chunks, seg]));
        this.chunks = [];
        this.size = 0;
      } else {
        rawLines.push(seg);
      }
      first = false;
      start = idx + 1;
      idx = chunk.indexOf(0x0a, start);
    }
    const rest = chunk.subarray(start);
    if (rest.length > 0) {
      // subarray 视图持有母本——拷贝释放（防巨母本长活）
      this.chunks = [Buffer.from(rest)];
      this.size = rest.length;
    } else {
      this.chunks = [];
      this.size = 0;
    }
    // 单行超帽判定（先判后转——fatal 即全弃不发半批）
    for (const raw of rawLines) {
      if (raw.length > this.limitBytes) {
        this.fatal = true;
        this.chunks = [];
        this.size = 0;
        return { lines: [], fatal: true };
      }
    }
    const lines: string[] = [];
    for (const raw of rawLines) {
      if (raw.length > 0) lines.push(raw.toString('utf8'));
    }
    return { lines, fatal: false };
  }
}

/** pending 登记项（关联表——超时/响应/载体死三源结清竞速，先到即摘） */
interface PendingEntry {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer?: NodeJS.Timeout;
}

/** 连接构造依赖（全可注入——测试零真载体依赖） */
export interface JsonRpcConnectionOptions {
  /** 行帧写出面（宿主接子进程 stdin——本层补换行） */
  readonly send: (line: string) => void;
  /** 行帧 fatal 上报（桥侧收口：封读 + 树杀） */
  readonly onFatal?: (reason: string) => void;
  /** 单行字节上限（缺省 8MiB） */
  readonly lineLimitBytes?: number;
  /** 坏行告警面（缺省静默——坏行跳过不炸连接） */
  readonly warn?: (message: string) => void;
}

/**
 * 行帧 JSON-RPC 连接（单服务器一座——请求关联表 + 服务器方向分派）。
 *
 * 生命周期语义：dead 旗（载体死/fatal）后 request 即拒（快失败不悬挂）；
 * failAll 是 pending 的总结清面（crash/close/超限三源共用）。
 */
export class JsonRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly decoder: LineDecoder;
  private readonly options: JsonRpcConnectionOptions;
  private dead = false;

  constructor(options: JsonRpcConnectionOptions) {
    this.options = options;
    this.decoder = new LineDecoder(options.lineLimitBytes);
  }

  /**
   * 发请求（关联表登记 + 可选超时执法）。超时按拒绝结清——调用方分类语义
   * （连接期超时 = MCP_CONNECT_FAILED；调用期超时 = 工具结果 error）。
   */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.dead) {
      return Promise.reject(new BaseError('MCP_CONNECT_FAILED', '连接已死（载体级失败/crash）——不再发请求'));
    }
    const id = this.nextId++;
    const frame: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) frame.params = params;
    return new Promise<unknown>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`JSON-RPC 请求超时（${method}，预算 ${timeoutMs}ms）`));
        }, timeoutMs);
      }
      this.pending.set(id, { resolve, reject, timer });
      this.options.send(JSON.stringify(frame));
    });
  }

  /** 发通知（无 id 不等回复——notifications/initialized 唯一消费者） */
  notify(method: string, params?: unknown): void {
    if (this.dead) return;
    const frame: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) frame.params = params;
    this.options.send(JSON.stringify(frame));
  }

  /** stdout 字节喂入（行劈 → 逐行分派；行帧 fatal 即载体级失败收口） */
  feed(chunk: Buffer): void {
    const { lines, fatal } = this.decoder.feed(chunk);
    if (fatal) {
      this.die(
        new BaseError(
          'MCP_CONNECT_FAILED',
          `server stdout 单行超 ${this.options.lineLimitBytes ?? MCP_LINE_LIMIT_BYTES} 字节帽——载体级失败`,
        ),
        '行帧超帽',
      );
      return;
    }
    for (const line of lines) this.dispatch(line);
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

  /** 单行分派（响应结清 / 服务器方向请求应答 / 通知忽略） */
  private dispatch(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.options.warn?.(`server 行帧 JSON 坏形跳过：${line.slice(0, 120)}`);
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as {
      id?: unknown;
      method?: unknown;
      result?: unknown;
      error?: JsonRpcErrorObject;
    };
    if (typeof m.method === 'string') {
      if (m.id !== undefined) {
        // 服务器→客户端请求：ping 照答；其余一律 -32601（capability 拒答）
        const response =
          m.method === 'ping'
            ? { jsonrpc: '2.0' as const, id: m.id, result: null }
            : {
                jsonrpc: '2.0' as const,
                id: m.id,
                error: { code: -32601, message: `transport v1 stdio-only：拒答服务器请求 ${m.method}` },
              };
        if (!this.dead) this.options.send(JSON.stringify(response));
      }
      // 通知（含 tools/list_changed）——v1 忽略不热刷
      return;
    }
    if (typeof m.id === 'number') {
      const entry = this.pending.get(m.id);
      if (entry === undefined) return; // 迟到/未知 id——超时已结清或非本连接帧
      this.pending.delete(m.id);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      if (m.error !== undefined) entry.reject(new JsonRpcError(m.error));
      else entry.resolve(m.result);
    }
  }
}
