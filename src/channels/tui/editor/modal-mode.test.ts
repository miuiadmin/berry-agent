/**
 * 模态编辑层单测（39 池 P4·L——07 §4.1 R5 mode 域）：三态迁移表 /
 * normal 命令面（移动·删·复制·贴·撤·入 insert 族）/ pending 复合操作
 * （d/y/g 续接）/ 容错律（无效续接取消重处理、超时自愈、ESC 取消）/
 * 模态寄存器分立（kill-ring 零动）／贴的 undo 原子性。
 * 纯逻辑直测：EditorModel 真身 + 假钟注入（超时判定的确定性驱动）。
 */
import { describe, expect, it } from 'vitest';
import { EditorModel } from './editor-model.js';
import { EditorModal, MODAL_PENDING_TIMEOUT_MS } from './modal-mode.js';

/** 假钟（超时自愈的确定性驱动——只走 now 注入，不排定时器） */
class ManualClock {
  public t = 0;
  public readonly now = (): number => this.t;
  public advance(ms: number): void {
    this.t += ms;
  }
}

/** 便捷：建模态层（多行文本 + 光标归尾 + 假钟） */
function modalWith(text: string): { modal: EditorModal; model: EditorModel; clock: ManualClock } {
  const model = new EditorModel();
  model.setText(text);
  model.setLayoutWidth(80);
  const clock = new ManualClock();
  const modal = new EditorModal(model, { now: clock.now });
  return { modal, model, clock };
}

/** 便捷：连续喂命令串 */
const feed = (modal: EditorModal, chars: string): void => {
  for (const ch of chars) modal.feed(ch);
};

describe('EditorModal 态迁移表（normal/insert/pending 三态）', () => {
  it('fresh = normal；i/a/I/A/o/O 六路进 insert；esc 归 normal', () => {
    for (const enterKey of ['i', 'a', 'I', 'A', 'o', 'O']) {
      const { modal } = modalWith('ab');
      expect(modal.mode).toBe('normal'); // fresh 态
      modal.feed(enterKey);
      expect(modal.mode).toBe('insert'); // 六入路口全通
      expect(modal.feedEscape()).toBe(true); // insert 归 normal——消费
      expect(modal.mode).toBe('normal');
    }
  });

  it('d/y/g 起动词进 pending（operator-pending）；esc 取消即消费返 normal', () => {
    const { modal } = modalWith('ab');
    feed(modal, 'd');
    expect(modal.mode).toBe('pending');
    expect(modal.pendingHead).toBe('d');
    expect(modal.feedEscape()).toBe(true); // 未完态取消——消费（不外泄作全局中断）
    expect(modal.mode).toBe('normal');
    modal.feed('y');
    expect(modal.mode).toBe('pending');
    expect(modal.pendingHead).toBe('y');
    modal.feed('q'); // 词面外续接：取消重处理——'q' 在 normal 亦词面外（静默丢）
    expect(modal.pendingHead).toBe(null);
    expect(modal.mode).toBe('normal');
    feed(modal, 'gg'); // gg 双击复合：pending 半程 + 完结归 normal
    expect(modal.mode).toBe('normal');
  });

  it('normal 态 escape 不消费（归全局中断路——模态层不夺生命线键）', () => {
    const { modal } = modalWith('ab');
    expect(modal.feedEscape()).toBe(false);
  });
});

describe('EditorModal 移动族（h/l/w/b/0/$/gg/G）', () => {
  it('行内 h/l 与词向 w/b、行首 0 行尾 $', () => {
    const { modal, model } = modalWith('hello world');
    feed(modal, '0');
    expect(model.getCursor().col).toBe(0);
    feed(modal, 'w');
    expect(model.getCursor().col).toBe(5); // 词向 = 既有 moveWordForward 原语（emacs 词界——词尾后一位，07 §4.1 mode 域「原语复用」拍板）
    feed(modal, 'b');
    expect(model.getCursor().col).toBe(0);
    feed(modal, 'l');
    expect(model.getCursor().col).toBe(1);
    feed(modal, 'h');
    expect(model.getCursor().col).toBe(0);
    feed(modal, '$');
    expect(model.getCursor().col).toBe('hello world'.length);
  });

  it('gg 跳首行 / G 跳末行（列夹目标行行尾）', () => {
    const { modal, model } = modalWith('aaa\nbbbb\ncc');
    model.setText('aaa\nbbbb\ncc'); // 光标归尾（末行 col 2）
    feed(modal, 'g');
    expect(modal.mode).toBe('pending'); // g 半程 = pending
    modal.feed('g');
    expect(modal.mode).toBe('normal');
    expect(model.getCursor().line).toBe(0);
    expect(model.getCursor().col).toBe(2); // 列夹首行行尾（原 col 2 ≤ 3）
    feed(modal, 'G');
    expect(model.getCursor().line).toBe(2);
    expect(model.getCursor().col).toBe(2); // 末行行尾
  });
});

