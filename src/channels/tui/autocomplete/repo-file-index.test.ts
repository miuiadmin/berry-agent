/**
 * 全库文件索引器单测（07 §4.1 @ 文件全库模糊腿批——挖掘 36 轮）：
 * 内建腿行走语义（gitignore 嵌套前缀化 / node_modules+.git 常量剪枝 / 符号链
 * 不跟随 / 仅常规文件 / 确定性序）、fd 腿优先与降级（stub 子进程 --print0 收割 /
 * 非零退出降级内建 / 相对路径 fdPath 判读缺席）、行走帽截断位、per-root TTL
 * 缓存与在途承诺共享、resolveFdPath 判读单源。
 *
 * fd 桩 = node shebang .cjs 脚本（CI macos/linux 可执行位——beforeAll 形此处
 * 逐桩 chmod 0o755）；调用计数走桩自身路径旁 .count 追加文件（不 mutating
 * process.env——桩经 process.argv[1] 自知其位）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { RepoFileIndex, resolveFdPath } from './repo-file-index.js';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 临时目录 rig（登记统一清理） */
function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'berry-agent-repo-index-'));
  dirs.push(dir);
  return dir;
}

/** fd 桩铸造：ok 桩 print0 输出哨兵路径并计数；fail 桩非零退出；hang 桩写哨兵后悬挂（stdout 长期不 close，自限 4s 退防真挂） */
function writeFdStub(mode: 'ok' | 'fail' | 'hang'): string {
  const script = path.join(makeTmpDir(), mode === 'ok' ? 'fd-ok.cjs' : mode === 'fail' ? 'fd-fail.cjs' : 'fd-hang.cjs');
  const body =
    mode === 'ok'
      ? '#!/usr/bin/env node\n' +
        "require('node:fs').appendFileSync(process.argv[1] + '.count', 'x');\n" +
        "process.stdout.write('fd-only-sentinel.ts\\0');\n"
      : mode === 'fail'
        ? '#!/usr/bin/env node\nprocess.exit(1);\n'
        : // 悬挂形：写完哨兵不退出——stdout 不 close（子进程悬挂的本体形）；
          // 自限 4s 退（红跑不真挂死 worker——修前红 = fd 腿结果直透非帽降级）
          '#!/usr/bin/env node\n' +
          "process.stdout.write('fd-hang-sentinel.ts\\0');\n" +
          'setTimeout(() => process.exit(0), 4000);\n';
  writeFileSync(script, body);
  chmodSync(script, 0o755); // shebang 可执行位（CI macos/linux 通行）
  return script;
}

/** fd 桩调用计数（.count 文件长 = 追加次数；文件未造 = 零次） */
function stubCalls(stub: string): number {
  try {
    return readFileSync(`${stub}.count`, 'utf8').length;
  } catch {
    return 0;
  }
}

describe('RepoFileIndex 内建腿行走语义', () => {
  it('行走语义锁：gitignore 嵌套/常量剪枝/符号链不跟随/仅常规文件；两次快照序恒等', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, 'a.ts'), '');
    mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
    writeFileSync(path.join(root, 'sub', 'deep', 'b.ts'), '');
    mkdirSync(path.join(root, 'ignored'));
    writeFileSync(path.join(root, 'ignored', 'x.ts'), '');
    writeFileSync(path.join(root, '.gitignore'), 'ignored/\n'); // 根规则——目录形剪枝
    writeFileSync(path.join(root, 'sub', '.gitignore'), 'skipme.txt\n'); // 嵌套规则——所在目录子树生效
    writeFileSync(path.join(root, 'sub', 'skipme.txt'), '');
    mkdirSync(path.join(root, 'node_modules'));
    writeFileSync(path.join(root, 'node_modules', 'y.ts'), ''); // 常量剪枝（无论 gitignore 写没写）
    mkdirSync(path.join(root, '.git'));
    writeFileSync(path.join(root, '.git', 'z'), ''); // 版本库内脏
    symlinkSync(path.join(root, 'sub'), path.join(root, 'link')); // 符号链→目录：不跟随不入索引
    const index = new RepoFileIndex({ ttlMs: 0 }); // 每查重走——确定性序跨快照可比
    const snap = await index.snapshot(root);
    // 四判据一锁：根规则剪 ignored/、嵌套规则剪 sub/skipme.txt、常量剪枝去
    // node_modules 与 .git、符号链与非常规文件不进；序 = 深度浅先 + 同深字典序
    expect(snap.files).toEqual(['a.ts', 'sub/deep/b.ts']);
    expect(snap.truncated).toBe(false);
    const again = await index.snapshot(root);
    expect(again.files).toEqual(snap.files); // 确定性序——两走同序
  });
});

