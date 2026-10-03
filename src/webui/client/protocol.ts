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
  /** GET——会话导出 markdown 直出（不落盘） */
  sessionExport: '/api/sessions/:id/export',
  /** GET——档位面读（当前档 + 两行集——词表/行文案单源服务端；2026-09-18 webui 档位面受理批） */
  sessionTiers: '/api/sessions/:id/tiers',
  /** PUT——切 thinking 档（体 {level} → 应答 {receipt}；回执文案与 TUI setStatus 同文单源） */
  sessionThinkingLevel: '/api/sessions/:id/thinking-level',
  /** PUT——切 sandbox 档（体 {mode} → 应答 {receipt}；danger 行警示语 07 §4.1 钉死措辞在行文案表内） */
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

/* ---------------- 信封三族（客户端结构视界——分档判据同服务端注②） ---------------- */

/** display 族活体事件视界（客户端消费子集——正文/状态行两消费面） */
export type ClientDisplayEvent =
  | { readonly type: 'message_start'; readonly role: string }
  | { readonly type: 'message_update'; readonly role: string; readonly partial: unknown }
  | { readonly type: 'tool_execution_start'; readonly toolCallId: string; readonly name: string }
  | { readonly type: 'tool_execution_update'; readonly toolCallId: string }
  | { readonly type: 'agent_start' }
  | {
      /** run 终态（缺席 = completed——与服务端发射位同语义） */
      readonly type: 'agent_end';
      readonly status?: string;
      /**
       * 失败原因（失败直呈律 07 §4.1 V-0 注②跨通道同律——服务端发射位在册
       * 载荷，客户端视界补声明）：在场即状态行同句携因 `✗ 失败 · 原因`。
       */
      readonly errorMessage?: string;
      /**
       * run 总耗时毫秒（A-3 载荷位——在场即唯一真源，SPA/SDK 同源消费）：
       * 服务端 loop 已全量发射（0eff8e7——agent_start 起算、终态随发，不再
       * 仅 status/stopReason/errorMessage）；收尾行耗时段优先取它，缺席回退
       * 客户端观察窗近似。
       */
      readonly durationMs?: number;
    }
  | { readonly type: 'turn_start'; readonly turn: number }
  | { readonly type: 'turn_end'; readonly turn: number }
  | {
      /**
       * 重试退避窗开（收尾行重试段计数面——V-0 注⑥跨通道对端 + E1 重试呈现
       * 供数位）。attempt/maxAttempts 服务端载荷在场（contracts/agent-events
       * 真源），SPA 状态行「第 n/N 次」段消费；倒计时呈现未立项（nextAt 须
       * 本地钟 ticker——视界不收）。
       */
      readonly type: 'retry_wait_start';
      /** 将续入的尝试序号（1 起——缺席裸形兜底） */
      readonly attempt?: number;
      /** 重试名额帽（缺席裸形兜底） */
      readonly maxAttempts?: number;
    }
  | {
      /** 重试退避窗关（outcome 三值——resumed = 续入即新 agent_start，run 级账不清的判定位） */
      readonly type: 'retry_wait_end';
      readonly outcome: 'resumed' | 'aborted' | 'exhausted';
    };

/** session 族终结事件视界（落 durable 两型的客户端消费子集） */
export type ClientTerminalEvent =
  | { readonly type: 'message_end'; readonly message: unknown }
  | {
      readonly type: 'tool_execution_end';
      readonly toolCallId: string;
      /**
       * 工具执行结果（结构视界——只声明消费到的 isError 子集）：失败判据
       * = result.isError（TUI 三态卡 ✓/✗/⏹ 同源位，工具发射位随 result 整体
       * 镜像到 session 族帧）。整体可选 = 向后兼容位：旧服务端/坏形缺席按
       * 成功呈现（「执行完成」），isError 缺席同按成功——错误标记是数据
       * 契约位非默认位。
       */
      readonly result?: { readonly isError?: boolean };
    };

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
