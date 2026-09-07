/**
 * sdk/http — SDK HTTP+SSE 传输面（批 13e-2；03 §10.6 HTTP+SSE 件承载条 +
 * 批 13e 落码定形注①②⑤；批 18a-1' 路由扩展位 + 多监听扩形——2026-09-07
 * webui 插件化批）。
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
 * **路由扩展位（18a-1'——03 §10.6 路由扩展位段）**：sdk HTTP 面开注册器
 * SdkRouteRegistrar——webui SPA 面 / issue webhook 挂点等 core: 件路由注册于
 * 此（件零自持 node:http 监听；过渡期〔批 12f core: 注册表前〕host 装配序直
 * 调 options.routes / handle.register——「禁用 = 装配不接线」诚实注记，不虚
 * 称可禁用）。路由匹配序 = `/v1/*` 保留字（前缀圈占——未中六端点即 404 不
 * fallthrough）→ 具名扩展路由 → catch-all → 404。gate 执法序倒转：**路由匹配
 * 先行 → per-route auth 档**——未匹配路径一律 404 不要求凭证（安全面行为变化，
 * routes.test.ts 显式回归锁留痕）。
 *
 * 三防线挂点（10.4 同律 + 差异面④⑤）：鉴权恒在场（token 预置或进程内生成，
 * Bearer 判走 verifyTokenConstantTime 常时比对——18a-1' 自字符串直比升常时，
 * 有意行为增强注记）；Host 白名单 + Origin 硬防线面级先行适用于一切路由（含
 * 扩展位路由），仅 TCP 监听（sock = 本地文件权限信任边界——无 DNS 无浏览器，
 * 防线不适用）；启动断言 judgeListenConfig 复核（非回环 TCP 无预置凭证
 * fail-closed——TCP×N 一票非回环无凭证即整面拒启）。
 *
 * **loopbackOnly 挂载规则**（真源 03 §10.6）：loopbackOnly 路由在非回环 TCP
 * 监听器不挂载（404 同未注册 + start 时 warn 一行）；回环 TCP 与 sock 监听器
 * 挂全路由。
 *
 * SSE 纪律（定形注⑤）：帧形 `data: <单行 JSON>\n\n` + 30s 注释行 ping；写侧
 * 看门狗 90s 判死 reap（读侧判死不可实施）；背压期可丢载荷 per-stream
 * shedding（droppable 谓词注入——/v1/events 用 isDroppableFrame 线协议判据、
 * openSse 消费面自定；线控帧缓冲不弃）。面级流账（openStreams）统一收口：
 * stop() 全流 close 含扩展路由 SSE 流。
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
import {
  generateToken,
  isLoopbackHost,
  judgeHostHeader,
  judgeListenConfig,
  originAllowed,
  verifyTokenConstantTime,
} from './security.js';
import {
  SDK_AUTH_HEADER,
  SDK_HTTP_ENDPOINTS,
  SDK_PROTOCOL_HEADER,
  SDK_ROUTE_OPEN_PURPOSES,
  SDK_SSE_PING_INTERVAL_MS,
  SDK_SSE_WRITE_TIMEOUT_MS,
  type SdkHttpBridge,
  type SdkHttpListenConfig,
  type SdkRouteBodyResult,
  type SdkRouteContext,
  type SdkRouteDescriptor,
  type SdkRouteRegistrar,
  type SdkRouteSseOptions,
  type SdkRouteSseStream,
} from './types.js';

/** 请求体上限缺省（10 MiB——/v1/* prompt 内容护栏；扩展路由 per-route bodyLimitBytes 覆盖） */
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/** Bearer 前缀（鉴权头形——Bearer ∪ cookie 双通道的 Bearer 腿） */
const BEARER_PREFIX = 'Bearer ';

/** 路由通配段字面（catch-all 尾——SPA fallback 承载位） */
const WILDCARD_SEGMENT = '*';

/** `/v1` 保留字前缀（SDK 六动词圈占——扩展路由注册即拒 + 匹配侧不 fallthrough） */
const V1_RESERVED = '/v1';

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

