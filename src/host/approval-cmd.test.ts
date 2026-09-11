/**
 * host/approval-cmd 测试——审批分档人面命令件（04 §9 定形块⑤⑥——ap-3）。
 *
 * 覆盖五块：parseApprovalArgv（无参 status 缺省/四动词/旗标拒/动词语数检）、
 * status（两旋钮 + 来源呈现 + 预设一览）、entries（活体现读全列 + 坏形拒）、
 * explain（fs 族 pattern 必填 + 前缀命中 / bash 词干命中 / 整名族三档并列
 * + 与守门行同源 policy 命中标注）、preset（写盘两键 + 建议集 append 幂等
 * 去重 + 半应用防护坏形全拒 + memory 形拒 + 未知名拒 + 审计恰一笔 + 切回
 * 不删条目）。真盘临时目录（tool-policy-store.test 同形）；禁断言 AI 生成
 * 文本——本件全人面文案，断言锚子串。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { parseApprovalArgv, runApprovalCommand } from './approval-cmd.js';
import type { ApprovalCommandDeps, ApprovalStatusFace } from './approval-cmd.js';
import { readToolPolicy, TOOL_POLICY_BASENAME } from './tool-policy-store.js';
import { SETTINGS_BASENAME } from './settings-store.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 基准 deps（status 快照 + 固定 workspace——测试面注入） */
function baseDirs(overrides: Partial<ApprovalCommandDeps> = {}): ApprovalCommandDeps {
  const status: ApprovalStatusFace = {
    mode: 'workspace-write',
    policy: 'ask',
    modeSource: '缺省（代码常量）',
    policySource: '缺省（代码常量）',
  };
  return {
    dataDir: null,
    status,
    workspace: () => '/workspace/demo',
    ...overrides,
  };
}

describe('parseApprovalArgv（TUI 裸 argv 解析律）', () => {
  it('无参 = status 缺省动词', () => {
    const parsed = parseApprovalArgv([]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.sub).toEqual({ sub: 'status' });
  });
  it('四动词各形受理', () => {
    expect(parseApprovalArgv(['status']).ok).toBe(true);
    expect(parseApprovalArgv(['entries']).ok).toBe(true);
    const explain = parseApprovalArgv(['explain', 'bash', 'git status']);
    expect(explain.ok && explain.sub).toEqual({ sub: 'explain', tool: 'bash', pattern: 'git status' });
    const explainOne = parseApprovalArgv(['explain', 'web_search']);
    expect(explainOne.ok && explainOne.sub).toEqual({ sub: 'explain', tool: 'web_search' });
    const preset = parseApprovalArgv(['preset', 'open']);
    expect(preset.ok && preset.sub).toEqual({ sub: 'preset', name: 'open' });
  });
  it('未知子命令/旗标/语数各拒（附用法单源）', () => {
    expect(parseApprovalArgv(['yolo']).ok).toBe(false);
    expect(parseApprovalArgv(['--flag']).ok).toBe(false);
    expect(parseApprovalArgv(['status', 'extra']).ok).toBe(false);
    expect(parseApprovalArgv(['preset']).ok).toBe(false);
    expect(parseApprovalArgv(['preset', 'a', 'b']).ok).toBe(false);
    const missing = parseApprovalArgv(['explain']);
    expect(missing.ok).toBe(false);
    // 字面常量名不漏出（用法文本经 APPROVAL_USAGE 常量拼接进 message——非占位符）
    expect(!missing.ok && missing.message.includes('APPROVAL_USAGE')).toBe(false);
    expect(!missing.ok && missing.message.includes('explain')).toBe(true);
  });
});

describe('status（当前态呈现——两旋钮 + 来源 + 预设一览）', () => {
  it('值与来源同面呈现 + 预设三档全列', () => {
    const outcome = runApprovalCommand({ sub: 'status' }, baseDirs());
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('sandbox 档 = workspace-write');
    expect(outcome.text).toContain('缺省（代码常量）');
    expect(outcome.text).toContain('审批 policy = ask');
    for (const name of ['conservative', 'balanced', 'open']) {
      expect(outcome.text).toContain(name);
    }
  });
  it('CLI 来源标注透传（--preset open 形）', () => {
    const outcome = runApprovalCommand(
      { sub: 'status' },
      baseDirs({
        status: {
          mode: 'workspace-write',
          policy: 'ask',
          modeSource: 'CLI --preset open',
          policySource: 'CLI --preset open',
        },
      }),
    );
    expect(outcome.text).toContain('CLI --preset open');
  });
});

