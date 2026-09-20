/**
 * LiveTranscript 渲染归约测试（批 10e-1——纯逻辑零 IO）。
 *
 * 覆盖：流式两段（开槽/直换/定稿换装）、流式单槽守卫、唯一渲染源律
 * （tool_execution_* 正文零渲染）、非聚焦摘要行分档、投影重建、帽卸载。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor } from '../../engine/index.js';
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage, AssistantMessage } from '../../../contracts/index.js';
import { LIGHT_PALETTE, resolveTheme, DEFAULT_THEME } from '../theme/index.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import { StreamingMarkdown } from '../markdown/streaming.js';
import {
  LiveTranscript,
  renderBlockLines,
  renderBlockStyledLines,
  shortIdOf,
  stableSlotLineCount,
  TRANSCRIPT_BLOCK_CAP,
  type SummaryLine,
  type TranscriptBlock,
} from './transcript.js';
import { styledLineToAnsi } from './ansi-rows.js';

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
  theme: DEFAULT_THEME,
  toggleHint: 'ctrl+t',
});

/* ---------------- 消息工厂 ---------------- */

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function userMsg(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 1 };
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

function apply(t: LiveTranscript, event: AgentEvent, focused = true): SummaryLine | null {
  return t.applyEvent({ sessionId: 'sess-aaaaaaaaaa', event }, focused);
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
    expect(renderBlockLines(slot, 20)[0]).toContain('你好，世界');
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
    // 错误块在场（✖ 前缀 + error 语义色整行）；text 块照常渲染、错误块追加于其后
    const err = blocks.find((b) => b.kind === 'error');
    expect(err).toBeDefined();
    const lines = renderBlockStyledLines(err!, 40);
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
    // 降档后渲染 = 纯文本折行（零 ANSI 网格管线）
    expect(renderBlockLines(slot, 40)).toEqual(['看 `npm` 命令']);
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
    const styled = renderBlockStyledLines({ kind: 'markdown', doc }, 40);
    const codeRun = styled[0]!.runs.find((r) => r.style.fg !== undefined);
    expect(codeRun?.style.fg).toBe(ansiColor(2)); // light 板 #116329 @16 → 绿 2（dark 板为亮灰 7——双板可辨）
  });

  it('user / toolResult 的 message_end 追加对应块', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_end', message: userMsg('帮我看下') });
    apply(t, { type: 'message_end', message: toolResultMsg('第 1 行输出\n第 2 行') });
    expect(t.snapshot).toEqual([
      { kind: 'user', text: '帮我看下' },
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

/* ---------------- 非聚焦摘要行 ---------------- */

describe('LiveTranscript 非聚焦摘要行', () => {
  it('agent_start ⧗ + 短 id + 后台工作中', () => {
    const t = new LiveTranscript();
    const line = apply(t, { type: 'agent_start' }, false);
    expect(line).toEqual({ symbol: '⧗', shortId: 'sess-aaa', label: '后台工作中' });
  });

  it('agent_end 三档分立：完成 ✓ / 失败 ✖ / 中止 ⏹', () => {
    const t = new LiveTranscript();
    expect(apply(t, { type: 'agent_end', status: 'completed' }, false)?.symbol).toBe('✓');
    expect(apply(t, { type: 'agent_end', status: 'failed' }, false)?.symbol).toBe('✖');
    expect(apply(t, { type: 'agent_end', status: 'aborted' }, false)?.symbol).toBe('⏹');
  });

  it('非聚焦消息族零产出且不建账', () => {
    const t = new LiveTranscript();
    expect(apply(t, { type: 'message_end', message: userMsg('后台会话') }, false)).toBeNull();
    expect(t.snapshot).toHaveLength(0);
  });

  it('shortIdOf 取前八位', () => {
    expect(shortIdOf('abcdefgh12345678')).toBe('abcdefgh');
    expect(shortIdOf('短')).toBe('短');
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
      brief: '(pattern, path)',
      status: 'success',
      diff: false,
    });
  });

  it('loadProjection 自定义角色宽容跳过', () => {
    const t = new LiveTranscript();
    t.loadProjection([{ role: 'memory/recall', content: { q: 1 }, timestamp: 1 }, userMsg('问题')]);
    expect(t.snapshot).toEqual([{ kind: 'user', text: '问题' }]);
  });

  it('loadProjection 清流式槽位（投影是 durable 快照）', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    t.loadProjection([userMsg('重建')]);
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('孤儿') });
    expect(t.snapshot).toEqual([{ kind: 'user', text: '重建' }]); // slotOpen 已清——update 零效果
  });

  it('帽卸载：超帽从头卸、保留帽内最近段', () => {
    const t = new LiveTranscript();
    const messages: AgentMessage[] = [];
    for (let i = 0; i < TRANSCRIPT_BLOCK_CAP + 5; i++) messages.push(userMsg(`消息 ${i}`));
    t.loadProjection(messages);
    expect(t.blockCount).toBe(TRANSCRIPT_BLOCK_CAP);
    expect(t.snapshot[0]).toEqual({ kind: 'user', text: '消息 5' }); // 前 5 条卸载
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
    expect(t.snapshot[0]).toEqual({ kind: 'user', text: '消息 0' }); // 首条仍在场
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

/* ---------------- 渲染行提取（批 10f-4——管线单源 renderBlockLines） ---------------- */

describe('renderBlockLines 渲染行提取（主屏直写与件 8 回看器共用同一管线）', () => {
  it('user 块："> " 前缀首行 + 折行续挂两空格缩进', () => {
    const lines = renderBlockLines({ kind: 'user', text: '帮我看下' }, 20); // 宽裕单行
    expect(lines).toEqual(['> 帮我看下']);
  });

  it('user 块折行：超宽文本续行缩进对齐（宽算术单源 wrapText）', () => {
    const lines = renderBlockLines({ kind: 'user', text: 'abcdefghij' }, 6); // 内容宽帽 6-2=4——'abcd' + 'efgh' + 'ij' 三行
    expect(lines).toEqual(['> abcd', '  efgh', '  ij']);
  });

  it('tool-call / tool-result 块：单行 dim 样式', () => {
    const toolCall = renderBlockLines({ kind: 'tool-call', name: 'read', brief: '(path)' }, 40);
    expect(toolCall).toHaveLength(1);
    expect(toolCall[0]).toBe('\x1b[2m ⚙ read(path)\x1b[0m');
    const toolResult = renderBlockLines({ kind: 'tool-result', brief: '命中' }, 40);
    expect(toolResult[0]).toBe('\x1b[2m ↳ 命中\x1b[0m');
  });

  it('markdown 块：经 CellGrid 渲染（H1 bold 行）', () => {
    const lines = renderBlockLines({ kind: 'markdown', doc: MarkdownDoc.of('# 标题') }, 20);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('\x1b[1m标题\x1b[0m'); // H1 bold
  });

  it('streaming 块降档形：空文本零行、有文本按宽折行（doc = null 纯文本直推不走网格）', () => {
    expect(renderBlockLines(slotOf(1, '', null), 20)).toEqual([]);
    const lines = renderBlockLines(slotOf(1, 'abcdefgh', null), 4);
    expect(lines).toEqual(['abcd', 'efgh']);
  });

  it('streaming 块直推档：doc 经网格管线、与定稿 markdown 块同行集（同管线律零第二渲染器）', () => {
    const text = '# 标题\n\n正文段';
    const doc = new StreamingMarkdown();
    doc.update(text);
    const streaming = renderBlockStyledLines(slotOf(1, text, doc), 20);
    const final = renderBlockStyledLines({ kind: 'markdown', doc: MarkdownDoc.of(text) }, 20);
    expect(streaming).toEqual(final); // 同文同宽同主题 → 同行集（main-screen 冻结跳行的定位前提）
    expect(streaming.length).toBeGreaterThanOrEqual(3);
    expect(streaming[0]!.plain).toContain('标题');
    expect(streaming[0]!.runs.some((r) => r.style.bold === true)).toBe(true); // H1 bold 位
  });
});

/* ---------------- 带样式行提取（批 10f-4——件 8 回看器数据源同管线） ---------------- */

describe('renderBlockStyledLines 带样式行（零第二渲染器——与主屏直写同管线）', () => {
  it('user 块：行集同行集、零样式段（裸文本）', () => {
    const styled = renderBlockStyledLines({ kind: 'user', text: '帮我看下' }, 20);
    expect(styled).toEqual([{ plain: '> 帮我看下', runs: [] }]);
  });

  it('tool-call / tool-result 块：整行 dim 单段（plain 无转义零样式混入）', () => {
    const toolCall = renderBlockStyledLines({ kind: 'tool-call', name: 'read', brief: '(path)' }, 40);
    expect(toolCall).toEqual([
      { plain: ' ⚙ read(path)', runs: [{ start: 0, end: ' ⚙ read(path)'.length, style: { dim: true } }] },
    ]);
    const toolResult = renderBlockStyledLines({ kind: 'tool-result', brief: '命中' }, 40);
    expect(toolResult[0]!.plain).toBe(' ↳ 命中');
    expect(toolResult[0]!.runs).toEqual([{ start: 0, end: ' ↳ 命中'.length, style: { dim: true } }]);
  });

  it('markdown 块：样式段提取（H1 bold 段在、无样式段不在）+ 空行保空行', () => {
    const doc = MarkdownDoc.of('# 标题\n\n正文');
    const styled = renderBlockStyledLines({ kind: 'markdown', doc }, 20);
    expect(styled.length).toBeGreaterThanOrEqual(3);
    // H1 行：bold 段恰覆「标题」二字的 plain 子串（前后缀裸文本）
    const h1 = styled[0]!;
    expect(h1.plain).toContain('标题');
    const boldRun = h1.runs.find((r) => r.style.bold === true);
    expect(boldRun).toBeDefined();
    expect(h1.plain.slice(boldRun!.start, boldRun!.end)).toBe('标题');
    // markdown 无内容行保空行（主屏空行直写形字节不变——回看器同形）
    expect(styled.some((line) => line.plain === '' && line.runs.length === 0)).toBe(true);
  });

  it('字节恒等锁：renderBlockLines ≡ styled 形经 styledLineToAnsi（零第二渲染器）', () => {
    const streamingDoc = new StreamingMarkdown(); // 直推档也入锁——两档同管线律
    streamingDoc.update('流式**粗体**与 `code`');
    const blocks: Parameters<typeof renderBlockStyledLines>[0][] = [
      { kind: 'user', text: '你好世界'.repeat(8) }, // 折行
      { kind: 'markdown', doc: MarkdownDoc.of('# 标题\n\n- 甲\n- 乙\n\n`code` 与 **粗**') },
      { kind: 'tool-call', name: 'grep', brief: '(pattern, path)' },
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
    // 槽渲染 = 思考标签行前缀 + doc 正文行（拼接序与定稿块序一致）
    const lines = renderBlockStyledLines(slot, 60);
    expect(lines[0]!.plain).toContain('✻ 思考');
    expect(lines[0]!.plain).toContain('（ctrl+t 展开）'); // 缺省折叠档 + 键名提示
    expect(lines.some((l) => l.plain.includes('答案正文'))).toBe(true);
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

  it('stableSlotLineCount：settled 前思考行不计（0 面）、settled 后 = 折叠标签 1 行 + doc 稳定面', () => {
    const t = new LiveTranscript();
    apply(t, { type: 'message_start', role: 'assistant' });
    apply(t, { type: 'message_update', role: 'assistant', partial: assistantMsg('正文一行', [], '想法') });
    const slot = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'streaming' }>;
    const docRows = slot.doc!.stableLineCount(60);
    expect(stableSlotLineCount(slot, 60)).toBe(1 + docRows); // 折叠档标签单行 + doc 稳定行
    // 翻 settled=false（同数据异判据）——不稳头行止冻：冻结面前缀连续，doc 稳定面不越位
    const unsettled: Extract<TranscriptBlock, { kind: 'streaming' }> = { ...slot, thinkingSettled: false };
    expect(stableSlotLineCount(unsettled, 60)).toBe(0);
    // 降档形（doc = null）：settled 思考行独撑冻结面；零思考零 doc = 空面
    expect(stableSlotLineCount({ ...slot, doc: null }, 60)).toBe(1);
    expect(stableSlotLineCount({ ...slot, thinking: '', doc: null }, 60)).toBe(0);
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
      brief: '(pattern, path)',
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
    expect(t.snapshot).toEqual([{ kind: 'tool-call', name: 'read', brief: '(path)', toolCallId: 'tc1' }]);
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
    const styled = renderBlockStyledLines({ kind: 'tool-call', name: 'n'.repeat(100), brief: '' }, 80);
    expect(styled).toHaveLength(1);
    // ' ⚙ ' 3 列 + 77 n = 80 列恰满；游程收尾同步
    expect(styled[0]!.plain).toBe(' ⚙ ' + 'n'.repeat(77));
    expect(styled[0]!.runs).toEqual([{ start: 0, end: 80, style: { dim: true } }]);
  });

  it('F4：tool-result ↳ 简行同律受帽', () => {
    const styled = renderBlockStyledLines({ kind: 'tool-result', brief: 'b'.repeat(100) }, 40);
    expect(styled[0]!.plain).toBe(' ↳ ' + 'b'.repeat(37));
  });

  it('F4：帽为显示宽非 UTF-16 长（宽字整字丢弃不产半字）', () => {
    // 38 列已满后 '中'（2 列）在 cols=39 放不下整字——丢弃，'中' 不上屏
    const styled = renderBlockStyledLines({ kind: 'tool-result', brief: 'a'.repeat(36) + '中' + 'b'.repeat(10) }, 39);
    expect(styled[0]!.plain).toBe(' ↳ ' + 'a'.repeat(36));
  });

  it('F5：error 块行数帽——首 4 行 + 截断标记行（修前全量裸上屏）', () => {
    const text = Array.from({ length: 20 }, (_, i) => `L${String(i).padStart(2, '0')}`).join('\n');
    const styled = renderBlockStyledLines({ kind: 'error', text, theme: DEFAULT_THEME }, 40);
    expect(styled).toHaveLength(5);
    expect(styled[0]!.plain).toBe('✖ L00');
    expect(styled[3]!.plain).toBe('  L03');
    // 标记行：两空格缩进 + 省略提示（20 - 4 = 16 行省略）、error 前景游程
    expect(styled[4]!.plain).toBe('  ⋯（错误详情已省 16 行）');
    expect(styled[4]!.runs).toEqual([{ start: 0, end: styled[4]!.plain.length, style: { fg: DEFAULT_THEME.error } }]);
  });

  it('F5：error 块行数在帽内——全量原样（无标记行）', () => {
    const styled = renderBlockStyledLines({ kind: 'error', text: '网关 403：凭证失效', theme: DEFAULT_THEME }, 40);
    expect(styled).toHaveLength(1);
    expect(styled[0]!.plain).toBe('✖ 网关 403：凭证失效');
  });

  it('F6：argsBrief 参数简述受 BRIEF_WIDTH=40 帽（修前从未接线——超长键名直写）', () => {
    const t = new LiveTranscript();
    t.loadProjection([assistantMsg('', [{ id: 'tc1', name: 'read', arguments: { ['k'.repeat(60)]: 1 } }])]);
    const block = t.snapshot[0] as Extract<TranscriptBlock, { kind: 'tool-call' }>;
    expect(block.brief).toBe('(' + 'k'.repeat(39));
  });
});
