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
 * CHECKPOINT_STORE_CORRUPT（fail-loud 宁拒不误读）。id/hash 是路径段——
 * 白名单字符校验防路径注入（/rewind 的 id 来自用户输入面）。
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
  /** 全部 manifest（capturedAt 降序；坏形 fail-loud 同 loadManifest） */
  listManifests(): Promise<CheckpointManifest[]>;
  /** 删 manifest 文件（幂等——缺席 no-op） */
  deleteManifest(id: string): Promise<void>;
  /** 全仓 blob 哈希清单（GC 扫描面） */
  listBlobHashes(): Promise<string[]>;
  /** 删 blob（幂等；GC 终步——仅无引用哈希可进） */
  deleteBlob(hash: string): Promise<void>;
  /** 裁剪+GC（per workspace 保留帽 + 引用计数清扫）；回执删除计数 */
  prune(): Promise<{ removedManifests: number; removedBlobs: number }>;
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
  return new BaseError('CHECKPOINT_STORE_CORRUPT', `[CHECKPOINT_STORE_CORRUPT] 快照仓坏形：${detail}`);
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
  if (typeof id !== 'string' || !MANIFEST_ID_RE.test(id)) throw corrupt(`${source} id 坏形`);
  if (typeof sessionId !== 'string' || sessionId === '') throw corrupt(`${source} sessionId 坏形`);
  if (typeof boundarySeq !== 'number' || !Number.isInteger(boundarySeq) || boundarySeq < -1)
    throw corrupt(`${source} boundarySeq 坏形`);
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') throw corrupt(`${source} workspaceRoot 坏形`);
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) throw corrupt(`${source} capturedAt 坏形`);
  if (trigger !== 'mutation' && trigger !== 'pre-rewind') throw corrupt(`${source} trigger 坏形`);
  if (!Array.isArray(files)) throw corrupt(`${source} files 非数组`);
  const entries = files.map((f, i) => {
    if (typeof f !== 'object' || f === null) throw corrupt(`${source} files[${i}] 非对象`);
    const e = f as Record<string, unknown>;
    if (typeof e.path !== 'string' || e.path === '') throw corrupt(`${source} files[${i}].path 坏形`);
    if (typeof e.hash !== 'string' || !BLOB_HASH_RE.test(e.hash)) throw corrupt(`${source} files[${i}].hash 坏形`);
    if (typeof e.bytes !== 'number' || !Number.isInteger(e.bytes) || e.bytes < 0)
      throw corrupt(`${source} files[${i}].bytes 坏形`);
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
 * 开快照仓（装配根/命令面一次性开——baseDir 惰性建：首次写 blob/manifest 时
 * mkdir recursive，空仓读面按空集处理不诊断）。
 */
export function openCheckpointStore(dataDir: string): CheckpointStore {
  const baseDir = join(dataDir, 'data', 'checkpoint');

  return {
    baseDir,

    async writeBlob(hash, content) {
      if (!BLOB_HASH_RE.test(hash)) throw corrupt(`blob 哈希坏形：${hash}`);
      const target = blobPath(baseDir, hash);
      try {
        await readFile(target);
        return; // 在场即跳过——内容寻址共享，同内容零重写
      } catch {
        // 缺席——落盘（走原子写）
      }
      await atomicWrite(target, content);
    },

    async readBlob(hash) {
      if (!BLOB_HASH_RE.test(hash)) throw corrupt(`blob 哈希坏形：${hash}`);
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
      if (!MANIFEST_ID_RE.test(manifest.id)) throw corrupt(`manifest id 坏形：${manifest.id}`);
      await atomicWrite(join(baseDir, 'manifests', `${manifest.id}.json`), JSON.stringify(manifest, null, 2));
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
        loaded.push(await this.loadManifest(name.slice(0, -5)));
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

    async prune() {
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
        // listManifests 已 capturedAt 降序——保前 N 删余
        for (const stale of bucket.slice(CHECKPOINT_RETENTION_PER_WORKSPACE)) {
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
        await this.deleteBlob(hash);
        removedBlobs += 1;
      }
      return { removedManifests, removedBlobs };
    },
  };
}

/** 回退点缺席折 NOT_FOUND（已裁剪或坏 id） */
function notFound(id: string): BaseError {
  return new BaseError('CHECKPOINT_NOT_FOUND', `[CHECKPOINT_NOT_FOUND] 回退点不存在或已裁剪：${id}`);
}
