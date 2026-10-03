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
  dismissNotice,
  droppedMessage,
  echoKeyOf,
  echoedUserMessage,
  initialAppState,
  loadedApprovals,
  loadedMessages,
  loadedSessions,
  pushedNotice,
  RUN_CLOSE_ROLE,
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

  it('user 终稿不顶替 assistant 流式尾（角色校验——run 在飞提交序倒置根因；修前红：异角色流式尾被 user 终稿直接换装顶掉）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'message_start', role: 'assistant' }));
    state = applyEnvelope(
      state,
      display({ type: 'message_update', role: 'assistant', partial: { role: 'assistant', content: '流式中' } }),
    );
    expect(state.messages).toHaveLength(1);
    // run 在飞时提交：user 终稿（乐观回显走同型 session message_end）到达——
    // 直插不换装异角色流式尾（修前红：messages 只剩 1 条 user，assistant 尾被顶掉）
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '插队', timestamp: 9 } }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '流式中', streaming: true });
    expect(state.messages[1]).toMatchObject({ role: 'user', text: '插队', streaming: false });
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
  it('start/update 走状态行 / end 落正文行并清状态（update/end 按工具名呈现——修前红：退化为 toolCallId）', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    expect(state.status).toBe('⚙ bash …');
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-1', update: '跑' }));
    // update 帧只携 toolCallId——start 的 id→名映射按名呈现（TUI tool-progress
    // -panel 同律；修前红：`⚙ t-1 …` 机器不透明 id）
    expect(state.status).toBe('⚙ bash …');
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-1', result: {} }));
    expect(state.status).toBeNull();
    expect(state.messages[state.messages.length - 1]).toMatchObject({ role: 'tool', streaming: false });
    // 终结行按名呈现（修前红：`⚙ 工具 t-1 执行完成` 常驻不可辨）
    expect(state.messages[state.messages.length - 1]?.text).toContain('bash');
    expect(state.messages[state.messages.length - 1]?.text).not.toContain('t-1');
    // 终结出账：同 id 迟到 update 映射缺席回退 id（有界 + 防御位）
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-1', update: '迟' }));
    expect(state.status).toBe('⚙ t-1 …');
  });

  it('update/end 先于 start（乱序/重连丢 start）：映射缺席回退 toolCallId 不炸', () => {
    let state = initialAppState;
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-x', update: '早' }));
    expect(state.status).toBe('⚙ t-x …');
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-x', result: {} }));
    expect(state.messages[state.messages.length - 1]?.text).toContain('t-x');
  });

  it('多工具并发：各自 id→名映射不串（end 只出账自己）', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-a', name: 'read', arguments: {} }),
    );
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-b', name: 'bash', arguments: {} }),
    );
    expect(state.status).toBe('⚙ bash …'); // 状态行随最新 start
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-a', update: '读' }));
    expect(state.status).toBe('⚙ 读取文件 …'); // t-a 映射仍在场 + 映射族名走 toolFaceZh（修前红：`⚙ read …` 英文直呈）
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-a', result: {} }));
    expect(state.messages[state.messages.length - 1]?.text).toContain('读取文件');
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-b', update: '跑' }));
    expect(state.status).toBe('⚙ bash …'); // t-b 不被 t-a 的 end 出账误伤
  });

  it('工具名中文化（V-0 注⑤跨通道对端）：映射族名走 toolFaceZh、集外名直呈兜底', () => {
    let state = initialAppState;
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-zh', name: 'agent', arguments: {} }),
    );
    expect(state.status).toBe('⚙ 子代理 …'); // 修前红：`⚙ agent …` 英文直呈
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-zh', result: {} }));
    expect(state.messages[state.messages.length - 1]?.text).toBe('⚙ 子代理 执行完成'); // 修前红：`⚙ 工具 agent 执行完成`
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-plug', name: 'my-plugin-tool', arguments: {} }),
    );
    expect(state.status).toBe('⚙ my-plugin-tool …'); // 集外名（插件）不虚译——注册名直呈
  });

  it('终结行失败分档：result.isError=true → 「执行失败」，isError/result 缺席 → 「执行完成」（修前红：恒「执行完成」失败工具伪收场）', () => {
    // 失败判据 = 工具结果 isError（TUI 三态卡 ✓/✗/⏹ 同源位——跨通道同律）；
    // 载荷 result 在场携 isError:true → 终态行换失败语气词（详情走 assistant
    // errorMessage 轨，终态行不塞详情）
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-err', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(
      state,
      session({ type: 'tool_execution_end', toolCallId: 't-err', result: { isError: true } }),
    );
    expect(state.messages[state.messages.length - 1]?.text).toBe('⚙ bash 执行失败'); // 修前红：`⚙ bash 执行完成`
    // isError 缺席（false 形）按成功呈现——错误标记是数据契约位非默认位
    state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-ok', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(
      state,
      session({ type: 'tool_execution_end', toolCallId: 't-ok', result: { isError: false } }),
    );
    expect(state.messages[state.messages.length - 1]?.text).toBe('⚙ bash 执行完成');
    // result 整体缺席（旧服务端/坏形容错）同按成功呈现——可选位向后兼容
    state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-bare', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-bare' }));
    expect(state.messages[state.messages.length - 1]?.text).toBe('⚙ bash 执行完成');
  });

  it('会话切换清工具名映射（旧会话 id 不污染新会话）', () => {
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    state = setActiveSession(state, 's-2');
    state = applyEnvelope(state, display({ type: 'tool_execution_update', toolCallId: 't-1', update: '迟' }));
    expect(state.status).toBe('⚙ t-1 …'); // 映射已清——回退 id
  });

  it('agent_end 清状态行 / agent_start·turn_* 不进正文（工具 run 成功形落收尾行——中途无起点耗时段缺席）', () => {
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't', name: 'x', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }));
    expect(state.status).toBeNull();
    // 工具 run 成功终态 → run 收尾行瞬时追加（run_close 角色——非对话消息；
    // 无 agent_start 中途附着形：耗时段诚实缺席、工具段独场——修前红旧形时刻段独场）
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: RUN_CLOSE_ROLE, streaming: false });
    expect(state.messages[0]?.text).toBe('── 工具 1 次 ──');
    state = applyEnvelope(state, display({ type: 'agent_start' }));
    state = applyEnvelope(state, display({ type: 'turn_start', turn: 1 }));
    state = applyEnvelope(state, display({ type: 'turn_end', turn: 1, stopReason: 'end_turn' }));
    // turn_* 不进正文（收尾行不被扰动——长度仍 1）
    expect(state.messages).toHaveLength(1);
  });

  it('agent_end 终态分档：failed ✗ / aborted ⏹ / completed 归闲态（修前不分 status 恒闲态伪收场）', () => {
    // 07 §4.1 件 6 跨通道同律（TUI 侧 P0 批已修——失败/中止显式呈现不伪装成功）
    let state = applyEnvelope(initialAppState, display({ type: 'agent_end', status: 'failed' }));
    expect(state.status).toBe('✗ 失败');
    expect(state.messages).toHaveLength(0); // 失败终态无收尾行（错误块本体呈现）
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'aborted' }));
    expect(state.status).toBe('⏹ 已中止');
    expect(state.messages).toHaveLength(1); // 取消形收尾行在场
    expect(state.messages[0]?.text).toMatch(/^⏹ 对话已取消——\d{2}:\d{2}$/);
    // completed 归闲态（成功不占状态行——SPA v1 无用量尾注面）；纯对话轮
    // （run 内零工具活动）成功收尾行整行缺席
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }));
    expect(state.status).toBeNull();
    expect(state.messages).toHaveLength(1);
  });

  it('失败直呈律 webui 第三位：errorMessage 同句携因（✗ 失败 · 原因——07 §4.1 V-0 注②）', () => {
    // 修前红锚：裸「✖ 失败」零上下文（与 TUI 双位同律人读化——跨通道同批）
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'agent_end', status: 'failed', errorMessage: '模型渠道未配置（CHANNEL_UNKNOWN）' }),
    );
    expect(state.status).toBe('✗ 失败 · 模型渠道未配置（CHANNEL_UNKNOWN）');
    // errorMessage 缺席 → 裸形兜底（诚实缺席非虚造）
    state = applyEnvelope(initialAppState, display({ type: 'agent_end', status: 'failed' }));
    expect(state.status).toBe('✗ 失败');
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

  it('dismissNotice 按 id 出清一条、幂等（界面美化役批⑨——通知关闭的折叠器腿）', () => {
    let state = pushedNotice(initialAppState, '第一条', 'info');
    state = pushedNotice(state, '第二条', 'error');
    expect(state.notices).toHaveLength(2);
    const firstId = state.notices[0]!.id;
    state = dismissNotice(state, firstId);
    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]).toMatchObject({ message: '第二条', level: 'error' }); // 出清的是所指条
    // id 不在场幂等无操作（重复关闭/陈旧 id 不炸）
    state = dismissNotice(state, firstId);
    expect(state.notices).toHaveLength(1);
  });
});

