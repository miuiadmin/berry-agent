/**
 * 重播种单测（04 §3.3 条 2 / 05 §3.1——投影 → timeline 活数组种子）：
 * 三缺口裁决各锁 + 三态转换保序 + 确定性时间源。
 * 禁断言 AI 生成文本——只断言结构与裁决行为。
 */
import { describe, expect, it } from 'vitest';
import type { ProjectedMessage } from '../session/index.js';
import { reseedTimeline } from './reseed.js';

/** 锚事件时间词典（确定性假钟） */
function timeMap(entries: Record<number, number>): (seq: number) => number {
  return (seq) => entries[seq] ?? 0;
}

describe('reseedTimeline 三态转换', () => {
  it('user 双形直通：string content / 块数组 content + source 归因透传', () => {
    const projection: ProjectedMessage[] = [
      { type: 'user', seq: 1, content: '你好' },
      { type: 'user', seq: 2, content: [{ type: 'text', text: '附件' }], source: 'channel:webui' },
    ];
    const messages = reseedTimeline(projection, timeMap({ 1: 100, 2: 200 }));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: '你好', timestamp: 100 });
    expect(messages[1]).toMatchObject({ role: 'user', source: 'channel:webui', timestamp: 200 });
    expect(messages[1]!.content).toEqual([{ type: 'text', text: '附件' }]);
  });

  it('toolCalls 装回 assistant.content 尾部（投影序 = 尾部序）+ arguments 解析', () => {
    const projection: ProjectedMessage[] = [
      {
        type: 'assistant',
        seq: 3,
        content: [{ type: 'text', text: '先说后调' }],
        toolCalls: [
          { type: 'toolCall', toolCallId: 'c1', toolName: 'read', arguments: '{"path":"x"}' },
          { type: 'toolCall', toolCallId: 'c2', toolName: 'bash', arguments: '{}' },
        ],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
        stopReason: 'toolUse',
      },
    ];
    const [first] = reseedTimeline(projection, timeMap({ 3: 300 }));
    if (!first || first.role !== 'assistant') throw new Error('unreachable');
    // 文本块在前、toolCall 块装回尾部（交错序无账——尾部即投影序）
    expect(first.content.map((block) => block.type)).toEqual(['text', 'toolCall', 'toolCall']);
    expect(first.content[1]).toEqual({
      type: 'toolCall',
      id: 'c1',
      name: 'read',
      arguments: { path: 'x' },
    });
    expect(first.stopReason).toBe('toolUse');
    expect(first.usage).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 });
  });

  it('toolResult：string 输出包裹文本块 / 块数组直通 / arguments 丢弃', () => {
    const projection: ProjectedMessage[] = [
      {
        type: 'toolResult',
        seq: 4,
        toolCallId: 'c1',
        toolName: 'read',
        arguments: '{"path":"x"}',
        output: '文件内容',
        isError: false,
      },
      {
        type: 'toolResult',
        seq: 5,
        toolCallId: 'c2',
        toolName: 'view',
        output: [{ type: 'text', text: '多块' }],
        isError: true,
      },
    ];
    const messages = reseedTimeline(projection, timeMap({ 4: 400, 5: 500 }));
    expect(messages[0]).toMatchObject({ role: 'toolResult', toolCallId: 'c1', isError: false, timestamp: 400 });
    expect(messages[0]!.content).toEqual([{ type: 'text', text: '文件内容' }]);
    expect(messages[1]).toMatchObject({ role: 'toolResult', isError: true, timestamp: 500 });
    expect((messages[1] as { content: unknown[] }).content).toEqual([{ type: 'text', text: '多块' }]);
  });

  it('消息序保真（user → assistant → toolResult 交错原样）', () => {
    const projection: ProjectedMessage[] = [
      { type: 'user', seq: 0, content: 'q' },
      { type: 'assistant', seq: 1, content: [], toolCalls: [], stopReason: 'stop' },
      { type: 'user', seq: 2, content: '再问' },
    ];
    const messages = reseedTimeline(projection, timeMap({}));
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('reseedTimeline 三缺口裁决（冷读 B2 定案）', () => {
  it('arguments 损坏串兜底空对象（损坏不炸重播种）', () => {
    const projection: ProjectedMessage[] = [
      {
        type: 'assistant',
        seq: 0,
        content: [],
        toolCalls: [
          { type: 'toolCall', toolCallId: 'c1', toolName: 'bash', arguments: '{broken' },
          { type: 'toolCall', toolCallId: 'c2', toolName: 'bash', arguments: '"标量非对象"' },
        ],
        stopReason: 'stop',
      },
    ];
    const [first] = reseedTimeline(projection, timeMap({}));
    if (!first || first.role !== 'assistant') throw new Error('unreachable');
    expect((first.content[0] as { arguments: unknown }).arguments).toEqual({});
    expect((first.content[1] as { arguments: unknown }).arguments).toEqual({});
  });

  it('usage unknown / 主字段缺损 → 零用量形（不冒充计量）', () => {
    const projection: ProjectedMessage[] = [
      { type: 'assistant', seq: 0, content: [], toolCalls: [], usage: undefined, stopReason: 'stop' },
      { type: 'assistant', seq: 1, content: [], toolCalls: [], usage: 'garbage', stopReason: 'stop' },
      { type: 'assistant', seq: 2, content: [], toolCalls: [], usage: { input: 10 }, stopReason: 'stop' },
      {
        type: 'assistant',
        seq: 3,
        content: [],
        toolCalls: [],
        usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 },
        stopReason: 'stop',
      },
    ];
    const messages = reseedTimeline(projection, timeMap({}));
    const usages = messages.map((m) => (m as { usage: { totalTokens: number } }).usage);
    expect(usages[0]).toMatchObject({ input: 0, output: 0, totalTokens: 0 });
    expect(usages[1]).toMatchObject({ input: 0, output: 0, totalTokens: 0 });
    // 半拼凑（缺 output 等）整笔退零——计量要么完整要么明示没有
    expect(usages[2]).toMatchObject({ input: 0, output: 0, totalTokens: 0 });
    // 完整四主字段：totalTokens 缺席按派生和回填
    expect(usages[3]).toMatchObject({ input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18 });
  });

  it('stopReason 闭集校验：非成员归 error / undefined 归 stop', () => {
    const projection: ProjectedMessage[] = [
      { type: 'assistant', seq: 0, content: [], toolCalls: [], stopReason: 'weird-value' },
      { type: 'assistant', seq: 1, content: [], toolCalls: [] },
      { type: 'assistant', seq: 2, content: [], toolCalls: [], stopReason: 'length' },
    ];
    const messages = reseedTimeline(projection, timeMap({}));
    expect((messages[0] as { stopReason: string }).stopReason).toBe('error');
    expect((messages[1] as { stopReason: string }).stopReason).toBe('stop');
    expect((messages[2] as { stopReason: string }).stopReason).toBe('length');
  });

  it('errorMessage 透传（stopReason=error 终态轮投影带出）', () => {
    const projection: ProjectedMessage[] = [
      {
        type: 'assistant',
        seq: 0,
        content: [],
        toolCalls: [],
        stopReason: 'error',
        errorMessage: 'network reset',
      },
    ];
    const [assistant] = reseedTimeline(projection, timeMap({}));
    expect(assistant).toMatchObject({ stopReason: 'error', errorMessage: 'network reset' });
  });

  it('空投影 → 空数组', () => {
    expect(reseedTimeline([], timeMap({}))).toEqual([]);
  });
});
