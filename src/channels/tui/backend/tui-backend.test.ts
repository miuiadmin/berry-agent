/**
 * TuiBackend 组合测试（批 10e-1 呈现 + 批 10e-2 交互纵切）。
 *
 * 覆盖：UiBackend 契约面（capabilities/hasAudience）、直播呈现全链
 * （聚焦流式两段 / 非聚焦摘要行）、状态面消费（转轮/工具名/启停）、
 * notify 档位符号、setStatus、tick 推帧、onRepaint 投影重建、resize 自订阅；
 * 交互纵切（10e-2）：自持输入管线与路由四层、提交路由（命令柄/应答优先）、
 * 补全弹层三源、阻塞四件浮层面板、渲染合并与 tick 自驱（手动时钟 rig）；
 * ask 撤销说明行（批 10f-3——07 §4.3 撤销面：abort 后 ⏹ 行在场 + 迟到
 * abort 不误写四路各一例）；
 * 呈现面件 7（终端外显）：起屏基线 title、按会话净计数忙态（OSC 9;4）、
 * clamp 防穿底、切焦跨路回归锁、onRepaint 点缀短 id、stop 复原两写点、
 * 保活周期重发；
 * 主题面（批 10g——07 §4.1 R2）：缺省 dark 确定性基线、auto 档 OSC 11
 * 探测编舞（查询/订阅/应答换装/同板零帧/迟到换装/畸形忽略/stop 复原）、
 * 硬退复原钩 2031 同写（七役扫描批——复原对称律）、resumeMain 复起重查
 * （七役扫描批——副屏在场窗通知丢弃的补偿面）、colorEnv 三档接线。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO, ProcessTerminalIO } from '../../engine/index.js';
import { ansiColor } from '../../engine/index.js';
import { TuiBackend, type TuiBackendOptions } from './tui-backend.js';
import { buildSgr } from './ansi-rows.js';
import { sessionColor } from '../theme/index.js';
import { AltScreenHost } from '../overlay/alt-screen.js';
import { AUTOCOMPLETE_DEBOUNCE_MS } from '../autocomplete/async.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { MemoryViewerDataDeps } from '../memory/memory-viewer.js';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage, UiSessionSummary, UiUsageSummary } from '../../../contracts/index.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COLS = 80;
const ROWS = 10;
const SESSION = 'sess-aaaaaaaaaa';

/** OSC 9;4 两序列（件 7 断言锚——字节形真源在 osc.ts 直测） */
const PROGRESS_ACTIVE = '\x1b]9;4;3\x07';
const PROGRESS_CLEAR = '\x1b]9;4;0\x07';
/** OSC 0 title 序列包装 */
const oscTitle = (t: string): string => `\x1b]0;${t}\x07`;

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function assistantMsg(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: text !== '' ? [{ type: 'text', text }] : [],
    usage,
    stopReason: 'stop',
    timestamp: 1,
  };
}

function makeBackend(options: Partial<TuiBackendOptions> = {}): {
  io: MemoryTerminalIO;
  backend: TuiBackend;
} {
  const io = new MemoryTerminalIO(COLS, ROWS);
  const backend = new TuiBackend(io, options);
  backend.start();
  return { io, backend };
}

function emit(backend: TuiBackend, event: AgentEvent, focused = true): void {
  backend.onEnvelope({ sessionId: SESSION, event }, focused);
}

describe('TuiBackend 契约面', () => {
  it('id / capabilities / hasAudience（阻塞四件浮层呈现——批 10e-2 交互纵切翻真）', () => {
    const { backend } = makeBackend();
    expect(backend.id).toBe('tui');
    expect(backend.capabilities).toEqual({
      notify: true,
      confirm: true,
      select: true,
      input: true,
      approval: true,
      setStatus: true,
      setWidget: false,
    });
    expect(backend.hasAudience()).toBe(true);
  });

  it('start：主屏形模式串 + 清屏 + 滚动区 + 固定区首画（编辑器 + 状态行）', () => {
    const { io } = makeBackend();
    // 主屏形模式串：粘贴开 + kitty 推栈——无 1049 备屏、无光标藏（与全屏形分立）
    expect(io.bytes).toContain('\x1b[?2004h');
    expect(io.bytes).toContain('\x1b[>1u');
    expect(io.bytes).not.toContain('\x1b[?1049h');
    expect(io.bytes).not.toContain('\x1b[?25l');
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;6r'); // 10 行 - 固定区 4（编辑器 3 + 状态行 1）
    expect(io.bytes).toContain('┌'); // 编辑器边框（v2 固定区——› 占位行已退役）
    expect(io.raw).toBe(true); // raw 模式置位
  });
});

describe('TuiBackend 直播呈现', () => {
  it('聚焦流式两段：纯文本直推 → 定稿 markdown 换装', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式**段') });
    io.bytes = '';
    emit(backend, { type: 'message_end', message: assistantMsg('# 定稿标题') });
    expect(io.bytes).toContain('定稿标题'); // 定稿换装在场
    expect(io.bytes).toContain('\x1b[1m定稿标题\x1b[0m'); // markdown 渲染（H1 bold）
  });

  it('流式帧字节帽超帽降档纯文本（批 10h R1 perf 护栏——streamFrameByteCap 注入面使触发路可测）', () => {
    // 小帽注入（1 字节）：单字帧不超帽（1 > 1 假）；带 markdown 帧字节远超 1
    // ——超帽帧本帧仍 markdown 直推（帧已落账不回改），present 后降档（弃 doc），
    // 次帧起流式正文纯文本直推
    const { io, backend } = makeBackend({ streamFrameByteCap: 1 });
    emit(backend, { type: 'message_start', role: 'assistant' });
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') }); // 1 字节不超帽
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题') });
    expect(io.bytes).toContain('\x1b[1m标题'); // 超帽帧本帧仍 markdown（H1 bold——降档不回改已落帧）
    io.bytes = '';
    emit(backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题\n乙') });
    expect(io.bytes).toContain('# 标题'); // 降档纯文本：标题标记 '#' 原文在场（markdown 档会剥 # 走 bold）
    expect(io.bytes).not.toContain('\x1b[1m'); // 零 bold——流式 markdown 直推档已降
    // 对称面（缺省帽 256KB 生产定值不降档）：同序列次帧仍 markdown 直推——
    // '#' 剥除 + H1 bold 在场（与降档帧互为分辨形，缺省行为不变即锁）
    const ctl = makeBackend();
    emit(ctl.backend, { type: 'message_start', role: 'assistant' });
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲') });
    ctl.io.bytes = '';
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题') });
    emit(ctl.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('甲\n# 标题\n乙') });
    expect(ctl.io.bytes).not.toContain('# 标题'); // '#' 被剥（H1 无标记原文）
    expect(ctl.io.bytes).toContain('\x1b[1m标题'); // markdown 直推档（H1 bold）
  });

  it('聚焦 user 消息：> 前缀行', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '帮我看下', timestamp: 1 } });
    expect(io.bytes).toContain('\r> 帮我看下\n');
  });

  it('非聚焦摘要行：会话色行首段 + 档位符号分档', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' }, false);
    const sgr = buildSgr({ fg: sessionColor('sess-aaa') });
    expect(io.bytes).toContain(sgr + '⧗ sess-aaa\x1b[0m 后台工作中\n');
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'failed' }, false);
    expect(io.bytes).toContain('✖ sess-aaa\x1b[0m 后台失败\n');
  });

  it('非聚焦消息族零正文行（不建账）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'message_end', message: { role: 'user', content: '后台', timestamp: 1 } }, false);
    expect(io.bytes).not.toContain('> 后台');
  });
});

describe('TuiBackend 状态面', () => {
  it('agent_start → 转轮 accent 首帧；agent_end → 归闲', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).toContain('\x1b[36m⠋'); // accent（ANSI 6 cyan）转轮首帧
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('⠋');
  });

  it('agent_end 终态分档：failed ✖ / aborted ⏹ 不伪装成功（P0 静默点②——不显 ✓ 用量成功形）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'failed' });
    expect(io.bytes).toContain('✖ 失败');
    expect(io.bytes).not.toContain('✓ 用量');
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'aborted' });
    expect(io.bytes).toContain('⏹ 已中止');
    expect(io.bytes).not.toContain('✓ 用量');
  });

  it('tool_execution_start → ⚙ 工具名段优先；end → 清工具', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_start', toolCallId: 'tc1', name: 'grep', arguments: {} });
    expect(io.bytes).toContain('⚙ grep …');
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 'tc1', result: {} as never });
    expect(io.bytes).not.toContain('⚙ grep');
  });

  it('非聚焦事件不驱动状态面（状态行是聚焦会话的）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    emit(backend, { type: 'agent_start' }, false);
    expect(io.bytes).not.toContain('⠋');
  });

  it('setStatus：闲态文案呈现（last-writer-wins）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    backend.setStatus(SESSION, '就绪');
    expect(io.bytes).toContain('就绪');
  });

  it('tick：忙态推帧、闲态零写出', () => {
    const { io, backend } = makeBackend();
    backend.tick();
    const idleBytes = io.bytes.length;
    backend.tick();
    expect(io.bytes.length).toBe(idleBytes); // 闲态 tick 零写出
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    backend.tick();
    expect(io.bytes).toContain('⠙'); // 第二帧
  });
});

describe('TuiBackend notify / repaint / resize', () => {
  it('notify 档位符号（info·/success✓/warn⚠/error✖）', () => {
    const { io, backend } = makeBackend();
    backend.notify('普通', { level: 'info' });
    expect(io.bytes).toContain('\r· 普通\n');
    backend.notify('成了', { level: 'success' });
    expect(io.bytes).toContain('✓ 成了');
    backend.notify('小心', { level: 'warn' });
    expect(io.bytes).toContain('⚠ 小心');
    backend.notify('坏了', { level: 'error' });
    expect(io.bytes).toContain('✖ 坏了');
    backend.notify('缺省档');
    expect(io.bytes).toContain('· 缺省档');
  });

  it('多行 notify 回执不漂账（doors 帮助形——后续行落在物理末行之后，不覆写回执中段）', () => {
    const { io, backend } = makeBackend();
    // doors 失败回执形：message 本体多行（缺子命令 + usage 各行）。
    // 物理行账漂移的旧形：writeLine 只按一次 +1 记账——4 行文本写出行 0..3
    // 而账只到行 1，后续追加从行 1 起笔覆写回执第 2 行（tmux 实红 2026-09-20）
    backend.notify('缺子命令。\n/doors list | open | close\n  list 用法甲\n  open 用法乙');
    io.bytes = '';
    backend.notify('后继行');
    // 光标归位在编辑声明位（行 7）：gotoRow 的 CUU 距离 = 7 - 追加位行号。
    // 物理真相 = 回执末行行 3 → 追加位行 4 → CUU 3；漂账形 = 追加位行 1 → CUU 6
    expect(io.bytes).toContain('\x1b[3A\r· 后继行\n');
    expect(io.bytes).not.toContain('\x1b[6A\r· 后继行\n');
  });

  it('onRepaint：投影重建 + 清屏全量重写', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '旧问题', timestamp: 1 } });
    io.bytes = '';
    backend.onRepaint(SESSION, [{ role: 'user', content: '投影问题', timestamp: 1 }], null);
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\r> 投影问题\n');
    expect(io.bytes).not.toContain('旧问题');
  });

  it('resize 自订阅：emitResize → 清屏 + 新几何滚动区 + 重画', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '内容', timestamp: 1 } });
    io.columns = 40;
    io.rows = 6;
    io.bytes = '';
    io.emitResize();
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;2r'); // 6 行 - 固定区 4 = DECSTBM 1..2
    expect(io.bytes).toContain('\r> 内容\n'); // 行集重画
  });
});

/* ================= 批 10e-2 交互纵切（手动时钟 rig） ================= */

/** 手动时钟（渲染合并/tick 自驱/ESC 判定窗的确定性驱动） */
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

/** 装配柄调用记录 */
interface RigCalls {
  submitted: [sessionId: string, text: string][];
  interrupted: string[];
  quit: number;
  dispatched: string[];
}

/** 交互 rig：注入调度 + 高 fps 帧帽（帧间隔 ~0——advance 即泵帧）；rows 可调（overlay+弹层并陈的量高场景需高窗） */
function makeInteractive(options: Partial<TuiBackendOptions> = {}, rows: number = ROWS) {
  const io = new MemoryTerminalIO(COLS, rows);
  const clock = new ManualClock();
  const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
  const backend = new TuiBackend(io, {
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    now: clock.now,
    fpsCap: 1e6, // 帧间隔 ~0——advance 窗内帧随窗落地
    sessionId: 's1',
    onSubmit: (sessionId, text) => calls.submitted.push([sessionId, text]),
    onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
    onQuit: () => {
      calls.quit += 1;
    },
    ...options,
  });
  backend.start();
  io.bytes = ''; // start 编舞字节不计入交互断言
  return { io, backend, clock, calls, pump: () => clock.advance(1) };
}

/** lone-ESC 判定窗推进（缺省 30ms 窗——advance 顺带泵掉窗内到期帧） */
const escapePump = (clock: ManualClock): void => clock.advance(31);

describe('TuiBackend 输入管线（自持——不经 Engine）', () => {
  it('字符键入 → 编辑器收字 + 光标声明落位；enter → onSubmit(sessionId, text)', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('hi');
    pump();
    expect(io.bytes).toContain('hi'); // 编辑器框内文本
    expect(io.bytes.endsWith('\x1b[8;4H')).toBe(true); // 光标声明（文尾——固定区垫 6 + 内缩 1 + 文宽 2）
    expect(calls.submitted).toEqual([]);
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([['s1', 'hi']]);
  });

  it('stop：出屏模式串反序 + raw 复原 + 停后帧静默', () => {
    const { io, backend, pump } = makeInteractive();
    backend.stop();
    expect(io.bytes).toContain('\x1b[<u'); // kitty 弹栈
    expect(io.bytes).toContain('\x1b[?2004l'); // 粘贴关
    expect(io.raw).toBe(false); // raw 复原先验态
    io.bytes = '';
    backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    pump();
    expect(io.bytes).toBe(''); // 停后渲染请求静默短路
  });

  it('ctrl+c → onInterrupt 连按计次；ctrl+d 空框 → onQuit', () => {
    const { io, calls } = makeInteractive();
    io.emitInput('\x03');
    io.emitInput('\x03');
    expect(calls.interrupted).toEqual(['s1', 's1']);
    io.emitInput('\x04');
    expect(calls.quit).toBe(1);
  });

  it('ctrl+d 有文不退出（编辑器吞）；overlay 在场也不退出（面板吞）', async () => {
    const first = makeInteractive();
    first.io.emitInput('ab');
    first.pump();
    first.io.emitInput('\x04'); // 光标在文尾——delete forward 无事
    expect(first.calls.quit).toBe(0);

    const second = makeInteractive();
    const p = second.backend.confirm('做吗？');
    second.pump();
    second.io.emitInput('\x04'); // overlay 占焦吞键
    expect(second.calls.quit).toBe(0);
    second.io.emitInput('\r'); // 面板应答——层关
    second.pump();
    await expect(p).resolves.toBe(true);
  });

  it('overlay 模态独占：占焦期字母键不入编辑器，应答后恢复', async () => {
    const { io, backend, pump } = makeInteractive();
    const p = backend.confirm('确认？');
    pump();
    io.emitInput('abc'); // 面板吞——编辑框零扰动
    pump();
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe(true);
    io.bytes = '';
    io.emitInput('b');
    pump();
    expect(io.bytes).toContain('b'); // 层关后键回编辑器
  });
});

