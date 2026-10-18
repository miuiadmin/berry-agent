/**
 * /diff 会话改动总览副屏件测试（07 §4.1 命令面增补批）：foldSessionDiff 聚合
 * 纯函数（分组/累计计数/字典序/孤儿 ⋮/坏串防御/非 edit 滤除）+ DiffViewer
 * 呈现（组头计数/enter 展开/收起缺省/空态/退出族）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid, DIM_STYLE } from '../../engine/index.js';
import { DiffViewer, foldSessionDiff } from './diff-viewer.js';
import type { DiffProjectionMessage, DiffViewerOptions } from './diff-viewer.js';
import { DARK_PALETTE, DEFAULT_THEME, LIGHT_PALETTE, resolveTheme } from '../theme/index.js';

/**
 * diffWords 调用计数缝（挖掘 50 轮件 A）：vi.mock 部分透传——真实现零行为替身
 * 只加计数；hoisted 使计数器先于 vi.mock 工厂就绪。文件级波及注记：同文件其他
 * describe 及模块图内 tool-card 的 diffWords 绑定同被包裹（透传零扰——本文件
 * 不调 tool-card 渲染函数）。白名单注记见 tools/check-mock-targets.mjs 表内。
 */
const diffWordsCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../blocks/word-diff.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../blocks/word-diff.js')>();
  return {
    ...actual,
    diffWords: (a: string, b: string) => {
      diffWordsCalls.count += 1;
      return actual.diffWords(a, b);
    },
  };
});

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

