/**
 * 键位注册表测试（批 10i R5——纯函数直锁）。
 *
 * 覆盖：keyEventToBinding 规范串形、缺省册四形拒载（未知动作/不可覆盖/
 * 畸形键串/冲突）、缺省双绑放行（ctrl+d 分层消解既定形）、Keymap 匹配面
 * （meta 不入门、shift+enter 具名形）与 keyText 缺省回退。
 */
import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, Keymap, keyEventToBinding, resolveKeybindings, type KeyInput } from './registry.js';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, ...mods });

describe('keyEventToBinding 规范串', () => {
  it('修饰序恒 ctrl+alt+shift+ + 键名小写', () => {
    expect(keyEventToBinding(key('t', { ctrl: true }))).toBe('ctrl+t');
    expect(keyEventToBinding(key(']', { alt: true, ctrl: true }))).toBe('ctrl+alt+]');
    expect(keyEventToBinding(key('enter', { shift: true }))).toBe('shift+enter');
    expect(keyEventToBinding(key('T'))).toBe('t'); // 大写键名归小写（shift 修饰独立判）
  });

  it('meta 修饰不入门（cmd 家族留终端——返回 null）', () => {
    expect(keyEventToBinding(key('t', { meta: true }))).toBeNull();
    expect(keyEventToBinding(key('t', { ctrl: true, meta: true }))).toBeNull();
  });
});

describe('resolveKeybindings 缺省与覆盖校验', () => {
  it('无覆盖 = 缺省册直拷 + 零拒载', () => {
    const r = resolveKeybindings();
    expect(r.rejections).toEqual([]);
    expect(r.keysByAction.get('global.interrupt')).toEqual(['ctrl+c']);
    expect(r.keysByAction.get('editor.undo')).toEqual(['ctrl+-', 'ctrl+_']);
  });

  it('合法覆盖生效（动作键位整替）', () => {
    const r = resolveKeybindings({ 'thinking.toggle': 'ctrl+g' });
    expect(r.rejections).toEqual([]);
    expect(r.keysByAction.get('thinking.toggle')).toEqual(['ctrl+g']);
  });

  it('四形拒载之一：未知动作点名拒（其余照常）', () => {
    const r = resolveKeybindings({ 'no.such-action': 'ctrl+z', 'thinking.toggle': 'ctrl+g' });
    expect(r.rejections).toHaveLength(1);
    expect(r.rejections[0]).toMatchObject({ kind: 'unknown-action', actionId: 'no.such-action' });
    expect(r.keysByAction.get('thinking.toggle')).toEqual(['ctrl+g']); // 无辜条目不受连坐
  });

  it('四形拒载之二：不可覆盖动作（全局键生命线）', () => {
    const r = resolveKeybindings({ 'global.interrupt': 'ctrl+x' });
    expect(r.rejections[0]).toMatchObject({ kind: 'not-overridable', actionId: 'global.interrupt' });
    expect(r.keysByAction.get('global.interrupt')).toEqual(['ctrl+c']); // 回退缺省
  });

  it('四形拒载之三：畸形键串（修饰序错/未知具名键）', () => {
    const r = resolveKeybindings({ 'thinking.toggle': 'shift+ctrl+t', 'tools.toggle-expand': 'notakey' });
    expect(r.rejections.map((x) => x.kind)).toEqual(['malformed-binding', 'malformed-binding']);
    expect(r.keysByAction.get('thinking.toggle')).toEqual(['ctrl+t']); // 回退缺省
  });

  it('四形拒载之四：同键冲突整集对拍（非缺省集拒载、缺省双绑放行）', () => {
    // ctrl+d 缺省册双绑 {global.quit, editor.delete-forward}——分层消解既定形：
    // 把 thinking.toggle 挪到 ctrl+d 会造出新集 {quit, delete-forward, toggle} → 拒
    const r = resolveKeybindings({ 'thinking.toggle': 'ctrl+d' });
    expect(r.rejections[0]).toMatchObject({ kind: 'conflict', actionId: 'thinking.toggle', binding: 'ctrl+d' });
    expect(r.keysByAction.get('thinking.toggle')).toEqual(['ctrl+t']);
    // 缺省册自身 ctrl+d 双绑不属冲突（无覆盖时零拒载——上一用例已锁）
    const plain = resolveKeybindings({});
    expect(plain.rejections).toEqual([]);
  });

  it('双覆盖互相撞键 → 两条全拒（回退缺省、点名对家）', () => {
    const r = resolveKeybindings({ 'thinking.toggle': 'ctrl+g', 'tools.toggle-expand': 'ctrl+g' });
    expect(r.rejections).toHaveLength(2);
    expect(r.rejections.every((x) => x.kind === 'conflict')).toBe(true);
    expect(r.keysByAction.get('thinking.toggle')).toEqual(['ctrl+t']);
    expect(r.keysByAction.get('tools.toggle-expand')).toEqual(['ctrl+o']);
  });

  it('把动作挪离缺省键不构成冲突（原键位让空）', () => {
    const r = resolveKeybindings({ 'thinking.toggle': 'ctrl+g' });
    expect(r.rejections).toEqual([]);
    // ctrl+t 上不再有任何动作（thinking.toggle 已迁走）——倒排无越集
    const holders = ACTION_CATALOG.filter((def) => def.keys.includes('ctrl+t'));
    expect(holders).toHaveLength(1); // 册定义仍在（缺省源），解析面已迁
  });
});

