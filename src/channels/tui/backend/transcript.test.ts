/**
 * LiveTranscript 渲染归约测试（批 10e-1——纯逻辑零 IO）。
 *
 * 覆盖：流式两段（开槽/直换/定稿换装）、流式单槽守卫、唯一渲染源律
 * （tool_execution_* 正文零渲染）、非聚焦摘要行分档、投影重建、帽卸载。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ansiColor, CellGrid, sanitizeDisplayText, stringWidth } from '../../engine/index.js';
import type { TodoItem } from '../../types.js';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage, AssistantMessage } from '../../../contracts/index.js';
import { ccrMarkerLine } from '../../../contracts/index.js';
import { LIGHT_PALETTE, resolveTheme, DEFAULT_THEME } from '../theme/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { DIM_STYLE } from '../markdown/layout.js';
import type { ToolCardGroupData } from '../blocks/tool-card.js';
import { renderThinkingStyledLines } from '../blocks/thinking.js';
import {
  dialogueBlockCount,
  forkEditAnchorsOf,
  LiveTranscript,
  renderBlockLines,
  renderBlockStyledLines,
  renderSlotTailLines,
  shortIdOf,
  stableSlotLineCount,
  TRANSCRIPT_BLOCK_CAP,
  type TranscriptBlock,
} from './transcript.js';
import { buildSgr, docRowToStyledLine, gridRowToStyled, styledLineToAnsi } from './ansi-rows.js';

/** 直构槽块（测试速构——思考面缺席位 = 零思考槽形，批 10i 字段族全数到场） */
const slotOf = (epoch: number, text: string, doc: StreamingMarkdown | null): TranscriptBlock => ({
  kind: 'streaming',
  epoch,
  text,
  doc,
  thinking: '',
  thinkingDoc: null,
  thinkingSettled: false,
  thinkingExpanded: false,
  thinkingStartAt: null,
  thinkingSettledAt: null,
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

/* ---------------- 消息工厂 ---------------- */

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function userMsg(text: string, source?: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 1, ...(source !== undefined ? { source: source as never } : {}) };
}

function assistantMsg(
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [],
  thinking = '',
  /** 失败终态位（P0 静默链修复批）——在场时落 stopReason=error + errorMessage */
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      ...(thinking !== '' ? [{ type: 'thinking' as const, thinking }] : []),
      ...(text !== '' ? [{ type: 'text' as const, text }] : []),
      ...toolCalls.map((call) => ({ type: 'toolCall' as const, ...call })),
    ],
    usage,
    stopReason: errorMessage !== undefined ? 'error' : 'stop',
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: 1,
  };
}

function toolResultMsg(
  text: string,
  over: { isError?: boolean; details?: unknown; toolCallId?: string } = {},
): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: over.toolCallId ?? 'tc1',
    toolName: 'read',
    content: text !== '' ? [{ type: 'text', text }] : [],
    isError: over.isError ?? false,
    timestamp: 1,
    ...(over.details !== undefined ? { details: over.details } : {}),
  };
}

function apply(t: LiveTranscript, event: AgentEvent, focused = true): void {
  t.applyEvent({ sessionId: 'sess-aaaaaaaaaa', event }, focused);
}

/* ---------------- 聚焦归约 ---------------- */

describe('LiveTranscript 聚焦归约', () => {
  it('message_start 开流式槽（空文本 streaming 末块——直推档携 StreamingMarkdown）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    expect(t.snapshot).toHaveLength(1);
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot).toMatchObject({ kind: 'streaming', epoch: 1, text: '' });
    expect(slot.doc).toBeInstanceOf(StreamingMarkdown); // markdown 直推档随槽建
  });

  it('message_update 槽文本直换（partial 完整快照非追加——doc 同步增量装配）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好') });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('你好，世界') });
    expect(t.snapshot).toHaveLength(1);
    expect(t.snapshot[0]).toMatchObject({ kind: 'streaming', epoch: 1, text: '你好，世界' });
    // doc 与 text 同源（直推档非装饰位——渲染面真消费）
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(renderBlockLines(slot, 20, false)[0]).toContain('你好，世界'); // R-1 豁免位——内容行即首行
  });

  it('message_update 在无槽时零效果（配对守卫）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('孤儿') });
    expect(t.snapshot).toHaveLength(0);
  });

  it('message_end 定稿换装：摘槽 → markdown 块；toolCall 入在飞账不落行（批 10i R4——直播路在飞期零正文行）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('部分') });
    apply(t, {
      type: 'message_end',
      message: assistantMsg('看 `npm test`', [{ id: 'tc1', name: 'read', arguments: { path: 'a.ts' } }]),
    });
    expect(t.snapshot).toHaveLength(1);
    expect(t.snapshot[0]!).toMatchObject({ kind: 'markdown' });
  });

  it('message_end 空文本带 toolCall → 零块（在飞账不落行、无空 markdown 块）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'tc1', name: 'ls', arguments: {} }]) });
    expect(t.snapshot).toEqual([]);
  });

  it('message_end errorMessage 非空 → 错误块落位（P0 静默点①——失败终态正文可见）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, {
      type: 'message_end',
      message: assistantMsg('半途文本', [], '', 'Provider is not configured: anthropic'),
    });
    const blocks = t.snapshot;
    // 错误块在场（✗ 前缀 + error 语义色整行）；text 块照常渲染、错误块追加于其后
    const err = blocks.find((b) => b.kind === 'error');
    expect(err).toBeDefined();
    const lines = renderBlockStyledLines(err!, 40, false); // R-1 豁免位
    expect(lines.some((line) => line.plain.includes('Provider is not configured'))).toBe(true);
    expect(lines[0]!.runs.length).toBeGreaterThan(0); // 前景样式整行在场
    expect(blocks.find((b) => b.kind === 'markdown')).toBeDefined();
    // 块序：markdown 在前、error 收尾（正文先行错误收尾）
    expect(blocks.findIndex((b) => b.kind === 'markdown')).toBeLessThan(blocks.indexOf(err!));
  });

  it('投影重建（repaint）：errorMessage 非空同样落错误块（直播/repaint 两路同源）', () => {
    const t = new LiveTranscript();
    t.loadProjection([userMsg('问'), assistantMsg('', [], '', 'Provider is not configured: anthropic')]);
    expect(t.snapshot.some((b) => b.kind === 'error')).toBe(true);
  });

  it('错误块 JSON 可读化（界面美化役批⑦——401/403 裸 JSON 体先摘要后原文）', () => {
    // error.message 嵌套形：引导语收编为摘要前缀、message 字段成首行可读摘要
    const text = 'Provider 401: {"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}';
    const styled = renderBlockStyledLines({ kind: 'error', text, theme: DEFAULT_THEME }, 100, false); // R-1 豁免位
    expect(styled[0]!.plain).toBe('✗ Provider 401：Incorrect API key provided');
    // 原文随后保留（折行展开可见——诚实保真不吞原文）
    expect(
      styled
        .slice(1)
        .map((line) => line.plain)
        .join('\n'),
    ).toContain('"error"');
    // 顶层 message 直取形
    const top = renderBlockStyledLines(
      { kind: 'error', text: '{"message":"rate limit exceeded"}', theme: DEFAULT_THEME },
      100,
      false,
    );
    expect(top[0]!.plain).toBe('✗ rate limit exceeded');
    // 无 message 只 status：数值收编为摘要（403 类网关体）
    const statusOnly = renderBlockStyledLines(
      { kind: 'error', text: '{"status":403}', theme: DEFAULT_THEME },
      100,
      false,
    );
    expect(statusOnly[0]!.plain).toBe('✗ 403');
    // 非 JSON / 无可提取字段 = 原样（诚实退原形）
    const plainText = renderBlockStyledLines(
      { kind: 'error', text: '连接超时（30s）', theme: DEFAULT_THEME },
      100,
      false,
    );
    expect(plainText[0]!.plain).toBe('✗ 连接超时（30s）');
    const noField = renderBlockStyledLines({ kind: 'error', text: '{"foo":"bar"}', theme: DEFAULT_THEME }, 100, false);
    expect(noField[0]!.plain).toBe('✗ {"foo":"bar"}');
  });

  it('流式单槽守卫：重开 message_start 先摘旧槽（占位不孤儿滞留——epoch 递增）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('旧') });
    apply(t, { type: 'message_start', role: 'assistant' });
    expect(t.snapshot).toHaveLength(1);
    expect(t.snapshot[0]).toMatchObject({ kind: 'streaming', epoch: 2, text: '' }); // 新槽新账
  });

  it('setStreamingPlain 降档：当前槽弃 doc 走纯文本（epoch/text 保位——冻结账随换帧作废）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('看 `npm` 命令') });
    t.setStreamingPlain();
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot.doc).toBeNull();
    expect(slot.epoch).toBe(1); // 槽同一性保位（非重开）
    expect(slot.text).toBe('看 `npm` 命令');
    // 降档后渲染 = 纯文本折行（零 ANSI 网格管线）；注⑩ bullet 槽——降档腿与
    // doc 腿同轴（首行 • 续行两空格——热路径与定稿渲染恒一致；R-4 前缀 dim）
    expect(renderBlockLines(slot, 40, false)).toEqual(['\x1b[2m• \x1b[0m看 `npm` 命令']); // R-1 豁免位
  });

  it('setStreamingPlain 无槽零效果（防御）', () => {
    const t = new LiveTranscript();
    expect(() => t.setStreamingPlain()).not.toThrow();
    expect(t.snapshot).toHaveLength(0);
  });

  it('setTheme 换装：后续新建 doc 生效（codeInline 键双板降采可辨）', () => {
    const t = new LiveTranscript();
    t.setTheme(resolveTheme(LIGHT_PALETTE, '16'));
    apply(t, { type: 'message_end', message: assistantMsg('看 `npm` 命令') });
    const doc = (t.snapshot[0] as { kind: 'markdown'; doc: MarkdownDoc }).doc;
    const styled = renderBlockStyledLines({ kind: 'markdown', doc }, 40, false); // R-1 豁免位
    const codeRun = styled[0]!.runs.find((r) => r.style.fg !== undefined);
    expect(codeRun?.style.fg).toBe(ansiColor(6)); // light 板 #1b7c83 @16 → 青 6（dark 板为亮青 14——双板可辨；R-3 cyan 翻档随迁）
  });

  it('user / toolResult 的 message_end 追加对应块', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: userMsg('帮我看下') });
    apply(t, { type: 'message_end', message: toolResultMsg('第 1 行输出\n第 2 行') });
    expect(t.snapshot).toEqual([
      { kind: 'user', text: '帮我看下', theme: DEFAULT_THEME },
      { kind: 'tool-result', brief: '第 1 行输出' },
    ]);
  });

  it('toolResult 无文本块 → 占位简述', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: toolResultMsg('') });
    expect(t.snapshot).toEqual([{ kind: 'tool-result', brief: '(无文本输出)' }]);
  });

  it('唯一渲染源律：tool_execution_* 与 turn 族正文零渲染', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'turn_start', turn: 1 });
    apply(t, { type: 'tool_execution_start', toolCallId: 'tc1', name: 'read', arguments: {} });
    apply(t, { type: 'tool_execution_update', toolCallId: 'tc1', update: { progress: 1 } });
    apply(t, { type: 'tool_execution_end', toolCallId: 'tc1', result: {} as never });
    apply(t, { type: 'turn_end', turn: 1, stopReason: 'stop' });
    apply(t, { type: 'agent_start' });
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot).toHaveLength(0);
  });
});

/* ---------------- 非聚焦零呈现（V-0 注①瀑布退役） ---------------- */

describe('LiveTranscript 非聚焦零呈现（TUI 视觉重设计批 V-1 笔2——07 §4.1 V-0 注①聚合律）', () => {
  it('非聚焦 agent_start/agent_end 零摘要行产出（瀑布退役——重试循环不再逐行刷流）', () => {
    const t = new LiveTranscript();
    expect(apply(t, { type: 'agent_start' }, false)).toBeUndefined();
    expect(apply(t, { type: 'agent_end', status: 'completed' }, false)).toBeUndefined();
    expect(apply(t, { type: 'agent_end', status: 'failed' }, false)).toBeUndefined();
    expect(apply(t, { type: 'agent_end', status: 'aborted' }, false)).toBeUndefined();
  });

  it('非聚焦消息族零产出且不建账', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: userMsg('后台会话') }, false);
    expect(t.snapshot).toHaveLength(0);
  });

  it('shortIdOf 取前八位', () => {
    expect(shortIdOf('abcdefgh12345678')).toBe('abcdefgh');
    expect(shortIdOf('短')).toBe('短');
  });
});

/* ---------------- user 块 source 过滤（V-0 注①机器注入族零呈现） ---------------- */

describe('LiveTranscript user 块 source 过滤（批 V-1 笔2——subagent 族注入零呈现归 JobPanel）', () => {
  it('直播路：subagent-settled/approval-pending 注入零 user 块；真用户照常渲染', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: userMsg('结算通知', 'subagent-settled') });
    apply(t, { type: 'message_end', message: userMsg('审批挂起', 'subagent-approval-pending') });
    apply(t, { type: 'message_end', message: userMsg('真用户', 'user') });
    apply(t, { type: 'message_end', message: userMsg('缺省源') });
    const users = t.snapshot.filter((b) => b.kind === 'user');
    expect(users.map((b) => (b as { text: string }).text)).toEqual(['真用户', '缺省源']);
  });

  it('投影路（loadProjection）：同滤——机器注入族不进块账', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userMsg('结算通知', 'subagent-settled'),
      userMsg('真用户'),
      userMsg('审批挂起', 'subagent-approval-pending'),
    ]);
    const users = t.snapshot.filter((b) => b.kind === 'user');
    expect(users.map((b) => (b as { text: string }).text)).toEqual(['真用户']);
  });
});

/* ---------------- 压缩时间线分隔行（07 B2 批 2——source='compaction' 载体替换呈现） ---------------- */

/** 摘要载体速构（fiveStep 真实落账形：前缀 + 正文 + CCR 标记段末行——标记行走 contracts ccrMarkerLine 单源构造，格式知识零复刻） */
const compactionCarrier = (markerLine?: string): AgentMessage =>
  userMsg(`[COMPACTION-SUMMARY] 摘要正文${markerLine !== undefined ? `\n\n${markerLine}` : ''}`, 'compaction');

const CARRIER_WITH_MARKER = compactionCarrier(ccrMarkerLine({ hash: 'abcdef0123456789', messages: 5, chars: 287 }));

describe('LiveTranscript 压缩时间线分隔行（B2 批 2——载体 user 块零呈现替换为分隔行）', () => {
  it('直播路：载体零 user 块、落 compaction 分隔块（N 解析自 CCR 标记段末行）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: CARRIER_WITH_MARKER });
    expect(t.snapshot.filter((b) => b.kind === 'user')).toHaveLength(0); // 修前红锚：改前呈 user 块
    const separators = t.snapshot.filter((b) => b.kind === 'compaction');
    expect(separators).toHaveLength(1);
    expect(separators[0]).toMatchObject({ kind: 'compaction', count: 5 });
  });

  it('投影路（loadProjection）：同判据两路一致——分隔块在位、user 块零', () => {
    const t = new LiveTranscript();
    t.loadProjection([userMsg('压缩前的真用户'), CARRIER_WITH_MARKER, userMsg('压缩后的真用户')]);
    const users = t.snapshot.filter((b) => b.kind === 'user');
    expect(users.map((b) => (b as { text: string }).text)).toEqual(['压缩前的真用户', '压缩后的真用户']);
    const separators = t.snapshot.filter((b) => b.kind === 'compaction');
    expect(separators).toHaveLength(1);
    expect(separators[0]).toMatchObject({ kind: 'compaction', count: 5 });
  });

  it('旧载体降级（CCR 批前历史——无标记段）：count 缺席形', () => {
    const t = new LiveTranscript();
    t.loadProjection([compactionCarrier()]);
    const separators = t.snapshot.filter((b) => b.kind === 'compaction');
    expect(separators).toHaveLength(1);
    expect(separators[0]).toMatchObject({ kind: 'compaction' });
    expect((separators[0] as { count?: number }).count).toBeUndefined();
  });

  it('渲染：dim 分隔行（N 形 / 降级形）── 回合记账线族同款', () => {
    expect(renderBlockStyledLines({ kind: 'compaction', count: 5 }, 80, false)).toEqual([
      // R-1 豁免位
      { plain: '── 已压缩 5 条对话 ──', runs: [{ start: 0, end: '── 已压缩 5 条对话 ──'.length, style: DIM_STYLE }] },
    ]);
    expect(renderBlockStyledLines({ kind: 'compaction' }, 80, false)).toEqual([
      { plain: '── 已压缩 ──', runs: [{ start: 0, end: '── 已压缩 ──'.length, style: DIM_STYLE }] },
    ]);
  });
});

/* ---------------- 起跑回执卡体抑制（V-0 注①——background 委派） ---------------- */

