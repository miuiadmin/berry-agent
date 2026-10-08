import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
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

  // 前缀族锁原在此处（核心码 describe 内）——彼时执行序先于下方 describe 的
  // 全量 codes.ts 动态导入，断言跑在「注册表只有核心码」的时点：域码
  // （browser/checkpoint/compaction 等 codes.ts 注册面）永不被前缀锁覆盖
  // （34 域码不命中任何已声明前缀而 CI 长绿——2026-09-15 七役簇 E 勘正）。
  // 锁已移至全量导入之后（见下方 describe），此处不留核心码专属弱化版——
  // 全集锁是核心码锁的严格超集。
});

/* ---------------- 字面量 ⊆ 注册表机器对拍锁（02 §5.3 族规范 #2 执法腿） ---------------- */

describe('错误码字面量 ⊆ 注册表（02 §5.3 族规范 #2「CI 校验抛出/写入点一致」执法腿）', () => {
  // 注册侧全集（beforeAll 结构性前置）：fs 递归发现 src/**/codes.ts 逐份
  // 动态导入（副作用注册）——未来新增 codes.ts 面自动纳入、完备性程序自证；
  // 核心码由本文件顶部 import './index.js' 模块加载灌入。哨值 23 = 当前
  // 实有面数（净删面须同步改此哨——防扫描根意外缩水成假绿）。域码入册是
  // 本 describe 两张锁（前缀族锁 + 字面量锁）对全集生效的前提——钉在
  // beforeAll 而非首个 it 内，锁与导入的依赖成结构、不依赖 it 巧合序。
  const srcRoot = fileURLToPath(new URL('../', import.meta.url));
  beforeAll(async () => {
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
  });

  it('前缀族明列与全部注册码前缀一致（02 篇 §5.3 #1 文档性锚——域码入锁）', () => {
    // 全量注册码（核心 + 域）逐一须命中 ERROR_CODE_PREFIXES 某前缀——族
    // 清单与注册面的机器对拍（原锁只盖核心码，见上方 describe 尾注勘正）。
    for (const info of listErrorCodes()) {
      const matched = ERROR_CODE_PREFIXES.some((p) => info.code.startsWith(p));
      expect(matched, `${info.code} 应命中前缀族`).toBe(true);
    }
  });

  it('src + SDK 包源文七形字面量码集 ⊆ listErrorCodes() 注册表（未注册字面量即红）', () => {
    // 抛出/写入侧：七形静态字面量（new BaseError('…') / codedMessage('…') /
    // code: '…' / toolError('…',…) 工厂首参 / emitError('…') 首参 /
    // errorWithTail('[…]',…) 位置参数方括号前缀形 / new SdkError('…') 客户端
    // 载体首参——2026-09-14 第四役补中间三形：EXEC_ABORTED 即从 errorWithTail
    // 缝漏网的实证；2026-09-28 E1 双件套补第七形并把扫描根扩到 SDK 包源树
    // （packages/berry-agent-sdk/src 原结构性在锁面外——SDK_TRANSPORT 14 处
    // 实抛未注册而 CI 长绿即实证；SdkError 与 BaseError 同构：类不是词汇、
    // 码才是身份，构造首参即错误码身份位）。注释行同样被抓
    // ——特性非缺陷：注释里承诺的码也须在册（红证即用注释注入法）；动态拼
    // 接形（模板串/变量传递——SDK 包 new SdkError(frame.code, …) 线面错误帧
    // 码透传形同此边界）静态不可达，属本锁已知边界；跨行调用形（首参
    // 换行书写——http.ts 2xx 非帧形抛即此形，14 处中 1 处）同为边界。行内逐
    // 正则多命中全收（一行多码不漏）。
    // 方括号前缀形收窄在 errorWithTail 首参：warn('[CODE] …') 类日志文案
    // （COMPACTION_NO_CHANNEL / SCHEDULER_*_MISSING——非错误码发射面）不入门
    const registered = new Set(listErrorCodes().map((info) => info.code));
    // 个案豁免集：Node errno 系统码域（ErrnoException.code 的桩构造与
    // 断言形——fs.test/single-instance.test 构造 EACCES/ENOENT 族错误对象）
    // ——外来码域非本仓错误码族；新豁免须逐案点名注记（防豁免集长成后门）。
    // EADDRINUSE（2026-09-16 C4 开面失败锁批）：webui-bridge.test.ts:584 断言
    // node listen 错误的 errno（occupyTcpPort 真占位后 tcp 绑定失败直上抛的
    // 系统码）——与 ENOENT 同属 node errno 断言形，非错误码族发射面
    // EACCES（2026-09-28 第十五役 B3 缝）：plugin-install.test.ts 换代腿注入
    // errno 桩（rm 抛形构造 { code: 'EACCES' }——被 code:'…' 形扫中）——同
    // ENOENT 桩构造族，非错误码族发射面
    // EEXIST（2026-10-08 挖掘 20 轮件9）：single-instance.test.ts 竞窗桩构造
    //（独占写撞在场标记的 writeFileSync flag 'wx' errno 形——{ code: 'EEXIST' }
    // 桩注入与断言）——同 ENOENT 桩构造族，非错误码族发射面
    const externalSystemCodes = new Set(['ENOENT', 'EADDRINUSE', 'EACCES', 'EEXIST']);
    const patterns = [
      /new\s+BaseError\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
      /\bcodedMessage\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
      /\bcode:\s*'([A-Z][A-Z0-9_]+)'/g,
      /\btoolError\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
      /\bemitError\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
      /\berrorWithTail\s*\(\s*'\[([A-Z][A-Z0-9_]+)\]/g,
      // 第七形：SDK 客户端载体构造首参（packages/berry-agent-sdk——E1 入锁）
      /\bnew\s+SdkError\s*\(\s*'([A-Z][A-Z0-9_]+)'/g,
    ];
    // 扫描根双树：主仓 src/ + SDK 包源树（E1——原锁只扫 src/，npm SDK 包
    // 结构性在锁面外）；双根并扫后位点报账改按仓根相对径（单根相对径失义）。
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const scanRoots = [
      fileURLToPath(new URL('../', import.meta.url)),
      fileURLToPath(new URL('../../packages/berry-agent-sdk/src/', import.meta.url)),
    ];
    // SDK 根哨值 8 = 当前实有 .ts 面数（与上方 codes.ts 哨 23 同律——净删面须
    // 同步改此哨，防扫描根意外缩水/挪位成假绿）。
    const sdkTree = scanRoots[1];
    if (!sdkTree) throw new Error('SDK 包扫描根缺席——锁结构红');
    const sdkTsFaces = readdirSync(sdkTree).filter((f) => f.endsWith('.ts')).length;
    expect(sdkTsFaces).toBeGreaterThanOrEqual(8);
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
                sites.push(`${relative(repoRoot, full)}:${i + 1}`);
                unregistered.set(code, sites);
              }
            }
          }
        });
      }
    };
    for (const root of scanRoots) scan(root);
    const report = [...unregistered.entries()].map(([code, sites]) => `${code} @ ${sites.join(', ')}`);
    expect(report).toEqual([]);
  });
});
