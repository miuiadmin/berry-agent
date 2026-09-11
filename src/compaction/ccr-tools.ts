/**
 * compaction — CCR 检索工具件（05 §2.1「压缩可逆性 CCR」子节件 3——恒挂载
 * 宿主直构件，owner 缺省盖章 'core:host'〔open-tools 注册位〕）。
 *
 * 形态要点（规范单源 05 §2.1）：
 *  - **恒挂载**：会话装配期与 obs/control 族同位并入（host/conversation-stack
 *    extraTools），从 turn 1 在场永不摘除——恒稳定工具面，零翻转即零 provider
 *    前缀缓存击穿；工具面缺席形态（memory 形/整形窄面）随工具整面缺席；
 *  - 参数 `{ hash?, fromMessage? }`：hash 缺省 → 归档目录；在场 → 区间原文
 *    渲染（投影重建形）；
 *  - **分段续取律**（冷读闸 M1）：渲染自 fromMessage 起至少一条，逐条累加至
 *    渲染预算 56KiB 即止；尾部账「已渲染 X/N」+ 续取提示——大区间逐窗取尽，
 *    无静默不可达尾；
 *  - **miss 不抛错留原因**（三态：哈希不在归档集/会话无归档/区间不可读）；
 *  - **归属结构性免疫**：只扫本会话日志 surface 事件——伪标记（用户粘贴的
 *    他源同形文本）必 miss 且零副作用；返回内容 = 本会话模型曾可见的历史
 *    原文，非新信息面。只读无审批、零审计词（obs 族树内只读同判）。
 *
 * 重建路径：surface 事件信封区间 [start, end] 事件切片 → deriveMessages 纯
 * 函数重导——切片内更早的遮蔽（迭代链前次 surface/retry 形）照常应用，忠实
 * 复现「该区间在遮蔽时点的模型可见形」。
 */
import type { SessionEvent } from '../contracts/index.js';
import type { ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import type { ProjectedMessage } from '../session/index.js';
import { deriveMessages } from '../session/index.js';
import { CCR_MARKER_PREFIX, ccrDirectoryOf } from './ccr.js';

/** 渲染预算 56KiB（05 §2.1 分段续取律定值——留界外余量给尾部账，常态不触 append 刀） */
const RENDER_BUDGET_CHARS = 56 * 1024;

/** createCcrRetrieveTool 依赖注入面（装配根 per-session 构造闭包） */
export interface CcrToolsDeps {
  /** 本会话日志读面（SessionLog 结构满足；测试可注入替身） */
  readonly events: () => readonly SessionEvent[];
  /** 渲染预算字符（缺省 56KiB——测试注入小值驱动分段窗口） */
  readonly renderBudgetChars?: number;
}

/** 内容块面 → 纯文本（string 直通；块数组 text 块取文本、他块 JSON 形——渲染面保真不猜） */
function textOf(content: string | readonly unknown[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      const b = block as { type?: string; text?: unknown };
      return b.type === 'text' && typeof b.text === 'string' ? b.text : JSON.stringify(block);
    })
    .join('\n');
}

/** 投影消息 → 可读文本行（模型消费形——角色标注 + 工具调用/结果结构呈现） */
function renderProjected(message: ProjectedMessage): string {
  switch (message.type) {
    case 'user':
      return `[user] ${textOf(message.content)}`;
    case 'assistant': {
      const parts = [`[assistant] ${textOf(message.content)}`];
      for (const call of message.toolCalls) {
        parts.push(`  · 工具调用 ${call.toolName}(${call.toolCallId}) 参数: ${call.arguments}`);
      }
      if (message.errorMessage !== undefined) parts.push(`  · 错误: ${message.errorMessage}`);
      return parts.join('\n');
    }
    case 'toolResult':
      return `[${message.isError ? 'toolResult·出错' : 'toolResult'} ${message.toolName}] ${textOf(message.output)}`;
  }
}

/** 归档目录形（hash 缺省消费面）：空目录诚实明示 */
function directoryText(events: readonly SessionEvent[]): string {
  const entries = ccrDirectoryOf(events);
  if (entries.length === 0) return '本会话暂无 CCR 归档（未压缩过，或遮蔽段早于 CCR 机制引入——批前历史不可回取）。';
  const lines = entries.map((e) => `${CCR_MARKER_PREFIX}${e.hash}>> ${e.messages} 条消息 / ${e.chars} 字符`);
  return `本会话已归档压缩段（hash 传入 ccr_retrieve 可取回原文）：\n${lines.join('\n')}`;
}

