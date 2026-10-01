/**
 * /setup 配置向导副屏件测试（onboarding ob-3 + 2026-09-28 模型渠道批 C-3
 * v2）：六相呈现与键路由直锁——select（光标/翻选/enter 选定/esc 与 q 双轨
 * 取消/desc 次行）、multiselect（空格双轨勾选/enter 回保序清单/空选合法/
 * preselect/q 取消）、text（**明文回显翻裁锁**、追加、backspace、enter 回值、
 * 字母 q 可录入非捷键）、confirm（y/n 直答/enter 取缺省/esc 取消/lines 附呈
 * 行）、outro（任意键收屏）、Ctrl+C 打断不退屏、Ctrl+D 撤题退出（text 相
 * 有文不退——主屏空框闸让路同律）、退出闭锁后 prompter 法即时回值；外部
 * 收屏路（OverlayContent onClosed——AltScreenHost.close 单源调）悬题
 * settle；滚轮相态分派（select/multiselect 相滚清单、text/confirm 相零动作）；
 * 评审修复三件（2026-09-29）：#21 视口窗口化物理行预算（desc 次行在场条目
 * 占 2 行——尾条目含「＋ 新建」可达、光标条目+desc 完整入窗）、#22 paste
 * 剥所有换行（单行字段无换行语义）、#23 confirm 相 q kitty text 轨取消
 * （与 key 轨双轨同收——select/multiselect 同律）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent, MouseEvent, TextInputEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { MemoryTerminalIO } from '../../engine/memory-io.js';
import { AltScreenHost, type AltScreenPrimary } from '../overlay/alt-screen.js';
import { SetupWizardPanel } from './setup-wizard.js';

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

/** text 事件夹具 */
const t = (text: string): TextInputEvent => ({ kind: 'text', text });

/** promise 结算态判（悬挂 promise 测试律——断言 settle 形而非 await 挂死） */
async function settleState(p: Promise<unknown>): Promise<'pending' | 'fulfilled' | 'rejected'> {
  let s: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  void p.then(
    () => {
      s = 'fulfilled';
    },
    () => {
      s = 'rejected';
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0)); // 宏任务一拍让 then 链跑
  return s;
}

/** 面板夹具（repaint 计数 + 退出/打断/退出柄 spy） */
function makePanel() {
  const requestRepaint = vi.fn();
  const onExit = vi.fn();
  const onInterrupt = vi.fn();
  const onQuit = vi.fn();
  const panel = new SetupWizardPanel({
    sessionId: 's1',
    requestRepaint,
    onExit,
    onInterrupt,
    onQuit,
  });
  return { panel, requestRepaint, onExit, onInterrupt, onQuit };
}

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

