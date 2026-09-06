/**
 * ConversationDriver 本体（02 §2.3 对话本体 / 04 §2-§4 运行时骨架）——
 * loop 的驱动侧：组装回调注入 agent loop、durable 接线、turn 级 auto-retry
 * （04 §3.3）与溢出兜底（04 §3.4）。
 *
 * 批 11c 纵切面：durable 接线 + runTurns 重试循环 + 溢出兜底 + 待发队列的
 * 通道机制面（busy→steer 顶注 / idle→followUp 起跑 / 搁浅件种子续跑）。
 * 批 11d 纵切面：三通道路由正式收口（inject 停摆落账不唤醒 / busy steer
 * 合批 / 唤醒预算批消费位记账）+ 取消模型（dismantled 停摆旗标 + per-run
 * 控制器——abort()）+ resume 冷启动续接（构造折叠 + 重播种 + header resume）。
 * open 域工具与审批三件归 11e；ctx.agent 服务、多会话与披露段注入归 11f；
 * host 装配根接线归批 12。
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
import type { PendingItem } from '../agent/index.js';
import type {
  AgentMessage,
  AgentTool,
  AssistantMessage,
  LlmContext,
  Message,
  UserMessage,
} from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { abortableSleep, retryDelay } from './backoff.js';
import { DurableWiring } from './wiring.js';
import type { ConversationDriverOptions, InjectedReceipt, SubmitOptions, WakeRefusedReceipt } from './types.js';
import { DEFAULT_RETRY_POLICY, MAX_CONSECUTIVE_WAKES } from './types.js';
import { reseedTimeline } from './reseed.js';

/**
 * submit 的返回面：run 结算（RunResult 终态三值）或通道收执两形——
 * injected（停摆期落账不唤醒）/ wake-refused（唤醒预算拒收）。
 */
