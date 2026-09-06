/**
 * checkpoint 回退执行（05 §5.3 批 15d——/rewind 两段事务的程序面真身）。
 *
 * preview（段一，零改动承诺）：只读对账——当前 walk 域哈希清单 vs manifest
 * 文件表，报恢复 N（内容异或缺席）/ 删除 M（manifest 外新文件）/ 不动 U
 * （哈希同）。纯读面：不写不删不 fork。
 *
 * restore（段二，三步序）：
 *   ① pre-rewind 保底快照先行——把「即将被回退覆盖的现状」先拍下来
 *      （rewind 自身可回退——痕迹可清算）；
 *   ② 文件恢复——逐 manifest 条目 tmp+rename 原子写（哈希同则不写——
 *      保 mtime；缺席父目录 mkdir recursive）+ walk 域内真恢复（manifest
 *      外文件删除 + 空目录自底向上清剪、根不删）。中途崩溃重跑同
 *      manifest 幂等收敛（v1 诚实边界：无整事务原子性，靠逐文件原子 +
 *      重跑收敛）；
 *   ③ fork(upToSeq = manifest.boundarySeq)——旧史保留，新会话净边界起跑
 *      （05 §5.0 净边界纪律：不破「不在进行中 turn 中间切」）。fork 被
 *      veto 时文件已恢复（序是保底→恢复→fork 的规范序）——回执诚实报
 *      vetoReason，痕迹链完整。
 *
 * 错误分码：manifest 缺席 = NOT_FOUND；仓坏形 = STORE_CORRUPT（blob 读
 * 侧 fail-loud 直通透传）；恢复执行 IO 失败 = RESTORE_FAILED（保底快照
 * 在场，重跑收敛）。
 */
import { mkdir, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, join } from 'node:path';
import { BaseError } from '../contracts/index.js';
import { createCapture } from './capture.js';
import { contentHash, type CheckpointStore } from './store.js';
import type { CheckpointManifest, RewindForkFace, SessionContextFace } from './types.js';
import { readWorkspaceFile, walkWorkspaceFiles } from './walk.js';

/** restore 依赖（fork 面与预览时钟注入——组合根装配） */
export interface RewindRestoreDeps {
  store: CheckpointStore;
  /** fork 面（SessionManager.fork 可直赋——三步序的第③腿） */
  fork: RewindForkFace;
  /** 会话语境面（pre-rewind 保底快照的边界锚；缺省 -1 = 无闭合轮形态） */
  session?: SessionContextFace;
  /** 发起会话（保底快照归属；缺省记在 manifest 原会话名下） */
  invokingSessionId?: string;
  /** 时钟（缺省 Date.now——测试注入） */
  now?: () => number;
  /** manifest id 源（缺省 randomUUID——测试注入） */
  newId?: () => string;
}

/** preview 回执（段一——零改动承诺的对账面） */
export interface RewindPreviewResult {
  readonly manifest: CheckpointManifest;
  /** 恢复 N：内容异或缺席的 manifest 条目数 */
  readonly restoreCount: number;
  /** 删除 M：当前 walk 域内 manifest 外文件数 */
  readonly deleteCount: number;
  /** 不动 U：哈希同（不写——保 mtime） */
  readonly untouchedCount: number;
}

/** restore 回执（段二——三步序的执行账） */
export interface RewindRestoreReceipt {
  readonly id: string;
  /** pre-rewind 保底快照 manifest id（rewind 自身的回退锚） */
  readonly preRewindId: string;
  readonly restoredCount: number;
  readonly deletedCount: number;
  readonly untouchedCount: number;
  /** fork 成功——新会话 id（adopt 切前台归 host 编舞） */
  readonly forkedSessionId?: string;
  /** fork 被 veto 的原因（文件已恢复——序为规范序，痕迹链完整） */
  readonly vetoReason?: string;
}

/** 恢复执行 IO 失败折 RESTORE_FAILED（保底快照在场——重跑同 manifest 收敛） */
function restoreFailed(detail: string): BaseError {
  return new BaseError('CHECKPOINT_RESTORE_FAILED', `[CHECKPOINT_RESTORE_FAILED] 恢复执行失败：${detail}`);
}

/** 当前 walk 域哈希清单（preview/restore 共用对账基线——单遍读+哈希） */
async function currentHashes(root: string): Promise<Map<string, string>> {
  const walked = await walkWorkspaceFiles(root);
  const out = new Map<string, string>();
  for (const file of walked) {
    out.set(file.path, contentHash(await readWorkspaceFile(file.absPath)));
  }
  return out;
}

