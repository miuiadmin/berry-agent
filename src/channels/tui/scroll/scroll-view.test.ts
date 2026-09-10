/**
 * 滚动视口单测：量高 / 尾随语义（贴尾-破随-复随）/ 键盘滚动（单行 / 翻页 /
 * 首尾）/ 滚动条按需显隐（溢出 thumb 比例 / 不溢出空列）/ 长行字素硬折
 * 计入视觉行 / onScroll 通知。
 */
import { describe, expect, it, vi } from 'vitest';
import { CellGrid, type InputEvent, type MouseEvent } from '../../engine/index.js';
import { ScrollView } from './scroll-view.js';

/** 键事件便捷构造 */
function key(
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; phase?: 'press' | 'repeat' | 'release' } = {},
): {
  kind: 'key';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  phase: 'press' | 'repeat' | 'release';
} {
  return {
    kind: 'key',
    key: k,
    ctrl: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
    meta: false,
    phase: mods.phase ?? 'press',
  };
}

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 行集便捷（'L0'..'Ln-1'） */
function linesOf(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `L${i}`);
}

describe('ScrollView 量高', () => {
  it('行数不超帽返全量', () => {
    const view = new ScrollView();
    view.setLines(['a', 'b', 'c']);
    expect(view.measure(20)).toBe(3);
  });

  it('超帽夹帽', () => {
    const view = new ScrollView({ maxHeight: 2 });
    view.setLines(linesOf(5));
    expect(view.measure(20)).toBe(2);
  });

  it('长行折行计入视觉行数（量高以折后行数计）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(['a'.repeat(45)]); // 20 列宽折 3 行
    expect(view.measure(20)).toBe(3);
  });
});

describe('ScrollView 尾随语义', () => {
  it('开屏贴尾（follow 初始 true——回看器显尾）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    const grid = new CellGrid(20, 10);
    view.render(grid, { row: 0, col: 0, width: 20, height: 10 });
    expect(readRow(grid, 0, 20)).toBe('L20');
    expect(readRow(grid, 9, 20)).toBe('L29                ┃'); // 末行恰在 thumb 段（offset 贴尾）
    expect(view.scrollOffset).toBe(20);
    expect(view.isFollowing).toBe(true);
  });

  it('上滚破随、再滚到底复随', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    view.render(new CellGrid(20, 10), { row: 0, col: 0, width: 20, height: 10 }); // offset=20
    view.scrollBy(-1);
    expect(view.scrollOffset).toBe(19);
    expect(view.isFollowing).toBe(false);
    view.scrollToTop();
    expect(view.scrollOffset).toBe(0);
    expect(view.isFollowing).toBe(false);
    view.scrollToEnd();
    expect(view.scrollOffset).toBe(20);
    expect(view.isFollowing).toBe(true);
  });

  it('follow 态 setLines 新行集贴尾；破随后 setLines 不动偏移（夹取自愈除外）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    view.render(new CellGrid(20, 10), { row: 0, col: 0, width: 20, height: 10 });
    view.setLines(linesOf(40)); // 尾随 → 贴新尾
    expect(view.scrollOffset).toBe(30);
    view.scrollBy(-5); // 破随
    view.setLines(linesOf(50));
    expect(view.scrollOffset).toBe(25); // 破随不追新——保持原位
  });
});

