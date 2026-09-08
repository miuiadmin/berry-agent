/**
 * tools/search 测试 — 检索族 find/grep：glob 编译 + gitignore 遍历语义
 * （06 篇 §11.1 锚定判据）+ 护栏三跳过 + 截断注记回归锁（04 §7 检索族段）。
 *
 * 真 fs 临时目录（workspace 注入锚点——与 fs.test.ts 同款 rig）；纯逻辑部分
 * （globToRegExp）零 fs 直测。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { link, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseError } from '../contracts/index.js';
import { createSearchTools, globToRegExp } from './search.js';
import type { ToolDefinition } from '../contracts/index.js';

/** 断言 promise 拒绝且携带指定码（异步工具面标准形） */
async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toThrow(BaseError);
  await expect(p).rejects.toMatchObject({ code });
}

/** rig：临时工作区 + 两件工具（opts 可覆写 maxResults/maxScanBytes/敏感读集） */
function makeRig(
  opts: { maxResults?: number; maxScanBytes?: number; protectedReadFiles?: () => readonly string[] } = {},
) {
  const root = join(tmpdir(), `berry-search-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const { tools } = createSearchTools({ workspace: () => root, ...opts });
  return {
    root,
    find: tools[0] as ToolDefinition & { name: 'find' },
    grep: tools[1] as ToolDefinition & { name: 'grep' },
  };
}

/** 本轮 rig（afterEach 清理） */
let rig: ReturnType<typeof makeRig>;

beforeEach(async () => {
  rig = makeRig();
  await mkdir(rig.root, { recursive: true }); // rig 根目录先建（writeFile 直写者依赖在场）
});

afterEach(async () => {
  await rm(rig.root, { recursive: true, force: true });
});

/* ---------------- globToRegExp（纯逻辑单元） ---------------- */

describe('globToRegExp', () => {
  it('`**/*.ts` 匹配任意深度 .ts；不匹配其他扩展', () => {
    const re = globToRegExp('**/*.ts');
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('sub/a.ts')).toBe(true);
    expect(re.test('sub/deep/a.ts')).toBe(true);
    expect(re.test('a.js')).toBe(false);
    expect(re.test('sub/a.js')).toBe(false);
  });

  it('`src/**` 匹配 src 下任意深度；不匹配 src 外', () => {
    const re = globToRegExp('src/**');
    expect(re.test('src/a.ts')).toBe(true);
    expect(re.test('src/deep/a.ts')).toBe(true);
    expect(re.test('lib/a.ts')).toBe(false);
    expect(re.test('srcx/a.ts')).toBe(false);
  });

  it('`*` 不跨段；`?` 单字符；正则元字符字面化', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('sub/a.ts')).toBe(false);
    expect(globToRegExp('a?c.ts').test('abc.ts')).toBe(true);
    expect(globToRegExp('a?c.ts').test('ac.ts')).toBe(false);
    // 字符串里的 . 是字面点（已转义——不充当正则任意符）
    expect(globToRegExp('a.b.ts').test('aXb.ts')).toBe(false);
  });

  it('段内混嵌 `**` 拒 TOOL_INVALID_ARGS（语义不明）', () => {
    expect(() => globToRegExp('a**b')).toThrow(BaseError);
    try {
      globToRegExp('a**b');
    } catch (err) {
      expect((err as BaseError).code).toBe('TOOL_INVALID_ARGS');
    }
  });
});

/* ---------------- 遍历语义（gitignore 判据 + 剪枝 + 符号链） ---------------- */

