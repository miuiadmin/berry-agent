/**
 * 崩溃恢复协议（05 篇 §4——恢复 = 重放 + 合成 closer）。
 *
 * 纯函数：对一份事件日志做配对扫描，产出需要 append 的合成收形事件草稿
 * （type/data/time——seq 与信封由 append 流水线注入；time 复用最后真实事件
 * 的时间戳 = 合成标记的一半，另一半是结构占位语义码）。
 *
 * 事实/意图分离：恢复合成物与真实事件在投影同权、在审计可辨——「日志里有的
 * 都真实发生过，合成的是收形不是历史」。
 */
import type { TurnEndReason } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';

/** 合成事件草稿（append 面：SessionLog.appendSynthetic 消费） */
export interface SyntheticDraft {
  readonly type: string;
  readonly data: unknown;
  /** 复用最后真实事件的时间戳（确定性——重放同日志产出同合成物） */
  readonly time: number;
}

/** 孤儿 tool/call 的占位语义码（05 §4——按「崩溃前是否已开始执行」二分） */
export const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED';
export const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN';

/**
 * 配对扫描 + closer 合成（单遍从头扫——05 §4 步 5「配对完整性是全日志属性，
 * 不设窗口；增量恢复优化不做，正确性面前不省这点」）：
 *  - 孤儿 tool/call（有 call 无 result）：合成 tool/result——执行证据 =
 *    守门 gate/decision 是否在场（在场 = 已开始执行 OUTCOME_UNKNOWN / 缺席 =
 *    NOT_STARTED）。gate/decision 按全日志 toolCallId 索引（决策可能晚于崩溃
 *    前最后一刻才落——全日志扫描是保守完备面）；
 *  - 未闭合压缩对（compaction/start 无 end）：合成 compaction/end
 *    （reason='aborted'）——孤 start 与孤儿摘要（摘要已落、遮蔽指令未落）
 *    两子形态都收形；孤儿摘要是合法 surface 事件无需处置（按普通
 *    user/message 同视）；
 *  - 未闭合 turn：合成 turn/end（reason='interrupted'）——嵌套场景按深度
 *    补 N 条（05 §4 步 4 深度计数）。
 * 合成序：result 们 → compaction/end 们 → turn/end 们（日志合法性：turn
 * 闭合必后于其内一切内容）。
 */
export function recoverClosers(events: readonly SessionEvent[]): SyntheticDraft[] {
  // gate/decision 的 toolCallId 索引（执行证据位——按 data.toolCallId 字段）
  const gatedCallIds = new Set<string>();
  // tool 配对状态：call 出现序记录 id；result 到达即摘
  const pendingCallIds: string[] = [];
  const settledCallIds = new Set<string>();
  // 压缩对状态：start 计数（end 到达减计；嵌套压缩不合法但容错计数）
  let compactionDepth = 0;
  // turn 深度计数
  let turnDepth = 0;

  for (const event of events) {
    switch (event.type) {
      case 'tool/call': {
        const id = (event.data as { toolCallId?: unknown } | null)?.toolCallId;
        if (typeof id === 'string') pendingCallIds.push(id);
        break;
      }
      case 'tool/result': {
        const id = (event.data as { toolCallId?: unknown } | null)?.toolCallId;
        if (typeof id === 'string') settledCallIds.add(id);
        break;
      }
      case 'gate/decision': {
        const id = (event.data as { toolCallId?: unknown } | null)?.toolCallId;
        if (typeof id === 'string') gatedCallIds.add(id);
        break;
      }
      case 'compaction/start':
        compactionDepth += 1;
        break;
      case 'compaction/end':
        if (compactionDepth > 0) compactionDepth -= 1;
        break;
      case 'turn/start':
        turnDepth += 1;
        break;
      case 'turn/end':
        if (turnDepth > 0) turnDepth -= 1;
        break;
      default:
        break;
    }
  }

  // time 基准：最后一条真实事件的 time（日志空则 0——空日志无 closer 可言，防御位）
  const lastTime = events.length > 0 ? events[events.length - 1]!.time : 0;

  const drafts: SyntheticDraft[] = [];

  // ① 孤儿 tool/call → 合成 tool/result（对模型诚实占位——防 provider 拒绝未配对 tool_use）
  for (const id of pendingCallIds) {
    if (settledCallIds.has(id)) continue;
    const outcome = gatedCallIds.has(id) ? TOOL_OUTCOME_UNKNOWN : TOOL_NOT_STARTED;
    drafts.push({
      type: 'tool/result',
      data: { toolCallId: id, content: `${outcome}: session recovered before completion`, error: true },
      time: lastTime,
    });
  }

  // ② 未闭合压缩对 → 按深度合成 compaction/end（reason='aborted'——视为未发生，下次触发重做）
  for (let i = 0; i < compactionDepth; i++) {
    drafts.push({ type: 'compaction/end', data: { reason: 'aborted' }, time: lastTime });
  }

  // ③ 未闭合 turn → 按深度补 N 条 turn/end（reason='interrupted'）
  for (let i = 0; i < turnDepth; i++) {
    drafts.push({ type: 'turn/end', data: { reason: 'interrupted' satisfies TurnEndReason }, time: lastTime });
  }

  return drafts;
}

/**
 * 日志完整性预检（05 §4 步 1 的纯函数半边——seq 连续性；尾部残行 JSON 检测
 * 属物理层读侧，persist 落码时接线）。撕裂尾截断由调用方按本函数结果处置。
 * @returns 首个断点 seq（该位置事件 seq ≠ 期望值）——null = 连续
 */
export function firstSeqBreak(events: readonly SessionEvent[]): number | null {
  for (let i = 0; i < events.length; i++) {
    if (events[i]!.seq !== i) return i;
  }
  return null;
}
