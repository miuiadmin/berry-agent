/**
 * webui/client/components/ApprovalPanel 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 审批栏三真行为——
 * ① 空态：标题无计数 + 「暂无待审批项」；多条时标题带计数
 * ② 条目呈现：summary 必呈；reason/toolName 可选行缺席不渲染
 * ③ 三键应答：通过/拒绝/取消 → onDecide(approvalId, approve/reject/cancel)
 * （always 留 CLI 形——SPA 面不呈现自动化键）
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientApprovalEntry } from '../protocol.js';
import { ApprovalPanel } from './ApprovalPanel.js';

afterEach(() => {
  cleanup();
});

/** 审批条目速造（可选行缺席形） */
function entry(
  approvalId: string,
  summary: string,
  extra?: { reason?: string; toolName?: string },
): ClientApprovalEntry {
  return { approvalId, sessionId: 's-1', summary, ...extra };
}

describe('ApprovalPanel 空态与计数', () => {
  it('空清单：标题无计数 + 空态文案', () => {
    render(<ApprovalPanel approvals={[]} onDecide={vi.fn()} />);
    expect(screen.getByText('审批')).toBeTruthy();
    expect(screen.getByText('暂无待审批项')).toBeTruthy();
  });

  it('多条清单标题带计数「审批（2）」', () => {
    render(<ApprovalPanel approvals={[entry('a-1', '装插件一'), entry('a-2', '装插件二')]} onDecide={vi.fn()} />);
    expect(screen.getByText('审批（2）')).toBeTruthy();
  });
});

describe('ApprovalPanel 条目呈现', () => {
  it('summary 必呈；reason/toolName 可选行缺席不渲染', () => {
    const { rerender } = render(<ApprovalPanel approvals={[entry('a-1', '装插件一')]} onDecide={vi.fn()} />);
    expect(screen.getByText('装插件一')).toBeTruthy();
    expect(screen.queryByText(/^工具：/)).toBeNull(); // toolName 缺席——无工具行
    // 补齐可选行：reason + toolName 两行落位
    rerender(
      <ApprovalPanel
        approvals={[entry('a-1', '装插件一', { reason: '外部源', toolName: 'bash' })]}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('外部源')).toBeTruthy();
    expect(screen.getByText('工具：bash')).toBeTruthy();
  });
});

describe('ApprovalPanel 三键应答', () => {
  it('通过/拒绝/取消各回传对应频值（within 限定条目域）', () => {
    const onDecide = vi.fn();
    render(<ApprovalPanel approvals={[entry('a-1', '装插件一')]} onDecide={onDecide} />);
    const item = screen.getByText('装插件一').closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: '通过' }));
    expect(onDecide).toHaveBeenCalledWith('a-1', 'approve');
    fireEvent.click(within(item).getByRole('button', { name: '拒绝' }));
    expect(onDecide).toHaveBeenCalledWith('a-1', 'reject');
    fireEvent.click(within(item).getByRole('button', { name: '取消' }));
    expect(onDecide).toHaveBeenCalledWith('a-1', 'cancel');
    // SPA 面不呈现自动化键（always 留 CLI 形）
    expect(within(item).queryByRole('button', { name: '总是允许' })).toBeNull();
  });

  it('多条目各答各的（id 不串门）', () => {
    const onDecide = vi.fn();
    render(<ApprovalPanel approvals={[entry('a-1', '装插件一'), entry('a-2', '装插件二')]} onDecide={onDecide} />);
    const second = screen.getByText('装插件二').closest('li')!;
    fireEvent.click(within(second).getByRole('button', { name: '通过' }));
    expect(onDecide).toHaveBeenCalledWith('a-2', 'approve');
    expect(onDecide).not.toHaveBeenCalledWith('a-1', 'approve');
  });
});
