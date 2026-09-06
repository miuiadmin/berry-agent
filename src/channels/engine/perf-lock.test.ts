/**
 * 性能回归锁（07 篇性能回归锁条款——四指标；批 10f-3 建锁）。
 *
 * 规范条款四指标 = 冷启首帧 / 按键回显 / resize 重排 + 流式高频渲染请求
 * 合并率；阈值校准基准与回填落点同引擎节件 5 帧率帽条款（CI 在场前按主要
 * 开发机实测定值、CI 首建后回归重校；回填 = 码面缺省参数 + 回归锁阈值，
 * 规范不收数字）。
 *
 * - **合并率指标**（确定性·假钟）：规模化高频请求下帧写出被帧率帽收拢——
 *   引擎侧帧管线锁。既有直测不重复：engine.test.ts「请求合并」锁同拍多请
 *   求一帧收、tui-backend.test.ts「帧合并」锁 op 队列合并——本锁补窗口级
 *   合并率（持续高频请求 × 帧率帽 → 实际写出 << 请求次数）。
 * - **三 wall-time 指标**（真钟·CI 宽余量防 flake）：冷启首帧 / resize 重排
 *   在引擎层测；按键回显属 backend 层（编辑器 echo 帧——引擎层不可达）在
 *   对应层测。帽值 = CI 宽余量上帽，规范允许实机校准后收紧。
 */
import { describe, expect, it, vi } from 'vitest';
import { Engine } from './engine.js';
import { MemoryTerminalIO } from './memory-io.js';
import { TuiBackend } from '../tui/index.js';
import { LiveTranscript, TRANSCRIPT_BLOCK_CAP } from '../tui/backend/transcript.js';
import type { Renderable } from './types.js';

/**
 * 三 wall-time 帽（ms）——CI 宽余量上帽（规范允许实机校准后收紧；锚定
 * 07 篇性能回归锁条款的「阈值校准基准与回填落点同引擎节件 5 帧率帽条款」
 * 句——本文件即回填落点的「回归锁阈值」半边）。
 */
const COLD_START_FIRST_FRAME_BUDGET_MS = 500; // 冷启首帧：start → 首帧写出
const KEY_ECHO_BUDGET_MS = 200; // 按键回显：输入字节 → echo 帧（backend 层指标）
const RESIZE_RELAYOUT_BUDGET_MS = 500; // resize 重排：几何变更 → 重排帧

/** 假钟（合并率指标的确定性驱动——与 engine.test.ts 同形自持推演） */
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
}

