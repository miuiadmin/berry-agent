/**
 * webui/server — Web 通道路由实装（03 §10.4 批 18a-2' 改形；批 18a-1 传输
 * 实装 → 承载位改注册）。
 *
 * **承载位改注册（18a-2'——03 §10.4 改形注记 + §10.6 路由扩展位段）**：
 * 件零自持 node:http 监听——mountWebui(deps) 把六撮 19 端点（2026-09-18
 * webui 档位面受理批 14→17 会话族档位三端点 + 2026-10-07 会话删除编排批
 * 17→18 DELETE 删除端点 + 2026-10-08 剪贴板附件批 18→19 附件读回端点）
 * + SPA fallback 逐条
 * 注册进注入的注册器（sdk 面注册器结构兼容）。归面级的四块（原自持
 * 已删）：三防线（Host 白名单/Origin 硬防线——面级先行适用于一切路由，仅
 * TCP）/ token 鉴权执法（token-or-cookie 档 Bearer ∪ cookie 双通道、恒时
 * 比对——面 token 唯一验换位 ctx.verifyToken）/ POST 体帽与排空纪律
 * （ctx.readBody——超帽 413 永不早于体收完）/ SSE 单流基建（帧形/ping/
 * 看门狗/shedding——ctx.openSse 注入件侧可丢判据）。
 *
 * 件内维持位（§10.4 改形注②-⑦语义全保）：
 * - **backend**：UiBackend 第四实装（claim 桥）。审批腿**进程作用域语义**
 *   （定形注④——与 SDK 腿「连接作用域无订阅者即 unavailable」分立〔edf2e83
 *   语义迁后词：SDK 腿无订阅者/连接收口两路 2026-09-13 由误答 cancel 改判
 *   unavailable，原句「无订阅即 cancel」陈化随迁〕）：开面在场即持应答
 *   能力、不采无连接即时落值（cancel/unavailable 皆不采——纯 webui 无
 *   浏览器时 ask 挂起至 run 打断/会话收口）；败腿/撤销经 signal abort 清槽
 *   （abort 恒后于竞速落定——UiCore finish 内序，不构成抢答）。
 * - **SSE 信封三族**：分档判据注②（终结型两型 + asked 镜像 → session 族，
 *   其余活体 → display 族）；连接即当下（v1 无重放游标——正确性层 = 客户端
 *   onopen 恒重拉投影）；受理尾补发一帧最近 status 信封快照（订阅建流即
 *   对齐——03 §10.6 ② 2026-10-04 注：断连窗丢 agent_end 的重连观众状态行
 *   当前值对齐+打断键使能面供数，run 账终态复位半边系呈拍缺口〔卡③——
 *   run 终态 setStatus 生产者缺席〕；词汇零新增原帧复播，closed 空流恒静默
 *   不破）；全局连接帽 16
 *   件侧自记账（面级 openStreams 不暴露
 *   计数）超帽 503；背压 shedding 判据 = display 的 update 两型（session/
 *   notify/status 镜像帧不弃）。
 * - **微路由语义**：会话存在性分账（missing submit/events/messages/todo
 *   404 not_found / closed submit 404 closed；messages/todo 不受闭态拦——
 *   缺席仍 404 分账；closed events 放行空流）；cookie 桥注③（体 {token} 经面级 verifyToken 验换 → Set-Cookie
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
 * - **DELETE 删除端点**（2026-10-07 会话删除编排批——webui 第三载体）：501
 *   缺席判先于三态分账（GET /export 先例同序）；deleted→200 / busy→409
 *   error 词 busy（message 与 TUI 确认视图状态行主体同句）/ missing→404
 *   not_found；已闭可删（存储编排面——无 sessionStateOf 前置拦，与 tiers
 *   「已闭一律 404」射界分立）；SSE 在飞观众零动作（空 ping 至客户端自断）。
 * - **剪贴板附件批三面**（2026-10-08——03 §10.4 ①④⑥）：submit 扩 images
 *   选填数组（{data, mimeType} 逐件 strict——受理执法全在 host 桥受理链，
 *   件侧零实现只透传；受理拒 = 携 status 400 异常上抛，件侧窄 catch 折
 *   400 bad_request 文案透传——五族文案单源住 host）；submit 体帽显式
 *   32MiB（4 件 × 5MiB × base64 4/3 膨胀 + 文本余量——per-route 覆写，
 *   挂载缺省帽不外泄）；GET /api/attachments/:ref 附件字节回放（判序
 *   400→501→404→200——/export 同序律：词法错先于状态错、注入键缺席先于
 *   资源不在场；Content-Type 由读回记录 mimeType 单源派生）；GET messages
 *   投影 images 位（user 行 image-ref 块映射 {ref, mimeType}[] 保序——引用
 *   形不回传 base64，rehydrate 单源在 convertToLlm 不动）。
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
  WEBUI_SUBMIT_BODY_LIMIT_BYTES,
  type WebuiApprovalEntry,
  type WebuiEnvelope,
  type WebuiMessageImage,
  type WebuiMountDeps,
  type WebuiMountHandle,
  type WebuiMountOptions,
  type WebuiRouteAuth,
  type WebuiRouteDescriptor,
  type WebuiRouteSseStream,
} from './types.js';

/* ---------------- typebox 校验（03 §10.4「JSON 均 typebox 校验后消费」） ---------------- */

