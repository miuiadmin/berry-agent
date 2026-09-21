/**
 * webui/types — core:webui Web 通道契约（L4；02 篇 §4.1 席 25 / 03 篇 §10.4
 * 批 18a-2' 改形注记；批 18a-1 契约先行）。
 *
 * **承载位改形（18a-2'——03 §10.4 改形注记）**：件身份四件套维持（#25 席/
 * 件册 15/默认启用/dist 随包），承载位由自持 node:http 监听改为 **注册 sdk
 * 路由扩展位**（03 §10.6 路由扩展位段）——零自持监听、防线/token/体帽/排空
 * 纪律归面级单源；本件只持路由描述符族 + 微路由语义 + SSE 信封 + 跨入口
 * 审批。语义维持位（§10.4 改形注②-⑦）：信封三族分档/cookie 桥/fail-closed
 * 分立/已闭分账/注入窄面词面独立律/SPA 静态位语义全维持。
 *
 * 词面单源：端点路由（五撮具体路径——§10.4 批 18a 落码定形注①）/ 信封三族
 * kind 闭集与分档判据（注②）/ 路由注册窄面族（注⑤——WebuiRouteFace：结构
 * 兼容 sdk 路由扩展位注册器，词面独立律零 sdk import，host 装配根直传即
 * 结构兼容）/ 注入窄面族（结构兼容 host 装配桥真身，compat 互证归 host
 * 装配批）均在本件定形，路由实装（server.ts）只消费不复制。
 *
 * 边表纪律：deps = contracts + channels——AgentEvent 类型经 SessionEnvelope
 * 结构取用（webui 无 agent 边、无 sdk 边）；TodoItem/UiBackend/NotifyLevel
 * 自 channels 公开面消费（真边）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AgentMessage, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { NotifyLevel, SessionEnvelope, TodoItem, UiBackend } from '../channels/index.js';

/* ---------------- 常量（缺省值单源——03 §10.4 各条款钉死值） ---------------- */

/** 缺省端口（`--port <n>` 一次性开面——缺省 7860；装配位消费） */
export const WEBUI_DEFAULT_PORT = 7860;

/** 缺省回环绑定地址（恒回环钉死——非回环须配凭证 fail-closed 由面级 judgeListenConfig 执法） */
export const WEBUI_DEFAULT_HOST = '127.0.0.1';

/** 全局 SSE 连接帽（超帽新连接 503——件侧自记账：面级 openStreams 不暴露计数） */
export const WEBUI_MAX_CONNECTIONS = 16;

/** POST 族字节帽（256KiB——per-route bodyLimitBytes 位；超帽 413 且应答永不早于请求体收完〔面级排空纪律〕） */
export const WEBUI_BODY_LIMIT_BYTES = 256 * 1024;

/** auth cookie 桥 cookie 名（HttpOnly SameSite=Strict——EventSource 无头位；token-or-cookie 档位） */
export const WEBUI_COOKIE_NAME = 'webui_token';

/**
 * 微路由端点表（五撮——03 §10.4 批 18a 落码定形注①定形；SPA fallback 承载位 = 单 `*` catch-all）。
 * 2026-09-18 webui 档位面受理批：会话族增档位三端点（GET tiers + 两 PUT）——
 * 路径 13→16、端点计数（method×path）14→17（03 §10.4「端点计数口径」句以后注为准）。
 */
