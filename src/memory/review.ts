/**
 * memory 提取周期路（06 §4 + 批 18c-5 落码定形注——后台低优先级 review 提取
 * 五类候选，候选逐条经 ingest 合并管线入库，没有绕过合并的写路径）。
 *
 * **转录纪律**（定形注——住 memory 件）：审阅窗内只转录**文本面**两腿——
 * user/message（机器源滤除，复用即时路 isEligibleUserSource/userTextOf）
 * 与 assistant/message（text 块拼接）；tool/call·tool/result 不转录——五类
 * 候选判定不需要工具原始输出，防敏感工具输出进 LLM prompt 面（§8 卫生延伸）。
 * 事件窄面 = contracts SessionEvent（memory 席 DAG 有 contracts 边——直接
 * import 词面单源；session 读面经周期路编排件 fetchEvents seam 注入）。
 *
 * **JSON 三试**（定形注）：直取 → 剥代码围栏 → 首平衡段扫描（字符串字面量
 * 跳越配平）；三试皆败 = 整体坏形；成功后**按条丢弃不弃批**（TypeBox 深校验
 * 未知字段拒收——单条坏形只丢该条）。
 *
 * **预算护栏**：canAfford('background') 拒 → 跳过本轮（06 §4 字面）；LLM 经
 * MemoryLlmFace 窄面注入（词面独立律）。**溯源**：sourceSeq ∈ 窗内转录行 seq
 * 时取该行（LLM 指认的证据位）；缺席/越窗回落审阅窗锚（窗内首转录行 seq）。
 * 候选 owner 恒 global（审阅窗无项目语境——project 域随 context 席接线再议）。
 */
import type { SessionEvent } from '../contracts/index.js';
import type { MemoryDao } from './dao.js';
import { isEligibleUserSource, userTextOf, type ExtractableUserMessage } from './extract.js';
import {
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_REVIEW_CONFIDENCE,
  MEMORY_SUMMARY_MAX_CHARS,
  REVIEW_KINDS,
  llmTextOf,
  type MemoryLlmFace,
  type ReviewKind,
} from './types.js';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

/* ---------------- JSON 三试（共享纯函数——consolidate 复用） ---------------- */

/** 代码围栏剥取（```json … ``` / ``` … ```——内层再入三试链） */
function stripFence(text: string): string | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m !== null ? m[1]! : null;
}

