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
 * ⑥ 修复批锁：审批投影复拉整段重置（loadedApprovals）/ 本地推播与
 * notify 帧腿同帽（pushedNotice）/ 乐观回显撤回对偶（echoKeyOf +
 * droppedMessage——键同源不靠位置）
 */
import { describe, expect, it } from 'vitest';

import type { ClientEnvelope } from './protocol.js';
import {
  appliedDecide,
  applyAsked,
  applyEnvelope,
  droppedMessage,
  echoKeyOf,
  initialAppState,
  loadedApprovals,
  loadedMessages,
  loadedSessions,
  pushedNotice,
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

  it('message_end errorMessage 落稿进 error 位（P0 错误块判据的 SPA 消费半边——修前零消费）', () => {
    let state = applyEnvelope(
      initialAppState,
      session({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '半截' }],
          timestamp: 5,
          errorMessage: 'Provider is not configured: anthropic',
        },
      }),
    );
    // 正文半截 + 错误位并存（错误块分列呈现——与 TUI 错误块同律）
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '半截', streaming: false });
    expect(state.messages[0]?.error).toBe('Provider is not configured: anthropic');
    // 无 errorMessage 形不落位（缺省无 error 字段——不渲染空错误块）
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '问', timestamp: 6 } }),
    );
    expect(state.messages[1]?.error).toBeUndefined();
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

  it('agent_end 终态分档：failed ✖ / aborted ⏹ / completed 归闲态（修前不分 status 恒闲态伪收场）', () => {
    // 07 §4.1 件 6 跨通道同律（TUI 侧 P0 批已修——失败/中止显式呈现不伪装成功）
    let state = applyEnvelope(initialAppState, display({ type: 'agent_end', status: 'failed' }));
    expect(state.status).toBe('✖ 失败');
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'aborted' }));
    expect(state.status).toBe('⏹ 已中止');
    // completed 归闲态（成功不占状态行——SPA v1 无用量尾注面）
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }));
    expect(state.status).toBeNull();
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

  it('pushedNotice 与 notify 帧腿同帽 5——本地推播第 6 条滚动出清最旧（修前五处直追数组绕帽）', () => {
    let state = initialAppState;
    for (let i = 1; i <= 6; i += 1) {
      state = pushedNotice(state, `本地通知${i}`, 'error');
    }
    expect(state.notices).toHaveLength(5);
    expect(state.notices[0]?.message).toBe('本地通知2'); // 最旧一条出清
    expect(state.notices[4]?.message).toBe('本地通知6');
    // 帧腿与本地腿同执法位（同帽同形——id 序与 level 透传两形一致）
    const mixed = applyEnvelope(pushedNotice(initialAppState, '本地一条', 'info'), {
      kind: 'notify',
      payload: { message: '帧一条', level: 'warn' },
    });
    expect(mixed.notices).toHaveLength(2);
    expect(mixed.notices[0]).toMatchObject({ message: '本地一条', level: 'info' });
    expect(mixed.notices[1]).toMatchObject({ message: '帧一条', level: 'warn', id: 2 });
  });
});

describe('frames 审批投影复位与乐观回显撤回（修复批锁）', () => {
  it('loadedApprovals 整段重置——异口已决条目随复拉出清（applyAsked 只增不减径仅留活体帧）', () => {
    let state = initialAppState;
    state = applyAsked(state, { approvalId: 'ap-1', sessionId: 's-1', summary: '留' });
    state = applyAsked(state, { approvalId: 'ap-2', sessionId: 's-1', summary: '异口已决' });
    // 复拉现行清单仅剩一条 → 幻影条目出清、在场条目保留
    state = loadedApprovals(state, [{ approvalId: 'ap-1', sessionId: 's-1', summary: '留' }]);
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]?.approvalId).toBe('ap-1');
    // 清单归空（全部已决）→ 整段重置至空
    expect(loadedApprovals(state, []).approvals).toHaveLength(0);
  });

  it('echoKeyOf 与 message_end 落稿键同源；droppedMessage 按键撤回不误伤后续帧', () => {
    // 乐观回显（数值时间戳键位）——键同源即撤回定位锚成立判据
    let state = applyEnvelope(initialAppState, {
      kind: 'session',
      sessionId: 's-1',
      payload: { type: 'message_end', message: { role: 'user', content: '乐观回显', timestamp: 42 } },
    });
    expect(state.messages[0]?.key).toBe(echoKeyOf(42));
    // 撤回前有后续帧追加（撤回不靠尾部位置——中位过滤）
    state = applyEnvelope(state, {
      kind: 'session',
      sessionId: 's-1',
      payload: { type: 'message_end', message: { role: 'assistant', content: '后续帧', timestamp: 43 } },
    });
    state = droppedMessage(state, echoKeyOf(42));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('后续帧');
    // 撤回键不在场 = 无操作（幂等防御——重复撤回不炸）
    expect(droppedMessage(state, 'm-404').messages).toHaveLength(1);
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

  it('loadedMessages 投影同源 error 位（断线重拉错误块不丢——与落稿两路同源律）', () => {
    const state = loadedMessages(initialAppState, [
      { role: 'assistant', content: [], timestamp: 1, errorMessage: '输出被上下文窗口截断' },
    ]);
    expect(state.messages[0]?.error).toBe('输出被上下文窗口截断');
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
