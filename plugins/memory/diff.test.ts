/**
 * memory 简报差分件测试（批 18c-7——06 §6 差分纪律）：
 * 纯函数档（指纹次序不敏感/内容敏感、三态全量差分确定性、注入行格式）+
 * tracker 全档（分叉落账与载荷指纹、幂等免重复追写、收敛清账 entries=[]、
 * 懒派生 last-wins、重启撞指纹自愈〔日志视图非空/当面零漂移 → 清账〕、
 * materialize 重置 mirror 残留即清、epochs LRU 帽 256 与被逐懒立、
 * appendEvent 缺席降级只渲染不落账、落账异常 warn 止步、诊断物化不立纪元）。
 *
 * 零 DB（tracker 经 face/appendEvent/fetchEvents seam 注入假面——词面独立律
 * 的装配面形态即测试形态）；LLM 零参与。
 */
import { describe, expect, it } from 'vitest';
import type { BriefFaceEntry, MemoryDiffData } from './types.js';
import { MEMORY_DIFF_EPOCHS_LRU } from './types.js';
import { createDiffTracker, diffFace, fingerprintOf, renderDiffInjection } from './diff.js';
import type { MemoryDiffDeps } from './diff.js';

/** 完整 id 形（uuid v7 拼形——字典序确定性锚） */
function idOf(n: number): string {
  return `${n.toString(16).padStart(8, '0')}-0000-7000-8000-000000000000`;
}

/** 面条目便捷构造 */
function e(n: number, kind: BriefFaceEntry['kind'], summary: string): BriefFaceEntry {
  return { id: idOf(n), kind, summary };
}

/** A 面（基线形态——两条 fact） */
const FACE_A: readonly BriefFaceEntry[] = [e(1, 'fact', 'first fact'), e(2, 'fact', 'second fact')];

describe('fingerprintOf（次序不敏感——流内排序波动不是权威面变化）', () => {
  it('同内容异序同指纹；内容/kind 变即变；16 位小写 hex', () => {
    expect(fingerprintOf(FACE_A)).toBe(fingerprintOf([...FACE_A].reverse()));
    expect(fingerprintOf(FACE_A)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf([e(1, 'fact', 'first fact！改'), FACE_A[1]!])).not.toBe(fingerprintOf(FACE_A)); // summary 变
    expect(fingerprintOf([e(1, 'insight', 'first fact'), FACE_A[1]!])).not.toBe(fingerprintOf(FACE_A)); // kind 变
    expect(fingerprintOf([FACE_A[0]!])).not.toBe(fingerprintOf(FACE_A)); // 面变（条目退场）
  });
});

describe('diffFace（三态全量差分——按 id 字典序确定性输出；短 id 呈现）', () => {
  it('三态并存：新入 + / 内容变更 ~ / 退场 -；条目 id 为短 id', () => {
    const base = [e(1, 'fact', 'first'), e(2, 'fact', 'second'), e(3, 'fact', 'third')];
    const cur = [e(1, 'fact', 'first 改'), e(3, 'fact', 'third'), e(4, 'insight', 'fourth')];
    expect(diffFace(base, cur)).toEqual([
      { op: '~', id: '00000001', kind: 'fact', summary: 'first 改' },
      { op: '-', id: '00000002', kind: 'fact', summary: 'second' },
      { op: '+', id: '00000004', kind: 'insight', summary: 'fourth' },
    ]);
  });

  it('净零变化 → 空差分（序波动不算变化——指纹同即无差）', () => {
    expect(diffFace(FACE_A, [...FACE_A].reverse())).toEqual([]);
    expect(diffFace([], [])).toEqual([]);
  });
});

describe('renderDiffInjection（派生视图文本面）', () => {
  it('行格式 `${op} [m:短id] [kind] ${summary}` + 防注入框架句压头；零差分 null', () => {
    const text = renderDiffInjection([{ op: '+', id: '00000004', kind: 'insight', summary: 'fourth lesson' }])!;
    const lines = text.split('\n');
    expect(lines[0]).toContain('非本次用户指令');
    expect(lines[1]).toBe('+ [m:00000004] [insight] fourth lesson');
    expect(renderDiffInjection([])).toBeNull();
  });
});

/** tracker 装配（假面可变 + 事件日志双 seam 同源——fetchEvents 读 appendEvent 落账位） */
function fixture(face: () => readonly BriefFaceEntry[], overrides: Partial<MemoryDiffDeps> = {}) {
  const events: { type: string; data: MemoryDiffData }[] = [];
  const warns: string[] = [];
  const deps: MemoryDiffDeps = {
    face,
    appendEvent: (type, data) => {
      events.push({ type, data });
    },
    fetchEvents: () => events.map((ev) => ({ type: ev.type, data: ev.data })),
    warn: (m) => warns.push(m),
    ...overrides,
  };
  return { tracker: createDiffTracker(deps), events, warns, deps };
}

