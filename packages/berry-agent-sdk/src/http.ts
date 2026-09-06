/**
 * berry-agent-sdk/http — 直连 HTTP 传输（批 13f-3）。
 *
 * 面向 13e 落码的 SDK HTTP face（daemon sock / 前台 TCP 两监听形）。路由与
 * 鉴权头常量单源自 `src/sdk/types.js` 复导入——端点词面漂移在结构上不可能。
 * node:http 直用（fetch 无 Unix socket 支持——daemon 缺省接入位即 sock）。
 *
 * 应答归属：HTTP 请求/响应一一对应，帧归属天然无歧义——无需 stdio 形的
 * 事务串行链。错误帧以非 2xx + 错误体（与线协议错误帧同构）回达 → 本层
 * 还原为帧原样返回（投形归 client）；传输级失败（连接拒/断）抛
 * `SDK_TRANSPORT`。直播档 = GET /v1/events SSE：`data: <单行 JSON>` 块 +
 * `: ping` 注释行——与 face 写侧纪律一一对应。
 */
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';

import { decodeWireLine, isSdkRequest } from '../../../src/channels/sdk/jsonl.js';
import { SDK_PROTOCOL_VERSION } from '../../../src/channels/sdk/protocol.js';
import type { SdkRequest, SdkWireFrame } from '../../../src/channels/sdk/protocol.js';
import { SDK_AUTH_HEADER, SDK_HTTP_ENDPOINTS, SDK_PROTOCOL_HEADER } from '../../../src/sdk/types.js';

import { SdkError } from './types.js';
import type { SdkFrameListener, SdkLiveHandle, SdkLiveParams, SdkTransport } from './types.js';

/** HTTP 传输选项（sock 与 host/port 二选一——daemon 缺省接入位即 sock） */
export interface HttpSdkOptions {
  /** Unix domain socket 路径（daemon 形） */
  readonly socketPath?: string;
  /** TCP 主机（前台形；与 port 成对） */
  readonly host?: string;
  /** TCP 端口（前台形；与 host 成对） */
  readonly port?: number;
  /** 鉴权 token（Bearer 形——面侧每请求验） */
  readonly token: string;
  /** 坏行/SSE 诊断面（缺省静默） */
  readonly onWarn?: (message: string) => void;
}

/** 各请求档动词 → 端点路由（GET/POST 与体形由面定形） */
const ROUTES: Readonly<Record<string, { method: 'GET' | 'POST'; path: string }>> = {
  prompt: { method: 'POST', path: SDK_HTTP_ENDPOINTS.prompt },
  decide: { method: 'POST', path: SDK_HTTP_ENDPOINTS.decide },
  getEntries: { method: 'POST', path: SDK_HTTP_ENDPOINTS.entries },
  sessions: { method: 'GET', path: SDK_HTTP_ENDPOINTS.sessions },
};

/** 单次 HTTP 往返结果 */
interface HttpResult {
  readonly status: number;
  readonly body: string;
}

