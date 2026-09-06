/**
 * TuiBackend 组合测试（批 10e-1——MemoryTerminalIO 注入全链收帧）。
 *
 * 覆盖：UiBackend 契约面（capabilities/hasAudience）、直播呈现全链
 * （聚焦流式两段 / 非聚焦摘要行）、状态面消费（转轮/工具名/启停）、
 * notify 档位符号、setStatus、tick 推帧、onRepaint 投影重建、resize 自订阅。
 */
import { describe, expect, it } from 'vitest';
import { MemoryTerminalIO } from '../../engine/index.js';
import { TuiBackend } from './tui-backend.js';
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
  it('id / capabilities / hasAudience（阻塞原语缺席报 false——10e-2 接 overlay 族）', () => {
    const { backend } = makeBackend();
    expect(backend.id).toBe('tui');
    expect(backend.capabilities).toEqual({
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false, // 审批面板呈现归批 10e-2 交互纵切（批内翻真）
      setStatus: true,
      setWidget: false,
    });
    expect(backend.hasAudience()).toBe(true);
  });

  it('start：清屏 + 滚动区 + 固定区首画（状态行 + › 输入占位）', () => {
    const { io } = makeBackend();
    expect(io.bytes).toContain('\x1b[2J\x1b[H');
    expect(io.bytes).toContain('\x1b[1;8r');
    expect(io.bytes).toContain('\x1b[2m›'); // 输入占位行 dim 提示符
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
    expect(io.bytes).toContain('\x1b[1;4r'); // 6 行 - 固定区 2 = DECSTBM 1..4
    expect(io.bytes).toContain('\r> 内容\n'); // 行集重画
  });
});
