import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { Scope, SCOPE_EFFECT_CAPACITY } from './scope.js';

describe('effect LIFO 回卷', () => {
  it('登记逆序回卷（后登记的先回卷）', async () => {
    const order: number[] = [];
    const scope = Scope.createRoot();
    scope.effect(() => () => order.push(1));
    scope.effect(() => () => order.push(2));
    scope.effect(() => () => order.push(3));
    await scope.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  it('异步 disposer 逐腿 await 收口', async () => {
    const order: string[] = [];
    const scope = Scope.createRoot();
    scope.effect(() => async () => {
      await Promise.resolve();
      order.push('slow-1');
    });
    scope.effect(() => () => order.push('fast-2'));
    await scope.dispose();
    // LIFO：fast-2 先入序（同步腿也走 await 链），slow-1 的 await 不乱序
    expect(order).toEqual(['fast-2', 'slow-1']);
  });

  it('回卷幂等（二次 dispose 直接返回）', async () => {
    const scope = Scope.createRoot();
    let count = 0;
    scope.effect(() => () => count++);
    await scope.dispose();
    await scope.dispose();
    expect(count).toBe(1);
  });

  it('单腿回卷异常不中断其余腿清算（尽力序）', async () => {
    const order: number[] = [];
    const scope = Scope.createRoot();
    scope.effect(() => () => order.push(1));
    scope.effect(() => () => {
      throw new Error('炸腿');
    });
    scope.effect(() => () => order.push(3));
    await scope.dispose();
    expect(order).toEqual([3, 1]);
  });
});

describe('fork 级联', () => {
  it('子先于父回卷（父回卷级联全部未卷子）', async () => {
    const order: string[] = [];
    const parent = Scope.createRoot();
    parent.effect(() => () => order.push('parent'));
    const child = parent.fork();
    child.effect(() => () => order.push('child'));
    await parent.dispose();
    expect(order).toEqual(['child', 'parent']);
  });

  it('子自行回卷后父回卷不重复卷（已摘除）', async () => {
    let childDisposals = 0;
    const parent = Scope.createRoot();
    const child = parent.fork();
    child.effect(() => () => childDisposals++);
    await child.dispose();
    await parent.dispose();
    expect(childDisposals).toBe(1);
  });

  it('provide 面继承（子见父服务）、effect 面独立（子副作用不进父回卷序）', async () => {
    const parent = Scope.createRoot();
    parent.provide('svc', { value: 42 });
    let childEffectRan = false;
    const child = parent.fork();
    child.effect(() => () => (childEffectRan = true));
    await child.dispose();
    expect(childEffectRan).toBe(true); // 子的 disposer 在子回卷时已跑
    expect(parent.tryGet('svc')).toEqual({ value: 42 }); // 父服务仍在
    expect(child.tryGet('svc')).toEqual({ value: 42 }); // 子回卷后仍可读继承面（读面不设限）
  });

  it('子作用域重提供同名 = 遮蔽合法（局部覆盖，父面不变）', () => {
    const parent = Scope.createRoot();
    parent.provide('svc', '父值');
    const child = parent.fork();
    child.provide('svc', '子值');
    expect(child.get<string>('svc')).toBe('子值');
    expect(parent.get<string>('svc')).toBe('父值');
  });

  it('已回卷父作用域拒派生（SCOPE_STALE）', async () => {
    const parent = Scope.createRoot();
    await parent.dispose();
    expect(() => parent.fork()).toThrowError(BaseError);
    try {
      parent.fork();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('SCOPE_STALE');
        return;
      }
    }
    expect.unreachable();
  });
});

describe('stale 护栏', () => {
  it('迟到的服务注册拒（SCOPE_STALE）', async () => {
    const scope = Scope.createRoot();
    await scope.dispose();
    expect(() => scope.provide('late', {})).toThrowError(BaseError);
  });

  it('迟到的 effect 登记拒（SCOPE_STALE）', async () => {
    const scope = Scope.createRoot();
    await scope.dispose();
    expect(() => scope.effect(() => () => undefined)).toThrowError(BaseError);
  });

  it('登记与回卷并发竞速：register 返回后才发现已回卷的 disposer 单独收口不入序', async () => {
    const scope = Scope.createRoot();
    const ran: string[] = [];
    // 模拟：effect 的 register 回调执行期间作用域被并发回卷
    scope.effect(() => {
      // register 体内触发并发回卷（真实竞速的同步等价形）
      void scope.dispose();
      return () => ran.push('raced');
    });
    await scope.dispose();
    // 迟到 disposer 已单独执行收口（「必然被清算」承诺保持），不在回卷序里重复
    expect(ran).toEqual(['raced']);
  });
});

describe('effect 总注册帽（SCOPE_EFFECT_CAPACITY——03 §3.4 可用性防线）', () => {
  it('第 10^4 件可登记，第 10^4+1 件拒（拒在 register 回调执行前——副作用不发生）', () => {
    const scope = Scope.createRoot();
    let ran = 0;
    for (let i = 0; i < SCOPE_EFFECT_CAPACITY; i++) {
      scope.effect(() => () => ran++);
    }
    // 超帽受理：register 回调不执行（side effect 零发生），disposer 不入序
    let registerCalled = false;
    try {
      scope.effect(() => {
        registerCalled = true;
        return () => ran++;
      });
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('SCOPE_EFFECT_CAPACITY');
        expect(registerCalled).toBe(false); // 拒在回调执行前
        expect(ran).toBe(0); // 尚未回卷——零 disposer 执行
        return;
      }
    }
    expect.unreachable();
  });

  it('帽满不破既有清算义务：既有 10^4 件回卷照常', async () => {
    const scope = Scope.createRoot();
    let disposed = 0;
    for (let i = 0; i < SCOPE_EFFECT_CAPACITY; i++) {
      scope.effect(() => () => disposed++);
    }
    expect(() => scope.effect(() => () => disposed++)).toThrowError(BaseError);
    await scope.dispose();
    expect(disposed).toBe(SCOPE_EFFECT_CAPACITY); // 帽拒不缩水已登记面
  });

  it('fork 面独立同律：子作用域各有自有帽（父满不碍子登记）', () => {
    const parent = Scope.createRoot();
    for (let i = 0; i < SCOPE_EFFECT_CAPACITY; i++) {
      parent.effect(() => () => undefined);
    }
    const child = parent.fork();
    expect(() => child.effect(() => () => undefined)).not.toThrow(); // 子自有计数从零起
    expect(() => parent.effect(() => () => undefined)).toThrowError(BaseError); // 父仍满
  });
});

