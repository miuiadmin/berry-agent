/**
 * llm — 单发受托管补全服务（04 §3.7 complete 单发 + §5 预算两维）。
 *
 * complete 是后台件（compaction 摘要、goal 轮间沉淀、记忆 review）发起单次
 * 补全的唯一合法路径：
 * 1. 轻量单发就是单发——不起 subagent loop（loop 装配是任务委派的成本，
 *    不是摘要/分类的成本）；
 * 2. 复用 resolveModel + retryAssistantCall + StreamFnDefaults——与主对话
 *    同一模型解析、重试语义与请求参数面，调用方不另立炉灶。
 *
 * 预算闸门（04 §5 两维——承 berry 三维删插件维，2026-09-04 立项裁决）：
 * canAfford(priority)——foreground 恒 true（用户可见请求永远放行）；background
 * 当日后台累计 tokens < 限额（缺省 4M）。执法位点 = llm 层拒发
 * （LLM_BUDGET_EXCEEDED 拒在请求发出前）；底账 = 注入的聚合查询
 * （backgroundSpentToday 读侧）——余额不存储、重放推导（llm/usage durable
 * 事件聚合，05 篇）。
 */

import type { AssistantMessage, Message, ModelInfo, Usage } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import { randomUUID } from 'node:crypto';
import type { LlmRuntime } from './runtime.js';
import { formatModelId } from './model-id.js';
import type { StreamFnDefaults } from './stream-fn.js';
import type { InFlightTracker } from './inflight.js';
import {
  classifyError,
  isContextOverflow,
  type ErrorBucket,
  retryAssistantCall,
  type RetryPolicy,
} from './recovery.js';
import type { Message as PiMessage, SimpleStreamOptions } from '@earendil-works/pi-ai';

/** 单发补全请求（调用方参数面——凭证禁入：一律走 CredentialStore 缺省解析） */
export interface CompleteRequest {
  /** 系统提示词（缺省无） */
  systemPrompt?: string;
  /** 补全输入（标准三角色直通 pi-ai——超集兼容子集零转换；单发面不收工具） */
  messages: Message[];
  /** 模型标识（"provider/model-id"）；缺省继承 defaultModel() */
  model?: string;
  /** HTTP 请求超时（毫秒），覆盖构造期 StreamFnDefaults.timeoutMs */
  timeoutMs?: number;
  /** 取消信号（透传 pi-ai + retryAssistantCall——abort 归一为 aborted 终态消息，不重试） */
  signal?: AbortSignal;
  /**
   * 'background' 接预算闸门（04 §5）：后台调用且当日后台累计 tokens 已达限额
   * → LLM_BUDGET_EXCEEDED 拒发（调用方捕获即「跳过本轮、下个周期再试」）；
   * 'foreground' 恒放行——用户可见请求永远优先。
   */
  priority?: 'background' | 'foreground';
}

/** 单发补全结果：终态消息 + 用量 + 计量身份（usage 已过 onUsage 计量回调） */
export interface CompleteResult {
  message: AssistantMessage;
  usage: Usage;
  /**
   * 本次补全的结算 id（settlement 幂等身份——llm/usage 事件 callId 字段源）：
   * 每次 complete 调用唯一生成，装配层落 durable 计量事件携此 id。
   */
  callId: string;
  /** 本次调用的预算道（装配层落 llm/usage 事件的 priority 字段源） */
  priority: 'background' | 'foreground';
  /**
   * 本次调用墙钟耗时（毫秒——llm/usage 事件 elapsedMs 字段源）：全调用口径
   * （含 transient 重试）；观测面 dur_ms 聚合的源之一。
   */
  elapsedMs: number;
}

