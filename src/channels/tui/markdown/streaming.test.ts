/**
 * 流式 markdown 直推件测试（批 10h——纯逻辑直锁）。
 *
 * 覆盖：update 幂等短路、稳定面计量三形（块粒度判据——闭栏代码/尾行已终
 * 单行块/回流形恒不稳）、渲染与定稿件同管线（同文同宽同行集）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { MarkdownDoc } from './markdown.js';
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
