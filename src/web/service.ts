/**
 * WebFetchService——三消费面共用的唯一 execute 路径（02 §4.1 席 18「两消费
 * 面同一 execute」+ 03 §10.3 browser 件章第三消费位）。
 *
 * 五卫生件编排序（缺一不可、逐跳复跑）：
 *   限流（在飞门）→ URL 解析 + 协议白名单 → 私网判定（字面 + DNS）→
 *   重定向跟随（手动逐跳——每跳目标重跑解析/协议/私网三查，跳数触帽拒）→
 *   字节上限（流式读取，触帽截断置 truncated 非拒）→ 归因落账（sink 注入，
 *   ok/blocked/error 三结局全落——运行账「谁在何时取了什么」）。
 *
 * 超时不在本件：signal 归调用方（工具面 = 管道执行段预算；服务面 = 调用方
 * 自带）——服务内不设时钟（可测性 + 预算单源）。
 *
 * 已知边界（v1 注记）：redirect:'manual' 逐跳拦截 + 请求前 DNS 全查已覆盖
 * 模型可控的全部 URL 面；DNS 校验与实际连接的解析漂移窗（rebinding）与
 * undici 连接级钉死挂账后续批。
 */
import { BaseError } from '../contracts/index.js';
import { createInFlightGate } from './gate.js';
import { assertPublicHost, defaultDnsResolver, parseWebUrl } from './hygiene.js';
import type {
  DnsResolver,
  FetchLike,
  WebAttributionRecord,
  WebAttributionSink,
  WebConsumer,
  WebFetchDeps,
  WebFetchLimits,
  WebFetchResponse,
  WebFetchService,
} from './types.js';

/** 缺省数值帽（随实机校准回填——规范不收数字，07 §1.1 只列五卫生件名目） */
export const DEFAULT_WEB_LIMITS: WebFetchLimits = {
  maxRedirects: 5,
  maxBytes: 1024 * 1024,
  maxConcurrent: 4,
};

/** 重定向状态码集（其余 3xx 按终态返回不跟随） */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * 流式读响应体到字节帽：触帽即 cancel 流（不再拉数据）、截到恰好帽值、
 * truncated 置真。只产原始字节——UTF-8 严格解码由调用方在快照 bytes 之后
 * 做（解码失败也是「已读了这么多字节」的失败，归因记账不归零）。
 */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ raw: Uint8Array; bytes: number; truncated: boolean }> {
  if (response.body === null) {
    // HEAD/204 等空体形——零字节非截断
    return { raw: new Uint8Array(0), bytes: 0, truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      // 触帽：只收帽内余量，弃流
      const remainder = maxBytes - total;
      if (remainder > 0) chunks.push(value.slice(0, remainder));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {
        // cancel 失败不阻断——连接由 undici 自理，数据已不再被读
      });
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { raw: merged, bytes: total, truncated };
}

/** UTF-8 严格解码（截断劈尾回退剥 ≤3 字节——UTF-8 最长序列 4 字节；真非 UTF-8 各试皆红抛普通 Error——二进制内容不适用文本 fetch 面，属普通失败非卫生拦截） */
function decodeUtf8Strict(bytes: Uint8Array, truncated: boolean): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // 未截断时全长一次即判（劈尾剥除只对截断形有意义）；截断形全长 → 剥 1..3
  const candidates = truncated ? [0, 1, 2, 3] : [0];
  for (const trim of candidates) {
    try {
      return decoder.decode(bytes.subarray(0, bytes.byteLength - trim));
    } catch {
      // 继续下一候选
    }
  }
  throw new Error('响应体非 UTF-8 文本——二进制内容不适用 fetch 工具（文本面只认 UTF-8）');
}

/**
 * 服务构造：三消费面（fetch 工具 / ctx.fetch 插件消费 / browser 导航）共用
 * 同一 service 实例即共用同一 execute 与同一在飞门。
 */
