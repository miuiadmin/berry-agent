/**
 * 极窄宽（1-8 列）塌缩系统性锁——研究档条件 D6（纯呈现面专项）。
 *
 * 本件补「1-8 列全参数化扫」的
 * 结构性不变式：每个被扫宽度下**不炸 + 不越界 + 宽度约束被尊重**（或按
 * 契约取例外形）。覆盖五族：
 * - CellGrid 守卫（越界写静默吸收 + 全格不变式——续格无孤儿、末列双宽
 *   续格截断）；
 * - 整字原语窄宽（truncateToWidth 截断恒整字前缀 + wrapText 折行宽帽
 *   ——2026-09-23 组合子注销批迁此：原 Text / Paragraph 组件载体注销，
 *   断言语义〔整字律 + 每行宽帽〕在纯 width 件上保全）；
 * - 面板窄宽塌缩（SelectPanel / ConfirmPanel——2026-09-23 组合子注销批
 *   迁此：原 Row/Column/Flex/Inset 布局组合子注销，窄宽塌缩不炸 + 全格
 *   不变式语义在真实浮层面板载体上保全）；
 * - blocks（工具卡普通档 + diff 档、思考块两档——含 markdown 全管线）；
 * - 状态行（legacy 忙态 / split footer 忙闲两态）与编辑器（1-2 列防御
 *   早退 + 3-5 列单列内容区）。
 *
 * 宽度约束的例外契约（整字律——07 引擎节件 2）：折行产出行宽 ≤ cols，
 * 唯一例外 = 行恰一个字素且其宽 > cols（1 列遇双宽字素不产半字、整字
 * 独占一行）——expectWidthCapped 单源执法。卡头/标签行（Text 单行截断
 * 承诺只覆盖 Text 件自身；工具卡卡头与思考标签是数据面 StyledLine、无
 * 截断承诺，超宽由消费面 CellGrid 落格吸收 / 终端软换行承载）只锁游程
 * 几何界内，不锁行宽帽。
 */
import { describe, expect, it } from 'vitest';
import {
  CellGrid,
  splitGraphemes,
  stringWidth,
  truncateToWidth,
  wrapText,
  type CellGrid as Grid,
} from '../engine/index.js';
import { ConfirmPanel, SelectPanel } from './overlay/select-confirm.js';
import { DEFAULT_THEME } from './theme/index.js';
import { renderToolCardStyledLines, type ToolCardView } from './blocks/tool-card.js';
import { renderThinkingStyledLines, type ThinkingView } from './blocks/thinking.js';
import type { StyledLine } from './backend/ansi-rows.js';
import { StatusLine } from './status/status-line.js';
import { EditorModel } from './editor/editor-model.js';
import { EditorView } from './editor/editor-view.js';