/** 区间命中形：事件切片重导 + 分段续取窗口（冷读闸 M1——至少渲染一条 + 预算累加） */
function rangeText(
  events: readonly SessionEvent[],
  start: number,
  end: number,
  fromMessage: number,
  budget: number,
): string {
  const slice = events.filter((event) => event.seq >= start && event.seq <= end);
  const messages = deriveMessages(slice);
  if (messages.length === 0) return '区间不可读：遮蔽区间内无可重导的消息（事件残缺或形态不规则）。';
  const from = Math.max(0, Math.min(fromMessage, messages.length - 1));
  const rendered: string[] = [];
  let used = 0;
  let taken = 0;
  for (let i = from; i < messages.length; i += 1) {
    const line = renderProjected(messages[i]!);
    // 至少渲染一条（首条无条件收）；随后累加至预算即止——尾部恒可续取
    if (taken > 0 && used + line.length > budget) break;
    rendered.push(line);
    used += line.length;
    taken += 1;
  }
  const total = messages.length;
  const tail =
    from + taken < total
      ? `（已渲染 ${from + taken}/${total} 条——续取传 fromMessage=${from + taken} 可取余下）`
      : `（已渲染 ${from + taken}/${total} 条，本段已取尽）`;
  return `${rendered.join('\n\n')}\n\n${tail}`;
}

/** ccr_retrieve 工具工厂（装载位/测试唯一入口）——单件定义数组（族位形，obs/control 同构） */
export function createCcrRetrieveTool(deps: CcrToolsDeps): readonly ToolDefinition[] {
  const budget = deps.renderBudgetChars ?? RENDER_BUDGET_CHARS;
  return [
    {
      name: 'ccr_retrieve',
      description:
        '取回本会话压缩归档段的原文（可逆压缩——摘要是有损呈现、原文无损归档）。' +
        `上下文里形如 ${CCR_MARKER_PREFIX}哈希>> 的标记即归档锚：把哈希传入本工具即得该段原文。` +
        '不传 hash 返回归档目录（逐段哈希/消息数/字符数）。' +
        '大段自动分窗：返回尾部标注「已渲染 X/N 条」，传 fromMessage=X 续取余下。' +
        '只读本会话历史（曾可见内容，非新信息）；哈希不在归档集时如实回报原因。',
      parameters: Type.Object(
        {
          hash: Type.Optional(
            Type.String({ description: '归档哈希（<<ccr:…>> 标记内的 16 位十六进制串；缺省返回目录）' }),
          ),
          fromMessage: Type.Optional(Type.Number({ description: '续取位（区间内消息 0 基序——分窗续取用；缺省 0）' })),
        },
        { additionalProperties: false },
      ),
      effect: 'read',
      execute: async (args): Promise<{ content: { type: 'text'; text: string }[] }> => {
        const events = deps.events();
        const hash = args.hash;
        if (hash === undefined) return { content: [{ type: 'text', text: directoryText(events) }] };
        // 命中匹配：只认本会话 surface 事件的存储哈希（归属结构性免疫——伪标记必 miss 零副作用）
        const hit = events.find(
          (event) => event.type === 'compaction/surface' && (event.data as { ccrHash?: unknown }).ccrHash === hash,
        );
        if (hit === undefined) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `未找到哈希 ${hash} 的归档段。可能原因：哈希不在本会话归档集` +
                  '（标记来自其他来源或已损坏）、或该段遮蔽早于 CCR 机制引入（批前历史不可回取）。' +
                  '可先不传 hash 查看本会话归档目录核对。',
              },
            ],
          };
        }
        const op = hit.surfaceOp;
        if (op === undefined) {
          return { content: [{ type: 'text', text: '区间不可读：归档事件缺少区间信封（数据形态异常）。' }] };
        }
        const fromMessage =
          typeof args.fromMessage === 'number' && Number.isFinite(args.fromMessage) ? args.fromMessage : 0;
        return { content: [{ type: 'text', text: rangeText(events, op.start, op.end, fromMessage, budget) }] };
      },
    },
  ];
}
