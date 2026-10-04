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
// 跨通道单源件（contracts 零依赖叶——channels 公开面桶经 theme/custom 拉
// node:fs，DOM 类型面与浏览器包结构性不可承；durations/tool-face 同批迁入）：
// 工具名用户面动词（V-0 注⑤呈现层转写——数据面 toolNames 记账保原始名）、
// 工具运行标记（TOOL_RUN_MARK——start 状态行/终结行引导符单源）、run 收尾
// 行整行构造（runRecapLine——2026-10-04 收尾行段拼装双站单源化批收编，本件
// runCloseLine 与 tui-backend appendClosingLine 双拷贝自此同源）与取消形
// 时刻段 HH:MM（formatClockHM——原 clockOf 逐字克隆收编，双消费面
// （tui-backend 收尾行 / webui 取消回执）均已改引本源）。
import { formatClockHM, runRecapLine, TOOL_RUN_MARK, toolFaceZh } from '../../contracts/index.js';

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
  /**
   * 审批清单复拍未见账（第九轮 laneE2 件2——E4 同族两拍律的审批面）：
   * approvalId → 连续未见拍数。keyed 对账半边：本地已有、复拉清单未见的
   * 审批记 1 拍；连续 2 拍未见才撤（陈响应窗护住 asked 帧刚建的活动审批
   * ——fetch 早于服务端登记发出的响应只陈一拍）。清单确认在场即清账重起算。
   */
  readonly approvalMissTicks: Readonly<Record<string, number>>;
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
   * 本 run 工具执行计数（display tool_execution_start 递增；重试续入不清
   * ——收尾行工具段供数 + 纯对话轮双零缺席判据半边。原布尔旗 runSawTools 随
   * V-0 注⑥翻形计数化——段文案需现值）。
   */
  readonly runToolCount: number;
  /**
   * 本 run 重试计数（display retry_wait_start 递增；重试续入不清——收尾行
   * 重试段供数 + 双零缺席判据半边。V-0 注⑥跨通道对端）。
   */
  readonly runRetryCount: number;
  /**
   * 重试续入标记（retry_wait_end(resumed) 置位、下一 agent_start 消费复位：
   * 续入是同一 run 的断点续跑非新 run——run 级账〔工具/重试计数、种子〕不清，
   * 整 run 口径律。观察窗 runStartedAt 例外重开——耗时段回退位只覆末次尝试，
   * durationMs 载荷在场必用）。
   */
  readonly retryContinuation: boolean;
  /**
   * 失败原因**持有档**（E1——TUI tui-backend pendingFailReason 同律）：线协议
   * agent_end(failed) 不一定是真终态（transient 腿随后 retry_wait_start 退避 →
   * retry_wait_end 收口）。failed 到达即存账不揭示（状态行不闪 ✗、run 账不
   * 冻结、活体窗维持）；由 retry_wait_end {aborted|exhausted} 揭示同句携因并
   * 消费清账，resumed 续入 / agent_start 撤销持有。失败直呈律（V-0 注②）：
   * 原因随揭示同句供位，缺席裸形兜底。
   */
  readonly pendingFailReason: string | null;
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
  approvalMissTicks: {},
  notices: [],
  todo: null,
  seq: 0,
  pendingEchoes: [],
  toolNames: {},
  sessionsFailed: false,
  runActive: false,
  runStartedAt: null,
  runSeedAt: null,
  runToolCount: 0,
  runRetryCount: 0,
  retryContinuation: false,
  pendingFailReason: null,
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
 * 本地 HH:MM 时刻（取消形时刻段——取消回执非记账行，时刻段保留形维持；
 * 本地钟呈现，与服务端时区无关）——formatClockHM 单源（contracts——与
 * tui-backend 收尾行同源，原 clockOf 逐字克隆已收编）。
 */

