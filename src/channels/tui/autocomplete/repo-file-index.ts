/**
 * 全库文件索引器（07 §4.1 @ 文件全库模糊腿批——挖掘 36 轮，codex file_search 对标）。
 *
 * 两腿：
 * - **fd 腿**：`BERRY_AGENT_FD_PATH` 指定 fd 可执行绝对路径在场时行走经 fd 子进程
 *   （`--print0` 收割、旗标面对齐内建三律——`--hidden` 收隐藏文件 / `--exclude`
 *   node_modules / .git / .gitignore 常量剪枝钉位〔忽略机元数据不入 @ 条目
 *   池，两腿同构〕/ 缺省尊重 .gitignore / 缺省不跟随符号链）；
 *   缺席 / spawn 失败 / 非零退出 / 行走悬挂触帽（FD_WALK_TIMEOUT_MS——
 *   帽点降级内建）一律降级内建（补全失败不呈报律——不呈报不打断输入）。
 * - **内建腿**：04 篇遍历语义**第四副本**（同笔同判——gitignore 逐目录前缀化 +
 *   `node_modules`/`.git` 常量剪枝 + 符号链不跟随；判据账册 06 §11.1 / 05 §5.3
 *   同笔四副本）。收集面仅常规文件（补全定位用途——目录经段导航腿可达）。
 *
 * 行走 = **BFS 层序**（非检索族 DFS 先序）：文件产出序天然 = 深度浅先 + 同深
 * 字典序——超帽即停时帽内恰为全序前缀（DFS 先序跨兄弟子树非严格浅先，截断
 * 头会漂移，故层序）。fd 腿输出经同款比较器归一化（段数，localeCompare）。
 *
 * 缓存与在途：per-root TTL 缓存 + 在途承诺共享——并发同根共享同一在途 Promise
 * （恒生效）；TTL 只辖已结算复用（ttlMs=0 每查重走、并发仍共享）。共享行走
 * **不随单请求 abort 中断**（AbortSignal 三律的射界 = 交付错序丢弃律——行走
 * 本体帽界内一次性完成，signal 由源面收下不用于中断）。
 */
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import ignore from 'ignore';

/** 行走条目帽缺省（07 词条落码定值——码面单源常量、规范不收数字） */
export const REPO_INDEX_FILE_CAP = 20000;

/** per-root 缓存 TTL 缺省 ms（同上——码面单源） */
export const REPO_INDEX_TTL_MS = 30000;

/**
 * fd 腿行走帽缺省（ms）——fd `--max-results` 有界收割本地快，10s = 慢机
 * 余量；帽点 = 降级非错误（settle(null) → 内建行走，与 spawn 失败同语义
 * ——补全失败不呈报律）。
 */
export const FD_WALK_TIMEOUT_MS = 10_000;

/** 常量剪枝目录（无论 .gitignore 写没写——04 篇遍历语义） */
const PRUNE_DIRS = new Set(['node_modules', '.git']);

/** 常量剪枝文件（忽略机元数据——不入 @ 条目池；fd 腿 --exclude .gitignore 同构） */
const PRUNE_FILES = new Set(['.gitignore']);

/** 索引快照（行走产物——files = posix 相对路径确定性序；truncated = 行走帽截断位） */
export interface RepoFileIndexSnapshot {
  readonly files: readonly string[];
  readonly truncated: boolean;
}

/** 索引器构造选项（全可选——缺省值码面单源常量） */
export interface RepoFileIndexOptions {
  /** fd 可执行绝对路径（缺席 = 纯内建行走；非绝对路径判读为缺席） */
  readonly fdPath?: string;
  /** 行走条目帽（缺省 REPO_INDEX_FILE_CAP——超帽停走置 truncated） */
  readonly fileCap?: number;
  /** per-root 缓存 TTL ms（缺省 REPO_INDEX_TTL_MS；0 = 每查重走——测试形） */
  readonly ttlMs?: number;
  /** fd 腿行走帽 ms（缺省 FD_WALK_TIMEOUT_MS——测试注入缩帽形） */
  readonly fdWalkTimeoutMs?: number;
  /** 时钟注入（缺省 Date.now——TTL 测试可控） */
  readonly now?: () => number;
}

