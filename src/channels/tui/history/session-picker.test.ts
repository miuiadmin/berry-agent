/**
 * /sessions 会话切换器测试（批 10k R7）：光标模型（移动夹取/翻页/home-end/
 * 视口跟随 clamp）+ 选定序（先收副屏再 onSelect）+ 空表如实 + 行呈现
 * （光标/活跃位/无题/截断/右段时间短 id）+ 副屏键面三件套 + 删除键与
 * 确认位（05 §2.5 会话删除编排定形注①——'d' 破坏性动作必有确认）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid, stringWidth } from '../../engine/index.js';
import type { UiSessionDeleteResult, UiSessionSummary } from '../../../contracts/index.js';
import { SessionPicker } from './session-picker.js';

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

/** 本地时确定时间戳（formatStamp 本地时呈现——构造用本地分量保跨机确定） */
const stamp = (h: number, m: number): number => new Date(2026, 8, 15, h, m).getTime();

/** 会话行夹具 */
const row = (over: Partial<UiSessionSummary> & { id: string }): UiSessionSummary => ({
  title: '标题',
  updatedAt: stamp(10, 30),
  active: false,
  ...over,
});

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, rowNumber: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(rowNumber, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

/** 装配便捷（全回调 vi 记录；extra = Options 可选位覆写——截断披露/删除注入腿用） */
function makePicker(
  sessions: readonly UiSessionSummary[],
  extra: {
    totalCount?: number;
    onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>;
    requestRepaint?: () => void;
  } = {},
) {
  const onSelect = vi.fn();
  const onExit = vi.fn();
  const onInterrupt = vi.fn();
  const picker = new SessionPicker({ sessions, onSelect, onExit, onInterrupt, ...extra });
  return { picker, onSelect, onExit, onInterrupt };
}

describe('SessionPicker 光标与选择模型', () => {
  const sessions = [row({ id: 'aaa111111111' }), row({ id: 'bbb222222222', active: true })];

  it('enter 选定：先收副屏再 onSelect（序断言）+ 终局吞', () => {
    const calls: string[] = [];
    const picker = new SessionPicker({
      sessions,
      onSelect: (id) => calls.push(`select:${id}`),
      onExit: () => calls.push('exit'),
    });
    expect(picker.handleEvent(k('enter'))).toBe(true);
    expect(calls).toEqual(['exit', 'select:aaa111111111']); // 首行默认光标
  });

  it('↓↑ 移动 + 越界夹取不循环；enter 取光标行', () => {
    const { picker, onSelect } = makePicker(sessions);
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 越界夹取——停尾行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('bbb222222222');
    picker.handleEvent(k('up'));
    picker.handleEvent(k('up')); // 越界夹取——停首行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('aaa111111111');
  });

  it('home/end/pagedown 快捷移动', () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ id: `id-${i}-00000000` }));
    const { picker, onSelect } = makePicker(many);
    picker.handleEvent(k('end'));
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('id-11-00000000');
    picker.handleEvent(k('home'));
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('id-0-00000000');
    // 翻选幅 = 视口高（render 回写后生效）——先画一次定视口 8（高 10 头尾各 1）
    const grid = new CellGrid(60, 10);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 10 });
    picker.handleEvent(k('home'));
    picker.handleEvent(k('pagedown'));
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('id-8-00000000'); // 0 + 8 视口幅
  });

  it('首渲染前击键的过深视口在 render 回写真实窗高后回拉（maxOffset 上界）', () => {
    // 修前红实证位：同 theme-picker 家族缺陷——面板打开后、首渲染前发 end，
    // viewportHeight 还是构造初值 1，offset 被夹到 cursor 3；首渲染回写真实
    // 窗高 2 后应回拉到「尾行恰贴窗底」位（maxOffset = 4-2 = 2）。修前无上界
    // 分支：cursor=3 仍在 [3, 3+2) 窗内，offset=3 原样保持——首行尾条目、
    // 第二行空窗。
    const four = Array.from({ length: 4 }, (_, i) => row({ id: `id-${i}-00000000`, title: `回拉${i}` }));
    const { picker } = makePicker(four);
    picker.handleEvent(k('end')); // 首渲染前击键（陈窗高夹深位）
    const grid = new CellGrid(60, 4); // 头 + 2 行视口 + 提示
    picker.render(grid, { row: 0, col: 0, width: 60, height: 4 });
    expect(readRow(grid, 1, 60)).toContain('回拉2'); // 回拉后首行（offset=2——倒数第二）
    expect(readRow(grid, 2, 60)).toContain('回拉3'); // 尾条目恰贴窗底
  });

  it('q/Esc 取消退出（不 onSelect）+ 闭锁单次', () => {
    const { picker, onSelect, onExit } = makePicker(sessions);
    picker.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    picker.handleEvent(k('q'));
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁
    picker.handleEvent({ kind: 'text', text: 'q' });
    expect(onExit).toHaveBeenCalledTimes(1); // text 轨同闭锁
  });

  it('空表：如实「无会话」+ 移动族跳过（不炸）+ enter 不选', () => {
    const { picker, onSelect } = makePicker([]);
    const grid = new CellGrid(40, 5);
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 0, 40)).toBe('⇄ 会话切换 · 无会话');
    expect(readRow(grid, 1, 40)).toBe('（暂无会话——esc 返回，输入 /new 新建）');
    expect(readRow(grid, 4, 40)).toBe('q/esc 返回');
    expect(picker.handleEvent(k('down'))).toBe(true); // 吞而不动
    picker.handleEvent(k('enter'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SessionPicker 行呈现', () => {
  it('光标标记 + 活跃位 + 标题 + 右段时间短 id', () => {
    const sessions = [
      row({ id: 'aaa111111111', title: '调 TUI' }),
      row({ id: 'bbb222222222', title: '旧会话', active: true, updatedAt: stamp(9, 5) }),
    ];
    const { picker } = makePicker(sessions);
    const grid = new CellGrid(60, 6);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 6 });
    expect(readRow(grid, 0, 60)).toBe('⇄ 会话切换 · 2 会话');
    // 左段 10 列 · 右段 20 列右对齐（col 40）→ 中间 30 空格
    expect(readRow(grid, 1, 60)).toBe('›   调 TUI' + ' '.repeat(30) + '09-15 10:30 aaa11111');
    expect(readRow(grid, 2, 60)).toBe('  ● 旧会话' + ' '.repeat(30) + '09-15 09:05 bbb22222');
    expect(readRow(grid, 5, 60)).toBe('↑↓ 移动 · enter 切换 · q/esc 返回');
  });

  it('截断披露：totalCount 超清单长 → 头行 N/M 注记（B2——100 窗静默截断不可见）', () => {
    // 修前红：totalCount 位缺席——超窗用户看不到「清单不是全量」这一事实
    const { picker } = makePicker(
      [row({ id: 'aaa111111111', title: '窗内会话一' }), row({ id: 'bbb222222222', title: '窗内会话二' })],
      { totalCount: 5 },
    );
    const grid = new CellGrid(60, 6);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 6 });
    expect(readRow(grid, 0, 60)).toBe('⇄ 会话切换 · 2/5 会话（仅显示最近）');
  });

  it('截断披露不误报：totalCount 不超清单长 → 头行原形（无注记）', () => {
    const { picker } = makePicker([row({ id: 'aaa111111111' })], { totalCount: 1 });
    const grid = new CellGrid(60, 4);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 4 });
    expect(readRow(grid, 0, 60)).toBe('⇄ 会话切换 · 1 会话');
  });

  it('标题缺席（undefined/空串）如实「（无题）」', () => {
    const { picker } = makePicker([row({ id: 'ccc333333333', title: undefined })]);
    const grid = new CellGrid(60, 4);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 4 });
    expect(readRow(grid, 1, 60)).toContain('（无题）');
  });

  it('超宽左段整字截断加省略号（CJK 不产半字）+ 右段超预算同样 … 收口后右对齐（随真态翻档）', () => {
    const longTitle = '很长'.repeat(20); // 80 列 >> 剩余宽
    const { picker } = makePicker([row({ id: 'ddd444444444', title: longTitle })]);
    const grid = new CellGrid(40, 4);
    picker.render(grid, { row: 0, col: 0, width: 40, height: 4 });
    const line = readRow(grid, 1, 40);
    // 右段预算律（fx3 推全）：预算 = 40 - 1 - 左段保留位 20 = 19 < 右段宽 20——
    // 右段同样 … 收口后右对齐在行尾（旧断言「右段不被截」是未修现状在 40 列
    // 窗的锁面；宽 60 窗右段在预算内不截由上行测试锁）
    expect(line.endsWith('09-15 10:30 ddd444…')).toBe(true);
    const left = line.slice(0, line.indexOf('09-15')).trimEnd(); // 剥截断段与右段间填充空格
    expect(left.endsWith('…')).toBe(true); // 左段省略号收尾（整字截断不撕宽字符）
    expect(stringWidth(line)).toBeLessThanOrEqual(40); // 总宽不越界
  });

  it('窄窗右段预算律：时间/短 id 右段先按预算 … 截断再右对齐——负起列劈毁标题坏形封堵（修前红）', () => {
    // 窗 18 < 右段宽 20（时间 12 + 短 id 8）——修前 rightCol = -2：CellGrid 吸收
    // 负列首两字后余段从行首覆写，光标标记与标题全毁（finding 实证坏形）
    const { picker } = makePicker([row({ id: 'aaa111111111', title: '调 TUI' })]);
    const width = 18;
    const grid = new CellGrid(width, 4);
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    const line = readRow(grid, 1, width);
    expect(line.startsWith('›')).toBe(true); // 行首光标标记不被右段尾覆写
    expect(line).toContain('调'); // 标题前字存活（左段保留位 ≥ 半窗下限）
    expect(line).toContain('…'); // 右段按预算 … 收口
    expect(stringWidth(line)).toBeLessThanOrEqual(width); // 行宽不越窗
  });

  it('窄窗非条目行 … 收口（wf_3c8b00b8 组δ X-5）：头行/空态行/底行 raw writeText 硬截断封堵（修前红）', () => {
    // 修前：头行/空态行/底行是 raw buffer.writeText 直写——窄窗超宽时
    // CellGrid 越界静默吸收，行尾硬截断无省略提示（条目行走 fitRowSegments
    // 有 …，非条目行是漏网面）；修后统一 fitLine … 收口
    const { picker } = makePicker([row({ id: 'sess-abcdef1234567890', title: '题' })], { totalCount: 250 });
    const width = 14; // 头行「⇄ 会话切换 · 1/250 会话（仅显示最近）」远超
    const grid = new CellGrid(width, 4);
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    const head = readRow(grid, 0, width);
    expect(head.startsWith('⇄')).toBe(true); // 行首锚存活
    expect(head.endsWith('…')).toBe(true); // 修前红位：硬截断行尾无 …
    expect(stringWidth(head)).toBeLessThanOrEqual(width); // 收口不越窗
    const bottom = readRow(grid, 3, width);
    expect(bottom.endsWith('…')).toBe(true); // 底行 hintLine 三段同超同律
    // 空态行：空清单第二行「（暂无会话——esc 返回，输入 /new 新建）」超宽同收口
    const { picker: empty } = makePicker([]);
    const g2 = new CellGrid(width, 4);
    empty.render(g2, { row: 0, col: 0, width, height: 4 });
    expect(readRow(g2, 1, width).endsWith('…')).toBe(true);
  });

  it('视口跟随：光标移出窗下沿 → 窗口下移（光标恒可见）', () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `id-${i}-00000000`, title: `行${i}` }));
    const { picker, onSelect } = makePicker(many);
    const grid = new CellGrid(40, 5); // 视口 3 行
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0'); // offset 0
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 光标 3 → 窗 [1,3]
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行1'); // offset 1——行0 出窗
    expect(readRow(grid, 3, 40)).toContain('›'); // 光标行在窗内末行
    picker.handleEvent(k('up'));
    picker.handleEvent(k('up'));
    picker.handleEvent(k('up')); // 光标 0 → 窗回 [0,2]
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0');
    void onSelect;
  });
});

