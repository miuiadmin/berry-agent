/**
 * 补全防抖调度器单测（07 §4.1 R6 批 10j）：防抖尾沿 / AbortSignal /
 * request id 错序防护 + 同步快路四律直锁（手动时钟 rig）。
 */
import { describe, expect, it } from 'vitest';
import type { AutocompleteItem, AutocompleteResult } from './provider.js';
import { AUTOCOMPLETE_DEBOUNCE_MS, AutocompleteCompleter, asyncFromSync, type CompleterQuery } from './async.js';

/** 手动时钟（schedule/cancel 注入形——backend 同构） */
class ManualClock {
  private seq = 0;
  private timers: Map<number, { fn: () => void; at: number }> = new Map();
  private nowMs = 0;
  readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { fn, at: this.nowMs + ms });
    return id;
  };
  readonly cancel = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      // 到期最早者先跑（ timers 内 fn 可再挂新 timer）
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < dueAt) {
          dueId = id;
          dueAt = t.at;
        }
      }
      if (dueId === null) break;
      const timer = this.timers.get(dueId)!;
      this.timers.delete(dueId);
      this.nowMs = timer.at;
      timer.fn();
    }
    this.nowMs = target;
  }
}

/** 定长结果（观测用） */
const resultOf = (label: string): AutocompleteResult => ({
  items: [{ label, replacement: label }] satisfies AutocompleteItem[],
  replaceStart: 0,
  replaceEnd: 1,
});

describe('AutocompleteCompleter 防抖三律', () => {
  it('尾沿触发：窗内连发只末次成查（20ms 定值）', () => {
    const clock = new ManualClock();
    const queries: string[] = [];
    let delivered: string | null = null;
    const c = new AutocompleteCompleter({
      query: (signal) => {
        void signal;
        queries.push(`q${queries.length}`);
        return resultOf('末次');
      },
      onResult: (r) => {
        delivered = r?.items[0]?.label ?? null;
      },
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
    });
    c.request();
    c.request();
    c.request(); // 三连击——重置窗两次
    expect(queries).toEqual([]); // 窗未到——零查询
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS - 1);
    expect(queries).toEqual([]); // 差 1ms 仍未发
    clock.advance(1);
    expect(queries).toHaveLength(1); // 尾沿恰一次
    expect(delivered).toBe('末次'); // 同步快路同帧交付
  });

  it('AbortSignal：新查询取消在途旧查询', async () => {
    const clock = new ManualClock();
    const aborted: boolean[] = [];
    const resolvers: Array<(r: AutocompleteResult | null) => void> = [];
    const query: CompleterQuery = (signal) => {
      aborted.push(signal.aborted);
      // 首查在途挂起（异步源形）——新查询应 abort 它；次查同步快路
      if (aborted.length === 1) return new Promise((resolve) => resolvers.push(resolve));
      return resultOf('新查');
    };
    const delivered: (string | null)[] = [];
    const c = new AutocompleteCompleter({
      query,
      onResult: (r) => delivered.push(r?.items[0]?.label ?? null),
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
    });
    c.request();
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS); // 首查发出（在途）
    c.request(); // 新查询——abort 首查
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS); // 次查发出（同步快路同帧交付）
    resolvers[0]!(resultOf('旧查')); // 迟到旧结果回线
    await Promise.resolve();
    expect(aborted).toEqual([false, false]); // 两查各自发起时 signal 未 abort
    expect(delivered).toEqual(['新查']); // 旧查被 abort 标记 + 错序丢弃——只有新查交付
  });

  it('request id 错序防护：迟到旧异步结果不覆盖新态', async () => {
    const clock = new ManualClock();
    const resolvers: Array<(r: AutocompleteResult | null) => void> = [];
    const delivered: (string | null)[] = [];
    const completer = new AutocompleteCompleter({
      query: () => new Promise((resolve) => resolvers.push(resolve)),
      onResult: (r) => delivered.push(r?.items[0]?.label ?? null),
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
    });
    completer.request();
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS); // 查①发出
    completer.request();
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS); // 查②发出（①作废）
    resolvers[0]!(resultOf('旧')); // ①迟到回线
    resolvers[1]!(resultOf('新')); // ②回线
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual(['新']); // 旧被错序丢弃
  });

  it('cancel：撤窗 + 在途作废（无交付）', () => {
    const clock = new ManualClock();
    let fired = 0;
    let delivered = 0;
    const c = new AutocompleteCompleter({
      query: () => {
        fired++;
        return resultOf('x');
      },
      onResult: () => delivered++,
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
    });
    c.request();
    c.cancel(); // 窗内撤
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 5);
    expect(fired).toBe(0); // 窗已撤——零查询
    expect(delivered).toBe(0);
  });

  it('schedule 缺席 = 立即发（同步单测语义）', () => {
    let fired = 0;
    const c = new AutocompleteCompleter({
      query: () => {
        fired++;
        return null;
      },
      onResult: () => {},
    });
    c.request();
    expect(fired).toBe(1); // 无窗——同步即发
  });
});

describe('asyncFromSync 包装器', () => {
  it('同步源适配异步面：值经 Promise 交付；已 abort 信号空集', async () => {
    const wrapped = asyncFromSync((query) => [query.toUpperCase()]);
    expect(await wrapped('ab', new AbortController().signal)).toEqual(['AB']);
    const ac = new AbortController();
    ac.abort();
    expect(await wrapped('ab', ac.signal)).toEqual([]); // abort 受理即空
  });
});