/**
 * env 判读单源：`BERRY_AGENT_FD_PATH` 为绝对路径才生效（相对路径 / 空串 / 缺席
 * → undefined）。调时判读非 import 时绑定（env 变更即时生效）。
 */
export function resolveFdPath(env: Record<string, string | undefined>): string | undefined {
  const value = env['BERRY_AGENT_FD_PATH'];
  return value !== undefined && value !== '' && isAbsolute(value) ? value : undefined;
}

/** 平台分隔符归一（posix 相对路径是索引面的唯一形——win 非支持面，防御归一） */
function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** 统一序比较器：路径深度浅者先、同深字典序（确定性——两腿同归一化单源） */
function compareRepoPaths(a: string, b: string): number {
  const depth = a.split('/').length - b.split('/').length;
  if (depth !== 0) return depth;
  return a.localeCompare(b);
}

/**
 * 单行 gitignore 模式前缀化（06 篇 §11.1 锚定判据——第四副本，镜像
 * tools/search.ts / skills/discovery.ts / checkpoint 行走同笔同判）：注释/空行
 * 丢弃；`!` 否定保留；`\!`/`\#` 转义形整义传递（剥 `\!` 整两字符记忆、判毕
 * 原样回投——剥壳后裸 `!` 随前缀化重投 ignore 包会被解析为否定锚：根层形
 * 整义反转 + 对忽略族成否定连坐解除忽略）。锚定判据：模式体（去尾随目录标
 * 记斜杠）含斜杠或带前导 `/` = 相对路径锚定本层精确匹配；纯 basename 模式 =
 * 所在目录子树任意深度 basename 匹配（前缀化插 `**`＋`/` 双段保本层与深层
 * 同配）。
 */
function prefixIgnorePattern(line: string, prefix: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null;

  let pattern = line;
  let negated = false;
  let bangEscaped = false;
  if (pattern.startsWith('!')) {
    negated = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!')) {
    // 剥壳记忆转义形（剥 `\!` 整两字符——勿剥一个留裸 `!`，裸投会被解析为
    // 否定锚）；判毕整义重注入（见下）
    bangEscaped = true;
    pattern = pattern.slice(2);
  }
  // 前导 / = 显式锚定标记（先记下再去掉；锚定形相对本目录精确匹配）
  const rooted = pattern.startsWith('/');
  if (rooted) pattern = pattern.slice(1);
  // 转义整义重投：剥壳只为本层判定，判毕转义形原样回投。根层前导 / 无条件
  // 回补（git 语义：前导 / = 锚定根层标记）；嵌套层前缀本身已携定位斜杠
  // （`sub/`），非转义锚定直拼即可（sub/exact.txt），**转义根锚定才在 \! 后
  // 回补斜杠**（sub/\!/deep.txt——ignore 包对 \! 先于 / 的形可析且与 git
  // check-ignore 真语义一致：忽略路径 sub/!/deep.txt = ! 目录下文件）
  const esc = bangEscaped ? '\\!' : '';
  const rootedLead = rooted ? '/' : '';
  if (!prefix) {
    // 根 .gitignore 锚定形保留前导 /（git 语义：剥掉透传会把锚定降级成任意层匹配）
    const passed = `${esc}${rootedLead}${pattern}`;
    return negated ? `!${passed}` : passed;
  }
  const body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  const anchored = rooted || body.includes('/');
  // escapedLead = 转义根锚定才回补斜杠（非转义锚定再补会造 sub//x 双斜杠失配形）
  const escapedLead = bangEscaped && rooted ? '/' : '';
  const prefixed = anchored ? `${prefix}${esc}${escapedLead}${pattern}` : `${prefix}**/${esc}${pattern}`;
  return negated ? `!${prefixed}` : prefixed;
}

/**
 * 读取 dir 下 .gitignore 并把模式按所在目录前缀化挂上匹配器（嵌套规则只作用
 * 于其所在目录子树——BFS 层序保证祖先目录先处理、规则先挂）。文件不存在/
 * 读失败静默跳过。
 */