/** 极窄宽扫描域（研究档「1-8 列塌缩场景」全扫） */
const NARROW = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** 读回一行（未写格按空格、续格 grapheme 空串不进串——读回宽即视觉行宽） */
function readRow(grid: Grid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/**
 * 全格不变式扫描（任意 render 后的通用锁）：
 * - 首格宽 ∈ {1,2} 且字素非空；续格（宽 0）必紧跟同字素双宽首格（无孤儿）；
 * - 非末列双宽首格必带续格（摘痕算法承诺——覆写先整字摘除，无残缺形）；
 * - 每视觉行宽（首格字素宽和）≤ 网格列数 + 1（唯一溢出形 = 末列双宽首格
 *   「首格在位、续格截断」——cell 件明文设计，越界计宽至多 1）。
 */
function expectGridInvariants(grid: Grid): void {
  for (let r = 0; r < grid.rows; r++) {
    let rowWidth = 0;
    for (let c = 0; c < grid.columns; c++) {
      const cell = grid.getCell(r, c);
      if (!cell) continue;
      if (cell.width === 0) {
        // 续格：前格必为其双宽首格（摘痕算法的结构承诺——孤儿续格即缺陷）
        const head = grid.getCell(r, c - 1);
        expect(head, `孤儿续格 @(${r},${c})`).not.toBeNull();
        expect(head!.width, `续格前格非双宽首格 @(${r},${c})`).toBe(2);
      } else {
        expect(cell.width, `非法格宽 @(${r},${c})`).toBeLessThanOrEqual(2);
        expect(cell.grapheme, `首格字素为空 @(${r},${c})`).not.toBe('');
        rowWidth += cell.width;
        if (cell.width === 2 && c + 1 < grid.columns) {
          // 非末列双宽首格：续格必在场（末列例外 = 续格截断设计形）
          expect(grid.getCell(r, c + 1)?.width, `双宽首格续格缺席 @(${r},${c})`).toBe(0);
        }
      }
    }
    expect(rowWidth, `视觉行宽超网格+1 @row${r}`).toBeLessThanOrEqual(grid.columns + 1);
  }
}

/** 折行产出宽帽断言（整字律例外单源：单字素自身超帽时整字独行） */
function expectWidthCapped(text: string, cols: number): void {
  const w = stringWidth(text);
  if (w > cols) {
    // 例外形：行恰一个字素且宽 ≤ 2（1 列遇双宽字素——不产半字）
    const graphemes = splitGraphemes(text);
    expect(graphemes, `行超帽且非单字素："${text}"（${w} > ${cols}）`).toHaveLength(1);
    expect(w).toBeLessThanOrEqual(2);
  }
}

/** StyledLine 游程几何界内：端点 ∈ [0, plain.length]（UTF-16 码元面）且升序不交叠 */
function expectRunsInBounds(line: StyledLine): void {
  let prevEnd = 0;
  for (const run of line.runs) {
    expect(run.start, `游程起点负位 "${line.plain}"`).toBeGreaterThanOrEqual(0);
    expect(run.start, `游程起点回跳 "${line.plain}"`).toBeGreaterThanOrEqual(prevEnd);
    expect(run.end, `游程端点越 plain 界 "${line.plain}"`).toBeLessThanOrEqual(line.plain.length);
    expect(run.end).toBeGreaterThanOrEqual(run.start);
    prevEnd = run.end;
  }
}

describe('CellGrid 极窄宽守卫（1-8 列）', () => {
  it.each(NARROW)('%i 列：混合宽文本写入不炸 + 全格不变式（末列双宽续格截断）', (cols) => {
    const grid = new CellGrid(cols, 3);
    expect(() => {
      grid.writeText(0, 0, 'a中😀b文xy'); // ASCII + CJK 双宽 + emoji 三类字素混排
      grid.writeText(1, 0, '中文'); // 纯双宽串（末字续格可能越界截断）
      grid.writeText(2, cols - 1, '中'); // 末列起写双宽——续格截断形
    }).not.toThrow();
    expectGridInvariants(grid);
    // 末列双宽首格在位（整字首格不丢）、界外读恒 null（续格被截断不越界）
    expect(grid.getCell(2, cols - 1)?.width).toBe(2);
    expect(grid.getCell(2, cols)).toBeNull();
  });

  it.each(NARROW)('%i 列：越界写静默吸收（行/列界外 + 负参），界外读恒 null', (cols) => {
    const grid = new CellGrid(cols, 2);
    expect(() => {
      grid.writeText(0, cols, 'abc'); // 列界外
      grid.writeText(2, 0, 'abc'); // 行界外
      grid.writeText(-1, 0, 'abc'); // 负行
      grid.writeText(0, -1, 'abc'); // 负列
      grid.setCell(0, cols, 'x');
      grid.setCell(-1, 0, 'x');
    }).not.toThrow();
    expect(grid.getCell(0, cols)).toBeNull();
    expect(grid.getCell(-1, 0)).toBeNull();
    expect(grid.getCell(2, 0)).toBeNull();
  });

  it.each(NARROW)('%i 列：resize 不炸且弃旧清场（唯一重分配点）', (cols) => {
    const grid = new CellGrid(10, 2);
    grid.writeText(0, 0, '中文abc');
    expect(() => grid.resize(cols, 2)).not.toThrow();
    expect(grid.columns).toBe(cols);
    expect(grid.getCell(0, 0)).toBeNull(); // resize 不搬运——清屏重绘归引擎编排
  });
});

describe('整字原语窄宽塌缩（1-8 列）——原 Text/Paragraph 载体注销，语义迁纯 width 件', () => {
  it.each(NARROW)('truncateToWidth：%i 帽——截断产出恒整字前缀 + 显示宽 ≤ 帽', (w) => {
    // 原 Text 件语义（单行截断不产半字）：截断产出是内容前缀（truncateToWidth
    // 整字丢弃）；1 列遇 'a'（首字素单宽恰容）等边界形由前缀 + 宽帽两断言合锁
    const out = truncateToWidth('ab中文xy', w);
    expect('ab中文xy'.startsWith(out)).toBe(true);
    expect(stringWidth(out)).toBeLessThanOrEqual(w);
  });

  it.each(NARROW)('wrapText：%i 列折行——每行宽帽（整字例外单源执法）+ 显式段至少各一行', (w) => {
    // 原 Paragraph 件语义（折行 = wrapText 单源 + 每行宽帽）：两显式段折后
    // 至少各占一行；每行经 expectWidthCapped 执法（唯一例外 = 单字素整字独行）
    const content = 'abc 中文 def\n第二段';
    const lines = wrapText(content, w);
    expect(lines.length).toBeGreaterThanOrEqual(2); // 两显式段——至少各一行
    for (const line of lines) expectWidthCapped(line, w);
  });
});

describe('面板窄宽塌缩（1-8 列）——原布局组合子载体注销，语义迁真实浮层面板', () => {
  it.each(NARROW)('SelectPanel：%i 列——量高 ≥ 1、render 不炸 + 全格不变式', (w) => {
    // 原 Row/Column/Flex/Inset 塌缩不炸语义迁此：真实浮层面板（标题 + 选项行
    // + 指示行结构）在极窄宽下渲染不炸、落格不越界
    const panel = new SelectPanel({
      title: '选择',
      options: [
        { value: 'a', label: 'AAAA', hint: '说明段' },
        { value: 'b', label: '中选项', hint: '右段说明' },
      ],
      theme: DEFAULT_THEME,
    });
    expect(panel.measure(w)).toBeGreaterThanOrEqual(1); // 量高永不塌到 0
    const grid = new CellGrid(8, 6);
    expect(() => panel.render(grid, { row: 0, col: 0, width: w, height: 6 })).not.toThrow();
    expectGridInvariants(grid);
  });

  it.each(NARROW)('ConfirmPanel：%i 列——恒高 2 行、render 不炸 + 全格不变式', (w) => {
    const panel = new ConfirmPanel({
      message: '确认执行？此操作不可撤销',
      confirmHint: 'enter/y 确认',
      cancelHint: 'esc/n 取消',
    });
    expect(panel.measure(w)).toBe(2); // 消息 1 + 键提示 1（高与宽无关）
    const grid = new CellGrid(8, 2);
    expect(() => panel.render(grid, { row: 0, col: 0, width: w, height: 2 })).not.toThrow();
    expectGridInvariants(grid);
  });
});

describe('工具卡窄宽收敛（1-8 列）', () => {
  const card = (over: Partial<ToolCardView>): ToolCardView => ({
    name: 'read',
    brief: '(path)',
    status: 'success',
    body: ['普通行文本', 'ab中文cd', 'x'.repeat(30)],
    diff: false,
    expanded: false,
    theme: DEFAULT_THEME,
    ...over,
  });

  it.each(NARROW)('普通卡：%i 列——卡头恒在场、体行宽帽（wrapText 契约）、游程界内', (w) => {
    const lines = renderToolCardStyledLines(card({}), w);
    expect(lines.length).toBeGreaterThanOrEqual(2); // 卡头 + 至少一体行
    expect(lines[0]!.plain.length).toBeGreaterThan(0); // 卡头恒在场（数据面不截断）
    for (const line of lines) expectRunsInBounds(line);
    for (const line of lines.slice(1)) expectWidthCapped(line.plain, w); // 体行走 wrapText——宽帽承诺
  });

  it.each(NARROW)('diff 卡（展开档）：%i 列——全路截断保宽帽 + 游程钳制界内', (w) => {
    const patch = ['*** Begin Patch', ' const same = 1;', '-const old = 2;', '+const new = 3;', '-孤行删除'].join('\n');
    const lines = renderToolCardStyledLines(
      card({ name: 'edit', brief: '(patch)', diff: true, body: patch.split('\n'), expanded: true }),
      w,
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expectRunsInBounds(line);
    // diff 行走 truncateToWidth（词级对行 + 孤立行同律）——截断帽无单字素例外
    //（'-' 前缀单宽先行占位，双宽字素在 1 列放不下即整字丢弃）
    for (const line of lines.slice(1)) expect(stringWidth(line.plain)).toBeLessThanOrEqual(w);
  });
});

describe('思考块窄宽收敛（1-8 列）', () => {
  const view = (expanded: boolean): ThinkingView => ({
    text: '# 标\n\n正文内容',
    expanded,
    theme: DEFAULT_THEME,
    toggleHint: 'ctrl+t',
  });

  it.each(NARROW)('%i 列两档：折叠单行 / 展开含 markdown 全管线——不炸 + 体行限宽 + 游程界内', (w) => {
    // 折叠档：单标签行（数据面不截断——只锁结构）
    const collapsed = renderThinkingStyledLines(view(false), w);
    expect(collapsed).toHaveLength(1);
    expectRunsInBounds(collapsed[0]!);
    // 展开档：内部 CellGrid(columns, measure) 全管线渲染 markdown（标题/空行/正文）
    const expanded = renderThinkingStyledLines(view(true), w);
    expect(expanded.length).toBeGreaterThanOrEqual(2); // 标签 + 体
    expectRunsInBounds(expanded[0]!);
    for (const line of expanded) expectRunsInBounds(line);
    // 体行经 CellGrid 落格提取（gridRowToStyled）——物理限宽 ≤ columns，
    // 唯一例外 = 整字独行（1 列遇双宽字素不产半字——layoutParts 整字律
    // 例外契约，2026-09-21 批二起 markdown 引擎同律）；经 expectWidthCapped
    // 单源执法（修前 layoutParts 丢弃超宽字素、行恒 ≤ w——翻档随真态）
    for (const line of expanded.slice(1)) expectWidthCapped(line.plain.trimEnd(), w);
  });
});

describe('状态行窄宽（1-8 列）', () => {
  it.each(NARROW)('%i 列三态（legacy 忙 / split 忙 / split 闲）：不炸 + 视觉宽 ≤ 帽 + 全格不变式', (w) => {
    // legacy 忙态：转轮 + 工具段（rest 宽可超帽——writeText 越界吸收）
    const legacy = new StatusLine();
    legacy.start('活动中');
    legacy.setTool('read_file');
    const g1 = new CellGrid(w, 1);
    expect(() => legacy.render(g1, { row: 0, col: 0, width: w, height: 1 })).not.toThrow();
    expect(stringWidth(readRow(g1, 0, w))).toBeLessThanOrEqual(w);
    expectGridInvariants(g1);

    // split 忙态（footer 在场）：spinnerCol 可算出负值——越界写静默吸收
    const split = new StatusLine();
    split.setFooter('cwd·model·s');
    split.start('活动中');
    split.setTool('read_file');
    const g2 = new CellGrid(w, 1);
    expect(() => split.render(g2, { row: 0, col: 0, width: w, height: 1 })).not.toThrow();
    expect(stringWidth(readRow(g2, 0, w))).toBeLessThanOrEqual(w);
    expectGridInvariants(g2);

    // split 闲态：footer 整字截断 + 右对齐闲态文案（起点可为负——部分落格）
    const idle = new StatusLine();
    idle.setFooter('cwd·model·s');
    idle.setStatus('完成：5 项');
    const g3 = new CellGrid(w, 1);
    expect(() => idle.render(g3, { row: 0, col: 0, width: w, height: 1 })).not.toThrow();
    expect(stringWidth(readRow(g3, 0, w))).toBeLessThanOrEqual(w);
    expectGridInvariants(g3);
  });
});

describe('编辑器极窄宽（边框塌缩 + 单列内容区）', () => {
  it.each([1, 2])('%i 列：innerW=0 防御早退——零写出不炸、无光标声明', (w) => {
    const model = new EditorModel();
    model.setText('ab中文');
    const view = new EditorView(model, { maxVisibleLines: 4 });
    expect(view.measure(w)).toBeGreaterThanOrEqual(3); // 边框 2 + 至少 1 行
    const grid = new CellGrid(8, 10);
    expect(() => view.render(grid, { row: 0, col: 0, width: w, height: 10 })).not.toThrow();
    for (let r = 0; r < grid.rows; r++) expect(readRow(grid, r, 8)).toBe(''); // 边框都不画
    expect(grid.cursor).toBeNull();
  });

  it.each([3, 4, 5])('%i 列：边框在场 + 正文/边框全落网格界内 + 聚焦光标声明在网格界内', (w) => {
    const model = new EditorModel();
    model.setText('ab中文');
    const view = new EditorView(model, { maxVisibleLines: 8 });
    expect(view.measure(w)).toBeGreaterThanOrEqual(3);
    const grid = new CellGrid(8, 12);
    view.setFocused(true);
    expect(() => view.render(grid, { row: 0, col: 0, width: w, height: 12 })).not.toThrow();
    expect(readRow(grid, 0, w)).toContain('┌'); // 顶边框左角在场
    expectGridInvariants(grid);
    // 光标声明不越网格（preedit 探出 region 形由终端 clamp 承载——不炸为锁）
    const cursor = grid.cursor;
    expect(cursor).not.toBeNull();
    expect(cursor!.row).toBeLessThan(grid.rows);
    expect(cursor!.col).toBeLessThan(grid.columns);
    expect(cursor!.row).toBeGreaterThanOrEqual(0);
    expect(cursor!.col).toBeGreaterThanOrEqual(0);
  });

  it('3 列（单列内容区）：ASCII 逐字成行、量高 = 边框 2 + 视觉行数', () => {
    const model = new EditorModel();
    model.setText('ab中文');
    const view = new EditorView(model, { maxVisibleLines: 8 });
    // innerW=1 硬折：a|b|中|文 各成一段（CJK 段宽 2 超帽——首格落位续格吸收）
    expect(view.measure(3)).toBe(2 + 4);
    const grid = new CellGrid(8, 12);
    view.render(grid, { row: 0, col: 0, width: 3, height: 12 });
    expect(readRow(grid, 1, 8)).toBe('│a│'); // ASCII 段恰占单列内容区
    expect(readRow(grid, 2, 8)).toBe('│b│');
    expectGridInvariants(grid);
  });
});
