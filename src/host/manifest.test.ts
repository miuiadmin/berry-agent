/**
 * host/manifest 契约测试——插件清单与启用行拒绝式校验逐路（03 §1.2/§1.3/§5.3）。
 *
 * 校验器是纯函数零副作用：失败面 tagged union（不抛），本组逐路断言
 * ok=false + code + message 指路关键词；成功路断言缺省值与入口解析序三态。
 */
import { describe, expect, it } from 'vitest';

import { checkPluginId, parseEnabledRows, parseManifest, MANIFEST_KEY_CATALOG } from './manifest.js';

/** 合法最小包速记（每用例局部变异——不共享可变引用） */
function basePkg(): Record<string, unknown> {
  return {
    name: 'demo-plugin',
    version: '1.2.3',
    berryAgent: { id: 'demo' },
  };
}

describe('parseManifest 顶层形状', () => {
  it('非对象顶层拒（数组/字符串/null）', () => {
    for (const bad of [[], 'x', null]) {
      const r = parseManifest(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('PLUGIN_SHAPE_INVALID');
    }
  });

  it('name 缺席或非非空字符串拒', () => {
    const r = parseManifest({ berryAgent: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('name');
  });

  it('berryAgent 块缺席 = 不是插件包（install 拒绝位）', () => {
    const r = parseManifest({ name: 'plain-lib' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('berryAgent');
  });

  it('berryAgent 非对象拒', () => {
    const r = parseManifest({ name: 'x', berryAgent: 'yes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('对象');
  });
});

describe('parseManifest 未知键闭集', () => {
  it('清单未知键拒载（拒绝式——拼写错误当场红）', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['entryPoint'] = './x.ts';
    const r = parseManifest(pkg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('entryPoint');
  });

  it('键目录（API 治理真相源⑤）与校验闭集同源——目录全键拼出的清单零未知键红', () => {
    const berryAgent: Record<string, unknown> = {};
    for (const k of MANIFEST_KEY_CATALOG) berryAgent[k.key] = undefined; // undefined 值键 = 视同缺席（合法最小形）
    const r = parseManifest({ name: 'demo', berryAgent });
    expect(r.ok).toBe(true); // 目录每键都被校验闭集认——两路漂移即此红
    // 目录值非 undefined 时坏形仍拒（值校验与闭集两关卡分立）
    expect(MANIFEST_KEY_CATALOG.length).toBeGreaterThanOrEqual(7);
  });

  it('api 块未知键拒', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['api'] = { minApiVersion: '1.0', extra: 1 };
    const r = parseManifest(pkg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('extra');
  });
});

describe('parseManifest id 判据', () => {
  it('显式 id 合法过 + label/version 缺省链', () => {
    const r = parseManifest(basePkg());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.id).toBe('demo');
      expect(r.manifest.label).toBe('demo'); // label 缺省 = id
      expect(r.manifest.version).toBe('1.2.3'); // version 顶层透传
      expect(r.manifest.entryPlan).toEqual({ kind: 'default-export' }); // 入口解析序第③步
    }
  });

  it('显式 id 坏形拒（大写/连字符起头 → 字符集；空串 → 非空字符串）', () => {
    for (const id of ['Demo', '-x']) {
      const pkg = basePkg();
      (pkg['berryAgent'] as Record<string, unknown>)['id'] = id;
      const r = parseManifest(pkg);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('字符集');
    }
    const empty = basePkg();
    (empty['berryAgent'] as Record<string, unknown>)['id'] = '';
    const er = parseManifest(empty);
    expect(er.ok).toBe(false);
    if (!er.ok) expect(er.message).toContain('非空字符串');
  });

  it('缺省 id（= name）不合字符集拒 + 指路显式声明（无隐式映射变换）', () => {
    const r = parseManifest({ name: '@scope/Demo.Pkg', berryAgent: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('缺省 id');
      expect(r.message).toContain('显式声明');
    }
  });

  it('用户面含冒号即拒——core: 前缀为官方插件保留', () => {
    for (const id of ['core:exec', 'a:b']) {
      const pkg = basePkg();
      (pkg['berryAgent'] as Record<string, unknown>)['id'] = id;
      const r = parseManifest(pkg);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('core:');
    }
  });

  it('official 面核校验 core:<name> 后段（前缀豁免句）', () => {
    const pkg = { name: 'core-exec', berryAgent: { id: 'core:exec' } };
    const ok = parseManifest(pkg, { official: true });
    expect(ok.ok).toBe(true);
    const bad = parseManifest({ name: 'x', berryAgent: { id: 'core:' } }, { official: true });
    expect(bad.ok).toBe(false);
  });

  it('checkPluginId 官方式亦收无前缀形（core: 引用形与磁盘插件同轨）', () => {
    expect(checkPluginId('demo', { official: true })).toBe(true);
    expect(checkPluginId('core:exec', { official: true })).toBe(true);
    expect(checkPluginId('core:', { official: true })).toBe(false);
    expect(checkPluginId('core:A', { official: true })).toBe(false);
    expect(checkPluginId('core:a:b', { official: true })).toBe(false);
    expect(checkPluginId('demo', { official: false })).toBe(true);
    expect(checkPluginId('core:a', { official: false })).toBe(false);
  });
});

describe('parseManifest 各键浅校验', () => {
  it('label 非字符串拒', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['label'] = 3;
    expect(parseManifest(pkg).ok).toBe(false);
  });

  it('version 非字符串拒；git 源缺席合法', () => {
    const pkg = basePkg();
    pkg['version'] = 1;
    expect(parseManifest(pkg).ok).toBe(false);
    const noVer = basePkg();
    delete noVer['version'];
    expect(parseManifest(noVer).ok).toBe(true);
  });

  it('entry 非非空字符串拒；合法 entry → entry-file 态', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['entry'] = '';
    expect(parseManifest(pkg).ok).toBe(false);
    const okPkg = basePkg();
    (okPkg['berryAgent'] as Record<string, unknown>)['entry'] = './src/plugin.ts';
    const r = parseManifest(okPkg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.entryPlan).toEqual({ kind: 'entry-file', entry: './src/plugin.ts' });
      expect(r.manifest.entry).toBe('./src/plugin.ts');
    }
  });

  it('grants 非对象拒 / writableRoots 非字符串数组拒 / 合法形状过', () => {
    const bad1 = basePkg();
    (bad1['berryAgent'] as Record<string, unknown>)['grants'] = [];
    expect(parseManifest(bad1).ok).toBe(false);
    const bad2 = basePkg();
    (bad2['berryAgent'] as Record<string, unknown>)['grants'] = { writableRoots: ['a', 1] };
    expect(parseManifest(bad2).ok).toBe(false);
    const okPkg = basePkg();
    (okPkg['berryAgent'] as Record<string, unknown>)['grants'] = { writableRoots: ['~/.demo'] };
    expect(parseManifest(okPkg).ok).toBe(true);
  });

  it('config 非对象拒', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['config'] = 'schema';
    expect(parseManifest(pkg).ok).toBe(false);
  });

  it('api minApiVersion 坏形拒（单源判据 contracts）', () => {
    for (const v of ['1', '1.0.0', 'a.b', '1.x']) {
      const pkg = basePkg();
      (pkg['berryAgent'] as Record<string, unknown>)['api'] = { minApiVersion: v };
      const r = parseManifest(pkg);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('minApiVersion');
    }
  });

  it('api targetApiVersion 坏形拒 + target < min 拒（行为锚不低于硬地板）', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['api'] = { minApiVersion: '1.2', targetApiVersion: '1.0' };
    const r = parseManifest(pkg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('targetApiVersion');
  });

  it('api 全键合法过（experimental 非空字符串数组）', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['api'] = {
      minApiVersion: '1.0',
      targetApiVersion: '1.4',
      experimental: ['ctx.jobs'],
    };
    const r = parseManifest(pkg);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.manifest.api).toEqual({ minApiVersion: '1.0', targetApiVersion: '1.4', experimental: ['ctx.jobs'] });
  });

  it('skills 非字符串数组拒；非空 skills → declared-payload 态（纯声明包零码装载）', () => {
    const bad = basePkg();
    (bad['berryAgent'] as Record<string, unknown>)['skills'] = ['a', 2];
    expect(parseManifest(bad).ok).toBe(false);
    const okPkg = basePkg();
    (okPkg['berryAgent'] as Record<string, unknown>)['skills'] = ['demo/skill-a'];
    const r = parseManifest(okPkg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.entryPlan).toEqual({ kind: 'declared-payload' });
  });

  it('skills 空数组 = 无声明载荷 → 仍走 default-export（非空才算在场）', () => {
    const pkg = basePkg();
    (pkg['berryAgent'] as Record<string, unknown>)['skills'] = [];
    const r = parseManifest(pkg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.entryPlan).toEqual({ kind: 'default-export' });
  });
});