async function addIgnoreRules(matcher: ReturnType<typeof ignore>, dir: string, rootDir: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(join(dir, '.gitignore'), 'utf8');
  } catch {
    return; // 无 .gitignore 或读失败（权限等）——本目录无额外规则
  }
  const prefix = toPosix(relative(rootDir, dir));
  const prefixed = prefix ? `${prefix}/` : '';
  const patterns = content
    .split(/\r?\n/)
    .map((line) => prefixIgnorePattern(line, prefixed))
    .filter((line): line is string => line !== null);
  if (patterns.length > 0) matcher.add(patterns);
}

/**
 * 内建行走（BFS 层序）：枚举 root 子树全部常规文件的 posix 相对路径（序 =
 * 深度浅先 + 同深字典序，确定性）。帽 = cap+1 探针（多收一枚作截断侦测——恰
 * 满帽不置 truncated）；根不可读 → 空集（源在场条目空透传，非失败）。
 */
async function walkBuiltin(root: string, cap: number): Promise<RepoFileIndexSnapshot> {
  const matcher = ignore();
  const files: string[] = [];
  let truncated = false;
  // BFS 层序队列（头指针消费免 shift O(n²)）：浅层目录先出——同层目录按父路径
  // 字典序入队，文件产出序天然即统一序；超帽即停时帽内恰为全序前缀
  const queue: string[] = [root];
  let head = 0;
  while (head < queue.length) {
    const dir = queue[head++]!;
    await addIgnoreRules(matcher, dir, root);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 目录读失败（权限/竞态消失）——跳过本目录继续其余子树
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.isDirectory()) {
        if (PRUNE_DIRS.has(entry.name)) continue;
        // 根目录层 relative 为空串——不得拼出前导 /（ignore 包要求纯相对路径）
        const dirPrefix = toPosix(relative(root, dir));
        const rel = dirPrefix ? `${dirPrefix}/${entry.name}` : entry.name;
        // 目录双测（带/不带尾斜杠）：兼容 `dir/` 与 `dir` 两种规则写法
        if (matcher.ignores(rel) || matcher.ignores(`${rel}/`)) continue;
        queue.push(join(dir, entry.name));
      } else if (entry.isFile()) {
        // 仅常规文件（Dirent.isFile 对符号链返回 false——不跟随不入索引）；
        // .gitignore 常量剪枝（忽略机元数据）
        if (PRUNE_FILES.has(entry.name)) continue;
        const rel = toPosix(relative(root, join(dir, entry.name)));
        if (matcher.ignores(rel)) continue;
        files.push(rel);
        if (files.length > cap) {
          truncated = true; // 超 cap+1 探针——帽外还有文件
          break;
        }
      }
    }
    if (truncated) break;
  }
  return { files: files.slice(0, cap).sort(compareRepoPaths), truncated };
}

/**
 * fd 输出归一化：去 `./` 前缀、绝对位转 root 相对、去空段与越根外条目（`..`
 * 起）、去重；统一序排序（与内建腿同比较器——两腿确定性同构）。
 */
function normalizeFdLines(lines: readonly string[], root: string): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    let rel = line;
    if (rel.startsWith('./')) rel = rel.slice(2);
    if (isAbsolute(rel)) rel = toPosix(relative(root, rel));
    if (rel === '' || rel.startsWith('..')) continue;
    seen.add(rel);
  }
  return [...seen].sort(compareRepoPaths);
}

/**
 * 全库文件索引器：fd 腿（用户 env 指定二进制、失败降级）+ 内建腿（遍历语义
 * 第四副本）+ per-root TTL 缓存与在途承诺共享。
 */
export class RepoFileIndex {
  private readonly fdPathOverride: string | undefined;
  private readonly fileCap: number;
  private readonly ttlMs: number;
  private readonly fdWalkTimeoutMs: number;
  private readonly now: () => number;
  /** per-root 缓存（在途条目无 settledAt；结算后带 settledAt 供 TTL 判读） */
  private readonly cache = new Map<string, { settledAt?: number; promise: Promise<RepoFileIndexSnapshot> }>();

