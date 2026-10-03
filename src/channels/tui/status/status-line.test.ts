/**
 * 状态行件单测（V-4 注⑪ 笔3——底栏三行栈重做）：行1 仪表栈（供数器渲染期
 * pull + 坍缩梯⑧右起丢 + 模式词恒保 YOLO 警示色 + 尾注让位⑨右对齐挤占）/
 * 行2 环境栈（四槽 + 教学 dim + 坍缩梯⑧ + 整行退场 + 目录 ellipsize 兜底）/
 * 量高 1-2（宽度不驱退场——measure 只看数据在场）/ null 可逆旧形 /
 * setStatus last-writer-wins / setTheme 派生重建 / onChange 通知面。
 */
import { describe, expect, it, vi } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme } from '../theme/index.js';
import { StatusLine, type FooterSegments } from './status-line.js';

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 渲染到两行网格（行1 仪表 / 行2 环境——注⑪① 槽序） */
function renderStack(line: StatusLine, width = 80): CellGrid {
  const grid = new CellGrid(width, 2);
  line.render(grid, { row: 0, col: 0, width, height: 2 });
  return grid;
}

/** 渲染到单行网格（行2 退场形） */
function renderLine(line: StatusLine, width = 30): CellGrid {
  const grid = new CellGrid(width, 1);
  line.render(grid, { row: 0, col: 0, width, height: 1 });
  return grid;
}

/**
 * 段集工厂（供数器形——渲染期 pull）：行1 三槽 YOLO(4)/思考高(6)/glm-4.7(7)
 * 全形 23 列；行2 四槽 berry-agent(11)/sess-aaaa(9)/⎇ main@abc1234(14)/
 * 工作区写(8) + 教学(8) 全形 62 列。各测试按需覆写触发坍缩梯各档。
 */
function seg(over: Partial<FooterSegments> = {}): FooterSegments {
  return {
    instruments: () => ['YOLO', '思考高', 'glm-4.7'],
    env: () => ['berry-agent', 'sess-aaaa', '⎇ main@abc1234', '工作区写'],
    hint: '? 快捷键',
    modeDanger: true,
    ...over,
  };
}

