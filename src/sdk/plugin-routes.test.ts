/**
 * sdk/plugin-routes 受理面测试（U5-1——03 §10.6 U5 定形注 + §2.2 第十三面）。
 *
 * 纯函数全谱四段——①拼合单源（encodeURIComponent 段安全编码/空 id 拒）
 * ②词形/保留字（PATH_RESERVED 谱：非 / 起头〔含单独 * 全局形〕/保留根段
 * 防御性回弹/空段/参数名非法/通配非尾/双通配/段含保留字符）③档位收窄
 * （AUTH_FORBIDDEN：self·auth-exchange·越界 purpose；BODY_LIMIT：超帽/
 * 非正整数/边界恰过；缺席填值）④数帽（15 过 16 拒）+ 落面断言（前缀施加/
 * loopbackOnly 恒 true/体帽恒在场）。
 * 互证例：落面 descriptor 注入真 face 构造期 routes 位（core: 道 compileRoute
 * 同律不拒）+ 查重复用 core: 道普通 Error——两道契约互证（U5-2 装配前先锁）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createSdkHttpFace } from './http.js';
import {
  PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES,
  PLUGIN_ROUTE_LIMIT,
  adjudicatePluginRoute,
  pluginRoutePath,
  type PluginRouteDescriptor,
} from './plugin-routes.js';
import type { SdkHttpBridge } from './types.js';

/** 最小桥桩（互证例不触核——routes.test 同构八面惰性桩） */
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

describe('pluginRoutePath 拼合单源', () => {
  it('普通 id 直拼 /plugins/<id>/<suffix>', () => {
    expect(pluginRoutePath('my-plugin', '/status')).toBe('/plugins/my-plugin/status');
  });

  it('特殊字符 id 经 URL 段安全编码（core:xxx 冒号形 → %3A）', () => {
    expect(pluginRoutePath('core:webui', '/x')).toBe('/plugins/core%3Awebui/x');
    // 编码后不含 /——段边界单源性（'a/b' 不会拼出跨段路径）
    expect(pluginRoutePath('a/b', '/x')).toBe('/plugins/a%2Fb/x');
  });
});

describe('受理裁决·词形/保留字（SDK_ROUTE_PATH_RESERVED）', () => {
  const state = { pluginRouteCount: 0 };

  it('非 / 开头 suffix 拒（裸词/空串）', () => {
    for (const path of ['status', '']) {
      const r = adjudicatePluginRoute('p', baseDescriptor({ path }), state);
      expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_PATH_RESERVED' });
    }
  });

  it('单独 * 全局形拒——core: 道 SPA fallback 专属承载位', () => {
    const r = adjudicatePluginRoute('p', baseDescriptor({ path: '*' }), state);
    expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_PATH_RESERVED' });
    expect(r.ok === false && r.message).toContain('SPA fallback');
  });

  it('保留根段防御性回弹拒（/v1 与 /plugins 两族起头）', () => {
    for (const path of ['/v1', '/v1/prompt', '/plugins', '/plugins/other/x']) {
      const r = adjudicatePluginRoute('p', baseDescriptor({ path }), state);
      expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_PATH_RESERVED' });
    }
  });

  it('空段/参数名非法/段含保留字符拒', () => {
    // 注：参数名正则 ^[A-Za-z0-9_]+$ 允许数字开头（core: 道同律——:1abc 系
    // 合法形不入拒谱）；非法形 = 空（尾 :）/连字符/保留字符内嵌
    for (const path of ['/a//b', '/x/:bad-name', '/x/:', '/a:b', '/a*b']) {
      const r = adjudicatePluginRoute('p', baseDescriptor({ path }), state);
      expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_PATH_RESERVED' });
    }
  });

  it('通配 * 至多一枚且须尾段（域内 catch-all 合法形对照）', () => {
    // 中段通配/双通配拒
    for (const path of ['/a/*/b', '/a/*/*']) {
      expect(adjudicatePluginRoute('p', baseDescriptor({ path }), state)).toMatchObject({
        ok: false,
        code: 'SDK_ROUTE_PATH_RESERVED',
      });
    }
    // 尾段通配过——域内 catch-all 映射 /plugins/<p>/*
    const ok = adjudicatePluginRoute('p', baseDescriptor({ path: '/assets/*' }), state);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok === true && ok.descriptor.path).toBe('/plugins/p/assets/*');
  });

  it('合法形：多段/:param/尾通配全过且前缀施加', () => {
    for (const path of ['/status', '/api/:id/submit', '/deep/nested/path', '/s/*']) {
      const r = adjudicatePluginRoute('my-plugin', baseDescriptor({ path }), state);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.descriptor.path.startsWith('/plugins/my-plugin/')).toBe(true);
    }
  });

  it('空 pluginId 拒（拼合空段防御）', () => {
    const r = adjudicatePluginRoute('', baseDescriptor(), state);
    expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_PATH_RESERVED' });
  });
});

