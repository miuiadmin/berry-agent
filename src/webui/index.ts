/**
 * webui 模块公开面（L4 core: 官方插件 15 之 #13——02 §4.1 席 25 / 03
 * §10.4 webui 件章 + 批 18a-2' 改形注记：SSE + 微路由 + 跨入口审批，
 * 承载位改注册 sdk 路由扩展位——零自持监听）。
 *
 * 批 18a-1 服务端核心 → 18a-2' 改形：backend（UiBackend 第四实装——claim
 * 桥）+ 微路由五撮 + SSE 信封三族全维持，防线/token/体帽/SSE 基建归面级
 * 单源；本面出 mountWebui（路由族注册形）。SPA 客户端腿（dist/webui/
 * 静态面）已落（6881b38）；host `--port` 归一已落（18a-3' 三入口咬合——
 * TUI/serve/daemon 共用统一 HTTP 面端口）。
 */
import './types.js';

export {
  WEBUI_DEFAULT_PORT,
  WEBUI_DEFAULT_HOST,
  WEBUI_MAX_CONNECTIONS,
  WEBUI_BODY_LIMIT_BYTES,
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
  WebuiRouteAuth,
  WebuiRouteSseStream,
  WebuiRouteSseOptions,
  WebuiRouteBodyResult,
  WebuiRouteContext,
  WebuiRouteHandler,
  WebuiRouteDescriptor,
  WebuiRouteRegistrar,
  WebuiMountDeps,
  WebuiMountOptions,
  WebuiMountHandle,
  WebuiDecideBody,
  WebuiApprovalEntry,
} from './types.js';
export { mountWebui } from './server.js';
