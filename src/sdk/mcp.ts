/**
 * sdk/mcp — MCP server 包装（core:sdk 件第三形态——03 §10.6「MCP server 包装」条）。
 *
 * 本仓作为 MCP server 被别家 agent 调用：行帧 JSON-RPC 2.0 手写（10.1 桥的
 * 反向位——同栈双对称、零新增依赖）；transport v1 stdio-only。工具面收窄
 * 两件（03 §10.6 批 13f 落码定形）：
 * - `berry-agent`：会话发起/续接（→ prompt 动词——受理即回执，**异步档**：
 *   回复增量经轮询工具获取；阻塞档不采——长 turn 占死 MCP 工具调用槽且
 *   MCP 客户端各自超时策略不可代持）；
 * - `berry-agent-reply`：回复轮询（→ getEntries 投影——durable 平铺 + lastSeq 续读位）。
 * 映射层薄：受理/admit/深校验/错误码全在协议核单源（包装层零第二套词汇——
 * 工具参数经 validateSdkRequest 同源深校验后入核）；件内零直播面——无订阅
 * 即无帧流，MCP 形只消费请求/应答档（心跳/重放/线控帧不达 MCP 面，包装层
 * 不发明第二直播通道）。审批 v1 无应答通道：工具面不含 decide，ask 无订阅
 * 者 fail-closed cancel（04 §9 headless 律不豁免——「给应答能力」的承载是
 * serve/HTTP 形，MCP 形如实不承载）。
 *
 * MCP 协议面（server 侧五方法——与 10.1 client 侧同集反向）：initialize /
 * notifications/initialized（通知零应答）/ tools/list / tools/call / ping；
 * 未知方法 -32601、未知工具 -32602、坏行 -32700（id null 形应答）；业务错
 * （SDK_ 族/SESSION_*）走工具结果 isError 位非 JSON-RPC error（协议错与
 * 业务错两分）。protocolVersion 已知集回显制（请求值在已知集内即回显、
 * 否则回服务端缺省）。工具名属对外声明值位（bin 同族）——去品牌化纪律合法域。
 */
import type { Readable, Writable } from 'node:stream';

import {
  createSdkBackend,
  splitWireLines,
  validateSdkRequest,
  type SdkOutboundSink,
  type SdkRequest,
  type SdkWireFrame,
} from '../channels/index.js';

import type { SdkHttpBridge } from './types.js';

/** 装配桥注入面（三形态共用形——与 SdkHttpBridge 同构，host 侧 createServeBridge 产物直喂） */
export type SdkMcpBridge = SdkHttpBridge;

/* ---------------- MCP 协议常量（行帧 JSON-RPC 2.0——10.1 反向位同集） ---------------- */

/** 已知 protocolVersion 集（回显制——请求值在集内即回显） */
const MCP_KNOWN_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'] as const;

/** 服务端缺省 protocolVersion（请求值不在已知集时回本值） */
const MCP_DEFAULT_VERSION = '2025-06-18';

/** JSON-RPC 2.0 错误码（协议错档——业务错走工具结果 isError 位不占此面） */
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

/** 会话发起/续接工具名（codex `codex` 形镜像——对外声明值位） */
export const MCP_PROMPT_TOOL_NAME = 'berry-agent';

/** 回复轮询工具名（codex `codex-reply` 形镜像） */
export const MCP_POLL_TOOL_NAME = 'berry-agent-reply';

/** 工具面收窄两件（tools/list 应答单源——inputSchema 手写字面静态声明） */
const MCP_TOOLS = [
  {
    name: MCP_PROMPT_TOOL_NAME,
    description: '向 berry-agent 会话发起或续接一条消息（异步档：受理即回执——回复增量经 berry-agent-reply 轮询获取）',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '用户消息正文' },
        sessionId: { type: 'string', description: '续接会话句柄——缺席即新建会话' },
        messageId: {
          type: 'string',
          description: '幂等键（同键同内容重发收执 duplicate 不重跑）——缺席则每次全新',
        },
      },
      required: ['message'],
    },
  },
  {
    name: MCP_POLL_TOOL_NAME,
    description: '轮询会话回复增量（durable 投影——含消息定稿与 run 终态事件；lastSeq 为续读位）',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话句柄' },
        since: {
          type: 'number',
          description: '已收末条 seq（窗口 (since, 高水位]）——缺席 -1 从头取全窗',
        },
      },
      required: ['sessionId'],
    },
  },
] as const;

