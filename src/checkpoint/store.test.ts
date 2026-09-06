/**
 * store 测试——blob 仓/manifest CRUD/坏形两分/裁剪帽+引用计数 GC 的回归锁
 * （05 §5.3 批 15d）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHash, openCheckpointStore, type CheckpointStore } from './store.js';
import { CHECKPOINT_RETENTION_PER_WORKSPACE, type CheckpointManifest } from './types.js';

let dir: string;
let store: CheckpointStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'berry-checkpoint-store-'));
  store = openCheckpointStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** manifest 快捷构造（默认单文件） */
function manifest(overrides: Partial<CheckpointManifest> = {}): CheckpointManifest {
  return {
    id: 'm1',
    sessionId: 's1',
    boundarySeq: 3,
    workspaceRoot: '/tmp/ws-a',
    capturedAt: 1_000,
    trigger: 'mutation',
    files: [{ path: 'a.txt', hash: 'a'.repeat(64), bytes: 1 }],
    ...overrides,
  };
}

describe('blob 仓', () => {
  it('写后读回 + 内容寻址哈希核（读侧校验 STORE_CORRUPT）', async () => {
    const content = Buffer.from('hello checkpoint');
    const hash = contentHash(content);
    await store.writeBlob(hash, content);
    expect(await store.readBlob(hash)).toEqual(content);
    expect(await store.listBlobHashes()).toEqual([hash]);
  });

  it('同内容重写跳过（在场零重写——共享去重）', async () => {
    const content = Buffer.from('dup');
    const hash = contentHash(content);
    await store.writeBlob(hash, content);
    await store.writeBlob(hash, content); // 二次写 no-op
    expect(await store.readBlob(hash)).toEqual(content);
  });

  it('缺席 blob 读 = STORE_CORRUPT（fail-loud 宁拒不误读）', async () => {
    await expect(store.readBlob('b'.repeat(64))).rejects.toMatchObject({
      code: 'CHECKPOINT_STORE_CORRUPT',
    });
  });

  it('哈希不符 = STORE_CORRUPT（位腐检测）', async () => {
    const content = Buffer.from('rotten');
    const hash = contentHash(content);
    await store.writeBlob(hash, content);
    // 篡改 blob 文件内容（模拟位腐）
    const target = join(store.baseDir, 'blobs', hash.slice(0, 2), hash);
    await writeFile(target, 'tampered!!');
    await expect(store.readBlob(hash)).rejects.toMatchObject({ code: 'CHECKPOINT_STORE_CORRUPT' });
  });

  it('坏形哈希拒绝（路径段白名单——防注入）', async () => {
    await expect(store.readBlob('../../etc/passwd')).rejects.toMatchObject({
      code: 'CHECKPOINT_STORE_CORRUPT',
    });
  });

  it('删幂等（缺席 no-op）', async () => {
    const hash = contentHash(Buffer.from('gone'));
    await store.writeBlob(hash, Buffer.from('gone'));
    await store.deleteBlob(hash);
    await store.deleteBlob(hash);
    expect(await store.listBlobHashes()).toEqual([]);
  });
});

