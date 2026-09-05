/**
 * 迁移框架测试——normalizeMigrations 装配期校验（05 篇 §6.4）。
 * 校验失败面用普通 Error（装配期错误非注册码语义——与实现一致断言 message）。
 */
import { describe, expect, it } from 'vitest';
import { normalizeMigrations, type MigrationSpec } from './migrations.js';

const BASE = 1;

function spec(version: number, overrides: Partial<MigrationSpec> = {}): MigrationSpec {
  return { version, name: `v${version}`, sql: 'SELECT 1;', ...overrides };
}

describe('normalizeMigrations 装配期校验', () => {
  it('合法链：乱序输入 → 按 version 升序返回', () => {
    const chain = normalizeMigrations([spec(3), spec(2), spec(5)], BASE);
    expect(chain.map((m) => m.version)).toEqual([2, 3, 5]);
  });

  it('空链合法（恒空聚合——本批常态）', () => {
    expect(normalizeMigrations([], BASE)).toEqual([]);
  });

  it('version ≤ 基线 / 非整数 → 拒（基线之上才是迁移）', () => {
    expect(() => normalizeMigrations([spec(BASE)], BASE)).toThrowError(/大于基线/);
    expect(() => normalizeMigrations([spec(0)], BASE)).toThrowError(/大于基线/);
    expect(() => normalizeMigrations([spec(2.5)], BASE)).toThrowError(/整数/);
  });

  it('name 缺失 / sql 空 → 拒', () => {
    expect(() => normalizeMigrations([spec(2, { name: '' })], BASE)).toThrowError(/name 缺失/);
    expect(() => normalizeMigrations([spec(2, { sql: '   ' })], BASE)).toThrowError(/sql 为空/);
  });

  it('version 重复 → 拒（每版本至多一项）', () => {
    expect(() => normalizeMigrations([spec(2, { name: 'a' }), spec(2, { name: 'b' })], BASE)).toThrowError(/重复/);
  });
});
