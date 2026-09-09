/**
 * sdk/plugin-route-registry 受理器真身测试（U5-2——03 §10.6 时序缝定形 +
 * §2.2 第十三面全链）。
 *
 * 四段全谱——①受理序执法（窗先于门〔PLUGIN_WINDOW_CLOSED 在门开形仍拒〕/
 * 门关拒/门开过/core: 豁免门检审计照记/纯函数四码透传/per-plugin 数帽）②查重
 * 双轨（pending 态账内同形 Error / 面在场复用 face.register 既有 throw /
 * 跨插件前缀分域不撞）③capability/used 恰一笔（成功一笔全路径归因键/拒
 * 路径零审计/摘除后重注册新账）④两时点 replay 真 face e2e（pending→
 * snapshot 构造期注入→start→fetch 200；attachFace 后受理→晚注册 fetch 200；
 * attachFace 幂等；摘除 fn→404；releaseFor→活面摘挂+重注册可；detachFace→
 * 回 pending；/reload 合成形：releaseFor+门撤→重注册现判现拒）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace } from './http.js';
import type { SdkHttpFaceHandle } from './http.js';
import { PLUGIN_ROUTE_LIMIT, type PluginRouteDescriptor } from './plugin-routes.js';
import { SDK_ROUTE_CAPABILITY, SDK_ROUTES_SERVICE, createPluginRouteRegistry } from './plugin-route-registry.js';
import type { SdkRouteUsedRecord } from './plugin-route-registry.js';
import type { SdkHttpBridge } from './types.js';

/** 最小桥桩（replay 例不触核——plugin-routes.test 同构八面惰性桩） */
function makeBridge(): SdkHttpBridge {
  return {
    submitPrompt: () => ({ sessionId: 's' }),
    lookupDedupeKey: () => undefined,
    interruptSession: () => {},
    queryEntries: () => ({ entries: [] }),
    listSessions: () => [],
    highWaterOf: () => undefined,
    sessionStateOf: () => 'missing',
    retryProbeOf: () => null,
  };
}

/** 合法基线 descriptor（各段测试在其上单变量改写） */
function baseDescriptor(overrides: Partial<PluginRouteDescriptor> = {}): PluginRouteDescriptor {
  return {
    method: 'GET',
    path: '/status',
    auth: 'token',
    handler: () => {},
    ...overrides,
  };
}

/** 受理器 + 审计账合成构造（多数段只关心裁决——审计账段单独断言） */
function makeRegistry(): { registry: ReturnType<typeof createPluginRouteRegistry>; used: SdkRouteUsedRecord[] } {
  const used: SdkRouteUsedRecord[] = [];
  const registry = createPluginRouteRegistry({ onCapabilityUsed: (record) => used.push(record) });
  return { registry, used };
}

/** 绑定快捷面（缺省门开 + 窗开——单变量改写位经 overrides） */
function bind(
  registry: ReturnType<typeof createPluginRouteRegistry>,
  pluginId: string,
  overrides: { opens?: readonly string[]; window?: boolean } = {},
) {
  return registry.bindForPlugin({
    pluginId,
    getOpens: () => new Set(overrides.opens ?? [SDK_ROUTE_CAPABILITY]),
    inLoadWindow: () => overrides.window ?? true,
  });
}

/** 断言 BaseError 码（code 身份匹配——与全库错误码测试同式） */
function expectCode(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(Error);
  expect((err as { code?: string }).code).toBe(code);
}

