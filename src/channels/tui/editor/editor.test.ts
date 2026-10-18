/**
 * 编辑组件单测（事件分发端到端）：四路事件 → handleEvent 消费裁决——
 * 键位表（提交 / 换行 / 移动 / 删除族 / undo 双绑）、ctrl+c 透传、
 * ↑/↓ 历史触发判据、jump 两态、IME / paste 路、release 相忽略。
 */
import { describe, expect, it, vi } from 'vitest';
import { InputDecoder } from '../../engine/index.js';
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

  it('多字符 text 事件（legacy 轨游程合并形）：首字符为靶、余字符完整入文不丢', () => {
    // legacy 轨 input.ts textRun 同 chunk 连续可打印合并单 text 事件——快打/
    // 忙帧攒批真实可达（kitty 轨逐事件无此形）。首字素作跳靶后余字素须经
    // insertText 补入正文（修前余字素无去向——丢字跑红实证）。
    const editor = new Editor();
    editor.handleEvent(text('foo bar baz'));
    editor.model.moveHome();
    expect(editor.handleEvent(key(']', { ctrl: true }))).toBe(true);
    expect(editor.handleEvent(text('bcd'))).toBe(true); // 单事件三字符
    // 靶 'b'（bar 的 b，col 4）作跳转消费 + 余 'cd' 落靶位后 → 光标 4+2=6
    expect(editor.model.getCursor().col).toBe(6);
    // 首字符未入文（文本仅长 +2）、余字符完整入文（修前余字符丢——11 字不变）
    expect(editor.getText()).toBe('foo cdbar baz');
  });

  it('jump 待靶态组合字素整素作靶（肤质修饰不劈不产悬空残段）', () => {
    // legacy 轨 textRun 同 chunk 连续可打印合并单 text 事件且不按字素切分——
    // 组合字素（emoji+肤质修饰）作为首输入到达时，码点切分把「👍🏽」（2 码点
    // 1 字素）劈成「靶+残段」：残段（悬空肤质修饰符）被 insertText 插入正文
    // 产生文本污染（修前 'hi👍🏽!' 变 'hi🏽👍🏽!'——修饰符凭空插到靶位前）。
    const editor = new Editor();
    editor.setText('hi👍🏽!');
    editor.model.moveHome(); // 光标归首——前向跳可命中靶（setText 光标归尾）
    expect(editor.handleEvent(key(']', { ctrl: true }))).toBe(true);
    expect(editor.handleEvent(text('👍🏽'))).toBe(true); // 单事件整字素（2 码点 1 字素）
    // 整字素作靶：正文不变（修前悬空修饰符插入 → 'hi🏽👍🏽!'）
    expect(editor.getText()).toBe('hi👍🏽!');
    // 光标落靶字素首列（'hi' 后）
    expect(editor.model.getCursor().col).toBe(2);
  });

  it('kitty 轨 astral 可打印走 ime 提交路：待靶态仍消费跳靶（真解码器全链）', () => {
    // input.ts plain 判据 text.length === 1 使 astral 码点（UTF-16 长 2）恒
    // false → dispatchImeText → ime committed 事件到达 editor。修前 ime 分支
    // 不查 jumpPending：emoji 被当普通提交插入正文 + 待靶态残留误吃下一普通
    // 字符（修前 'x' 被吃作靶、正文不见 x）。
    const decoder = new InputDecoder();
    const editor = new Editor();
    editor.setText('a👉b');
    editor.model.moveHome(); // 光标归首——前向跳可命中靶（setText 光标归尾）
    const pump = (): void => {
      for (const ev of decoder.take()) editor.handleEvent(ev);
    };
    expect(editor.handleEvent(key(']', { ctrl: true }))).toBe(true);
    // kitty CSI u 携 astral 文本（👉 = U+1F449 = 128073）→ ime committed 路
    decoder.feed('\x1b[128073;;128073u');
    pump();
    // emoji 被 jump 消费：不入正文、光标落靶位（'a' 后）
    expect(editor.getText()).toBe('a👉b');
    expect(editor.model.getCursor().col).toBe(1);
    // 待靶态已清：紧随普通 'x' 不被误吃（正常入文）
    editor.handleEvent(text('x'));
    expect(editor.getText()).toBe('ax👉b');
  });

  it('setText 整稿替换清待靶态：外部清稿后首字符不被吞作跳靶（挖掘 26 轮 [2]——修前红）', () => {
    // 外部清稿/回填路（ctrl+d 清空腿 / inputAsk 激活与 abort 残稿清 / 斜杠
    // 命令回填）经 setText 绕 handleEvent 单源锚——修前待靶态残留，用户下一
    // 首字素被静默吞作靶（清稿后稿空 jumpToChar 无命中，净效果纯丢首字符）
    const editor = new Editor();
    editor.handleEvent(text('hello world'));
    expect(editor.handleEvent(key(']', { ctrl: true }))).toBe(true);
    editor.setText(''); // 外部清稿（tui-backend 三处清稿路同形）
    editor.handleEvent(text('abc'));
    expect(editor.getText()).toBe('abc'); // 修前 'bc'——首字符被吞
    // 斜杠命令回填变体：待靶后整稿回填同律清态（回填稿上首输入正常入文）
    editor.handleEvent(key(']', { ctrl: true }));
    editor.setText('/rename');
    editor.handleEvent(text(' x'));
    expect(editor.getText()).toBe('/rename x'); // 修前空格被吞作靶——'x' 顶前成 '/renamex'
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

  it('I5 锁② IME 穿透回归锁：预编辑期非提交键先冲刷再派发（decoder 层 input.ts 冲刷执法 + editor 组合实证）', () => {
    // 真解码器 → editor 全链（冲刷执法在 InputDecoder.emitKey——预编辑挂起时
    // 键事件先冲刷为提交再入队，键效后达）。流式组字节拍：主流终端 CSI 0 首
    // 发单发提交、跟随窗内再发构成前缀链 → 回溯开 session 转组字中。
    const decoder = new InputDecoder();
    const editor = new Editor();
    const pump = (): void => {
      for (const ev of decoder.take()) editor.handleEvent(ev);
    };
    // 一拍：单发提交「中」（无 session——立即交付零延迟）
    decoder.feed('\x1b[0;;20013u');
    pump();
    expect(editor.getText()).toBe('中');
    // 二拍：跟随窗内前缀链「中国」（20013=中 22269=国）→ 回溯开 session 组字中
    decoder.feed('\x1b[0;;20013:22269u');
    pump();
    expect(decoder.composing).toBe(true); // 预编辑在途
    expect(editor.model.pendingPreedit).toBe('中国'); // editor 侧挂起渲染
    expect(editor.getText()).toBe('中'); // 组字不落正文
    // 三拍：预编辑期到达非提交键（left）——冲刷先于键派发（事件序单源断言）
    decoder.feed('\x1b[D');
    const events = decoder.take();
    expect(events).toEqual([
      { kind: 'ime', text: '中国', committed: true }, // 先冲刷为提交
      { kind: 'key', key: 'left', ctrl: false, alt: false, shift: false, meta: false, phase: 'press' }, // 键效后达
    ]);
    for (const ev of events) editor.handleEvent(ev);
    expect(decoder.composing).toBe(false); // session 收口
    // 已知边界（input.ts 注释在案）：流式首块「中」已交付不可撤，冲刷全文
    // 「中国」致前缀重复——文档化行为，非缺陷
    expect(editor.getText()).toBe('中中国');
    expect(editor.model.pendingPreedit).toBeNull();
    // 键效后达实证：冲刷插入后光标在 3，left 后到 → 2（若键先达则插入位点不同）
    expect(editor.model.getCursor().col).toBe(2);
    expect(editor.model.getCursor().line).toBe(0);
  });

  it('粘贴整段入正文（多行直接呈现）', () => {
    const editor = new Editor();
    expect(editor.handleEvent({ kind: 'paste', text: 'a\r\nb' })).toBe(true);
    expect(editor.model.getLines()).toEqual(['a', 'b']);
  });
});

