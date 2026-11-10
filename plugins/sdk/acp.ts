/**
 * sdk/acp — ACP server 包装（core:sdk 件第四形态——03 §10.6 2026-11-09 ACP 形态批）。
 *
 * 本仓作为 ACP（Zed Agent Client Protocol v1）server 被 ACP 客户端（hapi 等）
 * 经 stdio 调用：NDJSON 行帧 JSON-RPC 2.0 手写（mcp.ts 反向位的同栈第三复用，
 * 零新增依赖）。与 MCP 异步档分立，本形态 = **直播档**：
 * - `session/prompt` 请求挂到 run 终态才回执（stopReason/usage 映射单源在本件）；
 * - 直播信封经 UiBackend.onEnvelope 翻译为 `session/update` 通知
 *   （agent_message_chunk/agent_thought_chunk 累积快照剥 delta——线协议七原则①
 *   同律；tool_call+tool_call_update 双段；usage_update 自 context_usage）；
 * - 审批有应答通道：ask → agent→client 请求 `session/request_permission`，
 *   连接收口在飞 ask 全部 unavailable（通道消失语义——04 §9 与 SDK 形同律）。
 *
 * 档位/模型轴（形态批「会话与档位映射」条）：
 * - set_mode 轴 = 沙箱轴（default/read_only/accept_edits/dont_ask →
 *   workspace-write/read-only/workspace-write/danger，经注入面落 durable 事件）；
 *   审批策略不随 modeId 切换——ask 恒外推由客户端裁决。
 * - 模型轴 = config option 契约（session/new 响应携 models 块 + id='model'
 *   的 configOptions；set_config_option('model')/set_model 落 durable 事件，
 *   响应必填回显 configOptions——ACP schema 强制）。
 *
 * stdout 只出协议帧（诊断全走 log 回调——宿主接 stderr）；initialize 幂等
 * （客户端重试容忍）；受理段注册码族 BaseError 按请求折 -32602 错误帧连接
 * 存活，非注册码异常上抛维持崩溃编排 fail-loud（三传输受理收容律的 ACP 腿）。
 * `session/cancel` 系通知（无应答）→ interruptSession。mcpServers 参数收而
 * 不用（v1 不桥接 MCP——诚实注记）。
 */
import type { Readable, Writable } from 'node:stream';

import type { ApprovalAskAnswer, ApprovalAskRequest, SessionEnvelope, UiBackend } from '../../src/channels/index.js';
import { splitWireLines } from '../../src/channels/index.js';
import { BaseError } from '../../src/contracts/index.js';
import type { AgentEvent } from '../../src/contracts/index.js';

/** ACP stopReason 闭集（schema 枚举——berry run 终态的单源映射产物业态） */
export type AcpStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'cancelled';

/** prompt 受理产物：run 终态三元组直投（failed 携错误摘要——面侧外显）；
 * ignored = 未起跑档（inject/拒收） */
export type AcpSubmitOutcome =
  | {
      readonly kind: 'run';
      readonly status: 'completed' | 'aborted' | 'failed';
      readonly stopReason?: string;
      /** failed 形的错误文本（RunResult.errorMessage——面侧发 agent_message_chunk 外显） */
      readonly errorMessage?: string;
    }
  | { readonly kind: 'ignored' };

/** prompt 终值用量（agent_end 终值富化位直投——input/output/reasoning/cache 桶） */
export interface AcpPromptUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly thoughtTokens?: number;
  readonly cachedReadTokens?: number;
  readonly cachedWriteTokens?: number;
}

/**
 * 结构化注入面（host 侧闭包组装——件不 import 宿主实现铁律的 ACP 形兑现；
 * 沙箱档位用字面联合（与 SandboxMode 同形）避免件区越边 import）。
 */
