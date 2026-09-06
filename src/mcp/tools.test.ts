/**
 * MCP 工具注册面测试（03 §10.1 注册面爆炸防线——纯逻辑零依赖）。
 *
 * 覆盖面：enabled/disabled 双表过滤（先白后黑）/ ≤20 原生注册（复合名、
 * timeoutMs 逐台、execute 落桥换回原名）/ >20 目录降级（单件 mcp、schema
 * 恒定、三动作 search/describe/call、管道帽 = 逐台最大）/ 非 object 根
 * schema 跳过 + warn / 复合名组劈往返。
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentToolResult } from '../contracts/index.js';
import { MCP_DIRECTORY_TOOL_NAME, buildMcpToolDefs, filterServerTools, mcpToolKey, splitMcpToolKey } from './tools.js';
import type { McpToolSource } from './tools.js';
import { MCP_NATIVE_TOOL_LIMIT } from './types.js';
import type { McpServerConfig, McpServerTool } from './types.js';

/** 造工具描述 */
function tool(name: string, description?: string): McpServerTool {
  return {
    name,
    ...(description !== undefined ? { description } : {}),
    inputSchema: { type: 'object', properties: {} },
  };
}

/** 造假源（call 记录落名——calls 观察面供断言） */
function makeSource(
  server: string,
  tools: readonly McpServerTool[],
  toolTimeoutMs = 60_000,
): McpToolSource & {
  calls: { tool: string; args: Record<string, unknown> }[];
} {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  return {
    server,
    tools,
    toolTimeoutMs,
    call: async (t, args) => {
      calls.push({ tool: t, args });
      return { content: [{ type: 'text', text: `ok:${t}` }] };
    },
    calls,
  };
}

describe('复合名组劈', () => {
  it('组/劈往返（含工具名自带 __ 与前导下划线）', () => {
    expect(mcpToolKey('fs', 'read_file')).toBe('fs__read_file');
    expect(splitMcpToolKey('fs__read_file')).toEqual({ server: 'fs', tool: 'read_file' });
    // 工具名自带 __：首 __ 分界（服务器键无下划线——无歧义）
    expect(splitMcpToolKey('fs__a__b')).toEqual({ server: 'fs', tool: 'a__b' });
    expect(splitMcpToolKey('fs___x')).toEqual({ server: 'fs', tool: '_x' });
  });

  it('非法键返 null（无分界/空段）', () => {
    expect(splitMcpToolKey('plain')).toBeNull();
    expect(splitMcpToolKey('srv__')).toBeNull();
    expect(splitMcpToolKey('____')).toBeNull();
  });
});