/** 单发服务面（complete + provider 注册/注销 + 模型目录只读投影 + canAfford 预算闸门） */
export interface LlmService {
  /** 注册/替换 provider（按 id upsert）；返回注销函数（插件卸载路径） */
  registerProvider(provider: Parameters<LlmRuntime['registerProvider']>[0]): () => void;
  /** 按 id 移除 provider */
  unregisterProvider(id: string): void;
  /**
   * 模型目录只读投影（pi-ai Models 接口包装——与主对话同一 Models 实例，
   * registerProvider 增补即刻可见）：投影形 ModelInfo，传输/配置面不披露。
   */
  listModels(provider?: string): ModelInfo[];
  /** 单模型查询（listModels 的点查形态，同表同账；id = "provider/model-id" 全形） */
  getModel(id: string): ModelInfo | undefined;
  /** 单发受托管补全（本文件主角） */
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /**
   * 预算闸门查询（04 §5 两维）：'foreground' 恒 true；'background' = 当日后台
   * 累计 tokens（in+out 主计费桶）< 限额。数据源 = 注入的聚合查询
   * （backgroundSpentToday——底账为 llm/usage durable 事件的投影：余额不存、
   * 重放推导，重启不清零、用户可审计；llm 模块不持有账，只持有闸门机制）。
   * 超限执法只落 background（后台拒新跑）；foreground 恒放行花销照进账。
   */
  canAfford(priority: 'background' | 'foreground'): boolean;
  /**
   * 错误桶判定（04 §3.5——recovery.ts classifyError 单源表的服务面公开位）：
   * conversation 件等宿主内消费方经服务面取用（拓扑不含 llm 边时判定器经
   * 服务面注入驱动——「全仓无第二分类处」的执法前提是宿主面可得）。
   */
  classifyError(message: AssistantMessage): ErrorBucket;
  /**
   * 溢出判定（窗口携带）：recovery.isContextOverflow 的服务面公开位。静默溢出
   * （input+cacheRead ≥ 窗口且正常停）与 length 零输出两路依赖 contextWindow
   * ——窗口按模型目录活取（消费方携当轮效值模型，非装配期定死）；目录缺模型
   * = undefined → 诚实退化仅错误正则一路。
   */
  isContextOverflowFor(message: AssistantMessage, model: string): boolean;
}

/** 服务构造选项 */
export interface LlmServiceOptions {
  /** llm 运行时（Models 宿主——与主对话共用同一实例） */
  runtime: LlmRuntime;
  /** 请求参数默认值（与 createStreamFn 共用同一份——重试/采样档位全宿主一致） */
  defaults?: StreamFnDefaults;
  /**
   * per-provider 在飞计数器（04 §3.6——与 createStreamFn 共享同一份：两出口
   * 同源计数名实相符。complete 路达帽**同拒**：produce 返回 LLM_INFLIGHT_LIMIT
   * 错误终态 → pi-ai 正则归 non-retryable 上抛 LLM_COMPLETE_FAILED——过载期
   * 单发失败由调用方自然重试，不造排队口子。
   */
  tracker?: InFlightTracker;
  /** 会话当前模型缺省（函数面：运行时可变） */
  defaultModel: () => string;
  /** 有界重试策略（缺省开 1 次重试——transient 网络抖动兜底，非 loop 级成本） */
  retry?: RetryPolicy;
  /**
   * 用量计量回调（底账接线 seam——canAfford 数据源的写侧：host 装配根在此落
   * llm/usage durable 事件，read 侧聚合查询注入 backgroundSpentToday，两侧经
   * 事件日志闭合为同一本账）。回调异常被隔离：计量是观测面，不拖垮补全结果本身。
   */
  onUsage?: (result: CompleteResult, modelSpec: string) => void;
  /**
   * onUsage 回调异常的观测面：回调抛错时携带 { callId, model, error } 上抛给
   * 接线面落 warn——llm/usage 是预算投影唯一底账，丢账不静默。llm 边表仅
   * contracts（不引 context logger），故走窄面回调；host 接 ctx 日志。缺省
   * 不接 = 零观测（lib 形态）。
   */
  onUsageError?: (err: unknown, info: { callId: string; model: string }) => void;
  /** 当日后台预算限额 tokens（in+out 合计；缺省 4,000,000——04 §5 起草值随实测调） */
  backgroundBudgetTokens?: number;
  /**
   * 当日后台已耗查询（缺省 () => 0——无装配接线即无已耗；生产由 host 注入：
   * 对会话日志 llm/usage 事件的当日时间窗聚合，SUM(input+output) 主计费桶
   * ——cache 桶进观察面板不进闸门（05 §1.1 表注））。
   * write-behind 批落窗口内的最近一笔可能未及落盘（闸门偏松一笔）——与
   * 「最后一发可略超限额」同语义，预算是软闸门不是安全边界。
   */
  backgroundSpentToday?: () => number;
}