/** toolResult 配对面夹具（meta = 05 §1.1 审计位——edit 回执 operations 整律落账形） */
function result(toolCallId: string, meta?: unknown): DiffProjectionMessage {
  return { type: 'toolResult', toolCallId, ...(meta !== undefined ? { meta } : {}) };
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
    // 组体行 = ctx/del/add 三分类（meta 不入组体）——件 D 起组体按段组织：
    // 单 call 单文件段 = 单段（sections[0]），无 meta 回执 → startLine 缺席 null
    expect(one.sections).toHaveLength(1);
    expect(one.sections[0]!.startLine).toBeNull();
    expect(one.sections[0]!.lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add', 'add']);
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

  it('Move to 带行流段不切段不丢行（53 轮件 A——修前红锚：Move to meta 曾置空组丢段行）', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      ' ctx line',
      '-old line',
      '+new line',
      '*** End Patch',
    ].join('\n');
    const groups = foldSessionDiff([assistant([editCall('t1', patch)]), result('t1')]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    // 组键 = 旧路径（排序键不变式）；movePath = 重命名目标
    expect(group.path).toBe('src/old.ts');
    expect(group.movePath).toBe('src/new.ts');
    // 修前红锚：Move to 行曾把 currentGroup/currentSection 置空——段体三行全丢
    expect(group.added).toBe(1);
    expect(group.removed).toBe(1);
    expect(group.sections[0]!.lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add']);
  });

  it('Move to 纯移段：单段零行体（added/removed 皆 0、movePath 在场）', () => {
    const patch = ['*** Begin Patch', '*** Update File: src/old.ts', '*** Move to: src/new.ts', '*** End Patch'].join(
      '\n',
    );
    const groups = foldSessionDiff([assistant([editCall('t1', patch)]), result('t1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.path).toBe('src/old.ts');
    expect(groups[0]!.movePath).toBe('src/new.ts');
    expect(groups[0]!.added).toBe(0);
    expect(groups[0]!.removed).toBe(0);
    expect(groups[0]!.sections).toHaveLength(1);
    expect(groups[0]!.sections[0]!.lines).toEqual([]);
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
    expect(readRow(grid, 3, width)).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
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

  it('词级对行超宽硬折行——续行承接与着色跨切点保留（49 轮件 A；修前红实证=旧「… 收口」锁三枚红——行尾不可见旧行为）', () => {
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
    // 内容预算 19（24 − 槽区 4 − 前缀 1）：'old '+40x 共 44 列折 3 视觉行
    //（19 + 19 + 6）——首视觉行截于折点**无 '…'**（省略号只在帽行/省略位）
    expect(readRow(grid, 2, width)).toBe(' 1  -old ' + 'x'.repeat(15));
    // 续行：行号槽空格对齐 + 前缀列空格（-/+ 仅首视觉行）+ 承接段片
    expect(readRow(grid, 3, width)).toBe(' '.repeat(5) + 'x'.repeat(19));
    // 尾段可达（本件核心价值——修前 '…' 截断行尾不可见）
    expect(readRow(grid, 4, width)).toBe(' '.repeat(5) + 'x'.repeat(6));
    // add 行同律（对行合并行序：del 3 视觉行后接 add 3 视觉行）
    expect(readRow(grid, 5, width)).toBe('   1+new ' + 'y'.repeat(15));
    expect(readRow(grid, 6, width)).toBe(' '.repeat(5) + 'y'.repeat(19));
    expect(readRow(grid, 7, width)).toBe(' '.repeat(5) + 'y'.repeat(6));
    // 着色跨切点保留：变段折行后两视觉行均 diffRemoved/diffAdded 前景
    expect(grid.getCell(2, 10)?.style?.fg).toBe(DEFAULT_THEME.diffRemoved);
    expect(grid.getCell(3, 10)?.style?.fg).toBe(DEFAULT_THEME.diffRemoved);
    expect(grid.getCell(5, 10)?.style?.fg).toBe(DEFAULT_THEME.diffAdded);
    expect(grid.getCell(6, 10)?.style?.fg).toBe(DEFAULT_THEME.diffAdded);
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
    expect(readRow(grid2, 3, width)).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
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
    expect(readRow(grid, 3, width)).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回'); // 已收起
  });

  it('底行滚动位置指示（48 轮件 B——codex percent 同义滚动进度比）：顶 0 与中段值变与尾 100', () => {
    // 单文件 44 行组体长清单 + 固定小 height 渲染（非 measure 全高惯例形——
    // 全高恒短清单 100% 锁不住滚动；viewHeight=10 < rows 45 滚动账真实成立）
    const bigPatch = `*** Update File: src/big.ts\n${Array.from({ length: 44 }, (_, i) => `+big-${i}`).join('\n')}`;
    const onExit = vi.fn();
    const viewer = new DiffViewer({
      messages: [assistant([editCall('t1', bigPatch)]), result('t1')],
      theme: DEFAULT_THEME,
      sessionId: 'sess-x',
      onExit,
    });
    const width = 64;
    const height = 12; // viewHeight = 10；rows = 1 组头 + 44 组体 = 45（maxOffset 35）
    viewer.handleEvent(k('enter')); // 展开光标组（初光标 = 组头行 0）
    const readBottom = () => {
      const grid = new CellGrid(width, height);
      viewer.render(grid, { row: 0, col: 0, width, height });
      return readRow(grid, height - 1, width);
    };
    viewer.handleEvent(k('home')); // 光标回组头——offset 夹回 0
    expect(readBottom()).toBe('0% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
    viewer.handleEvent(k('pagedown')); // 光标 0→10 → 光标驱动 offset 1
    viewer.handleEvent(k('pagedown')); // 光标 10→20 → offset 11 → floor(11/35×100)=31
    expect(readBottom()).toBe('31% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
    viewer.handleEvent(k('end')); // 光标尾行 → offset 压至 maxOffset 35
    expect(readBottom()).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
  });

  it('height=2 形位标缺席（viewHeight=0 零内容行无位置语义——底行纯教学位）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, 2);
    viewer.render(grid, { row: 0, col: 0, width, height: 2 });
    expect(readRow(grid, 1, width)).toBe('↑↓ 移动 · enter 展开/收起 · q/esc 返回');
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
    expect(readRow(grid2, 2, width)).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
  });

  it('split 半栏超宽硬折行——两侧独立折续行承接 + 中缝不越（49 轮件 A 翻档；… 省略位两形同律句随形改帽行语义）', () => {
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
    // 左半预算 45（半栏 49 − 槽 3 − 前缀 1）：'old '+60x 共 64 列折 2 视觉行
    //（45 + 19）——首视觉行截于折点（'old ' 4 + 41x）；右半同律 y
    expect(readSeg(grid, 2, 0, 49)).toBe(' 1 -old ' + 'x'.repeat(41));
    expect(readSeg(grid, 2, 50, 100)).toBe(' 1 +new ' + 'y'.repeat(41));
    // 续行承接：空槽 + 前缀列空格 + 余段（19 列）——两侧独立折同律
    expect(readSeg(grid, 3, 0, 49)).toBe(' '.repeat(4) + 'x'.repeat(19));
    expect(readSeg(grid, 3, 50, 100)).toBe(' '.repeat(4) + 'y'.repeat(19));
    // 中缝列不越占（两侧折行文本恒止步缝前）
    expect(grid.getCell(2, 49)?.grapheme ?? ' ').toBe(' ');
    expect(grid.getCell(3, 49)?.grapheme ?? ' ').toBe(' ');
  });
});

/* ---- 挖掘 45 轮件 E：组体行级 bg 色带（diffAddedBg/diffRemovedBg 副屏第二消费位——07 §4.1 2026-10-16 接档注） ---- */

describe('DiffViewer 组体行 bg 色带（挖掘 45 轮件 E）', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  /** 读某格 bg 色值（带断言 helper——undefined = 无带） */
  const bgAt = (grid: CellGrid, row: number, col: number) => grid.getCell(row, col)?.style?.bg;

  /** 双组夹具（docs/two.md 收起占屏行 1——展开 src/one.ts 后组头@2/ctx@3/del@4/add@5） */
  const MESSAGES: readonly DiffProjectionMessage[] = [
    assistant([editCall('t1', PATCH_A), editCall('t2', PATCH_B)]),
    result('t1'),
    result('t2'),
  ];

  /** truecolor 双板主题（R-3 键面三档锁已辖值域——此处只锁消费 wiring） */
  const darkTrue = resolveTheme(DARK_PALETTE, 'truecolor');
  const lightTrue = resolveTheme(LIGHT_PALETTE, 'truecolor');

  function makeViewer(overrides: Partial<DiffViewerOptions> = {}) {
    const onExit = vi.fn();
    const viewer = new DiffViewer({
      messages: MESSAGES,
      theme: darkTrue,
      sessionId: 'sess-x',
      onExit,
      ...overrides,
    });
    return { viewer, onExit };
  }

  /** 双组形展开 src/one.ts（down 到第二组头 + enter）→ paint */
  function paintExpanded(viewer: DiffViewer, width: number) {
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    return grid;
  }

  it('unified 形 add 与 del 行施行级全宽 bg 色带——槽区与前缀与变段与行尾衬底四段全覆盖、ctx 行与组头无带（修前红）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = paintExpanded(viewer, width);
    // del 行（屏行 4，槽 '2 1'）整行带四段全覆盖：光标位空格落带、槽区 dim 与
    // bg 合流（新对象 toEqual）、前缀与变段 fg+bg 双通道、same 段洞补裸 bg、
    // 行尾衬底（文本外余列由 pre-fill 底带覆盖）
    expect(grid.getCell(4, 0)?.style).toEqual({ bg: darkTrue.diffRemovedBg });
    expect(grid.getCell(4, 2)?.style).toEqual({ dim: true, bg: darkTrue.diffRemovedBg });
    expect(grid.getCell(4, 4)?.style).toEqual({ fg: darkTrue.diffRemoved, bg: darkTrue.diffRemovedBg });
    expect(grid.getCell(4, 5)?.style).toEqual({ fg: darkTrue.diffRemoved, bg: darkTrue.diffRemovedBg });
    expect(grid.getCell(4, 9)?.style).toEqual({ bg: darkTrue.diffRemovedBg }); // same 段洞补
    expect(bgAt(grid, 4, 40)).toBe(darkTrue.diffRemovedBg); // 行尾衬底
    // add 行（屏行 5 首个 add——new 轨）：add 带
    expect(bgAt(grid, 5, 40)).toBe(darkTrue.diffAddedBg);
    // ctx 行（屏行 3）与组头（屏行 2）无带（codex DiffLineType::Context 同律）
    expect(bgAt(grid, 3, 40)).toBeUndefined();
    expect(bgAt(grid, 2, 40)).toBeUndefined();
  });

  it('split 双栏双色带——对行左半 del 带右半 add 带、中缝 1 列恒裸、孤增行单侧带、ctx split 行双半无带（修前红）', () => {
    const { viewer } = makeViewer();
    const width = 100;
    viewer.measure(width); // 形随宽先行（100 ≥ 阈值 → split 行空间）
    viewer.handleEvent(k('down'));
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 对行（屏行 4）：左半 del 带 [0,49)、缝 49 恒裸、右半 add 带 [50,100)
    expect(bgAt(grid, 4, 10)).toBe(darkTrue.diffRemovedBg);
    expect(bgAt(grid, 4, 48)).toBe(darkTrue.diffRemovedBg);
    expect(bgAt(grid, 4, 49)).toBeUndefined(); // 中缝列不铺
    expect(bgAt(grid, 4, 50)).toBe(darkTrue.diffAddedBg);
    expect(bgAt(grid, 4, 90)).toBe(darkTrue.diffAddedBg);
    // 孤增行（屏行 5 +extra 单右挂）：左半空挂无带、右半 add 带
    expect(bgAt(grid, 5, 10)).toBeUndefined();
    expect(bgAt(grid, 5, 60)).toBe(darkTrue.diffAddedBg);
    // ctx split 行（屏行 3）双半无带
    expect(bgAt(grid, 3, 10)).toBeUndefined();
    expect(bgAt(grid, 3, 60)).toBeUndefined();
  });

  it('16 档缺席腿——DEFAULT_THEME 无带纯前景、槽 dim 恒等现状（identity 回归锁：缺席腿恒等传 HINT_STYLE 不造新对象）', () => {
    const { viewer } = makeViewer({ theme: DEFAULT_THEME });
    const width = 64;
    const grid = paintExpanded(viewer, width);
    expect(bgAt(grid, 4, 0)).toBeUndefined();
    expect(bgAt(grid, 4, 40)).toBeUndefined();
    // 槽区样式恒等 DIM_STYLE（与既有 470 行 toBe identity 锁同源——缺席腿
    // 误造新对象即凿穿该锁）
    expect(grid.getCell(4, 2)?.style).toBe(DIM_STYLE);
  });

  it('光标行钉随——› 标记落带上不凿洞（修前红）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    viewer.handleEvent(k('down'));
    viewer.handleEvent(k('enter')); // 展开后光标钉组头（屏行 2）
    viewer.handleEvent(k('down')); // → ctx（屏行 3）
    viewer.handleEvent(k('down')); // → del 行（屏行 4）
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(grid.getCell(4, 0)?.grapheme).toBe('›');
    expect(grid.getCell(4, 0)?.style).toEqual({ bg: darkTrue.diffRemovedBg }); // 标记写携带不凿洞
  });

  it('light 板带值消费 wiring——del 行带 = 亮板 diffRemovedBg（修前红：非暗板专用）', () => {
    const { viewer } = makeViewer({ theme: lightTrue });
    const width = 64;
    const grid = paintExpanded(viewer, width);
    expect(bgAt(grid, 4, 40)).toBe(lightTrue.diffRemovedBg);
    expect(bgAt(grid, 5, 40)).toBe(lightTrue.diffAddedBg);
  });

  it('超帽行收口带尾完整——帽行 … 后余列仍衬底（pre-fill 语义：截断点后无裸尾；49 轮件 A 随折行形迁移）', () => {
    // 内容 600 列 > 预算 59 × 帽 9 → 折行帽收口：第 8 续行（屏行 10）'…' 截断
    const patch = ['*** Begin Patch', '*** Update File: src/one.ts', `-old ${'x'.repeat(600)}`, '*** End Patch'].join(
      '\n',
    );
    const { viewer } = makeViewer({ messages: [assistant([editCall('t1', patch)]), result('t1')] });
    const width = 64;
    viewer.handleEvent(k('enter')); // 展开唯一组（光标钉组头）→ del 行落屏行 2
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 帽行（第 8 续行）'…' 收口——超帽内容截断有示（'…' 语义随形翻档：帽收口位）
    expect(readRow(grid, 10, width).endsWith('…')).toBe(true);
    for (let c = 5; c < width; c++) {
      expect(bgAt(grid, 10, c)).toBe(darkTrue.diffRemovedBg); // 带连续性——截断点后余列恒衬底
    }
    // 全视觉行带承继（首视觉行与中段续行同律——band 全视觉行铺）
    for (let c = 5; c < width; c++) {
      expect(bgAt(grid, 2, c)).toBe(darkTrue.diffRemovedBg);
      expect(bgAt(grid, 6, c)).toBe(darkTrue.diffRemovedBg);
    }
  });

  it('极窄窗内容零预算——槽区占满时带仍整行（空内容带行：renderLineContent room 0 早退、pre-fill 已铺）', () => {
    const patch = ['*** Begin Patch', '*** Update File: src/one.ts', '-x', '*** End Patch'].join('\n');
    const { viewer } = makeViewer({ messages: [assistant([editCall('t1', patch)]), result('t1')] });
    const width = 4;
    viewer.handleEvent(k('enter')); // 展开唯一组 → del 行落屏行 2
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(bgAt(grid, 2, 1)).toBe(darkTrue.diffRemovedBg);
    expect(bgAt(grid, 2, 3)).toBe(darkTrue.diffRemovedBg);
  });
});

/* ---- 挖掘 49 轮件 A：超宽行硬折行续行（ellipsize 截断翻档——codex diff_render.rs
       「long lines are hard-wrapped at the available column width」同律）---- */

describe('DiffViewer 超宽行硬折行（挖掘 49 轮件 A）', () => {
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

  /** 读某格 bg 色值（带断言 helper——undefined = 无带） */
  const bgAt = (grid: CellGrid, row: number, col: number) => grid.getCell(row, col)?.style?.bg;

  const darkTrue = resolveTheme(DARK_PALETTE, 'truecolor');

  function makeViewer(patch: string, theme = DEFAULT_THEME) {
    const viewer = new DiffViewer({
      messages: [assistant([editCall('t1', patch)]), result('t1')],
      theme,
      sessionId: 'sess-x',
      onExit: vi.fn(),
    });
    return viewer;
  }

  it('续行帽 8 几何上界——600 列折 11 段帽至 9 视觉行、帽行 … 收口、非帽行无 …', () => {
    // 内容预算 59（64 − 槽区 4 − 前缀 1）：'old '+600x 共 604 列 → 11 段 →
    // 帽 8：首 + 8 续 = 9 视觉行上界（护帧预算——巨宽单行不炸屏）
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/one.ts', `-old ${'x'.repeat(600)}`, '*** End Patch'].join('\n'),
    );
    const width = 64;
    viewer.handleEvent(k('enter')); // 展开唯一组 → 组体屏行 2 起
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 行账锁：标题 1 + 组头 1 + 组体 9 + footer 1 = 12（修前截断形 4——帽上界生效实证）
    expect(grid.rows).toBe(12);
    // 首视觉行：'old ' 入首段（59 列 = 'old ' 4 + 55x）、行号前缀照常
    expect(readRow(grid, 2, width)).toBe(' 1  -old ' + 'x'.repeat(55));
    // 中段续行（第 5 视觉行）：满段 59x
    expect(readRow(grid, 6, width)).toBe(' '.repeat(5) + 'x'.repeat(59));
    // 帽行（第 8 续行 = 屏行 10）：59x+'…' 超 59 → ellipsize 收口 58x+'…'（'…'
    // 恒在场——帽行片恰满宽不触超宽路，收口形片尾拼 … 后整体过 ellipsize 单源）
    expect(readRow(grid, 10, width)).toBe(' '.repeat(5) + 'x'.repeat(58) + '…');
    // 非帽行无 …（省略号只在帽收口位——'…' 语义随形翻档的几何面锁）
    for (let r = 3; r <= 9; r++) expect(readRow(grid, r, width)).not.toContain('…');
  });

  it('percent 按视觉行账——折行展开行数涨、end 到底 100 与 home 回顶 0（48B 解耦红利首消费件）', () => {
    // 10 行各 133 列（'l0 '+130x）→ 每行 3 视觉行 → 行空间 1 + 30 = 31
    const lines = Array.from({ length: 10 }, (_, i) => `-l${i} ${'x'.repeat(130)}`);
    const viewer = makeViewer(['*** Begin Patch', '*** Update File: src/big.ts', ...lines, '*** End Patch'].join('\n'));
    const width = 64;
    const height = 8; // viewHeight = 6 < 行空间 31——滚动账真实成立
    viewer.handleEvent(k('enter'));
    const readBottom = (): string => {
      const grid = new CellGrid(width, height);
      viewer.render(grid, { row: 0, col: 0, width, height });
      return readRow(grid, height - 1, width);
    };
    // 量高随视觉行展开（标题 1 + 组头 1 + 组体 30 + footer 1 = 33；修前每行截断 1 视觉行 = 13）
    expect(viewer.measure(width)).toBe(33);
    viewer.handleEvent(k('home'));
    expect(readBottom()).toBe('0% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
    viewer.handleEvent(k('end')); // 光标尾视觉行 → offset 压至 maxOffset（31 − 6 = 25）
    expect(readBottom()).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
    viewer.handleEvent(k('home'));
    viewer.handleEvent(k('pagedown')); // 中段非端点（视觉行粒度光标行走）
    const mid = readBottom();
    expect(mid).toContain('%');
    expect(mid.startsWith('0%')).toBe(false);
    expect(mid.startsWith('100%')).toBe(false);
  });

  it('光标停续行——› 落续行首列钉随带上（视觉行粒度行走：flatRows 展开后光标账跟新）', () => {
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/one.ts', `-old ${'x'.repeat(600)}`, '*** End Patch'].join('\n'),
      darkTrue,
    );
    const width = 64;
    viewer.measure(width); // 形随宽先行（事件面 flatRows 折行粒度依赖 lastWidth——渲染前缺省 0 单行形；真实序首帧先于键）
    viewer.handleEvent(k('enter')); // 光标 = 组头（行空间 0）
    for (let i = 0; i < 7; i++) viewer.handleEvent(k('down')); // → 行空间 7（第 7 视觉行）
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 光标行 7 = 第 7 视觉行（中段续行）→ 屏行 8：› 覆首列、内容片不扰
    expect(readRow(grid, 8, width)).toBe('›' + ' '.repeat(4) + 'x'.repeat(59));
    // 钉随不凿洞（件 E 同律）：标记写携带行级带
    expect(grid.getCell(8, 0)?.style).toEqual({ bg: darkTrue.diffRemovedBg });
  });

  it('split 短侧衬空——对行左折 2 右 1：第二视觉行右半空挂但带与槽仍铺、中缝恒裸', () => {
    // 左半 'old '+60x 共 64 列 → 45+19 两视觉行；右半 'new' 3 列单片 → pair
    // 折数取 max=2，右第二视觉行衬空（带属行级非片级——diff 并排语义对齐）
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/wide.ts', `-old ${'x'.repeat(60)}`, '+new', '*** End Patch'].join('\n'),
      darkTrue,
    );
    const width = 100;
    viewer.measure(width); // 形随宽先行（split 行空间）
    viewer.handleEvent(k('enter')); // 对行合并行落屏行 2
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 第一视觉行：左侧首段 + 右侧整行（短侧首即末）
    expect(readSeg(grid, 2, 0, 49)).toBe(' 1 -old ' + 'x'.repeat(41));
    expect(readSeg(grid, 2, 50, 100)).toBe(' 1 +new');
    // 第二视觉行：左续行承接、右半空挂（trimEnd 收口空）但 add 带衬空铺
    expect(readSeg(grid, 3, 0, 49)).toBe(' '.repeat(4) + 'x'.repeat(19));
    expect(readSeg(grid, 3, 50, 100)).toBe('');
    expect(bgAt(grid, 3, 60)).toBe(darkTrue.diffAddedBg);
    // 中缝列恒裸（衬空视觉行同律——带不越缝）
    expect(bgAt(grid, 3, 49)).toBeUndefined();
  });

  it('极窄窗多字素行视觉行恒 1——avail ≤ 0 守卫（wrapByGraphemes 逐字素成段防虚胀；调用位自守）', () => {
    // width=5：内容预算 = 5 − 槽区 4 − 前缀 1 = 0 → 守卫单片（修前若直入
    // wrapByGraphemes(text, 0) 逐字素成段 8 行 → measure 11 虚胀——守卫回归锁）
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/one.ts', '-abcdefgh', '*** End Patch'].join('\n'),
    );
    const width = 5;
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 行账：标题 1 + 组头 1 + 组体 1（恒单视觉行）+ footer 1 = 4
    expect(grid.rows).toBe(4);
    // 内容位 room 0（槽区 4 + 前缀 1 占满 5 列）——renderLineContent 早退零写
    //（与件 E 极窄窗带行同律：守卫锁行账，内容不可见不是缺字）
    expect(readRow(grid, 2, width)).toBe(' 1  -');
  });

  it('孤增行孤立路折行——Add File 体整行增：前缀 + 仅首视觉行、尾段可达、着色跨切点', () => {
    // 孤立路（无词级对行）：Add File 体 '+' 前缀剥除后 '# '+50b 共 52 列折
    // 3 视觉行（19+19+14）——尾段完整可达（本件核心价值的孤立行面）
    const viewer = makeViewer(`*** Add File: src/new.md\n+# ${'b'.repeat(50)}`);
    const width = 24;
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width)).toBe('   1+# ' + 'b'.repeat(17));
    expect(readRow(grid, 3, width)).toBe(' '.repeat(5) + 'b'.repeat(19));
    expect(readRow(grid, 4, width)).toBe(' '.repeat(5) + 'b'.repeat(14));
    // 孤增行整行 diffAdded 前景——折行后各视觉行同色（跨切点保留）
    expect(grid.getCell(2, 8)?.style?.fg).toBe(DEFAULT_THEME.diffAdded);
    expect(grid.getCell(3, 10)?.style?.fg).toBe(DEFAULT_THEME.diffAdded);
    expect(grid.getCell(4, 10)?.style?.fg).toBe(DEFAULT_THEME.diffAdded);
  });

  it('ctx 行孤立路折行——前缀列恒空、尾段可达、ctx 裸无变段前景', () => {
    // ctx 行文本 ' '+44c 共 45 列折 3 视觉行（19+19+7）；ctx 无 -/+ 前缀
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/one.ts', ` ${'c'.repeat(44)}`, '-old', '+new', '*** End Patch'].join(
        '\n',
      ),
    );
    const width = 24;
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // ctx 双轨槽 '1 1' + 前缀列空 + 首段（空格 + 18c）
    expect(readRow(grid, 2, width)).toBe(' 1 1  ' + 'c'.repeat(18));
    expect(readRow(grid, 3, width)).toBe(' '.repeat(5) + 'c'.repeat(19));
    expect(readRow(grid, 4, width)).toBe(' '.repeat(5) + 'c'.repeat(7));
    // ctx 裸（无变段前景——续行同律）
    expect(grid.getCell(2, 10)?.style?.fg).toBeUndefined();
    expect(grid.getCell(3, 10)?.style?.fg).toBeUndefined();
  });

  it('恰满段形无截断——折出恰 1+帽 段全呈现、末视觉行完整不强制 … 收口（68 轮件 G：截断事实单源）', () => {
    // 531 列恰折 9 段（= 1+帽 8，无截断——segments.length > maxRows 为假不
    // slice）：count 反推形把末行误判帽行强制 '…' 收口丢末段尾字素（对未截断
    // 文本删数据）。修法真源：截断事实在切片装配位显式携带、帽行判据消费该位。
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/full.ts', `-${'x'.repeat(531)}`, '*** End Patch'].join('\n'),
    );
    const width = 64; // 内容预算 59（64 − 槽区 4 − 前缀 1）：531 = 59 × 9 恰满
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 行账：标题 1 + 组头 1 + 组体 9（恰满段全呈现）+ footer 1 = 12
    expect(grid.rows).toBe(12);
    // 末视觉行（第 8 续行 = 屏行 10）：完整末段 59x——修前误判帽行收口 58x+'…' 红
    expect(readRow(grid, 10, width)).toBe(' '.repeat(5) + 'x'.repeat(59));
    // 全帧无 '…'（恰满段形非截断面——省略号只在真截断帽行）
    for (let r = 2; r <= 10; r++) expect(readRow(grid, r, width)).not.toContain('…');
  });

  it('最小真截断形——恰满 + 1 列翻截断：帽行 … 收口在场（68 轮件 G 正锁——既有截断语义保持）', () => {
    // 532 列折 10 段（恰满 531 + 1）→ 段数超 1+帽 9 真截：帽至 9 视觉行、末帽
    // 行 '…' 收口示截断（与恰满形相差 1 列——边界对拍锁真截断判据不漂）
    const viewer = makeViewer(
      ['*** Begin Patch', '*** Update File: src/over.ts', `-${'x'.repeat(532)}`, '*** End Patch'].join('\n'),
    );
    const width = 64;
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(grid.rows).toBe(12); // 帽上界同 9 视觉行
    // 帽行（第 8 续行 = 屏行 10）：59x+'…' 超 59 → ellipsize 收口 58x+'…'
    expect(readRow(grid, 10, width)).toBe(' '.repeat(5) + 'x'.repeat(58) + '…');
    // 非帽行无 …（省略号只在帽收口位——既有几何面锁）
    for (let r = 3; r <= 9; r++) expect(readRow(grid, r, width)).not.toContain('…');
  });

  it('gap 分隔行不折——段间 ⋮ 视觉行恒 1（wrap 只作用组体内容行：既有消费面零扰）', () => {
    // 同文件两段须两 call 形（foldSessionDiff 跨 call 段序聚合到同组——单 call
    // 内同路径二段头不认段）：各段超宽行折 3 视觉行 ×2 + gap 1 → 组体 7 行
    const viewer = new DiffViewer({
      messages: [
        assistant([editCall('t1', `*** Update File: src/one.ts\n-old ${'x'.repeat(44)}`)]),
        result('t1'),
        assistant([editCall('t2', `*** Update File: src/one.ts\n+new ${'y'.repeat(44)}`)]),
        result('t2'),
      ],
      theme: DEFAULT_THEME,
      sessionId: 'sess-x',
      onExit: vi.fn(),
    });
    const width = 24; // 内容预算 19：'old '+44x 共 48 列折 3 视觉行（19+19+10）
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 行账：标题 1 + 组头 1 +（3 视觉行 + gap 1 + 3 视觉行）+ footer 1 = 10
    expect(grid.rows).toBe(10);
    // gap ⋮ 行（屏行 5）恰单行——槽区空 + ⋮ 落内容列（:1010 同形；折行不波及 gap 形）
    expect(readRow(grid, 5, width)).toBe('    ⋮');
    // 前后段折行在场（gap 不折 ≠ 段内不折——两面同帧锁）；段 2 无回执续前段
    // 尾游标：新轨 1（段 1 纯删无新轨行）
    expect(readRow(grid, 4, width)).toBe(' '.repeat(5) + 'x'.repeat(10));
    expect(readRow(grid, 6, width)).toBe('   1+new ' + 'y'.repeat(15));
  });
});

