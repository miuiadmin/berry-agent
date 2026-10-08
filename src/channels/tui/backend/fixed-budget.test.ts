/**
 * 固定区段优先级截断纯函数单测（07 §4.1 挂账解挂批 C②；V-4 注⑪⑧ 笔3
 * statusWanted 扩键）。
 *
 * 锁分配梯全形：预算充足恒等直通（零截断零扰动）/ 编辑器收缩制度位先行
 * （五件批 A+B——进入截断态先弃垫与最小高铺垫收至内容高，饰高先于低段
 * 让位；下限 1 不变恒不再下压）/ 低段先缩后隐的牺牲次序（工具进度先于
 * todo）/ 状态行三行栈垂直牺牲梯（行2 环境栈在 todo 隐后让位；行1 仪表
 * 恒保底）/ 补全弹层档序（梯末位）/ overlay·ask·状态行1 恒满高 / 极端形
 * 残余如实返回（兜底归 MainScreen baseRow 钳 0——条款只兜不截模态栈）。
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
      editorContent: 6,
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
      editorContent: 6,
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
    // 制度位先行（五件批 A+B）：进入截断态编辑器先弃饰高（垫+最小高铺垫）
    // 收至内容高——低段随后按需逐级，保全行数多于旧序形（旧序编辑器量高
    // 原值滞留 sum 致低段多让）
    const a = allocateFixedBudget({
      viewportRows: 14,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 5,
      editorContent: 3,
      todo: 7,
      tool: 2,
      statusWanted: 1,
    });
    // 预算 13，初始 15：编辑器 5→3（饰高 2 行让位）后 13 ≤ 13 达标——tool/todo 全保
    expect(a).toMatchObject({ tool: 2, todo: 7, editor: 3, status: 1, total: 13 });
    const b = allocateFixedBudget({
      viewportRows: 10,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 5,
      editorContent: 3,
      todo: 7,
      tool: 5,
      statusWanted: 1,
    });
    // 预算 9，初始 18：编辑器 5→3 后 16 仍超 → tool 5→1→0（11）、todo 7→1 →
    // 1+3+1 = 5 ≤ 9 达标——todo 缩 1 保段
    expect(b).toMatchObject({ tool: 0, todo: 1, editor: 3, status: 1, total: 5 });
  });

  it('状态行垂直牺牲梯（V-4 注⑪⑧）：行2 在 todo 隐后让位；行1 恒保底', () => {
    // 制度位先行（五件批 A+B）：编辑器饰高先让——低段让位需求随之减少，
    // 行2 与低段在「编辑器内容行保全」前提下按余量分档
    const a = allocateFixedBudget({
      viewportRows: 8,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 6,
      editorContent: 4,
      todo: 0,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 7，初始 8：编辑器 6→4（饰高 2 行让位）后 6 ≤ 7 达标——status 两行全保
    expect(a).toMatchObject({ editor: 4, status: 2, total: 6 });
    const b = allocateFixedBudget({
      viewportRows: 8,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 6,
      editorContent: 4,
      todo: 1,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 7，初始 9：编辑器 6→4 后 7 ≤ 7 达标——todo 1 行与行2 双保
    expect(b).toMatchObject({ todo: 1, editor: 4, status: 2, total: 7 });
  });

  it('statusWanted 钳制：>2 钳 2（环境行至多 1）、0 钳 1（仪表行恒保底）', () => {
    expect(
      allocateFixedBudget({
        viewportRows: 40,
        overlay: 0,
        ask: 0,
        popup: 0,
        editor: 5,
        editorContent: 3,
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
        editorContent: 3,
        todo: 0,
        tool: 0,
        statusWanted: 0,
      }),
    ).toMatchObject({ status: 1 });
  });

  it('输入框收缩至内容高（五件批 A+B 语义收窄——预算不足弃垫与最小高铺垫；下限 1 不变）', () => {
    // 多行稿形：量高 8 = 内容 6 + 垫 2 → 梯收缩至内容 6（弃垫不噬内容行）
    const a = allocateFixedBudget({
      viewportRows: 8,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 8,
      editorContent: 6,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 7，初始 9：低段已空 → editor 8→6 后 7 ≤ 7 达标——内容行保全
    expect(a).toMatchObject({ editor: 6, status: 1, total: 7 });
    // 空稿形：量高 5 = 内容 1 铺 3 + 垫 2 → 收缩即下限 EDITOR_MIN_HEIGHT（1 不变）
    const b = allocateFixedBudget({
      viewportRows: 5,
      overlay: 0,
      ask: 0,
      popup: 0,
      editor: 5,
      editorContent: 1,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 4，初始 6：editor 5→1 后 2 ≤ 4 达标
    expect(b).toMatchObject({ editor: EDITOR_MIN_HEIGHT, status: 1, total: 2 });
  });

  it('补全弹层档序：输入框收缩至内容高仍超才隐弹层（收窄先于隐弹层）', () => {
    // editor 收缩至内容高即可达标——弹层保全（编辑器先牺牲）
    const keep = allocateFixedBudget({
      viewportRows: 10,
      overlay: 0,
      ask: 0,
      popup: 4,
      editor: 8,
      editorContent: 2,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 9，初始 13：editor 8→2（内容高）后 7 ≤ 9——popup 原值保全
    expect(keep).toMatchObject({ popup: 4, editor: 2, total: 7 });
    // 编辑器已在内容高仍超——弹层才隐
    const drop = allocateFixedBudget({
      viewportRows: 6,
      overlay: 0,
      ask: 0,
      popup: 4,
      editor: 2,
      editorContent: 2,
      todo: 0,
      tool: 0,
      statusWanted: 1,
    });
    // 预算 5，初始 7：editor 已内容高无可收 → popup→0 后 3 ≤ 5
    expect(drop).toMatchObject({ popup: 0, editor: 2, total: 3 });
  });

  it('overlay / ask / 状态行1 恒满高不截（模态栈与应答行是交互承诺面）', () => {
    const out = allocateFixedBudget({
      viewportRows: 8,
      overlay: 3,
      ask: 1,
      popup: 0,
      editor: 5,
      editorContent: 1,
      todo: 7,
      tool: 5,
      statusWanted: 2,
    });
    // 预算 7：编辑器 5→1（制度位——饰高 4 行先让）后 19 仍超 → tool 5→1→0
    // （14）→ todo 7→1（8）→ todo→0 后 7 ≤ 7 达标——status 两行保全——
    // overlay/ask/行1 恒保
    expect(out).toMatchObject({ overlay: 3, ask: 1, editor: 1, todo: 0, tool: 0, status: 2, total: 7 });
  });

  it('极端形：下限集仍超预算——如实返回不虚报（兜底归 baseRow 钳 0）', () => {
    const out = allocateFixedBudget({
      viewportRows: 4,
      overlay: 2,
      ask: 1,
      popup: 0,
      editor: 6,
      editorContent: 1,
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
      editorContent: 1,
      todo: 0,
      tool: 0,
      statusWanted: 2,
    });
    // 预算 max(1, 0) = 1：低段隐 + status 2→1 + editor 收 1 → 1+1 = 2 如实（恒保段不截）
    expect(out).toMatchObject({ editor: EDITOR_MIN_HEIGHT, status: 1, total: 2 });
  });
});
