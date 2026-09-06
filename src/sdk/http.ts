/**
 * sdk/http — SDK HTTP+SSE 传输面（批 13e-2；03 §10.6 HTTP+SSE 件承载条 +
 * 批 13e 落码定形注①②⑤）。
 *
 * **一核多流**（定形注②）：daemon 全程单一协议核（createSdkBackend 自持
 * decideApproval/onSubscribed 两面），出站 sink 两相位——
 * - 请求作用域（栈顶收集器）：POST / SSE 建立期 handleRequest 同步执行，应答
 *   帧（ack/entries/sessions/decide-result/hello/replay-end/error）定向回触发
 *   请求；handleRequest 全同步 ⇒ 栈式作用域零交织（Node 单线程 + 同步受理）；
 * - 活体相位（栈空）：pushEvent/heartbeatTick 的帧按 sessionId 扇出至订阅
 *   SSE 流——**订阅生命周期与真观众同步**（定形注⑤）：流关闭即退订
 *   （core.unsubscribe），ask fail-closed 判据〔无订阅者即 cancel〕与传输面
 *   真观众恒一致；POST-only 调用方（prompt 后未开 SSE）的审批即时保守收场。
 *
 * 端点面（定形注①）：五 POST/GET + GET /v1/events（SSE = hello 的 HTTP 承载
 * 位——sessionId/after/noDelta 入查询参，重放→replay-end→直播与 stdio 同核
 * 同件）。POST 体 = 载荷去 verb 形（端点即动词——本层注入 verb 后经 channels
 * schema 单源深校验，零第二套载荷形）。
 *
 * 三防线挂点（10.4 同律 + 差异面④⑤）：鉴权恒在场（token 预置或进程内生成，
 * Bearer 形每请求验——「监听 ⇒ 鉴权」）；Host 白名单 + Origin 硬防线仅 TCP
 * 监听（sock = 本地文件权限信任边界——无 DNS 无浏览器，防线不适用）；启动
 * 断言 judgeListenConfig 复核（非回环 TCP 无预置凭证 fail-closed）。
 *
 * SSE 纪律（定形注⑤）：帧形 `data: <单行 JSON>\n\n` + 30s 注释行 ping；写侧
 * 看门狗 90s 判死 reap（读侧判死不可实施）；背压期纯活体帧 per-stream
 * shedding（isDroppableFrame 同源复用——线控帧缓冲不弃）。
 */
import { unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect } from 'node:net';

import { createSdkBackend, isDroppableFrame, SDK_PROTOCOL_VERSION, validateSdkRequest } from '../channels/index.js';
import type {
  SdkOutboundSink,
  SdkRequest,
  SdkWireCore,
  SdkWireFrame,
  SdkWireOptions,
  UiBackend,
} from '../channels/index.js';
import { generateToken, judgeHostHeader, judgeListenConfig, originAllowed } from './security.js';
import {
  SDK_AUTH_HEADER,
  SDK_HTTP_ENDPOINTS,
  SDK_PROTOCOL_HEADER,
  SDK_SSE_PING_INTERVAL_MS,
  SDK_SSE_WRITE_TIMEOUT_MS,
  type SdkHttpBridge,
  type SdkHttpListenConfig,
} from './types.js';

/** 请求体上限缺省（10 MiB——prompt 内容护栏；选项可注小值测试） */
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/** 错误帧 → HTTP 状态码映射（定形注⑤——错误帧原样作响应体，未列码缺省 400） */
const HTTP_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  SDK_PROTOCOL_MISMATCH: 400,
  SDK_DECODE: 400,
  SDK_CURSOR_INVALID: 400,
  SESSION_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  SDK_MESSAGE_CONFLICT: 409,
  SDK_OVERLOADED: 503,
};

