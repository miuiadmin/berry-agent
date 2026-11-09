import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { PromptSectionRegistry } from './prompt-sections.js';
// 错误码册注册腿（「import 发生才注册」——码在册断言的前置副作用）
import './codes.js';

/** 码断言助手（同 plugin-context.test 惯例——BaseError 形直断 code） */
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

describe('提示词段注册表节区稳定性纪律（03 §2.5——cache 经济批 ca-2）', () => {
  it('两段律物化：稳定段先（组内字典序）、volatile 段恒居尾（组内字典序）', () => {
    const registry = new PromptSectionRegistry();
    registry.register('widgets/gamma', 'widgets', () => 'G');
    registry.register('widgets/beta', 'widgets', () => 'B', { volatile: { reason: '时间戳类' } });
    registry.register('widgets/alpha', 'widgets', () => 'A');
    registry.register('widgets/delta', 'widgets', () => 'D', { volatile: { reason: '计数类' } });
    // 字典序全序 = alpha, beta, delta, gamma——两段律下稳定段（alpha/gamma）
    // 先、volatile 段（beta/delta）恒段区尾（最小前缀破坏位）
    expect(registry.materialize()).toBe('A\n\nG\n\nB\n\nD');
  });

  it('承诺稳定段漂移恰 warn 一次：首物化立基线、漂移上报后基线取新值', () => {
    const drifts: { slot: string; owner: string }[] = [];
    const registry = new PromptSectionRegistry({ onDrift: (info) => drifts.push(info) });
    let text = '初版';
    registry.register('widgets/hints', 'widgets', () => text);
    registry.materialize(); // 首物化 = 立基线（不落 warn）
    expect(drifts).toHaveLength(0);
    registry.materialize(); // 内容未变 = 零上报
    expect(drifts).toHaveLength(0);
    text = '漂移版';
    registry.materialize(); // 基线不符 = 上报（fail-open：不拒不炸）
    expect(drifts).toEqual([{ slot: 'widgets/hints', owner: 'widgets' }]);
    registry.materialize(); // 同一漂移不重复上报（基线已取新值）
    expect(drifts).toHaveLength(1);
  });

  it('volatile 段免漂移 warn（已声明即诚实）；零观测面（onDrift 缺席）零上报', () => {
    const drifts: { slot: string; owner: string }[] = [];
    const registry = new PromptSectionRegistry({ onDrift: (info) => drifts.push(info) });
    let text = 'v1';
    registry.register('widgets/clock', 'widgets', () => text, { volatile: { reason: '时间戳类' } });
    registry.materialize();
    text = 'v2';
    registry.materialize(); // volatile 声明在册 = 跨请求可变诚实化，免检免 warn
    expect(drifts).toHaveLength(0);
    // 零观测面：onDrift 缺席连 hash 也省（lib 缺省零开销——行为面 = 永不上报）
    const bare = new PromptSectionRegistry();
    let bareText = 'a';
    bare.register('widgets/x', 'widgets', () => bareText);
    bare.materialize();
    bareText = 'b';
    expect(bare.materialize()).toBe('b');
  });

  it('注册集变更清基线：装卸后再物化重立不落 warn（装载面真变更非漂移）', () => {
    const drifts: { slot: string; owner: string }[] = [];
    const registry = new PromptSectionRegistry({ onDrift: (info) => drifts.push(info) });
    let text = '初版';
    const offHint = registry.register('widgets/hints', 'widgets', () => text);
    const offOther = registry.register('widgets/other', 'widgets', () => '恒定');
    registry.materialize(); // 立基线
    text = '漂移版';
    // 注销他段 = 注册集变更 → 清基线（hints 内容虽变，下次物化重立不落 warn）
    offOther();
    registry.materialize();
    expect(drifts).toHaveLength(0);
    // 对照：注册集不再变时同一漂移照报（漂移检测本体仍在执法）
    text = '再漂移';
    registry.materialize();
    expect(drifts).toEqual([{ slot: 'widgets/hints', owner: 'widgets' }]);
    // 注册新段同样清基线（装卸双路对称）
    text = '三漂移';
    registry.register('widgets/new', 'widgets', () => '新段');
    registry.materialize();
    expect(drifts).toHaveLength(1);
    offHint();
  });

  it('volatile reason 空串/缺字符串值拒（PLUGIN_PROMPT_SLOT_INVALID 码分流）', () => {
    const registry = new PromptSectionRegistry();
    expectCode(
      () => registry.register('widgets/x', 'widgets', () => '', { volatile: { reason: '' } }),
      'PLUGIN_PROMPT_SLOT_INVALID',
    );
    expectCode(
      () =>
        registry.register('widgets/x', 'widgets', () => '', {
          volatile: { reason: undefined as unknown as string },
        }),
      'PLUGIN_PROMPT_SLOT_INVALID',
    );
    // 合法 reason 照常入册（同 slot 前两拒未占位——拒绝式注册零残留）
    expect(() =>
      registry.register('widgets/x', 'widgets', () => 'V', { volatile: { reason: '时间戳类' } }),
    ).not.toThrow();
    expect(registry.materialize()).toBe('V');
  });

  it('sessionId 透传 builder（每会话懒冻结类段消费）；缺席形透传 undefined', () => {
    const registry = new PromptSectionRegistry();
    const received: Array<string | undefined> = [];
    registry.register('widgets/per-session', 'widgets', (sessionId) => {
      received.push(sessionId);
      return sessionId ?? '缺席';
    });
    expect(registry.materialize('s1')).toBe('s1');
    expect(registry.materialize()).toBe('缺席');
    expect(received).toEqual(['s1', undefined]);
  });
});

