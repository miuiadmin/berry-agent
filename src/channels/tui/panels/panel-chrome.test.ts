/**
 * panel-chrome 公共步进件测试（挖掘 35 轮 B6——codex scroll_state 单步环绕/
 * 翻页夹取分立律 berry 化）：picker 族光标步进与溢出指示视口收敛的单源纯
 * 函数锁——单步 ±1 环绕（顶↑绕底、底↓绕顶）、大步（翻页/滚轮/端跳）仍
 * 夹取、空表守卫；三行预留收窄窗（视口 ≥3 且溢出才立边行、光标逐轮重夹
 * 取三轮封顶、条目+边行实占恰满视口）。
 */
import { describe, expect, it } from 'vitest';
import { fitIndicatorViewport, stepCursorWrap } from './panel-chrome.js';

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

describe('fitIndicatorViewport 溢出指示视口收敛（39 池件 S——三行预留收窄窗单源）', () => {
  it('矮窗/不溢出零边行：on=false 原窗直排（cap=viewHeight、offset 透传）', () => {
    expect(fitIndicatorViewport(2, 0, 1, 5)).toEqual({ offset: 0, cap: 2, on: false }); // 视口 <3 行零边行
    expect(fitIndicatorViewport(3, 0, 1, 3)).toEqual({ offset: 0, cap: 3, on: false }); // 恰满不溢出
    expect(fitIndicatorViewport(8, 3, 5, 8)).toEqual({ offset: 3, cap: 8, on: false }); // 中窗不溢出透传
  });

  it('首窗只立下边行：无上预留 + 下预留 1（cap=4、4+1 恰满 5）', () => {
    expect(fitIndicatorViewport(5, 0, 0, 20)).toEqual({ offset: 0, cap: 4, on: true });
  });

  it('中段双边行：上/下各预留 1（cap=viewHeight-2=3、1+3+1 恰满 5）', () => {
    expect(fitIndicatorViewport(5, 5, 6, 20)).toEqual({ offset: 5, cap: 3, on: true });
  });

  it('尾窗下边行退役：窗下余量 0 不再下预留（cap=4、上边行+4 恰满 5）', () => {
    expect(fitIndicatorViewport(5, 16, 18, 20)).toEqual({ offset: 16, cap: 4, on: true });
  });

  it('光标越窗提窗/压窗：预留翻转后逐轮重收敛（三轮封顶内的钳位语义）', () => {
    // 提窗：cursor=2 远低于 offset=10 → off 提回光标（上边行随 off>0 再立、cap 收敛 3）
    expect(fitIndicatorViewport(5, 10, 2, 20)).toEqual({ offset: 2, cap: 3, on: true });
    // 压窗：cursor=19 越出 offset=0 收窄窗 → off 压至尾窗（尾余量 0 下边行退役）
    expect(fitIndicatorViewport(5, 0, 19, 20)).toEqual({ offset: 16, cap: 4, on: true });
  });

  it('收敛不动点不变式：产出 offset 复跑稳定 + 光标恒在收窄窗内（含 on=false 域）', () => {
    const cases: Array<[number, number, number, number]> = [
      [5, 0, 19, 20],
      [5, 10, 2, 20],
      [9, 4, 0, 30],
      [9, 25, 29, 30],
      [4, 1, 3, 12],
      [3, 0, 7, 8],
    ];
    for (const [vh, off0, cur, count] of cases) {
      const first = fitIndicatorViewport(vh, off0, cur, count);
      const second = fitIndicatorViewport(vh, first.offset, cur, count);
      expect(second).toEqual(first); // 三轮封顶——复跑不动点（防不收敛摆动）
      expect(cur).toBeGreaterThanOrEqual(first.offset);
      expect(cur).toBeLessThan(first.offset + first.cap); // 预留行不遮在选行
    }
  });
});