describe('受理序执法（窗→门→纯函数→查重→入账→审计）', () => {
  it('窗先于门：窗关形即使门全开也拒（PLUGIN_WINDOW_CLOSED——c-6/U4 同律）', () => {
    const { registry } = makeRegistry();
    const face = bind(registry, 'p', { window: false, opens: [SDK_ROUTE_CAPABILITY] });
    expect(() => face.register(baseDescriptor())).toThrowError(/装载窗口外/);
    try {
      face.register(baseDescriptor());
    } catch (err) {
      expectCode(err, 'PLUGIN_WINDOW_CLOSED');
    }
    expect(registry.snapshot()).toHaveLength(0); // 拒不入账
  });

  it('门关拒（PLUGIN_CAPABILITY_DOOR_CLOSED——opens 空集默认关）', () => {
    const { registry } = makeRegistry();
    const face = bind(registry, 'p', { opens: [] });
    try {
      face.register(baseDescriptor());
      expect.unreachable('门关形必须拒');
    } catch (err) {
      expectCode(err, 'PLUGIN_CAPABILITY_DOOR_CLOSED');
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('sdk.register-route'); // 指路开法含能力名
    }
  });

  it('门开过：opens 含能力名即受理入账（快照见全路径落面 descriptor）', () => {
    const { registry } = makeRegistry();
    bind(registry, 'p').register(baseDescriptor({ path: '/health' }));
    expect(registry.snapshot()).toHaveLength(1);
    expect(registry.snapshot()[0]).toMatchObject({ method: 'GET', path: '/plugins/p/health' });
  });

  it('core: 官方件豁免门检（§4.6 判据：装配即用户意图）', () => {
    const { registry, used } = makeRegistry();
    bind(registry, 'core:demo', { opens: [] }).register(baseDescriptor({ path: '/x' }));
    expect(registry.snapshot()[0]?.path).toBe('/plugins/core%3Ademo/x');
    expect(used).toHaveLength(1); // 豁免免的是门不是账——审计照记
  });

  it('纯函数拒码透传（SDK_ROUTE_PATH_RESERVED/AUTH_FORBIDDEN——裁决件零二次加工）', () => {
    const { registry } = makeRegistry();
    const face = bind(registry, 'p');
    for (const [descriptor, code] of [
      [baseDescriptor({ path: 'status' }), 'SDK_ROUTE_PATH_RESERVED'],
      [baseDescriptor({ path: '/v1/x' }), 'SDK_ROUTE_PATH_RESERVED'],
      [baseDescriptor({ auth: 'self' as never }), 'SDK_ROUTE_AUTH_FORBIDDEN'],
      [baseDescriptor({ bodyLimitBytes: 0 }), 'SDK_ROUTE_BODY_LIMIT'],
    ] as const) {
      try {
        face.register(descriptor);
        expect.unreachable(`须拒：${code}`);
      } catch (err) {
        expectCode(err, code);
      }
    }
    expect(registry.snapshot()).toHaveLength(0); // 拒不入账（四拒全未落账）
  });

  it('per-plugin 数帽：同插件第 17 条拒、他插件帐不受累（跨插件不共享）', () => {
    const { registry } = makeRegistry();
    const p = bind(registry, 'p');
    for (let i = 0; i < PLUGIN_ROUTE_LIMIT; i += 1) {
      p.register(baseDescriptor({ path: `/r${i}` })); // 16 条全过
    }
    try {
      p.register(baseDescriptor({ path: '/r-over' }));
      expect.unreachable('数帽形必须拒');
    } catch (err) {
      expectCode(err, 'SDK_ROUTE_LIMIT_REACHED');
    }
    // 他插件帐独立（count 0 起算——分帐律）
    bind(registry, 'q').register(baseDescriptor({ path: '/status' }));
    expect(registry.snapshot()).toHaveLength(PLUGIN_ROUTE_LIMIT + 1);
  });
});

describe('查重双轨（pending 账内 / 面在场 face throw）', () => {
  it('pending 态同键拒：账内同形普通 Error（core: 道注册期消息形——零新码）', () => {
    const { registry } = makeRegistry();
    const face = bind(registry, 'p');
    face.register(baseDescriptor({ path: '/dup' }));
    try {
      face.register(baseDescriptor({ path: '/dup' }));
      expect.unreachable('同键重注册必须拒');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: string }).code).toBeUndefined(); // 普通 Error 非 SDK_ROUTE_ 码
      expect((err as Error).message).toContain('GET /plugins/p/dup');
    }
    expect(registry.snapshot()).toHaveLength(1); // 拒不入账（原账不动）
  });

  it('method+path 双键：同 path 异 method 不撞（双键唯一非单键）', () => {
    const { registry } = makeRegistry();
    const face = bind(registry, 'p');
    face.register(baseDescriptor({ path: '/dup', method: 'GET' }));
    expect(() => face.register(baseDescriptor({ path: '/dup', method: 'POST' }))).not.toThrow();
    expect(registry.snapshot()).toHaveLength(2);
  });

  it('跨插件前缀分域不撞（/plugins/p/x ≠ /plugins/q/x——拼合单源保证）', () => {
    const { registry } = makeRegistry();
    bind(registry, 'p').register(baseDescriptor({ path: '/x' }));
    expect(() => bind(registry, 'q').register(baseDescriptor({ path: '/x' }))).not.toThrow();
    expect(registry.snapshot()).toHaveLength(2);
  });
});

