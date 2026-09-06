/**
 * 会话事件日志（05 篇 §1-§3——SessionLog：append 流水线/遮蔽校验/投影增量/读原语）。
 *
 * 纯逻辑层：物理落盘经构造注入的 onAppend 回调（write-behind 入队面——persist
 * 实现注入，append 热路径零 I/O）；缺省回调 = 纯内存会话（CLI :memory: 诊断形态）。
 * seq 连续性由「只在 append 尾部追加」结构保证（无独立序号分配器）。
 */
import {
  BaseError,
  getEventTypeMeta,
  isKnownEventType,
  type SessionEvent,
  type SessionLineage,
  type SurfaceOp,
} from '../contracts/index.js';
import { applyEventBudget } from './budget.js';
import { applyOcclusion, createFoldState, snapshotProjection, stepFold, type ProjectedMessage } from './derive.js';
import type { SyntheticDraft } from './recover.js';
import { deepFreeze, snapshotJsonValue } from './snapshot.js';

/** SessionLog 构造面 */
export interface SessionLogOptions {
  /** 会话 id（host/persist 侧分配） */
  readonly sessionId: string;
  /** fork/导入种子前缀（ensureSeeded 校验尾条锚定，05 §5.1） */
  readonly seed?: readonly SessionEvent[];
  /** 血缘三元组（根会话 = undefined） */
  readonly lineage?: SessionLineage;
  /**
   * write-behind 入队回调（persist 注入）：append 尾部追加后回调（热路径零 I/O——
   * 队列/批落/重试在 persist 侧）。缺省 = 纯内存会话。
   */
  readonly onAppend?: (event: SessionEvent) => void;
  /** 时间注入（缺省 Date.now；测试假钟/恢复合成复用最后真实 time 用 appendSynthetic） */
  readonly clock?: () => number;
  /** 预算刀截断 warn 面（装配根接 logger.warn；缺省 stderr——可观测降级不静默） */
  readonly warn?: (message: string) => void;
}

/** append 选项（信封扩展位——surfaceOp/sourceEventSeqs 仅调用方显式传入时携带，05 §1.2 步 2） */
export interface AppendOptions {
  readonly surfaceOp?: SurfaceOp;
  readonly sourceEventSeqs?: readonly number[];
  /** 显式 time 覆写（恢复合成复用最后真实 time——appendSynthetic 专用面） */
  readonly time?: number;
  /** true = 读侧可以不认识此类型（向前兼容；词汇闸对 ignorable 事件放行） */
  readonly ignorable?: boolean;
}

/**
 * 会话事件日志实例（per-session）。三类写入口：
 *  - append：普通追加（七步流水线）；
 *  - appendSynthetic：恢复合成收形（time 复用最后真实事件——确定性标记）；
 *  - appendWithSurfaceOp：装载面改投影历史的唯一正门（边缘纪律五条执法）。
 */
export class SessionLog {
  readonly sessionId: string;
  readonly lineage: SessionLineage | undefined;
  /** 日志本体（append-only；data 冻结态——外部拿到也改不动） */
  private readonly log: SessionEvent[] = [];
  /** 增量投影状态（FoldState——投影的缓存而非第二事实源，可全量重放对账） */
  private readonly fold = createFoldState();
  private readonly onAppend: (event: SessionEvent) => void;
  private readonly clock: () => number;
  private readonly warn: (message: string) => void;

  constructor(options: SessionLogOptions) {
    this.sessionId = options.sessionId;
    this.lineage = options.lineage;
    this.onAppend = options.onAppend ?? (() => undefined);
    this.clock = options.clock ?? (() => Date.now());
    this.warn = options.warn ?? ((message) => console.error(message));
    if (options.seed && options.seed.length > 0) {
      // 种子前缀：重放折叠（投影增量与日志同建）；seq 连续性顺带断言
      for (const event of options.seed) {
        if (event.seq !== this.log.length) {
          throw new BaseError(
            'SESSION_SURFACE_OP_INVALID',
            `种子前缀 seq 不连续：期望 ${this.log.length} 实得 ${event.seq}（裸拷贝不走正门）`,
          );
        }
        this.log.push(event);
        stepFold(this.fold, event);
      }
    }
  }

