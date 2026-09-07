/**
 * 合并三分支纯函数件（06 §5 + 批 18c-1 落码定形注——Mercury 底座，全确定性
 * 零 IO，可独立单测）。
 *
 * 三分支（插入时、单事务内、逐行判首中即断）：
 *  1. 精确合并：归一 token 相等（Mercury 同形——token 序列拼接串相等）；
 *  2. 模糊合并：token 集合 Jaccard 交并比 ≥ 0.74 且非极性冲突（Jaccard 钉死
 *     而非 Mercury 的 overlap coefficient——交并比更严同阈，宁少合并不误合并：
 *     合并误判不可逆〔evidence 灌水〕、漏合并可由 consolidation 兜底）；
 *  3. 极性冲突裁决：四对极性词 + 否定词交叉命中、去极性后 Jaccard ≥ 0.5 判
 *     同主题冲突 → 高 confidence 胜、相等新胜。
 *
 * token 形（落码定形注）：ASCII 词段 = 小写化、非字母数字切段、保 ≥3 字符
 * （Mercury 同形）；CJK 连续段 = 二元切（bigram，单字符段保单字）——纯 ASCII
 * 切段对中文整段只产一个巨型 token（中文摘要间相似度恒 0 或恒 1），中英混排
 * 可对须 CJK 自持切分。
 */
import {
  MEMORY_FUZZY_JACCARD_THRESHOLD,
  MEMORY_POLARITY_JACCARD_THRESHOLD,
  MEMORY_SOURCE_REFS_CAP,
  type MergeDecision,
  type MemorySourceRef,
  type PolarityWinner,
} from './types.js';

/** ASCII/CJK 段提取（小写化后跑——段序保持原文序） */
const RUN_RE = /[a-z0-9]+|[一-鿿㐀-䶿]+/g;

/**
 * 合并比较面 token 化（纯函数）。
 * ASCII 词段保 ≥3 字符；CJK 连续段产二元组（段长 1 保单字）。
 */
export function tokenizeForMerge(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const run of lower.matchAll(RUN_RE)) {
    const seg = run[0];
    if (/[a-z0-9]/.test(seg[0]!)) {
      if (seg.length >= 3) out.push(seg);
    } else {
      // CJK 段：二元切（"包管理器" → [包管, 管理, 理器]；单字段保单字）
      if (seg.length === 1) out.push(seg);
      else for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2));
    }
  }
  return out;
}

/** 归一形（token 序列拼接串——精确合并的比较面，Mercury normalize 同形） */
export function normalizeForMerge(text: string): string {
  return tokenizeForMerge(text).join(' ');
}

/** 两 token 集合的 Jaccard 交并比（|A∩B| / |A∪B|——任一侧空集恒 0） */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/* ---------------- 极性面（词面检测 + 去极性比对） ---------------- */

/** 极性对四对（06 §5 分支 3 词面——正/负词形成对；单字词用词边界防子串误命中） */
const POLARITY_PAIRS: readonly (readonly [positive: string, negative: string])[] = [
  ['prefers', 'does not prefer'],
  ['likes', 'dislikes'],
  ['wants', 'does not want'],
  ['enabled', 'disabled'],
];

/** 否定词（06 §5 分支 3 词面；多词否定形整词匹配） */
const NEGATION_PHRASES: readonly string[] = ['not', 'never', 'no longer', 'avoid'];

/** 否定词不对称分支的相似度门槛（Mercury 实证档 0.7——对词分支的 0.5 更严一档：
 *  纯否定词不对称的信号弱于显式极性对交叉，误合并代价高故门槛高） */
const NEGATION_ASYMMETRY_THRESHOLD = 0.7;

/** 词边界短语命中（\b 防 likes 命中 dislikes 内嵌——极性对子串陷阱） */
function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
}

/** 文本含否定词判据（多词否定形整词匹配） */
function hasNegation(text: string): boolean {
  return NEGATION_PHRASES.some((w) => hasPhrase(text, w));
}

