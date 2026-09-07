/**
 * webui/client/frames — SPA 呈现层帧折叠器（批 18a-2；纯函数件零 React 依赖）。
 *
 * 消费面同一律：EventSource 真流与组件测试共用本折叠器——SSE 信封三族
 * （03 §10.4 批 18a 定形注②分档判据的服务端镜像消费位）到视图模型的
 * 全部折叠逻辑住本件，App.tsx 只做接线不做语义。
 *
 * 正确性层分账（「连接即当下」条款的客户端半边）：正文真相 = 投影拉取
 * （loadedMessages 整段重置）；活体流（display 族）只画流式尾巴，终结帧
 * （session 族 message_end）落地成稿。连接 onopen 恒重拉投影——活体帧
 * 丢失不构成错误（呈现层可丢，正确性层不可错）。
 */
import type { ClientApprovalEntry, ClientEnvelope, ClientSessionSummary } from './protocol.js';

/** 呈现层消息视图模型（投影消息与活体落稿同形） */
export interface ViewMessage {
  readonly key: string;
  readonly role: string;
  readonly text: string;
  /** 活体流式位（true = 增量未定稿——流式尾巴呈现形） */
  readonly streaming: boolean;
}

/** 通知条目（notify 族帧的视图模型） */
export interface ViewNotice {
  readonly id: number;
  readonly message: string;
  readonly level: string | undefined;
}

/** todo 条目视图（goal 计划态呈现投影——形状透传 ClientTodoItem） */
export interface ViewTodo {
  readonly status: string;
  readonly content: string;
  readonly activeForm?: string;
}

/** SPA 全呈现态（纯函数折叠的唯一载体） */
export interface AppState {
  readonly sessions: readonly ClientSessionSummary[];
  readonly activeId: string | null;
  readonly messages: readonly ViewMessage[];
  /** 状态行文案（null = 闲态不呈现） */
  readonly status: string | null;
  readonly approvals: readonly ClientApprovalEntry[];
  readonly notices: readonly ViewNotice[];
  readonly todo: readonly ViewTodo[] | null;
  /** 视图键序发生器（无时间戳载荷的稳定键兜底） */
  readonly seq: number;
}

/** 初始态（空态——auth 后由投影拉取逐段填充） */
export const initialAppState: AppState = {
  sessions: [],
  activeId: null,
  messages: [],
  status: null,
  approvals: [],
  notices: [],
  todo: null,
  seq: 0,
};

/**
 * AgentMessage 内容抽取（呈现半边）：string 直过；分块数组拼 text 块
 * （thinking/toolCall 块跳过——正文视图只收文字）。坏形容错回空串。
 */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/** 消息视图键（时间戳优先——无时间戳形用序发生器兜底） */
function messageKey(state: AppState, timestamp: unknown): { key: string; seq: number } {
  const seq = state.seq + 1;
  return { key: typeof timestamp === 'number' ? `m-${timestamp}` : `m#${seq}`, seq };
}

/**
 * 信封折叠（纯函数）：display 族画流式尾巴 / session 族落稿与 asked 镜像 /
 * status·notify 各归其位。未知帧形静默忽略（前向兼容——服务端加型不炸客户端）。
 */
