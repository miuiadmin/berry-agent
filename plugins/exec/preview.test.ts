/**
 * 流式活预览抽头纯逻辑测试（04 §8 流式活预览批②——节流/钳尾/载荷形/清账
 * 四族）。时钟面走 vitest 假钟（设计档 now 注入口省略形——advanceTimersByTime
 * 等价覆盖步进语义）；dispose 语义 = 末窗冲刷仅刷新已建行（首帧只走计时器
 * ——短命命令零帧面板无行；已建行 dispose 冲刷待发窗，末行确定呈现）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASH_PREVIEW_INTERVAL_MS, BASH_PREVIEW_TAIL_BYTES, createStreamPreview } from './preview.js';
import type { AgentToolResult } from '../../src/contracts/index.js';

/** AgentToolResult 形取首文本块（面板宽容解码同形消费——07 §4.1 件 5 承接面） */
function textOfFrame(frame: unknown): string {
  const first = (frame as AgentToolResult)?.content?.[0] as { type?: string; text?: string } | undefined;
  return first !== undefined && first.type === 'text' && typeof first.text === 'string' ? first.text : '';
}

describe('createStreamPreview 流式活预览抽头（04 §8 批②）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('trailing 节流：窗内合并单发、载荷为最新尾窗（0/100ms 零发、400ms 恰一发、第二窗到点再发）', () => {
    const frames: unknown[] = [];
    const tap = createStreamPreview((u) => frames.push(u));
    tap.onData('stdout', Buffer.from('line1\n'));
    vi.advanceTimersByTime(100);
    tap.onData('stdout', Buffer.from('line2\n'));
    // 节流窗内零发（400ms 未到——首块 0ms 起算）
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(300);
    // 到点恰一发且为最新尾窗（窗内两块合并）
    expect(frames.length).toBe(1);
    expect(textOfFrame(frames[0])).toBe('line1\nline2\n');
    // 第二窗：新数据重开窗、到点再发（帧载荷含累计尾窗）
    tap.onData('stderr', Buffer.from('err-late\n'));
    expect(frames.length).toBe(1);
    vi.advanceTimersByTime(BASH_PREVIEW_INTERVAL_MS);
    expect(frames.length).toBe(2);
    expect(textOfFrame(frames[1])).toBe('line1\nline2\nerr-late\n');
    tap.dispose();
  });

  it('钳尾 2KiB：超窗喂入 → 载荷 UTF-8 ≤ 帽且为输入尾部、多字节不劈 U+FFFD', () => {
    const frames: unknown[] = [];
    // 构造使切割点落在多字节字符中段：3072 字节 ASCII 头 + 300 字节中文（100×3）
    // + 尾部填充——尾窗 2048 的起点恰在首汉字第 3 续字节（前进到下一完整字符）
    const head = 'a'.repeat(3072);
    const mid = '汉'.repeat(100);
    const tail = 'c'.repeat(1750);
    expect(Buffer.byteLength(head + mid + tail, 'utf8')).toBe(5122); // 起点 5122-2048=3074（首字内）
    const tap = createStreamPreview((u) => frames.push(u));
    tap.onData('stdout', Buffer.from(head + mid + tail, 'utf8'));
    vi.advanceTimersByTime(BASH_PREVIEW_INTERVAL_MS);
    const text = textOfFrame(frames[0]);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(BASH_PREVIEW_TAIL_BYTES);
    // 是输入尾部（头段被钳）且不以半个字符开头、不产替换符
    expect(text.startsWith('汉')).toBe(true);
    expect(text.endsWith('c'.repeat(10))).toBe(true);
    expect(text).not.toContain('�');
    tap.dispose();
  });

  it('两流到达序合并：stdout/stderr 交错按到达序进同一窗（增量宽容解码分流解码器）', () => {
    const frames: unknown[] = [];
    const tap = createStreamPreview((u) => frames.push(u));
    tap.onData('stdout', Buffer.from('A'));
    tap.onData('stderr', Buffer.from('B'));
    tap.onData('stdout', Buffer.from('C'));
    vi.advanceTimersByTime(BASH_PREVIEW_INTERVAL_MS);
    expect(textOfFrame(frames[0])).toBe('ABC');
    tap.dispose();
  });

  it('多字节跨块：分块边界不劈（同流两块——解码器续上）', () => {
    const frames: unknown[] = [];
    const tap = createStreamPreview((u) => frames.push(u));
    const bytes = Buffer.from('中', 'utf8');
    tap.onData('stdout', bytes.subarray(0, 1));
    tap.onData('stdout', bytes.subarray(1));
    vi.advanceTimersByTime(BASH_PREVIEW_INTERVAL_MS);
    expect(textOfFrame(frames[0])).toBe('中');
    tap.dispose();
  });

  it('dispose 清账·已建行冲刷腿：待发窗冲刷一次刷新既有行、此后零新发射、幂等', () => {
    const frames: unknown[] = [];
    const tap = createStreamPreview((u) => frames.push(u));
    tap.onData('stdout', Buffer.from('first\n'));
    vi.advanceTimersByTime(BASH_PREVIEW_INTERVAL_MS);
    expect(frames.length).toBe(1); // 行已建（首帧走计时器）
    tap.onData('stdout', Buffer.from('second\n'));
    expect(frames.length).toBe(1); // 待发窗未到点
    tap.dispose(); // 冲刷待发窗——末行确定呈现（刷新既有行）
    expect(frames.length).toBe(2);
    expect(textOfFrame(frames[1])).toBe('first\nsecond\n');
    // 此后零新发射：推进时钟零发、再喂数据零发、二次 dispose 幂等
    vi.advanceTimersByTime(10_000);
    tap.onData('stdout', Buffer.from('late\n'));
    vi.advanceTimersByTime(10_000);
    tap.dispose();
    expect(frames.length).toBe(2);
  });

  it('dispose 清账·短命零帧腿：未发过帧则 dispose 不凭空造行（面板行非承诺）', () => {
    const frames: unknown[] = [];
    const tap = createStreamPreview((u) => frames.push(u));
    tap.onData('stdout', Buffer.from('quick\n'));
    expect(frames.length).toBe(0); // 节流窗未到
    tap.dispose(); // 零帧短命令——不冲刷（首帧只走计时器）
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(frames.length).toBe(0);
  });
});
