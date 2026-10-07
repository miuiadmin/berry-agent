/**
 * checkpoint 快照仓（05 §5.3 批 15d——纯文件域存储面，零 SQLite 表不占迁移号）。
 *
 * 布局：`<dataDir>/data/checkpoint/` 下——
 *   blobs/<hash 前二>/<sha256>   内容寻址 blob（跨 workspace 共享天然去重；
 *                                tmp+rename 原子写；写前查在场跳过——同内容
 *                                零重写）
 *   manifests/<id>.json          manifest 目录面（files 即恢复清单）
 *
 * 坏形两分（02 §5.3 批 15d 四码语义）：id 缺席/坏形 = CHECKPOINT_NOT_FOUND
 * （/rewind 作用目标守卫）；manifest JSON 坏形、blob 缺席或哈希不符 =
 * CHECKPOINT_STORE_CORRUPT（fail-loud 宁拒不误读）。清单面坏形隔离单列
 * （05 §5.3 定形注——2026-09-29 十六役扫 #4）：listManifests 逐条隔离坏件
 * 跳过+warn（按 id 进程内去重；隔离件不入引用面——blob 由 GC 回收、文件
 * 留置不自动删），定点读（loadManifest/restore）维持 fail-loud。id/hash
 * 是路径段——白名单字符校验防路径注入（/rewind 的 id 来自用户输入面）；
 * files[].path 直供 restore 的 join 消费——相对 posix 白名单防路径穿越越出
 * workspaceRoot。
 *
 * 裁剪（每次捕获后由 capture 侧调 prune）：per workspace 保最新
 * CHECKPOINT_RETENTION_PER_WORKSPACE 份 manifest（trigger 两形同计，capturedAt
 * 降序、同刻 id 决胜）；随后 blob 引用计数 GC——扫全仓在册 manifest 收集引用
 * 哈希（跨 workspace 共享不误杀），无引用才删。
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseError } from '../contracts/index.js';
import { CHECKPOINT_RETENTION_PER_WORKSPACE, type CheckpointManifest, type CheckpointTrigger } from './types.js';

/** manifest id 合法形（自产 uuid 子集；用户输入面的路径段白名单） */
const MANIFEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** blob 哈希合法形（sha256 小写 hex 64 位） */
const BLOB_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * manifest 文件条目 path 合法形判据（工作区相对 posix 路径白名单——防路径
 * 穿越）：非绝对（无前导 /）、无反斜杠（Windows 分隔符注入形）、逐段非空
 * 且非 '.'/'..'（restore 的 join(workspaceRoot, ...path.split('/')) 消费零
 * 归一歧义——'..' 段可越出 workspaceRoot 写任意位置）。walk 产物天然合规。
 */
function isSafeEntryPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** 快照仓公开面（openCheckpointStore 产物） */
export interface CheckpointStore {
  /** 仓根绝对路径（诊断面） */
  readonly baseDir: string;
  /** 写 blob（在场即跳过——内容寻址同内容零重写；tmp+rename 原子） */
  writeBlob(hash: string, content: Buffer): Promise<void>;
  /** 读 blob（缺席或哈希不符 = STORE_CORRUPT fail-loud） */
  readBlob(hash: string): Promise<Buffer>;
  /** 存 manifest（tmp+rename 原子） */
  saveManifest(manifest: CheckpointManifest): Promise<void>;
  /** 读 manifest（缺席 = NOT_FOUND；坏形 = STORE_CORRUPT） */
  loadManifest(id: string): Promise<CheckpointManifest>;
  /** 全部 manifest（capturedAt 降序；坏件逐条隔离跳过+warn——见 05 §5.3 定形注） */
  listManifests(): Promise<CheckpointManifest[]>;
  /** 删 manifest 文件（幂等——缺席 no-op） */
  deleteManifest(id: string): Promise<void>;
  /** 全仓 blob 哈希清单（GC 扫描面） */
  listBlobHashes(): Promise<string[]>;
  /** 删 blob（幂等；GC 终步——仅无引用哈希可进） */
  deleteBlob(hash: string): Promise<void>;
  /**
   * 裁剪+GC（per workspace 保留帽 + 引用计数清扫）；回执删除计数。
   * protectedIds = 保留帽豁免集（十六役补扫 N4——恢复目标保护）：豁免件
   * 不入 stale 淘汰（帽外多留，恢复窗的瞬态非稳态），且仍在引用面——其
   * 独占 blob 不被段二 GC 误杀。
   */
  prune(protectedIds?: ReadonlySet<string>): Promise<{ removedManifests: number; removedBlobs: number }>;
  /**
   * 恢复窗持有保护（05 §5.3 ckpt-gc 延伸批——挖掘 16 轮）：restore 载入目标
   * manifest 后 protect、③完成/抛错 finally release（计数形——同 id 并发恢复
   * 嵌套持有可能）。prune 段一豁免 = 参数集 ∪ store 集；段二 blob 引用扫描
   * 由 manifest 在册联锁（protect 保 manifest 不出册，其独占 blob 即恒入引用
   * 集不入 GC 判据）——②a readBlob 全窗不悬空。
   */
  protect(id: string): void;
  /** 持有解除（计数归零出册——protect 配对腿；无持有解除 = 幂等 no-op） */
  release(id: string): void;
}

