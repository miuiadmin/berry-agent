/**
 * issue 服务面（03 §10.7 全条款的编排核心——无人值守 issue→PR 件）。
 *
 * 入队纪律（enqueue 同步裁决、running 判定到 register 零 await——双触发
 * 源竞速安全）：
 * capabilities 预检（goal/exec/checkpoint 三名缺席任一拒）→ closed 弃 →
 * dedupeKey 在飞互斥（running() 扫）→ 全局日池判（canAffordIssue）→
 * jobs.register（kind 'issue'、name=dedupeKey、owner=合成键——会话未起，
 * 见 types.ts owner 注记）→ fire runOne（不 await）。
 *
 * runOne 编舞（单 issue 全程）：
 * worktree 名候选让位（issue-N → -r2..-r9，分支留史撞名域）→ create →
 * startHeadless（cwd=worktree、prompt=buildIssuePrompt、预算帽、issue_get）→
 * grant（拿到 sessionId 才能授予——create 时会话不存在的补授位）→ await
 * outcome → 交付映射（04 §10 issue 消费注）：
 * - draft+completed → 评论贴分支+补丁（60k 帽）→ settle completed；
 * - auto+completed → 评论说明 + settle failed「需人审：不可逆外部写闸缺席」
 *   （03 §10.7 交付条——危险闸缺席一律阻塞转人审，v1 push/PR 面未落）；
 * - failed → 评论贴原因 → settle failed；
 * - needs-human → 评论转人审 → settle failed（需人审）；
 * - paused → **不 settle 不 clean 不释授予**——worktree/授予/在飞记账全
 *   保留（budget_extended 唤醒接线随装配批挂账）。
 * 收尾（非 paused）：worktree clean（dirty 保留不强拆——变更可能正是交付
 * 物）、releaseSession。评论投递失败不阻塞 settle 的反面——settle 恒在评论
 * 后落（人可见面优先；网络挂死场景 fetch 层兜底）。
 */
import { BaseError } from '../contracts/index.js';
import type { GithubBackend } from './github.js';
import { createIssueTools } from './tools.js';
import { createIssuePoller, type PollReport } from './poll.js';
import { handleWebhookRequest, type WebhookReceipt } from './webhook.js';
import type {
  IssueBudgetFace,
  IssueConfig,
  IssueEnqueueResult,
  IssueJobsFace,
  IssueRef,
  IssueSchedulerFace,
  IssueSessionFace,
  IssueStoreStateFace,
  IssueWorktreeFace,
} from './types.js';
import { ISSUE_POLL_JOB_NAME, ISSUE_RECEIPT_PATCH_CHARS, ISSUE_WORKTREE_NAME_RE, issueDedupeKey } from './types.js';

/** capabilities 预检名单（03 §10.7 ③入队定值——三名缺席任一拒） */
const REQUIRED_CAPABILITIES: readonly string[] = ['goal', 'exec', 'checkpoint'];

/** builtin 轮询行的 prompt 占位（RunnerFactory 对该行名程序化分派 pollOnce 零 token——行 prompt 不入模型面） */
const POLL_PROMPT_PLACEHOLDER =
  '(builtin) issue 轮询占位——挂钟行由 issue 件程序化分派（pollOnce），本 prompt 不发往任何模型';

/** 服务装配依赖（全窄面注入——词面独立律） */
export interface IssueServiceDeps {
  readonly config: IssueConfig;
  readonly backend: GithubBackend;
  readonly jobs: IssueJobsFace;
  readonly scheduler: IssueSchedulerFace;
  readonly state: IssueStoreStateFace;
  readonly worktree: IssueWorktreeFace;
  readonly session: IssueSessionFace;
  readonly budget: IssueBudgetFace;
  /** 在场能力名清单（装配根注入——capabilities 预检源） */
  readonly capabilities: readonly string[];
  /** webhook secret（缺席 = webhook 面关闭——handleWebhook 响亮拒） */
  readonly webhookSecret?: string;
  /** warn 日志面（缺省 no-op——测试静默） */
  readonly warn?: (message: string) => void;
}

