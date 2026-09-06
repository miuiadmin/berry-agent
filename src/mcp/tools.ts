/**
 * MCP 工具注册面（03 §10.1 注册面爆炸防线——形态裁决与目录路由）。
 *
 * 两形态（过滤 enabled/disabled 后全局合计定）：
 * - 合计 ≤ MCP_NATIVE_TOOL_LIMIT（20）→ 原生注册：一工具一 ToolDefinition，
 *   暴露名 = `<server>__<tool>` 复合名（服务器键词法禁 `__`——首 `__` 即无
 *   歧义分界，防跨服务器同名静默遮蔽；call 落桥换回服务器侧原名）；
 * - 合计 > 20 → 全部降级为单件 `mcp` 目录工具（search/describe/call 三动作，
 *   schema 恒定保 prompt cache）；目录形态管道帽 = 活服务器逐台预算最大值
 *   （缺省服务器不被他台大预算连带抬升），call 落桥逐台执法。
 */
import type { AgentToolResult } from '../contracts/index.js';
import { MCP_NATIVE_TOOL_LIMIT } from './types.js';
import type { McpServerConfig, McpServerTool } from './types.js';

/** 桥消费窄面（结构兼容 bridge.McpBridge——服务面拼装；工具面零 import 桥件） */
export interface McpToolSource {
  readonly server: string;
  readonly tools: readonly McpServerTool[];
  readonly toolTimeoutMs: number;
  call(tool: string, args: Record<string, unknown>): Promise<AgentToolResult>;
}

/** 注册面产物（服务面逐件注册——注册失败 per-def 容错在服务面） */
export interface McpToolSurface {
  /** 工具定义清单（原生 N 件或目录 1 件） */
  readonly defs: readonly McpBuildDef[];
  /** 形态旗（true = 目录降级） */
  readonly directory: boolean;
}

/** 构建侧工具定义（执行体签名窄形——注册窄面结构兼容 ToolDefinition） */
export interface McpBuildDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: object;
  readonly timeoutMs: number;
  readonly execute: (args: Record<string, unknown>) => Promise<AgentToolResult>;
}

/** 目录工具名（降级形态单件名——命名域顶层 'mcp'） */
export const MCP_DIRECTORY_TOOL_NAME = 'mcp';

/** 组复合名（`<server>__<tool>`——服务器键无下划线，首 `__` 即分界） */
export function mcpToolKey(server: string, tool: string): string {
  return `${server}__${tool}`;
}

/** 劈复合名（首 `__` 分界；无分界/空段 = 非法键返 null） */
export function splitMcpToolKey(key: string): { server: string; tool: string } | null {
  const idx = key.indexOf('__');
  if (idx <= 0 || idx === key.length - 2) return null;
  return { server: key.slice(0, idx), tool: key.slice(idx + 2) };
}

/**
 * enabled/disabled 双表过滤（enabled 在场 = 白名单收窄；disabled 恒排除——
 * 双表合用先白后黑）。过滤语义在服务器侧原名面（复合名只在暴露面）。
 */
export function filterServerTools(tools: readonly McpServerTool[], config: McpServerConfig): readonly McpServerTool[] {
  let out = tools;
  if (config.enabled_tools !== undefined) {
    const allow = new Set(config.enabled_tools);
    out = out.filter((t) => allow.has(t.name));
  }
  if (config.disabled_tools !== undefined) {
    const deny = new Set(config.disabled_tools);
    out = out.filter((t) => !deny.has(t.name));
  }
  return out;
}

/**
 * 建工具面（形态裁决 + 定义产出）。非 object 根 inputSchema 的工具跳过 +
 * warn（直喂纪律下坏形不入注册面——注册表 TOOL_SCHEMA_INVALID 会炸全行，
 * 诚实降级单件跳过）。
 */
