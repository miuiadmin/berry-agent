/**
 * 件 8 /history 回看器单测（批 10f-4 特性腿）。
 *
 * 覆盖：行集构建（同一渲染管线——user 前缀 / markdown 样式 / ⚙ dim 段）、
 * 快照档 v1（构造后静态——外数组变更不进副屏）、开屏贴尾与键盘滚动、
 * 搜索三动作（开 / 跳匹配循环 / 关——查询保留续搜 + 不区分大小写 + 当前
 * 匹配反色高亮）、退出让位判据（搜索在场 q 不退出）、副屏键面补丁
 * （Ctrl+C 打断滤 release / Ctrl+D 先收副屏再退 + 空框闸）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, type CellBuffer, type InputEvent } from '../../engine/index.js';
import { HistoryViewer } from './history-viewer.js';
import type { AgentMessage } from '../../../contracts/index.js';

/* ---------------- 工厂与便捷 ---------------- */

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
const SESSION = 'sess-aaaaaaaaaa';

function userMsg(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 1 };
}

function assistantMsg(
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [],
): AgentMessage {
  return {
    role: 'assistant',
    content: [
      ...(text !== '' ? [{ type: 'text' as const, text }] : []),
      ...toolCalls.map((call) => ({ type: 'toolCall' as const, ...call })),
    ],
    usage,
    stopReason: 'stop',
    timestamp: 1,
  };
}

