/**
 * consolidation 整理编排件（06 §5 + 批 18c-5 落码定形注——深层语义合并/降权/
 * TTL 物化的 LLM 拍 + 护栏四件执行腿）。
 *
 * **候选集三源**（定形注）：老化（updated_at 超 staleDays）∪ 容量溢出（owner
 * 内 TTL 可见行数超上限的**效用综合分最低**盈余——§5 一把尺反向）∪ polluted
 * 批（§4.1——sourceRefs 命中 polluted 会话的条目）；frozen/expired/终态行一律
 * 不入候选集（listVisible 谓词面 + frozen 显式排除）；三源并集去重。
 *
 * **护栏四件**：
 * 1. 水位短路 + anchor——实例持有进程内存态基线（重启视为有新摄入，至多
 *    多一轮 LLM 拍）；无新摄入或拍间不足 anchorMs 跳过。基线 = **拍终时钟**：
 *    absorb 写的 updated_at ≤ 拍终时钟 → 整理不再触发整理；拍中并发摄入至多
 *    被遮蔽一轮（下次摄入解锁——软状态整理容此损失）。跳过路（budget/error/
 *    parse）不烧 anchor 不进位基线——预算恢复/下周期即重试。
 * 2. LLM 理由护栏——reason 分词与 keep/drop 摘要 token 交集 ≥1，零交集整组
 *    驳回（防幻觉合并/降权）。
 * 3. 血缘继承——由 DAO absorb 物理动作承载（evidence 全数过继 + refs 并集）。
 * 4. 存活重验 + forget 终态短路——执行前逐条 get 复核（missing/终态/frozen
 *    跳过）；drop 终态走 DAO absorb 内联 forget('llm:<keepId>')。
 *
 * **候选集外 id 一律忽略**（模型幻觉护栏）；**永不因满拒写**——溢出整理是软
 * 状态调整不是准入闸门。LLM 经 MemoryLlmFace 窄面注入（词面独立律——memory
 * 席 DAG 无 llm 边，同 loop 只认 StreamFn 先例）；priority 恒 'background'
 * （04 §5 预算闸门），canAfford 拒 → 跳过本轮。
 */
import type { MemoryDao } from './dao.js';
import { tokenizeForMerge, utilityScore } from './merge.js';
import { parseJsonPayload } from './review.js';
import {
  MEMORY_CONSOLIDATION_ANCHOR_MS,
  MEMORY_CONSOLIDATION_STALE_DAYS,
  MEMORY_DECAY_FACTOR,
  MEMORY_DAY_MS,
  MEMORY_OWNER_CAPACITY,
  llmTextOf,
  type MemoryLlmFace,
  type MemoryRow,
} from './types.js';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

/* ---------------- 依赖与结果面 ---------------- */

/** 整理器装配依赖（组合根注入——测试确定性） */
export interface ConsolidateDeps {
  readonly dao: MemoryDao;
  /** LLM 窄面（结构兼容 host LlmService 子集——complete/canAfford） */
  readonly llm: MemoryLlmFace;
  /** 进程日志（缺省静默） */
  readonly warn?: (message: string) => void;
  /** owner 容量上限（缺省 500） */
  readonly capacity?: number;
  /** 老化阈值天数（缺省 90） */
  readonly staleDays?: number;
  /** decay 因子（缺省 0.7） */
  readonly decayFactor?: number;
  /** 拍间最小间隔毫秒（缺省 5min） */
  readonly anchorMs?: number;
  /** Unix 毫秒时钟（缺省 Date.now） */
  readonly now?: () => number;
}

