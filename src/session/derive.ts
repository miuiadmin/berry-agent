/**
 * 投影：从日志到读模型（05 篇 §3.1 deriveMessages 与模型上下文投影）。
 *
 * 「模型可见即落日志」三条腿的结构腿：deriveMessages 是模型历史的唯一入口，
 * 纯函数 fold——增量缓存与全量重算共用 stepFold 同一转换函数，永不二写。
 *
 * 投影形状 ProjectedMessage 自有定义（结构对齐 pi-ai AgentMessage 联合）——
 * session 不 import llm（02 边表），llm 模块落码时负责与其请求体类型收口适配。
 */
import type { SessionEvent } from '../contracts/index.js';
import type {
  AssistantMessageData,
  ContentBlock,
  ToolCallData,
  ToolResultData,
  UserMessageData,
} from './event-data.js';

/** 投影出的工具调用块（挂在 assistant 消息上——由 tool/call 事件合成） */
export interface ProjectedToolCall {
  readonly type: 'toolCall';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: string;
}

/**
 * 模型历史投影的消息形状（三态联合）。
 * seq 锚：每型带锚事件 seq（user/assistant = 各自 message 事件 seq；toolResult
 * = tool/result 事件 seq）——遮蔽写者（compaction 等）从消息序映射回事件区间
 * 的唯一通用途径；不带它则写者只能自扫原始流 = 绕投影的第二份账。
 */
export type ProjectedMessage =
  | {
      readonly type: 'user';
      readonly seq: number;
      readonly content: string | readonly ContentBlock[];
      /** 输入归因（原样带出；投影同视 user 的判据 = parseEventSource.treatedAsUser，llm 侧消费） */
      readonly source?: string;
    }
  | {
      readonly type: 'assistant';
      readonly seq: number;
      /** 模型响应内容块（text/thinking——toolCall 不内联） */
      readonly content: readonly ContentBlock[];
      /** 同一响应内发起的工具调用（由 tool/call 事件合成进本消息） */
      readonly toolCalls: readonly ProjectedToolCall[];
      readonly usage?: unknown;
      readonly stopReason?: string;
      /** 失败说明（stopReason=error 终态轮——投影透传，05 §1.1 表注） */
      readonly errorMessage?: string;
    }
  | {
      readonly type: 'toolResult';
      readonly seq: number;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments?: string;
      readonly output: string | readonly ContentBlock[];
      readonly isError: boolean;
    };

/** fold 内部状态（open assistant 缓冲 + 未结算 tool/call 配对表 + 字符计数） */
export interface FoldState {
  /** 已折出的投影消息（消息序 = 事件序保真） */
  messages: ProjectedMessage[];
  /**
   * 投影字符计数（05 §3.1 projectedJsonChars 可加性）：逐消息 JSON 长度累加，
   * append 加、遮蔽摘除减——阈值判据（真 token 缺席时的兜底）不重复序列化全投影。
   */
  chars: number;
  /** 当前打开的 assistant 消息缓冲：assistant/message 开缓冲，遇 user/message 或 tool/result 先冲刷 */
  openAssistant: {
    /** 锚事件 seq（assistant/message 事件——投影消息的 seq 来源） */
    seq: number;
    content: readonly ContentBlock[];
    usage?: unknown;
    stopReason?: string;
    errorMessage?: string;
    toolCalls: ProjectedToolCall[];
  } | null;
  /** toolCallId → 调用信息（tool/result 到达时取名字与参数，配对后删除） */
  pendingCalls: Map<string, { name: string; arguments: string }>;
}

/** 新建空 fold 状态（增量缓存的起点；全量 fold 内部同用） */
export function createFoldState(): FoldState {
  return { messages: [], chars: 0, openAssistant: null, pendingCalls: new Map() };
}

/**
 * 单事件步进（就地修改 state）——全量 fold 与增量缓存共用的唯一转换函数。
 * 遮蔽指令事件（携带 surfaceOp 的 compaction/surface 等）不在此处理：全量路
 * 由 deriveMessages 以 occludedSeqs 预滤；增量路由 applyOcclusion 回溯摘除
 * （见下——两路对遮蔽的处置不同但摘除语义单源于 occludedSeqs 的区间定义）。
 */
export function stepFold(state: FoldState, event: SessionEvent): void {
  switch (event.type) {
    case 'user/message': {
      // 遇用户输入先冲刷打开中的 assistant（消息序保真：assistant 在 user 前）
      flushAssistant(state);
      const data = event.data as UserMessageData;
      pushMessage(state, {
        type: 'user',
        seq: event.seq,
        content: data.content,
        ...(data.source !== undefined ? { source: data.source } : {}),
      });
      return;
    }
    case 'assistant/message': {
      // 同一 turn 内多条 assistant/message：先冲刷上一条（罕见，容错处理）
      flushAssistant(state);
      const data = event.data as AssistantMessageData;
      state.openAssistant = {
        seq: event.seq,
        content: data.content,
        usage: data.usage,
        stopReason: data.stopReason,
        ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
        toolCalls: [],
      };
      return;
    }
    case 'tool/call': {
      const data = event.data as ToolCallData;
      // 工具调用归属同响应的 assistant 消息；若无打开缓冲（日志残缺），补一个空缓冲兜底
      if (!state.openAssistant) {
        state.openAssistant = { seq: event.seq, content: [], toolCalls: [] };
      }
      state.openAssistant.toolCalls.push({
        type: 'toolCall',
        toolCallId: data.toolCallId,
        toolName: data.name,
        arguments: data.arguments,
      });
      state.pendingCalls.set(data.toolCallId, { name: data.name, arguments: data.arguments });
      return;
    }
    case 'tool/result': {
      // 工具结果消息排在 assistant（含其全部 toolCall 块）之后
      flushAssistant(state);
      const data = event.data as ToolResultData;
      const call = state.pendingCalls.get(data.toolCallId);
      state.pendingCalls.delete(data.toolCallId);
      pushMessage(state, {
        type: 'toolResult',
        seq: event.seq,
        toolCallId: data.toolCallId,
        toolName: call?.name ?? '',
        ...(call ? { arguments: call.arguments } : {}),
        output: data.content,
        isError: data.error !== undefined,
      });
      return;
    }
    default:
      // turn 边界 / request/header / todo/write / log-only 全部不产出消息：
      // todo/write 的模型可见性走「跨 turn 每轮注入当前全表」通道（04 篇），
      // 此处落日志供 UI 投影与注入器读取。
      return;
  }
}

