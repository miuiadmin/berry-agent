/**
 * safety/sandbox 测试 — 沙箱 seam（后端链仲裁/fail-closed）+ 三级解析 fold +
 * 升权校验 + 平台后端参数面（04 §8）。
 *
 * 纪律：seam 与纯函数全真；probe 用计数假后端（不 spawn——真探测由 exec 批
 * 的平台链冒烟面承担）；平台后端（seatbelt/bwrap）只测参数面纯函数。
 */
import { describe, it, expect } from 'vitest';
import { BaseError } from '../contracts/index.js';
import type { SandboxBackend } from './types.js';
import {
  ESCALATION_TARGETS,
  WIDER_MODES,
  bwrapArgs,
  createDefaultBackends,
  createSandboxService,
  createSeatbeltBackend,
  escalationHintMarker,
  isSandboxMode,
  resolveEffectiveMode,
  resolvePolicyRoots,
  sandboxDenialMarker,
  seatbeltProfile,
  seatbeltReadOnlyProfile,
  validateEscalationArgs,
  requestEscalation,
} from './index.js';
import { createBwrapBackend } from './bwrap.js';
import { sensitiveReadFiles, type SandboxPolicy } from './index.js';

/** bwrap 基座参数字面量（测试侧期望形——tmpfs 恒第一条：顺序即正确性） */
const BWRAP_BASE = [
  '--tmpfs',
  '/tmp',
  '--ro-bind',
  '/',
  '/',
  '--dev',
  '/dev',
  '--proc',
  '/proc',
  '--unshare-pid',
  '--die-with-parent',
];

/** 同步抛错的码断言（惯例同 fs.test 的 rejects.toMatchObject({code})） */
function expectSyncCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toMatchObject({ code });
  }
}

/* ---------------- 假后端工厂（计数 probe——仲裁与缓存断言用） ---------------- */

/** 假后端工厂：wrap 前缀注入后端标识，probe 可编程且计数 */
function fakeBackend(id: string, probeResult: boolean): { backend: SandboxBackend; probeCount: () => number } {
  let count = 0;
  const backend: SandboxBackend = {
    id,
    enforcement: 'full',
    denialSignatures: [`denied-by-${id}`],
    runnerFailureRules: [{ fatalSignatures: [`${id}-fatal`] }],
    wrap: (argv, policy) => [id, policy.mode, ...argv],
    probe: () => {
      count += 1;
      return probeResult;
    },
  };
  return { backend, probeCount: () => count };
}

/* ---------------- 三级解析 fold 半边 ---------------- */

describe('resolveEffectiveMode / isSandboxMode', () => {
  it('三档词汇守卫', () => {
    expect(isSandboxMode('read-only')).toBe(true);
    expect(isSandboxMode('workspace-write')).toBe(true);
    expect(isSandboxMode('danger')).toBe(true);
    expect(isSandboxMode('danger-full-access')).toBe(false); // berry 长名不承
  });
  it('空序列折叠到缺省档 workspace-write（个人开发机形态实用缺省）', () => {
    expect(resolveEffectiveMode([])).toBe('workspace-write');
  });
  it('会话 override 序列最后一条胜出；显式 fallback 尊重', () => {
    expect(resolveEffectiveMode([{ mode: 'danger' }, { mode: 'read-only' }])).toBe('read-only');
    expect(resolveEffectiveMode([], 'read-only')).toBe('read-only');
  });
  it('坏档位响亮失败（静默跳过会沿用旧档——fail-open）', () => {
    expect(() => resolveEffectiveMode([{ mode: 'ultra' }])).toThrow(BaseError);
  });
});

/* ---------------- 后端链仲裁与 fail-closed ---------------- */

