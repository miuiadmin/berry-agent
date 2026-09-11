/**
 * host/config-schema 单测（ix-3——03 §1.2 configSchema 条款）：
 * 三面覆盖——parse 深校验域（PLUGIN_SHAPE_INVALID 面）/ synthesize 合成序域
 * （PLUGIN_CONFIG_INVALID 执法源）/ mask 呈现纪律域。装载接线面（双轨 +
 * options 透传）在 loader.test.ts 组合根覆盖。
 */
import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { maskConfigSecrets, parseConfigSchemaFields, synthesizePluginConfig } from './config-schema.js';
import type { ConfigField } from './config-schema.js';

/** 断言抛形 = BaseError 载指定码，返回 message（拒绝式断言速记） */
function expectReject(thunk: () => unknown, code: string): string {
  try {
    thunk();
    expect.unreachable('应拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return (err as BaseError).message;
  }
}

describe('parseConfigSchemaFields 深校验（PLUGIN_SHAPE_INVALID 面）', () => {
  it('非数组 / 空数组拒', () => {
    for (const bad of [undefined, {}, 'x', [], [null]]) {
      const r = parseConfigSchemaFields(bad, { pluginId: 'p1' });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('字段非对象 / 未知键闭集拒（拼写错误当场红）', () => {
    expect(parseConfigSchemaFields(['x'], { pluginId: 'p1' }).ok).toBe(false);
    expect(parseConfigSchemaFields([{ key: 'a', type: 'text', typo: 1 }], { pluginId: 'p1' }).ok).toBe(false);
  });

  it('key 词法违例拒（大写/数字起头/点/斜杠/冒号）+ 重复拒', () => {
    for (const key of ['Bad', '1a', 'a.b', 'a/b', 'a:b', '']) {
      const r = parseConfigSchemaFields([{ key, type: 'text' }], { pluginId: 'p1' });
      expect(r.ok, key).toBe(false);
    }
    const dup = parseConfigSchemaFields(
      [
        { key: 'a', type: 'text' },
        { key: 'a', type: 'boolean' },
      ],
      { pluginId: 'p1' },
    );
    expect(dup.ok).toBe(false);
  });

  it('type 闭集外拒（number 等留待真实需求扩——闭集外 = PLUGIN_SHAPE_INVALID）', () => {
    const r = parseConfigSchemaFields([{ key: 'a', type: 'number' }], { pluginId: 'p1' });
    expect(r.ok).toBe(false);
  });

  it('label/description/required 型判 + secret 携 default 拒', () => {
    expect(parseConfigSchemaFields([{ key: 'a', type: 'text', label: 1 }], { pluginId: 'p1' }).ok).toBe(false);
    expect(parseConfigSchemaFields([{ key: 'a', type: 'text', description: 1 }], { pluginId: 'p1' }).ok).toBe(false);
    expect(parseConfigSchemaFields([{ key: 'a', type: 'text', required: 'yes' }], { pluginId: 'p1' }).ok).toBe(false);
    expect(parseConfigSchemaFields([{ key: 'a', type: 'secret', default: 'x' }], { pluginId: 'p1' }).ok).toBe(false);
  });

  it('select options 非空 { value, label }[] 判 + default 型匹配判', () => {
    for (const options of [[], ['x'], [{ value: '', label: 'x' }], [{ value: 'v' }]]) {
      const r = parseConfigSchemaFields([{ key: 'a', type: 'select', options }], { pluginId: 'p1' });
      expect(r.ok, JSON.stringify(options)).toBe(false);
    }
    expect(parseConfigSchemaFields([{ key: 'a', type: 'text', default: 1 }], { pluginId: 'p1' }).ok).toBe(false);
    expect(parseConfigSchemaFields([{ key: 'a', type: 'boolean', default: 'x' }], { pluginId: 'p1' }).ok).toBe(false);
  });

  it('四型合法齐备过（返回即声明面真身）', () => {
    const fields: readonly ConfigField[] = [
      { key: 'name', type: 'text', required: true },
      { key: 'token', type: 'secret', required: false },
      {
        key: 'mode',
        type: 'select',
        default: 'fast',
        options: [
          { value: 'fast', label: '快' },
          { value: 'slow', label: '慢' },
        ],
      },
      { key: 'verbose', type: 'boolean', default: false },
    ];
    const r = parseConfigSchemaFields(fields, { pluginId: 'p1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields).toEqual(fields);
  });
});

describe('synthesizePluginConfig 合成序（PLUGIN_CONFIG_INVALID 执法源）', () => {
  it('fields 缺席 = 行为零变化：rowConfig/defaultConfig 原样直传、均缺席 undefined', () => {
    expect(synthesizePluginConfig({ pluginId: 'p1', rowConfig: { a: 1 } })).toEqual({ a: 1 });
    expect(synthesizePluginConfig({ pluginId: 'p1', defaultConfig: { b: 2 } })).toEqual({ b: 2 });
    expect(synthesizePluginConfig({ pluginId: 'p1', rowConfig: 'raw-even-non-object' })).toBe('raw-even-non-object');
    expect(synthesizePluginConfig({ pluginId: 'p1' })).toBeUndefined();
  });

  it('base 非对象拒（整值替换非合并——数组/字符串均不合形）', () => {
    const fields: readonly ConfigField[] = [{ key: 'a', type: 'text' }];
    expectReject(() => synthesizePluginConfig({ pluginId: 'p1', fields, rowConfig: [1] }), 'PLUGIN_CONFIG_INVALID');
    expectReject(() => synthesizePluginConfig({ pluginId: 'p1', fields, defaultConfig: 'x' }), 'PLUGIN_CONFIG_INVALID');
  });

  it('行 config 携 secret 明文拒——message 指路表单', () => {
    const fields: readonly ConfigField[] = [{ key: 'token', type: 'secret' }];
    const message = expectReject(
      () => synthesizePluginConfig({ pluginId: 'p1', fields, rowConfig: { token: 'leak' } }),
      'PLUGIN_CONFIG_INVALID',
    );
    expect(message).toContain('/plugins config');
  });

  it('清单 config 键（宿主默认值位）携 secret 明文拒——message 指路作者删键', () => {
    const fields: readonly ConfigField[] = [{ key: 'token', type: 'secret' }];
    const message = expectReject(
      () => synthesizePluginConfig({ pluginId: 'p1', fields, defaultConfig: { token: 'leak' } }),
      'PLUGIN_CONFIG_INVALID',
    );
    expect(message).toContain('package.json');
  });

  it('字段级校验三型：text 非串 / boolean 非布 / select 出值域均拒', () => {
    const fields: readonly ConfigField[] = [
      { key: 't', type: 'text' },
      { key: 'b', type: 'boolean' },
      { key: 's', type: 'select', options: [{ value: 'v1', label: '一' }] },
    ];
    for (const bad of [{ t: 1 }, { b: 'x' }, { s: 'v9' }]) {
      expectReject(() => synthesizePluginConfig({ pluginId: 'p1', fields, rowConfig: bad }), 'PLUGIN_CONFIG_INVALID');
    }
  });

  it('required 字段合成后缺席拒（default 与两源值均缺席）', () => {
    const fields: readonly ConfigField[] = [{ key: 'name', type: 'text', required: true }];
    expectReject(() => synthesizePluginConfig({ pluginId: 'p1', fields }), 'PLUGIN_CONFIG_INVALID');
  });

  it('default 兜底三型 + 行值在场胜 default', () => {
    const fields: readonly ConfigField[] = [
      { key: 't', type: 'text', default: 'zero' },
      { key: 'b', type: 'boolean', default: true },
      { key: 's', type: 'select', default: 'v1', options: [{ value: 'v1', label: '一' }] },
    ];
    expect(synthesizePluginConfig({ pluginId: 'p1', fields })).toEqual({ t: 'zero', b: true, s: 'v1' });
    expect(synthesizePluginConfig({ pluginId: 'p1', fields, rowConfig: { t: 'mine' } })).toEqual({
      t: 'mine',
      b: true,
      s: 'v1',
    });
  });

  it('secret 凭证直取注回（getSecret 面缺席 = 恒缺席不注）', () => {
    const fields: readonly ConfigField[] = [{ key: 'token', type: 'secret', required: false }];
    expect(synthesizePluginConfig({ pluginId: 'p1', fields, getSecret: () => 'sekret' })).toEqual({ token: 'sekret' });
    expect(synthesizePluginConfig({ pluginId: 'p1', fields })).toBeUndefined();
  });

  it('required secret 凭证缺席拒——message 指路凭证盒', () => {
    const fields: readonly ConfigField[] = [{ key: 'token', type: 'secret', required: true }];
    const message = expectReject(() => synthesizePluginConfig({ pluginId: 'p1', fields }), 'PLUGIN_CONFIG_INVALID');
    expect(message).toContain('凭证盒');
  });

  it('allowMissingRequiredSecret 豁免（:memory: 诊断形）→ warn 提示行 + 不注键', () => {
    const fields: readonly ConfigField[] = [{ key: 'token', type: 'secret', required: true }];
    const warns: string[] = [];
    const config = synthesizePluginConfig({
      pluginId: 'p1',
      fields,
      rowConfig: { keep: 1 },
      allowMissingRequiredSecret: true,
      warn: (m) => void warns.push(m),
    });
    expect(config).toEqual({ keep: 1 }); // token 缺席不注、未声明键透传
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('豁免');
  });

  it('未声明键原样透传（清单键闭集是宿主消费面防线、值键是插件消费面）', () => {
    const fields: readonly ConfigField[] = [{ key: 'a', type: 'text' }];
    expect(synthesizePluginConfig({ pluginId: 'p1', fields, rowConfig: { a: 'x', unknown: { deep: true } } })).toEqual({
      a: 'x',
      unknown: { deep: true },
    });
  });
});

describe('maskConfigSecrets 呈现纪律（人面 secret 遮蔽）', () => {
  const fields: readonly ConfigField[] = [
    { key: 'token', type: 'secret' },
    { key: 'name', type: 'text' },
  ];

  it("secret 键值遮 '***'、余键不动、返回副本不改性参", () => {
    const config = { token: 'plain', name: 'alice' };
    expect(maskConfigSecrets(fields, config)).toEqual({ token: '***', name: 'alice' });
    expect(config.token).toBe('plain'); // 纯函数不改性参
  });

  it('fields 缺席 / config 非对象 / 无 secret 键在值面 = 原样返回', () => {
    expect(maskConfigSecrets(undefined, { token: 'x' })).toEqual({ token: 'x' });
    expect(maskConfigSecrets(fields, 'flat')).toBe('flat');
    expect(maskConfigSecrets(fields, null)).toBe(null);
    expect(maskConfigSecrets(fields, { name: 'a' })).toEqual({ name: 'a' });
  });
});
