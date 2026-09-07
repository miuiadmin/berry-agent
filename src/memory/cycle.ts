/**
 * memory 周期路编排件（06 §4 + 批 18c-5 落码定形注——事件计数达阈值触发后台
 * review + consolidation 拍；fire-and-forget，不反噬会话流）。
 *
 * **计数挂件**（onDurableEvent——装配面挂 durable 事件流消费点，与即时路
 * onUserMessage 同位）：durable 双腿词 = turn/end（回合计数）与 tool/call
 * （工具调用计数）；**任一达阈值**（缺省 10 turn / 15 tool-call）即记 due。
 * 计数器 = **里程表**：review 完成后复位（in-flight 期间继续累计——里程不丢，
 * 复位归零重来）。
 *
 * **fire 序**（定形注）：sweepExpired **同步首步**（TTL 物化恒执行——polluted
 * 会话也清）→ 资格检查（polluted 跳过 review——遗忘走 consolidation 淘汰批）
 * → fetchEvents 审阅窗切片 → runMemoryReview → consolidation.run（polluted
 * 会话集随轮注入）→ 计数器复位。inFlight 单飞：同会话并发 fire 跳过。
 *
 * **fetchEvents seam**（词面独立律——memory 席 DAG 无 session 边）：结构
 * 兼容 session 读面（返回 contracts SessionEvent 信封——type/seq/time/data）；
 * host 装配批接线（18c-6 跨会话检索批同位消费）。**LLM seam**：MemoryLlmFace
 * 窄面注入（同 review/consolidate）。
 */
import type { SessionEvent } from '../contracts/index.js';
import type { MemoryDao } from './dao.js';
import type { ConsolidateRunResult, Consolidator } from './consolidate.js';
import { createConsolidator } from './consolidate.js';
import { createPollutionTracker, type PollutionTracker } from './pollution.js';
import { runMemoryReview, type ReviewRunResult } from './review.js';
import {
  MEMORY_REVIEW_TOOL_CALL_THRESHOLD,
  MEMORY_REVIEW_TURN_THRESHOLD,
  MEMORY_REVIEW_WINDOW_TURNS,
  type MemoryLlmFace,
} from './types.js';

/* ---------------- 依赖与公开面 ---------------- */

/** durable 事件读 seam（结构兼容 session 公开面——返回信封全量，本件自切片） */
export type FetchEventsFn = (sessionId: string) => readonly SessionEvent[];

/** 周期路编排件依赖 */
export interface MemoryCycleDeps {
  readonly dao: MemoryDao;
  readonly llm: MemoryLlmFace;
  /** durable 事件读 seam（host 装配批接线——session 公开面适配） */
  readonly fetchEvents: FetchEventsFn;
  /** 会话资格追踪器（缺省自建——起草判据表） */
  readonly pollution?: PollutionTracker;
  /** 整理器（缺省自建——起草参） */
  readonly consolidator?: Consolidator;
  /** 阈值 override（缺省起草值 10/15/10） */
  readonly thresholds?: { turns?: number; toolCalls?: number; windowTurns?: number };
  /** 进程日志（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** fire 单轮结局 */
export interface CycleFireResult {
  readonly outcome:
    | 'reviewed' // review + consolidation 全序完成
    | 'skipped-polluted' // 资格拒——review 跳过（TTL 清扫与 consolidation 照跑）
    | 'skipped-inflight'; // 同会话并发 fire 跳过
  /** sweepExpired 物化行数（TTL 清扫恒执行） */
  readonly sweptExpired: number;
  /** review 结局（polluted/inflight 缺席） */
  readonly review?: ReviewRunResult;
  /** consolidation 结局（polluted 时也在场——整理与资格正交） */
  readonly consolidation?: ConsolidateRunResult;
}

/** 会话计数器（里程表——review 完成后复位） */
interface TurnCounters {
  turns: number;
  toolCalls: number;
}

/** 周期路编排件公开面 */
export interface MemoryCycle {
  /**
   * durable 事件消费挂件（装配面挂事件流消费点）：turn/end 与 tool/call 双腿
   * 计数；tool/call 同时喂污染标记（载荷携 name——§4.1 标记位）。达阈值记 due。
   */
  onDurableEvent(sessionId: string, event: SessionEvent): void;
  /** 达阈未拍会话清单（宿主 idle 钩子/时钟消费面——fire 后清） */
  dueSessions(): readonly string[];
  /** 跑一轮周期路（fire 序见头注；永不抛——异常 warn 吞） */
  fire(sessionId: string): Promise<CycleFireResult>;
  /** 会话资格追踪器（暴露给即时路 seam 装配与读面诊断） */
  readonly pollution: PollutionTracker;
  /** 整理器（直接触面——宿主维护窗/低频时钟可独立调） */
  readonly consolidator: Consolidator;
}

/* ---------------- 审阅窗切片（纯函数） ---------------- */

/**
 * 最近 N 个回合的事件切片（定形注——审阅窗）：自尾向前跳过最近 N 个回合的
 * turn/end，边界取第 N+1 个 turn/end **之后**——窗口恰含最近 N 个回合（回合
 * 事件 = 上一收尾之后至本收尾）；回合不足窗全量返回。
 */
export function sliceReviewWindow(
  events: readonly SessionEvent[],
  windowTurns: number = MEMORY_REVIEW_WINDOW_TURNS,
): readonly SessionEvent[] {
  let seen = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'turn/end') {
      seen++;
      if (seen === windowTurns + 1) return events.slice(i + 1); // 第 N+1 个收尾之后——最近 N 回合全量
    }
  }
  return events; // 回合不足窗——全量
}

