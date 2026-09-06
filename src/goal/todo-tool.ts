/**
 * goal 段 todo 工具件（03 §10.5 段约束执法位 = todo 工具执行段）。
 *
 * 换装关系：goal active 期间组合根以本件**替换** conversation 的
 * `createTodoTool` 产物（同名 `todo` 工具——模型面无感换装）；durable
 * `todo/write` 事件同词承载扩展字段（conversation fold 读侧剥离未知字段，
 * 两向兼容）。
 *
 * GOAL_TODO_SCOPE 双向执法（执行段机器面）：
 *  - goal 段内（scope 在场）：deferred 必携 resume_when（词法可 parse 可
 *    判窗）、completed 必携后继二择一（follow_up 或 noFollowUp）——缺即拒；
 *  - 非 goal 段（scope 缺席）：申报任何扩展字段即拒（goal 段词汇不悬空）；
 *  - gate 声明申报位 fail-closed：command 未过 needsWrite 申报批准、
 *    diagnostics 缺 lsp 查询面——申报即拒（评测位 gates.ts 双拦）。
 */
import { Type } from 'typebox';
import { BaseError, type ToolDefinition } from '../contracts/index.js';
import { parseResumeWhen } from './fold.js';
import type { GoalTodoItem, WritableGoalTodoItem } from './types.js';

/** 扩展字段名集（非 goal 段申报即拒的判据面——与 schema 字段面同源人工互镜） */
const EXTENDED_FIELDS = ['resumeWhen', 'role', 'taskClass', 'followUp', 'noFollowUp', 'gate'] as const;

/** 工具装配依赖 */
export interface GoalTodoToolDeps {
  /** durable 写入面（装配层注入 session.append 闭包——与 conversation 件同位） */
  append: (data: { items: GoalTodoItem[] }) => void;
  /** 当前会话 goal 段判据（null = 非 goal 段——双向执法判据面） */
  getScope: () => { goalId: string; activatedSeq: number } | null;
  /** command 判据门可用性（goal needsWrite 申报+批准后 true） */
  commandGateAllowed: boolean;
  /** lsp 诊断查询面在场否（缺席 = diagnostics gate 申报即拒 fail-closed） */
  hasLsp: boolean;
  /** 词法判窗锚（缺省 Date.now——测试注固定钟） */
  nowMs?: () => number;
}

