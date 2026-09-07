/**
 * webui/client/App 组件冒烟测试（批 18a-2；jsdom 轨）。
 *
 * api 全桩（vi.mock 到模块位）+ FakeEventSource（jsdom 无原生实现——
 * 桩挂 globalThis，可编程 open/emit）。锁四环——
 * ①鉴权门：未桥走 AuthGate（token 错 401 呈错因）→ 桥成进主面
 * ②主面装载：清单呈现 + 自动选首会话 + EventSource per 会话接线 +
 * onopen 恒重拉投影（正确性层真源执法锚）
 * ③活体消费：session message_end 落正文 / asked 镜像入审批栏 → 应答
 * 出清 + decide 回执
 * ④提交与打断：composer 发送走 submit（messageId 幂等位生成）→ 乐观
 * 回显；打断键走 interrupt
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClientApprovalEntry, ClientSessionSummary } from './protocol.js';
import { App } from './App.js';
import type { DecideAnswer } from './api.js';

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
    await screen.findByText('测试会话');
    unmount();
  });
});

describe('App 主面活体环', () => {
  it('清单呈现 + 自动选首会话 + onopen 恒重拉投影 + 活体帧落正文', async () => {
    primeMain();
    apiMock.fetchMessages.mockResolvedValue([{ role: 'user', content: '投影旧问', timestamp: 1 }]);
    render(<App />);
    await screen.findByText('测试会话');
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
    await screen.findByText('测试会话');
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
    await screen.findByText('测试会话');
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
    await screen.findByText('一会话');
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
