/**
 * 真终端适配器（07 篇引擎节件 5 的真 TTY 位——TerminalIO 的 process 直连实现）。
 *
 * 引擎六件只认 TerminalIO 注入面、永不直触 process.stdin/stdout——本件是
 * 唯一的进程接缝。非 TTY fail-loud（管道下运行 berry-agent 需明确报错）归
 * host 装配批（批 12）在装配层执法——本件 setRawMode 对非 TTY 静默跳过
 * （`process.stdin.setRawMode` 在非 TTY 上会抛——先查 isTTY 再设）。
 */
import type { TerminalIO } from './types.js';

/** process stdin/stdout 直连适配器（组合根缺省注入位） */
export class ProcessTerminalIO implements TerminalIO {
  write(data: string): void {
    process.stdout.write(data);
  }

  size(): { columns: number; rows: number } {
    // 兜底用 || 而非 ??：pty 未设 winsize 时（expect/CI 伪终端）node 返回
    // rows/columns = 0 而非 undefined——`??` 只兜 null/undefined 兜不住 0；
    // 0 行 0 列的终端物理不存在，零值与缺席同属「无有效几何」，一律回落
    // 80×24（2026-09-13 真模型五轮实测定罪：0 值直透曾致 CellGrid 零宽
    // 只擦不写 + 负行号 CUP——固定区渲染全空）。
    return { columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
  }

  setRawMode(enable: boolean): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(enable);
  }

  isRaw(): boolean {
    return process.stdin.isRaw ?? false;
  }

  pause(): void {
    process.stdin.pause();
  }

  resume(): void {
    process.stdin.resume();
  }

  onInput(listener: (data: string) => void): () => void {
    const stdin = process.stdin;
    stdin.setEncoding('utf8');
    stdin.on('data', listener);
    return () => stdin.removeListener('data', listener);
  }

  onResize(listener: () => void): () => void {
    const stdout = process.stdout;
    stdout.on('resize', listener);
    return () => stdout.removeListener('resize', listener);
  }
}