describe('TuiBackend 提交路由', () => {
  it("'/cmd' → dispatchCommand 柄；false → onSubmit 兜底 / true → 不落", async () => {
    let handled = false;
    const { io, calls, pump } = makeInteractive({
      dispatchCommand: async (input) => {
        calls.dispatched.push(input);
        return handled;
      },
    });
    io.emitInput('/help\r');
    pump();
    await Promise.resolve(); // 微任务排空（dispatch 异步链）
    expect(calls.dispatched).toEqual(['/help']);
    expect(calls.submitted).toEqual([['s1', '/help']]); // false → 兜底

    handled = true;
    io.emitInput('/x\r');
    pump();
    await Promise.resolve();
    expect(calls.dispatched).toEqual(['/help', '/x']);
    expect(calls.submitted).toHaveLength(1); // true → 不落 onSubmit
  });

  it('命令处理器异常 → notify error 兜底（不崩不静默）', async () => {
    const { io, pump } = makeInteractive({
      dispatchCommand: async () => {
        throw new Error('炸了');
      },
    });
    io.emitInput('/boom\r');
    pump();
    await Promise.resolve();
    await Promise.resolve(); // rejection 链两回合（then 折传递 + catch）
    pump();
    expect(io.bytes).toContain('✖ 命令异常'); // error 档符号 + 兜底文案
  });

  it("'/exit' // '/quit' 恰零参 → onQuit（先于通道命令分发终局，不落 onSubmit）", () => {
    const { io, calls, pump } = makeInteractive({
      dispatchCommand: async (input) => {
        calls.dispatched.push(input);
        return true;
      },
    });
    io.emitInput('/exit\r');
    pump();
    expect(calls.quit).toBe(1);
    expect(calls.dispatched).toEqual([]); // 退出词先于 dispatchCommand——不进通道命令面
    expect(calls.submitted).toEqual([]); // 前端生命周期词永不兜底进模型消息
    io.emitInput('/quit\r');
    pump();
    expect(calls.quit).toBe(2); // 别名同路
  });

  it('带参形 /exit xxx → warn 用法提示不退出；尾随空白 trim 后恰命中仍退出', () => {
    const { io, calls, pump } = makeInteractive();
    io.emitInput('/exit now\r');
    pump();
    expect(io.bytes).toContain('⚠'); // warn 档符号（用法 fail-loud）
    expect(calls.quit).toBe(0);
    expect(calls.submitted).toEqual([]); // 带参形也终局消费——不兜底
    io.emitInput('/exit  \r');
    pump();
    expect(calls.quit).toBe(1); // trim 后恰 '/exit'——退出
  });

  it('input-ask 接管窗 /exit 是应答非命令（既有裁决——退出词此窗不拦）', async () => {
    const { io, backend, calls, pump } = makeInteractive();
    const p = backend.input('填啥？');
    pump();
    io.emitInput('/exit\r'); // ask 接管窗内提交 '/exit'——应答车
    pump();
    await expect(p).resolves.toBe('/exit'); // '/exit' 作为应答原文回填
    expect(calls.quit).toBe(0); // 不退出
  });

  it('onQuit 柄缺席 → 诚实拒提示（不虚报律——不退出不兜底）', () => {
    const { io, calls, pump } = makeInteractive({ onQuit: undefined });
    io.emitInput('/exit\r');
    pump();
    expect(io.bytes).toContain('不支持退出命令'); // 诚实拒
    expect(calls.quit).toBe(0);
    expect(calls.submitted).toEqual([]);
  });
});

describe('TuiBackend 补全弹层（三源路由）', () => {
  /** 补全防抖窗泵（R6 批 10j——20ms 尾沿）：推过窗位使查询落层 */
  const completePump = (clock: { advance: (ms: number) => void }): void => {
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1);
  };

  /** 命令名 + 参数段双源记录 rig */
  function autocompleteRig() {
    const argCalls: [string, string][] = [];
    const rig = makeInteractive({
      autocomplete: {
        commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
        commandArguments: (command, query) => {
          argCalls.push([command, query]);
          return query === 'ar' ? [{ label: 'arg1', replacement: 'arg1 ' }] : [];
        },
      },
    });
    return { ...rig, argCalls };
  }

  it("'/' 起手弹层在场 → tab 整 token 代换 → escape 关层", () => {
    const { io, clock, calls } = autocompleteRig();
    io.emitInput('/he');
    completePump(clock); // 防抖窗到——查询落层弹层在场（R6：尾沿 20ms 后交付）
    expect(io.bytes).toContain('/help'); // 弹层 label 在场
    expect(io.bytes).toContain('帮助'); // detail 右对齐段
    io.emitInput('\t'); // 应用代换
    clock.advance(1);
    io.emitInput('\r'); // 提交代换后命令
    clock.advance(1);
    expect(calls.submitted).toEqual([['s1', '/help']]); // 命令柄缺席——'/' 文本落 onSubmit（trim 后）
    io.bytes = '';
    io.emitInput('\x1b'); // escape 关层（新轮）
    escapePump(clock);
    expect(io.bytes).not.toContain('帮助'); // 弹层已隐
  });

  it('命令名已终结 → 参数段源路由（commandArguments 收命令名与 query）', () => {
    const { io, clock, argCalls } = autocompleteRig();
    io.emitInput('/help ');
    io.emitInput('ar');
    completePump(clock); // 防抖窗到——连打两 chunk 收敛为单查（尾沿律）
    expect(argCalls).toEqual([['help', 'ar']]);
    expect(io.bytes).toContain('arg1');
  });

  it('input-ask 在飞 → 弹层抑制（应答优先）', async () => {
    const { io, backend, pump } = autocompleteRig();
    const p = backend.input('补充说明？');
    pump();
    io.emitInput('/he'); // 应答期键入——补全不开层
    pump();
    expect(io.bytes).not.toContain('帮助');
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('/he'); // 应答原样落 promise
  });

  // —— ask 浮层开层收补全弹层（2026-09-20 TUI 视觉品质战役·组 2 修前红）：
  // input() 路既做「应答期弹层抑制」（cancel + applyResult(null)——tui-backend
  // 码内注释明言），confirm/select/askApproval 三路共用 openAskLayer 却无此
  // 收口——修前形：弹层死显残留 overlay 段之下（overlay 模态独占收键不可
  // 交互），且连打后在途查询迟到仍会刷新死弹层 ——

  it('ask 浮层开层收在场弹层：confirm 开层即刻收层（修前死显残留红）', async () => {
    const { io, backend, clock, pump } = autocompleteRig();
    io.emitInput('/he');
    completePump(clock); // 防抖窗到——弹层在场（'/help' + detail '帮助'）
    expect(io.bytes).toContain('帮助');
    io.bytes = '';
    const p = backend.confirm('做吗？');
    pump();
    expect(io.bytes).toContain('做吗？'); // 浮层面板在场
    expect(io.bytes).not.toContain('帮助'); // 修前红：弹层未被收——死显在 overlay 段之下
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe(true);
  });

  it('ask 浮层开层撤防抖窗：连打后开层的在途查询不落层（askApproval——修前窗内 fire 落层红）', async () => {
    // rows 加高：审批面板（5 行）+ 弹层（1）+ 编辑器（3）+ 状态行（1）在 10 行
    // 窗会触发牺牲梯隐弹层——量高并陈需 14 行窗（预算 13）才呈修前坏形
    const { io, backend, clock, pump } = makeInteractive(
      {
        autocomplete: {
          commands: (query) => (query === 'he' ? [{ label: '/help', detail: '帮助', replacement: '/help ' }] : []),
        },
      },
      14,
    );
    io.emitInput('/he'); // 防抖窗已排（20ms 尾沿）——弹层未开
    const p = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    completePump(clock); // 推过窗位——修前：窗内 fire 落层，弹层死显 overlay 段下
    expect(io.bytes).toContain('⚙ write：写文件'); // 浮层标题在场
    expect(io.bytes).not.toContain('帮助'); // 修前红：开层不撤窗——在途查询迟到落层
    io.emitInput('\r');
    pump();
    await expect(p).resolves.toBe('approve');
  });

  // —— escape 关层联动收防抖窗（组 2 修前红）：popup 消费 escape 关本轮但
  // 不触 completer.cancel——20ms 防抖窗内在途/已排查询迟到 fire 会把刚关的
  // 弹层重开（建议框「闪回」，与 popup「关本轮」注释意图相悖）。kitty 轨
  // `\x1b[27u` escape 即达即决（生产主轨——backend 进屏推 kitty 协议），迟到
  // fire 与关层的时序在手动钟下确定可演 ——

  it('escape 关层撤防抖窗：窗内迟到 fire 不重开弹层（修前「闪回」红）', () => {
    // sticky 源：'/he'、'/hel' 前缀均有候选——迟到 fire 携非空结果才能重开弹层
    const { io, clock } = makeInteractive({
      autocomplete: {
        commands: (query) =>
          ['/help', '/hello']
            .filter((name) => name.slice(1).startsWith(query))
            .map((name) => ({ label: name, detail: '帮助', replacement: `${name} ` })),
      },
    });
    io.emitInput('/he');
    completePump(clock); // 弹层在场（两候选）
    io.bytes = ''; // 首开弹层帧字节不计——聚焦 escape 关层后的窗内迟到 fire
    io.emitInput('l'); // 连打——防抖窗重置（弹层持上轮 result 仍可见）
    io.emitInput('\x1b[27u'); // kitty 轨 escape：即达即决——popup 消费关本轮
    clock.advance(1); // 泵掉关层帧
    expect(io.bytes).not.toContain('帮助'); // 关层成立（本轮锚）
    io.bytes = ''; // 关层帧字节不计——聚焦窗内迟到 fire
    clock.advance(AUTOCOMPLETE_DEBOUNCE_MS + 1); // 推过防抖窗——修前窗内 fire 重开弹层
    expect(io.bytes).not.toContain('帮助'); // 修前红：迟到 fire → onResult → 弹层重开
  });
});

describe('TuiBackend 阻塞四件（浮层面板呈现）', () => {
  it('confirm：enter → true / esc → false / signal abort → false + 层关', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const p1 = backend.confirm('一？');
    pump();
    expect(io.bytes).toContain('一？');
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe(true);

    const p2 = backend.confirm('二？');
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p2).resolves.toBe(false);

    const ac = new AbortController();
    const p3 = backend.confirm('三？', { signal: ac.signal });
    pump();
    ac.abort();
    await expect(p3).resolves.toBe(false); // 败腿撤销保守值
    io.bytes = '';
    io.emitInput('x'); // 层已关——键回编辑器
    pump();
    expect(io.bytes).toContain('x');
  });

  it('select：enter 高亮项 / ↓ 换选 / esc → 空串 / abort → 空串', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const choices = [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙' },
    ];
    const p1 = backend.select('选', choices);
    pump();
    io.emitInput('\r');
    pump();
    await expect(p1).resolves.toBe('a');

    const p2 = backend.select('再选', choices);
    pump();
    io.emitInput('\x1b[B'); // ↓（CSI 序列——legacy 单 chunk）
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('b');

    const p3 = backend.select('三', choices);
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p3).resolves.toBe('');

    const ac = new AbortController();
    const p4 = backend.select('四', choices, { signal: ac.signal });
    pump();
    ac.abort();
    await expect(p4).resolves.toBe('');
  });

  it('approval：四值映射 + esc → cancel + 工具名标题与草案 hint 在场', async () => {
    const { io, backend, clock, pump } = makeInteractive();
    const p1 = backend.askApproval('s1', { summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    expect(io.bytes).toContain('⚙ write：写文件'); // 工具名标题
    expect(io.bytes).toContain('/tmp/x'); // always 草案 hint 段
    io.emitInput('\r'); // 高亮首项 = 批准
    pump();
    await expect(p1).resolves.toBe('approve');

    const p2 = backend.askApproval('s1', { summary: '二' });
    pump();
    io.emitInput('\x1b[B\x1b[B'); // ↓↓ = 总是批准
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('always');

    const p3 = backend.askApproval('s1', { summary: '三' });
    pump();
    io.emitInput('\x1b');
    escapePump(clock);
    await expect(p3).resolves.toBe('cancel'); // Esc 面板保守值映射 cancel
  });

  it('input：提示行在场 → 提交应答；abort → 空串 + 残稿清框', async () => {
    const { io, backend, calls, pump } = makeInteractive();
    const p1 = backend.input('名字？');
    pump();
    expect(io.bytes).toContain('? 名字？'); // 提示行
    io.emitInput('berry\r');
    pump();
    await expect(p1).resolves.toBe('berry');
    expect(calls.submitted).toEqual([]); // 应答不落 onSubmit
    io.bytes = '';
    pump();
    expect(io.bytes).not.toContain('名字？'); // 提示行已撤

    const ac = new AbortController();
    const p2 = backend.input('补充？', { signal: ac.signal });
    pump();
    io.emitInput('残稿'); // 中途输入
    pump();
    ac.abort();
    await expect(p2).resolves.toBe('');
    io.emitInput('x\r'); // 残稿已清——框内只有 x
    pump();
    expect(calls.submitted).toEqual([['s1', 'x']]);
  });

  it('overlay 占焦期编辑器非聚焦：边框无 accent + 光标回退屏底', async () => {
    const { io, backend, pump } = makeInteractive();
    io.emitInput('a');
    pump(); // 有变更才有帧——差分只重写内容行：聚焦 accent 侧边框在场
    expect(io.bytes).toContain('\x1b[36m│');
    const p = backend.confirm('占焦？');
    io.bytes = '';
    pump();
    expect(io.bytes).not.toContain('\x1b[36m│'); // 非聚焦普通边框（面板标题 accent 是文本段不撞侧框）
    expect(io.bytes.endsWith('\x1b[10;1H')).toBe(true); // 无光标声明回退屏底
    io.emitInput('\r');
    io.bytes = '';
    pump();
    await expect(p).resolves.toBe(true);
    expect(io.bytes).toContain('\x1b[36m│'); // 层关复聚焦
  });
});

