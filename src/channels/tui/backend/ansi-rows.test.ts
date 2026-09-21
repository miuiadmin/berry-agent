/**
 * ansi-rows 件测试（styledLineToAnsi 消毒兜底 + clampRuns/capStyledLine 宽帽
 * 原语——2026-09-20 TUI 修复组 1 批 F2/F4 锁）。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor, stringWidth } from '../../engine/index.js';
import { buildSgr, capAnsiLine, capStyledLine, clampRuns, styledLineToAnsi, type StyledLine } from './ansi-rows.js';

describe('styledLineToAnsi 消毒兜底（控制字不落屏）', () => {
  it('runs 空：CR 剥除 / tab 展开 / ESC 残留剥除（与 sanitizeDisplayText 同源）', () => {
    expect(styledLineToAnsi({ plain: 'a\rb', runs: [] })).toBe('ab');
    expect(styledLineToAnsi({ plain: 'a\tb', runs: [] })).toBe('a  b');
    expect(styledLineToAnsi({ plain: 'x\x1b[31my', runs: [] })).toBe('xy');
  });

  it('runs 在场：段内文本发射时同律消毒（游程下标锚原 plain 不漂）', () => {
    // plain 'a\rb'：run [2,3) 覆盖 'b'——段前空隙 'a\r' 消毒剥 CR，SGR 序列正常发射
    const line: StyledLine = { plain: 'a\rb', runs: [{ start: 2, end: 3, style: { bold: true } }] };
    expect(styledLineToAnsi(line)).toBe(`a${buildSgr({ bold: true })}b\x1b[0m`);
  });
});

describe('clampRuns 游程钳制（升格单源——宽帽族共用）', () => {
  it('越界段丢弃、跨界段收尾到 limit、界内段原样', () => {
    const runs = [
      { start: 0, end: 5, style: { dim: true } },
      { start: 5, end: 8, style: { bold: true } },
      { start: 8, end: 10, style: { italic: true } },
    ];
    expect(clampRuns(runs, 6)).toEqual([
      { start: 0, end: 5, style: { dim: true } },
      { start: 5, end: 6, style: { bold: true } },
    ]);
    expect(clampRuns(runs, 100)).toEqual(runs); // 超限即原样全保留
  });
});

describe('capStyledLine 屏宽帽（plain 整字截断 + runs 同步钳制）', () => {
  it('超帽行：plain 截到屏宽、runs 收尾到截断长', () => {
    const line: StyledLine = {
      plain: 'n'.repeat(100),
      runs: [
        { start: 0, end: 2, style: { fg: ansiColor(1) } },
        { start: 2, end: 100, style: { dim: true } },
      ],
    };
    const capped = capStyledLine(line, 30);
    expect(capped.plain).toBe('n'.repeat(30));
    expect(capped.runs).toEqual([
      { start: 0, end: 2, style: { fg: 1 } },
      { start: 2, end: 30, style: { dim: true } },
    ]);
  });

  it('未超帽行：原样返回（同引用零分配）', () => {
    const line: StyledLine = { plain: 'abc', runs: [{ start: 0, end: 3, style: { dim: true } }] };
    expect(capStyledLine(line, 80)).toBe(line);
  });

  it('宽字跨界整字丢弃不产半字（截断点游程同步收 UTF-16 位）', () => {
    const line: StyledLine = { plain: 'a中b', runs: [{ start: 0, end: 4, style: { dim: true } }] };
    // cols=3：a(1)+中(2)=3 恰容，b 放不下整字丢弃——plain='a中'（UTF-16 长 2——中是 BMP 单码元）
    const capped = capStyledLine(line, 3);
    expect(capped.plain).toBe('a中');
    expect(capped.runs).toEqual([{ start: 0, end: 2, style: { dim: true } }]);
  });
});

describe('capAnsiLine ANSI 行显示宽帽（fx2-A——补吐位宽收口原语）', () => {
  it('适装行原样返回（同引用快路——含 SGR 行字节零改动）', () => {
    const line = `${buildSgr({ fg: ansiColor(2) })}✓ abc${'\x1b[0m'} 后台完成`;
    expect(capAnsiLine(line, 80)).toBe(line);
  });

  it('超帽纯文本整字截断（宽字跨界整字丢弃不产半字）', () => {
    // '· ' + 39 全宽字 = 80 列 → 帽 40：'· ' + 19 字（2+38=40），第 20 字放不下整字丢弃
    const line = `· ${'宽'.repeat(39)}`;
    const capped = capAnsiLine(line, 40);
    expect(stringWidth(capped)).toBe(40);
    expect(capped).toBe(`· ${'宽'.repeat(19)}`);
  });

  it('超帽含 SGR 行：序列零宽透传、可见宽恰帽（截点在复位后的裸段——无尾复位必要）', () => {
    // summaryToAnsi 产物形：SGR head + 复位 + 空格 + label（label 长于帽）
    const sgr = buildSgr({ fg: ansiColor(3) });
    const line = `${sgr}✓ abc\x1b[0m ${'宽'.repeat(30)}`; // head 6 + 空格 1 + 60 = 67 列
    const capped = capAnsiLine(line, 20);
    // 序列透传零宽不计账：可见宽恰 20 = head 5 + 空格 1 + 7 全宽字（14）
    expect(capped).toBe(`${sgr}✓ abc\x1b[0m ${'宽'.repeat(7)}`);
    expect(stringWidth(capped.replace(/\x1b\[[0-9;]*m/g, ''))).toBe(20);
  });

  it('截点落在着色段内：截断后补复位（行尾归零纪律——不染后续写出）', () => {
    const sgr = buildSgr({ bold: true });
    const line = `${sgr}${'a'.repeat(50)}\x1b[0m`;
    const capped = capAnsiLine(line, 10);
    expect(capped).toBe(`${sgr}${'a'.repeat(10)}\x1b[0m`);
  });

  it('截断永不撕 ESC 序列（序列整段透传、帽后可见字素丢弃 + 着色归零）', () => {
    const line = `abc\x1b[31md`;
    // 帽 3：'abc' 恰满——零宽 SGR 整段透传（不被撕半），'d' 整字丢弃；截断时
    // 终端已处着色态（31m 已发出）→ 补复位归零
    expect(capAnsiLine(line, 3)).toBe('abc\x1b[31m\x1b[0m');
    // 帽 4：全行适装（SGR 零宽不占帽）——同引用快路
    expect(capAnsiLine(line, 4)).toBe(line);
  });

  it('帽 0 防御：空串（非半序列）', () => {
    expect(capAnsiLine('abc\x1b[31m', 0)).toBe('');
  });

  it('OSC（BEL/ST 两终止形）与传统式序列零宽整段透传——字节面（第五役 S2 建议②残面）', () => {
    // OSC 8 超链对（ST 终止形）：开段 ESC ] 8;;url ESC \ + 可见 'link' + 闭段
    // ESC ] 8;; ESC \——consumeAnsiSequence OSC 分支（BEL/ST 两终止形）与传统式
    // 分支此前零覆盖；本测字节级锁死镜像与 engine consumeEscapeSequence 同语义
    //（OSC 载荷 0x5d ∈ 0x30–0x7e 若误落传统式 final 分支只吞 ESC ] 两字节，
    // 载荷计入可见宽 → (a)(b)(e) 三面必红——回归判别面在位）
    const osc = '\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\';
    // (a) 适装同引用快路：可见宽恰 a(1)+link(4)+b(1)=6=帽——OSC 两段字节零改动
    expect(capAnsiLine(`a${osc}b`, 6)).toBe(`a${osc}b`);
    // (b) 超帽截断：OSC 两段整段透传零占帽（link 占 4），其后全宽字整字截到帽
    //     ——帽 8 = link 4 + 宽×2（4），第 3 个宽字放不下整字丢弃不撕序列
    expect(capAnsiLine(`${osc}${'宽'.repeat(10)}`, 8)).toBe(`${osc}${'宽'.repeat(2)}`);
    // (c) BEL 终止形 OSC（标题设置形）：适装零占帽原样透传（BEL 收进序列内）
    expect(capAnsiLine('ab\x1b]0;t\x07c', 4)).toBe('ab\x1b]0;t\x07c');
    // (d) 传统式（ESC ( B 字符集选择）：中间码 0x28 + final 0x42 整段零占帽——
    //     适装（ab 2 + ' cd' 3 = 5 = 帽）原样透传
    expect(capAnsiLine('ab\x1b(B cd', 5)).toBe('ab\x1b(B cd');
    // (e) OSC 不参与 SGR 状态跟踪：着色段内 OSC 透传后截断仍补复位（isSgrReset
    //     / isSgrSequence 均不认 OSC 形——styled 态跨 OSC 存续，行尾归零纪律不漏）
    expect(capAnsiLine(`\x1b[31maa\x1b]0;t\x07${'a'.repeat(10)}`, 3)).toBe(`\x1b[31maa\x1b]0;t\x07a\x1b[0m`);
  });
});