/** face 选项（13e-3 daemon/前台 HTTP 装配位与测试注入面） */
export interface SdkHttpFaceOptions {
  /** 开面配置（sock 必开 + TCP 可选 + 预置 token 可选——07 §5 定名） */
  readonly config: SdkHttpListenConfig;
  /** 装配桥注入面（与 stdio serve 同形——createServeBridge 产物） */
  readonly bridge: SdkHttpBridge;
  /** 线核构造选项（心跳节拍 / --no-delta 宿主立场缺省——透传） */
  readonly coreOptions?: SdkWireOptions;
  /** 请求体上限字节（缺省 10 MiB——超限 413） */
  readonly bodyLimitBytes?: number;
  /** 传输级诊断 warn 面（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** 监听就绪信息（start() 产物——port 0 形回实配端口） */
export interface SdkListenInfo {
  readonly socketPath: string;
  readonly tcp?: { readonly host: string; readonly port: number };
}

/** face 产物（宿主装配位消费：backend 入通道核 / token 入披露面 / start-stop 生命周期） */
export interface SdkHttpFaceHandle {
  /** 通道核注册面（UiBackend 契约件——addBackend 消费） */
  readonly backend: UiBackend<never>;
  /** 协议核观测面（dropped 计数等——宿主日志/指标） */
  readonly core: SdkWireCore;
  /** 实效 token（预置或进程内生成——「监听 ⇒ 鉴权」恒在场；披露面宿主消费） */
  readonly token: string;
  /** 监听就绪（sock 必开 + TCP 可选；陈旧 sock 死迹自动清） */
  start(): Promise<SdkListenInfo>;
  /** 收场序：停心跳 → 全流收口 → dispose（在飞 ask cancel + core.close）→ 关监听 → 清 sock 足迹 */
  stop(): Promise<void>;
}

/**
 * 单 SSE 流（订阅会话的直播腿）。写侧自治：背压期 shedding 纯活体帧 + 看门狗
 * 90s 判死 reap；ping 注释行保活。close 幂等（连接 close 与宿主 stop 双路）。
 */
class SseStream {
  private backedUp = false;
  private backedUpSince: number | undefined;
  private ended = false;
  private readonly pingTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly res: ServerResponse,
    /** 流终结一次性回调（deregister + 末流退订——face 注入） */
    private readonly onEnd: () => void,
    private readonly now: () => number,
  ) {
    // SSE 开流即 200（此后错误只能走帧——SSE 状态码位已用尽，错误帧即词面）
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // 代理禁缓冲（SSE 语义钉死）
    });
    res.on('close', () => this.end());
    res.on('drain', () => {
      this.backedUp = false;
      this.backedUpSince = undefined;
    });
    this.pingTimer = setInterval(() => this.pingTick(), SDK_SSE_PING_INTERVAL_MS);
  }

  /** 帧写入（扇出腿消费）：背压 shedding 纯活体帧，线控帧缓冲不弃 */
  write(frame: SdkWireFrame): void {
    if (this.ended) return;
    if (this.backedUp && isDroppableFrame(frame)) return;
    this.send(`data: ${JSON.stringify(frame)}\n\n`);
  }

  /** 宿主收场腿（stop() 全流收口——幂等） */
  close(): void {
    this.end();
  }

  private pingTick(): void {
    if (this.ended) return;
    // 写侧看门狗：背压持续超窗即判死 reap（ping 写不动的流已不可救）
    if (
      this.backedUp &&
      this.backedUpSince !== undefined &&
      this.now() - this.backedUpSince > SDK_SSE_WRITE_TIMEOUT_MS
    ) {
      this.end();
      this.res.destroy();
      return;
    }
    if (!this.send(': ping\n\n')) this.markBackpressure();
  }

  /** 写一行块；写异常即 reap（同步写失败 = 流已坏死） */
  private send(chunk: string): boolean {
    if (this.ended) return false;
    try {
      const ok = this.res.write(chunk);
      if (!ok) this.markBackpressure();
      return ok;
    } catch {
      this.end();
      this.res.destroy();
      return false;
    }
  }

  private markBackpressure(): void {
    if (!this.backedUp) {
      this.backedUp = true;
      this.backedUpSince = this.now();
    }
  }

  /** 终结（幂等）：停 ping → onEnd 一次性（连接 close / 看门狗 / 宿主 stop 三路共用） */
  private end(): void {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.pingTimer);
    this.onEnd();
  }
}

