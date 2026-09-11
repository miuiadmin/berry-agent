/**
 * compaction/ccr 测试 — CCR 可逆压缩纯函数件（05 §2.1「压缩可逆性 CCR」子节）。
 *
 * 覆盖三面：归档哈希（确定性 / seq 敏感 / 键序不敏感）、标记段（追加形 /
 * 剥离形 / 往返）、目录重建（时间序 / 批前缺位跳过 / 非法载荷防御跳过）。
 * 迭代链剥离（previousSummaryText × CCR 段）在此对拍——policy 件的 CCR
 * 消费行为单源在此锁定。
 */
import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import type { ProjectedMessage } from '../session/index.js';
import { previousSummaryText, SUMMARY_PREFIX } from './policy.js';
import { ccrDirectoryOf, ccrHashOf, stripCcrSection, withCcrSection } from './ccr.js';

/* ---------------- 测试构造件 ---------------- */

/** 手工事件（ccrDirectoryOf 纯函数测试——不走 SessionLog 全真） */
function ev(
  seq: number,
  type: string,
  data: unknown,
  surfaceOp?: { op: 'replace'; start: number; end: number },
): SessionEvent {
  return { seq, type, time: 1_000 + seq, data, ...(surfaceOp ? { surfaceOp } : {}) };
}

/** 最小投影消息（哈希源测试——只关心 seq 与内容的形状稳定） */
function umsg(seq: number, text: string): ProjectedMessage {
  return { type: 'user', seq, content: text };
}

/** 目录条目速构 */
const entry = (hash: string, messages: number, chars: number) => ({ hash, messages, chars });

/* ---------------- 归档哈希 ccrHashOf ---------------- */

