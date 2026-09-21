/**
 * /memory 轻管理面副屏件单测（mm 批落码腿——06 §7 形态定形注的例面锁）。
 *
 * 覆盖：行集三段式构建（头行 owner 短显 / 健康投影恒全库口径〔假 DAO 计数
 * 刻意偏离可见集——投影不随筛选重算的结构性证据〕/ 分区头 / 条目行工具读面
 * 同形 / 冻结 ✱ / 终态 dim + supersededBy 尾缀 / 消毒遮蔽与引述注记）、
 * 行动词 f/d/r（呈现层判向 / 零义吞族 / 守卫错折底行）、confirm 两段态机
 * （Enter/y·Esc/n 双轨同判 / 其余键终局吞 / 单次语义）、e 导出输入行
 * （argv 引号感知切分同源 / 回执折行 / 查询保留续打 / 空框闸）、Tab 筛选
 * 循环（四态 + 头行注记 + 终态区客户端双过滤）、刷新重取与同 id 锚定
 * （跨分区跟随 / 锚缺席驻留原位就近）、光标模型（循环 / 零条目消隐 /
 * 溢出档顶对齐 / 滚动键不挪光标）、鼠标消费面（点行移光标 / 非条目行与
 * 模态零动作 / 滚轮）、拖选复制（挂账解挂批①——/history 件 8 细则全套
 * 对齐：LF 拼 / 反向规范化 / CJK 半格归字素首 / 反相高亮与 press 清除 /
 * 模态禁拖 / 视口外命中零动作 / 选区帽 64 KiB 拖选中滚动达帽 + 底行提示
 * 常显至清除）、退出键面（q/Esc 闭锁 / Ctrl+C 滤 release / Ctrl+D
 * 先收副屏再退）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, type CellBuffer, type InputEvent, type MouseEvent } from '../../engine/index.js';
import { MemoryViewer, type MemoryDaoFace, type MemoryRowFace, type MemorySanitize } from './memory-viewer.js';

/* ---------------- 工厂与便捷 ---------------- */

const COLS = 100;
const ROWS = 12; // 头行 1 + 视口 10 + 底铬 1
const OWNERS = ['global', 'project:0123456789abcdef'];
/** 定值时间戳（fmtTs 呈现 2026-09-11T00:00:00Z——.000Z 剥除面同锁） */
const T0 = Date.UTC(2026, 8, 11);
/** 假健康计数（刻意偏离任何可见集——恒全库口径的断言锚） */
const HEALTH = { active: 7, dismissed: 2, expired: 1, frozen: 1, total: 10 };

/** 可变行（fake DAO 动词真变行集——readonly 呈现面之上的可写底账） */
type MutRow = { -readonly [K in keyof MemoryRowFace]: MemoryRowFace[K] };

/** 行工厂（缺省 global 活体行） */
function row(id: string, over: Partial<MemoryRowFace> = {}): MutRow {
  return {
    id,
    ownerKey: 'global',
    kind: 'pref',
    summary: `摘要${id}`,
    content: '',
    status: 'active',
    supersededBy: null,
    updatedAt: T0,
    frozen: false,
    validFrom: null,
    ...over,
  };
}

/** 三态基础集（活体 a / 冻结 f / 终态 t 各一） */
function basicRows(): MutRow[] {
  return [
    row('maaaaaaa', { summary: '摘要甲' }),
    row('fbbbbbbb', { kind: 'fact', summary: '摘要乙', frozen: true }),
    row('tccccccc', { summary: '摘要丙', status: 'dismissed', supersededBy: 'user' }),
  ];
}

/** 守卫错形（code 字段 + message——errorText 折底行判据同源） */
class GuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 假 DAO（结构相容窄面——动词真变行集，守卫错可注入） */
function makeDao(rows: MutRow[], calls: string[]) {
  const find = (id: string): MutRow => {
    const r = rows.find((x) => x.id === id);
    if (r === undefined) throw new GuardError('MEMORY_NOT_FOUND', '条目不存在');
    return r;
  };
  return {
    listVisibleForManagement(ownerKeys?: readonly string[]) {
      calls.push(`listVisibleForManagement:${ownerKeys?.join(',') ?? ''}`);
      return rows.filter((r) => r.status === 'active' && (ownerKeys === undefined || ownerKeys.includes(r.ownerKey)));
    },
    listForExport() {
      calls.push('listForExport');
      return [...rows];
    },
    overview() {
      calls.push('overview');
      return { health: HEALTH };
    },
    forget(id: string, opts?: { readonly supersededBy?: string }) {
      calls.push(`forget:${id}:${opts?.supersededBy ?? ''}`);
      const r = find(id);
      if (r.frozen) throw new GuardError('MEMORY_FROZEN', '冻结条目不可忘掉');
      r.status = 'dismissed';
      r.supersededBy = opts?.supersededBy ?? 'user';
      return r;
    },
    restore(id: string) {
      calls.push(`restore:${id}`);
      const r = find(id);
      r.status = 'active';
      r.supersededBy = null;
      return r;
    },
    freeze(id: string) {
      calls.push(`freeze:${id}`);
      const r = find(id);
      r.frozen = true;
      return r;
    },
    unfreeze(id: string) {
      calls.push(`unfreeze:${id}`);
      const r = find(id);
      r.frozen = false;
      return r;
    },
  } satisfies MemoryDaoFace;
}

