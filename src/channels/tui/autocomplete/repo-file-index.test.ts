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

/** fd 桩铸造：ok 桩 print0 输出哨兵路径并计数；fail 桩非零退出 */
function writeFdStub(mode: 'ok' | 'fail'): string {
  const script = path.join(makeTmpDir(), mode === 'ok' ? 'fd-ok.cjs' : 'fd-fail.cjs');
  const body =
    mode === 'ok'
      ? '#!/usr/bin/env node\n' +
        "require('node:fs').appendFileSync(process.argv[1] + '.count', 'x');\n" +
        "process.stdout.write('fd-only-sentinel.ts\\0');\n"
      : '#!/usr/bin/env node\nprocess.exit(1);\n';
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
