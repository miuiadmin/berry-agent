/**
 * compaction — 压缩事件 durable 往返缝合测试（2026-09-16 测试研究批 A7）。
 *
 * 缺口背景：压缩五步事件的既有覆盖分居三处且互不缝合——
 *  - compaction 件单测全纯内存（service.test.ts 恒 new SessionLog()，无物理层）；
 *  - 组合根压缩 e2e 断言读活体内存日志（conversation-stack.test.ts 压缩槽位
 *    装配三例——无 flush/重开）；
 *  - persist 往返是构造 EventWrite 直写 store（store.test.ts surfaceOp 字段
 *    保真，非 write-behind 异步批落路）。
 * 「五步事件经 write-behind 落库 → 关库重开可见 → fold 重建投影对账」全链
 * 零断言。本文件补该链：persist 门面（Persistence——SessionLog onAppend 接
 * write-behind 批落）× 本件服务（createCompactionService）真缝合，真 SQLite
 * 临时库跑三轮真 driver 形会话触发阈值压缩，drain + close 后同库重开，断言：
 *  (a) compaction/start·surface·end 经异步批落重开可见（reason='threshold'）；
 *  (b) compaction/surface 信封（surfaceOp/sourceEventSeqs）往返逐键保真；
 *  (c) source='compaction' 摘要行落库可见；
 *  (d) deriveMessages 全量 fold 重建与压缩后活体投影逐条相等——压缩后视图
 *      跨进程一致（A7 本体断言）。
 *
 * 分层纪律：mock 只停模型层——SummaryChannel 是 complete 单发模型通道的结构
 * 注入面，以固定文本测试替身顶替；摘要正文为测试 fixture 非模型产物，断言
 * 前缀与键位不比生成内容。会话轮形取 wiring.ts 真 driver 序（提交先落消息
 * 后起 turn：user/message → turn/start → assistant/message → turn/end）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, Persistence } from '../persist/index.js';
import { deriveMessages, type ProjectedMessage, type SessionLog } from '../session/index.js';
import { SUMMARY_PREFIX } from './policy.js';
import { createCompactionService } from './service.js';

/** 摘要替身正文（测试 fixture——固定字符串非模型产物） */
const FIXED_SUMMARY = '固定摘要正文fixture';

/** 触发形配置：阈值近零（任何真计量即触发）+ 冷却零 + tail 2（三轮可压中段） */
const FIRE_CONFIG = { thresholdRatio: 0.000001, cooldownMs: 0, tailKeep: 2 } as const;

let dir: string;
/** 待关面（close 幂等——afterEach 兜底关 + 用例内主动关都安全） */
let opened: Persistence[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-compaction-rt-'));
  opened = [];
});

