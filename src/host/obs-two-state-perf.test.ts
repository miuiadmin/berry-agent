/**
 * obs 开/关两态性能门禁（07 §4.1 性能回归锁条款增补段——2026-09-08 双轴二轮
 * P2 收口批钉「两态纪律」、本批码面兑现）：「观测自身不得成延迟源」——同一
 * 回归锁跑 core:obs 装载/禁用两配置，单态基准会漏「观测开着才红」与「观测
 * 关着才红」两半缺档。
 *
 * - **ambient 形**：obs 件切片真身直装（createObsService + 自管 rollup 库 +
 *   Store 真事件源——与 host/assembly.ts 装配同形：obsEvents = Store 真身
 *   直传），非全栈 boot——perf 锁要可归因信噪比（全栈 boot 引入 scheduler/
 *   webui 等无关噪声源，缺档归因即失效）。禁用腿 = 件不装载（裁决②件可
 *   禁用使两态天然可达——禁用腿零成本）；
 * - **「trace 是热路径的一部分」**：测量窗内持续向 Store 落账真实事件
 *   （durable 事件流写路径——观测数据面与 TUI 引擎同进程同 event loop 同
 *   磁盘）。wall-time 腿并发写者 = setImmediate 循环逐批 writeEvents（生产
 *   driver write-behind 同形）；装载态另携自驱 refresh 挂钟。确定性腿（合并
 *   率·假钟）obs 走 refreshMs:0 + 手动 pump——与挂钟调同一 refresh() 同工，
 *   假钟窗内真 interval 永不点火（单线程同步推进），手动泵是唯一诚实形；
 * - **obs 自身热路径预算**（码面定值回填——规范「refresh 摄取窗/订阅派发
 *   随 obs 性能面实测批定值回填、规范不收数字」的摄取窗半边）：5000 事件
 *   增量摄取 wall-time 帽。订阅派发半边挂账：SESSION_LIFECYCLE 广播是同步
 *   O(N) 扇出无可观 I/O 面（plugin-context 内联过滤循环），预算锁随订阅面
 *   真实负载批定值，本批不预造；
 * - **帽值**：三 wall-time 指标复用 engine/perf-lock.test.ts 同帽（CI 宽余量
 *   上帽，规范允许实机校准后收紧——两文件同改同笔纪律）。
 */
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine, MemoryTerminalIO, type Renderable } from '../channels/engine/index.js';
import { TuiBackend } from '../channels/tui/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { openStore, type Store } from '../persist/index.js';
import { createObsService, type ObsService } from '../obs/index.js';

/* ---------------- 帽值（码面定值——07 §4.1 回填落点） ---------------- */

/** 三 wall-time 帽与 engine/perf-lock.test.ts 同值同笔（CI 宽余量上帽） */
const COLD_START_FIRST_FRAME_BUDGET_MS = 500; // 冷启首帧：start → 首帧写出
const KEY_ECHO_BUDGET_MS = 200; // 按键回显：输入字节 → echo 帧（backend 层指标）
const RESIZE_RELAYOUT_BUDGET_MS = 500; // resize 重排：几何变更 → 重排帧
/**
 * obs 增量摄取帽：5000 事件单拍 refresh wall-time。实机实测约 4ms（本批
 * 定值依据）——帽取 50ms（约 12x CI 宽余量；仍能锁住每事件一事务/
 * N+1 查询类病态回归——5000 次单事务实测量级即破帽）。
 */
const OBS_INGEST_BUDGET_MS = 50;

/* ---------------- ambient：两态切片装配 ---------------- */

/** 会话登记形（writeEvents 每批必携——tools.test.ts 同形） */
const SESSION_REG = {
  origin: 'conversation',
  parentId: undefined,
  seedLength: 0,
  workspaceRoot: '/tmp/ws',
  title: undefined,
} as const;

/** 事件信封便捷构造（time 递增 10s——5000 事件铺约 14 个小时桶） */
function ev(seq: number, time: number): SessionEvent {
  return { type: 'user/message', seq, time, data: { content: `流式事件 ${seq}`, source: 'user' } };
}

/** 两态 ambient（装载腿 obs 真身在飞；禁用腿件不装载） */
interface Ambient {
  readonly store: Store;
  readonly obs: ObsService | undefined;
  /** 手动泵（装载腿专用——与挂钟同工调 refresh()；禁用腿 no-op） */
  readonly pump: () => void;
  /** 全量收场（store close + obs dispose——测试唯一出口） */
  readonly dispose: () => void;
}

/** 起一个会话并铺底事件（obs 首拍即有摄取面——装载腿 refresh 不空转） */
function seedSession(store: Store, sessionId: string, count: number, baseTime: number): void {
  for (let i = 0; i < count; i += 100) {
    const batch = Array.from({ length: Math.min(100, count - i) }, (_, k) => ev(i + k, baseTime + (i + k) * 10_000));
    store.writeEvents(batch.map((event) => ({ sessionId, event, registration: SESSION_REG })));
  }
}

