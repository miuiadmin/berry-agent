/**
 * memory 提取即时路（06 §4——确定性代码零 LLM，fire-and-forget）。
 *
 * **纠正检测**：真用户消息命中纠正触发词表（中英双语保守清单常量，起草值
 * 随实测调）→ 立即提取 correction 候选（置信度 0.7 = 强证据——Mercury/Hermes
 * 纠正即时存先例）。候选经 ingest 单点入库（§5 合并管线 + §8 写前扫描
 * 内置——没有绕过合并的写路径）。
 *
 * **机器源滤除**（06 §4 即时路细则）：只对真用户消息入检——source 归因
 * 仅三形参与：缺省（读侧视为 'user'）/ 'user' / 'channel:*'；压缩摘要载体
 * （compaction）、插件注入（plugin:*）、调度（schedule）、子代理结算
 * （subagent-*）等机器载体一律跳过——机器文本命中纠正触发词会被提取成
 * 「用户亲口纠正」污染记忆库语义。
 *
 * **owner 恒 global**（06 §4 细则：纠正的是模型行为，跨项目成立——不走
 * project 域）。**溯源精确事件位**：sourceRefs = {sessionId, seq}（信封
 * seq——18c-2 工具面 seq:0 会话级位的精确位兑现）。
 *
 * **polluted 资格检查归 18c-5**（§4.1「两路入口同一资格检查」——判据表
 * 与会话状态机随周期路批落码，届时在两路入口统一挂检，本件不预建）。
 *
 * **装配位**：本件为纯消费件——host 装配批（批 12 装载面后装配批）把
 * onUserMessage 挂到 durable 事件流消费点；件自身不订阅。
 *
 * **词面独立律**：入检消息结构兼容 session UserMessageData（content
 * string|块数组 + source 可选）——本件不 import session（memory→session
 * 边的 18c-6 跨会话检索消费位仍占位）。
 */
import { parseEventSource } from '../contracts/index.js';
import type { MemoryDao } from './dao.js';
import { MEMORY_CONTENT_MAX_CHARS, MEMORY_SUMMARY_MAX_CHARS, type MemoryCandidate } from './types.js';

/**
 * 纠正触发词表（06 §4 中英双语保守清单——起草值随实测调）。
 * 中文：直接子串匹配；英文：小写归一后子串匹配（含撇形两拼）。
 */
const CORRECTION_TRIGGERS_ZH: readonly string[] = [
  '不对',
  '不是的',
  '说错了',
  '我说错了',
  '我说的是',
  '搞错了',
  '弄错了',
  '别再',
  '不要再',
  '纠正一下',
  '应该是',
];

const CORRECTION_TRIGGERS_EN: readonly string[] = [
  "that's wrong",
  'thats wrong',
  "that's not right",
  "that's incorrect",
  "you're wrong",
  'youre wrong',
  'no, i said',
  'i meant',
  'i said,',
  'stop doing',
  "don't do that",
  'dont do that',
  'scratch that',
];

/** 纠正候选置信度（06 §4——强证据定值） */
const CORRECTION_CONFIDENCE = 0.7;

/** 摘要前缀（落码定形：统一前缀 + 全文截断——同文本恒同摘要，重放经 exact 合并幂等吸收） */
const CORRECTION_SUMMARY_PREFIX = '用户纠正：';

/** 摘要正文截长（起草值——总长仍在 MEMORY_SUMMARY_MAX_CHARS 帽内） */
const CORRECTION_SUMMARY_TEXT_MAX = 100;

/** 即时路入检消息（结构兼容 session UserMessageData——词面独立律零 session import） */
export interface ExtractableUserMessage {
  /** string 或内容块数组（text 块承载纯文本面） */
  readonly content: string | readonly ExtractableBlock[];
  /** 输入归因（contracts EventSource 闭集词面；缺省 = 视为 'user'） */
  readonly source?: string;
}

/** 内容块窄面（只认 text 块的 type/text 两面——其余块形与文本提取无关） */
export interface ExtractableBlock {
  readonly type: string;
  readonly text?: string;
}

/** 触发词命中（trigger = 命中词——溯源与摘要面共用） */
export interface CorrectionHit {
  /** 命中的触发词原文（英文表原形——非小写归一形） */
  readonly trigger: string;
  /** 命中消息全文（候选 content 面） */
  readonly text: string;
}

/**
 * 机器源滤除（06 §4 三形白名单）：缺省 / 'user' / 'channel:*' 入检；
 * schedule / subagent-* / compaction / plugin:* 跳过。未知字面量按
 * contracts.parseEventSource 归 user 同视（05 §3.1 读侧向前兼容）——
 * 与「缺省（读侧视为 'user'）」同形。
 */