describe('TuiBackend ask 撤销说明行（07 §4.3 撤销面——曾在屏者 ⏹ 行 + 迟到 abort 不误写）', () => {
  it('confirm：abort → false + 撤销说明行；面板已 done 后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    // 路一：外部 abort 传播到时层仍在屏——说明行入正文流
    const ac1 = new AbortController();
    const p1 = backend.confirm('一？', { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe(false); // 保守值
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消确认\n'); // 撤销说明行（瞬时行形态）

    // 路二：Enter 应答收场（面板 done）后 abort 迟到——零说明行
    const ac2 = new AbortController();
    const p2 = backend.confirm('二？', { signal: ac2.signal });
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe(true);
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹'); // 不误写
  });

  it('select：abort → 空串 + 撤销说明行；已选定后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const choices = [{ value: 'a', label: '甲' }];
    const ac1 = new AbortController();
    const p1 = backend.select('选', choices, { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe('');
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消选择\n');

    const ac2 = new AbortController();
    const p2 = backend.select('再选', choices, { signal: ac2.signal });
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('a');
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹');
  });

  it('approval：abort → cancel + 撤销说明行（文案区分于阻塞三件）；已答后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac1 = new AbortController();
    const p1 = backend.askApproval('s1', { summary: '写' }, { signal: ac1.signal });
    pump();
    ac1.abort();
    await expect(p1).resolves.toBe('cancel'); // 审批项保守值（收口三则同源条款）
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消审批\n'); // 「审批」文案与提问/确认/选择分立

    const ac2 = new AbortController();
    const p2 = backend.askApproval('s1', { summary: '二' }, { signal: ac2.signal });
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('approve');
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹');
  });

  it('input：abort → 空串 + 撤销说明行；inputAsk 已换（应答收场）后迟到 abort 不误写', async () => {
    const { io, backend, pump } = makeInteractive();
    const ac1 = new AbortController();
    const p1 = backend.input('名字？', { signal: ac1.signal });
    pump();
    expect(io.bytes).toContain('? 名字？'); // 提示行曾在屏
    io.emitInput('草稿');
    pump();
    io.bytes = ''; // 应答期帧不计入撤销断言
    ac1.abort();
    await expect(p1).resolves.toBe('');
    pump();
    expect(io.bytes).toContain('\r⏹ 已取消提问\n');
    expect(io.bytes).not.toContain('? 名字？'); // 提示行已撤

    // inputAsk 已换（新 ask 顶上）后旧 signal abort——不误写、不打扰新 ask
    const ac2 = new AbortController();
    const p2 = backend.input('补充？', { signal: ac2.signal });
    pump();
    io.emitInput('答\r'); // 应答收场（inputAsk → null）
    pump();
    await expect(p2).resolves.toBe('答');
    io.bytes = '';
    ac2.abort();
    pump();
    expect(io.bytes).not.toContain('⏹');
  });
});

describe('TuiBackend 渲染合并与 tick 自驱', () => {
  it('帧合并：多事件一帧落地（pump 前零写出）', () => {
    const rig = makeInteractive();
    rig.backend.onEnvelope(
      { sessionId: 's1', event: { type: 'message_end', message: { role: 'user', content: '问一', timestamp: 1 } } },
      true,
    );
    rig.backend.onEnvelope(
      { sessionId: 's1', event: { type: 'message_end', message: { role: 'user', content: '问二', timestamp: 2 } } },
      true,
    );
    expect(rig.io.bytes).toBe(''); // 未泵——零写出（合并位）
    rig.pump();
    expect(rig.io.bytes).toContain('问一');
    expect(rig.io.bytes).toContain('问二');
  });

  it('transient 到达序保持（present 与 transient 交错）', () => {
    const rig = makeInteractive();
    const user = (text: string, ts: number) =>
      rig.backend.onEnvelope(
        { sessionId: 's1', event: { type: 'message_end', message: { role: 'user', content: text, timestamp: ts } } },
        true,
      );
    user('问一', 1);
    rig.backend.notify('通知', { level: 'info' });
    user('问二', 2);
    rig.pump();
    const bytes = rig.io.bytes;
    expect(bytes.indexOf('问一')).toBeLessThan(bytes.indexOf('· 通知'));
    expect(bytes.indexOf('· 通知')).toBeLessThan(bytes.indexOf('问二'));
  });

  it('transient 让位流式槽：槽在场缓冲、定稿关槽帧补吐（批 10k 遗漏修——瞬时行不嵌入槽首行位）', () => {
    const rig = makeInteractive();
    emit(rig.backend, { type: 'message_start', role: 'assistant' });
    emit(rig.backend, { type: 'message_update', role: 'assistant', partial: assistantMsg('流式中') });
    rig.pump();
    rig.io.bytes = '';
    // 槽在场瞬时行（notify）：直写会落槽首行位（gotoRow(durableEndRow) 起笔
    // ——嵌入槽内破槽形）——缓冲不落屏
    rig.backend.notify('槽期通知', { level: 'info' });
    rig.pump();
    expect(rig.io.bytes).not.toContain('槽期通知');
    // 定稿关槽 → 缓冲补吐在定稿块之后（到达序保持）
    emit(rig.backend, { type: 'message_end', message: assistantMsg('定稿') });
    rig.pump();
    expect(rig.io.bytes).toContain('定稿');
    expect(rig.io.bytes).toContain('槽期通知');
    expect(rig.io.bytes.indexOf('定稿')).toBeLessThan(rig.io.bytes.indexOf('槽期通知'));
  });

  it('编辑器键位覆盖注入（批 10k 遗漏修——keymap 装配位缺注）', () => {
    const { io, calls, clock, pump } = makeInteractive({
      keybindings: { 'editor.new-line': 'alt+j' }, // 换行键改 alt+j——ctrl+j 缺省位让位
    });
    // 键序可区分：alt+j 在前（覆盖生效 = 换行；缺注缺省册 = 无动作）、
    // ctrl+j 在后（覆盖生效 = 无动作；缺省册 = 换行）——两态提交文互异
    io.emitInput('a');
    io.emitInput('\x1bj'); // alt+j（legacy ESC 前缀形）——覆盖后的换行位
    escapePump(clock); // lone-ESC 判定窗推进（ESC j 二义性收束）
    io.emitInput('b');
    io.emitInput('\x0a'); // ctrl+j——覆盖后不再换行
    io.emitInput('\r');
    pump();
    expect(calls.submitted).toEqual([['s1', 'a\nb']]); // alt+j 换行生效、ctrl+j 未换（缺注态为 'ab'）
  });

  it('tick 自驱：忙态转轮推帧、闲态零写出、stop 后静默', () => {
    const rig = makeInteractive();
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    rig.pump();
    rig.io.bytes = '';
    rig.clock.advance(100); // tick 窗到——推第二帧
    expect(rig.io.bytes).toContain('⠙');
    rig.clock.advance(100);
    expect(rig.io.bytes).toContain('⠹'); // 第三帧（转轮帧序 ⠋⠙⠹——推进有据）
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_end', status: 'completed' } }, true);
    rig.pump();
    rig.io.bytes = '';
    rig.clock.advance(300); // 闲态——tick 零写出
    expect(rig.io.bytes).toBe('');
    rig.backend.stop();
    rig.io.bytes = '';
    rig.clock.advance(300); // stop 后定时器全收
    expect(rig.io.bytes).toBe('');
  });
});

/* ================= 呈现面件 4/5/6（todo 面板 / 工具进度 / usage 状态行） ================= */

/** 定制 usage 的 assistant 消息（件 6 累加数据源） */
function usageMsg(totalTokens: number): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '答' }],
    usage: { input: totalTokens - 50, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens },
    stopReason: 'stop',
    timestamp: 1,
  };
}

describe('TuiBackend todo 面板（件 4）', () => {
  it('todoFor 注入：tool_execution_end 写后即显 + agent_end 刷新 + 空表清板', () => {
    let todos: { status: 'pending' | 'in-progress' | 'completed'; content: string; activeForm?: string }[] = [
      { status: 'pending', content: '写规范' },
      { status: 'in-progress', content: '码实现', activeForm: '正在码实现' },
    ];
    const { io, backend } = makeBackend({ todoFor: () => todos });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(io.bytes).toContain('☐ 写规范'); // 写后即显（刷新三时点之二）
    expect(io.bytes).toContain('◐ 正在码实现'); // activeForm 优先
    todos = [{ status: 'completed', content: '写规范' }]; // 快照推进（工具跑完 todo 完成）
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('☑ 写规范'); // 刷新三时点之三——拉到新快照（行级差分写变行）
    expect(io.bytes).not.toContain('\x1b[1;6r'); // 固定区高未变——零滚动区重设
  });

  it('空表清板（null 与 [] 同义——面板退场）', () => {
    let todos: { status: 'pending'; content: string }[] | null = [{ status: 'pending', content: '任务' }];
    const { io, backend } = makeBackend({ todoFor: () => todos });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('☐ 任务');
    todos = [];
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('\x1b[1;6r'); // 固定区高回缩——滚动区重设在场
    expect(io.bytes).not.toContain('☐ 任务');
  });

  it('todoFor 注入缺席 = 面板缺席零变化', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(io.bytes).not.toContain('☐');
  });
});

describe('TuiBackend 工具进度面板（件 5）', () => {
  it('update 建行（宽容解码）/ 原位换行 / end 摘行 / agent_end 清板', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_update', toolCallId: 't1', update: '扫描中' });
    expect(io.bytes).toContain('▸ grep · 扫描中'); // 首个 update 建行
    io.bytes = '';
    emit(backend, {
      type: 'tool_execution_update',
      toolCallId: 't1',
      update: { content: [{ type: 'text', text: '头部\n\n命中 3 处\n' }] },
    });
    expect(io.bytes).toContain('▸ grep · 命中 3 处'); // 倒扫末条非空行
    io.bytes = '';
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    expect(io.bytes).not.toContain('▸ grep'); // end 即摘行

    emit(backend, { type: 'tool_execution_start', toolCallId: 't2', name: 'read', arguments: {} });
    emit(backend, { type: 'tool_execution_update', toolCallId: 't2', update: '读着' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('▸ read'); // agent_end 清板（瞬时面）
  });

  it('start 只建档不建行（面板零扰动）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    io.bytes = '';
    emit(backend, { type: 'tool_execution_start', toolCallId: 't1', name: 'grep', arguments: {} });
    expect(io.bytes).not.toContain('▸ grep'); // 建档无行——工具名只进状态行
    expect(io.bytes).toContain('⚙ grep …');
  });
});

describe('TuiBackend usage 状态行（件 6）', () => {
  it('message_end 暂存 → turn_end 累加 → agent_end 落「✓ 用量 N」', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(150) });
    io.bytes = '';
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    expect(io.bytes).not.toContain('用量'); // turn_end 是累加时点非呈现时点
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 150');
  });

  it('多轮累加 + 千位分组', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(1_500) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    emit(backend, { type: 'message_end', message: usageMsg(2_500) });
    emit(backend, { type: 'turn_end', turn: 2, stopReason: 'stop' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 4,000');
  });

  it('agent_start 归零清行（上一 run 尾注不跨 run）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(150) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 150');
    io.bytes = '';
    emit(backend, { type: 'agent_start' });
    expect(io.bytes).not.toContain('用量'); // 清行（忙态呈现转轮——尾注退场）
    emit(backend, { type: 'message_end', message: usageMsg(10) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).toContain('✓ 用量 10'); // 归零重计（非 160）
  });

  it('repaint 清行并归零（切焦清账重计——件 6 尾注射界）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, { type: 'message_end', message: usageMsg(150) });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    backend.onRepaint(SESSION, [], null);
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('✓ 用量 150');
    expect(io.bytes).toContain('✓ 用量 0'); // 清账重计（零轮 run 亦如实呈现）
  });

  it('cost 在场并累货币额（usageView 观测面）', () => {
    const { backend } = makeBackend();
    emit(backend, { type: 'agent_start' });
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '答' }],
        usage: {
          input: 50,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 100,
          cost: { total: 0.03, currency: 'USD' },
        },
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    expect(backend.usageView).toEqual({
      input: 50,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100,
      cost: 0.03,
      currency: 'USD',
    });
  });

  it('非聚焦事件不驱动 usage 累计（尾注只属聚焦会话）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: usageMsg(150) }, false);
    emit(backend, { type: 'turn_end', turn: 1, stopReason: 'stop' }, false);
    io.bytes = '';
    emit(backend, { type: 'agent_end', status: 'completed' });
    expect(io.bytes).not.toContain('✓ 用量 150');
  });
});

/* ================= 呈现面件 7（终端外显 OSC） ================= */

describe('TuiBackend 终端外显（件 7）', () => {
  it('起屏基线 title：version 缺席 = 裸名 / 注入 = berry-agent <版本> / 空串同缺席', () => {
    const bare = makeBackend();
    expect(bare.io.frames).toContain(oscTitle('berry-agent'));
    const versioned = makeBackend({ version: '1.2.3' });
    expect(versioned.io.frames).toContain(oscTitle('berry-agent 1.2.3'));
    // 空串边角回归锁（修复前必红）：`berry-agent ` 尾随空格脏基线
    const empty = makeBackend({ version: '' });
    expect(empty.io.frames).toContain(oscTitle('berry-agent'));
    expect(empty.io.frames).not.toContain(oscTitle('berry-agent '));
  });

  it('按会话净计数忙态：任一会话在飞即忙——并存不清零（终端标签页注意力模型）', () => {
    const { io, backend } = makeBackend();
    const env = (sessionId: string, event: AgentEvent, focused: boolean): void => {
      backend.onEnvelope({ sessionId, event }, focused);
    };
    env('sess-a', { type: 'agent_start' }, true); // 会话 A 起（聚焦位）——忙
    expect(io.bytes).toContain(PROGRESS_ACTIVE);
    io.bytes = '';
    env('sess-b', { type: 'agent_start' }, false); // 会话 B 起（非聚焦位）——仍忙零迁移写出
    expect(io.bytes).not.toContain(PROGRESS_ACTIVE);
    io.bytes = '';
    env('sess-a', { type: 'agent_end', status: 'completed' }, false); // A 落——B 仍在飞
    expect(io.bytes).not.toContain(PROGRESS_CLEAR);
    io.bytes = '';
    env('sess-b', { type: 'agent_end', status: 'completed' }, true); // 末路落——清零
    expect(io.bytes).toContain(PROGRESS_CLEAR);
  });

  it('切焦跨路回归锁：聚焦起 + 非聚焦收（run 跨切焦）——归闲 + 保活停针', () => {
    const rig = makeInteractive();
    // 会话 s1 聚焦时起 run（事件时刻 focused=true）
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    rig.pump();
    expect(rig.io.bytes).toContain(PROGRESS_ACTIVE); // 起——忙
    // 用户切焦会话 s2（repaint 不清在飞账——在飞事实与焦点正交）
    rig.backend.onRepaint('s2', [], null);
    // s1 的 run 在非聚焦位收尾（事件时刻 focused=false——按事件时刻聚焦位分两路时
    // end 减非聚焦路被 clamp 吞、聚焦路残 1 永忙；按 sessionId 归账恒落同一会话账）
    rig.io.bytes = '';
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_end', status: 'completed' } }, false);
    rig.pump();
    expect(rig.io.bytes).toContain(PROGRESS_CLEAR); // 实际无会话在飞——归闲（修复前必红：永忙零写出）
    rig.io.bytes = '';
    const activeCount = (): number => rig.io.frames.filter((f) => f === PROGRESS_ACTIVE).length;
    const sealed = activeCount(); // 归闲时刻封账（修复前永续——advance 后账目增长）
    rig.clock.advance(3000); // 保活停针——归闲后零重发（状态行转轮是件 3 聚焦路面——非聚焦 end 不收其转，转轮字节与本锚无关）
    expect(activeCount()).toBe(sealed);
  });

  it('重复 end 不穿底（clamp ≥ 0——净计数不越零，再 start 即忙）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'agent_start' }, true);
    emit(backend, { type: 'agent_end', status: 'completed' }, true);
    emit(backend, { type: 'agent_end', status: 'completed' }, true); // 重复 end ×2
    io.bytes = '';
    emit(backend, { type: 'agent_start' }, true); // clamp 下 0→1 即忙（无 clamp 则 -1 不忙）
    expect(io.bytes).toContain(PROGRESS_ACTIVE);
  });

  it('onRepaint：title 点缀会话短 id（基线 · 短id）', () => {
    const { io, backend } = makeBackend();
    io.bytes = '';
    backend.onRepaint(SESSION, [], null);
    expect(io.bytes).toContain(oscTitle('berry-agent · sess-aaa'));
  });

  it('stop：复原两写点（title 复原基线 + 进度清零）', () => {
    const { io, backend } = makeBackend({ version: '0.9.0' });
    emit(backend, { type: 'agent_start' }, true); // 忙态在飞
    backend.onRepaint(SESSION, [], null); // title 已点缀短 id
    io.bytes = '';
    backend.stop();
    expect(io.bytes).toContain(oscTitle('berry-agent 0.9.0')); // 写点一：title 复原基线
    expect(io.bytes).toContain(PROGRESS_CLEAR); // 写点二：进度清零
  });

  it('忙态保活：注入调度下 1000ms 周期重发 + stop 停针后零重发', () => {
    const rig = makeInteractive();
    rig.backend.onEnvelope({ sessionId: 's1', event: { type: 'agent_start' } }, true);
    rig.pump();
    const activeCount = (): number => rig.io.frames.filter((f) => f === PROGRESS_ACTIVE).length;
    const before = activeCount(); // 首写在账（frames 累积不随 bytes 重置清零）
    expect(before).toBe(1);
    rig.clock.advance(3000); // 三个保活窗——恰三次重发（单链不叠针）
    expect(activeCount() - before).toBe(3);
    rig.backend.stop(); // 复原两写点 + 保活停针（cancelTimer 名册语义）
    rig.io.bytes = '';
    rig.clock.advance(3000); // 停针后零重发
    expect(rig.io.bytes).toBe('');
    expect(activeCount() - before).toBe(3); // 停针封账——无新 ACTIVE
  });
});