describe('StatusLine 基础面', () => {
  it('量高：footer 缺席恒 1；在场 = 1（行2 数据全空）或 2（任一环境槽/教学在场）——宽度不驱退场（目录 ellipsize 兜底）', () => {
    expect(new StatusLine().measure(80)).toBe(1);
    const line = new StatusLine();
    line.setFooter(seg());
    expect(line.measure(80)).toBe(2);
    expect(line.measure(5)).toBe(2); // 极窄不整行退场——measure 与宽无关
    const bare = new StatusLine();
    bare.setFooter(seg({ env: () => ['', ''], hint: '' }));
    expect(bare.measure(80)).toBe(1); // 环境数据全空 = 行2 退场
  });

  it('初始闲态空行（零写出）', () => {
    expect(readRow(renderLine(new StatusLine()), 0, 30)).toBe('');
  });

  it('setStatus 闲态文案显（last-writer-wins——footer 缺席旧形居左）', () => {
    const line = new StatusLine();
    line.setStatus('✓ 用量 12,345');
    expect(readRow(renderLine(line), 0, 30)).toBe('✓ 用量 12,345');
    line.setStatus('自定义状态'); // 后写覆盖
    expect(readRow(renderLine(line), 0, 30)).toBe('自定义状态');
  });

  it('onChange 通知：换文案/换 footer 段集均触发（通知面收敛两入口）', () => {
    const line = new StatusLine();
    const spy = vi.fn();
    line.onChange = spy;
    line.setStatus('文案');
    expect(spy).toHaveBeenCalledTimes(1);
    line.setFooter(seg());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('setFooter(null) 清除回旧形（可逆切换——行2 退场 + 行1 归闲态文案居左）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    line.setFooter(null);
    line.setStatus('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('思考中'); // 旧形居左
    expect(line.measure(30)).toBe(1);
  });
});

describe('StatusLine 行1 仪表栈（V-4 注⑪②——模式/思考/模型/累计/速度/上下文）', () => {
  it('全形首画：槽序连缀（供数器渲染期 pull——闭包现值即所见）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [] })); // 行2 退场——聚焦行1
    const grid = renderStack(line, 40);
    expect(readRow(grid, 0, 40)).toBe('YOLO · 思考高 · glm-4.7');
  });

  it('样式面：模式槽 danger → error 语义键 / 其余槽 secondary / setTheme 派生重建', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [] }));
    const grid = renderStack(line, 40);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.error); // YOLO 警示色（安全律）
    expect(grid.getCell(0, 7)?.style.fg).toBe(DEFAULT_THEME.secondary); // 思考槽（4+3 起）
    expect(grid.getCell(0, 16)?.style.fg).toBe(DEFAULT_THEME.secondary); // 模型槽（13+3 起）
    // 非 danger 档：模式槽归 secondary
    const safe = new StatusLine();
    safe.setFooter(seg({ modeDanger: false, env: () => [] }));
    expect(renderStack(safe, 40).getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary);
    // 主题换装重建（真异值档断言——light 板 secondary）
    const light = resolveTheme(builtinPalette('light'), 'truecolor');
    line.setTheme(light);
    expect(renderStack(line, 40).getCell(0, 7)?.style.fg).toBe(light.secondary);
    expect(light.secondary).not.toBe(DEFAULT_THEME.secondary);
  });

  it('坍缩梯⑧：行1 右起丢（模型先丢 → 思考丢）→ 模式词恒保（ellipsize 容忍）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [] }));
    // w=15：全形 23 > 15 → 丢 glm → 13 ≤ 15
    expect(readRow(renderStack(line, 15), 0, 15)).toBe('YOLO · 思考高');
    // w=8：13 > 8 → 丢思考高 → 'YOLO' 4 ≤ 8
    expect(readRow(renderStack(line, 8), 0, 8)).toBe('YOLO');
    // w=3：模式词独存仍超宽 → ellipsize 整字截断（恒保段族最后保真形）
    expect(readRow(renderStack(line, 3), 0, 3)).toBe('YO…');
  });

  it('槽缺席过滤：空槽不产双连接符', () => {
    const line = new StatusLine();
    line.setFooter(
      seg({
        instruments: () => ['Auto', '', 'glm-4.7', '累计 500'],
        env: () => [],
      }),
    );
    expect(readRow(renderStack(line, 60), 0, 60)).toBe('Auto · glm-4.7 · 累计 500');
  });

  it('仪表全空：行1 空白保留（行恒在——measure 承诺；零高度行跳动律）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ instruments: () => [], env: () => ['berry-agent'], hint: '' }));
    const grid = renderStack(line, 30);
    expect(readRow(grid, 0, 30)).toBe('');
    expect(readRow(grid, 1, 30)).toBe('berry-agent');
  });

  it('pullSafe 拷贝不变式：生产者返冻结共享数组——坍缩梯 pop 不蚀共享缓存（两帧一致）', () => {
    // 装配侧共享缓存形：供数器直返模块级冻结数组。坍缩梯 slots.pop() 原地
    // 改写 pullSafe 返回值——安全前提 = filter 恒返新数组（签名 readonly
    // string[] 邀请生产者返共享缓存）；未来「去 filter 拷贝」透传重构必蚀
    // 共享缓存（冻结形直抛）——本锁使该重构修前必红
    const shared: readonly string[] = Object.freeze(['YOLO', '思考高', 'glm-4.7']);
    const line = new StatusLine();
    line.setFooter(seg({ instruments: () => shared, env: () => [], hint: '' }));
    // 窄宽触发坍缩梯两连 pop（23 列全形 → w=8 收敛到模式词独存）连续渲染两帧
    const frame1 = readRow(renderStack(line, 8), 0, 8);
    const frame2 = readRow(renderStack(line, 8), 0, 8);
    expect(frame1).toBe('YOLO');
    expect(frame2).toBe('YOLO'); // 两帧产出一致（无跨帧累积坍缩）
    expect(shared.length).toBe(3); // 共享数组长度未被原地 pop 蚀
    expect([...shared]).toEqual(['YOLO', '思考高', 'glm-4.7']); // 内容原样
  });
});

