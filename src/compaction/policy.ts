/**
 * compaction 策略面（05 §2.1——纯函数，无副作用无 I/O）。
 *
 * 持五件策略：阈值判定（真 token 主判、投影字符兜底）、区间规划（head 保首个
 * 完整 turn / tail 保末 tailKeep 条 / 最小条数保护）、摘要预算（字符制）、
 * 迭代链前次摘要提取、摘要提示词组装（五段结构）。
 */
import type { SessionEvent } from '../contracts/index.js';
import type { ProjectedMessage } from '../session/index.js';
import type { CompactionConfig, SegmentPlan, ThresholdBasis } from './types.js';

/** 摘要载体前缀（防注入标记：模型可辨框架文本与用户话语；提取前次摘要时剥除） */
export const SUMMARY_PREFIX = '[COMPACTION-SUMMARY]';

/* ---------------- 阈值判定（05 §2.1「阈值」段单源） ---------------- */

/**
 * 阈值判定：真 token 计量主判（provider 报的 input 真值），投影字符数仅作
 * 无真值时的保守兜底（字符/4 估算——换算不稳定，真值可用时不猜）。
 * 返回 fire（是否触发）+ basis 三件（阈值路落 compaction/start 的判据快照）。
 */
export function evaluateThreshold(input: {
  /** 主 loop 真 token 笔（null = 无真值——兜底路） */
  usageInput: number | null;
  /** 模型上下文窗口真值（缺省 fallbackWindowTokens） */
  contextWindow?: number;
  /** 投影字符量（log.projectedChars()——兜底路换算源） */
  projectedChars: number;
  config: CompactionConfig;
}): (ThresholdBasis & { fire: boolean }) | null {
  // 无真值且投影为零（空会话）——无从判阈，null = 不触发也无判据可记
  if (input.usageInput === null && input.projectedChars === 0) return null;
  const effectiveWindow = input.contextWindow ?? input.config.fallbackWindowTokens;
  if (effectiveWindow <= 0) return null; // 防御：非正窗口无从比较
  // 真值可用时不猜——估算仅兜底（chars/4：粗略 4 字符/token 换算）
  const estTokens = input.usageInput !== null ? input.usageInput : Math.ceil(input.projectedChars / 4);
  return {
    basis: input.usageInput !== null ? 'usage' : 'estimate',
    estTokens,
    effectiveWindow,
    fire: estTokens / effectiveWindow >= input.config.thresholdRatio,
  };
}

/* ---------------- 区间规划（05 §2.1「区间规划三则」+ 边缘纪律） ---------------- */

/**
 * 区间规划：在合法跨度（终点 ≤ 最近完整 turn 边界；起点对齐 turn 边界）内按
 * 三则细化——head 保首个完整 turn（任务锚；切点须 turn/start 对齐——正门对齐
 * 律的结构推论）、tail 保末 tailKeep 条、最小条数保护（head+tail 之外中段
 * ≥ 1 条放不下即不压）。
 *
 * 返回 null = 诚实无操作（区间不足/日志无闭合 turn/骨架不规则）；规划输入
 * 须为互斥锁内新投影（service 全局串行队列保证——排队等待期间他路压缩可能
 * 已改写投影，规划与落账同账零迟滞窗）。
 */