export function createWebFetchService(deps: WebFetchDeps = {}): WebFetchService {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const resolveDns: DnsResolver = deps.resolveDns ?? defaultDnsResolver;
  const now = deps.now ?? (() => Date.now());
  const sink: WebAttributionSink = deps.sink ?? (() => {});
  const limits: WebFetchLimits = { ...DEFAULT_WEB_LIMITS, ...deps.limits };
  const gate = deps.gate ?? createInFlightGate(limits.maxConcurrent);

  // 归因落账统一出口：sink 自身异常不吞业务结果也不中断——归因属观测面
  const record = (entry: WebAttributionRecord): void => {
    try {
      sink(entry);
    } catch {
      /* 归因 sink 异常静默——观测面不绑架数据面 */
    }
  };

  return {
    async fetch(rawUrl, init = {}) {
      const consumer: WebConsumer = init.consumer ?? 'service';
      const method = init.method ?? 'GET';
      const startedAt = now();
      // 进度快照——ok 结局在 task 内记全量；失败结局在外层 catch 记（记到哪
      // 步算哪步：finalUrl/status 到达即带，早拒即缺席）
      let finalUrl: string | undefined;
      let status: number | undefined;
      let bytes = 0;
      let redirects = 0;
      try {
        return await gate.run(async () => {
          // 卫生件 1/5：在飞门（满拒 WEB_RATE_LIMITED——由 gate.run 抛出，外层
          // catch 统一落账）
          // 卫生件 2/5：URL 解析 + 协议白名单
          let url = parseWebUrl(rawUrl);
          // 卫生件 3/5：私网判定（字面 + DNS）
          await assertPublicHost(url, resolveDns);

          // 卫生件 4/5：重定向逐跳跟随（手动——每跳目标重跑三查，跳数触帽拒）
          let requestMethod = method;
          let requestBody = init.body;
          let response: Response;
          while (true) {
            response = await fetchImpl(url.toString(), {
              method: requestMethod,
              ...(init.headers ? { headers: init.headers } : {}),
              ...(requestBody !== undefined ? { body: requestBody } : {}),
              redirect: 'manual',
              ...(init.signal ? { signal: init.signal } : {}),
            });
            if (!REDIRECT_STATUSES.has(response.status)) break;
            const location = response.headers.get('location');
            if (!location) break; // 3xx 无 Location——按终态返回（宽容不发明跳转）
            if (redirects >= limits.maxRedirects) {
              throw new BaseError(
                'WEB_REDIRECT_LIMIT',
                `重定向跟随触帽（${limits.maxRedirects} 跳）：${rawUrl} → … → ${url.toString()}`,
              );
            }
            // 跳目标经同一卫生单源复检（协议/私网/DNS——重定向是 SSRF 主载体）
            const next = parseWebUrl(new URL(location, url.toString()).toString());
            await assertPublicHost(next, resolveDns);
            redirects += 1;
            url = next;
            // 方法改写语义：303 恒转 GET 弃体；301/302 携 POST 按浏览器兼容转
            // GET（RFC 保留方法但现实生态如此）；307/308 保方法保体
            if (
              response.status === 303 ||
              ((response.status === 301 || response.status === 302) && requestMethod === 'POST')
            ) {
              requestMethod = 'GET';
              requestBody = undefined;
            }
          }

          // 卫生件 5/5：字节上限（截断非拒）——bytes 先快照（解码失败也记
          // 已读字节数），UTF-8 严格解码在后
          const read = await readBodyCapped(response, limits.maxBytes);
          bytes = read.bytes;
          const body = decodeUtf8Strict(read.raw, read.truncated);
          finalUrl = url.toString();
          status = response.status;
          record({
            consumer,
            method: requestMethod,
            url: rawUrl,
            finalUrl,
            status,
            bytes,
            redirects,
            outcome: 'ok',
            at: startedAt,
          });
          return {
            url: rawUrl,
            finalUrl,
            status,
            contentType: response.headers.get('content-type') ?? '',
            body,
            truncated: read.truncated,
            bytes,
            redirects,
          } satisfies WebFetchResponse;
        });
      } catch (error) {
        // 失败结局统一落账：BaseError = 卫生拦截（blocked + 码）；其余 = 普通失败
        // （DNS/网络/中止/解码——error 档无码）。在飞门拒也经此路（gate.run 内
        // 先抛，快照全空即早拒形）
        record({
          consumer,
          method,
          url: rawUrl,
          ...(finalUrl !== undefined ? { finalUrl } : {}),
          ...(status !== undefined ? { status } : {}),
          bytes,
          redirects,
          outcome: error instanceof BaseError ? 'blocked' : 'error',
          ...(error instanceof BaseError ? { errorCode: error.code } : {}),
          at: startedAt,
        });
        throw error;
      }
    },
  };
}
