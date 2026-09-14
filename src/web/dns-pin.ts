/**
 * DNS rebinding 连接级钉死件（03 §10.3 安全卫生条 2026-09-14 定形注——
 * 「校验通过 → 连接」间隙的 TOCTOU 闭合，rb 批）。
 *
 * 病灶：卫生校验面（assertPublicHost DNS 全地址查）与实际连接面（fetch
 * 内部二次独立解析）之间存在 rebinding 窗——校验通过后攻击者 TTL=0 轮换
 * A 记录即「校验时公网、连接时内网」绕过。本件闭合该窗：
 *   校验通过的地址集入钉（进程级登记）→ 连接走钉值（单例 undici Agent
 *   connect.lookup 查登记，完全旁路真 DNS）→ fetch 调用携 dispatcher。
 *
 * 三裁决（真源 = 00-立题-DNS重绑定连接级钉死批-20260914）：
 * - **进程级单例**（裁决 1）：hostname 一经校验钉值恒定——同 host 后续请求
 *   不复开漂移窗；零生命周期编舞（连接池复用）。重复入钉 = **首钉保留**
 *   （已在钉即不覆盖）；每跳/后续请求的卫生校验照跑（私网拒仍执法），连接
 *   恒用首钉经校验集；
 * - **无钉即错 fail-closed**（裁决 2）：lookup 查不到登记时报错而非回落
 *   node:dns——回落 = 钉死面静默重开漂移窗。理论不达（两消费位恒先校验后
 *   连接），防御位留给未来第三消费位误用；
 * - **生产外联 fetch 恒走本包 fetch（fetch 与 dispatcher 同包律——2026-09-14
 *   第四役 rb-2 勘正形）**：Node 全局 fetch（内置 undici 7.28——旧 handler
 *   接口 onConnect/onHeaders 族）× 本包 8 Agent（新 RequestHandler 接口）
 *   在现役配对下**确定性互斥**（assertRequestHandler 接口断言必抛）；本包
 *   fetch × 本包 Agent 恒配。rb 批「全局 fetch 认 init.dispatcher」实验定案
 *   方向记反，随批废止（03 §10.3 ② 勘正注 + 07 §2.1 行同笔）——跨包形列
 *   结构性禁区，不押注两包 handler 接口跨版本对齐。
 *
 * 射程外：字面 IP URL 无 DNS 间隙天然无窗（钉值登记仅冗余无害）；出站代理
 * 不接（显式 Agent 无代理面——外联直连可审计）。
 */
import { Agent, fetch as undiciFetch } from 'undici';

import type { FetchLike } from './types.js';

/** 进程级钉死登记（hostname 小写归一 → 经校验公网地址集） */
const pins = new Map<string, readonly string[]>();

/** hostname 归一：小写 + 防御性剥 v6 [ ] 包裹形（URL.hostname 已剥，双保险） */
function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
}

/**
 * 入钉：卫生校验通过后登记地址集（调用方 = service 首跳/每跳、ssrf-guard
 * oauth 腿）。首钉保留（裁决 1）——已在钉即不覆盖；空主机名/空地址集防呆
 * 不入（不产空钉占键）。
 */
export function pinDnsAddresses(hostname: string, addresses: readonly string[]): void {
  const key = normalizeHost(hostname);
  if (key === '' || addresses.length === 0) return;
  if (!pins.has(key)) pins.set(key, [...addresses]);
}

/** 钉值只读面（诊断/测试断言——不在钉返回 undefined） */
export function pinnedAddressesOf(hostname: string): readonly string[] | undefined {
  return pins.get(normalizeHost(hostname));
}

/** 地址族判别（含 : → v6；其余按 v4） */
function familyOf(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

/** 请求族归一（node dns LookupOptions 新形态——数字形与 'IPv4'/'IPv6' 字串形） */
function normalizeFamily(family: number | 'IPv4' | 'IPv6' | undefined): 4 | 6 | undefined {
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return undefined;
}

/**
 * 钉值 lookup（net.connect 兼容签名——undici Agent connect.lookup 消费）：
 * - 在钉即用钉值：单形应答（address + family）/ all 形应答（地址族对数组
 *   ——node autoSelectFamily 消费形）双支持；
 * - 请求 family 过滤按族筛，**无匹配族即错**（不静默放宽到另一族——放宽
 *   即连接未经校验的族路径）；
 * - **无钉即错 fail-closed**（裁决 2）——报错不回落 node:dns。
 */
export function pinnedLookup(
  hostname: string,
  options: { family?: number | 'IPv4' | 'IPv6'; all?: boolean },
  callback: (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
): void {
  const key = normalizeHost(hostname);
  const pinned = pins.get(key);
  if (pinned === undefined) {
    callback(new Error(`DNS 钉死登记缺席（fail-closed 不回落真 DNS）：${key}——消费位须先经卫生校验入钉再连接`), '', 4);
    return;
  }
  const family = normalizeFamily(options.family);
  const filtered = family === undefined ? pinned : pinned.filter((address) => familyOf(address) === family);
  if (filtered.length === 0) {
    callback(new Error(`DNS 钉值无匹配族（family ${family}）——不静默放宽：${key}`), '', 4);
    return;
  }
  if (options.all === true) {
    callback(
      null,
      filtered.map((address) => ({ address, family: familyOf(address) })),
    );
    return;
  }
  const first = filtered[0]!;
  callback(null, first, familyOf(first));
}

/** dispatcher 单例（惰性铸——进程级，两消费位共用同一连接池） */
let dispatcherSingleton: Agent | null = null;

/**
 * 钉死 dispatcher 取用面：单例 undici Agent（connect.lookup = 钉值 lookup
 * ——连接地址完全由钉登记决定，完全旁路真 DNS）。调用方将其作为
 * `fetch(url, { dispatcher })` 的 init 键传抵**同包** fetch（跨包形禁区——
 * 头注第三裁决）。
 */
export function getPinnedDispatcher(): Agent {
  if (dispatcherSingleton === null) {
    dispatcherSingleton = new Agent({ connect: { lookup: pinnedLookup } });
  }
  return dispatcherSingleton;
}

/**
 * 生产外联 fetch 单源（rb-2 批——fetch 与 dispatcher 同包律的执法位）：
 * 同包 undici 8 fetch + 自携单例钉死 dispatcher。
 *
 * 为什么是导出面而非各消费位自行 import 包 fetch：① **单源**——service
 * 缺省 fetchImpl 与 ssrf-guard 装配注入两消费位同源消费，「哪条 fetch ×
 * 哪个 dispatcher」只此一处可答；② **自携 dispatcher**——调用方不传
 * dispatcher 也恒钉（未来第三消费位忘携的面一并闭死，与 lookup 无钉即错
 * fail-closed 同向纵深）；③ 测试注入桩 fetchImpl 的路径不受影响（deps 注
 * 入位优先于本缺省）。
 *
 * 返回类型经 FetchLike（DOM 形 Response 声明位）——同包 Response 与
 * @types/node 全局 Response 运行时同体、消费面（ok/status/text/headers）
 * 全在场，类型域以缺省赋值直配（typecheck 裁决——两声明源同出
 * undici-types）。
 */
export const pinnedFetch: FetchLike = (url, init) => undiciFetch(url, { ...init, dispatcher: getPinnedDispatcher() });