describe('RepoFileIndex 内建腿 gitignore 转义形（\\! 整义传递——与快照遍历/技能发现/检索族同笔同判）', () => {
  it('\\!name.env = 字面叹号名文件不入索引，name.env 不受影响（修前红：剥转义后裸 ! 重投被解析为否定锚，叹号名文件反入索引）', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, '.gitignore'), '\\!name.env\n');
    writeFileSync(path.join(root, '!name.env'), '');
    writeFileSync(path.join(root, 'name.env'), '');
    const snap = await new RepoFileIndex({ ttlMs: 0 }).snapshot(root);
    // git 语义：\!name.env 忽略字面名 !name.env；name.env 不受影响（.gitignore
    // 自身被常量剪枝不入索引面）
    expect(snap.files).toEqual(['name.env']);
  });

  it('\\! 与忽略族同册不成否定连坐：*.env + \\!keep.env 下 keep.env 仍被排除（修前红：剥壳 !keep.env 成否定——keep.env 被误解除忽略入索引）', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, '.gitignore'), '*.env\n\\!keep.env\n');
    for (const name of ['a.env', 'keep.env', '!keep.env']) writeFileSync(path.join(root, name), '');
    const snap = await new RepoFileIndex({ ttlMs: 0 }).snapshot(root);
    // 三个 .env 全在忽略域：a.env/keep.env 由 *.env；!keep.env 字面名由 \!keep.env
    expect(snap.files).toEqual([]);
  });

  it('根锚定转义形 \\!/x 字面重投：忽略路径 !/x（! 目录下文件），根层字面 !x 名不受辖（修前红：剥壳 !/x 成否定——!/x 路径反入索引）', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, '.gitignore'), '\\!/bang.txt\n');
    writeFileSync(path.join(root, '!bang.txt'), '');
    mkdirSync(path.join(root, '!'));
    writeFileSync(path.join(root, '!', 'bang.txt'), '');
    writeFileSync(path.join(root, 'plain.txt'), '');
    const snap = await new RepoFileIndex({ ttlMs: 0 }).snapshot(root);
    expect(snap.files).toEqual(['!bang.txt', 'plain.txt']);
  });

  it('嵌套 .gitignore 转义形前缀化同判（sub/\\!x 前缀化后 sub 域内字面叹号名不入索引、深层同配）', async () => {
    const root = makeTmpDir();
    mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
    writeFileSync(path.join(root, 'sub', '.gitignore'), '\\!bang.txt\n');
    writeFileSync(path.join(root, 'sub', '!bang.txt'), '');
    writeFileSync(path.join(root, 'sub', 'deep', '!bang.txt'), '');
    writeFileSync(path.join(root, 'sub', 'plain.txt'), '');
    const snap = await new RepoFileIndex({ ttlMs: 0 }).snapshot(root);
    expect(snap.files).toEqual(['sub/plain.txt']);
  });

  it('嵌套锚定转义形前缀化同判：sub/.gitignore \\!/x 字面重投 sub/\\!/x——忽略 sub/!/x，sub 域字面 !x 名不受辖（escapedLead=转义根锚定才回补斜杠的分支锁）', async () => {
    const root = makeTmpDir();
    mkdirSync(path.join(root, 'sub', '!'), { recursive: true });
    writeFileSync(path.join(root, 'sub', '.gitignore'), '\\!/deep.txt\n');
    writeFileSync(path.join(root, 'sub', '!deep.txt'), '');
    writeFileSync(path.join(root, 'sub', '!', 'deep.txt'), '');
    writeFileSync(path.join(root, 'sub', 'plain.txt'), '');
    const snap = await new RepoFileIndex({ ttlMs: 0 }).snapshot(root);
    expect(snap.files).toEqual(['sub/!deep.txt', 'sub/plain.txt']);
  });
});