/** 孤儿 worktree 标注项（orphanScan 产物——只标注不自动清，03 §10.7 隔离条销账#3） */
export interface OrphanWorktree {
  readonly name: string;
  readonly path: string;
}

/** issue 服务公开面（start/stop 生命周期 + 三触发口 + 孤儿扫描） */
export interface IssueService {
  /** 启用：登记 kind + 挂轮询钟（幂等——行已在则 warn 不炸装配） */
  start(): void;
  /** 停用：摘钟（在飞 run 不打断——终态自落） */
  stop(): void;
  /** 单轮轮询（挂钟行触达面——委托 poller） */
  pollOnce(): Promise<PollReport>;
  /** webhook 处理（验签→路由→enqueue——secret 缺席响亮拒） */
  handleWebhook(req: { event: string; signatureHeader: string; rawBody: string }): Promise<WebhookReceipt>;
  /** 孤儿扫描（名形匹配减在飞——标注面，清理归人审/装配侧） */
  orphanScan(): Promise<readonly OrphanWorktree[]>;
}

/** 组 issue 服务 */
export function createIssueService(deps: IssueServiceDeps): IssueService {
  const warn = deps.warn ?? (() => undefined);
  // 在飞记账（dedupeKey → worktree 名——orphanScan 的在飞减集；paused 停靠保留）
  const inflight = new Map<string, string>();

  /** worktree 名候选序列（issue-N 首选；分支留史撞名让位 -r2..-r9——九连撞即弃转人审） */
  function* worktreeNameCandidates(number: number): Generator<string> {
    yield `issue-${number}`;
    for (let r = 2; r <= 9; r++) yield `issue-${number}-r${r}`;
  }

  /** 组单 issue 的 headless 首跑 prompt（交付纪律内嵌：禁 push/PR/评论、预算可见、issue_get 指引） */
  function buildIssuePrompt(issue: IssueRef, branch: string): string {
    return [
      `处理 GitHub issue ${issue.repo}#${issue.number}：「${issue.title}」。`,
      '',
      '- 先用 issue_get 工具读 issue 正文与全部评论（本会话已绑定该 issue，无需参数）。',
      `- 当前目录是为本次任务建的独立 git worktree（分支 ${branch}）——所有改动在此分支上做并本地提交。`,
      '- 严禁 push、严禁创建 PR、严禁对 issue 发评论（交付由编排层收口——越界动作将被拒）。',
      `- 消息预算上限 ${deps.config.perIssueBudgetMessages} 条——聚焦最小可用改动，相关测试跑绿即算达成。`,
      '- 目标：完成 issue 所述改动（含测试）并在本地提交。',
    ].join('\n');
  }

  /** 评论投递（失败不抛——回执后补语义，warn 记；终态必落优先于投递成功） */
  async function postReceipt(issue: IssueRef, body: string): Promise<void> {
    try {
      await deps.backend.postComment({ repo: issue.repo, number: issue.number, body });
    } catch (err) {
      warn(
        `issue 回执评论投递失败（${issue.repo}#${issue.number}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * runOne：单 issue 全程编舞（enqueue fire——不 await 调用方）。自身异常
   * 兜底 settle failed（终态必落——编舞崩溃不悬挂注册表）。
   */
  async function runOne(issue: IssueRef, key: string): Promise<void> {
    const handle = deps.jobs.register({ kind: 'issue', name: key, owner: `issue-job:${key}` });
    let created: { readonly name: string; readonly path: string; readonly branch: string } | undefined;
    let sessionId: string | undefined;
    let retain = false; // paused 停靠：授予/worktree/在飞记账全保留（唤醒接线随装配批）
    try {
      // ── 隔离：worktree 名候选让位（撞名 = 前次重跑残留——分支留史的代价面） ──
      let lastExists: unknown;
      for (const name of worktreeNameCandidates(issue.number)) {
        try {
          created = await deps.worktree.create({ name });
          break;
        } catch (err) {
          if (err instanceof BaseError && err.code === 'FS_WORKTREE_EXISTS') {
            lastExists = err;
            continue;
          }
          throw err;
        }
      }
      if (created === undefined) {
        throw lastExists instanceof Error
          ? lastExists
          : new Error(`worktree 名候选 9 连撞（issue-${issue.number}——需人清残留分支）`);
      }
      inflight.set(key, created.name);

      // ── 起跑：headless 会话（cwd=worktree、预算帽、issue_get 绑定面） ──
      const started = await deps.session.startHeadless({
        cwd: created.path,
        prompt: buildIssuePrompt(issue, created.branch),
        budgetMessages: deps.config.perIssueBudgetMessages,
        tools: createIssueTools({ backend: deps.backend, repo: issue.repo, number: issue.number }),
      });
      sessionId = started.sessionId;
      // 拿到 sessionId 才能授予（create 时会话不存在的补授位——04 §7 补钉①编排路径）
      await deps.worktree.grant({ sessionId: started.sessionId, path: created.path });

      const outcome = await started.outcome;

      // ── 交付映射（04 §10 issue 消费注·终态三因） ──
      if (outcome.status === 'paused') {
        retain = true;
        warn(
          `issue run 停靠（${key}）：全局预算日池尽——worktree ${created.name} 与授予保留，待 budget_extended 唤醒（装配批挂账）`,
        );
        return;
      }
      if (outcome.status === 'completed') {
        if (deps.config.mode === 'draft') {
          // draft 档：评论贴分支 + 补丁（60k 字符帽——GitHub 评论体上限内留余量）
          let patch = '';
          try {
            patch = await deps.worktree.diffPatch({ name: created.name, baseRef: deps.config.baseBranch });
          } catch (err) {
            warn(`补丁取数失败（${key}）：${err instanceof Error ? err.message : String(err)}`);
          }
          if (patch.length > ISSUE_RECEIPT_PATCH_CHARS) {
            patch = `${patch.slice(0, ISSUE_RECEIPT_PATCH_CHARS)}\n…（补丁超 ${ISSUE_RECEIPT_PATCH_CHARS} 字符帽截断）`;
          }
          await postReceipt(
            issue,
            [
              `🤖 issue run 完成（draft 档）：分支 \`${created.branch}\`（本地——未 push）`,
              outcome.summary,
              '',
              '```diff',
              patch || '（无补丁——无改动或取数失败）',
              '```',
            ].join('\n'),
          );
          handle.settle({
            status: 'completed',
            detail: `draft：分支 ${created.branch}（${outcome.messagesUsed} 条消息）`,
          });
        } else {
          // auto 档：危险闸缺席——一律阻塞转人审（03 §10.7 交付条；v1 push/PR 面未落）
          await postReceipt(
            issue,
            [
              `🤖 issue run 完成（auto 档）但不可逆外部写闸缺席——阻塞转人审：分支 \`${created.branch}\` 已就绪（本地未 push），请人工确认后交付。`,
              outcome.summary,
            ].join('\n'),
          );
          handle.settle({ status: 'failed', detail: '需人审：不可逆外部写闸缺席（auto 档成果已备，push/PR 需人工）' });
        }
      } else if (outcome.status === 'failed') {
        await postReceipt(issue, `🤖 issue run 失败：${outcome.reason}（分支 \`${created.branch}\` 留存供排查）`);
        handle.settle({ status: 'failed', detail: outcome.reason });
      } else {
        // needs-human：无应答者审批拒/写动作无 allowlist 覆盖（04 §9 fail-closed）——转人审
        await postReceipt(
          issue,
          `🤖 issue run 需人审：${outcome.reason}（分支 \`${created.branch}\` 留存——处理后可重开）`,
        );
        handle.settle({ status: 'failed', detail: `需人审：${outcome.reason}` });
      }

      // ── 收尾：拆 worktree（dirty 保留——未提交变更可能是交付物残余） ──
      try {
        await deps.worktree.clean({ name: created.name });
      } catch (err) {
        if (err instanceof BaseError && err.code === 'FS_WORKTREE_DIRTY') {
          warn(`issue worktree 未提交变更保留不拆（${created.name}）——分支 ${created.branch} 留存`);
        } else {
          warn(`issue worktree 清理失败（${created.name}）：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      // 兜底：编舞自身异常——终态必落（注册表不悬挂）
      const detail = err instanceof Error ? err.message : String(err);
      handle.settle({ status: 'failed', detail });
      warn(`issue run 编舞异常（${key}）：${detail}`);
      if (created !== undefined) {
        try {
          await deps.worktree.clean({ name: created.name });
        } catch {
          // 兜底清理失败——残留归 orphanScan 标注
        }
      }
    } finally {
      if (!retain) {
        inflight.delete(key);
        if (sessionId !== undefined) deps.worktree.releaseSession(sessionId);
      }
    }
  }

  /**
   * 入队裁决（同步、零 await 到 register——竞速窗口不存在）。预检序：
   * capabilities → closed → dedupe → budget → register → fire。
   */
  function enqueue(issue: IssueRef): IssueEnqueueResult {
    for (const cap of REQUIRED_CAPABILITIES) {
      if (!deps.capabilities.includes(cap)) {
        return { status: 'rejected', reason: `能力缺席：${cap}（issue 件依赖 goal/exec/checkpoint 三件在场）` };
      }
    }
    if (issue.state !== 'open') {
      return { status: 'rejected', reason: `issue 已 ${issue.state}（终态不再入队）` };
    }
    const key = issueDedupeKey(issue.repo, issue.number);
    if (deps.jobs.running().some((j) => j.name === key)) {
      warn(`[ISSUE_JOB_DUPLICATE] 在飞互斥撞锁：${key}（进程内——不重入）`);
      return { status: 'duplicate', key };
    }
    const afford = deps.budget.canAffordIssue();
    if (!afford.ok) {
      return { status: 'rejected', reason: afford.reason ?? '全局预算日池尽（停靠）' };
    }
    // fire（runOne 首语句 register 同步执行——enqueue 返回前已入册，紧随的
    // 二次 enqueue 在 running() 扫描即见：互斥成立）
    void runOne(issue, key);
    return { status: 'started', key };
  }

  const poller = createIssuePoller({ backend: deps.backend, state: deps.state, config: deps.config, enqueue });

  const service: IssueService = {
    start() {
      deps.jobs.registerKind('issue');
      try {
        deps.scheduler.registerPollJob({
          name: ISSUE_POLL_JOB_NAME,
          schedule: deps.config.schedule,
          prompt: POLL_PROMPT_PLACEHOLDER,
        });
      } catch (err) {
        // 幂等：行已在（重启再启）——warn 不炸装配；其余守卫拒（schedule 坏串）同样响亮可见
        warn(`issue 轮询行登记失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },

    stop() {
      deps.scheduler.removePollJob(ISSUE_POLL_JOB_NAME);
    },

    pollOnce() {
      return poller.pollOnce();
    },

    async handleWebhook(req) {
      if (deps.webhookSecret === undefined || deps.webhookSecret === '') {
        throw new BaseError('ISSUE_WEBHOOK_INVALID', '[ISSUE_WEBHOOK_INVALID] webhook 面未开启（缺 secret 配置）');
      }
      return handleWebhookRequest({ secret: deps.webhookSecret, config: deps.config, enqueue }, req);
    },

    async orphanScan() {
      // 名形匹配减在飞——只标注不自动清（销账#3：残留 worktree = 标注孤儿）
      const entries = await deps.worktree.list();
      const inflightNames = new Set(inflight.values());
      return entries
        .filter((e) => ISSUE_WORKTREE_NAME_RE.test(e.name) && !inflightNames.has(e.name))
        .map((e) => ({ name: e.name, path: e.path }));
    },
  };
  return service;
}
