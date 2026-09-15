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

/* ---------------- kill-ring 集成（R3 批 10j） ---------------- */

describe('EditorModel kill-ring 集成', () => {
  it('三 kill 原语被删段入环（词删 / 行首 / 行尾——行内段形）', () => {
    const m = modelWith('hello world');
    m.moveEnd();
    m.deleteWordBackward(); // kill 'world'（词边界不含前导空格——余 'hello '）
    expect(m.getText()).toBe('hello ');
    expect(m.killRing.current()).toBe('world');
    m.insertText('again'); // 'hello again'（空格已余）
    m.moveEnd();
    m.deleteToLineEnd(); // 行尾无内容 = no-op 不入环
    expect(m.killRing.current()).toBe('world');
    m.deleteToLineStart(); // kill 'hello again'
    expect(m.getText()).toBe('');
    expect(m.killRing.current()).toBe('hello again');
  });

  it('行首/行尾合并形 kill 入环换行段', () => {
    const m = modelWith('ab\ncd'); // 光标 (1,2)——'cd' 行尾
    m.moveHome(); // (1,0)
    m.deleteToLineStart(); // 行首合并前行——kill '\n'
    expect(m.getText()).toBe('abcd');
    expect(m.killRing.current()).toBe('\n');
    const m2 = modelWith('ab\ncd');
    m2.moveHome(); // (1,0)
    m2.moveUp(); // (0,0)
    m2.moveEnd(); // (0,2)——'ab' 行尾
    m2.deleteToLineEnd(); // 行尾合并次行——kill '\n'
    expect(m2.getText()).toBe('abcd');
    expect(m2.killRing.current()).toBe('\n');
  });

  it('yank：环头条目插入光标处、光标落尾、区间账在案', () => {
    const m = modelWith('hello world');
    m.moveEnd();
    m.deleteWordBackward(); // kill 'world' → 'hello '
    m.moveHome();
    m.yank(); // 在行首 yank——插 'world'
    expect(m.getText()).toBe('worldhello ');
    expect(m.getCursor()).toEqual({ line: 0, col: 5 });
    expect(m.killRing.activeSpan).toEqual({ line: 0, start: 0, end: 5, text: 'world' });
  });

  it('yankPop：环游标步进替换刚 yank 的段', () => {
    const m = modelWith('one two');
    m.moveEnd();
    m.deleteWordBackward(); // kill 'two' → 'one '（环 [two]）
    m.insertText(' three'); // 'one  three'（空格叠加）
    m.moveEnd();
    m.deleteWordBackward(); // kill 'three' → 'one  '（环 [three, two]）
    m.moveHome();
    m.yank(); // 插 'three'
    expect(m.getText()).toBe('threeone  ');
    m.yankPop(); // 替换为环下一条 'two'
    expect(m.getText()).toBe('twoone  ');
    m.yankPop(); // 回绕替换回 'three'
    expect(m.getText()).toBe('threeone  ');
  });

  it('yankPop 无在案 yank = no-op；区间被编辑后 = no-op（自校验）', () => {
    const m = modelWith('ab');
    m.deleteToLineStart(); // kill 'ab'
    m.yankPop(); // 无 yank 态
    expect(m.getText()).toBe('');
    m.yank(); // 插 'ab'
    m.insertText('X'); // 编辑劈了 yank 区间
    const before = m.getText();
    m.yankPop(); // 区间账失效——no-op
    expect(m.getText()).toBe(before);
  });

  it('yank / yankPop 不入 undo（undo 直跳 kill 前）；kill 入 undo', () => {
    const m = new EditorModel();
    m.insertText('hello world'); // undo 点①：空框
    m.moveEnd();
    m.deleteWordBackward(); // kill 'world' → 'hello '（undo 点②：全量）
    m.yank(); // 插回 'world'（不入 undo——恢复非破坏）
    expect(m.getText()).toBe('hello world');
    m.undo(); // 直跳 kill 前（跳过 yank——yank 无 undo 点）
    expect(m.getText()).toBe('hello world');
    m.undo(); // 恰两步到底——kill 的 undo 点已耗
    expect(m.getText()).toBe('');
    expect(m.canUndo()).toBe(false);
  });

  it('词删（alt+backspace 同动作）与行删（ctrl+u / ctrl+k）入 undo 正常', () => {
    const m = modelWith('keep drop');
    m.moveEnd();
    m.deleteWordBackward();
    expect(m.getText()).toBe('keep ');
    m.undo();
    expect(m.getText()).toBe('keep drop');
  });
});

/* ---------------- 粘贴标记化（R3 批 10j） ---------------- */

