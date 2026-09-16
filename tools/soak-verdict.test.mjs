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
 */
import { describe, expect, it } from 'vitest';
import { computeVerdict, errLineCountOf, seqBreaksOf } from './soak-verdict.mjs';

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
  /** 全绿基线入参（三既有判据过 + 两新判据过） */
  const greenBase = {
    okCount: 3,
    rounds: 3,
    drillOk: null,
    budgetWithin: null,
    errLines: 0,
    errLinesCap: 0,
    seqBreaksBySession: {},
  };

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
