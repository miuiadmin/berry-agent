/**
 * 任务状态行单测（V-4 底栏重做批笔 2——件 12 翻档：态② 细分 + 本轮 N + 速度退役）。
 *
 * 锁面：四态呈现形（转轮/工具段/思考中·生成中细分/重试倒计时/红 ✗）、闲态
 * 零高度缺席律、统一括号段（耗时 · 按 ESC 取消对话——dim）、供数器段缺席缩位
 * （无起点耗时/本轮/提示各自缺席不虚报）、倒计时本地钟现算（绝对时刻律——
 * nextAt 注入、now 推进随动）、转轮忙态推帧闸（终态/离场零推帧）。
 *
 * 本批翻档（07 §4.1 注⑪⑦）：态② streaming 拆 thinking「思考中」/
 * generating「生成中」（message_update 尾块分诊——零新事件型）；速度段退役
 * （taskLine speedText 尾拼 + agent_end completed 尾注速段双撤——速度面归
 * 行1 笔 3），任务行新增「本轮 N」段（位 = 状态词后括号段前——态①②，流中
 * 估值器 ⑥c 供数）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { DEFAULT_THEME } from '../theme/index.js';
import { formatElapsedCompact } from '../../../contracts/index.js';
import { TaskStatusLine, type TaskStatusProviders } from './task-status-line.js';

/** 可变供数器（测试注入面——渲染期现拉语义同生产闭包） */
function makeProviders(overrides: Partial<TaskStatusProviders> = {}): TaskStatusProviders & {
  setElapsed(value: number | null): void;
  setTurnTokens(value: string): void;
  setHint(value: string): void;
  advance(ms: number): void;
} {
  let elapsed: number | null = null;
  let turnTokens = '';
  let hint = '';
  let now = 1_000_000;
  const base: TaskStatusProviders = {
    elapsedMs: () => elapsed,
    turnTokensText: () => turnTokens,
    interruptHint: () => hint,
    now: () => now,
    ...overrides,
  };
  return Object.assign(base, {
    setElapsed(value: number | null) {
      elapsed = value;
    },
    setTurnTokens(value: string) {
      turnTokens = value;
    },
    setHint(value: string) {
      hint = value;
    },
    advance(ms: number) {
      now += ms;
    },
  });
}

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 渲染到单行网格（宽 60——全形态文案 + dim 括号段的完整呈现位；窄形显式传宽） */
function renderLine(line: TaskStatusLine, width = 60): CellGrid {
  const grid = new CellGrid(width, 1);
  line.render(grid, { row: 0, col: 0, width, height: 1 });
  return grid;
}

describe('formatElapsedCompact（任务行与收尾行共单源）', () => {
  it('紧凑梯：亚秒 0s / 秒 / 分两位秒 / 时两位分秒', () => {
    expect(formatElapsedCompact(0)).toBe('0s');
    expect(formatElapsedCompact(999)).toBe('0s');
    expect(formatElapsedCompact(5_000)).toBe('5s');
    expect(formatElapsedCompact(59_999)).toBe('59s');
    expect(formatElapsedCompact(62_000)).toBe('1m 02s');
    expect(formatElapsedCompact(90_000)).toBe('1m 30s');
    expect(formatElapsedCompact(3_600_000)).toBe('1h 00m 00s');
    expect(formatElapsedCompact(3_723_000)).toBe('1h 02m 03s');
  });
});

