/**
 * browser 模块公开面（L3 core: 官方插件 15 之 #7——02 §4.1 席 19 / 03 §10.3
 * browser 桥件章：CDP 手写最小桥 + 引擎发现序 + 工具面十件）。
 *
 * 批 17b-3 工具面+编排腿：页面上下文 + 工具面十件 + 编排（惰性引擎/会话
 * 路由/两级闲置回收）。/browser install 下载件（17b-4）随后批接入本面。
 */
import './codes.js';

export {
  BROWSER_STARTUP_TIMEOUT_MS,
  BROWSER_CDP_COMMAND_TIMEOUT_MS,
  BROWSER_IDLE_MS,
  BROWSER_SWEEP_INTERVAL_MS,
  BROWSER_CLOSE_GRACE_MS,
  BROWSER_NAV_TIMEOUT_MS,
  BROWSER_CONSOLE_RING_CAP,
  BROWSER_SCREENSHOT_KEEP,
  BROWSER_SCREENSHOT_DIRNAME,
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
export { createBrowserPage } from './page.js';
export type { BrowserPage, BrowserPageDeps, BrowserConsoleEntry } from './page.js';
export { buildBrowserTools } from './tools.js';
export type { BrowserToolPageSource } from './tools.js';
export { createBrowserService } from './service.js';
export type { BrowserService, BrowserServiceDeps } from './service.js';
