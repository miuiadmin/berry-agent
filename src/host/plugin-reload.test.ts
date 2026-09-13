/**
 * host/plugin-reload 编舞件测试——03 §5.7 热重载排队与失败三档全谱。
 *
 * 纯闭包注入形（零 db/fs/驱动知识——词面独立律）：preflight/rollback/
 * reapply/isBusy/onRunSettled/report 全部计数器替身，断言编舞序与分档
 * 报告文案；busy 排队/coalesce/run 收场触发/链串行各一例。
 */
import { describe, expect, it } from 'vitest';

import { createPluginReloader, emptyRollbackReceipt, rollbackFromReport } from './plugin-reload.js';
import type { PluginReloadOptions } from './plugin-reload.js';

/** 编舞替身 rig：调用序/回执/警示三面全录 + busy 与 settle 边界可控 */
function rig(overrides: Partial<PluginReloadOptions> = {}): {
  calls: string[];
  reports: string[];
  warns: string[];
  setBusy: (value: boolean) => void;
  fireSettled: () => void;
  options: PluginReloadOptions;
} {
  const calls: string[] = [];
  const reports: string[] = [];
  const warns: string[] = [];
  let busy = false;
  const handlers: Array<() => void> = [];
  const options: PluginReloadOptions = {
    preflight: () => void calls.push('preflight'),
    rollback: async () => {
      calls.push('rollback');
      return { disposed: ['old-a'], failed: [] };
    },
    reapply: async () => {
      calls.push('reapply');
      return {
        total: 3,
        enabled: 2,
        failed: 1,
        failures: [{ id: 'bad-row', code: 'PLUGIN_APPLY_FAILED', message: 'apply 崩了' }],
        addedTools: [],
      };
    },
    isBusy: () => busy,
    onRunSettled: (handler) => {
      handlers.push(handler);
      return () => void handlers.splice(handlers.indexOf(handler), 1);
    },
    report: (text) => void reports.push(text),
    warn: (message) => void warns.push(message),
    ...overrides,
  };
  return {
    calls,
    reports,
    warns,
    setBusy: (value) => (busy = value),
    fireSettled: () => {
      for (const handler of [...handlers]) handler();
    },
    options,
  };
}