describe('StatusLine 尾注让位（V-4 注⑪⑨——承载行 = 行1，右对齐挤占同向衔接）', () => {
  it('尾注在场：仪表左起 + 尾注右对齐右缘垫 1（正文前景——同帧并陈）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [] }));
    line.setStatus('✓ 完成'); // 6 列
    const grid = renderStack(line, 40);
    // 仪表 23 列 col 0-22；尾注 col 33-38（w-1-6）；col 39 右缘垫
    expect(readRow(grid, 0, 40)).toBe('YOLO · 思考高 · glm-4.7          ✓ 完成');
    expect(grid.getCell(0, 33)?.style.fg).toBeUndefined(); // 尾注正文前景
  });

  it('尾注挤占：预算不足触发行1 坍缩梯（与⑧同向右起丢——衔接律）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [] }));
    line.setStatus('✓ 完成'); // 6 列——预算 = 18-6-2 = 10 < 13 → 丢思考高
    expect(readRow(renderStack(line, 18), 0, 18)).toBe('YOLO       ✓ 完成'); // 尾注 col 11-16
  });

  it('尾注超宽：右槽帽截断保底（尾注永不丢——至少截断形在场）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ instruments: () => [], env: () => [] }));
    line.setStatus('S'.repeat(15));
    // w=10：帽 8 → 7S+…，右对齐 col 1-8
    expect(readRow(renderStack(line, 10), 0, 10)).toBe(' SSSSSSS…');
  });

  it('尾注帽恰为 w-2：模式词不零宽消失（注⑧恒保——至少 ellipsize 省略号 1 列在场）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [] }));
    line.setStatus('S'.repeat(15)); // 尾注帽 w-2=8 全占——行1 预算压零位
    const grid = renderStack(line, 10);
    // 修缺陷形：预算压零时模式词（YOLO 警示安全位）曾经 ellipsize(x,0)=''
    // 整体消失——恒保律下至少 1 列 '…' 在场 + error 警示样式保真
    expect(readRow(grid, 0, 10).startsWith('…')).toBe(true);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.error);
  });
});

describe('StatusLine 行2 环境栈（V-4 注⑪③——目录/短 id/⎇/沙箱原词/教学）', () => {
  it('全形首画：行2 槽序连缀 + 教学提示 dim（独立弱存在感样式）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    const grid = renderStack(line, 80);
    expect(readRow(grid, 1, 80)).toBe('berry-agent · sess-aaaa · ⎇ main@abc1234 · 工作区写 · ? 快捷键');
    expect(grid.getCell(0, 54)?.style.dim).toBeUndefined(); // 行1 无 dim
    expect(grid.getCell(1, 54)?.style.dim).toBe(true); // 教学槽起点 col 54（46+8）
  });

  it('坍缩梯⑧：教学先丢（承 V-3 律）→ 沙箱 → ⎇ → 短 id（右起丢）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    // w=58：全 62 > 58 → 丢教学 → 54 ≤ 58
    expect(readRow(renderStack(line, 58), 1, 58)).not.toContain('? 快捷键');
    expect(readRow(renderStack(line, 58), 1, 58)).toContain('工作区写');
    // w=46：54 > 46 → 丢沙箱 → 40 ≤ 46
    expect(readRow(renderStack(line, 46), 1, 46)).not.toContain('工作区写');
    expect(readRow(renderStack(line, 46), 1, 46)).toContain('⎇ main@abc1234');
    // w=35：40 > 35 → 丢 ⎇ → 23 ≤ 35
    expect(readRow(renderStack(line, 35), 1, 35)).not.toContain('⎇');
    expect(readRow(renderStack(line, 35), 1, 35)).toBe('berry-agent · sess-aaaa');
    // w=18：23 > 18 → 丢短 id → 11 ≤ 18
    expect(readRow(renderStack(line, 18), 1, 18)).toBe('berry-agent');
  });

  it('目录槽 ellipsize 兜底（fitFooter 整字截断律退役让位——注⑪⑧）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    expect(readRow(renderStack(line, 5), 1, 5)).toBe('berr…'); // 整字截断 + 省略号
    expect(line.measure(5)).toBe(2); // 行2 不退场（数据在场）
  });

  it('行2 整行退场：环境数据全空 + 教学缺席 → 量高 1（零高度缺席）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [], hint: '' }));
    expect(line.measure(80)).toBe(1);
    expect(readRow(renderLine(line, 30), 0, 30)).toBe('YOLO · 思考高 · glm-4.7'); // 行1 独享
  });

  it('教学独存行2：环境槽全空仍呈现（dim）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => [], hint: '? 快捷键' }));
    const grid = renderStack(line, 30);
    expect(readRow(grid, 1, 30)).toBe('? 快捷键');
    expect(grid.getCell(1, 0)?.style.dim).toBe(true);
  });

  it('行2 独立左起整字截断：极长目录槽 ellipsize（CJK 双宽不产半字）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ env: () => ['很长的工作目录名占用测试'], hint: '' }));
    // 宽 8：3 个 CJK（6 列）+ …（1 列）= 7 ≤ 8——整字收口带可辨前缀
    const out = readRow(renderStack(line, 8), 1, 8);
    expect(out.startsWith('很长的')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });
});