describe('Editor 帽随几何重算（批 10k 遗漏修——resize 重接线）', () => {
  it('setMaxVisibleLines：呈现帽随动 + page 键步幅随动', () => {
    const editor = new Editor({ maxVisibleLines: 5 });
    for (const ch of 'abcdef') editor.handleEvent(text(ch)); // 单行 6 字符（宽 80 不折行）
    editor.handleEvent(key('enter', { shift: true })); // 第二行
    expect(editor.measure(80)).toBe(5); // 内容 2 铺至最小高 3 + 垫 2（五件批 A+B——V-0 注③ 框退役零占位）
    editor.setMaxVisibleLines(1); // 终端缩窗——帽随几何收紧
    expect(editor.measure(80)).toBe(3); // 帽 1 辖上限 + 垫 2（帽 < 3 退化形帽辖优先）
    // page-down 步幅 = 帽（1 行视口整页）——光标沉到末行
    editor.handleEvent(key('page-down'));
    expect(editor.model.currentVisualLine(editor.model.visualLines())).toBe(1);
  });
});

describe('Editor 候跑提交（挂账解挂批——alt+enter follow-up 排队）', () => {
  it('alt+enter 提交携候跑标记：onSubmit 第二参 opts.queueFollowUp=true；enter 提交无标记（键序分立）', () => {
    const calls: Array<[string, { queueFollowUp?: boolean } | undefined]> = [];
    const editor = new Editor({ onSubmit: (t, opts) => calls.push([t, opts]) });
    editor.handleEvent(text('候跑文'));
    expect(editor.handleEvent(key('enter', { alt: true }))).toBe(true);
    editor.handleEvent(text('普通文'));
    expect(editor.handleEvent(key('enter'))).toBe(true);
    // 两提交互异可观测：候跑形带标记、普通形不带
    expect(calls).toHaveLength(2);
    expect(calls[0]!).toEqual(['候跑文', { queueFollowUp: true }]);
    expect(calls[1]!).toEqual(['普通文', undefined]);
    expect(editor.getText()).toBe(''); // 两形都清框入册
  });

  it('空框 alt+enter：消费但不回调（与 enter 同判据）', () => {
    const spy = vi.fn();
    const editor = new Editor({ onSubmit: spy });
    expect(editor.handleEvent(key('enter', { alt: true }))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Editor 持久化史两键（B1——07 §4.1 呈现面件 2 定形注⑧）', () => {
  it('onHistoryAdd 镜像触发形：真入册提交先镜像后 onSubmit（trim 形入参）', () => {
    const order: string[] = [];
    const editor = new Editor({
      onSubmit: () => order.push('onSubmit'),
      onHistoryAdd: (t) => order.push(`onHistoryAdd:${t}`),
    });
    editor.handleEvent(text('  hello  '));
    editor.handleEvent(key('enter'));
    // 镜像在 onSubmit 先（addToHistory 先于 onSubmit 回调——既有入册序不变）
    expect(order).toEqual(['onHistoryAdd:hello', 'onSubmit']);
  });

  it('onHistoryAdd 去重不触发形：连续同文提交第二笔不镜像（onSubmit 照发）', () => {
    const mirrored: string[] = [];
    const submitted: string[] = [];
    const editor = new Editor({
      onSubmit: (t) => submitted.push(t),
      onHistoryAdd: (t) => mirrored.push(t),
    });
    editor.handleEvent(text('same'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('same'));
    editor.handleEvent(key('enter'));
    // onSubmit 两笔照发（提交通道不因去重短路）；镜像只随真入册一笔
    expect(submitted).toEqual(['same', 'same']);
    expect(mirrored).toEqual(['same']);
  });

  it('historySeed 构造期播种：↑ 召回种子条（跨进程史存活位）', () => {
    const editor = new Editor({ historySeed: ['prev-1', 'prev-2'] });
    editor.handleEvent(key('up')); // 空框 ↑ 直入历史回溯
    expect(editor.getText()).toBe('prev-1');
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('prev-2');
  });

  it('两键缺席 = 纯内存旧形零扰动（确定性测试基线不破）', () => {
    // 缺席形：onSubmit 照发、入册照旧（既有测试全集即本形的行为锁——此处
    // 锁构造与提交无异常路径）
    const submitted: string[] = [];
    const editor = new Editor({ onSubmit: (t) => submitted.push(t) });
    editor.handleEvent(text('plain'));
    editor.handleEvent(key('enter'));
    expect(submitted).toEqual(['plain']);
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('plain');
  });

  it('种子 + 运行期入册衔接：种子在场时连续去重以种子 top-1 为判（跨进程首条衔接）', () => {
    const mirrored: string[] = [];
    const editor = new Editor({ historySeed: ['seeded-top'], onHistoryAdd: (t) => mirrored.push(t) });
    // 首提交与种子 top-1 同文 → 连续去重闸下（内存史 top-1 = 种子条）不镜像
    editor.handleEvent(text('seeded-top'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual([]);
    // 隔笔异文再录同文 → 真入册镜像
    editor.handleEvent(text('other'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('seeded-top'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual(['other', 'seeded-top']);
  });

  it('historyText 入史变换缝（56 轮件 1e——修前红：镜像钩原样收原稿）：内存册/镜像同源净稿 + onSubmit 恒原稿 + 空变换不入册', () => {
    // 缝契约：变换只及入史面（内存册 + B1 镜像钩单值）——onSubmit 恒收原稿
    //（词面分诊归调用方）；变换后空串与 trim 空同语义——不入册不镜像
    //（image-only 稿零空史目）；缺席 = 恒等旧形零扰动
    const mirrored: string[] = [];
    const submitted: string[] = [];
    const editor = new Editor({
      // 仿 backend 装配形：剥 `[图片]` 独占行（真源 splitImageMarkerLines 在
      // channels 侧——编辑器层测试以同语义替身锁缝契约不跨层 import）
      historyText: (t) =>
        t
          .split('\n')
          .filter((line) => line.trim() !== '[图片]')
          .join('\n')
          .replace(/^\n+/, '')
          .replace(/\n+$/, ''),
      onHistoryAdd: (t) => mirrored.push(t),
      onSubmit: (t) => submitted.push(t),
    });
    editor.handleEvent(text('看这张\n[图片]'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual(['看这张']); // 修前红位：原样收「看这张\n[图片]」——净稿化后占位不入册
    expect(submitted).toEqual(['看这张\n[图片]']); // 提交流恒原稿（剥除归调用方 54D 既有）
    editor.handleEvent(key('up')); // ↑ 召回——回灌净稿
    expect(editor.getText()).toBe('看这张');
    editor.handleEvent(key('down')); // ↓ 回今态清框
    editor.handleEvent(text('[图片]')); // image-only 形：变换后空串
    editor.handleEvent(key('enter'));
    expect(submitted).toHaveLength(2); // 提交照发（空稿路由归调用方）
    expect(mirrored).toHaveLength(1); // 空变换不入册不镜像
    editor.handleEvent(key('up')); // ↑ top-1 仍是首笔净稿（空史目未占位）
    expect(editor.getText()).toBe('看这张');
  });
});

describe('Editor 敏感形双跳第一跳（挖掘 37 轮件 3——07 §4.1 两集分立律）', () => {
  it('setSensitive(true)：提交 → 内存册不入（↑ 召回零原词）+ 镜像钩携位仍发（第二跳归持久回调自判）+ onSubmit 携位', () => {
    const events: string[] = [];
    const editor = new Editor({
      onSubmit: (t, opts) => events.push(`submit:${t}:${String(opts?.sensitive)}`),
      onHistoryAdd: (t, opts) => events.push(`mirror:${t}:${String(opts?.sensitive)}`),
      historySeed: ['seeded-top'],
    });
    // 修前红：setSensitive 方法缺位（TS2339 + 运行 TypeError）
    editor.setSensitive(true);
    editor.handleEvent(text('topsecret-key'));
    editor.handleEvent(key('enter'));
    // 双跳第一跳（内存册）：不入册——↑ 召回顶位仍是种子条非敏感词
    expect(editor.getText()).toBe('');
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('seeded-top'); // 修前红：召回 topsecret-key（明文入册）
    // 镜像钩仍发（携 sensitive 位——持久侧跳位自判；onSubmit 携位同拍）
    expect(events).toEqual(['mirror:topsecret-key:true', 'submit:topsecret-key:true']);
  });

  it('sensitive 形不受连续去重闸：同文两笔都携位镜像（去重判在内存史——sensitive 形从不入册无从去重）', () => {
    const mirrored: string[] = [];
    const editor = new Editor({
      onSubmit: () => {},
      onHistoryAdd: (t) => mirrored.push(t),
    });
    editor.setSensitive(true);
    editor.handleEvent(text('same-secret'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('same-secret'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual(['same-secret', 'same-secret']); // 每笔都镜像（无去重可判——对照 B1 去重测试）
  });

  it('setSensitive(false) 复位：普通形全链回归（入册 + 镜像无位 + 提交无位——应答窗收口退役位）', () => {
    const mirrored: string[] = [];
    const optsSeen: Array<boolean | undefined> = [];
    const editor = new Editor({
      onSubmit: (_t, opts) => optsSeen.push(opts?.sensitive),
      onHistoryAdd: (t) => mirrored.push(t),
    });
    editor.setSensitive(true);
    editor.setSensitive(false); // 复位（continueInputQueue 队列空退役位同拍）
    editor.handleEvent(text('normal'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('normal'); // 照常入册召回
    expect(mirrored).toEqual(['normal']); // 镜像无位（普通形恒等律）
    expect(optsSeen).toEqual([undefined]); // 提交无位
  });
});

describe('Editor 载密 argv 双闭锁（61 轮件 C——谓词真两跳全跳）', () => {
  it('谓词真：addToHistory 与 onHistoryAdd 双不调 + onSubmit 照发（↑ 召回零原词）', () => {
    const mirrored: string[] = [];
    const submitted: string[] = [];
    const editor = new Editor({
      // 仿宿主装配形：真源 isSecretArgvSubmission 在 plugins 域——编辑器层
      // 测试以同判替身锁 options 位契约不跨层 import（channels 禁 import
      // plugins——拓扑边表）
      secretSubmission: (t) => t.startsWith('/credentials '),
      onSubmit: (t) => submitted.push(t),
      onHistoryAdd: (t) => mirrored.push(t),
      historySeed: ['seeded-top'],
    });
    editor.handleEvent(text('/credentials add anthropic sk-plain-leak-9f2a'));
    editor.handleEvent(key('enter'));
    // 双跳全跳（较 sensitive 双跳更严：镜像钩也不发——明文不出编辑器组件）
    expect(mirrored).toEqual([]); // 修前红位：镜像照发收全文
    expect(submitted).toEqual(['/credentials add anthropic sk-plain-leak-9f2a']); // 提交通道不因跳史短路
    // 第一跳（内存册）：↑ 召回顶位仍是种子条——载密全文零入册（进程内回灌同防）
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('seeded-top'); // 修前红位：召回载密全文
  });

  it('mixed 草稿（占位行 + 命令行）：判据位在入史净稿——占位剥除后判载密、双跳全跳（61 轮闸 P2 清偿）', () => {
    const mirrored: string[] = [];
    const editor = new Editor({
      // 两缝同真源装配形（tui-backend 供 historyText 占位剥除、host 供谓词）
      secretSubmission: (t) => t.startsWith('/credentials add'),
      historyText: (t) => (t.startsWith('[图片]\n') ? t.slice('[图片]\n'.length) : t),
      onHistoryAdd: (t) => mirrored.push(t),
    });
    // 分派序实证：占位行剥除在先、startsWith('/') 判在后——mixed 草稿命令真
    // 执行（图随稿弃）；修前判据在原稿（words[0]='[图片]'）漏判 → 净稿全文
    // （载密 argv）入两册
    editor.handleEvent(text('[图片]\n/credentials add anthropic sk-plain-leak-9f2a'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual([]); // 修前红位：镜像收剥占位后的载密净稿
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe(''); // 内存册同零入（↑ 空史不召回）
  });

  it('谓词假：普通提交旧行为不动（入册 + 镜像照旧——非载密形零扰动）', () => {
    const mirrored: string[] = [];
    const editor = new Editor({
      secretSubmission: (t) => t.startsWith('/credentials '),
      onHistoryAdd: (t) => mirrored.push(t),
    });
    editor.handleEvent(text('/help'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual(['/help']); // 照常入册镜像
    editor.handleEvent(key('up'));
    expect(editor.getText()).toBe('/help'); // 照常召回
  });

  it('谓词缺席 = 旧行为零扰动（无载密判别面——全部提交照常两跳）', () => {
    const mirrored: string[] = [];
    const editor = new Editor({ onHistoryAdd: (t) => mirrored.push(t) });
    editor.handleEvent(text('/credentials list'));
    editor.handleEvent(key('enter'));
    expect(mirrored).toEqual(['/credentials list']); // 缺席形照常（确定性测试基线不破）
  });
});

describe('Editor 历史回搜（ctrl+r——挖掘 31 轮 [3]）', () => {
  /** 播种史装置：three 条新→旧（one/two/three 提交入册） */
  function editorWithHistory(): Editor {
    const editor = new Editor();
    editor.handleEvent(text('one'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('two'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('three'));
    editor.handleEvent(key('enter'));
    return editor;
  }

  it('修前红锚：ctrl+r 开搜被消费（键位册未收录修前终局丢弃返 false）', () => {
    const editor = editorWithHistory();
    // 修前：ctrl+r 无绑定走完 handleKey 全部 hit → false（未绑定键终局丢弃）
    expect(editor.handleEvent(key('r', { ctrl: true }))).toBe(true);
  });

  it('修前红锚：搜索态 text 入 query（命中预览入稿——修前 text 直接入稿）', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true })); // 开搜
    editor.handleEvent(text('on'));
    // 修前：无搜索门——'on' 直接入稿得 'on'；搜索态：'on' 入 query、命中史
    // 'one' 整条预览入稿（预览形）——两态判别器恰在此
    expect(editor.getText()).toBe('one');
  });

  it('开搜进场：搜索态在场 + 空行量高承诺 +1（编辑器组件透传 view 量高）', () => {
    const editor = editorWithHistory();
    expect(editor.isSearchingHistory()).toBe(false);
    expect(editor.handleEvent(key('r', { ctrl: true }))).toBe(true);
    expect(editor.isSearchingHistory()).toBe(true);
    // 空稿量高：最小高 3 + 上下垫 2 + 搜索行 1 = 6（contentRows 口径不含搜索行）
    expect(editor.measure(40)).toBe(6);
  });

  it('命中预览：query 子串命中整条入稿（大小写不敏感）+ 光标归位形', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('T')); // 大写查询小写史命中（toLowerCase 对拍）
    expect(editor.getText()).toBe('three'); // 新→旧首见（three 含 t 先于 two）
  });

  it('无命中还原：none 态稿面还原草稿（打点稿非空形）', () => {
    const editor = editorWithHistory();
    editor.handleEvent(text('打点草稿'));
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('zz')); // 无命中——还原草稿（打点稿回显）
    expect(editor.getText()).toBe('打点草稿');
    expect(editor.isSearchingHistory()).toBe(true); // 搜索态仍在（可改 query 再搜）
  });

  it('步进双向：ctrl+r 向旧 / ctrl+s 与 ↑↓ 册位步进 + 边界 no-op（挖掘 32 轮修——公式镜像 navigateHistory 的 -direction）', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('t')); // matches=[three,two] cursor=0（three 最新命中——开搜即最新位）
    expect(editor.getText()).toBe('three');
    expect(editor.handleEvent(key('s', { ctrl: true }))).toBe(true); // ctrl+s 向新——最新端 no-op
    expect(editor.getText()).toBe('three');
    expect(editor.handleEvent(key('down'))).toBe(true); // ↓ 册位同向新——最新端仍 no-op
    expect(editor.getText()).toBe('three');
    editor.handleEvent(key('r', { ctrl: true })); // 搜索态 ctrl+r 向旧：three→two
    expect(editor.getText()).toBe('two');
    expect(editor.model.getCursor().col).toBe(0); // 向旧落位形：光标归行首
    expect(editor.handleEvent(key('up'))).toBe(true); // ↑ 册位同向旧——最旧端 no-op
    expect(editor.getText()).toBe('two');
    expect(editor.handleEvent(key('s', { ctrl: true }))).toBe(true); // ctrl+s 向新：two→three
    expect(editor.getText()).toBe('three');
    expect(editor.model.getCursor().col).toBe(5); // 向新落位形：光标归行尾（'three'.length）
  });

  it('enter 采编退场：预览转工作稿 + 搜索态收场', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('tw'));
    expect(editor.getText()).toBe('two');
    expect(editor.handleEvent(key('enter'))).toBe(true);
    expect(editor.isSearchingHistory()).toBe(false);
    expect(editor.getText()).toBe('two'); // 预览转正不丢
  });

  it('esc 还原草稿退场', () => {
    const editor = editorWithHistory();
    editor.handleEvent(text('留稿'));
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('one')); // 命中预览 'one' 入稿
    expect(editor.getText()).toBe('one');
    expect(editor.handleEvent(key('escape'))).toBe(true);
    expect(editor.isSearchingHistory()).toBe(false);
    expect(editor.getText()).toBe('留稿'); // 草稿快照还原
  });

  it('backspace 字素退格：query 尾字素退（重算命中）', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('tw'));
    expect(editor.getText()).toBe('two');
    expect(editor.handleEvent(key('backspace'))).toBe(true);
    expect(editor.getText()).toBe('three'); // query 't' 重算——最新命中 three
  });

  it('ctrl+u 清空 query：idle 态 + 还原草稿', () => {
    const editor = editorWithHistory();
    editor.handleEvent(text('底稿'));
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('one'));
    editor.handleEvent(key('u', { ctrl: true })); // delete-to-line-start 清 query
    expect(editor.getText()).toBe('底稿'); // 空 query → idle + 还原草稿
    expect(editor.isSearchingHistory()).toBe(true); // 搜索态仍在
  });

  it('去重唯一命中：非连续重复史条 Set 按全文去重（首见=最新位保留）', () => {
    const editor = new Editor();
    editor.handleEvent(text('one'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('two'));
    editor.handleEvent(key('enter'));
    editor.handleEvent(text('one')); // 非连续重复（连续去重闸不挡——真实重发形）
    editor.handleEvent(key('enter'));
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('on'));
    expect(editor.getText()).toBe('one');
    // 去重后唯一命中——步进两端 no-op 稳定不炸
    expect(editor.handleEvent(key('s', { ctrl: true }))).toBe(true);
    expect(editor.getText()).toBe('one');
  });

  it('historySeed 可搜：构造期种子史同样入回搜命中集', () => {
    const editor = new Editor({ historySeed: ['alpha', 'beta'] });
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('al'));
    expect(editor.getText()).toBe('alpha');
    expect(editor.handleEvent(key('enter'))).toBe(true); // 采编
    expect(editor.getText()).toBe('alpha');
  });

  it('release 相归上层 + 其余键消费丢弃（alt+enter 不采编）', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('one'));
    expect(editor.handleEvent(key('r', { ctrl: true, phase: 'release' }))).toBe(false); // 释放相透传
    expect(editor.handleEvent(key('enter', { alt: true }))).toBe(true); // 候跑键序分立——不命中采编
    expect(editor.isSearchingHistory()).toBe(true); // 搜索态仍在（alt+enter 消费丢弃）
    expect(editor.handleEvent(key('enter'))).toBe(true); // 恰 enter 才采编
    expect(editor.isSearchingHistory()).toBe(false);
  });

  it('paste 消费丢弃：大段粘贴不进 query 不进稿', () => {
    const editor = editorWithHistory();
    editor.handleEvent(key('r', { ctrl: true }));
    editor.handleEvent(text('tw'));
    editor.handleEvent({ kind: 'paste', text: '大段粘贴内容' });
    expect(editor.getText()).toBe('two'); // 稿面不动（预览保持）
    editor.handleEvent(key('enter'));
    expect(editor.getText()).toBe('two'); // 采编后仍无粘贴痕迹
  });
});

/* ---------------- 提交帽（件 B——挖掘 46 轮：1 MiB 码点帽） ---------------- */

describe('Editor 提交帽（件 B——挖掘 46 轮）', () => {
  it('超帽拒交——onSubmit 零触发 + 草稿全量保留（修前红：无帽判照常提交清稿）', () => {
    const submitted: string[] = [];
    const rejected: Array<{ cap: number; actual: number }> = [];
    const editor = new Editor({
      onSubmit: (t) => submitted.push(t),
      onSubmitRejected: (info) => rejected.push(info),
    });
    editor.model.setText('a'.repeat((1 << 20) + 1)); // 超帽 1 码点
    expect(editor.handleEvent(key('enter'))).toBe(true); // enter 仍消费（拒非吞键）
    expect(submitted).toEqual([]); // 不下发
    expect(rejected).toEqual([{ cap: 1 << 20, actual: (1 << 20) + 1 }]); // 反馈回调参值
    expect(editor.model.getText()).toBe('a'.repeat((1 << 20) + 1)); // 草稿全量保留
  });

  it('恰等帽通过——正常提交清稿（codex > 同向：超才拒）', () => {
    const submitted: string[] = [];
    const rejected: Array<{ cap: number; actual: number }> = [];
    const editor = new Editor({
      onSubmit: (t) => submitted.push(t),
      onSubmitRejected: (info) => rejected.push(info),
    });
    editor.model.setText('a'.repeat(1 << 20));
    editor.handleEvent(key('enter'));
    expect(submitted).toEqual(['a'.repeat(1 << 20)]);
    expect(editor.getText()).toBe('');
    expect(rejected).toEqual([]);
  });

  it('码点计数——代理对文本按码点非 UTF-16（误实现检测锁：落码误用 .length 则红）', () => {
    const submitted: string[] = [];
    const editor = new Editor({ onSubmit: (t) => submitted.push(t) });
    // '𝕏'（U+1D54F）两 UTF-16 单元：600000 码点 < 帽，但 string.length = 1200000 > 帽
    const s = '𝕏'.repeat(600000);
    expect(s.length).toBeGreaterThan(1 << 20); // 误用 .length 会在帽判被拒
    editor.model.setText(s);
    editor.handleEvent(key('enter'));
    expect(submitted).toEqual([s]); // 码点计数通过提交
  });

  it('帽后删改再交——复原语义闭环（拒后编辑→提交通；修前红：第一步即被清稿）', () => {
    const submitted: string[] = [];
    const rejected: Array<{ cap: number; actual: number }> = [];
    const editor = new Editor({
      onSubmit: (t) => submitted.push(t),
      onSubmitRejected: (info) => rejected.push(info),
    });
    editor.model.setText('a'.repeat((1 << 20) + 5));
    editor.handleEvent(key('enter')); // 拒（草稿保留）
    editor.model.setText('a'.repeat(1 << 20)); // 删至帽内（setText 等价代删改）
    editor.handleEvent(key('enter'));
    expect(rejected).toHaveLength(1); // 只拒过一次
    expect(submitted).toEqual(['a'.repeat(1 << 20)]); // 删后全文提交通
  });

  it('回调缺席静默拒——裸构零异常（修前红：无帽判照常提交）', () => {
    const submitted: string[] = [];
    const editor = new Editor({ onSubmit: (t) => submitted.push(t) });
    editor.model.setText('a'.repeat((1 << 20) + 1));
    expect(() => editor.handleEvent(key('enter'))).not.toThrow();
    expect(submitted).toEqual([]);
    expect(editor.getText()).toBe('a'.repeat((1 << 20) + 1));
  });

  it('粘贴标记展开计入帽——expanded 单源（修前红：展开照常提交）', () => {
    const submitted: string[] = [];
    const rejected: Array<{ cap: number; actual: number }> = [];
    const editor = new Editor({
      onSubmit: (t) => submitted.push(t),
      onSubmitRejected: (info) => rejected.push(info),
    });
    // 超阈粘贴（> 20 行）自动标记化：稿内只占标记行，展开 25×50000 + 24 换行 = 1250024 码点超帽
    editor.model.insertPaste(Array.from({ length: 25 }, () => 'x'.repeat(50000)).join('\n'));
    expect(editor.model.getText()).toContain('[paste #'); // 标记形在稿（未撑爆布局）
    editor.handleEvent(key('enter'));
    expect(submitted).toEqual([]); // 计展开后拒交
    expect(rejected).toEqual([{ cap: 1 << 20, actual: 1250024 }]);
    expect(editor.model.getText()).toContain('[paste #'); // 草稿（标记形）保留
  });
});

/* ================= 模态拦截层（39 池 P4·L——07 §4.1 R5 mode 域） ================= */

describe('Editor 模态编辑拦截层', () => {
  it('默认关零漂移：text 照插入、escape 不消费、modalMode 恒 null', () => {
    const ed = new Editor();
    expect(ed.modalMode).toBe(null); // 关态观测面
    expect(ed.isModalEditing()).toBe(false);
    expect(ed.handleEvent(text('x'))).toBe(true);
    expect(ed.getText()).toBe('x'); // 命令字符照常入稿（非命令面）
    expect(ed.handleEvent(key('escape'))).toBe(false); // escape 归上层（非模态消费）
  });

  it('开后 normal 态：text 字素是命令非入稿；i 进 insert 后字素入稿', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    expect(ed.modalMode).toBe('normal');
    expect(ed.handleEvent(text('x'))).toBe(true); // 消费（作命令）
    expect(ed.getText()).toBe(''); // x 是删字符命令——空稿无操作零入稿
    expect(ed.handleEvent(text('i'))).toBe(true); // i 进 insert
    expect(ed.modalMode).toBe('insert');
    ed.handleEvent(text('hello'));
    expect(ed.getText()).toBe('hello');
  });

  it('insert 态 escape 归 normal 且左移不施（gap 隙位语义）；normal 态 escape 不消费', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    ed.handleEvent(text('i'));
    ed.handleEvent(text('ab'));
    expect(ed.handleEvent(key('escape'))).toBe(true); // insert 归 normal——消费
    expect(ed.modalMode).toBe('normal');
    expect(ed.model.getCursor().col).toBe(2); // 不左移（隙位语义——已知分歧注）
    expect(ed.handleEvent(key('escape'))).toBe(false); // normal 态不消费（归全局中断路）
    expect(ed.modalMode).toBe('normal');
  });

  it('insert 态 emacs 键全保留：ctrl+a 行首 / ctrl+k 删至行尾照旧', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    ed.handleEvent(text('i'));
    ed.handleEvent(text('hello'));
    expect(ed.handleEvent(key('a', { ctrl: true }))).toBe(true); // ctrl+a 行首
    expect(ed.model.getCursor().col).toBe(0);
    expect(ed.handleEvent(key('k', { ctrl: true }))).toBe(true); // ctrl+k 删至行尾
    expect(ed.getText()).toBe('');
  });

  it('normal 态 ctrl 族与具名键放行既有 dispatch：ctrl+c 透传 / enter 提交照旧', () => {
    const submitted: string[] = [];
    const ed = new Editor({ onSubmit: (t) => submitted.push(t) });
    ed.setModalEditing(true);
    expect(ed.handleEvent(key('c', { ctrl: true }))).toBe(false); // ctrl+c 生命线透传
    ed.handleEvent(text('i'));
    ed.handleEvent(text('hi'));
    ed.handleEvent(key('escape'));
    expect(ed.handleEvent(key('enter'))).toBe(true); // normal 态 enter 提交照旧
    expect(submitted).toEqual(['hi']);
  });

  it('pending 态 escape 取消即消费（不外泄作全局中断）；无效续接重处理', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    ed.handleEvent(text('i'));
    ed.handleEvent(text('ab'));
    ed.handleEvent(key('escape'));
    ed.handleEvent(text('0')); // 行首
    ed.handleEvent(text('d')); // pending d
    expect(ed.modalMode).toBe('pending');
    expect(ed.handleEvent(key('escape'))).toBe(true); // 取消——消费
    expect(ed.modalMode).toBe('normal');
    expect(ed.getText()).toBe('ab'); // 稿未动
    ed.handleEvent(text('d'));
    ed.handleEvent(text('x')); // x 非 d 续接——取消重处理成 x 命令（删首字符）
    expect(ed.getText()).toBe('b');
  });

  it('jump 待靶让位：normal 态 ctrl+] 武装、下一字符作跳靶非命令', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    ed.handleEvent(text('i'));
    ed.handleEvent(text('axbx'));
    ed.handleEvent(key('escape'));
    ed.handleEvent(text('0')); // 行首
    expect(ed.handleEvent(key(']', { ctrl: true }))).toBe(true); // ctrl+] 武装待靶（键路不拦）
    expect(ed.handleEvent(text('x'))).toBe(true); // 跳靶消费（非模态命令）
    expect(ed.model.getCursor().col).toBe(1); // 跳至靶字符位（jumpToChar 语义——靶前隙位）
    expect(ed.getText()).toBe('axbx'); // 稿未动
  });

  it('paste 放行：normal 态粘贴照既有路原子入稿（不进命令面）', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    expect(ed.handleEvent({ kind: 'paste', text: 'pasted' })).toBe(true);
    expect(ed.getText()).toBe('pasted');
    expect(ed.modalMode).toBe('normal');
  });

  it('开关翻转重置：off 后 text 照插入；再 on 回 normal fresh 态', () => {
    const ed = new Editor();
    ed.setModalEditing(true);
    ed.handleEvent(text('i')); // insert 态
    ed.setModalEditing(false);
    expect(ed.modalMode).toBe(null);
    expect(ed.handleEvent(text('x'))).toBe(true);
    expect(ed.getText()).toBe('x'); // 关后字素入稿（零拦截）
    ed.setModalEditing(true);
    expect(ed.modalMode).toBe('normal'); // fresh 重开（非续 insert 态）
  });

  it('onModalChange 态翻转通知：insert↔normal 与 pending 进出均触发（观测装配联动）', () => {
    const flips: (string | null)[] = [];
    const ed = new Editor({ onModalChange: () => flips.push(ed.modalMode) });
    ed.setModalEditing(true); // 开——null→normal 一翻
    ed.handleEvent(text('i')); // normal→insert
    ed.handleEvent(key('escape')); // insert→normal
    ed.handleEvent(text('d')); // normal→pending
    ed.handleEvent(key('escape')); // pending→normal
    expect(flips).toEqual(['normal', 'insert', 'normal', 'pending', 'normal']);
  });
});
