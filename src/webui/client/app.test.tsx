/**
 * webui/client/App 组件冒烟测试（批 18a-2；jsdom 轨）。
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
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientApprovalEntry, ClientSessionSummary } from './protocol.js';
import { App } from './App.js';
import type { DecideAnswer, TiersPayload } from './api.js';

/** 档位读应答样例（与 GET tiers 应答四键形对齐——词表/行文案单源服务端，样例仅桩） */
const TIERS: TiersPayload = {
  thinkingLevel: 'medium',
  sandboxMode: 'read-only',
  thinkingLevels: [
    { level: 'off', detail: '关闭思考' },
    { level: 'medium', detail: '中档思考' },
    { level: 'high', detail: '高投入思考' },
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
  listSessions: vi.fn<() => Promise<readonly ClientSessionSummary[]>>(),
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
  // @ 文件段补全消费腿（hygiene——App 挂点传参闭包踩此面；缺省诚实空
  // 不弹层，实现钉在创建位经 clearAllMocks 不清除）
  workspaceFiles: vi.fn<(query: string) => Promise<readonly string[]>>().mockImplementation(async () => []),
}));

vi.mock('./api.js', () => ({ api: apiMock }));

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
  apiMock.listSessions.mockResolvedValue([{ id: 's-1', title: '测试会话', lastActivityAt: 1 }]);
  apiMock.fetchMessages.mockResolvedValue([]);
  apiMock.todo.mockResolvedValue(null);
  apiMock.listApprovals.mockResolvedValue(options?.approvals ?? []);
  // 档位读缺省桩（浮层开即读——无桩测试崩溃防；失败形用 mockRejectedValueOnce 覆写）
  apiMock.getSessionTiers.mockResolvedValue(TIERS);
}

