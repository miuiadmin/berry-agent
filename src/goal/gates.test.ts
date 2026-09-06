/**
 * 判据门三源测试——fail-closed 评测（command exit0/超时/缺席/未授权；
 * files 全在且非空/越根/归一；diagnostics error 级/缺席 seam）。
 * 全接缝注入假件零盘零进程。
 */
import { describe, expect, it } from 'vitest';
import { evaluateGoalGates, type GoalGateDeps } from './gates.js';
import type { GoalTodoItem } from './types.js';

/** 条目简写（gate 携带位） */
function gi(gate: GoalTodoItem['gate']): GoalTodoItem {
  return { status: 'completed', content: '验收项', noFollowUp: true, gate };
}

/** 装配依赖（基础：root + 允许 command + 全 seam 缺席——各例覆写） */
function deps(overrides: Partial<GoalGateDeps> = {}): GoalGateDeps {
  return {
    workspaceRoot: '/ws',
    commandGateAllowed: true,
    ...overrides,
  };
}

/** 假 exec seam：按命令名编排结局 */
function fakeExec(map: Record<string, { exitCode?: number; timedOut?: boolean; stderrTail?: string }>) {
  return {
    async execCommand(command: string) {
      const preset = map[command] ?? {};
      return {
        exitCode: preset.exitCode ?? 0,
        timedOut: preset.timedOut ?? false,
        stderrTail: preset.stderrTail ?? '',
      };
    },
  };
}

describe('command 源（exit 0 放行/30s 帽语义在 seam）', () => {
  it('exit 0 放行；非 0 拒携 stderr 末行；超时拒', async () => {
    const exec = fakeExec({
      'make test': { exitCode: 0 },
      'make bad': { exitCode: 2, stderrTail: 'Boom' },
      'make slow': { timedOut: true },
    });
    const d = deps({ exec });
    const [ok, bad, slow] = await evaluateGoalGates(
      [
        gi({ kind: 'command', command: 'make test' }),
        gi({ kind: 'command', command: 'make bad' }),
        gi({ kind: 'command', command: 'make slow' }),
      ],
      d,
    );
    expect(ok).toMatchObject({ ok: true, kind: 'command' });
    expect(bad).toMatchObject({ ok: false, kind: 'command' });
    expect(bad!.detail).toContain('退出码 2');
    expect(bad!.detail).toContain('Boom');
    expect(slow).toMatchObject({ ok: false, kind: 'command' });
    expect(slow!.detail).toContain('超时');
  });

  it('needsWrite 未批准：command 门恒拒（防模型自造命令免审批自跑）', async () => {
    const d = deps({ exec: fakeExec({ 'make test': { exitCode: 0 } }), commandGateAllowed: false });
    const [outcome] = await evaluateGoalGates([gi({ kind: 'command', command: 'make test' })], d);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toContain('needsWrite');
  });

  it('exec seam 缺席：fail-closed 恒拒（不是 skip）', async () => {
    const [outcome] = await evaluateGoalGates([gi({ kind: 'command', command: 'x' })], deps());
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toContain('缺席');
  });
});

describe('files 源（全在且非空；归一判工作区根内）', () => {
  /** 文件表假件：路径 → 存在/大小 */
  function statMap(map: Record<string, { exists: boolean; size: number }>) {
    return (p: string) => map[p] ?? { exists: false, size: 0 };
  }

  it('全部存在且非空放行；缺席/空文件拒', async () => {
    const d = deps({
      statFile: statMap({ '/ws/a.ts': { exists: true, size: 10 }, '/ws/b.ts': { exists: true, size: 0 } }),
    });
    const [ok] = await evaluateGoalGates([gi({ kind: 'files', paths: ['/ws/a.ts'] })], d);
    expect(ok).toMatchObject({ ok: true, kind: 'files' });
    const [missing] = await evaluateGoalGates([gi({ kind: 'files', paths: ['/ws/ghost.ts'] })], d);
    expect(missing!.ok).toBe(false);
    expect(missing!.detail).toContain('不存在');
    const [empty] = await evaluateGoalGates([gi({ kind: 'files', paths: ['/ws/b.ts'] })], d);
    expect(empty!.ok).toBe(false);
    expect(empty!.detail).toContain('为空');
  });

  it('相对路径归一锚根后放行；越根路径拒（裸 stat 不是存在性 oracle）', async () => {
    const d = deps({ statFile: statMap({ '/ws/sub/a.ts': { exists: true, size: 5 } }) });
    const [rel] = await evaluateGoalGates([gi({ kind: 'files', paths: ['sub/a.ts'] })], d);
    expect(rel).toMatchObject({ ok: true, kind: 'files' });
    const [esc] = await evaluateGoalGates([gi({ kind: 'files', paths: ['../etc/passwd'] })], d);
    expect(esc!.ok).toBe(false);
    expect(esc!.detail).toContain('根外');
    const [absEsc] = await evaluateGoalGates([gi({ kind: 'files', paths: ['/etc/passwd'] })], d);
    expect(absEsc!.ok).toBe(false);
    expect(absEsc!.detail).toContain('根外');
  });
});

describe('diagnostics 源（无 error 级放行；lsp 缺席 fail-closed）', () => {
  it('目标集无 error 级放行；有 error 拒携定位', async () => {
    const d = deps({
      lsp: {
        async queryDiagnostics(files) {
          void files;
          return [
            { file: '/ws/a.ts', level: 'warning', message: 'w' },
            { file: '/ws/a.ts', level: 'error', message: 'TS2345 类型不合' },
          ];
        },
      },
    });
    const [outcome] = await evaluateGoalGates([gi({ kind: 'diagnostics', files: ['/ws/a.ts'] })], d);
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toContain('error');
    expect(outcome!.detail).toContain('TS2345');
  });

  it('lsp seam 缺席：评测位亦拒（申报位拒之外的双拦防御）', async () => {
    const [outcome] = await evaluateGoalGates([gi({ kind: 'diagnostics', files: ['/ws/a.ts'] })], deps());
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toContain('缺席');
  });

  it('纯 warning 面：无 error 级放行', async () => {
    const d = deps({
      lsp: {
        async queryDiagnostics() {
          return [{ file: '/ws/a.ts', level: 'info', message: 'i' }];
        },
      },
    });
    const [outcome] = await evaluateGoalGates([gi({ kind: 'diagnostics', files: ['/ws/a.ts'] })], d);
    expect(outcome!.ok).toBe(true);
  });
});

describe('聚合面', () => {
  it('无 gate 声明的条目零评测（零门 = 零条目）；空目标集双拦拒；多门全量返回', async () => {
    const plain: GoalTodoItem = { status: 'pending', content: '无门条目' };
    expect(await evaluateGoalGates([plain], deps())).toEqual([]);
    const statAll = () => ({ exists: true, size: 1 });
    const [emptyFiles, emptyDiag] = await evaluateGoalGates(
      [gi({ kind: 'files', paths: [] }), gi({ kind: 'diagnostics', files: [] })],
      deps({
        statFile: statAll,
        lsp: {
          async queryDiagnostics() {
            return [];
          },
        },
      }),
    );
    expect(emptyFiles!.ok).toBe(false);
    expect(emptyFiles!.detail).toContain('空目标集');
    expect(emptyDiag!.ok).toBe(false);
    expect(emptyDiag!.detail).toContain('空目标集');
    const outcomes = await evaluateGoalGates(
      [gi({ kind: 'files', paths: ['/ws/a.ts'] }), gi({ kind: 'files', paths: ['/ws/b.ts'] })],
      deps({ statFile: statAll }),
    );
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.ok)).toBe(true);
  });
});