describe('LiveTranscript 起跑回执卡体抑制（批 V-1 笔2——background agent 卡体空、卡头保留）', () => {
  it('background agent 调用 → 卡体零行（起跑回执退役入面板行——模型面结果文本不动）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'agent', arguments: { prompt: 'x', background: true } }]),
    });
    apply(t, { type: 'message_end', message: toolResultMsg('子代理「调研」已转后台运行', { toolCallId: 'tc1' }) });
    const card = t.snapshot.find((b) => b.kind === 'tool-card') as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(card).toBeDefined();
    expect(card.name).toBe('agent'); // 卡头保留（调用可辨）
    expect(card.body).toEqual([]); // 卡体零行——正文流零过程事件
  });

  it('对照：one-shot agent / 普通工具卡体照常（抑制面 = background 委派族恰一形）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'agent', arguments: { prompt: 'x' } }]),
    });
    apply(t, { type: 'message_end', message: toolResultMsg('调研结论正文', { toolCallId: 'tc1' }) });
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc2', name: 'read', arguments: { path: 'a.ts' } }]),
    });
    apply(t, { type: 'message_end', message: toolResultMsg('文件内容', { toolCallId: 'tc2' }) });
    apply(t, { type: 'agent_end', status: 'completed' }); // read 入探索窗——收口补落单卡（N=1 < 2）
    const cards = t.snapshot.filter((b) => b.kind === 'tool-card') as Array<
      Extract<TranscriptBlock, { kind: 'tool-card' }>
    >;
    expect(cards[0]!.body.length).toBeGreaterThan(0); // one-shot 结果正文照常
    expect(cards[1]!.body.length).toBeGreaterThan(0); // 普通工具照常
  });
});

/* ---------------- 投影重建与帽 ---------------- */

describe('LiveTranscript 投影重建与帽', () => {
  it('loadProjection 重建 user/assistant/toolResult 三形（批 10i R4——配对落卡，直播/repaint 同构）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userMsg('问题'),
      assistantMsg('**答**', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x', path: 'y' } }]),
      toolResultMsg('命中 3 处'),
    ]);
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'markdown', 'tool-card']);
    expect(t.snapshot[1]).toMatchObject({ kind: 'markdown' });
    expect(t.snapshot[2]).toMatchObject({
      kind: 'tool-card',
      name: 'grep',
      brief: '(模式=x, 路径=y)',
      status: 'success',
      diff: false,
    });
  });

  it('loadProjection 自定义角色宽容跳过', () => {
    const t = new LiveTranscript();
    t.loadProjection([{ role: 'memory/recall', content: { q: 1 }, timestamp: 1 }, userMsg('问题')]);
    expect(t.snapshot).toEqual([{ kind: 'user', text: '问题', theme: DEFAULT_THEME }]);
  });

  it('argsBrief 键位中文化 + 白名单扩容（07 §4.1 V-0 注⑤参数签名键位——prompt/background 入列）', () => {
    // 修前红锚：agent 调用 brief = '(prompt)'（prompt 非白名单只键名）+ background
    // 缺席——裸英文签名形；键位映射后「任务=… 后台=true」人读形
    const t = new LiveTranscript();
    t.loadProjection([
      userMsg('去查'),
      assistantMsg('', [{ id: 'tcA', name: 'agent', arguments: { prompt: '扫描全库找 TODO', background: true } }]),
      toolResultMsg('已派发', { toolCallId: 'tcA' }),
    ]);
    const card = t.snapshot.find((b) => b.kind === 'tool-card') as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(card.brief).toContain('任务=扫描全库找 TODO');
    expect(card.brief).toContain('后台=true');
    expect(card.brief).not.toContain('prompt');
    expect(card.brief).not.toContain('background');
    // 无映射键（插件自定义参数）英文键名直呈兜底
    const t2 = new LiveTranscript();
    t2.loadProjection([
      userMsg('去查'),
      assistantMsg('', [{ id: 'tcB', name: 'custom_probe', arguments: { region: 'ap' } }]),
      toolResultMsg('ok', { toolCallId: 'tcB' }),
    ]);
    const card2 = t2.snapshot.find((b) => b.kind === 'tool-card') as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(card2.brief).toContain('region'); // 映射集外键名零转写
  });

  it('loadProjection 清流式槽位（投影是 durable 快照）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    t.loadProjection([userMsg('重建')]);
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('孤儿') });
    expect(t.snapshot).toEqual([{ kind: 'user', text: '重建', theme: DEFAULT_THEME }]); // slotOpen 已清——update 零效果
  });

  it('帽卸载：超帽从头卸、保留帽内最近段', () => {
    const t = new LiveTranscript();
    const messages: AgentMessage[] = [];
    for (let i = 0; i < TRANSCRIPT_BLOCK_CAP + 5; i++) messages.push(userMsg(`消息 ${i}`));
    t.loadProjection(messages);
    expect(t.blockCount).toBe(TRANSCRIPT_BLOCK_CAP);
    expect(t.snapshot[0]).toEqual({ kind: 'user', text: '消息 5', theme: DEFAULT_THEME }); // 前 5 条卸载
  });

  it('帽参数化（批 10f-4）：自定义帽截段——保留帽内最近段', () => {
    const t = new LiveTranscript({ blockCap: 3 });
    const messages = [userMsg('一'), userMsg('二'), userMsg('三'), userMsg('四'), userMsg('五')];
    t.loadProjection(messages);
    expect(t.blockCount).toBe(3);
    expect(t.snapshot.map((b) => (b.kind === 'user' ? b.text : b.kind))).toEqual(['三', '四', '五']); // 帽 3 内最近段
  });

  it('帽参数化：全量档 Infinity 不截（件 8 回看器数据范围——全量 durable 正文）', () => {
    const t = new LiveTranscript({ blockCap: Number.POSITIVE_INFINITY });
    const messages: AgentMessage[] = [];
    for (let i = 0; i < TRANSCRIPT_BLOCK_CAP + 5; i++) messages.push(userMsg(`消息 ${i}`));
    t.loadProjection(messages);
    expect(t.blockCount).toBe(TRANSCRIPT_BLOCK_CAP + 5); // 全量——块数不被截
    expect(t.snapshot[0]).toEqual({ kind: 'user', text: '消息 0', theme: DEFAULT_THEME }); // 首条仍在场
  });

  it('帽参数化：缺省不传 = 主屏帽 500（主屏调用面零变化）', () => {
    const t = new LiveTranscript();
    const messages: AgentMessage[] = [];
    for (let i = 0; i < TRANSCRIPT_BLOCK_CAP + 1; i++) messages.push(userMsg(`m${i}`));
    t.loadProjection(messages);
    expect(t.blockCount).toBe(TRANSCRIPT_BLOCK_CAP);
  });

  it('裁块计数观测面（批 10k 遗漏修）：帽饱和累加 + 再投影重建不回退', () => {
    const t = new LiveTranscript({ blockCap: 3 });
    const messages = [userMsg('一'), userMsg('二'), userMsg('三'), userMsg('四'), userMsg('五')];
    t.loadProjection(messages);
    expect(t.trimmedBlockCount).toBe(2); // 5 块入帽 3——前缀裁 2
    // 直播路续增：再入两块裁两块（对账输入持续累加——MainScreen 绝对位依据）
    apply(t, { type: 'message_end', message: userMsg('六') });
    apply(t, { type: 'message_end', message: userMsg('七') });
    expect(t.blockCount).toBe(3);
    expect(t.trimmedBlockCount).toBe(4);
    // 再投影重建：走查重裁同段——计数不回退（blocks 整体替换后 trim 仍按帽裁）
    t.loadProjection(messages);
    expect(t.trimmedBlockCount).toBe(6); // 4 + 重建再裁 2（账单调递增——绝对位不重影）
  });
});

/* ---------------- 图片占位行（03 §10.4 剪贴板附件批注⑦——TUI 对端呈现） ---------------- */

describe('LiveTranscript user 块图片占位行（03 §10.4 剪贴板附件批注⑦——静默丢图升格诚实占位）', () => {
  /**
   * 图文块 user 消息工厂（字面量直构——image/image-ref 块形由剪贴板附件批扩，
   * 测试不 import 新类型只按块 type 字符串构造；joinTextBlocks 判形同律）。
   */
  const userImgMsg = (blocks: unknown[]): AgentMessage =>
    ({ role: 'user', content: blocks, timestamp: 1 }) as unknown as AgentMessage;

  it('投影路：image/image-ref 块各降一行「[图片]」占位——图序与文本行序按 content 块序交织（修前红锚——现状静默丢图）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userImgMsg([
        { type: 'text', text: '看这两张图' },
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
        { type: 'image-ref', ref: `sha256:${'a'.repeat(64)}`, mimeType: 'image/png', bytes: 100 },
        { type: 'text', text: '收到吗' },
      ]),
    ]);
    // 修前红锚：joinTextBlocks 只取 text 块 → '看这两张图收到吗'（图块静默丢失）；
    // 升格后每图一行占位、与文本行按块序交织
    expect(t.snapshot[0]).toEqual({ kind: 'user', text: '看这两张图\n[图片]\n[图片]\n收到吗', theme: DEFAULT_THEME });
  });

  it('三图 = 三行占位（每块一行、图序保留——首图在前文本居中两图收尾的交织形）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userImgMsg([
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
        { type: 'text', text: '之间' },
        { type: 'image-ref', ref: `sha256:${'b'.repeat(64)}`, mimeType: 'image/png', bytes: 1 },
        { type: 'image-ref', ref: `sha256:${'c'.repeat(64)}`, mimeType: 'image/png', bytes: 2 },
      ]),
    ]);
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'user' }>;
    expect(slot.text).toBe('[图片]\n之间\n[图片]\n[图片]'); // 三图三行、块序交织
  });

  it('image-only 消息：无文本块时占位行仍在场（图不因无文本而消失）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userImgMsg([{ type: 'image-ref', ref: `sha256:${'d'.repeat(64)}`, mimeType: 'image/png', bytes: 3 }]),
    ]);
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'user' }>;
    expect(slot.text).toBe('[图片]');
  });

  it('直播路 message_end：user 图块同律占位（两路单源 joinTextBlocks）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: userImgMsg([
        { type: 'text', text: '贴张图' },
        { type: 'image-ref', ref: `sha256:${'e'.repeat(64)}`, mimeType: 'image/png', bytes: 4 },
      ]),
    });
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'user' }>;
    expect(slot.text).toBe('贴张图\n[图片]');
  });
});

/* ---------------- 渲染行提取（批 10f-4——管线单源 renderBlockLines） ---------------- */

describe('renderBlockLines 渲染行提取（主屏直写与件 8 回看器共用同一管线）', () => {
  it('user 块三要素（界面美化役批⑦）：空行包夹 + "› " 前缀 bold+dim 首行 + 折行续挂两空格缩进', () => {
    const lines = renderBlockLines({ kind: 'user', text: '帮我看下', theme: DEFAULT_THEME }, 20, false); // 宽裕单行；R-1 豁免位——块前垫另锁（制度锁块）
    // 上下空行（块内行——块账语义不变）+ 前缀段 bold+dim（缺省板无背景带形）
    expect(lines).toEqual(['', '\x1b[1;2m› \x1b[0m帮我看下', '']);
  });

  it('user 块折行：超宽文本续行缩进对齐（宽算术单源 wrapText）+ 续行裸', () => {
    // R-1 折行宽 −3（前缀 2 + 右缘 1 恒空——与 composer innerWidth 同口径）：内容宽 = 6−3 = 3 → 'abc'+'def'+'ghi'+'j' 四行（豁免位剥块前垫）
    const lines = renderBlockLines({ kind: 'user', text: 'abcdefghij', theme: DEFAULT_THEME }, 6, false);
    expect(lines).toEqual(['', '\x1b[1;2m› \x1b[0mabc', '  def', '  ghi', '  j', '']);
  });

  it('user 块背景带（R2 扩键注）：userMessageBg 在场 → 正文段 bg 游程 + 前缀段并 bg；缺省板缺席 → 无 bg 游程', () => {
    // 探测形主题：resolveTheme 携 terminalBg（真彩档）→ 混合出 userMessageBg
    const probed = resolveTheme(LIGHT_PALETTE, 'truecolor', { r: 32, g: 32, b: 32 });
    expect(probed.userMessageBg).toBeDefined();
    const styled = renderBlockStyledLines({ kind: 'user', text: '帮我看下', theme: probed }, 20, false);
    // 首行：前缀段 bold+dim+bg + 正文段 bg
    expect(styled[1]!.runs).toEqual([
      { start: 0, end: 2, style: { bold: true, dim: true, bg: probed.userMessageBg } },
      { start: 2, end: '帮我看下'.length + 2, style: { bg: probed.userMessageBg } },
    ]);
    // R-2 全宽带（fillBg 行级尾腿）：三明治两空行与正文行各携 fillBg——外素内染
    //（块前垫是制度行不染；豁免位此处剥垫，染面 = 三明治 + 正文行集本身）
    expect(styled[0]).toEqual({ plain: '', runs: [], fillBg: probed.userMessageBg });
    expect(styled[1]!.fillBg).toBe(probed.userMessageBg);
    expect(styled[2]).toEqual({ plain: '', runs: [], fillBg: probed.userMessageBg });
    // R-2 ANSI 形：空行纯带（bg + EL + 归零）；正文行尾段同 bg → 直随 EL（BCE
    // 铺满至屏宽）后归零
    const ansi = renderBlockLines({ kind: 'user', text: '帮我看下', theme: probed }, 20, false);
    expect(ansi[0]).toBe(`${buildSgr({ bg: probed.userMessageBg! })}\x1b[K\x1b[0m`);
    expect(ansi[1]).toBe(
      `${buildSgr({ bold: true, dim: true, bg: probed.userMessageBg! })}› \x1b[0m` +
        `${buildSgr({ bg: probed.userMessageBg! })}帮我看下\x1b[K\x1b[0m`,
    );
    expect(ansi[2]).toBe(`${buildSgr({ bg: probed.userMessageBg! })}\x1b[K\x1b[0m`);
    // 16 档降采 → 无背景（resolveTheme depth='16' 不铸键）
    expect(resolveTheme(LIGHT_PALETTE, '16', { r: 32, g: 32, b: 32 }).userMessageBg).toBeUndefined();
    // 缺省板（无 terminalBg）→ 无背景回退 + fillBg 尾腿缺席（素行零变）
    expect(DEFAULT_THEME.userMessageBg).toBeUndefined();
    const plainStyled = renderBlockStyledLines({ kind: 'user', text: '帮我看下', theme: DEFAULT_THEME }, 20, false);
    expect(plainStyled[1]!.runs).toEqual([{ start: 0, end: 2, style: { bold: true, dim: true } }]);
    expect(plainStyled[0]).toEqual({ plain: '', runs: [] });
    expect(plainStyled[1]!.fillBg).toBeUndefined();
  });

  it('tool-card 块卡间上空行垫（TUI 对标 Codex 五件批 C 件 R4）：渲染层块前空行、块账不动', () => {
    const block: TranscriptBlock = {
      kind: 'tool-card',
      name: 'read',
      brief: '(path)',
      status: 'success',
      body: ['行一'],
      diff: false,
      expanded: false,
      theme: DEFAULT_THEME,
      toggleHint: 'ctrl+o',
    };
    const lines = renderBlockStyledLines(block, 40);
    expect(lines[0]).toEqual({ plain: '', runs: [] }); // 修前红锚：垫缺席首行即卡头
    expect(lines[1]!.plain).toBe(' ✓ 读取文件(path)'); // 垫后卡头原形维持
  });

  it('tool-call / tool-result 块：单行 dim 样式', () => {
    const toolCall = renderBlockLines({ kind: 'tool-call', name: 'read', brief: '(path)' }, 40, false); // R-1 豁免位
    expect(toolCall).toHaveLength(1);
    expect(toolCall[0]).toBe('\x1b[2m ⚙ 读取文件(path)\x1b[0m');
    const toolResult = renderBlockLines({ kind: 'tool-result', brief: '命中' }, 40, false);
    expect(toolResult[0]).toBe('\x1b[2m ↳ 命中\x1b[0m');
  });

  it('markdown 块：经 CellGrid 渲染（R-3 H1 # 前缀 + bold+underline 单游程）+ bullet 槽前缀（注⑩）', () => {
    const lines = renderBlockLines({ kind: 'markdown', doc: MarkdownDoc.of('# 标题') }, 20, false); // R-1 豁免位
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toBe('\x1b[2m• \x1b[0m\x1b[1;4m# 标题\x1b[0m'); // 首行 • 前缀 dim（R-4）+ R-3 H1 整行单游程
    expect(lines.length).toBe(1); // 下划线行退役——单行收口
  });

  it('markdown 块 bullet 槽形（注⑩——• 列点前缀位）：非空行前缀两形 + 空行保空行 + 行宽帽', () => {
    const doc = MarkdownDoc.of('段落一 段落二\n\n第二段');
    const styled = renderBlockStyledLines({ kind: 'markdown', doc }, 9, false); // 内容宽 = columns−2 = 7；R-1 豁免位
    expect(styled[0]!.plain.startsWith('• ')).toBe(true); // 首行 • 前缀
    expect(
      styled
        .filter((line) => line.plain !== '')
        .every((line) => line.plain.startsWith('• ') || line.plain.startsWith('  ')),
    ).toBe(true); // 续行两空格缩进（user 块 › 同构）
    expect(styled.some((line) => line.plain === '' && line.runs.length === 0)).toBe(true); // 空行不携前缀
    for (const line of styled) expect(stringWidth(sanitizeDisplayText(line.plain))).toBeLessThanOrEqual(9); // 槽行宽 ≤ columns
  });

  it('streaming 块降档形：空文本零行、有文本按宽折行 + bullet 前缀（doc = null 纯文本直推不走网格）', () => {
    expect(renderBlockLines(slotOf(1, '', null), 20, false)).toEqual([]); // R-1 豁免位——空槽零行（垫维另锁：制度位空槽 = 单垫行瞬态）
    // 注⑩ bullet 槽：降档腿同轴 columns−2 折行 + `• `/`  ` 前缀（宽 4 → 内容宽 2；
    // 首行 • dim 续行裸——R-4 前缀 dim）
    const lines = renderBlockLines(slotOf(1, 'abcdefgh', null), 4, false);
    expect(lines).toEqual(['\x1b[2m• \x1b[0mab', '  cd', '  ef', '  gh']);
  });

  it('streaming 块直推档：doc 经网格管线、与定稿 markdown 块同行集（同管线律零第二渲染器）', () => {
    const text = '# 标题\n\n正文段';
    const doc = new StreamingMarkdown();
    doc.update(text);
    const streaming = renderBlockStyledLines(slotOf(1, text, doc), 20, false); // R-1 豁免位——两侧同参（垫维对称，制度锁块另锁同形）
    const final = renderBlockStyledLines({ kind: 'markdown', doc: MarkdownDoc.of(text) }, 20, false);
    expect(streaming).toEqual(final); // 同文同宽同主题 → 同行集（main-screen 冻结跳行的定位前提）
    expect(streaming.length).toBeGreaterThanOrEqual(3);
    expect(streaming[0]!.plain).toContain('标题');
    expect(streaming[0]!.plain.startsWith('• ')).toBe(true); // bullet 槽首行 •（注⑩）——live 槽与定稿块同形
    expect(streaming[0]!.runs.some((r) => r.style.bold === true)).toBe(true); // H1 bold 位
  });
});

