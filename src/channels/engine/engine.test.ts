/**
 * Engine 编排单测（07 篇引擎节件 5——注入假钟 + 假 IO 的帧管线时序全景：
 * 请求合并 / 帧率帽 / 零变更双零 / 生命周期闸门 / resize 弃旧换新 / 挂起
 * 复起交出面 / drainInput / 双形态模式串严格对称反序）。
 *
 * MemoryTerminalIO（引擎公开测试面）+ FakeClock（schedule/cancel 可注入
 * ——vitest 假定时器不用，自持推演确定序）。
 */
import { describe, expect, it } from 'vitest';
import { Engine } from './engine.js';
import { MemoryTerminalIO } from './memory-io.js';
import type { InputEvent, KeyEvent, Renderable } from './types.js';

/** 假钟：手推时间（now/schedule/cancel 注入引擎——定时器序确定可演） */
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
    this.timers = this.timers.filter((timer) => timer.id !== h);
  };
  /** 推进时间：依到期序执行定时器（执行中可再排——循环推进至 target） */
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
  /** 在飞定时器数（请求合并断言用） */
  public pending = (): number => this.timers.length;
}

/** 可变文本根（渲染树替身——setLines 换内容触发差分） */
function makeRoot(initial: string[] = []): Renderable & { setLines(lines: string[]): void } {
  let lines = initial;
  return {
    measure: () => Math.max(1, lines.length),
    render(buffer, region) {
      buffer.clearCursor();
      for (let i = 0; i < lines.length && i < region.height; i++) {
        buffer.writeText(region.row + i, region.col, lines[i] ?? '');
      }
    },
    setLines(next: string[]): void {
      lines = next;
    },
  };
}

/** 装配：假钟 + 假 IO + 引擎 + 事件收集（多数用例的形） */
function rig(screen?: 'inline' | 'alt-screen'): {
  engine: Engine;
  io: MemoryTerminalIO;
  clock: FakeClock;
  inputs: InputEvent[];
  root: ReturnType<typeof makeRoot>;
} {
  const io = new MemoryTerminalIO(40, 6);
  const clock = new FakeClock();
  const engine = new Engine({
    io,
    ...(screen ? { screen } : {}),
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
  });
  const inputs: InputEvent[] = [];
  engine.on('input', (ev) => inputs.push(ev));
  const root = makeRoot(['hello']);
  engine.start(root);
  return { engine, io, clock, inputs, root };
}

const ENTER_INLINE = '\x1b[?25l\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c';
const LEAVE_INLINE = '\x1b[<u\x1b[?2004l\x1b[?25h';
const ENTER_ALT = '\x1b[?1049h' + ENTER_INLINE + '\x1b[?1002h\x1b[?1006h'; // + 鼠标准入（mu-2）
const LEAVE_ALT = '\x1b[?1006l\x1b[?1002l' + LEAVE_INLINE + '\x1b[?1049l'; // 鼠标关停前置（对称反序）

describe('帧管线（请求合并 + 帧率帽 + 按需渲染）', () => {
  it('首帧全量：进屏模式串 + DECSET 2026 包裹 + 内容', () => {
    const { engine, io, clock } = rig();
    expect(io.frames[0]).toBe(ENTER_INLINE); // 进屏模式串独立首帧
    clock.advance(0); // 首帧 due=0 立即出
    expect(io.frames.length).toBe(2);
    // 帧体：2026 包裹 + 首行内容
    expect(io.frames[1]).toContain('\x1b[?2026h');
    expect(io.frames[1]).toContain('hello');
    expect(io.frames[1]?.endsWith('\x1b[?2026l')).toBe(true);
    expect(engine.lifecycle).toBe('running');
  });

  it('请求合并：同拍多次请求一帧收（在飞定时器不另排）', () => {
    const { engine, io, clock, root } = rig();
    clock.advance(0); // 首帧已出
    io.reset();
    root.setLines(['changed']); // 请求前换内容（保证帧非零变更）
    engine.requestRender();
    engine.requestRender();
    engine.requestRender();
    expect(clock.pending()).toBe(1); // 三请求一定时器——合并位
    clock.advance(20);
    expect(io.frames.length).toBe(1); // 一帧收
  });

  it('无请求全静默：多次推进零写出', () => {
    const { io, clock } = rig();
    clock.advance(0);
    io.reset();
    for (let i = 0; i < 10; i++) clock.advance(10);
    expect(io.frames.length).toBe(0);
  });

  it('FPS 帽：距上帧不足帧间隔排帽点（60fps → 16ms 下限）', () => {
    const { engine, io, clock, root } = rig();
    clock.advance(0); // t=0 首帧
    io.reset();
    root.setLines(['changed']);
    engine.requestRender();
    expect(clock.pending()).toBe(1); // 排到帽点
    clock.advance(16); // t=16——帧间隔 16.67ms 未满
    expect(io.frames.length).toBe(0);
    clock.advance(1); // t=17——帽点过，出帧
    expect(io.frames.length).toBe(1);
  });

  it('零变更双零：内容与光标均零变更 → 整帧零写出', () => {
    const { engine, io, clock } = rig();
    clock.advance(0);
    const framesAfterFirst = io.frames.length;
    engine.requestRender();
    clock.advance(20); // 根内容不变——差分零
    expect(io.frames.length).toBe(framesAfterFirst); // 双零——不写帧
  });

  it('内容变更：增量差分写出（未变行零写出）', () => {
    const { engine, io, clock, root } = rig();
    clock.advance(0);
    io.reset();
    root.setLines(['hello', 'world']);
    engine.requestRender();
    clock.advance(20);
    expect(io.frames.length).toBe(1);
    expect(io.frames[0]).toContain('world');
    expect(io.frames[0]).not.toContain('hello'); // 未变行零写出
  });
});

