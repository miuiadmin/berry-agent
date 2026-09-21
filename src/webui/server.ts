/**
 * webui/server — Web 通道路由实装（03 §10.4 批 18a-2' 改形；批 18a-1 传输
 * 实装 → 承载位改注册）。
 *
 * **承载位改注册（18a-2'——03 §10.4 改形注记 + §10.6 路由扩展位段）**：
 * 件零自持 node:http 监听——mountWebui(deps) 把五撮 17 端点（2026-09-18
 * webui 档位面受理批 14→17——会话族档位三端点入册）+ SPA fallback 逐条
 * 注册进注入的注册器（sdk 面注册器结构兼容）。归面级的四块（原自持
 * 已删）：三防线（Host 白名单/Origin 硬防线——面级先行适用于一切路由，仅
 * TCP）/ token 鉴权执法（token-or-cookie 档 Bearer ∪ cookie 双通道、恒时
 * 比对——面 token 唯一验换位 ctx.verifyToken）/ POST 体帽与排空纪律
 * （ctx.readBody——超帽 413 永不早于体收完）/ SSE 单流基建（帧形/ping/
 * 看门狗/shedding——ctx.openSse 注入件侧可丢判据）。
 *
 * 件内维持位（§10.4 改形注②-⑦语义全保）：
 * - **backend**：UiBackend 第四实装（claim 桥）。审批腿**进程作用域语义**
 *   （定形注④——与 SDK 腿「连接作用域无订阅即 cancel」分立）：开面在场即
 *   持应答能力、不采无连接即时 cancel；败腿/撤销经 signal abort 清槽
 *   （abort 恒后于竞速落定——UiCore finish 内序，不构成抢答）。
 * - **SSE 信封三族**：分档判据注②（终结型两型 + asked 镜像 → session 族，
 *   其余活体 → display 族）；连接即当下（v1 无重放游标——正确性层 = 客户端
 *   onopen 恒重拉投影）；全局连接帽 16 件侧自记账（面级 openStreams 不暴露
 *   计数）超帽 503；背压 shedding 判据 = display 的 update 两型（session/
 *   notify/status 镜像帧不弃）。
 * - **微路由语义**：会话存在性分账（missing submit/events 404 not_found /
 *   closed submit 404 closed；messages/todo 不受闭态拦；closed events 放行
 *   空流）；cookie 桥注③（体 {token} 经面级 verifyToken 验换 → Set-Cookie
 *   HttpOnly SameSite=Strict——EventSource 无头位，浏览器侧唯一凭证通道）；
 *   SPA 静态位注⑦（路径穿越防线 + 未知深路径 fallback index.html；缺席
 *   API-only 404 no_spa）；JSON 均 typebox 校验后消费。
 * - **decide 只 resolve pending resolver**（绝不直接写 durable——decided
 *   durable 写唯一保留在 ask() 汇流点；unknown/已决 → superseded 幂等回执）。
 * - **档位面三端点**（2026-09-18 webui 档位面受理批——07 §4.1 挂账句销账）：
 *   GET tiers（注入窄面 501 判先于会话态 404；thinkingLevel 无锚 null 形；
 *   fold 坏词上抛面级 500 不静默吞——冷读 CR-TIER-2）+ 两 PUT（单字符串体
 *   {level}/{mode}；bodyLimitBytes 显式设值防 sdk 面 10MiB 缺省渗透——冷读
 *   F2；坏词 BaseError → 400 码族词面呈现不吞码；成功应答 {receipt}）；已
 *   闭会话三端点一律 404 closed（读写不分——档位面是会话活体交互面，tiers
 *   非正文读面，与 messages//export 的已闭放行射界分立）。
 *
 * 收场语义：detach() = 全路由摘除 + 全流收口 + 审批清槽（**丢弃性结算——
 * 不 resolve**：未决条目不凭空造值抢答；败腿 promise 悬挂由核 finish/队列
 * 收口吸收）——行回卷语义与原 stop() 同律；监听关停归面（宿主 face.stop）。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

import { BaseError, type ApprovalAskAnswer } from '../contracts/index.js';
import type { NotifyLevel, SessionEnvelope, UiBackend } from '../channels/index.js';
import {
  WEBUI_BODY_LIMIT_BYTES,
  WEBUI_COOKIE_NAME,
  WEBUI_ENDPOINTS,
  WEBUI_MAX_CONNECTIONS,
  type WebuiApprovalEntry,
  type WebuiEnvelope,
  type WebuiMountDeps,
  type WebuiMountHandle,
  type WebuiMountOptions,
  type WebuiRouteAuth,
  type WebuiRouteDescriptor,
  type WebuiRouteSseStream,
} from './types.js';

/* ---------------- typebox 校验（03 §10.4「JSON 均 typebox 校验后消费」） ---------------- */