/** 内容哈希（sha256 hex——内容寻址与一致性校验的单源） */
export function contentHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** 快照仓相对布局（blo 前二分桶 = 目录爆炸防线） */
function blobPath(baseDir: string, hash: string): string {
  return join(baseDir, 'blobs', hash.slice(0, 2), hash);
}

/** manifest 坏形折 STORE_CORRUPT（宁拒不误读——字段缺失/型不符全收） */
function corrupt(detail: string): BaseError {
  return new BaseError('CHECKPOINT_STORE_CORRUPT', `[CHECKPOINT_STORE_CORRUPT] 快照仓格式异常：${detail}`);
}

/** manifest JSON 形校验（loadManifest/listManifests 共用判据） */
function validateManifest(raw: unknown, source: string): CheckpointManifest {
  if (typeof raw !== 'object' || raw === null) throw corrupt(`${source} 非 JSON 对象`);
  const m = raw as Record<string, unknown>;
  const id = m.id;
  const sessionId = m.sessionId;
  const boundarySeq = m.boundarySeq;
  const workspaceRoot = m.workspaceRoot;
  const capturedAt = m.capturedAt;
  const trigger = m.trigger;
  const files = m.files;
  if (typeof id !== 'string' || !MANIFEST_ID_RE.test(id)) throw corrupt(`${source} id 格式异常`);
  if (typeof sessionId !== 'string' || sessionId === '') throw corrupt(`${source} sessionId 格式异常`);
  if (typeof boundarySeq !== 'number' || !Number.isInteger(boundarySeq) || boundarySeq < -1)
    throw corrupt(`${source} boundarySeq 格式异常`);
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') throw corrupt(`${source} workspaceRoot 格式异常`);
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) throw corrupt(`${source} capturedAt 格式异常`);
  if (trigger !== 'mutation' && trigger !== 'pre-rewind') throw corrupt(`${source} trigger 格式异常`);
  if (!Array.isArray(files)) throw corrupt(`${source} files 非数组`);
  const entries = files.map((f, i) => {
    if (typeof f !== 'object' || f === null) throw corrupt(`${source} files[${i}] 非对象`);
    const e = f as Record<string, unknown>;
    if (typeof e.path !== 'string' || !isSafeEntryPath(e.path))
      throw corrupt(
        `${source} files[${i}].path 格式异常（须为工作区相对 posix 路径——不允许绝对路径、'..' 段或反斜杠）`,
      );
    if (typeof e.hash !== 'string' || !BLOB_HASH_RE.test(e.hash)) throw corrupt(`${source} files[${i}].hash 格式异常`);
    if (typeof e.bytes !== 'number' || !Number.isInteger(e.bytes) || e.bytes < 0)
      throw corrupt(`${source} files[${i}].bytes 格式异常`);
    return { path: e.path, hash: e.hash, bytes: e.bytes };
  });
  return {
    id,
    sessionId,
    boundarySeq,
    workspaceRoot,
    capturedAt,
    trigger: trigger as CheckpointTrigger,
    files: entries,
  };
}

