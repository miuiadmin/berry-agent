/**
 * ConversationDriver 本体（02 §2.3 对话本体 / 04 §2-§4 运行时骨架）——
 * loop 的驱动侧：组装回调注入 agent loop、durable 接线、turn 级 auto-retry
 * （04 §3.3）与溢出兜底（04 §3.4）。
 *
 * 批 11c 纵切面：durable 接线 + runTurns 重试循环 + 溢出兜底 + 待发队列的
 * 通道机制面（busy→steer 顶注 / idle→followUp 起跑 / 搁浅件种子续跑）。
 * 取消模型（停摆旗标 + inject 通道）、resume 冷启动续接、backgroundWake
 * 唤醒预算记账归 11d；open 域工具与审批三件归 11e；ctx.agent 服务、多会话
 * 与披露段注入归 11f；host 装配根接线归批 12。
 *
 * 重试编舞（04 §3.3 六条）：
 *  ① 遮蔽 + 落账一次 append——surfaceOp 随 llm/retry(phase=scheduled) 信封；
 *     区间 = [错误 assistant seq, durable 高水位]（伴生组与垫底 turn/end 一并
 *     盖住，防悬空 toolUse 进续入上下文）；
 *  ② 重播种走私有路径（reseedTimeline）——不清 deliverMeta、不复位 header 落账
 *     差分幂等位（header resume 形由 wiring 重建标记承载）；
 *  ③ 重试循环在 runTurns 内部——run 未终结语义上 isRunning 恒真，零新事件型；
 *  ④ 退避 = 指数 + 等比半幅抖动，sleep 挂 abort signal（打断即 aborted 落账）；
 *  ⑤ attempt 计数生命周期 = 单次 runTurns 调用（进入即零、成功返回即弃）；
 *  ⑥ 只 retry transient 桶（classifyError 注入缺席 = 一切 non-retryable 保守）。
 * 溢出兜底（04 §3.4）：遮蔽（llm/retry reason=overflow 复用遮蔽信封）→
 * compactForOverflow → compacted 则重播种续入；名额 1/1 独立分账；注入缺席 =
 * 溢出直接终态（05 §2.3 门三道第三道的装配面兑现）。
 */
import { startRun } from '../agent/index.js';
import { PendingMessageQueue } from '../agent/index.js';
import type { AgentContext, AgentLoopConfig, RunResult } from '../agent/index.js';
import type { AgentEvent } from '../agent/index.js';
import type { AgentMessage, AssistantMessage, LlmContext, Message, UserMessage } from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { abortableSleep, retryDelay } from './backoff.js';
import { DurableWiring } from './wiring.js';
import type { ConversationDriverOptions, SubmitOptions } from './types.js';
import { DEFAULT_RETRY_POLICY } from './types.js';
import { reseedTimeline } from './reseed.js';

/** 活体事件汇双腿转发后的可观察 run 结算（submit 的返回面） */
export type SubmitResult = RunResult;

/**
 * 对话驱动（per-session 实例）。timeline 活数组是投影的镜像缓存（05 §1.3
 * 单一事实源——每次入口先重播种对齐，不另立第二真相）；durable 落账经
 * DurableWiring 翻译，活体事件双腿转发（接线腿 + 外部汇腿）。
 */
export class ConversationDriver {
  readonly session: SessionLog;
  private readonly options: ConversationDriverOptions;
  private readonly wiring: DurableWiring;
  private readonly context: AgentContext;
  /** loop 回调基座（signal 每次入口另注——per-run AbortController 的协作面） */
  private readonly baseConfig: Omit<AgentLoopConfig, 'signal'>;
  /** 当前入口的 active config（transformContext 取请求时点 model——换装后取新值） */
  private activeConfig: AgentLoopConfig | undefined;
  /** 待发队列（三通道暂存——busy steer 顶注 / idle followUp 起跑同池，通道由消费点定） */
  private readonly queue = new PendingMessageQueue();
  /** 在飞 runTurns（busy 判据 + submit 搭车面） */
  private currentRun: Promise<RunResult> | undefined;
  /** 当前 run 的协作中止控制器（abort() 触发——streamFn/工具执行/退避睡眠共挂） */
  private activeController: AbortController | undefined;

