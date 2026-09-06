/**
 * 终端外显件（07 §4.1 呈现面件 7——OSC 标题 + OSC 9;4 进度态）。
 *
 * 语义平移 pi-tui Terminal setTitle/setProgress（自研改裁——字节形锚定
 * 参考源码/pi-monorepo/packages/tui/src/terminal.ts：title = OSC 0;… BEL、
 * 忙态 = `\x1b]9;4;3\x07`、清零 = `\x1b]9;4;0\x07`、keepalive 1s）。
 * - **OSC 写出分治**（07 §4.1 件 7 条款）：title 值缓存去重（同值不重写
 *   字节）；progress 态**保活周期重发**——OSC 9;4 在部分终端超时衰减，去重
 *   不适用于 progress 序列、须周期重写维持；
 * - 进度态判据（按 sessionId 归账的 agent_start/end 净计数、任一会话 > 0
 *   即忙）在 TuiBackend 侧——本件只承「忙/闲」两态写出与保活自持；
 * - 退出复原两写点：title 复原基线 + 进度清零（restore——TuiBackend 的
 *   stop 与硬退复原钩子两消费点）。
 *
 * 可测性：写出走注入 TerminalIO 形参（勿直写 process）；保活 timer 走
 * schedule 注入（TuiBackend armTick 同形），停针暴露名册语义（句柄非空才
 * 取消、停后清位——cancelTimer 同律）。schedule 缺席 = 保活缺位（忙态首写
 * 仍在——同步测试语义，与 TuiBackend「无注入调度 = 同步直出」同构）。
 */
import type { TerminalIO } from '../../engine/index.js';

/** 保活重发周期（ms——pi-tui TERMINAL_PROGRESS_KEEPALIVE_MS 实证值） */
export const OSC_PROGRESS_KEEPALIVE_MS = 1000;

/** OSC 9;4 忙态序列（indeterminate progress——state 3） */
const PROGRESS_ACTIVE_SEQUENCE = '\x1b]9;4;3\x07';
/** OSC 9;4 清零序列（state 0） */
const PROGRESS_CLEAR_SEQUENCE = '\x1b]9;4;0\x07';

/** 调度注入形（与 TuiBackend schedule 注入同形——(fn, ms) → 句柄） */
export type OscSchedule = (fn: () => void, ms: number) => unknown;

/** 终端外显件构造选项 */
export interface OscDisplayOptions {
  /** title 复原基线（退出复原落点——起屏基线形如 `berry-agent <版本>`） */
  readonly baseline: string;
  /** 调度注入（保活周期重发；缺席 = 保活缺位——忙态首写不受影响） */
  readonly schedule?: OscSchedule;
  /** 取消调度注入（与 schedule 配对——停针名册语义的取消出口） */
  readonly cancel?: (handle: unknown) => void;
}

/**
 * 终端外显件：OSC title + 进度态两写点的最小自持件。
 * 忙态期间保活自重排（触发即清位再续针——armTick 同形）；restore/停针后
 * 句柄位归 null，重复停针是 no-op。
 */
export class OscDisplay {
  /** title 值缓存（null = 未写过——同值不重写判据位） */
  private lastTitle: string | null = null;
  /** 保活在飞句柄（null = 无在飞——名册语义判据位） */
  private keepaliveHandle: unknown = null;

  private readonly io: TerminalIO;
  private readonly baseline: string;
  private readonly schedule: OscSchedule | null;
  private readonly cancel: (handle: unknown) => void;

  constructor(io: TerminalIO, options: OscDisplayOptions) {
    this.io = io;
    this.baseline = options.baseline;
    this.schedule = options.schedule ?? null;
    // 取消缺省兜底 setTimeout 句柄族（与 TuiBackend cancelFn 缺省同形）
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  /** 在飞保活句柄现值（null = 无在飞——名册摘除/测试断言位） */
  get activeKeepalive(): unknown {
    return this.keepaliveHandle;
  }

  /** 标题写出（OSC 0;… BEL——值缓存去重：同值不重写字节） */
  setTitle(title: string): void {
    if (title === this.lastTitle) return; // 去重律——同值零字节
    this.lastTitle = title;
    this.io.write(`\x1b]0;${title}\x07`);
  }

  /**
   * 进度态写出（OSC 9;4）：
   * - true = 写忙态序列 + 起 1s 保活周期重发（已在飞不重复起针——重发维持
   *   单链不叠针）；同值重复调用仍重写忙态序列（去重不适用于 progress）；
   * - false = 写清零序列 + 停保活 timer。
   */
  setProgress(active: boolean): void {
    if (active) {
      this.io.write(PROGRESS_ACTIVE_SEQUENCE);
      this.armKeepalive();
    } else {
      this.stopKeepalive();
      this.io.write(PROGRESS_CLEAR_SEQUENCE);
    }
  }

  /**
   * 退出复原两写点齐（07 §4.1 件 7 条款）：title 复原基线（经值缓存——
   * 已在基线则零字节）+ 进度清零（无条件写——终态收口，含停保活）。
   */
  restore(): void {
    this.stopKeepalive();
    this.setTitle(this.baseline);
    this.io.write(PROGRESS_CLEAR_SEQUENCE);
  }

  /** 停保活定时器（名册语义：句柄非空才取消、停后清位——重复停针 no-op） */
  stopKeepalive(): void {
    if (this.keepaliveHandle === null) return;
    this.cancel(this.keepaliveHandle);
    this.keepaliveHandle = null;
  }

  /** 起保活（schedule 缺席 = 缺位；触发后清位自重排续针——周期重发维持） */
  private armKeepalive(): void {
    if (this.schedule === null || this.keepaliveHandle !== null) return;
    this.keepaliveHandle = this.schedule(() => {
      this.keepaliveHandle = null;
      this.io.write(PROGRESS_ACTIVE_SEQUENCE); // 周期重发（超时衰减型终端维持）
      this.armKeepalive();
    }, OSC_PROGRESS_KEEPALIVE_MS);
  }
}