/** 干净消毒缺省（blocked/quoted 用例经 rig 覆盖注入） */
const CLEAN: ReturnType<MemorySanitize> = { blocked: false, patterns: [], quoted: false };

/** 装配：三柄串账 + 导出捕获（回执/异常可换装） */
function rig(
  rows: readonly MutRow[] = basicRows(),
  opts: { sanitize?: MemorySanitize; exportImpl?: (argv: readonly string[]) => Promise<string> } = {},
) {
  const log: string[] = [];
  const calls: string[] = [];
  const copies: string[] = [];
  const store = [...rows];
  const dao = makeDao(store, calls);
  const viewer = new MemoryViewer({
    ownerKeys: OWNERS,
    dao,
    sanitize: opts.sanitize ?? (() => CLEAN),
    exportCommand: opts.exportImpl ?? (() => Promise.resolve('已导出 2 条\n路径：mem.md')),
    onExit: () => log.push('exit'),
    onInterrupt: () => log.push('interrupt'), // 零参形——装配闭包已知目标会话
    onQuit: () => log.push('quit'),
    onCopy: (t) => copies.push(t), // 拖选复制捕获（挂账解挂批①——件 8 细则）
  });
  const render = (): CellGrid => {
    const grid = new CellGrid(COLS, ROWS);
    viewer.render(grid, { row: 0, col: 0, width: COLS, height: ROWS });
    return grid;
  };
  return { viewer, log, calls, copies, dao, store, render };
}

/** key 事件便捷构造（kitty disambiguate 轨形） */
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

/** 逐字符打字（导出输入行/搜索框续打用） */
function type(v: MemoryViewer, s: string): void {
  for (const ch of s) v.handleEvent(text(ch));
}

/** mouse 事件便捷构造 */
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

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellBuffer, row: number, width = COLS): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 光标行文本（整行 inverse 扫描——条目锚定的观测面） */
function cursorRowText(grid: CellBuffer): string {
  for (let r = 1; r < ROWS - 1; r++) {
    if (grid.getCell(r, 0)?.style.inverse === true) return readRow(grid, r);
  }
  return '';
}

/** 宏任务一拍（runExport 的 await 落定——命令体同步 resolve） */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ---------------- 行集三段式构建 ---------------- */

describe('行集三段式构建（头行 / 健康投影恒全库 / 三分区）', () => {
  it('头行 = 档名 + owner 并集短显（project 键 16 hex 截前 8）+ 投影两行 + 分区头计数', () => {
    const { render } = rig();
    const grid = render();
    expect(readRow(grid, 0)).toContain('❄ 记忆管理 · global · project:01234567'); // 短显截 8 位
    expect(readRow(grid, 1)).toBe('记忆库 · 在册 7 · 冻结 1 · 共 10'); // 假 DAO 全库计数（可见活体仅 1——投影不随可见集重算）
    expect(readRow(grid, 2)).toBe('终态 · 否决 2 · 过期 1');
    expect(readRow(grid, 3)).toBe('── 活体（1）');
    expect(readRow(grid, 5)).toBe('── 冻结（1）');
    expect(readRow(grid, 7)).toBe('── 终态（1）');
    expect(readRow(grid, ROWS - 1)).toContain('f 冻结 · d 忘掉 · e 导出 · tab 筛选 · q/esc 返回'); // 光标在活体首条——行动词按分区给提示
  });

  it('条目行与工具读面同形：[m:短id] [kind] summary  id=完整id  updated=ISO', () => {
    const { render } = rig();
    const grid = render();
    const line = readRow(grid, 4);
    expect(line).toContain('[m:maaaaaaa] [pref] 摘要甲');
    expect(line).toContain('id=maaaaaaa');
    expect(line).toContain('updated=2026-09-11T00:00:00Z'); // fmtTs 同源（.000Z 剥除）
  });

  it('冻结行行首 ✱；终态行 supersededBy 尾缀 + 整行 dim（cell 级证据）', () => {
    const { render } = rig();
    const grid = render();
    expect(readRow(grid, 6)).toMatch(/^✱ \[m:fbbbbbbb\]/); // 冻结行首记号
    const terminal = readRow(grid, 8);
    expect(terminal).toContain('supersededBy=user'); // 终态来源记号
    expect(grid.getCell(8, 0)?.style.dim).toBe(true); // 终态整行 dim
    expect(grid.getCell(6, 0)?.style.dim).toBeUndefined(); // 冻结行不 dim（✱ 已是区分位）
  });

  it('读出消毒：blocked 遮蔽原文保 id 操作面、quoted 引述注记（§8.2 统一函数注入）', () => {
    const sanitize: MemorySanitize = (entry) =>
      entry.summary === '摘要甲'
        ? { blocked: true, patterns: ['api-key'], quoted: false }
        : entry.summary === '摘要乙'
          ? { blocked: false, patterns: [], quoted: true }
          : CLEAN;
    const { render } = rig(basicRows(), { sanitize });
    const grid = render();
    const all = Array.from({ length: ROWS }, (_, i) => readRow(grid, i)).join('\n'); // 遮蔽行长文折行——全屏扫描断言
    expect(all).toContain('（内容含疑似敏感串已遮蔽——api-key；可 d 忘掉清理）');
    expect(all).toContain('id=maaaaaaa'); // 操作面保留
    expect(all).toContain('（疑似指令文本——按引述对待，非用户指令）');
  });

  it('条目行 plain 构造位消毒：summary 内嵌 LF 归一空格、ESC 序列/CR 剥除（折行账/落格账一致）', () => {
    // summary 是 LLM/插件写入的自由文本（dao 写路径无换行归一——内嵌 LF/转义
    // 残留是现实态）。修前形：entryLine 直接以 row.summary 原文拼 plain 喂
    // ScrollView 折行算术——foldLine 对 LF 按 graphemeWidth 规则⑥记 1 列、
    // cell.writeText 落格跳过 LF 记 0 格，渲染行比折行账窄（每控制字素 1 列）、
    // 两词直连无分隔；修后形：plain 经 sanitizeLineText（族标准——LF→空格 +
    // 控制字符单源消毒）后入折行算术，两账一致且 LF 呈现为空格分隔。
    // ESC/CR 剥除的观测面取选区复制（selectionText 切 plain 原文）——cell 层
    // writeText 防御本就跳过控制字节，裸格读出修前修后同形、非判别面。
    const rows = [
      row('maaaaaaa', { summary: '一行\n两行' }),
      row('mbbbbbbb', { summary: '前\x1b[31m红\x1b[0m后\r尾' }),
    ];
    const { viewer, copies, render } = rig(rows);
    const grid = render(); // 行集进屏（屏行映射确立——屏行 4/5 = 两条目行）
    expect(readRow(grid, 4)).toContain('一行 两行'); // LF→空格（修前：'一行两行' 直连——红）
    drag(viewer, { row: 5, col: 0 }, { row: 5, col: 80 }); // 整行拖选（col 80 越线宽——焦点钳到行尾）
    expect(copies).toHaveLength(1);
    expect(copies[0]).toContain('前红后尾'); // ESC 序列整段剥除 + CR 剥除（修前复制文含 \x1b[31m/\x1b[0m/\r 原文——红）
    expect(copies[0]).not.toContain('\x1b');
    expect(copies[0]).not.toContain('\r');
  });
});