export function buildMcpToolDefs(
  sources: readonly McpToolSource[],
  warn: (message: string) => void = () => undefined,
): McpToolSurface {
  // 逐源过滤 + 复合名配对（server 键词法已保证无 `__`——无歧义）
  const entries: { source: McpToolSource; tool: McpServerTool }[] = [];
  for (const source of sources) {
    for (const tool of source.tools) {
      entries.push({ source, tool });
    }
  }
  if (entries.length > MCP_NATIVE_TOOL_LIMIT) {
    return { defs: [buildDirectoryDef(sources)], directory: true };
  }
  const defs: McpBuildDef[] = [];
  for (const { source, tool } of entries) {
    if (!isRootObjectSchema(tool.inputSchema)) {
      warn(`MCP 工具 schema 根非 object 跳过：${mcpToolKey(source.server, tool.name)}`);
      continue;
    }
    const originalName = tool.name;
    defs.push({
      name: mcpToolKey(source.server, originalName),
      description: tool.description ?? `MCP 工具（服务器 ${source.server}）`,
      parameters: tool.inputSchema,
      timeoutMs: source.toolTimeoutMs,
      execute: (args) => source.call(originalName, args), // 落桥换回服务器侧原名
    });
  }
  return { defs, directory: false };
}

/** 目录工具（降级形态——schema 恒定三动作） */
function buildDirectoryDef(sources: readonly McpToolSource[]): McpBuildDef {
  // 管道帽 = 活服务器逐台预算最大值（缺省服务器不被他台大预算连带抬升——
  // 各台缺省一致时即缺省值；call 落桥后逐台执法不受此帽语义干扰）
  const pipelineTimeoutMs = sources.reduce((max, s) => Math.max(max, s.toolTimeoutMs), 0);
  return {
    name: MCP_DIRECTORY_TOOL_NAME,
    description:
      'MCP 服务器工具目录（多服务器工具合计超 20 件的降级形态）：action=search 列出 / describe 详述 / call 调用；tool 参数为寻址键 <server>__<tool>',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'describe', 'call'], description: '目录动作' },
        tool: { type: 'string', description: '目录寻址键 <server>__<tool>（describe/call 必填）' },
        query: { type: 'string', description: 'search 的过滤词（子串匹配，可选）' },
        arguments: { type: 'object', description: 'call 动作的工具参数（可选）' },
      },
      required: ['action'],
    },
    timeoutMs: pipelineTimeoutMs,
    execute: async (args) => directoryExecute(sources, args),
  };
}

/** 目录三动作路由（search/describe/call——未知键诚实 isError） */
async function directoryExecute(
  sources: readonly McpToolSource[],
  args: Record<string, unknown>,
): Promise<AgentToolResult> {
  const action = args.action;
  if (action === 'search') {
    const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
    const lines: string[] = [];
    for (const source of sources) {
      for (const tool of source.tools) {
        const key = mcpToolKey(source.server, tool.name);
        const hay = `${key} ${tool.description ?? ''}`.toLowerCase();
        if (query === '' || hay.includes(query)) {
          lines.push(`${key} — ${tool.description ?? '（无描述）'}`);
        }
      }
    }
    return { content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '（无匹配 MCP 工具）' }] };
  }
  if (action === 'describe' || action === 'call') {
    const key = typeof args.tool === 'string' ? args.tool : '';
    const split = splitMcpToolKey(key);
    const source = split !== null ? sources.find((s) => s.server === split.server) : undefined;
    const tool = source !== undefined && split !== null ? source.tools.find((t) => t.name === split.tool) : undefined;
    if (source === undefined || tool === undefined || split === null) {
      return {
        content: [
          { type: 'text', text: `未知 MCP 工具键：${key}（search 动作可列当前可用键——服务器 crash 后工具即撤）` },
        ],
        isError: true,
      };
    }
    if (action === 'describe') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                server: source.server,
                name: tool.name,
                description: tool.description ?? null,
                inputSchema: tool.inputSchema,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    const callArgs =
      typeof args.arguments === 'object' && args.arguments !== null && !Array.isArray(args.arguments)
        ? (args.arguments as Record<string, unknown>)
        : {};
    return source.call(tool.name, callArgs); // 落桥换回服务器侧原名——逐台执法
  }
  return {
    content: [{ type: 'text', text: `未知目录动作：${JSON.stringify(action)}（search/describe/call 三选一）` }],
    isError: true,
  };
}

/** schema 根 object 判（直喂注册面的前置校验——非 object 根注册表会拒） */
function isRootObjectSchema(schema: object): boolean {
  const t = (schema as { type?: unknown }).type;
  return t === 'object';
}
