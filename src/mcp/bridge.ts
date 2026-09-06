/**
 * MCP 服务器桥（03 §10.1 连接语义与子进程治理的承载腿——一服务器一桥）。
 *
 * connect 编舞：spawn（exec 管道窄面 + 登记簿同册）→ stderr 转 logger
 * debug → initialize 握手（startup_timeout_sec 预算罩 spawn+握手全程）→
 * notifications/initialized → tools/list 分页跟尽（nextCursor 不跟即静默丢
 * 工具）。连接期任一步折 = MCP_CONNECT_FAILED（子进程收场不留孤儿）。
 *
 * call：tools/call 落桥（tool_timeout_sec 逐台执法）；crash（载体 close）→
 * 在途请求拒 + onDown 通知（服务面撤工具）——不自动重连，复位走 /reload。
 *
 * close（协议化关停——ctx.effect 回卷消费）：stdin.end() 告别 → 宽限等退 →
 * killTree 树杀兜底；幂等（二次 close 复用同一结算）。
 */
import { BaseError } from '../contracts/index.js';
import { createLogger } from '../context/index.js';
import type { Logger } from '../context/index.js';
import type { AgentToolResult } from '../contracts/index.js';
import { JsonRpcConnection } from './jsonrpc.js';
import {
  MCP_CLOSE_GRACE_MS,
  MCP_LINE_LIMIT_BYTES,
  MCP_PROTOCOL_VERSION,
  MCP_STARTUP_TIMEOUT_SEC_DEFAULT,
  MCP_TOOL_TIMEOUT_SEC_DEFAULT,
} from './types.js';
import type { McpChildFace, McpServerConfig, McpServerTool, McpSpawnFace } from './types.js';

/** 桥构造依赖（全可注入——测试零真进程依赖） */
export interface McpBridgeDeps {
  /** spawn 窄面（结构兼容 exec 管道——组合根传真身） */
  readonly spawn: McpSpawnFace;
  readonly logger?: Logger;
  /** 关停宽限 ms（缺省 3000） */
  readonly closeGraceMs?: number;
  /** clientInfo.version 披露（装配批对齐 package.json；缺省 '0.1.0'） */
  readonly clientVersion?: string;
}

/** 单服务器桥公开面 */
export interface McpBridge {
  readonly server: string;
  /** 发现的工具清单（已过 enabled/disabled 过滤前的原始面——过滤归注册层） */
  readonly tools: readonly McpServerTool[];
  /** 单次调用预算 ms（tool_timeout_sec 定值——两注册形态同源） */
  readonly toolTimeoutMs: number;
  /** 调用服务器侧原名工具（一切失败折 isError 结果——数据面） */
  call(tool: string, args: Record<string, unknown>): Promise<AgentToolResult>;
  /** crash/载体级失败通知（撤工具 + ui.notify 的触发面）——一次性事件 */
  onDown(callback: (reason: string) => void): void;
  /** 协议化关停（stdin.end → 宽限 → killTree；幂等） */
  close(): Promise<void>;
}

/**
 * 连接单服务器（发现全程——握手+分页）。连接期失败抛 MCP_CONNECT_FAILED
 * （spawn 失败 / 握手超时 / 行帧超帽 / 服务器即退），子进程在抛出前收场。
 */
