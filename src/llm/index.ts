/**
 * llm 模块公开面（L2 模型运行时；02 篇 §4.1 边表：llm → contracts 单边，
 * pi-ai 裸导入仅本模块——07 篇栈纪律）。
 *
 * 桶出口 = 模型标识解析 + Models 宿主 + StreamFn 适配 + 会话层恢复零件 +
 * 单发补全服务 + 在飞计数器 + provider 工厂面。pi-ai 的注入面类型在此再出口
 * ——host 装配根做 persist→pi-ai 两 Store 适配时从这里取类型，不直接依赖 pi-ai。
 */
import './codes.js';

export {
  DEFAULT_MODEL_SPEC,
  resolveDefaultModelSpec,
  parseModelSpec,
  formatModelId,
  resolveModel,
  type ModelSpec,
} from './model-id.js';
export { createLlmRuntime, type LlmRuntime, type LlmRuntimeOptions } from './runtime.js';
export { createStreamFn, type StreamFnDefaults } from './stream-fn.js';
export { InFlightTracker, DEFAULT_MAX_INFLIGHT_PER_PROVIDER, type InFlightSlot } from './inflight.js';
export {
  classifyError,
  diagnoseProviderFailure,
  isContextOverflow,
  isRecoverableLength,
  isRetryableAssistantError,
  retryAssistantCall,
  type ErrorBucket,
  type ProviderFailureDiagnostic,
  type RetryPolicy,
  type RetryCallbacks,
} from './recovery.js';
export {
  createLlmService,
  budgetAdvisoryLevel,
  BUDGET_ADVISORY_THRESHOLDS,
  SUBAGENT_RESERVE_THRESHOLD,
  type BackgroundBudgetUsage,
  type BudgetAdvisoryLevel,
  type CompleteRequest,
  type CompleteResult,
  type LlmService,
  type LlmServiceOptions,
} from './complete.js';
export type { LlmUsageEventData } from './events.js';
/** 虚拟键 berry-agent/llm 注入物（pi-ai provider 工厂族背书导出，03 篇 §3.2） */
export { providerApiFace } from './provider-face.js';
// pi-ai 注入面类型再出口（host 适配 persist 的两 Store / 插件注册 provider 用）
export type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
  Model,
  Models,
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsStore,
  MutableModels,
  Provider,
} from '@earendil-works/pi-ai';
/**
 * pi-ai faux provider（脚本模型工厂——host 装配根/插件层测试经本面取用；
 * pi-ai 裸导入纪律仅本模块因此不破，llm 系测试同源）。pi-ai 主包一等同族
 * 导出，非 test-only 附属包——再出口语义与上方类型族同律。
 */
export { fauxProvider } from '@earendil-works/pi-ai';
