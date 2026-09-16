/**
 * 自定义主题文件件测试（/themes 批——07 §4.1 R2 挂账解挂批）：主题名合法形
 * 边界、目录清单（缺席空表/仅 .json/名合法过滤/字典序）、载入四色形与坏文件
 * 处置律（整文件拒载不捡拾好键/未知键忽略照载）、overlayBoard 缺键回退合成。
 *
 * 真盘临时目录（文件 IO 件全栈惯例——settings-store.test 同形）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { ansiColor, color256, colorRgb, rgbChannels } from '../../engine/index.js';
import { DARK_PALETTE, LIGHT_PALETTE } from './palette.js';
import {
  CUSTOM_THEME_DIR,
  isValidCustomThemeName,
  listCustomThemeNames,
  loadCustomThemeColors,
  overlayBoard,
} from './custom.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 在数据目录写一个自定义主题文件（父目录自动建） */
function writeTheme(dataDir: string, name: string, content: string): string {
  const themeDir = join(dataDir, CUSTOM_THEME_DIR);
  mkdirSync(themeDir, { recursive: true });
  const path = join(themeDir, `${name}.json`);
  writeFileSync(path, content, 'utf8');
  return path;
}

function captureWarn(): { warnings: string[]; warn: (m: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (m) => void warnings.push(m) };
}

describe('isValidCustomThemeName（合法形单段 + 无 traversal）', () => {
  it('合法：字母/数字起头，可含点下划线连字符，帽 64', () => {
    for (const name of ['a', 'A1', 'my-theme', 'My.Theme_2', 'x'.repeat(64)]) {
      expect(isValidCustomThemeName(name)).toBe(true);
    }
  });
  it('非法：路径分隔符/首点/空串/超帽/非 ASCII', () => {
    for (const name of ['', '.hidden', '..', 'a/b', 'a\\b', 'x'.repeat(65), '主题']) {
      expect(isValidCustomThemeName(name)).toBe(false);
    }
  });
});

describe('listCustomThemeNames（目录快照）', () => {
  it('目录缺席 = 空表零负担', () => {
    expect(listCustomThemeNames(tmpDataDir('theme-nodir-'))).toEqual([]);
  });
  it('只收 .json 且名合法形；非 .json 后缀/非法名/子目录滤除；字典序稳定', () => {
    const dir = tmpDataDir('theme-list-');
    const themeDir = join(dir, CUSTOM_THEME_DIR);
    mkdirSync(themeDir, { recursive: true });
    writeFileSync(join(themeDir, 'zeta.json'), '{}');
    writeFileSync(join(themeDir, 'alpha.json'), '{}');
    writeFileSync(join(themeDir, 'readme.txt'), 'x'); // 非 .json
    writeFileSync(join(themeDir, '.hidden.json'), 'x'); // 首点非法名
    mkdirSync(join(themeDir, 'sub.json')); // 同名子目录——isFile 滤除
    expect(listCustomThemeNames(dir)).toEqual(['alpha', 'zeta']);
  });
});

