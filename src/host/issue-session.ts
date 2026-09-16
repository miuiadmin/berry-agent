/**
 * host/issue-session — issue headless 会话真工厂（成熟度缺口 #5——03 §10.7
 * 起会腿 + 04 §5 停靠/唤醒腿的落码本体；subagent-factory 同族的 in-process
 * 起会面，04 §10 委派真工厂先例的 issue 谱系镜像）。
 *
 * 三件：
 *  - 起会腿：stack.manager.create（origin 'trigger'、workspaceRoot = worktree
 *    canonical 路径——会话绑定 cwd 隔离执法）+ per-session extraTools 通道并入
 *    issue 工具面（真三段管道注册——守门/审计/消毒与驱动层同律）+ 首跑
 *    source 'plugin:core:issue'（provenance 盖章——plugin: 域谱系归 1 跳）；
 *  - 停靠腿（04 §5）：起跑前池检 + run 在飞 watchdog 轮询执法——canAfford
 *    翻 false → driver.abort 协作中止 → 停靠（outcome 保持 pending：编排层
 *    await 悬停 = Job 不 settle、worktree/授予/在飞记账全保留；会话上下文
 *    跨停靠保留——唤醒走 followUp 通道续跑同会话）；assistant/message 计数
 *    达每 issue 帽 → abort → failed『每 issue 预算帽耗尽』（两层分账的
 *    run 侧执法）；距上次 durable 事件时滞超帽（04 §3.8.3 第三判据——
 *    流活性纵深）→ abort 归因 hung → failed『流停滞 watchdog 收口』；
 *  - 唤醒腿（04 §5 budget_extended）：宿主级广播件（u-3——04 §5 定形注①
 *    自本工厂私有 watcher 升格 budget-broadcast.ts 装配根单真身，三停靠面
 *    同播；缺席注入时工厂自建私有实例同一实现单源）——canAfford 恢复即对
 *    全部停靠项 submit 唤醒消息（source 'budget-extended' +
 *    backgroundWake:true——05 §3.1 同笔词行；恢复判据覆盖日池翻转与提额
 *    两形）。唤醒三帽单源在 driver（04 §4 maxConsecutiveWakes=3）：第 4 次
 *    唤醒件拒收 wake-refused → 本层收口 failed『连续后台唤醒超帽』（鲸鱼
 *    任务跨 4 个日池窗后停自动续跑——诚实边界）。停靠同笔在目标会话落
 *    session/paused 词（u-3——定形注②：daemon 猝死后冷启动可恢复呈现）。
 *
 * 终局映射（IssueRunOutcome 四态）：completed（messagesUsed + 末条 assistant
 * 文本 summary）→ 若事件流存在被拒审批（approval/decided decision ∉
 * {approve, always}——无人应答收口与守门拒同面）改判 needs-human（保守偏向：
 * 成果需人审，与 auto 档危险闸缺席一律转人审同律）；failed；aborted 按
 * watchdog 归因分档（budget → 停靠 / cap → failed / hung → failed『流停滞
 * watchdog 收口』〔04 §3.8.3 第四臂——不停靠：停滞非预算语义无可等〕/
 * 外部 → failed）。
 *
 * 停机收口（dispose）：停靠项 resolve paused（03 §10.7 paused 分支的生产
 * 承载——retain 语义：worktree 归 orphanScan 标注、重轮询再入走让位序）；
 * 在飞 run 不强收（宿主 conversation-manager closer 的 dismantle 打断在飞
 * run → aborted → 本层自然收口 failed）；停机 closer drain 窗内（manager
 * 已 dismantle、broadcast 未 dispose——注册序即 drain 序的窗）广播唤醒的
 * inject 收执同笔 paused-retain（03 §10.7 五役定形补笔——runRound injected
 * 分支注）。
 */
import type { EventSource, ToolDefinition } from '../contracts/index.js';
import type { IssueSessionFace, IssueSessionStartResult, IssueRunOutcome } from '../issue/index.js';

import type { ConversationStack } from './conversation-stack.js';
import { DEFAULT_SESSION_STALL_TIMEOUT_MS } from './conversation-stack.js';
import { createBudgetBroadcast, type BudgetBroadcastFace } from './budget-broadcast.js';

/** 首跑 source（03 §2.2 provenance 盖章——core:issue 件身份；plugin: 域谱系） */
const ISSUE_SUBMIT_SOURCE: EventSource = 'plugin:core:issue';