/** face 选项（13e-3 daemon/前台 HTTP 装配位与测试注入面；18a-1' 增 routes 构造期注册位） */
export interface SdkHttpFaceOptions {
  /** 开面配置（sock 可选 + TCP 单形/数组 + 预置 token 可选——03 §10.6 多监听形） */
  readonly config: SdkHttpListenConfig;
  /** 装配桥注入面（与 stdio serve 同形——createServeBridge 产物） */
  readonly bridge: SdkHttpBridge;
  /** 构造期路由注册位（两注册入口之一——host 装配序直调，过渡期条款） */
  readonly routes?: readonly SdkRouteDescriptor[];
  /** 线核构造选项（心跳节拍 / --no-delta 宿主立场缺省——透传） */
  readonly coreOptions?: SdkWireOptions;
  /** 请求体上限字节（缺省 10 MiB——扩展路由 descriptor.bodyLimitBytes per-route 覆盖此缺省） */
  readonly bodyLimitBytes?: number;
  /** 传输级诊断 warn 面（缺省静默——挂载规则 warn 行消费位） */
  readonly warn?: (message: string) => void;
}

/** 监听就绪信息（start() 产物——TCP 侧数组形回实配端口〔port 0 内核指派〕；sock 可缺席） */
export interface SdkListenInfo {
  /** Unix-domain sock 监听位（socketPath 缺席 = 未开 sock） */
  readonly socketPath?: string;
  /** TCP 监听位（多监听并存——至少一项当 config.tcp 在场） */
  readonly tcp: readonly { readonly host: string; readonly port: number }[];
}

/** face 产物（宿主装配位消费：backend 入通道核 / token 入披露面 / register 晚注册 / start-stop 生命周期） */
export interface SdkHttpFaceHandle {
  /** 通道核注册面（UiBackend 契约件——addBackend 消费） */
  readonly backend: UiBackend<never>;
  /** 协议核观测面（dropped 计数等——宿主日志/指标） */
  readonly core: SdkWireCore;
  /** 实效 token（预置或进程内生成——「监听 ⇒ 鉴权」恒在场；披露面宿主消费） */
  readonly token: string;
  /** 晚注册位（两注册入口之二——claim 桥同款晚绑；返摘除 fn） */
  register: SdkRouteRegistrar;
  /** 监听就绪（sock 可选 + TCP 单/多；陈旧 sock 死迹自动清） */
  start(): Promise<SdkListenInfo>;
  /** 收场序：停心跳 → 全流收口（含扩展路由 SSE 流）→ dispose（在飞 ask cancel + core.close）→ 关监听 → 清 sock 足迹 */
  stop(): Promise<void>;
}

/* ---------------- 路由编译与匹配（03 §10.6 路由扩展位——匹配器单源） ---------------- */

/** 编译后路由（segments 段式拆解——`:name` 参数段 / `*` 通配尾原样保留） */
interface CompiledRoute {
  readonly descriptor: SdkRouteDescriptor;
  readonly segments: readonly string[];
  /** 注册查重键（`${method} ${path}` 双键唯一） */
  readonly key: string;
}

/** 路由匹配产物（params 提取 + catch-all wildcard 尾） */
interface RouteMatch {
  readonly route: CompiledRoute;
  readonly params: Record<string, string>;
  readonly wildcard: string | undefined;
}

/**
 * 注册期校验 + 编译（fail-loud——一切非法形构造/注册即抛，不留到请求期）：
 * path 段式（`:name` 参数段 + 至多一枚 `*` 通配尾）；`/v1` 前缀保留字；
 * open 档 purpose 射界闭集（探活/鉴权换证/静态壳三类语义位——代码可执法）。
 */
