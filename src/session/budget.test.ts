/**
 * 预算刀单元测试（05 篇 §1.2 步 4——60KiB 内容帽 + errorMessage 2KiB 小帽）。
 *
 * 执法面红锁：度量同尺（转义后字节）、双帽独立计帽、块数组逐块累加防
 * 多腿同源叠加、image 占位降级、分派表全覆盖。
 */
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from './event-data.js';
import {
  ERROR_MESSAGE_BUDGET_BYTES,
  EVENT_BUDGET_BYTES,
  applyEventBudget,
  budgetString,
  escapedBytes,
  truncateContent,
} from './budget.js';

describe('escapedBytes 护栏同尺度量', () => {
  it('量 JSON 转义后体积（换行 2 字符转义 = 4 字节含引号）', () => {
    expect(escapedBytes('\n')).toBe(4); // "\n" → 反斜杠+n+双引号×2
    expect(escapedBytes('a')).toBe(3); // "a"
  });

  it('控制字符 6x 转义（护栏与预算刀同把尺的根据）', () => {
    // NUL 字符六字符转义（\u0000）+ 双引号 = 8 字节
    expect(escapedBytes('\u0000')).toBe(8);
  });
});

describe('budgetString 按字节预算截断', () => {
  it('不超预算原样返回（同一引用——零拷贝快路径）', () => {
    const text = 'short';
    expect(budgetString(text)).toBe(text);
  });

  it('超预算截断 + 尾标记（N = 截掉字符数）', () => {
    const text = 'a'.repeat(10_000);
    const clipped = budgetString(text, 100);
    expect(clipped.length).toBeLessThan(text.length);
    expect(clipped).toContain('[truncated ');
    expect(clipped).toContain(' chars]');
    // N 与差值对账：截掉字符数 = 原长 - 截段长（截段 = clipped 去掉 … 起的尾标记）
    const m = /\[truncated (\d+) chars\]$/.exec(clipped);
    expect(m).not.toBeNull();
    const truncatedChars = Number(m![1]);
    expect(truncatedChars).toBe(text.length - clipped.indexOf('…'));
  });

  it('结果体积收敛进预算（转义后字节——含尾标记自身）', () => {
    // 控制字符密集（6x 转义形态）是收敛循环的压力面
    const nasty = 'x\u0000'.repeat(40_000);
    const clipped = budgetString(nasty, 500);
    expect(escapedBytes(clipped)).toBeLessThanOrEqual(500);
  });
});

describe('truncateContent 内容腿截断', () => {
  it('字符串形态：整串按预算截（user 消息直文本）', () => {
    const clipped = truncateContent('u'.repeat(EVENT_BUDGET_BYTES + 100)) as string;
    expect(clipped).toContain('[truncated ');
    expect(clipped.length).toBeLessThan(EVENT_BUDGET_BYTES + 100);
  });

  it('块数组预算内：原样引用返回（=== 同引用——零开销快路径）', () => {
    const content = [{ type: 'text', text: 'hi' }] as const;
    expect(truncateContent(content)).toBe(content);
  });

  it('单块超帽：text 块按预算截加尾标记', () => {
    const clipped = truncateContent([{ type: 'text', text: 't'.repeat(EVENT_BUDGET_BYTES + 10) }]);
    expect(clipped.length).toBe(1);
    const block = clipped[0] as { type: string; text: string };
    expect(block.type).toBe('text');
    expect(block.text).toContain('[truncated ');
  });

  it('多块叠加击穿：每块均低于帽但总和超帽——逐块累加防线生效', () => {
    // 3 块各 30KiB：单块全过、总和 90KiB 击穿 60KiB
    const content: ContentBlock[] = [
      { type: 'text', text: 'a'.repeat(30 * 1024) },
      { type: 'text', text: 'b'.repeat(30 * 1024) },
      { type: 'text', text: 'c'.repeat(30 * 1024) },
    ];
    const clipped = truncateContent(content);
    expect(clipped.length).toBe(2); // 前两块占满预算，第三块丢弃
    expect((clipped[1] as { text: string }).text).toContain('[truncated ');
  });

  it('image 块放不下剩余预算：落 image-blob-dropped 占位（保留语义不保像素）', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: 'p'.repeat(50 * 1024) },
      { type: 'image', data: 'i'.repeat(70 * 1024) },
    ];
    const clipped = truncateContent(content);
    expect(clipped.length).toBe(2);
    expect(clipped[1]).toEqual({ type: 'text', text: '[image-blob-dropped: durable budget]' });
  });

  it('image 块容得下剩余预算：保留像素原样', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: '小前缀' },
      { type: 'image', data: 'i'.repeat(1024) },
    ];
    // 总量在预算内：快路径原样引用返回（=== 同引用）
    expect(truncateContent(blocks)).toBe(blocks);
  });

  it('thinking 块同式截断（thinking 腿不豁免）', () => {
    const clipped = truncateContent([{ type: 'thinking', thinking: 'k'.repeat(EVENT_BUDGET_BYTES + 5) }]);
    expect((clipped[0] as { thinking: string }).thinking).toContain('[truncated ');
  });
});