/** 唤醒消息 source（04 §5 + 05 §3.1 同笔词行——source 闭集恰六字面量成员） */
const WAKE_SOURCE: EventSource = 'budget-extended';

/** 唤醒消息文本（durable user/message 载体——模型侧「预算恢复继续任务」指令） */
const WAKE_MESSAGE = '后台预算日池已恢复（budget_extended）——请继续此前停靠时未完成的任务，完成后按原交付纪律收口。';

/** watchdog / 唤醒 watcher 轮询间隔缺省（1s——观测粒度与轮询成本的折中；测试注窄值） */
const DEFAULT_POLL_MS = 1000;

/** 工厂装配面（host 装配根注入——词面独立律：不自持预算知识，canAfford 窄面注入） */
export interface IssueSessionFactoryOptions {
  readonly stack: ConversationStack;
  /** 日池判窄面（真身 = stack.llm.canAfford('background')——04 §5 background 档） */
  readonly canAfford: () => boolean;
  /** warn 日志面（缺省 stderr——停靠/唤醒护栏不静默） */
  readonly warn?: (message: string) => void;
  /** 轮询间隔缺省 1000ms（测试注窄值驱动时序） */
  readonly pollMs?: number;
  /**
   * 宿主级 budget-extended 广播件（u-3——04 §5 定形注①：canAfford 恢复
   * watcher 自工厂私有升格宿主件，装配根单真身三停靠面同播）。缺席 = 工厂
   * 自建私有实例（同一实现单源——独立装配形/测试形零降级）；注入形工厂
   * dispose 不关广播件（归宿主停机序）。
   */
  readonly broadcast?: BudgetBroadcastFace;
  /**
   * 编排层时滞帽（04 §3.8.3——watchdog 第三判据纵深）：距上次 durable 事件
   * 时滞超帽 → abort 归因 hung → failed『流停滞 watchdog 收口』（不停靠——
   * 停滞非预算语义）。缺省 15min（conversation-stack 单源——「编排帽 ≥ 流层
   * idle 帽」不变式在装配根交叉校验）；0 = 显式关（装配位 warn 留痕）。
   * 测试注窄值驱动时序（与 pollMs 同族）。
   */
  readonly stallTimeoutMs?: number;
}

/** 工厂公开面（IssueSessionFace 超集——dispose 归宿主停机序消费） */
export interface IssueSessionFactoryFace extends IssueSessionFace {
  /**
   * 停机收口：摘唤醒 watcher + 停靠项逐个 resolve paused（编排层 await 拿到
   * 后走 retain 分支——授予/worktree 全保留）。在飞 run 不在此强收（manager
   * dispose 的 dismantle 打断 → aborted → 编舞自然收口）。
   */
  dispose(): void;
}

/** 停靠登记项（唤醒 watcher 的扫描面——每 startHeadless 一枚） */
interface ParkedEntry {
  /** 唤醒起跑（watcher 恢复触发——先摘登记再续跑，再停靠时重登记） */
  wake(): void;
  /** 停机收口（dispose 触发——resolve paused + 终态 dismantle） */
  dispose(): void;
}

/** assistant/message 事件计数（每 issue 帽的计量面——messagesUsed 同源） */
function countAssistantMessages(events: readonly { type: string; data?: unknown }[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type === 'assistant/message') count += 1;
  }
  return count;
}