describe('RepoFileIndex fd 腿优先与降级', () => {
  it('fd 输出收割 / 非零退出降级内建 / 相对路径 fdPath 判读为缺席', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, 'real.ts'), '');
    // ok 桩——fd 输出即索引面（内建行走被替置：哨兵名不在树上仍在）
    const viaFd = await new RepoFileIndex({ fdPath: writeFdStub('ok'), ttlMs: 0 }).snapshot(root);
    expect(viaFd.files).toEqual(['fd-only-sentinel.ts']);
    expect(viaFd.truncated).toBe(false);
    // fail 桩（退出码 1）——降级内建行走（同树断言内建结果）
    const viaFallback = await new RepoFileIndex({ fdPath: writeFdStub('fail'), ttlMs: 0 }).snapshot(root);
    expect(viaFallback.files).toEqual(['real.ts']);
    // 相对路径 fdPath——非绝对判读为缺席（走内建）
    const viaRelative = await new RepoFileIndex({ fdPath: 'fd-not-absolute', ttlMs: 0 }).snapshot(root);
    expect(viaRelative.files).toEqual(['real.ts']);
  });

  it('悬挂帽锁：子进程悬挂（stdout 永不 close）→ 帽到点 SIGKILL + settle(null) 降级内建（修前红：无帽 = fd 腿结果直透非降级）', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, 'real.ts'), '');
    // 注入缩帽 150ms（帽值注入位——mock 只停注入位）；hang 桩写哨兵后悬挂
    // 4s 自退：修前无帽时悬挂期间 promise 不结算、桩自退后 fd 结果直透；
    // 修后帽到点击杀降级——与 spawn 失败同语义（补全失败不呈报律）
    const snap = await new RepoFileIndex({
      fdPath: writeFdStub('hang'),
      ttlMs: 0,
      fdWalkTimeoutMs: 150,
    }).snapshot(root);
    expect(snap.files).toEqual(['real.ts']); // 内建行走降级（真树上真文件）——非 fd 哨兵直透
  });
});

describe('RepoFileIndex 行走帽与截断位', () => {
  it('fileCap=2 超帽即停：恰 2 条且 truncated=true；恰满帽非截断', async () => {
    const root = makeTmpDir();
    for (const name of ['a.ts', 'b.ts', 'c.ts']) writeFileSync(path.join(root, name), '');
    const snap = await new RepoFileIndex({ fileCap: 2, ttlMs: 0 }).snapshot(root);
    expect(snap.files).toEqual(['a.ts', 'b.ts']); // 第 3 文件不进——超帽即停
    expect(snap.truncated).toBe(true);
    // 恰满帽（树上恰 2 文件）——截断位诚实 false
    const exact = makeTmpDir();
    writeFileSync(path.join(exact, 'a.ts'), '');
    writeFileSync(path.join(exact, 'b.ts'), '');
    const snapExact = await new RepoFileIndex({ fileCap: 2, ttlMs: 0 }).snapshot(exact);
    expect(snapExact.files).toEqual(['a.ts', 'b.ts']);
    expect(snapExact.truncated).toBe(false);
  });
});

describe('RepoFileIndex TTL 缓存与在途共享', () => {
  it('TTL 窗内复用一次行走 / ttlMs=0 每查重走 / 并发同根共享在途承诺', async () => {
    const root = makeTmpDir();
    writeFileSync(path.join(root, 'real.ts'), '');
    const stub = writeFdStub('ok');
    // TTL 窗内（缺省 30s）：两次快照只走一次——缓存命中
    const cached = new RepoFileIndex({ fdPath: stub });
    await cached.snapshot(root);
    await cached.snapshot(root);
    expect(stubCalls(stub)).toBe(1);
    // ttlMs=0：每查重走（并发共享仍生效——见下腿）
    const fresh = new RepoFileIndex({ fdPath: stub, ttlMs: 0 });
    await fresh.snapshot(root);
    await fresh.snapshot(root);
    expect(stubCalls(stub)).toBe(3); // 1 + 2
    // 并发同根：两查共享同一在途承诺（同步背靠背两调——只一跑）
    const inflight = new RepoFileIndex({ fdPath: stub, ttlMs: 0 });
    await Promise.all([inflight.snapshot(root), inflight.snapshot(root)]);
    expect(stubCalls(stub)).toBe(4); // 3 + 1
  });
});

describe('resolveFdPath 判读单源', () => {
  it('绝对路径原样返回；相对路径/空串/缺席 → undefined', () => {
    expect(resolveFdPath({ BERRY_AGENT_FD_PATH: '/usr/local/bin/fd' })).toBe('/usr/local/bin/fd');
    expect(resolveFdPath({ BERRY_AGENT_FD_PATH: 'bin/fd' })).toBeUndefined();
    expect(resolveFdPath({ BERRY_AGENT_FD_PATH: '' })).toBeUndefined();
    expect(resolveFdPath({})).toBeUndefined();
  });
});
