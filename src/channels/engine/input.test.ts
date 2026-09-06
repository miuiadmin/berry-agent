/**
 * InputDecoder 单测（07 篇引擎节件 2——六态机全景：legacy/kitty 双轨 + IME
 * 组字态机 + bracketed paste 整段 + lone-ESC 判定窗 + 畸形流防御）。
 *
 * 假钟注入驱动时间窗（lone-ESC 30ms / IME 跟随窗 100ms）；事件断言全形
 * toEqual（phase 必填三值 / committed 互反是本仓契约面——两形全程在场断言）。
 */
import { describe, expect, it } from 'vitest';
import { InputDecoder, type InputDecoderOptions } from './input.js';
import type { ImeEvent, InputEvent, KeyEvent, KeyboardProtocol } from './types.js';

/** 假钟（时间窗用例注入——t 手推） */
class FakeClock {
  public t = 0;
  public readonly now = (): number => this.t;
}

/** 键事件全形构造（缺省无修饰 + press——断言基准形） */
const key = (
  k: string,
  mods: Partial<Pick<KeyEvent, 'ctrl' | 'alt' | 'shift' | 'meta'>> = {},
  phase: KeyEvent['phase'] = 'press',
): KeyEvent => ({ kind: 'key', key: k, ctrl: false, alt: false, shift: false, meta: false, ...mods, phase });

/** ime 事件全形构造 */
const ime = (text: string, committed: boolean): ImeEvent => ({ kind: 'ime', text, committed });

/** 建解码器 + feed 全部 chunk + 排空（链式一步——多数用例的形） */
function run(chunks: string[], opts?: InputDecoderOptions, clock?: FakeClock): InputEvent[] {
  const decoder = new InputDecoder({ now: clock?.now, ...opts });
  for (const c of chunks) decoder.feed(c);
  return decoder.take();
}

describe('legacy 轨：C0 控制码与功能键', () => {
  it('C0 映射：enter/tab/backspace/ctrl+字母/ctrl+标点', () => {
    expect(run(['\r'])).toEqual([key('enter')]);
    expect(run(['\n'])).toEqual([key('enter')]);
    expect(run(['\t'])).toEqual([key('tab')]);
    expect(run(['\x7f'])).toEqual([key('backspace')]);
    expect(run(['\x00'])).toEqual([key('space', { ctrl: true })]);
    expect(run(['\x01'])).toEqual([key('a', { ctrl: true })]); // 0x01 = ctrl+a
    expect(run(['\x03'])).toEqual([key('c', { ctrl: true })]); // 0x03 = ctrl+c
    expect(run(['\x1a'])).toEqual([key('z', { ctrl: true })]); // 0x1a = ctrl+z
    expect(run(['\x1c'])).toEqual([key('\\', { ctrl: true })]); // ctrl+标点位
  });

  it('CSI 字母终点：箭头 / home / end / F1-F4（phase 恒 press）', () => {
    expect(run(['\x1b[A'])).toEqual([key('up')]);
    expect(run(['\x1b[B'])).toEqual([key('down')]);
    expect(run(['\x1b[C'])).toEqual([key('right')]);
    expect(run(['\x1b[D'])).toEqual([key('left')]);
    expect(run(['\x1b[H'])).toEqual([key('home')]);
    expect(run(['\x1b[F'])).toEqual([key('end')]);
    expect(run(['\x1b[1;3H'])).toEqual([key('home', { alt: true })]); // 3 = 1+alt
  });

  it('CSI 修饰形：\\x1b[1;5C = ctrl+right（mods 位域解码）', () => {
    expect(run(['\x1b[1;5C'])).toEqual([key('right', { ctrl: true })]);
    expect(run(['\x1b[1;2D'])).toEqual([key('left', { shift: true })]);
  });

  it('CSI tilde 功能键表：delete/F5/F12 + 修饰', () => {
    expect(run(['\x1b[3~'])).toEqual([key('delete')]);
    expect(run(['\x1b[15~'])).toEqual([key('f5')]);
    expect(run(['\x1b[24~'])).toEqual([key('f12')]);
    expect(run(['\x1b[3;5~'])).toEqual([key('delete', { ctrl: true })]);
  });

  it('CSI Z = shift+tab / SS3 字母终点', () => {
    expect(run(['\x1b[Z'])).toEqual([key('tab', { shift: true })]);
    expect(run(['\x1bOA'])).toEqual([key('up')]);
    expect(run(['\x1bOP'])).toEqual([key('f1')]);
  });

  it('ESC 前缀 = alt：\\x1bx = alt+x、ESC ESC = alt+escape', () => {
    expect(run(['\x1bx'])).toEqual([key('x', { alt: true })]);
    expect(run(['\x1b\x1b'])).toEqual([key('escape', { alt: true })]);
  });

  it('未知序列 / 私用应答 / CPR 形状：吞（零垃圾事件）', () => {
    expect(run(['\x1b[999z'])).toEqual([]);
    expect(run(['\x1b[?99n'])).toEqual([]);
    expect(run(['\x1b[10;20R'])).toEqual([]); // CPR 应答形状
    expect(run(['\x1b[I'])).toEqual([]); // 焦点通知
  });
});