/** 逐文件 tmp+rename 原子写（与 store.atomicWrite 同 idiom——恢复面独立成文） */
async function atomicWriteFile(absPath: string, content: Buffer): Promise<void> {
  try {
    await mkdir(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.rewind-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    await writeFile(tmp, content);
    await rename(tmp, absPath);
  } catch (err) {
    throw restoreFailed(`写 ${absPath}（${err instanceof Error ? err.message : String(err)}）`);
  }
}

/** 空目录自底向上清剪（删除步的后置——根自身不删；非空/竞态吞错继续） */
async function pruneEmptyDirs(root: string, dir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // 先清子目录再判本层（只含空目录的目录也该清）；符号链目录 Dirent 谓词
  // 恒 false 不入——不 rmdir 间接层
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!entry.isDirectory()) continue;
    await pruneEmptyDirs(root, join(dir, entry.name));
  }
  if (dir === root) return; // 根不删（删根 = 删工作区本身）
  try {
    await rmdir(dir);
  } catch {
    // 非空（gitignore 域内文件等）或竞态——保留，重跑幂等
  }
}

/** 段一：preview（只读对账——恢复 N / 删除 M / 不动 U；不写不删不 fork） */
export async function previewRewind(store: CheckpointStore, id: string): Promise<RewindPreviewResult> {
  const manifest = await store.loadManifest(id); // NOT_FOUND / STORE_CORRUPT 直通
  const current = await currentHashes(manifest.workspaceRoot);
  const manifestMap = new Map(manifest.files.map((f) => [f.path, f.hash]));
  let restoreCount = 0;
  let deleteCount = 0;
  let untouchedCount = 0;
  for (const [path, hash] of current) {
    const want = manifestMap.get(path);
    if (want === undefined) deleteCount += 1;
    else if (want === hash) untouchedCount += 1;
    else restoreCount += 1;
  }
  // manifest 有而当前缺席（删过/现为 gitignore 域外）——同入恢复账
  for (const f of manifest.files) {
    if (!current.has(f.path)) restoreCount += 1;
  }
  return { manifest, restoreCount, deleteCount, untouchedCount };
}

/** 段二：restore 三步序（保底快照 → 文件恢复 → fork） */
export async function restoreRewind(deps: RewindRestoreDeps, id: string): Promise<RewindRestoreReceipt> {
  const manifest = await deps.store.loadManifest(id); // NOT_FOUND / STORE_CORRUPT 直通

  /* ---- ① pre-rewind 保底快照（rewind 自身可回退——痕迹可清算） ---- */
  const snapshotOwner = deps.invokingSessionId ?? manifest.sessionId;
  const boundary =
    (deps.session !== undefined && deps.invokingSessionId !== undefined
      ? deps.session.contextOf(deps.invokingSessionId)?.lastClosedBoundary
      : undefined) ?? -1;
  const capture = createCapture(deps.store, { now: deps.now, newId: deps.newId });
  const preRewind = await capture({
    sessionId: snapshotOwner,
    boundarySeq: boundary,
    workspaceRoot: manifest.workspaceRoot,
    trigger: 'pre-rewind',
  });

  /* ---- ② 文件恢复（walk 域内真恢复：改/补 manifest 条目 + 删域外文件 + 清空目录） ---- */
  const current = await currentHashes(manifest.workspaceRoot);
  const manifestMap = new Map(manifest.files.map((f) => [f.path, f.hash]));
  let restoredCount = 0;
  let deletedCount = 0;
  let untouchedCount = 0;

  // ②a 逐 manifest 条目：哈希同不动（保 mtime）；异/缺席读 blob 原子写回
  for (const entry of manifest.files) {
    if (current.get(entry.path) === entry.hash) {
      untouchedCount += 1;
      continue;
    }
    const content = await deps.store.readBlob(entry.hash); // STORE_CORRUPT fail-loud 直通
    await atomicWriteFile(join(manifest.workspaceRoot, ...entry.path.split('/')), content);
    restoredCount += 1;
  }

  // ②b walk 域内 manifest 外文件删除（真恢复——不留快照后新增物）
  for (const path of current.keys()) {
    if (manifestMap.has(path)) continue;
    try {
      await rm(join(manifest.workspaceRoot, ...path.split('/')), { force: true });
    } catch (err) {
      throw restoreFailed(`删 ${path}（${err instanceof Error ? err.message : String(err)}）`);
    }
    deletedCount += 1;
  }

  // ②c 空目录自底向上清剪（删除步后置；根不删）
  await pruneEmptyDirs(manifest.workspaceRoot, manifest.workspaceRoot);

  /* ---- ③ fork（旧史保留——新会话净边界起跑；veto 不回滚文件恢复） ---- */
  const outcome = await deps.fork.fork(manifest.sessionId, {
    upToSeq: manifest.boundarySeq,
    title: `rewind:${manifest.id}`,
  });
  return outcome.status === 'forked'
    ? {
        id: manifest.id,
        preRewindId: preRewind.id,
        restoredCount,
        deletedCount,
        untouchedCount,
        forkedSessionId: outcome.sessionId,
      }
    : {
        id: manifest.id,
        preRewindId: preRewind.id,
        restoredCount,
        deletedCount,
        untouchedCount,
        vetoReason: outcome.reason,
      };
}
