/**
 * 词级 diff 纯函数测试（批 10i R4——对拍表直锁）。
 *
 * 覆盖：diffWords 串接还原律（same/del/add 段拼回 a/b）、对拍表四形（全同/
 * 全异/词级换字/前后缀锚定）、parsePatchLines 判形四类（meta 优先级/± 前缀
 * 剥离/上下文/空行）。
 */
import { describe, expect, it } from 'vitest';
import { diffWords, parsePatchLines } from './word-diff.js';

/** 段族拼接（kind 过滤形——del 行拼 a、add 行拼 b） */
const joinKind = (segs: readonly { kind: string; text: string }[], kinds: readonly string[]): string =>
  segs
    .filter((s) => kinds.includes(s.kind))
    .map((s) => s.text)
    .join('');

describe('diffWords 词级 LCS', () => {
  it('串接还原律：same+del 拼回 a、same+add 拼回 b（对拍表四形恒成立）', () => {
    const pairs: Array<readonly [string, string]> = [
      ['完全相同的一句话', '完全相同的一句话'], // 全同——零 del/add
      ['abc', 'xyz'], // 全异——零 same
      ['把旧词换成新词了', '把旧词换成另词了'], // 词级换字
      ['前缀锚定 suffix 尾', '前缀锚定 other 尾'], // 前后缀锚定
      ['', '从空生出'], // a 空全 add
      ['归于空', ''], // b 空全 del
    ];
    for (const [a, b] of pairs) {
      const segs = diffWords(a, b);
      expect(joinKind(segs, ['same', 'del'])).toBe(a);
      expect(joinKind(segs, ['same', 'add'])).toBe(b);
    }
  });

  it('对拍表：换字形产出三类段且变字段恰为差异词', () => {
    const segs = diffWords('把旧词换成新词了', '把旧词换成另词了');
    // '新' → '另'：same 段两侧锚定 + 单字 del/add 段
    expect(segs.some((s) => s.kind === 'same' && s.text.startsWith('把旧词换成'))).toBe(true);
    expect(segs).toContainEqual({ kind: 'del', text: '新' });
    expect(segs).toContainEqual({ kind: 'add', text: '另' });
    // 相邻同类弥合：同类段不连续出现
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.kind).not.toBe(segs[i - 1]!.kind);
  });

  it('英文词界形：词级粒度（非字符级）', () => {
    const segs = diffWords('fix the bug now', 'fix the bug later');
    expect(segs).toContainEqual({ kind: 'del', text: 'now' });
    expect(segs).toContainEqual({ kind: 'add', text: 'later' });
    expect(joinKind(segs, ['same'])).toContain('fix the bug');
  });

  it('全同零差异段（单 same 段或空段族）', () => {
    const segs = diffWords('一字不差', '一字不差');
    expect(segs.filter((s) => s.kind !== 'same')).toEqual([]);
  });
});

describe('parsePatchLines patch 判形', () => {
  it('四类判形 + ± 前缀剥离 + meta 优先', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: a.ts',
      ' ctx line',
      '-old line',
      '+new line',
      '*** End Patch',
    ].join('\n');
    expect(parsePatchLines(patch)).toEqual([
      { kind: 'meta', text: '*** Begin Patch' },
      { kind: 'meta', text: '*** Update File: a.ts' },
      { kind: 'ctx', text: ' ctx line' },
      { kind: 'del', text: 'old line' },
      { kind: 'add', text: 'new line' },
      { kind: 'meta', text: '*** End Patch' },
    ]);
  });

  it('空行归上下文（体行保形）', () => {
    const lines = parsePatchLines('a\n\n+b');
    expect(lines[1]).toEqual({ kind: 'ctx', text: '' });
    expect(lines[2]).toEqual({ kind: 'add', text: 'b' });
  });
});
