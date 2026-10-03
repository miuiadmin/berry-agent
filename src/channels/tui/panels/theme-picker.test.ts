/**
 * /themes 主题切换副屏件测试（07 §4.1 R2 挂账解挂批 + 命令面增补批）：条目
 * 呈现（当前档 ● 标记 / 坏文件 ⚠ 标注）、键面（移动/翻页/home/end/enter 选定
 * 先收副屏再回调——SessionPicker 同序律）、退出族（q 双轨/esc/Ctrl+C 打断/
 * Ctrl+D 先收屏再退柄）、闭锁单次、空条目诚实形。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid, colorRgbOf, stringWidth, type ColorValue } from '../../engine/index.js';
import { ThemePicker, swatchOf } from './theme-picker.js';
import type { ThemePickEntry, ThemePickerOptions } from './theme-picker.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme } from '../theme/index.js';

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

/** mouse 滚轮事件夹具 */
const wheel = (dir: 'wheel-up' | 'wheel-down'): MouseEvent => ({
  kind: 'mouse',
  phase: 'press',
  button: dir,
  col: 0,
  row: 1,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
});

/** 条目夹具：内置三档 + 自定义两枚（其一坏文件） */
const ENTRIES: readonly ThemePickEntry[] = [
  { name: 'auto', detail: '跟随终端明暗（自动检测）', broken: false },
  { name: 'dark', detail: '内置暗色', broken: false },
  { name: 'light', detail: '内置亮色', broken: false },
  { name: 'my-theme', detail: '自定义（themes/<名>.json）', broken: false },
  { name: 'broken-one', detail: '自定义（themes/<名>.json）', broken: true },
];

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

function makePicker(overrides: Partial<ThemePickerOptions> = {}) {
  const onSelect = vi.fn();
  const onExit = vi.fn();
  const picker = new ThemePicker({
    entries: ENTRIES,
    current: 'dark',
    onSelect,
    onExit,
    sessionId: 'sess-abcdef1234567890',
    ...overrides,
  });
  return { picker, onSelect, onExit };
}

