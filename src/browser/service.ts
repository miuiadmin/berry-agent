/**
 * browser 编排件（03 §10.3 生命周期条款的执法位）。
 *
 * - 惰性首用：apply 零 spawn（「装载在场」≠「引擎在场」——零工具调用 =
 *   零进程零连接）；首个工具调用才经 launchBrowserEngine 起引擎。
 * - 会话路由：contexts Map by toolCtx.sessionId（?? 'default'）——每键一
 *   BrowserPage（专属 BrowserContext，cookies/storage/缓存会话间隔离）。
 * - 两级闲置回收（context 级 + 引擎级各 idleMs 缺省 300s）：自续 setTimeout
 *   链扫掠（unref 不阻进程退出）——context 闲置即 dispose；全 context 空
 *   且引擎闲置即协议化关停。非钩子驱动（页面态不跨进程恢复——durable 只落
 *   工具事件）。
 * - 引擎降级：spawn/运行期死 → enginePromise 清空 + 全 context 收口，下用
 *   再试（BROWSER_CONNECT_FAILED 不炸宿主）；失败路径 launchPromise 同清
 *   （启动失败不粘住）。
 * - scope.effect 回卷：作用域 dispose 即 shutdown（页面全关 + 引擎关 +
 *   工具面注销）。
 * - 云端占位：config.providers 在场即 notify「引擎恒本地」（v1 执行面零接）。
 */
import { launchBrowserEngine } from './engine.js';
import type { EngineHandle, LaunchEngineDeps } from './engine.js';
import { createBrowserPage } from './page.js';
import type { BrowserPage } from './page.js';
import { buildBrowserTools } from './tools.js';
import { BROWSER_IDLE_MS, BROWSER_SWEEP_INTERVAL_MS } from './types.js';
import type {
  BrowserConfig,
  BrowserEnvFace,
  BrowserFsFace,
  BrowserLoggerFace,
  BrowserRegisterToolsFace,
  BrowserScopeFace,
  BrowserSpawnFace,
  BrowserWebFace,
  BrowserWsFace,
} from './types.js';

/** 编排依赖（装配根注入——窄面全家） */
export interface BrowserServiceDeps {
  readonly spawn: BrowserSpawnFace;
  readonly ws: BrowserWsFace;
  readonly fs: BrowserFsFace;
  readonly readEnv: BrowserEnvFace;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly dataDir: string;
  readonly config: BrowserConfig;
  /** web 卫生单源（navigate 预检第三消费位——同一 execute 同一在飞门） */
  readonly web: BrowserWebFace;
  readonly logger?: BrowserLoggerFace;
  /** 人面通知（云端占位 boot 通知 + 引擎降级 warn） */
  readonly notify?: (message: string) => void;
  /** 工具注册面（缺席 = 纯服务形态——不挂模型工具） */
  readonly register?: BrowserRegisterToolsFace;
  /** 作用域（ctx.effect 回卷——shutdown 挂 LIFO 序） */
  readonly scope?: BrowserScopeFace;
  /** 闲置预算 ms（两级共用——缺省 BROWSER_IDLE_MS） */
  readonly idleMs?: number;
  /** 扫掠间隔 ms（缺省 BROWSER_SWEEP_INTERVAL_MS） */
  readonly sweepIntervalMs?: number;
  /** 引擎启动注入口（缺省 launchBrowserEngine——测试替身位） */
  readonly launchEngine?: (deps: LaunchEngineDeps) => Promise<EngineHandle>;
  /** 时钟注入（闲置判定可测；缺省 Date.now） */
  readonly clock?: () => number;
}

/** 编排公开面 */
export interface BrowserService {
  /** 装载动作（云端占位通知 + 工具面注册 + 扫掠链起——零 spawn） */
  apply(): void;
  /** 会话路由取页面（惰性：引擎首用起 + 页面按键建） */
  pageFor(sessionKey: string): Promise<BrowserPage>;
  /** 关停（页面全关 + 引擎协议化关停 + 扫掠停 + 工具面注销——幂等） */
  shutdown(): Promise<void>;
}

/**
 * 组 browser 编排（装载批装配根消费）。
 * 生命周期：apply 起扫掠；scope 回卷或显式 shutdown 收口。
 */
