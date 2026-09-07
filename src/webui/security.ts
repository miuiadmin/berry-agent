/**
 * webui/security — HTTP 面三防线判定器与 token 生成（批 18a-1；03 §10.4
 * 回环钉死三防线 + token 鉴权件本体保证条款的执法位）。
 *
 * 纯函数件：判定器零 IO 零依赖（传输实装 server.ts 在 node:http 挂点位
 * 消费）。词面单源——
 * - 回环白名单三形：`127.0.0.1` / `localhost` / `[::1]`（带可选 `:port`）；
 * - Host 头白名单：回环绑定形态值域 = 回环穷举字面（非回环形 Host = 403，
 *   DNS rebinding 防线）；非回环绑定形态（须配凭证）值域 = 绑定地址字面
 *   （不接受任意 Host——防线原义保留）；
 * - Origin 硬防线：带 Origin 且非同源三形 = 403，值域与 Host 白名单对称
 *   含 `[::1]`；**无 Origin 头放行**（防线判浏览器跨源，不判非浏览器客户端）。
 *
 * 同律复用引证（非代码 import——sdk 件与 webui 件无 DAG 边，边表执法）：
 * sdk/security（批 13e-1）与本件同承 03 §10.4 原始条款；两侧判定器语义
 * 等价、各自单源，漂移由对拍测试互证（测试文件不计边表账——02 §4.1 用例
 * 证据口径）。
 */
import { randomBytes } from 'node:crypto';

import type { WebuiListenConfig } from './types.js';

/** 回环白名单主机三形（03 §10.4② 值域穷举字面——回环绑定形态恒用此值域） */
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
 * Host 头白名单判定（三防线②）。
 * @param hostHeader 请求 Host 头原值（缺席/空串 = 拒——HTTP/1.1 Host 必在场）
 * @param bindHost 配置绑定地址（缺省回环或显式非回环地址）
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
    // 回环绑定形态：值域 = 回环穷举字面（非回环形 Host = 403）
    if (LOOPBACK_HOSTS.has(part)) return { ok: true };
    return { ok: false, reason: `回环绑定形态只受回环 Host（收 ${part}）` };
  }
  // 非回环绑定形态：值域 = Host 主机部恰等于绑定地址（不接受任意 Host）
  const bindNormalized = bindHost.toLowerCase() === '::1' ? '[::1]' : bindHost.toLowerCase();
  const bindBracketed =
    bindNormalized.includes(':') && !bindNormalized.startsWith('[') ? `[${bindNormalized}]` : bindNormalized;
  if (part === bindNormalized || part === bindBracketed) return { ok: true };
  return { ok: false, reason: `非回环绑定形态只受绑定地址 Host（收 ${part} 期 ${bindNormalized}）` };
}

/**
 * Origin 硬防线判定（三防线③）。同源三形 = 监听回环三形 + 监听端口
 * （webui 面 scheme 恒 http）；**无 Origin 放行**（非浏览器客户端）。
 */
export function originAllowed(origin: string | undefined, listenHost: string, listenPort: number): boolean {
  if (origin === undefined || origin === '') return true; // 防线判浏览器跨源
  // 回环绑定形态：同源三形 = 回环穷举（值域与 Host 白名单对称——03 §10.4③）
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
 * 生成一次性 token（token 鉴权件本体保证：apply 期自足生成 32 字节随机
 * hex、只存内存不落盘 + 一次性披露面——TUI notify 横幅 / headless stderr，
 * 披露编舞归宿主装配批）。
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 启动断言（三防线①——fail-closed 拒启律预埋）：非回环绑定且未显式配鉴权
 * 凭证 = 拒启（03 §10.4①「非回环 ⇒ 必配凭证」——v1 凭证载体 = listen
 * config token 位，env 形随装配批定名）。
 */
export function judgeListenConfig(config: WebuiListenConfig): { ok: true } | { ok: false; reason: string } {
  const host = config.host ?? '';
  // 缺省绑定（host 缺席）恒回环——只有显式非回环绑定才触发凭证判定
  if (config.host !== undefined && !isLoopbackHost(host) && (config.token === undefined || config.token === '')) {
    return {
      ok: false,
      reason: `非回环绑定（${host}）必配鉴权凭证——fail-closed 拒启（03 §10.4① 预埋条款）`,
    };
  }
  return { ok: true };
}