/* ---------------- 行动词 f/d/r ---------------- */

describe('行动词 f/d/r（单源走 DAO 既有族——呈现层判向）', () => {
  it('f 冻结：active 行 → freeze + 同 id 锚定（条目换冻结区、光标跟随、提示切「f 解冻」）', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(text('f'));
    expect(calls).toContain('freeze:maaaaaaa');
    const grid = render();
    expect(readRow(grid, 3)).toBe('── 活体（0）'); // 换分区呈现（8 行 ≤ 视口 10——全量可见）
    expect(readRow(grid, 4)).toBe('── 冻结（2）');
    expect(readRow(grid, 5)).toContain('✱ [m:maaaaaaa]'); // 冻结行首记号
    expect(cursorRowText(grid)).toContain('maaaaaaa'); // 光标同 id 跟随
    expect(readRow(grid, ROWS - 1)).toContain('f 解冻 · '); // 分区提示切换
  });

  it('f 解冻：frozen 行 → unfreeze + 回活体区', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(key('down')); // 光标 → 冻结行
    viewer.handleEvent(text('f'));
    expect(calls).toContain('unfreeze:fbbbbbbb');
    const grid = render();
    expect(readRow(grid, 3)).toBe('── 活体（2）');
    expect(readRow(grid, 6)).toBe('── 冻结（0）');
    expect(cursorRowText(grid)).toContain('fbbbbbbb'); // 跟随回活体区
  });

  it('f/d 终态行零义吞（DAO 零调用、不进确认态）', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(key('down'));
    viewer.handleEvent(key('down')); // 光标 → 终态行
    viewer.handleEvent(text('f'));
    viewer.handleEvent(text('d'));
    expect(calls.filter((c) => c.startsWith('freeze:') || c.startsWith('forget:'))).toEqual([]);
    expect(readRow(render(), ROWS - 1)).not.toContain('确认'); // 未进确认态
  });

  it('d 冻结行零义吞 + 底行指引「先 f 解冻」', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(key('down')); // 光标 → 冻结行
    viewer.handleEvent(text('d'));
    expect(calls.filter((c) => c.startsWith('forget:'))).toEqual([]);
    expect(readRow(render(), ROWS - 1)).toContain('已冻结——先 f 解冻再忘掉');
  });

  it('d active 行两段式：确认文案 → Enter → forget 缺省 supersededBy=user + 条目现终态区', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(text('d'));
    expect(readRow(render(), ROWS - 1)).toContain('忘掉 [m:maaaaaaa]？enter/y 确认 · esc/n 取消');
    viewer.handleEvent(key('enter'));
    expect(calls).toContain('forget:maaaaaaa:user'); // 缺省撤回来源 = user
    const grid = render();
    expect(readRow(grid, 3)).toBe('── 活体（0）');
    expect(readRow(grid, 6)).toBe('── 终态（2）'); // 撤回后呈终态区（r 可复）
    expect(readRow(grid, 7)).toContain('maaaaaaa');
    expect(readRow(grid, 7)).toContain('supersededBy=user');
  });

  it('r 终态行免 confirm 直接 restore + 回活体区；r active 行零义吞', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(key('down'));
    viewer.handleEvent(key('down')); // 光标 → 终态行
    viewer.handleEvent(text('r'));
    expect(calls).toContain('restore:tccccccc');
    const grid = render();
    expect(readRow(grid, 3)).toBe('── 活体（2）'); // 复活回活体区
    expect(cursorRowText(grid)).toContain('tccccccc');
    expect(readRow(grid, ROWS - 1)).not.toContain('确认'); // 免 confirm（无两段式）
    // r 在 active 行零义吞
    const callsBefore = calls.length;
    viewer.handleEvent(text('r'));
    expect(calls.length).toBe(callsBefore); // 无第二次 restore
  });

  it('守卫错折底行（code：message 形）+ 单次语义（不回确认态）+ 一次性提示（下次按键即清）', () => {
    const r = rig();
    r.viewer.handleEvent(text('d')); // 确认态（目标 maaaaaaa active）
    const target = r.store.find((x) => x.id === 'maaaaaaa');
    if (target !== undefined) target.frozen = true; // 确认在场窗口期他路冻结——forget 撞守卫
    r.viewer.handleEvent(key('enter')); // 确认 → fake DAO forget 对 frozen 抛 MEMORY_FROZEN
    expect(r.calls).toContain('forget:maaaaaaa:user');
    expect(readRow(r.render(), ROWS - 1)).toContain('MEMORY_FROZEN：冻结条目不可忘掉'); // code：message 形
    expect(readRow(r.render(), ROWS - 1)).not.toContain('enter/y 确认'); // 单次语义——不回确认态
    r.viewer.handleEvent(key('down')); // 任意键——一次性提示清
    expect(readRow(r.render(), ROWS - 1)).not.toContain('MEMORY_FROZEN');
  });
});