/* ---------------- 带样式行提取（批 10f-4——件 8 回看器数据源同管线） ---------------- */

describe('renderBlockStyledLines 带样式行（零第二渲染器——与主屏直写同管线）', () => {
  it('user 块带样式行：空行包夹 + 前缀段 bold+dim（其余裸文本）', () => {
    const styled = renderBlockStyledLines({ kind: 'user', text: '帮我看下', theme: DEFAULT_THEME }, 20, false); // R-1 豁免位
    expect(styled).toEqual([
      { plain: '', runs: [] },
      { plain: '› 帮我看下', runs: [{ start: 0, end: 2, style: { bold: true, dim: true } }] },
      { plain: '', runs: [] },
    ]);
  });

  it('tool-call / tool-result 块：整行 dim 单段（plain 无转义零样式混入）', () => {
    const toolCall = renderBlockStyledLines({ kind: 'tool-call', name: 'read', brief: '(path)' }, 40, false); // R-1 豁免位
    expect(toolCall).toEqual([
      { plain: ' ⚙ 读取文件(path)', runs: [{ start: 0, end: ' ⚙ 读取文件(path)'.length, style: { dim: true } }] },
    ]);
    const toolResult = renderBlockStyledLines({ kind: 'tool-result', brief: '命中' }, 40, false);
    expect(toolResult[0]!.plain).toBe(' ↳ 命中');
    expect(toolResult[0]!.runs).toEqual([{ start: 0, end: ' ↳ 命中'.length, style: { dim: true } }]);
  });

  it('简行族构造位消毒律：argsBrief/resultBrief 先消毒再测宽（2026-09-21 修复批——tab 记宽 1 误过帽漂物理行账）', () => {
    // resultBrief 腿：未配对 tool-result 兜底 ↳ 简行，brief 首行中置 tab（trim 剥
    // 首尾空白故中置——工具输出首行含源码缩进 tab 是日常形）
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('x'.repeat(10) + '\t\t\t\t\t' + 'y'.repeat(25), { toolCallId: 'tc-x' }),
    });
    const block = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-result' }>;
    // 构造位消毒：brief 不残留 tab（修前原样 5 tab——记宽 5 消毒后实宽 10，两帽均误计）
    expect(block.brief).not.toMatch(/\t/);
    // 发射语义宽（发射位 tab 展开 2 空格）≤ 帽——修前 BRIEF_WIDTH/出口帽均按 tab=1 记宽放行
    for (const line of renderBlockStyledLines(block, 20)) {
      expect(stringWidth(sanitizeDisplayText(line.plain))).toBeLessThanOrEqual(20);
    }
    // argsBrief 腿：参数键名含 tab（JSON 键任意字符串），配对卡 brief 同一构造位
    const t2 = new LiveTranscript();
    apply(t2, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'grep', arguments: { 'pa\tth': 'x' } }]),
    });
    apply(t2, { type: 'message_end', message: toolResultMsg('ok', { toolCallId: 'tc1' }) });
    apply(t2, { type: 'agent_end', status: 'completed' }); // grep 入探索窗——收口补落单卡（N=1 < 2）
    const card = t2.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(card.brief).not.toMatch(/\t/); // 键列简述已消毒（修前 '(pa\th)' 原样携带）
  });

  it('markdown 块：样式段提取（R-3 H1 整行单游程——bold 段覆 # 前缀与正文）+ 空行保空行', () => {
    const doc = MarkdownDoc.of('# 标题\n\n正文');
    const styled = renderBlockStyledLines({ kind: 'markdown', doc }, 20, false); // R-1 豁免位
    expect(styled.length).toBeGreaterThanOrEqual(3);
    // H1 行：bullet 槽前缀（R-4 dim——符位弱化、正文照常）+ bold+underline 段覆
    // # 前缀与正文（R-3 同 base 整段）
    const h1 = styled[0]!;
    expect(h1.plain).toBe('• # 标题');
    expect(h1.runs[0]).toEqual({ start: 0, end: 2, style: { dim: true } }); // bullet 槽前缀 dim（R-4）
    const boldRun = h1.runs.find((r) => r.style.bold === true);
    expect(boldRun).toBeDefined();
    expect(h1.plain.slice(boldRun!.start, boldRun!.end)).toBe('# 标题');
    expect(boldRun!.style.underline).toBe(true); // H1 属性梯度（R-3）
    // markdown 无内容行保空行（主屏空行直写形字节不变——回看器同形）
    expect(styled.some((line) => line.plain === '' && line.runs.length === 0)).toBe(true);
  });

  it('字节恒等锁：renderBlockLines ≡ styled 形经 styledLineToAnsi（零第二渲染器）', () => {
    const streamingDoc = new StreamingMarkdown(); // 直推档也入锁——两档同管线律
    streamingDoc.update('流式**粗体**与 `code`');
    const blocks: Parameters<typeof renderBlockStyledLines>[0][] = [
      { kind: 'user', text: '你好世界'.repeat(8), theme: DEFAULT_THEME }, // 折行
      { kind: 'markdown', doc: MarkdownDoc.of('# 标题\n\n- 甲\n- 乙\n\n`code` 与 **粗**') },
      { kind: 'tool-call', name: 'grep', brief: '(模式, 路径)' },
      { kind: 'tool-result', brief: '首行结果' },
      slotOf(1, '流式快照', null),
      slotOf(2, '流式**粗体**与 `code`', streamingDoc),
    ];
    for (const block of blocks) {
      const styled = renderBlockStyledLines(block, 24);
      const ansi = renderBlockLines(block, 24);
      expect(styled.map(styledLineToAnsi)).toEqual(ansi); // 两形同管线字节恒等
      for (const line of styled) expect(line.plain).not.toMatch(/\x1b/); // plain 零转义（搜索面纯净）
    }
  });
});

/* ---------------- 批 10i：思考前缀与定稿换装（R1） ---------------- */

describe('LiveTranscript 思考流式前缀与定稿换装（批 10i R1）', () => {
  it('message_update 思考抽取：连续思考块 \\n\\n 串接 + 槽渲染思考行前缀（标签行在前 doc 行在后）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, {
      type: 'message_update',
      role: 'assistant',
      partial: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先想一步' },
          { type: 'thinking', thinking: '再想一步' },
          { type: 'text', text: '答案正文' },
        ],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot.thinking).toBe('先想一步\n\n再想一步'); // 块间 '\n\n' 串接
    expect(slot.thinkingSettled).toBe(true); // 末思考块先于末文本块
    // 槽渲染 = 思考标签行前缀 + doc 正文行（拼接序与定稿块序一致）；settled
    // 即转定稿档（注④——同步发射本地钟差 0 → 整秒档 0s）；R-1 豁免位（制度
    // 位组合镜像另锁——[垫]+think+[腿垫]+doc）
    const lines = renderBlockStyledLines(slot, 60, false);
    expect(lines[0]!.plain).toContain('思考 · 0s');
    expect(lines[0]!.plain).toContain('（ctrl+t 展开）'); // 缺省折叠档 + 键名提示
    expect(lines.some((l) => l.plain.includes('答案正文'))).toBe(true);
  });

  it('思考钟本地账（V-2 笔2 注④）：注入钟戳位 → 定稿块携时长；投影路无钟诚实缺席', () => {
    // 注入可控钟：首增量 t=1000、settled 翻转 t=5000 → 定稿时长恒 4s
    let clock = 1000;
    const t = new LiveTranscript({ now: () => clock });
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, {
      type: 'message_update',
      role: 'assistant',
      partial: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先想' }],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    clock = 5000;
    apply(t, {
      type: 'message_update',
      role: 'assistant',
      partial: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先想' },
          { type: 'text', text: '答' },
        ],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    apply(t, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先想' },
          { type: 'text', text: '答' },
        ],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    });
    const think = t.snapshot.find((b) => b.kind === 'thinking') as Extract<TranscriptBlock, { kind: 'thinking' }>;
    expect(think.durationMs).toBe(4000); // startAt 1000（首增量定格）→ settledAt 5000
    // 投影重建（repaint 路）：无消费端钟账 → 定稿块 durationMs 缺席 → 标签无时长形
    t.loadProjection([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先想' },
          { type: 'text', text: '答' },
        ],
        usage,
        stopReason: 'stop',
        timestamp: 1,
      },
    ]);
    const replayed = t.snapshot.find((b) => b.kind === 'thinking') as Extract<TranscriptBlock, { kind: 'thinking' }>;
    expect(replayed.durationMs).toBeUndefined();
    expect(renderBlockStyledLines(replayed, 60, false)[0]!.plain).toBe('思考（ctrl+t 展开）'); // R-1 豁免位
  });

  it('thinkingSettled 判据：纯思考期（无文本块）恒未定；末思考在末文本后翻回 false（保守形）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    const partialOf = (
      content: Array<{ type: 'thinking'; thinking: string } | { type: 'text'; text: string }>,
    ): AgentMessage => ({ role: 'assistant', content, usage, stopReason: 'stop', timestamp: 1 });
    apply(t, {
      type: 'message_update',
      role: 'assistant',
      partial: partialOf([{ type: 'thinking', thinking: '纯思考' }]),
    });
    expect((t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>).thinkingSettled).toBe(false); // 标签字数逐帧变——不可冻
    apply(t, {
      type: 'message_update',
      role: 'assistant',
      partial: partialOf([
        { type: 'thinking', thinking: '纯思考' },
        { type: 'text', text: '起' },
      ]),
    });
    expect((t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>).thinkingSettled).toBe(true);
    apply(t, {
      type: 'message_update',
      role: 'assistant',
      partial: partialOf([
        { type: 'thinking', thinking: '纯思考' },
        { type: 'text', text: '起' },
        { type: 'thinking', thinking: '又想' },
      ]),
    });
    expect((t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>).thinkingSettled).toBe(false); // 后到思考翻回——已冻思考行变不稳内容，main-screen 冻结账让位重算（挂账解挂批让位形）
  });

  it('message_end 定稿换装块序：thinking 块先于 markdown 块（与槽渲染序一致——冻结跳行不漂移）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('正文', [], '想法') });
    apply(t, { type: 'message_end', message: assistantMsg('正文', [], '想法') });
    expect(t.snapshot.map((b) => b.kind)).toEqual(['thinking', 'markdown']);
    const thinking = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'thinking' }>;
    expect(thinking).toMatchObject({ kind: 'thinking', text: '想法', expanded: false, toggleHint: 'ctrl+t' });
    expect(thinking.doc).toBeInstanceOf(MarkdownDoc); // 体 doc 换装一构——repaint 免重解析
  });

  it('纯思考无文本定稿：只落 thinking 块零 markdown 块（无空块）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [], '只有思考') });
    expect(t.snapshot.map((b) => b.kind)).toEqual(['thinking']);
  });

  it('stableSlotLineCount：settled 前思考行不计（0 面）、settled 后 = 垫 + 折叠标签 + 腿间垫 + doc 稳定面（R-1 组合镜像账）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('正文一行', [], '想法') });
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    // doc 稳定面按渲染腿同宽计量（bullet 槽前缀宽 2——60−2=58）
    const docRows = slot.doc!.stableLineCount(58);
    // 缺省位 = 头垫 1 + 折叠标签 1 + 腿间垫 1 + doc 稳定行（与渲染行集同尺——冻结账镜像）
    expect(stableSlotLineCount(slot, 60)).toBe(3 + docRows);
    // 翻 settled=false（同数据异判据）——不稳头行止冻：冻结面前缀连续，doc 稳定面不越位
    const unsettled: Extract<TranscriptBlock, { kind: 'streaming' }> = { ...slot, thinkingSettled: false };
    expect(stableSlotLineCount(unsettled, 60)).toBe(0);
    // 降档形（doc = null）：头垫 + settled 标签 + 腿间垫入冻结面（垫行恒稳——
    // text 在场即插且不消失；text 行不入账——wrapText 随流重排）
    expect(stableSlotLineCount({ ...slot, doc: null }, 60)).toBe(3);
    // 零思考零 doc：仅头垫独撑（1）——制度位空内容垫行即全部稳定面
    expect(stableSlotLineCount({ ...slot, thinking: '', doc: null }, 60)).toBe(1);
  });
});

/* ---------------- 批 10i：工具卡配对账与孤儿收敛（R4） ---------------- */

describe('LiveTranscript 工具卡配对账（批 10i R4——直播路）', () => {
  it('配对落卡：toolCall 入账不落行 → toolResult 入探索窗 → agent_end 收口落三态卡（卡名取调用侧非结果侧）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x', path: 'y' } }]),
    });
    expect(t.snapshot).toEqual([]); // 在飞账不落行（直播路在飞期零正文行）
    apply(t, { type: 'message_end', message: toolResultMsg('命中 3 处', { toolCallId: 'tc1' }) });
    // grep 属探索族（07 §4.1 V-3 注⑩ 探索组卡批）——入窗暂存非到达即落
    expect(t.snapshot).toEqual([]);
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot).toHaveLength(1); // N=1 < 2 → 逐条补落 R4 单卡
    expect(t.snapshot[0]).toMatchObject({
      kind: 'tool-card',
      name: 'grep', // 消息面 toolName 是 'read'——卡面取 pendingCalls 调用侧
      brief: '(模式=x, 路径=y)', // 白名单键值短显（UX 五问题批②——值截 40 列内直呈）
      status: 'success',
      diff: false,
    });
  });

  it('未配对结果兜底 ↳ 简行（不伪装成卡）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: toolResultMsg('野结果', { toolCallId: 'tc-x' }) });
    expect(t.snapshot).toEqual([{ kind: 'tool-result', brief: '野结果' }]);
  });

  it('三态判定：details.aborted 结构化标记 → aborted 优先于 isError（探索族失败封闭——逐窗逐卡）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'a', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'b', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('中断', { toolCallId: 'a', details: { aborted: true } }) });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('中断兼错', { toolCallId: 'b', details: { aborted: true }, isError: true }),
    });
    // a 入窗（失败封闭窗）；b 到达切窗收口 a → N=1 单卡
    expect((t.snapshot[0] as { status: string }).status).toBe('aborted');
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'c', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('出错了', { toolCallId: 'c', isError: true }) });
    apply(t, { type: 'agent_end', status: 'completed' });
    expect((t.snapshot[1] as { status: string }).status).toBe('aborted'); // b 单卡（aborted 标记优先于 isError）
    expect((t.snapshot[2] as { status: string }).status).toBe('error'); // c 单卡（agent_end 收口 N=1）
  });

  it('edit 词级 diff 档：patch 参数体作卡体（diff: true——呈现的是改了什么非结果文本）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'edit', arguments: { patch: '-旧一行\n+新一行' } }]),
    });
    apply(t, { type: 'message_end', message: toolResultMsg('已应用', { toolCallId: 'tc1' }) });
    const card = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(card.diff).toBe(true);
    expect(card.body).toEqual(['-旧一行', '+新一行']); // 卡体 = patch 体非结果文本
    expect(card.status).toBe('success');
  });

  it('edit diffStartLines 注卡：成功回执 operations 段序提取（update 注/add 不注；⑥ 行号源）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'edit', arguments: { patch: '*** Begin Patch' } }]),
    });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('已应用', {
        toolCallId: 'tc1',
        details: {
          operations: [
            { op: 'update', path: '/x/a.ts', startLine: 7 },
            { op: 'add', path: '/x/b.ts' },
          ],
        },
      }),
    });
    const card = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(card.diffStartLines).toEqual([7, undefined]);
  });

  it('diffStartLines 缺席腿：失败/回执无 operations / 非法形 → undefined（诚实缺席非伪号）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'edit', arguments: { patch: '*** Begin Patch' } }]),
    });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('定位失败', { toolCallId: 'tc1', isError: true }),
    });
    const failed = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(failed.diffStartLines).toBeUndefined();
    // 非法 operations 形（防御：非数组/项非对象）同样缺席
    const t2 = new LiveTranscript();
    apply(t2, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'edit', arguments: { patch: '*** Begin Patch' } }]),
    });
    apply(t2, {
      type: 'message_end',
      message: toolResultMsg('已应用', { toolCallId: 'tc1', details: { operations: '坏形' } }),
    });
    const malformed = t2.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(malformed.diffStartLines).toBeUndefined();
  });

  it('插件渲染腿载荷铸入（收官批③）：renderInput 携 toolCall 参数 + 结果全量事实；aborted 同步', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x' } }]),
    });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('中断', { toolCallId: 'tc1', details: { aborted: true }, isError: true }),
    });
    apply(t, { type: 'agent_end', status: 'completed' }); // grep 入探索窗——收口补落单卡（N=1 < 2）
    const card = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    // 载荷 = 调用侧参数 + 结果消息面（toolName 单源 = 卡名故载荷不含）
    expect(card.renderInput).toEqual({
      toolCallId: 'tc1',
      arguments: { pattern: 'x' },
      content: [{ type: 'text', text: '中断' }],
      isError: true,
      aborted: true,
    });
    // 未配对孤儿兜底 ↳ 简行不携载荷（无卡即无 renderInput 面）
    const t2 = new LiveTranscript();
    apply(t2, { type: 'message_end', message: toolResultMsg('野结果', { toolCallId: 'tc-x' }) });
    expect(t2.snapshot[0]).toEqual({ kind: 'tool-result', brief: '野结果' });
  });
});

