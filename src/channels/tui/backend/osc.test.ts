/**
 * OscDisplay 直测（07 §4.1 呈现面件 7——终端外显 OSC 标题 + 进度态）。
 *
 * 桩法：MemoryTerminalIO 字节捕获（帧级断言）+ 假钟手动推进（保活周期重发
 * 的确定性驱动——tui-backend.test.ts ManualClock 同形）。覆盖：title 值缓存
 * 去重 / 忙态首写 + 1s 保活周期重发 / 清零停针 / restore 退出复原两写点 /
 * schedule 注入可控（保活缺位缺省）。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO } from '../../engine/index.js';
import type { TerminalIO } from '../../engine/index.js';
import {
  buildOsc9Notify,
  buildOsc52Copy,
  buildOsc52CopyDcs,
  detectNotifyCarrier,
  OscDisplay,
  OSC_ATTENTION_BLINK_MS,
  OSC_PROGRESS_KEEPALIVE_MS,
  sanitizeNotifyText,
} from './osc.js';

/** OSC 9;4 忙态序列（锚定 pi-tui 字节形） */
const ACTIVE = '\x1b]9;4;3\x07';
/** OSC 9;4 清零序列 */
const CLEAR = '\x1b]9;4;0\x07';
/** OSC 0 title 序列包装 */
const title = (t: string): string => `\x1b]0;${t}\x07`;

/** 假钟（保活重发的确定性驱动——到期定时器按序执行、执行中新排可续窗） */
class ManualClock {
  public t = 0;
  private seq = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  public readonly now = (): number => this.t;
  public readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  };
  public readonly cancel = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  /** 推进时间：到期定时器按序执行（执行中新排的也可在本窗内到期） */
  public advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      this.timers = this.timers.filter((timer) => timer !== due);
      due.fn();
    }
    this.t = target;
  }
}

/** osc rig：内存 IO + 假钟 + 取消记录（注入三件套） */
function makeOsc(baseline = 'berry-agent') {
  const io = new MemoryTerminalIO(80, 24);
  const clock = new ManualClock();
  const cancelled: unknown[] = [];
  const osc = new OscDisplay(io, {
    baseline,
    schedule: clock.schedule,
    cancel: (handle) => {
      cancelled.push(handle);
      clock.cancel(handle);
    },
  });
  return { io, osc, clock, cancelled };
}

describe('OscDisplay title（OSC 0——值缓存去重）', () => {
  it('首写字节形（ESC ]0; 文本 BEL）+ 同值二调一字节', () => {
    const { io, osc } = makeOsc();
    osc.setTitle('berry-agent');
    osc.setTitle('berry-agent'); // 同值——去重不重写
    expect(io.frames).toEqual([title('berry-agent')]);
    osc.setTitle('berry-agent 1.2.3'); // 新值——写出
    expect(io.frames).toEqual([title('berry-agent'), title('berry-agent 1.2.3')]);
  });
});

describe('OscDisplay 进度态（OSC 9;4——保活周期重发）', () => {
  it('忙态首写 + 1s 保活周期重发（假钟推进断言重发次数）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setProgress(true);
    expect(io.frames).toEqual([ACTIVE]); // 首写即忙态序列
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS); // 一窗——重发一次
    expect(io.frames).toEqual([ACTIVE, ACTIVE]);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS * 2); // 两窗——重发两次（自重排续针）
    expect(io.frames).toEqual([ACTIVE, ACTIVE, ACTIVE, ACTIVE]);
  });

  it('忙态重复调用重写序列但不叠针（单链重发——每窗恰一次）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setProgress(true);
    osc.setProgress(true); // 已在飞——序列重写（去重不适用）、保活不重复起针
    expect(io.frames).toEqual([ACTIVE, ACTIVE]);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS);
    expect(io.frames).toEqual([ACTIVE, ACTIVE, ACTIVE]); // 一窗恰一次重发
  });

  it('清零停针：写清零序列 + 保活 timer 摘除（推进零写出）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setProgress(true);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS); // 一窗重发
    osc.setProgress(false);
    expect(io.frames.slice(-1)).toEqual([CLEAR]); // 清零序列落帧
    expect(osc.activeKeepalive).toBeNull(); // 停针——句柄位归 null
    const frames = io.frames.length;
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS * 5); // 停针后推进——零写出
    expect(io.frames.length).toBe(frames);
  });

  it('schedule 缺席 = 保活缺位（忙态首写仍在——同步测试语义）', () => {
    const io = new MemoryTerminalIO(80, 24);
    const osc = new OscDisplay(io, { baseline: 'berry-agent' });
    osc.setProgress(true);
    expect(io.frames).toEqual([ACTIVE]);
    expect(osc.activeKeepalive).toBeNull(); // 无注入——不起针
    osc.setProgress(false); // 停针 no-op + 清零写出
    expect(io.frames).toEqual([ACTIVE, CLEAR]);
  });
});

