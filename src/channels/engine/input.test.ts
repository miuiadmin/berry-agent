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

  it('CSI tilde 首尾键双形：home 1~/7~ 与 end 4~/8~ 全收（tmux 内层 End 死键回归锁）', () => {
    // 修前红实证位：TILDE_KEYS 收了 home 双形（1/7）却漏 end 的 4~ 形（只有 8）——
    // tmux send-keys End 发 `\x1b[4~`（xterm legacy），dispatchTilde 查表未中即整序
    // 静默吞——07 §4.1 验证面矩阵明列的 tmux 内层里 End 全引擎死键（picker 跳尾档失效）。
    expect(run(['\x1b[1~'])).toEqual([key('home')]);
    expect(run(['\x1b[7~'])).toEqual([key('home')]);
    expect(run(['\x1b[4~'])).toEqual([key('end')]);
    expect(run(['\x1b[8~'])).toEqual([key('end')]);
  });

  it('CSI Z = shift+tab / SS3 字母终点', () => {
    expect(run(['\x1b[Z'])).toEqual([key('tab', { shift: true })]);
    expect(run(['\x1bOA'])).toEqual([key('up')]);
    expect(run(['\x1bOP'])).toEqual([key('f1')]);
  });

  it('SS3 态内 ESC 特判：后续转义序列起手不被吞（alt+O 驻留后箭头键整序可达）', () => {
    // legacy 轨 alt+O（metaSendsEscape 整键 \x1bO）驻留 ss3 态——后续 \x1b[A
    // 的首 ESC 修前被当 SS3 终点无条件消费、残段 '[A' 落地面态成文本（实测
    // [{text:'[A'}]——LETTER_KEYS 无 ESC 位，终点查表必空）；修后当枚不消
    // 费、交 esc 态重解（i 不进——OSC 态「当前字节回 esc 态重解」同款先例）
    const decoder = new InputDecoder();
    decoder.feed('\x1bO');
    expect(decoder.take()).toEqual([]); // ss3 态驻留——零事件
    decoder.feed('\x1b[A');
    expect(decoder.take()).toEqual([key('up')]);
  });

  it('ESC 后 DEL = legacy alt+backspace（\\x1b\\x7f）——与键位册注册绑定契约一致', () => {
    // option-as-meta 终端（无 kitty 的 macOS Terminal.app 等）alt+backspace
    // 恒 \x1b\x7f 编码；出厂键位册注册该绑定（editor.delete-word-backward
    // 消费面）——解码面修前整序吞零事件（契约不一致）。整 chunk 与劈 chunk
    // 两形同修
    expect(run(['\x1b\x7f'])).toEqual([key('backspace', { alt: true })]);
    expect(run(['\x1b', '\x7f'])).toEqual([key('backspace', { alt: true })]);
  });

  it('ESC 前缀 = alt：\\x1bx = alt+x；ESC ESC 相邻形 = Esc×2（迟答防御律——legacy alt+escape 降级）', () => {
    expect(run(['\x1bx'])).toEqual([key('x', { alt: true })]);
    // 相邻双 ESC：前枚立即判 Esc 键（无修饰）、当枚消费为新 lone-ESC 候选
    // 重挂起——settle 窗到点再出一枚（legacy \x1b\x1b 形从 alt+escape 降级为
    // Esc×2：kitty 轨 alt+esc 有专码、动作册无 alt+escape 绑定——零消费面）
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b\x1b');
    expect(decoder.take()).toEqual([key('escape')]);
    expect(decoder.hasPendingEscape).toBe(true); // 当枚重挂起中
    clock.t = 31;
    decoder.settle();
    expect(decoder.take()).toEqual([key('escape')]);
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

describe('迟答防御律（ESC ESC 相邻形拆解——lone-ESC 挂起窗内迟到终端应答不吞键）', () => {
  /**
   * 根因实证（CI run 35206555674 release-drill /themes esc 收屏 25s 超时红）：
   * 用户 lone-ESC 挂起窗内，tmux 迟到的 DA1 应答（\x1b[?1;2;4c——副屏进屏
   * ENTER_COMMON 探测哨兵的回声，CI 负载下应答写回晚于用户按键写回）以 ESC
   * 起头到达——旧「ESC ESC = alt+Escape」配对把 Esc 键吞成带修饰形（面板退出
   * 键面不匹配、25s 打满必红），应答的 ESC 被吞后残段 [?1;2;4c 走 text 事件
   * 渲染进屏（CI 失败现场屏面 dump 实见该字面量）。修法（07 §4 件 4 迟答
   * 防御律）：前枚立即判 Esc 键、当枚消费为新 lone-ESC 候选重挂起——后续
   * 字节构成 CSI/OSC 起手即由序列态接管，迟到应答整序正常消费。
   */
  it('迟答撞窗形（拆 chunk——CI 实红同序）：挂起窗内 DA1 应答到达 → Esc 键 + 应答整序消费零 text', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b'); // 用户 lone-ESC 挂起
    expect(decoder.take()).toEqual([]);
    clock.t = 10; // 窗内
    decoder.feed('\x1b[?1;2;4c'); // 迟到的 DA1 应答（ESC 起头）
    // 前枚立即兑现 Esc 键（无修饰——面板退出键面匹配）；当枚被 '[' 续成 CSI
    // 应答整序消费（协议面零键事件）；绝无 text 残段（修前红形：alt+escape
    // + text '[?1;2;4c'）
    expect(decoder.take()).toEqual([key('escape')]);
    expect(decoder.hasPendingEscape).toBe(false); // '[' 起手已消解挂起
    clock.t = 100;
    decoder.settle();
    expect(decoder.take()).toEqual([]);
  });

  it('迟答撞窗形（同 chunk——单 read 双 ESC 前缀同解）', () => {
    expect(run(['\x1b\x1b[?1;2;4c'])).toEqual([key('escape')]);
  });

  it('OSC 11 迟答同族：挂起窗内 \\x1b]11;rgb:…\\x07 到达 → Esc 键 + OSC 整串上抛', () => {
    const clock = new FakeClock();
    const oscSeen: string[] = [];
    const decoder = new InputDecoder({ now: clock.now, onOsc: (data) => oscSeen.push(data) });
    decoder.feed('\x1b');
    clock.t = 8;
    decoder.feed('\x1b]11;rgb:1111/1111/1111\x07'); // 主题层 OSC 11 探测的迟到应答
    expect(decoder.take()).toEqual([key('escape')]);
    expect(oscSeen).toEqual(['11;rgb:1111/1111/1111']); // 整串正常上抛（明暗裁定消费面无损）
  });

  it('纯双 ESC（无续字节）：前枚立即 Esc + 当枚 settle 再 Esc（降级形完备性）', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b');
    clock.t = 5;
    decoder.feed('\x1b'); // 第二枚后无任何字节
    expect(decoder.take()).toEqual([key('escape')]); // 前枚立即兑现
    expect(decoder.hasPendingEscape).toBe(true); // 当枚重挂起
    clock.t = 40;
    decoder.settle();
    expect(decoder.take()).toEqual([key('escape')]); // 当枚窗到点兑现
  });

  it('OSC 11 迟答 ST 终结形同族：\\x1b]11;rgb:…\\x1b\\\\ 到达 → Esc 键 + OSC 整串上抛', () => {
    const clock = new FakeClock();
    const oscSeen: string[] = [];
    const decoder = new InputDecoder({ now: clock.now, onOsc: (data) => oscSeen.push(data) });
    decoder.feed('\x1b');
    clock.t = 8;
    decoder.feed('\x1b]11;rgb:2222/2222/2222\x1b\\'); // ST 终结形（ESC '\'——与 BEL 形同律）
    expect(decoder.take()).toEqual([key('escape')]);
    expect(oscSeen).toEqual(['11;rgb:2222/2222/2222']); // 整串正常上抛（明暗裁定消费面无损）
  });

  it('跨 chunk 拆读残段形：窗过期兑现后裸续串按文本交付——本族恒留可见残段', () => {
    const clock = new FakeClock();
    const decoder = new InputDecoder({ now: clock.now });
    decoder.feed('\x1b');
    clock.t = 5;
    decoder.feed('\x1b');
    expect(decoder.take()).toEqual([key('escape')]); // 前枚立即兑现
    clock.t = 40;
    decoder.settle();
    expect(decoder.take()).toEqual([key('escape')]); // 当枚窗到点兑现
    expect(decoder.hasPendingEscape).toBe(false);
    // 此后迟到主体（应答串去 ESC 前缀的裸续）无挂起可攀附——按普通文本交付。
    // 意义：本防御族任何形都恒留可见残段（键或 text）——「零残段」的 CI 红
    // 可据此整体排除本族（/themes ESC flake 归因谱 2026-09-19 的排障锚）
    decoder.feed('[?1;2;4c');
    expect(decoder.take()).toEqual([{ kind: 'text', text: '[?1;2;4c' }]);
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

  it('键号子域非整数 fail-closed 整事件吞（fromCodePoint RangeError 防回归）', () => {
    // 修前红实证位：键号守卫只查 isFinite——97.5 有限非整过闸，kittyKeyName
    // 内 String.fromCodePoint(97.5) 对 [0x20,0x10FFFF] 区间内非整数抛
    // RangeError，经 feed → Engine.handleInput → stdin data 监听器未捕获升格
    // uncaughtException 杀 TUI 进程。修后键号守卫与文本子域同尺（isInteger +
    // 0..0x10FFFF 界检；0 保留合法——IME 纯文本事件路径 keyCode 0）。
    expect(run(['\x1b[97.5u'])).toEqual([]); // 修前：RangeError 未捕获直抛
    expect(run(['\x1b[97.5;5u'])).toEqual([]); // 带修饰子域同律
    expect(run(['\x1b[1114112u'])).toEqual([]); // 键号越 0x10FFFF——键号子域同尺吞
  });

  it('键号界检升尺后合法形不回退：97 = a 键 / keyCode 0 = IME 纯文本路径', () => {
    expect(run(['\x1b[97u'])).toEqual([key('a')]);
    expect(run(['\x1b[0;;20013u'])).toEqual([ime('中', true)]); // keyCode 0 保留合法
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

describe('无效 UTF-8 替换符 U+FFFD 三形穿透（D4②——上游解码已产替换符，解码器照可打印透传不特判不丢弃）', () => {
  // 上游（serve-entry StringDecoder / pty 解码腿）对无效 UTF-8 字节产出 U+FFFD
  // 替换符后才 feed 进本解码器——地面游程 / 粘贴体 / OSC 体三条积攒路径都必须
  // 把它当普通可打印字符原样穿透：既不误判控制码、也不被「净化」丢弃（丢字符
  // 即静默篡改用户输入）。三形逐路锁定（源码用 \uFFFD 转义写法——六字符可见
  // 形，防编辑器吞码位）。

  it('地面态裸替换符：入 text 游程原样穿透（不误判控制码、不滞留 esc 挂起）', () => {
    const decoder = new InputDecoder();
    decoder.feed('a\uFFFDb');
    expect(decoder.take()).toEqual([{ kind: 'text', text: 'a\uFFFDb' }]);
    expect(decoder.hasPendingEscape).toBe(false); // 未被误当转义起手滞留
  });

  it('粘贴体携带替换符：整段交付保形、终界后地面态续解不滞留', () => {
    const decoder = new InputDecoder();
    decoder.feed('\x1b[200~\uFFFDok\x1b[201~');
    expect(decoder.take()).toEqual([{ kind: 'paste', text: '\uFFFDok' }]);
    decoder.feed('\r'); // 终界后回地面——续解正常
    expect(decoder.take()).toEqual([key('enter')]);
  });

  it('OSC 体携带替换符：原文上抛保形、零事件产出', () => {
    const osc: string[] = [];
    const decoder = new InputDecoder({ onOsc: (data) => osc.push(data) });
    decoder.feed('\x1b]11;rgb:\uFFFD\x07');
    expect(osc).toEqual(['11;rgb:\uFFFD']);
    expect(decoder.take()).toEqual([]);
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

describe('OSC 串（ESC ] data 终结——BEL / ST 两形整串上抛）', () => {
  /** OSC 收集 rig：onOsc 落账 + 事件面同收 */
  function runOsc(chunks: string[]): { osc: string[]; events: InputEvent[] } {
    const osc: string[] = [];
    const decoder = new InputDecoder({ onOsc: (data) => osc.push(data) });
    for (const c of chunks) decoder.feed(c);
    return { osc, events: decoder.take() };
  }

  it('BEL 终结形：OSC 11 应答整串上抛、不产按键', () => {
    const { osc, events } = runOsc(['\x1b]11;rgb:ffff/ffff/ffff\x07']);
    expect(osc).toEqual(['11;rgb:ffff/ffff/ffff']);
    expect(events).toEqual([]);
  });

  it('ST 终结形（ESC \\\\）：同律整串上抛', () => {
    const { osc, events } = runOsc(['\x1b]11;rgb:0/0/0\x1b\\']);
    expect(osc).toEqual(['11;rgb:0/0/0']);
    expect(events).toEqual([]);
  });

  it('跨 chunk 续攒：终结符前分片到达不丢段', () => {
    const { osc } = runOsc(['\x1b]11;rgb', ':1234/1234/1234', '\x07']);
    expect(osc).toEqual(['11;rgb:1234/1234/1234']);
  });

  it('未终结悬置：内容积攒不上抛、也不误产键', () => {
    const { osc, events } = runOsc(['\x1b]11;rgb:0/0/0']);
    expect(osc).toEqual([]); // 无终结符——悬置待续
    expect(events).toEqual([]);
    // 后续补终结符——完整上抛（悬置可续）
    const clock = new FakeClock();
    const osc2: string[] = [];
    const decoder = new InputDecoder({ now: clock.now, onOsc: (d) => osc2.push(d) });
    decoder.feed('\x1b]11;rgb:1/1/1');
    decoder.feed('\x07');
    expect(osc2).toEqual(['11;rgb:1/1/1']);
  });

  it('OSC 内 ESC 后非 \\\\ ：截断上抛 + ESC 进次态重解（宁截不留）', () => {
    // ESC Z 形 = alt+z——OSC 被 ESC 打断后截断上抛、ESC 序列按键面续解
    const { osc, events } = runOsc(['\x1b]ab\x1bz']);
    expect(osc).toEqual(['ab']);
    expect(events).toEqual([key('z', { alt: true })]);
  });

  it('alt 右方括号语义退役：ESC ] 不再产 alt 键（OSC 起始位收编）', () => {
    const { osc, events } = runOsc(['\x1b]x\x07']);
    expect(osc).toEqual(['x']);
    expect(events).toEqual([]); // 原先 ESC ] 会落 alt+右方括号——10g 起收编为 OSC 起始
  });

  it('超帽丢弃：OSC_CAP 1024 帽超后整串不上抛（毒化防御）', () => {
    const { osc, events } = runOsc(['\x1b]' + 'x'.repeat(1100) + '\x07']);
    expect(osc).toEqual([]);
    expect(events).toEqual([]);
  });

  it('超帽后下一串恢复上抛（帽是串级非锁死级）', () => {
    const clock = new FakeClock();
    const osc: string[] = [];
    const decoder = new InputDecoder({ now: clock.now, onOsc: (d) => osc.push(d) });
    decoder.feed('\x1b]' + 'x'.repeat(1100) + '\x07');
    decoder.feed('\x1b]11;rgb:0/0/0\x07'); // 串界已复位——续解正常
    expect(osc).toEqual(['11;rgb:0/0/0']);
  });

  it('OSC 悬置期 discardPending：全清后续解不坏', () => {
    const clock = new FakeClock();
    const osc: string[] = [];
    const decoder = new InputDecoder({ now: clock.now, onOsc: (d) => osc.push(d) });
    decoder.feed('\x1b]11;rgb:0/0/0'); // 悬置（无终结符）
    decoder.discardPending();
    decoder.feed('\x07'); // 态已清——BEL 不再当终结符补上抛
    expect(osc).toEqual([]);
    decoder.feed('\x1b]11;rgb:1/1/1\x07'); // 新串正常
    expect(osc).toEqual(['11;rgb:1/1/1']);
  });
});
