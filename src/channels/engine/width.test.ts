/**
 * width 件测试（07 引擎节件 2——字素四规则 + 整字三原语）。
 */
import { describe, expect, it } from 'vitest';
import { graphemeWidth, splitGraphemes, stringWidth, truncateToWidth, wrapText } from './width.js';

describe('字素级宽度四规则', () => {
  it('规则①：EAW wide/fullwidth 码点 → 2（CJK / 全角标点）', () => {
    expect(graphemeWidth('中')).toBe(2);
    expect(graphemeWidth('ｚ')).toBe(2); // fullwidth 全角字母
    expect(graphemeWidth('！')).toBe(2); // 全角叹号 U+FF01
  });

  it('规则①反面：narrow / neutral → 1', () => {
    expect(graphemeWidth('a')).toBe(1);
    expect(graphemeWidth('±')).toBe(1); // neutral 数学符号
  });

  it('决策面自持：ambiguous → 1（中西混排取舍注释在案）', () => {
    expect(graphemeWidth('⊙')).toBe(1); // U+2299 ambiguous——本仓按窄计
    expect(graphemeWidth('→')).toBe(1); // U+2192 ambiguous
  });

  it('规则②：含 VS16 → 2（窄基字符 + emoji 呈现形）', () => {
    expect(graphemeWidth('✓️')).toBe(2); // U+2713 neutral + VS16 → 2
  });

  it('规则③：恰一对 Regional Indicator → 2（旗帜）', () => {
    expect(graphemeWidth('🇨🇳')).toBe(2); // 🇨🇳
  });

  it('规则③反面：孤立单 RI → 1（不成对不判宽）', () => {
    expect(graphemeWidth('🇦')).toBe(1); // 孤立 RI A
  });

  it('规则④：ZWJ 家族单一字素 → 2（家庭 emoji 三人合成一字素）', () => {
    expect(graphemeWidth('👨‍👩‍👧')).toBe(2);
  });
});

describe('splitGraphemes（Intl.Segmenter 模块级单例）', () => {
  it('字素不撕裂：ZWJ 家族 / 旗帜 / 肤色修饰各为单元素', () => {
    const zs = '👨‍👩‍👧'; // 家庭 = 一字素
    expect(splitGraphemes(`a${zs}b`)).toEqual(['a', zs, 'b']);
    const flag = '🇨🇳'; // 旗帜 = 一字素
    expect(splitGraphemes(flag)).toHaveLength(1);
    const toned = '👍🏿'; // 👍 + U+1F3FF 深肤色修饰 = 一字素
    expect(splitGraphemes(toned)).toHaveLength(1);
  });

  it('空串 → 空数组', () => {
    expect(splitGraphemes('')).toEqual([]);
  });
});

describe('整字三原语', () => {
  it('测宽：全串字素宽度和', () => {
    expect(stringWidth('a中b')).toBe(4); // 1 + 2 + 1
    expect(stringWidth('')).toBe(0);
  });

  it('按宽截断：宽字跨界整字丢弃不产半字', () => {
    expect(truncateToWidth('a中b', 3)).toBe('a中'); // 恰可容
    expect(truncateToWidth('a中b', 2)).toBe('a'); // 剩 1 列放不下「中」——整字丢弃
    expect(truncateToWidth('中文', 1)).toBe(''); // 首字即放不下
    expect(truncateToWidth('abc', 0)).toBe(''); // 零宽防御
  });

  it('整字换行：行末剩一列遇双宽字素整字下移、第二列不悬挂', () => {
    expect(wrapText('ab中', 3)).toEqual(['ab', '中']); // 2+2>3 → 「中」整字下移
    expect(wrapText('中文abc', 4)).toEqual(['中文', 'abc']);
    expect(wrapText('aaaa', 2)).toEqual(['aa', 'aa']);
  });

  it('整字换行：显式换行强制断行（段语义保留、空行保留）', () => {
    expect(wrapText('a\nb', 10)).toEqual(['a', 'b']);
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('整字换行：ZWJ 家族跨行不撕裂', () => {
    const zs = '👨‍👩‍👧';
    expect(wrapText(`x${zs}`, 1)).toEqual(['x', zs]); // 宽 2 字素不被切半
  });
});
