/**
 * store 测试——blob 仓/manifest CRUD/坏形两分/裁剪帽+引用计数 GC 的回归锁
 * （05 §5.3 批 15d）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('ckpt-gc（挖掘 15 轮）：并发捕获交错窗——段一 blob 未入册不被他人 prune 误删（在飞豁免）+ 引用接管闭环', async () => {
    // 交错序确定性钉死（05 §5.3 ckpt-gc 定形注）：capture B 段一（writeBlob
    // 落盘）→ capture A 段三（prune 引用扫描——B 的 manifest 未在册，引用集
    // 看不到该 blob）→ 修前：误判无引用物理删除 → B 段二落册后引用悬空
    // （restore readBlob blob 缺席——快照毁于维护面）
    const content = Buffer.from('in-flight 保护对象');
    const hash = contentHash(content);
    await store.writeBlob(hash, content); // B 段一（blob 落盘、manifest 未落）
    await store.prune(); // A 段三（并发捕获的裁剪编舞）
    await store.saveManifest(manifest({ id: 'm-if', files: [{ path: 'x.txt', hash, bytes: content.byteLength }] })); // B 段二（落册引用）
    // 修前红锚：blob 被误删 → readBlob 缺席 corrupt 抛；修后：在飞计数豁免
    await expect(store.readBlob(hash)).resolves.toEqual(content);
    // 引用接管闭环：saveManifest 已注销在飞计数、册在引用集接管——豁免非
    // 永久泄漏；删册释放引用后 prune 可正常回收（宁漏杀不误杀的正反面）
    await store.deleteManifest('m-if');
    const result = await store.prune();
    expect(result.removedBlobs).toBe(1);
    expect(await store.listBlobHashes()).toEqual([]);
  });

  it('ckpt-串行链（挖掘 16 轮）：prune 检查/rm 窗内他路 writeBlob 在场跳写腿——串行后恒重写落盘不悬空（修前：探测通过不重写、rm 落地引用悬空）', async () => {
    // 交错序确定性钉死（05 §5.3 ckpt-gc 延伸批定形注）：段二 inflight 检查
    //（同步，此刻在飞零）已过 → deleteBlob rm 待落地窗内他路 writeBlob 进场
    //——修前：在场跳写腿探测通过即返（不重写），rm 随后落地 →「writeBlob 已
    // 确保在场」承诺悬空（后续落册即悬空引用）。修后：方法级串行链令
    // writeBlob 排队至 prune 全成 → 探测缺席 → 重写落盘
    const content = Buffer.from('检查-后动窗对象');
    const hash = contentHash(content);
    // 真产面形构造无引用 blob（写 → 落册 → 删册释放引用——在飞计数归零，
    // 与生产孤儿形同构）
    const m = manifest({
      id: 'm-race',
      files: [{ path: 'x.txt', hash, bytes: content.byteLength }],
    });
    await store.writeBlob(hash, content);
    await store.saveManifest(m);
    await store.deleteManifest('m-race');
    // 钉交错：deleteBlob 被调（检查已过）时他路 writeBlob 同步进场，稍候令
    // 探测腿先行——修前形：探测在场通过跳写、rm 后落地
    let raceWrite: Promise<void> | undefined;
    const originalDelete = store.deleteBlob.bind(store);
    const spy = vi.spyOn(store, 'deleteBlob').mockImplementation(async (h: string) => {
      if (h === hash && raceWrite === undefined) {
        raceWrite = store.writeBlob(hash, content);
        await new Promise((resolve) => setTimeout(resolve, 10)); // 让探测腿先行
      }
      return originalDelete(h);
    });
    await store.prune();
    spy.mockRestore();
    await raceWrite; // 修前此笔「成功」返回但 blob 已被 rm（悬空）；修后排队重写
    await expect(store.readBlob(hash)).resolves.toEqual(content); // 在场承诺不悬空
  });

  it('ckpt-串行链二（挖掘 21 轮件8）：prune 引用快照后的落册窗——saveManifest 入链，快照不陈旧不误删（修前：快照无它 + 在飞归零双条件过 → 误删 → 落册引用悬空）', async () => {
    // 交错序确定性钉死：prune 段二 referenced 快照（listManifests 一次性）已拍
    // → listBlobHashes await 边内 saveManifest 落册（快照看不到）+ 注销在飞
    // 计数（inflight 归零）→ 循环到该 hash：referenced 快照无它 + inflight 0
    // 双条件过 → 误删 → 落册 manifest 引用悬空（restore readBlob blob 缺席）。
    // 修后：saveManifest 入链排队（链被 prune 持有）→ prune 循环时在飞计数
    // 仍 >0 豁免 → prune 出链后落册接管——串行化后两序只居其一
    const content = Buffer.from('快照陈旧窗对象');
    const hash = contentHash(content);
    await store.writeBlob(hash, content); // blob 落盘（在飞计数 1、册未落）
    const m = manifest({
      id: 'm-snapshot',
      files: [{ path: 'x.txt', hash, bytes: content.byteLength }],
    });
    // 钉交错：prune 段二的 listBlobHashes 被调时（referenced 快照已拍——
    // :375 先于 :379），同步发起 saveManifest 并稍候令其完成（修前不入链
    // 立即跑：落册 + 在飞注销归零）
    let raceSave: Promise<void> | undefined;
    const originalList = store.listBlobHashes.bind(store);
    const spy = vi.spyOn(store, 'listBlobHashes').mockImplementation(async () => {
      if (raceSave === undefined) {
        raceSave = store.saveManifest(m);
        await new Promise((resolve) => setTimeout(resolve, 10)); // 落册+注销落地
      }
      return originalList();
    });
    await store.prune();
    spy.mockRestore();
    await raceSave; // 修前：已「成功」落册但 blob 被 rm（引用悬空）；修后：排队落册接管
    // 修前红锚：blob 被误删 → readBlob corrupt 抛；修后：在飞豁免保住 + 引用接管
    await expect(store.readBlob(hash)).resolves.toEqual(content);
    // 引用接管闭环：删册释放引用后 prune 可回收（豁免非永久泄漏）
    await store.deleteManifest('m-snapshot');
    const result = await store.prune();
    expect(result.removedBlobs).toBe(1);
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

  it('files[].path 路径穿越形 = STORE_CORRUPT（白名单：禁绝对/..段/反斜杠/空段）', async () => {
    await mkdir(join(store.baseDir, 'manifests'), { recursive: true });
    const base = manifest({ id: 'evilpath' });
    for (const bad of ['../../escape.txt', '/etc/passwd', 'a\\b.txt', '..', 'a//b.txt', './a.txt']) {
      await writeFile(
        join(store.baseDir, 'manifests', 'evilpath.json'),
        JSON.stringify({ ...base, files: [{ path: bad, hash: 'a'.repeat(64), bytes: 1 }] }),
        'utf8',
      );
      // 修前：仅查非空 string——四形全过校验（restore join 消费可越出 workspaceRoot）
      await expect(store.loadManifest('evilpath')).rejects.toMatchObject({ code: 'CHECKPOINT_STORE_CORRUPT' });
    }
  });

  it('files[].path 合法相对形仍过（嵌套目录 posix 相对——walk 产物形态）', async () => {
    const m = manifest({ id: 'okpath', files: [{ path: 'sub/dir/a.txt', hash: 'b'.repeat(64), bytes: 3 }] });
    await store.saveManifest(m);
    expect((await store.loadManifest('okpath')).files[0]?.path).toBe('sub/dir/a.txt');
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

describe('清单面坏件隔离（十六役扫 #4——05 §5.3 定形注）', () => {
  it('坏件跳过不入清单 + warn 按 id 去重 + 定点读维持 fail-loud（修前红：坏一件全 list 抛 CORRUPT）', async () => {
    await store.saveManifest(manifest({ id: 'good1', capturedAt: 2_000 }));
    await store.saveManifest(manifest({ id: 'good2', capturedAt: 1_000 }));
    await mkdir(join(store.baseDir, 'manifests'), { recursive: true });
    // 坏件 id 测试内唯一（warnedManifestIds 进程级账跨测试存活——防互染）
    await writeFile(join(store.baseDir, 'manifests', 'iso1.json'), '{not json', 'utf8');
    const warned: string[] = [];
    const s2 = openCheckpointStore(dir, { warn: (m) => warned.push(m) });
    // 修前锚：s2.listManifests() 直接 reject CHECKPOINT_STORE_CORRUPT（坏一件钉死清单面）
    expect((await s2.listManifests()).map((m) => m.id)).toEqual(['good1', 'good2']);
    expect(warned.length).toBe(1);
    expect(warned[0]).toContain('清单面坏件已隔离（id iso1）');
    // 二次 list 同 id 不重复告警（进程级去重——反复调用不刷屏）
    expect((await s2.listManifests()).map((m) => m.id)).toEqual(['good1', 'good2']);
    expect(warned.length).toBe(1);
    // 定点读维持 fail-loud 宁拒不误读（隔离只在清单面）
    await expect(store.loadManifest('iso1')).rejects.toMatchObject({ code: 'CHECKPOINT_STORE_CORRUPT' });
    // 隔离件文件留置不自动删（blob 由 GC 回收、manifest 文件人工处置）
    expect(existsSync(join(store.baseDir, 'manifests', 'iso1.json'))).toBe(true);
  });

  it('prune 带坏件在场正常回执（修前红：capture→prune→listManifests 放大链抛 CORRUPT 拒全变异工具）', async () => {
    await store.saveManifest(manifest({ id: 'keep0', capturedAt: 1_000 }));
    await mkdir(join(store.baseDir, 'manifests'), { recursive: true });
    await writeFile(join(store.baseDir, 'manifests', 'iso2.json'), '[]', 'utf8');
    // 修前锚：prune 体内 listManifests 抛 CORRUPT——gate 域闸面被单坏件钉死（fail-closed 拒）
    const receipt = await store.prune();
    expect(receipt).toEqual({ removedManifests: 0, removedBlobs: 0 });
    expect((await store.listManifests()).map((m) => m.id)).toEqual(['keep0']);
    expect(existsSync(join(store.baseDir, 'manifests', 'iso2.json'))).toBe(true);
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

  it('保留帽豁免集（十六役补扫 N4）：豁免件不入淘汰 + 独占 blob 不被 GC；无豁免对照自毁形', async () => {
    // N+2 份（帽 10 + 2）：a0 最旧且持独占 blob（恢复目标形态）
    const unique = Buffer.from('protected-unique');
    const uniqueHash = contentHash(unique);
    await store.writeBlob(uniqueHash, unique);
    await store.saveManifest(
      manifest({ id: 'a0', capturedAt: 1, files: [{ path: 'u.txt', hash: uniqueHash, bytes: unique.byteLength }] }),
    );
    for (let i = 1; i < CHECKPOINT_RETENTION_PER_WORKSPACE + 2; i++) {
      await store.saveManifest(manifest({ id: `a${i}`, capturedAt: 1_000 + i }));
    }
    // 豁免 {a0}：12 份只删 a1（最旧非豁免件），a0 帽外多留
    const receipt = await store.prune(new Set(['a0']));
    expect(receipt.removedManifests).toBe(1);
    const ids = (await store.listManifests()).map((m) => m.id);
    expect(ids).not.toContain('a1');
    expect(ids).toContain('a0');
    expect(ids).toHaveLength(CHECKPOINT_RETENTION_PER_WORKSPACE + 1); // 帽 + 豁免件
    // 豁免件独占 blob 不被段二 GC（豁免件仍在引用面）
    expect(await store.listBlobHashes()).toContain(uniqueHash);
    // 对照（修前自毁形）：无豁免 prune 裁掉 a0 → 独占 blob 被 GC
    const receipt2 = await store.prune();
    expect(receipt2.removedManifests).toBe(1);
    expect((await store.listManifests()).map((m) => m.id)).not.toContain('a0');
    expect(await store.listBlobHashes()).not.toContain(uniqueHash);
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
    // orphan 构造（真 orphan 形——落册后删册释放引用；ckpt-gc 批后裸
    // writeBlob 不落册=段一崩溃残留形，属在飞豁免面〔永豁免——宁漏杀
    // 不误杀〕不再被 GC 回收）
    await store.writeBlob(orphanHash, orphan);
    await store.saveManifest(
      manifest({
        id: 'orphan-holder',
        files: [{ path: 'o.txt', hash: orphanHash, bytes: orphan.byteLength }],
      }),
    );
    await store.deleteManifest('orphan-holder');
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
