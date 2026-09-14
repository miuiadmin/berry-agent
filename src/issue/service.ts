/**
 * issue 服务面（03 §10.7 全条款的编排核心——无人值守 issue→PR 件）。
 *
 * 入队纪律（enqueue 同步裁决、running 判定到 register 零 await——双触发
 * 源竞速安全）：
 * capabilities 预检（goal/exec/checkpoint 三名缺席任一拒）→ closed 弃 →
 * dedupeKey 在飞互斥（running() 扫）→ issue 并行帽预检（FX-1——帽满诚实
 * rejected 不谎报 started 不发起 runOne）→ 全局日池判（canAffordIssue）→
 * jobs.register（kind 'issue'、name=dedupeKey、owner=合成键——会话未起，
 * 见 types.ts owner 注记；受理失败在 runOne 首语句位 warn 收口不崩进程）→
 * fire runOne（不 await）。
 *
 * runOne 编舞（单 issue 全程）：
 * worktree 名候选让位（issue-N → -r2..-r9，分支留史撞名域；撞名让位分支
 * 全列举进 prompt——⑪ 裁决 2 前次分支指路）→ create → startHeadless
 * （cwd=worktree、prompt=buildIssuePrompt、预算帽、issue_get + issue_escalate）
 * → grant（拿到 sessionId 才能授予——create 时会话不存在的补授位）→ await
 * outcome → 交付序（⑪ 编排定序）：completed 先过**交付验证门**（裁决 5——
 * verifyCommand 在场即真跑执法，未过拒交付；先于危险闸 deliver：验证未过
 * 零闸决策记账不落 allow-failed 笔）→ escalation 检查（裁决 4——auto 档
 * 在场降级转人审不 push）→ 交付映射（04 §10 issue 消费注）：
 * - draft+completed → 评论贴分支+补丁（60k 帽；escalation 在场附结构化段、
 *   settle 维持 completed + detail 注记 N 条）→ settle completed；
 * - auto+completed → 危险闸交付腿（04 §13——deliver = 闸包裹的 push/PR
 *   执行）：push 分支 → 开 PR → 回执贴 PR 链接 → settle completed；闸拒
 *   （DANGER_ 族）= 评论转人审 + 指路修复动作 + settle failed 需人审；
 *   闸缺席（装配未注入 face）= 03 §10.7 原语义保持——阻塞转人审；
 * - failed → 评论贴原因 → settle failed；
 * - needs-human → 评论转人审 → settle failed（需人审）；
 * - ⑪ 遗漏修复批：failed / needs-human / verifyBlocked 一切非 completed
 *   收口，回执评论与 settle detail 均附 escalation 摘要段（03 §10.7 ⑪
 *   定形注 2026-09-14 补笔——转人审场景恰是 escalation 呈现的第一场景；
 *   无登记零呈现）。
 * - paused → **不 settle 不 clean 不释授予**——worktree/授予/在飞记账全
 *   保留（budget_extended 唤醒 watcher 已接线——issue-session 起跑时登记
 *   全部停靠 run，预算恢复自动唤醒续跑）。
 * 收尾（非 paused）：worktree clean（dirty 保留不强拆——变更可能正是交付
 * 物）、releaseSession。评论投递失败不阻塞 settle 的反面——settle 恒在评论
 * 后落（人可见面优先；网络挂死场景 fetch 层兜底）。
 */
import { BaseError, redactKnownSecretValues, redactSensitiveText } from '../contracts/index.js';
import type { GithubBackend } from './github.js';
import { createIssueTools } from './tools.js';
import { createIssuePoller, type PollReport } from './poll.js';
import { handleWebhookRequest, type WebhookReceipt } from './webhook.js';
import type {
  IssueBudgetFace,
  IssueConfig,
  IssueDangerFace,
  IssueEnqueueResult,
  IssueEscalation,
  IssueJobsFace,
  IssueRef,
  IssueSchedulerFace,
  IssueSessionFace,
  IssueStoreStateFace,
  IssueVerifyFace,
  IssueVerifyResult,
  IssueWorktreeFace,
} from './types.js';
import {
  ISSUE_POLL_JOB_NAME,
  ISSUE_PARALLEL_LIMIT_DEFAULT,
  ISSUE_RECEIPT_PATCH_CHARS,
  ISSUE_WORKTREE_NAME_RE,
  issueDedupeKey,
} from './types.js';