export interface AcpFaceDeps {
  /** 新建会话（工作区锚在 host 闭包内合成）——回 sessionId */
  createSession(): string;
  /** 续接会话（幂等 open）；行缺席时抛（注册码族 BaseError） */
  openSession(sessionId: string): void;
  /** 提交一轮输入并等 run 终态（直播翻译并行进行——回执以本 Promise 为准） */
  submitPrompt(input: { readonly sessionId: string; readonly content: string }): Promise<AcpSubmitOutcome>;
  /** 打断在飞 run（session/cancel 通知的消费位） */
  interruptSession(sessionId: string): void;
  /** 会话清单投影（title 已净化；null = 诚实缺席） */
  listSessions(): ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly lastActivityAt: number;
  }>;
  /** 沙箱档位切换（durable 事件落账在 host 闭包） */
  setSandboxMode(sessionId: string, mode: 'read-only' | 'workspace-write' | 'danger'): void;
  /** 模型切换（`provider/model` 全形语法校验 fail-loud 在 host 闭包） */
  setModelSpec(sessionId: string, spec: string): void;
  /** 模型目录（listModels 投影） */
  modelCatalog(): ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** 会话生效模型（三级优先序的只读投影在 host 闭包） */
  modelOf(sessionId: string): string;
}

export interface AcpFaceOptions {
  readonly io: { readonly input: Readable; readonly output: Writable };
  readonly deps: AcpFaceDeps;
  /** serverInfo 自报家门（agentInfo.name/version——name 属对外声明值位） */
  readonly serverInfo: { readonly name: string; readonly version: string };
  /** 诊断回调（宿主接 stderr——stdout 只出协议帧） */
  readonly log?: (message: string) => void;
}

export interface AcpFaceHandle {
  /** 通道核注册面（UiBackend 契约件——信封回流自动馈送） */
  readonly backend: UiBackend<never>;
  /** 收场退出码：0 = EOF/信号优雅收场；1 = 传输面坏死 */
  readonly done: Promise<number>;
  /** 连接收口：在飞 ask 全部 unavailable + 在飞 agent→client 请求拒绝 + 停读 */
  dispose(): void;
}

/* ---------------- ACP 协议常量（JSON-RPC 2.0——mcp.ts 同集） ---------------- */

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_METHOD_NOT_FOUND = -32601;

/** 未知方法（dispatch 抛出 → handleRequest 折 -32601 帧——协议错档） */
class AcpMethodNotFound extends Error {}

/** 参数校验拒（params 形/闭集/受理前置——折 -32602 帧 invalid_params 档） */
class AcpInvalidParams extends Error {}
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

/** ACP v1（Zed Agent Client Protocol——协议版本整数位） */
const ACP_PROTOCOL_VERSION = 1;

/** set_mode 的 modeId → 沙箱档闭集（形态批「会话与档位映射」条单源） */
const SANDBOX_BY_ACP_MODE: Readonly<Record<string, 'read-only' | 'workspace-write' | 'danger'>> = {
  default: 'workspace-write',
  read_only: 'read-only',
  accept_edits: 'workspace-write',
  dont_ask: 'danger',
};

/** 工具名 → ACP tool kind 启发映射（缺省 'other'——呈现分类非语义承诺） */
function acpToolKind(name: string, args: Record<string, unknown>): string {
  const lower = name.toLowerCase();
  if (typeof args.command === 'string' || lower.includes('bash') || lower.includes('exec') || lower.includes('run')) {
    return 'execute';
  }
  if (typeof args.url === 'string' || lower.includes('fetch') || lower.includes('web') || lower.includes('browser')) {
    return 'fetch';
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('find') || lower.includes('list')) {
    return 'search';
  }
  if (typeof args.path === 'string') {
    if (
      typeof args.content === 'string' ||
      typeof args.newText === 'string' ||
      lower.includes('write') ||
      lower.includes('edit')
    ) {
      return 'edit';
    }
    return 'read';
  }
  return 'other';
}

/** 工具标题：名 + 主参数预览（人话构造——hermes acp_adapter 同形精神） */
function acpToolTitle(name: string, args: Record<string, unknown>): string {
  const keys = ['command', 'path', 'file', 'pattern', 'query', 'url', 'skill', 'name'];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) {
      const preview = value.length > 80 ? `${value.slice(0, 77)}...` : value;
      return `${name}: ${preview}`;
    }
  }
  return name;
}

/** 累积快照剥 delta（线协议七原则① 在 ACP 面的兑现——前缀生长取尾差，回退取全量） */
function deltaOf(previous: string, current: string): { delta: string; next: string } {
  if (current.startsWith(previous)) {
    return { delta: current.slice(previous.length), next: current };
  }
  return { delta: current, next: current };
}