/** 折出消息入 state（chars 同步累加——可加性的写入点） */
function pushMessage(state: FoldState, message: ProjectedMessage): void {
  state.messages.push(message);
  state.chars += JSON.stringify(message).length;
}

/** 冲刷打开中的 assistant 缓冲为一条投影消息（无缓冲则无事发生） */
function flushAssistant(state: FoldState): void {
  if (!state.openAssistant) {
    return;
  }
  const buf = state.openAssistant;
  pushMessage(state, {
    type: 'assistant',
    seq: buf.seq,
    content: buf.content,
    toolCalls: [...buf.toolCalls],
    usage: buf.usage,
    stopReason: buf.stopReason,
    ...(buf.errorMessage !== undefined ? { errorMessage: buf.errorMessage } : {}),
  });
  state.openAssistant = null;
}

/**
 * 投影快照发布：拷贝 state.messages + 把 pending assistant 缓冲折成消息
 * **追加进拷贝**——活态零改动（缓冲继续接收迟到 tool/call，下次推进自然冲刷
 * 进活数组）。返回独立新数组，调用方可安全持有。
 */
export function snapshotProjection(state: FoldState): ProjectedMessage[] {
  const snapshot = [...state.messages];
  if (state.openAssistant) {
    const buf = state.openAssistant;
    snapshot.push({
      type: 'assistant',
      seq: buf.seq,
      content: buf.content,
      toolCalls: [...buf.toolCalls],
      usage: buf.usage,
      stopReason: buf.stopReason,
      ...(buf.errorMessage !== undefined ? { errorMessage: buf.errorMessage } : {}),
    });
  }
  return snapshot;
}

/**
 * 增量遮蔽摘除（05 §3.1「append 加、遮蔽减」的减法腿）：surfaceOp 指令事件
 * append 后对活体 FoldState 的回溯处置——摘除 messages 中 seq ∈ [start,end]
 * 的消息并回退 chars；pendingCalls / openAssistant 中锚在区间内的一并清理
 * （边缘纪律保证遮蔽只落已闭合 turn，活缓冲理应为空——防御性自足）。
 * 摘除消息的 chars 回退用同式 JSON.stringify——与 pushMessage 同一把尺。
 */
export function applyOcclusion(state: FoldState, op: { start: number; end: number }): void {
  const inRange = (seq: number) => seq >= op.start && seq <= op.end;
  if (state.messages.length > 0) {
    const kept: ProjectedMessage[] = [];
    for (const message of state.messages) {
      if (inRange(message.seq)) {
        state.chars -= JSON.stringify(message).length;
      } else {
        kept.push(message);
      }
    }
    state.messages = kept;
  }
  if (state.openAssistant && inRange(state.openAssistant.seq)) {
    state.openAssistant = null;
  }
  // pendingCalls 的 id 与事件 seq 的对应关系在 fold 内部无账——区间摘除后配对表
  // 可能残留区间内 call 的条目（对应 tool/result 已摘，不会再被消费）；残留
  // 条目不影响投影正确性（只是死键），会话重建（fork/恢复）时自然清零。
}

/** 计算被遮蔽的 seq 集合：遍历所有 surfaceOp 的 [start,end] 区间取并集 */
export function occludedSeqs(events: readonly SessionEvent[]): Set<number> {
  const occluded = new Set<number>();
  for (const event of events) {
    if (event.surfaceOp) {
      for (let seq = event.surfaceOp.start; seq <= event.surfaceOp.end; seq++) {
        occluded.add(seq);
      }
    }
  }
  return occluded;
}

/**
 * 模型历史投影（05 §3.1）：日志减被遮蔽节点后 fold 出 ProjectedMessage 序列。
 * 纯函数——同输入同输出；未配对的 tool/call（正常路径不存在——恢复协议保证
 * 闭合）容错丢弃：其 toolCall 块保留在 assistant 消息内，但不产出悬空 toolResult。
 */
export function deriveMessages(events: readonly SessionEvent[]): ProjectedMessage[] {
  const occluded = occludedSeqs(events);
  const state = createFoldState();
  for (const event of events) {
    if (!occluded.has(event.seq)) {
      stepFold(state, event);
    }
  }
  flushAssistant(state);
  return state.messages;
}

/** 投影字符数（阈值兜底判据的查询面——FoldState.chars 的只读读出） */
export function projectedJsonChars(state: FoldState): number {
  return state.chars;
}
