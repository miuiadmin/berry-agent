/**
 * conversation — 跨会话操控面（03 §2.2 第十一面 `sessions-control`——e-1
 * 规范先行批立面、2026-09-08 e-4 落码批兑现、2026-09-09 e-5 收口批定形）。
 *
 * **双面同源**（题 7 拍板）：模型走宿主内建固定工具族（`session_send` /
 * `session_interrupt` / `session_withdraw`——恒挂载不随门开合动态挂载），
 * 插件代码走 `ctx.get("sessions-control")` 服务面；**两面同一实现源**——
 * 工具 = 服务面薄包装，动词语义单源本文件（受理器 + 契约）。
 *
 * 三动词（共同前置：幽灵守卫 `SESSION_TARGET_NOT_FOUND` → 门检
 * `SESSION_CONTROL_DENIED`〔操控轴无树内豁免、全域同门〕→ …动词各自位）：
 *  - `send`：跨会话输入注入——发送方不选通道（04 §4 三通道路由驱动侧
 *    单源：idle→followUp 起跑 / busy→steer 合批 / 停摆→inject 带入），
 *    回执 = 入列回执（被丢/被拒项呈报不静默）；`expectedTurnId?` 乐观
 *    并发位（翻页拒 `SESSION_TURN_STALE`）；a2a 链深超帽拒
 *    `SESSION_ROUND_LIMIT`；`dedupeKey?` 幂等位（e-5 定案——同键重复
 *    send 返原回执不重复注入，键域按调用方身份分域）。
 *  - `interrupt`：打断目标在飞 run（turn 终态 interrupted）；无在飞拒
 *    `SESSION_INACTIVE`（响亮拒不静默 no-op）。回执含 still_queued 后果
 *    清单（e-5 定形：在队操控件 id 清单 + 在队总数计数——打断只打断当前
 *    run，在队 steer 件保留在队、下次 followUp 作种子续跑）。
 *  - `withdraw`：在队撤回对称闭环（题 9 缺省案 e-5 呈拍确认维持：已出队
 *    'delivered' no-op 诚实回执，不虚构撤回成功）。
 *
 * **provenance 盖章单源**（05 §3.1）：注入的 user/message `source` 由本
 * 受理面按调用方身份（ControlCaller）铸——模型工具道 `session:<送话会话id>`、
 * 插件服务道 `plugin:<插件id>`（既有前缀复用）；**调用方传入面无 source
 * 参数位**——伪造结构性不存在。
 */
import { BaseError, type UserMessage } from '../contracts/index.js';
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import type { ConversationDriver } from './driver.js';
import type { SessionManager } from './sessions.js';

/** 操控轴高危面名（03 §4.6 v1 首批第六枚——操控全域无树内豁免，两轴分立） */
export const CONTROL_CROSS_CAPABILITY = 'sessions.control-cross';

/** 服务面名（scope.provide 键——插件经 `ctx.get("sessions-control")` 消费） */
export const SESSIONS_CONTROL_SERVICE = 'sessions-control';

/** a2a 回合护栏帽缺省（03 §2.2 第十一面题 8 呈拍定案：缺省 5 对齐 openclaw；装配可覆盖） */
export const A2A_ROUND_LIMIT_DEFAULT = 5;

/**
 * send 幂等近期窗帽（e-5 定案——与队列帽同数 100：同键重复 send 返原回执
 * 的查重窗容量；超帽逐最旧〔Map 插入序〕。内存位不承诺跨进程——与队列/
 * a2a 深度位同语义）。
 */
export const SEND_DEDUPE_WINDOW_CAPACITY = 100;

/**
 * 调用方身份（provenance 盖章单源的输入面）：受理面据此铸 source 前缀——
 * `session` 道 → `session:<sessionId>`（05 §3.1 新前缀行）、`plugin` 道 →
 * `plugin:<pluginId>`（既有前缀复用）。两道 a2a 链深计数同律（plugin 道
 * 起跳链深 1——插件直唤即第一跳）。
 */
export type ControlCaller =
  { readonly kind: 'session'; readonly sessionId: string } | { readonly kind: 'plugin'; readonly pluginId: string };