describe('EditorModel 粘贴标记化', () => {
  /** 造超阈粘贴文本（THRESHOLD+1 行） */
  const bigPaste = Array.from({ length: 21 }, (_, i) => `行${i}`).join('\n');
  const smallPaste = 'a\nb\nc';

  it('超阈粘贴：标记恒独占行 + 登记原文 + undo 单步', () => {
    const m = new EditorModel();
    m.insertPaste(bigPaste);
    expect(m.getLines()).toEqual(['[paste #1 +21 lines]']);
    expect(m.isPasteMarkerLine(0)).toBe(true);
    expect(m.getText()).toBe('[paste #1 +21 lines]'); // 框内只呈现标记
    m.undo();
    expect(m.getText()).toBe('');
    expect(m.isPasteMarkerLine(0)).toBe(false); // 登记随快照回退
  });

  it('阈内小粘贴整段入框（原语义不变）', () => {
    const m = new EditorModel();
    m.insertPaste(smallPaste);
    expect(m.getLines()).toEqual(['a', 'b', 'c']);
    expect(m.isPasteMarkerLine(0)).toBe(false);
  });

  it('行中粘贴标记：劈行独占、前后文本保全', () => {
    const m = modelWith('abcdef'); // 光标行尾
    m.moveHome();
    m.moveRight();
    m.moveRight();
    m.moveRight(); // col 3——'abc|def'
    m.insertPaste(bigPaste);
    expect(m.getLines()).toEqual(['abc', '[paste #1 +21 lines]', 'def']);
    expect(m.getCursor()).toEqual({ line: 2, col: 0 });
  });

  it('提交时展开回正文（标记换原文）', () => {
    const m = new EditorModel();
    m.insertText('问：');
    m.insertPaste(bigPaste);
    const out = m.submit();
    expect(out).toBe(`问：\n${bigPaste}`); // trim 后形
    expect(m.getText()).toBe(''); // 全清
  });

  it('标记行上删除键 = 删整标记行（任意位、六原语同律、undo 单步）', () => {
    const m = new EditorModel();
    m.insertPaste(bigPaste);
    m.insertText('尾部'); // 标记行尾打字——守卫开新行（标记不劈）
    expect(m.getLines()).toEqual(['[paste #1 +21 lines]', '尾部']);
    m.moveUp(); // 回标记行
    m.moveEnd();
    m.backspace(); // 标记行内退格——删整标记行
    expect(m.getLines()).toEqual(['尾部']);
    expect(m.isPasteMarkerLine(0)).toBe(false);
    m.undo();
    expect(m.getLines()).toEqual(['[paste #1 +21 lines]', '尾部']); // 整行回退
  });

  it('标记内插入 = 就地展开（原文替换标记行、光标落原文首行首）', () => {
    const m = new EditorModel();
    m.insertPaste(bigPaste); // lines [marker]，光标 (0,20)
    m.insertText('尾部'); // 行尾守卫 → 后置空行：lines [marker, '尾部']
    m.moveUp(); // sticky 列保持（显示列 4——'尾部' CJK 双宽）→ (0,4)——标记内部
    expect(m.getCursor()).toEqual({ line: 0, col: 4 });
    m.insertText('X'); // 就地展开：登记原文整行替换标记、光标落原文首行首再落字
    expect(m.getLines()).toEqual(['X行0', ...Array.from({ length: 20 }, (_, i) => `行${i + 1}`), '尾部']);
    expect(m.getCursor()).toEqual({ line: 0, col: 1 });
    m.undo(); // 展开后快照——撤输入字，标记不回（劈开事实诚实记录）
    expect(m.getLines()).toEqual([...Array.from({ length: 21 }, (_, i) => `行${i}`), '尾部']);
    expect(m.isPasteMarkerLine(0)).toBe(false); // 登记已随展开注销
  });

  it('标记行首 / 行尾插入守卫：前置换行 / 后置空行（标记恒独占）', () => {
    const m = new EditorModel();
    m.insertPaste(bigPaste);
    m.moveEnd();
    m.insertText('尾'); // 行尾守卫——后置空行
    expect(m.getLines()).toEqual(['[paste #1 +21 lines]', '尾']);
  });

  it('undo 恢复标记形：登记表随快照一致（再删可再 undo）', () => {
    const m = new EditorModel();
    m.insertPaste(bigPaste);
    m.deleteToLineStart(); // 标记行整删
    expect(m.getText()).toBe('');
    m.undo(); // 回标记形
    expect(m.isPasteMarkerLine(0)).toBe(true); // 登记随快照恢复
    const out = m.submit();
    expect(out).toBe(bigPaste); // 展开照常
  });

  it('序号从登记表推导（max+1）——多标记并存', () => {
    const m = new EditorModel();
    m.insertPaste(bigPaste);
    m.insertText('\n');
    m.insertPaste(bigPaste);
    expect(m.getLines()).toEqual(['[paste #1 +21 lines]', '', '[paste #2 +21 lines]']);
    const out = m.submit();
    expect(out).toBe(`${bigPaste}\n\n${bigPaste}`);
  });
});