describe('LiveTranscript 投影孤儿兜底与配对撤销（批 10i R4——repaint 路）', () => {
  it('loadProjection 走查毕的在飞孤儿 → ⚙ 简行携 toolCallId（在飞显形）', () => {
    const t = new LiveTranscript();
    t.loadProjection([assistantMsg('', [{ id: 'tc1', name: 'read', arguments: { path: 'a.ts' } }])]);
    expect(t.snapshot).toEqual([{ kind: 'tool-call', name: 'read', brief: '(路径=a.ts)', toolCallId: 'tc1' }]);
  });

  it('配对到达留账落卡（⚙ 行不撤销——append-only 留账律；净 +1 块）', () => {
    const t = new LiveTranscript();
    t.loadProjection([userMsg('问'), assistantMsg('', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x' } }])]);
    apply(t, { type: 'message_end', message: toolResultMsg('命中 1 处', { toolCallId: 'tc1' }) });
    apply(t, { type: 'agent_end', status: 'completed' }); // grep 入探索窗——收口补落单卡（N=1 < 2）
    // ⚙ 已交 scrollback 物理不可回改——留账留屏，卡追加（净 +1：呈现侧 B 段
    // 照常写卡、账屏一致；撤销 splice 是账屏失同步的假象收敛）
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'tool-call', 'tool-card']);
    expect(t.snapshot[2]).toMatchObject({ kind: 'tool-card', name: 'grep', status: 'success' });
    // 再投影自然收敛仅卡（pendingCalls 已出账——走查不再孤儿兜底；直播路无
    // 孤儿形差异由再投影收敛吸收）
    t.loadProjection([
      userMsg('问'),
      assistantMsg('', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x' } }]),
      toolResultMsg('命中 1 处', { toolCallId: 'tc1' }),
    ]);
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'tool-card']);
  });
});

/* ---------------- 批 10i：会话级开关改写（R1/R4 toggle） ---------------- */

describe('LiveTranscript 展开态开关（批 10i——ctrl+t / ctrl+o 会话级）', () => {
  it('toggleThinking：在飞槽与已落账 thinking 块同翻（rewriteExpandedFlags）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('正文', [], '想法') });
    apply(t, { type: 'message_end', message: assistantMsg('正文', [], '想法') });
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('二', [], '想二') });
    t.toggleThinking();
    // 已落账块 + 在飞槽同翻；markdown 块不裹挟
    expect((t.snapshot[0] as { expanded: boolean }).expanded).toBe(true);
    expect((t.snapshot[2] as { thinkingExpanded: boolean }).thinkingExpanded).toBe(true);
    expect(t.snapshot[1]).toMatchObject({ kind: 'markdown' });
    // 后续新建块继承会话级态（换装摘槽 → [thinking(想二), markdown(二)] 续推）
    apply(t, { type: 'message_end', message: assistantMsg('二', [], '想二') });
    expect((t.snapshot[2] as { kind: string }).kind).toBe('thinking');
    expect((t.snapshot[2] as { expanded: boolean }).expanded).toBe(true); // 继承会话级展开态
    expect((t.snapshot[3] as { kind: string }).kind).toBe('markdown');
    t.toggleThinking();
    expect((t.snapshot[0] as { expanded: boolean }).expanded).toBe(false); // 再翻回（全体同翻）
  });

  it('toggleToolCards：已落账卡同翻 + 后续新卡继承', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'tc1', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('输出', { toolCallId: 'tc1' }) });
    apply(t, { type: 'agent_end', status: 'completed' }); // read 入探索窗——收口补落单卡（N=1 < 2）
    t.toggleToolCards();
    expect((t.snapshot[0] as { expanded: boolean }).expanded).toBe(true);
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'tc2', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('输出二', { toolCallId: 'tc2' }) });
    apply(t, { type: 'agent_end', status: 'completed' });
    expect((t.snapshot[1] as { expanded: boolean }).expanded).toBe(true); // 继承会话级态
    // 思考块不裹挟（两开关独立）
    apply(t, { type: 'message_end', message: assistantMsg('', [], '想法') });
    expect((t.snapshot[2] as { expanded: boolean }).expanded).toBe(false);
  });
});

describe('宽帽/错误帽/参数简述帽（2026-09-20 TUI 修复组 1 批 F4/F5/F6）', () => {
  it('F4：tool-call ⚙ 简行受屏宽帽（渲染出口单源 choke——修前超长名直写交 autowrap）', () => {
    const styled = renderBlockStyledLines({ kind: 'tool-call', name: 'n'.repeat(100), brief: '' }, 80, false); // R-1 豁免位
    expect(styled).toHaveLength(1);
    // ' ⚙ ' 3 列 + 76 n = 79 列 + '…' = 80 列恰满（界面美化役批①——截断收
    // 省略号可辨，尾游程延 1 吞 '…' 同 dim）；游程收尾同步
    expect(styled[0]!.plain).toBe(' ⚙ ' + 'n'.repeat(76) + '…');
    expect(styled[0]!.runs).toEqual([{ start: 0, end: 80, style: { dim: true } }]);
  });

  it('F4：tool-result ↳ 简行同律受帽', () => {
    const styled = renderBlockStyledLines({ kind: 'tool-result', brief: 'b'.repeat(100) }, 40, false); // R-1 豁免位
    expect(styled[0]!.plain).toBe(' ↳ ' + 'b'.repeat(36) + '…'); // 3 + 36 = 39 列 + '…' = 40
  });

  it('F4：帽为显示宽非 UTF-16 长（宽字整字丢弃不产半字）', () => {
    // 38 列满后 '中'（2 列）在 cols=39 放不下整字——丢弃；截断收 '…'（40 列
    // 帽形同上：3 + 35 a = 38 + '…' = 39 列恰满）
    const styled = renderBlockStyledLines(
      { kind: 'tool-result', brief: 'a'.repeat(36) + '中' + 'b'.repeat(10) },
      39,
      false,
    ); // R-1 豁免位
    expect(styled[0]!.plain).toBe(' ↳ ' + 'a'.repeat(35) + '…');
  });

  it('F5：error 块行数帽——首 4 行 + 截断标记行（修前全量裸上屏）', () => {
    const text = Array.from({ length: 20 }, (_, i) => `L${String(i).padStart(2, '0')}`).join('\n');
    const styled = renderBlockStyledLines({ kind: 'error', text, theme: DEFAULT_THEME }, 40, false); // R-1 豁免位
    expect(styled).toHaveLength(5);
    expect(styled[0]!.plain).toBe('✗ L00');
    expect(styled[3]!.plain).toBe('  L03');
    // 标记行：两空格缩进 + 省略提示（20 - 4 = 16 行省略）、error 前景游程
    expect(styled[4]!.plain).toBe('  ⋯（错误详情已省 16 行）');
    expect(styled[4]!.runs).toEqual([{ start: 0, end: styled[4]!.plain.length, style: { fg: DEFAULT_THEME.error } }]);
  });

  it('F5：error 块行数在帽内——全量原样（无标记行）', () => {
    const styled = renderBlockStyledLines(
      { kind: 'error', text: '网关 403：凭证失效', theme: DEFAULT_THEME },
      40,
      false,
    ); // R-1 豁免位
    expect(styled).toHaveLength(1);
    expect(styled[0]!.plain).toBe('✗ 网关 403：凭证失效');
  });

  it('F6：argsBrief 参数简述受 BRIEF_WIDTH=40 帽（界面美化役批①：截断走 `…` 单源口径——修前裸截悄然吃字）', () => {
    const t = new LiveTranscript();
    t.loadProjection([assistantMsg('', [{ id: 'tc1', name: 'read', arguments: { ['k'.repeat(60)]: 1 } }])]);
    const block = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-call' }>;
    expect(block.brief).toBe('(' + 'k'.repeat(38) + '…');
  });
});

/* ---------------- 渲染热路径 D1/D2/D3：尾窗渲染 / 计数算术 / 折叠期跳过 ---------------- */

describe('renderSlotTailLines 尾窗渲染（渲染热路径 D1——冻结前缀不重渲染）', () => {
  /** 直构槽块（D1 测试速构——字段族全数到场） */
  const d1Slot = (
    over: Partial<Extract<TranscriptBlock, { kind: 'streaming' }>>,
  ): Extract<TranscriptBlock, { kind: 'streaming' }> => ({
    kind: 'streaming',
    epoch: 1,
    text: '',
    doc: null,
    thinking: '',
    thinkingDoc: null,
    thinkingSettled: true,
    thinkingExpanded: false,
    thinkingStartAt: null, // 无钟直构（对拍锁不涉时长——settled + 双戳 null = 诚实缺席形）
    thinkingSettledAt: null,
    theme: DEFAULT_THEME,
    toggleHint: 'ctrl+t',
    ...over,
  });

  /** 多形文档语料：七块型 + 零行块 + 开栏尾 + CJK 折行 + 表格对齐 */
  const DOC_TEXTS = [
    '# 大标题\n\n段落一正文\n\n> 引用行\n\n```ts\nconst x = 1;\n```\n\n- 项一\n- 项二\n\n---',
    '| 左 | 右 |\n| :- | -: |\n| 长单元格内容折行 | 2 |',
    '段前\n\n```\n```',
    '```\nopen tail',
    '中文段落'.repeat(20),
    '# t\n\n> q\n',
    // 挖掘 36 轮〔5〕OSC-8：链接语料入对拍（尾窗 ≡ 全量两侧同管线——链序列逐字节对拍）
    '见 [文档](https://example.com/page) 与裸 https://example.com/b. 尾随',
  ];
  const START_ROWS = [0, 1, 2, 5];

  it('对拍锁：尾窗输出与全量渲染切片逐字节一致（多形 × 多宽 × 多起点）', () => {
    for (const docText of DOC_TEXTS) {
      for (const w of [40, 20, 7, 3]) {
        // 各形槽：纯 doc / 折叠思考 + doc / 展开思考 + doc / 纯文本降档
        const doc = new StreamingMarkdown();
        doc.update(docText);
        const thinkingDoc = new StreamingMarkdown();
        thinkingDoc.update('# 想法\n\n思考正文段落内容');
        const shapes = [
          d1Slot({ doc }),
          d1Slot({ doc, thinking: '先想一步' }),
          d1Slot({ doc, thinking: '# 想法\n\n思考正文段落内容', thinkingDoc, thinkingExpanded: true }),
          d1Slot({ doc: null, text: '纯文本降档段落\n第二行继续' }),
          d1Slot({ doc: null, text: '降档 + 思考', thinking: '折叠思考' }),
        ];
        for (const slot of shapes) {
          const full = renderBlockLines(slot, w);
          for (const k of [...START_ROWS, full.length - 1, full.length, full.length + 3]) {
            const tail = renderSlotTailLines(slot, w, k);
            expect(tail.total).toBe(full.length);
            expect(tail.lines).toEqual(full.slice(k));
          }
        }
      }
    }
  });

  it('让位收缩形：起点回抬（小于上帧起点）仍与全量切片一致——收缩帧全渲染回退', () => {
    const doc = new StreamingMarkdown();
    doc.update('# 标\n\n段落两行\n\n```ts\nx\n```');
    const slot = d1Slot({ doc, thinking: '思考标签' });
    const full = renderBlockLines(slot, 40);
    expect(renderSlotTailLines(slot, 40, 4).lines).toEqual(full.slice(4));
    expect(renderSlotTailLines(slot, 40, 1).lines).toEqual(full.slice(1)); // 起点回抬
    expect(renderSlotTailLines(slot, 40, 0).lines).toEqual(full); // 全量回退形
  });
});

/* ---------------- 行集直转与 OSC-8 链贯通（挖掘 36 轮〔5〕） ---------------- */

describe('docRowToStyledLine 等价锁（rowsFor 直转 ≡ CellGrid 往返——平移保护件）', () => {
  it('非链语料逐字节等价：直转行集 === render+gridRowToStyled 读回（序列化面）', () => {
    // href 除外 = 声明的参照局限（grid 路径 Cell 无 href 位）——语料因此不含链接
    const texts = [
      '# 大标题\n\n段落一正文\n\n> 引用行\n\n```ts\nconst x = 1;\n```\n\n- 项一\n- 项二',
      '中文段落强调 **粗体** 与 `code` 混排，长段折行算术同受烤。'.repeat(3),
      '| 左 | 右 |\n| :- | -: |\n| 长单元格内容折行 | 2 |',
      '宽字折行形：一二三四五六七八九十'.repeat(4),
    ];
    for (const text of texts) {
      for (const w of [40, 20, 7, 3]) {
        const doc = MarkdownDoc.of(text);
        // 直转侧：rowsFor → docRowToStyledLine → 序列化
        const direct = doc.rowsFor(w).map((row) => styledLineToAnsi(docRowToStyledLine(row, w)));
        // grid 往返侧：render 落格 → gridRowToStyled 读回 → 序列化
        const grid = new CellGrid(w, Math.max(1, doc.measure(w)));
        doc.render(grid, { row: 0, col: 0, width: w, height: grid.rows });
        const viaGrid: string[] = [];
        for (let r = 0; r < grid.rows; r++) {
          const styled = gridRowToStyled(grid, r);
          viaGrid.push(styledLineToAnsi(styled ?? { plain: '', runs: [] }));
        }
        expect(direct, `text=${text.slice(0, 12)}… w=${w}`).toEqual(viaGrid);
      }
    }
  });
});