function compileRoute(descriptor: SdkRouteDescriptor): CompiledRoute {
  const { method, path } = descriptor;
  // 单 `*` = 吞一切（SPA fallback 承载位）；其余必须 `/` 开头
  if (path !== WILDCARD_SEGMENT && !path.startsWith('/')) {
    throw new Error(`路由 path 须以 / 开头（或单独 * 吞一切）：${method} ${path}`);
  }
  // /v1 前缀保留字——SDK 六动词圈占，注册即拒（03 §10.6「/v1/ 前缀系保留字 fail-loud」）
  if (path === V1_RESERVED || path.startsWith(`${V1_RESERVED}/`)) {
    throw new Error(`路由 path /v1 前缀系 SDK 六动词保留字——注册即拒（03 §10.6）：${method} ${path}`);
  }
  const segments = path === WILDCARD_SEGMENT ? [WILDCARD_SEGMENT] : path.slice(1).split('/');
  if (segments.some((seg) => seg === '')) {
    throw new Error(`路由 path 空段非法：${method} ${path}`);
  }
  // 通配 `*`：至多一枚且须尾段（中段通配歧义形拒）
  const starIndex = segments.indexOf(WILDCARD_SEGMENT);
  if (
    starIndex !== -1 &&
    (starIndex !== segments.length - 1 || segments.indexOf(WILDCARD_SEGMENT, starIndex + 1) !== -1)
  ) {
    throw new Error(`路由 path 通配 * 至多一枚且须尾段：${method} ${path}`);
  }
  for (const seg of segments) {
    if (seg.startsWith(':')) {
      if (!/^[A-Za-z0-9_]+$/.test(seg.slice(1))) {
        throw new Error(`路由参数名非法（字母数字下划线）：${method} ${path}`);
      }
    } else if (seg !== WILDCARD_SEGMENT && /[:*]/.test(seg)) {
      throw new Error(`路由段含保留字符（: / *）：${method} ${path}`);
    }
  }
  // open 档射界枚举钉死：purpose 闭集越界即拒（注册期白名单校验——非仅冷读审读）
  if (
    typeof descriptor.auth === 'object' &&
    descriptor.auth !== null &&
    descriptor.auth.mode === 'open' &&
    !(SDK_ROUTE_OPEN_PURPOSES as readonly string[]).includes(descriptor.auth.purpose)
  ) {
    throw new Error(
      `open 档 purpose 越界（${String(descriptor.auth.purpose)}）——合法语义位闭集：${SDK_ROUTE_OPEN_PURPOSES.join(' / ')}（探活/鉴权换证/静态壳）`,
    );
  }
  return { descriptor, segments, key: `${method} ${path}` };
}

/** 单路由匹配（method 先判 + 段式比对；catch-all 尾吞余段原样进 wildcard） */
function matchRoute(route: CompiledRoute, method: string, pathSegments: readonly string[]): RouteMatch | undefined {
  if (route.descriptor.method !== method) return undefined;
  const segs = route.segments;
  const starIndex = segs.indexOf(WILDCARD_SEGMENT);
  if (starIndex === -1) {
    // 具名路由：段数全等 + 逐段比对（`:name` 段提取参数）
    if (segs.length !== pathSegments.length) return undefined;
    const params: Record<string, string> = {};
    for (let i = 0; i < segs.length; i++) {
      const pattern = segs[i]!;
      const value = pathSegments[i]!;
      if (pattern.startsWith(':')) params[pattern.slice(1)] = value;
      else if (pattern !== value) return undefined;
    }
    return { route, params, wildcard: undefined };
  }
  // catch-all：star 前缀段全等 + 余段 ≥ 0（余段原样 join 进 wildcard——SPA fallback 承载位）
  if (pathSegments.length < starIndex) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < starIndex; i++) {
    const pattern = segs[i]!;
    const value = pathSegments[i]!;
    if (pattern.startsWith(':')) params[pattern.slice(1)] = value;
    else if (pattern !== value) return undefined;
  }
  return { route, params, wildcard: pathSegments.slice(starIndex).join('/') };
}

/**
 * 单 SSE 流（面级 SSE 基建单源——/v1/events 与 openSse helper 共用一形）。
 * 写侧自治：背压期 shedding 可丢载荷（droppable 谓词注入——/v1/events 用线协议
 * 判据、扩展面自定）+ 看门狗 90s 判死 reap；ping 注释行保活。close 幂等
 * （连接 close / 看门狗 / 宿主 stop 三路共用）。
 */
class SseStream implements SdkRouteSseStream {
  private backedUp = false;
  private backedUpSince: number | undefined;
  private ended = false;
  private readonly pingTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly res: ServerResponse,
    /** 流终结一次性回调（面级流账自摘 + /v1/events 另挂 deregister——face 注入） */
    private readonly onEnd: () => void,
    private readonly now: () => number,
    /** 背压可丢判据（缺席 = 不 shedding——关键帧永不丢档） */
    private readonly droppable?: (data: unknown) => boolean,
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