/* ---------------- confirm 两段态机 ---------------- */

describe('confirm 两段态机（y/n 双轨同判 / 其余键终局吞 / 单次语义）', () => {
  it('text 轨 y 确认（kitty 轨纯键打字走 text 事件——与 key 轨同判）', () => {
    const { viewer, calls } = rig();
    viewer.handleEvent(text('d'));
    viewer.handleEvent(text('y')); // text 轨确认
    expect(calls).toContain('forget:maaaaaaa:user');
  });

  it('text 轨 n 取消（保守值——DAO 零调用）+ key 轨 Esc 同义', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(text('d'));
    viewer.handleEvent(text('n'));
    expect(calls.filter((c) => c.startsWith('forget:'))).toEqual([]);
    expect(readRow(render(), ROWS - 1)).not.toContain('enter/y 确认'); // 出确认态
    // key 轨 Esc
    viewer.handleEvent(text('d'));
    viewer.handleEvent(key('escape'));
    expect(calls.filter((c) => c.startsWith('forget:'))).toEqual([]);
  });

  it('确认态其余键终局吞（x 不透传不落任何编辑器、不退出）', () => {
    const { viewer, log, calls, render } = rig();
    viewer.handleEvent(text('d'));
    viewer.handleEvent(text('x'));
    viewer.handleEvent(key('pagedown')); // 滚动键也不穿透（模态优先）
    expect(log).toEqual([]); // 不退出
    expect(calls.filter((c) => c.startsWith('forget:'))).toEqual([]); // 不落子
    expect(readRow(render(), ROWS - 1)).toContain('enter/y 确认'); // 仍在确认态
  });

  it('Tab 确认态可达：收模态 + 切筛选（确认不跨筛选态存活）', () => {
    const { viewer, calls, render } = rig();
    viewer.handleEvent(text('d'));
    viewer.handleEvent(key('tab'));
    expect(calls.filter((c) => c.startsWith('forget:'))).toEqual([]); // 收模态不落子
    const grid = render();
    expect(readRow(grid, 0)).toContain('〔筛选：活体〕'); // 筛选已切 + 头行注记
    expect(readRow(grid, ROWS - 1)).not.toContain('确认');
  });
});

/* ---------------- e 导出输入行 ---------------- */

