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
}

/** 取 key 闭包（host 装配位接凭证表绑定行现算——undefined = 未配置） */
export type ResolveCustomProviderKey = () => string | undefined;

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
 * @param id 渠道 id（settings customProviders 的 Record 键——保留字校验在
 *   装配腿，本工厂不重复执法〔撞内置目录 id 拒注 = host 侧 warn 跳条〕）
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
