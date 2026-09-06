/**
 * walk 测试——checkpoint 遍历语义回归锁（04 遍历语义三副本同判：gitignore
 * 前缀化锚定/根 .gitignore 前导 / 保留/PRUNE 剪枝/符号链不跟随/确定性序/
 * 文件帽 fail-closed/读失败折 CAPTURE_FAILED）。
 */
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { readWorkspaceFile, walkWorkspaceFiles } from './walk.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'berry-checkpoint-walk-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 快捷建文件（含父目录） */
async function put(rel: string, content = 'x'): Promise<void> {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

describe('walkWorkspaceFiles 遍历语义', () => {
  it('全量实文件入册（含点文件——快照域是工作区状态非 git 索引面）', async () => {
    await put('a.txt');
    await put('.env', 'SECRET=1');
    await put('sub/b.txt');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['.env', 'a.txt', 'sub/b.txt']);
  });

  it('node_modules 与 .git 剪枝', async () => {
    await put('keep.txt');
    await put('node_modules/pkg/index.js');
    await put('.git/objects/ab');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path)).toEqual(['keep.txt']);
  });

  it('根 .gitignore 规则生效（文件与目录两形）', async () => {
    await put('build/out.js');
    await put('secret.txt');
    await put('keep.txt');
    await writeFile(join(dir, '.gitignore'), 'secret.txt\nbuild/\n', 'utf8');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path)).toEqual(['.gitignore', 'keep.txt']);
  });

  it('嵌套 .gitignore 只作用本子树（前缀化锚定）', async () => {
    await put('logs/a.txt');
    await put('other/logs-b.txt');
    await put('sub/logs.txt');
    // 子目录 sub 的规则只管 sub/ 内——根域文件不受影响；!.gitignore 否定
    // 使规则文件自身存活（git 同语义）
    await put('sub/.gitignore', '*.txt\n!.gitignore\n');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['logs/a.txt', 'other/logs-b.txt', 'sub/.gitignore']);
  });

  it('嵌套 basename 规则前缀化插通配前缀（深层同配）+ 根前导 / 锚定不降级', async () => {
    // 根 .gitignore：/anchor.txt 只锚根层——根层同名被忽略、深层同名不中
    await writeFile(join(dir, '.gitignore'), '/anchor.txt\n', 'utf8');
    await put('anchor.txt', 'root-level ignored');
    await put('deep/anchor.txt');
    await put('gen.txt');
    // 子层 vendored 规则：basename 形插 **/ 通配前缀——本子树任意深同配
    await put('deep/.gitignore', 'vendored\n');
    await put('deep/x/vendored/y.txt');
    await put('deep/keep/vendored-brother.txt');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual([
      '.gitignore',
      'deep/.gitignore',
      'deep/anchor.txt',
      'deep/keep/vendored-brother.txt',
      'gen.txt',
    ]);
  });

  it('否定规则恢复入册（! 语义）', async () => {
    await writeFile(join(dir, '.gitignore'), '*.log\n!keep.log\n', 'utf8');
    await put('a.log');
    await put('keep.log');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['.gitignore', 'keep.log']);
  });

  it('符号链不跟随（目录/文件两形同判）', async () => {
    await put('real/inside.txt');
    await put('target.txt');
    await symlink(join(dir, 'real'), join(dir, 'link-dir'));
    await symlink(join(dir, 'target.txt'), join(dir, 'link-file.txt'));
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['real/inside.txt', 'target.txt']);
  });

  it('确定性序：目录序 × 名称字典序（manifest files 稳定形态的锚）', async () => {
    await put('z.txt');
    await put('a/b.txt');
    await put('a/a.txt');
    await put('m.txt');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path)).toEqual(['a/a.txt', 'a/b.txt', 'm.txt', 'z.txt']);
    // absPath 与 path 同基（path = posix 相对形）
    expect(files[0]!.absPath).toBe(join(dir, 'a', 'a.txt'));
  });

  it('文件帽 fail-closed：超帽抛 CAPTURE_FAILED', async () => {
    await put('a.txt');
    await put('b.txt');
    await expect(walkWorkspaceFiles(dir, 1)).rejects.toMatchObject({
      code: 'CHECKPOINT_CAPTURE_FAILED',
    });
  });

  it('根缺席折 CAPTURE_FAILED（非空集静默——仓故障两分）', async () => {
    await expect(walkWorkspaceFiles(join(dir, 'nope'))).rejects.toBeInstanceOf(BaseError);
  });

  it('空工作区 = 空集（空 manifest 的合法形态）', async () => {
    const files = await walkWorkspaceFiles(dir);
    expect(files).toEqual([]);
  });
});

describe('readWorkspaceFile', () => {
  it('常规读回字节', async () => {
    await put('a.txt', 'hello');
    expect((await readWorkspaceFile(join(dir, 'a.txt'))).toString('utf8')).toBe('hello');
  });

  it('权限拒读折 CAPTURE_FAILED（fail-closed——读不了进不了快照）', async () => {
    if (process.platform === 'win32') return; // chmod 位在 win 无义——跳过
    await put('locked.txt');
    await chmod(join(dir, 'locked.txt'), 0o000);
    await expect(readWorkspaceFile(join(dir, 'locked.txt'))).rejects.toMatchObject({
      code: 'CHECKPOINT_CAPTURE_FAILED',
    });
  });
});