/** 附件 ref 词法形（剪贴板附件批 03 §10.4 ④——`sha256:` + 64 位小写十六进制；
 * 与 persist attachment-store 同形本地重述：词面独立律下 webui 无 persist 边，
 * 单一真源在 persist、此处是消费侧防线形〔两端形漂移由 host 桥装配层对拍〕） */
const ATTACHMENT_REF_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** 公共字段词面：未知字段拒收（收窄律——请求面载荷即全集） */
const strict = { additionalProperties: false } as const;

/** auth 体（cookie 桥——token 必填） */
const AuthSchema = Type.Object({ token: Type.String() }, strict);

/** submit 体单图成员（剪贴板附件批 03 §10.4 ①——恰两字段收窄：data =
 *  base64 原文、mimeType = 声明 MIME〔受理链与魔数嗅探核验，勿信声明〕；
 *  与 channels PromptImageSchema 同形——形漂移由本件测试对拍锁执法〔挖掘
 *  20 轮件3 补锁〕） */
export const SubmitImageSchema = Type.Object({ data: Type.String(), mimeType: Type.String() }, strict);

/** submit 体（text 必填；messageId 选填 = SPA 重试幂等位——缺席即 undefined
 * 透传、件侧不补生成〔8572ccd 拍板——与 SDK 线同律：undefined 无幂等不落账〕；
 * images 选填 = 粘贴图族〔03 §10.4 ①〕：缺席/空数组 = 纯文本零漂移，在场时
 * 原形透传入桥——受理执法〔魔数/双帽/落盘铸块〕在 host 桥受理链，件侧零实现） */
