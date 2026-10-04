/**
 * 模型调用台账折叠测试（07 §4.1 B3 定形注——/calls 副屏数据源纯函数直锁）：
 * 行两类推导（assistant/message 主对话行 + llm/retry 配对重试注记 / llm/usage
 * 单发路行）、桥接行去重律（callId `run:` 前缀不入册）、两路行 seq 并序、
 * 帽 50 尾窗截断、stopReason 分档透传、缺席字段诚实缺席、宽容解码防御位。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { CALL_LEDGER_LIMIT, foldCallLedger } from './calls.js';

/** 事件夹具（seq/time 台账消费面——显式传值） */
function ev(type: string, data: unknown, seq: number, time: number): SessionEvent {
  return { type, seq, time, data };
}

/** assistant/message 载荷形（wiring.appendMessage 落账形——usage/stopReason 全字段；stopReason null = 键缺席形） */
function assistantPayload(
  over: Partial<{
    stopReason: string | null;
    usage: unknown;
    provider: string;
    model: string;
    errorMessage: string;
  }> = {},
): unknown {
  return {
    content: [],
    usage: over.usage ?? { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18 },
    ...(over.stopReason !== null ? { stopReason: over.stopReason ?? 'stop' } : {}),
    ...(over.provider !== undefined ? { provider: over.provider } : {}),
    ...(over.model !== undefined ? { model: over.model } : {}),
    ...(over.errorMessage !== undefined ? { errorMessage: over.errorMessage } : {}),
  };
}

/** llm/retry 载荷形（driver.occludeFailedTail / appendExhausted 落账形） */
function retryPayload(phase: 'scheduled' | 'aborted' | 'exhausted', attempt: number, maxAttempts = 3): unknown {
  return { attempt, maxAttempts, delayMs: phase === 'scheduled' ? 1000 : 0, phase };
}

/** llm/usage 载荷形（LlmUsageEventData——四桶形，totalTokens/cost 不入账） */
function llmUsagePayload(
  over: Partial<{
    callId: string;
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    elapsedMs: number;
  }> = {},
): unknown {
  return {
    callId: over.callId ?? '0b9e6c1e-1111-2222-3333-444455556666',
    model: over.model ?? 'zai/glm-4.7',
    usage: {
      input: over.input ?? 100,
      output: over.output ?? 40,
      cacheRead: over.cacheRead ?? 10,
      cacheWrite: over.cacheWrite ?? 5,
    },
    priority: 'foreground',
    ...(over.elapsedMs !== undefined ? { elapsedMs: over.elapsedMs } : {}),
  };
}

describe('foldCallLedger 主对话轮行（assistant/message）', () => {
  it('基线行：信封 time/seq + 实录全形模型 + stopReason 透传 + attempt 缺省 1 + totalTokens 口径 + 耗时诚实缺席', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload({ provider: 'anthropic', model: 'claude-sonnet-5' }), 3, 1759000000000),
    ]);
    expect(ledger.total).toBe(1);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toEqual({
      source: 'conversation',
      time: 1759000000000,
      seq: 3,
      model: 'anthropic/claude-sonnet-5',
      status: 'stop',
      attempt: 1,
      tokens: 18,
    });
  });

  it('stopReason 分档透传五终值（stop/toolUse/length/error/aborted——用户面词归呈现层）', () => {
    const reasons = ['stop', 'toolUse', 'length', 'error', 'aborted'] as const;
    const events = reasons.map((reason, i) => ev('assistant/message', assistantPayload({ stopReason: reason }), i, i));
    const statuses = foldCallLedger(events).entries.map((row) => row.status);
    expect(statuses).toEqual(['stop', 'toolUse', 'length', 'error', 'aborted']);
  });

  it('error 档携带 errorMessage 短因（失败行呈现位）', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload({ stopReason: 'error', errorMessage: 'LLM_TIMEOUT 请求超时' }), 1, 1),
    ]);
    expect(ledger.entries[0]).toMatchObject({ status: 'error', errorMessage: 'LLM_TIMEOUT 请求超时' });
  });

  it('stopReason 非终值/缺席/未知 = 状态诚实缺席（宽容解码——不虚构档）', () => {
    for (const stopReason of ['pending', 'deferred', 'weird-future', null]) {
      const ledger = foldCallLedger([ev('assistant/message', assistantPayload({ stopReason }), 1, 1)]);
      expect(ledger.entries[0]!.status).toBeUndefined();
    }
  });

  it('实录位缺席形：provider 缺席 = 裸 model；双缺席 = 模型缺席（不冒充）', () => {
    const bare = foldCallLedger([ev('assistant/message', assistantPayload({ model: 'glm-4.7' }), 1, 1)]);
    expect(bare.entries[0]!.model).toBe('glm-4.7');
    const absent = foldCallLedger([ev('assistant/message', assistantPayload({}), 2, 2)]);
    expect(absent.entries[0]!.model).toBeUndefined();
  });
});

