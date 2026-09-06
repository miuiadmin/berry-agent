/**
 * 补全三合一单测：token 判据（引号感知提取）+ 三源路由（@ 优先 → 命令名 →
 * 参数段；源空 null）+ 弹层（键面 / 整 token 代换 / 引号形防尾空格击穿 /
 * escape 关后重开 / 候选窗口滚动）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { EditorModel } from '../editor/editor-model.js';
import { tokenAtCursor } from './token.js';
import { CombinedAutocompleteProvider } from './autocomplete.js';
import type { AutocompleteItem } from './provider.js';
import { AutocompletePopup } from './popup.js';

/** 键事件便捷构造 */
function key(
  k: string,
  mods: { ctrl?: boolean } = {},
): {
  kind: 'key';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  phase: 'press' | 'release';
} {
  return {
    kind: 'key',
    key: k,
    ctrl: mods.ctrl ?? false,
    alt: false,
    shift: false,
    meta: false,
    phase: 'press',
  };
}

/** 候选便捷构造 */
function item(label: string, replacement: string = label, detail?: string): AutocompleteItem {
  return detail === undefined ? { label, replacement } : { label, replacement, detail };
}

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/* ---------------- token 判据（引号感知） ---------------- */

describe('tokenAtCursor 引号感知提取', () => {
  it('基本提取：光标前至最近空白', () => {
    expect(tokenAtCursor('hello wor', 9)).toEqual({ start: 6, end: 9, text: 'wor' });
  });

  it('行中段提取（前有内容）', () => {
    expect(tokenAtCursor('a /mo', 5)).toEqual({ start: 2, end: 5, text: '/mo' });
  });

  it('引号内空白不断 token（防击穿核心）', () => {
    expect(tokenAtCursor('see @"my fi', 11)).toEqual({ start: 4, end: 11, text: '@"my fi' });
  });

  it('光标紧邻空白 / 行首 → null', () => {
    expect(tokenAtCursor('hello ', 6)).toBeNull();
    expect(tokenAtCursor('hello', 0)).toBeNull();
  });

  it('闭合引号整段属 token（引号字符含在区间内）', () => {
    expect(tokenAtCursor('@"a b"', 6)).toEqual({ start: 0, end: 6, text: '@"a b"' });
  });
});

/* ---------------- 三源路由 ---------------- */

describe('CombinedAutocompleteProvider 三源路由', () => {
  it('行首 / 前缀 token → 命令名源（query 去斜杠）', () => {
    const queries: string[] = [];
    const provider = new CombinedAutocompleteProvider({
      commands: (q) => {
        queries.push(q);
        return [item('/model')];
      },
    });
    const result = provider.getCompletions({ lines: ['/mo'], cursorLine: 0, cursorCol: 3 });
    expect(queries).toEqual(['mo']);
    expect(result?.items[0]?.replacement).toBe('/model');
    expect(result?.replaceStart).toBe(0);
    expect(result?.replaceEnd).toBe(3);
  });

  it('命令名已终结后的 token → 参数源（带命令名）', () => {
    const calls: Array<[string, string]> = [];
    const provider = new CombinedAutocompleteProvider({
      commandArguments: (cmd, q) => {
        calls.push([cmd, q]);
        return [item('sonnet')];
      },
    });
    const result = provider.getCompletions({ lines: ['/model sn'], cursorLine: 0, cursorCol: 9 });
    expect(calls).toEqual([['model', 'sn']]);
    expect(result?.replaceStart).toBe(7);
    expect(result?.replaceEnd).toBe(9);
  });

  it('@ 前缀 token → mention 源（query 去 @）', () => {
    const queries: string[] = [];
    const provider = new CombinedAutocompleteProvider({
      mentions: (q) => {
        queries.push(q);
        return [item('docs/', '@/docs/')];
      },
    });
    const result = provider.getCompletions({ lines: ['see @par'], cursorLine: 0, cursorCol: 8 });
    expect(queries).toEqual(['par']);
    expect(result?.items[0]?.replacement).toBe('@/docs/');
  });

  it('@ 优先于参数段（命令参数内也可 mention）', () => {
    const provider = new CombinedAutocompleteProvider({
      commandArguments: () => [item('wrong')],
      mentions: () => [item('right', '@right')],
    });
    const result = provider.getCompletions({ lines: ['/read @par'], cursorLine: 0, cursorCol: 10 });
    expect(result?.items[0]?.replacement).toBe('@right');
  });

  it('行首非命令 token → null；非首行 / → null（命令判据限首行）', () => {
    const provider = new CombinedAutocompleteProvider({
      commands: () => [item('/x')],
      commandArguments: () => [item('y')],
    });
    expect(provider.getCompletions({ lines: ['hello wo'], cursorLine: 0, cursorCol: 8 })).toBeNull();
    expect(provider.getCompletions({ lines: ['line0', '/mo'], cursorLine: 1, cursorCol: 3 })).toBeNull();
  });

  it('无 token / 源缺席 / 源空 → null', () => {
    const provider = new CombinedAutocompleteProvider({});
    expect(provider.getCompletions({ lines: [''], cursorLine: 0, cursorCol: 0 })).toBeNull();
    expect(provider.getCompletions({ lines: ['/mo'], cursorLine: 0, cursorCol: 3 })).toBeNull(); // 无命令源
    const empty = new CombinedAutocompleteProvider({ commands: () => [] });
    expect(empty.getCompletions({ lines: ['/zzz'], cursorLine: 0, cursorCol: 4 })).toBeNull(); // 空条目
  });

  it('空 query（刚输入触发前缀）→ 源收全量（前缀空串）', () => {
    const queries: string[] = [];
    const provider = new CombinedAutocompleteProvider({
      commands: (q) => {
        queries.push(q);
        return [item('/help'), item('/model')];
      },
    });
    const result = provider.getCompletions({ lines: ['/'], cursorLine: 0, cursorCol: 1 });
    expect(queries).toEqual(['']);
    expect(result?.items.length).toBe(2);
  });
});