export const WEBUI_ENDPOINTS = {
  /** GET——探活（open/liveness；只回 ok 零敏感面） */
  health: '/api/health',
  /** POST——auth cookie 桥（open/auth-exchange；体 {token} → Set-Cookie） */
  auth: '/api/auth',
  /** GET——会话清单 / POST——开新 */
  sessions: '/api/sessions',
  /** GET——投影拉取（近史正文——正确性层真源） */
  sessionMessages: '/api/sessions/:id/messages',
  /** GET SSE——活体流（连接即当下，v1 无重放游标） */
  sessionEvents: '/api/sessions/:id/events',
  /** POST——提交（体 {text, messageId?}） */
  sessionSubmit: '/api/sessions/:id/submit',
  /** POST——打断在飞 run */
  sessionInterrupt: '/api/sessions/:id/interrupt',
  /** GET——todo 数据源（goal 计划态呈现投影） */
  sessionTodo: '/api/sessions/:id/todo',
  /** GET——会话导出 markdown 直出（不落盘——2026-09-17 TUI 余量收官批②） */
  sessionExport: '/api/sessions/:id/export',
  /** GET——档位面读（当前档 + 两行集——词表/行文案单源服务端，SPA 零硬编码；2026-09-18 webui 档位面受理批） */
  sessionTiers: '/api/sessions/:id/tiers',
  /** PUT——切 thinking 档（体 {level}——应答 {receipt}；回执文案与 TUI setStatus 同文单源） */
  sessionThinkingLevel: '/api/sessions/:id/thinking-level',
  /** PUT——切 sandbox 档（体 {mode}——应答 {receipt}；danger 行警示语 07 §4.1 钉死措辞在行文案表内） */
  sessionSandboxMode: '/api/sessions/:id/sandbox-mode',
  /** GET——审批清单（?sessionId= 过滤，缺省全量） */
  approvals: '/api/approvals',
  /** POST——审批应答（体 {answer, note?}——跨入口竞速回执） */
  approvalsDecide: '/api/approvals/:approvalId/decide',
  /** GET——补全族两段之一（?q= 前缀查询） */
  workspaceFiles: '/api/workspace/files',
  /** GET——补全族两段之二（?q= 前缀查询） */
  workspaceSymbols: '/api/workspace/symbols',
} as const;

/* ---------------- 信封三族（帧合成钉死：载荷恒整体单次 JSON.stringify） ---------------- */

/** 终结型 AgentEvent（落 durable 的两型——session 镜像族载荷） */
export type WebuiTerminalEvent = Extract<SessionEnvelope['event'], { type: 'message_end' | 'tool_execution_end' }>;

/**
 * 审批 asked 镜像载荷（零新词汇——形复用 durable `approval/asked` 词汇；
 * 03 §10.4 批 18a 落码定形注②）。
 */
export interface WebuiApprovalAskedPayload {
  readonly type: 'approval/asked';
  readonly approvalId: string;
  readonly summary: string;
  readonly reason?: string;
  readonly toolName?: string;
  readonly suggestedEntry?: string;
}

/**
 * SSE 信封三族（03 §10.4）：`session`（durable 事件镜像）/ `display`（活体
 * 事件信封流）/ `notify`·`status`。分档判据：终结型（message_end/
 * tool_execution_end）与 asked 镜像 → session 族，其余活体 → display 族。
 */
export type WebuiEnvelope =
  | {
      readonly kind: 'session';
      readonly sessionId: string;
      readonly payload: WebuiTerminalEvent | WebuiApprovalAskedPayload;
    }
  | { readonly kind: 'display'; readonly sessionId: string; readonly payload: SessionEnvelope['event'] }
  | { readonly kind: 'notify'; readonly payload: { readonly message: string; readonly level?: NotifyLevel } }
  | { readonly kind: 'status'; readonly sessionId: string; readonly payload: { readonly status: string } };

/* ---------------- 注入窄面族（词面独立律——结构兼容 host 装配桥真身） ---------------- */

/** 会话清单条目（结构兼容 host 装配桥 sessions 行——词面独立律） */
export interface WebuiSessionSummary {
  readonly id: string;
  /** 无标题会话为 null（不造占位串） */
  readonly title: string | null;
  /** 末活动时间 epoch 毫秒 */
  readonly lastActivityAt: number;
}

/** 会话状态三档（submit/events 受理门判据——装配桥映射真源） */
export type WebuiSessionState = 'open' | 'closed' | 'missing';