/* ---- 挖掘 45 轮件 D：真行号（回执 meta → 真帧游标）+ 段间 ⋮ 分隔（codex diff_render.rs 同律） ---- */

describe('DiffViewer 真行号与段间分隔（挖掘 45 轮件 D）', () => {
  /** 读回一行（trimEnd——前导空格入期望串，与既有断言书写律一致） */
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

  /** PATCH_A 的 edit 回执（operations 槽 0 = src/one.ts update，真帧起点 7） */
  const META_A = { operations: [{ op: 'update', path: 'src/one.ts', startLine: 7 }] };

  function makeViewer(messages: readonly DiffProjectionMessage[]) {
    const onExit = vi.fn();
    const viewer = new DiffViewer({ messages, theme: DEFAULT_THEME, sessionId: 'sess-x', onExit });
    return { viewer, onExit };
  }

  /** 单组展开 paint（收起单组头光标钳 0——enter 即展开；组体起屏行 2） */
  function paintExpanded(viewer: DiffViewer, width: number) {
    viewer.handleEvent(k('enter'));
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    return grid;
  }

  it('update 段真帧游标自回执 startLine 起算（修前红：patch 相对帧 1,1 起）', () => {
    const { viewer } = makeViewer([assistant([editCall('t1', PATCH_A)]), result('t1', META_A)]);
    const grid = paintExpanded(viewer, 64);
    // 双侧自 7 起算（codex old_range/new_range 双起同律）；行进律维持：
    // ctx 双轨同进 / 对行双进 / 孤增新轨前进——W=1（组最大号 9）
    expect(readRow(grid, 2, 64)).toBe(' 7 7  ctx line');
    expect(readRow(grid, 3, 64)).toBe(' 8  -old line');
    expect(readRow(grid, 4, 64)).toBe('   8+new line');
    expect(readRow(grid, 5, 64)).toBe('   9+extra line');
  });

  it('段间 ⋮ 分隔行——同文件多段段界标记（槽区空、锚行位精确；组头 ⋮ 同字符不误伤）', () => {
    // 同文件两 call：S1 真帧 7..9、S2 缺席（无 meta）续前段尾游标跨界续算
    const messages = [
      assistant([editCall('t1', PATCH_A)]),
      result('t1', META_A),
      assistant([editCall('t2', '*** Update File: src/one.ts\n-second old')]),
      result('t2'),
    ];
    const { viewer } = makeViewer(messages);
    const grid = paintExpanded(viewer, 64);
    expect(readRow(grid, 2, 64)).toBe(' 7 7  ctx line');
    expect(readRow(grid, 5, 64)).toBe('   9+extra line');
    // gap 行：行号槽区整段空、⋮ 落内容列（col 2W+2=4）——精确行位断言
    //（组头孤儿 ⋮ 亦用同字符，禁全局 not.toContain 语料陷阱）
    expect(readRow(grid, 6, 64)).toBe('    ⋮');
    // 缺席段续 S1 尾游标（S1 旧轨尾 8 → S2 删行 9）——诚实续算非重置
    expect(readRow(grid, 7, 64)).toBe(' 9  -second old');
  });

  it('多文件回执段序对齐——operations 跨文件连续计（call 内段序 = 槽序）', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/one.ts',
      ' ctx line',
      '-old line',
      '+new line',
      '*** Update File: docs/two.md',
      ' alpha',
      '-beta',
      '+gamma',
      '*** End Patch',
    ].join('\n');
    const meta = {
      operations: [
        { op: 'update', path: 'src/one.ts', startLine: 7 },
        { op: 'update', path: 'docs/two.md', startLine: 100 },
      ],
    };
    const { viewer } = makeViewer([assistant([editCall('t1', patch)]), result('t1', meta)]);
    const width = 64;
    viewer.handleEvent(k('enter')); // 展开首组（字典序 docs/two.md 在前）——槽 1 真帧
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // docs 组（槽 1 → 100，W=3 位数自适应；null 槽 = W 空格——空槽区保位）
    expect(readRow(grid, 2, width)).toBe(' 100 100  alpha');
    expect(readRow(grid, 3, width)).toBe(' 101    -beta');
    expect(readRow(grid, 4, width)).toBe('     101+gamma');
    viewer.handleEvent(k('enter')); // 收起 docs
    viewer.handleEvent(k('down')); // → src/one.ts 组头
    viewer.handleEvent(k('enter')); // 展开——槽 0 真帧 7
    const grid2 = new CellGrid(width, viewer.measure(width));
    viewer.render(grid2, { row: 0, col: 0, width, height: grid2.rows });
    // docs 收起后仍占屏行 1（组头行）——src 组体起屏行 3
    expect(readRow(grid2, 3, width)).toBe(' 7 7  ctx line');
    expect(readRow(grid2, 4, width)).toBe(' 8  -old line');
  });

  it('add 段新轨自 1——非 update 段忽略 startLine 坏形（回执在场即新文件帧）', () => {
    // A. 混组形（S1 update 真帧 + S2 Add File 同键）：add 槽带 startLine 99 坏形
    // → 忽略、新轨自 1（非续 S1 新轨尾 9 → 10）
    const messages = [
      assistant([editCall('t1', PATCH_A)]),
      result('t1', META_A),
      assistant([editCall('t2', '*** Add File: src/one.ts\n+fresh line')]),
      result('t2', { operations: [{ op: 'add', path: 'src/one.ts', startLine: 99 }] }),
    ];
    const { viewer } = makeViewer(messages);
    const grid = paintExpanded(viewer, 64);
    expect(readRow(grid, 6, 64)).toBe('    ⋮');
    expect(readRow(grid, 7, 64)).toBe('   1+fresh line'); // 新轨自 1——99 坏形被裁
    // B. 纯 add 组（新文件单段）：坏形同裁、行号即新文件行号 1..N
    const { viewer: vb } = makeViewer([
      assistant([editCall('t3', '*** Add File: fresh.md\n+# a\n+# b')]),
      result('t3', { operations: [{ op: 'add', path: 'fresh.md', startLine: 99 }] }),
    ]);
    const gridB = paintExpanded(vb, 64);
    expect(readRow(gridB, 2, 64)).toBe('   1+# a');
    expect(readRow(gridB, 3, 64)).toBe('   2+# b');
  });

  it('回执缺席回退组内连续相对帧——无 meta 行号同现状 1,1 起（缺席律回归锁）', () => {
    const { viewer } = makeViewer([assistant([editCall('t1', PATCH_A)]), result('t1')]);
    const grid = paintExpanded(viewer, 64);
    expect(readRow(grid, 2, 64)).toBe(' 1 1  ctx line');
    expect(readRow(grid, 3, 64)).toBe(' 2  -old line');
    expect(readRow(grid, 4, 64)).toBe('   2+new line');
    expect(readRow(grid, 5, 64)).toBe('   3+extra line');
  });

  it('坏 meta 两档——整包弃用与槽级缺席均回退相对帧不伪号（回归锁）', () => {
    // 整包弃用档：operations 非数组 → extractDiffStartLines 整体 undefined
    const { viewer } = makeViewer([assistant([editCall('t1', PATCH_A)]), result('t1', { operations: 'oops' })]);
    const grid = paintExpanded(viewer, 64);
    expect(readRow(grid, 2, 64)).toBe(' 1 1  ctx line');
    expect(readRow(grid, 3, 64)).toBe(' 2  -old line');
    // 槽级缺席档：startLine 非数 → 该槽 undefined → 该段 null 回退（他段真帧由
    // it 1 锁）——诚实缺席非伪号
    const { viewer: v2 } = makeViewer([
      assistant([editCall('t2', PATCH_A)]),
      result('t2', { operations: [{ op: 'update', path: 'src/one.ts', startLine: 'seven' }] }),
    ]);
    const grid2 = paintExpanded(v2, 64);
    expect(readRow(grid2, 2, 64)).toBe(' 1 1  ctx line');
    expect(readRow(grid2, 4, 64)).toBe('   2+new line');
  });

  it('spacer 行 enter 回溯组头可展开态翻转——gap 行入行空间可导航（修前红）', () => {
    const messages = [
      assistant([editCall('t1', PATCH_A)]),
      result('t1', META_A),
      assistant([editCall('t2', '*** Update File: src/one.ts\n-second old')]),
      result('t2'),
    ];
    const { viewer } = makeViewer(messages);
    const width = 64;
    viewer.handleEvent(k('enter')); // 展开（flat = 组头 + 6 组体行，gap 在 flat 5）
    for (let i = 0; i < 5; i++) viewer.handleEvent(k('down')); // → gap 行（屏行 6）
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(grid.getCell(6, 0)?.grapheme).toBe('›'); // 光标钉 gap 行
    expect(readRow(grid, 6, width)).toBe('›   ⋮');
    viewer.handleEvent(k('enter')); // gap 行 enter = 回溯组头 → 收起
    const grid2 = new CellGrid(width, viewer.measure(width));
    viewer.render(grid2, { row: 0, col: 0, width, height: grid2.rows });
    expect(readRow(grid2, 2, width)).toBe('100% · ↑↓ 移动 · enter 展开/收起 · q/esc 返回');
  });

  it('split 双栏 gap 行与真帧号宽自适应——⋮ 落左内容列、千位号宽 4 位（修前红）', () => {
    const messages = [
      assistant([editCall('t1', PATCH_A)]),
      result('t1', { operations: [{ op: 'update', path: 'src/one.ts', startLine: 1234 }] }),
      assistant([editCall('t2', '*** Update File: src/one.ts\n-tail old')]),
      result('t2'),
    ];
    const { viewer } = makeViewer(messages);
    const width = 100;
    viewer.measure(width); // 形随宽先行（split 行空间）
    viewer.handleEvent(k('enter')); // 展开——flat split = [组头, ctx, 对行, 孤增, gap, 孤删]
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // W=4（组最大号 1236）——真帧千位号宽自适应、内容预算收缩（split 槽与
    // 前缀间有 1 未写空列 + ctx 体保前导空格——双空格叠未写列成三空格）
    expect(readSeg(grid, 2, 0, 49)).toBe(' 1234   ctx line');
    expect(readSeg(grid, 3, 0, 49)).toBe(' 1235 -old line');
    expect(readSeg(grid, 3, 50, 100)).toBe(' 1235 +new line');
    // gap 行（屏行 5）：⋮ 落左内容列（col numWidth+2=6）、右半空
    expect(readSeg(grid, 5, 0, 49)).toBe('      ⋮');
    expect(readSeg(grid, 5, 50, 100)).toBe('');
    // 缺席段孤删行续前段尾（旧轨尾 1235 → 1236）
    expect(readSeg(grid, 6, 0, 49)).toBe(' 1236 -tail old');
  });

  it('混排帧——段粒度分帧：多段真帧各自成帧（后段真帧重起双轨、回看亦然）', () => {
    const messages = [
      assistant([editCall('t1', PATCH_A)]),
      result('t1', META_A),
      // S2 真帧 3（< S1 尾 9——回看重起：双轨自 3 重算，非续 10）
      assistant([editCall('t2', '*** Update File: src/one.ts\n ctx2\n-second old')]),
      result('t2', { operations: [{ op: 'update', path: 'src/one.ts', startLine: 3 }] }),
    ];
    const { viewer } = makeViewer(messages);
    const grid = paintExpanded(viewer, 64);
    expect(readRow(grid, 5, 64)).toBe('   9+extra line'); // S1 真帧尾
    expect(readRow(grid, 6, 64)).toBe('    ⋮');
    expect(readRow(grid, 7, 64)).toBe(' 3 3  ctx2'); // S2 真帧重起（回看重起双轨）
    expect(readRow(grid, 8, 64)).toBe(' 4  -second old');
  });
});

