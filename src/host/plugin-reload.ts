/**
 * host/plugin-reload — /reload 排队编舞件（03 §5.7——热重载的编舞与失败三档）。
 *
 * 职责 = 把「重跑装载」变成一条**可排队、可串行、失败分档**的编舞：
 *  - **busy 判据** = 任一 run 在飞（03 §5.7「会话运行中」——单对话本体）；
 *    busy 期 /reload 进 **pending 单槽**——连发并槽 coalesce（reload 读盘为
 *    准、无请求参数，「最后态」即当前盘面，单槽布尔即完备表达）；
 *  - **run 收场即执行**：onRunSettled 订阅驱动终态边界（04 §2 三值——settled
 *    即非 busy 判定点），pending 在场且此刻不 busy → 出槽入链；
 *  - **失败三档**（由轻到重，03 §5.7）：
 *    ① 启用清单校验失败 = **拒换**——preflight 前置于一切回卷（旧装载态
 *    原封不动继续跑，报告行级错误与修复指引）；
 *    ② 行级装载失败 = **换入 + 报告**——bootPlugins 行级隔离降级内置
 *    （boot-failures.json 点名 + warn 横幅 + failed 面汇总），本件只回执
 *    汇总计数，不重复执法；
 *    ③ disposer 回卷失败 = **降级存活**——回卷抛错不阻断换入（宿主进程
 *    不死），聚合报告回卷失败清单，旧代残迹随下一轮全量重载收口；
 *  - **reloadChain 串行**：in-flight promise 链——并发 /reload 恒串行不
 *    交错（链尾吞错自愈，后续请求不受前次失败连坐）。
 *
 * 换入语义边界（本件不执法、由闭包真身承载）：reapply 成功 = 装配根重跑
 * bootPlugins 并把新代句柄写回闭包晚绑定位（boot 取值器/换代槽/skills 层
 * 重同步随 reapply 闭包内完成——assembly 接线位见彼处注释）。
 *
 * 救援环律（07 §5 --no-plugins 条款）：「/reload 读盘不受旗标影响」——
 * reapply 闭包在装配侧以 noPlugins: false 形构造（旗标只管启动期短路，
 * 人面显式 reload 即显式装载请求），本件零旗标知识。
 */
/** 编舞注入面（全部闭包真身——本件零 db/fs/驱动知识，词面独立律） */
/** 回卷回执（档③聚合报告的数据源——回卷失败清单来自旧代 unload 结果） */
export interface RollbackReceipt {
  /** 回卷成功的插件 id 清单 */
  readonly disposed: readonly string[];
  /** 回卷失败的插件 id 清单（档③——降级存活，残迹随下轮重载收口） */
  readonly failed: readonly string[];
}

/** 换入回执（reapply 闭包的产物面——计数口径 = PluginBootHandle.counts） */
export interface ReapplyReceipt {
  readonly total: number;
  readonly enabled: number;
  readonly failed: number;
  /** 行级失败面点名（档②汇总——boot-failures.json 已由 bootPlugins 记账） */
  readonly failedIds: readonly string[];
}

/** 编舞注入面（全部闭包真身——本件零 db/fs/驱动知识，词面独立律） */
export interface PluginReloadOptions {
  /**
   * 预检（档①执法位）：enabled.yaml 读侧 + 行校验——抛错即拒换（旧装载态
   * 原封不动）。真源 = readEnabledRows 同一函数（单源——预检与装载读侧
   * 恒一致，不存在「预检过装载拒」的第二判据）。
   */
  readonly preflight: () => void;
  /** 回卷旧代（换入前置）——抛错档③降级存活（不阻断换入），回执供聚合报告 */
  readonly rollback: () => Promise<RollbackReceipt>;
  /** 换入新代（重跑装载 + 装配根换代写回）——抛错 = 降级存活报告 */
  readonly reapply: () => Promise<ReapplyReceipt>;
  /** busy 判据（任一 run 在飞——manager 级聚合读面） */
  readonly isBusy: () => boolean;
  /** run 终态订阅（收场即执行 pending——返回摘除器） */
  readonly onRunSettled: (handler: () => void) => () => void;
  /** 人面回执（notify 扇出——归因字面 'reload'） */
  readonly report: (text: string) => void;
  /** 警示面（缺省 stderr 直写） */
  readonly warn?: (message: string) => void;
}

