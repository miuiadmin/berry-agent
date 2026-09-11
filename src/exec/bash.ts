/**
 * bash 工具件（04 §8 全规格：发现序/超时帽/后台化截获/沙箱消费/失败二分）。
 *
 * 参数面恰 {command, timeoutMs?, cwd?, sandbox_permissions?, justification?}——
 * 无 stdin、无 env 注入、无后台化。升权闭包（会话内审批缓存/粘性）归驱动层，
 * 本件纯逻辑腿只做 allowed-once 语义：审批产物 target 只用于本次 spawn，不写
 * 回会话档（04 §8「只授予当次调用」）。
 *
 * 失败二分的工具面分报：spawn 阶段失败（EXEC_SPAWN_FAILED——bash 不在场/
 * runner 没跑起来）与执行阶段失败（exitCode ≠ 0 → isError）走两条腿；沙箱
 * 策略拒绝（denialSignatures 命中）单独成第三腿——拒绝标记 + 升权提示引导
 * 模型走正道，拒绝是最终的不许投机。
 */
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import {
  canonicalPath,
  deriveWritableRoots,
  escalationHintMarker,
  requestEscalation,
  sandboxDenialMarker,
  validateEscalationArgs,
} from '../safety/index.js';
import type {
  ApprovalOutcome,
  ApprovalRequest,
  ConfinedArgv,
  SandboxMode,
  SandboxPolicy,
  SandboxService,
} from '../safety/index.js';
import { BASH_TIMEOUT_DEFAULT_MS, BASH_TIMEOUT_MAX_MS } from './types.js';
import type { ExecResult, SpawnPipeline } from './types.js';
import { findGitRedirectViolations, isGitMetadataExempt, worktreeGitDir } from './git-guard.js';

/**
 * bash 发现序（04 §8）：BERRY_AGENT_BASH_PATH > 系统 PATH 逐目录 X_OK 扫描。
 * 候选命中 WSL launcher（win32 的 bash.exe 系 WSL 代跳板——非真 bash）视为
 * 缺席继续扫；全链缺席 fail-loud 抛 EXEC_SPAWN_FAILED（不降级 cmd——降级会
 * 制造半兼容 shell 的静默行为分叉）。
 * @param env 环境源（BERRY_AGENT_BASH_PATH 与 PATH 的读面；缺省 process.env）
 */
export function discoverBash(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BERRY_AGENT_BASH_PATH;
  if (override !== undefined && override !== '') {
    // 显式指名不可用 = 配置错：fail-loud 带修复提示（不静默回落 PATH——回落
    // 会掩盖配置失效，用户以为在用指定 bash 实则不是）
    assertExecutable(override);
    return override;
  }
  const pathValue = env.PATH ?? '';
  const launcherNames = new Set(['bash.exe', 'wsl.exe', 'wsl']);
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, 'bash');
    if (!assertExecutable(candidate, true)) continue;
    // WSL launcher 防线：win32 下名为 bash 的实为 WSL 代跳板（basename 族）
    const base = candidate.split(/[\\/]/).pop() ?? '';
    if (process.platform === 'win32' && launcherNames.has(`${base}.exe`)) continue;
    return candidate;
  }
  throw new BaseError(
    'EXEC_SPAWN_FAILED',
    'bash 不在场（PATH 全链无 X_OK 命中；不降级 cmd）——可经 BERRY_AGENT_BASH_PATH 显式指名',
  );
}

/** X_OK 可执行判定（soft 形返回 false；hard 形抛 EXEC_SPAWN_FAILED 带路径提示） */
function assertExecutable(path: string, soft = false): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch (error) {
    if (soft) return false;
    throw new BaseError(
      'EXEC_SPAWN_FAILED',
      `BERRY_AGENT_BASH_PATH 指名的 bash 不可执行：${path}（${error instanceof Error ? error.message : String(error)}）`,
      { cause: error },
    );
  }
}

