/**
 * 视觉行映射直锁单测（visual-lines 纯函数面）：硬折双坐标（UTF-16 长 +
 * 显示宽）/ CJK 双宽整字下移不产半字 / 字素家族（emoji 代理对 / ZWJ）跨行
 * 不撕裂 / 行尾光标归属末段 / 显示列反查半字防线 / 前缀宽 / 字素边界算术 /
 * 空串与护栏越界形（width ≤ 0 防御、col 超尾、空 map 回退）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildVisualLineMap,
  colAtDisplayColumn,
  findVisualLineAt,
  nextGraphemeBoundary,
  prefixDisplayWidth,
  prevGraphemeBoundary,
} from './visual-lines.js';

describe('buildVisualLineMap 硬折映射', () => {
  it('不折行：单段全长、行号与双坐标齐', () => {
    expect(buildVisualLineMap(['hello'], 10)).toEqual([{ line: 0, startCol: 0, length: 5, width: 5 }]);
  });

  it('等宽硬折：每段恰 width 列、末段收余量', () => {
    expect(buildVisualLineMap(['aaaaaa'], 4)).toEqual([
      { line: 0, startCol: 0, length: 4, width: 4 },
      { line: 0, startCol: 4, length: 2, width: 2 },
    ]);
  });

  it('恰满一行不折（off-by-one 防线）', () => {
    expect(buildVisualLineMap(['aaa'], 3)).toEqual([{ line: 0, startCol: 0, length: 3, width: 3 }]);
  });

  it('CJK 双宽整字下移：末列剩一列放不下双宽字素、第二列不悬挂', () => {
    // 'aa中' 宽 3：'aa' 占 2 列后 '中'(2 列) 放不下 → 整字下移，首段宽 2 末列留白
    expect(buildVisualLineMap(['aa中'], 3)).toEqual([
      { line: 0, startCol: 0, length: 2, width: 2 },
      { line: 0, startCol: 2, length: 1, width: 2 },
    ]);
    // 'a中a' 宽 3：'a中' 显示恰满 3 列成一段（UTF-16 长 2 ≠ 宽 3——双坐标
    // 分账的极形），末 'a' 下移
    expect(buildVisualLineMap(['a中a'], 3)).toEqual([
      { line: 0, startCol: 0, length: 2, width: 3 },
      { line: 0, startCol: 2, length: 1, width: 1 },
    ]);
  });

  it('emoji 代理对：UTF-16 长与显示宽分账（长 2 宽 2）', () => {
    expect(buildVisualLineMap(['👍👍'], 2)).toEqual([
      { line: 0, startCol: 0, length: 2, width: 2 },
      { line: 0, startCol: 2, length: 2, width: 2 },
    ]);
  });

  it('ZWJ 家族字素跨行不撕裂（长 8 宽 2 双坐标）', () => {
    // 'x👨‍👩‍👧y' 宽 2：家族 emoji 为单字素（3 人 2+2+2 + 2 ZWJ = 8 码元、宽 2）
    const map = buildVisualLineMap(['x👨‍👩‍👧y'], 2);
    expect(map).toEqual([
      { line: 0, startCol: 0, length: 1, width: 1 },
      { line: 0, startCol: 1, length: 8, width: 2 },
      { line: 0, startCol: 9, length: 1, width: 1 },
    ]);
  });

  it('多逻辑行：逐行折串接、行号递增、空行占一段零宽', () => {
    expect(buildVisualLineMap(['ab', '', 'c'], 10)).toEqual([
      { line: 0, startCol: 0, length: 2, width: 2 },
      { line: 1, startCol: 0, length: 0, width: 0 },
      { line: 2, startCol: 0, length: 1, width: 1 },
    ]);
    // 折行与多行并存：行号随段携带
    expect(buildVisualLineMap(['aaaa', 'b'], 3)).toEqual([
      { line: 0, startCol: 0, length: 3, width: 3 },
      { line: 0, startCol: 3, length: 1, width: 1 },
      { line: 1, startCol: 0, length: 1, width: 1 },
    ]);
  });

  it('超长行多段折尽：段账两坐标闭合', () => {
    // 200 窄字素宽 80 → 80+80+40 三段
    expect(buildVisualLineMap(['a'.repeat(200)], 80)).toEqual([
      { line: 0, startCol: 0, length: 80, width: 80 },
      { line: 0, startCol: 80, length: 80, width: 80 },
      { line: 0, startCol: 160, length: 40, width: 40 },
    ]);
    // 9 个双宽中文字素宽 4 → 每段 2 字，末段 1 字
    expect(buildVisualLineMap(['中'.repeat(9)], 4)).toHaveLength(5);
    expect(buildVisualLineMap(['中'.repeat(9)], 4).at(-1)).toEqual({
      line: 0,
      startCol: 8,
      length: 1,
      width: 2,
    });
  });

  it('边界形：空文档、空行、width ≤ 0 防御不折不丢字', () => {
    expect(buildVisualLineMap([], 10)).toEqual([]);
    expect(buildVisualLineMap([''], 10)).toEqual([{ line: 0, startCol: 0, length: 0, width: 0 }]);
    // 坏参防御：非法宽整段返回（length 保真、width 记 0）
    expect(buildVisualLineMap(['abc', 'de'], 0)).toEqual([
      { line: 0, startCol: 0, length: 3, width: 0 },
      { line: 1, startCol: 0, length: 2, width: 0 },
    ]);
    expect(buildVisualLineMap(['abc'], -1)).toEqual([{ line: 0, startCol: 0, length: 3, width: 0 }]);
  });
});

describe('findVisualLineAt 逻辑位定位视觉行', () => {
  it('段内 col 落所在段、段界 col 落下一段开头', () => {
    const map = buildVisualLineMap(['aaaaaa'], 4); // 两段：[0,4) / [4,6)
    expect(findVisualLineAt(map, 0, 0)).toBe(0);
    expect(findVisualLineAt(map, 0, 3)).toBe(0);
    expect(findVisualLineAt(map, 0, 4)).toBe(1); // 段界 = 下一段视觉行首
  });

  it('行尾光标属末段：不落「下一段开头」也不滑到下一逻辑行', () => {
    const map = buildVisualLineMap(['aaaa', 'bb'], 4); // 行 0 一段恰满 + 行 1 一段
    expect(findVisualLineAt(map, 0, 4)).toBe(0); // 行 0 行尾留段 0
    expect(findVisualLineAt(map, 1, 0)).toBe(1);
    expect(findVisualLineAt(map, 1, 2)).toBe(1); // 行 1 行尾
  });

  it('越界回退：未知行 / 超行宽 col 回退到 map 末位', () => {
    const map = buildVisualLineMap(['aaaa', 'b'], 4);
    expect(findVisualLineAt(map, 5, 0)).toBe(1); // 未知行 → 末位
    expect(findVisualLineAt(map, 0, 9)).toBe(1); // col 超行宽 → 末位
  });

  it('空 map 回退 -1（调用方保证非空——此为兜底真身）', () => {
    expect(findVisualLineAt([], 0, 0)).toBe(-1);
  });
});

describe('colAtDisplayColumn 显示列反查 UTF-16 下标', () => {
  it('纯窄字素：显示列即 UTF-16 下标', () => {
    expect(colAtDisplayColumn('abcdef', 0, 3)).toBe(3);
    expect(colAtDisplayColumn('abcdef', 0, 0)).toBe(0);
  });

  it('CJK 半字防线：目标列落双宽字素中间吸到其首列前', () => {
    expect(colAtDisplayColumn('中文字', 0, 2)).toBe(1); // '中' 后边界
    expect(colAtDisplayColumn('中文字', 0, 1)).toBe(0); // 落 '中' 中间 → 吸到 '中' 前
    expect(colAtDisplayColumn('中文字', 0, 3)).toBe(1); // 落 '文' 中间 → 吸到 '文' 前
    expect(colAtDisplayColumn('中文字', 0, 6)).toBe(3); // 串尾
  });

  it('startCol 非零：从段起点起算（跨「中」的段内反查）', () => {
    // 'a中bcd' 从下标 1 起算：目标 2 列 → 越 '中'（1 码元 2 列）到 'b' 前
    expect(colAtDisplayColumn('a中bcd', 1, 2)).toBe(2);
    expect(colAtDisplayColumn('a中bcd', 1, 1)).toBe(1); // 落 '中' 中间吸回段起点
  });

  it('emoji 代理对同守半字防线', () => {
    expect(colAtDisplayColumn('👍👍', 0, 2)).toBe(2);
    expect(colAtDisplayColumn('👍👍', 0, 1)).toBe(0);
  });

  it('targetCols 超段宽返回段尾下标', () => {
    expect(colAtDisplayColumn('ab', 0, 99)).toBe(2);
    expect(colAtDisplayColumn('中中', 0, 99)).toBe(2);
    expect(colAtDisplayColumn('', 0, 3)).toBe(0);
  });
});

describe('prefixDisplayWidth 前缀显示宽', () => {
  it('窄字素前缀：col 即宽', () => {
    expect(prefixDisplayWidth('abc', 0)).toBe(0);
    expect(prefixDisplayWidth('abc', 2)).toBe(2);
    expect(prefixDisplayWidth('abc', 3)).toBe(3);
  });

  it('CJK 前缀按双宽计（视觉列非码元差）', () => {
    expect(prefixDisplayWidth('中ab', 1)).toBe(2); // '中' 前缀 = 2 列
    expect(prefixDisplayWidth('中ab', 2)).toBe(3);
    expect(prefixDisplayWidth('中ab', 3)).toBe(4);
  });

  it('emoji 前缀按字素整宽计', () => {
    expect(prefixDisplayWidth('👍x', 2)).toBe(2);
    expect(prefixDisplayWidth('👍x', 3)).toBe(3);
  });

  it('边界形：空行恒 0、col 超行长回整行宽', () => {
    expect(prefixDisplayWidth('', 0)).toBe(0);
    expect(prefixDisplayWidth('', 5)).toBe(0);
    expect(prefixDisplayWidth('ab', 99)).toBe(2);
  });
});

describe('字素边界算术（backspace / deleteForward 共用）', () => {
  it('prevGraphemeBoundary：col ≤ 0 归 0、窄字素逐位', () => {
    expect(prevGraphemeBoundary('abc', 0)).toBe(0);
    expect(prevGraphemeBoundary('abc', 1)).toBe(0);
    expect(prevGraphemeBoundary('abc', 3)).toBe(2);
    expect(prevGraphemeBoundary('abc', -2)).toBe(0);
  });

  it('prevGraphemeBoundary：代理对与 CJK 整素回退（不落码元中间）', () => {
    expect(prevGraphemeBoundary('a👍c', 3)).toBe(1); // 退格删整个 emoji
    expect(prevGraphemeBoundary('a👍c', 2)).toBe(1); // 码元中间 col 也吸到字素边界
    expect(prevGraphemeBoundary('中文字', 3)).toBe(2);
    expect(prevGraphemeBoundary('中文字', 1)).toBe(0);
  });

  it('prevGraphemeBoundary：col 超尾等同 col = 行长（末字素起点）', () => {
    expect(prevGraphemeBoundary('ab', 2)).toBe(1);
    expect(prevGraphemeBoundary('ab', 99)).toBe(1);
    expect(prevGraphemeBoundary('', 0)).toBe(0);
  });

  it('nextGraphemeBoundary：col ≥ 行长归行长、窄字素逐位', () => {
    expect(nextGraphemeBoundary('abc', 0)).toBe(1);
    expect(nextGraphemeBoundary('abc', 2)).toBe(3);
    expect(nextGraphemeBoundary('abc', 3)).toBe(3);
    expect(nextGraphemeBoundary('abc', 99)).toBe(3);
    expect(nextGraphemeBoundary('', 0)).toBe(0);
  });

  it('nextGraphemeBoundary：代理对与 CJK 整素前进（不落码元中间）', () => {
    expect(nextGraphemeBoundary('a👍c', 1)).toBe(3); // 前删删整个 emoji
    expect(nextGraphemeBoundary('a👍c', 3)).toBe(4);
    expect(nextGraphemeBoundary('中文字', 1)).toBe(2);
    expect(nextGraphemeBoundary('中文字', 2)).toBe(3);
  });
});