describe('生命周期闸门（竞态不靠时序靠闸门）', () => {
  it('挂起后残听输入静默吞', () => {
    const { engine, io, inputs } = rig();
    engine.suspend();
    io.emitInput('\r');
    expect(inputs).toEqual([]);
  });

  it('挂起后迟到渲染请求 / 迟到 resize 静默吞', () => {
    const { engine, io, clock } = rig();
    clock.advance(0);
    engine.suspend();
    io.reset();
    engine.requestRender();
    clock.advance(50);
    io.columns = 20;
    io.emitResize();
    expect(io.frames.length).toBe(0); // 无 2J 无重绘
    expect(engine.columns).toBe(20); // 查询面直查真值
  });

  it('dispose 后一切吞 + 二次 dispose 幂等', () => {
    const { engine, io, clock } = rig();
    clock.advance(0);
    engine.dispose();
    io.reset();
    engine.requestRender();
    io.emitInput('x');
    io.emitResize();
    clock.advance(50);
    expect(io.frames.length).toBe(0);
    expect(() => engine.dispose()).not.toThrow();
    expect(engine.lifecycle).toBe('disposed');
  });

  it('idle 态 renderNow / requestRender 无害空转', () => {
    const io = new MemoryTerminalIO();
    const clock = new FakeClock();
    const engine = new Engine({ io, now: clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel });
    engine.requestRender();
    clock.advance(10);
    engine.renderNow();
    expect(io.frames.length).toBe(0); // 未 start 零写
  });
});

describe('resize 弃旧换新', () => {
  it('几何变更：新缓冲 + 2J 清屏锤 + resize 事件 + 全量重绘', () => {
    const { engine, io, clock } = rig();
    clock.advance(0);
    io.reset();
    const resizes: { columns: number; rows: number }[] = [];
    engine.on('resize', (size) => resizes.push(size));
    io.columns = 20;
    io.emitResize();
    expect(io.frames[0]).toBe('\x1b[2J'); // 清屏锤即时写
    expect(resizes).toEqual([{ columns: 20, rows: 6 }]);
    clock.advance(20);
    expect(io.frames.length).toBe(2); // 2J + 全量重绘帧
    expect(engine.columns).toBe(20);
  });

  it('同尺寸 resize：no-op（无锤无事件）', () => {
    const { io, clock } = rig();
    clock.advance(0);
    io.reset();
    io.emitResize(); // 几何未变
    clock.advance(20);
    expect(io.frames.length).toBe(0);
  });
});

describe('挂起 / 复起交出面', () => {
  it('挂起三件套：出屏写 + 卸输入 + 停流 + raw 复原（start 先验 false）', () => {
    const { engine, io } = rig();
    expect(io.raw).toBe(true); // start 已设 raw（先验 false 已被记录）
    engine.suspend();
    const last = io.frames[io.frames.length - 1];
    expect(last).toBe(LEAVE_INLINE);
    expect(io.pauseCount).toBe(1);
    expect(io.raw).toBe(false); // priorRaw 复原（start 时先验 false）
    expect(engine.suspended).toBe(true);
  });

  it('复起六步：进屏写 + raw 重设 + 监听重装 + 显式放流 + 全量重绘', () => {
    const { engine, io, clock, inputs } = rig();
    clock.advance(0);
    engine.suspend();
    io.reset();
    io.resumeCount = 0;
    engine.resume();
    expect(io.frames[0]).toBe(ENTER_INLINE); // 进屏模式串重写
    expect(io.raw).toBe(true);
    expect(io.resumeCount).toBe(1); // 显式放流在场
    clock.advance(20);
    expect(io.frames.length).toBe(2); // 进屏 + 全量重绘帧（含 hello）
    expect(io.frames[1]).toContain('hello');
    io.emitInput('\r'); // 输入重装——事件可达
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as KeyEvent).key).toBe('enter');
  });

  it('复起几何核对：挂起期 resize 被闸门吞——复起重查真值失配即弃旧换新', () => {
    const { engine, io, clock } = rig();
    clock.advance(0);
    engine.suspend();
    io.reset();
    io.columns = 20; // 挂起期几何已变（resize 事件被闸门吞）
    engine.resume();
    expect(io.frames[0]).toBe(ENTER_INLINE);
    expect(io.frames[1]).toBe('\x1b[2J'); // 几何核对失配——清屏锤
    clock.advance(20);
    expect(engine.columns).toBe(20);
  });

  it('复起几何一致：无锤、仅全量重绘', () => {
    const { engine, io, clock } = rig();
    clock.advance(0);
    engine.suspend();
    io.reset();
    engine.resume();
    expect(io.frames).toHaveLength(1); // 仅进屏模式串
    clock.advance(20);
    expect(io.frames).toHaveLength(2); // 重绘帧
    expect(io.frames[1]).not.toContain('\x1b[2J');
  });
});