export function isEligibleUserSource(source: string | undefined): boolean {
  if (source === undefined) return true;
  const kind = parseEventSource(source).kind;
  return kind === 'user' || kind === 'channel';
}

/**
 * 消息纯文本面提取：string 直取；块数组拼 text 块（其余块形无关）；
 * 无文本（纯图像等）→ null 不入检。
 */
export function userTextOf(content: ExtractableUserMessage['content']): string | null {
  if (typeof content === 'string') return content === '' ? null : content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  if (parts.length === 0) return null;
  const joined = parts.join('\n');
  return joined === '' ? null : joined;
}

/**
 * 纠正触发词检测：中文表子串直配；英文表小写归一子串配。
 * 多命中取首（表序即优先序）；未命中 → null。
 */
export function detectCorrectionHit(text: string): CorrectionHit | null {
  for (const trigger of CORRECTION_TRIGGERS_ZH) {
    if (text.includes(trigger)) return { trigger, text };
  }
  const lower = text.toLowerCase();
  for (const trigger of CORRECTION_TRIGGERS_EN) {
    if (lower.includes(trigger)) return { trigger, text };
  }
  return null;
}

/** 摘要形（落码定形：前缀 + 全文截 100 + 省略尾——同文本恒同串，exact 合并幂等键） */
function correctionSummary(text: string): string {
  const body = text.length > CORRECTION_SUMMARY_TEXT_MAX ? `${text.slice(0, CORRECTION_SUMMARY_TEXT_MAX)}…` : text;
  const summary = `${CORRECTION_SUMMARY_PREFIX}${body}`;
  // 双保险截帽（前缀 + 截长恒在帽内；显式截防起草值未来调大越帽）
  return summary.length > MEMORY_SUMMARY_MAX_CHARS ? summary.slice(0, MEMORY_SUMMARY_MAX_CHARS) : summary;
}

/**
 * 纠正候选组装（06 §4 细则全档：kind correction / 置信度 0.7 / owner 恒
 * global / 溯源精确事件位）。content 截至帽内（提取尽力而为——超长纠正
 * 截尾保知识不整条拒写；截断点前文本仍完整过写前扫描）。
 */
export function buildCorrectionCandidate(hit: CorrectionHit, sessionId: string, seq: number): MemoryCandidate {
  return {
    ownerKey: 'global',
    kind: 'correction',
    summary: correctionSummary(hit.text),
    content: hit.text.length > MEMORY_CONTENT_MAX_CHARS ? hit.text.slice(0, MEMORY_CONTENT_MAX_CHARS) : hit.text,
    confidence: CORRECTION_CONFIDENCE,
    sourceRefs: [{ sessionId, seq }],
  };
}

/** 即时路编排件依赖 */
export interface ImmediateExtractorDeps {
  readonly dao: MemoryDao;
  /** 进程日志（缺省静默——失败 warn 分层归装配面） */
  readonly warn?: (message: string) => void;
}

/** 即时路编排件（fire-and-forget——异常 warn 吞绝不反噬会话流） */
export interface ImmediateExtractor {
  /**
   * 消费一条 user/message（装配面挂 durable 事件流消费点）。
   * 返回 extracted = 是否产出并受理了候选（源滤除/无命中/尽力而为失败均 false）。
   */
  onUserMessage(sessionId: string, seq: number, data: ExtractableUserMessage): { extracted: boolean };
}

/** 即时路编排件工厂：源滤除 → 文本提取 → 触发词检测 → 候选组装 → ingest 单点 */
export function createImmediateExtractor(deps: ImmediateExtractorDeps): ImmediateExtractor {
  const warn = deps.warn ?? (() => {});
  return {
    onUserMessage(sessionId, seq, data) {
      try {
        if (!isEligibleUserSource(data.source)) return { extracted: false };
        const text = userTextOf(data.content);
        if (text === null) return { extracted: false };
        const hit = detectCorrectionHit(text);
        if (hit === null) return { extracted: false };
        deps.dao.ingest(buildCorrectionCandidate(hit, sessionId, seq));
        return { extracted: true };
      } catch (error) {
        // 尽力而为（06 §4——提取失败不重试不反噬；写前扫描拒写〔secret 命中〕
        // 等被拒候选在此吞——进程日志是唯一观测面）
        warn(`memory 即时路提取失败（尽力而为跳过）：${error instanceof Error ? error.message : String(error)}`);
        return { extracted: false };
      }
    },
  };
}