describe('遍历语义', () => {
  it('常量剪枝 node_modules/.git；根 .gitignore 生效', async () => {
    const { root } = rig;
    await mkdir(join(root, 'node_modules/pkg'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(join(root, 'a.ts'), 'x');
    await writeFile(join(root, 'node_modules/pkg/index.js'), 'x');
    await writeFile(join(root, '.git/config'), 'x');
    await writeFile(join(root, 'build/out.js'), 'x');
    await writeFile(join(root, '.gitignore'), 'build/\n');
    const res = await rig.find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('a.ts');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('.git/'); // .git 目录下条目不进结果（.gitignore 自身是普通文件在场）
    expect(text).not.toContain('build');
  });

  it('嵌套 .gitignore 纯 basename 模式前缀化插 **/——本层与深层同剪（06 §11.1 判据）', async () => {
    const { root } = rig;
    await mkdir(join(root, 'sub/secret'), { recursive: true });
    await mkdir(join(root, 'sub/x/secret'), { recursive: true });
    await writeFile(join(root, 'sub/.gitignore'), 'secret/\n');
    await writeFile(join(root, 'sub/keep.ts'), 'x');
    await writeFile(join(root, 'sub/secret/f.txt'), 'x');
    await writeFile(join(root, 'sub/x/secret/f.txt'), 'x');
    const res = await rig.find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    // 本层与深层 secret/ 都被剪——直接拼前缀会漏深层（判据的反例即此）
    expect(text).not.toContain('secret');
    expect(text).toContain('sub/keep.ts');
    expect(text).toContain('sub/.gitignore');
  });

  it('锚定形模式（含斜杠/前导 /）只剪本层精确路径——不前缀化 **/', async () => {
    const { root } = rig;
    await mkdir(join(root, 'sub/deep'), { recursive: true });
    await mkdir(join(root, 'sub/x'), { recursive: true });
    await writeFile(join(root, 'sub/.gitignore'), '/exact.txt\ndeep/file.txt\n');
    await writeFile(join(root, 'sub/exact.txt'), 'x');
    await writeFile(join(root, 'sub/x/exact.txt'), 'x');
    await writeFile(join(root, 'sub/deep/file.txt'), 'x');
    const res = await rig.find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).not.toContain('sub/exact.txt'); // 锚定剪本层（sub/x/exact.txt 与本条子串不互含，断言安全）
    expect(text).toContain('sub/x/exact.txt'); // 深层同名不被剪
    expect(text).not.toContain('sub/deep/file.txt'); // 含斜杠 = 锚定剪
  });

  it('根层前导 / 锚定形只剪根层——深层同名不被剪（前导 / 透传保留回归锁）', async () => {
    const { root } = rig;
    await mkdir(join(root, 'top'), { recursive: true });
    await mkdir(join(root, 'other/top'), { recursive: true });
    await writeFile(join(root, '.gitignore'), '/top/\n');
    await writeFile(join(root, 'top/x.txt'), 'x');
    await writeFile(join(root, 'other/top/y.txt'), 'x');
    const res = await rig.find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).not.toContain('top/x.txt'); // 根层锚定剪
    expect(text).toContain('other/top/y.txt'); // 深层同名目录不被剪——曾因剥前导 / 透传被降级成任意层匹配
  });

  it('`!` 否定：忽略 *.log 但保留 keep.log', async () => {
    const { root } = rig;
    await writeFile(join(root, '.gitignore'), '*.log\n!keep.log\n');
    await writeFile(join(root, 'a.log'), 'x');
    await writeFile(join(root, 'keep.log'), 'x');
    const res = await rig.find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).not.toContain('a.log');
    expect(text).toContain('keep.log');
  });

  it('符号链目录不跟随（防环）；symlink 文件不进结果', async () => {
    const { root } = rig;
    await mkdir(join(root, 'real'), { recursive: true });
    await writeFile(join(root, 'real/inner.ts'), 'x');
    await writeFile(join(root, 'plain.ts'), 'x');
    await symlink(join(root, 'real'), join(root, 'loopdir')); // 目录符号链（若跟随则 inner.ts 出现两次/成环）
    await symlink(join(root, 'plain.ts'), join(root, 'link.ts')); // 文件符号链
    const res = await rig.find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('real/inner.ts');
    expect(text).toContain('plain.ts');
    expect(text).not.toContain('loopdir');
    expect(text).not.toContain('link.ts');
  });
});

/* ---------------- find 集成 ---------------- */

