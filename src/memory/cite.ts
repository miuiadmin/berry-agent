/**
 * memory 引用回写件（06 §6 效用闭环——批 18c-7）。
 *
 * 消费 durable `assistant/message` 事件：文本面解析 `[m:短id]` 引用标记 →
 * 前缀归责三态（零命中 = 未知引用忽略 / 多命中 = 歧义全部忽略 / 恰一命中 =
 * 唯一归属）→ dao.markUsed 批量回写（usage_count++ / last_used_at / TTL 续期
 * / 流水 op='cite'——聚合只随 cite：usage_count ≡ cite 行数）。
 *
 * 消费件 idiom 与 18c-5 周期路挂件同款 `(sessionId, type, data)` 窄结构——
 * 装配面挂在会话事件流上（与 createMemoryCycle 的 fetchEvents 同一事实源）。
 * **尽力而为**：全程 try/catch warn（引用回写失败不炸事件通道——计量面
 * 非领域状态变更）；thinking 块不取（引用只发生在呈现面文本）。
 *
 * 纠正负效用回写（2026-09-08 消化批——06 §4 即时路第二动作）：recordCorrectedCites
 * 对被纠正回答的文本面**全复用本件解析面**（MEMORY_CITE_RE + 归责三态 + 同消息
 * 同短 id 去重——零新解析面）→ dao.markCorrected；createLastAssistantTextCache
 * 为装配面回看缓存（per-session 最近 assistant 文本，LRU 帽族同 §6 epochs）。
 */
import type { MemoryDao } from './dao.js';
import { MEMORY_CITE_RE } from './inject.js';
import { MEMORY_LAST_ASSISTANT_TEXT_LRU } from './types.js';

/* ---------------- 文本面提取 ---------------- */

/**
 * assistant/message durable data 文本提取（wiring 落 data.content =
 * (text|thinking 块)[]——toolCall 块不内联；引用只发生在 text 块呈现面，
 * thinking 块天然排除）。坏形返回 null（消费侧静默跳过——尽力而为）。
 * 导出面（§4 回看缓存共用——「紧邻前一条 assistant 文本」的取数单源）。
 */
export function assistantTextOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const content = (data as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter((b): b is { type: 'text'; text: string } => {
      const block = b as { type?: unknown; text?: unknown } | null;
      return typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string';
    })
    .map((b) => b.text)
    .join('\n');
}

/* ---------------- 引用解析 ---------------- */

/**
 * 文本面引用短 id 解析（同消息同短 id 去重——一条消息对一条记忆计一次；
 * 首现序保序）。/g 正则共享——进入与离开双复位（scan.ts 无状态纪律同律）。
 */
export function parseCitations(text: string): readonly string[] {
  MEMORY_CITE_RE.lastIndex = 0;
  const shortIds: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = MEMORY_CITE_RE.exec(text)) !== null) {
    const short = m[1]!;
    if (!seen.has(short)) {
      seen.add(short);
      shortIds.push(short);
    }
  }
  MEMORY_CITE_RE.lastIndex = 0;
  return shortIds;
}

/* ---------------- 回写挂件 ---------------- */

/** 引用回写挂件依赖（装配面注入——dao 单实现律） */
export interface CiteRecorderDeps {
  readonly dao: MemoryDao;
  /** 诊断位（尽力为止步日志——缺省吞） */
  readonly warn?: (message: string) => void;
}

/** 引用回写挂件（durable 事件消费面——装配面接线） */
export interface CiteRecorder {
  /**
   * 事件消费位（只认 assistant/message；其余类型零开销直过）。
   * sessionId = 事件信封会话键（流水归位）。
   */
  onEvent(sessionId: string | null, type: string, data: unknown): void;
}

/** 建引用回写挂件（装配面挂会话事件流——消费 idiom 同 18c-5 周期路） */
export function createCiteRecorder(deps: CiteRecorderDeps): CiteRecorder {
  const warn = deps.warn ?? (() => {});
  return {
    onEvent(sessionId, type, data) {
      if (type !== 'assistant/message') return;
      try {
        const text = assistantTextOf(data);
        if (text === null || text === '') return;
        const shorts = parseCitations(text);
        if (shorts.length === 0) return;
        // 前缀归责三态：零命中不进 shorts；多命中 = 歧义全部忽略；恰一命中 = 唯一归属
        const fullIds: string[] = [];
        for (const short of shorts) {
          const matches = deps.dao.resolveShortId(short);
          if (matches.length === 1) fullIds.push(matches[0]!);
        }
        if (fullIds.length > 0) deps.dao.markUsed(fullIds, sessionId);
      } catch (err) {
        warn(`[memory] 引用回写尽力而为止步：${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

/* ---------------- 纠正负效用回写（2026-09-08 消化批——06 §4 即时路第二动作） ---------------- */

/** 负效用回写 DAO 窄面（词面独立律——只消费归责与回写两法） */
export type CorrectedCitesDaoFace = Pick<MemoryDao, 'resolveShortId' | 'markCorrected'>;

/**
 * 纠正负效用回写（§4 即时路第二动作——§6 解析面**全复用**）：对被纠正回答的
 * 文本面解析引用标记（MEMORY_CITE_RE + 同消息同短 id 去重 = 守卫④「同事件
 * 一次」的物理承载）→ 前缀归责三态（与 cite 正账同律）→ dao.markCorrected
 * 批量（corrected_count+1 + op='corrected-cite' 流水带**纠正发生会话**键——
 * 守卫①③归 dao 语句本体）。尽力而为：全程 try/catch warn（计量面写点不
 * 反噬提取主路——两动作失败路径分立的回写侧保障）。
 */
export function recordCorrectedCites(
  dao: CorrectedCitesDaoFace,
  sessionId: string,
  assistantText: string,
  warn: (message: string) => void = () => {},
): void {
  try {
    const shorts = parseCitations(assistantText);
    if (shorts.length === 0) return;
    const fullIds: string[] = [];
    for (const short of shorts) {
      const matches = dao.resolveShortId(short);
      if (matches.length === 1) fullIds.push(matches[0]!);
    }
    if (fullIds.length > 0) dao.markCorrected(fullIds, sessionId);
  } catch (err) {
    warn(`[memory] 纠正负效用回写尽力而为止步：${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * per-session 最近 assistant 文本回看缓存（§4 回看位实现——装配面同一
 * session/event 消费点内喂入，零新事件通道零宿主改动；LRU 帽族同 §6 epochs）。
 * **紧邻前一条语义忠实**：每次 assistant/message 到达即覆写该会话条目——
 * 空文本面（纯 toolCall/thinking 消息）同覆写为 ''，回看自然空手（跨条回看
 * 无判据不发明）。读即触位（紧随其后的纠正回看高频——保热会话不被挤）。
 */
export function createLastAssistantTextCache(capacity: number = MEMORY_LAST_ASSISTANT_TEXT_LRU): {
  /** 喂入腿（assistant/message 事件到达拍） */
  observe(sessionId: string, data: unknown): void;
  /** 回看腿（§4 纠正命中拍——缺席会话回 null） */
  get(sessionId: string): string | null;
} {
  const cache = new Map<string, string>();
  return {
    observe(sessionId, data) {
      const text = assistantTextOf(data) ?? '';
      cache.delete(sessionId); // 先删再插 = 触位到 Map 尾（最近）
      cache.set(sessionId, text);
      if (cache.size > capacity) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    },
    get(sessionId) {
      const text = cache.get(sessionId);
      if (text === undefined) return null;
      cache.delete(sessionId);
      cache.set(sessionId, text);
      return text;
    },
  };
}
