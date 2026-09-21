/**
 * width 件测试（07 引擎节件 2——字素四规则 + 整字三原语）。
 */
import { describe, expect, it } from 'vitest';
import {
  graphemeWidth,
  isLineEndProhibited,
  isLineStartProhibited,
  sanitizeDisplayText,
  splitGraphemes,
  stringWidth,
  truncateToWidth,
  wrapText,
} from './width.js';

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

describe('CJK 折行禁则（kinsoku——三引擎同律单源）', () => {
  it('行首禁则：全角闭合标点不可起行（回送前行末字素）', () => {
    // 13 字素全 2 宽、cols=8：纯宽折点在「了」后，但「）」「。」等不可起行
    expect(wrapText('模型回答了问题（详见下文）', 8)).toEqual(['模型回答', '了问题', '（详见下', '文）']);
  });

  it('行首禁则：半角尾随句号同律（a。不可拆尾字起行）', () => {
    expect(wrapText('aaaaaaaaaa。', 10)).toEqual(['aaaaaaaaa', 'a。']);
  });

  it('行尾禁则：全角开括号不可收行（推下开行）', () => {
    // 旧形 ['a（','bc']——开括号悬挂行尾；禁则后开括号随折点下移
    expect(wrapText('a（bc', 3)).toEqual(['a', '（b', 'c']);
  });

  it('禁则谓词单源：行首禁则集 / 行尾禁则集', () => {
    for (const ch of '）】」』、。，！？：；…') {
      expect(isLineStartProhibited(ch)).toBe(true);
    }
    expect(isLineStartProhibited('a')).toBe(false);
    expect(isLineStartProhibited('中')).toBe(false);
    for (const ch of '（【「『') {
      expect(isLineEndProhibited(ch)).toBe(true);
    }
    expect(isLineEndProhibited('b')).toBe(false);
    expect(isLineEndProhibited('。')).toBe(false); // 闭合标点可收行（只禁起行）
  });

  it('禁则回送可让位：回送后行不越帽（回送 b 使 ）非行首）', () => {
    // cols=3：折点在 b 后、）将起行——回送 b 下移后 [b,）] 恰 3 列容得下
    expect(wrapText('ab）c', 3)).toEqual(['a', 'b）', 'c']);
  });

  it('禁则让位硬断：回送后行宽超帽即放弃（不无限回送）', () => {
    // cols=2 恰容一禁则字：回送 b 得 [b,）]=3>2 放弃——硬断于原折点（原形保留）
    expect(wrapText('ab）c', 2)).toEqual(['ab', '）', 'c']);
    // 全禁则字序列：current 回空即放弃——不无限回送不挂死
    expect(wrapText('）））', 2)).toEqual(['）', '）', '）']);
  });
});

describe('TUI 第四役批二（tab 记宽 / 段尾尾推守卫 / 禁则扩集 / 回送弹丢空格）', () => {
  it('tab 记宽 2：模型宽度账与落格展开面单源（sanitizeDisplayText / cell.writeText 同律）', () => {
    // 编辑器粘贴路 tab 原样入模型（不经 sanitizeDisplayText），模型侧全部
    // 宽度算术（折行/光标列/垂直移动）在此单源记 2——与展开为两空格的
    // 落格面对齐（修前记 1 与落格跳过记 0 双账分歧）
    expect(graphemeWidth('\t')).toBe(2);
    expect(stringWidth('a\tbc')).toBe(5); // 1 + 2 + 1 + 1
  });

  it('段尾折点吞空格不产尾空行（尾推守卫——与 layoutParts 同律）', () => {
    expect(wrapText('abc ', 3)).toEqual(['abc']); // 修前 ['abc','']——尾推空行
    expect(wrapText('hello world! ', 12)).toEqual(['hello world!']); // 修前多一空行
    expect(wrapText('ab ', 2)).toEqual(['ab']);
    // 显式空段的空行语义不受尾推守卫影响（'\n\n' 空行保留）
    expect(wrapText('abc \n\nb', 3)).toEqual(['abc', '', 'b']);
  });

  it('禁则回送弹丢空格：续行行首不悬挂空格（空格不是排版内容）', () => {
    // 修前 ['ab',' 。']——被弹空格落新行行首，绕过「续行行首空格跳过」自规则
    expect(wrapText('ab 。', 3)).toEqual(['a', 'b。']);
    // 回送弹丢后无解（carry 越帽）即让位硬断——空格仍不占新行行首
    expect(wrapText('a 。', 2)).toEqual(['a', '。']);
    // 两个尾随空格逐个弹丢后再评估禁则回送（两空格均在行内、折点落在 。）
    expect(wrapText('ab  。', 5)).toEqual(['a', 'b。']);
  });

  it('禁则字集扩全角方/花/龟甲括号：］｝〕不可起行、［｛〔不可收行', () => {
    // 修前 ］ 不在集——行首悬挂闭合方括号（对集内在员 ） 回送护住的对照形）
    expect(wrapText('一二三四五］', 10)).toEqual(['一二三四', '五］']); // 修前 ['一二三四五','］']
    expect(wrapText('一二三四五）', 10)).toEqual(['一二三四', '五）']); // 在集对照（既有律）
    // 行尾禁则侧：开方括号不可收行——推下开行
    expect(wrapText('一二三四［五', 10)).toEqual(['一二三四', '［五']); // 修前 ［ 悬挂行尾
    for (const ch of '］｝〕') expect(isLineStartProhibited(ch)).toBe(true);
    for (const ch of '［｛〔') expect(isLineEndProhibited(ch)).toBe(true);
    // 头注宣称对齐：全角方/花/龟甲闭合形可起行为假、开形可收行为假
    expect(isLineStartProhibited('［')).toBe(false); // 开形可起行
    expect(isLineEndProhibited('］')).toBe(false); // 闭形可收行
  });
});