/* ---------------- 构造面 ---------------- */

/** MCP 面选项 */
export interface McpFaceOptions {
  /** 传输流对（stdio 形 = process stdin/stdout） */
  readonly io: { readonly input: Readable; readonly output: Writable };
  /** 装配桥（host 侧 createServeBridge 产物） */
  readonly bridge: SdkMcpBridge;
  /** serverInfo 披露（name/version——版本真值归宿主装配层） */
  readonly serverInfo: { readonly name: string; readonly version: string };
  /** 诊断日志位（传输面 warn——宿主注入 stderr logger；缺席静默） */
  readonly log?: (message: string) => void;
}

/** MCP 面产物（后端 + 终局 promise + 收口——serve/HTTP 形同族三件） */
export interface McpFaceHandle {
  /** 通道核注册面（UiBackend 契约件——宿主 stack.channels.addBackend 消费） */
  readonly backend: ReturnType<typeof createSdkBackend>['backend'];
  /** 终局（EOF 优雅 0 / 传输面坏死 1）——宿主 await 后走运行时退出序 */
  readonly done: Promise<number>;
  /** 收口（幂等）：解挂输入监听 + 后端 dispose（在飞 ask 保守 cancel + core.close） */
  dispose(): void;
}

/**
 * 起 MCP server 面：一行一 JSON-RPC 消息（请求/通知）进、一行一应答出。
 *
 * 应答写出纪律：MCP 应答帧小量低频（一请求一应答），Node 流内缓冲即背压
 * 界——不设独立队列（serve 直写面的有界队列背压机械不在此复制，量级不配）。
 */
