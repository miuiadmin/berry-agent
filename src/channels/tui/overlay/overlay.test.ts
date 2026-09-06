/**
 * 浮层基建单测：OverlayStack（栈序覆盖 / 模态独占 / 句柄幂等）+
 * SelectPanel / ConfirmPanel（保守值 / 单次语义 / 高亮循环 / 铺底遮蔽）+
 * AltScreenHost（副屏编舞字节序互证：1049 进出对称 + 主屏复起全帧重画 +
 * 共享 io 放流接缝回归锁）。
 */
import { describe, expect, it, vi } from 'vitest';
import { CellGrid, Engine } from '../../engine/index.js';
import { MemoryTerminalIO } from '../../engine/memory-io.js';
import type { InputEvent, Renderable } from '../../engine/types.js';
import { AltScreenHost } from './alt-screen.js';
import { OverlayStack, type OverlayContent } from './overlay.js';
import { ConfirmPanel, SELECT_CANCELLED, SelectPanel } from './select-confirm.js';

/* ---------------- 助手 ---------------- */

/** 键事件便捷构造 */
function key(k: string, phase: 'press' | 'release' = 'press'): InputEvent {
  return { kind: 'key', key: k, ctrl: false, alt: false, shift: false, meta: false, phase };
}

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 单行文本浮层（渲染写文 + 事件收集） */
function textLayer(text: string): OverlayContent & { events: InputEvent[] } {
  const events: InputEvent[] = [];
  return {
    events,
    measure: () => 1,
    render: (buffer, region) => {
      buffer.writeText(region.row, region.col, text);
    },
    handleEvent(event) {
      events.push(event);
      return true;
    },
  };
}

/** 假钟（副屏编舞测试——定时器序确定可演） */
class FakeClock {
  public t = 0;
  private seq = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  public readonly now = (): number => this.t;
  public readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  public readonly cancel = (h: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id === h);
  };
  public advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      this.timers = this.timers.filter((timer) => timer !== due);
      due.fn();
    }
    this.t = target;
  }
}

/** 静态文本根（主树替身） */
function staticRoot(text: string): Renderable {
  return {
    measure: () => 1,
    render: (buffer, region) => {
      buffer.writeText(region.row, region.col, text);
    },
  };
}

/* ---------------- OverlayStack ---------------- */