/** 可变文本根（渲染树替身——setLines 换内容触发差分，模拟流式 partial 到达） */
function makeRoot(initial: string[]): Renderable & { setLines(lines: string[]): void } {
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

describe('性能回归锁：流式高频渲染请求合并率（确定性·假钟——引擎侧帧管线）', () => {
  it('规模化请求下实际写出 << 请求次数（60fps 帽收拢）且末帧携带最新内容', () => {
    const io = new MemoryTerminalIO(80, 24);
    const clock = new FakeClock();
    const engine = new Engine({ io, now: clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel });
    const root = makeRoot(['seed']);
    engine.start(root);
    clock.advance(0); // 首帧落地（首测基线）
    io.reset();

    const REQUESTS = 2000; // 请求次数（规模化输入）
    for (let i = 0; i < REQUESTS; i++) {
      root.setLines([`流式段 ${i}`]); // 每请求换内容（差分非零——模拟流式 partial）
      engine.requestRender();
      clock.advance(1); // 1ms 一次请求——高频到达节奏
    }
    clock.advance(20); // 尾帧冲刷（末次请求的帧到帽点落地）

    // 60fps 帽下 2000ms 窗口实际帧数上界 ≈ 2000/16.67 ≈ 121——合并把写出
    // 收拢到帽率：实际写出次数 << 请求次数（锁合并率 ≥ 90%）
    expect(io.frames.length).toBeGreaterThan(0); // 帧在流（合并不等于不渲染）
    expect(io.frames.length).toBeLessThan(REQUESTS / 10);
    // 合并不丢尾：末帧携带最新内容（末次请求不因合并静默丢失）
    expect(io.frames[io.frames.length - 1]).toContain(`流式段 ${REQUESTS - 1}`);
    engine.dispose();
  });
});

describe('性能回归锁：冷启首帧 / 按键回显 / resize 重排（真钟·CI 宽余量）', () => {
  it(`冷启首帧：Engine.start → 首帧写出 < ${COLD_START_FIRST_FRAME_BUDGET_MS}ms（引擎层）`, async () => {
    const io = new MemoryTerminalIO(80, 24);
    const engine = new Engine({ io }); // 真调度（缺省 setTimeout）——真钟
    try {
      const t0 = performance.now();
      engine.start(makeRoot(['cold-start-frame']));
      await vi.waitFor(() => {
        expect(io.bytes).toContain('cold-start-frame'); // 首帧写出（内容字节在场）
      });
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(COLD_START_FIRST_FRAME_BUDGET_MS); // CI 宽余量帽
    } finally {
      engine.dispose();
    }
  });

  it(`按键回显：输入字节 → echo 帧 < ${KEY_ECHO_BUDGET_MS}ms（backend 层——引擎层不可达，注明）`, async () => {
    const io = new MemoryTerminalIO(80, 10);
    const backend = new TuiBackend(io, {
      // 注入真调度（生产装配形态——渲染合并路）；无注入同步直出会让指标失真
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancelSchedule: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    backend.start();
    try {
      // 清 start 编舞账（ENTER_MAIN + title OSC「\x1b]0;berry-agent\x07」+ 固定区
      // 首画）——title 基线含字母 a，不清账则 a 先在场、waitFor 零等待恒过（指标
      // 恒真失效）。清账后静态面零 a（闲态状态行空文案、空编辑器框均无 a），
      // 断言中的 a 只能来自 emitInput 触发的 echo 帧——echo 路回归即红。
      io.reset();
      const t0 = performance.now();
      io.emitInput('a'); // 按键字节到达
      await vi.waitFor(() => {
        expect(io.bytes).toContain('a'); // echo 帧写出（编辑器框内回显）
      });
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(KEY_ECHO_BUDGET_MS); // CI 宽余量帽
    } finally {
      backend.stop();
    }
  });

  it(`resize 重排：几何变更 → 清屏锤 + 重排帧 < ${RESIZE_RELAYOUT_BUDGET_MS}ms（引擎层）`, async () => {
    const io = new MemoryTerminalIO(80, 24);
    const engine = new Engine({ io }); // 真调度——真钟
    try {
      engine.start(makeRoot(['resize-relayout-frame']));
      await vi.waitFor(() => {
        expect(io.bytes).toContain('resize-relayout-frame'); // 先到稳态（首帧已出）
      });
      io.reset();
      io.columns = 60; // 几何变更（resize 信号——测试侧先行改定后 emit）
      io.rows = 12;
      const t0 = performance.now();
      io.emitResize();
      await vi.waitFor(() => {
        expect(io.bytes).toContain('\x1b[2J'); // 清屏锤（弃旧换新）
        expect(io.bytes).toContain('resize-relayout-frame'); // 全量重绘帧
      });
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(RESIZE_RELAYOUT_BUDGET_MS); // CI 宽余量帽
    } finally {
      engine.dispose();
    }
  });
});

/**
 * 块帽全量档回归锁（批 10f-4 帽参数化同笔——帽相关注记补笔）：
 * 块帽 = 内存上限语义（07 §4.1 屏幕模型双形态——主屏帽内最近段交原生
 * scrollback），四指标 wall-time 面不覆盖块帽（批 10f-3 建锁注记原文）。
 * 参数化后主屏缺省帽 500 不动（主屏调用面零变化）；件 8 回看器全量档
 * （blockCap = Infinity）取全量 durable 正文——本锁保证全量档块数不被截
 * （回看器数据范围条款：「回看器取全量 durable 正文、repaint 按投影取主屏
 * 滚动帽内最近段——恒一致的是管线非范围」）。
 */
describe('性能回归锁：transcript 块帽全量档（件 8 回看器数据范围——确定性）', () => {
  it('帽 Infinity 全量档：超主屏帽的投影块数不被截（blockCount 全量）', () => {
    const t = new LiveTranscript({ blockCap: Number.POSITIVE_INFINITY });
    const messages = Array.from({ length: TRANSCRIPT_BLOCK_CAP + 100 }, (_, i) => ({
      role: 'user' as const,
      content: `回看消息 ${i}`,
      timestamp: i,
    }));
    t.loadProjection(messages);
    expect(t.blockCount).toBe(TRANSCRIPT_BLOCK_CAP + 100); // 全量——主屏帽不作用于回看档
    expect(t.snapshot[t.blockCount - 1]).toMatchObject({ kind: 'user', text: `回看消息 ${TRANSCRIPT_BLOCK_CAP + 99}` }); // 末条在场
  });
});
