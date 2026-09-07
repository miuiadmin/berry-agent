/**
 * webui/client/frames 纯折叠器单测（批 18a-2；jsdom 轨——扩展名选轨，
 * 纯逻辑零 DOM 触）。
 *
 * 锁五面——
 * ① 活体分档：display 族画流式尾巴（start 开位/update 刷尾）、session 族
 * message_end 落稿换尾；跨档帧静默丢（session 收 update / display 收 end）
 * ② 工具族：start/update 走状态行、end 落正文行并清状态
 * ③ 审批：asked 入账 dedupe、decide 出清
 * ④ notify 滚动帽 5 / status 直通 / agent_end 清状态
 * ⑤ 投影层：loadedMessages 整段重置（正确性层真源——活体尾巴清场）；
 * textOf 抽取三形（string/text 块数组/非 text 块跳过）
 */
import { describe, expect, it } from 'vitest';

import type { ClientEnvelope } from './protocol.js';
import {
  appliedDecide,
  applyAsked,
  applyEnvelope,
  initialAppState,
  loadedMessages,
  loadedSessions,
  setActiveSession,
  textOf,
} from './frames.js';

/** display 族信封速造 */
function display(payload: ClientDisplayEventLoose): ClientEnvelope {
  return { kind: 'display', sessionId: 's-1', payload } as ClientEnvelope;
}

/** display 载荷宽松形（速造位允许测试塞多余字段——折叠器只读消费子集） */
type ClientDisplayEventLoose = { readonly type: string } & Record<string, unknown>;

/** session 族信封速造 */
function session(payload: { type: string } & Record<string, unknown>): ClientEnvelope {
  return { kind: 'session', sessionId: 's-1', payload } as unknown as ClientEnvelope;
}

describe('frames 活体分档（display 尾巴 / session 落稿）', () => {
  it('start 开流式位 → update 刷尾 → end 落稿换尾（全链帧序）', () => {
    let state = initialAppState;
    state = applyEnvelope(state, display({ type: 'message_start', role: 'assistant' }));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '', streaming: true });
    state = applyEnvelope(
      state,
      display({
        type: 'message_update',
        role: 'assistant',
        partial: { role: 'assistant', content: '你好', timestamp: 1 },
      }),
    );
    expect(state.messages[0]).toMatchObject({ text: '你好', streaming: true });
    state = applyEnvelope(
      state,
      display({
        type: 'message_update',
        role: 'assistant',
        partial: {
          role: 'assistant',
          content: [
            { type: 'text', text: '你' },
            { type: 'text', text: '好' },
          ],
          timestamp: 1,
        },
      }),
    );
    expect(state.messages[0]?.text).toBe('你好'); // 分块数组拼 text 块
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'assistant', content: '你好，世界', timestamp: 2 } }),
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '你好，世界', streaming: false });
  });

  it('无尾巴的 end 直插（投影重置后迟到的成稿不丢）', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '问', timestamp: 3 } }),
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', text: '问', streaming: false });
  });

  it('update 无尾巴自开位（先 update 后 start 的乱序容错）', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      display({
        type: 'message_update',
        role: 'assistant',
        partial: { role: 'assistant', content: '直接来', timestamp: 1 },
      }),
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ text: '直接来', streaming: true });
  });

  it('跨档帧静默丢：session 收 update / display 收 end 均无效果', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      session({ type: 'message_update', role: 'assistant', partial: { content: 'x' } }) as unknown as ClientEnvelope,
    );
    expect(state.messages).toHaveLength(0);
    state = applyEnvelope(
      state,
      display({
        type: 'message_end',
        message: { role: 'assistant', content: 'x', timestamp: 1 },
      }) as unknown as ClientEnvelope,
    );
    expect(state.messages).toHaveLength(0);
  });
});

describe('frames 工具族与状态行', () => {
  it('start/update 走状态行 / end 落正文行并清状态', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    expect(state.status).toBe('⚙ bash …');
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-1', update: '跑' }));
    expect(state.status).toBe('⚙ t-1 …');
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-1', result: {} }));
    expect(state.status).toBeNull();
    expect(state.messages[state.messages.length - 1]).toMatchObject({ role: 'tool', streaming: false });
    expect(state.messages[state.messages.length - 1]?.text).toContain('t-1');
  });

  it('agent_end 清状态行 / agent_start·turn_* 不进正文', () => {
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't', name: 'x', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }));
    expect(state.status).toBeNull();
    state = applyEnvelope(state, display({ type: 'agent_start' }));
    state = applyEnvelope(state, display({ type: 'turn_start', turn: 1 }));
    state = applyEnvelope(state, display({ type: 'turn_end', turn: 1, stopReason: 'end_turn' }));
    expect(state.messages).toHaveLength(0);
  });
});

describe('frames 审批与通知', () => {
  it('asked 入账 dedupe by approvalId / decide 出清', () => {
    let state = initialAppState;
    const entry = { approvalId: 'webui-1', sessionId: 's-1', summary: '装 X' };
    state = applyAsked(state, entry);
    state = applyAsked(state, entry);
    expect(state.approvals).toHaveLength(1);
    state = appliedDecide(state, 'webui-1');
    expect(state.approvals).toHaveLength(0);
  });

  it('notify 滚动帽 5（旧条出清）/ status 直通', () => {
    let state = initialAppState;
    for (let i = 1; i <= 7; i += 1) {
      state = applyEnvelope(state, { kind: 'notify', payload: { message: `通知${i}` } });
    }
    expect(state.notices).toHaveLength(5);
    expect(state.notices[0]?.message).toBe('通知3');
    expect(state.notices[4]?.message).toBe('通知7');
    state = applyEnvelope(state, { kind: 'status', sessionId: 's-1', payload: { status: '跑' } });
    expect(state.status).toBe('跑');
  });
});

describe('frames 投影层（正确性层真源）', () => {
  it('loadedMessages 整段重置——流式尾巴清场', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'message_start', role: 'assistant' }));
    state = loadedMessages(state, [
      { role: 'user', content: '旧问', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: '旧答' }], timestamp: 2 },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages.every((m) => !m.streaming)).toBe(true);
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: '旧答' });
  });

  it('setActiveSession 切换清场 / loadedSessions 清单落座', () => {
    let state = loadedSessions(initialAppState, [{ id: 's-9', title: null, lastActivityAt: 1 }]);
    state = applyEnvelope(state, display({ type: 'message_start', role: 'assistant' }));
    state = setActiveSession(state, 's-9');
    expect(state.activeId).toBe('s-9');
    expect(state.messages).toHaveLength(0);
    expect(state.todo).toBeNull();
    expect(state.sessions).toHaveLength(1);
  });
});

describe('frames textOf 抽取三形', () => {
  it('string 直过 / text 块数组拼接 / 非 text 块跳过 / 坏形回空', () => {
    expect(textOf('直')).toBe('直');
    expect(
      textOf([
        { type: 'text', text: 'a' },
        { type: 'thinking', thinking: '想' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
    expect(textOf(42)).toBe('');
    expect(textOf(null)).toBe('');
    expect(textOf([{ type: 'tool_call', id: 'x' }])).toBe('');
  });
});