/**
 * 切片 ambient 工厂：dir 已建好；withObs=false = 禁用腿（不建 rollup 库、
 * 零观测面——裁决②件可禁用的码面形）。
 */
function bootAmbient(dir: string, withObs: boolean, opts: { refreshMs: number; clock?: () => number }): Ambient {
  const store = openStore({ dataDir: dir, dbPath: join(dir, 'sessions.db'), warn: () => {} });
  const obs = withObs
    ? createObsService({
        dbPath: join(dir, 'data', 'obs', 'rollup.db'),
        events: store,
        notify: { notify: () => undefined },
        audience: { hasAudience: () => false },
        refreshMs: opts.refreshMs,
        warn: () => {},
        ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
      })
    : undefined;
  return {
    store,
    obs,
    pump: () => obs?.refresh(),
    dispose: () => {
      obs?.dispose();
      store.close();
    },
  };
}

/**
 * 并发写者（wall-time 腿的 trace 热路径——setImmediate 循环逐批落账，stop 收）。
 * 事件锚在「过去一小时」内（10ms 间距）——装载腿 refresh 挂钟的重叠窗
 * （水位−1h）每拍都真实重扫重算这些批次（摄取工作非空转）。
 */
function startTraceWriter(store: Store, sessionId: string, baseTime: number): { stop: () => void } {
  let seq = 0;
  let running = true;
  const loop = (): void => {
    if (!running) return;
    const batch = Array.from({ length: 50 }, (_, k) => ev(seq + k, baseTime + (seq + k) * 10));
    store.writeEvents(batch.map((event) => ({ sessionId, event, registration: SESSION_REG })));
    seq += 50;
    setImmediate(loop);
  };
  setImmediate(loop);
  return {
    stop: () => {
      running = false;
    },
  };
}

/** 可变文本根（engine/perf-lock.test.ts 同形——setLines 换内容触发差分） */
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

/** 假钟（确定性腿——engine/perf-lock.test.ts 同形自持推演） */
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

/* ---------------- 生命周期（两态共享——每例独立临时目录） ---------------- */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-obs-twostate-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* ---------------- 两态 wall-time 门禁（真钟·CI 宽余量） ---------------- */

