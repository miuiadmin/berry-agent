/**
 * issue webhook 腿（03 §10.7 触发面——可开启面）。
 *
 * 验签：X-Signature-256 头 = `sha256=` + HMAC-SHA256(secret, 原始 body)——
 * timingSafeEqual 常时比对（防时序侧信道）；缺头/坏头/签名不符一律
 * ISSUE_WEBHOOK_INVALID 响亮拒（不静默吞——运维可见）。
 *
 * 载荷路由（GitHub webhook 事件面子集）：
 * - `issues`（opened/labeled/assigned/reopened）→ 归一 IssueRef → 域匹配
 *   （issueMatchesFilter）→ enqueue；域外静默记 ignored（他仓事件正常流）；
 * - `issue_comment` → v1 留位（03 §10.7 裁决⑧：评论不触发——防评论风暴
 *   自激；receipt 'comment-ignored' 可见）；
 * - `pull_request` → ignore（PR 域不属本件触发面）;
 * - 其余事件 → ignored。
 *
 * 不可信外部文本纪律同 github.ts：载荷字段进上下文前经调用方帽。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BaseError } from '../contracts/index.js';
import type { IssueConfig, IssueEnqueueResult, IssueRef } from './types.js';
import { issueMatchesFilter } from './filter.js';

/** 计算 X-Signature-256 期望值（`sha256=` + hex——与 GitHub 官方算法一致） */
export function computeSignature(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** 常时签名比对（等长前提 + timingSafeEqual；长度不等直接 false） */
export function signatureMatches(secret: string, rawBody: string, header: string): boolean {
  const expected = computeSignature(secret, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** webhook 载荷判别联合（parseWebhookPayload 产物） */
export type WebhookPayload =
  | { readonly kind: 'issues'; readonly action: string; readonly issue: IssueRef }
  | { readonly kind: 'issue_comment'; readonly action: string; readonly repo: string; readonly number: number }
  | { readonly kind: 'pull_request'; readonly action: string }
  | { readonly kind: 'ignored'; readonly event: string };

/** GitHub webhook issues 事件载荷形（消费字段子集） */
interface WhIssuesPayload {
  action?: unknown;
  issue?: {
    number?: unknown;
    title?: unknown;
    body?: unknown;
    labels?: { name?: unknown }[];
    assignees?: { login?: unknown }[];
    state?: unknown;
    updated_at?: unknown;
    html_url?: unknown;
  };
  repository?: { full_name?: unknown };
}

/** GitHub webhook issue_comment 事件载荷形 */
interface WhCommentPayload {
  action?: unknown;
  issue?: { number?: unknown };
  repository?: { full_name?: unknown };
}

/**
 * 解析载荷（事件名 + JSON 体 → 判别联合）。坏形（JSON 坏/域字段缺/类型错）
 * 折 ISSUE_WEBHOOK_INVALID——外部输入不信任、但拒绝可观测。
 */
export function parseWebhookPayload(event: string, rawBody: string): WebhookPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new BaseError('ISSUE_WEBHOOK_INVALID', '[ISSUE_WEBHOOK_INVALID] webhook 载荷非合法 JSON');
  }
  const obj = parsed as Record<string, unknown> | null;
  if (obj === null || typeof obj !== 'object') {
    throw new BaseError('ISSUE_WEBHOOK_INVALID', '[ISSUE_WEBHOOK_INVALID] webhook 载荷须 JSON 对象形');
  }

  if (event === 'issues') {
    const p = obj as unknown as WhIssuesPayload;
    const repo = p.repository?.full_name;
    const i = p.issue;
    if (typeof repo !== 'string' || i === null || typeof i !== 'object') {
      throw new BaseError('ISSUE_WEBHOOK_INVALID', '[ISSUE_WEBHOOK_INVALID] issues 事件缺 repository/issue 域');
    }
    if (typeof i.number !== 'number' || typeof i.title !== 'string' || typeof i.updated_at !== 'string') {
      throw new BaseError(
        'ISSUE_WEBHOOK_INVALID',
        '[ISSUE_WEBHOOK_INVALID] issue 域字段坏形（number/title/updated_at）',
      );
    }
    const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      kind: 'issues',
      action: asString(p.action),
      issue: {
        repo,
        number: i.number,
        title: i.title,
        body: typeof i.body === 'string' ? i.body : '',
        labels: (i.labels ?? []).map((l) => asString(l?.name)).filter((n) => n !== ''),
        assignees: (i.assignees ?? []).map((a) => asString(a?.login)).filter((n) => n !== ''),
        state: i.state === 'closed' ? 'closed' : 'open',
        updatedAt: i.updated_at,
        htmlUrl: asString(i.html_url),
      },
    };
  }

  if (event === 'issue_comment') {
    const p = obj as unknown as WhCommentPayload;
    const repo = p.repository?.full_name;
    const number = p.issue?.number;
    if (typeof repo !== 'string' || typeof number !== 'number') {
      throw new BaseError('ISSUE_WEBHOOK_INVALID', '[ISSUE_WEBHOOK_INVALID] issue_comment 事件缺 repository/issue 域');
    }
    return { kind: 'issue_comment', action: typeof p.action === 'string' ? p.action : '', repo, number };
  }

  if (event === 'pull_request') {
    return {
      kind: 'pull_request',
      action: typeof (obj as { action?: unknown }).action === 'string' ? (obj as { action: string }).action : '',
    };
  }

  return { kind: 'ignored', event };
}

