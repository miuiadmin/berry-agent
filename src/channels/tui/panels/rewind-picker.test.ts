/**
 * RewindPicker 回退点选择器副屏件测试（2026-09-30 会话管理命令批批3——
 * 05 §5.3 翻案笔②无参选择器形态）：manifest 行渲染 / 打字过滤（增词/删词）/
 * 两步确认（Enter 进 preview 三账行 → Esc 回列表 → 再 Enter 先收屏再
 * onRestore）/ 预演失败 errorText 形（Enter 不进 restore）/ 退出闭锁单次。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { RewindPicker } from './rewind-picker.js';
import type { RewindPickerOptions } from './rewind-picker.js';
import type { UiRewindPreview } from '../../../contracts/index.js';

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

/** text 事件夹具（kitty 打字轨） */
const t = (text: string): InputEvent => ({ kind: 'text', text }) as InputEvent;

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

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

/** 测试条目（manifestLine 成品行——插件域组装形） */
const TEST_ENTRIES: readonly { id: string; line: string }[] = [
  { id: 'm-second0001', line: '- m-second… 2026-09-30 12:00:00〔修改前快照〕3 文件 · 回退点 seq=5' },
  { id: 'm-first00002', line: '- m-first0… 2026-09-30 11:00:00〔修改前快照〕1 文件 · 回退点 seq=2' },
  { id: 'm-backup0003', line: '- m-backup… 2026-09-30 10:00:00〔回退保底拍〕2 文件 · 回退点 seq=1' },
];

/** 预演回执夹具 */
const PREVIEW_OK: UiRewindPreview = { restoreCount: 2, deleteCount: 1, untouchedCount: 0 };

function makePicker(overrides: Partial<RewindPickerOptions> = {}) {
  const onPreview = vi.fn(async (): Promise<UiRewindPreview> => ({ ...PREVIEW_OK }));
  const onRestore = vi.fn(async (): Promise<void> => undefined);
  const onExit = vi.fn();
  const onInterrupt = vi.fn();
  const onQuit = vi.fn();
  const picker = new RewindPicker({
    entries: TEST_ENTRIES,
    actions: { onPreview, onRestore },
    onExit,
    sessionId: 'sess-abcdef1234567890',
    onInterrupt,
    onQuit,
    ...overrides,
  });
  return { picker, onPreview, onRestore, onExit, onInterrupt, onQuit };
}

