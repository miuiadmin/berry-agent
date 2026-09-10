/**
 * 输入解码器 mouse 面单测（2026-09-11 鼠标解码批 mu-2——07 引擎节件 4 条款）。
 *
 * 覆盖：SGR 1006 全形（press/motion/release 三相 + 五钮白名单 + 修饰位域还原
 * + 坐标 1 基→0 基换算）/ 吞清单（66/67 水平滚轮、128-131 扩展按钮、低两位 3
 * 无按钮）——线值 8-11 alt 系修饰组合照常还原绝不入吞清单（冷读闸 blocker
 * 回归锁）/ 参数域畸形 fail-closed 整序吞 / X10 防御吞（bare CSI M 后三字节
 * 整吞 + 后续地面态照常 + 吞态跨 chunk 保持）/ onMouseLegacy 一次性降级回调
 * （per-entry 闩——重开 Engine 重新武装归装配层编舞测试）。
 */
import { describe, expect, it, vi } from 'vitest';
import { InputDecoder } from './input.js';
import type { InputEvent, MouseEvent } from './types.js';

/* ---------------- 助手 ---------------- */

/** SGR 报文便捷铸造（坐标 1 基直书——与终端报文同形；M 按压/按住、m 释放） */
function sgr(cb: number, col: number, row: number, final: 'M' | 'm' = 'M'): string {
  return `\x1b[<${cb};${col};${row}${final}`;
}

/** 排空取首个 mouse 事件（无则 null——吞清单断言的取件面） */
function mouseOf(events: InputEvent[]): MouseEvent | null {
  const first = events.find((ev) => ev.kind === 'mouse');
  return first === undefined ? null : (first as MouseEvent);
}

/** 装配：feed 一 chunk 排空取件（默认无降级回调） */
function rig(onMouseLegacy?: () => void) {
  const decoder = new InputDecoder(onMouseLegacy === undefined ? {} : { onMouseLegacy });
  const feed = (chunk: string): InputEvent[] => {
    decoder.feed(chunk);
    return decoder.take();
  };
  return { feed };
}

/* ---------------- SGR 1006 解码 ---------------- */

