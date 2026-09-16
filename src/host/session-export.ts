/**
 * host/session-export —— 会话导出 markdown 拼装单源（07 §4.1 命令面增补批
 * C2；07 §5 sessions 行 CLI 对等位——05 §3.4 点名 CLI 导出为 queryEvents
 * 宿主面消费者）。
 *
 * 两消费面同一函数：TUI `/export` 通道命令（assembly 宿主级直注册）与 CLI
 * `berry sessions export <id>`——拼装/落盘/回执文本三面同源，消费腿
 * {@link runSessionExportCommand} 只差装配位注入的 seam（数据目录/行面
 * 读/事件源/焦点位）。
 *
 * 数据源 = durable 事件日志投影（与 /history 同源族——deriveMessages 纯
 * 函数 fold，纯文本拼装零 TUI 渲染依赖）：轮次（user 消息开节、assistant/
 * toolResult 归节）+ thinking 折叠行 + 工具卡简行；**空会话 = 仅文档头骨架
 * 照落盘**（不拒——空壳导出亦是真答复）。
 *
 * 落盘律（07 §4.1 逐件语义 7）：`数据目录/exports/<会话id>-<时间戳>.md`
 * （时间戳 ISO 压形——冒号/点替换连字符，文件名安全）；回执 = 路径一行
 * （/memory-export 同形）。会话 id 恒为宿主铸 id（uuid v7 形——CLI/TUI 两
 * 腯均先判在场才落盘，用户串不可达文件名位）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionEvent } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import type { ContentBlock } from '../session/index.js';
import { deriveMessages } from '../session/index.js';

/** /export 用法（assembly 通道命令注册 description 位——PLUGINS_CMD_USAGE 同族） */
export const SESSION_EXPORT_USAGE =
  '用法：/export [会话id] —— 会话导出为 markdown（无参 = 焦点会话；落盘 数据目录/exports/<会话id>-<时间戳>.md）';

/** 文档头行面元数据（窄面结构形——两消费面从 SessionRow 投影；零事件新会话无行 = 全缺席） */
export interface SessionExportMeta {
  readonly sessionId: string;
  /** 行面标题（缺席不落行） */
  readonly title?: string | undefined;
  /** 行面工作区根（缺席不落行） */
  readonly workspaceRoot?: string | undefined;
  /** 行面创建时刻（ms epoch；缺席不落行） */
  readonly createdAt?: number | undefined;
}

/** 导出输入（事件真源 + 行面元数据 + 导出时刻） */
export interface SessionExportInput {
  readonly events: readonly SessionEvent[];
  readonly meta: SessionExportMeta;
  /** 导出时刻（ms epoch——文档头「导出时间」与落盘文件名时间戳双消费；注入位 = 测试确定性） */
  readonly now: number;
}

/** 命令腿结果（ok=false 携人读失败文本——命令面是用户面不是异常面，/memory-export 同律） */
export interface SessionExportOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/**
 * markdown 拼装（纯函数——CLI/TUI 两消费面单源；测试直锁格式）。
 * 空事件 = 仅文档头骨架 + 尾换行（空壳导出亦是真答复）。
 */