  /** 帧写入（载荷整体单次 JSON.stringify 单行——帧合成钉死，禁手工拼帧） */
  write(data: unknown): void {
    if (this.ended) return;
    if (this.backedUp && this.droppable?.(data) === true) return;
    this.send(`data: ${JSON.stringify(data)}\n\n`);
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

  /** 终结（幂等）：停 ping → onEnd 一次性（连接 close / 看门狗 / 宿主 stop 三路共用）→ res 收线（服务端主动 EOF——stop 收口位 server.close() 不挂死） */
  private end(): void {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.pingTimer);
    this.onEnd();
    if (!this.res.writableEnded) this.res.end();
  }
}

/** 请求体超限标记（readBody 返回位——413 语义由调用方应答） */
class BodyTooLarge extends Error {}

/**
 * 读请求体（限幅护栏 + **排空纪律**——03 §10.6 helper `readBody` 条款：超帽
 * 应答永不早于请求体收完，防连接池 RST 连坐——超限后继续消费流至尽才报）。
 */
async function readBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of req) {
    if (exceeded) continue; // 已超帽：继续排空不记账（应答等体收完）
    size += chunk.length;
    if (size > limitBytes) {
      exceeded = true;
      continue;
    }
    chunks.push(chunk as Buffer);
  }
  if (exceeded) throw new BodyTooLarge(`请求体超限（> ${limitBytes} 字节）`);
  return Buffer.concat(chunks).toString('utf8');
}

/** 错误帧应答（码→状态映射；帧形与线协议错误帧同构——词汇零第二套） */
function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ kind: 'error', code, message }));
}

/** 监听器安全档（sock = 本地信任边界免防线 / tcp = Host/Origin 防线 + 挂载规则分账） */
interface ListenerSecurity {
  readonly label: 'sock' | 'tcp';
  /** 该监听器是否挂全路由（sock/回环 TCP = true；非回环 TCP 对 loopbackOnly 路由不挂载） */
  readonly loopback: boolean;
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

/** Bearer 剥取（authorization 头 → token 值；非 Bearer 形 = undefined） */
function bearerTokenOf(req: IncomingMessage): string | undefined {
  const raw = req.headers[SDK_AUTH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.startsWith(BEARER_PREFIX)) return undefined;
  return value.slice(BEARER_PREFIX.length);
}

/** cookie 值剥取（`name=value; other=x` 分号分段——EventSource 结构性无 Authorization 位的浏览器腿） */
function cookieValueOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string' || raw === '') return undefined;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

/**
 * 造 SDK HTTP 面（一核多流 + 路由扩展位）。监听器族多监听并存：sock 可选 +
 * TCP 单形/数组（daemon/前台装配位 13e-3 与本件测试消费）；扩展路由两注册
 * 入口——options.routes（构造期）与 handle.register（晚注册，返摘除 fn）。
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
  /** 面级流账（一切 SSE 流含扩展路由 openSse 流——stop() 统一收口） */
  const openStreams = new Set<SseStream>();
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
    // 版本已在 gate 层验过——hello 协议核内校验恒过。背压 shedding 走线协议
    // 判据（isDroppableFrame——纯活体帧可丢、线控帧缓冲不弃；unknown 域收敛
    // 转型 = /v1/events 流载荷恒 SdkWireFrame 的件内不变式）
    const stream = new SseStream(
      res,
      () => {
        openStreams.delete(stream);
        deregister(sessionId, stream);
      },
      now,
      (data): boolean => isDroppableFrame(data as SdkWireFrame),
    );
    openStreams.add(stream);
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

  /* ---------------- 路由扩展位实装（03 §10.6 路由扩展位段） ---------------- */

  /** 具名扩展路由（无通配尾——匹配序第二档） */
  const namedRoutes: CompiledRoute[] = [];
  /** catch-all 扩展路由（通配尾——匹配序第三档，具名全 miss 后才轮到） */
  const catchAllRoutes: CompiledRoute[] = [];
  /** 注册键账（`${method} ${path}` 双键唯一——重复注册 fail-loud） */
  const routeKeys = new Set<string>();