export async function connectMcpServer(
  server: string,
  config: McpServerConfig,
  deps: McpBridgeDeps,
): Promise<McpBridge> {
  const logger = deps.logger ?? createLogger('mcp');
  const graceMs = deps.closeGraceMs ?? MCP_CLOSE_GRACE_MS;
  const startupMs = (config.startup_timeout_sec ?? MCP_STARTUP_TIMEOUT_SEC_DEFAULT) * 1_000;
  const toolTimeoutMs = (config.tool_timeout_sec ?? MCP_TOOL_TIMEOUT_SEC_DEFAULT) * 1_000;

  // ── spawn（登记簿同册：owner = mcp:<server>——「谁开的」审计面） ──
  let child: McpChildFace;
  try {
    child = deps.spawn.spawnInteractive({
      argv: [config.command, ...(config.args ?? [])],
      env: config.env !== undefined ? { set: config.env } : undefined,
      owner: `mcp:${server}`,
    });
  } catch (err) {
    throw new BaseError('MCP_CONNECT_FAILED', `spawn 失败（${server}）：${errText(err)}`, { cause: asError(err) });
  }

  // ── 载体状态机（crash 检测 = close 事件；行帧 fatal = 封读+树杀） ──
  let downReason: string | undefined;
  const downCallbacks: ((reason: string) => void)[] = [];
  let exitInfo: { code: number | null; spawnError?: Error } | undefined;
  const exitWaiters: (() => void)[] = [];
  let closePromise: Promise<void> | undefined;

  let connection: JsonRpcConnection | undefined;
  const markDown = (reason: string): void => {
    if (downReason !== undefined) return; // 一次结算（crash 与 fatal 双源竞速同封）
    downReason = reason;
    for (const cb of [...downCallbacks]) cb(reason);
    for (const w of [...exitWaiters]) w();
    exitWaiters.length = 0;
  };

  child.onExit((info) => {
    exitInfo = info;
    connection?.failAll(
      new BaseError(
        'MCP_CONNECT_FAILED',
        info.spawnError !== undefined
          ? `spawn 失败（${server}）：${info.spawnError.message}`
          : `server 退出（${server}，code=${info.code}）`,
      ),
    );
    markDown(
      info.spawnError !== undefined ? `spawn 失败：${info.spawnError.message}` : `server 退出（code=${info.code}）`,
    );
  });

  connection = new JsonRpcConnection({
    send: (line) => child.stdin.write(`${line}\n`),
    lineLimitBytes: MCP_LINE_LIMIT_BYTES,
    warn: (message) => logger.warn(message),
    onFatal: () => {
      // 载体级失败收场：封读（静默巨行不进宿主堆）+ 树杀 server（不杀即永久孤儿）
      child.stdout.destroy();
      child.kill();
    },
  });
  child.stdout.on('data', (chunk) => connection?.feed(chunk));
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() !== '') logger.debug(`[mcp:${server}] ${line}`);
    }
  });

  try {
    // ── initialize 握手（startup 预算罩全程；服务器回显异版本不拒——v1 不挑） ──
    await connection.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'berry-agent', version: deps.clientVersion ?? '0.1.0' },
      },
      startupMs,
    );
    connection.notify('notifications/initialized');

    // ── tools/list 分页跟尽（nextCursor 不跟即静默丢工具——03 §10.1 明律） ──
    const tools: McpServerTool[] = [];
    let cursor: string | undefined;
    do {
      const page = (await connection.request(
        'tools/list',
        cursor !== undefined ? { cursor } : undefined,
        startupMs,
      )) as { tools?: unknown; nextCursor?: unknown } | null;
      if (page !== null && typeof page === 'object' && Array.isArray(page.tools)) {
        for (const raw of page.tools) {
          const tool = normalizeTool(raw);
          if (tool !== undefined) tools.push(tool);
        }
      }
      cursor = typeof page?.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor !== undefined);
    if (downReason !== undefined) {
      // 发现途中已死（竞速护栏——close 与末页响应近同时到）
      throw new BaseError('MCP_CONNECT_FAILED', `server 退出（${server}）：${downReason}`);
    }

    const bridge: McpBridge = {
      server,
      tools,
      toolTimeoutMs,
      call: (tool, args) => callTool(connection, server, tool, args, toolTimeoutMs, () => downReason),
      onDown(callback) {
        if (downReason !== undefined)
          callback(downReason); // 迟到订阅即回调
        else downCallbacks.push(callback);
      },
      close: () => {
        if (closePromise === undefined) {
          closePromise = closeChild(
            child,
            graceMs,
            () => exitInfo,
            (waiter) => exitWaiters.push(waiter),
          );
        }
        return closePromise; // 幂等——二次 close 复用首次结算
      },
    };
    return bridge;
  } catch (err) {
    // 连接期失败收场：结清 pending + 树杀（不留孤儿）→ 分类抛出
    connection.failAll(
      err instanceof BaseError ? err : new BaseError('MCP_CONNECT_FAILED', `连接失败（${server}）：${errText(err)}`),
    );
    child.kill();
    if (err instanceof BaseError && err.code === 'MCP_CONNECT_FAILED') throw err;
    if (err instanceof Error && err.message.includes('超时')) {
      throw new BaseError('MCP_CONNECT_FAILED', `initialize 握手超时（${server}，预算 ${startupMs}ms）`, {
        cause: err,
      });
    }
    throw new BaseError('MCP_CONNECT_FAILED', `连接失败（${server}）：${errText(err)}`, { cause: asError(err) });
  }
}

