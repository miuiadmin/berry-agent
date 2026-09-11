/**
 * llm — StreamFn 适配层（04 §3：pi-ai 流 → agent StreamFn 契约）。
 *
 * 「永不抛错」契约的实现侧：一切解析/装配失败在本层编码为流内 error 终止
 * 事件 + stopReason='error' 的最终消息（错误是数据不是异常，loop 零 try/catch
 * 的根基）。pi-ai 自身的 lazyStream 已把 auth/网络装配失败编码为流 error
 * 事件，本层只补齐「模型解析失败」与「在飞帽拒绝」两个前置环节。
 *
 * 直通策略：messages 标准三角色零转换直通 pi-ai（同构形状，结构化赋值即可）；
 * 工具描述仅做类型收口（parameters 已是 JSON Schema 对象）。
 */

import type {
  AssistantMessage as PiAssistantMessage,
  CacheRetention,
  Context as PiContext,
  Message as PiMessage,
  Model,
  SimpleStreamOptions,
  Tool as PiTool,
} from '@earendil-works/pi-ai';
// 注意：AssistantMessageEventStream 类名被 pi-ai types 的 type-only 再输出遮蔽，
// 值只能经官方工厂函数取得（该工厂即为此用途提供——"for use in extensions"）
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, AssistantStream, LlmContext, StreamFn, StreamFnOptions } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import type { InFlightSlot, InFlightTracker } from './inflight.js';
import type { LlmRuntime } from './runtime.js';

/**
 * 钩子派发段只读窄面（03 §3.4 执法——02 §5.3 LLM_CALL_IN_HOOK 接线消费）。
 * host 装配根持有 guard 真身（host/hook-dispatch-guard），llm 无 host 逆边
 * （02 §4.1）——本域自持同形结构副本，装配注入。
 */
export interface HookDispatchWindow {
  /** true = 当前调用栈在钩子派发段内（深度 > 0） */
  readonly inHookDispatch: () => boolean;
}

/**
 * StreamFn 默认请求参数（llm 闭包内持有——重试/采样档位是 provider 层配置，
 * 不进 agent 契约面；04 §3 重试四层第二行「provider SDK 透传」）。
 * abort 是终态绝不重试——pi-ai SDK 行为，本层不另加重试。
 */
export interface StreamFnDefaults {
  /**
   * SDK 级客户端重试上限（网络/限流类 transient 错误）。实证（承 berry
   * 2026-08-26）：pi-ai anthropic 路径 retryProviderRequest 缺省 **0**
   * （options.maxRetries ?? 0），主链路实际零 provider 层重试——瞬态恢复由
   * 会话层 turn 级 auto-retry 承担（04 §3.3）；OpenAI SDK 缺省 2 仅其一家。
   * 显式传值才生效，本层不加缺省。
   */
  maxRetries?: number;
  /** 重试延迟帽（毫秒）——服务器要求的长等待超帽即失败上抛，交上层可见处理 */
  maxRetryDelayMs?: number;
  temperature?: number;
  maxTokens?: number;
  /** prompt 缓存保留偏好（pi-ai 统一表达，缺省 short） */
  cacheRetention?: CacheRetention;
  /** HTTP 请求超时（毫秒） */
  timeoutMs?: number;
}

/** 零用量（错误合成消息用） */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/**
 * 创建 agent StreamFn（模型层整体注入 loop 的那一个函数）。
 * @param runtime llm 运行时（Models 宿主）
 * @param defaults 请求参数默认值（重试/采样档位，闭包持有）
 * @param tracker per-provider 在飞计数器（04 §3.6——host 装配根与 complete
 *        单发路共享同一份传入，「两出口同源计数」名实相符；不传 = 不限）
 * @param hookDispatch 钩子派发段只读面（03 §3.4 执法——02 §5.3 LLM_CALL_IN_HOOK
 *        接线：钩子 handler 执行段内流式调用即耦合死锁位，前置查命中转错误流
 *        携码；不传 = 该执法缺席〔lib/测试形〕。02 §4.1 llm 无 host 逆边——
 *        窗态经装配注入，本域自持同形结构副本）
 */
