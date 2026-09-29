/**
 * webui/client/components/SessionList 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 纯呈现件四真行为——
 * ① 空清单空态引导文案（固定 UI 文案）
 * ② 有标题呈标题、点击回传 id；无标题诚实回退 id 截断（不造占位串——
 * 与服务端 title: null 语义对齐）
 * ③ 选中态高亮 class 区分（activeId 匹配项深底、余项悬停态）
 * ④ 装载失败空态与真空态分立（十六役补扫 N24——拉不到清单不假声明
 * 「暂无会话」，失败行指路刷新重试）
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionList } from './SessionList.js';

afterEach(() => {
  cleanup();
});

describe('SessionList 清单呈现', () => {
  it('空清单走空态引导（不渲染列表）', () => {
    const onSelect = vi.fn();
    const { container } = render(<SessionList sessions={[]} activeId={null} onSelect={onSelect} />);
    expect(screen.getByText('暂无会话——点「+ 新会话」开一个')).toBeTruthy();
    expect(container.querySelector('ul')).toBeNull(); // 无列表骨架
  });

  it('装载失败空态与真空态分立：失败行在场、空态引导不在场（修前红：失败混同为「暂无会话」假声明）', () => {
    // 装载失败（宿主瞬断/500/代理错）清单为空——呈现失败行指路刷新，
    // 不假声明「暂无会话」（用户可能拥有多个会话）
    const { container } = render(<SessionList sessions={[]} activeId={null} onSelect={vi.fn()} loadFailed />);
    expect(screen.getByText('会话清单加载失败——点上方「刷新」重试')).toBeTruthy();
    expect(screen.queryByText('暂无会话——点「+ 新会话」开一个')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('装载失败但清单非空：旧清单照常呈现（失败旗不遮蔽可用数据）', () => {
    render(
      <SessionList
        sessions={[{ id: 's-1', title: '旧会话', lastActivityAt: 1 }]}
        activeId="s-1"
        onSelect={vi.fn()}
        loadFailed
      />,
    );
    expect(screen.getByText('旧会话')).toBeTruthy();
    expect(screen.queryByText('会话清单加载失败——点上方「刷新」重试')).toBeNull();
  });

  it('有标题呈标题，点击回传该会话 id', () => {
    const onSelect = vi.fn();
    render(
      <SessionList
        sessions={[
          { id: 's-1', title: '一会话', lastActivityAt: 1 },
          { id: 's-2', title: '二会话', lastActivityAt: 2 },
        ]}
        activeId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('二会话'));
    expect(onSelect).toHaveBeenCalledWith('s-2');
    expect(onSelect).not.toHaveBeenCalledWith('s-1');
  });

  it('无标题回退 id 截断呈现（title null 不造占位串）', () => {
    render(
      <SessionList
        sessions={[{ id: 'sess-abcdef1234567890', title: null, lastActivityAt: 1 }]}
        activeId={null}
        onSelect={vi.fn()}
      />,
    );
    // 截断律：id 前 12 字符 + 省略号（与组件头注约定同源）
    expect(screen.getByText('sess-abcdef1…')).toBeTruthy();
  });

  it('选中态高亮 class 只落 activeId 匹配项', () => {
    render(
      <SessionList
        sessions={[
          { id: 's-1', title: '一会话', lastActivityAt: 1 },
          { id: 's-2', title: '二会话', lastActivityAt: 2 },
        ]}
        activeId="s-2"
        onSelect={vi.fn()}
      />,
    );
    const active = screen.getByText('二会话').closest('button')!;
    const idle = screen.getByText('一会话').closest('button')!;
    expect(active.className).toContain('bg-zinc-800');
    expect(idle.className).not.toContain('bg-zinc-800');
  });
});
