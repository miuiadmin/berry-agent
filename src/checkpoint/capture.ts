/**
 * checkpoint 捕获执行（05 §5.3 批 15d——walk+hash+落仓+裁剪的单遍编舞）。
 *
 * 捕获序：枚举 walk 域（walk.ts 判据）→ 逐文件单遍读+哈希（读一次同时喂
 * blob 写与 manifest 条目——无双读）→ blob 落仓（内容寻址去重）→ manifest
 * 落仓 → prune（per workspace 保留帽 + blob 引用计数 GC）。
 *
 * 失败语义：walk/读文件/blob 写任一失败抛 CHECKPOINT_CAPTURE_FAILED——
 * gate 侧折 fail-closed block（快照是 rewind 语义承诺的前提，拍不了就放行
 * 变异 = 伪承诺）。空工作区合法（files: [] 的 manifest——恢复到空也是回退点）。
 */
import { randomUUID } from 'node:crypto';
import { contentHash, type CheckpointStore } from './store.js';
import type { CheckpointManifest, CheckpointTrigger } from './types.js';
import { readWorkspaceFile, walkWorkspaceFiles } from './walk.js';

/** 捕获面（gate/restore 共用——mutation 拍与 pre-rewind 保底拍同一执行体） */
export type CaptureFn = (input: {
  sessionId: string;
  boundarySeq: number;
  workspaceRoot: string;
  trigger: CheckpointTrigger;
}) => Promise<CheckpointManifest>;

/** 捕获构造选项（测试面注入时钟与 id 源——确定性断言） */
export interface CaptureOptions {
  /** 时钟（缺省 Date.now） */
  now?: () => number;
  /** manifest id 源（缺省 randomUUID） */
  newId?: () => string;
}

/** 组装捕获面（openCheckpointStore 的伴生件——装配根一并接线） */
export function createCapture(store: CheckpointStore, opts: CaptureOptions = {}): CaptureFn {
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? randomUUID;
  return async ({ sessionId, boundarySeq, workspaceRoot, trigger }) => {
    // 段一：枚举 + 单遍读哈希（IO 失败由 walk/readWorkspaceFile 折 CAPTURE_FAILED）
    const walked = await walkWorkspaceFiles(workspaceRoot);
    const entries: { path: string; hash: string; bytes: number }[] = [];
    for (const file of walked) {
      const content = await readWorkspaceFile(file.absPath);
      const hash = contentHash(content);
      await store.writeBlob(hash, content);
      entries.push({ path: file.path, hash, bytes: content.byteLength });
    }

    // 段二：manifest 落仓（id = uuid——/rewind 作用目标键）
    const manifest: CheckpointManifest = {
      id: newId(),
      sessionId,
      boundarySeq,
      workspaceRoot,
      capturedAt: now(),
      trigger,
      files: entries,
    };
    await store.saveManifest(manifest);

    // 段三：裁剪编舞（每次捕获后跑——保留帽 + 引用计数 GC；失败不回滚本次
    // 落仓：prune 是维护面，异常上抛交调用方诊断，快照本体已原子在册）
    await store.prune();
    return manifest;
  };
}