export function createStreamFn(
  runtime: LlmRuntime,
  defaults: StreamFnDefaults = {},
  tracker?: InFlightTracker,
  hookDispatch?: HookDispatchWindow,
): StreamFn {
  return (context: LlmContext, options: StreamFnOptions, signal?: AbortSignal): AssistantStream => {
    // 钩子派发段前置查（03 §3.4）：钩子 handler 内 await 流式模型面 = 耦合
    // 违法（fire-and-forget 尾链窗外合法——guard 深度随派发收口归零）；先于
    // 模型解析（调用方违例与模型配置无关，最先判）
    if (hookDispatch?.inHookDispatch() === true) {
      return errorStream(
        '钩子执行段禁模型调用（03 §3.4——钩子 handler 内 await 流式即耦合；起异步任务不等结果合法）',
        'LLM_CALL_IN_HOOK',
      );
    }
    // 模型解析失败 → 编码为错误流（永不抛错；错误在此转数据）。
    // 文案携带 [CODE] 前缀维持人读可辨（机器判定位是 errorCode 字段）
    let model: Model<string>;
    try {
      model = runtime.resolveModel(options.model);
    } catch (error) {
      const baseError = error instanceof BaseError ? error : null;
      const code = baseError?.code ? `[${baseError.code}] ` : '';
      return errorStream(`模型解析失败：${code}${baseError?.message ?? String(error)}`, baseError?.code);
    }

    // 在飞帽（04 §3.6）：达帽显式拒绝——错误流带 errorCode（transient 桶，
    // 会话层 auto-retry 退避后槽已释放重试成功）。模型解析先行是顺序必然：
    // provider 名来自解析产物。
    if (tracker !== undefined) {
      const slot = tracker.tryAcquire(model.provider);
      if (slot === null) {
        return errorStream(
          `在飞请求达帽（provider=${model.provider}）：并发压力自解，会话层退避后重试`,
          'LLM_INFLIGHT_LIMIT',
        );
      }
      return withRelease(
        runtime.models.streamSimple(
          model,
          buildPiContext(context),
          buildPiOptions(defaults, options, signal),
        ) as unknown as AssistantStream,
        slot,
      );
    }

    // 事件流结构同构（12 型协议 + result()），超集兼容子集直通
    return runtime.models.streamSimple(
      model,
      buildPiContext(context),
      buildPiOptions(defaults, options, signal),
    ) as unknown as AssistantStream;
  };
}

/** 标准三角色零转换直通（超集兼容子集；引用同一数组，无拷贝） */
function buildPiContext(context: LlmContext): PiContext {
  return {
    systemPrompt: context.systemPrompt,
    messages: context.messages as PiMessage[],
    tools: context.tools?.map(toPiTool),
  };
}

/** defaults 打底 + 具名覆盖 + signal 透传（reasoning 无 'off' 档——undefined 即关闭） */
function buildPiOptions(
  defaults: StreamFnDefaults,
  options: StreamFnOptions,
  signal: AbortSignal | undefined,
): SimpleStreamOptions {
  return {
    ...defaults,
    reasoning:
      options.thinkingLevel !== undefined && options.thinkingLevel !== 'off' ? options.thinkingLevel : undefined,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(signal !== undefined ? { signal } : {}),
  };
}

/**
 * 流终结释放包装（释放三保险的流侧两路）：消费面 for-await **自然耗尽**
 * （next() 返回 done——正常结束不触发 return()）或**中途退出**（break/throw
 * 触发迭代 return()）即释放；不迭代的消费形态走 result() 的 finally 兜底
 * （见下）。任一路先到即减计数（slot.release 幂等，多路径只生效一次）。
 * 转发不拦截：事件与终值原样透传。
 */
function withRelease(stream: AssistantStream, slot: InFlightSlot): AssistantStream {
  return {
    [Symbol.asyncIterator]() {
      const iterator = stream[Symbol.asyncIterator]();
      return {
        next: async (value?: unknown) => {
          const r = await iterator.next(value);
          if (r.done) slot.release(); // 自然耗尽路：流终结即释放（不依赖消费面调 result()）
          return r;
        },
        return: (value?: unknown) => {
          slot.release();
          return iterator.return?.(value) ?? Promise.resolve({ value: undefined, done: true as const });
        },
        throw: (error?: unknown) => {
          slot.release();
          return iterator.throw ? iterator.throw(error) : Promise.reject(error);
        },
      };
    },
    result: async () => {
      try {
        return await stream.result();
      } finally {
        slot.release(); // result() 兜底：流未被迭代（或已早 break）的终态取值形态
      }
    },
  };
}

/** 工具描述收口：LlmTool → pi-ai Tool（parameters 已是 JSON Schema 对象） */
function toPiTool(tool: { name: string; description: string; parameters: object }): PiTool {
  return {
    name: tool.name,
    description: tool.description,
    // 类型层面 JSON Schema 对象 → TSchema（运行时同一对象，typebox schema 即
    // JSON Schema；LlmTool.parameters 为宽收 object——兼容构建器产物与手写
    // schema 两种来源）
    parameters: tool.parameters as PiTool['parameters'],
  };
}

/**
 * 合成错误流：单 error 终止事件 + 终值消息（pi-ai 事件流原语自建，协议同构）。
 * @param errorMessage 人读错误说明（携 [CODE] 前缀）
 * @param errorCode 宿主合成码（classifyError 判定序的机器判定位）
 */
function errorStream(errorMessage: string, errorCode?: string): AssistantStream {
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    usage: NO_USAGE,
    stopReason: 'error',
    errorMessage: errorCode !== undefined ? `[${errorCode}] ${errorMessage}` : errorMessage,
    ...(errorCode !== undefined ? { errorCode } : {}),
    timestamp: Date.now(),
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'error', reason: 'error', error: message as PiAssistantMessage });
  stream.end(message as PiAssistantMessage);
  return stream as unknown as AssistantStream;
}
