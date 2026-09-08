/**
 * compaction/slots 测试 — 席位容器状态机 + 值链归因两律（U4-3 装配批）。
 *
 * 覆盖面：单席位先到占/他插件后到拒两码/同席位者可更新/摘槽 disposer 幂等
 * 不误伤/releaseFor 只摘自己/装载窗 only 严于通律（回调窗真源注入——本模块
 * 零 context 边，窗由装配层注入测试直接控真源）/归因箱 mark/forge 两律的
 * 箱在场判与零接触律。纪律：纯逻辑单元——无 SessionLog/无通道/无模型层。
 */
import { describe, it, expect } from 'vitest';
import { BaseError } from '../contracts/index.js';
import {
  BEFORE_COMPACT_ATTRIB,
  createCompactionSlots,
  forgeBeforeCompactIdentity,
  markBeforeCompactRewrite,
} from './slots.js';
import { DEFAULT_COMPACTION_CONFIG, type SummarizerFn } from './types.js';

/** 假摘要算法（provider 槽占位真身——产物可辨识） */
const fakeSummarizer: SummarizerFn = async () => ({ text: '插件摘要' });

/** 断言拒码形（BaseError code 断言——拒词单源在码注册表） */
function expectCode(fn: () => void, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return;
  }
  expect.unreachable(`期望抛 ${code} 但未抛`);
}

/* ---------------- 归因两律（mark / forge） ---------------- */

describe('markBeforeCompactRewrite 记名律', () => {
  it('箱在场：改写值上记末位名——后记覆前记（末位 = 最后改写者）', () => {
    const box = {};
    const value = { [BEFORE_COMPACT_ATTRIB]: box, plan: { start: 1 } };
    markBeforeCompactRewrite(value, 'p-first');
    markBeforeCompactRewrite(value, 'p-second');
    expect(box).toEqual({ lastAdjustedBy: 'p-second' });
  });

  it('箱缺席（非接管缝值链/非对象/null）：no-op 零接触——通用 waterfall 不受影响', () => {
    const plain = { plan: { start: 1 } };
    markBeforeCompactRewrite(plain, 'p-any'); // 无箱——不造箱不记名
    expect(plain).toEqual({ plan: { start: 1 } });
    expect('lastAdjustedBy' in (plain as Record<string, unknown>)).toBe(false);
    markBeforeCompactRewrite(null, 'p-any');
    markBeforeCompactRewrite('string', 'p-any'); // 不抛即过
  });
});

describe('forgeBeforeCompactIdentity 铸造律', () => {
  it('新置接管位（received 无 takeover）：pluginId 强制覆写为本监听者（自填被覆）', () => {
    const received = { [BEFORE_COMPACT_ATTRIB]: {}, plan: { start: 1 } };
    const produced = { ...received, takeover: { pluginId: 'p-forged', summarize: fakeSummarizer } };
    const forged = forgeBeforeCompactIdentity(produced, received, 'p-real') as { takeover: { pluginId: string } };
    expect(forged.takeover.pluginId).toBe('p-real');
    expect(forged).not.toBe(produced); // 新建对象（值链改写必新建律）
  });

  it('重建接管位（引用换）：覆写为本监听者——夺位/换装皆归重建者', () => {
    const received = { [BEFORE_COMPACT_ATTRIB]: {}, takeover: { pluginId: 'p-up', summarize: fakeSummarizer } };
    const produced = { ...received, takeover: { ...received.takeover } }; // 重建（新引用）
    const forged = forgeBeforeCompactIdentity(produced, received, 'p-down') as { takeover: { pluginId: string } };
    expect(forged.takeover.pluginId).toBe('p-down');
  });

  it('原引用透传（含改写他位保留接管引用的 spread 形）：不覆写——防下游误夺上游接管归因', () => {
    const takeover = { pluginId: 'p-up', summarize: fakeSummarizer };
    const received = { [BEFORE_COMPACT_ATTRIB]: {}, takeover, plan: { start: 1 } };
    const produced = { ...received, plan: { start: 5 } }; // 改写 plan、接管位原引用保留
    const out = forgeBeforeCompactIdentity(produced, received, 'p-down') as { takeover: { pluginId: string } };
    expect(out).toBe(produced); // 原值直返不改引用
    expect(out.takeover.pluginId).toBe('p-up'); // 上游归因不夺
  });

  it('takeover 位缺席：原值直返不改引用（纯改写/放行零接触）', () => {
    const value = { [BEFORE_COMPACT_ATTRIB]: {}, plan: { start: 1 } };
    expect(forgeBeforeCompactIdentity(value, value, 'p-real')).toBe(value);
  });

  it('箱缺席（非接管缝 waterfall 值）：零接触原值直返', () => {
    const plain = { takeover: { pluginId: 'p-any', summarize: fakeSummarizer } };
    expect(forgeBeforeCompactIdentity(plain, {}, 'p-real')).toBe(plain);
  });
});

/* ---------------- 席位容器状态机 ---------------- */

