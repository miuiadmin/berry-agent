/**
 * berry-agent-sdk/stdio — spawn serve stdio 传输（批 13f-3）。
 *
 * spawn 子进程（缺省 process.execPath + 调用方给 args——serve 形态如
 * `['<主包>/dist/host/main.js', 'serve']`，安装布局由调用方知悉、本件不猜）、
 * stdin/stdout 行帧 NDJSON（编解码复用主仓 channels jsonl 件——行安全转义
 * 与分帧单源，零第二套）。
 *
 * 帧归属纪律：线协议无请求 id ⇒ 事务串行链（一次一事务——前一事务应答落定
 * 才发下一笔）；在队帧〔event/heartbeat/ask/重放 entries/replay-end〕入当前
 * 订阅监听面。订阅建立 = hello 帧（取快照高水位）→ replay-end（衔接界标即
 * resolve 位；界标帧本身也入监听面——重放段全量承诺）两段同事务。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { decodeWireLine, encodeWireLine, isSdkRequest, splitWireLines } from '../../../src/channels/sdk/jsonl.js';
import { SDK_PROTOCOL_VERSION } from '../../../src/channels/sdk/protocol.js';
import type { SdkRequest, SdkWireFrame } from '../../../src/channels/sdk/protocol.js';

import { SdkError } from './types.js';
import type { SdkFrameListener, SdkLiveHandle, SdkLiveParams, SdkTransport } from './types.js';

/** spawn 选项（args 必填——serve 启动形由调用方知悉，本件不猜安装布局） */
export interface SpawnServeOptions {
  /** 可执行（缺省 process.execPath——node 直跑形） */
  readonly command?: string;
  /** 子进程参数（必填——serve 形态启动面） */
  readonly args: readonly string[];
  /** 环境变量（缺省继承 process.env） */
  readonly env?: Record<string, string | undefined>;
  /** 工作目录（缺省继承） */
  readonly cwd?: string;
  /** 子进程 stderr 观察面（诊断——缺省静默；注意 serve 形 stderr 含日志） */
  readonly onStderr?: (chunk: string) => void;
  /** 坏行/反向帧诊断面（缺省静默） */
  readonly onWarn?: (message: string) => void;
}

/** stdio 传输柄（传输三档 + 子进程终局） */
export interface SdkStdioTransport extends SdkTransport {
  /** 子进程退出码终局（close 后落定；spawn 失败形 = -1） */
  readonly exited: Promise<number>;
}

/** 各动词的应答帧闭集（帧归属判据——事务串行 + 服务端同步受理语义下单调） */
const EXPECTED_KINDS: Readonly<Record<string, readonly string[]>> = {
  prompt: ['ack', 'error'],
  getEntries: ['entries', 'error'],
  sessions: ['sessions', 'error'],
  decide: ['decide-result', 'error'],
};