/** issues 事件触发动词集（opened/labeled/assigned/reopened——edited/closed/deleted 等不触发） */
const TRIGGERING_ACTIONS = new Set(['opened', 'labeled', 'assigned', 'reopened']);

/** 单次 webhook 处理回执（可见面——装配层 200/400 响应与日志源） */
export type WebhookReceipt =
  | { readonly receipt: 'enqueued'; readonly key: string }
  | { readonly receipt: 'duplicate'; readonly key: string }
  | { readonly receipt: 'rejected'; readonly reason: string }
  | { readonly receipt: 'out-of-scope' }
  | { readonly receipt: 'comment-ignored'; readonly repo: string; readonly number: number }
  | { readonly receipt: 'ignored'; readonly event: string };

/** webhook 处理依赖（service 组装注入） */
export interface IssueWebhookDeps {
  readonly secret: string;
  readonly config: IssueConfig;
  readonly enqueue: (issue: IssueRef) => IssueEnqueueResult | Promise<IssueEnqueueResult>;
}

/**
 * 处理单次 webhook 请求（验签 → 解析 → 路由 → enqueue 裁决）。
 * 验签失败/载荷坏形抛 BaseError（ISSUE_WEBHOOK_INVALID——装配层折 400）；
 * 域外/非触发动作 receipt 可见不抛（他仓事件是正常流非错误）。
 */
export async function handleWebhookRequest(
  deps: IssueWebhookDeps,
  req: { event: string; signatureHeader: string; rawBody: string },
): Promise<WebhookReceipt> {
  // 验签先行（未过验不解析——坏载荷信息不外泄）
  if (!req.signatureHeader || !signatureMatches(deps.secret, req.rawBody, req.signatureHeader)) {
    throw new BaseError(
      'ISSUE_WEBHOOK_INVALID',
      '[ISSUE_WEBHOOK_INVALID] webhook 签名不符（X-Signature-256 缺失或错值——检查 secret 配置）',
    );
  }
  const payload = parseWebhookPayload(req.event, req.rawBody);

  if (payload.kind === 'issues') {
    if (!TRIGGERING_ACTIONS.has(payload.action)) return { receipt: 'out-of-scope' };
    if (!issueMatchesFilter(payload.issue, deps.config)) return { receipt: 'out-of-scope' };
    const result = await deps.enqueue(payload.issue);
    if (result.status === 'started')
      return { receipt: 'enqueued', key: `${payload.issue.repo}#${payload.issue.number}` };
    if (result.status === 'duplicate') return { receipt: 'duplicate', key: result.key };
    return { receipt: 'rejected', reason: result.reason };
  }
  if (payload.kind === 'issue_comment') {
    // v1 留位（裁决⑧）：评论不触发——receipt 可见便于日志判读
    return { receipt: 'comment-ignored', repo: payload.repo, number: payload.number };
  }
  if (payload.kind === 'pull_request') return { receipt: 'ignored', event: 'pull_request' };
  return { receipt: 'ignored', event: payload.event };
}
