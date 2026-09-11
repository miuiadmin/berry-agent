/**
 * safety/allowlist 测试 — 工具策略表三族匹配引擎 + commandStem 剥壳（04 §9
 * 粘性第 3/4 款纯函数半边 + 2026-09-11 审批分档批定形块③④：条目双面 /
 * deny 优先律 / 档位偏序包含判）。
 *
 * 纪律：纯函数全真；临时目录夹具只喂 canonical 化路径（与守门行同一口径）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath } from './roots.js';
import { commandStem, matchToolPolicy, type ToolPolicyEntry } from './tool-policy.js';

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
    const entries: ToolPolicyEntry[] = [{ tool: 'write', pattern: 'src', decision: 'allow' }];
    const input = { tool: 'write', effect: 'write' as const, workspace: ws } as const;
    expect(
      matchToolPolicy(entries, { ...input, writePaths: [join(ws, 'src', 'a.ts'), join(ws, 'src', 'b.ts')] }, NOW),
    ).toMatchObject({ index: 0 });
    // 一个目标在前缀外 → 整体未命中（保守）
    expect(
      matchToolPolicy(entries, { ...input, writePaths: [join(ws, 'src', 'a.ts'), join(ws, 'docs', 'b.ts')] }, NOW),
    ).toBeUndefined();
  });

  it('前缀到路径分隔边界（/app 不匹配 /apple）', () => {
    const entries: ToolPolicyEntry[] = [{ tool: 'write', pattern: join(ws, 'app'), decision: 'allow' }];
    expect(
      matchToolPolicy(
        entries,
        { tool: 'write', effect: 'write', workspace: ws, writePaths: [join(ws, 'apple', 'x.ts')] },
        NOW,
      ),
    ).toBeUndefined();
    expect(
      matchToolPolicy(
        entries,
        { tool: 'write', effect: 'write', workspace: ws, writePaths: [join(ws, 'app', 'x.ts')] },
        NOW,
      ),
    ).toMatchObject({ index: 0 });
  });

  it('工具名不等的条目跳过（条目按工具分族）', () => {
    expect(
      matchToolPolicy(
        [{ tool: 'edit', pattern: 'src', decision: 'allow' }],
        { tool: 'write', effect: 'write', workspace: ws, writePaths: [join(ws, 'src', 'a.ts')] },
        NOW,
      ),
    ).toBeUndefined();
  });

  it('TTL 过期条目跳过（回落 ask），后续未过期条目可命中', () => {
    const entries: ToolPolicyEntry[] = [
      { tool: 'write', pattern: 'src', decision: 'allow', expiresAt: NOW - 1 },
      { tool: 'write', pattern: '.', decision: 'allow' },
    ];
    expect(
      matchToolPolicy(
        entries,
        { tool: 'write', effect: 'write', workspace: ws, writePaths: [join(ws, 'src', 'a.ts')] },
        NOW,
      ),
    ).toMatchObject({ index: 1 });
  });
});

/* ---------------- bash 族：命令词干 ---------------- */