describe('ScrollView 键盘滚动', () => {
  function rig(): ScrollView {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    view.render(new CellGrid(20, 10), { row: 0, col: 0, width: 20, height: 10 }); // offset=20、页高 10 回写
    return view;
  }

  it('↑/↓ 单行', () => {
    const view = rig();
    expect(view.handleEvent(key('up'))).toBe(true);
    expect(view.scrollOffset).toBe(19);
    view.handleEvent(key('down'));
    expect(view.scrollOffset).toBe(20);
  });

  it('PgUp/PgDn 按视口高翻页', () => {
    const view = rig();
    view.handleEvent(key('pageup'));
    expect(view.scrollOffset).toBe(10);
    view.handleEvent(key('pagedown'));
    expect(view.scrollOffset).toBe(20);
  });

  it('Home/End 首尾（End 复随）', () => {
    const view = rig();
    view.handleEvent(key('home'));
    expect(view.scrollOffset).toBe(0);
    view.handleEvent(key('end'));
    expect(view.scrollOffset).toBe(20);
    expect(view.isFollowing).toBe(true);
  });

  it('repeat 相动作、release 与修饰组合不消费', () => {
    const view = rig();
    expect(view.handleEvent(key('up', { phase: 'repeat' }))).toBe(true);
    expect(view.scrollOffset).toBe(19);
    expect(view.handleEvent(key('up', { phase: 'release' }))).toBe(false);
    expect(view.handleEvent(key('up', { ctrl: true }))).toBe(false);
    expect(view.handleEvent(key('down', { shift: true }))).toBe(false);
    expect(view.scrollOffset).toBe(19);
  });

  it('未绑定键与文本事件不消费', () => {
    const view = rig();
    expect(view.handleEvent(key('escape'))).toBe(false);
    expect(view.handleEvent(key('tab'))).toBe(false);
    expect(view.handleEvent({ kind: 'text', text: 'a' })).toBe(false);
  });

  it('onScroll 在显式滚动时通知', () => {
    const view = rig();
    const spy = vi.fn();
    view.onScroll = spy;
    view.handleEvent(key('up'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('ScrollView 滚动条（按需显隐）', () => {
  it('溢出显 thumb（dim + 比例定位）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    const grid = new CellGrid(20, 10);
    view.render(grid, { row: 0, col: 0, width: 20, height: 10 }); // offset=20 → thumb 顶格
    // thumb：h=10、total=30 → size=floor(100/30)=3、start=round(20/20*(10-3))=7
    expect(grid.getCell(6, 19)).toBeNull(); // thumb 段之外不写
    expect(grid.getCell(7, 19)?.grapheme).toBe('┃');
    expect(grid.getCell(8, 19)?.grapheme).toBe('┃');
    expect(grid.getCell(9, 19)?.grapheme).toBe('┃');
    expect(grid.getCell(7, 19)?.style.dim).toBe(true);
    // 滚到顶：thumb 归顶
    view.scrollToTop();
    const grid2 = new CellGrid(20, 10);
    view.render(grid2, { row: 0, col: 0, width: 20, height: 10 });
    expect(grid2.getCell(0, 19)?.grapheme).toBe('┃');
    expect(grid2.getCell(2, 19)?.grapheme).toBe('┃');
    expect(grid2.getCell(3, 19)?.grapheme ?? ' ').toBe(' ');
  });

  it('不溢出右列空（无 thumb）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(['a', 'b']);
    const grid = new CellGrid(6, 4);
    view.render(grid, { row: 0, col: 0, width: 6, height: 4 });
    expect(readRow(grid, 0, 6)).toBe('a');
    expect(grid.getCell(0, 5)).toBeNull(); // 滚动条列未写
  });

  it('CJK 双宽行按显示列折（字素硬折）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(['中'.repeat(15)]); // 20 列 → 每视觉行 10 个中
    const grid = new CellGrid(21, 3);
    view.render(grid, { row: 0, col: 0, width: 21, height: 3 });
    expect(readRow(grid, 0, 21)).toBe('中'.repeat(10));
    expect(readRow(grid, 1, 21)).toBe('中'.repeat(5));
  });
});

describe('ScrollView scrollToLine（批 10f-4——回看器搜索跳转消费）', () => {
  it('逻辑行对齐视口顶（单视觉行场景）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    view.render(new CellGrid(20, 10), { row: 0, col: 0, width: 20, height: 10 }); // offset=20、页高回写
    view.scrollToLine(3);
    expect(view.scrollOffset).toBe(3); // 逻辑行 3 即视觉行 3 → 对齐视口顶
    expect(view.isFollowing).toBe(false); // 显式滚动路——破随
  });

  it('折行 col 判段：定位处所在视觉行（溢出档折宽与呈现一致——滚动条让列）', () => {
    const view = new ScrollView({ maxHeight: 10 });
    const lines = ['a'.repeat(25), ...linesOf(29)]; // 首行折 3 视觉行（溢出档折宽 9）
    view.setLines(lines);
    view.render(new CellGrid(10, 10), { row: 0, col: 0, width: 10, height: 10 });
    view.scrollToLine(0, 10); // col 10 落第二折段 [9,18)
    expect(view.scrollOffset).toBe(1);
    view.scrollToLine(1); // 逻辑行 1 起于视觉行 3
    expect(view.scrollOffset).toBe(3);
  });

  it('内容不溢出归零（maxOffset 0）', () => {
    const view = new ScrollView();
    view.setLines(['a', 'b', 'c']);
    view.render(new CellGrid(10, 10), { row: 0, col: 0, width: 10, height: 10 });
    view.scrollToLine(2);
    expect(view.scrollOffset).toBe(0);
  });
});

/* ---------------- 滚轮（mu-2——07 件 6 条款） ---------------- */

describe('ScrollView 滚轮（mu-2：缺省三视觉行 · 显式滚动路 · 复随判据同键盘）', () => {
  /** mouse 事件便捷构造（滚轮以 press 相为主——终端只报此相） */
  function mouse(
    button: 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down',
    phase: 'press' | 'motion' | 'release' = 'press',
  ): MouseEvent {
    return { kind: 'mouse', button, phase, col: 0, row: 0, ctrl: false, alt: false, shift: false, meta: false };
  }

  /** 装配：30 行入 10 高视口（溢出档——offset 贴尾 20） */
  function wheelRig() {
    const view = new ScrollView({ maxHeight: 10 });
    view.setLines(linesOf(30));
    view.render(new CellGrid(20, 10), { row: 0, col: 0, width: 20, height: 10 });
    return { view };
  }

  it('wheel-up 破随上滚三行（WHEEL_LINES=3 缺省档锁）', () => {
    const { view } = wheelRig();
    expect(view.scrollOffset).toBe(20); // 开屏贴尾
    expect(view.handleEvent(mouse('wheel-up'))).toBe(true);
    expect(view.scrollOffset).toBe(17); // 20-3
    expect(view.isFollowing).toBe(false); // 显式滚动路——破随
  });

  it('wheel-down 在底夹取不动 + 到底复随（同 PgDn 到底复随律）', () => {
    const { view } = wheelRig();
    expect(view.handleEvent(mouse('wheel-down'))).toBe(true);
    expect(view.scrollOffset).toBe(20); // 已在底——夹取
    expect(view.isFollowing).toBe(true); // 夹取落底 = 复随保持
  });

  it('连滚到顶夹 0（负向夹取——顶后再滚不动）', () => {
    const { view } = wheelRig();
    for (let i = 0; i < 8; i++) view.handleEvent(mouse('wheel-up')); // 7 次到顶（20-7*3=-1 夹 0）
    expect(view.scrollOffset).toBe(0);
    view.handleEvent(mouse('wheel-up'));
    expect(view.scrollOffset).toBe(0); // 顶上夹取
  });

  it('修饰位照常滚动（终端侧多截留改道——报文到达即按垂直滚消费）', () => {
    const { view } = wheelRig();
    const shifted: InputEvent = { ...mouse('wheel-up'), shift: true };
    expect(view.handleEvent(shifted)).toBe(true);
    expect(view.scrollOffset).toBe(17);
  });

  it('release/motion 相不消费（返 false——解码器不产此形，防御位）', () => {
    const { view } = wheelRig();
    expect(view.handleEvent(mouse('wheel-up', 'release'))).toBe(false);
    expect(view.handleEvent(mouse('wheel-down', 'motion'))).toBe(false);
    expect(view.scrollOffset).toBe(20); // 零滚动副作用
  });

  it('非滚轮 mouse 不消费（返 false 归子类选区路）', () => {
    const { view } = wheelRig();
    expect(view.handleEvent(mouse('left'))).toBe(false);
    expect(view.handleEvent(mouse('left', 'motion'))).toBe(false);
    expect(view.handleEvent(mouse('right'))).toBe(false);
  });
});
