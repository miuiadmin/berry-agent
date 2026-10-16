/**
 * /sessions 会话切换器测试（批 10k R7）：光标模型（移动夹取/翻页/home-end/
 * 视口跟随 clamp）+ 选定序（先收副屏再 onSelect）+ 空表如实 + 行呈现
 * （光标/活跃位/无题/截断/右段时间短 id）+ 副屏键面三件套 + 删除键与
 * 确认位（05 §2.5 会话删除编排定形注①——'d' 破坏性动作必有确认）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid, stringWidth } from '../../engine/index.js';
import type {
  UiSessionArchiveResult,
  UiSessionDeleteResult,
  UiSessionPreviewLine,
  UiSessionSummary,
} from '../../../contracts/index.js';
import { SessionPicker } from './session-picker.js';
import { formatRelativeStamp } from './session-picker.js';

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

/** 装配便捷（全回调 vi 记录；extra = Options 可选位覆写——截断披露/删除注入/开史注入/光标复原/分页注入/归档注入/相对钟腿用） */
function makePicker(
  sessions: readonly UiSessionSummary[],
  extra: {
    totalCount?: number;
    onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>;
    onPreview?: (sessionId: string) => Promise<readonly UiSessionPreviewLine[]>;
    onOpenHistory?: (sessionId: string, cursorAt: number) => void;
    initialCursor?: number;
    onLoadMore?: (cursor: string) => Promise<{
      rows: readonly UiSessionSummary[];
      nextCursor: string | null;
    }>;
    moreCursor?: string | null;
    onArchive?: (sessionId: string, archive: boolean) => Promise<UiSessionArchiveResult>;
    onSwitchView?: (view: 'active' | 'archived') => Promise<{
      rows: readonly UiSessionSummary[];
      nextCursor: string | null;
      total: number;
    }>;
    requestRepaint?: () => void;
    nowMs?: number;
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

  it('↓↑ 移动 + 单步环绕（挖掘 35 轮 B6——修前红：越界夹取不循环旧形）；enter 取光标行', () => {
    const { picker, onSelect } = makePicker(sessions);
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 尾行再 ↓——单步环绕回首行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('aaa111111111');
    picker.handleEvent(k('up')); // 首行 ↑——单步环绕回尾行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('bbb222222222');
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
  /** 相对钟基准：fixture 时点 + 8d（≥7d 档——既有绝对断言零变，确定性明示） */
  const ABS_BASE = new Date(2026, 8, 23, 10, 30).getTime();

  it('光标标记 + 活跃位 + 标题 + 右段时间短 id', () => {
    const sessions = [
      row({ id: 'aaa111111111', title: '调 TUI' }),
      row({ id: 'bbb222222222', title: '旧会话', active: true, updatedAt: stamp(9, 5) }),
    ];
    const { picker } = makePicker(sessions, { nowMs: ABS_BASE });
    const grid = new CellGrid(60, 6);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 6 });
    expect(readRow(grid, 0, 60)).toBe('⇄ 会话切换 · 2 会话');
    // 左段 10 列 · 右段 20 列右对齐（col 40）→ 中间 30 空格
    expect(readRow(grid, 1, 60)).toBe('›   调 TUI' + ' '.repeat(30) + '09-15 10:30 aaa11111');
    expect(readRow(grid, 2, 60)).toBe('  ● 旧会话' + ' '.repeat(30) + '09-15 09:05 bbb22222');
    expect(readRow(grid, 5, 60)).toBe('↑↓ 移动 · enter 切换 · q/esc 返回');
  });

  it('时间列相对时分档 + ≥7d 回退绝对（挖掘 35 轮 B10——分档边界锁）', () => {
    // 边界两侧各锁一档：59s→秒档 / 60s→分钟档 / 59m→分钟档 / 60m→小时档 /
    // 23h→小时档 / 24h→天档 / 6d→天档 / 7d→回退绝对（保日期信息量）
    const base = new Date(2026, 9, 14, 12, 0).getTime();
    const S = 1_000;
    const M = 60 * S;
    const H = 60 * M;
    const D = 24 * H;
    const at = (offset: number) => base - offset;
    const cases: ReadonlyArray<[number, string]> = [
      [0, '0 秒前'],
      [59 * S, '59 秒前'],
      [60 * S, '1 分钟前'],
      [59 * M, '59 分钟前'],
      [60 * M, '1 小时前'],
      [23 * H, '23 小时前'],
      [24 * H, '1 天前'],
      [6 * D, '6 天前'],
      [7 * D, '10-07 12:00'],
      [29 * D, '09-15 12:00'],
    ];
    for (const [offset, expectText] of cases) {
      expect(formatRelativeStamp(at(offset), base)).toBe(expectText);
    }
  });

  it('相对时渲染消费 + 基准构造期定格（重渲染不随真实时钟漂——呈现位确定性）', () => {
    const base = new Date(2026, 9, 14, 12, 0).getTime();
    const sessions = [row({ id: 'aaa111111111', title: '刚聊的', updatedAt: base - 5 * 60_000 })];
    const { picker } = makePicker(sessions, { nowMs: base });
    const grid = new CellGrid(60, 4);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 4 });
    expect(readRow(grid, 1, 60)).toContain('5 分钟前');
    // 同实例再渲染——基准定格（不 new Date() 现取），行形字节级不变
    const grid2 = new CellGrid(60, 4);
    picker.render(grid2, { row: 0, col: 0, width: 60, height: 4 });
    expect(readRow(grid2, 1, 60)).toBe(readRow(grid, 1, 60));
  });

  it('工作区短名段（挖掘 35 轮 B9——右段首位；缺席缩位不虚报）', () => {
    const base = new Date(2026, 9, 14, 12, 0).getTime();
    const sessions = [
      row({
        id: 'aaa111111111',
        title: '调 TUI',
        workspaceRoot: '/Users/x/code/berry-agent',
        updatedAt: base - 5 * 60_000,
      }),
      row({ id: 'bbb222222222', title: '别仓', workspaceRoot: undefined, updatedAt: base - 5 * 60_000 }),
    ];
    const { picker } = makePicker(sessions, { nowMs: base });
    const grid = new CellGrid(72, 5);
    picker.render(grid, { row: 0, col: 0, width: 72, height: 5 });
    // 在场：右段首位 basename 短名 + 相对时 + 短 id（跨仓清单仓别可辨）
    expect(readRow(grid, 1, 72)).toContain('berry-agent 5 分钟前 aaa11111');
    // 缺席（undefined）：缩位零虚报——右段无短名段直起相对时
    const second = readRow(grid, 2, 72);
    expect(second).toContain('5 分钟前 bbb22222');
    expect(second).not.toContain('undefined');
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
    const { picker } = makePicker([row({ id: 'ddd444444444', title: longTitle })], { nowMs: ABS_BASE });
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
    const { picker } = makePicker([row({ id: 'aaa111111111', title: '调 TUI' })], { nowMs: ABS_BASE });
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

  it('矮终端行预算让位（挖掘 34 轮；修前红：height=2 键面行 row+height-1 后写覆写不可逆警示——破坏性确认失警示仍可 enter）', () => {
    const rig = deferredDelete();
    const { picker } = makePicker(sessions, { onDelete: rig.onDelete });
    picker.handleEvent(k('d'));
    // height=2：删除对象 + 不可逆警示恒在（规范明文案不让位），键面让位
    const two = paintAll(picker, 70, 2).split('\n');
    expect(two[0]).toContain('将删除');
    expect(two[1]).toContain('不可恢复'); // 修前红：此行为键面「enter 确认删除」
    expect(two[1]).not.toContain('enter 确认删除');
    // height=3：警示 + 不可逆 + 键面（状态行让位——键面在底与清单视图同构）
    const three = paintAll(picker, 70, 3).split('\n');
    expect(three[0]).toContain('将删除');
    expect(three[1]).toContain('不可恢复');
    expect(three[2]).toContain('enter 确认删除');
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

/* ---------------- 尾段预览（挖掘 35 轮 B5——tab 展开键 + 懒加载 + 占位三态） ---------------- */

describe('SessionPicker 尾段预览（挖掘 35 轮 B5——「（无题）」会话成片可辨）', () => {
  const sessions = [row({ id: 'aaa111111111', title: '甲' }), row({ id: 'bbb222222222', title: '乙' })];

  /** 手控预览回执 rig（deferred——ok/empty/error 由测试注入落位；调用账按 id） */
  function deferredPreview() {
    let settle!: (lines: readonly UiSessionPreviewLine[]) => void;
    const calls: string[] = [];
    const promise = new Promise<readonly UiSessionPreviewLine[]>((resolve) => {
      settle = resolve;
    });
    return {
      calls,
      onPreview: (sessionId: string) => {
        calls.push(sessionId);
        return promise;
      },
      settle,
    };
  }

  /** 全屏读（占位/条目行断言便捷——删除 describe paintAll 同形） */
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

  it('tab 展开：按键才拉非自动——展开即 loading 占位 + onPreview 首拉；再 tab 收起', () => {
    const rig = deferredPreview();
    const { picker } = makePicker(sessions, { onPreview: rig.onPreview });
    const closed = paintAll(picker, 70, 8);
    expect(closed).not.toContain('加载中'); // 收起态零拉零画
    expect(rig.calls).toEqual([]);
    picker.handleEvent(k('tab'));
    expect(rig.calls).toEqual(['aaa111111111']); // 展开即拉光标行
    expect(paintAll(picker, 70, 8)).toContain('加载中…'); // 占位诚实
    picker.handleEvent(k('tab')); // 再 tab 收起
    expect(paintAll(picker, 70, 8)).not.toContain('加载中');
  });

  it('注入缺席 tab 键无效零行为变（吞而不动作——' + "'d'" + ' 删除键同律）', () => {
    const { picker, onSelect } = makePicker(sessions); // 无 onPreview
    expect(picker.handleEvent(k('tab'))).toBe(true); // 吞而不动作
    const text = paintAll(picker, 70, 8);
    expect(text).not.toContain('加载中');
    expect(text).not.toContain('tab 预览'); // 帮助行缺席不注
    picker.handleEvent(k('enter')); // 选择面不受影响
    expect(onSelect).toHaveBeenCalledWith('aaa111111111');
  });

  it('回执落位：requestRepaint 请帧 + user `› ` 前缀行 / assistant 缩进行（升序旧→新）', async () => {
    const rig = deferredPreview();
    const repaint = vi.fn();
    const { picker } = makePicker(sessions, { onPreview: rig.onPreview, requestRepaint: repaint });
    picker.handleEvent(k('tab'));
    rig.settle([
      { speaker: 'user', text: '第一问' },
      { speaker: 'assistant', text: '第一答' },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(repaint).toHaveBeenCalled(); // 异步回执请帧（面板不自驱重画）
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('› 第一问'); // user 前缀与主屏 user 块同词汇
    expect(text).toContain('  第一答'); // assistant 两空格缩进对齐
  });

  it('光标行联动懒加载 + 缓存免重复拉（回访零二拉——codex transcript_previews 同构）', async () => {
    const rig = deferredPreview();
    const { picker } = makePicker(sessions, { onPreview: rig.onPreview });
    picker.handleEvent(k('tab'));
    picker.handleEvent(k('down')); // 联动第二行
    expect(rig.calls).toEqual(['aaa111111111', 'bbb222222222']);
    picker.handleEvent(k('up')); // 回访首行——缓存命中
    expect(rig.calls).toEqual(['aaa111111111', 'bbb222222222']); // 零二拉
  });

  it('占位三态诚实：空组归 empty「（无转录）」/ 失败折面「预览加载失败：…」', async () => {
    // empty 态
    let settleRef!: (lines: readonly UiSessionPreviewLine[]) => void;
    const emptyPicker = makePicker(sessions, {
      onPreview: () =>
        new Promise((resolve) => {
          settleRef = resolve;
        }),
    });
    emptyPicker.picker.handleEvent(k('tab'));
    settleRef([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(paintAll(emptyPicker.picker, 70, 8)).toContain('（无转录）');
    // error 态
    const errorPicker = makePicker(sessions, {
      onPreview: () => Promise.reject(new Error('库锁')),
    });
    errorPicker.picker.handleEvent(k('tab'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(paintAll(errorPicker.picker, 70, 8)).toContain('预览加载失败');
    expect(paintAll(errorPicker.picker, 70, 8)).toContain('库锁'); // foldErrorText 折面非裸 String
  });

  it('尾段 6 条帽：8 条回执只画尾 6（升序旧→新——最旧两条让位）', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      speaker: 'user' as const,
      text: `第${i + 1}条`,
    }));
    const { picker } = makePicker(sessions, { onPreview: () => Promise.resolve(eight) });
    picker.handleEvent(k('tab'));
    await Promise.resolve();
    await Promise.resolve();
    const text = paintAll(picker, 70, 12);
    expect(text).not.toContain('第1条'); // 帽外最旧让位
    expect(text).not.toContain('第2条');
    expect(text).toContain('第3条');
    expect(text).toContain('第8条');
  });

  it('帮助行注入在场加 tab 段（收起「tab 预览」/ 展开「tab 收预览」）', () => {
    const rig = deferredPreview();
    const { picker } = makePicker(sessions, { onPreview: rig.onPreview });
    expect(paintAll(picker, 70, 8)).toContain('tab 预览');
    picker.handleEvent(k('tab'));
    expect(paintAll(picker, 70, 8)).toContain('tab 收预览');
  });

  it('measure 一致：展开态量高加预览区（空行 + 内容行——布局面与渲染面同账）', async () => {
    const rig = deferredPreview();
    const { picker } = makePicker(sessions, { onPreview: rig.onPreview });
    const closed = picker.measure(70); // 头 1 + 清单 2 + 底 1 = 4
    picker.handleEvent(k('tab'));
    const loading = picker.measure(70); // + 空行 1 + 占位 1 = 6
    rig.settle([
      { speaker: 'user', text: '问' },
      { speaker: 'assistant', text: '答' },
      { speaker: 'user', text: '再问' },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    const ok = picker.measure(70); // + 空行 1 + 3 行 = 8
    expect(loading).toBe(closed + 2);
    expect(ok).toBe(closed + 4);
  });
});

/* ---------------- 打字搜索（挖掘 43 轮件 C——'/' 进搜索态 + 三字段过滤 + 键面分档） ---------------- */

describe('SessionPicker 打字搜索（挖掘 43 轮件 C）', () => {
  // 语料覆盖三过滤字段：title / ws basename / shortId + 无题占位行
  const sessions = [
    row({ id: 'sea111111111', title: '修复登录闪退', workspaceRoot: '/Users/x/code/berry-agent' }),
    row({ id: 'docs22222222', title: '写文档', workspaceRoot: '/Users/x/code/webapp' }),
    row({ id: 'zzz333333333', title: undefined, workspaceRoot: '' }),
  ];

  /** 全屏读（删除/预览 describe paintAll 同形） */
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

  /** 进搜索态便捷（'/' 一击 + 驻留空 query） */
  function enterSearch(picker: SessionPicker): void {
    picker.handleEvent(k('/'));
  }

  /** 手控预览回执 rig（预览联动锁用——预览 describe deferredPreview 同形） */
  function deferredPreview() {
    let settle!: (lines: readonly UiSessionPreviewLine[]) => void;
    const calls: string[] = [];
    const promise = new Promise<readonly UiSessionPreviewLine[]>((resolve) => {
      settle = resolve;
    });
    return {
      calls,
      onPreview: (sessionId: string) => {
        calls.push(sessionId);
        return promise;
      },
      settle,
    };
  }

  it('① ' + "'/'" + ' 进搜索态：头行换过滤计数面 + hint 换「输入过滤」面（修前红：旧键面无响应）', () => {
    const { picker } = makePicker(sessions);
    const before = paintAll(picker, 70, 8);
    expect(before).toContain('3 会话'); // 非搜索态原头行
    expect(before).not.toContain('输入过滤');
    enterSearch(picker);
    const after = paintAll(picker, 70, 8);
    expect(after).toContain('· 3/3 匹配 ·'); // 搜索态头行：filtered/denom 计数 + 空 query 驻留尾段空
    expect(after).toContain('输入过滤'); // hint 换面
    expect(after).not.toContain('3 会话'); // 原头行退场
  });

  it('② 三字段过滤各自命中 + 大小写不敏感 + basename 不搜全路径', () => {
    const { picker } = makePicker(sessions);
    enterSearch(picker);
    // title 维
    picker.handleEvent({ kind: 'text', text: '闪退' });
    let text = paintAll(picker, 70, 8);
    expect(text).toContain('· 1/3 匹配 · 闪退');
    expect(text).toContain('修复登录闪退');
    expect(text).not.toContain('写文档');
    // ws basename 维 + 大小写不敏感（query 大写 / 语料小写）——text 轨是
    // 追加语义：段间 escape 退态 + '/' 重进取干净 query
    picker.handleEvent(k('escape'));
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'WEBAPP' });
    text = paintAll(picker, 70, 8);
    expect(text).toContain('· 1/3 匹配 · WEBAPP');
    expect(text).toContain('写文档'); // basename 'webapp' 命中
    expect(text).not.toContain('修复登录闪退');
    // shortId 维（前八位）
    picker.handleEvent(k('escape'));
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'zzz33333' });
    text = paintAll(picker, 70, 8);
    expect(text).toContain('· 1/3 匹配 · zzz33333');
    expect(text).toContain('（无题）'); // shortId 命中的无题行
    // 全路径不搜（basename 之外的字段不进判据）
    picker.handleEvent(k('escape'));
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'Users/x' });
    text = paintAll(picker, 70, 8);
    expect(text).toContain('· 0/3 匹配 · Users/x'); // 路径前缀零命中——basename 维边界
    expect(text).toContain('（无匹配会话）');
  });

  it('③ q/d 归输入不抢键面：text 轨 q/d 进 query（不退出不进确认）+ key 轨 d 同律', () => {
    const { picker, onExit, onSelect } = makePicker(sessions);
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'q' });
    picker.handleEvent(k('d')); // key 轨单字符同路
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('· 0/3 匹配 · qd'); // 两键均入 query
    expect(onExit).not.toHaveBeenCalled(); // q 未退出
    expect(onSelect).not.toHaveBeenCalled(); // d 未进删除确认（paint 亦无确认面）
    expect(text).not.toContain('删除');
  });

  it('④ esc 清搜索保位（by id 同行找回——全表 index 断言）+ 再 esc 退出', () => {
    const { picker, onSelect, onExit } = makePicker(sessions);
    picker.handleEvent(k('down')); // 全表 cursor 1（docs 行）
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'docs' }); // 过滤后 docs 行仍在光标位（id 相同）
    picker.handleEvent(k('escape')); // 清搜索退态保位
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('3 会话'); // 回非搜索态头行
    expect(text).not.toContain('匹配');
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('docs22222222'); // 保位=全表 index 1（若错归 0 则选 sea）
    picker.handleEvent(k('esc'));
    expect(onExit).toHaveBeenCalledTimes(1); // 再 esc 退出（旧退出键面仍在）
  });

  it('⑤ backspace 删尾逐键 + 空 query 驻留 + 空态再 backspace 退搜索', () => {
    const { picker } = makePicker(sessions);
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'docs' });
    picker.handleEvent(k('backspace')); // 'doc'
    let text = paintAll(picker, 70, 8);
    expect(text).toContain('· 1/3 匹配 · doc');
    picker.handleEvent(k('backspace'));
    picker.handleEvent(k('backspace'));
    picker.handleEvent(k('backspace')); // → ''（'docs' 四键删空）
    text = paintAll(picker, 70, 8);
    expect(text).toContain('· 3/3 匹配 ·'); // 空 query 驻留（不弹回非搜索态）
    picker.handleEvent(k('backspace')); // 空态再删 = 退搜索
    text = paintAll(picker, 70, 8);
    expect(text).toContain('3 会话');
    expect(text).not.toContain('匹配');
  });

  it('⑥ query 变更 cursor 归 0 + 预览联动拉过滤表光标行（行源 visible 单源）', () => {
    const rig = deferredPreview();
    const { picker, onSelect } = makePicker(sessions, { onPreview: rig.onPreview });
    picker.handleEvent(k('tab')); // 展开拉光标行 sea（第 1 笔——loading 在飞不双发）
    expect(rig.calls).toEqual(['sea111111111']);
    enterSearch(picker); // cursor 0=sea——在飞不双发
    expect(rig.calls).toEqual(['sea111111111']);
    picker.handleEvent({ kind: 'text', text: '写' }); // 过滤 [docs]——afterQueryChanged 联动拉新光标行
    expect(rig.calls).toEqual(['sea111111111', 'docs22222222']); // 缺联动则 1 笔红；行源漏换 sessions 则重拉 sea 红
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('docs22222222'); // 收缩后光标行合法可达（归 0/夹取路径）
  });

  it('⑦ 空结果：「（无匹配会话）」行 + 导航/enter 零动作 + esc 仍可退搜索', () => {
    const { picker, onSelect } = makePicker(sessions);
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'nomatch' });
    let text = paintAll(picker, 70, 8);
    expect(text).toContain('· 0/3 匹配 · nomatch');
    expect(text).toContain('（无匹配会话）');
    expect(text).toContain('输入过滤'); // 空匹配 hint 只剩输入过滤 + esc 清搜索
    expect(text).not.toContain('enter 切换'); // 无可选项——切换段退场
    expect(picker.handleEvent(k('down'))).toBe(true); // 吞而不炸
    picker.handleEvent(k('up'));
    picker.handleEvent(k('enter'));
    expect(onSelect).not.toHaveBeenCalled(); // 零匹配 enter 不选
    picker.handleEvent(k('escape'));
    text = paintAll(picker, 70, 8);
    expect(text).toContain('3 会话'); // esc 退搜索回全表
  });

  it('⑧ enter 选定过滤表光标行（非全表行）', () => {
    const { picker, onSelect, onExit } = makePicker(sessions);
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: '写' }); // 过滤后唯一行 docs
    picker.handleEvent(k('enter'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('docs22222222');
  });

  it('⑨ tab 预览 toggle 仍效 + 导航键走过滤表', () => {
    const rig = deferredPreview();
    const { picker } = makePicker(sessions, { onPreview: rig.onPreview });
    enterSearch(picker);
    picker.handleEvent({ kind: 'text', text: 'e' }); // 'e' 命中 sea（shortId 'sea11111'）+ docs（basename 'webapp'）
    let text = paintAll(picker, 70, 8);
    expect(text).toContain('· 2/3 匹配 · e');
    picker.handleEvent(k('down')); // 过滤表 cursor 0→1（docs）
    picker.handleEvent(k('tab')); // 展开拉过滤表光标行
    expect(rig.calls).toEqual(['docs22222222']); // 走过滤表非全表（全表 cursor 1 也是 docs——down 两次更证）
    picker.handleEvent(k('down')); // 过滤表两行——down 环绕回 sea
    expect(rig.calls).toEqual(['docs22222222', 'sea111111111']); // 联动拉 sea（全表则 cursor 2 = zzz 无 e 命中态矛盾）
    text = paintAll(picker, 70, 12);
    expect(text).toContain('加载中…'); // toggle 展开仍效
    picker.handleEvent(k('tab')); // 再 tab 收起
    expect(paintAll(picker, 70, 12)).not.toContain('加载中');
  });

  it('⑩ 双轨输入：key 轨单字符与 text 轨粘贴各达 query', () => {
    const { picker } = makePicker(sessions);
    enterSearch(picker);
    picker.handleEvent(k('w')); // key 轨
    picker.handleEvent(k('e')); // key 轨
    picker.handleEvent({ kind: 'text', text: 'bapp' }); // text 轨续接
    const text = paintAll(picker, 70, 8);
    expect(text).toContain('· 1/3 匹配 · webapp'); // 三段拼合
  });

  it('⑪ 空表 ' + "'/'" + ' 不进搜索态（无会话可搜——hint 仍返回段）', () => {
    const { picker } = makePicker([]);
    picker.handleEvent(k('/'));
    const text = paintAll(picker, 70, 6);
    expect(text).toContain('无会话');
    expect(text).not.toContain('匹配');
    expect(text).not.toContain('输入过滤');
    picker.handleEvent({ kind: 'text', text: 'x' }); // 追加零炸（不进态不吞——q 返回键面让位）
    expect(paintAll(picker, 70, 6)).toContain('无会话');
  });
});

