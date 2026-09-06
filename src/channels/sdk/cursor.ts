/**
 * after 游标对账纯函数（03 篇 §10.6 线协议七原则③ + 05 篇 §3.5 第一腿——
 * durable seq + after 游标 / 崩溃重连对账 / 重放-直播衔接序）。
 *
 * 高水位约定（与 ./protocol.ts 文件头单源同律）：**highWaterSeq = 会话日志当前
 * 长度**（= 下一将分配 seq；既存末条 seq = highWaterSeq − 1；空会话 = 0）。
 *
 * 两执法句在该约定下的形态：
 * - 调用方已收末 seq ≥ 高水位 ⇒ 尾被截（撕裂尾截断后 seq 按 log.length 重编
 *   **复用**——调用方已收的尾段 seq 在恢复后日志中不存在或被同号异容复用）；
 * - `after=N` ≥ 高水位 ⇒ 游标非法（N 越过既存末条 = 声称已收不存在的事件；
 *   含空会话 after=0 档——新会话订阅应缺席 after）。
 * 两档同码 `SDK_CURSOR_INVALID`，调用方从头（或 getEntries）重对账——消费侧
 * 幂等以 dedupeKey 兜底，at-least-once 边界如实。
 */

/** 游标对账判定（ok=false 携错误码与报因——调用方落 SDK_CURSOR_INVALID 错误帧） */
export type CursorCheck =
  { ok: true } | { ok: false; code: 'SDK_CURSOR_INVALID'; reason: 'beyond-high-water' | 'tail-truncated' };

/**
 * 校验订阅/重放游标 after 的合法性（hello.after 与 getEntries.since 同语义）。
 *
 * 合法 ⇔ after < highWaterSeq（重放窗口 = (after, highWaterSeq]；after 恰为
 * 既存末条 seq = 完全追平档——窗口空、直接进直播，亦合法）。
 */
export function validateAfterCursor(after: number, highWaterSeq: number): CursorCheck {
  if (after >= highWaterSeq) {
    return { ok: false, code: 'SDK_CURSOR_INVALID', reason: 'beyond-high-water' };
  }
  return { ok: true };
}

/**
 * 崩溃重连尾截断侦测（05 §3.5 崩溃重连对账条——hello/ack 携高水位的消费侧）。
 *
 * @param lastReceivedSeq 调用方已收末条 seq（无对账面〔首连〕传 undefined——恒 ok）
 * @param highWaterSeq 服务端 hello/ack 携带的会话当前高水位
 * @returns 已收末 seq ≥ 高水位 ⇒ 尾被截（含 ==：声称知道下一将分配 seq 同为
 *   幻影——撕裂截断后 seq 复用使等值也歧义，保守同码）
 */
export function detectTailTruncation(lastReceivedSeq: number | undefined, highWaterSeq: number): CursorCheck {
  if (lastReceivedSeq === undefined) return { ok: true };
  if (lastReceivedSeq >= highWaterSeq) {
    return { ok: false, code: 'SDK_CURSOR_INVALID', reason: 'tail-truncated' };
  }
  return { ok: true };
}

/**
 * 重放-直播衔接序定位（05 §3.5 衔接序第 ③ 步——**落码回归锁位**函数化）：
 * 直播起播 = 内存日志中 seq > 重放尾（lastReplayedSeq）的首条（含未落库在飞
 * 事件）。重放尾与直播首无缝衔接 = 衔接完整性验收位，测试在册。
 *
 * @param log 会话内存日志（seq 单调连续升序——05 §1.1 写入序不变式）
 * @param lastReplayedSeq 重放段末条 seq（空重放 = after 原值或 −1）
 * @returns 直播起播下标（log.length = 重放已覆盖全部内存日志——直播等新事件）
 */
export function resolveLiveStart<T extends { seq: number }>(log: readonly T[], lastReplayedSeq: number): number {
  const index = log.findIndex((entry) => entry.seq > lastReplayedSeq);
  return index === -1 ? log.length : index;
}
