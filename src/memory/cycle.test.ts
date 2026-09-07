/**
 * 批 18c-5 周期路编排件测试——计数挂件（双腿阈值/污染标记喂点/里程表复位）+
 * 审阅窗切片（恰含最近 N 回合——06 §202 转录窗口语义；修前必红回归锁）+
 * fire 序（sweepExpired 同步首步/polluted 跳 review 清扫照跑/inFlight 单飞）。
 *
 * LLM 全桩（计划注入式——零真网络）；dao 用真库（sweepExpired 物化参与断言）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import { createMemoryCycle } from './cycle.js';
import { sliceReviewWindow } from './cycle.js';
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
function llmStub(opts: { reply?: string } = {}): { face: MemoryLlmFace; prompts: string[] } {
  const prompts: string[] = [];
  const face: MemoryLlmFace = {
    async complete(req) {
      prompts.push(req.messages[0]!.content);
      return { message: { content: opts.reply ?? '[]' } };
    },
    canAfford: () => true,
  };
  return { face, prompts };
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
    const { face, prompts } = llmStub({ reply: '[]' });
    const c = cycle(dao, face, turns(4));
    for (let t = 1; t <= 10; t++) c.onDurableEvent('s1', ev('turn/end', t, {}));
    expect(c.dueSessions()).toEqual(['s1']);

    const r = await c.fire('s1');
    expect(r.outcome).toBe('reviewed');
    expect(r.sweptExpired).toBe(0);
    expect(r.review).toEqual({ outcome: 'ran', extracted: 0, discarded: 0 });
    expect(r.consolidation!.outcome).toBe('skipped-empty'); // 空库候选面空
    expect(prompts).toHaveLength(1); // 只有 review 一拍——consolidation 零调用

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
});
