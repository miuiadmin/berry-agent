/**
 * after 游标对账测试（03 §10.6 线协议③ + 05 §3.5 第一腿/崩溃重连对账/衔接序——
 * 批 13a）。
 *
 * 高水位约定（protocol.ts 文件头单源同律）：highWaterSeq = 日志当前长度
 * （空会话 = 0；既存末条 seq = highWaterSeq − 1）。
 */
import { describe, expect, it } from 'vitest';
import { detectTailTruncation, resolveLiveStart, validateAfterCursor } from './cursor.js';

describe('validateAfterCursor（订阅/重放游标合法性）', () => {
  it('after < 高水位 = ok（重放窗口 (after, 高水位]）', () => {
    expect(validateAfterCursor(2, 5)).toEqual({ ok: true });
  });

  it('after = 既存末条 seq = ok（完全追平档——窗口空、直接进直播）', () => {
    expect(validateAfterCursor(4, 5)).toEqual({ ok: true });
  });

  it('after ≥ 高水位 = SDK_CURSOR_INVALID / beyond-high-water（声称已收不存在的事件）', () => {
    expect(validateAfterCursor(5, 5)).toEqual({
      ok: false,
      code: 'SDK_CURSOR_INVALID',
      reason: 'beyond-high-water',
    });
    expect(validateAfterCursor(9, 5)).toEqual({
      ok: false,
      code: 'SDK_CURSOR_INVALID',
      reason: 'beyond-high-water',
    });
  });

  it('空会话档：高水位 0 时任何显式 after（含 0）均非法——新会话订阅应缺席 after', () => {
    expect(validateAfterCursor(0, 0).ok).toBe(false);
    expect(validateAfterCursor(7, 0).ok).toBe(false); // 同律：任何 after ≥ 0 = 越界
    expect(validateAfterCursor(0, 3).ok).toBe(true); // after 0 < 高水位 3——全量重放窗合法
    expect(validateAfterCursor(0, 1).ok).toBe(true); // 恰有 seq 0 一条——重放全量
  });
});

describe('detectTailTruncation（崩溃重连尾截断侦测——05 §3.5）', () => {
  it('首连（已收末 seq 缺席）恒 ok', () => {
    expect(detectTailTruncation(undefined, 0)).toEqual({ ok: true });
    expect(detectTailTruncation(undefined, 100)).toEqual({ ok: true });
  });

  it('已收末 seq < 高水位 = ok（尾完好）', () => {
    expect(detectTailTruncation(3, 5)).toEqual({ ok: true });
    expect(detectTailTruncation(4, 5)).toEqual({ ok: true }); // 恰追平（= 末条 seq）
  });

  it('已收末 seq ≥ 高水位 = SDK_CURSOR_INVALID / tail-truncated（撕裂截断后 seq 复用——等值也歧义，保守同码）', () => {
    expect(detectTailTruncation(5, 5)).toEqual({
      ok: false,
      code: 'SDK_CURSOR_INVALID',
      reason: 'tail-truncated',
    });
    expect(detectTailTruncation(7, 5)).toEqual({
      ok: false,
      code: 'SDK_CURSOR_INVALID',
      reason: 'tail-truncated',
    });
  });
});

describe('resolveLiveStart（重放-直播衔接序——05 §3.5 落码回归锁位）', () => {
  const log = [0, 1, 2, 3, 4, 5, 6, 7].map((seq) => ({ seq }));

  it('直播起播 = 内存日志中 seq > 重放尾的首条下标', () => {
    expect(resolveLiveStart(log, 4)).toBe(5); // seq 5 首条 > 4
  });

  it('空重放（尾 −1）起播下标 0', () => {
    expect(resolveLiveStart(log, -1)).toBe(0);
  });

  it('重放尾 = 末条 seq：起播 = length（直播等新事件）', () => {
    expect(resolveLiveStart(log, 7)).toBe(log.length);
  });

  it('重放尾越过内存末（重放含库有内存无的旧段）：起播 = length', () => {
    expect(resolveLiveStart(log, 99)).toBe(log.length);
  });

  it('空日志：恒 0', () => {
    expect(resolveLiveStart([], -1)).toBe(0);
    expect(resolveLiveStart([], 5)).toBe(0);
  });

  it('衔接完整性不变式：起播条 seq 恰 = 重放尾 + 1（seq 单调连续——无缝衔接零丢零重）', () => {
    for (let tail = -1; tail < log.length; tail++) {
      const start = resolveLiveStart(log, tail);
      if (start < log.length) {
        expect(log[start]!.seq).toBe(tail + 1);
      } else {
        expect(start).toBe(log.length);
      }
    }
  });
});
