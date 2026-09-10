/**
 * 「模型可见即已记录」请求关口总拍（05 §1.2 对拍断言——2026-09-11 运行时
 * 断言批，承《技术调研/参考源码与研究源码综合分析报告》借鉴 ⑦）。
 *
 * 对拍两侧不共享中间状态：
 *  - live 侧 = 驱动 timeline 活数组（loop「入列↔emit」同步对偶维护的投影
 *    镜像缓存——05 §1.3 单一事实源，非第二真相）；
 *  - expected 侧 = 事件日志独立重建（session.projection() → reseedTimeline
 *    同一转换链——与冷启动 resume / 重试重播种完全同路）。
 *
 * 等价即「日志在、模型才在」的可机证形态；红 = 驱动 bug fail-loud，两类
 * 病灶：模型可见消息未经 durable 落账即入列（loop 对偶被绕过的暗通道——
 * 含自定义角色：wiring 对自定义角色零 durable 写点，活侧出现即暗通道）、
 * 或落账翻译腿失真（wiring 翻译丢字段/变形）。
 *
 * 规范形（05 §1.2 总拍规范形条款）：字段白名单与 §3.1「data 审计字段不进
 * 模型上下文」同源——user 只比 content（source/dedupeKey 审计位不参与）；
 * timestamp 不参与（活侧创建墙钟 vs 重建侧锚事件 time——时点差非漂移）；
 * usage 两侧同过归一（undefined ≡ 零用量兜底）；toolCall 块两侧同律归尾
 * （重播种装回尾部的既定归一形——交错序归一后对拍）；对象键序不敏感
 * （两侧独立构造体，键序差非漂移）。
 *
 * 预算刀豁免（05 §1.2 条 4 的对拍面）：durable 侧截断是既定可观测降级非
 * 漂移——重建消息源自被截事件时（degradationMask 从投影原始形判——重建
 * 形本身可能已丢失标记：arguments 被截后 JSON 解析兜底 {}，标记随之蒸发），
 * 该位内容腿降为结构对拍（角色 / toolCall id·name 清单 / stopReason /
 * isError），字节级对拍在刀后消息上永假。
 */
import type { AgentMessage, AssistantMessage, Message } from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import type { ProjectedMessage } from '../session/index.js';
import { normalizeUsage } from './reseed.js';

/** 预算刀降级标记核心串（session/budget.ts 真源标记的稳定子串） */
const DEGRADATION_MARKERS: readonly string[] = ['…[truncated ', 'image-blob-dropped'];

/** 诊断摘录帽（红消息里的规范形截断长度——诊断可读性，非语义面） */
const SNIPPET_LIMIT = 240;

/**
 * 规范序列化：对象键递归排序的确定性 JSON（键序不敏感对拍的前提——两侧
 * 构造路径独立，键插入序天然可异）。undefined 值键随 stringify 丢弃——
 * 「在场 undefined ≡ 缺席」正是白名单外的兜底语义。
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) sorted[key] = record[key];
      return sorted;
    }
    return val;
  });
}

/** 诊断摘录（超帽截断加省略号——红消息不吞日志） */
function snippet(text: string): string {
  return text.length <= SNIPPET_LIMIT ? text : `${text.slice(0, SNIPPET_LIMIT)}…`;
}

/**
 * assistant 内容块规范形：toolCall 块归尾（与 reseedTimeline「装回尾部」
 * 同律——durable 分立事件下交错序无账，两侧都归一到尾部序再对拍）。
 */
function canonicalAssistantContent(blocks: AssistantMessage['content']): unknown[] {
  const plain: unknown[] = [];
  const calls: unknown[] = [];
  for (const block of blocks) {
    if (block.type === 'toolCall')
      calls.push({ type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments });
    else plain.push(block);
  }
  return [...plain, ...calls];
}

/** 单消息规范形（model-visible 白名单——见件头注） */
function canonicalMessageForm(message: AgentMessage): unknown {
  if (!isStandardMessage(message)) {
    // 自定义角色：role + content 原样对拍（对拍红素材——wiring 零 durable
    // 写点位，活侧出现即暗通道候选，规范形不吞）
    return { kind: 'custom', role: message.role, content: message.content };
  }
  switch (message.role) {
    case 'user':
      return { kind: 'user', content: message.content };
    case 'assistant':
      return {
        kind: 'assistant',
        content: canonicalAssistantContent(message.content),
        usage: normalizeUsage(message.usage),
        stopReason: message.stopReason,
        ...(message.errorMessage !== undefined ? { errorMessage: message.errorMessage } : {}),
      };
    case 'toolResult':
      return {
        kind: 'toolResult',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        isError: message.isError,
      };
  }
}

/**
 * 单消息结构形（预算刀豁免位的内容降级对拍）：角色 / toolCall id·name
 * 清单（arguments 豁免——被截后解析兜底 {}，与真值永假）/ stopReason /
 * isError。内容文本腿豁免（刀后字节级对拍永假）。
 */
