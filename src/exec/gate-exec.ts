/**
 * goal gates 判据门 command 源执行 seam 工厂（03 §10.5 ex 批落码定形注①
 * ——「exec 判据门真接线」兑现件，2026-09-14）。
 *
 * 编舞单源律（04 §7「管道是唯一执行路径」结构保证）：本件与 bash 工具件
 * （bash.ts）同模块——守门全序复用件内函数族（背景命令拒/git 重定向硬拒/
 * git push 截获〔03 :823 六役消费位接线〕/豁免分类/沙箱一律 confine），
 * spawn 经 pipeline.run 全腿照常（登记簿/env 白名单/三源竞速结算/保尾）。
 * goal 侧不自组装第二份编舞、不解析工具文本结果（立项档裁决 1 两否决项）。
 *
 * 与 bash 工具件的分职（裁决 2/3）：
 * - 档位**恒 workspace-write**（goal needsWrite 批准是 goal 级预授权——批
 *   的是写面；不随会话档，恒定档确定性强）；
 * - **升权恒不可用**：approval 面不注入 = 升权请求 fail-closed 拒（bash 工具
 *   既有律）——gate 命令无 danger 出路，gate 声明面无 sandbox_permissions
 *   位（模型不可借 gate 申报发起升权）；
 * - 超时帽 30s 固定（模型不可调——gate 声明面只有 command 串）；signal 不
 *   传导（评测在 goal_update 执行段内同步等待，帽自兜底）；
 * - 守门抛错折非 0 不炸评测循环（裁决 3——评测判非 0 即 fail，报文进
 *   GateOutcome detail 供诊断）。
 *
 * 落账（裁决 4）：pipeline owner 固定串 'goal-gate'（登记簿/孤儿清扫归因位
 * ——评测无 toolCtx 传导，观测粒度 v1 够）；守门观测账由 GateOutcome 既有
 * goal 事件流承载（audit_events 零新词）。
 */
import { join } from 'node:path';
import { BaseError } from '../contracts/index.js';
import { canonicalPath, deriveWritableRoots } from '../safety/index.js';
import type { SandboxService } from '../safety/index.js';
import type { SpawnPipeline } from './types.js';
import { assertNoBackgroundCommand, discoverBash } from './bash.js';
import { findGitRedirectViolations, isGitMetadataExempt, isGitPushAttempt, worktreeGitDir } from './git-guard.js';

/**
 * gate 命令超时帽（30s 固定——ex 批裁决 3）。
 *
 * 同值单源注：goal 侧评测帽 GATE_COMMAND_TIMEOUT_MS（goal/gates.ts）与
 * 本常量分域自持（exec 席 DAG 无 goal 边——不可 import 对端）；两值必须
 * 相等，测试对拍锁在 goal 侧装配测试（跨域 import 测试面合法）。
 */
export const GATE_EXEC_TIMEOUT_MS = 30_000;

/** pipeline owner 固定串（登记簿/孤儿清扫归因——评测无 toolCtx，goal 行 goalId 可查） */
export const GATE_EXEC_OWNER = 'goal-gate';

/** 工厂依赖（exec 件 apply 期单例闭包供入；全可测——pipeline/sandbox 注桩） */
export interface GateExecFactoryDeps {
  /** spawn 管道（执行真身——makeExecPlugin apply 期单例） */
  readonly pipeline: SpawnPipeline;
  /** 沙箱服务（三档一律包装——缺席恒 fail-closed 拒裸跑，bash 工具同律） */
  readonly sandboxService?: SandboxService;
  /** 工作区根取值器（cwd + 沙箱策略锚——goal 侧 canonicalWorkspaceRoot 单源） */
  readonly workspaceRoot: () => string;
}

/**
 * goal gates command 源执行 seam（goal 席 GateExecSeam 结构形——内联承载
 * 不 import goal 域类型，同 conversation 席结构 typing 律）。
 *
 * 返回形消费契约（goal/gates.ts evaluateCommand）：timedOut 先判 →
 * exitCode 非 0 判 fail（stderrTail 末行进 detail）→ exit 0 放行。
 */
export interface GateExecHandle {
  execCommand(command: string): Promise<{ exitCode: number; timedOut: boolean; stderrTail: string }>;
}

/** stderr 保尾段取末行（评测 detail 文案「stderr 末行」——保尾段可能多行） */
function lastLine(tail: string): string {
  const trimmed = tail.trim();
  if (trimmed === '') return '';
  return trimmed.split('\n').pop() ?? '';
}

