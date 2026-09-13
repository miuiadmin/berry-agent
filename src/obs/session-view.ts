/**
 * obs — 会话维视图服务（03 §10.8 会话维扩展——e-2 观测腿落码批）。
 *
 * 纯派生读面：零自管库零状态（与 rollup ObsService 分立——会话维不是
 * 度量聚合是原档读取 + 推导），一切数据经 deps 三窄面注入。
 *
 * **尾条推导单源**（03 §10.8——e-2 定形注：append-only 流最后一条事件
 * 推导粗状态，无锁无心跳无中心注册；u-1 定形注 paused 第四值〔u-3 落码〕）：
 *  - 尾条 `turn/end` → `idle`（回合闭合——reason 全值归 idle，粗状态不
 *    分终态细分档）；
 *  - 尾条 `approval/asked` → `waiting-approval`（等用户答审批）；
 *  - 尾条 `session/paused` → `paused`（预算停靠——04 §5 定形注②；恢复
 *    不设对称词：唤醒消息〔user/message source=budget-extended〕落账尾条
 *    翻位即恢复 running，零推导面特判）；
 *  - 其余一切尾条（turn/start、user/message、assistant/message、tool/*、
 *    request/header、llm/*、gate/decision、approval/decided、compaction/*
 *    及自定义词）→ `running`（回合未闭合）；
 *  - 零事件会话 → `idle`（回合未开）。
 * 推导消费 durable 流：write-behind 滞后窗内粗状态偏旧（保守方向——
 * 显示 idle 实际刚起跑），无锁无心跳的代价，如实注记。
 *
 * **树内判定单源**（03 §10.8 可见性分轴——e-2 定形注）：sessions.parent_id
 * 链（05 §9）自目标逐跳上溯（帽深 64 防环防长链）至无父行 = 根；同根即
 * 同树（self 同 id 特例天然含）；origin 五值不分判（fork/import/
 * delegation/trigger 的 parent_id 同链同律）；行缺席/链断/超帽 = 不可判
 * = 跨树（fail-closed——「不可判 = 跨树」既有句细则兑现）。
 *
 * **model 列单源**：最后一条 `request/header` 事件的 config.model（请求
 * 信封快照——wiring.noteRequest 写点）；防御读取缺席 undefined。
 */
import type { SessionEvent } from '../contracts/index.js';
import type {
  ObsLiveSessionInfo,
  ObsSessionRow,
  SessionLiveState,
  SessionSelfStatus,
  SessionSummaryRow,
  SessionTailItem,
  SessionTailWindow,
  SessionTraceReport,
  SessionView,
  SessionViewDeps,
} from './types.js';

/** 树判定上溯帽深（防环/防长链——超帽 = 不可判 = 跨树 fail-closed） */
const LINEAGE_MAX_DEPTH = 64;

/** session_list 进程内清单帽（装配侧投影帽之外的服务侧二道帽） */
const LIST_CAP = 100;

/** session_read 尾窗缺省条数与硬帽（03 §10.8 e-2 定形注） */
const TAIL_LIMIT_DEFAULT = 50;
const TAIL_LIMIT_MAX = 200;

/** session_trace 尾窗定值（「当前进行态」固定窗——无参数面） */
const TRACE_WINDOW = 20;

/**
 * 尾条推导回扫窗（03 §10.8 obs-b 例外注）：压缩族词（compaction/*）是
 * run 收场后的后台任务审计面——落账不改变会话粗状态，尾条为压缩族词时
 * 回扫窗内最近一条非压缩族事件按其映射定档。窗 20 条 = 防御帽（真实流
 * 压缩族连发至多数条——fire 前提是 settled，连续压缩族词间必夹 turn 事件）。
 */
const STATE_SCAN_WINDOW = 20;

/** 呈现摘要文本截断帽（单行 200 字符——模型消费面有界） */
const SUMMARY_MAX_CHARS = 200;

/** request/header 尾查页帽（initial/resume/change 少量词——防御帽） */
const HEADER_SCAN_LIMIT = 100;

