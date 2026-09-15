/**
 * webui/client/components/AuthGate 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 换桥面板四真行为（api 模块全桩——vi.mock 到模块位，同 app.test.tsx 桩法）——
 * ① 使能律：token 空「进入」disabled；输入后 enabled；空 token 的 Enter 不发
 * ② 提交通路：点击/Enter → api.auth(token)；在飞期文案「换桥中……」且键锁
 * ③ 桥成腿：resolve → onAuthed 恰调一次
 * ④ 失败腿：reject → 错因文案 + busy 复位（键回「进入」可重试）
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from './AuthGate.js';

/* ---------------- api 模块桩（AuthGate 只消费 auth 一腿） ---------------- */

// vi.hoisted：vi.mock 工厂被提升到文件顶——桩本体须同步提升可用
const apiMock = vi.hoisted(() => ({
  auth: vi.fn<(token: string) => Promise<void>>(),
}));

vi.mock('../api.js', () => ({ api: apiMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

/** 取进入键（文案随 busy 态切换——两词面都收） */
function enterButton(): HTMLButtonElement {
  return (screen.queryByRole('button', { name: '进入' }) ??
    screen.getByRole('button', { name: '换桥中……' })) as HTMLButtonElement;
}

/** token 输入框 */
function tokenInput(): HTMLInputElement {
  return screen.getByPlaceholderText('一次性 token') as HTMLInputElement;
}

describe('AuthGate 使能律', () => {
  it('token 空进入键 disabled；输入后 enabled；空值 Enter 不发', () => {
    render(<AuthGate onAuthed={vi.fn()} />);
    expect(enterButton().disabled).toBe(true);
    // 空值 Enter：submit 守卫直接回——auth 不触
    fireEvent.keyDown(tokenInput(), { key: 'Enter' });
    expect(apiMock.auth).not.toHaveBeenCalled();
    fireEvent.change(tokenInput(), { target: { value: 'tok-1' } });
    expect(enterButton().disabled).toBe(false);
  });
});

describe('AuthGate 提交通路', () => {
  it('点击进入：auth 收 token；在飞期「换桥中……」且键锁', async () => {
    // 受控 Promise——在飞期观测点（busy 态）由测试驱动收口
    let resolveAuth: (() => void) | undefined;
    apiMock.auth.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAuth = resolve;
        }),
    );
    render(<AuthGate onAuthed={vi.fn()} />);
    fireEvent.change(tokenInput(), { target: { value: 'tok-9' } });
    fireEvent.click(enterButton());
    expect(apiMock.auth).toHaveBeenCalledWith('tok-9');
    // 在飞期：文案切「换桥中……」且 disabled（重复提交不可达）
    const busy = screen.getByRole('button', { name: '换桥中……' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    resolveAuth!();
  });

  it('Enter 键等效提交（auth 收 token）', async () => {
    apiMock.auth.mockResolvedValue(undefined);
    render(<AuthGate onAuthed={vi.fn()} />);
    fireEvent.change(tokenInput(), { target: { value: 'tok-e' } });
    fireEvent.keyDown(tokenInput(), { key: 'Enter' });
    await waitFor(() => {
      expect(apiMock.auth).toHaveBeenCalledWith('tok-e');
    });
  });
});

describe('AuthGate 桥成与失败腿', () => {
  it('resolve → onAuthed 恰调一次', async () => {
    apiMock.auth.mockResolvedValue(undefined);
    const onAuthed = vi.fn();
    render(<AuthGate onAuthed={onAuthed} />);
    fireEvent.change(tokenInput(), { target: { value: '对桥' } });
    fireEvent.click(enterButton());
    await waitFor(() => {
      expect(onAuthed).toHaveBeenCalledTimes(1);
    });
  });

  it('reject → 错因文案 + busy 复位可重试（再点击再发）', async () => {
    apiMock.auth.mockRejectedValueOnce(new Error('401'));
    render(<AuthGate onAuthed={vi.fn()} />);
    fireEvent.change(tokenInput(), { target: { value: '错桥' } });
    fireEvent.click(enterButton());
    await screen.findByText('token 不符——请核对后重试');
    // busy 复位：键回「进入」且 enabled——重试路活
    const retry = screen.getByRole('button', { name: '进入' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    apiMock.auth.mockRejectedValueOnce(new Error('401'));
    fireEvent.click(retry);
    await waitFor(() => {
      expect(apiMock.auth).toHaveBeenCalledTimes(2);
    });
  });
});