  /** 注册（两入口共享实现）：校验编译 → 入表；返摘除 fn（摘后 404 同未注册、键释放可重注册） */
  const register: SdkRouteRegistrar = (descriptor) => {
    const compiled = compileRoute(descriptor);
    if (routeKeys.has(compiled.key)) {
      throw new Error(`路由重复注册（method+path 双键唯一）：${compiled.key}——注册期 fail-loud`);
    }
    routeKeys.add(compiled.key);
    const table = compiled.segments.includes(WILDCARD_SEGMENT) ? catchAllRoutes : namedRoutes;
    table.push(compiled);
    return () => {
      routeKeys.delete(compiled.key);
      const at = table.indexOf(compiled);
      if (at !== -1) table.splice(at, 1);
    };
  };
  for (const descriptor of options.routes ?? []) register(descriptor);

  /** 扩展路由匹配（挂载规则内含：非回环监听器对 loopbackOnly 路由不挂载——404 同未注册） */
  const matchExtension = (
    method: string,
    pathSegments: readonly string[],
    loopback: boolean,
  ): RouteMatch | undefined => {
    // 两遍序：具名先行 → catch-all（匹配序条款「具名扩展路由 → catch-all」）
    for (const route of namedRoutes) {
      if (route.descriptor.loopbackOnly === true && !loopback) continue; // 挂载规则
      const match = matchRoute(route, method, pathSegments);
      if (match !== undefined) return match;
    }
    for (const route of catchAllRoutes) {
      if (route.descriptor.loopbackOnly === true && !loopback) continue;
      const match = matchRoute(route, method, pathSegments);
      if (match !== undefined) return match;
    }
    return undefined;
  };

  /** per-route 鉴权档执法（四值——token 闸位；Host/Origin 已面级先行） */
  const routeAuthOk = (req: IncomingMessage, auth: SdkRouteDescriptor['auth']): boolean => {
    // open / self 档跳面 token 闸（open = 射界已注册期钉死；self = 件侧自验——issue webhook HMAC 位）
    if (auth === 'self') return true;
    if (typeof auth === 'object' && auth !== null) {
      if (auth.mode === 'open') return true;
      if (auth.mode === 'token-or-cookie') {
        // Bearer ∪ cookie 双通道（恒时比对——sha256 摘要恒长 + timingSafeEqual）
        const bearer = bearerTokenOf(req);
        if (bearer !== undefined && verifyTokenConstantTime(bearer, token)) return true;
        const cookie = cookieValueOf(req, auth.cookie);
        return cookie !== undefined && verifyTokenConstantTime(cookie, token);
      }
    }
    // 'token' 档（Bearer 单通道）
    const bearer = bearerTokenOf(req);
    return bearer !== undefined && verifyTokenConstantTime(bearer, token);
  };

  /** 扩展路由 ctx 构造（面级 helper 单源——params/wildcard 匹配期绑定） */
  const makeRouteCtx = (match: RouteMatch): SdkRouteContext => ({
    params: match.params,
    wildcard: match.wildcard,
    openSse: (res: ServerResponse, opts?: SdkRouteSseOptions): SdkRouteSseStream => {
      const stream: SseStream = new SseStream(
        res,
        () => {
          openStreams.delete(stream);
        },
        now,
        opts?.droppable,
      );
      openStreams.add(stream);
      return stream;
    },
    readBody: async (req: IncomingMessage): Promise<SdkRouteBodyResult> => {
      try {
        const body = await readBody(req, match.route.descriptor.bodyLimitBytes ?? bodyLimit);
        return { ok: true, body };
      } catch (err) {
        if (err instanceof BodyTooLarge) return { ok: false, status: 413, message: err.message };
        throw err;
      }
    },
    verifyToken: (value: string): boolean => verifyTokenConstantTime(value, token),
  });

  /* ---------------- 三防线闸门 + 版本闸（/v1/* 族——13e 定形序维持） ---------------- */

