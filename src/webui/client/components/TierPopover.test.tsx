/**
 * webui/client/components/TierPopover 组件级测试（第九役遗漏扫描批 C8——
 * 2026-09-19；十六役补扫 N21 增 401 失效路由锁）。
 *
 * 锁两族——
 * ①「选定先收层再回调」序律（TierPopover pick 成功腿 onClose 先于
 * onReceipt——与 TUI theme-picker/thinking-picker「选定先收副屏再回调」件族
 * 同律；07 §4.1 件族序注）。app.test.tsx 集成测只锁终态（receipt 呈现 +
 * 浮层收）不锁序——onClose/onReceipt 是 App 内联 setState 无法从外部记序，
 * 组件级注入记序 spy 是唯一观测位。修前红：序反形（先回调再收层）本测红。
 * ②GET/PUT 401 失效路由（webui-face#3 调用面统一律——十六役补扫 N21）：
 * 死 cookie 重试恒不可能自愈——onAuthLost 路由回换桥位，机器码串
 * （`API 401 HTTP_401`——路由级 401 回纯文本非 JSON，foldError 折不出
 * message 位）不进通知条。修前红：401 与 501/404 同折 onError。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type TiersPayload } from '../api.js';
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

// 桩只覆写 api 面；isUnauthorized 谓词与 ApiError 类走真模块（401 判别
// instanceof 同一性——app.test.tsx 同律）。
vi.mock('../api.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getSessionTiers.mockResolvedValue(TIERS);
});

afterEach(() => {
  cleanup();
});

describe('TierPopover 选定序律（件族「先收层再回调」——TUI theme-picker 同律）', () => {
  it('PUT 成功腿：onClose 先于 onReceipt（序探针——修前红：先回调再收层形本断言红）', async () => {
    apiMock.setThinkingLevel.mockResolvedValue({ receipt: '思考级别：max（…）' });
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
        onAuthLost={() => undefined}
      />,
    );
    await screen.findByText('最大思考');
    fireEvent.click(screen.getByRole('button', { name: /max/ }));
    await waitFor(() => {
      expect(order).toEqual(['close', 'receipt']); // 序断言（先收层再回调）
    });
  });
});

describe('TierPopover 401 失效路由（webui-face#3 调用面统一律——十六役补扫 N21）', () => {
  it('GET tiers 401：onAuthLost 路由，机器码串不进 onError（修前红：401 折 onError 呈「API 401 HTTP_401」）', async () => {
    // 路由级 401 回纯文本非 JSON——foldError 后 message 缺省码串（真形桩）
    apiMock.getSessionTiers.mockRejectedValueOnce(new ApiError(401, 'HTTP_401'));
    const onAuthLost = vi.fn();
    const onError = vi.fn();
    render(
      <TierPopover
        kind="thinking"
        sessionId="s-1"
        onClose={() => undefined}
        onReceipt={() => undefined}
        onError={onError}
        onAuthLost={onAuthLost}
      />,
    );
    await waitFor(() => {
      expect(onAuthLost).toHaveBeenCalledTimes(1);
    });
    expect(onError).not.toHaveBeenCalled(); // 机器码串不进通知条
  });

  it('PUT 401：onAuthLost 路由，onError 不收机器码串（修前红：同 501/400 折 onError）', async () => {
    apiMock.setThinkingLevel.mockRejectedValueOnce(new ApiError(401, 'HTTP_401'));
    const onAuthLost = vi.fn();
    const onError = vi.fn();
    render(
      <TierPopover
        kind="thinking"
        sessionId="s-1"
        onClose={() => undefined}
        onReceipt={() => undefined}
        onError={onError}
        onAuthLost={onAuthLost}
      />,
    );
    await screen.findByText('最大思考');
    fireEvent.click(screen.getByRole('button', { name: /max/ }));
    await waitFor(() => {
      expect(onAuthLost).toHaveBeenCalledTimes(1);
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