/** 提交载荷（messageId 选填 = SPA 重试幂等位——缺席即 undefined 透传、件侧
 * 不再补生成；undefined = 无幂等不落账，与 SDK 线同律——8572ccd 拍板句） */
export interface WebuiSubmitInput {
  readonly sessionId: string;
  readonly content: string;
  readonly messageId: string | undefined;
}

/** 会话族注入面（结构兼容 host createServeBridge 产物子集——词面独立律） */
export interface WebuiSessionsFace {
  /** 开新会话（POST /api/sessions 的执行体） */
  createSession(): string;
  listSessions(): readonly WebuiSessionSummary[];
  sessionStateOf(sessionId: string): WebuiSessionState;
  submitPrompt(input: WebuiSubmitInput): { readonly sessionId: string };
  interruptSession(sessionId: string): void;
}

/** 投影读面（fetchMessages 结构兼容 conversation 栈 projectionOf 同形） */
export interface WebuiReadFace {
  /** 近史正文投影（正确性层真源——连接即当下，历史走本腿） */
  fetchMessages(sessionId: string): Promise<readonly AgentMessage[]>;
  /** todo 数据源（缺席 = 无数据源——todo 端点诚实回 null 不虚报） */
  todoOf?(sessionId: string): readonly TodoItem[] | undefined;
  /**
   * 会话导出 markdown 拼装（2026-09-17 TUI 余量收官批②——第三消费位）：
   * 拼装真源留 host session-export 单源（webui 边表 deps 仅 contracts+
   * channels、无 session 边，纯函数不可直达——host 装配桥真身注入，
   * ServeBridgeDeps 同族词面独立律）。undefined = 会话缺席（端点 404
   * error 词 not_found 同族）；已闭会话 = 近史投影兜底照常返体（读面语义
   * 同 GET messages——只读腿不受闭态拦，兜底在 host 桥真身内）。键缺席 =
   * 端点 501 诚实缺席（API-only 形——WebuiCompletionFace? 缺席诚实空同精神）。
   */
  exportMarkdown?(sessionId: string): string | undefined;
}

/** 补全族注入面（两段——缺席诚实空，v1 装配批按需接线） */
export interface WebuiCompletionFace {
  workspaceFiles?(query: string): readonly string[];
  workspaceSymbols?(query: string): readonly string[];
}

/**
 * 会话档位注入面（2026-09-18 webui 档位面受理批——/thinking //sandbox 的
 * webui 受路兑现；07 §4.1 挂账句销账）。结构兼容 host 装配桥真身（词面
 * 独立律——WebuiReadFace.exportMarkdown 同族）：webui 只定形消费窄面，桥
 * 真身内再落 conversation 件档位切换面 append 单源（setSessionThinkingLevel /
 * setSessionMode——05 §1.1 两行写入者单源律，webui 侧零第二写入位）。
 */
export interface WebuiSessionTierFace {
  /**
   * 读当前档 + 两行集（GET tiers 执行体）。词表 = conversation THINKING_LEVELS
   * 与 safety SANDBOX_MODES 既有单源；detail 行文案 = host 侧档位文案表
   * （呈现面文案——TUI picker 装配与 webui 桥两装配面同源消费，danger 行
   * 警示语 07 §4.1 钉死措辞在内），SPA 零硬编码。thinkingLevel 无锚（fold
   * 与 boot 均缺席）= null（行集照常全量——sandboxMode 恒有锚）；fold 坏词
   * 直接抛（服务端不 catch——上抛走面级 500，冷读 CR-TIER-2 钉死不静默吞）。
   */
  tiersOf(sessionId: string): {
    readonly thinkingLevel: string | null;
    readonly sandboxMode: string;
    readonly thinkingLevels: readonly { readonly level: string; readonly detail: string }[];
    readonly sandboxModes: readonly { readonly mode: string; readonly detail: string }[];
  };
  /**
   * 切 thinking 档（PUT thinking-level 执行体）。返回回执文案（按档分拆
   * 语义：thinking = 下一 run 起生效 + 随模型能力诚实句——与 TUI setStatus
   * 回执同文单源，host 侧回执拼装 helper 两装配面消费）。词表外坏词抛
   * BaseError（THINKING_LEVEL_INVALID——服务端 400 码族词面呈现不吞码）。
   */
  setThinkingLevel(sessionId: string, level: string): string;
  /**
   * 切 sandbox 档（PUT sandbox-mode 执行体）。回执 = 即刻生效于后续工具
   * 调用（按档分拆语义另一半）。词表外坏词抛 BaseError（SANDBOX_MODE_INVALID
   * ——同律 400 码族词面呈现不吞码）。
   */
  setSandboxMode(sessionId: string, mode: string): string;
}

