import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalWorkspaceRoot, clearWorkspaceRootCache } from './workspace.js';

/** 测试根（每用例临时建；git 结构手摆） */
let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
  clearWorkspaceRootCache(); // 探测缓存清面——用例间不串
});

/** 建临时工作区根目录 */
function makeRoot(): string {
  root = mkdtempSync(join(tmpdir(), 'ba-ws-'));
  return root;
}

/** 摆普通 git 仓库（.git 目录形态）并返回仓库根 */
function makeGitRepo(base: string): string {
  const repoRoot = join(base, 'repo');
  mkdirSync(join(repoRoot, '.git'), { recursive: true });
  return repoRoot;
}

describe('canonical 工作区根解析（06 §74 解析律）', () => {
  it('普通仓库：.git 目录的父级即根（realpath 消符号链）', () => {
    const base = makeRoot();
    const repoRoot = makeGitRepo(base);
    // 子目录深两层的启动——上溯归并到仓库根
    const deep = join(repoRoot, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(canonicalWorkspaceRoot(deep)).toBe(realpathOf(repoRoot));
  });

  it('同一仓库任意子目录产生同一键（防子目录启动裂库）', () => {
    const base = makeRoot();
    const repoRoot = makeGitRepo(base);
    const sub1 = join(repoRoot, 'pkg1');
    const sub2 = join(repoRoot, 'pkg2', 'deep');
    mkdirSync(sub1, { recursive: true });
    mkdirSync(sub2, { recursive: true });
    expect(canonicalWorkspaceRoot(sub1)).toBe(canonicalWorkspaceRoot(sub2));
  });

  it('worktree（.git 文件 → gitdir → commondir）归并到主仓库根', () => {
    const base = makeRoot();
    // 主仓
    const mainRoot = join(base, 'main');
    const mainGit = join(mainRoot, '.git');
    mkdirSync(mainGit, { recursive: true });
    // worktree 的 gitdir：<主 .git>/worktrees/wt/
    const wtGitdir = join(mainGit, 'worktrees', 'wt');
    mkdirSync(wtGitdir, { recursive: true });
    // commondir 内容 '../..'——相对 commondir 文件所在目录指主 .git
    writeFileSync(join(wtGitdir, 'commondir'), '../..');
    // worktree 工作目录：.git 文件指 gitdir
    const wtRoot = join(base, 'wt-checkout');
    mkdirSync(wtRoot, { recursive: true });
    writeFileSync(join(wtRoot, '.git'), `gitdir: ${wtGitdir}\n`);
    // 主目录与 worktree 同键
    expect(canonicalWorkspaceRoot(wtRoot)).toBe(realpathOf(mainRoot));
    expect(canonicalWorkspaceRoot(wtRoot)).toBe(canonicalWorkspaceRoot(mainRoot));
  });

  it('submodule（modules gitdir 无 commondir）独立成域', () => {
    const base = makeRoot();
    // 父仓 + modules gitdir（无 commondir 文件——submodule 形态）
    const parentRoot = join(base, 'parent');
    mkdirSync(join(parentRoot, '.git', 'modules', 'sub'), { recursive: true });
    const subGitdir = join(parentRoot, '.git', 'modules', 'sub');
    // submodule 工作目录：.git 文件指 modules gitdir
    const subRoot = join(base, 'sub-checkout');
    mkdirSync(subRoot, { recursive: true });
    writeFileSync(join(subRoot, '.git'), `gitdir: ${subGitdir}\n`);
    // 独立成域：submodule 根 = gitdir 实身，不等于父仓根
    expect(canonicalWorkspaceRoot(subRoot)).toBe(realpathOf(subGitdir));
    expect(canonicalWorkspaceRoot(subRoot)).not.toBe(canonicalWorkspaceRoot(parentRoot));
  });

  it('非 git 目录回退字面 cwd（resolve 归一）', () => {
    const base = makeRoot();
    const plain = join(base, 'plain', 'inner');
    mkdirSync(plain, { recursive: true });
    expect(canonicalWorkspaceRoot(plain)).toBe(plain);
  });

  it('符号链启动路径归并到真实根（realpath 语义）', () => {
    const base = makeRoot();
    const repoRoot = makeGitRepo(base);
    const link = join(base, 'repo-link');
    symlinkSync(repoRoot, link);
    expect(canonicalWorkspaceRoot(link)).toBe(realpathOf(repoRoot));
  });

  it('探测结果按 cwd 进程内缓存（同路径不重复打 fs）', () => {
    const base = makeRoot();
    const repoRoot = makeGitRepo(base);
    const first = canonicalWorkspaceRoot(repoRoot);
    // 缓存命中后即使 .git 被移走也返回缓存值（同路径不重复打 fs——仓库移动靠重启自愈）
    rmSync(join(repoRoot, '.git'), { recursive: true });
    expect(canonicalWorkspaceRoot(repoRoot)).toBe(first);
  });
});

/** realpath 辅助（测试断言用——与实现同源语义但独立调用） */
function realpathOf(p: string): string {
  return realpathSync(p);
}
