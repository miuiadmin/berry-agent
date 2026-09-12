/**
 * ProcessTerminalIO 直测（07 引擎节件 5 真终端适配器——批 10c 落码至今零直接
 * 执行：引擎测试全走 MemoryTerminalIO 注入，process 直连分支是真缺口）。
 *
 * 桩法：vi.stubGlobal 换全局 process 为最小记录假件——本件无依赖注入位，
 * 直引全局 process 是刻意的「唯一进程接缝」设计，测试经全局桩入（每例后
 * unstubAllGlobals 复原，桩窗内零 console 输出防误写假件）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessTerminalIO } from './process-io.js';

/** 假监听器形（参数逆变安全位：任意具体参数签名的监听器皆可挂入） */
type AnyListener = (...args: never[]) => void;

/**
 * 最小记录假 process：stdout 记写出与尺寸、stdin 记键面调用与监听器账。
 * columns/rows/isTTY/isRaw 缺省 undefined 即兜底路径与非 TTY 态触发器。
 */
function fakeProcess(overrides?: { columns?: number; rows?: number; isTTY?: boolean; isRaw?: boolean }) {
  const writes: string[] = [];
  const rawModeCalls: boolean[] = [];
  const encodings: string[] = [];
  const flow = { paused: 0, resumed: 0 };
  const stdoutListeners = new Map<string, Set<AnyListener>>();
  const stdinListeners = new Map<string, Set<AnyListener>>();
  /** 挂/摘监听器账（on/removeListener 与真 process 同名面） */
  const bind = (book: Map<string, Set<AnyListener>>) => ({
    on: (event: string, fn: AnyListener) => {
      let set = book.get(event);
      if (set === undefined) {
        set = new Set();
        book.set(event, set);
      }
      set.add(fn);
    },
    removeListener: (event: string, fn: AnyListener) => {
      book.get(event)?.delete(fn);
    },
  });
  const out = bind(stdoutListeners);
  const inb = bind(stdinListeners);
  return {
    writes,
    rawModeCalls,
    encodings,
    flow,
    stdoutListeners,
    stdinListeners,
    process: {
      stdout: {
        write: (data: string) => {
          writes.push(data);
          return true;
        },
        columns: overrides?.columns,
        rows: overrides?.rows,
        on: out.on,
        removeListener: out.removeListener,
      },
      stdin: {
        isTTY: overrides?.isTTY,
        isRaw: overrides?.isRaw,
        setRawMode: (enable: boolean) => {
          rawModeCalls.push(enable);
        },
        pause: () => {
          flow.paused += 1;
        },
        resume: () => {
          flow.resumed += 1;
        },
        setEncoding: (enc: string) => {
          encodings.push(enc);
        },
        on: inb.on,
        removeListener: inb.removeListener,
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProcessTerminalIO（process 直连适配器）', () => {
  it('write：收什么写什么（stdout 直写透传）', () => {
    const f = fakeProcess();
    vi.stubGlobal('process', f.process);
    new ProcessTerminalIO().write('\x1b[2J你好');
    expect(f.writes).toEqual(['\x1b[2J你好']);
  });

  it('size：TTY 真值透传', () => {
    const f = fakeProcess({ columns: 132, rows: 43 });
    vi.stubGlobal('process', f.process);
    expect(new ProcessTerminalIO().size()).toEqual({ columns: 132, rows: 43 });
  });

  it('size：columns/rows 缺席兜底 80×24（非 TTY 场景的期望面）', () => {
    const f = fakeProcess();
    vi.stubGlobal('process', f.process);
    expect(new ProcessTerminalIO().size()).toEqual({ columns: 80, rows: 24 });
  });

  it('size：winsize 零值兜底 80×24（pty 未设尺寸——isTTY 在场而 rows/columns=0 的真机形态，2026-09-13 真模型五轮实测定罪）', () => {
    const f = fakeProcess({ columns: 0, rows: 0, isTTY: true });
    vi.stubGlobal('process', f.process);
    expect(new ProcessTerminalIO().size()).toEqual({ columns: 80, rows: 24 });
  });

  it('setRawMode：TTY 态两向透传', () => {
    const f = fakeProcess({ isTTY: true });
    vi.stubGlobal('process', f.process);
    const io = new ProcessTerminalIO();
    io.setRawMode(true);
    io.setRawMode(false);
    expect(f.rawModeCalls).toEqual([true, false]);
  });

  it('setRawMode：非 TTY 静默跳过（先查 isTTY——真 setRawMode 在非 TTY 上会抛）', () => {
    const f = fakeProcess({ isTTY: false });
    vi.stubGlobal('process', f.process);
    const io = new ProcessTerminalIO();
    expect(() => io.setRawMode(true)).not.toThrow();
    expect(f.rawModeCalls).toEqual([]);
  });

  it('isRaw：真值透传 / undefined 兜底 false', () => {
    vi.stubGlobal('process', fakeProcess({ isRaw: true }).process);
    expect(new ProcessTerminalIO().isRaw()).toBe(true);
    vi.stubGlobal('process', fakeProcess().process);
    expect(new ProcessTerminalIO().isRaw()).toBe(false);
  });

  it('pause/resume：stdin 流控透传', () => {
    const f = fakeProcess();
    vi.stubGlobal('process', f.process);
    const io = new ProcessTerminalIO();
    io.pause();
    io.resume();
    expect(f.flow).toEqual({ paused: 1, resumed: 1 });
  });

  it('onInput：utf8 编码声明 + data 监听挂载/回调透传/卸载函数摘监听', () => {
    const f = fakeProcess();
    vi.stubGlobal('process', f.process);
    const io = new ProcessTerminalIO();
    const got: string[] = [];
    const off = io.onInput((data) => {
      got.push(data);
    });
    expect(f.encodings).toEqual(['utf8']);
    expect(f.stdinListeners.get('data')?.size).toBe(1);
    for (const fn of f.stdinListeners.get('data') ?? []) (fn as (data: string) => void)('中文 chunk');
    expect(got).toEqual(['中文 chunk']);
    off();
    expect(f.stdinListeners.get('data')?.size ?? 0).toBe(0);
  });

  it('onResize：resize 监听挂载/回调透传/卸载函数摘监听', () => {
    const f = fakeProcess();
    vi.stubGlobal('process', f.process);
    const io = new ProcessTerminalIO();
    let fired = 0;
    const off = io.onResize(() => {
      fired += 1;
    });
    expect(f.stdoutListeners.get('resize')?.size).toBe(1);
    for (const fn of f.stdoutListeners.get('resize') ?? []) (fn as () => void)();
    expect(fired).toBe(1);
    off();
    expect(f.stdoutListeners.get('resize')?.size ?? 0).toBe(0);
  });
});
