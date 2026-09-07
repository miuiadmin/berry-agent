/**
 * browser 模块公开面（L3 core: 官方插件 15 之 #7——02 §4.1 席 19 / 03 §10.3
 * browser 桥件章：CDP 手写最小桥 + 引擎发现序 + 工具面十件）。
 *
 * 批 17b-2 传输层腿：错误码族 + 配置归一 + 引擎发现序 + CDP 连接 + 引擎生命
 * 周期。工具面/上下文编排（17b-3）与 /browser install 下载件（17b-4）随后
 * 批接入本面。
 */
import './codes.js';

export {
  BROWSER_STARTUP_TIMEOUT_MS,
  BROWSER_CDP_COMMAND_TIMEOUT_MS,
  BROWSER_IDLE_MS,
  BROWSER_SWEEP_INTERVAL_MS,
  BROWSER_CLOSE_GRACE_MS,
  BROWSER_ENGINE_OWNER,
  BROWSER_ENGINE_ENV_ALLOW,
  normalizeBrowserConfig,
} from './types.js';
export type {
  BrowserConfig,
  BrowserChildFace,
  BrowserSpawnFace,
  BrowserWsConnection,
  BrowserWsFace,
  BrowserFsFace,
  BrowserRegisterToolsFace,
  BrowserScopeFace,
  BrowserLoggerFace,
  BrowserEnvFace,
  BrowserWebFace,
} from './types.js';
export { wellKnownPaths, discoverEngine } from './discover.js';
export type { DiscoveredEngine, DiscoverEngineDeps } from './discover.js';
export { createCdpConnection, defaultWsFace, CdpCommandError } from './cdp.js';
export type { CdpEvent, CdpConnection, CdpConnectionDeps } from './cdp.js';
export { launchBrowserEngine } from './engine.js';
export type { EngineHandle, LaunchEngineDeps } from './engine.js';
