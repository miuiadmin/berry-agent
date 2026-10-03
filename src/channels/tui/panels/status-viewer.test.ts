/**
 * /status 状态汇总副屏件测试（07 §4.1 命令面增补批）：buildStatusLines 行集
 * （段序 / 标签对齐 / 缺席诚实形 / env 白名单三键）直锁 + 副屏键面三件套
 * （Ctrl+C 打断 / Ctrl+D 先收屏再退出柄 / q 双轨退出闭锁）+ 开屏锚顶。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid, colorRgb, stringWidth } from '../../engine/index.js';
import { DARK_PALETTE, resolveTheme } from '../theme/index.js';
import { buildStatusLines, StatusViewer } from './status-viewer.js';
import type { StatusPanelData } from './status-viewer.js';

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

/** 全量数据夹具（各缺席形测试局部覆写） */
const DATA: StatusPanelData = {
  version: '0.2.0',
  model: 'faux/test-model',
  modelCount: 3,
  modelCredential: 'ready',
  modelCredentialKey: 'sk-status-full-9999',
  sessionId: 'sess-1234567890abcdef',
  cwdLabel: 'berry-agent',
  turns: 7,
  dataDir: '/tmp/berry-home',
  theme: 'dark',
  env: [
    { key: 'BERRY_AGENT_MODEL', value: 'faux/test-model' },
    { key: 'BERRY_AGENT_DATA_DIR', value: null },
    { key: 'BERRY_AGENT_LOG_LEVEL', value: 'debug' },
  ],
};

