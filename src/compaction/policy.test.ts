/**
 * compaction/policy 测试 — 策略面纯函数（05 §2.1：阈值判据双源 / 区间规划三则 /
 * 摘要预算字符制 / 迭代链提取 / 提示词五段 / 冷却）。
 *
 * 纪律：SessionLog 全真（session 件——纯内存缺省）；无 mock。
 */
import { describe, it, expect } from 'vitest';
import { SessionLog } from '../session/index.js';
import { DEFAULT_COMPACTION_CONFIG } from './types.js';
import {
  SUMMARY_PREFIX,
  buildSummaryPrompt,
  evaluateThreshold,
  inCooldown,
  planSegment,
  previousSummaryText,
  summaryBudgetFor,
} from './policy.js';

/** 组装纯内存会话日志（无 onAppend——热路径零 I/O 缺省） */
function makeLog(sessionId = 's-test'): SessionLog {
  return new SessionLog({ sessionId });
}

/** 追加一轮完整对话（turn/start → user → assistant → turn/end），返回 user 事件 seq */
function addTurn(log: SessionLog, userText: string, assistantText = `答:${userText}`): number {
  log.append('turn/start', {});
  const user = log.append('user/message', { content: userText, source: 'user' });
  log.append('assistant/message', { content: [{ type: 'text', text: assistantText }] });
  log.append('turn/end', { reason: 'completed' });
  return user.seq;
}

/** 六轮日志（12 条投影消息——tailKeep 6 下的常规规划夹具） */
function sixTurnLog(): SessionLog {
  const log = makeLog();
  for (let i = 1; i <= 6; i++) addTurn(log, `任务指令 ${i}`);
  return log;
}

const CFG = DEFAULT_COMPACTION_CONFIG;

/* ---------------- 阈值判定（真 token 主判 / 字符兜底） ---------------- */

describe('evaluateThreshold', () => {
  it('真值主判：usage input 达窗口 50% 触发、basis=usage、真窗口生效', () => {
    const fire = evaluateThreshold({ usageInput: 100_000, contextWindow: 200_000, projectedChars: 1, config: CFG });
    expect(fire).toMatchObject({ basis: 'usage', estTokens: 100_000, effectiveWindow: 200_000, fire: true });
    const notYet = evaluateThreshold({ usageInput: 99_999, contextWindow: 200_000, projectedChars: 1, config: CFG });
    expect(notYet?.fire).toBe(false);
  });

  it('无真值走估算兜底：chars/4 换算 vs fallbackWindowTokens，basis=estimate', () => {
    // 400_000 字符 / 4 = 100_000 token ≥ 50% × 200_000 → 触发
    const fire = evaluateThreshold({ usageInput: null, projectedChars: 400_000, config: CFG });
    expect(fire).toMatchObject({ basis: 'estimate', estTokens: 100_000, effectiveWindow: 200_000, fire: true });
    const notYet = evaluateThreshold({ usageInput: null, projectedChars: 399_996, config: CFG }); // ceil→99_999 < 100_000
    expect(notYet?.fire).toBe(false);
  });

  it('真值可用时不猜：投影字符再大也不改判（换算不稳定，真值优先）', () => {
    const verdict = evaluateThreshold({
      usageInput: 10,
      contextWindow: 200_000,
      projectedChars: 9_999_999,
      config: CFG,
    });
    expect(verdict).toMatchObject({ basis: 'usage', estTokens: 10, fire: false });
  });

  it('空会话（无真值且投影为零）→ null：无从判阈', () => {
    expect(evaluateThreshold({ usageInput: null, projectedChars: 0, config: CFG })).toBeNull();
  });
});

/* ---------------- 区间规划三则（head turn / tail 条 / 最小条数） ---------------- */

