/**
 * /diff 会话改动总览副屏件测试（07 §4.1 命令面增补批）：foldSessionDiff 聚合
 * 纯函数（分组/累计计数/字典序/孤儿 ⋮/坏串防御/非 edit 滤除）+ DiffViewer
 * 呈现（组头计数/enter 展开/收起缺省/空态/退出族）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid, DIM_STYLE } from '../../engine/index.js';
import { DiffViewer, foldSessionDiff } from './diff-viewer.js';
import type { DiffProjectionMessage, DiffViewerOptions } from './diff-viewer.js';
import { DEFAULT_THEME } from '../theme/index.js';

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

/** edit 调用夹具（arguments = 原始 JSON 串——审计保真形） */
function editCall(
  toolCallId: string,
  patch: string,
): {
  type: 'toolCall';
  toolCallId: string;
  toolName: string;
  arguments: string;
} {
  return { type: 'toolCall', toolCallId, toolName: 'edit', arguments: JSON.stringify({ patch }) };
}

/** assistant 消息夹具（投影形——toolCalls 数组承载） */
function assistant(calls: readonly ReturnType<typeof editCall>[]): DiffProjectionMessage {
  return { type: 'assistant', toolCalls: calls };
}

/** toolResult 配对面夹具 */
function result(toolCallId: string): DiffProjectionMessage {
  return { type: 'toolResult', toolCallId };
}

const PATCH_A = `*** Begin Patch
*** Update File: src/one.ts
 ctx line
-old line
+new line
+extra line
*** End Patch`;

const PATCH_B = `*** Begin Patch
*** Add File: docs/two.md
+# fresh
*** End Patch`;

