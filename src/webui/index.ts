/**
 * webui 模块公开面（L4 core: 官方插件 15 之 #13——02 §4.1 席 25 / 03
 * §10.4 webui 件章：SSE + 微路由 + 跨入口审批 + 回环三防线）。
 *
 * 批 18a-1 服务端核心：backend（UiBackend 第四实装——claim 桥）+ 微路由
 * 五撮 + SSE 信封三族 + token 鉴权。SPA 客户端腿（React+Vite+Tailwind
 * 构建 dist/webui/ 静态面）随后批接入本面；host `--port` 接线归 host
 * 装配批（开面编舞：`--port <n>` 一次性开面 + token 一次性披露面）。
 */
import './types.js';

export {
  WEBUI_DEFAULT_PORT,
  WEBUI_DEFAULT_HOST,
  WEBUI_MAX_CONNECTIONS,
  WEBUI_BODY_LIMIT_BYTES,
  WEBUI_SSE_PING_INTERVAL_MS,
  WEBUI_SSE_WRITE_TIMEOUT_MS,
  WEBUI_COOKIE_NAME,
  WEBUI_ENDPOINTS,
} from './types.js';
export type {
  WebuiEnvelope,
  WebuiTerminalEvent,
  WebuiApprovalAskedPayload,
  WebuiSessionSummary,
  WebuiSessionState,
  WebuiSubmitInput,
  WebuiSessionsFace,
  WebuiReadFace,
  WebuiCompletionFace,
  WebuiDeps,
  WebuiListenConfig,
  WebuiServerOptions,
  WebuiHandle,
  WebuiDecideBody,
  WebuiApprovalEntry,
} from './types.js';
export {
  hostPartOf,
  isLoopbackHost,
  judgeHostHeader,
  originAllowed,
  generateToken,
  judgeListenConfig,
} from './security.js';
export { createWebuiServer } from './server.js';
