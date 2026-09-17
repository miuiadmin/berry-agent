/**
 * webui/client/api 单件直锁（TUI 余量收官批②随批——SPA /export 客户端腿；jsdom 轨）。
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

/**
 * 应答桩（手搓最小 Response 形——jsdom 轨不依赖真 Response 实现）。
 * text 腿：call 折叠腿走 res.text() 再 JSON.parse——桩以 JSON.stringify
 * 回灌（json 缺席时给空串回体，非 JSON 错误形走 jsonThrows 触发折叠分支）。
 */
function resOf(options: { ok: boolean; status: number; blob?: Blob; json?: unknown; jsonThrows?: boolean }): Response {
  return {
    ok: options.ok,
    status: options.status,
    blob: async () => options.blob ?? new Blob([]),
    json: async () => {
      if (options.jsonThrows) throw new SyntaxError('非 JSON 应答');
      return options.json;
    },
    text: async () => JSON.stringify(options.json ?? ''),
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

/**
 * GET tiers 应答样例（与 host 装配面 tiersOf 应答四键形对齐——客户端树
 * 隔离零 host import，本样例即形锁；词表/行文案单源服务端，样例仅桩）。
 */
const TIERS_SAMPLE = {
  thinkingLevel: 'medium',
  sandboxMode: 'read-only',
  thinkingLevels: [
    { level: 'off', detail: '关闭思考' },
    { level: 'medium', detail: '中档思考' },
    { level: 'high', detail: '高投入思考' },
  ],
  sandboxModes: [
    { mode: 'read-only', detail: '只读——写操作被拒' },
    { mode: 'workspace-write', detail: '工作区可写' },
    { mode: 'danger', detail: '无沙箱——任何命令直跑宿主' },
  ],
};

describe('api 档位三函数（/thinking //sandbox webui 受路——2026-09-18 webui 档位面受理批）', () => {
  it('getSessionTiers：GET tiers 端点 :id 代换 + 同源 cookie 携行 + 应答四键直出（JSON 折叠腿）', async () => {
    const fetchMock = vi.fn(async () => resOf({ ok: true, status: 200, json: TIERS_SAMPLE }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await api.getSessionTiers('s-1');
    // 端点词面：GET /api/sessions/:id/tiers（method 缺席 = GET；credentials 同源律）
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s-1/tiers',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(out).toEqual(TIERS_SAMPLE);
  });

  it('setThinkingLevel：PUT thinking-level + 体 {level} + 应答 {receipt} 直出', async () => {
    const fetchMock = vi.fn(async () =>
      resOf({ ok: true, status: 200, json: { receipt: 'thinking 已切 high——下一 run 起生效' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await api.setThinkingLevel('s-1', 'high');
    // 端点词面 + method + 单字符串体形（体 {level}——SubmitSchema 先例形）
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s-1/thinking-level',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ level: 'high' }) }),
    );
    expect(out).toEqual({ receipt: 'thinking 已切 high——下一 run 起生效' });
  });

  it('setSandboxMode：PUT sandbox-mode + 体 {mode} + 应答 {receipt} 直出', async () => {
    const fetchMock = vi.fn(async () =>
      resOf({ ok: true, status: 200, json: { receipt: 'sandbox 已切 danger——即刻生效于后续工具调用' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await api.setSandboxMode('s-1', 'danger');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s-1/sandbox-mode',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: 'danger' }) }),
    );
    expect(out).toEqual({ receipt: 'sandbox 已切 danger——即刻生效于后续工具调用' });
  });

  it('非 2xx 折 ApiError：400 坏词 error 词面优先（THINKING_LEVEL_INVALID 形——HTTP 面不吞码）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: false, status: 400, json: { error: 'thinking_level_invalid' } })),
    );
    await expect(api.setThinkingLevel('s-1', 'ultra')).rejects.toMatchObject({
      status: 400,
      code: 'thinking_level_invalid',
    });
  });

  it('GET tiers 501 形折 ApiError（面未装配——回退 HTTP 状态词防御位）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: false, status: 501, jsonThrows: true })),
    );
    await expect(api.getSessionTiers('s-1')).rejects.toMatchObject({ status: 501, code: 'HTTP_501' });
  });
});

describe('api.workspaceFiles（@ 文件段补全消费腿）', () => {
  it('fetch 形：端点常量 + q encodeURIComponent + 同源 cookie 携行（走 call 折叠腿）', async () => {
    const fetchMock = vi.fn(async () => resOf({ ok: true, status: 200, json: { items: ['@src/'] } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.workspaceFiles('src/ap');
    // 端点词面单源（WEBUI_ENDPOINTS.workspaceFiles）+ query 编码拼装
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/files?q=src%2Fap',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('回体解包：items 逐串直出（引号形整串透传不解包）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: true, status: 200, json: { items: ['@src/', '@"my file.txt"'] } })),
    );
    const out = await api.workspaceFiles('src');
    // 条目 = 整 token 代换单位（含 @ 前缀与引号形）——客户端零路径/引号知识
    expect(out).toEqual(['@src/', '@"my file.txt"']);
  });

  it('空 items 回体：解包为空数组（诚实空不弹层）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: true, status: 200, json: { items: [] } })),
    );
    await expect(api.workspaceFiles('zzz')).resolves.toEqual([]);
  });

  it('非 2xx JSON 折 ApiError：error 词面优先（500 internal 形）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: false, status: 500, json: { error: 'internal' } })),
    );
    await expect(api.workspaceFiles('x')).rejects.toMatchObject({ status: 500, code: 'internal' });
  });

  it('非 2xx 非 JSON 应答回退 HTTP 状态词（502 防御位）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => resOf({ ok: false, status: 502, jsonThrows: true })),
    );
    await expect(api.workspaceFiles('x')).rejects.toBeInstanceOf(ApiError);
    await expect(api.workspaceFiles('x')).rejects.toMatchObject({ code: 'HTTP_502' });
  });
});