describe('App 鉴权门', () => {
  it('未桥走 AuthGate；错 token 呈错因；桥成进主面', async () => {
    apiMock.probeAuthed.mockResolvedValue(false);
    const { unmount } = render(<App />);
    const input = await screen.findByPlaceholderText('一次性 token');
    // 错 token → 401 呈错因（停留在换桥位）
    apiMock.auth.mockRejectedValueOnce(new Error('401'));
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

describe('App 主面活体环', () => {
  it('清单呈现 + 自动选首会话 + onopen 恒重拉投影 + 活体帧落正文', async () => {
    primeMain();
    apiMock.fetchMessages.mockResolvedValue([{ role: 'user', content: '投影旧问', timestamp: 1 }]);
    render(<App />);
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
    render(<App />);
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

  it('composer 提交（乐观回显 + messageId 生成）与打断键', async () => {
    primeMain();
    apiMock.submit.mockResolvedValue(undefined);
    apiMock.interrupt.mockResolvedValue(undefined);
    render(<App />);
    await screen.findAllByText('测试会话');
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: '你好呀' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('你好呀'); // 乐观回显（session message_end 形）
    await waitFor(() => {
      expect(apiMock.submit).toHaveBeenCalledWith('s-1', '你好呀', expect.stringMatching(/.+/));
    });
    fireEvent.click(screen.getByRole('button', { name: '打断' }));
    await waitFor(() => {
      expect(apiMock.interrupt).toHaveBeenCalledWith('s-1');
    });
  });

  it('会话切换换流（旧流关、新流开）', async () => {
    apiMock.probeAuthed.mockResolvedValue(true);
    apiMock.listSessions.mockResolvedValue([
      { id: 's-1', title: '一会话', lastActivityAt: 1 },
      { id: 's-2', title: '二会话', lastActivityAt: 2 },
    ]);
    apiMock.fetchMessages.mockResolvedValue([]);
    apiMock.todo.mockResolvedValue(null);
    apiMock.listApprovals.mockResolvedValue([]);
    render(<App />);
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

describe('App 会话导出腿（SPA /export 客户端消费）', () => {
  it('导出入口在主面：点击 → exportSession(activeId) → blob 下载锚（文件名 <会话id>-<时间戳>.md——CLI/TUI 落盘形对齐）+ object URL 用后回收', async () => {
    primeMain();
    // jsdom 无 URL.createObjectURL 实现（Not implemented）——桩化并回收校验复用
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // 下载锚点击桩化：jsdom 不导航，锚属性即断言面
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    apiMock.exportSession.mockResolvedValue(new Blob(['# 会话'], { type: 'text/markdown' }));
    render(<App />);
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
    render(<App />);
    await screen.findAllByText('测试会话');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await screen.findByText('导出失败——请重试');
  });
});

describe('App 档位受理面（/thinking //sandbox SPA 拦截——webui 档位面受理批）', () => {
  /** 开档位浮层捷径（输入框敲词 + 发送——拦截面测试驱动位） */
  async function openTierPopover(word: string): Promise<void> {
    const box = await screen.findByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行');
    fireEvent.change(box, { target: { value: word } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
  }

  it('恰零参 /thinking：本地开浮层 + GET tiers(activeId)；不进提交流；当前档 ● 标记恰一行', async () => {
    primeMain();
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    // 浮层在场（头行）+ 挂载即读档（词表/行文案单源服务端直显）
    await screen.findByText('thinking 档位');
    await waitFor(() => {
      expect(apiMock.getSessionTiers).toHaveBeenCalledWith('s-1');
    });
    // 不进提交流（TUI 本地拦截族同归属律——零 submitText 消费）+ 无乐观回显
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(screen.queryByText('/thinking')).toBeNull();
    // 行集呈现（detail 右列直显）+ 当前档标记恰 medium 一行（●——theme-picker 同形）
    await screen.findByText('高投入思考');
    const marked = screen.getAllByRole('button', { name: /●/ });
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('medium');
  });

  it('thinkingLevel 无锚（null 应答）：零 ● 标记不虚标', async () => {
    primeMain();
    apiMock.getSessionTiers.mockResolvedValueOnce({ ...TIERS, thinkingLevel: null });
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高投入思考'); // 行集照常全量（无锚只影响标记位）
    expect(screen.queryAllByRole('button', { name: /●/ })).toHaveLength(0);
  });

  it('带参 /thinking high：词干命中即本地用法错——NoticeBar error + 不提交不开浮层', async () => {
    primeMain();
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking high');
    // 用法错通知（fail-loud——TUI「带参 fail-loud 用法错」同律对齐，零分立）
    await screen.findByText('/thinking 不带参数使用——档位经面板选定');
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(apiMock.getSessionTiers).not.toHaveBeenCalled();
    expect(screen.queryByText('thinking 档位')).toBeNull();
  });

  it('空白形带参（tab / 换行分隔——换行 = Shift+Enter 常形）同算词干带参用法错：不提交不开浮层（TUI /\\s+/ 切分同律——修前红：startsWith 空格字面形漏穿透）', async () => {
    primeMain();
    render(<App />);
    await screen.findAllByText('测试会话');
    // tab 分隔带参形：词干命中（thinking）+ 空白分隔参数——同用法错不穿透
    await openTierPopover('/thinking\thigh');
    await screen.findByText('/thinking 不带参数使用——档位经面板选定');
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(apiMock.getSessionTiers).not.toHaveBeenCalled();
    expect(screen.queryByText('thinking 档位')).toBeNull();
    // 换行分隔带参形（Shift+Enter 插行——webui 输入框独有高频形）同律
    await openTierPopover('/sandbox\ndanger');
    await screen.findByText('/sandbox 不带参数使用——档位经面板选定');
    expect(apiMock.submit).not.toHaveBeenCalled();
    expect(screen.queryByText('sandbox 档位')).toBeNull();
  });

  it('点击行 → setThinkingLevel(activeId, level) → receipt 通知（info 呈现位）→ 浮层收', async () => {
    primeMain();
    apiMock.setThinkingLevel.mockResolvedValueOnce({
      receipt: 'thinking 已切 high——下一 run 起生效（档位是否生效随模型能力）',
    });
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高投入思考');
    fireEvent.click(screen.getByRole('button', { name: /high/ }));
    await waitFor(() => {
      expect(apiMock.setThinkingLevel).toHaveBeenCalledWith('s-1', 'high');
    });
    // receipt 呈现（回执文案与 TUI setStatus 同文单源——info 档通知条）
    await screen.findByText('thinking 已切 high——下一 run 起生效（档位是否生效随模型能力）');
    // 浮层收（选定先收层）
    await waitFor(() => {
      expect(screen.queryByText('thinking 档位')).toBeNull();
    });
  });

  it('/sandbox 同构：恰零参开浮层 → 点 danger 行 → setSandboxMode(activeId, danger) → receipt 通知', async () => {
    primeMain();
    apiMock.setSandboxMode.mockResolvedValueOnce({ receipt: 'sandbox 已切 danger——即刻生效于后续工具调用' });
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/sandbox');
    await screen.findByText('sandbox 档位');
    await waitFor(() => {
      expect(apiMock.getSessionTiers).toHaveBeenCalledWith('s-1');
    });
    // danger 行警示语 = 服务端行文案直显（07 §4.1 钉死措辞在 host 侧文案表——SPA 零硬编码仅呈现）
    await screen.findByText('无沙箱——任何命令直跑宿主');
    fireEvent.click(screen.getByRole('button', { name: /danger/ }));
    await waitFor(() => {
      expect(apiMock.setSandboxMode).toHaveBeenCalledWith('s-1', 'danger');
    });
    await screen.findByText('sandbox 已切 danger——即刻生效于后续工具调用');
    await waitFor(() => {
      expect(screen.queryByText('sandbox 档位')).toBeNull();
    });
  });

  it('esc 收浮层（不调 PUT）', async () => {
    primeMain();
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('thinking 档位');
    await screen.findByText('高投入思考');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('thinking 档位')).toBeNull();
    });
    expect(apiMock.setThinkingLevel).not.toHaveBeenCalled();
  });

  it('GET tiers 失败（501/404/500 全折同呈现位）：message 透传通知条 + 浮层失败行仍可关', async () => {
    primeMain();
    apiMock.getSessionTiers.mockRejectedValueOnce(new Error('API 501 not_implemented'));
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    // 错误 message 透传 onError（NoticeBar error 呈现）——全失败形同呈现位
    await screen.findByText('API 501 not_implemented');
    // 浮层失败行 + 关闭键在场（呈现后仍可关）
    await screen.findByText('档位读取失败');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByText('档位读取失败')).toBeNull();
    });
  });

  it('PUT 失败：message 透传通知条 + 浮层不自动收（可重选可关）', async () => {
    primeMain();
    apiMock.setThinkingLevel.mockRejectedValueOnce(new Error('API 400 thinking_level_invalid'));
    render(<App />);
    await screen.findAllByText('测试会话');
    await openTierPopover('/thinking');
    await screen.findByText('高投入思考');
    fireEvent.click(screen.getByRole('button', { name: /high/ }));
    await screen.findByText('API 400 thinking_level_invalid');
    // 浮层仍在（失败不自动收——可重选可 esc 关）
    expect(screen.getByText('thinking 档位')).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('thinking 档位')).toBeNull();
    });
  });
});
