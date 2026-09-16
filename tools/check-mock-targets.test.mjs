/**
 * check-mock-targets 自举测试（研究档 E13 可选配套）。
 *
 * 运行器 = vitest node 轨（vitest.config.ts include 逐件点名——查 12 纪律：
 * tools/*.test.mjs 不开通配、逐件入册；check-api 等五件同先例）。注意：
 * 入 npm test 门禁的是本**自举测试**；检查器本体（check-mock-targets.mjs）
 * 走 lint:mocks 独立 script 不并入四门禁（新检查器不并入四门禁纪律）。
 * 断言只比违规计数与消息形，不比全量输出。
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { scanViolations, stripComments } from './check-mock-targets.mjs';

/** 正形对照（三真实消费位的代表形——passthrough 单点白名单内不红） */
const PASS_THROUGH = [
  "vi.mock('node:crypto', async (importOriginal) => {",
  '  const actual = await importOriginal();',
  '  return { ...actual, randomBytes: (size) => Buffer.alloc(size, 0xab) };',
  '});',
  '',
].join('\n');

describe('stripComments——注释剥离保行位', () => {
  it('行注释/块注释抹空、字符串原样保、行号守恒', () => {
    const text = [
      'const a = 1; // vi.mock 注释词不咬',
      '/* 块注释',
      'vi.mock 不咬 */const b = "vi.mock(在串内)";',
      'const c = 2;',
    ].join('\n');
    const stripped = stripComments(text);
    const lines = stripped.split('\n');
    // 行号守恒（4 行），注释位（行 1/2/3 的注释段）不再含 vi.mock 词面
    assert.equal(lines.length, 4);
    assert.ok(!lines[0].includes('vi.mock'));
    assert.ok(!lines[1].includes('vi.mock'));
    assert.ok(!/vi\.mock\s+不咬/.test(lines[2]));
    // 串内文本保留（剥离只对注释——字符串是代码面）
    assert.ok(lines[2].includes('"vi.mock(在串内)"'));
    assert.ok(lines[3].includes('const c = 2;'));
  });

  it('模板串插值内的注释不被误剥、插值内的代码保留', () => {
    const text = 'const t = `a${x /* 串内注释 */ + 1}b`;';
    const stripped = stripComments(text);
    // 串内注释剥（保守），插值表达式 x + 1 保留、模板字面量边界不散
    assert.ok(stripped.includes('x'));
    assert.ok(stripped.includes('+ 1'));
    assert.ok(stripped.endsWith('`;'));
  });
});

describe('scanViolations——两查门（目标白名单 + passthrough 形）', () => {
  it('正形（白名单内 passthrough 单点）零违规', () => {
    assert.deepEqual(scanViolations(PASS_THROUGH), []);
  });

  it('白名单外目标红（file:line 定位——首行即 1）', () => {
    const violations = scanViolations(
      "const x = 1;\nvi.mock('../exec/index.js', async (importOriginal) => {\n  const actual = await importOriginal();\n  return { ...actual };\n});\n",
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.ok(violations[0].message.includes("不在白名单：'../exec/index.js'"));
  });

  it('白名单内零工厂（automock = 全行为替身）红', () => {
    const violations = scanViolations("vi.mock('node:crypto');\n");
    assert.equal(violations.length, 1);
    assert.ok(violations[0].message.includes('零工厂'));
  });

  it('白名单内整体替身（无 importOriginal / 无 ...actual spread）红', () => {
    const stub = "vi.mock('../issue/index.js', () => ({ createIssueService: fake }));\n";
    const violations = scanViolations(stub);
    assert.equal(violations.length, 1);
    assert.ok(violations[0].message.includes('非 passthrough 形'));
    // spread 缺席独立形（有 importOriginal 但不透传 actual）
    const noSpread =
      "vi.mock('node:crypto', async (importOriginal) => {\n  await importOriginal();\n  return { randomBytes: fake };\n});\n";
    assert.ok(scanViolations(noSpread)[0]?.message.includes('非 passthrough 形'));
  });

  it('动态目标（非字符串字面量首参）红——不可对拍即 fail-closed', () => {
    const violations = scanViolations('vi.mock(someDynamic);\n');
    assert.equal(violations.length, 1);
    assert.ok(violations[0].message.includes('非字符串字面量'));
  });

  it('注释位 vi.mock 词面不咬（ prose 形零违规）', () => {
    const text = ['// 本文件对 node:crypto 做文件级 vi.mock（randomBytes 钉值）', 'const a = 1;', ''].join('\n');
    assert.deepEqual(scanViolations(text), []);
  });
});
