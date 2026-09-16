/**
 * host/plugin-market/fetch —— 网络抓取真身（03 §9.6 供应链与安全面·mp-4）。
 *
 * MarketFetchFace 契约（types.ts mp-2 钉形）的落码真身，两腿分治：
 *
 *  - **url 腿**（HTTPS JSON catalog 单文件）：ssrf-guard 消费律（03 §10.9）
 *    ——createSsrfGuardedFetch 包裹（parseWebUrl 协议白名单 → assertPublicHost
 *    私网/保留段拒〔字面+DNS〕→ pinDnsAddresses 入钉〔dns-pin 咬合，03
 *    §10.3〕→ fetchImpl redirect:'manual' + 同包单例 dispatcher）；外层自持
 *    **手动逐跳重定向跟随**——每跳目标经同一守卫复检（重定向是 SSRF 主载
 *    体），跳帽 5（DEFAULT_WEB_LIMITS 同值）；传输帽三件：60s 超时帽
 *    （AbortSignal 传给真传输 + 外层竞速执法——注桩不响应 signal 也兜住）、
 *    响应大小帽 2 MiB（**超帽拒非截断**——截断的 catalog = 坏 JSON，拒比
 *    宽容截断诚实）、内容类型校验（application/json* 认/头缺席宽容
 *    JSON.parse 终 gate/其余拒——HTML 错误页不冒充 catalog）。
 *    pinnedFetch 同包单源律（rb-2 批）：缺省 fetchImpl = web 域 pinnedFetch
 *    ——fetch 与 dispatcher 恒同包 undici，全局 fetch × 包 Agent 结构性互斥
 *    禁区不近。
 *
 *  - **git 腿**（市场仓克隆）：复用 plugin-install git 执行腿同族编舞
 *    （SpawnRunner 面 `git clone` → `git rev-parse HEAD` 两笔——**绝不新开
 *    git 通道**）；差异两点有意注记：①`--depth 1` 浅克隆——catalog 只需
 *    HEAD 快照（大仓 clone 磁盘/时间防线），装机腿 runGitInstall 保持全史
 *    克隆（要 checkout 任意 commit）；②**clone 超时帽 300s**（omp 30min 过
 *    宽——berry 收紧定值，§9.6 定形注随本批入册）。产物物化在真实文件系
 *    统（mkdtemp tmp）——add 编舞经 MarketFs promote 整树进缓存；**失败位
 *    tmp 自清**（成功返回后清场归调用方）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CATALOG_RELATIVE_PATHS } from './catalog.js';
import type { MarketFetchFace } from './types.js';
import { createDefaultSpawnRunner } from '../plugin-install.js';
import type { SpawnRunner } from '../plugin-install.js';
import { createSsrfGuardedFetch, pinnedFetch } from '../../web/index.js';
import type { DnsResolver, FetchLike } from '../../web/types.js';

/** url 腿超时帽（ms）——§9.6 定值（整个抓取含重定向跟随的总预算） */
export const MARKET_FETCH_TIMEOUT_MS = 60_000;

/** git 腿 clone 超时帽（ms）——omp 30min 收紧定值（§9.6 定形注） */
export const MARKET_CLONE_TIMEOUT_MS = 300_000;

/** url 腿响应体大小帽（bytes）——真仓 catalog 176KB 量级，2 MiB 留 10 倍余量 */
export const MARKET_CATALOG_MAX_BYTES = 2 * 1024 * 1024;

/** 重定向跳帽（DEFAULT_WEB_LIMITS.maxRedirects 同值——跳目标逐跳复检） */
export const MARKET_FETCH_MAX_REDIRECTS = 5;

/** 重定向状态码集（其余 3xx 按终态返回不跟随——web/service 同族） */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** 抓取面注入位（全可选——生产全缺省真身，测试逐项注桩零网络） */
export interface MarketFetchOptions {
  /** url 腿外联 fetch（缺省 pinnedFetch——dns-pin 同包单源律） */
  readonly fetchImpl?: FetchLike;
  /** DNS 解析位（ssrf-guard 私网判定——缺省 node:dns 真身，测试注桩） */
  readonly resolveDns?: DnsResolver;
  /** git 腿执行面（缺省 createDefaultSpawnRunner——与 plugin-install 同族） */
  readonly spawn?: SpawnRunner;
  /** 克隆中转根（缺省系统 tmp） */
  readonly tmpRoot?: string;
  /** url 腿超时帽（缺省 MARKET_FETCH_TIMEOUT_MS——测试收紧用） */
  readonly fetchTimeoutMs?: number;
  /** git 腿超时帽（缺省 MARKET_CLONE_TIMEOUT_MS——测试收紧用） */
  readonly cloneTimeoutMs?: number;
  /** url 腿响应大小帽（缺省 MARKET_CATALOG_MAX_BYTES——测试收紧用） */
  readonly maxCatalogBytes?: number;
}

/**
 * 竞速超时执法（注入位安全）：真传输腿 signal 由 undici 承载中止，但注桩
 * fetchImpl/spawn 可不理会 signal——外层竞速保证帽值恒被执法（谁先到谁赢）。
 * 子进程本体由 OS/网络栈自理（v1 不持 kill 句柄——execFile promisify 面）。
 */