describe('createSandboxService', () => {
  it('空链 confine 抛 SANDBOX_UNAVAILABLE——fail-closed 绝不裸跑', () => {
    const service = createSandboxService({ backends: [] });
    expectSyncCode(
      () => service.confine(['ls', '/'], { mode: 'read-only', workspaceRoot: '/ws' }),
      'SANDBOX_UNAVAILABLE',
    );
  });

  it('单候选链不预探测（probe 不被调用——探测有 spawn 开销）', () => {
    const { backend, probeCount } = fakeBackend('only', false); // probe 恒败也不影响单候选
    const service = createSandboxService({ backends: [backend] });
    const confined = service.confine(['git', 'status'], { mode: 'workspace-write', workspaceRoot: '/ws' });
    expect(confined.argv).toEqual(['only', 'workspace-write', 'git', 'status']);
    // 后端差异元数据原样下发（消费方零后端知识）
    expect(confined.enforcement).toBe('full');
    expect(confined.denialSignatures).toEqual(['denied-by-only']);
    expect(confined.runnerFailureRules).toEqual([{ fatalSignatures: ['only-fatal'] }]);
    expect(probeCount()).toBe(0);
  });

  it('多候选按 probe 仲裁：失败候选跳过、探测结果按后端缓存一次', () => {
    const bad = fakeBackend('bad', false);
    const good = fakeBackend('good', true);
    const service = createSandboxService({ backends: [bad.backend, good.backend] });
    expect(service.confine(['ls'], { mode: 'read-only', workspaceRoot: '/' }).argv[0]).toBe('good');
    expect(service.confine(['ls'], { mode: 'read-only', workspaceRoot: '/' }).argv[0]).toBe('good'); // 二次 confine
    expect(bad.probeCount()).toBe(1); // 缓存一次——失败候选不重试
    expect(good.probeCount()).toBe(1);
  });

  it('多候选全败 → SANDBOX_UNAVAILABLE', () => {
    const a = fakeBackend('a', false);
    const b = fakeBackend('b', false);
    const service = createSandboxService({ backends: [a.backend, b.backend] });
    expectSyncCode(
      () => service.confine(['ls'], { mode: 'workspace-write', workspaceRoot: '/ws' }),
      'SANDBOX_UNAVAILABLE',
    );
  });

  it('无 probe 的多候选视为可用（注册序首个即用）', () => {
    const plain: SandboxBackend = {
      id: 'plain',
      enforcement: 'partial',
      denialSignatures: [],
      runnerFailureRules: [],
      wrap: (argv) => ['plain', ...argv],
    };
    const service = createSandboxService({ backends: [plain] });
    expect(service.confine(['x'], { mode: 'read-only', workspaceRoot: '/' }).argv).toEqual(['plain', 'x']);
    expect(service.confine(['x'], { mode: 'read-only', workspaceRoot: '/' }).enforcement).toBe('partial');
  });

  it('registerBackend 追加链尾；注销器幂等且只撤链尾的本后端（同位护栏）', () => {
    const first = fakeBackend('first', true);
    const second = fakeBackend('second', true);
    const service = createSandboxService({ backends: [first.backend] });
    const disposeSecond = service.registerBackend(second.backend);
    expect(service.listBackends().map((b) => b.id)).toEqual(['first', 'second']);
    disposeSecond(); // second 在链尾 → 弹出
    expect(service.listBackends().map((b) => b.id)).toEqual(['first']);
    disposeSecond(); // 幂等
    expect(service.listBackends().map((b) => b.id)).toEqual(['first']);
  });

  it('注销器不动非链尾的本后端（防误撤他者后来注册压上的形态）', () => {
    const first = fakeBackend('first', true);
    const second = fakeBackend('second', true);
    const service = createSandboxService({ backends: [] });
    const disposeFirst = service.registerBackend(first.backend);
    service.registerBackend(second.backend); // first 不在链尾了
    disposeFirst();
    expect(service.listBackends().map((b) => b.id)).toEqual(['first', 'second']); // 未被撤
  });

  it('平台默认链如实分派（macOS=seatbelt / Linux=bwrap / 其余空链）', () => {
    const chain = createDefaultBackends().map((b) => b.id);
    if (process.platform === 'darwin') expect(chain).toEqual(['seatbelt']);
    else if (process.platform === 'linux') expect(chain).toEqual(['bwrap']);
    else expect(chain).toEqual([]);
  });
});