describe('bash 族匹配（matchToolPolicy + commandStem 同源）', () => {
  const bash = (pattern: string, command: string): boolean =>
    matchToolPolicy(
      [{ tool: 'bash', pattern, decision: 'allow' }],
      { tool: 'bash', effect: 'exec', bashCommand: command },
      NOW,
    ) !== undefined;

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

describe('整名族匹配（其余 write/exec 档工具）', () => {
  it('工具名相等即命中（pattern 忽略）；不等相关工具跳过', () => {
    expect(
      matchToolPolicy([{ tool: 'deploy', pattern: '', decision: 'allow' }], { tool: 'deploy', effect: 'write' }, NOW),
    ).toMatchObject({ index: 0 });
    expect(
      matchToolPolicy([{ tool: 'deploy', pattern: '', decision: 'allow' }], { tool: 'rollback', effect: 'write' }, NOW),
    ).toBeUndefined();
  });
  it('整名族同样吃 TTL（仅 allow 条目）', () => {
    expect(
      matchToolPolicy(
        [{ tool: 'deploy', pattern: '', decision: 'allow', expiresAt: NOW - 1 }],
        { tool: 'deploy', effect: 'write' },
        NOW,
      ),
    ).toBeUndefined();
  });
  it('decision 缺席防御 = allow（旧三字段形升格读入语义——引擎与读侧归一同向）', () => {
    const legacyRow = { tool: 'deploy', pattern: '' } as unknown as ToolPolicyEntry;
    expect(matchToolPolicy([legacyRow], { tool: 'deploy', effect: 'write' }, NOW)).toMatchObject({ index: 0 });
  });
});

/* ---------------- 审批分档批定形块④：deny 优先律 ---------------- */

describe('deny 优先律（④：deny 命中恒最先且终局——序在 allow 之前恒胜）', () => {
  it('deny 条目序在 allow 之后仍胜（条目序不构成 deny/allow 优先级）', () => {
    const entries: ToolPolicyEntry[] = [
      { tool: 'deploy', pattern: '', decision: 'allow' },
      { tool: 'deploy', pattern: '', decision: 'deny', reason: '生产环境禁部署' },
    ];
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'write' }, NOW)).toMatchObject({
      index: 1,
      entry: { decision: 'deny' },
    });
  });
  it('deny 在前 allow 在后：返回 deny（首个 deny 即终局，不返回首个 allow）', () => {
    const entries: ToolPolicyEntry[] = [
      { tool: 'deploy', pattern: '', decision: 'deny' },
      { tool: 'deploy', pattern: '', decision: 'allow' },
    ];
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'write' }, NOW)).toMatchObject({ index: 0 });
  });
  it('fs 族 deny 条目按 pattern 圈定拒绝面（前缀外不 deny）', () => {
    const entries: ToolPolicyEntry[] = [{ tool: 'write', pattern: join(ws, 'secrets'), decision: 'deny' }];
    expect(
      matchToolPolicy(
        entries,
        { tool: 'write', effect: 'write', workspace: ws, writePaths: [join(ws, 'secrets', 'k.env')] },
        NOW,
      ),
    ).toMatchObject({ index: 0 });
    expect(
      matchToolPolicy(
        entries,
        { tool: 'write', effect: 'write', workspace: ws, writePaths: [join(ws, 'src', 'a.ts')] },
        NOW,
      ),
    ).toBeUndefined();
  });
  it('deny 条目带 expiresAt 属坏形 → 逐条剔除（其余条目照常评估，非整档失效）', () => {
    const entries: ToolPolicyEntry[] = [
      { tool: 'deploy', decision: 'deny', expiresAt: NOW + 1000 }, // 坏形（deny 无 TTL）
      { tool: 'deploy', pattern: '', decision: 'allow' },
    ];
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'write' }, NOW)).toMatchObject({ index: 1 });
    // 唯 deny 坏形在场 → 整体无命中（回落 ask——fail-closed 方向同向）
    expect(matchToolPolicy([entries[0]!], { tool: 'deploy', effect: 'write' }, NOW)).toBeUndefined();
  });
});

/* ---------------- 审批分档批定形块③：档位偏序包含判 ---------------- */

describe('档位偏序包含判（③：allow 及以下窄化自限 / deny 及以上覆写扩面）', () => {
  it('write 档 allow 条目不覆盖 exec 调用（窄化自限——04 §9 ①）', () => {
    const entries: ToolPolicyEntry[] = [{ tool: 'deploy', pattern: '', decision: 'allow', effect: 'write' }];
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'write' }, NOW)).toMatchObject({ index: 0 });
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'read' }, NOW)).toMatchObject({ index: 0 }); // 该档及以下：read 调用仍免问
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'exec' }, NOW)).toBeUndefined(); // exec 调用不覆盖 → 回落 ask
  });
  it('write 档 deny 条目覆盖 write+exec 调用、不覆盖 read 档调用（覆写扩面）', () => {
    const entries: ToolPolicyEntry[] = [{ tool: 'deploy', pattern: '', decision: 'deny', effect: 'write' }];
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'exec' }, NOW)).toMatchObject({ index: 0 }); // 及以上：exec 拒
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'write' }, NOW)).toMatchObject({ index: 0 });
    expect(matchToolPolicy(entries, { tool: 'deploy', effect: 'read' }, NOW)).toBeUndefined(); // 以下：read 档调用不在拒绝面
  });
  it('effect 缺席 = 全档（allow 覆盖 exec / deny 覆盖 read）', () => {
    expect(
      matchToolPolicy([{ tool: 'deploy', pattern: '', decision: 'allow' }], { tool: 'deploy', effect: 'exec' }, NOW),
    ).toMatchObject({ index: 0 });
    expect(
      matchToolPolicy([{ tool: 'deploy', pattern: '', decision: 'deny' }], { tool: 'deploy', effect: 'read' }, NOW),
    ).toMatchObject({ index: 0 });
  });
});
