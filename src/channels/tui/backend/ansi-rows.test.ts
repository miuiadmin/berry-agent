/**
 * ansi-rows 件测试（styledLineToAnsi 消毒兜底 + clampRuns/capStyledLine 宽帽
 * 原语——2026-09-20 TUI 修复组 1 批 F2/F4 锁）。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor, color256, colorRgbOf, EMPTY_STYLE, stringWidth } from '../../engine/index.js';
import {
  buildSgr,
  capAnsiLine,
  capStyledLine,
  clampRuns,
  OSC8_CLOSE,
  osc8Open,
  parseAnsiRuns,
  styledLineToAnsi,
  type StyledLine,
} from './ansi-rows.js';

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

describe('styledLineToAnsi fillBg 全宽带尾腿（R-2——EL·BCE 行尾铺满）', () => {
  const bg = ansiColor(4);

  it('fillBg 在场：行尾 bg 着色态发 EL（BCE 擦除铺满至屏宽）+ 归零', () => {
    // 前段非 bg → 归零后再设 bg 发 EL；末尾统一归零不染后续写出
    const line: StyledLine = { plain: 'ab', runs: [{ start: 0, end: 1, style: { bold: true } }], fillBg: bg };
    expect(styledLineToAnsi(line)).toBe(`${buildSgr({ bold: true })}a\x1b[0mb${buildSgr({ bg })}\x1b[K\x1b[0m`);
  });

  it('尾段已持同 bg：直接 EL 零冗余再设（user 块正文行常态形）', () => {
    const line: StyledLine = { plain: 'ab', runs: [{ start: 0, end: 2, style: { bg } }], fillBg: bg };
    expect(styledLineToAnsi(line)).toBe(`${buildSgr({ bg })}ab\x1b[K\x1b[0m`);
  });

  it('runs 空 + fillBg：纯带形（bg SGR + EL + 归零——三明治空行染底不走 runs 空早退）', () => {
    expect(styledLineToAnsi({ plain: '', runs: [], fillBg: bg })).toBe(`${buildSgr({ bg })}\x1b[K\x1b[0m`);
    // 裸文本 + 尾带：文本归零写出后 bg EL
    expect(styledLineToAnsi({ plain: 'ab', runs: [], fillBg: bg })).toBe(`ab${buildSgr({ bg })}\x1b[K\x1b[0m`);
  });

  it('fillBg 缺席：行为零变（回归锁——不带尾腿的行字节面不动）', () => {
    expect(styledLineToAnsi({ plain: 'ab', runs: [{ start: 0, end: 2, style: { bg } }] })).toBe(
      `${buildSgr({ bg })}ab\x1b[0m`,
    );
    expect(styledLineToAnsi({ plain: '', runs: [] })).toBe('');
  });

  it('capStyledLine 超帽截断透传 fillBg（未超帽同引用快路天然保留）', () => {
    const line: StyledLine = { plain: 'n'.repeat(100), runs: [], fillBg: bg };
    expect(capStyledLine(line, 30).fillBg).toBe(bg);
    expect(capStyledLine({ plain: 'ab', runs: [], fillBg: bg }, 80).fillBg).toBe(bg);
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
    // 界面美化役批⑧：超帽截断统一以省略号收尾——帽内省 1 位让给 '…'（宽 1）
    expect(capped.plain).toBe('n'.repeat(29) + '…');
    expect(capped.runs).toEqual([
      { start: 0, end: 2, style: { fg: 1 } },
      { start: 2, end: 30, style: { dim: true } }, // 尾游程随截断收尾再吞省略号——样式尾巴保留
    ]);
  });

  it('未超帽行：原样返回（同引用零分配）', () => {
    const line: StyledLine = { plain: 'abc', runs: [{ start: 0, end: 3, style: { dim: true } }] };
    expect(capStyledLine(line, 80)).toBe(line);
  });

  it('宽字跨界整字丢弃不产半字（截断点游程同步收 UTF-16 位）', () => {
    const line: StyledLine = { plain: 'a中b', runs: [{ start: 0, end: 4, style: { dim: true } }] };
    // cols=3：省 1 位后预算 2 列——a(1) 占后余 1 列放不下 中(2) 整字丢弃，
    // 截断发生 → 省略号收尾：plain='a…'（UTF-16 长 2——… 是 BMP 单码元）
    const capped = capStyledLine(line, 3);
    expect(capped.plain).toBe('a…');
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

describe('OSC-8 超链发射（挖掘 36 轮〔5〕——styledLineToAnsi 链态机 + osc8Open 单源）', () => {
  it('osc8Open：ST 终界形；控制字剥除；非 web scheme 返空串【修前红：函数不在位】', () => {
    expect(osc8Open('https://a.com')).toBe('\x1b]8;;https://a.com\x1b\\'); // ST 终界（\\x1b\\\\）非 BEL——主屏 writeLine 剥 BEL 保 ESC 的物理定谳
    expect(osc8Open('http://a.com')).toBe('\x1b]8;;http://a.com\x1b\\');
    expect(osc8Open('https://a.com/\x07x')).toBe('\x1b]8;;https://a.com/x\x1b\\'); // 控制字消毒
    expect(osc8Open('mailto:a@b.c')).toBe(''); // 非 web scheme 双拒
    expect(OSC8_CLOSE).toBe('\x1b]8;;\x1b\\'); // 空目标闭形
  });

  it('run 携 href：SGR 后开链前导 + 文本 + 闭链 + 归零；非链 run 零 OSC-8【修前红】', () => {
    const line: StyledLine = {
      plain: 'ab',
      runs: [{ start: 0, end: 2, style: { bold: true }, href: 'https://a.com' }],
    };
    expect(styledLineToAnsi(line)).toBe(`${buildSgr({ bold: true })}\x1b]8;;https://a.com\x1b\\ab${OSC8_CLOSE}\x1b[0m`);
    // 非链行零 OSC-8（回归锁——素行字节面零变）
    expect(styledLineToAnsi({ plain: 'ab', runs: [{ start: 0, end: 2, style: { bold: true } }] })).not.toMatch(
      /\x1b\]8;/,
    );
  });

  it('href-only 段（裸 URL 元数据——EMPTY_STYLE）：零 SGR 字节纯 OSC-8 包裹【修前红】', () => {
    // 裸 URL 仅元数据零观感变：无样式段也产段（href 在场即产段——缺省会丢链）
    const line: StyledLine = {
      plain: 'https://a.com',
      runs: [{ start: 0, end: 14, style: EMPTY_STYLE, href: 'https://a.com' }],
    };
    expect(styledLineToAnsi(line)).toBe('\x1b]8;;https://a.com\x1b\\https://a.com\x1b]8;;\x1b\\');
  });

  it('段间隙裸文本：先闭链再归零写裸段、再开新链（链不吞裸段）', () => {
    const line: StyledLine = {
      plain: 'ab cd',
      runs: [
        { start: 0, end: 2, style: { bold: true }, href: 'https://a.com' },
        { start: 3, end: 5, style: { bold: true }, href: 'https://b.com' },
      ],
    };
    expect(styledLineToAnsi(line)).toBe(
      `${buildSgr({ bold: true })}\x1b]8;;https://a.com\x1b\\ab${OSC8_CLOSE}\x1b[0m ` +
        `${buildSgr({ bold: true })}\x1b]8;;https://b.com\x1b\\cd${OSC8_CLOSE}\x1b[0m`,
    );
  });

  it('相邻两链同色无空隙：SGR 不复位、OSC-8 close→open 切换（异 href 不并段的发射面镜像）', () => {
    const line: StyledLine = {
      plain: 'abcd',
      runs: [
        { start: 0, end: 2, style: { underline: true }, href: 'https://a.com' },
        { start: 2, end: 4, style: { underline: true }, href: 'https://b.com' },
      ],
    };
    expect(styledLineToAnsi(line)).toBe(
      `${buildSgr({ underline: true })}\x1b]8;;https://a.com\x1b\\ab${OSC8_CLOSE}` +
        `\x1b]8;;https://b.com\x1b\\cd${OSC8_CLOSE}\x1b[0m`,
    );
  });

  it('行尾闭合序：OSC-8 close 先于终局 SGR_RESET（链不染后续写出）', () => {
    const line: StyledLine = {
      plain: 'ab',
      runs: [{ start: 0, end: 2, style: { bold: true }, href: 'https://a.com' }],
    };
    expect(styledLineToAnsi(line).endsWith(`${OSC8_CLOSE}\x1b[0m`)).toBe(true);
  });

  it('fillBg 尾腿在链闭合后发（尾腿在链外——EL 不吞进链）', () => {
    const bg = ansiColor(4);
    const line: StyledLine = {
      plain: 'ab',
      runs: [{ start: 0, end: 2, style: { underline: true }, href: 'https://a.com' }],
      fillBg: bg,
    };
    expect(styledLineToAnsi(line)).toBe(
      // R-2 既有序：前段非 bg → 归零后再设 bg 发 EL（闭链与归零两步分立不并序）
      `${buildSgr({ underline: true })}\x1b]8;;https://a.com\x1b\\ab${OSC8_CLOSE}\x1b[0m${buildSgr({ bg })}\x1b[K\x1b[0m`,
    );
  });

  it('href 非法形发射位双拒：控制字载荷/非 http scheme 当无链发射（裸文本照写——回归锁）', () => {
    const mailto: StyledLine = { plain: 'ab', runs: [{ start: 0, end: 2, style: {}, href: 'mailto:a@b.c' }] };
    expect(styledLineToAnsi(mailto)).toBe('ab'); // 零 SGR 零 OSC-8——纯裸文本
  });

  it('clampRuns / capStyledLine spread 造形自动保 href（截断链段保留——词条明记可接受降级）', () => {
    const url = 'https://a.com/' + 'x'.repeat(40);
    expect(clampRuns([{ start: 0, end: 50, style: { dim: true }, href: url }], 5)).toEqual([
      { start: 0, end: 5, style: { dim: true }, href: url },
    ]);
    const capped = capStyledLine({ plain: url, runs: [{ start: 0, end: url.length, style: {}, href: url }] }, 10);
    expect(capped.plain).toBe('https://a' + '…'); // 帽 10：截 9 + 省略号
    expect(capped.runs[0]!.href).toBe(url); // 截断链段保 href（开部分 URL）
  });
});

describe('buildSgr strikethrough（挖掘 35 轮 B8——SGR 9 首消费 todo-snapshot completed 条目）', () => {
  it('dim+划线并置：参数序 dim(2) 后划线(9)——单序列复合', () => {
    expect(buildSgr({ dim: true, strikethrough: true })).toBe('\x1b[2;9m');
  });

  it('划线并入复合序：bold(1) 与划线(9) 同序列、色参数续后', () => {
    const sgr = buildSgr({ bold: true, strikethrough: true, fg: ansiColor(3) });
    expect(sgr).toBe(`\x1b[1;9;${3 + 30}m`);
  });

  it('行级端到端：styledLineToAnsi 发射划线段并尾归零', () => {
    const line: StyledLine = { plain: 'ab', runs: [{ start: 0, end: 2, style: { dim: true, strikethrough: true } }] };
    expect(styledLineToAnsi(line)).toBe('\x1b[2;9mab\x1b[0m');
  });
});

describe('parseAnsiRuns SGR 游程解析（挖掘 49 轮件 B——工具输出色彩保真铸卡单源）', () => {
  it('16 档前景三形：基础 30-37 / 亮色 90-97 / 复位 0——游程锚 UTF-16 对齐 plain', () => {
    // 基础族：SGR 31 → ansiColor(1)（码位换算律 p-30）
    const red = parseAnsiRuns('ok \x1b[31mFAIL\x1b[0m tail');
    expect(red.plain).toBe('ok FAIL tail');
    expect(red.runs).toEqual([{ start: 3, end: 7, style: { fg: ansiColor(1) } }]);
    // 亮色族：SGR 91 → ansiColor(9)（码位换算律 p-82）
    const bright = parseAnsiRuns('\x1b[91mHOT\x1b[0m');
    expect(bright.runs).toEqual([{ start: 0, end: 3, style: { fg: ansiColor(9) } }]);
    // 复位后裸段：runs 只覆盖着色区间（锚精确——不含复位后文本）
    const r2 = parseAnsiRuns('\x1b[32mA\x1b[0mB');
    expect(r2.plain).toBe('AB');
    expect(r2.runs).toEqual([{ start: 0, end: 1, style: { fg: ansiColor(2) } }]);
  });

  it('扩展色域两形：38;5;n → color256 与 38;2;r;g;b → colorRgbOf 真值构造', () => {
    const c256 = parseAnsiRuns('\x1b[38;5;196mX\x1b[0m');
    expect(c256.runs).toEqual([{ start: 0, end: 1, style: { fg: color256(196) } }]);
    const rgb = parseAnsiRuns('\x1b[38;2;255;0;64mY\x1b[0m');
    expect(rgb.runs).toEqual([{ start: 0, end: 1, style: { fg: colorRgbOf(255, 0, 64) } }]);
    // 背景族同律：48;5;n（bg 位）
    const bg = parseAnsiRuns('\x1b[48;5;17mZ\x1b[0m');
    expect(bg.runs).toEqual([{ start: 0, end: 1, style: { bg: color256(17) } }]);
  });

  it('扩展色域域判：越界 256 索引不炸零色游程（malformed 诚实降级）', () => {
    // 38;5;999 越界（>255）——序列仍是合法 SGR 形（m 是 final 整段消费），
    // fail-loud 构造前置域判：不产生色游程、后续参数 5/999 逐位消费零炸
    const out = parseAnsiRuns('\x1b[38;5;999mN\x1b[0m');
    expect(out.plain).toBe('N');
    expect(out.runs).toEqual([]);
  });

  it('样式位全族：bold 到 strikethrough 六位 + 22/24 分位归位 + 39/49 前背景归缺省', () => {
    // 复合位单序列：1;4 → bold+underline 并存
    const both = parseAnsiRuns('\x1b[1;4mX\x1b[0m');
    expect(both.runs).toEqual([{ start: 0, end: 1, style: { bold: true, underline: true } }]);
    // dim 并置 + 22 双归位（bold+dim 一并归缺省）
    const dimThenReset = parseAnsiRuns('\x1b[1;2mA\x1b[22mB\x1b[0m');
    expect(dimThenReset.plain).toBe('AB');
    expect(dimThenReset.runs).toEqual([{ start: 0, end: 1, style: { bold: true, dim: true } }]);
    // 39 前景归缺省（bg 维持）+ 49 背景归缺省
    const fgReset = parseAnsiRuns('\x1b[31;44mA\x1b[39mB\x1b[0m');
    expect(fgReset.runs).toEqual([
      { start: 0, end: 1, style: { fg: ansiColor(1), bg: ansiColor(4) } },
      { start: 1, end: 2, style: { bg: ansiColor(4) } },
    ]);
    // italic 3 + strikethrough 9 与分位归位 23/29
    const deco = parseAnsiRuns('\x1b[3;9mA\x1b[23;29mB\x1b[0m');
    expect(deco.runs).toEqual([{ start: 0, end: 1, style: { italic: true, strikethrough: true } }]);
  });

  it('空参数缺省 0：裸 ESC[m 即复位形', () => {
    const bare = parseAnsiRuns('\x1b[31mA\x1b[mB');
    expect(bare.plain).toBe('AB');
    expect(bare.runs).toEqual([{ start: 0, end: 1, style: { fg: ansiColor(1) } }]);
  });

  it('非 SGR CSI 剥除：光标定位与清屏序列不扰色（SGR 之外的 escape 全剥）', () => {
    // ESC[2J 清屏 + ESC[1;1H 定位 + SGR 31 交织——非 SGR 序列剥、SGR 生效
    const mixed = parseAnsiRuns('\x1b[2J\x1b[1;1H\x1b[31mRED\x1b[0m\x1b[3;4H!');
    expect(mixed.plain).toBe('RED!');
    expect(mixed.runs).toEqual([{ start: 0, end: 3, style: { fg: ansiColor(1) } }]);
  });

  it('截尾 malformed 序列吞到串尾 + OSC 序列剥除（consumeEscapeSequence 同语义）', () => {
    // SGR 无 final（'\x1b[31' 截尾）——吞到串尾不外泄半个序列
    expect(parseAnsiRuns('A\x1b[31').plain).toBe('A');
    // OSC 形（ESC]...BEL）剥除
    expect(parseAnsiRuns('\x1b]0;title\x07X').plain).toBe('X');
  });

  it('无 ESC 速径：sanitizeDisplayText 同律消毒 + 空 runs', () => {
    // tab 展开 2 空格（与 sanitizeDisplayText 缺省全域档同语义——锚恒对齐）
    expect(parseAnsiRuns('a\tb')).toEqual({ plain: 'a  b', runs: [] });
    // CR 剥除 / DEL 剥除 / LF 保留（行内无 LF——split 先行）
    expect(parseAnsiRuns('a\r\x7fb')).toEqual({ plain: 'ab', runs: [] });
    expect(parseAnsiRuns('纯文本')).toEqual({ plain: '纯文本', runs: [] });
  });

  it('同式相邻并段：端点连续同式游程合并（发射位零冗余 SGR）', () => {
    // 两段同红相邻（31 复位 0 再 31——中间零字符）→ 并段单游程
    const merged = parseAnsiRuns('\x1b[31mA\x1b[0m\x1b[31mB\x1b[0m');
    expect(merged.plain).toBe('AB');
    expect(merged.runs).toEqual([{ start: 0, end: 2, style: { fg: ansiColor(1) } }]);
  });
});
