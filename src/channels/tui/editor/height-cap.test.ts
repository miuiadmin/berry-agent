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
    expect(presentedLineCount(1, 8, 0)).toBe(3); // 呈现最小高 3 钳底（五件批 A+B——内容不足 3 铺空行至 3）
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
    expect(presentedLineCount(1, 8, 8)).toBe(3); // 缩至内容 1——最小高 3 钳底（铺空行至 3）
    expect(presentedLineCount(1, 8, 3)).toBe(3); // 降 2（3→1）即缩——同钳
  });

  it('上次已超帽（帽收缩场景）不迟滞——跟随夹帽', () => {
    // 终端 resize 帽 8→5：lastShown 7 超 5，内容 6 → 直落帽内目标（不保持超帽值）
    expect(presentedLineCount(6, 5, 7)).toBe(5);
  });
});

describe('presentedLineCount 呈现最小高（五件批 A+B——内容不足 3 行铺空行至 3）', () => {
  it('全分支钳底 ≥3：空稿 / 增长位 / 迟滞保持位同钳', () => {
    expect(presentedLineCount(0, 5, 0)).toBe(3); // 空稿
    expect(presentedLineCount(2, 5, 0)).toBe(3); // 增长位（目标 2）同钳
    expect(presentedLineCount(2, 5, 2)).toBe(3); // 持平位（目标 2）同钳
  });

  it('帽语义不动：内容 ≥3 超帽夹帽（最小高 3 < 帽下界 5 恒不冲突）', () => {
    expect(presentedLineCount(4, 5, 0)).toBe(4);
    expect(presentedLineCount(7, 5, 0)).toBe(5);
    expect(presentedLineCount(10, 8, 0)).toBe(8);
  });

  it('帽 < 最小高退化形（测试固定帽）：帽辖上限优先（page 步幅与帽同源——帽语义不动承重旧不变式）', () => {
    expect(presentedLineCount(5, 2, 0)).toBe(2);
    expect(presentedLineCount(1, 2, 0)).toBe(2);
  });
});