/** 结算折形（裁决 3 细则：timeout → timedOut；exit-null〔被杀/abort〕→ 非 0 + outcome 名） */
function foldResult(result: { outcome: string; exitCode: number | null; stderr: string }): {
  exitCode: number;
  timedOut: boolean;
  stderrTail: string;
} {
  if (result.outcome === 'timeout') {
    return { exitCode: 1, timedOut: true, stderrTail: lastLine(result.stderr) };
  }
  if (result.exitCode !== null) {
    return { exitCode: result.exitCode, timedOut: false, stderrTail: lastLine(result.stderr) };
  }
  // 被杀/abort 等 exit-null 形：非 0 + stderrTail 带 outcome 名（诊断面）
  return { exitCode: 1, timedOut: false, stderrTail: `[outcome: ${result.outcome}] ${lastLine(result.stderr)}`.trim() };
}

/**
 * 造 gate 执行 seam：守门全序（背景命令拒 → git 重定向硬拒 → git push
 * 截获〔03 :823 六役——与重定向拒同位硬拒〕→ 豁免分类 + 沙箱一律 confine）
 * → pipeline.run（30s 帽 + owner 'goal-gate'）→ 结算折形。
 *
 * 守门抛错（EXEC_BACKGROUND_REJECTED/EXEC_GIT_REDIRECT_DENIED/
 * EXEC_GIT_PUSH_DENIED/SANDBOX_* 族）catch 折非 0——评测循环不炸，
 * 报文进 detail 供诊断。
 */
export function createGateExec(deps: GateExecFactoryDeps): GateExecHandle {
  // 发现一次即缓存（bash 在场性进程内不变——bash 工具同律）
  let bashPath: string | undefined;
  const resolveBash = (): string => {
    if (bashPath === undefined) bashPath = discoverBash();
    return bashPath;
  };
  return {
    async execCommand(command) {
      try {
        // 守门 1：后台化截获（与 bash 工具同源函数——编舞单源）
        assertNoBackgroundCommand(command);
        const cwd = deps.workspaceRoot();
        // 守门 2：.git 重定向目标扫描（carve-out 平台底线——任何档无升权出路）
        const gitViolations = findGitRedirectViolations(command, cwd);
        if (gitViolations.length > 0) {
          throw new BaseError(
            'EXEC_GIT_REDIRECT_DENIED',
            `gate 命令重定向目标落在 .git 版本史内（${gitViolations.join('、')}）——carve-out 平台底线恒不可写`,
          );
        }
        // 守门 2.5：git push 外推截获（03 :823 六役消费位接线——bash 工具面
        // :272 同款先例，插入位点与 git 重定向拒相邻）。gate 命令无 danger
        // 出路（approval 面不注入），远端史不可逆写不因档位放行——词干命中
        // 即硬拒，全档无升权出路（折形同守门抛错：catch 折 exitCode 1 +
        // stderrTail 带 code）
        if (isGitPushAttempt(command)) {
          throw new BaseError(
            'EXEC_GIT_PUSH_DENIED',
            'gate 命令 git push 外推全档截获（EXEC_GIT_PUSH_DENIED——03 :823 六役）：' +
              '远端史不可逆写不因档位放行；发布动作走宿主编排面或人面自跑，' +
              '本地评测工作（commit/branch 等只读与本地动词）不受影响',
          );
        }
        // 沙箱缺席恒 fail-closed 拒裸跑（bash 工具同律——换档不是绕后端的路）
        if (deps.sandboxService === undefined) {
          throw new BaseError('SANDBOX_UNAVAILABLE', '沙箱服务缺席，拒绝 gate 命令裸跑（不静默无沙箱执行）');
        }
        // 守门 3：静态洁净白名单分类 + 策略组装（恒 workspace-write——裁决 2）
        const wsRoot = deps.workspaceRoot();
        const gitExempt = isGitMetadataExempt(command);
        const backing = gitExempt ? worktreeGitDir(wsRoot) : undefined;
        const policy = !gitExempt
          ? {
              mode: 'workspace-write' as const,
              workspaceRoot: wsRoot,
              denyWritePaths: [canonicalPath(join(wsRoot, '.git'))],
            }
          : backing !== undefined
            ? {
                mode: 'workspace-write' as const,
                workspaceRoot: wsRoot,
                writableRoots: [...deriveWritableRoots(wsRoot, 'workspace-write'), backing],
              }
            : { mode: 'workspace-write' as const, workspaceRoot: wsRoot };
        const confined = deps.sandboxService.confine([resolveBash(), '-lc', command], policy);
        // 执行段：pipeline.run 全腿照常（30s 帽固定 + owner 归因——signal 不传导）
        const result = await deps.pipeline.run({
          argv: confined.argv,
          cwd,
          timeoutMs: GATE_EXEC_TIMEOUT_MS,
          owner: GATE_EXEC_OWNER,
        });
        return foldResult(result);
      } catch (error) {
        // 守门抛错折非 0（不炸评测循环——评测判非 0 即 fail，报文进 detail）
        const code = error instanceof BaseError ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 1, timedOut: false, stderrTail: code !== undefined ? `[${code}] ${message}` : message };
      }
    },
  };
}
