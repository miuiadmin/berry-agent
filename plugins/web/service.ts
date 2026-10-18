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
 * 时钟立场（03 §10.3 安全卫生条 2026-10-18 60 轮定形注）：自设时钟不设、
 * 调用方显式 per-call 预算代持——服务内不自起时钟（可测性 + 预算单源两
 * rationale 维持不变）；init.timeoutMs 在场时按授予值代持墙钟帽（外层
 * race 同帽兜全链——守卫 DNS 腿与重定向跳皆进帽），缺席仍零时钟。signal
 * 归调用方（工具面 = run 级协作中断；服务面 = 调用方自带）。
 *
 * 连接级钉死（2026-09-14 rb 批——原 v1 注记「解析漂移窗挂账」已收口）：
 * 每跳 assertPublicHost 通过的地址集入钉（dns-pin 进程级登记）+ fetch 调用
 * 携单例 dispatcher——「校验通过 → 连接」的 rebinding TOCTOU 间隙闭合。
 */
import { BaseError } from '../../src/contracts/index.js';
import { getPinnedDispatcher, pinDnsAddresses, pinnedFetch } from './dns-pin.js';
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

/** 跨源跳转须剥的凭证头族（小写键比对——fetch 规范跨源重定向同保护） */
const CROSS_ORIGIN_CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
]);

/** 跨源跳转剥凭证头：剔除命中族（键名小写比对——大小写不敏感），其余头原样保留 */
function stripCrossOriginCredentials(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CROSS_ORIGIN_CREDENTIAL_HEADERS.has(key.toLowerCase())) kept[key] = value;
  }
  return kept;
}

/**
 * 逐跳中止面合流（per-call 墙钟预算执法①路——03 §10.3 安全卫生条
 * 2026-10-18 60 轮定形注）：调用方协作 signal 与帽钟经 AbortSignal.any
 * 合流——run 取消/墙钟到点任一触发即断每跳连接（两轴分立正交，合流点
 * 唯一）。单侧在场直通、双侧缺席 undefined（零时钟面不变）。两 API 依
 * package.json engines node>=24 恒可用。
 */
function mergeHopSignals(caller: AbortSignal | undefined, timeout: AbortSignal | undefined): AbortSignal | undefined {
  if (caller === undefined) return timeout;
  if (timeout === undefined) return caller;
  return AbortSignal.any([caller, timeout]);
}

/**
 * 帽后拒腿（外层 race 执法②路——channel-models R-2 rejectAfter 同族单源
 * 形，最小修不跨文件收敛、形互指即可）。可清形：race 落定后调用方 cancel
 * 清钟——不留武装至帽尽才对已死 promise reject 的死钟。
 */
