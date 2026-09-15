/**
 * 主题面单测（批 10g——07 §4.1 引擎节件 3 R2：语义键 / 色板 / 解析 / 探测）。
 *
 * 锁面：语义键表与 ResolvedTheme 键位对齐（完整性契约）、AnsiColor 全档直通
 * 律、三档降采落点（抽值手推 + 值域全键两律）、DEFAULT_THEME 基线（与批 10g
 * 前 accent 字节同源的确定性锚）、冻结律；色域档探测矩阵（COLORTERM/TERM
 * 组合含 tmux 内层形）；OSC 11 应答四位宽归一与诚实拒形；明暗裁定判例。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor, colorRgb, rgbTo256 } from '../../engine/index.js';
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

  it('值域两律全键遍历：256 档 RGB 源键落 16-255、16 档落 0-15', () => {
    // RGB 源键 = 除 accent（AnsiColor 直通）与 text（undefined）外全集
    const rgbKeys = SEMANTIC_KEYS.filter((k) => k !== 'accent' && k !== 'text') as Exclude<
      SemanticKey,
      'accent' | 'text'
    >[];
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
  it('表恒 11 键且 ResolvedTheme 全键位定值（完整性契约——编译器不核此处）', () => {
    expect(SEMANTIC_KEYS.length).toBe(11);
    const t = resolveTheme(DARK_PALETTE, 'truecolor');
    for (const key of SEMANTIC_KEYS) {
      // text 合法 undefined；余键恒有值——缺值即编程错 fail-loud 于消费
      expect(key in t).toBe(true);
    }
    expect(t.accent).toBeDefined();
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
