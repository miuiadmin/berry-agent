/**
 * service 件测试（惰性引擎 / 会话路由 / 两级闲置回收 / 降级重试 / scope 回卷 /
 * 工具面注册撤——launchEngine + clock 双注入，fake timers 推扫掠链）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserService } from './service.js';
import type { BrowserServiceDeps } from './service.js';
import type { EngineHandle, LaunchEngineDeps } from './engine.js';
import type { CdpConnection, CdpEvent } from './cdp.js';
import type { BrowserConfig, BrowserRegisterToolsFace } from './types.js';

/* ---------------- 引擎/连接桩 ---------------- */

/** 页面编舞自动应答的脚本连接（Target.* 五步 + 默认空应答） */
function makeConn() {
  const eventListeners = new Set<(event: CdpEvent) => void>();
  const conn: CdpConnection = {
    isDead: false,
    send: (method) => {
      switch (method) {
        case 'Target.createBrowserContext':
          return Promise.resolve({ browserContextId: 'BC1' });
        case 'Target.createTarget':
          return Promise.resolve({ targetId: 'T1' });
        case 'Target.attachToTarget':
          return Promise.resolve({ sessionId: 'S1' });
        default:
          return Promise.resolve({});
      }
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    waitEvent: () => new Promise(() => {}), // 建页/扫掠路径不涉事件等待
    onDown() {},
    close() {},
  };
  return { conn, eventListeners };
}

/** 引擎桩：close 计数 + 手动降级驱动 */
function makeEngine() {
  const { conn } = makeConn();
  const downCbs = new Set<(reason: string) => void>();
  let closeCount = 0;
  const handle: EngineHandle = {
    conn,
    discovered: { path: '/opt/fake-chrome', source: 'config' },
    get alive() {
      return closeCount === 0;
    },
    onDown(cb) {
      downCbs.add(cb);
    },
    close: async () => {
      closeCount += 1;
    },
  };
  return {
    handle,
    get closeCount() {
      return closeCount;
    },
    emitDown: (reason: string) => {
      for (const cb of downCbs) cb(reason);
    },
  };
}

/* ---------------- 依赖束 ---------------- */

interface Harness {
  deps: BrowserServiceDeps;
  launches: LaunchEngineDeps[];
  engines: ReturnType<typeof makeEngine>[];
  notifies: string[];
  registered: string[];
  unregistered: string[];
  setT: (t: number) => void;
}

function makeDeps(over: Partial<BrowserServiceDeps> = {}): Harness {
  let nowT = 0;
  const launches: LaunchEngineDeps[] = [];
  const engines: ReturnType<typeof makeEngine>[] = [];
  const notifies: string[] = [];
  const registered: string[] = [];
  const unregistered: string[] = [];
  const config: BrowserConfig = {};
  const deps: BrowserServiceDeps = {
    spawn: { spawnInteractive: () => ({ stderr: { on: () => {} }, onExit: () => {}, kill: () => {} }) },
    ws: {
      connect: () => ({
        send: () => {},
        close: () => {},
        onMessage: () => {},
        onClose: () => {},
        opened: Promise.resolve(),
      }),
    },
    fs: {
      access: async () => {},
      readFile: async () => '',
      writeFile: async () => {},
      mkdir: async () => {},
      readdir: async () => [],
      stat: async () => ({ isFile: () => true }),
      unlink: async () => {},
    },
    readEnv: () => undefined,
    platform: 'darwin',
    homeDir: '/home/u',
    dataDir: '/data',
    config,
    web: {
      fetch: async (url) => ({
        url,
        finalUrl: url,
        status: 200,
        contentType: '',
        body: '',
        truncated: false,
        bytes: 0,
        redirects: 0,
      }),
    },
    notify: (m) => notifies.push(m),
    launchEngine: async (launchDeps) => {
      launches.push(launchDeps);
      const e = makeEngine();
      engines.push(e);
      return e.handle;
    },
    clock: () => nowT,
    idleMs: 1000,
    sweepIntervalMs: 100,
    ...over,
  };
  return {
    deps,
    launches,
    engines,
    notifies,
    registered,
    unregistered,
    setT: (t) => {
      nowT = t;
    },
  };
}

/** 全能束：notify/register/scope 全在场 */
function fullHarness(over: Partial<BrowserServiceDeps> = {}): Harness & { fireScopeDispose: () => void } {
  let fireScopeDispose: () => void = () => {};
  const base = makeDeps(over);
  const register: BrowserRegisterToolsFace = {
    register: (def) => {
      base.registered.push(def.name);
      return () => base.unregistered.push(def.name);
    },
  };
  const scope = {
    isDisposed: false,
    effect: (reg: () => () => void) => {
      const disposer = reg();
      fireScopeDispose = () => {
        scope.isDisposed = true;
        disposer();
      };
      return disposer;
    },
  };
  const deps: BrowserServiceDeps = { ...base.deps, register, scope: scope as BrowserServiceDeps['scope'] };
  return {
    deps,
    launches: base.launches,
    engines: base.engines,
    notifies: base.notifies,
    registered: base.registered,
    unregistered: base.unregistered,
    setT: base.setT,
    // 经稳定闭包读当前绑定（直接返回 let 变量会按值拷走初始 no-op——apply 后重赋值不达）
    fireScopeDispose: () => fireScopeDispose(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createBrowserService', () => {
  it('apply 零 spawn：providers 在场才 notify；register 在场十件注册齐', async () => {
    const h = fullHarness();
    const svc = createBrowserService(h.deps);
    svc.apply();
    expect(h.launches).toHaveLength(0); // 「装载在场」≠「引擎在场」
    expect(h.notifies).toHaveLength(0); // providers 缺席不通知
    expect(h.registered).toHaveLength(10);
    expect(h.registered).toContain('navigate');
    await vi.advanceTimersByTimeAsync(100); // 扫掠一步（无引擎无页面——零动作）
    expect(h.launches).toHaveLength(0);
    await svc.shutdown();
  });

  it('providers 在场 → 云端占位 boot 通知（v1 执行面零接——引擎恒本地）', async () => {
    const h = fullHarness({ config: { providers: [{ kind: 'cloud' }] } });
    const svc = createBrowserService(h.deps);
    svc.apply();
    expect(h.notifies).toHaveLength(1);
    expect(h.notifies[0]).toContain('引擎恒本地');
    await svc.shutdown();
  });

  it('pageFor 惰性首用起引擎；同键同页复用；异键异页（context 隔离）', async () => {
    const h = makeDeps();
    const svc = createBrowserService(h.deps);
    svc.apply();
    const p1 = await svc.pageFor('s1');
    expect(h.launches).toHaveLength(1);
    const p1b = await svc.pageFor('s1');
    expect(p1b).toBe(p1);
    expect(h.launches).toHaveLength(1); // 复用不起第二引擎
    const p2 = await svc.pageFor('s2');
    expect(p2).not.toBe(p1);
    expect(h.engines[0]!.closeCount).toBe(0); // 活跃期零关停
    await svc.shutdown();
  });

  it('并发同键竞态：一页入账一页让路（先建赢——close 让路页）', async () => {
    const h = makeDeps();
    const svc = createBrowserService(h.deps);
    svc.apply();
    const [a, b] = await Promise.all([svc.pageFor('k'), svc.pageFor('k')]);
    expect(a).toBe(b); // 调用方拿同一页
    expect(h.launches).toHaveLength(1);
    await svc.shutdown();
    // 引擎一次、让路页一页：Target.closeTarget 发帧计数不可见（conn 桩不记账）
    // ——以「无未处理拒绝 + 同页回执」为观察面
  });

  it('两级闲置回收：context 级清页（引擎留）→ 引擎级协议化关停 → 下用重启', async () => {
    const h = makeDeps();
    const svc = createBrowserService(h.deps);
    svc.apply();
    await svc.pageFor('s1'); // t=0（engineLastUsed=0, entry.lastUsed=0）
    h.setT(600);
    await svc.pageFor('s2'); // t=600（engineLastUsed=600, s2.lastUsed=600；s1.lastUsed=0）
    // t=1001 扫掠：s1 闲置（1001-0≥1000）清；s2 活跃（401<1000）留；引擎留（contexts 非空）
    h.setT(1001);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.engines[0]!.closeCount).toBe(0);
    // t=1601 扫掠：s2 清（1601-600≥1000）+ 引擎闲置（1601-600≥1000）同扫掠关停
    h.setT(1601);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.engines[0]!.closeCount).toBe(1);
    // 下用再试：引擎重启（新 handle）
    h.setT(2000);
    await svc.pageFor('s3');
    expect(h.launches).toHaveLength(2);
    await svc.shutdown();
  });

  it('引擎降级 onDown：通知 + 下用重启；旧页 send 由 conn 快拒不在此测', async () => {
    const h = makeDeps();
    const svc = createBrowserService(h.deps);
    svc.apply();
    await svc.pageFor('s1');
    h.engines[0]!.emitDown('进程退出（code 1）');
    expect(h.notifies.some((m) => m.includes('引擎已降级'))).toBe(true);
    h.setT(10); // 降级后立刻重试（远未到闲置窗）
    await svc.pageFor('s1');
    expect(h.launches).toHaveLength(2); // 下用重启
    await svc.shutdown();
  });

  it('启动失败不粘住：pageFor 拒 + 再用重试', async () => {
    let calls = 0;
    const h = makeDeps({
      launchEngine: async () => {
        calls += 1;
        if (calls === 1) throw new Error('启动失败');
        return makeEngine().handle;
      },
    });
    const svc = createBrowserService(h.deps);
    svc.apply();
    await expect(svc.pageFor('s1')).rejects.toThrow('启动失败');
    const p = await svc.pageFor('s1');
    expect(p.sessionId).toBe('S1');
    await svc.shutdown();
  });

  it('scope 回卷：disposer 即 shutdown（页面关 + 引擎关 + 工具面全撤）', async () => {
    const h = fullHarness();
    const svc = createBrowserService(h.deps);
    svc.apply();
    await svc.pageFor('s1');
    h.fireScopeDispose();
    // void shutdown 异步结清——真 setImmediate tick 排干全链（未被 fake 的面）
    await new Promise((r) => setImmediate(r));
    expect(h.engines[0]!.closeCount).toBe(1);
    expect(h.unregistered).toHaveLength(10);
    // 回卷后再扫掠零动作（disposed 闸）
    h.setT(99999);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.engines[0]!.closeCount).toBe(1);
  });

  it('shutdown 幂等：二次调用零新关停', async () => {
    const h = makeDeps();
    const svc = createBrowserService(h.deps);
    svc.apply();
    await svc.pageFor('s1');
    await svc.shutdown();
    await svc.shutdown();
    expect(h.engines[0]!.closeCount).toBe(1);
  });

  it('启动依赖透传：spawn/ws/fs/env/platform/homeDir/dataDir/config 原样到 launchEngine', async () => {
    const h = makeDeps();
    const svc = createBrowserService(h.deps);
    svc.apply();
    await svc.pageFor('s1');
    const l = h.launches[0]!;
    expect(l.dataDir).toBe('/data');
    expect(l.homeDir).toBe('/home/u');
    expect(l.platform).toBe('darwin');
    expect(l.config).toEqual({});
    await svc.shutdown();
  });
});
