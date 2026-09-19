/**
 * webui/client/components/TierPopover 组件级测试（第九役遗漏扫描批 C8——
 * 2026-09-19）。
 *
 * 锁「选定先收层再回调」序律（TierPopover pick 成功腿 onClose 先于
 * onReceipt——与 TUI theme-picker/thinking-picker「选定先收副屏再回调」件族
 * 同律；07 §4.1 件族序注）。app.test.tsx 集成测只锁终态（receipt 呈现 +
 * 浮层收）不锁序——onClose/onReceipt 是 App 内联 setState 无法从外部记序，
 * 组件级注入记序 spy 是唯一观测位。修前红：序反形（先回调再收层）本测红。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TiersPayload } from '../api.js';
import { TierPopover } from './TierPopover.js';

/** 行集样例（桩——词表/文案单源服务端，样例仅测试形） */
const TIERS: TiersPayload = {
  thinkingLevel: 'medium',
  sandboxMode: 'read-only',
  thinkingLevels: [
    { level: 'off', detail: '关闭思考' },
    { level: 'max', detail: '最大思考' },
  ],
  sandboxModes: [{ mode: 'danger', detail: '无沙箱——任何命令直跑宿主' }],
};

const apiMock = vi.hoisted(() => ({
  getSessionTiers: vi.fn<(sessionId: string) => Promise<TiersPayload>>(),
  setThinkingLevel: vi.fn<(sessionId: string, level: string) => Promise<{ receipt: string }>>(),
  setSandboxMode: vi.fn<(sessionId: string, mode: string) => Promise<{ receipt: string }>>(),
}));

vi.mock('../api.js', () => ({ api: apiMock }));

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getSessionTiers.mockResolvedValue(TIERS);
});

afterEach(() => {
  cleanup();
});

describe('TierPopover 选定序律（件族「先收层再回调」——TUI theme-picker 同律）', () => {
  it('PUT 成功腿：onClose 先于 onReceipt（序探针——修前红：先回调再收层形本断言红）', async () => {
    apiMock.setThinkingLevel.mockResolvedValue({ receipt: '思考档位：max（…）' });
    const order: string[] = [];
    render(
      <TierPopover
        kind="thinking"
        sessionId="s-1"
        onClose={() => {
          order.push('close');
        }}
        onReceipt={() => {
          order.push('receipt');
        }}
        onError={() => undefined}
      />,
    );
    await screen.findByText('最大思考');
    fireEvent.click(screen.getByRole('button', { name: /max/ }));
    await waitFor(() => {
      expect(order).toEqual(['close', 'receipt']); // 序断言（先收层再回调）
    });
  });
});
