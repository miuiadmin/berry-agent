/**
 * 直播路行集模型与渲染归约（07 §4.1 直播路渲染单源 + 呈现面件 1/9——批 10e）。
 *
 * - **消息事件是唯一渲染源**：assistant 文本/⚙ 工具行随 message_start/update/
 *   end、↳ 工具结果行随 toolResult 的 message_end（本仓消息载荷在 end——事件
 *   形 2026-09-06 冷读注记对齐）；`tool_execution_*` 是执行层锚点正文零渲染
 *   （状态面消费归 TuiBackend）；
 * - **流式两段**（呈现面件 1）：流式期纯文本直推（streaming 槽——message_update
 *   的 partial 快照直换）、message_end 定稿换装（摘槽 → markdown 定稿块 +
 *   ⚙ 行）；
 * - **流式单槽守卫**：repaint 切入 running 条目开的占位槽遇下一条 assistant
 *   message_start 重开时先摘旧槽（占位容器不孤儿滞留正文）；
 * - **帽 = 块数**（一个 Markdown 块一子行——呈现面件 1 滚动帽语义）：行集保留
 *   帽内最近段（内存上限语义；v1 保守值——实测定值回填挂主屏实装批校准）；
 * - **非聚焦摘要行**（呈现面件 9）：瞬时追加行——agent_start ⧗ / agent_end
 *   按终态 ✓/✖/⏹ 各追加一行、不进行集（不占帽、repaint 不重建），行首段 =
 *   档位符号 + 会话短 id、失败与中止显式分档不伪装成功。
 * - **渲染行提取单源**（批 10f-4）：renderBlockStyledLines 块 → 带样式行集
 *   （管线本体）——主屏 MainScreen 直写（renderBlockLines 的 ANSI 序列化形）
 *   与件 8 回看器 cell 写出（StyledLine 直消费）共用同一管线（07 件 8「数据源
 *   = 复用主屏同一渲染管线——同输入同行集、零第二渲染器」条款）；恒一致的
 *   是管线非范围（主屏按帽 / 回看器全量——帽经 LiveTranscriptOptions 参数化）。
 */
import type { AgentEvent } from '../../../agent/index.js';
import { isStandardMessage, type AgentMessage } from '../../../contracts/index.js';
import { CellGrid, truncateToWidth, wrapText } from '../../engine/index.js';
import { gridRowToStyled, styledLineToAnsi, type StyledLine } from './ansi-rows.js';
import { MarkdownDoc } from '../markdown/markdown.js';
import type { SessionEnvelope } from '../../types.js';

export type { StyleRun, StyledLine } from './ansi-rows.js';

/**
 * 主屏滚动帽定值（07 §4.1「屏幕模型双形态」：帽值随主屏实装批实测定值回填、
 * 规范不预写数字。批 10f-3 性能回归锁建锁：四指标 wall-time 面不覆盖块帽
 * 〔内存上限语义〕——v1 维持保守值 500 块，实机校准注记留批 12 host 装配）。
 * 批 10f-4 参数化：本值降级为缺省帽（主屏调用面零变化）；回看器全量档经
 * LiveTranscriptOptions.blockCap 传 Number.POSITIVE_INFINITY（全量 durable
 * 正文不被截——perf-lock 全量档回归锁）。
 */
export const TRANSCRIPT_BLOCK_CAP = 500;

/** ⚙ 行 / ↳ 行的参数与结果简述显示宽帽（列） */
const BRIEF_WIDTH = 40;

/**
 * 行块（帽单位——blockCount 即帽额度）。streaming 槽是行集末块的瞬时态
 * （定稿摘槽换装）；其余为 durable 块（repaint 投影重建的同构物）。
 */
export type TranscriptBlock =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'markdown'; readonly doc: MarkdownDoc }
  | { readonly kind: 'tool-call'; readonly name: string; readonly brief: string }
  | { readonly kind: 'tool-result'; readonly brief: string }
  | { readonly kind: 'streaming'; readonly text: string };

/** 非聚焦摘要行（瞬时——呈现侧直写后即交 scrollback，不存账） */
export interface SummaryLine {
  readonly symbol: '⧗' | '✓' | '✖' | '⏹';
  readonly shortId: string;
  readonly label: string;
}