describe('折点空格处理（行首空格跳过）', () => {
  it('折点吞空格 + 续行行首空格不占位', () => {
    expect(wrapText('aaa bbb ccc', 3)).toEqual(['aaa', 'bbb', 'ccc']);
  });
});

describe('控制字符消毒（sanitizeDisplayText 单源）', () => {
  it('tab 按语义展开 2 空格、CR 剥除、C0/DEL 剥除', () => {
    expect(sanitizeDisplayText('a\tb')).toBe('a  b');
    expect(sanitizeDisplayText('a\rb')).toBe('ab');
    expect(sanitizeDisplayText('a\r\nb')).toBe('a\nb'); // CRLF 归一 LF（段语义保留）
    expect(sanitizeDisplayText('a\x00b\x7f')).toBe('ab');
    expect(sanitizeDisplayText('plain\x1b[31mred\x1b[0m')).toBe('plainred'); // CSI 序列剥除
    expect(sanitizeDisplayText('osc\x1b]0;title\x07tail')).toBe('osctail'); // OSC 剥除（BEL 终止形）
    expect(sanitizeDisplayText('a\x1b]8;;http://x\x1b\\b')).toBe('ab'); // OSC-ST 终止形剥除（第六役组外残隙收口——engine 侧两终止形齐）
    expect(sanitizeDisplayText('a\x1b(Bb')).toBe('ab'); // 传统式序列剥除（第三形——ansi-rows 侧三形字节锁的同源面）
  });

  it('wrapText 源头消毒：tab 展开后参与折行', () => {
    expect(wrapText('col1\tcol2\tcol3', 8)).toEqual(['col1  co', 'l2  col3']);
  });

  it('wrapText 源头消毒：CR 剥除不产幻行', () => {
    expect(wrapText('a\rb', 8)).toEqual(['ab']);
  });
});

describe('零宽字素（孤立 ZWSP/SHY 等按 0 列记账）', () => {
  it('graphemeWidth 孤立零宽字素 → 0', () => {
    expect(graphemeWidth('\u200b')).toBe(0); // ZWSP
    expect(graphemeWidth('\u00ad')).toBe(0); // SHY
    expect(graphemeWidth('\u200d')).toBe(0); // 孤立 ZWJ（非家族内——字素层已切分）
    expect(graphemeWidth('\ufeff')).toBe(0); // BOM U+FEFF
  });

  it('ZWJ 家族内码点不受影响（整字素仍 2 列）', () => {
    expect(graphemeWidth('👨‍👩‍👧')).toBe(2); // 规则④原样——只裁孤立形
    expect(stringWidth('a\u200bb')).toBe(2); // 1 + 0 + 1——零宽不占列但两侧字素照计
  });

  it('truncateToWidth / wrapText 跳零宽字素不占列', () => {
    expect(stringWidth('aaaa\u200bbbbb')).toBe(8);
    expect(wrapText('aaaa\u200bbbbb', 4)).toEqual(['aaaa\u200b', 'bbbb']);
  });
});
