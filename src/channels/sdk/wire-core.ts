/**
 * SDK 线协议核心（03 篇 §10.6 线协议七原则的运转件——批 13b-2）。
 *
 * 架构位：单连接状态机。请求面六动词受理（hello 版本握手/游标重放、prompt
 * admit+受理、interrupt、decide、getEntries、sessions）+ 活体事件外推腿
 * （delta 剥快照的订阅侧过滤 + durable 水位 seq 指派）+ 心跳装配面（静默
 * 填充式——tick 由宿主定时驱动，件内零自驱时钟）+ 出站有界队列背压（⑦）。
 *
 * **依赖全注入**（channels 边表律——conversation/session/persist 面一律经
 * 装配桥注入回调，FetchProjection 先例同款）：本件只吃契约类型与注入面，
 * 传输归宿主 serve（13c stdio）/core:sdk 件（13e HTTP+SSE）——`sink` 抽象
 * 单点承接，两传输同律吃本核，零第二套。
 *
 * **衔接序与同步读面**（05 §3.5 衔接序①②③）：注入读面全同步 ⇒ 订阅 =
 * 「先快照高水位→重放至快照→replay-end→挂活体监听」在单同步事务内原子
 * 完成——活体缓冲窗不存在（快照后事件只走直播段，零跨段重复零丢失——
 * 双轨律按构造成立）。异步读面（13e HTTP durable 查询跨 tick）需引入
 * 订阅期活体缓冲——挂账 13e，届时仅扩本件订阅相位机不改协议词汇。
 */
import type { AgentEvent } from '../../agent/index.js';
import type { ApprovalAskAnswer, RetryProbe } from '../../contracts/index.js';
import { admitMessage } from './admit.js';
import { validateAfterCursor } from './cursor.js';
import {
  SDK_PROTOCOL_VERSION,
  type SdkDurableEntry,
  type SdkRequest,
  type SdkSessionSummary,
  type SdkWireFrame,
} from './protocol.js';

/** 会话状态三档（prompt 受理门 + hello 订阅门共用判据——装配桥映射真源） */
export type SdkSessionState = 'open' | 'closed' | 'missing';

/** durable 读面分页（queryEntries 注入面载荷——窗口 (since, 高水位] 投影） */
export interface SdkDurablePage {
  entries: SdkDurableEntry[];
  /** 分页续读游标（05 §3.4——缺席 = 已跟尽） */
  nextCursor?: string;
}

/** prompt 受理注入面载荷（fresh 档唯一写路径——admit 判定在核内先决） */
export interface SdkSubmitInput {
  sessionId?: string;
  content: string;
  messageId: string;
}

/** prompt 受理结果（sessionId 缺席新建时由桥落定回示——调用方以此获会话句柄） */
export interface SdkSubmitOutcome {
  sessionId: string;
  /** 驱动侧单源路由观察（在飞 run 时的并发路由结果——缺席 = 新开轮） */
  routedChannel?: 'steer' | 'followUp';
}

/**
 * 出站传输 sink 抽象（单点承接两传输）。`write` 返回 false = 传输面暂不可写
 * （背压）——帧入有界队列待 {@link SdkWireCore.drain}（宿主 writable 时调用）。
 */
export interface SdkOutboundSink {
  write(frame: SdkWireFrame): boolean;
}

