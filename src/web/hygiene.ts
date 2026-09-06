/**
 * SSRF 卫生件纯函数（07 §1.1 core:web 行五卫生件之「私网拒绝」+ 协议白名单；
 * 03 §10.3 browser 件章安全卫生条：navigate 入口 URL 经本单源复用——拦截码
 * 复用 WEB_ 族不自造）。
 *
 * 判定序（execute 内编排序，本件只供原子判定）：
 *   URL 解析（WEB_URL_INVALID）→ 协议白名单 http/https（WEB_PROTOCOL_REJECTED）
 *   → 主机私网判定（字面 IP 段查 + DNS 解析结果查——WEB_PRIVATE_ADDRESS）
 * 重定向每跳目标重跑同一判定序。
 *
 * 已知边界（v1 注记）：DNS 校验与实际连接之间存在解析漂移窗（rebinding 全防
 * 需自定义连接级 lookup/undici dispatcher）——本件落「请求前解析全查」档，
 * 连接级钉死挂账后续批。
 */
import { lookup } from 'node:dns/promises';
import { BaseError } from '../contracts/index.js';
import type { DnsResolver } from './types.js';

/** 协议白名单（http(s) 两形——03 §10.3 browser 件章同源） */
export const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/** 缺省 DNS 解析器：node:dns/promises lookup 全地址族（生产位；测试注入桩） */
export const defaultDnsResolver: DnsResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true });
  return results.map((result) => result.address);
};

/**
 * 入口 URL 解析 + 协议白名单（卫生件段 0/1）。
 * @param raw 原始 URL 串
 * @returns 解析后的 URL 对象（原样——不做补全/改写；无协议裸主机形属调用方
 *   语义决定，本件保守拒——补全 https:// 的宽容归工具面参数预处理，不进卫生件）
 * @throws WEB_URL_INVALID 不可解析；WEB_PROTOCOL_REJECTED 白名单外协议
 */
export function parseWebUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BaseError('WEB_URL_INVALID', `URL 不可解析：${raw}`);
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) {
    throw new BaseError('WEB_PROTOCOL_REJECTED', `协议 ${url.protocol} 不在白名单（仅 http/https）：${raw}`);
  }
  return url;
}

/**
 * IPv4 私网/保留段判定（点分十进制已拆四段）。
 * 覆盖：环回 127/8、未指定 0/8、私网三段 10/8 + 172.16/12 + 192.168/16、
 * 链路本地 169.254/16、CGNAT 100.64/10、组播 224/4、保留 240/4。
 */
function isPrivateIPv4(octets: number[]): boolean {
  // 解构带缺省窄化索引访问（noUncheckedIndexedAccess）；缺省 -1 不落任何段
  const [a = -1, b = -1] = octets;
  return (
    a === 127 || // 环回
    a === 0 || // 未指定
    a === 10 || // 私网 A
    (a === 172 && b >= 16 && b <= 31) || // 私网 B
    (a === 192 && b === 168) || // 私网 C
    (a === 169 && b === 254) || // 链路本地
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // 组播 + 保留（224-255）
  );
}

/**
 * IPv6 私网/保留段判定（入参 = expandIPv6 产出的 8 组 4 位补零十六进制）。
 * 覆盖：未指定 ::、环回 ::1、唯一本地 fc00::/7、链路本地 fe80::/10、
 * v4 映射 ::ffff:0:0/96 与 v4 兼容 ::/96（尾 32 位还原 v4 递归查）、
 * v4 翻译 64:ff9b::/96（同递归）。
 */