/**
 * run 收尾行文案（07 §4.1 收尾行条款 webui 腿 + V-0 注⑥对端翻形——瞬时追加
 * 位，不进投影）：
 * - 失败终态 → null（错误块本体即呈现，不叠收尾行）；
 * - 取消形 → 「⏹ 对话已取消——HH:MM」（取消回执非记账行——时刻段保留形，
 *   不受纯对话轮判据约束；时刻锚 = 发送时刻 runSeedAt，中途附着回退 agent_end
 *   观察时刻近似，不虚造）；
 * - 纯对话轮（工具 ∧ 重试计数双零）→ null（整行缺席——不设时长门）；
 * - 成功形 → 「── 用时 X · 工具 N 次 · 重试 M ──」（段缺席形：零计数段省略；
 *   重试段无「次」字——规范真源措辞）。
 * 耗时优先服务端 durationMs 载荷（A-3 唯一真源），缺席回退客户端观察窗
 * （agent_start→agent_end 到达时刻差——近似值，发射/传播延迟诚实注记在
 * AppState.runStartedAt），皆无诚实缺席（行仍落）；成功形整行构造单源
 * （contracts runRecapLine——与 TUI 收尾行真同源，段形知识见单源处）。
 */
function runCloseLine(
  state: AppState,
  payload: { readonly status?: string; readonly durationMs?: unknown },
  now: number,
): string | null {
  if (payload.status === 'failed') return null; // 失败终态：错误块本体呈现，无收尾行
  if (payload.status === 'aborted') return `⏹ 对话已取消——${formatClockHM(state.runSeedAt ?? now)}`;
  if (state.runToolCount === 0 && state.runRetryCount === 0) return null; // 纯对话轮整行缺席（双零判据）
  // 耗时真源序：服务端载荷 > 客户端观察窗 > 诚实缺席
  const durationMs =
    typeof payload.durationMs === 'number'
      ? payload.durationMs
      : state.runStartedAt !== null
        ? now - state.runStartedAt
        : null;
  // 段集/整行构造单源（contracts runRecapLine——2026-10-04 双站单源化批收编：
  // 本函数原三段 push + 段头段尾拼装与 tui-backend appendClosingLine 逐字同构
  // 双拷贝，自此段形知识单源；调用侧只守失败/取消/双零/耗时折取四判据）
  return runRecapLine({ durationMs, toolCount: state.runToolCount, retryCount: state.runRetryCount });
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
    case 'status': {
      // 终态 status 信封 = run 已收口的权威供数（服务端 SSE 受理尾快照补帧
      // ——第八轮 laneF F2 客户端半边）：断连窗丢 agent_end 的重连观众由此
      // 复位 run 账（runActive 恒挂 → 打断键伪使能——runInFlight 首信号），
      // 连线形与 agent_end 折叠位幂等双清；非终态 status（在飞档位/收据）
      // 只更新状态行——中途附着 run 在飞时的补位信号（App runInFlight 三
      // 信号之一）不误伤
      if (isTerminalStatus(env.payload.status)) {
        return {
          ...state,
          status: env.payload.status,
          runActive: false,
          runStartedAt: null,
          runSeedAt: null,
          runToolCount: 0,
          runRetryCount: 0,
          retryContinuation: false,
          pendingFailReason: null, // 已揭示形直呈（终态信封不带持有档——防御清）
        };
      }
      return { ...state, status: env.payload.status };
    }
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
        // id→名记账（update/end 帧只携 id——按名呈现的映射真源；**原始名记账**，
        // 呈现位过 toolFaceZh 转写——分层律：数据面保原始名）；工具计数递增
        // （收尾行工具段供数 + 双零缺席判据半边——重试续入不清，整 run 口径）
        return {
          ...state,
          status: `${TOOL_RUN_MARK} ${toolFaceZh(payload.name)} …`,
          toolNames: { ...state.toolNames, [payload.toolCallId]: payload.name },
          runToolCount: state.runToolCount + 1,
        };
      }
      if (payload.type === 'tool_execution_update') {
        if (env.kind !== 'display') return state;
        // 名优先（start 已记账）；映射缺席（乱序/重连丢 start）回退 id 不炸——
        // 两形均过 toolFaceZh（集外名直呈兜底——id 不在映射集原样返回）
        const name = state.toolNames[payload.toolCallId] ?? payload.toolCallId;
        return { ...state, status: `${TOOL_RUN_MARK} ${toolFaceZh(name)} …` };
      }
      if (payload.type === 'tool_execution_end') {
        if (env.kind !== 'session') return state;
        // 稳定键 tool-<toolCallId>（E4——onopen 交错窗对账的键律半边：与投影
        // toolResult 的 toolCallId 身份同一；顺带幂等位——同 id 终结帧异常重发
        // 不二次落行）
        const key = `tool-${payload.toolCallId}`;
        if (state.messages.some((m) => m.key === key)) return state; // 幂等（重发防御）
        // 名优先同 update；终结出账（映射有界——同 id 迟到 update 回退 id）；
        // 终结行动词走 toolFaceZh（V-0 注⑤跨通道对端）
        const name = state.toolNames[payload.toolCallId] ?? payload.toolCallId;
        const { [payload.toolCallId]: _removed, ...toolNames } = state.toolNames;
        // 终态行失败分档：判据 = 工具结果 isError（TUI 三态卡同源位）；终态行
        // 只换语气词——失败详情走 assistant errorMessage 轨（错误块本体呈现），
        // result/isError 缺席（旧服务端/坏形容错）按成功呈现（可选位向后兼容）
        const failed = payload.result !== undefined && payload.result.isError === true;
        // 兄弟在飞守卫（E3）：executeToolBatch 并发段完成序交错——批内先完成者
        // 不空清状态行（read 无进度回调的空窗持续到其 end），回写最晚启动的
        // 兄弟名执行中；仅账空（最后一个 end）才清空
        const remainingIds = Object.keys(toolNames);
        const siblingStatus =
          remainingIds.length > 0
            ? `${TOOL_RUN_MARK} ${toolFaceZh(toolNames[remainingIds[remainingIds.length - 1]!]!)} …`
            : null;
        return {
          ...state,
          status: siblingStatus,
          toolNames,
          messages: [
            ...state.messages,
            {
              key,
              role: 'tool',
              text: `${TOOL_RUN_MARK} ${toolFaceZh(name)} ${failed ? '执行失败' : '执行完成'}`,
              streaming: false,
            },
          ],
        };
      }
      if (payload.type === 'retry_wait_start') {
        if (env.kind !== 'display') return state;
        // 态③ 重试呈现（E1——TUI taskLine.enterRetry 呈现形对齐）：倒计时呈现
        // 未立项（nextAt 绝对时刻须本地钟 ticker——视界不收），静态「第 n/N 次」
        // 段 + 省略号活体感；载荷缺席（旧服务端/坏形容错）裸形兜底。
        // 收尾行重试段计数（V-0 注⑥跨通道对端）——整 run 口径，agent_start
        // 续入形不清（retryContinuation 分诊）
        const attemptText =
          typeof payload.attempt === 'number' && typeof payload.maxAttempts === 'number'
            ? ` 第 ${payload.attempt}/${payload.maxAttempts} 次`
            : '';
        return { ...state, status: `重试中${attemptText} …`, runRetryCount: state.runRetryCount + 1 };
      }
      if (payload.type === 'retry_wait_end') {
        if (env.kind !== 'display') return state;
        if (payload.outcome === 'resumed') {
          // 续入：撤重试呈现归活体（TUI retry_wait_end(resumed) → enterWorking
          // 同律）+ 续入标记（下一 agent_start 消费——run 级账不清）+ 持有档
          // 撤销（断点续跑——陈因不残留；TUI 在 agent_start 清，此间无帧序差）
          return { ...state, retryContinuation: true, status: null, pendingFailReason: null };
        }
        // aborted / exhausted：终态揭示（E1 持有档消费位）——✗ 携因驻留至下个
        // agent_start + run 账收口。失败直呈律（V-0 注②）：原因自持有档供位，
        // 缺席（中途附着错失 agent_end 等）裸形兜底（诚实缺席非陈因）。failed
        // 无收尾行（错误块本体呈现——runCloseLine 同判据）；可无配对 start
        //（不可重试首败形）
        return {
          ...state,
          status: state.pendingFailReason !== null ? `✗ 失败 · ${state.pendingFailReason}` : '✗ 失败',
          pendingFailReason: null, // 消费即清（终态后账不复用——TUI 同律）
          runActive: false,
          runStartedAt: null,
          runSeedAt: null,
          runToolCount: 0,
          runRetryCount: 0,
          retryContinuation: false,
        };
      }
      if (payload.type === 'agent_start') {
        // run 活体窗开窗（收尾行/打断键的数据面）：观察起点 = 帧到达时刻、
        // 种子时刻 = 最近 user 消息时刻（发送时刻语义）。
        if (state.retryContinuation) {
          // 续入（retry_wait_end(resumed) 后的再次 agent_start）：同一 run 断点
          // 续跑——run 级账（工具/重试计数、种子）不清（整 run 口径）；观察窗
          // 重开（耗时段回退位只覆末次尝试——durationMs 载荷在场必用）；持有
          // 档撤销（resumed 已撤——防御位）；状态行不动（TUI 续入不清 statusLine）
          return {
            ...state,
            runActive: true,
            runStartedAt: now,
            retryContinuation: false,
            pendingFailReason: null,
          };
        }
        return {
          ...state,
          runActive: true,
          runStartedAt: now,
          runSeedAt: state.lastUserAt ?? now,
          runToolCount: 0,
          runRetryCount: 0,
          // E2：fresh run 清状态行（对齐 TUI resetUsage 末句清行腿——上一 run 的
          // ⏹/✗ 终态文案不跨 run 残留驻入新 run）
          status: null,
          pendingFailReason: null, // 持有档清账（TUI agent_start 无分支同律——新 run 起陈因不残留）
        };
      }
      if (payload.type === 'agent_end') {
        // ⚠ 持有档（E1——TUI tui-backend agent_end failed 分支同律）：failed 不
        // 立即终态化——驱动侧保证 failed 后必随发 retry_wait_start（退避窗开）、
        // retry_wait_end {aborted|exhausted}（终态收口）或孤儿 retry_wait_end
        // {resumed}（overflow compacted 续入——07 件 12 扩第三形〔第七轮深扫批，
        // 04 §3.4 尾注真源〕；本件 :441 resumed 分支撤持有同承载）。持有窗内状态行不闪
        // ✗、run 账不冻结（退避窗计时计入 run 时长——收尾行整 run 口径）、活体
        // 窗维持（打断键在退避窗内仍可打断——TUI ESC 同语义）。揭示/撤销归
        // retry_wait_end 与 agent_start 分诊位。
        if (payload.status === 'failed') {
          return { ...state, pendingFailReason: payload.errorMessage ?? null };
        }
        // completed / aborted：真终态——终态分档（03 §10.4 SPA 呈现面终态条款②
        // ——07 §4.1 件 6 跨通道同律）：aborted 显式呈现不伪装成功；completed/
        // 缺席归闲态。
        const status = payload.status === 'aborted' ? '⏹ 已中止' : null;
        // run 收尾行（07 §4.1 收尾行条款）：失败终态无收尾行（错误块本体呈现）；
        // 其余终态按 runCloseLine 组形瞬时追加（不落投影——重拉/回放不可见）
        const closeText = runCloseLine(state, payload, now);
        const { key, seq } = messageKey(state, undefined);
        return {
          ...state,
          seq,
          status,
          // 活体窗整段收束（下一 agent_start 重开）——run 级计数连清（跨 run 残账防御）
          runActive: false,
          runStartedAt: null,
          runSeedAt: null,
          runToolCount: 0,
          runRetryCount: 0,
          retryContinuation: false,
          pendingFailReason: null, // 持有档防御清（错帧序兜底——正常序已在分诊位消费）
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

/** decide 应答后本地出清（applied 与 superseded 同出清——异口已答）；未见账随行出清（条目已撤——账不滞留） */
export function appliedDecide(state: AppState, approvalId: string): AppState {
  const { [approvalId]: _tick, ...missTicks } = state.approvalMissTicks;
  return { ...state, approvals: state.approvals.filter((a) => a.approvalId !== approvalId), approvalMissTicks: missTicks };
}

/**
 * 审批清单投影落座（正确性层——keyed 对账，服务端现行 pending 清单即真源）。
 *
 * E4 同族两拍律（第九轮 laneE2 件2）：asked 镜像帧与复拉清单响应的交错窗
 * 无对账——后到的清单响应整体覆盖会把 asked 帧刚建的活动审批吞掉（周期拍
 * fetch 早于服务端登记发出、响应晚于 asked 帧到达的竞速窗；messages 位 E4
 * 同族竞速在审批面修前缺位）。对账形：清单确认在场的直接刷新；「本地已有、
 * 清单未见」的记 missing 一拍，连续两拍未见才撤——陈响应只陈一拍（服务端
 * 在 asked 帧发射前已登记，下一拍现行清单必含），两拍皆缺即真不在（异口
 * 已决条目随复拉出清的既有语义，代价是迟一拍消卡）。applyAsked 的增量
 * 合并径只留给活体 asked 帧（首拍保位的活动审批不与清单新条目重复推）。
 */
export function loadedApprovals(state: AppState, entries: readonly ClientApprovalEntry[]): AppState {
  const listed = new Map(entries.map((e) => [e.approvalId, e]));
  const kept: ClientApprovalEntry[] = [];
  // 未见账每次按当次清单重建（在场即清——miss 连击只对连续未见起算）
  const missTicks: Record<string, number> = {};
  for (const local of state.approvals) {
    const fresh = listed.get(local.approvalId);
    if (fresh !== undefined) {
      kept.push(fresh); // 清单确认在场——刷新清单侧最新形态（真源）
      continue;
    }
    const ticks = (state.approvalMissTicks[local.approvalId] ?? 0) + 1;
    if (ticks >= 2) continue; // 连续第二拍未见——撤（真不在场：异口已决/已撤销）
    kept.push(local); // 首拍未见——保（陈响应窗护住 asked 刚建的活动审批）
    missTicks[local.approvalId] = ticks;
  }
  // 清单新增（本地未见——他会话/外部口新建）直接进入
  for (const e of entries) {
    if (!state.approvals.some((a) => a.approvalId === e.approvalId)) kept.push(e);
  }
  // 浅拷贝脱离调用方引用（api 层每响应新建——防御位）
  return { ...state, approvals: [...kept], approvalMissTicks: missTicks };
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

/**
 * 投影拉取落座（正确性层——整段重置正文，活体尾巴清场）。
 *
 * onopen 交错窗对账（E4）：App 侧 onopen 恒重拉投影，fetch 异步窗内到达的
 * session 族终结帧（message_end/tool_execution_end）先落稿——快照若早于该
 * 帧的 durable 记录（服务端 GET 先处理），整段重置会抹除已落稿帧，而长连接
 * 内 session 族无重发（不自愈）。落座时对账：**快照已含的不重复推**（投影
 * 副本即真源——live 副本让位）；**快照未含的已落稿帧不抹**（记录晚于快照
 * ——续接投影尾，时序上必后于全部快照消息）。
 *
 * 对账键律（文本多重集根修——两钟域不可配）：live 正文行 m-<数值> 键的
 * 时间戳是**构造钟**（回显 = 浏览器 submit 时刻；message_end 落稿 = driver
 * loop pushAll 构造时刻），投影消息 timestamp 是 **durable 追加钟**
 * （reseedTimeline timeOf = events[seq].time）——两钟域永不相等，旧注
 * 「m-<数值时间戳>（身份同一）」前提错误，数值全等判据结构性恒假（已吸收
 * 回显、非回显 user、assistant、toolResult 的落稿行全部穿透双份且历次
 * reload 重复保留）。新键律：
 * - message_end 落稿/回显行 → (role,text) **多重集**对账（快照侧键 =
 *   role + '\u0000' + text → 计数；空文本不入集——坏形不吞让位判据）：
 *   计数 > 0 → 扣减让位（投影副本即真源）；计数尽 → 保位。遍历维持
 *   state.messages 时间序——旧同文行先消耗计数，后到的在途回显保位（天然
 *   正确）；同文多份场景按份数对账（单集判据分不清一份/两份）。
 * - 工具终结行 → toolCallId（投影 toolResult 序列化在场——与 live 行
 *   tool-<toolCallId> 身份同一）。
 *
 * 回显配对账随行命运：让位的回显行不进保留集（配对账出清——投影已含
 * 本体，重连形镜像不至）；保位的进（镜像后至仍吸收恰一份）——判定路径
 * 即多重集消耗结果（旧 pendingEchoes 前置 + 单集文本判据已随键律退役）。
 */
export function loadedMessages(state: AppState, messages: readonly unknown[]): AppState {
  const views: ViewMessage[] = [];
  let seq = state.seq;
  let lastUserAt: number | null = null;
  // 对账索引两面：快照正文多重集（键 = role + '\u0000' + text → 计数；空
  // 文本不入集——坏形不吞让位判据）/ 快照 toolCallId 集。数值时间戳集已
  // 退役——live 构造钟与投影追加钟两钟域永不相等，全等判据结构性恒假
  //（对账键律详见函数头注）
  const snapTextCounts = new Map<string, number>();
  const snapToolIds = new Set<string>();
  for (const message of messages) {
    seq += 1;
    const error = errorMessageOf(message);
    const timestamp = messageTimestamp(message);
    const role = messageRole(message);
    const text = textOf(messageContent(message));
    if (text !== '') {
      const snapKey = role + '\u0000' + text;
      snapTextCounts.set(snapKey, (snapTextCounts.get(snapKey) ?? 0) + 1);
    }
    const toolId = messageToolCallId(message);
    if (toolId !== null) snapToolIds.add(toolId);
    views.push({
      key: `p#${seq}`,
      role,
      text,
      ...(error !== undefined ? { error } : {}),
      streaming: false,
    });
    // 投影内末条 user 时刻入账（中途附着/重连场景的收尾行种子锚——投影是
    // 正确性层真源，服务端钟优先于观察钟）
    if (role === 'user' && typeof timestamp === 'number') lastUserAt = timestamp;
  }
  // 交错窗对账（E4）：活体已落稿且快照未含的终结帧不抹——流式尾巴（投影
  // 接管——终稿后至自会再落）与 run 收尾行（瞬时追加位重拉即清，既有律）除外
  const kept: ViewMessage[] = [];
  const keptEchoKeys = new Set<string>();
  for (const m of state.messages) {
    if (m.streaming || m.role === RUN_CLOSE_ROLE) continue;
    const ts = numericKeyOf(m.key);
    if (ts !== null) {
      // 正文多重集对账：本体已在快照（计数 > 0）→ 扣减让位（投影副本即真源
      // ——不重复推）；计数尽（快照未含——记录晚于快照）→ 保位续接投影尾。
      // 遍历维持时间序——旧同文行先消耗计数，后到的在途回显在计数尽后保位
      const snapKey = m.role + '\u0000' + m.text;
      const count = m.text !== '' ? (snapTextCounts.get(snapKey) ?? 0) : 0;
      if (count > 0) {
        snapTextCounts.set(snapKey, count - 1);
        continue; // 让位——回显让位形配对账随之出清（不进 keptEchoKeys）
      }
      if (m.role === 'user' && state.pendingEchoes.some((p) => p.key === m.key)) {
        keptEchoKeys.add(m.key); // 在途回显保位——配对账保留（镜像后至仍吸收）
      }
      kept.push(m);
      if (m.role === 'user') lastUserAt = ts; // 保留位晚于快照——种子锚随之推进
      continue;
    }
    const toolId = toolKeyOf(m.key);
    if (toolId !== null && !snapToolIds.has(toolId)) {
      kept.push(m); // 工具终结行：快照未含该 toolResult——live 行存活
    }
  }
  return {
    ...state,
    messages: [...views, ...kept],
    seq,
    // 配对账：在途回显保位者保留（镜像后至吸收恰一份），其余出清（投影已含
    // 本体或回显已让位——原整段出清律）
    pendingEchoes: state.pendingEchoes.filter((p) => keptEchoKeys.has(p.key)),
    lastUserAt,
  };
}

/**
 * 终态状态行判据（E2 连带面——run 在飞信号的排除半边）：agent_end aborted
 * 与重试终局揭示的 ✗ 形是「run 已收口」的呈现，不计入在飞信号（打断键闲态
 * 诚实禁用）。词面与 agent_end/retry_wait_end 两发射位单源同文——改词必同步。
 */
export function isTerminalStatus(status: string): boolean {
  return status === '⏹ 已中止' || status === '✗ 失败' || status.startsWith('✗ 失败 · ');
}

/**
 * 回执型状态行判据（第九轮 laneE2 件1——run 在飞信号的排除半边之二）：档位
 * 切换回执（思考级别/沙箱模式）是驻留型 status 非 run 进度——runInFlight 第
 * 二信号不得计入。修前形：切档后闲态打断键伪使能驻留至下一 run；SSE 受理尾
 * 快照补帧（laneF 笔7）使重连/新开页观众复活陈回执同形伪使能。
 *
 * 闭集词面前缀匹配（词面清单与来源——客户端树隔离不 import host 件，改回执
 * 模板必同步本表；词面形锁见 frames.test 词面→布尔表）：
 * - 「思考级别：」← thinkingLevelReceipt（host/session-tier-copy.ts 回执
 *   单源；tui-entry /thinking 选档与 webui 桥 PUT 应答尾两发射位同文，经
 *   通道核 setStatus 扇出到达 SPA）
 * - 「沙箱模式：」← sandboxModeReceipt（同上单源；/sandbox 选档与 PUT）
 *
 * 盘点注：webui 可见 setStatus 生产者全集 = 上述两族回执 + 插件面
 * ctx.ui.setStatus（开放词汇不可闭集分类——维持进度型缺省计入在飞，保守向：
 * 宁可伪使能不可漏使能）+ 客户端本造进度行（工具执行/重试呈现，frames 内
 * 直写非 setStatus 帧）。
 */
export function isReceiptStatus(status: string): boolean {
  return status.startsWith('思考级别：') || status.startsWith('沙箱模式：');
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
    runToolCount: 0,
    runRetryCount: 0,
    retryContinuation: false,
    pendingFailReason: null, // 持有档随切换出清（旧会话退避窗对新会话无意义）
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

/**
 * m-<数值> 键解析（message_end 落稿/回显键族识别——E4 交错窗对账据此走
 * (role,text) 多重集对账腿；数值本身是构造钟，不再作身份判据〔两钟域不可
 * 配——见 loadedMessages 头注〕；非本形回 null）
 */
function numericKeyOf(key: string): number | null {
  if (!key.startsWith('m-')) return null;
  const digits = key.slice(2);
  if (digits === '') return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** tool-<toolCallId> 键解析（工具终结行键族——E4 对账与投影 toolResult 身份同一；非本形回 null） */
function toolKeyOf(key: string): string | null {
  return key.startsWith('tool-') ? key.slice(5) : null;
}

/** 投影 toolResult 消息的 toolCallId 抽取（E4 对账索引半边——非本形/坏形回 null） */
function messageToolCallId(message: unknown): string | null {
  if (typeof message === 'object' && message !== null && 'toolCallId' in message) {
    const value = (message as { toolCallId: unknown }).toolCallId;
    if (typeof value === 'string') return value;
  }
  return null;
}

function partialContent(partial: unknown): unknown {
  return messageContent(partial);
}
