/**
 * llm — 会话层恢复零件的 berry-agent 类型面包装（04 §3.5：classifyError 单源
 * 纯函数表 + pi-ai 零件复用）。
 *
 * pi-ai 的 isContextOverflow / retryAssistantCall 等零件面向 pi-ai
 * AssistantMessage 类型签名；本文件以**我们的 contracts AssistantMessage**
 * 为签名薄包装（结构同构，边界单次收口），conversation 驱动（turn 级
 * auto-retry 与溢出 compact-and-retry-once，04 §3.3/§3.4）从这里取用，
 * 不直接触 pi-ai 类型。
 */

import {
  isContextOverflow as piIsContextOverflow,
  isRecoverableLength as piIsRecoverableLength,
  isRetryableAssistantError as piIsRetryable,
  retryAssistantCall as piRetryAssistantCall,
} from '@earendil-works/pi-ai';
import type {
  AssistantMessage as PiAssistantMessage,
  RetryCallbacks as PiRetryCallbacks,
  RetryPolicy as PiRetryPolicy,
} from '@earendil-works/pi-ai';
import type { AssistantMessage, ErrorBucket } from '../contracts/index.js';
// ErrorBucket 词汇归 contracts 单源（批 11b——conversation 注入消费同形）；
// 此处 re-export 维持 llm 公开面不变，实现（四桶判定）仍单源于本文件
export type { ErrorBucket };

/** 重试策略（指数退避 baseDelayMs * 2^(attempt-1)；pi-ai 同构透传） */
export type RetryPolicy = PiRetryPolicy;
/** 重试过程回调（UI 事件挂点：调度前/开始前/结束时；pi-ai 同构透传） */
export type RetryCallbacks = PiRetryCallbacks;

/** 边界收口：宿主消息 → pi-ai 签名（结构同构，超集兼容子集方向） */
function toPi(message: AssistantMessage): PiAssistantMessage {
  return message as unknown as PiAssistantMessage;
}

/**
 * 检测上下文溢出（04 §3.4 溢出兜底的第一步）。
 * 覆盖三类：显式报错（provider 正则）、静默溢出（input+cacheRead 超窗）、
 * length 且零输出（截断填满型）。
 * @param contextWindow 模型上下文窗口——传入才启用静默溢出检测
 */
export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
  return piIsContextOverflow(toPi(message), contextWindow);
}

/**
 * length 截止是否低于预期输出上限（上下文压力/供应商截断信号——
 * 允许上层做一次有界 compact-and-retry）。
 */
export function isRecoverableLength(message: AssistantMessage, desiredMaxOutput: number): boolean {
  return piIsRecoverableLength(toPi(message), desiredMaxOutput);
}

/** 失败消息是否像 transient（网络/限流类）错误——决定 turn 级重试是否值得 */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
  return piIsRetryable(toPi(message));
}

/**
 * 错误四桶（04 §3.5 表）——词汇定义已归 contracts/llm.ts（ErrorBucket），
 * 此处 re-export 维持 llm 公开面不变：
 * transient/non-retryable/quota 是消费动作桶（每桶一个动作无歧义态），
 * overflow 只分类不消费（动作挂溢出兜底纵切）。
 * 驱动 runTurns 重试循环只消费 'transient'。
 */

/**
 * 配额耗尽文案子集（pi-ai retry.ts NON_RETRYABLE 正则的配额族词表——
 * 该正则模块内私有不导出，此处同款自写）。
 * quota 桶与 generic non-retryable 的分流：配额类失败要明示「重试治不了」
 * 的诊断语义（04 §3.5 桶③），不是重试判定差异——两者都不进 auto-retry。
 */
const QUOTA_TEXT_PATTERN =
  /(GoUsageLimit|FreeUsageLimit|Monthly usage limit|available balance|insufficient_quota|out of budget|quota exceeded|billing)/i;

/** 错误文案的取值面：errorMessage 优先，退而 content 首文本块（与 pi-ai 判定面同源） */
function errorText(message: AssistantMessage): string {
  if (message.errorMessage !== undefined && message.errorMessage !== '') return message.errorMessage;
  const text = message.content.find((block): block is { type: 'text'; text: string } => block.type === 'text');
  return text?.text ?? '';
}

/**
 * 错误桶判定（04 §3.5——单源纯函数表，llm 适配层唯一分类点，全仓无第二
 * 分类处；判定序 2026-09-05 llm 落码批定序）：errorCode 在场码优先、文案
 * 正则兜底。判定步：
 * ① errorCode=LLM_INFLIGHT_LIMIT（在飞帽拒绝）→ transient——并发压力自解，
 *    退避后槽已释放；
 * ② isContextOverflow → overflow（分类不消费）；
 * ③ 配额文案族 → quota（429/rate limit 不在此族——归 transient 桶；
 *    provider 真错误码归一挂 provider 钩子纵切，落码前 errorCode 无 provider
 *    写点、文案正则是唯一现实路）；
 * ④ pi-ai isRetryable 正则（网络/5xx/429/overloaded/流早断）→ transient；
 * ⑤ 其余 → non-retryable（保守：未知错误不重试）。
 */
