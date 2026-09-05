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
import type { SummaryChannel } from './types.js';
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

    // start：判据快照三件 + willRetry（阈值路失败后下轮触发自然重做）
    expect(start!.data).toMatchObject({
      reason: 'threshold',
      willRetry: true,
      basis: 'usage',
      estTokens: 100_000,
      effectiveWindow: 200_000,
    });
    // 摘要：普通 append（无 surfaceOp——两事件形）、载体前缀、source 归因
    expect(summary!.data).toEqual({ content: `${SUMMARY_PREFIX} 压缩完成摘要`, source: 'compaction' });
    expect(summary!.surfaceOp).toBeUndefined();
    expect(summary!.seq).toBe((surface!.data as { summarySeq: number }).summarySeq);
    // surface：信封独携 + 溯源完整（区间全部 seq + 摘要 seq）
    expect(surface!.surfaceOp).toEqual({ op: 'replace', start: 4, end: 12 });
    const expectedSeqs = [...Array(12 - 4 + 1).keys()].map((i) => 4 + i).concat([summary!.seq]);
    expect(surface!.sourceEventSeqs).toEqual(expectedSeqs);
    expect(surface!.data).toMatchObject({ summarySeq: summary!.seq, occludedMessages: 4 });
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
  it('handleRunSettled no-op 且只告警一次（缺配是装配错误不是运行抖动）', async () => {
    const warns: string[] = [];
    const service = createCompactionService({ warn: (m) => warns.push(m) });
    const log = sixTurnLog();
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('COMPACTION_NO_CHANNEL');
    expect(log.events()).toHaveLength(24); // 零事件
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