/**
 * send 回执（04 §4 入列回执——受理与去向呈报不静默；类型化回执词归
 * contracts 词汇非错误码——02 §5.3 词形注）：
 *  - `delivered`：已投递——idle 腿 followUp 起跑（fire-and-forget，回执即
 *    时返）或停摆腿 inject 落账（携 durable seq）；
 *  - `queued`：busy 腿 steer 入列（drop-oldest 溢出时被丢旧件呈报——
 *    `droppedMessageId` 为被丢件 id）；
 *  - `dropped`：本件被拒（bounded 拒新档——驱动队列缺省 drop-oldest，
 *    此档为词形完备性防御位）。
 */
export type ControlSendReceipt =
  | { readonly status: 'delivered'; readonly messageId: string; readonly seq?: number }
  | { readonly status: 'queued'; readonly messageId: string; readonly droppedMessageId?: string }
  | { readonly status: 'dropped'; readonly reason: 'queue-full' };

/**
 * interrupt 回执（e-5 收口定形——03 §2.2 第十一面 interrupt 后果清单）：
 * 打断只打断当前 run，在队 steer 件**保留在队**（下次 followUp 作种子续跑）
 * ——回执逐项呈报去向，调用方据此决定是否 withdraw 余件：
 *  - `stillQueued`：在队**操控件** messageId 清单（有撤回关联键的件——可逐件
 *    withdraw；普通 steer 件〔目标会话自己的用户输入〕无撤回键不入清单）；
 *  - `queuedCount`：在队总数（含普通件——跨会话调用方对普通件无撤回键，
 *    计数告知「目标还有 N 件在队」即可，不虚构普通件名）。
 */
export interface ControlInterruptReceipt {
  readonly status: 'interrupted';
  readonly targetSessionId: string;
  /** 在队操控件 messageId 清单（可 withdraw 撤回） */
  readonly stillQueued: readonly string[];
  /** 在队总数（含普通 steer 件——计数呈报） */
  readonly queuedCount: number;
}

/**
 * withdraw 回执：`withdrawn` = 在队件已移除；`delivered` = 已出队（已被
 * 消费或从未在队——no-op 诚实呈报，不虚构撤回成功）。
 */
export type ControlWithdrawReceipt =
  | { readonly status: 'withdrawn'; readonly messageId: string }
  | { readonly status: 'delivered'; readonly messageId: string };

/** send 入参（source 无参数位——provenance 受理面单源盖章） */
export interface SessionSendInput {
  readonly caller: ControlCaller;
  readonly targetSessionId: string;
  /** 注入文本（非空——空文本是调用方 bug，受理面拒收） */
  readonly text: string;
  /**
   * 乐观并发位（codex expected_turn_id 形）：给定而目标 turn 已翻页拒
   * `SESSION_TURN_STALE`。turnId 形 = 目标 durable 日志最近 turn/start
   * 事件 seq（单源 durable——session_read/session_trace 尾窗可见）。
   */
  readonly expectedTurnId?: number;
  /**
   * 幂等键（e-5 定案——loopx client_ingress_id 先例）：同键重复 send 返
   * 原回执不重复注入。键域按调用方身份分域（`session:`/`plugin:` 前缀各自
   * 键空间——跨调用方同键不互撞）；仅成功回执入窗、拒路径不入（重试须重新
   * 走受理序——世界可能已变）；近期窗内存位不承诺跨进程。无键不去重（缺省
   * 无幂等——键是调用方显式契约）。
   */
  readonly dedupeKey?: string;
}

/** interrupt 入参 */
export interface SessionInterruptInput {
  readonly caller: ControlCaller;
  readonly targetSessionId: string;
}

/** withdraw 入参（messageId = send 回执所铸 id——受理器栈级自增序列） */
export interface SessionWithdrawInput {
  readonly caller: ControlCaller;
  readonly targetSessionId: string;
  readonly messageId: string;
}

/**
 * sessions-control 服务面契约（双面同源的单源实现面——工具族薄包装与
 * ctx.get 消费方共用本面）。受理序（send）：幽灵守卫 → 门检（全域）→
 * a2a 链深帽 → expectedTurnId 对拍 → 投递 + capability/used 审计；
 * interrupt/withdraw：幽灵守卫 → 门检 → 动词位。
 */
export interface SessionsControlFace {
  send(input: SessionSendInput): Promise<ControlSendReceipt>;
  interrupt(input: SessionInterruptInput): Promise<ControlInterruptReceipt>;
  withdraw(input: SessionWithdrawInput): Promise<ControlWithdrawReceipt>;
}