/** Job 受理句柄（IssueJobsFace.register 产物——settle 子面） */
type IssueJobHandle = ReturnType<IssueJobsFace['register']>;

/** capabilities 预检名单（03 §10.7 ③入队定值——三名缺席任一拒） */
const REQUIRED_CAPABILITIES: readonly string[] = ['goal', 'exec', 'checkpoint'];

/**
 * 验证判据段（证据四元组之判据/时长两段——回执评论与 settle detail 双 face
 * 单源拼装防再漂移；03 §10.7 定形注「证据四元组双面」+ types.ts
 * IssueVerifyResult.outputTail JSDoc「回执与 detail 双面证据」同源执法）。
 */
function verifyVerdict(r: IssueVerifyResult, timeoutMs: number): string {
  return r.timedOut ? `超时（>${timeoutMs}ms，${r.durationMs}ms 击杀）` : `退出码 ${r.exitCode}（${r.durationMs}ms）`;
}

/** 输出尾段（四元组之尾段——空尾诚实注明「（无输出）」非静默省略；两 face 同体直嵌）
 *
 * 出口消毒（03 §10.7 第四役补笔附段 b——issue 正文属外部不可信文本威胁模型，
 * 验证输出可回显子进程环境与 worktree 内不可信内容）：值基腿先行 + 模式腿补
 * 裸形（工具管道 pipeline 同款合流序）。只抹值不折叠——证据四元组长度与
 * 结构照旧（[REDACTED:*] 具名注记替换明文）。 */
const verifyTail = (tail: string, secrets: readonly string[]): string =>
  redactSensitiveText(redactKnownSecretValues(tail || '（无输出）', secrets));

/**
 * 危险闸拒码 → 回执指路（04 §13 消费面按码分流呈现——approve / 重签 /
 * 删 HALT / 次日或提帽重签四路）。未知码兜底呈现状态命令。
 */
const DANGER_REMEDIES: Readonly<Record<string, string>> = {
  DANGER_CONSENT_ABSENT: 'consent 缺席——TUI 运行 /danger approve 签发授权后重跑',
  DANGER_CONSENT_INVALID: 'consent 过期或配置漂移——重跑 /danger approve 重签',
  DANGER_HALTED: 'HALT 哨兵在场——删除数据目录下 HALT 文件即恢复',
  DANGER_TARGET_DENIED: '目标不在危险闸值域——检查件配置 repos 后重签 consent',
  DANGER_CAP_EXCEEDED: '当日交付帽已达——UTC 次日自动恢复，或提帽后重签 consent',
  DANGER_LEDGER_CORRUPT: '危险闸审计账本链损坏——人工检修（截断/重建是人工决策）',
};

/** 拒码指路取值（未知码兜底——不静默） */
function dangerRemedy(code: string): string {
  return DANGER_REMEDIES[code] ?? '运行 /danger status 检查危险闸状态';
}

/**
 * escalation 结构化段（⑪ 裁决 4——回执评论承载面：四字段全量、多条累积
 * 全量非末条）。收口消费双面用：draft 档随完成回执附段 / auto 档降级转人审
 * 回执主体。
 */
function escalationSection(escalations: readonly IssueEscalation[]): string {
  const blocks = escalations.map((e, i) => {
    const lines = [`**上报 ${i + 1}**：${e.question}`];
    if (e.options !== undefined && e.options.length > 0) lines.push(`- 候选：${e.options.join(' ｜ ')}`);
    if (e.recommendation !== undefined) lines.push(`- 建议：${e.recommendation}`);
    if (e.continueWithDefault !== undefined) lines.push(`- 建议缺省继续案（仅呈报不执行）：${e.continueWithDefault}`);
    return lines.join('\n');
  });
  return [`## ⚠️ 模型上报待裁决（${escalations.length} 条——run 收口转人审）`, ...blocks].join('\n\n');
}

