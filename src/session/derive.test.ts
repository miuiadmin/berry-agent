/**
 * 投影 fold 单元测试（05 篇 §3.1——stepFold 唯一转换函数 / 投影快照 / 增量遮蔽）。
 *
 * 核心不变式：增量缓存（SessionLog 活态）与全量重算（deriveMessages 纯函数）
 * 共用 stepFold——两路对同一日志必产出同一投影。本文件以纯函数面钉转换语义，
 * 活态对账在 session.test.ts。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import {
  applyOcclusion,
  createFoldState,
  deriveMessages,
  occludedSeqs,
  projectedJsonChars,
  snapshotProjection,
  stepFold,
} from './derive.js';

/** 造事件 helper（time 与 seq 同值——测试确定性） */
function evt(seq: number, type: string, data: unknown = {}): SessionEvent {
  return { type, seq, time: seq, data };
}

/** 一轮完整对话的事件序列（user → assistant → tool 调用对 → turn 闭合） */
function dialogueEvents(): SessionEvent[] {
  return [
    evt(0, 'turn/start'),
    evt(1, 'user/message', { content: '你好' }),
    evt(2, 'assistant/message', { content: [{ type: 'text', text: '好的' }], stopReason: 'toolUse' }),
    evt(3, 'tool/call', { toolCallId: 'c1', name: 'read', arguments: '{"path":"x"}' }),
    evt(4, 'tool/result', { toolCallId: 'c1', content: '文件内容' }),
    evt(5, 'assistant/message', { content: [{ type: 'text', text: '结论' }], stopReason: 'end' }),
    evt(6, 'turn/end', { reason: 'completed' }),
  ];
}

