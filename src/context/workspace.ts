/**
 * canonical 工作区根原语（06 §「owner_key 与 canonical 工作区根」；02 §2.2
 * context 职责——共享原语宿主收编：memory owner_key / 技能信任判定 / 未来
 * project 域键三处同源，一处实现三处消费）。
 *
 * 解析律（06 §74 逐条）：
 *  - 从 cwd 向上找最近 `.git`；
 *  - worktree / submodule（`.git` 为文件）解析 `gitdir → commondir` 归并到
 *    主仓库根——同一仓库的主目录、worktree、任意子目录产生同一 project 键；
 *  - 非 git 目录回退字面 cwd；
 *  - submodule 的 modules gitdir 无 commondir，独立成域（submodule 本就是
 *    独立仓库）——canonical 根取 gitdir 实身；
 *  - 探测结果按 cwd 进程内缓存（同路径不重复打 fs；仓库移动属极端场景，
 *    重启自愈）；
 *  - 不读 GIT_* 宿主环境变量（03 篇配置总线禁令同向）。
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** 探测缓存（cwd → canonical 根；进程内单例——同路径不重复打 fs） */
const cache = new Map<string, string>();

/**
 * 解析 canonical 工作区根。
 * @param cwd 起点目录（缺省 process.cwd）；结果按 cwd 缓存
 * @returns canonical 根绝对路径（realpath 后的主仓库根 / gitdir 实身 / 字面 cwd 回退）
 */
export function canonicalWorkspaceRoot(cwd: string = process.cwd()): string {
  const cached = cache.get(cwd);
  if (cached !== undefined) return cached;
  const root = detect(cwd);
  cache.set(cwd, root);
  return root;
}

/** 清空探测缓存（测试用——生产面无清空路径） */
export function clearWorkspaceRootCache(): void {
  cache.clear();
}

/** 实际探测（无缓存路径） */
function detect(cwd: string): string {
  // 逐级上溯找最近 .git（含 cwd 自身；existsSync 对断链符号链返回 false——
  // statSync lstat 语义此处不需要，直接 existsSync 探测文件/目录均可）
  let dir: string | undefined = resolve(cwd);
  let gitPath: string | undefined;
  for (;;) {
    const candidate = join(dir, '.git');
    if (pathExists(candidate)) {
      gitPath = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // 到文件系统根仍未命中
    dir = parent;
  }
  if (!gitPath) {
    // 非 git 目录：回退字面 cwd（resolve 归一，不做 realpath——字面语义）
    return resolve(cwd);
  }
  const st = statSync(gitPath);
  if (st.isDirectory()) {
    // 普通仓库：.git 目录的父级即仓库根（realpath 消符号链）
    return realpathSync(dirname(gitPath));
  }
  // .git 是文件：worktree / submodule——解析 gitdir: 行
  const gitdir = parseGitdir(gitPath);
  if (!gitdir) {
    // 无法解析的 .git 文件（畸形）：退字面 cwd（宁可退也不炸探测）
    return resolve(cwd);
  }
  const commondirPath = join(gitdir, 'commondir');
  if (pathExists(commondirPath)) {
    // worktree：commondir 内容指向主 .git 目录（相对 commondirPath 所在目录或
    // 绝对路径）——归并到主仓库根（主目录/worktree/子目录同一键的兑现点）
    const content = readFileSync(commondirPath, 'utf8').trim();
    const mainGitDir = isAbsolute(content) ? content : resolve(dirname(commondirPath), content);
    return realpathSync(dirname(mainGitDir));
  }
  // submodule：modules gitdir 无 commondir——独立成域，gitdir 实身即根
  return realpathSync(gitdir);
}

/** .git 文件解析 gitdir: 行（无该行/读失败返回 undefined） */
function parseGitdir(gitFile: string): string | undefined {
  try {
    const content = readFileSync(gitFile, 'utf8');
    for (const line of content.split('\n')) {
      if (line.startsWith('gitdir:')) return line.slice('gitdir:'.length).trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 存在性探测（文件或目录均可；异常视同不存在——探测不炸） */
function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
