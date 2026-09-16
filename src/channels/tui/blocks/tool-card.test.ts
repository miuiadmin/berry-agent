/**
 * 工具卡渲染测试（批 10i R4——纯函数直锁）。
 *
 * 覆盖：三态卡头（✓/✖/⏹ 语义色 + 名/简述 dim）、折叠尾 5 行预览（整面
 * dim）/ 展开全量、cardBodyOf 尾留帽与截断标记、edit diff 档（1 删 1 增词级
 * 红绿、孤立行整行红绿、meta dim、超宽截断游程钳制）、插件卡体（renderResult
 * 消费——2026-09-17 TUI 余量收官批③：命中/回落恒在/卡头恒宿主/tone 语义键
 * 着色/折叠预览与卡体帽同律/纯函数纪律）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../theme/index.js';
import { registerToolRenderer } from '../../renderers.js';
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

/* ---------------- 2026-09-17 TUI 余量收官批③：插件卡体（renderResult 消费） ---------------- */

/** 插件渲染腿载荷速构（toolName 单源 = card.name——载荷不含名） */
const renderInputOf = (over: Partial<NonNullable<ToolCardView['renderInput']>> = {}) => ({
  toolCallId: 'tc1',
  arguments: { pattern: 'x' },
  content: [{ type: 'text', text: '命中 3 处' }],
  isError: false,
  aborted: false,
  ...over,
});