describe('frames run 收尾行（界面美化役批⑪ + V-0 注⑥对端翻形——07 §4.1 收尾行条款 webui 腿）', () => {
  /** 固定钟（now 注入口——观察窗/时刻段的确定性测试面） */
  const T0 = 1_700_000_000_000;

  it('成功形：「── 用时 1m 30s · 工具 1 次 ──」（时刻段退役）；耗时回退位 = 客户端观察窗', () => {
    // 种子回显（客户端钟 T0-5s）→ run 开（T0）→ 工具活动 → 成功终态（T0+90s）
    let state = echoedUserMessage(initialAppState, 's-1', '跑个工具', T0 - 5_000);
    state = applyEnvelope(state, display({ type: 'agent_start' }), T0);
    expect(state.runActive).toBe(true); // 活体窗开
    expect(state.runSeedAt).toBe(T0 - 5_000); // 种子 = 最近 user 消息时刻（取消形锚——成功形不消费）
    expect(state.runStartedAt).toBe(T0);
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }), T0 + 90_000);
    expect(state.runActive).toBe(false); // 活体窗收束
    expect(state.messages).toHaveLength(2); // 回显 + 收尾行
    const close = state.messages[state.messages.length - 1]!;
    expect(close.role).toBe(RUN_CLOSE_ROLE);
    // 耗时 = 观察窗 90s（服务端 durationMs 缺席回退位）；修前红：旧形「─ 用时 … · HH:MM ─」时刻段在场
    expect(close.text).toBe('── 用时 1m 30s · 工具 1 次 ──');
  });

  it('时长门废：<60s 短 run 也呈耗时段（不设 ≤60s 门——V-0 注⑥）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }), T0 + 30_000);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('── 用时 30s · 工具 1 次 ──'); // 修前红：旧形 <60s 省时段
  });

  it('纯对话轮（工具 ∧ 重试双零）成功收尾行整行缺席', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(state, display({ type: 'message_start', role: 'assistant' }), T0 + 100);
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'assistant', content: '纯答', timestamp: T0 + 200 } }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }), T0 + 120_000);
    expect(state.messages).toHaveLength(1); // 只有 assistant 落稿——收尾行缺席
  });

  it('重试计数与段缺席形：retry_wait_start 计数、续入不清（整 run 口径）、工具零省「工具」段', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'failed' }), T0 + 1_000);
    state = applyEnvelope(state, display({ type: 'retry_wait_start' }), T0 + 1_000); // 客户端视界只收型名（计数面）
    expect(state.runRetryCount).toBe(1); // 修前红：帧形未被消费（未知帧静默忽略——计数恒 0）
    state = applyEnvelope(state, display({ type: 'retry_wait_end', outcome: 'resumed' }), T0 + 30_000);
    state = applyEnvelope(state, display({ type: 'agent_start' }), T0 + 30_000); // 续入——run 级账不清
    expect(state.runRetryCount).toBe(1); // 修前红：重开窗清账
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed', durationMs: 45_000 }), T0 + 45_000);
    const close = state.messages[state.messages.length - 1]!;
    expect(close.role).toBe(RUN_CLOSE_ROLE);
    expect(close.text).toBe('── 用时 45s · 重试 1 ──'); // 重试独场：工具段缺席（修前红：纯对话轮判据整行缺席）
  });

  it('取消形不受纯对话轮判据约束：零工具 abort 也呈「⏹ 对话已取消——HH:MM」', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'aborted' }), T0 + 1_000);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toMatch(/^⏹ 对话已取消——\d{2}:\d{2}$/);
  });

  it('durationMs 载荷压观察窗（A-3 唯一真源——整 run 口径不因重试重开窗缩水）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    // 观察窗仅 1s，但载荷声明整 run 95s（重试续跑重开窗的回退位只覆末次尝试）
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed', durationMs: 95_000 }), T0 + 1_000);
    expect(state.messages[0]?.text).toBe('── 用时 1m 35s · 工具 1 次 ──');
  });

  it('中途附着（无 agent_start）：耗时段诚实缺席、工具段独场行仍落', () => {
    // 页面加载时 run 已在飞——收不到 agent_start；收尾行不虚造耗时
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }), T0);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('── 工具 1 次 ──'); // 修前红：旧形时刻段独场
  });

  it('瞬时追加位：loadedMessages 投影重置即清（不落投影、回放不可见）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }), T0 + 90_000);
    expect(state.messages.some((m) => m.role === RUN_CLOSE_ROLE)).toBe(true);
    state = loadedMessages(state, [{ role: 'user', content: '投影正文', timestamp: 1 }]);
    expect(state.messages.some((m) => m.role === RUN_CLOSE_ROLE)).toBe(false); // 随重置消散
    expect(state.messages).toHaveLength(1);
  });

  it('种子链三源：回显客户端钟 / 投影末条 user 服务端钟 / 镜像落稿服务端钟', () => {
    // 源① 乐观回显（echoedUserMessage 客户端钟）
    let echo = echoedUserMessage(initialAppState, 's-1', '问一', T0 - 1_000);
    echo = applyEnvelope(echo, display({ type: 'agent_start' }), T0);
    expect(echo.runSeedAt).toBe(T0 - 1_000);
    // 源② 投影拉取（loadedMessages——中途附着/重连的种子锚）
    let projected = loadedMessages(initialAppState, [{ role: 'user', content: '投影问', timestamp: T0 - 2_000 }]);
    projected = applyEnvelope(projected, display({ type: 'agent_start' }), T0);
    expect(projected.runSeedAt).toBe(T0 - 2_000);
    // 源③ 镜像落稿（session message_end 服务端钟——回显被吸收形后仍续供种子）
    let mirrored = applyEnvelope(initialAppState, {
      kind: 'session',
      sessionId: 's-1',
      payload: { type: 'message_end', message: { role: 'user', content: '镜像问', timestamp: T0 - 3_000 } },
    });
    mirrored = applyEnvelope(mirrored, display({ type: 'agent_start' }), T0);
    expect(mirrored.runSeedAt).toBe(T0 - 3_000);
  });

  it('会话切换整段清 run 窗（旧会话观察窗不污染新会话收尾行）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = setActiveSession(state, 's-2');
    expect(state.runActive).toBe(false);
    expect(state.runStartedAt).toBeNull();
    expect(state.runSeedAt).toBeNull();
    expect(state.runToolCount).toBe(0); // 修前红：字段名随计数化翻档（原 runSawTools 旗）
    expect(state.runRetryCount).toBe(0);
    expect(state.lastUserAt).toBeNull();
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

describe('frames 回显/镜像去重单源（webui-face#1 修复批锁）', () => {
  it('echoedUserMessage 入账 → 同会话同文镜像吸收（正文恰一份 + 账目出清 + 空流式泡出清）', () => {
    let state = echoedUserMessage(initialAppState, 's-1', '你好', 100);
    expect(state.messages).toHaveLength(1);
    expect(state.pendingEchoes).toHaveLength(1);
    // 镜像双帧（pushAll 相邻发射）：display start 开空流式泡 + session end 镜像
    state = applyEnvelope(state, display({ type: 'message_start', role: 'user' }));
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '你好', timestamp: 999 } }),
    );
    expect(state.messages).toHaveLength(1); // 恰一份（回显保留、镜像与空泡吸收）
    expect(state.messages[0]).toMatchObject({ role: 'user', text: '你好', streaming: false });
    expect(state.messages[0]?.key).toBe(echoKeyOf(100)); // 保留的是回显（客户端键）
    expect(state.pendingEchoes).toHaveLength(0);
  });

  it('无配对面时同文镜像正常落正文（投影历史/他口同文不误吞）', () => {
    // 投影历史同文消息在场 + 无 pending → 镜像直插不吸收
    let state = loadedMessages(initialAppState, [{ role: 'user', content: '同文', timestamp: 1 }]);
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '同文', timestamp: 2 } }),
    );
    expect(state.messages).toHaveLength(2);
  });

  it('配对账会话域隔离：他会话同文镜像不吸收（跨会话残留不误吞）', () => {
    let state = echoedUserMessage(initialAppState, 's-1', '跨会话同文', 10);
    // s-2 的同文镜像（他口提交）到达——不吸收 s-1 的待配对账目
    const other = applyEnvelope(state, {
      kind: 'session',
      sessionId: 's-2',
      payload: { type: 'message_end', message: { role: 'user', content: '跨会话同文', timestamp: 11 } },
    } as ClientEnvelope);
    expect(other.messages).toHaveLength(2); // 镜像正常落正文
    expect(other.pendingEchoes).toHaveLength(1); // s-1 账目不被他会话消耗
    // s-1 自己的镜像仍能配对
    const own = applyEnvelope(
      other,
      session({ type: 'message_end', message: { role: 'user', content: '跨会话同文', timestamp: 12 } }),
    );
    expect(own.messages).toHaveLength(2); // 吸收不追加（恰回显 + 他会话镜像两份）
    expect(own.pendingEchoes).toHaveLength(0);
  });

  it('同文双提交 FIFO 配对（两次回显两次镜像各恰一份不串账）', () => {
    let state = echoedUserMessage(initialAppState, 's-1', '再来一次', 20);
    state = echoedUserMessage(state, 's-1', '再来一次', 21);
    expect(state.messages).toHaveLength(2);
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '再来一次', timestamp: 30 } }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.pendingEchoes).toHaveLength(1);
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '再来一次', timestamp: 31 } }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.pendingEchoes).toHaveLength(0);
  });

  it('submit 失败撤回出账 → 迟到镜像正常落正文（服务端已受理形不零份）', () => {
    let state = echoedUserMessage(initialAppState, 's-1', '会失败', 40);
    state = droppedMessage(state, echoKeyOf(40));
    expect(state.messages).toHaveLength(0);
    expect(state.pendingEchoes).toHaveLength(0); // 账目随撤回出清
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '会失败', timestamp: 41 } }),
    );
    expect(state.messages).toHaveLength(1); // 镜像正常落正文
  });

  it('在飞插队后流式对位回溯（streamingSlotOf——update/end 刷原位不顶异角色）', () => {
    // [assistant 流式尾] → 插队 user 回显 → assistant update 应刷 index 0 非自开
    let state = applyEnvelope(initialAppState, display({ type: 'message_start', role: 'assistant' }));
    state = applyEnvelope(
      state,
      display({ type: 'message_update', role: 'assistant', partial: { role: 'assistant', content: '半句' } }),
    );
    state = echoedUserMessage(state, 's-1', '插队', 50);
    expect(state.messages).toHaveLength(2);
    // 插队后的续流：回溯定位 index 0 的流式位原位刷新（不自开第三条）
    state = applyEnvelope(
      state,
      display({ type: 'message_update', role: 'assistant', partial: { role: 'assistant', content: '半句成整' } }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '半句成整', streaming: true });
    expect(state.messages[1]).toMatchObject({ role: 'user', text: '插队' });
    // assistant 终稿同样回溯换装 index 0（终稿序不倒置——[q1, a1, q2] 保序）
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'assistant', content: '半句成整', timestamp: 51 } }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '半句成整', streaming: false });
  });

  it('异角色流式位不越位：user update 在 assistant 流式位在场时自开新位', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'message_start', role: 'assistant' }));
    state = applyEnvelope(
      state,
      display({ type: 'message_update', role: 'assistant', partial: { role: 'assistant', content: '答中' } }),
    );
    // user 侧流（异角色）不得刷 assistant 尾——自开新位
    state = applyEnvelope(
      state,
      display({ type: 'message_update', role: 'user', partial: { role: 'user', content: '插问' } }),
    );
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ role: 'assistant', text: '答中', streaming: true });
    expect(state.messages[1]).toMatchObject({ role: 'user', text: '插问', streaming: true });
  });

  it('会话切换出清配对账（旧会话在飞回显不污染新会话）', () => {
    let state = echoedUserMessage(initialAppState, 's-1', '切走前', 60);
    state = setActiveSession(state, 's-2');
    expect(state.pendingEchoes).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
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
