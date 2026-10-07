/**
 * host/boot-guard 单测——crash-loop 守卫判定矩阵全格（04 §5 无人值守深化批
 * 定谳②⑤：判序四格 / 判后值生效 off-by-one 锁 / 时钟回拨保守向 / 坏形视同
 * 缺席 / 读写失败降级 / clean 标记三形）。
 *
 * 纯逻辑免库：fake store = 内存 Map 形 + now 注入（boot-failures.ts fs 注入
 * 同律——mock 只停在注入面，判定逻辑零 mock）。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  BOOT_GUARD_STATE_KIND,
  BOOT_GUARD_STATE_KEY,
  BOOT_SHORT_LIVE_MS,
  CRASH_LOOP_STREAK_LIMIT,
  judgeBootGuard,
  markCleanExit,
} from './boot-guard.js';
import type { BootGuardState, BootGuardStore } from './boot-guard.js';

/** 内存 Map 形 fake store（写账全记——断言写不发生/写形/kind 用） */
function fakeStore(initial?: Record<string, unknown>) {
  const rows = new Map<string, unknown>(Object.entries(initial ?? {}));
  const writes: Array<{ key: string; value: unknown; options: { kind?: string } | undefined }> = [];
  const store: BootGuardStore = {
    getStoreState: (key) => (rows.has(key) ? { value: rows.get(key) } : undefined),
    setStoreState: (key, value, options) => {
      writes.push({ key, value, options });
      rows.set(key, value);
    },
  };
  return { store, rows, writes };
}

/** 坏形行注入 helper（值撕裂/字段缺失/类型错三族） */
function withRow(value: unknown) {
  return fakeStore({ [BOOT_GUARD_STATE_KEY]: value });
}

/** 好形行铸造 */
function stateOf(partial: Partial<BootGuardState>): BootGuardState {
  return { lastBootAt: 1_000_000, cleanExit: false, shortLiveStreak: 0, ...partial };
}

const HOUR = 60 * 60 * 1000;

describe('judgeBootGuard 判定矩阵（04 §5 定谳②判序四格）', () => {
  it('格①上次缺席：streak=0 判后写新值（kind boot-guard、cleanExit:false 启动自标非正常）', () => {
    const t = fakeStore();
    const t0 = 5_000_000;
    const out = judgeBootGuard(t.store, { now: () => t0 });
    expect(out.active).toBe(false); // streak 0 < K
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toEqual({
      key: BOOT_GUARD_STATE_KEY,
      value: { lastBootAt: t0, cleanExit: false, shortLiveStreak: 0 },
      options: { kind: BOOT_GUARD_STATE_KIND },
    });
  });

  it('格①cleanExit=true（正常退出自愈源）：streak 归零——哪怕上次带连击计数', () => {
    const t = withRow(stateOf({ cleanExit: true, shortLiveStreak: 2 }));
    const out = judgeBootGuard(t.store, { now: () => 5_000_000 }); // 差值 400 万 ms 亦无关——clean 格先判
    expect(out.active).toBe(false);
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(0);
  });

  it('格②长命猝死（差值 ≥ 短命阈）：streak 归零——天级长跑常态重启形不误伤（L4-1 主修场景）', () => {
    const t = withRow(stateOf({ lastBootAt: 5_000_000, cleanExit: false, shortLiveStreak: 2 }));
    // 差值恰等阈（≥ 含等值界）→ 长命格
    const out = judgeBootGuard(t.store, { now: () => 5_000_000 + BOOT_SHORT_LIVE_MS });
    expect(out.active).toBe(false);
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(0);
  });

  it('格③短命猝死连击 1→2→3 + 判后值生效 off-by-one 锁：第 3 次短命猝死后第 4 轮 active=true（判后 streak ≥ K）', () => {
    const t = fakeStore();
    let now = 5_000_000;
    const opts = { now: () => now };
    // 第 1 轮：缺席 → streak 0（本轮起跑，随后短命猝死）
    expect(judgeBootGuard(t.store, opts).active).toBe(false);
    // 第 2 轮（差值 5min < 10min）：短命猝死 1 连击
    now += 5 * 60 * 1000;
    expect(judgeBootGuard(t.store, opts).active).toBe(false);
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(1);
    // 第 3 轮：2 连击
    now += 5 * 60 * 1000;
    expect(judgeBootGuard(t.store, opts).active).toBe(false);
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(2);
    // 第 4 轮：3 连击 = 第 3 次短命猝死后的 boot——判后 streak 3 ≥ K=3 生效
    now += 5 * 60 * 1000;
    const out = judgeBootGuard(t.store, opts);
    expect(out.active).toBe(true);
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(3);
    // 缺省 K 锚值自证（码面缺省参数非契约常数——常量面锁）
    expect(CRASH_LOOP_STREAK_LIMIT).toBe(3);
    expect(BOOT_SHORT_LIVE_MS).toBe(10 * 60 * 1000);
  });

  it('生效轮后第 5 轮仍短命猝死：streak 续增（4 ≥ 3 守卫持续）；自愈源——差值超阈即归零', () => {
    const t = withRow(stateOf({ lastBootAt: 5_000_000, cleanExit: false, shortLiveStreak: 3 }));
    let now = 5_000_000 + 60 * 1000;
    expect(judgeBootGuard(t.store, { now: () => now }).active).toBe(true); // 4 连击持续生效
    // 长命自愈：守卫生效轮长跑后猝死（差值 ≥ 阈）→ 归零解防（定谳④自愈三源）
    now = 5_000_000 + HOUR;
    expect(judgeBootGuard(t.store, { now: () => now }).active).toBe(false);
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(0);
  });

  it('时钟回拨保守向（定谳⑤b）：差值 ≤ 0（lastBootAt 在未来）同入短命格累积——最多多守卫一轮', () => {
    const t = withRow(stateOf({ lastBootAt: 5_000_000, cleanExit: false, shortLiveStreak: 1 }));
    // now 落后 lastBootAt（差值 -60s ≤ 0）→ 不走长命格（NaN/负皆不满足 ≥），保守入短命格
    const out = judgeBootGuard(t.store, { now: () => 5_000_000 - 60 * 1000 });
    expect(out.active).toBe(false); // 1+1=2 < 3
    expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(2);
  });

  it('坏形值三族视同缺席 streak=0：非对象 / 字段缺失 / 类型错（字符串 lastBootAt）——宁失守卫不误伤', () => {
    for (const bad of [
      'not-an-object',
      42,
      null,
      { lastBootAt: 1, cleanExit: true },
      { lastBootAt: 'x', cleanExit: false, shortLiveStreak: 1 },
      { lastBootAt: 1, cleanExit: 'yes', shortLiveStreak: 0 },
    ]) {
      const t = withRow(bad);
      const out = judgeBootGuard(t.store, { now: () => 5_000_000 });
      expect(out.active).toBe(false); // 视同缺席 → streak 0
      expect((t.rows.get(BOOT_GUARD_STATE_KEY) as BootGuardState).shortLiveStreak).toBe(0);
    }
  });

  it('读失败降级（定谳⑤d）：getStoreState 抛错 → active=false + 写不发生 + warn 固定子串', () => {
    const warn = vi.fn();
    const writes: unknown[] = [];
    const store: BootGuardStore = {
      getStoreState: () => {
        throw new Error('SQLITE_BUSY');
      },
      setStoreState: (key, value, options) => {
        writes.push({ key, value, options });
      },
    };
    const out = judgeBootGuard(store, { now: () => 5_000_000, warn });
    expect(out.active).toBe(false); // 降级 = 本轮不守卫（防线缺席非恢复断裂）
    expect(writes).toHaveLength(0); // 读失败在写前——写不发生
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('crash-loop 守卫判定降级'); // 固定子串
    expect(String(warn.mock.calls[0]![0])).toContain('SQLITE_BUSY'); // 错误文本随行
  });

  it('写失败降级（定谳⑤d）：setStoreState 抛错 → active=false（判了也作罢）+ warn', () => {
    const warn = vi.fn();
    const store: BootGuardStore = {
      getStoreState: () => ({ value: stateOf({ lastBootAt: 5_000_000, cleanExit: false, shortLiveStreak: 5 }) }),
      setStoreState: () => {
        throw new Error('ENOSPC');
      },
    };
    // 旧 streak 5（≥K 生效位）——但写失败即降级不守卫（boot 史未续账，防线缺席回现行行为）
    const out = judgeBootGuard(store, { now: () => 5_000_000 + 60 * 1000, warn });
    expect(out.active).toBe(false);
    expect(String(warn.mock.calls[0]![0])).toContain('crash-loop 守卫判定降级');
  });
});