describe('EditorModal 删族（x/dd/dw/db/d0/d$）', () => {
  it('x 删光标处字符；EOL 守卫无操作（不并下一行）', () => {
    const { modal, model } = modalWith('ab');
    model.moveHome();
    feed(modal, 'x');
    expect(model.getText()).toBe('b');
    model.moveEnd();
    feed(modal, 'x');
    expect(model.getText()).toBe('b'); // EOL 无操作
    // gap 模型：光标在行尾隙位（col === length）时 x 无字符可删——再 h 一步
    // 回词内才删（区别于 deleteForward 原语的并下一行语义——守卫只在行内位动）
    model.setText('ab\ncd');
    model.moveHome();
    model.moveLeft(); // wrap 到前行行尾（col 2 = 隙位）
    feed(modal, 'x');
    expect(model.getText()).toBe('ab\ncd'); // 隙位无操作
    feed(modal, 'h');
    feed(modal, 'x');
    expect(model.getText()).toBe('a\ncd'); // 词内位删一字符
  });

  it('dd 删整行入寄存器（line kind）+ undo 可回', () => {
    const { modal, model } = modalWith('aaa\nbbb\nccc');
    feed(modal, 'gg'); // 光标到首行（列夹首行行尾——顺带锁 gg+dd 组合）
    feed(modal, 'dd');
    expect(model.getLines()).toEqual(['bbb', 'ccc']);
    expect(model.getCursor().line).toBe(0); // 删除位新行首
    expect(modal.register).toEqual({ kind: 'line', text: 'aaa' });
    feed(modal, 'u');
    expect(model.getLines()).toEqual(['aaa', 'bbb', 'ccc']); // undo 单步回
  });

  it('dd 单行稿删成空行不灭稿', () => {
    const { modal, model } = modalWith('only');
    feed(modal, 'dd');
    expect(model.getLines()).toEqual(['']);
    expect(modal.register).toEqual({ kind: 'line', text: 'only' });
  });

  it('dw 删词入寄存器（char kind）；EOL 无操作', () => {
    const { modal, model } = modalWith('hello world');
    feed(modal, '0');
    feed(modal, 'dw');
    expect(model.getText()).toBe(' world');
    expect(modal.register).toEqual({ kind: 'char', text: 'hello' });
    feed(modal, 'd$');
    expect(model.getText()).toBe('');
    expect(modal.register).toEqual({ kind: 'char', text: ' world' });
    feed(modal, 'dw'); // EOL（空行）无操作
    expect(model.getText()).toBe('');
  });

  it('db/d0 删段入寄存器；行首无操作', () => {
    const { modal, model } = modalWith('hello world');
    feed(modal, '0');
    feed(modal, 'd0');
    expect(model.getText()).toBe('hello world'); // 行首 d0 无操作
    feed(modal, '$');
    feed(modal, 'db');
    expect(model.getText()).toBe('hello ');
    expect(modal.register).toEqual({ kind: 'char', text: 'world' });
    feed(modal, 'd0'); // db 后光标已在词界（col 6）——d0 直删余段
    expect(model.getText()).toBe('');
    expect(modal.register).toEqual({ kind: 'char', text: 'hello ' });
  });

  it('x 不入寄存器（vim x 非删入寄存语义——寄存器保持前值）', () => {
    const { modal, model } = modalWith('ab');
    feed(modal, 'yy'); // 寄存器 = line 'ab'
    model.moveHome();
    feed(modal, 'x');
    expect(modal.register).toEqual({ kind: 'line', text: 'ab' }); // x 不覆盖
    expect(model.getText()).toBe('b');
  });
});

describe('EditorModal 复制族（yy/yw/y0/y$）', () => {
  it('yy 纯读整行入寄存器不删稿、光标不动', () => {
    const { modal, model } = modalWith('aaa\nbbb');
    model.moveHome();
    model.moveUp();
    feed(modal, 'yy');
    expect(model.getLines()).toEqual(['aaa', 'bbb']); // 零删
    expect(modal.register).toEqual({ kind: 'line', text: 'aaa' });
  });

  it('yw/y0/y$ 行段纯读', () => {
    const { modal, model } = modalWith('hello world');
    model.moveHome();
    feed(modal, 'yw');
    expect(modal.register).toEqual({ kind: 'char', text: 'hello' });
    feed(modal, 'w'); // 光标移词尾后一位（yw 纯读不动光标）
    feed(modal, 'y$');
    expect(modal.register).toEqual({ kind: 'char', text: ' world' }); // 前导空格在段内（词界语义随原语）
    model.moveHome();
    feed(modal, 'y0'); // 行首 y0 = 空段不落寄存器（前值保持）
    expect(modal.register).toEqual({ kind: 'char', text: ' world' });
  });
});