describe('entries（活体现读全列）', () => {
  it('空表诚实呈现 + 命中序说明', () => {
    const dir = tmpDir('approval-entries-empty-');
    const outcome = runApprovalCommand({ sub: 'entries' }, baseDirs({ dataDir: dir }));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('（空——无任何条目）');
    expect(outcome.text).toContain('deny 命中恒最先且终局');
  });
  it('六字段全列 + 载体路径注明', () => {
    const dir = tmpDir('approval-entries-full-');
    writeFileSync(
      join(dir, TOOL_POLICY_BASENAME),
      JSON.stringify({
        entries: [
          { tool: 'bash', pattern: 'git status', decision: 'allow', reason: '看仓库状态不用问' },
          { tool: 'web_search', decision: 'deny' },
          { tool: 'write', pattern: '/tmp/x', decision: 'allow', effect: 'write', expiresAt: 1893456000000 },
        ],
      }),
    );
    const outcome = runApprovalCommand({ sub: 'entries' }, baseDirs({ dataDir: dir }));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('[0] tool=bash pattern=git status decision=allow reason=看仓库状态不用问');
    expect(outcome.text).toContain('[1] tool=web_search decision=deny');
    expect(outcome.text).toContain('[2] tool=write pattern=/tmp/x decision=allow effect=write');
    expect(outcome.text).toContain('expiresAt=');
    expect(outcome.text).toContain(TOOL_POLICY_BASENAME);
  });
  it('文件级坏形 = 拒 + 指名（preset 写动词同拒的前置证据）', () => {
    const dir = tmpDir('approval-entries-bad-');
    writeFileSync(join(dir, TOOL_POLICY_BASENAME), '{broken');
    const outcome = runApprovalCommand({ sub: 'entries' }, baseDirs({ dataDir: dir }));
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('坏形');
  });
  it('memory 形 = 空面诚实（dataDir null）', () => {
    const outcome = runApprovalCommand({ sub: 'entries' }, baseDirs());
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('策略表缺席');
  });
});