describe('e 导出输入行（/memory-export 真身同一函数——argv 切分同源）', () => {
  it('e 开输入行：底铬三行 Editor + 文本入框', () => {
    const { viewer, render } = rig();
    viewer.handleEvent(text('e'));
    const grid = render();
    expect(grid.getCell(ROWS - 3, 0)?.grapheme).toBe('┌'); // 编辑器边框顶
    expect(grid.getCell(ROWS - 1, 0)?.grapheme).toBe('└'); // 边框底
    type(viewer, '--out');
    expect(readRow(render(), ROWS - 2)).toContain('--out'); // 文本入框
  });

  it('Enter 执行：引号感知切分（与命令分发同源 tokenize）+ 回执折底行（多行 · 连呈）', async () => {
    const exportCalls: (readonly string[])[] = [];
    const r = rig(basicRows(), {
      exportImpl: (argv) => {
        exportCalls.push(argv);
        return Promise.resolve('已导出 2 条\n路径：mem.md');
      },
    });
    r.viewer.handleEvent(text('e'));
    type(r.viewer, '--out "a b.md"');
    r.viewer.handleEvent(key('enter'));
    await tick(); // runExport 微任务落定
    expect(exportCalls).toEqual([['--out', 'a b.md']]); // 双引号保内部空格
    expect(readRow(r.render(), ROWS - 1)).toContain('已导出 2 条 · 路径：mem.md'); // 回执折行单行呈现
  });

  it('导出异常折底行（无 code 形走 message 直呈）', async () => {
    const r = rig(basicRows(), { exportImpl: () => Promise.reject(new Error('导出失败：目标目录不可写')) });
    r.viewer.handleEvent(text('e'));
    r.viewer.handleEvent(key('enter'));
    await tick();
    expect(readRow(r.render(), ROWS - 1)).toContain('导出失败：目标目录不可写');
  });

  it('Esc 关输入行 + 查询文本保留（重开续打——/history 搜索框同律）', () => {
    const { viewer, render } = rig();
    viewer.handleEvent(text('e'));
    type(viewer, 'x');
    viewer.handleEvent(key('escape'));
    expect(render().getCell(ROWS - 3, 0)?.grapheme).not.toBe('┌'); // 输入行收场
    viewer.handleEvent(text('e')); // 重开
    expect(readRow(render(), ROWS - 2)).toContain('x'); // 文本保留
  });

  it('输入行有文 Ctrl+D 不退（主屏空框闸同律）；清框后可退', () => {
    const { viewer, log } = rig();
    viewer.handleEvent(text('e'));
    type(viewer, 'x');
    viewer.handleEvent(key('d', { ctrl: true }));
    expect(log).toEqual([]); // 有文不退
    viewer.handleEvent(key('backspace')); // 清框
    viewer.handleEvent(key('d', { ctrl: true }));
    expect(log).toEqual(['exit', 'quit']); // 先收副屏再转退出柄
  });

  it('Tab 输入态仍可达：收输入行 + 切筛选（文本保留续打）', () => {
    const { viewer, render } = rig();
    viewer.handleEvent(text('e'));
    type(viewer, 'x');
    viewer.handleEvent(key('tab'));
    const grid = render();
    expect(readRow(grid, 0)).toContain('〔筛选：活体〕'); // 筛选已切
    expect(grid.getCell(ROWS - 3, 0)?.grapheme).not.toBe('┌'); // 输入行已收
    viewer.handleEvent(text('e')); // 重开——文本保留
    expect(readRow(render(), ROWS - 2)).toContain('x');
  });
});

/* ---------------- Tab 筛选循环 ---------------- */

describe('Tab 筛选循环（全部→活体→冻结→终态→全部）', () => {
  it('四态单步循环 + 头行注记 + 行集按筛选只留该分区', () => {
    const { viewer, render } = rig();
    viewer.handleEvent(key('tab')); // 活体
    let grid = render();
    expect(readRow(grid, 0)).toContain('·〔筛选：活体〕');
    expect(readRow(grid, 1)).toBe('记忆库 · 在册 7 · 冻结 1 · 共 10'); // 投影恒全库——不随筛选变
    expect(readRow(grid, 2)).toBe('终态 · 否决 2 · 过期 1'); // 投影两行不随筛选消
    expect(readRow(grid, 3)).toBe('── 活体（1）');
    expect(readRow(grid, 4)).toContain('maaaaaaa');
    expect(readRow(grid, 5)).toBe(''); // 冻结/终态分区不在场
    viewer.handleEvent(key('tab')); // 冻结
    grid = render();
    expect(readRow(grid, 0)).toContain('·〔筛选：冻结〕');
    expect(readRow(grid, 3)).toBe('── 冻结（1）');
    expect(readRow(grid, 4)).toContain('✱ [m:fbbbbbbb]');
    viewer.handleEvent(key('tab')); // 终态
    grid = render();
    expect(readRow(grid, 0)).toContain('·〔筛选：终态〕');
    expect(readRow(grid, 3)).toBe('── 终态（1）');
    expect(readRow(grid, 4)).toContain('tccccccc');
    viewer.handleEvent(key('tab')); // 回全部
    grid = render();
    expect(readRow(grid, 0)).not.toContain('〔筛选'); // 无注记
    expect(readRow(grid, 5)).toBe('── 冻结（1）'); // 三分区复原
  });

  it('终态区客户端双过滤：非 owner 行不进、active 行不进（listForExport 单源）', () => {
    const rows = [
      row('maaaaaaa'),
      row('xother01', { ownerKey: 'other', status: 'dismissed', supersededBy: 'user' }), // owner 过滤剔除
      row('yactive1'), // active——status 过滤剔除（listForExport 也含此行）
    ];
    const { viewer, render } = rig(rows);
    viewer.handleEvent(key('tab'));
    viewer.handleEvent(key('tab'));
    viewer.handleEvent(key('tab')); // 终态
    const grid = render();
    expect(readRow(grid, 3)).toBe('── 终态（0）'); // 双过滤后空区
    expect(readRow(grid, 4)).toBe('');
  });
});

/* ---------------- 刷新重取与同 id 锚定 ---------------- */

describe('刷新重取与光标锚定（动词成功后整表重取）', () => {
  it('跨分区跟随：f 冻结后同 id 锚定在冻结区（光标行 = 该条）', () => {
    const { viewer, render } = rig([row('maaaaaaa'), row('mbbbbaaa')]);
    viewer.handleEvent(text('f'));
    expect(cursorRowText(render())).toContain('maaaaaaa'); // 光标跟去冻结区
  });

  it('锚缺席驻留原位就近：活体筛下冻结首条 → 光标钳到余下条目', () => {
    const { viewer, render } = rig([row('maaaaaaa'), row('mbbbbaaa')]);
    viewer.handleEvent(key('tab')); // 筛活体（2 条）
    viewer.handleEvent(text('f')); // 冻结首条——锚离场
    const grid = render();
    expect(readRow(grid, 0)).toContain('〔筛选：活体〕');
    expect(cursorRowText(grid)).toContain('mbbbbaaa'); // 原位就近钳到次条
  });

  it('verbs 后重取走三源（overview/listVisible/listForExport 各恰一笔）', () => {
    const { viewer, calls } = rig();
    const before = calls.length;
    viewer.handleEvent(text('f'));
    const after = calls.slice(before);
    expect(after.filter((c) => c === 'overview')).toHaveLength(1);
    expect(after.filter((c) => c.startsWith('listVisibleForManagement:'))).toHaveLength(1);
    expect(after.filter((c) => c === 'listForExport')).toHaveLength(1);
    expect(after).toContain('freeze:maaaaaaa');
  });
});

