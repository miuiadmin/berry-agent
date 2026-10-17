/**
 * webui/client/components/SessionHeader 单件直锁（覆盖锁；jsdom 轨）。
 *
 * SPA /export 客户端腿的呈现半边三真行为——
 * ① 有标题呈标题（悬停 title 属性挂全文/全 id）
 * ② 无标题诚实回退 id 截断呈现（title null 不造占位串——SessionList
 *    截断律同源）
 * ③ 导出键点击回传 onExport（纯呈现件零 IO——下载编舞在 App）
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionHeader } from './SessionHeader.js';

afterEach(() => {
  cleanup();
});

describe('SessionHeader 会话详情头行', () => {
  it('有标题呈标题（悬停 title 属性同挂）', () => {
    render(<SessionHeader title="排查记录" sessionId="s-1" onExport={vi.fn()} />);
    expect(screen.getByText('排查记录')).toBeTruthy();
    // 悬停全文：title 属性挂原值（截断呈现的悬停补偿——文档句兑现锚）
    expect(screen.getByTitle('排查记录')).toBeTruthy();
  });

  it('无标题回退 id 截断呈现（title null 不造占位串）', () => {
    render(<SessionHeader title={null} sessionId="sess-abcdef1234567890" onExport={vi.fn()} />);
    // 截断律：id 前 12 字符 + 省略号（与 SessionList 约定同源）
    expect(screen.getByText('sess-abcdef1…')).toBeTruthy();
    // 悬停全 id：回退形 title 属性挂完整 id（非截断串）
    expect(screen.getByTitle('sess-abcdef1234567890')).toBeTruthy();
  });

  it('导出键点击回传 onExport（本件零 IO）', () => {
    const onExport = vi.fn();
    render(<SessionHeader title="一会话" sessionId="s-1" onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
