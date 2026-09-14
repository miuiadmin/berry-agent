/**
 * 判据门三源评测机（03 §10.5 gates 条——fail-closed）。
 *
 * 三源判据（goal 段 todo 项可选 gate 声明，完成否决律消费）：
 *  - `command`：exit 0 放行、超时帽 30s、走 exec 守门全序单源复用（ex 批
 *    真接线〔03 §10.5 ex 定形注——seam 真身 = exec 件 createGateExec 工厂，
 *    编舞与 bash 工具同模块单源〕；exec 件缺席/禁用时申报位 hasCommandExec
 *    判据拒 + 评测位本件 fail 双拦——诚实缺席律维持）；**仅 goal needsWrite
 *    申报批准后可用**（模型自造命令免审批自跑是注入面——申报位与评测位双拦）；
 *  - `files`：全部存在且非空；stat 前归一判工作区根内（裸 stat 不得是无
 *    fence 存在性 oracle——路径归一后越根即 fail）；
 *  - `diagnostics`：目标文件集 LSP 诊断无 error 级；lsp 查询窄面缺席时
 *    **评测位亦 fail**（申报位已拒，双拦防御——fail-closed 非静默跳过）。
 *
 * 评测原则：一切 seam 缺席 = fail（不是 skip）——判据门是完成否决的机器
 * 面，门面不在场即门不放行。
 */
import { isAbsolute, resolve, sep } from 'node:path';
import { statSync } from 'node:fs';
import type { GateOutcome, GateSpec, GoalTodoItem } from './types.js';

/** command gate 超时帽（30s 固定——ex 批裁决 3；exec 域同值常量 GATE_EXEC_TIMEOUT_MS 分域自持对拍锁） */
export const GATE_COMMAND_TIMEOUT_MS = 30_000;

/**
 * exec seam 契约（真身 = exec 件 createGateExec 工厂——ex 批真接线 2026-09-14；
 * 组合根经 tryGet('exec') 服务面消费，守门全序与 bash 工具同模块单源；exec
 * 件缺席/禁用时组合根零绑定——申报位拒 + 评测位 fail 双拦维持）
 */
export interface GateExecSeam {
  /** 跑一条命令返退出码（超时帽内未收场 → timedOut: true；seam 内部执法） */
  execCommand(command: string): Promise<{ exitCode: number; timedOut: boolean; stderrTail: string }>;
}

/** lsp 诊断查询窄面契约（组合根闭包注入——lsp 件诊断面投影） */
export interface GateLspSeam {
  queryDiagnostics(
    files: string[],
  ): Promise<Array<{ file: string; level: 'error' | 'warning' | 'info'; message: string }>>;
}

/** 评测依赖（全接缝注入——缺省形态：文件源真身 statSync，exec/lsp 缺席 fail-closed） */
export interface GoalGateDeps {
  /** command gate 执行 seam（缺席 = 该源评测恒 fail） */
  exec?: GateExecSeam;
  /** lsp 诊断查询 seam（缺席 = 该源评测恒 fail） */
  lsp?: GateLspSeam;
  /** 工作区根（files 源归一判根用——绝对路径） */
  workspaceRoot: string;
  /** 文件存在性+大小 seam（缺省 node:fs statSync；测试注假件零盘） */
  statFile?: (p: string) => { exists: boolean; size: number };
  /** command gate 可用性（goal needsWrite 申报+批准——service 层供值） */
  commandGateAllowed: boolean;
}

/**
 * 评测全部 gate 声明（完成否决律的机器面）：逐条独立评测、全量返回——
 * 调用方聚合判「全绿」。无 gate 声明的条目不产条目（零门 = 零评测）。
 */
export async function evaluateGoalGates(items: readonly GoalTodoItem[], deps: GoalGateDeps): Promise<GateOutcome[]> {
  const outcomes: GateOutcome[] = [];
  for (const item of items) {
    if (item.gate === undefined) continue;
    outcomes.push(await evaluateOne(item.gate, deps));
  }
  return outcomes;
}

/** 单门评测（fail-closed 分派） */
async function evaluateOne(spec: GateSpec, deps: GoalGateDeps): Promise<GateOutcome> {
  switch (spec.kind) {
    case 'command':
      return evaluateCommand(spec.command, deps);
    case 'files':
      return evaluateFiles(spec.paths, deps);
    case 'diagnostics':
      return evaluateDiagnostics(spec.files, deps);
  }
}