export function planSegment(input: {
  events: readonly SessionEvent[];
  messages: readonly ProjectedMessage[];
  tailKeep: number;
}): SegmentPlan | null {
  const { events, messages, tailKeep } = input;
  // 终点界桩：最近完整 turn 边界（无闭合 turn = 无可压区间）
  let boundary = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'turn/end') {
      boundary = events[i]!.seq;
      break;
    }
  }
  if (boundary < 0) return null;
  // 最小条数保护：head（首 turn 投影消息 ≥ 1 条）+ 中段 ≥ 1 条 + tail tailKeep 条
  if (messages.length < tailKeep + 2) return null;
  // tail 锚：末 tailKeep 条的首条消息 seq——遮蔽不得侵入
  const tailAnchor = messages[messages.length - tailKeep]!.seq;
  const end = Math.min(boundary, tailAnchor - 1);
  // 起点两形：既有遮蔽 → 紧接上次遮蔽终点（正门对齐律第三形——连续压缩切点，
  // 不论该位置事件类型）；无遮蔽 → head 保首个完整 turn（首个 turn/end + 1，
  // 该位置须是 turn/start——正门对齐律第二形；无 turn 骨架的裸消息流诚实跳过）
  let lastOcclusionEnd = -1;
  let firstTurnEnd = -1;
  for (const event of events) {
    if (event.surfaceOp && event.surfaceOp.end > lastOcclusionEnd) lastOcclusionEnd = event.surfaceOp.end;
    if (firstTurnEnd < 0 && event.type === 'turn/end') firstTurnEnd = event.seq;
  }
  let start: number;
  if (lastOcclusionEnd >= 0) {
    start = lastOcclusionEnd + 1;
    // 起点撞载体（连续压缩紧邻前指令事件的形态）→ 跳过载体链即止（载体是
    // 结构指令事件非 turn 体；其后首位即 turn 单元首位——真实 driver 形为随
    // turn 的 user/message。原「进到下一个 turn/start 对齐位」在真实形会把
    // user/message 留在区间外拆散其 turn——U4-3 装配批集成勘正）
    if (events[start]?.surfaceOp) {
      let next = start;
      while (next < events.length && events[next]!.surfaceOp) next++;
      if (next >= events.length || next > end) return null;
      start = next;
    }
  } else {
    if (firstTurnEnd < 0) return null; // 防御（boundary ≥ 0 已保证存在——死码注明不删）
    // 起点对齐 turn 单元边界（05 §2.1 边缘纪律 5）：首 turn/end 后一位即次
    // turn 单元首位——真实 driver 形该位是随 turn 的 user/message〔提交先落
    // 消息后起 turn〕、合成形是 turn/start，两者皆完整 turn 单元首位。原
    // 「该位置须是 turn/start」系合成形状的过强表述，真实日志形下永假（阈值
    // 路生产从未可规划——U4-3 装配批 e2e 抓获勘正）
    start = firstTurnEnd + 1;
  }
  if (start > end) return null; // 中段空（tail 窗已压到头/仅单闭合 turn）
  // 防嵌套律的规划面推论：区间须整段避开一切 surfaceOp 载体（载体永不可被遮——
  // 正门防嵌套校验会拒写）。终点收在起点后最近载体之前（前次摘要载体恰在其前，
  // 天然并入区间——迭代链承接面）
  const carrierAbove = events.find((e) => e.seq > start && e.surfaceOp);
  const effectiveEnd = carrierAbove !== undefined ? Math.min(end, carrierAbove.seq - 1) : end;
  if (start > effectiveEnd) return null;
  // 区间内投影消息与字符量（字符尺与 fold.chars 同源：逐消息 JSON 长度和）
  const result = planFromRange(start, effectiveEnd, messages);
  if (result.occludedMessages < 1) return null; // 防御：区间内无投影消息（纯骨架区间不值得压）
  return result;
}

/**
 * 区间 → SegmentPlan（素材三件宿主重算单源——planSegment 尾部与 U4 调整途
 * 共用：调整案的 occluded/occludedMessages/occludedChars 恒宿主按区间从投影
 * 重算，不信载荷〔区间主权 = 唯一采用面〕）。区间内投影消息可空——调用方
 * 自查（planSegment 视为 null、调整途视为非法调整）。
 */
export function planFromRange(start: number, end: number, messages: readonly ProjectedMessage[]): SegmentPlan {
  const occluded = messages.filter((m) => m.seq >= start && m.seq <= end);
  const occludedChars = occluded.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
  return { start, end, occludedMessages: occluded.length, occludedChars, occluded };
}

/* ---------------- 调整值校验（U4 调整途——05 §2.1 槽位化第 3 层） ---------------- */

