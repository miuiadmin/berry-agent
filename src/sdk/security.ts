/**
 * sdk/security — HTTP 面三防线判定器与 token 生成（批 13e-1；10.4 回环钉死
 * 条款同律复用引证 + 03 §10.6 差异面④⑤ 扩集谓词）。
 *
 * 纯函数件：判定器零 IO 零依赖（传输实装 13e-2 在 node:http 挂点位消费），
 * 词面单源如下——
 * - 回环白名单三形：`127.0.0.1` / `localhost` / `[::1]`（带可选 `:port`）；
 * - 非回环绑定形态 Host 扩集（差异面④）：校验值域与配置绑定地址匹配——
 *   Host 主机部须恰等于绑定 host（大小写不敏感；IPv6 括号形同归一），
 *   **不接受任意 Host**（DNS rebinding 防线原义保留——attacker 域名 ≠ 绑定
 *   地址字面即拒）；回环绑定形态值域不变；
 * - Origin 硬防线（10.4③）：带 Origin 且非同源三形 = 403；**无 Origin 头
 *   放行**（防线判浏览器跨源，不判非浏览器客户端——SDK 调用方恒无 Origin）。
 */
import { randomBytes } from 'node:crypto';

import type { SdkHttpListenConfig } from './types.js';

/** 回环白名单主机三形（10.4② 值域穷举字面——回环绑定形态恒用此值域） */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** 归一 Host 头主机部：剥可选 `:port`（IPv6 括号形内冒号不剥）+ 小写归一 */
export function hostPartOf(hostHeader: string): string {
  const lower = hostHeader.toLowerCase();
  // 括号 IPv6 形 `[::1]:7860` —— 只剥闭括号后的端口段
  if (lower.startsWith('[')) {
    const close = lower.indexOf(']');
    if (close !== -1) return lower.slice(0, close + 1);
    return lower;
  }
  const colon = lower.indexOf(':');
  return colon === -1 ? lower : lower.slice(0, colon);
}

/** 判定 host 是否回环三形之一（`::1` 裸形归一 `[::1]` 同判） */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase() === '::1' ? '[::1]' : host.toLowerCase();
  return LOOPBACK_HOSTS.has(normalized);
}

/**
 * Host 头白名单判定（三防线②——10.4 同律 + 差异面④ 扩集）。
 * @param hostHeader 请求 Host 头原值（缺席/空串 = 拒——HTTP/1.1 Host 必在场）
 * @param bindHost 配置绑定地址（回环三形或显式非回环地址）
 */
export function judgeHostHeader(
  hostHeader: string | undefined,
  bindHost: string,
): { ok: true } | { ok: false; reason: string } {
  if (hostHeader === undefined || hostHeader === '') {
    return { ok: false, reason: 'Host 头缺席（HTTP/1.1 必在场）' };
  }
  const part = hostPartOf(hostHeader);
  if (isLoopbackHost(bindHost)) {
    // 回环绑定形态：值域 = 回环穷举字面（差异面④「回环绑定形态值域不变」）
    if (LOOPBACK_HOSTS.has(part)) return { ok: true };
    return { ok: false, reason: `回环绑定形态只受回环 Host（收 ${part}）` };
  }
  // 非回环绑定形态：扩集谓词 = Host 主机部恰等于绑定地址（地址族匹配的严格形）
  const bindNormalized = bindHost.toLowerCase() === '::1' ? '[::1]' : bindHost.toLowerCase();
  const bindBracketed =
    bindNormalized.includes(':') && !bindNormalized.startsWith('[') ? `[${bindNormalized}]` : bindNormalized;
  if (part === bindNormalized || part === bindBracketed) return { ok: true };
  return { ok: false, reason: `非回环绑定形态只受绑定地址 Host（收 ${part} 期 ${bindNormalized}）` };
}

/**
 * Origin 硬防线判定（三防线③——10.4 同律）。同源三形 = 监听回环三形 +
 * 监听端口（sdk 面 scheme 恒 http）；**无 Origin 放行**（程序调用方）。
 */
export function originAllowed(origin: string | undefined, listenHost: string, listenPort: number): boolean {
  if (origin === undefined || origin === '') return true; // 防线判浏览器跨源
  // 回环绑定形态：同源三形 = 回环穷举（值域与 Host 白名单对称——10.4③）
  const sameOrigin = new Set([
    `http://127.0.0.1:${listenPort}`,
    `http://localhost:${listenPort}`,
    `http://[::1]:${listenPort}`,
  ]);
  if (isLoopbackHost(listenHost) && sameOrigin.has(origin)) return true;
  // 非回环绑定形态：同源 = scheme://绑定地址:端口 恰等（与 Host 扩集同族）
  const host = listenHost.toLowerCase();
  const bracketed = host === '::1' ? '[::1]' : host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return origin === `http://${bracketed}:${listenPort}`;
}

/**
 * 生成一次性 token（10.4 token 鉴权件本体保证同律：32 字节随机 hex、只存
 * 内存不落盘——披露面归宿主形态）。
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 启动断言（三防线①——差异面③ fail-closed 拒启律不豁免）：非回环 TCP 绑定
 * 必配预置凭证；违例即拒启（daemon 形退 2——07 §5 定名注）。收整个开面配置
 * 形（socketPath 无关判定——只审 TCP 侧与凭证位）。
 */
export function judgeListenConfig(config: SdkHttpListenConfig): { ok: true } | { ok: false; reason: string } {
  if (config.tcp === undefined) return { ok: true };
  if (!isLoopbackHost(config.tcp.host) && (config.token === undefined || config.token === '')) {
    return {
      ok: false,
      reason: `非回环绑定（${config.tcp.host}）必配鉴权凭证 BERRY_AGENT_SDK_TOKEN——fail-closed 拒启（03 §10.6 差异面③）`,
    };
  }
  return { ok: true };
}
