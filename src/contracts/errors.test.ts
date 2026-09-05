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
