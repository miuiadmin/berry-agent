/**
 * 浮层基建单测：OverlayStack（栈序覆盖 / 模态独占 / 句柄幂等）+
 * SelectPanel / ConfirmPanel（保守值 / 单次语义 / 高亮循环 / 铺底遮蔽）+
 * AltScreenHost（副屏编舞序互证：1049 进出对称 + 主屏挂起 / 复起交出面调用
 * 序 + 共享 io 放流接缝回归锁）。
 *
 * 批 10f-4 主屏绑收窄：primary 改 AltScreenPrimary 窄介面假件（主屏字节面
 * 归 tui-backend 直测——本件只锁编舞调用序与副屏字节序）。
 */
import { describe, expect, it, vi } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { MemoryTerminalIO } from '../../engine/memory-io.js';
import type { InputEvent } from '../../engine/types.js';
import { AltScreenHost, type AltScreenPrimary } from './alt-screen.js';
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

  it('contents 观测面：栈底→栈顶只读快照，开关联动（装配量高遍历消费）', () => {
    const stack = new OverlayStack();
    expect(stack.contents).toEqual([]);
    const a = textLayer('a');
    const b = textLayer('b');
    const handleA = stack.open(a, () => ({ row: 0, col: 0, width: 1, height: 1 }));
    stack.open(b, () => ({ row: 0, col: 0, width: 1, height: 1 }));
    expect(stack.contents).toEqual([a, b]); // 栈底先、栈顶后
    handleA.close();
    expect(stack.contents).toEqual([b]); // 关联动
    handleA.close(); // 幂等关不重复移除
    expect(stack.contents).toEqual([b]);
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
  const ENTER_ALT = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c';
  const LEAVE_ALT = '\x1b[<u\x1b[?2004l\x1b[?25h\x1b[?1049l';

  /**
   * 主屏假件（AltScreenPrimary 窄介面替身——批 10f-4）：记录编舞调用序
   * （callsAtFrames 锚各调用时点的已写帧数——与副屏字节序互证）+ 承担主屏
   * 侧停流 / 放流账（生产 TuiBackend.suspendMain / resumeMain 同形——放流
   * 接缝回归锁的账源）。主屏字节面（出屏串 / 全帧重画）归 tui-backend 直测。
   */
  class FakePrimary implements AltScreenPrimary {
    readonly calls: string[] = [];
    readonly callsAtFrames: number[] = [];
    state: 'idle' | 'running' | 'suspended' | 'disposed' = 'idle';
    constructor(private readonly io: MemoryTerminalIO) {}
    get lifecycle(): 'idle' | 'running' | 'suspended' | 'disposed' {
      return this.state;
    }
    suspendMain(): void {
      this.calls.push('suspendMain');
      this.callsAtFrames.push(this.io.frames.length);
      this.state = 'suspended';
      this.io.pause(); // 主屏侧停流（共享 io 换防——Engine suspend 同形）
    }
    resumeMain(): void {
      this.calls.push('resumeMain');
      this.callsAtFrames.push(this.io.frames.length);
      this.state = 'running';
      this.io.resume(); // 主屏侧放流（复起半场——共享 io 换防接缝）
    }
  }

  /** 装配：共享 MemoryTerminalIO 的主屏假件 + 副屏宿主（副屏持假钟） */
  function rig() {
    const io = new MemoryTerminalIO(40, 6);
    const primary = new FakePrimary(io);
    primary.state = 'running'; // 主屏在场的替身初态
    const altClock = new FakeClock();
    const host = new AltScreenHost(primary, io, {
      engineOptions: { now: altClock.now, schedule: altClock.schedule, cancelSchedule: altClock.cancel },
    });
    return { io, primary, host, altClock };
  }

  /** 副屏内容：写文 + 事件收集 */
  function altContent(text: string): OverlayContent & { events: InputEvent[] } {
    return textLayer(text);
  }

  it('open 编舞序：主屏挂起在前（零写出时点）→ 副屏 1049 进 + 副屏首帧', () => {
    const { io, primary, host, altClock } = rig();
    host.open(altContent('alt-frame'));
    altClock.advance(0);
    expect(primary.calls).toEqual(['suspendMain']); // 主屏挂起恰一次
    expect(primary.callsAtFrames[0]).toBe(0); // 挂起先于副屏任何字节（帧账 0 时点调）
    expect(io.frames[0]).toBe(ENTER_ALT); // 副屏进屏是首帧（1049h + 公共尾）
    expect(io.frames[1]).toContain('alt-frame'); // 副屏首帧
  });

  it('close 编舞序：副屏出在前 → 主屏复起（对称反序）', () => {
    const { io, primary, host, altClock } = rig();
    const handle = host.open(altContent('alt-frame'));
    expect(handle).not.toBeNull();
    altClock.advance(0);
    io.reset(); // 副屏首帧断言后清账——聚焦收屏序
    handle!.close();
    expect(io.frames[0]).toBe(LEAVE_ALT); // 副屏出（公共头 + 1049l）
    expect(primary.calls).toEqual(['suspendMain', 'resumeMain']); // 复起恰一次
    expect(primary.callsAtFrames[1]).toBe(1); // 复起在副屏出屏帧之后（帧账 1 时点调——序锁）
    expect(primary.state).toBe('running');
  });

  it('open 拒绝位：主屏非 running 返 null；已开再开返 null', () => {
    const io = new MemoryTerminalIO(40, 6);
    const primary = new FakePrimary(io); // state = idle——非 running
    const host = new AltScreenHost(primary, io);
    expect(host.open(altContent('x'))).toBeNull();
    primary.state = 'running';
    const handle = host.open(altContent('a'));
    expect(handle).not.toBeNull();
    expect(host.open(altContent('b'))).toBeNull(); // 无嵌套备屏
    handle!.close();
  });

  it('输入路由切换：副屏在场输入达副屏内容（主屏假件不经手）', () => {
    const { io, host } = rig();
    const content = altContent('alt');
    host.open(content);
    io.emitInput('a'); // 共享 io 字节流——仅副屏在听（主屏挂起已卸监听）
    expect(content.events.map((e) => (e.kind === 'key' ? e.key : e.kind))).toContain('text');
  });

  it('共享 io 放流接缝：主屏挂起 pause → 副屏 start 显式 resume；副屏 dispose pause → 主屏复起 resume（回归锁·进出两半场）', () => {
    const { io, host } = rig();
    const pausedAt = io.pauseCount;
    const before = io.resumeCount;
    const handle = host.open(altContent('x'));
    expect(handle).not.toBeNull();
    expect(io.pauseCount).toBe(pausedAt + 1); // 主屏挂起已 pause
    expect(io.resumeCount).toBe(before + 1); // 副屏 start 显式放流
    const pausedAt2 = io.pauseCount;
    const before2 = io.resumeCount;
    handle!.close();
    expect(io.pauseCount).toBe(pausedAt2 + 1); // 副屏 dispose 已 pause
    expect(io.resumeCount).toBe(before2 + 1); // 主屏复起放流（对称半场）
  });

  it('onReturn 钩在出副屏后调一次（主屏 resumeMain 之后）', () => {
    const io = new MemoryTerminalIO(40, 6);
    const primary = new FakePrimary(io);
    primary.state = 'running';
    const altClock = new FakeClock();
    const onReturn = vi.fn();
    const host = new AltScreenHost(primary, io, {
      onReturn,
      engineOptions: { now: altClock.now, schedule: altClock.schedule, cancelSchedule: altClock.cancel },
    });
    const handle = host.open(altContent('a'));
    expect(onReturn).not.toHaveBeenCalled(); // 副屏在场不调
    handle!.close();
    expect(onReturn).toHaveBeenCalledTimes(1); // 出副屏调一次
    expect(primary.calls).toEqual(['suspendMain', 'resumeMain']); // resumeMain 先于钩（编舞序）
    handle!.close(); // 句柄幂等——不再调
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