/* ---------------- 'o' 开史（挖掘 50 轮件 C——光标行完整史两段开合 + 光标复原） ---------------- */

describe('SessionPicker ' + "'o'" + ' 开史（挖掘 50 轮件 C）', () => {
  const sessions = [row({ id: 'aaa111111111' }), row({ id: 'bbb222222222', active: true })];

  /** 全屏读（删除/打字搜索 describe paintAll 同形） */
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

  it("① 'o' 回调：光标行 id + 当时光标位双参上浮；面板不自杀收屏（收归 backend 包装位）", () => {
    const calls: Array<[string, number]> = [];
    const { picker, onExit } = makePicker(sessions, {
      onOpenHistory: (id, cursorAt) => calls.push([id, cursorAt]),
    });
    picker.handleEvent(k('down')); // 光标 → 1
    expect(picker.handleEvent(k('o'))).toBe(true);
    expect(calls).toEqual([['bbb222222222', 1]]); // id + cursorAt 双参（cursorAt 供退出复原切换器）
    expect(onExit).not.toHaveBeenCalled(); // 不自杀——收屏归 backend 透传包装位（即收形）
  });

  it("② 注入缺席 'o' 无效零行为变（吞而不动作——'d' 删除键同律）", () => {
    const { picker, onSelect } = makePicker(sessions);
    expect(picker.handleEvent(k('o'))).toBe(true); // 吞
    expect(onSelect).not.toHaveBeenCalled(); // 零行为变
    expect(picker.handleEvent(k('enter'))).toBe(true); // 面板仍活——enter 照常
    expect(onSelect).toHaveBeenCalledWith('aaa111111111');
  });

  it('③ initialCursor 复原位：构造后首帧光标 = 复原位行；超界值夹到末行（修前红：构造直赋无夹取——超界 enter 即 TypeError 杀面板）', () => {
    const { picker, onSelect } = makePicker(sessions, { initialCursor: 1 });
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('bbb222222222'); // 复原位生效
    // 超界夹取（冷读清偿 P1——render 路 clampOffset 只夹 offset 从不写 cursor，界内恒定靠变更位自守）
    const far = makePicker(sessions, { initialCursor: 999 });
    expect(far.picker.handleEvent(k('enter'))).toBe(true); // 修前：visible[999]! 越界 undefined TypeError
    expect(far.onSelect).toHaveBeenCalledWith('bbb222222222'); // 夹到末行非越界炸
  });

  it("④ kitty text 轨 'o' 同律（双轨收键）+ 搜索态 'o' 归输入非触发", () => {
    const calls: Array<[string, number]> = [];
    const { picker } = makePicker(sessions, {
      onOpenHistory: (id, cursorAt) => calls.push([id, cursorAt]),
    });
    picker.handleEvent({ kind: 'text', text: 'o' }); // text 轨（kitty disambiguate——'d' 双轨先例同形）
    expect(calls).toEqual([['aaa111111111', 0]]);
    picker.handleEvent(k('/')); // 进搜索态
    picker.handleEvent(k('o')); // key 轨 'o' 归输入（搜索态键面避让）
    picker.handleEvent({ kind: 'text', text: 'o' }); // text 轨同律归输入
    expect(calls.length).toBe(1); // 非触发
    expect(paintAll(picker, 70, 8)).toContain('0/2 匹配'); // 'o' 入 query（语料无 o 命中——归输入铁证）
  });

  it("⑤ hint 段在场律与段序：注入在场才显 'o 开史'（'d 删除' 后 'q/esc 返回' 前）；搜索态换「输入过滤」面无该段", () => {
    const withOpen = makePicker(sessions, { onOpenHistory: vi.fn() });
    expect(paintAll(withOpen.picker, 70, 8)).toContain('o 开史');
    const withoutOpen = makePicker(sessions);
    expect(paintAll(withoutOpen.picker, 70, 8)).not.toContain('o 开史'); // 缺席不注记
    // 段序锁（段收集 IIFE——窄窗 fitLine 尾段让位时退出键面排末位最后丢）
    const both = makePicker(sessions, { onDelete: vi.fn(), onOpenHistory: vi.fn() });
    const text = paintAll(both.picker, 70, 8);
    expect(text.indexOf('d 删除')).toBeLessThan(text.indexOf('o 开史'));
    expect(text.indexOf('o 开史')).toBeLessThan(text.indexOf('q/esc 返回'));
    withOpen.picker.handleEvent(k('/')); // 搜索态 hint 换「输入过滤」面
    const search = paintAll(withOpen.picker, 70, 8);
    expect(search).toContain('输入过滤');
    expect(search).not.toContain('o 开史');
  });
});

