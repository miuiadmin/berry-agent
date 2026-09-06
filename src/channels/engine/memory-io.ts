/**
 * MemoryTerminalIO——TerminalIO 的内存实现（07 引擎节件 1：引擎公开测试面，
 * 结构性义务非可选件）。
 *
 * 一切引擎行为可在注入替身下测试：写出收帧（bytes 累积 + 每次 write 一帧）、
 * 输入 / resize 经测试侧 emit 注入、几何可设。真终端适配（ProcessTerminalIO）
 * 归批 10c，本件长驻公开面供各层测试复用。
 */
import type { TerminalIO } from './types.js';

export class MemoryTerminalIO implements TerminalIO {
  /** 累积写出全文（多帧拼接——帧序分析用 frames） */
  public bytes = '';
  /** 逐帧记录（每次 write 一项——收帧语义断言用） */
  public readonly frames: string[] = [];
  /** 几何（测试可设——resize 场景直接改字段后 emitResize） */
  public columns: number;
  public rows: number;
  /** setRawMode 调用史（true = 开 / false = 关，序即调用序） */
  public readonly rawModeHistory: boolean[] = [];
  /** 当前 raw 真值（isRaw 查询面——末次 setRawMode 结果） */
  public raw = false;
  /** pause / resume 调用计数（挂起交出面断言用） */
  public pauseCount = 0;
  public resumeCount = 0;

  private readonly inputListeners = new Set<(data: string) => void>();
  private readonly resizeListeners = new Set<() => void>();

  constructor(columns = 80, rows = 24) {
    this.columns = columns;
    this.rows = rows;
  }

  /** 写出收帧（帧记录 + 全文累积） */
  write(data: string): void {
    this.frames.push(data);
    this.bytes += data;
  }

  size(): { columns: number; rows: number } {
    return { columns: this.columns, rows: this.rows };
  }

  setRawMode(enable: boolean): void {
    this.rawModeHistory.push(enable);
    this.raw = enable;
  }

  isRaw(): boolean {
    return this.raw;
  }

  pause(): void {
    this.pauseCount++;
  }

  resume(): void {
    this.resumeCount++;
  }

  onInput(listener: (data: string) => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  /** 测试注入：驱动全部输入监听器（模拟终端字节流到达——同步派发） */
  emitInput(data: string): void {
    for (const listener of this.inputListeners) listener(data);
  }

  /** 测试注入：驱动全部 resize 监听器（几何已由测试侧先行改定） */
  emitResize(): void {
    for (const listener of this.resizeListeners) listener();
  }

  /** 清输出账（长测试分段断言用——监听器几何保留） */
  reset(): void {
    this.bytes = '';
    this.frames.length = 0;
  }
}