describe('ccrHashOf 归档哈希', () => {
  it('确定性：同序列同哈希（两次独立调用一致）', () => {
    const occluded = [umsg(5, '任务指令 2'), umsg(7, '回答 2')];
    expect(ccrHashOf(occluded)).toBe(ccrHashOf(occluded));
  });

  it('形定值：sha256 前 16 hex 小写', () => {
    expect(ccrHashOf([])).toMatch(/^[0-9a-f]{16}$/);
    expect(ccrHashOf([umsg(1, 'x')])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('seq 敏感：同内容异 seq 即异哈希（fork 平移后同内容不同档——M4 定形）', () => {
    const a = ccrHashOf([umsg(5, '同文'), umsg(7, '同答')]);
    const b = ccrHashOf([umsg(9, '同文'), umsg(11, '同答')]);
    expect(a).not.toBe(b);
  });

  it('键序不敏感：同字段异插入序同哈希（投影构造路径键序天然可异）', () => {
    const ordered = { type: 'user', seq: 5, content: '文本' } as ProjectedMessage;
    const shuffled = { content: '文本', seq: 5, type: 'user' } as unknown as ProjectedMessage;
    expect(ccrHashOf([ordered])).toBe(ccrHashOf([shuffled]));
  });

  it('空序列也有定值哈希（空区间防御形不特判）', () => {
    expect(ccrHashOf([])).toBe(ccrHashOf([]));
  });
});

/* ---------------- 标记段 withCcrSection / stripCcrSection ---------------- */

describe('标记段追加 withCcrSection', () => {
  it('空目录原样返回（无 surface 可列——防御形）', () => {
    expect(withCcrSection('摘要正文', [])).toBe('摘要正文');
  });

  it('单条：正文 + 空行 + 标记行（形：<<ccr:HASH>> 原文已归档（N 条消息 / M 字符））', () => {
    const text = withCcrSection('摘要正文', [entry('aaaaaaaaaaaaaaaa', 4, 287)]);
    expect(text).toBe(`摘要正文\n\n<<ccr:aaaaaaaaaaaaaaaa>> 原文已归档（4 条消息 / 287 字符）`);
  });

  it('目录恒链：多条按时间序全列（当次条目由调用方末位并入）', () => {
    const text = withCcrSection('摘要正文', [entry('bbbbbbbbbbbbbbbb', 4, 287), entry('cccccccccccccccc', 8, 590)]);
    const lines = text.split('\n');
    expect(lines).toEqual([
      '摘要正文',
      '',
      `<<ccr:bbbbbbbbbbbbbbbb>> 原文已归档（4 条消息 / 287 字符）`,
      `<<ccr:cccccccccccccccc>> 原文已归档（8 条消息 / 590 字符）`,
    ]);
  });
});

describe('标记段剥离 stripCcrSection', () => {
  it('无标记行原样返回（CCR 批前载体兼容）', () => {
    expect(stripCcrSection('纯摘要正文\n第二行')).toBe('纯摘要正文\n第二行');
  });

  it('首条标记行起截断 + trimEnd（目录多行一并剥除）', () => {
    const carrier = `摘要正文\n\n<<ccr:aaaaaaaaaaaaaaaa>> 原文已归档（4 条消息 / 287 字符）\n<<ccr:bbbbbbbbbbbbbbbb>> 原文已归档（8 条消息 / 590 字符）`;
    expect(stripCcrSection(carrier)).toBe('摘要正文');
  });

  it('正文尾随空行也剥净（往返 = 原正文）', () => {
    expect(stripCcrSection('摘要正文\n\n\n<<ccr:aaaaaaaaaaaaaaaa>> x')).toBe('摘要正文');
  });

  it('往返：withCcrSection 剥回原正文', () => {
    const body = '任务概述…\n关键决策…';
    const carrier = withCcrSection(body, [entry('aaaaaaaaaaaaaaaa', 4, 287)]);
    expect(stripCcrSection(carrier)).toBe(body);
  });

  it('行首锚定：正文中间出现 <<ccr: 字样但非行首不误伤', () => {
    // 行首前缀判据（startsWith）——文内引用标记（非行首）不是机制段
    expect(stripCcrSection('正文提到标记形如 <<ccr:xxx>> 但不在行首\n第二行')).toBe(
      '正文提到标记形如 <<ccr:xxx>> 但不在行首\n第二行',
    );
  });
});

/* ---------------- 目录重建 ccrDirectoryOf ---------------- */

describe('目录重建 ccrDirectoryOf', () => {
  it('surface 事件全量提取（时间序 = 事件序保真）', () => {
    const events = [
      ev(1, 'turn/start', {}),
      ev(5, 'user/message', { content: 'x' }),
      ev(
        10,
        'compaction/surface',
        { ccrHash: 'aaaaaaaaaaaaaaaa', occludedMessages: 4, occludedChars: 287 },
        { op: 'replace', start: 4, end: 9 },
      ),
      ev(11, 'user/message', { content: 'y' }),
      ev(
        20,
        'compaction/surface',
        { ccrHash: 'cccccccccccccccc', occludedMessages: 8, occludedChars: 590 },
        { op: 'replace', start: 12, end: 19 },
      ),
    ];
    expect(ccrDirectoryOf(events)).toEqual([
      { hash: 'aaaaaaaaaaaaaaaa', messages: 4, chars: 287 },
      { hash: 'cccccccccccccccc', messages: 8, chars: 590 },
    ]);
  });

  it('批前历史事件（ccrHash 缺位）不列——无检索键不可回取（M6）', () => {
    const events = [
      ev(
        10,
        'compaction/surface',
        { summarySeq: 9, occludedMessages: 4, occludedChars: 287 },
        { op: 'replace', start: 4, end: 9 },
      ),
      ev(
        20,
        'compaction/surface',
        { ccrHash: 'cccccccccccccccc', occludedMessages: 8, occludedChars: 590 },
        { op: 'replace', start: 12, end: 19 },
      ),
    ];
    expect(ccrDirectoryOf(events)).toEqual([{ hash: 'cccccccccccccccc', messages: 8, chars: 590 }]);
  });

  it('载荷形态非法（非 string 哈希 / 非数数量）防御跳过', () => {
    const events = [
      ev(
        10,
        'compaction/surface',
        { ccrHash: 123, occludedMessages: 4, occludedChars: 287 },
        { op: 'replace', start: 4, end: 9 },
      ),
      ev(
        14,
        'compaction/surface',
        { ccrHash: 'dddddddddddddddd', occludedMessages: 'x', occludedChars: 590 },
        { op: 'replace', start: 11, end: 13 },
      ),
      ev(
        18,
        'compaction/surface',
        { ccrHash: 'eeeeeeeeeeeeeeee', occludedMessages: 2 },
        { op: 'replace', start: 15, end: 17 },
      ),
    ];
    expect(ccrDirectoryOf(events)).toEqual([]);
  });

  it('非 surface 事件不参与（孤儿摘要 user/message 无映射不入目录——M2）', () => {
    const events = [
      ev(9, 'user/message', { content: `${SUMMARY_PREFIX} 孤儿摘要`, source: 'compaction' }),
      ev(10, 'compaction/end', { reason: 'completed' }),
    ];
    expect(ccrDirectoryOf(events)).toEqual([]);
  });
});

/* ---------------- 迭代链 × CCR 段（policy 件的 CCR 消费行为） ---------------- */

describe('previousSummaryText × CCR 段剥离', () => {
  it('前次载体含 CCR 标记段：只取摘要正文（目录行是机制噪声非摘要素材）', () => {
    const events = [
      ev(5, 'user/message', { content: '普通消息', source: 'user' }),
      ev(9, 'user/message', {
        content: `${SUMMARY_PREFIX} 摘要正文第二版\n\n<<ccr:aaaaaaaaaaaaaaaa>> 原文已归档（4 条消息 / 287 字符）\n<<ccr:bbbbbbbbbbbbbbbb>> 原文已归档（8 条消息 / 590 字符）`,
        source: 'compaction',
      }),
    ];
    expect(previousSummaryText(events)).toBe('摘要正文第二版');
  });

  it('批前载体（无标记段）原样兼容', () => {
    const events = [ev(9, 'user/message', { content: `${SUMMARY_PREFIX} 批前摘要正文`, source: 'compaction' })];
    expect(previousSummaryText(events)).toBe('批前摘要正文');
  });

  it('无前次摘要返回 null', () => {
    const events = [ev(5, 'user/message', { content: '普通消息', source: 'user' })];
    expect(previousSummaryText(events)).toBeNull();
  });
});
