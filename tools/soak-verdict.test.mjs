/**
 * tools/soak-verdict.test.mjs —— soak 判收纯函数单元锁（批 B 修前红件）。
 *
 * 研究档 C2'/C3'（设计文档/00-研究-全流程全自动全场景测试-20260916.md 簇 C）：
 * soak 退出码判据原先内联在 soak.mjs 收场段（只有 okCount/drill/budget 三判据），
 * errLines 只统计不入判收、事件序完整性仅 count-based。本批把判收收成纯函数
 * 单源（tools/soak-verdict.mjs）——本测试是它的单元锁；soak.mjs 收场段接线消费。
 *
 * 判据语义对照（与仓内既有不变式同源）：
 * - seq 无洞 = kill-recovery.test.ts:281「恢复前缀 seq 连续（0..N-1 无洞——
 *   SQLite 原子性）」+ :295「续写不撞（seq=N 接续）」的驱动器侧投影——跨 kill
 *   会话最终账本仍应全程无洞（在飞窗丢条只造成号重用，不造成洞）；
 * - errLines 帽 = daemon.log error 行增长即红（缺省帽 0 零容忍——quick 三轮
 *   实测基线 0 行，2026-09-16 本地实测）。
 *
 * 扩判据批（研究档 C4'/C5'——2026-09-16 落码：本批修前红件）：
 * - C4' 第六判据 unattended——无人值守三腿（跨 tick 会话 / 跨压缩窗事件 /
 *   跨停靠唤醒续跑）。判据面「null 容忍未启用、设期望须达标」：期望缺席
 *   （null）恒绿，设最低值即执法；
 * - C5' 延迟漂移判据——逐轮延迟已测已落盘但不判收（退化性慢化五判据下
 *   全绿）。判据 = 末 1/3 整数轮 dt 中位数 ÷ 首 1/3 中位数 ≤ 帽（缺省帽
 *   3.0；driftRatio null = 样本窗不足恒绿——quick 三轮天然豁免防 nightly
 *   假红；driftCap null = 未设帽恒绿，与 RSS 预算 null 容忍同形）。
 */
import { describe, expect, it } from 'vitest';
import { computeVerdict, driftStatsOf, errLineCountOf, seqBreaksOf } from './soak-verdict.mjs';

/** computeVerdict 全绿基线入参（模块级共享——五判据基线 + 新判据未启用恒绿） */
const greenBase = {
  okCount: 3,
  rounds: 3,
  drillOk: null,
  budgetWithin: null,
  errLines: 0,
  errLinesCap: 0,
  seqBreaksBySession: {},
};

describe('seqBreaksOf——durable 事件序无洞校验', () => {
  it('空账本无断点（新会话未起账）', () => {
    expect(seqBreaksOf([])).toEqual([]);
  });

  it('从 0 起连续序列无断点', () => {
    const entries = [0, 1, 2, 3, 4].map((seq) => ({ type: 'user/message', seq, time: 1, data: {} }));
    expect(seqBreaksOf(entries)).toEqual([]);
  });

  it('中段跳号记断点（丢条——位置与缺口宽）', () => {
    const entries = [0, 1, 3, 4].map((seq) => ({ type: 'user/message', seq, time: 1, data: {} }));
    expect(seqBreaksOf(entries)).toEqual([{ from: 1, to: 3, gap: 1 }]);
  });

  it('多处跳号全记（不首中即止）', () => {
    const entries = [0, 2, 5].map((seq) => ({ type: 'user/message', seq, time: 1, data: {} }));
    expect(seqBreaksOf(entries)).toEqual([
      { from: 0, to: 2, gap: 1 },
      { from: 2, to: 5, gap: 2 },
    ]);
  });

  it('首条非 0 记断点（截头——from 置 null，gap = 缺号数）', () => {
    const entries = [1, 2, 3].map((seq) => ({ type: 'user/message', seq, time: 1, data: {} }));
    expect(seqBreaksOf(entries)).toEqual([{ from: null, to: 1, gap: 1 }]);
    // 首条 seq=5 = 缺 [0..4] 共 5 个号
    const entries5 = [5, 6].map((seq) => ({ type: 'user/message', seq, time: 1, data: {} }));
    expect(seqBreaksOf(entries5)).toEqual([{ from: null, to: 5, gap: 5 }]);
  });

  it('嵌套形条目兼容（e.event.seq——与 soak 判收词汇 isEnd 两形同源）', () => {
    const entries = [{ event: { type: 'user/message', seq: 0 } }, { event: { type: 'assistant/message', seq: 1 } }];
    expect(seqBreaksOf(entries)).toEqual([]);
  });

  it('seq 缺席条目不计入（防御脏数据——判据只对带 seq 条目执法）', () => {
    const entries = [
      { type: 'user/message', seq: 0, time: 1, data: {} },
      { type: '无号脏条目' },
      { type: 'assistant/message', seq: 1, time: 2, data: {} },
    ];
    expect(seqBreaksOf(entries)).toEqual([]);
  });
});