/**
 * escalation 回执附段（⑪ 遗漏修复批——非 completed 收口三路径共用：
 * needs-human / failed / verifyBlocked）。**转人审场景恰是 escalation
 * 呈现的第一场景**（03 §10.7 ⑪ 定形注 2026-09-14 补笔）：登记表进程内随
 * Job 蒸发，回执评论是 escalation 唯一 durable 呈现面——此刻附段缺席 =
 * 待裁决问题随 Job 蒸发、人只见终态不见问题。同 draft 附段形（全量四
 * 字段结构化、多条累积非末条）；无登记零呈现不加空段。
 */
function appendEscalationReceipt(body: string, escalations: readonly IssueEscalation[]): string {
  return escalations.length > 0 ? `${body}\n\n${escalationSection(escalations)}` : body;
}

/**
 * escalation settle detail 附面（与回执同笔双面——03 §10.7 ⑪「回执评论
 * 与 Job settle detail 均附」）：「escalation 在场 N 条」注记（draft 档
 * 注记同律）+ 摘要段同形；无登记零呈现（detail 维持原串）。
 */
function appendEscalationDetail(detail: string, escalations: readonly IssueEscalation[]): string {
  if (escalations.length === 0) return detail;
  return `${detail}；escalation 在场 ${escalations.length} 条\n\n${escalationSection(escalations)}`;
}

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
  /**
   * 危险闸窄面（04 §13——auto 档交付腿；装配位组合注入）。缺席 = auto 档
   * 阻塞转人审原语义保持（memory 诊断形 dataDir null 零闸——fail-closed）。
   */
  readonly danger?: IssueDangerFace;
  /**
   * 交付验证执行窄面（⑪ 裁决 5——verifyCommand 在场时的执法真跑面）。
   * **缺席（verifyCommand 在场时）同律拒交付转人审**——IssueDangerFace 缺席
   * 先例同形（fail-closed：防「缺席 = 无门放行」）。verifyCommand 缺席时
   * 本槽闲置（门 inert）。
   */
  readonly verify?: IssueVerifyFace;
  /** webhook secret（缺席 = webhook 面关闭——handleWebhook 响亮拒） */
  readonly webhookSecret?: string;
  /**
   * 出口消毒值基腿活值 provider（03 §10.7 第四役附段 b——验证输出尾已知
   * 秘密活值整段置换源）。装配位注入件内已知凭证活值；**缺席 = 纯模式腿
   * 降级执法**（pipeline sensitiveValues 同款降级诚实——消毒是出口护栏非
   * 执法门，provider 缺席不该炸掉回执）。live 读（每次调用现取——验证
   * 期间新入库凭证同受覆盖）。
   */
  readonly sensitiveValues?: () => readonly string[];
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
  /**
   * 入队口公开位（批 19e 装载——webhook 挂点装配共享：宿主经
   * mountIssueWebhook 组 IssueWebhookDeps 时取本动词，与件内
   * handleWebhook 同一幂等面——双触发源收敛不变）
   */
  enqueue(issue: IssueRef): IssueEnqueueResult;
  /** 孤儿扫描（名形匹配减在飞——标注面，清理归人审/装配侧） */
  orphanScan(): Promise<readonly OrphanWorktree[]>;
}