/** 请求体超限标记（readBody 抛出位——413 映射用） */
class BodyTooLarge extends Error {}

/** 读请求体（限幅护栏——超限即抛 BodyTooLarge） */
async function readBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new BodyTooLarge(`请求体超限（> ${limitBytes} 字节）`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 错误帧应答（码→状态映射；帧形与线协议错误帧同构——词汇零第二套） */
function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ kind: 'error', code, message }));
}

/** 监听器安全档（sock = 本地信任边界免防线 / tcp = 三防线全执法） */
interface ListenerSecurity {
  readonly label: 'sock' | 'tcp';
  /** tcp：Host 白名单判据（绑定地址） */
  readonly bindHost?: string;
  /** tcp：Origin 同源判据（监听端口） */
  readonly listenPort?: number;
}

/** 单次 listen（sock 路径形）——error 上抛、listening 回调即就绪 */
function listenOnPath(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });
}

/** 单次 listen（TCP 形）——host/port 形参序与 node 语义一致 */
function listenOnTcp(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}

/** 探活 Unix sock：连得上 = 在场 daemon；连不上 = 死迹 */
function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
  });
}

/**
 * 造 SDK HTTP 面（一核多流）。监听 sock（必开——本地程序调用方缺省接入点）
 * + 可选 TCP（远程 CI 场景）；daemon/前台装配位（13e-3）与本件测试消费。
 */
