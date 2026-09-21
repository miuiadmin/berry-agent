/**
 * webui/client/api — REST 薄客户端（批 18a-2；微路由五撮的浏览器消费腿）。
 *
 * 凭证通道恒 cookie 桥（/api/auth Set-Cookie HttpOnly SameSite=Strict——
 * fetch 与 EventSource 同源自动携行；本层零 token 状态，AuthGate 负责
 * 换桥，401 由调用面经 isUnauthorized 判别路由回换桥位——webui-face#3：
 * token 随宿主重启轮换，旧 cookie 永久失效重试不可能自愈）。端点词面单源 =
 * WEBUI_ENDPOINTS（./protocol 客户端线视界——服务端真源 src/webui/types.ts
 * 同形镜像，树隔离纪律见该件头注）。
 */
import {
  WEBUI_ENDPOINTS,
  type ClientApprovalEntry,
  type ClientSessionSummary,
  type ClientTodoItem,
} from './protocol.js';

/** 应答回执（answer 四值闭集——与服务端 DecideSchema 同源词面） */
export type DecideAnswer = 'approve' | 'reject' | 'cancel' | 'always';

/**
 * API 面 error 应答（HTTP 状态 + machine word——SPA 面无错误码族）。message
 * 缺省 = `API <status> <code>` 码串；服务端 sendError 信封携人读因（{error,
 * message} 双位）时 foldError 兼读 message 位透传——呈现侧（NoticeBar 直显
 * err.message）用户见人读诊断因而非英文码串（第九役遗漏扫描批 C7）。
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `API ${status} ${code}`);
  }
}

/**
 * 失效凭证判别（webui-face#3 单源谓词）：401 = cookie 桥失效（token 随宿主
 * 重启轮换——旧 cookie 永久失效，重试不可能自愈）。调用面据此路由回换桥位
 * （App 的 onAuthLost 编舞）；非 401 错各调用面按既有呈现形处理。
 */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** :id 位代换（端点表占位真源——路由词面不二次手写） */
function withId(endpoint: string, id: string): string {
  return endpoint.replace(':id', encodeURIComponent(id));
}

/**
 * GET tiers 应答体（与 host 装配面 tiersOf 应答形对齐——客户端树隔离零
 * host import）。词表与行文案单源服务端（SPA 零硬编码）；thinkingLevel
 * 无锚（fold 与 boot 均缺席）= null——行集照常全量、呈现面零标记不虚标；
 * sandboxMode 恒有锚（boot 解析值 fallback）。端点词面经 protocol 端点表
 * 客户端副本消费（sessionTiers 族——与服务端 WEBUI_ENDPOINTS 整表对拍锁
 * 执法，双表恒同步）。
 */
export interface TiersPayload {
  readonly thinkingLevel: string | null;
  readonly sandboxMode: string;
  readonly thinkingLevels: readonly { readonly level: string; readonly detail: string }[];
  readonly sandboxModes: readonly { readonly mode: string; readonly detail: string }[];
}

/**
 * 非 2xx 折 ApiError（JSON 应答优先取 error 词面；message 位 = 服务端人读
 * 因兼读透传——无 message 位回退 `API <status> <code>` 缺省码串；非 JSON
 * 回退 HTTP 状态词）
 */
async function foldError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message: string | undefined;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (typeof body.error === 'string') code = body.error;
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // 非 JSON 应答——保留 HTTP 状态词面
  }
  return new ApiError(res.status, code, message);
}

/** JSON 调用腿（同源 cookie 恒携；非 2xx 折 ApiError） */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await foldError(res);
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
      if (isUnauthorized(err)) return false;
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

  /**
   * 档位面读（GET tiers——当前档 + 两行集）。挂载即读的消费位 =
   * TierPopover（/thinking //sandbox 恰零参拦截呈现面）；501（面未装配）/
   * 404（会话不在场或已闭）/500（fold 坏词）折 ApiError 由调用面透传呈现。
   */
  async getSessionTiers(sessionId: string): Promise<TiersPayload> {
    return call<TiersPayload>(withId(WEBUI_ENDPOINTS.sessionTiers, sessionId));
  },

  /**
   * 切 thinking 档（PUT + 体 {level}——单字符串体 SubmitSchema 先例形）。
   * 应答 {receipt}：回执文案与 TUI setStatus 同文单源（host 侧拼装——
   * 「下一 run 起生效 + 随模型能力诚实句」）；坏词 400 折 ApiError
   * （THINKING_LEVEL_INVALID 词面呈现不吞码）。
   */
  async setThinkingLevel(sessionId: string, level: string): Promise<{ receipt: string }> {
    return call<{ receipt: string }>(withId(WEBUI_ENDPOINTS.sessionThinkingLevel, sessionId), {
      method: 'PUT',
      body: JSON.stringify({ level }),
    });
  },

  /**
   * 切 sandbox 档（PUT + 体 {mode}——同律单字符串体）。应答 {receipt}
   * （「即刻生效于后续工具调用」按档分拆语义另一半）；坏词 400 折
   * ApiError（SANDBOX_MODE_INVALID）。
   */
  async setSandboxMode(sessionId: string, mode: string): Promise<{ receipt: string }> {
    return call<{ receipt: string }>(withId(WEBUI_ENDPOINTS.sessionSandboxMode, sessionId), {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    });
  },

  /**
   * 补全族：@ 文件段（?q= 前缀查询——q 为去 @ 前缀的 token 内文）。条目 =
   * 整 token 代换单位（含 @ 前缀与引号形——源侧单源铸好），客户端零路径/
   * 引号知识直显直插；面缺席或无命中时服务端诚实回 {items:[]}。
   */
  async workspaceFiles(query: string): Promise<readonly string[]> {
    const body = await call<{ items: string[] }>(`${WEBUI_ENDPOINTS.workspaceFiles}?q=${encodeURIComponent(query)}`);
    return body.items;
  },

  /**
   * 会话导出（markdown 直出——应答体非 JSON 故不走 call 折叠腿；blob 形
   * 交呈现面喂 URL.createObjectURL 原生下载）。鉴权同全 API 面：cookie 桥
   * 同源自动携行；非 2xx（404 缺席 / 501 面未装配 / 401 失桥）折 ApiError
   * 由调用面呈现。
   */
  async exportSession(sessionId: string): Promise<Blob> {
    const res = await fetch(withId(WEBUI_ENDPOINTS.sessionExport, sessionId), {
      credentials: 'same-origin',
    });
    if (!res.ok) throw await foldError(res);
    return res.blob();
  },
};