function paint(picker: RewindPicker, width = 72): CellGrid {
  const grid = new CellGrid(width, picker.measure(width));
  picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

describe('RewindPicker 呈现（list 段）', () => {
  it('标题行 + manifest 成品行全列 + 底行键路提示', () => {
    const { picker } = makePicker();
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('回退点');
    expect(readRow(grid, 0, 72)).toContain('3 个');
    expect(readRow(grid, 1, 72)).toContain('m-second…');
    expect(readRow(grid, 1, 72)).toContain('修改前快照');
    expect(readRow(grid, 2, 72)).toContain('m-first0…');
    expect(readRow(grid, 3, 72)).toContain('回退保底拍');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('enter 预览');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('打字过滤');
  });

  it('光标 ▸ 在首行 + ↑↓ 移动', () => {
    const { picker } = makePicker();
    let grid = paint(picker);
    expect(readRow(grid, 1, 72).startsWith('▸')).toBe(true);
    picker.handleEvent(k('down'));
    grid = paint(picker);
    expect(readRow(grid, 2, 72).startsWith('▸')).toBe(true);
    expect(readRow(grid, 1, 72).startsWith('▸')).toBe(false);
    picker.handleEvent(k('up'));
    grid = paint(picker);
    expect(readRow(grid, 1, 72).startsWith('▸')).toBe(true);
  });

  it('滚轮滚动（件族面——WHEEL_LINES 3 行跳，3 条清单即跳末条）', () => {
    const { picker } = makePicker();
    picker.handleEvent(wheel('wheel-down'));
    const grid = paint(picker);
    expect(readRow(grid, 3, 72).startsWith('▸')).toBe(true); // 末条（offset 0 窗内第三条=行 3）
  });
});

describe('RewindPicker 打字过滤', () => {
  it('打字即时过滤（CJK 多字符 chunk 全串入词）+ backspace 逐字符删词回全量', () => {
    const { picker } = makePicker();
    picker.handleEvent(t('保底'));
    let grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('1 个');
    expect(readRow(grid, 1, 72)).toContain('回退保底拍');
    picker.handleEvent(k('backspace')); // 「保底」→「保」（UTF-16 单位删——'保' 仍匹配）
    grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('1 个');
    expect(readRow(grid, 1, 72)).toContain('回退保底拍');
    picker.handleEvent(k('backspace')); // 「保」→ 空 = 回全量
    grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('3 个');
  });

  it('空结果诚实呈现（无匹配行 + 过滤词回显）', () => {
    const { picker } = makePicker();
    picker.handleEvent(t('z'));
    picker.handleEvent(t('z'));
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('0 个');
    expect(readRow(grid, 1, 72)).toContain('无匹配');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('过滤：zz_');
  });

  it('id 全形也命中（用户贴全 id 搜索路）', () => {
    const { picker } = makePicker();
    picker.handleEvent(t('m-first00002'));
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('1 个');
  });
});

describe('RewindPicker 两步确认（preview → 确认 restore）', () => {
  it('Enter 进 preview 视图：onPreview 被调（参数=选中 id）+ 三账行 + 警告行', async () => {
    const { picker, onPreview } = makePicker();
    picker.handleEvent(k('enter'));
    expect(onPreview).toHaveBeenCalledWith('m-second0001');
    // onPreview 是异步——等微任务冲刷后重画
    await Promise.resolve();
    await Promise.resolve();
    const grid = paint(picker);
    const all = Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72)).join('\n');
    expect(all).toContain('恢复 2 · 删除 1 · 不动 0'); // 三账行标记位
    expect(all).toContain('你手动改的文件保持不动'); // 警告行（警示语义完整——只还原 berry 记录的改动）
    expect(all).toContain('回退只还原'); // 警示前半——还原范围点名（berry 记录的改动）
    expect(all).toContain('enter 确认回退'); // 段二提示
    expect(all).toContain('esc 返回'); // 返回路提示
  });

  it('preview 加载中有等待态行（onPreview 未决不显账行）', () => {
    let resolvePreview: (value: UiRewindPreview) => void = () => undefined;
    const onPreview = vi.fn(
      () =>
        new Promise<UiRewindPreview>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const { picker } = makePicker({ actions: { onPreview, onRestore: vi.fn(async () => undefined) } });
    picker.handleEvent(k('enter'));
    const grid = paint(picker);
    const all = Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72)).join('\n');
    expect(all).toContain('预览中');
    expect(all).not.toContain('恢复 2');
    resolvePreview({ ...PREVIEW_OK });
  });

  it('Esc 回列表（preview 段不退面板——返回列表语义）', async () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(k('enter'));
    await Promise.resolve();
    await Promise.resolve();
    picker.handleEvent(k('escape'));
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('3 个'); // 回 list 标题
    expect(onExit).not.toHaveBeenCalled(); // 面板未退出
  });

  it('段二 Enter：先收屏（onExit）后回调（onRestore）——序断言 + 参数=选中 id', async () => {
    const order: string[] = [];
    const onExit = vi.fn(() => order.push('exit'));
    const onRestore = vi.fn(async () => {
      order.push('restore');
    });
    const { picker } = makePicker({
      onExit,
      actions: { onPreview: vi.fn(async () => ({ ...PREVIEW_OK })), onRestore },
    });
    picker.handleEvent(k('enter'));
    await Promise.resolve();
    await Promise.resolve();
    picker.handleEvent(k('enter')); // 段二确认
    expect(onRestore).toHaveBeenCalledWith('m-second0001');
    expect(order).toEqual(['exit', 'restore']); // 先收屏再回调（件族律）
  });

  it('预演失败（errorText）：Enter 不进 restore（诚实拒——零误执行）', async () => {
    const onRestore = vi.fn(async () => undefined);
    const { picker } = makePicker({
      actions: {
        onPreview: vi.fn(async (): Promise<UiRewindPreview> => ({
          ...PREVIEW_OK,
          errorText: 'CHECKPOINT_NOT_FOUND：回退点已被清理',
        })),
        onRestore,
      },
    });
    picker.handleEvent(k('enter'));
    await Promise.resolve();
    await Promise.resolve();
    const grid = paint(picker);
    const all = Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72)).join('\n');
    expect(all).toContain('CHECKPOINT_NOT_FOUND');
    picker.handleEvent(k('enter')); // errorText 在场 → Enter 零动作
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('迟到预演竞态：旧条目 onPreview 迟到 resolve 不错装新条目确认视图（守卫须校验 previewId）', async () => {
    // 双 deferred：A 进 preview 后不决 → Esc 回列表 → down 选 B → 进 B preview
    // → A 的迟到 resolve 到达——守卫必须比对 previewId 拒收（否则 A 的三账行
    // 错装进 B 的确认视图：用户看着 A 的对账数确认 B 的破坏性 restore）
    const deferreds: Array<{ resolve: (value: UiRewindPreview) => void }> = [];
    const onPreview = vi.fn(
      () =>
        new Promise<UiRewindPreview>((resolve) => {
          deferreds.push({ resolve });
        }),
    );
    const { picker } = makePicker({ actions: { onPreview, onRestore: vi.fn(async () => undefined) } });
    picker.handleEvent(k('enter')); // 条目 A（m-second0001）进 preview——不决
    expect(deferreds).toHaveLength(1);
    picker.handleEvent(k('escape')); // 回列表
    picker.handleEvent(k('down')); // 光标移到 B（m-first00002）
    picker.handleEvent(k('enter')); // B 进 preview——A 的 promise 仍悬挂
    expect(deferreds).toHaveLength(2);
    // A 迟到 resolve（大工作区 walk 慢形）——区分值：恢复 9（A 专属账目）
    deferreds[0]!.resolve({ restoreCount: 9, deleteCount: 8, untouchedCount: 7 });
    await Promise.resolve();
    await Promise.resolve();
    const stale = paint(picker);
    const staleAll = Array.from({ length: stale.rows }, (_, i) => readRow(stale, i, 72)).join('\n');
    expect(staleAll).toContain('m-first0'); // 确认视图锚 B
    expect(staleAll).not.toContain('恢复 9'); // A 的账目不得错装（修前红位）
    // B 自己的 resolve 照常回填
    deferreds[1]!.resolve({ ...PREVIEW_OK });
    await Promise.resolve();
    await Promise.resolve();
    const fresh = paint(picker);
    const freshAll = Array.from({ length: fresh.rows }, (_, i) => readRow(fresh, i, 72)).join('\n');
    expect(freshAll).toContain('恢复 2'); // B 的账目就位
  });

  it('迟到预演竞态（同条目形）：同条目二次进预演时旧调用迟到 resolve 仍拒收（守卫须锚调用序非条目）', async () => {
    // R2 修前红位：守卫三条件 exited/view/previewId 全是「条目」锚——同条目
    // 二次进预览时 previewId 同值，旧调用迟到 resolve 三条件全过被放行（旧
    // 账目错装进新确认视图——与异条目形同危害）；修法 = 调用序号守卫
    const deferreds: Array<{ resolve: (value: UiRewindPreview) => void }> = [];
    const onPreview = vi.fn(
      () =>
        new Promise<UiRewindPreview>((resolve) => {
          deferreds.push({ resolve });
        }),
    );
    const { picker } = makePicker({ actions: { onPreview, onRestore: vi.fn(async () => undefined) } });
    picker.handleEvent(k('enter')); // 条目 A（m-second0001）进 preview——不决
    expect(deferreds).toHaveLength(1);
    picker.handleEvent(k('escape')); // 回列表（光标不动——仍指 A）
    picker.handleEvent(k('enter')); // 同条目 A 二次进 preview（新调用）
    expect(deferreds).toHaveLength(2);
    // 旧调用迟到 resolve（区分值：恢复 9——旧快照专属账目）
    deferreds[0]!.resolve({ restoreCount: 9, deleteCount: 8, untouchedCount: 7 });
    await Promise.resolve();
    await Promise.resolve();
    const stale = paint(picker);
    const staleAll = Array.from({ length: stale.rows }, (_, i) => readRow(stale, i, 72)).join('\n');
    expect(staleAll).toContain('预览中'); // 旧调用拒收——仍加载态（修前红位：旧账就位）
    expect(staleAll).not.toContain('恢复 9');
    // 新调用 resolve 照常回填
    deferreds[1]!.resolve({ ...PREVIEW_OK });
    await Promise.resolve();
    await Promise.resolve();
    const fresh = paint(picker);
    const freshAll = Array.from({ length: fresh.rows }, (_, i) => readRow(fresh, i, 72)).join('\n');
    expect(freshAll).toContain('恢复 2'); // 新调用账目就位
  });

  it('迟到预演竞态（同条目 reject 形）：旧调用迟到 reject 不错装错误态', async () => {
    // .catch 路同守卫（R2 reject 腿）——旧调用 reject 不得把新预览打成「预览失败」
    const deferreds: Array<{ resolve: (value: UiRewindPreview) => void; reject: (reason?: unknown) => void }> = [];
    const onPreview = vi.fn(
      () =>
        new Promise<UiRewindPreview>((resolve, reject) => {
          deferreds.push({ resolve, reject });
        }),
    );
    const { picker } = makePicker({ actions: { onPreview, onRestore: vi.fn(async () => undefined) } });
    picker.handleEvent(k('enter'));
    picker.handleEvent(k('escape'));
    picker.handleEvent(k('enter')); // 同条目二次进
    deferreds[0]!.reject(new Error('CHECKPOINT_GONE')); // 旧调用迟到 reject
    await Promise.resolve();
    await Promise.resolve();
    const stale = paint(picker);
    const staleAll = Array.from({ length: stale.rows }, (_, i) => readRow(stale, i, 72)).join('\n');
    expect(staleAll).toContain('预览中'); // 旧 reject 拒收——仍加载态
    expect(staleAll).not.toContain('预览失败');
    deferreds[1]!.resolve({ ...PREVIEW_OK });
    await Promise.resolve();
    await Promise.resolve();
    const fresh = paint(picker);
    const freshAll = Array.from({ length: fresh.rows }, (_, i) => readRow(fresh, i, 72)).join('\n');
    expect(freshAll).toContain('恢复 2');
  });

  it('预演 reject（注入异常）：折「预览失败」诚实拒 + Enter 零动作（.catch 覆盖锁——reject 不成 unhandledRejection）', async () => {
    const onRestore = vi.fn(async () => undefined);
    const onPreview = vi.fn(async () => {
      throw new Error('IO_READ：工作区读失败');
    });
    const { picker } = makePicker({ actions: { onPreview, onRestore } });
    picker.handleEvent(k('enter'));
    await Promise.resolve();
    await Promise.resolve();
    const grid = paint(picker);
    const all = Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72)).join('\n');
    expect(all).toContain('预览失败'); // .catch 折错误态（非吞非炸）
    picker.handleEvent(k('enter')); // 错误态 Enter 零动作
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('过滤态 Enter：预演锚定 = 过滤后选中项（filtered() 集锚定——非全量首项）', async () => {
    const { picker, onPreview } = makePicker();
    for (const ch of '保底') picker.handleEvent(t(ch)); // 过滤到 m-backup0003 一条
    picker.handleEvent(k('enter')); // 进 preview——锚定必须取过滤集选中项
    expect(onPreview).toHaveBeenCalledWith('m-backup0003'); // 修前若锚定回退全量集则收 m-second0001
    await Promise.resolve();
    await Promise.resolve();
    const grid = paint(picker);
    expect(Array.from({ length: grid.rows }, (_, i) => readRow(grid, i, 72)).join('\n')).toContain('m-backup'); // 确认视图成品行同锚
  });
});