describe('stepFold 消息折叠语义', () => {
  it('三态消息序：user → assistant(带 toolCall) → toolResult → assistant', () => {
    const state = createFoldState();
    for (const event of dialogueEvents()) stepFold(state, event);
    // 末条 assistant 留在活缓冲——快照发布折入拷贝尾（活态零改动语义）
    const messages = snapshotProjection(state);
    expect(messages.map((m) => m.type)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    // toolCall 块内联在 assistant 消息上（tool/call 事件唯一承载、fold 归属）
    const first = messages[1]!;
    if (first.type !== 'assistant') throw new Error('形状错');
    expect(first.toolCalls).toEqual([
      { type: 'toolCall', toolCallId: 'c1', toolName: 'read', arguments: '{"path":"x"}' },
    ]);
    // toolResult 配对补齐 name/arguments（来自 pendingCalls 配对表）
    const tr = messages[2]!;
    if (tr.type !== 'toolResult') throw new Error('形状错');
    expect(tr.toolName).toBe('read');
    expect(tr.arguments).toBe('{"path":"x"}');
    expect(tr.isError).toBe(false);
  });

  it('user/message 冲刷打开中的 assistant（消息序保真）', () => {
    const state = createFoldState();
    stepFold(state, evt(0, 'assistant/message', { content: [{ type: 'text', text: 'a' }] }));
    stepFold(state, evt(1, 'user/message', { content: 'u' }));
    expect(state.messages.map((m) => m.type)).toEqual(['assistant', 'user']);
  });

  it('tool/result 带 error 字段 → isError true；source 归因原样带出', () => {
    const state = createFoldState();
    stepFold(state, evt(0, 'assistant/message', { content: [] }));
    stepFold(state, evt(1, 'tool/call', { toolCallId: 'e1', name: 't', arguments: '' }));
    stepFold(state, evt(2, 'tool/result', { toolCallId: 'e1', content: '炸了', error: true }));
    stepFold(state, evt(3, 'user/message', { content: '再来', source: 'channel:webui' }));
    // 冲刷序：tool/result 先冲出 assistant 缓冲再落自身——[assistant, toolResult, user]
    const tr = state.messages[1]!;
    if (tr.type !== 'toolResult') throw new Error('形状错');
    expect(tr.isError).toBe(true);
    const u = state.messages[2]!;
    if (u.type !== 'user') throw new Error('形状错');
    expect(u.source).toBe('channel:webui');
  });

  it('结构/log-only 事件不产消息（fold 判定输入 ≠ 模型历史）', () => {
    const state = createFoldState();
    stepFold(state, evt(0, 'turn/start'));
    stepFold(state, evt(1, 'request/header', { systemPrompt: '' }));
    stepFold(state, evt(2, 'todo/write', { items: [] }));
    stepFold(state, evt(3, 'gate/decision', { toolCallId: 'x', decision: 'allow' }));
    stepFold(state, evt(4, 'llm/usage', { input: 1 }));
    stepFold(state, evt(5, 'turn/end', { reason: 'completed' }));
    expect(state.messages).toEqual([]);
    expect(state.chars).toBe(0);
  });
});

describe('snapshotProjection 投影快照发布', () => {
  it('活缓冲折入拷贝尾——活态零改动（缓冲可继续接收迟到 call）', () => {
    const state = createFoldState();
    stepFold(state, evt(0, 'assistant/message', { content: [{ type: 'text', text: '部分' }] }));
    const snap = snapshotProjection(state);
    expect(snap.length).toBe(1);
    expect(state.messages.length).toBe(0); // 活数组未收编缓冲
    // 缓冲继续接收 tool/call 后再发布——内容更新
    stepFold(state, evt(1, 'tool/call', { toolCallId: 'c1', name: 't', arguments: '' }));
    const snap2 = snapshotProjection(state);
    const a = snap2[0]!;
    if (a.type !== 'assistant') throw new Error('形状错');
    expect(a.toolCalls.length).toBe(1);
  });
});

describe('occludedSeqs + deriveMessages 全量投影', () => {
  it('遮蔽区间预滤：被遮蔽节点不进 fold', () => {
    const events = [
      ...dialogueEvents(),
      evt(7, 'user/message', { content: '第二轮' }),
      // 遮蔽指令：遮 [0,6]（第一轮整轮）——compaction/summary 载体形态
      { ...evt(8, 'compaction/summary', { summary: '摘要' }), surfaceOp: { op: 'replace' as const, start: 0, end: 6 } },
    ];
    expect(occludedSeqs(events)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    const messages = deriveMessages(events);
    expect(messages.length).toBe(1);
    expect(messages[0]!.type).toBe('user');
    if (messages[0]!.type === 'user') expect(messages[0]!.content).toBe('第二轮');
  });

  it('deriveMessages 尾部冲刷活缓冲（与 snapshotProjection 折入语义同形）', () => {
    const events = dialogueEvents().slice(0, 3); // 到 assistant/message 为止（缓冲开着）
    const messages = deriveMessages(events);
    expect(messages.length).toBe(2);
    expect(messages[1]!.type).toBe('assistant');
  });
});

describe('applyOcclusion 增量遮蔽摘除', () => {
  it('摘除区间内消息 + chars 回退（与 pushMessage 同一把尺）', () => {
    const state = createFoldState();
    for (const event of dialogueEvents()) stepFold(state, event);
    const before = projectedJsonChars(state);
    // 被摘消息的 JSON 长度和（回退量预计算——与实现同式对账）
    const removed = state.messages
      .filter((m) => m.seq >= 1 && m.seq <= 4)
      .map((m) => JSON.stringify(m).length)
      .reduce((a, b) => a + b, 0);
    applyOcclusion(state, { start: 1, end: 4 });
    expect(projectedJsonChars(state)).toBe(before - removed);
    // 剩余：user@1/assistant@2/toolResult@4 全摘；seq0 是 turn/start、seq6 是
    // turn/end 均不产消息——只剩 seq5(assistant) 活缓冲（快照折入拷贝尾）
    expect(snapshotProjection(state).map((m) => m.type)).toEqual(['assistant']);
    expect(state.messages).toEqual([]);
  });

  it('全区间遮蔽：chars 归零、消息清空', () => {
    const state = createFoldState();
    for (const event of dialogueEvents()) stepFold(state, event);
    applyOcclusion(state, { start: 0, end: 6 });
    expect(state.messages).toEqual([]);
    expect(projectedJsonChars(state)).toBe(0);
  });

  it('增量路 vs 全量路同源对账（applyOcclusion 后活态 == deriveMessages 重算）', () => {
    const state = createFoldState();
    for (const event of dialogueEvents()) stepFold(state, event);
    applyOcclusion(state, { start: 0, end: 4 });
    // 全量重算：等价日志 = 原日志 + 遮蔽指令（同一区间——遮蔽纪律下 call/result 同进同出）
    const withOp = [
      ...dialogueEvents(),
      { ...evt(7, 'compaction/summary', { summary: 's' }), surfaceOp: { op: 'replace' as const, start: 0, end: 4 } },
    ];
    const fresh = createFoldState();
    const occluded = occludedSeqs(withOp);
    for (const event of withOp) {
      if (!occluded.has(event.seq)) stepFold(fresh, event);
    }
    expect(snapshotProjection(state)).toEqual(snapshotProjection(fresh));
    expect(projectedJsonChars(state)).toBe(projectedJsonChars(fresh));
  });
});
