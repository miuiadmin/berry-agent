/**
 * SessionLog 活态测试（05 篇 §1-§3——append 七步流水线 / 遮蔽正门执法 / 读原语）。
 *
 * 核心不变式对账：增量投影（SessionLog 内 FoldState 活态推进 + applyOcclusion
 * 回溯摘除）与全量重算（deriveMessages 纯函数）对同一日志必产出同一投影——
 * 两路共用 stepFold 是「投影的缓存而非第二事实源」的结构保证。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, isKnownErrorCode, registerEventType } from '../contracts/index.js';
import './codes.js';
import { deriveMessages } from './derive.js';
import { recoverClosers } from './recover.js';
import { SessionLog, type SessionLogOptions } from './session.js';

// 测试用遮蔽载体类型（插件扩展正门注册——遮蔽指令的事件类型由写者自选，
// validateSurfaceOp 不检查载体身份，检查的是指令语义本身）
registerEventType({
  type: 'test/occlusion',
  category: 'surface',
  owner: 'session.test',
  description: '测试用遮蔽指令载体',
});

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

/** 造日志：假钟 + warn/onAppend 收集器注入 */
interface Harness {
  log: SessionLog;
  warns: string[];
  appended: unknown[];
  clockValue: { now: number };
}
function makeLog(options?: Partial<SessionLogOptions>): Harness {
  const warns: string[] = [];
  const appended: unknown[] = [];
  const clockValue = { now: 1_000 };
  const log = new SessionLog({
    sessionId: 's-test',
    clock: () => clockValue.now,
    warn: (m) => warns.push(m),
    onAppend: (e) => appended.push(e),
    ...options,
  });
  return { log, warns, appended, clockValue };
}

/** 向日志追加一轮完整对话（返回末 seq） */
function appendDialogue(log: SessionLog): void {
  log.append('turn/start', {});
  log.append('user/message', { content: '你好' });
  log.append('assistant/message', { content: [{ type: 'text', text: '好的' }], stopReason: 'toolUse' });
  log.append('tool/call', { toolCallId: 'c1', name: 'read', arguments: '{"path":"x"}' });
  log.append('tool/result', { toolCallId: 'c1', content: '文件内容' });
  log.append('assistant/message', { content: [{ type: 'text', text: '结论' }], stopReason: 'end' });
  log.append('turn/end', { reason: 'completed' });
}

describe('session 域错误码注册', () => {
  it('五枚域码全部注册在 contracts 注册表', () => {
    for (const code of [
      'SESSION_EVENT_DATA_INVALID',
      'SESSION_SURFACE_OP_INVALID',
      'SESSION_IMPORT_BAD_FORMAT',
      'SESSION_SPAWN_RATE_LIMIT',
      'SESSION_PERSISTENCE_REQUIRED',
    ]) {
      expect(isKnownErrorCode(code)).toBe(true);
    }
  });
});

describe('append 七步流水线', () => {
  it('① 词汇检查：未注册类型 fail-loud', () => {
    const { log } = makeLog();
    expectCode(() => log.append('never/registered', {}), 'SESSION_UNKNOWN_EVENT_TYPE');
    expect(log.events().length).toBe(0); // 拒绝不留半笔
  });

  it('③ data 单遍校验：undefined/NaN/类实例 fail-loud', () => {
    const { log } = makeLog();
    expectCode(() => log.append('user/message', { content: undefined }), 'SESSION_EVENT_DATA_INVALID');
    expectCode(() => log.append('sandbox/mode', { v: Number.NaN }), 'SESSION_EVENT_DATA_INVALID');
    expectCode(() => log.append('sandbox/mode', { at: new Date(0) }), 'SESSION_EVENT_DATA_INVALID');
  });

  it('② 信封注入：seq 连续 0 起 / time 来自 clock / ignorable 传递', () => {
    // ignorable 是读侧向前兼容位（写入方须注册词汇——严进；读侧宽容在导入闸）
    registerEventType({
      type: 'test/ignorable-word',
      category: 'log-only',
      owner: 'session.test',
      description: 'ignorable 信封测试',
    });
    const { log, clockValue } = makeLog();
    clockValue.now = 111;
    const e0 = log.append('turn/start', {});
    clockValue.now = 222;
    const e1 = log.append('test/ignorable-word', { x: 1 }, { ignorable: true });
    expect(e0.seq).toBe(0);
    expect(e0.time).toBe(111);
    expect(e1.seq).toBe(1);
    expect(e1.time).toBe(222);
    expect(e1.ignorable).toBe(true);
    expect(e0.ignorable).toBeUndefined();
  });

  it('③-b 冻结终态：写入后任何持有者改不动（嵌套同冻）', () => {
    const { log } = makeLog();
    const event = log.append('user/message', { content: 'x', nested: { list: [1] } });
    expect(Object.isFrozen(event.data)).toBe(true);
    expect(() => {
      (event.data as Record<string, unknown>).y = 1;
    }).toThrow(TypeError);
    const nested = (event.data as { nested: { list: number[] } }).nested;
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.list)).toBe(true);
  });

  it('④ 预算刀：超帽截断降级 + warn 落账带码名义（裁腿不抛）', () => {
    const { log, warns } = makeLog();
    const event = log.append('tool/result', {
      toolCallId: 'c1',
      content: 'r'.repeat(61 * 1024),
    });
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain('[SESSION_EVENT_OVER_BUDGET]');
    // 事件照常入日志（可观测降级优于静默丢弃）
    expect(log.events().length).toBe(1);
    const content = (event.data as { content: string }).content;
    expect(content).toContain('[truncated ');
    expect(content.length).toBeLessThan(61 * 1024);
  });

  it('⑥/⑦ 尾部追加 + 入队回调：onAppend 收到同引用事件（物理层接线面）', () => {
    const { log, appended } = makeLog();
    const event = log.append('turn/start', {});
    expect(appended.length).toBe(1);
    expect(appended[0]).toBe(event);
  });

  it('sourceEventSeqs 拷贝快照（传后改原数组不影响信封）', () => {
    const { log } = makeLog();
    const seqs = [1, 2];
    appendDialogue(log);
    const event = log.append('test/occlusion', {}, { sourceEventSeqs: seqs });
    seqs.push(99);
    expect(event.sourceEventSeqs).toEqual([1, 2]);
  });
});