// ── 分页加载面（挖掘 51 轮件 A——近底续页拉 + 占位行三态；注入缺席零分页零占位）──
describe('SessionPicker 分页加载（续页拉）', () => {
  /** 12 行集（视口 7 于 60×10——头底各 1 + 占位 1；距底 12-7=5 恰达阈值） */
  const many = Array.from({ length: 12 }, (_, i) => row({ id: `pg-${i}-00000000`, title: `会话${i}` }));

  /** 手控续页回执 rig（deferred——rows/nextCursor 由测试注入落位） */
  function deferredPage() {
    let settle!: (page: { rows: readonly UiSessionSummary[]; nextCursor: string | null }) => void;
    const calls: string[] = [];
    const promise = new Promise<{ rows: readonly UiSessionSummary[]; nextCursor: string | null }>((resolve) => {
      settle = resolve;
    });
    return {
      calls,
      onLoadMore: (cursor: string) => {
        calls.push(cursor);
        return promise;
      },
      settle,
    };
  }

  /** 定视口渲染（60×10——viewportHeight 回写 7：头 1 + 清单视口 + 占位 1 + 底 1） */
  const paintViewport = (picker: SessionPicker): string => {
    const grid = new CellGrid(60, 10);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 10 });
    const lines: string[] = [];
    for (let r = 0; r < 10; r++) {
      let out = '';
      for (let c = 0; c < 60; c++) out += grid.getCell(r, c)?.grapheme ?? ' ';
      lines.push(out.trimEnd());
    }
    return lines.join('\n');
  };

  it('近底触发：视口距底 ≤5 任一导航键发 onLoadMore（cursor 实参 = 首拉续页位）+ 量高恒 +1', () => {
    const rig = deferredPage();
    const { picker } = makePicker(many, { onLoadMore: rig.onLoadMore, moreCursor: 'c-first' });
    expect(picker.measure(60)).toBe(1 + 12 + 1 + 1); // 头 + 全量清单 + 占位 + 底（分页在场恒 1 行）
    paintViewport(picker); // viewportHeight 回写（首键判据的窗口账）
    picker.handleEvent(k('down'));
    expect(rig.calls).toEqual(['c-first']); // 正向断言（注入缺席时恒未被调——修前红锚）
  });

  it('占位三态：有续页「↓ 加载更早…」→ 在飞「加载中…」→ 终态「已到最早」', async () => {
    const rig = deferredPage();
    const repaint = vi.fn();
    const { picker } = makePicker(many, { onLoadMore: rig.onLoadMore, moreCursor: 'c1', requestRepaint: repaint });
    expect(paintViewport(picker)).toContain('↓ 加载更早…');
    picker.handleEvent(k('down')); // 触发（在飞）
    expect(rig.calls).toEqual(['c1']);
    expect(paintViewport(picker)).toContain('加载中…');
    rig.settle({ rows: [], nextCursor: null }); // 空页终态
    await Promise.resolve(); // 异步落位微任务冲刷（.then 链）
    await Promise.resolve();
    const text = paintViewport(picker);
    expect(text).toContain('已到最早');
    expect(text).not.toContain('↓ 加载更早…');
    expect(repaint).toHaveBeenCalled(); // 回执落位请帧
  });

  it('回执 append 去重（既有 id 不双入）+ moreCursor 更新后二次触发走新位', async () => {
    const rig = deferredPage();
    const { picker } = makePicker(many, { onLoadMore: rig.onLoadMore, moreCursor: 'c1' });
    paintViewport(picker);
    picker.handleEvent(k('down'));
    rig.settle({
      rows: [many[0]!, row({ id: 'pg-new-00000000', title: '新页行' })], // 首行重复 + 一新行
      nextCursor: 'c2',
    });
    await Promise.resolve();
    await Promise.resolve();
    const text = paintViewport(picker);
    expect(text).toContain('13 会话'); // 12 - 0（去重后只加 1 新行）= 13（头行 N 随 visible 涨）
    expect(text).toContain('↓ 加载更早…'); // 续页位 c2 仍在
    picker.handleEvent(k('down')); // 距底 13-7=6 > 阈值——不触发（阈值门诚实）
    expect(rig.calls).toEqual(['c1']);
    picker.handleEvent(k('end')); // 滚到底（距底 0）——二次触发走新位
    expect(rig.calls).toEqual(['c1', 'c2']);
  });

  it('在飞单飞锁：回执落位前再按键不双发', () => {
    const rig = deferredPage();
    const { picker } = makePicker(many, { onLoadMore: rig.onLoadMore, moreCursor: 'c1' });
    paintViewport(picker);
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 在飞再按键
    picker.handleEvent(k('end'));
    expect(rig.calls).toEqual(['c1']);
  });

  it('搜索态不触发（过滤表是窗内子集——全表分页与过滤正交）', () => {
    const rig = deferredPage();
    const { picker } = makePicker(many, { onLoadMore: rig.onLoadMore, moreCursor: 'c1' });
    paintViewport(picker);
    picker.handleEvent(k('/')); // 进搜索态（query 空 = 全匹配形）
    picker.handleEvent(k('down')); // 导航仍效走过滤表——经 moveCursor 但搜索态门挡
    picker.handleEvent(k('end'));
    expect(rig.calls).toEqual([]);
  });

  it('注入缺席零占位零触发（现状锁）+ 头行截断尾注保留', () => {
    const { picker } = makePicker(many, { totalCount: 20 });
    expect(picker.measure(60)).toBe(1 + 12 + 1); // 无占位行（现状原高）
    const text = paintViewport(picker);
    expect(text).not.toContain('加载更早');
    expect(text).not.toContain('已到最早');
    expect(text).toContain('12/20 会话（仅显示最近）'); // B2 注记保留（注入缺席律）
    picker.handleEvent(k('down'));
    picker.handleEvent(k('end'));
  });

  it('分页在场头行去截断尾注（更早可达——N/M 披露保真、谎句摘除）', () => {
    const rig = deferredPage();
    const { picker } = makePicker(many, {
      onLoadMore: rig.onLoadMore,
      moreCursor: 'c1',
      totalCount: 20,
    });
    const text = paintViewport(picker);
    expect(text).toContain('12/20 会话');
    expect(text).not.toContain('仅显示最近');
  });
});