describe('RewindPicker 退出族与闭锁', () => {
  it('list 段 q/Esc 退出面板（q 双轨 + Esc）；退出闭锁后键零消费', async () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
    // 闭锁：退出后的 Enter 不再触发 preview/restore（竞发防御）
    picker.handleEvent(k('enter'));
    await Promise.resolve();
    await Promise.resolve();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('q 退出捷键与过滤面共存（有过滤词时 q 入词——无匹配诚实零条不退出）', () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(t('保'));
    let grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('1 个');
    picker.handleEvent(t('q')); // 有过滤词 → 入词（'保q' 无匹配 = 诚实零条）
    expect(onExit).not.toHaveBeenCalled();
    grid = paint(picker);
    expect(readRow(grid, 0, 72)).toContain('0 个');
    picker.handleEvent(k('backspace'));
    picker.handleEvent(k('backspace'));
    picker.handleEvent(t('q')); // 无过滤词 → 退出
    expect(onExit).toHaveBeenCalledTimes(1);
    void grid;
  });

  it('Ctrl+C 打断不退屏；Ctrl+D 先收屏再转退出柄（件族同律）', async () => {
    const { picker, onInterrupt, onQuit, onExit } = makePicker();
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-abcdef1234567890');
    expect(onExit).not.toHaveBeenCalled();
    picker.handleEvent(k('d', { ctrl: true }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
