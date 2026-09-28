/**
 * webui/client/components/AuthGate 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 换桥面板四真行为（api 模块全桩——vi.mock 到模块位，同 app.test.tsx 桩法）——
 * ① 使能律：token 空「进入」disabled；输入后 enabled；空 token 的 Enter 不发
 * ② 提交通路：点击/Enter → api.auth(token)；在飞期文案「换桥中……」且键锁
 * ③ 桥成腿：resolve → onAuthed 恰调一次
 * ④ 失败腿：reject → 错因分档文案（401/403 = token 不符；其余 = 服务异常）
 *   + busy 复位（键回「进入」可重试）
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from './AuthGate.js';
import { ApiError } from '../api.js';

/* ---------------- api 模块桩（AuthGate 只消费 auth 一腿） ---------------- */

// vi.hoisted：vi.mock 工厂被提升到文件顶——桩本体须同步提升可用
const apiMock = vi.hoisted(() => ({
  auth: vi.fn<(token: string) => Promise<void>>(),
}));

// 桩只覆写 api 面；真源余出口透传（ApiError 类——错误分档 instanceof 判别
// 经真模块单源，测试构造 401/5xx 拒绝形用真类保同一性；app.test.tsx 同形）。
vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

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
    apiMock.auth.mockRejectedValueOnce(new ApiError(401, 'unauthorized'));
    render(<AuthGate onAuthed={vi.fn()} />);
    fireEvent.change(tokenInput(), { target: { value: '错桥' } });
    fireEvent.click(enterButton());
    await screen.findByText('token 不符——请核对后重试');
    // busy 复位：键回「进入」且 enabled——重试路活
    const retry = screen.getByRole('button', { name: '进入' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    apiMock.auth.mockRejectedValueOnce(new ApiError(401, 'unauthorized'));
    fireEvent.click(retry);
    await waitFor(() => {
      expect(apiMock.auth).toHaveBeenCalledTimes(2);
    });
  });

  it('错误分档：403 同归 token 不符话术（拒族）', async () => {
    apiMock.auth.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
    render(<AuthGate onAuthed={vi.fn()} />);
    fireEvent.change(tokenInput(), { target: { value: '拒桥' } });
    fireEvent.click(enterButton());
    await screen.findByText('token 不符——请核对后重试');
  });

  it('错误分档：非 401/403（5xx / 网络断）→ 服务异常话术不误指 token（修前红：一律折叠「token 不符」——错误身份被吞致误诊，用户反复核对一个对的 token）', async () => {
    // 形一：5xx 服务异常（ApiError 携状态）
    apiMock.auth.mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE'));
    render(<AuthGate onAuthed={vi.fn()} />);
    fireEvent.change(tokenInput(), { target: { value: '对的-token' } });
    fireEvent.click(enterButton());
    await screen.findByText('服务暂不可达或内部异常——请检查网络后重试');
    expect(screen.queryByText('token 不符——请核对后重试')).toBeNull(); // 不误指 token
    // busy 复位可重试（分档不影响重试路）
    const retry = screen.getByRole('button', { name: '进入' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    // 形二：网络腿断（fetch 折非 ApiError 形——TypeError 同折服务异常档）
    apiMock.auth.mockRejectedValueOnce(new TypeError('fetch failed'));
    fireEvent.click(retry);
    await screen.findByText('服务暂不可达或内部异常——请检查网络后重试');
    expect(screen.queryByText('token 不符——请核对后重试')).toBeNull();
  });
});
