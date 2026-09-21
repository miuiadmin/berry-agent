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
 *
 * 回显/镜像去重单源律（webui-face#1）：submit 的乐观回显与服务端 kick/
 * steer 顶注发来的 user 种子镜像（display start + session end 双帧）是
 * 同一消息的两源——回显键 m-<客户端钟> 与镜像键 m-<服务端钟> 不同源不
 * 互覆，须由折叠器按 pendingEchoes 配对账吸收镜像保回显（正文恒恰一份）。
 * 终稿换装带角色校验：user 终稿不得顶替 assistant 流式尾（run 在飞提交
 * 时序下终稿序倒置根因——TUI transcript 按 message.role 分派同律）。
 */
import type { ClientApprovalEntry, ClientEnvelope, ClientSessionSummary } from './protocol.js';

/** 呈现层消息视图模型（投影消息与活体落稿同形） */
export interface ViewMessage {
  readonly key: string;
  readonly role: string;
  readonly text: string;
  /**
   * 错误块文案（assistant errorMessage 在场时落位——正文列错误块呈现；
   * 缺席无位。03 §10.4 SPA 呈现面终态条款①：与 TUI 错误块同律跨通道）
   */
  readonly error?: string;
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

/**
 * 待配对乐观回显账目（回显/镜像去重单源律的配对面——webui-face#1）：
 * submit 落回显时入账（key = 回显键），服务端 user 种子镜像（session
 * message_end）到达时按「同会话同文」配对吸收出账——会话域隔离（他口/
 * 他会话的同文消息不误吞）；账空后同文镜像不再吸收（正常落正文）。
 */
export interface PendingEcho {
  readonly sessionId: string;
  readonly key: string;
  readonly text: string;
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
  /** 待配对乐观回显（见 PendingEcho——回显与镜像恰一份的配对账） */
  readonly pendingEchoes: readonly PendingEcho[];
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
  pendingEchoes: [],
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

/** 消息错误位抽取（assistant errorMessage——非串/空串不落位，正文错误块判据） */
function errorMessageOf(message: unknown): string | undefined {
  if (typeof message === 'object' && message !== null && 'errorMessage' in message) {
    const value = (message as { errorMessage: unknown }).errorMessage;
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

/** 消息视图键（时间戳优先——无时间戳形用序发生器兜底；数值时间戳键位与 echoKeyOf 同源） */
function messageKey(state: AppState, timestamp: unknown): { key: string; seq: number } {
  const seq = state.seq + 1;
  return { key: typeof timestamp === 'number' ? echoKeyOf(timestamp) : `m#${seq}`, seq };
}

/**
 * 同角色流式位定位（自尾回溯——webui-face#1）：回显/镜像/工具行插队后流式
 * 尾巴不占尾位，自尾向前跳过已定稿位找最近流式位；遇异角色流式位停（另一条
 * 在飞尾巴，不越位顶替）。无匹配回 -1（调用面自开/直插兜底）。
 */
function streamingSlotOf(messages: readonly ViewMessage[], role: string): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (!m.streaming) continue; // 已定稿位跳过（回显/镜像/工具行等插队位）
    if (m.role === role) return i;
    return -1; // 流式位异角色——不越位
  }
  return -1;
}

/**
 * 信封折叠（纯函数）：display 族画流式尾巴 / session 族落稿与 asked 镜像 /
 * status·notify 各归其位。未知帧形静默忽略（前向兼容——服务端加型不炸客户端）。
 */
export function applyEnvelope(state: AppState, env: ClientEnvelope): AppState {
  switch (env.kind) {
    case 'notify':
      // 帧腿与本地推播共用同帽同形（pushedNotice——单源执法位）
      return pushedNotice(state, env.payload.message, env.payload.level);
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
        // 同角色流式位刷新：流式尾巴通常占尾位；回显/镜像/工具行插队后流式
        // 位可能不在尾位（webui-face#1 在飞提交时序）——自尾回溯跳过已定稿
        // 位找最近流式位（遇异角色流式位停——那是另一条在飞尾巴，不越位）
        const messages = [...state.messages];
        const target = streamingSlotOf(messages, payload.role);
        if (target === -1) {
          // 无流式位自开（乱序容错——投影重置后迟到 update 开新位不复活旧文）
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
        messages[target] = {
          ...messages[target]!,
          role: payload.role,
          text: textOf(partialContent(payload.partial)),
        };
        return { ...state, messages };
      }
      if (payload.type === 'message_end') {
        if (env.kind !== 'session') return state;
        const role = messageRole(payload.message);
        const text = textOf(messageContent(payload.message));
        // ---- user 镜像吸收（回显/镜像去重单源律——webui-face#1）----
        // 待配对回显在场（同会话同文 FIFO 配对）→ 镜像与回显是同一消息两源，
        // 吸收镜像保回显（正文恰一份）；连带出清镜像自带 start 帧开出的空
        // 流式泡（start/end 相邻发射——尾部空泡即其本体，防御位：非空泡不动）
        if (role === 'user') {
          const pendingIdx = state.pendingEchoes.findIndex((p) => p.sessionId === env.sessionId && p.text === text);
          if (pendingIdx !== -1) {
            const messages = [...state.messages];
            const tail = messages[messages.length - 1];
            if (tail !== undefined && tail.streaming && tail.role === 'user' && tail.text === '') {
              messages.pop();
            }
            return {
              ...state,
              messages,
              pendingEchoes: state.pendingEchoes.filter((_, i) => i !== pendingIdx),
            };
          }
        }
        const { key, seq } = messageKey(state, messageTimestamp(payload.message));
        const error = errorMessageOf(payload.message);
        const finalized: ViewMessage = {
          key,
          role,
          text,
          ...(error !== undefined ? { error } : {}),
          streaming: false,
        };
        // 落稿换装带角色校验（webui-face#1）：终稿只换装同角色流式位——
        // user 终稿不得顶替 assistant 流式尾（终稿序倒置根因）；流式位不在
        // 尾位时自尾回溯对位换装（在飞提交插队后续流/落稿仍归原位）
        const messages = [...state.messages];
        const target = streamingSlotOf(messages, role);
        if (target !== -1) messages[target] = finalized;
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
      if (payload.type === 'agent_end') {
        // 终态分档（03 §10.4 SPA 呈现面终态条款②——07 §4.1 件 6 跨通道同律）：
        // failed/aborted 显式呈现不伪装成功；completed/缺席归闲态
        // （修前不分 status 恒归闲态——失败 run 状态行无痕伪收场）
        if (payload.status === 'failed') return { ...state, status: '✖ 失败' };
        if (payload.status === 'aborted') return { ...state, status: '⏹ 已中止' };
        return { ...state, status: null };
      }
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

/**
 * 通知入账（notify 帧腿与本地推播共用——同帽同形）：上限 5，旧条滚动出清
 * （notify 无回放，超量即丢）。App 侧本地通知（用法错/提交失败/导出失败/
 * 切档回执/切档错误）一律走本腿——修前五处直追数组绕帽，notices 无界
 * 增长、NoticeBar 计数虚胀。
 */
export function pushedNotice(state: AppState, message: string, level?: string): AppState {
  const seq = state.seq + 1;
  // 帽 5：slice(-5) 滚动出清最旧（单源执法位——帧源与本地源同律）
  const notices = [...state.notices, { id: seq, message, level }].slice(-5);
  return { ...state, seq, notices };
}

/** decide 应答后本地出清（applied 与 superseded 同出清——异口已答） */
export function appliedDecide(state: AppState, approvalId: string): AppState {
  return { ...state, approvals: state.approvals.filter((a) => a.approvalId !== approvalId) };
}

/**
 * 审批清单投影落座（正确性层——整段重置，服务端现行 pending 清单即真源；
 * 与 loadedMessages 同模式）。异口已决条目随复拉出清：applyAsked 的 dedupe
 * 追加只适用于活体 asked 帧，投影复拉若同径只增不减——已决审批挂成幻影卡
 * 直至本口点选得 superseded 回执。
 */
export function loadedApprovals(state: AppState, entries: readonly ClientApprovalEntry[]): AppState {
  // 浅拷贝脱离调用方引用（api 层每响应新建——防御位）
  return { ...state, approvals: [...entries] };
}

/**
 * 乐观回显撤回键（= message_end 数值时间戳落稿键 m-<timestamp>——同源
 * 铸出，键律单源）。submit 腿乐观回显先持键，失败撤回（droppedMessage）
 * 按键定位，不靠尾部位置（撤回前可能有后续帧追加）。
 */
export function echoKeyOf(timestamp: number): string {
  return `m-${timestamp}`;
}

/** 按视图键撤回消息（submit 失败撤回乐观回显——未被受理的消息不以已送达形态驻留正文） */
export function droppedMessage(state: AppState, key: string): AppState {
  // 撤回同步出清待配对账目（回显已撤——后续同文镜像失配对面，正常落正文）
  return {
    ...state,
    messages: state.messages.filter((m) => m.key !== key),
    pendingEchoes: state.pendingEchoes.filter((p) => p.key !== key),
  };
}

/**
 * 乐观回显入账（webui-face#1 回显/镜像去重单源律的回显腿）：append 定稿形
 * user 位（键 = echoKeyOf(timestamp)）+ 登记待配对账目（会话域隔离——他
 * 会话同文镜像不配对）——服务端同会话同文镜像到达时由 message_end 吸收腿
 * 配对吸收。submit 成功路径专用（失败腿走 droppedMessage 撤回并出账）。
 */
export function echoedUserMessage(state: AppState, sessionId: string, text: string, timestamp: number): AppState {
  const key = echoKeyOf(timestamp);
  return {
    ...state,
    messages: [...state.messages, { key, role: 'user', text, streaming: false }],
    pendingEchoes: [...state.pendingEchoes, { sessionId, key, text }],
  };
}

/** 投影拉取落座（正确性层——整段重置正文，活体尾巴清场；配对账同步出清：投影已含回显本体） */
export function loadedMessages(state: AppState, messages: readonly unknown[]): AppState {
  const views: ViewMessage[] = [];
  let seq = state.seq;
  for (const message of messages) {
    seq += 1;
    const error = errorMessageOf(message);
    views.push({
      key: `p#${seq}`,
      role: messageRole(message),
      text: textOf(messageContent(message)),
      ...(error !== undefined ? { error } : {}),
      streaming: false,
    });
  }
  return { ...state, messages: views, seq, pendingEchoes: [] };
}

/** 会话清单落座 */
export function loadedSessions(state: AppState, sessions: readonly ClientSessionSummary[]): AppState {
  return { ...state, sessions };
}

/**
 * 会话切换（正文/todo 归零——onopen 重拉投影回填；配对账同步出清：旧会话
 * 在飞回显的镜像随切换被 activeId 守卫丢弃，账目不滞留污染新会话配对）。
 */
export function setActiveSession(state: AppState, sessionId: string | null): AppState {
  return { ...state, activeId: sessionId, messages: [], todo: null, status: null, pendingEchoes: [] };
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
