/**
 * 事件分派四模式（04 §6「作用域与事件四模式」后半——分派契约）。
 *
 * 四模式（模式是事件契约的一部分）：
 *  - emit：广播——全部监听器各跑各，异常互相隔离（单腿炸不波及他腿与调用方）；
 *  - waterfall：串行管线——监听器必须调 next() 委托、不调即短路（管线后段
 *    不再执行；守门行语义依赖它）；异常沿链传播（管线失败）；
 *  - parallel：全体并发，Promise.all 收口（异常传播）；
 *  - serial：排队串行（不短路，与 waterfall 的区别 = 无委托链）；异常隔离
 *    不停后段（上报后继续）。
 *
 * 词汇纪律：自定义事件名走域名前缀（件/插件域）；未注册词 emit/on 均
 * fail-loud（EVENT_NOT_REGISTERED）、撞名 EVENT_DUPLICATE 拒静默覆盖。
 */
import { BaseError } from '../contracts/index.js';

/**
 * emit / serial / parallel 的监听器形态（通知型——返回值不被广播语义消费）。
 * 返回面 unknown 而非 void：unknown 是 top type 吸收一切同步/异步返回
 * （parallel 复用本面收口时恰需读返回值；void 的「调用方不读」语义反而失真）。
 */
export type NotifyListener<T> = (data: T) => unknown;

/** waterfall 的监听器形态：必须调 next 委托（不调即短路） */
export type WaterfallListener<T> = (value: T, next: (value: T) => Promise<T>) => Promise<T> | T;

/** 监听器异常上报面（emit/serial 的隔离腿去向；host 装配时接 logger） */
export type ListenerErrorReporter = (eventName: string, err: unknown) => void;

/**
 * 事件分派器：词汇注册表 + 四模式派发。一个 ctx 一枚（装载运行时的通信契约
 * 单源——双实现 = 通信割裂）。
 */
export class EventDispatch {
  /** 词汇注册表（name → 已注册标记；单源执法面） */
  private readonly registered = new Set<string>();
  /** 监听器表（name → 注册序监听器列表；on 返回退订闭包；泛型在存储侧擦除为 unknown、取回侧 cast 还原） */
  private readonly listeners = new Map<
    string,
    Array<{ notify?: NotifyListener<unknown>; waterfall?: WaterfallListener<unknown> }>
  >();
  /** serial 排队尾（per-name 链式 promise——排队串行） */
  private readonly serialQueues = new Map<string, Promise<void>>();
  /** 隔离腿异常上报（缺省 stderr 直写；装配根接 logger） */
  private readonly onListenerError: ListenerErrorReporter;

  constructor(options?: { onListenerError?: ListenerErrorReporter }) {
    this.onListenerError =
      options?.onListenerError ??
      ((eventName, err) => {
        // 缺省面：stderr 直写（context 自身的 logger 尚未装配——先有鸡问题）
        console.error(`[context] 事件监听器异常（${eventName}）`, err);
      });
  }

  /** 注册事件词汇（装载期声明面）；撞名拒 EVENT_DUPLICATE（禁静默覆盖） */
  registerEventNames(names: readonly string[]): void {
    for (const name of names) {
      if (this.registered.has(name)) {
        throw new BaseError('EVENT_DUPLICATE', `事件词汇 ${name} 已注册——拒静默覆盖（词汇注册表单源）`);
      }
      this.registered.add(name);
    }
  }

  /** 判别词汇是否已注册（装配断言/诊断面） */
  isRegistered(name: string): boolean {
    return this.registered.has(name);
  }

