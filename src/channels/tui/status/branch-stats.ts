/**
 * ⎇ 槽本分支相对默认支累计统计纯函数件（挖掘 39 轮件 II——codex
 * branch_summary 对标；07 注⑪③ 追注）：默认支解析 + numstat 累加 + 统计
 * 管线（经 gitQuery 注入——本件零真 IO）；异步子进程真身工厂供装配。
 *
 * 管线四步（codex 同律）：rev-parse --git-dir（库判定）→ 默认支解析 →
 * merge-base → diff --numstat 累加。**只计已提交差**（工作区脏不计——状态
 * 行概览的是已 checkout 支）；binary `-` 行计 0；一切失败/缺席 → null
 * （footer 缺席不虚报律）。
 *
 * 默认支解析 berry 简化形：remote symbolic-ref（origin 优先序）→ 本地
 * main/master 兜底（rev-parse verify 存在性）；codex remote-show 网络腿
 * 不迁（无网依赖——stale 形由 merge-base 失败兜住整腿缺席）。
 */
import { spawn } from 'node:child_process';

/** git 只读查询结果（stdout 已 trim——归一在封装内，tmuxSpawn 同律） */
export interface GitQueryResult {
  readonly status: number;
  readonly stdout: string;
}

/**
 * git 只读查询注入（args + cwd → { status, stdout } | null）：null = spawn
 * 失败/超时（git 不在场）；编排消费方缺席判据单源。
 */
export type GitQuery = (args: readonly string[], cwd: string) => Promise<GitQueryResult | null>;

/** 查询超时（10s——NFS/巨仓挂起防御；kill 后 close 以非零码归失败） */
const GIT_QUERY_TIMEOUT_MS = 10_000;

/**
 * 缺省真身（生产装配注入用）：异步 spawn（**非 spawnSync——不阻塞帧**）、
 * env 叠 `GIT_OPTIONAL_LOCKS=0` 只读安全档（codex 同律）、cwd 定界、10s
 * 超时 kill、spawn 失败（ENOENT 无 git）→ null；stdout trim 归一在本封装。
 */
export function createDefaultGitQuery(): GitQuery {
  return (args, cwd) =>
    new Promise((resolve) => {
      const child = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      const timer = setTimeout(() => child.kill(), GIT_QUERY_TIMEOUT_MS);
      child.stdout?.on('data', (chunk) => {
        stdout += chunk as string;
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null); // git 不在场（ENOENT）
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ status: code ?? -1, stdout: stdout.trim() });
      });
    });
}

/**
 * `git remote` 输出 → 远端名序（origin 优先——fork/enterprise 异名
 * upstream 仍可达，codex 同律；余按原序）；空输出 → 空表（跳远端腿）。
 */
export function orderRemotes(remoteList: string): string[] {
  const names = remoteList
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return [...names.filter((name) => name === 'origin'), ...names.filter((name) => name !== 'origin')];
}

/**
 * symbolic-ref 输出解析：形 `refs/remotes/<r>/<支>` 即 merge ref（输出本身
 * 即指向）；非法形 → null。
 */
export function parseSymbolicRef(out: string): string | null {
  const ref = out.trim();
  return /^refs\/remotes\/[^/]+\/.+/.test(ref) ? ref : null;
}

/**
 * `git diff --numstat` 输出累加：行形 `<added>\t<removed>\t<path>`；binary
 * 行 `-` 计 0（codex 同律）；空输出 = 双零（在默认支无累计差——消费方按
 * 双零缺席形处理）。
 */
export function accumulateNumstat(stdout: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of stdout.split('\n')) {
    const [a, r] = line.trim().split('\t');
    if (a === undefined || r === undefined) continue; // 空行/非法定界行跳过
    const av = Number.parseInt(a, 10);
    const rv = Number.parseInt(r, 10);
    if (!Number.isNaN(av)) added += av; // binary '-' NaN 计 0
    if (!Number.isNaN(rv)) removed += rv;
  }
  return { added, removed };
}

/**
 * 默认支解析（远端 symbolic-ref 优先 → 本地 main/master 兜底）：
 * 远端腿按 origin 优先序逐 remote 读 `symbolic-ref refs/remotes/<r>/HEAD`
 * （本地读零网络——stale 形由后续 merge-base 失败兜住整腿缺席）；兜底腿
 * `rev-parse --verify --quiet refs/heads/<main|master>`（存在性判定）。
 * 一切未命中 → null。
 */
export async function resolveDefaultRef(gitQuery: GitQuery, cwd: string): Promise<string | null> {
  const remotes = await gitQuery(['remote'], cwd);
  if (remotes !== null && remotes.status === 0) {
    for (const remote of orderRemotes(remotes.stdout)) {
      const sym = await gitQuery(['symbolic-ref', `refs/remotes/${remote}/HEAD`], cwd);
      if (sym === null || sym.status !== 0) continue;
      const ref = parseSymbolicRef(sym.stdout);
      if (ref !== null) return ref;
    }
  }
  // 本地兜底（codex remote-show 网络腿不迁）：存在性判定非 merge-base 试探
  for (const branch of ['main', 'master']) {
    const verify = await gitQuery(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
    if (verify !== null && verify.status === 0) return `refs/heads/${branch}`;
  }
  return null;
}

/**
 * 统计管线（经 gitQuery 注入——测试桩零真进程）：库判定 → 默认支 →
 * merge-base → numstat 累加。任一步失败/缺席 → null（footer 缺席不虚报
 * 律）；双零（在默认支）由消费方按缺席形处理。
 */
export async function computeBranchStats(
  gitQuery: GitQuery,
  cwd: string,
): Promise<{ added: number; removed: number } | null> {
  // 库判定（与 readGitHead 直读三形探测互补——子进程形权威兜底）
  const dir = await gitQuery(['rev-parse', '--git-dir'], cwd);
  if (dir === null || dir.status !== 0) return null;
  const ref = await resolveDefaultRef(gitQuery, cwd);
  if (ref === null) return null;
  const mergeBase = await gitQuery(['merge-base', 'HEAD', ref], cwd);
  if (mergeBase === null || mergeBase.status !== 0) return null;
  const numstat = await gitQuery(['diff', '--numstat', `${mergeBase.stdout}..HEAD`], cwd);
  if (numstat === null || numstat.status !== 0) return null;
  return accumulateNumstat(numstat.stdout);
}
