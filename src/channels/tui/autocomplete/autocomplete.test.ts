/**
 * 补全三合一单测：token 判据（引号感知提取）+ 三源路由（@ 优先 → 命令名 →
 * 参数段；源空 null；union 快路 / 异步源微task 交付；priorArgs 深位判据）
 * + 弹层（键面 / 整 token 代换 / 引号形防尾空格击穿 / escape 关后重开 /
 * 候选窗口滚动 / 陈旧窗守卫——R6 批 10j）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { EditorModel } from '../editor/editor-model.js';
import { tokenAtCursor } from './token.js';
import { CombinedAutocompleteProvider } from './autocomplete.js';
import type { AutocompleteItem, AutocompleteOutcome, AutocompleteResult } from './provider.js';
import { AutocompletePopup } from './popup.js';

/** Promise 形判别（union 收窄用类型守卫） */
function isPromiseOutcome(value: AutocompleteOutcome): value is Promise<AutocompleteResult | null> {
  return typeof (value as Promise<AutocompleteResult | null> | null)?.then === 'function';
}

/**
 * union 快路展开：同步源同步交付（测试 rig 全同步源——Promise 形即测试自身
 * 写错，fail-loud）。异步源形用 await 直取（本文件仅一处）。
 */
function syncOf(outcome: AutocompleteOutcome): AutocompleteResult | null {
  if (isPromiseOutcome(outcome)) throw new Error('同步源 rig 不应返 Promise');
  return outcome;
}

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
    const result = syncOf(provider.getCompletions({ lines: ['/mo'], cursorLine: 0, cursorCol: 3 }));
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
    const result = syncOf(provider.getCompletions({ lines: ['/model sn'], cursorLine: 0, cursorCol: 9 }));
    expect(calls).toEqual([['model', 'sn']]);
    expect(result?.replaceStart).toBe(7);
    expect(result?.replaceEnd).toBe(9);
  });

  it('priorArgs 第三参：命令名与光标 token 之间的已定参数序（深位判据）', () => {
    const calls: Array<[string, string, readonly string[]]> = [];
    const provider = new CombinedAutocompleteProvider({
      commandArguments: (cmd, q, prior) => {
        calls.push([cmd, q, prior]);
        return [item('x')];
      },
    });
    const result = syncOf(provider.getCompletions({ lines: ['/model sonnet la'], cursorLine: 0, cursorCol: 16 }));
    expect(calls).toEqual([['model', 'la', ['sonnet']]]); // 光标 token 'la' 前已定 'sonnet'
    expect(result?.replaceStart).toBe(14);
    // 首参位（无前参）——空序非 undefined
    syncOf(provider.getCompletions({ lines: ['/approval pre'], cursorLine: 0, cursorCol: 13 }));
    expect(calls[1]).toEqual(['approval', 'pre', []]);
  });

  it('异步源（Promise 形）→ 微task 交付同形结果（union 协议）', async () => {
    const provider = new CombinedAutocompleteProvider({
      commands: (q) => Promise.resolve([item(`/x-${q}`)]),
    });
    const outcome = provider.getCompletions({ lines: ['/q'], cursorLine: 0, cursorCol: 2 });
    expect(outcome).toBeInstanceOf(Promise); // 异步源不经快路
    const result = await outcome;
    expect(result?.items[0]?.replacement).toBe('/x-q');
    expect(result?.replaceStart).toBe(0);
    // 异步空源 → null（弹层不显）
    const empty = new CombinedAutocompleteProvider({ commands: () => Promise.resolve([]) });
    expect(await empty.getCompletions({ lines: ['/z'], cursorLine: 0, cursorCol: 2 })).toBeNull();
  });

  it('@ 前缀 token → mention 源（query 去 @）', () => {
    const queries: string[] = [];
    const provider = new CombinedAutocompleteProvider({
      mentions: (q) => {
        queries.push(q);
        return [item('docs/', '@/docs/')];
      },
    });
    const result = syncOf(provider.getCompletions({ lines: ['see @par'], cursorLine: 0, cursorCol: 8 }));
    expect(queries).toEqual(['par']);
    expect(result?.items[0]?.replacement).toBe('@/docs/');
  });

  it('@ 优先于参数段（命令参数内也可 mention）', () => {
    const provider = new CombinedAutocompleteProvider({
      commandArguments: () => [item('wrong')],
      mentions: () => [item('right', '@right')],
    });
    const result = syncOf(provider.getCompletions({ lines: ['/read @par'], cursorLine: 0, cursorCol: 10 }));
    expect(result?.items[0]?.replacement).toBe('@right');
  });

  it('行首非命令 token → null；非首行 / → null（命令判据限首行）', () => {
    const provider = new CombinedAutocompleteProvider({
      commands: () => [item('/x')],
      commandArguments: () => [item('y')],
    });
    expect(syncOf(provider.getCompletions({ lines: ['hello wo'], cursorLine: 0, cursorCol: 8 }))).toBeNull();
    expect(syncOf(provider.getCompletions({ lines: ['line0', '/mo'], cursorLine: 1, cursorCol: 3 }))).toBeNull();
  });

  it('无 token / 源缺席 / 源空 → null', () => {
    const provider = new CombinedAutocompleteProvider({});
    expect(syncOf(provider.getCompletions({ lines: [''], cursorLine: 0, cursorCol: 0 }))).toBeNull();
    expect(syncOf(provider.getCompletions({ lines: ['/mo'], cursorLine: 0, cursorCol: 3 }))).toBeNull(); // 无命令源
    const empty = new CombinedAutocompleteProvider({ commands: () => [] });
    expect(syncOf(empty.getCompletions({ lines: ['/zzz'], cursorLine: 0, cursorCol: 4 }))).toBeNull(); // 空条目
  });

  it('空 query（刚输入触发前缀）→ 源收全量（前缀空串）', () => {
    const queries: string[] = [];
    const provider = new CombinedAutocompleteProvider({
      commands: (q) => {
        queries.push(q);
        return [item('/help'), item('/model')];
      },
    });
    const result = syncOf(provider.getCompletions({ lines: ['/'], cursorLine: 0, cursorCol: 1 }));
    expect(queries).toEqual(['']);
    expect(result?.items.length).toBe(2);
  });
});