describe('buildStatusLines 行集构造（纯函数）', () => {
  it('段序与行集：运行时（版本/模型+全集计数）→ 会话（短 id/cwd/轮次）→ 环境（数据目录/theme/env 三键）', () => {
    const lines = buildStatusLines(DATA);
    expect(lines[0]).toBe('── 运行时 ──');
    expect(lines[1]!.startsWith('版本')).toBe(true); // 非空断言——段首行契约位
    expect(lines[1]).toContain('0.2.0');
    // 模型行 = 当前 + 全集计数（ctrl+p 循环宇宙同源）
    const modelLine = lines.find((line) => line.startsWith('模型'))!;
    expect(modelLine).toContain('faux/test-model（全集 3 个）');
    // 会话段：短 id（8 字符）+ cwd 短名 + 轮次
    expect(lines).toContain('── 会话 ──');
    expect(lines.some((line) => line.startsWith('会话') && line.includes('sess-123'))).toBe(true);
    expect(lines.some((line) => line.startsWith('工作区') && line.endsWith('berry-agent'))).toBe(true);
    expect(lines.some((line) => line.startsWith('轮次') && line.endsWith('7'))).toBe(true);
    // 环境段：数据目录 + theme 档
    expect(lines).toContain('── 环境 ──');
    expect(lines.some((line) => line.startsWith('数据目录') && line.includes('/tmp/berry-home'))).toBe(true);
    expect(lines.some((line) => line.startsWith('主题') && line.endsWith('dark'))).toBe(true);
    // env 三键：设值原样、缺席「未设」
    expect(lines.some((line) => line.startsWith('BERRY_AGENT_MODEL') && line.includes('faux/test-model'))).toBe(true);
    expect(lines.some((line) => line.startsWith('BERRY_AGENT_DATA_DIR') && line.includes('未设'))).toBe(true);
    expect(lines.some((line) => line.startsWith('BERRY_AGENT_LOG_LEVEL') && line.includes('debug'))).toBe(true);
  });

  it('缺席诚实形：dataDir null = :memory: 诊断形行；modelCount 0 = 模型目录空注记', () => {
    const lines = buildStatusLines({ ...DATA, dataDir: null, modelCount: 0 });
    expect(lines.some((line) => line.startsWith('数据目录') && line.includes(':memory:'))).toBe(true);
    expect(lines.find((line) => line.startsWith('模型'))!).toContain('模型目录空');
  });

  it('git 支名行（V-3 注⑦——footer ⎇ 段退役承接受位）：在场推行 / null 不推行', () => {
    // 缺省夹具未带 gitHead——首画基线不推行（不虚报）
    expect(buildStatusLines(DATA).every((line) => !line.startsWith('git'))).toBe(true);
    // 在场形：支名@短哈希行入会话段（工作区与轮次之间）
    const lines = buildStatusLines({ ...DATA, gitHead: 'dev@2b8a94a' });
    const gitIdx = lines.findIndex((line) => line.startsWith('git'));
    const wsIdx = lines.findIndex((line) => line.startsWith('工作区'));
    const turnsIdx = lines.findIndex((line) => line.startsWith('轮次'));
    expect(gitIdx).toBeGreaterThan(-1);
    expect(lines[gitIdx]).toContain('dev@2b8a94a');
    expect(wsIdx).toBeLessThan(gitIdx);
    expect(gitIdx).toBeLessThan(turnsIdx);
    // 空串同缺席（不推行空段）
    expect(buildStatusLines({ ...DATA, gitHead: '' }).every((line) => !line.startsWith('git'))).toBe(true);
  });

  it('今日行（V-4 注⑪⑤——footer 今日段退役迁此）：在场推行轮次后 / 零耗与缺席不推行', () => {
    // 缺省夹具未带 todaySpent——不推行（不虚报）
    expect(buildStatusLines(DATA).every((line) => !line.startsWith('今日'))).toBe(true);
    // 零耗缩位（冷启动零噪声——footer 今日段同律）
    expect(buildStatusLines({ ...DATA, todaySpent: 0 }).every((line) => !line.startsWith('今日'))).toBe(true);
    // 在场形：会话段轮次行之后、环境段之前（快照档开屏现读）
    const lines = buildStatusLines({ ...DATA, todaySpent: 12_345 });
    const todayLine = lines.find((line) => line.startsWith('今日'));
    expect(todayLine).toContain('12,345'); // formatCount 千位分组单源
    const turnsIdx = lines.findIndex((line) => line.startsWith('轮次'));
    const envIdx = lines.indexOf('── 环境 ──');
    const todayIdx = lines.indexOf(todayLine ?? '');
    expect(turnsIdx).toBeGreaterThan(-1);
    expect(todayIdx).toBe(turnsIdx + 1); // 轮次后紧邻
    expect(todayIdx).toBeLessThan(envIdx);
  });

  it('轮次行缺席诚实形：turns null（焦点会话 driver 已拆——不可知）不推行（不虚报 0 行）', () => {
    // 修前红：turns 恒 number——driver 缺席位被装配面折成假 0（/usage 从持久
    // 日志折恒有数，/status 零假报诚实性问题）；null = 不可知非零值，与 git/
    // 今日「缺席不推行」同律整行省略
    const lines = buildStatusLines({ ...DATA, turns: null });
    expect(lines.every((line) => !line.startsWith('轮次'))).toBe(true);
    // 对照腿：数值在场（含真 0——driver 在场的空会话）照常推行
    expect(buildStatusLines({ ...DATA, turns: 0 }).some((line) => line.startsWith('轮次') && line.endsWith('0'))).toBe(
      true,
    );
  });

  it('模型凭证行（ob-2 态 + C-4 全明文翻裁值）：ready 携完整供血值（人面所见即供血——修前红：v1 值恒不入面）', () => {
    const readyLines = buildStatusLines(DATA);
    const readyLine = readyLines.find((line) => line.startsWith('模型凭证'))!;
    expect(readyLine).toContain('ready');
    expect(readyLine).toContain('sk-status-full-9999'); // 完整值入面（全明文翻裁锁）
    // unconfigured 态行不携值 + 可行动指路半句
    const unLines = buildStatusLines({ ...DATA, modelCredential: 'unconfigured' });
    const unLine = unLines.find((line) => line.startsWith('模型凭证'))!;
    expect(unLine).toContain('未配置——');
    expect(unLine).not.toContain('sk-status-full-9999'); // 未配置态零值呈现
    // 态行随运行时段（模型行之后、会话段之前）
    const readyIdx = readyLines.findIndex((line) => line.startsWith('模型'));
    const credIdx = readyLines.findIndex((line) => line.startsWith('模型凭证'));
    const sessionIdx = readyLines.indexOf('── 会话 ──');
    expect(readyIdx).toBeGreaterThan(-1);
    expect(credIdx).toBeGreaterThan(readyIdx);
    expect(credIdx).toBeLessThan(sessionIdx);
  });

  it('ready 供血值缺席防御形（开屏间隙配置变更——诚实缺席半句不空行）', () => {
    const lines = buildStatusLines({ ...DATA, modelCredentialKey: null });
    expect(lines.find((line) => line.startsWith('模型凭证'))!).toContain('未设置——环境变量与模型绑定均未配置');
  });

  it('标签对齐按显示宽（CJK 双宽标签 + 值列同列起）', () => {
    const lines = buildStatusLines(DATA);
    const versionLine = lines.find((line) => line.startsWith('版本'))!;
    const themeLine = lines.find((line) => line.startsWith('主题'))!;
    // 两标签同为宽 4 CJK——值列起始列一致（纯中文标签族无码元/显示宽差）
    expect(versionLine.indexOf('0')).toBe(themeLine.indexOf('d'));
    // 凭证行（宽 8 = 最长标签「模型凭证」）值起点显示列与其余行一致：
    // 期望列用 stringWidth 口径算（值前前缀显示宽 = 标签显示宽 + 2 分隔空格，
    // dataDir 行同律）——CJK 行码元位与显示列不同尺，断言恒走显示宽
    const valueColOf = (line: string, value: string): number => stringWidth(line.slice(0, line.indexOf(value)));
    const credLine = lines.find((line) => line.startsWith('模型凭证'))!;
    expect(valueColOf(credLine, 'ready')).toBe(valueColOf(versionLine, '0'));
    expect(valueColOf(credLine, 'ready')).toBe(stringWidth('模型凭证') + 2);
  });

  it('行集不变式（E4——结构性锁，不挑行选样）：全部数据行值起点列一致 + 列宽 ≥ 最长标签/键 + 保留距', () => {
    // 两夹具同扫：全设值形 + 长值缺席形（unconfigured 指路半句——值长不搅列结构）
    for (const data of [DATA, { ...DATA, modelCredential: 'unconfigured' as const }]) {
      const lines = buildStatusLines(data);
      // 解析法（按渲染形）：数据行 = label + ≥2 空格填充 + 值——label 内部空格恒
      // 单格（词间空格），首个 2+ 空格 run 即列填充；值起点显示列 = 标签宽 + 填充宽
      const parsed = lines
        .filter((line) => line !== '' && !line.startsWith('──'))
        .map((line) => line.match(/^(.+?)( {2,})(.*)$/)!)
        .map((m) => ({ label: m[1]!, pad: m[2]!, value: m[3]! }));
      // 全部数据行可解析（无行因标签超宽而失去 ≥2 填充——超宽即此断言红）
      expect(parsed).toHaveLength(lines.filter((line) => line !== '' && !line.startsWith('──')).length);
      // 两组行集：env 白名单键行（键名即标签）与其余 label 段行——各值起点列恒一致
      const envRows = parsed.filter((p) => p.label.startsWith('BERRY_AGENT_'));
      const labelRows = parsed.filter((p) => !p.label.startsWith('BERRY_AGENT_'));
      const valueCol = (p: { label: string; pad: string }): number => stringWidth(p.label) + p.pad.length;
      const labelCols = new Set(labelRows.map(valueCol));
      const envCols = new Set(envRows.map(valueCol));
      expect(labelCols.size).toBe(1); // label 段值起点列全体一致（列对齐不变式）
      expect(envCols.size).toBe(1); // env 段值起点列全体一致（值列对齐独立于 CJK 标签段）
      // 列宽下界：最长标签显示宽 + 2 ≤ labelCol；最长 env 键宽 + 3 ≤ envKeyCol
      //（件内注释承诺的保留距——新标签/键超宽挤掉保留空格即此断言红）
      const labelCol = labelCols.values().next().value as number;
      const envKeyCol = envCols.values().next().value as number;
      expect(labelCol).toBeGreaterThanOrEqual(Math.max(...labelRows.map((p) => stringWidth(p.label))) + 2);
      expect(envKeyCol).toBeGreaterThanOrEqual(Math.max(...envRows.map((p) => stringWidth(p.label))) + 3);
    }
  });
});