describe('parseEnabledRows 行校验', () => {
  it('合法行集过（含 core: 覆盖行——用户行覆盖官方行合法形态）', () => {
    const r = parseEnabledRows({
      plugins: [
        { id: 'demo', config: { k: 1 } },
        { id: 'core:exec', disabled: true },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0]).toEqual({ id: 'demo', config: { k: 1 }, disabled: undefined });
      expect(r.rows[1]).toEqual({ id: 'core:exec', config: undefined, disabled: true });
    }
  });

  it('顶层非对象 / plugins 非数组拒', () => {
    expect(parseEnabledRows(null).ok).toBe(false);
    expect(parseEnabledRows({ plugins: 'x' }).ok).toBe(false);
  });

  it('行未知键拒 + message 点名行序', () => {
    const r = parseEnabledRows({ plugins: [{ id: 'demo', scope: 'user' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('PLUGIN_ROW_INVALID');
      expect(r.message).toContain('第 1 行');
      expect(r.message).toContain('scope');
    }
  });

  it('id 缺席/坏形拒', () => {
    expect(parseEnabledRows({ plugins: [{ config: {} }] }).ok).toBe(false);
    expect(parseEnabledRows({ plugins: [{ id: 'Bad' }] }).ok).toBe(false);
    expect(parseEnabledRows({ plugins: [{ id: 'a:b' }] }).ok).toBe(false); // 非 core: 前缀含冒号拒
  });

  it('同 id 多行拒（单行 per id）', () => {
    const r = parseEnabledRows({ plugins: [{ id: 'demo' }, { id: 'demo', disabled: true }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('多行');
  });

  it('disabled 非布尔 / config 非对象拒', () => {
    expect(parseEnabledRows({ plugins: [{ id: 'demo', disabled: 'yes' }] }).ok).toBe(false);
    expect(parseEnabledRows({ plugins: [{ id: 'demo', config: 'x' }] }).ok).toBe(false);
  });

  it('空行集合法（用户文件可空——core: 全启不进用户文件）', () => {
    const r = parseEnabledRows({ plugins: [] });
    expect(r.ok).toBe(true);
  });
});
