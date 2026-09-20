/**
 * layout 件测试（折行布局算术——禁则/消毒与 width 件三引擎同律锁）。
 */
import { describe, expect, it } from 'vitest';
import { wrapText } from '../../engine/index.js';
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

describe('TUI 第四役批二同律（回送弹丢空格 / 整字独行 / 三族对拍锁）', () => {
  it('禁则回送弹丢空格：续行行首不悬挂空格（与 wrapText 同律）', () => {
    // 修前 ['ab',' 。']——被弹空格落新行行首（绕过行首空格跳过位）
    expect(joined(layoutPlain('ab 。', 3))).toEqual(['a', 'b。']);
    expect(joined(layoutPlain('a 。', 2))).toEqual(['a', '。']); // 弹丢后无解让位硬断
  });

  it('整字独行：width=1 遇双宽字素开新行整字承载（不丢字素）', () => {
    // 修前防御位整字丢弃——layoutPlain('你', 1) === ['']（字素消失）；
    // narrow-width 整字律例外契约（行恰一个字素且其宽 > cols 整字独行）回归
    expect(joined(layoutPlain('你', 1))).toEqual(['你']);
    expect(joined(layoutPlain('a你b', 1))).toEqual(['a', '你', 'b']);
    expect(joined(layoutPlain('😀你', 1))).toEqual(['😀', '你']); // emoji 双宽同律
    // 整字独行行宽可越帽（2 > 1）——这是唯一例外形，不越帽行恒 ≤ width
    expect(rowWidth(layoutPlain('你', 1)[0]!)).toBe(2);
  });

  it('三族对拍锁：wrapText 行集 === layoutPlain 拼接行集（trailing-space / carry 族）', () => {
    // 单段文本（无 \n——layoutParts 的 LF 跳过与 wrapText 分段不对拍）、
    // 无零宽字素（两引擎行首空格跳过判据 used===0 与 current.length===0 的
    // 唯一分歧位）——其余形两引擎必须同行集
    const trailingSpace = ['abc ', 'hello world! ', 'a b c ', '一二三 ', 'ab ', 'ab   。', 'a  b  '];
    const carry = [
      'ab 。',
      '一二三四五］',
      '一二三四［五',
      '模型回答了问题（详见下文）',
      'ab）c',
      'a（bc',
      'ab  你',
      'a 。',
    ];
    // w ≥ 2：全字素宽 ≤ 2 不触 wrapText 的超帽前置空行形（fold-from-empty）——
    // 可裸对拍；trailing-space 族同时锁「段尾不推空行」两引擎同守卫
    for (const w of [2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      for (const t of [...trailingSpace, ...carry]) {
        expect(wrapText(t, w), `t=${JSON.stringify(t)} w=${w}`).toEqual(joined(layoutPlain(t, w)));
      }
    }
    // width=1 族：wrapText 超帽前置空行形（行首字素即超宽时先推空行再整字
    // 独行）过滤后与 layoutParts 整字独行行集同行集——内容行同律
    for (const t of ['你', '你我', 'a你b', '你a', '😀你', 'ab', 'ab  你', '一二三四五］']) {
      expect(
        wrapText(t, 1).filter((line) => line !== ''),
        `t=${JSON.stringify(t)} w=1`,
      ).toEqual(joined(layoutPlain(t, 1)));
    }
  });
});