  /**
   * 挂通知型监听器（emit/serial 共用监听面——同词两模式收同一监听器形态）。
   * 词未注册拒 EVENT_NOT_REGISTERED（fail-loud 禁散播未声明事件名）。
   * @returns 退订闭包（消费方经 scope.effect 组合生命周期）
   */
  on(name: string, listener: NotifyListener<unknown>): () => void {
    this.assertRegistered(name);
    const list = this.listeners.get(name) ?? [];
    const entry = { notify: listener };
    list.push(entry);
    this.listeners.set(name, list);
    return () => {
      const current = this.listeners.get(name);
      if (!current) return;
      const idx = current.indexOf(entry);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  /**
   * 广播：全部监听器并发各跑各，异常互相隔离（单腿炸不波及他腿与调用方——
   * 上报 onListenerError 后照常收口）。
   */
  async emit(name: string, data?: unknown): Promise<void> {
    this.assertRegistered(name);
    const legs = (this.listeners.get(name) ?? []).map((entry) => entry.notify);
    await Promise.all(
      legs.map(async (listener) => {
        try {
          await listener?.(data);
        } catch (err) {
          this.onListenerError(name, err);
        }
      }),
    );
  }

  /**
   * 串行管线：监听器必须调 next(value) 委托——不调即短路（管线后段不再执行，
   * 返回值为该监听器的产出）；异常沿链传播（管线失败语义——守门行依赖）。
   */
  async waterfall<T>(name: string, value: T): Promise<T> {
    this.assertRegistered(name);
    // 存储侧泛型擦除为 unknown——取回 cast 还原为本次调用的 T（注册/派发两侧的
    // 类型对齐由调用方契约保证，这里只做类型往返）
    const chain = (this.listeners.get(name) ?? []).map((entry) => entry.waterfall).filter(Boolean) as Array<
      WaterfallListener<T>
    >;
    // 自尾向头组合：每层 next 即下一段；尾 = 直通（value 原样出管线）
    let next: (v: T) => Promise<T> = (v) => Promise.resolve(v);
    for (const listener of chain.reverse()) {
      const downstream = next;
      next = (v) => Promise.resolve(listener(v, downstream));
    }
    return next(value);
  }

  /** 挂管线监听器（waterfall 专用面——与 on 分开：形态不同防误用） */
  onWaterfall<T>(name: string, listener: WaterfallListener<T>): () => void {
    this.assertRegistered(name);
    const list = this.listeners.get(name) ?? [];
    const entry = { waterfall: listener as WaterfallListener<unknown> };
    list.push(entry);
    this.listeners.set(name, list);
    return () => {
      const current = this.listeners.get(name);
      if (!current) return;
      const idx = current.indexOf(entry);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  /**
   * 全体并发，Promise.all 收口（异常传播——与 emit 的区别即异常语义）。
   * 监听器面与 on 共用（通知型返回值参与收口）。
   */
  async parallel<T, R>(name: string, data: T): Promise<R[]> {
    this.assertRegistered(name);
    const legs = (this.listeners.get(name) ?? []).map((entry) => entry.notify);
    const results = await Promise.all(legs.map((listener) => Promise.resolve(listener ? listener(data) : undefined)));
    // 监听器返回面 unknown（通知型契约）——收口侧由调用方以 R 断言（并发计算型的
    // 类型对齐是调用方契约，存储侧无从静态验证）
    return results as R[];
  }

  /**
   * 排队串行：逐监听器顺序执行（后段等前段完成）；不短路——异常隔离上报后
   * 继续下一段（与 waterfall 的区别 = 无委托链、异常不停段）。
   * 同词多次派发按到达序排队（per-name 链式 promise）。
   */
  serial(name: string, data?: unknown): Promise<void> {
    this.assertRegistered(name);
    const legs = (this.listeners.get(name) ?? []).map((entry) => entry.notify);
    const tail = this.serialQueues.get(name) ?? Promise.resolve();
    const run = tail.then(async () => {
      for (const listener of legs) {
        try {
          await listener?.(data);
        } catch (err) {
          this.onListenerError(name, err);
        }
      }
    });
    // 队尾吞异常（隔离语义：一次派发的失败不堵后续派发的排队）
    this.serialQueues.set(
      name,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /** 未注册词执法（emit/on/waterfall/parallel/serial 共用） */
  private assertRegistered(name: string): void {
    if (!this.registered.has(name)) {
      throw new BaseError(
        'EVENT_NOT_REGISTERED',
        `事件词 ${name} 未注册——fail-loud（词汇注册表单源，先 registerEventNames）`,
      );
    }
  }
}
