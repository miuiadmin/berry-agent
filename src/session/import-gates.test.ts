/**
 * 导入四闸单元测试（05 篇 §5.1——身份/词汇/配对/洪水）。
 *
 * 执法面红锁：自描述不认识拒整批、撕裂行拒载、未知词汇且非 ignorable 拒整批、
 * 多余闭合不可合成拒载、洪水闸滑动窗限速（假钟确定性）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { pairingGate, parseImportFile, runImportGates, SessionSpawnLimiter, vocabularyGate } from './import-gates.js';
import type { SessionEvent } from '../contracts/index.js';

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

/** 造合法事件行（seq 连续 + 核心词汇） */
function line(seq: number, type: string, data: unknown = {}): string {
  return JSON.stringify({ type, seq, time: 1000 + seq, data });
}

/** 合法导入文件样例：_meta 首行 + 一轮完整对话 */
function validFile(): string {
  return [
    JSON.stringify({ format: 'berry-agent/session', version: 1, exportedAt: 123 }),
    line(0, 'turn/start'),
    line(1, 'user/message', { content: 'hi' }),
    line(2, 'assistant/message', { content: [{ type: 'text', text: 'yo' }] }),
    line(3, 'turn/end', { reason: 'completed' }),
  ].join('\n');
}

describe('parseImportFile 身份闸 + 解析', () => {
  it('合法文件：meta + 事件体解析', () => {
    const parsed = parseImportFile(validFile());
    expect(parsed.meta.format).toBe('berry-agent/session');
    expect(parsed.meta.version).toBe(1);
    expect(parsed.events.length).toBe(4);
    expect(parsed.events[1]!.type).toBe('user/message');
  });

  it('空文件拒绝（缺 _meta 首行）', () => {
    expectCode(() => parseImportFile(''), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('不认识的自描述拒绝（format 未知 / version 超支持）', () => {
    const foreign = [JSON.stringify({ format: 'other-tool/session', version: 1 }), line(0, 'turn/start')].join('\n');
    expectCode(() => parseImportFile(foreign), 'SESSION_IMPORT_BAD_FORMAT');
    const future = [JSON.stringify({ format: 'berry-agent/session', version: 2 }), line(0, 'turn/start')].join('\n');
    expectCode(() => parseImportFile(future), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('_meta 首行非 JSON 拒绝', () => {
    expectCode(() => parseImportFile('not json\n' + line(0, 'turn/start')), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('撕裂行（中途非 JSON）拒绝——不可静默截半', () => {
    const torn = [JSON.stringify({ format: 'berry-agent/session', version: 1 }), line(0, 'turn/start'), '{oops'].join(
      '\n',
    );
    expectCode(() => parseImportFile(torn), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('行非 SessionEvent 信封（缺 type/seq）拒绝', () => {
    const bad = [JSON.stringify({ format: 'berry-agent/session', version: 1 }), JSON.stringify({ hello: 1 })].join(
      '\n',
    );
    expectCode(() => parseImportFile(bad), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('空行跳过（导出器尾换行不炸）', () => {
    const padded = validFile() + '\n\n';
    expect(parseImportFile(padded).events.length).toBe(4);
  });
});

describe('vocabularyGate 词汇闸', () => {
  it('未知类型且未标 ignorable：拒整批（宁拒勿吞）', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'future/word', seq: 1, time: 2, data: {} },
    ];
    expectCode(() => vocabularyGate(events), 'SESSION_UNKNOWN_EVENT_TYPE');
  });

  it('未知类型但 ignorable：放行（向前兼容）', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'future/word', seq: 1, time: 2, data: {}, ignorable: true },
    ];
    expect(() => vocabularyGate(events)).not.toThrow();
  });

  it('核心词汇全过', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'llm/usage', seq: 1, time: 2, data: { input: 1 } },
    ];
    expect(() => vocabularyGate(events)).not.toThrow();
  });
});

describe('pairingGate 配对闸', () => {
  it('合法对话（含孤儿 call——可合成）通过', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'tool/call', seq: 1, time: 2, data: { toolCallId: 'c1', name: 't', arguments: '' } },
      // 崩溃残留：无 result——recoverClosers 能合成，放行
    ];
    expect(() => pairingGate(events)).not.toThrow();
  });

  it('seq 断号拒绝', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'user/message', seq: 2, time: 2, data: { content: '跳' } },
    ];
    expectCode(() => pairingGate(events), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('turn/end 无对应 start 拒绝（多余闭合不可合成）', () => {
    const events: SessionEvent[] = [{ type: 'turn/end', seq: 0, time: 1, data: { reason: 'completed' } }];
    expectCode(() => pairingGate(events), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('tool/result 无前置 call 拒绝', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'tool/result', seq: 1, time: 2, data: { toolCallId: 'ghost', content: 'x' } },
    ];
    expectCode(() => pairingGate(events), 'SESSION_IMPORT_BAD_FORMAT');
  });
});

describe('SessionSpawnLimiter 洪水闸', () => {
  it('窗内超帽抛 SESSION_SPAWN_RATE_LIMIT（假钟确定性）', () => {
    let now = 0;
    const limiter = new SessionSpawnLimiter({ windowMs: 60_000, max: 3, clock: () => now });
    limiter.acquire();
    limiter.acquire();
    limiter.acquire();
    expectCode(() => limiter.acquire(), 'SESSION_SPAWN_RATE_LIMIT');
  });

  it('窗口滑出后名额恢复（滑动窗语义）', () => {
    let now = 0;
    const limiter = new SessionSpawnLimiter({ windowMs: 60_000, max: 2, clock: () => now });
    limiter.acquire(); // t=0
    now = 10_000;
    limiter.acquire(); // t=10s（窗满）
    expectCode(() => limiter.acquire(), 'SESSION_SPAWN_RATE_LIMIT');
    now = 60_001; // 首笔滑出窗（t=0 距今 ≥ 60s）
    limiter.acquire(); // 恢复
    expect(() => limiter.acquire()).toThrow(); // 又满（t=10s 与 t=60.001s 在窗）
  });

  it('窗口内恰好未超：不抛（边界 = 严格大于窗口时长才滑出）', () => {
    let now = 0;
    const limiter = new SessionSpawnLimiter({ windowMs: 1000, max: 1, clock: () => now });
    limiter.acquire();
    now = 1000; // 恰等窗口时长——严格 ≥ 判定滑出
    expect(() => limiter.acquire()).not.toThrow();
  });
});

describe('runImportGates 全闸组合', () => {
  it('合法文件过全闸（身份 → 词汇 → 配对）', () => {
    const parsed = runImportGates(validFile());
    expect(parsed.events.length).toBe(4);
  });

  it('身份闸先红（后面闸不跑）', () => {
    expectCode(() => runImportGates('garbage'), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('词汇闸红透传到组合面', () => {
    const evil = [
      JSON.stringify({ format: 'berry-agent/session', version: 1 }),
      line(0, 'turn/start'),
      line(1, 'virus/payload'),
    ].join('\n');
    expectCode(() => runImportGates(evil), 'SESSION_UNKNOWN_EVENT_TYPE');
  });
});
