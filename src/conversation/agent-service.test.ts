/**
 * ctx.agent 服务面测试——provideAgentService / notifyRunSettled（11f）。
 *
 * 断言面：scope provide 登记 / registerMessageRole 委托 contracts（域名纪律
 * 与撞名执法在彼单源——此处只验委托真身）/ onRunSettled 订阅-退订 /
 * notifyRunSettled 的缺席静默与订阅者异常隔离。
 */
import { describe, expect, it, vi } from 'vitest';
import { Scope } from '../context/index.js';
import { AGENT_SERVICE_NAME, notifyRunSettled, provideAgentService } from './agent-service.js';
import type { RunSettledEvent } from './agent-service.js';

/** RunResult 最小形（终态三值断言面——结构透传不解释） */
const settledEvent = (status: RunSettledEvent['result']['status']): RunSettledEvent => ({
  result: { status },
  sessionId: 's-1',
});

describe('provideAgentService', () => {
  it('provide 到 scope 名 agent（tryGet 可取）+ 单例词汇名单源', () => {
    const scope = Scope.createRoot();
    const service = provideAgentService(scope);
    expect(scope.tryGet<unknown>(AGENT_SERVICE_NAME)).toBe(service);
    expect(AGENT_SERVICE_NAME).toBe('agent');
  });

  it('registerMessageRole 委托 contracts 单源：合法注册可退订、撞名拒绝同真身', () => {
    const scope = Scope.createRoot();
    const service = provideAgentService(scope);
    const dispose = service.registerMessageRole('demo/test-role', { toLlm: () => null });
    dispose();
    // 退订后重注册同名不撞（disposer 语义）
    expect(() => service.registerMessageRole('demo/test-role', { toLlm: () => null })).not.toThrow();
    // 域名两段式强制在 contracts——委托后同样拒绝（fail-loud 透传）
    expect(() => service.registerMessageRole('bare', { toLlm: () => null })).toThrow();
  });
});

describe('onRunSettled / notifyRunSettled', () => {
  it('订阅回调携 {result, sessionId} 信封 + disposer 摘除后零回调', () => {
    const scope = Scope.createRoot();
    const service = provideAgentService(scope);
    const seen: RunSettledEvent[] = [];
    const dispose = service.onRunSettled((event) => void seen.push(event));
    notifyRunSettled(scope, settledEvent('completed'));
    expect(seen).toEqual([{ result: { status: 'completed' }, sessionId: 's-1' }]);
    dispose();
    notifyRunSettled(scope, settledEvent('failed'));
    expect(seen).toHaveLength(1);
  });

  it('多订阅者注册序齐回调；单订阅者异常隔离不反噬其余', () => {
    const scope = Scope.createRoot();
    const service = provideAgentService(scope);
    const order: string[] = [];
    service.onRunSettled(() => void order.push('a'));
    const boom = vi.fn(() => {
      throw new Error('订阅者故障');
    });
    service.onRunSettled(boom);
    service.onRunSettled(() => void order.push('c'));
    expect(() => notifyRunSettled(scope, settledEvent('aborted'))).not.toThrow();
    expect(order).toEqual(['a', 'c']);
    expect(boom).toHaveBeenCalledTimes(1);
  });

  it('scope 未 provide 服务（装配序缺口/纯测试形态）= 静默零回调', () => {
    const scope = Scope.createRoot();
    expect(() => notifyRunSettled(scope, settledEvent('completed'))).not.toThrow();
  });

  it('非 provideAgentService 产物的占位对象（订阅表缺席）= 静默零回调', () => {
    const scope = Scope.createRoot();
    // 伪造服务入 scope（防御位：WeakMap 无表——不炸不回调）
    scope.provide(AGENT_SERVICE_NAME, { onRunSettled: () => () => undefined } as object);
    expect(() => notifyRunSettled(scope, settledEvent('completed'))).not.toThrow();
  });
});
