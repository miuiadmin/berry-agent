/**
 * issue 件公开面（03 §10.7——core:issue 无人值守编排件；批 16）。
 *
 * 单向 DAG：issue → contracts + context（02 §4.1 #27 席）。兄弟件
 * （scheduler/subagent/goal/tools/exec/checkpoint/persist）零 import——
 * 全部经窄面注入（types.ts 词面独立律注）。错误码注册（codes.ts）随本面
 * 引入生效——与 llm/session/persist/tools 的 codes.ts 同款纪律。
 */
import './codes.js';

export {
  ISSUE_POLL_JOB_NAME,
  ISSUE_DEFAULT_SCHEDULE,
  ISSUE_PARALLEL_LIMIT_DEFAULT,
  ISSUE_PER_ISSUE_MESSAGES_DEFAULT,
  ISSUE_RECEIPT_PATCH_CHARS,
  ISSUE_CONTEXT_CAP_BYTES,
  ISSUE_WEBHOOK_ENDPOINT,
  ISSUE_WEBHOOK_BODY_LIMIT_BYTES,
  ISSUE_GITHUB_TOKEN_NAME,
  ISSUE_WEBHOOK_SECRET_NAME,
  ISSUE_WORKTREE_NAME_RE,
  issueDedupeKey,
} from './types.js';
export type {
  IssueMode,
  IssueConfig,
  IssueRef,
  IssueCommentRef,
  IssueJobsFace,
  IssueSchedulerFace,
  IssueStoreStateFace,
  IssueWorktreeFace,
  IssueBudgetFace,
  IssueSessionFace,
  IssueSessionStartResult,
  IssueRunOutcome,
  IssueEnqueueResult,
} from './types.js';
export { createGithubBackend, assertRepoValid } from './github.js';
export type { GithubBackend, GithubBackendOptions } from './github.js';
export { normalizeIssueConfig, issueMatchesFilter, repoMatchesGlob, exactRepos } from './filter.js';
export { createIssuePoller, watermarkKey } from './poll.js';
export type { PollReport, IssuePollerDeps } from './poll.js';
export { computeSignature, signatureMatches, parseWebhookPayload, handleWebhookRequest } from './webhook.js';
export type { WebhookPayload, WebhookReceipt, IssueWebhookDeps } from './webhook.js';
export { mountIssueWebhook, WEBHOOK_EVENT_HEADER, WEBHOOK_SIGNATURE_HEADER } from './mount.js';
export type {
  IssueWebhookMountFace,
  IssueWebhookMountOptions,
  IssueWebhookMount,
  IssueWebhookRouteDescriptor,
  IssueWebhookRouteContext,
  IssueWebhookRouteHandler,
  IssueWebhookBodyResult,
} from './mount.js';
export { createIssueTools } from './tools.js';
export type { IssueToolsDeps } from './tools.js';
export { createIssueService } from './service.js';
export type { IssueService, IssueServiceDeps, OrphanWorktree } from './service.js';
