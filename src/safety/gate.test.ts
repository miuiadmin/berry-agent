/**
 * safety/gate 测试 — 守门固定行全编舞（04 §8 carve-out 硬拒 + §9 审批对 +
 * 工具策略表双面〔allow 免问 / deny 硬拒——2026-09-11 审批分档批定形块③④〕）。
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
import type { GateInput, ToolDefinition, ToolEffect } from '../contracts/index.js';
import { canonicalPath, type CarveOutEntry } from './roots.js';
import type { ToolPolicyEntry } from './tool-policy.js';
import type { ApprovalService } from './approval.js';
import type { ApprovalOutcome, ApprovalPolicyMode, ApprovalRequest, SandboxMode } from './types.js';
import { installSafetyGate } from './gate.js';
import { APPROVAL_ANSWER_EVENT, createApprovalService } from './approval.js';
import type { ApprovalAnswerEnvelope } from './approval.js';

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
function makeTool(name: string, effect: ToolEffect): ToolDefinition {
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
const EXEC_TOOL = makeTool('shell', 'exec'); // exec 档工具（三值扩——任意进程执行类）

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
  toolPolicy?: readonly ToolPolicyEntry[];
  /** 审批策略档（缺省 'ask'；never = 无人值守确定性拒——翻案矩阵用例消费） */
  policy?: ApprovalPolicyMode;
  /** 数据目录恒排除位覆写（缺省 tmp 下固定假路径——不与 workspace 交叠，隔离「根内遮罩」与「fence 根外」两面） */
  dataDir?: string;
  beforeInstall?: () => void;
}) {
  const dispatch = new EventDispatch();
  dispatch.registerEventNames(TOOL_EVENT_NAMES);
  const asks: ApprovalRequest[] = [];
  let answer: ApprovalOutcome = 'allowed-once'; // 可编程（缺省批准——凸显「不该问的场景问了没有」）
  const policy = opts?.policy ?? 'ask';
  const approval: ApprovalService = {
    policyMode: policy,
    ask: async (req: ApprovalRequest) => {
      // never 档模拟真服务形：不问不推 asks、确定性拒（source=policy-never）
      if (policy === 'never') return { outcome: 'rejected', source: 'policy-never' };
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
    // 数据目录恒排除位（04 §7/§8 遗漏审计批补钉）：缺省假路径在 tmp 下且不
    // 存在——canonical 化走「最近存在祖先」回退，与写侧同律无需真实建目录
    dataDir: opts?.dataDir ?? join(tmpdir(), 'berry-gate-datadir'),
    ...(opts?.entries !== undefined ? { entries: opts.entries } : {}),
    ...(opts?.toolPolicy !== undefined ? { toolPolicy: opts.toolPolicy } : {}),
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
    return { blocked: out.outcome?.action === 'block', reason, reached, allowReason: out.allowReason };
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
    const rig = makeRig({ toolPolicy: [{ tool: 'write', pattern: '.git', decision: 'allow' }] });
    const result = await rig.run(WRITE, { path: join(ws, '.git', 'hooks', 'pre-commit') });
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  /* ---- 数据目录恒排除（04 §7/§8 遗漏审计批补钉——修前必红三锁） ---- */

  it('数据目录族恒不可写：danger 档写 enabled.yaml → carve-out 硬拒不问（04 §14 信任锚不可自授）', async () => {
    const rig = makeRig({ mode: 'danger' });
    // danger 档根 = 路径分隔符全盘——数据目录恒在根内，防线只有 carve-out 一道
    const result = await rig.run(WRITE, { path: join(tmpdir(), 'berry-gate-datadir', 'enabled.yaml') });
    expect(result.blocked).toBe(true);
    expect(result.reached).toBe(false); // 短路——链下游不到达
    expect(rig.asks).toHaveLength(0); // 硬拒不产生审批交互
    expect(result.reason).toContain('数据目录');
    expect(result.reason).toContain('恒不可写');
  });

  it('数据目录条不可关：entries=[]（显式关 .git/.env 例示面）仍拒（恒 = 平台底线不交装配裁量）', async () => {
    const rig = makeRig({ mode: 'danger', entries: [] });
    const result = await rig.run(WRITE, { path: join(tmpdir(), 'berry-gate-datadir', 'credentials', 'secret.key') });
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  it('workspace-write 档数据目录在根内（workspace 含数据目录）→ 照样遮罩硬拒（不依赖 danger 形）', async () => {
    const rig = makeRig({ dataDir: join(ws, 'host-data') });
    const result = await rig.run(WRITE, { path: 'host-data/enabled.yaml' });
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
    expect(result.reason).toContain('数据目录');
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

/* ---------------- 策略表 allow 免问（粘性第 3 款——advisory；2026-09-11 审批分档批更名） ---------------- */

describe('allowlist 免问', () => {
  it('fs 前缀命中：全部写目标在前缀内 → 免问放行（fence/执行段照走）', async () => {
    const rig = makeRig({ toolPolicy: [{ tool: 'write', pattern: 'src', decision: 'allow' }] });
    const result = await rig.run(WRITE, { path: 'src/deep/nested/a.ts' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  it('TTL 过期条目不命中 → 照问', async () => {
    const rig = makeRig({
      toolPolicy: [{ tool: 'write', pattern: 'src', decision: 'allow', expiresAt: Date.now() - 1 }],
    });
    await rig.run(WRITE, { path: 'src/a.ts' });
    expect(rig.asks).toHaveLength(1);
  });

  it('整名族：非 fs 写意图工具按工具名免问（deploy 条目只免 deploy）', async () => {
    const rig = makeRig({ toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'allow' }] });
    const hit = await rig.run(DEPLOY, { region: 'cn' });
    expect(hit.blocked).toBe(false);
    expect(rig.asks).toHaveLength(0);
    // 其他 write-effect 工具不受整名条目影响（工具名不等不命中）
    const rig2 = makeRig({ toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'allow' }] });
    await rig2.run(WRITE, { path: 'src/a.ts' });
    expect(rig2.asks).toHaveLength(1);
  });

  it('命中审计标注（04 §9 命中审计条款 + 审批分档批④更词）：allowReason = policy-allow:<条目序>——首条命中 0、第二条命中 1', async () => {
    // 首条工具名不匹配（跳过），第二条命中——序号是条目在清单中的位置非命中次数
    const rig = makeRig({
      toolPolicy: [
        { tool: 'deploy', pattern: '', decision: 'allow' },
        { tool: 'write', pattern: 'src', decision: 'allow' },
      ],
    });
    const hit = await rig.run(WRITE, { path: 'src/a.ts' });
    expect(hit.blocked).toBe(false);
    expect(hit.allowReason).toBe('policy-allow:1');
  });

  it('未命中路径不置标注（allowReason 缺省 undefined——审批放行是普通放行非免问面）', async () => {
    const rig = makeRig();
    const result = await rig.run(WRITE, { path: 'src/a.ts' });
    expect(result.blocked).toBe(false);
    expect(rig.asks).toHaveLength(1); // 走了审批对
    expect(result.allowReason).toBeUndefined();
  });
});

/* ---------------- 工具策略表 deny 面（审批分档批定形块④——deny 优先律） ---------------- */

describe('deny 硬拒', () => {
  it('deny 条目命中 → block 硬拒短路：不产生审批对、reason 注明策略表归因与不可翻转', async () => {
    const rig = makeRig({ toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'deny', reason: '生产环境禁部署' }] });
    const result = await rig.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(true);
    expect(result.reached).toBe(false); // 短路整链
    expect(rig.asks).toHaveLength(0); // deny 拒不产生 approval 对（粘性命中无审批对同律）
    expect(result.reason).toContain('policy-deny:0');
    expect(result.reason).toContain('生产环境禁部署'); // 用户手写 reason 呈现
  });

  it('deny 序在 allow 之后仍胜（引擎 deny 优先律——allow 条目不可翻转 deny）', async () => {
    const rig = makeRig({
      toolPolicy: [
        { tool: 'deploy', pattern: '', decision: 'allow' },
        { tool: 'deploy', pattern: '', decision: 'deny' },
      ],
    });
    const result = await rig.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
  });

  it('fs 族 deny 条目按 pattern 圈定拒绝面：前缀外照常走审批（非整工具绝杀）', async () => {
    const rig = makeRig({ toolPolicy: [{ tool: 'write', pattern: 'secrets', decision: 'deny' }] });
    const denied = await rig.run(WRITE, { path: 'secrets/k.env' });
    expect(denied.blocked).toBe(true);
    expect(rig.asks).toHaveLength(0);
    // 前缀外：deny 未命中 → 照问（本测 rig 缺省批准 → 放行）
    const outside = await rig.run(WRITE, { path: 'src/a.ts' });
    expect(outside.blocked).toBe(false);
    expect(rig.asks).toHaveLength(1);
  });

  it('deny 条目带 expiresAt 属坏形 → 引擎剔除：不硬拒不误免问，照常回落审批', async () => {
    const rig = makeRig({
      toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'deny', expiresAt: Date.now() + 60_000 }],
    });
    const result = await rig.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(false);
    expect(rig.asks).toHaveLength(1); // 坏形剔除后无 deny 面 → 回落 ask
  });

  it('write 档 deny 条目不覆盖 read 档调用——read 工具在显式 read 声明下放行', async () => {
    // 档位偏序（③）：deny 及以上扩面——write 档 deny 不拦 read 档调用；
    // （deny 拦 read 档工具须 deny 条目档位覆盖 read——见「评估序六步」组）
    const rig = makeRig({ toolPolicy: [{ tool: 'read', decision: 'deny', effect: 'write' }] });
    const result = await rig.run(READ, { path: 'src/a.ts' });
    expect(result.blocked).toBe(false);
    expect(rig.asks).toHaveLength(0);
  });
});

/* ---------------- 评估序六步（04 §9 定形块④——ap-2 重排锁） ---------------- */

describe('评估序六步', () => {
  it('(1) 先于 (3)：deny 可拦 read 档工具（「此工具永拒」的用户主权语义覆盖只读工具——read 档免审 ≠ 免策略表）', async () => {
    // 条目 effect 缺席 = 全档（含 read）；read 工具整名命中即硬拒
    const rig = makeRig({ toolPolicy: [{ tool: 'read', decision: 'deny', reason: '禁读此工作区' }] });
    const result = await rig.run(READ, { path: 'src/a.ts' });
    expect(result.blocked).toBe(true);
    expect(result.reached).toBe(false);
    expect(rig.asks).toHaveLength(0);
    expect(result.reason).toContain('policy-deny:0');
  });

  it('read-only 档让棒沿旧：skip 位保持一切判定之前（策略表在 read-only 会话无执法位——deny 亦不前置执法）', async () => {
    const rig = makeRig({ mode: 'read-only', toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'deny' }] });
    const result = await rig.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true); // 让棒（write 的拒绝面归 fence——空根必拒，本行不重复拦）
    expect(rig.asks).toHaveLength(0);
  });
});