export function createBrowserService(deps: BrowserServiceDeps): BrowserService {
  const idleMs = deps.idleMs ?? BROWSER_IDLE_MS;
  const sweepIntervalMs = deps.sweepIntervalMs ?? BROWSER_SWEEP_INTERVAL_MS;
  const now = (): number => deps.clock?.() ?? Date.now();

  let enginePromise: Promise<EngineHandle> | undefined;
  /** 会话页面账（sessionKey → 页面 + 末用时刻——闲置回收判据） */
  const contexts = new Map<string, { page: BrowserPage; lastUsed: number }>();
  /** 引擎末用时刻（全 context 空时的引擎级闲置判据） */
  let engineLastUsed = 0;
  let sweepTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const unregisters: Array<() => void> = [];

  /** 惰性引擎（失败/降级即清——下用再试） */
  const ensureEngine = (): Promise<EngineHandle> => {
    if (enginePromise === undefined) {
      engineLastUsed = now();
      const launcher = deps.launchEngine ?? launchBrowserEngine;
      enginePromise = launcher({
        spawn: deps.spawn,
        ws: deps.ws,
        fs: deps.fs,
        readEnv: deps.readEnv,
        platform: deps.platform,
        homeDir: deps.homeDir,
        dataDir: deps.dataDir,
        config: deps.config,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      })
        .then((handle) => {
          // 引擎级降级双源（进程退/ws 关）：清粘滞 + 全 context 收口——
          // 页面 send 已被 cdp 件快拒，close 幂等吞错
          handle.onDown((reason) => {
            enginePromise = undefined;
            deps.notify?.(`browser：引擎已降级（${reason}）——下次使用时重试`);
            for (const entry of contexts.values()) void entry.page.close().catch(() => {});
            contexts.clear();
          });
          return handle;
        })
        .catch((err: unknown) => {
          enginePromise = undefined; // 启动失败不粘住（下用再试）
          throw err;
        });
    }
    return enginePromise;
  };

  /** 扫掠一步：context 级 → 引擎级（自续链 unref） */
  const sweep = (): void => {
    if (disposed) return;
    const t = now();
    for (const [key, entry] of contexts) {
      if (t - entry.lastUsed >= idleMs) {
        contexts.delete(key);
        void entry.page.close().catch(() => {});
        deps.logger?.debug?.(`browser 闲置回收：context ${key}（${idleMs}ms 未用）`);
      }
    }
    // 引擎级：全 context 空 + 引擎闲置 → 协议化关停（页面态不跨进程恢复）
    if (contexts.size === 0 && enginePromise !== undefined && t - engineLastUsed >= idleMs) {
      const closing = enginePromise;
      enginePromise = undefined;
      void closing.then((handle) => handle.close()).catch(() => {});
      deps.logger?.debug?.('browser 闲置回收：引擎协议化关停');
    }
    sweepTimer = setTimeout(sweep, sweepIntervalMs);
    sweepTimer.unref();
  };

  const service: BrowserService = {
    apply() {
      // 云端占位（03 §10.3：providers 在场即通知——v1 执行面零接）
      if (deps.config.providers !== undefined && deps.config.providers.length > 0) {
        deps.notify?.('browser：云端 providers 已配置——v1 未接云端执行面，引擎恒本地');
      }
      if (deps.register !== undefined) {
        for (const def of buildBrowserTools({ pageFor: (key) => service.pageFor(key) })) {
          unregisters.push(deps.register.register(def));
        }
      }
      if (deps.scope !== undefined) {
        deps.scope.effect(() => () => {
          void service.shutdown();
        });
      }
      sweepTimer = setTimeout(sweep, sweepIntervalMs);
      sweepTimer.unref();
    },

    async pageFor(sessionKey) {
      const existing = contexts.get(sessionKey);
      if (existing !== undefined) {
        existing.lastUsed = now();
        return existing.page;
      }
      engineLastUsed = now();
      const engine = await ensureEngine();
      const page = await createBrowserPage({
        conn: engine.conn,
        fs: deps.fs,
        dataDir: deps.dataDir,
        web: deps.web,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      });
      // 并发竞态：建页期间（引擎首启慢）同键可能已入账——后建让先建
      const raced = contexts.get(sessionKey);
      if (raced !== undefined) {
        void page.close().catch(() => {});
        raced.lastUsed = now();
        return raced.page;
      }
      contexts.set(sessionKey, { page, lastUsed: now() });
      return page;
    },

    async shutdown() {
      disposed = true;
      if (sweepTimer !== undefined) clearTimeout(sweepTimer);
      for (const unregister of unregisters.splice(0)) unregister();
      const entries = [...contexts.values()];
      contexts.clear();
      const closingEngine = enginePromise;
      enginePromise = undefined;
      // 全收口 best-effort（引擎死态页面 close 幂等吞错）
      await Promise.allSettled([
        ...entries.map((e) => e.page.close()),
        ...(closingEngine !== undefined ? [closingEngine.then((h) => h.close())] : []),
      ]);
    },
  };
  return service;
}