describe('renderDocLines 直转携 href（OSC-8 链元数据贯通主屏管线）', () => {
  it('markdown 链接块 runs 携 href【修前红：现行管线丢链接目标】', () => {
    const styled = renderBlockStyledLines(
      { kind: 'markdown', doc: MarkdownDoc.of('见 [文档](https://example.com/page)') },
      40,
      false, // R-1 豁免位
    );
    const line = styled.find((l) => l.plain.includes('文档'));
    expect(line).toBeDefined();
    const run = line!.runs.find((r) => line!.plain.slice(r.start, r.end) === '文档');
    expect(run?.href).toBe('https://example.com/page');
  });

  it('裸 URL 行 runs 携 href（仅元数据零观感变——无样式段 EMPTY_STYLE 也产段）【修前红】', () => {
    const styled = renderBlockStyledLines(
      { kind: 'markdown', doc: MarkdownDoc.of('见 https://example.com/a. 后续') },
      40,
      false,
    );
    const line = styled.find((l) => l.plain.includes('https://example.com/a'));
    expect(line).toBeDefined();
    const run = line!.runs.find((r) => line!.plain.slice(r.start, r.end) === 'https://example.com/a');
    expect(run).toBeDefined();
    expect(run!.href).toBe('https://example.com/a');
    expect(run!.style).toEqual({}); // 无观感样式（EMPTY_STYLE——序列化零 SGR 字节）
  });

  it('bulletSlotLine +2 右移 href 随段走【修前红：位移造形丢 href 位】', () => {
    const styled = renderBlockStyledLines(
      { kind: 'markdown', doc: MarkdownDoc.of('- [项](https://a.com/item)') },
      40,
      false,
    );
    const line = styled.find((l) => l.plain.includes('项'));
    expect(line).toBeDefined();
    const run = line!.runs.find((r) => line!.plain.slice(r.start, r.end) === '项');
    expect(run?.href).toBe('https://a.com/item');
    expect(run!.start).toBeGreaterThanOrEqual(2); // bullet 槽前缀（• + 空格）后——+2 位移
  });

  it('相邻两链同样式异 href 不并段（run 合并判据含 href 相等）【修前红】', () => {
    const styled = renderBlockStyledLines(
      { kind: 'markdown', doc: MarkdownDoc.of('[甲](https://a.com)[乙](https://b.com)') },
      40,
      false,
    );
    const line = styled.find((l) => l.plain.includes('甲'));
    expect(line).toBeDefined();
    const linkRuns = line!.runs.filter((r) => r.href !== undefined);
    expect(linkRuns.length).toBe(2); // 不并段——并段即丢链界（后链覆写/前链泄漏）
    expect(linkRuns[0]!.href).toBe('https://a.com');
    expect(linkRuns[1]!.href).toBe('https://b.com');
  });

  it('链接行 plain 零 OSC 字节 + ANSI 形同管线发射 OSC-8（两形分立单源）', () => {
    const doc = MarkdownDoc.of('见 [文档](https://example.com/page) 与 https://example.com/b.');
    const styled = renderBlockStyledLines({ kind: 'markdown', doc }, 40, false);
    for (const line of styled) expect(line.plain).not.toMatch(/[\x1b\x07]/); // plain 纯净（搜索/选区复制单源）
    const ansi = renderBlockLines({ kind: 'markdown', doc }, 40);
    expect(ansi.join('\n')).toContain('\x1b]8;;https://example.com/page\x1b\\'); // 发射面超链在场
    expect(ansi.join('\n')).toContain('\x1b]8;;https://example.com/b\x1b\\'); // 裸 URL 同发
  });

  it('思考块展开体 runs 携 href（thinking 直转——CellGrid 往返退役）【修前红】', () => {
    const thinkingDoc = new StreamingMarkdown();
    thinkingDoc.update('思考 [链](https://a.com/th) 正文');
    const view = {
      text: '思考 [链](https://a.com/th) 正文',
      expanded: true,
      phase: 'settled' as const,
      theme: DEFAULT_THEME,
      toggleHint: 'ctrl+t',
    };
    const lines = renderThinkingStyledLines(view, 40, thinkingDoc);
    const line = lines.find((l) => l.plain.includes('链'));
    expect(line).toBeDefined();
    const run = line!.runs.find((r) => line!.plain.slice(r.start, r.end) === '链');
    expect(run?.href).toBe('https://a.com/th');
  });
});

describe('stableSlotLineCount 展开档算术（渲染热路径 D2——thinking 腿不进网格）', () => {
  it('展开档对拍：= renderThinkingStyledLines 行数 + doc 稳定面（含缺席 doc 即时构档形）', () => {
    const doc = new StreamingMarkdown();
    doc.update('# 标\n\n段落仍在流');
    const thinkingDoc = new StreamingMarkdown();
    thinkingDoc.update('# 想法\n\n思考正文');
    const slot: Extract<TranscriptBlock, { kind: 'streaming' }> = {
      kind: 'streaming',
      epoch: 1,
      text: '# 标\n\n段落仍在流',
      doc,
      thinking: '# 想法\n\n思考正文',
      thinkingDoc,
      thinkingSettled: true,
      thinkingExpanded: true,
      thinkingStartAt: null,
      thinkingSettledAt: null,
      theme: DEFAULT_THEME,
      toggleHint: 'ctrl+t',
    };
    const view = {
      text: slot.thinking,
      expanded: true,
      phase: 'settled' as const,
      theme: slot.theme,
      toggleHint: slot.toggleHint,
    };
    for (const w of [60, 20, 7, 3]) {
      // doc 腿按渲染腿同宽计量（bullet 槽前缀宽 2——renderDocLines/rowsFor 同形）；
      // R-1 组合镜像账 = 头垫 1 + 腿间垫 1（thinking 与 doc 两腿在场——制度位垫行入稳定面）
      expect(stableSlotLineCount(slot, w)).toBe(
        2 + renderThinkingStyledLines(view, w, slot.thinkingDoc).length + doc.stableLineCount(w - 2),
      );
      // 体 doc 缺席形：即时构档回退（与渲染支路同形）
      expect(stableSlotLineCount({ ...slot, thinkingDoc: null }, w)).toBe(
        2 + renderThinkingStyledLines(view, w, null).length + doc.stableLineCount(w - 2),
      );
    }
  });

  it('词法锁：thinking 计数算术位在场（源码标记恰一处）', () => {
    const src = readFileSync(new URL('./transcript.ts', import.meta.url), 'utf8');
    expect((src.match(/渲染热路径 D2——思考行计数算术/g) ?? []).length).toBe(1);
  });
});

describe('stableSlotLineCount doc 腿计量宽（bullet 槽前缀 2——与渲染腿同宽）', () => {
  it('边界文本：全宽 1 行、减前缀宽 2 行 → 稳定面计 2（修前全宽计量计 1——冻结账与渲染行集漂移）', () => {
    const doc = new StreamingMarkdown();
    // 段落 29 列：宽 30 折 1 行、宽 28 折 2 行；尾随标题无换行收尾 = 不稳尾
    //（不进稳定面——计量面只看段落块）
    doc.update('a'.repeat(29) + '\n\n# 尾');
    const slot = slotOf(1, 'a'.repeat(29) + '\n\n# 尾', doc) as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(stableSlotLineCount(slot, 30, false)).toBe(2); // 修前红锚：全宽计量 = 1；R-1 豁免位剥头垫（零思考无双垫）
  });

  it('全稳形同源对拍：稳定面 = 尾窗渲染 total（renderSlotTailLines 的 rowsFor 同宽腿）', () => {
    const doc = new StreamingMarkdown();
    doc.update('a'.repeat(29) + '\n\n# 尾\n'); // 尾随换行——标题稳 → 全稳
    const slot = slotOf(1, 'a'.repeat(29) + '\n\n# 尾\n', doc) as Extract<TranscriptBlock, { kind: 'streaming' }>;
    // 全稳时稳定面即渲染全量行数：两侧宽度不同步即失配（修前红锚：3 ≠ 4）
    expect(stableSlotLineCount(slot, 30)).toBe(renderSlotTailLines(slot, 30, 0).total);
  });
});

/* ---------------- exec 折叠组（07 §4.1 V-3 注⑩ 符号册词条——窗口收口统一落卡） ---------------- */

/** bash 调用消息速构（exec 内建族——载荷保原始名 'bash'，判断位单源） */
const bashCallMsg = (id: string, command: string): AgentMessage =>
  assistantMsg('', [{ id, name: 'bash', arguments: { command } }]);

/** 直播路喂一对 bash 调用 + 结果（数据面首行 Exit code 形——成功 0 / 失败 1） */
function runBashPair(t: LiveTranscript, id: string, command: string, isError = false, details?: unknown): void {
  apply(t, { type: 'message_end', message: bashCallMsg(id, command) });
  apply(t, {
    type: 'message_end',
    message: toolResultMsg(`Exit code: ${isError ? 1 : 0}`, { toolCallId: id, isError, details }),
  });
}

describe('LiveTranscript exec 折叠组（直播路——agent_end 窗口收口）', () => {
  it('窗内暂存 + N≥3 收口组卡：toolResult 到达不即时落卡（到达即落翻档——修前红锚），agent_end 落一张组卡', () => {
    const t = new LiveTranscript();
    runBashPair(t, 'e1', 'echo a');
    runBashPair(t, 'e2', 'echo b');
    runBashPair(t, 'e3', 'echo c');
    // 窗内在飞零正文行：配对完成也不落卡（修前红锚——到达即落三张单卡）
    expect(t.snapshot.filter((b) => b.kind === 'tool-card')).toHaveLength(0);
    apply(t, { type: 'agent_end', status: 'completed' });
    // 收口求值 N = 3 ≥ 3 → 一张组卡（卡头 `• Ran N commands` + 组数据）
    const cards = t.snapshot.filter((b) => b.kind === 'tool-card');
    expect(cards).toHaveLength(1);
    const group = cards[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.group).toMatchObject({
      kind: 'exec',
      count: 3,
      commands: [{ command: 'echo a' }, { command: 'echo b' }, { command: 'echo c' }],
    });
    const lines = renderBlockStyledLines(group, 60);
    // 卡间上空行垫（五件批 C 件 R4）前置——首行空垫、收敛行后移一位；⑤ 全成
    // 组折叠态收敛单行（` • Ran N commands · hint 展开`——无终态符号位、逐条
    // 摘要行退役归展开态）
    expect(lines[0]!.plain).toBe('');
    expect(lines[1]!.plain).toBe(' • Ran 3 commands · ctrl+o 展开');
    expect(lines).toHaveLength(2);
  });

  it('失败条目铸输出窗（挖掘 40 轮件 B）——outputLines 含诊断行不含 Exit code 码形；成功条目缺席', () => {
    const t = new LiveTranscript();
    runBashPair(t, 'e1', 'ls');
    // 中条直构：失败体带诊断 stderr（runBashPair 体硬编码无体参——面一构造法）
    apply(t, { type: 'message_end', message: bashCallMsg('e2', 'npm test') });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('Exit code: 1\nboom stderr', { toolCallId: 'e2', isError: true }),
    });
    runBashPair(t, 'e3', 'pwd');
    apply(t, { type: 'agent_end', status: 'completed' });
    const group = t.snapshot.find((b) => b.kind === 'tool-card') as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    // 修前红锚：铸卡位原丢 toolResult 全文（body: []），outputLines 恒 undefined
    // （组数据窄化 exec 侧——commands 只在 exec 组不在探索组）
    const execGroup = group.group as Extract<ToolCardGroupData, { kind: 'exec' }> | undefined;
    expect(execGroup?.commands[1]?.outputLines).toEqual(['boom stderr']); // 码形首行剥除（防与退出码位双显）
    expect(execGroup?.commands[0]?.outputLines).toBeUndefined(); // 成功条目纯摘要零窗
    expect(execGroup?.commands[2]?.outputLines).toBeUndefined();
  });

  it('N<3 逐条补落保序（R4 逐卡形不变——exec 单卡不携组数据）', () => {
    const t = new LiveTranscript();
    runBashPair(t, 'e1', 'echo a');
    runBashPair(t, 'e2', 'echo b');
    apply(t, { type: 'agent_end', status: 'completed' });
    const cards = t.snapshot.filter((b) => b.kind === 'tool-card') as Array<
      Extract<TranscriptBlock, { kind: 'tool-card' }>
    >;
    expect(cards).toHaveLength(2); // 两条逐卡（非组卡）
    expect(cards.every((c) => c.group === undefined)).toBe(true);
    // 保序 + R4 逐卡形（exec 单卡头 Ran + `$` 命令位；卡间上空行垫前置——卡头在 [1]）
    expect(cards.map((c) => c.name)).toEqual(['bash', 'bash']);
    expect(renderBlockStyledLines(cards[0]!, 60)[1]!.plain).toBe(' ✓ Ran $ echo a');
    expect(renderBlockStyledLines(cards[1]!, 60)[1]!.plain).toBe(' ✓ Ran $ echo b');
  });

  it('组级最差态聚合三态：全成 ✓ / 任一失败 ✗ / 任一 aborted ⏹（中止优先于失败）', () => {
    const run = (specs: Array<{ isError?: boolean; details?: unknown }>): string => {
      const t = new LiveTranscript();
      specs.forEach((spec, i) => runBashPair(t, `e${i}`, `echo ${i}`, spec.isError ?? false, spec.details));
      apply(t, { type: 'agent_end', status: 'completed' });
      const card = t.snapshot.find((b) => b.kind === 'tool-card') as { status: string };
      return card.status;
    };
    expect(run([{}, {}, {}])).toBe('success');
    expect(run([{}, { isError: true }, {}])).toBe('error');
    // 中止优先律：error 与 aborted 并存 → ⏹
    expect(run([{ isError: true }, {}, { details: { aborted: true } }])).toBe('aborted');
  });

  it('孤儿在飞不入 N 不入组卡（无 toolResult 的 exec 调用不计数；直播路无 ⚙ 显形——在飞可见性归面板/状态行）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: bashCallMsg('e1', 'echo a') });
    runBashPair(t, 'e2', 'echo b');
    runBashPair(t, 'e3', 'echo c');
    apply(t, { type: 'agent_end', status: 'aborted', durationMs: 100 });
    // N = 2（e1 孤儿不计）→ 逐卡非组卡；孤儿零 ⚙ 块（直播路孤儿兜底是投影专属显形）
    const cards = t.snapshot.filter((b) => b.kind === 'tool-card') as Array<
      Extract<TranscriptBlock, { kind: 'tool-card' }>
    >;
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.group === undefined)).toBe(true);
    expect(t.snapshot.some((b) => b.kind === 'tool-call')).toBe(false);
  });

  it('user 消息窗边界：收口先于 user 块落位（窗不跨 user 消息——agent_end 之外的防御位收口锚）', () => {
    const t = new LiveTranscript();
    runBashPair(t, 'e1', 'echo a');
    runBashPair(t, 'e2', 'echo b');
    expect(t.snapshot.filter((b) => b.kind === 'tool-card')).toHaveLength(0); // 窗内暂存（修前红锚）
    apply(t, { type: 'message_end', message: userMsg('打断追问') });
    // 收口先落、user 块在后（窗不跨 user 消息）
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card', 'tool-card', 'user']);
  });

  it('探索族入窗翻档：read toolResult 到达不即时落卡（窗内暂存），agent_end 收口 N=1 逐条补落 R4 单卡', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'r1', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('文件内容', { toolCallId: 'r1' }) });
    // 探索组卡批翻档（07 §4.1 V-3 注⑩）：read 入探索窗非到达即落——修前红锚
    expect(t.snapshot).toHaveLength(0);
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot).toHaveLength(1); // N=1 < 2 → 逐条补落
    expect(t.snapshot[0]).toMatchObject({ kind: 'tool-card', name: 'read' });
  });
});

describe('LiveTranscript exec 折叠组（投影路——user 消息段窗聚合重建）', () => {
  /** 三对 bash 的投影语料（同窗 ≥3 形） */
  const threePairs = [
    userMsg('问'),
    bashCallMsg('e1', 'echo a'),
    toolResultMsg('Exit code: 0', { toolCallId: 'e1' }),
    bashCallMsg('e2', 'echo b'),
    toolResultMsg('Exit code: 0', { toolCallId: 'e2' }),
    bashCallMsg('e3', 'echo c'),
    toolResultMsg('Exit code: 0', { toolCallId: 'e3' }),
  ];

  it('loadProjection 同款窗聚合：与直播路组卡同形（两路一致律）', () => {
    const live = new LiveTranscript();
    for (const message of threePairs) apply(live, { type: 'message_end', message });
    apply(live, { type: 'agent_end', status: 'completed' });
    const proj = new LiveTranscript();
    proj.loadProjection(threePairs);
    // 投影窗聚合重建组卡——块账与直播路逐字段一致（直播收口组卡/投影窗聚合组卡）
    expect(proj.snapshot).toEqual(live.snapshot);
    expect((proj.snapshot[1] as Extract<TranscriptBlock, { kind: 'tool-card' }>).group).toMatchObject({ count: 3 });
  });

  it('窗切分按 user 消息段近似：两窗各自求值（投影序列无 agent_end 信号——段即窗）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userMsg('一问'),
      bashCallMsg('a1', 'echo a'),
      toolResultMsg('Exit code: 0', { toolCallId: 'a1' }),
      bashCallMsg('a2', 'echo b'),
      toolResultMsg('Exit code: 0', { toolCallId: 'a2' }),
      userMsg('二问'),
      bashCallMsg('b1', 'echo c'),
      toolResultMsg('Exit code: 0', { toolCallId: 'b1' }),
    ]);
    // 前窗 N=2（<3 逐卡）+ 后窗 N=1（逐卡）——两窗互不串账
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'tool-card', 'tool-card', 'user', 'tool-card']);
  });

  it('孤儿 ⚙ 显形不入 N：组卡只含配对条目、孤儿简行在组卡后（投影走查毕收口序）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      bashCallMsg('e1', 'echo a'),
      toolResultMsg('Exit code: 0', { toolCallId: 'e1' }),
      bashCallMsg('e2', 'echo b'),
      toolResultMsg('Exit code: 0', { toolCallId: 'e2' }),
      bashCallMsg('e3', 'echo c'),
      toolResultMsg('Exit code: 0', { toolCallId: 'e3' }),
      bashCallMsg('e4', 'echo d'), // 孤儿：无 toolResult（agent_end aborted 形常见）
    ]);
    const kinds = t.snapshot.map((b) => b.kind);
    expect(kinds).toEqual(['tool-card', 'tool-call']); // 组卡在前、孤儿 ⚙ 兜底在后
    const group = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.group).toMatchObject({ count: 3 }); // 孤儿不入 N
    expect((t.snapshot[1] as { name: string }).name).toBe('bash'); // 孤儿 ⚙ 简行照旧族
  });
});

/* ---------------- 探索组卡（07 §4.1 V-3 注⑩ 探索组卡批——单窗泛化两族） ---------------- */

