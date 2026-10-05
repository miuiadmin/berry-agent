/**
 * contracts/ccr-marker 纯件测试（B2 批 2——构造/解析往返 + 末条提取律）。
 * 格式知识单源律的测试面锁：构造形与逆解析形逐段对齐（改格式必红两侧）。
 */
import { describe, expect, it } from 'vitest';
import {
  CCR_MARKER_PREFIX,
  ccrMarkerLine,
  lastCcrEntryOf,
  parseCcrMarkerLine,
  type CcrDirectoryEntry,
} from './ccr-marker.js';

const entry = (hash: string, messages: number, chars: number): CcrDirectoryEntry => ({ hash, messages, chars });

describe('ccrMarkerLine 构造', () => {
  it('格式逐段：前缀 + hash + 固定文案两数位', () => {
    expect(ccrMarkerLine(entry('abcdef0123456789', 5, 287))).toBe(
      '<<ccr:abcdef0123456789>> 原文已归档（5 条消息 / 287 字符）',
    );
    expect(CCR_MARKER_PREFIX).toBe('<<ccr:');
  });

  it('零值形（空区间防御位——构造面不拒，解析面对称收）', () => {
    expect(ccrMarkerLine(entry('0000000000000000', 0, 0))).toBe(
      '<<ccr:0000000000000000>> 原文已归档（0 条消息 / 0 字符）',
    );
  });
});

describe('parseCcrMarkerLine 逆解析', () => {
  it('往返：构造 → 解析回原条目', () => {
    for (const e of [
      entry('abcdef0123456789', 5, 287),
      entry('ffffffffffffffff', 12, 3456),
      entry('0'.repeat(16), 1, 2),
    ]) {
      expect(parseCcrMarkerLine(ccrMarkerLine(e))).toEqual(e);
    }
  });

  it('坏形宽容 null（不抛）：非标记行 / 前缀近似 / 文案漂移 / 大写 hash', () => {
    expect(parseCcrMarkerLine('普通正文行')).toBeNull();
    expect(parseCcrMarkerLine('缩进 <<ccr:abcdef0123456789>> 原文已归档（5 条消息 / 287 字符）')).toBeNull(); // 行首锚
    expect(parseCcrMarkerLine('<<ccr:abcdef0123456789>> 原文已归档（5 条消息 / 287 字符）尾巴')).toBeNull(); // 行尾锚
    expect(parseCcrMarkerLine('<<ccr:ABCDEF0123456789>> 原文已归档（5 条消息 / 287 字符）')).toBeNull(); // hash 域小写
    expect(parseCcrMarkerLine('<<ccr:abcdef0123456789>> 原文已归档 (5 条消息 / 287 字符)')).toBeNull(); // 全角括号域
    expect(parseCcrMarkerLine('')).toBeNull();
  });
});

describe('lastCcrEntryOf 载体末条提取', () => {
  it('单条目录：正文 + 标记段末行 → 当次条目', () => {
    const text = '[COMPACTION-SUMMARY] 摘要正文\n\n<<ccr:abcdef0123456789>> 原文已归档（5 条消息 / 287 字符）';
    expect(lastCcrEntryOf(text)).toEqual(entry('abcdef0123456789', 5, 287));
  });

  it('目录恒链：末条即当次（写入序当次条目在末位的既定序）', () => {
    const text =
      '摘要正文\n\n' +
      `${ccrMarkerLine(entry('bbbbbbbbbbbbbbbb', 4, 287))}\n` +
      ccrMarkerLine(entry('cccccccccccccccc', 8, 590));
    expect(lastCcrEntryOf(text)).toEqual(entry('cccccccccccccccc', 8, 590));
  });

  it('正文回声近似形不误伤：回声行不解析（整行严格匹配），真标记行照常提取', () => {
    const text = '摘要提到形如 <<ccr:abcdef0123456789>> 的锚\n\n' + ccrMarkerLine(entry('1234567890abcdef', 3, 99));
    expect(lastCcrEntryOf(text)).toEqual(entry('1234567890abcdef', 3, 99));
  });

  it('CCR 批前历史载体（无标记段）→ null（消费面降级形判据）', () => {
    expect(lastCcrEntryOf('[COMPACTION-SUMMARY] 老载体只有正文')).toBeNull();
    expect(lastCcrEntryOf('')).toBeNull();
  });
});
