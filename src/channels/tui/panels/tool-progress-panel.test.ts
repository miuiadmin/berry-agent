/**
 * 工具实时进度面板单测（07 §4.1 呈现面件 5）：首 update 建行（begin 只建档）/
 * 宽容解码三形（string 直显 / AgentToolResult 倒扫末条非空行 / 缺席退化 …）/
 * end 摘行 / clear 清板 / 帽 4 行 + 溢出行。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { decodeUpdateText, ToolProgressPanel } from './tool-progress-panel.js';

const WIDTH = 60;

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width = WIDTH): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 渲染到面板量高网格 */
function renderPanel(panel: ToolProgressPanel, width = WIDTH): CellGrid {
  const grid = new CellGrid(width, panel.measure(width));
  panel.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

describe('decodeUpdateText 宽容解码', () => {
  it('string 直显（内部换行折叠空格——网格行是单行物理面）', () => {
    expect(decodeUpdateText('扫描中 42%')).toBe('扫描中 42%');
    expect(decodeUpdateText('第一行\n第二行')).toBe('第一行 第二行');
  });

  it('AgentToolResult 形：content 块数组取文本块倒扫末条非空行', () => {
    const result = {
      content: [
        { type: 'text', text: '头部\n\n命中 3 处\n\n' },
        { type: 'image', data: 'x' },
      ],
    };
    expect(decodeUpdateText(result)).toBe('命中 3 处');
  });

  it('其余形态视为文本缺席（null）——数字/布尔/无文本块对象', () => {
    expect(decodeUpdateText(42)).toBeNull();
    expect(decodeUpdateText(true)).toBeNull();
    expect(decodeUpdateText(null)).toBeNull();
    expect(decodeUpdateText({ content: [{ type: 'image', data: 'x' }] })).toBeNull();
    expect(decodeUpdateText({ content: [{ type: 'text', text: '  \n \n' }] })).toBeNull(); // 全空白行
  });
});

describe('ToolProgressPanel 行生命周期', () => {
  it('begin 只建档不建行（首个 update 才建行）', () => {
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'grep');
    expect(panel.measure(WIDTH)).toBe(0);
    panel.applyUpdate('t1', '扫描中');
    expect(panel.measure(WIDTH)).toBe(1);
    expect(readRow(renderPanel(panel), 0)).toBe(' ▸ grep · 扫描中');
  });

  it('后续 update 原位换行（尾行文本更新）', () => {
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'grep');
    panel.applyUpdate('t1', '第一段');
    panel.applyUpdate('t1', '第二段');
    expect(readRow(renderPanel(panel), 0)).toBe(' ▸ grep · 第二段');
  });

  it('文本缺席退化形：` ▸ 名 …`', () => {
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'search');
    panel.applyUpdate('t1', { progress: 0.5 }); // 非解码形
    expect(readRow(renderPanel(panel), 0)).toBe(' ▸ search …');
  });

  it('end 即摘行；迟到 update 无档退 toolCallId 名（防御路径）', () => {
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'grep');
    panel.applyUpdate('t1', '扫');
    panel.end('t1');
    expect(panel.measure(WIDTH)).toBe(0);
    panel.applyUpdate('t1', '迟到进度'); // 档已随 end 摘——名退 id
    expect(readRow(renderPanel(panel), 0)).toBe(' ▸ t1 · 迟到进度');
  });

  it('clear 清板（行与建档同清——瞬时面律）', () => {
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'grep');
    panel.applyUpdate('t1', '扫');
    panel.clear();
    expect(panel.measure(WIDTH)).toBe(0);
    panel.applyUpdate('t1', '清板后'); // 无档退 id 名——建档确已清
    expect(readRow(renderPanel(panel), 0)).toBe(' ▸ t1 · 清板后');
  });

  it('多工具并行各占一行（建档序）；帽 4 行 + 溢出行', () => {
    const panel = new ToolProgressPanel();
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      panel.begin(`t-${name}`, name);
      panel.applyUpdate(`t-${name}`, `${name} 跑着`);
    }
    expect(panel.measure(WIDTH)).toBe(5); // 4 行 + 溢出行
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe(' ▸ a · a 跑着');
    expect(readRow(grid, 3)).toBe(' ▸ d · d 跑着');
    expect(readRow(grid, 4)).toBe('+ 1 更多');
  });
});