/** command 源：needsWrite 批准 + seam 在场 + exit 0 三条件全过才放行 */
async function evaluateCommand(command: string, deps: GoalGateDeps): Promise<GateOutcome> {
  if (!deps.commandGateAllowed) {
    return {
      ok: false,
      kind: 'command',
      detail: 'goal 未申报 needsWrite（或未获批准）——command 判据门不可用（防模型自造命令免审批自跑）',
    };
  }
  if (deps.exec === undefined) {
    // 缺席归因（四役勘正——03 §10.5）：组合根已真接线（ex 批），缺席唯一生产
    // 可达形 = exec 件禁用/缺席（enabled.yaml）——词面如实指该方向
    return {
      ok: false,
      kind: 'command',
      detail: 'exec 执行面缺席（exec 件未装载或被禁用——诚实缺席，fail-closed 不放行）',
    };
  }
  const result = await deps.exec.execCommand(command);
  if (result.timedOut) {
    return { ok: false, kind: 'command', detail: `命令超时（>${GATE_COMMAND_TIMEOUT_MS}ms）——判未过` };
  }
  if (result.exitCode !== 0) {
    const tail = result.stderrTail === '' ? '' : `（stderr 末行：${result.stderrTail}）`;
    return { ok: false, kind: 'command', detail: `退出码 ${result.exitCode} 非 0${tail}` };
  }
  return { ok: true, kind: 'command', detail: `exit 0（命令：${command}）` };
}

/** files 源：全部存在且非空；stat 前归一判工作区根内 */
function evaluateFiles(paths: readonly string[], deps: GoalGateDeps): GateOutcome {
  if (paths.length === 0) {
    return { ok: false, kind: 'files', detail: '空目标集——空门即非门（申报位已拦，评测位双拦）' };
  }
  const root = deps.workspaceRoot;
  const stat = deps.statFile ?? statFileDefault;
  for (const p of paths) {
    // 归一判根：resolve 锚工作区根（相对路径合法——判根后落根内）；越根即 fail
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
    if (abs !== root && !abs.startsWith(root + sep)) {
      return {
        ok: false,
        kind: 'files',
        detail: `路径「${p}」归一后在工作区根外（${abs}）——裸 stat 不是存在性 oracle`,
      };
    }
    const s = stat(abs);
    if (!s.exists) return { ok: false, kind: 'files', detail: `文件不存在：${p}` };
    if (s.size === 0) return { ok: false, kind: 'files', detail: `文件为空：${p}` };
  }
  return { ok: true, kind: 'files', detail: `${paths.length} 个文件全部存在且非空` };
}

/** diagnostics 源：目标文件集 LSP 诊断无 error 级 */
async function evaluateDiagnostics(files: readonly string[], deps: GoalGateDeps): Promise<GateOutcome> {
  if (files.length === 0) {
    return { ok: false, kind: 'diagnostics', detail: '空目标集——空门即非门（申报位已拦，评测位双拦）' };
  }
  if (deps.lsp === undefined) {
    // 同律缺席归因（四役勘正——03 §10.5）：lsp 件禁用/缺席即诚实缺席
    return {
      ok: false,
      kind: 'diagnostics',
      detail: 'lsp 诊断查询面缺席（lsp 件未装载或被禁用——诚实缺席，fail-closed 不放行）',
    };
  }
  const diags = await deps.lsp.queryDiagnostics([...files]);
  const errors = diags.filter((d) => d.level === 'error');
  if (errors.length > 0) {
    const first = errors[0]!;
    return {
      ok: false,
      kind: 'diagnostics',
      detail: `${errors.length} 条 error 级诊断（如 ${first.file}: ${first.message}）`,
    };
  }
  return { ok: true, kind: 'diagnostics', detail: `${files.length} 个目标文件无 error 级诊断` };
}

/** 文件源缺省真身（node:fs statSync——测试注 statFile 假件后不触盘） */
function statFileDefault(p: string): { exists: boolean; size: number } {
  try {
    const s = statSync(p);
    return { exists: true, size: Number(s.size) };
  } catch {
    return { exists: false, size: 0 };
  }
}