describe('foldSessionDiff（投影聚合纯函数）', () => {
  it('按文件分组 + 增删计数 + 字典序（docs/two.md < src/one.ts）', () => {
    const groups = foldSessionDiff([
      assistant([editCall('t1', PATCH_A), editCall('t2', PATCH_B)]),
      result('t1'),
      result('t2'),
    ]);
    expect(groups.map((g) => g.path)).toEqual(['docs/two.md', 'src/one.ts']);
    const one = groups[1]!;
    expect(one.added).toBe(2);
    expect(one.removed).toBe(1);
    expect(one.orphan).toBe(false);
    // 组体行 = ctx/del/add 三分类（meta 不入组体）
    expect(one.lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add', 'add']);
  });

  it('同文件多次 edit 计数累计、孤儿位 OR 累积（同键混排不另立分区）', () => {
    const groups = foldSessionDiff([
      assistant([editCall('t1', PATCH_A)]),
      result('t1'),
      assistant([editCall('t2', `*** Update File: src/one.ts\n+more\n`)]), // 无 result = 孤儿
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.added).toBe(3); // 2 + 1 累计
    expect(groups[0]!.orphan).toBe(true);
  });

  it('孤儿判据 = toolCallId 无配对 toolResult；全配对 = 零孤儿', () => {
    const groups = foldSessionDiff([assistant([editCall('t1', PATCH_A)])]);
    expect(groups[0]!.orphan).toBe(true);
    const answered = foldSessionDiff([assistant([editCall('t1', PATCH_A)]), result('t1')]);
    expect(answered[0]!.orphan).toBe(false);
  });

  it('非 edit 工具滤除；坏 JSON 串/非 string patch 跳过不炸', () => {
    const groups = foldSessionDiff([
      {
        type: 'assistant',
        toolCalls: [
          { toolCallId: 'x1', toolName: 'read', arguments: '{"path":"a"}' }, // 非 edit
          { toolCallId: 'x2', toolName: 'edit', arguments: '{not json' }, // 坏串
          { toolCallId: 'x3', toolName: 'edit', arguments: '{"patch":42}' }, // 非 string patch
        ],
      },
      result('x1'),
      result('x2'),
      result('x3'),
    ]);
    expect(groups).toEqual([]);
  });

  it('user/toolResult 消息不产分组；空投影 = 空表', () => {
    expect(foldSessionDiff([{ type: 'user' }, result('t9')])).toEqual([]);
    expect(foldSessionDiff([])).toEqual([]);
  });

  it('段外 meta（Begin/End 后无组可归的体系行）畸形防御——不归组不炸', () => {
    const groups = foldSessionDiff([assistant([editCall('t1', `orphan line\n+stray`)]), result('t1')]);
    expect(groups).toEqual([]); // 无文件段指令 = 零组
  });
});

describe('DiffViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  const MESSAGES: readonly DiffProjectionMessage[] = [
    assistant([editCall('t1', PATCH_A), editCall('t2', PATCH_B)]),
    result('t1'),
    result('t2'),
  ];

  function makeViewer(overrides: Partial<DiffViewerOptions> = {}) {
    const onExit = vi.fn();
    const viewer = new DiffViewer({
      messages: MESSAGES,
      theme: DEFAULT_THEME,
      sessionId: 'sess-abcdef1234567890',
      onExit,
      ...overrides,
    });
    return { viewer, onExit };
  }

  it('缺省全收起：组头行集（路径 + 右段计数）+ 空态缺席', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('± 改动总览 · 2 文件');
    const row1 = readRow(grid, 1, width);
    expect(row1).toContain('docs/two.md');
    expect(row1).toContain('+1');
    expect(row1).toContain('-0');
    const row2 = readRow(grid, 2, width);
    expect(row2).toContain('src/one.ts');
    expect(row2).toContain('+2');
    expect(row2).toContain('-1');
    // 组体不呈现（缺省全收起——总览语义）
    expect(readRow(grid, 3, width)).toBe('↑↓ 移动 · enter 展开/收起 · q/esc 返回');
  });

  it('组头右段预算（第五役 G8——极窄窗计数段整段丢弃）：起列不负、行首不覆写、左段 … 收口', () => {
    const { viewer } = makeViewer();
    const width = 4; // 首组右段 '+1 -0' 实占 5 > 窗宽——预算不足形
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const row1 = readRow(grid, 1, width);
    // 修前红：c = 4 - 5 = -1，writeText 负列首字素越界吸收、后续字素顺移落
    // 0 列——行首被 '+1' 尾字覆写（'1 -0' 坏形）；修后右段整段丢弃（与
    // fitRowSegments「预算 0 丢右段」负起列封堵律同族），左段光标符 + … 收口
    expect(row1).toBe('› …');
    expect(row1).not.toContain('+1');
    expect(row1).not.toContain('-0');
  });

  it('词级对行超宽省略形收口（界面美化役 2026-10-01 ①——… 记号随段着色 + 两侧记号同列；修前红：硬切被切行与真实行尾不可辨）', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/one.ts',
      `-old ${'x'.repeat(40)}`,
      `+new ${'y'.repeat(40)}`,
      '*** End Patch',
    ].join('\n');
    const onExit = vi.fn();
    const viewer = new DiffViewer({
      messages: [assistant([editCall('t1', patch)]), result('t1')],
      theme: DEFAULT_THEME,
      sessionId: 'sess-x',
      onExit,
    });
    const width = 24;
    viewer.handleEvent(k('enter')); // 展开首组（收起行空间单组头——光标钉组头，组体行空光标位）
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 对行几何（ZCode 对标批后）：空光标位 + 行号槽（旧轨|新轨 W=1 + 缝 2）+
    // '-'/‘+’ 前缀 + 'old '/'new ' 同宽前缀 → 两侧变段同列起笔、同帽截断；
    // 尾部变段 40 列 > 余 15 → 14 整字 + '…' 恰满 24 列（修前红锚：17 x 硬切
    // 到帽、尾部无 …）
    expect(readRow(grid, 2, width)).toBe(' 1  -old ' + 'x'.repeat(14) + '…');
    expect(readRow(grid, 3, width)).toBe('   1+new ' + 'y'.repeat(14) + '…');
    // … 记号随段既有着色（界面美化役①——diffRemoved/diffAdded 前景不变）：
    // del 行记号红系 / add 行记号绿系，且两侧记号同列（对行词级几何不破）
    const markerCol = width - 1;
    expect(grid.getCell(2, markerCol)?.grapheme).toBe('…');
    expect(grid.getCell(2, markerCol)?.style?.fg).toBe(DEFAULT_THEME.diffRemoved);
    expect(grid.getCell(3, markerCol)?.grapheme).toBe('…');
    expect(grid.getCell(3, markerCol)?.style?.fg).toBe(DEFAULT_THEME.diffAdded);
    // 记号后零残留（被切即行终——… 后不缀后续段内容）
    expect(readRow(grid, 2, width).endsWith('…')).toBe(true);
    expect(readRow(grid, 3, width).endsWith('…')).toBe(true);
  });

  it('enter 展开光标组：组体行呈现（前缀 + 行文本）；再 enter 收起', () => {
    const { viewer } = makeViewer();
    const width = 64;
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const body = readRow(grid, 3, width); // 展开组体首行 = ctx 行
    expect(body).toContain('ctx line');
    // 词级对行（del+add 相邻对）：**本侧变段 + same 段**——del 行只呈 del 侧
    //（'-old line' 非 '-oldnew line'——段族两栖，各取本侧——回归锁）
    expect(readRow(grid, 4, width)).toContain('-old line');
    expect(readRow(grid, 5, width)).toContain('+new line');
    expect(readRow(grid, 6, width)).toContain('+extra line');
    viewer.handleEvent(k('enter')); // 收起
    const grid2 = new CellGrid(width, viewer.measure(width));
    viewer.render(grid2, { row: 0, col: 0, width, height: grid2.rows });
    expect(readRow(grid2, 3, width)).toBe('↑↓ 移动 · enter 展开/收起 · q/esc 返回');
  });

  it('组体行上 enter 回溯所在组（组头/组体同判）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开
    viewer.handleEvent(k('down')); // → 组体首行
    viewer.handleEvent(k('enter')); // 组体 enter = 收起同组
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 3, width)).toBe('↑↓ 移动 · enter 展开/收起 · q/esc 返回'); // 已收起
  });

  it('空集（零 edit）= 诚实空态行（零 git 语义注记）', () => {
    const onExit = vi.fn();
    const viewer = new DiffViewer({ messages: [{ type: 'user' }], theme: DEFAULT_THEME, sessionId: 'sess-x', onExit });
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('± 改动总览 · 0 文件');
    expect(readRow(grid, 1, width)).toContain('本会话没有文件改动');
    expect(readRow(grid, grid.rows - 1, width)).toBe('q/esc 返回');
    // 空集移动键不动作、enter 不炸
    expect(viewer.handleEvent(k('down'))).toBe(true);
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });

  it('孤儿组头 ⋮ 在飞标注', () => {
    const onExit = vi.fn();
    const viewer = new DiffViewer({
      messages: [assistant([editCall('t1', PATCH_A)])], // 无 result = 孤儿
      theme: DEFAULT_THEME,
      sessionId: 'sess-x',
      onExit,
    });
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 1, width)).toContain('⋮ 进行中');
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次；Esc 同 q', () => {
    const { viewer, onExit } = makeViewer();
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent);
    expect(onExit).toHaveBeenCalledTimes(1);
    const { viewer: v2, onExit: exit2 } = makeViewer();
    v2.handleEvent(k('escape'));
    expect(exit2).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞不退屏；Ctrl+D = 先收屏再退柄（序 = exit 先）', () => {
    const onInterrupt = vi.fn();
    const { viewer, onExit } = makeViewer({ sessionId: 'sess-xyz', onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-xyz');
    expect(onExit).not.toHaveBeenCalled();
    const calls: string[] = [];
    const { viewer: v2 } = makeViewer({
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    v2.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）', () => {
    const { viewer } = makeViewer();
    expect(viewer.handleEvent(k('x'))).toBe(true);
  });

  it('收起标记 • 与光标 › 分形（注⑩——撞形修正续笔：光标 ▸→› 迁后收起标记让位 •）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const row1 = readRow(grid, 1, width);
    // 光标符 ›（注⑩ 输入与选中位）+ 收起标记 •（注⑩ 折叠组前缀位——与展开
    // ▾ 配对）；两符分形不复撞——▸ 时代「▸ ▸ path」撞形谱的反向防御；
    // 避 ▶ U+25B6（stringWidth 计 2 且 emoji 化风险）
    expect(row1.startsWith('› • ')).toBe(true);
    expect(row1).not.toContain('▸');
    // 展开位换 ▾（enter 后同组头——配对形直锁）
    viewer.handleEvent(k('enter'));
    const grid2 = new CellGrid(width, viewer.measure(width));
    viewer.render(grid2, { row: 0, col: 0, width, height: grid2.rows });
    expect(readRow(grid2, 1, width).startsWith('› ▾ ')).toBe(true);
  });

  it('光标驱动滚动：视口夹取（光标行恒在窗内——首行随窗换断言）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
    viewer.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('docs/two.md'); // 首窗锚顶
    viewer.handleEvent(k('end')); // 尾组组头（行空间 2——窗内）
    viewer.handleEvent(k('enter')); // 展开尾组——行空间增长
    viewer.handleEvent(k('end')); // 光标到展开后尾行——超出 2 行窗
    const grid2 = new CellGrid(width, 4);
    viewer.render(grid2, { row: 0, col: 0, width, height: 4 });
    // 提窗后首行不再是首组头；尾行（extra line）入窗（光标恒在窗内）
    expect(readRow(grid2, 1, width)).not.toContain('docs/two.md');
    expect(readRow(grid2, 2, width)).toContain('extra line');
    viewer.handleEvent(k('home'));
    const grid3 = new CellGrid(width, 4);
    viewer.render(grid3, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid3, 1, width)).toContain('docs/two.md'); // 回锚顶
  });

  it('滚轮只滚视口（±3 行界夹取——不挪光标；修前红：wheel 零动作）+ 光标键复位钉随', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
      viewer.render(grid, { row: 0, col: 0, width, height: 4 });
      return grid;
    };
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开——扁平行 6（2 组头 + 4 组体）
    expect(readRow(paint(), 1, width)).toContain('docs/two.md'); // 首窗锚顶
    viewer.handleEvent(wheel('wheel-down')); // 视口滚 3 行（光标 0 不动——组折叠语义下只滚视口）
    const grid2 = paint();
    expect(readRow(grid2, 1, width)).not.toContain('docs/two.md'); // 提窗——修前零动作红锚
    expect(readRow(grid2, 1, width)).toContain('-old line'); // offset 3 = 组体 del 行入顶
    expect(readRow(grid2, 2, width)).toContain('+new line');
    viewer.handleEvent(wheel('wheel-down')); // 再滚——界夹取停 maxOffset（6-2=4）
    expect(readRow(paint(), 1, width)).toContain('+new line'); // offset 4 = +new 行入顶
    viewer.handleEvent(k('up')); // 光标键复位钉随（顶夹取不动 + 钉随回锚）
    expect(readRow(paint(), 1, width)).toContain('docs/two.md'); // 光标 0 恒可见——回锚顶
  });

  it('空集滚轮零动作吞（空态零组——不炸不动作）', () => {
    const onExit = vi.fn();
    const viewer = new DiffViewer({ messages: [{ type: 'user' }], theme: DEFAULT_THEME, sessionId: 'sess-x', onExit });
    expect(viewer.handleEvent(wheel('wheel-down'))).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  /* ---- S2 宽度账族（2026-09-21 第六役修复组 2）：组体行构造位消毒（tool-card renderWordDiffPair 同源族标准） ---- */

  /** 单组补丁渲染全行集（down+enter 展开首组——光标停在组体首行：组头 + 组体全量行） */
  function renderExpandedRows(messages: readonly DiffProjectionMessage[]): string[] {
    const { viewer } = makeViewer({ messages });
    const width = 64;
    viewer.handleEvent(k('down')); // 光标 → 组体首行（del 行——光标符稳定位，对拍确定性）
    viewer.handleEvent(k('enter')); // 回溯首组展开（光标不动）
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    return Array.from({ length: grid.rows }, (_, r) => readRow(grid, r, width));
  }

  it('组体行构造位消毒：patch 体 ESC 序列剥除——修前红（writeText 只跳控制字节，ESC 后可打印载荷 [31m 落屏伪残留）', () => {
    const patch = '*** Begin Patch\n*** Update File: src/x.ts\n-old\u001b[31m line\n+new line\n*** End Patch';
    const rows = renderExpandedRows([assistant([editCall('t1', patch)]), result('t1')]);
    // 词级对行 del 侧：修前 '  -old[31m line'（ESC 跳过、'[31m' 照写落屏）；
    // 修后整段剥除。光标符在组头——构造期单组收起态 down 被钳 0（组头）。
    // 行号槽（ZCode 对标批）：del 行旧轨 1 / add 行新轨 1（W=1——两轨各 1 行）
    expect(rows[2]).not.toContain('[31m');
    expect(rows[2]).toBe(' 1  -old line');
    expect(rows[3]).toBe('   1+new line');
  });

  it('CRLF 补丁与 LF 补丁渲染逐行一致（行尾 \\r 构造位剥除——弱载体一致锁，修前修后同绿的回归锁）', () => {
    const lf = renderExpandedRows([assistant([editCall('t1', PATCH_A)]), result('t1')]);
    const crlf = renderExpandedRows([assistant([editCall('t1', PATCH_A.replaceAll('\n', '\r\n'))]), result('t1')]);
    expect(crlf).toEqual(lf);
  });
});