describe('filterServerTools 双表过滤', () => {
  const config = (fields: Partial<McpServerConfig>): McpServerConfig => ({
    command: '/x',
    ...fields,
  });
  const tools = [tool('a'), tool('b'), tool('c')];

  it('无表全过', () => {
    expect(filterServerTools(tools, config({}))).toHaveLength(3);
  });

  it('enabled 白名单收窄（先白）', () => {
    expect(filterServerTools(tools, config({ enabled_tools: ['a', 'c'] })).map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('disabled 恒排除', () => {
    expect(filterServerTools(tools, config({ disabled_tools: ['b'] })).map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('双表合用先白后黑（交集空即空）', () => {
    expect(
      filterServerTools(tools, config({ enabled_tools: ['a', 'b'], disabled_tools: ['b'] })).map((t) => t.name),
    ).toEqual(['a']);
  });
});

describe('buildMcpToolDefs 形态裁决', () => {
  it('合计 ≤20 原生注册：复合名 + timeoutMs 逐台 + execute 落桥原名', async () => {
    const s1 = makeSource('fs', [tool('read'), tool('write')], 30_000);
    const s2 = makeSource('db', [tool('query')], 90_000);
    const warn = vi.fn();
    const { defs, directory } = buildMcpToolDefs([s1, s2], warn);
    expect(directory).toBe(false);
    expect(defs.map((d) => d.name).sort()).toEqual(['db__query', 'fs__read', 'fs__write']);
    // 逐台预算
    const byName = new Map(defs.map((d) => [d.name, d]));
    expect(byName.get('fs__read')?.timeoutMs).toBe(30_000);
    expect(byName.get('db__query')?.timeoutMs).toBe(90_000);
    // 落桥换回服务器侧原名（复合名不进服务器）
    const r = (await byName.get('fs__read')!.execute({})) as AgentToolResult;
    expect((r.content[0] as { text: string }).text).toBe('ok:read');
    expect(s1.calls).toEqual([{ tool: 'read', args: {} }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('非 object 根 schema 跳过 + warn（坏形不入注册面）', () => {
    const bad: McpServerTool = { name: 'bad', inputSchema: { type: 'string' } as unknown as object };
    const warn = vi.fn();
    const { defs } = buildMcpToolDefs([makeSource('fs', [tool('ok'), bad])], warn);
    expect(defs.map((d) => d.name)).toEqual(['fs__ok']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('fs__bad');
  });

  it('合计 >20 全降目录：单件 mcp + schema 恒定 + 管道帽 = 逐台最大', async () => {
    const many = Array.from({ length: MCP_NATIVE_TOOL_LIMIT + 1 }, (_, i) => tool(`t${i}`));
    const s1 = makeSource('fs', many, 30_000);
    const s2 = makeSource('db', [tool('q')], 90_000);
    const { defs, directory } = buildMcpToolDefs([s1, s2]);
    expect(directory).toBe(true);
    expect(defs).toHaveLength(1);
    const d = defs[0]!;
    expect(d.name).toBe(MCP_DIRECTORY_TOOL_NAME);
    expect(d.timeoutMs).toBe(90_000); // 活服务器逐台预算最大值
    // schema 恒定（prompt cache 面——enum 三动作）
    expect((d.parameters as { properties: Record<string, { enum?: string[] }> }).properties.action!.enum).toEqual([
      'search',
      'describe',
      'call',
    ]);
  });
});

describe('目录工具三动作', () => {
  /** 起目录形态（21 工具触发降级） */
  function makeDirectory() {
    const many = Array.from({ length: MCP_NATIVE_TOOL_LIMIT }, (_, i) => tool(`t${i}`, `工具 ${i}`));
    const s1 = makeSource('fs', many);
    const s2 = makeSource('db', [tool('query', '查库')]);
    const { defs } = buildMcpToolDefs([s1, s2]);
    return { def: defs[0]!, s1, s2 };
  }

  it('search 列键 + 描述（query 子串过滤）', async () => {
    const { def } = makeDirectory();
    const all = (await def.execute({ action: 'search' })) as AgentToolResult;
    const text = (all.content[0] as { text: string }).text;
    expect(text).toContain('db__query — 查库');
    expect(text).toContain('fs__t0 —');
    const filtered = (await def.execute({ action: 'search', query: 'query' })) as AgentToolResult;
    const ftext = (filtered.content[0] as { text: string }).text;
    expect(ftext).toContain('db__query');
    expect(ftext).not.toContain('fs__t0');
  });

  it('describe 详述（inputSchema 全披露）', async () => {
    const { def } = makeDirectory();
    const r = (await def.execute({ action: 'describe', tool: 'db__query' })) as AgentToolResult;
    const parsed = JSON.parse((r.content[0] as { text: string }).text) as {
      server: string;
      name: string;
      inputSchema: object;
    };
    expect(parsed).toMatchObject({ server: 'db', name: 'query' });
    expect(parsed.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('call 落桥换回原名（复合名劈分路由）', async () => {
    const { def, s2 } = makeDirectory();
    const r = (await def.execute({
      action: 'call',
      tool: 'db__query',
      arguments: { q: 'select 1' },
    })) as AgentToolResult;
    expect((r.content[0] as { text: string }).text).toBe('ok:query');
    expect(s2.calls).toEqual([{ tool: 'query', args: { q: 'select 1' } }]);
  });

  it('未知键/未知动作诚实 isError（不静默）', async () => {
    const { def } = makeDirectory();
    const unknownKey = (await def.execute({ action: 'call', tool: 'nope__ghost' })) as AgentToolResult;
    expect(unknownKey.isError).toBe(true);
    expect((unknownKey.content[0] as { text: string }).text).toContain('nope__ghost');
    const unknownAction = (await def.execute({ action: 'walk' })) as AgentToolResult;
    expect(unknownAction.isError).toBe(true);
  });
});
