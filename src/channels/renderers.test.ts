/**
 * 插件工具渲染器注册表测试（2026-09-17 TUI 余量收官批③——07 §4.1 钉位注）。
 *
 * 覆盖：注册受理（合法名注册 + lookup 只读面命中）/ 后写胜出（后注册覆盖
 * 先注册——§2.7 律）/ disposer 现任守卫（旧 disposer 不误注接任者）/ 未命中
 * undefined（消费位回落判据）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { lookupToolRenderer, registerToolRenderer, type ToolRenderer } from './renderers.js';

/** 本文件注册项的统一清理（模块级注册表——逐笔 dispose 防跨用例串扰） */
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** 速构渲染器（无钩子空面——受理面只认键不深检） */
const rendererOf = (over: Partial<ToolRenderer> = {}): ToolRenderer => ({ ...over });

describe('插件工具渲染器注册表（后写胜出——03 §2.7）', () => {
  it('注册受理：合法名注册后 lookup 命中同引用（只读面）', () => {
    const renderer = rendererOf({ renderResult: () => [] });
    disposers.push(registerToolRenderer('acme_probe', renderer));
    expect(lookupToolRenderer('acme_probe')).toBe(renderer);
  });

  it('后写胜出：后注册覆盖先注册（含插件对宿主内建工具名注册——受理不拒）', () => {
    const first = rendererOf({ renderCall: () => [] });
    const second = rendererOf({ renderResult: () => [] });
    disposers.push(registerToolRenderer('acme_probe', first));
    disposers.push(registerToolRenderer('acme_probe', second));
    expect(lookupToolRenderer('acme_probe')).toBe(second); // 后写即现任
    // 宿主内建工具名同律受理（呈现增强属插件表达域——回落位兜底）
    const builtin = rendererOf();
    disposers.push(registerToolRenderer('read', builtin));
    expect(lookupToolRenderer('read')).toBe(builtin);
  });

  it('disposer 现任守卫：旧 disposer 不误注接任者；现任 disposer 撤注后未命中', () => {
    const first = rendererOf();
    const second = rendererOf();
    const disposeFirst = registerToolRenderer('acme_probe', first);
    const disposeSecond = registerToolRenderer('acme_probe', second);
    disposeFirst(); // 已被后写覆盖——no-op（不误注接任者）
    expect(lookupToolRenderer('acme_probe')).toBe(second);
    disposeSecond(); // 现任撤注
    expect(lookupToolRenderer('acme_probe')).toBeUndefined();
  });

  it('未命中 undefined（消费位回落判据——渲染器缺席 = 宿主缺省）', () => {
    expect(lookupToolRenderer('never_registered')).toBeUndefined();
  });

  it('disposer 幂等（重复撤注 no-op）', () => {
    const renderer = rendererOf();
    const dispose = registerToolRenderer('acme_probe', renderer);
    dispose();
    dispose(); // 二跑 no-op 不抛
    expect(lookupToolRenderer('acme_probe')).toBeUndefined();
  });
});