describe('LiveTranscript 探索组卡（探索组卡批——单窗泛化直播路）', () => {
  /** 探索族调用+结果对速构（默认 read——args/错误面可覆写） */
  const runExplorePair = (
    t: LiveTranscript,
    id: string,
    over: {
      name?: string;
      args?: Record<string, unknown>;
      text?: string;
      isError?: boolean;
      details?: unknown;
    } = {},
  ): void => {
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id, name: over.name ?? 'read', arguments: over.args ?? {} }]),
    });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg(over.text ?? 'ok', {
        toolCallId: id,
        isError: over.isError,
        details: over.details,
      }),
    });
  };

  it('判据谱：read/ls/find/grep 四员入窗（到达 0 卡）——插件名异族即落', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'e1', { name: 'read' });
    runExplorePair(t, 'e2', { name: 'ls' });
    runExplorePair(t, 'e3', { name: 'find', args: { pattern: '*.ts' } });
    runExplorePair(t, 'e4', { name: 'grep', args: { pattern: 'x' } });
    // 全员入探索窗（同族续窗）——到达即落翻档，在飞零正文行
    expect(t.snapshot).toHaveLength(0);
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'x1', name: '自定义插件', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('插件产物', { toolCallId: 'x1' }) });
    // 异族（other）到达即落：先收口探索窗（N=4 ≥ 2 组卡）再落插件卡
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card', 'tool-card']);
    const [explore, plugin] = t.snapshot as Array<Extract<TranscriptBlock, { kind: 'tool-card' }>>;
    expect(explore!.group).toMatchObject({ kind: 'exploring', count: 4 });
    expect(plugin!.group).toBeUndefined(); // 插件工具不进组（ΔA⇏ΔC——白名单外即落）
    expect(plugin!.name).toBe('自定义插件');
  });

  it('N≥2 收口组卡：连续同工具双侧成功归并一 entry（args 保序去重并集——count 归并前）', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'r1', { args: { path: 'a.ts' } });
    runExplorePair(t, 'r2', { args: { path: 'b.ts' } });
    expect(t.snapshot).toHaveLength(0); // 窗内暂存
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot).toHaveLength(1);
    const group = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.name).toBe('read'); // 组卡块 name = 窗首条目工具名（事实位）
    expect(group.status).toBe('success');
    expect(group.group).toEqual({
      kind: 'exploring',
      count: 2, // 归并前条目数
      entries: [{ tool: 'read', args: ['a.ts', 'b.ts'], status: 'success' }], // 归并后一 entry
    });
  });

  it('连续 read 去重归并：read a → read b → read a → args 单名录 [a, b]、count=3', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'r1', { args: { path: 'a.ts' } });
    runExplorePair(t, 'r2', { args: { path: 'b.ts' } });
    runExplorePair(t, 'r3', { args: { path: 'a.ts' } });
    apply(t, { type: 'agent_end', status: 'completed' });
    const group = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.group).toMatchObject({ count: 3, entries: [{ tool: 'read', args: ['a.ts', 'b.ts'] }] });
  });

  it("摘要键序表：ls 缺省 path → ['.']；find/grep [pattern, path?]；非 string 坏形缺席", () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'l1', { name: 'ls' }); // 无 path
    runExplorePair(t, 'g1', { name: 'grep', args: { pattern: 'export', path: 'src/' } });
    apply(t, { type: 'agent_end', status: 'completed' });
    const group = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.group).toMatchObject({
      entries: [
        { tool: 'ls', args: ['.'] }, // 缺省 '.' 显式呈现（诚实形）
        { tool: 'grep', args: ['export', 'src/'] }, // 键序 pattern 前 path 后
      ],
    });
    // 非 string 坏形守卫：path=42 → 该键诚实缺席（不进摘要零崩；异工具防归并配对凑窗）
    const t2 = new LiveTranscript();
    runExplorePair(t2, 'r1', { args: { path: 42 } });
    runExplorePair(t2, 'l1', { name: 'ls' });
    apply(t2, { type: 'agent_end', status: 'completed' });
    expect((t2.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>).group).toMatchObject({
      entries: [
        { tool: 'read', args: [] }, // 坏形键缺席 → 空摘要（诚实缺席非伪值）
        { tool: 'ls', args: ['.'] },
      ],
    });
  });

  it('异族到达先收口后落保序：read×2 → bash 到达 → [探索组卡, bash 单卡]（bash 入 exec 窗）', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'r1', { args: { path: 'a.ts' } });
    runExplorePair(t, 'r2', { args: { path: 'b.ts' } });
    runBashPair(t, 'e1', 'echo hi');
    // bash（exec 族）到达即收口探索窗（N=2 组卡落位）+ bash 入 exec 窗暂存
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card']);
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card', 'tool-card']);
    expect(t.snapshot[0]).toMatchObject({ group: { kind: 'exploring', count: 2 } });
    expect(t.snapshot[1]).toMatchObject({ name: 'bash' });
    expect((t.snapshot[1] as Extract<TranscriptBlock, { kind: 'tool-card' }>).group).toBeUndefined(); // N=1 逐卡
  });

  it('修前红锚：bash→read→bash 到达序 = 三窗各 N=1 三逐卡序（异族到达即切窗——修前 read 即时落+exec 窗跨打断合组 N=2）', () => {
    const t = new LiveTranscript();
    runBashPair(t, 'e1', 'echo a');
    runExplorePair(t, 'r1', { args: { path: 'x.ts' } });
    runBashPair(t, 'e2', 'echo b');
    // read 到达切 exec 窗（e1 收口 N=1 单卡）+ read 入探索窗；e2 到达切探索窗（r1 单卡）
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card', 'tool-card']);
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot.map((b) => b.kind).every((k) => k === 'tool-card')).toBe(true);
    expect(t.snapshot.map((b) => (b as Extract<TranscriptBlock, { kind: 'tool-card' }>).name)).toEqual([
      'bash',
      'read',
      'bash',
    ]); // 块序 = 到达序
    expect(t.snapshot.every((b) => (b as { group?: unknown }).group === undefined)).toBe(true); // 三窗各 N=1 全逐卡
  });

  it('失败封闭 + 失败入组：失败条目入组不归并、后续探索开新窗（组头 error + 嵌套诊断行数据源）', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'r1', { args: { path: 'a.ts' } });
    runExplorePair(t, 'r2', { args: { path: 'bad.toml' }, text: 'ENOENT: no such file', isError: true });
    // r2 失败入窗（封闭）；r3 到达切窗收口前窗
    runExplorePair(t, 'r3', { args: { path: 'c.ts' } });
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card']);
    const group = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.status).toBe('error'); // 组级最差态
    expect(group.group).toMatchObject({
      count: 2,
      entries: [
        { tool: 'read', args: ['a.ts'], status: 'success' },
        { tool: 'read', args: ['bad.toml'], status: 'error', errorFirstLine: 'ENOENT: no such file' }, // 失败独立行不归并
      ],
    });
    apply(t, { type: 'agent_end', status: 'completed' });
    expect(t.snapshot).toHaveLength(2); // 新窗 r3 单卡（N=1 < 2）
    expect(t.snapshot[1]).toMatchObject({ name: 'read' });
    expect((t.snapshot[1] as Extract<TranscriptBlock, { kind: 'tool-card' }>).group).toBeUndefined();
  });

  it('中止同律：⏹ 条目入组独立行、窗封闭', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'r1', { args: { path: 'a.ts' } });
    runExplorePair(t, 'r2', { args: { path: 'b.ts' }, text: '中断', details: { aborted: true } });
    runExplorePair(t, 'r3', { args: { path: 'c.ts' } });
    apply(t, { type: 'agent_end', status: 'completed' });
    const group = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-card' }>;
    expect(group.status).toBe('aborted'); // 中止优先于失败（最差态序）
    expect(group.group).toMatchObject({
      entries: [
        { tool: 'read', args: ['a.ts'], status: 'success' },
        { tool: 'read', args: ['b.ts'], status: 'aborted' }, // 无 errorFirstLine（仅 error 态铸诊断行）
      ],
    });
  });

  it('user 消息边界收口：先收口落组卡、user 块在后（窗不跨 user 消息——防御位锚）', () => {
    const t = new LiveTranscript();
    runExplorePair(t, 'r1', { args: { path: 'a.ts' } });
    runExplorePair(t, 'r2', { args: { path: 'b.ts' } });
    apply(t, { type: 'message_end', message: userMsg('打断追问') });
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card', 'user']);
  });
});

describe('LiveTranscript 探索组卡（探索组卡批——投影路窗聚合）', () => {
  /** 两对 read 语料（同窗 ≥2 形） */
  const twoReadPairs = [
    userMsg('问'),
    assistantMsg('', [{ id: 'r1', name: 'read', arguments: { path: 'a.ts' } }]),
    toolResultMsg('ok', { toolCallId: 'r1' }),
    assistantMsg('', [{ id: 'r2', name: 'read', arguments: { path: 'b.ts' } }]),
    toolResultMsg('ok', { toolCallId: 'r2' }),
  ];

  it('两路一致律：直播收口组卡 ≡ loadProjection 窗聚合组卡（逐字段）', () => {
    const live = new LiveTranscript();
    for (const message of twoReadPairs) apply(live, { type: 'message_end', message });
    apply(live, { type: 'agent_end', status: 'completed' });
    const proj = new LiveTranscript();
    proj.loadProjection(twoReadPairs);
    expect(proj.snapshot).toEqual(live.snapshot);
    expect((proj.snapshot[1] as Extract<TranscriptBlock, { kind: 'tool-card' }>).group).toMatchObject({
      kind: 'exploring',
      count: 2,
    });
  });

  it('投影 user 段切分：两窗各自求值（段即窗——探索族同律）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      userMsg('一问'),
      assistantMsg('', [{ id: 'r1', name: 'read', arguments: { path: 'a.ts' } }]),
      toolResultMsg('ok', { toolCallId: 'r1' }),
      assistantMsg('', [{ id: 'r2', name: 'read', arguments: { path: 'b.ts' } }]),
      toolResultMsg('ok', { toolCallId: 'r2' }),
      userMsg('二问'),
      assistantMsg('', [{ id: 'r3', name: 'read', arguments: { path: 'c.ts' } }]),
      toolResultMsg('ok', { toolCallId: 'r3' }),
    ]);
    // 前窗 N=2 组卡 + 后窗 N=1 逐卡——两窗互不串账
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'tool-card', 'user', 'tool-card']);
    expect(t.snapshot[1]).toMatchObject({ group: { kind: 'exploring', count: 2 } });
    expect(t.snapshot[3]).toMatchObject({ name: 'read' });
    expect((t.snapshot[3] as Extract<TranscriptBlock, { kind: 'tool-card' }>).group).toBeUndefined();
  });

  it('投影走查毕收口 + 探索孤儿 ⚙ 兜底：组卡在前孤儿在后（收口序与直播路同序）', () => {
    const t = new LiveTranscript();
    t.loadProjection([
      assistantMsg('', [{ id: 'r1', name: 'read', arguments: { path: 'a.ts' } }]),
      toolResultMsg('ok', { toolCallId: 'r1' }),
      assistantMsg('', [{ id: 'r2', name: 'read', arguments: { path: 'b.ts' } }]),
      toolResultMsg('ok', { toolCallId: 'r2' }),
      assistantMsg('', [{ id: 'r3', name: 'ls', arguments: {} }]), // 孤儿：无 toolResult
    ]);
    expect(t.snapshot.map((b) => b.kind)).toEqual(['tool-card', 'tool-call']);
    expect(t.snapshot[0]).toMatchObject({ group: { count: 2 } }); // 孤儿不入 N
    expect((t.snapshot[1] as { name: string }).name).toBe('ls'); // 探索孤儿 ⚙ 简行照旧族
  });
});

describe('thinkingDoc 折叠期跳过更新（渲染热路径 D3——ctrl+t 展开时重建承接）', () => {
  /** 单帧思考 partial */
  const thinkingPartial = (thinking: string): AgentEvent => ({
    type: 'message_update',
    role: 'assistant',
    partial: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking },
        { type: 'text', text: '正文' },
      ],
      usage,
      stopReason: 'stop',
      timestamp: 1,
    },
  });

  it('折叠期跳过：逐帧 message_update 不换血 thinkingDoc（修前红锚——无条件 update 使账面随最新）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, thinkingPartial('思考一'));
    const slot1 = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    apply(t, thinkingPartial('思考一继续更长'));
    const slot2 = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot2.thinking).toBe('思考一继续更长'); // 槽面思考文照常换新（标签行字数随动）
    expect(slot2.thinkingDoc).toBe(slot1.thinkingDoc); // 同一实例（槽展开携带引用）
    expect(slot2.thinkingDoc?.text).toBeNull(); // 体 doc 全程零换入——折叠档从起步就不布局它（修前红锚：无条件 update 使账面随最新 '思考一继续更长'）
  });

  it('ctrl+t 展开重建：翻转进展开档时 thinkingDoc 重建承接最新思考（展开渲染零陈旧）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, thinkingPartial('思考一'));
    apply(t, thinkingPartial('思考一继续更长'));
    t.toggleThinking(); // 折叠 → 展开
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot.thinkingExpanded).toBe(true);
    expect(slot.thinkingDoc?.text).toBe('思考一继续更长'); // 重建承接最新——展开体行不陈旧
    // 展开档后续帧照常增量（不再跳过）
    apply(t, thinkingPartial('思考一继续更长再加长'));
    const slot2 = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot2.thinkingDoc?.text).toBe('思考一继续更长再加长');
    // 行为等价锁：展开渲染呈现最新思考全文
    const lines = renderBlockStyledLines(slot2, 60);
    expect(lines.some((l) => l.plain.includes('思考一继续更长再加长'))).toBe(true);
  });

  it('展开期折叠回跳过：toggle 回折叠后体 doc 再停更、再展开再重建（双向翻转零陈旧）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, thinkingPartial('阶段一'));
    t.toggleThinking(); // 展开
    apply(t, thinkingPartial('阶段一阶段二')); // 展开档——照常更新
    t.toggleThinking(); // 折叠
    apply(t, thinkingPartial('阶段一阶段二阶段三')); // 折叠档——跳过
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot.thinkingDoc?.text).toBe('阶段一阶段二');
    t.toggleThinking(); // 再展开——重建
    const slot2 = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    expect(slot2.thinkingDoc?.text).toBe('阶段一阶段二阶段三');
  });
});

