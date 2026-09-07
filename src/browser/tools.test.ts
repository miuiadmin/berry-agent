/**
 * tools 件测试（schema 面 + effect 分账 + 会话路由 + 结果编码）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { buildBrowserTools } from './tools.js';
import type { BrowserToolPageSource } from './tools.js';
import type { BrowserPage } from './page.js';

/** 页面桩：路由记账 + 可控行为（prop 名命中即回执该值） */
function makeSource(behavior: Record<string, () => unknown>) {
  const routed: string[] = [];
  const page = {
    sessionId: 'S-test',
    ...Object.fromEntries(
      Object.entries(behavior).map(([prop, fn]) => [
        prop,
        async (...args: unknown[]) => {
          void args;
          return fn();
        },
      ]),
    ),
  } as unknown as BrowserPage;
  const source: BrowserToolPageSource = {
    pageFor: async (key) => {
      routed.push(key);
      return page;
    },
  };
  return { source, routed };
}

describe('buildBrowserTools', () => {
  it('十件齐且名字无前缀（与 web fetch 同律——裸名注册，撞名由注册表把关）', () => {
    const defs = buildBrowserTools({ pageFor: async () => ({}) as BrowserPage });
    expect(defs.map((d) => d.name)).toEqual([
      'navigate',
      'back',
      'forward',
      'snapshot',
      'click',
      'type',
      'press',
      'scroll',
      'screenshot',
      'console',
    ]);
  });

  it('effect 分账：交互族七件 write；读族三件 read；参数根全 additionalProperties:false', () => {
    const defs = buildBrowserTools({ pageFor: async () => ({}) as BrowserPage });
    const byName = new Map(defs.map((d) => [d.name, d]));
    for (const name of ['navigate', 'back', 'forward', 'click', 'type', 'press', 'scroll']) {
      expect(byName.get(name)!.effect, `${name} 应为 write`).toBe('write');
    }
    for (const name of ['snapshot', 'screenshot', 'console']) {
      expect(byName.get(name)!.effect, `${name} 应为 read`).toBe('read');
    }
    for (const d of defs) {
      expect((d.parameters as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it('会话路由：toolCtx.sessionId 透传；缺席/空串/非串折 default', async () => {
    const { source, routed } = makeSource({ snapshot: () => '快照' });
    const snapshot = buildBrowserTools(source).find((d) => d.name === 'snapshot')!;
    type ExecCtx = Parameters<typeof snapshot.execute>[1];
    await snapshot.execute({}, { toolCallId: 'c1', sessionId: 's-会话A' } as ExecCtx);
    await snapshot.execute({}, { toolCallId: 'c2' } as ExecCtx);
    await snapshot.execute({}, { toolCallId: 'c3', sessionId: '' } as ExecCtx);
    // 非串值：契约外输入（防御位折 default——sessionKeyOf 自窄化）
    await snapshot.execute({}, { toolCallId: 'c4', sessionId: 42 } as unknown as ExecCtx);
    expect(routed).toEqual(['s-会话A', 'default', 'default', 'default']);
  });

  it('成功编码：execute 回 AgentToolResult 文本面（navigate 终点 URL 入文）', async () => {
    const { source } = makeSource({ navigate: () => ({ url: 'https://example.com/final' }) });
    const nav = buildBrowserTools(source).find((d) => d.name === 'navigate')!;
    const r = await nav.execute({ url: 'https://example.com/final' }, { toolCallId: 'c1' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toMatchObject({ type: 'text' });
    expect((r.content[0] as { text: string }).text).toContain('https://example.com/final');
  });

  it('失败编码：BaseError 携码前置 [CODE]；普通错无码前缀——同 isError 数据面', async () => {
    const failing = (err: unknown): BrowserToolPageSource => ({
      pageFor: async () => {
        throw err;
      },
    });
    const nav1 = buildBrowserTools(failing(new BaseError('WEB_PRIVATE_ADDRESS', '私网地址拒绝'))).find(
      (d) => d.name === 'navigate',
    )!;
    const r1 = await nav1.execute({ url: 'http://x/' }, { toolCallId: 'c1' });
    expect(r1.isError).toBe(true);
    expect((r1.content[0] as { text: string }).text).toBe('[WEB_PRIVATE_ADDRESS] 私网地址拒绝');
    const nav2 = buildBrowserTools(failing(new Error('引擎未就绪'))).find((d) => d.name === 'navigate')!;
    const r2 = await nav2.execute({ url: 'http://x/' }, { toolCallId: 'c2' });
    expect(r2.isError).toBe(true);
    expect((r2.content[0] as { text: string }).text).toBe('引擎未就绪');
  });

  it('press schema：命名键词表 + 单字符 pattern（多字符非词表拒收）', () => {
    const defs = buildBrowserTools({ pageFor: async () => ({}) as BrowserPage });
    const schema = defs.find((d) => d.name === 'press')!.parameters as {
      properties: { key: { anyOf: Array<Record<string, unknown>> } };
    };
    const literals = schema.properties.key.anyOf.filter((v) => 'const' in v).map((v) => v.const);
    expect(literals).toContain('Enter');
    expect(literals).toContain('Space');
    const pattern = schema.properties.key.anyOf.find((v) => 'pattern' in v)!.pattern;
    expect(pattern).toBe('^[\\s\\S]$');
  });

  it('back/forward 诚实回执：moved:false 非错误；console 空环占位文案', async () => {
    const { source } = makeSource({
      back: () => ({ moved: false }),
      forward: () => ({ moved: true, url: 'https://next/' }),
      consoleLog: () => [],
    });
    const defs = buildBrowserTools(source);
    const back = await defs.find((d) => d.name === 'back')!.execute({}, { toolCallId: 'c1' });
    expect(back.isError).toBeUndefined();
    expect((back.content[0] as { text: string }).text).toContain('无前一步');
    const fwd = await defs.find((d) => d.name === 'forward')!.execute({}, { toolCallId: 'c2' });
    expect((fwd.content[0] as { text: string }).text).toContain('https://next/');
    const con = await defs.find((d) => d.name === 'console')!.execute({}, { toolCallId: 'c3' });
    expect((con.content[0] as { text: string }).text).toContain('尚无 console 输出');
  });

  it('scroll 参数折算：缺省 down/600；up 透传', async () => {
    const seen: Array<{ direction: string; amount: number }> = [];
    const source: BrowserToolPageSource = {
      pageFor: async () =>
        ({
          scroll: async (direction: string, amount: number) => {
            seen.push({ direction, amount });
          },
        }) as unknown as BrowserPage,
    };
    const defs = buildBrowserTools(source);
    const scroll = defs.find((d) => d.name === 'scroll')!;
    await scroll.execute({}, { toolCallId: 'c1' });
    await scroll.execute({ direction: 'up', amount: 42 }, { toolCallId: 'c2' });
    expect(seen).toEqual([
      { direction: 'down', amount: 600 },
      { direction: 'up', amount: 42 },
    ]);
  });
});
