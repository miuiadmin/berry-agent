/**
 * todo 机器（04 §8 todo 工具件 / 05 §1.1 todo/write 词行）——跨轮任务清单的
 * durable 事实 + fold 推导 + 模型回看注入 + 工具件四件套。
 *
 * 语义单源 = 05 §1.1 词行：
 *  - durable 词 `todo/write`（类别 surface，items 全量快照、last-write-wins）；
 *  - **fold = 日志倒扫「最后一条可见 user/message 之后的最后一条本事件」**
 *    （run 重置语义由推导规则承载、无显式 reset 词；遮蔽区间内的事件不参与
 *    fold——occluded 的 user/message 不重置、occluded 的 todo/write 不成表，
 *    两向同律：对模型不可见即从未发生）；
 *  - 跨 turn 每轮注入当前全表（CC 式回看），走 context_transform 瀑布最后
 *    关口的瞬态层——角色 `conversation/todo`（hidden 瞬态，不进 timeline 不落
 *    durable，llmContext 每请求新建故零累积）；冷启动 resume 首请求同样覆盖
 *    （fold 在请求时点对 durable 日志重放）；
 *  - 工具形态 = 全量快照式提交（模型每次提交完整清单覆盖旧表）+ 一行计数
 *    回执。
 *
 * 呈现投影（channels TodoItem 四态记号面板）与 durable 形有意分立：conversation
 * 不得 import channels（DAG 边表），字段形状以注释互镜；status 四值两处同词表。
 */
import { Type } from 'typebox';
import type { SessionEvent, ToolDefinition, UserMessage } from '../contracts/index.js';
import {
  getMessageRoleDefinition,
  registerMessageRole,
  type CustomMessage,
  type MessageRoleDefinition,
} from '../contracts/index.js';
import { occludedSeqs } from '../session/index.js';

/**
 * durable 清单条目形（todo/write 的 items 元素）。
 *
 * 与 channels TodoItem（呈现投影）字段互镜：status 四值同词表
 * （pending/in-progress/completed/deferred），activeForm 进行文案（进行中态
 * 优先于 content 呈现——CC 式语义，两处同律）。载荷形状 owner 自管（05 §1.1
 * 核心表不钉 data 形），本件即 owner、fold 读侧与工具写侧同源消费本形。
 */
export interface TodoItemData {
  readonly status: 'pending' | 'in-progress' | 'completed' | 'deferred';
  readonly content: string;
  readonly activeForm?: string;
}

/** todo 回看注入角色名（域名前缀两段式——conversation 域） */
export const TODO_ROLE = 'conversation/todo';

/** status 四值词表（schema 与 fold 校验共用单源） */
const TODO_STATUSES = ['pending', 'in-progress', 'completed', 'deferred'] as const;

/**
 * 角色定义（模块级单例——身份同一性判据）：toLlm 全表渲染为一条 UserMessage
 * 尾注（清空表返回 null 剥离）；render hidden（瞬态注入，呈现面不可见——
 * UI 投影走 durable todo/write 事件，不经此角色）。
 */
const TODO_ROLE_DEFINITION: MessageRoleDefinition = {
  toLlm: (message: CustomMessage) => {
    const items = validateTodoItems(message.content);
    if (items.length === 0) return null;
    return {
      role: 'user',
      content: renderTodoTable(items),
      timestamp: message.timestamp,
    };
  },
  render: { intent: 'hidden', label: '任务清单' },
};

/**
 * 注册 todo 角色（幂等 + 身份守卫）：进程级注册表 + per-session 驱动 ⇒ 多次
 * 调用常态。在册定义恰为本模块单例 → 幂等通过；在册定义另有其身 → 域名
 * 被窃据，fail-loud（不静默借用他者转写——消息转写分叉比崩溃更难查）。
 */
