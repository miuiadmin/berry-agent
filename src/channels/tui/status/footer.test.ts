/**
 * footer git 短支名读取件单测（07 §4.1 挂账解挂批②）——真实临时目录直读。
 *
 * 锁直读面全形：常规库支名 / cwd 子目录向上逐级 / detached 40hex 缺席 /
 * 非 git 目录 / HEAD 缺席 / 畸形 HEAD / worktree `.git` 文件指针（绝对 +
 * 相对两形）/ 后缀拼段三态（cwdPath 缺席 · 支名缺席 · 命中）。
 * 后缀形与消费位（TuiBackend.refreshFooter 拼段）分立——本件只锁读取与
 * 拼段纯函数，装配收敛锚（切焦/resize）在 tui-backend.test.ts。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGitBranch, withGitBranchSuffix } from './footer.js';

/** 测试期临时目录登记（afterEach 统一清——不留垃圾） */
const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 临时目录登记 + 返回路径 */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'berry-footer-test-'));
  temps.push(dir);
  return dir;
}

/** 造常规库：.git 目录 + HEAD 内容定值 */
function makeRepo(head: string): string {
  const root = tempDir();
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), `${head}\n`);
  return root;
}

const ref = (branch: string): string => `ref: refs/heads/${branch}`;

describe('readGitBranch 直读 .git/HEAD', () => {
  it('常规库：ref 形取支名（含斜线分支名）', () => {
    const root = makeRepo(ref('feature/tui-face'));
    expect(readGitBranch(root)).toBe('feature/tui-face');
  });

  it('cwd 子目录：向上逐级定位 .git（父级库命中）', () => {
    const root = makeRepo(ref('dev'));
    const sub = join(root, 'a', 'b', 'c');
    mkdirSync(sub, { recursive: true });
    expect(readGitBranch(sub)).toBe('dev');
  });

  it('detached HEAD（40hex 直指）：缺席不虚报', () => {
    const root = makeRepo('0123456789abcdef0123456789abcdef01234567');
    expect(readGitBranch(root)).toBeNull();
  });

  it('非 git 目录（到根无 .git）：缺席', () => {
    expect(readGitBranch(tempDir())).toBeNull();
  });

  it('HEAD 文件缺席：缺席（库形在而 HEAD 不可读）', () => {
    const root = tempDir();
    mkdirSync(join(root, '.git'), { recursive: true });
    expect(readGitBranch(root)).toBeNull();
  });

  it('畸形 HEAD（非 ref 非 hex）：缺席不虚报', () => {
    const root = makeRepo('not-a-ref-and-not-a-sha');
    expect(readGitBranch(root)).toBeNull();
  });

  it('worktree 形：.git 文件 gitdir 绝对指针 → 解真目录直读 HEAD', () => {
    // 主库（HEAD 真身）+ 从库（.git 文件指针指主库 git 目录）
    const main = makeRepo(ref('worktree-wip'));
    const wt = tempDir();
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git')}\n`);
    expect(readGitBranch(wt)).toBe('worktree-wip');
  });

  it('worktree 形：相对指针对 worktree 根解析', () => {
    // 布局：main/.git（真身）+ wt/.git 文件内容 `gitdir: ../main/.git`
    const main = makeRepo(ref('rel-ptr'));
    const parent = tempDir();
    const wt = join(parent, 'wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), 'gitdir: ../main/.git\n');
    // 相对形以 .git 文件所在目录（worktree 根）解析——main 须在 parent 下
    mkdirSync(join(parent, 'main'), { recursive: true });
    // 把真 git 目录搬进 parent/main/.git（重造真身——上面 makeRepo 的 main 在别处）
    mkdirSync(join(parent, 'main', '.git'), { recursive: true });
    writeFileSync(join(parent, 'main', '.git', 'HEAD'), `${ref('rel-ptr')}\n`);
    void main; // makeRepo 仅用于占位（其 HEAD 不被读——相对指针解析到 parent/main/.git）
    expect(readGitBranch(wt)).toBe('rel-ptr');
  });

  it('畸形 .git 文件（无 gitdir 行）：缺席', () => {
    const root = tempDir();
    writeFileSync(join(root, '.git'), 'garbage\n');
    expect(readGitBranch(root)).toBeNull();
  });
});

describe('withGitBranchSuffix cwd 段后缀拼段', () => {
  it('cwdPath 缺席：标签原样（零后缀零扰动）', () => {
    expect(withGitBranchSuffix('proj', undefined)).toBe('proj');
  });

  it('支名命中：`<标签> ⎇ <支>`（同段一体）', () => {
    const root = makeRepo(ref('main'));
    expect(withGitBranchSuffix('proj', root)).toBe('proj ⎇ main');
  });

  it('支名缺席（detached/非库）：标签原样不虚报', () => {
    expect(withGitBranchSuffix('proj', tempDir())).toBe('proj');
  });
});