describe('capability/used 审计恰一笔（05 §1.1 U5 载荷定形）', () => {
  it('成功受理恰一笔：归因键 = method + 全路径（含前缀段）', () => {
    const { registry, used } = makeRegistry();
    bind(registry, 'p').register(baseDescriptor({ method: 'POST', path: '/hook/:id' }));
    expect(used).toEqual([
      { pluginId: 'p', capability: 'sdk.register-route', method: 'POST', path: '/plugins/p/hook/:id' },
    ]);
  });

  it('拒路径零审计（窗/门/词形三拒形均不落账）', () => {
    const { registry, used } = makeRegistry();
    const windowClosed = bind(registry, 'p', { window: false });
    expect(() => windowClosed.register(baseDescriptor())).toThrow();
    const doorClosed = bind(registry, 'p', { opens: [] });
    expect(() => doorClosed.register(baseDescriptor())).toThrow();
    const face = bind(registry, 'p');
    expect(() => face.register(baseDescriptor({ path: 'bad' }))).toThrow();
    expect(used).toHaveLength(0);
  });

  it('摘除后重注册 = 新一笔（数帽递减连带——受理面真实态逐笔照记）', () => {
    const { registry, used } = makeRegistry();
    const face = bind(registry, 'p');
    const remove = face.register(baseDescriptor({ path: '/r' }));
    remove();
    face.register(baseDescriptor({ path: '/r' })); // 键已释放——重注册可
    expect(used).toHaveLength(2);
    expect(registry.snapshot()).toHaveLength(1);
  });
});

