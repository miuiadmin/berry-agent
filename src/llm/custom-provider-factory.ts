/**
 * llm — 自定义渠道 provider 工厂（2026-09-28 模型渠道批 C-1；机制真源 =
 * 立项档 00-立题-模型渠道与向导重做-20260928 §三 + 04 §9 ⑥ 第五键批注）。
 *
 * 定位：settings.json `customProviders` 定义件（非敏感——key 走凭证表绑定行
 * 单源）→ pi-ai Provider 实例的单键工厂。pi-ai 裸导入纪律属地（本文件即
 * llm 模块），host 侧只传纯配置与取 key 闭包——适配知识零外泄（评审 ② 裁决：
 * llm 域单键工厂出口，host 不手造 Provider）。
 *
 * 裸 id 律（评审致命项 #1——本件核心不变式）：**Model.id 恒写裸形**
 * （`def.models` 条目原样即裸模型 id）。全形 `${providerId}/${modelId}` 的
 * 投影单源在 complete.ts toModelInfo；注册侧填全形则 parseModelSpec 首斜杠
 * 分割后 `getModel(provider, bareId)` 恒 miss，运行时必炸 LLM_MODEL_NOT_FOUND
 * ——pi-ai 目录裸 id 约定（内置 models.json 全裸形）同律。回归锁 =
 * custom-provider-factory.test「裸 id 注册律」。
 */
import type { Api, AuthResult, Model, Provider, ProviderAuth } from '@earendil-works/pi-ai';
import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

/**
 * 自定义渠道协议枚举——与 pi-ai KnownApi 字面精确一致（两主流 wire format；
 * 立项档 §三「协议枚举与 pi-ai KnownApi 精确一致」已核）。
 * Model.api 字段值直接用本枚举（provider 流分派键）。
 */
export type CustomProviderProtocol = 'anthropic-messages' | 'openai-completions';

/** 协议枚举运行时单源（settings 读侧校验值域共用——防两处漂移） */
export const CUSTOM_PROVIDER_PROTOCOLS: readonly CustomProviderProtocol[] = [
  'anthropic-messages',
  'openai-completions',
];

/**
 * settings.json `customProviders` 条目形（04 §9 ⑥ 第五键——非敏感定义件）。
 * - key 不入此表：供血走凭证表绑定行单源（host 侧 resolveKey 闭包注入）；
 * - headers 不得含鉴权材料（本文件模型可读、不在敏感件集——鉴权走凭证行；
 *   向导录入步警示，读侧不执法内容——定性条款归规范面）；
 * - models 为平面裸 id 清单（对象形 cost/limit 挂账——立项档 §三 v1 定形）。
 */
