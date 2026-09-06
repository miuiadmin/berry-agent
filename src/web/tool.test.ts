/**
 * fetch 工具件测试——schema 收紧 + 服务包装面（isError 数据面/元信息头拼装/
 * consumer 与 signal 透传）。服务本体零 mock 重打——桩停在 WebFetchService
 * 注入位（工具件与服务的分界即注桩位）。
 */
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { BaseError } from '../contracts/index.js';
import { createFetchTool } from './tool.js';
import type { WebFetchInit, WebFetchResponse, WebFetchService } from './types.js';

/** 服务桩工厂：捕获完整入参、按脚本回放应答/异常 */
function stubService(
  script: Array<WebFetchResponse | Error>,
  calls?: Array<{ url: string; init: WebFetchInit }>,
): WebFetchService {
  let index = 0;
  return {
    async fetch(url, init = {}) {
      calls?.push({ url, init });
      const next = script[index];
      index += 1;
      if (next === undefined) throw new Error(`服务桩脚本耗尽（第 ${index} 次调用无应答）`);
      if (next instanceof Error) throw next;
      return { ...next, url };
    },
  };
}

describe('参数 schema（管道段 1 消费面）', () => {
  const tool = createFetchTool(stubService([]));

  it('合法形通过：裸 url / 全参', () => {
    expect(Value.Check(tool.parameters, { url: 'https://example.com' })).toBe(true);
    expect(
      Value.Check(tool.parameters, {
        url: 'https://example.com',
        method: 'POST',
        headers: { 'x-a': '1' },
        body: 'k=v',
      }),
    ).toBe(true);
  });

  it('缺 url 拒 / 方法出词表拒 / 多余字段拒', () => {
    expect(Value.Check(tool.parameters, {})).toBe(false);
    expect(Value.Check(tool.parameters, { url: 'https://a.com', method: 'TRACE' })).toBe(false);
    expect(Value.Check(tool.parameters, { url: 'https://a.com', extra: 1 })).toBe(false);
  });

  it('根节点 object（TOOL_SCHEMA_INVALID 的注册面前提）', () => {
    expect(tool.parameters).toMatchObject({ type: 'object' });
  });
});

describe('execute——成功腿', () => {
  it('元信息头 + 分隔线 + 正文；跳转披露', async () => {
    const tool = createFetchTool(
      stubService([
        {
          url: 'https://example.com/in',
          finalUrl: 'https://cdn.example.org/final',
          status: 200,
          contentType: 'text/html',
          body: 'PAGE BODY',
          truncated: false,
          bytes: 9,
          redirects: 2,
        },
      ]),
    );
    const result = await tool.execute({ url: 'https://example.com/in' }, { toolCallId: 'tc-1' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('URL: https://cdn.example.org/final');
    expect(text).toContain('Status: 200');
    expect(text).toContain('Content-Type: text/html');
    expect(text).toContain('Redirects: 2');
    expect(text).toContain('---\n\nPAGE BODY');
  });

  it('截断披露行（超上限截断——原文更长）', async () => {
    const tool = createFetchTool(
      stubService([
        {
          url: 'https://example.com/big',
          finalUrl: 'https://example.com/big',
          status: 200,
          contentType: 'text/plain',
          body: 'part',
          truncated: true,
          bytes: 1024 * 1024,
          redirects: 0,
        },
      ]),
    );
    const result = await tool.execute({ url: 'https://example.com/big' }, { toolCallId: 'tc-2' });
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('超上限截断');
  });

  it('consumer tool 标注 + signal 透传', async () => {
    const calls: Array<{ url: string; init: WebFetchInit }> = [];
    const controller = new AbortController();
    const tool = createFetchTool(
      stubService(
        [
          {
            url: 'x',
            finalUrl: 'x',
            status: 200,
            contentType: '',
            body: '',
            truncated: false,
            bytes: 0,
            redirects: 0,
          },
        ],
        calls,
      ),
    );
    await tool.execute(
      { url: 'https://example.com/', method: 'POST', body: 'b' },
      { toolCallId: 'tc-3', signal: controller.signal },
    );
    expect(calls[0]?.init).toMatchObject({
      consumer: 'tool',
      method: 'POST',
      body: 'b',
      signal: controller.signal,
    });
  });
});

describe('execute——失败腿（isError 数据面）', () => {
  it('BaseError 携码前置披露 [WEB_PRIVATE_ADDRESS]', async () => {
    const tool = createFetchTool(stubService([new BaseError('WEB_PRIVATE_ADDRESS', '目标主机属私网/保留段')]));
    const result = await tool.execute({ url: 'http://10.0.0.1/' }, { toolCallId: 'tc-4' });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text.startsWith('[WEB_PRIVATE_ADDRESS]')).toBe(true);
    expect(text).toContain('私网');
  });

  it('非 BaseError 只出 message（不带码前缀）', async () => {
    const tool = createFetchTool(stubService([new TypeError('fetch failed')]));
    const result = await tool.execute({ url: 'https://down.example.com/' }, { toolCallId: 'tc-5' });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toBe('fetch failed');
    expect(text.startsWith('[')).toBe(false);
  });
});

describe('工具定义契约位', () => {
  const tool = createFetchTool(stubService([]));

  it('命名与效果面：name fetch / effect read（不触发审批对）', () => {
    expect(tool.name).toBe('fetch');
    expect(tool.effect).toBe('read');
  });

  it('描述非空（模型可见清单词法面）', () => {
    expect(tool.description.length).toBeGreaterThan(0);
  });
});