/* ---------------- deny 翻转不可矩阵（④——最严者胜：任何面无权翻案） ---------------- */

describe('deny 翻转不可矩阵', () => {
  it('deny × sandbox danger：danger 档不豁免（底线上再叠用户主权拒）', async () => {
    const rig = makeRig({ mode: 'danger', toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'deny' }] });
    const result = await rig.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(true);
    expect(result.reached).toBe(false);
    expect(result.reason).toContain('policy-deny:0');
  });

  it('deny × policy never：deny 先于 ask 短路（reason 落 policy-deny 非 policy-never 拒）', async () => {
    const denied = makeRig({ policy: 'never', toolPolicy: [{ tool: 'deploy', pattern: '', decision: 'deny' }] });
    const result = await denied.run(DEPLOY, { region: 'cn' });
    expect(result.blocked).toBe(true);
    expect(denied.asks).toHaveLength(0); // deny 短路在 ask 之前（never 档本也不问——双保险互证）
    expect(result.reason).toContain('policy-deny:0');
    // 对照组（无 deny 条目）：never 档由 ask 收口——拒绝归因是审批结果非策略表
    const contrast = makeRig({ policy: 'never' });
    const c = await contrast.run(DEPLOY, { region: 'cn' });
    expect(c.blocked).toBe(true);
    expect(c.reason).toContain('rejected');
    expect(c.reason).not.toContain('policy-deny');
  });

  it('deny × 会话粘性 always：sticky 命中不翻案（真 ApprovalService 全链——sticky 在 ask 内、deny 在 ask 前，结构上不可达）', async () => {
    // 真审批服务 + 恒答 always 的 answerer + 活数组策略表（引擎逐调用重读——
    // 装配后追加 deny 条目即生效，模拟用户会话中途手改文件后热载面）
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(TOOL_EVENT_NAMES);
    const livePolicy: ToolPolicyEntry[] = [];
    const persisted: { tool: string; pattern: string }[] = [];
    let askedCount = 0;
    let answered = 0;
    const approval = createApprovalService(dispatch, {
      sink: { asked: () => (askedCount += 1), decided: () => {} },
      persistToolPolicy: (draft) => persisted.push({ tool: draft.tool, pattern: draft.pattern }),
    });
    dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, async (input) => {
      answered += 1;
      return { ...input, answer: 'always' }; // 不调 next：已答短路
    });
    installSafetyGate(dispatch, {
      approval,
      workspace: ws,
      mode: () => 'workspace-write',
      dataDir: join(tmpdir(), 'berry-gate-datadir'),
      toolPolicy: livePolicy,
    });
    let reached = false;
    dispatch.onWaterfall<GateInput>(TOOL_EVENT_NAMES[0]!, (input) => {
      reached = true;
      return input;
    });
    const run = async (tool: ToolDefinition, args: Record<string, unknown>) => {
      reached = false;
      const out = await dispatch.waterfall<GateInput>(TOOL_EVENT_NAMES[0]!, {
        tool,
        args,
        toolCallId: 'call-1',
        mutated: false,
      });
      const reason = out.outcome !== undefined && out.outcome.action === 'block' ? out.outcome.reason : '';
      return { blocked: out.outcome?.action === 'block', reason, reached };
    };

    // 第一次：问 → always → 草案落账 + 粘性入账（单目标 fs 族带草案——04 §9 定形③）
    const first = await run(WRITE, { path: 'src/a.ts' });
    expect(first.blocked).toBe(false);
    expect(first.reached).toBe(true);
    expect(askedCount).toBe(1);
    expect(answered).toBe(1);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.tool).toBe('write');

    // 第二次同目标：粘性短路（ask 之内免问——answerer 不再被派发）
    const second = await run(WRITE, { path: 'src/a.ts' });
    expect(second.blocked).toBe(false);
    expect(askedCount).toBe(1);
    expect(answered).toBe(1);

    // 会话中途追加 deny 条目（活数组——引擎逐调用重读）：deny 在 ask 之前短路，
    // 粘性在 ask 内结构上不可达——已有宽批不能翻转用户主权拒
    livePolicy.push({ tool: 'write', pattern: 'src', decision: 'deny', reason: '中途禁写' });
    const third = await run(WRITE, { path: 'src/a.ts' });
    expect(third.blocked).toBe(true);
    expect(third.reached).toBe(false);
    expect(askedCount).toBe(1); // 连 ask 都没进
    expect(answered).toBe(1);
    expect(third.reason).toContain('policy-deny:0');
    expect(third.reason).toContain('中途禁写');
  });
});