/** 公共字段词面：未知字段拒收（收窄律——请求面载荷即全集） */
const strict = { additionalProperties: false } as const;

/** auth 体（cookie 桥——token 必填） */
const AuthSchema = Type.Object({ token: Type.String() }, strict);

/** submit 体（text 必填；messageId 选填 = SPA 重试幂等位——缺席即 undefined
 * 透传、件侧不补生成〔8572ccd 拍板——与 SDK 线同律：undefined 无幂等不落账〕） */
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

/** thinking-level 体（档位面单字符串体——SubmitSchema 先例形；词法校验归
 *  注入面 fail-loud〔THINKING_LEVEL_INVALID〕，schema 只锁体形） */
const ThinkingLevelSchema = Type.Object({ level: Type.String() }, strict);

/** sandbox-mode 体（同律单字符串体；词法校验归注入面 SANDBOX_MODE_INVALID） */
const SandboxModeSchema = Type.Object({ mode: Type.String() }, strict);

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

/* ---------------- 应答与解析 ---------------- */

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

/** 解析 JSON 体（坏形 → 可行动报因） */
function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, reason: '请求体非 JSON' };
  }
}

/** query 解析（ctx 窄面无 query 位——handler 侧自 req.url 取；基座仅为相对形合法） */
function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://webui.internal').searchParams;
}

/** 判信封是否纯活体可丢（背压 shedding 面——display 族的 update 两型；session
 *  镜像/notify/status 不弃） */