/** 注入面全集（装配桥 13c/13e 实装——channels 边表律的执法位） */
export interface SdkWireDeps {
  sink: SdkOutboundSink;
  /** prompt 受理（fresh 档唯一写路径） */
  submitPrompt(input: SdkSubmitInput): SdkSubmitOutcome;
  /** durable dedupeKey 查面（跨重启幂等腿——durable 即真相，05 §3.5 第二腿） */
  lookupDedupeKey(sessionId: string, messageId: string): string | undefined;
  /** 打断在飞 run（受理经事件流可观察——无应答帧） */
  interruptSession(sessionId: string): void;
  /** durable 平铺投影读面（(since, 高水位] 窗口——与重放同源） */
  queryEntries(sessionId: string, since: number, cursor?: string): SdkDurablePage;
  /** 会话清单 */
  listSessions(): SdkSessionSummary[];
  /** 会话高水位（= 内存日志长度；missing 会话 = undefined） */
  highWaterOf(sessionId: string): number | undefined;
  /** 会话状态三档 */
  sessionStateOf(sessionId: string): SdkSessionState;
  /** 驱动重试只读小面（心跳 retry 阶段唯一线面出口——04 §2 零新事件型） */
  retryProbeOf(sessionId: string): RetryProbe | null;
  /** 审批应答（跨入口竞速回执——unknown 归 superseded，由 13b-3 后端实装） */
  decideApproval(approvalId: string, answer: ApprovalAskAnswer, note?: string): 'applied' | 'superseded';
  /** 订阅受理钩（未决 ask 全量重推位——13b-3 挂；重连补推语义） */
  onSubscribed?(sessionId: string): void;
  /** 过载断连钩（SDK_OVERLOADED 已尽力直写后调用——宿主关传输） */
  onOverload?(retryAfterMs: number): void;
}

/** 构造选项（时钟/节拍/背压参全注入——测试确定性） */
export interface SdkWireOptions {
  /** 假钟注入位（心跳 elapsedMs/stageElapsedMs 与静默判据的时源） */
  now?: () => number;
  /** 心跳静默阈值（毫秒——会话级最近一帧距今超阈即 tick 补拍） */
  heartbeatIntervalMs?: number;
  /** 出站有界队列容量（⑦ 背压——溢出先丢纯活体帧、线控帧不可丢则断连） */
  queueCap?: number;
  /** SDK_OVERLOADED 载荷 retryAfterMs */
  overloadRetryAfterMs?: number;
  /**
   * 连接级缺省 noDelta 初值（07 §5 --no-delta：serve 收旗标为宿主侧立场
   * 缺省——连接级 hello 显式携值胜出、缺席承本缺省）
   */
  initialConnectionNoDelta?: boolean;
}

/** 订阅相位（同步读面下 attaching/replaying 在单事务内瞬过——13e 异步腿扩用） */
type SubPhase = 'live' | 'closed';

/** 单会话订阅态（活体外推 + 心跳推导账） */
interface SubState {
  noDelta: boolean;
  phase: SubPhase;
  /** run 态（agent_start/end 推导——心跳 runState 源） */
  running: boolean;
  runStartAt: number;
  /** 上一 run 尾值 elapsed（agent_end 落定；idle 态回显） */
  lastElapsedMs: number;
  /** 当前阶段（message_*→thinking；tool_execution_start→tool；end 间 null） */
  stage: { type: 'thinking' } | { type: 'tool'; name: string; sinceMs: number } | null;
  /** 该会话最近一帧写出时刻（心跳静默判据——任何携会话帧都刷新） */
  lastFrameAt: number;
}

/** 出站帧去向（⑦ 背压三态 + 过载态） */
export type EnqueueStatus = 'sent' | 'queued' | 'dropped' | 'overload';

/**
 * 判帧是否纯活体可丢（⑦ 背压 shedding 面——03 §10.6「纯活体帧可丢」）：
 * message_update delta 与 tool_execution_update 进度帧——丢帧无害，durable
 * 定稿/锚定帧兜底（双轨律掉帧语义）。其余 event 帧与全部线控/回执帧不可丢。
 */
function isDroppableFrame(frame: SdkWireFrame): boolean {
  return (
    frame.kind === 'event' && (frame.event.type === 'message_update' || frame.event.type === 'tool_execution_update')
  );
}

/**
 * 出站有界队列（⑦）：sink 可写即直写；背压期入队；溢出先丢队内最旧可丢帧
 * （shedding——丢纯活体保线控），无可丢可让则过载（线控帧不可丢 ⇒ 断连档）。
 */
