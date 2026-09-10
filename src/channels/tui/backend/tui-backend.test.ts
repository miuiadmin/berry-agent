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
 * 保活周期重发。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO } from '../../engine/index.js';
import { TuiBackend, type TuiBackendOptions } from './tui-backend.js';
import { buildSgr } from './ansi-rows.js';
import { sessionColor } from '../theme.js';
import { AltScreenHost } from '../overlay/alt-screen.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { MemoryViewerDataDeps } from '../memory/memory-viewer.js';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage } from '../../../contracts/index.js';

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

/** 交互 rig：注入调度 + 高 fps 帧帽（帧间隔 ~0——advance 即泵帧） */
function makeInteractive(options: Partial<TuiBackendOptions> = {}) {
  const io = new MemoryTerminalIO(COLS, ROWS);
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
});

describe('TuiBackend 补全弹层（三源路由）', () => {
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
    const { io, clock, calls, pump } = autocompleteRig();
    io.emitInput('/he');
    pump();
    expect(io.bytes).toContain('/help'); // 弹层 label 在场
    expect(io.bytes).toContain('帮助'); // detail 右对齐段
    io.emitInput('\t'); // 应用代换
    pump();
    io.emitInput('\r'); // 提交代换后命令
    pump();
    expect(calls.submitted).toEqual([['s1', '/help']]); // 命令柄缺席——'/' 文本落 onSubmit（trim 后）
    io.bytes = '';
    io.emitInput('\x1b'); // escape 关层（新轮）
    escapePump(clock);
    expect(io.bytes).not.toContain('帮助'); // 弹层已隐
  });

  it('命令名已终结 → 参数段源路由（commandArguments 收命令名与 query）', () => {
    const { io, argCalls, pump } = autocompleteRig();
    io.emitInput('/help ');
    io.emitInput('ar');
    pump();
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
  it('suspendMain 编舞：出屏串 + 停流 + raw 复先验 + 卸输入监听 + lifecycle 迁移', () => {
    const { io, backend } = makeBackend();
    expect(backend.lifecycle).toBe('running');
    io.reset();
    backend.suspendMain();
    expect(io.frames[0]).toBe(MAIN_LEAVE); // 出屏模式串（与 start 进屏对称反序）
    expect(io.pauseCount).toBe(1); // 停流（共享 io 换防——副屏随后 start 放流）
    expect(io.raw).toBe(false); // raw 复先验（MemoryTerminalIO 起始 false）
    expect(backend.lifecycle).toBe('suspended');
    io.reset();
    io.emitInput('x'); // 输入已卸订——编辑器不经手（无 echo 字节）
    expect(io.bytes).toBe('');
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
      },
    ];
    return {
      ownerKeys: ['global'],
      dao: {
        listVisible: () => rows,
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
  function memoryRig() {
    const calls: RigCalls = { submitted: [], interrupted: [], quit: 0, dispatched: [] };
    const { io, backend } = makeBackend({
      sessionId: SESSION,
      onInterrupt: (sessionId) => calls.interrupted.push(sessionId),
      onQuit: () => {
        calls.quit += 1;
      },
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
});
