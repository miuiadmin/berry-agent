/**
 * webui/client/components/Composer — 输入区（批 18a-2；@ 文件段补全弹层随批）。
 *
 * 提交（Enter 发送 / Shift+Enter 换行）与打断两键；提交通路幂等位由
 * App 生成（crypto.randomUUID）——本件零状态外触。
 *
 * @ 文件段补全弹层（fetchFileCompletions 注入，缺席 = 零补全面）——
 * - 触发判据：onChange 读 selectionStart，对当前逻辑行做引号感知 token
 *   提取（tokenAtCaret——TUI tokenAtCursor 的单行移植），token 以 '@' 起头
 *   即激活（裸 '@' 亦激活，q='' 列根）；查询 q = token 内文去 '@' 前缀。
 * - 数据流：v1 直询零防抖（回环毫秒级）；seq 竞态守卫——每次触发递增，
 *   应答时 seq 不匹配整包丢弃（迟到不呈现不闪层）；空 items / fetch
 *   reject / token 失活三形都静默关层——补全是增强面非正确性面，失败
 *   不冒泡。
 * - 键盘分形：弹层开时 ArrowDown/ArrowUp 循环移选中项、Enter（无 shift）
 *   与 Tab（无 shift——TUI 双键律 SPA 形）选中代换（不让位发送/移焦）、
 *   Escape 关层；弹层闭时原样（Enter 发送）。
 * - 插入编舞：选中项原串代换 text[tokenStart, selectionStart) 区间
 *   （selectionStart 取选中时点输入框当下位——v1 简形，位点漂移随下次
 *   onChange 重算自愈）；光标复位走 useEffect + pendingCaretRef（不用
 *   requestAnimationFrame——jsdom 轨 rAF 可用性不保证）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

/** 光标 token（单行 UTF-16 区间 + 原文） */
export interface CaretToken {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * 光标前 token 提取（引号感知单行版——TUI tokenAtCursor 同判据移植）。
 *
 * 引号感知：token 边界 = 最近的未引用空白——从行首正向扫描推进引号开闭
 * 态（引号内空白不断 token——@"my file" 形整段为一个 token）；引号字符
 * 本身属 token（代换区间含引号）。已知边界：未闭合引号一路吸到引号头
 * （输入中间态本就未闭合，可接受）。
 */
export function tokenAtCaret(line: string, caret: number): CaretToken | null {
  if (caret <= 0 || caret > line.length) return null;
  // 正向扫描（引号态须从行首推进——反向扫遇空白先于遇引号头，无法判定
  // 该空白是否被右侧引号包住）
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < caret; i++) {
    const ch = line[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null; // 引号闭
      continue; // 引号内字符（含空白）不断 token
    }
    if (ch === '"' || ch === "'") {
      quote = ch; // 引号开
      continue;
    }
    if (ch === ' ' || ch === '\t') start = i + 1; // 未引用空白——token 边界
  }
  const text = line.slice(start, caret);
  if (text === '') return null; // 紧邻空白——无 token
  return { start, end: caret, text };
}