/* ---------------- 策略根解析 ---------------- */

describe('resolvePolicyRoots', () => {
  it('缺省按档位推导（与 fs fence 同源）；显式覆盖两档同等生效', () => {
    const ws = '/workspace';
    expect(resolvePolicyRoots({ mode: 'read-only', workspaceRoot: ws })).toEqual([]);
    // 显式覆盖在 read-only 档也生效（e1 式宿主只读档携刚需根的字段契约本义）
    expect(resolvePolicyRoots({ mode: 'read-only', workspaceRoot: ws, writableRoots: ['/data'] })).toEqual(['/data']);
  });
});

/* ---------------- 严格变宽升权 ---------------- */

describe('validateEscalationArgs / WIDER_MODES', () => {
  it('严格变宽阶梯表', () => {
    expect(WIDER_MODES['read-only']).toEqual(['workspace-write', 'danger']);
    expect(WIDER_MODES['workspace-write']).toEqual(['danger']);
    expect(WIDER_MODES.danger).toEqual([]);
    expect(ESCALATION_TARGETS).toEqual(['workspace-write', 'danger']);
  });

  it('成对非空：双缺 / 半缺都拒', () => {
    expect(() =>
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: undefined, justification: undefined }),
    ).toThrow(BaseError);
    expect(() =>
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: 'danger', justification: undefined }),
    ).toThrow(BaseError);
    expect(() =>
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: undefined, justification: '需要写' }),
    ).toThrow(BaseError);
    expect(() =>
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: '  ', justification: 'x' }),
    ).toThrow(BaseError); // 空白同空
  });

  it('目标档必须是合法升权目标（read-only 非目标；拼错词面拒）', () => {
    expect(() =>
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: 'read-only', justification: 'x' }),
    ).toThrowError(/升权目标档非法/);
    expect(() =>
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: 'ultra', justification: 'x' }),
    ).toThrow(BaseError);
  });

  it('非严格变宽拒：同档重试与变窄伪装都不进审批', () => {
    expect(() =>
      validateEscalationArgs({ current: 'workspace-write', sandboxPermissions: 'workspace-write', justification: 'x' }),
    ).toThrowError(/非严格变宽/);
    expect(() =>
      validateEscalationArgs({ current: 'danger', sandboxPermissions: 'workspace-write', justification: 'x' }),
    ).toThrow(BaseError); // 变窄
    expect(() =>
      validateEscalationArgs({ current: 'danger', sandboxPermissions: 'danger', justification: 'x' }),
    ).toThrow(BaseError); // 已是最高档
  });

  it('合法升权通过并回执目标与理由（trim 后）', () => {
    expect(
      validateEscalationArgs({ current: 'read-only', sandboxPermissions: ' danger ', justification: ' 需要写 ' }),
    ).toEqual({
      target: 'danger',
      justification: '需要写',
    });
    expect(
      validateEscalationArgs({ current: 'workspace-write', sandboxPermissions: 'danger', justification: '装依赖' }),
    ).toEqual({
      target: 'danger',
      justification: '装依赖',
    });
  });

  it('统一拒绝标记与升权提示（文案单源）', () => {
    expect(sandboxDenialMarker('read-only')).toBe('[sandbox: file access denied under read-only]');
    expect(escalationHintMarker()).toContain('sandbox_permissions');
  });

  it('requestEscalation 组装审批载荷（升权摘要/理由/信号/草案透传；danger 高位无草案）', async () => {
    const seen: unknown[] = [];
    const approval = {
      ask: async (r: unknown) => {
        seen.push(r);
        return { outcome: 'unavailable' as const };
      },
    };
    const signal = new AbortController().signal;
    const result = await requestEscalation(approval, {
      target: 'workspace-write',
      justification: 'npm install 需写 node_modules',
      current: 'read-only',
      toolName: 'bash',
      toolCallId: 'c1',
      suggestedEntry: { tool: 'bash', pattern: 'npm install' },
      signal,
    });
    expect(result).toEqual({ outcome: 'unavailable' });
    const req = seen[0] as Record<string, unknown>;
    expect(req['summary']).toBe('沙箱升权 read-only → workspace-write');
    expect(req['reason']).toContain('npm install 需写 node_modules');
    expect(req['toolName']).toBe('bash');
    expect(req['signal']).toBe(signal);
    expect(req['suggestedEntry']).toEqual({ tool: 'bash', pattern: 'npm install' });
  });
});

