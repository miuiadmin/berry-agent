/**
 * core:mcp 类型面（03 §10.1——stdio 行帧 JSON-RPC 手写最小桥；批 17a-2）。
 *
 * 词面独立律（02 §4.1 席 deps = contracts + context）：本件与 exec/tools 零
 * DAG 边——spawn 与工具注册全经**窄面注入**消费（issue 件 IssueWorktreeFace
 * 先例同律）：
 * - `McpSpawnFace` 与 exec SpawnPipeline.spawnInteractive 结构兼容（组合根
 *   直接传管道真身；兼容性互证测试在 compat.test.ts）；
 * - `McpRegisterToolsFace` 与 tools ToolRegistry.register 子面结构兼容
 *   （返回注销器 = 撤工具面）；
 * - `McpScopeFace` 与 context Scope 的 effect/isDisposed 子面结构兼容
 *   （ctx.effect 回卷 + 续段 scope 活查）。
 *
 * context 席边为真消费（createLogger——装载态 ui.notify 接线随装配批）。
 */
import { BaseError } from '../contracts/index.js';

/* ---------------- 常量（缺省值单源——03 §10.1 字段集落码定形注） ---------------- */

/** 服务器键词法（`[A-Za-z0-9-]+`——`__` 与空白禁入；复合名 `<server>__<tool>` 的无歧义分界前提） */
export const MCP_SERVER_NAME_RE = /^[A-Za-z0-9-]+$/;

/** initialize 握手预算缺省秒数（spawn+握手同罩——只罩连接建立，不罩单次调用） */
export const MCP_STARTUP_TIMEOUT_SEC_DEFAULT = 10;

/** 单次工具调用预算缺省秒数（tools/call 逐台执法） */
export const MCP_TOOL_TIMEOUT_SEC_DEFAULT = 60;

/** server stdout 单行字节上限（行帧卫生——超限按载体级失败收场，静默巨行不进宿主堆） */
export const MCP_LINE_LIMIT_BYTES = 8 * 1024 * 1024;

/** 注册面爆炸防线阈值（过滤后全局合计 >20 → 全部降级为单件 mcp 目录工具） */
export const MCP_NATIVE_TOOL_LIMIT = 20;

/** 协议化关停宽限缺省（stdin.end 告别 → 宽限等退 → killTree 树杀兜底） */
export const MCP_CLOSE_GRACE_MS = 3_000;

/** 客户端握手 protocolVersion（已知集最基底值——最广服务器支持面；服务器回显异值不拒） */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

/* ---------------- 配置面（core:mcp 行 config servers——用户可配域） ---------------- */

/** 单服务器配置（config.servers 键的值形；坏形不入此形——normalizeMcpConfig 先行） */
export interface McpServerConfig {
  /** 可执行（v1 只收绝对路径） */
  readonly command: string;
  /** 命令行参数 */
  readonly args?: readonly string[];
  /** 显式注入 env（EnvPolicy.set 面——仍受 deny 封死；缺省零继承宿主其余变量） */
  readonly env?: Readonly<Record<string, string>>;
  /** 工具白名单（在场 = 仅这些工具注册；缺省 = 该维不约束） */
  readonly enabled_tools?: readonly string[];
  /** 工具黑名单（恒排除——与白名单双表合用：先白后黑） */
  readonly disabled_tools?: readonly string[];
  /** initialize 握手预算秒（缺省 10） */
  readonly startup_timeout_sec?: number;
  /** 单次工具调用预算秒（缺省 60） */
  readonly tool_timeout_sec?: number;
}

/** 全行配置（config.servers 整值——用户行覆盖 = 整值替换非合并，§5.3） */
export type McpConfig = Readonly<Record<string, McpServerConfig>>;

/**
 * 归一 config.servers（坏形响亮拒 MCP_CONFIG_INVALID——/reload 时刻可见）。
 * 非对象/null/undefined → 空配置（缺省 servers 空 = 行惰性无害零 spawn）。
 */
export function normalizeMcpConfig(raw: unknown): McpConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BaseError('MCP_CONFIG_INVALID', 'config.servers 须为对象（键 = 服务器名）');
  }
  const out: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    out[name] = normalizeServerEntry(name, value);
  }
  return out;
}