describe('块间空行制度（Codex 样式复刻批 R-1——07 §4.1 直播路注①：每块渲染层前垫 1 素空行，首块豁免位 leadingGap=false top:0 无垫）', () => {
  /** 空行判据（素垫形——plain 空且零游程） */
  const isBlank = (line: { plain: string }) => line.plain === '';
  /** 流式 doc 速构（rewriteExpandedFlags 同构——new + update 全量） */
  const mkDoc = (text: string): StreamingMarkdown => {
    const doc = new StreamingMarkdown(DEFAULT_THEME);
    doc.update(text);
    return doc;
  };
  /** 双腿槽速构（思考 settled 折叠档 + doc 一行） */
  const twoLegSlot = (thinking: string, text: string): Extract<TranscriptBlock, { kind: 'streaming' }> =>
    ({
      ...slotOf(1, text, mkDoc(text)),
      thinking,
      thinkingDoc: null,
      thinkingSettled: true,
      thinkingStartAt: 1,
      thinkingSettledAt: 2,
    }) as Extract<TranscriptBlock, { kind: 'streaming' }>;

  it('markdown 块前垫：缺省首行空行 + leadingGap=false 剥垫首行即内容', () => {
    const block: TranscriptBlock = { kind: 'markdown', doc: MarkdownDoc.of('# 标题', DEFAULT_THEME) };
    const padded = renderBlockStyledLines(block, 40);
    expect(padded.length).toBeGreaterThan(1);
    expect(isBlank(padded[0]!)).toBe(true);
    expect(isBlank(padded[1]!)).toBe(false);
    const bare = renderBlockStyledLines(block, 40, false);
    expect(bare.length).toBe(padded.length - 1);
    expect(isBlank(bare[0]!)).toBe(false);
  });

  it('thinking 块前垫：同律（缺省 [空,标签行,…] / 豁免 [标签行,…]）', () => {
    const block: TranscriptBlock = {
      kind: 'thinking',
      text: '思考体',
      expanded: false,
      durationMs: undefined,
      theme: DEFAULT_THEME,
      toggleHint: 'ctrl+t',
      doc: MarkdownDoc.of('思考体', DEFAULT_THEME),
    };
    const padded = renderBlockStyledLines(block, 40);
    expect(isBlank(padded[0]!)).toBe(true);
    expect(isBlank(padded[1]!)).toBe(false);
    const bare = renderBlockStyledLines(block, 40, false);
    expect(bare.length).toBe(padded.length - 1);
    expect(isBlank(bare[0]!)).toBe(false);
  });

  it('简行族前垫：tool-call / tool-result / error / compaction 同律（tool-card 既有垫并入制度不再单列）', () => {
    const blocks: TranscriptBlock[] = [
      { kind: 'tool-call', name: 'read', brief: ' 简述' },
      { kind: 'tool-result', brief: ' 简述' },
      { kind: 'error', text: '出错了', theme: DEFAULT_THEME },
      { kind: 'compaction', count: 3 },
    ];
    for (const block of blocks) {
      const padded = renderBlockStyledLines(block, 40);
      expect(isBlank(padded[0]!)).toBe(true);
      expect(isBlank(padded[1]!)).toBe(false);
      const bare = renderBlockStyledLines(block, 40, false);
      expect(bare.length).toBe(padded.length - 1);
    }
  });

  it('user 块 = 通用垫 + 既有三明治（前视觉 2 空行——外素垫 + 内包夹）；豁免形剥通用垫留包夹空行', () => {
    const block: TranscriptBlock = { kind: 'user', text: '你好', theme: DEFAULT_THEME };
    const padded = renderBlockStyledLines(block, 40);
    expect(isBlank(padded[0]!)).toBe(true); // 通用垫（制度行）
    expect(isBlank(padded[1]!)).toBe(true); // 三明治首空行（块内行——豁免不剥）
    expect(padded[2]!.plain.startsWith('› ')).toBe(true);
    const bare = renderBlockStyledLines(block, 40, false);
    expect(isBlank(bare[0]!)).toBe(true); // 包夹空行保留
    expect(bare[1]!.plain.startsWith('› ')).toBe(true);
  });

  it('user 折行宽 −3（前缀 2 + 右缘 1——与 composer innerWidth 同口径）', () => {
    // columns=8 → 内容宽 5：10 字符纯串折 ['abcde','fghij']；首行 '› abcde'
    const block: TranscriptBlock = { kind: 'user', text: 'abcdefghij', theme: DEFAULT_THEME };
    const lines = renderBlockStyledLines(block, 8, false);
    expect(lines[1]!.plain).toBe('› abcde');
    expect(lines[2]!.plain).toBe('  fghij');
  });

  it('槽组合镜像：[垫]+think+[腿间垫]+doc（两腿各前 1 素空行）；leadingGap=false 无头垫；text-only = [垫]+doc', () => {
    const twoLegs = twoLegSlot('思考', 'hello');
    const tail = renderSlotTailLines(twoLegs, 40, 0);
    // 折叠档思考 = 标签 1 行；doc 'hello' 1 行 → 总 = 垫 1 + 思考 1 + 腿间垫 1 + doc 1 = 4
    expect(tail.total).toBe(4);
    expect(tail.lines[0]!.trim()).toBe('');
    expect(tail.lines[1]!.includes('思考')).toBe(true);
    expect(tail.lines[2]!.trim()).toBe('');
    expect(tail.lines[3]!.includes('hello')).toBe(true);
    const bare = renderSlotTailLines(twoLegs, 40, 0, false);
    expect(bare.total).toBe(3);
    expect(bare.lines[0]!.includes('思考')).toBe(true);
    // text-only：无思考 → [垫]+doc（无双垫）
    const textOnly = renderSlotTailLines(
      slotOf(1, 'hello', mkDoc('hello')) as Extract<TranscriptBlock, { kind: 'streaming' }>,
      40,
      0,
    );
    expect(textOnly.total).toBe(2);
    expect(textOnly.lines[0]!.trim()).toBe('');
    expect(textOnly.lines[1]!.includes('hello')).toBe(true);
  });

  it('stableSlotLineCount 同参数同账（垫 + 腿间垫入稳定面——冻结账与渲染行集同尺）', () => {
    const twoLegs = twoLegSlot('思考', 'hello');
    // doc 'hello' 单段流式段落 tailSafe=false → doc 腿稳定 0（既有契约：尾块
    // 随流重排不入冻结面）；稳定面 = 垫 1 + 思考 1 + 腿间垫 1 = 3；豁免位剥头垫 = 2
    expect(stableSlotLineCount(twoLegs, 40)).toBe(3);
    expect(stableSlotLineCount(twoLegs, 40, false)).toBe(2);
  });

  it('对拍锁扩参：leadingGap=false 两侧同参逐字节一致（全量渲染 vs 尾窗 startRow=0）', () => {
    const twoLegs = twoLegSlot('思考内容', 'hello world longer text');
    for (const gap of [true, false]) {
      const full = renderBlockLines(twoLegs, 40, gap);
      const tail = renderSlotTailLines(twoLegs, 40, 0, gap);
      expect(tail.lines).toEqual(full);
      expect(tail.total).toBe(full.length);
    }
  });
});

describe('会话头卡（Codex 样式复刻批 R-7——07 §4.1 2026-10-10 durable 首块）', () => {
  /** 头卡块速构（三值全在场基形；覆写键零散传） */
  const headerBlock = (over: { version?: string; model?: string; directory?: string } = {}): TranscriptBlock => ({
    kind: 'session-header',
    version: over.version ?? '0.1.1',
    model: over.model ?? 'zhipu/glm-4.7',
    directory: over.directory ?? '/Users/w/demo',
  });

  it('渲染形 80 列：inner 帽 56 咬合 + 圆角框线 dim + 首行三段游程（>_ dim/名 bold/版本 dim）', () => {
    const styled = renderBlockStyledLines(headerBlock(), 80, false); // 首块豁免位——top:0 无垫
    expect(styled).toHaveLength(5); // 顶框 + 首行 + model + directory + 底框
    const bar = '─'.repeat(56);
    // 顶/底框：整行单 dim 游程
    expect(styled[0]).toEqual({ plain: `╭${bar}╮`, runs: [{ start: 0, end: 58, style: DIM_STYLE }] });
    expect(styled[4]).toEqual({ plain: `╰${bar}╯`, runs: [{ start: 0, end: 58, style: DIM_STYLE }] });
    // 首行：│ + >_ berry-agent (v0.1.1)（宽 23：3+11+9）+ 垫 33 + │；三段内容游程
    // nameStart = 1+3 = 4、名段 [4,15)、版本段 [15,24)
    expect(styled[1]!.plain).toBe(`│>_ berry-agent (v0.1.1)${' '.repeat(33)}│`);
    expect(styled[1]!.runs).toEqual([
      { start: 0, end: 1, style: DIM_STYLE },
      { start: 1, end: 4, style: DIM_STYLE },
      { start: 4, end: 15, style: { bold: true } },
      { start: 15, end: 24, style: DIM_STYLE },
      { start: 57, end: 58, style: DIM_STYLE },
    ]);
    // model/directory 行：内容零游程（默认前景）+ 左右框符 dim
    expect(styled[2]!.plain.startsWith('│model: zhipu/glm-4.7')).toBe(true);
    expect(styled[2]!.runs).toEqual([
      { start: 0, end: 1, style: DIM_STYLE },
      { start: 57, end: 58, style: DIM_STYLE },
    ]);
    expect(styled[3]!.plain.startsWith('│directory: /Users/w/demo')).toBe(true);
  });

  it('窄终端随收：40 列 inner=36（columns−4）；CJK 宽算术——stringWidth(plain) 恒 inner+2（垫空显示宽账）', () => {
    const styled = renderBlockStyledLines(headerBlock({ directory: '/w/中文目录' }), 40, false);
    expect(styled).toHaveLength(5);
    const top = styled[0]!;
    expect(top.plain).toBe(`╭${'─'.repeat(36)}╮`); // inner 36 = min(40−4, 56)
    // directory 行：内容宽 = 'directory: /w/中文目录'（12 + 8 = 20 显示宽），
    // 垫空 16 → │ 落码位 37（码位 length = 38 ≠ 显示宽 38——CJK 垫空按显示宽算术）
    const dirLine = styled[3]!;
    expect(stringWidth(dirLine.plain)).toBe(38); // inner + 2
    expect(dirLine.plain.endsWith('│')).toBe(true);
    expect(dirLine.plain.startsWith('│directory: /w/中文目录')).toBe(true);
    // 右框符游程端点是码位账：[plain.length−1, plain.length)
    expect(dirLine.runs[dirLine.runs.length - 1]).toEqual({
      start: dirLine.plain.length - 1,
      end: dirLine.plain.length,
      style: DIM_STYLE,
    });
  });

  it('超长 directory ellipsize 收口 + 空值诚实缺席（空版本裸名/空 model 行不显）', () => {
    // 80 列 inner 56：超长目录截断（'directory: ' 11 + 目录 100 → ellipsize 至 56）
    const long = renderBlockStyledLines(headerBlock({ directory: '/'.repeat(100) }), 80, false);
    const dirLine = long[3]!;
    expect(dirLine.plain).toBe(`│directory: ${'/'.repeat(44)}…│`); // 11 + 44 + 1 = 56
    // 空串三缺席位：空版本（裸名无缀）+ 空 model（行不显）+ 空 directory（行不显）
    const sparse = renderBlockStyledLines(headerBlock({ version: '', model: '', directory: '' }), 80, false);
    expect(sparse).toHaveLength(3); // 顶框 + 首行 + 底框
    expect(sparse[1]!.plain).toBe(`│>_ berry-agent${' '.repeat(42)}│`); // 头宽 14 + 垫 42 = 56
    expect(sparse[1]!.runs).toEqual([
      { start: 0, end: 1, style: DIM_STYLE },
      { start: 1, end: 4, style: DIM_STYLE },
      { start: 4, end: 15, style: { bold: true } },
      { start: 57, end: 58, style: DIM_STYLE },
    ]);
  });

  it('极窄终端（inner ≤ 0）零行诚实缺席', () => {
    expect(renderBlockStyledLines(headerBlock(), 4, false)).toEqual([]); // columns−4 = 0
  });

  it('构造注入：header 在场即 durable 首块；缺席 = 无头卡旧形（viewer 复用/测试基线零扰动）', () => {
    const withHeader = new LiveTranscript({ header: { version: '1.0.0', model: 'm-1', directory: '/w' } });
    expect(withHeader.snapshot).toHaveLength(1);
    expect(withHeader.snapshot[0]!.kind).toBe('session-header');
    expect(dialogueBlockCount(withHeader.snapshot)).toBe(0); // 头卡不计对话块
    expect(withHeader.blockCount).toBe(1); // 块位账计入（帽观测面不排除）
    expect(new LiveTranscript().snapshot).toHaveLength(0); // 缺席旧形
  });

  it('loadProjection 前插同源：投影重建头卡仍首位 + 帽裁同队让位（头卡无特权位）', () => {
    const t = new LiveTranscript({ header: { version: '1.0.0', model: 'm-1', directory: '/w' }, blockCap: 3 });
    t.loadProjection([userMsg('你好'), assistantMsg('在的')]);
    expect(t.blockCount).toBe(3); // 头卡 + user + assistant = 3 ≤ 帽 3
    expect(t.snapshot[0]!.kind).toBe('session-header'); // 前插首位——repaint 不换头
    expect(dialogueBlockCount(t.snapshot)).toBe(2);
    // 超帽裁前缀：头卡与旧对话块同队让位（slice 卸前缀——头卡块 0 先出列）
    t.loadProjection([userMsg('a'), assistantMsg('b'), userMsg('c')]);
    expect(t.blockCount).toBe(3); // 帽 3 钳位
    expect(t.snapshot[0]!.kind).not.toBe('session-header'); // 头卡已让位（诚实裁块非特权）
  });

  it('dialogueBlockCount：空集 0 / 纯头卡 0 / 头卡+2 对话块 2 / 无头卡 2（零块判据单源）', () => {
    expect(dialogueBlockCount([])).toBe(0);
    expect(dialogueBlockCount([headerBlock()])).toBe(0);
    const user1: TranscriptBlock = { kind: 'user', text: '一', theme: DEFAULT_THEME };
    const user2: TranscriptBlock = { kind: 'user', text: '二', theme: DEFAULT_THEME };
    expect(dialogueBlockCount([headerBlock(), user1, user2])).toBe(2);
    expect(dialogueBlockCount([user1, user2])).toBe(2);
  });
});

/* ---------------- 审批决策落史行（挖掘 31 轮 [1]）——块渲染 + 投影归位 + 直播腿 ---------------- */

describe('LiveTranscript 审批决策块（挖掘 31 轮 [1]——approval-decision）', () => {
  /** 决策块速构（渲染面直锁） */
  const decisionBlock = (decision: 'approve' | 'always' | 'reject', summary: string): TranscriptBlock => ({
    kind: 'approval-decision',
    decision,
    summary,
    theme: DEFAULT_THEME,
  });

  it('词面三档 + 游程色：approve/always 首游程 success、reject 首游程 error、次游程 summary 恒 dim', () => {
    // 修前红：union 无此 kind——switch 穷尽性红（esbuild 只剥类型，运行红落渲染缺席）
    const approve = renderBlockStyledLines(decisionBlock('approve', 'rm -rf /tmp/x'), 100, false);
    expect(approve).toHaveLength(1);
    expect(approve[0]!.plain).toBe('✓ 已批准 · rm -rf /tmp/x');
    expect(approve[0]!.runs[0]!.style.fg).toEqual(DEFAULT_THEME.success); // 首游程（✓ 已批准）语义色
    expect(approve[0]!.runs[approve[0]!.runs.length - 1]!.style.dim).toBe(true); // 次游程（summary）dim
    const always = renderBlockStyledLines(decisionBlock('always', 'git push'), 100, false);
    expect(always[0]!.plain).toBe('✓ 已总是批准 · git push');
    expect(always[0]!.runs[0]!.style.fg).toEqual(DEFAULT_THEME.success);
    const reject = renderBlockStyledLines(decisionBlock('reject', 'git push'), 100, false);
    expect(reject[0]!.plain).toBe('✗ 已拒绝 · git push');
    expect(reject[0]!.runs[0]!.style.fg).toEqual(DEFAULT_THEME.error);
  });

  it('多行 summary 一行化（折空换行）+ 超宽整字截断（capStyledLine 出口帽）', () => {
    const multi = renderBlockStyledLines(decisionBlock('approve', '第一行\n\n  第二行\r\n第三行'), 100, false);
    expect(multi).toHaveLength(1); // 一行化——非多行块
    expect(multi[0]!.plain).toBe('✓ 已批准 · 第一行第二行第三行');
    // 超宽：80 列截断（plain 长度受帽、无半字——宽感知整字截断）
    const wide = renderBlockStyledLines(decisionBlock('approve', `bash ${'x'.repeat(90)}`), 80, false);
    expect(wide).toHaveLength(1);
    expect(stringWidth(wide[0]!.plain)).toBeLessThanOrEqual(80);
    expect(wide[0]!.plain.startsWith('✓ 已批准 · bash x')).toBe(true);
  });

  it('loadProjection 行位 seq 锚：决策按 seq 归位到其后首条消息之前（词法序不丢位）', () => {
    const t = new LiveTranscript();
    t.loadProjection(
      [
        { ...userMsg('问'), seq: 0 },
        { ...assistantMsg('答'), seq: 2 },
      ] as never,
      [{ seq: 1, decision: 'approve', summary: 'rm' }],
    );
    expect(t.snapshot.map((b) => b.kind)).toEqual(['user', 'approval-decision', 'markdown']);
  });

  it('尾 flush 两形：决策 seq 晚于全部消息 → 尾块；消息零 seq → 降级尾 flush 不丢', () => {
    const late = new LiveTranscript();
    late.loadProjection([{ ...userMsg('问'), seq: 0 }] as never, [{ seq: 5, decision: 'reject', summary: 'git push' }]);
    expect(late.snapshot.map((b) => b.kind)).toEqual(['user', 'approval-decision']); // 尾块
    const noSeq = new LiveTranscript();
    // 消息全零 seq（模型 timeline 种子形）——决策无法定锚 → 尾 flush 降级（诚实不丢）
    noSeq.loadProjection([userMsg('问'), assistantMsg('答')], [{ seq: 1, decision: 'approve', summary: 'x' }]);
    expect(noSeq.snapshot.map((b) => b.kind)).toEqual(['user', 'markdown', 'approval-decision']);
  });

  it('直播腿：appendApprovalDecision 入块账（dialogueBlockCount 计入）+ blockCap 同队让位', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('答') });
    const before = dialogueBlockCount(t.snapshot);
    t.appendApprovalDecision({ decision: 'approve', summary: 'bash npm test', theme: DEFAULT_THEME });
    expect(dialogueBlockCount(t.snapshot)).toBe(before + 1); // 块账在册——非瞬时行
    expect(t.snapshot[t.snapshot.length - 1]).toMatchObject({ kind: 'approval-decision', decision: 'approve' });
    // 帽卸载同队：blockCap 2 下追加第 3 对话块 → 前缀出列（决策块无特权位）
    const capped = new LiveTranscript({ blockCap: 2 });
    capped.appendApprovalDecision({ decision: 'approve', summary: '一', theme: DEFAULT_THEME });
    capped.appendApprovalDecision({ decision: 'reject', summary: '二', theme: DEFAULT_THEME });
    capped.appendApprovalDecision({ decision: 'approve', summary: '三', theme: DEFAULT_THEME });
    expect(capped.blockCount).toBe(2);
    expect(capped.snapshot.map((b) => (b.kind === 'approval-decision' ? b.decision : b.kind))).toEqual([
      'reject',
      'approve',
    ]); // 首决策块让位、末决策块在场
  });

  it('直播/重建同构：同一 durable 序下直播终态块序 === 投影重建块序（两路单源律）', () => {
    // 直播腿：消息事件流 + 总线追加（追加时点在两消息之间——与 decided seq 序同构）
    const live = new LiveTranscript();
    apply(live, { type: 'message_end', message: assistantMsg('第一答') });
    live.appendApprovalDecision({ decision: 'approve', summary: 'bash npm test', theme: DEFAULT_THEME });
    apply(live, { type: 'message_end', message: assistantMsg('第二答') });
    // 重建腿：投影消息携 seq + 决策按 seq 归位
    const rebuilt = new LiveTranscript();
    rebuilt.loadProjection(
      [
        { ...assistantMsg('第一答'), seq: 0 },
        { ...assistantMsg('第二答'), seq: 2 },
      ] as never,
      [{ seq: 1, decision: 'approve', summary: 'bash npm test' }],
    );
    const kindsOf = (blocks: readonly TranscriptBlock[]): string[] => blocks.map((b) => b.kind);
    expect(kindsOf(live.snapshot)).toEqual(kindsOf(rebuilt.snapshot)); // 块序同构
    const liveDecision = live.snapshot.find((b) => b.kind === 'approval-decision');
    const rebuiltDecision = rebuilt.snapshot.find((b) => b.kind === 'approval-decision');
    expect(rebuiltDecision).toMatchObject({
      decision: (liveDecision as { decision: string }).decision,
      summary: (liveDecision as { summary: string }).summary,
    });
  });
});