/**
 * 受理面铸 source（provenance 盖章——05 §3.1；唯一合法铸位：driver.submit
 * 对 `session:` 前缀 fail-loud 拒，结构性杜绝绕受理面伪造）。
 */
export function controlSourceOf(caller: ControlCaller): UserMessage['source'] {
  return caller.kind === 'session' ? `session:${caller.sessionId}` : `plugin:${caller.pluginId}`;
}

/** capability/used 审计记录（操控轴载荷——05 §1.1 e-4 定形：归因键含动词名与目标会话 id） */
export interface ControlUsedRecord {
  readonly capability: typeof CONTROL_CROSS_CAPABILITY;
  /** 动词名（send/interrupt/withdraw） */
  readonly verb: 'send' | 'interrupt' | 'withdraw';
  readonly targetSessionId: string;
  /** 送话会话 id（模型工具道归因——缺席即插件服务道） */
  readonly callerSessionId?: string;
  /** 插件 id（插件服务道归因——缺席即模型工具道） */
  readonly pluginId?: string;
}

/** createSessionsControl 依赖注入面（装配根构造受理器——宿主内建与 ctx.get 共用同件） */
export interface SessionsControlDeps {
  /** 多会话管理器（幽灵守卫 exists / 活体解析 driverOf / auto-open 投递腿） */
  readonly manager: SessionManager;
  /**
   * 操控门检输入取值器（caller 感知合成——开门制扩展批 2026-09-09，03 §4.6
   * 双源并集律）：插件道 caller = doors 段 ∪ 该插件行 opens 并集、模型道
   * caller = doors 段单独（源①无插件 id 锚结构性缺位）。合成位在受理器门检
   * 位逐次现读现判（撤位即收回——triggers.start-run fire 复检同律）；全域
   * 同门无树内豁免；只读集契约。
   */
  readonly getOpensFor: (caller: ControlCaller) => ReadonlySet<string>;
  /** capability/used 审计 seam（05 §1.1——装配位接线，缺席 = 零审计） */
  readonly onCapabilityUsed?: (record: ControlUsedRecord) => void;
  /** a2a 回合护栏帽（缺省 A2A_ROUND_LIMIT_DEFAULT=5——装配可覆盖） */
  readonly roundLimit?: number;
}

/**
 * 操控受理器工厂（双面同源的单源实现位——03 §2.2 第十一面 e-4 落码）：
 * 宿主内建工具族（模型道）与 `ctx.get("sessions-control")`（插件道）都调
 * 本件返回的 SessionsControlFace，动词语义/执法序单源在此。
 *
 * 受理序（send）：幽灵守卫 → 操控门检（全域）→ a2a 链深帽 →
 * expectedTurnId 对拍 → 投递（auto-open：目标未 open 即 resume 打开——
 * 发送方不应被要求先手动打开目标）→ capability/used 审计；
 * interrupt/withdraw：幽灵守卫 → 门检 → 动词位（interrupt 不 auto-open——
 * 打断休眠会话无在飞可打；withdraw 不 auto-open——队列是内存态，休眠无队）。
 */