export interface CustomProviderDef {
  /** 展示名（缺省 = 渠道 id） */
  readonly name?: string;
  readonly protocol: CustomProviderProtocol;
  readonly baseUrl: string;
  readonly models: readonly string[];
  /** 额外请求头（非鉴权用途兜底——非标网关自定义头） */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * 协议分家兼容开关表（pi-8 批——04 §9 ⑥ pi-8 批注）：白名单键集与值域
   * 单源 = customCompatProblem（pi-ai 知识不出 llm 域）；读侧（settings-store）
   * 闭集执法后工厂直挂 Model.compat，本面不重复校验。
   */
  readonly compat?: Readonly<Record<string, unknown>>;
  /**
   * 模型级采样参（pi-8 批——仅 openai 腿生效：pi-ai 侧 Only applied by
   * OpenAI-compatible adapters；anthropic 腿声明 = 读侧坏形丢条）。键黑名单
   * +值标量两判据单源 = customSamplingParamsProblem。
   */
  readonly samplingParams?: Readonly<Record<string, unknown>>;
  /**
   * 按档采样参覆盖表（pi-8 批——合并序：模型级 < 按档 < per-request）。
   * v1 档位键域 = 单值 'off' 闭集（reasoning:false 占位门使 pi-ai
   * clampThinkingLevel 恒夹 'off'，非 off 档行永不命中 = 静默死键——
   * reasoning 升格批落码时扩值域）。判据单源 =
   * customSamplingParamsByThinkingLevelProblem。
   */
  readonly samplingParamsByThinkingLevel?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** 取 key 闭包（host 装配位接凭证表绑定行现算——undefined = 未配置） */
export type ResolveCustomProviderKey = () => string | undefined;

// —— pi-8 批判据单源（04 §9 ⑥ pi-8 批注；读侧 settings-store 消费，pi-ai 知识不出 llm 域） ——

/**
 * anthropic-messages 腿 compat 白名单+值域表（12 键——pi-ai
 * AnthropicMessagesCompat 全键；排除 allowedFallbackModels〔服务端 fallback
 * 高级面 v1 不开〕）。值域形：'boolean'＝布尔开关 / readonly string[]＝枚举值集
 * （anthropic 腿 sessionAffinityFormat 单值 'openrouter'）。
 */
const ANTHROPIC_COMPAT_SCHEMA: Readonly<Record<string, 'boolean' | readonly string[]>> = {
  supportsEagerToolInputStreaming: 'boolean',
  supportsLongCacheRetention: 'boolean',
  sendSessionAffinityHeaders: 'boolean',
  sessionAffinityFormat: ['openrouter'],
  supportsCacheControlOnTools: 'boolean',
  supportsTemperature: 'boolean',
  forceAdaptiveThinking: 'boolean',
  allowEmptySignature: 'boolean',
  supportsStrictTools: 'boolean',
  supportsMidConvoEffort: 'boolean',
  supportsMidConvoSystemMessages: 'boolean',
  supportsMidConvoToolChanges: 'boolean',
};

/**
 * openai-completions 腿 compat 白名单+值域表（23 标量键——pi-ai
 * OpenAICompletionsCompat 标量子集；排除四嵌套键 chatTemplateKwargs/
 * chatTemplateArgs/openRouterRouting/vercelGatewayRouting〔Record/嵌套结构键
 * v1 不开〕）。openai 腿缺省非静态（pi-ai detectCompat 按 baseUrl 探测打底、
 * 用户键逐键 ?? 覆盖）——同一份声明在不同 baseUrl 下实际行为不同。
 */
const OPENAI_COMPAT_SCHEMA: Readonly<Record<string, 'boolean' | 'number' | readonly string[]>> = {
  supportsStore: 'boolean',
  supportsDeveloperRole: 'boolean',
  supportsReasoningEffort: 'boolean',
  supportsUsageInStreaming: 'boolean',
  supportsFinishReason: 'boolean',
  maxTokensField: ['max_completion_tokens', 'max_tokens'],
  requiresToolResultName: 'boolean',
  requiresAssistantAfterToolResult: 'boolean',
  requiresThinkingAsText: 'boolean',
  requiresReasoningContentOnAssistantMessages: 'boolean',
  thinkingFormat: [
    'openai',
    'openrouter',
    'deepseek',
    'together',
    'baseten',
    'zai',
    'qwen',
    'chat-template',
    'qwen-chat-template',
    'string-thinking',
    'ant-ling',
  ],
  zaiToolStream: 'boolean',
  thinkingTokenBudgetField: ['thinking_token_budget', 'thinking_budget', 'thinking_budget_tokens'],
  supportsThinkingTokenBudget: 'boolean',
  supportsOpenAIGrammarTools: 'boolean',
  supportsMidConvoSystemMessages: 'boolean',
  supportsMidConvoToolAdditions: 'boolean',
  supportsStrictMode: 'boolean',
  cacheControlFormat: ['anthropic'],
  sendSessionAffinityHeaders: 'boolean',
  sessionAffinityFormat: ['openai', 'openai-nosession', 'openrouter'],
  supportsLongCacheRetention: 'boolean',
  vllmPriority: 'number',
};

/**
 * 采样参键黑名单（25 键 = pi-ai openai-completions buildParams 具名赋值字段
 * 全集测绘闭集：初始位 5〔model/messages/stream/prompt_cache_key/
 * prompt_cache_retention〕+ 赋位 17〔含 basetenParams 别名位的
 * chat_template_args〕+ 预算帽动态 3〔thinkingTokenBudgetField 三值枚举——
 * samplingParams 通道注入即预算护栏旁路，恒拒〕）。samplingParams 尾段
 * Object.assign 在 buildParams 最后（覆盖一切具名请求字段）——黑名单是
 * 护栏面/组装面的防旁路执法集；升级 pi-ai 时以 adapter 赋位位全集重测绘随迁。
 */
const SAMPLING_PARAM_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'stream',
  'stream_options',
  'store',
  'prompt_cache_key',
  'prompt_cache_retention',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'tools',
  'tool_stream',
  'tool_choice',
  'priority',
  'enable_thinking',
  'reasoning_effort',
  'reasoning',
  'thinking',
  'chat_template_kwargs',
  'chat_template_args',
  'provider',
  'providerOptions',
  'thinking_token_budget',
  'thinking_budget',
  'thinking_budget_tokens',
]);