  /**
   * append 七步流水线（05 §1.2）：
   * ① 词汇检查（SESSION_UNKNOWN_EVENT_TYPE fail-loud）→ ② 信封注入（seq =
   * log.length / time = clock）→ ③ data 单遍校验 + 快照拷贝 → ④ 预算刀裁腿
   * （60KiB 内容帽 + errorMessage 2KiB 小帽；截断 warn 落账带码名义）→ ⑤ 事件
   * 目录断言（运行测试面——两账当前合一于词汇注册表，07 篇门禁接线时拆静态
   * 目录账，本步留结构位）→ ⑥ 尾部追加 → ⑦ write-behind 入队回调。
   */
  append(type: string, data: unknown, options?: AppendOptions): SessionEvent {
    // ① 词汇检查
    if (!isKnownEventType(type)) {
      throw new BaseError(
        'SESSION_UNKNOWN_EVENT_TYPE',
        `事件类型 ${type} 未注册（词汇注册表单源——先经核心表或 registerEventType）`,
      );
    }
    // ③-a 单遍校验 + 快照拷贝（非法载荷 fail-loud）
    const snapshot = snapshotJsonValue(data, 'data');
    // ④ 预算刀（裁腿产新对象；原 data 不动——纯函数面）
    const budgeted = applyEventBudget(type, snapshot);
    if (budgeted.truncated) {
      this.warn(`[SESSION_EVENT_OVER_BUDGET] ${this.sessionId} seq#${this.log.length} ${type} 超预算截断降级`);
    }
    // ③-b 冻结（裁后终态冻结——「写入后不可变」；步序上冻结在裁后语义等价）
    const frozen = deepFreeze(budgeted.data);
    // ② 信封注入
    const event: SessionEvent = {
      type,
      seq: this.log.length,
      time: options?.time ?? this.clock(),
      data: frozen,
      ...(options?.ignorable !== undefined ? { ignorable: options.ignorable } : {}),
      ...(options?.surfaceOp ? { surfaceOp: options.surfaceOp } : {}),
      ...(options?.sourceEventSeqs ? { sourceEventSeqs: [...options.sourceEventSeqs] } : {}),
    };
    // ⑥ 尾部追加 + 投影增量步进
    this.log.push(event);
    stepFold(this.fold, event);
    // ⑦ write-behind 入队
    this.onAppend(event);
    return event;
  }

  /**
   * 恢复合成收形（05 §4）：recoverClosers 产出的草稿经此入口 append——time
   * 复用最后真实事件（确定性标记的合成面）。其余流水线与 append 同（词汇/
   * 校验/冻结——合成物同权入日志）。
   */
  appendSynthetic(draft: SyntheticDraft): SessionEvent {
    return this.append(draft.type, draft.data, { time: draft.time });
  }

  /**
   * 装载面改投影历史的唯一正门（05 §2.1 appendWithSurfaceOp / §2.4 retry 形）：
   * 与 compaction 内部同一校验同一码（SESSION_SURFACE_OP_INVALID）——不是绕道口。
   * 两形在载体上分流（05 §2.4 retry 区间合法规约）：载体 = `llm/retry` 走
   * retry 形分支（三判据换轨——起点=错误 assistant / call 尸体豁免 /
   * 尾=高水位+含 turn/end）；其余载体走通用形。共用前置四条两形同执法
   * （成对写序由调用方编排——compaction 五步骨架）：
   *  - 区间合法 + 溯源完整（sourceEventSeqs 覆盖区间全部 seq 且只引用更早 seq）；
   *  - 不遮带 surfaceOp 的事件（防嵌套遮蔽）；
   *  - 同一位置不二次遮蔽（与既有遮蔽区间不相交）；
   * 通用形另执法两条：
   *  - 不遮进行中 turn（tool 配对完整性表检查——区间内每个 call 的配对 result
   *    也在区间内、反之亦然；无对可切、放行）；
   *  - 区间起点对齐 turn 边界（start = 0 / 首条为 turn/start / 紧接上次遮蔽终点）。
   */
  appendWithSurfaceOp(
    type: string,
    data: unknown,
    surfaceOp: SurfaceOp,
    sourceEventSeqs?: readonly number[],
  ): SessionEvent {
    this.validateSurfaceOp(type, data, surfaceOp, sourceEventSeqs);
    const event = this.append(type, data, { surfaceOp, sourceEventSeqs });
    // 增量遮蔽摘除（chars 减法腿）——指令事件自身在区间外（半开区间语义，
    // 「遮蔽者不可被自己遮蔽」由不遮带 surfaceOp 事件条保证）
    applyOcclusion(this.fold, surfaceOp);
    return event;
  }