describe('foldCallLedger 重试注记（llm/retry 配对）', () => {
  it('燃尽链三行：attempt 自前位 scheduled 推继 [1,2,3]，maxAttempts 随配对行携带', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload({ stopReason: 'error' }), 10, 1000),
      ev('llm/retry', retryPayload('scheduled', 1), 11, 1100),
      ev('assistant/message', assistantPayload({ stopReason: 'error' }), 12, 1200),
      ev('llm/retry', retryPayload('scheduled', 2), 13, 1300),
      ev('assistant/message', assistantPayload({ stopReason: 'error' }), 14, 1400),
      ev('llm/retry', retryPayload('exhausted', 3), 15, 1500),
    ]);
    expect(ledger.entries.map((row) => row.attempt)).toEqual([1, 2, 3]);
    expect(ledger.entries.map((row) => row.maxAttempts)).toEqual([undefined, 3, 3]);
  });

  it('注记一行一消费：紧随其后的续轮（无新 retry）回缺省 1', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload({ stopReason: 'error' }), 10, 1000),
      ev('llm/retry', retryPayload('scheduled', 1), 11, 1100),
      ev('assistant/message', assistantPayload({ stopReason: 'toolUse' }), 12, 1200),
      ev('assistant/message', assistantPayload({ stopReason: 'stop' }), 13, 1300),
    ]);
    expect(ledger.entries.map((row) => row.attempt)).toEqual([1, 2, 1]);
  });

  it('新轮种子复位（user/message 后的前位注记不越轮污染）', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload({ stopReason: 'error' }), 10, 1000),
      ev('llm/retry', retryPayload('scheduled', 1), 11, 1100),
      ev('assistant/message', assistantPayload({ stopReason: 'stop' }), 12, 1200),
      ev('user/message', { content: '下一问' }, 13, 1300),
      ev('assistant/message', assistantPayload({ stopReason: 'stop' }), 14, 1400),
    ]);
    expect(ledger.entries.map((row) => row.attempt)).toEqual([1, 2, 1]);
  });

  it('aborted/exhausted 相不立注记（收口非重试——其后 assistant 回缺省 1）', () => {
    const ledger = foldCallLedger([
      ev('llm/retry', retryPayload('aborted', 1), 5, 500),
      ev('assistant/message', assistantPayload(), 6, 600),
    ]);
    expect(ledger.entries[0]!.attempt).toBe(1);
  });
});

describe('foldCallLedger 单发路行（llm/usage）', () => {
  it('桥接行去重律：callId run: 前缀不入册（同一调用已有 assistant/message 行——入册即双计）', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload(), 10, 1000),
      ev('llm/usage', llmUsagePayload({ callId: 'run:session-1:10' }), 11, 1100),
    ]);
    expect(ledger.total).toBe(1);
    expect(ledger.entries.map((row) => row.source)).toEqual(['conversation']);
  });

  it('单发行：status 完成（llm/usage 只在成功路落账）+ 四桶合计 tokens + elapsedMs 必带 + 实录模型透传', () => {
    const ledger = foldCallLedger([ev('llm/usage', llmUsagePayload({ elapsedMs: 2345 }), 7, 1759000000000)]);
    expect(ledger.entries[0]).toEqual({
      source: 'oneshot',
      time: 1759000000000,
      seq: 7,
      model: 'zai/glm-4.7',
      status: 'stop',
      attempt: 1,
      tokens: 155, // 100+40+10+5 四桶合计（totalTokens 不入账）
      elapsedMs: 2345,
    });
  });

  it('归因前缀宽容解码：probe: 族带归因；未知前缀原样；裸 UUID 无归因', () => {
    const ledger = foldCallLedger([
      ev('llm/usage', llmUsagePayload({ callId: 'probe:0b9e6c1e-aaaa-bbbb-cccc-ddddddd' }), 1, 1),
      ev('llm/usage', llmUsagePayload({ callId: 'future-site:xyz' }), 2, 2),
      ev('llm/usage', llmUsagePayload({ callId: '0b9e6c1e-1111-2222-3333-444455556666' }), 3, 3),
    ]);
    expect(ledger.entries.map((row) => row.attribution)).toEqual(['probe', 'future-site', undefined]);
  });
});