/** 输入区（onSubmit 提交正文 / onInterrupt 打断在飞 run / fetchFileCompletions @ 文件段补全源） */
export function Composer({
  onSubmit,
  onInterrupt,
  fetchFileCompletions,
}: {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  /** @ 文件段补全源（q = 去 @ 前缀的 token 内文；缺席 = 零补全面——增强面） */
  readonly fetchFileCompletions?: (query: string) => Promise<readonly string[]>;
}): ReactElement {
  const [text, setText] = useState('');
  /** 弹层条目（整 token 代换单位串——空数组 = 层闭） */
  const [items, setItems] = useState<readonly string[]>([]);
  /** 弹层选中项下标 */
  const [activeIndex, setActiveIndex] = useState(0);
  /** 竞态守卫序号（每次触发递增——应答时不匹配即整包丢弃） */
  const seqRef = useRef(0);
  /** 当前 @ token 起点（全文坐标——代换区间左端；层闭即 null） */
  const tokenStartRef = useRef<number | null>(null);
  /** 插入后待复位光标位（useEffect 消费后清空） */
  const pendingCaretRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  /** 关层（作废在途应答 + 清空条目与 token 起点） */
  const closeLayer = (): void => {
    seqRef.current++;
    setItems([]);
    setActiveIndex(0);
    tokenStartRef.current = null;
  };

  /**
   * 光标驱动的触发判据（onChange 共用）：提取当前逻辑行的光标 token，
   * '@' 起头即查询（q 去 @ 前缀）；否则静默关层。三静默关层形——空 items
   * （setItems([]) 直落）、fetch reject（catch 关层）、token 失活（前置
   * 分支关层）。
   */
  const handleCaret = (value: string, caret: number): void => {
    if (fetchFileCompletions === undefined) return; // prop 缺席零补全面
    // 当前逻辑行 = 光标前最后一个换行之后（多行输入只看光标所在行）
    const lineStart = value.lastIndexOf('\n', Math.max(caret - 1, 0)) + 1;
    const token = tokenAtCaret(value.slice(lineStart), caret - lineStart);
    if (token === null || !token.text.startsWith('@')) {
      closeLayer();
      return;
    }
    tokenStartRef.current = lineStart + token.start;
    const seq = ++seqRef.current;
    fetchFileCompletions(token.text.slice(1))
      .then((list) => {
        if (seqRef.current !== seq) return; // 迟到应答丢弃（不呈现不闪层）
        setItems(list); // 空 items = 层闭（渲染条件 length > 0）
        setActiveIndex(0);
      })
      .catch(() => {
        if (seqRef.current !== seq) return;
        setItems([]); // 拒形静默关层——增强面失败不打扰
      });
  };

  const send = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    closeLayer(); // 发送即清空输入——无 token，防陈旧弹层滞留
    onSubmit(trimmed);
    setText('');
  };

  /** 选中代换：item 原串代换 text[tokenStart, selectionStart) 区间 */
  const insertItem = (index: number): void => {
    const item = items[index];
    const start = tokenStartRef.current;
    const el = textareaRef.current;
    if (item === undefined || start === null || el === null) return;
    // selectionStart 取选中时点输入框当下位（v1 简形——位点漂移随下次
    // onChange 重算自愈）
    const caret = el.selectionStart;
    pendingCaretRef.current = start + item.length; // 光标复位到代换串尾
    closeLayer(); // 关层 + 作废在途
    setText(text.slice(0, start) + item + text.slice(caret));
  };

  // 插入后光标复位（代换串尾 + focus；文本变更渲染落位后执行）
  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [text]);

  return (
    <div className="flex items-end gap-2 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
      {/* relative 容器承载弹层锚（绝对定位挂输入框上方——聊天输入区惯例） */}
      <div className="relative min-w-0 flex-1">
        {items.length > 0 ? (
          <div
            role="listbox"
            aria-label="文件补全候选"
            className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            {items.map((item, index) => (
              <div
                key={`${index}:${item}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer truncate px-3 py-1 text-left text-xs ${
                  index === activeIndex ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400'
                }`}
                // onMouseDown 不夺输入框焦点（preventDefault）——位点不漂移
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  insertItem(index);
                }}
              >
                {item}
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          placeholder="输入消息——Enter 发送，Shift+Enter 换行"
          rows={2}
          value={text}
          onChange={(ev) => {
            setText(ev.target.value);
            handleCaret(ev.target.value, ev.target.selectionStart);
          }}
          onKeyDown={(ev) => {
            // 弹层开时先分形补全四键（Enter 选中代换——不让位发送）
            if (items.length > 0) {
              if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                setActiveIndex((i) => (i + 1) % items.length);
                return;
              }
              if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                setActiveIndex((i) => (i - 1 + items.length) % items.length);
                return;
              }
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                insertItem(activeIndex);
                return;
              }
              // Tab 同 Enter 选中代换（TUI popup 选中双键律 enter|tab 的
              // SPA 形——裸 Tab 拦截；Shift+Tab 保留浏览器反向移焦缺省）
              if (ev.key === 'Tab' && !ev.shiftKey) {
                ev.preventDefault();
                insertItem(activeIndex);
                return;
              }
              if (ev.key === 'Escape') {
                ev.preventDefault();
                closeLayer();
                return;
              }
            }
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              send();
            }
          }}
        />
      </div>
      <button
        type="button"
        className="rounded bg-zinc-200 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
        disabled={text.trim() === ''}
        onClick={send}
      >
        发送
      </button>
      <button
        type="button"
        className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
        onClick={onInterrupt}
      >
        打断
      </button>
    </div>
  );
}
