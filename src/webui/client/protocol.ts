/**
 * webui/client/protocol — SPA 客户端线视界（批 18a-2）。
 *
 * 线协议形的服务端真源 = src/webui/types.ts（typebox 校验 + 信封三族定义 +
 * 端点词面）。客户端树必须自持形状：浏览器 bundle 零服务端依赖（vite 构建面
 * 与类型面双隔离——客户端码永不见 node:* 类型的服务端程序拉入）。漂移防线：
 * 本件只声明消费到的字段子集（结构视界），多余字段运行时忽略；服务端加型
 * 不炸客户端（applyEnvelope 未知帧静默忽略同律）。
 */

/** 微路由端点表（客户端副本——与服务端 WEBUI_ENDPOINTS 同形同词面） */
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

/* ---------------- 信封三族（客户端结构视界——分档判据同服务端注②） ---------------- */

/** display 族活体事件视界（客户端消费子集——正文/状态行两消费面） */
export type ClientDisplayEvent =
  | { readonly type: 'message_start'; readonly role: string }
  | { readonly type: 'message_update'; readonly role: string; readonly partial: unknown }
  | { readonly type: 'tool_execution_start'; readonly name: string }
  | { readonly type: 'tool_execution_update'; readonly toolCallId: string }
  | { readonly type: 'agent_start' }
  | { readonly type: 'agent_end' }
  | { readonly type: 'turn_start'; readonly turn: number }
  | { readonly type: 'turn_end'; readonly turn: number };

/** session 族终结事件视界（落 durable 两型的客户端消费子集） */
export type ClientTerminalEvent =
  | { readonly type: 'message_end'; readonly message: unknown }
  | { readonly type: 'tool_execution_end'; readonly toolCallId: string };

/** 审批 asked 镜像载荷（= 服务端 WebuiApprovalAskedPayload 客户端视界） */
export interface ClientAskedPayload {
  readonly type: 'approval/asked';
  readonly approvalId: string;
  readonly summary: string;
  readonly reason?: string;
  readonly toolName?: string;
  readonly suggestedEntry?: string;
}

/** SSE 信封三族（客户端视界——payload 只声明消费子集） */
export type ClientEnvelope =
  | { readonly kind: 'session'; readonly sessionId: string; readonly payload: ClientTerminalEvent | ClientAskedPayload }
  | { readonly kind: 'display'; readonly sessionId: string; readonly payload: ClientDisplayEvent }
  | { readonly kind: 'notify'; readonly payload: { readonly message: string; readonly level?: string } }
  | { readonly kind: 'status'; readonly sessionId: string; readonly payload: { readonly status: string } };

/* ---------------- REST 投影面（客户端结构视界） ---------------- */

/** 会话清单条目（title null = 无标题——不造占位串，同服务端律） */
export interface ClientSessionSummary {
  readonly id: string;
  readonly title: string | null;
  /** 末活动时间 epoch 毫秒 */
  readonly lastActivityAt: number;
}

/** 审批清单条目（= 服务端 WebuiApprovalEntry 客户端视界） */
export interface ClientApprovalEntry {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly reason?: string;
  readonly toolName?: string;
  readonly suggestedEntry?: string;
}

/** todo 条目（goal 计划态呈现投影的客户端消费子集） */
export interface ClientTodoItem {
  readonly status: string;
  readonly content: string;
  readonly activeForm?: string;
}
