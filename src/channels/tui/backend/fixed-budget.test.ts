/**
 * 固定区段优先级截断纯函数单测（07 §4.1 挂账解挂批 C②；V-4 注⑪⑧ 笔3
 * statusWanted 扩键）。
 *
 * 锁分配梯全形：预算充足恒等直通（零截断零扰动）/ 低段先缩后隐的牺牲
 * 次序（工具进度先于 todo）/ 状态行三行栈垂直牺牲梯（行2 环境栈在 todo
 * 隐后、输入框收窄前让位；行1 仪表恒保底）/ 输入框收窄至下限恒不再下压 /
 * 补全弹层档序（编辑器收窄之后）/ overlay·ask·状态行1 恒满高 / 极端形残余
 * 如实返回（兜底归 MainScreen baseRow 钳 0——条款只兜不截模态栈）。
 */
import { describe, expect, it } from 'vitest';
import { allocateFixedBudget, EDITOR_MIN_HEIGHT } from './fixed-budget.js';

describe('allocateFixedBudget 固定区段优先级截断', () => {
  it('预算充足：恒等直通零截断（各段原值 + statusWanted 直通）', () => {
    const out = allocateFixedBudget({
      viewportRows: 31,
      overlay: 2,
      ask: 1,
      popup: 0,
      editor: 8,
      todo: 7,
      tool: 5,
      statusWanted: 2,
    });
    // 预算 30，总和 25——三行栈 2 行直通
    expect(out).toEqual({ overlay: 2, ask: 1, popup: 0, editor: 8, todo: 7, tool: 5, status: 2, total: 25 });
  });

  it('恰等预算（总高 = 视口 - 1）：不动刀（截断目标为 ≤ 而非 <）', () => {
    const out = allocateFixedBudget({
      viewportRows: 26,
      overlay: 2,
      ask: 1,
      popup: 0,
      editor: 8,
      todo: 7,
      tool: 5,
      statusWanted: 2,
    });
    // 预算 25，总和 25——零截断
    expect(out.total).toBe(25);
    expect(out.todo).toBe(7);
    expect(out.tool).toBe(5);
    expect(out.status).toBe(2);
  });

  it('低段牺牲次序：工具进度先缩后隐，todo 后缩后隐（各自独立逐级）', () => {
    // 仅工具进度超 1 行：缩到 1 即达标——todo 不动
    const a = allocateFixedBudget({
      viewportRows: 14,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 5,
      todo: 7,
      tool: 2,
      statusWanted: 1,
    });
    // 预算 13，初始 15：tool 2→1 后 14 仍超 → tool→0 后 13 达标——todo 保全
    expect(a).toMatchObject({ tool: 0, todo: 7, editor: 5, status: 1, total: 13 });
    // todo 与工具同超：低段全隐后达标
    const b = allocateFixedBudget({
      viewportRows: 10,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 5,
      todo: 7,
      tool: 5,
      statusWanted: 1,
    });
    // 预算 9，初始 18：tool 5→1→0（13）、todo 7→1 → 1+5+1 = 7 ≤ 9 达标——todo 缩 1 保段
    expect(b).toMatchObject({ tool: 0, todo: 1, editor: 5, status: 1, total: 7 });
  });

  it('状态行垂直牺牲梯（V-4 注⑪⑧）：行2 在 todo 隐后、输入框收窄前让位；行1 恒保底', () => {
    // 低段已空仍超 1 行：status 2→1 达标——editor 原值保全（行2 先于输入框让位）
    const a = allocateFixedBudget({
      viewportRows: 8,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 6,
      todo: 0,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 7，初始 8：tool/todo 已零 → status 2→1 后 7 ≤ 7 达标——editor 6 不动刀
    expect(a).toMatchObject({ editor: 6, status: 1, total: 7 });
    // todo 在场同形：todo 先缩到 1 即达标（行2 尚未让位——梯位在 todo 隐后）
    const b = allocateFixedBudget({
      viewportRows: 8,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 6,
      todo: 1,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 7，初始 9：todo 1→0 后 8 仍超 → status 2→1 后 7 达标
    expect(b).toMatchObject({ todo: 0, editor: 6, status: 1, total: 7 });
  });

  it('statusWanted 钳制：>2 钳 2（环境行至多 1）、0 钳 1（仪表行恒保底）', () => {
    expect(
      allocateFixedBudget({
        viewportRows: 40,
        overlay: 0,
        ask: 0,
        popup: 0,
        editor: 5,
        todo: 0,
        tool: 0,
        statusWanted: 5,
      }),
    ).toMatchObject({ status: 2 });
    expect(
      allocateFixedBudget({
        viewportRows: 40,
        overlay: 0,
        ask: 0,
        popup: 0,
        editor: 5,
        todo: 0,
        tool: 0,
        statusWanted: 0,
      }),
    ).toMatchObject({ status: 1 });
  });

  it('输入框收窄至下限 1 恒不再下压（内容最小高——V-0 注③ 框退役零占位）', () => {
    const out = allocateFixedBudget({
      viewportRows: 8,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 8,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 7，初始 9：低段已空 → editor 8→1 后 2 ≤ 7 达标
    expect(out).toMatchObject({ editor: EDITOR_MIN_HEIGHT, status: 1, total: 2 });
  });

  it('补全弹层档序：输入框收至下限仍超才隐弹层（收窄先于隐弹层）', () => {
    // editor 收窄即可达标——弹层保全（编辑器先牺牲）
    const keep = allocateFixedBudget({
      viewportRows: 10,
      overlay: 0,
      ask: 0,
      popup: 4,
      editor: 8,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 9，初始 13：editor 8→1 后 6 ≤ 9——popup 原值保全
    expect(keep).toMatchObject({ popup: 4, editor: 1, total: 6 });
    // 编辑器已在下限仍超——弹层才隐
    const drop = allocateFixedBudget({
      viewportRows: 6,
      overlay: 0,
      ask: 0,
      popup: 4,
      editor: 1,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 5，初始 6：editor 已 1 无可收 → popup→0 后 2 ≤ 5
    expect(drop).toMatchObject({ popup: 0, editor: 1, total: 2 });
  });

  it('overlay / ask / 状态行1 恒满高不截（模态栈与应答行是交互承诺面）', () => {
    const out = allocateFixedBudget({
      viewportRows: 8,
      overlay: 3,
      ask: 1,
      popup: 0,
      editor: 5,
      todo: 7,
      tool: 5,
      statusWanted: 2,
    });
    // 预算 7：低段全隐 + status 2→1 + editor 收 1 → 3+1+1+1 = 6 ≤ 7 达标——overlay/ask/行1 保全
    expect(out).toMatchObject({ overlay: 3, ask: 1, editor: 1, todo: 0, tool: 0, status: 1, total: 6 });
  });

  it('极端形：下限集仍超预算——如实返回不虚报（兜底归 baseRow 钳 0）', () => {
    const out = allocateFixedBudget({
      viewportRows: 4,
      overlay: 2,
      ask: 1,
      popup: 0,
      editor: 6,
      todo: 0,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 3：status→1 + editor 收 1 → 2+1+1+1 = 5 > 3——恒保段不动刀，total 如实 5
    expect(out.total).toBe(5);
  });

  it('视口 1 行形：预算下限兜 1（正文滚动区至少 1 行的退化形仍可分配）', () => {
    const out = allocateFixedBudget({
      viewportRows: 1,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 3,
      todo: 0,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 max(1, 0) = 1：低段隐 + status 2→1 + editor 收 1 → 1+1 = 2 如实（恒保段不截）
    expect(out).toMatchObject({ editor: EDITOR_MIN_HEIGHT, status: 1, total: 2 });
  });
});
