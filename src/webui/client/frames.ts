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

/**
 * run 收尾行角色名（收尾行的瞬时追加位专用——非对话角色，投影真源永不含
 * 此角色；Transcript 据此分派居中分隔线呈现形。07 §4.1 收尾行条款 webui 腿：
 * 成功形「─ 用时 X · HH:MM ─」〔≤60s 耗时段缺席〕/ 取消形「⏹ 对话已取消——
 * HH:MM」；瞬时追加行 = 不落投影、重拉即清、回放不可见）。
 */
export const RUN_CLOSE_ROLE = 'run_close';

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
  /**
   * 工具名映射（toolCallId → 工具名）：start 帧本携 name，而线协议 update/
   * end 帧只携 toolCallId——折叠器在 start 时记账，update/end 按名呈现
   * （TUI tool-progress-panel begin()/transcript pendingCalls 同律——07 §4.1
   * 跨通道同律）；end 时出账，会话切换整段清（有界）。
   */
  readonly toolNames: Readonly<Record<string, string>>;
  /** 会话清单装载失败旗（true = 空态呈现失败行——不与真空态混同假装「暂无会话」） */
  readonly sessionsFailed: boolean;
  /**
   * 会话全量总数（B2 截断披露——服务端清单默认最近 100 窗，total 与窗分立；
   * 缺席 = 不披露。侧栏超窗注记「N/M 会话（仅显示最近）」，判据 = total >
   * 清单长〔与 TUI session-picker 头行同律〕）。
   */
  readonly sessionsTotal?: number;
  /**
   * run 活体窗旗（display agent_start 开 / agent_end 关——打断键使能面与
   * 收尾行数据面的窗口半边）：中途附着（页面加载时 run 已在飞）看不到
   * agent_start 则窗缺席，收尾行耗时段随之诚实缺席（不虚造）。
   */
  readonly runActive: boolean;
  /**
   * 本 run 客户端观察起点（agent_start 帧到达时刻毫秒；null = 中途附着无
   * 起点）。近似注：事件到达 ≠ run 真实起点（服务端发射/网络传播延迟），
   * 服务端 durationMs 载荷（A-3）在场时以载荷为唯一真源，本值仅为回退位。
   */
  readonly runStartedAt: number | null;
  /**
   * 本 run 种子时刻（收尾行 HH:MM 段锚——发送时刻语义：agent_start 时快照
   * lastUserAt；null = 中途附着未见种子，回退 agent_end 观察时刻近似）。
   */
  readonly runSeedAt: number | null;
  /**
   * 本 run 工具活动旗（run 内 tool_execution_start 计数 > 0——纯对话轮收尾
   * 行整行缺席判据，与 codex had_work_activity 判据同构：无工具活动的轮次
   * 不值得收尾行噪音）。
   */
  readonly runSawTools: boolean;
  /**
   * 最近一条 user 消息时刻（echoedUserMessage 客户端钟 / 镜像 message_end
   * 服务端钟 / 投影末条 user——agent_start 快照为 runSeedAt 种子源）。
   */
  readonly lastUserAt: number | null;
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
  toolNames: {},
  sessionsFailed: false,
  runActive: false,
  runStartedAt: null,
  runSeedAt: null,
  runSawTools: false,
  lastUserAt: null,
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
 * 本地 HH:MM 时刻（收尾行时刻段形——本地钟呈现，与服务端时区无关）。
 */
function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 耗时人话形（1m 30s / 2h 5m 1s——与收尾行条款示例同形） */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

/**
 * run 收尾行文案（07 §4.1 收尾行条款 webui 腿——瞬时追加位，不进投影）：
 * - 失败终态 → null（错误块本体即呈现，不叠收尾行）；
 * - 取消形 → 「⏹ 对话已取消——HH:MM」；
 * - 纯对话轮（run 内零 tool_execution_start）→ null（整行缺席）；
 * - 成功形 → 「─ 用时 X · HH:MM ─」，≤60s 耗时段缺席只呈时刻。
 * 时刻段 = 发送时刻（runSeedAt——种子 user 消息时刻；中途附着未见种子回退
 * agent_end 观察时刻近似，不虚造）。耗时段优先服务端 durationMs 载荷（A-3
 * 唯一真源），缺席回退客户端观察窗（agent_start→agent_end 到达时刻差——
 * 近似值，含发射/传播延迟的诚实注记在 AppState.runStartedAt）。
 */
