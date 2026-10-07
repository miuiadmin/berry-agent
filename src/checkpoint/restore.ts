/**
 * checkpoint 回退执行（05 §5.3 批 15d——/rewind 两段事务的程序面真身）。
 *
 * preview（段一，零改动承诺）：只读对账——当前 walk 域哈希清单 vs manifest
 * 文件表，报恢复 N（内容异或缺席）/ 删除 M（manifest 外新文件）/ 不动 U
 * （哈希同）。纯读面：不写不删不 fork。
 *
 * restore（段二，三步序）：
 *   ① pre-rewind 保底快照先行——把「即将被回退覆盖的现状」先拍下来
 *      （rewind 自身可回退——痕迹可清算；拍摄前先排干发起会话 write-behind
 *      在队事件——05 §5.3 D② 治本批：boundarySeq 拍下即有 durable 承载）；
 *   ② 文件恢复——逐 manifest 条目 tmp+rename 原子写（哈希同则不写——
 *      保 mtime；缺席父目录 mkdir recursive）+ walk 域内真恢复（manifest
 *      外文件删除 + 空目录自底向上清剪、根不删）。中途崩溃重跑同
 *      manifest 幂等收敛（v1 诚实边界：无整事务原子性，靠逐文件原子 +
 *      重跑收敛）；
 *   ③ fork(upToSeq = manifest.boundarySeq)——旧史保留，新会话净边界起跑
 *      （05 §5.0 净边界纪律：不破「不在进行中 turn 中间切」）。fork 被
 *      veto 或抛错时文件已恢复（序是保底→恢复→fork 的规范序）——回执
 *      诚实报 vetoReason，痕迹链完整。
 *
 * 错误分码：manifest 缺席 = NOT_FOUND；仓坏形 = STORE_CORRUPT（blob 读
 * 侧 fail-loud 直通透传）；恢复执行 IO 失败 = RESTORE_FAILED（保底快照
 * 在场，重跑收敛）；fork 第③腿抛错不入错误面——折 veto 形回执（崩溃窗：
 * 源会话 durable 日志短于 manifest.boundarySeq 时 fork 逃 plain Error，
 * 文件已恢复、分支未建——vetoReason 诚实报部分态与出路，见③腿内注）。
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
  /**
   * 拍摄前屏障 seam（05 §5.3 D② 治本批定形注）：pre-rewind 保底拍前对发起
   * 会话同步排干 write-behind 在队事件——保底拍的 boundarySeq 拍下即有
   * durable 承载（活体边界可领先 durable 日志）。排干条件与 boundary 活体
   * 读取严格同（session face 与 invokingSessionId 双在场；缺一即 boundary=-1
   * 形无 durable 承载需求，不排干）。真身 = persistence.drainSessionNow 透传
   * （经 host deps 注入）；缺席 = 诚实降级（无持久化环境的测试形态）。抛错
   * 原样直通——保底拍失败即中止（既有错误面承载，command 面守卫错折文本）。
   */
  drain?: (sessionId: string) => void;
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

  // 恢复窗全程持有（05 §5.3 ckpt-gc 延伸批——挖掘 16 轮）：载入目标即
  // protect（计数入册），③完成/抛错 finally release 收口。并发他路 prune
  // 的段一淘汰见 store 集豁免本 manifest；其独占 blob 由 manifest 在册
  // 联锁（段二引用扫描看得到）——②a readBlob 全窗不悬空。
  deps.store.protect(id);
  try {
    /* ---- ① pre-rewind 保底快照（rewind 自身可回退——痕迹可清算） ---- */
    const snapshotOwner = deps.invokingSessionId ?? manifest.sessionId;
    // 拍摄前屏障（05 §5.3 D② 治本批）：排干与 boundary 活体读取共用同一条件
    // （session face 与 invokingSessionId 双在场——缺一即 -1 形无 durable 承载
    // 需求，不排干），序 = 先排干、后读 boundary、再保底拍——排干令保底拍的
    // boundarySeq 拍下即有 durable 承载。排干抛错不吞原样直通：保底拍失败即
    // 中止（既有错误面承载，command 面守卫错折文本——fail-closed：对着落不了
    // 库的边界拍快照 = 伪承诺）
    let boundary = -1;
    if (deps.session !== undefined && deps.invokingSessionId !== undefined) {
      deps.drain?.(deps.invokingSessionId);
      boundary = deps.session.contextOf(deps.invokingSessionId)?.lastClosedBoundary ?? -1;
    }
    const capture = createCapture(deps.store, { now: deps.now, newId: deps.newId });
    const preRewind = await capture({
      sessionId: snapshotOwner,
      boundarySeq: boundary,
      workspaceRoot: manifest.workspaceRoot,
      trigger: 'pre-rewind',
      // 恢复目标保护（十六役补扫 N4）：满帽工作区（常态 10 份）下保底拍成为
      // 第 11 份触发 prune 裁剪，目标（/rewind list 最旧行恰是 stale 首位）
      // 会被淘汰自毁——独占 blob 随 GC 物理删除，②a readBlob 假报
      // STORE_CORRUPT 且重试 NOT_FOUND（回退点永久丢失 + 部分恢复态）
      protectId: id,
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
    // 第③腿抛错折 veto 形回执（data-integrity L1——崩溃窗收口）：② 文件恢复
    // 之后 fork 仍可抛。已知形 = 源会话 durable 日志短于 manifest.boundarySeq
    // ——gate 拍摄取活体末闭合边界（含 write-behind 在飞未落事件），随后
    // 崩溃/sever（在队事件丢失）或毒丸隔离（durable 前缀停摆）即成分歧窗；
    // 此形是崩溃窗数据分歧而非调用方 bug（sessions.ts 抛点文案对主调用面
    // 成立、对本调用面误导——抛点位不动，restore 位承接改写归因）。异常
    // 上抛 = 文件已回退、分支会话未建、回执缺席（command 面对 plain Error
    // 裸抛）；折 veto 形保回执通道在场，vetoReason 诚实报部分态与出路。
    let outcome: Awaited<ReturnType<RewindForkFace['fork']>>;
    try {
      outcome = await deps.fork.fork(manifest.sessionId, {
        upToSeq: manifest.boundarySeq,
        title: `rewind:${manifest.id}`,
      });
    } catch (err) {
      // 折面与 command.ts 守卫错同形（BaseError 码直呈——丢码即丢可引用面；
      // 非 BaseError 折 message——免「Error: 」前缀噪音）
      const detail =
        err instanceof BaseError ? `${err.code}：${err.message}` : err instanceof Error ? err.message : String(err);
      // 边界越界形换用户面诚实文案（原文案「调用方 bug」误导归因不入回执）；
      // 其余错误形保留原始信息（可诊断）。部分态与出路的承载分工：本侧只报
      // 「分支会话未建 + 续用原会话」增量，「文件已恢复 + 可重试」由消费位
      // command.ts 模板尾缀统一承载（单源——两侧各写全套即拼接后重复成对）
      const vetoReason = detail.includes('边界越界')
        ? `回退点边界序号（seq=${manifest.boundarySeq}）超出会话现存日志——上次运行可能异常退出导致部分日志未保存（分支会话未建；可续用原会话）`
        : `${detail}（分支会话未建；可续用原会话）`;
      return {
        id: manifest.id,
        preRewindId: preRewind.id,
        restoredCount,
        deletedCount,
        untouchedCount,
        vetoReason,
      };
    }
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
  } finally {
    // 持有解除（计数归零出册——protect 配对腿；抛错路同样解除）
    deps.store.release(id);
  }
}