/** 渲染一帧（按面板量高满高） */
function paint(panel: SetupWizardPanel, width = 72): CellGrid {
  const grid = new CellGrid(width, Math.max(4, panel.measure(width)));
  panel.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

describe('select 相（provider 选择）', () => {
  const SELECT_REQ = {
    title: '选择模型 provider',
    items: [
      { id: 'anthropic', label: 'anthropic' },
      { id: 'openai', label: 'openai' },
      { id: '__manual_provider__', label: '✎ 手录自定义 provider id（不限于清单）' },
    ],
    note: '清单 = 内置 provider 目录',
  } as const;

  it('渲染条目 + 首项光标 + 尾注', () => {
    const { panel } = makePanel();
    void panel.select(SELECT_REQ); // 悬置渲染帧（不答——相呈现直锁）
    const grid = paint(panel);
    expect(readRow(grid, 1, 72)).toContain('▸ anthropic');
    expect(readRow(grid, 2, 72)).toBe('  openai');
    expect(readRow(grid, 4, 72)).toContain('内置 provider 目录');
  });

  it('↓ 移动 + enter 选定回 id', async () => {
    const { panel, requestRepaint } = makePanel();
    const pending = panel.select(SELECT_REQ);
    panel.handleEvent(k('down'));
    expect(requestRepaint).toHaveBeenCalled();
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('openai');
  });

  it('preselect 光标初始位（重入默认值）', async () => {
    const { panel } = makePanel();
    const pending = panel.select({ ...SELECT_REQ, preselect: 'openai' });
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('openai');
  });

  it('desc 次行渲染（v2 分桶选单渠道元信息位——baseUrl 次行 dim）', () => {
    const { panel } = makePanel();
    void panel.select({
      title: '选择模型渠道',
      items: [
        { id: 'official:anthropic', label: 'Anthropic ✓', desc: '已配置 · https://api.anthropic.com' },
        { id: '__new_custom__', label: '＋ 自定义网关' },
      ],
      note: '官方渠道 + 自定义渠道分桶',
    });
    const grid = paint(panel);
    expect(readRow(grid, 1, 72)).toContain('Anthropic ✓');
    expect(readRow(grid, 2, 72)).toContain('已配置 · https://api.anthropic.com'); // desc 次行
    expect(readRow(grid, 3, 72)).toContain('自定义网关'); // 无 desc 不占次行
    expect(readRow(grid, 4, 72)).toContain('分桶');
  });

  it('esc 取消回 undefined；q 双轨同收（key 轨 + kitty text 轨）', async () => {
    const a = makePanel();
    const pa = a.panel.select(SELECT_REQ);
    a.panel.handleEvent(k('escape'));
    await expect(pa).resolves.toBeUndefined();

    const b = makePanel();
    const pb = b.panel.select(SELECT_REQ);
    b.panel.handleEvent(k('q'));
    await expect(pb).resolves.toBeUndefined();

    const c = makePanel();
    const pc = c.panel.select(SELECT_REQ);
    c.panel.handleEvent(t('q'));
    await expect(pc).resolves.toBeUndefined();
  });

  it('Ctrl+C 打断在飞 run 不退屏；Ctrl+D 撤题 + 退出柄', async () => {
    const a = makePanel();
    void a.panel.select(SELECT_REQ); // 悬置（Ctrl+C 不收题——打断柄独立）
    a.panel.handleEvent(k('c', { ctrl: true }));
    expect(a.onInterrupt).toHaveBeenCalledWith('s1');
    expect(a.onExit).not.toHaveBeenCalled();

    const b = makePanel();
    const pb = b.panel.select(SELECT_REQ);
    b.panel.handleEvent(k('d', { ctrl: true }));
    expect(b.onExit).toHaveBeenCalled();
    expect(b.onQuit).toHaveBeenCalled();
    await expect(pb).resolves.toBeUndefined();
  });
});

describe('multiselect 相（v2——模型清单勾选）', () => {
  const MULTI_REQ = {
    title: '勾选该渠道要用的模型',
    items: [
      { id: 'gw-large', label: 'gw-large' },
      { id: 'gw-small', label: 'gw-small' },
      { id: 'gw-mini', label: 'gw-mini' },
    ],
    note: '空格勾选 · 全不选 = 转手填',
  } as const;

  it('空格双轨勾选（key 轨 space 命名形/字符形）+ ◉/○ 标记对生渲染', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect(MULTI_REQ);
    panel.handleEvent(k('space')); // 光标在 gw-large——key 轨命名形勾选
    panel.handleEvent(k('down'));
    panel.handleEvent(k(' ')); // key 轨字符形勾 gw-small（引擎双形防御）
    const grid = paint(panel);
    expect(readRow(grid, 1, 72)).toContain('◉ gw-large'); // 勾选留痕（光标已下移）
    expect(readRow(grid, 2, 72)).toContain('▸ ◉ gw-small'); // 光标 + 勾选同帧
    expect(readRow(grid, 3, 72)).toContain('○ gw-mini'); // 未勾标记对生
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual(['gw-large', 'gw-small']);
  });

  it('kitty text 轨空格同判（打字轨勾选——market-picker 双轨同形）', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect(MULTI_REQ);
    panel.handleEvent(k('down'));
    panel.handleEvent(t(' ')); // text 轨空格勾 gw-small
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual(['gw-small']);
  });

  it('enter 回 items 序保序清单（勾选序无关——Set 无序，呈现序即回值序）', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect(MULTI_REQ);
    panel.handleEvent(k('down'));
    panel.handleEvent(k('down'));
    panel.handleEvent(k('space')); // 先勾尾项 gw-mini
    panel.handleEvent(k('up'));
    panel.handleEvent(k('up'));
    panel.handleEvent(k('space')); // 后勾首项 gw-large
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual(['gw-large', 'gw-mini']); // items 序非勾选序
  });

  it('空清单合法（直接 enter 回 []——流程侧解释转手填）', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect(MULTI_REQ);
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual([]);
  });

  it('preselect 预选集（编辑重入勾选初始态）', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect({ ...MULTI_REQ, preselect: ['gw-mini'] });
    const grid = paint(panel);
    expect(readRow(grid, 3, 72)).toContain('◉ gw-mini'); // 初始态即勾选渲染
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual(['gw-mini']);
  });

  it('空格再按撤销勾选（Set 增删幂等）', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect(MULTI_REQ);
    panel.handleEvent(k('space'));
    panel.handleEvent(k('space')); // 再按撤销
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual([]);
  });

  it('esc/q 取消回 undefined（key 轨 + kitty text 轨）', async () => {
    const a = makePanel();
    const pa = a.panel.multiselect(MULTI_REQ);
    a.panel.handleEvent(k('escape'));
    await expect(pa).resolves.toBeUndefined();

    const b = makePanel();
    const pb = b.panel.multiselect(MULTI_REQ);
    b.panel.handleEvent(k('q'));
    await expect(pb).resolves.toBeUndefined();

    const c = makePanel();
    const pc = c.panel.multiselect(MULTI_REQ);
    c.panel.handleEvent(t('q'));
    await expect(pc).resolves.toBeUndefined();
  });
});