describe('foldCallLedger 并序与帽', () => {
  it('两路行 seq 并序（单遍折叠自然并序——interleave 形）', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', assistantPayload(), 2, 200),
      ev('llm/usage', llmUsagePayload(), 5, 500),
      ev('assistant/message', assistantPayload(), 7, 700),
    ]);
    expect(ledger.entries.map((row) => row.seq)).toEqual([2, 5, 7]);
    expect(ledger.entries.map((row) => row.source)).toEqual(['conversation', 'oneshot', 'conversation']);
  });

  it(`尾窗帽 ${CALL_LEDGER_LIMIT}：60 笔入 50 行 + total 60 + 截窗保留最新段`, () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 60; i += 1) {
      events.push(ev('assistant/message', assistantPayload(), i, 1000 + i));
    }
    const ledger = foldCallLedger(events);
    expect(ledger.total).toBe(60);
    expect(ledger.entries).toHaveLength(CALL_LEDGER_LIMIT);
    expect(ledger.entries[0]!.seq).toBe(10); // 尾窗 = 丢最旧 10 笔
    expect(ledger.entries[49]!.seq).toBe(59);
  });

  it('帽内零截断：30 笔全量在册（total = entries.length）', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 30; i += 1) events.push(ev('assistant/message', assistantPayload(), i, i));
    const ledger = foldCallLedger(events);
    expect(ledger.total).toBe(30);
    expect(ledger.entries).toHaveLength(30);
  });
});

describe('foldCallLedger 防御位（宽容解码——旧日志/非标准形不炸）', () => {
  it('空事件流 = 空台账', () => {
    expect(foldCallLedger([])).toEqual({ entries: [], total: 0 });
  });

  it('非消费词事件零参与（user/todo/tool 等——含四族外一切词）', () => {
    const ledger = foldCallLedger([
      ev('user/message', { content: '问' }, 0, 0),
      ev('tool/call', { name: 'read' }, 1, 1),
      ev('tool/result', { toolCallId: 't1' }, 2, 2),
      ev('turn/end', { reason: 'completed' }, 3, 3),
    ]);
    expect(ledger).toEqual({ entries: [], total: 0 });
  });

  it('载荷坏形（null/非对象）跳过不炸；缺 totalTokens = tokens 诚实缺席但行在场', () => {
    const ledger = foldCallLedger([
      ev('assistant/message', null, 1, 1),
      ev('assistant/message', 'not-an-object', 2, 2),
      ev('assistant/message', { content: [], stopReason: 'stop', usage: { input: 1, output: 1 } }, 3, 3),
    ]);
    expect(ledger.total).toBe(3);
    expect(ledger.entries[2]!.tokens).toBeUndefined(); // 缺 totalTokens = 诚实缺席但行在场
    expect(ledger.entries[2]!.status).toBe('stop');
  });

  it('llm/usage 桶键缺数 = tokens 诚实缺席但行在场；callId 坏形不误判桥接', () => {
    const ledger = foldCallLedger([
      ev(
        'llm/usage',
        { callId: 42, model: 'zai/glm-4.7', usage: { input: 'x', output: 1, cacheRead: 1, cacheWrite: 1 } },
        1,
        1,
      ),
    ]);
    expect(ledger.total).toBe(1);
    expect(ledger.entries[0]!.tokens).toBeUndefined();
    expect(ledger.entries[0]!.attribution).toBeUndefined();
  });
});