/** goal 段 todo 工具件（全量快照式提交——与 conversation 件同律，扩展语义段内执法） */
export function createGoalTodoTool(deps: GoalTodoToolDeps): ToolDefinition {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return {
    name: 'todo',
    description:
      '维护当前任务清单（全量快照式：每次调用提交完整清单覆盖旧表）。goal 段扩展语义：' +
      'deferred 项必携 resume_when（after@<ISO> 或 after@+<n>[mhd]）；completed 项必携后继二择一' +
      '（follow_up 或 no_follow_up: true）；可选 gate 声明判据门（command/files/diagnostics）。' +
      '清单跨对话轮与续跑轮持续存活（goal 生命周期段 fold——用户出手不重置）。',
    parameters: Type.Object(
      {
        items: Type.Array(
          Type.Object(
            {
              status: Type.Union(['pending', 'in-progress', 'completed', 'deferred'].map((s) => Type.Literal(s))),
              content: Type.String(),
              activeForm: Type.Optional(Type.String()),
              // —— goal 段扩展字段（段内缺必携即拒、段外申报即拒——GOAL_TODO_SCOPE）——
              resume_when: Type.Optional(Type.String()),
              role: Type.Optional(Type.Union([Type.Literal('agent'), Type.Literal('user')])),
              task_class: Type.Optional(Type.String()),
              follow_up: Type.Optional(Type.String()),
              no_follow_up: Type.Optional(Type.Boolean()),
              gate: Type.Optional(
                Type.Union([
                  Type.Object({ kind: Type.Literal('command'), command: Type.String() }),
                  Type.Object({ kind: Type.Literal('files'), paths: Type.Array(Type.String()) }),
                  Type.Object({ kind: Type.Literal('diagnostics'), files: Type.Array(Type.String()) }),
                ]),
              ),
            },
            // 扩展字段全列 schema（与 conversation 件的 additionalProperties:false
            // 第一道闸分立——本件即 goal 段第二道闸，段约束执法在执行段）
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    effect: 'read',
    execute: async (args) => {
      const raw = (args as { items?: unknown }).items;
      if (!Array.isArray(raw)) throw new BaseError('GOAL_TODO_SCOPE', 'items 须为数组');
      const scope = deps.getScope();
      const anchor = nowMs();
      const items: GoalTodoItem[] = raw.map((entry) => normalizeItem(entry));
      // 双向执法逐条过堂（先逐条校验再统一落账——半批不入 durable）
      for (const item of items) enforceScope(item, scope, deps, anchor);
      deps.append({ items: items.map((item) => ({ ...item })) });
      return { content: [{ type: 'text', text: receipt(items, scope) }] };
    },
  };
}

/** 载荷条目收窄（schema 已校验——此处产 GoalTodoItem 干净形：undefined 腿剔除） */
function normalizeItem(entry: unknown): GoalTodoItem {
  if (typeof entry !== 'object' || entry === null) {
    throw new BaseError('GOAL_TODO_SCOPE', '条目须为对象');
  }
  const c = entry as Record<string, unknown>;
  // 可写局部（WritableGoalTodoItem——readonly 契约形由返回承载）
  const item: WritableGoalTodoItem = { status: c.status as GoalTodoItem['status'], content: c.content as string };
  if (typeof c.activeForm === 'string') item.activeForm = c.activeForm;
  if (typeof c.resume_when === 'string') item.resumeWhen = c.resume_when;
  if (c.role === 'agent' || c.role === 'user') item.role = c.role;
  if (typeof c.task_class === 'string') item.taskClass = c.task_class;
  if (typeof c.follow_up === 'string') item.followUp = c.follow_up;
  if (c.no_follow_up === true) item.noFollowUp = true;
  if (isRawGate(c.gate)) {
    item.gate =
      c.gate.kind === 'command'
        ? { kind: 'command', command: c.gate.command }
        : c.gate.kind === 'files'
          ? { kind: 'files', paths: [...c.gate.paths] }
          : { kind: 'diagnostics', files: [...c.gate.files] };
  }
  return item;
}

/** gate 声明形判（窄收窄——schema 已挡大半，防御读侧漂移） */
function isRawGate(
  value: unknown,
): value is
  { kind: 'command'; command: string } | { kind: 'files'; paths: string[] } | { kind: 'diagnostics'; files: string[] } {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  if (g.kind === 'command' && typeof g.command === 'string') return true;
  if (g.kind === 'files' && Array.isArray(g.paths) && g.paths.every((p) => typeof p === 'string')) return true;
  if (g.kind === 'diagnostics' && Array.isArray(g.files) && g.files.every((f) => typeof f === 'string')) return true;
  return false;
}

/** 段约束执法（执行段机器面——坏输入一律 BaseError 响亮拒，半批不落账） */
function enforceScope(
  item: GoalTodoItem,
  scope: { goalId: string; activatedSeq: number } | null,
  deps: GoalTodoToolDeps,
  anchorMs: number,
): void {
  const extended = EXTENDED_FIELDS.filter((field) => item[field] !== undefined);
  if (scope === null) {
    if (extended.length > 0) {
      throw new BaseError(
        'GOAL_TODO_SCOPE',
        `当前不在 goal 段（无 active goal）——扩展字段不悬空：条目「${item.content}」携带 ${extended.join('/')}`,
      );
    }
    return;
  }
  // goal 段内：deferred/completed 的必携纪律
  if (item.status === 'deferred' && item.resumeWhen === undefined) {
    throw new BaseError(
      'GOAL_TODO_SCOPE',
      `deferred 条目「${item.content}」必携 resume_when（after@<ISO> 或 after@+<n>[mhd]）`,
    );
  }
  if (item.resumeWhen !== undefined) {
    const parsed = parseResumeWhen(item.resumeWhen, anchorMs);
    if (!parsed.ok)
      throw new BaseError('GOAL_TODO_SCOPE', `条目「${item.content}」resume_when 词法坏形：${parsed.error}`);
  }
  if (item.status === 'completed' && item.followUp === undefined && item.noFollowUp !== true) {
    throw new BaseError(
      'GOAL_TODO_SCOPE',
      `completed 条目「${item.content}」必携后继二择一（follow_up 或 no_follow_up: true）——防完成即失联`,
    );
  }
  // gate 声明申报位 fail-closed（评测位 gates.ts 双拦）
  if (item.gate !== undefined) {
    if (item.gate.kind === 'command') {
      if (!deps.commandGateAllowed) {
        throw new BaseError(
          'GOAL_TODO_SCOPE',
          `条目「${item.content}」command 判据门不可申报——goal 未申报 needsWrite（防模型自造命令免审批自跑）`,
        );
      }
      if (item.gate.command.trim().length === 0) {
        throw new BaseError('GOAL_TODO_SCOPE', `条目「${item.content}」command 判据门命令为空——空门即非门`);
      }
    }
    if (item.gate.kind === 'diagnostics') {
      if (!deps.hasLsp) {
        throw new BaseError(
          'GOAL_TODO_SCOPE',
          `条目「${item.content}」diagnostics 判据门不可申报——lsp 诊断查询面缺席（fail-closed 非静默跳过）`,
        );
      }
      if (item.gate.files.length === 0) {
        throw new BaseError('GOAL_TODO_SCOPE', `条目「${item.content}」diagnostics 判据门目标集为空——空门即非门`);
      }
    }
    if (item.gate.kind === 'files' && item.gate.paths.length === 0) {
      throw new BaseError('GOAL_TODO_SCOPE', `条目「${item.content}」files 判据门目标集为空——空门即非门`);
    }
  }
}

/** 回执文本（计数总览 + 段标记——模型可编程依赖的稳定词面） */
function receipt(items: GoalTodoItem[], scope: { goalId: string } | null): string {
  const counts = { pending: 0, 'in-progress': 0, completed: 0, deferred: 0 };
  for (const item of items) counts[item.status] += 1;
  const head =
    `已更新任务清单：${items.length} 项` +
    `（进行中 ${counts['in-progress']} · 待办 ${counts.pending} · ` +
    `已完成 ${counts.completed} · 缓办 ${counts.deferred}）`;
  const gated = items.filter((item) => item.gate !== undefined).length;
  const tail = scope === null ? '' : `〔goal ${scope.goalId} 段·判据门 ${gated} 项〕`;
  return tail === '' ? head : `${head}${tail}`;
}
