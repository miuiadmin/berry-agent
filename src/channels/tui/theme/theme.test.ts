/**
 * 主题面单测（批 10g——07 §4.1 引擎节件 3 R2：语义键 / 色板 / 解析 / 探测）。
 *
 * 锁面：语义键表与 ResolvedTheme 键位对齐（完整性契约）、AnsiColor 全档直通
 * 律、三档降采落点（抽值手推 + 值域全键两律）、DEFAULT_THEME 基线（与批 10g
 * 前 accent 字节同源的确定性锚）、冻结律；色域档探测矩阵（COLORTERM/TERM
 * 组合含 tmux 内层形）；OSC 11 应答四位宽归一与诚实拒形；明暗裁定判例。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor, color256, colorRgb, rgbTo256 } from '../../engine/index.js';
import {
  builtinPalette,
  DARK_PALETTE,
  DEFAULT_THEME,
  detectColorDepth,
  isDarkBackground,
  LIGHT_PALETTE,
  paletteForBackground,
  parseOsc11Reply,
  resolveTheme,
  SEMANTIC_KEYS,
} from './index.js';
import type { SemanticKey } from './index.js';

describe('resolveTheme（构造期一次降采 + 冻结）', () => {
  it('AnsiColor 源值全档直通：dark accent 恒 ANSI 6、light accent 恒 ANSI 4', () => {
    for (const depth of ['16', '256', 'truecolor'] as const) {
      expect(resolveTheme(DARK_PALETTE, depth).accent).toEqual(ansiColor(6));
      expect(resolveTheme(LIGHT_PALETTE, depth).accent).toEqual(ansiColor(4));
    }
  });

  it('text 恒 undefined（终端缺省前景——正文随终端用户配置）', () => {
    for (const depth of ['16', '256', 'truecolor'] as const) {
      expect(resolveTheme(DARK_PALETTE, depth).text).toBeUndefined();
      expect(resolveTheme(LIGHT_PALETTE, depth).text).toBeUndefined();
    }
  });

  it('truecolor 档真彩直出（string brand 往返同值）', () => {
    const t = resolveTheme(DARK_PALETTE, 'truecolor');
    expect(t.secondary).toEqual(colorRgb('#8b949e'));
    expect(t.error).toEqual(colorRgb('#f85149'));
    expect(t.depth).toBe('truecolor');
  });

  it('256 档抽值落点（独立手推——量化段位计算）', () => {
    const t = resolveTheme(DARK_PALETTE, '256');
    expect(t.secondary).toEqual(rgbTo256({ r: 0x8b, g: 0x94, b: 0x9e })); // (2,2,3) → 103
    expect(t.success).toEqual(rgbTo256({ r: 0x3f, g: 0xb9, b: 0x50 })); // (1,3,1) → 71
    expect(t.error).toEqual(rgbTo256({ r: 0xf8, g: 0x51, b: 0x49 })); // (5,1,1) → 203
    const l = resolveTheme(LIGHT_PALETTE, '256');
    expect(l.error).toEqual(rgbTo256({ r: 0xcf, g: 0x22, b: 0x2e })); // (3,0,0) → 124
  });

  it('16 档最近邻抽值落点', () => {
    const t = resolveTheme(DARK_PALETTE, '16');
    expect(t.error).toEqual(ansiColor(9)); // #f85149 → 亮红
    expect(t.secondary).toEqual(ansiColor(8)); // #8b949e → 暗灰（距 128³ 系最小）
  });

  it('16 档高亮五键互离（exactColor 覆写——最近邻塌缩修正，批 10k 遗漏修）', () => {
    const keys = ['codeKeyword', 'codeString', 'codeComment', 'codeNumber', 'codeFunction'] as const;
    for (const setting of ['dark', 'light'] as const) {
      const theme = resolveTheme(builtinPalette(setting), '16');
      const got = keys.map((k) => theme[k]);
      expect(new Set(got).size, `${setting} 16 档五键互离`).toBe(5); // 塌缩形：dark 4/5 键合流 ANSI 7
    }
  });

  it('16 档非高亮塌缩键修正（七役扫描批——ExactColor 覆写扩面）', () => {
    // 修前塌缩形（dark 板最近邻）：link #58a6ff / codeInline #7ee787 → 7 亮灰
    // （与 thinkingText #94a3b8→7 三键合流）、tableRule #30363d → 0 黑（暗底
    // 零对比不可见）——07 §4.1 七役扫描批补笔：覆写面扩至非高亮同域塌缩键。
    // R-3 行内色翻档：link/codeInline 由绿/蓝系迁 cyan 系（codex 行内同构）
    // ——16 档覆写位随迁 6（七役批注①「codeInline→2 复绿」半句随批勘正）
    const d = resolveTheme(DARK_PALETTE, '16');
    expect(d.codeInline).toEqual(ansiColor(14)); // 亮青对位（最近邻落点 + 与 accent 6 互离——纪律锁）
    expect(d.tableRule).toEqual(ansiColor(8)); // 暗灰——暗底可见（≠ 0 黑）
    expect(d.link).toEqual(ansiColor(14)); // cyan + underline 属性位辨链接（codex 同构）
    // thinkingText 维持最近邻：italic 属性位已可辨，不占覆写位（规范笔定裁）
    expect(d.thinkingText).toEqual(ansiColor(7));
    // light 板对位：link/codeInline 迁 cyan 系（#1b7c83 深青——亮底可见；16 档
    // 覆写 6）；tableRule 最近邻恰落 7 亮灰（亮底表格线弱存在感正合真彩源
    // #d0d7de 意图）保留最近邻
    const l = resolveTheme(LIGHT_PALETTE, '16');
    expect(l.link).toEqual(ansiColor(6));
    expect(l.tableRule).toEqual(ansiColor(7));
    expect(l.codeInline).toEqual(ansiColor(6));
  });

  it('R-3 键面扩员：quoteText 三档 + diffAddedBg/diffRemovedBg 三档（ExactBgColor 形）', () => {
    // quoteText（引用块行级基础色——green 档，codex blockquote green 同构）
    const d = resolveTheme(DARK_PALETTE, 'truecolor');
    expect(d.quoteText).toEqual(colorRgb('#3fb950'));
    const l = resolveTheme(LIGHT_PALETTE, 'truecolor');
    expect(l.quoteText).toEqual(colorRgb('#1a7f37'));
    for (const board of [DARK_PALETTE, LIGHT_PALETTE]) {
      expect(resolveTheme(board, '16').quoteText).toEqual(ansiColor(2)); // 16 档绿对位
    }
    // 256 档最近邻各板各值（饱和度感知量化：dark #3fb950→71 / light #1a7f37→29
    //——两板值域不同落点必分立断言，循环同值断言会永红）
    expect(resolveTheme(DARK_PALETTE, '256').quoteText).toEqual(rgbTo256({ r: 0x3f, g: 0xb9, b: 0x50 }));
    expect(resolveTheme(LIGHT_PALETTE, '256').quoteText).toEqual(rgbTo256({ r: 0x1a, g: 0x7f, b: 0x37 }));
    // diff bg 双键（codex diff 静态定值——非探测混合族）：truecolor 直出、
    // 256 档 22/52 覆写、16 档 undefined（回退纯前景律——低档位宁可无带不错色）
    const dTc = resolveTheme(DARK_PALETTE, 'truecolor');
    expect(dTc.diffAddedBg).toEqual(colorRgb('#213a2b'));
    expect(dTc.diffRemovedBg).toEqual(colorRgb('#4a221d'));
    const lTc = resolveTheme(LIGHT_PALETTE, 'truecolor');
    expect(lTc.diffAddedBg).toEqual(colorRgb('#dafbe1'));
    expect(lTc.diffRemovedBg).toEqual(colorRgb('#ffebe9'));
    for (const board of [DARK_PALETTE, LIGHT_PALETTE]) {
      const v256 = resolveTheme(board, '256');
      expect(v256.diffAddedBg).toEqual(color256(22)); // Color256 直通（覆写位非最近邻）
      expect(v256.diffRemovedBg).toEqual(color256(52));
      const v16 = resolveTheme(board, '16');
      expect(v16.diffAddedBg).toBeUndefined();
      expect(v16.diffRemovedBg).toBeUndefined();
    }
  });

  it('值域两律全键遍历：256 档 RGB 源键落 16-255、16 档落 0-15', () => {
    // RGB 源键 = 除 accent（AnsiColor 直通）、text（undefined）与动态混合键
    //（userMessageBg / weakRule / toolCardBg——探测缺席恒 undefined，回退腿另册单测）
    //及 diff bg 双键（ExactBgColor 形——16 档合法 undefined 键缺席，R-3 批）
    //外全集
    const ABSENT_16_KEYS = ['userMessageBg', 'weakRule', 'toolCardBg', 'diffAddedBg', 'diffRemovedBg'] as const;
    const rgbKeys = SEMANTIC_KEYS.filter(
      (k) => k !== 'accent' && k !== 'text' && !(ABSENT_16_KEYS as readonly string[]).includes(k),
    ) as Exclude<SemanticKey, 'accent' | 'text' | (typeof ABSENT_16_KEYS)[number]>[];
    for (const key of rgbKeys) {
      const v256 = resolveTheme(DARK_PALETTE, '256')[key];
      const v16 = resolveTheme(DARK_PALETTE, '16')[key];
      expect(typeof v256 === 'number' && v256 >= 16 && v256 <= 255).toBe(true);
      expect(typeof v16 === 'number' && v16 >= 0 && v16 <= 15).toBe(true);
    }
  });

  it('dark 旗标随板 id 单源 + 产物冻结（换装走整体换引用）', () => {
    const d = resolveTheme(DARK_PALETTE, 'truecolor');
    const l = resolveTheme(LIGHT_PALETTE, 'truecolor');
    expect(d.dark).toBe(true);
    expect(l.dark).toBe(false);
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('DEFAULT_THEME = dark@16 且 accent 落 ANSI 6（批 10g 前字节同源基线）', () => {
    expect(DEFAULT_THEME).toEqual(resolveTheme(DARK_PALETTE, '16'));
    expect(DEFAULT_THEME.accent).toEqual(ansiColor(6));
    expect(DEFAULT_THEME.depth).toBe('16');
  });
});

describe('语义键面（SEMANTIC_KEYS 单源表）', () => {
  it('表恒 22 键且 ResolvedTheme 全键位定值（完整性契约——编译器不核此处）', () => {
    expect(SEMANTIC_KEYS.length).toBe(22); // 11 核心键批 10g + 高亮键族五键批 10h + userMessageBg 界面美化役 R2 扩键 + weakRule V-3 注⑨ + toolCardBg 五件批 C 件 + R-3 批三键（quoteText/diffAddedBg/diffRemovedBg）
    const t = resolveTheme(DARK_PALETTE, 'truecolor');
    for (const key of SEMANTIC_KEYS) {
      // text / 三动态混合键（userMessageBg / weakRule / toolCardBg）合法 undefined；余键恒有值——缺值即编程错 fail-loud 于消费
      expect(key in t).toBe(true);
    }
    expect(t.accent).toBeDefined();
  });
});

describe('userMessageBg 动态混合键（界面美化役批⑦ R2 扩键注）', () => {
  it('探测在场 + 非 16 档 → 按板档混合铸入（dark 白 12% / light 黑 4%）', () => {
    const bg = { r: 100, g: 100, b: 100 };
    // dark：每通道 100 + 0.12×(255−100) = 118.6 → 119（0x77）
    expect(resolveTheme(DARK_PALETTE, 'truecolor', bg).userMessageBg).toEqual(colorRgb('#777777'));
    // light：每通道 100×0.96 = 96（0x60）
    expect(resolveTheme(LIGHT_PALETTE, 'truecolor', bg).userMessageBg).toEqual(colorRgb('#606060'));
    // 256 档照常降采（rgbTo256 单源——背景带低档仍可用）
    expect(resolveTheme(DARK_PALETTE, '256', bg).userMessageBg).toEqual(rgbTo256({ r: 119, g: 119, b: 119 }));
  });

  it('回退三形：16 档降采 / 探测缺席 / 内置板本键恒缺 → 全 undefined（无背景）', () => {
    expect(resolveTheme(DARK_PALETTE, '16', { r: 1, g: 2, b: 3 }).userMessageBg).toBeUndefined(); // 低档位宁可无带不可错色
    expect(resolveTheme(DARK_PALETTE, 'truecolor').userMessageBg).toBeUndefined(); // 探测缺席（OSC 11 未应答/失败）
    expect(DEFAULT_THEME.userMessageBg).toBeUndefined(); // 缺省主题 = dark@16 无探测——无背景
  });

  it('自定义板显式带本键 → 板值优先（混合腿不覆写——正常遍历腿已解析）', () => {
    const board = {
      id: 'custom-bg',
      dark: true,
      colors: { ...DARK_PALETTE.colors, userMessageBg: { r: 16, g: 16, b: 16 } },
    };
    // 探测值在场亦不覆写板值：16,16,16 直出（非混合 118.6 形）
    expect(resolveTheme(board, 'truecolor', { r: 100, g: 100, b: 100 }).userMessageBg).toEqual(colorRgb('#101010'));
  });
});

describe('toolCardBg 动态混合键（TUI 对标 Codex 五件批 C 件 R2——第二背景键）', () => {
  it('探测在场 + 非 16 档 → 按板档混合铸入（dark 白 8% / light 黑 3%——比 userMessageBg 白 12%/黑 4% 弱一档）', () => {
    const bg = { r: 100, g: 100, b: 100 };
    // dark：每通道 100 + 0.08×(255−100) = 112.4 → 112（0x70）——卡面是密集块面弱一档
    expect(resolveTheme(DARK_PALETTE, 'truecolor', bg).toolCardBg).toEqual(colorRgb('#707070'));
    // light：每通道 100×0.97 = 97（0x61）
    expect(resolveTheme(LIGHT_PALETTE, 'truecolor', bg).toolCardBg).toEqual(colorRgb('#616161'));
    // 256 档照常降采（rgbTo256 单源——与 userMessageBg 同链）
    expect(resolveTheme(DARK_PALETTE, '256', bg).toolCardBg).toEqual(rgbTo256({ r: 112, g: 112, b: 112 }));
  });

  it('回退三形：16 档降采 / 探测缺席 / 缺省主题 → 全 undefined（无卡面带）', () => {
    expect(resolveTheme(DARK_PALETTE, '16', { r: 1, g: 2, b: 3 }).toolCardBg).toBeUndefined(); // 低档位宁可无带不可错色
    expect(resolveTheme(DARK_PALETTE, 'truecolor').toolCardBg).toBeUndefined(); // 探测缺席（OSC 11 未应答/失败）
    expect(DEFAULT_THEME.toolCardBg).toBeUndefined(); // 缺省主题 = dark@16 无探测——无卡面
  });

  it('自定义板显式带本键 → 板值优先（混合腿不覆写——探测在场亦不覆写）', () => {
    const board = {
      id: 'custom-card',
      dark: true,
      colors: { ...DARK_PALETTE.colors, toolCardBg: { r: 20, g: 20, b: 20 } },
    };
    expect(resolveTheme(board, 'truecolor', { r: 100, g: 100, b: 100 }).toolCardBg).toEqual(colorRgb('#141414'));
  });
});

describe('weakRule 动态混合键（V-3 注⑨——弱存在感线取色链）', () => {
  /** 自定义板夹具：text 定义（GitHub dark fg #e6edf3）+ bg 键带值（探测传值门放行形） */
  const CUSTOM_FG_BOARD = {
    id: 'custom-fg',
    dark: true,
    colors: { ...DARK_PALETTE.colors, text: { r: 230, g: 237, b: 243 }, userMessageBg: { r: 16, g: 16, b: 16 } },
  };
  const BG = { r: 13, g: 17, b: 23 }; // GitHub dark bg #0d1117

  it('fg @ 20% alpha 混探测 bg：逐通道 round(fg×0.2 + bg×0.8)', () => {
    // r: 230×0.2+13×0.8=56.4→56；g: 237×0.2+17×0.8=61；b: 243×0.2+23×0.8=67
    expect(resolveTheme(CUSTOM_FG_BOARD, 'truecolor', BG).weakRule).toEqual(colorRgb('#383d43'));
  });

  it('256 档照常降采（rgbTo256 饱和度感知量化单源——与 userMessageBg 同链）', () => {
    expect(resolveTheme(CUSTOM_FG_BOARD, '256', BG).weakRule).toEqual(rgbTo256({ r: 56, g: 61, b: 67 }));
  });

  it('自定义板显式带本键 → 板值优先（混合腿不覆写）', () => {
    const board = { ...CUSTOM_FG_BOARD, colors: { ...CUSTOM_FG_BOARD.colors, weakRule: { r: 40, g: 40, b: 40 } } };
    expect(resolveTheme(board, 'truecolor', BG).weakRule).toEqual(colorRgb('#282828'));
  });

  it('回退四形全 undefined：16 档 / 探测缺席 / 主题 fg 缺席（内置板 text 恒缺）/ fg 色板位（AnsiColor RGB 不可知）', () => {
    expect(resolveTheme(CUSTOM_FG_BOARD, '16', BG).weakRule).toBeUndefined(); // 低档位不产半吊混合色
    expect(resolveTheme(CUSTOM_FG_BOARD, 'truecolor').weakRule).toBeUndefined(); // OSC 11 未应答/失败
    expect(resolveTheme(DARK_PALETTE, 'truecolor', BG).weakRule).toBeUndefined(); // text=undefined 终端缺省前景——无混合基即无键
    expect(resolveTheme(LIGHT_PALETTE, 'truecolor', { r: 255, g: 255, b: 255 }).weakRule).toBeUndefined();
    const ansiFgBoard = {
      id: 'custom-ansi-fg',
      dark: true,
      colors: { ...DARK_PALETTE.colors, text: ansiColor(7), userMessageBg: { r: 16, g: 16, b: 16 } },
    };
    expect(resolveTheme(ansiFgBoard, 'truecolor', BG).weakRule).toBeUndefined(); // 色板位 RGB 随终端用户配置——同缺席诚实回退
    expect(DEFAULT_THEME.weakRule).toBeUndefined(); // 缺省主题 = dark@16 双缺席
  });

  it('亮底安全规则：混合产色与背景逐通道差均值 < 8 → 键缺席（判据定值回填——V-3 注⑨⑤）', () => {
    // bg 恒 13：fg 55 → blend=round(11+10.4)=21 差 8（阈值上可见）；fg 50 → blend=round(10+10.4)=20 差 7（不足回退）
    const boardOf = (fg: number) => ({
      id: `custom-${fg}`,
      dark: true,
      colors: { ...DARK_PALETTE.colors, text: { r: fg, g: fg, b: fg }, userMessageBg: { r: 16, g: 16, b: 16 } },
    });
    const grayBg = { r: 13, g: 13, b: 13 };
    expect(resolveTheme(boardOf(55), 'truecolor', grayBg).weakRule).toEqual(colorRgb('#151515'));
    expect(resolveTheme(boardOf(50), 'truecolor', grayBg).weakRule).toBeUndefined(); // 对比不足 → 消费位回退 fg+dim 既有形
  });
});