function withTimeoutMs<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时帽（${ms}ms）触发——中止等待`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * 流式读响应体到大小帽（超帽即拒非截断——catalog 语义与 web fetch 面不同：
 * 截断文本 = 坏 JSON，宁可拒；web 面是「已读了这么多」的宽容截断）。
 */
async function readBodyToCap(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    return ''; // 空体——JSON.parse 终 gate 拒
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      // 触帽：弃流即拒（不收帽内余量——拒就是拒）
      await reader.cancel().catch(() => {
        // cancel 失败不阻断——连接由 undici 自理
      });
      throw new Error(`url 源响应体超大小帽（${maxBytes} bytes）——疑似非 catalog 的大响应，拒收`);
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
  // UTF-8 严格解码（fatal——二进制内容按拒处理）
  return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}

/**
 * MarketFetchFace 真身工厂：url 腿守卫消费 + 传输帽；git 腿克隆编舞 + 帽。
 */
export function createMarketFetchFace(options: MarketFetchOptions = {}): MarketFetchFace {
  const fetchTimeoutMs = options.fetchTimeoutMs ?? MARKET_FETCH_TIMEOUT_MS;
  const cloneTimeoutMs = options.cloneTimeoutMs ?? MARKET_CLONE_TIMEOUT_MS;
  const maxCatalogBytes = options.maxCatalogBytes ?? MARKET_CATALOG_MAX_BYTES;
  // ssrf-guard 消费律：守卫件包裹（每调用一次守卫跑一遍三查 + 入钉）
  const guardedFetch = createSsrfGuardedFetch(options.fetchImpl ?? pinnedFetch, options.resolveDns);
  const spawn = options.spawn ?? createDefaultSpawnRunner();

  return {
    async fetchUrlCatalog(url: string): Promise<{ readonly text: string }> {
      // 总预算 signal（真传输腿承载中止）+ 外层竞速（注桩安全网）
      const signal = AbortSignal.timeout(fetchTimeoutMs);
      const hop = async (): Promise<string> => {
        let current = url;
        let redirects = 0;
        let response: Response;
        while (true) {
          // 每跳经守卫：协议白名单 + 私网拒（字面+DNS）+ 入钉 + manual redirect
          response = await guardedFetch(current, { signal });
          if (!REDIRECT_STATUSES.has(response.status)) break;
          const location = response.headers.get('location');
          if (location === null) break; // 3xx 无 Location——按终态处理（下文非成功态拒）
          if (redirects >= MARKET_FETCH_MAX_REDIRECTS) {
            throw new Error(`url 源重定向跟随触帽（${MARKET_FETCH_MAX_REDIRECTS} 跳）：${url} → … → ${current}`);
          }
          redirects += 1;
          current = new URL(location, current).toString(); // 相对 Location 以当前跳为基
        }
        // 终态校验：非 2xx 拒（不把错误页文本当 catalog）
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`url 源响应非成功态（HTTP ${response.status}）——${url}`);
        }
        // 内容类型校验：application/json* 认；头缺席宽容（JSON.parse 终 gate）；其余拒
        const contentType = response.headers.get('content-type');
        if (contentType !== null && !/^application\/json\b/i.test(contentType)) {
          throw new Error(`url 源内容类型非 JSON（${contentType}）——疑似错误页或二进制，拒收`);
        }
        return readBodyToCap(response, maxCatalogBytes);
      };
      const text = await withTimeoutMs(hop(), fetchTimeoutMs, 'url 源抓取');
      return { text };
    },

    async fetchGitCatalog(url: string): Promise<{
      readonly cloneDir: string;
      readonly catalogPath: string;
      readonly text: string;
      readonly commit: string;
    }> {
      const cloneDir = mkdtempSync(join(options.tmpRoot ?? tmpdir(), 'berry-market-clone-'));
      try {
        // 编舞两笔（runGitInstall 同族）：浅克隆 → rev-parse HEAD
        // （--depth 1 = catalog 只需 HEAD 快照；任意历史 commit 装机由
        // installPlugin 腿全史克隆 checkout 承载，本腿不背）
        await withTimeoutMs(
          spawn.run('git', ['clone', '--depth', '1', url, cloneDir], {}),
          cloneTimeoutMs,
          'git clone',
        );
        const head = await withTimeoutMs(
          spawn.run('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], {}),
          cloneTimeoutMs,
          'git rev-parse',
        );
        const commit = head.stdout.trim();
        // 双路径读序定位 catalog（真盘读——克隆物化在真实文件系统）
        let missReason = '';
        for (const rel of CATALOG_RELATIVE_PATHS) {
          try {
            const text = readFileSync(join(cloneDir, rel), 'utf8');
            return { cloneDir, catalogPath: rel, text, commit };
          } catch {
            missReason = rel; // 记末次候选——全缺席时报文列读序
          }
        }
        throw new Error(
          `git 源 catalog 缺席（候选读序 ${CATALOG_RELATIVE_PATHS.join(' → ')} 全不在场，末查 ${missReason}）`,
        );
      } catch (error) {
        // 失败位 tmp 自清——清场归调用方的契约只在成功返回后生效
        rmSync(cloneDir, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
