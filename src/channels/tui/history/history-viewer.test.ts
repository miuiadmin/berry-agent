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
import { Keymap } from '../keys/registry.js';
import type { AgentMessage } from '../../../contracts/index.js';
import { sessionColor, LIGHT_PALETTE, resolveTheme } from '../theme/index.js';

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
function rig(messages: readonly AgentMessage[], rows = ROWS, keybindings?: Readonly<Record<string, string>>) {
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
    ...(keybindings !== undefined ? { keymap: new Keymap(keybindings) } : {}),
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
    // user 块三明治（界面美化役批⑦）+ R-1 块前垫（回看器行集缺省 leadingGap——
    // 副屏自有头行隔开，首块也垫）：垫 + 前置空行 + '› ' 前缀正文 + 后置空行
    expect(readRow(grid, 1, COLS)).toBe(''); // R-1 块前垫
    expect(readRow(grid, 2, COLS)).toBe(''); // 三明治前置空行
    expect(readRow(grid, 3, COLS)).toBe('› 甲'); // user 块 '› ' 前缀
    expect(readRow(grid, 4, COLS)).toBe(''); // 三明治尾空行
    expect(readRow(grid, 5, COLS)).toBe(''); // R-1 markdown 块前垫
    expect(readRow(grid, 6, COLS)).toContain('标题'); // markdown 定稿块
    expect(readRow(grid, ROWS - 1, COLS)).toContain('q/esc 返回'); // 底行键面提示
  });

  it('⚙ 工具行 dim 样式段进副屏（带样式写出的 cell 级证据）', () => {
    const { render } = rig([assistantMsg('', [{ id: 't1', name: 'read', arguments: { path: 'x' } }])]);
    const grid = render();
    const row = readRow(grid, 2, COLS); // R-1 块前垫后工具行落屏行 2
    // 白名单键值短显（UX 五问题批②）：路径=x 形（键位用户面中文化 V-0 注⑤）
    expect(row).toContain('⚙ 读取文件(路径=x)');
    // 「 ⚙」起首即 dim 段（run 覆写经 writeSlice 落 cell 样式）
    const cell = grid.getCell(2, row.indexOf('⚙'));
    expect(cell?.style.dim).toBe(true);
  });

  it('markdown H1 bold 样式保留（样式段经 gridRowToStyled 全程不丢）', () => {
    const { render } = rig([assistantMsg('# 标题')]);
    const grid = render();
    const row = readRow(grid, 2, COLS); // R-1 块前垫后 H1 落屏行 2
    const cell = grid.getCell(2, row.indexOf('标'));
    expect(cell?.style.bold).toBe(true);
  });

  it('R-2 全宽带（viewer 载体）：userMessageBg 在场 → user 行染底到右缘（fillBg 补底腿）；无主题形零染', () => {
    // 探测形主题（缺省板 userMessageBg undefined——零染回退形）
    const probed = resolveTheme(LIGHT_PALETTE, 'truecolor', { r: 32, g: 32, b: 32 });
    const viewer = new HistoryViewer({
      sessionId: SESSION,
      messages: [userMsg('帮我看下')],
      columns: COLS,
      theme: probed,
      onExit: () => {},
    });
    const grid = new CellGrid(COLS, ROWS);
    viewer.render(grid, { row: 0, col: 0, width: COLS, height: ROWS });
    const bg = probed.userMessageBg;
    // 行 2 三明治前置空行：整行染（col 0 到右缘——空行补底腿）
    expect(grid.getCell(2, 0)?.style.bg).toBe(bg);
    expect(grid.getCell(2, COLS - 1)?.style.bg).toBe(bg);
    // 行 3 正文行：前缀段在染（游程面）、正文末列后残区补底到右缘（尾腿）
    //（'帮我看下' 5 全宽字 = 10 列 + 前缀 2 = 文本末列 11 → 列 12 起为补底区）
    expect(grid.getCell(3, 0)?.style.bg).toBe(bg);
    expect(grid.getCell(3, 11)?.style.bg).toBe(bg);
    expect(grid.getCell(3, 12)?.style.bg).toBe(bg);
    expect(grid.getCell(3, COLS - 1)?.style.bg).toBe(bg);
    // 行 4 三明治尾空行整行染；行 1 R-1 块前垫 = 外素行不染（外素内染）
    expect(grid.getCell(4, 0)?.style.bg).toBe(bg);
    expect(grid.getCell(4, COLS - 1)?.style.bg).toBe(bg);
    expect(grid.getCell(1, 0)).toBeNull(); // 未写格（getCell 未写位返回 null）
    // 无主题（缺省板）形：零染——补底腿缺席、文本格无 bg
    const plain = rig([userMsg('帮我看下')]);
    const plainGrid = plain.render();
    expect(plainGrid.getCell(3, 12)).toBeNull();
    expect(plainGrid.getCell(3, 0)?.style.bg).toBeUndefined();
    expect(plainGrid.getCell(2, 0)).toBeNull();
  });

  it('快照档 v1：构造后静态——外数组再变更不进副屏（回看期新事件不进副屏）', () => {
    const messages = [userMsg('甲')];
    const { viewer, render } = rig(messages);
    messages.push(userMsg('乙')); // 构造后追加——行集是构造时快照
    const grid = render();
    expect(readRow(grid, 3, COLS)).toBe('› 甲'); // R-1 垫 + 三明治前置后正文落屏行 3
    viewer.handleEvent(key('home'));
    expect(readRow(render(), 3, COLS)).toBe('› 甲'); // 全档滚动也只有快照行
    for (let r = 0; r < ROWS; r++) expect(readRow(render(), r, COLS)).not.toContain('乙'); // 乙不在场（全屏扫）
  });
});

