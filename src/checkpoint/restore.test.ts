/**
 * restore 测试——/rewind 两段事务回归锁（05 §5.3 批 15d）：preview 零改动
 * 对账 / restore 三步序（保底拍→文件恢复→fork）/ 幂等收敛 / 空目录清剪 /
 * veto 不回滚文件 / blob 缺席 STORE_CORRUPT。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture } from './capture.js';
import { openCheckpointStore, type CheckpointStore } from './store.js';
import { previewRewind, restoreRewind } from './restore.js';
import type { RewindForkFace } from './types.js';

let dataDir: string;
let ws: string;
let store: CheckpointStore;
/** 可拨时钟与 id 序（确定性断言） */
let clock: number;
let idSeq: number;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'berry-checkpoint-restore-data-'));
  ws = await mkdtemp(join(tmpdir(), 'berry-checkpoint-restore-ws-'));
  store = openCheckpointStore(dataDir);
  clock = 1_000;
  idSeq = 0;
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(ws, { recursive: true, force: true });
});

/** 注入时钟/id 的捕获面 */
function capture() {
  return createCapture(store, {
    now: () => clock,
    newId: () => `id${String((idSeq += 1)).padStart(2, '0')}`,
  });
}

/** fork 假件（记录调用 + 可编程 veto） */
function fakeFork(opts: { veto?: string } = {}) {
  const calls: Array<{ source: string; upToSeq: number; title?: string }> = [];
  const fork: RewindForkFace = {
    fork: async (source, options) => {
      calls.push({ source, upToSeq: options.upToSeq, title: options.title });
      if (opts.veto !== undefined) return { status: 'vetoed', reason: opts.veto };
      return { status: 'forked', sessionId: `forked-${calls.length}` };
    },
  };
  return { fork, calls };
}

/** 工作区建文件 */
async function put(rel: string, content: string): Promise<void> {
  const abs = join(ws, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

/** 读工作区文件文本 */
async function read(rel: string): Promise<string> {
  return readFile(join(ws, rel), 'utf8');
}

describe('previewRewind（段一——零改动承诺）', () => {
  it('对账三账：恢复 N（异）/ 删除 M（新）/ 不动 U（同）；零改动', async () => {
    await put('same.txt', 'stable');
    await put('will-change.txt', 'v1');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 3, workspaceRoot: ws, trigger: 'mutation' });
    // 快照后工作区演化：改一/删一/增一
    await put('will-change.txt', 'v2');
    await rm(join(ws, 'same.txt'));
    await put('brand-new.txt', 'extra');

    const result = await previewRewind(store, m1.id);
    expect(result.restoreCount).toBe(2); // will-change（异）+ same（缺席）
    expect(result.deleteCount).toBe(1); // brand-new（manifest 外）
    expect(result.untouchedCount).toBe(0);
    // 零改动承诺：演化态原样保留
    expect(await read('will-change.txt')).toBe('v2');
    expect(existsSync(join(ws, 'brand-new.txt'))).toBe(true);
    expect(existsSync(join(ws, 'same.txt'))).toBe(false);
  });

  it('快照即现状 = 全不动（U 全额）', async () => {
    await put('a.txt', 'a');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 0, workspaceRoot: ws, trigger: 'mutation' });
    const result = await previewRewind(store, m1.id);
    expect(result).toMatchObject({ restoreCount: 0, deleteCount: 0, untouchedCount: 1 });
  });

  it('缺席 id = NOT_FOUND', async () => {
    await expect(previewRewind(store, 'nope')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
  });
});

