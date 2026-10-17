/**
 * environment 披露段的 git 摘要件（07 篇 exec 行：平台/OS·git 摘要在 exec/host
 * 侧组装——本件供 git 半边；OS 半边归 host 装配批直接读 process 面）。
 *
 * 走 spawn 管道跑 `git status --porcelain=v1 --branch`：env 白名单（PATH 在
 * 缺省 allow 内）+ 登记入册 + 输出保尾全继承管道纪律。非 git 仓库/git 缺席/
 * 超时 → null——披露面是增益信息，缺席降级不报错（fail-soft：会话环境披露
 * 缺 git 半边不损任何执行正确性）。
 */
import type { SpawnPipeline } from './types.js';

/** git 摘要（environment 披露段消费形） */
export interface GitSummary {
  /** 当前分支名（detached HEAD 形为 'HEAD (detached)'） */
  readonly branch: string;
  /** 领先上游提交数（无上游跟踪为 0） */
  readonly ahead: number;
  /** 落后上游提交数（无上游跟踪为 0） */
  readonly behind: number;
  /** 工作区脏条目数（未暂存/已暂存/未跟踪全计） */
  readonly dirtyCount: number;
}

/** 摘要探测预算（git 本地查询秒级；超时归 null 不阻塞会话启动） */
const GIT_SUMMARY_TIMEOUT_MS = 5_000;

/**
 * 取工作区 git 摘要。
 * @param cwd 探测目录（通常工作区根）
 * @param pipeline spawn 管道（复用宿主登记簿与 env 白名单纪律）
 * @returns 摘要；非仓库/git 缺席/超时/打断 → null
 */
export async function gitSummary(cwd: string, pipeline: SpawnPipeline): Promise<GitSummary | null> {
  const result = await pipeline.run({
    argv: ['git', 'status', '--porcelain=v1', '--branch'],
    cwd,
    timeoutMs: GIT_SUMMARY_TIMEOUT_MS,
    owner: 'environment',
  });
  // 非零退出（非仓库 128 / git 不在场走 EXEC_SPAWN_FAILED 抛出由调用面 catch）
  // 或非自然退出 → 披露缺席
  if (result.outcome !== 'exit' || result.exitCode !== 0) return null;
  const lines = result.stdout.split('\n').filter((line) => line !== '');
  const branchLine = lines[0];
  if (branchLine === undefined || !branchLine.startsWith('## ')) return null;
  let branch = branchLine.slice(3).split('...')[0] ?? '';
  const tracking = branchLine.slice(3);
  if (branch === 'HEAD' && tracking.includes('(no branch)')) branch = 'HEAD (detached)';
  // ahead/behind 尾段：`## main...origin/main [ahead 2, behind 1]`
  const aheadMatch = /\[ahead (\d+)/.exec(tracking);
  const behindMatch = /\[.*behind (\d+)/.exec(tracking);
  // 首行后每行一条工作区条目（含 ?? 未跟踪——脏计数全计）
  const dirtyCount = lines.length - 1;
  return {
    branch,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    dirtyCount,
  };
}
