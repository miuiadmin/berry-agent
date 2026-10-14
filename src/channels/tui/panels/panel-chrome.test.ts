/**
 * panel-chrome 公共步进件测试（挖掘 35 轮 B6——codex scroll_state 单步环绕/
 * 翻页夹取分立律 berry 化）：picker 族七件光标步进的单源纯函数锁——单步 ±1
 * 环绕（顶↑绕底、底↓绕顶）、大步（翻页/滚轮/端跳）仍夹取、空表守卫。
 */
import { describe, expect, it } from 'vitest';
import { stepCursorWrap } from './panel-chrome.js';

describe('stepCursorWrap 单步环绕步进（挖掘 35 轮 B6）', () => {
  it('单步 ±1 环绕：底行 ↓ 绕顶、顶行 ↑ 绕底、中间常规步进', () => {
    expect(stepCursorWrap(4, 1, 5)).toBe(0); // 尾行（4/5）↓——绕回首
    expect(stepCursorWrap(0, -1, 5)).toBe(4); // 首行 ↑——绕回尾
    expect(stepCursorWrap(2, 1, 5)).toBe(3); // 中间常规
    expect(stepCursorWrap(2, -1, 5)).toBe(1); // 中间常规
    expect(stepCursorWrap(0, 1, 1)).toBe(0); // 单条目表——环绕恒自身（↑↓ 不抛不断）
    expect(stepCursorWrap(0, -1, 1)).toBe(0);
  });

  it('大步仍夹取（翻页/滚轮/端跳——分立律：单步环绕 ≠ 大步环绕）', () => {
    expect(stepCursorWrap(1, 3, 5)).toBe(4); // +3 滚轮——尾夹取不绕
    expect(stepCursorWrap(3, -3, 5)).toBe(0); // -3 滚轮——首夹取不绕
    expect(stepCursorWrap(1, 99, 5)).toBe(4); // 翻页大步越界——尾夹取
    expect(stepCursorWrap(3, -99, 5)).toBe(0); // 翻页大步越界——首夹取
  });

  it('空表守卫（count=0 恒 0——调用方另有 length>0 门，本件内置防御位）', () => {
    expect(stepCursorWrap(0, 1, 0)).toBe(0);
    expect(stepCursorWrap(0, -1, 0)).toBe(0);
  });
});