/* ================= 主屏挂起面（批 10f-4——AltScreenPrimary 交出面） ================= */

/** 主屏形出 / 进屏模式串（tui-backend 单源常量的字节真源——对称反序互证锚） */
const MAIN_LEAVE = '\x1b[<u\x1b[?2004l';
const MAIN_ENTER = '\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c';
/** 副屏 Engine 进出屏字节（集成测试序锚） */
const ALT_ENTER = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[>1u\x1b[?u\x1b[c\x1b[?1002h\x1b[?1006h'; // 鼠标准入尾随（mu-2）
const ALT_LEAVE = '\x1b[?1006l\x1b[?1002l\x1b[<u\x1b[?2004l\x1b[?25h\x1b[?1049l'; // 鼠标关停前置（对称反序）

/** 副屏内容替身（集成测试——写文 + 事件终局吞掉） */
function altLayer(text: string): OverlayContent {
  return {
    measure: () => 1,
    render: (buffer, region) => {
      buffer.writeText(region.row, region.col, text);
    },
    handleEvent: () => true,
  };
}

describe('TuiBackend 主屏挂起面（suspendMain / resumeMain——批 10f-4）', () => {
  it('suspendMain 编舞：出屏串 + 停流 + 换防恒 raw + 卸输入监听 + lifecycle 迁移', () => {
    const { io, backend } = makeBackend();
    expect(backend.lifecycle).toBe('running');
    io.reset();
    backend.suspendMain();
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 出屏模式串（与 start 进屏对称反序）
    expect(io.pauseCount).toBe(1); // 停流（共享 io 换防——副屏随后 start 放流）
    // 换防恒 raw（2026-09-20 DA1 回显泄漏批）：不复先验——副屏同 tick 接管，
    // 关 raw 只开内核 ECHO 窗（挂起瞬间在途应答/连击被 ECHOCTL 回显上屏）；
    // 「raw 复先验」射程 = 交终端给子进程的挂起形（07 篇交出面条款换防例外注）
    expect(io.raw).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    io.reset();
    io.emitInput('x'); // 输入已卸订——编辑器不经手（无 echo 字节）
    expect(io.bytes).toBe('');
  });

  it('进屏 raw 先行：start / resumeMain 进屏串（含探测）写出前 raw 已设——应答永不落 ECHO 窗', () => {
    const { io, backend } = makeBackend();
    // start 段：ENTER_MAIN（含 DA1 探测）与 OSC 11 查询都在 raw 之后写出
    expect(io.ops.indexOf('raw:true')).toBeGreaterThanOrEqual(0);
    expect(io.ops.indexOf('raw:true')).toBeLessThan(io.ops.indexOf('write'));
    backend.suspendMain();
    io.reset();
    backend.resumeMain();
    // resumeMain 段同律（ENTER_MAIN 重发 + OSC 11 重查——应答竞速同受庇护）
    expect(io.ops.indexOf('raw:true')).toBeGreaterThanOrEqual(0);
    expect(io.ops.indexOf('raw:true')).toBeLessThan(io.ops.indexOf('write'));
  });

  it('挂起期零写出（同步直出档）：durable 事件 / notify / setStatus / resize 全 no-op', () => {
    const { io, backend } = makeBackend();
    backend.suspendMain();
    io.reset();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '停屏期正文', timestamp: 1 } }); // durable 事件
    backend.notify('停屏期通知'); // 瞬时行路
    backend.setStatus(SESSION, '停屏期状态'); // 固定区脏位路
    io.emitResize(); // resize 编舞路
    expect(io.bytes).toBe(''); // 渲染请求安全 no-op——停屏期零写出（07 件 8 条款）
  });

  it('挂起期零写出（注入调度档）：帧合并 / tick 定时器全收——推进时钟零写出', () => {
    const rig = makeInteractive();
    rig.backend.suspendMain();
    rig.io.bytes = '';
    emit(rig.backend, { type: 'message_end', message: { role: 'user', content: '停屏期', timestamp: 1 } });
    rig.clock.advance(5000); // tick 窗 ×50——定时器已收，零帧零写出
    expect(rig.io.bytes).toBe('');
  });

  it('挂起期件 7 外显照常（批内裁：终端级不停）——忙态 OSC 写出而摘要行入缓冲不写出', () => {
    const { io, backend } = makeBackend();
    backend.suspendMain();
    io.reset();
    emit(backend, { type: 'agent_start' }, false); // 非聚焦：trackProgress 忙迁移 + 件 9 摘要行
    expect(io.bytes).toContain(PROGRESS_ACTIVE); // OSC 9;4 外显照常（终端级非主屏 cell 内容）
    expect(io.bytes).not.toContain('⧗'); // 摘要行入缓冲不写出（cell 零写出）
    expect(io.bytes).not.toContain('后台工作中');
  });

  it('resumeMain：全帧重画不走（通道）repaint + 瞬时行缓冲补吐（补显射界含停屏期瞬时行）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '停屏前正文', timestamp: 1 } });
    backend.suspendMain();
    emit(backend, { type: 'message_end', message: { role: 'user', content: '停屏期正文', timestamp: 2 } }); // durable 停屏期归账
    backend.notify('停屏期通知'); // 瞬时行入缓冲
    emit(backend, { type: 'agent_end', status: 'completed' }, false); // 件 9 摘要行入缓冲
    io.reset();
    backend.resumeMain();
    expect(io.frames[0]).toBe(MAIN_ENTER); // 进屏模式串（复起起手）
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 清屏——全帧重画（主屏既有权威全量重建路）
    expect(io.bytes).toContain('> 停屏前正文'); // 行集全量重写
    expect(io.bytes).toContain('> 停屏期正文'); // 停屏期 durable 事件在场（树已含停屏期全部事件）
    expect(io.bytes).toContain('· 停屏期通知'); // 瞬时行补吐（不走 repaint 的行为锁——投影不含瞬时行）
    expect(io.bytes).toContain('✓ sess-aaa'); // 件 9 摘要行补吐在场
    expect(io.bytes.indexOf('> 停屏期正文')).toBeLessThan(io.bytes.indexOf('· 停屏期通知')); // 补吐序：全帧在前、瞬时行在后
    // 复起回常态：后续事件恢复直写
    io.bytes = '';
    emit(backend, { type: 'message_end', message: { role: 'user', content: '复起后正文', timestamp: 3 } });
    expect(io.bytes).toContain('> 复起后正文');
  });

  it('lifecycle 全程迁移 + 挂起 / 复起幂等', () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io);
    expect(backend.lifecycle).toBe('idle');
    backend.start();
    expect(backend.lifecycle).toBe('running');
    backend.suspendMain();
    backend.suspendMain(); // 幂等——二次 no-op（不重复写出屏串）
    expect(backend.lifecycle).toBe('suspended');
    backend.resumeMain();
    backend.resumeMain(); // 幂等——二次 no-op
    expect(backend.lifecycle).toBe('running');
    backend.stop();
    expect(backend.lifecycle).toBe('disposed');
  });

  it('AltScreenHost 集成：TuiBackend 作 primary——进出副屏端到端编舞 + 停屏期零写出 + 复起补显', () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const clock = new ManualClock();
    const backend = new TuiBackend(io, {
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      now: clock.now,
      fpsCap: 1e6,
      sessionId: 's1',
    });
    backend.start();
    io.reset(); // start 编舞字节不计入
    const host = new AltScreenHost(backend, io, {
      engineOptions: { now: clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel },
    });
    const handle = host.open(altLayer('alt-frame'));
    expect(handle).not.toBeNull();
    expect(backend.lifecycle).toBe('suspended');
    clock.advance(0); // 副屏首帧落地
    // 进序：主屏出屏串（suspendMain）→ 副屏 1049 进（alt Engine start）
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.frames[2]).toContain('alt-frame');
    // 停屏期主屏零写出（瞬时行入缓冲）
    io.reset();
    backend.notify('停屏期通知');
    clock.advance(100);
    expect(io.bytes).toBe('');
    handle!.close();
    // 出序：副屏出（dispose）→ 主屏进屏串 + 全帧重画 + 瞬时行补吐（resumeMain 同步直出）
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(io.bytes).toContain('· 停屏期通知');
    expect(backend.lifecycle).toBe('running');
    expect(host.isOpen).toBe(false);
  });
});

/* ================= /history 副屏装配面（批 10f-4 特性腿——件 8） ================= */

describe('TuiBackend /history 副屏装配（openHistory / collapseAltScreen——件 8 特性腿）', () => {
  /** 同步直出档装配（无注入调度——副屏 Engine 同步包装：首帧确定、lone-ESC 即决） */
  function historyRig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openHistory 编舞：主屏出屏 → 副屏 1049 进 → 回看器首帧（同一渲染管线正文在场）', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    // 回看器头行：档名前缀 + 会话短 id（id 携会话区分色 SGR——两段分立断言）
    expect(io.bytes).toContain('↩ 历史回看 · ');
    expect(io.bytes).toContain('sess-aaa');
    expect(io.bytes).toContain('> 回看正文'); // durable 正文经同一渲染管线（零第二渲染器）
  });

  it('q 退出：io 字节流端到端——副屏出 + 主屏复起（全帧重画不走 repaint）', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    io.emitInput('q'); // kitty 轨纯键打字走 text 事件 → 让位判据（无搜索框）→ 退出
    expect(io.frames[0]).toBe(ALT_LEAVE); // 出序：副屏 dispose 在前
    expect(io.frames[1]).toBe(MAIN_ENTER); // 主屏复起进屏串
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // 全帧重画（清屏 + 光标归位）
    // 主屏行集不含副屏正文——回看内容不渗主屏（两屏行集分立的结构性证据）
    expect(io.bytes).not.toContain('回看正文');
    expect(backend.lifecycle).toBe('running');
  });

  it('collapseAltScreen（ask 收副屏路）：出副屏 + 复起；幂等二次 no-op', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    backend.collapseAltScreen();
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    io.reset();
    backend.collapseAltScreen(); // 幂等——无副屏 no-op
    expect(io.bytes).toBe('');
  });

  it('副屏键面 Ctrl+C：打断在飞 run（装配柄透传携带会话位）', () => {
    const { io, backend, calls } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    io.emitInput('\x03'); // ctrl+c
    expect(calls.interrupted).toEqual([SESSION]);
    expect(backend.lifecycle).toBe('suspended'); // 打断不退副屏（与主屏同键面：只打断）
  });

  it('副屏键面 Ctrl+D：先收副屏（复起）再转退出柄', () => {
    const { io, backend, calls } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    io.emitInput('\x04'); // ctrl+d
    expect(calls.quit).toBe(1);
    expect(backend.lifecycle).toBe('running'); // 先收副屏——退出柄到达时主屏已复起
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
  });

  it('已在副屏再 openHistory no-op（无嵌套备屏）；主屏未启 open 被拒保持无副屏', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, []);
    const frames = io.frames.length;
    backend.openHistory(SESSION, []); // 已在副屏——no-op
    expect(io.frames.length).toBe(frames);
    io.reset();
    // 未启后端：idle 态 open 被拒（AltScreenHost 拒绝位——句柄 null 如实保持）
    const io2 = new MemoryTerminalIO(COLS, ROWS);
    const backend2 = new TuiBackend(io2);
    backend2.openHistory(SESSION, []);
    expect(backend2.lifecycle).toBe('idle');
    expect(io2.bytes).toBe('');
  });

  it('stop 防御位：在场副屏先收再退（副屏 Engine 不残活）', () => {
    const { io, backend } = historyRig();
    backend.openHistory(SESSION, []);
    io.reset();
    backend.stop();
    expect(io.frames[0]).toBe(ALT_LEAVE); // 防御收副屏在前
    expect(io.bytes).toContain(MAIN_ENTER);
    expect(io.bytes).toContain(MAIN_LEAVE); // 终退出屏串照常
    expect(backend.lifecycle).toBe('disposed');
  });

  it('注入调度档：假钟直通副屏 Engine（帧随窗落地——保活 / 帧帽同源注入）', () => {
    const rig = makeInteractive();
    rig.pump(); // 主屏就绪帧落地（起账基线）
    rig.io.reset();
    rig.backend.openHistory('s1', [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    rig.pump(); // 副屏首帧随窗落地
    expect(rig.io.frames[0]).toBe(MAIN_LEAVE);
    expect(rig.io.frames[1]).toBe(ALT_ENTER);
    expect(rig.io.bytes).toContain('↩ 历史回看 · ');
    expect(rig.io.bytes).toContain('> 回看正文');
    rig.io.reset();
    rig.io.emitInput('q');
    rig.pump();
    expect(rig.io.frames[0]).toBe(ALT_LEAVE);
    expect(rig.backend.lifecycle).toBe('running');
  });

  it('搜索行同册注入（批 10k 遗漏修装配位证）：editor.new-line 用户覆盖对 /history 搜索框生效', () => {
    // 装配缝：openHistory 经 options.keymap 把 backend 会话册注入搜索行子编辑器
    // ——用户覆盖不因进副屏失联。行为锚 = 匹配计数：查询含换行 → 逐行子串
    // 扫描恒零匹配（0/0）；注入缺席时 alt+j 非编辑键零动作、查询不变（仍 1/1）
    const { io, backend } = historyRig({ keybindings: { 'editor.new-line': 'alt+j' } });
    backend.openHistory(SESSION, [{ role: 'user', content: '正文中藏 needle 一枚', timestamp: 1 }]);
    io.reset();
    io.emitInput('\x06'); // ctrl+f 开搜索（legacy 0x06 归一）
    io.emitInput('needle'); // 键入查询——恰 1 匹配
    // 渲染强制：副屏 Engine 输入后不自动重画、resize 等几何守卫直退——改几何
    // 后 emitResize 触发 forceFull 全帧（同步直出档即时落账）
    io.rows = 12;
    io.emitResize();
    expect(io.bytes).toContain('1/1');
    io.reset();
    io.emitInput('\x1bj'); // alt+j = 用户覆盖的 editor.new-line：查询内插换行
    io.rows = 14;
    io.emitResize();
    expect(io.bytes).toContain('0/0'); // 查询含 \n → 匹配清零（覆盖生效的行为证据）
    expect(io.bytes).not.toContain('1/1');
  });
});