describe('ThemePicker 呈现', () => {
  it('头行计数 + 条目行（当前档 ● 标记 / 坏文件 ⚠ 标注）+ 底行提示', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('◆ 主题切换 · 5 个主题');
    expect(readRow(grid, 1, width)).toContain('auto');
    // dark = 当前档——● 标记位（非光标行前缀两空格 + ● 段）
    const darkRow = readRow(grid, 2, width);
    expect(darkRow.startsWith('  ●')).toBe(true);
    expect(darkRow).toContain('dark');
    // 坏文件条目——⚠ 标注
    expect(readRow(grid, 5, width)).toContain('⚠');
    expect(readRow(grid, grid.rows - 1, width)).toContain('enter 选定');
  });

  it('窄窗非条目行 … 收口（wf_3c8b00b8 组δ X-5 补漏）：头行/空条目行/底行 raw writeText 硬截断封堵（修前红）', () => {
    // 修前：头行/空条目行/底行 raw writeText 直写——窄窗越界静默吸收硬截断
    // 无提示（条目行走 fitRowSegments 有 …，非条目行是漏网面）
    const { picker } = makePicker();
    const width = 8; // 「（无条目）」10 列亦超——空条目行同红
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width).endsWith('…')).toBe(true); // 头行（修前红位）
    expect(readRow(grid, grid.rows - 1, width).endsWith('…')).toBe(true); // 底行提示
    const { picker: empty } = makePicker({ entries: [] });
    const g2 = new CellGrid(width, empty.measure(width));
    empty.render(g2, { row: 0, col: 0, width, height: g2.rows });
    expect(readRow(g2, 1, width).endsWith('…')).toBe(true); // 空条目行同律
  });

  it('非当前档行首无 ●（光标 › 与当前标记分立）', () => {
    const { picker } = makePicker({ current: 'auto' });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width).startsWith('  ●')).toBe(false); // dark 非当前（当前 auto 在行 1）
    expect(readRow(grid, 1, width)).toContain('›'); // 光标在首行（auto）
    expect(readRow(grid, 1, width)).toContain('●'); // auto 兼当前档——两标记同行
  });

  it('空条目 = 诚实空态行', () => {
    const { picker } = makePicker({ entries: [] });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('◆ 主题切换 · 无条目');
    expect(readRow(grid, 1, width)).toContain('（无条目）');
  });

  it('height=2 极小窗：零内容行只头行+底行（守卫族语义——修前 viewHeight 下限 1，首内容行被底行覆写留残段红）', () => {
    // 手卷家族守卫统一锚（jobs/diff/rewind/theme/sandbox/thinking/model/
    // market/skills/session 十件同形收编——对齐 ScrollView 守卫族六件
    // debug/status/usage/help/guide/feedback：height=2 时零内容行，头行 +
    // 底行两行即全帧）。修前：Math.max(1, height-2) 强立 1 行内容——首内容行
    // 先写后又被底行提示覆写（右对齐 detail 段越提示行宽残留在帧上）
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, 2);
    picker.render(grid, { row: 0, col: 0, width, height: 2 });
    expect(readRow(grid, 0, width)).toBe('◆ 主题切换 · 5 个主题'); // 头行在场
    // 底行 = 键面提示独占整行（修前残留首条目右段「跟随终端明暗（自动检测）」红）
    expect(readRow(grid, 1, width)).toBe('↑↓ 移动 · enter 选定（立即生效并保存） · q/esc 返回');

    // 空条目同律：空态行不写（写了也被底行覆写留残段）
    const { picker: empty } = makePicker({ entries: [] });
    const g2 = new CellGrid(width, 2);
    empty.render(g2, { row: 0, col: 0, width, height: 2 });
    expect(readRow(g2, 1, width)).toBe('q/esc 返回'); // 修前残留「（无条目）」尾段红
  });

  it('窄窗右段预算律：右段先按预算 … 截断再右对齐——负起列劈毁档名坏形封堵（修前红）', () => {
    const { picker } = makePicker();
    // 窗 20 < auto 行右段宽 27——修前 rightCol = 20-27 = -7：CellGrid 吸收负列
    // 首段后余段从行首覆写，光标标记与档名 'auto' 全毁（finding 实证坏形）
    const width = 20;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const line = readRow(grid, 1, width); // auto 行（光标行 + 最宽 detail）
    expect(line.startsWith('›')).toBe(true); // 行首光标标记不被右段尾覆写
    expect(line).toContain('auto'); // 档名存活（左段保留位 ≥ 半窗下限）
    expect(line).toContain('…'); // 右段按预算 … 收口（不再原宽右对齐）
    expect(stringWidth(line)).toBeLessThanOrEqual(width); // 行宽不越窗
  });
});

describe('ThemePicker 语义色样段（界面美化役 2026-10-01 美学批）', () => {
  it('内置 dark/light 档行尾画四段真色块（resolve 管线现算）；auto/坏文件/未注入自定义诚实不画', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 期望色 = 复用 resolve 管线现算（accent/success/error/secondary 四段）
    const dark = resolveTheme(builtinPalette('dark'), DEFAULT_THEME.depth);
    const expected = [dark.accent, dark.success, dark.error, dark.secondary];
    expect(swatchOf(ENTRIES[1]!)).toEqual(expected); // 取值面：builtin 回退路径
    // 渲染面：dark 行（行 2）尾四列 ■ 逐块着色
    for (let i = 0; i < 4; i++) {
      const cell = grid.getCell(2, width - 4 + i);
      expect(cell?.grapheme).toBe('■');
      expect(cell?.style?.fg).toEqual(expected[i]);
    }
    // auto（探测依赖）/my-theme（未注入）/broken-one（坏文件）不画
    expect(swatchOf(ENTRIES[0]!)).toBeNull();
    expect(swatchOf(ENTRIES[3]!)).toBeNull();
    expect(swatchOf(ENTRIES[4]!)).toBeNull();
    expect(readRow(grid, 1, width)).not.toContain('■');
    expect(readRow(grid, 5, width)).not.toContain('■');
  });

  it('装配位注入色样优先（自定义板 resolve 后真色直用）；窄于色带+1 列整幅让给文本', () => {
    // ColorRgb 是品牌 hex 串（#rrggbb）——经 colorRgbOf 通道构造入 ColorValue 面
    const swatch: readonly ColorValue[] = [
      colorRgbOf(1, 2, 3),
      colorRgbOf(4, 5, 6),
      colorRgbOf(7, 8, 9),
      colorRgbOf(10, 11, 12),
    ];
    const { picker } = makePicker({ entries: [{ name: 'mine', detail: '自定义', broken: false, swatch }] });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(grid.getCell(1, width - 1)?.grapheme).toBe('■');
    expect(grid.getCell(1, width - 1)?.style?.fg).toEqual(swatch[3]);
    expect(grid.getCell(1, width - 4)?.style?.fg).toEqual(swatch[0]);
    // 窄窗（宽 5 ≤ 色带 4 + 1 → 不留）：色样缺席、文本占满
    const narrow = new CellGrid(5, picker.measure(5));
    picker.render(narrow, { row: 0, col: 0, width: 5, height: narrow.rows });
    expect(readRow(narrow, 1, 5)).not.toContain('■');
  });
});