export function ensureTodoRole(): void {
  const existing = getMessageRoleDefinition(TODO_ROLE);
  if (existing !== undefined) {
    if (existing !== TODO_ROLE_DEFINITION) {
      throw new Error(`消息角色 ${TODO_ROLE} 已被其他定义占用（conversation 域名窃据——todo 回看注入拒绝分叉转写）`);
    }
    return;
  }
  registerMessageRole(TODO_ROLE, TODO_ROLE_DEFINITION);
}

/**
 * fold 当前任务清单（05 §1.1 倒扫规则，遮蔽感知）：
 * 从日志尾向头扫**可见**事件——
 *  - 先遇 `todo/write` → 其 items 即当前表（last-write-wins）；
 *  - 先遇可见 `user/message` → 空表（用户出手即重置——重置语义由推导承载）；
 *  - 扫到头 → 空表（从未建表）。
 * assistant 消息与工具事件不参与判据（清单跨 assistant 轮持续——CC 语义）。
 *
 * goal 段升格（03 §10.5 计划态跨轮条）：scope 在场（goal active——组合根
 * `goalScopeFor(sessionId)` 闭包注入）时 fold 边界从「用户输入段」升格
 * 「goal 生命周期段」——倒扫只取激活锚 `activatedSeq` 之后的最后一条
 * `todo/write`，**续跑轮 user/message 不再重置表**（计划状态结构性跨轮
 * 存活）；goal 段载荷扩展字段（resumeWhen/role/taskClass/followUp/gate 等）
 * 由 validateTodoItems 剥离（本 fold 只投影核心四字段——扩展语义归 goal 件
 * fold 读侧，词面独立零 import）。
 */
export function foldTodoTable(events: readonly SessionEvent[], scope?: TodoGoalScope): TodoItemData[] {
  const occluded = occludedSeqs(events);
  for (let seq = events.length - 1; seq >= 0; seq -= 1) {
    if (occluded.has(seq)) continue;
    const event = events[seq]!;
    // goal 段边界：越激活锚即出段（锚前历史不成表——goal 生命周期段语义；
    // 下标即 seq——「seq = 写入时 log.length」不变式下单源）
    if (scope !== undefined && seq < scope.activatedSeq) return [];
    if (event.type === 'todo/write') return validateTodoItems((event.data as { items?: unknown }).items);
    // goal 段内 user/message 不重置（跨轮存活）；无 scope 保持 run-scoped 重置
    if (scope === undefined && event.type === 'user/message') return [];
  }
  return [];
}

/**
 * goal 段窄面（词面独立于 goal 件 GoalScope——组合根闭包注入，结构兼容即
 * 编译期验；缺省 undefined = fold 退化 run-scoped 现行为）。
 */
export interface TodoGoalScope {
  readonly goalId: string;
  readonly activatedSeq: number;
}