describe('errLineCountOf——daemon.log error 行计数', () => {
  it('空文本 0 行', () => {
    expect(errLineCountOf('')).toBe(0);
  });

  it('error 行大小写不敏感全计（daemon 日志 ERROR/error 两形）', () => {
    const text = ['[info] boot ok', '[ERROR] sqlite busy', '[warn] retry', '[error] stream reset'].join('\n');
    expect(errLineCountOf(text)).toBe(2);
  });

  it('无 error 行纯 info/warn 文本 0 行', () => {
    const text = ['[info] a', '[warn] b'].join('\n');
    expect(errLineCountOf(text)).toBe(0);
  });
});

describe('computeVerdict——五判据收口（退出码单源）', () => {
  it('全绿 → green=true 零 fail', () => {
    const v = computeVerdict(greenBase);
    expect(v.green).toBe(true);
    expect(v.fails).toEqual([]);
  });

  it('轮次未全 ok → fail 带轮账', () => {
    const v = computeVerdict({ ...greenBase, okCount: 2, rounds: 3 });
    expect(v.green).toBe(false);
    expect(v.fails).toContain('轮次 2/3（有 FAIL 轮）');
  });

  it('drill null（未启用）容忍、false 红', () => {
    expect(computeVerdict({ ...greenBase, drillOk: null }).green).toBe(true);
    const v = computeVerdict({ ...greenBase, drillOk: false });
    expect(v.green).toBe(false);
    expect(v.fails).toContain('kill 演练 FAIL');
  });

  it('预算 null（未设帽）容忍、超帽红', () => {
    expect(computeVerdict({ ...greenBase, budgetWithin: null }).green).toBe(true);
    const v = computeVerdict({ ...greenBase, budgetWithin: false });
    expect(v.green).toBe(false);
    expect(v.fails).toContain('RSS 预算超帽');
  });

  it('errLines 超帽红（帽 0 零容忍——1 行即红）', () => {
    const v = computeVerdict({ ...greenBase, errLines: 3, errLinesCap: 0 });
    expect(v.green).toBe(false);
    expect(v.fails).toContain('daemon.log error 行 3 > 帽 0');
  });

  it('errLines 帽可放宽（2/2 内绿）', () => {
    expect(computeVerdict({ ...greenBase, errLines: 2, errLinesCap: 2 }).green).toBe(true);
  });

  it('任一会话 seq 断洞红（fail 行带会话与断点细节）', () => {
    const v = computeVerdict({
      ...greenBase,
      seqBreaksBySession: {
        'sess-a': [],
        'sess-b': [{ from: 1, to: 3, gap: 1 }],
      },
    });
    expect(v.green).toBe(false);
    expect(v.fails.some((f) => f.includes('sess-b') && f.includes('1→3'))).toBe(true);
  });

  it('多判据同红全列（不首中即止）', () => {
    const v = computeVerdict({
      ...greenBase,
      okCount: 1,
      rounds: 3,
      errLines: 1,
      errLinesCap: 0,
    });
    expect(v.green).toBe(false);
    expect(v.fails.length).toBe(2);
  });
});

