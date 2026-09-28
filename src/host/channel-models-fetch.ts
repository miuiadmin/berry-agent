/**
 * host — 模型清单拉取腿（2026-09-28 模型渠道批 C-2；规范面 = 07 §8.4
 * 「模型清单拉取腿」枚举腿 + 尾注细则；立项档 §三）。
 *
 * /setup 向导自定义渠道配置步的用户主动拉取（只读 GET、上行零数据外传
 * ——仅鉴权头；失败手填兜底不阻断）。三态回执形（fetchDistTags 先例同族）：
 * ok 携裸 id 清单 / failed 携原因（调用方呈现——向导腿手填兜底路径）。
 *
 * 协议分叉拼接（评审漏洞 #6——固定拼 /v1/models 对 openai 腿成
 * /v1/v1/models）：
 * - openai 兼容形：baseUrl 已含 /v1（OpenAI SDK 惯例）→ 只拼 `/models` +
 *   `Authorization: Bearer`；
 * - anthropic 兼容形：baseUrl 为根（无 /v1）→ 拼 `/v1/models` +
 *   `x-api-key` + `anthropic-version`。
 * 响应形 `{data:[{id}]}` 双家同形（两家清单端点同 schema）。
 *
 * 卫生：恒经 SSRF 守卫（用户填 baseUrl 必经——catalog 拉取同律，无豁免；
 * 守卫内 redirect:'manual' 钉死不跟随——3xx 网关常见，按非 2xx 折 failed
 * 且回执含「不跟随重定向」提示，评审漏洞 #8）。
 */
import type { CustomProviderProtocol } from '../llm/index.js';
import { createSsrfGuardedFetch, pinnedFetch, type DnsResolver, type FetchLike } from '../web/index.js';

/** 拉取请求（渠道定义件三要素 + 凭证行 key——向导装配位现算注入） */
export interface ChannelModelsRequest {
  readonly baseUrl: string;
  readonly protocol: CustomProviderProtocol;
  readonly apiKey: string;
}

/** 三态回执（fetchDistTags 同族——failed.message 面向人面直呈） */
export type ChannelModelsResult =
  { readonly kind: 'ok'; readonly models: readonly string[] } | { readonly kind: 'failed'; readonly message: string };

/** 依赖注入位（fetchImpl 缺省 pinnedFetch——同包单源律；DNS/超时测试注入） */
export interface ChannelModelsFetchDeps {
  readonly fetchImpl?: FetchLike;
  readonly resolveDns?: DnsResolver;
  readonly timeoutMs?: number;
}

/** 超时帽 8s（07 §8.4 尾注细则——用户面前的交互步不可久等） */
const CHANNEL_MODELS_TIMEOUT_MS = 8_000;
/** 体帽 256KiB（清单数百条 id 富余；先验 content-length 后复验文本长） */
const CHANNEL_MODELS_MAX_BYTES = 256 * 1024;

/** 按协议分叉拼接端点 URL（openai 不重拼 /v1——见头注评审 #6） */
export function channelModelsEndpoint(baseUrl: string, protocol: CustomProviderProtocol): string {
  const root = baseUrl.replace(/\/+$/, ''); // 尾斜杠容错（拼接单源）
  return protocol === 'openai-completions' ? `${root}/models` : `${root}/v1/models`;
}

/** 按协议分叉鉴权头（v1 按协议标准头——头风格推断挂账） */
function channelModelsHeaders(req: ChannelModelsRequest): Record<string, string> {
  return req.protocol === 'openai-completions'
    ? { authorization: `Bearer ${req.apiKey}`, accept: 'application/json' }
    : { 'x-api-key': req.apiKey, 'anthropic-version': '2023-06-01', accept: 'application/json' };
}

/**
 * 拉取模型清单（守卫必经 + 8s 帽 + 体帽双闸 + 坏形折 failed）。
 * WEB_ 族守卫错（私网拒/协议白名单拒）折 failed 回执——向导呈现后走手填
 * 兜底（fail-closed 面向交互步，非 fail-stop 面）。
 */
export async function fetchChannelModels(
  req: ChannelModelsRequest,
  deps: ChannelModelsFetchDeps = {},
): Promise<ChannelModelsResult> {
  // 守卫包裹（每次调用构造——闭包零状态；SSRF 两查 + 连接级钉死在守卫内；
  // resolveDns 缺省 node:dns 真解析——测试注入公网桩走通路径）
  const guardedFetch = createSsrfGuardedFetch(deps.fetchImpl ?? pinnedFetch, deps.resolveDns);
  const url = channelModelsEndpoint(req.baseUrl, req.protocol);
  try {
    const response = await guardedFetch(url, {
      method: 'GET',
      headers: channelModelsHeaders(req),
      signal: AbortSignal.timeout(deps.timeoutMs ?? CHANNEL_MODELS_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      // redirect:'manual' 钉死（守卫透传层）——3xx 即此分支；网关把 /models
      // 重定向到登录页/另域是中转站常见形态，提示用户填直连地址
      return {
        kind: 'failed',
        message: `端点应答重定向 ${response.status}（不跟随重定向——请填直连 baseUrl）`,
      };
    }
    if (!response.ok) {
      return { kind: 'failed', message: `端点应答 ${response.status}（鉴权头/地址请复核）` };
    }
    // 体帽双闸（fetchDistTags 同形）
    const declared = response.headers?.get?.('content-length');
    if (declared !== undefined && declared !== null && Number(declared) > CHANNEL_MODELS_MAX_BYTES) {
      return { kind: 'failed', message: `清单文档越体帽（${declared} bytes）` };
    }
    const text = await response.text();
    if (text.length > CHANNEL_MODELS_MAX_BYTES) {
      return { kind: 'failed', message: `清单文档越体帽（${text.length} bytes）` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'failed', message: '清单文档坏形（非 JSON）' };
    }
    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      return { kind: 'failed', message: '清单文档坏形（data 键缺席或非数组）' };
    }
    // id 串形过滤 + 去重保序（网关清单偶见重复条目）
    const seen = new Set<string>();
    const models: string[] = [];
    for (const entry of data) {
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
      seen.add(id);
      models.push(id);
    }
    return { kind: 'ok', models };
  } catch (err) {
    // 超时/网络错/DNS 错/WEB_ 族守卫拒（私网/协议白名单）统一 failed 形
    const message = err instanceof Error && err.message !== '' ? err.message : String(err);
    return { kind: 'failed', message };
  }
}