/** spawn serve 子进程并建传输 */
export function spawnServeTransport(options: SpawnServeOptions): SdkStdioTransport {
  const warn = options.onWarn ?? (() => {});
  const child: ChildProcess = spawn(options.command ?? process.execPath, [...options.args], {
    env: options.env ?? process.env,
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // —— 入站环：分帧（跨 chunk 安全）→ 解码（fail-loud 坏行跳过不崩）→ 归属 ——
  let remainder = '';
  let liveListener: SdkFrameListener | undefined;
  /** 在队事务（串行链保证至多一笔）——expect 帧族命中即 resolve */
  let inflight: { expect: ReadonlySet<string>; resolve: (frame: SdkWireFrame) => void } | undefined;

  const deliver = (frame: SdkWireFrame): void => {
    if (inflight !== undefined && inflight.expect.has(frame.kind)) {
      const done = inflight;
      inflight = undefined;
      done.resolve(frame);
      return;
    }
    liveListener?.(frame); // 直播/重放/心跳帧——订阅面
  };

  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    const split = splitWireLines(chunk, remainder);
    remainder = split.remainder;
    for (const line of split.lines) {
      try {
        const decoded = decodeWireLine(line);
        // 出站方向只有帧——请求形属协议违约（反向帧），跳过不崩
        if (isSdkRequest(decoded)) {
          warn(`反向帧跳过（客户端不应收请求形）：${line}`);
          continue;
        }
        deliver(decoded);
      } catch (err) {
        warn(`坏行跳过：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => options.onStderr?.(chunk));

  // —— 事务串行链：一次一事务（帧归属在结构上无歧义——线协议无请求 id）——
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(transaction: () => Promise<T>): Promise<T> => {
    const next = chain.then(transaction, transaction);
    chain = next.catch(() => {}); // 链不断——前事务失败不阻塞后事务
    return next;
  };

  /** 单帧应答事务：写请求、挂期望帧族、等归属命中 */
  const roundTrip = (req: SdkRequest, expect: readonly string[]): Promise<SdkWireFrame> =>
    serialize(
      () =>
        new Promise<SdkWireFrame>((resolve) => {
          inflight = { expect: new Set(expect), resolve };
          child.stdin!.write(encodeWireLine(req));
        }),
    );

  // —— 终局：exit 正常位；spawn 失败形（ENOENT 等）exit 不触发——error/close 兜底 -1 ——
  let exited = false;
  const exitedPromise = new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      if (exited) return;
      exited = true;
      resolve(code);
    };
    child.on('exit', (code) => settle(code ?? 0));
    child.on('error', () => settle(-1));
    child.on('close', (code) => settle(code ?? -1)); // spawn 失败形 exit 缺席 close 补位
  });

  /** 订阅收口（stdio 形：线无退订动词——记客户端口径，监听面回置空） */
  const liveClose = async (): Promise<void> => {
    liveListener = undefined;
  };

  // —— 收口（幂等）：收线 + 监听解挂；终局 = 子进程退出码 ——
  let closed = false;
  const transport: SdkStdioTransport = {
    exited: exitedPromise,
    request: (req: SdkRequest) => {
      const expect = EXPECTED_KINDS[req.verb];
      if (expect === undefined) {
        // hello/interrupt 非单帧事务位（hello = openLive 两段、interrupt = send 无应答）
        return Promise.reject(
          new SdkError('SDK_TRANSPORT', `动词 ${req.verb} 不走请求档（hello→subscribe / interrupt→send）`),
        );
      }
      return roundTrip(req, expect);
    },
    send: (req: SdkRequest) =>
      serialize(async () => {
        child.stdin!.write(encodeWireLine(req));
      }),
    openLive: (params: SdkLiveParams, onFrame: SdkFrameListener) =>
      serialize(
        () =>
          new Promise<SdkLiveHandle>((resolve, reject) => {
            liveListener = onFrame;
            let highWaterSeq = -1;
            // 订阅两段同事务：hello（快照高水位）→ replay-end（衔接界标即建立点）
            inflight = {
              expect: new Set(['hello', 'error']),
              resolve: (frame) => {
                if (frame.kind === 'error') {
                  reject(new SdkError((frame as { code: string }).code, (frame as { message: string }).message));
                  return;
                }
                highWaterSeq = (frame as { highWaterSeq: number }).highWaterSeq;
                inflight = {
                  expect: new Set(['replay-end']),
                  resolve: (marker) => {
                    onFrame(marker); // 界标帧入监听面（重放段全量承诺）后再立柄
                    resolve({ sessionId: params.sessionId, highWaterSeq, close: liveClose });
                  },
                };
              },
            };
            child.stdin!.write(
              encodeWireLine({
                verb: 'hello',
                protocolVersion: SDK_PROTOCOL_VERSION,
                sessionId: params.sessionId,
                ...(params.after !== undefined ? { after: params.after } : {}),
                ...(params.noDelta !== undefined ? { noDelta: params.noDelta } : {}),
              }),
            );
          }),
      ),
    close: async () => {
      if (closed) return;
      closed = true;
      liveListener = undefined;
      child.stdin!.end(); // 收线（EOF——serve 优雅退出序）
      await exitedPromise;
    },
  };
  return transport;
}
