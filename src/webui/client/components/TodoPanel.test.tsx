/**
 * webui/client/components/TodoPanel 单件直锁（覆盖锁；jsdom 轨）。
 *
 * todo 侧栏三真行为——
 * ① 两空态分立：null = 无数据源 / [] = 空计划（服务端 todoOf 缺席语义透传）
 * ② 四态记号映射：☐ ◐ ☑ ⊙（与 TUI 呈现约定同源）
 * ③ activeForm 优先呈现（缺席回 content）+ 完成/搁置项灰化（视觉分层）
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ViewTodo } from '../frames.js';
import { TodoPanel } from './TodoPanel.js';

afterEach(() => {
  cleanup();
});

describe('TodoPanel 两空态分立', () => {
  it('null 呈「无数据源」；[] 呈「（空）」', () => {
    const { rerender } = render(<TodoPanel todo={null} />);
    expect(screen.getByText('无数据源')).toBeTruthy();
    rerender(<TodoPanel todo={[]} />);
    expect(screen.getByText('（空）')).toBeTruthy();
  });
});

describe('TodoPanel 四态记号', () => {
  it('pending ☐ / in-progress ◐ / completed ☑ / deferred ⊙ 逐条落位', () => {
    const todo: readonly ViewTodo[] = [
      { status: 'pending', content: '待办项' },
      { status: 'in-progress', content: '进行项' },
      { status: 'completed', content: '完成项' },
      { status: 'deferred', content: '搁置项' },
    ];
    const { container } = render(<TodoPanel todo={todo} />);
    // 记号与正文同 li 节点（「{记号} {正文}」双文本子拼整段）——按序整段断言
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['☐ 待办项', '◐ 进行项', '☑ 完成项', '⊙ 搁置项']);
  });

  it('activeForm 优先呈现，缺席回 content', () => {
    const { rerender } = render(<TodoPanel todo={[{ status: 'pending', content: '修门' }]} />);
    expect(screen.getByText('☐ 修门')).toBeTruthy();
    rerender(<TodoPanel todo={[{ status: 'pending', content: '修门', activeForm: '正在修门' }]} />);
    expect(screen.getByText('☐ 正在修门')).toBeTruthy();
    expect(screen.queryByText('☐ 修门')).toBeNull(); // content 让位不重复
  });

  it('完成/搁置项灰化、活跃项常亮（视觉分层 class）', () => {
    render(
      <TodoPanel
        todo={[
          { status: 'in-progress', content: '进行项' },
          { status: 'completed', content: '完成项' },
        ]}
      />,
    );
    expect(screen.getByText('◐ 进行项').closest('li')!.className).toContain('text-zinc-300');
    expect(screen.getByText('☑ 完成项').closest('li')!.className).toContain('text-zinc-600');
  });
});
