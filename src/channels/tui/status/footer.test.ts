/**
 * footer git 支名/短哈希读取件单测（07 §4.1 挂账解挂批② + 界面美化役批6
 * 短哈希扩）——真实临时目录直读。
 *
 * 锁直读面全形：常规库支名 / cwd 子目录向上逐级 / detached 40hex 短哈希
 * 直取 / 非 git 目录 / HEAD 缺席 / 畸形 HEAD / worktree `.git` 文件指针
 * （绝对 + 相对两形）/ refs 二跳读前 7 位短哈希 / 后缀拼段四态（cwdPath
 * 缺席 · 双缺席 · 仅支名 · 支名+哈希 / detached 仅哈希）。
 * 真实 worktree 管理目录形（commondir 归公共 gitdir 根）与 detached 64hex
 * （SHA-256 仓形）两腿随 alpha.30 二轮扫描处置批 lane-A 补锁。
 * 后缀形与消费位（TuiBackend.refreshFooter 拼段）分立——本件只锁读取与
 * 拼段纯函数，装配收敛锚（切焦/agent_end + resize 缓存律）在
 * tui-backend.test.ts。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitHeadSuffix, readGitBranch, readGitHead, withGitBranchSuffix } from './footer.js';

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

/** 造常规库：.git 目录 + HEAD 内容定值（refs/heads/<支> 文件可选在场） */
function makeRepo(head: string, refs?: Readonly<Record<string, string>>): string {
  const root = tempDir();
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), `${head}\n`);
  for (const [branch, sha] of Object.entries(refs ?? {})) {
    const refPath = join(root, '.git', 'refs', 'heads', ...branch.split('/'));
    mkdirSync(join(refPath, '..'), { recursive: true });
    writeFileSync(refPath, `${sha}\n`);
  }
  return root;
}

const ref = (branch: string): string => `ref: refs/heads/${branch}`;
const SHA = '0123456789abcdef0123456789abcdef01234567';

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

describe('readGitHead 短哈希二跳读（界面美化役批6）', () => {
  it('ref 形：支名 + refs/heads/<支> 前 7 位短哈希（含斜线分支名同律）', () => {
    const root = makeRepo(ref('feature/tui-face'), { 'feature/tui-face': SHA });
    expect(readGitHead(root)).toEqual({ branch: 'feature/tui-face', shortHash: '0123456' });
  });

  it('refs 文件缺席（初生支未产首提交）：支名在场哈希诚实缩位', () => {
    const root = makeRepo(ref('main'));
    expect(readGitHead(root)).toEqual({ branch: 'main', shortHash: null });
  });

  it('refs 文件畸形（非 hex）：哈希缩位不虚报', () => {
    const root = makeRepo(ref('main'), { main: 'not-a-sha' });
    expect(readGitHead(root)).toEqual({ branch: 'main', shortHash: null });
  });

  it('detached HEAD（40hex 直指）：哈希已含直取前 7 位、支名缺席', () => {
    const root = makeRepo(SHA);
    expect(readGitHead(root)).toEqual({ branch: null, shortHash: '0123456' });
  });

  it('worktree 形：refs 二跳读走 gitdir 指针解真目录（同根）', () => {
    // 主库（HEAD + refs 真身）+ 从库（.git 文件指针指主库 git 目录）
    const main = makeRepo(ref('worktree-wip'), { 'worktree-wip': SHA });
    const wt = tempDir();
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git')}\n`);
    expect(readGitHead(wt)).toEqual({ branch: 'worktree-wip', shortHash: '0123456' });
  });

  it('真实 worktree 管理目录形：commondir 指公共 gitdir——refs 二跳读不缺席（@短哈希在场）', () => {
    // 真实 worktree 布局（git 真身三件）：
    //   <main>/.git（公共 gitdir——refs 真身在此）+ <main>/.git/worktrees/<n>/
    //   管理目录（HEAD 为 ref 形 + commondir 文件指 ../..）+ <wt>/.git 文件
    //   指管理目录。分支 ref 不在管理目录——refs 二跳读须随 commondir 归公共根
    const main = tempDir();
    const gitDir = join(main, '.git');
    mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true });
    writeFileSync(join(gitDir, 'HEAD'), `${ref('main')}\n`);
    writeFileSync(join(gitDir, 'refs', 'heads', 'feat'), `${SHA}\n`);
    const admin = join(gitDir, 'worktrees', 'wt-1');
    mkdirSync(admin, { recursive: true });
    writeFileSync(join(admin, 'HEAD'), `${ref('feat')}\n`);
    writeFileSync(join(admin, 'commondir'), '../..\n');
    const wt = tempDir();
    writeFileSync(join(wt, '.git'), `gitdir: ${admin}\n`);
    expect(readGitHead(wt)).toEqual({ branch: 'feat', shortHash: '0123456' });
  });

  it('detached 64hex（SHA-256 仓形）：直取前 7 位（词形上界 64hex 覆）', () => {
    const SHA256 = '0123456789abcdef'.repeat(4); // 64 位 hex——SHA-256 仓 object id
    const root = makeRepo(SHA256);
    expect(readGitHead(root)).toEqual({ branch: null, shortHash: '0123456' });
  });

  it('非 git 目录 / HEAD 缺席：双 null（后缀整体缩位判据）', () => {
    expect(readGitHead(tempDir())).toEqual({ branch: null, shortHash: null });
    const root = tempDir();
    mkdirSync(join(root, '.git'), { recursive: true });
    expect(readGitHead(root)).toEqual({ branch: null, shortHash: null });
  });
});

describe('gitHeadSuffix 后缀四态（呈现单源）', () => {
  it('支名 + 哈希：` ⎇ 支名 @abc1234`（段序翻档定形）', () => {
    expect(gitHeadSuffix({ branch: 'dev', shortHash: 'abc1234' })).toBe(' ⎇ dev @abc1234');
  });

  it('仅支名（refs 缺席）：` ⎇ 支名`（哈希缩位不虚报）', () => {
    expect(gitHeadSuffix({ branch: 'dev', shortHash: null })).toBe(' ⎇ dev');
  });

  it('仅哈希（detached）：` ⎇ abc1234`（支名缺席形）', () => {
    expect(gitHeadSuffix({ branch: null, shortHash: 'abc1234' })).toBe(' ⎇ abc1234');
  });

  it('双缺席：空串（后缀整体缩位）', () => {
    expect(gitHeadSuffix({ branch: null, shortHash: null })).toBe('');
  });
});

describe('withGitBranchSuffix cwd 段后缀拼段', () => {
  it('cwdPath 缺席：标签原样（零后缀零扰动）', () => {
    expect(withGitBranchSuffix('proj', undefined)).toBe('proj');
  });

  it('支名 + 短哈希命中：`<标签> ⎇ <支> @<前 7 位>`（同段一体）', () => {
    const root = makeRepo(ref('main'), { main: SHA });
    expect(withGitBranchSuffix('proj', root)).toBe('proj ⎇ main @0123456');
  });

  it('支名命中 refs 缺席：`<标签> ⎇ <支>`（哈希缩位）', () => {
    const root = makeRepo(ref('main'));
    expect(withGitBranchSuffix('proj', root)).toBe('proj ⎇ main');
  });

  it('detached：`<标签> ⎇ <短哈希>`（支名缺席形）', () => {
    const root = makeRepo(SHA);
    expect(withGitBranchSuffix('proj', root)).toBe('proj ⎇ 0123456');
  });

  it('非 git 目录：标签原样不虚报（零 ⎇）', () => {
    expect(withGitBranchSuffix('proj', tempDir())).toBe('proj');
  });
});