/** 去极性文本（剥极性对正负词形与否定词后再 token 化——同主题判据的比较面） */
function depolarizeTokens(text: string): string[] {
  let stripped = text;
  for (const [pos, neg] of POLARITY_PAIRS) {
    stripped = stripped
      .replace(new RegExp(`\\b${pos.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ')
      .replace(new RegExp(`\\b${neg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  }
  for (const w of NEGATION_PHRASES) {
    stripped = stripped.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  }
  return tokenizeForMerge(stripped);
}

/**
 * 极性冲突检测（纯函数）。
 * 判冲突两路（先对词交叉、后否定词不对称）：
 *  ① 四对极性词交叉（一侧正词、对侧负词）→ 去极性后 Jaccard ≥ 0.5；
 *  ② 否定词不对称（恰一侧含否定词）→ 去极性后 Jaccard ≥ 0.7（信号弱门槛高）。
 * @returns conflict 与去极性相似度（非冲突时 score 携最近一路值仅供诊断）
 */
export function detectPolarityConflict(a: string, b: string): { conflict: boolean; score: number } {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  // ① 极性对交叉——**成对**判（一对内一侧正词、对侧负词）。聚合串比较法在
  // 'likes'/'dislikes' 这类两形异串对上永不交叉（死码），likes/enabled 两例
  // 测试先红即其回归锁；prefers/wants 对纯因负形含 not 曾由路由②侥幸覆盖
  const crossed = POLARITY_PAIRS.some(
    ([pos, neg]) => (hasPhrase(la, pos) && hasPhrase(lb, neg)) || (hasPhrase(la, neg) && hasPhrase(lb, pos)),
  );
  if (crossed) {
    const score = jaccard(depolarizeTokens(la), depolarizeTokens(lb));
    return { conflict: score >= MEMORY_POLARITY_JACCARD_THRESHOLD, score };
  }

  // ② 否定词不对称（Mercury fallback 同构——阈值取其 0.7 实证档）
  if (hasNegation(la) !== hasNegation(lb)) {
    const score = jaccard(depolarizeTokens(la), depolarizeTokens(lb));
    return { conflict: score >= NEGATION_ASYMMETRY_THRESHOLD, score };
  }

  return { conflict: false, score: 0 };
}

/**
 * 对单条既有行的三分支裁决（纯函数——DAO 逐行消费、首中即断）。
 * 判序：exact（归一相等——相等文本不可能自冲突）→ polarity（冲突比对先行，
 * 防高相似对立主张误入模糊合并）→ fuzzy（≥ 0.74 且非冲突）→ none。
 * @param target 既有行比较面（summary + confidence）
 * @param candidate 入库候选比较面（summary + confidence）
 */
export function decideMerge(
  target: { summary: string; confidence: number },
  candidate: { summary: string; confidence: number },
): MergeDecision {
  // 分支 1：精确合并（归一 token 相等）
  if (normalizeForMerge(target.summary) === normalizeForMerge(candidate.summary)) {
    return { branch: 'exact', score: 1 };
  }
  // 分支 3：极性冲突（先于模糊——对立主张不得走吸收合并）
  const polarity = detectPolarityConflict(target.summary, candidate.summary);
  if (polarity.conflict) {
    // 高 confidence 胜、相等新胜（06 §5 分支 3）
    const winner: PolarityWinner = candidate.confidence >= target.confidence ? 'incoming' : 'existing';
    return { branch: 'polarity', score: polarity.score, winner };
  }
  // 分支 2：模糊合并（Jaccard ≥ 0.74）
  const score = jaccard(tokenizeForMerge(target.summary), tokenizeForMerge(candidate.summary));
  if (score >= MEMORY_FUZZY_JACCARD_THRESHOLD) {
    return { branch: 'fuzzy', score };
  }
  return { branch: 'none', score };
}

/**
 * 效用综合分（06 §5 定稿式——§6 简报排序降序与 consolidation 溢出选取升序
 * 共用同一把尺）：`confidence × ln(evidence+1) × (1 + ln(usage+1))`。
 * usage 0 = ×1 基线（新条目不被惩罚）；证据与引用独立计功。
 */
export function utilityScore(row: { confidence: number; evidenceCount: number; usageCount: number }): number {
  return row.confidence * Math.log(row.evidenceCount + 1) * (1 + Math.log(row.usageCount + 1));
}

/* ---------------- 溯源并集（血缘继承——条目消亡，溯源不死） ---------------- */

/**
 * source_refs 并集去重（保序——旧在前新在后，键 = sessionId:seq；帽 50 同罩）。
 * 精确/模糊合并吸收、极性两向继承（新胜并集入库 / 旧胜原位吸收）三消费点同源。
 */
export function unionSourceRefs(
  existing: readonly MemorySourceRef[],
  incoming: readonly MemorySourceRef[],
): MemorySourceRef[] {
  const seen = new Set<string>();
  const out: MemorySourceRef[] = [];
  for (const ref of [...existing, ...incoming]) {
    const key = `${ref.sessionId}:${ref.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= MEMORY_SOURCE_REFS_CAP) break;
  }
  return out;
}