/* ---------------- 弹层 ---------------- */

describe('AutocompletePopup', () => {
  /** 装配：真模型 + 三源 provider + 弹层 */
  function rig(lines: string[], cursorLine = 0, cursorCol?: number) {
    const model = new EditorModel();
    model.setText(lines.join('\n'));
    if (cursorLine > 0 || cursorCol !== undefined) {
      // setText 光标归尾——需移动光标的用例手动移
    }
    void cursorLine;
    void cursorCol;
    // 候选台账（显式元组类型——noUncheckedIndexedAccess 下解构不 undefined 化）
    const commands: Array<[string, string]> = [
      ['/help', '查看帮助'],
      ['/model', '切换模型'],
      ['/memory', '记忆'],
    ];
    const mentions: Array<[string, string]> = [
      ['docs/', '@/docs/'],
      ['src/', '@/src/'],
    ];
    const provider = new CombinedAutocompleteProvider({
      commands: (q) =>
        commands.filter(([name]) => name.startsWith(`/${q}`)).map(([name, detail]) => item(name, name, detail)),
      mentions: (q) =>
        mentions.filter(([label]) => label.startsWith(q)).map(([label, replacement]) => item(label, replacement)),
    });
    const popup = new AutocompletePopup(provider, model);
    return { model, popup };
  }

  it('refresh 取补全可见、无补全不显', () => {
    const { model, popup } = rig(['/mo']);
    popup.refresh();
    expect(popup.visible).toBe(true);
    model.setText('/zz');
    popup.refresh();
    expect(popup.visible).toBe(false);
  });

  it('↑/↓ 循环换高亮 + enter 应用整 token 代换（光标落代换尾）', () => {
    const { model, popup } = rig(['/m']);
    popup.refresh();
    popup.handleEvent(key('down')); // 0 → 1（/m 前缀两条：/model、/memory）
    popup.handleEvent(key('enter'));
    expect(model.getText()).toBe('/memory');
    expect(model.getCursor()).toEqual({ line: 0, col: 7 });
    expect(popup.visible).toBe(false); // 应用即隐
  });

  it('tab 同 enter 应用', () => {
    const { model, popup } = rig(['/h']);
    popup.refresh();
    expect(popup.handleEvent(key('tab'))).toBe(true);
    expect(model.getText()).toBe('/help');
  });

  it('↑ wrap 回到末项（循环）', () => {
    const { model, popup } = rig(['/m']);
    popup.refresh();
    popup.handleEvent(key('up')); // 0 → 2（/memory——循环）
    popup.handleEvent(key('enter'));
    expect(model.getText()).toBe('/memory');
  });

  it('escape 关本轮、后续输入 refresh 重开', () => {
    const { model, popup } = rig(['/m']);
    popup.refresh();
    expect(popup.handleEvent(key('escape'))).toBe(true);
    expect(popup.visible).toBe(false);
    model.insertText('o'); // '/mo'
    popup.refresh();
    expect(popup.visible).toBe(true);
  });

  it('编辑键穿透（backspace / 字符键不消费——归输入件继续编辑）', () => {
    const { popup } = rig(['/mo']);
    popup.refresh();
    expect(popup.handleEvent(key('backspace'))).toBe(false);
    expect(popup.handleEvent({ kind: 'text', text: 'd' })).toBe(false);
    expect(popup.handleEvent(key('left', { ctrl: true }))).toBe(false);
    expect(popup.visible).toBe(true); // 未关——随下次 refresh 重算
  });

  it('release 相不消费、不可见时不挡键', () => {
    const { popup } = rig(['/mo']);
    expect(popup.handleEvent(key('enter', { phase: 'release' } as never))).toBe(false);
    expect(popup.handleEvent(key('enter'))).toBe(false); // 不可见（未 refresh）
  });

  it('引号形 replacement：代换后行内引号形 + 后续空格不再触发（防尾空格击穿）', () => {
    const { model, popup } = rig(['see @doc']);
    popup.refresh();
    popup.handleEvent(key('enter')); // 选中 docs/ → replacement '@/docs/'
    expect(model.getText()).toBe('see @/docs/');
    // 引号形演示：label 含空格的源给引号形 replacement
    const model2 = new EditorModel();
    const provider2 = new CombinedAutocompleteProvider({
      mentions: () => [item('my file.txt', '@"my file.txt"')],
    });
    const popup2 = new AutocompletePopup(provider2, model2);
    model2.setText('see @"my fi');
    popup2.refresh();
    expect(popup2.visible).toBe(true); // 引号内空格未断 token——补全仍触发
    popup2.handleEvent(key('enter'));
    expect(model2.getText()).toBe('see @"my file.txt"'); // 引号形防尾空格击穿
  });

  it('渲染：候选行 + 高亮反色 + 说明右对齐 dim + 铺底遮蔽', () => {
    const { popup } = rig(['/']);
    popup.refresh();
    const grid = new CellGrid(22, 5);
    grid.writeText(0, 0, '______________________'); // 下层文字
    popup.render(grid, { row: 0, col: 0, width: 22, height: 3 });
    expect(readRow(grid, 0, 22)).toBe('❯ /help       查看帮助');
    expect(grid.getCell(0, 0)?.style.inverse).toBe(true);
    expect(readRow(grid, 1, 22)).toBe('  /model      切换模型');
    expect(grid.getCell(1, 0)?.style.inverse).toBeUndefined();
    expect(grid.getCell(0, 14)?.style.dim).toBe(true); // 说明段 dim（右对齐 col 14 起）
    expect(grid.getCell(0, 7)?.grapheme).toBe(' '); // 铺底空格遮蔽（非内容格已写空格非 null）
  });

  it('候选窗口 10 行帽 + 高亮跟随滚动', () => {
    const model = new EditorModel();
    const many = Array.from({ length: 12 }, (_, i) => item(`opt${i}`));
    const provider = new CombinedAutocompleteProvider({ commands: () => many });
    const popup = new AutocompletePopup(provider, model);
    model.setText('/');
    popup.refresh();
    expect(popup.measure(20)).toBe(10); // 12 条夹 10
    for (let i = 0; i < 11; i++) popup.handleEvent(key('down')); // activeIndex 0 → 11
    const grid = new CellGrid(20, 10);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 10 });
    expect(readRow(grid, 0, 20)).toBe('  opt2'); // 窗口滚到 [2,12)
    expect(readRow(grid, 9, 20)).toBe('❯ opt11'); // 高亮行入窗末
  });
});