describe('OverlayStack', () => {
  it('栈序渲染：栈顶覆盖栈底（后画赢）', () => {
    const stack = new OverlayStack();
    const grid = new CellGrid(20, 5);
    grid.writeText(2, 0, 'main-tree'); // 主树先画
    stack.open(textLayer('bottom'), () => ({ row: 1, col: 0, width: 10, height: 1 }));
    stack.open(textLayer('top!!'), () => ({ row: 1, col: 0, width: 10, height: 1 }));
    stack.renderAll(grid);
    expect(readRow(grid, 1, 20)).toBe('top!!m'); // 栈顶覆盖栈顶区；col 5 透出栈底 'bottom' 的 'm'（浮层只写自己写的格）
    expect(readRow(grid, 2, 20)).toBe('main-tree'); // 非浮层区不受扰
  });

  it('模态独占：栈非空恒返 true 且事件达栈顶；栈空返 false', () => {
    const stack = new OverlayStack();
    expect(stack.routeEvent(key('x'))).toBe(false); // 空栈归常态路由
    const bottom = textLayer('bottom');
    const top = textLayer('top');
    stack.open(bottom, () => ({ row: 0, col: 0, width: 5, height: 1 }));
    stack.open(top, () => ({ row: 0, col: 0, width: 5, height: 1 }));
    const unhandled = key('f9'); // 两层都不绑的键——也不穿透
    expect(stack.routeEvent(unhandled)).toBe(true);
    expect(top.events).toEqual([unhandled]);
    expect(bottom.events).toEqual([]); // 只达栈顶
  });

  it('句柄 close 幂等 + closed 态 + 非栈顶可关', () => {
    const stack = new OverlayStack();
    const bottom = textLayer('bottom');
    const top = textLayer('top');
    const h1 = stack.open(bottom, () => ({ row: 0, col: 0, width: 5, height: 1 }));
    stack.open(top, () => ({ row: 0, col: 0, width: 5, height: 1 }));
    expect(stack.size).toBe(2);
    h1.close(); // 非栈顶关闭
    expect(stack.size).toBe(1);
    expect(h1.closed).toBe(true);
    h1.close(); // 幂等
    expect(stack.size).toBe(1);
    // 栈顶独占切换回 bottom
    const ev = key('a');
    stack.routeEvent(ev);
    expect(bottom.events).toEqual([]);
  });

  it('onChange 开 / 关通知', () => {
    const stack = new OverlayStack();
    const spy = vi.fn();
    stack.onChange = spy;
    const handle = stack.open(textLayer('x'), () => ({ row: 0, col: 0, width: 5, height: 1 }));
    expect(spy).toHaveBeenCalledTimes(1);
    handle.close();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('anchor 收帧几何（浮层按帧定位）', () => {
    const stack = new OverlayStack();
    let seen: { width: number; height: number } | null = null;
    stack.open(textLayer('x'), (frame) => {
      seen = frame;
      return { row: 0, col: 0, width: 1, height: 1 };
    });
    const grid = new CellGrid(30, 12);
    stack.renderAll(grid);
    expect(seen).toEqual({ width: 30, height: 12 });
  });
});

/* ---------------- SelectPanel / ConfirmPanel ---------------- */

describe('SelectPanel', () => {
  const options = [
    { value: 'a', label: '选项甲', hint: 'hint-a' },
    { value: 'b', label: '选项乙' },
    { value: 'c', label: '选项丙' },
  ];

  it('↑/↓ 循环移动高亮、Enter 选定 onFinish 携 value', () => {
    const panel = new SelectPanel({ title: '选一个', options });
    const results: string[] = [];
    panel.onFinish = (v) => results.push(v);
    panel.handleEvent(key('down'));
    panel.handleEvent(key('enter'));
    expect(results).toEqual(['b']);
  });

  it('Esc 取消收空串（保守值——与撤销面同语义）', () => {
    const panel = new SelectPanel({ options });
    const results: string[] = [];
    panel.onFinish = (v) => results.push(v);
    panel.handleEvent(key('escape'));
    expect(results).toEqual([SELECT_CANCELLED]);
    expect(SELECT_CANCELLED).toBe('');
  });

  it('↑ 在顶部循环到底、单次语义（完成后不再触发）', () => {
    const panel = new SelectPanel({ options });
    const results: string[] = [];
    panel.onFinish = (v) => results.push(v);
    panel.handleEvent(key('up')); // 0 → 2（循环）
    panel.handleEvent(key('enter'));
    expect(results).toEqual(['c']);
    panel.handleEvent(key('enter')); // 完成态静默
    panel.handleEvent(key('down'));
    expect(results).toEqual(['c']);
  });

  it('release 相与修饰组合不动作', () => {
    const panel = new SelectPanel({ options });
    const results: string[] = [];
    panel.onFinish = (v) => results.push(v);
    panel.handleEvent(key('enter', 'release'));
    panel.handleEvent({ kind: 'key', key: 'enter', ctrl: true, alt: false, shift: false, meta: false, phase: 'press' });
    expect(results).toEqual([]);
  });

  it('渲染：铺底空格遮下层 + 高亮行反色 + 说明右对齐 dim + 标题 accent', () => {
    const panel = new SelectPanel({ title: '标题', options });
    const grid = new CellGrid(24, 5);
    grid.writeText(1, 0, '████████████████████████'); // 下层主树文字
    panel.render(grid, { row: 0, col: 0, width: 24, height: 4 }); // 1 标题 + 3 选项
    expect(readRow(grid, 0, 24)).toBe('标题');
    expect(readRow(grid, 1, 24)).toBe('❯ 选项甲          hint-a'); // 8 格 + 10 空格 + 右对齐说明
    expect(grid.getCell(1, 0)?.style.inverse).toBe(true); // 高亮行反色
    expect(grid.getCell(1, 18)?.style.dim).toBe(true); // 说明段 dim
    expect(readRow(grid, 2, 24)).toBe('  选项乙');
    expect(grid.getCell(2, 0)?.style.inverse).toBeUndefined();
    // 铺底遮蔽：选项行右侧无主树 █ 残留（未写格 = null，写格空格遮下层）
    const cell = grid.getCell(1, 17);
    expect(cell?.grapheme).toBe(' ');
  });

  it('未接线 onFinish 时 Enter 不炸（防御位）', () => {
    const panel = new SelectPanel({ options });
    expect(() => panel.handleEvent(key('enter'))).not.toThrow();
  });
});

describe('ConfirmPanel', () => {
  it('Enter / y 确认 true、Esc / n 取消 false（保守值）', () => {
    const p1 = new ConfirmPanel({ message: '确认吗' });
    const got1: boolean[] = [];
    p1.onFinish = (v) => got1.push(v);
    p1.handleEvent(key('enter'));
    expect(got1).toEqual([true]);
    const p2 = new ConfirmPanel({ message: '确认吗' });
    const got2: boolean[] = [];
    p2.onFinish = (v) => got2.push(v);
    p2.handleEvent(key('y'));
    expect(got2).toEqual([true]);
    const p3 = new ConfirmPanel({ message: '确认吗' });
    const got3: boolean[] = [];
    p3.onFinish = (v) => got3.push(v);
    p3.handleEvent(key('escape'));
    expect(got3).toEqual([false]);
    const p4 = new ConfirmPanel({ message: '确认吗' });
    const got4: boolean[] = [];
    p4.onFinish = (v) => got4.push(v);
    p4.handleEvent(key('n'));
    expect(got4).toEqual([false]);
  });

  it('渲染：消息 + 键提示 dim + 铺底遮蔽', () => {
    const panel = new ConfirmPanel({ message: '删除这条记忆？' });
    const grid = new CellGrid(30, 3);
    grid.writeText(0, 0, 'underlying-tree-text');
    panel.render(grid, { row: 0, col: 0, width: 30, height: 2 });
    expect(readRow(grid, 0, 30)).toBe('删除这条记忆？');
    expect(readRow(grid, 1, 30)).toBe('enter 确认 · esc 取消');
    expect(grid.getCell(1, 0)?.style.dim).toBe(true);
  });

  it('单次语义：完成后静默', () => {
    const panel = new ConfirmPanel({ message: 'm' });
    const got: boolean[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('enter'));
    panel.handleEvent(key('escape'));
    expect(got).toEqual([true]);
  });
});

/* ---------------- AltScreenHost ---------------- */

describe('AltScreenHost 副屏编舞', () => {
  const ENTER_INLINE = '\x1b[?25l\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c';
  const LEAVE_INLINE = '\x1b[<u\x1b[?2004l\x1b[?25h';
  const ENTER_ALT = '\x1b[?1049h' + ENTER_INLINE;
  const LEAVE_ALT = LEAVE_INLINE + '\x1b[?1049l';

  /** 装配：共享 MemoryTerminalIO 的主屏 + 副屏宿主（各持假钟） */
  function rig() {
    const io = new MemoryTerminalIO(40, 6);
    const mainClock = new FakeClock();
    const altClock = new FakeClock();
    const primary = new Engine({
      io,
      now: mainClock.now,
      schedule: mainClock.schedule,
      cancelSchedule: mainClock.cancel,
    });
    primary.start(staticRoot('primary-frame'));
    mainClock.advance(0); // 主屏首帧出
    const host = new AltScreenHost(primary, io, {
      engineOptions: { now: altClock.now, schedule: altClock.schedule, cancelSchedule: altClock.cancel },
    });
    return { io, primary, host, mainClock, altClock };
  }

  /** 副屏内容：写文 + 事件收集 */
  function altContent(text: string): OverlayContent & { events: InputEvent[] } {
    return textLayer(text);
  }

  it('open 编舞字节序：主屏挂起 → 副屏 1049 进 + 副屏首帧', () => {
    const { io, host, altClock } = rig();
    io.reset(); // 主屏首帧断言后清账——聚焦编舞序
    host.open(altContent('alt-frame'));
    altClock.advance(0);
    expect(io.frames[0]).toBe(LEAVE_INLINE); // 主屏挂起（inline 出屏串）
    expect(io.frames[1]).toBe(ENTER_ALT); // 副屏进（1049h + 公共尾）
    expect(io.frames[2]).toContain('alt-frame'); // 副屏首帧
  });

  it('close 编舞字节序：副屏出 → 主屏复起 + 全帧重画（不走 repaint）', () => {
    const { io, host, mainClock, altClock } = rig();
    const handle = host.open(altContent('alt-frame'));
    expect(handle).not.toBeNull();
    altClock.advance(0);
    io.reset(); // 副屏首帧断言后清账——聚焦收屏序
    handle!.close();
    mainClock.advance(20); // 复起帧在帧率帽点（距上帧 ≥1/60s）——推进过帽
    expect(io.frames[0]).toBe(LEAVE_ALT); // 副屏出（公共头 + 1049l）
    expect(io.frames[1]).toBe(ENTER_INLINE); // 主屏复起（inline 进屏串）
    expect(io.frames[2]).toContain('primary-frame'); // 主屏全帧重画（forceFull）
  });

  it('open 拒绝位：主屏非 running 返 null；已开再开返 null', () => {
    const io = new MemoryTerminalIO(40, 6);
    const primary = new Engine({ io }); // 未 start——非 running
    const host = new AltScreenHost(primary, io);
    expect(host.open(altContent('x'))).toBeNull();
    primary.start(staticRoot('p'));
    const handle = host.open(altContent('a'));
    expect(handle).not.toBeNull();
    expect(host.open(altContent('b'))).toBeNull(); // 无嵌套备屏
    handle!.close();
  });

  it('输入路由切换：副屏在场输入达副屏内容（主树不经手）', () => {
    const { io, host } = rig();
    const content = altContent('alt');
    host.open(content);
    io.emitInput('a'); // 共享 io 字节流——仅副屏在听
    expect(content.events.map((e) => (e.kind === 'key' ? e.key : e.kind))).toContain('text');
  });

  it('共享 io 放流接缝：主屏挂起 pause 后副屏 start 显式 resume（回归锁）', () => {
    const { io, host } = rig();
    const pausedAt = io.pauseCount; // 主屏挂起将 +1
    const before = io.resumeCount;
    host.open(altContent('x'));
    expect(io.pauseCount).toBe(pausedAt + 1); // 主屏挂起已 pause
    expect(io.resumeCount).toBe(before + 1); // 副屏 start 显式放流
  });

  it('onReturn 钩在出副屏后调一次（主屏 resume 之后）', () => {
    const io = new MemoryTerminalIO(40, 6);
    const mainClock = new FakeClock();
    const altClock = new FakeClock();
    const primary = new Engine({
      io,
      now: mainClock.now,
      schedule: mainClock.schedule,
      cancelSchedule: mainClock.cancel,
    });
    primary.start(staticRoot('p'));
    mainClock.advance(0);
    const onReturn = vi.fn();
    const host = new AltScreenHost(primary, io, {
      onReturn,
      engineOptions: { now: altClock.now, schedule: altClock.schedule, cancelSchedule: altClock.cancel },
    });
    const handle = host.open(altContent('a'));
    expect(onReturn).not.toHaveBeenCalled(); // 副屏在场不调
    handle!.close();
    expect(onReturn).toHaveBeenCalledTimes(1); // 出副屏调一次
    handle!.close(); // 句柄幂等——不再调
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
