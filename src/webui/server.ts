/**
 * webui/server — Web 通道服务端核心（03 §10.4；批 18a-1 传输实装）。
 *
 * 组装三位（createWebuiServer 产物——WebuiHandle）：
 * - **backend**：UiBackend 第四实装（claim 桥——通道核 addBackend 注册后
 *   与 TUI/SDK 同竞速）。能力面：notify/setStatus/approval 三位（信封三族
 *   对应）；confirm/select/input/setWidget 缺席（微路由 v1 无应答端点——
 *   降级判定归核）。审批腿**进程作用域语义**（与 SDK 腿「连接作用域无订阅
 *   即 cancel」分立——03 §10.4 批 18a 落码定形注④）：开面在场即持应答
 *   能力、不采无连接即时 cancel（否则 TUI 呈现中的审批被抢答 cancel 废掉）；
 *   败腿/撤销经 signal abort 清槽（abort 恒后于竞速落定——UiCore finish
 *   内序，不构成抢答）。
 * - **微路由五撮**：node:http 手写（零新增依赖条款）——探活鉴权/会话族/
 *   活体流/审批族/补全族；JSON 均 typebox 校验后消费。
 * - **SSE**：信封三族帧合成钉死（每帧 data: 载荷恒整体单次 JSON.stringify
 *   单行）；连接即当下（v1 无重放游标——正确性层 = 客户端 onopen 恒重拉
 *   投影）；30s 注释行 ping + 写侧 90s 看门狗（读侧判死不可实施）；全局
 *   连接帽 16 超帽 503；背压期纯活体帧 shedding（session/notify/status
 *   镜像帧不弃）。
 *
 * 三防线执法序（每请求先过再路由）：① Host 白名单 → ② Origin 硬防线 →
 * ③ 鉴权（Bearer / cookie 桥双形——除 health/auth/静态面三位开面）。
 * POST 族字节帽 256KiB 超帽 413 且**应答永不早于请求体收完**（防连接池
 * RST 连坐——排空后应答）。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

import type { ApprovalAskAnswer } from '../contracts/index.js';
import type { NotifyLevel, SessionEnvelope, UiBackend } from '../channels/index.js';
import {
  WEBUI_BODY_LIMIT_BYTES,
  WEBUI_COOKIE_NAME,
  WEBUI_DEFAULT_HOST,
  WEBUI_DEFAULT_PORT,
  WEBUI_MAX_CONNECTIONS,
  WEBUI_SSE_PING_INTERVAL_MS,
  WEBUI_SSE_WRITE_TIMEOUT_MS,
  type WebuiApprovalEntry,
  type WebuiDeps,
  type WebuiEnvelope,
  type WebuiHandle,
  type WebuiServerOptions,
} from './types.js';
import { generateToken, judgeHostHeader, judgeListenConfig, originAllowed } from './security.js';

/* ---------------- typebox 校验（03 §10.4「JSON 均 typebox 校验后消费」） ---------------- */

/** 公共字段词面：未知字段拒收（收窄律——请求面载荷即全集） */
const strict = { additionalProperties: false } as const;

/** auth 体（cookie 桥——token 必填） */
const AuthSchema = Type.Object({ token: Type.String() }, strict);

/** submit 体（text 必填；messageId 选填 = SPA 重试幂等位，缺席服务端生成） */
const SubmitSchema = Type.Object({ text: Type.String(), messageId: Type.Optional(Type.String()) }, strict);

/** decide 体（answer 四值闭集 = ApprovalAskAnswer；note 选填） */
const DecideSchema = Type.Object(
  {
    answer: Type.Union([
      Type.Literal('approve'),
      Type.Literal('reject'),
      Type.Literal('cancel'),
      Type.Literal('always'),
    ]),
    note: Type.Optional(Type.String()),
  },
  strict,
);

