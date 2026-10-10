/**
 * 思考块渲染测试（批 10i R1——纯函数直锁；V-2 笔2 注④翻形）。
 *
 * 覆盖：折叠单行标签形（dim+斜体 + thinkingText 色——R-4 增补位）、三档
 * 标签文案（流式 `思考中…` / 定稿 `思考 · 4s` / repaint 无钟账 `思考`——
 * 计量人读律：字符数计量退役）、展开档 = 标签行 + 改妆体行（全游程
 * fg=thinkingText + italic + dim、bold 保留）、空文零行、槽/定稿同函数两
 * 渲染同行集（换装跳行不漂移的定位前提）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../theme/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { renderThinkingStyledLines, thinkingLabelText, type ThinkingView } from './thinking.js';

const view = (text: string, expanded: boolean, phase: ThinkingView['phase'], durationMs?: number): ThinkingView => ({
  text,
  expanded,
  phase,
  durationMs,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

describe('思考块渲染两档', () => {
  it('折叠档 = 单行标签（整行 dim+斜体 + thinkingText 色、含键名提示）', () => {
    const lines = renderThinkingStyledLines(view('思考中……', false, 'settled', 4000), 60);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.plain).toBe(`思考 · 4s（ctrl+t 展开）`);
    expect(lines[0]!.runs).toEqual([
      // R-4 dim 增补位（codex dim+italic 同构——斜体与 thinkingText 键维持）
      { start: 0, end: lines[0]!.plain.length, style: { fg: DEFAULT_THEME.thinkingText, italic: true, dim: true } },
    ]);
  });

  it('展开档 = 标签（收起提示）+ 体行改妆（全游程 dim+italic+thinkingText、bold 保留）', () => {
    const lines = renderThinkingStyledLines(view('# 标\n\n正文', true, 'settled', 4000), 60);
    expect(lines.length).toBeGreaterThan(2); // 标签 + 标题 + 空行 + 正文
    expect(lines[0]!.plain).toContain('收起');
    const body = lines.slice(1);
    for (const line of body) {
      for (const run of line.runs) {
        expect(run.style.italic).toBe(true); // 改妆位全量
        expect(run.style.dim).toBe(true); // R-4 增补位同入改妆（spread 承载）
        expect(run.style.fg).toBe(DEFAULT_THEME.thinkingText);
      }
    }
    // markdown 语义保留：标题行 bold 位仍在（层级不因单色面全平）
    const heading = body.find((l) => l.plain.includes('标'));
    expect(heading?.runs.some((r) => r.style.bold === true)).toBe(true);
  });

  it('空文零行（守卫位）', () => {
    expect(renderThinkingStyledLines(view('', false, 'settled', 4000), 60)).toEqual([]);
  });

  it('标签三档单源（thinkingLabelText——V-2 笔2 注④计量人读律：字符计数退役）', () => {
    // 流式档：进行中省略形（无计量——字数不再逐帧变）
    expect(thinkingLabelText(view('正在想', false, 'streaming'), '展开')).toBe('思考中…（ctrl+t 展开）');
    // 定稿档：本地钟时长（整秒档单源 formatElapsedCompact——与 run 级耗时同源）
    expect(thinkingLabelText(view('想完了', false, 'settled', 4000), '展开')).toBe('思考 · 4s（ctrl+t 展开）');
    expect(thinkingLabelText(view('想完了', true, 'settled', 72_000), '收起')).toBe('思考 · 1m 12s（ctrl+t 收起）');
    // repaint/历史形：无钟账诚实缺席（`思考（键名 动作）`——不虚构时长）
    expect(thinkingLabelText(view('想完了', false, 'settled'), '展开')).toBe('思考（ctrl+t 展开）');
    expect(thinkingLabelText(view('想完了', true, 'settled'), '收起')).toContain('收起');
  });
});

describe('槽/定稿同函数两渲染', () => {
  it('同文同宽同档 → 同行集（streaming 增量 doc ≡ MarkdownDoc 定稿——换装跳行前提）', () => {
    const text = '# 想法\n\n先这样，再那样。';
    const streamingDoc = new StreamingMarkdown();
    streamingDoc.update(text);
    const slotLines = renderThinkingStyledLines(view(text, true, 'settled', 4000), 40, streamingDoc);
    const finalLines = renderThinkingStyledLines(
      view(text, true, 'settled', 4000),
      40,
      MarkdownDoc.of(text, DEFAULT_THEME),
    );
    expect(slotLines).toEqual(finalLines);
  });

  it('档位不同行集不同（折叠 1 行、展开多行——toggle 改写后 repaint 可见差）', () => {
    const text = '一段较长的思考内容，展开必多行。';
    const collapsed = renderThinkingStyledLines(view(text, false, 'settled', 4000), 40);
    const expanded = renderThinkingStyledLines(view(text, true, 'settled', 4000), 40);
    expect(collapsed).toHaveLength(1);
    expect(expanded.length).toBeGreaterThan(1);
  });
});
