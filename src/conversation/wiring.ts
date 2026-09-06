/**
 * durable 接线（04 §2 装配关系「conversation 组装回调并注入」的落账半边 /
 * 05 §1.1 词汇写点——本件是活体 AgentEvent 流 → durable SessionEvent 的唯一
 * 翻译器）。
 *
 * 两条线永不合流（05 §7 分层不变式）：活体层 10 型内存直推、token delta 不
 * 落日志；本件只翻译**消息级终值与轮边界**——流式 delta（message_update /
 * tool_execution_update）与 run 边界（agent_start/end——run 不是 durable
 * 概念）都不产 durable 事件。
 *
 * durable turn 语义（05 §1.1「一轮（用户输入 → 停止）」——非 loop 轮 1:1）：
 *  - **开**：loop turn_start 到达且当前无打开的 durable turn → 落 turn/start。
 *    工具批延续轮（turn_end=toolUse 不闭 turn）与重试续入轮（遮蔽后重开的
 *    新 turn）都走同一判据——「无打开 turn 才开」；
 *  - **闭**：loop turn_end 终态值落 turn/end——stop/deferred→completed、
 *    error→error、aborted→aborted；toolUse 不闭（轮内继续工具批与下一请求）；
 *    **length 不在此闭**——loop 在 turn_end 事件后才补发截断配对 toolResult，
 *    延迟到 agent_end 安全网收口（配对结果落在 turn 内，恢复配对/遮蔽配对
 *    检查的区间形状才成立）；
 *  - **agent_end 安全网**：agent_end 时 turn 仍开（shouldStopAfterTurn 打断
 *    于工具批后 / length 配对后）→ 按 agent_end 终态映射补 turn/end
 *    （length→max-tokens / completed→completed / aborted→aborted / 其余 error）。
 *
 * 种子/续跑 user/message 落在 turn/start 之前的裁决：message_end 即落账
 * （timeline 与 durable 镜像不变式优先于版面序——延迟缓存到 turn_start 会
 * 制造「已进 timeline 未进日志」的崩溃丢失窗）。fold 对 turn 边界零消费、
 * 恢复配对是全日志扫描、遮蔽起点对齐只认 turn/start 位——三消费方对该序
 * 全部宽容（批 11c 落码裁决注记）。
 *
 * request/header 边界制（05 §1.1「每次 LLM 请求前快照落账」的落码裁决）：
 * 快照只在**请求信封变化点**落——initial（会话首请求）/ resume（timeline
 * 重建后的首请求：重试续入/溢出续入/冷启动续接）/ change（model/thinkingLevel/
 * systemPrompt/工具面相对上一快照变化）。稳态请求不重复快照（systemPrompt
 * 全文每请求一落是纯冗余膨胀；「重建请求取最后一条为基准」在边界制下仍恒
 * 成立——基准永远是最新信封形态）。
 */
import type { AgentEvent } from '../agent/index.js';
import type { LlmTool, ThinkingLevel } from '../contracts/index.js';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';

/** 请求信封快照形（request/header data——noteRequest 的入参） */
export interface RequestEnvelope {
  /** 模型与采样配置快照（请求时点的 active config——prepareNextTurn 换装后取新值） */
  readonly config: { model: string; thinkingLevel?: ThinkingLevel };
  /** 系统提示词全文（装配面原始值——04 §11 快照序钉死：披露段等瞬态层永不入） */
  readonly systemPrompt: string;
  /** 工具 schema 清单（当次请求面） */
  readonly toolSchemas: readonly LlmTool[];
}

/**
 * durable 接线器（驱动私有件——活体事件翻译 + 请求信封快照 + 锚 seq 记账）。
 *
 * 构造时从既有日志初始化三态（turn 开合 / header 在否 / 冷启动续接位）——
 * 会话恢复与新建同路（05 §1.3 恢复 = 重放：接线器状态就是日志状态的折叠）。
 */
export class DurableWiring {
  private readonly session: SessionLog;
  /** durable turn 开合态（agent_end 安全网与 turn_start 判据共用） */
  private turnOpen: boolean;
  /** 日志是否已有 request/header（initial 判据） */
  private hasHeader: boolean;
  /** timeline 重建后的首请求标记（resume 判据——遮蔽重播种/冷启动置位） */
  private rebuildPending: boolean;
  /** 上一信封快照的比对键（change 判据——JSON 序列化同构比对） */
  private lastEnvelopeKey: string | undefined;
  /** 最后一条 assistant/message 的 seq（runTurns 遮蔽区间的起点锚） */
  private lastAssistantSeqValue: number | undefined;

  constructor(session: SessionLog) {
    this.session = session;
    let depth = 0;
    let header = false;
    for (const event of session.events()) {
      if (event.type === 'turn/start') depth += 1;
      else if (event.type === 'turn/end' && depth > 0) depth -= 1;
      else if (event.type === 'request/header') header = true;
    }
    this.turnOpen = depth > 0;
    this.hasHeader = header;
    // 冷启动续接（日志已有 header）：首请求 resume 形——11d resume 续接的先手位
    this.rebuildPending = header;
  }

  /** 最后一条 assistant/message 的锚 seq（重试遮蔽区间起点——驱动消费） */
  get lastAssistantSeq(): number | undefined {
    return this.lastAssistantSeqValue;
  }

  /** timeline 重建标记（重播种/压缩后置位——下一请求 header 落 resume） */
  markRebuildPending(): void {
    this.rebuildPending = true;
  }

