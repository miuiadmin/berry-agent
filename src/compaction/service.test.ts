/**
 * compaction/service 测试 — 编排面全编舞（05 §2.1 五步两事件形 + 防抖三件 +
 * 全局串行 + §2.3 溢出三值；迭代链；空闲逐出帽）。
 *
 * 纪律：SessionLog 全真（session 件）；摘要通道是注入面（结构注入的假件——
 * 纪录/可编程/屏障，非被测机制的替身）；无模型层。
 */
import { describe, it, expect } from 'vitest';
import { SessionLog } from '../session/index.js';
import { createCompactionService, type CompactionServiceOptions } from './service.js';
import { DEFAULT_COMPACTION_CONFIG, type SummaryChannel } from './types.js';
import { SUMMARY_PREFIX } from './policy.js';

/* ---------------- 测试构造件 ---------------- */

/** 可编程摘要通道：脚本项 = 文本 | Error（失败） | Promise（屏障——放行前阻塞） */
function makeChannel(scripts: (string | Error | Promise<void>)[] = []) {
  const calls: { prompt: string; maxChars: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const channel: SummaryChannel = {
    complete: async (request) => {
      calls.push({ ...request });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const item = scripts.length > 0 ? scripts.shift() : `摘要#${calls.length}`;
        if (item instanceof Error) throw item;
        if (item instanceof Promise) await item; // 屏障：排队/在飞编舞的控制面
        const text = typeof item === 'string' ? item : `摘要#${calls.length}`;
        return { text };
      } finally {
        inFlight -= 1;
      }
    },
  };
  return { channel, calls, maxInFlight: () => maxInFlight };
}

/** 组装服务 + 可编程通道 + 假钟（缺省冷却 0——防抖用例自覆盖） */
function makeRig(scripts: (string | Error | Promise<void>)[] = [], options?: Partial<CompactionServiceOptions>) {
  const { channel, calls, maxInFlight } = makeChannel(scripts);
  const warns: string[] = [];
  let clock = 1_000; // 假钟（单调推进面——测试手动拨）
  const service = createCompactionService({
    channel,
    now: () => clock,
    warn: (m) => warns.push(m),
    config: { cooldownMs: 0, ...options?.config },
    ...options,
  });
  return { service, calls, warns, maxInFlight, advance: (ms: number) => (clock += ms) };
}

/** 六轮日志（12 条投影消息——tailKeep 6 常规夹具；projectedChars 约 1KiB 级） */
function sixTurnLog(sessionId = 's-1'): SessionLog {
  const log = new SessionLog({ sessionId });
  for (let i = 1; i <= 6; i++) {
    log.append('turn/start', {});
    log.append('user/message', { content: `任务指令 ${i}`, source: 'user' });
    log.append('assistant/message', { content: [{ type: 'text', text: `回答 ${i}` }] });
    log.append('turn/end', { reason: 'completed' });
  }
  return log;
}

/** 真 token 触发笔（input 100k / 窗 200k = 50% 达阈） */
const FIRE_USAGE = { input: 100_000, contextWindow: 200_000 };

/* ---------------- 五步两事件形（阈值路全链） ---------------- */

