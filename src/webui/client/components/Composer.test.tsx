/**
 * webui/client/components/Composer 单件直锁（覆盖锁；jsdom 轨）。
 *
 * 输入区四真行为——
 * ① 发送键使能律：空/纯空白恒 disabled，有效文本 enabled
 * ② 提交通路：onSubmit 收 trim 后正文且发送后输入框清空（幂等位在 App——
 * 本件零状态外触）
 * ③ 键盘分形：Enter 发送 / Shift+Enter 不发送（换行让位）
 * ④ 打断键直通 onInterrupt
 *
 * @ 文件段补全弹层（SPA 补全客户端腿）——
 * ⑤ tokenAtCaret 纯函数四形（引号感知单行 token 提取——TUI tokenAtCursor
 * 同判据移植）
 * ⑥ 触发/渲染/循环导航/Enter 区间代换/Esc 收层/token 失活/迟到应答 seq 丢弃/
 * reject 静默/prop 缺席零补全面
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer, tokenAtCaret } from './Composer.js';

afterEach(() => {
  cleanup();
});

/** 取发送键原生 disabled 态（未装 jest-dom——属性位直读） */
function sendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '发送' }) as HTMLButtonElement;
}

/** 取输入框 */
function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('输入消息——Enter 发送，Shift+Enter 换行') as HTMLTextAreaElement;
}

/**
 * 追加形输入（光标钉在新值尾位——jsdom 的 selectionStart 位点行为跨版本
 * 不稳，交互测锚显式追加形；中位形由 tokenAtCaret 纯函数直锁）。
 */
function typeAppend(value: string, caret?: number): void {
  fireEvent.change(textarea(), { target: { value, selectionStart: caret ?? value.length } });
}

/** 取弹层当前选中项文本（aria-selected=true 的 option） */
function activeOption(): string {
  const options = screen.getAllByRole('option');
  const active = options.find((el) => el.getAttribute('aria-selected') === 'true');
  return active?.textContent ?? '';
}

describe('Composer 发送键使能律', () => {
  it('初始空文本 disabled；有效文本 enabled；纯空白仍 disabled', () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    expect(sendButton().disabled).toBe(true);
    fireEvent.change(textarea(), { target: { value: '你好' } });
    expect(sendButton().disabled).toBe(false);
    // 纯空白 trim 后为空——不构成可发送正文
    fireEvent.change(textarea(), { target: { value: '   ' } });
    expect(sendButton().disabled).toBe(true);
  });
});

describe('Composer 提交通路', () => {
  it('点击发送：onSubmit 收 trim 正文 + 输入框清空', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: '  你好呀  ' } });
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledWith('你好呀');
    expect(textarea().value).toBe(''); // 发送后清空（下一问从零起）
  });

  it('Enter 触发发送；Shift+Enter 不发送（换行让位）', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: '第一句' } });
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('第一句');
    expect(textarea().value).toBe('');
  });
});

describe('Composer 打断键', () => {
  it('点击打断直通 onInterrupt（缺省 canInterrupt=true——本件直测形不受 App 供血影响）', () => {
    const onInterrupt = vi.fn();
    render(<Composer onSubmit={vi.fn()} onInterrupt={onInterrupt} />);
    const interrupt = screen.getByRole('button', { name: '打断' }) as HTMLButtonElement;
    expect(interrupt.disabled).toBe(false); // 空输入也允许打断在飞 run
    fireEvent.click(interrupt);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('canInterrupt=false 禁用打断键（界面美化役批⑧——App 供血 run 在飞判据，闲态诚实呈不可点）', () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} canInterrupt={false} />);
    const interrupt = screen.getByRole('button', { name: '打断' }) as HTMLButtonElement;
    expect(interrupt.disabled).toBe(true);
  });
});

describe('tokenAtCaret（引号感知单行 token 提取）', () => {
  it('引号吞空白：@"my f 整 token（未闭合引号一路吸到引号头）', () => {
    expect(tokenAtCaret('see @"my f', 10)).toEqual({ start: 4, end: 10, text: '@"my f' });
  });

  it('行中位 token：未引用空白后的段独立成 token（起点后移）', () => {
    expect(tokenAtCaret('你好 @src', 7)).toEqual({ start: 3, end: 7, text: '@src' });
  });

  it('紧邻空白 → null（光标贴在空白右侧无 token 段）', () => {
    expect(tokenAtCaret('hello ', 6)).toBeNull();
    expect(tokenAtCaret('', 0)).toBeNull();
  });

  it("裸 @ 亦成 token（q='' 列根形——与服务端空 needle 恒真对齐）", () => {
    expect(tokenAtCaret('@', 1)).toEqual({ start: 0, end: 1, text: '@' });
  });
});