describe('ThemePicker 长清单滚动位置指示（界面美化役 2026-10-01 美学批）', () => {
  /** 八条目夹具（无色样——指示断言面纯净） */
  const MANY: readonly ThemePickEntry[] = Array.from({ length: 8 }, (_, i) => ({
    name: `t${i}`,
    detail: '档',
    broken: false,
  }));
  const paint = (picker: ThemePicker, height: number): CellGrid => {
    const width = 40;
    const grid = new CellGrid(width, height);
    picker.render(grid, { row: 0, col: 0, width, height });
    return grid;
  };

  it('锚顶：无上指示、下指示「↓ N 更多」dim（视口 ≥3 行且溢出才立）', () => {
    const { picker } = makePicker({ entries: MANY });
    const grid = paint(picker, 5); // viewHeight 3、8 条溢出
    expect(readRow(grid, 1, 40)).toContain('t0'); // 首条目
    expect(readRow(grid, 2, 40)).toContain('t1');
    expect(readRow(grid, 3, 40)).toBe('↓ 6 更多'); // 8-2 实占
    expect(grid.getCell(3, 0)?.style?.dim).toBe(true); // dim 边行
    expect(readRow(grid, 1, 40)).not.toContain('更多'); // 锚顶无上指示
  });

  it('中部：上/下双指示 + 在选行夹在中间恒可见', () => {
    const { picker } = makePicker({ entries: MANY });
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 光标 t3
    const grid = paint(picker, 5);
    expect(readRow(grid, 1, 40)).toBe('↑ 3 更多');
    expect(readRow(grid, 2, 40).startsWith('›')).toBe(true); // 在选行 t3
    expect(readRow(grid, 2, 40)).toContain('t3');
    expect(readRow(grid, 3, 40)).toBe('↓ 4 更多');
  });

  it('到底：上指示「↑ N 更多」、下指示撤（窗贴尾）', () => {
    const { picker } = makePicker({ entries: MANY });
    picker.handleEvent(k('end'));
    const grid = paint(picker, 5);
    expect(readRow(grid, 1, 40)).toBe('↑ 7 更多');
    expect(readRow(grid, 2, 40)).toContain('t7');
    expect(readRow(grid, 3, 40)).not.toContain('更多'); // 贴尾无下指示
  });

  it('矮窗（视口 <3 行）不立指示——既有单条目窗形零漂', () => {
    const { picker } = makePicker({ entries: MANY });
    const grid = paint(picker, 4); // viewHeight 2
    expect(readRow(grid, 1, 40)).toContain('t0');
    expect(readRow(grid, 2, 40)).toContain('t1');
    expect(readRow(grid, 1, 40)).not.toContain('更多');
    expect(readRow(grid, 2, 40)).not.toContain('更多');
  });
});

