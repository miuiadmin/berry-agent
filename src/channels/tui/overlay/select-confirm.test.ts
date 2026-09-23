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
import { ConfirmPanel, SELECT_CANCELLED, SelectPanel } from './select-confirm.js';

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

  it('极窄窗（宽 2）预算 0 丢右段：hint 不放行原宽（单源收紧位——私拷贝放行原宽右对齐起列为负、尾段从行首覆写行内容红）', () => {
    // 宽 2：left = '❯ approve'（9 列）→ leftReserve = min(9, 1) = 1 →
    // rightBudget = 2 - 1 - 1 = 0——单源 row-segments 收紧为丢弃右段
    // （预算 0 = 无位可放），行内只剩左段按帽 2 … 收口：'❯…'
    const panel = new SelectPanel({ options: [{ value: 'a', label: 'approve', hint: 'hint-x' }] });
    const grid = new CellGrid(2, 1);
    panel.render(grid, { row: 0, col: 0, width: 2, height: 1 });
    expect(readRow(grid, 0, 2)).toBe('❯…');
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
    // B2 缺省翻档：y/n 双轨真可达（36aa326）后缺省提示明示双键——与
    // memory-viewer 确认态措辞对齐（原断言 'enter 确认 · esc 取消' 随真态翻档）
    expect(readRow(grid, 1, 30)).toBe('enter/y 确认 · esc/n 取消');
  });
});

/* ================= ConfirmPanel y/n text 轨（死键修复回归锁） ================= */

