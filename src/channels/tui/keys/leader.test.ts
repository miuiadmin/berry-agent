/**
 * leader 前缀键纯态机测试（2026-10-05 ZCode TUI 对标批 B4——07 §4.1 B4 定形注）。
 *
 * 覆盖：arm 入态（五闸聚合）/ 三分支字母命中（text 主路 + ime 提交 + key
 * 防御位三路同语义）/ 窗内窗外惰性判 / 非匹配解除透传（吞零键）/ 带修饰
 * 不认 / 大小写不敏感 / 超时参缺省 / release·mouse·ime 预编辑透明 /
 * escape 取消 vs 忙态让路 / 合并游程余字素不丢（jump 待靶态同律）。
 * 上游 ZCode 此面零测试——本面为自建锁（机制语义照搬、测试面自持）。
 */
import { describe, expect, it } from 'vitest';
import type { InputEvent } from '../../engine/index.js';
import { LEADER_WINDOW_MS, resolveLeaderIntent, type LeaderGates, type LeaderState } from './leader.js';

/** 键事件构造（phase 缺省 press——release 位显式传） */
const k = (
  key: string,
  mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {},
  phase: 'press' | 'repeat' | 'release' = 'press',
): InputEvent => ({
  kind: 'key',
  key,
  ctrl: mods.ctrl === true,
  alt: mods.alt === true,
  shift: mods.shift === true,
  meta: mods.meta === true,
  phase,
});

/** 文本事件构造（裸字母走 text 事件——`?` 教学键同 transport） */
const t = (text: string): InputEvent => ({ kind: 'text', text });

/** ime 事件构造（committed 缺省 true——提交形；预编辑显式传 false） */
const ime = (text: string, committed = true): InputEvent => ({ kind: 'ime', text, committed });

/** 五闸四闸全开 + 闲态（基线形——各腿单独翻） */
const openGates: LeaderGates = { armGatesOpen: true, branchGatesOpen: true, busy: false };

/** 装排态构造（t0 时刻 arm——窗 [t0, t0+LEADER_WINDOW_MS]） */
const armedAt = (t0: number): LeaderState => ({ armedUntilMs: t0 + LEADER_WINDOW_MS });

describe('leader arm 键判（ctrl+x 硬编码——不走册解析）', () => {
  it('未待续 + 五闸开 → arm 入态；闸闭 → 透传零涉', () => {
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('x', { ctrl: true }), 1000, openGates)).toEqual({
      kind: 'arm',
    });
    const closed: LeaderGates = { ...openGates, armGatesOpen: false };
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('x', { ctrl: true }), 1000, closed)).toEqual({ kind: 'none' });
  });

  it('大小写不敏感（ctrl+X 同认）；带修饰（alt/shift/meta 任一）不认', () => {
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('X', { ctrl: true }), 1000, openGates)).toEqual({
      kind: 'arm',
    });
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('x', { ctrl: true, alt: true }), 1000, openGates)).toEqual({
      kind: 'none',
    });
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('x', { ctrl: true, shift: true }), 1000, openGates)).toEqual({
      kind: 'none',
    });
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('x', { ctrl: true, meta: true }), 1000, openGates)).toEqual({
      kind: 'none',
    });
  });

  it('裸 x（无 ctrl）非 arm 键——未待续零涉', () => {
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('x'), 1000, openGates)).toEqual({ kind: 'none' });
  });

  it('待续中再按 ctrl+x = 解除 + 透传（重按续窗由调用位两跳达成——本函数不产 arm）', () => {
    expect(resolveLeaderIntent(armedAt(1000), k('x', { ctrl: true }), 1500, openGates)).toEqual({ kind: 'disarm' });
  });
});

