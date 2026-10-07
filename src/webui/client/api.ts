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
 * 提交附件 chip 原形（Composer 暂存位直传——dataURL 全形在此层原样收）：
 * dataURL 前缀剥除归本层 submit（base64 内联同条 JSON——03 §10.4 批注①
 * images[{data,mimeType}] 体形），Composer 零前缀知识。
 */
export interface SubmitAttachment {
  readonly dataUrl: string;
  readonly mimeType: string;
}

/**
 * dataURL 前缀剥除（剪贴板附件批——03 §10.4 批注①）：`data:<mime>;base64,<载荷>`
 * → 只传 base64 载荷段（服务端 images[].data 位收纯 base64）。首个逗号为
 * 前缀/载荷分界（base64 字母表不含逗号——首逗号切分安全）；无逗号坏形回
 * 空串（服务端校验面拒——客户端不造半形数据）。
 */
export function base64OfDataUrl(dataUrl: string): string {
  const commaAt = dataUrl.indexOf(',');
  return commaAt === -1 ? '' : dataUrl.slice(commaAt + 1);
}

/**
 * 附件图 URL 单源铸造（剪贴板附件批——03 §10.4 批注④⑥）：ref 形
 * `sha256:<hex>`，路径段直接拼 ref 串（冒号是合法路径字符——不做
 * encodeURIComponent，批注④「路径段直接拼」句面）。Transcript 的 img src
 * 经本腿取 URL——端点词面走 WEBUI_ENDPOINTS.attachments（protocol 客户端
 * 线视界，与服务端 types.ts 同形镜像、双表对拍锁执法），禁手写字面量副本。
 */
export function attachmentUrl(ref: string): string {
  return WEBUI_ENDPOINTS.attachments.replace(':ref', ref);
}

/**
 * SSE 活体流 URL 单源铸造（第十一轮深扫 laneG L8-2）：App 的 EventSource
 * 接线经本腿取 URL——端点词面走 WEBUI_ENDPOINTS.sessionEvents（protocol
 * 客户端线视界，与服务端 types.ts 同形镜像、双表对拍锁执法），禁手写字面量
 * 副本（修前 App 第三份手写副本：端点表项零消费，服务端改词面时对拍锁够不
 * 到该副本——SSE 恒 404 死流零呈现〔原注「静默重连循环」勘正：非 200 受理
 * 按 WHATWG fail the connection 永久 CLOSED 不自动重连；终态死流现由 App
 * onerror 终态腿分档呈现（SSE L3——直 fetch 定性探针 + 重试建流键）〕）。
 * :id 代换 + encodeURIComponent 保序（withId 同语义——会话 id 含保留字时
 * 路由不破）。终态死流定性探针复用本铸造（同 URL 直 fetch——App
 * classifyDeadStream 消费位）。
 */
export function sessionEventsUrl(sessionId: string): string {
  return withId(WEBUI_ENDPOINTS.sessionEvents, sessionId);
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

  /**
   * 会话清单 + 全量总数（B2 截断披露——服务端清单默认最近 100 窗，total
   * 与窗分立：超窗侧栏注记「N/M 会话（仅显示最近）」；与 TUI session-picker
   * 头行同文案同判据〔totalCount > 清单长才注记〕）。
   */
  async listSessions(): Promise<{ sessions: readonly ClientSessionSummary[]; total: number }> {
    return call<{ sessions: ClientSessionSummary[]; total: number }>(WEBUI_ENDPOINTS.sessions);
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

  /**
   * 提交（体 {text, messageId, images?}——images 位 03 §10.4 批注①：附件
   * base64 内联同条 JSON，[{data: <纯 base64>, mimeType}]，dataURL 前缀剥除
   * 归本层）。零附件/空附件数组两形载荷零漂移——不带 images 键（旧载荷形
   * 逐键不变，服务端 SubmitSchema 兼容旧体）。
   */
  async submit(
    sessionId: string,
    text: string,
    messageId: string,
    attachments?: readonly SubmitAttachment[],
  ): Promise<void> {
    // 帽内非空才铸 images 位（空数组不带键——零漂移律）
    const images =
      attachments && attachments.length > 0
        ? attachments.map((a) => ({ data: base64OfDataUrl(a.dataUrl), mimeType: a.mimeType }))
        : undefined;
    await call<unknown>(withId(WEBUI_ENDPOINTS.sessionSubmit, sessionId), {
      method: 'POST',
      body: JSON.stringify({ text, messageId, ...(images !== undefined ? { images } : {}) }),
    });
  },

  interrupt(sessionId: string): Promise<void> {
    return call<void>(withId(WEBUI_ENDPOINTS.sessionInterrupt, sessionId), { method: 'POST', body: '{}' });
  },

  /**
   * 删除会话（DELETE——零请求体；200 应答体 {status:'deleted'} 解包为
   * void）。409 busy（message 位 = 服务端同句人读因——NoticeBar 直显）/
   * 404 not_found / 501 面未装配均折 ApiError 由调用面呈现；确认编舞
   * （window.confirm 破坏性动作必有确认）归 App，本层零编舞。
   */
  async deleteSession(sessionId: string): Promise<void> {
    await call<unknown>(withId(WEBUI_ENDPOINTS.sessionDelete, sessionId), { method: 'DELETE' });
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
   * 「下一轮对话起生效 + 随模型能力诚实句」）；坏词 400 折 ApiError
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