/** webui 件全依赖（装配根闭包注入——02 §4.1 边形态「最窄边」） */
export interface WebuiDeps {
  readonly sessions: WebuiSessionsFace;
  readonly read: WebuiReadFace;
  readonly completion?: WebuiCompletionFace;
  /**
   * 会话档位面（2026-09-18 webui 档位面受理批）。缺席 = 档位三端点 501
   * 诚实缺席（API-only 形——exportMarkdown 缺席同精神；501 判先于会话态
   * 404，冷读 CR-TIER-2 边缘三形之一）。
   */
  readonly tiers?: WebuiSessionTierFace;
  /** SPA 静态面目录（生产 dist/webui/；缺席 = API-only 形，/ 与未知路径 404） */
  readonly staticDir?: string;
}

/* ---------------- 路由注册窄面族（§10.4 改形注⑤——WebuiRouteFace；词面独立律零 sdk import） ---------------- */

/**
 * webui 侧路由鉴权档（两值——面级四值的 webui 射界）：
 * - `{mode:'token-or-cookie', cookie}`——Bearer ∪ HttpOnly cookie 双通道
 *   （EventSource 结构性无 Authorization 头——浏览器侧唯一凭证通道）；
 * - `{mode:'open', purpose}`——跳 token 闸，语义位闭集恰三值全用上
 *   （liveness 探活 / auth-exchange 鉴权换证 / static-shell 静态壳）。
 *
 * 结构兼容注记：本联合是面级四值档的子形——host 装配根直传注册器时
 * WebuiRouteDescriptor 可赋值面侧描述符（方向性结构兼容，server.test 以
 * face.register 直注互证）。
 */
export type WebuiRouteAuth =
  | { readonly mode: 'token-or-cookie'; readonly cookie: string }
  | { readonly mode: 'open'; readonly purpose: 'liveness' | 'auth-exchange' | 'static-shell' };

/** 件侧 SSE 流面（openSse 产物——write 即 `data: <单行 JSON>` 帧合成钉死；close 幂等） */
export interface WebuiRouteSseStream {
  /** 帧写入（载荷整体单次 JSON.stringify 单行——禁手工拼帧）；背压期 droppable 载荷 shedding */
  write(data: unknown): void;
  /** 终结（幂等——连接 close / 看门狗 / 宿主收场三路共用） */
  close(): void;
}

/** openSse 选项（背压 shedding 谓词注入——webui 侧判据 = display 族 update 两型可丢） */
export interface WebuiRouteSseOptions {
  readonly droppable?: (data: unknown) => boolean;
}

/** 读请求体结果（排空纪律面级内含——超帽 ok:false 在体收完后才返回） */
export type WebuiRouteBodyResult =
  { readonly ok: true; readonly body: string } | { readonly ok: false; readonly status: 413; readonly message: string };

/**
 * 扩展路由 handler 上下文（面级 helper 的件侧视界——路由匹配产物 + 三件
 * helper；query 位不在窄面：handler 侧自 req.url 解析）。
 */