export class SdkOutboundQueue {
  private readonly queue: SdkWireFrame[] = [];
  private overloaded = false;

  constructor(
    private readonly sink: SdkOutboundSink,
    private readonly cap: number,
  ) {}

  /** 累计丢弃纯活体帧数（观测面——宿主日志/指标可读） */
  droppedCount = 0;

  /** 容量观测面（过载错误帧文案与宿主指标用） */
  get capacity(): number {
    return this.cap;
  }

  enqueue(frame: SdkWireFrame): EnqueueStatus {
    if (this.overloaded) return 'dropped'; // 断连档后全弃（宿主即将关传输）
    if (this.queue.length === 0 && this.sink.write(frame)) return 'sent';
    if (this.queue.length >= this.cap) {
      // 溢出纪律：入站纯活体帧先自弃（最廉 shedding）；线控/锚定帧入站则让
      // 位队内最旧纯活体帧，队内无可让 ⇒ 过载（线控帧不可丢——断连档）
      if (isDroppableFrame(frame)) {
        this.droppedCount++;
        return 'dropped';
      }
      while (this.queue.length >= this.cap) {
        const shedIndex = this.queue.findIndex(isDroppableFrame);
        if (shedIndex === -1) {
          this.overloaded = true;
          return 'overload';
        }
        this.queue.splice(shedIndex, 1);
        this.droppedCount++;
      }
    }
    this.queue.push(frame);
    return 'queued';
  }

  /**
   * 宿主 writable 时冲刷（按序 FIFO；sink 再拒即停——余量留下轮）。
   * @returns 本轮冲出帧数
   */
  drain(): number {
    let drained = 0;
    while (this.queue.length > 0 && this.sink.write(this.queue[0]!)) {
      this.queue.shift();
      drained++;
    }
    return drained;
  }

  get isOverloaded(): boolean {
    return this.overloaded;
  }
}

/**
 * SDK 线协议核心（单连接状态机）。
 *
 * 生命周期间隙：宿主建核 → 行解码（./jsonl.ts）→ handleRequest 逐请求；
 * 13b-3 后端把活体事件推入 {@link pushEvent}；宿主定时调
 * {@link heartbeatTick}（心跳义务的装配驱动位）与 {@link drain}（writable）。
 */
export class SdkWireCore {
  private readonly subs = new Map<string, SubState>();
  /** admit 已知键账（连接生命周期内快速档——跨重启档走 lookupDedupeKey） */
  private readonly known = new Map<string, Map<string, string>>();
  /** 连接级 messageId → sessionId 反查账（sessionId 缺席重发的快速档定位面） */
  private readonly messageIndex = new Map<string, string>();
  private readonly queue: SdkOutboundQueue;
  private readonly now: () => number;
  private readonly heartbeatIntervalMs: number;
  private readonly overloadRetryAfterMs: number;
  /** 连接级缺省 noDelta（连接级 hello 落定；prompt 自动订阅继承） */
  private connectionNoDelta: boolean;
  private closed = false;

  constructor(
    private readonly deps: SdkWireDeps,
    options: SdkWireOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
    this.overloadRetryAfterMs = options.overloadRetryAfterMs ?? 1_000;
    this.connectionNoDelta = options.initialConnectionNoDelta ?? false;
    this.queue = new SdkOutboundQueue(deps.sink, options.queueCap ?? 512);
  }

  // ---------------------------------------------------------------------------
  // 请求面六动词受理
  // ---------------------------------------------------------------------------