/** 缺省重试策略：开 1 次重试、500ms 起步指数退避（SDK 级重试之外的有界第二层） */
const DEFAULT_RETRY: RetryPolicy = { enabled: true, maxRetries: 1, baseDelayMs: 500 };

/** 零用量（达帽错误终态合成用——同 stream-fn 的 errorStream 惯例） */
const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 缺省后台预算：当日后台补全 tokens（in+out 合计）限额（04 §5 起草值） */
const DEFAULT_BACKGROUND_BUDGET = 4_000_000;

/**
 * 创建单发受托管补全服务（host 装配根 provide 的那一个对象）。
 */
export function createLlmService(options: LlmServiceOptions): LlmService {
  const { runtime, defaults = {}, defaultModel, retry = DEFAULT_RETRY, tracker } = options;
  const budget = options.backgroundBudgetTokens ?? DEFAULT_BACKGROUND_BUDGET;
  // 当日后台已耗 = 注入的聚合查询（底账 = llm/usage 事件投影，缺省无已耗）
  const spentToday = options.backgroundSpentToday ?? (() => 0);

  /**
   * 预算闸门（04 §5 两维）：foreground 恒 true（用户可见请求永远优先——前台
   * 不硬断）；background = 当日后台累计 < 全局限额。
   */
  const canAfford = (priority: 'background' | 'foreground'): boolean => {
    if (priority === 'foreground') return true;
    return spentToday() < budget;
  };

  /** pi-ai Model → ModelInfo 投影（listModels/getModel 同一映射，同表同账） */
  const toModelInfo = (m: ReturnType<LlmRuntime['listModels']>[number]): ModelInfo => ({
    id: formatModelId(m.provider, m.id),
    name: m.name,
    provider: m.provider,
    reasoning: m.reasoning,
    input: [...m.input],
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
  });

  /** 目录点查窗口：全形 id → contextWindow；缺模型 undefined（诚实退化） */
  const contextWindowOf = (id: string): number | undefined => {
    const found = runtime.listModels().find((m) => formatModelId(m.provider, m.id) === id);
    return found === undefined ? undefined : found.contextWindow;
  };

  return {
    registerProvider: (provider) => runtime.registerProvider(provider),
    unregisterProvider: (id) => runtime.unregisterProvider(id),

    // 错误桶判定：recovery 桶表直通——单源表的公开消费位
    classifyError: (message) => classifyError(message),

    // 溢出判定：窗口活取目录点查——缺模型 undefined 即仅错误正则一路
    // （静默溢出/length 零输出两路天然不触发，诚实退化不阻断）
    isContextOverflowFor: (message, model) => isContextOverflow(message, contextWindowOf(model)),

    // 模型目录只读投影：pi-ai Model → ModelInfo 字段子集直通——id 组
    // "provider/model-id" 全形（resolveModel 同名可解析），传输/配置面不披露
    listModels(provider?: string): ModelInfo[] {
      return runtime.listModels(provider).map(toModelInfo);
    },
    // 点查复用同一投影（同表同账）；全形 id 不在目录 = undefined（点查语义——
    // 不抛 LLM_MODEL_NOT_FOUND，那是 resolveModel 发补全请求时的 fail-loud 面）
    getModel(id: string): ModelInfo | undefined {
      const found = runtime.listModels().find((m) => formatModelId(m.provider, m.id) === id);
      return found === undefined ? undefined : toModelInfo(found);
    },

    canAfford,

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      // 预算闸门（04 §5 执法位点）：后台调用且当日已耗尽 → 拒在请求发出前
      // （不是事后记账发现超了——钱花出去才拒不是预算）。检查在调用前；入账在
      // 成功后（装配层经 onUsage 落 llm/usage durable 事件）——最后一发可略超
      // 限额（check-then-act 于单发粒度；另 write-behind 批落窗口内的最近一笔
      // 闸门可能未见，同为「略超」语义——预算是软闸门，不是安全边界）。
      if (req.priority === 'background' && !canAfford('background')) {
        throw new BaseError(
          'LLM_BUDGET_EXCEEDED',
          `当日后台预算已耗尽（限额 ${budget} tokens）——用户可见请求永远优先，后台任务下个周期再试`,
        );
      }

      // 模型解析 fail-loud（BaseError LLM_MODEL_*）；在重试环外：解析错误是
      // 确定性的，重试无意义
      const modelSpec = req.model ?? defaultModel();
      const model = runtime.resolveModel(modelSpec);

      // 标准三角色零转换直通（同 stream-fn 直通策略）；单发无工具面
      const piContext = {
        systemPrompt: req.systemPrompt,
        messages: req.messages as unknown as PiMessage[],
      };
      // defaults 打底 → 具名 timeoutMs/signal 覆盖
      const piOptions: SimpleStreamOptions = {
        ...defaults,
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
        ...(req.signal !== undefined ? { signal: req.signal } : {}),
      };

      // 单发不 loop——一次 streamSimple + 有界 transient 重试（retryAssistantCall）。
      // 计时起点：全调用口径——含重试在内的墙钟耗时，终点在成功终态后
      const startedAt = performance.now();
      const message = await retryAssistantCall(
        async () => {
          // 在飞帽（04 §3.6）：与主对话路同源计数；达帽同拒——错误终态带
          // errorCode，经 pi-ai 正则归 non-retryable 即刻上抛（不造排队口子）
          const slot = tracker?.tryAcquire(model.provider) ?? null;
          if (slot === null && tracker !== undefined) {
            return {
              role: 'assistant',
              content: [],
              usage: NO_USAGE,
              stopReason: 'error',
              errorMessage: `[LLM_INFLIGHT_LIMIT] 在飞请求达帽（provider=${model.provider}）：过载期单发失败，调用方稍后自然重试`,
              errorCode: 'LLM_INFLIGHT_LIMIT',
              timestamp: Date.now(),
            } as AssistantMessage;
          }
          try {
            const stream = runtime.models.streamSimple(model, piContext, piOptions);
            return (await stream.result()) as unknown as AssistantMessage;
          } finally {
            slot?.release(); // result() 即流终结：单发消费面只走这一条路，finally 必达
          }
        },
        retry,
        req.signal,
      );

      // 错误终态 → BaseError 上抛（04 §3.7：complete 是 Promise 面不是流面——
      // 「永不抛」是 StreamFn 的流事件契约，单发面向 await 的调用方，错误
      // 回到异常形态）
      if (message.stopReason === 'error') {
        throw new BaseError('LLM_COMPLETE_FAILED', message.errorMessage ?? '单发补全失败（错误终态）');
      }
      if (message.stopReason === 'aborted') {
        throw new BaseError('LLM_COMPLETE_FAILED', message.errorMessage ?? '单发补全被取消（aborted）');
      }

      // 计量身份随结果携带：callId 供装配层落 llm/usage（settlement 幂等），
      // priority 供事件分道（聚合只计 background），elapsedMs 供事件耗时聚合
      const result: CompleteResult = {
        message,
        usage: message.usage,
        callId: randomUUID(),
        priority: req.priority ?? 'foreground',
        // 全调用耗时（performance.now 差——亚毫秒精度足够观测聚合，不取整保精度）
        elapsedMs: performance.now() - startedAt,
      };
      // 计量 seam：回调异常隔离（观测面不拖垮补全结果；底账由装配层在此落 durable）
      try {
        options.onUsage?.(result, modelSpec);
      } catch (usageErr) {
        // onUsage 异常隔离不变，但不再零可观测：llm/usage 是预算闸门唯一底账，
        // 丢账必须可观测——经 onUsageError 交接线面落 warn（04 §3.7）
        options.onUsageError?.(usageErr, { callId: result.callId, model: modelSpec });
      }
      return result;
    },
  };
}