describe('种子重放（fork/导入形态）', () => {
  it('合法种子：日志同建 + 投影就绪 + 新 append 恰落种子长度位', () => {
    const seed = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'user/message', seq: 1, time: 2, data: { content: 'hi' } },
      { type: 'session/end-seed', seq: 2, time: 3, data: {} },
    ];
    const { log } = makeLog({ seed });
    expect(log.events().length).toBe(3);
    expect(log.projection().length).toBe(1);
    const next = log.append('turn/start', {});
    expect(next.seq).toBe(3);
  });

  it('种子 seq 断号：构造即炸（裸拷贝不走正门）', () => {
    const seed = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'user/message', seq: 2, time: 2, data: { content: '跳' } },
    ];
    expectCode(() => makeLog({ seed }), 'SESSION_SURFACE_OP_INVALID');
  });
});

describe('appendSynthetic 恢复合成收形', () => {
  it('time 复用最后真实事件（确定性合成标记）+ 词汇/校验同权', () => {
    const { log, clockValue } = makeLog();
    clockValue.now = 500;
    appendDialogue(log);
    const truncated = log.events().slice(0, 4); // 去掉 tool/result 及其后——制造孤儿 call
    // 直接对截断视图跑 recover（纯函数面）再回灌
    const revived = new SessionLog({
      sessionId: 's-revive',
      seed: truncated,
      clock: () => 999_999, // 合成若误用 clock 即刻暴露
    });
    const drafts = recoverClosers(revived.events());
    // 孤儿 c1 → tool/result；turn/start@0 未闭合 → turn/end(interrupted)
    expect(drafts.map((d) => d.type)).toEqual(['tool/result', 'turn/end']);
    const appended = drafts.map((d) => revived.appendSynthetic(d));
    // 假钟恒 500：末条真实事件 time=500，合成物全部复用（误用 clock=999999 即刻暴露）
    expect(appended[0]!.time).toBe(500);
    expect(appended[1]!.time).toBe(500);
  });
});