  /** /v1/* 闸门（13e-2 定形序：token → Host/Origin——18a-1' 仅 token 判升常时比对） */
  const gate = (
    req: IncomingMessage,
    sec: ListenerSecurity,
  ): { ok: true } | { ok: false; status: number; code: string; message: string } => {
    const bearer = bearerTokenOf(req);
    if (bearer === undefined || !verifyTokenConstantTime(bearer, token)) {
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

  /** 版本闸门（定形注①——每请求 X-SDK-Protocol：缺席/不符同拒；扩展路由免——浏览器无连接级握手位） */
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

  /** Host/Origin 面级防线（扩展路由族先行位——适用于一切路由，仅 TCP 监听执法） */
  const extensionLineDefense = (
    req: IncomingMessage,
    sec: ListenerSecurity,
  ): { ok: true } | { ok: false; reason: string } => {
    if (sec.label !== 'tcp') return { ok: true };
    const host = judgeHostHeader(req.headers.host, sec.bindHost!);
    if (!host.ok) return { ok: false, reason: `Host 防线拒：${host.reason}` };
    if (!originAllowed(req.headers.origin, sec.bindHost!, sec.listenPort!)) {
      return { ok: false, reason: 'Origin 防线拒：非同源请求（10.4③）' };
    }
    return { ok: true };
  };

  /**
   * 路由分发（匹配序 + gate 序倒转——03 §10.6 路由扩展位段）：
   * 1. `/v1/*` 保留字圈占（六端点命中走 13e 定形序 gate → versionGate →
   *    isClosed → verb；未中即 404 **不 fallthrough**——保留字系面级圈占，
   *    防 SPA catch-all 吞掉程序面打错路径）；
   * 2. 扩展路由匹配（具名 → catch-all；挂载规则内含）；
   * 3. 未匹配一律 404 **不要求凭证**（gate 序倒转——安全面行为变化，回归锁
   *    routes.test.ts「未匹配 404 免凭证」例留痕）；
   * 4. 扩展命中：Host/Origin 面级先行（TCP 监听）→ per-route auth 档 →
   *    isClosed 503 同律 → handler（异常面上抛监听器 catch → 500）。
   */
  const dispatch = async (req: IncomingMessage, res: ServerResponse, sec: ListenerSecurity): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost.local'); // 基座仅为相对形合法——只取 pathname/query
    const pathname = url.pathname;
    const method = req.method ?? 'GET';
    const routeKey = `${method} ${pathname}`;
    const isV1 = pathname === V1_RESERVED || pathname.startsWith(`${V1_RESERVED}/`);

    // —— 第一档：/v1/* 保留字（圈占——未中六端点即 404，不 fallthrough 扩展路由）——
    const v1Matched =
      routeKey === `POST ${SDK_HTTP_ENDPOINTS.prompt}` ||
      routeKey === `POST ${SDK_HTTP_ENDPOINTS.interrupt}` ||
      routeKey === `POST ${SDK_HTTP_ENDPOINTS.decide}` ||
      routeKey === `POST ${SDK_HTTP_ENDPOINTS.entries}` ||
      routeKey === `GET ${SDK_HTTP_ENDPOINTS.sessions}` ||
      routeKey === `GET ${SDK_HTTP_ENDPOINTS.events}`;
    if (isV1) {
      if (!v1Matched) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      // 13e 定形序：gate（token 常时比对 + Host/Origin）→ versionGate → isClosed
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
      if (core.isClosed) {
        sendError(res, 503, 'SDK_OVERLOADED', '协议核已闭合——请求不受理（面将随宿主收场）');
        return;
      }
      switch (routeKey) {
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
      }
    }

    // —— 第二/三档：扩展路由（具名 → catch-all；挂载规则 = 非回环监听器不挂 loopbackOnly）——
    const pathSegments = pathname === '/' ? [] : pathname.slice(1).split('/');
    const match = matchExtension(method, pathSegments, sec.loopback);

    // —— 404 先行（gate 序倒转）：未匹配一律 404，不要求凭证、防线不执法于未注册路径 ——
    if (match === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    // 扩展命中：Host/Origin 面级先行（一切路由）→ per-route auth 档 → isClosed 503 同律
    const line = extensionLineDefense(req, sec);
    if (!line.ok) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(line.reason);
      return;
    }
    if (!routeAuthOk(req, match.route.descriptor.auth)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('unauthorized');
      return;
    }
    if (core.isClosed) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('service unavailable');
      return;
    }
    await match.route.descriptor.handler(req, res, makeRouteCtx(match));
  };