/** 会话短 id（呈现层自截——散列映射色板键同源） */
export function shortIdOf(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** dim 样式（简行块的整行样式——SGR 2；呈现侧带样式形同值） */
const DIM_STYLE: Readonly<{ dim: true }> = Object.freeze({ dim: true });

/**
 * 块 → 带样式行集（管线单源本体——批 10f-4 件 8 提取）。
 *
 * 主屏 MainScreen 直写（经 renderBlockLines 的 ANSI 序列化形）与件 8 回看器
 * cell 写出（StyledLine 直消费）共用本函数：同输入同行集、零第二渲染器
 * （07 件 8 数据源条款）；markdown 块经 CellGrid 渲染（gridRowToStyled 提段）、
 * user 块折行续挂对齐（宽算术单源走 wrapText）、简行块整行 dim、streaming
 * 纯文本零样式、markdown 无内容行保空行（主屏空行直写形字节不变）。
 */
export function renderBlockStyledLines(block: TranscriptBlock, columns: number): StyledLine[] {
  switch (block.kind) {
    case 'markdown': {
      const grid = new CellGrid(columns, block.doc.measure(columns));
      block.doc.render(grid, { row: 0, col: 0, width: columns, height: grid.rows });
      const lines: StyledLine[] = [];
      for (let r = 0; r < grid.rows; r++) {
        lines.push(gridRowToStyled(grid, r) ?? { plain: '', runs: [] }); // 无内容行保空行
      }
      return lines;
    }
    case 'user': {
      // '> ' 前缀 + 折行续挂对齐（首行前缀、续行两空格缩进）
      const lines = wrapText(block.text, columns - 2);
      return lines.map((line, i) => ({ plain: (i === 0 ? '> ' : '  ') + line, runs: [] }));
    }
    case 'tool-call':
      return [dimStyledLine(` ⚙ ${block.name}${block.brief}`)];
    case 'tool-result':
      return [dimStyledLine(` ↳ ${block.brief}`)];
    case 'streaming':
      // 流式槽纯文本直推（性能：不走网格不走样式）；空文本零行
      return block.text === '' ? [] : wrapText(block.text, columns).map((text) => ({ plain: text, runs: [] }));
  }
}

/** 简行块的带样式形（整行 dim——与 ANSI 形 dim() 字节同源） */
function dimStyledLine(text: string): StyledLine {
  return { plain: text, runs: [{ start: 0, end: text.length, style: DIM_STYLE }] };
}

/**
 * 块 → 行序列化（渲染管线单源——批 10f-4 提取为可复用函数；主屏直写消费形）。
 * 带样式行本体经 styledLineToAnsi 导出 ANSI 串——与回看器 cell 写出形零第二
 * 渲染器（renderBlockStyledLines 注）。
 */
export function renderBlockLines(block: TranscriptBlock, columns: number): string[] {
  return renderBlockStyledLines(block, columns).map(styledLineToAnsi);
}

/** 消息文本块拼接（user/assistant/toolResult 通用；自定义角色与无文本块返 ''） */
function textOf(message: AgentMessage): string {
  // isStandardMessage 守卫先行——CustomMessage role: string 非字面判别位，
  // 相等/开关收窄均排不掉，经守卫归一到标准三角色（自定义角色呈现侧宽容跳过）
  if (!isStandardMessage(message)) return '';
  if (typeof message.content === 'string') return message.content; // user 纯文本形
  return joinTextBlocks(message.content);
}

/** 文本块抽取拼接（图文/思考/工具块族里 text 块的串接——无文本块返 ''） */
function joinTextBlocks(blocks: readonly { type: string; text?: string }[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

/** 工具简述：参数键名序列（`path, content` 形——呈现面克制不倒参数值） */
function argsBrief(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  return keys.length > 0 ? `(${keys.join(', ')})` : '';
}

/** 行集选项（批 10f-4 帽参数化——主屏缺省帽之外的自定义档） */
export interface LiveTranscriptOptions {
  /**
   * 块帽（缺省 TRANSCRIPT_BLOCK_CAP = 500 主屏帽——主屏调用面零变化）。
   * 件 8 回看器全量档传 Number.POSITIVE_INFINITY（全量 durable 正文不截）。
   */
  readonly blockCap?: number;
}

/**
 * 直播路行集（单聚焦会话一账——非聚焦会话不建账，摘要行直返）。
 * 纯状态件：无 IO、无时钟——applyEvent 同步归约，呈现编舞归 MainScreen。
 */
export class LiveTranscript {
  /** 块帽（构造定着——主屏 500 / 回看器全量 Infinity） */
  private readonly blockCap: number;
  private blocks: TranscriptBlock[] = [];
  /** 流式槽在场位（true = 末块是 streaming——message_start/message_end 配对守卫） */
  private slotOpen = false;

  constructor(options: LiveTranscriptOptions = {}) {
    this.blockCap = options.blockCap ?? TRANSCRIPT_BLOCK_CAP;
  }

  /** 行集快照（只读——呈现侧消费） */
  get snapshot(): readonly TranscriptBlock[] {
    return this.blocks;
  }

  /** 块计数（帽额度观测面） */
  get blockCount(): number {
    return this.blocks.length;
  }

  /**
   * 直播路归约：活体信封 → 行集更新 + 瞬时行（非聚焦摘要行直返、聚焦返 null）。
   * 非聚焦会话的 durable 事件全忽略（行集是聚焦会话的账——投影重建走 loadProjection）。
   */
  applyEvent(env: SessionEnvelope, focused: boolean): SummaryLine | null {
    const { event } = env;
    if (!focused) return this.summaryFor(event, env.sessionId);
    this.applyFocused(event);
    return null;
  }

  /** 投影重建（repaint 路——清账按投影重拉帽内段；直播/repaint 行集同构） */
  loadProjection(messages: readonly AgentMessage[]): void {
    const rebuilt: TranscriptBlock[] = [];
    for (const message of messages) {
      switch (message.role) {
        case 'user':
          rebuilt.push({ kind: 'user', text: textOf(message) });
          break;
        case 'assistant':
          this.appendAssistantFinal(rebuilt, message);
          break;
        case 'toolResult':
          rebuilt.push({ kind: 'tool-result', brief: resultBrief(message) });
          break;
        // 自定义角色：content unknown 宽容跳过（不猜形状——件 1 自定义渲染器优先级语义）
      }
    }
    this.blocks = rebuilt;
    this.slotOpen = false; // 投影是 durable 快照——无在飞槽
    this.trimToCap();
  }

  /** 非聚焦摘要行分档（agent_start/end 之外的事件零产出） */
  private summaryFor(event: AgentEvent, sessionId: string): SummaryLine | null {
    const shortId = shortIdOf(sessionId);
    switch (event.type) {
      case 'agent_start':
        return { symbol: '⧗', shortId, label: '后台工作中' };
      case 'agent_end':
        if (event.status === 'completed') return { symbol: '✓', shortId, label: '后台完成' };
        if (event.status === 'failed') return { symbol: '✖', shortId, label: '后台失败' };
        return { symbol: '⏹', shortId, label: '后台已中止' }; // aborted——失败与中止显式分档
      default:
        return null; // 消息族/turn 族：非聚焦零正文行（摘要行只由 run 生命周期驱动）
    }
  }

  /** 聚焦归约：消息事件族分派（唯一渲染源律——tool_execution_* 正文零渲染） */
  private applyFocused(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start':
        if (event.role !== 'assistant') return;
        // 流式单槽守卫：重开先摘旧槽（占位容器不孤儿滞留）
        if (this.slotOpen) this.blocks.pop();
        this.blocks.push({ kind: 'streaming', text: '' });
        this.slotOpen = true;
        break;
      case 'message_update':
        if (event.role !== 'assistant' || !this.slotOpen) return;
        // partial 是完整快照——直换非追加（性能：纯文本直推）
        this.blocks[this.blocks.length - 1] = { kind: 'streaming', text: textOf(event.partial) };
        break;
      case 'message_end': {
        // 判别位在载荷 message.role（事件自身不带 role 字段——轻载荷事件形）
        const { message } = event;
        if (message.role === 'assistant') {
          if (this.slotOpen) {
            this.blocks.pop();
            this.slotOpen = false;
          }
          this.appendAssistantFinal(this.blocks, message);
        } else if (message.role === 'user') {
          this.blocks.push({ kind: 'user', text: textOf(message) });
        } else if (message.role === 'toolResult') {
          this.blocks.push({ kind: 'tool-result', brief: resultBrief(message) });
        }
        this.trimToCap();
        break;
      }
      default:
        break; // turn_*/tool_execution_*/agent_* 正文零渲染（状态面消费）
    }
  }

  /** assistant 定稿展开：文本块非空 → markdown 块；每 toolCall 块 → ⚙ 行块 */
  private appendAssistantFinal(target: TranscriptBlock[], message: AgentMessage): void {
    // 守卫 + 判别收窄到 AssistantMessage（CustomMessage 判别位是 string——见 textOf 注）
    if (!isStandardMessage(message) || message.role !== 'assistant') return;
    const text = textOf(message);
    if (text !== '') target.push({ kind: 'markdown', doc: MarkdownDoc.of(text) });
    for (const block of message.content) {
      if (block.type === 'toolCall') {
        target.push({ kind: 'tool-call', name: block.name, brief: argsBrief(block.arguments) });
      }
    }
  }
  /** 帽卸载：超帽从头卸（保留帽内最近段——滚出视口交 scrollback 后内存上限语义；全量档 Infinity 恒不触发） */
  private trimToCap(): void {
    if (this.blocks.length > this.blockCap) {
      this.blocks = this.blocks.slice(this.blocks.length - this.blockCap);
    }
  }
}

/** ↳ 工具结果简述：文本块首行按显示宽截断（无文本块返占位） */
function resultBrief(message: AgentMessage): string {
  const text = textOf(message);
  if (text === '') return '(无文本输出)';
  const firstLine = text.split('\n').find((line) => line.trim() !== '') ?? '';
  return truncateToWidth(firstLine.trim(), BRIEF_WIDTH);
}
