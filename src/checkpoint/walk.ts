/**
 * checkpoint 工作区遍历（05 §5.3 批 15d——快照/回退的 walk 域定界）。
 *
 * 遍历语义与 skills 发现（discovery.ts）/检索族（tools/search.ts）三副本
 * 同笔同判（04 遍历语义条款）：尊重 .gitignore——逐目录读规则按所在目录
 * 前缀化挂匹配器（根 .gitignore 前导 / 保留——锚定语义不降级）；剪枝
 * node_modules/.git；**不跟随符号链**（Dirent.isDirectory 对符号链 false
 * ——目录链不入、文件链同样跳过：快照域不收间接层，恢复面才可精确对账）。
 *
 * 与技能面的遍历差异：技能面跟随符号链目录（realpath 去重防环）；本面
 * 不跟随——快照的诚实 = 只拍实文件域，间接层由所指文件自身入册。
 * 点文件（.env 等）入册：快照承诺的是工作区状态全恢复，非 git 索引面。
 *
 * 实现与 skills/discovery.ts 同语义独立成文（07 §2 词面独立律——三副本
 * 各自实现，判据漂移由回归测试锁）。
 */
import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ignore from 'ignore';
import { BaseError } from '../contracts/index.js';
import { CHECKPOINT_WALK_FILE_CAP } from './types.js';

/** gitignore 匹配器类型（ignore 包工厂返回值） */
type IgnoreMatcher = ReturnType<typeof ignore>;

/** 遍历常量剪枝（与 skills/检索族同表语义：依赖目录与 git 元数据） */
const PRUNE_DIRS = new Set(['node_modules', '.git']);

/** 平台路径分隔符归一为 /（gitignore 模式语义在 posix 路径上） */
function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/**
 * 单行 gitignore 模式前缀化（锚定判据——与 skills/检索族三副本同笔同判）。
 * 注释/空行丢弃；`!` 否定与 `\!`/`\#` 转义保留；模式体去尾随目录标记斜杠
 * 后含斜杠或带前导 / = 锚定本层精确匹配；纯 basename 模式前缀化插目录
 * 通配前缀（`**`+`/`）保深层同配。根 .gitignore 前导 / 保留（git 语义）。
 */
function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    pattern = pattern.slice(1);
  }
  const rooted = pattern.startsWith('/');
  if (rooted) pattern = pattern.slice(1);
  if (!prefix) {
    const passed = rooted ? `/${pattern}` : pattern;
    return negated ? `!${passed}` : passed;
  }
  const body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  const anchored = rooted || body.includes('/');
  const prefixed = anchored ? `${prefix}${pattern}` : `${prefix}**/${pattern}`;
  return negated ? `!${prefixed}` : prefixed;
}

/** 读 dir 下 .gitignore 并按所在目录前缀化挂上匹配器（嵌套规则只作用本子树） */
async function addIgnoreRules(matcher: IgnoreMatcher, dir: string, rootDir: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(join(dir, '.gitignore'), 'utf8');
  } catch {
    return; // 无 .gitignore 或读失败——本目录无额外规则
  }
  const prefix = toPosix(relative(rootDir, dir));
  const prefixed = prefix ? `${prefix}/` : '';
  const patterns = content
    .split(/\r?\n/)
    .map((line) => prefixIgnorePattern(line, prefixed))
    .filter((line): line is string => line !== null);
  if (patterns.length > 0) matcher.add(patterns);
}

/** 路径 gitignore 判定（目录双测带/不带尾斜杠——兼容 `dir/` 与 `dir` 两种写法） */
function ignoredPath(matcher: IgnoreMatcher, root: string, fullPath: string, isDir = false): boolean {
  const rel = toPosix(relative(root, fullPath));
  if (rel === '') return false; // 根自身不判
  return isDir ? matcher.ignores(rel) || matcher.ignores(`${rel}/`) : matcher.ignores(rel);
}

/** 遍历产物单条（path = workspace 相对 posix 形；absPath = 绝对路径） */
export interface WalkedFile {
  readonly path: string;
  readonly absPath: string;
}

/**
 * 枚举工作区 walk 域内全部实文件（确定性序：目录序 × 名称字典序——manifest
 * files 的稳定形态）。读文件内容与哈希不在本面（capture/preview 各自单遍
 * 读+哈希——避免「walk 读一遍、写 blob 再读一遍」的双读）。
 *
 * 非常规文件（FIFO/socket/device）静默跳过——快照域只收常规实文件；符号
 * 链（目录/文件两形）跳过。常规文件读失败（权限/竞态）抛
 * CHECKPOINT_CAPTURE_FAILED——fail-closed：读不了的文件进不了快照，
 * 放行变异即伪承诺。文件数超帽（缺省 CHECKPOINT_WALK_FILE_CAP）同码
 * fail-closed（防误指巨型目录炸快照）。
 */
export async function walkWorkspaceFiles(
  root: string,
  fileCap: number = CHECKPOINT_WALK_FILE_CAP,
): Promise<WalkedFile[]> {
  const files: WalkedFile[] = [];
  const absRoot = resolve(root);
  await walkDir(absRoot, absRoot, ignore(), files, fileCap);
  return files;
}

/** 实际递归（点目录入册、依赖目录剪枝、符号链不跟随、gitignore 逐目录挂规则） */
async function walkDir(
  dir: string,
  root: string,
  matcher: IgnoreMatcher,
  files: WalkedFile[],
  fileCap: number,
): Promise<void> {
  await addIgnoreRules(matcher, dir, root);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new BaseError(
      'CHECKPOINT_CAPTURE_FAILED',
      `[CHECKPOINT_CAPTURE_FAILED] 工作区目录读取失败：${dir}（${err instanceof Error ? err.message : String(err)}）`,
    );
  }

  // 名称字典序——确定性遍历序（manifest files 稳定形态的锚）
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of sorted) {
    // 符号链不跟随（目录/文件两形同判——Dirent 谓词对符号链恒 false）
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) continue; // 依赖目录与 git 元数据剪枝
      if (ignoredPath(matcher, root, fullPath, true)) continue;
      await walkDir(fullPath, root, matcher, files, fileCap);
      continue;
    }
    if (!entry.isFile()) continue; // FIFO/socket/device 等——非常规文件不入快照域
    if (ignoredPath(matcher, root, fullPath)) continue;
    if (files.length >= fileCap) {
      throw new BaseError(
        'CHECKPOINT_CAPTURE_FAILED',
        `[CHECKPOINT_CAPTURE_FAILED] 工作区文件数超快照帽（>${fileCap}，根 ${root}）——疑似误指巨型目录，fail-closed 拒拍。`,
      );
    }
    files.push({ path: toPosix(relative(root, fullPath)), absPath: fullPath });
  }
}

/** 读单文件字节（读失败折 CHECKPOINT_CAPTURE_FAILED——fail-closed） */
export async function readWorkspaceFile(absPath: string): Promise<Buffer> {
  try {
    return await readFile(absPath);
  } catch (err) {
    throw new BaseError(
      'CHECKPOINT_CAPTURE_FAILED',
      `[CHECKPOINT_CAPTURE_FAILED] 工作区文件读取失败：${absPath}（${err instanceof Error ? err.message : String(err)}）`,
    );
  }
}
