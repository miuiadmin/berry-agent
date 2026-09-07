/**
 * sdk/types — core:sdk HTTP 面契约（批 13e-1 契约先行）。
 *
 * 词面单源：端点路由与协议头（03 §10.6 批 13e 落码定形注①）/ 开面配置形
 * （07 §5 serve 旗标族落码定名注——sock 缺省接入点、TCP 可选位、凭证 env
 * 双载体三名）均在本件定形，传输实装（13e-2）与 daemon 装配（13e-3）只
 * 消费不复制。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SdkWireDeps } from '../channels/index.js';

/** HTTP 端点路由词面（03 §10.6 差异面①/批 13e 定形：程序调用面五 POST/GET + SSE 建立位） */
export const SDK_HTTP_ENDPOINTS = {
  /** POST——prompt 新发（sessionId 缺席即新建） */
  prompt: '/v1/prompt',
  /** POST——interrupt（无应答档 HTTP 形 = 204 空体） */
  interrupt: '/v1/interrupt',
  /** POST——审批应答（跨入口竞速回执） */
  decide: '/v1/decide',
  /** POST——断线对账读面（since 窗口 (since, 高水位]） */
  entries: '/v1/entries',
  /** GET——会话清单 */
  sessions: '/v1/sessions',
  /** GET SSE——事件流建立位（即 hello 动词的 HTTP 承载：sessionId/after/noDelta 入查询参） */
  events: '/v1/events',
} as const;

/** 协议版本头名（HTTP 无连接级 hello 位——每请求携版本，不符即 400 SDK_PROTOCOL_MISMATCH） */
export const SDK_PROTOCOL_HEADER = 'x-sdk-protocol';

/** 鉴权头（10.4「监听 ⇒ 鉴权」恒在场——Bearer 形携 token） */
export const SDK_AUTH_HEADER = 'authorization';

/** TCP 监听位形（单监听 spec——config.tcp 收单形或数组，内部归一数组执法） */
export interface SdkTcpListenSpec {
  readonly host: string;
  readonly port: number;
}

/**
 * sdk HTTP 面开面配置（07 §5 落码定名批 13e；18a-1' 多监听扩形——03 §10.6
 * 路由扩展位段「sock 可缺席 + TCP×N」）。
 *
 * 监听器族多监听并存：sock 可选（缺席 = 不开——webui 人面 --port 独占 TCP 形
 * 时 daemon 可无 sock）；TCP 侧收单形或数组（归一执法）。非回环 host 必配
 * 凭证 fail-closed 拒启（03 §10.6 差异面③「非回环 ⇒ 必配鉴权凭证」不豁免）。
 */
export interface SdkHttpListenConfig {
  /** Unix-domain socket 监听路径（daemon 形缺省接入点——02 数据域表 serve/ 行；可选化：缺席不开 sock） */
  readonly socketPath?: string;
  /** TCP 可选位（--sdk-port/--sdk-host 或 env 双载体；单形或数组形——缺席 = 不开 TCP） */
  readonly tcp?: SdkTcpListenSpec | readonly SdkTcpListenSpec[];
  /**
   * 预置共享密钥（BERRY_AGENT_SDK_TOKEN——差异面⑤ env 载体）。缺席 = 监听面
   * 自足生成进程内一次性 token（只存内存不落盘），经披露面出（daemon 形 =
   * daemon 日志文件 / 前台形 = stderr）。
   */
  readonly token?: string;
}

/** 13e-2 传输实装的装配注入面（宿主装配桥同形——decideApproval/onSubscribed 后端自持、sink 传输自持；件不 import 宿主） */
export type SdkHttpBridge = Omit<SdkWireDeps, 'decideApproval' | 'onSubscribed' | 'sink'>;

/** 心跳看门狗节拍（10.4 同律：SSE 注释行 ping 每 30s + 写侧 90s 判死） */
export const SDK_SSE_PING_INTERVAL_MS = 30_000;

/** SSE 写侧看门狗判死窗（ping 写失败或写超时即 reap 连接——读侧判死不可实施） */
export const SDK_SSE_WRITE_TIMEOUT_MS = 90_000;

/* ---------------- 路由扩展位契约（18a-1'；03 §10.6 路由扩展位段——2026-09-07 webui 插件化批） ---------------- */

/**
 * open 档合法语义位闭集（射界枚举钉死——注册期白名单校验、越界即拒 fail-loud，
 * 代码可执法非仅冷读审读）：
 * - `liveness`——探活（GET /api/health 形：零敏感面应答）；
 * - `auth-exchange`——鉴权换证（POST /api/auth 形：token 换 cookie 桥）；
 * - `static-shell`——静态壳（SPA 静态面 + fallback：壳先于鉴权必须可载）。
 */
export const SDK_ROUTE_OPEN_PURPOSES = ['liveness', 'auth-exchange', 'static-shell'] as const;

