/**
 * LiveTranscript 渲染归约测试（批 10e-1——纯逻辑零 IO）。
 *
 * 覆盖：流式两段（开槽/直换/定稿换装）、流式单槽守卫、唯一渲染源律
 * （tool_execution_* 正文零渲染）、非聚焦摘要行分档、投影重建、帽卸载。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ansiColor, sanitizeDisplayText, stringWidth } from '../../engine/index.js';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage, AssistantMessage } from '../../../contracts/index.js';
import { ccrMarkerLine } from '../../../contracts/index.js';
import { LIGHT_PALETTE, resolveTheme, DEFAULT_THEME } from '../theme/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import { DIM_STYLE } from '../markdown/layout.js';
import { renderThinkingStyledLines } from '../blocks/thinking.js';
import {
  dialogueBlockCount,
  LiveTranscript,
  renderBlockLines,
  renderBlockStyledLines,
  renderSlotTailLines,
  shortIdOf,
  stableSlotLineCount,
  TRANSCRIPT_BLOCK_CAP,
  type TranscriptBlock,
} from './transcript.js';
import { buildSgr, styledLineToAnsi } from './ansi-rows.js';

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
  it('配对落卡：toolCall 入账不落行 → toolResult 到达落三态卡（卡名取调用侧非结果侧）', () => {
    const t = new LiveTranscript();
    apply(t, {
      type: 'message_end',
      message: assistantMsg('', [{ id: 'tc1', name: 'grep', arguments: { pattern: 'x', path: 'y' } }]),
    });
    expect(t.snapshot).toEqual([]); // 在飞账不落行（直播路在飞期零正文行）
    apply(t, { type: 'message_end', message: toolResultMsg('命中 3 处', { toolCallId: 'tc1' }) });
    expect(t.snapshot).toHaveLength(1);
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

  it('三态判定：details.aborted 结构化标记 → aborted 优先于 isError', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'a', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'b', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('中断', { toolCallId: 'a', details: { aborted: true } }) });
    apply(t, {
      type: 'message_end',
      message: toolResultMsg('中断兼错', { toolCallId: 'b', details: { aborted: true }, isError: true }),
    });
    expect((t.snapshot[0] as { status: string }).status).toBe('aborted');
    expect((t.snapshot[1] as { status: string }).status).toBe('aborted'); // aborted 标记优先
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'c', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('出错了', { toolCallId: 'c', isError: true }) });
    expect((t.snapshot[2] as { status: string }).status).toBe('error');
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
    t.toggleToolCards();
    expect((t.snapshot[0] as { expanded: boolean }).expanded).toBe(true);
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'tc2', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('输出二', { toolCallId: 'tc2' }) });
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
    expect(group.group).toMatchObject({ count: 3 });
    expect(group.group?.commands.map((c) => c.command)).toEqual(['echo a', 'echo b', 'echo c']);
    const lines = renderBlockStyledLines(group, 60);
    // 卡间上空行垫（五件批 C 件 R4）前置——首行空垫、收敛行后移一位；⑤ 全成
    // 组折叠态收敛单行（` • Ran N commands · hint 展开`——无终态符号位、逐条
    // 摘要行退役归展开态）
    expect(lines[0]!.plain).toBe('');
    expect(lines[1]!.plain).toBe(' • Ran 3 commands · ctrl+o 展开');
    expect(lines).toHaveLength(2);
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

  it('非 exec 工具到达即落律不变（read 卡即时落——不受窗机制影响）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: assistantMsg('', [{ id: 'r1', name: 'read', arguments: {} }]) });
    apply(t, { type: 'message_end', message: toolResultMsg('文件内容', { toolCallId: 'r1' }) });
    expect(t.snapshot).toHaveLength(1); // 到达即落（无 agent_end 也在场）
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