describe.each([
  ['装载', true],
  ['禁用', false],
] as const)('obs %s态：冷启首帧 / 按键回显 / resize 重排（两态同锁同帽）', (_label, withObs) => {
  /** 每例共享 ambient（装载腿挂钟 25ms 在飞——测量窗内自然点火真摄取） */
  function boot(): { amb: Ambient; writer: ReturnType<typeof startTraceWriter> } {
    // 事件锚 = 过去一小时（refresh 重叠窗内——装载腿每拍真实重算，非空转）
    const pastHour = Date.now() - 3_600_000;
    const amb = bootAmbient(dir, withObs, { refreshMs: 25 });
    seedSession(amb.store, 'sess-a', 500, pastHour); // 铺底：refresh 有真摄取面
    amb.obs?.refresh(); // 首拍（装载面同形——装载即首拍）
    const writer = startTraceWriter(amb.store, 'sess-b', pastHour);
    return { amb, writer };
  }

  it(`冷启首帧：Engine.start → 首帧写出 < ${COLD_START_FIRST_FRAME_BUDGET_MS}ms`, async () => {
    const { amb, writer } = boot();
    const io = new MemoryTerminalIO(80, 24);
    const engine = new Engine({ io }); // 真调度（缺省 setTimeout）——真钟
    try {
      const t0 = performance.now();
      engine.start(makeRoot(['cold-start-frame']));
      await vi.waitFor(() => {
        expect(io.bytes).toContain('cold-start-frame');
      });
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(COLD_START_FIRST_FRAME_BUDGET_MS);
    } finally {
      engine.dispose();
      writer.stop();
      amb.dispose();
    }
  });

  it(`按键回显：输入字节 → echo 帧 < ${KEY_ECHO_BUDGET_MS}ms（backend 层）`, async () => {
    const { amb, writer } = boot();
    const io = new MemoryTerminalIO(80, 10);
    const backend = new TuiBackend(io, {
      // 注入真调度（生产装配形态——渲染合并路）；title 基线清账语义同
      // engine/perf-lock.test.ts 按键回显例（清账后静态面零 a——断言中的 a
      // 只能来自 emitInput 触发的 echo 帧）
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancelSchedule: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    backend.start();
    try {
      io.reset();
      const t0 = performance.now();
      io.emitInput('a');
      await vi.waitFor(() => {
        expect(io.bytes).toContain('a');
      });
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(KEY_ECHO_BUDGET_MS);
    } finally {
      backend.stop();
      writer.stop();
      amb.dispose();
    }
  });

  it(`resize 重排：几何变更 → 清屏锤 + 重排帧 < ${RESIZE_RELAYOUT_BUDGET_MS}ms`, async () => {
    const { amb, writer } = boot();
    const io = new MemoryTerminalIO(80, 24);
    const engine = new Engine({ io }); // 真调度——真钟
    try {
      engine.start(makeRoot(['resize-relayout-frame']));
      await vi.waitFor(() => {
        expect(io.bytes).toContain('resize-relayout-frame');
      });
      io.reset();
      io.columns = 60; // 几何变更（resize 信号——测试侧先行改定后 emit）
      io.rows = 12;
      const t0 = performance.now();
      io.emitResize();
      await vi.waitFor(() => {
        expect(io.bytes).toContain('\x1b[2J');
        expect(io.bytes).toContain('resize-relayout-frame');
      });
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(RESIZE_RELAYOUT_BUDGET_MS);
    } finally {
      engine.dispose();
      writer.stop();
      amb.dispose();
    }
  });
});

/* ---------------- 两态合并率门禁（确定性·假钟——obs 手动泵同工） ---------------- */

describe.each([
  ['装载', true],
  ['禁用', false],
] as const)('obs %s态：流式高频渲染请求合并率（两态同锁同断言）', (_label, withObs) => {
  it('规模化请求 + trace 逐批落账下实际写出 << 请求次数且末帧携带最新内容', () => {
    const clock = new FakeClock();
    const amb = bootAmbient(dir, withObs, { refreshMs: 0, clock: clock.now }); // 假钟窗内真 interval 不点火——手动泵
    try {
      seedSession(amb.store, 'sess-a', 100, clock.t);
      amb.pump(); // 装载即首拍（装载面同形）

      const io = new MemoryTerminalIO(80, 24);
      const engine = new Engine({ io, now: clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel });
      const root = makeRoot(['seed']);
      engine.start(root);
      clock.advance(0); // 首帧落地（首测基线）
      io.reset();

      const REQUESTS = 2000;
      let traceSeq = 0; // trace 写面独立序（会话 seq 连续律——0 起强制递增）
      for (let i = 0; i < REQUESTS; i++) {
        root.setLines([`流式段 ${i}`]); // 每请求换内容（差分非零——模拟流式 partial）
        engine.requestRender();
        if (i % 10 === 9) {
          // trace 热路径：每 10 请求一批 10 事件落账（流式事件的 durable 写面；
          // 事件锚 = 当前假钟——scanSince 恒 0 全窗覆盖，每拍 pump 真实重算）
          const batch = Array.from({ length: 10 }, (_, k) => ev(traceSeq + k, clock.t));
          amb.store.writeEvents(batch.map((event) => ({ sessionId: 'sess-b', event, registration: SESSION_REG })));
          traceSeq += 10;
        }
        if (i % 50 === 49) amb.pump(); // 挂钟同工：40 拍增量摄取穿插在请求流中
        clock.advance(1); // 1ms 一次请求——高频到达节奏
      }
      clock.advance(20); // 尾帧冲刷

      expect(io.frames.length).toBeGreaterThan(0); // 帧在流（合并不等于不渲染）
      expect(io.frames.length).toBeLessThan(REQUESTS / 10); // 合并率 ≥ 90%
      expect(io.frames[io.frames.length - 1]).toContain(`流式段 ${REQUESTS - 1}`); // 合并不丢尾
      engine.dispose();
    } finally {
      amb.dispose();
    }
  });
});

/* ---------------- obs 自身热路径预算（装载态独有——摄取窗半边） ---------------- */

describe('obs 摄取窗预算（码面定值回填——07 §4.1 增补段「随 obs 性能面实测批」）', () => {
  it(`5000 事件单拍增量摄取 refresh() < ${OBS_INGEST_BUDGET_MS}ms（实机实测定值）`, () => {
    const amb = bootAmbient(dir, true, { refreshMs: 0 }); // 禁挂钟——量 refresh 本体
    try {
      const t0 = performance.now();
      seedSession(amb.store, 'sess-a', 5000, 1_700_000_000_000);
      const seedMs = performance.now() - t0;
      expect(seedMs).toBeLessThan(10_000); // 写面护栏（异常慢盘红——非摄取断言面）

      const t1 = performance.now();
      amb.pump(); // 首拍 = 全量摄取（5000 事件 × 约 14 小时桶）
      const elapsed = performance.now() - t1;
      expect(elapsed).toBeLessThan(OBS_INGEST_BUDGET_MS); // 观测摄取不得成延迟源

      // 幂等重拍护栏：零新增事件下重拍不重复计数（重叠窗重算——count 不增）
      const before = queryTotal(amb);
      amb.pump();
      expect(queryTotal(amb)).toBe(before);
    } finally {
      amb.dispose();
    }
  });
});

/** events_hour 全计数和（幂等护栏读面——经服务自身 query 面，免二次开库） */
function queryTotal(amb: Ambient): number {
  const obs = amb.obs;
  if (obs === undefined) throw new Error('装载态专用读面');
  return obs
    .query({ metric: 'events', granularity: 'hour', limit: 1000 })
    .reduce((sum, row) => sum + ('count' in row ? row.count : 0), 0);
}