describe('text 相（key 录入——全明文翻裁 2026-09-28）', () => {
  const TEXT_REQ = { title: 'anthropic API key', hint: '整行粘贴可带前缀' } as const;

  it('明文回显（全明文翻裁锁——v1 掩码 ● 相退役，帧即所录）', async () => {
    const { panel } = makePanel();
    const pending = panel.text(TEXT_REQ);
    panel.handleEvent(t('sk-secret-value'));
    const grid = paint(panel);
    const frame = [1, 2, 3].map((row) => readRow(grid, row, 72)).join('\n');
    expect(frame).toContain('sk-secret-value'); // 明文入帧（人面所见即所录——用户拍板翻裁）
    expect(frame).not.toContain('●'); // 掩码符退役（修前红：v1 此帧为 ● 重复）
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('sk-secret-value');
  });

  it('普通文本同律原文呈现', async () => {
    const { panel } = makePanel();
    const pending = panel.text({ title: 'provider id' });
    panel.handleEvent(t('my-gateway'));
    const grid = paint(panel);
    expect(readRow(grid, 1, 72)).toContain('my-gateway_');
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('my-gateway');
  });

  it('字母 q 是内容非捷键（key 轨 + text 轨双收）', async () => {
    const { panel } = makePanel();
    const pending = panel.text(TEXT_REQ);
    panel.handleEvent(k('q'));
    panel.handleEvent(t('ue'));
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('que');
  });

  it('backspace 删尾（代理对整字删）', async () => {
    const { panel } = makePanel();
    const pending = panel.text({ title: 'x' });
    panel.handleEvent(t('ab'));
    panel.handleEvent(k('backspace'));
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('a');
  });

  it('粘贴整段追加（paste 轨剥尾换行）', async () => {
    const { panel } = makePanel();
    const pending = panel.text(TEXT_REQ);
    panel.handleEvent({ kind: 'paste', text: 'export K=sk-p\n' });
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('export K=sk-p');
  });

  it('粘贴内嵌换行全剥（#22——单行字段无换行语义；修前红：仅剥尾换行，内嵌 \\n 入值所见≠所录）', async () => {
    const a = makePanel();
    const pa = a.panel.text(TEXT_REQ);
    a.panel.handleEvent({ kind: 'paste', text: 'sk-1\nsk-2' }); // 内嵌 \n——修前入 buffer
    a.panel.handleEvent(k('enter'));
    await expect(pa).resolves.toBe('sk-1sk-2'); // 无 \n（回显与存值同源）

    // CRLF 形同律（Windows 复制整段）
    const b = makePanel();
    const pb = b.panel.text(TEXT_REQ);
    b.panel.handleEvent({ kind: 'paste', text: 'sk-a\r\nsk-b\r\n' });
    b.panel.handleEvent(k('enter'));
    await expect(pb).resolves.toBe('sk-ask-b');
  });

  it('preview 行呈现（当前值完整显示——全明文同律）', () => {
    const { panel } = makePanel();
    void panel.text({ ...TEXT_REQ, preview: 'sk-old-value-9999' });
    const grid = paint(panel);
    expect(readRow(grid, 2, 72)).toContain('sk-old-value-9999');
  });

  it('esc 取消回 undefined', async () => {
    const { panel } = makePanel();
    const pending = panel.text(TEXT_REQ);
    panel.handleEvent(k('escape'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('Ctrl+D 有文不退（主屏空框闸让路同律——修前红：无条件退出）——悬题仍在、缓冲不清', async () => {
    const a = makePanel();
    const pa = a.panel.text(TEXT_REQ);
    a.panel.handleEvent(t('sk-live'));
    a.panel.handleEvent(k('d', { ctrl: true })); // 录入有文——仅不退（不发明「首按清缓冲」）
    expect(a.onExit).not.toHaveBeenCalled();
    expect(a.onQuit).not.toHaveBeenCalled();
    a.panel.handleEvent(k('enter'));
    await expect(pa).resolves.toBe('sk-live'); // 悬题未被 Ctrl+D 撤——录入照常回值
  });

  it('Ctrl+D 空缓冲照常退出（逃生舱不锁死——修后锁：清空后退出路恒在）', async () => {
    const b = makePanel();
    const pb = b.panel.text(TEXT_REQ);
    b.panel.handleEvent(t('x'));
    b.panel.handleEvent(k('backspace')); // 清空缓冲
    b.panel.handleEvent(k('d', { ctrl: true }));
    expect(b.onExit).toHaveBeenCalled();
    expect(b.onQuit).toHaveBeenCalled();
    await expect(pb).resolves.toBeUndefined();
  });
});

describe('confirm 相', () => {
  it('y/n 直答（双轨）', async () => {
    const a = makePanel();
    const pa = a.panel.confirm({ title: '写?', defaultYes: false });
    a.panel.handleEvent(k('y'));
    await expect(pa).resolves.toBe(true);

    const b = makePanel();
    const pb = b.panel.confirm({ title: '写?', defaultYes: true });
    b.panel.handleEvent(t('n'));
    await expect(pb).resolves.toBe(false);
  });

  it('enter 取当前态（初始 = 缺省）', async () => {
    const { panel } = makePanel();
    const pending = panel.confirm({ title: '验证?', defaultYes: false });
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe(false);
  });

  it('←/→ 退役零动作（UX 对标批——箭头定向赋值自创形退役；吞键不改默认，enter 仍取缺省）', async () => {
    const { panel } = makePanel();
    const pending = panel.confirm({ title: '验证?', defaultYes: false });
    panel.handleEvent(k('left'));
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe(false); // 修前红锚：← 切换态被 enter 结算为 true（箭头轨退役后恒取缺省）
  });

  it('esc 取消回 undefined', async () => {
    const { panel } = makePanel();
    const pending = panel.confirm({ title: '写?', defaultYes: true });
    panel.handleEvent(k('escape'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('q 双轨同收取消（#23——kitty text 轨 q 与 key 轨 q/esc 同律；修前红：text 轨 q 被吞悬置）', async () => {
    // key 轨 q（既有面——绿锁防回退）
    const a = makePanel();
    const pa = a.panel.confirm({ title: '写?', defaultYes: true });
    a.panel.handleEvent(k('q'));
    await expect(pa).resolves.toBeUndefined();

    // kitty text 轨 q（#23 修——与 select/multiselect 两键轨同收对齐）
    const b = makePanel();
    const pb = b.panel.confirm({ title: '写?', defaultYes: true });
    b.panel.handleEvent(t('q'));
    expect(await settleState(pb)).toBe('fulfilled'); // 修前红锚：q 被吞永 pending
    await expect(pb).resolves.toBeUndefined();
  });

  it('lines 附呈行（v2 全值回执位——confirm 前直呈所录值，明文翻裁同律）', () => {
    const { panel } = makePanel();
    void panel.confirm({
      title: '保存自定义渠道？',
      lines: ['渠道：my-gateway', 'key：sk-live-1234', '模型：gw-large, gw-small'],
      defaultYes: true,
    });
    const grid = paint(panel);
    expect(readRow(grid, 2, 72)).toContain('my-gateway');
    expect(readRow(grid, 3, 72)).toContain('sk-live-1234'); // key 全值入帧（掩码符退役同律）
    expect(readRow(grid, 4, 72)).toContain('gw-large, gw-small');
    expect(readRow(grid, 5, 72)).toContain('Y 是 / n 否'); // 附呈行不挤选择行（默认大写前置——UX 对标批形）
  });

  it('呈现恒随 defaultYes（UX 对标批——箭头切换轨退役后屏示静态；默认项大写前置）', () => {
    // defaultYes:true → Y 大写前置 + 括注 enter = 是；箭头键零动作不改呈现
    const a = makePanel();
    void a.panel.confirm({ title: '验证?', defaultYes: true });
    a.panel.handleEvent(k('right'));
    const gridA = paint(a.panel);
    expect(readRow(gridA, 2, 72)).toContain('Y 是 / n 否');
    expect(readRow(gridA, 2, 72)).toContain('enter = 是');

    // 对称向：defaultYes:false → N 大写 + enter = 否
    const b = makePanel();
    void b.panel.confirm({ title: '验证?', defaultYes: false });
    b.panel.handleEvent(k('left'));
    const gridB = paint(b.panel);
    expect(readRow(gridB, 2, 72)).toContain('y 是 / N 否');
    expect(readRow(gridB, 2, 72)).toContain('enter = 否');
  });
});

describe('outro / static 相与退出闭锁', () => {
  it('outro 任意键收屏（resolve + onExit）', async () => {
    const { panel, onExit } = makePanel();
    const pending = panel.outro('配置完成', ['已录入凭证 host/anthropic']);
    const grid = paint(panel);
    expect(readRow(grid, 1, 72)).toContain('已录入凭证');
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBeUndefined();
    expect(onExit).toHaveBeenCalled();
  });

  it('退出闭锁后 prompter 法即时回值（流程自然收场）', async () => {
    const { panel } = makePanel();
    void panel.outro('配置完成', []);
    panel.handleEvent(k('enter')); // 收屏终局
    await expect(panel.select({ title: 'x', items: [{ id: 'a', label: 'a' }] })).resolves.toBeUndefined();
    await expect(panel.text({ title: 'x' })).resolves.toBeUndefined();
    await expect(panel.confirm({ title: 'x', defaultYes: true })).resolves.toBeUndefined();
    await expect(panel.outro('x', [])).resolves.toBeUndefined();
  });

  it('intro 非阻塞——static 相渲染行集', () => {
    const { panel } = makePanel();
    panel.intro('模型凭证配置向导', ['三步轻向导']);
    const grid = paint(panel);
    expect(readRow(grid, 0, 72)).toContain('配置向导');
    expect(readRow(grid, 1, 72)).toContain('三步轻向导');
  });
});

describe('外部收屏路（OverlayContent onClosed——AltScreenHost.close 单源调）', () => {
  /** 悬挂 promise 判据（悬挂 promise 测试律——断言 settle 形而非 await 挂死） */
  async function settleForm(p: Promise<unknown>): Promise<'pending' | 'fulfilled' | 'rejected'> {
    const state = { s: 'pending' as 'pending' | 'fulfilled' | 'rejected' };
    void p.then(
      () => {
        state.s = 'fulfilled';
      },
      () => {
        state.s = 'rejected';
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0)); // 宏任务一拍让 then 链跑
    return state.s;
  }

  /** 主屏假件（AltScreenPrimary 窄介面最小替身——挂起/复起纯记账） */
  class FakePrimary implements AltScreenPrimary {
    state: 'idle' | 'running' | 'suspended' | 'disposed' = 'idle';
    get lifecycle(): 'idle' | 'running' | 'suspended' | 'disposed' {
      return this.state;
    }
    suspendMain(): void {
      this.state = 'suspended';
    }
    resumeMain(): void {
      this.state = 'running';
    }
  }

  /** 副屏宿主 rig：共享 MemoryTerminalIO + 主屏假件（open 前置 running 态） */
  function altRig() {
    const io = new MemoryTerminalIO(40, 6);
    const primary = new FakePrimary();
    primary.state = 'running';
    const host = new AltScreenHost(primary, io);
    return { io, primary, host };
  }

  it('closeAlt 直调后悬题 settle（undefined 形）——修前永 pending（悬垂泄漏）', async () => {
    const { host } = altRig();
    const { panel } = makePanel();
    const handle = host.open(panel);
    expect(handle).not.toBeNull();
    const pending = panel.select({
      title: '选择模型 provider',
      items: [
        { id: 'anthropic', label: 'anthropic' },
        { id: 'openai', label: 'openai' },
      ],
    });
    expect(await settleForm(pending)).toBe('pending'); // 悬置基线（close 前）
    handle!.close(); // 外部收屏路（ask 收屏扇出 / collapseAltScreen 同一 handle.close）
    expect(await settleForm(pending)).toBe('fulfilled'); // 修前红锚：外部收屏后永 pending
    await expect(pending).resolves.toBeUndefined(); // 取消形——流程侧 abortOut 诚实收场
  });

  it('外部收屏后闭锁——后续 prompter 法即时回值（流程自然收场）', async () => {
    const { host } = altRig();
    const { panel } = makePanel();
    const handle = host.open(panel);
    expect(handle).not.toBeNull();
    handle!.close();
    await expect(panel.select({ title: 'x', items: [{ id: 'a', label: 'a' }] })).resolves.toBeUndefined();
    await expect(panel.text({ title: 'x' })).resolves.toBeUndefined();
    await expect(panel.confirm({ title: 'x', defaultYes: true })).resolves.toBeUndefined();
    await expect(panel.outro('x', [])).resolves.toBeUndefined();
  });
});

describe('滚轮消费（C5——相态机内分派）', () => {
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

  it('select 相滚清单（±3 行光标路——经既有夹取；修前红：wheel 零动作）', async () => {
    const { panel } = makePanel();
    const pending = panel.select({
      title: '选择模型 provider',
      items: [
        { id: 'anthropic', label: 'anthropic' },
        { id: 'openai', label: 'openai' },
        { id: '__manual_provider__', label: '✎ 手录自定义 provider id' },
      ],
    });
    panel.handleEvent(wheel('wheel-down')); // ±3 夹取到尾项（3 条表）
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('__manual_provider__');
  });

  it('multiselect 相滚清单（与 select 同路 ±3 夹取——v2 相并入滚轮分派）', async () => {
    const { panel } = makePanel();
    const pending = panel.multiselect({
      title: '勾选模型',
      items: [
        { id: 'm1', label: 'm1' },
        { id: 'm2', label: 'm2' },
        { id: 'm3', label: 'm3' },
        { id: 'm4', label: 'm4' },
      ],
    });
    panel.handleEvent(wheel('wheel-down')); // +3 夹取到尾项 m4
    panel.handleEvent(k('space')); // 滚轮移位后光标位勾选
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toEqual(['m4']);
  });

  it('text 相滚轮零动作（录入态滚动无义——缓冲不受扰）+ confirm 相零动作', async () => {
    const a = makePanel();
    const pa = a.panel.text({ title: 'provider id' });
    a.panel.handleEvent(t('ab'));
    a.panel.handleEvent(wheel('wheel-down'));
    a.panel.handleEvent(wheel('wheel-up'));
    a.panel.handleEvent(k('enter'));
    await expect(pa).resolves.toBe('ab'); // 缓冲原样——滚轮零扰动

    const b = makePanel();
    const pb = b.panel.confirm({ title: '验证?', defaultYes: true });
    b.panel.handleEvent(wheel('wheel-up')); // 确认态零动作（yes 态不被滚轮改写）
    b.panel.handleEvent(k('enter'));
    await expect(pb).resolves.toBe(true);
  });
});

describe('busy 相（R-3 忙等指示——非阻塞 + 幂等清除）', () => {
  it('busy 呈现 ⏳ 行非阻塞（立即返回清除函数）+ repaint 触发', () => {
    const { panel, requestRepaint } = makePanel();
    const clear = panel.busy('正在拉取模型清单...');
    expect(typeof clear).toBe('function');
    expect(requestRepaint).toHaveBeenCalled(); // 呈现即重绘
    const grid = paint(panel);
    expect(readRow(grid, 0, 72)).toContain('⏳ 正在拉取模型清单...'); // 头行位（⚙ 前缀 + 忙行）
    // 非阻塞证明：busy 相上叠 select——相被下一步立即接管（无悬置）
    const pending = panel.select({ title: '选模型', items: [{ id: 'm1', label: 'm1' }] });
    panel.handleEvent(k('enter'));
    return expect(pending).resolves.toBe('m1');
  });

  it('清除函数幂等（二次调零副作用）+ 清后空 static 相', () => {
    const { panel, requestRepaint } = makePanel();
    const clear = panel.busy('正在探测 my-gw…');
    requestRepaint.mockClear();
    clear();
    expect(requestRepaint).toHaveBeenCalledTimes(1); // 清除即一次重绘
    const grid = paint(panel);
    expect(readRow(grid, 0, 72)).not.toContain('⏳'); // 头行清回常驻前缀——忙行不再呈
    requestRepaint.mockClear();
    clear(); // 二次调：幂等零副作用
    expect(requestRepaint).not.toHaveBeenCalled();
  });

  it('退出闭锁后 busy no-op + 迟到清除函数 no-op（exited 短路）', async () => {
    const { panel, requestRepaint } = makePanel();
    // 引导退出：text 相 Ctrl+D 撤题（既有退出路）
    const pending = panel.text({ title: '任意步' });
    panel.handleEvent(k('d', { ctrl: true }));
    await expect(pending).resolves.toBeUndefined();
    requestRepaint.mockClear();
    const clear = panel.busy('迟到的忙行');
    expect(requestRepaint).not.toHaveBeenCalled(); // exited：不呈现不重绘
    clear(); // 迟到清除：同样 no-op 不炸
    expect(requestRepaint).not.toHaveBeenCalled();
  });
});

describe('视口窗口化物理行预算（#21——desc 次行在场条目占 2 物理行）', () => {
  /** 定高渲染帧（区域高约束构行预算窗口——不按 measure 满高；宽 72 同 paint） */
  function paintFixed(panel: SetupWizardPanel, height: number, width = 72): CellGrid {
    const grid = new CellGrid(width, height);
    panel.render(grid, { row: 0, col: 0, width, height });
    return grid;
  }

  /** 4 条目全带 desc（每条目 2 物理行——分桶官方桶全带 baseUrl desc 主路径形） */
  const DESC_ITEMS = [
    { id: 'gw-a', label: '渠道 A', desc: 'https://a.example.com/v1' },
    { id: 'gw-b', label: '渠道 B', desc: 'https://b.example.com/v1' },
    { id: 'gw-c', label: '渠道 C', desc: 'https://c.example.com/v1' },
    { id: 'gw-d', label: '渠道 D', desc: 'https://d.example.com/v1' },
  ] as const;

  it('select：区域高 5（行预算 3）光标到底——尾条目 label+desc 完整可见（修前红：条目数当行数，尾条目滚出屏不可见）', () => {
    const { panel } = makePanel();
    void panel.select({ title: '选择模型渠道', items: [...DESC_ITEMS] });
    panel.handleEvent(k('down'));
    panel.handleEvent(k('down'));
    panel.handleEvent(k('down')); // 光标到尾条目 gw-d
    const grid = paintFixed(panel, 5); // 头行 + 3 内容行 + 键面行 = 行预算 3
    const frame = [1, 2, 3].map((row) => readRow(grid, row, 72)).join('\n');
    expect(frame).toContain('▸ 渠道 D'); // 光标尾条目 label 入帧
    expect(frame).toContain('https://d.example.com/v1'); // desc 次行同帧完整可见
  });

  it('select：「＋ 新建」尾条目可达（大量 desc 条目后 end 到底——修前红：尾段条目视觉不可达）', () => {
    const { panel } = makePanel();
    const items = [
      { id: 'ch-1', label: '渠道 1', desc: 'https://1.example.com/v1' },
      { id: 'ch-2', label: '渠道 2', desc: 'https://2.example.com/v1' },
      { id: 'ch-3', label: '渠道 3', desc: 'https://3.example.com/v1' },
      { id: 'ch-4', label: '渠道 4', desc: 'https://4.example.com/v1' },
      { id: 'ch-5', label: '渠道 5', desc: 'https://5.example.com/v1' },
      { id: 'ch-6', label: '渠道 6', desc: 'https://6.example.com/v1' },
      { id: '__new_custom__', label: '＋ 新建自定义渠道', desc: '手录网关与 key' },
    ];
    void panel.select({ title: '选择模型渠道', items });
    panel.handleEvent(k('end')); // 直达尾条目
    const grid = paintFixed(panel, 6); // 头行 + 4 内容行 + 键面行 = 行预算 4
    const frame = [1, 2, 3, 4].map((row) => readRow(grid, row, 72)).join('\n');
    expect(frame).toContain('＋ 新建自定义渠道'); // 尾条目可达（label 入帧）
    expect(frame).toContain('手录网关与 key'); // 其 desc 次行同帧完整可见
  });

  it('multiselect：同律（共用 clampOffset——行预算窗口化两相一致；修前红同形）', () => {
    const { panel } = makePanel();
    void panel.multiselect({ title: '勾选该渠道要用的模型', items: [...DESC_ITEMS] });
    panel.handleEvent(k('down'));
    panel.handleEvent(k('down'));
    panel.handleEvent(k('down')); // 光标到尾条目 gw-d
    const grid = paintFixed(panel, 5); // 行预算 3
    const frame = [1, 2, 3].map((row) => readRow(grid, row, 72)).join('\n');
    expect(frame).toContain('▸ ○ 渠道 D'); // 光标尾条目（未勾标记）label 入帧
    expect(frame).toContain('https://d.example.com/v1'); // desc 次行同帧完整可见
  });

  it('无 desc 条目回退 1 行/条目（行预算窗口化对既有无 desc 选单零回退）', () => {
    const { panel } = makePanel();
    void panel.select({
      title: '选择模型 provider',
      items: [
        { id: 'p1', label: 'provider-1' },
        { id: 'p2', label: 'provider-2' },
        { id: 'p3', label: 'provider-3' },
      ],
    });
    const grid = paintFixed(panel, 5); // 行预算 3 恰容 3 条目
    const frame = [1, 2, 3].map((row) => readRow(grid, row, 72)).join('\n');
    expect(frame).toContain('provider-1');
    expect(frame).toContain('provider-3');
  });
});

describe('窄宽省略形收口（界面美化役 2026-10-01 ①——截断省略号全域统一律）', () => {
  /** 窄宽渲染帧（24 列——引导文本族普遍越帽的窄窗形） */
  function paintNarrow(panel: SetupWizardPanel, width = 24): CellGrid {
    return paint(panel, width);
  }

  it('select 相：头行/条目标签/desc 次行/尾注/键面底行全部 … 收口（修前红：硬切无记号）', () => {
    const { panel } = makePanel();
    void panel.select({
      title: '选择模型渠道',
      items: [{ id: 'a', label: '渠道'.repeat(10), desc: `https://${'a'.repeat(40)}.example.com/v1` }],
      note: '官方渠道 + 自定义渠道分桶',
    });
    const grid = paintNarrow(panel);
    const width = 24;
    const head = readRow(grid, 0, width);
    expect(head).toContain('⚙ 配置向导'); // 头部前缀保真（截断只咬尾部）
    expect(head.endsWith('…')).toBe(true); // 修前红锚：'选择模型渠道' 硬切无 …
    const label = readRow(grid, 1, width);
    expect(label.startsWith('▸ 渠道')).toBe(true); // 光标 + 首词保真
    expect(label.endsWith('…')).toBe(true);
    expect(readRow(grid, 2, width).endsWith('…')).toBe(true); // desc 次行同律
    expect(readRow(grid, 3, width).endsWith('…')).toBe(true); // 尾注同律
    expect(readRow(grid, 4, width).endsWith('…')).toBe(true); // 键面底行同律
  });

  it('text 相：录入回显超宽 … 收口（修前红：硬切无记号）', () => {
    const { panel } = makePanel();
    void panel.text({ title: 'anthropic API key' });
    panel.handleEvent(t('k-'.repeat(20)));
    const grid = paintNarrow(panel);
    expect(readRow(grid, 1, 24).endsWith('…')).toBe(true); // 回显行 … 收口
  });

  it('宽窗适装位零扰动（… 只在超帽时出现——适装帧与修前逐字相同）', () => {
    const { panel } = makePanel();
    void panel.select({
      title: '选渠道',
      items: [{ id: 'a', label: '渠道甲' }],
      note: '短尾注',
    });
    const grid = paintNarrow(panel);
    const width = 24;
    expect(readRow(grid, 1, width)).toBe('▸ 渠道甲'); // 适装位无 …（无 desc——尾注紧随条目行）
    expect(readRow(grid, 2, width)).toBe('短尾注');
  });
});

describe('滚动溢出指示（窗上/下方被裁条目计数入键面行——用户真机反馈「光标看不到还有多少」）', () => {
  /** 定高渲染帧（同 #21 段 paintFixed 形） */
  function paintFixed(panel: SetupWizardPanel, height: number, width = 72): CellGrid {
    const grid = new CellGrid(width, height);
    panel.render(grid, { row: 0, col: 0, width, height });
    return grid;
  }

  /** 20 条目全带 desc（行预算 4 = 2 条目/窗——远超视口的真实长清单形） */
  const LONG_ITEMS = Array.from({ length: 20 }, (_, i) => ({
    id: `ch-${i + 1}`,
    label: `渠道 ${i + 1}`,
    desc: `https://${i + 1}.example.com/v1`,
  }));

  it('select：窗下溢出计数入键面行（初始帧「↓18 项」；到底帧「↑18 项」无↓——修前红：键面行恒静态无计数）', () => {
    const { panel } = makePanel();
    void panel.select({ title: '选择模型渠道', items: LONG_ITEMS });
    const first = paintFixed(panel, 6); // 头 1 + 内容 4（=2 条目）+ 键面 1
    const firstHint = readRow(first, 5, 72);
    expect(firstHint).toContain('↓18 项'); // 窗下还有 18 条目被裁
    expect(firstHint).not.toMatch(/↑\d+ 项/); // 窗上无溢出（首帧窗在条目 0）
    // 连按 down 到底（19 次）——窗口随滚，尾窗=条目 18+19，上方 18 条被裁
    for (let i = 0; i < 19; i++) panel.handleEvent(k('down'));
    const last = paintFixed(panel, 6);
    const lastHint = readRow(last, 5, 72);
    expect(lastHint).toContain('↑18 项');
    expect(lastHint).not.toMatch(/↓\d+ 项/); // 到底无窗下溢出
  });

  it('select：逐键光标条目恒在帧内（用户操作序列——20 条连续 down 每帧光标 label 可见；#21 行为扩展锁）', () => {
    const { panel } = makePanel();
    void panel.select({ title: '选择模型渠道', items: LONG_ITEMS });
    for (let step = 1; step <= 19; step++) {
      panel.handleEvent(k('down'));
      const grid = paintFixed(panel, 6); // 行预算 4
      const frame = [1, 2, 3, 4].map((row) => readRow(grid, row, 72)).join('\n');
      expect(frame).toContain(`▸ 渠道 ${step + 1}`); // 每步光标条目 label 恒可见
    }
  });

  it('multiselect：同律（键面行含窗下溢出计数；修前红同形）', () => {
    const { panel } = makePanel();
    void panel.multiselect({ title: '勾选要用的模型', items: LONG_ITEMS });
    const grid = paintFixed(panel, 6); // 行预算 4 = 2 条目
    expect(readRow(grid, 5, 72)).toContain('↓18 项');
  });

  it('全清单入窗零指示（短清单键面行不掺溢出计数）', () => {
    const { panel } = makePanel();
    void panel.select({
      title: '选择 provider',
      items: [
        { id: 'p1', label: 'provider-1' },
        { id: 'p2', label: 'provider-2' },
      ],
    });
    const grid = paintFixed(panel, 6);
    const hint = readRow(grid, 5, 72);
    expect(hint).not.toContain('项');
    expect(hint).toContain('↑↓ 移动');
  });
});
