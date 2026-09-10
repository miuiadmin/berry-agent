/**
 * L3 safety — 可写根唯一推导函数 + carve-out 层叠例外（04 §8 deriveWritableRoots 表 + carve-out 条款）。
 *
 * deriveWritableRoots() 是「某档是什么意思」的唯一 home：沙箱 profile
 * （seatbelt/bwrap）与进程内 fs fence（tools/fs.ts 的 writableRoots
 * provider）都从这里取根列表——两套防线同源生成、永不漂移。carve-out
 * 在根列表之上叠加按路径层叠的例外条目（.git / .env 族）。
 *
 * 与 berry 分叉注记：carve-out 命中 = 守门行 block **硬拒**（04 §8
 * 2026-09-06 定形——「恒不可写=平台底线」字面从硬，无升权出路）；berry
 * 把 carve-out 命中做成升权审批面（用户可裁放行）不承。external 分域
 * 变体（externalWritableRoots 族）不落——本仓插件进程隔离批随需再裁。
 */

import { readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path';
import type { SandboxMode, WritableRootsInput } from './types.js';

/** carve-out 例外条目：pattern 相对 workspace（或以 / 起的绝对路径）；层叠 = 最具体（最长路径）匹配胜出 */
export interface CarveOutEntry {
  /**
   * 路径模式：字面相对路径（`.git`、`src/secrets.json`）或顶层单层 glob
   * （`*.env`、`.env*`——`*` 不跨目录分隔符）。glob 先展开再遮罩：展开时刻
   * 实际存在的文件集合生效，新文件不追溯遮罩（诚实语义——04 §8 定形）。
   */
  readonly pattern: string;
  /** allow = 在被更浅 deny 覆盖处重新放开（孙再可写）；deny = 遮罩为只读 */
  readonly effect: 'deny' | 'allow';
  /** 条目说明（守门 block 回执与审计用） */
  readonly note?: string;
}

/**
 * 路径 canonical 化（符号链解析到真实位置）。
 * 路径或前缀不存在时：回退**最近存在祖先**解析符号链再拼回尾部段——与写侧
 * fs.ts canonicalize 同律（别名工作区下新建文件的绝对别名路径若原样返回，
 * 与 canonical 化的根比较恒 miss → 守门判根外跳过而写侧父目录递归判在根内
 * 放行——两层 canonical 化分歧乘出遮罩绕过，蓝本真缺陷教训照搬防御）。
 */
export function canonicalPath(path: string): string {
  try {
    // native 实现按文件系统逐组件查找（与 spawn 及各强制层一致）；JS 实现
    // 在部分平台会先做词法折叠再解析符号链，与强制层判定不一致
    return realpathSync.native(path);
  } catch {
    // 不存在：父目录递归解析（父到达文件系统根仍失败即回退原样——绝对病理
    // 形态不虚构路径）
    const parent = dirname(path);
    if (parent === path) return path;
    return join(canonicalPath(parent), basename(path));
  }
}

/**
 * 按档位推导可写根列表（canonical 化去重）——04 §8 表的唯一落码：
 * - read-only：空列表（fence 拒全量写——mode 是一等输入，不是装饰参数）；
 * - workspace-write：workspace + /tmp + os.tmpdir()；
 * - danger：文件系统根 [sep]（全盘可写——配合 isInsideRoot 的根分隔符特判，
 *   任意绝对路径皆命中）。
 * 这是 fs fence 与沙箱 profile（seatbelt/bwrap）的共同数据源。
 */
export function deriveWritableRoots(workspace: string, mode: SandboxMode): string[] {
  if (mode === 'read-only') return [];
  if (mode === 'danger') return [sep];
  return [...new Set([workspace, '/tmp', tmpdir()].map(canonicalPath))];
}

/** child 是否位于 root 内（相等或隔分隔符的前缀——防 /root 与 /root-evil 误判；root 为 sep 时任意绝对路径皆命中） */
export function isInsideRoot(child: string, root: string): boolean {
  const prefix = root === sep ? sep : root + sep;
  return child === root || child.startsWith(prefix);
}

/**
 * carve-out 条目展开：pattern → canonical 绝对路径集合。
 * 字面 pattern 直接转绝对（不检查存在性——尚未存在的敏感路径也预先遮罩，
 * .git 在 init 前就该挡）；含 `*` 的 pattern 扫描其所在目录层（单层不递归）
 * 把实际存在的匹配项展开——「glob 先展开再遮罩」。展开结果同时用于判定表
 * 构建与审计输出。
 */
export function expandCarveOutEntry(workspace: string, entry: CarveOutEntry): string[] {
  const dir = entry.pattern.includes('/')
    ? resolvePath(workspace, entry.pattern.slice(0, entry.pattern.lastIndexOf('/')))
    : workspace;
  const leaf = entry.pattern.includes('/') ? entry.pattern.slice(entry.pattern.lastIndexOf('/') + 1) : entry.pattern;
  if (!leaf.includes('*')) {
    return [absolutize(workspace, entry.pattern)];
  }
  // 顶层单层 glob：`*` 不跨分隔符，扫描目录层取实际存在的匹配
  const pattern = new RegExp(`^${leaf.replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`).replaceAll('*', '[^/]*')}$`);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => pattern.test(e.name))
      .map((e) => canonicalPath(join(dir, e.name)));
  } catch {
    // 目录不存在：glob 无可展开（字面条目不同——见上）
    return [];
  }
}

/** 展开后的 carve-out 判定节点（路径 → 生效条目；构建时按层叠规则解决冲突） */
export interface CarveOutNode {
  /** canonical 绝对路径（该条目管辖此前缀下的一切） */
  readonly path: string;
  readonly effect: 'deny' | 'allow';
  /** 命中的原始条目（守门 block 回执与审计引用） */
  readonly entry: CarveOutEntry;
}

/**
 * 构建 carve-out 判定表：全部条目展开后按「最具体路径胜出」排序（路径段数
 * 多者先；同深按 deny 优先——保守）。层叠语义由排序后的首个前缀匹配实现：
 * 父条目宽、子条目窄，孙条目比子条目更窄时赢回（allow 效果的用途）。
 */
export function buildCarveOutTable(workspace: string, entries: readonly CarveOutEntry[]): CarveOutNode[] {
  const nodes: CarveOutNode[] = [];
  for (const entry of entries) {
    for (const path of expandCarveOutEntry(workspace, entry)) {
      nodes.push({ path, effect: entry.effect, entry });
    }
  }
  // 最长路径（最深）优先；同路径 deny 胜 allow（保守）；再按 pattern 字典序稳定排序
  return nodes.sort((a, b) => {
    const depth = b.path.split(sep).length - a.path.split(sep).length;
    if (depth !== 0) return depth;
    if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1;
    return a.entry.pattern.localeCompare(b.entry.pattern);
  });
}

/** 可写性判定结果 */
export type WritabilityVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** outside-roots = 不在任何可写根内（fence 粗粒度拒绝面）；carve-out = 根内但命中例外遮罩（守门行硬拒面） */
      readonly kind: 'outside-roots' | 'carve-out';
      /** carve-out 命中时的条目（block 回执引用） */
      readonly matched?: CarveOutNode;
    };

/**
 * 判定一个 canonical 绝对路径在当前策略下的可写性：carve-out 判定表首个
 * 前缀命中即为其效果（无命中再看根 containment）。顺序保证「根内但被遮罩」
 * 判为 carve-out（守门硬拒面），「根外」判为 outside-roots（fence 的面）——
 * 两个拒绝面词汇不同、去处不同。
 */
export function resolveWritability(
  absPath: string,
  roots: readonly string[],
  carveOut: readonly CarveOutNode[],
): WritabilityVerdict {
  // carve-out 先判：表按最具体优先排序，首个（最深的）前缀命中即生效
  for (const node of carveOut) {
    const inside = absPath === node.path || absPath.startsWith(node.path + sep);
    if (inside) {
      return node.effect === 'deny' ? { allowed: false, kind: 'carve-out', matched: node } : { allowed: true };
    }
  }
  // 根 containment：相等或隔分隔符前缀（防 /root-evil 误判；全盘根见 isInsideRoot）
  const inRoots = roots.some((root) => isInsideRoot(absPath, root));
  return inRoots ? { allowed: true } : { allowed: false, kind: 'outside-roots' };
}

/**
 * 组装 fs 工具族的 writableRoots provider（装配层接线位：替换 tools/fs 的
 * 过渡缺省——批 8 挂账兑现）。返回的根列表按当前档位推导（mode getter 每
 * 次 fence 检查取最新——read-only 空根 / danger 全盘根 / workspace-write
 * 三根），已 canonical 化，与沙箱 profile 同源。
 */
export function createRootsProvider(input: WritableRootsInput): () => string[] {
  const workspace = canonicalPath(input.workspace);
  return () => deriveWritableRoots(workspace, input.mode());
}

/** 绝对化工具：workspace 锚定 canonical 化（相对锚 workspace、绝对原样——守门行预检单源） */
export function absolutize(workspace: string, p: string): string {
  return canonicalPath(isAbsolute(p) ? resolvePath(p) : resolvePath(workspace, p));
}
