/**
 * tools/fs 测试 — fs 工具族四件真文件系统全景（04 §7：fence / CAS / 补丁定位 /
 * 写串行链）。
 *
 * 纪律：mock 零件——真 fs 走临时目录（每用例独立 mkdtemp，afterEach 清场）；
 * fence/CAS/序列化全是物理行为，必须真盘验证。直接调 ToolDefinition.execute
 * （管道编舞另测于 pipeline.test——此处聚焦 fs 语义）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseError } from '../contracts/index.js';
import type { AgentToolResult, TextContent, ToolDefinition } from '../contracts/index.js';
import { createFsTools } from './fs.js';
import type { FsTools } from './fs.js';

/* ---------------- 测试构造件 ---------------- */

/** 本用例临时工作区（fence 可写根）与根外目录（fence 拒绝面） */
let root: string;
let outside: string;
let rig: FsTools;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'berry-fs-in-'));
  outside = await mkdtemp(join(tmpdir(), 'berry-fs-out-'));
  rig = createFsTools({ workspace: () => root, writableRoots: () => [root] });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

/** 按名取工具定义（族内四件） */
function tool(name: string): ToolDefinition {
  const def = rig.tools.find((t) => t.name === name);
  if (def === undefined) throw new Error(`工具 ${name} 不在族内`);
  return def;
}

/** 执行工具（直接走 execute——管道编舞在 pipeline.test） */
function exec(name: string, args: Record<string, unknown>): Promise<AgentToolResult> {
  return tool(name).execute(args, { toolCallId: 'test-call' });
}

/** 断言异步拒绝码 */
async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toThrow(BaseError);
  await expect(p).rejects.toMatchObject({ code });
}

/** 取结果首文本（快捷断言面） */
function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  return (result.content[0] as TextContent).text ?? '';
}