  /** 请求受理总入口（行解码后逐请求路由——本方法即 NDJSON 请求面的全语义） */
  handleRequest(req: SdkRequest): void {
    if (this.closed) {
      // 版本拒连/过载断连后的残行：同码直写重申（绕队列——连接将亡，宿主随即关传输）；
      // 宿主主动 close()（无因）后的残行静默弃（装配纪律位：关传输后不应再喂行）
      if (this.closedReason !== undefined) {
        this.deps.sink.write({
          kind: 'error',
          code: this.closedReason,
          message: '连接已关闭（版本握手拒连或出站过载断连）——残行不受理',
        });
      }
      return;
    }
    switch (req.verb) {
      case 'hello':
        this.handleHello(req.protocolVersion, req.sessionId, req.after, req.noDelta);
        break;
      case 'prompt':
        this.handlePrompt(req.sessionId, req.messageId, req.content);
        break;
      case 'interrupt':
        this.handleInterrupt(req.sessionId);
        break;
      case 'decide':
        this.handleDecide(req.approvalId, req.answer, req.note);
        break;
      case 'getEntries':
        this.handleGetEntries(req.sessionId, req.since, req.cursor);
        break;
      case 'sessions':
        this.emit({ kind: 'sessions', sessions: this.deps.listSessions() });
        break;
    }
  }

  /** hello：版本握手（⑤）→ 会话订阅 + 游标重放（③）→ 衔接界标 */
  private handleHello(
    protocolVersion: number,
    sessionId: string | undefined,
    after: number | undefined,
    noDelta: boolean | undefined,
  ): void {
    // ⑤ 版本握手第一天就有：不符即拒连（先应答后置闭——emit 对 closed 自静默）
    if (protocolVersion !== SDK_PROTOCOL_VERSION) {
      this.emitError(
        'SDK_PROTOCOL_MISMATCH',
        `线协议版本不符：服务端 ${SDK_PROTOCOL_VERSION} / 调用方 ${protocolVersion}`,
      );
      this.closed = true;
      this.closedReason = 'SDK_PROTOCOL_MISMATCH';
      return;
    }
    // 连接级握手（无会话订阅）：落定连接缺省 noDelta——显式携值胜出、缺席承
    // 构造初值（07 §5 --no-delta 宿主立场缺省；选项缺席时初值 false 语义不变）
    if (sessionId === undefined) {
      this.connectionNoDelta = noDelta ?? this.connectionNoDelta;
      this.emit({ kind: 'hello', protocolVersion: SDK_PROTOCOL_VERSION, sessionId: '', highWaterSeq: 0 });
      return;
    }
    const state = this.deps.sessionStateOf(sessionId);
    if (state === 'missing') {
      this.emitError('SESSION_NOT_FOUND', `会话 ${sessionId} 不存在`, sessionId);
      return;
    }
    // 订阅三步（同步读面下原子——文件头衔接序文注）：①快照高水位（先于挂监听，
    // 快照后事件只走直播段——零跨段重复）②重放至快照 ③replay-end 后转直播
    const highWater = this.deps.highWaterOf(sessionId) ?? 0;
    this.emit({ kind: 'hello', protocolVersion: SDK_PROTOCOL_VERSION, sessionId, highWaterSeq: highWater });
    let lastReplayed = -1;
    if (after !== undefined) {
      const check = validateAfterCursor(after, highWater);
      if (!check.ok) {
        this.emitError(
          'SDK_CURSOR_INVALID',
          `订阅游标非法（${check.reason}）：after=${after} 高水位=${highWater}`,
          sessionId,
        );
        return; // 游标非法即拒订阅（不挂监听——调用方重对账后再来）
      }
      const page = this.deps.queryEntries(sessionId, after);
      if (page.entries.length > 0) {
        this.emit({ kind: 'entries', sessionId, entries: page.entries, nextCursor: page.nextCursor });
        lastReplayed = page.entries[page.entries.length - 1]!.seq;
      } else {
        lastReplayed = after; // 空窗（完全追平档）——after 原值即重放尾
      }
    }
    this.emit({ kind: 'replay-end', sessionId, lastReplayedSeq: lastReplayed });
    this.subs.set(sessionId, {
      noDelta: noDelta ?? this.connectionNoDelta,
      phase: 'live',
      running: false,
      runStartAt: 0,
      lastElapsedMs: 0,
      stage: null,
      lastFrameAt: this.now(),
    });
    this.deps.onSubscribed?.(sessionId);
  }