describe('EditorModal 贴族（p/P 两 kind）', () => {
  it('行形 p 贴于当前行下、P 贴于上；光标落贴段尾', () => {
    const { modal, model } = modalWith('aaa\nbbb');
    model.moveHome();
    model.moveUp(); // 首行
    feed(modal, 'yy');
    feed(modal, 'p');
    expect(model.getLines()).toEqual(['aaa', 'aaa', 'bbb']);
    feed(modal, 'P');
    expect(model.getLines()).toEqual(['aaa', 'aaa', 'aaa', 'bbb']);
    expect(model.getCursor()).toEqual({ line: 1, col: 3 }); // 贴段尾
  });

  it('字形式 p 行内插（光标处）', () => {
    const { modal, model } = modalWith('hello world');
    model.moveHome();
    feed(modal, 'yw'); // 'hello'
    feed(modal, '$');
    feed(modal, 'p');
    expect(model.getText()).toBe('hello worldhello'); // 行尾贴（gap 模型：隙位在行尾）
  });

  it('空寄存器 p/P 无操作（零 undo 步）', () => {
    const { modal, model } = modalWith('ab');
    feed(modal, 'p');
    expect(model.getText()).toBe('ab');
  });

  it('连贴两步 undo 分立（insertPaste 原子步——insertText 游程合并会并一步）', () => {
    const { modal, model } = modalWith('ab');
    feed(modal, 'yy');
    feed(modal, 'p');
    feed(modal, 'j'); // 词面外静默丢（无操作——防误移）
    feed(modal, 'p');
    expect(model.getLines()).toEqual(['ab', 'ab', 'ab']);
    feed(modal, 'u');
    expect(model.getLines()).toEqual(['ab', 'ab']); // 一次 undo 只回一步贴
    feed(modal, 'u');
    expect(model.getLines()).toEqual(['ab']);
  });
});

describe('EditorModal 容错律（无效续接 / 超时自愈 / ESC 取消）', () => {
  it('无效续接：取消 pending 后该字符按 normal 命令重处理（不吞键）', () => {
    const { modal, model } = modalWith('ab');
    model.moveHome();
    feed(modal, 'd'); // pending d
    feed(modal, 'x'); // x 不是 d 的续接词——取消重处理：x 删字符
    expect(modal.mode).toBe('normal');
    expect(model.getText()).toBe('b');
  });

  it('换键容错：d 待续期换按 g——取消后 g 成新起动词（非静默丢）', () => {
    const { modal } = modalWith('aaa\nbbb');
    feed(modal, 'd');
    feed(modal, 'g');
    expect(modal.mode).toBe('pending'); // g 重处理成新 pending（gg 双击前半）
    expect(modal.pendingHead).toBe('g');
  });

  it('超时自愈：超窗续接词按 normal 处理（不组复合）', () => {
    const { modal, model, clock } = modalWith('aaa\nbbb');
    model.moveHome();
    model.moveUp(); // 首行
    feed(modal, 'd');
    clock.advance(MODAL_PENDING_TIMEOUT_MS + 1); // 超窗
    feed(modal, 'd'); // 时间上不构成 dd——按新 'd' 起动词处理
    expect(model.getLines()).toEqual(['aaa', 'bbb']); // 未删（第二 d 进了新 pending）
    expect(modal.pendingHead).toBe('d');
    expect(modal.mode).toBe('pending');
  });

  it('g 超时同律：超窗第二 g 组不成 gg（按新起动词处理）', () => {
    const { modal, model, clock } = modalWith('aaa\nbbb');
    model.moveHome();
    model.moveUp();
    model.moveDown(); // 末行
    feed(modal, 'g');
    clock.advance(MODAL_PENDING_TIMEOUT_MS + 1);
    feed(modal, 'g'); // 自愈后按新 g 处理 → 又进 pending → 无续接超时窗重开
    expect(model.getCursor().line).toBe(1); // 未跳首行
    expect(modal.pendingHead).toBe('g');
  });
});

