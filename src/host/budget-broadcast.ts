/**
 * host/budget-broadcast — 宿主级 budget-extended 广播件（无人值守深化批
 * u-3——04 §5 停靠升格定形注①的码面兑现）。
 *
 * 升格前史：canAfford 恢复 watcher 原是 issue 会话工厂私有（issue-
 * session.ts 内自持 setInterval）。RP2-A 裁决将其升格宿主件——装配根单
 * 真身，三停靠面同播：
 *  - issue 停靠项（issue-session 工厂登记——submit 唤醒消息续跑同会话）；
 *  - goal 停靠项（goal 件登记——enable 挂钟行 + submit 唤醒消息，§12 唤醒
 *    判定链同链）；
 *  - 会话级停靠项（泛化第三类——v1 无生产者，为未来编排位预留，与 issue
 *    面同形）。
 *
 * 电平判语义不变（原 issue watcher 逐字保留）：有停靠项且 canAfford 恢复
 * 即触发——恢复判据覆盖日池翻转与提额两形（canAfford 真身 =
 * stack.llm.canAfford('background')，日池翻新/额度上调都使电平翻真）。
 * 防环不靠边沿靠 driver 三帽：唤醒起跑后若一轮耗尽复停靠，canAfford 已
 * false 自然静默，翻真后三帽内续跑、超帽 wake-refused 由各停靠面自行收口。
 *
 * 词面独立律：本件不自持预算知识——canAfford 窄面注入（装配根接线
 * llm.canAfford('background')，测试注假电平驱动时序）。
 */
/**
 * 停靠登记项（duck type——三停靠面各持编舞）：
 *  - issue 面：wake = 摘登记 + submit 唤醒消息续跑同会话；dispose = resolve
 *    paused（编排层 await 拿到走 retain 分支）；
 *  - goal 面：wake = enable 挂钟行 + submit 唤醒消息（§12 唤醒判定链同链）；
 *    dispose 可无操作（停靠事实 durable——goals 表/挂钟行/会话词全在）。
 */
export interface BudgetBroadcastEntry {
  /** 唤醒起跑（电平判恢复触发——先摘登记再续跑，再停靠时重登记） */
  wake(): void;
  /** 停机收口（宿主 dispose 触发——缺席 = durable 停靠面无操作） */
  dispose?(): void;
}

/** 广播件公开面（装配根注入 issue 工厂/goal 件；dispose 归宿主停机序） */
export interface BudgetBroadcastFace {
  /** 停靠项登记（dispose 后诚实抛——装配序错位防御） */
  register(entry: BudgetBroadcastEntry): void;
  /** 摘登记（wake 先摘/finish 收口/会话侧弃案三消费点） */
  unregister(entry: BudgetBroadcastEntry): void;
  /** 在册停靠项计数（测试观测面 + 电平判前置） */
  size(): number;
  /** 停机收口：清 watcher + 逐项 dispose?.()（幂等） */
  dispose(): void;
}

/** 广播轮询间隔缺省（1s——issue watcher 原值平移；测试注窄值驱动时序） */
const DEFAULT_POLL_MS = 1000;

/** 广播件装配面（装配根注入） */
export interface BudgetBroadcastOptions {
  /** 日池判窄面（真身 = stack.llm.canAfford('background')——04 §5 background 档） */
  readonly canAfford: () => boolean;
  /** 轮询间隔缺省 1000ms（测试注窄值驱动时序） */
  readonly pollMs?: number;
}

/**
 * 宿主级 budget-extended 广播件真身（装配根单真身——issue 工厂/goal 件/
 * 未来会话级编排位共用；issue 工厂注入位缺席时工厂自建私有实例走同一
 * 实现，单源零重复）。
 */
export function createBudgetBroadcast(options: BudgetBroadcastOptions): BudgetBroadcastFace {
  const canAfford = options.canAfford;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  /** 停靠登记表（三面共享——电平判扫描面，进程生命周期） */
  const entries = new Set<BudgetBroadcastEntry>();
  /** 停机已收口旗（dispose 后 register 诚实拒——不静默吞登记） */
  let disposed = false;

  // 电平判 watcher（原 issue 工厂私有 watcher 逐字升格）：有停靠项且
  // canAfford 恢复即逐项唤醒（snapshot 遍历——wake 内自摘登记不扰迭代）
  const watcher = setInterval(() => {
    if (entries.size === 0) return;
    if (!canAfford()) return;
    for (const entry of [...entries]) entry.wake();
  }, pollMs);
  watcher.unref();

  return {
    register(entry) {
      if (disposed) throw new Error('budget-broadcast 已 dispose——停靠项登记不可达（装配序错位防御）');
      entries.add(entry);
    },
    unregister(entry) {
      entries.delete(entry);
    },
    size() {
      return entries.size;
    },
    dispose() {
      if (disposed) return; // 幂等（宿主 closer 双跑无害）
      disposed = true;
      clearInterval(watcher);
      // 逐项停机收口（issue 面的 resolve paused 语义住 entry 自身；goal 面
      // 停靠事实本 durable——goals 表/挂钟行/会话词全在，dispose 可无操作）
      for (const entry of [...entries]) entry.dispose?.();
      entries.clear();
    },
  };
}