/** 编舞器面（TUI 命令 handler 与测试消费） */
export interface PluginReloader {
  /** /reload 请求（busy 排队 / idle 直接入链；fire-and-forget——回执走 report） */
  request(): void;
  /** pending 在场查询（「已排队」呈现判据） */
  hasPending(): boolean;
  /** 链尾等待面（测试/收口用——resolved 即链空且无 pending） */
  settle(): Promise<void>;
}

/**
 * 组装 /reload 编舞器。订阅生命周期：onRunSettled 订阅随编舞器终身（进程
 * 级单例——TUI 入口构造一次；不设 dispose 面，进程退出即回收）。
 */
export function createPluginReloader(options: PluginReloadOptions): PluginReloader {
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));
  /** pending 单槽（coalesce 判据位——true = busy 期有请求待执行） */
  let pending = false;
  /** reloadChain（in-flight promise 链尾——串行执法位） */
  let chain: Promise<void> = Promise.resolve();

  /** 单次重载编舞（失败三档执法序：①preflight → ③rollback → ②reapply） */
  const runOnce = async (): Promise<void> => {
    // ① 清单校验失败 = 拒换——旧装载态原封不动（回卷零调用）
    try {
      options.preflight();
    } catch (err) {
      options.report(
        `重载已拒（启用清单校验失败——旧装载态继续运行）：${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    // ③ 回卷旧代——失败降级存活：聚合报告后继续换入（残迹随下轮重载收口）
    let rollbackFailedIds: readonly string[] = [];
    try {
      const receipt = await options.rollback();
      rollbackFailedIds = receipt.failed;
      if (receipt.failed.length > 0) {
        warn(`插件回卷部分失败（${receipt.failed.join('、')}）——残迹随下一轮重载收口`);
      }
    } catch (err) {
      warn(`插件回卷失败（降级存活，继续换入）：${err instanceof Error ? err.message : String(err)}`);
      rollbackFailedIds = ['<rollback>'];
    }
    // ② 换入新代——行级失败已由装载序内置隔离（boot-failures 记账 + 横幅），
    //    本层只回执汇总；抛错（core: fail-loud 等罕见尾路径）= 降级存活报告
    try {
      const receipt = await options.reapply();
      const lines = [`插件已重载：启用 ${receipt.enabled}/${receipt.total}`];
      if (receipt.failedIds.length > 0) {
        lines.push(`行级失败（隔离降级，已记 boot-failures）：${receipt.failedIds.join('、')}`);
      }
      if (rollbackFailedIds.length > 0) {
        lines.push(`上代回卷残留（下轮重载收口）：${rollbackFailedIds.join('、')}`);
      }
      options.report(lines.join('\n'));
    } catch (err) {
      options.report(
        `重载失败（旧装载面已回卷、新代未立）：${err instanceof Error ? err.message : String(err)}——修复后可再 /reload；仍失败可用 --no-plugins 启动排查`,
      );
    }
  };

  /** 入链（串行执法——链尾吞错自愈，后续请求不受前次失败连坐） */
  const enqueue = (): void => {
    chain = chain.then(runOnce).catch((err: unknown) => {
      // runOnce 内部已分档吞错，此处是防御性兜底（编舞自身异常不反噬链）
      warn(`/reload 编舞异常：${err instanceof Error ? err.message : String(err)}`);
    });
  };

  // run 收场即执行：pending 在场且此刻不 busy → 出槽入链（settled 边界后
  // 仍 busy = 多会话交错——保持排队等下一个终态边界）
  options.onRunSettled(() => {
    if (pending && !options.isBusy()) {
      pending = false;
      enqueue();
    }
  });

  return {
    request: () => {
      if (options.isBusy()) {
        // busy 期并槽 coalesce——连发只跑最后态（读盘为准，单槽即完备）
        if (!pending) options.report('会话运行中——/reload 已排队，本轮收场后执行');
        pending = true;
        return;
      }
      enqueue();
    },
    hasPending: () => pending,
    settle: () => chain,
  };
}

/** RollbackReceipt 构造速记（rollback 闭包真身侧使用——空代 no-op 形） */
export function emptyRollbackReceipt(): RollbackReceipt {
  return { disposed: [], failed: [] };
}

/** LoadReport.unload 回执 → RollbackReceipt 适配（failed 对象面 → id 清单——呈现形） */
export function rollbackFromReport(receipt: {
  readonly disposed: readonly string[];
  readonly failed: readonly { readonly id: string; readonly error: unknown }[];
}): RollbackReceipt {
  return { disposed: receipt.disposed, failed: receipt.failed.map((f) => f.id) };
}
