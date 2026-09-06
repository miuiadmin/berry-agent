/**
 * host/import-gate 单元测试——三道白名单裁决核 + 字面量抽取 + transform 腿。
 *
 * 裁决核纯谓词逐道覆盖；transform 腿真 jiti babel 链转（在道内产码可执行）
 * + 越界 throw 形（error 通道不抛已实证——2026-09-07 探针，本组锁行为）+
 * node_modules 子树豁免辖域判定。
 */
import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { BARE_BUILTINS } from './builtins.js';
import { checkImportSpecifier, createGateTransform, extractImportSpecifiers, VIRTUAL_KEYS } from './import-gate.js';

/** 拒载断言速记（码身份 + 报文含说明符——expectCode 形） */
function expectForbidden(verdict: true | BaseError, specifier: string): void {
  expect(verdict).toBeInstanceOf(BaseError);
  expect((verdict as BaseError).code).toBe('PLUGIN_IMPORT_FORBIDDEN');
  expect((verdict as BaseError).message).toContain(specifier);
}

describe('checkImportSpecifier 三道白名单', () => {
  it('虚拟键六键闭集全过（键表即道①）', () => {
    for (const key of VIRTUAL_KEYS) {
      expect(checkImportSpecifier(key)).toBe(true);
    }
    expect(VIRTUAL_KEYS).toHaveLength(6); // 六键定名表（03 §3.2）
  });

  it('node: 内建过（道②——字面只收前缀形）', () => {
    expect(checkImportSpecifier('node:fs')).toBe(true);
    expect(checkImportSpecifier('node:path')).toBe(true);
  });

  it('虚拟键域内越出键表拒（berry-agent/unknown、typebox/extra）', () => {
    expectForbidden(checkImportSpecifier('berry-agent/unknown'), 'berry-agent/unknown');
    expectForbidden(checkImportSpecifier('typebox/extra'), 'typebox/extra');
  });

  it('相对导入过（道③——树内 containment 由解析保证）', () => {
    expect(checkImportSpecifier('./helper.js')).toBe(true);
    expect(checkImportSpecifier('../shared/util.js')).toBe(true);
  });

  it('绝对路径拒（插件面无绝对径合法位）', () => {
    expectForbidden(checkImportSpecifier('/etc/passwd'), '/etc/passwd');
    expectForbidden(checkImportSpecifier('C:\\Windows\\system32'), 'C:\\');
    expectForbidden(checkImportSpecifier('file:///usr/local/lib'), 'file:');
  });

  it('裸内建名拒——报文指路 node: 前缀', () => {
    expectForbidden(checkImportSpecifier('fs'), 'fs');
    expectForbidden(checkImportSpecifier('path'), 'path');
    expect(BARE_BUILTINS.has('fs')).toBe(true); // 裸名分类面在场
  });

  it('裸第三方说明符：树内可解析过、不可解析拒（fail-closed）', () => {
    expect(checkImportSpecifier('left-pad', { resolveBare: () => true })).toBe(true);
    expectForbidden(checkImportSpecifier('left-pad'), 'left-pad'); // resolveBare 缺席即拒
    expectForbidden(checkImportSpecifier('left-pad', { resolveBare: () => false }), 'left-pad');
  });

  it('空说明符拒', () => {
    expectForbidden(checkImportSpecifier(''), '空说明符');
  });
});

describe('extractImportSpecifiers 字面量抽取', () => {
  it('静态 import/export-from + 副作用 import 全收', () => {
    const src = `
import { a } from 'node:os';
import type { B } from './types.js';
import 'berry-agent';
export { c } from './helper.js';
`;
    expect(extractImportSpecifiers(src)).toEqual(
      expect.arrayContaining(['node:os', './types.js', 'berry-agent', './helper.js']),
    );
  });

  it('require + 动态 import()/require() 字面量全收', () => {
    const src = `
const os = require('node:os');
const m = await import('typebox/value');
const p = require('./pkg.js');
const d = import('berry-agent/llm');
`;
    expect(extractImportSpecifiers(src)).toEqual(
      expect.arrayContaining(['node:os', 'typebox/value', './pkg.js', 'berry-agent/llm']),
    );
  });

  it('多说明符同文件去重不漏（逐模式独立扫描）', () => {
    const specs = extractImportSpecifiers(`import x from 'a.js'; import y from 'a.js';`);
    expect(specs).toEqual(['a.js', 'a.js']); // 扫描核如实报告——裁决侧幂等
  });
});

describe('createGateTransform 字面量腿', () => {
  /** 固定 pluginDir（辖域判定基） */
  const PLUGIN_DIR = '/tmp/berry-gate-probe/plug';

  it('自有码越界即 throw（BaseError 码身份 + 插件 id 点名）', () => {
    const gate = createGateTransform({ pluginId: 'plug-a', pluginDir: PLUGIN_DIR, delegate: (o) => o.source });
    try {
      gate({ source: `import fs from 'fs';\nexport default 1;`, filename: `${PLUGIN_DIR}/entry.js` });
      expect.unreachable('未拒载');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PLUGIN_IMPORT_FORBIDDEN');
      expect((err as BaseError).message).toContain('plug-a');
      expect((err as BaseError).message).toContain('fs'); // 报文含说明符
    }
  });

  it('在道内链委托产码（node: + 虚拟键 + 相对导入全过）', () => {
    let delegated = '';
    const gate = createGateTransform({
      pluginId: 'plug-a',
      pluginDir: PLUGIN_DIR,
      delegate: (o) => `/*gated*/${(delegated = o.source)}`,
    });
    const result = gate({
      source: `import os from 'node:os';\nimport { V } from 'typebox/value';\nimport h from './h.js';\nexport default 1;`,
      filename: `${PLUGIN_DIR}/entry.js`,
    });
    expect(result.code).toContain('/*gated*/');
    expect(delegated).toContain("from 'node:os'");
  });

  it('node_modules 子树豁免——第三方码裸内建不拦（生态惯例）', () => {
    const gate = createGateTransform({
      pluginId: 'plug-a',
      pluginDir: PLUGIN_DIR,
      delegate: (o) => o.source,
    });
    // 裸 fs 在第三方依赖内（node_modules 子树）——豁免只跳裁决、链转照常
    const result = gate({
      source: `import fs from 'fs';\nexport default typeof fs;`,
      filename: `${PLUGIN_DIR}/node_modules/dep/index.js`,
    });
    expect(result.code).toContain("import fs from 'fs'");
  });

  it('嵌套 node_modules 同豁免；树外文件保守全扫', () => {
    const gate = createGateTransform({
      pluginId: 'plug-a',
      pluginDir: PLUGIN_DIR,
      delegate: (o) => o.source,
    });
    expect(
      gate({ source: `import p from 'path';`, filename: `${PLUGIN_DIR}/node_modules/x/node_modules/y/i.js` }).code,
    ).toContain("'path'");
    try {
      gate({ source: `import p from 'path';`, filename: '/elsewhere/file.js' }); // 树外（理论不达）——保守全扫
      expect.unreachable('未拒载');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
    }
  });

  it('缺省 delegate = 真 jiti babel 链转（产码可执行非透传）', async () => {
    const gate = createGateTransform({ pluginId: 'plug-a', pluginDir: PLUGIN_DIR });
    const result = gate({
      source: `import os from 'node:os';\nexport default os.platform();`,
      filename: `${PLUGIN_DIR}/entry.mjs`,
    });
    expect(result.code).not.toBe(`import os from 'node:os';\nexport default os.platform();`); // babel 实转（非原样）
    expect(result.code.length).toBeGreaterThan(0);
  });
});
