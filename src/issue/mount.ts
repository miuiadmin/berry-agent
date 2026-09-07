/**
 * issue webhook 挂点（03 §10.7 触发面②——sdk HTTP 面路由扩展位第二消费方；
 * 批 18a-4'）。
 *
 * 零自持监听：POST 端点注册于注入的挂载窄面 `IssueWebhookMountFace`（结构
 * 兼容 sdk 面注册器——词面独立律零 sdk import，host 装配根直传面级 handle
 * 即结构兼容，mount.test 全环互证）。鉴权档 `'self'`——跳面 token 闸、
 * 验签件侧执法（Host/Origin 防线仍面级先行——'self' 只跳 token 闸）。
 * loopbackOnly 不设：webhook 系入站外部投递面（`/webhooks/*` 族——三路由
 * 族中唯一须挂非回环监听器的族）。
 *
 * 空 secret = 面未开启守卫：空密钥 HMAC 确定性可伪造，禁值守卫（与
 * service.handleWebhook 两面同律——03 §10.7 批 18a-4' 落码定形注）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { BaseError } from '../contracts/index.js';
import { ISSUE_WEBHOOK_BODY_LIMIT_BYTES, ISSUE_WEBHOOK_ENDPOINT } from './types.js';
import { handleWebhookRequest, type IssueWebhookDeps } from './webhook.js';

/** webhook 事件名头（GitHub 官方词面 X-GitHub-Event——node 头表恒小写读位） */
export const WEBHOOK_EVENT_HEADER = 'x-github-event';

/** 验签头（GitHub 官方词面 X-Hub-Signature-256——03 §10.7 批 18a-4' 勘正后单源） */
export const WEBHOOK_SIGNATURE_HEADER = 'x-hub-signature-256';

/* ---------------- 挂载窄面族（词面独立律零 sdk import——结构兼容 sdk 面注册器） ---------------- */

/** 读请求体结果（面级排空纪律内含——超帽 ok:false 在体收完后才返回） */
export type IssueWebhookBodyResult =
  { readonly ok: true; readonly body: string } | { readonly ok: false; readonly status: 413; readonly message: string };

/** handler 上下文（面级 helper 的件侧视界——webhook 只用 readBody 一位） */
export interface IssueWebhookRouteContext {
  readBody(req: IncomingMessage): Promise<IssueWebhookBodyResult>;
}

/** 扩展路由 handler（件侧窄形——三参定形同面级） */
export type IssueWebhookRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: IssueWebhookRouteContext,
) => void | Promise<void>;

/** 路由描述符（件侧窄形：POST 单方法 + 'self' 单档；结构可赋面级描述符——host 直传注册器位） */
export interface IssueWebhookRouteDescriptor {
  /** HTTP 方法（webhook 恒 POST） */
  readonly method: 'POST';
  /** 端点路径（缺省 ISSUE_WEBHOOK_ENDPOINT） */
  readonly path: string;
  /** 鉴权档（恒 'self'——跳面 token 闸、验签件侧执法） */
  readonly auth: 'self';
  /** 缺省不设（非回环监听器也挂载——入站外部投递面；与 webui 全族恒回环分立） */
  readonly loopbackOnly?: false;
  /** per-route 请求体帽（缺省 ISSUE_WEBHOOK_BODY_LIMIT_BYTES） */
  readonly bodyLimitBytes?: number;
  readonly handler: IssueWebhookRouteHandler;
}

/** 挂载窄面（与 IssueWebhookDeps 分名——后者系件内处理依赖面非挂载面；SdkHttpFaceHandle 结构可赋本面） */
export interface IssueWebhookMountFace {
  register(descriptor: IssueWebhookRouteDescriptor): () => void;
}

/** 挂载选项（端点路径与体帽的测试注入位） */
export interface IssueWebhookMountOptions {
  /** 端点路径（缺省 `/webhooks/issue`） */
  readonly path?: string;
  /** 请求体帽（缺省 256KiB） */
  readonly bodyLimitBytes?: number;
}

/** 挂载产物 */
export interface IssueWebhookMount {
  /** 端点摘除（幂等——摘除后 404 同未注册） */
  dispose(): void;
}

/** JSON 应答速记（webhook 回执/拒收形——面级无共享 sendJson 故件内自持） */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/** 单值头读取（node 头表恒小写；数组形取首——GitHub 恒单值） */
function headerOf(req: IncomingMessage, name: string): string {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}

/**
 * 注册 issue webhook 端点（03 §10.7 ②——路由扩展位第二消费方）。
 *
 * 验签与拒收语义件侧执法：receipt 族 200 / `ISSUE_WEBHOOK_INVALID` 400 /
 * 未预期异常上抛面级 catch 500（GitHub 侧按 5xx 重试）。
 */
export function mountIssueWebhook(
  deps: IssueWebhookDeps,
  face: IssueWebhookMountFace,
  options: IssueWebhookMountOptions = {},
): IssueWebhookMount {
  let detacher: (() => void) | undefined = face.register({
    method: 'POST',
    path: options.path ?? ISSUE_WEBHOOK_ENDPOINT,
    auth: 'self',
    // loopbackOnly 不设（有意）——入站投递面须挂非回环监听器
    bodyLimitBytes: options.bodyLimitBytes ?? ISSUE_WEBHOOK_BODY_LIMIT_BYTES,
    handler: async (req, res, ctx) => {
      // 空 secret = 面未开启（空密钥 HMAC 确定性可伪造——禁值守卫先于读体）
      if (deps.secret === '') {
        sendJson(res, 400, {
          error: 'ISSUE_WEBHOOK_INVALID',
          message: '[ISSUE_WEBHOOK_INVALID] webhook 面未开启（缺 secret 配置）',
        });
        return;
      }
      const body = await ctx.readBody(req);
      if (!body.ok) {
        sendJson(res, body.status, { error: 'body_too_large', message: body.message });
        return;
      }
      try {
        const receipt = await handleWebhookRequest(deps, {
          event: headerOf(req, WEBHOOK_EVENT_HEADER),
          signatureHeader: headerOf(req, WEBHOOK_SIGNATURE_HEADER),
          rawBody: body.body,
        });
        sendJson(res, 200, receipt);
      } catch (err) {
        // 响亮拒（运维可见）——坏签/坏载荷 400；未预期异常上抛（面级 catch → 500）
        if (err instanceof BaseError && err.code === 'ISSUE_WEBHOOK_INVALID') {
          sendJson(res, 400, { error: err.code, message: err.message });
          return;
        }
        throw err;
      }
    },
  });
  return {
    dispose() {
      detacher?.();
      detacher = undefined;
    },
  };
}