describe('applyEventBudget 分派表', () => {
  it('user/message：content 截腿 + truncated 事实', () => {
    const result = applyEventBudget('user/message', { content: 'u'.repeat(EVENT_BUDGET_BYTES + 99) });
    expect(result.truncated).toBe(true);
    expect((result.data as { content: string }).content).toContain('[truncated ');
  });

  it('tool/result：content 截腿', () => {
    const result = applyEventBudget('tool/result', {
      toolCallId: 'c1',
      content: [{ type: 'text', text: 'r'.repeat(EVENT_BUDGET_BYTES + 99) }],
    });
    expect(result.truncated).toBe(true);
    const content = (result.data as { content: Array<{ text: string }> }).content;
    expect(content[0]!.text).toContain('[truncated ');
  });

  it('assistant/message：content 与 errorMessage 双帽独立计帽（同源双载防线）', () => {
    const result = applyEventBudget('assistant/message', {
      content: [{ type: 'text', text: 'x'.repeat(EVENT_BUDGET_BYTES + 100) }],
      errorMessage: 'e'.repeat(ERROR_MESSAGE_BUDGET_BYTES + 100),
    });
    expect(result.truncated).toBe(true);
    const data = result.data as { content: Array<{ text: string }>; errorMessage: string };
    expect(data.content[0]!.text.length).toBeLessThan(EVENT_BUDGET_BYTES);
    expect(data.errorMessage.length).toBeLessThan(ERROR_MESSAGE_BUDGET_BYTES);
    expect(data.errorMessage).toContain('[truncated ');
  });

  it('assistant/message：errorMessage 单独超小帽也截（2KiB 独立执法）', () => {
    const result = applyEventBudget('assistant/message', {
      content: [{ type: 'text', text: '正常内容' }],
      errorMessage: 'e'.repeat(ERROR_MESSAGE_BUDGET_BYTES + 1),
    });
    expect(result.truncated).toBe(true);
    expect((result.data as { errorMessage: string }).errorMessage).toContain('[truncated ');
  });

  it('tool/call：arguments 原始字符串截腿', () => {
    const result = applyEventBudget('tool/call', {
      toolCallId: 'c1',
      name: 't',
      arguments: '{'.repeat(EVENT_BUDGET_BYTES + 50),
    });
    expect(result.truncated).toBe(true);
    expect((result.data as { arguments: string }).arguments).toContain('[truncated ');
  });

  it('其余类型超帽：data 整体序列化截断（最后手段的可观测降级）', () => {
    const result = applyEventBudget('sandbox/mode', { mode: 'y'.repeat(EVENT_BUDGET_BYTES + 200) });
    expect(result.truncated).toBe(true);
    expect(typeof result.data).toBe('string');
    expect(result.data as string).toContain('[truncated ');
  });

  it('原始值/小对象形态：原样直过（无腿可裁）', () => {
    expect(applyEventBudget('turn/start', {})).toEqual({ data: {}, truncated: false });
    expect(applyEventBudget('turn/end', { reason: 'completed' })).toEqual({
      data: { reason: 'completed' },
      truncated: false,
    });
  });

  it('不修改原 data（纯函数面——原值只读）', () => {
    const original = { content: 'u'.repeat(EVENT_BUDGET_BYTES + 10) };
    applyEventBudget('user/message', original);
    expect(original.content).toBe('u'.repeat(EVENT_BUDGET_BYTES + 10));
  });
});