export function createSdkHttpFace(options: SdkHttpFaceOptions): SdkHttpFaceHandle {
  // 启动断言复核（13e-3 宿主先拒——本面再核：直造面也不留非回环无凭证档）
  const judged = judgeListenConfig(options.config);
  if (!judged.ok) throw new Error(judged.reason);

  // 鉴权恒在场：预置 token 在场即用，缺席自足生成进程内一次性（披露面宿主出）
  const token =
    options.config.token === undefined || options.config.token === '' ? generateToken() : options.config.token;
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const warn = options.warn ?? ((): void => {});
  const heartbeatIntervalMs = options.coreOptions?.heartbeatIntervalMs ?? 5_000;
  const now = options.coreOptions?.now ?? Date.now;

  // —— 一核多流出站路由（定形注②）——
  /** 活体扇出账（sessionId → 订阅流集——订阅生命周期与真观众同步） */
  const streamsBySession = new Map<string, Set<SseStream>>();
  /** 请求作用域栈（handleRequest 同步期非空——应答帧定向回触发请求） */
  const scopeStack: Array<(frame: SdkWireFrame) => boolean> = [];

  const sink: SdkOutboundSink = {
    write: (frame: SdkWireFrame): boolean => {
      const scope = scopeStack[scopeStack.length - 1];
      if (scope !== undefined) return scope(frame); // 请求作用域：收集器恒可写（小量）
      // 活体相位：按 sessionId 扇出（无观众即弃——帧词汇里活体帧恒携会话）
      const sid = (frame as { sessionId?: string }).sessionId;
      if (typeof sid === 'string' && sid !== '') {
        for (const stream of streamsBySession.get(sid) ?? []) stream.write(frame);
      }
      return true; // 活体相位恒收（per-stream shedding 自治——核级队列不背压）
    },
  };

  const handle = createSdkBackend({ ...options.bridge, sink }, options.coreOptions);
  const core = handle.core;

  /** 末流退订（流撤即撤核内订阅——ask fail-closed 判据与真观众同步） */
  const deregister = (sessionId: string, stream: SseStream): void => {
    const set = streamsBySession.get(sessionId);
    if (set === undefined) return;
    set.delete(stream);
    if (set.size === 0) {
      streamsBySession.delete(sessionId);
      core.unsubscribe(sessionId);
    }
  };

  /** 请求作用域受理（收集器进栈 → 核受理 → 出栈——零交织窗口） */
  const handleScoped = (request: SdkRequest): SdkWireFrame[] => {
    const collected: SdkWireFrame[] = [];
    const collector = (frame: SdkWireFrame): boolean => {
      collected.push(frame);
      return true;
    };
    scopeStack.push(collector);
    try {
      core.handleRequest(request);
    } finally {
      scopeStack.pop();
    }
    return collected;
  };

  /** POST 应答映射（错误帧→状态码；interrupt 无应答档 = 204 空体——定形注①） */
  const respondCollected = (res: ServerResponse, collected: SdkWireFrame[], verb: string): void => {
    const first = collected[0];
    if (first === undefined) {
      if (verb === 'interrupt') {
        res.writeHead(204);
        res.end();
        return;
      }
      // 应答帧缺席 = 核闭合态静默档（宿主 close() 后无因残行）——不留半开档
      sendError(res, 503, 'SDK_OVERLOADED', '协议核已闭合——请求不受理（面将随宿主收场）');
      return;
    }
    if (first.kind === 'error') {
      sendError(res, HTTP_STATUS_BY_CODE[first.code] ?? 400, first.code, first.message);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(first));
  };

  /** POST 端点共腿：读体 → 注入 verb 深校验（schema 单源）→ 作用域受理 → 应答映射 */
  const postVerb = async (req: IncomingMessage, res: ServerResponse, verb: SdkRequest['verb']): Promise<void> => {
    let body: string;
    try {
      body = await readBody(req, bodyLimit);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        sendError(res, 413, 'SDK_DECODE', err.message);
        return;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendError(res, 400, 'SDK_DECODE', '请求体非合法 JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendError(res, 400, 'SDK_DECODE', '请求体须为 JSON 对象');
      return;
    }
    // 端点即动词：传输层注入 verb（体携带的 verb 被覆写——端点权威）后同源深校验
    const validated = validateSdkRequest({ ...(parsed as Record<string, unknown>), verb });
    if (!validated.ok) {
      sendError(res, 400, 'SDK_DECODE', validated.reason);
      return;
    }
    const collected = handleScoped(validated.value);
    // prompt 落定后观众同步：该会话零 SSE 流即撤核内自动订阅（POST-only 调用方
    // 无直播腿——保留空订阅只会让 ask 打入无人区挂死；撤后 fail-closed 即时
    // cancel。SSE 已开则保留——ack 帧携句柄定位会话）
    const first = collected[0];
    if (verb === 'prompt' && first?.kind === 'ack') {
      if ((streamsBySession.get(first.sessionId)?.size ?? 0) === 0) core.unsubscribe(first.sessionId);
    }
    respondCollected(res, collected, verb);
  };

  /** SSE 建立位（hello 的 HTTP 承载——定形注①）：查询参三值 → 流内三步衔接 */
  const getEvents = (_req: IncomingMessage, res: ServerResponse, url: URL): void => {
    const sessionId = url.searchParams.get('sessionId');
    if (sessionId === null || sessionId === '') {
      sendError(
        res,
        400,
        'SDK_DECODE',
        'sessionId 查询参必填（无会话订阅的 SSE 流恒空载——与 stdio 无会话 hello 档分立）',
      );
      return;
    }
    let after: number | undefined;
    const afterRaw = url.searchParams.get('after');
    if (afterRaw !== null) {
      after = Number(afterRaw);
      if (!Number.isInteger(after)) {
        sendError(res, 400, 'SDK_DECODE', `after 查询参非整数：${afterRaw}`);
        return;
      }
    }
    let noDelta: boolean | undefined;
    const noDeltaRaw = url.searchParams.get('noDelta');
    if (noDeltaRaw !== null) {
      if (noDeltaRaw !== 'true' && noDeltaRaw !== 'false') {
        sendError(res, 400, 'SDK_DECODE', `noDelta 查询参非布尔（true/false）：${noDeltaRaw}`);
        return;
      }
      noDelta = noDeltaRaw === 'true';
    }
    // 建立期作用域 = 流本体（hello/entries/replay-end/未决 ask 重推直入流）；
    // 版本已在 gate 层验过——hello 协议核内校验恒过
    const stream = new SseStream(res, () => deregister(sessionId, stream), now);
    const collector = (frame: SdkWireFrame): boolean => {
      stream.write(frame);
      return true;
    };
    scopeStack.push(collector);
    try {
      core.handleRequest({
        verb: 'hello',
        protocolVersion: SDK_PROTOCOL_VERSION,
        sessionId,
        ...(after !== undefined ? { after } : {}),
        ...(noDelta !== undefined ? { noDelta } : {}),
      });
    } finally {
      scopeStack.pop();
    }
    // 订阅落定才挂扇出；error 档（会话不存在/游标非法）帧已入流——收流即终结
    if (!core.isSubscribed(sessionId)) {
      stream.close();
      res.end();
      return;
    }
    let set = streamsBySession.get(sessionId);
    if (set === undefined) {
      set = new Set();
      streamsBySession.set(sessionId, set);
    }
    set.add(stream);
  };

  /** 三防线闸门（每请求先行）：鉴权恒验 + Host/Origin 仅 TCP 监听执法 */
  const gate = (
    req: IncomingMessage,
    sec: ListenerSecurity,
  ): { ok: true } | { ok: false; status: number; code: string; message: string } => {
    const auth = req.headers[SDK_AUTH_HEADER];
    if (auth !== `Bearer ${token}`) {
      return {
        ok: false,
        status: 401,
        code: 'SDK_UNAUTHORIZED',
        message: '鉴权失败：Authorization 头须为 Bearer 形携实效 token',
      };
    }
    if (sec.label === 'tcp') {
      const host = judgeHostHeader(req.headers.host, sec.bindHost!);
      if (!host.ok) return { ok: false, status: 403, code: 'SDK_FORBIDDEN', message: `Host 防线拒：${host.reason}` };
      if (!originAllowed(req.headers.origin, sec.bindHost!, sec.listenPort!)) {
        return { ok: false, status: 403, code: 'SDK_FORBIDDEN', message: 'Origin 防线拒：非同源请求（10.4③）' };
      }
    }
    return { ok: true };
  };

  /** 版本闸门（定形注①——每请求 X-SDK-Protocol：缺席/不符同拒） */
  const versionGate = (req: IncomingMessage): { ok: true } | { ok: false; reason: string } => {
    const raw = req.headers[SDK_PROTOCOL_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) return { ok: false, reason: `版本头 ${SDK_PROTOCOL_HEADER} 缺席（每请求必携）` };
    const version = Number(value);
    if (version !== SDK_PROTOCOL_VERSION) {
      return { ok: false, reason: `线协议版本不符：服务端 ${SDK_PROTOCOL_VERSION} / 调用方 ${value}` };
    }
    return { ok: true };
  };

  /** 路由分发（微路由——六端点闭合集） */
  const route = async (req: IncomingMessage, res: ServerResponse, sec: ListenerSecurity): Promise<void> => {
    const g = gate(req, sec);
    if (!g.ok) {
      sendError(res, g.status, g.code, g.message);
      return;
    }
    const v = versionGate(req);
    if (!v.ok) {
      sendError(res, 400, 'SDK_PROTOCOL_MISMATCH', v.reason);
      return;
    }
    // 核闭合（过载断连/宿主 close）后的新请求——不留半开档
    if (core.isClosed) {
      sendError(res, 503, 'SDK_OVERLOADED', '协议核已闭合——请求不受理（面将随宿主收场）');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost.local'); // 基座仅为相对形合法——只取 pathname/query
    const path = `${req.method} ${url.pathname}`;
    switch (path) {
      case `POST ${SDK_HTTP_ENDPOINTS.prompt}`:
        await postVerb(req, res, 'prompt');
        return;
      case `POST ${SDK_HTTP_ENDPOINTS.interrupt}`:
        await postVerb(req, res, 'interrupt');
        return;
      case `POST ${SDK_HTTP_ENDPOINTS.decide}`:
        await postVerb(req, res, 'decide');
        return;
      case `POST ${SDK_HTTP_ENDPOINTS.entries}`:
        await postVerb(req, res, 'getEntries');
        return;
      case `GET ${SDK_HTTP_ENDPOINTS.sessions}`: {
        // 零载荷动词：注入 verb 直受理（sessions 帧即应答）
        const collected = handleScoped({ verb: 'sessions' });
        respondCollected(res, collected, 'sessions');
        return;
      }
      case `GET ${SDK_HTTP_ENDPOINTS.events}`:
        getEvents(req, res, url);
        return;
      default:
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
    }
  };

  // —— 监听器对（sock + 可选 TCP 共享路由；安全档随监听器分账）——
  const sockSecurity: ListenerSecurity = { label: 'sock' };
  const sockServer = createServer((req, res) => {
    void route(req, res, sockSecurity).catch((err: unknown) => {
      warn(`sock 面请求处理异常：${err instanceof Error ? err.message : String(err)}`);
      if (!res.writableEnded) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('internal error');
      }
    });
  });
  let tcpServer: Server | undefined;
  let tcpSecurity: ListenerSecurity | undefined;
  if (options.config.tcp !== undefined) {
    const { host, port } = options.config.tcp;
    tcpSecurity = { label: 'tcp', bindHost: host, listenPort: port };
    tcpServer = createServer((req, res) => {
      void route(req, res, tcpSecurity!).catch((err: unknown) => {
        warn(`tcp 面请求处理异常：${err instanceof Error ? err.message : String(err)}`);
        if (!res.writableEnded) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('internal error');
        }
      });
    });
  }

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  /** sock 所有权（本面成功监听才置——stop 只清自己的足迹，不碰他面活迹） */
  let sockOwned = false;

  return {
    backend: handle.backend,
    core,
    token,
    start: async (): Promise<SdkListenInfo> => {
      // sock 监听（陈旧死迹清后重试；活迹 = 在场 daemon——真占用上抛宿主裁）
      try {
        await listenOnPath(sockServer, options.config.socketPath);
      } catch (err) {
        const errno = (err as NodeJS.ErrnoException).code;
        if (errno !== 'EADDRINUSE') throw err;
        if (await probeSocket(options.config.socketPath)) throw err; // 在场 daemon——宿主裁 HOST_DATA_DIR_BUSY
        await unlink(options.config.socketPath).catch((): void => {}); // 死迹清迹
        await listenOnPath(sockServer, options.config.socketPath);
      }
      sockOwned = true;
      let tcpInfo: { host: string; port: number } | undefined;
      if (tcpServer !== undefined && options.config.tcp !== undefined) {
        await listenOnTcp(tcpServer, options.config.tcp.host, options.config.tcp.port);
        const addr = tcpServer.address();
        tcpInfo =
          typeof addr === 'object' && addr !== null
            ? { host: options.config.tcp.host, port: addr.port }
            : { host: options.config.tcp.host, port: options.config.tcp.port };
      }
      // 心跳装配驱动（线核零自驱时钟——13b 纪律；drain 无位：活体相位 sink 恒收）
      heartbeatTimer = setInterval(() => core.heartbeatTick(), heartbeatIntervalMs);
      return { socketPath: options.config.socketPath, ...(tcpInfo !== undefined ? { tcp: tcpInfo } : {}) };
    },
    stop: async (): Promise<void> => {
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      // 全流收口（客户端读至 EOF；deregister 逐流走清账）
      for (const set of streamsBySession.values()) {
        for (const stream of set) stream.close();
      }
      streamsBySession.clear();
      handle.dispose(); // 在飞 ask 保守 cancel + core.close
      const closeServer = (server: Server): Promise<void> =>
        new Promise((resolve) => {
          server.close(() => resolve());
        });
      const closers = [closeServer(sockServer)];
      if (tcpServer !== undefined) closers.push(closeServer(tcpServer));
      await Promise.all(closers);
      if (sockOwned) await unlink(options.config.socketPath).catch((): void => {}); // 自己的 sock 足迹随关清
    },
  };
}