/** 值域判定（'boolean'/'number' 布尔开 / 数组＝枚举成员）——坏值返回描述、好值 undefined */
function compatValueProblem(
  key: string,
  value: unknown,
  domain: 'boolean' | 'number' | readonly string[],
): string | undefined {
  if (domain === 'boolean') {
    return typeof value === 'boolean' ? undefined : `compat.${key} 须为 boolean`;
  }
  if (domain === 'number') {
    return typeof value === 'number' ? undefined : `compat.${key} 须为 number`;
  }
  return domain.includes(value as string) ? undefined : `compat.${key} 须为 ${domain.join('|')} 之一`;
}

/**
 * compat 条目判据（undefined = 好形）：白名单（按协议分家）+ 值域 +
 * ToolChanges/ToolAdditions 单开依赖违例（pi-ai 侧 Requires
 * supportsMidConvoSystemMessages——单开系静默 no-op 键，诚实律同拒零效果键；
 * anthropic/openai 两腿同形执法）。
 */
export function customCompatProblem(protocol: CustomProviderProtocol, raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'compat 须为对象';
  const schema = protocol === 'anthropic-messages' ? ANTHROPIC_COMPAT_SCHEMA : OPENAI_COMPAT_SCHEMA;
  const compat = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(compat)) {
    const domain = schema[key];
    if (domain === undefined) return `compat 键「${key}」不被支持（${protocol} 协议可用键之外）`;
    const problem = compatValueProblem(key, value, domain);
    if (problem !== undefined) return problem;
  }
  // 依赖联动执法（两腿各一——mid-convo 增量工具面键单开 = pi-ai 侧静默 no-op）
  const additionsKey =
    protocol === 'anthropic-messages' ? 'supportsMidConvoToolChanges' : 'supportsMidConvoToolAdditions';
  if (compat[additionsKey] === true && compat.supportsMidConvoSystemMessages !== true) {
    return `${additionsKey} 需与 supportsMidConvoSystemMessages 同时开启（单独开启不生效）`;
  }
  return undefined;
}

/**
 * 采样参条目判据（undefined = 好形）：键黑名单（buildParams 具名赋位全集——
 * 防覆盖宿主请求组装产物与预算护栏面）+ 值须 JSON 标量（string/number/
 * boolean——拒嵌套对象防结构注入）。仅 openai 腿可声明（anthropic 腿上游
 * 忽略——读侧另以「腿不支持」坏形丢条，不经本函数）。
 */
export function customSamplingParamsProblem(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'samplingParams 须为对象';
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (SAMPLING_PARAM_FORBIDDEN_KEYS.has(key)) {
      return `samplingParams 键「${key}」不允许设置（请求组装/预算护栏内部字段——恒拒注入）`;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return `samplingParams.${key} 值须为 JSON 标量（string/number/boolean）`;
    }
  }
  return undefined;
}

/**
 * 按档采样参表判据（undefined = 好形）：外层档位键域 = 单值 'off' 闭集
 * （reasoning:false 占位门使非 off 档行永不命中 = 静默死键类——诚实律拒之；
 * reasoning 升格批落码时扩值域）+ 叶值同黑名单+标量两判据（内外两层同执法）。
 */
export function customSamplingParamsByThinkingLevelProblem(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'samplingParamsByThinkingLevel 须为对象';
  }
  for (const [level, leaf] of Object.entries(raw as Record<string, unknown>)) {
    // 档位键闭集：v1 仅 'off'（占位元数据 reasoning:false 的裁定门）
    if (level !== 'off') {
      return `samplingParamsByThinkingLevel 档「${level}」不支持（当前仅支持 'off'）`;
    }
    const problem = customSamplingParamsProblem(leaf);
    if (problem !== undefined) return problem.replace(/^samplingParams/, `samplingParamsByThinkingLevel.${level}`);
  }
  return undefined;
}

