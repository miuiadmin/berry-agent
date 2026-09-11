/**
 * compaction — CCR 可逆压缩纯函数件（05 §2.1「压缩可逆性 CCR」子节——2026-09-11
 * 立题批落码；立题档《00-立题-压缩可逆性CCR-20260911》+ 冷读闸 M1-M7 修订形）。
 *
 * 机制三面（第四面「两路一形」由 fiveStep 共用自动获得）：
 *  - 归档映射：ccrHashOf = sha256(遮蔽区间投影消息序列规范化 JSON——**含 seq
 *    位**〔冷读闸 M4：内容+序寻址，fork 平移后同内容异哈希；兑换按存储哈希
 *    匹配不重算比对〕) 前 16 hex。events 表即归档 store（零新增存储位）；
 *  - 标记段：摘要载体尾部 host 追加（非摘要算法产物）；当次标记行 + **目录
 *    恒链**（此前历次 surface 事件全量——旧载体被遮蔽后历史哈希仍可达）；
 *    文案不点名工具（冷读闸 M5：无工具面形态下点名即对模型的空承诺）；
 *  - 目录源：从 surface 事件重建（孤儿摘要无映射不入目录——冷读闸 M2 自愈
 *    三径之一）；CCR 批前历史事件 ccrHash 缺席不列（冷读闸 M6：无检索键
 *    不可回取）。
 *
 * 纯函数零 I/O（events 读面由调用方注入）。
 */
import { createHash } from 'node:crypto';
import type { SessionEvent } from '../contracts/index.js';
import type { ProjectedMessage } from '../session/index.js';

/** CCR 标记行前缀（<<ccr:HASH>> ——标记段构造与剥离的判据锚） */
export const CCR_MARKER_PREFIX = '<<ccr:';

/** 归档目录条目（surface 事件载荷三件的检索面形——05 §2.1 子节单源字段） */
export interface CcrDirectoryEntry {
  /** 归档哈希（sha256 前 16 hex） */
  readonly hash: string;
  /** 遮蔽消息条数 */
  readonly messages: number;
  /** 遮蔽字符量（与 fold.chars 同尺：逐消息 JSON 长度和） */
  readonly chars: number;
}

/**
 * 规范序列化：对象键递归排序的确定性 JSON（哈希源的单义形——ProjectedMessage
 * 构造路径键序天然可异，键序差不应改哈希；含 seq 位——冷读闸 M4 定形）。
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

/**
 * 归档哈希：遮蔽区间投影消息序列 → sha256 前 16 hex。
 * 确定性：同序列同哈希；seq 变（fork 平移/区间漂移）即异——兑换按存储哈希
 * 匹配、不重算比对（重算比对会在 fork 会话全数 miss）。
 */
export function ccrHashOf(occluded: readonly ProjectedMessage[]): string {
  return createHash('sha256').update(canonicalJson(occluded)).digest('hex').slice(0, 16);
}

/** 目录重建：surface 事件 → 检索面条目（seq 序 = 时间序；批前缺 ccrHash 位者跳过） */
export function ccrDirectoryOf(events: readonly SessionEvent[]): CcrDirectoryEntry[] {
  const entries: CcrDirectoryEntry[] = [];
  for (const event of events) {
    if (event.type !== 'compaction/surface') continue;
    const data = event.data as { ccrHash?: unknown; occludedMessages?: unknown; occludedChars?: unknown };
    // 兼容位（05 §1.1 ccrHash?）：CCR 批前历史事件缺席——无检索键不可回取，不列
    if (typeof data.ccrHash !== 'string') continue;
    if (typeof data.occludedMessages !== 'number' || typeof data.occludedChars !== 'number') continue;
    entries.push({ hash: data.ccrHash, messages: data.occludedMessages, chars: data.occludedChars });
  }
  return entries;
}

/** 标记行（单条）：`<<ccr:HASH>> 原文已归档（N 条消息 / M 字符）` */
function ccrMarkerLine(entry: CcrDirectoryEntry): string {
  return `${CCR_MARKER_PREFIX}${entry.hash}>> 原文已归档（${entry.messages} 条消息 / ${entry.chars} 字符）`;
}

/**
 * 标记段追加：摘要正文 + `\n\n` + 目录全量标记行（时间序，当次条目由调用方
 * 末位并入——目录恒链）。标记段不计入摘要预算（机制面固定开销非摘要正文）。
 */
export function withCcrSection(summaryBody: string, entries: readonly CcrDirectoryEntry[]): string {
  if (entries.length === 0) return summaryBody;
  return `${summaryBody}\n\n${entries.map(ccrMarkerLine).join('\n')}`;
}

/**
 * 标记段剥离：首条 `<<ccr:` 行起截断（previousSummaryText 迭代链消费——目录
 * 行是机制噪声非摘要素材）。无标记行原样返回（CCR 批前载体兼容）。
 */
export function stripCcrSection(text: string): string {
  const lines = text.split('\n');
  const cut = lines.findIndex((line) => line.startsWith(CCR_MARKER_PREFIX));
  if (cut === -1) return text;
  return lines.slice(0, cut).join('\n').trimEnd();
}
