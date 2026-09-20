/**
 * /marketplace 插件市场选装副屏件测试（03 §9.6 mp-5 TUI 选装面）：条目呈现
 * （已装徽标/detail 右对齐/长描述整字截断）、键面（移动/翻页/home/end、
 * enter 选定先收副屏再回调 + 未装/已装动作分叉、u 未装指路/已装换装、r 刷新
 * 驻留不收屏、busy 三键锁 fail-loud + actions 零调用、q 双轨/esc/Ctrl+C/
 * Ctrl+D 退出族）、渲染面（busy 底行/results 结算块/空态两分文案由 host 注入）、
 * 渲染帧零控制字节（grid 零控制字节律——注入已消毒形再锁一道边界）、可变模型
 * host 拥有（每帧现读——busy 置位后渲染随动）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { MarketPicker } from './market-picker.js';
import type { MarketEntryRow, MarketPanelActions, MarketPanelModel, MarketPickerOptions } from './market-picker.js';

/** key 事件夹具 */
const k = (key: string, mods: Partial<KeyEvent> = {}): KeyEvent => ({
  kind: 'key',
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  phase: 'press',
  ...mods,
});

/**
 * 条目夹具：两源三目（同名条目两源并呈 + 已装徽标一枚 + 长描述截断料）。
 * 文本即已消毒形（消毒锁在 host 侧 face——面板只收纯文本）。
 */
const ROWS: readonly MarketEntryRow[] = [
  { id: 'hello@alpha', name: 'hello', version: '1.0.0', market: 'alpha', description: '问好插件', installed: true },
  { id: 'hello@beta', name: 'hello', version: '2.0.0', market: 'beta', installed: false },
  {
    id: 'long-desc@alpha',
    name: 'long-desc',
    version: '0.3.0',
    market: 'alpha',
    description: '这是一个非常长的描述文本用于截断断言——整字截断不撕开宽字符',
    installed: false,
  },
];

/** 可变模型夹具（host 拥有形——面板每帧现读的可变对象） */
function makeModel(overrides: Partial<MarketPanelModel> = {}): MarketPanelModel {
  return { rows: ROWS, tail: [], results: [], busyLabel: null, ...overrides };
}

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

