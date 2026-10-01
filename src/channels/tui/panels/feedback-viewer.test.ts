/**
 * /feedback 反馈副屏件测试（UX ④拍板——2026-09-30 UX 五问题批 + 2026-10-01
 * 界面美化役批）：错误史扫描纯函数（两腿收集/同轮去重/时间降序/条目帽/页溢
 * 出截断/过滤位透传）+ 行集与诊断包构造（首行截宽消毒/空态/截断披露/回执
 * 段/零上报声明）+ 副屏键面（三件套同律 + e 导出动作：柄调用/回执落尾段跳
 * 尾立现/柄异常诚实回执/柄缺席无动作）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import {
  buildFeedbackLines,
  FeedbackViewer,
  firstErrorLine,
  formatFeedbackStamp,
  renderFeedbackDiagnosticReport,
  scanFeedbackErrors,
} from './feedback-viewer.js';
import type { FeedbackPanelData, FeedbackScanEvent, FeedbackScanQuery } from './feedback-viewer.js';

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

/** 本地时区时间夹具（呈现按本地折——构造也用本地，测试时区无关） */
const t = (month9BasedDay: number, hour: number, minute = 0): number =>
  new Date(2026, 8, month9BasedDay, hour, minute).getTime();

/** 面板数据夹具（两腿各一条——空态/截断另测） */
const DATA: FeedbackPanelData = {
  windowDays: 7,
  sessionsTotal: 12,
  scannedSessions: 12,
  errors: [
    { time: t(30, 14, 5), sessionId: 'sessabcd1234', text: '连接超时', source: 'message' },
    { time: t(29, 9, 1), sessionId: 'sesswxyz9876', text: '第一行\n第二行详情', source: 'turn' },
  ],
  truncated: false,
};

/* ───────────────────── 扫描纯函数 ───────────────────── */

/** 查询面夹具（按会话分页表 + 过滤位透传记录） */
function mkQuery(pagesBySession: Record<string, { events: FeedbackScanEvent[]; nextCursor?: unknown }>): {
  query: FeedbackScanQuery;
  calls: { sessionId: string; types: readonly string[]; sinceMs: number; limit: number }[];
} {
  const calls: { sessionId: string; types: readonly string[]; sinceMs: number; limit: number }[] = [];
  const query: FeedbackScanQuery = (filter) => {
    calls.push(filter);
    const page = pagesBySession[filter.sessionId];
    return { events: page?.events ?? [], nextCursor: page?.nextCursor ?? null };
  };
  return { query, calls };
}

/** 事件夹具简写 */
const ev = (type: string, time: number, data: unknown): FeedbackScanEvent => ({ type, time, data });