/* ---------------- 光标模型 ---------------- */

describe('光标模型（条目间循环——非条目行不驻留）', () => {
  it('↓↑ 循环移动 + 首末回绕', () => {
    const { viewer, render } = rig();
    viewer.handleEvent(key('down'));
    expect(cursorRowText(render())).toContain('fbbbbbbb');
    viewer.handleEvent(key('down'));
    expect(cursorRowText(render())).toContain('tccccccc');
    viewer.handleEvent(key('down')); // 末条回绕首条
    expect(cursorRowText(render())).toContain('maaaaaaa');
    viewer.handleEvent(key('up')); // 首条回绕末条
    expect(cursorRowText(render())).toContain('tccccccc');
  });

  it('零条目可见：行动词消隐（提示无动词段）+ f/d/r 零副作用 + 全局动词仍在', () => {
    const rows = [row('maaaaaaa')]; // 无冻结无终态
    const { viewer, calls, render } = rig(rows);
    viewer.handleEvent(key('tab'));
    viewer.handleEvent(key('tab')); // 筛冻结——零条目
    expect(readRow(render(), ROWS - 1)).toBe('e 导出 · tab 筛选 · q/esc 返回'); // 动词段消隐
    viewer.handleEvent(text('f'));
    viewer.handleEvent(text('d'));
    viewer.handleEvent(text('r'));
    expect(calls.filter((c) => /freeze|unfreeze|forget|restore/.test(c))).toEqual([]);
    viewer.handleEvent(text('e')); // 全局动词仍在
    expect(render().getCell(ROWS - 3, 0)?.grapheme).toBe('┌');
    viewer.handleEvent(key('escape'));
    viewer.handleEvent(key('tab')); // 筛终态（也零条目）
    viewer.handleEvent(key('tab')); // 回全部
    expect(cursorRowText(render())).toContain('maaaaaaa'); // 复原——光标可回指
  });

  it('溢出档顶对齐：移动后光标行落视口顶（scrollToLine 顶对齐）', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`e${String(i + 1).padStart(7, '0')}`));
    const { viewer, render } = rig(rows);
    let grid = render(); // 开屏：首条对齐视口顶
    expect(readRow(grid, 1)).toContain('e0000001');
    for (let i = 0; i < 7; i++) viewer.handleEvent(key('down')); // 光标 → 第 8 条
    grid = render();
    expect(readRow(grid, 1)).toContain('e0000008'); // 光标行顶对齐
    expect(cursorRowText(grid)).toContain('e0000008');
  });

  it('滚动键归 ScrollView 不挪光标（Home 到顶后 f 仍作用于光标条）', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`e${String(i + 1).padStart(7, '0')}`));
    const { viewer, calls, render } = rig(rows);
    for (let i = 0; i < 5; i++) viewer.handleEvent(key('down')); // 光标 → 第 6 条
    viewer.handleEvent(key('home')); // 滚到顶——投影两行进视口
    expect(readRow(render(), 1, COLS - 1)).toBe('记忆库 · 在册 7 · 冻结 1 · 共 10'); // 健康投影在视口顶（头行不重复——L0 即投影；剔滚动条列）
    viewer.handleEvent(text('f')); // 光标不随滚动挪——仍第 6 条
    expect(calls).toContain('freeze:e0000006');
  });
});

/* ---------------- 鼠标消费面 ---------------- */

describe('鼠标消费面（滚轮归 ScrollView / 左键点行移光标 / 余零动作）', () => {
  it('左键点条目行 → 光标移至该行（点冻结行后 d 给冻结指引）', () => {
    const { viewer, render } = rig();
    render(); // 视口几何回写（segmentAt 反查前提）
    viewer.handleEvent(mouse('left', { row: 6, col: 2 })); // 屏行 6 = 冻结条目行
    expect(cursorRowText(render())).toContain('fbbbbbbb');
    viewer.handleEvent(text('d'));
    expect(readRow(render(), ROWS - 1)).toContain('已冻结——先 f 解冻再忘掉'); // 光标确在冻结行
  });

  it('头行/投影行/分区头/底铬命中零动作（光标不动）', () => {
    const { viewer, render } = rig();
    render();
    for (const at of [0, 1, 2, 3, ROWS - 1]) viewer.handleEvent(mouse('left', { row: at, col: 2 }));
    expect(cursorRowText(render())).toContain('maaaaaaa'); // 光标仍在首条
    viewer.handleEvent(text('d'));
    expect(readRow(render(), ROWS - 1)).toContain('忘掉 [m:maaaaaaa]？'); // d 作用于首条——点击未挪光标
  });

  it('模态在场鼠标零动作吞（确认态点击不改目标）+ 中/右键零动作', () => {
    const { viewer, calls, render } = rig();
    render();
    viewer.handleEvent(text('d')); // 确认态（目标 maaaaaaa）
    viewer.handleEvent(mouse('left', { row: 6, col: 2 })); // 点冻结行——零动作
    viewer.handleEvent(mouse('middle', { row: 4, col: 2 }));
    viewer.handleEvent(mouse('right', { row: 4, col: 2 }));
    viewer.handleEvent(key('enter')); // 确认——目标仍是首条
    expect(calls).toContain('forget:maaaaaaa:user');
    expect(calls.filter((c) => c.startsWith('forget:fbbbbbbb'))).toEqual([]);
    expect(readRow(render(), ROWS - 1)).not.toContain('确认');
  });

  it('滚轮滚动（ScrollView 统一路——offset 移动）', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`e${String(i + 1).padStart(7, '0')}`));
    const { viewer } = rig(rows);
    expect(viewer.scrollOffset).toBeGreaterThan(0); // 开屏即溢出档
    const before = viewer.scrollOffset;
    viewer.handleEvent(mouse('wheel-up'));
    expect(viewer.scrollOffset).toBe(before - 3); // ±3 视觉行
  });
});