describe('handleRunSettled 五步两事件形', () => {
  it('触发 → 四事件落账序 start→摘要→surface(信封)→end；投影换摘要；审计载荷对账', async () => {
    const rig = makeRig(['压缩完成摘要']);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();

    // 事件序：start → user/message(source=compaction) → compaction/surface → end
    const tailTypes = log
      .events()
      .slice(-4)
      .map((e) => e.type);
    expect(tailTypes).toEqual(['compaction/start', 'user/message', 'compaction/surface', 'compaction/end']);
    const [start, summary, surface, end] = log.events().slice(-4);

    // start：判据快照五件（RP4 扩值——cache 两桶随真值笔透传）+ willRetry
    expect(start!.data).toMatchObject({
      reason: 'threshold',
      willRetry: true,
      basis: 'usage',
      estTokens: 100_000,
      effectiveWindow: 200_000,
    });
    // 摘要：普通 append（无 surfaceOp——两事件形）、载体前缀、source 归因；
    // CCR 标记段（05 §2.1 压缩可逆性）：尾部 host 追加——当次标记行与 surface
    // 的 ccrHash 映射位同源一致（「标记里的 hash 必须能兑付」往返契约）
    const surfaceData = surface!.data as { ccrHash: string; occludedChars: number };
    expect(summary!.data).toEqual({
      content:
        `${SUMMARY_PREFIX} 压缩完成摘要\n\n` +
        `<<ccr:${surfaceData.ccrHash}>> 原文已归档（4 条消息 / ${surfaceData.occludedChars} 字符）`,
      source: 'compaction',
    });
    expect(surfaceData.ccrHash).toMatch(/^[0-9a-f]{16}$/);
    expect(summary!.surfaceOp).toBeUndefined();
    expect(summary!.seq).toBe((surface!.data as { summarySeq: number }).summarySeq);
    // surface：信封独携 + 溯源完整（区间全部 seq + 摘要 seq）+ CCR 归档映射位
    expect(surface!.surfaceOp).toEqual({ op: 'replace', start: 4, end: 12 });
    const expectedSeqs = [...Array(12 - 4 + 1).keys()].map((i) => 4 + i).concat([summary!.seq]);
    expect(surface!.sourceEventSeqs).toEqual(expectedSeqs);
    expect(surface!.data).toMatchObject({
      summarySeq: summary!.seq,
      occludedMessages: 4,
      ccrHash: surfaceData.ccrHash,
    });
    // end：完成 + 规模审计
    expect(end!.data).toMatchObject({ reason: 'completed', occludedMessages: 4, occludedChars: expect.any(Number) });

    // 投影：首 turn 保留、被遮中段消失、摘要与 tail 在场
    const texts = JSON.stringify(log.projection());
    expect(texts).toContain('任务指令 1'); // head 保首个完整 turn
    expect(texts).not.toContain('任务指令 2'); // 中段被遮
    expect(texts).toContain('压缩完成摘要'); // 摘要入投影
    expect(texts).toContain('任务指令 6'); // tail 保留
    // 投影字符量同步回退（fold chars 减法腿——遮蔽落账即生效）
    expect(log.projectedChars()).toBeGreaterThan(0);
  });

  it('判据兜底路：无真值时 chars/4 估算触发，basis=estimate 落账', async () => {
    const rig = makeRig(['兜底摘要'], { config: { fallbackWindowTokens: 100 } }); // 小窗让小投影达阈
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log }); // 无 usage 笔
    await rig.service.drain();
    const start = log.eventsOfType('compaction/start')[0]!;
    expect(start.data).toMatchObject({ basis: 'estimate', willRetry: true });
    expect(log.eventsOfType('compaction/end').at(-1)!.data).toMatchObject({ reason: 'completed' });
  });

  it('basis 五件（RP4）：真值笔携 cache 两桶同笔落账；缺桶不落键（无 false 零值）', async () => {
    // 携桶形：cacheRead/cacheWrite 从 usage 真值笔透传进 start 判据快照
    const rig = makeRig(['摘要甲']);
    const logA = sixTurnLog();
    rig.service.handleRunSettled({
      log: logA,
      usage: { input: 100_000, contextWindow: 200_000, cacheRead: 7_000, cacheWrite: 3_000 },
    });
    await rig.service.drain();
    expect(logA.eventsOfType('compaction/start')[0]!.data).toMatchObject({
      basis: 'usage',
      cacheRead: 7_000,
      cacheWrite: 3_000,
    });
    // 缺桶形：usage 笔无 cache 桶（供应商未报/旧档）——键缺席而非 0
    const logB = sixTurnLog();
    rig.service.handleRunSettled({ log: logB, usage: FIRE_USAGE });
    await rig.service.drain();
    const startB = logB.eventsOfType('compaction/start')[0]!.data as Record<string, unknown>;
    expect(startB['cacheRead']).toBeUndefined();
    expect(startB['cacheWrite']).toBeUndefined();
  });

  it('未达阈不动作（零事件零通道调用）', async () => {
    const rig = makeRig();
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: { input: 1_000, contextWindow: 200_000 } });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(0);
    expect(log.events()).toHaveLength(24);
  });

  it('通道失败 → end-failed 即时闭段 + 投影不动 + 可观测 warn', async () => {
    const rig = makeRig([new Error('通道断电')]);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    const tailTypes = log
      .events()
      .slice(-2)
      .map((e) => e.type);
    expect(tailTypes).toEqual(['compaction/start', 'compaction/end']); // 孤 start 即闭——无悬挂
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'failed' });
    expect(log.events()).toHaveLength(26); // 仅两事件——摘要/遮蔽均未落
    expect(JSON.stringify(log.projection())).toContain('任务指令 2'); // 投影原样
    expect(rig.warns.join('\n')).toContain('COMPACTION_FAILED');
  });
});

/* ---------------- 防抖三件（冷却 / 防重入 / 进行中标志） ---------------- */

describe('防抖三件', () => {
  it('冷却：成功后冷却窗内同会话不再触发（通道调用不增）', async () => {
    const rig = makeRig(['a', 'b'], { config: { cooldownMs: 600_000 } });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(1);
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE }); // 窗内（假钟未拨）
    await rig.service.drain();
    expect(rig.calls).toHaveLength(1);
    rig.advance(600_000); // 拨过冷却窗 + 追加新轮使区间非空
    for (let i = 7; i <= 9; i++) {
      log.append('turn/start', {});
      log.append('user/message', { content: `续 ${i}`, source: 'user' });
      log.append('assistant/message', { content: [{ type: 'text', text: `答 ${i}` }] });
      log.append('turn/end', { reason: 'completed' });
    }
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(2);
  });

  it('防重入：进行中标志期内重复触发不再入队（屏障释放后恰一次）', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const rig = makeRig([barrier, '不应被消费']);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE }); // 排队 → 执行 → 阻在屏障
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE }); // pending → 跳过
    release();
    await rig.service.drain();
    expect(rig.calls).toHaveLength(1);
  });
});

