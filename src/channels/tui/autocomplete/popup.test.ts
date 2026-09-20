/**
 * 补全弹层件单测（2026-09-20 TUI 视觉品质战役·组 2）：
 * - escape 关层通知（onDismiss 回调）：popup 消费 escape 关本轮时恰回调一次
 *   ——backend 接线 autocompleteCompleter.cancel()（撤 20ms 防抖窗 + 在途
 *   作废），堵「关层后窗内迟到 fire 重开弹层」的建议框闪回（修前红在
 *   tui-backend.test.ts 纵切锁——本件锁件内回调契约面）；
 * - 行预算排版（market-picker renderRow 预算律同款）：label 帽 + detail
 *   预算——极长 detail 按原宽右对齐起列为负、余段从行首覆写 label 的修前
 *   坏形锁（detail 当前无生产产源属休眠面，与 label 无帽同形一并修）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { EditorModel } from '../editor/editor-model.js';
import { AutocompletePopup } from './popup.js';

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

/** 读回一行（未写格按空格、宽字素续格空串——trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

describe('AutocompletePopup escape 关层通知（组 2）', () => {
  it('escape 消费关本轮 → onDismiss 恰回调一次；不可见时 escape 穿透不回调', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    let dismissed = 0;
    popup.onDismiss = () => {
      dismissed += 1;
    };
    popup.applyResult({ items: [{ label: '/help', replacement: '/help' }], replaceStart: 0, replaceEnd: 2 });
    expect(popup.handleEvent(key('escape'))).toBe(true); // 消费关本轮
    expect(popup.visible).toBe(false);
    expect(dismissed).toBe(1); // 修前红：escape 路无任何关层通知——backend 撤窗无从接线
    // 不可见期 escape 穿透（不消费也不通知——无「本轮」可关）
    expect(popup.handleEvent(key('escape'))).toBe(false);
    expect(dismissed).toBe(1);
  });

  it('enter 应用代换关层不走通知（应用即隐属新轮编舞——dismiss 专指用户撤销本轮）', () => {
    const model = new EditorModel();
    model.setText('/h'); // 光标落尾——token 区间 [0,2) 与 result 对拍新鲜
    const popup = new AutocompletePopup(model);
    let dismissed = 0;
    popup.onDismiss = () => {
      dismissed += 1;
    };
    popup.applyResult({ items: [{ label: '/help', replacement: '/help' }], replaceStart: 0, replaceEnd: 2 });
    expect(popup.handleEvent(key('enter'))).toBe(true); // 应用代换即隐
    expect(popup.visible).toBe(false);
    expect(model.getText()).toBe('/help');
    expect(dismissed).toBe(0); // 应用路不回调（代换触发 onChange 自然重开新查）
  });
});

describe('AutocompletePopup 行预算排版（组 2 修前红）', () => {
  it('极长 label + 极长 detail：双段各自 … 收口不交叠（修前 detail 负起列从行首覆写整行红）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'x'.repeat(70), replacement: 'x', detail: 'd'.repeat(60) }],
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(30, 1);
    popup.render(grid, { row: 0, col: 0, width: 30, height: 1 });
    // item 0 恒高亮 → 前缀 '❯ '（❯ 宽 1——与 '  ' 同占 2 列，列算不变）；
    // leftReserve = min(72, 15) = 15 → rightBudget = 30-1-15 = 14 → detail = 'd'×13 + '…'
    // maxLeft = 30 - 14 - 1 = 15 → label 段 = '❯ ' + 'x'×12 + '…'（15 列）+ 间隔 1 + detail 14 列
    expect(readRow(grid, 0, 30)).toBe(`❯ ${'x'.repeat(12)}… ${'d'.repeat(13)}…`);
  });

  it('无 detail：label 独占全宽 … 截断（修前裸裁到缓冲界红）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'y'.repeat(40), replacement: 'y' }],
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 1);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 1 });
    expect(readRow(grid, 0, 20)).toBe(`❯ ${'y'.repeat(17)}…`);
  });

  it('极窄窗（宽 2）预算 0 丢右段：detail 不放行原宽（单源收紧位——私拷贝放行原宽右对齐起列为负、尾段从行首覆写行内容红）', () => {
    // 宽 2：left = '❯ cmd'（5 列）→ leftReserve = min(5, 1) = 1 →
    // rightBudget = 2 - 1 - 1 = 0——单源 row-segments 收紧为丢弃右段
    // （预算 0 = 无位可放），行内只剩左段按帽 2 … 收口：'❯…'
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'cmd', replacement: 'cmd', detail: 'info' }],
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(2, 1);
    popup.render(grid, { row: 0, col: 0, width: 2, height: 1 });
    expect(readRow(grid, 0, 2)).toBe('❯…');
  });
});