/** 深校验非抛型（fail-loud 可行动报因——首错定位） */
function validate<T>(
  schema: ReturnType<typeof Type.Object>,
  value: unknown,
  what: string,
): { ok: true; value: T } | { ok: false; reason: string } {
  if (!Value.Check(schema, value)) {
    const errors = [...Value.Errors(schema, value)];
    const first = errors[0];
    const at = first === undefined ? '' : `（${first.instancePath || '(root)'}：${first.message}）`;
    return { ok: false, reason: `${what} 不合 schema${at}` };
  }
  return { ok: true, value: value as T };
}

/* ---------------- 应答与请求体 ---------------- */

/** JSON 应答（content-type 单源） */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** 错误应答（machine word + 人读消息——SPA 面无错误码族，HTTP 状态即词面） */
function sendError(res: ServerResponse, status: number, error: string, message?: string): void {
  sendJson(res, status, { error, ...(message !== undefined ? { message } : {}) });
}

/** 请求体超限标记（readBody 抛出位——413 映射用） */
class BodyTooLarge extends Error {}

/**
 * 读请求体（限幅护栏——超帽 413 且**应答永不早于请求体收完**：超限后继续
 * 排空残余再抛，防连接池 RST 连坐——03 §10.4 POST 族字节帽条款）。
 */
async function readBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      over = true;
      continue; // 排空——不早断（413 应答等收完）
    }
    chunks.push(chunk as Buffer);
  }
  if (over) throw new BodyTooLarge(`请求体超限（> ${limitBytes} 字节）`);
  return Buffer.concat(chunks).toString('utf8');
}

/** 解析 JSON 体（坏形 → 可行动报因） */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, reason: '请求体非 JSON' };
  }
}

/** token 恒时比对（摘要恒长化——timingSafeEqual 前置条件） */
function tokenMatches(actual: string, presented: string): boolean {
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(presented).digest();
  return timingSafeEqual(a, b);
}

/* ---------------- SSE 单流（写侧自治：ping + 看门狗 + 背压 shedding） ---------------- */

/** 判信封是否纯活体可丢（背压 shedding 面——display 族的 update 两型；session
 *  镜像/notify/status 不弃） */
function isDroppableEnvelope(env: WebuiEnvelope): boolean {
  return (
    env.kind === 'display' && (env.payload.type === 'message_update' || env.payload.type === 'tool_execution_update')
  );
}

/**
 * 单 SSE 流（订阅一会话的直播腿 + 全局 notify 广播位）。写侧自治：背压期
 * shedding 纯活体信封，镜像帧不弃；ping 注释行保活，写失败/写超时 90s 即
 * reap（读侧判死不可实施——EventSource GET 后永不上行）。close 幂等（连接
 * close 与宿主 stop 双路）。
 */
