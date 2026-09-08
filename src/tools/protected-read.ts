/**
 * L2 tools — 敏感件读侧 carve-out 判定件（04 §7 读侧条 + 2026-09-08 P0① 落码定形③④）。
 *
 * 独立小文件、不 import fs.ts（防 fs → protected-read → fs 环——模块内文件
 * 级依赖只许单向；search.ts 对 fs.ts 的 canonicalize 引用同理合法）。两判据：
 * - 路径判（open 前）：目标 canonical 路径命中敏感件集 = FS_READ_PROTECTED
 *   硬拒——fail-closed、无审批出路、不登记观察（拒读不构成「看过」）；deny
 *   检查先于存在性检查（缺席同拒同文案——不暴露敏感件存在性差异）；
 * - inode 判（open 后）：对已打开句柄 fstat 的 (dev, ino) 与敏感件集 stat
 *   比对，命中 = 同硬拒——一判收口两攻击面（硬链别名：canonical 路径不同而
 *   inode 相同；TOCTOU 换靶：canonicalize 与 open 之间路径组件被换）。
 *
 * 敏感集 = 装配层注入 provider（() => canonical 绝对路径数组；缺省空集 =
 * 判定 no-op）。tools 不 import safety（DAG 边表），与 fence 的
 * writableRoots 同注入形——数据在装配层，判定语义在工具件。
 */

import { stat } from 'node:fs/promises';
import { BaseError } from '../contracts/index.js';

/** 敏感读路径 provider 形（fence 的 writableRoots 同款注入形——数据在装配层） */
export type ProtectedReadFiles = () => readonly string[];

/** 保护面硬拒（两判据共用回执——同码同文案，不区分命中路径判还是 inode 判） */
function rejectProtected(abs: string): never {
  throw new BaseError(
    'FS_READ_PROTECTED',
    `[FS_READ_PROTECTED] 读目标属敏感件保护面：${abs}（04 §7 读侧 carve-out——密钥与免问面恒不可读，fail-closed 无审批出路）`,
  );
}

/**
 * open 前路径判：canonical 目标命中敏感集 = 硬拒（不登记观察）。比对语义 =
 * canonical 路径相等（敏感件是具体文件不是目录域——无前缀匹配面）。
 */
export function rejectProtectedReadPath(canonical: string, protectedReadFiles: ProtectedReadFiles): void {
  for (const p of protectedReadFiles()) {
    if (canonical === p) rejectProtected(canonical);
  }
}

/**
 * open 后 inode 判：已打开句柄的 fstat 产物与敏感件集逐件 stat 比对，
 * (dev, ino) 双等 = 同硬拒。敏感件自身缺席（stat ENOENT）= 跳过（无可比对
 * 象；保护面不虚构）。空敏感集零 stat（缺省装配 no-op 无开销）。
 *
 * @param abs 用户可见的请求路径（回执文案用——真实判据是 inode 不是路径）
 * @param opened 打开句柄的 fstat 产物（`open` 已把路径解析钉死到具体 inode
 *   ——比对的正是「真正打开的那个」，而非再次路径解析的快照）
 */
export async function assertInodeNotProtected(
  abs: string,
  opened: { readonly dev: number; readonly ino: number },
  protectedReadFiles: ProtectedReadFiles,
): Promise<void> {
  const paths = protectedReadFiles();
  if (paths.length === 0) return; // 敏感集缺席（诊断形/未注入）——判定 no-op
  for (const p of paths) {
    // 敏感件 stat：读失败（含缺席/权限）一律跳过——保护面只按在场可比对象执法
    const st = await stat(p).catch(() => undefined);
    if (st === undefined) continue;
    if (st.dev === opened.dev && st.ino === opened.ino) rejectProtected(abs);
  }
}
