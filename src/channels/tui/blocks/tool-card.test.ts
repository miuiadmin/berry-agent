/**
 * 工具卡渲染测试（批 10i R4——纯函数直锁）。
 *
 * 覆盖：三态卡头（✓/✖/⏹ 语义色 + 名/简述 dim）、折叠尾 5 行预览（整面
 * dim）/ 展开全量、cardBodyOf 尾留帽与截断标记、edit diff 档（1 删 1 增词级
 * 红绿、孤立行整行红绿、meta dim、超宽截断游程钳制）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../theme/index.js';
import {
  CARD_BODY_MAX_LINES,
  CARD_PREVIEW_LINES,
  cardBodyOf,
  renderToolCardStyledLines,
  type ToolCardView,
} from './tool-card.js';

const card = (over: Partial<ToolCardView>): ToolCardView => ({
  name: 'read',
  brief: '(path)',
  status: 'success',
  body: ['行一', '行二', '行三'],
  diff: false,
  expanded: false,
  theme: DEFAULT_THEME,
  ...over,
});

describe('工具卡三态卡头', () => {
  it('success 卡头：✓ 符号 success 色 + 名/简述 dim', () => {
    const lines = renderToolCardStyledLines(card({}), 40);
    expect(lines[0]!.plain).toBe(' ✓ read(path)');
    expect(lines[0]!.runs).toEqual([
      { start: 0, end: 2, style: { fg: DEFAULT_THEME.success } },
      { start: 2, end: 13, style: { dim: true } },
    ]);
  });

  it('error / aborted 卡头分档：✖ error 色 / ⏹ secondary（次文同档弱存在感）', () => {
    const err = renderToolCardStyledLines(card({ status: 'error' }), 40)[0]!;
    expect(err.plain).toContain('✖');
    expect(err.runs[0]).toMatchObject({ style: { fg: DEFAULT_THEME.error } });
    const aborted = renderToolCardStyledLines(card({ status: 'aborted' }), 40)[0]!;
    expect(aborted.plain).toContain('⏹');
    expect(aborted.runs[0]).toMatchObject({ style: { fg: DEFAULT_THEME.secondary } });
  });
});

describe('卡体两档与存账帽', () => {
  it('折叠 = 尾 CARD_PREVIEW_LINES 视觉行且整面 dim；展开 = 全量正常亮度', () => {
    const body = Array.from({ length: 12 }, (_, i) => `第 ${i} 行`);
    const collapsed = renderToolCardStyledLines(card({ body }), 40);
    expect(collapsed).toHaveLength(1 + CARD_PREVIEW_LINES); // 卡头 + 尾 5
    expect(collapsed[collapsed.length - 1]!.plain).toBe('第 11 行'); // 尾行取尾
    expect(collapsed.slice(1).every((l) => l.runs.every((r) => r.style.dim === true))).toBe(true); // 预览 dim
    const expanded = renderToolCardStyledLines(card({ body, expanded: true }), 40);
    expect(expanded).toHaveLength(1 + 12);
    expect(expanded.slice(1).every((l) => l.runs.every((r) => r.style.dim !== true))).toBe(true);
  });

  it('cardBodyOf 尾留帽：超帽截头保尾 + 截断标记首行', () => {
    const lines = Array.from({ length: CARD_BODY_MAX_LINES + 30 }, (_, i) => `L${i}`);
    const body = cardBodyOf(lines.join('\n'));
    expect(body).toHaveLength(CARD_BODY_MAX_LINES + 1); // 标记行 + 尾留 200
    expect(body[0]).toContain('前文已省 30 行');
    expect(body[body.length - 1]).toBe('L229'); // 尾行保住
  });
});

describe('edit diff 档', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.ts',
    ' const same = 1;',
    '-const old = 2;',
    '+const new = 3;',
    '-孤行删除',
  ].join('\n');

  it('1 删 1 增相邻对词级高亮（变更词红/绿、锚词裸）', () => {
    const lines = renderToolCardStyledLines(
      card({ name: 'edit', brief: '(patch)', diff: true, body: patch.split('\n'), expanded: true }),
      80,
    );
    // 行 3/4 = 词级对：'-const old = 2;' 与 '+const new = 3;'
    const delLine = lines.find((l) => l.plain === '-const old = 2;')!;
    const addLine = lines.find((l) => l.plain === '+const new = 3;')!;
    // 词级对：'-const old = 2;' 与 '+const new = 3;'——'old'/'new' 与尾值
    // '2;'/'3;' 各成变字段（token 边界：非空串连吃），锚段裸
    expect(delLine.runs).toEqual([
      { start: 7, end: 10, style: { fg: DEFAULT_THEME.diffRemoved } }, // 'old'
      { start: 13, end: 15, style: { fg: DEFAULT_THEME.diffRemoved } }, // '2;'
    ]);
    expect(addLine.runs).toEqual([
      { start: 7, end: 10, style: { fg: DEFAULT_THEME.diffAdded } }, // 'new'
      { start: 13, end: 15, style: { fg: DEFAULT_THEME.diffAdded } }, // '3;'
    ]);
  });

  it('孤立删整行红、meta 头行 dim、ctx 裸行', () => {
    const lines = renderToolCardStyledLines(
      card({ name: 'edit', diff: true, body: patch.split('\n'), expanded: true }),
      80,
    );
    const loneDel = lines.find((l) => l.plain === '-孤行删除')!;
    expect(loneDel.runs).toEqual([{ start: 0, end: 5, style: { fg: DEFAULT_THEME.diffRemoved } }]);
    const meta = lines.find((l) => l.plain.includes('Begin Patch'))!;
    expect(meta.runs.every((r) => r.style.dim === true)).toBe(true);
    const ctx = lines.find((l) => l.plain === ' const same = 1;')!;
    expect(ctx.runs).toEqual([]);
  });

  it('超宽行截断 + 游程钳制（变字段越界部分丢弃）', () => {
    const longPatch = ['-' + 'a'.repeat(20) + '尾旧', '+' + 'a'.repeat(20) + '尾新'];
    const lines = renderToolCardStyledLines(card({ name: 'edit', diff: true, body: longPatch, expanded: true }), 12);
    expect(lines[1]!.plain).toBe('-' + 'a'.repeat(11)); // 12 列宽帽（前缀 1 + 11）
    for (const run of lines[1]!.runs) expect(run.end).toBeLessThanOrEqual(lines[1]!.plain.length);
  });
});