describe('ConfirmPanel text 轨 y/n（裸字母双轨应答）', () => {
  /** text 事件便捷构造 */
  function text(t: string): { kind: 'text'; text: string } {
    return { kind: 'text', text: t };
  }

  it('text 轨 y 确认 true（修前 asKey 对 text 事件返回 null 即吞——裸字母死键）', () => {
    const panel = new ConfirmPanel({ message: '确认？' });
    const got: boolean[] = [];
    panel.onFinish = (v) => got.push(v);
    expect(panel.handleEvent(text('y'))).toBe(true); // 面板占焦恒 true
    expect(got).toEqual([true]); // 修前：吞事件零应答（got = []）红
  });

  it('text 轨 n 取消 false', () => {
    const panel = new ConfirmPanel({ message: '确认？' });
    const got: boolean[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(text('n'));
    expect(got).toEqual([false]);
  });

  it('其它字母 text 吞不误触；完成态后续 text 静默（单次语义）', () => {
    const panel = new ConfirmPanel({ message: '确认？' });
    const got: boolean[] = [];
    panel.onFinish = (v) => got.push(v);
    expect(panel.handleEvent(text('q'))).toBe(true);
    expect(got).toEqual([]); // 未消费 text 层内终局（模态独占）
    panel.handleEvent(text('y'));
    panel.handleEvent(text('n')); // 完成态静默——不改值
    expect(got).toEqual([true]);
  });

  it('key 轨零扰动（Enter/y/escape 键事件仍应答——双轨同判）', () => {
    const cases: Array<[string, boolean]> = [
      ['enter', true],
      ['y', true],
      ['escape', false],
    ];
    for (const [k, expected] of cases) {
      const panel = new ConfirmPanel({ message: 'm' });
      const got: boolean[] = [];
      panel.onFinish = (v) => got.push(v);
      panel.handleEvent(key(k));
      expect(got).toEqual([expected]);
    }
  });
});

/* ================= TUI 第四役 fx2-B（SelectPanel 视口帽——滚动窗 + 指示行） ================= */

describe('SelectPanel 视口帽窗口化（fx2-B）', () => {
  const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `opt-${i}` }));

  it('无帽注入恒满高（回归面——未接 renderFixed 的直用形零扰动）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(4) });
    expect(panel.measure(80)).toBe(5); // 标题 1 + 4 选项
  });

  it('帽内适装零窗口化（恒满高原样——指示行不出场）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(4) });
    panel.setMaxHeight(6); // 5 ≤ 6 适装
    expect(panel.measure(80)).toBe(5);
    const grid = new CellGrid(20, 5);
    panel.render(grid, { row: 0, col: 0, width: 20, height: 5 });
    expect(readRow(grid, 1, 20)).toBe('❯ opt-0');
    expect(readRow(grid, 4, 20)).toBe('  opt-3'); // 全集在场
  });

  it('超帽窗口化：窗行 + 底部指示行（首帧光标贴顶——顶部无指示）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(7); // full 11 > 7 → 窗行 = 7-1-2 = 4
    expect(panel.measure(80)).toBe(6); // 标题 1 + 窗 4 + 底指示 1（顶 0 隐藏无行）
    const grid = new CellGrid(20, 6);
    panel.render(grid, { row: 0, col: 0, width: 20, height: 6 });
    expect(readRow(grid, 0, 20)).toBe('T');
    expect(readRow(grid, 1, 20)).toBe('❯ opt-0'); // 光标项窗首（居中钳 0）
    expect(readRow(grid, 4, 20)).toBe('  opt-3'); // 窗尾
    expect(readRow(grid, 5, 20)).toBe('↓ 6 more'); // 窗外 6 项隐藏
  });

  it('光标居中跟随：移到中部——两侧指示行齐显（窗 = 光标 - 半窗）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(7);
    for (let k = 0; k < 5; k++) panel.handleEvent(key('down')); // activeIndex 5
    expect(panel.measure(80)).toBe(7); // 标题 + 双指示 + 窗 4
    const grid = new CellGrid(20, 7);
    panel.render(grid, { row: 0, col: 0, width: 20, height: 7 });
    expect(readRow(grid, 1, 20)).toBe('↑ 3 more'); // start = 5-2 = 3
    expect(readRow(grid, 4, 20)).toBe('❯ opt-5'); // 居中可视
    expect(readRow(grid, 6, 20)).toBe('↓ 3 more');
  });

  it('末项沉底：底部指示消失、顶部指示在场（activeIndex 仍在全集——wrap 后值不漂）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(7);
    for (let k = 0; k < 9; k++) panel.handleEvent(key('down')); // activeIndex 9（末项）
    expect(panel.measure(80)).toBe(6); // 标题 + 顶指示 + 窗 4（底 0 隐藏）
    const grid = new CellGrid(20, 6);
    panel.render(grid, { row: 0, col: 0, width: 20, height: 6 });
    expect(readRow(grid, 1, 20)).toBe('↑ 6 more'); // start = 6（沉底钳）
    expect(readRow(grid, 5, 20)).toBe('❯ opt-9'); // 末项窗尾可视
  });

  it('退化小帽防御：measure 恒 ≤ 帽、render 区域界内不越写（不抛不丢格）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(2); // 窗行下限 1 兜底——量高钳帽
    expect(panel.measure(80)).toBeLessThanOrEqual(2);
    const grid = new CellGrid(20, 2);
    panel.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    expect(readRow(grid, 0, 20)).toBe('T'); // 标题优先在场
    expect(readRow(grid, 1, 20)).toBe('❯ opt-0'); // 光标行保底可视
  });

  it('窗口化不改选值语义（enter 应答高亮项全集值——呈现取景非数据截断）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(7);
    for (let k = 0; k < 9; k++) panel.handleEvent(key('down')); // 末项（窗外曾不可见域）
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('enter'));
    expect(got).toEqual(['v9']); // 全集应答（窗口只是呈现取景）
  });
});

/* ================= SelectPanel 翻页键族（B1——pagedown/pageup/home/end） ================= */