describe('OscDisplay restore（退出复原两写点）', () => {
  it('title 复原基线 + 进度清零（含保活停针）', () => {
    const { io, osc, clock } = makeOsc('berry-agent 1.2.3');
    osc.setTitle('berry-agent 1.2.3 · abcdefgh'); // repaint 点缀形态
    osc.setProgress(true);
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS); // 保活窗一开
    osc.restore();
    expect(io.frames).toContain(title('berry-agent 1.2.3')); // 写点一：title 复原基线
    expect(io.frames.slice(-1)).toEqual([CLEAR]); // 写点二：进度清零
    expect(osc.activeKeepalive).toBeNull(); // 保活停针
    const frames = io.frames.length;
    clock.advance(OSC_PROGRESS_KEEPALIVE_MS * 5); // 复原后零写出
    expect(io.frames.length).toBe(frames);
  });

  it('title 已在基线——复原写走去重（仅清零一字节）', () => {
    const { io, osc } = makeOsc('berry-agent');
    osc.setTitle('berry-agent'); // 与基线同值（缓存已记）
    osc.restore();
    expect(io.frames).toEqual([title('berry-agent'), CLEAR]); // title 写被去重律吸收
  });
});

describe('OscDisplay schedule 注入可控', () => {
  it('保活经注入 schedule 起针（1000ms）+ 停针走注入 cancel（句柄对得上）', () => {
    const { io, osc, cancelled } = makeOsc();
    osc.setProgress(true);
    expect(io.frames).toEqual([ACTIVE]);
    expect(osc.activeKeepalive).not.toBeNull(); // 注入起针
    const handle = osc.activeKeepalive;
    osc.setProgress(false);
    expect(cancelled).toEqual([handle]); // 停针经注入 cancel——同句柄摘除
    expect(osc.activeKeepalive).toBeNull();
  });

  it('restore 停针同走注入 cancel（名册语义——重复停针 no-op）', () => {
    const { osc, cancelled } = makeOsc();
    osc.setProgress(true);
    osc.restore();
    expect(cancelled).toHaveLength(1); // 保活句柄摘除一次
    osc.stopKeepalive(); // 句柄位已 null——再停 no-op
    expect(cancelled).toHaveLength(1);
  });
});

/* ---------------- OSC 52 选区复制序列（mu-2——07 件 8 细则） ---------------- */

