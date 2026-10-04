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
  isReceiptStatus,
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

  it('并行工具 end 不清兄弟在飞状态行：批内先完成者回写兄弟名执行中、仅最后一个 end 清空（修前红：兄弟在飞时空窗）', () => {
    // executeToolBatch 并发 read 段各完成即 emit end（完成序交错）——先完成者
    // 无条件清空状态行而兄弟在飞（read 无进度回调的空窗持续到其 end）
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-a', name: 'read', arguments: {} }),
    );
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-b', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-a', result: {} }));
    expect(state.status).toBe('⚙ bash …'); // 修前红：null——回写兄弟名（最晚启动者）执行中
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-b', result: {} }));
    expect(state.status).toBeNull(); // 账空（最后一个 end）才清空
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
    // 无 agent_start 中途接入形：耗时段诚实缺席、工具段独场——计数是接入点
    // 起算的部分观察值，加注不冒充整 run 口径〔第九轮 laneE2 件3 + 第十轮
    // 定形注词面翻档「接入」〕）
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: RUN_CLOSE_ROLE, streaming: false });
    expect(state.messages[0]?.text).toBe('── 工具 1 次（自本次接入起算） ──');
    state = applyEnvelope(state, display({ type: 'agent_start' }));
    state = applyEnvelope(state, display({ type: 'turn_start', turn: 1 }));
    state = applyEnvelope(state, display({ type: 'turn_end', turn: 1, stopReason: 'end_turn' }));
    // turn_* 不进正文（收尾行不被扰动——长度仍 1）
    expect(state.messages).toHaveLength(1);
  });

  it('agent_end 终态分档：failed 持有不立即揭示 / aborted ⏹ 即时 / completed 归闲态（E1 持有档——TUI 同律翻档）', () => {
    // 07 §4.1 件 6 跨通道同律（TUI 侧 P0 批已修——失败/中止显式呈现不伪装成功）；
    // E1：failed 是持有档非终态——揭示位移到 retry_wait_end {aborted|exhausted}
    //（驱动侧保证 failed 后必随发其一——retry_wait_start（退避窗开）/ retry_wait_end
    // {aborted|exhausted}（终态收口）/ 孤儿 retry_wait_end {resumed}（overflow
    // compacted 续入——07 件 12 扩第三形〔第七轮深扫批，04 §3.4 尾注真源〕；
    // 与 frames.ts E1 持有档注释单源同文——tui-backend.test 同形已随迁）
    let state = applyEnvelope(initialAppState, display({ type: 'agent_end', status: 'failed' }));
    expect(state.status).toBeNull(); // 修前红：'✗ 失败'——持有窗内不闪终态
    state = applyEnvelope(state, display({ type: 'retry_wait_end', outcome: 'exhausted' }));
    expect(state.status).toBe('✗ 失败'); // 揭示位（燃尽/不可重试首败——可无配对 start）
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

  it('失败直呈律 webui 第三位：errorMessage 同句携因（✗ 失败 · 原因——07 §4.1 V-0 注②；揭示位随持有档移至 retry_wait_end）', () => {
    // 修前红锚：裸「✖ 失败」零上下文（与 TUI 双位同律人读化——跨通道同批）；
    // 持有档存因、揭示同句携因（TUI pendingFailReason 同形）
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'agent_end', status: 'failed', errorMessage: '模型渠道未配置（CHANNEL_UNKNOWN）' }),
    );
    expect(state.status).toBeNull(); // 持有窗不揭示
    state = applyEnvelope(state, display({ type: 'retry_wait_end', outcome: 'exhausted' }));
    expect(state.status).toBe('✗ 失败 · 模型渠道未配置（CHANNEL_UNKNOWN）'); // 存账因随揭示同句供位
    // errorMessage 缺席 → 裸形兜底（诚实缺席非虚造）；中途附着错失持有档同裸形
    let bare = applyEnvelope(initialAppState, display({ type: 'agent_end', status: 'failed' }));
    bare = applyEnvelope(bare, display({ type: 'retry_wait_end', outcome: 'aborted' }));
    expect(bare.status).toBe('✗ 失败');
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

  it('status 终态信封复位 run 账（客户端复位机制位——与 agent_end 折叠位两信号之一；发射侧产线形呈拍中〔卡③〕）', () => {
    // 形位：终态词 status 信封直达即复位 run 账（本用例直驱信封所锁 = 客户端
    // 机制位；修前红：终态信封只改 status 行、runActive 恒挂——打断键伪使能
    // 首信号）。发射侧诚实注（第九轮卡③——同服务端 c0ebfd3 勘正孪生）：
    // 受理尾快照现行 setStatus 生产者仅切档回执 + 插件透传，末次帧恰为终态
    // 词的形现产线不可达；run 终态 setStatus 生产者两案呈拍中，落定后本
    // 机制位自然接通
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }));
    expect(state.runActive).toBe(true);
    state = applyEnvelope(state, { kind: 'status', sessionId: 's-1', payload: { status: '⏹ 已中止' } });
    expect(state.status).toBe('⏹ 已中止');
    expect(state.runActive).toBe(false); // 修前红锚：复位 run 账
    expect(state.runStartedAt).toBeNull();
    // 连线形幂等：agent_end 折叠位先清后 status 尾帧再清——双清不复活
    state = applyEnvelope(state, display({ type: 'agent_start' }));
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'aborted' }));
    expect(state.runActive).toBe(false);
    state = applyEnvelope(state, { kind: 'status', sessionId: 's-1', payload: { status: '✗ 失败 · 渠道未配置' } });
    expect(state.runActive).toBe(false);
    expect(state.status).toBe('✗ 失败 · 渠道未配置');
    // 非终态 status（在飞档/档位切换回执——isReceiptStatus 词面单源）不清
    // run 账——中途接入补位信号不误伤
    state = applyEnvelope(state, display({ type: 'agent_start' }));
    state = applyEnvelope(state, { kind: 'status', sessionId: 's-1', payload: { status: '⚙ bash 慢命令 …' } });
    expect(state.runActive).toBe(true);
    expect(state.status).toBe('⚙ bash 慢命令 …');
  });

  it('isReceiptStatus 闭集分类：档位切换回执 true / 进度型与终态 false（run 在飞信号排除半边之二——第九轮 laneE2）', () => {
    // 回执词面真源 = host/session-tier-copy.ts 回执拼装单源（客户端树隔离
    // 不 import host 件——本词面即形锁，改回执模板前缀必同步 isReceiptStatus）；
    // 两发射位（TUI /thinking //sandbox 选档与 webui 桥 PUT 应答尾）经通道核
    // setStatus 扇出同文到达 SPA
    expect(isReceiptStatus('思考级别：high（下一轮对话起生效；该级别是否生效随模型能力）')).toBe(true);
    expect(isReceiptStatus('沙箱模式：danger（即刻生效于后续工具调用）')).toBe(true);
    // 进度型（客户端本造：工具执行/重试呈现）非回执——仍计入在飞信号
    expect(isReceiptStatus('⚙ bash …')).toBe(false);
    expect(isReceiptStatus('重试中 第 2/3 次 …')).toBe(false);
    // 终态非回执（排除归 isTerminalStatus 管——两判据分立）
    expect(isReceiptStatus('⏹ 已中止')).toBe(false);
    expect(isReceiptStatus('✗ 失败 · 渠道未配置')).toBe(false);
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

  it('中途附着（无 agent_start）：耗时段诚实缺席、计数段加注起算口径（工具/重试部分观察值不冒充整 run——第九轮 laneE2 件3）', () => {
    // 页面加载时 run 已在飞——收不到 agent_start；收尾行不虚造耗时
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed' }), T0);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('── 工具 1 次（自本次接入起算） ──'); // 修前红：旧形「工具 1 次」整 run 口径词面
    // 双计数段皆加注 + durationMs 载荷在场不加注（服务端真值即整 run 口径
    // ——耗时段与计数段的口径分立）
    let both = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    );
    both = applyEnvelope(both, display({ type: 'retry_wait_start' }), T0);
    both = applyEnvelope(both, display({ type: 'agent_end', status: 'completed', durationMs: 95_000 }), T0 + 1_000);
    const close = both.messages[both.messages.length - 1]!;
    expect(close.role).toBe(RUN_CLOSE_ROLE);
    expect(close.text).toBe('── 用时 1m 35s · 工具 1 次（自本次接入起算） · 重试 1（自本次接入起算） ──');
  });

  it('中途附着+retry 续入：agent_start 重开观察窗而部分观察旗不清——计数段仍加注（修前红：runStartedAt 判据破口——部分观察冒充整 run 口径）', () => {
    // 第十轮定形注（07 收尾行中途附着加注形）：仅看收尾时刻 runStartedAt
    // 判据不足——retry 续入 agent_start 会重开观察窗（非 null）而 run 级账
    // 不清（附着点起算的部分值）→ 修前判据不含此形 → 不加注冒充整 run 口径。
    // 旗形判据两形皆盖（runStartedAt === null || runCountsPartial）
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
    ); // 中途附着窗计数（runStartedAt=null）——旗置位
    state = applyEnvelope(state, display({ type: 'retry_wait_end', outcome: 'resumed' }), T0);
    state = applyEnvelope(state, display({ type: 'agent_start' }), T0); // 续入——重开观察窗、旗不清
    expect(state.runStartedAt).toBe(T0); // 观察窗确已重开（修前判据由此破）
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed', durationMs: 45_000 }), T0 + 45_000);
    const close = state.messages[state.messages.length - 1]!;
    expect(close.role).toBe(RUN_CLOSE_ROLE);
    // 修前红：'── 用时 45s · 工具 1 次 ──'（不加注——部分观察冒充整 run 口径）
    expect(close.text).toBe('── 用时 45s · 工具 1 次（自本次接入起算） ──');
    // 耗时段不加注维持（durationMs 载荷在场即服务端整 run 真值——口径分立）
    expect(close.text).toContain('用时 45s ·');
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

describe('frames 失败持有档与终态清行（E1/E2——TUI tui-backend 持有档同律）', () => {
  /** 固定钟（now 注入口——持有窗/续入观察窗的确定性测试面） */
  const T0 = 1_700_000_000_000;

  it('agent_end(failed) 持有档：不立即终态化——状态行不闪 ✗、run 账不清、活体窗维持（修前红：✗ 伪终态 + 账全清 + 窗收束）', () => {
    // 退避窗与续入全程 run 仍在跑（TUI「揭示前账不冻结」）：打断键维持使能、
    // 退避窗计时计入 run 时长、失败前工具计数跨窗存活（收尾行整 run 口径）
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
      T0 + 100,
    );
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-1', result: {} }), T0 + 200);
    state = applyEnvelope(
      state,
      display({ type: 'agent_end', status: 'failed', errorMessage: '模型渠道未配置' }),
      T0 + 300,
    );
    expect(state.status).toBeNull(); // 修前红：'✗ 失败 · 模型渠道未配置'——持有窗不揭示
    expect(state.runActive).toBe(true); // 修前红：false——活体窗维持（打断键面）
    expect(state.runToolCount).toBe(1); // 修前红：0——整 run 口径账被清
    expect(state.runStartedAt).toBe(T0); // 修前红：null——观察窗不冻结
  });

  it('重试窗口三路分诊：start 进重试呈现（第 n/N 次） / exhausted 终态揭示携因清账 / aborted 同律（修前红：呈现缺位 + 分诊架空）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(
      state,
      display({ type: 'agent_end', status: 'failed', errorMessage: 'CHANNEL_UNKNOWN' }),
      T0 + 300,
    );
    // ① retry_wait_start：进重试呈现（态③——TUI 呈现形对齐；倒计时未立项，
    // 静态「第 n/N 次」段 + 省略号活体感）
    state = applyEnvelope(state, display({ type: 'retry_wait_start', attempt: 2, maxAttempts: 3 }), T0 + 400);
    expect(state.status).toBe('重试中 第 2/3 次 …'); // 修前红：伪终态驻留不翻档
    expect(state.runRetryCount).toBe(1);
    // ② retry_wait_end(resumed)：撤重试呈现归活体（续入标记供下一 agent_start 消费）
    state = applyEnvelope(state, display({ type: 'retry_wait_end', outcome: 'resumed' }), T0 + 30_000);
    expect(state.status).toBeNull(); // 修前红：伪终态驻留
    expect(state.runActive).toBe(true);
    // ③ retry_wait_end(aborted|exhausted)：终态揭示——✗ 携因（持有档供位）+ run 账收口
    let dying = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    dying = applyEnvelope(
      dying,
      display({ type: 'agent_end', status: 'failed', errorMessage: 'CHANNEL_UNKNOWN' }),
      T0 + 300,
    );
    dying = applyEnvelope(dying, display({ type: 'retry_wait_start', attempt: 3, maxAttempts: 3 }), T0 + 400);
    dying = applyEnvelope(dying, display({ type: 'retry_wait_end', outcome: 'exhausted' }), T0 + 60_000);
    expect(dying.status).toBe('✗ 失败 · CHANNEL_UNKNOWN'); // 揭示位 = retry_wait_end（持有档存因供位）
    expect(dying.runActive).toBe(false); // 揭示即收口
    expect(dying.runRetryCount).toBe(0); // 揭示即清账（跨 run 残账防御）
    expect(dying.runToolCount).toBe(0);
    // 载荷缺席（attempt/maxAttempts 缺席——旧服务端/坏形容错）裸形兜底
    const bare = applyEnvelope(initialAppState, display({ type: 'retry_wait_start' }), T0);
    expect(bare.status).toBe('重试中 …');
  });

  it('resumed 续入整 run 口径：失败前工具计数跨退避存活（收尾行工具段不缺席；修前红：计数清零工具段缺席）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(
      state,
      display({ type: 'tool_execution_start', toolCallId: 't-1', name: 'bash', arguments: {} }),
      T0 + 100,
    );
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-1', result: {} }), T0 + 200);
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'failed' }), T0 + 300);
    state = applyEnvelope(state, display({ type: 'retry_wait_start', attempt: 1, maxAttempts: 2 }), T0 + 400);
    state = applyEnvelope(state, display({ type: 'retry_wait_end', outcome: 'resumed' }), T0 + 30_000);
    state = applyEnvelope(state, display({ type: 'agent_start' }), T0 + 30_000); // 续入——run 级账不清
    expect(state.runToolCount).toBe(1); // 修前红：0（failed agent_end 已清）
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'completed', durationMs: 60_000 }), T0 + 90_000);
    const close = state.messages[state.messages.length - 1]!;
    expect(close.role).toBe(RUN_CLOSE_ROLE);
    expect(close.text).toBe('── 用时 1m 00s · 工具 1 次 · 重试 1 ──'); // 修前红：'── 用时 1m 00s · 重试 1 ──'（工具段缺席）
  });

  it('fresh agent_start 清状态行：终态文案不跨 run 残留（对齐 TUI resetUsage 末句清行腿；修前红：⏹ 驻留新 run）', () => {
    let state = applyEnvelope(initialAppState, display({ type: 'agent_start' }), T0);
    state = applyEnvelope(state, display({ type: 'agent_end', status: 'aborted' }), T0 + 100);
    expect(state.status).toBe('⏹ 已中止');
    state = applyEnvelope(state, display({ type: 'agent_start' }), T0 + 1_000); // 新 run（fresh——无续入标记）
    expect(state.status).toBeNull(); // 修前红：'⏹ 已中止' 跨 run 残留
  });
});

