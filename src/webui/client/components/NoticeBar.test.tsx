/**
 * webui/client/components/NoticeBar 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 通知条三真行为——
 * ① 空清单零占位（渲染 null——非阻塞原语不占正文流）
 * ② 最近一条置顶呈现：早前条不重复呈现，多条时呈「+N 条早前通知」计数
 * ③ 档色映射：level 分档落 class（缺席 = info 档）
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