describe('explain（真裁决干跑——与守门行同一 matchToolPolicy/policyHitNote）', () => {
  /** 干跑夹具：deny 在前（序 0）+ allow（序 1）+ fs 前缀条目（序 2） */
  function seedPolicy(dir: string): void {
    writeFileSync(
      join(dir, TOOL_POLICY_BASENAME),
      JSON.stringify({
        entries: [
          { tool: 'web_search', decision: 'deny', reason: '不想被搜' },
          { tool: 'bash', pattern: 'git status', decision: 'allow' },
          { tool: 'write', pattern: dir, decision: 'allow' },
        ],
      }),
    );
  }

  it('整名族 deny 命中：三档并列 + policy-deny:<序> 标注（与 gate 硬拒 reason 同源串）', () => {
    const dir = tmpDir('approval-explain-deny-');
    seedPolicy(dir);
    const outcome = runApprovalCommand({ sub: 'explain', tool: 'web_search' }, baseDirs({ dataDir: dir }));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('policy-deny:0');
    expect(outcome.text).toContain('硬拒');
    // 三档并列各占行
    expect(outcome.text).toContain('read 档');
    expect(outcome.text).toContain('write 档');
    expect(outcome.text).toContain('exec 档');
  });

  it('bash 命令原文词干命中 allow：policy-allow:<序>（与 gate allowReason 同源串）', () => {
    const dir = tmpDir('approval-explain-bash-');
    seedPolicy(dir);
    // 环境变量前缀剥壳 → 词干 'git status' 命中（剥壳语义与守门行同源；
    // flag 形如 'git status --short' 属不可判定 miss——引擎「任何 flag 即 miss」律）
    const outcome = runApprovalCommand(
      { sub: 'explain', tool: 'bash', pattern: 'FOO=1 git status' },
      baseDirs({ dataDir: dir }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('policy-allow:1');
    expect(outcome.text).toContain('免问放行');
  });

  it('bash 剥壳不可判定（管道）= 无命中照问', () => {
    const dir = tmpDir('approval-explain-pipe-');
    seedPolicy(dir);
    const outcome = runApprovalCommand(
      { sub: 'explain', tool: 'bash', pattern: 'git status | head' },
      baseDirs({ dataDir: dir }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('无命中');
  });

  it('fs 族 pattern 必填（缺席 = 用法错）', () => {
    const dir = tmpDir('approval-explain-fsmiss-');
    seedPolicy(dir);
    const outcome = runApprovalCommand({ sub: 'explain', tool: 'write' }, baseDirs({ dataDir: dir }));
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('fs 写族');
  });

  it('fs 族前缀命中：写目标锚 workspace 解析 + 前缀条目 allow', () => {
    const dir = tmpDir('approval-explain-fs-');
    seedPolicy(dir);
    // 条目前缀 = dir 本身；相对 pattern 锚 workspace（/workspace/demo）
    const outcome = runApprovalCommand(
      { sub: 'explain', tool: 'write', pattern: join(dir, 'a.txt') },
      baseDirs({ dataDir: dir }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('policy-allow:2');
  });

  it('无条目命中 = 无命中呈现（照问照审——不假报）', () => {
    const dir = tmpDir('approval-explain-none-');
    seedPolicy(dir);
    const outcome = runApprovalCommand({ sub: 'explain', tool: 'todo' }, baseDirs({ dataDir: dir }));
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('无任何命中');
  });
});

describe('preset（写盘动词——两旋钮 + 建议集 + 审计恰一笔）', () => {
  it('open 首切：两键落盘 + 七条建议集 append + 审计恰一笔（载荷四值）', () => {
    const dir = tmpDir('approval-preset-open-');
    const applied: Array<{ preset: string; sandboxMode: string; approvalPolicy: string; appended: number }> = [];
    const outcome = runApprovalCommand(
      { sub: 'preset', name: 'open' },
      baseDirs({
        dataDir: dir,
        onPresetApplied: (p, m, pol, a) =>
          void applied.push({ preset: p, sandboxMode: m, approvalPolicy: pol, appended: a }),
      }),
    );
    expect(outcome.ok).toBe(true);
    // settings 两键
    const settings = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(settings).toEqual({ sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
    // 建议集七条（fs 两件 pattern=workspace 根 + bash 五词干）
    const load = readToolPolicy(dir);
    expect(load.healthy).toBe(true);
    expect(load.entries).toHaveLength(7);
    expect(load.entries.filter((e) => e.tool === 'bash')).toHaveLength(5);
    // 审计恰一笔 + 载荷
    expect(applied).toEqual([{ preset: 'open', sandboxMode: 'workspace-write', approvalPolicy: 'ask', appended: 7 }]);
    // 回执诚实句
    expect(outcome.text).toContain('下次启动/新装配生效');
  });

  it('重复切 open：幂等去重 appended=0 + 审计仍一笔', () => {
    const dir = tmpDir('approval-preset-dup-');
    const applied: number[] = [];
    const deps = baseDirs({ dataDir: dir, onPresetApplied: (_p, _m, _pol, a) => void applied.push(a) });
    runApprovalCommand({ sub: 'preset', name: 'open' }, deps);
    const second = runApprovalCommand({ sub: 'preset', name: 'open' }, deps);
    expect(second.ok).toBe(true);
    expect(readToolPolicy(dir).entries).toHaveLength(7); // 不二写
    expect(applied).toEqual([7, 0]); // 两笔各恰一次——第二笔 appended=0
  });

  it('balanced 切换：两键落盘 + 零条目写入 + 不删既有条目（切回不清账律）', () => {
    const dir = tmpDir('approval-preset-balanced-');
    const applied: number[] = [];
    const deps = baseDirs({ dataDir: dir, onPresetApplied: (_p, _m, _pol, a) => void applied.push(a) });
    runApprovalCommand({ sub: 'preset', name: 'open' }, deps);
    const second = runApprovalCommand({ sub: 'preset', name: 'balanced' }, deps);
    expect(second.ok).toBe(true);
    const settings = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(settings).toEqual({ sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
    expect(readToolPolicy(dir).entries).toHaveLength(7); // 建议条目是已生效授权，撤除归手删
    expect(applied).toEqual([7, 0]);
  });

  it('半应用防护：策略表坏形全拒（settings 不写 + 零审计）', () => {
    const dir = tmpDir('approval-preset-half-');
    writeFileSync(join(dir, TOOL_POLICY_BASENAME), '{broken');
    const applied: number[] = [];
    const outcome = runApprovalCommand(
      { sub: 'preset', name: 'open' },
      baseDirs({ dataDir: dir, onPresetApplied: (_p, _m, _pol, a) => void applied.push(a) }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('全拒');
    expect(applied).toEqual([]); // 失败零落账
  });

  it('未知名拒 + memory 形拒（零副作用零审计）', () => {
    const applied: number[] = [];
    const unknown = runApprovalCommand(
      { sub: 'preset', name: 'yolo' },
      baseDirs({ dataDir: '/nonexistent', onPresetApplied: (_p, _m, _pol, a) => void applied.push(a) }),
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toContain('未知预设名');
    const memory = runApprovalCommand(
      { sub: 'preset', name: 'open' },
      baseDirs({ onPresetApplied: (_p, _m, _pol, a) => void applied.push(a) }),
    );
    expect(memory.ok).toBe(false);
    expect(memory.text).toContain('纯 memory');
    expect(applied).toEqual([]);
  });
});
