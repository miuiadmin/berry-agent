/**
 * 核心事件 data 形状（05 篇 §1.1 表格 data 关键字段列的类型化）。
 *
 * 分域纪律：本文件只定 **owner=session 与 append 流水线裁腿必需** 的形状
 * （user/message·assistant/message·tool/call·tool/result 四形是预算刀裁腿面）；
 * 其余宿主件自管类型（todo/write 归 conversation、approval/*·sandbox/mode 归
 * safety、gate/decision 归 tools、llm/usage 归 llm、plugin/uninstalled 归 host）
 * 随各件落码自定——契约先于实现的纵切序不要求一次全列。
 */
import type { EventSource, TurnEndReason } from '../contracts/index.js';

/** 内容块三形（结构对齐 pi-ai 消息块；session 不 import llm——投影形状自有，llm 侧收口适配） */
export type ContentBlock = TextBlock | ThinkingBlock | ImageBlock;

/** 文本块 */
export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

/** 思考块（模型推理轨迹——assistant 侧） */
export interface ThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
}

/** 图像块（dataUrl/base64 载荷——预算刀超帽时落占位对象） */
export interface ImageBlock {
  readonly type: 'image';
  readonly data: string;
  readonly mimeType?: string;
}

/** turn/start 的 data（空对象——起点即事件自身） */
export interface TurnStartData {
  // 无字段：一轮开始无附加语义（轮语境由 request/header 承载）
}

/** turn/end 的 data */
export interface TurnEndData {
  /** 终因闭集（可扩展——contracts TurnEndReason） */
  readonly reason: TurnEndReason;
}

/** user/message 的 data */
export interface UserMessageData {
  /** string 或内容块数组（对齐 pi-ai UserMessage 形状） */
  readonly content: string | readonly ContentBlock[];
  /** 输入归因（contracts EventSource 闭集——投影 treatedAsUser 判据） */
  readonly source?: EventSource;
}

/** assistant/message 的 data（组装完成后落账——toolCall 块不内联，由 tool/call 事件唯一承载） */
export interface AssistantMessageData {
  /** 模型响应内容块（text/thinking——不含工具调用） */
  readonly content: readonly ContentBlock[];
  /** 本次调用计量（pi-ai usage 形状原样快照） */
  readonly usage?: unknown;
  /** 停止原因（pi-ai stopReason 原样） */
  readonly stopReason?: string;
  /** 被打断（interrupt——与 aborted 终因分立的事实位） */
  readonly interrupted?: boolean;
  /** 失败说明（stopReason=error 终态轮的错误文本——2KiB 小帽独立计帽，05 §1.1 表注） */
  readonly errorMessage?: string;
}

/** tool/call 的 data（arguments 存原始未解析字符串——审计保真） */
export interface ToolCallData {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: string;
}

/** tool/result 的 data（一调用一结果） */
export interface ToolResultData {
  readonly toolCallId: string;
  /** 结果内容（文本或块数组——预算刀截腿面） */
  readonly content: string | readonly ContentBlock[];
  /** 执行失败标记（true = 模型可见的错误结果） */
  readonly error?: boolean;
  /** 结果元数据（任意 JSON——不计入模型可见面） */
  readonly meta?: unknown;
}

/** request/header 的 data（完整请求信封快照） */
export interface RequestHeaderData {
  /** 模型与采样配置快照 */
  readonly config: unknown;
  /** 系统提示词全文 */
  readonly systemPrompt: string;
  /** 工具 schema 清单（当次请求面） */
  readonly toolSchemas: readonly unknown[];
  /** 快照成因：initial（首请求）/ resume（恢复续跑）/ change（运行中配置变更） */
  readonly reason: 'initial' | 'resume' | 'change';
}

/** session/end-seed 的 data（空对象——边界即事件自身 seq，05 §5.0） */
export interface EndSeedData {
  // 无字段：fork 种子边界标记
}

/** llm/retry 的 data（owner=session——llm 模块不知道驱动存在，注册走核心词汇） */
export interface LlmRetryData {
  /** 第几次重试（1 起） */
  readonly attempt: number;
  /** 退避帽 */
  readonly maxAttempts: number;
  /** 本次退避延迟（毫秒；scheduled 形态含抖动后实延迟） */
  readonly delayMs: number;
  /** 阶段：scheduled（退避排定）/ aborted（退避中被取消）/ exhausted（达帽放弃） */
  readonly phase: 'scheduled' | 'aborted' | 'exhausted';
  /** 失败说明（exhausted 随行末次错误） */
  readonly errorMessage?: string;
  /** 重试类目：transient（瞬时错）/ overflow（溢出兜底复用本词作遮蔽信封；缺省 transient——旧日志读侧同视） */
  readonly reason?: 'transient' | 'overflow';
}
