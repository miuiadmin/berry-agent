/**
 * 流式 markdown 直推件测试（批 10h——纯逻辑直锁）。
 *
 * 覆盖：update 幂等短路、稳定面计量三形（块粒度判据——闭栏代码/尾行已终
 * 单行块/回流形恒不稳）、渲染与定稿件同管线（同文同宽同行集）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CellGrid } from '../../engine/index.js';
import { MarkdownDoc } from './markdown.js';
import { parseMarkdown } from './blocks.js';
import { StreamingMarkdown } from './streaming.js';

/** 两 doc 同文渲染行集对拍（同管线律断言助手） */
function rowsOf(
  doc: {
    measure(w: number): number;
    render(g: CellGrid, r: { row: number; col: number; width: number; height: number }): void;
  },
  width: number,
): string[] {
  const grid = new CellGrid(width, Math.max(1, doc.measure(width)));
  doc.render(grid, { row: 0, col: 0, width, height: grid.rows });
  const rows: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let line = '';
    for (let c = 0; c < width; c++) {
      const cell = grid.getCell(r, c);
      line += cell ? cell.grapheme : ' ';
    }
    rows.push(line.trimEnd());
  }
  return rows;
}

describe('StreamingMarkdown 流式直推', () => {
  it('update 幂等短路 + text 观测面', () => {
    const s = new StreamingMarkdown();
    expect(s.text).toBeNull();
    s.update('# 标\n\n段');
    expect(s.text).toBe('# 标\n\n段');
    const before = s.measure(40);
    s.update('# 标\n\n段'); // 同文短路——非重解析路径
    expect(s.measure(40)).toBe(before);
  });

  it('渲染与定稿件同管线（同文同宽同行集——main-screen 冻结跳行的定位前提）', () => {
    const text = '# 标\n\n段一\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |';
    const s = new StreamingMarkdown();
    s.update(text);
    expect(rowsOf(s, 40)).toEqual(rowsOf(MarkdownDoc.of(text), 40));
  });

  it('稳定面三形之闭栏代码：尾块闭栏即全稳（高亮已定，追加必为新块）', () => {
    const s = new StreamingMarkdown();
    s.update('段\n\n```ts\nconst x = 1;\n```');
    expect(s.stableLineCount(40)).toBe(s.measure(40)); // 尾块稳定 → 全文稳定
  });

  it('稳定面三形之单行终态块：标题/列表/引用/横线 + 尾随换行 → 稳', () => {
    const s = new StreamingMarkdown();
    s.update('# 标\n\n段\n\n- 项\n');
    // 尾块 = list-item 且文末有换行 → 稳定面 = 全块；段落（回流形）不算稳
    expect(s.stableLineCount(40)).toBe(s.measure(40));
  });

  it('稳定面三形之回流形：段落尾 / 表格尾 / 开栏代码 / 无换行尾 → 止于尾块前', () => {
    const s1 = new StreamingMarkdown();
    s1.update('# 标\n\n段落仍在流'); // 尾块段落无换行——不稳
    const s2 = new StreamingMarkdown();
    s2.update('段\n\n| a |\n| --- |\n| 1 |'); // 尾块表格（列宽回流）——不稳（前缀段可稳）
    const s3 = new StreamingMarkdown();
    s3.update('段\n\n```ts\nconst'); // 开栏代码（闭栏样式回翻）——不稳
    const s4 = new StreamingMarkdown();
    s4.update('# 标题仍在流'); // 标题但无尾随换行——行内容可延伸，不稳
    for (const s of [s1, s2, s3]) {
      const prefix = rowsOf({ measure: (w) => s.stableLineCount(w), render: (g, r) => s.render(g, r) }, 40);
      expect(s.stableLineCount(40)).toBeLessThan(s.measure(40)); // 尾块被排除
      expect(s.stableLineCount(40)).toBeGreaterThanOrEqual(1); // 前缀块在场
      expect(prefix.length).toBe(s.stableLineCount(40)); // 助手 sanity
    }
    expect(s4.stableLineCount(40)).toBe(0); // 单块无换行——稳定面前缀恰空
  });

  it('空 doc 稳定面零（起步帧冻结面空）', () => {
    const s = new StreamingMarkdown();
    expect(s.stableLineCount(40)).toBe(0);
    expect(s.measure(40)).toBe(0);
  });
});

/* ---------------- 渲染热路径 D2：计数改算术 ---------------- */

