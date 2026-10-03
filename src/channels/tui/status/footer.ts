/**
 * footer git 支名/短哈希读取件（07 §4.1 挂账解挂批② + 界面美化役批6 短哈希
 * 扩）——cwd 短名段 git 后缀的数据面。
 *
 * - 直读 `.git/HEAD` 零子进程：`ref: refs/heads/<支>` 取支名 + **二跳读
 *   `refs/heads/<支>` 前 7 位短哈希**（界面美化役批6：`readGitShortHead`
 *   形——段序翻档「目录⎇支名@短哈希」的数据腿）；worktree 形 `.git` 文件
 *   随 `gitdir:` 指针解真目录同律直读（相对指针对 worktree 根解析）；
 *   `.git` 定位 = cwd 起向上逐级、缺席即非库；
 * - detached HEAD（40hex 直接 commit 指向）**已含哈希**——HEAD 内容前 7
 *   位即短哈希（支名缺席形 `⎇ abc1234`）；一切缺席/畸形 → null（后缀
 *   缩位不虚报）；
 * - 刷新锚 = ⎇ 槽 git 读盘独立低频锚（V-4 注⑪③ 拆分后归
 *   TuiBackend.refreshFooterGit，07 注⑪③ 追注定形三枚）：构造期 + onRepaint
 *   切焦联动 + 会话复起 resumeMain 三锚（复起重画路不触发 onRepaint——挂起
 *   期 checkout 换支须复起锚收敛）——
 *   不进 setStatus/agent_end/resize 高频锚（07 §4.1「避 resize 高频读盘」
 *   承界面美化役定值；resize 走缓存变体不重读），每锚现读——不 watch 不
 *   轮询（checkout 后随下一锚收敛）。
 *
 * 本件纯读零缓存零 IO 面外溢；消费位 = TuiBackend.refreshFooterGit
 * （footer.gitRoot 闭包注入形——cwdPath 定值字段已随闭包化取代；跨焦 cwd
 * 漂移随 onRepaint 锚重拉）。
 */
import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

/** cwd 段 git 后缀分隔形（落码定值：⎇ 支名惯用符 + 两侧空格；不用 ` · `——防与 footer 段间分隔混淆） */
const BRANCH_SUFFIX_SEPARATOR = ' ⎇ ';

/** 短哈希前缀 @ 记形（界面美化役批6——`⎇ 支名 @abc1234` 定形） */
const HASH_PREFIX = ' @';

/** 短哈希取宽（前 7 位——07 §4.1 定值） */
const SHORT_HASH_LENGTH = 7;

/** HEAD 支名行形 `ref: refs/heads/<支>`（锚多行文件首见行——m 旗使 $ 匹配行尾前换行） */
const HEAD_REF_PATTERN = /^ref:\s*refs\/heads\/(\S+)$/m;

/** `.git` 文件形指针行 `gitdir: <路径>`（worktree / submodule 形——m 旗使 $ 匹配行尾前换行） */
const GITDIR_POINTER_PATTERN = /^gitdir:\s*(.+)$/m;

/** 短哈希词形（3-40 位 hex——detached 直取与 refs 二跳读共判；畸形不虚报） */
const HASH_WORD_PATTERN = /^[0-9a-f]{3,40}$/i;

/**
 * git 头部读取产物（一次遍历双取——界面美化役批6）：支名缺席（detached/
 * 畸形）+ 哈希在场 = `⎇ abc1234` 形；两者全缺席 = 非库/不可读（后缀整体
 * 缩位）。
 */
export interface GitHeadInfo {
  /** 当前支名（detached / 畸形 / 非库 → null） */
  readonly branch: string | null;
  /** 短哈希前 7 位（refs 二跳读 / detached 直取；缺席 → null） */
  readonly shortHash: string | null;
}

/**
 * 读 cwd 所在 git 库的头部信息（支名 + 短哈希一次遍历双取——界面美化役
 * 批6 `readGitShortHead` 形的件内单源）：命中 `ref: refs/heads/<支>` 返支名
 * 并二跳读 refs 文件取前 7 位；detached（40hex 直指）哈希直接取 HEAD 前
 * 7 位（支名 null）；非库 / HEAD 缺席 / 畸形 → 双 null（缺席不虚报）。
 */
