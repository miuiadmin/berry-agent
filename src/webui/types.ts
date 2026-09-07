/**
 * webui/types — core:webui Web 通道契约（L4；02 篇 §4.1 席 25 / 03 篇 §10.4；
 * 批 18a-1 契约先行）。
 *
 * 词面单源：端点路由（五撮具体路径——03 §10.4 批 18a 落码定形注①）/ 信封
 * 三族 kind 闭集与分档判据（注②）/ 开面配置形 / 注入窄面族（词面独立律——
 * 结构兼容 host 装配桥真身，compat 互证归 host 装配批）均在本件定形，
 * 传输实装（server.ts）只消费不复制。
 *
 * 边表纪律：deps = contracts + channels——AgentEvent 类型经 SessionEnvelope
 * 结构取用（webui 无 agent 边）；TodoItem/UiBackend/NotifyLevel 自 channels
 * 公开面消费（真边）。
 */
import type { AgentMessage, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { NotifyLevel, SessionEnvelope, TodoItem, UiBackend } from '../channels/index.js';

/* ---------------- 常量（缺省值单源——03 §10.4 各条款钉死值） ---------------- */

/** 缺省端口（`--port <n>` 一次性开面——缺省 7860） */
export const WEBUI_DEFAULT_PORT = 7860;

/** 缺省回环绑定地址（恒回环钉死——非回环须配凭证拒启律见 security 件） */
export const WEBUI_DEFAULT_HOST = '127.0.0.1';

/** 全局 SSE 连接帽（超帽新连接 503） */
export const WEBUI_MAX_CONNECTIONS = 16;

/** POST 族字节帽（256KiB——超帽 413 且应答永不早于请求体收完） */
export const WEBUI_BODY_LIMIT_BYTES = 256 * 1024;

/** SSE 注释行 ping 节拍（30s——写侧信号驱动看门狗） */
export const WEBUI_SSE_PING_INTERVAL_MS = 30_000;

/** SSE 写侧看门狗判死窗（ping 写失败或写超时 90s 即 reap 连接） */
export const WEBUI_SSE_WRITE_TIMEOUT_MS = 90_000;

/** auth cookie 桥 cookie 名（HttpOnly SameSite=Strict——EventSource 无头位） */
export const WEBUI_COOKIE_NAME = 'webui_token';

/** 微路由端点表（五撮——03 §10.4 批 18a 落码定形注①定形） */
export const WEBUI_ENDPOINTS = {
  /** GET——探活（无鉴权；只回 ok 零敏感面） */
  health: '/api/health',
  /** POST——auth cookie 桥（体 {token} → Set-Cookie） */
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

/* ---------------- 开面配置与注入窄面 ---------------- */

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

/** 提交载荷（messageId = SPA 重试幂等位——缺席服务端生成无幂等） */
export interface WebuiSubmitInput {
  readonly sessionId: string;
  readonly content: string;
  readonly messageId: string;
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
}

/** 补全族注入面（两段——缺席诚实空，v1 装配批按需接线） */
export interface WebuiCompletionFace {
  workspaceFiles?(query: string): readonly string[];
  workspaceSymbols?(query: string): readonly string[];
}

/** webui 件全依赖（装配根闭包注入——02 §4.1 边形态「最窄边」） */
export interface WebuiDeps {
  readonly sessions: WebuiSessionsFace;
  readonly read: WebuiReadFace;
  readonly completion?: WebuiCompletionFace;
  /** SPA 静态面目录（生产 dist/webui/；缺席 = API-only 形，/ 与未知路径 404） */
  readonly staticDir?: string;
}

/** 开面配置（`--port <n>` 一次性开面缺省形；非回环须配凭证——拒启律） */
export interface WebuiListenConfig {
  readonly port?: number;
  /** 缺省 127.0.0.1；非回环绑定必配 token（fail-closed 拒启——03 §10.4① 预埋） */
  readonly host?: string;
  /** 预置共享凭证；缺席自足生成进程内一次性 token（只存内存不落盘） */
  readonly token?: string;
}

/** 服务端构造选项（时钟/节拍/帽参全注入——测试确定性） */
export interface WebuiServerOptions {
  readonly config?: WebuiListenConfig;
  /** 假钟注入位（看门狗判死窗时源——测试确定性） */
  readonly now?: () => number;
  readonly pingIntervalMs?: number;
  readonly writeTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly bodyLimitBytes?: number;
  /** 传输级诊断 warn 面（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** createWebuiServer 产物（后端 + token + 生命周期三位——宿主装配位消费） */
export interface WebuiHandle {
  /** 通道核注册面（UiBackend 第四实装——claim 桥晚绑真身） */
  readonly backend: UiBackend<never>;
  /** 实效 token（预置或进程内生成——「监听 ⇒ 鉴权」恒在场；一次性披露面宿主消费） */
  readonly token: string;
  /** 开面监听（回环缺省形；port 0 回实配端口） */
  start(): Promise<{ readonly host: string; readonly port: number }>;
  /** 收场序：全流收口 → 审批清槽（丢弃性不 resolve）→ 关监听 */
  stop(): Promise<void>;
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