export interface WebuiRouteContext {
  /** `:param` 段提取（匹配期注入——非参数路由恒空对象） */
  readonly params: Readonly<Record<string, string>>;
  /** catch-all 尾吞的原始路径形（非 catch-all 路由恒 undefined；SPA fallback 承载位） */
  readonly wildcard: string | undefined;
  /** SSE 开流（帧形/ping/看门狗/shedding/幂等 close 面级单源——收场全流收口归面） */
  openSse(res: ServerResponse, opts?: WebuiRouteSseOptions): WebuiRouteSseStream;
  /** 读请求体（排空纪律 + per-route 帽——帽 = descriptor.bodyLimitBytes） */
  readBody(req: IncomingMessage): Promise<WebuiRouteBodyResult>;
  /** 面 token 验换（常时比对——auth 桥换发判据；cookie 桥/Bearer 执法归面级） */
  verifyToken(value: string): boolean;
}

/** 扩展路由 handler（三参定形） */
export type WebuiRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WebuiRouteContext,
) => void | Promise<void>;

/** 路由描述符（path 段式 `:param`；webui 全族 loopbackOnly: true——07 E1 恒回环可达） */
export interface WebuiRouteDescriptor {
  /** HTTP 方法（method+path 双键匹配） */
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  /** 段式路径；`*` 单独成 path = 吞一切（SPA fallback 承载位） */
  readonly path: string;
  /** 鉴权档（两值——WebuiRouteAuth） */
  readonly auth: WebuiRouteAuth;
  /** 恒回环可达标记（非回环 TCP 监听器不挂载——404 同未注册；webui 全族恒真） */
  readonly loopbackOnly?: boolean;
  /** per-route 请求体帽（POST 族 256KiB 位） */
  readonly bodyLimitBytes?: number;
  readonly handler: WebuiRouteHandler;
}

/** 路由注册器（注入窄面——host 装配根传面级注册器即结构兼容；返摘除 fn） */
export type WebuiRouteRegistrar = (descriptor: WebuiRouteDescriptor) => () => void;

/* ---------------- mount 形（件级组装产物——承载位改注册后的件生命周期） ---------------- */

/** mount 依赖（WebuiDeps + 注册器注入位——装配序直调条款） */
export interface WebuiMountDeps extends WebuiDeps {
  /** 路由注册窄面（结构兼容 sdk 面注册器——词面独立律：host 装配根直传 face.register） */
  readonly register: WebuiRouteRegistrar;
}

/** mount 构造选项（件侧帽参——SSE 连接帽与 POST 体帽的测试确定性注入位） */
export interface WebuiMountOptions {
  /** SSE 全局连接帽（缺省 16——件侧自记账，面级 openStreams 不暴露计数） */
  readonly maxConnections?: number;
  /** POST 族 per-route 体帽（缺省 256KiB） */
  readonly bodyLimitBytes?: number;
  /** 件级诊断 warn 面（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** mountWebui 产物（backend + detach——零监听零 start/stop，收场归面） */
export interface WebuiMountHandle {
  /** 通道核注册面（UiBackend 第四实装——claim 桥晚绑真身） */
  readonly backend: UiBackend<never>;
  /** 全路由摘除 + 全流收口 + 审批清槽（**丢弃性不 resolve**——行回卷语义；幂等） */
  detach(): void;
}

/* ---------------- 审批桥载荷（decide 应答回执与 ask 注入面共形） ---------------- */

/** decide 端点应答体（typebox 闭集校验——ApprovalAskAnswer 四值） */
export interface WebuiDecideBody {
  readonly answer: ApprovalAskAnswer;
  readonly note?: string;
}

/** 审批清单条目（GET /api/approvals 载荷——ApprovalAskRequest 镜像 + 会话位） */
export interface WebuiApprovalEntry extends ApprovalAskRequest {
  readonly approvalId: string;
  readonly sessionId: string;
}
