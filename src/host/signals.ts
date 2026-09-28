/**
 * host/signals — 进程编舞（04 §1 信号与退出序；批 12c）。
 *
 * 信号序：SIGINT① → 触发优雅序（04 §1 六步——由调用方注入的 onGraceful
 * 承载：runtime.shutdown 即 ①abort→②closer drain→③flush→④hooks→⑤LIFO）；
 * 优雅窗内 SIGINT② → 立即退 130（第二次按键 = 用户明示放弃优雅）；SIGTERM
 * 同 SIGINT①（serve stop 的进程外管理动词必经 TERM——幂等重入不另起第二套
 * 停机编舞）。崩溃路径：未捕获异常先同步写 crash.log 再退（退 1 执行失败
 * 档）；unhandledRejection 同律处置（裁量钉位：Node 缺省会升格为
 * uncaughtException，显式接住 = fail-loud 且报文带「未处理拒绝」指向根因）。
 *
 * 全注入可测：信号注册（register）/ 终局（exit）均注——测试位收调用序，
 * main 装配位接 process.on/process.exit。
 */

/** 信号编舞选项 */
export interface SignalChoreographyOptions {
  /** 优雅序承载（SIGINT①/SIGTERM 触发；返回值 = 帽到时的终局退出码，void = 0） */
  readonly onGraceful: () => Promise<number | void>;
  /**
   * 主序收场码共享位（第十五役 α2——让位终局）：优雅序完成后有界等待此
   * promise，主序先收场即用其码终局（**终局退码单源 = 命令收场码**，07 §5
   * 三态——被中断 run 的 aborted→1 不被信号序吞成 0）；帽到仍未收场 = 主序
   * 长驻形（serve——dispatchCli 恒不返），用 onGraceful 返回码终局（被停
   * 非失败，0 语义保留）。缺席 = 旧形（优雅码直终局——编舞独立装配的
   * 缩形测试/子进程形）。
   */
  readonly mainSettled?: Promise<number>;
  /** 让位帽 ms（缺省 1000——serve 停机多等 1s 可吸收；测试可调小） */
  readonly mainYieldMs?: number;
  /** 终局动作（缺省 process.exit；测试注收集） */
  readonly exit?: (code: number) => void;
  /** 信号注册面（缺省 process.on；测试注收集） */
  readonly register?: (signal: NodeJS.Signals, listener: () => void) => void;
}

/**
 * 装配信号编舞（main 装配位调用一次）。
 *
 * 状态机：quiet →（SIGINT①/SIGTERM）→ draining →（SIGINT②）→ 立即 130。
 * SIGTERM 在 draining 态幂等直返（优雅序只起一次）；SIGINT② 只认 draining
 * 态的第二次按键。
 */
export function installSignalChoreography(options: SignalChoreographyOptions): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const register = options.register ?? ((signal, listener) => process.on(signal, listener));
  let draining = false; // 优雅序在飞位（SIGTERM 幂等 / SIGINT② 判据）
  let terminated = false; // 终局幂等位（镜像 process.exit——已退则迟到链不再终局）
  const finish = (code: number): void => {
    if (terminated) return;
    terminated = true;
    exit(code);
  };
  // 优雅码 → 终局（让位终局形：mainSettled 在场时有界等主序收场码）
  const settle = async (code: number | void): Promise<void> => {
    if (options.mainSettled === undefined) {
      finish(code ?? 0); // 旧形：优雅码直终局（缩形装配无主序）
      return;
    }
    // 主序与信号序同享 shutdown 收口后（α1 共享柄），主序链毫秒级到达
    // 收场码；帽到 = serve 长驻形（被停非失败——优雅码终局）。计时器
    // unref 不阻进程退出。
    const settled = await Promise.race([
      options.mainSettled,
      new Promise<number>((resolve) => {
        const timer = setTimeout(() => resolve(code ?? 0), options.mainYieldMs ?? 1000);
        timer.unref?.();
      }),
    ]);
    finish(settled);
  };

  register('SIGINT', () => {
    if (!draining) {
      draining = true;
      void options
        .onGraceful()
        .then(settle)
        .catch(() => finish(1)); // 优雅序自身抛错 = 执行失败档收场
      return;
    }
    finish(130); // 第二次按键——明示放弃优雅，立即退
  });

  register('SIGTERM', () => {
    if (draining) return; // 已在优雅序——幂等直返（不另起第二套停机）
    draining = true;
    void options
      .onGraceful()
      .then(settle)
      .catch(() => finish(1));
  });
}

/** 崩溃编舞选项 */
export interface CrashChoreographyOptions {
  /** 崩溃取证（同步写——runtime.writeCrashLog 或等价直写；memory 形跳过语义归其内） */
  readonly writeCrashLog: (error: unknown) => void;
  /** 终局动作（缺省 process.exit） */
  readonly exit?: (code: number) => void;
  /** 事件注册面（缺省 process.on；测试注收集） */
  readonly register?: (event: 'uncaughtException' | 'unhandledRejection', listener: (error: unknown) => void) => void;
}

/**
 * 装配崩溃编舞：未捕获异常/未处理拒绝 → 先同步写 crash.log 再退 1。
 *
 * 取证写失败不再拦退（崩溃路径唯一允许的静默归 writeCrashLog 实现侧）；
 * 退码 1 = 执行失败档（04 §1 退出序不预设崩溃退码，07 §5 三态归档裁量）。
 */
export function installCrashChoreography(options: CrashChoreographyOptions): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const register = options.register ?? ((event, listener) => process.on(event, listener));

  const handle = (error: unknown): void => {
    options.writeCrashLog(error); // 同步先写（进程生命周期取证）
    exit(1);
  };
  register('uncaughtException', handle);
  register('unhandledRejection', (reason: unknown) =>
    handle(reason instanceof Error ? reason : new Error(`未处理拒绝：${String(reason)}`)),
  );
}
