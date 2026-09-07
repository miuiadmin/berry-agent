/**
 * host/triggers 注册表测试（03 §2.2 行 108 第十一动词 + §2.7 冲突律 + §4.6 开门制；
 * C 批 C-2 注册面笔）。
 *
 * 纯逻辑件——getOpens/makeStarter 双闭包注入替身（starter 真身随 C-3 装配批
 * 接线，本件只锁注册面语义：三闸执法序/一次性交接/回滚与注销器守卫）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { TriggerRegistry } from './triggers.js';
import type { TriggerDef, TriggerStarter } from './triggers.js';
// 错误码册注册腿（「import 发生才注册」——TRIGGER_ 两码断言的前置副作用）
import './codes.js';

/** 测试装配：可变开门集（活体读取源语义——测试直接 mutate 造 /reload 收门）+ starter 工厂记录仪 */
function assemble(initialOpens?: readonly string[]) {
  const opens = new Set(initialOpens ?? []);
  const factoryCalls: Array<{ pluginId: string; name: string }> = [];
  const starterSpecs: unknown[] = [];
  const firedStarters: TriggerStarter[] = [];
  const registry = new TriggerRegistry({
    getOpens: () => opens, // 全插件同源（本件测试域——分插件读取属装配面）
    makeStarter: (pluginId, name) => {
      factoryCalls.push({ pluginId, name });
      return (spec) => {
        starterSpecs.push(spec);
      };
    },
  });
  return { registry, opens, factoryCalls, starterSpecs, firedStarters };
}

/** def 构造辅助（fire 缺省记录收到的 starter——一次性交接断言面） */
function defOf(name: string, firedStarters: TriggerStarter[], fire?: TriggerDef['fire']): TriggerDef {
  return {
    name,
    description: '测试触发器',
    ...(fire !== undefined ? { fire } : { fire: (starter) => firedStarters.push(starter) }),
  };
}

/** BaseError 码断言辅助（错码即契约——修 bug 必带回归锁的判据面） */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable();
  } catch (err) {
    if (err instanceof BaseError) {
      expect(err.code).toBe(code);
      return;
    }
    throw err;
  }
}

describe('触发器注册表（triggers——03 §2.2 行 108/§2.7/§4.6）', () => {
  it('合法注册：落册 + makeStarter 以 (pluginId, name) 造 starter + def.fire 一次性交接', () => {
    const t = assemble(['triggers.start-run']);
    t.registry.register('acme', defOf('acme/daily-digest', t.firedStarters));
    expect(t.registry.list()).toEqual([{ name: 'acme/daily-digest', owner: 'acme', description: '测试触发器' }]);
    expect(t.factoryCalls).toEqual([{ pluginId: 'acme', name: 'acme/daily-digest' }]);
    expect(t.firedStarters).toHaveLength(1); // 一次性注入（重装载经重注册再注入）
  });

  it('门关拒：opens 缺位 → PLUGIN_CAPABILITY_DOOR_CLOSED（message 指路 opens 写法）', () => {
    const t = assemble();
    try {
      t.registry.register('acme', defOf('acme/x', t.firedStarters));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      const e = err as BaseError;
      expect(e.code).toBe('PLUGIN_CAPABILITY_DOOR_CLOSED');
      expect(e.message).toContain('opens');
      expect(e.message).toContain('acme'); // 归因插件位
    }
    expect(t.registry.list()).toEqual([]); // 拒绝零记账
  });

  it('core: 官方件直开豁免（装配即用户意图——03 §4.6 勘补判据；域前缀去 core: 前缀比对）', () => {
    const t = assemble(); // 全默认关
    t.registry.register('core:issue', defOf('issue/scan', t.firedStarters));
    expect(t.registry.list().map((entry) => entry.owner)).toEqual(['core:issue']);
  });

  it('执法序锁：门检前置撞名（收门后撞名重注红的是门关码非撞名码）', () => {
    const t = assemble(['triggers.start-run']);
    t.registry.register('acme', defOf('acme/x', t.firedStarters));
    t.opens.clear(); // 模拟 /reload 撤位（活体读取源——同一次册内现判现拒）
    expectCode(() => t.registry.register('acme', defOf('acme/x', t.firedStarters)), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
  });

  it('撞名拒：TRIGGER_NAME_EXISTS（message 含在册方——core: 域与生态域同册互斥）', () => {
    const t = assemble(['triggers.start-run']);
    t.registry.register('core:issue', defOf('issue/scan', t.firedStarters));
    // 生态插件 issue 与官方件 core:issue 域前缀同形（都归一 issue）——同册撞名互斥
    expectCode(() => t.registry.register('issue', defOf('issue/scan', t.firedStarters)), 'TRIGGER_NAME_EXISTS');
  });

  it('名词法拒：TRIGGER_NAME_INVALID（无 // 双 /、段空、大写、域前缀 ≠ 插件 id 各红）', () => {
    const t = assemble(['triggers.start-run']);
    expectCode(() => t.registry.register('acme', defOf('裸名', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('acme/a/b', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('acme/', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('Acme/x', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('acme/x_y', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('other/x', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('core:issue', defOf('other/x', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expect(t.registry.list()).toEqual([]); // 全拒零记账
  });

  it('fire 抛错回滚：注册未完成——在册面回滚 + 错误透传（零半注册残留）', () => {
    const t = assemble(['triggers.start-run']);
    const boom = new Error('事件源接入失败');
    expect(() =>
      t.registry.register(
        'acme',
        defOf('acme/x', t.firedStarters, () => {
          throw boom;
        }),
      ),
    ).toThrow(boom);
    expect(t.registry.list()).toEqual([]);
    expect(() => t.registry.register('acme', defOf('acme/x', t.firedStarters))).not.toThrow(); // 名可再注
  });

  it('注销器：摘本人条目 + 双调幂等 + 旧注销器不误摘接任者', () => {
    const t = assemble(['triggers.start-run']);
    const offA = t.registry.register('acme', defOf('acme/x', t.firedStarters));
    offA();
    offA(); // 幂等
    expect(t.registry.list()).toEqual([]);
    const offFirst = t.registry.register('acme', defOf('acme/x', t.firedStarters)); // 重注接任
    void offFirst;
    offA(); // 旧注销器不误摘接任者（过期时序守卫）
    expect(t.registry.list()).toHaveLength(1);
  });
});
