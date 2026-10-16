/**
 * 思考块渲染测试（批 10i R1——纯函数直锁；V-2 笔2 注④翻形）。
 *
 * 覆盖：折叠单行标签形（dim+斜体 + thinkingText 色——R-4 增补位）、三档
 * 标签文案（流式 `思考中` / 定稿 `思考 · 4s` / repaint 无钟账 `思考`——
 * 计量人读律：字符数计量退役）+ 内容首行预览三档嵌位与缺席退化
 * （件 C——2026-10-16 用户三反馈：「已思考」行可知所思）、展开档 =
 * 标签行 + 改妆体行（全游程 fg=thinkingText + italic + dim、bold 保留）、
 * 空文零行、槽/定稿同函数两渲染同行集（换装跳行不漂移的定位前提）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../theme/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { renderThinkingStyledLines, thinkingLabelText, thinkingPreviewText, type ThinkingView } from './thinking.js';

const view = (text: string, expanded: boolean, phase: ThinkingView['phase'], durationMs?: number): ThinkingView => ({
  text,
  expanded,
  phase,
  durationMs,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

describe('思考块渲染两档', () => {
  it('折叠档 = 单行标签（整行 dim+斜体 + thinkingText 色、含键名提示与内容首行预览——件 C 修前红：标签无预览段）', () => {
    const lines = renderThinkingStyledLines(view('先想了个开头', false, 'settled', 4000), 60);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.plain).toBe(`思考 · 4s · 先想了个开头（ctrl+t 展开）`);
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

  it('混排行整面改妆——行内样式段两侧裸文本间隙同入思考妆（挖掘 34 轮；修前红：间隙零游程走 SGR_RESET 默认前景/正体/非 dim，与同块体行割裂——违「整面改妆」契约与 R-4 同构条款）', () => {
    const lines = renderThinkingStyledLines(view('前文 **重点** 后文', true, 'settled', 4000), 60);
    const body = lines.slice(1).filter((l) => l.plain.includes('前文'));
    expect(body).toHaveLength(1);
    const line = body[0]!;
    // 覆盖并集 = [0, plain.length)——修前红：仅 bold 段有游程，两侧裸文本间隙 uncovered
    const covered = new Set<number>();
    for (const run of line.runs) {
      expect(run.style.italic).toBe(true); // 既有游程改妆位不变
      expect(run.style.dim).toBe(true);
      expect(run.style.fg).toBe(DEFAULT_THEME.thinkingText);
      for (let i = run.start; i < run.end; i++) covered.add(i);
    }
    for (let i = 0; i < line.plain.length; i++) {
      expect(covered.has(i)).toBe(true);
    }
    // markdown 语义保留：**重点** 段 bold 位仍在
    expect(line.runs.some((r) => r.style.bold === true)).toBe(true);
  });

  it('空文零行（守卫位）', () => {
    expect(renderThinkingStyledLines(view('', false, 'settled', 4000), 60)).toEqual([]);
  });

  it('标签三档单源（thinkingLabelText——V-2 笔2 注④计量人读律：字符计数退役）', () => {
    // 两参调用（columns 缺席）= 件 C 预览缺席退化形锁——词面逐字零回归：
    // 流式档：进行中省略形（无计量——字数不再逐帧变；省略号随预览缺席归位）
    expect(thinkingLabelText(view('正在想', false, 'streaming'), '展开')).toBe('思考中…（ctrl+t 展开）');
    // 定稿档：本地钟时长（整秒档单源 formatElapsedCompact——与 run 级耗时同源）
    expect(thinkingLabelText(view('想完了', false, 'settled', 4000), '展开')).toBe('思考 · 4s（ctrl+t 展开）');
    expect(thinkingLabelText(view('想完了', true, 'settled', 72_000), '收起')).toBe('思考 · 1m 12s（ctrl+t 收起）');
    // repaint/历史形：无钟账诚实缺席（`思考（键名 动作）`——不虚构时长）
    expect(thinkingLabelText(view('想完了', false, 'settled'), '展开')).toBe('思考（ctrl+t 展开）');
    expect(thinkingLabelText(view('想完了', true, 'settled'), '收起')).toContain('收起');
  });

  it('标签三档内容预览（件 C——columns 在场嵌首行预览；流式去原省略号与截断省略号语义撞）', () => {
    // 流式档：`思考中 · {preview}`（原尾省略号退役——预览截断自有省略号）
    expect(thinkingLabelText(view('先想了个开头', false, 'streaming'), '展开', 60)).toBe(
      '思考中 · 先想了个开头（ctrl+t 展开）',
    );
    // 定稿档：时长与预览并陈
    expect(thinkingLabelText(view('先想了个开头', false, 'settled', 4000), '展开', 60)).toBe(
      '思考 · 4s · 先想了个开头（ctrl+t 展开）',
    );
    expect(thinkingLabelText(view('先想了个开头', true, 'settled', 72_000), '收起', 60)).toBe(
      '思考 · 1m 12s · 先想了个开头（ctrl+t 收起）',
    );
    // repaint/历史档：无钟账形也嵌预览（时长缺席不虚构、内容不缺席）
    expect(thinkingLabelText(view('先想了个开头', false, 'settled'), '展开', 60)).toBe(
      '思考 · 先想了个开头（ctrl+t 展开）',
    );
    // 流式逐帧生长：预览随末快照更新（标签恒单行——行数账零动）
    expect(thinkingLabelText(view('先想', false, 'streaming'), '展开', 60)).toBe('思考中 · 先想（ctrl+t 展开）');
    expect(thinkingLabelText(view('先想了个开头', false, 'streaming'), '展开', 60)).toBe(
      '思考中 · 先想了个开头（ctrl+t 展开）',
    );
  });

  it('窄宽退化（件 C——预算 ≤0 预览缺席，词面逐字回退现三档形）', () => {
    // 定稿档非预览段宽 24（60 列预算 33 → 预览在场；24 列预算 -3 → 缺席）
    expect(thinkingLabelText(view('先想了个开头', false, 'settled', 4000), '展开', 24)).toBe(
      '思考 · 4s（ctrl+t 展开）',
    );
    // 流式档退化：原尾省略号归位（预览缺席零回归）
    expect(thinkingLabelText(view('先想了个开头', false, 'streaming'), '展开', 10)).toBe('思考中…（ctrl+t 展开）');
    // 空文/纯空白：预览缺席（renderThinkingStyledLines 空文另走零行守卫——此锁
    // 防御直呼面空文词面）
    expect(thinkingLabelText(view('', false, 'settled', 4000), '展开', 60)).toBe('思考 · 4s（ctrl+t 展开）');
    expect(thinkingLabelText(view('   \n  \n', false, 'settled', 4000), '展开', 60)).toBe('思考 · 4s（ctrl+t 展开）');
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

describe('thinkingPreviewText 纯函数（件 C——预览取法单源，测试直锁）', () => {
  it('取法：首非空行 + 剥 markdown 记号 + 空白折叠单空格', () => {
    // 首非空行（跨行思考取首段——多思考块合并形首块首行；后文不进预览）
    expect(thinkingPreviewText('**先下结论**：就这样\n\n后文不进预览', 60)).toBe('先下结论：就这样');
    // 行首标题记号剥离（#+ 前缀 + 前导空白）
    expect(thinkingPreviewText('# 标题起手\n正文', 60)).toBe('标题起手');
    expect(thinkingPreviewText('###深标题', 60)).toBe('深标题');
    // 链接对剥离（呈现文不呈现址）
    expect(thinkingPreviewText('见 [文档页](https://a.com/x) 收尾', 60)).toBe('见 文档页 收尾');
    // 反引号对剥离（行内码）
    expect(thinkingPreviewText('`code` 行', 60)).toBe('code 行');
    // 首非空行判定跳过纯空白行；行内多空白折叠单空格 + 首尾 trim
    expect(thinkingPreviewText('  \n\n  首个非空行  中缝空白 ', 60)).toBe('首个非空行 中缝空白');
  });

  it('消毒（sanitizeDisplayText 单源——ESC 序列整段剥/C0 剥除）', () => {
    expect(thinkingPreviewText('先\x1b[31m想', 60)).toBe('先想'); // CSI 整段
    expect(thinkingPreviewText('先\x07想', 60)).toBe('先想'); // 纯 C0（BEL）
  });

  it('截断省略（ellipsize 显示宽整字截断）与 budget ≤0 返空', () => {
    expect(thinkingPreviewText('abcdefghij', 5)).toBe('abcd…');
    expect(thinkingPreviewText('一二三四五六七', 5)).toBe('一二…'); // CJK 整字不产半字
    expect(thinkingPreviewText('先想了个开头', 0)).toBe(''); // 0 预算 = 预览缺席
    expect(thinkingPreviewText('', 60)).toBe(''); // 空文
    expect(thinkingPreviewText('   \n  \n', 60)).toBe(''); // 纯空白 = 缺席
  });
});