describe('createCompactionSlots 席位容器', () => {
  /** 组装容器 + 窗真源开关（装配层注入位——测试直接控布尔） */
  function makeRig() {
    let inWindow = true; // 窗真源：bindForPlugin 注入后拨动即生效（晚绑律）
    const slots = createCompactionSlots();
    const bind = (pluginId: string) => slots.bindForPlugin({ pluginId, inLoadWindow: () => inWindow });
    return { slots, bind, setWindow: (open: boolean) => (inWindow = open) };
  }

  it('空容器：getConfig = 缺省基线原样；getProvider = undefined（空席回落宿主通道）', () => {
    const { slots } = makeRig();
    expect(slots.getConfig()).toEqual(DEFAULT_COMPACTION_CONFIG);
    expect(slots.getProvider()).toBeUndefined();
  });

  it('占 config 席：partial 合并基线（字段射程两路同生效）；同席位者重设 = 更新', () => {
    const { bind, slots } = makeRig();
    const face = bind('p-a');
    const dispose = face.setConfig({ thresholdRatio: 0.7, cooldownMs: 1000 });
    expect(slots.getConfig()).toEqual({ ...DEFAULT_COMPACTION_CONFIG, thresholdRatio: 0.7, cooldownMs: 1000 });
    // 同席位者更新（重设 = 换己方 partial——整值替换非合并）
    face.setConfig({ tailKeep: 8 });
    expect(slots.getConfig()).toEqual({ ...DEFAULT_COMPACTION_CONFIG, tailKeep: 8 });
    dispose();
    expect(slots.getConfig()).toEqual(DEFAULT_COMPACTION_CONFIG); // 摘槽回落基线
  });

  it('他插件后到拒：config 槽 COMPACTION_CONFIG_TAKEN（fail-loud 拒不静默 last-wins）', () => {
    const { bind } = makeRig();
    bind('p-first').setConfig({ thresholdRatio: 0.6 });
    expectCode(() => bind('p-second').setConfig({ tailKeep: 4 }), 'COMPACTION_CONFIG_TAKEN');
  });

  it('provider 槽同律四态：占席可读（pluginId + fn 原引用）/同席位者可换/他插件拒 SUMMARIZER_TAKEN/disposer 摘席', () => {
    const { bind, slots } = makeRig();
    const face = bind('p-a');
    const dispose = face.registerSummarizer(fakeSummarizer);
    expect(slots.getProvider()).toEqual({ pluginId: 'p-a', fn: fakeSummarizer });
    const replacement: SummarizerFn = async () => ({ text: '换装算法' });
    face.registerSummarizer(replacement); // 同席位者更新
    expect(slots.getProvider()?.fn).toBe(replacement);
    expectCode(() => bind('p-b').registerSummarizer(fakeSummarizer), 'COMPACTION_SUMMARIZER_TAKEN');
    dispose();
    expect(slots.getProvider()).toBeUndefined();
  });

  it('装载窗 only 严于通律：窗外两动词皆拒 PLUGIN_WINDOW_CLOSED', () => {
    const { bind, setWindow } = makeRig();
    const face = bind('p-a');
    setWindow(false); // 窗关（真源晚绑——bind 后拨动即生效）
    expectCode(() => face.setConfig({ tailKeep: 4 }), 'PLUGIN_WINDOW_CLOSED');
    expectCode(() => face.registerSummarizer(fakeSummarizer), 'PLUGIN_WINDOW_CLOSED');
    setWindow(true);
    face.setConfig({ tailKeep: 4 }); // 窗重开即恢复（无粘性拒）
  });

  it('disposer 幂等 + 不误伤后设者：重复调/他人已换席后调皆只摘自己的席', () => {
    const { bind, slots } = makeRig();
    const faceA = bind('p-a');
    const disposeA = faceA.setConfig({ tailKeep: 4 });
    disposeA();
    disposeA(); // 幂等：二次调用无副作用
    bind('p-b').setConfig({ tailKeep: 6 }); // 席已空——p-b 合法占
    disposeA(); // p-a 迟到 disposer 不误伤 p-b 席位
    expect(slots.getConfig()).toEqual({ ...DEFAULT_COMPACTION_CONFIG, tailKeep: 6 });
  });

  it('releaseFor 只摘自己：两插件各占异席互不误伤；空位 no-op', () => {
    const { bind, slots } = makeRig();
    bind('p-a').setConfig({ tailKeep: 4 }); // p-a 占 config 席
    bind('p-b').registerSummarizer(fakeSummarizer); // p-b 占 provider 席（异席合法）
    slots.releaseFor('p-b'); // 只摘 p-b 的 provider 席（p-a config 席不动）
    expect(slots.getProvider()).toBeUndefined();
    expect(slots.getConfig()).toEqual({ ...DEFAULT_COMPACTION_CONFIG, tailKeep: 4 });
    slots.releaseFor('p-a'); // 摘 p-a config 席
    expect(slots.getConfig()).toEqual(DEFAULT_COMPACTION_CONFIG);
    slots.releaseFor('p-ghost'); // 空位 no-op 不抛
  });

  it('baseConfig 装配基线：自定义基线原样回落（空席 = 基线原样）', () => {
    const base = { ...DEFAULT_COMPACTION_CONFIG, thresholdRatio: 0.9 };
    const slots = createCompactionSlots({ baseConfig: base });
    expect(slots.getConfig()).toEqual(base);
    slots.bindForPlugin({ pluginId: 'p-a', inLoadWindow: () => true }).setConfig({ cooldownMs: 5 });
    expect(slots.getConfig()).toEqual({ ...base, cooldownMs: 5 });
  });
});
