/**
 * LiveTranscript 渲染归约测试（批 10e-1——纯逻辑零 IO）。
 *
 * 覆盖：流式两段（开槽/直换/定稿换装）、流式单槽守卫、唯一渲染源律
 * （tool_execution_* 正文零渲染）、非聚焦摘要行分档、投影重建、帽卸载。
 */
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage } from '../../../contracts/index.js';
import { LiveTranscript, shortIdOf, TRANSCRIPT_BLOCK_CAP, type SummaryLine } from './transcript.js';

/* ---------------- 消息工厂 ---------------- */

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function userMsg(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 1 };
}

function assistantMsg(
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [],
): AgentMessage {
  return {
    role: 'assistant',
    content: [
      ...(text !== '' ? [{ type: 'text' as const, text }] : []),
      ...toolCalls.map((call) => ({ type: 'toolCall' as const, ...call })),
    ],
    usage,
    stopReason: 'stop',
    timestamp: 1,
  };
}

function toolResultMsg(text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: 'tc1',
    toolName: 'read',
    content: text !== '' ? [{ type: 'text', text }] : [],
    isError: false,
    timestamp: 1,
  };
}

function apply(t: LiveTranscript, event: AgentEvent, focused = true): SummaryLine | null {
  return t.applyEvent({ sessionId: 'sess-aaaaaaaaaa', event }, focused);
}

/* ---------------- 聚焦归约 ---------------- */

describe('LiveTranscript 聚焦归约', () => {
  it('message_start 开流式槽（空文本 streaming 末块）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    expect(t.snapshot).toHaveLength(1);
    expect(t.snapshot[0]).toEqual({ kind: 'streaming', text: '' });
  });

  it('message_update 槽文本直换（partial 完整快照非追加）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好') });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好，世界') });
    expect(t.snapshot).toEqual([{ kind: 'streaming', text: '你好，世界' }]);
  });

  it('message_update 在无槽时零效果（配对守卫）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('孤儿') });
    expect(t.snapshot).toHaveLength(0);
  });

  it('message_end 定稿换装：摘槽 → markdown 块 + ⚙ 行', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('部分') });
    apply(t, {
      type: 'message_end',
      message: assistantMsg('看 `npm test`', [{ id: 'tc1', name: 'read', arguments: { path: 'a.ts' } }]),
    });
    expect(t.snapshot).toHaveLength(2);
    expect(t.snapshot[0]!.kind).toBe('markdown');
    expect(t.snapshot[0]).toMatchObject({ kind: 'markdown' });
    expect(t.snapshot[1]).toEqual({ kind: 'tool-call', name: 'read', brief: '(path)' });
  });

  it('message_end 空文本带 toolCall → 只有 ⚙ 行（无空 markdown 块）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'tc1', name: 'ls', arguments: {} }]) });
    expect(t.snapshot).toEqual([{ kind: 'tool-call', name: 'ls', brief: '' }]);
  });

  it('流式单槽守卫：重开 message_start 先摘旧槽（占位不孤儿滞留）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('旧') });
    apply(t, { type: 'message_start', role: 'assistant' });
    expect(t.snapshot).toEqual([{ kind: 'streaming', text: '' }]);
  });

  it('user / toolResult 的 message_end 追加对应块', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: userMsg('帮我看下') });
    apply(t, { type: 'message_end', message: toolResultMsg('第 1 行输出\n第 2 行') });
    expect(t.snapshot).toEqual([
      { kind: 'user', text: '帮我看下' },
      { kind: 'tool-result', brief: '第 1 行输出' },
    ]);
  });

  it('toolResult 无文本块 → 占位简述', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: toolResultMsg('') });
    expect(t.snapshot).toEqual([{ kind: 'tool-result', brief: '(无文本输出)' }]);
  });

  it('唯一渲染源律：tool_execution_* 与 turn 族正文零渲染', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'turn_start', turn: 1 });
    apply(t, { type: 'tool_execution_start', toolCallId: 'tc1', name: 'read', arguments: {} });
    apply(t, { type: 'tool_execution_update', toolCallId: 'tc1', update: { progress: 1 } });
    apply(t, { type: 'tool_execution_end', toolCallId: 'tc1', result: {} as never });
    apply(t, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    apply(t, { type: 'agent_start' });
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot).toHaveLength(0);
  });
});

/* ---------------- 非聚焦摘要行 ---------------- */

describe('LiveTranscript 非聚焦摘要行', () => {
  it('agent_start ⧗ + 短 id + 后台工作中', () => {
    const t = new LiveTranscript();
    const line = apply(t, { type: 'agent_start' }, false);
    expect(line).toEqual({ symbol: '⧗', shortId: 'sess-aaa', label: '后台工作中' });
  });

  it('agent_end 三档分立：完成 ✓ / 失败 ✖ / 中止 ⏹', () => {
    const t = new LiveTranscript();
    expect(apply(t, { type: 'agent_end', status: 'completed' }, false)?.symbol).toBe('✓');
    expect(apply(t, { type: 'agent_end', status: 'failed' }, false)?.symbol).toBe('✖');
    expect(apply(t, { type: 'agent_end', status: 'aborted' }, false)?.symbol).toBe('⏹');
  });

  it('非聚焦消息族零产出且不建账', () => {
    const t = new LiveTranscript();
    expect(apply(t, { type: 'message_end', message: userMsg('后台会话') }, false)).toBeNull();
    expect(t.snapshot).toHaveLength(0);
  });

  it('shortIdOf 取前八位', () => {
    expect(shortIdOf('abcdefgh12345678')).toBe('abcdefgh');
    expect(shortIdOf('短')).toBe('短');
  });
});

/* ---------------- 投影重建与帽 ---------------- */

describe('LiveTranscript 投影重建与帽', () => {
  it('loadProjection 重建 user/assistant/toolResult 三形（直播/repaint 同构）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userMsg('问题'),
      assistantMsg('**答**', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x', path: 'y' } }]),
      toolResultMsg('命中 3 处'),
    ]);
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'markdown', 'tool-call', 'tool-result']);
    expect(t.snapshot[1]).toMatchObject({ kind: 'markdown' });
    expect(t.snapshot[2]).toEqual({ kind: 'tool-call', name: 'grep', brief: '(pattern, path)' });
  });

  it('loadProjection 自定义角色宽容跳过', () => {
    const t = new LiveTranscript();
    t.loadProjection([{ role: 'memory/recall', content: { q: 1 }, timestamp: 1 }, userMsg('问题')]);
    expect(t.snapshot).toEqual([{ kind: 'user', text: '问题' }]);
  });

  it('loadProjection 清流式槽位（投影是 durable 快照）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    t.loadProjection([userMsg('重建')]);
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('孤儿') });
    expect(t.snapshot).toEqual([{ kind: 'user', text: '重建' }]); // slotOpen 已清——update 零效果
  });

  it('帽卸载：超帽从头卸、保留帽内最近段', () => {
    const t = new LiveTranscript();
    const messages: AgentMessage[] = [];
    for (let i = 0; i < TRANSCRIPT_BLOCK_CAP + 5; i++) messages.push(userMsg(`消息 ${i}`));
    t.loadProjection(messages);
    expect(t.blockCount).toBe(TRANSCRIPT_BLOCK_CAP);
    expect(t.snapshot[0]).toEqual({ kind: 'user', text: '消息 5' }); // 前 5 条卸载
  });
});