/* ---------------- 工厂 ---------------- */

/** 建周期路编排件（进程单例装配） */
export function createMemoryCycle(deps: MemoryCycleDeps): MemoryCycle {
  const warn = deps.warn ?? (() => {});
  const pollution = deps.pollution ?? createPollutionTracker();
  const consolidator =
    deps.consolidator ??
    createConsolidator({ dao: deps.dao, llm: deps.llm, ...(deps.warn !== undefined ? { warn: deps.warn } : {}) });
  const turnThreshold = deps.thresholds?.turns ?? MEMORY_REVIEW_TURN_THRESHOLD;
  const toolCallThreshold = deps.thresholds?.toolCalls ?? MEMORY_REVIEW_TOOL_CALL_THRESHOLD;
  const windowTurns = deps.thresholds?.windowTurns ?? MEMORY_REVIEW_WINDOW_TURNS;

  // 会话计数器（里程表）+ due 集 + inFlight 单飞锁——全进程内存态
  const counters = new Map<string, TurnCounters>();
  const due = new Set<string>();
  const inFlight = new Set<string>();

  return {
    pollution,
    consolidator,

    onDurableEvent(sessionId, event) {
      if (event.type === 'turn/end') {
        const c = counters.get(sessionId) ?? { turns: 0, toolCalls: 0 };
        c.turns++;
        counters.set(sessionId, c);
      } else if (event.type === 'tool/call') {
        const c = counters.get(sessionId) ?? { turns: 0, toolCalls: 0 };
        c.toolCalls++;
        counters.set(sessionId, c);
        // 污染标记位（§4.1——载荷携 name；坏形载荷无 name 不标记）
        const data = event.data as { name?: unknown } | null;
        if (data !== null && typeof data === 'object' && typeof data.name === 'string') {
          pollution.markIfPolluted(sessionId, data.name);
        }
      } else {
        return; // 其余事件与计数无关
      }
      const c = counters.get(sessionId)!;
      if (c.turns >= turnThreshold || c.toolCalls >= toolCallThreshold) due.add(sessionId);
    },

    dueSessions() {
      return [...due];
    },

    async fire(sessionId) {
      // inFlight 单飞（定形注：inFlight 跳过——计数器照走里程表）
      if (inFlight.has(sessionId)) {
        return { outcome: 'skipped-inflight', sweptExpired: 0 };
      }
      inFlight.add(sessionId);
      try {
        // —— fire 首步：sweepExpired 同步物化（TTL 清扫恒执行——polluted 也不例外）
        const sweptExpired = deps.dao.sweepExpired();

        // —— 资格检查（§4.1 两路入口同一检查——polluted 跳过 review；遗忘走
        //    consolidation 淘汰批：polluted 会话集随轮注入）
        const pollutedNow = pollution.isPolluted(sessionId);
        let review: ReviewRunResult | undefined;
        if (!pollutedNow) {
          const window = sliceReviewWindow(deps.fetchEvents(sessionId), windowTurns);
          review = await runMemoryReview({ dao: deps.dao, llm: deps.llm, warn }, sessionId, window);
        }

        // —— consolidation 拍（polluted 会话集注入——§4.1 淘汰批圈候选）
        const consolidation = await consolidator.run({ pollutedSessions: pollution.pollutedSessions() });

        // —— 计数器复位（里程表——review 完成后归零；due 同清）
        counters.delete(sessionId);
        due.delete(sessionId);

        return {
          outcome: pollutedNow ? 'skipped-polluted' : 'reviewed',
          sweptExpired,
          ...(review !== undefined ? { review } : {}),
          consolidation,
        };
      } catch (error) {
        // 尽力而为（06 §4——周期路失败不重试不反噬；进程日志是唯一观测面）
        warn(`memory 周期路 fire 失败（尽力而为跳过）：${error instanceof Error ? error.message : String(error)}`);
        return { outcome: pollutedNowRef(pollution, sessionId), sweptExpired: 0 };
      } finally {
        inFlight.delete(sessionId);
      }
    },
  };
}

/** catch 面资格回查（review 未跑——按现行资格态归类） */
function pollutedNowRef(pollution: PollutionTracker, sessionId: string): CycleFireResult['outcome'] {
  return pollution.isPolluted(sessionId) ? 'skipped-polluted' : 'reviewed';
}