export function applyEnvelope(state: AppState, env: ClientEnvelope): AppState {
  switch (env.kind) {
    case 'notify': {
      // 通知条上限 5（旧条滚动出清——notify 无回放，超量即丢）
      const seq = state.seq + 1;
      const notices = [...state.notices, { id: seq, message: env.payload.message, level: env.payload.level }].slice(-5);
      return { ...state, seq, notices };
    }
    case 'status':
      return { ...state, status: env.payload.status };
    case 'display':
    case 'session': {
      const payload = env.payload;
      // 分档半边：同 payload 联合上分形处理（display = 活体尾巴，session = 落稿）
      if (payload.type === 'message_start') {
        if (env.kind !== 'display') return state;
        const { key, seq } = messageKey(state, undefined);
        return {
          ...state,
          seq,
          messages: [...state.messages, { key, role: payload.role, text: '', streaming: true }],
        };
      }
      if (payload.type === 'message_update') {
        if (env.kind !== 'display') return state;
        // 尾条同位刷新（流式尾巴只占尾位；投影重置后迟到的旧 update 不复活）
        const messages = [...state.messages];
        const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
        if (last === undefined || !last.streaming) {
          const { key, seq } = messageKey(state, undefined);
          return {
            ...state,
            seq,
            messages: [
              ...messages,
              { key, role: payload.role, text: textOf(partialContent(payload.partial)), streaming: true },
            ],
          };
        }
        messages[messages.length - 1] = {
          ...last,
          role: payload.role,
          text: textOf(partialContent(payload.partial)),
        };
        return { ...state, messages };
      }
      if (payload.type === 'message_end') {
        if (env.kind !== 'session') return state;
        const { key, seq } = messageKey(state, messageTimestamp(payload.message));
        // 落稿替换流式尾巴（同 run 的尾巴被成稿覆盖；无尾巴直插）
        const messages = [...state.messages];
        const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
        const finalized: ViewMessage = {
          key,
          role: messageRole(payload.message),
          text: textOf(messageContent(payload.message)),
          streaming: false,
        };
        if (last !== undefined && last.streaming) messages[messages.length - 1] = finalized;
        else messages.push(finalized);
        return { ...state, seq, messages };
      }
      if (payload.type === 'tool_execution_start') {
        if (env.kind !== 'display') return state;
        return { ...state, status: `⚙ ${payload.name} …` };
      }
      if (payload.type === 'tool_execution_update') {
        if (env.kind !== 'display') return state;
        return { ...state, status: `⚙ ${payload.toolCallId} …` };
      }
      if (payload.type === 'tool_execution_end') {
        if (env.kind !== 'session') return state;
        const { key, seq } = messageKey(state, undefined);
        return {
          ...state,
          seq,
          status: null,
          messages: [
            ...state.messages,
            { key, role: 'tool', text: `⚙ 工具 ${payload.toolCallId} 执行完成`, streaming: false },
          ],
        };
      }
      if (payload.type === 'agent_end') return { ...state, status: null };
      // agent_start / turn_* 不进正文视图（v1 呈现最小面）
      return state;
    }
    default:
      return state;
  }
}

/** asked 镜像入账（session 族 approval/asked 帧的折叠腿——dedupe by approvalId） */
export function applyAsked(state: AppState, entry: ClientApprovalEntry): AppState {
  if (state.approvals.some((a) => a.approvalId === entry.approvalId)) return state;
  return { ...state, approvals: [...state.approvals, entry] };
}

/** decide 应答后本地出清（applied 与 superseded 同出清——异口已答） */
export function appliedDecide(state: AppState, approvalId: string): AppState {
  return { ...state, approvals: state.approvals.filter((a) => a.approvalId !== approvalId) };
}

/** 投影拉取落座（正确性层——整段重置正文，活体尾巴清场） */
export function loadedMessages(state: AppState, messages: readonly unknown[]): AppState {
  const views: ViewMessage[] = [];
  let seq = state.seq;
  for (const message of messages) {
    seq += 1;
    views.push({
      key: `p#${seq}`,
      role: messageRole(message),
      text: textOf(messageContent(message)),
      streaming: false,
    });
  }
  return { ...state, messages: views, seq };
}

/** 会话清单落座 */
export function loadedSessions(state: AppState, sessions: readonly ClientSessionSummary[]): AppState {
  return { ...state, sessions };
}

/** 会话切换（正文/todo 归零——onopen 重拉投影回填） */
export function setActiveSession(state: AppState, sessionId: string | null): AppState {
  return { ...state, activeId: sessionId, messages: [], todo: null, status: null };
}

/** todo 投影落座 */
export function loadedTodo(state: AppState, todo: readonly ViewTodo[] | null): AppState {
  return { ...state, todo };
}

/* ---------------- AgentMessage 形状探取（未知形容错——投影真源是服务端） ---------------- */

function messageRole(message: unknown): string {
  if (typeof message === 'object' && message !== null && 'role' in message && typeof message.role === 'string') {
    return message.role;
  }
  return 'unknown';
}

function messageContent(message: unknown): unknown {
  if (typeof message === 'object' && message !== null && 'content' in message) {
    return (message as { content: unknown }).content;
  }
  return '';
}

function messageTimestamp(message: unknown): unknown {
  if (typeof message === 'object' && message !== null && 'timestamp' in message) {
    return (message as { timestamp: unknown }).timestamp;
  }
  return undefined;
}

function partialContent(partial: unknown): unknown {
  return messageContent(partial);
}