  /** prompt：admit 三档（④）→ fresh 受理 / duplicate 幂等重收执 / conflict 拒收 */
  private handlePrompt(sessionId: string | undefined, messageId: string, content: string): void {
    // sessionId 缺席但连接内既见该 messageId：定位既落会话（重发走原会话快速档——
    // 反查账是连接级索引，不参与 durable 语义）
    if (sessionId === undefined) {
      const indexed = this.messageIndex.get(messageId);
      if (indexed !== undefined) sessionId = indexed;
    }
    // 显式携带即续接：missing/closed 双拒（已闭对齐 webui 404 语义——读面走 getEntries）
    if (sessionId !== undefined) {
      const state = this.deps.sessionStateOf(sessionId);
      if (state === 'missing') {
        this.emitError('SESSION_NOT_FOUND', `会话 ${sessionId} 不存在`, sessionId);
        return;
      }
      if (state === 'closed') {
        this.emitError('SESSION_CLOSED', `会话 ${sessionId} 已关闭（新发拒收——回放走 getEntries）`, sessionId);
        return;
      }
    }
    // admit 判定：连接内快速档（known）→ durable 档（lookupDedupeKey 跨重启幂等）
    let sessionKnown = sessionId === undefined ? undefined : this.known.get(sessionId);
    let verdict = admitMessage(sessionKnown ?? new Map(), messageId, content);
    if (verdict.status === 'fresh' && sessionId !== undefined) {
      const durable = this.deps.lookupDedupeKey(sessionId, messageId);
      if (durable !== undefined) {
        // durable 命中——种子进连接内账后按同键判定（后续快速档直达）
        sessionKnown ??= new Map();
        sessionKnown.set(messageId, durable);
        this.known.set(sessionId, sessionKnown);
        verdict = admitMessage(sessionKnown, messageId, content);
      }
    }
    if (verdict.status === 'conflict') {
      this.emitError('SDK_MESSAGE_CONFLICT', `messageId=${messageId} 同键异内容（幂等 admit 冲突档）`, sessionId);
      return;
    }
    if (verdict.status === 'duplicate') {
      const sid = sessionId!;
      this.messageIndex.set(messageId, sid);
      this.emit({
        kind: 'ack',
        sessionId: sid,
        messageId,
        duplicate: true,
        highWaterSeq: this.deps.highWaterOf(sid) ?? 0,
      });
      return;
    }
    // fresh：唯一写路径过桥（sessionId 缺席即新建——桥落定回示句柄）
    const outcome = this.deps.submitPrompt({ sessionId, content, messageId });
    const record = this.known.get(outcome.sessionId) ?? new Map<string, string>();
    record.set(messageId, content);
    this.known.set(outcome.sessionId, record);
    this.messageIndex.set(messageId, outcome.sessionId);
    // 自动订阅（13b 落码定形）：prompt 落定会话即挂直播（ack 携句柄 → 事件随后
    // 即流；只直播不重放——重放走显式 hello.after）。既有订阅不覆写（hello 订阅
    // 携 noDelta 等订阅参数胜出）；新会话无未决 ask，onSubscribed 只对新挂者发。
    if (!this.subs.has(outcome.sessionId)) {
      this.subs.set(outcome.sessionId, {
        noDelta: this.connectionNoDelta,
        phase: 'live',
        running: false,
        runStartAt: 0,
        lastElapsedMs: 0,
        stage: null,
        lastFrameAt: this.now(),
      });
      this.deps.onSubscribed?.(outcome.sessionId);
    }
    this.emit({
      kind: 'ack',
      sessionId: outcome.sessionId,
      messageId,
      duplicate: false,
      routedChannel: outcome.routedChannel,
      highWaterSeq: this.deps.highWaterOf(outcome.sessionId) ?? 0,
    });
  }

