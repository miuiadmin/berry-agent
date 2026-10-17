/**
 * host/import-gate 单元测试——三道白名单裁决核 + 字面量抽取 + transform 腿。
 *
 * 裁决核纯谓词逐道覆盖；transform 腿真 jiti babel 链转（在道内产码可执行）
 * + 越界 throw 形（error 通道不抛已实证——2026-09-07 探针，本组锁行为）+
 * node_modules 子树豁免辖域判定。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { BARE_BUILTINS, PURE_COMPUTATION_BUILTINS } from './builtins.js';
import {
  checkImportSpecifier,
  createGateTransform,
  extractImportSpecifiers,
  prescanPluginOwnGraph,
  VIRTUAL_KEYS,
} from './import-gate.js';
import type { PreScanOptions } from './import-gate.js';

/** containment 测试临时目录族（统一清） */
const containDirs: string[] = [];

afterAll(() => {
  for (const d of containDirs) rmSync(d, { recursive: true, force: true });
});

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

  it('相对导入过（道③——谓词层放行；树内 containment 由 transform 腿执法）', () => {
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

describe('checkImportSpecifier 道②分级（R3——修前红：node: 前缀无条件放行、无受门档判）', () => {
  it('放行档闭集短路——纯计算内建免门（空生效集下仍全过：分级判序先于生效集判）', () => {
    // 零上下文（历史调用形）放行档全过——三道白名单叙事对此集零变化
    for (const name of PURE_COMPUTATION_BUILTINS) {
      expect(checkImportSpecifier(`node:${name}`)).toBe(true);
    }
    // 受门档全拒档（空集）下放行档依旧全过——短路在生效集判之前
    const closed = new Set<string>();
    for (const name of PURE_COMPUTATION_BUILTINS) {
      expect(checkImportSpecifier(`node:${name}`, { gatedNodeBuiltins: closed })).toBe(true);
    }
  });

  it('受门档：生效集内过、集外拒 PLUGIN_NODE_BUILTIN_FORBIDDEN（分码分归因）', () => {
    const gate = new Set(['node:fs']);
    expect(checkImportSpecifier('node:fs', { gatedNodeBuiltins: gate })).toBe(true);
    const verdict = checkImportSpecifier('node:os', { gatedNodeBuiltins: gate });
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN'); // 非 PLUGIN_IMPORT_FORBIDDEN——道内门中未授
    expect((verdict as BaseError).message).toContain('node:os'); // 报文含说明符
    expect((verdict as BaseError).message).toContain('生效集'); // 因由词面
  });

  it('子径族按首段裸名归级——node:fs 授予即覆 node:fs/promises、放行档子径同免门', () => {
    const gate = new Set(['node:fs']);
    expect(checkImportSpecifier('node:fs/promises', { gatedNodeBuiltins: gate })).toBe(true); // 首段在集即过
    expect(checkImportSpecifier('node:url/whatwg', { gatedNodeBuiltins: new Set() })).toBe(true); // 放行档子径短路
    const verdict = checkImportSpecifier('node:os', { gatedNodeBuiltins: new Set(['node:fs']) });
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN'); // 受门档子径首段不在集即拒
  });

  it('分级腿未接线 = 道②静默（缺省 ctx——诊断/替身形历史行为锁）', () => {
    expect(checkImportSpecifier('node:os')).toBe(true); // 无 ctx 全放行
    expect(checkImportSpecifier('node:os', {})).toBe(true); // ctx 在场而键缺席同静默
  });

  it('空生效集 = 受门档全拒（注入即执法——声明缺省即默认关 fail-closed）', () => {
    const verdict = checkImportSpecifier('node:fs', { gatedNodeBuiltins: new Set() });
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
  });

  it('闭集 fail-closed——放行档 ⊆ 裸名册、典型副作用名不在放行档（03 §3.3 :357 判据）', () => {
    for (const name of PURE_COMPUTATION_BUILTINS) {
      expect(BARE_BUILTINS.has(name)).toBe(true); // 放行档是裸名册子集（结构一致律）
    }
    // 副作用面典型名恒受门（无文件系统/网络/进程生成/环境面副作用判据）
    expect(PURE_COMPUTATION_BUILTINS.has('fs')).toBe(false);
    expect(PURE_COMPUTATION_BUILTINS.has('net')).toBe(false);
    expect(PURE_COMPUTATION_BUILTINS.has('child_process')).toBe(false);
    expect(PURE_COMPUTATION_BUILTINS.has('os')).toBe(false); // 读环境面
    expect(PURE_COMPUTATION_BUILTINS.has('crypto')).toBe(false); // 载密码学随机源
    expect(PURE_COMPUTATION_BUILTINS.has('process')).toBe(false); // 全局面
    expect(PURE_COMPUTATION_BUILTINS.size).toBe(8); // 名单定谳锁（扩名须先改 03 §3.3）
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

  it('受门档注线：生效集外 node: import throw（码身份 + 插件 id 点名——R3 修前红）', () => {
    const gate = createGateTransform({
      pluginId: 'plug-gated',
      pluginDir: PLUGIN_DIR,
      gatedNodeBuiltins: new Set(['node:fs']),
      delegate: (o) => o.source,
    });
    try {
      gate({ source: `import os from 'node:os';\nexport default 1;`, filename: `${PLUGIN_DIR}/entry.js` });
      expect.unreachable('未拒载');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
      expect((err as BaseError).message).toContain('plug-gated');
      expect((err as BaseError).message).toContain('node:os');
    }
    // 生效集内与放行档照常链转
    const ok = gate({
      source: `import fsp from 'node:fs/promises';\nimport p from 'node:path';\nexport default 1;`,
      filename: `${PLUGIN_DIR}/entry.js`,
    });
    expect(ok.code).toContain("'node:fs/promises'");
  });

  it('transform 腿缺省 gatedNodeBuiltins = 道②静默（未接线形——装载器直调历史行为锁）', () => {
    const gate = createGateTransform({ pluginId: 'plug-a', pluginDir: PLUGIN_DIR, delegate: (o) => o.source });
    const result = gate({ source: `import os from 'node:os';\nexport default 1;`, filename: `${PLUGIN_DIR}/entry.js` });
    expect(result.code).toContain("from 'node:os'"); // 无 gatedNodeBuiltins 键 = 门②不执法
  });
});

describe('createGateTransform 相对径 containment 执法（道③补腿——修前红：../ 链无条件放行可逃出插件树）', () => {
  /** 真文件 containment fixture（jiti 只对存在文件调 transform——realpath 归一同产线形） */
  function containFixture(files: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'berry-gate-contain-'));
    containDirs.push(root);
    const pluginDir = join(root, 'plug');
    for (const rel of files) {
      const target = join(pluginDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `export default 1;\n`);
    }
    return pluginDir;
  }

  it("'../' 链解析逃出插件树即拒——修前红（market 布局深层可达家目录形）", () => {
    const pluginDir = containFixture(['deep/entry.js']);
    const gate = createGateTransform({ pluginId: 'plug-esc', pluginDir, delegate: (o) => o.source });
    try {
      // deep/entry.js 起 '../../escape.js' 解析到插件树外（root/escape.js——目标缺席不缓判，归一后出界即拒）
      gate({
        source: `import x from '../../escape.js';\nexport default x;`,
        filename: join(pluginDir, 'deep', 'entry.js'),
      });
      expect.unreachable('未拒载');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PLUGIN_IMPORT_FORBIDDEN');
      expect((err as BaseError).message).toContain('../../escape.js'); // 报文含说明符
      expect((err as BaseError).message).toContain('逃逸'); // 因由词面
    }
  });

  it('树内合法 ../ 引用不误伤（resolve 归一后仍在树内即放行——目标在场与缺席两形）', () => {
    const pluginDir = containFixture(['deep/entry.js', 'util.js']);
    const gate = createGateTransform({ pluginId: 'plug-in', pluginDir, delegate: (o) => o.source });
    // 目标在场：deep/entry.js 起 '../util.js' 解析回插件根内；'./node_modules/dep/i.js' 相对自捆同律放行
    const result = gate({
      source: `import u from '../util.js';\nimport d from './node_modules/dep/i.js';\nexport default 1;`,
      filename: join(pluginDir, 'deep', 'entry.js'),
    });
    expect(result.code).toContain("'../util.js'");
    // 目标缺席（笔误形）：不误判逃逸——归一后仍在树内（缺席红归 jiti 解析失败，非门禁拒）
    const missing = gate({
      source: `import u from '../not-yet.js';\nexport default 1;`,
      filename: join(pluginDir, 'deep', 'entry.js'),
    });
    expect(missing.code).toContain("'../not-yet.js'");
  });
});

describe('prescanPluginOwnGraph 装载前置源扫腿（2026-10-18 勘正——修前红：jiti 原生 ESM 求值路径零调 transform，字面量腿对 type:module 形整体失明）', () => {
  /** 源扫 fixture：相对路径 → 源文本映射落盘（真实文件系统形态——与装载腿同基） */
  function scanFixture(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'berry-gate-prescan-'));
    containDirs.push(root);
    const pluginDir = join(root, 'plug');
    for (const [rel, source] of Object.entries(files)) {
      const target = join(pluginDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    return pluginDir;
  }

  /** 受门档生效集注入形（装载序快照——空集外的「授予 tls」形更能分档） */
  const GATED = new Set(['node:tls']);

  /** 扫描速记（缺省入口 entry.js + 受门集注入） */
  function scan(pluginDir: string, extra: Partial<PreScanOptions> = {}, entry = 'entry.js'): true | BaseError {
    return prescanPluginOwnGraph({
      pluginId: 'plug-scan',
      pluginDir,
      entryPath: join(pluginDir, entry),
      gatedNodeBuiltins: GATED,
      ...extra,
    });
  }

  it('入口受门内建越界即拒（原生 ESM 形的单元镜像——transform 腿不达路径由本腿封）', () => {
    const pluginDir = scanFixture({ 'entry.js': `import os from 'node:os';\nexport default 1;\n` });
    const verdict = scan(pluginDir);
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    expect((verdict as BaseError).message).toContain('node:os'); // 说明符点名
    expect((verdict as BaseError).message).toContain('plug-scan'); // 插件 id 点名
  });

  it('递归深入：相对导入链子文件违规同拒（深层多级图遍历）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import './mid.js';\nexport default 1;\n`,
      'mid.js': `import './deep.js';\nexport default 1;\n`,
      'deep.js': `import cp from 'node:child_process';\nexport default cp;\n`,
    });
    const verdict = scan(pluginDir);
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    expect((verdict as BaseError).message).toContain('node:child_process'); // 违规点在孙文件
  });

  it('visited 防环：circular import 图不炸、全清即过（纯计算内建免门同判）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import './a.js';\nexport default 1;\n`,
      'a.js': `import './entry.js';\nimport p from 'node:path';\nexport default p;\n`, // node:path ∈ 放行档
    });
    expect(scan(pluginDir)).toBe(true);
  });

  it('node_modules 子树豁免同律：第三方码受门内建/裸内建不拦（生态惯例）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import d from './node_modules/dep/i.js';\nexport default d;\n`,
      'node_modules/dep/i.js': `import os from 'node:os';\nconst fs = require('fs');\nexport default 1;\n`,
    });
    expect(scan(pluginDir)).toBe(true);
  });

  it('非码扩展名跳过：.json 载荷内说明符字面量零误伤', () => {
    const pluginDir = scanFixture({
      'entry.js': `import data from './data.json';\nexport default data;\n`,
      'data.json': `{"x": "require('node:os')"}`,
    });
    expect(scan(pluginDir)).toBe(true);
  });

  it('相对径逃逸拒——../ 链解析出插件树（containment 与 transform 腿同律）', () => {
    const pluginDir = scanFixture({ 'deep/entry.js': `import x from '../../escape.js';\nexport default x;\n` });
    const verdict = scan(pluginDir, {}, 'deep/entry.js');
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_IMPORT_FORBIDDEN');
    expect((verdict as BaseError).message).toContain('逃逸');
  });

  it('扩展名补全解析：无扩展说明符 ./mid → mid.js 违规同拒（jiti 解析序镜像）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import './mid';\nexport default 1;\n`,
      'mid.js': `import cp from 'node:child_process';\nexport default cp;\n`,
    });
    const verdict = scan(pluginDir);
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    expect((verdict as BaseError).message).toContain('node:child_process');
  });

  it('目录 index 解析：./sub → sub/index.js 违规同拒', () => {
    const pluginDir = scanFixture({
      'entry.js': `import './sub';\nexport default 1;\n`,
      'sub/index.js': `import net from 'node:net';\nexport default net;\n`,
    });
    const verdict = scan(pluginDir);
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    expect((verdict as BaseError).message).toContain('node:net');
  });

  it('解析不达目标跳过：缺席相对引用归 jiti 解析失败红（门禁不代跑解析错）', () => {
    const pluginDir = scanFixture({ 'entry.js': `import './missing.js';\nexport default 1;\n` });
    expect(scan(pluginDir)).toBe(true);
  });

  it('readSource 注入位：craft 源参与裁决、返 null 跳过', () => {
    const pluginDir = scanFixture({ 'entry.js': `export default 1;\n` });
    // craft 源越界——裁决吃注入源非盘面源（测试注入位的语义锁）
    const crafted = scan(pluginDir, {
      readSource: (path) => (path.endsWith('entry.js') ? `import os from 'node:os';\nexport default 1;\n` : null),
    });
    expect(crafted).toBeInstanceOf(BaseError);
    expect((crafted as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    // 全 null = 全跳过——零裁决零误伤（读不达形归 jiti 解析失败红）
    expect(scan(pluginDir, { readSource: () => null })).toBe(true);
  });

  it('全清图过：放行档内建 + 虚拟键 + 树内裸说明符（resolveBare 注入）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import p from 'node:path';\nimport host from 'berry-agent';\nimport dep from 'left-pad';\nexport default 1;\n`,
    });
    expect(scan(pluginDir, { resolveBare: () => true })).toBe(true);
    // resolveBare 缺席 = 树内不可解析拒（fail-closed——transform 腿同律）
    const bare = scan(pluginDir);
    expect(bare).toBeInstanceOf(BaseError);
    expect((bare as BaseError).code).toBe('PLUGIN_IMPORT_FORBIDDEN');
    expect((bare as BaseError).message).toContain('left-pad');
  });

  it('分级腿未接线 = 道②静默（gatedNodeBuiltins 缺席——镜像律）', () => {
    const pluginDir = scanFixture({ 'entry.js': `import os from 'node:os';\nexport default 1;\n` });
    expect(prescanPluginOwnGraph({ pluginId: 'plug-scan', pluginDir, entryPath: join(pluginDir, 'entry.js') })).toBe(
      true,
    );
  });
});