describe('markCleanExit（退出 closer 真身——clean 位翻真 + streak 清零 + lastBootAt 保留）', () => {
  it('在场：写 {cleanExit: true, shortLiveStreak: 0} 同步直写，lastBootAt 保留', () => {
    const t = withRow(stateOf({ lastBootAt: 7_777_000, cleanExit: false, shortLiveStreak: 2 }));
    markCleanExit(t.store);
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toEqual({
      key: BOOT_GUARD_STATE_KEY,
      value: { lastBootAt: 7_777_000, cleanExit: true, shortLiveStreak: 0 },
      options: { kind: BOOT_GUARD_STATE_KIND },
    });
  });

  it('旧值缺席 = noop（从未判过的库写 clean 无意义）——零写', () => {
    const t = fakeStore();
    markCleanExit(t.store);
    expect(t.writes).toHaveLength(0);
  });

  it('旧值坏形同 noop：无从保留 lastBootAt 的 clean 写不落（下轮 judge 视同缺席自愈）', () => {
    const t = withRow('garbage');
    markCleanExit(t.store);
    expect(t.writes).toHaveLength(0);
    expect(t.rows.get(BOOT_GUARD_STATE_KEY)).toBe('garbage'); // 原值不动
  });

  it('写失败保守向（定谳⑤d）：catch + warn——clean 位保持 false、下轮保守累加（至多多守卫一轮）', () => {
    const warn = vi.fn();
    const rows = new Map<string, unknown>([[BOOT_GUARD_STATE_KEY, stateOf({ cleanExit: false })]]);
    const store: BootGuardStore = {
      getStoreState: (key) => (rows.has(key) ? { value: rows.get(key) } : undefined),
      setStoreState: () => {
        throw new Error('EACCES');
      },
    };
    expect(() => markCleanExit(store, { warn })).not.toThrow(); // 不炸退出序
    expect(rows.get(BOOT_GUARD_STATE_KEY)).toEqual(stateOf({ cleanExit: false })); // 原值保持非正常
    expect(String(warn.mock.calls[0]![0])).toContain('clean 标记写失败'); // 固定子串
  });

  it('读失败同保守向：不炸不写 + warn', () => {
    const warn = vi.fn();
    const store: BootGuardStore = {
      getStoreState: () => {
        throw new Error('SQLITE_CORRUPT');
      },
      setStoreState: () => undefined,
    };
    expect(() => markCleanExit(store, { warn })).not.toThrow();
    expect(String(warn.mock.calls[0]![0])).toContain('clean 标记写失败');
  });
});
