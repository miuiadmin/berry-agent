/**
 * worktree 工具族（04 §7 worktree 条——fs 族扩展，批 16）。
 *
 * 三动词封闭面（路径由工具派生、非模型任意指定——封闭动词面则）：
 * - create：`git worktree add -b <name> <派生路径> [baseRef]`——名字即分支名
 *   即目录段（三用同源），撞名（既存 worktree 目录 / 既存分支）拒
 *   `FS_WORKTREE_EXISTS`；
 * - list：`git worktree list --porcelain` 枚举（只读、不登记观察态——ls 同判）；
 * - clean：`git worktree remove`——遇未提交变更拒 `FS_WORKTREE_DIRTY`（防误清，
 *   宁拒勿删），`force: true` 显式覆盖；**不删分支**（留史——交付物引用）。
 *
 * 派生路径形：仓同级 `<repo 目录名>-worktrees/<name>`（worktree 不落仓内——
 * 避免被仓自身遍历/快照误纳）。
 *
 * 树级写互斥（04 §7 补钉③）：create/clean 以 worktree 根 canonical 路径入
 * 写串行链（serializeTreeWrites）——树操作在飞时其域内文件写（serializeWrites）
 * 排队其后，防 clean 拆掉他方正在写的根；两向握手见 fs.ts。
 *
 * 会话可写根授予（04 §7 补钉①）：create 成功即自动将产物 canonical 路径记入
 * 该会话的授予集（fence 组合归装配——writableRoots provider 并入
 * grantedRoots(sessionId)；数据目录 carve-out 在 safety 面恒优先，本件不管
 * fence 执法只记账）；releaseSession 随会话关闭 / Job 终态回收。
 *
 * git 元数据白名单（04 §8 桥条款——冷读挂账 #4 词面单源锚）：本件自身的 git
 * 调用是「工具内置受控路径」（封闭动词面则——不在 carve-out 拦截面）；
 * `GIT_METADATA_COMMANDS` 是经 bash 的 git 命令族受控放行的闭集动词表词汇
 * 源（执法位 = exec bash 拦截面，随该面落码批接线——先有词后有法）。
 */
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Type } from 'typebox';
import { BaseError } from '../contracts/index.js';
import type { ToolDefinition } from '../contracts/index.js';
import { canonicalize, serializeTreeWrites } from './fs.js';

const execFile = promisify(execFileCallback);

/**
 * git 元数据命令闭集动词表（04 §8 carve-out 桥条款白名单形——词面单源锚）。
 * 经 bash 执行的 git 命令族元数据操作（写 `.git/objects`、`.git/refs`——
 * worktree 形态下含 `.git/worktrees/<name>/`）受控放行的动词全集；非本表
 * 动词（如 `fast-import`/`update-ref` 直改版本史字节）不在放行面。
 * 执法位 = exec bash 拦截面（该面落码批接线——本常量先锚词汇）。
 */
export const GIT_METADATA_COMMANDS: readonly string[] = [
  'add',
  'commit',
  'branch',
  'checkout',
  'switch',
  'merge',
  'rebase',
  'stash',
  'tag',
  'push',
  'pull',
  'fetch',
  'status',
  'log',
  'diff',
  'show',
  'config',
  'worktree',
];

/** worktree 名字词法（名即分支名即目录段三用同源——禁分隔符，首字符字母数字） */
const WORKTREE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 单 git 命令超时毫秒（缺省） */
const GIT_TIMEOUT_MS = 30_000;

/** git 输出缓冲上限字节（diff 可大——16 MiB 帽） */
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** worktree 服务选项（装配层注入——git 可执行注入位兼测试面） */
export interface WorktreeServiceOptions {
  /** 主仓根（.git 所在目录；绝对路径——建议 canonical 形） */
  readonly repoRoot: string;
  /** git 可执行（缺省 'git'；装配可注 BERRY_AGENT_GIT_PATH 解析产物） */
  readonly gitCommand?: string;
  /** 单命令超时毫秒（缺省 30s） */
  readonly timeoutMs?: number;
}

