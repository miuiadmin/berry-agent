/**
 * CCR 标记行格式单源（05 §2.1「压缩可逆性 CCR」子节——构造与解析双面同源）。
 * 原居 compaction/ccr.ts，2026-10-05 ZCode TUI 对标批 B组 B2 批 2 迁入：
 * 呈现层（channels/tui transcript 压缩时间线分隔行——N 数解析面）与写入面
 * （compaction/ccr.ts 标记段构造）双消费所需；MODULE_EDGES 无
 * channels→compaction 边（边表真源 02 §4.1），durations / tool-face 同律
 * **零依赖纯件居 contracts**（跨模块双消费零新边）。
 *
 * 格式（写入面 ccrMarkerLine 单源构造）：`<<ccr:HASH>> 原文已归档（N 条消息 / M 字符）`
 * ——本件同时供出逆函数 parseCcrMarkerLine（呈现层解析不复刻格式串）与
 * lastCcrEntryOf（载体正文末条目录行提取——目录恒链当次条目在末位的既定序）。
 */

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

/** 标记行（单条）：`<<ccr:HASH>> 原文已归档（N 条消息 / M 字符）` */
export function ccrMarkerLine(entry: CcrDirectoryEntry): string {
  return `${CCR_MARKER_PREFIX}${entry.hash}>> 原文已归档（${entry.messages} 条消息 / ${entry.chars} 字符）`;
}

/**
 * 标记行逆解析（构造函数 ccrMarkerLine 的严格逆——格式知识单源，呈现层
 * 解析零复刻格式串）。非标记行 / 坏形返回 null（宽容不抛：模型可在摘要
 * 正文回声近似形，判据 = 整行严格匹配）。
 */
export function parseCcrMarkerLine(line: string): CcrDirectoryEntry | null {
  // 与 ccrMarkerLine 构造形逐段对齐：前缀 + 16 位小写 hex + 固定文案两数位
  const m = /^<<ccr:([0-9a-f]+)>> 原文已归档（(\d+) 条消息 \/ (\d+) 字符）$/.exec(line);
  if (m === null) return null;
  return { hash: m[1]!, messages: Number(m[2]), chars: Number(m[3]) };
}

/**
 * 载体正文末条目录条目提取：逐行扫描取**最后一条**可解析标记行（写入序
 * 目录恒链当次条目在末位——末条即当次归档规模；倒扫首条同值，正扫末条与
 * 「模型在正文前段回声标记形」的鲁棒性取舍一致：正文回声在后也误伤，取
 * 严格末位是既定序的最强锚）。无标记行（CCR 批前历史载体）返回 null——
 * 消费面降级呈现（无 N 形）。
 */
export function lastCcrEntryOf(text: string): CcrDirectoryEntry | null {
  let last: CcrDirectoryEntry | null = null;
  for (const line of text.split('\n')) {
    const parsed = parseCcrMarkerLine(line);
    if (parsed !== null) last = parsed;
  }
  return last;
}
