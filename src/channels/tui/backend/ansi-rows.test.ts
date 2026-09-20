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
});