describe('frames 审批投影复位与乐观回显撤回（修复批锁）', () => {
  it('loadedApprovals keyed 对账——异口已决条目连续两拍未见随复拉出清（E4 同族两拍律——第九轮 laneE2）', () => {
    let state = initialAppState;
    state = applyAsked(state, { approvalId: 'ap-1', sessionId: 's-1', summary: '留' });
    state = applyAsked(state, { approvalId: 'ap-2', sessionId: 's-1', summary: '异口已决' });
    // 复拉现行清单仅剩一条：在场条目刷新、未见条目首拍保位（陈响应窗护住
    // 活动审批的代价——异口已决条目迟一拍出清）
    state = loadedApprovals(state, [{ approvalId: 'ap-1', sessionId: 's-1', summary: '留' }]);
    expect(state.approvals.map((a) => a.approvalId)).toEqual(['ap-1', 'ap-2']);
    // 次拍仍未见（服务端现行清单确无——已决/已撤）→ 出清
    state = loadedApprovals(state, [{ approvalId: 'ap-1', sessionId: 's-1', summary: '留' }]);
    expect(state.approvals.map((a) => a.approvalId)).toEqual(['ap-1']);
    // 清单归空（全部已决）→ 同两拍律整段归空
    state = loadedApprovals(state, []);
    state = loadedApprovals(state, []);
    expect(state.approvals).toHaveLength(0);
  });

  it('asked 帧与复拉清单交错窗对账：首拍未见保位、在场刷新即清 miss 账（修前红：陈响应整体覆盖吞 asked 刚建的活动审批）', () => {
    // 场景：run 到达工具审批 → asked 镜像帧入账 → 周期拍的清单响应早于服务
    // 端登记发出（fetch 窗竞速）——不含刚建的审批。修前：后到的清单响应
    // 整体覆盖 state.approvals 吞卡，审批面板丢卡至下一拍（挂起等人审批的
    // 零信号窗）；修后：首拍保位（E4 律——两拍皆缺才撤）
    let state = applyAsked(initialAppState, { approvalId: 'ap-live', sessionId: 's-1', summary: '等人点' });
    state = loadedApprovals(state, []);
    expect(state.approvals.map((a) => a.approvalId)).toEqual(['ap-live']); // 修前红：被吞
    // 在场拍：清单确认在场——刷新形态 + miss 账清（后续未见重新起算非连击）
    state = loadedApprovals(state, [{ approvalId: 'ap-live', sessionId: 's-1', summary: '刷新形' }]);
    expect(state.approvals[0]?.summary).toBe('刷新形');
    state = loadedApprovals(state, []);
    expect(state.approvals.map((a) => a.approvalId)).toEqual(['ap-live']); // miss 账已清——首拍重新起算
    // 连续第二拍未见 → 撤
    state = loadedApprovals(state, []);
    expect(state.approvals).toHaveLength(0);
  });

  it('appliedDecide 后陈清单响应不复活已决审批（已决遮罩——两拍有界；修前红：清单新增径复活成幻影卡且两拍律护住）', () => {
    // 竞窗（第十轮 laneD 件1）：本口 decide → appliedDecide 乐观出清 → decide
    // 前服务端已发出的旧清单响应后至（仍含该审批）——经「清单新增」径复活成
    // 幻影卡，且两拍律护住（首拍保位 + 第二拍才撤）比修前多等一拍消卡。
    // 修形 = 已决遮罩：decide 入账、清单新增径过滤遮罩内 id、每拍 +1 连续
    // 2 拍自撤（陈响应只陈一拍——与 missTicks 同拍数的有界锁）
    let state = applyAsked(initialAppState, { approvalId: 'ap-x', sessionId: 's-1', summary: '本口已决' });
    state = appliedDecide(state, 'ap-x');
    // 第 1 拍：陈清单含已决 id——遮罩拦截不复活（修前红：approvals 含 ap-x）
    state = loadedApprovals(state, [{ approvalId: 'ap-x', sessionId: 's-1', summary: '本口已决' }]);
    expect(state.approvals).toHaveLength(0); // 修前红：1——幻影卡
    // 第 2 拍仍遮（有界两拍——乱序多响应窗防御）
    state = loadedApprovals(state, [{ approvalId: 'ap-x', sessionId: 's-1', summary: '本口已决' }]);
    expect(state.approvals).toHaveLength(0);
    // 第 3 拍：遮罩耗尽自撤——清单新增同 id 正常进入（有界锁归还正常语义；
    // 服务端重发同 id 审批的合法形不被永久吞）
    state = loadedApprovals(state, [{ approvalId: 'ap-x', sessionId: 's-1', summary: '同 id 重发' }]);
    expect(state.approvals.map((a) => a.approvalId)).toEqual(['ap-x']);
    // asked 帧同 id 到达即撤遮罩（保守清位——重发合法形走活体帧径直达）
    let reasked = applyAsked(initialAppState, { approvalId: 'ap-y', sessionId: 's-1', summary: 'y' });
    reasked = appliedDecide(reasked, 'ap-y');
    reasked = applyAsked(reasked, { approvalId: 'ap-y', sessionId: 's-1', summary: '重发 y' });
    expect(reasked.approvals.map((a) => a.approvalId)).toEqual(['ap-y']); // asked 直入（既有律）
    reasked = loadedApprovals(reasked, [{ approvalId: 'ap-y', sessionId: 's-1', summary: '重发 y' }]);
    expect(reasked.approvals).toHaveLength(1); // 在场刷新径——遮罩已撤不干扰
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

describe('frames onopen 交错窗对账（E4——投影整段重置与活体终结帧的竞窗）', () => {
  it('fetch 窗内落稿的终结帧不随投影整段重置抹除（快照未含——m-<ts> 键续接投影尾；修前红：整段抹除长连接不自愈）', () => {
    // 场景：onopen 发起投影拉取（快照不含在飞答案）→ session message_end 先
    // 落稿 → 旧快照响应后落座——session 族无重发，抹除即本连接内永失
    let state = applyEnvelope(initialAppState, display({ type: 'message_start', role: 'assistant' }));
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'assistant', content: '答', timestamp: 200 } }),
    );
    state = loadedMessages(state, [{ role: 'user', content: '问', timestamp: 100 }]);
    expect(state.messages).toHaveLength(2); // 修前红：1——终稿被旧快照抹除
    expect(state.messages[0]).toMatchObject({ role: 'user', text: '问' }); // 投影真源在前
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: '答', streaming: false }); // 更晚帧不抹
  });

  it('快照已含不重复推：同文终结帧让位投影副本（恰一份——(role,text) 多重集对账；数值时间戳键律已退役）', () => {
    let state = applyEnvelope(
      initialAppState,
      session({ type: 'message_end', message: { role: 'assistant', content: '答', timestamp: 200 } }),
    );
    state = loadedMessages(state, [
      { role: 'user', content: '问', timestamp: 100 },
      { role: 'assistant', content: '答', timestamp: 200 },
    ]);
    expect(state.messages).toHaveLength(2); // 恰一份（live 副本让位——投影副本即真源）
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: '答', streaming: false });
  });

  it('回显交错窗：快照未含回显保位 + 配对账保留（镜像后至仍吸收恰一份；修前红：回显被抹 + 账出清致双份）', () => {
    let state = echoedUserMessage(initialAppState, 's-1', '在途', 500);
    state = loadedMessages(state, [{ role: 'assistant', content: '旧答', timestamp: 200 }]);
    expect(state.messages).toHaveLength(2); // 修前红：1——回显被旧快照抹除
    expect(state.messages[1]).toMatchObject({ role: 'user', text: '在途' });
    expect(state.messages[1]?.key).toBe(echoKeyOf(500)); // 保留的是回显位（客户端键）
    expect(state.pendingEchoes).toHaveLength(1); // 修前红：0——账被出清，镜像后至将落双份
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '在途', timestamp: 900 } }),
    );
    expect(state.messages).toHaveLength(2); // 镜像到达仍吸收（恰一份）
    expect(state.pendingEchoes).toHaveLength(0);
  });

  it('快照按文本含回显本体：回显让位投影副本 + 配对账出清（跨钟配对——重连正确性）', () => {
    // 重连形：断线窗内镜像已录制（emit 先于重订阅，帧不至）——快照含同文
    // user 本体（服务端钟 ≠ 回显客户端钟，键律配不上——文本对账补位）
    let state = echoedUserMessage(initialAppState, 's-1', '断线窗', 500);
    state = loadedMessages(state, [{ role: 'user', content: '断线窗', timestamp: 300 }]);
    expect(state.messages).toHaveLength(1); // 让位投影副本（恰一份不双呈）
    expect(state.messages[0]?.key).toBe('p#1');
    expect(state.pendingEchoes).toHaveLength(0); // 账随让位出清（镜像不至）
  });

  it('快照同文多份计数对账：双回显×双份恰两份 p#1/p#2；快照少份计数尽保位（多重集判别锁——退化为布尔集则本用例红）', () => {
    // 第八轮深扫 laneF 件F4：snapTextCounts 是计数 Map（按份数对账）——若
    // 退化为布尔集（无份数账）现测试全绿穿透。双提交同文两腿锁判别力：
    // ①快照含两份——两回显皆让位（投影副本即真源，恰两份键形 p#1/p#2；
    // 「让位即出集」的布尔集形下第二回显保位 → 三份红）；
    // ②快照只含一份——计数尽第二回显保位续接投影尾（恰两份 = 投影副本 +
    // 回显位；「恒让位」的布尔集形下两回显皆让 → 一份红）
    let state = echoedUserMessage(initialAppState, 's-1', '再来一次', 20);
    state = echoedUserMessage(state, 's-1', '再来一次', 21);
    expect(state.messages).toHaveLength(2); // 双回显基底（同文两份在途）
    // ① 快照两份：恰两份、投影键形 p#1/p#2、配对账随让位出清
    const paired = loadedMessages(state, [
      { role: 'user', content: '再来一次', timestamp: 30 },
      { role: 'user', content: '再来一次', timestamp: 31 },
    ]);
    expect(paired.messages).toHaveLength(2);
    expect(paired.messages.map((m) => m.key)).toEqual(['p#1', 'p#2']);
    expect(paired.pendingEchoes).toHaveLength(0);
    // ② 快照一份：计数尽——首回显让位、次回显保位（恰两份 = 投影副本 +
    // 回显位；配对账保留——镜像后至仍吸收恰一份）
    const exhausted = loadedMessages(state, [{ role: 'user', content: '再来一次', timestamp: 30 }]);
    expect(exhausted.messages).toHaveLength(2);
    expect(exhausted.messages.map((m) => m.key)).toEqual(['p#1', echoKeyOf(21)]);
    expect(exhausted.pendingEchoes).toHaveLength(1);
  });

  it('工具终结行交错窗对账：tool-<id> 键——快照未含不抹、已含让位不双份（修前红：终结行随整段重置抹除）', () => {
    let state = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-9', name: 'bash', arguments: {} }),
    );
    state = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-9', result: {} }));
    // 快照不含该 toolResult（记录晚于快照）——live 终结行存活
    state = loadedMessages(state, [{ role: 'user', content: '问', timestamp: 100 }]);
    expect(state.messages.some((m) => m.role === 'tool' && m.text.includes('bash'))).toBe(true); // 修前红：false
    // 同 id 终结帧重复到达（异常重发防御）不二次落行（稳定键幂等位）
    const again = applyEnvelope(state, session({ type: 'tool_execution_end', toolCallId: 't-9', result: {} }));
    expect(again.messages.filter((m) => m.role === 'tool')).toHaveLength(1);
    // 快照含同 toolCallId 的 toolResult——live 行让位投影副本（不双份）
    let dup = applyEnvelope(
      initialAppState,
      display({ type: 'tool_execution_start', toolCallId: 't-9', name: 'bash', arguments: {} }),
    );
    dup = applyEnvelope(dup, session({ type: 'tool_execution_end', toolCallId: 't-9', result: {} }));
    dup = loadedMessages(dup, [
      { role: 'user', content: '问', timestamp: 100 },
      {
        role: 'toolResult',
        toolCallId: 't-9',
        toolName: 'bash',
        content: [{ type: 'text', text: '出' }],
        isError: false,
        timestamp: 150,
      },
    ]);
    expect(dup.messages).toHaveLength(2); // live 行让位（投影 user + toolResult 两份）
    expect(dup.messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('回显吸收后重连对账恰一份（修前红：配对账已闭合 + 两钟域失配——回显行穿透 kept 双份）', () => {
    // 场景：提交 → 回显（客户端构造钟 500）→ 镜像到达被吸收（配对账闭合——
    // pendingEchoes 出清）→ 重连 onopen 重拉投影（快照含本体，durable 追加钟
    // 900 ≠ 500）。修前：回显文本去重前置 pendingEchoes.some(...) 恒假（账已
    // 闭合）+ snapTimestamps 数值全等恒假（构造钟 vs 追加钟两钟域永不相等）
    // → 回显行穿透 kept 与投影副本双份呈现
    let state = echoedUserMessage(initialAppState, 's-1', '你好', 500);
    state = applyEnvelope(
      state,
      session({ type: 'message_end', message: { role: 'user', content: '你好', timestamp: 900 } }),
    );
    expect(state.pendingEchoes).toHaveLength(0); // 镜像已吸收（配对账闭合——夹具自检）
    state = loadedMessages(state, [{ role: 'user', content: '你好', timestamp: 900 }]);
    expect(state.messages.filter((m) => m.role === 'user' && m.text === '你好')).toHaveLength(1); // 修前红：2（p# 投影副本 + m-500 回显行）
  });

  it('toolResult 落稿行对账恰一份（修前红：message_end 落稿行穿透——构造钟 150 ≠ 投影追加钟 152）', () => {
    /** 生产序夹具：start → loop pushAll message_end(toolResult)（构造钟 150 落稿）→ tools-batch tool_execution_end（工具终结行） */
    const liveToolResult = () => {
      let s = applyEnvelope(
        initialAppState,
        display({ type: 'tool_execution_start', toolCallId: 't-9', name: 'bash', arguments: {} }),
      );
      s = applyEnvelope(
        s,
        session({
          type: 'message_end',
          message: {
            role: 'toolResult',
            toolCallId: 't-9',
            content: [{ type: 'text', text: '原始输出' }],
            isError: false,
            timestamp: 150,
          },
        }),
      );
      return applyEnvelope(s, session({ type: 'tool_execution_end', toolCallId: 't-9', result: {} }));
    };
    // 快照含同 toolResult（追加钟 152 ≠ 构造钟 150——两钟域结构性失配，键律
    // 按文本多重集对账）
    let state = loadedMessages(liveToolResult(), [
      { role: 'user', content: '问', timestamp: 100 },
      {
        role: 'toolResult',
        toolCallId: 't-9',
        toolName: 'bash',
        content: [{ type: 'text', text: '原始输出' }],
        isError: false,
        timestamp: 152,
      },
    ]);
    expect(state.messages.filter((m) => m.role === 'toolResult' && m.text === '原始输出')).toHaveLength(1); // 修前红：2（p# 投影副本 + m-150 落稿行）
    expect(state.messages.filter((m) => m.role === 'tool')).toHaveLength(0); // 工具终结行按 toolCallId 对账让位（既有律不回归）
    // 对偶面：快照未含该 toolResult（记录晚于快照）——落稿行 + 工具终结行各恰一份存活
    const late = loadedMessages(liveToolResult(), [{ role: 'user', content: '问', timestamp: 100 }]);
    expect(late.messages.filter((m) => m.role === 'toolResult' && m.text === '原始输出')).toHaveLength(1); // 计数尽保位（快照未含不抹）
    expect(late.messages.filter((m) => m.role === 'tool' && m.key === 'tool-t-9')).toHaveLength(1); // 工具终结行存活恰一
  });

  it('幂等：同场景连续两次对账不重复保留（每次按当次快照重建多重集——旧 kept 行本体已入投影即让位）', () => {
    // message_end 落稿（构造钟 200）→ 首次对账（快照追加钟 250 已含本体——
    // 让位恰一份）→ 二次重拉（同投影）——旧投影行随整段重置让位新视图，落稿
    // 行不再穿透。修前红：首次即双份，且历次 reload 重复保留（旧 kept 行永不
    // 让位——时间戳全等判据对不上追加钟）
    let state = applyEnvelope(
      initialAppState,
      session({ type: 'message_end', message: { role: 'assistant', content: '答', timestamp: 200 } }),
    );
    const projection = [
      { role: 'user', content: '问', timestamp: 100 },
      { role: 'assistant', content: '答', timestamp: 250 },
    ];
    state = loadedMessages(state, projection);
    expect(state.messages.filter((m) => m.role === 'assistant' && m.text === '答')).toHaveLength(1); // 修前红：2
    state = loadedMessages(state, projection);
    expect(state.messages.filter((m) => m.role === 'assistant' && m.text === '答')).toHaveLength(1); // 修前红：仍 2
  });

  it('保留位不误伤：live 行文本不在投影（transient 失败轮 durable 已遮蔽）→ 保位恰一份（error 位随行保留）', () => {
    // transient 失败轮：message_end errorMessage 落稿，durable 侧该轮被遮蔽
    //（occlude）不进投影——多重集计数 0 → 保位（快照未含不抹——既有语义维持，
    // 多重集对账不虚吞在场外行）
    let state = applyEnvelope(
      initialAppState,
      session({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '失败半截' }],
          timestamp: 300,
          errorMessage: 'Provider is not configured: anthropic',
        },
      }),
    );
    state = loadedMessages(state, [{ role: 'user', content: '问', timestamp: 100 }]);
    const survivors = state.messages.filter((m) => m.role === 'assistant' && m.text === '失败半截');
    expect(survivors).toHaveLength(1); // 计数尽保位
    expect(survivors[0]?.error).toBe('Provider is not configured: anthropic'); // error 位随 live 行保留
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