/** 单服务器条目归一（字段集逐一类型校验——词法/绝对路径/正数域） */
function normalizeServerEntry(name: string, value: unknown): McpServerConfig {
  if (!MCP_SERVER_NAME_RE.test(name)) {
    throw new BaseError(
      'MCP_CONFIG_INVALID',
      `服务器键词法违例：${JSON.stringify(name)}（须匹配 [A-Za-z0-9-]+——__ 与空白禁入）`,
    );
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BaseError('MCP_CONFIG_INVALID', `servers.${name} 须为对象`);
  }
  const v = value as Record<string, unknown>;
  const command = v.command;
  if (typeof command !== 'string' || command === '' || !command.startsWith('/')) {
    throw new BaseError(
      'MCP_CONFIG_INVALID',
      `servers.${name}.command 须为绝对路径（v1 只收绝对路径）：${JSON.stringify(command)}`,
    );
  }
  const args = strArray(v.args, `servers.${name}.args`);
  const env = strRecord(v.env, `servers.${name}.env`);
  const enabled = strArray(v.enabled_tools, `servers.${name}.enabled_tools`);
  const disabled = strArray(v.disabled_tools, `servers.${name}.disabled_tools`);
  const startup = positiveNumber(v.startup_timeout_sec, `servers.${name}.startup_timeout_sec`);
  const toolTimeout = positiveNumber(v.tool_timeout_sec, `servers.${name}.tool_timeout_sec`);
  return {
    command,
    ...(args !== undefined ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(enabled !== undefined ? { enabled_tools: enabled } : {}),
    ...(disabled !== undefined ? { disabled_tools: disabled } : {}),
    ...(startup !== undefined ? { startup_timeout_sec: startup } : {}),
    ...(toolTimeout !== undefined ? { tool_timeout_sec: toolTimeout } : {}),
  };
}

/** 字符串数组字段校验（undefined 放行——可选字段缺席合法） */
function strArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((e) => typeof e !== 'string')) {
    throw new BaseError('MCP_CONFIG_INVALID', `${label} 须为字符串数组`);
  }
  return value as readonly string[];
}

/** 字符串记录字段校验（env 显式注入面） */
function strRecord(value: unknown, label: string): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BaseError('MCP_CONFIG_INVALID', `${label} 须为 string→string 对象`);
  }
  for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val !== 'string') {
      throw new BaseError('MCP_CONFIG_INVALID', `${label}.${k} 须为 string`);
    }
  }
  return value as Readonly<Record<string, string>>;
}

/** 正数域字段校验（超时秒——0/负/非数拒） */
function positiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BaseError('MCP_CONFIG_INVALID', `${label} 须为正数（秒）`);
  }
  return value;
}

/* ---------------- 数据面（tools/list 发现产物——归一形） ---------------- */

/** 服务器侧工具描述（tools/list 条目归一；inputSchema 直喂注册面——根须 object） */
export interface McpServerTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: object;
}

/* ---------------- 注入窄面（词面独立律——结构兼容真身，compat.test 互证） ---------------- */

/**
 * 长存活子进程窄面（结构兼容 exec InteractiveChild 子集——组合根传真身）。
 * 最小结构形：stdin 写/end、stdout 读+封读、stderr 日志面、onExit crash 检测、
 * kill 兜底树杀。
 */
export interface McpChildFace {
  /** 协议帧写出（行帧 JSON-RPC——桥侧独占写） */
  readonly stdin: { write(chunk: string): unknown; end(): unknown };
  /** 协议帧读入（行字节流）+ 封读（行超限载体级失败用——destroy 语义） */
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown; destroy(): unknown };
  /** stderr（→ logger debug） */
  readonly stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown };
  /** crash 检测（close 语义一次送达；迟到订阅即回调） */
  onExit(callback: (info: { code: number | null; spawnError?: Error }) => void): void;
  /** 进程组树杀兜底（已退出 no-op） */
  kill(): void;
}

/** spawn 窄面（结构兼容 exec SpawnPipeline.spawnInteractive——组合根传真身） */
export interface McpSpawnFace {
  spawnInteractive(request: {
    readonly argv: readonly string[];
    readonly cwd?: string;
    readonly env?: {
      readonly allow?: readonly string[];
      readonly deny?: readonly string[];
      readonly set?: Readonly<Record<string, string>>;
    };
    readonly owner: string;
  }): McpChildFace;
}

/** 工具注册窄面（结构兼容 tools ToolRegistry.register 子面——撤工具经注销器） */
export interface McpRegisterToolsFace {
  register(def: {
    name: string;
    description: string;
    parameters: object;
    timeoutMs?: number;
    execute: (args: Record<string, unknown>, toolCtx: unknown) => Promise<unknown>;
  }): () => void;
}

/** 作用域窄面（结构兼容 context Scope 的 effect/isDisposed 子面——回卷与活查） */
export interface McpScopeFace {
  /** 登记可逆副作用（disposer 进 LIFO 回卷序） */
  effect(register: () => () => void): unknown;
  /** 作用域已回卷旗（续段 scope 活查源） */
  readonly isDisposed: boolean;
}