describe('ThemePicker 键面', () => {
  it('光标移动：down/up + home/end 夹取（› 位随行——渲染面断言）', () => {
    const { picker } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, picker.measure(width));
      picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
      return grid;
    };
    expect(readRow(paint(), 1, width).startsWith('›')).toBe(true); // 首位 auto
    picker.handleEvent(k('down'));
    expect(readRow(paint(), 2, width).startsWith('›')).toBe(true); // → dark
    picker.handleEvent(k('end'));
    expect(readRow(paint(), 5, width).startsWith('›')).toBe(true); // → 尾条目
    picker.handleEvent(k('down')); // 尾夹取——位不动
    expect(readRow(paint(), 5, width).startsWith('›')).toBe(true);
    picker.handleEvent(k('home'));
    expect(readRow(paint(), 1, width).startsWith('›')).toBe(true); // 回首
    picker.handleEvent(k('up')); // 首夹取——位不动
    expect(readRow(paint(), 1, width).startsWith('›')).toBe(true);
  });

  it('enter 选定：先收副屏（onExit）再回调（onSelect 名）——同序律；onExit 闭锁单次', () => {
    const calls: string[] = [];
    let exits = 0;
    const { picker } = makePicker({
      onSelect: (name) => calls.push(`select:${name}`),
      onExit: () => {
        exits += 1;
        calls.push('exit');
      },
    });
    picker.handleEvent(k('down')); // → dark（当前档再选 = 重落同档幂等）
    picker.handleEvent(k('enter'));
    expect(calls).toEqual(['exit', 'select:dark']);
    // onExit 闭锁（exit 收口单次）；onSelect 不经闭锁——SessionPicker 件族同律
    picker.handleEvent(k('q'));
    expect(exits).toBe(1);
    expect(calls).toEqual(['exit', 'select:dark']);
  });

  it('光标驱动滚动：光标滚出视口提窗（首行随窗换——渲染面断言）', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('auto'); // 首窗锚顶
    picker.handleEvent(k('end')); // 光标到尾——提窗
    const grid2 = new CellGrid(width, 4);
    picker.render(grid2, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid2, 1, width)).not.toContain('auto'); // 首行换（窗已提）
    expect(readRow(grid2, 2, width)).toContain('broken-one'); // 尾条目在窗内
    picker.handleEvent(k('home')); // 光标回首——压窗
    const grid3 = new CellGrid(width, 4);
    picker.render(grid3, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid3, 1, width)).toContain('auto'); // 回锚顶
  });

  it('首渲染前击键的过深视口在 render 回写真实窗高后回拉（maxOffset 上界）', () => {
    // 修前红实证位：面板打开后、首渲染前发 end——此时 viewportHeight 还是
    // 构造初值 1，offset 被夹到 cursor 4；首渲染回写真实窗高 2 后应回拉到
    // 「尾行恰贴窗底」位（maxOffset = 5-2 = 3）。修前无上界分支：cursor=4
    // 仍在 [4, 4+2) 窗内，offset=4 原样保持——首行 broken-one、第二行空窗。
    const { picker } = makePicker();
    const width = 72;
    picker.handleEvent(k('end')); // 首渲染前击键（陈窗高夹深位）
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('my-theme'); // 回拉后首行（offset=3）
    expect(readRow(grid, 2, width)).toContain('broken-one'); // 尾条目恰贴窗底
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

  it('未消费键终局吞（模态独占）', () => {
    const { picker } = makePicker();
    expect(picker.handleEvent(k('x'))).toBe(true);
  });

  it('空条目形：移动/enter 不动作（无条目可循），q 退出照常', () => {
    const { picker, onSelect, onExit } = makePicker({ entries: [] });
    expect(picker.handleEvent(k('down'))).toBe(true);
    expect(picker.handleEvent(k('enter'))).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    picker.handleEvent(k('q'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('滚轮 = 光标 ±3 行（经既有夹取与视口跟随——↑↓ 同路；修前红：wheel 零动作）+ 空条目零动作吞', () => {
    const { picker, onSelect } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
      picker.render(grid, { row: 0, col: 0, width, height: 4 });
      return grid;
    };
    expect(readRow(paint(), 1, width)).toContain('auto'); // 首窗锚顶
    picker.handleEvent(wheel('wheel-down')); // 光标 0 → 3（my-theme——夹取同 ↓×3）
    const grid = paint();
    expect(readRow(grid, 1, width)).toContain('light'); // 视口跟随提窗 offset 2——修前零动作红锚
    expect(readRow(grid, 1, width)).not.toContain('auto');
    expect(readRow(grid, 2, width)).toContain('›'); // 光标行（my-theme）在窗内末行
    expect(readRow(grid, 2, width)).toContain('my-theme');
    picker.handleEvent(wheel('wheel-up')); // 光标 3 → 0——回锚顶
    expect(readRow(paint(), 1, width)).toContain('auto');
    expect(onSelect).not.toHaveBeenCalled(); // 滚轮只挪光标不选定
    // 空条目滚轮零动作吞（不炸不动作）
    const empty = makePicker({ entries: [] });
    expect(empty.picker.handleEvent(wheel('wheel-down'))).toBe(true);
    expect(empty.onSelect).not.toHaveBeenCalled();
  });
});
