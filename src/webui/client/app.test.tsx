/**
 * webui/client/App 组件冒烟测试（批 18a-2；jsdom 轨；组件名 WebUiRoot——
 * App 独立词词汇合规退役）。
 *
 * api 全桩（vi.mock 到模块位）+ FakeEventSource（jsdom 无原生实现——
 * 桩挂 globalThis，可编程 open/emit）。锁五环——
 * ①鉴权门：未桥走 AuthGate（token 错 401 呈错因）→ 桥成进主面
 * ②主面装载：清单呈现 + 自动选首会话 + EventSource per 会话接线 +
 * onopen 恒重拉投影（正确性层真源执法锚）
 * ③活体消费：session message_end 落正文 / asked 镜像入审批栏 → 应答
 * 出清 + decide 回执
 * ④提交与打断：composer 发送走 submit（messageId 幂等位生成）→ 乐观
 * 回显；打断键走 interrupt
 * ⑤会话导出：主面导出入口 → exportSession(activeId) → blob 下载锚
 * （文件名 <会话id>-<时间戳>.md——CLI/TUI 落盘形对齐 + object URL 用后回收）；
 * 失败走通知条
 * ⑥用户消息去重单源（webui-face#1）：回显与 kick 种子镜像恰一份 +
 * 在飞提交流式尾不倒置（角色校验 + 续流对位刷新）
 * ⑦运行期凭证失效路由（webui-face#3）：调用面 401 → 回换桥位 + 失效提示
 * ⑧零会话态提交不静默吞（十六役补扫 N6）：先自动开新再提交；失败折通知条
 * ⑨稳态周期复拉（十六役补扫 N22/N23）：跨会话审批可见性 + 清单运行期
 * 刷新（周期拍 + 手动刷新入口）
 * ⑩清单装载失败与空态分立（十六役补扫 N24）：失败行不假声明「暂无会话」
 * ⑪档位面 401 失效路由（十六役补扫 N21）：GET/PUT 401 回换桥位
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientApprovalEntry, ClientSessionSummary } from './protocol.js';
import { WebUiRoot } from './App.js';
import { ApiError, type DecideAnswer, type TiersPayload } from './api.js';

/** 档位读应答样例（与 GET tiers 应答四键形对齐——词表/行文案单源服务端，样例仅桩） */
const TIERS: TiersPayload = {
  thinkingLevel: 'medium',
  sandboxMode: 'read-only',
  thinkingLevels: [
    { level: 'off', detail: '关闭思考' },
    { level: 'medium', detail: '中强度思考' },
    { level: 'high', detail: '高强度思考' },
  ],
  sandboxModes: [
    { mode: 'read-only', detail: '只读——写操作被拒' },
    { mode: 'workspace-write', detail: '工作区可写' },
    { mode: 'danger', detail: '无沙箱——任何命令直跑宿主' },
  ],
};

/* ---------------- api 模块桩 ---------------- */

// vi.hoisted：vi.mock 工厂被提升到文件顶——桩本体必须同步提升可用
// （const 在工厂执行时未初始化 = ReferenceError）。
const apiMock = vi.hoisted(() => ({
  probeAuthed: vi.fn<() => Promise<boolean>>(),
  auth: vi.fn<(token: string) => Promise<void>>(),
  listSessions: vi.fn<() => Promise<{ sessions: readonly ClientSessionSummary[]; total: number }>>(),
  createSession: vi.fn<() => Promise<string>>(),
  fetchMessages: vi.fn<(sessionId: string) => Promise<readonly unknown[]>>(),
  submit: vi.fn<(sessionId: string, text: string, messageId: string) => Promise<void>>(),
  interrupt: vi.fn<(sessionId: string) => Promise<void>>(),
  listApprovals: vi.fn<() => Promise<readonly ClientApprovalEntry[]>>(),
  decide: vi.fn<(approvalId: string, answer: DecideAnswer) => Promise<'applied' | 'superseded'>>(),
  todo: vi.fn<(sessionId: string) => Promise<readonly unknown[] | null>>(),
  exportSession: vi.fn<(sessionId: string) => Promise<Blob>>(),
  // 档位三函数（webui 档位面受理批——TierPopover 消费腿；缺省诚实回
  // 样例行集，clearAllMocks 不除实现同 workspaceFiles 律）
  getSessionTiers: vi.fn<(sessionId: string) => Promise<TiersPayload>>(),
  setThinkingLevel: vi.fn<(sessionId: string, level: string) => Promise<{ receipt: string }>>(),
  setSandboxMode: vi.fn<(sessionId: string, mode: string) => Promise<{ receipt: string }>>(),
  // @ 文件段补全消费腿（hygiene——WebUiRoot 挂点传参闭包踩此面；缺省诚实空
  // 不弹层，实现钉在创建位经 clearAllMocks 不清除）
  workspaceFiles: vi.fn<(query: string) => Promise<readonly string[]>>().mockImplementation(async () => []),
}));

// 桩只覆写 api 面；真源余出口透传（ApiError 类 / isUnauthorized 谓词——401
// 失桥判别经真模块单源，测试构造 401 拒绝形用真类保 instanceof 同一性）。
vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

