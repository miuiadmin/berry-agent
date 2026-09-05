/**
 * snapshotJsonValue / deepFreeze / jsonBytes 单元测试（05 篇 §1.2 步 3）。
 *
 * 执法面红锁：非法载荷族（undefined/function/symbol/bigint/非有限数/类实例/
 * 循环引用）全部 fail-loud SESSION_EVENT_DATA_INVALID——「写入时单遍校验」
 * 是 durable 事件纯 JSON 保证的唯一闸门。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { deepFreeze, jsonBytes, snapshotJsonValue } from './snapshot.js';

/** 断言抛 SESSION_EVENT_DATA_INVALID 且报错可定位到路径 */
function expectDataInvalid(fn: () => unknown, pathFragment: string): void {
  try {
    fn();
    expect.unreachable('非法载荷未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    const coded = err as BaseError;
    expect(coded.code).toBe('SESSION_EVENT_DATA_INVALID');
    expect(coded.message).toContain(pathFragment);
  }
}

describe('snapshotJsonValue 单遍校验 + 快照拷贝', () => {
  it('纯 JSON 值原样通过（快照与原值深相等）', () => {
    const value = { a: 1, b: 'x', c: null, d: true, e: [1, [2, { f: 'g' }]] };
    expect(snapshotJsonValue(value, 'data')).toEqual(value);
  });

  it('undefined 拒绝（顶层与嵌套都拦——展开对象织进未定义字段的最常见病灶）', () => {
    expectDataInvalid(() => snapshotJsonValue(undefined, 'data'), 'data');
    expectDataInvalid(() => snapshotJsonValue({ a: undefined }, 'data'), 'data.a');
    expectDataInvalid(() => snapshotJsonValue([1, undefined], 'data'), 'data[1]');
  });

  it('function / symbol / bigint 拒绝', () => {
    expectDataInvalid(() => snapshotJsonValue({ fn: () => 1 }, 'data'), 'data.fn');
    expectDataInvalid(() => snapshotJsonValue({ s: Symbol('x') }, 'data'), 'data.s');
    expectDataInvalid(() => snapshotJsonValue({ n: 1n }, 'data'), 'data.n');
  });

  it('NaN / Infinity 拒绝（JSON.stringify 会静默变 null——变性不可接受）', () => {
    expectDataInvalid(() => snapshotJsonValue({ v: Number.NaN }, 'data'), 'data.v');
    expectDataInvalid(() => snapshotJsonValue([Number.POSITIVE_INFINITY], 'data'), 'data[0]');
  });

  it('类实例拒绝（Date/Map/Set/自定义类——先转纯 JSON 结构再落账）', () => {
    expectDataInvalid(() => snapshotJsonValue({ at: new Date(0) }, 'data'), 'data.at');
    expectDataInvalid(() => snapshotJsonValue({ m: new Map() }, 'data'), 'data.m');
    class Foo {
      x = 1;
    }
    expectDataInvalid(() => snapshotJsonValue({ foo: new Foo() }, 'data'), 'data.foo');
  });

  it('循环引用拒绝（ancestors 集合检测）', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expectDataInvalid(() => snapshotJsonValue(a, 'data'), '循环引用');
  });

  it('Object.create(null) 原型接受（纯对象语义）', () => {
    const naked = Object.create(null);
    naked.x = 1;
    expect(snapshotJsonValue(naked, 'data')).toEqual({ x: 1 });
  });

  it('快照与原值无引用共享（改原值不影响快照——写入后不可变的地基）', () => {
    const original: { nested: { list: number[]; extra?: unknown } } = { nested: { list: [1, 2] } };
    const snap = snapshotJsonValue(original, 'data') as typeof original;
    original.nested.list.push(3);
    original.nested.extra = true;
    expect(snap.nested.list).toEqual([1, 2]);
    expect(snap.nested.extra).toBeUndefined();
  });

  it('getter 只读一次（双读免疫——校验与拷贝不两次触发副作用）', () => {
    let reads = 0;
    const tricky = {
      get v(): number {
        reads += 1;
        return 42;
      },
    };
    const snap = snapshotJsonValue(tricky, 'data') as { v: number };
    expect(snap.v).toBe(42);
    expect(reads).toBe(1);
  });

  it('报错路径逐级定位（data.items[2].x 形态）', () => {
    expectDataInvalid(() => snapshotJsonValue({ items: [{}, {}, { x: Number.NaN }] }, 'data'), 'data.items[2].x');
  });
});

describe('deepFreeze 深冻结', () => {
  it('递归冻结嵌套对象与数组（写入后任何持有者改不动）', () => {
    const value = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(() => {
      (value.a as Record<string, unknown>).x = 1;
    }).toThrow(TypeError);
    expect(() => {
      (value.a.b as unknown[]).push(3);
    }).toThrow(TypeError);
    expect(() => {
      (value.a.b[1] as Record<string, number>).c = 9;
    }).toThrow(TypeError);
  });

  it('原始值直过（冻结无操作面）', () => {
    expect(deepFreeze(1)).toBe(1);
    expect(deepFreeze('x')).toBe('x');
    expect(deepFreeze(null)).toBe(null);
  });

  it('共享引用不二次遍历（WeakSet 防环——共享子树只冻结一次）', () => {
    const shared: Record<string, unknown> = { k: 1 };
    const value = deepFreeze({ a: shared, b: shared });
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(value.a).toBe(value.b);
  });
});

describe('jsonBytes 体积度量', () => {
  it('UTF-8 真实字节（中英文一致对待）', () => {
    expect(jsonBytes('abc')).toBe(5); // 3 字符 + 2 引号
    expect(jsonBytes('中')).toBe(5); // 3 UTF-8 字节 + 2 引号
    expect(jsonBytes({ a: 1 })).toBe(7); // {"a":1}
  });
});
