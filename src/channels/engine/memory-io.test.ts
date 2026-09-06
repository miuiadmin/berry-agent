/**
 * MemoryTerminalIO 测试（07 引擎节件 1——引擎公开测试面自身行为）。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO } from './memory-io.js';

describe('MemoryTerminalIO', () => {
  it('write 收帧：逐帧记录 + 全文累积', () => {
    const io = new MemoryTerminalIO();
    io.write('a');
    io.write('b');
    expect(io.frames).toEqual(['a', 'b']);
    expect(io.bytes).toBe('ab');
  });

  it('emitInput 驱动全部输入监听器、退订后不收', () => {
    const io = new MemoryTerminalIO();
    const got: string[] = [];
    const off = io.onInput((data) => got.push(data));
    io.emitInput('x');
    off();
    io.emitInput('y');
    expect(got).toEqual(['x']);
  });

  it('emitResize 驱动 resize 监听器（几何由测试侧先行改定）', () => {
    const io = new MemoryTerminalIO();
    let resized = 0;
    io.onResize(() => resized++);
    io.columns = 100;
    io.emitResize();
    expect(resized).toBe(1);
    expect(io.size()).toEqual({ columns: 100, rows: 24 });
  });

  it('setRawMode / pause / resume 纯记账（断言素材归调用史）', () => {
    const io = new MemoryTerminalIO();
    io.setRawMode(true);
    io.setRawMode(false);
    io.pause();
    io.resume();
    expect(io.rawModeHistory).toEqual([true, false]);
    expect(io.pauseCount).toBe(1);
    expect(io.resumeCount).toBe(1);
  });

  it('reset 清输出账、监听器保留', () => {
    const io = new MemoryTerminalIO();
    const got: string[] = [];
    io.onInput((data) => got.push(data));
    io.write('old');
    io.reset();
    expect(io.bytes).toBe('');
    expect(io.frames).toEqual([]);
    io.emitInput('k');
    expect(got).toEqual(['k']);
  });
});