/* ---------------- /history 鼠标面 e2e（mu-2——选区复制 OSC 52 + X10 降级装配接线证） ---------------- */

describe('TuiBackend /history 鼠标面 e2e（mu-2）', () => {
  /** SGR 报文便捷铸造（1 基坐标直书——与终端报文同形） */
  const sgr = (cb: number, col: number, row: number, final: 'M' | 'm' = 'M'): string =>
    `\x1b[<${cb};${col};${row}${final}`;

  /** 局部 rig（同 historyRig 形——同步直出档：开屏首帧确定） */
  function histRig() {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset(); // start 编舞字节不计入
    return { io, backend };
  }

  it('拖选三连 → io 字节含 OSC 52;c;base64（onCopy → buildOsc52Copy 装配接线）', () => {
    const { io, backend } = histRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]); // 副屏首帧同步落地
    io.reset(); // 进屏 / 首帧字节不计入——聚焦复制写出
    // 屏行 1（0 基）= 正文行 '> 回看正文'：CJK 双宽——列 2 = 回首、列 6 = 正首
    io.emitInput(sgr(0, 3, 2)); // 左键 press（1 基 col 3/row 2 → 0 基 2/1）
    io.emitInput(sgr(32, 7, 2)); // 按住拖动（motion）
    io.emitInput(sgr(0, 7, 2, 'm')); // 释放——触发复制
    expect(io.bytes).toContain(`\x1b]52;c;${Buffer.from('回看', 'utf8').toString('base64')}\x07`);
  });

  it('X10 首达降级：io 字节含 DECRST 1006/1002（AltScreenHost 接线——回终端原生选区）', () => {
    const { io, backend } = histRig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    io.emitInput('\x1b[M !"'); // X10 形（开了 1006 的会话里到达 ⟺ 终端无 SGR 能力）
    expect(io.bytes).toContain('\x1b[?1006l\x1b[?1002l');
  });
});

/* ---------------- /memory 鼠标面 e2e（挂账解挂批①——选区复制 OSC 52 装配接线证） ---------------- */

describe('TuiBackend /memory 鼠标面 e2e（挂账解挂批①）', () => {
  /** SGR 报文便捷铸造（1 基坐标直书——与 /history 鼠标面同形） */
  const sgr = (cb: number, col: number, row: number, final: 'M' | 'm' = 'M'): string =>
    `\x1b[<${cb};${col};${row}${final}`;

  it('拖选三连 → io 字节含 OSC 52;c;base64（onCopy → buildOsc52Copy 装配——与 /history 同柄单源）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset(); // start 编舞字节不计入
    // 单活体条目材料（条目行 = 0 基屏行 4：头行 0 + 健康投影两行 + 分区头 3）
    const rows = [
      {
        id: 'maaaaaaa',
        ownerKey: 'global',
        kind: 'pref',
        summary: '摘要甲',
        content: '',
        status: 'active' as const,
        supersededBy: null,
        updatedAt: 0,
        frozen: false,
        validFrom: null,
      },
    ];
    backend.setMemoryScreen({
      ownerKeys: ['global'],
      dao: {
        listVisibleForManagement: () => rows,
        listForExport: () => rows,
        overview: () => ({ health: { active: 1, dismissed: 0, expired: 0, frozen: 0, total: 1 } }),
        forget: () => rows[0]!,
        restore: () => rows[0]!,
        freeze: () => rows[0]!,
        unfreeze: () => rows[0]!,
      },
      sanitize: () => ({ blocked: false, patterns: [], quoted: false }),
      exportCommand: () => Promise.resolve('已导出'),
    });
    backend.openMemory();
    io.reset(); // 进屏 / 首帧字节不计入——聚焦复制写出
    // 条目行 `[m:maaaaaaa] [pref] 摘要甲 ...`：列 13-18 = `[pref]`（纯 ASCII
    // 段——显示列即 UTF-16 下标，宽度算术不介入）
    io.emitInput(sgr(0, 14, 5)); // 左键 press（1 基 col 14/row 5 → 0 基 13/4）
    io.emitInput(sgr(32, 20, 5)); // 按住拖动（motion → 0 基 col 19）
    io.emitInput(sgr(0, 20, 5, 'm')); // 释放——触发复制
    expect(io.bytes).toContain(`\x1b]52;c;${Buffer.from('[pref]', 'utf8').toString('base64')}\x07`);
  });
});

/* ================= /memory 副屏装配面（mm 批——06 §7 /memory 轻管理面） ================= */

describe('TuiBackend /memory 副屏装配（setMemoryScreen / openMemory——mm 批）', () => {
  /** 最小数据材料（构造期三源取数可用的假 DAO——动词零参形窄化合法） */
  function memoryDeps(): MemoryViewerDataDeps {
    const rows = [
      {
        id: 'maaaaaaa',
        ownerKey: 'global',
        kind: 'pref',
        summary: '摘要甲',
        content: '',
        status: 'active' as const,
        supersededBy: null,
        updatedAt: 0,
        frozen: false,
        validFrom: null,
      },
    ];
    return {
      ownerKeys: ['global'],
      dao: {
        listVisibleForManagement: () => rows,
        listForExport: () => rows,
        overview: () => ({ health: { active: 1, dismissed: 0, expired: 0, frozen: 0, total: 1 } }),
        forget: () => rows[0]!,
        restore: () => rows[0]!,
        freeze: () => rows[0]!,
        unfreeze: () => rows[0]!,
      },
      sanitize: () => ({ blocked: false, patterns: [], quoted: false }),
      exportCommand: () => Promise.resolve('已导出'),
    };
  }

  /** 同步直出档装配（historyRig 同形） */
  function memoryRig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openMemory 编舞：材料注入后真开——主屏出屏 → 副屏进 → 管理面首帧（三分区在场）', () => {
    const { io, backend } = memoryRig();
    backend.setMemoryScreen(memoryDeps());
    expect(backend.openMemory()).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('❄ 记忆管理 · global'); // 头行 owner 短显
    expect(io.bytes).toContain('── 活体（1）'); // 三分区首帧
  });

  it('材料缺席（件未装载形）/ null 撤材料：openMemory 返 false 不进副屏', () => {
    const { io, backend } = memoryRig();
    expect(backend.openMemory()).toBe(false); // 未注入材料
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toBe('');
    backend.setMemoryScreen(memoryDeps());
    backend.setMemoryScreen(null); // 撤材料（件卸载形）
    expect(backend.openMemory()).toBe(false);
    expect(io.bytes).toBe('');
  });

  it('副屏互斥：openHistory 在场 openMemory 返 false；收副屏后可开（单值备屏律）', () => {
    const { io, backend } = memoryRig();
    backend.setMemoryScreen(memoryDeps());
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    expect(backend.openMemory()).toBe(false); // 已在副屏——无嵌套备屏
    expect(io.bytes).toBe('');
    backend.collapseAltScreen();
    expect(backend.openMemory()).toBe(true); // 收后可开
    expect(io.bytes).toContain('❄ 记忆管理 · global');
  });

  it('副屏键面：Ctrl+C 携当前交互会话位（零参形装配闭包）；q 退出复起主屏', () => {
    const { io, backend, calls } = memoryRig();
    backend.setMemoryScreen(memoryDeps());
    backend.openMemory();
    io.reset();
    io.emitInput('\x03'); // ctrl+c——打断不退副屏
    expect(calls.interrupted).toEqual([SESSION]);
    expect(backend.lifecycle).toBe('suspended');
    io.emitInput('q'); // 退出管理面
    expect(io.frames[0]).toBe(ALT_LEAVE);
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).not.toContain('记忆管理'); // 两屏行集分立——管理面不渗主屏
  });

  it('导出行同册注入（批 10k 遗漏修装配位证）：editor.new-line 用户覆盖对 /memory 导出行生效', () => {
    // 装配缝：setMemoryScreen 经 options.keymap 把 backend 会话册注入导出行子
    // 编辑器。行为锚 = 导出命令 argv：tokenize 只按空格/制表切分——输入行内
    // 换行保位在单 token（['a\\nb']）；注入缺席时 alt+j 非编辑键零动作（['ab']）
    const exportArgv: string[][] = [];
    const { io, backend } = memoryRig({ keybindings: { 'editor.new-line': 'alt+j' } });
    backend.setMemoryScreen({
      ...memoryDeps(),
      exportCommand: (argv) => {
        exportArgv.push([...argv]);
        return Promise.resolve('已导出');
      },
    });
    backend.openMemory();
    io.emitInput('e'); // 开导出参数行（text 轨）
    io.emitInput('a');
    io.emitInput('\x1bj'); // alt+j = 用户覆盖的 editor.new-line：输入行内插换行
    io.emitInput('b');
    io.emitInput('\r'); // Enter 执行导出（runExport → tokenize 原文 → 注入闭包）
    expect(exportArgv).toEqual([['a\nb']]); // 换行保位在单 token——覆盖生效的行为证据
  });
});

describe('主题面（批 10g——07 §4.1 R2 三档色域 + OSC 11 自动明暗）', () => {
  it('缺省注入缺席 = dark 确定性基线：零探测写出、accent 落 ANSI 6（与批 10g 前字节同源）', () => {
    const { io } = makeBackend();
    expect(io.bytes).not.toContain('\x1b]11;?'); // 无 OSC 11 查询
    expect(io.bytes).not.toContain('\x1b[?2031h'); // 无明暗变化订阅
    expect(io.bytes).toContain('\x1b[36m'); // accent ANSI 6 cyan（编辑器边框载体）
  });

  it('auto 档 start：OSC 11 查询 + 2031 订阅两写点', () => {
    const { io } = makeBackend({ theme: 'auto' });
    expect(io.bytes).toContain('\x1b]11;?\x07');
    expect(io.bytes).toContain('\x1b[?2031h');
  });

  it('auto 亮底应答换装：accent 翻 ANSI 4（SGR 34）固定区重画', () => {
    const { io } = makeBackend({ theme: 'auto' });
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 白底应答（同步直出——换装即时落帧）
    expect(io.bytes).toContain('\x1b[34m'); // light accent ANSI 4 blue
    expect(io.bytes).not.toContain('\x1b[36m'); // dark accent 不再上帧
  });

  it('auto 同板应答零重画（2031 冗余应答与噪声不触发无谓帧）', () => {
    const { io } = makeBackend({ theme: 'auto' }); // 构造期先 dark
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 黑底 = 同板
    expect(io.bytes).toBe('');
  });

  it('auto 暗底应答迟到照常换装（无钟不设窗——2031 通知语义等价）', () => {
    const { io } = makeBackend({ theme: 'auto' });
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 先亮底换装
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:0d11/0d11/0d11\x07'); // 再暗底（GitHub dark #0d1117）——换回
    expect(io.bytes).toContain('\x1b[36m');
    expect(io.bytes).not.toContain('\x1b[34m');
  });

  it('显式档短路：dark 显式下应答全忽略（防御位——查询本未发）', () => {
    const { io } = makeBackend({ theme: 'dark' });
    io.bytes = '';
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07');
    expect(io.bytes).toBe('');
  });

  it('畸形应答诚实忽略：非 11 码 / 非 rgb 形不换装', () => {
    const { io } = makeBackend({ theme: 'auto' });
    io.bytes = '';
    io.emitInput('\x1b]10;rgb:ffff/ffff/ffff\x07'); // 前景色码（OSC 10）——非本面
    io.emitInput('\x1b]11;rgb:zz/0/0\x07'); // 非 hex
    expect(io.bytes).toBe('');
  });

  it('stop 复原：auto 档关 2031 订阅；显式档从未开不写关', () => {
    const auto = makeBackend({ theme: 'auto' });
    auto.backend.stop();
    expect(auto.io.bytes).toContain('\x1b[?2031l');
    const explicit = makeBackend(); // 缺省 dark
    explicit.backend.stop();
    expect(explicit.io.bytes).not.toContain('\x1b[?2031l');
  });

  it('硬退复原钩含 2031 复原（七役扫描批——复原对称律：armExitRestore 与 stop 同写）', () => {
    // armExitRestore 仅真 ProcessTerminalIO 武装（注入 MemoryTerminalIO 零污染）
    // ——捕获子类过 instanceof 门、写出面截留（不触真 stdout）
    class CapturingProcessIO extends ProcessTerminalIO {
      captured = '';
      override write(data: string): void {
        this.captured += data;
      }
    }
    const io = new CapturingProcessIO();
    const backend = new TuiBackend(io, { theme: 'auto' });
    const before = new Set(process.listeners('exit'));
    backend.start();
    // 武装位自证：start 恰新增一个 'exit' 监听（armExitRestore 真身路径）
    const added = process.listeners('exit').filter((l) => !before.has(l));
    expect(added).toHaveLength(1);
    io.captured = ''; // start 编舞字节不计入
    (added[0] as () => void)(); // 模拟硬退——直调 process 'exit' 监听（零副作用：不发真 exit 事件）
    expect(io.captured).toContain(MAIN_LEAVE); // 既有复原面（出屏串）在场
    expect(io.captured).toContain('\x1b[?2031l'); // 修复点：2031 复原——修前此字节缺席（红锚）
    backend.stop(); // 收尾：卸 stdin/resize 订阅 + 解除 exit 钩（不泄漏到后续进程退出）
  });

  it('硬退复原钩显式档不写 2031 关（与 stop 同条件——显式档从未开不写关）', () => {
    class CapturingProcessIO extends ProcessTerminalIO {
      captured = '';
      override write(data: string): void {
        this.captured += data;
      }
    }
    const io = new CapturingProcessIO();
    const backend = new TuiBackend(io); // 缺省 dark 显式档
    const before = new Set(process.listeners('exit'));
    backend.start();
    const added = process.listeners('exit').filter((l) => !before.has(l));
    expect(added).toHaveLength(1);
    (added[0] as () => void)(); // 模拟硬退
    expect(io.captured).toContain(MAIN_LEAVE); // 出屏复原照常
    expect(io.captured).not.toContain('\x1b[?2031l'); // 显式档从未开订阅——不写关
    backend.stop();
  });

  it('resumeMain auto 档补发 OSC 11 重查（七役扫描批——副屏在场窗通知丢弃的复起补偿）', () => {
    const { io, backend } = makeBackend({ theme: 'auto' });
    backend.suspendMain();
    io.reset();
    backend.resumeMain();
    expect(io.frames[0]).toBe(MAIN_ENTER); // 复起起手仍是进屏串（重查不打头）
    expect(io.bytes).toContain('\x1b]11;?\x07'); // 第二次 OSC 11 查询——修前缺席（红锚）
  });

  it('resumeMain 显式档不补发 OSC 11（显式档零探测——对称面）', () => {
    const { io, backend } = makeBackend(); // 缺省 dark
    backend.suspendMain();
    io.reset();
    backend.resumeMain();
    expect(io.bytes).not.toContain('\x1b]11;?');
  });

  it('colorEnv 三档接线：truecolor 档 accent 仍 ANSI 6 直通、RGB 键走 38;2 直出', () => {
    // accent AnsiColor 全档直通——truecolor 档字节与 16 档同源
    const tc = makeBackend({ colorEnv: { COLORTERM: 'truecolor' } });
    expect(tc.io.bytes).toContain('\x1b[36m');
    expect(tc.io.bytes).not.toContain('38;5;'); // 非聚焦会话色表未进帧（accent 直通自证）
  });
});