describe('text 游程（打字 / legacy IME 提交不撕裂）', () => {
  it('同 chunk 连续可打印合并单事件（含 CJK / emoji 代理对整对）', () => {
    expect(run(['hello'])).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(run(['中文👍'])).toEqual([{ kind: 'text', text: '中文👍' }]);
  });

  it('混合 chunk 顺序保真：text 与按键交错', () => {
    expect(run(['ab\x1b[Ccd'])).toEqual([{ kind: 'text', text: 'ab' }, key('right'), { kind: 'text', text: 'cd' }]);
  });

  it('跨 chunk 不滞留：每 chunk 一冲刷', () => {
    const decoder = new InputDecoder();
    decoder.feed('ab');
    expect(decoder.take()).toEqual([{ kind: 'text', text: 'ab' }]);
    decoder.feed('cd');
    expect(decoder.take()).toEqual([{ kind: 'text', text: 'cd' }]);
  });
});

describe('lone-ESC 判定窗（30ms 只落 legacy 轨）', () => {
  it('ESC 为 chunk 末字节：挂起等续——窗到点 settle 判 Esc 键', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b');
    expect(decoder.take()).toEqual([]); // 挂起期零事件
    expect(decoder.hasPendingEscape).toBe(true);
    clock.t = 31;
    decoder.settle();
    expect(decoder.take()).toEqual([key('escape')]);
  });

  it('窗内续到：判定窗解除、序列正常解', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b');
    clock.t = 10;
    decoder.feed('[A'); // 续成 CSI up——无需 settle
    expect(decoder.take()).toEqual([key('up')]);
    clock.t = 100;
    decoder.settle(); // 已无挂起——无操作
    expect(decoder.take()).toEqual([]);
  });

  it('窗未到点 settle：仍挂起（引擎定时器装排判据）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now, escapeWindowMs: 30 });
    decoder.feed('\x1b');
    clock.t = 10;
    decoder.settle();
    expect(decoder.take()).toEqual([]); // 30ms 未满——不判
    clock.t = 30;
    decoder.settle();
    expect(decoder.take()).toEqual([key('escape')]);
  });
});

describe('kitty 轨：CSI u 全形', () => {
  it('基础形：\\x1b[97u = a 键 press', () => {
    expect(run(['\x1b[97u'])).toEqual([key('a')]);
  });

  it('修饰形：位域解码（shift1/alt2/ctrl4）', () => {
    expect(run(['\x1b[97;5u'])).toEqual([key('a', { ctrl: true })]);
    expect(run(['\x1b[97;3u'])).toEqual([key('a', { alt: true })]);
    expect(run(['\x1b[97;2u'])).toEqual([key('a', { shift: true })]);
    expect(run(['\x1b[97;9u'])).toEqual([key('a', { meta: true })]); // 9 = 1+super8
  });

  it('事件型：1:2 repeat / 1:3 release（phase 三值全程在场）', () => {
    expect(run(['\x1b[97;1:2u'])).toEqual([key('a', {}, 'repeat')]);
    expect(run(['\x1b[97;1:3u'])).toEqual([key('a', {}, 'release')]);
    expect(run(['\x1b[97;1:9u'])).toEqual([key('a', {}, 'press')]); // 非法值保守收口
  });

  it('特殊键号：27 escape / 13 enter / PUA 功能键', () => {
    expect(run(['\x1b[27u'])).toEqual([key('escape')]);
    expect(run(['\x1b[13u'])).toEqual([key('enter')]);
    expect(run(['\x1b[57419u'])).toEqual([key('up')]); // PUA 57419
  });

  it('文本子域与键符一致 = 普通打字 → text 事件', () => {
    expect(run(['\x1b[97;;97u'])).toEqual([{ kind: 'text', text: 'a' }]);
  });

  it('文本子域与键符不一致 = 组合变换 → ime 提交', () => {
    expect(run(['\x1b[97;;98u'])).toEqual([ime('b', true)]);
  });

  it('码点界检 fail-closed：0 / 越界 / 非整数子域全弃（文本子域选参数区字节——终点区字节另成新序列）', () => {
    expect(run(['\x1b[0;;0u'])).toEqual([]); // 0 非 1..0x10FFFF——吞
    expect(run(['\x1b[0;;99999999u'])).toEqual([]); // 越 0x10FFFF——吞
    expect(run(['\x1b[0;;<u'])).toEqual([]); // 非数字（参数区字节 '<'）——吞
  });

  it('未知键号带文本：按提交交付', () => {
    expect(run(['\x1b[1;;65u'])).toEqual([ime('A', true)]);
  });
});