function runCloseLine(
  state: AppState,
  payload: { readonly status?: string; readonly durationMs?: unknown },
  now: number,
): string | null {
  if (payload.status === 'failed') return null; // 失败终态：错误块本体呈现，无收尾行
  const moment = clockOf(state.runSeedAt ?? now); // 发送时刻锚——种子缺席即观察终点近似
  if (payload.status === 'aborted') return `⏹ 对话已取消——${moment}`;
  if (!state.runSawTools) return null; // 纯对话轮整行缺席（had_work_activity 同构判据）
  // 耗时真源序：服务端载荷 > 客户端观察窗 > 诚实缺席
  const durationMs =
    typeof payload.durationMs === 'number'
      ? payload.durationMs
      : state.runStartedAt !== null
        ? now - state.runStartedAt
        : null;
  if (durationMs === null || durationMs <= 60_000) return `─ ${moment} ─`; // 无耗时数据/≤60s：耗时段缺席
  return `─ 用时 ${formatDuration(durationMs)} · ${moment} ─`;
}

/**
 * 信封折叠（纯函数）：display 族画流式尾巴 / session 族落稿与 asked 镜像 /
 * status·notify 各归其位。未知帧形静默忽略（前向兼容——服务端加型不炸客户端）。
 * now = 折叠时刻毫秒（run 观察窗/收尾行的可测注入口，缺省 Date.now——真流
 * 与组件测试同一折叠器的确定性测试面）。
 */
export function applyEnvelope(state: AppState, env: ClientEnvelope, now: number = Date.now()): AppState {
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
        const timestamp = messageTimestamp(payload.message);
        const { key, seq } = messageKey(state, timestamp);
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
        // user 落稿时刻入账（runSeedAt 种子源——服务端钟；回显被吸收形已由
        // echoedUserMessage 记客户端钟，两源同刻近似不区分）
        return {
          ...state,
          seq,
          messages,
          ...(role === 'user' && typeof timestamp === 'number' ? { lastUserAt: timestamp } : {}),
        };
      }
      if (payload.type === 'tool_execution_start') {
        if (env.kind !== 'display') return state;
        // id→名记账（update/end 帧只携 id——按名呈现的映射真源）；工具活动旗
        // 同步置位（收尾行纯对话轮判据的计数面）
        return {
          ...state,
          status: `⚙ ${payload.name} …`,
          toolNames: { ...state.toolNames, [payload.toolCallId]: payload.name },
          runSawTools: true,
        };
      }
      if (payload.type === 'tool_execution_update') {
        if (env.kind !== 'display') return state;
        // 名优先（start 已记账）；映射缺席（乱序/重连丢 start）回退 id 不炸
        return { ...state, status: `⚙ ${state.toolNames[payload.toolCallId] ?? payload.toolCallId} …` };
      }
      if (payload.type === 'tool_execution_end') {
        if (env.kind !== 'session') return state;
        const { key, seq } = messageKey(state, undefined);
        // 名优先同 update；终结出账（映射有界——同 id 迟到 update 回退 id）
        const name = state.toolNames[payload.toolCallId] ?? payload.toolCallId;
        const { [payload.toolCallId]: _removed, ...toolNames } = state.toolNames;
        return {
          ...state,
          seq,
          status: null,
          toolNames,
          messages: [...state.messages, { key, role: 'tool', text: `⚙ 工具 ${name} 执行完成`, streaming: false }],
        };
      }
      if (payload.type === 'agent_start') {
        // run 活体窗开窗（收尾行/打断键的数据面）：观察起点 = 帧到达时刻、
        // 种子时刻 = 最近 user 消息时刻（发送时刻语义）。重试续跑的再次
        // agent_start 重开窗——耗时段回退位只覆末次尝试（整 run 口径以服务端
        // durationMs 载荷为准，在场必用）。
        return {
          ...state,
          runActive: true,
          runStartedAt: now,
          runSeedAt: state.lastUserAt ?? now,
          runSawTools: false,
        };
      }
      if (payload.type === 'agent_end') {
        // 终态分档（03 §10.4 SPA 呈现面终态条款②——07 §4.1 件 6 跨通道同律）：
        // failed/aborted 显式呈现不伪装成功；completed/缺席归闲态
        // （修前不分 status 恒归闲态——失败 run 状态行无痕伪收场）
        const status = payload.status === 'failed' ? '✖ 失败' : payload.status === 'aborted' ? '⏹ 已中止' : null;
        // run 收尾行（07 §4.1 收尾行条款）：失败终态无收尾行（错误块本体呈现）；
        // 其余终态按 runCloseLine 组形瞬时追加（不落投影——重拉/回放不可见）
        const closeText = runCloseLine(state, payload, now);
        const { key, seq } = messageKey(state, undefined);
        return {
          ...state,
          seq,
          status,
          // 活体窗整段收束（下一 agent_start 重开）
          runActive: false,
          runStartedAt: null,
          runSeedAt: null,
          runSawTools: false,
          ...(closeText !== null
            ? { messages: [...state.messages, { key, role: RUN_CLOSE_ROLE, text: closeText, streaming: false }] }
            : {}),
        };
      }
      // turn_* 不进正文视图（v1 呈现最小面）
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

