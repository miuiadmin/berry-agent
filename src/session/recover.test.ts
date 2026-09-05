/**
 * 崩溃恢复协议单元测试（05 篇 §4——recoverClosers 合成 closer）。
 *
 * 执法面红锁：孤儿 call 的 gate 证据二分（OUTCOME_UNKNOWN / NOT_STARTED）、
 * 未闭合压缩对按深度补 compaction/end、未闭合 turn 按深度补 N、合成序
 * result → compaction/end → turn/end、time 复用最后真实事件。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN, firstSeqBreak, recoverClosers } from './recover.js';

/** 造事件 helper */
function evt(seq: number, type: string, data: unknown = {}): SessionEvent {
  return { type, seq, time: 1000 + seq, data };
}

describe('recoverClosers 配对扫描 + 合成', () => {
  it('完整闭合的日志：零合成', () => {
    const events = [
      evt(0, 'turn/start'),
      evt(1, 'user/message', { content: 'hi' }),
      evt(2, 'turn/end', { reason: 'completed' }),
    ];
    expect(recoverClosers(events)).toEqual([]);
  });

  it('孤儿 tool/call 二分：gate/decision 在场 = OUTCOME_UNKNOWN（已开始执行）', () => {
    const events = [
      evt(0, 'turn/start'),
      evt(1, 'tool/call', { toolCallId: 'c1', name: 't', arguments: '' }),
      evt(2, 'gate/decision', { toolCallId: 'c1', decision: 'allow' }),
      // 崩溃：无 result、无 turn/end
    ];
    const drafts = recoverClosers(events);
    expect(drafts.length).toBe(2);
    const [result, turnEnd] = drafts;
    expect(result!.type).toBe('tool/result');
    expect((result!.data as { toolCallId: string }).toolCallId).toBe('c1');
    expect((result!.data as { content: string }).content).toContain(TOOL_OUTCOME_UNKNOWN);
    expect((result!.data as { error: boolean }).error).toBe(true);
    expect(turnEnd!.type).toBe('turn/end');
    expect((turnEnd!.data as { reason: string }).reason).toBe('interrupted');
  });

  it('孤儿 tool/call 二分：gate 缺席 = NOT_STARTED（未开始执行）', () => {
    const events = [evt(0, 'turn/start'), evt(1, 'tool/call', { toolCallId: 'c2', name: 't', arguments: '' })];
    const drafts = recoverClosers(events);
    expect((drafts[0]!.data as { content: string }).content).toContain(TOOL_NOT_STARTED);
  });

  it('gate/decision 晚于 call 也能索引到（决策可能最后一刻才落——全日志扫描是保守完备面）', () => {
    // 调换序：decision 在 call 前（守门先于执行）与在后（同类）都应索引
    const events = [
      evt(0, 'gate/decision', { toolCallId: 'c3', decision: 'allow' }),
      evt(1, 'tool/call', { toolCallId: 'c3', name: 't', arguments: '' }),
    ];
    expect((recoverClosers(events)[0]!.data as { content: string }).content).toContain(TOOL_OUTCOME_UNKNOWN);
  });

  it('未闭合压缩对：按深度补 compaction/end（reason=aborted）', () => {
    const events = [
      evt(0, 'compaction/start'),
      evt(1, 'compaction/start'), // 嵌套不合法但容错计数
      evt(2, 'compaction/end', { reason: 'completed' }), // 闭合一层
      evt(3, 'turn/start'),
    ];
    const drafts = recoverClosers(events);
    const compactionEnds = drafts.filter((d) => d.type === 'compaction/end');
    expect(compactionEnds.length).toBe(1);
    expect((compactionEnds[0]!.data as { reason: string }).reason).toBe('aborted');
  });

  it('未闭合 turn：按深度补 N 条 turn/end（interrupted）', () => {
    const events = [evt(0, 'turn/start'), evt(1, 'turn/start')];
    const drafts = recoverClosers(events);
    expect(drafts.length).toBe(2);
    for (const d of drafts) {
      expect(d.type).toBe('turn/end');
      expect((d.data as { reason: string }).reason).toBe('interrupted');
    }
  });

  it('合成序：result 们 → compaction/end 们 → turn/end 们（turn 闭合必后于其内一切）', () => {
    const events = [
      evt(0, 'turn/start'),
      evt(1, 'tool/call', { toolCallId: 'a', name: 't', arguments: '' }),
      evt(2, 'tool/call', { toolCallId: 'b', name: 't', arguments: '' }),
      evt(3, 'compaction/start'),
    ];
    const types = recoverClosers(events).map((d) => d.type);
    expect(types).toEqual(['tool/result', 'tool/result', 'compaction/end', 'turn/end']);
  });

  it('time 复用最后真实事件时间戳（确定性合成标记）', () => {
    const events = [evt(0, 'turn/start'), evt(7, 'user/message', { content: 'x' })];
    for (const draft of recoverClosers(events)) {
      expect(draft.time).toBe(1007);
    }
  });

  it('已配对的 call 不合成（settled 摘除）', () => {
    const events = [
      evt(0, 'turn/start'),
      evt(1, 'tool/call', { toolCallId: 'ok', name: 't', arguments: '' }),
      evt(2, 'tool/result', { toolCallId: 'ok', content: 'done' }),
    ];
    const drafts = recoverClosers(events);
    expect(drafts.filter((d) => d.type === 'tool/result')).toEqual([]);
    expect(drafts.length).toBe(1); // 只剩 turn/end
  });

  it('空日志：零合成（无 closer 可言）', () => {
    expect(recoverClosers([])).toEqual([]);
  });
});

describe('firstSeqBreak 完整性预检', () => {
  it('连续日志返回 null', () => {
    expect(firstSeqBreak([evt(0, 'turn/start'), evt(1, 'turn/end', { reason: 'completed' })])).toBeNull();
  });

  it('断号日志返回首个断点位置', () => {
    const events = [evt(0, 'turn/start'), evt(2, 'user/message', { content: '跳号' })];
    expect(firstSeqBreak(events)).toBe(1);
  });

  it('空日志连续（null）', () => {
    expect(firstSeqBreak([])).toBeNull();
  });
});
