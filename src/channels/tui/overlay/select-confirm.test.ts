/**
 * 一次性问答面板两件呈现宽度预算回归锁（2026-09-20 TUI 视觉品质战役·组 2）。
 *
 * 修前坏形（finding C 实测定谳）：区域 = 全终端宽（renderFixed 锚 {col:0,
 * width:columns}），而面板渲染无预算律——
 * - 极长 hint 按原宽右对齐起列为负：首段被 CellGrid 越界吸收、余段从行首
 *   覆写整行（setCell 摘痕整字摘除——无乱码但 label 被销毁）。生产链：fs
 *   写审批 suggestedEntry = canonical 绝对路径折进「总是批准」行 hint——
 *   80 列终端 93 列 hint 时前缀与「总是批准」全灭只剩 dim 路径尾段；
 * - title / message 超宽裸裁到缓冲界（writeText 越界列静默吸收）——被批
 *   对象身份段静默丢失、无 … 省略形。
 *
 * 修后形（market-picker renderRow 预算律同款）：hint 先按
 * rightBudget = width - 1 - leftReserve（leftReserve = min(label 宽, 半窗)）
 * 截成 … 省略形再右对齐；label 以右段实占余宽为帽 … 收口；title/message
 * 超宽 truncateToWidth + …。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, truncateToWidth } from '../../engine/index.js';
import { ConfirmPanel, SelectPanel } from './select-confirm.js';

/** 读回一行（未写格按空格、宽字素续格空串——trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 键事件便捷构造 */
function key(k: string): {
  kind: 'key';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  phase: 'press' | 'release';
} {
  return { kind: 'key', key: k, ctrl: false, alt: false, shift: false, meta: false, phase: 'press' };
}

describe('SelectPanel 呈现宽度预算（组 2 修前红）', () => {
  it('极长 hint 按预算 … 截断右对齐——label 完整不被覆写（修前 hint 从行首覆写整行、label 劈半红）', () => {
    // 生产形：fs 写审批「总是批准」行 hint = `write <canonical 绝对路径>`（本仓
    // 自身路径常态 90+ 列 > 80 列终端宽）
    const longHint = `write ${'/very/long/path'.repeat(6)}`; // 102 列——远超 80 列区域宽
    const panel = new SelectPanel({
      title: '⚙ write：写文件',
      options: [
        { value: 'approve', label: '批准' },
        { value: 'reject', label: '拒绝' },
        { value: 'always', label: '总是批准', hint: longHint },
        { value: 'cancel', label: '取消' },
      ],
    });
    const grid = new CellGrid(80, 5);
    panel.render(grid, { row: 0, col: 0, width: 80, height: 5 });
    const row3 = readRow(grid, 3, 80); // 「总是批准」行
    // label 完整在场（修前：hint 起列 -22，余 80 列从行首覆写——前缀与 label 全灭）
    expect(row3.startsWith('  总是批准')).toBe(true);
    // hint … 省略形收尾且按预算帽：leftReserve = min(10, 40) = 10 → rightBudget = 69
    expect(row3.endsWith('…')).toBe(true);
    const expectedHint = `${truncateToWidth(longHint, 68)}…`; // 69 列截断形
    expect(row3).toBe(`  总是批准 ${expectedHint}`);
  });

  it('label 极长以右段实占余宽为帽 … 收口（修前裸裁到缓冲界红）', () => {
    const panel = new SelectPanel({ options: [{ value: 'x', label: 'a'.repeat(70), hint: 'h' }] });
    const grid = new CellGrid(30, 1);
    panel.render(grid, { row: 0, col: 0, width: 30, height: 1 });
    // item 0 恒高亮 → 前缀 '❯ '（❯ 宽 1——与 '  ' 同占 2 列，列算不变）；
    // leftReserve = min(72, 15) = 15 → rightBudget = 30-1-15 = 14（hint 'h' 适装）
    // maxLeft = 30 - 1 - 1 = 28 → label 段 = '❯ ' + 'a'×25 + '…'（28 列）+ 间隔 1 + 'h'
    expect(readRow(grid, 0, 30)).toBe(`❯ ${'a'.repeat(25)}… h`);
  });

  it('title 超宽 … 截断（修前裸裁到缓冲界——写目标身份段静默丢失红）', () => {
    const title = `⚙ write：${'很长的写目标说明'.repeat(8)}`; // 9 + 128 = 137 列——远超 40 列
    const panel = new SelectPanel({ title, options: [{ value: 'a', label: '甲' }] });
    const grid = new CellGrid(40, 2);
    panel.render(grid, { row: 0, col: 0, width: 40, height: 2 });
    expect(readRow(grid, 0, 40)).toBe(`${truncateToWidth(title, 39)}…`);
  });

  it('短内容适装零扰动（预算律不改变既有适装形——回归面）', () => {
    const panel = new SelectPanel({
      title: '标题',
      options: [
        { value: 'a', label: '选项甲', hint: 'hint-a' },
        { value: 'b', label: '选项乙' },
      ],
    });
    const grid = new CellGrid(24, 4);
    panel.render(grid, { row: 0, col: 0, width: 24, height: 4 });
    expect(readRow(grid, 0, 24)).toBe('标题');
    expect(readRow(grid, 1, 24)).toBe('❯ 选项甲          hint-a');
    expect(readRow(grid, 2, 24)).toBe('  选项乙');
  });

  it('键面与预算律互不扰动（截断呈现不影响应答值）', () => {
    const panel = new SelectPanel({ options: [{ value: 'ok', label: '甲', hint: 'h'.repeat(200) }] });
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('enter'));
    expect(got).toEqual(['ok']);
  });
});

describe('ConfirmPanel 呈现宽度预算（组 2 修前红）', () => {
  it('message 与键提示行超宽 … 截断（修前裸裁到缓冲界红）', () => {
    const message = `删除 ${'记忆条目说明'.repeat(8)}？`; // 远超 30 列
    const panel = new ConfirmPanel({ message, confirmHint: 'y'.repeat(40), cancelHint: 'esc 取消' });
    const grid = new CellGrid(30, 2);
    panel.render(grid, { row: 0, col: 0, width: 30, height: 2 });
    expect(readRow(grid, 0, 30)).toBe(`${truncateToWidth(message, 29)}…`);
    // 键提示行合串 'y'×40 + ' · ' + 'esc 取消'（51 列）→ 'y'×29 + '…'
    expect(readRow(grid, 1, 30)).toBe(`${'y'.repeat(29)}…`);
  });

  it('短内容适装零扰动（回归面）', () => {
    const panel = new ConfirmPanel({ message: '删除这条记忆？' });
    const grid = new CellGrid(30, 2);
    panel.render(grid, { row: 0, col: 0, width: 30, height: 2 });
    expect(readRow(grid, 0, 30)).toBe('删除这条记忆？');
    expect(readRow(grid, 1, 30)).toBe('enter 确认 · esc 取消');
  });
});