  /**
   * 遮蔽指令校验（边缘纪律执法——appendWithSurfaceOp 与 compaction 内部共用）。
   * 两形分流（05 §2.4）：载体 `llm/retry` 走 retry 形（三判据换轨，通用形
   * 的起点对齐与 call 侧配对两判据对其豁免）；其余载体走通用形。共用前置
   * 四条（区间合法 / 溯源完整 / 防嵌套 / 不二次遮蔽）在分流前同执法。
   */
  private validateSurfaceOp(
    type: string,
    data: unknown,
    op: SurfaceOp,
    sourceEventSeqs: readonly number[] | undefined,
  ): void {
    if (!(
      Number.isInteger(op.start) &&
      Number.isInteger(op.end) &&
      op.start >= 0 &&
      op.start <= op.end &&
      op.end < this.log.length
    )) {
      throw new BaseError(
        'SESSION_SURFACE_OP_INVALID',
        `遮蔽区间非法：[${op.start},${op.end}]（当前日志长度 ${this.log.length}）`,
      );
    }
    // 溯源完整：sourceEventSeqs 须覆盖 [start,end] 全部 seq，且只能引用更早 seq
    const nextSeq = this.log.length;
    const required = new Set<number>();
    for (let seq = op.start; seq <= op.end; seq++) required.add(seq);
    for (const seq of sourceEventSeqs ?? []) {
      if (!(Number.isInteger(seq) && seq >= 0 && seq < nextSeq)) {
        throw new BaseError('SESSION_SURFACE_OP_INVALID', `溯源引用了非法 seq：${seq}（须为 0..${nextSeq - 1}）`);
      }
      required.delete(seq);
    }
    if (required.size > 0) {
      throw new BaseError(
        'SESSION_SURFACE_OP_INVALID',
        `溯源不完整：sourceEventSeqs 未覆盖被遮蔽区间 seq ${[...required].sort((a, b) => a - b).join(', ')}`,
      );
    }
    // 防嵌套 + 不二次遮蔽：区间内事件不得携带 surfaceOp，且与既有遮蔽区间不相交
    const occluded = new Set<number>();
    for (const event of this.log) {
      if (event.surfaceOp) {
        for (let seq = event.surfaceOp.start; seq <= event.surfaceOp.end; seq++) occluded.add(seq);
      }
    }
    for (let seq = op.start; seq <= op.end; seq++) {
      if (occluded.has(seq)) {
        throw new BaseError('SESSION_SURFACE_OP_INVALID', `seq ${seq} 已被遮蔽（不二次遮蔽/不嵌套遮蔽）`);
      }
      if (this.log[seq]!.surfaceOp) {
        throw new BaseError('SESSION_SURFACE_OP_INVALID', `seq ${seq} 自身携带 surfaceOp（遮蔽者不可被遮蔽——防嵌套）`);
      }
    }
    // tool 配对位置表（两形的配对执法共用）：按 toolCallId 建 call/result
    // 全日志位置表
    const callAt = new Map<string, number>();
    const resultAt = new Map<string, number>();
    for (let i = 0; i < this.log.length; i++) {
      const data = this.log[i]!.data as { toolCallId?: unknown } | null;
      const id = data && typeof data === 'object' && typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
      if (id === undefined) continue;
      if (this.log[i]!.type === 'tool/call') callAt.set(id, i);
      else if (this.log[i]!.type === 'tool/result') resultAt.set(id, i);
    }
    const inRange = (seq: number) => seq >= op.start && seq <= op.end;

    // —— retry 形分支（05 §2.4 retry 区间合法规约：载体限定 llm/retry，三判据换轨）——
    if (type === 'llm/retry') {
      // 相位限定：surfaceOp 只许 phase=scheduled 携带（aborted/exhausted 是
      // 事后事实事件，不携遮蔽指令）
      const phase = (data as { phase?: unknown } | null)?.phase;
      if (phase !== 'scheduled') {
        throw new BaseError(
          'SESSION_SURFACE_OP_INVALID',
          `llm/retry 携带 surfaceOp 须 phase=scheduled（当前 ${String(phase)}）`,
        );
      }
      // 起点判据：区间首条为 stopReason=error 的 assistant/message——失败 turn
      // 的尸体起点不是 turn 边界（通用形起点对齐对本形豁免）
      const first = this.log[op.start]!;
      const firstData = first.data as { stopReason?: unknown } | null;
      if (first.type !== 'assistant/message' || firstData?.stopReason !== 'error') {
        throw new BaseError(
          'SESSION_SURFACE_OP_INVALID',
          `retry 遮蔽区间起点须为 stopReason=error 的 assistant/message（seq ${op.start} 是 ${first.type}）`,
        );
      }
      // 尾=高水位：区间尾为追加时点日志末条 seq——盖住失败 turn 一切残余
      // （伴生尸体与垫底的 turn/end、零笔 llm/usage）
      if (op.end !== this.log.length - 1) {
        throw new BaseError(
          'SESSION_SURFACE_OP_INVALID',
          `retry 遮蔽区间尾须为日志高水位 ${this.log.length - 1}（当前 ${op.end}）`,
        );
      }
      // 区间含 turn/end：未结算 turn 不可遮（turn 已收形是重试判定的前置）
      let settled = false;
      for (let seq = op.start; seq <= op.end; seq++) {
        if (this.log[seq]!.type === 'turn/end') {
          settled = true;
          break;
        }
      }
      if (!settled) {
        throw new BaseError('SESSION_SURFACE_OP_INVALID', 'retry 遮蔽区间内未含 turn/end（未结算 turn 不可遮）');
      }
      // 配对执法（单向）：result 侧照旧——区间内 result 的配对 call 不得在
      // 区间外（起点不得切在配对中间）；call 侧豁免——区间内未配对 tool/call
      // 是流中断尸体，恰是要盖住的对象
      for (const [id, resultSeq] of resultAt) {
        const callSeq = callAt.get(id);
        if (inRange(resultSeq) && callSeq !== undefined && !inRange(callSeq)) {
          throw new BaseError(
            'SESSION_SURFACE_OP_INVALID',
            `tool 配对被切断：result@${resultSeq}（${id}）的 call@${callSeq} 在区间外`,
          );
        }
      }
      return;
    }

    // —— 通用形：tool 配对完整性（不遮进行中 turn——切点永不落在配对中间）——
    // 区间内每个 call 的配对 result 必在区间内、区间内每个 result 的配对
    // call 必在区间内
    for (const [id, callSeq] of callAt) {
      const resultSeq = resultAt.get(id);
      if (inRange(callSeq) && resultSeq !== undefined && !inRange(resultSeq)) {
        throw new BaseError(
          'SESSION_SURFACE_OP_INVALID',
          `tool 配对被切断：call@${callSeq}（${id}）的 result@${resultSeq} 在区间外`,
        );
      }
    }
    for (const [id, resultSeq] of resultAt) {
      const callSeq = callAt.get(id);
      if (inRange(resultSeq) && callSeq !== undefined && !inRange(callSeq)) {
        throw new BaseError(
          'SESSION_SURFACE_OP_INVALID',
          `tool 配对被切断：result@${resultSeq}（${id}）的 call@${callSeq} 在区间外`,
        );
      }
    }
    // 区间起点对齐 turn 边界：start = 0 / 区间首条为 turn/start / 紧接上次遮蔽
    // 终点（连续压缩切点——判据是既存遮蔽区间终点恰为 start-1，全日志扫描；
    // prev 事件自身携带 surfaceOp 的旧判据是死码：被遮蔽节点永不带遮蔽）
    if (op.start !== 0) {
      const first = this.log[op.start]!;
      const afterOcclusion = this.log.some((event) => event.surfaceOp?.end === op.start - 1);
      if (first.type !== 'turn/start' && !afterOcclusion) {
        throw new BaseError(
          'SESSION_SURFACE_OP_INVALID',
          `区间起点 ${op.start} 未对齐 turn 边界（首条 ${first.type}；须 start=0 / turn/start / 紧接上次遮蔽终点）`,
        );
      }
    }
  }