const SubmitSchema = Type.Object(
  {
    text: Type.String(),
    messageId: Type.Optional(Type.String()),
    images: Type.Optional(Type.Array(SubmitImageSchema)),
  },
  strict,
);

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
  /** 最近 status 信封缓存（sessionId → 末次 setStatus 帧——SSE 受理尾快照
   *  补发的当前值源；03 §10.6 ② 2026-10-04 订阅建流即对齐注 webui 腿）。
   *  清理面清单（缓存生命周期 = 会话生命周期——deps.sessions 无闭会话事件
   *  seam，写读收三道 + 顺带清谱收口，第九轮深扫件1）：① 写位门〔setStatus
   *  目标会话非 open 删旧不写新零扇出；写入成行后顺带清谱非 open 历史条目〕
   *  ② 读位〔events 受理尾对 closed 会话跳过快照时条目同步销账〕③ 收场位
   *  〔detach 整表 clear——会话生命周期上界 = mount 生命周期〕 */
  const lastStatusFrame = new Map<string, WebuiEnvelope>();
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
    // 状态行更新（last-writer-wins 天然——多写者扇出覆盖）；emit 时随写最近
    // status 信封缓存（受理尾快照的当前值源——现行效力 = 状态行当前值对齐
    // + 打断键使能面供数；「末次终态形随播复位 run 账」呈拍缺口，勘正注详
    // events 受理尾——第九轮深扫卡③）
    setStatus: (sessionId: string, status: string) => {
      const frame: WebuiEnvelope = { kind: 'status', sessionId, payload: { status } };
      // 写位生命周期门（清理面①）：迟到 status 的会话已闭/缺席 → 删旧不写
      // 新、零扇出（closed 空流恒静默律的 live 半边——受理尾快照面清理面②
      // 同律；missing 会话不可能有在册流，旧条目系会话删除/竞速窗残留，
      // 一并销账——第九轮深扫件1）
      if (deps.sessions.sessionStateOf(sessionId) !== 'open') {
        lastStatusFrame.delete(sessionId);
        return;
      }
      lastStatusFrame.set(sessionId, frame);
      pushToSession(sessionId, frame);
      // 写入顺带清谱（清理面①续）：setStatus 是低频写点，本写入兼作定期
      // 清理锚——非 open 态的历史条目随写销账（deps.sessions 无闭会话事件
      // seam 下的生命周期近似收口：每次写入后缓存 ≤ 在册 open 会话数 + 1，
      // 已闭/已删会话条目的无界增长面就此封死）
      for (const cachedId of lastStatusFrame.keys()) {
        if (deps.sessions.sessionStateOf(cachedId) !== 'open') lastStatusFrame.delete(cachedId);
      }
    },
    // 活体信封呈现（focused 位无 webui 语义——SPA 自选视图，无聚焦降档）
    onEnvelope: (env: SessionEnvelope) => {
      // 分档判据（批 18a 定形注②）：终结型两型落 durable → session 镜像族；
      // 其余活体 → display 族
      const terminal = env.event.type === 'message_end' || env.event.type === 'tool_execution_end';
      if (!terminal) {
        pushToSession(env.sessionId, { kind: 'display', sessionId: env.sessionId, payload: env.event });
        return;
      }
      // 卡② 腿②（03 §10.4 卡② 定谳版「信封载荷腿」）：seq 挂 session 族
      // 信封帧外层（帧外挂位——payload 逐字镜像不动）；对账消费位唯
      // message_end，tool_execution_end 不扩。tailSeqOf seam 缺席/无驱动/
      // 空日志（undefined）时不挂键——降级形（客户端逐行判据走回退路）。
      const seq =
        env.event.type === 'message_end' && deps.tailSeqOf !== undefined ? deps.tailSeqOf(env.sessionId) : undefined;
      pushToSession(env.sessionId, {
        kind: 'session',
        sessionId: env.sessionId,
        payload: env.event,
        ...(seq !== undefined ? { seq } : {}),
      });
    },
    askApproval: (sessionId: string, request, opts) =>
      new Promise<ApprovalAskAnswer>((resolve) => {
        // 进程作用域语义（定形注④）：不采无连接即时落值（cancel/unavailable
        // 皆不采）——开面在场即持应答能力，浏览器迟到也可应答；纯 webui 无
        // 浏览器时 ask 挂起至 run 打断/会话收口（核保守值兜底）。
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
      sendError(res, 404, 'no_spa', '网页界面未启用（当前为 API-only 形态）');
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
      sendError(res, 403, 'forbidden', '路径超出静态文件目录范围');
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
        sendError(res, 404, 'no_spa', '网页界面缺 index.html（无法打开页面）');
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

  /* ---- 路由族注册（六撮 19 端点〔2026-09-18 档位面 14→17 + 2026-10-07 会话删除批 17→18 + 2026-10-08 剪贴板附件批 18→19〕+ /api 兜底 + SPA fallback——全族 loopbackOnly） ---- */

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
    handler: (_req, res) =>
      // B2 截断披露：total = 全量计数（与清单窗分立——超窗可感知）
      sendJson(res, 200, { sessions: deps.sessions.listSessions(), total: deps.sessions.countSessions() }),
  });
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.sessions,
    auth: tokenOrCookie,
    handler: (_req, res) => sendJson(res, 200, { sessionId: deps.sessions.createSession() }),
  });

  // —— 会话族子路由（存在性分账注⑥：missing submit/events/messages/todo
  //    一律 404 not_found——todo 位于第九轮深扫件2补齐；closed submit 404
  //    closed、messages/todo 放行只读腿（closed 兜底可拉）；events closed
  //    放行空流；submit/interrupt 受闭态拦）——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionMessages,
    auth: tokenOrCookie,
    handler: async (_req, res, ctx) => {
      // 存在性分账（events 位镜像——03 §10.4 定形注⑥「GET messages 先例
      // 同词」）：missing → 404 not_found（第八轮深扫件F1——修前无此检查，
      // 真链 fetchMessages→loadSession 对缺席会话抛 PERSIST_DATA_CORRUPT
      // 走面级 500，存在性错误误报为内部错误）
      if (deps.sessions.sessionStateOf(ctx.params.id!) === 'missing') {
        sendError(res, 404, 'not_found', '会话不存在');
        return;
      }
      // 近史投影兜底可拉（closed 会话同样可拉——只读腿）
      const messages = await deps.read.fetchMessages(ctx.params.id!);
      // 投影 images 位（03 §10.4 ⑥）：user 消息 content 块数组中的 image-ref
      // 引用块映射为 {ref, mimeType}[]（保序、有图才注键）——GET 读面局部
      // 增位：Message 契约形不动、content 块数组原样在场（rehydrate 单源在
      // convertToLlm 不动），images 位只是 SPA 画图的引用形便利位（字节取用
      // 走附件端点）；assistant 行与纯文本行零 images 键（缺省形非 null 占位）
      const items = messages.map((m) => {
        if (m.role !== 'user' || !Array.isArray(m.content)) return m;
        const images: WebuiMessageImage[] = [];
        for (const block of m.content) {
          if (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'image-ref') {
            const ref = block as { ref: string; mimeType: string };
            images.push({ ref: ref.ref, mimeType: ref.mimeType });
          }
        }
        return images.length === 0 ? m : { ...m, images };
      });
      sendJson(res, 200, { messages: items });
    },
  });
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionTodo,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      // 存在性分账（第九轮深扫件2——messages 位同词对齐：修前对 missing
      // 会话回 200 {items:null}，缺席会话被虚报为「无数据源」档；messages
      // 端点 404 分账〔第八轮件F1〕后 API 面唯一遗留不一致端点，03 §10.4
      // 定形注⑥「GET messages 先例同词」射界补全）
      if (deps.sessions.sessionStateOf(ctx.params.id!) === 'missing') {
        sendError(res, 404, 'not_found', '会话不存在');
        return;
      }
      const items = deps.read.todoOf?.(ctx.params.id!);
      sendJson(res, 200, { items: items ?? null }); // null = 无数据源（诚实不虚报）
    },
  });
  // —— 会话族子路由：/export 直出（2026-09-17 TUI 余量收官批② markdown 形；
  //    2026-10-07 对偶面第三载体批增 format 查询参——markdown|jsonl 两形，判
  //    序钉死 400→501→404〔03 §10.4 批注：词法错先于状态错——请求本身坏比
  //    能力/资源缺席更根本；501 先于 404 序维持〕）。应答体 = 正文直出
  //    **不落盘**（web 面消费语义 = 浏览器/curl 直接取文；TUI /export 落盘形
  //    与 CLI 形不变）；拼装单源 = host 桥真身注入的 exportMarkdown/
  //    exportJsonl（renderSessionMarkdown 第三消费位 / renderSessionJsonl
  //    第二消费位）——注入窄面缺席 = 501 诚实缺席；会话缺席 = 404 not_found
  //    同族；已闭会话 = 兜底照常返体（读面语义同 messages——只读腿不受闭态拦）
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.sessionExport,
    auth: tokenOrCookie,
    handler: (req, res, ctx) => {
      const format = queryOf(req).get('format') ?? 'markdown'; // 零参 = markdown（既有调用面零漂移）
      if (format !== 'markdown' && format !== 'jsonl') {
        sendError(res, 400, 'bad_request', '不支持的导出格式（format 须是 markdown 或 jsonl）');
        return;
      }
      if (format === 'jsonl') {
        // jsonl 形：事件级金样 JSONL 直出（application/x-ndjson；直出不落盘、
        // 零 Content-Disposition——与 markdown 形对称，下载文件名客户端自持）
        const exportJsonl = deps.read.exportJsonl;
        if (exportJsonl === undefined) {
          sendError(res, 501, 'not_implemented', '会话导出未启用（当前运行形态不含此功能）');
          return;
        }
        const body = exportJsonl(ctx.params.id!);
        if (body === undefined) {
          sendError(res, 404, 'not_found', '会话不存在');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
        res.end(body);
        return;
      }
      // markdown 既有路（零漂移——exportMarkdown 501/404/text-markdown; charset=utf-8 直出）
      const exportMarkdown = deps.read.exportMarkdown;
      if (exportMarkdown === undefined) {
        sendError(res, 501, 'not_implemented', '会话导出未启用（当前运行形态不含此功能）');
        return;
      }
      const markdown = exportMarkdown(ctx.params.id!);
      if (markdown === undefined) {
        sendError(res, 404, 'not_found', '会话不存在');
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
        sendError(res, 501, 'not_implemented', '级别/模式设置未启用（当前运行形态不含此功能）');
        return;
      }
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话不存在');
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
        sendError(res, 501, 'not_implemented', '级别/模式设置未启用（当前运行形态不含此功能）');
        return;
      }
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话不存在');
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
        sendError(res, 501, 'not_implemented', '级别/模式设置未启用（当前运行形态不含此功能）');
        return;
      }
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话不存在');
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
        sendError(res, 404, 'not_found', '会话不存在');
        return;
      }
      // closed 会话放行（空流形——近史走 messages 兜底，流恒静默无假帧）
      if (streams.size >= maxConnections) {
        sendError(res, 503, 'overloaded', `SSE 连接数已达上限（上限 ${maxConnections}）`);
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
      // 受理尾 status 快照补发（订阅建流即对齐——03 §10.6 ② 2026-10-04 注
      // webui SSE 面同律）：断连窗丢 agent_end 的重连观众由此收当前 status
      // 信封（词汇零新增——setStatus 既有 session-scoped status 帧原帧复播）。
      // 现行效力 = 状态行当前值对齐 + 打断键使能面供数两桩（第九轮深扫卡③
      // 勘正：「run 已收口时末次终态形随播复位 run 账」结构性不成立——全库
      // setStatus 生产者仅切档回执〔host webui-bridge/tui-entry 两装配位〕
      // + 插件 ctx.ui 透传位，无 run 终态 setStatus 生产者，末次帧恰为终态
      // 词的形在现产线不可达；run 终态 setStatus 生产者已拍维持现状〔2026-10-04
      // 第十一轮收官呈拍卡③〕——终态语义由 agent_end 收尾行等帧承载，不补
      // setStatus 终态词生产者〔防双生产者双源〕，本补发腿效力维持状态行对齐 +
      // 打断键使能面供数两桩定谳）。从未 setStatus 诚实零帧；closed 会话不补发
      // （空流形恒静默既有律——不造假帧）
      if (deps.sessions.sessionStateOf(sessionId) !== 'closed') {
        const snapshot = lastStatusFrame.get(sessionId);
        if (snapshot !== undefined) stream.write(snapshot);
      } else {
        // 读位销账（清理面②——第九轮深扫件1）：closed 会话的快照永不再供数
        // （本受理尾与后续一切读点），条目随读清除（空流静默律不动，只清缓存账）
        lastStatusFrame.delete(sessionId);
      }
    },
  });
  add({
    method: 'POST',
    path: WEBUI_ENDPOINTS.sessionSubmit,
    auth: tokenOrCookie,
    // 体帽显式 32MiB（剪贴板附件批 03 §10.4 ①——per-route 覆写缺省 256KiB：
    // images 携图载荷预算 4 件 × 5MiB × base64 4/3 膨胀 + 文本余量；挂载
    // 缺省帽与 sdk 面 10MiB 均不外泄到本端点，tiers PUT 显式设值同律——冷读 F2）
    bodyLimitBytes: WEBUI_SUBMIT_BODY_LIMIT_BYTES,
    handler: async (req, res, ctx) => {
      const sessionId = ctx.params.id!;
      const state = deps.sessions.sessionStateOf(sessionId);
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话不存在');
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      const body = await ctx.readBody(req);
      if (!body.ok) return sendError(res, body.status, 'too_large', body.message);
      const parsed = parseJson(body.body);
      if (!parsed.ok) return sendError(res, 400, 'bad_request', parsed.reason);
      const submit = validate<{ text: string; messageId?: string; images?: { data: string; mimeType: string }[] }>(
        SubmitSchema,
        parsed.value,
        'submit 体',
      );
      if (!submit.ok) return sendError(res, 400, 'bad_request', submit.reason);
      try {
        // messageId 缺席即 undefined 透传（8572ccd 拍板：件侧不再补生成——
        // undefined = 无幂等不落账，桥侧容忍形 18a3cf8 已就位；生成键旁路
        // 与 submitSeq 计数位随本收敛退役）；images 原形透传（03 §10.4 ①——
        // 受理执法在 host 桥受理链：能力门→数量帽→base64→字节帽→魔数→
        // MIME→像素帽→落盘铸 image-ref 块；件侧零实现零复制）
        const outcome = deps.sessions.submitPrompt({
          sessionId,
          content: submit.value.text,
          messageId: submit.value.messageId,
          images: submit.value.images,
        });
        sendJson(res, 200, { sessionId: outcome.sessionId });
      } catch (err) {
        // 竞窗收口窄 catch（挖掘 20 轮）：桥 submitPrompt 前置复检（isOpen
        // 再判）对本端点先决门与受理之间的删除竞窗 fail-loud 抛
        // SESSION_NOT_FOUND——折 404 not_found 与先决门 missing 档同档
        // （码不吞、message 人读因透传——SDK_MESSAGE_CONFLICT catch 同形）
        if (err instanceof BaseError && err.code === 'SESSION_NOT_FOUND') {
          sendError(res, 404, 'not_found', err.message);
          return;
        }
        // 幂等冲突 fail-loud：SPA 重试携同 messageId 异内容时桥 admit 抛
        // SDK_MESSAGE_CONFLICT——折 409 结构码（sdk 面 HTTP_STATUS_BY_CODE
        // 码表同义跨面一致；BaseError 码不吞、message 人读因透传，tiers
        // PUT catch 同形）；其余异常如实上抛走面级 500（未知码不误折 400）
        if (err instanceof BaseError && err.code === 'SDK_MESSAGE_CONFLICT') {
          sendError(res, 409, err.code, err.message);
          return;
        }
        // 受理拒窄 catch（03 §10.4 ②）：host 受理链拒 = 携 status 400 的普通
        // Error（AttachmentIntakeRejectionError 鸭子形——件侧无 host 边不可
        // instanceof，status 位判据即窄面；受理拒非进程内错误轨零新码）——
        // 折 400 bad_request + 五族中文文案原样透传（文案单源住 host）。
        // 其余异常继续上抛（面级 500——不误吞进程内错误）
        if (err instanceof Error && (err as { status?: unknown }).status === 400) {
          sendError(res, 400, 'bad_request', err.message);
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
      if (state === 'missing') return sendError(res, 404, 'not_found', '会话不存在');
      if (state === 'closed') return sendError(res, 404, 'closed', '会话已闭（只读兜底）');
      deps.sessions.interruptSession(sessionId);
      res.writeHead(204).end();
    },
  });
  // —— 会话族子路由：DELETE 删除端点（2026-10-07 会话删除编排批 webui 第三
  //    载体——05 §2.5 定形注①「webui 面=挂账注记」兑现笔；零请求体、鉴权随
  //    全 API 面 token-or-cookie）——
  add({
    method: 'DELETE',
    path: WEBUI_ENDPOINTS.sessionDelete,
    auth: tokenOrCookie,
    handler: async (_req, res, ctx) => {
      // 501 缺席判先于三态分账（GET /export 先例同序——冷读 CR-TIER-2：
      // 注入窄面缺席〔API-only 形〕优先于编排回执分账，序倒置则面装配
      // 缺失被会话态遮蔽）
      const deleteSession = deps.sessions.deleteSession;
      if (deleteSession === undefined) {
        sendError(res, 501, 'not_implemented', '会话删除未启用（当前运行形态不含此功能）');
        return;
      }
      // 无 sessionStateOf 前置拦：已闭会话可删（closed 非 404 档——删除面是
      // 存储编排面，与 tiers 三端点「已闭一律 404」的活体交互面射界分立，
      // 已闭历史会话正该可删；存在性分账由编排回执 missing 态承载）
      const outcome = await deleteSession(ctx.params.id!);
      if (outcome.status === 'deleted') {
        sendJson(res, 200, { status: 'deleted' });
        return;
      }
      if (outcome.status === 'busy') {
        // 409 busy：message 人读因与 TUI 确认视图状态行主体同句（TUI 载体
        // 专属键面尾巴不随 webui）；submit 窄 catch SDK_MESSAGE_CONFLICT→409
        // 同面一致
        sendError(res, 409, 'busy', '会话正在运行——等待完成或先打断后再删');
        return;
      }
      // missing → 404 not_found（GET messages 先例同词）。
      // SSE 在飞观众零动作：busy 守卫封死在飞 run 被删；已开流不主动关灭
      //（六步编排的 unregisterSession 收提问队列+widget、不收 webui 面级
      // streams 账）——空 ping 至客户端自断；他端后续操作按既有 404 分账
      sendError(res, 404, 'not_found', '会话不存在');
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

  // —— 附件读回端点（2026-10-08 剪贴板附件批 03 §10.4 ④——SPA img 标签的
  //    字节供数位；判序钉死 400→501→404→200：词法坏形最根本、注入键缺席
  //    先于资源不在场〔/export 判序同律——序倒置则装配缺失被文件态遮蔽〕；
  //    零请求体；鉴权随全 API 面 token-or-cookie——
  add({
    method: 'GET',
    path: WEBUI_ENDPOINTS.attachments,
    auth: tokenOrCookie,
    handler: (_req, res, ctx) => {
      const ref = ctx.params.ref!;
      // ① 词法层（400）：ref 坏形 = 非 `sha256:<64hex>` 内容地址即拒，不触
      //    读回面（URL 段做路径拼接/穿越面的结构性防线——形不符即词法错）
      if (!ATTACHMENT_REF_PATTERN.test(ref)) {
        sendError(res, 400, 'bad_request', '附件标识格式不对（应为 sha256 开头的内容地址）');
        return;
      }
      // ② 注入窄面缺席（501）：readAttachment 键不注 = 附件面未装配（API-only
      //    形——exportMarkdown 缺席同精神；GET /export 先例判序）
      const readAttachment = deps.read.readAttachment;
      if (readAttachment === undefined) {
        sendError(res, 501, 'not_implemented', '附件读取未启用（当前运行形态不含此功能）');
        return;
      }
      // ③ 资源不在场（404）：合形 ref 但落盘文件不在场（清障/跨机迁移后遗留
      //    引用等）——读回 null 档诚实 404，不虚报空字节
      const record = readAttachment(ref);
      if (record === null) {
        sendError(res, 404, 'not_found', '附件不存在');
        return;
      }
      // ④ 命中（200）：字节原样回放；Content-Type 由读回记录 mimeType 单源
      //    派生（ext→MIME 映射在 persist 单源——件侧不查扩展名不二次判）
      res.writeHead(200, { 'content-type': record.mimeType }).end(record.bytes);
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
      // 收场位销账（清理面③——第九轮深扫件1）：status 快照缓存整表 clear
      // （会话生命周期上界 = mount 生命周期，收场不留守）
      lastStatusFrame.clear();
    },
  };
}