/* ---------------- 问答落史行（挖掘 36 轮 [2]）——live-only 块渲染 + 入账 + 重建消失 ---------------- */

describe('LiveTranscript 问答落史行块（挖掘 36 轮 [2]——ask-decision live-only）', () => {
  /** 落史行块速构（渲染面直锁） */
  const askBlock = (outcome: 'answered' | 'cancelled', question: string, answer?: string): TranscriptBlock => ({
    kind: 'ask-decision',
    outcome,
    question,
    ...(answer !== undefined ? { answer } : {}),
    theme: DEFAULT_THEME,
  });

  it('词面两态 + 游程色：answered「↳ 已回复 · 问题 · 答案」三游程（accent/dim/accent）、cancelled「↳ 已取消 · 问题」无答案段（secondary/dim）', () => {
    // 修前红：union 无此 kind——switch 穷尽性红（无 default 的联合穷尽杠杆）
    const answered = renderBlockStyledLines(askBlock('answered', '继续吗', '是'), 100, false);
    expect(answered).toHaveLength(1); // 一行制
    expect(answered[0]!.plain).toBe('↳ 已回复 · 继续吗 · 是');
    expect(answered[0]!.runs).toHaveLength(3); // 首词 + 问题段 + 答案段
    expect(answered[0]!.runs[0]).toMatchObject({
      start: 0,
      end: '↳ 已回复'.length,
      style: { fg: DEFAULT_THEME.accent },
    });
    expect(answered[0]!.runs[1]!.style.dim).toBe(true); // 问题段 dim（次色）
    expect(answered[0]!.runs[2]).toMatchObject({ style: { fg: DEFAULT_THEME.accent } }); // 答案段主色
    const cancelled = renderBlockStyledLines(askBlock('cancelled', '继续吗'), 100, false);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.plain).toBe('↳ 已取消 · 继续吗'); // 无答案段
    expect(cancelled[0]!.runs).toHaveLength(2);
    expect(cancelled[0]!.runs[0]).toMatchObject({ style: { fg: DEFAULT_THEME.secondary } }); // 弱化事实非成败
    expect(cancelled[0]!.runs[1]!.style.dim).toBe(true);
  });

  it('多行折叠一行 + 控制字节消毒（sanitizeDisplayText——answer 是用户自由输入）+ 超宽出口帽', () => {
    const multi = renderBlockStyledLines(askBlock('answered', '第一行\n  第二行', '答一\n答二'), 100, false);
    expect(multi).toHaveLength(1); // 一行化——非多行块
    expect(multi[0]!.plain).toBe('↳ 已回复 · 第一行第二行 · 答一答二');
    // 消毒：OSC 52 转义整段剥除（consumeEscapeSequence 吞全段）/ CR 剥除——不入屏账（问题/答案两段同律）
    const dirty = renderBlockStyledLines(askBlock('answered', 'q\x1b]52;c;aGk=\x07', 'a\rb'), 100, false);
    expect(dirty[0]!.plain.includes('\x1b')).toBe(false);
    expect(dirty[0]!.plain).toBe('↳ 已回复 · q · ab');
    // 超宽：80 列整字截断（出口帽 capStyledLine——宽感知无半字）
    const wide = renderBlockStyledLines(askBlock('answered', `问${'长'.repeat(90)}`, '答'), 80, false);
    expect(wide).toHaveLength(1);
    expect(stringWidth(wide[0]!.plain)).toBeLessThanOrEqual(80);
    expect(wide[0]!.plain.startsWith('↳ 已回复 · 问长')).toBe(true);
  });

  it('dialogueBlockCount 计入（排除式计数只除会话头卡——ask-decision 在册）', () => {
    const block = askBlock('cancelled', '问');
    expect(dialogueBlockCount([block])).toBe(1);
  });

  it('直播腿：appendAskDecision 入块账（dialogueBlockCount 计入 + 尾块在场）+ onRepaint 投影重建后诚实消失（live-only 锁）', () => {
    // 修前红：appendAskDecision 未存在（TS2339）
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('答') });
    const before = dialogueBlockCount(t.snapshot);
    t.appendAskDecision({ outcome: 'answered', question: '继续吗', answer: '是' });
    expect(dialogueBlockCount(t.snapshot)).toBe(before + 1); // 块账在册——非瞬时行
    expect(t.snapshot[t.snapshot.length - 1]).toMatchObject({ kind: 'ask-decision', outcome: 'answered' });
    // live-only 锁：投影重建（loadProjection 无 ask 源参——durable 投影源零此族）
    // 后块消失 = 语义（scrollback 是呈现缓存非事实源——防后人误补 durable 的
    // 回归锁：重建后块账不含 ask-decision 即绿）
    t.loadProjection([
      { ...userMsg('问'), seq: 0 },
      { ...assistantMsg('答'), seq: 1 },
    ] as never);
    expect(t.snapshot.some((b) => b.kind === 'ask-decision')).toBe(false);
  });
});

/* ---------------- todo 清单落史快照（挖掘 35 轮 B8）——签名闸 + 渲染 + 投影归位 ---------------- */

describe('LiveTranscript todo 快照块（挖掘 35 轮 B8——todo-snapshot）', () => {
  /** 条目速构（呈现投影形） */
  const todoItem = (
    status: 'pending' | 'in-progress' | 'completed' | 'deferred',
    content: string,
    activeForm?: string,
  ): TodoItem => ({ status, content, ...(activeForm !== undefined ? { activeForm } : {}) });

  /** 快照块速构（渲染面直锁） */
  const snapshotBlock = (items: readonly TodoItem[]): TranscriptBlock => ({
    kind: 'todo-snapshot',
    seq: 1,
    items,
    theme: DEFAULT_THEME,
  });

  it('渲染：卡头 • dim + 词 bold；四态条目行——in-progress accent bold（activeForm 优先词面）/ completed dim+划线 / pending+deferred dim', () => {
    const lines = renderBlockStyledLines(
      snapshotBlock([
        todoItem('in-progress', '写实现', '正在写实现'),
        todoItem('pending', '补测试'),
        todoItem('completed', 'fold 规则'),
        todoItem('deferred', '缓办项'),
      ]),
      100,
      false,
    );
    // 修前红：union 无此 kind——switch 穷尽性红
    expect(lines).toHaveLength(5); // 卡头 + 四条目
    expect(lines[0]!.plain).toBe('• 任务清单已更新');
    expect(lines[0]!.runs[0]).toMatchObject({ start: 0, end: 1, style: { dim: true } }); // • 前缀 dim
    expect(lines[0]!.runs[1]).toMatchObject({ start: 2, style: { bold: true } }); // 词 bold
    // in-progress：accent bold + activeForm 优先于 content 词面
    expect(lines[1]!.plain).toBe('  ◐ 正在写实现');
    expect(lines[1]!.runs[0]!.style.fg).toEqual(DEFAULT_THEME.accent);
    expect(lines[1]!.runs[0]!.style.bold).toBe(true);
    // pending/deferred：dim（无色无粗）；completed：dim 之上加划线（SGR 9 首消费）
    expect(lines[2]!.plain).toBe('  ☐ 补测试');
    expect(lines[2]!.runs[0]!.style.dim).toBe(true);
    expect(lines[2]!.runs[0]!.style.strikethrough).toBeUndefined();
    expect(lines[3]!.plain).toBe('  ☑ fold 规则');
    expect(lines[3]!.runs[0]!.style.dim).toBe(true);
    expect(lines[3]!.runs[0]!.style.strikethrough).toBe(true);
    expect(lines[4]!.plain).toBe('  ⊙ 缓办项');
    expect(lines[4]!.runs[0]!.style.dim).toBe(true);
    expect(lines[4]!.runs[0]!.style.strikethrough).toBeUndefined();
  });

  it('渲染：空表仅卡头（诚实呈现「已更新为零项」）；in-progress 无 activeForm 退化 content 词面', () => {
    const empty = renderBlockStyledLines(snapshotBlock([]), 100, false);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.plain).toBe('• 任务清单已更新');
    const noActive = renderBlockStyledLines(snapshotBlock([todoItem('in-progress', '裸词面')]), 100, false);
    expect(noActive[1]!.plain).toBe('  ◐ 裸词面');
  });

  it('签名闸：首条必落 / 同签跳过 / seq 已录位幂等 / 异签才落（status+content 进签、activeForm 不进）', () => {
    const t = new LiveTranscript();
    t.appendTodoSnapshot({ seq: 5, items: [todoItem('pending', '甲')] });
    expect(t.snapshot).toHaveLength(1); // 首条必落
    t.appendTodoSnapshot({ seq: 6, items: [todoItem('pending', '甲')] }); // 同签（status+content 同）
    expect(t.snapshot).toHaveLength(1); // 同签跳过
    t.appendTodoSnapshot({
      seq: 6,
      items: [todoItem('pending', '甲', '加 activeForm')], // activeForm 不进签名——仍同签
    });
    expect(t.snapshot).toHaveLength(1);
    t.appendTodoSnapshot({ seq: 4, items: [todoItem('completed', '甲')] }); // seq ≤ 已录位（幂等重放形）
    expect(t.snapshot).toHaveLength(1); // 已录位零重落
    t.appendTodoSnapshot({ seq: 7, items: [todoItem('completed', '甲')] }); // 状态翻转——异签
    expect(t.snapshot).toHaveLength(2); // 才落
    expect(t.snapshot[1]).toMatchObject({ kind: 'todo-snapshot', seq: 7 });
  });

  it('直播腿块账在册：dialogueBlockCount 计入 + blockCap 同队让位（无特权位）', () => {
    const t = new LiveTranscript();
    t.appendTodoSnapshot({ seq: 1, items: [todoItem('pending', '甲')] });
    expect(dialogueBlockCount(t.snapshot)).toBe(1); // 块账在册——非瞬时行
    const capped = new LiveTranscript({ blockCap: 2 });
    capped.appendTodoSnapshot({ seq: 1, items: [todoItem('pending', '一')] });
    capped.appendTodoSnapshot({ seq: 2, items: [todoItem('completed', '一')] });
    capped.appendTodoSnapshot({ seq: 3, items: [todoItem('pending', '二')] });
    expect(capped.blockCount).toBe(2);
    expect(capped.snapshot.map((b) => (b.kind === 'todo-snapshot' ? b.seq : b.kind))).toEqual([2, 3]); // 首块让位
  });

  it('投影归位：[assistant][快照][工具卡]——快照落位在配对工具卡之前（durable 序 Sa<S1<S2<S3 两路同构）', () => {
    const t = new LiveTranscript();
    t.loadProjection(
      [
        { ...assistantMsg('干', [{ id: 'tc1', name: 'todo', arguments: {} }]), seq: 0 },
        { ...toolResultMsg('已更新', { toolCallId: 'tc1' }), seq: 2 },
      ] as never,
      [],
      [{ seq: 1, items: [todoItem('pending', '甲')] }], // todo/write durable 位在 tool/call 与 tool/result 之间
    );
    expect(t.snapshot.map((b) => b.kind)).toEqual(['markdown', 'todo-snapshot', 'tool-card']);
  });

  it('投影 flush 逐条过闸：批内两同签快照只落一块（中间态异签保留——与直播腿同一块集）', () => {
    const t = new LiveTranscript();
    t.loadProjection(
      [{ ...userMsg('问'), seq: 0 }] as never,
      [],
      [
        { seq: 1, items: [todoItem('pending', '甲')] },
        { seq: 2, items: [todoItem('pending', '甲')] }, // 同签——flush 过闸跳过
        { seq: 3, items: [todoItem('in-progress', '甲')] }, // 状态翻转——异签保留
      ],
    );
    expect(t.snapshot.filter((b) => b.kind === 'todo-snapshot')).toHaveLength(2); // 同签并一、异签两档
  });

  it('投影尾 flush 两形：快照 seq 晚于全部消息 → 尾块；消息零 seq → 降级尾 flush 不丢', () => {
    const late = new LiveTranscript();
    late.loadProjection([{ ...userMsg('问'), seq: 0 }] as never, [], [{ seq: 5, items: [todoItem('pending', '甲')] }]);
    expect(late.snapshot.map((b) => b.kind)).toEqual(['user', 'todo-snapshot']); // 尾块
    const noSeq = new LiveTranscript();
    noSeq.loadProjection([userMsg('问'), assistantMsg('答')], [], [{ seq: 1, items: [todoItem('pending', '甲')] }]);
    expect(noSeq.snapshot.map((b) => b.kind)).toEqual(['user', 'markdown', 'todo-snapshot']); // 降级尾 flush
  });

  it('直播/重建同构：同一 durable 序下直播终态块序 === 投影重建块序（两路单源律）', () => {
    // 直播腿：tool_execution_end 锚时点全序列拉取过闸（appendTodoSnapshot）
    const live = new LiveTranscript();
    apply(live, { type: 'message_end', message: assistantMsg('干', [{ id: 'tc1', name: 'todo', arguments: {} }]) });
    live.appendTodoSnapshot({ seq: 1, items: [todoItem('pending', '甲')] });
    apply(live, { type: 'message_end', message: toolResultMsg('已更新', { toolCallId: 'tc1' }) });
    // 重建腿：投影消息携 seq + 快照按 seq 归位
    const rebuilt = new LiveTranscript();
    rebuilt.loadProjection(
      [
        { ...assistantMsg('干', [{ id: 'tc1', name: 'todo', arguments: {} }]), seq: 0 },
        { ...toolResultMsg('已更新', { toolCallId: 'tc1' }), seq: 2 },
      ] as never,
      [],
      [{ seq: 1, items: [todoItem('pending', '甲')] }],
    );
    expect(live.snapshot.map((b) => b.kind)).toEqual(rebuilt.snapshot.map((b) => b.kind)); // 块序同构
  });
});

describe('forkEditAnchorsOf 回溯锚单源（挖掘 36 轮件 8——session-rewind-fork）', () => {
  /** seq 回贴形工厂（投影副本增位——projectionWithSeqOf 产物同构） */
  const seqMsg = (message: AgentMessage, seq: number): AgentMessage & { seq: number } =>
    ({ ...message, seq }) as AgentMessage & { seq: number };

  it('判据 = rendersAsUserBlock 同集 + seq 在场：assistant/机器注入族/无 seq 形全滤除', () => {
    const anchors = forkEditAnchorsOf([
      seqMsg(userMsg('第一条'), 3),
      seqMsg(assistantMsg('回答'), 5),
      seqMsg(userMsg('结算通知', 'subagent-settled'), 7),
      seqMsg(userMsg('审批挂起', 'subagent-approval-pending'), 8),
      seqMsg(userMsg('[COMPACTION-SUMMARY] 摘要正文', 'compaction'), 9),
      userMsg('无 seq 老投影形'), // seq 缺席不入锚——1:1 配对保护（viewer 侧降级判据）
      seqMsg(userMsg('第二条'), 12),
    ]);
    expect(anchors).toEqual([
      { seq: 3, text: '第一条' },
      { seq: 12, text: '第二条' },
    ]);
  });

  it('图文消息纯文本直拼（图块诚实缺席不产「[图片]」占位）；纯图消息 text 空串保锚（1:1 账守恒）', () => {
    const imgOnly = {
      role: 'user',
      content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
      timestamp: 1,
      seq: 4,
    } as unknown as AgentMessage & { seq: number };
    const mixed = {
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image-ref', ref: `sha256:${'a'.repeat(64)}`, mimeType: 'image/png', bytes: 1 },
        { type: 'text', text: '补充' },
      ],
      timestamp: 1,
      seq: 6,
    } as unknown as AgentMessage & { seq: number };
    expect(forkEditAnchorsOf([imgOnly, mixed])).toEqual([
      { seq: 4, text: '' }, // 回填面不造假占位（joinTextBlocks 呈现形分立）
      { seq: 6, text: '看图补充' }, // 文本块零分隔直拼
    ]);
  });
});
