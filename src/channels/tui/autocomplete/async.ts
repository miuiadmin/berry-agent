/**
 * 补全异步防抖源（07 §4.1 R6 批 10j——provider 查询异步形协议件）。
 *
 * 三律（07 §4.1 R6 落码定值）：
 * - **防抖**：输入变更起 20ms 窗（AUTOCOMPLETE_DEBOUNCE_MS 定值）——窗内
 *   新变更重置窗（尾沿触发），连打只在停顿后发一查；
 * - **AbortSignal**：新查询取消在途旧查询（源侧按需受理——重活源〔fs 全
 *   库行走等〕在途即断）；
 * - **request id 错序防护**：迟到旧结果不覆盖新态（fire 时扣 id，交付时
 *   对拍仍当前才回调）。
 *
 * 同步快路：源返回同步数组（既有同步源免包装同面——union 协议）时结果
 * 同步交付（测试同步语义保留）；异步源（Promise 形）微task 交付。schedule
 * 注入缺席 = 立即发（无防抖——单测语义）。
 */
import type { AutocompleteResult } from './provider.js';

/** 防抖窗定值（07 §4.1 R6——量级 ~20ms 落码定值） */
export const AUTOCOMPLETE_DEBOUNCE_MS = 20;

/** 查询函数形（fire 时取上下文——同步或 Promise 双形） */
export type CompleterQuery = (signal: AbortSignal) => AutocompleteResult | null | Promise<AutocompleteResult | null>;

/** thenable 判（Promise 形源识别——跨 realm 安全；本目录单源，autocomplete 件 import 复用） */
export function isThenable(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown> | null)?.then === 'function';
}

/**
 * 同步源 → 异步面适配器（R6「既有同步源经包装器适配同面」的载体——源作者
 * 需要严格异步签名时用；union 协议下同步源可免包装直注）。
 */
export function asyncFromSync(
  sync: (query: string) => readonly unknown[],
): (query: string, signal: AbortSignal) => Promise<readonly unknown[]> {
  return (query, signal) => {
    if (signal.aborted) return Promise.resolve([]);
    return Promise.resolve(sync(query));
  };
}

/** 防抖调度器依赖注入面 */
export interface AutocompleteCompleterDeps {
  /** 查询函数（fire 时调——上下文由闭包自取，防抖窗内取最新态） */
  readonly query: CompleterQuery;
  /** 结果回调（错序 / 取消后的交付不达此——backend 接弹层落位 + 重绘） */
  readonly onResult: (result: AutocompleteResult | null) => void;
  /** 定时器注入（缺席 = 立即发——同步单测语义） */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  /** 取消调度（与 schedule 配对） */
  readonly cancelSchedule?: (handle: unknown) => void;
}

/** 补全防抖调度器：request 防抖尾沿 / cancel 全收 / 错序丢弃 */
export class AutocompleteCompleter {
  private readonly query: CompleterQuery;
  private readonly onResultCb: (result: AutocompleteResult | null) => void;
  private readonly schedule: ((fn: () => void, ms: number) => unknown) | undefined;
  private readonly cancelFn: ((handle: unknown) => void) | undefined;
  private handle: unknown = null;
  private controller: AbortController | null = null;
  /** 当前有效请求 id（每 request/cancel 自增——在途交付对拍作废） */
  private reqId = 0;

  constructor(deps: AutocompleteCompleterDeps) {
    this.query = deps.query;
    this.onResultCb = deps.onResult;
    this.schedule = deps.schedule;
    this.cancelFn = deps.cancelSchedule;
  }

  /** 输入变更：重置防抖窗（尾沿触发）+ 取消在途查询（迟到结果作废） */
  request(): void {
    this.dropInFlight();
    if (this.schedule === undefined) {
      this.fire(); // 无定时器注入——立即发（同步单测语义）
      return;
    }
    this.handle = this.schedule(() => {
      this.handle = null;
      this.fire();
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  /** 全收：撤防抖窗 + 取消在途查询（提交 / ask 接管 / 停机时） */
  cancel(): void {
    this.dropInFlight();
  }

  /** 在途态清空（reqId 自增使一切在途回调失效 + abort 在途查询） */
  private dropInFlight(): void {
    this.reqId++;
    this.controller?.abort();
    this.controller = null;
    if (this.handle !== null && this.cancelFn !== undefined) {
      this.cancelFn(this.handle);
    }
    this.handle = null;
  }

  /** 发查询（同步源同步交付快路；异步源微task 交付 + 错序对拍） */
  private fire(): void {
    const id = this.reqId;
    const controller = new AbortController();
    this.controller = controller;
    let outcome: ReturnType<CompleterQuery>;
    try {
      outcome = this.query(controller.signal);
    } catch {
      this.controller = null;
      return; // 源同步抛错——静默退场（补全失败不呈报不打断输入）
    }
    if (isThenable(outcome)) {
      void outcome.then(
        (result) => {
          if (id === this.reqId && this.controller === controller) {
            this.controller = null;
            this.onResultCb(result ?? null);
          } // 否则错序——丢弃不覆盖新态
        },
        () => {
          /* abort / 源异步失败——静默（错序防护的正常态） */
        },
      );
      return;
    }
    this.controller = null;
    this.onResultCb(outcome ?? null); // 同步快路——同帧交付
  }
}