describe('idle 直入与执行序（①preflight → ③rollback → ②reapply）', () => {
  it('idle request：三段齐跑 + 换入回执（计数 + 行级点名）', async () => {
    const rig_ = rig();
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(rig_.calls).toEqual(['preflight', 'rollback', 'reapply']);
    expect(rig_.reports).toHaveLength(1);
    expect(rig_.reports[0]).toContain('插件已重载：启用 2/3');
    expect(rig_.reports[0]).toContain('行级失败');
    expect(rig_.reports[0]).toContain('bad-row');
    // obs-a：行级失败附错误文本（原 failedIds 纯点名扩文本——与 plugins list
    // 失败分区同形行）
    expect(rig_.reports[0]).toContain('[PLUGIN_APPLY_FAILED] apply 崩了');
    expect(reloader.hasPending()).toBe(false);
  });

  it('回卷部分失败：warn 点名 + 聚合报告残留行（档③）', async () => {
    const rig_ = rig({
      rollback: async () => ({ disposed: ['old-a'], failed: ['leak-1', 'leak-2'] }),
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(rig_.warns.some((w) => w.includes('leak-1') && w.includes('leak-2'))).toBe(true);
    expect(rig_.reports[0]).toContain('上代回卷残留');
    expect(rig_.reports[0]).toContain('leak-1、leak-2');
  });
});

describe('busy 排队与 coalesce（单槽——读盘为准无参数）', () => {
  it('busy 期 request：零编舞 + 排队提示一次 + pending 在场', async () => {
    const rig_ = rig();
    const reloader = createPluginReloader(rig_.options);
    rig_.setBusy(true);
    reloader.request();
    expect(rig_.calls).toEqual([]); // 编舞零启动
    expect(rig_.reports).toEqual(['会话运行中——/reload 已排队，本轮收场后执行']);
    expect(reloader.hasPending()).toBe(true);
  });

  it('连发并槽：三次 request 只跑一次编舞（最后态语义）', async () => {
    const rig_ = rig();
    const reloader = createPluginReloader(rig_.options);
    rig_.setBusy(true);
    reloader.request();
    reloader.request();
    reloader.request();
    expect(rig_.reports).toHaveLength(1); // 排队提示不重复
    rig_.setBusy(false);
    rig_.fireSettled();
    await reloader.settle();
    expect(rig_.calls).toEqual(['preflight', 'rollback', 'reapply']); // 恰一轮
    expect(reloader.hasPending()).toBe(false);
  });

  it('settled 边界后仍 busy = 保持排队（多会话交错——等下一边界）', async () => {
    const rig_ = rig();
    const reloader = createPluginReloader(rig_.options);
    rig_.setBusy(true);
    reloader.request();
    rig_.fireSettled(); // 边界到了但另一会话在飞
    expect(rig_.calls).toEqual([]);
    expect(reloader.hasPending()).toBe(true);
    rig_.setBusy(false);
    rig_.fireSettled(); // 下一个终态边界
    await reloader.settle();
    expect(rig_.calls).toHaveLength(3);
  });
});

describe('失败三档', () => {
  it('档①清单校验失败 = 拒换：preflight 抛错 → rollback 零调用 + 旧装载态继续', async () => {
    const calls: string[] = [];
    const rig_ = rig({
      preflight: () => {
        calls.push('preflight');
        throw new Error('行 schema 违例: unknown');
      },
      rollback: async () => {
        calls.push('rollback');
        return { disposed: [], failed: [] };
      },
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(calls).toEqual(['preflight']); // 回卷零调用——旧态原封
    expect(rig_.reports[0]).toContain('重载已拒');
    expect(rig_.reports[0]).toContain('unknown');
  });

  it('档③回卷抛错 = 降级存活：仍换入 + 残留点名', async () => {
    const calls: string[] = [];
    const rig_ = rig({
      rollback: async () => {
        calls.push('rollback');
        throw new Error('disposer 挂死');
      },
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(calls).toEqual(['rollback']); // 抛错轮：回卷已试、换入走 rig 默认计数面
    expect(rig_.calls).toEqual(['preflight', 'reapply']); // 换入不阻断
    expect(rig_.warns.some((w) => w.includes('降级存活'))).toBe(true);
    expect(rig_.reports[0]).toContain('上代回卷残留');
    expect(rig_.reports[0]).toContain('<rollback>');
  });

  it('档②行级失败由 reapply 回执承载 + reapply 抛错 = 失败报告与修复指引', async () => {
    const rig_ = rig({
      reapply: async () => {
        throw new Error('jiti 求值崩');
      },
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(rig_.reports[0]).toContain('重载失败');
    expect(rig_.reports[0]).toContain('--no-plugins'); // 救援位指引在场
    // 链自愈：修复后再 request 可执行
    const rig2 = rig();
    const reloader2 = createPluginReloader(rig2.options);
    reloader2.request();
    await reloader2.settle();
    expect(rig2.calls).toHaveLength(3);
  });

  it('防御位：report 自身抛错不反噬链（后续请求照常）', async () => {
    let broken = true;
    const rig_ = rig({
      report: (text) => {
        if (broken) throw new Error('notify 崩');
        void text;
      },
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle(); // 不悬挂不抛
    expect(rig_.warns.some((w) => w.includes('编舞异常'))).toBe(true);
    broken = false;
    reloader.request();
    await reloader.settle();
    expect(rig_.calls).toHaveLength(6); // 两轮齐跑——链未僵死
  });
});

describe('链串行（in-flight 链——并发请求不交错）', () => {
  it('第二轮 preflight 恒晚于第一轮 reapply（门闩证序）', async () => {
    const calls: string[] = [];
    let releaseRollback: (() => void) | undefined;
    let round = 0;
    const rig_ = rig({
      preflight: () => void calls.push('preflight'),
      rollback: () => {
        calls.push('rollback');
        round += 1;
        if (round > 1) return Promise.resolve({ disposed: [], failed: [] }); // 第二轮直通——门闩只拦第一轮
        return new Promise((resolve) => {
          releaseRollback = () => resolve({ disposed: [], failed: [] });
        }) as Promise<{ disposed: string[]; failed: string[] }>;
      },
      reapply: async () => {
        calls.push('reapply');
        return { total: 1, enabled: 1, failed: 0, failures: [], addedTools: [] };
      },
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    reloader.request(); // 第一轮在飞时第二轮入链
    await Promise.resolve(); // 微任务推进至第一轮 rollback 挂起位
    expect(calls).toEqual(['preflight', 'rollback']); // 第二轮未插队
    releaseRollback!();
    await reloader.settle();
    expect(calls).toEqual(['preflight', 'rollback', 'reapply', 'preflight', 'rollback', 'reapply']);
  });
});

describe('新代工具面 diff 呈现（03 §2.8 通道真值——装载史批 h-4）', () => {
  it('addedTools 非空：回执含「新增工具面」行（逐插件点名、多插件分号分隔）', async () => {
    const rig_ = rig({
      reapply: async () => ({
        total: 2,
        enabled: 2,
        failed: 0,
        failures: [],
        addedTools: [
          { pluginId: 'acme:tools', tools: ['acme_probe', 'acme_scan'] },
          { pluginId: 'demo:calc', tools: ['demo_calc'] },
        ],
      }),
    });
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(rig_.reports[0]).toContain('新增工具面：acme:tools → acme_probe、acme_scan；demo:calc → demo_calc');
  });

  it('addedTools 空：不加行不造噪声（模型通道动作时点恒诚实空执法不变）', async () => {
    const rig_ = rig(); // 默认 reapply 回执 addedTools: []
    const reloader = createPluginReloader(rig_.options);
    reloader.request();
    await reloader.settle();
    expect(rig_.reports[0]).toContain('插件已重载：启用 2/3');
    expect(rig_.reports[0]).not.toContain('新增工具面');
  });
});

describe('回执速记件', () => {
  it('emptyRollbackReceipt：空代 no-op 形', () => {
    expect(emptyRollbackReceipt()).toEqual({ disposed: [], failed: [] });
  });

  it('rollbackFromReport：unload 回执对象面 → id 清单适配', () => {
    expect(rollbackFromReport({ disposed: ['a', 'b'], failed: [{ id: 'c', error: new Error('x') }] })).toEqual({
      disposed: ['a', 'b'],
      failed: ['c'],
    });
  });
});
