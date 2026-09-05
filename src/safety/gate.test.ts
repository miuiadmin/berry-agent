/**
 * safety/gate 测试 — 守门固定行全编舞（04 §8 carve-out 硬拒 + §9 审批对 +
 * allowlist 免问）。
 *
 * 纪律：EventDispatch 全真（context 件）；approval 是被测编舞的可编程参与
 * 者（注入行为非替身——粘性短路属 ApprovalService 自身，已在 approval.test
 * 锁定，此处用直通假件即可）；驱动 = 守门 waterfall 真派发 + 链尾触达旗。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventDispatch } from '../context/index.js';
import { TOOL_EVENT_NAMES } from '../contracts/index.js';
import type { GateInput, ToolDefinition } from '../contracts/index.js';
import { canonicalPath, type CarveOutEntry } from './roots.js';
import type { AllowlistEntry } from './allowlist.js';
import type { ApprovalService } from './approval.js';
import type { ApprovalOutcome, ApprovalRequest, SandboxMode } from './types.js';
import { installSafetyGate } from './gate.js';

/** 每用例独立工作区（canonical 形） */
let ws = '';

beforeEach(() => {
  ws = canonicalPath(mkdtempSync(join(tmpdir(), 'berry-gate-')));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/* ---------------- 测试构造件 ---------------- */

/** 最小真工具形（effect 面 = 被测分支键） */
function makeTool(name: string, effect: 'read' | 'write'): ToolDefinition {
  return {
    name,
    description: '测试工具',
    parameters: {},
    effect,
    execute: async () => ({ content: [] }),
  };
}

const WRITE = makeTool('write', 'write');
const EDIT = makeTool('edit', 'write');
const READ = makeTool('read', 'read');
const DEPLOY = makeTool('deploy', 'write'); // 整名族（非 fs 写意图工具）

/** 两文件补丁（多路径 edit 场景；f1/f2 均相对 workspace） */
function twoFilePatch(f1: string, f2: string): string {
  return [`*** Begin Patch`, `*** Add File: ${f1}`, `+a`, `*** Add File: ${f2}`, `+b`, `*** End Patch`].join('\n');
}

/**
 * 组装「分派器 + 守门行 + 可编程审批 + 链尾触达旗」一套。
 * beforeInstall 钩子 = 装行前造文件（「glob 先展开再遮罩」的展开时刻断言）。
 */
function makeRig(opts?: {
  mode?: SandboxMode;
  entries?: readonly CarveOutEntry[];
  allowlist?: readonly AllowlistEntry[];
  beforeInstall?: () => void;
}) {
  const dispatch = new EventDispatch();
  dispatch.registerEventNames(TOOL_EVENT_NAMES);
  const asks: ApprovalRequest[] = [];
  let answer: ApprovalOutcome = 'allowed-once'; // 可编程（缺省批准——凸显「不该问的场景问了没有」）
  const approval: ApprovalService = {
    policyMode: 'ask',
    ask: async (req: ApprovalRequest) => {
      asks.push(req);
      return { outcome: answer, source: 'user' };
    },
  };
  let mode: SandboxMode = opts?.mode ?? 'workspace-write';
  opts?.beforeInstall?.();
  installSafetyGate(dispatch, {
    approval,
    workspace: ws,
    mode: () => mode,
    ...(opts?.entries !== undefined ? { entries: opts.entries } : {}),
    ...(opts?.allowlist !== undefined ? { allowlist: opts.allowlist } : {}),
  });
  // 链尾触达旗（守门行放行 = next 委托链下游到达；block = 短路不到达）
  let reached = false;
  dispatch.onWaterfall<GateInput>(TOOL_EVENT_NAMES[0]!, (input) => {
    reached = true;
    return input;
  });

  /** 真派发一次守门段：返回 {blocked, reason, reached} */
  const run = async (tool: ToolDefinition, args: Record<string, unknown>, signal?: AbortSignal) => {
    reached = false;
    const input: GateInput = {
      tool,
      args,
      toolCallId: 'call-1',
      mutated: false,
      ...(signal !== undefined ? { signal } : {}),
    };
    const out = await dispatch.waterfall<GateInput>(TOOL_EVENT_NAMES[0]!, input);
    // block 形才带 reason——先收窄再取（allow 形无该字段）
    const reason = out.outcome !== undefined && out.outcome.action === 'block' ? out.outcome.reason : '';
    return { blocked: out.outcome?.action === 'block', reason, reached };
  };

  return {
    run,
    asks,
    setAnswer: (o: ApprovalOutcome) => (answer = o),
    setMode: (m: SandboxMode) => (mode = m),
  };
}

/* ---------------- carve-out 硬拒（04 §8 定形——无升权出路） ---------------- */

describe('carve-out 硬拒', () => {
  it('write 命中 .git → block 硬拒：不问审批、denial marker、注明恒不可写且无升权引导', async () => {
    const rig = makeRig();
    const result = await rig.run(WRITE, { path: join(ws, '.git', 'config') });
    expect(result.blocked).toBe(true);
    expect(result.reached).toBe(false); // 短路——链下游不被吞调用与否之外还须可见
    expect(rig.asks).toHaveLength(0); // 硬拒不产生审批交互
    expect(result.reason).toContain('[sandbox: file access denied under workspace-write]');
    expect(result.reason).toContain('.git');
    expect(result.reason).toContain('恒不可写');
    expect(result.reason).not.toContain('sandbox_permissions'); // 无升权出路——不引导
  });

  it('danger 档 carve-out 照走（用户选 danger ≠ 版本史与凭证可写）', async () => {
    const rig = makeRig({ mode: 'danger' });
    const result = await rig.run(WRITE, { path: '.env' }); // 相对路径锚 workspace
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
    expect(result.reason).toContain('under danger');
  });

  it('多文件补丁任一路径命中即整调用硬拒（不部分放行）', async () => {
    const rig = makeRig();
    const result = await rig.run(EDIT, { patch: twoFilePatch('ok.txt', '.git/evil') });
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  it('glob 先展开再遮罩：装行前存在的文件被遮罩、装行后新建的不追溯', async () => {
    const rig = makeRig({
      beforeInstall: () => writeFileSync(join(ws, 'before.env'), 'X=1\n'), // 展开时刻在场
    });
    writeFileSync(join(ws, 'after.env'), 'X=2\n'); // 装行后新建——诚实语义不追溯

    const before = await rig.run(WRITE, { path: 'before.env' });
    expect(before.blocked).toBe(true); // *.env 展开集内 → 硬拒
    const after = await rig.run(WRITE, { path: 'after.env' });
    expect(after.blocked).toBe(false); // 不在展开集 → 走审批（缺省批准放行）
    expect(rig.asks).toHaveLength(1); // 只有 after.env 真的问了
  });

  it('allowlist 免问放不进 carve-out（硬拒判定在前——底线不受免问面影响）', async () => {
    const rig = makeRig({ allowlist: [{ tool: 'write', pattern: '.git' }] });
    const result = await rig.run(WRITE, { path: join(ws, '.git', 'hooks', 'pre-commit') });
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });
});

/* ---------------- 档位与效果面路由 ---------------- */

describe('档位与效果面路由', () => {
  it('read-only 档跳过本行：不问、放行交棒（fence 拒全量写的面不重复拦）', async () => {
    const rig = makeRig({ mode: 'read-only' });
    const result = await rig.run(WRITE, { path: 'a.txt' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  it('read 工具不过审批（effect=read 放行交棒）', async () => {
    const rig = makeRig();
    const result = await rig.run(READ, { path: 'a.txt' });
    expect(result.blocked).toBe(false);
    expect(rig.asks).toHaveLength(0);
  });

  it('写目标在可写根外 = fence 的面：本行不拦不问（审批为可执行动作而设）', async () => {
    const rig = makeRig();
    const result = await rig.run(WRITE, { path: '/etc/berry-gate-test-file' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });
});

/* ---------------- write-effect 审批对（03 §2.3） ---------------- */

describe('write-effect 审批对', () => {
  it('常规写入：问一次、批准放行（链下游到达）', async () => {
    const rig = makeRig();
    const result = await rig.run(WRITE, { path: 'src/a.ts' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true);
    expect(rig.asks).toHaveLength(1);
    expect(rig.asks[0]!.summary).toBe(`写入 ${join(ws, 'src/a.ts')}`);
    expect(rig.asks[0]!.stickyKey).toEqual({ target: join(ws, 'src/a.ts'), tier: 'workspace-write' });
    expect(rig.asks[0]!.suggestedEntry).toEqual({ tool: 'write', pattern: join(ws, 'src/a.ts') }); // fs 草案 = 精确路径
  });

  it('拒绝 / 无人应答 / 打断三分面：均 block，不带升权引导', async () => {
    const rig = makeRig();
    rig.setAnswer('rejected');
    const rejected = await rig.run(WRITE, { path: 'a.txt' });
    expect(rejected.blocked).toBe(true);
    expect(rejected.reason).toContain('rejected');
    expect(rejected.reason).not.toContain('sandbox_permissions');

    rig.setAnswer('unavailable');
    const unavailable = await rig.run(WRITE, { path: 'a.txt' });
    expect(unavailable.blocked).toBe(true);
    expect(unavailable.reason).toContain('无人应答');

    rig.setAnswer('cancelled');
    const cancelled = await rig.run(WRITE, { path: 'a.txt' });
    expect(cancelled.blocked).toBe(true);
    expect(cancelled.reason).toContain('打断'); // 打断非拒绝的诚实文案
  });

  it('run 取消信号随 ask 载荷透传（interrupt 链——answerer 桥接消费）', async () => {
    const rig = makeRig();
    const signal = new AbortController().signal;
    await rig.run(WRITE, { path: 'a.txt' }, signal);
    expect(rig.asks[0]!.signal).toBe(signal);
  });

  it('多文件补丁：指纹 = 排序去重拼接、无单路径草案（多目标无单一路径可代表）', async () => {
    const rig = makeRig();
    await rig.run(EDIT, { patch: twoFilePatch('b.txt', 'a.txt') });
    expect(rig.asks[0]!.stickyKey!.target).toBe([join(ws, 'a.txt'), join(ws, 'b.txt')].join('\n'));
    expect(rig.asks[0]!.suggestedEntry).toBeUndefined();
    expect(rig.asks[0]!.summary).toContain('2 个目标');
  });
});

/* ---------------- allowlist 免问（粘性第 3 款——advisory） ---------------- */

describe('allowlist 免问', () => {
  it('fs 前缀命中：全部写目标在前缀内 → 免问放行（fence/执行段照走）', async () => {
    const rig = makeRig({ allowlist: [{ tool: 'write', pattern: 'src' }] });
    const result = await rig.run(WRITE, { path: 'src/deep/nested/a.ts' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  it('TTL 过期条目不命中 → 照问', async () => {
    const rig = makeRig({ allowlist: [{ tool: 'write', pattern: 'src', expiresAt: Date.now() - 1 }] });
    await rig.run(WRITE, { path: 'src/a.ts' });
    expect(rig.asks).toHaveLength(1);
  });

  it('整名族：非 fs 写意图工具按工具名免问（deploy 条目只免 deploy）', async () => {
    const rig = makeRig({ allowlist: [{ tool: 'deploy', pattern: '' }] });
    const hit = await rig.run(DEPLOY, { region: 'cn' });
    expect(hit.blocked).toBe(false);
    expect(rig.asks).toHaveLength(0);
    // 其他 write-effect 工具不受整名条目影响（工具名不等不命中）
    const rig2 = makeRig({ allowlist: [{ tool: 'deploy', pattern: '' }] });
    await rig2.run(WRITE, { path: 'src/a.ts' });
    expect(rig2.asks).toHaveLength(1);
  });
});

/* ---------------- 整名族 write-effect 工具（非 fs 写意图） ---------------- */

describe('整名 write-effect 工具', () => {
  it('无路径语义：问询指纹 = 工具名、无草案', async () => {
    const rig = makeRig();
    const result = await rig.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(false);
    expect(rig.asks[0]!.stickyKey).toEqual({ target: 'deploy', tier: 'workspace-write' });
    expect(rig.asks[0]!.suggestedEntry).toBeUndefined();
    expect(rig.asks[0]!.summary).toBe('deploy 写动作');
  });
});