describe('provide/get 服务注册面', () => {
  it('get 缺席 fail-loud（CONTEXT_SERVICE_MISSING）', () => {
    const scope = Scope.createRoot();
    try {
      scope.get('no-such-service');
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('CONTEXT_SERVICE_MISSING');
        expect(err.message).toContain('no-such-service');
        return;
      }
    }
    expect.unreachable();
  });

  it('tryGet 缺席返回 undefined（诚实缺席档）', () => {
    const scope = Scope.createRoot();
    expect(scope.tryGet('no-such-service')).toBeUndefined();
  });

  it('同作用域撞名拒（CONTEXT_SERVICE_DUPLICATE）', () => {
    const scope = Scope.createRoot();
    scope.provide('svc', 1);
    expect(() => scope.provide('svc', 2)).toThrowError(BaseError);
    try {
      scope.provide('svc', 2);
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('CONTEXT_SERVICE_DUPLICATE');
        return;
      }
    }
    expect.unreachable();
  });

  it('已注册的 undefined 值服务不算缺席（has 判非值判）', () => {
    const scope = Scope.createRoot();
    scope.provide('void-svc', undefined);
    expect(scope.get('void-svc')).toBeUndefined();
    expect(scope.tryGet('void-svc')).toBeUndefined(); // has 真——undefined 是值不是缺席
  });
});
