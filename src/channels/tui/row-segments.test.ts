/**
 * 单行左右双段预算排版单源单测（fx3 单源化推全）：锁面四件——
 * 右段先按预算 … 截断再右对齐（起列恒 ≥ 1）+ 预算 0 丢弃右段（收紧位）
 * + 左段保留位 ≤ 半窗 + 左段极长帽内 … 收口。
 * 修前红不在本件（新纯函数无「修前」）——该律的坏形红由五个消费件
 * （theme/sandbox/thinking/skills/session picker）窄窗测试承担；本件锁
 * 单源自身的边界与收紧位。
 */
import { describe, expect, it } from 'vitest';
import { fitRowSegments } from './row-segments.js';
import { stringWidth } from '../engine/index.js';

describe('fitRowSegments 右段预算律单源', () => {
  it('右段在预算内：原样放行——消费位起列 = width - rightWidth ≥ 1', () => {
    const fit = fitRowSegments('标签', 'v1.2.3', 20);
    expect(fit.right).toBe('v1.2.3');
    expect(fit.rightWidth).toBe(stringWidth('v1.2.3'));
    expect(20 - fit.rightWidth).toBeGreaterThanOrEqual(1); // 起列非负且恒 ≥ 1
  });

  it('右段超预算：整字截断加 … 收口——实占 ≤ 预算、起列恒 ≥ 1（负起列结构性封堵）', () => {
    const longRight = '极长描述'.repeat(10); // 40 列 >> 预算
    const width = 20;
    const fit = fitRowSegments('标签', longRight, width);
    expect(fit.right.endsWith('…')).toBe(true); // 省略形收口
    // 预算 = 20 - 1 - 左段保留位（左段 4 列 ≤ 半窗 10 → 保留 4）= 15
    expect(fit.rightWidth).toBeLessThanOrEqual(15);
    expect(width - fit.rightWidth).toBeGreaterThanOrEqual(1);
  });

  it('预算 0（窗宽 ≤ 2 且右段非空）：丢弃右段不放行原宽——收紧位（私拷贝形此处留负起列洞）', () => {
    // width 2：左段保留位 1 → 预算 2-1-1 = 0；私拷贝形原样放行右段 → 起列负值
    const fit2 = fitRowSegments('名', 'v1.0.0', 2);
    expect(fit2.right).toBe('');
    expect(fit2.rightWidth).toBe(0);
    // width 1：保留位 0 → 预算 0 同律
    const fit1 = fitRowSegments('名', 'v1.0.0', 1);
    expect(fit1.right).toBe('');
    expect(fit1.rightWidth).toBe(0);
  });

  it('极长左段：半窗只保右段预算下限——左段帽 = 右段实占后余宽（可越半窗）', () => {
    const longLeft = '很长'.repeat(20); // 80 列
    const fit = fitRowSegments(longLeft, '尾注', 20);
    // 右段预算下限 = 20 - 1 - 半窗 10 = 9 ≥ 尾注宽 4 → 右段原样放行
    expect(fit.right).toBe('尾注');
    expect(fit.rightWidth).toBe(4);
    // 左段帽 = 20 - 4 - 1 = 15（右段短时左段可越半窗——空间用满）
    expect(stringWidth(fit.left)).toBeLessThanOrEqual(15);
    expect(fit.left.endsWith('…')).toBe(true);
  });

  it('空右段（undefined/空串）：无右段——左段帽放宽为全窗', () => {
    for (const empty of [undefined, '']) {
      const fit = fitRowSegments('标签', empty, 10);
      expect(fit.right).toBe('');
      expect(fit.rightWidth).toBe(0);
      expect(fit.left).toBe('标签');
    }
    // 左段超全窗帽时 … 收口（无右段无间隔列）
    const fit = fitRowSegments('很长'.repeat(10), undefined, 10);
    expect(stringWidth(fit.left)).toBeLessThanOrEqual(10);
    expect(fit.left.endsWith('…')).toBe(true);
  });

  it('两段皆极长：左段帽内收口 + 右段预算内收口——总实占 ≤ 窗 + 间隔列恒在', () => {
    const fit = fitRowSegments('左'.repeat(30), '右'.repeat(30), 12);
    // 半窗 6：左 ≤ 6；右预算 = 12 - 1 - 6 = 5；两段 + 间隔 1 = 12 恰满
    expect(stringWidth(fit.left)).toBeLessThanOrEqual(6);
    expect(fit.rightWidth).toBeLessThanOrEqual(5);
    expect(stringWidth(fit.left) + 1 + fit.rightWidth).toBeLessThanOrEqual(12);
    expect(fit.left.endsWith('…')).toBe(true);
    expect(fit.right.endsWith('…')).toBe(true);
  });
});