describe('buildOsc52Copy（选区复制序列构造——尽力写出无反馈）', () => {
  it('OSC 52;c;base64 + BEL 终界（ASCII 明文）', () => {
    expect(buildOsc52Copy('hi')).toBe(`\x1b]52;c;${Buffer.from('hi').toString('base64')}\x07`);
  });

  it('UTF-8 明文按字节 base64（中文 + 换行——选区行间拼 LF 的真实载荷形）', () => {
    const text = '中文\n第二行';
    expect(buildOsc52Copy(text)).toBe(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
  });
});

describe('buildOsc52CopyDcs（tmux DCS 透传形——挖掘 38 轮件 A 分诊第三层）', () => {
  it('Ptmux 前缀 + 裸 OSC 52 载荷 + ST 收尾（内层 ESC 双写防提前终结）', () => {
    const b64 = Buffer.from('hi', 'utf8').toString('base64');
    // 全字面锁：\x1bPtmux; + ESC 双写 + ]52;c;<b64> + BEL + ESC \
    expect(buildOsc52CopyDcs('hi')).toBe(`\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`);
  });

  it('包裹结构与 buildOsc9Notify DCS 判例同构（前缀/双写/收尾三段同形）', () => {
    // 同构断言：两者均为 \x1bPtmux; + 双写载荷 + \x1b\\——仅内层载荷体不同
    const osc9 = buildOsc9Notify('x', { tmux: true });
    const osc52 = buildOsc52CopyDcs('x');
    expect(osc52.startsWith('\x1bPtmux;')).toBe(osc9.startsWith('\x1bPtmux;'));
    expect(osc52.endsWith('\x1b\\')).toBe(osc9.endsWith('\x1b\\'));
    // 载荷体内层每个 ESC 必双写（DCS 语义——无单生 ESC）
    const body = osc52.slice('\x1bPtmux;'.length, -'\x1b\\'.length);
    expect(body).not.toMatch(/(?<!\x1b)\x1b(?!\x1b)/);
  });

  it('UTF-8 中文载荷同形（base64 后包裹——内层无 ESC 特例位）', () => {
    const b64 = Buffer.from('中文复制', 'utf8').toString('base64');
    expect(buildOsc52CopyDcs('中文复制')).toBe(`\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`);
  });
});

/* ---------------- 桌面通知（挖掘 36 轮 notify-osc9——07 件 7 第三写点） ---------------- */

describe('detectNotifyCarrier（载波探测纯函数）', () => {
  it('TERM_PROGRAM 五家 → osc9', () => {
    for (const tp of ['ghostty', 'iTerm.app', 'kitty', 'wezterm', 'WarpTerminal']) {
      expect(detectNotifyCarrier({ TERM_PROGRAM: tp })).toBe('osc9');
    }
  });

  it('TMUX 在场优先 → bel 诚实降级（外层不可探测——五家猜测不作数）', () => {
    expect(detectNotifyCarrier({ TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-501/default,123,0' })).toBe('bel');
  });

  it('缺席/不支持终端 → bel', () => {
    expect(detectNotifyCarrier({})).toBe('bel');
    expect(detectNotifyCarrier({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('bel');
    expect(detectNotifyCarrier({ TERM_PROGRAM: 'vscode' })).toBe('bel');
  });
});

describe('buildOsc9Notify（OSC 9 通知字节——codex PostNotification 对拍锁）', () => {
  it('裸形：OSC 9;<消息> BEL', () => {
    expect(buildOsc9Notify('done', { tmux: false })).toBe('\x1b]9;done\x07');
  });

  it('tmux DCS 包裹：前缀 + 载荷 ESC 双写 + ST 尾（codex 测试锁字面同参）', () => {
    expect(buildOsc9Notify('done', { tmux: true })).toBe('\x1bPtmux;\x1b\x1b]9;done\x07\x1b\\');
  });

  it('载荷内 ESC 双写（载荷含转义序列不提前终结 DCS）', () => {
    expect(buildOsc9Notify('danger\x1b[31m', { tmux: true })).toBe('\x1bPtmux;\x1b\x1b]9;danger\x1b\x1b[31m\x07\x1b\\');
  });
});

describe('sanitizeNotifyText（通知文案消毒纯函数）', () => {
  it('首行先行：多行只取第一行（后续行整段丢弃非并入）', () => {
    expect(sanitizeNotifyText('第一行\n第二行', 80)).toBe('第一行');
  });

  it('C0/DEL 全剥 + 空白折叠（ESC/制表/连续空格归一——剥成空格后折叠）', () => {
    expect(sanitizeNotifyText('a\x1b[31m\tb   c\x7f', 80)).toBe('a [31m b c');
  });

  it('码点帽：超帽截 max-1 尾加「…」总长恰 max（多字节不劈半）', () => {
    expect(sanitizeNotifyText('一二三四五', 3)).toBe('一二…');
    expect(sanitizeNotifyText('abcdef', 3)).toBe('ab…');
  });

  it('帽内零扰动 + 全空白入 → 空串（诚实缺席形）', () => {
    expect(sanitizeNotifyText('短文案', 80)).toBe('短文案');
    expect(sanitizeNotifyText('  \n  ', 80)).toBe('');
  });
});

describe('OscDisplay.notify（第三写点——定值缺席/载波分档/写失败闩死）', () => {
  it('定值缺席 = 通道关闭恒零写（缺席注入律）', () => {
    const io = new MemoryTerminalIO(80, 24);
    const osc = new OscDisplay(io, { baseline: 'x' });
    osc.notify('本轮完成');
    expect(io.frames).toEqual([]); // 零通知字节
  });

  it('osc9 载波 → OSC 9 序列；bel 载波 → BEL 单字节', () => {
    const io9 = new MemoryTerminalIO(80, 24);
    new OscDisplay(io9, { baseline: 'x', notify: { carrier: 'osc9', tmux: false } }).notify('本轮完成');
    expect(io9.frames).toEqual(['\x1b]9;本轮完成\x07']);
    const ioBel = new MemoryTerminalIO(80, 24);
    new OscDisplay(ioBel, { baseline: 'x', notify: { carrier: 'bel', tmux: false } }).notify('本轮完成');
    expect(ioBel.frames).toEqual(['\x07']);
  });

  it('tmux 定值 → DCS 包裹形', () => {
    const io = new MemoryTerminalIO(80, 24);
    new OscDisplay(io, { baseline: 'x', notify: { carrier: 'osc9', tmux: true } }).notify('done');
    expect(io.frames).toEqual(['\x1bPtmux;\x1b\x1b]9;done\x07\x1b\\']);
  });

  it('io.write 抛错即闩死——后续 notify 零写零上抛（teardown EPIPE 不炸）', () => {
    // 会抛错的 IO 桩（TerminalIO 是引擎契约注入面——写失败注入测试位）
    const written: string[] = [];
    let failing = true;
    const io = {
      write(data: string): void {
        if (failing) throw new Error('EPIPE');
        written.push(data);
      },
      size: () => ({ columns: 80, rows: 24 }),
      setRawMode: () => {},
      isRaw: () => false,
      pause: () => {},
      resume: () => {},
      onInput: () => () => {},
      onResize: () => () => {},
    } satisfies TerminalIO;
    const osc = new OscDisplay(io, { baseline: 'x', notify: { carrier: 'bel', tmux: false } });
    expect(() => osc.notify('一')).not.toThrow(); // 失败吞不上抛（通知是尽力面）
    failing = false; // 写通道恢复
    osc.notify('二'); // 已闩死——恢复后仍零写
    expect(written).toEqual([]);
  });
});

/* ---------------- setAttention 待处置外显（件 C——挖掘 46 轮） ---------------- */

describe('OscDisplay.setAttention 待处置外显（件 C——挖掘 46 轮）', () => {
  it('开注意态首帧显形 + 1s 交替拍隐形帧（常态 title 缀尾——两拍同宽不抖）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setTitle('berry-agent 1.2.3 · ab12cd'); // 常态 title 播种（起屏/切焦路同形）
    osc.setAttention(true);
    expect(io.frames.slice(-1)).toEqual([title('[ ! ] 待处置 berry-agent 1.2.3 · ab12cd')]); // 首帧显形（同步写出）
    clock.advance(OSC_ATTENTION_BLINK_MS);
    expect(io.frames.slice(-1)).toEqual([title('[ . ] 待处置 berry-agent 1.2.3 · ab12cd')]); // 隐形拍
    clock.advance(OSC_ATTENTION_BLINK_MS);
    expect(io.frames.slice(-1)).toEqual([title('[ ! ] 待处置 berry-agent 1.2.3 · ab12cd')]); // 再翻显形（自重排续拍）
  });

  it('同态重复调用零字节（幂等）+ 拍单链不叠针（一窗恰一帧）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setTitle('base');
    osc.setAttention(true);
    const n = io.frames.length;
    osc.setAttention(true); // 同态——零字节零重排
    expect(io.frames.length).toBe(n);
    clock.advance(OSC_ATTENTION_BLINK_MS);
    expect(io.frames.length).toBe(n + 1); // 单链——一窗恰一帧（叠针会出 2 帧）
  });

  it('收注意态：停拍 + 常态 title 强制重写归位 + 推进零写出', () => {
    const { io, osc, clock } = makeOsc();
    osc.setTitle('base');
    osc.setAttention(true);
    clock.advance(OSC_ATTENTION_BLINK_MS); // 隐形帧在屏（lastTitle = 帧值）
    osc.setAttention(false);
    expect(io.frames.slice(-1)).toEqual([title('base')]); // 归位重写（lastTitle 清空绕过去重——漏重写则 title 滞留隐形帧）
    const n = io.frames.length;
    clock.advance(OSC_ATTENTION_BLINK_MS * 5);
    expect(io.frames.length).toBe(n); // 停拍——推进零写出
  });

  it('常态 title 缺席形：帧无缀尾 + 收态跳过归位写（backend 装配不可达——防御位锁形）', () => {
    const io = new MemoryTerminalIO(80, 24);
    const osc = new OscDisplay(io, { baseline: 'x' }); // 从未 setTitle——常态值缺席
    osc.setAttention(true);
    expect(io.frames).toEqual([title('[ ! ] 待处置')]); // 无缀尾
    osc.setAttention(false);
    expect(io.frames).toEqual([title('[ ! ] 待处置')]); // 无常态可归位——零新字节
  });

  it('注意态中途 setTitle：常态值账随记不污染（下拍帧缀新值 + 收态归位最新常态值）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setTitle('old');
    osc.setAttention(true);
    clock.advance(OSC_ATTENTION_BLINK_MS); // 隐形帧
    osc.setTitle('new'); // 注意态中途常态 title 更新（切焦点缀路）——直写 + 记账
    expect(io.frames.slice(-1)).toEqual([title('new')]);
    clock.advance(OSC_ATTENTION_BLINK_MS); // 下一拍——帧缀新常态值（帧值不记账：缀 new 非 old）
    expect(io.frames.slice(-1)).toEqual([title('[ ! ] 待处置 new')]);
    osc.setAttention(false);
    expect(io.frames.slice(-1)).toEqual([title('new')]); // 归位 = 最新常态值（帧值未污染账）
  });

  it('restore 清注意态：双针全停 + title 复原基线 + 进度清零', () => {
    const { io, osc, clock } = makeOsc('berry-agent 1.2.3');
    osc.setTitle('berry-agent 1.2.3 · ab12cd');
    osc.setProgress(true); // 保活针并陈
    osc.setAttention(true); // 注意拍并陈
    clock.advance(OSC_ATTENTION_BLINK_MS); // 两针各一写
    osc.restore();
    expect(io.frames.slice(-2)).toEqual([title('berry-agent 1.2.3'), CLEAR]);
    const n = io.frames.length;
    clock.advance(OSC_ATTENTION_BLINK_MS * 5);
    expect(io.frames.length).toBe(n); // 双针全停——推进零写出
  });

  it('schedule 缺席 = 注意帧静态常驻（首帧显形写出、无拍——同步测试语义）', () => {
    const io = new MemoryTerminalIO(80, 24);
    const osc = new OscDisplay(io, { baseline: 'x' });
    osc.setTitle('base');
    osc.setAttention(true);
    expect(io.frames).toEqual([title('base'), title('[ ! ] 待处置 base')]); // 静态显形帧
    osc.setAttention(false);
    expect(io.frames.slice(-1)).toEqual([title('base')]); // 收态归位仍有效
  });

  it('双针并陈互不牵连：保活停针注意拍续摆、注意收态归位（两针分立）', () => {
    const { io, osc, clock } = makeOsc();
    osc.setTitle('base');
    osc.setProgress(true); // 保活针先起
    osc.setAttention(true); // 注意拍后起（同刻到期——保活先排先执行）
    clock.advance(OSC_ATTENTION_BLINK_MS);
    expect(io.frames.slice(-2)).toEqual([ACTIVE, title('[ . ] 待处置 base')]); // 一窗两针各恰一写
    osc.setProgress(false); // 保活停针——注意拍不牵连
    expect(io.frames.slice(-1)).toEqual([CLEAR]);
    clock.advance(OSC_ATTENTION_BLINK_MS);
    expect(io.frames.slice(-1)).toEqual([title('[ ! ] 待处置 base')]); // 注意拍续摆
    osc.setAttention(false); // 注意收——归位写
    expect(io.frames.slice(-1)).toEqual([title('base')]);
    const n = io.frames.length;
    clock.advance(OSC_ATTENTION_BLINK_MS * 3);
    expect(io.frames.length).toBe(n); // 全停——零写出
  });

  it('animations: false = 显形帧静态常驻零拍（动效门禁用形——schedule 在场也不摆）', () => {
    const io = new MemoryTerminalIO(80, 24);
    const clock = new ManualClock();
    const osc = new OscDisplay(io, {
      baseline: 'x',
      animations: false,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    osc.setTitle('base');
    osc.setAttention(true);
    expect(io.frames).toEqual([title('base'), title('[ ! ] 待处置 base')]); // 静态常驻
    clock.advance(OSC_ATTENTION_BLINK_MS * 5);
    expect(io.frames).toEqual([title('base'), title('[ ! ] 待处置 base')]); // 零拍
    osc.setAttention(false);
    expect(io.frames.slice(-1)).toEqual([title('base')]); // 收态归位仍有效
  });
});
