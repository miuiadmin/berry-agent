/**
 * 编辑组件单测（事件分发端到端）：四路事件 → handleEvent 消费裁决——
 * 键位表（提交 / 换行 / 移动 / 删除族 / undo 双绑）、ctrl+c 透传、
 * ↑/↓ 历史触发判据、jump 两态、IME / paste 路、release 相忽略。
 */
import { describe, expect, it, vi } from 'vitest';
import { Editor } from './editor.js';

/** 键事件便捷构造 */
function key(
  k: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; phase?: 'press' | 'repeat' | 'release' } = {},
): {
  kind: 'key';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  phase: 'press' | 'repeat' | 'release';
} {
  return {
    kind: 'key',
    key: k,
    ctrl: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
    meta: false,
    phase: mods.phase ?? 'press',
  };
}

/** 文本事件 */
function text(t: string): { kind: 'text'; text: string } {
  return { kind: 'text', text: t };
}

describe('Editor 文本 / 键基础路', () => {
  it('text 事件插入 + onChange 携全文', () => {
    const editor = new Editor();
    const spy = vi.fn();
    editor.model.onChange = spy;
    expect(editor.handleEvent(text('hello'))).toBe(true);
    expect(editor.getText()).toBe('hello');
    expect(spy).toHaveBeenCalledWith('hello');
  });

  it('enter 提交：onSubmit 携 trim 文、框全清、入册历史', () => {
    const submitted: string[] = [];
    const editor = new Editor({ onSubmit: (t) => submitted.push(t) });
    editor.handleEvent(text('  hi  '));
    expect(editor.handleEvent(key('enter'))).toBe(true);
    expect(submitted).toEqual(['hi']);
    expect(editor.getText()).toBe('');
    // ↑ 回溯历史——证明已入册
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('hi');
  });

  it('空框 enter：消费但不回调', () => {
    const spy = vi.fn();
    const editor = new Editor({ onSubmit: spy });
    expect(editor.handleEvent(key('enter'))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('shift+enter 与 ctrl+j 换行', () => {
    const editor = new Editor();
    editor.handleEvent(text('ab'));
    editor.handleEvent(key('enter', { shift: true }));
    editor.handleEvent(key('j', { ctrl: true }));
    expect(editor.getText()).toBe('ab\n\n');
  });

  it('ctrl+c 透传不消费（归上层 abort 路）', () => {
    const editor = new Editor();
    editor.handleEvent(text('ab'));
    expect(editor.handleEvent(key('c', { ctrl: true }))).toBe(false);
    expect(editor.getText()).toBe('ab');
  });

  it('release 相忽略不消费', () => {
    const editor = new Editor();
    expect(editor.handleEvent(key('enter', { phase: 'release' }))).toBe(false);
  });

  it('未绑定键不消费（escape / tab / f1）', () => {
    const editor = new Editor();
    expect(editor.handleEvent(key('escape'))).toBe(false);
    expect(editor.handleEvent(key('tab'))).toBe(false);
    expect(editor.handleEvent(key('f1'))).toBe(false);
  });
});

describe('Editor 编辑键位', () => {
  it('backspace 删字符、ctrl+w 删词', () => {
    const editor = new Editor();
    editor.handleEvent(text('foo bar'));
    editor.handleEvent(key('backspace'));
    expect(editor.getText()).toBe('foo ba');
    editor.handleEvent(key('w', { ctrl: true }));
    expect(editor.getText()).toBe('foo ');
  });

  it('ctrl+u 删至行首、ctrl+k 删至行尾', () => {
    const editor = new Editor();
    editor.handleEvent(text('abcdef'));
    editor.handleEvent(key('left'));
    editor.handleEvent(key('left')); // col 4
    editor.handleEvent(key('u', { ctrl: true }));
    expect(editor.getText()).toBe('ef');
    editor.handleEvent(key('e', { ctrl: true }));
    editor.handleEvent(key('k', { ctrl: true }));
    expect(editor.getText()).toBe('ef');
  });

  it('undo 双绑：kitty 轨 ctrl+- 与 legacy 轨 ctrl+_', () => {
    const editor = new Editor();
    editor.handleEvent(text('abc'));
    expect(editor.handleEvent(key('-', { ctrl: true }))).toBe(true);
    expect(editor.getText()).toBe('');
    editor.handleEvent(text('xy'));
    expect(editor.handleEvent(key('_', { ctrl: true }))).toBe(true);
    expect(editor.getText()).toBe('');
  });

  it('词向移动 alt+b / alt+f', () => {
    const editor = new Editor();
    editor.handleEvent(text('ab cd'));
    editor.handleEvent(key('b', { alt: true }));
    expect(editor.model.getCursor().col).toBe(3);
    editor.handleEvent(key('b', { alt: true }));
    expect(editor.model.getCursor().col).toBe(0);
    editor.handleEvent(key('f', { alt: true }));
    expect(editor.model.getCursor().col).toBe(2);
  });

  it('pageup / pagedown 消费', () => {
    const editor = new Editor();
    editor.handleEvent(text('a\nb\nc\nd\ne'));
    expect(editor.handleEvent(key('pageup'))).toBe(true);
    expect(editor.handleEvent(key('pagedown'))).toBe(true);
  });
});

describe('Editor 历史触发判据（↑/↓）', () => {
  function editorWithHistory(): Editor {
    const editor = new Editor();
    editor.handleEvent(text('one'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('two'));
    editor.handleEvent(key('enter'));
    return editor;
  }

  it('空框 ↑ 回溯、连按向旧、↓ 回新、末回草稿', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('up')); // → 'two'（最新）
    expect(editor.getText()).toBe('two');
    editor.handleEvent(key('up')); // → 'one'
    expect(editor.getText()).toBe('one');
    editor.handleEvent(key('up')); // 尽头 no-op
    expect(editor.getText()).toBe('one');
    editor.handleEvent(key('down')); // → 'two'
    expect(editor.getText()).toBe('two');
    editor.handleEvent(key('down')); // → 草稿（空框）
    expect(editor.getText()).toBe('');
  });

  it('非首视觉行 ↑ 为移动非历史', () => {
    const editor = editorWithHistory();
    editor.handleEvent(text('hello'));
    editor.handleEvent(key('up')); // 单视觉行——moveUp no-op
    expect(editor.getText()).toBe('hello');
    expect(editor.model.isBrowsingHistory()).toBe(false);
  });

  it('行首光标 ↑ 触发历史（col===0 判据）', () => {
    const editor = editorWithHistory();
    editor.handleEvent(text('draft'));
    editor.handleEvent(key('a', { ctrl: true })); // 行首
    expect(editor.model.getCursor().col).toBe(0);
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('two');
  });
});

describe('Editor jump 词向两态', () => {
  it('ctrl+] 进入待靶、下一字符为跳转靶（text 路）', () => {
    const editor = new Editor();
    editor.handleEvent(text('foo bar baz'));
    editor.model.moveHome();
    expect(editor.handleEvent(key(']', { ctrl: true }))).toBe(true);
    expect(editor.handleEvent(text('b'))).toBe(true);
    expect(editor.model.getCursor().col).toBe(4);
    expect(editor.getText()).toBe('foo bar baz'); // 靶字符未入正文
  });

  it('escape 取消待靶、后续字符正常入文', () => {
    const editor = new Editor();
    editor.handleEvent(key(']', { ctrl: true }));
    editor.handleEvent(key('escape'));
    editor.handleEvent(text('x'));
    expect(editor.getText()).toBe('x');
  });

  it('ctrl+alt+] 反向跳', () => {
    const editor = new Editor();
    editor.handleEvent(text('foo bar'));
    editor.handleEvent(key(']', { ctrl: true, alt: true }));
    editor.handleEvent(text('f'));
    expect(editor.model.getCursor().col).toBe(0);
  });
});

describe('Editor IME 与粘贴', () => {
  it('组字增量挂预编辑、提交落正文清预编辑', () => {
    const editor = new Editor();
    editor.handleEvent({ kind: 'ime', text: '中', committed: false });
    expect(editor.model.pendingPreedit).toBe('中');
    expect(editor.getText()).toBe('');
    expect(editor.handleEvent({ kind: 'ime', text: '中文', committed: true })).toBe(true);
    expect(editor.model.pendingPreedit).toBeNull();
    expect(editor.getText()).toBe('中文');
  });

  it('粘贴整段入正文（多行直接呈现）', () => {
    const editor = new Editor();
    expect(editor.handleEvent({ kind: 'paste', text: 'a\r\nb' })).toBe(true);
    expect(editor.model.getLines()).toEqual(['a', 'b']);
  });
});
