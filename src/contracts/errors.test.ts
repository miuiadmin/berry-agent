import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ERROR_CODE_PREFIXES,
  getErrorCodeInfo,
  isKnownErrorCode,
  listErrorCodes,
  registerErrorCodes,
} from './index.js';

describe('BaseError 单一错误基类', () => {
  it('承载 { code, message, cause? } 三字段', () => {
    const err = new BaseError('SESSION_UNKNOWN_EVENT_TYPE', '词汇检查红', { cause: new Error('底因') });
    expect(err).toBeInstanceOf(BaseError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SESSION_UNKNOWN_EVENT_TYPE');
    expect(err.message).toBe('词汇检查红');
    expect(err.cause).toBeInstanceOf(Error);
    // name 覆写为类名（class extends Error 缺省 'Error'——须显式覆写）
    expect(err.name).toBe('BaseError');
  });

  it('cause 可缺席（可选字段）', () => {
    const err = new BaseError('HOST_DATA_DIR_BUSY', '单活跃机拒启');
    expect(err.cause).toBeUndefined();
  });

  it('catch 按 code 分派（码是身份、类只作载体——族规范 #3）', () => {
    const thrower = () => {
      throw new BaseError('PLUGIN_SHAPE_INVALID', '入口形状无效');
    };
    try {
      thrower();
      expect.unreachable();
    } catch (err) {
      // 一律按 code 分派：instanceof 只认基类，永不认「每码一类」
      if (err instanceof BaseError && err.code === 'PLUGIN_SHAPE_INVALID') return;
      expect.unreachable();
    }
  });
});

describe('错误码注册表', () => {
  it('宿主核心码首批已注册且可枚举（规范定名者全列）', () => {
    const codes = listErrorCodes().map((c) => c.code);
    for (const expected of [
      'SESSION_UNKNOWN_EVENT_TYPE',
      'SESSION_EVENT_OVER_BUDGET',
      'SESSION_CORE_TYPE_FORBIDDEN',
      'HOST_DATA_DIR_BUSY',
      'HOST_ERROR_CODE_CONFLICT',
      'HOST_EVENT_TYPE_CONFLICT',
      'PLUGIN_SHAPE_INVALID',
    ]) {
      expect(codes).toContain(expected);
      expect(isKnownErrorCode(expected)).toBe(true);
    }
    // 目录条目带归属与中文描述（CI 对账与目录生成的依据）
    expect(getErrorCodeInfo('HOST_DATA_DIR_BUSY')?.module).toBe('host');
    expect(getErrorCodeInfo('SESSION_UNKNOWN_EVENT_TYPE')?.description).toBeTruthy();
  });

  it('未注册码判别为假（catch 面兜底路径）', () => {
    expect(isKnownErrorCode('TOOL_NOT_YET_REGISTERED')).toBe(false);
    expect(getErrorCodeInfo('NO_SUCH_CODE')).toBeUndefined();
  });

  it('registerErrorCodes 扩展入口：注册后即已知（插件码显式注册纪律——临时码带规范前缀）', () => {
    registerErrorCodes([{ code: 'PLUGIN_TEST_DEMO', module: 'test-plugin', description: '测试用例临时码' }]);
    expect(isKnownErrorCode('PLUGIN_TEST_DEMO')).toBe(true);
  });

  it('同码重复注册抛 HOST_ERROR_CODE_CONFLICT（fail-loud 防两方抢码）', () => {
    expect(() =>
      registerErrorCodes([{ code: 'SESSION_EVENT_OVER_BUDGET', module: 'host', description: '伪造宿主码' }]),
    ).toThrowError(BaseError);
    try {
      registerErrorCodes([{ code: 'SESSION_EVENT_OVER_BUDGET', module: 'host', description: '伪造宿主码' }]);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('HOST_ERROR_CODE_CONFLICT');
        expect(err.message).toContain('SESSION_EVENT_OVER_BUDGET');
        return;
      }
      expect.unreachable();
    }
  });

  it('前缀族明列与核心码前缀一致（02 篇 §5.3 #1 文档性锚）', () => {
    for (const info of listErrorCodes()) {
      const matched = ERROR_CODE_PREFIXES.some((p) => info.code.startsWith(p));
      expect(matched, `${info.code} 应命中前缀族`).toBe(true);
    }
  });
});

/* ---------------- 字面量 ⊆ 注册表机器对拍锁（02 §5.3 族规范 #2 执法腿） ---------------- */

describe('错误码字面量 ⊆ 注册表（02 §5.3 族规范 #2「CI 校验抛出/写入点一致」执法腿）', () => {
  it('src 全源文三形字面量码集 ⊆ listErrorCodes() 注册表（未注册字面量即红）', async () => {
    // 注册侧全集：fs 递归发现 src/**/codes.ts 逐份动态导入（副作用注册）——
    // 未来新增 codes.ts 面自动纳入、完备性程序自证；核心码由本文件顶部
    // import './index.js' 模块加载灌入。哨值 23 = 当前实有面数（净删面须
    // 同步改此哨——防扫描根意外缩水成假绿）
    const srcRoot = fileURLToPath(new URL('../', import.meta.url));
    const codeModules: string[] = [];
    const collect = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) collect(join(dir, entry.name));
        else if (entry.name === 'codes.ts') codeModules.push(join(dir, entry.name));
      }
    };
    collect(srcRoot);
    expect(codeModules.length).toBeGreaterThanOrEqual(23);
    for (const mod of codeModules) await import(pathToFileURL(mod).href);

    // 抛出/写入侧：三形静态字面量（new BaseError('…') / codedMessage('…') /
    // code: '…'）。注释行同样被抓——特性非缺陷：注释里承诺的码也须在册
    // （红证即用注释注入法）；动态拼接形（模板串/变量传递）静态不可达，
    // 属本锁已知边界。行内逐正则多命中全收（一行多码不漏）
    const registered = new Set(listErrorCodes().map((info) => info.code));
    // 个案豁免集：Node errno 系统码域（ErrnoException.code 的桩构造与
    // 断言形——fs.test/single-instance.test 构造 EACCES/ENOENT 族错误对象）
    // ——外来码域非本仓错误码族；新豁免须逐案点名注记（防豁免集长成后门）
    const externalSystemCodes = new Set(['ENOENT']);
    const patterns = [
      /new\s+BaseError\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
      /\bcodedMessage\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
      /\bcode:\s*'([A-Z][A-Z0-9_]+)'/g,
    ];
    const unregistered = new Map<string, string[]>(); // code -> 位点清单（文件:行）
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          for (const re of patterns) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(line)) !== null) {
              const code = m[1]!;
              if (!registered.has(code) && !externalSystemCodes.has(code)) {
                const sites = unregistered.get(code) ?? [];
                sites.push(`${relative(srcRoot, full)}:${i + 1}`);
                unregistered.set(code, sites);
              }
            }
          }
        });
      }
    };
    scan(srcRoot);
    const report = [...unregistered.entries()].map(([code, sites]) => `${code} @ ${sites.join(', ')}`);
    expect(report).toEqual([]);
  });
});