/** 通知入账的逆操作（手动关闭——按 id 出清一条；id 不在场幂等无操作） */
export function dismissNotice(state: AppState, id: number): AppState {
  return { ...state, notices: state.notices.filter((n) => n.id !== id) };
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
    // 回显时刻入账（runSeedAt 种子源——客户端钟；服务端镜像到达时吸收回显
    // 不更新此位，两源同刻近似）
    lastUserAt: timestamp,
  };
}

/** 投影拉取落座（正确性层——整段重置正文，活体尾巴清场；配对账同步出清：投影已含回显本体） */
export function loadedMessages(state: AppState, messages: readonly unknown[]): AppState {
  const views: ViewMessage[] = [];
  let seq = state.seq;
  let lastUserAt: number | null = null;
  for (const message of messages) {
    seq += 1;
    const error = errorMessageOf(message);
    const timestamp = messageTimestamp(message);
    const role = messageRole(message);
    views.push({
      key: `p#${seq}`,
      role,
      text: textOf(messageContent(message)),
      ...(error !== undefined ? { error } : {}),
      streaming: false,
    });
    // 投影内末条 user 时刻入账（中途附着/重连场景的收尾行种子锚——投影是
    // 正确性层真源，服务端钟优先于观察钟）
    if (role === 'user' && typeof timestamp === 'number') lastUserAt = timestamp;
  }
  return { ...state, messages: views, seq, pendingEchoes: [], lastUserAt };
}

/** 会话清单落座（成功即撤失败旗——失败行只随最新一次装载结果呈现；total 随批落座，缺席 = 不披露） */
export function loadedSessions(state: AppState, sessions: readonly ClientSessionSummary[], total?: number): AppState {
  return { ...state, sessions, sessionsTotal: total, sessionsFailed: false };
}

/** 会话清单装载失败落旗（空态呈现失败行——与真空态分立，不假声明「暂无会话」） */
export function failedSessions(state: AppState): AppState {
  return { ...state, sessionsFailed: true };
}

/**
 * 会话切换（正文/todo 归零——onopen 重拉投影回填；配对账与工具名映射同步
 * 出清：旧会话在飞回显的镜像随切换被 activeId 守卫丢弃，账目不滞留污染新
 * 会话配对；旧会话工具名映射对新会话 id 无意义，整段清）。
 */
export function setActiveSession(state: AppState, sessionId: string | null): AppState {
  return {
    ...state,
    activeId: sessionId,
    messages: [],
    todo: null,
    status: null,
    pendingEchoes: [],
    toolNames: {},
    // run 活体窗随会话切换整段清（新会话的收尾行/打断键面由新流重开——
    // 旧会话的观察窗对新会话无意义）
    runActive: false,
    runStartedAt: null,
    runSeedAt: null,
    runSawTools: false,
    lastUserAt: null,
  };
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
