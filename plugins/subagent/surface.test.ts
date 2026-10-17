/**
 * 派生工具面三件测试（04 §10）：五名结构性剔除/白名单交集/预检闸缺口
 * （含 availableTools 缺席 + requires 在场的 fail-closed 全列档）。
 */
import { describe, expect, it } from 'vitest';
import { deriveToolSurface, findPrecheckGaps, intersectToolWhitelist } from './surface.js';

describe('deriveToolSurface 五名结构性剔除', () => {
  it('fs 四名 + bash 剔除，其余保序；白名单含排除名 = 结构性剔除不报错', () => {
    expect(deriveToolSurface(['read', 'write', 'edit', 'ls', 'bash'])).toEqual([]);
    expect(deriveToolSurface(['read', 'grep', 'bash', 'web', 'edit'])).toEqual(['grep', 'web']);
    expect(deriveToolSurface(['agent', 'todo'])).toEqual(['agent', 'todo']);
    expect(deriveToolSurface([])).toEqual([]);
  });
});

describe('intersectToolWhitelist 交集执法', () => {
  it('undefined = 全派生面；[] = 空面；交集保派生面序', () => {
    const derived = ['grep', 'web', 'todo'];
    expect(intersectToolWhitelist(derived, undefined)).toEqual(['grep', 'web', 'todo']);
    expect(intersectToolWhitelist(derived, [])).toEqual([]);
    // 交集 = 派生面 ∩ 白名单（白名单序不改变派生面序）
    expect(intersectToolWhitelist(derived, ['todo', 'grep', 'ls'])).toEqual(['grep', 'todo']);
    // 白名单含排除名（已被派生面剔除）——交集自然不含，不报错
    expect(intersectToolWhitelist(derived, ['bash', 'web'])).toEqual(['web']);
  });
});

describe('findPrecheckGaps 预检闸', () => {
  it('requires 缺席 = 无缺口；全在场 = 空缺口', () => {
    expect(findPrecheckGaps(undefined, ['grep', 'web'])).toEqual([]);
    expect(findPrecheckGaps([], ['grep', 'web'])).toEqual([]);
    expect(findPrecheckGaps(['grep', 'web'], ['grep', 'web', 'todo'])).toEqual([]);
  });

  it('判据 = 全父工具面（非派生面）：requires 含被剔除的 bash 也算在场', () => {
    // bash 在父面（availableTools 原值）——前置要求按宿主工具面判，与五名剔除正交
    expect(findPrecheckGaps(['bash', 'grep'], ['read', 'bash', 'grep'])).toEqual([]);
    expect(findPrecheckGaps(['lsp', 'grep'], ['read', 'bash', 'grep'])).toEqual(['lsp']);
  });

  it('fail-closed：availableTools 缺席 + requires 在场 → 全列缺口', () => {
    expect(findPrecheckGaps(['grep', 'lsp'], undefined)).toEqual(['grep', 'lsp']);
  });
});