  /** interrupt：受理经事件流可观察（turn/end reason='interrupted'）——无应答帧 */
  private handleInterrupt(sessionId: string): void {
    if (this.deps.sessionStateOf(sessionId) === 'missing') {
      this.emitError('SESSION_NOT_FOUND', `会话 ${sessionId} 不存在`, sessionId);
      return;
    }
    this.deps.interruptSession(sessionId);
  }

  /** decide：跨入口审批竞速应答——applied/superseded 回执（03 §10.6 第三腿） */
  private handleDecide(approvalId: string, answer: ApprovalAskAnswer, note?: string): void {
    const outcome = this.deps.decideApproval(approvalId, answer, note);
    this.emit({ kind: 'decide-result', approvalId, outcome });
  }

  /** getEntries：对账读面（since 同 after 语义——05 §3.5 第一腿） */
  private handleGetEntries(sessionId: string, since: number, cursor?: string): void {
    if (this.deps.sessionStateOf(sessionId) === 'missing') {
      this.emitError('SESSION_NOT_FOUND', `会话 ${sessionId} 不存在`, sessionId);
      return;
    }
    const highWater = this.deps.highWaterOf(sessionId) ?? 0;
    const check = validateAfterCursor(since, highWater);
    if (!check.ok) {
      this.emitError(
        'SDK_CURSOR_INVALID',
        `对账游标非法（${check.reason}）：since=${since} 高水位=${highWater}`,
        sessionId,
      );
      return;
    }
    const page = this.deps.queryEntries(sessionId, since, cursor);
    this.emit({ kind: 'entries', sessionId, entries: page.entries, nextCursor: page.nextCursor });
  }

  // ---------------------------------------------------------------------------
  // 活体外推腿（13b-3 后端 onEnvelope → 此处；订阅过滤 + 水位 seq + 心跳账）
  // ---------------------------------------------------------------------------

  /**
   * 活体事件推入（双轨律直播段唯一入口）。未订阅会话丢弃；noDelta 订阅剥
   * message_update；seq = 推入时刻高水位（durable 水位语义——弱单调，协议
   * 文注定形）。同步推入顺带推导心跳账（run 态/阶段）。
   */
  pushEvent(sessionId: string, event: AgentEvent): void {
    if (this.closed) return;
    const sub = this.subs.get(sessionId);
    if (sub === undefined || sub.phase !== 'live') return;
    this.trackHeartbeat(sub, event);
    if (sub.noDelta && event.type === 'message_update') return; // ① delta 缺省开、--no-delta 退订
    this.emit({ kind: 'event', seq: this.deps.highWaterOf(sessionId) ?? 0, sessionId, event }, sessionId);
  }

  /**
   * 非事件帧外推（批 13b-3 后端消费位——ask 审批外推帧的入口）：独立帧族
   * 不占 seq 不进 durable（03 §10.6 第三腿），直接过出站单点（背压/静默账
   * 与事件帧同律）。订阅判据由调用方先决（后端 fail-closed 位）。
   */
  pushFrame(frame: SdkWireFrame, sessionId?: string): void {
    this.emit(frame, sessionId);
  }

  /** 订阅观测面（后端 fail-closed 判据——ask 帧去向位） */
  isSubscribed(sessionId: string): boolean {
    return this.subs.get(sessionId)?.phase === 'live';
  }

  /** 活跃订阅数（后端 hasAudience 探针——零订阅即无观众） */
  get subscriptionCount(): number {
    let count = 0;
    for (const sub of this.subs.values()) if (sub.phase === 'live') count++;
    return count;
  }

