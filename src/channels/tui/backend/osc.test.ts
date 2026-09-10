/**
 * OscDisplay 直测（07 §4.1 呈现面件 7——终端外显 OSC 标题 + 进度态）。
 *
 * 桩法：MemoryTerminalIO 字节捕获（帧级断言）+ 假钟手动推进（保活周期重发
 * 的确定性驱动——tui-backend.test.ts ManualClock 同形）。覆盖：title 值缓存
 * 去重 / 忙态首写 + 1s 保活周期重发 / 清零停针 / restore 退出复原两写点 /
 * schedule 注入可控（保活缺位缺省）。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO } from '../../engine/index.js';
import { buildOsc52Copy, OscDisplay, OSC_PROGRESS_KEEPALIVE_MS } from './osc.js';

/** OSC 9;4 忙态序列（锚定 pi-tui 字节形） */
const ACTIVE = '\x1b]9;4;3\x07';
/** OSC 9;4 清零序列 */
const CLEAR = '\x1b]9;4;0\x07';
/** OSC 0 title 序列包装 */
const title = (t: string): string => `\x1b]0;${t}\x07`;

/** 假钟（保活重发的确定性驱动——到期定时器按序执行、执行中新排可续窗） */
class ManualClock {
  public t = 0;
  private seq = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  public readonly now = (): number => this.t;
  public readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  public readonly cancel = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  /** 推进时间：到期定时器按序执行（执行中新排的也可在本窗内到期） */
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

/** osc rig：内存 IO + 假钟 + 取消记录（注入三件套） */
function makeOsc(baseline = 'berry-agent') {
  const io = new MemoryTerminalIO(80, 24);
  const clock = new ManualClock();
  const cancelled: unknown[] = [];
  const osc = new OscDisplay(io, {
    baseline,
    schedule: clock.schedule,
    cancel: (handle) => {
      cancelled.push(handle);
      clock.cancel(handle);
    },
  });
  return { io, osc, clock, cancelled };
}

describe('OscDisplay title（OSC 0——值缓存去重）', () => {
  it('首写字节形（ESC ]0; 文本 BEL）+ 同值二调一字节', () => {
    const { io, osc } = makeOsc();
    osc.setTitle('berry-agent');
    osc.setTitle('berry-agent'); // 同值——去重不重写
    expect(io.frames).toEqual([title('berry-agent')]);
    osc.setTitle('berry-agent 1.2.3'); // 新值——写出
    expect(io.frames).toEqual([title('berry-agent'), title('berry-agent 1.2.3')]);
  });
});

describe('OscDisplay 进度态（OSC 9;4——保活周期重发）', () => {
  it('忙态首写 + 1s 保活周期重发（假钟推进断言重发次数）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setProgress(true);
    expect(io.frames).toEqual([ACTIVE]); // 首写即忙态序列
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS); // 一窗——重发一次
    expect(io.frames).toEqual([ACTIVE, ACTIVE]);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS * 2); // 两窗——重发两次（自重排续针）
    expect(io.frames).toEqual([ACTIVE, ACTIVE, ACTIVE, ACTIVE]);
  });

  it('忙态重复调用重写序列但不叠针（单链重发——每窗恰一次）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setProgress(true);
    osc.setProgress(true); // 已在飞——序列重写（去重不适用）、保活不重复起针
    expect(io.frames).toEqual([ACTIVE, ACTIVE]);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS);
    expect(io.frames).toEqual([ACTIVE, ACTIVE, ACTIVE]); // 一窗恰一次重发
  });

  it('清零停针：写清零序列 + 保活 timer 摘除（推进零写出）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setProgress(true);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS); // 一窗重发
    osc.setProgress(false);
    expect(io.frames.slice(-1)).toEqual([CLEAR]); // 清零序列落帧
    expect(osc.activeKeepalive).toBeNull(); // 停针——句柄位归 null
    const frames = io.frames.length;
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS * 5); // 停针后推进——零写出
    expect(io.frames.length).toBe(frames);
  });

  it('schedule 缺席 = 保活缺位（忙态首写仍在——同步测试语义）', () => {
    const io = new MemoryTerminalIO(80, 24);
    const osc = new OscDisplay(io, { baseline: 'berry-agent' });
    osc.setProgress(true);
    expect(io.frames).toEqual([ACTIVE]);
    expect(osc.activeKeepalive).toBeNull(); // 无注入——不起针
    osc.setProgress(false); // 停针 no-op + 清零写出
    expect(io.frames).toEqual([ACTIVE, CLEAR]);
  });
});

describe('OscDisplay restore（退出复原两写点）', () => {
  it('title 复原基线 + 进度清零（含保活停针）', () => {
    const { io, osc, clock } = makeOsc('berry-agent 1.2.3');
    osc.setTitle('berry-agent 1.2.3 · abcdefgh'); // repaint 点缀形态
    osc.setProgress(true);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS); // 保活窗一开
    osc.restore();
    expect(io.frames).toContain(title('berry-agent 1.2.3')); // 写点一：title 复原基线
    expect(io.frames.slice(-1)).toEqual([CLEAR]); // 写点二：进度清零
    expect(osc.activeKeepalive).toBeNull(); // 保活停针
    const frames = io.frames.length;
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS * 5); // 复原后零写出
    expect(io.frames.length).toBe(frames);
  });

  it('title 已在基线——复原写走去重（仅清零一字节）', () => {
    const { io, osc } = makeOsc('berry-agent');
    osc.setTitle('berry-agent'); // 与基线同值（缓存已记）
    osc.restore();
    expect(io.frames).toEqual([title('berry-agent'), CLEAR]); // title 写被去重律吸收
  });
});

describe('OscDisplay schedule 注入可控', () => {
  it('保活经注入 schedule 起针（1000ms）+ 停针走注入 cancel（句柄对得上）', () => {
    const { io, osc, cancelled } = makeOsc();
    osc.setProgress(true);
    expect(io.frames).toEqual([ACTIVE]);
    expect(osc.activeKeepalive).not.toBeNull(); // 注入起针
    const handle = osc.activeKeepalive;
    osc.setProgress(false);
    expect(cancelled).toEqual([handle]); // 停针经注入 cancel——同句柄摘除
    expect(osc.activeKeepalive).toBeNull();
  });

  it('restore 停针同走注入 cancel（名册语义——重复停针 no-op）', () => {
    const { osc, cancelled } = makeOsc();
    osc.setProgress(true);
    osc.restore();
    expect(cancelled).toHaveLength(1); // 保活句柄摘除一次
    osc.stopKeepalive(); // 句柄位已 null——再停 no-op
    expect(cancelled).toHaveLength(1);
  });
});

/* ---------------- OSC 52 选区复制序列（mu-2——07 件 8 细则） ---------------- */

describe('buildOsc52Copy（选区复制序列构造——尽力写出无反馈）', () => {
  it('OSC 52;c;base64 + BEL 终界（ASCII 明文）', () => {
    expect(buildOsc52Copy('hi')).toBe(`\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07`);
  });

  it('UTF-8 明文按字节 base64（中文 + 换行——选区行间拼 LF 的真实载荷形）', () => {
    const text = '中文\n第二行';
    expect(buildOsc52Copy(text)).toBe(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
  });
});
