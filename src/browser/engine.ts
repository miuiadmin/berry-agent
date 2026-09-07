/**
 * 引擎生命周期件（03 §10.3——惰性首用 spawn + DevTools 侦听行发现 + CDP 建立）。
 *
 * 编舞：发现序（discoverEngine）→ spawn（`--headless=new` +
 * `--remote-debugging-port=0`〔自动分配零端口竞态〕+ `--user-data-dir` 钉数据
 * 目录不碰用户日常档）→ stderr 侦听行解析（port=0 形态下引擎在 stderr 报
 * `DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<guid>`——
 * 零端口即唯一出口）→ ws 建立（browser 级单连接）→ Browser.getVersion 握手
 * 校验。全程同罩启动预算钟。
 *
 * 失败收口：任何一步失败 = BROWSER_CONNECT_FAILED + 子进程树杀（不留孤儿）。
 * 运行期降级：ws 关闭/进程退出 → onDown 一次性收口（在途结清归 cdp 件）。
 * 协议化关停 close()：Browser.close 命令 → 宽限等自退 → kill 兜底（幂等）。
 */
import { BaseError } from '../contracts/index.js';
import { createCdpConnection } from './cdp.js';
import type { CdpConnection } from './cdp.js';
import { discoverEngine } from './discover.js';
import type { DiscoveredEngine } from './discover.js';
import {
  BROWSER_CLOSE_GRACE_MS,
  BROWSER_ENGINE_ENV_ALLOW,
  BROWSER_ENGINE_OWNER,
  BROWSER_STARTUP_TIMEOUT_MS,
  DEVTOOLS_LISTENING_RE,
} from './types.js';
import type { BrowserConfig, BrowserFsFace, BrowserLoggerFace, BrowserSpawnFace, BrowserWsFace } from './types.js';

/** 引擎句柄公开面 */
export interface EngineHandle {
  /** browser 级单连接（命令 + 事件分流路由面） */
  readonly conn: CdpConnection;
  /** 发现产物（诊断面——命中步与路径） */
  readonly discovered: DiscoveredEngine;
  /** 引擎活旗（降级后恒 false——调用方下用再试） */
  readonly alive: boolean;
  /** 降级通知（一次性：ws 关/进程退——幂等闸，迟到订阅即回调） */
  onDown(listener: (reason: string) => void): void;
  /** 协议化关停（幂等复用同结算） */
  close(): Promise<void>;
}

/** 启动依赖（装配根/服务面注入） */
export interface LaunchEngineDeps {
  readonly spawn: BrowserSpawnFace;
  readonly ws: BrowserWsFace;
  readonly fs: BrowserFsFace;
  readonly readEnv: (name: string) => string | undefined;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly dataDir: string;
  readonly config: BrowserConfig;
  readonly logger?: BrowserLoggerFace;
  /** 启动预算 ms（缺省 BROWSER_STARTUP_TIMEOUT_MS） */
  readonly startupTimeoutMs?: number;
  /** 关停宽限 ms（缺省 BROWSER_CLOSE_GRACE_MS） */
  readonly closeGraceMs?: number;
}

/**
 * 启动引擎（惰性首用的执行体——发现 → spawn → 侦听行 → ws → 握手）。
 * 任何一步失败：kill 子进程 + 抛 BROWSER_ENGINE_NOT_FOUND（发现序缺席）或
 * BROWSER_CONNECT_FAILED（载体级失败）。
 */