/**
 * 占位元数据（自定义渠道无价目/窗口数据——v1 拍保守占位，对象形扩展挂账）：
 * - contextWindow 128k：主流中位保守低报（影响 compaction 阈值裁断——低报
 *   早触发属安全侧；虚报 200k 属风险侧，不取）；
 * - maxTokens 8k：输出帽保守低报（预算/护栏面低报无害）；
 * - cost 四率全零：预算面诚实「无价目数据」（高报/臆造价目即预算护栏失真）；
 * - input 恒 ['text']、reasoning 恒 false：不宣称网关不可知的图像/推理支持。
 */
const PLACEHOLDER_CONTEXT_WINDOW = 128_000;
const PLACEHOLDER_MAX_TOKENS = 8_192;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/**
 * 造自定义渠道 Provider。
 *
 * @param id 渠道 id（settings customProviders 的 Record 键——保留字执法单源
 *   在 stack.registerCustomProvider 注册口〔R-1 评审修复役——装配/向导/编辑
 *   三腿同口；拒注回执 + host 侧 warn 跳条〕，本工厂不重复执法）
 * @param def 渠道定义件（protocol/baseUrl/models/headers）
 * @param resolveKey 凭证取值闭包（装配位接凭证表现算——缺席 = 未配置态）
 */
export function createCustomChannelProvider(
  id: string,
  def: CustomProviderDef,
  resolveKey: ResolveCustomProviderKey,
): Provider {
  // Model 构造：裸 id 律 + 占位元数据（注释见常量头）；api 字段值 = 协议枚举
  // （Model 级 provider/baseUrl 必填——pi-ai 全 Model 携带，此处渠道级同值）
  // pi-8 三键注入：读侧（settings-store 闭集执法）过的好形直挂 Model 级字段
  // ——流路与 complete 单发路两出口自动同面；compat 条件类型（按 api 分家联合）
  // 由读侧白名单+值域执法背书，此处 as 收口不重复校验（判据单源律）。
  const models: Model<Api>[] = def.models.map(
    (bareId) =>
      ({
        id: bareId,
        name: bareId,
        api: def.protocol,
        provider: id,
        baseUrl: def.baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { ...ZERO_COST },
        contextWindow: PLACEHOLDER_CONTEXT_WINDOW,
        maxTokens: PLACEHOLDER_MAX_TOKENS,
        // 自定义渠道头透传（非鉴权材料——定性见 CustomProviderDef 头注）
        ...(def.headers !== undefined ? { headers: { ...def.headers } } : {}),
        ...(def.compat !== undefined ? { compat: { ...def.compat } as Model<Api>['compat'] } : {}),
        ...(def.samplingParams !== undefined ? { samplingParams: { ...def.samplingParams } } : {}),
        ...(def.samplingParamsByThinkingLevel !== undefined
          ? {
              // 嵌套表深拷贝（内层 Record 共享引用会跨渠道条目串写）
              samplingParamsByThinkingLevel: Object.fromEntries(
                Object.entries(def.samplingParamsByThinkingLevel).map(([level, params]) => [level, { ...params }]),
              ),
            }
          : {}),
      }) satisfies Model<Api>,
  );
  // auth 最小实装：ProviderAuth 是 {apiKey?, oauth?} 容器——走 apiKey 腿；
  // resolve 是 Models.checkAuth 的判据位（key 在场即已配置；apiKey 注入请求
  // 头由协议 streams 自理：anthropic=x-api-key / openai=Bearer——v1 按协议
  // 标准头，头风格推断挂账）；login/check 缺席 = ambient-only 语义（宿主
  // 向导自管录入路径，不走 pi-ai 交互 login）
  const auth: ProviderAuth = {
    apiKey: {
      name: `${def.name ?? id} API key`,
      resolve: async (): Promise<AuthResult | undefined> => {
        const key = resolveKey();
        if (key === undefined || key === '') return undefined;
        return { auth: { apiKey: key }, source: 'credentials' };
      },
    },
  };
  // api 单实现形（单协议渠道——streams 直接给单实现非按 model.api 分派 map）
  const api = def.protocol === 'anthropic-messages' ? anthropicMessagesApi() : openAICompletionsApi();
  return createProvider({
    id,
    name: def.name ?? id,
    baseUrl: def.baseUrl,
    ...(def.headers !== undefined ? { headers: { ...def.headers } } : {}),
    auth,
    models,
    api,
  });
}
