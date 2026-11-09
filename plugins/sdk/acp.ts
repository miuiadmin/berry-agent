/**
 * core:sdk/acp — ACP（Agent Client Protocol）v1 agent 侧包装（03 §10.6 第四
 * 形态·CLI/SDK 进化批 A3 2026-11-09；`berry acp` 入口的件内承载）。
 *
 * 定位：本仓作为 ACP v1 agent 被编辑器/聚合器（Zed/paseo/hapi/t3 型宿主）
 * 驱动——行帧 JSON-RPC 手写反向位（10.1 正向位 + mcp 件反向位同栈第三例，
 * 零新增依赖）。方法词面**逐词对照官方 v1 schema 核验**（2026-11-09 批内
 * web 核验：initialization/session-setup/prompt-turn/tool-calls 四页——
 * protocolVersion 整数 1、`session/request_permission` 带前缀、permission
 * option kind `allow_always`〔非 always_allow〕、stopReason 闭集五值）。
 *
 * 与 MCP 形的分立（03 §10.6 两条款对照）：
 *  - **有直播线**：sink 收 event/ask 帧直推 session/update 通知与
 *    session/request_permission 服务端→客户端请求（MCP 形收集式 sink——零
 *    直播面；ACP 形结构性需要观众位）；
 *  - **审批双向**：ask → request_permission（options 映射 ApprovalDecideAnswer
 *    四值闭集：allow_once→approve / allow_always→always / reject_once→reject /
 *    cancelled→cancel），应答汇入跨入口审批竞速漏斗（serve decide 腿同蒙）；
 *    客户端不答/断线 = 既有 fail-closed 语义不豁免（backend.dispose 保守
 *    unavailable 收口）；
 *  - **prompt 晚应答**：session/prompt 受理得 ack 即挂 pending（ack 不回给
 *    客户端），agent_end 终态到达才以 stopReason 应答（end_turn / cancelled /
 *    错误三形——B-2：session/cancel → interrupt → agent_end(aborted) →
 *    cancelled 收口，官方 MUST「停止按钮不静默失效」）。
 *
 * v1 基线集：initialize / session/new（cwd 受理律 + mcpServers 拒收形）/
 * session/prompt / session/cancel（通知）/ session/load（全量重放 + loadSession
 * 能力位闸）/ session/update（通知外推）/ session/request_permission（审批
 * 双向）。v1 可选方法族（session/resume·close·list、fs/*、terminal/* 等）
 * **不声明即不受理**——未知方法 -32601（挂账随真实客户端需求另裁）。
 */
import type { Readable, Writable } from 'node:stream';
import { isAbsolute } from 'node:path';

import { createSdkBackend, type SdkRequest, type SdkWireFrame } from '../../src/channels/index.js';
import type { SdkHttpBridge } from './types.js';
import type { AgentEvent, ApprovalDecideAnswer } from '../../src/contracts/index.js';
import type { SdkPromptImage } from '../../src/channels/index.js';
import { SDK_PROTOCOL_VERSION } from '../../src/channels/index.js';

/* ---------------- ACP 协议常量（官方 v1 schema 核验位） ---------------- */

/** 已知 protocolVersion 集（v1 = 整数 1——回显制：请求值在集内即回显） */
const ACP_KNOWN_VERSIONS: readonly number[] = [1];

/** 服务端缺省 protocolVersion（请求值不在已知集时回本值——最新支持版） */
const ACP_DEFAULT_VERSION = 1;

/** JSON-RPC 2.0 错误码（协议错档——业务错走 -32000 + data.code 承载） */
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;
/** 服务端业务错档（SDK_/SESSION_ 族经 data.code 直出——协议错/业务错两分律） */
const JSONRPC_SERVER_ERROR = -32000;
/** 连接未初始化（initialize 先行律的执法档） */
const JSONRPC_NOT_INITIALIZED = -32002;

/** 文本块内容帽（tool_call_update content 单块——超长工具输出截断披露） */
const TOOL_CONTENT_CAP_CHARS = 4096;

