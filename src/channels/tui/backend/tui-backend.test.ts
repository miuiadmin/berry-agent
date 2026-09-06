/**
 * TuiBackend 组合测试（批 10e-1 呈现 + 批 10e-2 交互纵切）。
 *
 * 覆盖：UiBackend 契约面（capabilities/hasAudience）、直播呈现全链
 * （聚焦流式两段 / 非聚焦摘要行）、状态面消费（转轮/工具名/启停）、
 * notify 档位符号、setStatus、tick 推帧、onRepaint 投影重建、resize 自订阅；
 * 交互纵切（10e-2）：自持输入管线与路由四层、提交路由（命令柄/应答优先）、
 * 补全弹层三源、阻塞四件浮层面板、渲染合并与 tick 自驱（手动时钟 rig）。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO } from '../../engine/index.js';
import { TuiBackend, type TuiBackendOptions } from './tui-backend.js';
import { buildSgr } from './ansi-rows.js';
import { sessionColor } from '../theme.js';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage } from '../../../contracts/index.js';

const COLS = 80;
const ROWS = 10;
const SESSION = 'sess-aaaaaaaaaa';

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

function makeBackend(): { io: MemoryTerminalIO; backend: TuiBackend } {
  const io = new MemoryTerminalIO(COLS, ROWS);
  const backend = new TuiBackend(io);
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
    const p1 = backend.askApproval({ summary: '写文件', toolName: 'write', suggestedEntry: '/tmp/x' });
    pump();
    expect(io.bytes).toContain('⚙ write：写文件'); // 工具名标题
    expect(io.bytes).toContain('/tmp/x'); // always 草案 hint 段
    io.emitInput('\r'); // 高亮首项 = 批准
    pump();
    await expect(p1).resolves.toBe('approve');

    const p2 = backend.askApproval({ summary: '二' });
    pump();
    io.emitInput('\x1b[B\x1b[B'); // ↓↓ = 总是批准
    pump();
    io.emitInput('\r');
    pump();
    await expect(p2).resolves.toBe('always');

    const p3 = backend.askApproval({ summary: '三' });
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