describe('IME 组字态机（前缀增长检测 + 单发提交零延迟）', () => {
  it('key 0 单发提交：首达即交付（committed true——零延迟）', () => {
    expect(run(['\x1b[0;;20013u'])).toEqual([ime('中', true)]);
  });

  it('流式预编辑：跟随窗内前缀链回溯开 session（前发已交付不可撤）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b[0;;20013u'); // '中'——首达交付
    expect(decoder.take()).toEqual([ime('中', true)]);
    clock.t = 50; // 跟随窗 100ms 内
    decoder.feed('\x1b[0;;20013:22269u'); // '中国' 前缀链——回溯开 session
    expect(decoder.take()).toEqual([ime('中国', false)]);
    clock.t = 60;
    decoder.feed('\x1b[0;;20013:22269:20154u'); // '中国人' 严格扩展——组字续
    expect(decoder.take()).toEqual([ime('中国人', false)]);
    expect(decoder.composing).toBe(true);
    expect(decoder.pendingPreedit).toBe('中国人');
  });

  it('组字中不扩展文本 = 冲刷为提交（最终全文）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b[0;;20013u');
    decoder.take();
    decoder.feed('\x1b[0;;20013:22269u'); // 开 session
    decoder.take();
    decoder.feed('\x1b[0;;20013:22269u'); // 相同文本——不扩展
    expect(decoder.take()).toEqual([ime('中国', true)]);
    expect(decoder.composing).toBe(false);
  });

  it('按键打断组字：先冲刷旧预编辑为提交、再发按键（不双发不丢失）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b[0;;20013u');
    decoder.take();
    decoder.feed('\x1b[0;;20013:22269u');
    decoder.take(); // 组字中
    decoder.feed('\r'); // 按键打断
    expect(decoder.take()).toEqual([ime('中国', true), key('enter')]);
  });

  it('跟随窗外前缀链：仍按独立提交交付（不误开 session）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b[0;;20013u');
    decoder.take();
    clock.t = 500; // 窗外
    decoder.feed('\x1b[0;;20013:22269u');
    expect(decoder.take()).toEqual([ime('中国', true)]);
    expect(decoder.composing).toBe(false);
  });
});