/* ---------------- 平台后端参数面（纯函数——不 spawn） ---------------- */

describe('seatbelt 参数面', () => {
  it('read-only 基座：全默认放行 + 拒写 + /dev/null 例外', () => {
    expect(seatbeltReadOnlyProfile().split('\n')).toEqual([
      '(version 1)',
      '(allow default)',
      '(deny file-write*)',
      '(allow file-write* (literal "/dev/null"))',
    ]);
    // read-only 空根 → profile 即基座本体（无 subpath 追加）
    expect(seatbeltProfile({ mode: 'read-only', workspaceRoot: '/ws' })).toBe(seatbeltReadOnlyProfile());
  });
  it('workspace-write 逐根追加 subpath allow；字面量转义 " 与 \\', () => {
    const profile = seatbeltProfile({
      mode: 'workspace-write',
      workspaceRoot: '/ws',
      writableRoots: ['/we"ird', '/back\\slash'],
    });
    expect(profile).toContain('(allow file-write* (subpath "/we\\"ird"))');
    expect(profile).toContain('(allow file-write* (subpath "/back\\\\slash"))');
  });
  it('后端包装 argv 前缀 sandbox-exec -p profile --（元数据面）', () => {
    const backend = createSeatbeltBackend();
    expect(backend.id).toBe('seatbelt');
    expect(backend.denialSignatures).toEqual(['operation not permitted']);
    const argv = backend.wrap(['ls', '/'], { mode: 'read-only', workspaceRoot: '/ws' });
    expect(argv.slice(0, 2)).toEqual(['sandbox-exec', '-p']);
    expect(argv.slice(-3)).toEqual(['--', 'ls', '/']); // 原样附尾
  });
});

describe('bwrap 参数面', () => {
  it('基座：tmpfs /tmp 恒第一条挂载（顺序即正确性）+ 全系统只读 + 虚拟设备', () => {
    expect(bwrapArgs({ mode: 'read-only', workspaceRoot: '/ws' })).toEqual(BWRAP_BASE);
    expect(BWRAP_BASE.slice(0, 4)).toEqual(['--tmpfs', '/tmp', '--ro-bind', '/']);
  });
  it('workspace-write 逐根 bind 且 /tmp 根跳过重复挂载；后端差异元数据', () => {
    const args = bwrapArgs({ mode: 'workspace-write', workspaceRoot: '/ws', writableRoots: ['/tmp', '/ws'] });
    expect(args).toEqual([...BWRAP_BASE, '--bind', '/ws', '/ws']);
    const backend = createBwrapBackend();
    expect(backend.id).toBe('bwrap');
    expect(backend.denialSignatures).toEqual(['read-only file system']);
    expect(backend.wrap(['ls', '/'], { mode: 'read-only', workspaceRoot: '/ws' })).toEqual([
      'bwrap',
      ...BWRAP_BASE,
      '--',
      'ls',
      '/',
    ]);
  });
});

/* ---------------- 读 deny 与 danger 档形（2026-09-08 P0①） ---------------- */