describe('两时点 replay（真 face e2e——受理与挂载解耦全链）', () => {
  const faces: SdkHttpFaceHandle[] = [];

  afterEach(async () => {
    await Promise.all(faces.splice(0).map((f) => f.stop()));
  });

  /** 起 TCP 面（port 0 内核指派；memoized——重复调用不二启监听）——fetch 快捷面携 Bearer */
  const startMemo = new Map<SdkHttpFaceHandle, { url: (p: string) => string; token: string }>();
  const startFace = async (face: SdkHttpFaceHandle): Promise<{ url: (p: string) => string; token: string }> => {
    const cached = startMemo.get(face);
    if (cached !== undefined) return cached;
    const info = await face.start();
    const { port } = info.tcp[0]!;
    const built = { url: (p: string) => `http://127.0.0.1:${port}${p}`, token: face.token };
    startMemo.set(face, built);
    return built;
  };

  it('构造期路：pending 受理 → snapshot 注入 routes 位 → start 后 fetch 打通 200', async () => {
    const { registry } = makeRegistry();
    const face0 = bind(registry, 'p');
    face0.register(
      baseDescriptor({
        path: '/health',
        auth: { mode: 'open', purpose: 'liveness' },
        handler: (_req, res) => {
          res.writeHead(200);
          res.end('ok');
        },
      }),
    );
    // 受理时点面未存在（pending 入账）——开面时快照注入构造期 routes 位
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: makeBridge(),
      routes: [...registry.snapshot()],
    });
    faces.push(face);
    const { url } = await startFace(face);
    const res = await fetch(url('/plugins/p/health'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('晚注册路：attachFace 后受理 → face.register 直挂 → fetch 打通 200 + 摘除 fn → 404', async () => {
    const { registry } = makeRegistry();
    const face = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    faces.push(face);
    await startFace(face);
    registry.attachFace(face);

    const remove = bind(registry, 'p').register(
      baseDescriptor({
        path: '/late',
        auth: 'token',
        handler: (_req, res) => {
          res.writeHead(200);
          res.end('late-ok');
        },
      }),
    );
    const { url, token } = await startFace(faces[0]!);
    const hit = await fetch(url('/plugins/p/late'), { headers: { authorization: `Bearer ${token}` } });
    expect(hit.status).toBe(200);
    expect(await hit.text()).toBe('late-ok');

    remove(); // 摘除 fn → 活面摘挂 + 账面释放
    expect((await fetch(url('/plugins/p/late'), { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('面在场查重走 face.register 既有 throw（双轨合流——同表同律字面复用）', async () => {
    const { registry } = makeRegistry();
    const face = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    faces.push(face);
    await startFace(face);
    registry.attachFace(face);

    const p = bind(registry, 'p');
    p.register(baseDescriptor({ path: '/dup-live' }));
    // 面在场：entries.has 命中 → liveFace.register(full) 触发既有 throw 后账内
    // Error 不可达（face throw 先行）——与 core: 道同一张表同一条消息
    expect(() => p.register(baseDescriptor({ path: '/dup-live' }))).toThrowError(/重复注册/);
  });

  it('attachFace 幂等：同面重复挂接 no-op（晚注册路不双挂）', async () => {
    const { registry } = makeRegistry();
    const face = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    faces.push(face);
    await startFace(face);
    registry.attachFace(face);
    registry.attachFace(face); // 重复挂接（如披露回调误重入）——no-op
    const remove = bind(registry, 'p').register(baseDescriptor({ path: '/once' }));
    expect(() => remove()).not.toThrow(); // 摘除不因重复挂接而错账
  });

  it('releaseFor：活面连带摘挂 → 404 + 键释放可重注册（/reload 换代回收腿）', async () => {
    const { registry, used } = makeRegistry();
    const face = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    faces.push(face);
    await startFace(face);
    registry.attachFace(face);

    // 响应 handler（fetch 例必写回——空 handler 不应答会挂起请求）
    const ok: PluginRouteDescriptor['handler'] = (_req, res) => {
      res.writeHead(200);
      res.end('ok');
    };
    bind(registry, 'p').register(baseDescriptor({ path: '/a', handler: ok }));
    bind(registry, 'p').register(baseDescriptor({ path: '/b', handler: ok }));
    bind(registry, 'q').register(baseDescriptor({ path: '/c', handler: ok }));
    const { url, token } = await startFace(face);
    const headers = { authorization: `Bearer ${token}` };
    expect((await fetch(url('/plugins/p/a'), { headers })).status).toBe(200);

    registry.releaseFor('p'); // 本插件全摘（q 不动）
    expect((await fetch(url('/plugins/p/a'), { headers })).status).toBe(404);
    expect((await fetch(url('/plugins/p/b'), { headers })).status).toBe(404);
    expect((await fetch(url('/plugins/q/c'), { headers })).status).toBe(200); // 他在账不动
    expect(registry.snapshot()).toHaveLength(1);

    // 新代重注册可（数帽分帐随 release 归零 + 键已释放）
    bind(registry, 'p').register(baseDescriptor({ path: '/a' }));
    expect(used).toHaveLength(4); // 3 笔首发 + 1 笔新代
  });

  it('detachFace：面收口后受理回 pending 态（snapshot 在账、无活面挂载）', async () => {
    const { registry } = makeRegistry();
    const face = createSdkHttpFace({ config: { tcp: { host: '127.0.0.1', port: 0 } }, bridge: makeBridge() });
    faces.push(face);
    await startFace(face);
    registry.attachFace(face);
    registry.detachFace(); // stop 收口对称（openWebuiFace closer 形）

    // 回 pending：受理入账但不挂活面（构造期注入位自挂的 prev 路由已随 face.stop 摘）
    bind(registry, 'p').register(baseDescriptor({ path: '/next' }));
    expect(registry.snapshot().map((d) => d.path)).toContain('/plugins/p/next');
  });

  it('/reload 换代合成形：releaseFor + 门撤（新代 getOpens 空集）→ 重注册现判现拒', async () => {
    const { registry } = makeRegistry();
    // 旧代：门开 + 受理
    let opens: readonly string[] = [SDK_ROUTE_CAPABILITY];
    const oldFace = registry.bindForPlugin({
      pluginId: 'p',
      getOpens: () => new Set(opens),
      inLoadWindow: () => true,
    });
    oldFace.register(baseDescriptor({ path: '/x' }));

    // 换代：disposer 摘旧（releaseFor 兜底同效）+ 用户撤授予位 → 新代重走受理序
    registry.releaseFor('p');
    opens = []; // enabled.yaml 撤 opens 行——新代 getOpens 现读现判
    try {
      registry
        .bindForPlugin({
          pluginId: 'p',
          getOpens: () => new Set(opens),
          inLoadWindow: () => true,
        })
        .register(baseDescriptor({ path: '/x' }));
      expect.unreachable('门撤后重注册必须拒');
    } catch (err) {
      expectCode(err, 'PLUGIN_CAPABILITY_DOOR_CLOSED');
    }
    expect(registry.snapshot()).toHaveLength(0); // 旧路由不残留
  });
});

describe('常量单源（SERVICE_CATALOG 第三条落位）', () => {
  it('SDK_ROUTES_SERVICE / SDK_ROUTE_CAPABILITY 定值（fork 绑定与门检单源）', () => {
    expect(SDK_ROUTES_SERVICE).toBe('sdk-routes');
    expect(SDK_ROUTE_CAPABILITY).toBe('sdk.register-route');
  });
});
