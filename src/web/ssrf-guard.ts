/**
 * SSRF 守卫 fetch 包裹件（web 卫生单源的第三消费位——03 §10.9 oauth 案
 * 「SSRF 守卫」挂账收口件，2026-09-09）。
 *
 * 承载：oauth 外联腿（credentials 域——人面发起腿与刷新链腿）的 fetch
 * 预检包裹。插件声明的 deviceAuthUrl/tokenUrl 是任意 URL——宿主外联前
 * 经 web 卫生单源复用两查（协议白名单 + 私网/保留段拒，字面 + DNS）。
 *
 * 定形要点（03 §10.9 定形注同源）：
 * - **拦截码复用 `WEB_` 族不自造**（browser 件章同律——守卫错即 BaseError
 *   直传，消费面按码分流）；
 * - **`redirect: 'manual'` 钉死不跟随**——oauth 端点恒直答 200 形态，3xx
 *   应答按非 200 由 oauth 层折 FLOW_FAILED 兜底 fail-closed；自动跟随是
 *   SSRF 首跳绕过主载体（公网 URL 302 → 内网地址），钉死即闭合。重定向
 *   逐跳跟随编舞只在 web service 唯一实现（service.ts），本件不复制第二份；
 * - **守卫件住 web 域**——credentials 无 web 边（「本件无 web 边，fetchFn
 *   宿主装配位注入」），装配位（host 已有 web 边）包裹注入，credentials
 *   模块零改动。
 *
 * 与 web service 的分职：service = 模型可控任意 URL 的全卫生编排（在飞门/
 * 逐跳重定向/字节帽/归因落账）；本件 = 宿主外联固定端点的窄面包裹（无门
 * 无帽无归因——端点是插件声明非模型生成，额度面不适用）。
 */
import { assertPublicHost, defaultDnsResolver, parseWebUrl } from './hygiene.js';
import type { DnsResolver, FetchLike } from './types.js';

/**
 * 构造 SSRF 守卫 fetch：每次调用先卫生两查（解析 + 协议白名单 → 字面 +
 * DNS 私网拒），过了才透传底层 fetchImpl（init 原样 + redirect 钉 manual）。
 *
 * 返回形 = FetchLike（结构兼容全局 fetch 窄面；credentials OAuthFetchLike
 * 只消费 ok/status/text 三面——Response 超集，装配位直传即合法注入）。
 *
 * @param fetchImpl 底层 fetch（生产 = globalThis.fetch；测试注入桩）
 * @param resolveDns DNS 解析器（缺省 node:dns/promises lookup all——测试注入）
 */
export function createSsrfGuardedFetch(fetchImpl: FetchLike, resolveDns: DnsResolver = defaultDnsResolver): FetchLike {
  return async (url, init) => {
    // 卫生两查（卫生单源复用——解析/协议白名单在 parseWebUrl，字面 + DNS
    // 私网拒在 assertPublicHost；拒即抛 WEB_ 族 BaseError 不透传底层）
    const parsed = parseWebUrl(url);
    await assertPublicHost(parsed, resolveDns);
    // 透传（redirect 钉 manual 不跟随——3xx 按非 200 由消费面折兜底码）
    return fetchImpl(url, { ...init, redirect: 'manual' });
  };
}