describe('StreamingMarkdown 计数算术（渲染热路径 D2——计数腿不装配行集）', () => {
  /** 引用实现：镜像修前 stableLineCount 本体（MarkdownDoc.prefixRows 装配后取长） */
  function referenceStable(text: string, width: number): number {
    const blocks = parseMarkdown(text);
    if (blocks.length === 0) return 0;
    const tail = blocks[blocks.length - 1]!;
    const tailSafe =
      tail.type === 'code'
        ? tail.open !== true
        : text.endsWith('\n') &&
          (tail.type === 'heading' || tail.type === 'list-item' || tail.type === 'quote' || tail.type === 'hr');
    const stableBlocks = blocks.length - 1 + (tailSafe ? 1 : 0);
    return MarkdownDoc.fromBlocks(blocks, null).prefixRows(width, stableBlocks).length;
  }

  /** 多形语料：七块型 + 零行块（空代码）+ 开栏尾 + 长折行 + 终态单行块尾 */
  const CORPUS = [
    '# 标\n\n段落一\n\n段落二\n\n```ts\nconst x = 1;\n```\n\n- 项一\n- 项二\n\n---',
    '第一段\n\n> 引用一\n> 引用二\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |',
    '段前\n\n```\n```', // 零行闭栏代码（块间空行算术非 B-1 形的判据样本）
    '段前\n\n```\nline\n```',
    '```\nline1\nline2', // 开栏尾块（恒不稳）
    '中文长段落折行样本文本'.repeat(12),
    '> q\n\n```\n```', // 零行块为尾（tailSafe 闭栏 → 全稳）
    '# 仅标题\n',
    '1. 有序\n2. 项\n',
    '',
  ];
  const WIDTHS = [80, 40, 20, 7, 3, 1];

  it('stableLineCount 对拍锁：逐语料逐宽与引用实现（修前行为）全等', () => {
    for (const text of CORPUS) {
      const s = new StreamingMarkdown();
      s.update(text);
      for (const w of WIDTHS) expect(s.stableLineCount(w)).toBe(referenceStable(text, w));
    }
  });

  it('measure 对拍锁：逐语料逐宽与 MarkdownDoc.of(text).measure 全等', () => {
    for (const text of CORPUS) {
      const s = new StreamingMarkdown();
      s.update(text);
      for (const w of WIDTHS) expect(s.measure(w)).toBe(MarkdownDoc.of(text).measure(w));
    }
  });

  it('流式多帧链：逐帧计数与一步到位直构全等（帧间承接零漂移）', () => {
    const frames = [
      '# 标\n',
      '# 标\n\n段落起',
      '# 标\n\n段落起\n\n```ts\nconst',
      '# 标\n\n段落起\n\n```ts\nconst x = 1;\n```',
      '# 标\n\n段落起\n\n```ts\nconst x = 1;\n```\n\n- 项\n',
    ];
    const stepwise = new StreamingMarkdown();
    for (const frame of frames) {
      stepwise.update(frame);
      const direct = new StreamingMarkdown();
      direct.update(frame);
      for (const w of [40, 7]) {
        expect(stepwise.stableLineCount(w)).toBe(direct.stableLineCount(w));
        expect(stepwise.measure(w)).toBe(direct.measure(w));
      }
    }
  });

  it('硬钉值：修前绝对值面（零行块空行算术 / 开栏零稳面 / 段落排除）', () => {
    const s1 = new StreamingMarkdown();
    s1.update('段前\n\n```\n```');
    expect(s1.stableLineCount(40)).toBe(2); // 段 1 行 + 块间空行 1 + 零行块 0——闭栏全稳
    expect(s1.measure(40)).toBe(2);
    const s2 = new StreamingMarkdown();
    s2.update('# 标\n\n段落一');
    expect(s2.stableLineCount(40)).toBe(2); // 尾块段落不稳——稳定面止于标题块（H1 = 标题行 + 尾线 2 行）
    expect(s2.measure(40)).toBe(4); // 标题 2 行 + 空行 + 段落 1 行
    const s3 = new StreamingMarkdown();
    s3.update('```\nline1\nline2');
    expect(s3.stableLineCount(40)).toBe(0); // 开栏尾块恒不稳——单块文档稳面恰空
    expect(s3.measure(40)).toBe(2);
  });

  it('词法锁：逐块行数算术缓存位在场（源码标记恰一处）', () => {
    const src = readFileSync(new URL('./streaming.ts', import.meta.url), 'utf8');
    expect((src.match(/渲染热路径 D2——逐块行数算术缓存/g) ?? []).length).toBe(1);
  });
});
