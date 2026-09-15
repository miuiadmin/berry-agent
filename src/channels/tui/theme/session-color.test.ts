/**
 * 会话区分色单测（原 tui/theme.test.ts 迁入——批 10g 目录化）。
 *
 * sessionColor 是确定性纯函数（零配置零存储）——断言确定性 / 值域 / 非退化
 * 三性质，不断言具体散列值（散列无规范值面，具体值断言会锁死实现自由度）。
 */
import { describe, expect, it } from 'vitest';
import { sessionColor } from './session-color.js';

describe('sessionColor（会话短 id 散列映射 16 色板）', () => {
  it('确定性：同 id 多次调用恒同值', () => {
    for (const id of ['ab12cd', '0', 'ffff', 'a1b2c3d4']) {
      const first = sessionColor(id);
      for (let i = 0; i < 5; i++) expect(sessionColor(id)).toBe(first);
    }
  });

  it('值域 0-15（16 色板全域映射——brand 型收口在界内）', () => {
    for (let i = 0; i < 512; i++) {
      const n = sessionColor(`id${i}`) as number;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(15);
    }
  });

  it('非退化：批量不同 id 映射出多种颜色（散列均匀性宽松下界）', () => {
    const colors = new Set<number>();
    for (let i = 0; i < 64; i++) colors.add(sessionColor(`s${i.toString(16)}`) as number);
    expect(colors.size).toBeGreaterThan(4);
  });

  it('空串与单字符不炸（短 id 边界形）', () => {
    expect(() => sessionColor('')).not.toThrow();
    expect(() => sessionColor('f')).not.toThrow();
  });
});
