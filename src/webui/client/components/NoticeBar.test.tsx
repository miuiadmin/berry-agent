/**
 * webui/client/components/NoticeBar 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 通知浮条四真行为——
 * ① 空清单零占位（渲染 null——非阻塞原语不占正文流）
 * ② 最近一条置顶呈现：早前条不重复呈现，多条时呈「+N 条早前通知」计数
 * ③ 档色映射：level 分档落 class（缺席 = info 档）
 * ④ 关闭键（界面美化役批⑨）：onDismiss 在场呈 × 键点击回传最新条 id，
 * 缺席只读形无键
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ViewNotice } from '../frames.js';
import { NoticeBar } from './NoticeBar.js';

afterEach(() => {
  cleanup();
});

/** 通知条目速造（id 仅折叠器用——呈现面不消费） */
function notice(message: string, level?: string): ViewNotice {
  return { id: Math.random(), message, level };
}

describe('NoticeBar 空态', () => {
  it('空清单渲染 null（container 零子节点）', () => {
    const { container } = render(<NoticeBar notices={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('NoticeBar 最近一条置顶', () => {
  it('多条只呈最后一条 + 早前计数；单条无计数行', () => {
    const { container, rerender } = render(
      <NoticeBar notices={[notice('通知一'), notice('通知二'), notice('通知三')]} />,
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.textContent).toContain('通知三');
    expect(bar.textContent).not.toContain('通知一'); // 早前条不重复占位
    expect(bar.textContent).toContain('（+2 条早前通知）');
    // 单条：无计数行（整段恰为该条正文）
    rerender(<NoticeBar notices={[notice('仅一条')]} />);
    expect((container.firstElementChild as HTMLElement).textContent).toBe('仅一条');
  });
});

describe('NoticeBar 档色映射', () => {
  it('error 档落红底 class；level 缺席回 info 档天蓝底', () => {
    const { container, rerender } = render(<NoticeBar notices={[notice('出错啦', 'error')]} />);
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-red-900/60');
    rerender(<NoticeBar notices={[notice('普通告知')]} />);
    expect((container.firstElementChild as HTMLElement).className).toContain('bg-sky-900/60');
  });
});

describe('NoticeBar 关闭（界面美化役批⑨）', () => {
  it('onDismiss 在场呈 × 键，点击回传最新条 id', () => {
    const onDismiss = vi.fn();
    render(
      <NoticeBar notices={[notice('早一条'), { id: 42, message: '最新条', level: undefined }]} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(42); // 最新条 id（置顶条的出清锚）
  });

  it('onDismiss 缺席只读形无关闭键（App 未接回调不虚呈键）', () => {
    render(<NoticeBar notices={[notice('只读条')]} />);
    expect(screen.queryByRole('button', { name: '关闭通知' })).toBeNull();
    expect(screen.getByText('只读条')).toBeTruthy();
  });
});