describe('createDiffTracker（纪元与落账）', () => {
  it('零漂移零事件：materialize 后 sync 返回空、无落账', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize('s1');
    expect(tracker.sync('s1')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('分叉落账：载荷 = 全量差分 + 落账时权威面指纹；注入行可渲染', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize('s1');
    face = [...FACE_A, e(4, 'failure', 'new failure lesson')];
    const mirror = tracker.sync('s1');
    expect(mirror).toEqual([{ op: '+', id: '00000004', kind: 'failure', summary: 'new failure lesson' }]);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('memory/diff');
    expect(events[0]!.data.entries).toEqual(mirror);
    expect(events[0]!.data.fingerprint).toBe(fingerprintOf(face)); // 相对当面的权威面指纹
    expect(tracker.renderInjection(mirror)).toContain('+ [m:00000004] [failure] new failure lesson');
  });

  it('幂等：重复 sync（面未再变）不重复追写；全量差分 last-wins（后漂移覆盖前差分）', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize('s1');
    face = [...FACE_A, e(4, 'failure', 'first drift')];
    tracker.sync('s1');
    expect(tracker.sync('s1')).toEqual([{ op: '+', id: '00000004', kind: 'failure', summary: 'first drift' }]);
    expect(events).toHaveLength(1); // 幂等——无重复追写

    face = [...FACE_A, e(5, 'insight', 'second drift')]; // 全量差分 vs 基线（非增量）
    expect(tracker.sync('s1')).toEqual([{ op: '+', id: '00000005', kind: 'insight', summary: 'second drift' }]);
    expect(events).toHaveLength(2); // last-wins：日志最后一条即现行视图
  });

  it('收敛清账：面回基线 → entries=[] 落账、镜像归零；此后幂等', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize('s1');
    face = [...FACE_A, e(4, 'failure', 'drift')];
    tracker.sync('s1');
    face = FACE_A; // 回摆——净变化归零
    expect(tracker.sync('s1')).toEqual([]);
    expect(events.at(-1)!.data).toEqual({ entries: [], fingerprint: fingerprintOf(FACE_A) });
    expect(tracker.sync('s1')).toEqual([]); // 幂等
    expect(events).toHaveLength(2);
  });

  it('重启撞指纹自愈：懒派生发现「日志视图非空 / 当面零漂移」不一致即落清账', () => {
    // 上进程残留：落账过一条 fp(FACE_A) 的差分后回摆退出（净变化恰归零、未及下一请求）
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    events.push({
      type: 'memory/diff',
      data: {
        entries: [{ op: '+', id: '00000004', kind: 'failure', summary: '残留视图' }],
        fingerprint: fingerprintOf(FACE_A),
      },
    });
    // 新进程：boot 物化基线 FACE_A——首请求懒派生读日志撞指纹
    tracker.materialize('s1');
    expect(tracker.sync('s1')).toEqual([]); // 注入面零（基线已含一切）
    expect(events.at(-1)!.data).toEqual({ entries: [], fingerprint: fingerprintOf(FACE_A) }); // 清账事件落账
  });

  it('懒派生 last-wins：取最后一条指纹匹配事件（前史杂音不干扰）', () => {
    let face = FACE_A;
    const preLog: { type: string; data: unknown }[] = [
      { type: 'user/message', data: { content: 'x' } }, // 杂音——非 memory/diff 直过
      {
        type: 'memory/diff',
        data: {
          entries: [{ op: '+', id: '00000009', kind: 'fact', summary: '旧视图' }],
          fingerprint: 'deadbeefdeadbeef',
        },
      }, // 指纹不匹配
    ];
    const { tracker, events } = fixture(() => face, { fetchEvents: () => preLog });
    tracker.materialize('s1');
    expect(tracker.sync('s1')).toEqual([]); // 无匹配 → 空视图、零落账
    expect(events).toEqual([]);
  });

  it('materialize 重置 mirror：重建后基线已含变更，残留派生视图当请求即清', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize('s1');
    face = [...FACE_A, e(4, 'failure', 'drift')];
    tracker.sync('s1'); // 落账差分事件
    tracker.materialize('s1'); // /reload 重建——新基线 = 当面（已含 drift）
    expect(tracker.sync('s1')).toEqual([]); // 派生残留即清（返回 reconcile 后视图）
    expect(events.at(-1)!.data.entries).toEqual([]); // 清账事件恢复日志不变式
  });

  it('epochs LRU 帽 256：被逐纪元下一请求以当面懒立（语义零变——漂移让位重建）', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize('s0');
    for (let i = 1; i <= MEMORY_DIFF_EPOCHS_LRU; i += 1) tracker.materialize(`s-${i}`); // 挤出 s0
    face = [...FACE_A, e(7, 'fact', 'late drift')]; // s0 的漂移在被逐后发生
    expect(tracker.sync('s0')).toEqual([]); // 懒立新基线——零差分零落账（被逐纪元语义）
    expect(events).toEqual([]);
  });

  it('诊断物化（sessionId = null）不立纪元：sync 以当面懒立', () => {
    let face = FACE_A;
    const { tracker, events } = fixture(() => face);
    tracker.materialize(null); // 诊断渲染——只渲染不立纪元
    expect(tracker.sync('s1')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('appendEvent 缺席降级：只渲染不落账（mirror 不锁步——无日志即无视图）', () => {
    let face = FACE_A;
    const { tracker } = fixture(() => face, { appendEvent: undefined, fetchEvents: undefined });
    tracker.materialize('s1');
    face = [...FACE_A, e(4, 'failure', 'drift')];
    expect(tracker.sync('s1')).toEqual([]); // 不落账 → 镜像不锁步 → 零注入
    expect(tracker.renderInjection([{ op: '+', id: '00000004', kind: 'failure', summary: 'x' }])).toContain('+ [m:'); // 渲染面自足
  });

  it('落账异常 warn 止步不外炸；镜像不锁步', () => {
    let face = FACE_A;
    const { tracker, warns } = fixture(() => face, {
      appendEvent: () => {
        throw new Error('sink down');
      },
    });
    tracker.materialize('s1');
    face = [...FACE_A, e(4, 'failure', 'drift')];
    expect(() => tracker.sync('s1')).not.toThrow();
    expect(tracker.sync('s1')).toEqual([]); // 未锁步——两轮皆空
    expect(warns.some((w) => w.includes('差分落账尽力而为止步'))).toBe(true);
  });
});
