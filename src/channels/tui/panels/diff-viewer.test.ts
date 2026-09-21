/**
 * /diff 会话改动总览副屏件测试（07 §4.1 命令面增补批）：foldSessionDiff 聚合
 * 纯函数（分组/累计计数/字典序/孤儿 ⧗/坏串防御/非 edit 滤除）+ DiffViewer
 * 呈现（组头计数/enter 展开/收起缺省/空态/退出族）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
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
    expect(row1).toBe('▸ …');
    expect(row1).not.toContain('+1');
    expect(row1).not.toContain('-0');
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
    expect(readRow(grid, 1, width)).toContain('零 edit 类改动');
    expect(readRow(grid, grid.rows - 1, width)).toBe('q/esc 返回');
    // 空集移动键不动作、enter 不炸
    expect(viewer.handleEvent(k('down'))).toBe(true);
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });

  it('孤儿组头 ⧗ 在飞标注', () => {
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
    expect(readRow(grid, 1, width)).toContain('⧗ 在飞');
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
    // 修后整段剥除。光标符在组头——构造期单组收起态 down 被钳 0（组头）
    expect(rows[2]).not.toContain('[31m');
    expect(rows[2]).toBe('  -old line');
    expect(rows[3]).toBe('  +new line');
  });

  it('CRLF 补丁与 LF 补丁渲染逐行一致（行尾 \\r 构造位剥除——弱载体一致锁，修前修后同绿的回归锁）', () => {
    const lf = renderExpandedRows([assistant([editCall('t1', PATCH_A)]), result('t1')]);
    const crlf = renderExpandedRows([assistant([editCall('t1', PATCH_A.replaceAll('\n', '\r\n'))]), result('t1')]);
    expect(crlf).toEqual(lf);
  });
});