describe('prescanPluginOwnGraph 入口顶点解析与图边尾剥（冷读闸 P2/P3 清偿——修前红：无扩展/目录形入口零扫描即放行）', () => {
  /** fixture 与扫描速记（同前 describe 惯例） */
  function scanFixture(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'berry-gate-prescan2-'));
    containDirs.push(root);
    const pluginDir = join(root, 'plug');
    for (const [rel, source] of Object.entries(files)) {
      const target = join(pluginDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    return pluginDir;
  }

  function scan(pluginDir: string, entry: string): true | BaseError {
    return prescanPluginOwnGraph({
      pluginId: 'plug-scan2',
      pluginDir,
      entryPath: join(pluginDir, entry),
      gatedNodeBuiltins: new Set(['node:tls']),
    });
  }

  /** 拒载断言速记（码 + 说明符点名） */
  function expectGated(verdict: true | BaseError, specifier: string): void {
    expect(verdict).toBeInstanceOf(BaseError);
    expect((verdict as BaseError).code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    expect((verdict as BaseError).message).toContain(specifier);
  }

  it('入口无扩展精确文件违规拒——修前红（jiti 按精确路径装载无扩展码文件，探针实证 node:os 真执行）', () => {
    const pluginDir = scanFixture({ main: `import os from 'node:os';\nexport default 1;\n` }); // 无扩展名文件
    expectGated(scan(pluginDir, 'main'), 'node:os');
  });

  it('入口目录形解析（lib → lib/index.js）违规拒——修前红（冷读闸探针形①：entry:"lib/index" 同族）', () => {
    const pluginDir = scanFixture({ 'lib/index.js': `import os from 'node:os';\nexport default 1;\n` });
    expectGated(scan(pluginDir, 'lib'), 'node:os');
  });

  it('入口扩展名补全形（src/mod → src/mod.ts）违规拒——修前红', () => {
    const pluginDir = scanFixture({ 'src/mod.ts': `import os from 'node:os';\nexport default 1;\n` });
    expectGated(scan(pluginDir, 'src/mod'), 'node:os');
  });

  it('图边 query 尾剥解析：./util.js?v=2 → util.js 违规同拒——修前红（原生 ESM 合法 cache-bust 形）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import u from './util.js?v=2';\nexport default u;\n`,
      'util.js': `import cp from 'node:child_process';\nexport default cp;\n`,
    });
    expectGated(scan(pluginDir, 'entry.js'), 'node:child_process');
  });

  it('无扩展入口在道形零误伤（clean 无扩展码 + 目录形全清图均过）', () => {
    const exact = scanFixture({ main: `import p from 'node:path';\nexport default p;\n` });
    expect(scan(exact, 'main')).toBe(true);
    const dir = scanFixture({ 'lib/index.js': `import p from 'node:path';\nexport default p;\n` });
    expect(scan(dir, 'lib')).toBe(true);
  });

  it('扩展名族锁面：./x → x.mjs（x.js 缺席）与 ./sub → sub/index.mjs 违规同拒（.mjs 补全形）', () => {
    const completion = scanFixture({
      'entry.js': `import './x';\nexport default 1;\n`,
      'x.mjs': `import os from 'node:os';\nexport default 1;\n`,
    });
    expectGated(scan(completion, 'entry.js'), 'node:os');
    const dirIndex = scanFixture({
      'entry.js': `import './sub';\nexport default 1;\n`,
      'sub/index.mjs': `import os from 'node:os';\nexport default 1;\n`,
    });
    expectGated(scan(dirIndex, 'entry.js'), 'node:os');
  });

  it('多级目录 index 链递归达（./a → a/index.js → ../b → b/index.js 违规在孙位；父相对跳层形）', () => {
    const pluginDir = scanFixture({
      'entry.js': `import './a';\nexport default 1;\n`,
      'a/index.js': `import '../b';\nexport default 1;\n`, // 父相对——b 在插件根不在 a/ 下（夹具曾误 './b' 解析基错位致假红）
      'b/index.js': `import cp from 'node:child_process';\nexport default cp;\n`,
    });
    expectGated(scan(pluginDir, 'entry.js'), 'node:child_process');
  });
});