describe('Keymap 消费面', () => {
  it('actionMatches 按当前键集命中（覆盖后随动）', () => {
    const map = new Keymap({ 'thinking.toggle': 'ctrl+g' });
    expect(map.actionMatches(key('t', { ctrl: true }), 'thinking.toggle')).toBe(false); // 旧键已迁
    expect(map.actionMatches(key('g', { ctrl: true }), 'thinking.toggle')).toBe(true);
    expect(map.actionMatches(key('g', { ctrl: true, meta: true }), 'thinking.toggle')).toBe(false); // meta 不入门
  });

  it('keyText 首键名单源（显示面消费；覆盖后随动）', () => {
    const map = new Keymap();
    expect(map.keyText('thinking.toggle')).toBe('ctrl+t');
    expect(map.keyText('tools.toggle-expand')).toBe('ctrl+o');
    expect(map.keyText('no.such')).toBe(''); // 未知动作诚实空串
    const remapped = new Keymap({ 'thinking.toggle': 'ctrl+g' });
    expect(remapped.keyText('thinking.toggle')).toBe('ctrl+g');
  });
});

describe('Keymap.actions 投影（批 10k——/help 键位册消费源）', () => {
  it('全册投影：id/scope/label/keys 四键齐 + 册序保持', () => {
    const views = new Keymap().actions;
    expect(views).toHaveLength(ACTION_CATALOG.length);
    expect(views.map((v) => v.id)).toEqual(ACTION_CATALOG.map((d) => d.id));
    const first = views[0]!;
    expect(first).toMatchObject({ id: 'global.interrupt', scope: 'global', label: '中断当前 run', keys: ['ctrl+c'] });
  });

  it('覆盖生效形随动（keys = 解析后键集非缺省）', () => {
    const views = new Keymap({ 'thinking.toggle': 'ctrl+g' }).actions;
    const toggle = views.find((v) => v.id === 'thinking.toggle')!;
    expect(toggle.keys).toEqual(['ctrl+g']);
  });

  it('拒载覆盖回退缺省键集（投影只见生效形）', () => {
    const views = new Keymap({ 'global.interrupt': 'ctrl+x' }).actions; // 不可覆盖拒载
    const interrupt = views.find((v) => v.id === 'global.interrupt')!;
    expect(interrupt.keys).toEqual(['ctrl+c']);
  });
});