describe('builtinPalette（档 → 板）', () => {
  it('显式档映射恒等返回（dark/light 两板）', () => {
    expect(builtinPalette('dark')).toBe(DARK_PALETTE);
    expect(builtinPalette('light')).toBe(LIGHT_PALETTE);
    expect(DARK_PALETTE.id).toBe('dark');
    expect(LIGHT_PALETTE.id).toBe('light');
  });

  it('板源值构造合法（静态表错值启动即抛——此处锁表值域不抛）', () => {
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      expect(palette.colors.accent).toBeDefined();
      expect(palette.colors.text).toBeUndefined();
    }
  });
});

describe('detectColorDepth（env 组合矩阵）', () => {
  it('COLORTERM 真彩标记两形（truecolor / 24bit）', () => {
    expect(detectColorDepth({ COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(detectColorDepth({ COLORTERM: '24bit' })).toBe('truecolor');
  });

  it('COLORTERM 有值非真彩 → 保守 256；无值兜底 16', () => {
    expect(detectColorDepth({ COLORTERM: 'yes' })).toBe('256');
    expect(detectColorDepth({})).toBe('16');
    expect(detectColorDepth({ TERM: 'xterm' })).toBe('16');
  });

  it('TERM 256color 尾判（tmux/screen 内层主流形）', () => {
    expect(detectColorDepth({ TERM: 'xterm-256color' })).toBe('256');
    expect(detectColorDepth({ TERM: 'screen-256color' })).toBe('256');
    expect(detectColorDepth({ TERM: 'tmux-256color' })).toBe('256');
  });

  it('COLORTERM 优先于 TERM（同场组合）', () => {
    expect(detectColorDepth({ COLORTERM: 'truecolor', TERM: 'xterm-256color' })).toBe('truecolor');
    expect(detectColorDepth({ COLORTERM: '', TERM: 'xterm-256color' })).toBe('256');
  });
});

describe('parseOsc11Reply（应答解析——位宽归一与诚实拒）', () => {
  it('四位宽形（xterm/kitty 主流）：ffff → 255、0000 → 0', () => {
    expect(parseOsc11Reply('11;rgb:ffff/ffff/ffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseOsc11Reply('11;rgb:0000/0000/0000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseOsc11Reply('11;rgb:c0c0/c0c0/c0c0')).toEqual({ r: 192, g: 192, b: 192 });
  });

  it('少位宽形归一：一位 [0,15] / 两位 [0,255] / 三位 [0,4095]', () => {
    expect(parseOsc11Reply('11;rgb:0/7/f')).toEqual({ r: 0, g: 119, b: 255 }); // 7/15×255=119
    expect(parseOsc11Reply('11;rgb:af/af/af')).toEqual({ r: 175, g: 175, b: 175 });
    expect(parseOsc11Reply('11;rgb:000/800/fff')).toEqual({ r: 0, g: 128, b: 255 }); // 2048/4095×255≈127.5→128
  });

  it('非 11 码 / 非 rgb 形 / 越界位宽 / 空串 → null 诚实拒', () => {
    expect(parseOsc11Reply('10;rgb:0/0/0')).toBeNull(); // 前景色码非本面
    expect(parseOsc11Reply('11;rgb:zz/0/0')).toBeNull();
    expect(parseOsc11Reply('11;rgb:01234/0/0')).toBeNull(); // 5 位越界
    expect(parseOsc11Reply('')).toBeNull();
    expect(parseOsc11Reply('11;rgb:0/0')).toBeNull(); // 两段缺一
  });
});

describe('isDarkBackground / paletteForBackground（明暗裁定）', () => {
  it('判例三值：黑底暗 / 白底亮 / GitHub dark 底 #0d1117 暗', () => {
    expect(isDarkBackground({ r: 0, g: 0, b: 0 })).toBe(true);
    expect(isDarkBackground({ r: 255, g: 255, b: 255 })).toBe(false);
    expect(isDarkBackground({ r: 0x0d, g: 0x11, b: 0x17 })).toBe(true);
  });

  it('背景 → 板单源（auto 档与 probe 回执路共用）', () => {
    expect(paletteForBackground({ r: 0, g: 0, b: 0 })).toBe(DARK_PALETTE);
    expect(paletteForBackground({ r: 255, g: 255, b: 255 })).toBe(LIGHT_PALETTE);
  });
});