describe('SessionPicker 副屏键面三件套', () => {
  it('Ctrl+C 打断目标 = 装配闭包（无参柄——聚焦会话自知）不退屏', () => {
    const { picker, onInterrupt, onExit } = makePicker([row({ id: 'a' })]);
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith(); // 无参
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+D 先收副屏再退出柄（序断言）', () => {
    const calls: string[] = [];
    const picker = new SessionPicker({
      sessions: [row({ id: 'a' })],
      onSelect: () => calls.push('select'),
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    picker.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）', () => {
    const { picker } = makePicker([row({ id: 'a' })]);
    expect(picker.handleEvent(k('x'))).toBe(true);
    expect(picker.handleEvent({ kind: 'text', text: 'z' })).toBe(true);
  });
});

describe('SessionPicker 滚轮消费', () => {
  it('滚轮 = 光标 ±3 行（经既有夹取与视口跟随——↑↓ 同路；修前红：wheel 零动作）', () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ id: `id-${i}-00000000`, title: `行${i}` }));
    const { picker } = makePicker(many);
    const grid = new CellGrid(40, 5); // 视口 3 行
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0'); // offset 0
    picker.handleEvent(wheel('wheel-down')); // 光标 0 → 3（夹取同 ↓×3）
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行1'); // 视口跟随 offset 1——修前零动作红锚
    expect(readRow(grid, 1, 40)).not.toContain('行0');
    expect(readRow(grid, 3, 40)).toContain('›'); // 光标行（行3）在窗内末行
    picker.handleEvent(wheel('wheel-up')); // 光标 3 → 0
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0'); // 回锚顶
    picker.handleEvent(wheel('wheel-up')); // 越界夹取——停首行不循环
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0');
  });

  it('空表滚轮零动作吞（不炸不动作）', () => {
    const { picker, onSelect, onExit } = makePicker([]);
    expect(picker.handleEvent(wheel('wheel-down'))).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });
});