afterEach(async () => {
  for (const p of opened) await p.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

/** 开库助手（同密钥注入——重开连接须能解同一凭证域；登记待关面） */
function openPersistence(dbPath: string, secretKey: Buffer): Persistence {
  const p = Persistence.open({ dbPath, dataDir: join(dir, 'data'), secretKey });
  opened.push(p);
  return p;
}

/** 真 driver 形一轮（wiring.ts 序：提交先落消息后起 turn——planSegment 的真实规划输入形） */
function runRound(log: SessionLog, n: number): void {
  log.append('user/message', { content: `第${n}轮任务`, source: 'user' });
  log.append('turn/start', {});
  log.append('assistant/message', { content: [{ type: 'text', text: `第${n}轮回执` }], stopReason: 'stop' });
  log.append('turn/end', { reason: 'completed' });
}

describe('压缩事件 durable 往返（write-behind 落库 → 重开可见 → fold 重建对账）', () => {
  it('五步事件经异步批落落库：重开 queryEvents 可见 + surfaceOp 信封保真 + 摘要行在场 + fold 重建与活体投影一致', async () => {
    const dbPath = join(dir, 'rt.db');
    const secretKey = ephemeralSecretKey();
    const p1 = openPersistence(dbPath, secretKey);

    // 会话活体接 write-behind（Persistence.attachSession——onAppend 入队）
    const log = p1.createSession({ origin: 'conversation' });
    // 摘要通道替身（模型层）+ 触发形配置——三轮即过阈
    const service = createCompactionService({
      channel: { complete: async () => ({ text: FIXED_SUMMARY }) },
      config: FIRE_CONFIG,
      warn: () => undefined,
    });
    for (let n = 1; n <= 3; n++) runRound(log, n);

    // 阈值触发（真计量形：usage 路判据）→ fire-and-forget 排队，drain 排空
    service.handleRunSettled({ log, usage: { input: 100_000 } });
    await service.drain();

    // 活体证据快照（关库前）——重开对账的对照物
    const liveEvents = log.events();
    const liveSurface = liveEvents.find((event) => event.type === 'compaction/surface')!;
    const liveSummary = liveEvents.find(
      (event) => event.type === 'user/message' && (event.data as { source?: string }).source === 'compaction',
    )!;
    expect(liveSurface).toBeDefined();
    expect(liveSummary).toBeDefined();
    const liveProjection = log.projection();
    expect(liveEvents.filter((event) => event.type === 'compaction/start')).toHaveLength(1);

    // 关库退出序：flush 屏障（write-behind 批落收口）→ checkpoint → close
    await p1.close();

    // —— 重开（同库同密钥——跨进程恢复形态）——
    const p2 = openPersistence(dbPath, secretKey);
    const loaded = p2.loadSession(log.sessionId);
    const reopened = loaded.log.events();

    // (a) 四步事件全可见（queryEvents 三词 + 摘要行各证）且往返零丢失零变序
    const visible = p2
      .queryEvents({ sessionId: log.sessionId, types: ['compaction/start', 'compaction/surface', 'compaction/end'] })
      .events.map((event) => event.type);
    expect(visible.sort()).toEqual(['compaction/end', 'compaction/start', 'compaction/surface']);
    const reopenedStart = reopened.find((event) => event.type === 'compaction/start')!;
    expect((reopenedStart.data as { reason?: string }).reason).toBe('threshold');
    expect((reopenedStart.data as { basis?: string }).basis).toBe('usage');
    expect(reopened.map((event) => event.type)).toEqual(liveEvents.map((event) => event.type));
    expect(reopened.map((event) => event.seq)).toEqual(liveEvents.map((event) => event.seq));

    // (b) surfaceOp 信封经异步批落往返逐键保真（遮蔽指令 + 溯源链）
    const reopenedSurface = reopened.find((event) => event.type === 'compaction/surface')!;
    expect(reopenedSurface.surfaceOp).toEqual(liveSurface.surfaceOp);
    expect(reopenedSurface.surfaceOp).toMatchObject({ op: 'replace' });
    expect(reopenedSurface.sourceEventSeqs).toEqual(liveSurface.sourceEventSeqs);

    // (c) 摘要行落库可见（source='compaction' + 机制前缀——载体形结构位）
    const reopenedSummary = reopened.find(
      (event) => event.type === 'user/message' && (event.data as { source?: string }).source === 'compaction',
    )!;
    expect((reopenedSummary.data as { content: string }).content.startsWith(SUMMARY_PREFIX)).toBe(true);
    expect(reopenedSummary.seq).toBe(liveSummary.seq);

    // (d) fold 重建对账：全量 deriveMessages（重开投影的派生路）与压缩后活体
    // 投影逐条相等——压缩后视图跨进程一致；被遮蔽中段轮消息不在投影、head 轮
    // 与 tail 轮保活、摘要消息在场
    const rebuilt = deriveMessages(reopened);
    expect(rebuilt).toEqual(liveProjection as ProjectedMessage[]);
    const seqs = rebuilt.map((message) => message.seq);
    // 三轮消息锚：u1=0 / a1=2（head）｜u2=4 / a2=6（被遮蔽中段）｜u3=8 / a3=10（tail）+ 摘要
    expect(seqs).toEqual([0, 2, 8, 10, liveSummary.seq]);
    expect(rebuilt.some((message) => message.seq === 4 || message.seq === 6)).toBe(false);
    const summaryMessage = rebuilt.find((message) => message.type === 'user' && message.source === 'compaction');
    expect(summaryMessage?.seq).toBe(liveSummary.seq);
  });
});