/**
 * 调整值校验器（「调整值过宿主同一规划校验器」的码面单源）：调整案区间须
 * 落在宿主原案区间内——宿主原案已过规划全律（turn 边界/tail 界/起点对齐/避
 * 载体），子区间天然合法；扩界不合法（扩 tail/扩进载体区属越权——界桩移动是
 * 配置槽射程〔tailKeep 等〕非调整途）。
 */
export function validateAdjustedRange(
  adjusted: { start: number; end: number },
  host: { start: number; end: number },
): boolean {
  return adjusted.start >= host.start && adjusted.end <= host.end && adjusted.start <= adjusted.end;
}

/* ---------------- 摘要预算（字符制——05 §2.1「摘要参数」） ---------------- */

/** 摘要目标长度：被遮蔽字符量 × 压缩率，钳在 [min, max] 字符区间 */
export function summaryBudgetFor(occludedChars: number, config: CompactionConfig): number {
  const target = Math.ceil(occludedChars * config.summaryRatio);
  return Math.min(Math.max(target, config.summaryMinChars), config.summaryMaxChars);
}

/* ---------------- 迭代链（05 §2.1「迭代链」段） ---------------- */

/**
 * 前次摘要提取：倒扫日志取末条 source='compaction' 的 user/message（其自身
 * 多已被后续遮蔽——读事件本体而非投影；前次既被遮蔽，其内容唯经并入新摘要
 * 存活）。剥除载体前缀返回正文；无前次摘要返回 null。
 */
export function previousSummaryText(events: readonly SessionEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== 'user/message') continue;
    const data = event.data as { content?: unknown; source?: unknown };
    if (data.source !== 'compaction') continue;
    const text = plainTextOf(data.content);
    if (text === null || text.length === 0) continue; // 载体形坏（防御）——继续倒扫
    return text.startsWith(SUMMARY_PREFIX) ? text.slice(SUMMARY_PREFIX.length).trim() : text;
  }
  return null;
}

/** 内容块面 → 纯文本（string 原样；块数组取 text 块拼接——摘要载体只会有文本） */
function plainTextOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        (block as { type?: string; text?: unknown }).type === 'text' ? String((block as { text: unknown }).text) : '',
      )
      .join('');
  }
  return null;
}

/* ---------------- 摘要提示词（05 §2.1「摘要参数」五段结构） ---------------- */

/**
 * 摘要提示词组装：五段结构（任务概述/关键决策/未竟事项/工具与文件痕迹/下一步
 * 建议）+ 迭代链前次摘要并入 + 目标长度预算行。对话原文以 JSON 透传（complete
 * 通道对素材自行取舍——投影消息形即对话真身）。
 */
export function buildSummaryPrompt(input: {
  occluded: readonly ProjectedMessage[];
  previousSummary: string | null;
  maxChars: number;
}): string {
  const transcript = JSON.stringify(input.occluded, null, 2);
  const previous = input.previousSummary
    ? `\n\n## 前次压缩摘要（迭代链——此前历史已并入其中，本摘要须承接不可丢）\n${input.previousSummary}`
    : '';
  return [
    '请将以下对话压缩为一份上下文摘要，供后续轮次代替被压缩的原文使用。',
    `目标长度：不超过 ${input.maxChars} 字符。`,
    `摘要须按五段结构组织：`,
    '1. 任务概述：用户在做什么、目标是什么；',
    '2. 关键决策：已确定的技术/方案决策及其理由；',
    '3. 未竟事项：已开始未完成的工作、待验证的假设；',
    '4. 工具与文件痕迹：已用工具、已读写的关键文件路径与结果要点；',
    '5. 下一步建议：紧接着最该做的事。',
    '只输出摘要正文，不要输出其他说明。' + previous,
    '',
    '## 待压缩对话（投影消息 JSON）',
    transcript,
  ].join('\n');
}

/* ---------------- 冷却判定（防抖三件之一） ---------------- */

/** 冷却判定：距上次成功压缩不足 cooldownMs → true（抑制触发） */
export function inCooldown(lastCompactAt: number | null, nowMs: number, config: CompactionConfig): boolean {
  return lastCompactAt !== null && nowMs - lastCompactAt < config.cooldownMs;
}