export function classifyError(message: AssistantMessage): ErrorBucket {
  // ① 宿主合成码优先（errorCode 是机器判定位，摆脱 [CODE] 文本前缀约定）
  if (message.errorCode === 'LLM_INFLIGHT_LIMIT') return 'transient';
  // ② 溢出分类位（provider 正则 + 静默溢出 + length 零输出）
  if (piIsContextOverflow(toPi(message))) return 'overflow';
  // ③ 配额族文案 → quota（在 isRetryable 之前测：insufficient_quota 在 pi-ai
  //    归 non-retryable，此处细分到 quota 桶供诊断面区分）
  if (QUOTA_TEXT_PATTERN.test(errorText(message))) return 'quota';
  // ④ transient 正则（429/5xx/网络/流早断）
  if (piIsRetryable(toPi(message))) return 'transient';
  // ⑤ 保守默认：未知即不可重试（auth/参数/内容策略类重试只会再失败）
  return 'non-retryable';
}

/* ---------------- provider 失败形态识别（07 §5 provider 产品级文案律） ---------------- */

/**
 * provider 失败形态识别产物（07 §5——headless 单发（run 入口）无 UI 可看，
 * 两类「配置错」失败必须给产品级可行动文案而非裸报文：点名 provider +
 * 配置/凭证途径 + 上游原文降附注截断；其余失败原文直出不套本面）。
 */
export interface ProviderFailureDiagnostic {
  /** unconfigured = provider/模型未配置或目录缺席；auth = 鉴权失败 */
  readonly kind: 'unconfigured' | 'auth';
  /** 产品级可行动文案（已含上游原文截断附注——调用方直写 stderr） */
  readonly hint: string;
}

/**
 * 鉴权失败文案族（401/403/invalid api key 族——provider 报文人间千姿，
 * 正则面兜大类；provider 真错误码归一挂 provider 钩子纵切落码前，文案
 * 正则是唯一现实判位——与错误桶表 quota 族判据同境况）。
 */
const AUTH_TEXT_PATTERN =
  /(\b401\b|\b403\b|invalid[^\n]{0,40}api.?key|incorrect api key|api key not (?:valid|found)|unauthorized|authentication|permission denied)/i;

/** 上游报文附注截断帽（与 RunOutcome.error 同幅——≤200 字符人读够用） */
const UPSTREAM_NOTE_CAP = 200;

/** 模型标识 → provider 名（'provider/model-id' 前段；无斜杠回退原串） */
function providerNameOf(modelSpec: string): string {
  const slash = modelSpec.indexOf('/');
  return slash > 0 ? modelSpec.slice(0, slash) : modelSpec;
}

/** 上游报文附注（超帽截断加省略号——原文降附注律） */
function upstreamNote(text: string): string {
  return text.length > UPSTREAM_NOTE_CAP ? `${text.slice(0, UPSTREAM_NOTE_CAP)}…` : text;
}

/**
 * provider 失败形态识别（07 §5——与错误桶表同源居本模块；纯函数零 IO）。
 * 判据两形态：
 * - unconfigured：宿主合成码 LLM_MODEL_NOT_FOUND / LLM_MODEL_SPEC_INVALID
 *   （stream-fn resolveModel 失败——provider 未注册或目录无此模型；errorCode
 *   与 `[CODE]` 文案前缀双在位，任一判位命中即识——run settle 只透传
 *   errorMessage 时文案判位兜底）；
 * - auth：错误文案正则。
 * 非两形态回 undefined——调用方原文直出（transient/quota 族已有桶语义，
 * 不在本面越俎）。
 */
export function diagnoseProviderFailure(
  failure: { readonly errorMessage?: string; readonly errorCode?: string },
  modelSpec: string,
): ProviderFailureDiagnostic | undefined {
  const text = failure.errorMessage ?? '';
  if (
    failure.errorCode === 'LLM_MODEL_NOT_FOUND' ||
    failure.errorCode === 'LLM_MODEL_SPEC_INVALID' ||
    text.includes('[LLM_MODEL_NOT_FOUND]') ||
    text.includes('[LLM_MODEL_SPEC_INVALID]')
  ) {
    return {
      kind: 'unconfigured',
      hint:
        `模型不可用：${modelSpec}——provider 未注册或目录中无此模型。` +
        `检查模型标识拼写（形如 provider/model-id）；更换缺省模型设 BERRY_AGENT_MODEL 环境变量。` +
        `上游报文：${upstreamNote(text)}`,
    };
  }
  if (text !== '' && AUTH_TEXT_PATTERN.test(text)) {
    return {
      kind: 'auth',
      hint:
        `provider 鉴权失败（${providerNameOf(modelSpec)}）：请配置该 provider 的 API 凭证——` +
        `对应环境变量（如 ANTHROPIC_API_KEY / OPENAI_API_KEY）或数据目录凭证表。` +
        `上游报文：${upstreamNote(text)}`,
    };
  }
  return undefined;
}

/**
 * 单次 assistant 产出的有界重试（04 §3.7 complete 单发的轻量重试零件；
 * pi 原用途挂 compaction 摘要旁路）。abort 归一为 aborted 消息、非可重试
 * 错误立即返回、成功即返回——语义细节见 pi-ai retry.ts 文档注释。
 */
export async function retryAssistantCall(
  produce: () => Promise<AssistantMessage>,
  policy: RetryPolicy,
  signal?: AbortSignal,
  callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
  const final = await piRetryAssistantCall(async () => toPi(await produce()), policy, signal, callbacks);
  return final as unknown as AssistantMessage;
}