describe('flatRows 词级 DP 组体缓存（挖掘 50 轮件 A——零 DP 重跑）', () => {
  /** 计数器逐 it 重置（vi.mock 工厂一次性——计数器跨 it 累积） */
  beforeEach(() => {
    diffWordsCalls.count = 0;
  });

  it('展开组重复消费不重算——光标动作+measure+render 复跑计数恒平（修前红：每 flatRows 全量重算）', () => {
    // 单组夹具（src/one.ts——含相邻 del+add 对）：两组夹具首组 docs/two.md 是
    // Add File 零相邻对（bodyRowsOf 对其永不调 diffWords——冷读勘正：主锁须落
    // 有对组；单组唯一组头即光标 0 位，enter 直展免 down）
    const viewer = new DiffViewer({
      messages: [assistant([editCall('t1', PATCH_A)]), result('t1')],
      theme: DEFAULT_THEME,
      sessionId: 'sess-abcdef1234567890',
      onExit: vi.fn(),
    });
    const width = 64;
    viewer.handleEvent(k('enter')); // 展开唯一组
    viewer.measure(width);
    let grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(diffWordsCalls.count).toBeGreaterThan(0); // 夹具有效前置（PATCH_A 一对相邻对）
    const afterFirstPass = diffWordsCalls.count;
    // 第二遍全量消费：光标动作（handleEvent 消费面）+ measure + render 三面复跑
    viewer.handleEvent(k('down'));
    viewer.measure(width);
    grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 修后：组体命中缓存零重跑（修前每 flatRows 全量重算——计数涨红）
    expect(diffWordsCalls.count).toBe(afterFirstPass);
  });

  it('未展开组零调用——全收起态 measure+render 后计数为零（continue 前置现状锁）', () => {
    const viewer = new DiffViewer({
      messages: [assistant([editCall('t1', PATCH_A)]), result('t1')],
      theme: DEFAULT_THEME,
      sessionId: 'sess-abcdef1234567890',
      onExit: vi.fn(),
    });
    const width = 64;
    viewer.measure(width);
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(diffWordsCalls.count).toBe(0); // flatRows 组头后 continue 前置——bodyRowsOf 零达
  });
});