describe('planSegment', () => {
  it('常规：head 保首个完整 turn（start=首 turn/end+1 且对齐 turn/start）、tail 保末 6 条、end 不越界', () => {
    const log = sixTurnLog();
    const plan = planSegment({ events: log.events(), messages: log.projection(), tailKeep: CFG.tailKeep })!;
    // 六轮各 4 事件：turn i 的 user seq = 4i+1。tail 6 条 = messages[6..11]，锚 = u4(seq13)
    // → end = min(boundary 23, 12) = 12；head = 首 turn/end(3)+1 = 4（events[4]=turn/start）
    expect(plan.start).toBe(4);
    expect(plan.end).toBe(12);
    expect(plan.occludedMessages).toBe(4); // u2/a2/u3/a3（turn 1-2 的消息）
    // 区间外保留：首 turn 消息（seq 1/2）与 tail（seq 13 起）不遮
    const occludedSeqs = new Set(plan.occluded.map((m) => m.seq));
    expect(occludedSeqs.has(1)).toBe(false);
    expect(occludedSeqs.has(13)).toBe(false);
    // 字符尺与 fold 同源（逐消息 JSON 长度和）
    expect(plan.occludedChars).toBe(plan.occluded.reduce((sum, m) => sum + JSON.stringify(m).length, 0));
  });

  it('无闭合 turn → null（boundary = -1：全进行中日志无可压区间）', () => {
    const log = makeLog();
    log.append('turn/start', {});
    for (let i = 0; i < 10; i++) log.append('user/message', { content: `进行中 ${i}`, source: 'user' });
    // 10 条消息 ≥ tailKeep+2，但无 turn/end → 边界缺失诚实跳过
    expect(planSegment({ events: log.events(), messages: log.projection(), tailKeep: CFG.tailKeep })).toBeNull();
  });

  it('最小条数保护：投影不足 tailKeep+2 条 → null；够放时中段按余量遮', () => {
    const log = makeLog();
    addTurn(log, 'a');
    addTurn(log, 'b');
    addTurn(log, 'c'); // 6 条消息 < 4+2? 否——6=6 过计数闸，但 head 整 turn 占 2 条 → 中段空
    expect(planSegment({ events: log.events(), messages: log.projection(), tailKeep: 6 })).toBeNull();
    expect(planSegment({ events: log.events(), messages: log.projection(), tailKeep: 5 })).toBeNull(); // head2+tail5=7>6
    addTurn(log, 'd'); // 8 条消息：head2 + tail4 + 中段2
    expect(planSegment({ events: log.events(), messages: log.projection(), tailKeep: 4 })!.occludedMessages).toBe(2);
  });

  it('续接：既有遮蔽 → start 紧接上次遮蔽终点（对齐律第三形，不看该位事件类型）', () => {
    const log = sixTurnLog();
    const first = planSegment({ events: log.events(), messages: log.projection(), tailKeep: 6 })!;
    // 手工落一份遮蔽指令（正门——服务五步之外的直接夹具）
    const seqs: number[] = [];
    for (let seq = first.start; seq <= first.end; seq++) seqs.push(seq);
    const summary = log.append('user/message', { content: `${SUMMARY_PREFIX} 首摘要`, source: 'compaction' });
    seqs.push(summary.seq);
    log.appendWithSurfaceOp(
      'compaction/surface',
      { summarySeq: summary.seq, occludedMessages: first.occludedMessages, occludedChars: first.occludedChars },
      { op: 'replace', start: first.start, end: first.end },
      seqs,
    );
    // 追加三轮新对话后二次规划：start = 上次 end + 1
    for (let i = 7; i <= 9; i++) addTurn(log, `续接指令 ${i}`);
    const second = planSegment({ events: log.events(), messages: log.projection(), tailKeep: 6 });
    expect(second).not.toBeNull();
    expect(second!.start).toBe(first.end + 1);
    // 载体规避（防嵌套律规划面推论——修前必红）：终点收在前次指令载体（seq 25）之前
    expect(second!.end).toBe(24);
    expect(second!.end).toBeLessThan(25);
  });

  it('裸消息流（无 turn 骨架）→ head 对齐验证失败 → null（诚实跳过不规则日志）', () => {
    const log = makeLog();
    for (let i = 0; i < 10; i++) log.append('user/message', { content: `裸消息 ${i}`, source: 'user' });
    expect(planSegment({ events: log.events(), messages: log.projection(), tailKeep: 6 })).toBeNull();
  });

  it('tail 窗压过 turn 边界（大进行中轮）→ end 收在最近完整 turn 边界', () => {
    const log = sixTurnLog();
    // 进行中第七轮：追加多条消息（不闭合）——tail 锚被推后越过 boundary
    log.append('turn/start', {});
    for (let i = 0; i < 8; i++) log.append('user/message', { content: `进行中 ${i}`, source: 'user' });
    const boundary = log.lastClosedBoundary(); // 23（第六轮 turn/end）
    const plan = planSegment({ events: log.events(), messages: log.projection(), tailKeep: 6 });
    expect(plan).not.toBeNull();
    expect(plan!.end).toBe(boundary);
  });

  it('真实 driver 形（user/message 前置于 turn/start——提交先落消息后起 turn）→ 首遮蔽起点落在 turn/end 后一位即 turn 单元首位，可规划（U4-3 集成勘正回归锁——原「该位须是 turn/start」在真实日志形下永假，阈值路生产从未可规划）', () => {
    const log = makeLog();
    for (let i = 1; i <= 6; i++) {
      log.append('user/message', { content: `任务指令 ${i}`, source: 'user' });
      log.append('turn/start', {});
      log.append('assistant/message', { content: [{ type: 'text', text: `答:${i}` }] });
      log.append('turn/end', { reason: 'completed' });
    }
    // 0 基：turn k = user(4k-4) / turn/start(4k-3) / assistant(4k-2) / turn/end(4k-1)
    // 首遮蔽 start = 首 turn/end(3) + 1 = 4（turn2 的 user 位——turn 单元首位）
    // tailKeep 6 → tailAnchor = messages[6] = turn4 user(12) → end = 11
    const plan = planSegment({ events: log.events(), messages: log.projection(), tailKeep: 6 });
    expect(plan).toMatchObject({ start: 4, end: 11, occludedMessages: 4 });
    // 遮蔽后的续接规划：start 紧接上次遮蔽终点（11+1=12，turn4 user 位）同形可规划
    const summary = log.append('user/message', { content: `${SUMMARY_PREFIX} 首摘要`, source: 'compaction' });
    const seqs: number[] = [];
    for (let seq = plan!.start; seq <= plan!.end; seq++) seqs.push(seq);
    seqs.push(summary.seq);
    log.appendWithSurfaceOp(
      'compaction/surface',
      { summarySeq: summary.seq, occludedMessages: plan!.occludedMessages, occludedChars: plan!.occludedChars },
      { op: 'replace', start: plan!.start, end: plan!.end },
      seqs,
    );
    const next = planSegment({ events: log.events(), messages: log.projection(), tailKeep: 4 });
    expect(next).toMatchObject({ start: 12, end: 17 });
  });
});

