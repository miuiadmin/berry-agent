/**
 * /setup 配置向导副屏件测试（onboarding ob-3）：五相呈现与键路由直锁——
 * select（光标/翻选/enter 选定/esc 与 q 双轨取消）、text（敏感掩码/追加/
 * backspace/enter 回值/字母 q 可录入非捷键）、confirm（y/n 直答/enter 取
 * 缺省/esc 取消）、outro（任意键收屏）、Ctrl+C 打断不退屏、Ctrl+D 撤题退
 * 出、退出闭锁后 prompter 法即时回值、敏感值不入面（渲染帧无明文）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent, TextInputEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
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

describe('text 相（key 录入）', () => {
  const TEXT_REQ = { title: 'anthropic API key', sensitive: true, hint: '整行粘贴可带前缀' } as const;

  it('敏感掩码呈现——明文不入帧', async () => {
    const { panel } = makePanel();
    const pending = panel.text(TEXT_REQ);
    panel.handleEvent(t('sk-secret-value'));
    const grid = paint(panel);
    const frame = [1, 2, 3].map((row) => readRow(grid, row, 72)).join('\n');
    expect(frame).not.toContain('sk-secret-value');
    expect(frame).toContain('●');
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe('sk-secret-value'); // 值只经回值出屏
  });

  it('非敏感原文呈现（自定义 id 步）', async () => {
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

  it('preview 行呈现（头4尾4）', () => {
    const { panel } = makePanel();
    void panel.text({ ...TEXT_REQ, preview: 'sk-o…9999' });
    const grid = paint(panel);
    expect(readRow(grid, 2, 72)).toContain('sk-o…9999');
  });

  it('esc 取消回 undefined', async () => {
    const { panel } = makePanel();
    const pending = panel.text(TEXT_REQ);
    panel.handleEvent(k('escape'));
    await expect(pending).resolves.toBeUndefined();
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

  it('← 切是 → 切否 + enter 回切换态', async () => {
    const { panel } = makePanel();
    const pending = panel.confirm({ title: '验证?', defaultYes: false });
    panel.handleEvent(k('left'));
    panel.handleEvent(k('enter'));
    await expect(pending).resolves.toBe(true);
  });

  it('esc 取消回 undefined', async () => {
    const { panel } = makePanel();
    const pending = panel.confirm({ title: '写?', defaultYes: true });
    panel.handleEvent(k('escape'));
    await expect(pending).resolves.toBeUndefined();
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
