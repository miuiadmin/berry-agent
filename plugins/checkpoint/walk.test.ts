/**
 * walk 测试——checkpoint 遍历语义回归锁（04 遍历语义三副本同判：gitignore
 * 前缀化锚定/根 .gitignore 前导 / 保留/PRUNE 剪枝/符号链不跟随/确定性序/
 * 文件帽 fail-closed/读失败折 CAPTURE_FAILED）。
 */
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../../src/contracts/index.js';
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

describe('gitignore 转义形（65 轮件D——\\! 字面叹号名不反转）', () => {
  it('\\!name.env = 字面叹号名文件应被忽略——不得剥转义成否定锚（修前红：剥壳后裸 ! 重投被解析为否定，叹号名文件反被入册）', async () => {
    await writeFile(join(dir, '.gitignore'), '\\!name.env\n', 'utf8');
    await put('!name.env', 'bang');
    await put('name.env', 'plain');
    const files = await walkWorkspaceFiles(dir);
    // git 语义：\!name.env 忽略字面名 !name.env；name.env 不受影响
    expect(files.map((f) => f.path).sort()).toEqual(['.gitignore', 'name.env']);
  });

  it('\\! 与忽略族同册不成否定连坐：*.env + \\!keep.env 下 keep.env 仍被忽略（修前红：剥壳 !keep.env 成否定——keep.env 被误解除忽略入册）', async () => {
    await writeFile(join(dir, '.gitignore'), '*.env\n\\!keep.env\n', 'utf8');
    await put('a.env', 'a');
    await put('keep.env', 'keep');
    await put('!keep.env', 'bang');
    const files = await walkWorkspaceFiles(dir);
    // 三个 .env 全在忽略域：a.env/keep.env 由 *.env；!keep.env 字面名由 \!keep.env
    expect(files.map((f) => f.path).sort()).toEqual(['.gitignore']);
  });

  it('根锚定转义形 \\!/x 字面重投：忽略路径 !/x（! 目录下文件），根层字面 !x 名不受辖（闸D P4 勘正锁——转置形 /\\!x 改配根层 !x 名，git check-ignore 亲证偏离）', async () => {
    await writeFile(join(dir, '.gitignore'), '\\!/bang.txt\n', 'utf8');
    await put('!bang.txt', 'root-literal-bang');
    await put('!/bang.txt', 'in-bang-dir');
    await put('plain.txt', 'p');
    const files = await walkWorkspaceFiles(dir);
    // git 真语义：\!/bang.txt 忽略路径 !/bang.txt（! 目录下 bang.txt）；
    // 根层字面叹号名 !bang.txt 不受辖（转置形 /\!bang.txt 才配它——非 git 语义）
    expect(files.map((f) => f.path).sort()).toEqual(['!bang.txt', '.gitignore', 'plain.txt']);
  });

  it('嵌套锚定转义形前缀化同判：sub/.gitignore \\!/x 忽略 sub/!/x，sub 域字面 !x 名不受辖（字面重投 sub/\\!/x）', async () => {
    await put('sub/.gitignore', '\\!/deep.txt\n');
    await put('sub/!deep.txt', 'literal-bang-name');
    await put('sub/!/deep.txt', 'in-bang-dir');
    await put('sub/plain.txt', 'p');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['sub/!deep.txt', 'sub/.gitignore', 'sub/plain.txt']);
  });

  it('嵌套 .gitignore 转义形前缀化同判（sub/\\!x 前缀化后 sub 域内字面叹号名被忽略、深层同配）', async () => {
    await put('sub/.gitignore', '\\!bang.txt\n');
    await put('sub/!bang.txt', 'bang');
    await put('sub/plain.txt', 'p');
    await put('sub/deep/!bang.txt', 'deep-bang');
    const files = await walkWorkspaceFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['sub/.gitignore', 'sub/plain.txt']);
  });
});

describe('gitignore 嵌套非转义锚定（65 轮件D 回归锁——非转义锚定形不回补斜杠，分隔由 prefix 尾斜杠承担）', () => {
  it('嵌套非转义根锚定：sub/.gitignore /x 与 /dist/ 应忽略 sub/x、sub/dist/gen.js（修前红：rootedLead 无条件回补拼 sub//x 双斜杠——ignore 包永不匹配，两文件误全入册）', async () => {
    await put('sub/.gitignore', '/x\n/dist/\n');
    await put('sub/x');
    await put('sub/keep.txt');
    await put('sub/dist/gen.js');
    const files = await walkWorkspaceFiles(dir);
    // git 真语义（check-ignore 真机亲证）：子层 /x 锚 sub/x、/dist/ 锚
    // sub/dist/ 整目录——非转义形前缀直连（prefix 尾斜杠即分隔）
    expect(files.map((f) => f.path).sort()).toEqual(['sub/.gitignore', 'sub/keep.txt']);
  });

  it('嵌套非根锚定带体内斜杠：sub/.gitignore deep/x.txt 只锚 sub/deep/x.txt，sub/other/deep/x.txt 不中（prefix 直连不插通配前缀——防过修守锁）', async () => {
    await put('sub/.gitignore', 'deep/x.txt\n');
    await put('sub/deep/x.txt');
    await put('sub/other/deep/x.txt');
    const files = await walkWorkspaceFiles(dir);
    // 体内斜杠即锚定本子树精确路径——不落 **/ 通配前缀分支
    expect(files.map((f) => f.path).sort()).toEqual(['sub/.gitignore', 'sub/other/deep/x.txt']);
  });
});

describe('字节配额帽（65 轮件D——计数帽不辖字节维的补面；真 OOM 不可测，注入小值锁拒快照判据）', () => {
  it('单文件超帽 fail-closed 拒快照：CAPTURE_FAILED 响亮回执（修前红：字节维缺席不拒）', async () => {
    await put('big.bin', 'x'.repeat(100));
    await put('small.txt', 'x');
    await expect(walkWorkspaceFiles(dir, 1_000, { singleFile: 50, total: 10_000 })).rejects.toMatchObject({
      code: 'CHECKPOINT_CAPTURE_FAILED',
    });
  });

  it('单快照总量超帽 fail-closed：单文件各在帽内、累计越界同拒（修前红：无总量维）', async () => {
    await put('a.bin', 'x'.repeat(40));
    await put('b.bin', 'x'.repeat(40));
    await expect(walkWorkspaceFiles(dir, 1_000, { singleFile: 50, total: 50 })).rejects.toMatchObject({
      code: 'CHECKPOINT_CAPTURE_FAILED',
    });
  });

  it('恰在帽内（== 帽值）不拒——超帽判据为严格大于', async () => {
    await put('exact.bin', 'x'.repeat(50));
    const files = await walkWorkspaceFiles(dir, 1_000, { singleFile: 50, total: 50 });
    expect(files.map((f) => f.path)).toEqual(['exact.bin']);
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