  /** 心跳账推导（事件流 → runState/stage——非事件型 probe 走 tick 时查面） */
  private trackHeartbeat(sub: SubState, event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        sub.running = true;
        sub.runStartAt = this.now();
        sub.stage = null;
        break;
      case 'agent_end':
        sub.running = false;
        sub.lastElapsedMs = Math.max(0, this.now() - sub.runStartAt);
        sub.stage = null;
        break;
      case 'message_start':
      case 'message_update':
        sub.stage = { type: 'thinking' };
        break;
      case 'tool_execution_start':
        sub.stage = { type: 'tool', name: event.name, sinceMs: this.now() };
        break;
      case 'tool_execution_end':
        sub.stage = null; // 工具间隙（下一 message_start/tool_execution_start 再立）
        break;
      default:
        break; // turn_* 不改阶段账
    }
  }

  /**
   * 心跳拍（② 协议义务的装配驱动位——宿主定间隔调）。静默填充式：会话级
   * 最近一帧距今超阈才发（活跃流自证活性，心跳只填间隙）；阶段优先 retry
   * probe（驱动退避等待期——事件流不可推导的非事件型源）。
   */
  heartbeatTick(): void {
    if (this.closed) return;
    const now = this.now();
    for (const [sessionId, sub] of this.subs) {
      if (sub.phase !== 'live' || now - sub.lastFrameAt < this.heartbeatIntervalMs) continue;
      const probe = this.deps.retryProbeOf(sessionId);
      const stage =
        probe !== null && probe.nextAt !== null
          ? { type: 'retry' as const, probe }
          : sub.stage === null
            ? null
            : sub.stage.type === 'tool'
              ? { type: 'tool' as const, name: sub.stage.name, stageElapsedMs: Math.max(0, now - sub.stage.sinceMs) }
              : { type: 'thinking' as const };
      const elapsedMs = sub.running ? Math.max(0, now - sub.runStartAt) : sub.lastElapsedMs;
      this.emit(
        { kind: 'heartbeat', sessionId, runState: sub.running ? 'running' : 'idle', stage, elapsedMs },
        sessionId,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 出站（emit + ⑦ 背压执法）与生命周期间隙
  // ---------------------------------------------------------------------------

  /** 出站单点：入有界队列；过载即断连档（SDK_OVERLOADED 尽力直写 + 宿主关传输） */
  private emit(frame: SdkWireFrame, sessionId?: string): void {
    if (this.closed) return;
    const status = this.queue.enqueue(frame);
    if (sessionId !== undefined) {
      const sub = this.subs.get(sessionId);
      if (sub !== undefined) sub.lastFrameAt = this.now(); // 任何携会话帧都刷新静默账
    }
    if (status !== 'overload') return;
    // ⑦ 线控帧不可丢 ⇒ 过载断连：错误帧绕队列尽力直写，钩宿主关传输
    this.closed = true;
    this.closedReason = 'SDK_OVERLOADED';
    this.deps.sink.write({
      kind: 'error',
      code: 'SDK_OVERLOADED',
      message: `出站队列溢出（容量 ${this.queue.capacity}）——线控帧不可丢，断连档`,
      willRetry: true,
      retryAfterMs: this.overloadRetryAfterMs,
    });
    this.deps.onOverload?.(this.overloadRetryAfterMs);
  }

  private emitError(code: string, message: string, sessionId?: string): void {
    this.emit({ kind: 'error', sessionId, code, message }, sessionId);
  }

  private closedReason: string | undefined;

  /** 宿主 writable 时冲刷在队帧（背压恢复腿） */
  drain(): number {
    return this.queue.drain();
  }

  /** 出站队列观测面（dropped 计数——宿主日志/指标） */
  get droppedFrameCount(): number {
    return this.queue.droppedCount;
  }

  /** 连接收口（宿主关传输时调——清订阅，后续 push/请求全静默） */
  close(): void {
    this.closed = true;
    this.subs.clear();
  }
}