/** 渲染一帧（按面板量高满高） */
function paint(picker: MarketPicker, width = 72): CellGrid {
  const grid = new CellGrid(width, picker.measure(width));
  picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

function makePicker(overrides: Partial<MarketPickerOptions> & { model?: MarketPanelModel } = {}) {
  const actions: MarketPanelActions = { install: vi.fn(), uninstall: vi.fn(), upgrade: vi.fn(), refresh: vi.fn() };
  const notifyWarn = vi.fn();
  const requestRepaint = vi.fn();
  const onExit = vi.fn();
  const model = overrides.model ?? makeModel();
  const picker = new MarketPicker({
    model,
    actions,
    notifyWarn,
    requestRepaint,
    onExit,
    sessionId: 'sess-abcdef1234567890',
    ...overrides,
  });
  return { picker, model, actions, notifyWarn, requestRepaint, onExit };
}

describe('MarketPicker 呈现', () => {
  it('头行计数（条目数 + 源数）+ 条目行（name@market + 已装徽标 + detail 右段）+ 底行键面', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = paint(picker, width);
    expect(readRow(grid, 0, width)).toBe('◆ 插件市场 · 3 条目（2 源）');
    const row1 = readRow(grid, 1, width);
    expect(row1.startsWith('▸')).toBe(true); // 光标在首行
    expect(row1).toContain('hello@alpha');
    expect(row1).toContain('已装'); // 已装徽标
    expect(row1).toContain('问好插件'); // description 进 detail 段
    expect(row1).toContain('1.0.0'); // version 进 detail 段
    expect(readRow(grid, 2, width)).not.toContain('已装'); // 未装条目无徽标
    expect(readRow(grid, grid.rows - 1, width)).toContain('r 刷新');
  });

  it('空态两分：零源 vs 源在册零条目——两文案由 host 拼进 tail，面板原样呈现不判', () => {
    const zeroSource = makePicker({
      model: makeModel({ rows: [], tail: ['无市场源——CLI `berry marketplace add <source>` 添加（源管理留 CLI）'] }),
    });
    const g1 = paint(zeroSource.picker);
    expect(readRow(g1, 0, 72)).toBe('◆ 插件市场 · 0 条目（0 源）');
    expect(readRow(g1, 1, 72)).toContain('无市场源');
    const emptyCatalog = makePicker({ model: makeModel({ rows: [], tail: ['源在册但零条目'] }) });
    const g2 = paint(emptyCatalog.picker);
    expect(readRow(g2, 1, 72)).toContain('源在册但零条目');
  });

  it('tail（skipped 原因/刷新结局）与 results（结算回执全文）逐行进尾行区', () => {
    const { picker } = makePicker({
      model: makeModel({
        tail: ['beta 跳过：缓存缺席', '已刷新：alpha（2 条目）'],
        results: ['装机完成 hello@alpha', '装机 ≠ 启用——启用走 /plugins mount hello'],
      }),
    });
    const grid = paint(picker);
    const text = Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72)).join('\n');
    expect(text).toContain('beta 跳过：缓存缺席');
    expect(text).toContain('已刷新：alpha');
    expect(text).toContain('装机完成 hello@alpha');
    // 尾行区在条目行之后（tail 行号 > 末条目行号）
    const lines = text.split('\n');
    const lastEntry = lines.findIndex((l) => l.includes('long-desc@alpha'));
    const resultLine = lines.findIndex((l) => l.includes('装机完成'));
    expect(resultLine).toBeGreaterThan(lastEntry);
  });

  it('busyLabel 非 null：底行 ⏳ 标注（条目行与尾行区之后、键面提示行之前）', () => {
    const { picker } = makePicker({ model: makeModel({ busyLabel: '装机在飞中（marketplace install hello@alpha）' }) });
    const grid = paint(picker);
    const lines = Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72));
    const busyLine = lines.findIndex((l) => l.includes('⏳'));
    expect(busyLine).toBeGreaterThan(-1);
    expect(lines[busyLine]).toContain('装机在飞中');
    // 结构位：busy 行在 results 区之后、键面提示行（末行）之前
    expect(busyLine).toBe(grid.rows - 2);
  });

  it('可变模型 host 拥有：同一面板实例两次渲染现读不同 busy 态（非构造快照）', () => {
    const model = makeModel({ busyLabel: null });
    const { picker } = makePicker({ model });
    const g1 = paint(picker);
    const t1 = Array.from({ length: g1.rows }, (_, i) => readRow(g1, i, 72)).join('\n');
    expect(t1).not.toContain('⏳');
    // host 侧置位（可变对象字段替换——面板每帧现读）
    (model as { busyLabel: string | null }).busyLabel = '市场刷新在飞中（marketplace update）';
    const g2 = paint(picker);
    const t2 = Array.from({ length: g2.rows }, (_, i) => readRow(g2, i, 72)).join('\n');
    expect(t2).toContain('⏳ 市场刷新在飞中');
  });

  it('宽字符/长描述整字截断：detail 右段不撕宽字符（… 截断形），左段不越右段', () => {
    const width = 40; // 窄窗逼出截断
    const { picker } = makePicker();
    const grid = paint(picker, width);
    const row3 = readRow(grid, 3, width);
    expect(row3.length).toBeLessThanOrEqual(width);
    // 截断后行内不含被撕开的半字符（grapheme 级写入——readRow 输出均为完整字素）
    expect(row3).toContain('…');
  });

  it('渲染帧零控制字节（grid 零控制字节律——注入已消毒 fixture 再锁一道边界）', () => {
    const sanitizedRows: readonly MarketEntryRow[] = [
      {
        id: 'evil@alpha',
        name: 'evil',
        version: '1.0 0', // 消毒后形：原 \x1b[31m 已剥为空格
        market: 'alpha',
        description: '伪行注入 红色', // 消毒后形：原换行与 ESC 已剥
        installed: false,
      },
    ];
    const { picker } = makePicker({ model: makeModel({ rows: sanitizedRows, tail: ['跳过：原因  消毒后形'] }) });
    const grid = paint(picker);
    // eslint-disable-next-line no-control-regex -- 零控制字节律恰是控制字符的执法断言位
    const ctrl = /[\x00-\x1f\x7f-\x9f]/;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < 72; col++) {
        const g = grid.getCell(row, col)?.grapheme ?? '';
        expect(ctrl.test(g), `控制字节漏入 grid（${row},${col}）：${JSON.stringify(g)}`).toBe(false);
      }
    }
  });
});