describe('SelectPanel 翻页键族（B1——pagedown/pageup/home/end）', () => {
  const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `opt-${i}` }));

  it('home/end 直达首末项（修前死键红——handleEvent 键面仅 ↑/↓/enter/escape，view() 开窗设计长清单四键缺席）', () => {
    const panel = new SelectPanel({ options: opts(10) });
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('end')); // 末项直达
    panel.handleEvent(key('enter'));
    expect(got).toEqual(['v9']); // 修前：end 不动作——仍在 v0 红
    const panel2 = new SelectPanel({ options: opts(10) });
    const got2: string[] = [];
    panel2.onFinish = (v) => got2.push(v);
    panel2.handleEvent(key('down'));
    panel2.handleEvent(key('home')); // 离首后回首直达
    panel2.handleEvent(key('enter'));
    expect(got2).toEqual(['v0']); // 修前：home 不动作——仍在 v1 红
  });

  it('pagedown/pageup 按窗口化页幅移动（页幅 = 取景窗行数——view() 单源）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(7); // 窗行 = 7 - 1（标题）- 2（指示行）= 4
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('pagedown')); // 0 → 4（恰一窗）
    panel.handleEvent(key('enter'));
    expect(got).toEqual(['v4']); // 修前：pagedown 不动作——仍在 v0 红
    const panel2 = new SelectPanel({ title: 'T', options: opts(10) });
    panel2.setMaxHeight(7);
    const got2: string[] = [];
    panel2.onFinish = (v) => got2.push(v);
    panel2.handleEvent(key('end'));
    panel2.handleEvent(key('pageup')); // 9 → 5（回退一窗）
    panel2.handleEvent(key('enter'));
    expect(got2).toEqual(['v5']); // 修前：pageup 不动作——仍在 v9 红
  });

  it('未窗口化页幅 = 全集行数（视口行数量级——无帽直用形一页即全集）', () => {
    const panel = new SelectPanel({ options: opts(6) }); // 无帽注入恒满高——count = 6
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('down')); // 1
    panel.handleEvent(key('pagedown')); // 1 + 6 = 7 → 钳末 5
    panel.handleEvent(key('enter'));
    expect(got).toEqual(['v5']);
  });

  it('翻页越界钳首末不循环（与 ↑/↓ 单步循环节律分立——翻页是直达键语义）', () => {
    const panel = new SelectPanel({ options: opts(10) });
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    panel.handleEvent(key('end'));
    panel.handleEvent(key('pagedown')); // 已在末——停
    panel.handleEvent(key('enter'));
    expect(got).toEqual(['v9']);
    const panel2 = new SelectPanel({ options: opts(10) });
    const got2: string[] = [];
    panel2.onFinish = (v) => got2.push(v);
    panel2.handleEvent(key('pageup')); // 已在首——停（不循环到末）
    panel2.handleEvent(key('enter'));
    expect(got2).toEqual(['v0']);
  });

  it('翻页后 view() 居中取景自动跟随（end 沉底钳——末项窗尾可视、顶指示在场，渲染零改）', () => {
    const panel = new SelectPanel({ title: 'T', options: opts(10) });
    panel.setMaxHeight(7);
    panel.handleEvent(key('end')); // 直达末项——取景随动
    expect(panel.measure(80)).toBe(6); // 标题 + 顶指示 + 窗 4（底 0 隐藏——fx2-B 末项沉底同形）
    const grid = new CellGrid(20, 6);
    panel.render(grid, { row: 0, col: 0, width: 20, height: 6 });
    expect(readRow(grid, 1, 20)).toBe('↑ 6 more'); // 顶指示（窗外 6 项）
    expect(readRow(grid, 5, 20)).toBe('❯ opt-9'); // 末项窗尾可视（居中钳沉底）
  });

  it('空集防御：四键零选项不炸、enter 应答保守值（end = max(0, -1) = 0 钳位）', () => {
    const panel = new SelectPanel({ options: [] });
    const got: string[] = [];
    panel.onFinish = (v) => got.push(v);
    expect(() => {
      panel.handleEvent(key('home'));
      panel.handleEvent(key('end'));
      panel.handleEvent(key('pagedown'));
      panel.handleEvent(key('pageup'));
    }).not.toThrow(); // 空集零选项——四键全钳位 0 无越界
    panel.handleEvent(key('enter'));
    expect(got).toEqual([SELECT_CANCELLED]); // options[0] 缺席 ?? 保守值（既有空集应答形）
  });
});