/* ---------------- FakeEventSource（jsdom 无原生实现） ---------------- */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** 测试驱动位：模拟开流（触发 onopen 重拉投影） */
  open(): void {
    this.onopen?.();
  }

  /** 测试驱动位：注入一帧 */
  emit(env: unknown): void {
    this.onmessage?.({ data: JSON.stringify(env) });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 主面就绪桩（已桥 + 单会话 + 空投影） */
function primeMain(options?: { readonly approvals?: readonly ClientApprovalEntry[] }): void {
  apiMock.probeAuthed.mockResolvedValue(true);
  apiMock.listSessions.mockResolvedValue({ sessions: [{ id: 's-1', title: '测试会话', lastActivityAt: 1 }], total: 1 });
  apiMock.fetchMessages.mockResolvedValue([]);
  apiMock.todo.mockResolvedValue(null);
  apiMock.listApprovals.mockResolvedValue(options?.approvals ?? []);
  // 档位读缺省桩（浮层开即读——无桩测试崩溃防；失败形用 mockRejectedValueOnce 覆写）
  apiMock.getSessionTiers.mockResolvedValue(TIERS);
}

describe('WebUiRoot鉴权门', () => {
  it('未桥走 AuthGate；错 token 呈错因；桥成进主面', async () => {
    apiMock.probeAuthed.mockResolvedValue(false);
    const { unmount } = render(<WebUiRoot />);
    const input = await screen.findByPlaceholderText('一次性 token');
    // 错 token → 401 呈 token 不符错因（真 ApiError 401 形——AuthGate 错误
    // 分档后泛型 Error 落服务异常档，锁须钉回 token 不符档）
    apiMock.auth.mockRejectedValueOnce(new ApiError(401, 'unauthorized'));
    fireEvent.change(input, { target: { value: 'wrong-token' } });
    fireEvent.click(screen.getByRole('button', { name: '进入' }));
    await screen.findByText('token 不符——请核对后重试');
    // 对 token → 桥成进主面
    apiMock.auth.mockResolvedValueOnce(undefined);
    primeMain();
    fireEvent.change(input, { target: { value: 'right-token' } });
    fireEvent.click(screen.getByRole('button', { name: '进入' }));
    await screen.findAllByText('测试会话');
    unmount();
  });
});

describe('WebUiRoot主面活体环', () => {
  it('清单呈现 + 自动选首会话 + onopen 恒重拉投影 + 活体帧落正文', async () => {
    primeMain();
    apiMock.fetchMessages.mockResolvedValue([{ role: 'user', content: '投影旧问', timestamp: 1 }]);
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(FakeEventSource.instances[0]!.url).toBe('/api/sessions/s-1/events');
    // onopen → 重拉投影（正确性层真源——恒重拉执法锚）
    FakeEventSource.instances[0]!.open();
    await screen.findByText('投影旧问');
    expect(apiMock.fetchMessages).toHaveBeenCalledWith('s-1');
    // 活体帧：display update 流式尾 → session end 落稿换尾
    FakeEventSource.instances[0]!.emit({
      kind: 'display',
      sessionId: 's-1',
      payload: { type: 'message_start', role: 'assistant' },
    });
    FakeEventSource.instances[0]!.emit({
      kind: 'display',
      sessionId: 's-1',
      payload: {
        type: 'message_update',
        role: 'assistant',
        partial: { role: 'assistant', content: '流式半句', timestamp: 2 },
      },
    });
    await screen.findByText('流式半句');
    FakeEventSource.instances[0]!.emit({
      kind: 'session',
      sessionId: 's-1',
      payload: { type: 'message_end', message: { role: 'assistant', content: '成稿全句', timestamp: 2 } },
    });
    await screen.findByText('成稿全句');
    expect(screen.queryByText('流式半句')).toBeNull(); // 尾巴被成稿换下
  });

  it('asked 镜像入审批栏 → 应答出清 + decide 回执；superseded 同出清', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    FakeEventSource.instances[0]!.emit({
      kind: 'session',
      sessionId: 's-1',
      payload: { type: 'approval/asked', approvalId: 'webui-1', summary: '装插件 X', reason: '外部源' },
    });
    await screen.findByText('装插件 X');
    apiMock.decide.mockResolvedValueOnce('applied');
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    await waitFor(() => {
      expect(apiMock.decide).toHaveBeenCalledWith('webui-1', 'approve');
    });
    await waitFor(() => {
      expect(screen.queryByText('装插件 X')).toBeNull();
    });
  });

  it('零待审批不渲染右栏、asked 到场即渲染（审批空态缺席化——界面美化役批④）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    // App 级缺席锁：零待审批 → 右栏整不渲染（组件内空态文案「暂无待审批项」
    // 不进 DOM——与组件直测的空态分立；修前恒渲染空栏占宽）
    expect(screen.queryByText('暂无待审批项')).toBeNull();
    FakeEventSource.instances[0]!.emit({
      kind: 'session',
      sessionId: 's-1',
      payload: { type: 'approval/asked', approvalId: 'webui-absence', summary: '装插件 Y' },
    });
    await screen.findByText('装插件 Y');
    expect(screen.getByText('审批（1）')).toBeTruthy();
  });

  it('run 收尾行：工具 run 成功形在场、纯对话轮缺席、取消形在场（界面美化役批⑪）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    // 纯对话轮（工具 ∧ 重试双零）completed：收尾行整行缺席（V-0 注⑥双零判据）
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_start' } });
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_end', status: 'completed' } });
    await waitFor(() => {
      expect(screen.queryByText(/^── .+ ──$/)).toBeNull();
    });
    // 工具 run completed：成功收尾行在场（服务端 durationMs 缺席回退客户端
    // 观察窗——jsdom 同步发射窗毫秒级 → 「0s」整秒档；V-0 注⑥：不设时长门）
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_start' } });
    es.emit({
      kind: 'display',
      sessionId: 's-1',
      payload: { type: 'tool_execution_start', toolCallId: 't-close', name: 'bash' },
    });
    es.emit({ kind: 'session', sessionId: 's-1', payload: { type: 'tool_execution_end', toolCallId: 't-close' } });
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_end', status: 'completed' } });
    await screen.findByText('── 用时 0s · 工具 1 次 ──');
    // 取消形：取消收尾行在场（取消不设纯对话轮缺席——用户主动行为恒有回响）
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_start' } });
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_end', status: 'aborted' } });
    await screen.findByText(/^⏹ 对话已取消——\d{2}:\d{2}$/);
  });

  it('通知浮条可关闭（× 键 → 按 id 出清——界面美化役批⑨）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    FakeEventSource.instances[0]!.emit({ kind: 'notify', payload: { message: '试一条通知', level: 'info' } });
    await screen.findByText('试一条通知');
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    await waitFor(() => {
      expect(screen.queryByText('试一条通知')).toBeNull();
    });
  });

  it('composer 提交（乐观回显 + messageId 生成）与打断键', async () => {
    primeMain();
    apiMock.submit.mockResolvedValue(undefined);
    apiMock.interrupt.mockResolvedValue(undefined);
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    // 闲态打断键禁用（界面美化役批⑧——无在飞 run 诚实呈不可点；修前恒可点的无效键；
    // 未装 jest-dom——disabled 属性位直读）
    expect((screen.getByRole('button', { name: '打断' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '你好呀' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('你好呀'); // 乐观回显（session message_end 形）
    await waitFor(() => {
      expect(apiMock.submit).toHaveBeenCalledWith('s-1', '你好呀', expect.stringMatching(/.+/));
    });
    // 服务端 kick 的 run 启帧（display agent_start）到达——打断键使能
    // （run 在飞判据：活体窗开；提交本身不是使能信号——诚实反映服务端受理）
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    act(() => {
      es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'agent_start' } });
    });
    expect((screen.getByRole('button', { name: '打断' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '打断' }));
    await waitFor(() => {
      expect(apiMock.interrupt).toHaveBeenCalledWith('s-1');
    });
  });

  it('submit 失败撤回乐观回显：未被受理的消息不驻留正文（修前红：catch 只推通知无撤回——幻影驻留至刷新）', async () => {
    primeMain();
    // 桩拟真实服务端失败形（Once 形——不污染后续用例的 submit 桩）
    apiMock.submit.mockRejectedValueOnce(new Error('API 500 internal'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '未被受理的消息' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('未被受理的消息'); // 乐观回显先在场（受理在飞窗）
    // 失败通知落地——撤回与通知同帧生效（通知在场即撤回已完成的判据位）
    await screen.findByText('提交失败——请重试');
    // 未被受理的消息不以已送达形态驻留正文（现红：catch 体只追加 notices）
    expect(screen.queryByText('未被受理的消息')).toBeNull();
  });

  it('会话切换换流（旧流关、新流开）', async () => {
    apiMock.probeAuthed.mockResolvedValue(true);
    apiMock.listSessions.mockResolvedValue({
      sessions: [
        { id: 's-1', title: '一会话', lastActivityAt: 1 },
        { id: 's-2', title: '二会话', lastActivityAt: 2 },
      ],
      total: 2,
    });
    apiMock.fetchMessages.mockResolvedValue([]);
    apiMock.todo.mockResolvedValue(null);
    apiMock.listApprovals.mockResolvedValue([]);
    render(<WebUiRoot />);
    await screen.findAllByText('一会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    fireEvent.click(screen.getByText('二会话'));
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(FakeEventSource.instances[1]!.url).toBe('/api/sessions/s-2/events');
  });
});

describe('WebUiRoot用户消息去重单源（回显与 kick 种子镜像——webui-face#1）', () => {
  it('提交后 kick 种子 user 镜像双帧被吸收：正文恰一份（修前红：回显 + 镜像键异双落两份）', async () => {
    primeMain();
    apiMock.submit.mockResolvedValue(undefined);
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    // EventSource 构造在会话列表渲染之后的异步链里（拉投影 → 开 SSE）——
    // waitFor 守卫防渲染竞速下裸读 undefined（CI macos 单红实录，:154 同形）
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '你好呀' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('你好呀'); // 乐观回显先在场
    // 服务端受理 → driver kick 种子 pushAll：display message_start（user）+
    // session message_end（user 镜像——服务端钟时间戳，与回显客户端钟不同源）。
    // act 包裹令两帧状态更新同步落定（计数断言不因渲染竞速假绿）
    act(() => {
      es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'message_start', role: 'user' } });
      es.emit({
        kind: 'session',
        sessionId: 's-1',
        payload: { type: 'message_end', message: { role: 'user', content: '你好呀', timestamp: 9999999999999 } },
      });
    });
    // 同一消息两源（回显 + 镜像）恰呈现一份——修前两份（键 m-<客户端钟> 与
    // m-<服务端钟> 不同源不互覆，直至下次 onopen 整段重拉才自愈）
    expect(screen.getAllByText('你好呀')).toHaveLength(1);
  });

  it('run 在飞提交：assistant 流式尾不被 user 回显顶替 + 镜像吸收 + 续流对位刷新（终稿序不倒置；修前红：流式尾被顶掉/双份/序倒置）', async () => {
    primeMain();
    apiMock.submit.mockResolvedValue(undefined);
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    // EventSource 构造在会话列表渲染之后的异步链里（拉投影 → 开 SSE）——
    // waitFor 守卫防渲染竞速下裸读 undefined（CI macos 单红实录，:154 同形）
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0]!;
    // a1 流式在飞（run 进行中）
    es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'message_start', role: 'assistant' } });
    es.emit({
      kind: 'display',
      sessionId: 's-1',
      payload: { type: 'message_update', role: 'assistant', partial: { role: 'assistant', content: '半句' } },
    });
    await screen.findByText('半句');
    // 在飞窗提交 q2：回显落 user——不得顶掉 a1 流式尾（修前：user 终稿经
    // 「last.streaming 即换装尾泡」无角色校验直接顶掉 assistant 流式尾）
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '插队问' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('插队问');
    expect(screen.getByText('半句')).toBeDefined(); // 流式尾在位（修前红：被顶掉）
    // q2 种子镜像双帧到达（steer 顶注形同构）——恰一份（act 包裹令计数
    // 断言不因渲染竞速假绿）
    act(() => {
      es.emit({ kind: 'display', sessionId: 's-1', payload: { type: 'message_start', role: 'user' } });
      es.emit({
        kind: 'session',
        sessionId: 's-1',
        payload: { type: 'message_end', message: { role: 'user', content: '插队问', timestamp: 9999999999998 } },
      });
    });
    expect(screen.getAllByText('插队问')).toHaveLength(1);
    expect(screen.getByText('半句')).toBeDefined(); // 镜像吸收不扰动流式尾
    // a1 续流（partial 是完整快照直换）：对位刷新原流式位——不因 q2 插队
    // 自开新泡（修前：尾位非流式即自开新泡，'半句' 冻结残留成双泡）
    act(() => {
      es.emit({
        kind: 'display',
        sessionId: 's-1',
        payload: { type: 'message_update', role: 'assistant', partial: { role: 'assistant', content: '半句成整' } },
      });
    });
    await screen.findByText('半句成整');
    expect(screen.queryByText('半句')).toBeNull(); // 原位刷新（修前红：冻结残留）
    // a1 落稿：对位换装原流式位（修前：直插尾部 → 终稿序倒置 [q1,q2,a1]）
    act(() => {
      es.emit({
        kind: 'session',
        sessionId: 's-1',
        payload: { type: 'message_end', message: { role: 'assistant', content: '半句成整', timestamp: 2 } },
      });
    });
    await waitFor(() => {
      expect(screen.getByText('半句成整')).toBeDefined();
    });
    // 终稿序：a1（终稿）在 q2 前——真序 [a1, q2] 不倒置
    const a1El = screen.getByText('半句成整');
    const q2El = screen.getByText('插队问');
    expect(a1El.compareDocumentPosition(q2El) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});

