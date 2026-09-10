/**
 * 投影重建 timeline（04 §3.3 条 2「从投影重建 timeline 活数组」的私有路径 +
 * resume 续接共用）：ProjectedMessage[] → 标准 Message[]。
 *
 * 形状三缺口裁决（批 11b 契约先行，冷读 B2 对账定案）：
 *  - **arguments**：durable 原始串（tool/call 事件载荷）→ ToolCallBlock 的
 *    已解析对象——JSON.parse 失败兜底空对象（损坏不炸重播种，{} 形保调用
 *    结构合法；真源串在 durable 事件里永不丢）；
 *  - **toolCalls 装回尾部**：durable 分立事件（tool/call 不内联
 *    assistant/message——05 §1.1 防投影回读重复块条款）丢失原始交错序，
 *    装回 assistant.content 尾部即投影序（承 berry 形）；
 *  - **usage**：投影侧 unknown → AssistantMessage 必填 Usage——兜底零用量形
 *    （0 值不冒充计量；真账在 durable llm/usage 事件底账）。
 *  另两则：**stopReason** 字符串闭集校验，非成员归 'error'（损坏值不冒充
 *  正常收尾）；**timestamp** 必填以锚事件 time 词典解析（确定性——金样
 *  回放友好，不用墙钟）。
 */
import type {
  AssistantMessage,
  Message,
  StopReason,
  ToolCallBlock,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '../contracts/index.js';
import type { ProjectedMessage, ProjectedToolCall } from '../session/index.js';

/** StopReason 闭集（成员校验用——contracts 联合的运行时镜像） */
const STOP_REASONS: ReadonlySet<string> = new Set([
  'pending',
  'stop',
  'length',
  'toolUse',
  'error',
  'aborted',
  'deferred',
]);

/** 零用量兜底形（usage 未知/损坏时——0 值不冒充计量，底账在 llm/usage 事件） */
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
};

/**
 * usage 归一（unknown → Usage 必填形）：数值字段 finite 才取，任一主字段
 * 缺损即整笔退零用量（半拼凑的 usage 比零用量更有害——计量面要么完整
 * 要么明示没有）。导出面：模型可见总拍（model-visible.ts）两侧同归一复用
 * ——对拍等价判据以本归一为准（undefined ≡ 零用量兜底），单一归一源。
 */
export function normalizeUsage(usage: unknown): Usage {
  if (usage === null || typeof usage !== 'object') return ZERO_USAGE;
  const u = usage as Record<string, unknown>;
  const num = (key: string): number | undefined => {
    const v = u[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const input = num('input');
  const output = num('output');
  const cacheRead = num('cacheRead');
  const cacheWrite = num('cacheWrite');
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return ZERO_USAGE;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(num('cacheWrite1h') !== undefined ? { cacheWrite1h: num('cacheWrite1h') } : {}),
    ...(num('reasoning') !== undefined ? { reasoning: num('reasoning') } : {}),
    totalTokens: num('totalTokens') ?? input + output + cacheRead + cacheWrite,
  };
}

/** stopReason 闭集校验：undefined（历史/残缺）→ 'stop' 最小偏见；非成员 → 'error' 保守 */
function normalizeStopReason(reason: string | undefined): StopReason {
  if (reason === undefined) return 'stop';
  return STOP_REASONS.has(reason) ? (reason as StopReason) : 'error';
}

/** durable 原始参数串 → 已解析对象：解析失败兜底空对象（损坏不炸重播种） */
function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 落空兜底——真源串在 durable 事件里永不丢
  }
  return {};
}

/** 投影 toolCall 块 → contracts ToolCallBlock（id/name 字段名对齐） */
function toToolCallBlock(call: ProjectedToolCall): ToolCallBlock {
  return {
    type: 'toolCall',
    id: call.toolCallId,
    name: call.toolName,
    arguments: parseArguments(call.arguments),
  };
}

/**
 * 重播种：投影消息序列 → 标准 Message 数组（timeline 活数组种子）。
 * 纯函数（timeOf 词典注入保确定性）；toolResult 侧 arguments 丢弃
 * （请求面不需要——assistant 内联块已带）。
 * @param projection 投影（SessionLog.projection() 或 deriveMessages 产物——两路同源）
 * @param timeOf 锚事件 seq → 毫秒时间戳解析器（确定性时间源——不用墙钟）
 */
export function reseedTimeline(projection: readonly ProjectedMessage[], timeOf: (seq: number) => number): Message[] {
  const messages: Message[] = [];
  for (const projected of projection) {
    switch (projected.type) {
      case 'user': {
        const user: UserMessage = {
          role: 'user',
          // content 双形直通（string | 块数组——session ContentBlock 与 contracts
          // 块结构对齐，derive 头注同裁；只读→可写经结构断言收口）
          content: projected.content as UserMessage['content'],
          timestamp: timeOf(projected.seq),
          // source 闭集由写者闭环保证（durable 原值即 UserMessage.source 落账回读）
          ...(projected.source !== undefined ? { source: projected.source as UserMessage['source'] } : {}),
        };
        messages.push(user);
        break;
      }
      case 'assistant': {
        const assistant: AssistantMessage = {
          role: 'assistant',
          // toolCalls 装回尾部（投影序 = 尾部序——交错序在 durable 分立事件下无账）
          content: [...(projected.content as AssistantMessage['content']), ...projected.toolCalls.map(toToolCallBlock)],
          usage: normalizeUsage(projected.usage),
          stopReason: normalizeStopReason(projected.stopReason),
          timestamp: timeOf(projected.seq),
          ...(projected.errorMessage !== undefined ? { errorMessage: projected.errorMessage } : {}),
        };
        messages.push(assistant);
        break;
      }
      case 'toolResult': {
        messages.push({
          role: 'toolResult',
          toolCallId: projected.toolCallId,
          toolName: projected.toolName,
          // string 输出包裹文本块（请求面 content 恒块数组）；块数组直通
          content:
            typeof projected.output === 'string'
              ? [{ type: 'text', text: projected.output }]
              : (projected.output as ToolResultMessage['content']),
          isError: projected.isError,
          timestamp: timeOf(projected.seq),
        });
        break;
      }
    }
  }
  return messages;
}
