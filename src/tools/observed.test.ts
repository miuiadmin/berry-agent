/**
 * tools/observed 测试 — 写意图分派全矩阵 + edit 守卫 + 登记表（04 §7 CAS）。
 *
 * 纯逻辑单元（零 fs）：观察态 × 盘上状态 的 3×2 全组合逐格断言。
 */
import { describe, it, expect } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { ObservedFiles, requireObservedForEdit, resolveWriteIntent, statVersion } from './observed.js';

/** 断言抛出的 BaseError 携带指定码（02 §5.3——码是可编程判别面） */
function expectCode(fn: () => unknown, code: string): void {
  expect(fn).toThrow(BaseError);
  try {
    fn();
  } catch (err) {
    expect((err as BaseError).code).toBe(code);
  }
}

describe('statVersion', () => {
  it('指纹 = `${size}:${mtimeMs}` 组合', () => {
    expect(statVersion(12, 34.5)).toBe('12:34.5');
  });
});

describe('resolveWriteIntent（观察态 × 盘上状态全矩阵）', () => {
  it('未读 + 在场 → FS_NOT_OBSERVED（拒绝盲写在场文件）', () => {
    expectCode(() => resolveWriteIntent(undefined, { version: '1:1' }), 'FS_NOT_OBSERVED');
  });

  it('未读 + 不在 → create-if-absent（新建合法）', () => {
    expect(resolveWriteIntent(undefined, undefined)).toEqual({ kind: 'create-if-absent' });
  });

  it('absent 观察 + 在场 → FS_VERSION_CONFLICT（读后他方并发创建）', () => {
    expectCode(() => resolveWriteIntent({ state: 'absent' }, { version: '1:1' }), 'FS_VERSION_CONFLICT');
  });

  it('absent 观察 + 不在 → create-if-absent（读时不在，此刻创建合法）', () => {
    expect(resolveWriteIntent({ state: 'absent' }, undefined)).toEqual({ kind: 'create-if-absent' });
  });

  it('present 观察 + 不在 → FS_VERSION_CONFLICT（读后文件被删）', () => {
    expectCode(() => resolveWriteIntent({ state: 'present', version: '1:1' }, undefined), 'FS_VERSION_CONFLICT');
  });

  it('present 观察 + 指纹不符 → FS_VERSION_CONFLICT（读后被改动）', () => {
    expectCode(
      () => resolveWriteIntent({ state: 'present', version: '1:1' }, { version: '2:2' }),
      'FS_VERSION_CONFLICT',
    );
  });

  it('present 观察 + 指纹一致 → replace-if-version（带期望指纹）', () => {
    expect(resolveWriteIntent({ state: 'present', version: '5:5' }, { version: '5:5' })).toEqual({
      kind: 'replace-if-version',
      expectedVersion: '5:5',
    });
  });
});

describe('requireObservedForEdit（edit/delete 守卫）', () => {
  it('未读 → FS_NOT_OBSERVED（补丁编辑必须先 read）', () => {
    expectCode(() => requireObservedForEdit(undefined, { version: '1:1' }), 'FS_NOT_OBSERVED');
  });

  it('absent 观察 → FS_NOT_OBSERVED（读时不在也不满足前提）', () => {
    expectCode(() => requireObservedForEdit({ state: 'absent' }, undefined), 'FS_NOT_OBSERVED');
  });

  it('present 指纹一致 → 复用 resolveWriteIntent 的 replace 分支', () => {
    expect(requireObservedForEdit({ state: 'present', version: '3:3' }, { version: '3:3' })).toEqual({
      kind: 'replace-if-version',
      expectedVersion: '3:3',
    });
  });

  it('present 指纹不符 → FS_VERSION_CONFLICT（与 resolveWriteIntent 同判）', () => {
    expectCode(
      () => requireObservedForEdit({ state: 'present', version: '3:3' }, { version: '4:4' }),
      'FS_VERSION_CONFLICT',
    );
  });
});

describe('ObservedFiles 登记表', () => {
  it('present/absent 登记 + 读取 + 清空', () => {
    const files = new ObservedFiles();
    expect(files.get('/a')).toBeUndefined();
    files.observePresent('/a', '1:1');
    files.observeAbsent('/b');
    expect(files.get('/a')).toEqual({ state: 'present', version: '1:1' });
    expect(files.get('/b')).toEqual({ state: 'absent' });
    // 同键重登 = 最新观察胜（写后回填路径）
    files.observeAbsent('/a');
    expect(files.get('/a')).toEqual({ state: 'absent' });
    files.clear();
    expect(files.get('/a')).toBeUndefined();
  });
});