/* ---------------- 删除键与确认位（05 §2.5 会话删除编排定形注①） ---------------- */

describe('SessionPicker 删除键与确认位（05 §2.5 定形注①——破坏性动作必有确认）', () => {
  const sessions = [
    row({ id: 'aaa111111111', title: '甲' }),
    row({ id: 'bbb222222222', title: '乙' }),
    row({ id: 'ccc333333333', title: '丙' }),
  ];

  /** 手控删除回执 rig（deferred——busy/missing/deleted 各态由测试注入落位） */
  function deferredDelete() {
    let settle!: (result: UiSessionDeleteResult) => void;
    const calls: string[] = [];
    const promise = new Promise<UiSessionDeleteResult>((resolve) => {
      settle = resolve;
    });
    return {
      calls,
      onDelete: (sessionId: string) => {
        calls.push(sessionId);
        return promise;
      },
      settle,
    };
  }

  /** 全屏读（确认视图多行断言便捷） */
  function paintAll(picker: SessionPicker, width: number, height: number): string {
    const grid = new CellGrid(width, height);
    picker.render(grid, { row: 0, col: 0, width, height });
    const lines: string[] = [];
    for (let r = 0; r < height; r++) {
      let out = '';
      for (let c = 0; c < width; c++) out += grid.getCell(r, c)?.grapheme ?? ' ';
      lines.push(out.trimEnd());
    }
    return lines.join('\n');
  }

  it("'d' 进确认视图：明示将删除对象与「不可恢复」（含审批记录在内的全部会话史）——key 轨", () => {
    const rig = deferredDelete();
    const { picker } = makePicker(sessions, { onDelete: rig.onDelete });
    expect(picker.handleEvent(k('d'))).toBe(true);
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('将删除'); // 删除对象明示（标题 + 短 id）
    expect(text).toContain('甲');
    expect(text).toContain('aaa11111');
    expect(text).toContain('不可恢复'); // 确认文案规范明文（含审批记录在内的全部会话史）
    expect(rig.calls).toEqual([]); // 确认位先行——未确认零回调
  });

  it("kitty text 轨 'd' 同律（双轨收键）", () => {
    const rig = deferredDelete();
    const { picker } = makePicker(sessions, { onDelete: rig.onDelete });
    picker.handleEvent({ kind: 'text', text: 'd' });
    expect(paintAll(picker, 70, 8)).toContain('不可恢复');
    expect(rig.calls).toEqual([]);
  });

  it('enter 确认 → onDelete 光标行 + deleted 就地滤行回清单（刷新重拉最小形）+ 异步落位请帧', async () => {
    const rig = deferredDelete();
    const repaint = vi.fn();
    const { picker, onSelect } = makePicker(sessions, { onDelete: rig.onDelete, requestRepaint: repaint });
    picker.handleEvent(k('d'));
    picker.handleEvent(k('enter'));
    expect(rig.calls).toEqual(['aaa111111111']); // 光标行（首行默认）
    rig.settle({ status: 'deleted' });
    await Promise.resolve(); // 异步落位微任务冲刷（.then 链）
    await Promise.resolve();
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('会话切换 · 2 会话'); // 滤行后清单头（回 list 视图）
    expect(text).toContain('乙'); // 次行上位
    expect(text).not.toContain('甲'); // 已删行不再现
    expect(repaint).toHaveBeenCalled(); // 异步落位请帧（面板不自驱重画）
    picker.handleEvent(k('enter')); // 回清单后选择面恢复
    expect(onSelect).toHaveBeenCalledWith('bbb222222222');
  });

  it('busy/missing 留确认视图：就地状态行明示因（notify 副屏期走停屏缓冲——面板须自带呈现）', async () => {
    const rig = deferredDelete();
    const { picker } = makePicker(sessions, { onDelete: rig.onDelete });
    picker.handleEvent(k('down')); // 光标 → 乙
    picker.handleEvent(k('d'));
    picker.handleEvent(k('enter'));
    rig.settle({ status: 'busy' });
    await Promise.resolve();
    await Promise.resolve();
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('不可恢复'); // 仍留确认视图（未删——可取消重试）
    expect(text).toContain('正在运行'); // busy 状态行（等待完成或先打断）
  });

  it('删除回调异常防御折状态行（不炸面板——.catch 折面）', async () => {
    const calls: string[] = [];
    const picker = new SessionPicker({
      sessions,
      onSelect: () => undefined,
      onExit: () => undefined,
      onDelete: (id) => {
        calls.push(id);
        return Promise.reject(new Error('库炸了'));
      },
    });
    picker.handleEvent(k('d'));
    picker.handleEvent(k('enter'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['aaa111111111']);
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('删除失败'); // 错误状态行（折面呈现于确认视图）
  });

  it('取消（esc/q 两轨）零回调回清单', () => {
    const rig = deferredDelete();
    const { picker } = makePicker(sessions, { onDelete: rig.onDelete });
    picker.handleEvent(k('d'));
    picker.handleEvent(k('escape')); // esc 取消
    expect(paintAll(picker, 70, 8)).toContain('会话切换 · 3 会话');
    expect(rig.calls).toEqual([]);
    picker.handleEvent(k('down'));
    picker.handleEvent(k('d'));
    picker.handleEvent({ kind: 'text', text: 'q' }); // kitty text 轨 q 取消
    expect(paintAll(picker, 70, 8)).toContain('会话切换 · 3 会话');
    expect(rig.calls).toEqual([]);
  });

  it('注入缺席 d 键无效（键行为随注入在场——缺席不虚报，选择面不受影响）', () => {
    const { picker, onSelect } = makePicker(sessions); // 无 onDelete
    expect(picker.handleEvent(k('d'))).toBe(true); // 吞而不动作
    expect(paintAll(picker, 70, 8)).toContain('会话切换 · 3 会话'); // 清单视图原形
    picker.handleEvent({ kind: 'text', text: 'd' }); // text 轨同无效
    expect(paintAll(picker, 70, 8)).toContain('会话切换 · 3 会话');
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('aaa111111111');
  });

  it('在飞守卫：删除回执未落位前 enter 不双发（防双击）', () => {
    const rig = deferredDelete();
    const { picker } = makePicker(sessions, { onDelete: rig.onDelete });
    picker.handleEvent(k('d'));
    picker.handleEvent(k('enter')); // 发起（回执悬置）
    picker.handleEvent(k('enter')); // 在飞——不双发
    expect(rig.calls).toEqual(['aaa111111111']);
  });

  it('帮助行在场加「d 删除」段（注入在场才注——缺席保持原形）', () => {
    const withDelete = makePicker(sessions, { onDelete: deferredDelete().onDelete });
    expect(paintAll(withDelete.picker, 70, 8)).toContain('d 删除');
    const bare = makePicker(sessions);
    expect(paintAll(bare.picker, 70, 8)).not.toContain('d 删除');
  });

  it('删唯一行后清单如实空态（光标夹取不越界）', async () => {
    const rig = deferredDelete();
    const { picker } = makePicker([row({ id: 'only-000000000', title: '独' })], { onDelete: rig.onDelete });
    picker.handleEvent(k('d'));
    picker.handleEvent(k('enter'));
    rig.settle({ status: 'deleted' });
    await Promise.resolve();
    await Promise.resolve();
    expect(paintAll(picker, 70, 8)).toContain('会话切换 · 无会话'); // 空态如实
    picker.handleEvent(k('enter')); // 空表 enter 不选不炸
  });

  it('删行后 totalCount 同步递减：头行原形不翻假截断注记（修前红——滤行不减 total 造「N/M」新谎）', async () => {
    // 修前红实证位（2026-10-07 会话删除编排批 MAJOR-1 同款裁量）：total ==
    // 清单长（全量在窗原形无注记）→ 删 1 行 → 滤行后 1 < 2，判据
    // 「totalCount > 清单长」翻真——头行凭空现「1/2 会话（仅显示最近）」假
    // 注记（物理删后全量真值已减 1——B2 披露判据造新谎）；修 = 就地滤行
    // 联动 total 递减（webui App 载体同裁量）
    const rig = deferredDelete();
    const { picker } = makePicker(
      [row({ id: 'aaa111111111', title: '甲' }), row({ id: 'bbb222222222', title: '乙' })],
      { totalCount: 2, onDelete: rig.onDelete },
    );
    picker.handleEvent(k('d'));
    picker.handleEvent(k('enter'));
    rig.settle({ status: 'deleted' });
    await Promise.resolve();
    await Promise.resolve();
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('会话切换 · 1 会话'); // 递减后 1==1 原形
    expect(text).not.toContain('仅显示最近'); // 修前红位：假截断注记在场
  });
});