function isPrivateIPv6(groups: string[]): boolean {
  // 显式索引取位（?? 收窄 noUncheckedIndexedAccess）——解构按位置赋值，
  // 命名跳位不等于索引跳位（首版 const [g0,g5,g6,g7] 实取 groups[0..3]，
  // v4 映射/兼容段误判——回归锁：::ffff:8.8.8.8 → false）
  const g0 = groups[0] ?? '';
  const g5 = groups[5] ?? '';
  const g6 = groups[6] ?? '0000';
  const g7 = groups[7] ?? '0000';
  // 未指定 ::（全零）
  if (groups.every((group) => group === '0000')) return true;
  // 环回 ::1（前七组零 + 尾组 1）
  if (groups.slice(0, 7).every((group) => group === '0000') && groups[7] === '0001') return true;
  // 唯一本地 fc00::/7（fc/fd 前缀）
  if (g0.startsWith('fc') || g0.startsWith('fd')) return true;
  // 链路本地 fe80::/10（fe80–febf：第三位十六进制 8-b）
  if (g0.startsWith('fe') && ['8', '9', 'a', 'b'].includes(g0[2] ?? '')) return true;
  // 尾 32 位还原 v4 四段（g6 高 16 位 / g7 低 16 位）
  const decodeV4Tail = (): number[] => {
    const high = Number.parseInt(g6, 16);
    const low = Number.parseInt(g7, 16);
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
  };
  // v4 映射 ::ffff:0:0/96（前 5 组零 + 第 6 组 ffff）与 v4 兼容 ::/96（前 6 组零）
  if (groups.slice(0, 5).every((group) => group === '0000') && (g5 === 'ffff' || g5 === '0000')) {
    return isPrivateIPv4(decodeV4Tail());
  }
  // v4 翻译 64:ff9b::/96（0064:ff9b 前缀 + 第 3-6 组零）
  if (g0 === '0064' && groups[1] === 'ff9b' && groups.slice(2, 6).every((group) => group === '0000')) {
    return isPrivateIPv4(decodeV4Tail());
  }
  return false;
}

/**
 * 主机名私网判定（字面腿——不做 DNS）：字面 IP（v4/v6 含 [ ] 包裹形）与
 * localhost 族（RFC 6761——*.localhost 恒解析环回）。
 * @returns true = 私网/保留（拒）；false = 字面面非私网或非字面形（交 DNS 腿）
 */
export function isPrivateHostLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // IPv6 包裹形 [::1]
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  // v4 字面：四段点分全数字
  const v4Match = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4Match) {
    const octets = v4Match.slice(1).map(Number);
    if (octets.every((octet) => octet >= 0 && octet <= 255)) {
      return isPrivateIPv4(octets);
    }
  }
  // IPv6 字面（含 %zone 尾——链路本地常用 zone 形，直接拒）
  if (bare.includes(':')) {
    const zoneless = bare.split('%')[0] ?? bare;
    const expanded = expandIPv6(zoneless);
    if (expanded) return isPrivateIPv6(expanded);
  }
  // localhost 族：裸 localhost 与 *.localhost（点尾任意）
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return false;
}

/**
 * IPv6 展开辅助：把压缩形（::）展开为 8 组 4 位十六进制前 2 位小写数组；
 * 非 8 组形（内嵌 v4 等）返回 null 交调用方原样处理。
 * 返回形：每组保留完整 4 位十六进制（比较用）。
 */
function expandIPv6(input: string): string[] | null {
  // 内嵌 v4 尾（如 ::ffff:192.168.0.1）先转两组十六进制
  let text = input;
  const v4Tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const [a = -1, b = -1, c = -1, d = -1] = (v4Tail[2] ?? '').split('.').map(Number);
    if ([a, b, c, d].some((octet) => octet < 0 || octet > 255)) return null;
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    text = `${v4Tail[1] ?? ''}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null; // 双 :: 非法
  const parseGroups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const fill = 8 - head.length - tail.length;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? fill : 0 }, () => '0'), ...tail];
  if (groups.length !== 8) return null;
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, '0'));
}

/**
 * 主机私网判定全腿（字面 + DNS）：字面腿命中即拒；非字面主机名经解析器
 * 全地址查——任一解析结果落私网段即拒（DNS rebinding 首跳防御档）。
 * @throws WEB_PRIVATE_ADDRESS 私网/保留段命中
 * @throws 原样上抛解析失败（非卫生拦截——网络不可达属普通失败，不携 WEB_ 码）
 */
export async function assertPublicHost(url: URL, resolveDns: DnsResolver): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // URL 已剥 []，防御双保险
  if (isPrivateHostLiteral(hostname)) {
    throw new BaseError('WEB_PRIVATE_ADDRESS', `目标主机属私网/保留段（SSRF 红线拒）：${hostname}`);
  }
  const addresses = await resolveDns(hostname);
  const hit = addresses.find((address) => {
    const bare = address.split('%')[0] ?? address;
    if (bare.includes(':')) {
      const expanded = expandIPv6(bare);
      return expanded ? isPrivateIPv6(expanded) : false;
    }
    const v4Match = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4Match) return false;
    const octets = v4Match.slice(1).map(Number);
    return octets.every((octet) => octet >= 0 && octet <= 255) && isPrivateIPv4(octets);
  });
  if (hit) {
    throw new BaseError('WEB_PRIVATE_ADDRESS', `目标主机解析命中私网/保留段地址（SSRF 红线拒）：${hostname} → ${hit}`);
  }
}