describe('插件卡体（renderResult 消费——回落恒在律）', () => {
  // 模块级注册表——逐笔 dispose 防跨用例串扰（afterEach 收口）
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('命中非空行集 → 插件卡体替换宿主缺省卡体；卡头恒宿主形（不可覆写）', () => {
    const received: unknown[] = [];
    disposers.push(
      registerToolRenderer('plug_card', {
        renderResult: (result) => {
          received.push(result);
          return [[{ text: '插件行一' }], [{ text: '插件行二' }]];
        },
      }),
    );
    const withPlugin = renderToolCardStyledLines(
      card({ name: 'plug_card', body: ['宿主体'], expanded: true, renderInput: renderInputOf() }),
      40,
    );
    // 卡头恒宿主形：与无渲染腿渲染的卡头逐字段相等（插件不可覆写断言）
    const hostOnly = renderToolCardStyledLines(card({ name: 'plug_card', body: ['宿主体'], expanded: true }), 40);
    expect(withPlugin[0]).toEqual(hostOnly[0]);
    // 卡体 = 插件行集非宿主缺省体
    expect(withPlugin.slice(1).map((line) => line.plain)).toEqual(['插件行一', '插件行二']);
    expect(hostOnly.slice(1).map((line) => line.plain)).toEqual(['宿主体']);
    // renderResult 收定稿期全量事实（toolName 单源 = 卡名）
    expect(received).toEqual([
      {
        toolCallId: 'tc1',
        toolName: 'plug_card',
        arguments: { pattern: 'x' },
        content: [{ type: 'text', text: '命中 3 处' }],
        isError: false,
        aborted: false,
      },
    ]);
  });

  it('tone 五值语义键直取着色（text/缺省无前景——正文恒随终端）', () => {
    disposers.push(
      registerToolRenderer('plug_tone', {
        renderResult: () => [
          [
            { text: '错', tone: 'error' },
            { text: '成', tone: 'success' },
            { text: '焦', tone: 'accent' },
            { text: '次', tone: 'secondary' },
            { text: '中', tone: 'text' },
            { text: '裸' },
          ],
        ],
      }),
    );
    const lines = renderToolCardStyledLines(
      card({ name: 'plug_tone', body: [], expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(lines[1]!.plain).toBe('错成焦次中裸');
    expect(lines[1]!.runs).toEqual([
      { start: 0, end: 1, style: { fg: DEFAULT_THEME.error } },
      { start: 1, end: 2, style: { fg: DEFAULT_THEME.success } },
      { start: 2, end: 3, style: { fg: DEFAULT_THEME.accent } },
      { start: 3, end: 4, style: { fg: DEFAULT_THEME.secondary } },
      // tone 'text' 与缺省段无前景游程（DEFAULT_THEME.text = undefined——终端缺省前景）
    ]);
  });

  it('回落恒在律三形：抛错 / 空行集 / 未注册——恒宿主缺省卡体', () => {
    const hostBody = ['宿主一', '宿主二'];
    // 同名宿主基线（卡头含名——逐形对照）
    const hostLinesOf = (name: string) => renderToolCardStyledLines(card({ name, body: hostBody, expanded: true }), 40);
    // 形一：抛错
    disposers.push(
      registerToolRenderer('plug_throw', {
        renderResult: () => {
          throw new Error('插件炸了');
        },
      }),
    );
    const thrown = renderToolCardStyledLines(
      card({ name: 'plug_throw', body: hostBody, expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(thrown).toEqual(hostLinesOf('plug_throw')); // 抛错回落（插件渲染器结构性不可劣化呈现面）
    // 形二：空行集
    disposers.push(registerToolRenderer('plug_empty', { renderResult: () => [] }));
    const empty = renderToolCardStyledLines(
      card({ name: 'plug_empty', body: hostBody, expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(empty).toEqual(hostLinesOf('plug_empty'));
    // 形三：未注册（查表未命中）
    const missed = renderToolCardStyledLines(
      card({ name: 'plug_miss', body: hostBody, expanded: true, renderInput: renderInputOf() }),
      40,
    );
    expect(missed).toEqual(hostLinesOf('plug_miss'));
  });

  it('载荷缺席（renderInput 无）→ 钩子不触发走宿主缺省（渲染器在场亦然）', () => {
    let invoked = 0;
    disposers.push(
      registerToolRenderer('plug_no_input', {
        renderResult: () => {
          invoked++;
          return [[{ text: '不该出现' }]];
        },
      }),
    );
    const lines = renderToolCardStyledLines(card({ name: 'plug_no_input', body: ['宿主'], expanded: true }), 40);
    expect(invoked).toBe(0); // 无定稿期事实即无现调
    expect(lines.slice(1).map((line) => line.plain)).toEqual(['宿主']);
  });

  it('折叠预览 N=5 与卡体帽 200 行对插件行集同律（尾留 + 截断标记首行）', () => {
    // 扁平行集（每元素一行 = 段序列——[[段]] 嵌套是行集的行集属坏形）
    const many = Array.from({ length: CARD_BODY_MAX_LINES + 30 }, (_, i) => [{ text: `L${i}` }]);
    disposers.push(registerToolRenderer('plug_cap', { renderResult: () => many }));
    const expanded = renderToolCardStyledLines(
      card({ name: 'plug_cap', body: [], expanded: true, renderInput: renderInputOf() }),
      40,
    );
    // 卡头 + 截断标记 + 尾留 200（cardBodyOf 同语义）
    expect(expanded).toHaveLength(1 + 1 + CARD_BODY_MAX_LINES);
    expect(expanded[1]!.plain).toContain('前文已省 30 行');
    expect(expanded[expanded.length - 1]!.plain).toBe(`L${many.length - 1}`); // 尾行保住
    // 折叠档 = 卡头 + 尾 5 视觉行且整面 dim（同宿主卡体律）
    const collapsed = renderToolCardStyledLines(
      card({ name: 'plug_cap', body: [], expanded: false, renderInput: renderInputOf() }),
      40,
    );
    expect(collapsed).toHaveLength(1 + CARD_PREVIEW_LINES);
    expect(collapsed[collapsed.length - 1]!.plain).toBe(`L${many.length - 1}`);
    expect(collapsed.slice(1).every((line) => line.runs.every((run) => run.style.dim === true))).toBe(true);
  });

  it('纯函数纪律：同输入两次现调同行集（不缓存——每次渲染重新调用）', () => {
    let invoked = 0;
    disposers.push(
      registerToolRenderer('plug_pure', {
        renderResult: () => {
          invoked++;
          return [[{ text: '确定行' }]];
        },
      }),
    );
    const input = card({ name: 'plug_pure', body: [], expanded: true, renderInput: renderInputOf() });
    const first = renderToolCardStyledLines(input, 40);
    const second = renderToolCardStyledLines(input, 40);
    expect(invoked).toBe(2); // 定稿渲染与 repaint 重渲各一次现调——零缓存
    expect(second).toEqual(first); // 同输入同行集
  });

  it('超宽段截断 + 游程钳制（插件行几何同 diff 档——游程几何保简）', () => {
    disposers.push(
      registerToolRenderer('plug_wide', {
        renderResult: () => [[{ text: 'a'.repeat(30), tone: 'error' }, { text: 'b'.repeat(10) }]],
      }),
    );
    const lines = renderToolCardStyledLines(
      card({ name: 'plug_wide', body: [], expanded: true, renderInput: renderInputOf() }),
      12,
    );
    expect(lines[1]!.plain).toBe('a'.repeat(12)); // 12 列帽——越界段丢弃
    for (const run of lines[1]!.runs) expect(run.end).toBeLessThanOrEqual(lines[1]!.plain.length);
    expect(lines[1]!.runs).toEqual([{ start: 0, end: 12, style: { fg: DEFAULT_THEME.error } }]);
  });
});