/** 直连 HTTP 传输 */
export function httpSdkTransport(options: HttpSdkOptions): SdkTransport {
  if ((options.socketPath === undefined) === (options.host === undefined)) {
    throw new SdkError('SDK_TRANSPORT', 'socketPath 与 host/port 须二选一');
  }
  const warn = options.onWarn ?? (() => {});
  /** 在场 SSE 流账（close 时逐一收口） */
  const liveStreams = new Set<IncomingMessage>();

  /** 单次请求（socketPath XOR host/port——Node 语义自动取舍） */
  const roundTrip = (method: 'GET' | 'POST', path: string, body?: string): Promise<HttpResult> =>
    new Promise<HttpResult>((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath: options.socketPath,
          host: options.host,
          port: options.port,
          method,
          path,
          headers: {
            ...(body !== undefined ? { 'content-type': 'application/json; charset=utf-8' } : {}),
            [SDK_AUTH_HEADER]: `Bearer ${options.token}`,
            [SDK_PROTOCOL_HEADER]: String(SDK_PROTOCOL_VERSION),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('error', (err: Error) =>
        reject(new SdkError('SDK_TRANSPORT', `${method} ${path} 传输失败：${err.message}`)),
      );
      if (body !== undefined) req.write(body);
      req.end();
    });

  /** 应答体 → 帧：2xx 解帧；非 2xx 错误体还原错误帧原样返回（投形归 client） */
  const toFrame = (result: HttpResult, what: string): SdkWireFrame => {
    if (result.status >= 200 && result.status < 300) {
      try {
        return decodeWireLine(result.body) as SdkWireFrame;
      } catch (err) {
        // 2xx 却非帧形 = 面侧违约——收进传输错词面（fail-loud 不裸抛解码错）
        throw new SdkError(
          'SDK_TRANSPORT',
          `${what} → 2xx 应答非帧形：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    try {
      // face 错误体与线协议错误帧同构（码→状态映射——词汇零第二套）
      const frame = decodeWireLine(result.body);
      if (!isSdkRequest(frame) && frame.kind === 'error') return frame;
    } catch {
      // 落到传输错——非帧形错误体
    }
    throw new SdkError('SDK_TRANSPORT', `${what} → HTTP ${result.status}：${result.body.slice(0, 200)}`);
  };

  const transport: SdkTransport = {
    request: async (req: SdkRequest) => {
      const route = ROUTES[req.verb];
      if (route === undefined) {
        return Promise.reject(
          new SdkError('SDK_TRANSPORT', `动词 ${req.verb} 不走请求档（hello→subscribe / interrupt→send）`),
        );
      }
      // 体 = 载荷去 verb（端点即动词——面侧注入权威）
      const { verb: _verb, ...payload } = req;
      const result = await roundTrip(
        route.method,
        route.path,
        route.method === 'POST' ? JSON.stringify(payload) : undefined,
      );
      return toFrame(result, `${route.method} ${route.path}`);
    },

    // 无应答档 HTTP 形：POST /v1/interrupt → 204 空体（写后即决）
    send: async (req: SdkRequest) => {
      const { verb: _verb, ...payload } = req;
      const result = await roundTrip('POST', SDK_HTTP_ENDPOINTS.interrupt, JSON.stringify(payload));
      if (result.status < 200 || result.status >= 300) {
        throw new SdkError('SDK_TRANSPORT', `interrupt → HTTP ${result.status}：${result.body.slice(0, 200)}`);
      }
    },

    openLive: (params: SdkLiveParams, onFrame: SdkFrameListener) =>
      new Promise<SdkLiveHandle>((resolve, reject) => {
        const query = new URLSearchParams({ sessionId: params.sessionId });
        if (params.after !== undefined) query.set('after', String(params.after));
        if (params.noDelta !== undefined) query.set('noDelta', params.noDelta ? '1' : '0');
        const req = httpRequest(
          {
            socketPath: options.socketPath,
            host: options.host,
            port: options.port,
            method: 'GET',
            path: `${SDK_HTTP_ENDPOINTS.events}?${query.toString()}`,
            headers: {
              accept: 'text/event-stream',
              [SDK_AUTH_HEADER]: `Bearer ${options.token}`,
              [SDK_PROTOCOL_HEADER]: String(SDK_PROTOCOL_VERSION),
            },
          },
          (res) => {
            if ((res.statusCode ?? 0) !== 200) {
              // 建流失败：错误体还原错误帧投形拒绝（订阅失败即整档失败）
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => {
                try {
                  const frame = decodeWireLine(Buffer.concat(chunks).toString('utf8'));
                  if (!isSdkRequest(frame) && frame.kind === 'error') {
                    reject(new SdkError(frame.code, frame.message));
                    return;
                  }
                } catch {
                  // 落到传输错
                }
                reject(new SdkError('SDK_TRANSPORT', `SSE 建流 → HTTP ${res.statusCode ?? 0}`));
              });
              return;
            }
            liveStreams.add(res);
            let highWaterSeq = -1;
            let buffer = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              buffer += chunk;
              // SSE 事件块以空行分隔；注释行（: ping）跳过——与 face 写侧纪律对应
              let sep: number;
              while ((sep = buffer.indexOf('\n\n')) !== -1) {
                const block = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                for (const data of sseDataPayloads(block)) {
                  try {
                    const frame = decodeWireLine(data);
                    if (isSdkRequest(frame)) {
                      warn(`SSE 反向帧跳过：${data.slice(0, 120)}`);
                      continue;
                    }
                    if (frame.kind === 'hello') {
                      // 握手首帧：取快照高水位，不入监听面（与 stdio 形同语义）
                      highWaterSeq = frame.highWaterSeq;
                      continue;
                    }
                    onFrame(frame);
                    if (frame.kind === 'replay-end') {
                      // 衔接界标即建立点——界标帧已入监听面（重放段全量承诺）
                      resolve({ sessionId: params.sessionId, highWaterSeq, close: liveClose(res) });
                    }
                  } catch (err) {
                    warn(`SSE 坏载荷跳过：${err instanceof Error ? err.message : String(err)}`);
                  }
                }
              }
            });
            res.on('error', (err) => warn(`SSE 流错误：${err.message}`));
          },
        );
        req.on('error', (err: Error) => reject(new SdkError('SDK_TRANSPORT', `SSE 建流传输失败：${err.message}`)));
        req.end();
      }),

    // 整连接收口（幂等）：在场 SSE 流逐一销毁（请求档无长连——keep-alive 由 agent 自理）
    close: async () => {
      for (const res of liveStreams) res.destroy();
      liveStreams.clear();
    },
  };
  return transport;
}

/** SSE 事件块 → data 载荷列表（`data: ` 前缀行拼接——多行 data 续接；注释行跳过） */
function sseDataPayloads(block: string): string[] {
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue; // 注释行（30s ping）
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data;
}

/** 单订阅收口工厂（幂等——流账摘除 + 销毁） */
function liveClose(res: IncomingMessage): () => Promise<void> {
  return async () => {
    res.destroy();
  };
}
