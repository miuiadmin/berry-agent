/**
 * 批 18c-5 周期路编排件测试——计数挂件（双腿阈值/污染标记喂点/里程表复位）+
 * 审阅窗切片（恰含最近 N 回合——06 §4 提取管线 review 转录窗口〔最近 N turn〕语义；修前必红回归锁）+
 * fire 序（sweepExpired 同步首步/polluted 跳 review 清扫照跑/inFlight 单飞）+
 * fire 回执分级投影（呈现链兑现——06 篇 72 轮批注：skipped-parse/非零运维计数
 * 每类恰一笔 warn，常态档零投影，skipped-error 同事件一笔律不重复）。
 *
 * LLM 全桩（计划注入式——零真网络）；dao 用真库（sweepExpired 物化参与断言）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../../src/persist/index.js';
import type { SessionEvent } from '../../src/contracts/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import { createMemoryCycle } from './cycle.js';
import { sliceReviewWindow } from './cycle.js';
import { createConsolidator } from './consolidate.js';
import type { MemoryLlmFace } from './types.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;
const warn = vi.fn();
const DAY = 86_400_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-cycle-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开库+迁移链+DAO（一 setup 一库文件） */
function openDao(): MemoryDao {
  store = openStore({
    dbPath: join(dir, `test-${++dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn,
    newId: () => `m${++idSeq}`,
  });
}

/** 事件信封便捷构造 */
function ev(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: nowMs, data };
}

/** LLM 桩（reply = complete 回的文本；calls 面供零调用断言） */
function llmStub(opts: { reply?: string } = {}): {
  face: MemoryLlmFace;
  prompts: string[];
  sessionIds: (string | undefined)[];
} {
  const prompts: string[] = [];
  const sessionIds: (string | undefined)[] = [];
  const face: MemoryLlmFace = {
    async complete(req) {
      prompts.push(req.messages[0]!.content);
      sessionIds.push(req.sessionId); // 计量归因穿线收集（04 §5 mq——review 与 consolidation 同收）
      return { message: { content: opts.reply ?? '[]' } };
    },
    canAfford: () => true,
  };
  return { face, prompts, sessionIds };
}

/** 闸门 LLM 桩（每次 complete 悬置一格，release 按序放行——多次 fire 测用） */
function gatedLlm(): { face: MemoryLlmFace; release: (reply: string) => void } {
  const pending: ((reply: { message: { content: string } }) => void)[] = [];
  const face: MemoryLlmFace = {
    complete: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
    canAfford: () => true,
  };
  return { face, release: (reply) => pending.shift()!({ message: { content: reply } }) };
}

/** N 回合事件窗（每回合 = user/message + turn/end；文本标 turn-N） */
function turns(n: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (let t = 1; t <= n; t++) {
    events.push(ev('user/message', 2 * t - 1, { content: `turn-${t} 的用户消息` }));
    events.push(ev('turn/end', 2 * t, {}));
  }
  return events;
}

/** 编排件便捷装配（fetchEvents 缺省回给定窗） */
function cycle(
  dao: MemoryDao,
  face: MemoryLlmFace,
  events: readonly SessionEvent[],
): ReturnType<typeof createMemoryCycle> {
  return createMemoryCycle({ dao, llm: face, fetchEvents: () => events, warn });
}

/**
 * 定时钟编排件装配（consolidator 注入位传测试钟——周期路缺省自建 consolidator
 * 用真实墙钟判老化，本夹具钟 2026-09-08 相对真实钟恒新鲜；注入后老化判据可确定性拨钟）。
 */
function cycleWithClock(
  dao: MemoryDao,
  face: MemoryLlmFace,
  events: readonly SessionEvent[],
  clockMs: number,
): ReturnType<typeof createMemoryCycle> {
  return createMemoryCycle({
    dao,
    llm: face,
    fetchEvents: () => events,
    warn,
    consolidator: createConsolidator({ dao, llm: face, warn, now: () => clockMs }),
  });
}

describe('计数挂件（durable 双腿词阈值）', () => {
  it('turn 腿：10 个 turn/end 达阈记 due；9 个未达', () => {
    const dao = openDao();
    const c = cycle(dao, llmStub().face, []);
    for (let t = 1; t <= 9; t++) c.onDurableEvent('s1', ev('turn/end', t, {}));
    expect(c.dueSessions()).toEqual([]);
    c.onDurableEvent('s1', ev('turn/end', 10, {}));
    expect(c.dueSessions()).toEqual(['s1']);
  });

  it('tool/call 腿独立达阈（15 次）；双腿混合累进；user/message 不计数', () => {
    const dao = openDao();
    const c = cycle(dao, llmStub().face, []);
    for (let i = 1; i <= 6; i++) c.onDurableEvent('s1', ev('turn/end', i, {}));
    for (let i = 1; i <= 14; i++) c.onDurableEvent('s1', ev('tool/call', 100 + i, { name: 'exec' }));
    expect(c.dueSessions()).toEqual([]);
    c.onDurableEvent('s1', ev('tool/call', 115, { name: 'exec' }));
    expect(c.dueSessions()).toEqual(['s1']);

    // 其余事件类型与计数无关；会话隔离
    const c2 = cycle(dao, llmStub().face, []);
    for (let i = 0; i < 30; i++) c2.onDurableEvent('sX', ev('user/message', i, { content: 'hi' }));
    expect(c2.dueSessions()).toEqual([]);
  });

  it('tool/call data.name 喂污染标记：fetch/__复合键标记；exec 不标记；坏形载荷不炸', () => {
    const dao = openDao();
    const c = cycle(dao, llmStub().face, []);
    expect(c.pollution.isPolluted('s1')).toBe(false);
    c.onDurableEvent('s1', ev('tool/call', 1, { name: 'exec' }));
    expect(c.pollution.isPolluted('s1')).toBe(false);
    c.onDurableEvent('s1', ev('tool/call', 2, { name: 'github__list_prs' }));
    expect(c.pollution.isPolluted('s1')).toBe(true); // *__* 复合键族
    expect(c.pollution.isPolluted('s2')).toBe(false); // 会话隔离
    // 坏形载荷（无 name/非对象）——不标记不炸
    expect(() => c.onDurableEvent('s3', ev('tool/call', 3, { args: {} }))).not.toThrow();
    expect(() => c.onDurableEvent('s3', ev('tool/call', 4, null))).not.toThrow();
    expect(c.pollution.isPolluted('s3')).toBe(false);
  });
});

describe('审阅窗切片 sliceReviewWindow', () => {
  it('恰含最近 N 回合：14 回合窗 10 → turn-5..turn-14（N 回合不是 N-1——修前必红）', () => {
    const window = sliceReviewWindow(turns(14), 10);
    const texts = window.filter((e) => e.type === 'user/message').map((e) => (e.data as { content: string }).content);
    expect(texts).toHaveLength(10);
    expect(texts[0]).toContain('turn-5'); // 窗首 = 第 T-N+1 回合
    expect(texts.at(-1)).toContain('turn-14');
    expect(texts.some((t) => t.includes('turn-4'))).toBe(false); // 边界前一回合不入窗
  });

  it('回合不足窗 → 全量', () => {
    const window = sliceReviewWindow(turns(3), 10);
    expect(window).toHaveLength(6); // 3 回合全量
  });
});

describe('fire 序（sweep 首步 → 资格 → review → consolidation → 复位）', () => {
  it('常规轮：review 拍完成 + 空库 consolidation skipped-empty（零额外 LLM 调用）+ 计数器复位', async () => {
    const dao = openDao();
    const { face, prompts, sessionIds } = llmStub({ reply: '[]' });
    const c = cycle(dao, face, turns(4));
    for (let t = 1; t <= 10; t++) c.onDurableEvent('s1', ev('turn/end', t, {}));
    expect(c.dueSessions()).toEqual(['s1']);

    const r = await c.fire('s1');
    expect(r.outcome).toBe('reviewed');
    expect(r.sweptExpired).toBe(0);
    expect(r.review).toEqual({ outcome: 'ran', extracted: 0, discarded: 0 });
    expect(r.consolidation!.outcome).toBe('skipped-empty'); // 空库候选面空
    expect(prompts).toHaveLength(1); // 只有 review 一拍——consolidation 零调用
    // 计量归因穿线（04 §5 mq）：fire(sessionId) 两调用位同归因——review 一笔到位、
    // consolidation skipped-empty 零调用不计
    expect(sessionIds).toEqual(['s1']);

    // 里程表复位：due 清空；再喂 1 回合不达阈、攒满 10 回合重新 due
    expect(c.dueSessions()).toEqual([]);
    c.onDurableEvent('s1', ev('turn/end', 101, {}));
    expect(c.dueSessions()).toEqual([]);
    for (let t = 2; t <= 10; t++) c.onDurableEvent('s1', ev('turn/end', 100 + t, {}));
    expect(c.dueSessions()).toEqual(['s1']);
  });

  it('sweepExpired 同步首步：TTL 过期行物化（fire 恒清——含 polluted 轮）', async () => {
    const dao = openDao();
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'short-lived note',
      content: 'short-lived',
      confidence: 0.5,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
      ttlDays: 7,
    });
    nowMs += 8 * DAY; // 拨钟过 TTL
    const { face, prompts } = llmStub({ reply: '[]' });
    const c = cycle(dao, face, turns(2));
    const r = await c.fire('s1');
    expect(r.sweptExpired).toBe(1); // 首步物化先行
    expect(prompts).toHaveLength(1); // review 照跑（未污染）
  });

  it('polluted 会话：跳 review 但 sweep + consolidation 照跑（遗忘走淘汰批）', async () => {
    const dao = openDao();
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'short-lived polluted note',
      content: 'short-lived',
      confidence: 0.5,
      sourceRefs: [{ sessionId: 'sp', seq: 1 }],
      ttlDays: 7,
    });
    nowMs += 8 * DAY;
    const { face, prompts } = llmStub({ reply: '[]' });
    const c = cycle(dao, face, turns(2));
    c.onDurableEvent('sp', ev('tool/call', 1, { name: 'fetch' })); // 污染标记
    const r = await c.fire('sp');
    expect(r.outcome).toBe('skipped-polluted');
    expect(r.review).toBeUndefined(); // review 跳过
    expect(r.sweptExpired).toBe(1); // TTL 清扫恒执行
    expect(r.consolidation).toBeDefined(); // 整理照跑
    expect(prompts).toHaveLength(0); // 零 LLM 调用（review 跳 + 空库 consolidation 不拍）
  });

  it('审阅窗 14 回合喂 LLM：prompt 含 turn-5..turn-14、不含 turn-4（切片接线面）', async () => {
    const dao = openDao();
    const { face, prompts } = llmStub({ reply: '[]' });
    const c = cycle(dao, face, turns(14));
    const r = await c.fire('s1');
    expect(r.outcome).toBe('reviewed');
    expect(prompts[0]).toContain('turn-14');
    expect(prompts[0]).toContain('turn-5');
    expect(prompts[0]).not.toContain('turn-4');
  });

  it('inFlight 单飞：同会话并发 fire 第二发 skipped-inflight；闸放行后首发完成', async () => {
    const dao = openDao();
    const { face, release } = gatedLlm();
    const c = cycle(dao, face, turns(2));
    const first = c.fire('s1');
    await Promise.resolve(); // 让首发放行至 LLM 悬置位
    const second = await c.fire('s1');
    expect(second.outcome).toBe('skipped-inflight');
    release('[]'); // 放闸——首发的 review 拍
    expect((await first).outcome).toBe('reviewed');
    // 首发收尾后单飞锁释放——可再拍（再放一格）
    const third = c.fire('s1');
    await Promise.resolve();
    release('[]');
    expect((await third).outcome).toBe('reviewed');
  });

  /* —— fire 回执分级投影（呈现链兑现——06 篇 72 轮批注；修前必红：现状零投影）——
     每类恰一笔（review / consolidation 各至多一行）；常态档 + 全零计数零投影；
     skipped-error 由 complete 抛错位既有 warn 承担（同事件一笔律——收尾不重复投影） */

  it('skipped-parse 双拍各一笔：review 与 consolidation 各一行带标签（修前必红）', async () => {
    const dao = openDao();
    // 老化候选：一行 91 天未变更（consolidation 候选集非空才能拍到 parse 位）
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'stale note',
      content: 'stale',
      confidence: 0.5,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    });
    // consolidator 测试钟拨 91 天——行老化入候选（缺省自建真实墙钟不随夹具钟走）
    const { face } = llmStub({ reply: '这不是 JSON' }); // 双拍同回坏形
    const c = cycleWithClock(dao, face, turns(2), nowMs + 91 * DAY);
    const r = await c.fire('s1');
    expect(r.review!.outcome).toBe('skipped-parse'); // 回复整体非 JSON
    expect(r.consolidation!.outcome).toBe('skipped-parse'); // 计划整体坏形
    expect(warn).toHaveBeenCalledTimes(2); // 每类恰一笔
    const reviewWarns = warn.mock.calls.filter(([m]) => typeof m === 'string' && m.startsWith('[MEMORY_CYCLE_REVIEW]'));
    const consolidateWarns = warn.mock.calls.filter(
      ([m]) => typeof m === 'string' && m.startsWith('[MEMORY_CYCLE_CONSOLIDATE]'),
    );
    expect(reviewWarns).toHaveLength(1);
    expect(consolidateWarns).toHaveLength(1);
    expect(reviewWarns[0]![0]).toContain('skipped-parse'); // 关键短语：解析全败档
    expect(consolidateWarns[0]![0]).toContain('skipped-parse');
  });

  it('discarded>0 并入 review 类恰一笔（ran + 按条丢弃计数——修前必红）', async () => {
    const dao = openDao();
    const { face } = llmStub({
      reply: JSON.stringify([{ kind: 'fact', summary: 's', content: 'c', sourceSeq: 1 }, { bad: '未知字段坏形' }]),
    });
    const c = cycle(dao, face, turns(2));
    const r = await c.fire('s1');
    expect(r.review).toEqual({ outcome: 'ran', extracted: 1, discarded: 1 });
    expect(r.consolidation!.outcome).toBe('skipped-empty'); // 新摄入未老化——整理不拍零线
    expect(warn).toHaveBeenCalledTimes(1); // review 类恰一笔
    expect(warn.mock.calls[0]![0]).toContain('[MEMORY_CYCLE_REVIEW]');
    expect(warn.mock.calls[0]![0]).toContain('丢弃 1 条'); // 计数入线
  });

  it('rejectedGroups/ignoredSuggestions 并入 consolidation 类恰一笔（护栏驳回+集外忽略——修前必红）', async () => {
    const dao = openDao();
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'alpha note',
      content: 'alpha',
      confidence: 0.5,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    });
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'beta note',
      content: 'beta',
      confidence: 0.5,
      sourceRefs: [{ sessionId: 's1', seq: 2 }],
    });
    // consolidator 测试钟拨 91 天——两行老化入候选（id 实取——不耦合 id 生成格式）
    const rows = dao.listVisible();
    const keepId = rows[0]!.id;
    const dropId = rows[1]!.id;
    const { face, prompts } = llmStub({
      reply: JSON.stringify({
        merges: [
          { action: 'merge', keep: keepId, drop: dropId, reason: 'zzz qqq' }, // 理由零交集 → 驳回
          { action: 'merge', keep: keepId, drop: 'm-nope', reason: 'alpha' }, // 集外 id → 忽略
        ],
        decays: [],
      }),
    });
    const c = cycleWithClock(dao, face, [], nowMs + 91 * DAY); // 审阅窗空——review skipped-empty 零线（常态档）
    const r = await c.fire('s1');
    expect(r.review!.outcome).toBe('skipped-empty');
    expect(r.consolidation).toEqual({
      outcome: 'ran',
      candidateCount: 2,
      merged: 0,
      decayed: 0,
      rejectedGroups: 1,
      ignoredSuggestions: 1,
    });
    expect(prompts).toHaveLength(1); // 只有 consolidation 一拍
    expect(warn).toHaveBeenCalledTimes(1); // consolidation 类恰一笔（两计数并线）
    expect(warn.mock.calls[0]![0]).toContain('[MEMORY_CYCLE_CONSOLIDATE]');
    expect(warn.mock.calls[0]![0]).toContain('驳回 1 组');
    expect(warn.mock.calls[0]![0]).toContain('忽略 1 条');
  });

  it('常态档零投影逐字锁：ran（含 0 提取）/skipped-empty/skipped-budget/skipped-inflight/skipped-polluted + 全零计数——warn 零调用', async () => {
    // ran + 0 提取（真拍了）+ consolidation skipped-empty——全零计数零投影
    let dao = openDao();
    let c = cycle(dao, llmStub({ reply: '[]' }).face, turns(2));
    let r = await c.fire('s1');
    expect(r.review).toEqual({ outcome: 'ran', extracted: 0, discarded: 0 });
    expect(warn).not.toHaveBeenCalled();

    // skipped-empty（审阅窗无转录行——库面水位可直查）
    warn.mockClear();
    dao = openDao();
    c = cycle(dao, llmStub().face, []);
    r = await c.fire('s1');
    expect(r.review!.outcome).toBe('skipped-empty');
    expect(warn).not.toHaveBeenCalled();

    // skipped-budget（canAfford 拒——budget 拒是常事）
    warn.mockClear();
    dao = openDao();
    const poorLlm: MemoryLlmFace = {
      complete: async () => ({ message: { content: '[]' } }),
      canAfford: () => false,
    };
    c = cycle(dao, poorLlm, turns(2));
    r = await c.fire('s1');
    expect(r.review!.outcome).toBe('skipped-budget');
    expect(warn).not.toHaveBeenCalled();

    // skipped-inflight（并发第二发早退不投影）+ 首发 ran 全零（真拍零候选常态）
    warn.mockClear();
    dao = openDao();
    const gated = gatedLlm();
    c = cycle(dao, gated.face, turns(2));
    const first = c.fire('s1');
    await Promise.resolve();
    const second = await c.fire('s1');
    expect(second.outcome).toBe('skipped-inflight');
    gated.release('[]');
    expect((await first).review).toEqual({ outcome: 'ran', extracted: 0, discarded: 0 });
    expect(warn).not.toHaveBeenCalled();

    // skipped-polluted（review 缺席 + 空库整理 skipped-empty）
    warn.mockClear();
    dao = openDao();
    c = cycle(dao, llmStub({ reply: '[]' }).face, turns(2));
    c.onDurableEvent('s1', ev('tool/call', 1, { name: 'fetch' })); // 污染标记
    r = await c.fire('s1');
    expect(r.outcome).toBe('skipped-polluted');
    expect(warn).not.toHaveBeenCalled();
  });

  it('skipped-error 不重复投影：complete 抛错位 warn 恰一笔、fire 收尾零加笔（同事件一笔律）', async () => {
    const dao = openDao();
    // 老化候选——consolidation 也走到 complete 抛错位（两拍各自抛错位恰一笔）
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'stale note',
      content: 'stale',
      confidence: 0.5,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    });
    // consolidator 测试钟拨 91 天——行老化入候选
    const face: MemoryLlmFace = {
      complete: () => Promise.reject(new Error('网络炸')),
      canAfford: () => true,
    };
    const c = cycleWithClock(dao, face, turns(2), nowMs + 91 * DAY);
    const r = await c.fire('s1');
    expect(r.review!.outcome).toBe('skipped-error');
    expect(r.consolidation!.outcome).toBe('skipped-error');
    expect(warn).toHaveBeenCalledTimes(2); // review/consolidate 抛错位各恰一笔
    for (const [m] of warn.mock.calls) {
      expect(String(m).includes('[MEMORY_CYCLE_')).toBe(false); // fire 收尾零加笔
    }
  });
});