export type SubmitResult = RunResult | InjectedReceipt | WakeRefusedReceipt;

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
  /** 停摆旗标（02 §2.3 取消模型——会话级标记非 run 状态机成员；置位后一切投递转 inject） */
  private dismantledValue = false;
  /** 连续后台唤醒计数（04 §4 唤醒预算——批消费位记账；前台 kick 复位） */
  private wakeStreak = 0;
  /** 全量工具面快照（工具面切换的还原基准——backgroundTools 的对照面） */
  private readonly fullTools: AgentTool[] | undefined;
  /** 警示面（缺省 stderr——护栏不静默） */
  private readonly warnFace: (message: string) => void;

  constructor(options: ConversationDriverOptions) {
    this.options = options;
    this.session = options.session;
    this.wiring = new DurableWiring(this.session);
    this.fullTools = options.tools !== undefined ? [...options.tools] : undefined;
    this.warnFace = options.warn ?? ((message) => console.error(message));
    this.context = {
      ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      ...(this.fullTools !== undefined ? { tools: [...this.fullTools] } : {}),
      messages: this.reseededTimeline(),
    };
    this.baseConfig = {
      streamFn: options.streamFn,
      model: options.model,
      ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      convertToLlm: options.convertToLlm,
      transformContext: this.onTransformContext,
      getSteeringMessages: this.consumeInRun,
      getFollowUpMessages: this.consumeInRun,
      onEvent: this.onLiveEvent,
    };
  }

  /**
   * 用户输入入口（04 §4 三通道路由单源——发送方只声明 backgroundWake，
   * 通道按接收时的驱动/会话状态裁定）：
   *  - dismantled 停摆 → **inject**：只落 durable user/message 不唤醒（随下次
   *    启动 timeline 重播种带入——队列内存态崩即丢，durable 落账是唯一诚实承载）；
   *  - busy → **steer**：入待发队列（唤醒位随条目透传）+ 搭在飞 run 结算；
   *  - idle → **followUp**：搁浅件合批消费 + 新输入作种子起跑。
   * 唤醒预算（04 §4 maxConsecutiveWakes=3 批消费位记账）：超帽唤醒件拒收
   * （receipt + warn，不静默）；前台输入起跑即复位计数。
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
    // inject 通道：停摆期只落账（durable 写点单归接线器——不绕过直写 session）
    if (this.dismantledValue) {
      return Promise.resolve({ status: 'injected', seq: this.wiring.appendInjectedUser(message) });
    }
    if (this.currentRun !== undefined) {
      // busy：入列（steer 顶注——唤醒位随条目透传，消费位合批/预算执法）+ 搭车
      this.queue.enqueue(
        message,
        'steer',
        options?.backgroundWake !== undefined ? { backgroundWake: options.backgroundWake } : undefined,
      );
      return this.currentRun;
    }
    // idle：搁浅件消费（超帽唤醒件在 consumeBatch 内拒收过滤）+ 新输入
    const consumed = this.consumeBatch();
    const newWake = options?.backgroundWake === true;
    if (newWake && this.wakeStreak >= MAX_CONSECUTIVE_WAKES) {
      // 新唤醒件拒收：无搁浅余件 → 拒收回执；有搁浅前台件 → 照常起前台 run
      this.warnWakeRefused();
      if (consumed.items.length === 0) return Promise.resolve({ status: 'wake-refused', reason: 'wake-budget' });
      return this.kick(
        consumed.items.map((item) => item.message),
        false,
      );
    }
    const seeds = [...consumed.items.map((item) => item.message), message];
    return this.kick(seeds, newWake || consumed.wakeTriggered);
  }

  /**
   * 拆解收尾（02 §2.3 取消模型——停摆旗标置位）：打断在飞 run（per-run 控制器
   * 协作面）+ 清待发队列（内存态不承诺跨进程——durable 真相只有已进 timeline
   * 的消息）+ 置位停摆。此后一切投递转 inject（04 §4 第三通道）。
   */
  dismantle(): void {
    this.dismantledValue = true;
    this.abort();
    this.queue.clear();
  }

  /** 停摆旗标读面（inject 路由判据——会话级标记非 run 状态机成员） */
  get dismantled(): boolean {
    return this.dismantledValue;
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
   * run 存续期统一取件（loop 两取件点共用——steer 顶注 getSteeringMessages /
   * 自然停候选 followUp getFollowUpMessages）：消费位合批与唤醒预算执法都在
   * 此。唤醒批 → streak+1 + 收窄工具面；前台批保持现面（run 内纯前台批不
   * 复位 streak——复位只认前台 idle 起跑，用户在场才复位预算）。
   */
  private readonly consumeInRun = (): AgentMessage[] => {
    const { items, wakeTriggered } = this.consumeBatch();
    if (wakeTriggered) {
      this.wakeStreak += 1;
      this.applyToolFace(true);
    }
    return items.map((item) => item.message);
  };

  /**
   * 入口统一 kickoff（含唤醒预算记账与工具面定形）：登记在飞 promise、结算链
   * 第一拍清位（调用方 await 的就是清理后的 promise——resolved 后 running 必已
   * 归 false，无观察窗口）。streak 记账（04 §4 批消费位）：唤醒起跑 +1、前台
   * 起跑归零（用户在场即复位预算）；工具面随之定形——唤醒 run 收窄、前台全量。
   */
  private kick(seeds: readonly AgentMessage[], wakeTriggered: boolean): Promise<RunResult> {
    if (wakeTriggered) this.wakeStreak += 1;
    else this.wakeStreak = 0;
    this.applyToolFace(wakeTriggered);
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
        // aborted 不续（用户叫停语义——取消模型 11d 正式收口）。空消费防御：
        // 搁浅件全被预算拒收时不续跑（startRun([]) 会触发无新消息的 LLM 调用）
        if (result.status !== 'completed') break;
        const drained = this.continueConsumption();
        if (drained.length === 0) break;
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
   * 消费位合批（04 §4 合批规则单源）：首件唤醒位 → 唤醒批取全量（合批窗口
   * ——后续件不辨唤醒/前台全部并入）；首件前台位 → one-at-a-time 取一件。
   * 预算执法：超帽唤醒件在此拒收过滤（warn 不静默）——kept 空时调用方各自
   * 空消费防御（followUp 空即收 / 续跑段不起空 run）。
   */
  private consumeBatch(): { items: PendingItem[]; wakeTriggered: boolean } {
    if (!this.queue.hasItems()) return { items: [], wakeTriggered: false };
    const items = this.queue.drain();
    if (items[0]!.backgroundWake === true) {
      // 唤醒头触发合批窗口：余件全量并入本批
      while (this.queue.hasItems()) items.push(...this.queue.drain());
    }
    const kept = items.filter((item) => {
      if (item.backgroundWake === true && this.wakeStreak >= MAX_CONSECUTIVE_WAKES) {
        this.warnWakeRefused();
        return false;
      }
      return true;
    });
    return { items: kept, wakeTriggered: kept.some((item) => item.backgroundWake === true) };
  }

  /**
   * 搁浅件续跑消费（runTurns 续跑段专用）：面随本批触发者——唤醒批收窄并
   * streak+1；前台批复原全量（不复位 streak——复位只认前台 idle 起跑）。
   */
  private continueConsumption(): AgentMessage[] {
    const { items, wakeTriggered } = this.consumeBatch();
    if (wakeTriggered) this.wakeStreak += 1;
    this.applyToolFace(wakeTriggered);
    return items.map((item) => item.message);
  }

  /**
   * 工具面切换（04 §4 合批收窄）：唤醒 run = backgroundTools 供应面产出
   * （**缺席 = 零工具**——「防后台 run 自由动用全部工具」最保守兑现）；
   * 前台 run = 全量 tools 快照（缺席 = 纯对话形态，摘除 tools 位）。
   * 请求组装（stream）与工具批执行（tools-batch）都是请求时点读
   * context.tools——换面即刻生效。
   */
  private applyToolFace(wakeTriggered: boolean): void {
    if (wakeTriggered) {
      this.context.tools = [...(this.options.backgroundTools?.() ?? [])];
    } else if (this.fullTools !== undefined) {
      this.context.tools = [...this.fullTools];
    } else {
      delete this.context.tools;
    }
  }

  /** 唤醒预算拒收警示（护栏不静默——warn 面统一文案） */
  private warnWakeRefused(): void {
    this.warnFace(`唤醒预算拒收：连续后台唤醒已达 ${MAX_CONSECUTIVE_WAKES} 帽（前台输入复位预算）`);
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