export function createSessionsControl(deps: SessionsControlDeps): SessionsControlFace {
  const roundLimit = deps.roundLimit ?? A2A_ROUND_LIMIT_DEFAULT;
  /** 撤回关联键铸造位（栈级自增——受理器栈内唯一，跨会话可对账） */
  let messageSeq = 0;
  /**
   * send 幂等近期窗（e-5 定案）：分域键 = `<caller 前缀>|<dedupeKey>` →
   * 原回执。仅成功回执入窗（拒路径不入——重试须重新走受理序）；命中前置
   * 返原回执（零新注入零新审计——回执重放非新受理）。超帽逐最旧（Map
   * 插入序）。内存位：崩溃重启即丢（与队列/a2a 深度位同语义——幂等承诺
   * 不跨进程）。
   */
  const dedupeWindow = new Map<string, ControlSendReceipt>();

  /** 幽灵守卫（三动词共同前置①——目标 id 无对应行，进程内 ∪ durable） */
  const guardTarget = (verb: string, targetSessionId: string): void => {
    if (!deps.manager.exists(targetSessionId)) {
      throw new BaseError(
        'SESSION_TARGET_NOT_FOUND',
        `操控动词 ${verb} 的目标会话 ${targetSessionId} 不存在（进程内与 durable 均无对应行）`,
      );
    }
  };

  /**
   * 操控门检（三动词共同前置②——全域同门无树内豁免，03 §2.2 第十一面门制句）。
   * 门检输入 = caller 感知合成（开门制扩展批——deps.getOpensFor(caller)：
   * 插件道 doors 段 ∪ 该插件行 opens、模型道 doors 段单独）。
   */
  const enforceDoor = (verb: string, targetSessionId: string, caller: ControlCaller): void => {
    const verdict = adjudicateCapabilityDoor(deps.getOpensFor(caller), CONTROL_CROSS_CAPABILITY);
    if (!verdict.ok) {
      throw new BaseError(
        'SESSION_CONTROL_DENIED',
        `${verdict.message}（动词 ${verb}，目标会话 ${targetSessionId}——操控轴无树内豁免）`,
      );
    }
  };

  /** capability/used 逐次审计（门开后行使即记——拒路径未获许可不记） */
  const audit = (verb: ControlUsedRecord['verb'], input: { targetSessionId: string }, caller: ControlCaller): void => {
    deps.onCapabilityUsed?.({
      capability: CONTROL_CROSS_CAPABILITY,
      verb,
      targetSessionId: input.targetSessionId,
      ...(caller.kind === 'session' ? { callerSessionId: caller.sessionId } : { pluginId: caller.pluginId }),
    });
  };

  /**
   * send 幂等窗入位（仅成功回执——e-5 定案）：分域键铸造 + 超帽逐最旧。
   * 命中查询在 send 入口前置（见 send 体）。
   */
  const rememberSend = (dedupeKey: string, caller: ControlCaller, receipt: ControlSendReceipt): void => {
    const key = `${controlSourceOf(caller)}|${dedupeKey}`;
    if (dedupeWindow.size >= SEND_DEDUPE_WINDOW_CAPACITY) {
      // 逐最旧（Map 迭代序 = 插入序——首个键即最旧）
      dedupeWindow.delete(dedupeWindow.keys().next().value!);
    }
    dedupeWindow.set(key, receipt);
  };

  return {
    async send(input) {
      // 空文本拒收（契约位——空文本是调用方 bug，非业务拒不造码）
      if (input.text.trim() === '') {
        throw new Error('send 拒收空文本（调用方 bug——注入文本非空是调用方契约）');
      }
      // —— 幂等命中前置（e-5 定案）：同键重复 send 返原回执不重复注入。
      // 前置于幽灵/门检——首次受理已成功，重试就该幂等返原果（重试时世界
      // 变化不该让已成功的逻辑发送吃新拒码）；命中 = 回执重放非新受理，
      // 零新注入零新审计
      if (input.dedupeKey !== undefined) {
        const prior = dedupeWindow.get(`${controlSourceOf(input.caller)}|${input.dedupeKey}`);
        if (prior !== undefined) return prior;
      }
      guardTarget('send', input.targetSessionId);
      enforceDoor('send', input.targetSessionId, input.caller);
      // —— a2a 链深帽（03 §2.2 第十一面回合护栏）：送话方深度+1 超帽拒。
      // 插件服务道起跳链深 1（插件直唤即第一跳）；送话会话未 open 按 0——
      // 与「崩溃重启归零」同语义（内存位不承诺跨进程精确保留，护栏目的已达）
      const callerDepth =
        input.caller.kind === 'session' ? (deps.manager.driverOf(input.caller.sessionId)?.a2aDepth ?? 0) : 0;
      const newDepth = callerDepth + 1;
      if (newDepth > roundLimit) {
        throw new BaseError(
          'SESSION_ROUND_LIMIT',
          `跨会话 send 链深 ${newDepth} 超回合护栏帽 ${roundLimit}（a2a 互搏环——人面输入重置链深）`,
        );
      }
      // —— auto-open 投递腿：目标未 open 即 resume 打开（幂等 open——单焦点
      // 不造第二附着）；expectedTurnId 对拍用活体 durable 日志尾扫（单源）
      const driver = deps.manager.driverOf(input.targetSessionId) ?? deps.manager.open(input.targetSessionId).driver;
      if (input.expectedTurnId !== undefined && input.expectedTurnId !== lastTurnStartSeq(driver)) {
        throw new BaseError(
          'SESSION_TURN_STALE',
          `目标会话 ${input.targetSessionId} 的 turn 已翻页（期望最近 turn/start seq=${input.expectedTurnId}，实际 ${String(lastTurnStartSeq(driver))}——说完话世界已变）`,
        );
      }
      const messageId = `msg-${(messageSeq += 1)}`;
      const message: UserMessage = {
        role: 'user',
        content: input.text,
        timestamp: Date.now(),
        source: controlSourceOf(input.caller),
      };
      const receipt = driver.deliverControl(message, messageId, newDepth);
      // 幂等窗入位（仅成功回执——三态都是「受理完成」面；拒路径已在上方 throw 不至此）
      if (input.dedupeKey !== undefined) rememberSend(input.dedupeKey, input.caller, receipt);
      audit('send', input, input.caller);
      return receipt;
    },

    async interrupt(input) {
      guardTarget('interrupt', input.targetSessionId);
      enforceDoor('interrupt', input.targetSessionId, input.caller);
      // 打断无对象响亮拒不静默 no-op（03 §2.2 第十一面 interrupt）——目标未
      // open 必无在飞 run（休眠会话无 run），缺席 driver 同判
      const driver = deps.manager.driverOf(input.targetSessionId);
      if (driver === undefined || !driver.running) {
        throw new BaseError('SESSION_INACTIVE', `目标会话 ${input.targetSessionId} 无在飞 run 可打断（休眠或已停摆）`);
      }
      driver.abort();
      // —— still_queued 后果清单（e-5 定形）：打断只打断当前 run，在队件
      // 保留在队（aborted 不续跑——下次 followUp 作种子续跑）。打断后取快照
      // 呈报去向：操控件 id 清单（可 withdraw）+ 在队总数（含普通件计数）
      const queued = driver.queuedItems();
      audit('interrupt', input, input.caller);
      return {
        status: 'interrupted',
        targetSessionId: input.targetSessionId,
        stillQueued: queued.flatMap((item) => (item.id !== undefined ? [item.id] : [])),
        queuedCount: queued.length,
      };
    },

    async withdraw(input) {
      guardTarget('withdraw', input.targetSessionId);
      enforceDoor('withdraw', input.targetSessionId, input.caller);
      // 队列是内存态：目标未 open / 已停摆清队 → 不在队恒真（'delivered'
      // 诚实呈报——不虚构撤回成功）
      const driver = deps.manager.driverOf(input.targetSessionId);
      const withdrawn = driver?.withdrawQueued(input.messageId) ?? false;
      audit('withdraw', input, input.caller);
      return { status: withdrawn ? 'withdrawn' : 'delivered', messageId: input.messageId };
    },
  };
}