describe('StatusViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行（会话短 id）+ 首段行集 + 底行提示；开屏锚顶（长内容 offset 0）', () => {
    const viewer = new StatusViewer({ data: DATA, onExit: () => {} });
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(readRow(grid, 0, 60)).toBe('◉ 状态汇总 · 会话 sess-123');
    expect(readRow(grid, 1, 60)).toBe('── 运行时 ──'); // 开屏锚顶——首段是第一行（贴尾语义被 scrollToTop 破）
    expect(readRow(grid, grid.rows - 1, 60)).toBe('q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动');
    expect(viewer.scrollOffset).toBe(0); // 全量行集超出视口——锚顶律直锁
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const onExit = vi.fn();
    const viewer = new StatusViewer({ data: DATA, onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Esc 同 q 退出', () => {
    const onExit = vi.fn();
    const viewer = new StatusViewer({ data: DATA, onExit });
    viewer.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new StatusViewer({ data: DATA, onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-1234567890abcdef');
    expect(onExit).not.toHaveBeenCalled(); // 打断不退副屏
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new StatusViewer({
      data: DATA,
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）——enter 不逃逸', () => {
    const viewer = new StatusViewer({ data: DATA, onExit: () => {} });
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });
});

describe('StatusViewer 分段头取色（V-3 注⑨①——面板分段线承接 weakRule 取色链）', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  /** 自定义板夹具（text 定义形——weakRule 在场：#e6edf3 混 #0d1117 = #383d43） */
  const WEAK_THEME = resolveTheme(
    {
      dark: true,
      colors: { ...DARK_PALETTE.colors, text: { r: 230, g: 237, b: 243 }, userMessageBg: { r: 16, g: 16, b: 16 } },
    },
    'truecolor',
    { r: 13, g: 17, b: 23 },
  );

  it('weakRule 在场 → 「── 段 ──」行整行弱线色（dim 不叠加）；正文行不着线色', () => {
    expect(WEAK_THEME.weakRule).toEqual(colorRgb('#383d43')); // 混合基自证（修前红锚——键未铸即此行红）
    const viewer = new StatusViewer({ data: DATA, onExit: () => {}, theme: WEAK_THEME });
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(readRow(grid, 1, 60)).toBe('── 运行时 ──'); // 锚位自证（行 1 = 首段头）
    expect(grid.getCell(1, 0)?.style?.fg).toEqual(WEAK_THEME.weakRule); // 修前红：旧形恒 dim 无 fg
    expect(grid.getCell(1, 6)?.style?.fg).toEqual(WEAK_THEME.weakRule); // 段名中段同律（整行一致）
    expect(grid.getCell(1, 0)?.style?.dim).toBeUndefined(); // 弱线色在场 dim 不叠加
    expect(grid.getCell(2, 0)?.style?.fg).toBeUndefined(); // 正文行不沿线色（值行裸样式）
  });

  it('键缺席（DEFAULT_THEME）→ dim 回退既有形（弱线色缺位不破相）', () => {
    const viewer = new StatusViewer({ data: DATA, onExit: () => {} }); // 缺省 theme = DEFAULT_THEME（键缺席）
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(grid.getCell(1, 0)?.style?.dim).toBe(true); // 回退腿：dim 既有形
    expect(grid.getCell(1, 0)?.style?.fg).toBeUndefined();
  });
});