describe('WebUiRoot运行期凭证失效路由（webui-face#3——401 回换桥位）', () => {
  it('submit 401（宿主重启换 token——旧 cookie 永久失效）→ 回到换桥位 + 失效提示行（修前红：只出通用「提交失败——请重试」条永困）', async () => {
    primeMain();
    apiMock.submit.mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '失桥后首条' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    // 回到换桥位（token 输入框重现）+ 失效提示——按「请重试」提示重试恒 401
    // 永不可能成功（token 每次开面新生成），须换新桥；修前停在主面只出通用条
    await screen.findByPlaceholderText('一次性 token');
    await screen.findByText(/凭证已失效/);
    expect(screen.queryByText('提交失败——请重试')).toBeNull(); // 通用条让位于失效路由
  });
});

describe('WebUiRoot新建会话腿失败处置（全文件唯一裸调用腿收口——错误不静默）', () => {
  it('非 401 失败 → 通知条呈现（修前红：无 catch 静默——点击后无任何反馈）', async () => {
    primeMain();
    apiMock.createSession.mockRejectedValueOnce(new ApiError(500, 'INTERNAL'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    await screen.findByText('新建会话失败——请重试');
  });

  it('401 失效形 → 路由回换桥位 + 失效提示行（修前红：无 catch 不路由——旧 cookie 重试永困主面）', async () => {
    primeMain();
    apiMock.createSession.mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    await screen.findByPlaceholderText('一次性 token');
    await screen.findByText(/凭证已失效/);
  });
});

describe('WebUiRoot审批清单投影复拉（服务端现行 pending 清单即真源）', () => {
  it('复拉整段重置：异口已决条目随复拉出清，幻影卡不驻留（修前红：applyAsked 只增不减）', async () => {
    // 两条现行 pending（审批栏跨会话全量呈现——清单不按会话过滤）
    const kept = { approvalId: 'ap-1', sessionId: 's-1', summary: '仍在场的审批' };
    const decided = { approvalId: 'ap-2', sessionId: 's-1', summary: '异口已决的审批' };
    primeMain({ approvals: [kept, decided] });
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    // 首次 onopen 复拉：两条全入账
    FakeEventSource.instances[0]!.open();
    await screen.findByText('仍在场的审批');
    await screen.findByText('异口已决的审批');
    // 异口决出（另一标签/TUI 先答——服务端 GET /approvals 只回现行未决）→
    // 断线重连 onopen 复拉，现行清单仅剩一条
    apiMock.listApprovals.mockResolvedValue([kept]);
    FakeEventSource.instances[0]!.open();
    // 已决条目随复拉出清（现红：增量合并不移除已消失条目，幻影卡永挂
    // 直至本口点选得 superseded 回执）
    await waitFor(() => {
      expect(screen.queryByText('异口已决的审批')).toBeNull();
    });
    // 现行清单条目保留（整段重置不误伤在场项）
    expect(screen.getByText('仍在场的审批')).toBeDefined();
  });
});

describe('WebUiRoot会话导出腿（SPA /export 客户端消费）', () => {
  it('导出入口在主面：点击 → exportSession(activeId) → blob 下载锚（文件名 <会话id>-<时间戳>.md——CLI/TUI 落盘形对齐）+ object URL 用后回收', async () => {
    primeMain();
    // jsdom 无 URL.createObjectURL 实现（Not implemented）——桩化并回收校验复用
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // 下载锚点击桩化：jsdom 不导航，锚属性即断言面
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    apiMock.exportSession.mockResolvedValue(new Blob(['# 会话'], { type: 'text/markdown' }));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => {
      expect(apiMock.exportSession).toHaveBeenCalledWith('s-1');
    });
    // 下载锚：客户端文件名 + blob object URL + 点击即回收（不留悬挂引用）
    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    // 文件名形：`<会话id>-<ISO 时间戳(:.→-)>.md`——与 CLI `berry sessions
    // export` / TUI `/export` 落盘形对齐（src/host/session-export.ts
    // fileStampOf 同形约定；客户端树隔离不 import host 件，本正则即形锁）
    expect(anchor.download).toMatch(/^s-1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
    expect(anchor.href).toBe('blob:mock-url');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    anchorClick.mockRestore();
  });

  it('导出失败 → 通知条呈现（同提交失败呈现形——错误不静默）', async () => {
    primeMain();
    apiMock.exportSession.mockRejectedValue(new Error('API 404 not_found'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await screen.findByText('导出失败——请重试');
  });
});

describe('WebUiRoot档位受理面（/thinking //sandbox SPA 拦截——webui 档位面受理批）', () => {
  /** 开档位浮层捷径（输入框敲词 + 发送——拦截面测试驱动位） */
  async function openTierPopover(word: string): Promise<void> {
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: word } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
  }

  it('恰零参 /thinking：本地开浮层 + GET tiers(activeId)；不进提交流；当前档 ● 标记恰一行', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    // 浮层在场（头行）+ 挂载即读档（词表/行文案单源服务端直显）
    await screen.findByText('深度思考级别');
    await waitFor(() => {
      expect(apiMock.getSessionTiers).toHaveBeenCalledWith('s-1');
    });
    // 不进提交流（TUI 本地拦截族同归属律——零 submitText 消费）+ 无乐观回显
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(screen.queryByText('/thinking')).toBeNull();
    // 行集呈现（detail 右列直显）+ 当前档标记恰 medium 一行（●——theme-picker 同形）
    await screen.findByText('高强度思考');
    const marked = screen.getAllByRole('button', { name: /●/ });
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('medium');
  });

  it('thinkingLevel 无锚（null 应答）：零 ● 标记不虚标', async () => {
    primeMain();
    apiMock.getSessionTiers.mockResolvedValueOnce({ ...TIERS, thinkingLevel: null });
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高强度思考'); // 行集照常全量（无锚只影响标记位）
    expect(screen.queryAllByRole('button', { name: /●/ })).toHaveLength(0);
  });

  it('带参 /thinking high：词干命中即本地用法错——NoticeBar error + 不提交不开浮层', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking high');
    // 用法错通知（fail-loud——TUI「带参 fail-loud 用法错」同律对齐，零分立；
    // webui 呈现面定名浮层——第九役 U1 勘正「面板」TUI 语）
    await screen.findByText('/thinking 不带参数使用——深度思考级别经浮层选定');
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(apiMock.getSessionTiers).not.toHaveBeenCalled();
    expect(screen.queryByText('深度思考级别')).toBeNull();
  });

  it('空白形带参（tab / 换行分隔——换行 = Shift+Enter 常形）同算词干带参用法错：不提交不开浮层（TUI /\\s+/ 切分同律——修前红：startsWith 空格字面形漏穿透）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    // tab 分隔带参形：词干命中（thinking）+ 空白分隔参数——同用法错不穿透
    await openTierPopover('/thinking\thigh');
    await screen.findByText('/thinking 不带参数使用——深度思考级别经浮层选定');
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(apiMock.getSessionTiers).not.toHaveBeenCalled();
    expect(screen.queryByText('深度思考级别')).toBeNull();
    // 换行分隔带参形（Shift+Enter 插行——webui 输入框独有高频形）同律
    await openTierPopover('/sandbox\ndanger');
    await screen.findByText('/sandbox 不带参数使用——沙箱模式经浮层选定');
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(screen.queryByText('沙箱模式')).toBeNull();
  });

  it('点击行 → setThinkingLevel(activeId, level) → receipt 通知（info 呈现位）→ 浮层收', async () => {
    primeMain();
    apiMock.setThinkingLevel.mockResolvedValueOnce({
      receipt: '思考级别：high（下一轮对话起生效；该级别是否生效随模型能力）',
    });
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高强度思考');
    fireEvent.click(screen.getByRole('button', { name: /high/ }));
    await waitFor(() => {
      expect(apiMock.setThinkingLevel).toHaveBeenCalledWith('s-1', 'high');
    });
    // receipt 呈现（回执文案与 TUI setStatus 同文单源——info 档通知条）
    await screen.findByText('思考级别：high（下一轮对话起生效；该级别是否生效随模型能力）');
    // 浮层收（选定先收层）
    await waitFor(() => {
      expect(screen.queryByText('深度思考级别')).toBeNull();
    });
  });

  it('慢 PUT 在途双击/换行点：恰发一次（在途守卫——提交期行禁用 + pick 早退双防线；第九役 C4）', async () => {
    primeMain();
    // 手动放行桩：点击后 promise 悬停（模拟慢 PUT 在途窗）
    let release!: (value: { receipt: string }) => void;
    apiMock.setThinkingLevel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高强度思考');
    const highRow = screen.getByRole('button', { name: /high/ });
    fireEvent.click(highRow); // 首击发起 PUT（在途窗开启）
    await waitFor(() => {
      expect(apiMock.setThinkingLevel).toHaveBeenCalledTimes(1);
    });
    // 在途窗内：同行再击 + 换行点击（off）——恰一次不重发
    fireEvent.click(highRow);
    fireEvent.click(screen.getByRole('button', { name: /off/ }));
    expect(apiMock.setThinkingLevel).toHaveBeenCalledTimes(1);
    // 放行 → receipt 呈现 + 浮层收（正常收层路径不被守卫影响）
    release({ receipt: '思考级别：high（下一轮对话起生效；该级别是否生效随模型能力）' });
    await screen.findByText('思考级别：high（下一轮对话起生效；该级别是否生效随模型能力）');
    await waitFor(() => {
      expect(screen.queryByText('深度思考级别')).toBeNull();
    });
  });

  it('/sandbox 同构：恰零参开浮层 → 点 danger 行 → setSandboxMode(activeId, danger) → receipt 通知', async () => {
    primeMain();
    apiMock.setSandboxMode.mockResolvedValueOnce({ receipt: '沙箱模式：danger（即刻生效于后续工具调用）' });
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/sandbox');
    await screen.findByText('沙箱模式');
    await waitFor(() => {
      expect(apiMock.getSessionTiers).toHaveBeenCalledWith('s-1');
    });
    // danger 行警示语 = 服务端行文案直显（07 §4.1 钉死措辞在 host 侧文案表——SPA 零硬编码仅呈现）
    await screen.findByText('无沙箱——任何命令直跑宿主');
    fireEvent.click(screen.getByRole('button', { name: /danger/ }));
    await waitFor(() => {
      expect(apiMock.setSandboxMode).toHaveBeenCalledWith('s-1', 'danger');
    });
    await screen.findByText('沙箱模式：danger（即刻生效于后续工具调用）');
    await waitFor(() => {
      expect(screen.queryByText('沙箱模式')).toBeNull();
    });
  });

  it('esc 收浮层（不调 PUT）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('深度思考级别');
    await screen.findByText('高强度思考');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('深度思考级别')).toBeNull();
    });
    expect(apiMock.setThinkingLevel).not.toHaveBeenCalled();
  });

  it('× 键与遮罩点击两收层路同 esc 律：收层且不调 PUT（第九役 C3——全收层路零 PUT 副作用锁）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高强度思考');
    // 路① × 键（aria-label 具名——可及性收层路）
    fireEvent.click(screen.getByRole('button', { name: '关闭浮层' }));
    await waitFor(() => {
      expect(screen.queryByText('深度思考级别')).toBeNull();
    });
    expect(apiMock.setThinkingLevel).not.toHaveBeenCalled();
    // 路② 遮罩点击（fixed 全屏遮罩——界面美化役批⑥后遮罩独立 fixed 定位根，
    // 卡体 absolute bottom-full 锚输入区容器不撞选择器）
    await openTierPopover('/thinking');
    await screen.findByText('高强度思考');
    const mask = document.querySelector('div.fixed.inset-0');
    expect(mask).not.toBeNull();
    fireEvent.click(mask!);
    await waitFor(() => {
      expect(screen.queryByText('深度思考级别')).toBeNull();
    });
    expect(apiMock.setThinkingLevel).not.toHaveBeenCalled();
  });

  it('GET tiers 失败（501/404/500 全折同呈现位）：人读因透传通知条 + 浮层失败行仍可关', async () => {
    primeMain();
    // 桩拟真实服务端 501 应答折形（C7 后 err.message = 服务端信封 message 位
    // 人读因——非 `API 501 not_implemented` 码串；server.ts:490 同文）
    apiMock.getSessionTiers.mockRejectedValueOnce(new Error('级别/模式设置未启用（当前运行形态不含此功能）'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    // 错误人读因透传 onError（NoticeBar error 呈现）——全失败形同呈现位
    await screen.findByText('级别/模式设置未启用（当前运行形态不含此功能）');
    // 浮层失败行 + 关闭键在场（呈现后仍可关）
    await screen.findByText('读取失败');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByText('读取失败')).toBeNull();
    });
    // 失败不缓存死态：重开浮层重发读档（挂载 effect 重跑——第二次走基桩
    // 缺省 TIERS 成功，行集照常呈现；第九役 C6 重开重读锁）
    expect(apiMock.getSessionTiers).toHaveBeenCalledTimes(1);
    await openTierPopover('/thinking');
    await waitFor(() => {
      expect(apiMock.getSessionTiers).toHaveBeenCalledTimes(2);
    });
    expect(apiMock.getSessionTiers).toHaveBeenLastCalledWith('s-1');
    await screen.findByText('高强度思考');
  });

  it('PUT 失败：人读因透传通知条 + 浮层不自动收（可重选可关）', async () => {
    primeMain();
    // 桩拟真实服务端 400 坏词应答折形（C7 后 err.message = message 位人读因
    // ——thinking-level.ts:79 同文；直引号 JSON.stringify 形）
    apiMock.setThinkingLevel.mockRejectedValueOnce(
      new Error('思考级别无效："ultra"（可选值：off / minimal / low / medium / high / xhigh / max）'),
    );
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高强度思考');
    fireEvent.click(screen.getByRole('button', { name: /high/ }));
    await screen.findByText('思考级别无效："ultra"（可选值：off / minimal / low / medium / high / xhigh / max）');
    // 浮层仍在（失败不自动收——可重选可 esc 关）
    expect(screen.getByText('深度思考级别')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('深度思考级别')).toBeNull();
    });
  });

  it('本地通知同帽 5：连发 6 次档位词带参用法错，早前计数至多 +4（修前红：本地推播绕过折叠器帽——计数虚胀 +5）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    for (let i = 0; i < 6; i += 1) {
      fireEvent.change(box, { target: { value: '/thinking high' } });
      fireEvent.click(screen.getByRole('button', { name: '发送' }));
    }
    // 通知条在场（最新一条 = 第 6 次用法错）；帽 5 下早前计数至多 +4
    // （修前 +5——本地推播直追数组绕过帧折叠器 slice(-5)，无界增长）
    await screen.findByText(/条早前通知/);
    expect(screen.queryByText('（+5 条早前通知）')).toBeNull();
    expect(screen.getByText('（+4 条早前通知）')).toBeDefined();
  });
});

