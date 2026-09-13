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
 * - **只用包 Agent 类不用包 fetch**：node 全局 fetch 认 init.dispatcher、
 *   undici@8 包 fetch 不认（实验定案）——fetch 调用恒走全局 fetch。
 *
 * 射程外：字面 IP URL 无 DNS 间隙天然无窗（钉值登记仅冗余无害）；出站代理
 * 不接（显式 Agent 无代理面——外联直连可审计）。
 */
import { Agent } from 'undici';

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
 * `fetch(url, { dispatcher })` 的 init 键传抵全局 fetch。
 */
export function getPinnedDispatcher(): Agent {
  if (dispatcherSingleton === null) {
    dispatcherSingleton = new Agent({ connect: { lookup: pinnedLookup } });
  }
  return dispatcherSingleton;
}