/** tools/call 执行体（一切失败折 isError 结果——数据面不改抛出面） */
function callTool(
  connection: JsonRpcConnection | undefined,
  server: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  downOf: () => string | undefined,
): Promise<AgentToolResult> {
  const down = downOf();
  if (connection === undefined || down !== undefined) {
    return Promise.resolve({
      content: [{ type: 'text', text: `MCP 服务器 ${server} 已断开（${down ?? '未知原因'}）——/reload 复位` }],
      isError: true,
    });
  }
  return connection
    .request('tools/call', { name: tool, arguments: args }, timeoutMs)
    .then((result) => mapToolResult(result))
    .catch((err: unknown) => ({
      content: [{ type: 'text', text: `MCP 工具调用失败（${server}__${tool}）：${errText(err)}` }],
      isError: true,
    }));
}

/** tools/call 响应映射（text/image 直映射；其余形折 JSON 文本——不丢内容） */
function mapToolResult(result: unknown): AgentToolResult {
  const r = (result ?? {}) as { content?: unknown; isError?: unknown };
  const content: AgentToolResult['content'] = [];
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      if (typeof item !== 'object' || item === null) continue;
      const c = item as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
      if (c.type === 'text' && typeof c.text === 'string') {
        content.push({ type: 'text', text: c.text });
      } else if (c.type === 'image' && typeof c.data === 'string' && typeof c.mimeType === 'string') {
        content.push({ type: 'image', data: c.data, mimeType: c.mimeType });
      } else {
        content.push({ type: 'text', text: JSON.stringify(item) });
      }
    }
  }
  return { content, isError: r.isError === true || undefined };
}

/** 协议化关停编舞（备忘录归调用侧）：stdin.end 告别 → 宽限 → 树杀兜底 */
function closeChild(
  child: McpChildFace,
  graceMs: number,
  exitOf: () => { code: number | null; spawnError?: Error } | undefined,
  addWaiter: (waiter: () => void) => void,
): Promise<void> {
  return (async () => {
    try {
      child.stdin.end(); // 协议化告别（stdin 关 = stdio server 的关停信号）
    } catch {
      // stdin 已坏（服务器先死）——宽限/树杀照走
    }
    const exited = await new Promise<boolean>((resolve) => {
      if (exitOf() !== undefined) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), graceMs);
      addWaiter(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited) child.kill(); // 宽限尽——树杀兜底（防挂死 server 永久孤儿）
  })();
}

/** tools/list 条目归一（name 非 string 弃；inputSchema 缺席容错空 object） */
function normalizeTool(raw: unknown): McpServerTool | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };
  if (typeof t.name !== 'string' || t.name === '') return undefined;
  return {
    name: t.name,
    ...(typeof t.description === 'string' ? { description: t.description } : {}),
    inputSchema:
      typeof t.inputSchema === 'object' && t.inputSchema !== null ? (t.inputSchema as object) : { type: 'object' },
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