/* ================= 批 10i：应用动作键（思考块/工具卡会话级开关——R1/R4/R5） ================= */

describe('TuiBackend 会话级开关键（批 10i ctrl+t / ctrl+o）', () => {
  /** 带思考块的 assistant 消息（本 describe 速构） */
  const thinkingMsg = (thinking: string, text: string): AgentMessage => ({
    role: 'assistant',
    content: [
      ...(thinking !== '' ? [{ type: 'thinking' as const, thinking }] : []),
      ...(text !== '' ? [{ type: 'text' as const, text }] : []),
    ],
    usage,
    stopReason: 'stop',
    timestamp: 1,
  });

  it('ctrl+t 翻思考块会话级展开：repaint 清屏重渲（折叠标签 → 展开体 + 收起提示）', () => {
    const { io, backend } = makeBackend();
    emit(backend, { type: 'message_end', message: thinkingMsg('先想再答', '正文') });
    io.bytes = '';
    io.emitInput('\x14'); // ctrl+t
    expect(io.bytes).toContain('\x1b[2J\x1b[H'); // repaint 全量重渲（冻结账随 repaint 重置）
    expect(io.bytes).toContain('收起'); // 展开档标签动词
    expect(io.bytes).toContain('先想再答'); // 思考体行在场
    io.bytes = '';
    io.emitInput('\x14');
    expect(io.bytes).toContain('（ctrl+t 展开）'); // 翻回折叠档
    expect(io.bytes).not.toContain('收起');
  });

  it('ctrl+o 翻工具卡会话级展开：折叠尾 5 预览 → 全量（帽外首行回场）', () => {
    const { io, backend } = makeBackend();
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: {} }],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    emit(backend, {
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'read',
        content: [{ type: 'text', text: Array.from({ length: 8 }, (_, i) => `行${i + 1}`).join('\n') }],
        isError: false,
        timestamp: 1,
      },
    });
    expect(io.bytes).toContain('✓'); // 三态卡头（success——符号段与名段间有转义重置不连续）
    expect(io.bytes).toContain('read');
    expect(io.bytes).not.toContain('行1'); // 折叠预览尾 5 行（行4..行8）——帽外首行不在场
    io.bytes = '';
    io.emitInput('\x0f'); // ctrl+o
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('行1'); // 全量展开——首行回场
  });

  it('层② overlay 占焦期吞 ctrl+t（模态独占——层③.5 应用键不越层）', async () => {
    const { io, backend, pump } = makeInteractive();
    emit(backend, { type: 'message_end', message: thinkingMsg('想法', '文') });
    const p = backend.confirm('确认？');
    pump();
    io.bytes = '';
    io.emitInput('\x14'); // overlay 在场——模态独占
    expect(io.bytes).not.toContain('\x1b[2J'); // 不 repaint（面板吞键——开关零扰动）
    io.emitInput('\r'); // 面板应答——层关
    pump();
    await expect(p).resolves.toBe(true);
  });
});

/* ================= 批 10k 交互面（键位覆盖 / 三副屏装配 / footer 分栏） ================= */

describe('TuiBackend 键位覆盖面（R5 批 10k——keybindings 注入 + 拒载观测）', () => {
  it('注入：好条目生效不受连坐 + 坏条目经 keybindingRejections 透出（装配位呈报）', () => {
    const { backend } = makeBackend({
      keybindings: { 'thinking.toggle': 'ctrl+g', 'no.such-action': 'ctrl+z' },
    });
    expect(backend.keybindingRejections).toHaveLength(1); // 只拒坏条目
    expect(backend.keybindingRejections[0]).toMatchObject({
      kind: 'unknown-action',
      actionId: 'no.such-action',
    });
  });

  it('注入缺席 = 零拒载（缺省册恒净）', () => {
    const { backend } = makeBackend();
    expect(backend.keybindingRejections).toEqual([]);
  });
});

describe('TuiBackend /sessions · /usage · /help 副屏装配（R7 批 10k）', () => {
  const SESSIONS: readonly UiSessionSummary[] = [
    { id: 'sess-cccccccccc', title: '调 TUI', updatedAt: new Date(2026, 8, 15, 10, 30).getTime(), active: false },
    { id: 'sess-dddddddddd', title: '旧会话', updatedAt: new Date(2026, 8, 14, 9, 5).getTime(), active: true },
  ];
  const SUMMARY: UiUsageSummary = {
    turns: 2,
    input: 12345,
    output: 6789,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 19134,
    cost: 0.5,
    currency: 'USD',
  };

  /** 同步直出档装配（historyRig 同形） */
  function rig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openSessions 编舞：主屏出屏 → 副屏进 → 切换器首帧清单在场', () => {
    const { io, backend } = rig();
    expect(backend.openSessions(SESSIONS, () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('⇄ 会话切换 · 2 会话'); // 头行
    expect(io.bytes).toContain('调 TUI'); // 清单行（标题）
    expect(io.bytes).toContain('●'); // 活跃位（sess-dd 活跃行）
  });

  it('openSessions 选定：enter 先收副屏再透传 onSelect（切焦回调核闭包）', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openSessions(SESSIONS, (id) => selected.push(id));
    io.reset();
    io.emitInput('\r'); // enter——首行默认光标
    expect(selected).toEqual(['sess-cccccccccc']); // 选定回调透传
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
  });

  it('openSessions 副屏内 Ctrl+C：打断目标 = 当前交互会话位（不退副屏）', () => {
    const { io, backend, calls } = rig();
    backend.openSessions(SESSIONS, () => {});
    io.reset();
    io.emitInput('\x03');
    expect(calls.interrupted).toEqual([SESSION]); // 装配闭包锚交互会话（切焦前语义）
    expect(backend.lifecycle).toBe('suspended');
  });

  it('openUsage 编舞：用量面板首帧（短 id 头行 + 分表千位分组 + 费用）', () => {
    const { io, backend } = rig();
    expect(backend.openUsage('sess-dddddddddd', SUMMARY)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('⧗ 会话用量 · sess-ddd'); // 头行（参数会话非交互位；短 id 8 字符）
    expect(io.bytes).toContain('12,345'); // 输入分表千位分组
    expect(io.bytes).toContain('0.5000 USD'); // 费用行
  });

  it('openHelp 编舞：命令册 + 键位册双源首帧', () => {
    const { io, backend } = rig();
    expect(backend.openHelp([{ name: 'exit', description: '退出 TUI' }])).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.bytes).toContain('❓ 命令与键位帮助 · 会话 sess-aaa'); // 头行锚交互会话短 id
    expect(io.bytes).toContain('── 命令 ──'); // 命令册段
    expect(io.bytes).toContain('/exit'); // 注入命令条目
    expect(io.bytes).toContain('── 键位 ──'); // 键位册段（keymap 投影）
    expect(io.bytes).toContain('ctrl+c'); // 键位条目样点（全局域首条）
  });

  it('三面互斥：openHistory 在场三面全 false；收副屏后可开（单值备屏律）', () => {
    const { io, backend } = rig();
    backend.openHistory(SESSION, [{ role: 'user', content: '回看正文', timestamp: 1 }]);
    io.reset();
    expect(backend.openSessions(SESSIONS, () => {})).toBe(false);
    expect(backend.openUsage(SESSION, SUMMARY)).toBe(false);
    expect(backend.openHelp([])).toBe(false);
    expect(io.bytes).toBe(''); // 拒开零写出
    backend.collapseAltScreen();
    expect(backend.openHelp([])).toBe(true); // 收后可开
  });

  it('onRepaint 切焦跟随：openHelp 头行短 id 随新聚焦会话（焦点权威信号）', () => {
    const { io, backend } = rig();
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null); // 切焦 repaint——sessionId 跟随
    io.reset();
    backend.openHelp([]);
    expect(io.bytes).toContain('❓ 命令与键位帮助 · 会话 sess-bbb'); // 新会话短 id
  });
});

describe('TuiBackend 本地命令族拦截（07 §4.1 命令面增补批）', () => {
  /** 本地命令族注入 rig：run 调用记录 */
  function localRig() {
    const runs: string[] = [];
    const rig = makeInteractive({
      localCommands: [
        { name: 'status', description: '状态汇总副屏', run: () => runs.push('status') },
        { name: 'debug', description: '调试信息副屏', run: () => runs.push('debug') },
      ],
      dispatchCommand: async (input) => {
        rig.calls.dispatched.push(input);
        return false; // 未命中兜底（真通道命令柄语义由既有组覆盖）
      },
    });
    return { ...rig, runs };
  }

  it('恰零参命中 → run() 终局（先于通道命令分发、不落 onSubmit）', () => {
    const { io, runs, calls, pump } = localRig();
    io.emitInput('/status\r');
    pump();
    expect(runs).toEqual(['status']);
    expect(calls.dispatched).toEqual([]); // 本地族先于通道命令面
    expect(calls.submitted).toEqual([]); // 永不兜底进模型消息
    io.emitInput('  /debug  \r'); // 尾随空白 trim 后恰命中
    pump();
    expect(runs).toEqual(['status', 'debug']);
  });

  it('带参形 → warn 用法提示终局（不执行不兜底）', () => {
    const { io, runs, calls, pump } = localRig();
    io.emitInput('/status now\r');
    pump();
    expect(io.bytes).toContain('不带参数'); // 用法 fail-loud（/exit 同律）
    expect(io.bytes).toContain('⚠'); // warn 档符号
    expect(runs).toEqual([]);
    expect(calls.submitted).toEqual([]);
  });

  it('词干未命中 → 落通道命令柄（false 兜底进 onSubmit）；注入缺席 = 零拦截', async () => {
    const { io, calls, pump } = localRig();
    io.emitInput('/statusy\r'); // 前缀近似但非词干——不拦
    pump();
    await Promise.resolve(); // dispatch 异步链微任务排空
    expect(calls.dispatched).toEqual(['/statusy']);
    expect(calls.submitted).toEqual([['s1', '/statusy']]);
    // 注入缺席：'/status' 是普通 '/' 文本（既有路由零扰动）
    const bare = makeInteractive();
    bare.io.emitInput('/status\r');
    bare.pump();
    expect(bare.calls.submitted).toEqual([['s1', '/status']]);
  });

  it('退出词优先级不降：本地族在场时 /exit 仍走 onQuit（调用序在前）', () => {
    const { io, runs, calls, pump } = localRig();
    io.emitInput('/exit\r');
    pump();
    expect(calls.quit).toBe(1); // 退出词先于本地族（handleSubmit 调用序）
    expect(runs).toEqual([]);
  });
});