describe('read（观察登记的唯一天然入口）', () => {
  it('读文本 + 登记 present 观察', async () => {
    await writeFile(join(root, 'a.txt'), 'hello 中文', 'utf8');
    const result = await exec('read', { path: 'a.txt' });
    expect(firstText(result)).toBe('hello 中文');
    expect(rig.observed.get(join(root, 'a.txt'))).toMatchObject({ state: 'present' });
  });

  it('不存在 → FS_NOT_FOUND 但登记 absent 观察（之后 write 创建即合法）', async () => {
    await expectCode(exec('read', { path: 'nope.txt' }), 'FS_NOT_FOUND');
    expect(rig.observed.get(join(root, 'nope.txt'))).toEqual({ state: 'absent' });
    // absent 观察的下游效应：write 创建合法（CAS 分派测试详见 write 组）
    const w = await exec('write', { path: 'nope.txt', content: 'created' });
    expect(firstText(w)).toContain('新建');
  });

  it('UTF-8 BOM 剥离照读（BOM 不是内容）', async () => {
    await writeFile(join(root, 'bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('content')]));
    const result = await exec('read', { path: 'bom.txt' });
    expect(firstText(result)).toBe('content');
  });

  it('非 UTF-8 字节 → FS_DECODE_NON_UTF8（绝不 mojibake 进上下文）', async () => {
    await writeFile(join(root, 'latin.txt'), Buffer.from([0xe9, 0x0a, 0x31])); // é\n1（latin-1 面）
    await expectCode(exec('read', { path: 'latin.txt' }), 'FS_DECODE_NON_UTF8');
  });

  it('超 maxReadBytes 保头截断 + 非静默注记', async () => {
    const smallCap = createFsTools({ workspace: () => root, writableRoots: () => [root], maxReadBytes: 8 });
    rig = smallCap; // 观察登记断言共用同 rig
    await writeFile(join(root, 'big.txt'), 'x'.repeat(20), 'utf8');
    const result = await exec('read', { path: 'big.txt' });
    const text = firstText(result);
    expect(text).toContain('已截断');
    expect(text.startsWith('xxxxxxxx')).toBe(true);
    expect(result.details).toMatchObject({ truncated: true });
  });

  it('图片分支：png 扩展名 → image 块（base64）+ present 观察', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    await writeFile(join(root, 'pic.png'), pngBytes);
    const result = await exec('read', { path: 'pic.png' });
    const image = result.content.find((c) => c.type === 'image') as { data: string; mimeType: string };
    expect(image.mimeType).toBe('image/png');
    expect(image.data).toBe(pngBytes.toString('base64'));
    expect(rig.observed.get(join(root, 'pic.png'))).toMatchObject({ state: 'present' });
  });

  it('图片超上限 → isError 拒绝不截断（模型可自纠）', async () => {
    const smallImageCap = createFsTools({
      workspace: () => root,
      writableRoots: () => [root],
      maxImageBytes: 4,
    });
    rig = smallImageCap;
    await writeFile(join(root, 'huge.png'), Buffer.alloc(10));
    const result = await exec('read', { path: 'huge.png' });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('图片过大');
  });
});

describe('write（观察态分派 + fence）', () => {
  it('未读 + 不在 → create-if-absent 新建（UTF-8 落盘 + 观察回填）', async () => {
    const result = await exec('write', { path: 'new.txt', content: '第一行\n第二行' });
    expect(firstText(result)).toContain('新建');
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('第一行\n第二行');
    expect(rig.observed.get(join(root, 'new.txt'))).toMatchObject({ state: 'present' });
    // 写后回填：紧随的再次 write 不需重读（指纹 = 刚写入版）
    const again = await exec('write', { path: 'new.txt', content: '替换版' });
    expect(firstText(again)).toContain('替换');
  });

  it('未读 + 在场 → FS_NOT_OBSERVED（拒绝盲写）', async () => {
    await writeFile(join(root, 'exists.txt'), '他方内容', 'utf8');
    await expectCode(exec('write', { path: 'exists.txt', content: 'x' }), 'FS_NOT_OBSERVED');
    // 拒写不破坏原内容
    expect(await readFile(join(root, 'exists.txt'), 'utf8')).toBe('他方内容');
  });

  it('读后被他方修改 → FS_VERSION_CONFLICT（丢失更新守卫）', async () => {
    await exec('write', { path: 'c.txt', content: 'v1' });
    await exec('read', { path: 'c.txt' });
    await writeFile(join(root, 'c.txt'), '外部改动', 'utf8'); // 绕过工具的物理写
    await expectCode(exec('write', { path: 'c.txt', content: 'v2' }), 'FS_VERSION_CONFLICT');
  });

  it('absent 观察后他方创建 → FS_VERSION_CONFLICT', async () => {
    await expectCode(exec('read', { path: 'race.txt' }), 'FS_NOT_FOUND'); // 登记 absent
    await writeFile(join(root, 'race.txt'), '他方抢先创建', 'utf8');
    await expectCode(exec('write', { path: 'race.txt', content: 'x' }), 'FS_VERSION_CONFLICT');
  });

  it('读后文件被删 → FS_VERSION_CONFLICT', async () => {
    await exec('write', { path: 'gone.txt', content: 'x' });
    await exec('read', { path: 'gone.txt' });
    await rm(join(root, 'gone.txt'));
    await expectCode(exec('write', { path: 'gone.txt', content: 'y' }), 'FS_VERSION_CONFLICT');
  });

  it('写目标在可写根外 → FS_OUTSIDE_WRITABLE_ROOTS', async () => {
    await expectCode(exec('write', { path: join(outside, 'esc.txt'), content: 'x' }), 'FS_OUTSIDE_WRITABLE_ROOTS');
  });

  it('可写根内符号链指向根外 → canonical 化后出根即拒（fence 真实位置执法）', async () => {
    await writeFile(join(outside, 'real.txt'), 'target', 'utf8');
    await symlink(join(outside, 'real.txt'), join(root, 'link.txt'));
    await expectCode(exec('write', { path: 'link.txt', content: 'x' }), 'FS_OUTSIDE_WRITABLE_ROOTS');
  });

  it('绝对路径直用（相对路径锚 workspace 的对偶面）', async () => {
    const result = await exec('write', { path: join(root, 'abs.txt'), content: 'abs' });
    expect(firstText(result)).toContain('新建');
  });
});

describe('edit（apply_patch 两阶段：全检后写）', () => {
  const patchOf = (...lines: string[]): string => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');

  it('Update File：先读后改（context 锚定位替换）', async () => {
    await exec('write', { path: 'code.ts', content: 'a\nkeep\nb\n' });
    await exec('read', { path: 'code.ts' });
    const result = await exec('edit', {
      patch: patchOf('*** Update File: code.ts', ' keep', '-b', '+c'),
    });
    expect(firstText(result)).toContain('updated code.ts');
    expect(await readFile(join(root, 'code.ts'), 'utf8')).toBe('a\nkeep\nc\n');
  });

  it('Update 未读 → FS_NOT_OBSERVED', async () => {
    await writeFile(join(root, 'unread.ts'), 'x\n', 'utf8');
    await expectCode(exec('edit', { patch: patchOf('*** Update File: unread.ts', '-x', '+y') }), 'FS_NOT_OBSERVED');
  });

  it('定位失败（context 锚不在场）→ FS_PATCH_FAILED 且不落盘', async () => {
    await exec('write', { path: 'stable.ts', content: '真实内容\n' });
    await exec('read', { path: 'stable.ts' });
    await expectCode(
      exec('edit', { patch: patchOf('*** Update File: stable.ts', ' 不存在的锚', '-a', '+b') }),
      'FS_PATCH_FAILED',
    );
    expect(await readFile(join(root, 'stable.ts'), 'utf8')).toBe('真实内容\n');
  });

  it('Add File：新建（无须先读——不在场即合法意图）', async () => {
    const result = await exec('edit', {
      patch: patchOf('*** Add File: fresh.txt', '+line1', '+line2'),
    });
    expect(firstText(result)).toContain('added fresh.txt');
    expect(await readFile(join(root, 'fresh.txt'), 'utf8')).toBe('line1\nline2\n');
  });

  it('Add File 目标已在场 → FS_PATCH_FAILED（改已有文件走 Update）', async () => {
    await writeFile(join(root, 'dup.txt'), 'x', 'utf8');
    await expectCode(exec('edit', { patch: patchOf('*** Add File: dup.txt', '+y') }), 'FS_PATCH_FAILED');
  });

  it('Delete File：必须先读（知道删的是什么）', async () => {
    await writeFile(join(root, 'del.txt'), 'bye', 'utf8'); // 直写盘绕过工具——不登记观察
    await expectCode(exec('edit', { patch: patchOf('*** Delete File: del.txt') }), 'FS_NOT_OBSERVED');
    await exec('read', { path: 'del.txt' });
    const result = await exec('edit', { patch: patchOf('*** Delete File: del.txt') });
    expect(firstText(result)).toContain('deleted del.txt');
    await expect(readFile(join(root, 'del.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('多文件补丁：任一 op 校验失败 → 全不落盘（阶段一前置暴露语义）', async () => {
    await exec('write', { path: 'ok1.txt', content: 'one\n' });
    await exec('read', { path: 'ok1.txt' });
    // 第二个 op 目标从未读过 → 阶段一拒 → 第一个 op 也不落盘
    await writeFile(join(root, 'unread2.txt'), 'two\n', 'utf8');
    await expectCode(
      exec('edit', {
        patch: patchOf('*** Update File: ok1.txt', '-one', '+ONE', '*** Update File: unread2.txt', '-two', '+TWO'),
      }),
      'FS_NOT_OBSERVED',
    );
    expect(await readFile(join(root, 'ok1.txt'), 'utf8')).toBe('one\n');
    expect(await readFile(join(root, 'unread2.txt'), 'utf8')).toBe('two\n');
  });

  it('补丁夹带根外目标 → 逐文件 fence 拒（FS_OUTSIDE_WRITABLE_ROOTS）', async () => {
    await expectCode(
      exec('edit', { patch: patchOf(`*** Add File: ${join(outside, 'esc.txt')}`, '+x') }),
      'FS_OUTSIDE_WRITABLE_ROOTS',
    );
  });

  it('非 UTF-8 文件的 Update → FS_DECODE_NON_UTF8（防转码回写毁档）', async () => {
    const abs = join(root, 'legacy.txt');
    await writeFile(abs, Buffer.from([0xe9, 0x31, 0x0a])); // latin-1 é1\n
    // 手动登记 present 观察（经族暴露面——read 对该文件本身会拒，观察态测试直挂）
    const s = await stat(abs);
    rig.observed.observePresent(abs, `${s.size}:${s.mtimeMs}`);
    await expectCode(exec('edit', { patch: patchOf('*** Update File: legacy.txt', '-1', '+2') }), 'FS_DECODE_NON_UTF8');
  });
});

describe('ls（目录列举——不登记观察）', () => {
  it('列工作区根：目录带尾斜杠、按名排序', async () => {
    await writeFile(join(root, 'b.txt'), 'x', 'utf8');
    await mkdir(join(root, 'adir'));
    await writeFile(join(root, 'a.txt'), 'x', 'utf8');
    const result = await exec('ls', {});
    expect(firstText(result).split('\n')).toEqual(['a.txt', 'adir/', 'b.txt']);
    // ls 不登记观察（不构成内容观察）——列举过的名字无观察记录
    expect(rig.observed.get(join(root, 'b.txt'))).toBeUndefined();
  });

  it('空目录 → （空目录）占位文案', async () => {
    const result = await exec('ls', { path: '.' });
    expect(firstText(result)).toBe('（空目录）');
  });

  it('目录不存在 → FS_NOT_FOUND', async () => {
    await expectCode(exec('ls', { path: 'nope-dir' }), 'FS_NOT_FOUND');
  });
});

/* ---------------- 读侧 carve-out（04 §7——2026-09-08 P0①） ---------------- */

describe('读侧 carve-out（敏感件恒不可读——路径判 + inode 判两腿）', () => {
  /**
   * 敏感集 rig：protDir（root 外——真实 dataDir 形态）两件 + root/vault 一件
   * （edit 面测试位：须在可写根内才能过 fence，暴露 fence 后的读侧判）。
   * provider 条目必须 canonical（macOS /var → /private/var 符号链——比对是
   * canonical 等值判）。
   */
  async function protectedRig(): Promise<{ protSecret: string; vaultSecret: string; protDir: string }> {
    const protDir = await realpath(await mkdtemp(join(outside, 'prot-')));
    await mkdir(join(root, 'vault'));
    const vaultDir = await realpath(join(root, 'vault'));
    const protSecret = join(protDir, 'secret.key');
    const vaultSecret = join(vaultDir, 'secret.key');
    rig = createFsTools({
      workspace: () => root,
      writableRoots: () => [root],
      protectedReadFiles: () => [protSecret, join(protDir, 'allowlist.json'), vaultSecret],
    });
    return { protSecret, vaultSecret, protDir };
  }

  it('read 敏感文本件 → FS_READ_PROTECTED 且无观察残留（拒读不构成「看过」）', async () => {
    const { protSecret } = await protectedRig();
    await writeFile(protSecret, 'k3y-material', 'utf8');
    await expectCode(exec('read', { path: protSecret }), 'FS_READ_PROTECTED');
    expect(rig.observed.get(protSecret)).toBeUndefined();
  });

  it('敏感件缺席同拒（deny 先于存在性检查——不暴露存在性差异、不登记 absent）', async () => {
    const { protSecret } = await protectedRig(); // 未写件 = 缺席
    await expectCode(exec('read', { path: protSecret }), 'FS_READ_PROTECTED');
    expect(rig.observed.get(protSecret)).toBeUndefined(); // 无 absent 观察（与 FS_NOT_FOUND 分账）
  });

  it('符号链别名同拒（canonical 路径判——剥链解析后比对）', async () => {
    const { protSecret } = await protectedRig();
    await writeFile(protSecret, 'k3y-material', 'utf8');
    await symlink(protSecret, join(root, 'alias.txt'));
    await expectCode(exec('read', { path: 'alias.txt' }), 'FS_READ_PROTECTED');
  });

  it('硬链别名同拒（open 后 inode 判——canonical 路径不同而 inode 相同）', async () => {
    const { protSecret } = await protectedRig();
    await writeFile(protSecret, 'k3y-material', 'utf8');
    await link(protSecret, join(root, 'hardlink.txt'));
    await expectCode(exec('read', { path: 'hardlink.txt' }), 'FS_READ_PROTECTED');
  });

  it('硬链别名改图片扩展名同拒（image 分支同判——改扩展名不改判据）', async () => {
    const { protSecret } = await protectedRig();
    await writeFile(protSecret, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await link(protSecret, join(root, 'stolen.png'));
    await expectCode(exec('read', { path: 'stolen.png' }), 'FS_READ_PROTECTED');
  });

  it('edit Update File 隐式读敏感件 → 拒（拒在未读检查前——fence/路径判先于内容读）', async () => {
    const { vaultSecret } = await protectedRig();
    await writeFile(vaultSecret, 'k3y-material', 'utf8');
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${vaultSecret}`,
      '-k3y-material',
      '+pwned',
      '*** End Patch',
    ].join('\n');
    await expectCode(exec('edit', { patch }), 'FS_READ_PROTECTED');
  });

  it('edit Add File 造敏感件路径 → 拒；根外敏感目标 fence 先拒（时序锁：fence 先于路径判）', async () => {
    const { protSecret, vaultSecret } = await protectedRig();
    // 根内 vault/secret.key 缺席：Add File 到该路径 = 读侧路径判拒（非 create 合法面）
    const addPatch = ['*** Begin Patch', `*** Add File: ${vaultSecret}`, '+forged', '*** End Patch'].join('\n');
    await expectCode(exec('edit', { patch: addPatch }), 'FS_READ_PROTECTED');
    // 根外敏感路径：fence（FS_OUTSIDE_WRITABLE_ROOTS）先于读侧判——两层防线执法序
    const outPatch = ['*** Begin Patch', `*** Add File: ${protSecret}`, '+forged', '*** End Patch'].join('\n');
    await expectCode(exec('edit', { patch: outPatch }), 'FS_OUTSIDE_WRITABLE_ROOTS');
  });

  it('同目录非敏感件照常读写（保护面精确到 basename，不殃及邻件）', async () => {
    const { protDir } = await protectedRig();
    await writeFile(join(protDir, 'secret.key'), 'k3y', 'utf8');
    await writeFile(join(protDir, 'notes.txt'), 'fine', 'utf8');
    const result = await exec('read', { path: join(protDir, 'notes.txt') });
    expect(firstText(result)).toBe('fine');
  });
});

describe('写串行链（模块级 per-canonical-path 互斥）', () => {
  it('两会话并发双写同一文件：恰一成功、后者版本冲突（丢失更新守卫闭环）', async () => {
    await exec('write', { path: 'serial.txt', content: 'init' });
    // 双会话：各自独立观察表（驱动层 per-session 的现实形态），同一物理根
    const rigB = createFsTools({ workspace: () => root, writableRoots: () => [root] });
    const writeB = rigB.tools.find((t) => t.name === 'write')!;
    const readB = rigB.tools.find((t) => t.name === 'read')!;
    // 两侧都先 read：各持观察指纹 F（此刻盘上同一版）
    await exec('read', { path: 'serial.txt' });
    await readB.execute({ path: 'serial.txt' }, { toolCallId: 'b-read' });
    // 并发对写：链把两段串行化——先到者 CAS 过、落盘、只回填自己的观察表；
    // 后到者拿到的 currentVersion 已是新版，与其自持旧指纹不符 → 拒
    const [a, b] = await Promise.allSettled([
      exec('write', { path: 'serial.txt', content: 'winner-A' }),
      writeB.execute({ path: 'serial.txt', content: 'winner-B' }, { toolCallId: 'b-write' }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'FS_VERSION_CONFLICT' });
    // 落盘内容 = 胜出者（两写者内容之一，非交叠混合）
    const final = await readFile(join(root, 'serial.txt'), 'utf8');
    expect(['winner-A', 'winner-B']).toContain(final);
  });
});