/* ---------------- 开屏贴尾与键盘滚动 ---------------- */

describe('回看器滚动（ScrollView 装载——开屏贴尾 / 破随 / 翻页）', () => {
  it('开屏贴尾（follow 初始 true），↑ 破随、Home 到顶', () => {
    const { viewer, render } = rig(manyUsers(30));
    let grid = render(); // 120 行（R-1 块前垫 + user 三明治 4 行/条）、视口 8（ROWS-2）→ offset 112
    expect(readBody(grid, 3)).toBe('› m28');
    expect(readBody(grid, 7)).toBe('› m29');
    expect(viewer.handleEvent(key('up'))).toBe(true);
    grid = render(); // offset 111——行 112 = m28 块前垫，m28 正文让位至屏行 4
    expect(readBody(grid, 4)).toBe('› m28');
    expect(viewer.handleEvent(key('home'))).toBe(true);
    grid = render(); // offset 0——行 0 = 块前垫、行 1 = 三明治前置空行、行 2 = m0 正文
    expect(readBody(grid, 1)).toBe('');
    expect(readBody(grid, 2)).toBe('');
    expect(readBody(grid, 3)).toBe('› m0');
    expect(viewer.handleEvent(key('end'))).toBe(true); // End 复随贴尾
    expect(readBody(render(), 3)).toBe('› m28');
  });

  it('PgUp/PgDn 按视口高翻页', () => {
    const { viewer, render } = rig(manyUsers(30));
    render(); // offset 112、页高 8 回写
    viewer.handleEvent(key('home'));
    viewer.handleEvent(key('pagedown'));
    expect(readBody(render(), 3)).toBe('› m2'); // offset 8：行 8 = m2 块前垫、行 9 空行、行 10 = m2 正文
    viewer.handleEvent(key('pageup'));
    expect(readBody(render(), 3)).toBe('› m0'); // 回顶：行 0 垫、行 1 空行、行 2 = m0 正文
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

  it('开：搜索框在场（composer 单行 › 形——V-0 注③ 框退役）+ 计数 0/0 如实', () => {
    const { viewer, render } = searchRig();
    expect(viewer.handleEvent(key('f', { ctrl: true, shift: true }))).toBe(true);
    const grid = render();
    expect(grid.getCell(ROWS - 1, 0)?.grapheme).toBe('›'); // 底铬搜索输入行提示符（单行）
    expect(readRow(grid, ROWS - 1, COLS)).toBe('›'); // 空查询——提示符独占（框线零占位）
    expect(readRow(grid, 0, COLS)).toContain('0/0'); // 空查询零匹配如实
  });

  it('跳：Enter 下一 / Shift+Enter 上一 / 循环（尾后回首）；视口对齐匹配行', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2')); // 查询 'm2' → 11 匹配、首匹配 m2
    let grid = render();
    expect(readRow(grid, 0, COLS)).toContain('1/11');
    expect(readBody(grid, 1)).toBe('› m2'); // 首匹配对齐视口顶（匹配行 10 = m2 正文——R-1 4 行/块）
    viewer.handleEvent(key('enter')); // 下一 → m20
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('2/11');
    expect(readBody(grid, 1)).toBe('› m20');
    viewer.handleEvent(key('enter', { shift: true })); // 上一 → m2
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('1/11');
    viewer.handleEvent(key('enter', { shift: true })); // 首前往尾 → m29
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('11/11');
    // 末行匹配：偏移夹底——匹配行 118 在视口内可见（搜索框在场视口 8：
    // 偏移夹底 112，m28/m29 皆入窗——R-1 4 行/块下 120 行行集）
    expect(readBody(grid, 3)).toBe('› m28');
    expect(readBody(grid, 7)).toBe('› m29');
  });

  it('当前匹配反色高亮（writeSlice 样式叠加——段边界切割的 cell 级证据）', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2'));
    const grid = render();
    const row = readBody(grid, 1);
    expect(row).toBe('› m2');
    const m2At = row.indexOf('m2');
    expect(grid.getCell(1, m2At)?.style.inverse).toBe(true); // 匹配段反色
    expect(grid.getCell(1, m2At + 1)?.style.inverse).toBe(true);
    expect(grid.getCell(1, 0)?.style.inverse).toBeUndefined(); // 匹配外不染
  });

  it('变长小写坐标系对齐（挖掘 28 轮 [5]——修前红：İ 使高亮右漂一列）', () => {
    // İ（U+0130）toLowerCase 1 码元→2（i+U+0307）——匹配区间在小写副本坐标
    // indexOf、原文坐标消费，每 İ 右漂一列（高亮/跳转同漂）。修：长度保形
    // 小写副本（等长全串快路 + 变长逐码点保形回退——变长位保原字，副本与
    // 原文逐下标对齐；查询同源保形——İ 查询照匹配 İ 原字）
    const { viewer, render } = rig([...manyUsers(9), userMsg('İ xyz')]); // İ 行唯一含 xyz——首匹配对齐视口顶
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    for (const ch of ['x', 'y', 'z']) viewer.handleEvent(text(ch));
    const grid = render();
    expect(readRow(grid, 0, COLS)).toContain('1/1');
    // 行位随块间距布局——按内容找 İ 行（不对绝对行号断言）
    let rowIdx = -1;
    let row = '';
    for (let r = 1; r < ROWS - 1; r++) {
      const candidate = readBody(grid, r);
      if (candidate.includes('İ')) {
        rowIdx = r;
        row = candidate;
        break;
      }
    }
    expect(row).toBe('› İ xyz');
    const at = row.indexOf('xyz');
    expect(grid.getCell(rowIdx, at)?.style.inverse).toBe(true); // x 位反色（修前红锚：undefined——漂至 at+1 起）
    expect(grid.getCell(rowIdx, at + 1)?.style.inverse).toBe(true);
    expect(grid.getCell(rowIdx, at + 2)?.style.inverse).toBe(true);
    expect(grid.getCell(rowIdx, at - 1)?.style.inverse).toBeUndefined(); // 匹配外不染
  });

  it('不区分大小写匹配', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('M'));
    viewer.handleEvent(text('2'));
    expect(readRow(render(), 0, COLS)).toContain('1/11');
  });

  it('逐击键重算收窄→放宽双向一致（比对面缓存副本不随击键陈化）', () => {
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2')); // 'm2' → 11 处（m2 + m20..m29）
    expect(readRow(render(), 0, COLS)).toContain('1/11');
    viewer.handleEvent(key('backspace')); // 删词 → 'm' → 30 行全命中（放宽向）
    expect(readRow(render(), 0, COLS)).toContain('1/30');
    viewer.handleEvent(text('2')); // 重打 '2' → 回 11（收窄向往返等价）
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

  it('alt+enter 归并跳匹配：候跑习惯键不清空已输入查询（挖掘 26 轮 [3]——修前红）', () => {
    // 修前：alt+enter 穿透让位守卫（!alt 判）直入 searchEditor——命中册内
    // queue-followup 提交路，model.submit() 全清（子编辑器无 onSubmit 消费
    // 者）——查询静默消失、计数与高亮随 onChange 重算归零（'0/0'）
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2'));
    expect(readRow(render(), 0, COLS)).toContain('1/11');
    viewer.handleEvent(key('enter', { alt: true })); // 主框候跑键习惯带入
    let grid = render();
    expect(readRow(grid, ROWS - 1, COLS)).toContain('m2'); // 查询词仍在框内（修前清空）
    expect(readRow(grid, 0, COLS)).toContain('2/11'); // 同语义跳下一（修前 '0/0'）
    viewer.handleEvent(key('enter', { alt: true, shift: true })); // alt+shift 上一同律
    grid = render();
    expect(readRow(grid, 0, COLS)).toContain('1/11');
  });

  it('ctrl+j 单行框吞（挖掘 27 轮 [5]——修前红）：换行缺省键不插不可见 LF、查询不被污染', () => {
    // 修前：ctrl+j（editor.new-line 缺省键，key='j'）穿透字面守卫直入
    // searchEditor 命中 addNewLine——单行框插入不可见 LF：查询被 LF 污染对
    // 无 LF 行集 indexOf 恒失败 → 计数 '0/0'、高亮全灭、已输文本滚出
    // 1 行视口仅剩「↑1 更多」
    const { viewer, render } = searchRig();
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2'));
    expect(readRow(render(), 0, COLS)).toContain('1/11');
    viewer.handleEvent(key('j', { ctrl: true }));
    const grid = render();
    expect(readRow(grid, ROWS - 1, COLS)).toContain('m2'); // 查询词 intact（修前 LF 污染）
    expect(readRow(grid, 0, COLS)).toContain('1/11'); // 计数不归零（修前 '0/0'）
  });

  it('改键面提交键归并跳匹配（挖掘 27 轮 [6]——修前红）：Slack 形 ctrl+enter 不清空查询', () => {
    // 修前：用户改键（editor.submit→ctrl+enter / new-line→enter）后习惯提交
    // 键穿透字面守卫（ctrl 修饰不拦）命中 handleSubmit——model.submit() 全清
    // 取文（连 undoStack 一并清空）→ 查询整行消失、计数 0/0、无跳转无回执
    const { viewer, render } = rig(manyUsers(30), ROWS, {
      'editor.submit': 'ctrl+enter',
      'editor.new-line': 'enter',
    });
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m'));
    viewer.handleEvent(text('2'));
    expect(readRow(render(), 0, COLS)).toContain('1/11');
    viewer.handleEvent(key('enter', { ctrl: true })); // 习惯提交键（改键面）
    const grid = render();
    expect(readRow(grid, ROWS - 1, COLS)).toContain('m2'); // 查询 intact（修前静默清空）
    expect(readRow(grid, 0, COLS)).toContain('2/11'); // 册驱动确认同义跳下一（修前 '0/0'）
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
    // 40 行（R-1 块前垫 + user 三明治 4 行/条）/ 视口 8 高——offset 贴尾 32：屏行 1..8 = 逻辑行 32..39
    const { viewer, copies, render } = rig(manyUsers(10));
    render(); // 视口几何回写（screenToLogical 的前提）
    drag(viewer, { row: 3, col: 2 }, { row: 7, col: 4 });
    // 行 34 从列 2（剥 '› ' 前缀）、行 35-37 空行全文（三明治尾 + 块前垫 + 前置）、行 38 到列 4（含前缀列切）
    expect(copies).toEqual(['m8\n\n\n\n› m9']);
  });

  it('反向拖选规范化（锚在焦点后——升序两端点同一明文）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render();
    drag(viewer, { row: 7, col: 4 }, { row: 3, col: 2 });
    expect(copies).toEqual(['m8\n\n\n\n› m9']);
  });

  it('CJK 双宽列反查：半格命中归字素首（与折叠算术同源）', () => {
    const { viewer, copies, render } = rig([userMsg('中文字')]); // 行 3 '› 中文字'（R-1 垫 + 三明治前置后）：中 2-3 / 文 4-5 / 字 6-7（列位不随行迁移——前缀恒 2 列）
    render();
    drag(viewer, { row: 3, col: 3 }, { row: 3, col: 6 }); // col3 = 中的右半格 → 逻辑 2；col6 = 字首 → 逻辑 6
    expect(copies).toEqual(['中文']);
  });

  it('拖选中滚动坐标不漂：锚存逻辑位，滚后 motion 命中新逻辑行（渲染无关坐标系）', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render(); // offset 32
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'press')); // 锚 = 逻辑行 32 列 0（m8 块前垫行首）
    viewer.handleEvent(mouse('wheel-up')); // offset 32-3 → 29（破随）
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'motion')); // 同屏位已是逻辑行 29（m7 三明治尾）
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'release'));
    // 行 29-31 全文（空 / '› m7' / 空）+ 行 32 列 0 空——锚逻辑位跨滚不漂
    expect(copies).toEqual(['\n› m7\n\n']);
  });

  it('选区高亮反色：press+motion 后视口内 inverse + release 后保留 + 下次 press 清除', () => {
    const { viewer, render } = rig(manyUsers(10));
    render();
    viewer.handleEvent(mouse('left', { row: 3, col: 2 }, 'press'));
    viewer.handleEvent(mouse('left', { row: 7, col: 4 }, 'motion')); // 焦点 = 逻辑行 38（'› m9'）
    const grid = render();
    expect(grid.getCell(3, 2)?.style.inverse).toBe(true); // 行 34 选中段（列 2 起至行尾）
    expect(grid.getCell(3, 0)?.style.inverse).toBeUndefined(); // 行 34 前缀未选
    expect(grid.getCell(4, 0)?.style.inverse).toBeUndefined(); // 包夹空行族无字可染（R-1 4 行/块——中间皆空行）
    expect(grid.getCell(5, 0)?.style.inverse).toBeUndefined(); // 同上（块前垫行）
    expect(grid.getCell(7, 3)?.style.inverse).toBe(true); // 行 38 选中段（列 0..3）
    viewer.handleEvent(mouse('left', { row: 7, col: 4 }, 'release'));
    expect(render().getCell(3, 2)?.style.inverse).toBe(true); // release 后高亮保留
    viewer.handleEvent(mouse('left', { row: 5, col: 2 }, 'press')); // 新选区起手 = 清除位
    const grid2 = render();
    expect(grid2.getCell(3, 2)?.style.inverse).toBeUndefined(); // 旧选区已清
    expect(grid2.getCell(5, 2)?.style.inverse).toBeUndefined(); // 新锚零宽不高亮
  });

  it('选区帽 64 KiB：超帽拒复制 + 底行提示常显至选区清除（拖选中滚轮扩选达帽）', () => {
    // 三条 30000 字符长行（行集经 40 列预折——让列 39 折宽下多数行 39+1 折两
    // 视觉行，贴尾 offset ≈ 4735）——锚在尾屏、滚到顶再扩焦点，中间行全文
    // 计入 → 总量 ~87 KiB 越帽（纯视口内拖选受折宽约束达不到帽）。滚轮次数
    // 取 ⌈4735/3⌉ 上取整的 1600：呈现口径夹取（挖掘 26 轮 [1]）下诚实滚到顶
    // ——旧全宽夹取首滚即把带内偏移跳夹回半程，800 次够到顶纯靠该 bug。
    const long = (ch: string): AgentMessage => userMsg(ch.repeat(30000));
    const { viewer, copies, render } = rig([long('x'), long('y'), long('z')]);
    render(); // 贴尾 offset ≈ 4735
    viewer.handleEvent(mouse('left', { row: 1, col: 0 }, 'press')); // 锚 = 消息 2 尾段
    for (let i = 0; i < 1600; i++) viewer.handleEvent(mouse('wheel-up')); // 诚实滚到顶（3 视觉行/次）
    viewer.handleEvent(mouse('left', { row: 8, col: 3 }, 'motion')); // 焦点 = 消息 0 首段
    viewer.handleEvent(mouse('left', { row: 8, col: 3 }, 'release'));
    expect(copies).toEqual([]); // 超帽拒复制
    expect(readRow(render(), ROWS - 1, COLS)).toContain('选区过大未复制'); // 底行提示
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'press')); // 下次 press = 清除位
    expect(readRow(render(), ROWS - 1, COLS)).toContain('q/esc 返回'); // 回常态键面提示
    expect(copies).toEqual([]); // 全程零复制
  });

  it('搜索框在场拖选禁用（输入模态优先）——滚轮仍照常滚', () => {
    const { viewer, copies, render } = rig(manyUsers(10));
    render(); // offset 22
    viewer.handleEvent(key('f', { ctrl: true, shift: true })); // 开搜索
    drag(viewer, { row: 1, col: 2 }, { row: 4, col: 4 });
    expect(copies).toEqual([]); // 禁拖选
    for (let i = 0; i < 12; i++) viewer.handleEvent(mouse('wheel-up')); // 32-36 夹 0（R-1 4 行/块 → 贴尾 32）
    expect(viewer.handleEvent(mouse('wheel-up'))).toBe(true); // 滚轮仍滚（走 super 消费路）
    expect(viewer.scrollOffset).toBe(0); // 搜索在场不拦滚动
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
    drag(viewer, { row: 3, col: 2 }, { row: 7, col: 4 }); // 中/右未建锚——左键拖选照常
    expect(copies).toEqual(['m8\n\n\n\n› m9']);
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
    viewer.handleEvent(mouse('left', { row: 3, col: 2 }, 'press'));
    viewer.handleEvent(mouse('left', { row: 7, col: 4 }, 'motion')); // 有效焦点
    viewer.handleEvent(mouse('left', { row: 0, col: 5 }, 'motion')); // 头行——焦点不动
    viewer.handleEvent(mouse('left', { row: 9, col: 5 }, 'motion')); // 底铬——焦点不动
    viewer.handleEvent(mouse('left', { row: 9, col: 5 }, 'release')); // 释放坐标不更新焦点
    expect(copies).toEqual(['m8\n\n\n\n› m9']);
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

/* ---------------- 窄窗宽度收口（头行 / 搜索计数 / 底行三面） ---------------- */

describe('回看器窄窗宽度收口', () => {
  /** 窄窗 rig：列宽可注入（行集构建列宽同步窄——三面共用） */
  function narrowRig(cols: number, rows = 8) {
    const viewer = new HistoryViewer({
      sessionId: SESSION,
      messages: manyUsers(30),
      columns: cols,
      onExit: () => {},
    });
    const render = (): CellGrid => {
      const grid = new CellGrid(cols, rows);
      viewer.render(grid, { row: 0, col: 0, width: cols, height: rows });
      return grid;
    };
    return { viewer, render };
  }

  it('头行窄窗 … 收口（整行拼好过 fitLine——修前裸直写硬截断无省略号、短 id 整段吞）', () => {
    const { render } = narrowRig(10);
    const grid = render();
    // '↩ 历史回看 · sess-aaa' 21 列 → 10 列帽：9 列整字 + '…'（修前红锚：
    // 头行 = '↩ 历史回看' 硬切满 10 列、无 … 且 sess-aaa 起列 13 越界被吞）
    expect(readRow(grid, 0, 10)).toBe('↩ 历史回…');
  });

  it('头行宽窗常态回归：整行不收口 + 短 id 段仍携会话区分色（收口重构不丢着色）', () => {
    const { render } = rig(manyUsers(3));
    const grid = render();
    expect(readRow(grid, 0, COLS)).toBe('↩ 历史回看 · ' + SESSION.slice(0, 8));
    // 前缀 '↩ 历史回看 · ' 13 列——短 id 首格着会话色（裸前缀段无前景）
    expect(grid.getCell(0, 13)?.style?.fg).toBe(sessionColor(SESSION.slice(0, 8)));
    expect(grid.getCell(0, 0)?.style?.fg).toBeUndefined();
  });

  it('底行提示窄窗 … 收口（修前 ≈69 列提示行硬截断无省略号）', () => {
    const { render } = narrowRig(10);
    const grid = render();
    expect(readRow(grid, 7, 10)).toContain('…');
  });

  it('搜索计数窄窗守卫：计数区放不下干脆不写（修前负起列 CellGrid 静默吸收——首字符吞、余段左漂）', () => {
    const { viewer, render } = narrowRig(4);
    viewer.handleEvent(key('f', { ctrl: true, shift: true }));
    viewer.handleEvent(text('m')); // 30 匹配 → 计数 '1/30' 宽 4 > 4−1（末列留白）
    const grid = render();
    // 修前红锚：起列 = 4−1−4 = −1 → '1' 落 −1 被吞、'/30' 左漂行首
    expect(readRow(grid, 0, 4)).not.toContain('/');
  });
});
