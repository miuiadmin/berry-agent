/**
 * oracle 字节互证（07 引擎节 TUI 测试策略第 3 层——@xterm/headless 第二
 * 真相源：自产 ANSI 不用自家解析器自证）。
 *
 * 断言族：EL 纪律负断言（无空格游程）/ 未变内容零写出 / 字素差分回归锁 /
 * 宽度互证（续格同构断言）。共享测试助手纪律：src 内零测试依赖——
 * @xterm/headless 只进本测试文件，产码面永不 import（依赖倒置）。
 */
import { Terminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { CellGrid } from './cell.js';
import { renderFrameDiff } from './diff.js';
import type { CellBuffer } from './types.js';

/** 网格行 → 可见文本投影（首格字素连接跳续格、未写格写字面空格保列位、
 * 右尾默认空格裁齐——与 xterm translateToString(true) 同语义，互证比对基准） */
function projectRow(buf: CellBuffer, row: number): string {
  let s = '';
  for (let col = 0; col < buf.columns; col++) {
    const cell = buf.getCell(row, col);
    if (cell === null)
      s += ' '; // 未写格 = 空格占位（列位不漂移）
    else if (cell.width === 0)
      continue; // 续格无字面
    else s += cell.grapheme;
  }
  return s.replace(/\s+$/, '');
}

/** 建 oracle 终端并把差分写出喂入（模拟真终端字节流消费；getCell 系
 * proposed API——测试侧显式开启，产码面无涉。xterm write 异步解析——
 * 逐块经回调确认落屏后再读，防时序假绿） */
async function feed(cols: number, rows: number, ...chunks: string[]): Promise<Terminal> {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  for (const chunk of chunks) {
    await new Promise<void>((resolve) => term.write(chunk, () => resolve()));
  }
  return term;
}

describe('首帧全屏互证（自产 ANSI → xterm 渲染 = 网格投影）', () => {
  it('CJK / emoji / 样式行全屏逐行比对', async () => {
    const from = new CellGrid(24, 6);
    const to = new CellGrid(24, 6);
    to.writeText(0, 0, 'hello 中文世界');
    to.writeText(1, 0, 'flag 🇨🇳 tone 👍🏿 ok'); // ZWJ 家族不在 oracle 射界（见下注），肤色修饰同构 2 列
    to.writeText(2, 0, 'plain row');
    to.writeText(3, 0, 'styled', { inverse: true, underline: true });
    const out = renderFrameDiff(from, to);
    const term = await feed(24, 6, out);
    for (let row = 0; row < 6; row++) {
      expect(term.buffer.active.getLine(row)?.translateToString(true)).toBe(projectRow(to, row));
    }
  });
});

describe('宽度互证（续格同构断言）', () => {
  it('宽字符占双列：xterm 内部续格空位与本网格续格同构', async () => {
    const from = new CellGrid(10, 2);
    const to = new CellGrid(10, 2);
    to.writeText(0, 0, '中a'); // 中占 [0,1] a 在 2
    const term = await feed(10, 2, renderFrameDiff(from, to));
    const line = term.buffer.active.getLine(0);
    expect(line?.getCell(0)?.getChars()).toBe('中'); // 首格字素
    expect(line?.getCell(1)?.getChars()).toBe(''); // 续格空——与本网格 width 0 同构
    expect(line?.getCell(2)?.getChars()).toBe('a'); // 后续字符绝对列位不漂移
  });

  it('行中内容洞：宽字后隔列写、绝对定位经字面空格保持', async () => {
    const from = new CellGrid(10, 2);
    const to = new CellGrid(10, 2);
    to.setCell(0, 0, '中');
    to.setCell(0, 3, 'x'); // 洞占 col 1-2
    const term = await feed(10, 2, renderFrameDiff(from, to));
    const line = term.buffer.active.getLine(0);
    expect(line?.getCell(3)?.getChars()).toBe('x'); // 洞经字面空格填——x 位不错漂
    expect(line?.translateToString(true)).toBe(projectRow(to, 0));
  });
});

describe('二帧连续性（增量差分不出屏错位）', () => {
  it('帧 1 落屏 → 帧 2 增量 → xterm 屏 = 帧 2 投影（未变行字节零写出仍保持）', async () => {
    const a = new CellGrid(24, 6);
    const b = new CellGrid(24, 6);
    const c = new CellGrid(24, 6);
    b.writeText(0, 0, 'first line 中文');
    b.writeText(1, 0, 'second line');
    b.writeText(2, 0, 'third');
    c.writeText(0, 0, 'first line 中文');
    c.writeText(1, 0, 'SECOND shortened'); // 行变
    c.writeText(2, 0, 'third');
    const frame1 = renderFrameDiff(a, b);
    const frame2 = renderFrameDiff(b, c);
    // 未变内容零写出：帧 2 不含未变两行内容
    expect(frame2).not.toContain('first');
    expect(frame2).not.toContain('third');
    const term = await feed(24, 6, frame1, frame2);
    for (let row = 0; row < 6; row++) {
      expect(term.buffer.active.getLine(row)?.translateToString(true)).toBe(projectRow(c, row));
    }
  });

  it('行缩短 EL 互证：xterm 行尾残留真被擦净（非空格遮盖）', async () => {
    const a = new CellGrid(24, 4);
    const b = new CellGrid(24, 4);
    const c = new CellGrid(24, 4);
    b.writeText(0, 0, 'hello world 中文');
    c.writeText(0, 0, 'hi');
    const frame2 = renderFrameDiff(b, c);
    // EL 纪律负断言：擦除无空格游程
    expect(frame2).not.toMatch(/ {2,}/);
    const term = await feed(24, 4, renderFrameDiff(a, b), frame2);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('hi');
    // 残留擦净证据：行 0 第 3 列起全空（若靠空格遮盖，getCell 仍是空格——
    // 以 xterm 行宽语义断言：translateToString(false) 右尾必为空白）
    const raw = term.buffer.active.getLine(0)?.translateToString(false) ?? '';
    expect(raw.slice(2).trim()).toBe('');
  });
});

describe('字素差分回归锁（多码点字素覆写不混叠）', () => {
  it('VS16 呈现形覆写为普通字素：oracle 屏无残字素', async () => {
    const a = new CellGrid(20, 4);
    const b = new CellGrid(20, 4);
    const c = new CellGrid(20, 4);
    b.writeText(0, 0, 'ok ✓️!'); // ✓️ = ✓ + VS16（宽 2 呈现形）
    c.writeText(0, 0, 'ok X!'); // 同首区覆写为普通字符
    const term = await feed(20, 4, renderFrameDiff(a, b), renderFrameDiff(b, c));
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('ok X!');
  });

  it('emoji + 肤色修饰字素覆写：oracle 屏整素等价', async () => {
    // 注：ZWJ 家族（👨‍👩‍👧）**不在 oracle 互证射界**——xterm 按码点占宽
    // （三 emoji 各 2 列）、本引擎按字素（整素 2 列），终端生态本就分裂
    // （kitty 字素形 / xterm 码点形）——规范四规则以字素为准，ZWJ 家族
    // 断言留在 width / cell 结构层；肤色修饰（emoji + 零宽附着）两模型同构
    const a = new CellGrid(20, 4);
    const b = new CellGrid(20, 4);
    const c = new CellGrid(20, 4);
    const toned = '👍🏿'; // 👍 + U+1F3FF——单字素宽 2，xterm 同占 2 列
    b.writeText(0, 0, `x${toned}y`);
    c.writeText(0, 0, `x中y`); // 宽字素换宽字素——摘痕后整位重写
    const term = await feed(20, 4, renderFrameDiff(a, b), renderFrameDiff(b, c));
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe(projectRow(c, 0));
  });
});