/* ---------------- exec 档（审批分档批三值扩——read 早退收紧锁） ---------------- */

describe('exec 档工具', () => {
  it('exec 档走审批对（read 早退收紧：非 read 档不留审批旁路）', async () => {
    const rig = makeRig();
    const result = await rig.run(EXEC_TOOL, { command: 'ls' });
    expect(result.blocked).toBe(false);
    expect(result.reached).toBe(true);
    expect(rig.asks).toHaveLength(1); // exec 同 write 触发审批对
    expect(rig.asks[0]!.stickyKey).toEqual({ target: 'shell', tier: 'workspace-write' }); // 整名族指纹
  });

  it('exec 调用不被 write 档 allow 条目免问（偏序窄化自限——write 档免问授权结构上不覆盖 exec）', async () => {
    const rig = makeRig({ toolPolicy: [{ tool: 'shell', pattern: '', decision: 'allow', effect: 'write' }] });
    await rig.run(EXEC_TOOL, { command: 'ls' });
    expect(rig.asks).toHaveLength(1); // 条目档位不及 → 未命中 → 照问
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

describe('会话归属过滤（批 19c-1——同栈多会话装配）', () => {
  /** 双行装配：同 dispatch 父子两会话各装一行守门（归属位各织各的） */
  function makeDualRig() {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(TOOL_EVENT_NAMES);
    const asksBy: Record<string, ApprovalRequest[]> = { parent: [], child: [] };
    const install = (owner: 'parent' | 'child', sessionId: string) =>
      installSafetyGate(dispatch, {
        approval: {
          policyMode: 'ask',
          ask: async (req) => {
            asksBy[owner]!.push(req);
            return { outcome: 'allowed-once', source: 'user' };
          },
        },
        sessionId,
        workspace: ws,
        mode: () => 'workspace-write',
        dataDir: join(tmpdir(), 'berry-gate-datadir'),
      });
    install('parent', 's-parent');
    install('child', 's-child');
    const run = async (sessionId: string | undefined) => {
      const input: GateInput = {
        tool: WRITE,
        args: { path: 'a.txt', content: 'x' },
        toolCallId: 'call-1',
        mutated: false,
        ...(sessionId !== undefined ? { sessionId } : {}),
      };
      return dispatch.waterfall<GateInput>(TOOL_EVENT_NAMES[0]!, input);
    };
    return { run, asksBy };
  }

  it('子的 write 只走子行：父行让棒——恰一问且问在归属行（双审批对缺陷回归锁）', async () => {
    const rig = makeDualRig();
    const out = await rig.run('s-child');
    expect(out.outcome).toBeUndefined(); // 放行（无拦截）
    expect(rig.asksBy.child).toHaveLength(1);
    expect(rig.asksBy.parent).toHaveLength(0); // 父行让棒不执法不问
  });

  it('归属互斥对称：父的 write 只走父行', async () => {
    const rig = makeDualRig();
    await rig.run('s-parent');
    expect(rig.asksBy.parent).toHaveLength(1);
    expect(rig.asksBy.child).toHaveLength(0);
  });

  it('调用位无会话键 = 判据缺席不过滤（旧行为保持——两行各执法）', async () => {
    const rig = makeDualRig();
    await rig.run(undefined);
    expect(rig.asksBy.parent).toHaveLength(1);
    expect(rig.asksBy.child).toHaveLength(1); // 无会话语境不歧视——单会话测试形兼容
  });

  it('归属行 block 短路整链（异会话行让棒在前不吞拦截）', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(TOOL_EVENT_NAMES);
    let parentAsked = 0;
    installSafetyGate(dispatch, {
      // 父行恒拒——验证子的调用不被父行拦截（让棒语义），父自己的调用被拦
      approval: {
        policyMode: 'ask',
        ask: async () => {
          parentAsked += 1;
          return { outcome: 'rejected', source: 'user' };
        },
      },
      sessionId: 's-parent',
      workspace: ws,
      mode: () => 'workspace-write',
      dataDir: join(tmpdir(), 'berry-gate-datadir'),
    });
    let childAsked = 0;
    installSafetyGate(dispatch, {
      approval: {
        policyMode: 'ask',
        ask: async () => {
          childAsked += 1;
          return { outcome: 'allowed-once', source: 'user' };
        },
      },
      sessionId: 's-child',
      workspace: ws,
      mode: () => 'workspace-write',
      dataDir: join(tmpdir(), 'berry-gate-datadir'),
    });
    const call = (sessionId: string) =>
      dispatch.waterfall<GateInput>(TOOL_EVENT_NAMES[0]!, {
        tool: WRITE,
        args: { path: 'a.txt', content: 'x' },
        toolCallId: 'c',
        mutated: false,
        sessionId,
      });
    const childOut = await call('s-child');
    expect(childOut.outcome).toBeUndefined(); // 子调用放行（父行让棒不拦）
    expect(childAsked).toBe(1);
    expect(parentAsked).toBe(0);
    const parentOut = await call('s-parent');
    expect(parentOut.outcome?.action).toBe('block'); // 父调用被归属行拦截
    expect(parentAsked).toBe(1);
    expect(childAsked).toBe(1); // 子行对父调用让棒
  });
});
