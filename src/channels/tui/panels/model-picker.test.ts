/**
 * /model 模型选择器副屏件测试（2026-09-30 UX 对标批 ux-4）：分组头 + 当前 ● /
 * 打字过滤（增词/删词/空结果/q 捷键共存）/ 选定回调与「先收副屏再回调」序 /
 * 退出族（q 双轨 / Esc / Ctrl+C 打断 / Ctrl+D 先收屏再退柄）/ 闭锁单次。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { ModelPicker } from './model-picker.js';
import type { ModelPickerOptions } from './model-picker.js';
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

/** 测试条目（两 provider 分组——tui-entry 装配位同构展开形） */
const TEST_ENTRIES: readonly { spec: string; provider: string; model: string }[] = [
  { spec: 'anthropic/claude-sonnet', provider: 'anthropic', model: 'claude-sonnet' },
  { spec: 'anthropic/claude-opus', provider: 'anthropic', model: 'claude-opus' },
  { spec: 'openai/gpt-5', provider: 'openai', model: 'gpt-5' },
  { spec: 'my-gw/gw-large', provider: 'my-gw', model: 'gw-large' },
];

function makePicker(overrides: Partial<ModelPickerOptions> = {}) {
  const onSelect = vi.fn();
  const onExit = vi.fn();
  const onInterrupt = vi.fn();
  const onQuit = vi.fn();
  const picker = new ModelPicker({
    entries: TEST_ENTRIES,
    current: 'anthropic/claude-sonnet',
    onSelect,
    onExit,
    sessionId: 'sess-abcdef1234567890',
    onInterrupt,
    onQuit,
    ...overrides,
  });
  return { picker, onSelect, onExit, onInterrupt, onQuit };
}