/** 内部收场信号（传输面坏死——写出抛错/流错误） */
class AcpTransportError extends Error {}

/**
 * 造 ACP face（每连接一枚——stdio 单客户端形态本体）。
 *
 * 传输环：入站 splitWireLines 分帧 → JSON.parse → 请求/通知/应答三路分派
 * （坏行 -32700 应答〔id null 形〕、非对象静默跳过）；出站 = 行帧直写
 * （协议帧单源——写出抛错即传输面坏死收场退 1）。
 */
export function runAcpFace(options: AcpFaceOptions): AcpFaceHandle {
  const { io, deps, serverInfo } = options;
  const log = options.log ?? (() => {});

  let closed = false;
  let lineRemainder = '';
  /** agent→client 请求账（id → 落定器——应答帧/收口两路消费） */
  const pendingClientRequests = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  /** 未决审批账（approvalId → 落定器——收口时全部 unavailable） */
  const pendingAsks = new Map<string, (answer: ApprovalAskAnswer) => void>();
  /** 在飞 prompt 账（sessionId → true——并发 prompt 拒收判据） */
  const inflightPrompts = new Set<string>();
  /** 本 face 经手的会话集（信封过滤——后台 job 会话零外泄） */
  const knownSessions = new Set<string>();
  /** 会话级消息累积快照（delta 剥取基线——message_start 重置） */
  const streamBaseline = new Map<string, { text: string; thinking: string }>();
  /** 会话级末次 run 用量（prompt 回执富化位） */
  const lastUsage = new Map<string, AcpPromptUsage>();

  /* ---------------- 出站原语（stdout 只出协议帧——行帧直写 + 背压） ---------------- */

  /**
   * 写出背压（生产冒烟教训：session/new 响应可达数百 KB〔模型目录未瘦身
   * 前实测 236KB〕——write() 返 false 后继续裸写会在慢管道上无界缓冲）。
   * 返 false 即入「待排空」态：本帧后的写出挂起排队，'drain' 事件恢复
   * 顺序写出；排空超帽（5s）判传输面坏死收场退 1（与 AcpTransportError
   * 收口路径同族）。帧序保持——排空窗内新帧一律入队不插队。
   */
  let draining = false;
  const drainQueue: string[] = [];
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  const DRAIN_TIMEOUT_MS = 5_000;

  function armDrainTimeout(): void {
    if (drainTimer !== null) return;
    drainTimer = setTimeout(() => {
      // 排空超帽——传输面坏死（'drain' 永不到来）：清队收场退 1
      log('acp: output drain timeout — transport dead');
      shutdown(1);
    }, DRAIN_TIMEOUT_MS);
  }

  function pumpQueue(): void {
    while (!draining && drainQueue.length > 0 && !closed) {
      const next = drainQueue.shift() as string;
      if (!io.output.write(next)) {
        draining = true;
        armDrainTimeout();
        return;
      }
    }
    if (drainQueue.length === 0 && drainTimer !== null) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
  }

  io.output.on('drain', () => {
    draining = false;
    if (drainTimer !== null) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    pumpQueue();
  });

  function writeFrame(payload: unknown): void {
    if (closed) return;
    const frame = `${JSON.stringify(payload)}\n`;
    if (draining || drainQueue.length > 0) {
      drainQueue.push(frame);
      return;
    }
    if (!io.output.write(frame)) {
      draining = true;
      armDrainTimeout();
    }
  }

  function sendResult(id: number | string | null, result: unknown): void {
    writeFrame({ jsonrpc: '2.0', id, result });
  }

  function sendError(id: number | string | null, code: number, message: string): void {
    writeFrame({ jsonrpc: '2.0', id, error: { code, message } });
  }

  function notify(method: string, params: unknown): void {
    writeFrame({ jsonrpc: '2.0', method, params });
  }

  /** agent→client 请求（session/request_permission 一族——id 自增账） */
  let nextRequestId = 1;
  function requestClient<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (closed) {
        reject(new AcpTransportError('acp face is closed'));
        return;
      }
      const id = nextRequestId++;
      pendingClientRequests.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      });
      writeFrame({ jsonrpc: '2.0', id, method, params });
    });
  }

  /* ---------------- 模型目录投影（models 块 + config option 双面单源） ---------------- */

  function modelsBlock(sessionId: string): {
    availableModels: Array<{ modelId: string; name: string }>;
    currentModelId: string;
  } {
    return {
      availableModels: deps.modelCatalog().map((model) => ({ modelId: model.id, name: model.name })),
      currentModelId: deps.modelOf(sessionId),
    };
  }

  function modelConfigOptions(sessionId: string): Array<Record<string, unknown>> {
    return [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        category: 'model',
        currentValue: deps.modelOf(sessionId),
        options: deps.modelCatalog().map((model) => ({ value: model.id, name: model.name })),
      },
    ];
  }

  /** 会话应答公共块（new/resume 同构——sessionId + models + configOptions） */
  function sessionResponse(sessionId: string): Record<string, unknown> {
    knownSessions.add(sessionId);
    return {
      sessionId,
      models: modelsBlock(sessionId),
      configOptions: modelConfigOptions(sessionId),
    };
  }

  /* ---------------- 信封翻译（backend.onEnvelope 消费——直播档本体） ---------------- */

  function sessionUpdate(sessionId: string, update: Record<string, unknown>): void {
    if (!knownSessions.has(sessionId)) return;
    notify('session/update', { sessionId, update });
  }

  /** AssistantMessage 形判取（partial 累积快照——text/thinking 双轨剥 delta） */
  function translateStreamEvent(sessionId: string, event: AgentEvent): void {
    const baseline = streamBaseline.get(sessionId) ?? { text: '', thinking: '' };
    if (event.type === 'message_start') {
      if (event.role === 'assistant') {
        streamBaseline.set(sessionId, { text: '', thinking: '' });
      }
      return;
    }
    if (event.type === 'message_update' || event.type === 'message_end') {
      const message = event.type === 'message_end' ? event.message : event.partial;
      if (message === null || typeof message !== 'object' || (message as { role?: unknown }).role !== 'assistant') {
        return;
      }
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) return;
      let text = '';
      let thinking = '';
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue;
        const typed = block as { type?: unknown; text?: unknown; thinking?: unknown };
        if (typed.type === 'text' && typeof typed.text === 'string') text += typed.text;
        if (typed.type === 'thinking' && typeof typed.thinking === 'string') thinking += typed.thinking;
      }
      const textDelta = deltaOf(baseline.text, text);
      const thinkingDelta = deltaOf(baseline.thinking, thinking);
      baseline.text = textDelta.next;
      baseline.thinking = thinkingDelta.next;
      streamBaseline.set(sessionId, baseline);
      if (thinkingDelta.delta.length > 0) {
        sessionUpdate(sessionId, {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: thinkingDelta.delta },
        });
      }
      if (textDelta.delta.length > 0) {
        sessionUpdate(sessionId, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: textDelta.delta },
        });
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      const locations: Array<Record<string, unknown>> = [];
      const path = event.arguments?.path;
      if (typeof path === 'string' && path.length > 0) locations.push({ path });
      sessionUpdate(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: event.toolCallId,
        title: acpToolTitle(event.name, event.arguments ?? {}),
        kind: acpToolKind(event.name, event.arguments ?? {}),
        ...(locations.length > 0 ? { locations } : {}),
        rawInput: event.arguments ?? {},
      });
      return;
    }
    if (event.type === 'tool_execution_update') {
      if (typeof event.update === 'string' && event.update.length > 0) {
        sessionUpdate(sessionId, {
          sessionUpdate: 'tool_call_update',
          toolCallId: event.toolCallId,
          content: [{ type: 'content', content: { type: 'text', text: event.update } }],
        });
      }
      return;
    }
    if (event.type === 'tool_execution_end') {
      const content = Array.isArray(event.result.content) ? event.result.content : [];
      const textBlocks: string[] = [];
      for (const block of content) {
        if (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text') {
          const text = (block as { text?: unknown }).text;
          if (typeof text === 'string') textBlocks.push(text);
        }
      }
      sessionUpdate(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.toolCallId,
        status: event.result.isError === true ? 'failed' : 'completed',
        content: textBlocks.map((text) => ({ type: 'content', content: { type: 'text', text } })),
        rawOutput: textBlocks.join('\n'),
      });
      return;
    }
    if (event.type === 'context_usage') {
      if (typeof event.usedTokens === 'number' && typeof event.maxTokens === 'number' && event.maxTokens > 0) {
        sessionUpdate(sessionId, {
          sessionUpdate: 'usage_update',
          used: event.usedTokens,
          size: event.maxTokens,
        });
      }
      return;
    }
    if (event.type === 'agent_end') {
      const usage = (
        event as {
          usage?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
        }
      ).usage;
      if (usage && typeof usage.input === 'number' && typeof usage.output === 'number') {
        lastUsage.set(sessionId, {
          inputTokens: usage.input,
          outputTokens: usage.output,
          totalTokens: usage.input + usage.output,
          ...(typeof usage.reasoning === 'number' ? { thoughtTokens: usage.reasoning } : {}),
          ...(typeof usage.cacheRead === 'number' ? { cachedReadTokens: usage.cacheRead } : {}),
          ...(typeof usage.cacheWrite === 'number' ? { cachedWriteTokens: usage.cacheWrite } : {}),
        });
      }
      return;
    }
    // agent_start/turn_*/retry_wait_* 不外推（prompt 生命周期回执单源在 run 终态）。
  }

  /* ---------------- UiBackend 实装（approval capable——有应答通道形态本体） ---------------- */

  const backend: UiBackend<never> = {
    id: 'acp',
    capabilities: {
      notify: false,
      confirm: false,
      select: false,
      input: false,
      approval: true,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => !closed,
    notify: () => {},
    onEnvelope: (env: SessionEnvelope) => {
      try {
        translateStreamEvent(env.sessionId, env.event);
      } catch (error) {
        // 翻译段单条失败只降级本条（信封流持续——单帧坏形不杀连接）。
        log(`acp: envelope translate failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    askApproval: (sessionId: string, request: ApprovalAskRequest) =>
      new Promise<ApprovalAskAnswer>((resolve) => {
        if (closed) {
          resolve('unavailable');
          return;
        }
        const approvalId = request.approvalId ?? `acp-${pendingAsks.size + 1}`;
        pendingAsks.set(approvalId, resolve);
        const summaryText = request.reason ?? request.summary;
        void requestClient<{ outcome?: { outcome?: string; optionId?: string } }>('session/request_permission', {
          sessionId,
          toolCall: {
            toolCallId: `perm-${approvalId}`,
            title: request.summary,
            kind: 'other',
            status: 'pending',
            content: [{ type: 'content', content: { type: 'text', text: summaryText } }],
          },
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
          ],
        })
          .then((response) => {
            pendingAsks.delete(approvalId);
            const outcome = response?.outcome?.outcome;
            if (outcome === 'cancelled') {
              resolve('cancel');
              return;
            }
            switch (response?.outcome?.optionId) {
              case 'allow_once':
                resolve('approve');
                return;
              case 'allow_always':
                resolve('always');
                return;
              default:
                // reject 与未知 optionId 一律拒绝（fail-closed）。
                resolve('reject');
            }
          })
          .catch(() => {
            pendingAsks.delete(approvalId);
            // 通道消失语义（04 §9）——连接收口/请求失败即无人可答。
            resolve('unavailable');
          });
      }),
  };

  /* ---------------- 请求分派（受理段收容律——注册码折帧连接存活） ---------------- */

  function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new AcpInvalidParams(`params.${field} must be a non-empty string`);
    }
    return value;
  }

  async function handleRequest(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await dispatch(method, params);
      sendResult(id, result);
    } catch (error) {
      if (error instanceof AcpMethodNotFound) {
        sendError(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${error.message}`);
        return;
      }
      if (error instanceof BaseError) {
        // 注册码族按请求收容（连接存活续答后续动词——三传输收容律 ACP 腿）。
        log(`acp: request rejected: ${error.message}`);
        sendError(
          id,
          JSONRPC_INVALID_PARAMS,
          `${(error as BaseError & { code?: string }).code ?? 'ERROR'}: ${error.message}`,
        );
        return;
      }
      if (error instanceof AcpTransportError) {
        throw error;
      }
      if (error instanceof AcpInvalidParams) {
        sendError(id, JSONRPC_INVALID_PARAMS, error.message);
        return;
      }
      // 非注册码异常维持崩溃编排 fail-loud（未知 bug 不吞）。
      sendError(id, JSONRPC_INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function dispatch(method: string, paramsRaw: unknown): Promise<unknown> {
    const params = (typeof paramsRaw === 'object' && paramsRaw !== null ? paramsRaw : {}) as Record<string, unknown>;

    if (method === 'initialize') {
      // 幂等（客户端重试容忍——直接再回一次响应）。
      return {
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentInfo: { name: serverInfo.name, version: serverInfo.version },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {},
          sessionCapabilities: { resume: {}, list: {} },
        },
      };
    }

    if (method === 'ping') {
      return {};
    }

    if (method === 'session/new') {
      requireString(params.cwd, 'cwd');
      // mcpServers 收而不用（v1 不桥接 MCP——形态批诚实注记）。
      const sessionId = deps.createSession();
      return sessionResponse(sessionId);
    }

    if (method === 'session/resume') {
      const sessionId = requireString(params.sessionId, 'sessionId');
      deps.openSession(sessionId);
      return sessionResponse(sessionId);
    }

    if (method === 'session/prompt') {
      const sessionId = requireString(params.sessionId, 'sessionId');
      const prompt = params.prompt;
      if (!Array.isArray(prompt)) {
        throw new AcpInvalidParams('params.prompt must be an array of content blocks');
      }
      let text = '';
      for (const block of prompt) {
        if (typeof block !== 'object' || block === null) continue;
        const typed = block as { type?: unknown; text?: unknown };
        if (typed.type === 'text' && typeof typed.text === 'string') {
          text += typed.text;
        } else {
          // 图像/资源块 v1 不受渡（promptCapabilities 未声明 image——诚实拒）。
          throw new AcpInvalidParams('params.prompt only supports text content blocks in v1');
        }
      }
      if (text.length === 0) {
        throw new AcpInvalidParams('params.prompt must carry at least one text block');
      }
      if (inflightPrompts.has(sessionId)) {
        throw new AcpInvalidParams('a prompt is already in flight for this session');
      }
      knownSessions.add(sessionId);
      inflightPrompts.add(sessionId);
      let outcome: AcpSubmitOutcome;
      try {
        outcome = await deps.submitPrompt({ sessionId, content: text });
      } finally {
        inflightPrompts.delete(sessionId);
      }
      // run 终态 → ACP stopReason 单源映射（形态批「直播档」条）。
      let stopReason: AcpStopReason;
      if (outcome.kind === 'ignored') {
        // 未起跑档（inject/拒收）——ACP 无对应语义，按轮结束回执。
        stopReason = 'end_turn';
      } else if (outcome.status === 'completed') {
        stopReason = outcome.stopReason === 'length' ? 'max_tokens' : 'end_turn';
      } else if (outcome.status === 'aborted') {
        stopReason = 'cancelled';
      } else {
        stopReason = 'refusal';
        // 失败外显（生产冒烟教训：Provider 未配等模型层错误若无输出，
        // 客户端只见空回复零错因——错误文本随 agent_message_chunk 发出，
        // stopReason='refusal' 只是分类不是诊断面）。
        if (outcome.errorMessage !== undefined && outcome.errorMessage.length > 0) {
          sessionUpdate(sessionId, {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `[error] ${outcome.errorMessage}` },
          });
        }
      }
      const usage = lastUsage.get(sessionId);
      return { stopReason, ...(usage !== undefined ? { usage } : {}) };
    }

    if (method === 'session/set_mode') {
      const sessionId = requireString(params.sessionId, 'sessionId');
      const modeId = requireString(params.modeId, 'modeId');
      const sandbox = SANDBOX_BY_ACP_MODE[modeId];
      if (sandbox === undefined) {
        throw new AcpInvalidParams(`params.modeId must be one of: ${Object.keys(SANDBOX_BY_ACP_MODE).join(', ')}`);
      }
      deps.setSandboxMode(sessionId, sandbox);
      return {};
    }

    if (method === 'session/set_model') {
      const sessionId = requireString(params.sessionId, 'sessionId');
      const modelId = requireString(params.modelId, 'modelId');
      deps.setModelSpec(sessionId, modelId);
      return {};
    }

    if (method === 'session/set_config_option') {
      const sessionId = requireString(params.sessionId, 'sessionId');
      const configId = requireString(params.configId, 'configId');
      const value = requireString(params.value, 'value');
      if (configId !== 'model') {
        throw new AcpInvalidParams(`unknown configId: ${configId} (only 'model' is configurable)`);
      }
      deps.setModelSpec(sessionId, value);
      // configOptions 必填回显（ACP schema 强制——消费方状态同步单源）。
      return { configOptions: modelConfigOptions(sessionId) };
    }

    if (method === 'session/list') {
      const sessions = deps.listSessions().map((row) => ({
        sessionId: row.id,
        ...(row.title !== null ? { title: row.title } : {}),
        updatedAt: row.lastActivityAt,
      }));
      return { sessions };
    }

    throw new AcpMethodNotFound(method);
  }

  function handleNotification(method: string, paramsRaw: unknown): void {
    if (method === 'session/cancel') {
      const params = (typeof paramsRaw === 'object' && paramsRaw !== null ? paramsRaw : {}) as Record<string, unknown>;
      if (typeof params.sessionId === 'string' && params.sessionId.length > 0) {
        deps.interruptSession(params.sessionId);
      }
      return;
    }
    // 未知通知静默跳过（notifications/initialized 等——零应答零执法）。
  }

  /* ---------------- 传输环（入站分帧三路分派） ---------------- */

  let settleDone!: (exitCode: number) => void;
  const done = new Promise<number>((resolve) => {
    settleDone = resolve;
  });

  io.output.on('error', (error) => {
    log(`acp: output stream failed: ${error.message}`);
    shutdown(1);
  });

  io.input.on('data', (chunk: Buffer | string) => {
    if (closed) return;
    try {
      const split = splitWireLines(typeof chunk === 'string' ? chunk : chunk.toString('utf8'), lineRemainder);
      lineRemainder = split.remainder;
      for (const line of split.lines) {
        handleLine(line);
      }
    } catch (error) {
      if (error instanceof AcpTransportError) return;
      log(`acp: inbound handling failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  io.input.on('error', (error) => {
    log(`acp: input stream failed: ${error.message}`);
    shutdown(1);
  });
  io.input.on('end', () => {
    // 对端收线 = 优雅收场（mcp 形同律）。
    shutdown(0);
  });

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      sendError(null, JSONRPC_PARSE_ERROR, 'parse error');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const message = parsed as Record<string, unknown>;

    // 应答帧（agent→client 请求的落定——id 在账即 resolve）。
    if (typeof message.id === 'number' && typeof message.method !== 'string') {
      const pending = pendingClientRequests.get(message.id);
      if (pending === undefined) return;
      pendingClientRequests.delete(message.id);
      if (typeof message.error === 'object' && message.error !== null) {
        pending.reject(new Error('client request rejected'));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    // 请求/通知两分（id 在场 = 请求）。
    if (typeof message.method !== 'string') return;
    if (message.id === undefined || message.id === null) {
      handleNotification(message.method, message.params);
      return;
    }
    if (typeof message.id !== 'number' && typeof message.id !== 'string') return;
    void handleRequest(message.id as number | string, message.method, message.params).catch((error) => {
      if (error instanceof AcpTransportError) return;
      // 非注册码异常已折 -32603 帧——再上抛走崩溃编排（fail-loud）。
      log(`acp: dispatcher failure: ${error instanceof Error ? error.message : String(error)}`);
      shutdown(1);
    });
  }

  function shutdown(exitCode: number): void {
    if (closed) return;
    closed = true;
    if (drainTimer !== null) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    drainQueue.length = 0;
    // 在飞审批全部 unavailable（通道消失语义——04 §9）。
    for (const resolve of pendingAsks.values()) resolve('unavailable');
    pendingAsks.clear();
    // 在飞 agent→client 请求拒绝（消费方 catch → unavailable）。
    for (const pending of pendingClientRequests.values()) {
      pending.reject(new AcpTransportError('acp face is closed'));
    }
    pendingClientRequests.clear();
    settleDone(exitCode);
  }

  return {
    backend,
    done,
    dispose: () => shutdown(0),
  };
}