/** 键事件便捷构造（kitty disambiguate 轨形） */
function key(
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; phase?: 'press' | 'repeat' | 'release' } = {},
): InputEvent {
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

/** 文本事件（纯键打字在 kitty 轨走 text 事件） */
function text(t: string): InputEvent {
  return { kind: 'text', text: t };
}

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellBuffer, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 读回正文行（剔除滚动条列——溢出档右列 thumb 不入断言面） */
function readBody(grid: CellBuffer, row: number): string {
  return readRow(grid, row, COLS - 1).trimEnd();
}

const COLS = 40;
const ROWS = 10;

/** 装配：事件副作用经 log 串账（exit / interrupt / quit 三柄时序可断言） */
function rig(messages: readonly AgentMessage[], rows = ROWS) {
  const log: string[] = [];
  const viewer = new HistoryViewer({
    sessionId: SESSION,
    messages,
    columns: COLS,
    onExit: () => log.push('exit'),
    onInterrupt: (id) => log.push(`interrupt:${id}`),
    onQuit: () => log.push('quit'),
  });
  const render = (): CellGrid => {
    const grid = new CellGrid(COLS, rows);
    viewer.render(grid, { row: 0, col: 0, width: COLS, height: rows });
    return grid;
  };
  return { viewer, log, render };
}

/** n 条 user 消息（行集 n 行：m0..m(n-1)） */
function manyUsers(n: number): AgentMessage[] {
  return Array.from({ length: n }, (_, i) => userMsg(`m${i}`));
}

/* ---------------- 行集构建 ---------------- */

describe('回看器行集构建（同一渲染管线——零第二渲染器）', () => {
  it('头行 = 档名 + 会话短 id；正文 = user 前缀 + markdown 定稿（同主屏形）', () => {
    const { render } = rig([userMsg('甲'), assistantMsg('# 标题')]);
    const grid = render();
    expect(readRow(grid, 0, COLS)).toContain('↩ 历史回看 · sess-aaa'); // 会话短 id 在头行
    expect(readRow(grid, 1, COLS)).toBe('> 甲'); // user 块 '> ' 前缀
    expect(readRow(grid, 2, COLS)).toContain('标题'); // markdown 定稿块
    expect(readRow(grid, ROWS - 1, COLS)).toContain('q/esc 返回'); // 底行键面提示
  });

  it('⚙ 工具行 dim 样式段进副屏（带样式写出的 cell 级证据）', () => {
    const { render } = rig([assistantMsg('', [{ id: 't1', name: 'read', arguments: { path: 'x' } }])]);
    const grid = render();
    const row = readRow(grid, 1, COLS);
    expect(row).toContain('⚙ read(path)');
    // 「 ⚙」起首即 dim 段（run 覆写经 writeSlice 落 cell 样式）
    const cell = grid.getCell(1, row.indexOf('⚙'));
    expect(cell?.style.dim).toBe(true);
  });

  it('markdown H1 bold 样式保留（样式段经 gridRowToStyled 全程不丢）', () => {
    const { render } = rig([assistantMsg('# 标题')]);
    const grid = render();
    const row = readRow(grid, 1, COLS);
    const cell = grid.getCell(1, row.indexOf('标'));
    expect(cell?.style.bold).toBe(true);
  });

  it('快照档 v1：构造后静态——外数组再变更不进副屏（回看期新事件不进副屏）', () => {
    const messages = [userMsg('甲')];
    const { viewer, render } = rig(messages);
    messages.push(userMsg('乙')); // 构造后追加——行集是构造时快照
    const grid = render();
    expect(readRow(grid, 1, COLS)).toBe('> 甲');
    viewer.handleEvent(key('home'));
    expect(readRow(render(), 1, COLS)).toBe('> 甲'); // 全档滚动也只有快照行
    expect(readRow(render(), 2, COLS)).toBe(''); // 乙不在场
  });
});

/* ---------------- 开屏贴尾与键盘滚动 ---------------- */

describe('回看器滚动（ScrollView 装载——开屏贴尾 / 破随 / 翻页）', () => {
  it('开屏贴尾（follow 初始 true），↑ 破随、Home 到顶', () => {
    const { viewer, render } = rig(manyUsers(30));
    let grid = render(); // 30 行、视口 8（ROWS-2）→ offset 22
    expect(readBody(grid, 1)).toBe('> m22');
    expect(readBody(grid, 8)).toBe('> m29');
    expect(viewer.handleEvent(key('up'))).toBe(true);
    grid = render();
    expect(readBody(grid, 1)).toBe('> m21');
    expect(viewer.handleEvent(key('home'))).toBe(true);
    grid = render();
    expect(readBody(grid, 1)).toBe('> m0');
    expect(viewer.handleEvent(key('end'))).toBe(true); // End 复随贴尾
    expect(readBody(render(), 1)).toBe('> m22');
  });

  it('PgUp/PgDn 按视口高翻页', () => {
    const { viewer, render } = rig(manyUsers(30));
    render(); // offset 22、页高 8 回写
    viewer.handleEvent(key('home'));
    viewer.handleEvent(key('pagedown'));
    expect(readBody(render(), 1)).toBe('> m8');
    viewer.handleEvent(key('pageup'));
    expect(readBody(render(), 1)).toBe('> m0');
  });

  it('未消费键层内终局吞（模态——无穿透位）', () => {
    const { viewer } = rig(manyUsers(3));
    expect(viewer.handleEvent(text('x'))).toBe(true); // 常态文本键吞（非 q）
    expect(viewer.handleEvent(key('tab'))).toBe(true); // 未绑定键吞
  });
});

/* ---------------- 搜索三动作 ---------------- */

describe('回看器搜索（开 / 跳匹配 / 关——件 8 条款锁能力不锁键位）', () => {
  function searchRig() {
    const r = rig(manyUsers(30)); // m2 与 m20..m29 共 11 处含 'm2'
    return r;
  }

  it('开：搜索框在场（Editor 单行档三行铬）+ 计数 0/0 如实', () => {
    const { viewer, render } = searchRig();
    expect(viewer.handleEvent(key('f', { ctrl: true, shift: true }))).toBe(true);
    const grid = render();
    expect(grid.getCell(ROWS - 3, 0)?.grapheme).toBe('┌'); // 编辑器边框顶
    expect(grid.getCell(ROWS - 1, 0)?.grapheme).toBe('└'); // 边框底
    expect(readRow(grid, 0, COLS)).toContain('0/0'); // 空查询零匹配如实
  });

  it('跳：Enter 下一 / Shift+Enter 上一 / 循环（尾后回首）；视口对齐匹配行', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2')); // 查询 'm2' → 11 匹配、首匹配 m2
    let grid = render();
    expect(readRow(grid, 0, COLS)).toContain('1/11');
    expect(readBody(grid, 1)).toBe('> m2'); // 首匹配对齐视口顶
    viewer.handleEvent(key('enter')); // 下一 → m20
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('2/11');
    expect(readBody(grid, 1)).toBe('> m20');
    viewer.handleEvent(key('enter', { shift: true })); // 上一 → m2
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('1/11');
    viewer.handleEvent(key('enter', { shift: true })); // 首前往尾 → m29
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('11/11');
    // 末行匹配：偏移夹底——匹配在视口底行可见（搜索框在场视口缩至 6：顶 m24）
    expect(readBody(grid, 1)).toBe('> m24');
    expect(readBody(grid, 6)).toBe('> m29');
  });

  it('当前匹配反色高亮（writeSlice 样式叠加——段边界切割的 cell 级证据）', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2'));
    const grid = render();
    const row = readBody(grid, 1);
    expect(row).toBe('> m2');
    const m2At = row.indexOf('m2');
    expect(grid.getCell(1, m2At)?.style.inverse).toBe(true); // 匹配段反色
    expect(grid.getCell(1, m2At + 1)?.style.inverse).toBe(true);
    expect(grid.getCell(1, 0)?.style.inverse).toBeUndefined(); // 匹配外不染
  });

  it('不区分大小写匹配', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('M'));
    viewer.handleEvent(text('2'));
    expect(readRow(render(), 0, COLS)).toContain('1/11');
  });

  it('关：Esc 关搜索（不退副屏）+ 高亮清 + 查询保留续搜（重开即匹配）', () => {
    const { viewer, render, log } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2'));
    viewer.handleEvent(key('escape')); // 关搜索——让位判据的 Esc 面
    expect(log).toEqual([]); // 不退出
    const grid = render();
    expect(readRow(grid, ROWS - 1, COLS)).toContain('q/esc 返回'); // 底铬回提示行
    expect(readRow(grid, 0, COLS)).not.toContain('/11'); // 计数退场
    // 重开：查询保留（续搜）——立即 1/11 不必重打
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    expect(readRow(render(), 0, COLS)).toContain('1/11');
  });
});