/* ---- ZCode TUI 对标批（2026-10-05 定形注——07 §4.1 副屏族 diff-viewer 双件）：行号槽 + 宽屏 split 双栏 ---- */

describe('DiffViewer 行号槽 + split 双栏（ZCode 对标批双件）', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  /** 读回列段 [from, to)（split 双栏左右半几何断言——trimEnd 收口） */
  function readSeg(grid: CellGrid, row: number, from: number, to: number): string {
    let out = '';
    for (let col = from; col < to; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  const MESSAGES: readonly DiffProjectionMessage[] = [
    assistant([editCall('t1', PATCH_A), editCall('t2', PATCH_B)]),
    result('t1'),
    result('t2'),
  ];

  function makeViewer(overrides: Partial<DiffViewerOptions> = {}) {
    const onExit = vi.fn();
    const viewer = new DiffViewer({
      messages: MESSAGES,
      theme: DEFAULT_THEME,
      sessionId: 'sess-x',
      onExit,
      ...overrides,
    });
    return { viewer, onExit };
  }

  it('行号槽各循其轨：ctx 双轨同进 / 删行旧轨前进 / 增行新轨前进（修前红：行号槽缺席）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 轨账（patch 相对帧）：ctx(旧1/新1) → del(旧2) → add(新2) → add(新3)；
    // W=1（组最大轨号 3）。行几何 = 光标位(1) + 槽区(2W+1) + 前缀(1) + 文本
    //（ctx 行前缀列空 + patch ctx 行自带前导空格——parsePatchLines 保真不剥）
    expect(readRow(grid, 3, width)).toBe(' 1 1  ctx line');
    expect(readRow(grid, 4, width)).toBe(' 2  -old line');
    expect(readRow(grid, 5, width)).toBe('   2+new line');
    expect(readRow(grid, 6, width)).toBe('   3+extra line');
    // 槽 dim（注⑩：engine DIM_STYLE 单源）——正文位非 dim
    expect(grid.getCell(3, 1)?.style).toBe(DIM_STYLE); // 旧轨槽
    expect(grid.getCell(3, 3)?.style).toBe(DIM_STYLE); // 新轨槽（ctx 双槽）
    expect(grid.getCell(3, 5)?.style).not.toBe(DIM_STYLE); // 正文
  });

  it('位数自适应宽：组最大轨号达两位 → 槽宽 2 右对齐、前缀列跨行对齐（修前红：定形几何缺席）', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/big.ts',
      ...Array.from({ length: 10 }, (_, i) => `-l${i + 1}`),
      '*** End Patch',
    ].join('\n');
    const { viewer } = makeViewer({ messages: [assistant([editCall('t1', patch)]), result('t1')] });
    const width = 64;
    viewer.handleEvent(k('enter')); // 展开唯一组（收起单组头光标钳 0——enter 即展开）
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // W=2（旧轨 10 行）：' 1' 与 '10' 同右缘（前缀 '-' 恒 col 6——位数对齐锁）
    expect(readRow(grid, 2, width)).toBe('  1   -l1');
    expect(readRow(grid, 11, width)).toBe(' 10   -l10');
  });

  it('宽屏 split 双栏（≥100 列）：词级对行合并同屏行左旧右新、孤增单侧挂空、行号槽分栏各随（修前红：split 缺席）', () => {
    const { viewer } = makeViewer();
    const width = 100;
    viewer.measure(width); // 形随宽先行（100 ≥ 阈值 → split 行空间）
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 行空间收缩：组体 4 行 → 3 split 行（对行合并）——量高随形
    expect(grid.rows).toBe(7);
    // ctx 行：双侧同现（左旧轨 1 / 右新轨 1——行号槽分栏各随；patch ctx 行
    // 自带前导空格随文本——前缀列空 + 前导空格两空位）
    expect(readSeg(grid, 3, 0, 49)).toBe(' 1   ctx line');
    expect(readSeg(grid, 3, 50, 100)).toBe(' 1   ctx line');
    expect(grid.getCell(3, 51)?.style).toBe(DIM_STYLE); // 右栏新轨槽 dim
    // 对行合并：del 左半 + add 右半同一屏行（unified 形两行 → split 一行）；
    // 左旧轨 2（ctx 先进 1）/ 右新轨 2
    expect(readSeg(grid, 4, 0, 49)).toBe(' 2 -old line');
    expect(readSeg(grid, 4, 50, 100)).toBe(' 2 +new line');
    // 孤增行：左半空、右半新轨 3 单侧挂空
    expect(readSeg(grid, 5, 0, 49)).toBe('');
    expect(readSeg(grid, 5, 50, 100)).toBe(' 3 +extra line');
  });

  it('split 阈值边界：99 列维持 unified（对行分行不合并；修前红：行号槽几何缺席承载）', () => {
    const { viewer } = makeViewer();
    const width = 99;
    viewer.handleEvent(k('down'));
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // unified：对行两行分立（del 行 4 / add 行 5——不合并），行号槽照随
    expect(readRow(grid, 4, width)).toBe(' 2  -old line');
    expect(readRow(grid, 5, width)).toBe('   2+new line');
    expect(readRow(grid, 6, width)).toBe('   3+extra line');
  });

  it('split 形导航不变：光标键行走 split 行空间 / 组体 enter 回溯收组 / ⋮ 在飞标注维持', () => {
    const { viewer } = makeViewer({ messages: [assistant([editCall('t1', PATCH_A)])] }); // 无 result = 孤儿
    const width = 100;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, viewer.measure(width));
      viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
      return grid;
    };
    // ⋮ 在飞标注（孤儿组头——两形同形不变）
    expect(readRow(paint(), 1, width)).toContain('⋮ 进行中');
    viewer.handleEvent(k('enter')); // 展开唯一组 → split 行 [ctx, 对行, 孤增]
    viewer.handleEvent(k('down')); // → ctx split 行（屏行 2）
    let grid = paint();
    expect(readRow(grid, 2, width).startsWith('›')).toBe(true); // ctx 行光标钉随
    viewer.handleEvent(k('down')); // → 对行 split 行（屏行 3——合并行光标 › 落左栏行首）
    grid = paint();
    expect(readSeg(grid, 3, 0, 49)).toBe('›2 -old line'); // 左旧轨 2（ctx 先进 1）
    viewer.handleEvent(k('enter')); // 组体行 enter = 回溯收组（导航键面不变）
    const grid2 = paint();
    expect(readRow(grid2, 1, width)).toContain('src/one.ts'); // 收起——仅组头
    expect(readRow(grid2, 2, width)).toBe('↑↓ 移动 · enter 展开/收起 · q/esc 返回');
  });

  it('split 半栏超宽 … 收口：两侧各自半栏预算内截断 + 中缝不越（… 省略位两形同律）', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/wide.ts',
      `-old ${'x'.repeat(60)}`,
      `+new ${'y'.repeat(60)}`,
      '*** End Patch',
    ].join('\n');
    const { viewer } = makeViewer({ messages: [assistant([editCall('t1', patch)]), result('t1')] });
    const width = 100;
    viewer.measure(width);
    viewer.handleEvent(k('enter')); // 展开唯一组 → 对行合并行落屏行 2
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 左半预算 46（槽 3 + 前缀 1 后余 41 → 40 整字 + '…' 止步缝前 col 48）；
    // 右半同律（col 98）——… 记号随段既有着色（unified 同源 renderLineContent）
    expect(readSeg(grid, 2, 0, 49)).toBe(' 1 -old ' + 'x'.repeat(40) + '…');
    expect(readSeg(grid, 2, 50, 100)).toBe(' 1 +new ' + 'y'.repeat(40) + '…');
    expect(grid.getCell(2, 48)?.grapheme).toBe('…');
    expect(grid.getCell(2, 98)?.grapheme).toBe('…');
    expect(grid.getCell(2, 49)?.grapheme ?? ' ').toBe(' '); // 中缝列不越占
  });
});