function rejectAfter(ms: number, message: string): { promise: Promise<never>; cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

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
  // 缺省外联腿 = dns-pin 同包 pinnedFetch（fetch 与单例 dispatcher 同包同版——
  // 接口恒配；rb-2 批勘正：旧缺省全局 fetch × 包 Agent 在现役配对下确定性
  // 互斥必抛——跨包形禁区，禁回改）
  const fetchImpl: FetchLike = deps.fetchImpl ?? pinnedFetch;
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
      // per-call 墙钟预算代持（03 §10.3 安全卫生条 2026-10-18 60 轮定形注；
      // 缺席 = 零时钟——服务内自设时钟不设的既有分层不变）。在场时两路执法：
      // ① 帽钟（AbortSignal.timeout，计时器不占事件循环）与调用方协作
      //    signal 经 AbortSignal.any 合流进每跳 fetch init——真连接到点即断
      //    （慢滴形：undici 缺省 headersTimeout/bodyTimeout 只卡首字节/块间，
      //    兜不住全程）；
      // ② 外层 race 同帽兜全链——守卫 DNS 腿（assertPublicHost 的 await 先
      //    于任何 fetch、不受 init signal 管）与全部重定向跳、体读取皆进帽
      //    （channel-models R-2 同形同判）；race 落定即清钟不留死钟。
      // 两轴分立正交：run 级协作取消即时断、墙钟到点兜底断。
      const timeoutMs = init.timeoutMs;
      const timeoutSignal = timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined;
      const hopSignal = mergeHopSignals(init.signal, timeoutSignal);
      const timeoutLeg =
        timeoutMs !== undefined
          ? rejectAfter(
              timeoutMs,
              `请求未在墙钟预算内完成（${Math.round(timeoutMs / 100) / 10} 秒超时）——目标响应过慢或慢滴`,
            )
          : undefined;
      // 进度快照——ok 结局在 task 内记全量；失败结局在外层 catch 记（记到哪
      // 步算哪步：finalUrl/status 到达即带，早拒即缺席）
      let finalUrl: string | undefined;
      let status: number | undefined;
      let bytes = 0;
      let redirects = 0;
      try {
        // 全链单腿（gate 占门 → 守卫 DNS → 逐跳 fetch → 体读取）——帽在场时
        // 整腿进外层 race；task 迟到的 settle/reject 由 race 吸收（race 对
        // 全体入腿挂接处理器——迟到拒不坠 unhandledRejection；门在 gate.run
        // 的 finally 面 release，迟到路径不泄漏占门）
        const task = gate.run(async () => {
          // 卫生件 1/5：在飞门（满拒 WEB_RATE_LIMITED——由 gate.run 抛出，外层
          // catch 统一落账）
          // 卫生件 2/5：URL 解析 + 协议白名单
          let url = parseWebUrl(rawUrl);
          // 卫生件 3/5：私网判定（字面 + DNS）——通过地址集入钉（连接级钉死）
          pinDnsAddresses(url.hostname, await assertPublicHost(url, resolveDns));

          // 卫生件 4/5：重定向逐跳跟随（手动——每跳目标重跑三查，跳数触帽拒）
          let requestMethod = method;
          let requestBody = init.body;
          // 逐跳头可变副本：跨源跳转剥凭证头（对齐 fetch 规范跨源重定向语义
          // ——原生 follow 由传输层剥 Authorization/Cookie 族；手动逐跳实现
          // 须自持同保护，否则调用方凭证头被原样转发给任意跳转目标 = 凭证泄漏面）
          let requestHeaders: Record<string, string> | undefined = init.headers;
          let response: Response;
          while (true) {
            response = await fetchImpl(url.toString(), {
              method: requestMethod,
              ...(requestHeaders ? { headers: requestHeaders } : {}),
              ...(requestBody !== undefined ? { body: requestBody } : {}),
              redirect: 'manual',
              // 跳中止面 = 调用方协作 signal 与墙钟帽钟的合流面（预算缺席时
              // 即调用方 signal 原样——既有行为不变）
              ...(hopSignal ? { signal: hopSignal } : {}),
              // 连接级钉死：同包 fetch init.dispatcher 位（连接走钉值 lookup；
              // 调用方显式再携一次与 pinnedFetch 自携同值幂等——保注入桩
              // fetchImpl 路径的 dispatcher 断言面）
              dispatcher: getPinnedDispatcher(),
            });
            if (!REDIRECT_STATUSES.has(response.status)) break;
            const location = response.headers.get('location');
            if (!location) break; // 3xx 无 Location——按终态返回（宽容不发明跳转）
            // 此响应体从此必不被读（跟随下一跳 / 跳数触帽拒 / 跳目标卫生拒——
            // 三出口皆弃读）——主动 cancel 释连接（与 readBodyCapped 触帽
            // reader.cancel() 同纪律：边缘大体场景连接不悬挂）。cancel 失败
            // 吞错不阻主路——连接由 undici 自理
            void response.body?.cancel().catch(() => {});
            if (redirects >= limits.maxRedirects) {
              throw new BaseError(
                'WEB_REDIRECT_LIMIT',
                `重定向跟随达上限（${limits.maxRedirects} 跳）：${rawUrl} → … → ${url.toString()}`,
              );
            }
            // 跳目标经同一卫生单源复检（协议/私网/DNS——重定向是 SSRF 主载体）
            // + 通过地址集再钉（跳后连接同走钉值——每跳不复开漂移窗）
            const next = parseWebUrl(new URL(location, url.toString()).toString());
            pinDnsAddresses(next.hostname, await assertPublicHost(next, resolveDns));
            redirects += 1;
            // 跨源跳转剥凭证头（大小写不敏感——键名小写比对剔除，普通头原样保留）
            if (requestHeaders !== undefined && next.origin !== url.origin) {
              requestHeaders = stripCrossOriginCredentials(requestHeaders);
            }
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
        if (timeoutLeg === undefined) {
          // 零时钟腿：无预算直行（既有行为原样——服务面调用方预算自带）
          return await task;
        }
        try {
          // 外层 race 同帽兜全链（执法②路——守卫 DNS 腿/不协作 signal 的
          // 面也到点即拒；超时拒折普通 Error 走外层 catch 落 error 账）
          return await Promise.race([task, timeoutLeg.promise]);
        } finally {
          // race 落定即清钟（fetch 先胜/先拒都清——不留武装至帽尽才对已死
          // promise reject 的死钟；超时腿自胜时对已发钟为 no-op 清账零副作用）
          timeoutLeg.cancel();
        }
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