  /** 日志只读视图（外部不可 push——冻结数组视图语义由约定 + append-only 纪律保） */
  events(): readonly SessionEvent[] {
    return this.log;
  }

  /** 按类型过滤读（含 fromSeq 窗口参数）——插件只读面 ctx.sessions 的底层原语（05 §3.2） */
  eventsOfType(type: string, opts?: { fromSeq?: number }): readonly SessionEvent[] {
    const from = opts?.fromSeq ?? 0;
    return this.log.filter((event) => event.type === type && event.seq >= from);
  }

  /**
   * 最后一条完整 turn 边界的 seq（05 §3.2——「进行中 turn」判定的单源：工具
   * 配对、遮蔽边界、fork 边界共用）。词级过滤下标不得冒充位置——返回值必是
   * 真实事件 seq；无闭合 turn 返回 -1。
   */
  lastClosedBoundary(): number {
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i]!.type === 'turn/end') return this.log[i]!.seq;
    }
    return -1;
  }

  /** 投影快照（活缓冲折入拷贝尾——调用方可安全持有的独立数组） */
  projection(): ProjectedMessage[] {
    return snapshotProjection(this.fold);
  }

  /** 投影字符数（阈值兜底判据查询面——FoldState.chars 读出） */
  projectedChars(): number {
    return this.fold.chars;
  }

  /** 事件类型元信息查询透传（诊断面——类别/归属消费） */
  metaOf(type: string) {
    return getEventTypeMeta(type);
  }
}