/* ---------------- 让位判据与退出键 ---------------- */

describe('回看器退出（让位判据——搜索在场时不消费 q/Esc 退出义）', () => {
  it('搜索在场：q 落搜索框（打出字母 q）不退出；关搜索后 q 才退出', () => {
    const { viewer, log } = rig(manyUsers(5));
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('q')); // 让位判据：q 进框
    expect(log).toEqual([]);
    viewer.handleEvent(key('escape')); // 关搜索
    viewer.handleEvent(text('q')); // 常态 q → 退出
    expect(log).toEqual(['exit']);
    viewer.handleEvent(text('q')); // 闭锁——单次
    expect(log).toEqual(['exit']);
  });

  it('搜索关态：Esc 直接退出（闭锁单次）', () => {
    const { viewer, log } = rig(manyUsers(5));
    viewer.handleEvent(key('escape'));
    viewer.handleEvent(key('escape'));
    expect(log).toEqual(['exit']);
  });
});

/* ---------------- 副屏键面补丁（与主屏同键面） ---------------- */

describe('回看器副屏键面补丁', () => {
  it('Ctrl+C 打断在飞 run（携带会话位；滤 kitty release——press/repeat 相动作）', () => {
    const { viewer, log } = rig(manyUsers(5));
    viewer.handleEvent(key('c', { ctrl: true }));
    viewer.handleEvent(key('c', { ctrl: true, phase: 'release' })); // release 滤
    viewer.handleEvent(key('c', { ctrl: true, phase: 'repeat' })); // repeat 相动作
    expect(log).toEqual([`interrupt:${SESSION}`, `interrupt:${SESSION}`]);
  });

  it('Ctrl+D 退出：先收副屏（onExit）再转退出柄（onQuit）', () => {
    const { viewer, log } = rig(manyUsers(5));
    viewer.handleEvent(key('d', { ctrl: true }));
    expect(log).toEqual(['exit', 'quit']); // 顺序锁——先收副屏
  });

  it('Ctrl+D 空框闸：搜索框有文不退（与主屏同律）', () => {
    const { viewer, log } = rig(manyUsers(5));
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('x')); // 搜索框有文
    viewer.handleEvent(key('d', { ctrl: true }));
    expect(log).toEqual([]);
    viewer.handleEvent(key('backspace'));
    viewer.handleEvent(key('d', { ctrl: true })); // 清框后可退
    expect(log).toEqual(['exit', 'quit']);
  });
});