describe('loadCustomThemeColors（四色形 + 坏文件处置律）', () => {
  it('hex 串两形（#rrggbb / #rgb）→ RgbChannels 真彩形', () => {
    const dir = tmpDataDir('theme-hex-');
    writeTheme(dir, 'six', JSON.stringify({ accent: '#8b949e' }));
    writeTheme(dir, 'three', JSON.stringify({ accent: '#f80' }));
    expect(loadCustomThemeColors(dir, 'six')).toEqual({ accent: rgbChannels(colorRgb('#8b949e')) });
    expect(loadCustomThemeColors(dir, 'three')).toEqual({ accent: rgbChannels(colorRgb('#ff8800')) });
  });
  it('数值两档：0-15 = AnsiColor、16-255 = Color256；其余范围坏形', () => {
    const dir = tmpDataDir('theme-num-');
    writeTheme(dir, 'ok', JSON.stringify({ accent: 4, secondary: 200 }));
    expect(loadCustomThemeColors(dir, 'ok')).toEqual({ accent: ansiColor(4), secondary: color256(200) });
    writeTheme(dir, 'neg', JSON.stringify({ accent: -1 }));
    expect(loadCustomThemeColors(dir, 'neg')).toBeNull();
    writeTheme(dir, 'over', JSON.stringify({ accent: 256 }));
    expect(loadCustomThemeColors(dir, 'over')).toBeNull();
  });
  it('ExactColor 对象形（rgb hex 串 / rgb 通道对象 + ansi16）', () => {
    const dir = tmpDataDir('theme-exact-');
    writeTheme(dir, 'hexrgb', JSON.stringify({ accent: { rgb: '#8b949e', ansi16: 6 } }));
    writeTheme(dir, 'chanrgb', JSON.stringify({ accent: { rgb: { r: 139, g: 148, b: 158 }, ansi16: 6 } }));
    const expected = { rgb: rgbChannels(colorRgb('#8b949e')), ansi16: ansiColor(6) };
    expect(loadCustomThemeColors(dir, 'hexrgb')).toEqual({ accent: expected });
    expect(loadCustomThemeColors(dir, 'chanrgb')).toEqual({ accent: expected });
    // ansi16 坏档（16 越界）= 整文件拒载
    writeTheme(dir, 'bad16', JSON.stringify({ accent: { rgb: '#8b949e', ansi16: 16 } }));
    expect(loadCustomThemeColors(dir, 'bad16')).toBeNull();
  });
  it('文件缺席/读失败/非法 JSON/顶层非对象 = null + warn 点名', () => {
    const dir = tmpDataDir('theme-bad-');
    const absent = captureWarn();
    expect(loadCustomThemeColors(dir, 'ghost', { warn: absent.warn })).toBeNull();
    expect(absent.warnings.join('\n')).toContain('主题文件缺席');
    const { warnings, warn } = captureWarn();
    writeTheme(dir, 'broken', '{not json');
    expect(loadCustomThemeColors(dir, 'broken', { warn })).toBeNull();
    expect(warnings.join('\n')).toContain('JSON 解析失败');
    writeTheme(dir, 'array', '[1,2]');
    expect(loadCustomThemeColors(dir, 'array', { warn })).toBeNull();
    expect(warnings.join('\n')).toContain('顶层须为对象');
  });
  it('任一色值坏形 = 整文件拒载（好键不捡拾）——坏值点名', () => {
    const dir = tmpDataDir('theme-mixed-');
    writeTheme(dir, 'mixed', JSON.stringify({ accent: '#f80', secondary: 'not-a-color' }));
    const { warnings, warn } = captureWarn();
    expect(loadCustomThemeColors(dir, 'mixed', { warn })).toBeNull();
    expect(warnings.join('\n')).toContain('键 secondary 非法色形');
  });
  it('未知键 warn 忽略照载（非坏值——与色值坏形分立）', () => {
    const dir = tmpDataDir('theme-unknown-');
    writeTheme(dir, 'extra', JSON.stringify({ accent: '#f80', fontFamily: 'x' }));
    const { warnings, warn } = captureWarn();
    expect(loadCustomThemeColors(dir, 'extra', { warn })).toEqual({ accent: rgbChannels(colorRgb('#ff8800')) });
    expect(warnings.join('\n')).toContain('未知键 fontFamily');
  });
  it('空对象 = 空覆盖表（全键回退基板——合成零覆盖）', () => {
    const dir = tmpDataDir('theme-empty-');
    writeTheme(dir, 'blank', '{}');
    expect(loadCustomThemeColors(dir, 'blank')).toEqual({});
  });
});

describe('overlayBoard（缺键回退合成单源）', () => {
  it('覆盖键胜、缺键回退基板同位键；dark 旗取基板', () => {
    const board = overlayBoard(DARK_PALETTE, { accent: ansiColor(3) });
    expect(board.dark).toBe(true);
    expect(board.colors.accent).toEqual(ansiColor(3)); // 覆盖键
    expect(board.colors.secondary).toEqual(DARK_PALETTE.colors.secondary); // 回退键
  });
  it('空覆盖 = 基板同板（值恒等）', () => {
    expect(overlayBoard(LIGHT_PALETTE, {}).colors).toEqual(LIGHT_PALETTE.colors);
    expect(overlayBoard(LIGHT_PALETTE, {}).dark).toBe(false);
  });
});