class SseStream {
  private backedUp = false;
  private backedUpSince: number | undefined;
  private ended = false;
  /** 写侧看门狗判死窗（构造注入——测试确定性） */
  private readonly writeTimeout: number;
  private readonly pingTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly res: ServerResponse,
    /** 本流订阅的会话（按会话路由的扇出键） */
    readonly sessionId: string,
    /** 流终结一次性回调（退订——注册表注入） */
    private readonly onEnd: () => void,
    private readonly now: () => number,
    pingIntervalMs: number,
    writeTimeoutMs: number,
  ) {
    // SSE 开流即 200（此后错误只能走帧——SSE 状态码位已用尽）。冲头是关键：
    // 连接即当下、无重放首帧——不 flushHeaders 则客户端 fetch 悬至首个 ping
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // 代理禁缓冲（SSE 语义钉死）
    });
    res.flushHeaders();
    res.on('close', () => this.end());
    res.on('drain', () => {
      this.backedUp = false;
      this.backedUpSince = undefined;
    });
    this.writeTimeout = writeTimeoutMs;
    this.pingTimer = setInterval(() => this.pingTick(), pingIntervalMs);
  }

  /** 信封写入（扇出腿消费——帧合成钉死：整体单次 JSON.stringify 单行） */
  write(env: WebuiEnvelope): void {
    if (this.ended) return;
    if (this.backedUp && isDroppableEnvelope(env)) return;
    this.send(`data: ${JSON.stringify(env)}\n\n`);
  }

  /** 宿主收场腿（stop() 全流收口——幂等；终结后毁连接助 server.close 归零） */
  close(): void {
    this.end();
    this.res.destroy();
  }

  private pingTick(): void {
    if (this.ended) return;
    // 写侧看门狗：背压持续超窗即判死 reap（ping 写不动的流已不可救）
    if (this.backedUp && this.backedUpSince !== undefined && this.now() - this.backedUpSince > this.writeTimeout) {
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

/* ---------------- 审批 pending registry（件内进程内存态） ---------------- */

/** 未决审批账项（decide 幂等判据 + 清单投影载体） */
interface PendingApproval {
  readonly sessionId: string;
  readonly summary: string;
  readonly reason?: string;
  readonly toolName?: string;
  readonly suggestedEntry?: string;
  /** 已决标记（先答先得后迟到 decide/abort 皆 no-op） */
  settled: boolean;
  readonly resolve: (answer: ApprovalAskAnswer) => void;
}

/* ---------------- 静态面 ---------------- */

/** 静态面内容型表（扩展名 → content-type；缺席 application/octet-stream） */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 造 Web 通道服务端（backend + 微路由 + SSE 三位一体）。
 *
 * @param deps 装配根闭包注入窄面（会话族/投影读/补全族/静态目录——词面独立律）
 * @param options 开面配置与时钟节拍帽参（测试确定性注入位）
 */
export function createWebuiServer(deps: WebuiDeps, options: WebuiServerOptions = {}): WebuiHandle {
  const config = options.config ?? {};
  const now = options.now ?? Date.now;
  const pingIntervalMs = options.pingIntervalMs ?? WEBUI_SSE_PING_INTERVAL_MS;
  const writeTimeoutMs = options.writeTimeoutMs ?? WEBUI_SSE_WRITE_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? WEBUI_MAX_CONNECTIONS;
  const bodyLimitBytes = options.bodyLimitBytes ?? WEBUI_BODY_LIMIT_BYTES;
  const warn = options.warn ?? (() => {});
  const token = config.token ?? generateToken();
  const bindHost = config.host ?? WEBUI_DEFAULT_HOST;

  /** 活体流注册表（全局帽计数 + 按会话扇出索引） */
  const streams = new Set<SseStream>();
  const bySession = new Map<string, Set<SseStream>>();
  /** 未决审批账（approvalId → 账项——decide 幂等判据 + 清单投影） */
  const pending = new Map<string, PendingApproval>();
  /** 后端内 ask 计数（调用方未指派 approvalId 时生成 `webui-N`） */
  let askSeq = 0;
  /** 服务端内 submit 计数（SPA 未携 messageId 时生成 `webui-N`——无幂等） */
  let submitSeq = 0;
  /** 实效监听端口（start 后回填——Origin 同源判据用；port 0 形实配值） */
  let listenPort = config.port ?? WEBUI_DEFAULT_PORT;
  let stopping = false;

  /** 流退订（终结回调——双索引摘除） */
  const deregister = (stream: SseStream): void => {
    streams.delete(stream);
    const set = bySession.get(stream.sessionId);
    if (set === undefined) return;
    set.delete(stream);
    if (set.size === 0) bySession.delete(stream.sessionId);
  };

  /** 会话路由扇出（display/session/status 三族——按订阅索引） */
  const pushToSession = (sessionId: string, env: WebuiEnvelope): void => {
    const set = bySession.get(sessionId);
    if (set === undefined) return;
    for (const stream of set) stream.write(env);
  };

  /** notify 广播（非阻塞原语不分会话呈现位——全流扇出） */
  const broadcast = (env: WebuiEnvelope): void => {
    for (const stream of streams) stream.write(env);
  };

  /* ---- UiBackend 第四实装（claim 桥——通道核 addBackend 注册） ---- */

  const backend: UiBackend<never> = {
    id: 'webui',
    // 三位能力面对应信封三族（notify·status·approval）；confirm/select/input
    // 缺席（微路由 v1 无应答端点——降级判定归核）；setWidget 是 TUI 呈现概念
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: true,
      setStatus: true,
      setWidget: false,
    },
    // 观众探针：在线 SSE 连接数（零连接 = 无人接帧 = 无观众）
    hasAudience: () => streams.size > 0,
    notify: (message: string, opts?: { level?: NotifyLevel }) => {
      broadcast({
        kind: 'notify',
        payload: { message, ...(opts?.level !== undefined ? { level: opts.level } : {}) },
      });
    },
    // 状态行更新（last-writer-wins 天然——多写者扇出覆盖）
    setStatus: (sessionId: string, status: string) => {
      pushToSession(sessionId, { kind: 'status', sessionId, payload: { status } });
    },
    // 活体信封呈现（focused 位无 webui 语义——SPA 自选视图，无聚焦降档）
    onEnvelope: (env: SessionEnvelope) => {
      // 分档判据（批 18a 定形注②）：终结型两型落 durable → session 镜像族；
      // 其余活体 → display 族
      const terminal = env.event.type === 'message_end' || env.event.type === 'tool_execution_end';
      pushToSession(
        env.sessionId,
        terminal
          ? { kind: 'session', sessionId: env.sessionId, payload: env.event }
          : { kind: 'display', sessionId: env.sessionId, payload: env.event },
      );
    },
    askApproval: (sessionId: string, request, opts) =>
      new Promise<ApprovalAskAnswer>((resolve) => {
        // 进程作用域语义（定形注④）：不采无连接即时 cancel——开面在场即持
        // 应答能力，浏览器迟到也可应答；纯 webui 无浏览器时 ask 挂起至
        // run 打断/会话收口（核保守值兜底）。
        const approvalId = request.approvalId ?? `webui-${++askSeq}`;
        const entry: PendingApproval = {
          sessionId,
          summary: request.summary,
          ...(request.reason !== undefined ? { reason: request.reason } : {}),
          ...(request.toolName !== undefined ? { toolName: request.toolName } : {}),
          ...(request.suggestedEntry !== undefined ? { suggestedEntry: request.suggestedEntry } : {}),
          settled: false,
          resolve,
        };
        pending.set(approvalId, entry);
        // asked 镜像外推（session 族承载——零新词汇：payload 形复用 durable
        // approval/asked 词汇；可见性半边经此镜像，无第二套 ask 帧词面；
        // approvalId 显式置尾防 request 内 undefined 值覆写生成位）
        pushToSession(sessionId, {
          kind: 'session',
          sessionId,
          payload: { type: 'approval/asked', ...request, approvalId },
        });
        // 败腿撤销传播位（UiCore 竞速先答后 abort——abort 恒后于竞速落定，
        // 本 resolve 是无害清槽不构成抢答）；已决后迟到 abort 是 no-op
        opts?.signal?.addEventListener(
          'abort',
          () => {
            const e = pending.get(approvalId);
            if (e === undefined || e.settled) return;
            e.settled = true;
            pending.delete(approvalId);
            resolve('cancel');
          },
          { once: true },
        );
      }),
  };

  /** decide 应答（跨入口竞速回执——只 resolve pending resolver，绝不直接写
   *  durable：decided durable 写唯一保留在 ask() 汇流点；unknown/已决 →
   *  superseded 幂等回执） */
  const decideApproval = (approvalId: string, answer: ApprovalAskAnswer): 'applied' | 'superseded' => {
    const entry = pending.get(approvalId);
    if (entry === undefined || entry.settled) return 'superseded';
    entry.settled = true;
    pending.delete(approvalId);
    entry.resolve(answer);
    return 'applied';
  };

  /* ---- 鉴权（Bearer / cookie 桥双形） ---- */

  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      if (tokenMatches(token, header.slice('Bearer '.length))) return true;
    }
    const cookie = req.headers.cookie;
    if (typeof cookie === 'string') {
      for (const part of cookie.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(`${WEBUI_COOKIE_NAME}=`)) {
          if (tokenMatches(token, trimmed.slice(WEBUI_COOKIE_NAME.length + 1))) return true;
        }
      }
    }
    return false;
  };

  /* ---- 静态面（SPA 壳——无鉴权三位之一；缺席 = API-only 形） ---- */

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    if (deps.staticDir === undefined) {
      sendError(res, 404, 'no_spa', 'SPA 静态面未装配（API-only 形态）');
      return;
    }
    const root = resolve(deps.staticDir);
    let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
    let target = resolve(join(root, rel));
    // 路径穿越防线：归一后须仍在根内（.. 段与编码形出根即拒）
    if (target !== root && !target.startsWith(root + sep)) {
      sendError(res, 403, 'forbidden', '路径出静态面根');
      return;
    }
    try {
      const s = await stat(target);
      if (!s.isFile()) throw new Error('not file');
    } catch {
      // SPA fallback 路由：未知/非文件路径回 index.html（前端路由接管）
      rel = 'index.html';
      target = join(root, rel);
      try {
        if (!(await stat(target)).isFile()) throw new Error('no index');
      } catch {
        sendError(res, 404, 'no_spa', '静态面缺 index.html');
        return;
      }
    }
    const dot = target.lastIndexOf('.');
    const ext = dot === -1 ? '' : target.slice(dot).toLowerCase();
    res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
    createReadStream(target)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  /* ---- 微路由主入口 ---- */

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 三防线②：Host 白名单（先于一切路由——DNS rebinding 防线）
    const hostVerdict = judgeHostHeader(req.headers.host, bindHost);
    if (!hostVerdict.ok) {
      sendError(res, 403, 'forbidden', hostVerdict.reason);
      return;
    }
    // 三防线③：Origin 硬防线（带且非同源三形拒；无 Origin 放行）
    const origin = req.headers.origin;
    if (!originAllowed(typeof origin === 'string' ? origin : undefined, bindHost, listenPort)) {
      sendError(res, 403, 'forbidden', `Origin 防线拒：${String(origin)}`);
      return;
    }

    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const segments = url.pathname.split('/').filter((s) => s !== '');
    const query = url.searchParams;

    // ---- 探活（无鉴权——只回 ok 零敏感面） ----
    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'health') {
      if (method !== 'GET') return sendError(res, 405, 'method_not_allowed');
      return sendJson(res, 200, { ok: true });
    }

    // ---- auth cookie 桥（无鉴权三位之二——本位即鉴权） ----
    if (segments.length === 2 && segments[0] === 'api' && segments[1] === 'auth') {
      if (method !== 'POST') return sendError(res, 405, 'method_not_allowed');
      let raw: string;
      try {
        raw = await readBody(req, bodyLimitBytes);
      } catch (err) {
        return err instanceof BodyTooLarge
          ? sendError(res, 413, 'too_large', err.message)
          : sendError(res, 400, 'bad_request');
      }
      const parsed = parseJson(raw);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const body = validate<{ token: string }>(AuthSchema, parsed.value, 'auth 体');
      if (!body.ok) return sendError(res, 400, 'bad_request', body.reason);
      if (!tokenMatches(token, body.value.token)) return sendError(res, 401, 'unauthorized', 'token 不符');
      // cookie 桥落定（HttpOnly + SameSite=Strict——EventSource 不能携头，本桥
      // 是浏览器侧唯一凭证通道；Path=/ 覆盖全 API 面）
      res.writeHead(204, {
        'set-cookie': `${WEBUI_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end();
      return;
    }

    // ---- API 族（鉴权门——除 health/auth 外一切 /api/* 必凭证） ----
    if (segments[0] === 'api') {
      if (!authorized(req)) return sendError(res, 401, 'unauthorized', '缺凭证（Bearer 或 cookie）');

      // 会话族根：GET 清单 / POST 开新
      if (segments.length === 2 && segments[1] === 'sessions') {
        if (method === 'GET') {
          return sendJson(res, 200, { sessions: deps.sessions.listSessions() });
        }
        if (method === 'POST') {
          return sendJson(res, 200, { sessionId: deps.sessions.createSession() });
        }
        return sendError(res, 405, 'method_not_allowed');
      }

      // 会话族子路由：/api/sessions/:id/<verb>（长度守卫已判 ≥4——索引非空断言承
      // noUncheckedIndexedAccess，先例同 safety/browser 件族）
      if (segments.length === 4 && segments[1] === 'sessions') {
        const sessionId = segments[2]!;
        const verb = segments[3]!;
        const state = deps.sessions.sessionStateOf(sessionId);
        // 会话存在性分账：missing/closed 均 404（error 词分立——已闭只读兜底）
        if (verb === 'messages') {
          if (method !== 'GET') return sendError(res, 405, 'method_not_allowed');
          // 近史投影兜底可拉（closed 会话同样可拉——messages/todo 不受闭态拦）
          const messages = await deps.read.fetchMessages(sessionId);
          return sendJson(res, 200, { messages });
        }
        if (verb === 'todo') {
          if (method !== 'GET') return sendError(res, 405, 'method_not_allowed');
          const items = deps.read.todoOf?.(sessionId);
          return sendJson(res, 200, { items: items ?? null }); // null = 无数据源（诚实不虚报）
        }
        if (state === 'missing') return sendError(res, 404, 'not_found', '会话缺席');
        if (verb === 'events') {
          if (method !== 'GET') return sendError(res, 405, 'method_not_allowed');
          // closed 会话放行（空流形——近史走 messages 兜底，流恒静默无假帧）
          if (streams.size >= maxConnections) {
            return sendError(res, 503, 'overloaded', `SSE 连接帽（${maxConnections}）已满`);
          }
          const stream = new SseStream(res, sessionId, () => deregister(stream), now, pingIntervalMs, writeTimeoutMs);
          streams.add(stream);
          const set = bySession.get(sessionId) ?? new Set<SseStream>();
          set.add(stream);
          bySession.set(sessionId, set);
          return; // 长连接——生命周期归流自治（close/看门狗/宿主 stop 三路）
        }
        if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
        if (verb === 'submit') {
          if (method !== 'POST') return sendError(res, 405, 'method_not_allowed');
          let raw: string;
          try {
            raw = await readBody(req, bodyLimitBytes);
          } catch (err) {
            return err instanceof BodyTooLarge
              ? sendError(res, 413, 'too_large', err.message)
              : sendError(res, 400, 'bad_request');
          }
          const parsed = parseJson(raw);
          if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
          const body = validate<{ text: string; messageId?: string }>(SubmitSchema, parsed.value, 'submit 体');
          if (!body.ok) return sendError(res, 400, 'bad_request', body.reason);
          const outcome = deps.sessions.submitPrompt({
            sessionId,
            content: body.value.text,
            messageId: body.value.messageId ?? `webui-${++submitSeq}`,
          });
          return sendJson(res, 200, { sessionId: outcome.sessionId });
        }
        if (verb === 'interrupt') {
          if (method !== 'POST') return sendError(res, 405, 'method_not_allowed');
          deps.sessions.interruptSession(sessionId);
          res.writeHead(204).end();
          return;
        }
        return sendError(res, 404, 'not_found', `未知会话子路由：${verb}`);
      }

      // 审批族
      if (segments.length === 2 && segments[1] === 'approvals') {
        if (method === 'GET') {
          const filter = query.get('sessionId');
          const list: WebuiApprovalEntry[] = [];
          for (const [approvalId, entry] of pending) {
            if (entry.settled || (filter !== null && entry.sessionId !== filter)) continue;
            list.push({
              approvalId,
              sessionId: entry.sessionId,
              summary: entry.summary,
              ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
              ...(entry.toolName !== undefined ? { toolName: entry.toolName } : {}),
              ...(entry.suggestedEntry !== undefined ? { suggestedEntry: entry.suggestedEntry } : {}),
            });
          }
          return sendJson(res, 200, { approvals: list });
        }
        return sendError(res, 405, 'method_not_allowed');
      }
      if (segments.length === 4 && segments[1] === 'approvals' && segments[3] === 'decide') {
        if (method !== 'POST') return sendError(res, 405, 'method_not_allowed');
        let raw: string;
        try {
          raw = await readBody(req, bodyLimitBytes);
        } catch (err) {
          return err instanceof BodyTooLarge
            ? sendError(res, 413, 'too_large', err.message)
            : sendError(res, 400, 'bad_request');
        }
        const parsed = parseJson(raw);
        if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
        const body = validate<{ answer: ApprovalAskAnswer; note?: string }>(DecideSchema, parsed.value, 'decide 体');
        if (!body.ok) return sendError(res, 400, 'bad_request', body.reason);
        // 只 resolve pending resolver（绝不直接写 durable——decided durable 写
        // 唯一保留在 ask() 汇流点；后到/未知 = superseded 幂等回执）
        const outcome = decideApproval(segments[2]!, body.value.answer);
        return sendJson(res, 200, { outcome });
      }

      // 补全族（两段——注入面缺席诚实空）
      if (segments.length === 3 && segments[1] === 'workspace') {
        if (method !== 'GET') return sendError(res, 405, 'method_not_allowed');
        const q = query.get('q') ?? '';
        if (segments[2] === 'files') return sendJson(res, 200, { items: deps.completion?.workspaceFiles?.(q) ?? [] });
        if (segments[2] === 'symbols')
          return sendJson(res, 200, { items: deps.completion?.workspaceSymbols?.(q) ?? [] });
        return sendError(res, 404, 'not_found', `未知补全子路由：${segments[2]}`);
      }

      return sendError(res, 404, 'not_found', `未知 API 路由：${url.pathname}`);
    }

    // ---- 静态面（无鉴权三位之三——SPA 壳先于鉴权必须可载，壳无 API 即惰性） ----
    if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, 'method_not_allowed');
    return serveStatic(res, url.pathname);
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      warn(`webui 请求处理异常：${req.method} ${req.url}——${err instanceof Error ? err.message : String(err)}`);
      if (!res.writableEnded) sendError(res, 500, 'internal');
    });
  });

  return {
    backend,
    token,
    start: async () => {
      // 三防线①：启动断言（非回环绑定必配凭证——fail-closed 拒启律预埋）
      const verdict = judgeListenConfig(config);
      if (!verdict.ok) throw new Error(verdict.reason);
      const port = config.port ?? WEBUI_DEFAULT_PORT;
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err);
        server.once('error', onError);
        server.listen(port, bindHost, () => {
          server.off('error', onError);
          resolve();
        });
      });
      listenPort = (server.address() as AddressInfo).port;
      return { host: bindHost, port: listenPort };
    },
    stop: async () => {
      if (stopping) return;
      stopping = true;
      // 收场序：全流收口（停 ping + 毁连接）→ 审批清槽（**丢弃性结算——不
      // resolve**：未决条目不凭空造值抢答；败腿 promise 悬挂由核 finish/
      // 队列收口吸收）→ 关监听
      for (const stream of [...streams]) stream.close();
      pending.clear();
      // closeAllConnections 兜底（keep-alive idle 连接不阻退出——SSE 已毁，
      // 其余在飞请求随进程收场）
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