/* ---------------- 退出键面 ---------------- */

describe('退出键面（与主屏同键面）', () => {
  it('q 退出（text 轨）+ 闭锁单次；Esc 退出（key 轨）同义', () => {
    const { viewer, log } = rig();
    viewer.handleEvent(text('q'));
    viewer.handleEvent(text('q')); // 闭锁——单次
    expect(log).toEqual(['exit']);
    const r2 = rig();
    r2.viewer.handleEvent(key('escape'));
    expect(r2.log).toEqual(['exit']);
  });

  it('Ctrl+C 打断在飞 run（零参形）+ 滤 kitty release', () => {
    const { viewer, log } = rig();
    viewer.handleEvent(key('c', { ctrl: true }));
    viewer.handleEvent(key('c', { ctrl: true, phase: 'release' })); // release 滤
    viewer.handleEvent(key('c', { ctrl: true, phase: 'repeat' })); // repeat 相动作
    expect(log).toEqual(['interrupt', 'interrupt']);
    expect(log).not.toContain('exit'); // 打断不退副屏
  });

  it('Ctrl+D 空框：先收副屏（exit）再转退出柄（quit）', () => {
    const { viewer, log } = rig();
    viewer.handleEvent(key('d', { ctrl: true }));
    expect(log).toEqual(['exit', 'quit']); // 顺序锁
  });
});

/* ---------------- 鼠标拖选复制（挂账解挂批①——/history 件 8 细则对齐） ---------------- */

/** 拖选三连便捷（press 锚定 → motion 扩展 → release 复制） */
function drag(v: MemoryViewer, from: { row: number; col: number }, to: { row: number; col: number }): void {
  v.handleEvent(mouse('left', from, 'press'));
  v.handleEvent(mouse('left', to, 'motion'));
  v.handleEvent(mouse('left', to, 'release'));
}