/** 首平衡段扫描（首 '{'/'[' 起配平到对应闭括——字符串字面量与转义跳越） */
function balancedSegment(text: string): string | null {
  const open = text.search(/[{[]/);
  if (open < 0) return null;
  const openCh = text[open]!;
  const closeCh = openCh === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * JSON 载荷三试解析（定形注：直取/剥围栏/平衡段）：任一试 JSON.parse 成功即
 * 返回该值（不校验形状——形状校验归调用方 TypeBox 面）；三试皆败返回 null。
 */
export function parseJsonPayload(text: string): unknown {
  // 试一：直取
  try {
    return JSON.parse(text);
  } catch {
    /* 落试二 */
  }
  // 试二：剥代码围栏
  const fenced = stripFence(text);
  if (fenced !== null) {
    try {
      return JSON.parse(fenced);
    } catch {
      /* 落试三 */
    }
  }
  // 试三：首平衡段（模型前后缀闲话包裹的载荷）
  const segment = balancedSegment(text);
  if (segment !== null) {
    try {
      return JSON.parse(segment);
    } catch {
      /* 三试皆败 */
    }
  }
  return null;
}

/* ---------------- 转录纪律（纯函数） ---------------- */

/** 转录行（审阅窗文本面——seq 与 sourceSeq 校验面共用） */
export interface ReviewTranscriptItem {
  readonly seq: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** 转录产物（items = 文本两腿行；anchorSeq = 溯源回落位；seqs = 合法 seq 集） */
export interface ReviewTranscript {
  readonly items: readonly ReviewTranscriptItem[];
  /** 审阅窗锚（窗内首转录行 seq——无转录行时 null） */
  readonly anchorSeq: number | null;
  /** 窗内转录行 seq 集（sourceSeq 越窗判据） */
  readonly seqs: ReadonlySet<number>;
}

/** user/message 载荷窄读（结构兼容 durable 载荷 {content, source?}——词面独立律零 session import） */
function userMessageData(event: SessionEvent): ExtractableUserMessage | null {
  const data = event.data as { content?: unknown; source?: unknown } | null;
  if (data === null || typeof data !== 'object' || data.content === undefined) return null;
  const content = data.content as ExtractableUserMessage['content'];
  return { content, ...(typeof data.source === 'string' ? { source: data.source } : {}) };
}

/** assistant/message 载荷窄读（content 块数组——text 块拼接复用 userTextOf） */
function assistantText(event: SessionEvent): string | null {
  const data = event.data as { content?: unknown } | null;
  if (data === null || typeof data !== 'object' || !Array.isArray(data.content)) return null;
  return userTextOf(data.content as ExtractableUserMessage['content']);
}

/**
 * 审阅窗转录（06 §4 周期路——只转录文本面两腿）：user/message 过机器源滤除
 * 与文本提取；assistant/message 拼 text 块；其余事件类型（tool 面/turn 面/
 * 未知类型）一律不转录。anchorSeq = 首转录行 seq（候选缺省溯源位）。
 */
export function transcribeForReview(events: readonly SessionEvent[]): ReviewTranscript {
  const items: ReviewTranscriptItem[] = [];
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = userMessageData(event);
      if (data === null) continue;
      if (!isEligibleUserSource(data.source)) continue; // 机器载体不入审阅面
      const text = userTextOf(data.content);
      if (text === null) continue;
      items.push({ seq: event.seq, role: 'user', text });
    } else if (event.type === 'assistant/message') {
      const text = assistantText(event);
      if (text === null || text === '') continue;
      items.push({ seq: event.seq, role: 'assistant', text });
    }
    // 其余类型不转录（转录纪律——tool 面不进 LLM prompt）
  }
  return {
    items,
    anchorSeq: items.length > 0 ? items[0]!.seq : null,
    seqs: new Set(items.map((i) => i.seq)),
  };
}

/* ---------------- 周期路编排（LLM 拍 + 按条校验入库） ---------------- */

/** review 候选条 schema（TypeBox 深校验——未知字段拒收；单条坏形按条丢弃） */
const REVIEW_ITEM = Type.Object(
  {
    kind: Type.Union(REVIEW_KINDS.map((k) => Type.Literal(k))),
    summary: Type.String({ minLength: 1, maxLength: MEMORY_SUMMARY_MAX_CHARS }),
    content: Type.String({ minLength: 1, maxLength: MEMORY_CONTENT_MAX_CHARS }),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    sourceSeq: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

/** 校验通过后的候选窄形 */
interface ReviewItem {
  readonly kind: ReviewKind;
  readonly summary: string;
  readonly content: string;
  readonly confidence?: number;
  readonly sourceSeq?: number;
}

/** review 编排件依赖 */
export interface MemoryReviewDeps {
  readonly dao: MemoryDao;
  readonly llm: MemoryLlmFace;
  /** 进程日志（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** 周期路单轮结局 */
export interface ReviewRunResult {
  readonly outcome:
    | 'ran' // LLM 拍完成（提取数可 0——真拍了）
    | 'skipped-empty' // 审阅窗无转录行
    | 'skipped-budget' // canAfford 拒
    | 'skipped-parse' // 回复整体非 JSON 数组
    | 'skipped-error'; // complete 抛
  /** 受理入库数（经 ingest 合并管线） */
  readonly extracted: number;
  /** 按条丢弃数（schema 败/入库拒〔secret 命中等〕/seq 越窗不致丢——回落锚） */
  readonly discarded: number;
}

/** review 系统提示词（只出 JSON 数组——五类闭集 + sourceSeq 指认） */
const REVIEW_SYSTEM_PROMPT = [
  '你是记忆审阅器：从会话转录中提取值得长期保留的记忆候选。',
  '只输出一个 JSON 数组（无其他文本），每项形如',
  '{"kind":"preference|fact|convention|failure|insight","summary":"一句话摘要","content":"全文","confidence":0.0到1.0,"sourceSeq":对应转录行的 seq}',
  '规则：只提取明确可复用的知识（用户偏好/事实/约定/失败教训/洞见）；不提取一次性细节、猜测或任何敏感信息；',
  'summary 与 content 使用转录原语言；同一知识只提取一条；无值得提取的内容输出 []。',
].join('\n');

/**
 * 跑一轮周期路 review（06 §4——候选逐条经 ingest 合并管线入库，不直接 insert）：
 * 转录 → 预算闸 → LLM 拍 → JSON 三试 → TypeBox 按条校验（按条丢弃不弃批）→
 * 逐条 ingest（owner 恒 global；置信度缺省 0.6；溯源 sourceSeq 越窗回落锚）。
 */
export async function runMemoryReview(
  deps: MemoryReviewDeps,
  sessionId: string,
  events: readonly SessionEvent[],
): Promise<ReviewRunResult> {
  const warn = deps.warn ?? (() => {});
  const transcript = transcribeForReview(events);
  if (transcript.items.length === 0) return { outcome: 'skipped-empty', extracted: 0, discarded: 0 };

  // 预算闸（06 §4 字面：预算不足跳过本轮——下个周期再试）
  if (!deps.llm.canAfford('background')) return { outcome: 'skipped-budget', extracted: 0, discarded: 0 };

  const lines = transcript.items.map((i) => `[seq=${i.seq} ${i.role}] ${i.text}`).join('\n');
  let parsed: unknown;
  try {
    const completion = await deps.llm.complete({
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `会话 ${sessionId} 审阅窗转录：\n${lines}` }],
      priority: 'background',
    });
    parsed = parseJsonPayload(llmTextOf(completion.message.content));
  } catch (error) {
    warn(`memory 周期路 review 拍失败（跳过本轮）：${error instanceof Error ? error.message : String(error)}`);
    return { outcome: 'skipped-error', extracted: 0, discarded: 0 };
  }
  if (!Array.isArray(parsed)) return { outcome: 'skipped-parse', extracted: 0, discarded: 0 };

  let extracted = 0;
  let discarded = 0;
  const anchor = transcript.anchorSeq ?? 0; // 无转录行已早退——恒非 null 到此
  for (const raw of parsed) {
    // 按条校验（TypeBox 深校验未知字段拒收——坏形只丢该条不弃批）
    if (typeof raw !== 'object' || raw === null || !Value.Check(REVIEW_ITEM, raw)) {
      discarded++;
      continue;
    }
    const item = raw as ReviewItem;
    // 溯源：sourceSeq ∈ 窗内转录行取该行；缺席/越窗（幻觉）回落审阅窗锚
    const seq = item.sourceSeq !== undefined && transcript.seqs.has(item.sourceSeq) ? item.sourceSeq : anchor;
    try {
      deps.dao.ingest({
        ownerKey: 'global',
        kind: item.kind,
        summary: item.summary,
        content: item.content,
        confidence: item.confidence ?? MEMORY_REVIEW_CONFIDENCE,
        sourceRefs: [{ sessionId, seq }],
      });
      extracted++;
    } catch {
      // 入库拒（写前 secret 扫描命中/坏形——Value.Check 已挡形面，此处余 secret 面）
      discarded++;
    }
  }
  return { outcome: 'ran', extracted, discarded };
}