/** 单轮整理结局 */
export interface ConsolidateRunResult {
  readonly outcome:
    | 'ran' // LLM 拍完成（计划可空——真拍了）
    | 'skipped-anchor' // 拍间不足 anchor
    | 'skipped-watermark' // 无新摄入
    | 'skipped-empty' // 候选集空
    | 'skipped-budget' // canAfford 拒
    | 'skipped-error' // complete 抛（网络等——跳过本轮）
    | 'skipped-parse'; // 计划整体坏形（非 JSON 对象/schema 败）
  /** 候选集行数（ran 时） */
  readonly candidateCount: number;
  /** 执行成功的 merge 组数 */
  readonly merged: number;
  /** 执行成功的 decay 条数 */
  readonly decayed: number;
  /** 理由护栏驳回组数 */
  readonly rejectedGroups: number;
  /** 集外 id / 存活重验败 / 执行被拒（计数面——诊断） */
  readonly ignoredSuggestions: number;
}

/** 整理器公开面（实例持有水位/anchor 内存态——编排件生命周期 = 进程） */
export interface Consolidator {
  /**
   * 跑一轮整理。pollutedSessions = 当前 polluted 会话集（§4.1 圈候选消费面，
   * 由周期路编排件随轮注入）。
   */
  run(input?: { pollutedSessions?: readonly string[] }): Promise<ConsolidateRunResult>;
}

/* ---------------- LLM 计划 schema（TypeBox 深校验——未知字段拒收） ---------------- */

const MERGE_SUGGESTION = Type.Object(
  {
    action: Type.Literal('merge'),
    keep: Type.String(),
    drop: Type.String(),
    reason: Type.String(),
  },
  { additionalProperties: false },
);

const DECAY_SUGGESTION = Type.Object(
  {
    action: Type.Literal('decay'),
    id: Type.String(),
    reason: Type.String(),
  },
  { additionalProperties: false },
);

const PLAN = Type.Object(
  {
    merges: Type.Array(MERGE_SUGGESTION),
    decays: Type.Array(DECAY_SUGGESTION),
  },
  { additionalProperties: false },
);

/** 计划窄形（Value.Check 通过后） */
interface MergeSuggestion {
  readonly action: 'merge';
  readonly keep: string;
  readonly drop: string;
  readonly reason: string;
}

interface DecaySuggestion {
  readonly action: 'decay';
  readonly id: string;
  readonly reason: string;
}

interface ConsolidatePlan {
  readonly merges: readonly MergeSuggestion[];
  readonly decays: readonly DecaySuggestion[];
}

/* ---------------- 工厂 ---------------- */

/** 空结果便捷构造 */
function result(
  outcome: ConsolidateRunResult['outcome'],
  extra: Partial<ConsolidateRunResult> = {},
): ConsolidateRunResult {
  return { outcome, candidateCount: 0, merged: 0, decayed: 0, rejectedGroups: 0, ignoredSuggestions: 0, ...extra };
}

/** 整理拍系统提示词（只出 JSON 对象——护栏在执行腿） */
const CONSOLIDATE_SYSTEM_PROMPT = [
  '你是记忆整理器：对候选记忆条目给出深层语义合并与降权建议。',
  '只输出一个 JSON 对象（无其他文本），形如',
  '{"merges":[{"action":"merge","keep":"保留条目id","drop":"被并条目id","reason":"合并理由"}],"decays":[{"action":"decay","id":"条目id","reason":"降权理由"}]}',
  '规则：只建议语义重复或互为矛盾面的合并（keep 承载合并后语义）；只对确证过时或低质条目建议降权；',
  'reason 必须引用条目摘要中出现的关键词；无建议时输出 {"merges":[],"decays":[]}。',
].join('\n');

