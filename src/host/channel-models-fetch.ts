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
 *
 * R-2 加固（体帽流式前置 / 外层 race 覆盖 DNS 腿 / 守卫拒与超时人话化
 * ——见 fetchChannelModels 头注三笔）。
 */
import { BaseError } from '../contracts/index.js';
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
 * 拉取模型清单（守卫必经 + 8s 帽 + 体帽流式前置 + 坏形折 failed）。
 * WEB_ 族守卫错（私网拒/协议白名单拒）折 failed 回执人话化——向导呈现后
 * 走手填兜底（fail-closed 面向交互步，非 fail-stop 面）。
 *
 * R-2 加固（07 §8.4 尾注细则同笔）：
 * - **外层 race 同帽**：AbortSignal.timeout 只进 fetch init——守卫的 DNS
 *   解析腿（assertPublicHost await）不受 signal 管，注入/异常解析器挂死
 *   即整体挂死；外层 Promise.race 同帽兜全链（含 DNS 腿）。
 * - **体帽流式前置**：无 content-length 声明的越帽流（恶意/异常网关）在
 *   text() 全量读下先读满内存才拒——改 getReader() 分块累计越帽即
 *   cancel（不读满不等流尾）。
 * - **守卫拒/超时人话化**：私网拒补内网网关手填指路；超时折中文「N 秒
 *   未应答」（TimeoutError 洋文技术句不直透人面）。
 */
export async function fetchChannelModels(
  req: ChannelModelsRequest,
  deps: ChannelModelsFetchDeps = {},
): Promise<ChannelModelsResult> {
  const timeoutMs = deps.timeoutMs ?? CHANNEL_MODELS_TIMEOUT_MS;
  // 守卫包裹（每次调用构造——闭包零状态；SSRF 两查 + 连接级钉死在守卫内；
  // resolveDns 缺省 node:dns 真解析——测试注入公网桩走通路径）
  const guardedFetch = createSsrfGuardedFetch(deps.fetchImpl ?? pinnedFetch, deps.resolveDns);
  const url = channelModelsEndpoint(req.baseUrl, req.protocol);
  try {
    // 外层 race 同帽（R-2——DNS 腿帽覆盖；fetch 管线内 signal 仍在=双保险）
    const response = await Promise.race([
      guardedFetch(url, {
        method: 'GET',
        headers: channelModelsHeaders(req),
        signal: AbortSignal.timeout(timeoutMs),
      }),
      rejectAfter(timeoutMs, `${Math.round(timeoutMs / 100) / 10} 秒未应答（超时）——网关慢或地址错，可重试或手填`),
    ]);
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
    // 体帽闸一（先验声明——fetchDistTags 同形）
    const declared = response.headers?.get?.('content-length');
    if (declared !== undefined && declared !== null && Number(declared) > CHANNEL_MODELS_MAX_BYTES) {
      return { kind: 'failed', message: `清单文档过大（${declared} bytes）` };
    }
    // 体帽闸二（流式前置——分块累计越帽即 cancel，不读满不等流尾）
    const text = await readCapped(response, CHANNEL_MODELS_MAX_BYTES);
    if (text === undefined) {
      return { kind: 'failed', message: `清单文档过大（>${CHANNEL_MODELS_MAX_BYTES} bytes）` };
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
    return { kind: 'failed', message: fetchFailureMessage(err, timeoutMs) };
  }
}

/** 帽后拒（外层 race 腿——超时人话句单源，race 输与 catch 折共用形） */
function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

/** 流式读帽（R-2——分块累计越帽即 cancel 返回 undefined；正常读完解码文本） */
async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => {}); // 越帽即断流（cancel 失败无害——连接随 GC）
      return undefined;
    }
  }
  return new TextDecoder().decode(concatChunks(chunks, total));
}

/** 分块拼接（总长已知——一次分配） */
function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 失败腿人话化（R-2——私网拒补手填指路 / 超时折中文 / 其余守卫原文保留） */
function fetchFailureMessage(err: unknown, timeoutMs: number): string {
  // 超时形（AbortSignal.timeout 的 TimeoutError / race 腿 Error 已人话直透）
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `${Math.round(timeoutMs / 100) / 10} 秒未应答（超时）——网关慢或地址错，可重试或手填`;
  }
  if (err instanceof Error && /aborted/i.test(err.message)) {
    return `${Math.round(timeoutMs / 100) / 10} 秒未应答（超时）——网关慢或地址错，可重试或手填`;
  }
  if (err instanceof BaseError && err.code === 'WEB_PRIVATE_ADDRESS') {
    return `${err.message}——自动拉取只走公网；内网网关请手填模型清单`;
  }
  return err instanceof Error && err.message !== '' ? err.message : String(err);
}