/** 单条 worktree 枚举项 */
export interface WorktreeEntry {
  /** 名（目录尾段——主仓项为仓目录名） */
  readonly name: string;
  /** canonical 绝对路径 */
  readonly path: string;
  /** 检出分支名（detached HEAD 形为空串） */
  readonly branch: string;
}

/** create 产物 */
export interface WorktreeCreated {
  readonly name: string;
  /** canonical 绝对路径（已记入会话授予集——若携 sessionId） */
  readonly path: string;
  /** 新建分支名（= name） */
  readonly branch: string;
}

/** worktree 服务（三动词 + 会话授予面——件侧编排与工具面共用真身） */
export interface WorktreeService {
  /** 建独立 worktree + 同名分支（撞名拒 FS_WORKTREE_EXISTS；成功且携 sessionId 即自动授予） */
  create(req: { name: string; baseRef?: string; sessionId?: string }): Promise<WorktreeCreated>;
  /** 枚举本仓全部 worktree（含主仓项——主次同列，只读不登记观察） */
  list(): Promise<WorktreeEntry[]>;
  /** 拆除 worktree（未提交变更拒 FS_WORKTREE_DIRTY——force 显式覆盖；分支留史不删） */
  clean(req: { name: string; force?: boolean }): Promise<{ name: string; path: string }>;
  /** 两点间补丁（交付面——草稿评论贴补丁的数据源；`base...HEAD` 三点形） */
  diffPatch(req: { name: string; baseRef: string }): Promise<string>;
  /** 会话授予集读（fence 组合装配面消费——writableRoots provider 并入） */
  grantedRoots(sessionId: string): string[];
  /** 会话授予回收（会话关闭 / Job 终态；返回被释放的路径集） */
  releaseSession(sessionId: string): string[];
}

/** 名字词法校验（坏形 = 参数面问题——TOOL_INVALID_ARGS 语义域） */
function assertNameValid(name: string): void {
  if (!WORKTREE_NAME_RE.test(name)) {
    throw new BaseError(
      'TOOL_INVALID_ARGS',
      `[TOOL_INVALID_ARGS] worktree 名字坏形：${name}（词法 ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$——名即分支名即目录段，禁分隔符）`,
    );
  }
}

/**
 * 组 worktree 服务。git 经 execFile 直调（node: 内建全局放行域——零外部
 * 二进制依赖）；全部 git 调用 cwd 锚主仓根。服务实例持会话授予表——同一
 * 仓应共享单实例（授予集与树级互斥链同源）。
 */