  // —— 监听器族（sock 可选 + TCP 单/多；安全档与挂载规则随监听器分账）——
  const servers: Array<{ server: Server; security: ListenerSecurity }> = [];
  let sockServer: Server | undefined;
  let sockOwned = false;
  if (options.config.socketPath !== undefined && options.config.socketPath !== '') {
    const sockSecurity: ListenerSecurity = { label: 'sock', loopback: true }; // sock = 本地文件权限信任边界，挂全路由
    sockServer = createServer((req, res) => {
      void dispatch(req, res, sockSecurity).catch((err: unknown) => {
        warn(`sock 面请求处理异常：${err instanceof Error ? err.message : String(err)}`);
        if (!res.writableEnded) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('internal error');
        }
      });
    });
    servers.push({ server: sockServer, security: sockSecurity });
  }
  const tcpSpecs =
    options.config.tcp === undefined
      ? []
      : Array.isArray(options.config.tcp)
        ? [...options.config.tcp]
        : [options.config.tcp];
  for (const spec of tcpSpecs) {
    const security: ListenerSecurity = {
      label: 'tcp',
      loopback: isLoopbackHost(spec.host), // 挂载规则：回环 TCP 挂全路由；非回环对 loopbackOnly 不挂载
      bindHost: spec.host,
      listenPort: spec.port,
    };
    const server = createServer((req, res) => {
      void dispatch(req, res, security).catch((err: unknown) => {
        warn(`tcp 面请求处理异常：${err instanceof Error ? err.message : String(err)}`);
        if (!res.writableEnded) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('internal error');
        }
      });
    });
    servers.push({ server, security });
  }

  /** 监听器对 createServer 面具（监听前占位——start 时真正 listen） */
  const tcpServers = servers.filter((entry) => entry.security.label === 'tcp');

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  return {
    backend: handle.backend,
    core,
    token,
    register,
    start: async (): Promise<SdkListenInfo> => {
      // —— 挂载规则 warn（start 时一行——非回环 TCP × loopbackOnly 路由在场）——
      const hasLoopbackOnly =
        namedRoutes.some((route) => route.descriptor.loopbackOnly === true) ||
        catchAllRoutes.some((route) => route.descriptor.loopbackOnly === true);
      for (const { security } of tcpServers) {
        if (hasLoopbackOnly && !security.loopback) {
          warn(
            `loopbackOnly 扩展路由在非回环 TCP 监听器（${security.bindHost}:${security.listenPort}）不挂载——404 同未注册（03 §10.6 挂载规则）`,
          );
        }
      }

      let socketPath: string | undefined;
      if (sockServer !== undefined && options.config.socketPath !== undefined) {
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
        socketPath = options.config.socketPath;
      }
      const tcpInfo: { host: string; port: number }[] = [];
      for (const { server, security } of tcpServers) {
        await listenOnTcp(server, security.bindHost!, security.listenPort!);
        const addr = server.address();
        tcpInfo.push(
          typeof addr === 'object' && addr !== null
            ? { host: security.bindHost!, port: addr.port }
            : { host: security.bindHost!, port: security.listenPort! },
        );
      }
      // 心跳装配驱动（线核零自驱时钟——13b 纪律；drain 无位：活体相位 sink 恒收）
      heartbeatTimer = setInterval(() => core.heartbeatTick(), heartbeatIntervalMs);
      return { ...(socketPath !== undefined ? { socketPath } : {}), tcp: tcpInfo };
    },
    stop: async (): Promise<void> => {
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      // 全流收口（客户端读至 EOF；面级流账统一 close 含扩展路由 openSse 流；
      // /v1/events 流的 deregister 经 onEnd 逐流走清账）
      for (const stream of openStreams) stream.close();
      openStreams.clear();
      streamsBySession.clear();
      handle.dispose(); // 在飞 ask 保守 cancel + core.close
      const closeServer = (server: Server): Promise<void> =>
        new Promise((resolve) => {
          server.close(() => resolve());
        });
      await Promise.all(servers.map((entry) => closeServer(entry.server)));
      // 自己的 sock 足迹随关清（不碰他面活迹）
      if (sockOwned && options.config.socketPath !== undefined) {
        await unlink(options.config.socketPath).catch((): void => {});
      }
    },
  };
}