export function runMcpFace(options: McpFaceOptions): McpFaceHandle {
  const log = options.log ?? (() => {});

  // 收集式 sink：MCP 形请求/应答档——无订阅即无直播帧流；应答帧在
  // handleRequest 同步事务内收齐、由工具调用处取走翻译成 MCP 工具结果
  //（协议核应答帧不达 MCP 线——包装层只投影不转发）。
  // capturing 位 = 零直播面的传输边界执法：prompt 自动订阅（13b 落码定形）
  // 会让在飞 run 的活体帧流入本 sink——无 MCP 直播线可承载即弃（返回 true
  // 视为写达，出站队列恒空——背压机械不触发）；仅在 roundTrip 事务内收帧
  let collected: SdkWireFrame[] = [];
  let capturing = false;
  const sink: SdkOutboundSink = {
    write: (frame) => {
      if (capturing) collected.push(frame);
      return true;
    },
  };

  // 协议核单源（admit/先决门/深校验后的受理全在核内；MCP 形无连接级
  // hello——noDelta 无承载位，核选项全缺省）
  const backend = createSdkBackend({ ...options.bridge, sink });

  // 未携幂等键的 prompt 计数（「幂等语义未申请即不虚构」——每次全新）
  let unkeyedSeq = 0;

  /**
   * 经协议核受理一请求并同步取应答帧（映射层薄——全部受理语义单源在核）。
   * 应答缺席 = 核内不变式破（理论不达）——由 {@link translate} 出内部错。
   */
  const roundTrip = (req: SdkRequest): SdkWireFrame | undefined => {
    collected = [];
    capturing = true;
    try {
      backend.core.handleRequest(req);
    } finally {
      capturing = false; // 事务外活体帧一律弃（零直播面——见 sink 位注）
    }
    const frames = collected;
    collected = [];
    return frames[0];
  };

  /** 写一行 JSON-RPC 消息 */
  const writeMessage = (msg: unknown): void => {
    options.io.output.write(`${JSON.stringify(msg)}\n`);
  };
  /** JSON-RPC 成功应答（请求 id 原样回联——string/number 两形皆透传） */
  const writeResult = (id: unknown, result: unknown): void => {
    writeMessage({ jsonrpc: '2.0', id, result });
  };
  const writeError = (id: unknown, code: number, message: string): void => {
    writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
  };
  /** tools/call 工具结果速记（isError 位 = 业务错两分档——非 JSON-RPC error） */
  const writeToolResult = (id: unknown, text: string, isError = false): void => {
    writeResult(id, { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
  };

  /** 应答帧 → MCP 工具结果翻译（ack/entries/error 三投影位——两动词共用） */
  const translate = (frame: SdkWireFrame | undefined, id: unknown, sinceDefault = -1): void => {
    if (frame === undefined) {
      writeError(id, JSONRPC_INTERNAL_ERROR, '协议核应答缺席（内部不变式破）');
      return;
    }
    if (frame.kind === 'error') {
      writeToolResult(id, JSON.stringify({ code: frame.code, message: frame.message }), true);
      return;
    }
    if (frame.kind === 'ack') {
      // ack 投影（受理回执——异步档的会话句柄获取位）
      writeToolResult(
        id,
        JSON.stringify({
          sessionId: frame.sessionId,
          messageId: frame.messageId,
          duplicate: frame.duplicate,
          ...(frame.routedChannel !== undefined ? { routedChannel: frame.routedChannel } : {}),
          highWaterSeq: frame.highWaterSeq,
        }),
      );
      return;
    }
    if (frame.kind === 'entries') {
      // 空窗 lastSeq = 续读位原样回显（无进展不虚报）
      const lastSeq = frame.entries.length > 0 ? frame.entries[frame.entries.length - 1]!.seq : sinceDefault;
      writeToolResult(id, JSON.stringify({ sessionId: frame.sessionId, entries: frame.entries, lastSeq }));
      return;
    }
    // 其余应答帧形理论不达（两动词只产 ack/entries/error）——内部错如实出
    writeError(id, JSONRPC_INTERNAL_ERROR, `意外应答帧形 ${String(frame.kind)}`);
  };

  /** 工具参数 → 深校验请求（同源校验器单源——stdio 解码位/HTTP 体校验位同款） */
  const validate = (id: unknown, raw: unknown): { ok: true; value: SdkRequest } | { ok: false } => {
    const validated = validateSdkRequest(raw);
    if (!validated.ok) {
      writeToolResult(id, `参数不符：${validated.reason}`, true);
      return { ok: false };
    }
    return { ok: true, value: validated.value };
  };

  /** 工具调用 → 协议核动词映射（两件收窄面） */
  const callTool = (id: unknown, name: unknown, args: Record<string, unknown> | undefined): void => {
    if (name === MCP_PROMPT_TOOL_NAME) {
      // 幂等键调用方自选律：缺席 = 计数器形全新键（幂等语义未申请即不虚构）
      const messageId =
        typeof args?.messageId === 'string' && args.messageId !== '' ? args.messageId : `mcp-${++unkeyedSeq}`;
      const v = validate(id, {
        verb: 'prompt',
        messageId,
        content: args?.message,
        ...(typeof args?.sessionId === 'string' ? { sessionId: args.sessionId } : {}),
      });
      if (!v.ok) return;
      translate(roundTrip(v.value), id);
      return;
    }
    if (name === MCP_POLL_TOOL_NAME) {
      // since 缺省 -1 从头哨兵（cursor.ts resolveLiveStart 同款语义）
      const since = typeof args?.since === 'number' ? args.since : -1;
      const v = validate(id, { verb: 'getEntries', sessionId: args?.sessionId, since });
      if (!v.ok) return;
      if (v.value.verb !== 'getEntries') return; // 构造面恒真——纯类型收窄位
      // 分页跟尽义务在调用方（05 §3.4）——本面即调用方：nextCursor 在场即
      // 续读（v1 装配桥并页兑现零游标——环体防御性在场，正常零次执行；
      // 帽 100 防环游标死循环）
      let frame = roundTrip(v.value);
      let hops = 0;
      while (frame !== undefined && frame.kind === 'entries' && frame.nextCursor !== undefined && hops < 100) {
        hops++;
        const more = roundTrip({ ...v.value, cursor: frame.nextCursor });
        if (more === undefined || more.kind !== 'entries') break;
        frame = { ...more, entries: [...frame.entries, ...more.entries] };
      }
      translate(frame, id, since);
      return;
    }
    // 未知工具 = 协议参数错（非业务错——工具面两件闭集外即调用方笔误）
    writeError(
      id,
      JSONRPC_INVALID_PARAMS,
      `未知工具 ${String(name)}（工具面 = ${MCP_PROMPT_TOOL_NAME} / ${MCP_POLL_TOOL_NAME}）`,
    );
  };

  /** 单条 JSON-RPC 消息路由（请求/通知两分） */
  const handleMessage = (msg: unknown): void => {
    if (typeof msg !== 'object' || msg === null) return; // 帧形不理（无 id 可应答）
    const { method, id, params } = msg as { method?: unknown; id?: unknown; params?: unknown };
    // 通知（id 缺席）零应答——notifications/initialized 等一律静默收执
    if (id === undefined) return;
    switch (method) {
      case 'initialize': {
        const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const version =
          typeof requested === 'string' && (MCP_KNOWN_VERSIONS as readonly string[]).includes(requested)
            ? requested // 已知集回显（客户端版本优先）
            : MCP_DEFAULT_VERSION; // 未知/缺席 → 服务端缺省
        writeResult(id, {
          protocolVersion: version,
          capabilities: { tools: {} }, // 工具面在场（listChanged 不发——静态两件）
          serverInfo: options.serverInfo,
        });
        return;
      }
      case 'ping':
        writeResult(id, {});
        return;
      case 'tools/list':
        writeResult(id, { tools: MCP_TOOLS });
        return;
      case 'tools/call': {
        const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
        callTool(
          id,
          p.name,
          typeof p.arguments === 'object' && p.arguments !== null
            ? (p.arguments as Record<string, unknown>)
            : undefined,
        );
        return;
      }
      default:
        writeError(id, JSONRPC_METHOD_NOT_FOUND, `未知方法 ${String(method)}`);
    }
  };

  // —— 收场单次性（EOF 优雅 0 / 输入输出面坏死 1）——
  let settled = false;
  let resolveDone!: (code: number) => void;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });
  const finish = (code: number): void => {
    if (settled) return;
    settled = true;
    options.io.input.removeListener('data', onData);
    options.io.input.removeListener('end', onEnd);
    options.io.input.removeListener('close', onEnd);
    options.io.input.removeListener('error', onInputError);
    options.io.output.removeListener('error', onOutputError);
    backend.dispose();
    resolveDone(code);
  };

  // —— 入站环：分帧（行安全同源件）→ JSON 解析 → 消息路由 ——
  let remainder = '';
  const onData = (chunk: string): void => {
    if (settled) return;
    const split = splitWireLines(chunk, remainder);
    remainder = split.remainder;
    for (const line of split.lines) {
      if (line.length === 0) continue; // 空行不理
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        // 坏行：JSON-RPC 规范形应答（id null——解析失败无从取 id）
        writeError(null, JSONRPC_PARSE_ERROR, '行不是合法 JSON');
        continue;
      }
      handleMessage(msg);
    }
  };
  const onEnd = (): void => finish(0); // EOF = 调用方收线（对端 agent 退出）
  const onInputError = (err: Error): void => {
    log(`stdin 异常：${err.message}`);
    finish(1);
  };
  const onOutputError = (err: Error): void => {
    log(`stdout 异常：${err.message}`);
    finish(1);
  };

  options.io.input.setEncoding?.('utf8');
  options.io.input.on('data', onData);
  options.io.input.on('end', onEnd);
  options.io.input.on('close', onEnd);
  options.io.input.on('error', onInputError);
  options.io.output.on('error', onOutputError);

  return {
    backend: backend.backend,
    done,
    dispose: () => finish(0), // 宿主 closer 消费（信号路优雅档）；幂等
  };
}