describe('TuiBackend /status · /debug · /skills 副屏装配（07 §4.1 命令面增补批）', () => {
  const STATUS_DATA = {
    version: '0.2.0',
    model: 'faux/test-model',
    modelCount: 3,
    sessionId: SESSION,
    cwdLabel: 'berry-agent',
    turns: 7,
    dataDir: '/tmp/berry-home',
    theme: 'dark',
    env: [
      { key: 'BERRY_AGENT_MODEL', value: null },
      { key: 'BERRY_AGENT_DATA_DIR', value: '/tmp/berry-home' },
      { key: 'BERRY_AGENT_LOG_LEVEL', value: 'debug' },
    ],
  };
  const DEBUG_DATA = {
    daemonLogPath: '/tmp/berry-home/serve/daemon.log',
    daemonLogTail: ['daemon 启动', 'token 回执：Bearer tok_secret123'],
    logLevel: 'debug',
    settingsKeys: ['theme'],
    settingsWarnings: ['theme 坏值 warn 样点'],
    sqlitePath: '/tmp/berry-home/agent.db',
    pluginIds: ['core:skills'],
  };
  const SKILLS = [
    { name: 'commit-style', description: '提交信息风格', layer: 'project', hidden: false },
    { name: 'dataviz', description: '图表建议', layer: 'user', hidden: true },
  ];

  /** 同步直出档装配（R7 组同形） */
  function rig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset(); // start 编舞字节不计入
    return { io, backend, calls };
  }

  it('openStatus 编舞：主屏出屏 → 副屏进 → 状态首帧；开屏锚顶（首段在场尾段缺席）', () => {
    const { io, backend } = rig();
    expect(backend.openStatus(STATUS_DATA)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 进序：主屏挂起出屏串在前
    expect(io.frames[1]).toBe(ALT_ENTER); // 副屏 Engine 进屏
    expect(io.bytes).toContain('◉ 状态汇总 · 会话 sess-aaa'); // 头行（短 id）
    // 开屏锚顶：行集 14 行超视口（10 行终端）——首段「── 运行时 ──」在场而
    // 尾行 env LOG_LEVEL 缺席（贴尾回看器语义会只显末段）
    expect(io.bytes).toContain('── 运行时 ──');
    expect(io.bytes).not.toContain('BERRY_AGENT_LOG_LEVEL');
  });

  it('openDebug 编舞：调试首帧；daemon.log 尾快照 token 形掩码（明文恒不在场）', () => {
    // 行集 15 行超 10 行终端视口——高终端（24 行）使尾快照段入首帧（锚顶律
    // 由 openStatus 组同形锁定，本组聚焦掩码呈现）
    const io = new MemoryTerminalIO(COLS, 24);
    const backend = new TuiBackend(io, { sessionId: SESSION });
    backend.start();
    io.reset();
    expect(backend.openDebug(DEBUG_DATA)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('⚙ 调试信息');
    expect(io.bytes).toContain('serve/daemon.log'); // 路径行
    expect(io.bytes).toContain('Bearer ****'); // 掩码形在场
    expect(io.bytes).not.toContain('tok_secret123'); // 明文恒不入面（04 §7 敏感件纪律）
    expect(io.bytes).toContain('core:skills'); // 插件清单行
  });

  it('openSkills 编舞：清单首帧（计数头 + 光标行 + 隐藏标记）', () => {
    const { io, backend } = rig();
    expect(backend.openSkills(SKILLS, () => 'BACKFILL')).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('✦ 技能清单 · 2 件');
    expect(io.bytes).toContain('▸ commit-style'); // 首行光标
    expect(io.bytes).toContain('隐 · user'); // 隐藏件标记（含入不滤）
  });

  it('openSkills enter 回填：先收副屏再回填输入框（不执行——无提交流）', () => {
    const { io, backend, calls } = rig();
    backend.openSkills(SKILLS, (index) => (index === 0 ? 'BACKFILL-FIRST' : 'BACKFILL-SECOND'));
    io.emitInput('\x1b[B'); // ↓——光标到第二行（dataviz；可能产重绘帧）
    io.reset(); // 只断言 enter 编舞
    io.emitInput('\r'); // enter——选定回填
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toContain('BACKFILL-SECOND'); // 回填文本入编辑器（首帧固定区）
    expect(calls.submitted).toEqual([]); // 回填不执行——提交与否归用户
  });

  it('三面与既有副屏互斥（单值备屏律）；收后可开', () => {
    const { io, backend } = rig();
    backend.openHelp([]);
    io.reset();
    expect(backend.openStatus(STATUS_DATA)).toBe(false);
    expect(backend.openDebug(DEBUG_DATA)).toBe(false);
    expect(backend.openSkills(SKILLS, () => '')).toBe(false);
    expect(io.bytes).toBe(''); // 拒开零写出
    backend.collapseAltScreen();
    expect(backend.openStatus(STATUS_DATA)).toBe(true); // 收后可开
  });

  it('副屏内 Ctrl+C：打断目标 = 当前交互会话位（不退副屏）', () => {
    const { io, backend, calls } = rig();
    backend.openStatus(STATUS_DATA);
    io.reset();
    io.emitInput('\x03');
    expect(calls.interrupted).toEqual([SESSION]);
    expect(backend.lifecycle).toBe('suspended'); // 打断不退副屏
  });
});

describe('TuiBackend /themes · /diff 副屏装配 + 主题切换面（/themes 批——R2 挂账解挂 + 命令面增补批）', () => {
  const THEME_ENTRIES = [
    { name: 'auto', detail: '跟随终端明暗（OSC 11 探测）', broken: false },
    { name: 'dark', detail: '内置暗色', broken: false },
    { name: 'light', detail: '内置亮色', broken: false },
    { name: 'my-theme', detail: '自定义（themes/<名>.json 键级覆盖）', broken: true },
  ];

  /** /thinking 七档条目（2026-09-17 会话档位切换面批 F1——词序同 THINKING_LEVELS） */
  const THINKING_ENTRIES = [
    { level: 'off', detail: '关闭思考' },
    { level: 'minimal', detail: '极简思考' },
    { level: 'low', detail: '低档思考' },
    { level: 'medium', detail: '中档思考' },
    { level: 'high', detail: '高档思考' },
    { level: 'xhigh', detail: '超高档思考' },
    { level: 'max', detail: '最大思考' },
  ];

  /** /sandbox 三档条目（2026-09-17 会话档位切换面批 F2——词序同 SANDBOX_MODES） */
  const SANDBOX_ENTRIES = [
    { mode: 'read-only', detail: '只读——写与执行全拒' },
    { mode: 'workspace-write', detail: '工作区可写——越界写须审批' },
    { mode: 'danger', detail: '无沙箱——任何命令直跑宿主' },
  ];

  const DIFF_MESSAGES = [
    {
      type: 'assistant',
      toolCalls: [
        {
          type: 'toolCall',
          toolCallId: 't1',
          toolName: 'edit',
          arguments: JSON.stringify({ patch: '*** Update File: src/a.ts\n+hi\n' }),
        },
      ],
    },
    { type: 'toolResult', toolCallId: 't1' },
  ];

  function rig(options: Partial<TuiBackendOptions> = {}) {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
      ...options,
    });
    io.reset();
    return { io, backend, calls };
  }

  it('openThemes 编舞：主屏出屏 → 副屏进 → 主题首帧（计数头 + 当前档标记 + 坏文件 ⚠）', () => {
    const { io, backend } = rig();
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 主题切换 · 4 档');
    expect(io.bytes).toContain('● dark'); // 当前档标记
    expect(io.bytes).toContain('⚠'); // 坏文件条目标注
  });

  it('openThemes enter 选定：先收副屏再回调（选定名透传——SessionPicker 同序律）', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openThemes(THEME_ENTRIES, 'auto', (name) => selected.push(name));
    io.emitInput('\x1b[B'); // ↓ → dark
    io.reset();
    io.emitInput('\r'); // enter 选定
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(selected).toEqual(['dark']);
  });

  it('副屏输入补帧（mp-5 家族修·修前红）：openThemes ↓ 后光标移动帧落地——修前输入零帧，光标变更肉眼不可见', () => {
    const { io, backend } = rig();
    backend.openThemes(THEME_ENTRIES, 'auto', () => {});
    io.reset(); // 清进屏序与首帧（首帧已含 dark 行）——聚焦输入补帧
    io.emitInput('\x1b[B'); // ↓ auto → dark（面板光标态变更）
    expect(io.frames.length).toBeGreaterThan(0); // 修前红：输入只转发不请帧——零新帧
    expect(io.frames.join('')).toContain('▸'); // 光标标记移上新行（diff 帧写变更格）
  });

  it('openThinking 编舞：主屏出屏 → 副屏进 → 档位首帧（计数头 + 当前档 ● + 底行「下一 run 起生效」提示）', () => {
    const { io, backend } = rig();
    expect(backend.openThinking(THINKING_ENTRIES, 'medium', () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 思考档位 · 7 档');
    expect(io.bytes).toContain('● medium'); // 当前档标记
    expect(io.bytes).toContain('下一 run 起生效'); // 生效语义提示（底行）
    expect(io.bytes).toContain('随模型能力'); // 诚实句（S3——选定不等于生效：档位能力随 provider）
  });

  it('openThinking current 缺席 = 零 ● 锚（诚实无锚——boot 未设且无切档事件）', () => {
    const { io, backend } = rig();
    expect(backend.openThinking(THINKING_ENTRIES, undefined, () => {})).toBe(true);
    expect(io.bytes).not.toContain('●');
  });

  it('openThinking enter 选定：先收副屏再回调（档位词透传——SessionPicker 同序律）+ 与主题面互斥', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openThinking(THINKING_ENTRIES, 'off', (level) => selected.push(level));
    io.emitInput('\x1b[B'); // ↓ → minimal
    io.reset();
    io.emitInput('\r'); // enter 选定
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(selected).toEqual(['minimal']);
    // 单值备屏律：收屏后可再开主题面（互斥位已释放）
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
  });

  it('openSandbox 编舞：主屏出屏 → 副屏进 → 档位首帧（计数头 + 当前档 ● + danger 警示语 + 底行「即刻生效于后续工具调用」提示）', () => {
    const { io, backend } = rig();
    expect(backend.openSandbox(SANDBOX_ENTRIES, 'workspace-write', () => {})).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 沙箱档位 · 3 档');
    expect(io.bytes).toContain('● workspace-write'); // 当前档标记
    expect(io.bytes).toContain('直跑宿主'); // danger 行警示语
    expect(io.bytes).toContain('即刻生效于后续工具调用'); // 生效语义提示（底行——A4 分拆形：per 工具调用现取）
  });

  it('openSandbox current 缺席 = 零 ● 锚（诚实无锚——boot 未设且无切档事件）', () => {
    const { io, backend } = rig();
    expect(backend.openSandbox(SANDBOX_ENTRIES, undefined, () => {})).toBe(true);
    expect(io.bytes).not.toContain('●');
  });

  it('openSandbox enter 选定：先收副屏再回调（档位词透传——SessionPicker 同序律）+ 与主题面互斥', () => {
    const { io, backend } = rig();
    const selected: string[] = [];
    backend.openSandbox(SANDBOX_ENTRIES, 'read-only', (mode) => selected.push(mode));
    io.emitInput('\x1b[B'); // ↓ → workspace-write
    io.reset();
    io.emitInput('\r'); // enter 选定
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(io.frames[1]).toBe(MAIN_ENTER);
    expect(backend.lifecycle).toBe('running');
    expect(selected).toEqual(['workspace-write']);
    // 单值备屏律：收屏后可再开主题面（互斥位已释放）
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
  });

  it('openDiff 编舞：改动总览首帧（组头路径 + 计数）；零 edit 投影 = 诚实空态', () => {
    const { io, backend } = rig();
    expect(backend.openDiff(DIFF_MESSAGES)).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('± 改动总览 · 1 文件');
    expect(io.bytes).toContain('src/a.ts');
    expect(io.bytes).toContain('+1');
    backend.collapseAltScreen();
    io.reset();
    expect(backend.openDiff([{ type: 'user' }])).toBe(true); // 空投影收后可开
    expect(io.bytes).toContain('± 改动总览 · 0 文件');
    expect(io.bytes).toContain('零 edit 类改动');
  });

  it('两新面与既有副屏互斥（单值备屏律）：拒开零写出、收后可开', () => {
    const { io, backend } = rig();
    backend.openHelp([]);
    io.reset();
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(false);
    expect(backend.openDiff(DIFF_MESSAGES)).toBe(false);
    expect(io.bytes).toBe('');
    backend.collapseAltScreen();
    expect(backend.openThemes(THEME_ENTRIES, 'dark', () => {})).toBe(true);
  });

  it('themeChoice 观测位：构造档直读；setThemeChoice 后即时更新', () => {
    const { backend } = rig();
    expect(backend.themeChoice).toBe('dark'); // makeBackend 缺省
    backend.setThemeChoice('auto', null);
    expect(backend.themeChoice).toBe('auto');
  });

  it('setThemeChoice OSC 编舞：显式→探测档开订阅 + 查询；探测→显式档关订阅（不重查）', () => {
    const { io, backend } = rig(); // dark 显式——零探测
    expect(io.bytes).not.toContain('\x1b]11;?');
    backend.setThemeChoice('auto', null); // 开探测
    expect(io.bytes).toContain('\x1b]11;?\x07');
    expect(io.bytes).toContain('\x1b[?2031h');
    io.reset();
    backend.setThemeChoice('dark', null); // 关探测
    expect(io.bytes).toContain('\x1b[?2031l');
    expect(io.bytes).not.toContain('\x1b]11;?');
  });

  it('setThemeChoice auto→auto：补发重查（重选即重探——运行时切档重走下装同律）', () => {
    const { io, backend } = rig({ theme: 'auto' });
    io.reset();
    backend.setThemeChoice('auto', null);
    expect(io.bytes).toContain('\x1b]11;?\x07'); // 重查在场
    expect(io.bytes).not.toContain('\x1b[?2031h'); // 已开不重开
  });

  it('setThemeChoice 换装即时落帧：dark → light accent 翻 ANSI 4（SGR 34）', () => {
    const { io, backend } = rig(); // dark 基线
    io.reset();
    backend.setThemeChoice('light', null);
    expect(io.bytes).toContain('\x1b[34m');
    expect(io.bytes).not.toContain('\x1b[36m');
  });

  it('自定义档运行时切档：覆盖表随装 + 探测开（customOverlay 即探测档）', () => {
    const { io, backend } = rig(); // dark 显式基线
    io.reset();
    backend.setThemeChoice('my-theme', { accent: ansiColor(3) });
    expect(io.bytes).toContain('\x1b[33m'); // 覆盖键生效（accent → ANSI 3 yellow）
    expect(io.bytes).toContain('\x1b[?2031h'); // 自定义档 = 键级回退探测恒在
  });

  it('自定义档 OSC 11 应答重合成：覆盖键恒胜（accent 3 不被基板明暗翻转冲掉）', () => {
    // 裸帧可见色 = 编辑器边框 accent（secondary 无承载行——基板翻转另测）。
    // 重合成后走脏格差分渲染：覆盖键保住 = 边框色不变 = 零色字节写出（若
    // 覆盖丢失翻 light 裸 accent 4，差分必写 \x1b[34m——负断言即证据）
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      theme: 'custom-x',
      customThemeOverlay: { accent: ansiColor(3) },
    });
    expect(io.bytes).toContain('\x1b[33m'); // 构造期：dark 基板 + 覆盖 accent 3
    io.reset();
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 亮底应答——重合成
    expect(io.bytes).not.toBe(''); // 重画路过（换装四面重渲染发生了）
    expect(io.bytes).not.toContain('\x1b[34m'); // 覆盖键未被冲掉（丢失则差分必现 4）
    expect(io.bytes).not.toContain('\x1b[36m'); // 亦未回落 dark 裸 accent 6
    io.reset();
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 同板应答——零重画
    expect(io.bytes).toBe('');
    expect(backend.themeChoice).toBe('custom-x');
  });

  it('自定义档 OSC 11 应答重合成：缺键随基板（accent 未覆盖——dark 6 翻 light 4）', () => {
    const { io } = makeBackend({
      sessionId: SESSION,
      theme: 'custom-x',
      customThemeOverlay: { secondary: ansiColor(5) }, // 覆盖非 accent 键
    });
    expect(io.bytes).toContain('\x1b[36m'); // 构造期：dark 基板 accent 6
    io.reset();
    io.emitInput('\x1b]11;rgb:ffff/ffff/ffff\x07'); // 亮底应答
    expect(io.bytes).toContain('\x1b[34m'); // 基板翻 light——缺键回退同位键（accent 4）
    expect(io.bytes).not.toContain('\x1b[36m');
  });

  it('自定义档明暗翻转后同板零重画（dark 应答在 dark 基板期）', () => {
    const { io } = rig({
      theme: 'custom-x',
      customThemeOverlay: { accent: ansiColor(3) },
    });
    io.reset();
    io.emitInput('\x1b]11;rgb:0000/0000/0000\x07'); // 暗底 = 同板（dark 基板）
    expect(io.bytes).toBe('');
  });
});