describe('restoreRewind（段二——三步序）', () => {
  it('全步序：pre-rewind 保底拍在场 + 文件真恢复 + fork 净边界', async () => {
    await put('app.txt', 'v1');
    await put('nested/deep/file.txt', 'deep-v1');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 7, workspaceRoot: ws, trigger: 'mutation' });
    // 演化：改/增/删
    await put('app.txt', 'v2-mutated');
    await put('junk/extra.txt', 'junk');
    await rm(join(ws, 'nested/deep/file.txt'));

    const { fork, calls } = fakeFork();
    clock = 2_000;
    const receipt = await restoreRewind({ store, fork }, m1.id);

    // ① 保底快照：演化态（v2-mutated/junk）先拍——rewind 自身可回退
    expect(receipt.preRewindId).not.toBe(m1.id);
    const pre = await store.loadManifest(receipt.preRewindId);
    expect(pre.trigger).toBe('pre-rewind');
    const prePaths = pre.files.map((f) => f.path).sort();
    expect(prePaths).toContain('app.txt');
    expect(prePaths).toContain('junk/extra.txt');
    expect((await store.readBlob(pre.files.find((f) => f.path === 'app.txt')!.hash)).toString('utf8')).toBe(
      'v2-mutated',
    );

    // ② 文件真恢复：改回 v1、深层文件补回、junk 删除（空目录清剪）
    expect(await read('app.txt')).toBe('v1');
    expect(await read('nested/deep/file.txt')).toBe('deep-v1');
    expect(existsSync(join(ws, 'junk/extra.txt'))).toBe(false);
    expect(existsSync(join(ws, 'junk'))).toBe(false); // 空目录清剪（自底向上）
    expect(receipt).toMatchObject({ restoredCount: 2, deletedCount: 1, untouchedCount: 0 });

    // ③ fork：upToSeq = manifest 边界（净边界——不在进行中 turn 中间切）
    expect(calls).toEqual([{ source: 's1', upToSeq: 7, title: `rewind:${m1.id}` }]);
    expect(receipt.forkedSessionId).toBe('forked-1');
  });

  it('哈希同不写（保 mtime——untouched 全额）', async () => {
    await put('stable.txt', 'same');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 0, workspaceRoot: ws, trigger: 'mutation' });
    const before = await import('node:fs').then((fs) => fs.statSync(join(ws, 'stable.txt')).mtimeMs);
    const { fork } = fakeFork();
    const receipt = await restoreRewind({ store, fork }, m1.id);
    expect(receipt.untouchedCount).toBe(1);
    expect(receipt.restoredCount).toBe(0);
    const after = await import('node:fs').then((fs) => fs.statSync(join(ws, 'stable.txt')).mtimeMs);
    expect(after).toBe(before); // 未重写——mtime 不动
  });

  it('重跑幂等收敛：二跑 restore 同 manifest 全不动、fork 再开新会话', async () => {
    await put('a.txt', 'v1');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 0, workspaceRoot: ws, trigger: 'mutation' });
    await put('a.txt', 'v2');
    await put('b.txt', 'late');
    const { fork, calls } = fakeFork();
    const first = await restoreRewind({ store, fork }, m1.id);
    expect(first).toMatchObject({ restoredCount: 1, deletedCount: 1, untouchedCount: 0 });
    const second = await restoreRewind({ store, fork }, m1.id);
    expect(second).toMatchObject({ restoredCount: 0, deletedCount: 0, untouchedCount: 1 });
    expect(second.forkedSessionId).toBe('forked-2'); // fork 腿重跑另开（v1 诚实边界）
    expect(calls).toHaveLength(2);
    expect(await read('a.txt')).toBe('v1');
    expect(existsSync(join(ws, 'b.txt'))).toBe(false);
  });

  it('回退到空 manifest：恢复到空工作区（删除全部）', async () => {
    // 空 workspace 快照（files: [] 合法形态）
    const empty = await capture()({ sessionId: 's1', boundarySeq: -1, workspaceRoot: ws, trigger: 'mutation' });
    await put('late.txt', 'late');
    const { fork } = fakeFork();
    const receipt = await restoreRewind({ store, fork }, empty.id);
    expect(receipt).toMatchObject({ restoredCount: 0, deletedCount: 1, untouchedCount: 0 });
    expect(existsSync(join(ws, 'late.txt'))).toBe(false);
    expect(existsSync(ws)).toBe(true); // 根不删
  });

  it('保底快照归属发起会话 + 边界取自会话语境（缺省 -1）', async () => {
    await put('a.txt', 'v1');
    const m1 = await capture()({ sessionId: 'origin-session', boundarySeq: 4, workspaceRoot: ws, trigger: 'mutation' });
    await put('a.txt', 'v2');
    const { fork } = fakeFork();
    clock = 5_000;
    const receipt = await restoreRewind(
      {
        store,
        fork,
        invokingSessionId: 'caller-session',
        session: { contextOf: () => ({ lastClosedBoundary: 12, workspaceRoot: ws }) },
      },
      m1.id,
    );
    const pre = await store.loadManifest(receipt.preRewindId);
    expect(pre).toMatchObject({ sessionId: 'caller-session', boundarySeq: 12, trigger: 'pre-rewind' });
    // fork 仍指 manifest 原会话（旧史保留的锚）
    expect((await store.listManifests()).some((m) => m.id === m1.id)).toBe(true);
  });

  it('fork veto：文件恢复不回滚——回执诚实报 vetoReason（痕迹链完整）', async () => {
    await put('a.txt', 'v1');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 0, workspaceRoot: ws, trigger: 'mutation' });
    await put('a.txt', 'v2');
    const { fork } = fakeFork({ veto: 'session_before_fork：会话在飞' });
    const receipt = await restoreRewind({ store, fork }, m1.id);
    expect(receipt.forkedSessionId).toBeUndefined();
    expect(receipt.vetoReason).toContain('session_before_fork');
    expect(await read('a.txt')).toBe('v1'); // 文件已恢复——规范序不回滚
  });

  it('blob 缺席 = STORE_CORRUPT（fail-loud——删 blob 后恢复拒绝误拼）', async () => {
    await put('a.txt', 'v1');
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 0, workspaceRoot: ws, trigger: 'mutation' });
    await put('a.txt', 'v2');
    await store.deleteBlob(m1.files[0]!.hash);
    const { fork } = fakeFork();
    await expect(restoreRewind({ store, fork }, m1.id)).rejects.toMatchObject({
      code: 'CHECKPOINT_STORE_CORRUPT',
    });
  });
});

describe('gitignore 域一致性（walk 域内真恢复）', () => {
  it('快照后被 ignore 的文件不删（walk 域一致性——两遍同判）', async () => {
    await put('tracked.txt', 't');
    await put('noise.log', 'n');
    await writeFile(join(ws, '.gitignore'), 'noise.log\n', 'utf8');
    // 注意：.gitignore 写在快照前——noise.log 从未入册
    const m1 = await capture()({ sessionId: 's1', boundarySeq: 0, workspaceRoot: ws, trigger: 'mutation' });
    const { fork } = fakeFork();
    const receipt = await restoreRewind({ store, fork }, m1.id);
    // noise.log 不在 manifest（快照时已被 ignore）也不在当前 walk 域——不删
    expect(receipt.deletedCount).toBe(0);
    expect(existsSync(join(ws, 'noise.log'))).toBe(true);
  });
});