/* ---------------- 全局串行（并发上限 1） ---------------- */

describe('全局串行队列', () => {
  it('两会话并发触发：通道在飞峰值恒 1（complete 不自竞争）', async () => {
    const rig = makeRig(['A 摘要', 'B 摘要']);
    const logA = sixTurnLog('s-a');
    const logB = sixTurnLog('s-b');
    rig.service.handleRunSettled({ log: logA, usage: FIRE_USAGE });
    rig.service.handleRunSettled({ log: logB, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(2);
    expect(rig.maxInFlight()).toBe(1);
    // 两会话各自完成压缩（分账互不串扰）
    expect(logA.eventsOfType('compaction/end')).toHaveLength(1);
    expect(logB.eventsOfType('compaction/end')).toHaveLength(1);
  });
});

/* ---------------- 迭代链（服务面端到端） ---------------- */

describe('迭代链', () => {
  it('二次压缩提示词并入前次摘要正文（前次载体已被遮蔽仍可提取）', async () => {
    const rig = makeRig(['第一份摘要正文']);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls[0]!.prompt).not.toContain('第一份摘要正文'); // 首压无前次

    for (let i = 7; i <= 9; i++) {
      log.append('turn/start', {});
      log.append('user/message', { content: `续 ${i}`, source: 'user' });
      log.append('assistant/message', { content: [{ type: 'text', text: `答 ${i}` }] });
      log.append('turn/end', { reason: 'completed' });
    }
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls[1]!.prompt).toContain('第一份摘要正文'); // 前次摘要并入（读事件本体非投影）
    // 前次摘要载体事件此时已被二次遮蔽（其 seq 落在新区间内）
    const summarySeq = log.eventsOfType('compaction/surface')[0]!.data as unknown as { summarySeq: number };
    const second = log.eventsOfType('compaction/surface')[1]!.surfaceOp!;
    expect(second.start).toBeLessThanOrEqual(summarySeq.summarySeq);
    expect(summarySeq.summarySeq).toBeLessThanOrEqual(second.end);
  });
});

/* ---------------- 溢出应急面（05 §2.3 三值 + 共享互斥） ---------------- */

describe('compactForOverflow', () => {
  it('成功：compacted + 四事件（overflow 路 willRetry=false、无 basis）', async () => {
    const rig = makeRig(['溢出摘要']);
    const log = sixTurnLog();
    const outcome = await rig.service.compactForOverflow(log);
    expect(outcome).toBe('compacted');
    const start = log.eventsOfType('compaction/start')[0]!;
    expect(start.data).toMatchObject({ reason: 'overflow', willRetry: false });
    expect((start.data as Record<string, unknown>)['basis']).toBeUndefined(); // 溢出路无判阈过程
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' });
  });

  it('区间不足：nothing（小日志压无可压——应急档不豁免最小条数保护）', async () => {
    const rig = makeRig();
    const log = new SessionLog({ sessionId: 's-small' });
    log.append('turn/start', {});
    log.append('user/message', { content: '只有一轮', source: 'user' });
    log.append('turn/end', { reason: 'completed' });
    expect(await rig.service.compactForOverflow(log)).toBe('nothing');
    expect(rig.calls).toHaveLength(0);
  });

  it('通道失败：failed（end-failed 闭段已在五步内落账）', async () => {
    const rig = makeRig([new Error('通道断电')]);
    const log = sixTurnLog();
    expect(await rig.service.compactForOverflow(log)).toBe('failed');
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'failed' });
  });

  it('排队期间他路已缩量：归因不问路直接 compacted，不重复摘要', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const rig = makeRig([barrier]);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE }); // T1 排队执行中（阻塞在屏障）
    const overflow = rig.service.compactForOverflow(log); // T2 排 T1 后（共享串行）
    release();
    const outcome = await overflow;
    expect(outcome).toBe('compacted'); // T1 已压——缩量达成
    expect(rig.calls).toHaveLength(1); // 不重复摘要
    expect(log.eventsOfType('compaction/end')).toHaveLength(1); // 恰一次压缩
  });

  it('通道缺席：failed（门三道之三——无摘要则无压缩，直接终态）', async () => {
    const warns: string[] = [];
    const service = createCompactionService({ warn: (m) => warns.push(m) });
    expect(await service.compactForOverflow(sixTurnLog())).toBe('failed');
  });
});

/* ---------------- 通道缺席（阈值路停用） ---------------- */