/** tmp+rename 原子写（tmp 落同目录保 rename 同卷；写后即终形） */
async function atomicWrite(absPath: string, data: Buffer | string): Promise<void> {
  await mkdir(join(absPath, '..'), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, data);
  await rename(tmp, absPath);
}

/**
 * 清单面坏件 warn 去重账（进程级——05 §5.3 定形注「按 id 去重」）：list 面
 * 反复调用对同 id 坏件只报一次不刷屏。id 是坏件文件名（有界事件面——非
 * 无界增长位）。
 */
const warnedManifestIds = new Set<string>();

/**
 * 开快照仓（装配根/命令面一次性开——baseDir 惰性建：首次写 blob/manifest 时
 * mkdir recursive，空仓读面按空集处理不诊断）。
 */
export function openCheckpointStore(
  dataDir: string,
  options?: {
    /** 告警面（缺省 console.warn——清单面坏件隔离的上报位） */
    readonly warn?: (message: string) => void;
  },
): CheckpointStore {
  const baseDir = join(dataDir, 'data', 'checkpoint');
  const warn = options?.warn ?? ((message: string) => console.warn(message));
  /**
   * 在飞引用计数（05 §5.3 ckpt-gc 定形注——挖掘 15 轮）：hash → 已落 blob
   * 未入册 manifest 的在飞引用数。并发捕获交错窗（capture B 段一~段二的
   * await 边内，他路 prune 的引用扫描看不到 B 未落册的 blob → 误判无引用
   * 物理删除 → B 段二落册后引用悬空）由本计数豁免：writeBlob 先计数登记
   * 再写（写失败回滚）、saveManifest 落册时对 files 各 hash 注销（引用接管
   * 归引用扫描）、prune GC 判据=「无在册引用**且**在飞计数为零」。段一崩溃
   * 残留计数=该 blob 永豁免（内容寻址复写可归零——泄漏面=孤儿 blob 磁盘
   * 残留非正确性问题；GC 语义宁漏杀不误杀，与 N4 豁免集同向）。
   */
  const inflight = new Map<string, number>();
  /** 在飞计数 -1（归零即出册——登记/注销两向共用） */
  const releaseInflight = (hash: string): void => {
    const n = (inflight.get(hash) ?? 0) - 1;
    if (n <= 0) inflight.delete(hash);
    else inflight.set(hash, n);
  };
  /**
   * 恢复窗持有计数表（05 §5.3 ckpt-gc 延伸批——挖掘 16 轮）：manifest id →
   * 持有数。与 N4 参数集（capture 自身 prune 调用的单次豁免）分立两源：参数
   * 集辖「拍摄发起的这一次 prune」，本表辖「恢复窗全程的他路任意 prune」——
   * 段一豁免取两集并集。
   */
  const restoreHolders = new Map<string, number>();
  /**
   * 方法级串行链（05 §5.3 ckpt-gc 延伸批——挖掘 16 轮）：writeBlob（探测/写
   * 段）与 prune（检查/rm 段）互斥——闭包 promise 链尾接。辖「方法内窗」：
   * prune 段二 inflight 检查（同步）与 deleteBlob rm（await 边）之间，他路
   * writeBlob 在场跳写腿探测通过而不重写——rm 落地后「writeBlob 已确保在
   * 场」承诺悬空（后续落册即悬空引用）。串行化后两序只居其一：writeBlob
   * 全成后 prune 查（在飞计数 >0 跳过）或 prune 全成后 writeBlob 探测（缺席
   * → 重写落盘）。saveManifest/readBlob/deleteManifest 不入链——无 blob 在
   * 场性竞（引用账由在飞计数与引用扫描两层各辖一窗）。链失败不断链
   * （then(task, task) 形——前任异常不阻塞后任）。
   */
  let chainTail: Promise<void> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chainTail.then(task, task);
    chainTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    baseDir,

    async writeBlob(hash, content) {
      if (!BLOB_HASH_RE.test(hash)) throw corrupt(`blob 哈希格式异常：${hash}`);
      // 方法级串行链入队（ckpt-gc 延伸批）：探测/写段与 prune 段二检查/rm 段
      // 互斥——在场跳写腿的「探测通过」不再与 rm 落地交错
      await serialized(async () => {
        // 在飞登记先于写（ckpt-gc 定形注——落盘与入册之间的窗内 blob 不被
        // 并发 prune 误删；写失败下方回滚，未落盘不占在飞面）
        inflight.set(hash, (inflight.get(hash) ?? 0) + 1);
        try {
          const target = blobPath(baseDir, hash);
          try {
            await readFile(target);
            return; // 在场即跳过——内容寻址共享，同内容零重写（计数留给
            // saveManifest 注销——在场腿同样在「未入册」窗内）
          } catch {
            // 缺席——落盘（走原子写）
          }
          await atomicWrite(target, content);
        } catch (err) {
          releaseInflight(hash); // 写失败回滚计数
          throw err;
        }
      });
    },

    async readBlob(hash) {
      if (!BLOB_HASH_RE.test(hash)) throw corrupt(`blob 哈希格式异常：${hash}`);
      let content: Buffer;
      try {
        content = await readFile(blobPath(baseDir, hash));
      } catch {
        throw corrupt(`blob 缺席：${hash}`);
      }
      if (contentHash(content) !== hash) throw corrupt(`blob 哈希不符：${hash}`);
      return content;
    },

    async saveManifest(manifest) {
      // id 白名单校验（防路径注入——manifest id 亦是路径段）
      if (!MANIFEST_ID_RE.test(manifest.id)) throw corrupt(`manifest id 格式异常：${manifest.id}`);
      await atomicWrite(join(baseDir, 'manifests', `${manifest.id}.json`), JSON.stringify(manifest, null, 2));
      // 落册即引用接管（ckpt-gc 定形注）：files 各 hash 在飞计数注销——此后
      // 豁免归引用扫描（manifest 已在册，prune 引用集看得到）。写失败抛出则
      // 不注销（计数残留=安全向豁免，同段一崩溃残留形）
      for (const file of manifest.files) releaseInflight(file.hash);
    },

    async loadManifest(id) {
      if (!MANIFEST_ID_RE.test(id)) throw notFound(id);
      let text: string;
      try {
        text = await readFile(join(baseDir, 'manifests', `${id}.json`), 'utf8');
      } catch {
        throw notFound(id);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw corrupt(`manifest ${id} JSON 解析失败（${err instanceof Error ? err.message : String(err)}）`);
      }
      return validateManifest(raw, `manifest ${id}`);
    },

    async listManifests() {
      let names: string[];
      try {
        names = await readdir(join(baseDir, 'manifests'));
      } catch {
        return []; // 空仓/仓未建——空集不诊断
      }
      const loaded: CheckpointManifest[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -5);
        // 清单面坏形隔离（05 §5.3 定形注——十六役扫 #4）：逐条包住定点读，
        // 坏件跳过不入清单（隔离件不入引用面——blob 由 GC 回收；文件留置
        // 不自动删），warn 按 id 进程内去重。定点读（loadManifest/restore）
        // 维持 fail-loud 宁拒不误读——修前清单坏一件全 list 抛
        // CHECKPOINT_STORE_CORRUPT，capture→prune→listManifests 放大链使
        // 全变异工具 fail-closed 拒（gate 域闸面被单坏件钉死）
        try {
          loaded.push(await this.loadManifest(id));
        } catch (err) {
          if (!warnedManifestIds.has(id)) {
            warnedManifestIds.add(id);
            warn(`[checkpoint] 清单面坏件已隔离（id ${id}）：${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      // capturedAt 降序（同刻 id 决胜——确定性序；最新在前）
      loaded.sort((a, b) => b.capturedAt - a.capturedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return loaded;
    },

    async deleteManifest(id) {
      if (!MANIFEST_ID_RE.test(id)) return; // 坏形 id 无文件可删——幂等 no-op
      await rm(join(baseDir, 'manifests', `${id}.json`), { force: true });
    },

    async listBlobHashes() {
      const hashes: string[] = [];
      let prefixDirs: string[];
      try {
        prefixDirs = await readdir(join(baseDir, 'blobs'));
      } catch {
        return []; // 空仓——空集
      }
      for (const prefix of prefixDirs.sort()) {
        let names: string[] = [];
        try {
          names = await readdir(join(baseDir, 'blobs', prefix));
        } catch {
          continue; // 竞态消失——跳过
        }
        for (const name of names.sort()) {
          if (BLOB_HASH_RE.test(name)) hashes.push(name);
        }
      }
      return hashes;
    },

    async deleteBlob(hash) {
      if (!BLOB_HASH_RE.test(hash)) return;
      await rm(blobPath(baseDir, hash), { force: true });
    },

    async prune(protectedIds) {
      // 方法级串行链入队（ckpt-gc 延伸批）：段一+段二整体与 writeBlob 互斥
      // （prune 非热路径——捕获后调一次，整段入链取最强隔离；箭头函数词法
      // this 仍指本对象）
      return serialized(async (): Promise<{ removedManifests: number; removedBlobs: number }> => {
        /* ---- 段一：per workspace 保留帽（trigger 两形同计） ---- */
        const all = await this.listManifests();
        const byWorkspace = new Map<string, CheckpointManifest[]>();
        for (const m of all) {
          const bucket = byWorkspace.get(m.workspaceRoot);
          if (bucket !== undefined) bucket.push(m);
          else byWorkspace.set(m.workspaceRoot, [m]);
        }
        let removedManifests = 0;
        for (const [, bucket] of byWorkspace) {
          // listManifests 已 capturedAt 降序——保前 N 删余；豁免件不入淘汰
          // （十六役补扫 N4 恢复目标保护：帽外多留是恢复窗瞬态，非稳态）
          for (const stale of bucket.slice(CHECKPOINT_RETENTION_PER_WORKSPACE)) {
            // 豁免并集（ckpt-gc 延伸批）：参数集（N4 拍摄自身 prune 的单次
            // 豁免）∪ store 集（restore 窗全程持有的他路任意 prune 豁免）
            if (protectedIds?.has(stale.id) || (restoreHolders.get(stale.id) ?? 0) > 0) continue;
            await this.deleteManifest(stale.id);
            removedManifests += 1;
          }
        }

        /* ---- 段二：blob 引用计数 GC（扫全仓在册 manifest——跨 workspace 共享不误杀） ---- */
        const referenced = new Set<string>();
        for (const m of await this.listManifests()) {
          for (const f of m.files) referenced.add(f.hash);
        }
        let removedBlobs = 0;
        for (const hash of await this.listBlobHashes()) {
          if (referenced.has(hash)) continue;
          // 在飞豁免（ckpt-gc 定形注——挖掘 15 轮）：已落盘未入册的并发捕获
          // blob 不误删（宁漏杀不误杀——误杀毁 restore 不可逆，漏杀只占盘）
          if ((inflight.get(hash) ?? 0) > 0) continue;
          await this.deleteBlob(hash);
          removedBlobs += 1;
        }
        return { removedManifests, removedBlobs };
      });
    },

    protect(id) {
      restoreHolders.set(id, (restoreHolders.get(id) ?? 0) + 1);
    },

    release(id) {
      const n = (restoreHolders.get(id) ?? 0) - 1;
      if (n <= 0) restoreHolders.delete(id);
      else restoreHolders.set(id, n);
    },
  };
}

/** 回退点缺席折 NOT_FOUND（已裁剪或坏 id） */
function notFound(id: string): BaseError {
  return new BaseError('CHECKPOINT_NOT_FOUND', `[CHECKPOINT_NOT_FOUND] 回退点不存在或已裁剪：${id}`);
}