/* ---------------- 摘要预算（字符制） ---------------- */

describe('summaryBudgetFor', () => {
  it('目标 = 字符量 × 压缩率；小量钳下限、大量钳上限', () => {
    expect(summaryBudgetFor(10_000, CFG)).toBe(2000); // 10_000×0.2=2000 恰在界内
    expect(summaryBudgetFor(1_000, CFG)).toBe(2000); // 200 → 钳 min
    expect(summaryBudgetFor(100_000, CFG)).toBe(12000); // 20_000 → 钳 max
  });
});

/* ---------------- 迭代链（前次摘要提取） ---------------- */

describe('previousSummaryText', () => {
  it('倒扫取末条 source=compaction 载体，剥除前缀返回正文', () => {
    const log = makeLog();
    addTurn(log, 'a');
    log.append('user/message', { content: `${SUMMARY_PREFIX} 第一份摘要`, source: 'compaction' });
    addTurn(log, 'b');
    log.append('user/message', { content: `${SUMMARY_PREFIX} 第二份摘要`, source: 'compaction' });
    log.append('user/message', { content: '真用户输入', source: 'user' });
    expect(previousSummaryText(log.events())).toBe('第二份摘要');
  });

  it('无压缩载体 / 块数组形 / 前次载体已被遮蔽（读事件本体非投影）', () => {
    const log = makeLog();
    expect(previousSummaryText(log.events())).toBeNull();
    // 块数组形载体（防御面——提取器兼容 string 与块数组）
    log.append('user/message', {
      content: [{ type: 'text', text: `${SUMMARY_PREFIX} 块形摘要` }],
      source: 'compaction',
    });
    expect(previousSummaryText(log.events())).toBe('块形摘要');
  });
});

/* ---------------- 提示词五段 + 冷却 ---------------- */

describe('buildSummaryPrompt', () => {
  it('五段标签在场、迭代链前次摘要并入、预算行、素材 JSON 透传', () => {
    const log = sixTurnLog();
    const prompt = buildSummaryPrompt({
      occluded: log.projection().slice(0, 2),
      previousSummary: '前次摘要正文',
      maxChars: 2000,
    });
    for (const label of ['任务概述', '关键决策', '未竟事项', '工具与文件痕迹', '下一步建议']) {
      expect(prompt).toContain(label);
    }
    expect(prompt).toContain('前次压缩摘要');
    expect(prompt).toContain('前次摘要正文');
    expect(prompt).toContain('2000');
    expect(prompt).toContain('"type": "user"'); // 投影消息 JSON 在场
  });

  it('无前次摘要时不落迭代链段', () => {
    const prompt = buildSummaryPrompt({ occluded: [], previousSummary: null, maxChars: 100 });
    expect(prompt).not.toContain('前次压缩摘要');
  });
});

describe('inCooldown', () => {
  it('未压过（null）不冷却；成功后冷却窗内抑制、窗外放行', () => {
    expect(inCooldown(null, 0, CFG)).toBe(false);
    expect(inCooldown(1_000, 1_000 + CFG.cooldownMs - 1, CFG)).toBe(true);
    expect(inCooldown(1_000, 1_000 + CFG.cooldownMs, CFG)).toBe(false);
  });
});