describe('通道缺席', () => {
  it('handleRunSettled no-op 且只告警一次（缺配是装配错误不是运行抖动；obs-b 后 fire 首触落一条 skip）', async () => {
    const warns: string[] = [];
    const service = createCompactionService({ warn: (m) => warns.push(m) });
    const log = sixTurnLog();
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('COMPACTION_NO_CHANNEL');
    // obs-b：通道压缩零执行（无 start/end）——仅首触一条 no-channel skip
    expect(log.events()).toHaveLength(25);
    expect(log.eventsOfType('compaction/skip')).toHaveLength(1);
    expect(log.eventsOfType('compaction/skip')[0]!.data).toMatchObject({ gate: 'no-channel' });
  });
});

/* ---------------- 空闲逐出帽（256——防长开进程无界累积） ---------------- */

describe('空闲逐出帽', () => {
  it('超帽后空闲态被逐出：被逐会话的冷却锚随态丢失（重触发即重压——帽执法可观测）', async () => {
    const rig = makeRig(['第一次', '第二次'], { config: { cooldownMs: 600_000 } });
    const logA = sixTurnLog('s-anchor');
    rig.service.handleRunSettled({ log: logA, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(1);

    // 灌满帽：260 个哑会话各触发一次（空日志 → 判阈过、规划 null——只建分账态）
    for (let i = 0; i < 260; i++) {
      const dummy = new SessionLog({ sessionId: `s-dummy-${i}` });
      rig.service.handleRunSettled({ log: dummy, usage: FIRE_USAGE });
    }
    await rig.service.drain();
    // logA 的冷却锚随空闲态被逐出 → 假钟未拨也重压（冷却失效 = 逐出的行为证据）
    rig.service.handleRunSettled({ log: logA, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(2);
  });
});

/* ---------------- drain 快照语义 ---------------- */

describe('drain', () => {
  it('排空此刻在飞/排队的一切（handleRunSettled 后事件可见）', async () => {
    const rig = makeRig(['x']);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    expect(log.eventsOfType('compaction/end')).toHaveLength(0); // fire-and-forget——此刻未必完成
    await rig.service.drain();
    expect(log.eventsOfType('compaction/end')).toHaveLength(1);
  });
});

/* ---------------- U4 接管缝（session_before_compact 位制四途） ---------------- */

describe('U4 接管缝', () => {
  /** 放行形 seam（不改值不置位——值原样透传） */
  const passthrough = async (input: Parameters<NonNullable<CompactionServiceOptions['onBeforeCompact']>>[0]) => ({
    value: input,
  });

  it('放行：宿主路照常，start.summarizer 归因 host', async () => {
    const rig = makeRig(['宿主摘要'], { onBeforeCompact: passthrough });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'host' });
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' });
    expect(rig.calls).toHaveLength(1); // 宿主通道被调
  });

  it('调整途（合法缩区间）：生效区间 = 调整案，素材三件宿主重算', async () => {
    const rig = makeRig(['调整后摘要'], {
      onBeforeCompact: async (input) => ({
        // 宿主原案 [4,12]（sixTurnLog 常规夹具）——缩到 [8,12]（子区间合法）
        value: { ...input, plan: { ...input.plan, start: 8 } },
        lastAdjustedBy: 'tuner',
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    const surface = log.eventsOfType('compaction/surface')[0]!;
    expect(surface.surfaceOp).toMatchObject({ start: 8, end: 12 });
    // 素材重算：区间 [8,12] 内消息 seq 10,11 → 2 条（不信载荷三件）
    expect(surface.data).toMatchObject({ occludedMessages: 2 });
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed', occludedMessages: 2 });
  });

  it('调整途（非法越界）：fallback 记账 stage=rejected + 归因最后调整者，宿主原案续跑', async () => {
    const rig = makeRig(['原案摘要'], {
      onBeforeCompact: async (input) => ({
        value: { ...input, plan: { ...input.plan, start: 1 } }, // 越界（< 宿主原案 start 4——扩进 head 任务锚）
        lastAdjustedBy: 'bad-tuner',
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    const fallback = log.eventsOfType('compaction/fallback')[0]!;
    expect(fallback.data).toMatchObject({ source: 'plugin:bad-tuner', stage: 'rejected' });
    // 宿主原案续跑
    expect(log.eventsOfType('compaction/surface')[0]!.surfaceOp).toMatchObject({ start: 4, end: 12 });
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' });
  });

  it('veto：落 start{willRetry:true} + end{vetoed} 对；无摘要无遮蔽；冷却锚不动（重触发再问）', async () => {
    const rig = makeRig([], {
      onBeforeCompact: async (input) => ({ value: { ...input, veto: { reason: '任务进行中不宜压' } } }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    const starts = log.eventsOfType('compaction/start');
    const ends = log.eventsOfType('compaction/end');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]!.data).toMatchObject({ reason: 'threshold', willRetry: true });
    expect((starts[0]!.data as Record<string, unknown>)['summarizer']).toBeUndefined(); // 无生效者不落归因位
    expect(ends[0]!.data).toMatchObject({ reason: 'vetoed' });
    expect(log.eventsOfType('user/message')).toHaveLength(6); // 无摘要落账
    expect(log.eventsOfType('compaction/surface')).toHaveLength(0); // 无遮蔽
    expect(rig.calls).toHaveLength(0); // 通道零调用
    // 冷却锚未推进：再触发即再问（第二次 veto 再落一对）
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/end')).toHaveLength(2);
    expect(log.eventsOfType('compaction/end')[1]!.data).toMatchObject({ reason: 'vetoed' });
  });

  it('位间裁决：veto + takeover 同置 → veto 先检胜出（算法零调用）', async () => {
    const takeoverCalls: number[] = [];
    const rig = makeRig([], {
      onBeforeCompact: async (input) => ({
        value: {
          ...input,
          veto: { reason: '否决优先' },
          takeover: {
            summarize: async () => {
              takeoverCalls.push(1);
              return { text: '不应执行' };
            },
          },
        },
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'vetoed' });
    expect(takeoverCalls).toHaveLength(0);
    expect(rig.calls).toHaveLength(0);
  });

  it('takeover 成功：start.summarizer 归因 plugin:<id>；宿主通道零调用；输入五件齐（plan=宿主原案）', async () => {
    const inputs: unknown[] = [];
    const rig = makeRig(['不应被调'], {
      onBeforeCompact: async (input) => ({
        value: {
          ...input,
          takeover: {
            pluginId: 'smart-summarizer',
            summarize: async (fnInput) => {
              inputs.push(fnInput);
              return { text: '插件产出的摘要' };
            },
          },
        },
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(0); // 通道零调用
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'plugin:smart-summarizer' });
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' });
    const received = inputs[0] as {
      sessionId: string;
      occluded: unknown[];
      previousSummary: unknown;
      maxChars: number;
      plan: { start: number; end: number };
    };
    expect(received.sessionId).toBe('s-1');
    expect(received.occluded).toHaveLength(4); // 与 plan.occluded 同源（宿主原案 [4,12] 内 4 条）
    expect(received.previousSummary).toBeUndefined(); // 首压无前次
    expect(received.maxChars).toBeGreaterThan(0); // 宿主 policy 单源同口径
    expect(received.plan).toMatchObject({ start: 4, end: 12 });
    // 摘要载体 = 插件产物
    expect(log.eventsOfType('user/message').at(-1)!.data).toMatchObject({ source: 'compaction' });
  });

  it('takeover 输入 = 管线终值 plan（先行监听者的有效调整随值链传入）', async () => {
    const received: number[] = [];
    const rig = makeRig([], {
      onBeforeCompact: async (input) => ({
        value: {
          ...input,
          plan: { ...input.plan, start: 8 }, // 先调整
          takeover: {
            pluginId: 'taker',
            summarize: async (fnInput) => {
              received.push(fnInput.plan.start, fnInput.plan.end);
              return { text: '接管摘要' };
            },
          },
        },
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(received).toEqual([8, 12]); // 接管输入携带调整后区间
  });
});

/* ---------------- U4 回落三律 + 三振熔断 ---------------- */

describe('U4 回落三律 + 三振熔断', () => {
  /** 接管失败 seam 工厂：takeover fn 行为可编程 */
  function takeoverRig(
    fn: () => Promise<{ text: string }>,
    scripts: (string | Error | Promise<void>)[] = ['回落摘要'],
  ) {
    let dispatchCount = 0;
    const rig = makeRig(scripts, {
      onBeforeCompact: async (input) => {
        dispatchCount += 1;
        return {
          value: {
            ...input,
            takeover: { pluginId: 'flaky', summarize: fn },
          },
        };
      },
    });
    return { rig, dispatches: () => dispatchCount };
  }

  it('回落律 1（抛错）：fallback{stage=throw} + 当轮回落宿主完成 + start 归因 host', async () => {
    const { rig } = takeoverRig(async () => {
      throw new Error('插件算法崩溃');
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/fallback')[0]!.data).toMatchObject({
      source: 'plugin:flaky',
      stage: 'throw',
    });
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'host' }); // 回落后记 host
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' }); // 回落不失败
    expect(rig.calls).toHaveLength(1); // 直达宿主（不串联）
  });

  it('回落律 1（超预算）：fallback{stage=timeout} + 回落（60s 预算参数化注入短值）', async () => {
    const calls: { prompt: string; maxChars: number }[] = [];
    const channel: SummaryChannel = {
      complete: async (req) => {
        calls.push({ ...req });
        return { text: '超时回落摘要' };
      },
    };
    const service = createCompactionService({
      channel,
      now: () => 1_000,
      config: { cooldownMs: 0 },
      algoTimeoutMs: 20,
      onBeforeCompact: async (input) => ({
        value: { ...input, takeover: { pluginId: 'slow', summarize: () => new Promise(() => {}) } }, // 永不 settle 的算法
      }),
    });
    const log = sixTurnLog();
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    expect(log.eventsOfType('compaction/fallback')[0]!.data).toMatchObject({ source: 'plugin:slow', stage: 'timeout' });
    expect(calls).toHaveLength(1);
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' });
    // 原 takeover promise 永挂——产物弃用不采信（回落摘要已生效）
    expect(log.eventsOfType('user/message').at(-1)!.data).toMatchObject({ source: 'compaction' });
  });

  it('回落律 1（空文本产物）：fallback{stage=rejected}（同宿主通道失败律）+ 回落', async () => {
    const { rig } = takeoverRig(async () => ({ text: '   ' }), ['空文本回落摘要']);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/fallback')[0]!.data).toMatchObject({
      source: 'plugin:flaky',
      stage: 'rejected',
    });
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'completed' });
  });

  it('回落失败（插件败 + 宿主通道也败）：fallback 记插件败 + end failed（终局恒宿主通道失败）', async () => {
    const { rig } = takeoverRig(async () => {
      throw new Error('插件先败');
    }, [new Error('宿主通道也败')]);
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/fallback')[0]!.data).toMatchObject({ stage: 'throw' });
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'host' });
    expect(log.eventsOfType('compaction/end')[0]!.data).toMatchObject({ reason: 'failed' });
    expect(rig.warns.join('\n')).toContain('COMPACTION_FAILED');
  });

  it('三振：同 pluginId 连续 3 次失败——第 3 次 fallback 记 circuit:true；此后 takeover 位被忽略（不再记 fallback、走宿主）', async () => {
    const { rig, dispatches } = takeoverRig(async () => {
      throw new Error('恒败');
    }, ['回落1', '回落2', '回落3', '回落4']);
    // 三振表是服务实例级（跨会话合并计数）——四会话各触发一次
    const all: SessionLog[] = [];
    for (let i = 0; i < 4; i++) {
      const log = sixTurnLog(`s-strike-${i}`);
      all.push(log);
      rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
      await rig.service.drain();
    }
    const fbEvents = all.flatMap((log) => log.eventsOfType('compaction/fallback'));
    expect(fbEvents).toHaveLength(3); // 第 4 轮熔断忽略——不再记
    expect(fbEvents[2]!.data).toMatchObject({ circuit: true }); // 末次记三振停用标记
    expect((fbEvents[0]!.data as Record<string, unknown>)['circuit']).toBeUndefined();
    // 第 4 轮：takeover 被忽略 → 宿主直跑 + 可观测 warn；钩子本身不停派（熔断的是算法接管资格）
    expect(all[3]!.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'host' });
    expect(rig.warns.join('\n')).toContain('COMPACTION_CIRCUIT_IGNORE');
    expect(dispatches()).toBe(4);
  });

  it('三振复位：失败 2 次后成功 1 次 → 计数清零，再失败不熔断（第 4 轮仍执行 takeover）', async () => {
    const behavior: Array<() => Promise<{ text: string }>> = [
      async () => {
        throw new Error('败1');
      },
      async () => {
        throw new Error('败2');
      },
      async () => ({ text: '成功复位' }),
      async () => {
        throw new Error('败3-重计第1次');
      },
    ];
    let idx = 0;
    const { rig } = takeoverRig(() => behavior[Math.min(idx++, behavior.length - 1)]!(), ['回落1', '回落2', '回落3']);
    const all: SessionLog[] = [];
    for (let i = 0; i < 4; i++) {
      const log = sixTurnLog(`s-reset-${i}`);
      all.push(log);
      rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
      await rig.service.drain();
    }
    // 第 3 轮成功（插件直成——通道零消费那轮）+ 第 4 轮仍执行 takeover（未熔断）
    const fbEvents = all.flatMap((log) => log.eventsOfType('compaction/fallback'));
    expect(fbEvents).toHaveLength(3); // 败1/败2/败3 各一条——无 circuit
    for (const fb of fbEvents) {
      expect((fb.data as Record<string, unknown>)['circuit']).toBeUndefined(); // 复位后重计——三振未达
    }
    expect(all[2]!.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'plugin:flaky' });
    expect(all[3]!.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'host' }); // 败3 回落
    expect(all[3]!.eventsOfType('compaction/fallback')).toHaveLength(1); // 第 4 轮 takeover 仍被执行（非熔断忽略）
  });
});

/* ---------------- U4 provider 槽 + 配置槽 ---------------- */

describe('U4 provider 槽 + 配置槽', () => {
  it('provider 常设注册：阈值路算法换装（start 归因 plugin:<id>、通道零调用）；溢出 路不受槽（恒宿主）', async () => {
    const providerCalls: number[] = [];
    const rig = makeRig(['溢出路摘要'], {
      getProvider: () => ({
        pluginId: 'pro',
        fn: async () => {
          providerCalls.push(1);
          return { text: 'provider 摘要' };
        },
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(providerCalls).toHaveLength(1);
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'plugin:pro' });
    expect(rig.calls).toHaveLength(0); // 阈值路未走宿主通道
    // 溢出 路：槽不可及（恒宿主缺省算法）
    const overflowLog = sixTurnLog('s-of');
    const outcome = await rig.service.compactForOverflow(overflowLog);
    expect(outcome).toBe('compacted');
    expect(providerCalls).toHaveLength(1); // provider 未再被调
    expect(overflowLog.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'host' });
    expect(rig.calls).toHaveLength(1); // 宿主通道被调
  });

  it('生效序：takeover（逐次声明）> provider 槽（常设注册）> 宿主通道', async () => {
    const providerCalls: number[] = [];
    const rig = makeRig(['不应被调'], {
      getProvider: () => ({
        pluginId: 'pro',
        fn: async () => {
          providerCalls.push(1);
          return { text: 'provider 摘要' };
        },
      }),
      onBeforeCompact: async (input) => ({
        value: { ...input, takeover: { pluginId: 'taker', summarize: async () => ({ text: '接管摘要' }) } },
      }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'plugin:taker' });
    expect(providerCalls).toHaveLength(0); // takeover 在场 provider 不被问
    expect(rig.calls).toHaveLength(0);
  });

  it('熔断重选（降层重选义——不连坐）：takeover 者熔断后 provider 槽顶上', async () => {
    // 先让 taker 三振（三会话——恒败 + 恒置 takeover 位）
    const providerCalls: number[] = [];
    const rig = makeRig(['回落1', '回落2', '回落3'], {
      getProvider: () => ({
        pluginId: 'pro',
        fn: async () => {
          providerCalls.push(1);
          return { text: 'provider 顶上摘要' };
        },
      }),
      onBeforeCompact: async (input) => ({
        value: {
          ...input,
          takeover: {
            pluginId: 'taker',
            summarize: async () => {
              throw new Error('恒败');
            },
          },
        },
      }),
    });
    const trippedLogs: SessionLog[] = [];
    for (let i = 0; i < 3; i++) {
      const log = sixTurnLog(`s-trip-${i}`);
      trippedLogs.push(log);
      rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
      await rig.service.drain();
    }
    // 第 4 轮：taker 已熔断——takeover 忽略（warn）+ provider 顶上（A 熔断不连坐 B）
    const log4 = sixTurnLog('s-trip-4');
    rig.service.handleRunSettled({ log: log4, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log4.eventsOfType('compaction/start')[0]!.data).toMatchObject({ summarizer: 'plugin:pro' });
    expect(providerCalls).toHaveLength(1);
    expect(rig.warns.join('\n')).toContain('COMPACTION_CIRCUIT_IGNORE');
    expect(log4.eventsOfType('compaction/fallback')).toHaveLength(0); // 熔断忽略非失败回落——不记
  });

  it('配置槽晚绑定：getConfig 现取生效（判阈用当下值）', async () => {
    let ratio = 0.99; // 起初不触发（100k/200k = 0.5 < 0.99）
    const rig = makeRig(['晚绑定摘要'], {
      getConfig: () => ({ ...DEFAULT_COMPACTION_CONFIG, cooldownMs: 0, thresholdRatio: ratio }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.events()).toHaveLength(24); // 未触发——零事件
    ratio = 0.1; // mount 后覆盖 settle——同会话下次判阈用新值
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/end')).toHaveLength(1); // 触发并完成
    expect(log.eventsOfType('compaction/start')[0]!.data).toMatchObject({ basis: 'usage' });
  });
});

/* ---------------- obs-b 压缩判据观测（compaction/skip 五门——05 §1.1/§2.1） ---------------- */

describe('obs-b 压缩判据观测（compaction/skip 五门）', () => {
  /** skip 事件速记（修前该词不存在——eventsOfType 恒空，红例由此成立） */
  const skipsOf = (log: SessionLog) => log.eventsOfType('compaction/skip');

  it('below 不落：未达阈值零 skip（判据素材可后算——不为 below 防 durable 膨胀落账）', async () => {
    const rig = makeRig();
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: { input: 1_000, contextWindow: 200_000 } });
    await rig.service.drain();
    expect(skipsOf(log)).toHaveLength(0);
  });

  it('判序锁：below 时通道缺席也不落不警（阈值评估先行——fire 而被门挡才落）', async () => {
    const warns: string[] = [];
    const service = createCompactionService({ warn: (m) => warns.push(m) });
    const log = sixTurnLog();
    service.handleRunSettled({ log, usage: { input: 1_000, contextWindow: 200_000 } });
    await service.drain();
    expect(skipsOf(log)).toHaveLength(0);
    expect(warns).toHaveLength(0); // 修前：通道检查先于判阈——below 也 warn（红）
  });

  it('pending 门：进行中/已排队期重复 fire 落 skip（gate=pending）+ basis 快照五件', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const rig = makeRig([barrier, '后续真摘要']);
    const log = sixTurnLog();
    const usage = { ...FIRE_USAGE, cacheRead: 7_000 };
    rig.service.handleRunSettled({ log, usage }); // 排队 → 执行 → 阻在屏障
    rig.service.handleRunSettled({ log, usage }); // pending → skip（同步段落账）
    release();
    await rig.service.drain();
    const skips = skipsOf(log);
    expect(skips).toHaveLength(1);
    expect(skips[0]!.data).toMatchObject({
      gate: 'pending',
      basis: 'usage',
      estTokens: 100_000,
      effectiveWindow: 200_000,
      cacheRead: 7_000, // fire 判据快照随真值笔透传（与 start 同律）
    });
    expect(log.eventsOfType('compaction/end')).toHaveLength(1); // 首触发真收场
  });

  it('cooldown 门：冷却窗内 fire 落 skip（gate=cooldown + remainMs 窗余 + basis）；窗过放行', async () => {
    const rig = makeRig(['首压', '窗后重压'], { config: { cooldownMs: 600_000 } });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE }); // 真压一次（冷却锚 = now）
    await rig.service.drain();
    // 追加新轮（冷却挡重触发与内容无关——保持会话有新素材的真实形）
    for (let i = 7; i <= 9; i++) {
      log.append('turn/start', {});
      log.append('user/message', { content: `续 ${i}`, source: 'user' });
      log.append('assistant/message', { content: [{ type: 'text', text: `答 ${i}` }] });
      log.append('turn/end', { reason: 'completed' });
    }
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE }); // 窗内 → skip
    await rig.service.drain();
    const skips = skipsOf(log);
    expect(skips).toHaveLength(1);
    expect(skips[0]!.data).toMatchObject({ gate: 'cooldown', basis: 'usage' });
    const remain = (skips[0]!.data as { remainMs: number }).remainMs;
    expect(remain).toBeGreaterThan(0);
    expect(remain).toBeLessThanOrEqual(600_000);
    expect(rig.calls).toHaveLength(1); // 通道不被再调
    rig.advance(600_000); // 拨过冷却窗 → 放行真压
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(rig.calls).toHaveLength(2);
    expect(skipsOf(log)).toHaveLength(1); // 放行不新增 skip
  });

  it('no-channel 门：通道缺席且 fire 首触落一条 skip（后续静默）——与 warn-once 同锚', async () => {
    const warns: string[] = [];
    const service = createCompactionService({ warn: (m) => warns.push(m) });
    const log = sixTurnLog();
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    const skips = skipsOf(log);
    expect(skips).toHaveLength(1); // 首触落一条、次触静默（装配级永久门不刷屏）
    expect(skips[0]!.data).toMatchObject({ gate: 'no-channel', basis: 'usage' });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('COMPACTION_NO_CHANNEL');
  });

  it('no-segment 门：fire 但区间规划无合法段落 skip（gate=no-segment）——不动冷却锚、通道零调用', async () => {
    const rig = makeRig(['不应消费']);
    const log = new SessionLog({ sessionId: 's-thin' });
    log.append('turn/start', {});
    log.append('user/message', { content: '单轮薄会话', source: 'user' });
    log.append('assistant/message', { content: [{ type: 'text', text: '薄答' }] });
    log.append('turn/end', { reason: 'completed' });
    // usage 主判 fire（100k/200k）；投影仅 2 条——head 首 turn + tail 6 全兜 → 可遮区间空
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    const skips = skipsOf(log);
    expect(skips).toHaveLength(1);
    expect(skips[0]!.data).toMatchObject({ gate: 'no-segment', basis: 'usage' });
    expect(rig.calls).toHaveLength(0);
    expect(log.eventsOfType('compaction/start')).toHaveLength(0);
  });

  it('retracted 门：排队锁内复评已不 fire 落 skip（gate=retracted——幻影触发可查）；不动冷却锚', async () => {
    let ratio = 0.4; // 入队时 fire（0.5 ≥ 0.4）
    const rig = makeRig(['不应消费'], {
      getConfig: () => ({ ...DEFAULT_COMPACTION_CONFIG, cooldownMs: 0, thresholdRatio: ratio }),
    });
    const log = sixTurnLog();
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    ratio = 0.99; // 排队期间阈值翻高——锁内复评（0.5 < 0.99）已不 fire
    await rig.service.drain();
    const skips = skipsOf(log);
    expect(skips).toHaveLength(1);
    expect(skips[0]!.data).toMatchObject({ gate: 'retracted', basis: 'usage', estTokens: 100_000 });
    expect(rig.calls).toHaveLength(0);
    expect(log.eventsOfType('compaction/start')).toHaveLength(0);
    // 不动冷却锚：阈值复原后同会话立即可再触发（retracted 非完成）
    ratio = 0.4;
    rig.service.handleRunSettled({ log, usage: FIRE_USAGE });
    await rig.service.drain();
    expect(log.eventsOfType('compaction/end')).toHaveLength(1); // 复原即真压
  });
});