function paint(picker: ModelPicker, width = 72): CellGrid {
  const grid = new CellGrid(width, picker.measure(width));
  picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

describe('ModelPicker 呈现', () => {
  it('provider 分组头（dim 行）+ 条目 spec 全列 + 底行键路提示', () => {
    const { picker } = makePicker();
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 4 个');
    // 分组头三枚（同 provider 连续只出组首）+ 条目四行
    expect(readRow(grid, 1, 72)).toContain('── anthropic ──');
    expect(readRow(grid, 2, 72)).toContain('anthropic/claude-sonnet');
    expect(readRow(grid, 3, 72)).toContain('anthropic/claude-opus');
    expect(readRow(grid, 4, 72)).toContain('── openai ──');
    expect(readRow(grid, 5, 72)).toContain('openai/gpt-5');
    expect(readRow(grid, 6, 72)).toContain('── my-gw ──');
    expect(readRow(grid, 7, 72)).toContain('my-gw/gw-large');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('打字过滤');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('下一轮对话起生效');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('q/esc 返回'); // 底行键序全域统一形（46:2 离群归队）
  });

  it('当前模型 ● 标记与光标 › 分立（首条目光标、当前行 ●）', () => {
    const { picker } = makePicker();
    const grid = paint(picker);
    // 光标在首条目（组头后第一行 = 行 2），当前 ● 也在该行（current = 首条目）
    expect(readRow(grid, 2, 72).startsWith('›')).toBe(true);
    expect(readRow(grid, 2, 72)).toContain('●');
    // 换 current 非首条目——● 与 › 分立
    const { picker: p2 } = makePicker({ current: 'openai/gpt-5' });
    const grid2 = paint(p2);
    expect(readRow(grid2, 2, 72).startsWith('›')).toBe(true);
    expect(readRow(grid2, 2, 72)).not.toContain('●');
    expect(readRow(grid2, 5, 72)).toContain('●');
    expect(readRow(grid2, 5, 72).startsWith('›')).toBe(false);
  });

  it('在选行整行 accent bold（R-9——codex 全 spans 律：右段辅助段随光标行覆写；› 光标符保留两账分立）', () => {
    const { picker } = makePicker();
    const grid = paint(picker);
    // 光标行（行 2 = 首条目）：左段整行 accent bold（› 符位同覆写——保符不保旧样式）
    expect(grid.getCell(2, 0)?.style?.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(2, 0)?.style?.bold).toBe(true);
    // 右段辅助段（右对齐 model 裸名）随光标行覆写——codex 全 spans 律
    const rightCol = 72 - 'claude-sonnet'.length;
    expect(grid.getCell(2, rightCol)?.style?.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(2, rightCol)?.style?.bold).toBe(true);
    // 非光标条目行（行 3）：左段无样式、右段 dim（HINT_STYLE = {dim:true}）
    expect(grid.getCell(3, 0)?.style?.fg).toBeUndefined();
    expect(grid.getCell(3, 0)?.style?.bold).toBeUndefined();
    const rightCol3 = 72 - 'claude-opus'.length;
    expect(grid.getCell(3, rightCol3)?.style?.fg).toBeUndefined();
    expect(grid.getCell(3, rightCol3)?.style?.dim).toBe(true);
  });

  it('窄窗非条目行 … 收口（wf_3c8b00b8 组δ X-5）：头行/组头行/底行 raw writeText 硬截断封堵（修前红）', () => {
    // 修前：头行/组头行/空匹配行/底行是 raw buffer.writeText 直写——窄窗
    // 超宽 CellGrid 越界静默吸收硬截断无提示（条目行走 fitRowSegments 有
    // …，非条目行是漏网面）；修后统一 fitLine … 收口
    const { picker } = makePicker();
    const width = 12; // 头行「◆ 切换模型 · 4 个」/ 组头「── anthropic ──」(15) / 底行 hintLine 全超
    const grid = paint(picker, width);
    const head = readRow(grid, 0, width);
    expect(head.startsWith('◆')).toBe(true); // 行首锚存活
    expect(head.endsWith('…')).toBe(true); // 修前红位：硬截断行尾无 …
    expect(readRow(grid, 1, width).endsWith('…')).toBe(true); // 组头行同律
    expect(readRow(grid, grid.rows - 1, width).endsWith('…')).toBe(true); // 底行
    // 空匹配行 + 过滤态底行：query 无匹配时第二行同收口
    picker.handleEvent(t('z'));
    picker.handleEvent(t('z'));
    const g2 = paint(picker, width);
    expect(readRow(g2, 1, width).endsWith('…')).toBe(true); // 「（无匹配「zz」的模型）」超宽
    expect(readRow(g2, g2.rows - 1, width).endsWith('…')).toBe(true); // 过滤态底行同律
  });
});

describe('ModelPicker 打字过滤', () => {
  it('打字即时过滤（key 轨 + kitty text 轨双轨）+ 底行过滤词呈现', () => {
    const { picker } = makePicker();
    picker.handleEvent(k('g')); // legacy 轨
    picker.handleEvent(t('p')); // kitty text 轨
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 1 个（过滤中）');
    expect(readRow(grid, 1, 72)).toContain('── openai ──'); // 唯一命中组头
    expect(readRow(grid, 2, 72)).toContain('openai/gpt-5'); // 条目在组头后一行
    expect(readRow(grid, grid.rows - 1, 72)).toContain('过滤：gp_');
  });

  it('backspace 删词回全量；过滤词空后 q 恢复退出捷键', () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(t('g'));
    picker.handleEvent(k('backspace'));
    let grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 4 个');
    // q 在无过滤词时 = 退出捷键（件族同律）
    picker.handleEvent(t('q'));
    expect(onExit).toHaveBeenCalledTimes(1);
    grid = paint(picker); // eslint 闲置变量防
    void grid;
  });

  it('空过滤词下 backspace 零动作——浏览位不动（修前红：光标强拉回首行；挖掘 34 轮）', () => {
    const { picker } = makePicker();
    picker.handleEvent(k('end')); // 光标到末条目
    let grid = paint(picker);
    expect(readRow(grid, grid.rows - 2, 72).startsWith('›')).toBe(true); // 前置锚：end 已到末条目（底行 hint 上一行）
    picker.handleEvent(k('backspace')); // 空词——零动作
    grid = paint(picker);
    expect(readRow(grid, grid.rows - 2, 72).startsWith('›')).toBe(true); // 修前红：› 跳回首组首条目
  });

  it('空结果诚实呈现（无匹配行 + 过滤词回显）', () => {
    const { picker } = makePicker();
    picker.handleEvent(t('z'));
    picker.handleEvent(t('z'));
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 0 个（过滤中）');
    expect(readRow(grid, 1, 72)).toContain('无匹配「zz」');
  });

  it('q 入过滤词（有过滤词时打字面优先——退出捷键共存律）', () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(t('g'));
    picker.handleEvent(t('q')); // 有过滤词 → q 入词（gw 族匹配）
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 0 个（过滤中）'); // 「gq」无匹配——打字面入词的证明
    expect(onExit).not.toHaveBeenCalled(); // 未当退出捷键消费
    void grid;
  });

  it('多字符 chunk 全串入词（CJK 直收——修前红：length>1 静默吞 query 恒空）', () => {
    // kitty 引擎 text 粒度「同 chunk 连续可打印游程合并」——多字符 chunk 是
    // 常态非边角；修前 `if (text.length === 1)` 之外的 chunk 落 `return true`
    // 终局吞（打字过滤面在 kitty 轨形同虚设）。rewind-picker appendQuery 先例
    // 同族修法。
    const { picker } = makePicker();
    picker.handleEvent(t('你好'));
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 0 个（过滤中）'); // 修前红位：query 恒空 → 全量 4 个
    expect(readRow(grid, 1, 72)).toContain('无匹配「你好」'); // 空结果诚实行
    expect(readRow(grid, grid.rows - 1, 72)).toContain('过滤：你好_'); // 全串入词回显
  });

  it('多字符 chunk 入词后单字符轨续接（双粒度并存——续打/删词不扰动）', () => {
    const { picker } = makePicker();
    picker.handleEvent(t('anth')); // 多字符 chunk（粘贴形整段入词）
    picker.handleEvent(t('r')); // 单字符续接（kitty 单键）
    let grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 2 个（过滤中）'); // 「anthr」命中 anthropic 两模型
    expect(readRow(grid, 2, 72)).toContain('anthropic/claude-sonnet');
    picker.handleEvent(k('backspace')); // 删词回「anth」
    grid = paint(picker);
    expect(readRow(grid, grid.rows - 1, 72)).toContain('过滤：anth_');
  });

  it('粘贴入词（paste 轨接线——修前 kind:paste 落终局吞；rewind-picker 同族修；挖掘 34 轮）', () => {
    const { picker } = makePicker();
    picker.handleEvent({ kind: 'paste', text: 'anth' } as InputEvent);
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 2 个（过滤中）'); // 修前红：paste 被吞 → 全量 4 个
    expect(readRow(grid, grid.rows - 1, 72)).toContain('过滤：anth_');
  });

  it('粘贴剥换行（单行过滤词无换行语义——与向导单行件同律）', () => {
    const { picker } = makePicker();
    picker.handleEvent({ kind: 'paste', text: 'anth\n' } as InputEvent);
    const grid = paint(picker);
    expect(readRow(grid, 0, 72)).toBe('◆ 切换模型 · 2 个（过滤中）');
    expect(readRow(grid, grid.rows - 1, 72)).toContain('过滤：anth_'); // 换行不入词
  });
});