describe('scanFeedbackErrors 错误史扫描（纯函数）', () => {
  it('两腿收集 + 同轮去重：errorMessage 腿即时记条、无正文的 turn/end error 才合成收尾条', () => {
    const { query } = mkQuery({
      s1: {
        events: [
          ev('turn/start', t(30, 10), {}),
          ev('assistant/message', t(30, 10, 1), { errorMessage: '模型网关 502' }),
          ev('turn/end', t(30, 10, 2), { reason: 'error' }), // 同轮已有正文腿——去重不合成
          ev('turn/start', t(30, 11), {}),
          ev('assistant/message', t(30, 11, 1), { text: '正常消息无错误' }), // 无 errorMessage 腿
          ev('turn/end', t(30, 11, 2), { reason: 'error' }), // 无正文腿——合成收尾条
        ],
      },
    });
    const { errors, truncated } = scanFeedbackErrors({
      sessions: [{ id: 's1' }],
      queryEvents: query,
      sinceMs: t(29, 0),
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({
      time: t(30, 11, 2),
      sessionId: 's1',
      text: '运行失败（未记录错误详情）',
      source: 'turn',
    });
    expect(errors[1]).toEqual({ time: t(30, 10, 1), sessionId: 's1', text: '模型网关 502', source: 'message' });
    expect(truncated).toBe(false);
  });

  it('非 error 收尾不记条（completed/aborted/error 外词汇零条目）', () => {
    const { query } = mkQuery({
      s1: {
        events: [
          ev('turn/start', t(30, 10), {}),
          ev('turn/end', t(30, 10, 1), { reason: 'completed' }),
          ev('turn/start', t(30, 11), {}),
          ev('turn/end', t(30, 11, 1), { reason: 'aborted' }),
        ],
      },
    });
    const { errors } = scanFeedbackErrors({
      sessions: [{ id: 's1' }],
      queryEvents: query,
      sinceMs: t(29, 0),
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(errors).toEqual([]);
  });

  it('空串 errorMessage 不算正文腿（收尾合成不误吞）', () => {
    const { query } = mkQuery({
      s1: {
        events: [
          ev('turn/start', t(30, 10), {}),
          ev('assistant/message', t(30, 10, 1), { errorMessage: '' }),
          ev('turn/end', t(30, 10, 2), { reason: 'error' }),
        ],
      },
    });
    const { errors } = scanFeedbackErrors({
      sessions: [{ id: 's1' }],
      queryEvents: query,
      sinceMs: t(29, 0),
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.source).toBe('turn');
  });

  it('跨会话合并 + 时间降序（新到旧）', () => {
    const { query } = mkQuery({
      old: { events: [ev('assistant/message', t(28, 8), { errorMessage: '早' })] },
      new: { events: [ev('assistant/message', t(30, 9), { errorMessage: '晚' })] },
    });
    const { errors } = scanFeedbackErrors({
      sessions: [{ id: 'old' }, { id: 'new' }],
      queryEvents: query,
      sinceMs: t(28, 0),
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(errors.map((e) => e.text)).toEqual(['晚', '早']);
  });

  it('条目帽：超帽截到 maxEntries 且 truncated 诚实披露', () => {
    const { query } = mkQuery({
      s1: {
        events: [
          ev('assistant/message', t(30, 10), { errorMessage: '一' }),
          ev('assistant/message', t(30, 11), { errorMessage: '二' }),
          ev('assistant/message', t(30, 12), { errorMessage: '三' }),
        ],
      },
    });
    const { errors, truncated } = scanFeedbackErrors({
      sessions: [{ id: 's1' }],
      queryEvents: query,
      sinceMs: t(29, 0),
      pageLimit: 10000,
      maxEntries: 2,
    });
    expect(errors.map((e) => e.text)).toEqual(['三', '二']); // 降序后截——留最近
    expect(truncated).toBe(true);
  });

  it('页溢出（nextCursor 非空）→ truncated 诚实披露', () => {
    const { query } = mkQuery({
      s1: { events: [ev('assistant/message', t(30, 10), { errorMessage: '一' })], nextCursor: 'more' },
    });
    const { truncated } = scanFeedbackErrors({
      sessions: [{ id: 's1' }],
      queryEvents: query,
      sinceMs: t(29, 0),
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(truncated).toBe(true);
  });

  it('过滤位透传（types 三件 + sinceMs + 页帽原样达查询面——扫描语义单源）', () => {
    const { query, calls } = mkQuery({ s1: { events: [] } });
    scanFeedbackErrors({
      sessions: [{ id: 's1' }],
      queryEvents: query,
      sinceMs: 123456,
      pageLimit: 777,
      maxEntries: 50,
    });
    expect(calls).toEqual([
      { sessionId: 's1', types: ['turn/start', 'assistant/message', 'turn/end'], sinceMs: 123456, limit: 777 },
    ]);
  });
});

/* ───────────────────── 呈现纯函数 ───────────────────── */

describe('formatFeedbackStamp 时间戳呈现', () => {
  it('MM-DD HH:mm 本地时区两位补齐', () => {
    expect(formatFeedbackStamp(new Date(2026, 8, 5, 9, 7).getTime())).toBe('09-05 09:07');
    expect(formatFeedbackStamp(new Date(2026, 11, 31, 23, 59).getTime())).toBe('12-31 23:59');
  });
});

describe('firstErrorLine 错误首行', () => {
  it('多行只取首行', () => {
    expect(firstErrorLine('第一行\n第二行\n第三行')).toBe('第一行');
  });

  it('转义序列与控制字节消毒（行集零控制字节律）', () => {
    expect(firstErrorLine('\x1b[31m红\x1b[0m文本')).toBe('红文本');
    expect(firstErrorLine('a\tb')).toBe('a  b'); // tab 语义展开 2 空格
  });

  it('超宽截断收口（帽 96——省略号结尾不溢出）', () => {
    const out = firstErrorLine('错'.repeat(200));
    expect(out.length).toBeLessThanOrEqual(97); // 96 列 + 省略号 1 字符（CJK 计宽另测下界）
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildFeedbackLines 行集构造（纯函数）', () => {
  it('错误史段头带范围与条数 + 条目「时间 · 短 id · 首行」+ 导出段说明', () => {
    const lines = buildFeedbackLines(DATA);
    expect(lines[0]).toBe('── 运行错误（近 7 天 · 2 条）──');
    expect(lines[1]).toBe('09-30 14:05 · sessabcd · 连接超时');
    expect(lines[2]).toBe('09-29 09:01 · sesswxyz · 第一行'); // 多行只呈首行
    expect(lines).toContain('── 诊断导出 ──');
    expect(lines).toContain('按 e 生成诊断包并保存到本机（不会上传）：');
    expect(lines).toContain('· 范围：近 7 天 · 最近 12 个会话（共 12 个）');
    expect(lines).not.toContain('── 导出回执 ──'); // 未导出无回执段
  });

  it('空态：范围行 + 无错误记录行（无截断噪音）', () => {
    const lines = buildFeedbackLines({ ...DATA, errors: [] });
    expect(lines[0]).toBe('── 运行错误（近 7 天 · 0 条）──');
    expect(lines[1]).toBe('（近 7 天没有运行错误记录）');
    expect(lines).not.toContain('（部分结果超出扫描上限未列出——以上为最近的错误）');
  });

  it('截断披露行只在有条目时在场', () => {
    const lines = buildFeedbackLines({ ...DATA, truncated: true });
    expect(lines).toContain('（部分结果超出扫描上限未列出——以上为最近的错误）');
  });

  it('回执段：导出后尾随（段头 + 回执行）', () => {
    const lines = buildFeedbackLines(DATA, '已导出诊断包 → /tmp/feedback-x.md');
    expect(lines[lines.length - 2]).toBe('── 导出回执 ──');
    expect(lines[lines.length - 1]).toBe('已导出诊断包 → /tmp/feedback-x.md');
  });
});

describe('renderFeedbackDiagnosticReport 诊断包全文（纯函数）', () => {
  it('标题 + 零上报声明 + 环境段 + 范围段（N/M 与上限披露）', () => {
    const report = renderFeedbackDiagnosticReport({
      exportedAt: new Date(2026, 9, 1, 10, 30, 5).getTime(),
      data: { ...DATA, sessionsTotal: 34 },
      env: ['版本    0.1.0', '平台    darwin/arm64'],
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(report.startsWith('# 诊断包（/feedback 导出）')).toBe(true);
    expect(report).toContain('导出时间：2026-10-01 10:30:05');
    expect(report).toContain('不会上传到任何服务器');
    expect(report).toContain('## 环境');
    expect(report).toContain('版本    0.1.0');
    expect(report).toContain('## 范围');
    expect(report).toContain('- 会话：最近 12 个（会话总数 34）');
    expect(report).toContain('- 上限：单会话事件 10000 条 / 错误条目 50 条');
    expect(report).toContain('- 截断：否');
  });

  it('错误条目：序号时间短 id + 来源标注 + 全文多行保留 + 消毒', () => {
    const report = renderFeedbackDiagnosticReport({
      exportedAt: t(30, 12),
      data: {
        ...DATA,
        errors: [
          {
            time: t(30, 14, 5),
            sessionId: 'sessabcd1234',
            text: '连接\x1b[31m超时\x1b[0m\n重试三次失败',
            source: 'message',
          },
          { time: t(29, 9, 1), sessionId: 'sesswxyz9876', text: '运行失败（未记录错误详情）', source: 'turn' },
        ],
      },
      env: [],
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(report).toContain('### 1. 09-30 14:05 · 会话 sessabcd');
    expect(report).toContain('- 来源：错误消息正文');
    expect(report).toContain('连接超时\n重试三次失败'); // 转义剥除 + LF 保留全文
    expect(report).not.toContain('\x1b');
    expect(report).toContain('### 2. 09-29 09:01 · 会话 sesswxyz');
    expect(report).toContain('- 来源：运行失败收尾（无错误正文）');
  });

  it('截断时范围段如实翻档', () => {
    const report = renderFeedbackDiagnosticReport({
      exportedAt: t(30, 12),
      data: { ...DATA, truncated: true },
      env: [],
      pageLimit: 10000,
      maxEntries: 50,
    });
    expect(report).toContain('- 截断：是——部分结果超出上限，仅含最近的错误');
  });
});

/* ───────────────────── 副屏件 ───────────────────── */

describe('FeedbackViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行 + 错误史首条 + 底行键面提示（含 e）；开屏锚顶', () => {
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 'sess-12345678', onExit: () => {} });
    const grid = new CellGrid(80, Math.max(3, viewer.measure(80)));
    viewer.render(grid, { row: 0, col: 0, width: 80, height: grid.rows });
    expect(readRow(grid, 0, 80)).toBe('◉ 反馈 /feedback');
    expect(readRow(grid, 1, 80)).toBe('── 运行错误（近 7 天 · 2 条）──'); // 开屏锚顶——段头是第一行
    expect(readRow(grid, 2, 80)).toBe('09-30 14:05 · sessabcd · 连接超时');
    expect(readRow(grid, grid.rows - 1, 80)).toBe('q/esc 返回 · e 导出诊断包 · ↑↓/pgup/pgdn/home/end 滚动');
    expect(viewer.scrollOffset).toBe(0);
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const onExit = vi.fn();
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 's', onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Esc 同 q 退出', () => {
    const onExit = vi.fn();
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 's', onExit });
    viewer.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 'sess-fb-1', onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-fb-1');
    expect(onExit).not.toHaveBeenCalled(); // 打断不退副屏
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new FeedbackViewer({
      data: DATA,
      sessionId: 's',
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('e = 导出（key 轨 + text 轨两形）：柄被调、回执落尾段并跳尾立现', () => {
    const receipt = '已导出诊断包 → /data/diagnostics/feedback-2026.md';
    const onExport = vi.fn(() => receipt);
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 's', onExport, onExit: () => {} });
    // 矮视口（内容 9 行超出视口 6 行——滚动条让列在场，读行只读前 79 列）；
    // home 显式锚顶建立确定顶位（构造期缺省几何与真几何差异下 follow 态不
    // 作断言依据——home 后 offset 0 是用户可感知的顶锚）
    const grid = new CellGrid(80, 8);
    viewer.render(grid, { row: 0, col: 0, width: 80, height: 8 });
    viewer.handleEvent(k('home'));
    expect(viewer.scrollOffset).toBe(0);
    expect(viewer.handleEvent(k('e'))).toBe(true);
    expect(onExport).toHaveBeenCalledTimes(1);
    // 导出后帧（新网格——期望帧证据法：每帧独立，不承上帧残影）
    const grid2 = new CellGrid(80, 8);
    viewer.render(grid2, { row: 0, col: 0, width: 80, height: 8 });
    // 跳尾后回执段在视口尾可见（视口行 1..6——回执行 = 倒数第二内容行 row 6，
    // 段头 row 5；末行 row 7 是键面提示）
    expect(readRow(grid2, 6, 79)).toBe(receipt);
    expect(readRow(grid2, 5, 79)).toBe('── 导出回执 ──');
    // text 轨再按一次 e = 再导出（回执翻新不闭锁——重复导出是合法动作）
    expect(viewer.handleEvent({ kind: 'text', text: 'e' } as InputEvent)).toBe(true);
    expect(onExport).toHaveBeenCalledTimes(2);
  });

  it('e 柄异常：诚实失败回执（不外抛——副屏事件环不接异常）', () => {
    const viewer = new FeedbackViewer({
      data: DATA,
      sessionId: 's',
      onExport: () => {
        throw new Error('磁盘已满');
      },
      onExit: () => {},
    });
    expect(viewer.handleEvent(k('e'))).toBe(true);
    const grid = new CellGrid(80, 8);
    viewer.render(grid, { row: 0, col: 0, width: 80, height: 8 });
    expect(readRow(grid, 6, 79)).toBe('导出失败：磁盘已满');
  });

  it('e 柄缺席：无动作不炸（防御位——产线装配恒在场）', () => {
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 's', onExit: () => {} });
    expect(viewer.handleEvent(k('e'))).toBe(true); // 模态吞键仍在——柄缺席只是无导出
  });

  it('shift+e 不触发导出（无修饰动作键律）', () => {
    const onExport = vi.fn(() => 'x');
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 's', onExport, onExit: () => {} });
    viewer.handleEvent(k('e', { shift: true }));
    expect(onExport).not.toHaveBeenCalled();
  });

  it('未消费键终局吞（模态独占）——enter 不逃逸', () => {
    const viewer = new FeedbackViewer({ data: DATA, sessionId: 's', onExit: () => {} });
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });
});