describe('EditorModal 寄存器与 kill-ring 分立（07 §4.1 mode 域分立律）', () => {
  it('dd/dw 族不动 kill-ring（环零入账——emacs 面零漂移）', () => {
    const { modal, model } = modalWith('hello world');
    feed(modal, 'dd');
    expect(model.killRing.size).toBe(0); // 独立寄存器、不环账
    model.undo();
    feed(modal, 'dw');
    expect(model.killRing.size).toBe(0);
  });

  it('行内段删经既有原语时被删段顺带入环（原语既有行为——不改原语保 emacs 面）', () => {
    const { modal, model } = modalWith('hello world');
    feed(modal, '0');
    feed(modal, 'd0'); // 行首无操作（环零入账）
    expect(model.killRing.size).toBe(0);
    feed(modal, '$');
    feed(modal, 'd0');
    expect(model.getText()).toBe('');
    expect(model.killRing.size).toBe(1); // deleteToLineStart 原语环账在身
    expect(modal.register).toEqual({ kind: 'char', text: 'hello world' }); // 模态寄存器另账
  });
});

describe('EditorModal insert 入口族的落位语义', () => {
  it('I 行首 / A 行尾 / o 下开行 / O 上开行', () => {
    const { modal, model } = modalWith('mid');
    model.moveHome();
    feed(modal, 'A');
    expect(model.getCursor().col).toBe(3); // A 落行尾
    expect(modal.mode).toBe('insert');
    modal.feedEscape();
    feed(modal, 'I');
    expect(model.getCursor().col).toBe(0);
    modal.feedEscape();
    feed(modal, 'o');
    expect(model.getLines()).toEqual(['mid', '']); // 下开空行
    expect(model.getCursor()).toEqual({ line: 1, col: 0 });
    modal.feedEscape();
    feed(modal, 'O');
    expect(model.getLines()).toEqual(['mid', '', '']); // 上开空行（光标在中层新空行）
    expect(model.getCursor()).toEqual({ line: 1, col: 0 });
  });

  it('a 光标右移一字素后进 insert（EOL 处同 i——右移钳位）', () => {
    const { modal, model } = modalWith('ab');
    model.moveHome();
    feed(modal, 'a');
    expect(model.getCursor().col).toBe(1);
    modal.feedEscape();
    model.moveEnd();
    feed(modal, 'a');
    expect(model.getCursor().col).toBe(2); // EOL 钳位
  });
});

/* ---------------- 活标记行守卫（冷读闸 P2——模态层与 dd 原语双盲修） ---------------- */

describe('EditorModal 活标记行守卫（yy/dw/dd 对粘贴标记原子段 no-op——占位符字面不入账）', () => {
  /** 造超阈粘贴文本（分阈成标记原子段——21 行） */
  const bigPaste = Array.from({ length: 21 }, (_, i) => `行${i}`).join('\n');

  it('yy 标记行 no-op：寄存器不收占位符字面——p 不铸第二活标记行（修前红：提交稿整块 ×2）', () => {
    const { modal, model } = modalWith('');
    model.insertPaste(bigPaste); // 单标记行（登记 21 行原文）
    feed(modal, 'yy'); // yy 标记行——no-op
    expect(modal.register).toBeNull(); // 修前红位：寄存器落 '[paste #1 +21 lines]' 字面
    feed(modal, 'p'); // 空寄存器无操作
    expect(model.getLines()).toEqual(['[paste #1 +21 lines]']); // 零第二标记行
    expect(model.getExpandedText().split('行0').length).toBe(2); // 原文恰一份（修前红：×2）
  });

  it('dd 活标记行走标记族删除：登记注销（手敲同形不复活）+ 寄存器不动', () => {
    const { modal, model } = modalWith('');
    model.insertPaste(bigPaste);
    feed(modal, 'dd');
    expect(model.getLines()).toEqual(['']); // 整行删除（单行稿删成空行不灭稿）
    expect(modal.register).toBeNull(); // 返 null 位——占位符字面不入寄存器
    // 手敲同形占位串：登记已注销不获原子性（修前红：裸 splice 滞留死 id →
    // 同形串复活已删整段为活标记、展开回 21 行原文）
    model.insertText('[paste #1 +21 lines]');
    expect(model.isPasteMarkerLine(0)).toBe(false);
    expect(model.getExpandedText()).toBe('[paste #1 +21 lines]');
  });

  it('段动词（dw/d$）标记行 no-op：段坐标不劈标记原子段', () => {
    const { modal, model } = modalWith('');
    model.insertPaste(bigPaste);
    model.moveHome();
    feed(modal, 'dw'); // 词删段动词——标记行 no-op
    expect(model.getLines()).toEqual(['[paste #1 +21 lines]']); // 标记行原样（未被段删劈开）
    expect(modal.register).toBeNull();
    feed(modal, 'd$'); // 行尾段删——同 no-op
    expect(model.getLines()).toEqual(['[paste #1 +21 lines]']);
  });
});
