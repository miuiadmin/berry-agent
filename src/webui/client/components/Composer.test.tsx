/**
 * webui/client/components/Composer 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 输入区四真行为——
 * ① 发送键使能律：空/纯空白恒 disabled，有效文本 enabled
 * ② 提交通路：onSubmit 收 trim 后正文且发送后输入框清空（幂等位在 App——
 * 本件零状态外触）
 * ③ 键盘分形：Enter 发送 / Shift+Enter 不发送（换行让位）
 * ④ 打断键直通 onInterrupt
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer.js';

afterEach(() => {
  cleanup();
});

/** 取发送键原生 disabled 态（未装 jest-dom——属性位直读） */
function sendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '发送' }) as HTMLButtonElement;
}

/** 取输入框 */
function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行') as HTMLTextAreaElement;
}

describe('Composer 发送键使能律', () => {
  it('初始空文本 disabled；有效文本 enabled；纯空白仍 disabled', () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    expect(sendButton().disabled).toBe(true);
    fireEvent.change(textarea(), { target: { value: '你好' } });
    expect(sendButton().disabled).toBe(false);
    // 纯空白 trim 后为空——不构成可发送正文
    fireEvent.change(textarea(), { target: { value: '   ' } });
    expect(sendButton().disabled).toBe(true);
  });
});

describe('Composer 提交通路', () => {
  it('点击发送：onSubmit 收 trim 正文 + 输入框清空', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: '  你好呀  ' } });
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledWith('你好呀');
    expect(textarea().value).toBe(''); // 发送后清空（下一问从零起）
  });

  it('Enter 触发发送；Shift+Enter 不发送（换行让位）', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: '第一句' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('第一句');
    expect(textarea().value).toBe('');
  });
});

describe('Composer 打断键', () => {
  it('点击打断直通 onInterrupt（与发送态无关恒可用）', () => {
    const onInterrupt = vi.fn();
    render(<Composer onSubmit={vi.fn()} onInterrupt={onInterrupt} />);
    const interrupt = screen.getByRole('button', { name: '打断' }) as HTMLButtonElement;
    expect(interrupt.disabled).toBe(false); // 空输入也允许打断在飞 run
    fireEvent.click(interrupt);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