  constructor(options: ConversationDriverOptions) {
    this.options = options;
    this.session = options.session;
    this.wiring = new DurableWiring(this.session);
    this.context = {
      ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.tools !== undefined ? { tools: [...options.tools] } : {}),
      messages: this.reseededTimeline(),
    };
    this.baseConfig = {
      streamFn: options.streamFn,
      model: options.model,
      ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      convertToLlm: options.convertToLlm,
      transformContext: this.onTransformContext,
      getSteeringMessages: () => this.queue.drain().map((item) => item.message),
      getFollowUpMessages: () => this.queue.drain().map((item) => item.message),
      onEvent: this.onLiveEvent,
    };
  }

  /**
   * 用户输入入口（04 §4——发送方不指定通道，路由按接收时 run 状态裁定）。
   * busy → 入待发队列（loop 每 turn 顶经 getSteeringMessages 消费——顶注）、
   * 搭在飞 run 的结算 promise；idle → 连同搁浅件一起作种子起跑（followUp 形）。
   * backgroundWake 位与通道归因的正式消费（合批收窄/唤醒预算）归 11d。
   * @returns 触发（或搭车）的 runTurns 结算——RunResult
   */
  submit(
    content: UserMessage['content'],
    options?: SubmitOptions & { source?: UserMessage['source'] },
  ): Promise<SubmitResult> {
    const message: UserMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(options?.source !== undefined ? { source: options.source } : { source: 'user' }),
    };
    if (this.currentRun !== undefined) {
      // busy：入列（steer 顶注——回执面溢出账归 11d 通道收口）+ 搭车在飞结算
      this.queue.enqueue(message, 'steer');
      return this.currentRun;
    }
    // idle：搁浅件（上次 break 时未消费的队列件）在前、新输入在后作种子
    const seeds = [...this.queue.drain().map((item) => item.message), message];
    return this.kick(seeds);
  }

  /** 协作中止：打断在飞 run（signal 透传流与工具）与退避睡眠（phase=aborted 落账） */
  abort(): void {
    this.activeController?.abort();
  }

  /** 是否有在飞 runTurns（busy 判据的读面） */
  get running(): boolean {
    return this.currentRun !== undefined;
  }

  /** 活体事件双腿：durable 接线腿（同步序即落账序）+ 外部汇腿（channels 信封包装归批 12） */
  private readonly onLiveEvent = (event: AgentEvent): void => {
    this.wiring.onEvent(event);
    if (this.options.onEvent !== undefined) void this.options.onEvent(event);
  };

  /** 请求组装最后关口：信封快照（边界制）在此落账——快照取原始 systemPrompt（04 §11 快照序钉死） */
  private readonly onTransformContext = async (context: LlmContext): Promise<LlmContext> => {
    const config = this.activeConfig;
    if (config !== undefined) {
      this.wiring.noteRequest({
        config: {
          model: config.model,
          ...(config.thinkingLevel !== undefined ? { thinkingLevel: config.thinkingLevel } : {}),
        },
        systemPrompt: context.systemPrompt ?? '',
        toolSchemas: context.tools ?? [],
      });
    }
    // 11f 披露段注入位：environmentDisclosure 在此追加（瞬态层——不入快照不落日志）
    return context;
  };

  /**
   * 入口统一 kickoff：登记在飞 promise、结算链第一拍清位（调用方 await 的
   * 就是清理后的 promise——resolved 后 running 必已归 false，无观察窗口）。
   */
  private kick(seeds: readonly AgentMessage[]): Promise<RunResult> {
    const inner = this.runTurns(seeds);
    const settled: Promise<RunResult> = inner.then(
      (result) => {
        if (this.currentRun === settled) this.currentRun = undefined;
        return result;
      },
      (error: unknown) => {
        if (this.currentRun === settled) this.currentRun = undefined;
        throw error;
      },
    );
    this.currentRun = settled;
    return settled;
  }

  /**
   * runTurns 本体（04 §3.3 重试循环宿主）：一次调用 = 「起跑 + 若干次重试续入 +
   * 搁浅件续跑」的完整编舞。attempt 计数生命周期 = 本调用（进入即零）；
   * transient 与 overflow 名额各自独立分账（04 §3.4 1/1）。
   */
  private async runTurns(initialSeeds: readonly AgentMessage[]): Promise<RunResult> {
    const controller = new AbortController();
    this.activeController = controller;
    const retry = this.options.retry ?? DEFAULT_RETRY_POLICY;
    let transientAttempt = 0;
    let overflowAttempt = 0;
    try {
      // 入口重播种：对齐投影（上次失败收场可能已遮蔽尾部——镜像先重建再起跑）
      this.context.messages = this.reseededTimeline();
      let result = await this.enterRun(initialSeeds, controller.signal);
      while (true) {
        if (result.status === 'failed') {
          const assistant = lastErrorAssistant(this.context.messages);
          if (assistant !== undefined) {
            const bucket = this.options.classifyError?.(assistant) ?? 'non-retryable';
            // —— transient 腿（04 §3.3）——
            if (bucket === 'transient' && retry.enabled && transientAttempt < retry.maxRetries) {
              transientAttempt += 1;
              const delayMs = retryDelay(retry, transientAttempt);
              this.occludeFailedTail('transient', transientAttempt, retry.maxRetries, delayMs);
              this.context.messages = this.reseededTimeline();
              if (!(await abortableSleep(delayMs, controller.signal))) {
                // 退避中被取消：phase=aborted 落账；run 终态保持已结算的 failed
                this.session.append('llm/retry', {
                  attempt: transientAttempt,
                  maxAttempts: retry.maxRetries,
                  delayMs,
                  phase: 'aborted',
                });
                break;
              }
              result = await this.enterRun([], controller.signal);
              continue;
            }
            // —— overflow 腿（04 §3.4：1/1 独立分账；注入缺席 = 直接终态零事件）——
            if (bucket === 'overflow' && this.options.compactForOverflow !== undefined && overflowAttempt < 1) {
              overflowAttempt += 1;
              const delayMs = retryDelay(retry, overflowAttempt);
              this.occludeFailedTail('overflow', overflowAttempt, retry.maxRetries, delayMs);
              const outcome = await this.options.compactForOverflow(this.session);
              if (outcome === 'compacted') {
                this.context.messages = this.reseededTimeline();
                result = await this.enterRun([], controller.signal);
                continue;
              }
              // nothing（区间不足压无可压）/ failed（摘要通道失败）——续入必再溢出，诚实报败
              this.appendExhausted('overflow', overflowAttempt, retry.maxRetries, outcome);
              break;
            }
            // —— 达帽 / 不可重试：只在确有重试账面时落 exhausted（quota/auth 零重试零事件）——
            if (bucket === 'transient' && transientAttempt > 0) {
              this.appendExhausted(
                'transient',
                transientAttempt,
                retry.maxRetries,
                'exhausted',
                assistant.errorMessage,
              );
            } else if (bucket === 'overflow' && overflowAttempt > 0) {
              this.appendExhausted('overflow', overflowAttempt, retry.maxRetries, 'exhausted', assistant.errorMessage);
            }
          }
          break;
        }
        // 非 failed 收场：completed 且队列有搁浅件（break 时未消费）→ 作种子续跑；
        // aborted 不续（用户叫停语义——取消模型 11d 正式收口）
        if (result.status !== 'completed' || !this.queue.hasItems()) break;
        const drained = this.queue.drain().map((item) => item.message);
        result = await this.enterRun(drained, controller.signal);
      }
      return result;
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  /** 单次入口 startRun（seeds 空数组 = 纯续入——04 §2 入口两式） */
  private async enterRun(seeds: readonly AgentMessage[], signal: AbortSignal): Promise<RunResult> {
    const config: AgentLoopConfig = { ...this.baseConfig, signal };
    this.activeConfig = config;
    try {
      return await startRun(this.context, config, [...seeds]);
    } finally {
      if (this.activeConfig === config) this.activeConfig = undefined;
    }
  }

  /**
   * 遮蔽失败尾（04 §3.3 条 1：遮蔽 + 落账一次 append）：区间 = [错误 assistant
   * 锚 seq, durable 高水位]，surfaceOp 随 llm/retry(phase=scheduled) 信封携带；
   * sourceEventSeqs 全列区间 seq（溯源完整性校验）。校验红 = 驱动 bug，
   * fail-loud 上抛（正门即执法位——05 §2.4 retry 区间合法规约）。
   */
  private occludeFailedTail(
    reason: 'transient' | 'overflow',
    attempt: number,
    maxAttempts: number,
    delayMs: number,
  ): void {
    const start = this.wiring.lastAssistantSeq;
    const events = this.session.events();
    const end = events.length - 1;
    if (start === undefined || end < start) {
      // 防御位：错误 assistant 锚缺席（落账序漂移）——遮蔽不成不上重试，fail-loud
      throw new Error(
        `retry 遮蔽锚缺席：lastAssistantSeq=${String(start)} 高水位=${end}（wiring 记账与落账序漂移——驱动 bug）`,
      );
    }
    const sourceEventSeqs: number[] = [];
    for (let seq = start; seq <= end; seq += 1) sourceEventSeqs.push(seq);
    this.session.appendWithSurfaceOp(
      'llm/retry',
      {
        attempt,
        maxAttempts,
        delayMs,
        phase: 'scheduled',
        ...(reason !== 'transient' ? { reason } : {}),
      },
      { op: 'replace', start, end },
      sourceEventSeqs,
    );
    // 遮蔽即重建：下一请求 header 落 resume 形（timeline 重建的边界制判据）
    this.wiring.markRebuildPending();
  }

  /** exhausted 落账（达帽放弃——errorMessage 随行；delayMs=0：无实退避发生） */
  private appendExhausted(
    reason: 'transient' | 'overflow',
    attempt: number,
    maxAttempts: number,
    outcome: string,
    errorMessage?: string,
  ): void {
    this.session.append('llm/retry', {
      attempt,
      maxAttempts,
      delayMs: 0,
      phase: 'exhausted',
      errorMessage: errorMessage ?? `retry 放弃：${outcome}`,
      ...(reason !== 'transient' ? { reason } : {}),
    });
  }

  /** 重播种（04 §3.3 条 2 私有路径）：投影 → timeline 活数组（确定性时间源） */
  private reseededTimeline(): Message[] {
    const events = this.session.events();
    return reseedTimeline(this.session.projection(), (seq) => events[seq]?.time ?? 0);
  }
}

/** timeline 尾扫最后一条错误 assistant（runTurns 重试判定的起点消息） */
function lastErrorAssistant(messages: readonly AgentMessage[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    // 先收窄标准消息（CustomMessage.role 是宽 string，静态面可撞标准名）
    if (!isStandardMessage(message) || message.role !== 'assistant') continue;
    return message.stopReason === 'error' ? message : undefined;
  }
  return undefined;
}