/** createSessionView 工厂（装载面/测试唯一入口） */
export function createSessionView(deps: SessionViewDeps): SessionView {
  const workspaceRoot = deps.workspaceRoot ?? (() => undefined);

  /**
   * 尾条推导（lastSeq 精确定位——fromSeq 含边界取 1 条即尾行）。obs-b 例外
   * （03 §10.8）：尾行为压缩族词时回扫窗内最近一条非压缩族事件——压缩审计
   * 落账不改变粗状态（skip 的 cooldown/pending 门每轮收场可落，不回扫则
   * idle 恒误报 running）；尾行非压缩族时行为与例外前逐字一致（write-behind
   * 滞后 → undefined → idle 的保守语义不变）。窗内全压缩族（防御极端形）→
   * undefined 兜底 idle。
   */
  const tailEvent = (row: ObsSessionRow): SessionEvent | undefined => {
    if (row.lastSeq < 0) return undefined; // 零事件会话
    const exact = deps.events.queryEvents({ sessionId: row.id, fromSeq: row.lastSeq, limit: 1 });
    const tail = exact.events.at(-1);
    if (tail === undefined || !tail.type.startsWith('compaction/')) return tail;
    const fromSeq = Math.max(0, row.lastSeq - (STATE_SCAN_WINDOW - 1));
    const window = deps.events.queryEvents({ sessionId: row.id, fromSeq, limit: STATE_SCAN_WINDOW });
    for (let i = window.events.length - 1; i >= 0; i -= 1) {
      if (!window.events[i]!.type.startsWith('compaction/')) return window.events[i];
    }
    return undefined;
  };

  /** 粗状态映射（文件头映射表的执法位——paused 档 u-3 落码：置于「其余一切 running」兜底前〔03 §10.8 u-1 定形注〕，唤醒消息落账尾条翻位即恢复 running——零推导面特判） */
  const deriveLiveState = (tail: SessionEvent | undefined): SessionLiveState => {
    if (tail === undefined) return 'idle';
    if (tail.type === 'turn/end') return 'idle';
    if (tail.type === 'approval/asked') return 'waiting-approval';
    if (tail.type === 'session/paused') return 'paused';
    return 'running';
  };

  /** 会话行 + 尾条推导合并态（list/selfStatus/trace 共用） */
  const derivedState = (sessionId: string): { row: ObsSessionRow | undefined; live: SessionLiveState } => {
    const row = deps.sessions.getSessionRow(sessionId);
    if (row === undefined) return { row: undefined, live: 'idle' }; // 零事件新会话（进程内在管无 durable 行）
    return { row, live: deriveLiveState(tailEvent(row)) };
  };

  /** model 尾查（最后一条 request/header 的 config.model——防御读取） */
  const lastModel = (sessionId: string): string | undefined => {
    const result = deps.events.queryEvents({ sessionId, types: ['request/header'], limit: HEADER_SCAN_LIMIT });
    for (let i = result.events.length - 1; i >= 0; i -= 1) {
      const data = result.events[i]!.data as { config?: { model?: unknown } } | null;
      const model = data && typeof data === 'object' ? data.config?.model : undefined;
      if (typeof model === 'string' && model.length > 0) return model;
    }
    return undefined;
  };

  /** 尾窗读（fromSeq 精确定位——升序取帽值条，零全表扫） */
  const tailWindow = (row: ObsSessionRow, count: number): readonly SessionEvent[] => {
    const from = Math.max(0, row.lastSeq - count + 1);
    const result = deps.events.queryEvents({ sessionId: row.id, fromSeq: from, limit: count });
    return result.events;
  };

  /** 单事件呈现摘要（事件型感知提取——text/name/reason 优先，兜底 JSON 截断） */
  const summarize = (event: SessionEvent): string => {
    const data = event.data;
    if (data !== null && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      // 消息类：content 块数组或裸文本——取文本块拼接
      const content = record.content ?? record.text;
      if (typeof content === 'string') return clip(content);
      if (Array.isArray(content)) {
        const text = content
          .map((block) =>
            block !== null && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
              ? (block as { text: string }).text
              : '',
          )
          .join(' ')
          .trim();
        if (text.length > 0) return clip(text);
      }
      // 工具类：name 优先（tool/call 携工具名）
      if (typeof record.name === 'string') return clip(`name=${record.name}`);
      // turn 边界：reason
      if (typeof record.reason === 'string') return clip(`reason=${record.reason}`);
    }
    return clip(safeJson(data));
  };

  const toTailItem = (event: SessionEvent): SessionTailItem => ({
    seq: event.seq,
    time: event.time,
    type: event.type,
    summary: summarize(event),
  });

  /** 进程内在管判定（exists 语义：进程内 ∪ durable 任一在场） */
  const inActive = (sessionId: string): ObsLiveSessionInfo | undefined =>
    deps.liveSessions.listActive().find((info) => info.sessionId === sessionId);

  return {
    listSessions(): readonly SessionSummaryRow[] {
      const active = deps.liveSessions.listActive().slice(0, LIST_CAP);
      return active.map((info) => {
        const { row, live } = derivedState(info.sessionId);
        return {
          id: info.sessionId,
          // 行缺席（零事件新会话）：origin 兜底进程内记录、updatedAt 兜底 0
          title: row?.title,
          origin: row?.origin ?? info.origin,
          parentId: row?.parentId,
          live,
          model: row === undefined ? undefined : lastModel(info.sessionId),
          updatedAt: row?.updatedAt ?? 0,
        };
      });
    },

    readTail(sessionId: string, opts?: { readonly limit?: number }): SessionTailWindow {
      const limit = Math.min(Math.max(1, opts?.limit ?? TAIL_LIMIT_DEFAULT), TAIL_LIMIT_MAX);
      const row = deps.sessions.getSessionRow(sessionId);
      const exists = row !== undefined || inActive(sessionId) !== undefined;
      if (row === undefined) return { exists, items: [] }; // 零事件或不在场——空窗
      return { exists, items: tailWindow(row, limit).map(toTailItem) };
    },

    trace(sessionId: string): SessionTraceReport {
      const row = deps.sessions.getSessionRow(sessionId);
      const exists = row !== undefined || inActive(sessionId) !== undefined;
      if (row === undefined) {
        return { sessionId, exists, live: 'idle', recent: [], inflightTools: [] };
      }
      const window = tailWindow(row, TRACE_WINDOW);
      // 在飞工具 = 尾窗内 tool/call 无后续同 toolCallId 的 tool/result
      // （call → result 配对收敛；result 按到达序覆盖——后见胜出）
      const settled = new Set<string>();
      const calls = new Map<string, string>(); // toolCallId → name
      for (const event of window) {
        const data = event.data as { toolCallId?: unknown; name?: unknown } | null;
        const callId =
          data && typeof data === 'object' && typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
        if (event.type === 'tool/result') {
          if (callId !== undefined) settled.add(callId);
        } else if (event.type === 'tool/call') {
          const name =
            data && typeof data === 'object' && typeof data.name === 'string' ? data.name : (callId ?? 'unknown');
          if (callId !== undefined) calls.set(callId, name);
        }
      }
      const inflightTools = [...calls.entries()].filter(([callId]) => !settled.has(callId)).map(([, name]) => name);
      return {
        sessionId,
        exists,
        live: deriveLiveState(tailEvent(row)),
        recent: window.map(toTailItem),
        inflightTools,
      };
    },

    selfStatus(sessionId: string): SessionSelfStatus {
      const { row, live } = derivedState(sessionId);
      const info = inActive(sessionId);
      return {
        sessionId,
        origin: row?.origin ?? info?.origin ?? 'conversation',
        parentId: row?.parentId,
        workspaceRoot: workspaceRoot(),
        live,
        model: row === undefined ? undefined : lastModel(sessionId),
      };
    },

    isSameTree(a: string, b: string): boolean {
      if (a === b) return true; // self 特例（同 id 天然含）
      const rootA = rootOf(a);
      const rootB = rootOf(b);
      return rootA !== undefined && rootA === rootB;
    },
  };

  /** 根求解（parent_id 链上溯——帽深 64；行缺席/链断/超帽 = undefined） */
  function rootOf(sessionId: string): string | undefined {
    let current = sessionId;
    for (let depth = 0; depth < LINEAGE_MAX_DEPTH; depth += 1) {
      const row = deps.sessions.getSessionRow(current);
      if (row === undefined) return undefined; // 链中段缺席——不可判
      if (row.parentId === undefined) return row.id; // 无父 = 根
      current = row.parentId;
    }
    return undefined; // 超帽——不可判（fail-closed 跨树）
  }
}

/** 文本截断（含省略号——单行有界） */
function clip(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > SUMMARY_MAX_CHARS ? `${normalized.slice(0, SUMMARY_MAX_CHARS)}…` : normalized;
}

/** JSON 兜底摘要（坏形不炸——截断呈现） */
function safeJson(data: unknown): string {
  try {
    const text = JSON.stringify(data) ?? String(data);
    return text;
  } catch {
    return '(unserializable)';
  }
}
