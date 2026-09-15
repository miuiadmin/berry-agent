/**
 * 三档色域件单测（批 10g——07 §4.1 引擎节件 3 R2）。
 *
 * 纯函数直锁：SGR 三档参数段（16 色亮暗两段 / 256 扩展 / truecolor 直出）、
 * 降采对拍表（256 的灰阶带与 cube 锚点、16 色板最近邻）、通道拆解与 WCAG
 * 相对亮度判据。对拍值全部手工推演锚定（非转抄实现——锚点值由量化表构造性
 * 保证，非锚点值按公开算法独立计算）。
 */
import { describe, expect, it } from 'vitest';
import { ANSI16_TABLE, colorSgrBg, colorSgrFg, relativeLuminance, rgbChannels, rgbTo16, rgbTo256 } from './color.js';
import { ansiColor, color256, colorRgb } from './types.js';
import type { RgbChannels } from './types.js';

describe('rgbChannels（#rrggbb 拆解）', () => {
  it('三通道十六进制段位拆解', () => {
    expect(rgbChannels(colorRgb('#3fb950'))).toEqual({ r: 0x3f, g: 0xb9, b: 0x50 });
    expect(rgbChannels(colorRgb('#000000'))).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbChannels(colorRgb('#ffffff'))).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('relativeLuminance（WCAG 感知亮度）', () => {
  it('黑白两极界值（0 与 1）', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('阈值 0.5 两侧：GitHub 明暗底两典型', () => {
    // GitHub dark 底 #0d1117（暗侧）与白底（亮侧）——OSC 11 明暗裁定判据的
    // 判例值（detect 件消费，此处只锁数值面）
    expect(relativeLuminance({ r: 0x0d, g: 0x11, b: 0x17 })).toBeLessThan(0.5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeGreaterThan(0.5);
  });
});

describe('colorSgrFg / colorSgrBg（三档 SGR 参数段）', () => {
  it('16 色暗段：30+n / 40+n', () => {
    expect(colorSgrFg(ansiColor(6))).toBe('36');
    expect(colorSgrBg(ansiColor(6))).toBe('46');
    expect(colorSgrFg(ansiColor(4))).toBe('34');
  });

  it('16 色亮段：82+n / 92+n（SGR 90 系 aix 扩展位）', () => {
    expect(colorSgrFg(ansiColor(14))).toBe('96'); // 82+14
    expect(colorSgrBg(ansiColor(14))).toBe('106'); // 92+14
    expect(colorSgrFg(ansiColor(9))).toBe('91');
  });

  it('256 色扩展：38;5;n / 48;5;n', () => {
    expect(colorSgrFg(color256(208))).toBe('38;5;208');
    expect(colorSgrBg(color256(244))).toBe('48;5;244');
    expect(colorSgrFg(color256(196))).toBe('38;5;196');
  });

  it('0-15 值域两 brand 同义（xterm 语义——256 板 0-15 恒指标准 16 色）', () => {
    expect(colorSgrFg(color256(6))).toBe('36'); // 16 色段收录，非 38;5;6
  });

  it('truecolor 直出：38;2;r;g;b / 48;2;r;g;b', () => {
    expect(colorSgrFg(colorRgb('#ff8000'))).toBe('38;2;255;128;0');
    expect(colorSgrBg(colorRgb('#0d1117'))).toBe('48;2;13;17;23');
  });
});

describe('rgbTo256（饱和度感知降采）', () => {
  it('灰系走 24 级灰阶带（max-min < 8）', () => {
    // luma = round(均值/255 × 23)：黑 0 → 232 基；白 23 → 255；中灰 128 → 12 → 244
    expect(rgbTo256({ r: 0, g: 0, b: 0 })).toEqual(color256(232));
    expect(rgbTo256({ r: 255, g: 255, b: 255 })).toEqual(color256(255));
    expect(rgbTo256({ r: 128, g: 128, b: 128 })).toEqual(color256(244));
    // 边界内侧（diff=7 仍灰系）：{10,10,17} luma = round(37/3/255×23) = 1 → 233
    expect(rgbTo256({ r: 10, g: 10, b: 17 })).toEqual(color256(233));
  });

  it('高饱和走 6×6×6 cube（端点与锚点构造性直落）', () => {
    expect(rgbTo256({ r: 255, g: 0, b: 0 })).toEqual(color256(196)); // 5,0,0 → 16+180
    expect(rgbTo256({ r: 0, g: 0, b: 0 })).toEqual(color256(232)); // 黑走灰阶带（非 cube 0 位）
    expect(rgbTo256({ r: 95, g: 135, b: 175 })).toEqual(color256(67)); // 锚点 (1,2,3) → 16+36+12+3
    expect(rgbTo256({ r: 0, g: 128, b: 128 })).toEqual(color256(30)); // (0,2,2) → 16+0+12+2
  });

  it('非锚点按量化段位落（dark secondary #8b949e → 103）', () => {
    // 139→段2 / 148→段2 / 158→段3（155 ≤ v < 195）→ 16+72+12+3 = 103
    expect(rgbTo256({ r: 0x8b, g: 0x94, b: 0x9e })).toEqual(color256(103));
    // 端点吸附防漂移：254 → 段5（255 锚同段）
    expect(rgbTo256({ r: 254, g: 100, b: 0 })).toEqual(rgbTo256({ r: 255, g: 100, b: 0 }));
  });
});

describe('rgbTo16（xterm 16 色板最近邻）', () => {
  it('锚点色构造性直落', () => {
    expect(rgbTo16({ r: 0x00, g: 0x80, b: 0x80 })).toEqual(ansiColor(6)); // 板位 6 原值
    expect(rgbTo16({ r: 0xff, g: 0x00, b: 0x00 })).toEqual(ansiColor(9));
    expect(rgbTo16({ r: 0xff, g: 0xff, b: 0xff })).toEqual(ansiColor(15));
    expect(rgbTo16({ r: 0x00, g: 0x00, b: 0x00 })).toEqual(ansiColor(0));
  });

  it('非锚点最近邻（独立推演落点）', () => {
    // #58a6ff (88,166,255)：距亮灰 7 (192,192,192) 平方距 15461 最小（亮青 14
    // 为 15665、蓝 12 为 35300——浅蓝去饱和故邻灰）——落亮灰
    expect(rgbTo16({ r: 88, g: 166, b: 255 })).toEqual(ansiColor(7));
    // #f85149 (248,81,73)：距亮红 9 (255,0,0) 平方距 11939 最小（红 1 为
    // 26290、黄 3 为 21938）——落亮红
    expect(rgbTo16({ r: 248, g: 81, b: 73 })).toEqual(ansiColor(9));
    // #1a7f37 (26,127,55)：距绿 2 (0,128,0) 平方距 676+1+3025=3702 最小
    expect(rgbTo16({ r: 26, g: 127, b: 55 })).toEqual(ansiColor(2));
  });
});

describe('16 色基准表完整性（rgbTo16 单源面）', () => {
  it('表恒 16 位且与色值域 0-15 对齐（最近邻遍历前提）', () => {
    expect(ANSI16_TABLE.length).toBe(16);
    for (const c of ANSI16_TABLE) {
      expect(Number.isInteger(c.r) && c.r >= 0 && c.r <= 255).toBe(true);
    }
  });
});

describe('RgbChannels 通道面（降采入参形）', () => {
  it('类型面自证：构造物字段位齐（编译期收口——运行期冒烟）', () => {
    const c: RgbChannels = { r: 1, g: 2, b: 3 };
    expect(c).toEqual({ r: 1, g: 2, b: 3 });
  });
});
