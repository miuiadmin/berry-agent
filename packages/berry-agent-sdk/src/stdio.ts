/**
 * berry-agent-sdk/stdio — spawn serve stdio 传输（批 13f-3）。
 *
 * spawn 子进程（缺省 process.execPath + 调用方给 args——serve 形态如
 * `['<主包>/dist/host/main.js', 'serve']`，安装布局由调用方知悉、本件不猜）、
 * stdin/stdout 行帧 NDJSON（编解码复用主仓 channels jsonl 件——行安全转义
 * 与分帧单源，零第二套）。
 *
 * 建立即连接级握手（03 §10.6 ⑤ 定形补笔）：spawn 后先发 sessionId 缺席的
 * 连接级 hello（宿主 wire-core 连接级档——零订阅纯握手，应答 hello 帧回携
 * protocolVersion 双方比对），先于任何请求帧（串行链头位保证）；版本不符
 * 即毒丸化 fail-loud 拒用传输（此后一切事务面携 SDK_PROTOCOL_MISMATCH 拒）。
 *
 * 帧归属纪律：线协议无请求 id ⇒ 事务串行链（一次一事务——前一事务应答落定
 * 才发下一笔）；在队帧〔event/heartbeat/ask/重放 entries/replay-end〕入当前
 * 订阅监听面。订阅建立 = hello 帧（取快照高水位）→ replay-end（衔接界标即
 * resolve 位；界标帧本身也入监听面——重放段全量承诺）两段同事务。
 *
 * 终局纪律（03 §10.6 传输腿错误面定形补笔①）：子进程终局（exit/error/close）
 * → 在飞事务 fail-loud 拒绝（SDK_TRANSPORT 含退出码）并清 inflight——串行链
 * 自动续走（防前一事务不落定致整链静默挂死）；终局后的新事务同律即拒。
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
  /** 在队事务（串行链保证至多一笔）——expect 帧族命中即 resolve；终局兜底走 reject（fail-loud） */
  let inflight:
    | {
        expect: ReadonlySet<string>;
        resolve: (frame: SdkWireFrame) => void;
        reject: (err: SdkError) => void;
      }
    | undefined;

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
  // stdin 写侧防御监听：子进程先亡后的残写（EPIPE 等平台形）归因诊断面——
  // 无 error 监听的流错误以未捕获异常打崩 SDK 消费进程（本平台静默丢弃、他平台防御）
  child.stdin!.on('error', (err) => {
    warn(`stdin 写失败：${err instanceof Error ? err.message : String(err)}`);
  });

  // —— 事务串行链：一次一事务（帧归属在结构上无歧义——线协议无请求 id）——
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(transaction: () => Promise<T>): Promise<T> => {
    const next = chain.then(transaction, transaction);
    chain = next.catch(() => {}); // 链不断——前事务失败不阻塞后事务
    return next;
  };

  /** 单帧应答事务：写请求、挂期望帧族、等归属命中；门检先行（毒丸/终局即 fail-loud 拒） */
  const roundTrip = (req: SdkRequest, expect: readonly string[]): Promise<SdkWireFrame> =>
    serialize(
      () =>
        new Promise<SdkWireFrame>((resolve, reject) => {
          const gate = transactionGate();
          if (gate !== undefined) {
            reject(gate);
            return;
          }
          inflight = { expect: new Set(expect), resolve, reject };
          child.stdin!.write(encodeWireLine(req));
        }),
    );

  // —— 终局：exit 正常位；spawn 失败形（ENOENT 等）exit 不触发——error/close 兜底 -1 ——
  let exited = false;
  let exitCode: number | undefined; // 终局码（门检报因携带——settle 内先于 exited 置位）
  const exitedPromise = new Promise<number>((resolve) => {
    const settle = (code: number): void => {
      if (exited) return;
      exitCode = code;
      exited = true;
      // 终局 → 在飞事务 fail-loud 拒（03 §10.6 定形补笔①：SDK_TRANSPORT 含退出码）；
      // 清 inflight 使串行链自动续走——防前一事务不落定致整链静默挂死
      const pending = inflight;
      inflight = undefined;
      pending?.reject(new SdkError('SDK_TRANSPORT', `子进程已退出（code=${code}）——在飞事务无法落定`));
      resolve(code);
    };
    child.on('exit', (code) => settle(code ?? 0));
    child.on('error', () => settle(-1));
    child.on('close', (code) => settle(code ?? -1)); // spawn 失败形 exit 缺席 close 补位
  });

  // —— 建立即连接级握手（03 §10.6 ⑤ 定形补笔）：串行链头位——先于任何请求帧 ——
  let handshakeError: SdkError | undefined; // 版本错配毒丸——此后一切事务面 fail-loud 拒用传输
  /** 事务面门检（fail-loud 先于写 stdin）：毒丸/终局任一在场即拒新事务 */
  const transactionGate = (): SdkError | undefined => {
    if (handshakeError !== undefined) return handshakeError;
    if (exited) return new SdkError('SDK_TRANSPORT', `子进程已退出（code=${exitCode}）——传输不可再用`);
    return undefined;
  };
  const handshake: Promise<void> = serialize(
    () =>
      new Promise<void>((resolve, reject) => {
        const gate = transactionGate(); // 构造后立即 close / 子进程瞬亡形——握手本身即拒
        if (gate !== undefined) {
          handshakeError = gate;
          reject(gate);
          return;
        }
        inflight = {
          expect: new Set(['hello', 'error']),
          resolve: (frame) => {
            if (frame.kind === 'error') {
              // 宿主版本闸（⑤ 不符即拒连）——错误帧原码投形毒丸化
              const err = new SdkError((frame as { code: string }).code, (frame as { message: string }).message);
              handshakeError = err;
              reject(err);
              return;
            }
            // 应答 hello 帧回携 protocolVersion——客户端侧比对（⑤「双方携版本比对」）
            const serverVersion = (frame as { protocolVersion: number }).protocolVersion;
            if (serverVersion !== SDK_PROTOCOL_VERSION) {
              const err = new SdkError(
                'SDK_PROTOCOL_MISMATCH',
                `线协议版本不符：服务端 ${serverVersion} / 调用方 ${SDK_PROTOCOL_VERSION}`,
              );
              handshakeError = err;
              reject(err);
              return;
            }
            resolve();
          },
          reject: (err) => {
            // 握手期子进程终局（settle 兜底 reject）——同毒丸拒用
            handshakeError = err;
            reject(err);
          },
        };
        child.stdin!.write(encodeWireLine({ verb: 'hello', protocolVersion: SDK_PROTOCOL_VERSION }));
      }),
  );
  // 握手失败即 best-effort 收线子进程（连接已不可用——不等优雅 EOF 退出序；已亡形 kill 为 no-op）
  handshake.catch(() => {
    child.kill();
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
        // 事务面门检同律：终局/毒丸后写 stdin 是伪成功——诚实拒
        const gate = transactionGate();
        if (gate !== undefined) throw gate;
        child.stdin!.write(encodeWireLine(req));
      }),
    openLive: (params: SdkLiveParams, onFrame: SdkFrameListener) =>
      serialize(
        () =>
          new Promise<SdkLiveHandle>((resolve, reject) => {
            const gate = transactionGate();
            if (gate !== undefined) {
              reject(gate);
              return;
            }
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
                  reject, // 建立期终局兜底（replay-end 前）——订阅建立 Promise 不得悬挂
                };
              },
              reject,
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
