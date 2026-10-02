/**
 * TUI 件 — 流中 token 估值器（07 §4.1 注⑪⑥c——V-4 底栏供数链第三件）。
 *
 * 机制：message_update 载荷 partial 是累计快照（stream.ts 就地替换律——流中
 * 每事件的 partial 即累计快照，非增量），估值器持上一快照字符账做**尾块
 * 差分**（本次总量 − 上次总量，逐道 clamp ≥0——回退帧零回摆），差分累加进
 * 本轮账。字符 → token 双道启发式：CJK 字符按 1 token/字、其他字符按
 * 4 字符/token（英文中位）；**呈现层估值非计费账**——真值归 message_end
 * 载荷 usage（onSettled 校正，单次收敛不回跳），计费真源维持 usage 四桶
 * 不动。消费面（一机制喂两槽）：件 12「本轮 N」实时叠加 + 行1 速度平滑。
 */
import type { AgentMessage } from '../../../contracts/index.js';

/** 估值器读面（消费侧只读——件 12 / 行1 速度两槽共用） */
export interface StreamingTokenEstimator {
  /** message_update 快照喂入（尾块差分——累计快照不重算全文） */
  onUpdate(partial: AgentMessage): void;
  /** message_end 真值校正（usage.output——校正后读数恒真值，后续喂入不回摆） */
  onSettled(usage: { output: number }): void;
  /** 当前估值（真值在场后恒真值） */
  estimate(): number;
  /** 本轮重置（下一 turn 起跑——基线重建） */
  reset(): void;
}

/** CJK 判定（一致表意区 + CJK 符号/全角区——呈现层启发式粒度足矣；转义形防字面量编码漂移） */
const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

/** 快照字符账（双道——CJK 与其他分开累计，两道启发式参数不同） */
interface CharTally {
  cjk: number;
  other: number;
}

/** 快照全量字符账（text/thinking 块照计——输出侧含推理，usage.output 口径同向；thinking 块字段名 = thinking；toolCall 参数不计——真值收口） */
function tallyOf(partial: AgentMessage): CharTally {
  let cjk = 0;
  let other = 0;
  const content = (partial as { content?: unknown }).content;
  if (!Array.isArray(content)) return { cjk, other };
  for (const block of content) {
    const b = block as { type?: string; text?: string; thinking?: string };
    if (b.type !== 'text' && b.type !== 'thinking') continue;
    const chunk = b.type === 'text' ? b.text : b.thinking;
    for (const ch of chunk ?? '') {
      if (CJK_RE.test(ch)) cjk += 1;
      else other += 1;
    }
  }
  return { cjk, other };
}

/** 双道启发式：CJK 1 token/字 + 其他 ceil(n/4) tokens（向上取整） */
function tokensOf(tally: CharTally): number {
  return tally.cjk + Math.ceil(tally.other / 4);
}

/** 造流中 token 估值器（07 §4.1 注⑪⑥c——呈现层估值非计费账） */
export function createStreamingTokenEstimator(): StreamingTokenEstimator {
  let prev: CharTally | null = null;
  let acc: CharTally = { cjk: 0, other: 0 };
  let settled: number | undefined;
  return {
    onUpdate(partial) {
      if (settled !== undefined) return; // 真值已收口——后续喂入零效（turn 已结束防御位）
      const cur = tallyOf(partial);
      if (prev !== null) {
        // 差分形（累计快照不重算全文——重算形在快照回退时会回摆，差分形零回摆）
        acc = {
          cjk: acc.cjk + Math.max(0, cur.cjk - prev.cjk),
          other: acc.other + Math.max(0, cur.other - prev.other),
        };
      } else {
        acc = { ...cur }; // 首快照全量入账（本轮输出从头起算）
      }
      prev = cur;
    },
    onSettled(usage) {
      settled = usage.output;
    },
    estimate() {
      return settled ?? tokensOf(acc);
    },
    reset() {
      prev = null;
      acc = { cjk: 0, other: 0 };
      settled = undefined;
    },
  };
}
