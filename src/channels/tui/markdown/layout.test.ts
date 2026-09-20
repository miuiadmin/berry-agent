/**
 * layout 件测试（折行布局算术——禁则/消毒与 width 件三引擎同律锁）。
 */
import { describe, expect, it } from 'vitest';
import { layoutParts, layoutPlain, rowWidth, type StyledGrapheme } from './layout.js';

/** 行集 → 纯串数组（断言辅助——字素行拼接回字符串对拍 wrapText 同律） */
const joined = (rows: StyledGrapheme[][]): string[] => rows.map((row) => row.map((c) => c.grapheme).join(''));

describe('layoutParts 折行（基线——承 width 三规则）', () => {
  it('宽字不悬挂 + 行首空格跳过 + 折点空格不转行', () => {
    expect(joined(layoutPlain('ab中', 3))).toEqual(['ab', '中']);
    expect(joined(layoutPlain('aaa bbb ccc', 3))).toEqual(['aaa', 'bbb', 'ccc']);
  });
});

describe('CJK 折行禁则（kinsoku——与 wrapText 同律）', () => {
  it('行首禁则：闭合标点不可起行（回送前行末字素）', () => {
    expect(joined(layoutPlain('模型回答了问题（详见下文）', 8))).toEqual(['模型回答', '了问题', '（详见下', '文）']);
  });

  it('行尾禁则：开括号不可收行（推下开行）', () => {
    expect(joined(layoutPlain('a（bc', 3))).toEqual(['a', '（b', 'c']);
  });

  it('回送图素携样式跨折行保持（carry 不丢 style）', () => {
    // 「b」加粗、「）cd」斜体：折点后 ） 禁起行 → 加粗 b 回送下移，样式随图素原样携带
    const rows = layoutParts(
      [
        { text: 'ab', style: { bold: true } },
        { text: '）cd', style: { italic: true } },
      ],
      3,
    );
    expect(joined(rows)).toEqual(['a', 'b）', 'cd']);
    expect(rows[1]![0]!.style?.bold).toBe(true); // 回送字素保原样式（不随新行重着色）
    expect(rows[1]![1]!.style?.italic).toBe(true);
    expect(rows[2]![0]!.style?.italic).toBe(true);
  });

  it('禁则回送后行宽不越帽', () => {
    for (const row of layoutPlain('模型回答了问题（详见下文）', 8)) {
      expect(rowWidth(row)).toBeLessThanOrEqual(8);
    }
  });
});

describe('控制字符消毒（sanitizeDisplayText 同源）', () => {
  it('tab 展开 2 空格 / CR 剥除 / ESC 序列剥除', () => {
    expect(joined(layoutPlain('a\tb', 8))).toEqual(['a  b']);
    expect(joined(layoutPlain('a\rb', 8))).toEqual(['ab']);
    expect(joined(layoutPlain('x\x1b[31my\x1b[0m', 8))).toEqual(['xy']);
  });
});