describe('ModelPicker 选定与退出', () => {
  it('enter 选定：先收副屏再回调（序律）+ spec 全形回传', () => {
    const { picker, onSelect, onExit } = makePicker();
    picker.handleEvent(k('down'));
    picker.handleEvent(k('enter'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('anthropic/claude-opus');
    // 序律：exit 先于 select（调用序断言）
    const order: string[] = [];
    onExit.mockClear();
    onSelect.mockClear();
    const { picker: p2 } = makePicker({
      onExit: () => order.push('exit'),
      onSelect: () => order.push('select'),
    });
    p2.handleEvent(k('enter'));
    expect(order).toEqual(['exit', 'select']);
    void picker;
  });

  it('过滤态 enter 选定过滤集首项 + esc 取消零回调', () => {
    const { picker, onSelect } = makePicker();
    picker.handleEvent(t('g'));
    picker.handleEvent(t('w')); // gw-large 唯一命中
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('my-gw/gw-large');
    const { picker: p2, onSelect: sel2 } = makePicker();
    p2.handleEvent(k('escape'));
    expect(sel2).not.toHaveBeenCalled();
  });

  it('Ctrl+C 打断在飞 run 不退屏 / Ctrl+D 先收屏再退柄 / 闭锁单次', () => {
    const { picker, onInterrupt, onExit, onQuit } = makePicker();
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-abcdef1234567890');
    expect(onExit).not.toHaveBeenCalled(); // 不退屏
    picker.handleEvent(k('d', { ctrl: true }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
    // 闭锁后残键终局吞——选定零二次回调
    picker.handleEvent(k('enter'));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('滚轮 ±3 行光标（件族 WHEEL_LINES 同值）', () => {
    const { picker, onSelect } = makePicker();
    picker.handleEvent(wheel('wheel-down'));
    picker.handleEvent(k('enter'));
    // 光标 0 → 3（±3 夹取于 3 = 尾条目 my-gw/gw-large）
    expect(onSelect).toHaveBeenCalledWith('my-gw/gw-large');
  });
});

describe('ModelPicker 长清单滚动位置指示（界面美化役 2026-10-01 美学批）', () => {
  /** 多条目夹具（两 provider 各 5 条——展开 12 行含两枚组头） */
  const MANY: readonly { spec: string; provider: string; model: string }[] = [
    ...Array.from({ length: 5 }, (_, i) => ({
      spec: `p1/m${i}`,
      provider: 'p1',
      model: `m${i}`,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      spec: `p2/n${i}`,
      provider: 'p2',
      model: `n${i}`,
    })),
  ];

  const paintShort = (picker: ModelPicker, height: number, width = 40): CellGrid => {
    const grid = new CellGrid(width, height);
    picker.render(grid, { row: 0, col: 0, width, height });
    return grid;
  };

  it('锚顶：下指示 dim「↓ N 更多」（展开行集计——含组头）；组头行正常呈现', () => {
    const { picker } = makePicker({ entries: MANY, current: undefined });
    const grid = paintShort(picker, 5); // viewHeight 3、展开 12 行溢出（底指示预留 1 行 → 实占 2）
    expect(readRow(grid, 1, 40)).toContain('── p1 ──');
    expect(readRow(grid, 2, 40)).toContain('p1/m0');
    expect(readRow(grid, 3, 40)).toBe('↓ 10 更多'); // 12 - 2 实占
    expect(grid.getCell(3, 0)?.style?.dim).toBe(true);
  });

  it('到底：上指示（组头计入偏移账）；在选行可见、贴尾无下指示', () => {
    const { picker } = makePicker({ entries: MANY, current: undefined });
    picker.handleEvent(k('end')); // 光标尾条目（展开行 11）
    const grid = paintShort(picker, 5);
    expect(readRow(grid, 1, 40)).toBe('↑ 11 更多');
    expect(readRow(grid, 2, 40).startsWith('›')).toBe(true); // 在选行 p2/n4
    expect(readRow(grid, 2, 40)).toContain('p2/n4');
    expect(readRow(grid, 3, 40)).not.toContain('更多'); // 贴尾无下指示
  });
});

describe('ModelPicker 过滤宇宙指路（ux-4 翻档件 A——装配位注入 notice）', () => {
  const NOTICE = '仅显示已配置渠道的模型——/setup 添加渠道';

  it('notice 在场：头部 dim 指路行（条目区整体下移一行）+ 底行逃生口段 + measure 同步 +1', () => {
    const { picker } = makePicker({ notice: NOTICE });
    const grid = paint(picker);
    expect(readRow(grid, 1, 72)).toBe(NOTICE); // 头行下 dim 指路行（ux-4 钦定词面）
    expect(grid.getCell(1, 0)?.style?.dim).toBe(true); // dim（pi 文案先例同律）
    // 条目区整体下移一行（行 2 = 组头、行 3 = 首条目）
    expect(readRow(grid, 2, 72)).toContain('── anthropic ──');
    expect(readRow(grid, 3, 72)).toContain('anthropic/claude-sonnet');
    // measure 计入指路行（1 头 + 1 指路 + 7 展开行 + 1 底行）
    expect(picker.measure(72)).toBe(10);
    // 底行逃生口段（BERRY_AGENT_MODEL/settings 直达——codex -m 同构；窄窗
    // fitLine 收口下键名段仍可见）
    expect(readRow(grid, grid.rows - 1, 72)).toContain('BERRY_AGENT_MODEL');
    // 缺省（notice 缺席）零位移——既有锁全绿的证
    const { picker: plain } = makePicker();
    const g2 = paint(plain);
    expect(readRow(g2, 1, 72)).toContain('── anthropic ──');
    expect(plain.measure(72)).toBe(9);
  });

  it('notice 行窄窗 … 收口（wf_3c8b00b8 组δ X-5 同律——fitLine 非 raw 直写）', () => {
    const { picker } = makePicker({ notice: NOTICE });
    const grid = paint(picker, 12);
    const row = readRow(grid, 1, 12);
    expect(row.startsWith('仅')).toBe(true); // 行首锚存活（修前红位：行 1 是组头）
    expect(row.endsWith('…')).toBe(true); // 超宽省略号收口
  });
});