describe('Composer @ 文件段补全弹层', () => {
  it("@ 触发查询：q 去 @ 前缀（裸 @ 亦触发 q=''）+ 弹层在场", async () => {
    const files = vi.fn(async () => ['@sub/']);
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@');
    expect(files).toHaveBeenCalledWith(''); // 裸 @ 列根
    typeAppend('@su');
    expect(files).toHaveBeenLastCalledWith('su');
    expect(await screen.findByRole('listbox')).toBeTruthy();
  });

  it('条目渲染：items 映射 role=option、首项 aria-selected=true', async () => {
    const files = vi.fn(async () => ['@sub/', '@"my file.txt"']);
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    // 整 token 串直显（含 @ 前缀与引号形——所见即所插）
    expect(options[0]!.textContent).toBe('@sub/');
    expect(options[1]!.textContent).toBe('@"my file.txt"');
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(options[1]!.getAttribute('aria-selected')).toBe('false');
  });

  it('↑↓ 循环导航：两次 ArrowDown 到末项再 ArrowDown 回首项（wrap）', async () => {
    const files = vi.fn(async () => ['@a.ts', '@b.ts', '@c.ts']);
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@');
    await screen.findAllByRole('option');
    expect(activeOption()).toBe('@a.ts');
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    expect(activeOption()).toBe('@b.ts');
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    expect(activeOption()).toBe('@c.ts');
    // 末项再下——绕回首项（循环）
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' });
    expect(activeOption()).toBe('@a.ts');
    // 首项再上——绕回末项（循环）
    fireEvent.keyDown(textarea(), { key: 'ArrowUp' });
    expect(activeOption()).toBe('@c.ts');
  });

  it('Enter 选中代换：@token 区间被原串代换（非追加）+ 弹层关 + onSubmit 不触发', async () => {
    const onSubmit = vi.fn();
    const files = vi.fn(async () => ['@alpha.ts']);
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('see @al');
    await screen.findAllByRole('option');
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    // 区间代换：前缀保留、@al 被整 token 串代换（非末尾追加）
    expect(textarea().value).toBe('see @alpha.ts');
    expect(screen.queryByRole('listbox')).toBeNull(); // 弹层关
    expect(onSubmit).not.toHaveBeenCalled(); // Enter 让位选中——不让位发送
  });

  it('Tab 选中代换（TUI popup 双键律 enter|tab 的 SPA 形）：裸 Tab 同 Enter 代换关层', async () => {
    const onSubmit = vi.fn();
    const files = vi.fn(async () => ['@alpha.ts']);
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('see @al');
    await screen.findAllByRole('option');
    fireEvent.keyDown(textarea(), { key: 'Tab' });
    expect(textarea().value).toBe('see @alpha.ts'); // 同 Enter 区间代换
    expect(screen.queryByRole('listbox')).toBeNull(); // 弹层关
    expect(onSubmit).not.toHaveBeenCalled(); // Tab 让位选中——不触发发送
  });

  it('Esc 关层不发送；随后 Enter 照发（原发送律零回归）', async () => {
    const onSubmit = vi.fn();
    const files = vi.fn(async () => ['@sub/']);
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@su');
    await screen.findAllByRole('option');
    fireEvent.keyDown(textarea(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled(); // Esc 不触发发送
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('@su'); // 弹层闭后 Enter 原样发送
    expect(textarea().value).toBe('');
  });

  it('token 失活关闭：@su 后追敲未引用空格 → 弹层关 + 无新查询', async () => {
    const files = vi.fn(async () => ['@sub/']);
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@su');
    await screen.findAllByRole('option');
    expect(files).toHaveBeenCalledTimes(1); // '@su' 单次变更单查询
    typeAppend('@su ', 4); // 追敲未引用空格——token 断
    expect(screen.queryByRole('listbox')).toBeNull(); // 弹层同步关
    expect(files).toHaveBeenCalledTimes(1); // 无新查询
  });

  it('迟到应答丢弃：慢先快后——仅末次 items 呈现（seq 竞态锁）', async () => {
    let releaseSlow: (items: readonly string[]) => void = () => {};
    const slow = new Promise<readonly string[]>((resolve) => {
      releaseSlow = resolve;
    });
    const files = vi.fn((q: string) => (q === 'a' ? slow : Promise.resolve(['@fast/'])));
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@a'); // 触发慢查询（挂起）
    typeAppend('@ab'); // 快查询抢占
    expect(await screen.findByText('@fast/')).toBeTruthy();
    // 慢腿此刻才回——迟到应答必须整包丢弃（不呈现不闪层）
    await act(async () => {
      releaseSlow(['@slow/']);
    });
    expect(screen.queryByText('@slow/')).toBeNull();
    expect(screen.getByRole('listbox')).toBeTruthy(); // 弹层仍开（末次应答不被慢腿关掉）
  });

  it('fetch 拒形静默：reject → 弹层不开不抛、输入文本不丢', async () => {
    const files = vi.fn(() => Promise.reject(new Error('网络断')));
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} fetchFileCompletions={files} />);
    typeAppend('@x');
    await act(async () => {}); // 冲刷 reject 微任务（catch 静默）
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(textarea().value).toBe('@x'); // 输入不丢
  });

  it('prop 缺席零补全面：不传 fetchFileCompletions 输入 @ → 无查询无弹层无异常', () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    typeAppend('@su');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(textarea().value).toBe('@su'); // 输入不受影响（增强面缺席零污染）
  });
});