function isDroppableEnvelope(env: WebuiEnvelope): boolean {
  return (
    env.kind === 'display' && (env.payload.type === 'message_update' || env.payload.type === 'tool_execution_update')
  );
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

/** 件侧活体流账项（全局帽计数 + 按会话扇出索引的成员——流本体是面级 openSse 产物） */
interface WebuiStreamEntry {
  readonly stream: WebuiRouteSseStream;
  readonly sessionId: string;
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
 * 造 webui 路由件并注册进注入的注册器（承载位改注册——零自持监听）。
 *
 * @param deps 装配根闭包注入窄面 + 路由注册器（sdk 面注册器结构兼容直传）
 * @param options 件侧帽参（SSE 连接帽 / POST 体帽——测试确定性注入位）
 */
export function mountWebui(deps: WebuiMountDeps, options: WebuiMountOptions = {}): WebuiMountHandle {
  const maxConnections = options.maxConnections ?? WEBUI_MAX_CONNECTIONS;
  const bodyLimitBytes = options.bodyLimitBytes ?? WEBUI_BODY_LIMIT_BYTES;
  const warn = options.warn ?? ((): void => {});

  /** 活体流注册表（全局帽计数 + 按会话扇出索引） */
  const streams = new Set<WebuiStreamEntry>();
  const bySession = new Map<string, Set<WebuiStreamEntry>>();
  /** 未决审批账（approvalId → 账项——decide 幂等判据 + 清单投影） */
  const pending = new Map<string, PendingApproval>();
  /** 后端内 ask 计数（调用方未指派 approvalId 时生成 `webui-N`） */
  let askSeq = 0;

  /** 流退订（终结回调——双索引摘除；挂点位 = res close〔连接 close/看门狗/
   *  面收场三路共用的真连接终结信号〕，与面级流账自摘并存不冲突） */
  const deregister = (entry: WebuiStreamEntry): void => {
    streams.delete(entry);
    const set = bySession.get(entry.sessionId);
    if (set === undefined) return;
    set.delete(entry);
    if (set.size === 0) bySession.delete(entry.sessionId);
  };

  /** 会话路由扇出（display/session/status 三族——按订阅索引） */
  const pushToSession = (sessionId: string, env: WebuiEnvelope): void => {
    const set = bySession.get(sessionId);
    if (set === undefined) return;
    for (const entry of set) entry.stream.write(env);
  };

  /** notify 广播（非阻塞原语不分会话呈现位——全流扇出） */
  const broadcast = (env: WebuiEnvelope): void => {
    for (const entry of streams) entry.stream.write(env);
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

  /* ---- 静态面（SPA 壳——open/static-shell 三位之一；缺席 = API-only 形） ---- */

  async function serveStatic(res: ServerResponse, wildcard: string): Promise<void> {
    if (deps.staticDir === undefined) {
      sendError(res, 404, 'no_spa', 'SPA 静态面未装配（API-only 形态）');
      return;
    }
    const root = resolve(deps.staticDir);
    // wildcard 无前导斜杠（面级匹配器以段拼回）——根路径空串归 index.html；
    // 畸形百分号序列（decodeURIComponent 抛 URIError）与未知路径同语义——
    // 归 SPA fallback（index.html），不容未认证客户端以畸形 URL 触发 500 internal 分档失真
    let rel = 'index.html';
    if (wildcard !== '') {
      try {
        rel = decodeURIComponent(wildcard);
      } catch {
        rel = 'index.html'; // decode 抛 URIError——赋值未发生，明示复位走既有 fallback 段
      }
    }
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

  /* ---- 路由族注册（五撮 17 端点〔2026-09-18 档位面 14→17〕+ /api 兜底 + SPA fallback——全族 loopbackOnly） ---- */

  /** API 族鉴权档（Bearer ∪ cookie 双通道——cookie 名单源） */
  const tokenOrCookie: WebuiRouteAuth = { mode: 'token-or-cookie', cookie: WEBUI_COOKIE_NAME };
  /** 摘除 fn 账（detach 全路由摘除用） */
  const detachers: Array<() => void> = [];
  /** 注册速记（loopbackOnly 全族恒真——07 E1 恒回环可达） */
  const add = (descriptor: WebuiRouteDescriptor): void => {
    detachers.push(deps.register({ loopbackOnly: true, ...descriptor }));
  };

  // —— 探活（open/liveness——只回 ok 零敏感面）——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.health,
    auth: { mode: 'open', purpose: 'liveness' },
    handler: (_req, res) => sendJson(res, 200, { ok: true }),
  });

  // —— auth cookie 桥（open/auth-exchange——本位即鉴权：体 token 经面级
  //    verifyToken 验换，落定 Set-Cookie；cookie 值 = 验换通过的那枚 token）——
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.auth,
    auth: { mode: 'open', purpose: 'auth-exchange' },
    bodyLimitBytes,
    handler: async (req, res, ctx) => {
      const body = await ctx.readBody(req);
      if (!body.ok) return sendError(res, body.status, 'too_large', body.message);
      const parsed = parseJson(body.body);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const auth = validate<{ token: string }>(AuthSchema, parsed.value, 'auth 体');
      if (!auth.ok) return sendError(res, 400, 'bad_request', auth.reason);
      if (!ctx.verifyToken(auth.value.token)) return sendError(res, 401, 'unauthorized', 'token 不符');
      // cookie 桥落定（HttpOnly + SameSite=Strict——EventSource 不能携头，本桥
      // 是浏览器侧唯一凭证通道；Path=/ 覆盖全 API 面；token-or-cookie 档由面
      // 级用同一 token 验 cookie——闭环成立）
      res.writeHead(204, {
        'set-cookie': `${WEBUI_COOKIE_NAME}=${auth.value.token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end();
    },
  });

  // —— 会话族根：GET 清单 / POST 开新 ——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessions,
    auth: tokenOrCookie,
    handler: (_req, res) => sendJson(res, 200, { sessions: deps.sessions.listSessions() }),
  });
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.sessions,
    auth: tokenOrCookie,
    handler: (_req, res) => sendJson(res, 200, { sessionId: deps.sessions.createSession() }),
  });

  // —— 会话族子路由（存在性分账注⑥：messages/todo 不受闭态拦；events 前
  //    missing 拒、closed 放行空流；submit/interrupt 受闭态拦）——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionMessages,
    auth: tokenOrCookie,
    handler: async (_req, res, ctx) => {
      // 近史投影兜底可拉（closed 会话同样可拉——只读腿）
      const messages = await deps.read.fetchMessages(ctx.params.id!);
      sendJson(res, 200, { messages });
    },
  });
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionTodo,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      const items = deps.read.todoOf?.(ctx.params.id!);
      sendJson(res, 200, { items: items ?? null }); // null = 无数据源（诚实不虚报）
    },
  });
  // —— 会话族子路由：/export markdown 直出（2026-09-17 TUI 余量收官批②——
  //    应答体 = markdown 正文直出 **不落盘**（web 面消费语义 = 浏览器/curl
  //    直接取文；TUI /export 落盘形与 CLI 形不变）；拼装单源 = host 桥真身
  //    注入的 exportMarkdown（renderSessionMarkdown 第三消费位）——
  //    注入窄面缺席 = 501 诚实缺席；会话缺席 = 404 not_found 同族；已闭
  //    会话 = 近史投影兜底照常返体（读面语义同 messages——只读腿不受闭态拦）——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionExport,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      // 注入窄面缺席（API-only 形——WebuiCompletionFace? 缺席诚实空同精神）
      const exportMarkdown = deps.read.exportMarkdown;
      if (exportMarkdown === undefined) {
        sendError(res, 501, 'not_implemented', '会话导出面未装配（exportMarkdown 注入缺席）');
        return;
      }
      const markdown = exportMarkdown(ctx.params.id!);
      if (markdown === undefined) {
        sendError(res, 404, 'not_found', '会话缺席');
        return;
      }
      // markdown 正文直出（Content-Type 精确值钉规范位——text/markdown; charset=utf-8）
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(markdown);
    },
  });
  // —— 会话族子路由：档位面三端点（2026-09-18 webui 档位面受理批——07 §4.1
  //    挂账句销账；词表+行文案单源服务端、SPA 零硬编码；消费单源 = 注入面
  //    落 conversation 件 append 面，webui 侧零第二写入位）——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionTiers,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      // 501 判先于会话态 404（GET /export 先例同序——冷读 CR-TIER-2 钉死：
      // 注入窄面缺席〔API-only 形〕优先于会话存在性分账，序倒置则面装配
      // 缺失被会话态遮蔽）
      const tiers = deps.tiers;
      if (tiers === undefined) {
        sendError(res, 501, 'not_implemented', '档位面未装配（tiers 注入缺席）');
        return;
      }
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话缺席');
      // 已闭一律 404 closed（读写不分——档位面是会话活体交互面；messages/
      // export 的已闭放行系正文读面语义，tiers 非正文读面）
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      // fold 坏词不 catch：tiersOf 上抛走面级 500（冷读 CR-TIER-2 钉死——
      // 不静默吞；TUI 开屏 notify 降级形分立如实，服务端只如实上抛）
      sendJson(res, 200, tiers.tiersOf(sessionId));
    },
  });
  add({
    method: 'PUT',
    path: WEBUI_ENDPOINTS.sessionThinkingLevel,
    auth: tokenOrCookie,
    // 体帽显式设值（与 submit 路由同常量——256KiB；防 sdk 面 10MiB 缺省
    // 渗透，冷读 F2——描述符缺席该键则面级缺省帽悄悄放宽即缺陷）
    bodyLimitBytes,
    handler: async (req, res, ctx) => {
      // 501 判先于会话态 404（与 GET tiers 同序）
      const tiers = deps.tiers;
      if (tiers === undefined) {
        sendError(res, 501, 'not_implemented', '档位面未装配（tiers 注入缺席）');
        return;
      }
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话缺席');
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      const body = await ctx.readBody(req);
      if (!body.ok) return sendError(res, body.status, 'too_large', body.message);
      const parsed = parseJson(body.body);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const levelBody = validate<{ level: string }>(ThinkingLevelSchema, parsed.value, 'thinking-level 体');
      if (!levelBody.ok) return sendError(res, 400, 'bad_request', levelBody.reason);
      try {
        // 回执文案 = 注入面拼装单源（host 侧 helper 两装配面同源消费）；
        // 成功尾调 setStatus 扇出归 host 桥真身（CR-TIER-3——webui 件内不代劳）
        const receipt = tiers.setThinkingLevel(sessionId, levelBody.value.level);
        sendJson(res, 200, { receipt });
      } catch (err) {
        // 坏词 fail-loud：BaseError 码族词面呈现不吞码（THINKING_LEVEL_INVALID
        // ——HTTP 面不吞码，02 §5.3）；非 BaseError 异常如实上抛走面级 500
        if (err instanceof BaseError) {
          sendError(res, 400, err.code, err.message);
          return;
        }
        throw err;
      }
    },
  });
  add({
    method: 'PUT',
    path: WEBUI_ENDPOINTS.sessionSandboxMode,
    auth: tokenOrCookie,
    // 体帽显式设值（同 thinking-level——256KiB，冷读 F2）
    bodyLimitBytes,
    handler: async (req, res, ctx) => {
      // 501 判先于会话态 404（与 GET tiers 同序）
      const tiers = deps.tiers;
      if (tiers === undefined) {
        sendError(res, 501, 'not_implemented', '档位面未装配（tiers 注入缺席）');
        return;
      }
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话缺席');
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      const body = await ctx.readBody(req);
      if (!body.ok) return sendError(res, body.status, 'too_large', body.message);
      const parsed = parseJson(body.body);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const modeBody = validate<{ mode: string }>(SandboxModeSchema, parsed.value, 'sandbox-mode 体');
      if (!modeBody.ok) return sendError(res, 400, 'bad_request', modeBody.reason);
      try {
        // sandbox 档回执 = 即刻生效于后续工具调用（按档分拆语义另一半）
        const receipt = tiers.setSandboxMode(sessionId, modeBody.value.mode);
        sendJson(res, 200, { receipt });
      } catch (err) {
        // 坏词 fail-loud：SANDBOX_MODE_INVALID 码族词面呈现（同 thinking 律）
        if (err instanceof BaseError) {
          sendError(res, 400, err.code, err.message);
          return;
        }
        throw err;
      }
    },
  });
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionEvents,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      const sessionId = ctx.params.id!;
      if (deps.sessions.sessionStateOf(sessionId) === 'missing') {
        sendError(res, 404, 'not_found', '会话缺席');
        return;
      }
      // closed 会话放行（空流形——近史走 messages 兜底，流恒静默无假帧）
      if (streams.size >= maxConnections) {
        sendError(res, 503, 'overloaded', `SSE 连接帽（${maxConnections}）已满`);
        return;
      }
      // 面级开流（帧形/ping/看门狗面单源；shedding 判据 = display 的 update
      // 两型可丢——unknown 域收敛转型 = 本面流载荷恒 WebuiEnvelope 的件内不变式）
      const stream = ctx.openSse(res, {
        droppable: (data): boolean => isDroppableEnvelope(data as WebuiEnvelope),
      });
      const entry: WebuiStreamEntry = { stream, sessionId };
      streams.add(entry);
      const set = bySession.get(sessionId) ?? new Set<WebuiStreamEntry>();
      set.add(entry);
      bySession.set(sessionId, set);
      // 件侧销账位 = res close（连接 close/面级看门狗 destroy/宿主收场三路
      // 共用的真连接终结信号——与面级流账自摘并存）
      res.on('close', () => deregister(entry));
    },
  });
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.sessionSubmit,
    auth: tokenOrCookie,
    bodyLimitBytes,
    handler: async (req, res, ctx) => {
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话缺席');
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      const body = await ctx.readBody(req);
      if (!body.ok) return sendError(res, body.status, 'too_large', body.message);
      const parsed = parseJson(body.body);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const submit = validate<{ text: string; messageId?: string }>(SubmitSchema, parsed.value, 'submit 体');
      if (!submit.ok) return sendError(res, 400, 'bad_request', submit.reason);
      try {
        // messageId 缺席即 undefined 透传（8572ccd 拍板：件侧不再补生成——
        // undefined = 无幂等不落账，桥侧容忍形 18a3cf8 已就位；生成键旁路
        // 与 submitSeq 计数位随本收敛退役）
        const outcome = deps.sessions.submitPrompt({
          sessionId,
          content: submit.value.text,
          messageId: submit.value.messageId,
        });
        sendJson(res, 200, { sessionId: outcome.sessionId });
      } catch (err) {
        // 幂等冲突 fail-loud：SPA 重试携同 messageId 异内容时桥 admit 抛
        // SDK_MESSAGE_CONFLICT——折 409 结构码（sdk 面 HTTP_STATUS_BY_CODE
        // 码表同义跨面一致；BaseError 码不吞、message 人读因透传，tiers
        // PUT catch 同形）；其余异常如实上抛走面级 500（未知码不误折 400）
        if (err instanceof BaseError && err.code === 'SDK_MESSAGE_CONFLICT') {
          sendError(res, 409, err.code, err.message);
          return;
        }
        throw err;
      }
    },
  });
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.sessionInterrupt,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话缺席');
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      deps.sessions.interruptSession(sessionId);
      res.writeHead(204).end();
    },
  });

  // —— 审批族 ——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.approvals,
    auth: tokenOrCookie,
    handler: (req, res) => {
      const filter = queryOf(req).get('sessionId');
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
      sendJson(res, 200, { approvals: list });
    },
  });
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.approvalsDecide,
    auth: tokenOrCookie,
    bodyLimitBytes,
    handler: async (req, res, ctx) => {
      const body = await ctx.readBody(req);
      if (!body.ok) return sendError(res, body.status, 'too_large', body.message);
      const parsed = parseJson(body.body);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const decide = validate<{ answer: ApprovalAskAnswer; note?: string }>(DecideSchema, parsed.value, 'decide 体');
      if (!decide.ok) return sendError(res, 400, 'bad_request', decide.reason);
      // 只 resolve pending resolver（绝不直接写 durable——decided durable 写
      // 唯一保留在 ask() 汇流点；后到/未知 = superseded 幂等回执）
      const outcome = decideApproval(ctx.params.approvalId!, decide.value.answer);
      sendJson(res, 200, { outcome });
    },
  });

  // —— 补全族（两段——注入面缺席诚实空）——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.workspaceFiles,
    auth: tokenOrCookie,
    handler: (req, res) => {
      const q = queryOf(req).get('q') ?? '';
      sendJson(res, 200, { items: deps.completion?.workspaceFiles?.(q) ?? [] });
    },
  });
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.workspaceSymbols,
    auth: tokenOrCookie,
    handler: (req, res) => {
      const q = queryOf(req).get('q') ?? '';
      sendJson(res, 200, { items: deps.completion?.workspaceSymbols?.(q) ?? [] });
    },
  });

  // —— /api 兜底（鉴权先行语义维持：未知 /api 路径过鉴权门后 404——防 SPA
  //    fallback 吞程序面打错路径；GET/POST 双形，其余 method 落面级 404）——
  add({
    method: 'GET',
    path: '/api/*',
    auth: tokenOrCookie,
    handler: (_req, res) => sendError(res, 404, 'not_found', '未知 API 路由'),
  });
  add({
    method: 'POST',
    path: '/api/*',
    auth: tokenOrCookie,
    handler: (_req, res) => sendError(res, 404, 'not_found', '未知 API 路由'),
  });

  // —— SPA 静态面（open/static-shell——壳先于鉴权必须可载，壳无 API 即惰性；
  //    GET/HEAD 双形；注册序在 /api/* 之后 = /api 射界先由兜底圈占）——
  add({
    method: 'GET',
    path: '*',
    auth: { mode: 'open', purpose: 'static-shell' },
    handler: (_req, res, ctx) => {
      void serveStatic(res, ctx.wildcard ?? '').catch((err: unknown) => {
        warn(`webui 静态面处理异常：${err instanceof Error ? err.message : String(err)}`);
        if (!res.writableEnded) sendError(res, 500, 'internal');
      });
    },
  });
  add({
    method: 'HEAD',
    path: '*',
    auth: { mode: 'open', purpose: 'static-shell' },
    handler: (_req, res, ctx) => {
      void serveStatic(res, ctx.wildcard ?? '').catch((err: unknown) => {
        warn(`webui 静态面处理异常：${err instanceof Error ? err.message : String(err)}`);
        if (!res.writableEnded) sendError(res, 500, 'internal');
      });
    },
  });

  return {
    backend,
    detach: () => {
      // 收场序：全路由摘除 → 全流收口（面级流随 res 终结）→ 审批清槽
      // （**丢弃性结算——不 resolve**：未决条目不凭空造值抢答；败腿 promise
      // 悬挂由核 finish/队列收口吸收——行回卷语义）
      for (const detach of detachers.splice(0)) detach();
      for (const entry of [...streams]) entry.stream.close();
      pending.clear();
    },
  };
}