export function createWorktreeService(opts: WorktreeServiceOptions): WorktreeService {
  const repoRoot = opts.repoRoot;
  const git = opts.gitCommand ?? 'git';
  const timeoutMs = opts.timeoutMs ?? GIT_TIMEOUT_MS;
  // 会话 → 授予路径集（canonical 形；fence 组合装配面读 grantedRoots 并入）
  const grants = new Map<string, Set<string>>();

  /** 执行 git（cwd 锚主仓；非零退出折带 stderr 的 Error——语义码由调用方判形折码） */
  const runGit = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFile(git, args, { cwd: repoRoot, timeout: timeoutMs, maxBuffer: GIT_MAX_BUFFER });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string; message?: string; killed?: boolean };
      const detail = (e.stderr ?? e.message ?? String(err)).trim();
      if (e.killed === true) {
        throw new Error(`[git ${args[0]}] 超时（${timeoutMs}ms）：${detail.slice(0, 500)}`);
      }
      throw new Error(`[git ${args.join(' ')}] ${detail.slice(0, 500)}`);
    }
  };

  /** 派生 worktree 路径：仓同级 `<repo 目录名>-worktrees/<name>`（工具派生非模型指定） */
  const derivedPath = (name: string): string => join(dirname(repoRoot), `${basename(repoRoot)}-worktrees`, name);

  /** 分支在场判定（git branch --list 前缀匹配——须整行精确比对） */
  const branchExists = async (name: string): Promise<boolean> => {
    const out = await runGit(['branch', '--list', name]);
    return out
      .split('\n')
      .map((l) =>
        l
          .trim()
          .replace(/^\*\s+/, '')
          .replace(/\s+$/, ''),
      )
      .some((l) => l === name);
  };

  return {
    async create(req) {
      assertNameValid(req.name);
      const path = derivedPath(req.name);
      // 撞名两查：目录在场（前次 create 产物或同名异物）/ 分支在场
      if (existsSync(path)) {
        throw new BaseError(
          'FS_WORKTREE_EXISTS',
          `[FS_WORKTREE_EXISTS] worktree 已存在：${req.name}（路径 ${path} 在场）`,
        );
      }
      if (await branchExists(req.name)) {
        throw new BaseError(
          'FS_WORKTREE_EXISTS',
          `[FS_WORKTREE_EXISTS] 分支已存在：${req.name}（名字即分支名——分支与 worktree 同名域撞名）`,
        );
      }
      // 树级入链（占位键取派生路径的最近在场祖先 canonical——建后路径才在场）
      await serializeTreeWrites(await canonicalize(path), async () => {
        try {
          await runGit(
            req.baseRef === undefined
              ? ['worktree', 'add', '-b', req.name, path]
              : ['worktree', 'add', '-b', req.name, path, req.baseRef],
          );
        } catch (err) {
          // 链内竞速撞名（并发 create 同名）折语义码；其余 git 失败原样上抛
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already exists') || msg.includes('already checked out')) {
            throw new BaseError(
              'FS_WORKTREE_EXISTS',
              `[FS_WORKTREE_EXISTS] worktree/分支已存在：${req.name}（并发创建竞速）`,
            );
          }
          throw err;
        }
      });
      // 建成后路径在场——canonical 全程解析（授予集记 canonical 形，与 fence 比对同基）
      const canonical = await canonicalize(path);
      if (req.sessionId !== undefined) {
        let set = grants.get(req.sessionId);
        if (set === undefined) {
          set = new Set();
          grants.set(req.sessionId, set);
        }
        set.add(canonical);
      }
      return { name: req.name, path: canonical, branch: req.name };
    },

    async list() {
      const out = await runGit(['worktree', 'list', '--porcelain']);
      const entries: WorktreeEntry[] = [];
      let current: { path?: string; branch?: string } = {};
      for (const line of out.split('\n')) {
        if (line === '') {
          // 块尾——落项（worktree 行必有才有块）
          if (current.path !== undefined) {
            entries.push({
              name: basename(current.path),
              path: current.path,
              branch: current.branch ?? '',
            });
          }
          current = {};
          continue;
        }
        const space = line.indexOf(' ');
        const key = space === -1 ? line : line.slice(0, space);
        const value = space === -1 ? '' : line.slice(space + 1);
        if (key === 'worktree') current.path = value;
        else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
        // HEAD/bare/detached/locked/prunable 行不进枚举面
      }
      if (current.path !== undefined) {
        entries.push({ name: basename(current.path), path: current.path, branch: current.branch ?? '' });
      }
      return entries;
    },

    async clean(req) {
      assertNameValid(req.name);
      const path = derivedPath(req.name);
      // 在册判定（缺席 = 目标不存在——FS_NOT_FOUND 同 read/ls 语义域）。
      // 比对基 = canonical 双侧：git 记录 realpath（macOS /var → /private/var
      // 符号链形下与派生串不同形——字符串直比必假阴）
      const targetCanonical = await canonicalize(path);
      const entries = await this.list();
      let inList = false;
      for (const e of entries) {
        if ((await canonicalize(e.path)) === targetCanonical) {
          inList = true;
          break;
        }
      }
      if (!inList) {
        throw new BaseError('FS_NOT_FOUND', `[FS_NOT_FOUND] worktree 不存在：${req.name}（路径 ${path}）`);
      }
      const dirtyLines = async (): Promise<string[]> => {
        const status = await runGit(['-C', path, 'status', '--porcelain']);
        return status
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
      };
      await serializeTreeWrites(await canonicalize(path), async () => {
        // 未提交变更两查（force 显式覆盖）：链外先查给出可读拒因；链内复验——
        // 链上写者已排空，窗口收敛到链外写者（bash 重定向等——诚实边界）
        if (req.force !== true) {
          const lines = await dirtyLines();
          if (lines.length > 0) {
            throw new BaseError(
              'FS_WORKTREE_DIRTY',
              `[FS_WORKTREE_DIRTY] worktree 有未提交变更拒拆除：${req.name}（${lines.length} 处，如：${lines
                .slice(0, 3)
                .join('；')}）——提交后重试或显式 force`,
            );
          }
        }
        try {
          await runGit(req.force === true ? ['worktree', 'remove', '--force', path] : ['worktree', 'remove', path]);
        } catch (err) {
          // git 自身拒拆（本仓两查后的链外写者窗口）折同码——不裸抛
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('dirty')) {
            throw new BaseError(
              'FS_WORKTREE_DIRTY',
              `[FS_WORKTREE_DIRTY] git 拒拆（未提交变更）：${req.name}——提交后重试或显式 force`,
            );
          }
          throw err;
        }
      });
      // 分支留史不删（交付物引用——04 §7 落码定形）
      return { name: req.name, path };
    },

    async diffPatch(req) {
      assertNameValid(req.name);
      const path = derivedPath(req.name);
      return runGit(['-C', path, 'diff', `${req.baseRef}...HEAD`]);
    },

    grantedRoots(sessionId) {
      return [...(grants.get(sessionId) ?? [])];
    },

    releaseSession(sessionId) {
      const released = [...(grants.get(sessionId) ?? [])];
      grants.delete(sessionId);
      return released;
    },
  };
}