/** 工具名 → ACP ToolKind 粗分档（呈现提示位——前缀启发，非能力声明） */
function toolKindOf(name: string): string {
  if (/^(read|glob|grep|search|list|ls|cat|head|tail)/.test(name)) return 'read';
  if (/^(write|edit|patch|apply|sed)/.test(name)) return 'edit';
  if (/^(delete|rm|remove|unlink)/.test(name)) return 'delete';
  if (/^(move|rename|mv)/.test(name)) return 'move';
  if (/^(bash|exec|shell|run|spawn|make|npm|pnpm|git)/.test(name)) return 'execute';
  if (/^(fetch|web|http|curl)/.test(name)) return 'fetch';
  if (/^(think|plan)/.test(name)) return 'think';
  return 'other';
}

/** 工具结果 → ACP 内容块族（text 拼接 + 帽截断；image 块直传 image content） */
function toolResultContentOf(result: { content?: readonly unknown[]; isError?: boolean }): unknown[] {
  const blocks: unknown[] = [];
  const textParts: string[] = [];
  if (result.isError === true) textParts.push('[工具报错]');
  for (const block of result.content ?? []) {
    const b = block as { type?: string; text?: string; data?: string; mimeType?: string };
    if (b?.type === 'text' && typeof b.text === 'string') textParts.push(b.text);
    else if (b?.type === 'image' && typeof b.data === 'string')
      blocks.push({ type: 'image', data: b.data, mimeType: b.mimeType ?? 'application/octet-stream' });
  }
  const text = textParts.join('\n');
  if (text !== '') {
    const capped = text.length > TOOL_CONTENT_CAP_CHARS ? `${text.slice(0, TOOL_CONTENT_CAP_CHARS)}\n[超长截断]` : text;
    blocks.unshift({ type: 'text', text: capped });
  }
  return blocks.map((content) => ({ type: 'content', content }));
}

/** ask 帧型窄化速记 */
type AskFrame = Extract<SdkWireFrame, { kind: 'ask' }>;

/* ---------------- 构造面 ---------------- */

/** ACP 面选项（acp-entry 组合根注入——bridge/createSession 与 mcp 形同族） */
export interface AcpFaceOptions {
  /** 传输流对（stdio 形 = process stdin/stdout——一行一 JSON-RPC 消息） */
  readonly io: { readonly input: Readable; readonly output: Writable };
  /** 装配桥（host 侧 createServeBridge 产物——三形态共用形） */
  readonly bridge: SdkHttpBridge;
  /**
   * session/new 的会话铸造位（cwd 受理律：官方 MUST absolute——本位收归一
   * 后铸会话，workspaceRoot 锚即 cwd〔acp-entry 注入 manager.create +
   * canonicalWorkspaceRoot 归一——A4 宿主项目上下文段的发现锚由此而来〕）
   */
  readonly createSession: (cwd: string) => string;
  /** agentInfo 披露（name/version——版本真值归宿主装配层；name 系对外声明值位） */
  readonly serverInfo: { readonly name: string; readonly version: string };
  /** 诊断日志位（传输面 warn——宿主注入 stderr logger；缺席静默） */
  readonly log?: (message: string) => void;
}

/** ACP 面产物（后端 + 终局 promise + 收口——serve/MCP 形同族三件） */
export interface AcpFaceHandle {
  /** 通道核注册面（UiBackend 契约件——宿主 stack.channels.addBackend 消费） */
  readonly backend: ReturnType<typeof createSdkBackend>['backend'];
  /** 协议核观测面（测试/诊断单源——HTTP/MCP 形同款观测位） */
  readonly core: ReturnType<typeof createSdkBackend>['core'];
  /** 终局（EOF 优雅 0 / 传输面坏死 1）——宿主 await 后走运行时退出序 */
  readonly done: Promise<number>;
  /** 收口（幂等）：解挂输入监听 + 后端 dispose（在飞 ask 保守 unavailable + 核关闭） */
  dispose(): void;
}

/**
 * 起 ACP v1 agent 面：一行一 JSON-RPC 消息（请求/通知进、应答/通知/服务端
 * 请求出）。直播线常开（与 MCP 收集式 sink 分立）：event/ask 帧即达即推。
 */
