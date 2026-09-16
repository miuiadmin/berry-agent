/**
 * 工具实时进度面板单测（07 §4.1 呈现面件 5）：首 update 建行（begin 只建档）/
 * 宽容解码三形（string 直显 / AgentToolResult 倒扫末条非空行 / 缺席退化 …）/
 * end 摘行 / clear 清板 / 帽 4 行 + 溢出行、renderCall 消费（2026-09-17 TUI
 * 余量收官批③——行集整体替换面板行 / 回落恒在 / 零 update 不触发 / 多行
 * 行集按视觉行计入帽 4 行）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { DEFAULT_THEME } from '../theme/index.js';
import { registerToolRenderer } from '../../renderers.js';
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

/* ---------------- 2026-09-17 TUI 余量收官批③：renderCall 消费（07 §4.1 钉位注） ---------------- */

describe('renderCall 消费（插件面板行——回落恒在律）', () => {
  // 模块级注册表——逐笔 dispose 防跨用例串扰（afterEach 收口）
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('行集整体替换面板行（宿主 ` ▸ 名 · 末行` 形让位）＋ renderCall 收在飞期快照', () => {
    const received: unknown[] = [];
    disposers.push(
      registerToolRenderer('plug_scan', {
        renderCall: (call) => {
          received.push(call);
          return [[{ text: '扫描 ', tone: 'success' }, { text: '42%' }]];
        },
      }),
    );
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'plug_scan', { depth: 3 });
    panel.applyUpdate('t1', '进度文本'); // 行集替换——update 文本不进呈现面
    expect(panel.measure(WIDTH)).toBe(1);
    expect(readRow(renderPanel(panel), 0)).toBe('扫描 42%'); // 非 ` ▸ plug_scan · 进度文本`
    // 在飞期快照 = start 面事实（toolCallId/toolName/arguments——无 update 载荷）
    expect(received).toEqual([{ toolCallId: 't1', toolName: 'plug_scan', arguments: { depth: 3 } }]);
  });

  it('tone 语义键直取着色（面板行同卡体律——text/缺省无前景）', () => {
    disposers.push(
      registerToolRenderer('plug_tone', {
        renderCall: () => [
          [
            { text: '红', tone: 'error' },
            { text: '灰', tone: 'secondary' },
          ],
        ],
      }),
    );
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'plug_tone', {});
    panel.applyUpdate('t1', 'x');
    const grid = renderPanel(panel);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.error);
    expect(grid.getCell(0, 2)?.style.fg).toBe(DEFAULT_THEME.secondary);
  });

  it('回落恒在律三形：抛错 / 空行集 / 未注册——恒宿主 ` ▸ 名 · 末行` 形', () => {
    disposers.push(
      registerToolRenderer('plug_throw', {
        renderCall: () => {
          throw new Error('插件炸了');
        },
      }),
    );
    disposers.push(registerToolRenderer('plug_empty', { renderCall: () => [] }));
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'plug_throw');
    panel.applyUpdate('t1', '进度');
    panel.begin('t2', 'plug_empty');
    panel.applyUpdate('t2', '进度');
    panel.begin('t3', 'plug_miss');
    panel.applyUpdate('t3', '进度');
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe(' ▸ plug_throw · 进度');
    expect(readRow(grid, 1)).toBe(' ▸ plug_empty · 进度');
    expect(readRow(grid, 2)).toBe(' ▸ plug_miss · 进度');
  });

  it('零 update 的静默工具：renderCall 不触发（有进无面板行——在飞可见性归件 3）', () => {
    let invoked = 0;
    disposers.push(
      registerToolRenderer('plug_quiet', {
        renderCall: () => {
          invoked++;
          return [[{ text: '不该出现' }]];
        },
      }),
    );
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'plug_quiet', {});
    expect(panel.measure(WIDTH)).toBe(0); // 建档不建行
    expect(invoked).toBe(0); // 消费缝 = 行建行/换行时——零 update 无缝无现调
  });

  it('原位换行重调（tool_execution_update 驱动既律——每 update 以当下快照现调）', () => {
    let invoked = 0;
    disposers.push(
      registerToolRenderer('plug_live', {
        renderCall: () => {
          invoked++;
          return [[{ text: `第 ${invoked} 帧` }]];
        },
      }),
    );
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'plug_live', {});
    panel.applyUpdate('t1', '一');
    expect(readRow(renderPanel(panel), 0)).toBe('第 1 帧');
    panel.applyUpdate('t1', '二'); // 原位换行——重现调替换行集
    expect(invoked).toBe(2);
    expect(readRow(renderPanel(panel), 0)).toBe('第 2 帧');
    expect(panel.measure(WIDTH)).toBe(1); // 行集替换非追加
  });

  it('多行行集按视觉行计入面板帽 4 行（+ 溢出行）', () => {
    disposers.push(
      registerToolRenderer('plug_multi', {
        renderCall: () => [[{ text: '甲行' }], [{ text: '乙行' }], [{ text: '丙行' }]],
      }),
    );
    const panel = new ToolProgressPanel();
    panel.begin('t1', 'plug_multi', {});
    panel.applyUpdate('t1', 'x'); // 3 视觉行
    panel.begin('t2', 'b');
    panel.applyUpdate('t2', '跑着'); // 1 视觉行——合计 4 恰满帽
    expect(panel.measure(WIDTH)).toBe(4);
    panel.begin('t3', 'c');
    panel.applyUpdate('t3', '溢出'); // 第 5 视觉行——帽外
    expect(panel.measure(WIDTH)).toBe(5); // 4 + 溢出行
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe('甲行');
    expect(readRow(grid, 2)).toBe('丙行');
    expect(readRow(grid, 3)).toBe(' ▸ b · 跑着');
    expect(readRow(grid, 4)).toBe('+ 1 更多');
  });

  it('迟到 update 无档退 id 名时查表仍按 id 名（防御路径同回落律）', () => {
    disposers.push(registerToolRenderer('t9', { renderCall: () => [[{ text: '命中' }]] }));
    const panel = new ToolProgressPanel();
    panel.applyUpdate('t9', '迟到'); // 无档——名退 id（与注册表撞名的防御路径）
    expect(readRow(renderPanel(panel), 0)).toBe('命中');
  });
});