function structuralMessageForm(message: AgentMessage): unknown {
  if (!isStandardMessage(message)) return { kind: 'custom', role: message.role };
  switch (message.role) {
    case 'user':
      return { kind: 'user' };
    case 'assistant':
      return {
        kind: 'assistant',
        plainBlockTypes: message.content.filter((block) => block.type !== 'toolCall').map((block) => block.type),
        calls: message.content
          .filter((block): block is Extract<typeof block, { type: 'toolCall' }> => block.type === 'toolCall')
          .map((block) => ({ id: block.id, name: block.name })),
        stopReason: message.stopReason,
      };
    case 'toolResult':
      return {
        kind: 'toolResult',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        isError: message.isError,
      };
  }
}

/** 投影原始形的消息级降级扫描（canonicalJson 全文含任一标记即降级位） */
function projectedIsDegraded(projected: ProjectedMessage): boolean {
  const raw: unknown =
    projected.type === 'user'
      ? projected.content
      : projected.type === 'assistant'
        ? {
            content: projected.content,
            toolCalls: projected.toolCalls,
            ...(projected.errorMessage !== undefined ? { errorMessage: projected.errorMessage } : {}),
          }
        : { output: projected.output, arguments: projected.arguments };
  const text = canonicalJson(raw);
  return DEGRADATION_MARKERS.some((marker) => text.includes(marker));
}

/**
 * 降级掩码（预算刀豁免位清单）：投影逐消息判降级——掩码[i] = true 表示
 * 第 i 条重建消息源自被截事件，对拍降为结构级。掩码从投影原始形判而非
 * 重建形：arguments 被截后 reseedTimeline 解析兜底 {}，标记在重建形已蒸发，
 * 唯投影形（事件 data 原值）保真。
 */
export function degradationMask(projection: readonly ProjectedMessage[]): boolean[] {
  return projection.map(projectedIsDegraded);
}

/** 角色名（诊断用——缺位形明示） */
function roleOf(message: AgentMessage | undefined): string {
  return message === undefined ? '（缺位）' : message.role;
}

/** 红消息构造（首分歧位 + 双形摘录 + 病灶指认——fail-loud 诊断面） */
function driftError(
  index: number,
  live: readonly AgentMessage[],
  expected: readonly Message[],
  reason: string,
  liveForm: unknown,
  expectedForm: unknown,
): Error {
  return new Error(
    `模型可见即已记录对拍红（05 §1.2 总拍）：timeline 活数组与日志重建漂移——${reason}。` +
      `首分歧位 ${index}：live ${roleOf(live[index])} vs 重建 ${roleOf(expected[index])}。` +
      `live 形 ${snippet(canonicalJson(liveForm))}；重建形 ${snippet(canonicalJson(expectedForm))}。` +
      `驱动 bug——存在绕过 durable 落账的模型可见写入（loop「入列↔emit」对偶被绕过）或落账翻译腿失真（wiring 翻译丢字段/变形）`,
  );
}

/**
 * 请求关口总拍断言（05 §1.2——恒开执法位唯一消费面是 driver.onTransformContext
 * 入口）。逐条规范形比对；degraded[i] = true 的位置降为结构形比对（预算刀
 * 豁免）；长度差单列诊断。等价零动作，漂移 throw（驱动 bug 语义——与
 * occludeFailedTail 锚缺席同律，不占公开错误码面）。
 *
 * @param live 驱动 timeline 活数组（请求组装时点的模型可见持久消息序列）
 * @param expected 日志独立重建（reseedTimeline 产物——与 live 同源不同路）
 * @param degraded 降级掩码（degradationMask 产物；缺省全 false）
 */
export function assertModelVisibleTimeline(
  live: readonly AgentMessage[],
  expected: readonly Message[],
  degraded?: readonly boolean[],
): void {
  const n = Math.min(live.length, expected.length);
  for (let i = 0; i < n; i += 1) {
    if (degraded?.[i] === true) {
      // 预算刀豁免位：结构形比对（内容腿降级——刀后字节级对拍永假）
      const liveForm = structuralMessageForm(live[i]!);
      const expectedForm = structuralMessageForm(expected[i]!);
      if (canonicalJson(liveForm) !== canonicalJson(expectedForm)) {
        throw driftError(
          i,
          live,
          expected,
          '结构异（预算刀豁免位——内容腿已降级，结构仍不等价）',
          liveForm,
          expectedForm,
        );
      }
      continue;
    }
    const liveForm = canonicalMessageForm(live[i]!);
    const expectedForm = canonicalMessageForm(expected[i]!);
    if (canonicalJson(liveForm) !== canonicalJson(expectedForm)) {
      throw driftError(i, live, expected, '内容异（规范形不等价）', liveForm, expectedForm);
    }
  }
  if (live.length !== expected.length) {
    // 长度差诊断（前 n 条已逐条过拍——本红专指尾部多出/缺失）
    const surplus =
      live.length > expected.length
        ? 'live 多出——存在绕过 durable 落账的模型可见写入（暗通道）'
        : '重建多出——存在落账后未入 timeline 的 surplus（翻译腿多写/入列腿漏推）';
    throw new Error(
      `模型可见即已记录对拍红（05 §1.2 总拍）：timeline 活数组与日志重建漂移——长度差：live ${live.length} 条 vs 重建 ${expected.length} 条（前 ${n} 条规范形等价；${surplus}）。驱动 bug fail-loud`,
    );
  }
}