describe('受理裁决·档位收窄（AUTH_FORBIDDEN / BODY_LIMIT）', () => {
  const state = { pluginRouteCount: 0 };

  it('self 逃生档拒（host 装配独占）', () => {
    const r = adjudicatePluginRoute('p', baseDescriptor({ auth: 'self' as never }), state);
    expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_AUTH_FORBIDDEN' });
    expect(r.ok === false && r.message).toContain('self');
  });

  it('open 档 purpose 子集：auth-exchange 与越界值拒、liveness/static-shell 过', () => {
    // 类型面已排除越界 purpose（结构性收窄）——本组系 JS 调用方/类型漂移的
    // 防御性回弹谱，故入参显式拓宽（never[] 直入）
    for (const purpose of ['auth-exchange', 'telemetry'] as never[]) {
      const r = adjudicatePluginRoute('p', baseDescriptor({ auth: { mode: 'open', purpose } }), state);
      expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_AUTH_FORBIDDEN' });
    }
    for (const purpose of ['liveness', 'static-shell'] as const) {
      const r = adjudicatePluginRoute('p', baseDescriptor({ auth: { mode: 'open', purpose } }), state);
      expect(r.ok).toBe(true);
    }
  });

  it('token 与 token-or-cookie 档过', () => {
    expect(adjudicatePluginRoute('p', baseDescriptor({ auth: 'token' }), state).ok).toBe(true);
    expect(
      adjudicatePluginRoute('p', baseDescriptor({ auth: { mode: 'token-or-cookie', cookie: 'sid' } }), state).ok,
    ).toBe(true);
  });

  it('bodyLimitBytes：超 1MiB/零/负/非整数拒', () => {
    for (const bad of [PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES + 1, 0, -1, 1024.5]) {
      const r = adjudicatePluginRoute('p', baseDescriptor({ bodyLimitBytes: bad }), state);
      expect(r).toMatchObject({ ok: false, code: 'SDK_ROUTE_BODY_LIMIT' });
    }
  });

  it('bodyLimitBytes 边界恰过（=1MiB 与 <1MiB）+ 缺席填值 1MiB——落面恒在场', () => {
    const atCap = adjudicatePluginRoute(
      'p',
      baseDescriptor({ bodyLimitBytes: PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES }),
      state,
    );
    expect(atCap.ok).toBe(true);
    if (atCap.ok) expect(atCap.descriptor.bodyLimitBytes).toBe(PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES);

    const under = adjudicatePluginRoute('p', baseDescriptor({ bodyLimitBytes: 2048 }), state);
    expect(under.ok).toBe(true);
    if (under.ok) expect(under.descriptor.bodyLimitBytes).toBe(2048);

    const absent = adjudicatePluginRoute('p', baseDescriptor(), state);
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.descriptor.bodyLimitBytes).toBe(PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES);
  });
});

describe('受理裁决·数帽（SDK_ROUTE_LIMIT_REACHED）', () => {
  it('在册 15 过、16 拒（第 17 条申报态）', () => {
    const at15 = adjudicatePluginRoute('p', baseDescriptor(), { pluginRouteCount: PLUGIN_ROUTE_LIMIT - 1 });
    expect(at15.ok).toBe(true);

    const at16 = adjudicatePluginRoute('p', baseDescriptor(), { pluginRouteCount: PLUGIN_ROUTE_LIMIT });
    expect(at16).toMatchObject({ ok: false, code: 'SDK_ROUTE_LIMIT_REACHED' });
  });

  it('数帽 per-plugin 分帐：他插件在册不占本插件帐（count 0 恒过）', () => {
    const r = adjudicatePluginRoute('p', baseDescriptor(), { pluginRouteCount: 0 });
    expect(r.ok).toBe(true);
  });
});

describe('落面铸造断言（收窄四件全部落位）', () => {
  const state = { pluginRouteCount: 0 };

  it('loopbackOnly 恒 true（子集形无自选位的结构性执法）', () => {
    const r = adjudicatePluginRoute('p', baseDescriptor(), state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.descriptor.loopbackOnly).toBe(true);
  });

  it('method/auth 直通、path 前缀施加（encodeURIComponent 形）', () => {
    const r = adjudicatePluginRoute('core:demo', baseDescriptor({ method: 'POST', path: '/hook' }), state);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.descriptor.method).toBe('POST');
      expect(r.descriptor.auth).toBe('token');
      expect(r.descriptor.path).toBe('/plugins/core%3Ademo/hook');
    }
  });
});

describe('两道契约互证（落面 descriptor 过 core: 道注册器）', () => {
  const faces: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(faces.splice(0).map((f) => f.stop()));
  });

  it('合法落面注入真 face 构造期 routes 位不抛（compileRoute 同律）', async () => {
    const judged = adjudicatePluginRoute(
      'p',
      baseDescriptor({ method: 'POST', path: '/hook/:id', auth: { mode: 'open', purpose: 'liveness' } }),
      { pluginRouteCount: 0 },
    );
    expect(judged.ok).toBe(true);
    if (!judged.ok) return;
    // 构造期注册走同一 register → compileRoute——插件道裁决产物与 core: 道
    // 编译律互证（两道契约漂移当场红）
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: makeBridge(),
      routes: [judged.descriptor],
    });
    faces.push(face);
    await face.stop();
  });

  it('查重复用 core: 道 method+path 双键普通 Error（零新码零重复执法）', async () => {
    const first = adjudicatePluginRoute('p', baseDescriptor({ path: '/dup' }), { pluginRouteCount: 0 });
    const second = adjudicatePluginRoute('q', baseDescriptor({ path: '/dup', method: 'GET' }), {
      pluginRouteCount: 0,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // 跨插件撞全路径（/plugins/p/dup vs /plugins/q/dup 不撞——前缀分域）：
    // 先证同 id 重注册才撞——受理面拼合单源保证的域名分立
    expect(first.descriptor.path).toBe('/plugins/p/dup');
    expect(second.descriptor.path).toBe('/plugins/q/dup');

    const samePlugin = adjudicatePluginRoute('p', baseDescriptor({ path: '/dup' }), { pluginRouteCount: 1 });
    expect(samePlugin.ok).toBe(true);
    if (!samePlugin.ok) return;

    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: makeBridge(),
      routes: [first.descriptor],
    });
    faces.push(face);
    // core: 道查重既有形：普通 Error 装配期 fail-loud（非 SDK_ROUTE_ 码）
    expect(() => face.register(samePlugin.descriptor)).toThrowError(/重复注册/);
    await face.stop();
  });
});