export async function launchBrowserEngine(deps: LaunchEngineDeps): Promise<EngineHandle> {
  const logger = deps.logger;
  const startupTimeoutMs = deps.startupTimeoutMs ?? BROWSER_STARTUP_TIMEOUT_MS;
  const closeGraceMs = deps.closeGraceMs ?? BROWSER_CLOSE_GRACE_MS;

  // 发现序（第①~④步——缺席即 BROWSER_ENGINE_NOT_FOUND 附安装指引）
  const discovered = await discoverEngine({
    fs: deps.fs,
    readEnv: deps.readEnv,
    platform: deps.platform,
    homeDir: deps.homeDir,
    dataDir: deps.dataDir,
    ...(deps.config.executablePath !== undefined ? { executablePath: deps.config.executablePath } : {}),
  });
  logger?.info?.(`browser 引擎发现命中（${discovered.source}）：${discovered.path}`);

  // profile 目录就位（--user-data-dir 钉数据目录——不碰用户日常档）
  const profileDir = `${deps.dataDir}/browser/profile`;
  await deps.fs.mkdir(profileDir, { recursive: true });

  const child = deps.spawn.spawnInteractive({
    argv: [
      discovered.path,
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    env: { allow: BROWSER_ENGINE_ENV_ALLOW },
    owner: BROWSER_ENGINE_OWNER,
  });

  // 启动竞速收口旗：先到者封（握手持/进程退/预算钟三源）
  let settled = false;

  // stderr 累积 + 侦听行扫描（port=0 的唯一出口）。失败（预算钟尽/进程先退）
  // = 树杀不留孤儿——已退场景 kill 无害，未退场景（超时腿）不杀即漏孤儿。
  let wsUrl: string;
  try {
    wsUrl = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new BaseError(
                'BROWSER_CONNECT_FAILED',
                `引擎启动超时（${startupTimeoutMs}ms）未报 DevTools 侦听行——stderr 累积：${buffer.slice(-400)}`,
              ),
            ),
          ),
        startupTimeoutMs,
      );
      child.stderr.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const match = DEVTOOLS_LISTENING_RE.exec(buffer);
        if (match !== null) {
          const url = match[1] ?? '';
          finish(() => resolve(url));
        }
      });
      child.onExit((info) =>
        finish(() =>
          reject(
            new BaseError(
              'BROWSER_CONNECT_FAILED',
              `引擎进程在 DevTools 侦听行产出前退出（${info.spawnError !== undefined ? `spawn 失败：${info.spawnError.message}` : `exit ${String(info.code)}`}）——路径：${discovered.path}`,
            ),
          ),
        ),
      );
    });
  } catch (err) {
    child.kill();
    throw err;
  }

  // ws 建立（browser 级单连接）——失败即树杀不留孤儿
  const wsConn = deps.ws.connect(wsUrl);
  try {
    await wsConn.opened;
  } catch (err) {
    child.kill();
    throw err instanceof BaseError
      ? err
      : new BaseError(
          'BROWSER_CONNECT_FAILED',
          `WebSocket 建立失败：${err instanceof Error ? err.message : String(err)}`,
        );
  }

  const conn = createCdpConnection(wsConn, { logger });
  try {
    // 握手校验（Browser.getVersion——CDP 线形活性验证）
    await conn.send('Browser.getVersion', {}, { timeoutMs: startupTimeoutMs });
  } catch (err) {
    conn.close();
    child.kill();
    throw err instanceof BaseError
      ? err
      : new BaseError(
          'BROWSER_CONNECT_FAILED',
          `CDP 握手（Browser.getVersion）失败：${err instanceof Error ? err.message : String(err)}`,
        );
  }

  // 运行期降级双源：进程退出 / ws 关闭（后者 cdp 件内已收口）——任一先到，
  // 引擎侧标死 + onDown 一次性送达。进程退也兜底关 ws（幂等）。
  let downGate = false;
  let downReason = '';
  const downListeners = new Set<(reason: string) => void>();
  const markDown = (reason: string): void => {
    if (downGate) return;
    downGate = true;
    downReason = reason;
    conn.close(); // 在途结清 + 后续快拒（幂等）
    for (const listener of downListeners) listener(reason);
  };
  conn.onDown((reason) => markDown(`连接关闭：${reason}`));
  child.onExit((info) =>
    markDown(info.spawnError !== undefined ? `进程退出（spawn 失败）` : `进程退出（code ${String(info.code)}）`),
  );

  let closeGate = false;
  const handle: EngineHandle = {
    conn,
    discovered,
    get alive() {
      return !downGate;
    },
    onDown(listener) {
      if (downGate) {
        listener(downReason);
        return;
      }
      downListeners.add(listener);
    },
    close() {
      if (closeGate) return Promise.resolve();
      closeGate = true;
      return (async () => {
        // 告别命令先行（markDown 会结清在途并关 ws——顺序不可倒）；坏引擎
        // 不响应即超时落宽限腿，不悬挂
        if (!downGate) {
          try {
            await conn.send('Browser.close', {}, { timeoutMs: closeGraceMs });
          } catch {
            /* 协议告别失败走宽限兜底 */
          }
        }
        markDown('协议化关停');
        // 宽限等自退 → kill 兜底（不因坏引擎悬挂）
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill();
            resolve();
          }, closeGraceMs);
          child.onExit(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      })();
    },
  };
  return handle;
}
