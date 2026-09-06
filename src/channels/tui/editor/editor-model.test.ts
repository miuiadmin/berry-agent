/**
 * 编辑模型单测：状态机全景——插入 / 字素删除 / 词级 / 行删除 / 移动族
 * （含视觉行 sticky 列——显示列制 CJK 对齐）/ undo 合并 / 输入历史 /
 * IME 预编辑 / jump 词向 / 翻页。纯逻辑直测（零渲染依赖）。
 */
import { describe, expect, it, vi } from 'vitest';
import { EditorModel } from './editor-model.js';

/** 便捷：建模型并灌入多行文本（光标归尾） */
function modelWith(text: string, layoutWidth = 80): EditorModel {
  const m = new EditorModel();
  m.setText(text);
  m.setLayoutWidth(layoutWidth);
  return m;
}

describe('EditorModel 插入路', () => {
  it('单段插入：落位与光标', () => {
    const m = new EditorModel();
    m.insertText('abc');
    expect(m.getText()).toBe('abc');
    expect(m.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it('多段插入：拆行落位、光标落插入段尾', () => {
    const m = new EditorModel();
    m.insertText('ab');
    m.insertText('X\nY');
    expect(m.getLines()).toEqual(['abX', 'Y']);
    expect(m.getCursor()).toEqual({ line: 1, col: 1 });
  });

  it('行中插入多段：后缀并入末段', () => {
    const m = modelWith('ab');
    m.moveHome();
    m.insertText('X\nY');
    expect(m.getLines()).toEqual(['X', 'Yab']);
    expect(m.getCursor()).toEqual({ line: 1, col: 1 });
  });

  it('CRLF / CR 规范化为 LF', () => {
    const m = new EditorModel();
    m.insertText('a\r\nb\rc');
    expect(m.getLines()).toEqual(['a', 'b', 'c']);
  });

  it('onChange 携全文通知', () => {
    const m = new EditorModel();
    const spy = vi.fn();
    m.onChange = spy;
    m.insertText('hi');
    expect(spy).toHaveBeenCalledWith('hi');
  });
});

describe('EditorModel 字素删除', () => {
  it('退格删代理对字素（emoji 整删）', () => {
    const m = modelWith('👍');
    m.backspace();
    expect(m.getText()).toBe('');
    expect(m.getCursor().col).toBe(0);
  });

  it('退格删 CJK 字素（BMP 双宽整删）', () => {
    const m = modelWith('中');
    m.backspace();
    expect(m.getText()).toBe('');
  });

  it('行首退格与前行合并（换行删除语义）', () => {
    const m = modelWith('ab\ncd');
    m.moveHome();
    m.backspace();
    expect(m.getText()).toBe('abcd');
    expect(m.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it('前删行尾与下一行合并', () => {
    const m = modelWith('ab\ncd');
    m.moveUp(); // 光标上移到行 0 末尾
    m.deleteForward();
    expect(m.getText()).toBe('abcd');
  });

  it('空框行首退格无操作不空通知', () => {
    const m = new EditorModel();
    const spy = vi.fn();
    m.onChange = spy;
    m.backspace();
    expect(spy).not.toHaveBeenCalled();
  });

  it('前删 CJK：一次删整字不落半字', () => {
    const m = modelWith('中a');
    m.moveHome();
    m.deleteForward();
    expect(m.getText()).toBe('a');
  });
});

describe('EditorModel 词级删除', () => {
  it('词级退删：跳尾空白再删词', () => {
    const m = modelWith('foo.bar ');
    m.deleteWordBackward();
    expect(m.getText()).toBe('foo.');
    expect(m.getCursor().col).toBe(4);
  });

  it('词级退删：词内标点切到最近标点后', () => {
    const m = modelWith('foo.bar');
    m.deleteWordBackward();
    expect(m.getText()).toBe('foo.');
  });

  it('词级前删：跳前导空白再删词', () => {
    const m = modelWith('  foo');
    m.moveHome();
    m.deleteWordForward();
    expect(m.getText()).toBe('');
  });

  it('词级退删行首：与前行合并', () => {
    const m = modelWith('ab\ncd');
    m.moveHome();
    m.deleteWordBackward();
    expect(m.getText()).toBe('abcd');
  });
});

describe('EditorModel 行删除', () => {
  it('删至行首：光标前段整删', () => {
    const m = modelWith('abcdef');
    m.moveLeft();
    m.moveLeft();
    m.deleteToLineStart();
    expect(m.getText()).toBe('ef');
    expect(m.getCursor().col).toBe(0);
  });

  it('删至行首在行首：合并前行', () => {
    const m = modelWith('ab\ncd');
    m.moveHome();
    m.deleteToLineStart();
    expect(m.getText()).toBe('abcd');
  });

  it('删至行尾：光标后段整删', () => {
    const m = modelWith('abcdef');
    m.moveHome();
    m.moveRight();
    m.deleteToLineEnd();
    expect(m.getText()).toBe('a');
  });

  it('删至行尾在行尾：合并下一行', () => {
    const m = modelWith('ab\ncd');
    m.moveUp(); // 光标上移到行 0 末尾
    m.deleteToLineEnd();
    expect(m.getText()).toBe('abcd');
  });
});

describe('EditorModel 移动族', () => {
  it('左右移字素边界 + 行首尾 wrap', () => {
    const m = modelWith('ab\ncd');
    m.moveLeft(); // (1,1)
    m.moveLeft(); // (1,0)
    m.moveLeft(); // wrap → (0,2)
    expect(m.getCursor()).toEqual({ line: 0, col: 2 });
    m.moveRight(); // wrap → (1,0)
    expect(m.getCursor()).toEqual({ line: 1, col: 0 });
  });

  it('零界 no-op：首行行首左移 / 末行行尾右移', () => {
    const m = modelWith('ab');
    m.moveHome();
    m.moveLeft();
    expect(m.getCursor()).toEqual({ line: 0, col: 0 });
    m.moveEnd();
    m.moveRight();
    expect(m.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it('上下移视觉行（折行下移）', () => {
    const m = modelWith('abcdef\ngh', 4);
    m.moveUp(); // 逻辑行 1 末尾 → 逻辑行 0 第二视觉段末（ef|，显示列恰容）
    expect(m.getCursor()).toEqual({ line: 0, col: 6 });
    m.moveDown(); // 回逻辑行 1 末尾
    expect(m.getCursor()).toEqual({ line: 1, col: 2 });
  });

  it('sticky 列经典往返：长行夹尾、回程复位', () => {
    const m = modelWith('ab\nx\nabcdefgh');
    m.moveUp(); // 'x'（宽 1）——夹尾 sticky=8
    expect(m.getCursor()).toEqual({ line: 1, col: 1 });
    m.moveUp(); // 'ab'（宽 2）——保持夹尾
    expect(m.getCursor()).toEqual({ line: 0, col: 2 });
    m.moveDown(); // 'x'——sticky 仍 8 > 1 夹尾
    expect(m.getCursor()).toEqual({ line: 1, col: 1 });
    m.moveDown(); // 长行放得下——回 sticky 位
    expect(m.getCursor()).toEqual({ line: 2, col: 8 });
  });

  it('sticky 列显示列制：CJK 双宽列不漂移', () => {
    const m = modelWith('中中\nab', 4);
    m.moveUp(); // 先上到行 0（半字防线落 col 1）
    m.moveEnd(); // 行 0 末尾（col 2、显示列 4）
    m.moveDown(); // 目标 'ab' 宽 2 < 4 —— 夹尾 sticky=4
    expect(m.getCursor()).toEqual({ line: 1, col: 2 });
    m.moveUp(); // '中中' 恰容 sticky 4 —— 复位到 col 2（非码元差 4）
    expect(m.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it('翻页：逻辑行无折行时按行数跳、越界 no-op', () => {
    const m = modelWith('a\nb\nc\nd\ne');
    m.pageUp(2);
    expect(m.getCursor()).toEqual({ line: 2, col: 1 });
    m.pageDown(10); // 越界 no-op
    expect(m.getCursor()).toEqual({ line: 2, col: 1 });
    m.pageUp(10); // 越界 no-op
    expect(m.getCursor()).toEqual({ line: 2, col: 1 });
  });

  it('词向移动 wrap 行界', () => {
    const m = modelWith('ab cd\nef');
    m.moveHome(); // (1,0)
    m.moveWordBackward(); // wrap → 行 0 末尾
    expect(m.getCursor()).toEqual({ line: 0, col: 5 });
    m.moveHome(); // (0,0)
    m.moveWordForward(); // (0,2)
    expect(m.getCursor().col).toBe(2);
    m.moveWordForward(); // 跳空白 + 词 → (0,5)
    expect(m.getCursor().col).toBe(5);
    m.moveWordForward(); // wrap → 行 1 首端
    expect(m.getCursor()).toEqual({ line: 1, col: 0 });
  });

  it('jump 词向：前后跳与无匹配 no-op', () => {
    const m = modelWith('foo bar baz');
    m.moveHome();
    m.jumpToChar('b', 'forward');
    expect(m.getCursor().col).toBe(4);
    m.jumpToChar('b', 'forward');
    expect(m.getCursor().col).toBe(8);
    m.jumpToChar('b', 'backward');
    expect(m.getCursor().col).toBe(4);
    m.jumpToChar('z', 'backward');
    expect(m.getCursor().col).toBe(4); // 光标前无 z——no-op
  });

  it('jump 词向跨行搜索', () => {
    const m = modelWith('ab\ncd');
    m.moveHome();
    m.jumpToChar('d', 'forward');
    expect(m.getCursor()).toEqual({ line: 1, col: 1 });
  });
});

describe('EditorModel undo', () => {
  it('连续词字符合并一单元：一次 undo 全撤', () => {
    const m = new EditorModel();
    m.insertText('a');
    m.insertText('b');
    m.insertText('c');
    expect(m.canUndo()).toBe(true);
    m.undo();
    expect(m.getText()).toBe('');
    expect(m.canUndo()).toBe(false);
  });

  it('空白独立成步、词接空白后独立成步', () => {
    const m = new EditorModel();
    m.insertText('a');
    m.insertText('b');
    m.insertText('c');
    m.insertText(' ');
    m.insertText('d');
    m.insertText('e');
    m.undo();
    expect(m.getText()).toBe('abc ');
    m.undo();
    expect(m.getText()).toBe('abc');
    m.undo();
    expect(m.getText()).toBe('');
  });

  it('撤销后光标随快照复位', () => {
    const m = modelWith('abcdef');
    m.moveHome();
    m.insertText('X');
    m.undo();
    expect(m.getText()).toBe('abcdef');
    expect(m.getCursor().col).toBe(0);
  });

  it('undo 上限 100：连续空白步超帽丢最旧', () => {
    const m = new EditorModel();
    for (let i = 0; i < 105; i++) m.insertText(' ');
    let undos = 0;
    while (m.canUndo()) {
      m.undo();
      undos++;
    }
    expect(undos).toBe(100);
    // 每次空白插入独立成步：105 步丢最旧 5 步——余 5 个空格撤不掉
    expect(m.getText()).toBe('     ');
  });

  it('提交全清撤回域', () => {
    const m = modelWith('hello');
    m.submit();
    expect(m.canUndo()).toBe(false);
  });
});

describe('EditorModel 输入历史', () => {
  it('trim 空不入册：翻阅无效果', () => {
    const m = new EditorModel();
    m.addToHistory('   ');
    m.navigateHistory(-1);
    expect(m.getText()).toBe('');
  });

  it('连续重复不入册', () => {
    const m = new EditorModel();
    m.addToHistory('a');
    m.addToHistory('a');
    m.addToHistory('b');
    m.navigateHistory(-1); // → 'b'
    m.navigateHistory(-1); // → 'a'
    m.navigateHistory(-1); // 尽头 no-op
    expect(m.getText()).toBe('a');
    expect(m.isBrowsingHistory()).toBe(true);
  });

  it('翻阅方向光标语义：向旧归首、向新归尾', () => {
    const m = new EditorModel();
    m.addToHistory('one');
    m.navigateHistory(-1);
    expect(m.getCursor()).toEqual({ line: 0, col: 0 });
    m.navigateHistory(1);
    // 回到草稿（空框）——无历史可向新翻则草稿即态
    expect(m.isBrowsingHistory()).toBe(false);
  });

  it('draft 保底：浏览后回新恢复未提交草稿', () => {
    const m = modelWith('draft');
    m.addToHistory('h1');
    m.navigateHistory(-1);
    expect(m.getText()).toBe('h1');
    m.navigateHistory(1);
    expect(m.getText()).toBe('draft');
  });

  it('历史帽 100：翻到底恰 100 步', () => {
    const m = new EditorModel();
    for (let i = 0; i <= 110; i++) m.addToHistory(`e${i}`);
    m.navigateHistory(-1); // index 0 = e110
    for (let i = 0; i < 99; i++) m.navigateHistory(-1); // index 99 = e11（帽内最旧）
    expect(m.getText()).toBe('e11');
    m.navigateHistory(-1); // 越帽 no-op
    expect(m.getText()).toBe('e11');
  });

  it('编辑动作退出浏览态（草稿弃）', () => {
    const m = modelWith('draft');
    m.addToHistory('h1');
    m.navigateHistory(-1);
    m.insertText('!'); // 向旧浏览光标归首——插入在行首
    expect(m.isBrowsingHistory()).toBe(false);
    expect(m.getText()).toBe('!h1');
  });

  it('多行历史向旧归首行首', () => {
    const m = new EditorModel();
    m.addToHistory('l1\nl2');
    m.navigateHistory(-1);
    expect(m.getCursor()).toEqual({ line: 0, col: 0 });
  });
});

describe('EditorModel 提交与设值', () => {
  it('提交返回 trim 全文并全清', () => {
    const m = modelWith('  hi there  ');
    const text = m.submit();
    expect(text).toBe('hi there');
    expect(m.getText()).toBe('');
    expect(m.getCursor()).toEqual({ line: 0, col: 0 });
    expect(m.isEmpty()).toBe(true);
  });

  it('setText：光标归尾、undo 可回', () => {
    const m = new EditorModel();
    m.setText('ab\ncd');
    expect(m.getCursor()).toEqual({ line: 1, col: 2 });
    m.setText('');
    m.undo();
    expect(m.getText()).toBe('ab\ncd');
  });
});

describe('EditorModel IME 预编辑', () => {
  it('挂起段不并入正文、空串清除', () => {
    const m = modelWith('ab');
    m.setPreedit('中');
    expect(m.pendingPreedit).toBe('中');
    expect(m.getText()).toBe('ab');
    m.setPreedit('');
    expect(m.pendingPreedit).toBeNull();
  });

  it('组字期视觉列含预编辑宽', () => {
    const m = new EditorModel();
    m.setPreedit('中');
    expect(m.cursorDisplayColumn()).toBe(2);
  });
});

describe('EditorModel 视觉行查询', () => {
  it('首 / 末视觉行判（折行面）', () => {
    const m = modelWith('aaaaaaaa\nb', 4);
    // 光标在第二逻辑行——不在首视觉行
    expect(m.isOnFirstVisualLine()).toBe(false);
    expect(m.isOnLastVisualLine()).toBe(true);
    m.moveUp(); // 折行段上移（视觉行 1）
    m.moveUp(); // 视觉行 0
    expect(m.isOnFirstVisualLine()).toBe(true);
  });
});