/** 四态中文计数（回执与渲染表头共用词面） */
function countByStatus(items: readonly TodoItemData[]): Record<(typeof TODO_STATUSES)[number], number> {
  const counts = { pending: 0, 'in-progress': 0, completed: 0, deferred: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/**
 * 渲染清单为模型可见文本（快照注入体 + 工具回执共用单源）：
 * 表头一行计数总览 + 每条目一行（status 标签稳定英文词——模型可编程依赖；
 * 进行中态 activeForm 优先于 content 呈现，与呈现投影同律）。
 */
export function renderTodoTable(items: readonly TodoItemData[]): string {
  if (items.length === 0) return '';
  const counts = countByStatus(items);
  const header =
    `当前任务清单（共 ${items.length} 项：` +
    `进行中 ${counts['in-progress']} · 待办 ${counts.pending} · ` +
    `已完成 ${counts.completed} · 缓办 ${counts.deferred}）：`;
  const lines = items.map((item, index) => {
    const body = item.status === 'in-progress' && item.activeForm !== undefined ? item.activeForm : item.content;
    return `${index + 1}. [${item.status}] ${body}`;
  });
  return [header, ...lines].join('\n');
}

/**
 * 构建跨 turn 注入快照消息：空表返回 null（不注入——从未建表/已重置语义下
 * 不打扰上下文）；非空走角色的 toLlm 转写（ensureTodoRole 自足——快照构建
 * 不依赖驱动侧先行注册）。timestamp 取请求时点（注入体的时间面）。
 * scope 在场 = goal 段 fold（升格语义见 foldTodoTable 头注）。
 */
export function todoSnapshotMessage(
  events: readonly SessionEvent[],
  timestamp: number,
  scope?: TodoGoalScope,
): UserMessage | null {
  const items = foldTodoTable(events, scope);
  if (items.length === 0) return null;
  ensureTodoRole();
  const converted = TODO_ROLE_DEFINITION.toLlm?.({ role: TODO_ROLE, content: items, timestamp });
  // 定义体在本模块单源——非空表必产单条 user；运行时窄化防御仅挡未来改动
  if (converted === undefined || converted === null || Array.isArray(converted) || converted.role !== 'user') {
    return null;
  }
  return converted;
}

/**
 * todo 工具件（04 §8）：全量快照式提交——每次调用提交完整清单覆盖旧表
 * （增删改全走同一路径，无局部更新动词面）。effect 'read'：写的是 surface
 * 状态（todo/write 词）非文件系统，不触发审批对与守门拦截面。
 *
 * append 回调 = durable 写入面（装配层注入 session.append 闭包——本件不
 * 直接依赖 SessionLog，纯函数件可独立测试）。
 */
export function createTodoTool(append: (data: { items: TodoItemData[] }) => void): ToolDefinition {
  return {
    name: 'todo',
    description:
      '维护当前任务清单（全量快照式：每次调用提交完整清单覆盖旧表，含增删改与' +
      '清空）。清单跨对话轮持续可见（每轮自动回看注入），用户出手后重置为空。' +
      '适合多步骤任务的进度自查——一次只专注一件事，进行中的条目置 in-progress。',
    parameters: Type.Object(
      {
        items: Type.Array(
          Type.Object(
            {
              status: Type.Union(TODO_STATUSES.map((status) => Type.Literal(status))),
              content: Type.String(),
              activeForm: Type.Optional(Type.String()),
            },
            // 条目面收紧：多余字段整体拒收（goal 段扩展字段不在此消化——
            // GOAL_TODO_SCOPE 执法归 goal 件批，本件 schema 即第一道闸）
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    effect: 'read',
    execute: async (args) => {
      // 管道已按 schema 校验过参数；validate 再产新拷贝（append 快照拷贝前的
      // 干净形——不带 undefined 可选腿）并防御读侧漂移
      const items = validateTodoItems((args as { items?: unknown }).items);
      append({ items: items.map((item) => ({ ...item })) });
      const counts = countByStatus(items);
      const receipt =
        `已更新任务清单：${items.length} 项` +
        `（进行中 ${counts['in-progress']} · 待办 ${counts.pending} · ` +
        `已完成 ${counts.completed} · 缓办 ${counts.deferred}）`;
      return { content: [{ type: 'text', text: receipt }] };
    },
  };
}

/**
 * 未知载荷 → 条目形列表（fold 读侧与工具写侧共用的收窄面）：非对象元素 /
 * status 出词表 / content 非串 → 整条丢弃（保守降级不 fail-loud——durable
 * 日志受信但 owner 形演进不得崩读侧）；activeForm 仅收 string 型缺席剔除。
 */
function validateTodoItems(value: unknown): TodoItemData[] {
  if (!Array.isArray(value)) return [];
  const items: TodoItemData[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { status?: unknown; content?: unknown; activeForm?: unknown };
    if (
      typeof candidate.status !== 'string' ||
      !(TODO_STATUSES as readonly string[]).includes(candidate.status) ||
      typeof candidate.content !== 'string'
    ) {
      continue;
    }
    items.push(
      typeof candidate.activeForm === 'string'
        ? {
            status: candidate.status as TodoItemData['status'],
            content: candidate.content,
            activeForm: candidate.activeForm,
          }
        : { status: candidate.status as TodoItemData['status'], content: candidate.content },
    );
  }
  return items;
}
