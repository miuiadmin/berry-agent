/**
 * safety/roots 测试 — 可写根推导 + carve-out 判定表 + canonical 化（04 §8）。
 *
 * 纪律：纯函数全真——真实临时目录夹具（canonical 化对符号链敏感，/tmp 在
 * macOS 是符号链——期望值一律经 canonicalPath 构造，不硬编码平台形）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  absolutize,
  buildCarveOutTable,
  canonicalPath,
  createRootsProvider,
  deriveWritableRoots,
  expandCarveOutEntry,
  isInsideRoot,
  resolveWritability,
} from './roots.js';

/** 每用例独立工作区（canonical 形即取——夹具根在 tmpdir 内，realpath 后无别名） */
let ws = '';

beforeEach(() => {
  ws = canonicalPath(mkdtempSync(join(tmpdir(), 'berry-roots-')));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/* ---------------- deriveWritableRoots（04 §8 表唯一落码） ---------------- */

describe('deriveWritableRoots', () => {
  it('read-only 档空根（mode 是一等输入不是装饰参数）', () => {
    expect(deriveWritableRoots(ws, 'read-only')).toEqual([]);
  });

  it('danger 档全盘根（路径分隔符单根，isInsideRoot 特判任意绝对路径命中）', () => {
    expect(deriveWritableRoots(ws, 'danger')).toEqual([sep]);
  });

  it('workspace-write 档三根 canonical 化去重', () => {
    const roots = deriveWritableRoots(ws, 'workspace-write');
    // 期望根同样 canonical 化（/tmp 在 macOS realpath 为 /private/tmp）
    expect(roots).toEqual([...new Set([ws, canonicalPath('/tmp'), canonicalPath(tmpdir())])]);
  });
});

/* ---------------- isInsideRoot（前缀到分隔边界） ---------------- */

describe('isInsideRoot', () => {
  it('相等命中', () => {
    expect(isInsideRoot('/a/b', '/a/b')).toBe(true);
  });
  it('隔分隔符前缀命中', () => {
    expect(isInsideRoot('/a/b/c.txt', '/a/b')).toBe(true);
  });
  it('同形不同目录不误判（/root 与 /root-evil）', () => {
    expect(isInsideRoot('/root-evil/x', '/root')).toBe(false);
  });
  it('全盘根（sep）任意绝对路径皆命中', () => {
    expect(isInsideRoot('/anything/anywhere', sep)).toBe(true);
  });
});

/* ---------------- canonicalPath（最近存在祖先回退） ---------------- */

describe('canonicalPath', () => {
  it('存在路径解析符号链（tmpdir 夹具与其 realpath 形一致）', () => {
    expect(canonicalPath(ws)).toBe(ws);
  });
  it('不存在路径回退最近存在祖先解析再拼回尾部段（新建文件路径不被别名工作区遮罩绕过）', () => {
    const deep = join(ws, 'not-yet', 'deeper', 'file.txt');
    // 祖先 ws 存在：结果是 canonical(ws) + 未存在尾部段（不虚构、不丢弃）
    expect(canonicalPath(deep)).toBe(join(ws, 'not-yet', 'deeper', 'file.txt'));
  });
});

/* ---------------- expandCarveOutEntry（glob 先展开再遮罩） ---------------- */

describe('expandCarveOutEntry', () => {
  it('字面条目不查存在性（.git 在 init 前就该挡）', () => {
    expect(expandCarveOutEntry(ws, { pattern: '.git', effect: 'deny' })).toEqual([join(ws, '.git')]);
  });
  it('顶层单层 glob 展开目录层实际存在的匹配项（* 不跨分隔符）', () => {
    writeFileSync(join(ws, 'a.env'), 'X=1\n');
    writeFileSync(join(ws, 'b.env'), 'X=2\n');
    writeFileSync(join(ws, 'c.txt'), 'x\n');
    const expanded = expandCarveOutEntry(ws, { pattern: '*.env', effect: 'deny' }).sort();
    expect(expanded).toEqual([join(ws, 'a.env'), join(ws, 'b.env')]);
  });
  it('glob 所在目录不存在 → 空集（无可展开）', () => {
    expect(expandCarveOutEntry(ws, { pattern: 'nope/*.env', effect: 'deny' })).toEqual([]);
  });
});

/* ---------------- buildCarveOutTable + resolveWritability（层叠语义） ---------------- */

describe('resolveWritability 层叠判定', () => {
  it('最具体（最深）路径胜出——浅 deny 下深 allow 重新放开', () => {
    const table = buildCarveOutTable(ws, [
      { pattern: 'vendor', effect: 'deny', note: '外族依赖只读' },
      { pattern: 'vendor/local', effect: 'allow', note: '本地补丁目录放开' },
    ]);
    // vendor/local 本体可写（最深 allow 胜）；vendor 下其余仍拒
    expect(resolveWritability(join(ws, 'vendor', 'local', 'p.ts'), [], table)).toEqual({ allowed: true });
    expect(resolveWritability(join(ws, 'vendor', 'other', 'p.ts'), [], table)).toMatchObject({
      allowed: false,
      kind: 'carve-out',
    });
  });

  it('同路径 deny 胜 allow（保守）', () => {
    const table = buildCarveOutTable(ws, [
      { pattern: 'x.env', effect: 'allow' },
      { pattern: 'x.env', effect: 'deny' },
    ]);
    expect(table[0]!.effect).toBe('deny');
    expect(resolveWritability(join(ws, 'x.env'), [], table)).toMatchObject({ allowed: false, kind: 'carve-out' });
  });

  it('根内放行 / 根外 outside-roots（fence 的面，词汇分流）', () => {
    const table = buildCarveOutTable(ws, []);
    const roots = deriveWritableRoots(ws, 'workspace-write');
    expect(resolveWritability(join(ws, 'src', 'a.ts'), roots, table)).toEqual({ allowed: true });
    expect(resolveWritability(canonicalPath('/etc/hosts-copy'), roots, table)).toMatchObject({
      allowed: false,
      kind: 'outside-roots',
    });
  });

  it('deny 命中回执携带条目（block reason 引用源）', () => {
    const table = buildCarveOutTable(ws, [{ pattern: '.git', effect: 'deny', note: '版本库元数据默认只读' }]);
    const verdict = resolveWritability(join(ws, '.git', 'config'), [ws], table);
    expect(verdict).toMatchObject({
      allowed: false,
      kind: 'carve-out',
      matched: { entry: { pattern: '.git', note: '版本库元数据默认只读' } },
    });
  });
});

/* ---------------- createRootsProvider + absolutize（装配面） ---------------- */

describe('createRootsProvider / absolutize', () => {
  it('provider 随档位取值器实时推导（每次 fence 检查取最新）', () => {
    let mode: 'read-only' | 'workspace-write' | 'danger' = 'workspace-write';
    const provider = createRootsProvider({ workspace: ws, mode: () => mode });
    expect(provider()).toEqual(deriveWritableRoots(ws, 'workspace-write'));
    mode = 'read-only';
    expect(provider()).toEqual([]);
    mode = 'danger';
    expect(provider()).toEqual([sep]);
  });

  it('absolutize：相对锚 workspace、绝对原样（守门行/fence 预检单源）', () => {
    expect(absolutize(ws, 'src/a.ts')).toBe(join(ws, 'src', 'a.ts'));
    expect(absolutize(ws, join(ws, 'b.ts'))).toBe(join(ws, 'b.ts'));
  });
});
