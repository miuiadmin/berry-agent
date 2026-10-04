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
 * 才发下一笔）；在队帧〔event/heartbeat/ask/重放 entries/replay-end〕按帧
 * 会话锚路由各该会话的订阅监听面（多订阅并发正形——对齐 HTTP 形每 SSE 流
 * 独立帧循环；无锚帧广播全部订阅者，见 dispatch 注）。订阅建立 = hello 帧
 * （取快照高水位）→ replay-end（衔接界标即 resolve 位；界标帧本身也入监听
 * 面——重放段全量承诺）两段同事务。无应答档（interrupt）失败形的无主 error
 * 帧经吸收位路由诊断面/订阅面——不入事务（防串味下一事务，见 deliver 吸收
 * 位注）。
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
  /**
   * 订阅路由账（多订阅正形——sweep10 件2）：会话锚 → 监听面。修前单槽
   * liveListener 被 openLive 无条件覆写——双订阅改道（A 的帧投 B）/订阅失败
   * 死柄残占（reject 前槽已被覆写）/close 连坐（清柄波及他会话）三形；升
   * Map 按 sessionId 路由，对齐 HTTP 形每 SSE 流独立帧循环的能力面。
   */
  const liveListeners = new Map<string, SdkFrameListener>();
  /** 在队事务（串行链保证至多一笔）——expect 帧族命中即 resolve；终局兜底走 reject（fail-loud） */
  let inflight:
    | {
        expect: ReadonlySet<string>;
        /** 事务请求的会话锚（会话域动词在场——无主 error 帧归属判据用） */
        anchor: string | undefined;
        resolve: (frame: SdkWireFrame) => void;
        reject: (err: SdkError) => void;
      }
    | undefined;

  /**
   * 无主 error 帧吸收位（send 无应答档专用窗）：interrupt 失败形（missing 会话）
   * 的 error 帧无事务可归——串行链微任务时序下紧随事务先开动（期望集恒含
   * 'error'），无主帧在飞到达即被 resolve 给正当事务（串味——正当事务吃到
   * 别人的错误码、真应答帧静默丢）。「send 后至下一事务开动前」的裸窗在串行
   * 链上恒空窗（下一事务微任务内即开动、无主帧要一个进程往返才到线），故窗
   * 形采「send 武装—吸收一枚即解除」：armed 期间 deliver 对 error 帧做归属
   * 判定——无在队事务、或帧携 sessionId 且异于在队事务请求会话锚（服务端
   * wire-core emitError 纪律：会话域错误帧恒回携请求 sessionId、连接级错误帧
   * 恒缺席）即无主，路由诊断 warn + 订阅面不入事务。
   */
  let orphanAbsorb = false;

  /** error 帧是否属在队事务：帧无会话锚（连接级错）恒属之；携锚须与事务请求会话一致 */
  const errorBelongsToInflight = (
    frame: SdkWireFrame & { kind: 'error' },
    txn: NonNullable<typeof inflight>,
  ): boolean => frame.sessionId === undefined || frame.sessionId === txn.anchor;

  /** 请求的会话锚（会话域动词在场——hello/prompt/interrupt/getEntries） */
  const sessionAnchorOf = (req: SdkRequest): string | undefined =>
    'sessionId' in req && typeof req.sessionId === 'string' ? req.sessionId : undefined;

  /**
   * 订阅面帧路由（多订阅正形）：按帧会话锚投递。直播/重放/心跳/ask 帧族恒携
   * sessionId（channels 协议件定形——event/entries/replay-end/heartbeat/ask
   * 五帧族必携位、ack/hello 同携），携锚帧只投该会话订阅者（修前单槽三形所
   * 修位）；无锚帧广播全部订阅者——现实形即连接级 error 帧（wire-core
   * emitError 连接级缺席纪律：连接级错误波及全部在订会话，广播即语义正形；
   * 防御位残余的 sessions/decide-result 应答帧同族——无会话归属可依，广播
   * 优于静默丢）。
   */
  const dispatch = (frame: SdkWireFrame): void => {
    const anchor = 'sessionId' in frame ? frame.sessionId : undefined;
    if (typeof anchor === 'string') {
      liveListeners.get(anchor)?.(frame);
      return;
    }
    for (const listener of liveListeners.values()) listener(frame);
  };

  const deliver = (frame: SdkWireFrame): void => {
    // 无主 error 帧吸收（B1）：吸收位 armed 且帧不属在队事务（无事务/携异会话
    // 锚）——warn + 订阅面路由，不入事务；一枚即解除（send 再调再武装）
    if (
      frame.kind === 'error' &&
      orphanAbsorb &&
      (inflight === undefined || !errorBelongsToInflight(frame, inflight))
    ) {
      orphanAbsorb = false;
      // 此处 frame 已窄化为 error 帧（kind 判别）——code/sessionId 直取
      warn(
        `无主 error 帧吸收（不入事务）：code=${frame.code}` +
          (frame.sessionId !== undefined ? ` sessionId=${frame.sessionId}` : ''),
      );
      dispatch(frame); // 订阅在场面：interrupt 错误经事件流可观察（types.ts send 契约——按帧会话锚路由，该会话在订才可观察）
      return;
    }
    if (inflight !== undefined && inflight.expect.has(frame.kind)) {
      const done = inflight;
      inflight = undefined;
      done.resolve(frame);
      return;
    }
    dispatch(frame); // 直播/重放/心跳帧——订阅面（按帧会话锚路由）
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
          inflight = { expect: new Set(expect), anchor: sessionAnchorOf(req), resolve, reject };
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
      pending?.reject(new SdkError('SDK_TRANSPORT', `子进程已退出（code=${code}）——未完成的请求无法落定`));
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
          anchor: undefined, // 连接级握手（无会话域——无主帧判据恒不吸收连接级错）
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

  /**
   * 订阅收口工厂（stdio 形：线无退订动词——记客户端口径，只摘本订阅条目）。
   * 携双锚（会话 id + 本订阅监听面引用）：同会话重订阅覆写后，旧柄 close 只在
   * 槽位仍是自己的监听面时摘账（身份比对——不误删覆写后的新订阅条目，语义位
   * 对齐 http.ts liveClose 以流对象身份锚定摘账）；他会话条目零牵连（修前
   * 单槽连坐形：close B 清空 A 的帧路）。
   */
  const liveCloseOf = (sessionId: string, onFrame: SdkFrameListener): (() => Promise<void>) => {
    return async (): Promise<void> => {
      if (liveListeners.get(sessionId) === onFrame) liveListeners.delete(sessionId);
    };
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
        // 无主帧吸收位武装（deliver 吸收位注）：interrupt 失败形的 error 帧无
        // 事务可归——armed 使其路由诊断/订阅面而非串味下一事务
        orphanAbsorb = true;
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
            // 多订阅路由账入账（同会话重订阅 = 覆写最新——与 HTTP 形每流独立并存同义）
            liveListeners.set(params.sessionId, onFrame);
            /** 失败回滚：仅当槽位仍是自己的监听面（覆写形不误删后来者的条目——修前死柄残占） */
            const rollback = (): void => {
              if (liveListeners.get(params.sessionId) === onFrame) liveListeners.delete(params.sessionId);
            };
            let highWaterSeq = -1;
            // 订阅两段同事务：hello（快照高水位）→ replay-end（衔接界标即建立点）
            // 两段同携会话锚（同事务同锚——无主帧判据跨段一致）
            inflight = {
              expect: new Set(['hello', 'error']),
              anchor: params.sessionId,
              resolve: (frame) => {
                if (frame.kind === 'error') {
                  // 订阅失败即回滚自己条目（修前：reject 后槽位仍指本订阅监听面——
                  // 先行订阅者的帧路被无主死柄占用）。sessionId 第三参透传（wire-core
                  // emitError 纪律：会话域错误帧恒携请求 sessionId——修前缺席）
                  rollback();
                  reject(new SdkError(frame.code, frame.message, frame.sessionId));
                  return;
                }
                highWaterSeq = (frame as { highWaterSeq: number }).highWaterSeq;
                inflight = {
                  expect: new Set(['replay-end']),
                  anchor: params.sessionId,
                  resolve: (marker) => {
                    onFrame(marker); // 界标帧入监听面（重放段全量承诺）后再立柄
                    resolve({
                      sessionId: params.sessionId,
                      highWaterSeq,
                      close: liveCloseOf(params.sessionId, onFrame),
                    });
                  },
                  reject: (err) => {
                    // 建立期终局兜底（replay-end 前）——订阅建立 Promise 不得悬挂，
                    // 入账同步回滚
                    rollback();
                    reject(err);
                  },
                };
              },
              reject: (err) => {
                // 建立期终局兜底（hello 段）——同律回滚入账
                rollback();
                reject(err);
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
      liveListeners.clear(); // 整连接收口——全部订阅条目一并清（单订阅条目归 liveCloseOf）
      child.stdin!.end(); // 收线（EOF——serve 优雅退出序）
      await exitedPromise;
    },
  };
  return transport;
}
