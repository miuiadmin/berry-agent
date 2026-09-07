/**
 * 作用域与服务注册表（04 §6「作用域与事件四模式」前半）。
 *
 * 三机制：
 *  - **effect LIFO 回卷**：ctx.effect(() => disposer) 登记可逆副作用，作用域
 *    teardown 按登记逆序回卷全部 disposer——装载了什么就必然能卸干净（痕迹
 *    可清算）。生命周期绑位（进程根/会话/run 三级）由使用方创建，本模块只提供机制。
 *  - **fork 级联**：scope.fork() 派生子作用域——子先于父回卷、父回卷级联全部
 *    未卷子。fork 不是拷贝：provide 面继承（子见父服务）、effect 面独立。
 *  - **stale 护栏**：作用域已回卷后完成的异步腿经 stale 判定收口——迟到的
 *    disposer 不再执行（回卷已过）、迟到的服务注册拒绝（SCOPE_STALE）。
 *  - **总注册帽**：effect 自有登记达 10^4 拒新登记（SCOPE_EFFECT_CAPACITY——
 *    03 §3.4 可用性防线，真源即执法位点）。
 */
import { BaseError } from '../contracts/index.js';

/** disposer 形态：同步或异步清理函数（effect 登记的回卷腿）。返回 void——TS 的 void 返回豁免天然吸收 async 腿（Promise 返回值可赋 void 返回位） */
export type Disposer = () => void;

/**
 * effect 总注册帽（03 §3.4：10^4——可用性防线，失控登记不拖垮回卷序）。
 * 真源即执法位点：自有 disposers 长度即计数，无第二计数位（包装层形否决——
 * 帽下帽双重记账〔03 §3.4 遗漏审计批钉位〕）；fork 面独立同律（子作用域
 * 各有自有帽，级联回卷总量不受限）。导出供测试与文档引用。
 */
export const SCOPE_EFFECT_CAPACITY = 10_000;

/**
 * 作用域：服务注册面（provide/get）+ 可逆注册面（effect）+ fork 树。
 * 生命周期三级（进程根/会话/run）= 三次 createScope/fork 的使用形态。
 */
export class Scope {
  /** 父作用域（fork 派生关系；根作用域为 undefined） */
  private readonly parent?: Scope;
  /** 自有服务注册（fork 面继承 = get 沿父链上溯；子重提供同名 = 遮蔽合法） */
  private readonly services = new Map<string, unknown>();
  /** 已登记 disposer（登记序）——回卷按逆序 LIFO */
  private readonly disposers: Disposer[] = [];
  /** 未回卷的子作用域（父回卷时级联先卷） */
  private readonly children = new Set<Scope>();
  /** 回卷旗标（stale 护栏判据；回卷后一切迟到登记拒） */
  private disposed = false;

  /** @param parent 父作用域（缺省 = 根作用域）；派生走 fork() 不直调本构造器 */
  private constructor(parent?: Scope) {
    this.parent = parent;
  }

  /** 创建根作用域（进程根/会话/run 三级的使用入口之一） */
  static createRoot(): Scope {
    return new Scope(undefined);
  }

  /**
   * 派生子作用域：子先于父回卷（逆序天然）、父回卷级联全部未卷子；
   * provide 面继承（get 上溯）、effect 面独立（子的副作用不污染父的回卷序）。
   */
  fork(): Scope {
    if (this.disposed) throw new BaseError('SCOPE_STALE', '父作用域已回卷——不能再派生子作用域');
    const child = new Scope(this);
    this.children.add(child);
    return child;
  }

  /** 作用域是否已回卷（异步腿竞速收口的 stale 判据） */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * 登记服务（装载期接线、运行期取用）。
   * 同作用域撞名拒 CONTEXT_SERVICE_DUPLICATE（两方抢一名即装配 bug）；
   * 迟到注册（已回卷）拒 SCOPE_STALE。
   */
  provide(name: string, service: unknown): void {
    if (this.disposed) throw new BaseError('SCOPE_STALE', `迟到注册拒：作用域已回卷（${name}）`);
    if (this.services.has(name)) {
      throw new BaseError(
        'CONTEXT_SERVICE_DUPLICATE',
        `服务名 ${name} 在本作用域已被提供（fork 子作用域重提供 = 遮蔽合法，同层撞名 = 装配 bug）`,
      );
    }
    this.services.set(name, service);
  }