  /**
   * inject 通道直落账（04 §4 inject 行 / berry 停摆语义：只追加会话日志/
   * 投影、不触发任何模型调用——「随下次启动带入」的 durable 承载）。durable
   * 写点单归本件（驱动不绕过接线器直写 session）。
   * @returns 落账 seq（inject 收执面）
   */
  appendInjectedUser(message: UserMessage): number {
    const event = this.session.append('user/message', {
      content: message.content,
      ...(message.source !== undefined ? { source: message.source } : {}),
    });
    return event.seq;
  }

  /**
   * 请求信封快照（边界制——transformContext 关口调用，请求发出前落账）。
   * initial / resume / change 三边界各落一条；稳态不落。
   */
  noteRequest(envelope: RequestEnvelope): void {
    const key = JSON.stringify({
      config: envelope.config,
      systemPrompt: envelope.systemPrompt,
      tools: envelope.toolSchemas,
    });
    let reason: 'initial' | 'resume' | 'change';
    if (!this.hasHeader) reason = 'initial';
    else if (this.rebuildPending) reason = 'resume';
    else if (key !== this.lastEnvelopeKey) reason = 'change';
    else return; // 稳态——最后一条基准仍真，不重复快照
    this.session.append('request/header', {
      config: envelope.config,
      systemPrompt: envelope.systemPrompt,
      toolSchemas: envelope.toolSchemas,
      reason,
    });
    this.hasHeader = true;
    this.rebuildPending = false;
    this.lastEnvelopeKey = key;
  }

  /**
   * 活体事件翻译（onEvent 汇的第一腿——外部汇是第二腿，两腿同源同序）。
   * 只认消息级终值与轮边界；其余事件型零翻译（流式细节属活体层）。
   */
  onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'turn_start': {
        // 无打开 durable turn 才开（工具批延续轮/重试续入轮同判据）
        if (!this.turnOpen) {
          this.session.append('turn/start', {});
          this.turnOpen = true;
        }
        return;
      }
      case 'turn_end': {
        if (!this.turnOpen) return; // 防御：配对外的 turn_end（不应出现）
        // toolUse 不闭（轮内继续）；length 延到 agent_end（截断配对结果先落）
        if (event.stopReason === 'toolUse' || event.stopReason === 'length') return;
        this.closeTurn(turnEndReasonOf(event.stopReason));
        return;
      }
      case 'agent_end': {
        // 安全网：turn 仍开（工具批后打断/length 配对后）→ 按终态补收口
        if (!this.turnOpen) return;
        const reason =
          event.stopReason === 'length'
            ? 'max-tokens'
            : event.status === 'completed'
              ? 'completed'
              : event.status === 'aborted'
                ? 'aborted'
                : 'error';
        this.closeTurn(reason);
        return;
      }
      case 'message_end': {
        this.appendMessage(event.message);
        return;
      }
      default:
        // message_start/update、tool_execution_*、agent_start——活体层专属
        return;
    }
  }

  /** 落 turn/end 并闭 turn（turn_end 与 agent_end 安全网共用） */
  private closeTurn(reason: 'completed' | 'aborted' | 'error' | 'max-tokens'): void {
    this.session.append('turn/end', { reason });
    this.turnOpen = false;
  }

  /** 消息级终值翻译（标准三角色各走各的 durable 词；自定义角色暂无 durable 写点） */
  private appendMessage(message: unknown): void {
    const role = (message as { role?: unknown }).role;
    if (role === 'user') {
      const user = message as UserMessage;
      this.session.append('user/message', {
        content: user.content,
        ...(user.source !== undefined ? { source: user.source } : {}),
      });
      return;
    }
    if (role === 'assistant') {
      const assistant = message as AssistantMessage;
      // toolCall 块不内联（05 §1.1——内联+事件双载会在投影回读拼出重复块）；
      // text/thinking 块原样透传（签名位随行——pi-ai 投影形状）
      const content = assistant.content.filter((block) => block.type !== 'toolCall');
      const event = this.session.append('assistant/message', {
        content,
        usage: assistant.usage,
        stopReason: assistant.stopReason,
        ...(assistant.errorMessage !== undefined ? { errorMessage: assistant.errorMessage } : {}),
      });
      this.lastAssistantSeqValue = event.seq;
      // 工具调用分立落账：arguments 回写原始串（审计保真——读侧解析失败兜底 {}）
      for (const block of assistant.content) {
        if (block.type !== 'toolCall') continue;
        this.session.append('tool/call', {
          toolCallId: block.id,
          name: block.name,
          arguments: JSON.stringify(block.arguments),
        });
      }
      return;
    }
    if (role === 'toolResult') {
      const result = message as ToolResultMessage;
      this.session.append('tool/result', {
        toolCallId: result.toolCallId,
        content: result.content,
        ...(result.isError ? { error: true } : {}),
      });
      return;
    }
    // 自定义角色（memory/recall 等）：瞬态注入纪律不落 durable；非瞬态自定义
    // 角色的落账词随 11f/记忆批纵切裁决——当前零写点，静默跳过即唯一诚实行为
  }
}

/** loop 终态值 → durable turn/end reason（TurnEndReason 闭集内归位） */
function turnEndReasonOf(stopReason: string): 'completed' | 'aborted' | 'error' {
  if (stopReason === 'aborted') return 'aborted';
  if (stopReason === 'error') return 'error';
  // stop / deferred——自然收尾（deferred 是延迟装载透传值，v1 不产生但词汇保留）
  return 'completed';
}