/** open 档语义位（闭集成员——SDK_ROUTE_OPEN_PURPOSES 单源） */
export type SdkRouteOpenPurpose = (typeof SDK_ROUTE_OPEN_PURPOSES)[number];

/**
 * 扩展路由鉴权档（四值——03 §10.6）：
 * - `'token'`——Bearer 判（面 token 验换位 verifyToken 常时比对）；
 * - `{mode:'token-or-cookie', cookie}`——Bearer ∪ HttpOnly cookie 双通道（EventSource
 *   结构性无 Authorization 头——浏览器侧唯一凭证通道；恒时比对）；
 * - `{mode:'open', purpose}`——跳 token 闸（射界枚举钉死三类语义位——注册期校验）；
 * - `'self'`——跳面 token 闸、件侧自验（issue webhook HMAC 位——Host/Origin 防线
 *   仍面级先行，self 只跳 token 闸）。
 */
export type SdkRouteAuth =
  | 'token'
  | { readonly mode: 'token-or-cookie'; readonly cookie: string }
  | { readonly mode: 'open'; readonly purpose: SdkRouteOpenPurpose }
  | 'self';

/** 面级 SSE 流（openSse 产物——write 即 `data: <单行 JSON>` 帧合成钉死；close 幂等） */
export interface SdkRouteSseStream {
  /** 帧写入（载荷整体单次 JSON.stringify 单行——禁手工拼帧）；背压期 droppable 载荷 shedding */
  write(data: unknown): void;
  /** 终结（幂等——连接 close / 看门狗 / 宿主 stop 三路共用） */
  close(): void;
}

/** openSse 选项（背压 shedding 谓词注入——各消费面自定可丢档） */
export interface SdkRouteSseOptions {
  /** 背压期可丢判据（缺席 = 不 shedding——线控/关键帧永不丢档） */
  readonly droppable?: (data: unknown) => boolean;
}

/** ctx.readBody 结果（排空纪律内含——超帽 ok:false 在体收完后才返回） */
export type SdkRouteBodyResult =
  { readonly ok: true; readonly body: string } | { readonly ok: false; readonly status: 413; readonly message: string };

/** 扩展路由 handler 上下文（面级 helper 单源——03 §10.6「面级 helper ctx 单源」） */
export interface SdkRouteContext {
  /** `:param` 段提取（匹配期注入——非参数路由恒空对象） */
  readonly params: Readonly<Record<string, string>>;
  /** catch-all 尾吞的原始路径形（非 catch-all 路由恒 undefined；SPA fallback 承载位） */
  readonly wildcard: string | undefined;
  /** 面级 SSE 开流（帧形单行 JSON/ping 30s/写侧看门狗 90s/shedding 谓词注入/幂等 close——面 stop 全流收口） */
  openSse(res: ServerResponse, opts?: SdkRouteSseOptions): SdkRouteSseStream;
  /** 读请求体（排空纪律——超帽 413 永不早于请求体收完防连接池 RST 连坐；帽 = descriptor.bodyLimitBytes ?? 面缺省） */
  readBody(req: IncomingMessage): Promise<SdkRouteBodyResult>;
  /** 面 token 验换（sha256 摘要恒长 + timingSafeEqual——面 token 唯一验换位；cookie 桥/Bearer 共用） */
  verifyToken(value: string): boolean;
}

/** 扩展路由 handler（三参定形——03 §10.6 路由描述符条款） */
export type SdkRouteHandler = (req: IncomingMessage, res: ServerResponse, ctx: SdkRouteContext) => void | Promise<void>;

/** 路由描述符（03 §10.6——path 段式 `:param` + 至多一枚 catch-all 通配尾 `*`） */
export interface SdkRouteDescriptor {
  /** HTTP 方法（method+path 双键匹配） */
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  /** 段式路径：`/api/sessions/:id/submit` 形；`*` 单独成 path = 吞一切（SPA fallback）；`/*` 尾 = 吞余段 */
  readonly path: string;
  /** 鉴权档（四值——SdkRouteAuth） */
  readonly auth: SdkRouteAuth;
  /** 恒回环可达标记（非回环 TCP 监听器不挂载——404 同未注册 + start warn；sock/回环 TCP 挂全路由） */
  readonly loopbackOnly?: boolean;
  /** per-route 请求体帽（缺席 = 面缺省 10 MiB；webui 族 256KiB 位） */
  readonly bodyLimitBytes?: number;
  readonly handler: SdkRouteHandler;
}

/** 路由注册器（两注册入口共享：SdkHttpFaceOptions.routes 构造期 + handle.register 晚注册——claim 桥同款晚绑）；返摘除 fn */
export type SdkRouteRegistrar = (descriptor: SdkRouteDescriptor) => () => void;