/* ---------------- 图片粘贴受理（2026-10-08 剪贴板附件批——03 §10.4 批注⑥） ---------------- */

describe('Composer 图片粘贴受理（剪贴板附件批——双源采集 + 帽前置 + chip 附件栏）', () => {
  /** 图片文件速造（jsdom File 构造子——字节 [1,2,3] 的 base64 恒 'AQID'） */
  const imageFile = (name = 'shot.png'): File => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

  /** 触发粘贴（clipboardData 桩——files 腿 / items 腿按用例给形） */
  function paste(files: File[], items: { kind: string; type: string; getAsFile: () => File | null }[]): void {
    fireEvent.paste(textarea(), { clipboardData: { files, items } });
  }

  it('files 腿（修前红）：clipboardData.files 图片 → 暂存 chip（缩略图 + 已附计数 1/4）', async () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    paste([imageFile()], []);
    expect(await screen.findByText('1/4')).toBeTruthy(); // 修前红：无 onPaste 受理——chip 恒不出现
    const thumb = screen.getByRole('img');
    expect((thumb as HTMLImageElement).src).toBe('data:image/png;base64,AQID'); // dataURL 暂存预览
  });

  it('items 腿（修前红——截图常只在此暴露）：files 空 + items 遍历 kind=file 且 image/* → 暂存', async () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    paste(
      [],
      [
        { kind: 'string', type: 'text/plain', getAsFile: () => null }, // 非文件项跳过
        { kind: 'file', type: 'image/png', getAsFile: () => imageFile() },
      ],
    );
    expect(await screen.findByText('1/4')).toBeTruthy(); // 修前红：同上
  });

  it('双源不双计：files 已有图时 items 不再补采（files 优先单源腿——两源同形免重复）', async () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    paste([imageFile()], [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile() }]);
    expect(await screen.findByText('1/4')).toBeTruthy(); // 恰一枚——非 2/4
  });

  it('超帽拒暂存（修前红）：已附 3 再贴 2 → 计数不动 + 帽提示文案在场（客户端前置帽 4）', async () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    paste([imageFile('a.png'), imageFile('b.png'), imageFile('c.png')], []);
    expect(await screen.findByText('3/4')).toBeTruthy();
    paste([imageFile('d.png'), imageFile('e.png')], []);
    // 超帽粘贴即拒不暂存——中文白话单源文案逐字锁
    expect(await screen.findByText('图片最多 4 张，本次粘贴未添加')).toBeTruthy(); // 修前红：无帽逻辑
    expect(screen.getByText('3/4')).toBeTruthy(); // 计数不动（未暂存）
  });

  it('删除键：chip 逐枚移除 → 计数回落到 0 后附件栏退场', async () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    paste([imageFile()], []);
    expect(await screen.findByText('1/4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 张图片' }));
    expect(screen.queryByText('1/4')).toBeNull(); // 附件栏随零附件退场
  });

  it('非图片粘贴让位：无图 files/items → 无 chip 且正文粘贴行为不受扰', () => {
    render(<Composer onSubmit={vi.fn()} onInterrupt={vi.fn()} />);
    paste([], [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]);
    expect(screen.queryByText('0/4')).toBeNull(); // 零附件不占位（附件栏不呈现）
    expect(textarea().value).toBe(''); // 正文位不受粘贴受理影响
  });

  it('发送随附件（修前红）：文+图 → onSubmit(trim 正文, [{dataUrl, mimeType}]) + 发送后 chip 清空', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} />);
    typeAppend('看这张');
    paste([imageFile()], []);
    expect(await screen.findByText('1/4')).toBeTruthy();
    fireEvent.click(sendButton());
    // 附件与文本同条提交（chip 原形透传——dataURL 前缀剥除归 api 层）
    expect(onSubmit).toHaveBeenCalledWith('看这张', [{ dataUrl: 'data:image/png;base64,AQID', mimeType: 'image/png' }]); // 修前红：onSubmit 只收单参正文
    expect(screen.queryByText('1/4')).toBeNull(); // chip 清空
    expect(textarea().value).toBe(''); // 正文清空（既有律）
  });

  it("image-only 提交放行（03 §10.4 批注①）：空文 + 1 图 → 发送键 enabled、onSubmit('', [附件])", async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onInterrupt={vi.fn()} />);
    expect(sendButton().disabled).toBe(true); // 零输入不可发（既有律维持）
    paste([imageFile()], []);
    expect(await screen.findByText('1/4')).toBeTruthy();
    expect(sendButton().disabled).toBe(false); // 图在场即构成可发送正文
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledWith('', [{ dataUrl: 'data:image/png;base64,AQID', mimeType: 'image/png' }]);
  });
});