  /**
   * 取服务（沿 fork 链上溯——provide 面继承）。
   * 缺席 fail-loud（CONTEXT_SERVICE_MISSING，拼错名立即炸）。
   * 判缺席用沿链 has 而非值判 undefined——已注册的 undefined 值服务不算缺席。
   */
  get<T>(name: string): T {
    let scope: Scope | undefined = this;
    while (scope) {
      if (scope.services.has(name)) return scope.services.get(name) as T;
      scope = scope.parent;
    }
    throw new BaseError('CONTEXT_SERVICE_MISSING', `服务 ${name} 缺席（拼错名/装载序缺口——可选消费用 tryGet）`);
  }

  /** 可选消费（「诚实缺席不 fail-loud」的唯一档——如浏览器引擎缺席） */
  tryGet<T>(name: string): T | undefined {
    // 沿父链上溯：自有无则问父——fork 继承语义
    let scope: Scope | undefined = this;
    while (scope) {
      if (scope.services.has(name)) return scope.services.get(name) as T;
      scope = scope.parent;
    }
    return undefined;
  }

  /**
   * 沿 fork 链枚举可见服务名（自身 + 全部祖先，就近在前）。
   * 03 §3.1「服务目录运行时可枚举」的机制腿——ctx.get 缺席报错附现行名单，
   * 点名错误当场响亮可诊。子遮蔽父同名时两现（就近位次即遮蔽序——诚实枚举）。
   */
  serviceNames(): string[] {
    const names: string[] = [];
    let scope: Scope | undefined = this;
    while (scope) {
      names.push(...scope.services.keys());
      scope = scope.parent;
    }
    return names;
  }

  /**
   * 登记可逆副作用：register 立即执行、其返回的 disposer 进 LIFO 回卷序。
   * 迟到登记（已回卷）拒 SCOPE_STALE——迟到的 disposer 不再执行（回卷已过，
   * 补跑只会撕裂状态）。
   */
  effect(register: () => Disposer): void {
    if (this.disposed) throw new BaseError('SCOPE_STALE', '迟到登记拒：作用域已回卷（disposer 补跑只会撕裂状态）');
    // 总注册帽（03 §3.4 钉 10^4）：拒在 register 回调执行前——超帽受理连副作用都不发生
    if (this.disposers.length >= SCOPE_EFFECT_CAPACITY) {
      throw new BaseError(
        'SCOPE_EFFECT_CAPACITY',
        `effect 总注册帽（${SCOPE_EFFECT_CAPACITY}）已满——本作用域登记数已达上限（失控登记防线，宿主/插件同帽一视）`,
      );
    }
    const disposer = register();
    // register 返回后仍可能已并发回卷——回卷序已定格的 disposer 直接执行收口，
    // 不入序（防撕裂：单独跑一次再丢弃，副作用「必然被清算」承诺保持）
    if (this.disposed) {
      void Promise.resolve(disposer()).catch(() => {
        // 迟到腿的清理失败静默（作用域已亡，无回收面——吞并是唯一不撕裂选择）
      });
      return;
    }
    this.disposers.push(disposer);
  }

  /**
   * 回卷作用域：子先级联回卷 → 自有 disposer 按 LIFO 逆序回卷 → 标记 disposed。
   * 幂等（二次调用直接返回）；disposer 异常不中断回卷（清算是尽力序——
   * 单腿炸不掩护其余腿的清算义务）。
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    // 级联：子先于父回卷（父回卷时把未卷的子全卷）
    for (const child of [...this.children]) {
      await child.dispose();
    }
    this.children.clear();
    if (this.parent) this.parent.children.delete(this);
    // LIFO：后登记的先回卷（登记逆序）
    for (const disposer of this.disposers.reverse()) {
      try {
        await disposer();
      } catch {
        // 单腿回卷失败不中断其余腿清算（尽力序；失败腿无二次重试面）
      }
    }
    this.disposers.length = 0;
  }
}