describe('TuiBackend /marketplace 选装副屏（mp-5——03 §9.6 TUI 选装面）', () => {
  /** 可变模型 rig（host 拥有形——字段替换式变更，readonly 投影给面板） */
  function marketModel() {
    return {
      rows: [
        {
          id: 'hello-plugin@alpha',
          name: 'hello-plugin',
          version: '1.0.0',
          market: 'alpha',
          description: '问好插件',
          installed: false,
        },
        {
          id: 'demo-pkg@alpha',
          name: 'demo-pkg',
          version: '1.2.3',
          market: 'alpha',
          installed: true,
        },
      ],
      tail: ['alpha 跳过：缓存缺 snapshot.json'],
      results: [],
      busyLabel: null as string | null,
    };
  }

  /** rig 同 themes 段（calls 收集位非本面重点——只借进/出屏序锁） */
  function rig() {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset();
    return { io, backend };
  }

  it('openMarketplace 编舞：主屏出屏 → 副屏进 → 选装首帧（头行计数 + ▸ 光标 + 已装徽标 + tail 尾行区）', () => {
    const { io, backend } = rig();
    expect(
      backend.openMarketplace(marketModel(), {
        install: () => {},
        uninstall: () => {},
        upgrade: () => {},
        refresh: () => {},
      }),
    ).toBe(true);
    expect(backend.lifecycle).toBe('suspended');
    expect(io.frames[0]).toBe(MAIN_LEAVE);
    expect(io.frames[1]).toBe(ALT_ENTER);
    expect(io.bytes).toContain('◆ 插件市场 · 2 条目（1 源）');
    expect(io.bytes).toContain('▸ hello-plugin@alpha'); // 光标在首行
    expect(io.bytes).toContain('demo-pkg@alpha 已装'); // 已装徽标
    expect(io.bytes).toContain('alpha 跳过：'); // tail 尾行区
    expect(io.bytes).toContain('↑↓ 移动 · enter 选装/卸载'); // 键面提示行
  });

  it('host 模型变更路（requestAltRepaint）：busyLabel 换装即时落帧 + busy 期动作键锁（enter 零回调 + warn 入挂起缓冲复起补吐）', () => {
    const { io, backend } = rig();
    const model = marketModel();
    const calls: string[] = [];
    backend.openMarketplace(model, {
      install: (id) => calls.push(`install:${id}`),
      uninstall: (id) => calls.push(`uninstall:${id}`),
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.reset(); // 清进屏序与首帧——聚焦模型变更补帧
    model.busyLabel = '装机在飞中（marketplace install hello-plugin@alpha）';
    backend.requestAltRepaint();
    expect(io.bytes).toContain('⏳ 装机在飞中'); // busy 底行上屏（host 侧变更经公开面请帧）
    io.reset();
    io.emitInput('\r'); // busy 期 enter——面板锁键第一道（fail-loud + 零回调）
    expect(calls).toEqual([]);
    io.emitInput('q'); // 收屏——复起补吐挂起期 warn（BUSY 锁文）
    expect(backend.lifecycle).toBe('running');
    expect(io.bytes).toContain('动作键锁定');
  });

  it('enter 选定：先收副屏再回调 install（07 §4.1 既有律）+ 未装→install / 已装→uninstall 分叉', () => {
    const { io, backend } = rig();
    const calls: string[] = [];
    const model = marketModel();
    backend.openMarketplace(model, {
      install: (id) => calls.push(`install:${id}`),
      uninstall: (id) => calls.push(`uninstall:${id}`),
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.reset(); // 清进屏序与首帧——聚焦 enter 编舞
    io.emitInput('\r'); // 光标在首行（hello-plugin 未装）→ install
    expect(io.frames[0]).toBe(ALT_LEAVE); // 先收副屏
    expect(backend.lifecycle).toBe('running');
    expect(calls).toEqual(['install:hello-plugin@alpha']);
    // 第二开屏：↓ 移到已装条目 → enter = uninstall 分叉
    backend.openMarketplace(marketModel(), {
      install: (id) => calls.push(`install:${id}`),
      uninstall: (id) => calls.push(`uninstall:${id}`),
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.emitInput('\x1b[B'); // ↓ → demo-pkg（已装）
    io.reset();
    io.emitInput('\r');
    expect(calls.at(-1)).toBe('uninstall:demo-pkg@alpha');
  });

  it('u 换装 / r 刷新面板驻留不收屏 + 副屏占用如实拒（第二开 false）', () => {
    const { io, backend } = rig();
    const calls: string[] = [];
    backend.openMarketplace(marketModel(), {
      install: () => {},
      uninstall: () => {},
      upgrade: (id) => calls.push(`upgrade:${id}`),
      refresh: () => calls.push('refresh'),
    });
    io.reset();
    io.emitInput('\x1b[B'); // ↓ → demo-pkg（已装）
    io.emitInput('u'); // 已装条目 u = 换装回调（驻留——不出屏）
    expect(backend.lifecycle).toBe('suspended'); // 仍在副屏
    expect(calls).toEqual(['upgrade:demo-pkg@alpha']);
    io.emitInput('r'); // r = 刷新回调（驻留）
    expect(calls.at(-1)).toBe('refresh');
    expect(backend.lifecycle).toBe('suspended');
    // 副屏在场再开 = 如实 false（openThemes 同律）
    expect(
      backend.openMarketplace(marketModel(), {
        install: () => {},
        uninstall: () => {},
        upgrade: () => {},
        refresh: () => {},
      }),
    ).toBe(false);
    expect(backend.openThemes([{ name: 'dark', detail: '', broken: false }], 'dark', () => {})).toBe(false);
  });
});

describe('TuiBackend footer 分栏（R6 批 10k——注入门控 + 切焦联动）', () => {
  it('footer 注入：常驻段首画在场（cwd 短名 · 模型名 · 会话短 id）', () => {
    const { io } = makeBackend({
      sessionId: SESSION,
      footer: { cwdLabel: 'berry-agent', modelLabel: 'glm-4.7' },
    });
    expect(io.bytes).toContain('berry-agent · glm-4.7 · sess-aaa'); // 状态行常驻段
  });

  it('切焦联动：onRepaint 后短 id 段随新会话（footer 与焦点同源）', () => {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const backend = new TuiBackend(io, {
      sessionId: SESSION,
      footer: { cwdLabel: 'berry-agent', modelLabel: 'glm-4.7' },
    });
    backend.start();
    io.reset();
    backend.onRepaint('sess-bbbbbbbbbbbb', [], null);
    expect(io.bytes).toContain('berry-agent · glm-4.7 · sess-bbb'); // 短 id 段已迁
  });

  it('注入缺席：状态行无常驻段（门控零扰动——旧形锚）', () => {
    const { io } = makeBackend({ sessionId: SESSION });
    expect(io.bytes).not.toContain('sess-aaa'); // 无 footer——短 id 段不落状态行（title 基线不含会话位）
  });

  it('缺席段缩位不虚报：cwd 注入 model 缺席 = 两段形', () => {
    const { io } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'berry-agent' } });
    expect(io.bytes).toContain('berry-agent · sess-aaa');
  });
});

describe('TuiBackend 候跑提交 + 模型循环键 + footer 模型段活写（挂账解挂批 2026-09-15）', () => {
  /** 键位三件 rig：提交柄记录 opts 第三参 + 模型循环柄计次 */
  function makeKeyRig(options: Partial<TuiBackendOptions> = {}) {
    const io = new MemoryTerminalIO(COLS, ROWS);
    const clock = new ManualClock();
    const submitted: Array<[string, string, { queueFollowUp?: boolean } | undefined]> = [];
    const modelCycles: number[] = [];
    const backend = new TuiBackend(io, {
      schedule: clock.schedule,
      cancelSchedule: clock.cancel,
      now: clock.now,
      fpsCap: 1e6,
      sessionId: 's1',
      onSubmit: (sessionId, text, opts) => submitted.push([sessionId, text, opts]),
      onModelCycle: () => modelCycles.push(1),
      ...options,
    });
    backend.start();
    io.bytes = '';
    return { io, backend, clock, submitted, modelCycles, pump: () => clock.advance(1) };
  }

  it('alt+enter（kitty 13;3u）→ onSubmit 第三参携候跑标记；enter 提交无标记', () => {
    const { io, submitted, pump } = makeKeyRig();
    io.emitInput('候跑文');
    pump();
    io.emitInput('\x1b[13;3u'); // kitty 形 alt+enter
    pump();
    io.emitInput('普通文');
    pump();
    io.emitInput('\r');
    pump();
    // 键序可区分：两提交文本互异 + 标记位互异
    expect(submitted).toEqual([
      ['s1', '候跑文', { queueFollowUp: true }],
      ['s1', '普通文', undefined],
    ]);
  });

  it('ctrl+p → onModelCycle 柄（层③.5 应用动作路）；柄缺席不炸', () => {
    const withHandle = makeKeyRig();
    withHandle.io.emitInput('\x10'); // ctrl+p
    withHandle.pump();
    expect(withHandle.modelCycles).toHaveLength(1);

    const io = new MemoryTerminalIO(COLS, ROWS);
    const bare = new TuiBackend(io, { sessionId: 's1' }); // 柄缺席形
    bare.start();
    io.bytes = '';
    io.emitInput('\x10'); // 不炸（缺席 = 键不劫持）
    expect(io.bytes).toBe('');
  });

  it('setFooterModel 活写：footer 模型段即时换新（footer 门控内）；注入缺席零扰动', () => {
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      footer: { cwdLabel: 'berry-agent', modelLabel: 'glm-4.7' },
    });
    expect(io.bytes).toContain('berry-agent · glm-4.7 · sess-aaa');
    io.reset();
    backend.setFooterModel('claude-sonnet-5');
    expect(io.bytes).toContain('berry-agent · claude-sonnet-5 · sess-aaa'); // 模型段已换
    expect(io.bytes).not.toContain('glm-4.7');
    // 注入缺席 = 无 footer 常驻段：活写 no-op（门控零扰动——旧形锚）
    const bare = makeBackend({ sessionId: SESSION });
    bare.io.reset();
    bare.backend.setFooterModel('glm-4.7');
    expect(bare.io.bytes).toBe('');
  });
});

describe('TuiBackend 固定区段优先级截断（07 §4.1 挂账解挂批 C②——极小终端固定区溢出）', () => {
  /** 极小形载荷：8 条 todo（量高 7 = 帽 6 + 溢出行）+ footer 注入（状态行常驻段可观测） */
  const manyTodos = Array.from({ length: 8 }, (_, i) => ({ status: 'pending' as const, content: `任务零${i}` }));

  it('rows 缩至 5：低段（todo）整段隐零高度——状态行钉屏底 + 编辑器下限在场 + 无越屏定位', () => {
    const io = new MemoryTerminalIO(COLS, 12); // 先宽后窄：宽形（12 行）无截断全量进画，让 todo 7 行先进场
    const backend = new TuiBackend(io, { sessionId: SESSION, footer: { cwdLabel: 'proj' }, todoFor: () => manyTodos });
    backend.start();
    // todo 进场锚点：tool_execution_end（refreshTodo 三时点之二——tool 未开档 end 无行，纯 todo 形）
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    io.bytes = ''; // 宽形中间帧不计——聚焦缩窗后的全量重画帧
    io.rows = 5;
    io.emitResize(); // 极小形：截断目标 = 固定区总高 ≤ 视口 - 1 = 4（正文滚动区至少 1 行）
    // 截断后固定区 = 编辑器下限 3（边框 2 + 内容 1）+ 状态行 1：状态行钉屏底（0 基第 4 行）
    expect(io.bytes).toContain('\x1b[5;1H\x1b[0mproj · sess-aaa'); // 状态行恒保底且钉屏底（修前钉在第 11 行）
    expect(io.bytes).toContain('┌'); // 输入框高优段保序在场（随 R3 高度帽自适应收窄至下限）
    expect(io.bytes).not.toContain('任务零0'); // 低段整段隐——零高度不虚报（修前 7 行全量进画）
    expect(io.bytes).not.toContain('\x1b[6;1H'); // 无越屏定位（修前固定区 11 行越 5 行屏）
  });

  it('rows 缩至 8：低段先缩不隐——todo 收到 1 行 + 正文滚动区非退化', () => {
    const io = new MemoryTerminalIO(COLS, 12); // 同上先宽（12 行全量 11 ≤ 预算 11 无截断）后窄
    const backend = new TuiBackend(io, { sessionId: SESSION, footer: { cwdLabel: 'proj' }, todoFor: () => manyTodos });
    backend.start();
    emit(backend, { type: 'tool_execution_end', toolCallId: 't1', result: {} as never });
    io.bytes = '';
    io.rows = 8;
    io.emitResize(); // 预算 7：todo 缩 1 + 编辑器 3 + 状态行 1 = 5 ≤ 7——「先缩后隐」之缩形
    expect(io.bytes).toContain('任务零0'); // todo 缩到 1 行——首条在场（段在场）
    expect(io.bytes).not.toContain('任务零1'); // 缩掉的不虚报（修前 6 条全量进画）
    // 固定区总高 5 → 滚动区底 = 8 - 5 = 3（修前总高 11 → 退化 [1;1r + 越屏定位）
    expect(io.bytes).toContain('\x1b[1;3r');
    expect(io.bytes).not.toContain('\x1b[9;1H'); // 无越屏定位（修前写到第 11 行）
  });
});

describe('TuiBackend footer git 短支名段（07 §4.1 挂账解挂批②——直读 .git/HEAD 零子进程）', () => {
  /** 临时 git 库：.git 目录 + HEAD 定值（ref: 形传 `ref: refs/heads/<支>`、detached 形传 40hex） */
  function makeRepo(head: string): string {
    const root = mkdtempSync(join(tmpdir(), 'berry-git-'));
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'HEAD'), `${head}\n`);
    return root;
  }
  const ref = (branch: string): string => `ref: refs/heads/${branch}`;

  it('注入 cwdPath：cwd 段带 ⎇ 短支名后缀（同段一体非第四段）', () => {
    const root = makeRepo(ref('feature/tui-face'));
    const { io } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'proj', cwdPath: root } });
    expect(io.bytes).toContain('proj ⎇ feature/tui-face · sess-aaa');
  });

  it('父级库命中：cwd 在子目录同样取到支名（cwd 起向上逐级定位 .git）', () => {
    const root = makeRepo(ref('dev'));
    const sub = join(root, 'src', 'inner');
    mkdirSync(sub, { recursive: true });
    const { io } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'proj', cwdPath: sub } });
    expect(io.bytes).toContain('proj ⎇ dev · sess-aaa');
  });

  it('detached HEAD：后缀缺席不虚报（cwd 段原样缩位）', () => {
    const root = makeRepo('0123456789abcdef0123456789abcdef01234567');
    const { io } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'proj', cwdPath: root } });
    expect(io.bytes).toContain('proj · sess-aaa');
    expect(io.bytes).not.toContain('⎇');
  });

  it('非 git 目录：后缀缺席（同 detached 形——不虚报）', () => {
    const root = mkdtempSync(join(tmpdir(), 'berry-nogit-'));
    const { io } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'proj', cwdPath: root } });
    expect(io.bytes).toContain('proj · sess-aaa');
    expect(io.bytes).not.toContain('⎇');
  });

  it('checkout 收敛：改写 HEAD 后 onRepaint 重算换支名（刷新锚 = 切焦联动既有路）', () => {
    const root = makeRepo(ref('old-branch'));
    const { io, backend } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'proj', cwdPath: root } });
    expect(io.bytes).toContain('proj ⎇ old-branch · sess-aaa');
    writeFileSync(join(root, '.git', 'HEAD'), `${ref('new-branch')}\n`); // 模拟 checkout
    io.reset();
    backend.onRepaint(SESSION, [], null);
    expect(io.bytes).toContain('proj ⎇ new-branch · sess-aaa'); // 每调现读——重算取新值
    expect(io.bytes).not.toContain('old-branch');
  });

  it('resize 收敛：改支名后 emitResize 重算（刷新锚 = resize 全量重画同收敛）', () => {
    const root = makeRepo(ref('wip'));
    const { io } = makeBackend({ sessionId: SESSION, footer: { cwdLabel: 'proj', cwdPath: root } });
    writeFileSync(join(root, '.git', 'HEAD'), `${ref('release')}\n`); // 模拟 checkout
    io.reset();
    io.rows = 11;
    io.emitResize();
    expect(io.bytes).toContain('proj ⎇ release · sess-aaa');
  });

  it('onRepaint 无 footer 注入：常驻段不开（门控零扰动——修前红锚：refreshFooter 此前无门控）', () => {
    const { io, backend } = makeBackend({ sessionId: SESSION });
    io.reset();
    backend.onRepaint(SESSION, [], null);
    // 修前：refreshFooter 无门控恒拼段 → 状态行被开常驻段（SGR 包裹的分栏 footer 行）
    expect(io.bytes).not.toContain('\x1b[0msess-aaa\x1b[0m');
  });
});