/**
 * 插件道消费面（窄形——无 caller 位：归因闭包铸造防冒名单源，c-3 secrets
 * fork 绑定同构）：ctx.get("sessions-control") 拿到的是本面。
 */
export interface PluginControlFace {
  send(input: Omit<SessionSendInput, 'caller'>): Promise<ControlSendReceipt>;
  interrupt(input: Omit<SessionInterruptInput, 'caller'>): Promise<ControlInterruptReceipt>;
  withdraw(input: Omit<SessionWithdrawInput, 'caller'>): Promise<ControlWithdrawReceipt>;
}

/**
 * 逐插件绑定（plugin-boot fork 落位调用）：caller = {kind:'plugin', pluginId}
 * 闭包铸造——插件传入面无 caller 位（传入即被覆写，伪造结构性不存在）。
 */
export function bindControlForPlugin(pluginId: string, face: SessionsControlFace): PluginControlFace {
  return {
    send: (input) => face.send({ ...input, caller: { kind: 'plugin', pluginId } }),
    interrupt: (input) => face.interrupt({ ...input, caller: { kind: 'plugin', pluginId } }),
    withdraw: (input) => face.withdraw({ ...input, caller: { kind: 'plugin', pluginId } }),
  };
}

/** 目标 durable 日志最近 turn/start 事件 seq（expectedTurnId 对拍单源——尾扫；无 turn 返 undefined） */
function lastTurnStartSeq(driver: ConversationDriver): number | undefined {
  const events = driver.session.events();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.type === 'turn/start') return events[i]!.seq;
  }
  return undefined;
}
