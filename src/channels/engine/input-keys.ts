/**
 * 输入解码键名表与修饰解码（07 篇引擎节件 2 的数据面拆件——input.ts 状态机
 * 的纯查表函数集，无状态、无副作用）。
 *
 * 三张表 + 一个位域解码函数，全部承接 kitty 键盘协议规范与 legacy 功能键
 * 编码的规范值位（berry desktop 同源机制语义，代码从零独立重写——裁决⓪）。
 */
import type { KeyPhase } from './types.js';

/** 无修饰基线（mods 解码基准——所有修饰还原都以拷贝此基线起步） */
export const NO_MODS: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } = {
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};

/** CSI ~ 数字键名表（legacy 功能键编码：home/delete/F1-F12…） */
export const TILDE_KEYS: Record<number, string> = {
  1: 'home',
  2: 'insert',
  3: 'delete',
  5: 'pageup',
  6: 'pagedown',
  7: 'home',
  8: 'end',
  11: 'f1',
  12: 'f2',
  13: 'f3',
  14: 'f4',
  15: 'f5',
  17: 'f6',
  18: 'f7',
  19: 'f8',
  20: 'f9',
  21: 'f10',
  23: 'f11',
  24: 'f12',
  29: 'menu',
};

/** kitty CSI u 私用区功能键名表（kitty 规范 Functional key definitions——
 * 箭头 / 翻页 / 首尾 / 增删 57414-57426 区段） */
export const KITTY_PUA_KEYS: Record<number, string> = {
  57417: 'left',
  57418: 'right',
  57419: 'up',
  57420: 'down',
  57421: 'pageup',
  57422: 'pagedown',
  57423: 'home',
  57424: 'end',
  57425: 'insert',
  57426: 'delete',
};

/** CSI/SS3 字母终点键名表（A 上 / B 下 / C 右 / D 左 / H Home / F End / P-S F1-F4） */
export const LETTER_KEYS: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  E: 'begin',
  H: 'home',
  F: 'end',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};

/**
 * kitty 修饰参数（值 = 1+位域）→ 修饰键四元还原。
 * 位域：shift=1 / alt=2 / ctrl=4 / super8+hyper16+meta32 合并折叠进 meta
 * （本引擎修饰面只有四键——合并位不细分）。
 */
export function decodeMods(param: string | undefined): {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
} {
  const v = Number(param ?? '1') - 1;
  if (!Number.isFinite(v) || v <= 0) return { ...NO_MODS };
  return {
    shift: (v & 0b1) !== 0,
    alt: (v & 0b10) !== 0,
    ctrl: (v & 0b100) !== 0,
    meta: (v & 0b111000) !== 0,
  };
}

/**
 * kitty 事件型数字（冒号后缀域）→ 键相三值。
 * kitty 编码：1 = press（缺省）/ 2 = repeat / 3 = release；非法值按 press
 * 收口（宁保守不丢键）。
 */
export function decodePhase(evTypeNum: number): KeyPhase {
  if (evTypeNum === 2) return 'repeat';
  if (evTypeNum === 3) return 'release';
  return 'press';
}
