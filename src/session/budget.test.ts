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

describe('budgetString 收敛循环复杂度（G3——几何收敛对齐注释宣称）', () => {
  /** 旧形 oracle：逐字符收缩（修前实现原样转抄——对拍锁的等价判据源） */
  function legacyBudgetString(text: string, budget: number): string {
    if (escapedBytes(text) <= budget) return text;
    let sliced = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8');
    const legacyMarker = (truncatedChars: number): string => `…[truncated ${truncatedChars} chars]`;
    while (escapedBytes(sliced) + escapedBytes(legacyMarker(text.length - sliced.length)) > budget) {
      sliced = sliced.slice(0, Math.max(sliced.length - 1, 0));
      if (sliced.length === 0) break;
    }
    return sliced + legacyMarker(text.length - sliced.length);
  }

  /** 确定性 PRNG（mulberry32 固定种子——随机样例零 flaky） */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('行为等价对拍：随机样例（ASCII/CJK/代理对/控制字符/转义密集 × 各档预算）与旧逐字符形结果一致', () => {
    const rnd = mulberry32(20260928);
    // 字母表含控制字符字面量（NUL 六字符转义形态——收敛循环压力面）须以
    // 转义序列书写，源码禁裸控制字节（stripControl 同律）
    const controlChar = String.fromCharCode(0);
    const alphabets = ['a', 'ab \n\t"\\', '中文字符', '😀🌟', controlChar + '', 'x' + controlChar, '中😀"\\\\ 尾'];
    const budgets = [0, 1, 2, 3, 5, 8, 24, 64, 100, 1000, 4096];
    for (let i = 0; i < 400; i++) {
      const alpha = alphabets[Math.floor(rnd() * alphabets.length)]!;
      const len = Math.floor(rnd() * 2500);
      let text = '';
      for (let j = 0; j < len; j++) text += alpha[Math.floor(rnd() * alpha.length)]!;
      const budget = budgets[Math.floor(rnd() * budgets.length)]!;
      expect(budgetString(text, budget)).toBe(legacyBudgetString(text, budget));
    }
  });

  it('行为等价对拍：边界显式样例（孤立代理子编码折损形 / 代理对切断形）与旧形一致', () => {
    const loneHigh = String.fromCharCode(0xd83d); // 孤立高代理子（UTF-8 编码折 U+FFFD——截段体积可反降）
    const loneLow = String.fromCharCode(0xdf1f); // 孤立低代理子
    const cases: Array<[string, number]> = [
      [loneHigh.repeat(100), 200], // 全段即进预算形（编码折损）
      [loneHigh.repeat(100), 50], // 部分截段形
      [loneLow + loneHigh + 'a'.repeat(50), 30],
      ['😀'.repeat(100), 250], // 字节截断切在代理对中间（切断位单调性破坏形）
      ['😀'.repeat(100), 251],
      ['😀'.repeat(100), 253],
      ['中😀🌟'.repeat(60), 100],
      ['a😀'.repeat(200), 500],
    ];
    for (const [text, budget] of cases) {
      expect(budgetString(text, budget)).toBe(legacyBudgetString(text, budget));
    }
  });

  it('耗时上界锁：控制字符密集超帽输入毫秒级收敛（修前逐字符 O(n²) 热路径秒级空转）', () => {
    const nasty = 'x' + String.fromCharCode(0).repeat(16_384); // 32KiB 字节全占——转义后 ~3x 超帽
    const t0 = performance.now();
    const clipped = budgetString(nasty, 32 * 1024);
    const elapsed = performance.now() - t0;
    expect(escapedBytes(clipped)).toBeLessThanOrEqual(32 * 1024); // 收敛性不破
    // 修前红锚：逐字符收缩 ~7000 轮 × 每轮全串 JSON.stringify = 数百毫秒级空转
    expect(elapsed).toBeLessThan(100);
  }, 20_000);
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