describe("computeVerdict——第六判据 unattended（无人值守三腿——研究档 C4'）", () => {
  /** 无人值守全绿基线（三腿全启用且全达标） */
  const unattendedGreen = {
    ...greenBase,
    unattended: { tickSessions: 2, tickSessionsMin: 1, compactions: 1, compactionsMin: 1, dockResumeOk: true },
  };

  it('第六判据：tick 会话缺席即红（tickSessionsMin=1 传 0 → fails 含归因行）', () => {
    const v = computeVerdict({
      ...greenBase,
      unattended: { tickSessions: 0, tickSessionsMin: 1, compactions: 1, compactionsMin: 1, dockResumeOk: true },
    });
    expect(v.green).toBe(false);
    expect(v.fails.some((f) => f.includes('无人值守') && f.includes('tick') && f.includes('0'))).toBe(true);
  });

  it('第六判据：压缩事件未达标红与 null 容忍（min null 恒绿）', () => {
    // 实得 0 < 最低 1 → 红
    const v = computeVerdict({
      ...greenBase,
      unattended: { tickSessions: 1, tickSessionsMin: 1, compactions: 0, compactionsMin: 1, dockResumeOk: true },
    });
    expect(v.green).toBe(false);
    expect(v.fails.some((f) => f.includes('无人值守') && f.includes('压缩') && f.includes('0'))).toBe(true);
    // 期望缺席（compactionsMin null）——腿未启用容忍恒绿
    const v2 = computeVerdict({
      ...greenBase,
      unattended: { tickSessions: 1, tickSessionsMin: 1, compactions: 0, compactionsMin: null, dockResumeOk: null },
    });
    expect(v2.green).toBe(true);
  });

  it('第六判据：停靠唤醒 FAIL 红未启用绿（dockResumeOk false 红 / null 容忍）', () => {
    const v = computeVerdict(unattendedGreen);
    expect(v.green).toBe(true); // true 绿 + null 容忍的全对拍
    const vFail = computeVerdict({
      ...greenBase,
      unattended: { tickSessionsMin: null, compactionsMin: null, dockResumeOk: false },
    });
    expect(vFail.green).toBe(false);
    expect(vFail.fails.some((f) => f.includes('无人值守') && f.includes('停靠唤醒'))).toBe(true);
    // null = 腿未启用——恒绿
    const vNull = computeVerdict({
      ...greenBase,
      unattended: { tickSessionsMin: null, compactionsMin: null, dockResumeOk: null },
    });
    expect(vNull.green).toBe(true);
  });

  it('第六判据整位缺席（unattended null = 未启用）恒绿（批 B 既有五判据入参零扰动）', () => {
    // 旧调用形（无 unattended 键）不受新判据影响——扩判据非破坏性
    expect(computeVerdict(greenBase).green).toBe(true);
    expect(computeVerdict({ ...greenBase, unattended: null }).green).toBe(true);
  });
});

describe("driftStatsOf——首末三分位中位数（研究档 C5' 纯函数）", () => {
  it('少于 6 样本返回 null（样本窗不足豁免——quick 三轮天然不执法）', () => {
    expect(driftStatsOf([1, 1, 1, 4, 4])).toBeNull();
    expect(driftStatsOf([])).toBeNull();
  });

  it('首末各取 1/3 中位数相除（首 1s 末 4s → ratio 4）', () => {
    const s = driftStatsOf([1, 1, 1, 4, 4, 4]);
    expect(s).not.toBeNull();
    expect(s.ratio).toBe(4);
    expect(s.firstMedianSec).toBe(1);
    expect(s.lastMedianSec).toBe(4);
  });

  it('偶数窗中位数取中间两数均值', () => {
    // 8 样本：首 1/3 = floor(8/3)=2 条 [1,1]；末 2 条 [9,11] → 末中位 10 → ratio 10
    const s = driftStatsOf([1, 1, 2, 2, 2, 2, 9, 11]);
    expect(s).not.toBeNull();
    expect(s.firstMedianSec).toBe(1);
    expect(s.lastMedianSec).toBe(10);
    expect(s.ratio).toBe(10);
  });

  it('脏值过滤（非数字/零/负不入样本窗）', () => {
    const s = driftStatsOf([1, 1, 1, 'x', 0, -2, 4, 4, 4, null]);
    expect(s).not.toBeNull();
    expect(s.ratio).toBe(4);
  });
});

describe("computeVerdict——延迟漂移判据（研究档 C5'）", () => {
  it('延迟漂移：末段中位数超帽即红（driftRatio 4.0 > 帽 3.0 → fails 含漂移行与两端中位数）', () => {
    const v = computeVerdict({
      ...greenBase,
      driftRatio: 4,
      driftCap: 3,
      driftFirstMedianSec: 1.2,
      driftLastMedianSec: 4.8,
    });
    expect(v.green).toBe(false);
    expect(v.fails.some((f) => f.includes('延迟漂移') && f.includes('1.2') && f.includes('4.8'))).toBe(true);
  });

  it('延迟漂移：轮数不足样本窗容忍（driftRatio null 恒绿）', () => {
    const v = computeVerdict({ ...greenBase, driftRatio: null, driftCap: 3 });
    expect(v.green).toBe(true);
  });

  it('延迟漂移：未设帽 null 容忍（driftCap null 恒绿——与 RSS 预算 null 容忍同形）', () => {
    const v = computeVerdict({ ...greenBase, driftRatio: 9.9, driftCap: null });
    expect(v.green).toBe(true);
  });

  it('延迟漂移：帽内绿（ratio ≤ 帽）', () => {
    const v = computeVerdict({ ...greenBase, driftRatio: 3, driftCap: 3 });
    expect(v.green).toBe(true);
  });
});
