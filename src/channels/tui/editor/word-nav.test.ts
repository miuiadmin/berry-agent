/**
 * 词级导航直锁单测（findWordBackward / findWordForward 纯函数面）：
 * 整词跳 / 词内 ASCII 标点切边 / 标点 run 整跳 / 尾空白与前导空白 /
 * 中文词典切分 / 空串与护栏越界形。断言值经 node 24（CI 钉定版）实测校准
 * ——中文词界依赖 ICU 词典（node ≥24 full-icu，与 engines 钉位一致）。
 */
import { describe, expect, it } from 'vitest';
import { findWordBackward, findWordForward } from './word-nav.js';

describe('findWordBackward 向后一词', () => {
  it('整词跳：词尾与词中起点同落词首', () => {
    expect(findWordBackward('hello world', 11)).toBe(6); // 词尾起跳
    expect(findWordBackward('hello world', 8)).toBe(6); // 词中起跳（"wo" 内）
  });

  it('连续后退到串首', () => {
    // 11 → 6（world 词首）→ 0（hello 词首）：逐词后退终到 0
    expect(findWordBackward('hello world', findWordBackward('hello world', 11))).toBe(0);
  });

  it('跳尾部空白：空白段整体越过', () => {
    expect(findWordBackward('foo.bar ', 8)).toBe(4); // 跳 ' ' + 词内标点切到 '.' 后
    expect(findWordBackward('hello ', 6)).toBe(0); // 跳尾空白后词删净归 0
    expect(findWordBackward('   ', 3)).toBe(3 - 3); // 全空白串退到 0
  });

  it('词内 ASCII 标点：切到最近标点之后', () => {
    expect(findWordBackward('foo.bar', 7)).toBe(4); // 一步停在 '.' 与 'b' 之间
    expect(findWordBackward('foo.bar', 4)).toBe(3); // 再退一步：尾部 '.' 标点段弹出
    expect(findWordBackward('foo_bar', 7)).toBe(4); // 下划线同为 ASCII 标点（词整段切）
  });

  it('标点 run 整段跳', () => {
    // 光标在 'abc !!! ' 尾：跳尾空白 + 三个 '!' 逐段弹净 → 停 '!' 串前
    expect(findWordBackward('abc !!! def', 8)).toBe(4);
  });

  it('中文：词典切词逐词后退（UTF-16 下标）', () => {
    expect(findWordBackward('你好世界', 4)).toBe(2); // '世界' 一词
    expect(findWordBackward('你好世界', 2)).toBe(0); // '你好' 一词
    // 中西混排：'a中b' 三段各一词，从串尾退一字素
    expect(findWordBackward('a中b', 3)).toBe(2);
  });

  it('护栏边界：非正光标归 0、空串归 0', () => {
    expect(findWordBackward('', 0)).toBe(0);
    expect(findWordBackward('hello', 0)).toBe(0);
    expect(findWordBackward('hello', -3)).toBe(0);
  });
});

describe('findWordForward 向前一词', () => {
  it('整词跳：词首与词中起点同落词尾', () => {
    expect(findWordForward('hello world', 0)).toBe(5);
    expect(findWordForward('hello world', 1)).toBe(5); // 词中起跳同落词尾
  });

  it('跳前导空白：空白段整体越过', () => {
    expect(findWordForward('hello world', 5)).toBe(11); // ' ' + 'world'
    expect(findWordForward('  foo', 0)).toBe(5); // 前导空白 + 整词（词尾即串尾）
    expect(findWordForward('   ', 0)).toBe(3); // 只有空白——停串尾
  });

  it('词内 ASCII 标点：切到首个标点之前', () => {
    expect(findWordForward('foo.bar baz', 0)).toBe(3); // 一步停在 'f' 与 '.' 之间
    expect(findWordForward('foo.bar baz', 3)).toBe(4); // 再进一步：'.' 标点段弹出
  });

  it('标点 run 整段跳', () => {
    // 光标在 'abc' 尾：跳 ' ' + '!!!' 整串 → 停第二空格前
    expect(findWordForward('abc !!! def', 3)).toBe(7);
  });

  it('中文：词典切词逐词前进（UTF-16 下标）', () => {
    expect(findWordForward('你好世界', 0)).toBe(2);
    expect(findWordForward('你好世界', 2)).toBe(4);
    // 中西混排：'你好' 后跳 ' ' + 'world' 落串尾
    expect(findWordForward('你好 world', 2)).toBe(8);
  });

  it('护栏边界：光标不小于串长即停串尾、空串归 0', () => {
    expect(findWordForward('', 0)).toBe(0);
    expect(findWordForward('hello', 5)).toBe(5);
    expect(findWordForward('hello', 99)).toBe(5);
  });
});