export function runAcpFace(options: AcpFaceOptions): AcpFaceHandle {
  const log = options.log ?? (() => {});

  // —— 连接级状态（行解码环与直播路由共用的单连接状态机位）——
  let closed = false; // 收口幂等位（dispose/EOF/error 三路单次）
  let initialized = false; // initialize 先行律执法位
  let liveMsgCounter = 0; // 直播助手消息 id 游标（message_start 锚定新消息）
  let assistantMessageId: string | undefined; // 当前助手消息 id（chunk 续用锚）
  let serverRequestId = 0; // 服务端→客户端请求 id 游标（request_permission）
  /** roundtrip 应答捕获位（受理事务内收 ack/error/entries/sessions/hello 应答帧；直播帧旁路） */
  let capturingAnswer: { take: (frame: SdkWireFrame) => boolean } | undefined;
  /** pending session/prompt（acp 请求 id 按会话聚桶——agent_end 全桶齐应答；同会话并发 prompt 共桶共终态） */
  const pendingPrompts = new Map<string, unknown[]>();
  /** 在飞 session/request_permission（服务端请求 id → 审批身份） */
  const pendingPermissions = new Map<string, { approvalId: string; sessionId: string }>();

  let doneResolve!: (code: number) => void;
  const done = new Promise<number>((resolve) => {
    doneResolve = resolve;
  });

  const writeMessage = (msg: unknown): void => {
    options.io.output.write(`${JSON.stringify(msg)}\n`);
  };
  const writeResult = (id: unknown, result: unknown): void => {
    writeMessage({ jsonrpc: '2.0', id, result });
  };
  const writeError = (id: unknown, code: number, message: string, data?: unknown): void => {
    writeMessage({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
  };
  const writeUpdate = (sessionId: string, update: unknown): void => {
    writeMessage({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  };

  /**
   * AgentEvent → session/update 序列（映射单源薄层——直播腿专用；重放腿走
   * durable entries 投影 {@link replayUpdatesOf}）。返回 runEnd 位 = 终态
   * 信号（agent_end——pending prompt 收口判据）。
   */
  const updatesOfEvent = (
    event: AgentEvent,
  ): { updates: unknown[]; runEnd?: { status: string; errorMessage?: string } } => {
    const updates: unknown[] = [];
    switch (event.type) {
      case 'message_start':
        // 助手消息锚定新 messageId（user 消息客户端自有——live 不回声）
        if (event.role === 'assistant') assistantMessageId = `msg-live-${++liveMsgCounter}`;
        return { updates };
      case 'message_update': {
        if (event.role !== 'assistant') return { updates };
        const messageId = assistantMessageId ?? `msg-live-${++liveMsgCounter}`;
        const blocks = (event.partial.content ?? []) as readonly { type?: string; text?: string; thinking?: string }[];
        for (const block of blocks) {
          if (block.type === 'text' && block.text !== '')
            updates.push({
              sessionUpdate: 'agent_message_chunk',
              messageId,
              content: { type: 'text', text: block.text },
            });
          else if (block.type === 'thinking' && block.thinking !== '')
            updates.push({
              sessionUpdate: 'agent_thought_chunk',
              messageId,
              content: { type: 'text', text: block.thinking },
            });
        }
        return { updates };
      }
      case 'message_end':
        assistantMessageId = undefined;
        return { updates };
      case 'tool_execution_start':
        updates.push({
          sessionUpdate: 'tool_call',
          toolCallId: event.toolCallId,
          title: event.name,
          name: event.name,
          kind: toolKindOf(event.name),
          status: 'pending',
          rawInput: event.arguments,
        });
        updates.push({ sessionUpdate: 'tool_call_update', toolCallId: event.toolCallId, status: 'in_progress' });
        return { updates };
      case 'tool_execution_update':
        updates.push({
          sessionUpdate: 'tool_call_update',
          toolCallId: event.toolCallId,
          content: [
            {
              type: 'content',
              content: { type: 'text', text: JSON.stringify(event.update).slice(0, TOOL_CONTENT_CAP_CHARS) },
            },
          ],
        });
        return { updates };
      case 'tool_execution_end': {
        const result = event.result as { content?: readonly unknown[]; isError?: boolean };
        updates.push({
          sessionUpdate: 'tool_call_update',
          toolCallId: event.toolCallId,
          status: result.isError === true ? 'failed' : 'completed',
          content: toolResultContentOf(result),
        });
        return { updates };
      }
      case 'agent_end':
        // 终态三形映射：completed→end_turn / aborted→cancelled / failed→错误应答
        return { updates, runEnd: { status: event.status, errorMessage: event.errorMessage } };
      default:
        // turn 族/retry 窗/context_usage 等无 ACP live 投影（节奏与用量位
        // v1 不外推——usage_update 挂账随真实客户端需求）
        return { updates };
    }
  };

  /** agent_end → pending prompt 齐应答（B-2：cancelled 收口律的落码位） */
  const settlePrompts = (sessionId: string, runEnd: { status: string; errorMessage?: string }): void => {
    const bucket = pendingPrompts.get(sessionId);
    if (bucket === undefined) return;
    pendingPrompts.delete(sessionId);
    for (const id of bucket) {
      if (runEnd.status === 'completed') writeResult(id, { stopReason: 'end_turn' });
      else if (runEnd.status === 'aborted') writeResult(id, { stopReason: 'cancelled' });
      else writeError(id, JSONRPC_INTERNAL_ERROR, `run 失败：${runEnd.errorMessage ?? '无错误说明'}`);
    }
  };

  /** ask 帧 → session/request_permission（审批双向外推——options 映射注释见函数体） */
  const forwardPermission = (frame: AskFrame): void => {
    serverRequestId += 1;
    const requestId = `acp-perm-${serverRequestId}`;
    // options 映射（ApprovalDecideAnswer 四值闭集的 UI 形）：「始终允许」仅在
    // suggestedEntry 在场（always 应答的策略表回写目标缺席 = always 视同
    // approve——不虚设档）；reject_always 无对应 answer 不设档
    // B1（04 §9 ② 投影）：suggestions 在场优先（候选集空格呈现形逐条生成
    // allow_always 档——optionId 携索引后缀供 suggestionIndex 映射）；
    // 缺席回落 suggestedEntry 单条（索引 0 语义等价——兼容形不废）
    const alwaysOptions: unknown[] =
      frame.suggestions !== undefined && frame.suggestions.length > 0
        ? frame.suggestions.map((label, index) => ({
            optionId: `allow-always-${index}`,
            name: `始终允许（${label}）`,
            kind: 'allow_always',
          }))
        : frame.suggestedEntry !== undefined
          ? [{ optionId: 'allow-always-0', name: `始终允许（${frame.suggestedEntry}）`, kind: 'allow_always' }]
          : [];
    const acpOptions: unknown[] = [
      ...alwaysOptions,
      { optionId: 'allow-once', name: '允许本次', kind: 'allow_once' },
      { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
    ];
    pendingPermissions.set(requestId, { approvalId: frame.approvalId, sessionId: frame.sessionId });
    writeMessage({
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/request_permission',
      params: {
        sessionId: frame.sessionId,
        toolCall: { toolCallId: frame.approvalId, title: frame.summary },
        options: acpOptions,
      },
    });
  };

  // —— 协议核 + 后端（直播 sink——与 MCP 收集式分立的结构位）——
  const backend = createSdkBackend({
    ...options.bridge,
    sink: {
      write: (frame) => {
        // roundtrip 捕获优先：受理事务内的应答帧（ack/error/entries/sessions/
        // hello）由 roundTrip 取走；其余帧照走直播路由
        if (capturingAnswer?.take(frame) === true) return true;
        switch (frame.kind) {
          case 'event': {
            const { updates, runEnd } = updatesOfEvent(frame.event);
            for (const update of updates) writeUpdate(frame.sessionId, update);
            if (runEnd !== undefined) settlePrompts(frame.sessionId, runEnd);
            return true;
          }
          case 'ask':
            forwardPermission(frame);
            return true;
          default:
            // heartbeat/ack（事务外的迟到应答）/decide-result/error：直播面
            // 零第二动作（诊断位 log——连接级错误帧由 roundTrip 事务内消费）
            return true;
        }
      },
    },
  });

  /**
   * roundtrip：受理一请求并同步取首枚应答帧（ack/error/entries/sessions/
   * hello——ack 恒为 prompt 应答首帧的核级不变量同蒙）；直播帧（event/ask/
   * heartbeat）旁路直播路由不收。受理异常（注册码族 BaseError 含义同 MCP
   * 形收容律）折 error 帧回执——连接存活续答后续请求。
   */
  const roundTrip = (req: SdkRequest): SdkWireFrame | undefined => {
    let answer: SdkWireFrame | undefined;
    let answered = false;
    capturingAnswer = {
      take: (frame: SdkWireFrame): boolean => {
        if (answered) return false;
        if (
          frame.kind === 'ack' ||
          frame.kind === 'error' ||
          frame.kind === 'entries' ||
          frame.kind === 'sessions' ||
          frame.kind === 'hello'
        ) {
          answered = true;
          answer = frame;
          return true;
        }
        return false;
      },
    };
    try {
      backend.core.handleRequest(req);
    } catch (err) {
      // 收容律（MCP 形同款）：已识故障态折 error 帧单请求不连坐；真 bug 面
      // 原样上抛维持崩溃编排 fail-loud
      if (!(err instanceof Error)) throw err;
      log(`请求受理收容（连接存活续答）：${err.message}`);
      answer = {
        kind: 'error',
        sessionId: 'sessionId' in req ? req.sessionId : undefined,
        code: 'SDK_SUBMIT_REJECTED',
        message: err.message,
      };
    } finally {
      capturingAnswer = undefined;
    }
    return answer;
  };

  /** 服务端→客户端请求的应答处置（审批应答映射 + 汇入竞速漏斗） */
  const handleServerResponse = (id: unknown, result: unknown): void => {
    if (typeof id !== 'string') return; // 本面请求 id 恒字符串形（acp-perm-N）
    const pending = pendingPermissions.get(id);
    if (pending === undefined) return; // 非本面请求的应答（理论不达）——静默
    pendingPermissions.delete(id);
    const outcome = (result as { outcome?: { outcome?: string; optionId?: string } } | undefined)?.outcome;
    let answer: ApprovalDecideAnswer;
    let suggestionIndex: number | undefined;
    const optionId = outcome?.outcome === 'selected' ? outcome.optionId : undefined;
    if (optionId === 'allow-once') answer = 'approve';
    else if (optionId !== undefined && optionId.startsWith('allow-always-')) {
      answer = 'always';
      // B1：索引后缀 → suggestionIndex（N-1？否——后缀即原索引，allow-always-0 = 索引 0）
      const parsed = Number(optionId.slice('allow-always-'.length));
      if (Number.isInteger(parsed) && parsed >= 0) suggestionIndex = parsed;
    } else if (optionId === 'reject-once') answer = 'reject';
    else if (outcome?.outcome === 'cancelled') answer = 'cancel';
    else {
      // 未识选项不视为批准（官方安全条款）——保守拒；cancelled 显式映射
      log(`request_permission 未识回复 ${JSON.stringify(outcome) ?? '缺席'}——保守拒`);
      answer = 'reject';
    }
    backend.core.handleRequest({
      verb: 'decide',
      approvalId: pending.approvalId,
      answer,
      ...(suggestionIndex !== undefined ? { suggestionIndex } : {}),
    });
  };

  /** prompt 内容块解析（text 拼接 / image 直传 SdkPromptImage / resource_link 内联文本行） */
  const parsePrompt = (
    blocks: unknown,
  ): { ok: true; text: string; images: SdkPromptImage[] } | { ok: false; reason: string } => {
    if (!Array.isArray(blocks) || blocks.length === 0) return { ok: false, reason: 'prompt 须为非空内容块数组' };
    const textParts: string[] = [];
    const images: SdkPromptImage[] = [];
    for (const block of blocks) {
      const b = block as {
        type?: string;
        text?: string;
        data?: string;
        mimeType?: string;
        uri?: string;
        name?: string;
      };
      if (b?.type === 'text' && typeof b.text === 'string') textParts.push(b.text);
      else if (b?.type === 'image' && typeof b.data === 'string' && typeof b.mimeType === 'string')
        images.push({ data: b.data, mimeType: b.mimeType });
      else if (b?.type === 'resource_link' && typeof b.uri === 'string')
        textParts.push(`[资源] ${b.uri}${typeof b.name === 'string' ? `（${b.name}）` : ''}`);
      else
        return { ok: false, reason: `不支持的内容块类型 ${String(b?.type)}（v1 声明集 = text/image/resource_link）` };
    }
    return { ok: true, text: textParts.join('\n'), images };
  };

  /** mcpServers 拒收执法（v1 有意边界——非空即 -32602 指路插件面；空/缺席受理） */
  const mcpServersRejection = (params: Record<string, unknown>): string | undefined => {
    const servers = params.mcpServers;
    if (servers === undefined || servers === null) return undefined;
    if (Array.isArray(servers) && servers.length === 0) return undefined;
    return 'mcpServers 动态注入 v1 未承载（有意边界——MCP 客户端配置经 berry 插件面装载：plugins 命令族）；如需该能力请向上游反馈';
  };

  /** durable entry → 重放 session/update 序列（session/load 腿——user/assistant 消息 + 工具两族） */
  const replayUpdatesOf = (entry: { type: string; seq: number; data: unknown }): unknown[] => {
    const updates: unknown[] = [];
    const messageId = `msg-${entry.seq}`;
    if (entry.type === 'user/message') {
      const data = entry.data as { content?: unknown };
      const text =
        typeof data.content === 'string'
          ? data.content
          : Array.isArray(data.content)
            ? (data.content as { type?: string; text?: string }[])
                .filter((b) => b?.type === 'text')
                .map((b) => b.text ?? '')
                .join('')
            : '';
      if (text !== '')
        updates.push({ sessionUpdate: 'user_message_chunk', messageId, content: { type: 'text', text } });
      return updates;
    }
    if (entry.type === 'assistant/message') {
      const data = entry.data as { content?: { type?: string; text?: string; thinking?: string }[] };
      for (const block of data.content ?? []) {
        if (block?.type === 'text' && block.text !== '')
          updates.push({
            sessionUpdate: 'agent_message_chunk',
            messageId,
            content: { type: 'text', text: block.text },
          });
        else if (block?.type === 'thinking' && block.thinking !== '')
          updates.push({
            sessionUpdate: 'agent_thought_chunk',
            messageId,
            content: { type: 'text', text: block.thinking },
          });
      }
      return updates;
    }
    if (entry.type === 'tool/call') {
      const data = entry.data as { callId?: string; name?: string; arguments?: unknown };
      if (typeof data.callId === 'string' && typeof data.name === 'string') {
        updates.push({
          sessionUpdate: 'tool_call',
          toolCallId: data.callId,
          title: data.name,
          name: data.name,
          kind: toolKindOf(data.name),
          status: 'pending',
          rawInput: data.arguments,
        });
      }
      return updates;
    }
    if (entry.type === 'tool/result') {
      const data = entry.data as { callId?: string; result?: { content?: readonly unknown[]; isError?: boolean } };
      if (typeof data.callId === 'string' && data.result !== undefined) {
        updates.push({
          sessionUpdate: 'tool_call_update',
          toolCallId: data.callId,
          status: data.result.isError === true ? 'failed' : 'completed',
          content: toolResultContentOf(data.result),
        });
      }
      return updates;
    }
    return updates; // 其余 durable 词（turn/request/approval 族等）无 ACP 重放投影
  };

  /** 请求分派（行解码后——initialize 先行律执法在首） */
  const dispatch = (msg: {
    method?: unknown;
    params?: unknown;
    id?: unknown;
    result?: unknown;
    error?: unknown;
  }): void => {
    // 服务端→客户端请求的应答（无 method 有 id）——审批应答处置
    if (msg.method === undefined && msg.id !== undefined) {
      if (msg.error !== undefined) {
        // 客户端拒答（应答面错误）——保守 cancel（挂起审批不悬死）
        const pending = pendingPermissions.get(String(msg.id));
        if (pending !== undefined) {
          pendingPermissions.delete(String(msg.id));
          backend.core.handleRequest({ verb: 'decide', approvalId: pending.approvalId, answer: 'cancel' });
        }
        return;
      }
      handleServerResponse(msg.id, msg.result);
      return;
    }
    if (typeof msg.method !== 'string') return; // 坏形静默（行级错误已在解码位报）
    const id = msg.id;
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const hasId = id !== undefined;
    // initialize 先行律（除 initialize 本身外一切请求先过闸）
    if (!initialized && msg.method !== 'initialize') {
      if (hasId) writeError(id, JSONRPC_NOT_INITIALIZED, '未初始化——必须先调 initialize');
      return;
    }
    switch (msg.method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        const chosen =
          typeof requested === 'number' && ACP_KNOWN_VERSIONS.includes(requested) ? requested : ACP_DEFAULT_VERSION;
        initialized = true;
        if (hasId) {
          writeResult(id, {
            protocolVersion: chosen,
            // 能力位诚实律：只声明实支持位（loadSession ✓ / image ✓；
            // audio/embeddedContext、mcpCapabilities 未承载不虚报）
            agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
            agentInfo: {
              name: options.serverInfo.name,
              title: options.serverInfo.name,
              version: options.serverInfo.version,
            },
            authMethods: [],
          });
        }
        return;
      }
      case 'session/new': {
        const cwd = params.cwd;
        if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) {
          if (hasId) writeError(id, JSONRPC_INVALID_PARAMS, 'cwd 必须为非空绝对路径（官方 v1 MUST absolute）');
          return;
        }
        const mcpRejection = mcpServersRejection(params);
        if (mcpRejection !== undefined) {
          if (hasId) writeError(id, JSONRPC_INVALID_PARAMS, mcpRejection);
          return;
        }
        try {
          const sessionId = options.createSession(cwd);
          if (hasId) writeResult(id, { sessionId });
        } catch (err) {
          if (hasId)
            writeError(id, JSONRPC_SERVER_ERROR, `会话创建失败：${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      case 'session/prompt': {
        const sessionId = params.sessionId;
        if (typeof sessionId !== 'string' || sessionId === '') {
          if (hasId)
            writeError(id, JSONRPC_INVALID_PARAMS, 'sessionId 必填（新会话走 session/new——官方 v1 恒携带恒续接语义）');
          return;
        }
        const parsed = parsePrompt(params.prompt);
        if (!parsed.ok) {
          if (hasId) writeError(id, JSONRPC_INVALID_PARAMS, parsed.reason);
          return;
        }
        serverRequestId += 1;
        const frame = roundTrip({
          verb: 'prompt',
          messageId: `acp-${serverRequestId}`,
          content: parsed.text,
          ...(parsed.images.length > 0 ? { images: parsed.images } : {}),
          sessionId,
        });
        if (frame === undefined) {
          if (hasId) writeError(id, JSONRPC_INTERNAL_ERROR, '协议核无回复（内部不变式破）');
          return;
        }
        if (frame.kind === 'error') {
          if (hasId) writeError(id, JSONRPC_SERVER_ERROR, frame.message, { code: frame.code });
          return;
        }
        if (frame.kind !== 'ack') {
          if (hasId) writeError(id, JSONRPC_INTERNAL_ERROR, `意外回复帧形 ${String(frame.kind)}`);
          return;
        }
        // ack 到手：挂 pending 晚应答（agent_end 终态到达才 stopReason 收口）；
        // duplicate 幂等重收执同蒙（原次提交的终态统一收口本桶）
        if (hasId) {
          const bucket = pendingPrompts.get(sessionId) ?? [];
          bucket.push(id);
          pendingPrompts.set(sessionId, bucket);
        }
        return;
      }
      case 'session/cancel': {
        // 标准通知位（无应答通道）：interrupt 同蒙——agent_end(aborted) 以
        // cancelled stopReason 收口原 session/prompt（官方 MUST）
        const sessionId = params.sessionId;
        if (typeof sessionId === 'string' && sessionId !== '') {
          roundTrip({ verb: 'interrupt', sessionId });
        }
        return;
      }
      case 'session/load': {
        const sessionId = params.sessionId;
        if (typeof sessionId !== 'string' || sessionId === '') {
          if (hasId) writeError(id, JSONRPC_INVALID_PARAMS, 'sessionId 必填');
          return;
        }
        const mcpRejection = mcpServersRejection(params);
        if (mcpRejection !== undefined) {
          if (hasId) writeError(id, JSONRPC_INVALID_PARAMS, mcpRejection);
          return;
        }
        // 全量重放（官方 MUST replay 整段对话——无游标参数，增量合并归客户端）
        const frame = roundTrip({ verb: 'getEntries', sessionId, since: -1 });
        if (frame === undefined) {
          if (hasId) writeError(id, JSONRPC_INTERNAL_ERROR, '协议核无回复（内部不变式破）');
          return;
        }
        if (frame.kind === 'error') {
          if (hasId) writeError(id, JSONRPC_SERVER_ERROR, frame.message, { code: frame.code });
          return;
        }
        if (frame.kind !== 'entries') {
          if (hasId) writeError(id, JSONRPC_INTERNAL_ERROR, `意外回复帧形 ${String(frame.kind)}`);
          return;
        }
        let lastSeq = -1;
        for (const entry of frame.entries) {
          lastSeq = Math.max(lastSeq, entry.seq);
          for (const update of replayUpdatesOf(entry)) writeUpdate(sessionId, update);
        }
        // 直播订阅挂接（hello after=尾 seq：重放窗已手动消费——建流零重放；
        // 未决 ask 重推经直播路由转发 request_permission——重连客户端的正当补推）
        roundTrip({ verb: 'hello', protocolVersion: SDK_PROTOCOL_VERSION, sessionId, after: lastSeq });
        if (hasId) writeResult(id, {});
        return;
      }
      default:
        // v1 可选方法族不声明即不受理（session/resume·close·list、fs/*、
        // terminal/* 等——挂账随真实客户端需求另裁）
        if (hasId) writeError(id, JSONRPC_METHOD_NOT_FOUND, `方法未受理：${msg.method}（v1 声明集外）`);
        return;
    }
  };

  // —— 行帧解码环（一行一 JSON-RPC——坏行 -32700；通知无 id 不应答）——
  let buffer = '';
  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line !== '') {
        try {
          dispatch(JSON.parse(line) as Parameters<typeof dispatch>[0]);
        } catch (err) {
          if (err instanceof SyntaxError) {
            writeMessage({
              jsonrpc: '2.0',
              id: null,
              error: { code: JSONRPC_PARSE_ERROR, message: `坏行（非合法 JSON）：${err.message}` },
            });
          } else {
            log(`分派异常：${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      newline = buffer.indexOf('\n');
    }
  };
  const onEnd = (): void => {
    shutdown(0); // EOF 优雅 0——调用方收线
  };
  const onError = (err: Error): void => {
    log(`传输面坏死：${err.message}`);
    shutdown(1);
  };
  options.io.input.on('data', onData);
  options.io.input.on('end', onEnd);
  options.io.input.on('error', onError);

  /** 收口（幂等——closed 单闸）：直播线撤挂 + 后端 dispose（在飞 ask 保守 unavailable + 核关闭） */
  const shutdown = (code: number): void => {
    if (closed) return;
    closed = true;
    options.io.input.off('data', onData);
    options.io.input.off('end', onEnd);
    options.io.input.off('error', onError);
    backend.dispose(); // 在飞 ask 全部 unavailable 收场 + core.close（后续静默）
    doneResolve(code);
  };

  return {
    backend: backend.backend,
    core: backend.core,
    done,
    dispose(): void {
      shutdown(0);
    },
  };
}