describe('TaskStatusLine', () => {
  it('闲态零高度缺席（measure 0 + render 零写出——不占固定区预算）', () => {
    const line = new TaskStatusLine(makeProviders());
    expect(line.measure(80)).toBe(0);
    expect(line.taskState).toBe('idle');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 60)).toBe('');
  });

  it('态① 正在对话中：转轮 accent + 基础文案 + 本轮段 + dim 括号段（速度段退役）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    expect(line.measure(80)).toBe(1);
    p.setElapsed(62_000);
    p.setTurnTokens('本轮 350');
    p.setHint('按 ESC 取消对话');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 60)).toBe('⠋ 正在对话中 · 本轮 350 (1m 02s · 按 ESC 取消对话)');
    // 速度段退役锁（注⑪⑦——任务行与收尾尾注双撤，速度面归行1 笔 3）
    expect(readRow(grid, 0, 60)).not.toContain('tok/s');
    // 转轮 accent 定值（主题单源）；文案段不着色；括号段 dim（文案宽 21 → '(' 落 col 23）
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(0, 2)?.style.fg).toBeUndefined();
    expect(grid.getCell(0, 23)?.style.dim).toBe(true);
  });

  it('态① 工具段优先（⚙ 名 … 顶替基础文案）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    line.setTool('grep');
    p.setElapsed(0);
    p.setHint('按 ESC 取消对话');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 40)).toBe('⠋ ⚙ grep … (0s · 按 ESC 取消对话)');
  });

  it('态② 细分：思考中（thinking 尾块）→ 生成中（text 尾块）+ 本轮段（注⑪⑦）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    line.enterThinking();
    p.setElapsed(2_000);
    p.setTurnTokens('本轮 120');
    p.setHint('按 ESC 取消对话');
    expect(line.taskState).toBe('thinking');
    expect(line.isBusy).toBe(true); // 双细分态皆忙（转轮闸在开）
    const grid = renderLine(line);
    expect(readRow(grid, 0, 60)).toBe('⠋ 思考中 · 本轮 120 (2s · 按 ESC 取消对话)');
    // text 尾块到达 → 生成中（词面迁移一次、状态词随流相位走）
    line.enterGenerating();
    p.setTurnTokens('本轮 180');
    expect(line.taskState).toBe('generating');
    expect(readRow(renderLine(line), 0, 60)).toBe('⠋ 生成中 · 本轮 180 (2s · 按 ESC 取消对话)');
    expect(readRow(renderLine(line), 0, 60)).not.toContain('获取响应中'); // 旧词退役
  });

  it('态② 思考活状态头（挖掘 31 轮 [2]）：活头替位/缺席兜底/态迁移连清/同值零通知', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    let notified = 0;
    line.onChange = () => {
      notified += 1;
    };
    line.enterWorking();
    line.enterThinking();
    p.setElapsed(2_000);
    p.setTurnTokens('本轮 120');
    p.setHint('按 ESC 取消对话');
    // 活头在场替「思考中」（backend 已消毒单行化——组件零呈现知识）
    line.setThinkingHeader('解析用户意图');
    expect(readRow(renderLine(line), 0, 60)).toBe('⠋ 解析用户意图 · 本轮 120 (2s · 按 ESC 取消对话)');
    // 空串与 null 同缺席（setter 归一）——回兜底词面
    line.setThinkingHeader('');
    expect(readRow(renderLine(line), 0, 60)).toBe('⠋ 思考中 · 本轮 120 (2s · 按 ESC 取消对话)');
    line.setThinkingHeader('旧头');
    // 态迁移连清：enterGenerating 归位「生成中」+ 活头清（text 相位活头退场）
    line.enterGenerating();
    expect(readRow(renderLine(line), 0, 60)).toBe('⠋ 生成中 · 本轮 120 (2s · 按 ESC 取消对话)');
    expect(readRow(renderLine(line), 0, 60)).not.toContain('旧头');
    // thinking 重入（enterThinking 重置——新段起步语义）→ 旧头不残留走兜底
    line.enterThinking();
    expect(readRow(renderLine(line), 0, 60)).toBe('⠋ 思考中 · 本轮 120 (2s · 按 ESC 取消对话)');
    // enterWorking / enterError / goIdle 连清（工具段与终态不残留活头）
    line.setThinkingHeader('驻留头');
    line.enterWorking();
    line.setThinkingHeader('驻留头');
    line.enterError('超时');
    expect(readRow(renderLine(line), 0, 60)).not.toContain('驻留头');
    line.goIdle();
    // 同值零通知（同词零重绘律——流中逐 delta 重提、恒头一零重绘）
    const before = notified;
    line.enterThinking();
    const afterEnter = notified;
    line.setThinkingHeader('同一个头');
    line.setThinkingHeader('同一个头');
    expect(notified).toBe(afterEnter + 1); // 第二次同值零通知
    expect(afterEnter).toBe(before + 1); // enterThinking 自身一次通知
  });

  it('态③ 重试中：dim 整段 + 倒计时本地钟现算（绝对时刻律）+ 转轮不停不闪 ✗', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    // nextAt = now + 3s（事件面只携绝对时刻——倒计时消费端渲染）
    line.enterRetry(2, 3, 1_000_000 + 3_000);
    p.setElapsed(8_000);
    p.setHint('按 ESC 取消对话');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 60)).toBe('⠋ 重试中 第 2/3 次 · 3s 后 (8s · 按 ESC 取消对话)');
    // 整段 dim（转轮不停——仅文案降存在感）；本轮段缺席（态③ 由倒计时顶替）
    expect(grid.getCell(0, 2)?.style.dim).toBe(true);
    expect(readRow(grid, 0, 60)).not.toContain('✗');
    // 倒计时随本地钟推进（渲染期现算——同窗重渲随动）
    p.advance(2_500);
    const grid2 = renderLine(line);
    expect(readRow(grid2, 0, 60)).toContain('1s 后');
    // 窗尽 clamp 0s（resumed 事件随后续到达）
    p.advance(1_000);
    expect(readRow(renderLine(line), 0, 60)).toContain('0s 后');
    // 转轮仍在推帧（退避窗内忙态闸在开）
    line.tick();
    expect(line.frame).toBe('⠙');
  });

  it('态④ 错误终态：红 ✗ 无转轮无括号（用量归 footer 尾注——速度段已退役）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    line.enterError();
    p.setElapsed(5_000);
    p.setTurnTokens('本轮 90');
    p.setHint('按 ESC 取消对话');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 40)).toBe('✗ 失败');
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.error);
    // 终态不推帧（转轮闸关闭）
    line.tick();
    expect(line.frame).toBe('⠋');
    expect(line.isBusy).toBe(false);
  });

  it('段缺席缩位：无起点耗时 → 仅提示；本轮缺席 → 无段；双缺席 → 无括号', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    p.setHint('按 ESC 取消对话');
    // 切焦中途附着形：无 runStartedAt——耗时段诚实缺席、提示段仍显
    expect(readRow(renderLine(line), 0, 40)).toBe('⠋ 正在对话中 (按 ESC 取消对话)');
    // 提示也缺席（防御形）——整括号退场
    p.setHint('');
    expect(readRow(renderLine(line), 0, 40)).toBe('⠋ 正在对话中');
    // 耗时在场提示缺席 → 括号只括耗时
    p.setElapsed(120_000);
    expect(readRow(renderLine(line), 0, 40)).toBe('⠋ 正在对话中 (2m 00s)');
  });

  it('超宽让位：文案段截断加省略号；括号段装不下整段退场（不截半括号）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    line.setTool('超长工具名 ABCDEF');
    p.setElapsed(5_000);
    p.setHint('按 ESC 取消对话');
    // 宽 20：括号段「 (5s · 按 ESC 取消对话)」宽 23 > 剩余 18 → 整段退场，
    // 文案段独享 18 列预算——截断加省略号、不越帽
    const grid = renderLine(line, 20);
    const text = readRow(grid, 0, 20);
    expect(text).toContain('…');
    expect(text).not.toContain('ABCDEF'); // 截断不越帽
    expect(text).not.toContain('取消对话'); // 括号段整段退场（非截半）
  });

  it('goIdle 离场 + 状态迁移通知面（onChange 触发重绘请求）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    let changes = 0;
    line.onChange = () => {
      changes += 1;
    };
    line.enterWorking();
    line.setTool('grep');
    line.goIdle();
    expect(line.measure(80)).toBe(0);
    expect(changes).toBe(3);
    // 再入工作态工具名已清（离场连清）
    line.enterWorking();
    const grid = renderLine(line);
    expect(readRow(grid, 0, 40)).toBe('⠋ 正在对话中');
  });

  it('动效门禁用形（挖掘 35 轮 B2+B4）：转轮退 • dim 静态符 + tick 零推帧零通知（静止回退）', () => {
    const p = makeProviders();
    const line = new TaskStatusLine(p);
    line.enterWorking();
    p.setElapsed(62_000);
    line.setAnimations(false);
    const grid = renderLine(line);
    // 行首 • 静态符（非 braille 帧）+ dim 样式（accent 退役）；文案照常在场
    expect(readRow(grid, 0, 60)).toBe('• 正在对话中 (1m 02s)');
    expect(grid.getCell(0, 0)?.style.dim).toBe(true);
    expect(grid.getCell(0, 0)?.style.fg).toBeUndefined();
    // tick 零推帧零通知（禁用形忙态不自重排——态变/供数变才触重绘）
    let changes = 0;
    line.onChange = () => {
      changes += 1;
    };
    const frameBefore = line.frame;
    line.tick();
    expect(changes).toBe(0);
    expect(line.frame).toBe(frameBefore);
    // 恢复启用形：tick 推帧 + 通知回归（门可逆——运行期换装同源）
    line.setAnimations(true);
    line.tick();
    expect(changes).toBe(1);
    const grid2 = renderLine(line);
    expect(readRow(grid2, 0, 40)).toBe('⠙ 正在对话中 (1m 02s)'); // elapsed 供数仍在（62s）
  });
});