describe('SessionPicker 归档与视图切换（53 轮件 B——位翻非删行、归档纯视图性）', () => {
  /** 三行集（甲乙丙——就地滤行断言用） */
  const three = [
    row({ id: 'ar-a-00000000', title: '甲' }),
    row({ id: 'ar-b-00000000', title: '乙' }),
    row({ id: 'ar-c-00000000', title: '丙' }),
  ];
  /** 已归档行集（归档视图行） */
  const archivedRows = [row({ id: 'ar-x-00000000', title: '旧档' }), row({ id: 'ar-y-00000000', title: '老档' })];

  /** 全屏读（本 describe 内单源） */
  function paint(picker: SessionPicker, width = 70, height = 10): string {
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

  /** 手控归档回执 rig（deferred——status 由测试注入落位） */
  function deferredArchive() {
    let settle!: (status: UiSessionArchiveResult) => void;
    const calls: Array<[string, boolean]> = [];
    const promise = new Promise<UiSessionArchiveResult>((resolve) => {
      settle = resolve;
    });
    return {
      calls,
      onArchive: (sessionId: string, archive: boolean) => {
        calls.push([sessionId, archive]);
        return promise;
      },
      settle,
    };
  }

  /** 手控视图切换 rig */
  function deferredSwitch(rows: readonly UiSessionSummary[], total: number, nextCursor: string | null = null) {
    let settle!: () => void;
    const calls: string[] = [];
    const promise = new Promise<{ rows: readonly UiSessionSummary[]; nextCursor: string | null; total: number }>(
      (resolve) => {
        settle = () => resolve({ rows, nextCursor, total });
      },
    );
    return {
      calls,
      onSwitchView: (view: 'active' | 'archived') => {
        calls.push(view);
        return promise;
      },
      settle,
    };
  }

  it("'a' 归档光标行（key 轨）：成功就地滤行 + totalCount −1 调账 + 请帧；免确认（'d' 确认视图族对照）", async () => {
    const rig = deferredArchive();
    const repaint = vi.fn();
    // totalCount 超清单长（M>N 恒走 N/M 披露形——调账经 M 位可断言；M==N
    // 原形「N 会话」无区分度）+ 分页在场档（真装配恒在场——截断尾注让位）
    const { picker } = makePicker(three, {
      onArchive: rig.onArchive,
      totalCount: 5,
      requestRepaint: repaint,
      onLoadMore: () => Promise.resolve({ rows: [], nextCursor: null }),
      moreCursor: null,
    });
    picker.handleEvent(k('down')); // 光标 1（乙）
    expect(picker.handleEvent(k('a'))).toBe(true);
    expect(rig.calls).toEqual([['ar-b-00000000', true]]); // 修前红锚：'a' 键零动作
    rig.settle({ status: 'archived' });
    await Promise.resolve();
    await Promise.resolve();
    const text = paint(picker);
    expect(text).not.toContain('乙'); // 就地滤行
    expect(text).toContain('甲');
    expect(text).toContain('丙');
    expect(text).toContain('2/4 会话'); // totalCount 本地 −1 调账（5−1——M 位直读）
    expect(repaint).toHaveBeenCalled();
  });

  it("kitty text 轨 'a' 同律（双轨收键）；光标夹取：滤行后 cursor clamp 到余表", async () => {
    const rig = deferredArchive();
    const { picker, onSelect } = makePicker(three, { onArchive: rig.onArchive });
    picker.handleEvent(k('end')); // 光标 2（丙——末行）
    picker.handleEvent({ kind: 'text', text: 'a' } as never);
    expect(rig.calls).toEqual([['ar-c-00000000', true]]);
    rig.settle({ status: 'archived' });
    await Promise.resolve();
    await Promise.resolve();
    // 末行滤除后光标 clamp 到新末行（乙）——enter 取 clamp 后行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('ar-b-00000000');
  });

  it("'a' 在飞单飞锁：回执落位前重复 'a' 吞（不双发）", () => {
    const rig = deferredArchive();
    const { picker } = makePicker(three, { onArchive: rig.onArchive });
    picker.handleEvent(k('a'));
    picker.handleEvent(k('a'));
    expect(rig.calls).toHaveLength(1);
  });

  it('missing 回执：行不动（warn 归核路由——面板只守行不动）', async () => {
    const rig = deferredArchive();
    const { picker } = makePicker(three, { onArchive: rig.onArchive });
    picker.handleEvent(k('a'));
    rig.settle({ status: 'missing' });
    await Promise.resolve();
    await Promise.resolve();
    expect(paint(picker)).toContain('甲');
    expect(paint(picker)).toContain('乙');
  });

  it("归档回调异常防御：吞不炸面板（行不动）；onArchive 注入缺席 'a' 吞零动作", async () => {
    const failing = vi.fn(() => Promise.reject(new Error('库炸了')));
    const { picker } = makePicker(three, { onArchive: failing });
    expect(picker.handleEvent(k('a'))).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(paint(picker)).toContain('甲'); // 行不动面板不炸
    const bare = makePicker(three);
    expect(bare.picker.handleEvent(k('a'))).toBe(true); // 缺席吞（不炸）
  });

  it("'s' 视图切换：行集整替 + total 更新 + 头行「已归档」注记 + cursor 归零；搜索态 's' 归输入让位；text 轨同律", async () => {
    const rig = deferredSwitch(archivedRows, 7);
    const { picker } = makePicker(three, {
      onSwitchView: rig.onSwitchView,
      totalCount: 3,
      onLoadMore: () => Promise.resolve({ rows: [], nextCursor: null }),
      moreCursor: null,
    });
    picker.handleEvent(k('down')); // 光标 1
    expect(picker.handleEvent(k('s'))).toBe(true);
    expect(rig.calls).toEqual(['archived']); // 修前红锚：'s' 键零动作
    rig.settle();
    await Promise.resolve();
    await Promise.resolve();
    const text = paint(picker);
    expect(text).toContain('已归档'); // 头行注记
    expect(text).toContain('旧档');
    expect(text).toContain('老档');
    expect(text).not.toContain('甲'); // 行集整替
    expect(text).toContain('2/7 会话'); // 视图域 total（截断披露如实）
    // cursor 归零：光标 › 落归档视图首行（旧档）
    expect(text.split('\n').some((l) => l.includes('›') && l.includes('旧档'))).toBe(true);
    // 搜索态 's' 归输入让位（43 轮 q/d/'/' 让位律扩员——非切换键）
    picker.handleEvent(k('/'));
    picker.handleEvent(k('s'));
    expect(rig.calls).toEqual(['archived']); // 未触发第二次切换
    expect(paint(picker)).toContain('匹配 · s'); // 's' 归输入（过滤词进头行）
    // esc 清搜索后 text 轨 's' 同律切回（kitty 双轨收键；stub 回执复用如实
    // 呈现——行集整替语义已由 key 轨首段锁，此处锁触发与视图位翻）
    picker.handleEvent(k('escape'));
    picker.handleEvent({ kind: 'text', text: 's' } as never);
    expect(rig.calls).toEqual(['archived', 'active']);
    await Promise.resolve();
    await Promise.resolve();
    const back = paint(picker);
    expect(back).not.toContain('（已归档）'); // 视图位翻回（注记随视图）
    expect(back).toContain('s 归档视图'); // hint 段词随视图位（active 向）
  });

  it('归档视图内：a = 恢复（archive=false + 滤行 + total −1）+ enter = 恢复（不 onSelect 不收屏）', async () => {
    const rig = deferredArchive();
    const sw = deferredSwitch(archivedRows, 3);
    const { picker, onSelect, onExit } = makePicker(three, {
      onArchive: rig.onArchive,
      onSwitchView: sw.onSwitchView,
      totalCount: 3,
      onLoadMore: () => Promise.resolve({ rows: [], nextCursor: null }),
      moreCursor: null,
    });
    picker.handleEvent(k('s'));
    sw.settle();
    await Promise.resolve();
    await Promise.resolve();
    // 归档视图 'a' = 恢复
    picker.handleEvent(k('a'));
    expect(rig.calls).toEqual([['ar-x-00000000', false]]);
    rig.settle({ status: 'unarchived' });
    await Promise.resolve();
    await Promise.resolve();
    expect(paint(picker)).not.toContain('旧档'); // 恢复即滤行（离归档视图）
    expect(paint(picker)).toContain('老档');
    expect(paint(picker)).toContain('1/2 会话'); // 行离当前视图恒 −1（归档域 total 3−1）
    // 归档视图 enter = 恢复（免确认；面板保持开）
    expect(onSelect).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('归档视图 enter = 恢复（onArchive 在场时；不 onSelect），缺席回落 onSelect 切焦', async () => {
    const rig = deferredArchive();
    const sw = deferredSwitch(archivedRows, 2);
    const { picker, onSelect } = makePicker(three, {
      onArchive: rig.onArchive,
      onSwitchView: sw.onSwitchView,
    });
    picker.handleEvent(k('s'));
    sw.settle();
    await Promise.resolve();
    await Promise.resolve();
    picker.handleEvent(k('enter'));
    expect(rig.calls).toEqual([['ar-x-00000000', false]]); // enter 恢复向（非 onSelect）
    expect(onSelect).not.toHaveBeenCalled();
    rig.settle({ status: 'unarchived' });
    await Promise.resolve();
    await Promise.resolve();
    // 缺席回落：无 onArchive 注入的归档视图 enter 走 onSelect
    const sw2 = deferredSwitch(archivedRows, 2);
    const bare = makePicker(three, { onSwitchView: sw2.onSwitchView });
    bare.picker.handleEvent(k('s'));
    sw2.settle();
    await Promise.resolve();
    await Promise.resolve();
    bare.picker.handleEvent(k('enter'));
    expect(bare.onSelect).toHaveBeenCalledWith('ar-x-00000000');
  });

  it("归档视图 'o' 不效（M1 裁——reopen 只携带活跃快照）；hint 分档如实（'enter 恢复'/'a 恢复'/'s 活跃视图' 注记、'o 开史' 段摘除）", async () => {
    const openHistory = vi.fn();
    const rig = deferredArchive();
    const sw = deferredSwitch(archivedRows, 2);
    const { picker } = makePicker(three, {
      onArchive: rig.onArchive,
      onSwitchView: sw.onSwitchView,
      onOpenHistory: openHistory,
    });
    picker.handleEvent(k('s'));
    sw.settle();
    await Promise.resolve();
    await Promise.resolve();
    picker.handleEvent(k('o'));
    expect(openHistory).not.toHaveBeenCalled(); // 归档视图 'o' 不效
    const text = paint(picker);
    expect(text).toContain('enter 恢复');
    expect(text).toContain('a 恢复');
    expect(text).toContain('s 活跃视图');
    expect(text).not.toContain('o 开史');
  });

  it("hint 注记（活跃视图）：'a 归档'/'s 归档视图' 注记（注入在场）；两注入缺席不注记不虚报", () => {
    const rig = deferredArchive();
    const sw = deferredSwitch(archivedRows, 2);
    const { picker } = makePicker(three, { onArchive: rig.onArchive, onSwitchView: sw.onSwitchView });
    const text = paint(picker);
    expect(text).toContain('a 归档');
    expect(text).toContain('s 归档视图');
    expect(text).toContain('enter 切换'); // 活跃视图 enter 语义不变
    const bare = makePicker(three);
    const bareText = paint(bare.picker);
    expect(bareText).not.toContain('a 归档');
    expect(bareText).not.toContain('s 归档视图');
  });

  it('空表可切视图：活跃空表 ' + "'s' 仍效（归档行可达）；归档空表 hint 含切回段", async () => {
    const sw = deferredSwitch(archivedRows, 2);
    const { picker } = makePicker([], { onSwitchView: sw.onSwitchView });
    expect(picker.handleEvent(k('s'))).toBe(true); // 空表 's' 仍效（可见门外的视图键）
    sw.settle();
    await Promise.resolve();
    await Promise.resolve();
    const text = paint(picker);
    expect(text).toContain('旧档'); // 归档行到达
    // 归档空表（切到空归档视图）：hint 含 's 活跃视图' 切回段
    const swEmpty = deferredSwitch([], 0);
    const p2 = makePicker(three, { onSwitchView: swEmpty.onSwitchView });
    p2.picker.handleEvent(k('s'));
    swEmpty.settle();
    await Promise.resolve();
    await Promise.resolve();
    const text2 = paint(p2.picker);
    expect(text2).toContain('已归档');
    expect(text2).toContain('无会话');
    expect(text2).toContain('s 活跃视图');
  });

  it('视图切换异常防御：吞不炸面板（行集不动回原视图）', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('库炸了')));
    const { picker } = makePicker(three, { onSwitchView: failing });
    picker.handleEvent(k('s'));
    await Promise.resolve();
    await Promise.resolve();
    const text = paint(picker);
    expect(text).toContain('甲'); // 行集不动
    expect(text).not.toContain('已归档'); // 视图未切
  });
});
