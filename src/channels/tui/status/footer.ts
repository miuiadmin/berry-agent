/**
 * footer git 短支名读取件（07 §4.1 挂账解挂批②）——cwd 短名段 git 支名后缀。
 *
 * - 直读 `.git/HEAD` 零子进程：`ref: refs/heads/<支>` 取支名；worktree 形
 *   `.git` 文件随 `gitdir:` 指针解真目录同律直读（相对指针对 worktree 根
 *   解析）；`.git` 定位 = cwd 起向上逐级、缺席即非库；
 * - detached HEAD（40hex 直接 commit 指向）与一切缺席/畸形 → null（后缀
 *   缺席不虚报）；
 * - 刷新锚 = footer 重算既有路（切焦联动 onRepaint + resize 全量重画），
 *   每调现读——不 watch 不轮询（checkout 后随下一次重算收敛）。
 *
 * 本件纯读零缓存零 IO 面外溢；消费位 = TuiBackend.refreshFooter（构造期
 * cwdPath 定值与 cwdLabel 同生命周期——跨焦 cwd 漂移同 R6 定值类）。
 */
import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

/** cwd 段支名后缀分隔形（落码定值：⎇ 支名惯用符 + 两侧空格；不用 ` · `——防与 footer 段间分隔混淆） */
const BRANCH_SUFFIX_SEPARATOR = ' ⎇ ';

/** HEAD 支名行形 `ref: refs/heads/<支>`（锚多行文件首见行——m 旗使 $ 匹配行尾前换行） */
const HEAD_REF_PATTERN = /^ref:\s*refs\/heads\/(\S+)$/m;

/** `.git` 文件形指针行 `gitdir: <路径>`（worktree / submodule 形——m 旗使 $ 匹配行尾前换行） */
const GITDIR_POINTER_PATTERN = /^gitdir:\s*(.+)$/m;

/**
 * 读 cwd 所在 git 库的当前支名：命中 `ref: refs/heads/<支>` 返支名；
 * detached（40hex 直指）/ 非库 / HEAD 缺席 / 畸形一律返 null（缺席不虚报）。
 */
export function readGitBranch(cwdPath: string): string | null {
  let dir = path.resolve(cwdPath);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    // .git 三形探测：目录（常规库）/ 文件（worktree 指针）/ 缺席（向上逐级）
    let kind: 'dir' | 'file' | 'absent' = 'absent';
    try {
      const stat = statSync(dotGit);
      if (stat.isDirectory()) kind = 'dir';
      else if (stat.isFile()) kind = 'file';
    } catch {
      kind = 'absent'; // 缺席——继续向上
    }
    if (kind === 'dir') {
      return readHeadBranch(path.join(dotGit, 'HEAD'));
    }
    if (kind === 'file') {
      // worktree 形：指针解真 git 目录后同律直读 HEAD
      const gitdir = readGitdirPointer(dotGit, dir);
      return gitdir !== null ? readHeadBranch(path.join(gitdir, 'HEAD')) : null;
    }
    // 向上逐级：到根缺席即非 git 目录
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** cwd 短名段拼支名后缀（同段一体非第四段）：cwdPath 缺席或支名缺席 = 原样 */
export function withGitBranchSuffix(cwdLabel: string, cwdPath: string | undefined): string {
  if (cwdPath === undefined) return cwdLabel;
  const branch = readGitBranch(cwdPath);
  return branch === null ? cwdLabel : `${cwdLabel}${BRANCH_SUFFIX_SEPARATOR}${branch}`;
}

/** 直读 HEAD 取支名：非 `ref:` 形（detached 40hex / 畸形 / 不可读）→ null */
function readHeadBranch(headPath: string): string | null {
  let head: string;
  try {
    head = readFileSync(headPath, 'utf8');
  } catch {
    return null; // HEAD 缺席/不可读——诚实缺席
  }
  const match = HEAD_REF_PATTERN.exec(head);
  return match !== null ? match[1]! : null;
}

/** `.git` 文件指针解析：`gitdir: <路径>`（相对形对 worktree 根解析、绝对形直通）；缺席/畸形/不可读 → null */
function readGitdirPointer(dotGitFile: string, worktreeRoot: string): string | null {
  let content: string;
  try {
    content = readFileSync(dotGitFile, 'utf8');
  } catch {
    return null;
  }
  const match = GITDIR_POINTER_PATTERN.exec(content);
  if (match === null) return null;
  return path.resolve(worktreeRoot, match[1]!.trim());
}