/** 组 issue 服务 */
export function createIssueService(deps: IssueServiceDeps): IssueService {
  const warn = deps.warn ?? (() => undefined);
  // 出口消毒值基腿活值（附段 b——缺席 = 纯模式腿降级；live 读）
  const secretValues = deps.sensitiveValues ?? (() => [] as const);
  // 在飞记账（dedupeKey → worktree 名——orphanScan 的在飞减集；paused 停靠保留）
  const inflight = new Map<string, string>();
  // kind issue 在飞键集（FX-1 并行帽预检源——本服务是 kind issue 唯一注册方，
  // 与 registry parallelLimits 的 kind 计数同源镜像；paused 停靠保留占帽同
  // registry running 语义；跨实例漂移形〔重挂载后旧 job 仍在飞〕由 runOne
  // 受理位 try-catch 兜底——fail-safe 方向：漏计只会退到 register 拒收兜底）
  const issueRunning = new Set<string>();

  /** worktree 名候选序列（issue-N 首选；分支留史撞名让位 -r2..-r9——九连撞即弃转人审） */
  function* worktreeNameCandidates(number: number): Generator<string> {
    yield `issue-${number}`;
    for (let r = 2; r <= 9; r++) yield `issue-${number}-r${r}`;
  }

  /**
   * 组单 issue 的 headless 首跑 prompt（交付纪律内嵌 + ⑪ 两笔：撞名让位
   * 前次分支指路〔裁决 2——git 史即断点真源〕+ converge 对账纪律句〔裁决 6〕）。
   */
  function buildIssuePrompt(issue: IssueRef, branch: string, priorBranches: readonly string[]): string {
    const lines: string[] = [`处理 GitHub issue ${issue.repo}#${issue.number}：「${issue.title}」。`, ''];
    if (priorBranches.length > 0) {
      // 前次分支指路：撞名让位分支全列举（多次残留全列举——单指首撞位漏后续史）
      lines.push(
        `- 本任务此前跑过：前次分支 ${priorBranches.map((b) => `\`${b}\``).join('、')} 在场，可用 \`git log\` 查看前次进度与提交（已完成/剩余自行从提交史总结），也可从头独立解决。`,
        '',
      );
    }
    lines.push(
      '- 先用 issue_get 工具读 issue 正文与全部评论（本会话已绑定该 issue，无需参数）。',
      `- 当前目录是为本次任务建的独立 git worktree（分支 ${branch}）——所有改动在此分支上做并本地提交。`,
      '- 严禁 push、严禁创建 PR、严禁对 issue 发评论（交付由编排层收口——越界动作将被拒）；需人裁决的问题用 issue_escalate 工具上报（run 收口时随回执转人审）。',
      `- 消息预算上限 ${deps.config.perIssueBudgetMessages} 条——聚焦最小可用改动，相关测试跑绿即算达成。`,
      '- 完成前逐条对账 issue 正文与评论中的显式要求——全部覆盖，或在总结中明确说明未尽项。',
      '- 目标：完成 issue 所述改动（含测试）并在本地提交。',
    );
    return lines.join('\n');
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
   * Job 受理（FX-1——enqueue 预检与 registry 帽执法间的兜底收口位）。成功 =
   * 返 settle 句柄并记进 issueRunning 在飞键集；失败（帽满
   * JOB_LIMIT_REACHED / kind 未登记 JOB_KIND_UNKNOWN）= triggers.ts 受理
   * 先例同形 warn 不上抛 + issue 回执评论落可观测失败账（残窗形调用方已收
   * started 回执——register 先查帽后入表、表内零条目无 settle 可落，回执
   * 评论是唯一 durable 纠偏面），返 undefined。本函数至 register 零 await
   * （enqueue「同步受理」语义保持——runOne 经 await 调本函数时 register
   * 仍在 enqueue 返回前同步执行完毕）。
   */
  async function admitIssueJob(issue: IssueRef, key: string): Promise<IssueJobHandle | undefined> {
    try {
      const handle = deps.jobs.register({ kind: 'issue', name: key, owner: `issue-job:${key}` });
      issueRunning.add(key); // 在飞记账（enqueue 帽预检源——受理成功即时入集）
      return handle;
    } catch (err) {
      // 错误码入回执（BaseError 形 `[code] message`——triggers.ts 受理先例同形，可观测面带码）
      const detail = err instanceof BaseError ? `[${err.code}] ${err.message}` : String(err);
      warn(`issue run 未受理（Job 注册失败 ${key}）：${detail}`);
      await postReceipt(
        issue,
        `🤖 issue run 未受理：Job 注册失败（${detail}）——本轮未处理该 issue；其后续更新（新评论等）会再次触发入队重试。`,
      );
      return undefined;
    }
  }

  /**
   * runOne：单 issue 全程编舞（enqueue fire——不 await 调用方）。自身异常
   * 兜底 settle failed（终态必落——编舞崩溃不悬挂注册表）。Job 受理失败
   * （帽满 JOB_LIMIT_REACHED / kind 未登记 JOB_KIND_UNKNOWN）在首语句位
   * warn 收口不上抛（FX-1：register 曾裸在 try 块外，帽满同步 throw 直接
   * reject 本函数——void 吞 rejection 后经全局崩溃编舞 exit(1) 杀 daemon）。
   */
  async function runOne(issue: IssueRef, key: string): Promise<void> {
    // Job 受理先行（原首语句迁入 admitIssueJob——受理失败形零表内条目、
    // 零 worktree 零起跑，回执落账即收口返）
    const handle = await admitIssueJob(issue, key);
    if (handle === undefined) return;
    let created: { readonly name: string; readonly path: string; readonly branch: string } | undefined;
    let sessionId: string | undefined;
    let retain = false; // paused 停靠：授予/worktree/在飞记账全保留（唤醒接线随装配批）
    try {
      // ── 隔离：worktree 名候选让位（撞名 = 前次重跑残留——分支留史的代价面） ──
      // 撞名让位分支全列举进 prompt（⑪ 裁决 2——前次分支指路，git 史即断点真源）
      const priorBranches: string[] = [];
      let lastExists: unknown;
      for (const name of worktreeNameCandidates(issue.number)) {
        try {
          created = await deps.worktree.create({ name });
          break;
        } catch (err) {
          if (err instanceof BaseError && err.code === 'FS_WORKTREE_EXISTS') {
            priorBranches.push(name);
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

      // ── escalation 登记表（⑪ 裁决 4——runOne 闭包：与工具工厂同域；停靠
      //    唤醒 followUp 续跑同会话闭包跨停靠存活；进程内随 Job 蒸发——
      //    tool/call + tool/result durable 既有词天然留痕，零新 05 §3.1 事件词） ──
      const escalations: IssueEscalation[] = [];

      // ── 起跑：headless 会话（cwd=worktree、预算帽、issue_get 绑定面） ──
      const started = await deps.session.startHeadless({
        cwd: created.path,
        prompt: buildIssuePrompt(issue, created.branch, priorBranches),
        budgetMessages: deps.config.perIssueBudgetMessages,
        tools: createIssueTools({
          backend: deps.backend,
          repo: issue.repo,
          number: issue.number,
          onEscalate: (escalation) => {
            escalations.push(escalation);
          },
        }),
      });
      sessionId = started.sessionId;
      // 拿到 sessionId 才能授予（create 时会话不存在的补授位——04 §7 补钉①编排路径）
      await deps.worktree.grant({ sessionId: started.sessionId, path: created.path });

      const outcome = await started.outcome;

      // ── 交付映射（04 §10 issue 消费注·终态三因） ──
      if (outcome.status === 'paused') {
        retain = true;
        warn(
          `issue run 停靠（${key}）：全局预算日池尽——worktree ${created.name} 与授予保留，预算恢复后经 budget_extended 唤醒自动续跑`,
        );
        return;
      }
      // ── 交付验证门（⑪ 裁决 5——编排层交付前一步、先于危险闸 deliver 调用：
      //    验证未过零闸决策记账、不落 allow-failed 笔不污染账本。fail-closed
      //    三拒形：face 缺席 / 执行体异常 / 非零退出或超时——证据四元组进回执
      //    评论与 settle detail 双面） ──
      let verifyBlocked = false;
      const verifyCommand = deps.config.verifyCommand;
      if (outcome.status === 'completed' && verifyCommand !== undefined) {
        if (deps.verify === undefined) {
          // face 注入缺席同律拒交付转人审（IssueDangerFace 缺席先例同形——防「缺席=无门放行」）
          await postReceipt(
            issue,
            appendEscalationReceipt(
              [
                `🤖 issue run 不可交付（验证门缺席）：verifyCommand 已配置（\`${verifyCommand}\`）但验证执行面未注入——阻塞转人审：分支 \`${created.branch}\` 已就绪（本地未 push），请人工验证后交付。`,
                outcome.summary,
              ].join('\n'),
              escalations,
            ),
          );
          handle.settle({
            status: 'failed',
            detail: appendEscalationDetail(
              '需人审：验证执行面缺席（verifyCommand 在场而 IssueVerifyFace 未注入）',
              escalations,
            ),
          });
          verifyBlocked = true;
        } else {
          // 执行体围挂钟起点（异常分支时长源——face 异常上抛无 IssueVerifyResult
          // .durationMs 可读，编排层自计；非零/超时分支优先用 face 报告值）
          const verifyStartMs = Date.now();
          try {
            const r = await deps.verify.runVerify({
              cwd: created.path,
              command: verifyCommand,
              timeoutMs: deps.config.verifyTimeoutMs,
            });
            if (r.timedOut || r.exitCode !== 0) {
              const verdict = verifyVerdict(r, deps.config.verifyTimeoutMs);
              await postReceipt(
                issue,
                appendEscalationReceipt(
                  [
                    `🤖 issue run 验证未过：\`${verifyCommand}\`——${verdict}。拒交付，分支 \`${created.branch}\` 留存供排查。`,
                    outcome.summary,
                    '',
                    '```',
                    verifyTail(r.outputTail, secretValues()),
                    '```',
                  ].join('\n'),
                  escalations,
                ),
              );
              // detail 面同载输出尾（双面证据律——2026-09-14 扫描三役 F2 勘正：
              // 修前 detail 只载命令/判据/时长三段、尾段缺席，与 03 §10.7
              // 定形注及 types.ts JSDoc 相悖；尾体消毒后直嵌不折叠保证据保真——
              // 只抹值不折叠〔第四役附段 b 出口消毒，长度与结构照旧〕）
              handle.settle({
                status: 'failed',
                detail: appendEscalationDetail(
                  `验证未过：\`${verifyCommand}\` ${verdict}\n输出尾：${verifyTail(r.outputTail, secretValues())}`,
                  escalations,
                ),
              });
              verifyBlocked = true;
            }
          } catch (err) {
            // 执行体异常一律拒交付（门故障 = 门不放行——goal gates「一切 seam 缺席 = fail」同律）
            const detail = err instanceof Error ? err.message : String(err);
            // 时长围挂钟补进 detail（四元组第四位——异常上抛无 face 报告 durationMs）
            const elapsedMs = Date.now() - verifyStartMs;
            await postReceipt(
              issue,
              appendEscalationReceipt(
                [
                  `🤖 issue run 验证未过（执行异常）：\`${verifyCommand}\`——${detail}。拒交付，分支 \`${created.branch}\` 留存供排查。`,
                  outcome.summary,
                ].join('\n'),
                escalations,
              ),
            );
            handle.settle({
              status: 'failed',
              detail: appendEscalationDetail(
                `验证未过：\`${verifyCommand}\` 执行体异常（${detail}，${elapsedMs}ms）`,
                escalations,
              ),
            });
            verifyBlocked = true;
          }
        }
      }

      // ── 交付映射（04 §10 issue 消费注·终态三因；⑪ 编排定序：verify 门 →
      //    escalation 检查 → 档位映射——验证未过更根本，先于一切交付分叉） ──
      if (outcome.status === 'completed' && !verifyBlocked) {
        if (deps.config.mode === 'draft') {
          // draft 档：评论贴分支 + 补丁（60k 字符帽——GitHub 评论体上限内留余量；
          // escalation 在场附四字段结构化段——draft 档交付本就等人采信，终态
          // 不因附段翻档〔⑪ 裁决 4 收口消费〕）
          let patch = '';
          try {
            patch = await deps.worktree.diffPatch({ name: created.name, baseRef: deps.config.baseBranch });
          } catch (err) {
            warn(`补丁取数失败（${key}）：${err instanceof Error ? err.message : String(err)}`);
          }
          if (patch.length > ISSUE_RECEIPT_PATCH_CHARS) {
            patch = `${patch.slice(0, ISSUE_RECEIPT_PATCH_CHARS)}\n…（补丁超 ${ISSUE_RECEIPT_PATCH_CHARS} 字符帽截断）`;
          }
          const receiptLines = [
            `🤖 issue run 完成（draft 档）：分支 \`${created.branch}\`（本地——未 push）`,
            outcome.summary,
            '',
            '```diff',
            patch || '（无补丁——无改动或取数失败）',
            '```',
          ];
          if (escalations.length > 0) receiptLines.push('', escalationSection(escalations));
          await postReceipt(issue, receiptLines.join('\n'));
          handle.settle({
            status: 'completed',
            detail: `draft：分支 ${created.branch}（${outcome.messagesUsed} 条消息${escalations.length > 0 ? `；escalation 在场 ${escalations.length} 条` : ''}）`,
          });
        } else if (escalations.length > 0) {
          // auto 档 escalation 降级转人审（⑪ 裁决 4——不 push：与 needs-human 检测
          // 同律保守偏向，有疑问的成果不自动交付；静默改判路径比危险闸拒更隐蔽，
          // 回执与 detail 双留痕）
          await postReceipt(
            issue,
            [
              `🤖 issue run 需人审：模型上报 escalation ${escalations.length} 条在身——auto 档不自动交付，分支 \`${created.branch}\` 已就绪（本地未 push），请人审后交付。`,
              outcome.summary,
              '',
              escalationSection(escalations),
            ].join('\n'),
          );
          handle.settle({
            status: 'failed',
            detail: `需人审：escalation 在场 ${escalations.length} 条（auto 档不 push）`,
          });
        } else {
          // auto 档：危险闸交付腿（04 §13——deliver = 闸包裹的 push/PR 执行闭包）。
          // 闸缺席（装配未注入 face）= 03 §10.7 原语义保持：阻塞转人审。
          if (deps.danger === undefined) {
            await postReceipt(
              issue,
              [
                `🤖 issue run 完成（auto 档）但不可逆外部写闸缺席——阻塞转人审：分支 \`${created.branch}\` 已就绪（本地未 push），请人工确认后交付。`,
                outcome.summary,
              ].join('\n'),
            );
            handle.settle({
              status: 'failed',
              detail: '需人审：不可逆外部写闸缺席（auto 档成果已备，push/PR 需人工）',
            });
            return;
          }
          // 交付序：先 push 分支（PR 依赖远端分支在场）→ 再开 PR → 回执贴链接。
          // pushed 位供拒/败回执如实陈述分支状态（已推远端 vs 本地未推）。
          let pushed = false;
          try {
            await deps.danger.deliver({
              kind: 'push',
              repo: issue.repo,
              branch: created.branch,
              worktreePath: created.path,
            });
            pushed = true;
            const pr = await deps.danger.deliver({
              kind: 'create-pr',
              repo: issue.repo,
              branch: created.branch,
              base: deps.config.baseBranch,
              title: issue.title,
              body: [outcome.summary, '', `Closes #${issue.number}`, '', `Source issue: ${issue.htmlUrl}`].join('\n'),
              worktreePath: created.path,
            });
            const prRef = pr.prUrl !== undefined && pr.prUrl !== '' ? pr.prUrl : `#${pr.prNumber ?? '?'}`;
            await postReceipt(
              issue,
              [
                `🤖 issue run 完成（auto 档——危险闸放行交付）：PR ${prRef} 已开（分支 \`${created.branch}\`）。`,
                outcome.summary,
              ].join('\n'),
            );
            handle.settle({
              status: 'completed',
              detail: `auto：PR ${prRef}（分支 ${created.branch}，${outcome.messagesUsed} 条消息）`,
            });
          } catch (err) {
            // 两路分账：DANGER_ 族 = 闸拒（零外联——execute 未被调用）转人审 +
            // 指路修复；其余 = 过闸外部写失败（allow-failed 已记账）留分支重试。
            const branchState = pushed
              ? `分支 \`${created.branch}\` 已推远端（PR 未开成——可人工补开）`
              : `分支 \`${created.branch}\` 已就绪（本地未推）`;
            if (err instanceof BaseError && err.code.startsWith('DANGER_')) {
              const remedy = dangerRemedy(err.code);
              await postReceipt(
                issue,
                [
                  `🤖 issue run 需人审（危险闸拒 ${err.code}）——${branchState}。`,
                  `修复指路：${remedy}`,
                  `原始判据：${err.message}`,
                  outcome.summary,
                ].join('\n'),
              );
              handle.settle({ status: 'failed', detail: `需人审：危险闸拒（${err.code}）——${remedy}` });
            } else {
              const detail = err instanceof Error ? err.message : String(err);
              await postReceipt(
                issue,
                [`🤖 issue run 交付失败（外部写未成）：${detail}——${branchState}，可重试。`, outcome.summary].join(
                  '\n',
                ),
              );
              handle.settle({ status: 'failed', detail: `交付失败：${detail}` });
            }
          }
        }
      } else if (outcome.status === 'failed') {
        // 非 completed 收口 escalation 附段（⑪ 定形注 2026-09-14 补笔——转人审
        // 场景恰是 escalation 呈现的第一场景：回执与 settle detail 双面附，
        // 待裁决问题不随 Job 蒸发）
        await postReceipt(
          issue,
          appendEscalationReceipt(
            `🤖 issue run 失败：${outcome.reason}（分支 \`${created.branch}\` 留存供排查）`,
            escalations,
          ),
        );
        handle.settle({ status: 'failed', detail: appendEscalationDetail(outcome.reason, escalations) });
      } else if (outcome.status === 'needs-human') {
        // needs-human：无应答者审批拒/写动作无策略表覆盖（04 §9 fail-closed）——转人审。
        // 显式判词（非 else 兜底）：completed-but-verifyBlocked 形不走本支——验证门拒已自落
        // 回执与终态，漏进本支会把 completed 误报成 needs-human（TS 窄化报错即此病自证）
        await postReceipt(
          issue,
          appendEscalationReceipt(
            `🤖 issue run 需人审：${outcome.reason}（分支 \`${created.branch}\` 留存——处理后可重开）`,
            escalations,
          ),
        );
        handle.settle({ status: 'failed', detail: appendEscalationDetail(`需人审：${outcome.reason}`, escalations) });
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
        issueRunning.delete(key); // 帽位释放（paused 保留——停靠仍占 registry running 位）
        inflight.delete(key);
        if (sessionId !== undefined) deps.worktree.releaseSession(sessionId);
      }
    }
  }

  /**
   * 入队裁决（同步、零 await 到 register——竞速窗口不存在）。预检序：
   * capabilities → closed → dedupe → 并行帽 → budget → register → fire。
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
    // issue 并行帽预检（FX-1：受理位诚实化——帽满不谎报 started、不发起
    // runOne，回执沿 rejected 形〔同预算闸〕。预检源 = issueRunning 在飞键集
    // 〔本服务是 kind issue 唯一注册方，与 registry parallelLimits 计数同源
    // 镜像〕；帽值单源 = ISSUE_PARALLEL_LIMIT_DEFAULT〔装配 parallelLimits
    // 同常量〕；预检与 register 间的漂移残余由 runOne 受理位 try-catch 兜底。
    // 拒收不打 GitHub 评论——轮询每周期重见同 issue 会刷屏，rejected 回执
    // 〔轮询报告/webhook 响应〕已是调用方可见面；重试语义同预算拒先例：
    // 水位照推、issue 后续更新再触发）
    if (issueRunning.size >= ISSUE_PARALLEL_LIMIT_DEFAULT) {
      warn(
        `[ISSUE_JOB_LIMIT] issue 并行帽满（在飞 ${issueRunning.size} ≥ ${ISSUE_PARALLEL_LIMIT_DEFAULT}）——本轮拒收：${key}`,
      );
      return {
        status: 'rejected',
        reason: `issue 并行帽满（在飞 ${issueRunning.size} ≥ 帽 ${ISSUE_PARALLEL_LIMIT_DEFAULT}）——本轮拒收，issue 后续更新将自动重试入队`,
      };
    }
    const afford = deps.budget.canAffordIssue();
    if (!afford.ok) {
      return { status: 'rejected', reason: afford.reason ?? '全局预算日池尽（停靠）' };
    }
    // fire（runOne 首语句经 admitIssueJob 同步执行 register——enqueue 返回前
    // 已入册，紧随的二次 enqueue 在 running() 扫描即见：互斥成立）
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

    enqueue(issue) {
      return enqueue(issue);
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