  constructor(options?: RepoFileIndexOptions) {
    this.fdPathOverride = options?.fdPath;
    this.fileCap = options?.fileCap ?? REPO_INDEX_FILE_CAP;
    this.ttlMs = options?.ttlMs ?? REPO_INDEX_TTL_MS;
    this.fdWalkTimeoutMs = options?.fdWalkTimeoutMs ?? FD_WALK_TIMEOUT_MS;
    this.now = options?.now ?? Date.now;
  }

  /**
   * 取（或建）root 索引——并发同根共享同一在途 Promise（恒生效）；已结算且
   * TTL 窗内直接复用（ttlMs=0 每查重走）。行走不随单请求 abort 中断。
   */
  snapshot(root: string): Promise<RepoFileIndexSnapshot> {
    const key = resolve(root);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      if (cached.settledAt === undefined) return cached.promise; // 在途承诺共享
      if (this.ttlMs > 0 && this.now() - cached.settledAt < this.ttlMs) return cached.promise; // TTL 窗内复用
    }
    const promise = this.build(key);
    this.cache.set(key, { promise });
    // 结算落时刻（TTL 判据位）；防御位：build 意外拒绝即逐出（不毒化后续查询）
    void promise.then(
      (snap) => {
        this.cache.set(key, { settledAt: this.now(), promise });
        return snap;
      },
      () => {
        this.cache.delete(key);
      },
    );
    return promise;
  }

  /** fd 路径裁定：注入位优先（非绝对判缺席）；注入缺席时 env 调时判读 */
  private effectiveFdPath(): string | undefined {
    if (this.fdPathOverride !== undefined) {
      return isAbsolute(this.fdPathOverride) ? this.fdPathOverride : undefined;
    }
    return resolveFdPath(process.env);
  }

  private async build(root: string): Promise<RepoFileIndexSnapshot> {
    const fdPath = this.effectiveFdPath();
    if (fdPath !== undefined) {
      const lines = await this.fdWalk(fdPath, root);
      if (lines !== null) {
        const files = normalizeFdLines(lines, root);
        return { files: files.slice(0, this.fileCap), truncated: files.length > this.fileCap };
      }
      // fd 失败（spawn 失败 / 非零退出）——降级内建行走
    }
    return walkBuiltin(root, this.fileCap);
  }

  /**
   * fd 子进程收割：`--max-results cap+1` 探针同截断侦测语义。null = 失败
   * （spawn 失败 / 非零退出 / 行走悬挂触帽）——调用方降级内建。
   */
  private fdWalk(fdPath: string, root: string): Promise<readonly string[] | null> {
    return new Promise((settle) => {
      const child = spawn(fdPath, [
        '--type',
        'f',
        '--hidden',
        '--exclude',
        'node_modules',
        '--exclude',
        '.git',
        '--exclude',
        '.gitignore',
        '--print0',
        '--max-results',
        String(this.fileCap + 1),
        root,
      ]);
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      // 悬挂帽：子进程悬挂（stdout 永不 close——僵死 fd/管道塞死形）时
      // in-flight promise 共享位（snapshot 同根共享）将永久死面；到点
      // SIGKILL 击杀（SIGTERM 可被僵死子进程忽略——tools/spawn-sync-cap.mjs
      // 头注同理由）+ settle(null) 降级内建行走（帽点 = 降级位非错误位）。
      // Promise 单射 absorbs 双 settle：error/close 先到则 clearTimeout 撤
      // 帽，帽先到则后至的 close（击杀产物）自然落空。
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(null);
      }, this.fdWalkTimeoutMs);
      // spawn 失败（不在场/不可执行）与 close 双 settle 由 Promise 单射吸收
      child.on('error', () => {
        clearTimeout(timer);
        settle(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          settle(null); // 非零退出——降级
          return;
        }
        settle(
          Buffer.concat(chunks)
            .toString('utf8')
            .split('\0')
            .filter((line) => line !== ''),
        );
      });
    });
  }
}

/** 模块级共享实例（懒铸——TUI 与 webui 两装配位同进程共享 per-root 缓存；测试注入替代位） */
let shared: RepoFileIndex | undefined;

/** 取模块级共享索引器（懒铸单例） */
export function sharedRepoFileIndex(): RepoFileIndex {
  shared ??= new RepoFileIndex();
  return shared;
}