describe('bracketed paste（整段交付 + 跨 chunk 终界悬置）', () => {
  it('整段识别：体内容不逐键解析（CRLF 保形）', () => {
    expect(run(['\x1b[200~ls\r\nfoo\x1b[201~'])).toEqual([{ kind: 'paste', text: 'ls\r\nfoo' }]);
  });

  it('终界跨 chunk 劈两半：悬置尾拼回（劈点即终界——体完整交付，终界后自由文本回地面态解）', () => {
    const decoder = new InputDecoder();
    decoder.feed('\x1b[200~abc\x1b[20');
    expect(decoder.take()).toEqual([]); // paste 体在途——零事件
    decoder.feed('1~def\x1b[201~');
    // tail '\x1b[20' + '1~' 补完第一段终界 → paste 'abc' 交付、回地面；
    // 'def' 是终界之后的自由文本 → text（末尾裸 201~ 吞）
    expect(decoder.take()).toEqual([
      { kind: 'paste', text: 'abc' },
      { kind: 'text', text: 'def' },
    ]);
    decoder.feed('\r'); // 未滞留——地面态续解正常
    expect(decoder.take()).toEqual([key('enter')]);
  });

  it('终界前缀 1 字节劈：同款悬置', () => {
    const decoder = new InputDecoder();
    decoder.feed('\x1b[200~xy\x1b[');
    decoder.feed('201~');
    expect(decoder.take()).toEqual([{ kind: 'paste', text: 'xy' }]);
  });

  it('同 chunk 双段 paste + 尾随按键续解', () => {
    expect(run(['\x1b[200~a\x1b[201~\x1b[200~b\x1b[201~\r'])).toEqual([
      { kind: 'paste', text: 'a' },
      { kind: 'paste', text: 'b' },
      key('enter'),
    ]);
  });

  it('裸包裹尾（无开始）：吞', () => {
    expect(run(['\x1b[201~'])).toEqual([]);
  });

  it('超帽强制冲刷：交付已积段 + 转吸收态吞残余到真终界', () => {
    const decoder = new InputDecoder();
    // 4 MiB 帽 + 1 字节超帽——冲刷已积段、残余入吸收态
    const big = 'a'.repeat(4 * 1024 * 1024 + 1);
    decoder.feed(`\x1b[200~${big}`);
    expect(decoder.take()).toEqual([{ kind: 'paste', text: big }]);
    decoder.feed('residual\r'); // 吸收态——残余粘贴体全吞（含 \r 形伪造 enter）
    expect(decoder.take()).toEqual([]);
    decoder.feed('\x1b[201~ok'); // 真终界回地面——续解正常
    expect(decoder.take()).toEqual([{ kind: 'text', text: 'ok' }]);
  });

  it('换防吞在途：粘贴态转吸收态（残余不伪造命令行事件）', () => {
    const decoder = new InputDecoder();
    decoder.feed('\x1b[200~par');
    decoder.discardPending(); // 换防——粘贴体半截被弃
    decoder.feed('tial\x1b[201~ok'); // 残余到真终界全吞、'ok' 正常解
    expect(decoder.take()).toEqual([{ kind: 'text', text: 'ok' }]);
  });
});

describe('畸形流防御（宁丢不错）', () => {
  it('CSI 参数超帽：毒化整序丢弃（不锁死不漏文本——参数区字节积攒过 64 帽）', () => {
    const decoder = new InputDecoder();
    decoder.feed('\x1b[' + '9'.repeat(70) + '~'); // 64 帽 + 6 超帽（'9' 为参数区字节）
    expect(decoder.take()).toEqual([]);
    decoder.feed('\r'); // 解码器未锁死——续解正常
    expect(decoder.take()).toEqual([key('enter')]);
  });

  it('地面态 discardPending：解析态全清、续解不坏（地面游程在 feed 尾已恒冲刷）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b'); // lone-ESC 挂起
    decoder.discardPending();
    clock.t = 100;
    decoder.settle(); // 挂起已清——无事件
    expect(decoder.take()).toEqual([]);
    decoder.feed('cd'); // 解码器未坏——游程正常
    expect(decoder.take()).toEqual([{ kind: 'text', text: 'cd' }]);
  });
});

describe('协议探测落定（DA1 哨兵）', () => {
  it('kitty 应答先到：onProtocol(kitty) 一次', () => {
    const protocols: KeyboardProtocol[] = [];
    const decoder = new InputDecoder({ onProtocol: (p) => protocols.push(p) });
    decoder.feed('\x1b[?1u');
    expect(protocols).toEqual(['kitty']);
    decoder.feed('\x1b[?62;22c'); // DA1 后到——已上报不再发
    expect(protocols).toEqual(['kitty']);
  });

  it('DA1 先到无 kitty 应答：legacy 落定', () => {
    const protocols: KeyboardProtocol[] = [];
    const decoder = new InputDecoder({ onProtocol: (p) => protocols.push(p) });
    decoder.feed('\x1b[?62;22c');
    expect(protocols).toEqual(['legacy']);
  });

  it('探测应答绝不误当按键', () => {
    const decoder = new InputDecoder();
    decoder.feed('\x1b[?1u\x1b[?62;22c');
    expect(decoder.take()).toEqual([]);
  });
});
