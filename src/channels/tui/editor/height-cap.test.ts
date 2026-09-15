/**
 * 高度帽单测（07 §4.1 R3 批 10j）：帽公式 + 迟滞带决策纯函数直锁。
 */
import { describe, expect, it } from 'vitest';
import { editorHeightCap, presentedLineCount } from './height-cap.js';

describe('editorHeightCap 帽公式', () => {
  it('max(5, rows×0.3)——小视口托底 5、大视口 30% 取整', () => {
    expect(editorHeightCap(10)).toBe(5); // 3 → 托底 5
    expect(editorHeightCap(16)).toBe(5); // 4.8 → 托底 5
    expect(editorHeightCap(17)).toBe(5); // 5.1 → floor 5
    expect(editorHeightCap(20)).toBe(6);
    expect(editorHeightCap(50)).toBe(15);
    expect(editorHeightCap(100)).toBe(30);
  });
});

describe('presentedLineCount 迟滞带', () => {
  it('增长即时跟手（夹帽）', () => {
    expect(presentedLineCount(1, 8, 0)).toBe(1);
    expect(presentedLineCount(4, 8, 2)).toBe(4);
    expect(presentedLineCount(10, 8, 6)).toBe(8); // 超帽夹 8
    expect(presentedLineCount(10, 8, 8)).toBe(8);
  });

  it('恰降 1 行保持上次（迟滞——空白行垫底）', () => {
    expect(presentedLineCount(7, 8, 8)).toBe(8); // 8 → 7 保持 8
    expect(presentedLineCount(2, 8, 3)).toBe(3); // 3 → 2 保持 3
  });

  it('降 2 行及以上跟随缩', () => {
    expect(presentedLineCount(6, 8, 8)).toBe(6);
    expect(presentedLineCount(1, 8, 8)).toBe(1);
    expect(presentedLineCount(1, 8, 3)).toBe(1); // 降 2（3→1）即缩
  });

  it('上次已超帽（帽收缩场景）不迟滞——跟随夹帽', () => {
    // 终端 resize 帽 8→5：lastShown 7 超 5，内容 6 → 直落帽内目标（不保持超帽值）
    expect(presentedLineCount(6, 5, 7)).toBe(5);
  });
});
