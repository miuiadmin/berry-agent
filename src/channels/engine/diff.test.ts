/**
 * diff 行差分件测试（07 引擎节件 3——EL 纪律 / 双零 / 未变行零写出 /
 * 光标帧尾落位去重）。纯函数层：CellGrid 双帧比对、字面 ANSI 断言。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from './cell.js';
import { renderFrameDiff } from './diff.js';
import { ansiColor } from './types.js';

const EL = '\x1b[K';
const SGR_RESET = '\x1b[0m';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

/** 快捷建帧：给定行文本数组写入同几何网格 */
function frameOf(lines: string[], cols = 20, rows = 6): CellGrid {
  const grid = new CellGrid(cols, rows);
  lines.forEach((text, row) => grid.writeText(row, 0, text));
  return grid;
}

describe('零写出纪律', () => {
  it('双零：内容与光标均零变更 → 整帧零写出', () => {
    const a = frameOf(['hello', 'world']);
    const b = frameOf(['hello', 'world']);
    expect(renderFrameDiff(a, b)).toBe('');
  });

  it('未变行零写出：只变一行则其余行内容不出现', () => {
    const a = frameOf(['first', 'second', 'third']);
    const b = frameOf(['first', 'SECOND', 'third']);
    const out = renderFrameDiff(a, b);
    expect(out).toContain('SECOND');
    expect(out).not.toContain('first');
    expect(out).not.toContain('third');
  });
});

describe('行差分与 EL 纪律', () => {
  it('新写行：定位 + 内容直写、无 EL（旧帧无残留可清）', () => {
    const a = new CellGrid(20, 6);
    const b = frameOf(['hi']);
    const out = renderFrameDiff(a, b);
    expect(out).toContain('\x1b[1;1H'); // CUP(0,0)
    expect(out).toContain('hi');
    expect(out).not.toContain(EL); // 无残留——不发 EL
  });

  it('行缩短：内容末残留 → SGR 复位 + EL（BCE 前置复位）', () => {
    const a = frameOf(['hello']);
    const b = frameOf(['he']);
    const out = renderFrameDiff(a, b);
    expect(out).toContain('he');
    expect(out).toContain(SGR_RESET + EL); // 复位紧邻 EL
    // EL 纪律负断言：擦除不走空格填充（输出无 ≥2 连续空格游程）
    expect(out).not.toMatch(/ {2,}/);
  });

  it('行清空：整行变空白 → 定位行首 + 复位 + EL、零空格填充', () => {
    const a = frameOf(['hello']);
    const b = frameOf(['']);
    const out = renderFrameDiff(a, b);
    expect(out).toContain('\x1b[1;1H' + SGR_RESET + EL);
    expect(out).not.toMatch(/ {2,}/);
  });

  it('行中内容洞：空格写字面（绝对列位不漂移）、尾洞交 EL', () => {
    const a = frameOf(['abc']);
    const b = frameOf(['a c']); // 中洞空格
    const out = renderFrameDiff(a, b);
    expect(out).toContain('a c');
  });

  it('样式行：属性 + 16 色经 SGR 序列落字节', () => {
    const grid = new CellGrid(20, 4);
    grid.writeText(0, 0, 'red', { fg: ansiColor(1), bold: true });
    const out = renderFrameDiff(new CellGrid(20, 4), grid);
    expect(out).toContain('\x1b[1;31m'); // bold(1) + fg red(31)
    expect(out).toContain('red');
  });
});

describe('帧尾光标统一落位（显隐态跨帧去重）', () => {
  it('隐 → 显：SHOW + 定位', () => {
    const a = frameOf(['x']);
    const b = frameOf(['x']);
    b.setCursor(0, 1);
    const out = renderFrameDiff(a, b);
    expect(out.endsWith(SHOW + '\x1b[1;2H')).toBe(true);
  });

  it('显 → 隐：HIDE', () => {
    const a = frameOf(['x']);
    a.setCursor(0, 0);
    const b = frameOf(['x']);
    const out = renderFrameDiff(a, b);
    expect(out).toBe(HIDE);
  });

  it('同态去重：声明值全等且内容零变 → 光标零序列', () => {
    const a = frameOf(['x']);
    a.setCursor(0, 1);
    const b = frameOf(['x']);
    b.setCursor(0, 1);
    expect(renderFrameDiff(a, b)).toBe('');
  });

  it('同态但内容有写出：帧首抑制 + 帧尾恢复原位（配对）', () => {
    const a = frameOf(['x']);
    a.setCursor(0, 1);
    const b = frameOf(['y']); // 内容变、光标同态
    b.setCursor(0, 1);
    const out = renderFrameDiff(a, b);
    expect(out.startsWith(HIDE)).toBe(true); // 帧首抑制
    expect(out.endsWith(SHOW + '\x1b[1;2H')).toBe(true); // 帧尾恢复
  });

  it('光标位置迁移：帧尾重定位', () => {
    const a = frameOf(['x']);
    a.setCursor(0, 0);
    const b = frameOf(['x']);
    b.setCursor(2, 3);
    const out = renderFrameDiff(a, b);
    expect(out.endsWith(SHOW + '\x1b[3;4H')).toBe(true);
  });
});

describe('前置条件执法', () => {
  it('两帧几何不同 → fail-loud（resize 路径不走帧差分）', () => {
    const a = new CellGrid(20, 4);
    const b = new CellGrid(21, 4);
    expect(() => renderFrameDiff(a, b)).toThrow(/几何不同/);
  });
});