describe('leader 分支字母（b/m/h → jobs/model/help）', () => {
  it('text 主路三分支 + 大小写不敏感（shift 持字母同认）', () => {
    expect(resolveLeaderIntent(armedAt(1000), t('b'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'jobs',
      rest: '',
    });
    expect(resolveLeaderIntent(armedAt(1000), t('m'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'model',
      rest: '',
    });
    expect(resolveLeaderIntent(armedAt(1000), t('h'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'help',
      rest: '',
    });
    expect(resolveLeaderIntent(armedAt(1000), t('B'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'jobs',
      rest: '',
    });
  });

  it('ime 提交路同语义；预编辑（非 committed）透明零涉', () => {
    expect(resolveLeaderIntent(armedAt(1000), ime('m'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'model',
      rest: '',
    });
    expect(resolveLeaderIntent(armedAt(1000), ime('预', false), 1500, openGates)).toEqual({ kind: 'none' });
  });

  it('key 路防御位（jump 待靶态形——引擎地面态 text 恒达、key 路保底）', () => {
    expect(resolveLeaderIntent(armedAt(1000), k('b'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'jobs',
      rest: '',
    });
    expect(resolveLeaderIntent(armedAt(1000), k('H', { shift: true }), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'help',
      rest: '',
    });
  });

  it('带修饰不认分支（ctrl+b 等归编辑器语义）→ 解除透传', () => {
    expect(resolveLeaderIntent(armedAt(1000), k('b', { ctrl: true }), 1500, openGates)).toEqual({ kind: 'disarm' });
    expect(resolveLeaderIntent(armedAt(1000), k('b', { alt: true }), 1500, openGates)).toEqual({ kind: 'disarm' });
    expect(resolveLeaderIntent(armedAt(1000), k('b', { meta: true }), 1500, openGates)).toEqual({ kind: 'disarm' });
  });

  it('分支门闭（四闸——如 input-ask 应答窗开）→ 解除透传（字母入稿）', () => {
    const gated: LeaderGates = { ...openGates, branchGatesOpen: false };
    expect(resolveLeaderIntent(armedAt(1000), t('b'), 1500, gated)).toEqual({ kind: 'disarm' });
  });

  it('合并游程余字素不丢（jump 同律——首字素作分支、余字素交调用位补入稿）', () => {
    expect(resolveLeaderIntent(armedAt(1000), t('bm'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'jobs',
      rest: 'm',
    });
    expect(resolveLeaderIntent(armedAt(1000), t('b字'), 1500, openGates)).toEqual({
      kind: 'followup',
      branch: 'jobs',
      rest: '字',
    });
    // 首字素非分支字母（如 CJK）——整run 透传不劈
    expect(resolveLeaderIntent(armedAt(1000), t('字b'), 1500, openGates)).toEqual({ kind: 'disarm' });
  });
});

describe('leader 窗判（惰性到期——无自愈定时器位）', () => {
  it('窗界含端点（nowMs == armedUntilMs 仍在窗内）、窗外首事件解除', () => {
    expect(resolveLeaderIntent(armedAt(1000), t('b'), 1000 + LEADER_WINDOW_MS, openGates)).toEqual({
      kind: 'followup',
      branch: 'jobs',
      rest: '',
    });
    expect(resolveLeaderIntent(armedAt(1000), t('b'), 1000 + LEADER_WINDOW_MS + 1, openGates)).toEqual({
      kind: 'disarm',
    });
  });

  it('窗定值 2000（2 秒序窗定值锁——ctrl+d 双击窗共源位已随死面收口退役）', () => {
    expect(LEADER_WINDOW_MS).toBe(2000);
  });
});

describe('leader 解除与透明', () => {
  it('非匹配任意事件 = 解除 + 透传（吞零键——含层①②③先消费键）', () => {
    expect(resolveLeaderIntent(armedAt(1000), t('c'), 1500, openGates)).toEqual({ kind: 'disarm' });
    expect(resolveLeaderIntent(armedAt(1000), k('tab'), 1500, openGates)).toEqual({ kind: 'disarm' });
    expect(resolveLeaderIntent(armedAt(1000), k('d', { ctrl: true }), 1500, openGates)).toEqual({ kind: 'disarm' });
    expect(resolveLeaderIntent(armedAt(1000), { kind: 'paste', text: 'x' }, 1500, openGates)).toEqual({
      kind: 'disarm',
    });
  });

  it('release 相 / mouse 透明（kitty 轨按键释放非新意图——零状态变更）', () => {
    expect(resolveLeaderIntent(armedAt(1000), k('b', {}, 'release'), 1500, openGates)).toEqual({ kind: 'none' });
    expect(resolveLeaderIntent(armedAt(1000), k('x', { ctrl: true }, 'release'), 1500, openGates)).toEqual({
      kind: 'none',
    });
    expect(
      resolveLeaderIntent(
        armedAt(1000),
        {
          kind: 'mouse',
          phase: 'press',
          button: 'left',
          col: 1,
          row: 1,
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
        },
        1500,
        openGates,
      ),
    ).toEqual({ kind: 'none' });
  });

  it('escape 闲态 = 取消消费；忙态 = 解除让路层①打断（打断生命线优先）', () => {
    expect(resolveLeaderIntent(armedAt(1000), k('escape'), 1500, openGates)).toEqual({ kind: 'cancel' });
    const busy: LeaderGates = { ...openGates, busy: true };
    expect(resolveLeaderIntent(armedAt(1000), k('escape'), 1500, busy)).toEqual({ kind: 'disarm' });
  });

  it('escape 带修饰不认取消（归解除透传）', () => {
    expect(resolveLeaderIntent(armedAt(1000), k('escape', { ctrl: true }), 1500, openGates)).toEqual({
      kind: 'disarm',
    });
    expect(resolveLeaderIntent(armedAt(1000), k('escape', { shift: true }), 1500, openGates)).toEqual({
      kind: 'disarm',
    });
  });

  it('未待续非 arm 键恒零涉（none——路由零扰动）', () => {
    expect(resolveLeaderIntent({ armedUntilMs: null }, t('b'), 1500, openGates)).toEqual({ kind: 'none' });
    expect(resolveLeaderIntent({ armedUntilMs: null }, k('escape'), 1500, openGates)).toEqual({ kind: 'none' });
  });
});