export function renderSessionMarkdown(input: SessionExportInput): string {
  const lines: string[] = [];
  // —— 文档头骨架（行面元数据缺席不造行——零事件新会话同形）
  lines.push(`# 会话导出 \`${input.meta.sessionId}\``);
  if (input.meta.title !== undefined && input.meta.title !== '') lines.push(`- 标题：${input.meta.title}`);
  if (input.meta.workspaceRoot !== undefined) lines.push(`- 工作区：${input.meta.workspaceRoot}`);
  if (input.meta.createdAt !== undefined) lines.push(`- 创建时间：${isoOf(input.meta.createdAt)}`);
  lines.push(`- 导出时间：${isoOf(input.now)}`);
  lines.push(`- 事件数：${input.events.length}`);

  const messages = deriveMessages(input.events);
  if (messages.length === 0) return `${lines.join('\n')}\n`; // 空会话——仅文档头照落盘
  lines.push('', '---', '');

  // —— 轮次分节：user 消息开新节；首条 user 前的先导消息（fork 种子缺失形/
  // 注入序）归「开头段」不编号（轮次语义 = 用户起问）
  let turn = 0;
  let sectionOpen = false;
  const openSection = (title: string): void => {
    if (sectionOpen) lines.push('');
    lines.push(`## ${title}`, '');
    sectionOpen = true;
  };
  for (const message of messages) {
    if (message.type === 'user') {
      turn += 1;
      openSection(`轮次 ${turn}`);
      // 注入归因注记（source 非 user 形——schedule/channel 等来源可辨）
      const sourceNote =
        message.source !== undefined && message.source !== '' && message.source !== 'user'
          ? `（source：${message.source}）`
          : '';
      lines.push(`**用户**${sourceNote}`, '', textOf(message.content), '');
      continue;
    }
    if (message.type === 'assistant') {
      if (!sectionOpen) openSection('开头段（先导用户消息前）');
      lines.push('**助手**', '');
      // 内容块按序：thinking 折叠行 / text 正文段
      for (const block of message.content) {
        if (block.type === 'thinking') {
          lines.push(foldNote('thinking', block.thinking), '');
        } else if (block.type === 'text') {
          lines.push(block.text, '');
        } else {
          lines.push('（图像块——不落导出正文）', '');
        }
      }
      // 错误终态轮（stopReason=error 的失败说明——投影透传位）
      if (message.errorMessage !== undefined && message.errorMessage !== '') {
        lines.push(foldNote('错误', message.errorMessage), '');
      }
      // 工具卡简行（同一响应内发起的调用——参数折叠呈现）
      for (const call of message.toolCalls) {
        lines.push(`- ▸ 工具 \`${call.toolName}\`：${foldLine(call.arguments, 160)}`);
      }
      if (message.toolCalls.length > 0) lines.push('');
      continue;
    }
    // toolResult：简行（工具名来自配对补齐；错误结果带标记）
    if (!sectionOpen) openSection('开头段（先导用户消息前）');
    const mark = message.isError ? '（错误）' : '';
    lines.push(`- ◂ \`${message.toolName}\` 结果${mark}：${foldLine(textOf(message.output), 160)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 落盘腿：`数据目录/exports/<会话id>-<时间戳>.md`（目录递归建；覆写同刻
 * 同名文件——时间戳含毫秒，实战不可撞）。返回落盘路径（回执/CLI 输出共用）。
 */
export function writeSessionExport(dataDir: string, input: SessionExportInput): string {
  const dir = join(dataDir, 'exports');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${input.meta.sessionId}-${fileStampOf(input.now)}.md`);
  writeFileSync(path, renderSessionMarkdown(input), 'utf8');
  return path;
}

/* ---------------- 命令腿（TUI /export 与 CLI sessions export 单源） ---------------- */

/** 行面读窄面（SessionRow 结构子集——装配位从各自真源投影） */
export interface SessionExportRowLike {
  readonly title?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly createdAt?: number | undefined;
}

/** /export 命令腿依赖（assembly / sessions-cmd 两装配位注入——seam 与 /plugins 命令同形） */
export interface SessionExportCommandDeps {
  /** 数据目录（null = 纯 memory 形无落盘位——诚实拒） */
  readonly dataDir: string | null;
  /** 行面元数据读（缺席 = 零事件新会话——文档头元数据行缺席照导出） */
  readonly rowOf: (sessionId: string) => SessionExportRowLike | undefined;
  /**
   * 事件真源取值器（双事实源序归装配位单源：驱动活体优先〔write-behind
   * 未 flush 事件也在场〕、库行回退 loadSession；undefined = 会话不在场）
   */
  readonly eventsOf: (sessionId: string) => readonly SessionEvent[] | undefined;
  /** 焦点会话现取（无参形真源——TUI 装配位注入；CLI 恒 null） */
  readonly focusedId: () => string | null;
  /** 时钟（缺省 Date.now——测试确定性注入位） */
  readonly now?: () => number;
}

/**
 * /export 命令腿（argv + 命令锚会话 → 回执文本；TUI / CLI 两消费单源）。
 * 会话解析序：显式 id 参 > 命令锚会话（args.sessionId——ix-2 dispatch 锚 =
 * 聚焦会话 ?? 启动会话）> focusedId 现取；三源皆空 = 无参形无焦点诚实拒。
 * 会话不在场 = SESSION_NOT_FOUND fail-loud 回执（既有错误码族——BaseError
 * 折文本同 /memory-export 律）。
 */
export async function runSessionExportCommand(
  argv: readonly string[],
  anchorSessionId: string | undefined,
  deps: SessionExportCommandDeps,
): Promise<SessionExportOutcome> {
  if (argv.length > 1) {
    return { ok: false, text: `参数过多（${argv.length} 个——至多一个会话 id）。\n${SESSION_EXPORT_USAGE}` };
  }
  const sessionId = argv[0] ?? anchorSessionId ?? deps.focusedId();
  if (sessionId === undefined || sessionId === null) {
    return {
      ok: false,
      text: `无焦点会话可导出（无参形 = 焦点会话——当前焦点空悬且无命令锚会话）。\n${SESSION_EXPORT_USAGE}`,
    };
  }
  const events = deps.eventsOf(sessionId);
  if (events === undefined) {
    // fail-loud 回执（既有错误码族——BaseError 码与人读原因直呈）
    const err = new BaseError(
      'SESSION_NOT_FOUND',
      `会话不存在（${sessionId}）——用 /sessions 查在册 id；零事件新会话首条消息后才落库行`,
    );
    return { ok: false, text: `${err.code}：${err.message}` };
  }
  if (deps.dataDir === null) {
    return { ok: false, text: '数据目录缺席（纯 memory 形）——导出需要落盘位，此形不可用' };
  }
  const row = deps.rowOf(sessionId);
  const path = writeSessionExport(deps.dataDir, {
    events,
    meta: {
      sessionId,
      ...(row?.title !== undefined && row.title !== '' ? { title: row.title } : {}),
      ...(row?.workspaceRoot !== undefined ? { workspaceRoot: row.workspaceRoot } : {}),
      ...(row?.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
    },
    now: deps.now?.() ?? Date.now(),
  });
  return { ok: true, text: `已导出 ${events.length} 事件 → ${path}` };
}

/* ---------------- 私用工具 ---------------- */

/** ISO 时间形态（ms epoch → 确定性串——测试可断言） */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** 落盘文件名时间戳（ISO 压形——冒号/点替换连字符，文件名安全） */
function fileStampOf(ms: number): string {
  return isoOf(ms).replace(/[:.]/g, '-');
}

/** 折叠行（空白折单行 + 帽 N 字符截断——thinking/错误说明/工具参数与结果简行共用） */
function foldLine(text: string, cap: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
}

/** 折叠注记行（`> [标记] 折叠文本` + 截断时长度注记——内容帽外全隐藏的诚实呈现） */
function foldNote(mark: string, text: string): string {
  const folded = foldLine(text, 120);
  return text.length > 120 ? `> [${mark}] ${folded}（共 ${text.length} 字）` : `> [${mark}] ${folded}`;
}

/** 内容块数组 → 正文文本（text 块逐段落、thinking/图像不入正文——导出正文 = 可读对话面） */
function textOf(content: string | readonly ContentBlock[]): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n\n');
}