/* ---------------- 弹层 ---------------- */

describe('AutocompletePopup', () => {
  /** 装配：真模型 + 三源 provider + 弹层（R6 形：弹层只收结果，refresh 闭包模拟 backend 调度器同步快路交付） */
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
    const popup = new AutocompletePopup(model);
    /** 模拟 backend 调度器：fire 时自取模型现态 → 同步快路交付（union 收口） */
    const refresh = (): void => {
      const cursor = model.getCursor();
      popup.applyResult(
        syncOf(provider.getCompletions({ lines: model.getLines(), cursorLine: cursor.line, cursorCol: cursor.col })),
      );
    };
    return { model, popup, refresh };
  }

  it('结果落位可见、无补全不显', () => {
    const { model, popup, refresh } = rig(['/mo']);
    refresh();
    expect(popup.visible).toBe(true);
    model.setText('/zz');
    refresh();
    expect(popup.visible).toBe(false);
  });

  it('↑/↓ 循环换高亮 + enter 应用整 token 代换（光标落代换尾）', () => {
    const { model, popup, refresh } = rig(['/m']);
    refresh();
    popup.handleEvent(key('down')); // 0 → 1（/m 前缀两条：/model、/memory）
    popup.handleEvent(key('enter'));
    expect(model.getText()).toBe('/memory');
    expect(model.getCursor()).toEqual({ line: 0, col: 7 });
    expect(popup.visible).toBe(false); // 应用即隐
  });

  it('tab 同 enter 应用', () => {
    const { model, popup, refresh } = rig(['/h']);
    refresh();
    expect(popup.handleEvent(key('tab'))).toBe(true);
    expect(model.getText()).toBe('/help');
  });

  it('↑ wrap 回到末项（循环）', () => {
    const { model, popup, refresh } = rig(['/m']);
    refresh();
    popup.handleEvent(key('up')); // 0 → 2（/memory——循环）
    popup.handleEvent(key('enter'));
    expect(model.getText()).toBe('/memory');
  });

  it('escape 关本轮、后续输入重发新查重开', () => {
    const { model, popup, refresh } = rig(['/m']);
    refresh();
    expect(popup.handleEvent(key('escape'))).toBe(true);
    expect(popup.visible).toBe(false);
    model.insertText('o'); // '/mo'
    refresh();
    expect(popup.visible).toBe(true);
  });

  it('编辑键穿透（backspace / 字符键不消费——归输入件继续编辑）', () => {
    const { popup, refresh } = rig(['/mo']);
    refresh();
    expect(popup.handleEvent(key('backspace'))).toBe(false);
    expect(popup.handleEvent({ kind: 'text', text: 'd' })).toBe(false);
    expect(popup.handleEvent(key('left', { ctrl: true }))).toBe(false);
    expect(popup.visible).toBe(true); // 未关——随下次落位重算
  });

  it('release 相不消费、不可见时不挡键', () => {
    const { popup } = rig(['/mo']);
    expect(popup.handleEvent(key('enter', { phase: 'release' } as never))).toBe(false);
    expect(popup.handleEvent(key('enter'))).toBe(false); // 不可见（未落位）
  });

  // —— 全量输入穿透律（2026-09-13 真模型五轮实测定罪：完整输入 /plugins 后
  // 弹层照开，enter 被「应用」吞键而无净代换——提交被吞须二次 enter，命令
  // 粘连进模型）——恰在全量输入时 enter 穿透提交、tab 专职填充恒应用 ——

  it('高亮项已全量输入：enter 穿透不消费（提交归编辑器——修前吞键实证红）', () => {
    const { model, popup, refresh } = rig(['/help']);
    refresh();
    expect(popup.visible).toBe(true); // 全量输入弹层照开（唯一候选 = 自身）
    expect(popup.handleEvent(key('enter'))).toBe(false); // 穿透——修前 applySelection 无净代换仍返 true
    expect(model.getText()).toBe('/help'); // 无代换发生
  });

  it('高亮项已全量输入：tab 仍消费应用（键面分离——tab 无提交歧义）', () => {
    const { model, popup, refresh } = rig(['/help']);
    refresh();
    expect(popup.handleEvent(key('tab'))).toBe(true);
    expect(model.getText()).toBe('/help'); // 幂等代换——文本不变但键被消费
  });

  it('半输入前缀形：enter 照常应用（补全流保形防矫枉过正）', () => {
    const { model, popup, refresh } = rig(['/m']);
    refresh();
    expect(popup.handleEvent(key('enter'))).toBe(true);
    expect(model.getText()).toBe('/model'); // 前缀两候选（/model、/memory）——应用高亮首项
  });

  // —— 陈旧窗守卫（R6 批 10j）：20ms 防抖窗内弹层可持上轮 result——输入已
  // 变更、新查未发，enter/tab 按陈旧区间代换会劈坏文本（'/help l' 形）。守卫
  // 对拍 token 现区间，失配即收层穿透（enter 走提交语义、tab 回编辑器） ——

  it('陈旧窗：防抖窗内输入变更后 enter 穿透不代换（守卫收层——R6 修前劈坏实证位）', () => {
    const { model, popup, refresh } = rig(['/m']);
    refresh(); // result 区间 [0,2)（'/m' 轮）
    model.insertText('o'); // '/mo'——模拟防抖窗内连打（新查未发，弹层仍持上轮 result）
    expect(popup.handleEvent(key('enter'))).toBe(false); // 守卫：token 现区间 [0,3) ≠ [0,2)——收层穿透
    expect(popup.visible).toBe(false);
    expect(model.getText()).toBe('/mo'); // 无代换发生（修前按 [0,2) 代换 = '/memoryo' 劈坏形）
  });

  it('陈旧窗：tab 同守卫穿透；新查落位后照常应用（守卫不误伤新鲜轮）', () => {
    const { model, popup, refresh } = rig(['/m']);
    refresh();
    model.insertText('o'); // '/mo'
    expect(popup.handleEvent(key('tab'))).toBe(false); // 陈旧——同守卫收层穿透
    refresh(); // 防抖窗到——新查落位（result 区间 [0,3)）
    expect(popup.visible).toBe(true);
    popup.handleEvent(key('enter'));
    expect(model.getText()).toBe('/model'); // 新鲜轮照常代换
  });

  it('陈旧窗：光标退到空白段（无 token）也判陈旧收层', () => {
    const { model, popup, refresh } = rig(['/mo']);
    refresh();
    model.insertText(' '); // '/mo '——光标紧邻空白无 token
    expect(popup.handleEvent(key('enter'))).toBe(false); // 收层穿透（提交 '/mo '）
    expect(popup.visible).toBe(false);
  });

  it('全量输入穿透：@ 文件段源同律（label 与 replacement 异形时不穿透）', () => {
    // mentions 源 label 'docs/' replacement '@/docs/'——输入 '@' 后 token '@'
    // 与候选 replacement '@/docs/' 异形 → enter 仍应用（异形不穿透）
    const { model, popup, refresh } = rig(['see @']);
    refresh();
    expect(popup.handleEvent(key('enter'))).toBe(true);
    expect(model.getText()).toBe('see @/docs/');
  });

  it('引号形 replacement：代换后行内引号形 + 后续空格不再触发（防尾空格击穿）', () => {
    const { model, popup, refresh } = rig(['see @doc']);
    refresh();
    popup.handleEvent(key('enter')); // 选中 docs/ → replacement '@/docs/'
    expect(model.getText()).toBe('see @/docs/');
    // 引号形演示：label 含空格的源给引号形 replacement
    const model2 = new EditorModel();
    const provider2 = new CombinedAutocompleteProvider({
      mentions: () => [item('my file.txt', '@"my file.txt"')],
    });
    const popup2 = new AutocompletePopup(model2);
    const refresh2 = (): void => {
      const cursor = model2.getCursor();
      popup2.applyResult(
        syncOf(provider2.getCompletions({ lines: model2.getLines(), cursorLine: cursor.line, cursorCol: cursor.col })),
      );
    };
    model2.setText('see @"my fi');
    refresh2();
    expect(popup2.visible).toBe(true); // 引号内空格未断 token——补全仍触发
    popup2.handleEvent(key('enter'));
    expect(model2.getText()).toBe('see @"my file.txt"'); // 引号形防尾空格击穿
  });

  it('渲染：候选行 + 高亮反色 + 说明右对齐 dim + 铺底遮蔽', () => {
    const { popup, refresh } = rig(['/']);
    refresh();
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
    const popup = new AutocompletePopup(model);
    model.setText('/');
    const refresh = (): void => {
      const cursor = model.getCursor();
      popup.applyResult(
        syncOf(provider.getCompletions({ lines: model.getLines(), cursorLine: cursor.line, cursorCol: cursor.col })),
      );
    };
    refresh();
    expect(popup.measure(20)).toBe(10); // 12 条夹 10
    for (let i = 0; i < 11; i++) popup.handleEvent(key('down')); // activeIndex 0 → 11
    const grid = new CellGrid(20, 10);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 10 });
    expect(readRow(grid, 0, 20)).toBe('  opt2'); // 窗口滚到 [2,12)
    expect(readRow(grid, 9, 20)).toBe('❯ opt11'); // 高亮行入窗末
  });
});