describe('InputDecoder SGR 1006 解码（CSI < Cb;Cx;Cy M/m）', () => {
  it('左键按压：三相 press + 坐标 1 基→0 基换算 + 修饰全 false', () => {
    const { feed } = rig();
    const ev = mouseOf(feed(sgr(0, 1, 1)));
    expect(ev).not.toBeNull();
    expect(ev).toMatchObject({
      kind: 'mouse',
      phase: 'press',
      button: 'left',
      col: 0,
      row: 0,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
  });

  it('释放：终点 m 判 release 相（终端报实际按钮）', () => {
    const { feed } = rig();
    const ev = mouseOf(feed(sgr(0, 5, 7, 'm')));
    expect(ev).toMatchObject({ phase: 'release', button: 'left', col: 4, row: 6 });
  });

  it('motion：位域 32 叠加 = 按住拖动（1002 button-event 形）', () => {
    const { feed } = rig();
    const ev = mouseOf(feed(sgr(32, 3, 3)));
    expect(ev).toMatchObject({ phase: 'motion', button: 'left', col: 2, row: 2 });
  });

  it('滚轮两相：64 上 / 65 下（wheel 无 release——press 一相到达）', () => {
    const { feed } = rig();
    expect(mouseOf(feed(sgr(64, 10, 10)))).toMatchObject({ phase: 'press', button: 'wheel-up', col: 9, row: 9 });
    expect(mouseOf(feed(sgr(65, 10, 10)))).toMatchObject({ phase: 'press', button: 'wheel-down' });
  });

  it('修饰位域还原：4 shift / 8 alt / 16 ctrl 叠加组合 + meta 恒 false（SGR 无 meta 位）', () => {
    const { feed } = rig();
    const ev = mouseOf(feed(sgr(4 | 8 | 16, 1, 1)));
    expect(ev).toMatchObject({ button: 'left', ctrl: true, alt: true, shift: true, meta: false });
  });

  it('线值 8-11 alt 系修饰组合照常还原绝不入吞清单（冷读闸 blocker 回归锁）', () => {
    const { feed } = rig();
    // 8 = alt+左键、9 = alt+中键、10 = alt+右键——位域读法还原（非扩展按钮）
    expect(mouseOf(feed(sgr(8, 1, 1)))).toMatchObject({ button: 'left', alt: true });
    expect(mouseOf(feed(sgr(9, 1, 1)))).toMatchObject({ button: 'middle', alt: true });
    expect(mouseOf(feed(sgr(10, 1, 1)))).toMatchObject({ button: 'right', alt: true });
    // 11 = alt + 低两位 3（无按钮）——不可归因吞（无按钮律非 alt 吞清单）
    expect(mouseOf(feed(sgr(11, 1, 1)))).toBeNull();
  });

  it('吞清单：66/67 水平滚轮左右整序吞（v1 不取水平滚）', () => {
    const { feed } = rig();
    expect(feed(sgr(66, 1, 1))).toEqual([]);
    expect(feed(sgr(67, 1, 1))).toEqual([]);
  });

  it('吞清单：128-131 扩展按钮 8-11 线值整序吞（含修饰叠加形）', () => {
    const { feed } = rig();
    expect(feed(sgr(128, 1, 1))).toEqual([]);
    expect(feed(sgr(129, 1, 1))).toEqual([]);
    expect(feed(sgr(130, 1, 1))).toEqual([]);
    expect(feed(sgr(131, 1, 1))).toEqual([]);
    expect(feed(sgr(128 | 16, 1, 1))).toEqual([]); // ctrl+扩展按钮叠加形同吞
  });

  it('吞清单：低两位 3 无按钮形不可归因吞（含 motion 叠加 35）', () => {
    const { feed } = rig();
    expect(feed(sgr(3, 1, 1))).toEqual([]);
    expect(feed(sgr(35, 1, 1))).toEqual([]); // 32+3 = 无按钮 motion
  });

  it('参数域畸形 fail-closed：坐标 0 越界 / 空段归 0 界外 / 非 M/m 终点整序吞', () => {
    const { feed } = rig();
    expect(feed(sgr(0, 0, 1))).toEqual([]); // 0 基坐标界外（col -1）
    expect(feed(sgr(0, 1, 0))).toEqual([]); // 0 基坐标界外（row -1）
    expect(feed('\x1b[<0;;1M')).toEqual([]); // 空列段 Number('')=0 → 界外吞
    expect(feed('\x1b[<0;1;1X')).toEqual([]); // 终点非 M/m——整序吞
    // ECMA-48 字节类事实：非参数字节（如 'a'）即终点——序列在彼处终结，
    // 尾段是地面态正文而非 mouse 报文（零 mouse 事件 = fail-closed 真值面）
    const leaked = feed('\x1b[<a;1;1M');
    expect(leaked.some((ev) => ev.kind === 'mouse')).toBe(false);
    expect(leaked.every((ev) => ev.kind === 'text')).toBe(true);
  });

  it('SGR 报文不误产按键事件（与 kitty 字母终点路不冲突）', () => {
    const { feed } = rig();
    const events = feed(sgr(0, 1, 1));
    expect(events).toHaveLength(1); // 只有 mouse——无 key/text 伴生
    expect(events[0]!.kind).toBe('mouse');
    // 带参 CSI M（如 CSI 1 M）不走 X10 判据也不产事件（判据 = params 空 + 终点 M）
    expect(feed('\x1b[1M')).toEqual([]);
  });
});

/* ---------------- X10 防御吞 + 运行时降级 ---------------- */

describe('InputDecoder X10 防御吞 + onMouseLegacy 降级回调', () => {
  it('bare CSI M 后三字节整吞不产事件；其后地面态照常（text 不被坐标字节污染）', () => {
    const { feed } = rig();
    // X10 形：ESC [ M + 三坐标字节（0x20+ 可打印区间——不吞会伪造 text/按键）
    const events = feed('\x1b[M !"abc');
    expect(events.filter((ev) => ev.kind === 'mouse')).toEqual([]); // 零 mouse 事件
    expect(events.map((ev) => (ev.kind === 'text' ? ev.text : ev.kind))).toContain('abc'); // 后续 text 照常
  });

  it('X10 拆 chunk：吞态跨 chunk 保持（三字节分两段喂）', () => {
    const { feed } = rig();
    expect(feed('\x1b[M')).toEqual([]); // 半序列——吞态挂起
    expect(feed(' !')).toEqual([]); // 前两坐标字节
    const events = feed('"xyz'); // 末坐标字节 + 后续正文
    expect(events.map((ev) => (ev.kind === 'text' ? ev.text : ev.kind))).toContain('xyz');
  });

  it('onMouseLegacy 首达恰一次（per-entry 闩）——二次 X10 不再报', () => {
    const cb = vi.fn();
    const { feed } = rig(cb);
    feed('\x1b[M !"');
    feed('\x1b[M !"'); // 闩后不再报
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('SGR 报文不触发 onMouseLegacy（判据可靠——只有 X10 形报降级）', () => {
    const cb = vi.fn();
    const { feed } = rig(cb);
    feed(sgr(0, 1, 1));
    expect(cb).not.toHaveBeenCalled();
  });

  it('回调缺席安全（吞照常——装配可不接降级）', () => {
    const { feed } = rig();
    expect(() => feed('\x1b[M !"')).not.toThrow();
  });
});