export function readGitHead(cwdPath: string): GitHeadInfo {
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
      return parseHeadDir(path.join(dotGit, 'HEAD'), dotGit);
    }
    if (kind === 'file') {
      // worktree 形：指针解真 git 目录后同律直读 HEAD + refs（二跳读同根目录）
      const gitdir = readGitdirPointer(dotGit, dir);
      return gitdir !== null ? parseHeadDir(path.join(gitdir, 'HEAD'), gitdir) : { branch: null, shortHash: null };
    }
    // 向上逐级：到根缺席即非 git 目录
    const parent = path.dirname(dir);
    if (parent === dir) return { branch: null, shortHash: null };
    dir = parent;
  }
}

/**
 * 读 cwd 所在 git 库的当前支名：命中 `ref: refs/heads/<支>` 返支名；
 * detached（40hex 直指）/ 非库 / HEAD 缺席 / 畸形一律返 null（缺席不虚报）。
 * （readGitHead 的支名单取投影——既有消费面兼容位。）
 */
export function readGitBranch(cwdPath: string): string | null {
  return readGitHead(cwdPath).branch;
}

/**
 * 头部信息 → cwd 段后缀串（呈现单源——件内拼形与消费位分立）：
 * 支名 + 哈希 → ` ⎇ 支名 @abc1234`；仅支名（refs 文件缺席/畸形——如未产
 * 首提交的初生支）→ ` ⎇ 支名`；仅哈希（detached）→ ` ⎇ abc1234`；双缺席
 * → ''（后缀整体缩位）。
 */
export function gitHeadSuffix(info: GitHeadInfo): string {
  const branch = info.branch;
  const hash = info.shortHash;
  if (branch === null && hash === null) return '';
  if (branch === null) return `${BRANCH_SUFFIX_SEPARATOR}${hash}`;
  return hash === null
    ? `${BRANCH_SUFFIX_SEPARATOR}${branch}`
    : `${BRANCH_SUFFIX_SEPARATOR}${branch}${HASH_PREFIX}${hash}`;
}

/** cwd 短名段拼 git 后缀（同段一体非第四段）：cwdPath 缺席或双缺席 = 原样 */
export function withGitBranchSuffix(cwdLabel: string, cwdPath: string | undefined): string {
  if (cwdPath === undefined) return cwdLabel;
  return `${cwdLabel}${gitHeadSuffix(readGitHead(cwdPath))}`;
}

/**
 * git 目录头部解析（HEAD + refs 同根——worktree 形二跳读同目录）：ref 形
 * 取支名 + 读 `refs/heads/<支>` 前 7 位（文件缺席/畸形 → 哈希 null 诚实
 * 缩位）；非 ref 形（detached 40hex）哈希直取 HEAD 内容前 7 位。
 */
function parseHeadDir(headPath: string, gitDir: string): GitHeadInfo {
  let head: string;
  try {
    head = readFileSync(headPath, 'utf8');
  } catch {
    return { branch: null, shortHash: null }; // HEAD 缺席/不可读——诚实缺席
  }
  const match = HEAD_REF_PATTERN.exec(head);
  if (match !== null) {
    const branch = match[1]!;
    return { branch, shortHash: readShortHash(path.join(gitDir, 'refs', 'heads', ...branch.split('/'))) };
  }
  // 非 ref 形：detached 40hex 直指（哈希已在 HEAD 内容）——词形校验后取前 7 位；
  // 畸形（非 hex 非 ref）双 null 不虚报
  const direct = head.trim();
  return { branch: null, shortHash: shortHashOf(direct) };
}

/** refs 文件读短哈希（前 7 位——词形校验；缺席/畸形 → null） */
function readShortHash(refPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(refPath, 'utf8');
  } catch {
    return null; // refs 文件缺席（初生支未产首提交）——哈希诚实缩位
  }
  return shortHashOf(content.trim());
}

/** 短哈希词形判 + 取前 7 位（畸形 → null） */
function shortHashOf(word: string): string | null {
  return HASH_WORD_PATTERN.test(word) ? word.slice(0, SHORT_HASH_LENGTH) : null;
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