describe('MarketPicker 键面', () => {
  it('光标移动：down/up + home/end 夹取（▸ 位随行——渲染面断言）+ 光标变更请求重画', () => {
    const { picker, requestRepaint } = makePicker();
    const width = 72;
    expect(readRow(paint(picker, width), 1, width).startsWith('▸')).toBe(true);
    picker.handleEvent(k('down'));
    expect(readRow(paint(picker, width), 2, width).startsWith('▸')).toBe(true);
    picker.handleEvent(k('end'));
    expect(readRow(paint(picker, width), 3, width).startsWith('▸')).toBe(true);
    picker.handleEvent(k('down')); // 尾夹取——位不动
    expect(readRow(paint(picker, width), 3, width).startsWith('▸')).toBe(true);
    picker.handleEvent(k('home'));
    expect(readRow(paint(picker, width), 1, width).startsWith('▸')).toBe(true);
    picker.handleEvent(k('up')); // 首夹取——位不动
    expect(readRow(paint(picker, width), 1, width).startsWith('▸')).toBe(true);
    // 副屏 Engine 输入后不自动重画——面板光标变更自请重画（程序化重画路）
    expect(requestRepaint.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('光标驱动滚动：光标滚出视口提窗（光标行恒可见）', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, 4); // 头 + 1 行视口 + 尾行区/提示（矮窗）
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('hello@alpha'); // 首窗锚顶
    picker.handleEvent(k('end')); // 光标到尾——提窗
    const grid2 = new CellGrid(width, 4);
    picker.render(grid2, { row: 0, col: 0, width, height: 4 });
    // 提窗后体区两行 = 条目 1、2（hello@alpha 滚出、光标行 long-desc 在窗内可见）
    expect(readRow(grid2, 1, width)).not.toContain('hello@alpha');
    expect(readRow(grid2, 1, width)).toContain('hello@beta');
    expect(readRow(grid2, 2, width)).toContain('long-desc@alpha');
  });

  it('首渲染前击键的过深视口在 render 回写真实窗高后回拉（maxOffset 上界）', () => {
    // 修前红实证位：同 theme-picker 家族缺陷——首渲染前 end 以构造初值
    // viewportHeight=1 夹出 offset=2（真实窗高 2 的 maxOffset = 3-2 = 1），
    // render 回写后无上界分支原样保持——首行 long-desc、第二行空窗。
    const { picker } = makePicker();
    const width = 72;
    picker.handleEvent(k('end')); // 首渲染前击键（陈窗高夹深位）
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('hello@beta'); // 回拉后首行（offset=1）
    expect(readRow(grid, 2, width)).toContain('long-desc@alpha'); // 尾条目恰贴窗底
  });

  it('enter 未装条目：先收副屏再回调 install（同序律）', () => {
    const calls: string[] = [];
    const { picker } = makePicker({
      onExit: () => calls.push('exit'),
      actions: {
        install: (id) => calls.push(`install:${id}`),
        uninstall: vi.fn(),
        upgrade: vi.fn(),
        refresh: vi.fn(),
      },
    });
    picker.handleEvent(k('down')); // → hello@beta（未装）
    picker.handleEvent(k('enter'));
    expect(calls).toEqual(['exit', 'install:hello@beta']);
  });

  it('enter 已装条目：先收副屏再回调 uninstall', () => {
    const calls: string[] = [];
    const { picker } = makePicker({
      onExit: () => calls.push('exit'),
      actions: {
        install: vi.fn(),
        uninstall: (id) => calls.push(`uninstall:${id}`),
        upgrade: vi.fn(),
        refresh: vi.fn(),
      },
    });
    picker.handleEvent(k('enter')); // 首行 hello@alpha（已装）
    expect(calls).toEqual(['exit', 'uninstall:hello@alpha']);
  });

  it('u 已装条目：换装回调不收屏；u 未装条目：指路 warn 零回调（key 轨 + text 轨两形）', () => {
    const { picker, actions, notifyWarn } = makePicker();
    picker.handleEvent(k('u')); // 首行已装——upgrade 回调
    expect(actions.upgrade).toHaveBeenCalledWith('hello@alpha');
    expect(notifyWarn).not.toHaveBeenCalled();
    picker.handleEvent(k('down')); // → hello@beta（未装）
    picker.handleEvent(k('u'));
    expect(actions.upgrade).toHaveBeenCalledTimes(1); // 未装零回调
    expect(notifyWarn).toHaveBeenCalledTimes(1);
    expect(notifyWarn.mock.calls[0]![0]).toContain('enter 选装');
    // text 轨（kitty disambiguate 纯键打字走 text 事件）同语义
    picker.handleEvent(k('home'));
    picker.handleEvent({ kind: 'text', text: 'u' } as InputEvent);
    expect(actions.upgrade).toHaveBeenCalledTimes(2);
  });

  it('r 刷新：回调不收屏（key 轨 + text 轨两形）', () => {
    const { picker, actions, onExit } = makePicker();
    picker.handleEvent(k('r'));
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    picker.handleEvent({ kind: 'text', text: 'r' } as InputEvent);
    expect(actions.refresh).toHaveBeenCalledTimes(2);
    expect(onExit).not.toHaveBeenCalled(); // 刷新驻留不收屏
  });

  it('busy 锁键：enter/u/r 三键 fail-loud warn + actions 零调用（key 轨与 text 轨全形）', () => {
    const { picker, actions, notifyWarn } = makePicker({
      model: makeModel({ busyLabel: '装机在飞中（marketplace install hello@alpha）' }),
    });
    picker.handleEvent(k('enter'));
    picker.handleEvent(k('u'));
    picker.handleEvent(k('r'));
    picker.handleEvent({ kind: 'text', text: 'u' } as InputEvent);
    picker.handleEvent({ kind: 'text', text: 'r' } as InputEvent);
    expect(actions.install).not.toHaveBeenCalled();
    expect(actions.uninstall).not.toHaveBeenCalled();
    expect(actions.upgrade).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
    // 五次锁键五次 warn，文案含 busyLabel 原文（fail-loud 呈现不猜语义）
    expect(notifyWarn).toHaveBeenCalledTimes(5);
    for (const call of notifyWarn.mock.calls) {
      expect(call[0]).toContain('装机在飞中');
      expect(call[0]).toContain('动作键锁定');
    }
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const { picker, onExit } = makePicker();
    expect(picker.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    picker.handleEvent({ kind: 'text', text: 'q' } as InputEvent);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁
  });

  it('Esc 同 q 退出', () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id）不退屏', () => {
    const onInterrupt = vi.fn();
    const { picker, onExit } = makePicker({ onInterrupt });
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-abcdef1234567890');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const { picker } = makePicker({
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    picker.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）；空表形移动/enter/r 零动作、q 照常', () => {
    const { picker, actions, onExit } = makePicker({ model: makeModel({ rows: [] }) });
    expect(picker.handleEvent(k('x'))).toBe(true);
    picker.handleEvent(k('down'));
    picker.handleEvent(k('enter'));
    picker.handleEvent(k('r'));
    expect(actions.install).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
    picker.handleEvent(k('q'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('MarketPicker 模型换血缩行防御（光标随行集夹取）', () => {
  /**
   * host rebuildRows 换血同形：字段替换式变更行集（marketplace-tui-face.ts
   * `this.model.rows = rows` 同形——host 侧变更不经面板任何夹取路径）。
   */
  const shrink = (model: MarketPanelModel, rows: readonly MarketEntryRow[]): void => {
    (model as { rows: readonly MarketEntryRow[] }).rows = rows;
  };

  it('换血缩行后 enter：光标夹取入新集不抛 TypeError，动作按新集条目分派（修前红）', () => {
    const { picker, model, actions, onExit } = makePicker();
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 光标 → 2（long-desc）
    shrink(model, [ROWS[0]!]); // r 刷新换血：3 行 → 1 行（越界形 1 ≤ 新行长 ≤ cursor）
    // 修前：rows[2] 为 undefined → 读 chosen.installed 抛 TypeError（生产链 stdin
    // data listener 内无人接 → uncaughtException 整进程退出——finding 主张坏形）
    expect(() => picker.handleEvent(k('enter'))).not.toThrow();
    expect(onExit).toHaveBeenCalledTimes(1); // 选定照常先收屏
    expect(actions.uninstall).toHaveBeenCalledWith('hello@alpha'); // 夹取后命中新集首行（已装 → uninstall 分派）
  });

  it('换血缩行后 u 键两轨（key + kitty text）：同防御不抛 + 夹取后命中新集条目', () => {
    const keyLane = makePicker();
    keyLane.picker.handleEvent(k('down'));
    keyLane.picker.handleEvent(k('down'));
    shrink(keyLane.model, [ROWS[0]!]);
    expect(() => keyLane.picker.handleEvent(k('u'))).not.toThrow();
    expect(keyLane.actions.upgrade).toHaveBeenCalledWith('hello@alpha');
    const textLane = makePicker();
    textLane.picker.handleEvent(k('down'));
    textLane.picker.handleEvent(k('down'));
    shrink(textLane.model, [ROWS[0]!]);
    expect(() => textLane.picker.handleEvent({ kind: 'text', text: 'u' } as InputEvent)).not.toThrow();
    expect(textLane.actions.upgrade).toHaveBeenCalledWith('hello@alpha');
  });

  it('render 期光标夹取：换血缩行后光标标记 ▸ 落在新集在位行（不再悬空）', () => {
    const { picker, model } = makePicker();
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down'));
    shrink(model, [ROWS[1]!]); // 缩到 1 行（未装条目）
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    expect(() => picker.render(grid, { row: 0, col: 0, width, height: grid.rows })).not.toThrow();
    expect(readRow(grid, 1, width).startsWith('▸')).toBe(true); // 光标标记在唯一在位行
  });

  it('换血到空表：enter/u/r（key 轨 + text 轨）全零回调不抛（空行防御）', () => {
    const { picker, model, actions } = makePicker();
    picker.handleEvent(k('down'));
    shrink(model, []);
    expect(() => {
      picker.handleEvent(k('enter'));
      picker.handleEvent(k('u'));
      picker.handleEvent({ kind: 'text', text: 'u' } as InputEvent);
      picker.handleEvent(k('r'));
      picker.handleEvent({ kind: 'text', text: 'r' } as InputEvent);
    }).not.toThrow();
    expect(actions.install).not.toHaveBeenCalled();
    expect(actions.uninstall).not.toHaveBeenCalled();
    expect(actions.upgrade).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
  });
});
