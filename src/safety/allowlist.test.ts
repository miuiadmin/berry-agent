/**
 * safety/allowlist 测试 — 三族匹配引擎 + commandStem 剥壳（04 §9 粘性第 3/4 款
 * 纯函数半边）。
 *
 * 纪律：纯函数全真；临时目录夹具只喂 canonical 化路径（与守门行同一口径）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath } from './roots.js';
import { commandStem, matchAllowlist, type AllowlistEntry } from './allowlist.js';

/** 每用例独立工作区（canonical 形） */
let ws = '';

beforeEach(() => {
  ws = canonicalPath(mkdtempSync(join(tmpdir(), 'berry-allow-')));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/** 固定时钟（TTL 用例自行构造条目——免真实时间漂移） */
const NOW = 1_800_000_000_000;

/* ---------------- fs 族：路径前缀 all-or-nothing ---------------- */

describe('fs 族匹配', () => {
  it('全部写目标落在前缀内才命中（all-or-nothing）', () => {
    const entries: AllowlistEntry[] = [{ tool: 'write', pattern: 'src' }];
    const input = { tool: 'write', workspace: ws, now: NOW } as const;
    expect(
      matchAllowlist(entries, { ...input, writePaths: [join(ws, 'src', 'a.ts'), join(ws, 'src', 'b.ts')] }, NOW),
    ).toMatchObject({ index: 0 });
    // 一个目标在前缀外 → 整体未命中（保守）
    expect(
      matchAllowlist(entries, { ...input, writePaths: [join(ws, 'src', 'a.ts'), join(ws, 'docs', 'b.ts')] }, NOW),
    ).toBeUndefined();
  });

  it('前缀到路径分隔边界（/app 不匹配 /apple）', () => {
    const entries: AllowlistEntry[] = [{ tool: 'write', pattern: join(ws, 'app') }];
    expect(
      matchAllowlist(entries, { tool: 'write', workspace: ws, writePaths: [join(ws, 'apple', 'x.ts')] }, NOW),
    ).toBeUndefined();
    expect(
      matchAllowlist(entries, { tool: 'write', workspace: ws, writePaths: [join(ws, 'app', 'x.ts')] }, NOW),
    ).toMatchObject({ index: 0 });
  });

  it('工具名不等的条目跳过（条目按工具分族）', () => {
    expect(
      matchAllowlist(
        [{ tool: 'edit', pattern: 'src' }],
        { tool: 'write', workspace: ws, writePaths: [join(ws, 'src', 'a.ts')] },
        NOW,
      ),
    ).toBeUndefined();
  });

  it('TTL 过期条目跳过（回落 ask），后续未过期条目可命中', () => {
    const entries: AllowlistEntry[] = [
      { tool: 'write', pattern: 'src', expiresAt: NOW - 1 },
      { tool: 'write', pattern: '.' },
    ];
    expect(
      matchAllowlist(entries, { tool: 'write', workspace: ws, writePaths: [join(ws, 'src', 'a.ts')] }, NOW),
    ).toMatchObject({ index: 1 });
  });
});

/* ---------------- bash 族：命令词干 ---------------- */

describe('bash 族匹配（matchAllowlist + commandStem 同源）', () => {
  const bash = (pattern: string, command: string): boolean =>
    matchAllowlist([{ tool: 'bash', pattern }], { tool: 'bash', bashCommand: command }, NOW) !== undefined;

  it('单词条目匹配「命令 + 任意非 flag 形参」', () => {
    expect(bash('git', 'git status')).toBe(true);
    expect(bash('git', 'git  push origin main')).toBe(true);
  });
  it('双词条目要求词干恰好前两词相等', () => {
    expect(bash('git push', 'git push origin main')).toBe(true);
    expect(bash('git push', 'git commit')).toBe(false);
  });
  it('环境变量前缀与 shell 包装穿透一层', () => {
    expect(bash('git', 'FOO=1 BAR=2 git status')).toBe(true);
    expect(bash('git status', 'bash -c "git status"')).toBe(true);
    expect(bash('ls', 'sh -c ls')).toBe(true);
  });
  it('不可判定命令（管道/串接/重定向/命令替换/换行/引号/flag）恒 miss', () => {
    expect(bash('git', 'git status | wc -l')).toBe(false);
    expect(bash('git', 'git fetch; git merge')).toBe(false);
    expect(bash('git', 'git log > out.txt')).toBe(false);
    expect(bash('git', 'echo $(git rev-parse)')).toBe(false);
    expect(bash('git', 'git commit -m "x"')).toBe(false); // 残留引号
    expect(bash('rm', 'rm -rf /tmp/x')).toBe(false); // flag 即不可判定
  });
  it('git -C 换仓走私被「flag 即 miss」自然覆盖', () => {
    expect(bash('git', 'git -C /elsewhere status')).toBe(false);
  });
  it('空命令 / 超长条目无效', () => {
    expect(bash('git', '   ')).toBe(false);
    expect(bash('a b c', 'a b')).toBe(false);
  });
});

/* ---------------- commandStem 直测（草案生成器与判定同源） ---------------- */

describe('commandStem', () => {
  it('裸命令与主命令+子命令（≤2 词）', () => {
    expect(commandStem('git')).toBe('git');
    expect(commandStem('git push origin main')).toBe('git push');
    expect(commandStem('/usr/local/bin/git status')).toBe('git status'); // 路径取 basename
  });
  it('无害三 flag 不杀词干', () => {
    expect(commandStem('git --help')).toBe('git');
    expect(commandStem('git -h')).toBe('git');
    expect(commandStem('node --version')).toBe('node');
  });
  it('不可判定返回 undefined（无草案——「始终允许」选项不呈现）', () => {
    expect(commandStem('a && b')).toBeUndefined();
    expect(commandStem('a\ntest')).toBeUndefined();
    expect(commandStem('echo `date`')).toBeUndefined();
    expect(commandStem('')).toBeUndefined();
  });
});

/* ---------------- 整名族：工具名整匹配 ---------------- */

describe('整名族匹配（其余 write-effect 工具）', () => {
  it('工具名相等即命中（pattern 忽略）；不等相关工具跳过', () => {
    expect(matchAllowlist([{ tool: 'deploy', pattern: '' }], { tool: 'deploy' }, NOW)).toMatchObject({ index: 0 });
    expect(matchAllowlist([{ tool: 'deploy', pattern: '' }], { tool: 'rollback' }, NOW)).toBeUndefined();
  });
  it('整名族同样吃 TTL', () => {
    expect(
      matchAllowlist([{ tool: 'deploy', pattern: '', expiresAt: NOW - 1 }], { tool: 'deploy' }, NOW),
    ).toBeUndefined();
  });
});