describe('find 工具', () => {
  it('模式匹配 + 字典序输出 + 结构化 details', async () => {
    const { root } = rig;
    await mkdir(join(root, 'src/deep'), { recursive: true });
    await writeFile(join(root, 'src/b.ts'), 'x');
    await writeFile(join(root, 'src/a.ts'), 'x');
    await writeFile(join(root, 'src/deep/c.ts'), 'x');
    await writeFile(join(root, 'src/d.md'), 'x');
    const res = await rig.find.execute({ pattern: 'src/**/*.ts' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text.split('\n')).toEqual(['src/a.ts', 'src/b.ts', 'src/deep/c.ts']);
    expect(res.details).toMatchObject({ matches: 3, truncated: false });
  });

  it('maxResults 达限早停 + 截断注记（结果内注明非静默）', async () => {
    const local = makeRig({ maxResults: 2 });
    await mkdir(local.root, { recursive: true }); // local rig 根先建
    try {
      await mkdir(join(local.root, 'd'), { recursive: true });
      await writeFile(join(local.root, 'a.ts'), 'x');
      await writeFile(join(local.root, 'b.ts'), 'x');
      await writeFile(join(local.root, 'c.ts'), 'x');
      const res = await local.find.execute({ pattern: '**/*.ts' }, { toolCallId: 'test' });
      const text = (res.content[0] as { text: string }).text;
      expect(res.details).toMatchObject({ matches: 2, truncated: true });
      expect(text).toContain('上限');
    } finally {
      await rm(local.root, { recursive: true, force: true });
    }
  });

  it('遍历起点不存在 → FS_NOT_FOUND（与 ls 同判）；起点是文件 → TOOL_INVALID_ARGS', async () => {
    await expectCode(rig.find.execute({ pattern: '**/*', path: 'nope' }, { toolCallId: 'test' }), 'FS_NOT_FOUND');
    await writeFile(join(rig.root, 'file.txt'), 'x');
    await expectCode(
      rig.find.execute({ pattern: '**/*', path: 'file.txt' }, { toolCallId: 'test' }),
      'TOOL_INVALID_ARGS',
    );
  });
});

/* ---------------- grep 集成 ---------------- */

describe('grep 工具', () => {
  beforeEach(async () => {
    await mkdir(join(rig.root, 'src'), { recursive: true });
    await writeFile(join(rig.root, 'src/a.ts'), 'const alpha = 1;\nconst beta = 2;\n// alpha again\n');
    await writeFile(join(rig.root, 'src/b.md'), 'alpha in md\n');
    await writeFile(join(rig.root, '.gitignore'), '*.md\n');
  });

  it('files_with_matches 缺省模式：命中文件列表 + gitignore 剪枝', async () => {
    const res = await rig.grep.execute({ pattern: 'alpha' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('src/a.ts');
    expect(text).not.toContain('b.md'); // 被 .gitignore 忽略
    expect(res.details).toMatchObject({ mode: 'files_with_matches', matched: 1, skippedBinary: 0 });
  });

  it('content 模式：路径:行号:命中行（行级）', async () => {
    const res = await rig.grep.execute({ pattern: 'alpha', output_mode: 'content' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text.split('\n')).toContain('src/a.ts:1:const alpha = 1;');
    expect(text.split('\n')).toContain('src/a.ts:3:// alpha again');
    expect(res.details).toMatchObject({ mode: 'content', matched: 2 });
  });

  it('glob 文件名过滤：只搜匹配文件', async () => {
    await writeFile(join(rig.root, 'src/c.txt'), 'alpha in txt\n');
    const res = await rig.grep.execute({ pattern: 'alpha', glob: '**/*.txt' }, { toolCallId: 'test' });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('src/c.txt');
    expect(text).not.toContain('src/a.ts');
  });

  it('正则编译失败前置拒 TOOL_INVALID_ARGS', async () => {
    await expectCode(rig.grep.execute({ pattern: '([unclosed' }, { toolCallId: 'test' }), 'TOOL_INVALID_ARGS');
  });

  it('单文件目标 = 用户意图：被 .gitignore 忽略的文件显式点名仍可搜', async () => {
    const res = await rig.grep.execute(
      { pattern: 'alpha', path: 'src/b.md', output_mode: 'content' },
      { toolCallId: 'test' },
    );
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('alpha in md');
  });

  it('二进制（前 8KiB 含 NUL）跳过计数；非 UTF-8 跳过计数（编码纪律同律回归锁）', async () => {
    await writeFile(join(rig.root, 'bin.dat'), Buffer.concat([Buffer.from('alpha\0rest\n'), Buffer.alloc(8192, 0x41)]));
    await writeFile(join(rig.root, 'latin.txt'), Buffer.from([0xff, 0xfe, 0x41, 0x0a])); // 非 UTF-8 字节序
    const res = await rig.grep.execute({ pattern: 'A' }, { toolCallId: 'test' }); // 命中 bin.dat 的 0x41 填充段与 latin.txt 的 0x41
    expect(res.details).toMatchObject({ skippedBinary: 1, skippedNonUtf8: 1, matched: 0 });
  });

  it('超限只扫前段：截点回退 UTF-8 安全边界——多字节字符不误报非 UTF-8', async () => {
    const local = makeRig({ maxScanBytes: 16 });
    await mkdir(local.root, { recursive: true }); // local rig 根先建
    try {
      // 前段 ASCII 命中 + 尾部多字节字符被截点回退（截断不误报 nonUtf8）
      await writeFile(join(local.root, 'big.txt'), 'hit here\n中文尾部字符\n');
      const res = await local.grep.execute({ pattern: 'hit', output_mode: 'content' }, { toolCallId: 'test' });
      expect(res.details).toMatchObject({ skippedNonUtf8: 0, skippedOversize: 1, matched: 1 });
      const text = (res.content[0] as { text: string }).text;
      expect(text).toContain('big.txt:1:hit here');
    } finally {
      await rm(local.root, { recursive: true, force: true });
    }
  });

  it('content 模式达限：截断注记 + details.truncated true（承蓝本断裂的回归锁）', async () => {
    const local = makeRig({ maxResults: 2 });
    await mkdir(local.root, { recursive: true }); // local rig 根先建
    try {
      await writeFile(join(local.root, 'many.txt'), 'alpha 1\nalpha 2\nalpha 3\nalpha 4\n');
      const res = await local.grep.execute({ pattern: 'alpha', output_mode: 'content' }, { toolCallId: 'test' });
      const text = (res.content[0] as { text: string }).text;
      // 修前注记永不出现（truncated 无人置位）——修后达限必带注记
      expect(text).toContain('上限');
      expect(res.details).toMatchObject({ matched: 2, truncated: true });
    } finally {
      await rm(local.root, { recursive: true, force: true });
    }
  });

  it('单文件 content 模式命中行达限同置截断（超长文件路径）', async () => {
    const local = makeRig({ maxResults: 1 });
    await mkdir(local.root, { recursive: true }); // local rig 根先建
    try {
      await writeFile(join(local.root, 'two.txt'), 'alpha 1\nalpha 2\n');
      const res = await local.grep.execute(
        { pattern: 'alpha', path: 'two.txt', output_mode: 'content' },
        { toolCallId: 'test' },
      );
      expect(res.details).toMatchObject({ matched: 1, truncated: true });
    } finally {
      await rm(local.root, { recursive: true, force: true });
    }
  });

  it('搜索目标不存在 → FS_NOT_FOUND', async () => {
    await expectCode(rig.grep.execute({ pattern: 'x', path: 'nope' }, { toolCallId: 'test' }), 'FS_NOT_FOUND');
  });
});

/* ---------------- 读侧 carve-out（04 §7 定形③——2026-09-08 P0①） ---------------- */

describe('读侧 carve-out（grep 扫描脸硬拒 / find 路径枚举面不拦）', () => {
  /**
   * 敏感集 rig：root 取 canonical（realpath 化——macOS /var → /private/var：
   * provider 条目与遍历产出路径必须落在同一 canonical 域），data/secret.key
   * 为保护件（真实 dataDir 形态——敏感件就在遍历子树内，不剪枝）。
   */
  function protRig(): {
    root: string;
    protSecret: string;
    find: ToolDefinition;
    grep: ToolDefinition;
  } {
    const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'berry-search-prot-')));
    const protSecret = join(root, 'data', 'secret.key');
    const { tools } = createSearchTools({ workspace: () => root, protectedReadFiles: () => [protSecret] });
    return { root, protSecret, find: tools[0]!, grep: tools[1]! };
  }

  it('grep 单文件点名敏感件 → FS_READ_PROTECTED（open 前路径判——canonicalize 后比对）', async () => {
    const { root, protSecret, grep } = protRig();
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await writeFile(protSecret, 'k3y-material\n');
      await expectCode(grep.execute({ pattern: 'k3y', path: protSecret }, { toolCallId: 'test' }), 'FS_READ_PROTECTED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('grep 单文件符号链别名同拒（canonicalize 剥链解析后命中）', async () => {
    const { root, protSecret, grep } = protRig();
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await writeFile(protSecret, 'k3y-material\n');
      await symlink(protSecret, join(root, 'alias.txt'));
      await expectCode(
        grep.execute({ pattern: 'k3y', path: 'alias.txt' }, { toolCallId: 'test' }),
        'FS_READ_PROTECTED',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('grep 单文件硬链别名同拒（open 后 inode 判——统一 open 形 fstat 兜底）', async () => {
    const { root, protSecret, grep } = protRig();
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await writeFile(protSecret, 'k3y-material\n');
      await link(protSecret, join(root, 'hardlink.txt'));
      await expectCode(
        grep.execute({ pattern: 'k3y', path: 'hardlink.txt' }, { toolCallId: 'test' }),
        'FS_READ_PROTECTED',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('grep 目录遍历命中敏感件 → 整调用硬拒（pattern 无关——pre-open 判先于内容扫描）', async () => {
    const { root, protSecret, grep } = protRig();
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/a.ts'), 'const alpha = 1;\n');
      await writeFile(protSecret, 'k3y-material\n');
      // pattern 与敏感件内容无交集也拒——判据是路径不是内容
      await expectCode(grep.execute({ pattern: 'nomatch' }, { toolCallId: 'test' }), 'FS_READ_PROTECTED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('grep 遍历根经符号链别名入参同拒（根 canonicalize 一次——别名根不废两腿执法）', async () => {
    const { root, protSecret, grep } = protRig();
    // 根别名：alias → root（规范定形③「遍历根 canonicalize 一次」的执法面——
    // 路径判经 canonical 根命中；即便 miss 也有 inode 判兜底，别名根无绕行）
    const alias = join(realpathSync(tmpdir()), `berry-search-alias-${process.pid}`);
    await symlink(root, alias);
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await writeFile(protSecret, 'k3y-material\n');
      await expectCode(grep.execute({ pattern: 'x', path: alias }, { toolCallId: 'test' }), 'FS_READ_PROTECTED');
    } finally {
      await rm(alias, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('glob 排除在扫描面外的敏感件不触发（**/*.ts 照常——dataDir 在 workspace 内不挂整调用）', async () => {
    const { root, protSecret, grep } = protRig();
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/a.ts'), 'const alpha = 1;\n');
      await writeFile(protSecret, 'k3y-material\n');
      const res = await grep.execute({ pattern: 'alpha', glob: '**/*.ts' }, { toolCallId: 'test' });
      const text = (res.content[0] as { text: string }).text;
      expect(text).toContain('src/a.ts'); // 扫描脸语义：不扫不拒——glob 排除的不触发整调用硬拒
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('find 路径枚举面不拦（pattern 覆盖敏感路径照常返回——不构成内容读取）', async () => {
    const { root, protSecret, find } = protRig();
    try {
      await mkdir(join(root, 'data'), { recursive: true });
      await writeFile(protSecret, 'k3y-material\n');
      const res = await find.execute({ pattern: '**/*' }, { toolCallId: 'test' });
      const text = (res.content[0] as { text: string }).text;
      expect(text).toContain('data/secret.key'); // 路径可见、内容不可读（04 §7 定形③枚举面条款）
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
