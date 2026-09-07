/**
 * webui/client/api — REST 薄客户端（批 18a-2；微路由五撮的浏览器消费腿）。
 *
 * 凭证通道恒 cookie 桥（/api/auth Set-Cookie HttpOnly SameSite=Strict——
 * fetch 与 EventSource 同源自动携行；本层零 token 状态，AuthGate 负责
 * 换桥，401 由调用面捕获回到换桥位）。端点词面单源 = WEBUI_ENDPOINTS
 * （./protocol 客户端线视界——服务端真源 src/webui/types.ts 同形镜像，
 * 树隔离纪律见该件头注）。
 */
import {
  WEBUI_ENDPOINTS,
  type ClientApprovalEntry,
  type ClientSessionSummary,
  type ClientTodoItem,
} from './protocol.js';

/** 应答回执（answer 四值闭集——与服务端 DecideSchema 同源词面） */
export type DecideAnswer = 'approve' | 'reject' | 'cancel' | 'always';

/** API 面 error 应答（HTTP 状态 + machine word——SPA 面无错误码族） */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status} ${code}`);
  }
}

/** :id 位代换（端点表占位真源——路由词面不二次手写） */
function withId(endpoint: string, id: string): string {
  return endpoint.replace(':id', encodeURIComponent(id));
}

/** JSON 调用腿（同源 cookie 恒携；非 2xx 折 ApiError） */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // 非 JSON 应答——保留 HTTP 状态词面
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text === '' ? undefined : (JSON.parse(text) as T)) as T;
}

/** 微路由 REST 面（SSE 腿不在此——EventSource 由 App 接线） */
export const api = {
  /** 鉴权探针（cookie 已桥 → true；401 → false——AuthGate 显隐判据） */
  async probeAuthed(): Promise<boolean> {
    try {
      await call<unknown>(WEBUI_ENDPOINTS.sessions);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return false;
      throw err;
    }
  },

  /** auth cookie 桥（204 = 桥成；401 → ApiError 由调用面呈现） */
  auth(token: string): Promise<void> {
    return call<void>(WEBUI_ENDPOINTS.auth, { method: 'POST', body: JSON.stringify({ token }) });
  },

  async listSessions(): Promise<readonly ClientSessionSummary[]> {
    const body = await call<{ sessions: ClientSessionSummary[] }>(WEBUI_ENDPOINTS.sessions);
    return body.sessions;
  },

  async createSession(): Promise<string> {
    const body = await call<{ sessionId: string }>(WEBUI_ENDPOINTS.sessions, { method: 'POST', body: '{}' });
    return body.sessionId;
  },

  /** 近史投影（正确性层真源——onopen 恒重拉） */
  async fetchMessages(sessionId: string): Promise<readonly unknown[]> {
    const body = await call<{ messages: unknown[] }>(withId(WEBUI_ENDPOINTS.sessionMessages, sessionId));
    return body.messages;
  },

  async submit(sessionId: string, text: string, messageId: string): Promise<void> {
    await call<unknown>(withId(WEBUI_ENDPOINTS.sessionSubmit, sessionId), {
      method: 'POST',
      body: JSON.stringify({ text, messageId }),
    });
  },

  interrupt(sessionId: string): Promise<void> {
    return call<void>(withId(WEBUI_ENDPOINTS.sessionInterrupt, sessionId), { method: 'POST', body: '{}' });
  },

  async listApprovals(): Promise<readonly ClientApprovalEntry[]> {
    const body = await call<{ approvals: ClientApprovalEntry[] }>(WEBUI_ENDPOINTS.approvals);
    return body.approvals;
  },

  /** 跨入口竞速回执（applied = 本口落值 / superseded = 异口已答——两形同出清） */
  async decide(approvalId: string, answer: DecideAnswer): Promise<'applied' | 'superseded'> {
    const body = await call<{ outcome: 'applied' | 'superseded' }>(
      `${WEBUI_ENDPOINTS.approvalsDecide}`.replace(':approvalId', encodeURIComponent(approvalId)),
      { method: 'POST', body: JSON.stringify({ answer }) },
    );
    return body.outcome;
  },

  async todo(sessionId: string): Promise<readonly ClientTodoItem[] | null> {
    const body = await call<{ items: ClientTodoItem[] | null }>(withId(WEBUI_ENDPOINTS.sessionTodo, sessionId));
    return body.items;
  },
};