describe('拖选复制（挂账解挂批①——线性选区 / LF 拼 / 反相高亮 / 帽 64 KiB 同值）', () => {
  // 行图（basicRows 无溢出无折行——屏行 = 1 + 逻辑行）：屏行 4 = 活体条目甲 /
  // 屏行 6 = 冻结条目乙（✱ 首）/ 屏行 8 = 终态条目丙；屏行 1-2 投影、
  // 屏行 3/5/7 分区头。
  const L3 = '[m:maaaaaaa] [pref] 摘要甲  id=maaaaaaa  updated=2026-09-11T00:00:00Z';
  const L5 = '✱ [m:fbbbbbbb] [fact] 摘要乙  id=fbbbbbbb  updated=2026-09-11T00:00:00Z';

  it('拖选三连：release 行间拼 LF 经 onCopy（首行按列切 · 中间行全文 · 尾行按列切）', () => {
    const { viewer, copies, render } = rig();
    render(); // 行集进屏（屏行映射确立）
    drag(viewer, { row: 4, col: 2 }, { row: 8, col: 4 });
    expect(copies).toHaveLength(1);
    const parts = copies[0]!.split('\n');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe(L3.slice(2)); // 首行 = 条目甲按锚列切（前缀 ASCII 段——显示列即 UTF-16 下标）
    expect(parts[1]).toBe('── 冻结（1）'); // 中间行全文（分区头也是可选正文）
    expect(parts[2]).toBe(L5); // 中间行全文（条目行）
    expect(parts[3]).toBe('── 终态（1）');
    expect(parts[4]).toBe('[m:t'); // 尾行按焦点列切
  });

  it('反向拖选同文（锚/焦点规范化——升序两端点与拖动方向无关）', () => {
    const { viewer, copies, render } = rig();
    render();
    drag(viewer, { row: 8, col: 4 }, { row: 4, col: 2 }); // 尾 → 首反向
    expect(copies).toHaveLength(1);
    expect(copies[0]).toBe(`${L3.slice(2)}\n── 冻结（1）\n${L5}\n── 终态（1）\n[m:t`); // 与正向同文
  });

  it('CJK 半格命中归字素首（双宽字素中列 → 该字素 UTF-16 首下标）', () => {
    const { viewer, copies, render } = rig();
    render();
    // 屏行 4 前缀 `[m:maaaaaaa] [pref]` 占列 0-18、空格 19、「摘要甲」占
    // 20-25：press 列 21 = 摘右半格（归字素首 → UTF-16 下标 20）、motion 列
    // 26 = 甲后首格（→ 下标 26）→ 选区恰为「摘要甲」三字素
    drag(viewer, { row: 4, col: 21 }, { row: 4, col: 26 });
    expect(copies).toEqual(['摘要甲']);
  });

  it('press 点条目行移光标保留（既有左键律）+ 零拖动 release 零复制', () => {
    const { viewer, copies, render } = rig();
    render();
    // 纯点击（press 后原地 release = 零宽选区）：光标移至命中条目行、零复制
    drag(viewer, { row: 6, col: 2 }, { row: 6, col: 2 });
    expect(copies).toEqual([]); // 空选区零动作
    expect(cursorRowText(render())).toContain('摘要乙'); // 已移光标（首条甲 → 乙）
  });

  it('选区反相高亮（release 后保留）+ 下次 press 清除', () => {
    const { viewer, copies, render } = rig();
    render();
    // 锚在分区头行（非光标行——光标初始在首条目行，避免反相载体混淆）
    viewer.handleEvent(mouse('left', { row: 3, col: 0 }, 'press'));
    viewer.handleEvent(mouse('left', { row: 4, col: 2 }, 'motion'));
    let grid = render();
    expect(grid.getCell(3, 0)?.style.inverse).toBe(true); // 选区首行整行反相（叠加在 dim 上）
    expect(grid.getCell(3, 6)?.style.inverse).toBe(true);
    expect(grid.getCell(2, 0)?.style.inverse).toBeUndefined(); // 选区外的投影行不反相
    viewer.handleEvent(mouse('left', { row: 4, col: 2 }, 'release'));
    expect(copies).toEqual(['── 活体（1）\n[m']); // 分区头全文 + 条目甲首两列
    grid = render();
    expect(grid.getCell(3, 0)?.style.inverse).toBe(true); // release 后高亮保留
    viewer.handleEvent(mouse('left', { row: 5, col: 0 }, 'press')); // 下次 press = 清除位
    grid = render();
    expect(grid.getCell(3, 0)?.style.inverse).toBeUndefined(); // 旧选区清除
    expect(copies).toHaveLength(1); // 清除性 press 不复制
  });

  it('模态在场拖选禁用（确认态与输入态——输入模态优先）', () => {
    const { viewer, copies, render } = rig();
    render();
    viewer.handleEvent(key('d')); // 光标在首条（活体甲）——确认态
    drag(viewer, { row: 3, col: 0 }, { row: 4, col: 4 });
    viewer.handleEvent(key('n')); // 收确认态
    viewer.handleEvent(key('e')); // 输入态（导出行）
    drag(viewer, { row: 3, col: 0 }, { row: 4, col: 4 });
    expect(copies).toEqual([]); // 两模态在场全程零复制
  });

  it('视口外命中零动作：头行 / 底铬 / 滚动条列不建锚（后续零复制）', () => {
    // 9 条活体 → 12 逻辑行 > 视口 10：溢出档末列 99 = 滚动条
    const rows9 = Array.from({ length: 9 }, (_, i) => row(`e${i}`));
    const { viewer, copies, render } = rig(rows9);
    render();
    drag(viewer, { row: 0, col: 2 }, { row: 1, col: 2 }); // 头行起手
    drag(viewer, { row: ROWS - 1, col: 2 }, { row: 1, col: 2 }); // 底铬起手
    drag(viewer, { row: 1, col: COLS - 1 }, { row: 1, col: 2 }); // 滚动条列起手
    expect(copies).toEqual([]);
  });

  it('选区帽 64 KiB 同值：超帽拒复制 + 底行提示常显至选区清除（拖选中滚动达帽）', () => {
    // 三条 30000 字符长摘要条目（各折 ~305 视觉行）——锚在尾屏、滚到顶再扩
    // 焦点，两条整行全文计入 → 总量 ~90 KiB 越帽（纯视口内拖选受折宽约束达
    // 不到帽——与 /history 帽测试同几何法）
    const longRows = ['x', 'y', 'z'].map((ch, i) => row(`l${i}`, { summary: ch.repeat(30000) }));
    const { viewer, copies, render } = rig(longRows);
    render(); // 开屏顶对齐首条
    for (let i = 0; i < 800; i++) viewer.handleEvent(mouse('wheel-down')); // 滚到尾
    viewer.handleEvent(mouse('left', { row: 10, col: 0 }, 'press')); // 锚 = 末条目尾段
    for (let i = 0; i < 800; i++) viewer.handleEvent(mouse('wheel-up')); // 拖选中滚到顶
    viewer.handleEvent(mouse('left', { row: 8, col: 3 }, 'motion')); // 焦点 = 首条目头段
    viewer.handleEvent(mouse('left', { row: 8, col: 3 }, 'release'));
    expect(copies).toEqual([]); // 超帽拒复制
    expect(readRow(render(), ROWS - 1)).toContain('选区过大未复制'); // 底行提示（SELECTION_CAP_NOTICE 单源）
    viewer.handleEvent(mouse('left', { row: 1, col: 2 }, 'press')); // 下次 press = 清除位
    expect(readRow(render(), ROWS - 1)).toContain('tab 筛选'); // 回常态键面提示
    expect(copies).toEqual([]); // 全程零复制
  });
});