describe('appendWithSurfaceOp 遮蔽正门', () => {
  it('正路径：区间闭合 turn 整轮遮蔽 + 投影摘除 + chars 回退', () => {
    const { log } = makeLog();
    appendDialogue(log); // seq0..6
    const before = log.projectedChars();
    log.append('turn/start', {}); // seq7 第二轮开
    log.append('user/message', { content: 'again' }); // seq8
    log.append('turn/end', { reason: 'completed' }); // seq9
    // 遮蔽第一轮 [0,5]（first=log[0]=turn/start 对齐）；指令落 seq10
    const instr = log.appendWithSurfaceOp(
      'test/occlusion',
      { note: 'compacted' },
      { op: 'replace', start: 0, end: 5 },
      [0, 1, 2, 3, 4, 5],
    );
    expect(instr.seq).toBe(10);
    expect(instr.surfaceOp).toEqual({ op: 'replace', start: 0, end: 5 });
    // 投影：第一轮消息（user/assistant/toolResult/assistant）全摘，只剩第二轮 user
    const messages = log.projection();
    expect(messages.length).toBe(1);
    expect(messages[0]!.type).toBe('user');
    expect(log.projectedChars()).toBeLessThan(before);
    // 增量 vs 全量对账（两路同源的结构证明）
    expect(log.projection()).toEqual(deriveMessages(log.events()));
  });

  it('红锁：区间非法（start>end / end 越界 / 负数）', () => {
    const { log } = makeLog();
    appendDialogue(log);
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 2, end: 1 }, [1]),
      'SESSION_SURFACE_OP_INVALID',
    );
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 99 }, []),
      'SESSION_SURFACE_OP_INVALID',
    );
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: -1, end: 0 }, []),
      'SESSION_SURFACE_OP_INVALID',
    );
    expect(log.events().length).toBe(7); // 拒绝不留半笔
  });

  it('红锁：溯源不完整（sourceEventSeqs 未覆盖区间全部）', () => {
    const { log } = makeLog();
    appendDialogue(log);
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 5 }, [0, 1, 2]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('红锁：溯源引用非法 seq（未来位）', () => {
    const { log } = makeLog();
    appendDialogue(log);
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 5 }, [0, 1, 2, 3, 4, 5, 99]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('红锁：不二次遮蔽（与既存遮蔽区间相交）', () => {
    const { log } = makeLog();
    appendDialogue(log);
    log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 2 }, [0, 1, 2]); // seq7
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 1, end: 4 }, [1, 2, 3, 4]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('红锁：不嵌套遮蔽（区间内事件自带 surfaceOp——遮蔽者不可被遮）', () => {
    const { log } = makeLog();
    appendDialogue(log);
    log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 2 }, [0, 1, 2]); // seq7 携带 surfaceOp
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 7, end: 7 }, [7]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('红锁：不遮进行中 turn（call 在区间内、配对 result 在区间外）', () => {
    const { log } = makeLog();
    appendDialogue(log); // call@3 result@4
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 3 }, [0, 1, 2, 3]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('红锁：反向切断（result 在区间内、call 在区间外）同样拒', () => {
    const { log } = makeLog();
    appendDialogue(log);
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 3, end: 6 }, [3, 4, 5, 6]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('红锁：区间起点未对齐 turn 边界（首条非 turn/start 且不紧接遮蔽终点）', () => {
    const { log } = makeLog();
    appendDialogue(log);
    expectCode(
      () => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 1, end: 2 }, [1, 2]),
      'SESSION_SURFACE_OP_INVALID',
    );
  });

  it('正路径：紧接上次遮蔽终点的切点合法（连续压缩形态）', () => {
    const { log } = makeLog();
    log.append('user/message', { content: 'a' }); // seq0
    log.append('assistant/message', { content: [{ type: 'text', text: 'r1' }] }); // seq1
    log.append('assistant/message', { content: [{ type: 'text', text: 'r2' }] }); // seq2（第二轮首条非 turn/start）
    // 指令落 seq3、遮 [0,1]（指令不必紧贴其区间——可晚落）
    log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 0, end: 1 }, [0, 1]);
    // 连续切点：新区间起点 2 恰为上次遮蔽终点 1 的后继——起点对齐规则放行
    expect(() => log.appendWithSurfaceOp('test/occlusion', {}, { op: 'replace', start: 2, end: 2 }, [2])).not.toThrow();
    expect(log.projection()).toEqual([]);
  });
});

describe('读原语', () => {
  it('lastClosedBoundary：空日志 -1 / 取最后一条 turn/end 真实 seq', () => {
    const { log } = makeLog();
    expect(log.lastClosedBoundary()).toBe(-1);
    appendDialogue(log); // turn/end@6
    log.append('turn/start', {}); // seq7（进行中）
    expect(log.lastClosedBoundary()).toBe(6);
  });

  it('eventsOfType 按类型过滤 + fromSeq 窗口', () => {
    const { log } = makeLog();
    appendDialogue(log);
    log.append('turn/start', {}); // seq7
    expect(log.eventsOfType('turn/start').map((e) => e.seq)).toEqual([0, 7]);
    expect(log.eventsOfType('turn/start', { fromSeq: 1 }).map((e) => e.seq)).toEqual([7]);
  });

  it('projection 折入活缓冲（未闭合 assistant 也可见）', () => {
    const { log } = makeLog();
    log.append('user/message', { content: 'q' });
    log.append('assistant/message', { content: [{ type: 'text', text: '部分响应' }] });
    const messages = log.projection();
    expect(messages.length).toBe(2);
    expect(messages[1]!.type).toBe('assistant');
    // 与全量重算对账（deriveMessages 尾部冲刷——两路同形）
    expect(messages).toEqual(deriveMessages(log.events()));
  });

  it('metaOf 透传词汇注册表（诊断面）', () => {
    const { log } = makeLog();
    expect(log.metaOf('user/message')?.category).toBe('surface');
    expect(log.metaOf('turn/start')?.category).toBe('structure');
    expect(log.metaOf('never/x')).toBeUndefined();
  });
});
