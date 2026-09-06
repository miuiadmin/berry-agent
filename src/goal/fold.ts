/**
 * goal 段计划态 fold（03 §10.5 计划态跨轮条）——goal 件的倒扫投影机。
 *
 * 语义（与 conversation `foldTodoTable` 的 goal 模式词面独立、行为互证——
 * 兼容性测试在 goal.test.ts）：
 *  - fold 边界从「用户输入段」升格「goal 生命周期段」：倒扫取激活锚
 *    （activatedSeq）**之后**的最后一条 `todo/write`；
 *  - 续跑轮 user/message **不再重置表**（计划状态结构性跨轮存活）；
 *  - 遮蔽区间两向同律（05 §1.1）：occluded 的 todo/write 不成表；
 *  - 载荷收窄保守降级（durable 受信但形演进不得崩读侧——坏条目丢弃）。
 */
import type { SessionEvent } from '../contracts/index.js';
import { occludedSeqs } from '../session/index.js';
import type { GoalTodoItem, WritableGoalTodoItem } from './types.js';

/** status 四值词表（与 conversation TodoItemData 同词表——结构兼容面） */
const TODO_STATUSES = ['pending', 'in-progress', 'completed', 'deferred'] as const;

/**
 * fold goal 段当前任务清单：倒扫 events（seq ≥ activatedSeq 的区间）——
 * 先遇 `todo/write` → 其 items 即当前表（last-write-wins）；user/message
 * 不停扫（跨轮存活）；扫出边界 → 空表（goal 段从未建表）。
 */
export function foldGoalTodos(events: readonly SessionEvent[], activatedSeq: number): GoalTodoItem[] {
  const occluded = occludedSeqs(events);
  for (let seq = events.length - 1; seq >= 0; seq -= 1) {
    if (seq < activatedSeq) return []; // 越激活锚即出 goal 段——锚前历史不成表
    if (occluded.has(seq)) continue;
    const event = events[seq]!;
    if (event.type === 'todo/write') return validateGoalTodoItems((event.data as { items?: unknown }).items);
    // user/message 不重置（goal 生命周期段语义）；assistant/工具事件同不停扫
  }
  return [];
}

/**
 * open 项集（完成否决律判据面）：open = 一切非 completed 状态项——
 * deferred 含内无论窗到否（判窗是续跑提示的提示词义务，非机器放行面）。
 */
export function openGoalItems(items: readonly GoalTodoItem[]): GoalTodoItem[] {
  return items.filter((item) => item.status !== 'completed');
}

/**
 * fold 投影指纹（停滞判据面，04 §12 停滞硬停条）：计数分桶 + 逐条内容
 * 散列——条目状态翻转或内容改写即变（planning-with-files ③ 单调进度护卫
 * 的最小形：不做单调性断言，只做变更检测——单调性挂真实使用回访）。
 */
export function progressFingerprint(items: readonly GoalTodoItem[]): string {
  const counts = { pending: 0, 'in-progress': 0, completed: 0, deferred: 0 };
  const parts: string[] = [];
  for (const item of items) {
    counts[item.status] += 1;
    // status+content+扩展语义字段全入指纹——resume_when 改窗也是进展
    parts.push(
      `${item.status}|${item.content}|${item.resumeWhen ?? ''}|${item.role ?? ''}|` +
        `${item.taskClass ?? ''}|${item.followUp ?? ''}|${item.noFollowUp === true ? 1 : 0}|` +
        `${item.gate ? JSON.stringify(item.gate) : ''}`,
    );
  }
  return `p${counts.pending},i${counts['in-progress']},c${counts.completed},d${counts.deferred};${parts.join(';')}`;
}

/**
 * resume_when 词法解析（03 §10.5 deferred 必携条）：`after@<ISO>` 绝对形
 * 或 `after@+<n>[mhd]` 相对形（判窗锚 = 条目写入时刻——由调用方供锚）。
 * 返回 null = 坏形（写侧 GOAL_TODO_SCOPE 拒、读侧不判窗机器面零消费）。
 */
export function parseResumeWhen(
  spec: string,
  anchorMs: number,
): { ok: true; dueAtMs: number } | { ok: false; error: string } {
  if (!spec.startsWith('after@')) return { ok: false, error: `resume_when 须以 after@ 起头（得「${spec}」）` };
  const body = spec.slice('after@'.length);
  // 绝对 ISO 形
  if (!body.startsWith('+')) {
    const ms = Date.parse(body);
    if (Number.isNaN(ms)) return { ok: false, error: `after@ 后非合法 ISO 时间串（得「${body}」）` };
    return { ok: true, dueAtMs: ms };
  }
  // 相对形：+<n>[mhd]
  const m = /^\+(\d{1,8})([mhd])$/.exec(body);
  if (!m) return { ok: false, error: `相对形须为 +<正整数>[mhd]（得「${body}」）` };
  const n = Number(m[1]!);
  const unitMs = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
  return { ok: true, dueAtMs: anchorMs + n * unitMs };
}

/**
 * 未知载荷 → goal 段条目列表（fold 读侧收窄面）：status 出词表/content
 * 非串 → 整条丢弃；扩展字段仅收对应型别（型别不符剔除该字段不弃整条——
 * 核心四字段健康即保留，扩展面保守降级）。
 */
export function validateGoalTodoItems(value: unknown): GoalTodoItem[] {
  if (!Array.isArray(value)) return [];
  const items: GoalTodoItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (
      typeof c.status !== 'string' ||
      !(TODO_STATUSES as readonly string[]).includes(c.status) ||
      typeof c.content !== 'string'
    ) {
      continue;
    }
    // 可写局部（WritableGoalTodoItem——readonly 契约形由收窄返回承载）
    const item: WritableGoalTodoItem = { status: c.status as GoalTodoItem['status'], content: c.content };
    if (typeof c.activeForm === 'string') item.activeForm = c.activeForm;
    if (typeof c.resumeWhen === 'string') item.resumeWhen = c.resumeWhen;
    if (c.role === 'agent' || c.role === 'user') item.role = c.role;
    if (typeof c.taskClass === 'string') item.taskClass = c.taskClass;
    if (typeof c.followUp === 'string') item.followUp = c.followUp;
    if (c.noFollowUp === true) item.noFollowUp = true;
    if (isGateSpec(c.gate)) item.gate = c.gate;
    items.push(item);
  }
  return items;
}

/** gate 声明收窄（三源判据门形——{kind, spec} 平铺形） */
function isGateSpec(value: unknown): value is GoalTodoItem['gate'] {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  if (g.kind === 'command' && typeof g.command === 'string') return true;
  if (g.kind === 'files' && Array.isArray(g.paths) && g.paths.every((p) => typeof p === 'string')) return true;
  if (g.kind === 'diagnostics' && Array.isArray(g.files) && g.files.every((f) => typeof f === 'string')) return true;
  return false;
}