/** 后台化截获（04 §8「无后台化」：模型不能脱管留后台进程） */
export function assertNoBackgroundCommand(command: string): void {
  const trimmed = command.trimEnd();
  // 尾部单 &（不含 && 逻辑与——两字符形是串行算子）= 后台化
  if (trimmed.endsWith('&') && !trimmed.endsWith('&&')) {
    throw new BaseError(
      'EXEC_BACKGROUND_REJECTED',
      '命令尾部单 &（后台化）被拒——模型不能脱管留后台进程；长任务用 timeoutMs 显式控预算',
    );
  }
  // 命令位 nohup/disown（首 token）：挂断免疫/脱管语义同为后台化面
  const firstToken = command.trimStart().split(/\s+/)[0] ?? '';
  if (firstToken === 'nohup' || firstToken === 'disown') {
    throw new BaseError('EXEC_BACKGROUND_REJECTED', `命令位 ${firstToken}（脱管语义）被拒——模型不能脱管留后台进程`);
  }
}

/** bash 工具工厂依赖（装配根注入；全可测） */
export interface BashToolDeps {
  /** spawn 管道（执行真身） */
  readonly pipeline: SpawnPipeline;
  /** 工作区根（cwd 缺省腿 + 沙箱策略锚——运行时取值面） */
  readonly workspaceRoot: () => string;
  /** 当前生效沙箱档（三级解析的会话档位腿——运行时取值面） */
  readonly currentMode: () => SandboxMode;
  /** 沙箱服务（三档一律包装——04 §8 定形②；缺席恒 fail-closed 拒裸跑） */
  readonly sandboxService?: SandboxService;
  /** 升权审批面（缺席则升权请求 fail-closed 拒——不给「无审批静默放行」） */
  readonly approval?: { ask(req: ApprovalRequest): Promise<{ outcome: ApprovalOutcome }> };
  /** 环境源（发现序读面；测试注入） */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * bash 工具定义工厂（conversation ExecToolService.bashTool 的直供体——装载
 * 态 scope.provide('exec') 归批 12 装配面后装配批）。
 */
export function createBashTool(deps: BashToolDeps): ToolDefinition {
  // 发现一次即缓存（PATH 扫描有成本；会话期 bash 在场性不变）
  let bashPath: string | undefined;
  const resolveBash = (): string => {
    if (bashPath === undefined) bashPath = discoverBash(deps.env);
    return bashPath;
  };
  return {
    name: 'bash',
    description:
      '在工作区执行 bash 命令（login shell：profile 级工具链在场）。默认 120 秒' +
      '超时（上限 600 秒，到点进程组树杀）；输出保尾 60KiB 合计截断。工作目录' +
      '缺省为工作区根。不支持后台化（尾部 & 与 nohup 被拒）。受限沙箱档下写' +
      '工作区外会被拒；确需越档时同调用携带 sandbox_permissions（目标档）与' +
      'justification（理由）发起升权审批。',
    parameters: Type.Object(
      {
        command: Type.String({ description: '要执行的 bash 命令串' }),
        timeoutMs: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: BASH_TIMEOUT_MAX_MS,
            description: `超时预算毫秒（缺省 ${BASH_TIMEOUT_DEFAULT_MS}，上限 ${BASH_TIMEOUT_MAX_MS}）`,
          }),
        ),
        cwd: Type.Optional(Type.String({ description: '工作目录（缺省工作区根）' })),
        sandbox_permissions: Type.Optional(
          Type.String({ description: '升权目标档（workspace-write / danger）——须与 justification 成对' }),
        ),
        justification: Type.Optional(Type.String({ description: '升权理由——须与 sandbox_permissions 成对' })),
      },
      { additionalProperties: false },
    ),
    // bash 执行任意 shell 命令 = exec 档（04 §9 定形块①三值扩——v1 升档清单
    // 恰一处即本件：任意进程执行类固有风险位最高，自 write 升 exec 档；批内
    // 调度 write|exec 同串行屏障（03 §2.3 尾注）、审批对照走、write 档免问
    // 授权不覆盖 bash 调用（偏序窄化自限））
    effect: 'exec',
    execute: async (args, toolCtx): Promise<AgentToolResult> => {
      try {
        const command = String(args.command);
        assertNoBackgroundCommand(command);
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : BASH_TIMEOUT_DEFAULT_MS;
        const cwd = typeof args.cwd === 'string' ? args.cwd : deps.workspaceRoot();

        // ---- 腿一（04 §252）：.git 重定向目标扫描——硬拒前置（升权审批前，
        // 不空耗审批对；任何档无升权出路、白名单不豁免——carve-out 路径级
        // 直写恒不可写） ----
        const gitViolations = findGitRedirectViolations(command, cwd);
        if (gitViolations.length > 0) {
          throw new BaseError(
            'EXEC_GIT_REDIRECT_DENIED',
            `bash 重定向目标落在 .git 版本史内（${gitViolations.join('、')}）——carve-out 平台底线：` +
              '任何档恒不可写、无升权出路（04 §252）；git 元数据操作请走 git 命令白名单形' +
              '（add/commit/branch 等直陈命令，不带命令替换/子壳）',
          );
        }

        const bash = resolveBash();

        // ---- 三级解析本调用腿（04 §8）：工具参数携带升权 → 校验 → 审批 ----
        let mode = deps.currentMode();
        if (args.sandbox_permissions !== undefined || args.justification !== undefined) {
          const valid = validateEscalationArgs({
            current: mode,
            sandboxPermissions: typeof args.sandbox_permissions === 'string' ? args.sandbox_permissions : undefined,
            justification: typeof args.justification === 'string' ? args.justification : undefined,
          });
          if (deps.approval === undefined) {
            return {
              content: [
                {
                  type: 'text',
                  text: `[SANDBOX_UNAVAILABLE] 升权审批面缺席——拒绝无审批的升权执行（${mode} → ${valid.target}）`,
                },
              ],
              isError: true,
            };
          }
          const decision = await requestEscalation(deps.approval, {
            ...valid,
            current: mode,
            toolName: 'bash',
            toolCallId: toolCtx.toolCallId,
            ...(toolCtx.signal !== undefined ? { signal: toolCtx.signal } : {}),
          });
          if (decision.outcome !== 'allowed-once') {
            // 用户拒绝/取消/审批面不可用：拒绝是最终的——不带升权提示（不许
            // 投机重试；提示标记只随真实策略拒绝走）
            return {
              content: [
                {
                  type: 'text',
                  text: `升权审批未通过（${mode} → ${valid.target}，结果 ${decision.outcome}）——本次调用拒绝执行`,
                },
              ],
              isError: true,
            };
          }
          // allowed-once：目标档只用于本次 spawn，不写回会话档
          mode = valid.target;
        }

        // ---- argv 组装：三档一律 confine（04 §8 定形②「任何档一律」——
        // 2026-09-08 P0①；danger 形 = 最小读 deny profile，后端件分支定形；
        // 沙箱缺席恒 fail-closed 拒裸跑——换档不是绕后端的路） ----
        // -lc login shell：profile 级工具链（nvm 等）在场——承 berry getShellArgs 语义
        const rawArgv = [bash, '-lc', command];
        if (deps.sandboxService === undefined) {
          return {
            content: [
              {
                type: 'text',
                text: `[SANDBOX_UNAVAILABLE] 沙箱服务缺席，拒绝以 ${mode} 档裸跑（不静默无沙箱执行）`,
              },
            ],
            isError: true,
          };
        }
        // ---- 腿二（04 §252）：静态洁净白名单分类 + 策略组装 ----
        // 非豁免形恒携 workspace .git 写 deny（任何档含 danger——底线不交档位；
        // 运行时兜底关 tee/python/sed -i/dd/变量间接等全部非重定向向量）；
        // 豁免形不携 deny，且 worktree 锚定时补 backing gitdir 可写根（修
        // worktree 会话 git 命令沙箱断链——backing 在 worktree 根外、缺省
        // 推导不可达；仅 workspace-write 档追加：danger 已全盘、read-only
        // 空根不授予——豁免是 carve-out 面非写权授予）。
        const wsRoot = deps.workspaceRoot();
        const gitExempt = isGitMetadataExempt(command);
        // worktree 授予腿：豁免形 + worktree 锚定 + workspace-write 档 →
        // backing gitdir 入可写根（danger 已全盘不追加、read-only 空根不授予
        // ——豁免是 carve-out 面非写权授予）
        const backing = gitExempt && mode === 'workspace-write' ? worktreeGitDir(wsRoot) : undefined;
        const policy: SandboxPolicy = !gitExempt
          ? { mode, workspaceRoot: wsRoot, denyWritePaths: [canonicalPath(join(wsRoot, '.git'))] }
          : backing !== undefined
            ? { mode, workspaceRoot: wsRoot, writableRoots: [...deriveWritableRoots(wsRoot, mode), backing] }
            : { mode, workspaceRoot: wsRoot };
        const confined: ConfinedArgv = deps.sandboxService.confine(rawArgv, policy);
        const result = await deps.pipeline.run({
          argv: confined.argv,
          cwd,
          timeoutMs,
          ...(toolCtx.signal !== undefined ? { signal: toolCtx.signal } : {}),
          owner: toolCtx.toolCallId,
        });

        // ---- 结算分类（退出码非工具面异常——数据面分报） ----
        if (result.outcome === 'timeout') {
          return errorWithTail(
            `[EXEC_TIMEOUT] 命令超时（预算 ${timeoutMs}ms）——已进程组树杀；尾部输出保留下方`,
            result,
          );
        }
        if (result.outcome === 'abort') {
          return errorWithTail('[EXEC_ABORTED] 命令被打断（协作中止信号）', result);
        }
        // runner 自身失败（runner 没跑起来——区别于策略拒绝生效）：EXEC_SPAWN_FAILED
        // 分类（spawn 阶段失败同族：进程虽 spawn 了但沙箱 runner 未成活）
        if (result.exitCode !== 0) {
          const lower = result.stderr.toLowerCase();
          const fatal = confined.runnerFailureRules.some((rule) =>
            rule.fatalSignatures.some((sig) => lower.includes(sig.toLowerCase())),
          );
          if (fatal) {
            return errorWithTail(
              `[EXEC_SPAWN_FAILED] 沙箱 runner 未跑起来（后端故障非策略拒绝）——安装对应沙箱后端`,
              result,
            );
          }
          // 策略拒绝（denialSignatures 命中）：拒绝标记 + 真实 stderr + 升权提示
          const denied = confined.denialSignatures.some((sig) => lower.includes(sig.toLowerCase()));
          if (denied) {
            return {
              content: [
                {
                  type: 'text',
                  text: `${sandboxDenialMarker(mode)}\n${result.stderr.trim()}\n${escalationHintMarker()}`,
                },
              ],
              isError: true,
            };
          }
        }
        // 自然退出：exitCode ≠ 0 = 执行阶段失败（失败二分后者——正常结算 isError）
        const sections: string[] = [`Exit code: ${result.exitCode ?? 'null（信号终止）'}`];
        if (result.stdout !== '') sections.push(`--- stdout ---\n${result.stdout}`);
        if (result.stderr !== '') sections.push(`--- stderr ---\n${result.stderr}`);
        if (result.truncated) {
          sections.push(`（输出超 60KiB 已截尾：实收 ${result.bytes} 字节，保尾部）`);
        }
        const text = sections.join('\n');
        return result.exitCode === 0
          ? { content: [{ type: 'text', text }] }
          : { content: [{ type: 'text', text }], isError: true };
      } catch (error) {
        // 抛出面（EXEC_SPAWN_FAILED/EXEC_BACKGROUND_REJECTED/SANDBOX_* 校验族）
        // 编码为 isError 数据面（03 §2.3）——BaseError 携码前置披露
        const code = error instanceof BaseError ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: code ? `[${code}] ${message}` : message }],
          isError: true,
        };
      }
    },
  };
}

/** isError + 输出保尾段（超时/打断/runner 失败三形共用——尾部现场须保留） */
function errorWithTail(prefix: string, result: ExecResult): AgentToolResult {
  const sections: string[] = [prefix];
  if (result.stdout !== '') sections.push(`--- stdout ---\n${result.stdout}`);
  if (result.stderr !== '') sections.push(`--- stderr ---\n${result.stderr}`);
  if (result.truncated) {
    sections.push(`（输出超 60KiB 已截尾：实收 ${result.bytes} 字节，保尾部）`);
  }
  return { content: [{ type: 'text', text: sections.join('\n') }], isError: true };
}
