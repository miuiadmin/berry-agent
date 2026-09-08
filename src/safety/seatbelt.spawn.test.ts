/**
 * safety/seatbelt 真跑测试 — darwin 平台沙箱读 deny / 写 deny 执法回归锁
 * （04 §7 读侧 carve-out + 04 §8 定形②——2026-09-08 P0①；写 deny 面 =
 * 04 §252 腿二——成熟度缺口 #9）。
 *
 * 与 sandbox.test 的分工：彼件只测参数面纯函数（不 spawn——平台无关跑）；
 * 本件在 darwin 真机上真 spawn sandbox-exec，验证拼出的 SBPL profile 内核
 * 真受理——deny 行不只「看起来对」而且「真的拒」。非 darwin 跳过
 * （describe.skip——Linux 面的等价真跑锁挂账 bwrap 后端，随 Linux CI 节奏）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSeatbeltBackend } from './seatbelt.js';

const run = promisify(execFile);

/** darwin 门控（真机沙箱只在 macOS 在场） */
const d = process.platform === 'darwin' ? describe : describe.skip;

d('seatbelt 真跑（读 deny 两档执法——fail-closed 无豁免）', () => {
  /**
   * canonical fixture：敏感件与邻件同目录（deny 是逐件 literal 不是目录域——
   * 邻件照常读即「精确到 basename」的真机证明）。路径必须 realpath 化
   * （macOS /var → /private/var：literal deny 对别名 miss）。
   */
  function denyRig(): { dir: string; secret: string } {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sb-deny-')));
    const secret = join(dir, 'secret.key');
    writeFileSync(secret, 'k3y-material');
    writeFileSync(join(dir, 'notes.txt'), 'fine');
    return { dir, secret };
  }

  it('danger 档（最小读 deny profile）：cat 敏感件拒、邻件照常读', { timeout: 15_000 }, async () => {
    const { dir, secret } = denyRig();
    try {
      const backend = createSeatbeltBackend();
      // danger 形 = (allow default) + deny 行——无拒写无逐根 allow，读 deny 仍在
      const denied = backend.wrap(['/bin/cat', secret], {
        mode: 'danger',
        workspaceRoot: dir,
        denyReadFiles: [secret],
      });
      // 拒绝面：cat 打不开文件 → 非零退出 + stderr 命中后端拒绝签名（归因链）
      const err = await run(denied[0]!, denied.slice(1)).catch((e: Error & { code?: number }) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: number }).code).not.toBe(0);
      expect((err as { stderr?: string }).stderr ?? '').toMatch(/operation not permitted/i);
      // 邻件照常读（deny 精确到件——不殃及同目录）
      const allowed = backend.wrap(['/bin/cat', join(dir, 'notes.txt')], {
        mode: 'danger',
        workspaceRoot: dir,
        denyReadFiles: [secret],
      });
      const r = await run(allowed[0]!, allowed.slice(1));
      expect(r.stdout).toBe('fine');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('workspace-write 档（deny 行末位追加）：cat 敏感件同样拒', { timeout: 15_000 }, async () => {
    const { dir, secret } = denyRig();
    try {
      const backend = createSeatbeltBackend();
      const confined = backend.wrap(['/bin/cat', secret], {
        mode: 'workspace-write',
        workspaceRoot: dir,
        writableRoots: [dir],
        denyReadFiles: [secret],
      });
      const err = await run(confined[0]!, confined.slice(1)).catch((e: Error & { code?: number }) => e);
      expect((err as { code?: number }).code).not.toBe(0);
      expect((err as { stderr?: string }).stderr ?? '').toMatch(/operation not permitted/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

d('seatbelt 真跑（写 deny——04 §252 腿二 .git 版本史护栏）', () => {
  /** 真跑临时目录族（afterAll 清） */
  const rigDirs: string[] = [];
  afterAll(() => {
    for (const dir of rigDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('workspace-write 档 denyWritePaths：sh 重定向写 .git/config 拒、普通文件照常写', { timeout: 15_000 }, async () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sb-wdeny-')));
    rigDirs.push(dir);
    mkdirSync(join(dir, '.git'));
    const backend = createSeatbeltBackend();
    // deny 形（非豁免命令的策略面——腿二运行时兜底）
    const denied = backend.wrap(['/bin/sh', '-c', 'echo x > .git/config'], {
      mode: 'workspace-write',
      workspaceRoot: dir,
      writableRoots: [dir],
      denyWritePaths: [join(dir, '.git')],
    });
    const err = await run(denied[0]!, denied.slice(1), { cwd: dir }).catch((e: Error & { code?: number }) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: number }).code).not.toBe(0);
    expect((err as { stderr?: string }).stderr ?? '').toMatch(/operation not permitted|permission denied|read-only/i);
    // 对照组：同策略下写工作区普通文件成功（deny 精确到 .git 树）
    const allowed = backend.wrap(['/bin/sh', '-c', 'echo ok > plain.txt'], {
      mode: 'workspace-write',
      workspaceRoot: dir,
      writableRoots: [dir],
      denyWritePaths: [join(dir, '.git')],
    });
    const r = await run(allowed[0]!, allowed.slice(1), { cwd: dir });
    expect(r.stdout).toBe('');
  });

  it('worktree 真形：backing gitdir 入可写根后 git commit 成功、缺席则断链', { timeout: 60_000 }, async () => {
    // fixture：真 git 仓 + 首 commit + worktree（全在沙箱外准备）
    const repo = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sb-wt-repo-')));
    rigDirs.push(repo);
    const gitIdent = ['-c', 'user.email=t@t.test', '-c', 'user.name=t'];
    await run('git', ['init', '--initial-branch=main', repo]);
    await run('git', [...gitIdent, 'commit', '--allow-empty', '-m', 'init'], { cwd: repo });
    const wt = join(repo, 'wt-a');
    await run('git', ['worktree', 'add', wt], { cwd: repo });
    // 授予面 = 主仓 common git dir（对象库/refs 共享落点 + backing 均其子路径）
    const common = join(repo, '.git');

    const backend = createSeatbeltBackend();
    const commitArgv = (root: readonly string[]): readonly string[] =>
      backend.wrap(['git', ...gitIdent, 'commit', '--allow-empty', '-m', 'second'], {
        mode: 'workspace-write',
        workspaceRoot: wt,
        writableRoots: [...root],
      });
    // 授予形（worktreeGitDir 的落点）：workspace 根 + common dir 均可写 → commit 成功
    const ok = await run(commitArgv([wt, common])[0]!, commitArgv([wt, common]).slice(1), { cwd: wt });
    expect(ok.stdout).toMatch(/wt-a/);
    // 对照：无 common dir 可写根 → git 元数据/对象写落工作区外 → 断链失败（真缺陷的机器证明）
    const err = await run(commitArgv([wt])[0]!, commitArgv([wt]).slice(1), { cwd: wt }).catch(
      (e: Error & { code?: number }) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: number }).code).not.toBe(0);
    expect((err as { stderr?: string }).stderr ?? '').toMatch(
      /operation not permitted|permission denied|read-only|unable to create/i,
    );
  });
});