describe('WebUiRoot零会话态提交（十六役补扫 N6——输入不静默丢失）', () => {
  /** 零会话态就绪桩（已桥 + 空清单——全新宿主首开 webui 形） */
  function primeZeroSession(): void {
    apiMock.probeAuthed.mockResolvedValue(true);
    apiMock.listSessions.mockResolvedValue({ sessions: [], total: 0 });
    apiMock.fetchMessages.mockResolvedValue([]);
    apiMock.todo.mockResolvedValue(null);
    apiMock.listApprovals.mockResolvedValue([]);
    apiMock.getSessionTiers.mockResolvedValue(TIERS);
  }

  it('零会话态发送：先自动开新会话再提交（serve stdio sessionId 缺席即建同律）——回显在场、SSE 接新会话流（修前红：submit 首行静默 return，输入被清空丢失零反馈）', async () => {
    primeZeroSession();
    apiMock.createSession.mockResolvedValue('s-new');
    apiMock.submit.mockResolvedValue(undefined);
    render(<WebUiRoot />);
    await screen.findByText('暂无会话——点「+ 新会话」开一个'); // 零会话态确认
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '第一条消息' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    // 先开新再提交（Composer 发送即清空——静默吞形下输入不可恢复）
    await waitFor(() => {
      expect(apiMock.createSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(apiMock.submit).toHaveBeenCalledWith('s-new', '第一条消息', expect.stringMatching(/.+/));
    });
    await screen.findByText('第一条消息'); // 乐观回显（用户输入不丢）
    // 活体流随自动选中接线新会话
    await waitFor(() => {
      expect(FakeEventSource.instances.some((s) => s.url === '/api/sessions/s-new/events')).toBe(true);
    });
  });

  it('自动开新失败（非 401）→ 通知条呈现失败因（修前红：静默吞——点击后无任何反馈）', async () => {
    primeZeroSession();
    apiMock.createSession.mockRejectedValueOnce(new ApiError(500, 'INTERNAL'));
    render(<WebUiRoot />);
    await screen.findByText('暂无会话——点「+ 新会话」开一个');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '会丢的消息' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('提交失败——自动开新会话未成功，请重试');
  });

  it('自动开新 401 → 路由回换桥位 + 失效提示（调用面统一律）', async () => {
    primeZeroSession();
    apiMock.createSession.mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED'));
    render(<WebUiRoot />);
    await screen.findByText('暂无会话——点「+ 新会话」开一个');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '失桥态首条' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByPlaceholderText('一次性 token');
    await screen.findByText(/凭证已失效/);
  });
});

describe('WebUiRoot稳态周期复拉（十六役补扫 N22/N23——跨会话审批可见性 + 清单运行期刷新）', () => {
  it('稳态连接期他会话审批可见：周期复拉清单入面板（修前红：清单腿零触发——卡片不出现，他会话 run 无声挂起零信号）', async () => {
    // shouldAdvanceTime：waitFor 轮询与真实异步链在假钟下照常推进
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMain();
      render(<WebUiRoot />);
      await screen.findAllByText('测试会话');
      await waitFor(() => {
        expect(FakeEventSource.instances).toHaveLength(1);
      });
      // 稳态窗（不切会话/无重连）：他会话 s-2 的 run 到达工具审批——活体
      // asked 镜像只扇给订阅该会话的流（无订阅者被丢弃），唯一可见路径 =
      // REST 全量清单周期复拉
      const external = { approvalId: 'ap-x', sessionId: 's-2', summary: '他会话待审批' };
      apiMock.listApprovals.mockResolvedValue([external]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000); // 一拍
      });
      await screen.findByText('他会话待审批');
    } finally {
      vi.useRealTimers();
    }
  });

  it('会话清单运行期刷新：外部开新（SDK 线/他页签/scheduler 无头会话）一拍内出现于侧栏，选中不漂移（修前红：F5 前恒不出现）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMain();
      render(<WebUiRoot />);
      await screen.findAllByText('测试会话');
      // 外部开新（本口零操作）
      apiMock.listSessions.mockResolvedValue({
        sessions: [
          { id: 's-ext', title: '外部新会话', lastActivityAt: 9 },
          { id: 's-1', title: '测试会话', lastActivityAt: 1 },
        ],
        total: 2,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await screen.findByText('外部新会话');
      // activeId 已定——刷新只更新清单不夺选中（流仍是 s-1）
      expect(FakeEventSource.instances.some((s) => s.url === '/api/sessions/s-1/events')).toBe(true);
      expect(FakeEventSource.instances.some((s) => s.url === '/api/sessions/s-ext/events')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('手动刷新入口：点击「刷新」即拉清单（外部开新即时出现——不待周期拍）', async () => {
    primeMain();
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    apiMock.listSessions.mockResolvedValue({
      sessions: [
        { id: 's-1', title: '测试会话', lastActivityAt: 1 },
        { id: 's-2', title: '第二会话', lastActivityAt: 2 },
      ],
      total: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: '刷新会话清单' }));
    await screen.findByText('第二会话');
  });
});

describe('WebUiRoot清单截断披露（B2 SPA total 消费腿——服务端已发 total、客户端首跳丢弃的补消费）', () => {
  it('总数超清单长 → 侧栏注记「N/M 会话（仅显示最近）」；全量已呈现无注记（与 TUI session-picker 同判据）', async () => {
    primeMain();
    // 超窗形：清单 1 条、全量 150（服务端默认最近 100 窗——窗内全量已呈现
    // 时 total = 清单长，此测试构造极端差以锁注记判据本身）
    apiMock.listSessions.mockResolvedValue({
      sessions: [{ id: 's-1', title: '测试会话', lastActivityAt: 1 }],
      total: 150,
    });
    render(<WebUiRoot />);
    await screen.findByText('1/150 会话（仅显示最近）');
    // 全量已呈现（total = 清单长）→ 刷新后注记消失
    apiMock.listSessions.mockResolvedValue({
      sessions: [{ id: 's-1', title: '测试会话', lastActivityAt: 1 }],
      total: 1,
    });
    fireEvent.click(screen.getByRole('button', { name: '刷新会话清单' }));
    await waitFor(() => {
      expect(screen.queryByText(/会话（仅显示最近）/)).toBeNull();
    });
  });
});

describe('WebUiRoot清单装载失败分立（十六役补扫 N24——失败不假声明空态）', () => {
  it('首载失败（非 401）→ 失败行呈现、不假声明「暂无会话」（修前红：失败与空态混同）', async () => {
    apiMock.probeAuthed.mockResolvedValue(true);
    apiMock.listSessions.mockRejectedValueOnce(new ApiError(500, 'INTERNAL'));
    apiMock.fetchMessages.mockResolvedValue([]);
    apiMock.todo.mockResolvedValue(null);
    apiMock.listApprovals.mockResolvedValue([]);
    render(<WebUiRoot />);
    await screen.findByText('会话清单加载失败——点上方「刷新」重试');
    expect(screen.queryByText('暂无会话——点「+ 新会话」开一个')).toBeNull();
  });

  it('刷新重试成功 → 失败行撤、会话入清单（恢复路径页内可达——修前红：注释承诺的手动刷新入口不存在）', async () => {
    apiMock.probeAuthed.mockResolvedValue(true);
    apiMock.listSessions.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE'));
    apiMock.listSessions.mockResolvedValue({
      sessions: [{ id: 's-1', title: '迟到会话', lastActivityAt: 1 }],
      total: 1,
    });
    apiMock.fetchMessages.mockResolvedValue([]);
    apiMock.todo.mockResolvedValue(null);
    apiMock.listApprovals.mockResolvedValue([]);
    render(<WebUiRoot />);
    await screen.findByText('会话清单加载失败——点上方「刷新」重试');
    fireEvent.click(screen.getByRole('button', { name: '刷新会话清单' }));
    // 会话入清单且自动选中（侧栏行 + 详情头行两处呈现——复数查询容两处）
    await screen.findAllByText('迟到会话');
    await waitFor(() => {
      expect(screen.queryByText('会话清单加载失败——点上方「刷新」重试')).toBeNull();
    });
    // 恢复后自动选首会话（activeId 落位——活体流接线整体复活）
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
  });
});

describe('WebUiRoot档位面 401 失效路由（十六役补扫 N21——调用面统一律补面）', () => {
  it('GET tiers 401 → 回换桥位 + 失效提示（修前红：NoticeBar 直显机器串「API 401 HTTP_401」死胡同）', async () => {
    primeMain();
    // 路由级 401 回纯文本非 JSON——foldError 折不出 message 位（真形桩）
    apiMock.getSessionTiers.mockRejectedValueOnce(new ApiError(401, 'HTTP_401'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '/thinking' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByPlaceholderText('一次性 token');
    await screen.findByText(/凭证已失效/);
  });

  it('PUT 切档 401 → 回换桥位 + 失效提示（修前红：同 501/400 折 onError 机器串）', async () => {
    primeMain();
    apiMock.setThinkingLevel.mockRejectedValueOnce(new ApiError(401, 'HTTP_401'));
    render(<WebUiRoot />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '/thinking' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('高强度思考');
    fireEvent.click(screen.getByRole('button', { name: /high/ }));
    await screen.findByPlaceholderText('一次性 token');
    await screen.findByText(/凭证已失效/);
  });
});
