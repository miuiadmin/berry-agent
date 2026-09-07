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
 */
import type { MemoryDao } from './dao.js';
import { MEMORY_CITE_RE } from './inject.js';

/* ---------------- 文本面提取 ---------------- */

/**
 * assistant/message durable data 文本提取（wiring 落 data.content =
 * (text|thinking 块)[]——toolCall 块不内联；引用只发生在 text 块呈现面，
 * thinking 块天然排除）。坏形返回 null（消费侧静默跳过——尽力而为）。
 */
function assistantTextOf(data: unknown): string | null {
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