describe('读 deny / danger 档形（04 §7 读侧 carve-out + 04 §8 定形②）', () => {
  const DENY = ['/data/secret.key', '/data/allowlist.json'];
  const DENY_LINES = DENY.map((p) => `(deny file-read* (literal "${p}"))`);

  it('seatbelt：读 deny 行末位追加（last-match-wins 压过此前全部 allow）', () => {
    const lines = seatbeltProfile({
      mode: 'workspace-write',
      workspaceRoot: '/ws',
      writableRoots: ['/ws'],
      denyReadFiles: DENY,
    }).split('\n');
    expect(lines.slice(-2)).toEqual(DENY_LINES);
  });

  it('seatbelt danger 形：最小读 deny profile——无拒写无逐根 allow、读 deny 仍在（任何档一律）', () => {
    const profile = seatbeltProfile({ mode: 'danger', workspaceRoot: '/ws', denyReadFiles: DENY });
    expect(profile.split('\n')).toEqual(['(version 1)', '(allow default)', ...DENY_LINES]);
    expect(profile).not.toContain('deny file-write*');
    expect(profile).not.toContain('subpath');
  });

  it('bwrap：遮蔽行末位追加 --ro-bind-try /dev/null <path>（后位遮蔽——mount 点后建压前挂载）', () => {
    expect(
      bwrapArgs({ mode: 'workspace-write', workspaceRoot: '/ws', writableRoots: ['/ws'], denyReadFiles: DENY }),
    ).toEqual([
      ...BWRAP_BASE,
      '--bind',
      '/ws',
      '/ws',
      '--ro-bind-try',
      '/dev/null',
      '/data/secret.key',
      '--ro-bind-try',
      '/dev/null',
      '/data/allowlist.json',
    ]);
  });

  it('bwrap danger 形：--bind / / 全盘读写 + 卫生旗恒在（--proc/--unshare-pid = /proc 同 uid 进程面结构性不可见）+ 遮蔽末位；无 tmpfs/ro-bind 基座', () => {
    expect(bwrapArgs({ mode: 'danger', workspaceRoot: '/ws', denyReadFiles: DENY })).toEqual([
      '--bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--unshare-pid',
      '--die-with-parent',
      '--ro-bind-try',
      '/dev/null',
      '/data/secret.key',
      '--ro-bind-try',
      '/dev/null',
      '/data/allowlist.json',
    ]);
  });

  it('confine enrich：未携带 denyReadFiles 且持有 dataDir → 敏感集单源补位；显式携带（含空数组）恒胜出', () => {
    const seen: SandboxPolicy[] = [];
    const recorder: SandboxBackend = {
      id: 'recorder',
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [],
      wrap: (argv, policy) => {
        seen.push(policy);
        return [...argv];
      },
    };
    const service = createSandboxService({ backends: [recorder], dataDir: '/data' });
    service.confine(['ls'], { mode: 'danger', workspaceRoot: '/ws' });
    expect(seen[0]!.denyReadFiles).toEqual(sensitiveReadFiles('/data')); // 单源派生注入
    service.confine(['ls'], { mode: 'danger', workspaceRoot: '/ws', denyReadFiles: [] });
    expect(seen[1]!.denyReadFiles).toEqual([]); // 显式空数组 = 显式无读 deny
    const bare = createSandboxService({ backends: [recorder] }); // 无 dataDir（诊断形）
    bare.confine(['ls'], { mode: 'read-only', workspaceRoot: '/ws' });
    expect(seen[2]!.denyReadFiles).toBeUndefined(); // 不虚构补位
  });

  it('SANDBOX_UNAVAILABLE 文案不引导换 danger 档（换档不是绕后端的路——三档一律）', () => {
    const service = createSandboxService({ backends: [] });
    try {
      service.confine(['ls'], { mode: 'danger', workspaceRoot: '/' });
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
      expect((err as Error).message).not.toContain('换 danger 档');
    }
  });
});
