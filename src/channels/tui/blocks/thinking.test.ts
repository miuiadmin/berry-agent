/**
 * 思考块渲染测试（批 10i R1——纯函数直锁）。
 *
 * 覆盖：折叠单行标签形（斜体 + thinkingText 色）、展开档 = 标签行 + 改妆体行
 * （全游程 fg=thinkingText + italic、bold 保留）、空文零行、槽/定稿同函数
 * 两渲染同行集（换装跳行不漂移的定位前提）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../theme/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { renderThinkingStyledLines, thinkingLabelText, type ThinkingView } from './thinking.js';

const view = (text: string, expanded: boolean): ThinkingView => ({
  text,
  expanded,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

describe('思考块渲染两档', () => {
  it('折叠档 = 单行标签（整行斜体 + thinkingText 色、含键名提示）', () => {
    const lines = renderThinkingStyledLines(view('思考中……', false), 60);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.plain).toBe(`✻ 思考 ${'思考中……'.length} 字（ctrl+t 展开）`);
    expect(lines[0]!.runs).toEqual([
      { start: 0, end: lines[0]!.plain.length, style: { fg: DEFAULT_THEME.thinkingText, italic: true } },
    ]);
  });

  it('展开档 = 标签（收起提示）+ 体行改妆（全游程 italic+thinkingText、bold 保留）', () => {
    const lines = renderThinkingStyledLines(view('# 标\n\n正文', true), 60);
    expect(lines.length).toBeGreaterThan(2); // 标签 + 标题 + 空行 + 正文
    expect(lines[0]!.plain).toContain('收起');
    const body = lines.slice(1);
    for (const line of body) {
      for (const run of line.runs) {
        expect(run.style.italic).toBe(true); // 改妆位全量
        expect(run.style.fg).toBe(DEFAULT_THEME.thinkingText);
      }
    }
    // markdown 语义保留：标题行 bold 位仍在（层级不因单色面全平）
    const heading = body.find((l) => l.plain.includes('标'));
    expect(heading?.runs.some((r) => r.style.bold === true)).toBe(true);
  });

  it('空文零行（守卫位）', () => {
    expect(renderThinkingStyledLines(view('', false), 60)).toEqual([]);
  });

  it('标签文案单源（thinkingLabelText——展开/收起两动词）', () => {
    expect(thinkingLabelText(view('abc', false), '展开')).toContain('展开');
    expect(thinkingLabelText(view('abc', true), '收起')).toContain('收起');
  });
});

describe('槽/定稿同函数两渲染', () => {
  it('同文同宽同档 → 同行集（streaming 增量 doc ≡ MarkdownDoc 定稿——换装跳行前提）', () => {
    const text = '# 想法\n\n先这样，再那样。';
    const streamingDoc = new StreamingMarkdown();
    streamingDoc.update(text);
    const slotLines = renderThinkingStyledLines(view(text, true), 40, streamingDoc);
    const finalLines = renderThinkingStyledLines(view(text, true), 40, MarkdownDoc.of(text, DEFAULT_THEME));
    expect(slotLines).toEqual(finalLines);
  });

  it('档位不同行集不同（折叠 1 行、展开多行——toggle 改写后 repaint 可见差）', () => {
    const text = '一段较长的思考内容，展开必多行。';
    const collapsed = renderThinkingStyledLines(view(text, false), 40);
    const expanded = renderThinkingStyledLines(view(text, true), 40);
    expect(collapsed).toHaveLength(1);
    expect(expanded.length).toBeGreaterThan(1);
  });
});
