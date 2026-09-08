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
 *  - 停靠腿（04 §5）：起跑前池检 + run 在飞 watchdog 轮询两执法——canAfford
 *    翻 false → driver.abort 协作中止 → 停靠（outcome 保持 pending：编排层
 *    await 悬停 = Job 不 settle、worktree/授予/在飞记账全保留；会话上下文
 *    跨停靠保留——唤醒走 followUp 通道续跑同会话）；assistant/message 计数
 *    达每 issue 帽 → abort → failed『每 issue 预算帽耗尽』（两层分账的
 *    run 侧执法）；
 *  - 唤醒腿（04 §5 budget_extended）：工厂自持 watcher——canAfford 恢复即
 *    对全部停靠项 submit 唤醒消息（source 'budget-extended' +
 *    backgroundWake:true——05 §3.1 同笔词行；恢复判据覆盖日池翻转与提额
 *    两形）。唤醒三帽单源在 driver（04 §4 maxConsecutiveWakes=3）：第 4 次
 *    唤醒件拒收 wake-refused → 本层收口 failed『连续后台唤醒超帽』（鲸鱼
 *    任务跨 4 个日池窗后停自动续跑——诚实边界）。
 *
 * 终局映射（IssueRunOutcome 四态）：completed（messagesUsed + 末条 assistant
 * 文本 summary）→ 若事件流存在被拒审批（approval/decided decision ∉
 * {approve, always}——无人应答收口与守门拒同面）改判 needs-human（保守偏向：
 * 成果需人审，与 auto 档危险闸缺席一律转人审同律）；failed；aborted 按
 * watchdog 归因分档（budget → 停靠 / cap → failed / 外部 → failed）。
 *
 * 停机收口（dispose）：停靠项 resolve paused（03 §10.7 paused 分支的生产
 * 承载——retain 语义：worktree 归 orphanScan 标注、重轮询再入走让位序）；
 * 在飞 run 不强收（宿主 conversation-manager closer 的 dismantle 打断在飞
 * run → aborted → 本层自然收口 failed）。
 */
import type { EventSource, ToolDefinition } from '../contracts/index.js';
import type { IssueSessionFace, IssueSessionStartResult, IssueRunOutcome } from '../issue/index.js';

import type { ConversationStack } from './conversation-stack.js';

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
  /** 停靠登记表（唤醒 watcher 扫描面——跨 startHeadless 共享，进程生命周期） */
  const parked = new Set<ParkedEntry>();

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
    let abortCause: 'budget' | 'cap' | undefined; // watchdog abort 归因（外部 abort 缺席）

    const eventsOf = () => driver.session.events() as readonly { type: string; data?: unknown }[];
    const messagesUsed = () => countAssistantMessages(eventsOf());

    let watchdog: ReturnType<typeof setInterval> | undefined;
    const stopWatchdog = (): void => {
      if (watchdog !== undefined) {
        clearInterval(watchdog);
        watchdog = undefined;
      }
    };

    /** 终局收口（一次结算 + 清轮询 + 终态停摆——subagent-factory 同律） */
    const finish = (result: IssueRunOutcome): void => {
      if (finished) return;
      finished = true;
      parked.delete(entry);
      stopWatchdog();
      driver.dismantle();
      settleOutcome(result);
    };

    /** 停靠登记（04 §5——outcome 悬置 + 会话上下文保留，驱动活体不 dismantle） */
    const parkNow = (reason: string): void => {
      parked.add(entry);
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
      // watchdog 两执法（在飞期轮询——主 loop stream 道无预算闸，会话侧停靠
      // 执法位在此；先帽后池序：每 issue 帽是编排纪律、日池是全局纪律）
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
        }
      }, pollMs);
      watchdog.unref();
      let result: Awaited<ReturnType<typeof driver.submit>>;
      try {
        result = await driver.submit(text, { source, ...(backgroundWake ? { backgroundWake: true } : {}) });
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
        finish({ status: 'failed', messagesUsed: used, reason: 'run 被外部中止' });
        return;
      }
      // injected / wake-refused（通道收执形）：活体 driver 提交 injected 理论
      // 不达；wake-refused 真实可达（连续后台唤醒超帽——鲸鱼任务诚实边界）
      finish({
        status: 'failed',
        messagesUsed: used,
        reason:
          result.status === 'wake-refused'
            ? '连续后台唤醒超帽（04 §4 maxConsecutiveWakes=3——鲸鱼任务跨 4 个日池窗，需人工介入或提额）'
            : `提交未起跑（${result.status}——理论不达防御位，诚实回执）`,
      });
    };

    const entry: ParkedEntry = {
      wake() {
        parked.delete(entry); // 先摘（再停靠时 parkNow 重登记）
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

  // 唤醒 watcher（工厂生命周期自持——04 §5 budget_extended 起跑全部停靠 run）：
  // 电平判（有停靠项且 canAfford 恢复即触发——恢复判据覆盖日池翻转与提额两形；
  // 防环不靠边沿靠 driver 三帽：唤醒起跑后若一轮耗尽复停靠，canAfford 已 false
  // 自然静默，翻真后三帽内续跑、超帽 wake-refused 收口 failed）
  const watcher = setInterval(() => {
    if (parked.size === 0) return;
    if (!canAfford()) return;
    for (const entry of [...parked]) entry.wake();
  }, pollMs);
  watcher.unref();

  return {
    startHeadless,
    dispose() {
      clearInterval(watcher);
      for (const entry of [...parked]) entry.dispose();
    },
  };
}