describe('双形态模式串（单源常量严格对称反序）', () => {
  it('inline 缺省：无 1049 备屏进出', () => {
    const { engine, io } = rig();
    expect(io.frames[0]).not.toContain('\x1b[?1049h');
    engine.dispose();
    const last = io.frames[io.frames.length - 1];
    expect(last).toBe(LEAVE_INLINE);
    expect(last).not.toContain('\x1b[?1049l');
  });

  it('alt-screen：1049 进出严格对称（h 先进 / l 后出）', () => {
    const { engine, io } = rig('alt-screen');
    expect(io.frames[0]).toBe(ENTER_ALT); // 1049h 最前
    engine.dispose();
    const last = io.frames[io.frames.length - 1];
    expect(last).toBe(LEAVE_ALT); // 1049l 最后——反序
  });
});

describe('drainInput（终退排空——公开方法位）', () => {
  /** 时钟推进 + 微任务刷新交替驱动，直到 drain promise 收手（帽 maxSteps 防悬死） */
  async function driveDrain(clock: FakeClock, draining: Promise<void>, maxMs: number): Promise<boolean> {
    let done = false;
    void draining.then(() => {
      done = true;
    });
    for (let elapsed = 0; elapsed < maxMs && !done; elapsed += 10) {
      clock.advance(10);
      await Promise.resolve();
      await Promise.resolve();
    }
    return done;
  }

  it('排空收手：数据续窗 / 闲窗静默即止（drain 期输入被吞不进 decoder）', async () => {
    const { engine, io, clock, inputs } = rig();
    clock.advance(0);
    io.reset();
    const draining = engine.drainInput(1000, 50);
    clock.advance(10);
    io.emitInput('a'); // 第一波（swallow 接管——引擎处理器已卸）
    clock.advance(40);
    io.emitInput('b'); // 第二波（lastData 重置——窗续）
    const done = await driveDrain(clock, draining, 2000);
    expect(done).toBe(true);
    expect(inputs).toEqual([]); // drain 期输入被吞——decoder 零事件
    expect(io.pauseCount).toBeGreaterThanOrEqual(1); // 收手停流
  });

  it('运行态调用后恢复：输入处理器重装 + 流复起', async () => {
    const { engine, io, clock, inputs } = rig();
    clock.advance(0);
    io.reset();
    io.resumeCount = 0;
    const draining = engine.drainInput(1000, 50);
    const done = await driveDrain(clock, draining, 2000);
    expect(done).toBe(true);
    expect(io.resumeCount).toBeGreaterThanOrEqual(1); // 恢复放流
    io.emitInput('\r'); // 处理器已重装——事件可达
    expect(inputs).toHaveLength(1);
  });
});

describe('输入接线与协议事件', () => {
  it('结构化输入事件上抛（decoder → 引擎事件面）', () => {
    const { io, inputs } = rig();
    io.emitInput('\x1b[C');
    expect(inputs).toEqual([
      { kind: 'key', key: 'right', ctrl: false, alt: false, shift: false, meta: false, phase: 'press' },
    ]);
  });

  it('kitty 探测落定：keyboardProtocol 事件 + 查询面', () => {
    const { engine, io } = rig();
    const protocols: string[] = [];
    engine.on('keyboardProtocol', (p) => protocols.push(p));
    io.emitInput('\x1b[?1u');
    expect(protocols).toEqual(['kitty']);
    expect(engine.keyboardProtocol).toBe('kitty');
  });

  it('lone-ESC 判定窗定时器：窗到点 settle 出 escape 事件', () => {
    const { io, clock, inputs } = rig();
    io.emitInput('\x1b'); // chunk 末 lone-ESC——挂起
    expect(inputs).toEqual([]);
    clock.advance(31); // 30ms 窗到点
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as KeyEvent).key).toBe('escape');
  });
});
