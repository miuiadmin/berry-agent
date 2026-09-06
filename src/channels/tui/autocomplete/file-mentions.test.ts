/**
 * @ 文件段补全源单测（07 §4.1 补全三合一第三源——实机行走件）：
 * 根列举与前缀过滤（大小写不敏感）/ 子目录段 / 目录优先排序 /
 * 引号形（空格文件 + 已引号前缀续补）/ .git 跳过 / 缺目录空集 /
 * 帽 / 绝对路径与 ~ 展开 / 符号链目录归类。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FileMentionSource } from './file-mentions.js';

/** 临时工程 rig（真实 fs 行走——实机语义） */
function makeTmpProject(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'berry-agent-file-mentions-'));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, '.git'));
  writeFileSync(path.join(root, 'package.json'), '{}');
  writeFileSync(path.join(root, 'README.md'), '');
  writeFileSync(path.join(root, 'my file.txt'), '');
  writeFileSync(path.join(root, 'src', 'app.ts'), '');
  writeFileSync(path.join(root, 'src', 'util.ts'), '');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 测试集合 rig（源 + 临时工程） */
function makeSource(maxItems?: number) {
  const project = makeTmpProject();
  const source = new FileMentionSource({ basePath: project.root, maxItems });
  return { ...project, source };
}

const homes: string[] = [];
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe('FileMentionSource 列举与过滤', () => {
  it('空查询 = 根列举；.git 跳过；目录优先排序', () => {
    const { source, cleanup } = makeSource();
    try {
      const items = source.get('');
      const labels = items.map((item) => item.label);
      expect(labels).toContain('src/');
      expect(labels).toContain('package.json');
      expect(labels).toContain('my file.txt');
      expect(labels).not.toContain('.git'); // 版本库内脏不补
      // 目录优先：src/ 排在一切文件前
      expect(labels.indexOf('src/')).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('前缀过滤（大小写不敏感）+ replacement 带 @ 前缀', () => {
    const { source, cleanup } = makeSource();
    try {
      const items = source.get('PACK');
      expect(items.map((i) => i.label)).toEqual(['package.json']);
      expect(items[0]!.replacement).toBe('@package.json');
    } finally {
      cleanup();
    }
  });

  it('子目录段：dir 前缀解析 + 相对路径 replacement + 目录尾 /', () => {
    const { source, cleanup } = makeSource();
    try {
      expect(source.get('sr').map((i) => i.replacement)).toEqual(['@src/']); // 目录补——尾 / 续深
      expect(source.get('src/ap').map((i) => i.replacement)).toEqual(['@src/app.ts']);
      expect(
        source
          .get('src/')
          .map((i) => i.label)
          .sort(),
      ).toEqual(['app.ts', 'util.ts']); // 尾 / = 列目录
    } finally {
      cleanup();
    }
  });

  it('空格文件引号形：源侧包裹防尾空格击穿；已引号前缀续补', () => {
    const { source, cleanup } = makeSource();
    try {
      expect(source.get('my').map((i) => i.replacement)).toEqual(['@"my file.txt"']);
      expect(source.get('"my f').map((i) => i.replacement)).toEqual(['@"my file.txt"']); // 引号态续补
      expect(source.get('"my file.txt"').map((i) => i.replacement)).toEqual(['@"my file.txt"']); // 已敲闭引号
    } finally {
      cleanup();
    }
  });

  it('缺目录 / 无命中 → 空集', () => {
    const { source, cleanup } = makeSource();
    try {
      expect(source.get('nope/x')).toEqual([]);
      expect(source.get('zzz')).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('条目帽（大目录防全量）', () => {
    const { source, cleanup } = makeSource(2);
    try {
      expect(source.get('').length).toBe(2); // 帽内截断（目录优先序保真）
    } finally {
      cleanup();
    }
  });
});

describe('FileMentionSource 路径形态', () => {
  it('绝对路径段：按绝对位列举 + replacement 保留绝对形', () => {
    const { source, root, cleanup } = makeSource();
    try {
      const items = source.get(`${root}/pack`);
      expect(items.map((i) => i.replacement)).toEqual([`@${root}/package.json`]);
    } finally {
      cleanup();
    }
  });

  it('~ 展开家目录（~/ 段与 ~ 根列举）', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'berry-agent-home-'));
    homes.push(home);
    const prevHome = process.env.HOME;
    process.env.HOME = home; // POSIX homedir() 读 HOME
    writeFileSync(path.join(home, 'notes.md'), '');
    const { source, cleanup } = makeSource();
    try {
      // replacement 保 ~/ 形（承 berry「Preserve ~/ format」——短形续补，
      // 展开责任归下游读取面）
      expect(source.get('~/notes').map((i) => i.replacement)).toEqual(['@~/notes.md']);
      expect(source.get('~/').map((i) => i.label)).toContain('notes.md'); // '~/' 根列举
      expect(source.get('~').map((i) => i.label)).toContain('notes.md'); // '~' 裸形同根列举
    } finally {
      cleanup();
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });

  it('符号链指目录归类为目录（label 尾 /）', () => {
    const { source, root, cleanup } = makeSource();
    try {
      symlinkSync(path.join(root, 'src'), path.join(root, 'link-to-src'));
      expect(source.get('link').map((i) => i.replacement)).toEqual(['@link-to-src/']);
    } finally {
      cleanup();
    }
  });
});