describe('manifest CRUD', () => {
  it('存取往返（JSON 落盘形态）', async () => {
    const m = manifest();
    await store.saveManifest(m);
    expect(await store.loadManifest('m1')).toEqual(m);
    expect((await store.listManifests()).map((x) => x.id)).toEqual(['m1']);
  });

  it('缺席 = NOT_FOUND（已裁剪或坏 id）', async () => {
    await expect(store.loadManifest('missing')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
  });

  it('路径注入形 id 拒（NOT_FOUND——不触盘）', async () => {
    await expect(store.loadManifest('../../secrets')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });
  });

  it('坏 JSON = STORE_CORRUPT', async () => {
    await mkdir(join(store.baseDir, 'manifests'), { recursive: true });
    await writeFile(join(store.baseDir, 'manifests', 'bad.json'), '{not json', 'utf8');
    await expect(store.loadManifest('bad')).rejects.toMatchObject({ code: 'CHECKPOINT_STORE_CORRUPT' });
  });

  it('字段坏形 = STORE_CORRUPT（boundarySeq 负二/trigger 串坏/files 非对象逐格）', async () => {
    await mkdir(join(store.baseDir, 'manifests'), { recursive: true });
    const base = manifest({ id: 'shape' });
    for (const [field, value] of [
      ['boundarySeq', -2],
      ['trigger', 'cron'],
      ['sessionId', ''],
    ] as const) {
      await writeFile(
        join(store.baseDir, 'manifests', 'shape.json'),
        JSON.stringify({ ...base, [field]: value }),
        'utf8',
      );
      await expect(store.loadManifest('shape')).rejects.toMatchObject({ code: 'CHECKPOINT_STORE_CORRUPT' });
    }
    await writeFile(
      join(store.baseDir, 'manifests', 'shape.json'),
      JSON.stringify({ ...base, files: [{ path: 'a.txt', hash: 'zz', bytes: 1 }] }),
      'utf8',
    );
    await expect(store.loadManifest('shape')).rejects.toMatchObject({ code: 'CHECKPOINT_STORE_CORRUPT' });
  });

  it('listManifests capturedAt 降序（同刻 id 决胜——确定性序）', async () => {
    await store.saveManifest(manifest({ id: 'b', capturedAt: 2_000 }));
    await store.saveManifest(manifest({ id: 'a', capturedAt: 2_000 }));
    await store.saveManifest(manifest({ id: 'c', capturedAt: 3_000 }));
    expect((await store.listManifests()).map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('空仓 list = 空集不诊断', async () => {
    expect(await store.listManifests()).toEqual([]);
    expect(await store.listBlobHashes()).toEqual([]);
  });
});

describe('prune（裁剪帽 + 引用计数 GC）', () => {
  it('per workspace 保最新 N（trigger 两形同计）——旧 manifest 删', async () => {
    // ws-a 造 N+2 份；ws-b 造 1 份（他工作区不受牵连）
    for (let i = 0; i < CHECKPOINT_RETENTION_PER_WORKSPACE + 2; i++) {
      await store.saveManifest(manifest({ id: `a${i}`, capturedAt: 1_000 + i }));
    }
    await store.saveManifest(manifest({ id: 'b0', workspaceRoot: '/tmp/ws-b', capturedAt: 5 }));
    const receipt = await store.prune();
    expect(receipt.removedManifests).toBe(2);
    const left = await store.listManifests();
    expect(
      left
        .filter((m) => m.workspaceRoot === '/tmp/ws-a')
        .map((m) => m.id)
        .sort(),
    ).toEqual([...Array.from({ length: CHECKPOINT_RETENTION_PER_WORKSPACE }, (_, i) => `a${i + 2}`).sort()]);
    expect(left.some((m) => m.id === 'b0')).toBe(true);
  });

  it('blob 引用计数 GC：无引用删、在册引用留、跨 workspace 共享不误杀', async () => {
    // 共享内容（同哈希两 workspace manifest 各引一次）
    const shared = Buffer.from('shared-content');
    const sharedHash = contentHash(shared);
    const solo = Buffer.from('solo-content');
    const soloHash = contentHash(solo);
    const orphan = Buffer.from('orphan-content');
    const orphanHash = contentHash(orphan);
    await store.writeBlob(sharedHash, shared);
    await store.writeBlob(soloHash, solo);
    await store.writeBlob(orphanHash, orphan);
    await store.saveManifest(
      manifest({
        id: 'a',
        files: [
          { path: 'f.txt', hash: sharedHash, bytes: shared.byteLength },
          { path: 'g.txt', hash: soloHash, bytes: solo.byteLength },
        ],
      }),
    );
    await store.saveManifest(
      manifest({
        id: 'b',
        workspaceRoot: '/tmp/ws-b',
        files: [{ path: 'f.txt', hash: sharedHash, bytes: shared.byteLength }],
      }),
    );
    const receipt = await store.prune();
    expect(receipt.removedBlobs).toBe(1); // orphan 独死
    const alive = await store.listBlobHashes();
    expect(alive).toContain(sharedHash); // 双 workspace 引用——共享不误杀
    expect(alive).toContain(soloHash);
    expect(alive).not.toContain(orphanHash);
  });

  it('被裁 manifest 的独占 blob 随之清扫（帽裁 → 引用消失 → GC 删）', async () => {
    // 造 N+1 份，每份独占一个 blob；prune 后最旧 manifest 及其 blob 双清
    for (let i = 0; i < CHECKPOINT_RETENTION_PER_WORKSPACE + 1; i++) {
      const content = Buffer.from(`content-${i}`);
      const hash = contentHash(content);
      await store.writeBlob(hash, content);
      await store.saveManifest(
        manifest({ id: `m${i}`, capturedAt: 1_000 + i, files: [{ path: 'f', hash, bytes: content.byteLength }] }),
      );
    }
    const receipt = await store.prune();
    expect(receipt.removedManifests).toBe(1);
    expect(receipt.removedBlobs).toBe(1);
    expect((await store.listBlobHashes()).length).toBe(CHECKPOINT_RETENTION_PER_WORKSPACE);
  });

  it('manifest 落盘即原子（无 .tmp 残留）', async () => {
    await store.saveManifest(manifest());
    const files = await import('node:fs/promises').then((fs) => fs.readdir(join(store.baseDir, 'manifests')));
    expect(files).toEqual(['m1.json']);
    expect(existsSync(join(store.baseDir, 'manifests', 'm1.json'))).toBe(true);
    // 读回内容为合法 JSON（tmp+rename 终形）
    expect(JSON.parse(await readFile(join(store.baseDir, 'manifests', 'm1.json'), 'utf8')).id).toBe('m1');
  });
});