/**
 * 组 worktree 三工具（04 §7 worktree 条词面定名：worktree_create/list/clean）。
 * sessionId 取 toolCtx（会话内模型调用形态——授予自动记该会话）；件侧编排
 * 直接调 service（同样携 owner 会话 id）。effect：create/clean = write（过
 * 审批对），list 只读。
 */
export function createWorktreeTools(service: WorktreeService): ToolDefinition[] {
  return [
    {
      name: 'worktree_create',
      effect: 'write',
      description:
        '在当前仓旁建独立 git worktree + 同名新分支（名字即分支名）。产物路径由工具派生（仓同级 <仓目录名>-worktrees/<名字>），建成功即自动加入本会话可写根（后续 fs 写/bash 以该 worktree 为锚）。适合并行开一条独立工作线（如同时改两个特性互不踩踏）。',
      parameters: Type.Object({
        name: Type.String({ description: 'worktree 名（= 新分支名；字母数字开头，可含 ._-,禁斜杠,≤64 字符）' }),
        baseRef: Type.Optional(Type.String({ description: '基线提交/分支（缺省 HEAD）' })),
      }),
      execute: async (args, toolCtx) => {
        const created = await service.create({
          name: args.name as string,
          baseRef: args.baseRef as string | undefined,
          sessionId: toolCtx.sessionId,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `worktree 已建：${created.name}\n路径：${created.path}\n分支：${created.branch}（此后在本会话内该路径可写）`,
            },
          ],
          details: { name: created.name, path: created.path, branch: created.branch },
        };
      },
    },
    {
      name: 'worktree_list',
      effect: 'read',
      description: '枚举当前仓全部 git worktree（含主仓——路径/分支/名），只读。',
      parameters: Type.Object({}),
      execute: async () => {
        const entries = await service.list();
        const lines = entries.map((e) => `${e.name}\t分支 ${e.branch || '(detached)'}\t${e.path}`);
        return {
          content: [{ type: 'text' as const, text: lines.length > 0 ? lines.join('\n') : '（无 worktree）' }],
          details: { count: entries.length },
        };
      },
    },
    {
      name: 'worktree_clean',
      effect: 'write',
      description:
        '拆除指定 worktree（目录与 git 登记一并移除；分支保留不删——交付物引用）。有未提交变更时拒绝（FS_WORKTREE_DIRTY）——先提交，或显式传 force=true 强拆（变更将丢失）。',
      parameters: Type.Object({
        name: Type.String({ description: 'worktree 名（create 时的名字）' }),
        force: Type.Optional(Type.Boolean({ description: '强拆（丢弃未提交变更——破坏性动作）' })),
      }),
      execute: async (args) => {
        const removed = await service.clean({ name: args.name as string, force: args.force === true });
        return {
          content: [
            { type: 'text' as const, text: `worktree 已拆除：${removed.name}（${removed.path}）——同名分支保留` },
          ],
          details: { name: removed.name, path: removed.path },
        };
      },
    },
  ];
}
