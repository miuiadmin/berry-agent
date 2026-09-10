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
import { CellGrid, type CellBuffer, type InputEvent, type MouseEvent } from '../../engine/index.js';
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

/** 装配：事件副作用经 log 串账（exit / interrupt / quit 三柄时序可断言）+ onCopy 捕获（选区复制断言面） */
function rig(messages: readonly AgentMessage[], rows = ROWS) {
  const log: string[] = [];
  const copies: string[] = [];
  const viewer = new HistoryViewer({
    sessionId: SESSION,
    messages,
    columns: COLS,
    onExit: () => log.push('exit'),
    onInterrupt: (id) => log.push(`interrupt:${id}`),
    onQuit: () => log.push('quit'),
    onCopy: (text) => copies.push(text),
  });
  const render = (): CellGrid => {
    const grid = new CellGrid(COLS, rows);
    viewer.render(grid, { row: 0, col: 0, width: COLS, height: rows });
    return grid;
  };
  return { viewer, log, copies, render };
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

/* ---------------- 鼠标选区 + 滚轮（mu-2——07 件 8 细则） ---------------- */

describe('回看器鼠标选区（press 锚定 → motion 扩展 → release 复制）', () => {
  /** mouse 事件便捷构造（at = 全屏 region 行列——头行 0 / 视口 1..height-2 / 底铬末行） */
  function mouse(
    button: 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down',
    at: { row: number; col: number } = { row: 1, col: 0 },
    phase: 'press' | 'motion' | 'release' = 'press',
  ): MouseEvent {
    return {
      kind: 'mouse',
      button,
      phase,
      col: at.col,
      row: at.row,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };
  }

  /** 拖选三连（press → motion → release——多数用例的驱动骨架） */
  function drag(viewer: HistoryViewer, from: { row: number; col: number }, to: { row: number; col: number }): void {
    viewer.handleEvent(mouse('left', from, 'press'));
    viewer.handleEvent(mouse('left', to, 'motion'));
    viewer.handleEvent(mouse('left', to, 'release'));
  }

  it('线性选区全链：release 行间拼 LF 复制（中间行全文 · 首尾行按列切）', () => {
    // 10 行 / 视口 8 高——offset 贴尾 2：屏行 1..8 = 逻辑行 2..9
    const { viewer, copies, render } = rig(manyUsers(10));
    render(); // 视口几何回写（screenToLogical 的前提）
    drag(viewer, { row: 1, col: 2 }, { row: 3, col: 4 });
    expect(copies).toEqual(['m2\n> m3\n> m4']); // 行 2 从列 2、行 3 全文、行 4 到列 4
  });

  it('反向拖选规范化（锚在焦点后——升序两端点同一明文）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render();
    drag(viewer, { row: 3, col: 4 }, { row: 1, col: 2 });
    expect(copies).toEqual(['m2\n> m3\n> m4']);
  });

  it('CJK 双宽列反查：半格命中归字素首（与折叠算术同源）', () => {
    const { viewer, copies, render } = rig([userMsg('中文字')]); // 行 '> 中文字'：中 2-3 / 文 4-5 / 字 6-7
    render();
    drag(viewer, { row: 1, col: 3 }, { row: 1, col: 6 }); // col3 = 中的右半格 → 逻辑 2；col6 = 字首 → 逻辑 6
    expect(copies).toEqual(['中文']);
  });

  it('拖选中滚动坐标不漂：锚存逻辑位，滚后 motion 命中新逻辑行（渲染无关坐标系）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render(); // offset 2
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'press')); // 锚 = 逻辑行 2 列 0
    viewer.handleEvent(mouse('wheel-up')); // offset 2-3 → 夹 0（破随）
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'motion')); // 同屏位已是逻辑行 0 列 0
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'release'));
    expect(copies).toEqual(['> m0\n> m1\n']); // 行 0 全文 + 行 1 全文 + 行 2 列 0 空
  });

  it('选区高亮反色：press+motion 后视口内 inverse + release 后保留 + 下次 press 清除', () => {
    const { viewer, render } = rig(manyUsers(10));
    render();
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'press'));
    viewer.handleEvent(mouse('left', { row: 3, col: 4 }, 'motion'));
    const grid = render();
    expect(grid.getCell(1, 2)?.style.inverse).toBe(true); // 行 2 选中段（列 2 起至行尾）
    expect(grid.getCell(1, 0)?.style.inverse).toBeUndefined(); // 行 2 前缀未选
    expect(grid.getCell(2, 0)?.style.inverse).toBe(true); // 行 3 全文选中
    expect(grid.getCell(3, 3)?.style.inverse).toBe(true); // 行 4 选中段（列 0..3）
    viewer.handleEvent(mouse('left', { row: 3, col: 4 }, 'release'));
    expect(render().getCell(1, 2)?.style.inverse).toBe(true); // release 后高亮保留
    viewer.handleEvent(mouse('left', { row: 5, col: 2 }, 'press')); // 新选区起手 = 清除位
    const grid2 = render();
    expect(grid2.getCell(1, 2)?.style.inverse).toBeUndefined(); // 旧选区已清
    expect(grid2.getCell(5, 2)?.style.inverse).toBeUndefined(); // 新锚零宽不高亮
  });

  it('选区帽 64 KiB：超帽拒复制 + 底行提示常显至选区清除（拖选中滚轮扩选达帽）', () => {
    // 三条 30000 字符长行（各折 ~770 视觉行）——锚在尾屏、滚到顶再扩焦点，
    // 中间行全文计入 → 总量 ~87 KiB 越帽（纯视口内拖选受折宽约束达不到帽）
    const long = (ch: string): AgentMessage => userMsg(ch.repeat(30000));
    const { viewer, copies, render } = rig([long('x'), long('y'), long('z')]);
    render(); // ~2310 视觉行贴尾
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'press')); // 锚 = 行 2 尾段列 ~29718
    for (let i = 0; i < 800; i++) viewer.handleEvent(mouse('wheel-up')); // 滚到顶
    viewer.handleEvent(mouse('left', { row: 8, col: 3 }, 'motion')); // 焦点 = 行 0 首段列 ~276
    viewer.handleEvent(mouse('left', { row: 8, col: 3 }, 'release'));
    expect(copies).toEqual([]); // 超帽拒复制
    expect(readRow(render(), ROWS - 1, COLS)).toContain('选区过大未复制'); // 底行提示
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'press')); // 下次 press = 清除位
    expect(readRow(render(), ROWS - 1, COLS)).toContain('q/esc 返回'); // 回常态键面提示
    expect(copies).toEqual([]); // 全程零复制
  });

  it('搜索框在场拖选禁用（输入模态优先）——滚轮仍照常滚', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render(); // offset 2
    viewer.handleEvent(key('f', { ctrl: true, shift: true })); // 开搜索
    drag(viewer, { row: 1, col: 2 }, { row: 3, col: 4 });
    expect(copies).toEqual([]); // 禁拖选
    expect(viewer.handleEvent(mouse('wheel-up'))).toBe(true); // 滚轮仍滚（走 super 消费路）
    expect(viewer.scrollOffset).toBe(0); // 2-3 夹 0——搜索在场不拦滚动
  });

  it('视口外命中零动作：头行 / 底铬 / 滚动条列不建锚（后续 motion/release 零复制）', () => {
    const { viewer, copies, render } = rig(manyUsers(10)); // 溢出档——末列 39 为滚动条
    render();
    // 头行（row 0）
    drag(viewer, { row: 0, col: 2 }, { row: 1, col: 2 });
    // 底铬（row 9 = 提示行）
    drag(viewer, { row: 9, col: 2 }, { row: 1, col: 2 });
    // 滚动条列（col 39）
    drag(viewer, { row: 1, col: 39 }, { row: 1, col: 2 });
    expect(copies).toEqual([]);
  });

  it('中 / 右键零动作吞（v1 选区只有左键——返回 true 模态独占）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render();
    expect(viewer.handleEvent(mouse('middle', { row: 1, col: 2 }))).toBe(true);
    expect(viewer.handleEvent(mouse('right', { row: 1, col: 2 }))).toBe(true);
    drag(viewer, { row: 1, col: 2 }, { row: 3, col: 4 }); // 中/右未建锚——左键拖选照常
    expect(copies).toEqual(['m2\n> m3\n> m4']);
  });

  it('零宽选区 release 零复制（press 即 release 同点）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render();
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'press'));
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'release'));
    expect(copies).toEqual([]);
  });

  it('motion 拖出视口保焦点不扩（头行/底铬命中不移动焦点——释放按已存焦点）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render();
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'press'));
    viewer.handleEvent(mouse('left', { row: 3, col: 4 }, 'motion')); // 有效焦点
    viewer.handleEvent(mouse('left', { row: 0, col: 5 }, 'motion')); // 头行——焦点不动
    viewer.handleEvent(mouse('left', { row: 9, col: 5 }, 'motion')); // 底铬——焦点不动
    viewer.handleEvent(mouse('left', { row: 9, col: 5 }, 'release')); // 释放坐标不更新焦点
    expect(copies).toEqual(['m2\n> m3\n> m4']);
  });

  it('onCopy 缺席安全（装配可不接——选区路不炸）', () => {
    const viewer = new HistoryViewer({
      sessionId: SESSION,
      messages: manyUsers(10),
      columns: COLS,
      onExit: () => {},
    });
    const grid = new CellGrid(COLS, ROWS);
    viewer.render(grid, { row: 0, col: 0, width: COLS, height: ROWS });
    expect(() => drag(viewer, { row: 1, col: 2 }, { row: 3, col: 4 })).not.toThrow();
  });
});