/** 尾扫末条 assistant 消息文本（summary 来源——subagent-factory 同型扫描） */
function lastAssistantText(events: readonly { type: string; data?: unknown }[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined || event.type !== 'assistant/message') continue;
    const blocks = (event.data as { content?: readonly { type: string; text?: string }[] } | undefined)?.content;
    if (!Array.isArray(blocks)) return '';
    return blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

/** 被拒审批计数（needs-human 检测——decision ∉ {approve, always} 即被拒面） */
function deniedApprovalCount(events: readonly { type: string; data?: unknown }[]): number {
  let count = 0;
  for (const event of events) {
    if (event.type !== 'approval/decided') continue;
    const decision = (event.data as { decision?: unknown } | undefined)?.decision;
    if (decision !== 'approve' && decision !== 'always') count += 1;
  }
  return count;
}

/**
 * issue headless 会话真工厂（CorePluginHostDeps.issueSession seam 的本体——
 * 装配根接线后 core:issue 主闸三通过，生产面件装载解锁）。
 */
export function createIssueSessionFactory(options: IssueSessionFactoryOptions): IssueSessionFactoryFace {
  const { stack, canAfford } = options;
  const warn = options.warn ?? ((message: string) => console.error(message));
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  // 编排层时滞帽（04 §3.8.3 第三判据）：缺省 15min 单源在 conversation-stack
  //（「编排 ≥ 流层」不变式装配根交叉校验）；0 = 显式关（纵深缺席）
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_SESSION_STALL_TIMEOUT_MS;
  /** 停靠登记表（唤醒 watcher 扫描面——跨 startHeadless 共享，进程生命周期） */
  const parked = new Set<ParkedEntry>();
  // 广播件解析（u-3——04 §5 定形注①升格）：注入形 = 宿主单真身（三停靠面
  // 同播，dispose 归宿主停机序不归本工厂）；缺席 = 自建私有实例（同一实现
  // 单源——独立装配形/测试形零降级，工厂 dispose 时同笔收口）
  const ownsBroadcast = options.broadcast === undefined;
  const broadcast = options.broadcast ?? createBudgetBroadcast({ canAfford, pollMs });

  async function startHeadless(req: {
    readonly cwd: string;
    readonly prompt: string;
    readonly budgetMessages: number;
    readonly tools: readonly ToolDefinition[];
  }): Promise<IssueSessionStartResult> {
    // 终局外壳：停靠 = 保持 pending（编排层 await 悬停——04 §5 不落终态语义
    // 的实现载体）；dispose 的 paused 收口也走同一 settle（一次结算幂等护栏）
    let settleOutcome!: (outcome: IssueRunOutcome) => void;
    const outcome = new Promise<IssueRunOutcome>((resolve) => {
      settleOutcome = resolve;
    });

    // 会话装配（origin 'trigger'——SessionOrigin 闭集五值无 issue 位，触发
    // 谱系归并；workspaceRoot = worktree canonical 路径——fs fence/bash 沙箱
    // 锚定；extraTools = 件注册的只读工具面经管道注册位并入）
    const child = stack.manager.create({
      origin: 'trigger',
      workspaceRoot: req.cwd,
      title: 'issue（headless）',
      extraTools: () => req.tools,
    });
    const driver = child.driver;
    const sessionId = child.sessionId;

    let finished = false; // 终局已收口（settle 幂等护栏）
    let running = false; // 在飞旗（watchdog 只在飞时执法——停靠/idle 期不误伤）
    let abortCause: 'budget' | 'cap' | 'hung' | undefined; // watchdog abort 归因（外部 abort 缺席）

    // 事件投影读面（第三判据读 time——SessionEvent 信封恒携毫秒时间戳）
    const eventsOf = () => driver.session.events() as readonly { type: string; data?: unknown; time: number }[];
    const messagesUsed = () => countAssistantMessages(eventsOf());
    // 距上次 durable 推进的钟锚（04 §3.8.3）：读面 = 末位事件 time（任意
    // durable 事件落账即推进——工具 result、llm/retry 退避窗都算）；锚取
    // max(本轮起跑时刻, 末位事件 time)——零 durable 回落起跑锚，唤醒轮的
    // 前朝事件（停靠期落词）也不把「停靠等待时长」误计为流停滞
    let roundStartedAtMs = 0;
    const lastAdvanceMs = (): number => {
      const events = eventsOf();
      const lastTime = events.length > 0 ? (events[events.length - 1]?.time ?? 0) : 0;
      return Math.max(roundStartedAtMs, lastTime);
    };

    let watchdog: ReturnType<typeof setInterval> | undefined;
    const stopWatchdog = (): void => {
      if (watchdog !== undefined) {
        clearInterval(watchdog);
        watchdog = undefined;
      }
    };

    /** 终局收口（一次结算 + 清轮询 + 双侧摘登记 + 单会话收口——subagent-factory 同律） */
    const finish = (result: IssueRunOutcome): void => {
      if (finished) return;
      finished = true;
      parked.delete(entry);
      broadcast.unregister(entry); // 广播侧同笔摘（宿主级面不再扫描已收口项）
      stopWatchdog();
      stack.manager.retire(sessionId); // dismantle 终态停摆 + 摘活体登记（05 §7 retire 律）
      settleOutcome(result);
    };

    /** 停靠登记（04 §5——outcome 悬置 + 会话上下文保留，驱动活体不 dismantle）。
     *  u-3 落词（04 §5 定形注②）：预算语境停靠在目标会话落 session/paused
     *  （reason 'budget'）——daemon 猝死后冷启动可恢复呈现；两触发位（起跑前
     *  池检/watchdog 收口后）皆在 run 收口后或未起跑，词行「收口后落词」合规。
     *  复停靠（唤醒轮再停靠）再落一笔——append 事实流，尾条即停靠态由
     *  SessionLiveState 推导 */
    const parkNow = (reason: string): void => {
      parked.add(entry);
      broadcast.register(entry); // 宿主级广播面登记（canAfford 恢复同播三面之一）
      driver.session.append('session/paused', { reason: 'budget' });
      warn(`issue 会话停靠（${sessionId}）：${reason}——待 budget_extended 唤醒（04 §5 不落终态）`);
    };

    /**
     * 单轮起跑编舞（首跑与唤醒轮共用）：起跑前池检 → watchdog 启动 →
     * submit → 终局映射。
     */
    const runRound = async (text: string, source: EventSource, backgroundWake: boolean): Promise<void> => {
      if (finished) return;
      // 起跑前池检（04 §5 有帽 run 池尽停靠——首跑与唤醒轮同律）
      if (!canAfford()) {
        parkNow('起跑前日池尽');
        return;
      }
      abortCause = undefined;
      running = true;
      // 起跑锚先记（04 §3.8.3——watchdog 先于 submit 启动与种子落账间有空窗，
      // 空投影不可无锚悬判；本锚也是 max 锚的下界——前朝事件不计停滞）
      roundStartedAtMs = Date.now();
      // watchdog 三执法（在飞期轮询——主 loop stream 道无预算闸，会话侧停靠
      // 执法位在此；先帽后池序：每 issue 帽是编排纪律、日池是全局纪律、
      // 时滞帽是流活性纵深——04 §3.8.3 独立键独立缺省，durable 级迟钝但
      // 流层主防失效时兜底）
      watchdog = setInterval(() => {
        if (!running || abortCause !== undefined) return;
        if (messagesUsed() >= req.budgetMessages) {
          abortCause = 'cap';
          driver.abort();
          return;
        }
        if (!canAfford()) {
          abortCause = 'budget';
          driver.abort();
          return;
        }
        if (stallTimeoutMs > 0 && Date.now() - lastAdvanceMs() > stallTimeoutMs) {
          abortCause = 'hung';
          driver.abort();
        }
      }, pollMs);
      watchdog.unref();
      let result: Awaited<ReturnType<typeof driver.submit>>;
      try {
        // 车道随起跑方声明位单源（04 §5 车道兑现笔 + 四役补笔——issue run 是
        // 后台编排，与 tick 后台 run / run --background / 子代理 submit 同道
        // 同位）：首跑与唤醒轮（backgroundWake 分支）全路径恒置 background——
        // 桥接 llm/usage 记账进后台日池，起跑前池检/watchdog 与预警 ratio 消费
        // 的池从此对 issue 自身消耗不再失明
        result = await driver.submit(text, {
          source,
          backgroundLane: true,
          ...(backgroundWake ? { backgroundWake: true } : {}),
        });
      } catch (err) {
        // 驱动层永不抛（契约位）——防御收口：诚实 failed 不悬挂编排层
        running = false;
        stopWatchdog();
        finish({
          status: 'failed',
          messagesUsed: messagesUsed(),
          reason: `会话提交异常（防御位——驱动层契约永不抛）：${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      running = false;
      stopWatchdog();
      if (finished) return; // dispose 已收口（迟到结算弃）
      const used = messagesUsed();
      if (result.status === 'completed') {
        // needs-human 检测（04 §10 消费注执法细则）：被拒审批在场 = 成果需
        // 人审（保守偏向——判定纯事件载荷闭集，不猜模型文本）
        const denied = deniedApprovalCount(eventsOf());
        if (denied > 0) {
          finish({
            status: 'needs-human',
            messagesUsed: used,
            reason: `审批被拒 ${denied} 次（无人应答收口/守门拒——04 §9 fail-closed），成果需人审`,
          });
          return;
        }
        finish({ status: 'completed', messagesUsed: used, summary: lastAssistantText(eventsOf()) });
        return;
      }
      if (result.status === 'failed') {
        finish({ status: 'failed', messagesUsed: used, reason: result.errorMessage ?? 'run 失败（无错误详情）' });
        return;
      }
      if (result.status === 'aborted') {
        if (abortCause === 'budget') {
          parkNow('run 中日池尽（watchdog 协作中止）');
          return;
        }
        if (abortCause === 'cap') {
          finish({
            status: 'failed',
            messagesUsed: used,
            reason: `每 issue 预算帽耗尽（${req.budgetMessages} 条——04 §5 每 issue 帽与全局池两层分账）`,
          });
          return;
        }
        if (abortCause === 'hung') {
          // 第四臂（04 §3.8.3）：hung → failed 不停靠——停滞非预算语义，
          // 停靠是「等预算恢复」的悬置态，停滞无可等（无人值守域诚实收口）
          finish({
            status: 'failed',
            messagesUsed: used,
            reason: `流停滞 watchdog 收口（距上次 durable 事件超 ${stallTimeoutMs}ms——04 §3.8 编排层时滞帽）`,
          });
          return;
        }
        finish({ status: 'failed', messagesUsed: used, reason: 'run 被外部中止' });
        return;
      }
      // wake-refused（通道收执形——真实可达）：连续后台唤醒超帽（鲸鱼任务诚实
      // 边界，与停机窗无关）——诚实 failed 收口（04 §4 maxConsecutiveWakes=3）
      if (result.status === 'wake-refused') {
        finish({
          status: 'failed',
          messagesUsed: used,
          reason: '连续后台唤醒超帽（04 §4 maxConsecutiveWakes=3——鲸鱼任务跨 4 个日池窗，需人工介入或提额）',
        });
        return;
      }
      // injected（停机窗 inject 通道——真实可达，原注「理论不达」系勘正对象：
      // 03 §10.7 五役定形补笔）：停机 closer drain 窗内（装配根注册序即 drain
      // 序——conversation-manager 已 dismantle、budget-broadcast 未 dispose 的
      // 窗）广播 watcher 唤醒停靠项，dismantle 态 driver.submit 经 inject 通道
      // （04 §4 三通道路由）只落 durable 账不唤醒 run。此形停靠保持 =
      // paused-retain：failed 收口会触发 issue 服务 worktree clean + 失败回执，
      // 丢失停靠保留语义（本应 worktree/授予保留归 orphanScan 重入）；唤醒输入
      // 已随 inject 通道 durable 落账（user/message），下次启动 timeline 重播种
      // 带入非丢失——与 goal 面广播唤醒停机防御（run 未起即停靠保持）同律
      finish({
        status: 'paused',
        reason: '提交未起跑（停机窗 inject 通道——停靠保留：worktree 与授予归 orphanScan 再入，唤醒输入随下次启动带入）',
      });
    };

    const entry: ParkedEntry = {
      wake() {
        parked.delete(entry); // 先摘（再停靠时 parkNow 重登记——双侧同笔）
        broadcast.unregister(entry);
        void runRound(WAKE_MESSAGE, WAKE_SOURCE, true);
      },
      dispose() {
        finish({
          status: 'paused',
          reason: '宿主停机收口——停靠项保留 worktree 与授予（orphanScan 标注，重轮询再入走让位序）',
        });
      },
    };

    // 首轮起跑（fire——outcome promise 即回执，编排层自行 await）
    void runRound(req.prompt, ISSUE_SUBMIT_SOURCE, false);
    return { sessionId, outcome };
  }

  // 唤醒扫描（u-3 升格——04 §5 定形注①）：原工厂私有 watcher 已升格宿主级
  // 广播件（budget-broadcast.ts 装配根单真身三停靠面同播；电平判语义逐字
  // 平移——有停靠项且 canAfford 恢复即触发，防环不靠边沿靠 driver 三帽）。
  // 本工厂只持登记面（parkNow 双登记 / finish·wake 双侧摘）

  return {
    startHeadless,
    dispose() {
      for (const entry of [...parked]) entry.dispose(); // finish 内双侧摘登记
      // 自建私有形同笔收口；注入形宿主真身归停机序——不可在此关闭
      if (ownsBroadcast) broadcast.dispose();
    },
  };
}