/** 建整理器（进程单例装配——实例态 = 水位基线 + anchor 时钟） */
export function createConsolidator(deps: ConsolidateDeps): Consolidator {
  const { dao, llm } = deps;
  const warn = deps.warn ?? (() => {});
  const capacity = deps.capacity ?? MEMORY_OWNER_CAPACITY;
  const staleDays = deps.staleDays ?? MEMORY_CONSOLIDATION_STALE_DAYS;
  const decayFactor = deps.decayFactor ?? MEMORY_DECAY_FACTOR;
  const anchorMs = deps.anchorMs ?? MEMORY_CONSOLIDATION_ANCHOR_MS;
  const now = deps.now ?? Date.now;

  // —— 实例内存态（落码定形注：重启视为有新摄入——首轮恒不水位短路）
  let lastRunClock: number | null = null;
  let baselineIntakeAt: number | null = null;

  /** 候选集构造（三源并集去重；frozen 显式排——listVisible 谓词面已排 expired/终态） */
  function buildCandidates(
    visible: readonly MemoryRow[],
    nowMs: number,
    pollutedSessions: ReadonlySet<string>,
  ): Map<string, MemoryRow> {
    const candidates = new Map<string, MemoryRow>();
    const add = (row: MemoryRow): void => {
      if (row.frozen) return; // frozen 免整理全档
      candidates.set(row.id, row);
    };
    // 源一：老化（updated_at 超 staleDays）
    const staleBefore = nowMs - staleDays * MEMORY_DAY_MS;
    for (const row of visible) {
      if (row.updatedAt < staleBefore) add(row);
    }
    // 源二：容量溢出（owner 分组——效用综合分升序取最低分盈余差额行；frozen 不计容量）
    const byOwner = new Map<string, MemoryRow[]>();
    for (const row of visible) {
      if (row.frozen) continue;
      const group = byOwner.get(row.ownerKey) ?? [];
      group.push(row);
      byOwner.set(row.ownerKey, group);
    }
    for (const group of byOwner.values()) {
      if (group.length <= capacity) continue;
      const surplus = group.length - capacity;
      const ranked = [...group].sort((a, b) => utilityScore(a) - utilityScore(b)); // 升序——低分先入
      for (const row of ranked.slice(0, surplus)) add(row);
    }
    // 源三：polluted 批（§4.1——refs 命中 polluted 会话的条目进淘汰候选）
    if (pollutedSessions.size > 0) {
      for (const row of visible) {
        if (row.sourceRefs.some((ref) => pollutedSessions.has(ref.sessionId))) add(row);
      }
    }
    return candidates;
  }

  /** 理由护栏：reason 分词与摘要 token 交集 ≥1（零交集/空分词 → false 整组驳回） */
  function reasonSupported(reason: string, summaries: readonly string[]): boolean {
    const reasonTokens = new Set(tokenizeForMerge(reason));
    if (reasonTokens.size === 0) return false;
    for (const summary of summaries) {
      for (const token of tokenizeForMerge(summary)) {
        if (reasonTokens.has(token)) return true;
      }
    }
    return false;
  }

  /** 存活重验（执行前逐条复核——missing/终态/frozen 均败） */
  function alive(id: string): boolean {
    const row = dao.get(id);
    return row !== undefined && row.status === 'active' && !row.frozen;
  }

  /** 候选清单行（LLM 可见面——id/种类/摘要/三维分原料/未变更天数） */
  function candidateLine(row: MemoryRow, nowMs: number): string {
    const ageDays = Math.floor((nowMs - row.updatedAt) / MEMORY_DAY_MS);
    return `[${row.id}] kind=${row.kind} summary=${row.summary}（confidence=${row.confidence} evidence=${row.evidenceCount} usage=${row.usageCount} ${ageDays}d 未变更）`;
  }

  return {
    async run(input) {
      const nowMs = now();
      // —— 护栏一（anchor 腿）：拍间最小间隔——只对真实拍（ran/empty）进位
      if (lastRunClock !== null && nowMs - lastRunClock < anchorMs) return result('skipped-anchor');

      const visible = dao.listVisible();
      // —— 护栏一（水位腿）：无新摄入（基线 = 拍终时钟——absorb 自身写不构成摄入）
      const currentMax = visible.reduce((m, r) => Math.max(m, r.updatedAt), 0);
      if (baselineIntakeAt !== null && currentMax <= baselineIntakeAt) return result('skipped-watermark');

      const polluted = new Set(input?.pollutedSessions ?? []);
      const candidates = buildCandidates(visible, nowMs, polluted);
      if (candidates.size === 0) {
        // 候选面已稳定：烧 anchor + 进位基线（防同摄入面空转循环）
        lastRunClock = nowMs;
        baselineIntakeAt = Math.max(baselineIntakeAt ?? 0, currentMax, nowMs);
        return result('skipped-empty');
      }

      // —— 护栏一（预算腿）：canAfford 拒跳过本轮（不烧 anchor——预算恢复即拍）
      if (!llm.canAfford('background')) return result('skipped-budget');

      // —— LLM 拍
      let plan: ConsolidatePlan | null;
      try {
        const completion = await llm.complete({
          systemPrompt: CONSOLIDATE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `候选记忆条目：\n${[...candidates.values()].map((r) => candidateLine(r, nowMs)).join('\n')}`,
            },
          ],
          priority: 'background',
        });
        const parsed = parseJsonPayload(llmTextOf(completion.message.content));
        plan = parsed !== null && Value.Check(PLAN, parsed) ? (parsed as ConsolidatePlan) : null;
      } catch (error) {
        // complete 抛（网络/预算竞态）——跳过本轮，状态零进位
        warn(`memory consolidation 拍失败（跳过本轮）：${error instanceof Error ? error.message : String(error)}`);
        return result('skipped-error');
      }
      if (plan === null) return result('skipped-parse'); // 计划整体坏形——下周期重试

      // —— 执行腿（护栏逐条执法；物理动作全走 DAO 既有路径）
      let merged = 0;
      let decayed = 0;
      let rejectedGroups = 0;
      let ignoredSuggestions = 0;
      for (const m of plan.merges) {
        const keep = candidates.get(m.keep);
        const drop = candidates.get(m.drop);
        // 幻觉护栏：集外 id 一律忽略
        if (!keep || !drop) {
          ignoredSuggestions++;
          continue;
        }
        // 理由护栏：零交集整组驳回
        if (!reasonSupported(m.reason, [keep.summary, drop.summary])) {
          rejectedGroups++;
          continue;
        }
        // 存活重验（拍间失活/冻结）
        if (!alive(m.keep) || !alive(m.drop)) {
          ignoredSuggestions++;
          continue;
        }
        try {
          // 血缘继承 + drop 终态 llm:<keep> 内联；批 ev-1 reason 入链——护栏
          // 校验后的 LLM 建议组 reason 随版本行持久化（用完即弃 → durable 因由）
          dao.absorb(m.keep, m.drop, m.reason);
          merged++;
        } catch {
          ignoredSuggestions++; // 执行期拒（并发终态等）——吞不反噬
        }
      }
      for (const d of plan.decays) {
        const target = candidates.get(d.id);
        if (!target) {
          ignoredSuggestions++;
          continue;
        }
        if (!reasonSupported(d.reason, [target.summary])) {
          rejectedGroups++;
          continue;
        }
        if (!alive(d.id)) {
          ignoredSuggestions++;
          continue;
        }
        try {
          // confidence × factor + 版本 cause='decay'；批 ev-1——decay 判据描述
          // （护栏校验后的 LLM 自由文本 reason）随版本行持久化
          dao.decay(d.id, decayFactor, d.reason);
          decayed++;
        } catch {
          ignoredSuggestions++;
        }
      }

      // —— 拍终状态进位：anchor + 水位基线 = 拍终时钟（自身 absorb 写 ≤ 基线）
      const settleClock = now();
      lastRunClock = settleClock;
      baselineIntakeAt = Math.max(baselineIntakeAt ?? 0, settleClock);
      return result('ran', { candidateCount: candidates.size, merged, decayed, rejectedGroups, ignoredSuggestions });
    },
  };
}