describe('prompts_change 观测面（03 §2.4 生命周期组——2026-09-17 sweep 清账）', () => {
  it('注册成功/真注销各恰触发一次；回调内 slotList() 快照新鲜（载荷真源）', () => {
    const snapshots: string[][] = [];
    const registry = new PromptSectionRegistry({
      onSectionsChange: () => snapshots.push([...registry.slotList()]),
    });
    const offHint = registry.register('widgets/hints', 'widgets', () => 'H');
    registry.register('widgets/other', 'widgets', () => 'O');
    // 每次注册后到、快照含新段（观测回调读现行清单 = §2.4 载荷真源）
    expect(snapshots).toEqual([['widgets/hints'], ['widgets/hints', 'widgets/other']]);
    offHint();
    expect(snapshots).toHaveLength(3);
    expect(snapshots[2]).toEqual(['widgets/other']);
  });

  it('拒绝式注册不触发（撞位/形状拒零观测）；幂等注销（非本主残留）不触发', () => {
    const snapshots: string[][] = [];
    const registry = new PromptSectionRegistry({
      onSectionsChange: () => snapshots.push([...registry.slotList()]),
    });
    const off = registry.register('widgets/x', 'widgets', () => 'X');
    expect(snapshots).toHaveLength(1);
    // 撞位拒 + slot 形状拒：注册面拒绝零残留 → 零观测
    expectCode(() => registry.register('widgets/x', 'widgets', () => 'Y'), 'PLUGIN_PROMPT_SECTION_CONFLICT');
    expectCode(() => registry.register('badslot', 'widgets', () => 'Z'), 'PLUGIN_PROMPT_SLOT_INVALID');
    expect(snapshots).toHaveLength(1);
    off();
    off(); // 幂等注销：条目已摘（非本主）零触发
    expect(snapshots).toHaveLength(2);
  });
});

describe('宿主位注册 registerHost（03 §2.5 A4——CLI/SDK 进化批 2026-11-09）', () => {
  it('单段 slot 受理：owner 恒 host、入册入序、onSectionsChange 触发', () => {
    const snapshots: string[][] = [];
    const registry = new PromptSectionRegistry({
      onSectionsChange: () => snapshots.push([...registry.slotList()]),
    });
    const off = registry.registerHost('project', () => '项目指令');
    expect(registry.slotList()).toEqual(['project']);
    expect(snapshots).toHaveLength(1);
    // 物化含宿主段（builder 原文直出——两段律不因 owner 分叉）
    expect(registry.materialize('s-1')).toBe('项目指令');
    off();
    expect(registry.slotList()).toEqual([]);
    expect(snapshots).toHaveLength(2);
  });

  it('两段形拒（插件注册面词形不得从宿主位混入——两类注册面完备划分）', () => {
    const registry = new PromptSectionRegistry();
    expectCode(() => registry.registerHost('widgets/x', () => 'X'), 'PLUGIN_PROMPT_SLOT_INVALID');
    expectCode(() => registry.registerHost('', () => 'X'), 'PLUGIN_PROMPT_SLOT_INVALID');
  });

  it('撞名拒：宿主位同 slot 重复注册 / 与插件段不冲突（词法空间分立）', () => {
    const registry = new PromptSectionRegistry();
    registry.registerHost('project', () => '一');
    expectCode(() => registry.registerHost('project', () => '二'), 'PLUGIN_PROMPT_SECTION_CONFLICT');
    // 单段与两段词法空间天然分立：插件段不受宿主位影响，照常受理
    registry.register('project/x', 'project', () => '插件段');
    expect(registry.slotList()).toEqual(['project', 'project/x']);
  });

  it('volatile 声明面同蒙：空 reason 拒（单源私验——与插件面同码分流）', () => {
    const registry = new PromptSectionRegistry();
    expectCode(
      () => registry.registerHost('project', () => 'X', { volatile: { reason: '' } }),
      'PLUGIN_PROMPT_SLOT_INVALID',
    );
    // 合法 volatile 受理且物化位居段区尾（两段律同蒙）
    registry.register('a/stable', 'a', () => '稳定段');
    registry.registerHost('project', () => '宿主段', { volatile: { reason: '按会话冻结' } });
    expect(registry.materialize()).toBe('稳定段\n\n宿主段');
  });

  it('空文本段滤除（S-3 零段诚实缺席——空段噪声禁）', () => {
    const registry = new PromptSectionRegistry();
    registry.register('a/one', 'a', () => '有料');
    registry.registerHost('project', () => ''); // 无命中形（builder 空串）
    registry.register('b/two', 'b', () => '收尾');
    // 空段不占位：无夹缝空行，join 语义对消费方等价于段缺席
    expect(registry.materialize()).toBe('有料\n\n收尾');
  });
});
