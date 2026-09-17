/**
 * webui/client/api 单件直锁（mp-5 SPA /export 客户端腿；jsdom 轨）。
 *
 * app.test.tsx 对 api 模块整体 vi.mock——本件补「真身直锁」半边：exportSession
 * 的 fetch 形（端点词面 :id 代换 + 同源 cookie 携行 + blob 直出非 JSON 腿）
 * 与错误折叠两形（JSON error 词面优先 / 非 JSON 回退 HTTP 状态词）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 应答桩（手搓最小 Response 形——jsdom 轨不依赖真 Response 实现） */
function resOf(options: { ok: boolean; status: number; blob?: Blob; json?: unknown; jsonThrows?: boolean }): Response {
  return {
    ok: options.ok,
    status: options.status,
    blob: async () => options.blob ?? new Blob([]),
    json: async () => {
      if (options.jsonThrows) throw new SyntaxError('非 JSON 应答');
      return options.json;
    },
  } as unknown as Response;
}

describe('api.exportSession（SPA /export 消费腿）', () => {
  it('fetch 形：端点 :id 代换 + 同源 cookie 携行 + blob 直出（不走 JSON 折叠腿）', async () => {
    const markdown = new Blob(['# 会话'], { type: 'text/markdown' });
    const fetchMock = vi.fn(async () => resOf({ ok: true, status: 200, blob: markdown }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await api.exportSession('s-1');
    // 端点词面单源代换（WEBUI_ENDPOINTS.sessionExport 的 :id 位）
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s-1/export', { credentials: 'same-origin' });
    expect(out).toBe(markdown);
  });

  it('id 含路径分隔符时 encodeURIComponent 代换（:id 位注入防御）', async () => {
    const fetchMock = vi.fn(async () => resOf({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.exportSession('sess/1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/sess%2F1/export', { credentials: 'same-origin' });
  });

  it('非 2xx 折 ApiError：JSON 应答优先取 error 词面（404 缺席形）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: false, status: 404, json: { error: 'session_not_found' } })),
    );
    await expect(api.exportSession('s-1')).rejects.toMatchObject({
      status: 404,
      code: 'session_not_found',
    });
  });

  it('非 2xx 折 ApiError：非 JSON 应答回退 HTTP 状态词（501 面未装配形）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: false, status: 501, jsonThrows: true })),
    );
    await expect(api.exportSession('s-1')).rejects.toBeInstanceOf(ApiError);
    // 回退词面：HTTP_<status>（服务端 markdown 直出腿的错误应答仍走 JSON 面，
    // 此形锁定回退分支的防御位）
    await expect(api.exportSession('s-1')).rejects.toMatchObject({ code: 'HTTP_501' });
  });
});
