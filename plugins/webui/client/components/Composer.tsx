/**
 * webui/client/components/Composer — 输入区（批 18a-2；@ 文件段补全弹层随批）。
 *
 * 提交（Enter 发送 / Shift+Enter 换行）与打断两键；提交通路幂等位由
 * App 生成（crypto.randomUUID）——本件零状态外触。
 *
 * 图片粘贴受理（剪贴板附件批——03 §10.4 批注⑥）：onPaste 双源采集
 * （clipboardData.files 优先、items 遍历 kind='file' 且 image/* 兜底——截图
 * 常只在 items 暴露）→ FileReader 读 dataURL 暂存 chip 附件栏（缩略图 +
 * 删除键 + 已附计数 N/4）→ 随 onSubmit 第二参原形透传（dataURL 前缀剥除归
 * api 层单源——本件零前缀知识）。数量帽 4 客户端前置（服务端同值帽的受理
 * 前置拒——超帽粘贴整批拒不暂存，文案单源中文白话）；image-only（空文有
 * 图）构成可发送正文（批注①空串+images 语义）。
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
import type { ClipboardEvent, ReactElement } from 'react';

import type { SubmitAttachment } from '../api.js';

/** 附件数量帽（客户端前置——与服务端受理帽同值 4 件/消息，03 §10.4 批注②⑥） */
const ATTACHMENT_CAP = 4;

/** 超帽提示文案（中文白话单源——「提示文案中文白话单源」硬要求；数字随帽单源） */
const ATTACHMENT_CAP_NOTICE = `图片最多 ${ATTACHMENT_CAP} 张，本次粘贴未添加`;

/**
 * 剪贴板图片双源采集（03 §10.4 批注⑥——双源兜底是硬要求）：files 腿优先
 * （type 以 image/ 起头才采）；files 腿零图再遍历 items 腿（kind === 'file'
 * 且 type 以 image/ 起头——截图常只在此暴露；getAsFile() 空值坏形跳过）。
 * files 腿已有图即不再补采 items——两源同形，双源并采必双计。
 */
function collectImageFiles(data: {
  readonly files?: ArrayLike<File> | null;
  readonly items?: ArrayLike<{
    readonly kind: string;
    readonly type: string;
    readonly getAsFile: () => File | null;
  }> | null;
}): File[] {
  const fromFiles: File[] = [];
  if (data.files !== undefined && data.files !== null) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith('image/')) fromFiles.push(file);
    }
  }
  if (fromFiles.length > 0) return fromFiles; // files 腿单源——items 不补采（免双计）
  if (data.items === undefined || data.items === null) return [];
  const fromItems: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file !== null) fromItems.push(file);
  }
  return fromItems;
}

/** File → dataURL（FileReader 异步——缩略图预览与提交载荷共源同一读形） */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取粘贴图片失败'));
    reader.readAsDataURL(file);
  });
}

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

/** 输入区（onSubmit 提交正文+可选附件 / onInterrupt 打断在飞 run / canInterrupt 打断键使能 / fetchFileCompletions @ 文件段补全源） */
export function Composer({
  onSubmit,
  onInterrupt,
  canInterrupt = true,
  fetchFileCompletions,
}: {
  /**
   * 提交（剪贴板附件批——03 §10.4 批注⑥）：第二参 = 粘贴暂存附件（chip
   * 原形 {dataUrl, mimeType}——dataURL 前缀剥除归 api 层单源，本件零前缀
   * 知识）；纯文提交恒单参调用（既有调用面零漂移）。附件与文本同条提交
   * （批注① images 内联同条 JSON）。
   */
  onSubmit: (text: string, attachments?: readonly SubmitAttachment[]) => void;
  onInterrupt: () => void;
  /**
   * 打断键使能（界面美化役批⑧——缺省 true 保持本件直测形不变；App 侧
   * 由 run 活体窗/流式尾巴/状态行复合判据供血：无在飞 run 时禁用，诚实
   * 呈「不可打断」而非可点无效键）
   */
  readonly canInterrupt?: boolean;
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

  /* ---- 图片粘贴暂存（剪贴板附件批——03 §10.4 批注⑥） ---- */
  /** 已暂存附件（chip 原形——dataURL 全形，提交透传由 api 层剥前缀） */
  const [attachments, setAttachments] = useState<readonly SubmitAttachment[]>([]);
  /** 附件真源镜像（事件处理器同步读——免 FileReader 异步窗的闭包陈值竞态） */
  const attachmentsRef = useRef<readonly SubmitAttachment[]>([]);
  /** 在读件计数（粘贴受理至 FileReader resolve 的异步窗——帽判计入在读件） */
  const readingRef = useRef(0);
  /** 粘贴代序号（发送清场递增——作废在途读件的迟到 append） */
  const pasteGenRef = useRef(0);
  /** 超帽提示在场位（下次受理成功或删除即清——非驻留通知） */
  const [capNotice, setCapNotice] = useState(false);

  /** 附件落账（ref 与 state 同步单点——防两真源漂移） */
  const commitAttachments = (next: readonly SubmitAttachment[]): void => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  /** 逐枚移除（chip 删除键——按下标定位；提示位随清） */
  const removeAttachment = (index: number): void => {
    commitAttachments(attachmentsRef.current.filter((_, i) => i !== index));
    setCapNotice(false);
  };

  /**
   * 粘贴受理：双源采集 → 帽判 → FileReader 批读 → chip 暂存。非图片粘贴
   * 零受理让位缺省行为（正文粘贴不受扰）；图片在场即 preventDefault（图文
   * 混贴图优先——不双走正文）。超帽整批拒（「本次粘贴未添加」——不部分采）。
   */
  const handlePaste = (ev: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = collectImageFiles(ev.clipboardData);
    if (files.length === 0) return; // 非图片粘贴——让位缺省粘贴（零受理零拦截）
    ev.preventDefault(); // 图片受理——不走正文粘贴
    // 帽 4 客户端前置（在读件计入——连贴两批不穿帽）
    if (attachmentsRef.current.length + readingRef.current + files.length > ATTACHMENT_CAP) {
      setCapNotice(true);
      return;
    }
    setCapNotice(false);
    readingRef.current += files.length;
    const gen = pasteGenRef.current; // 发送清场作废位快照
    void Promise.all(files.map(async (file) => ({ dataUrl: await readAsDataUrl(file), mimeType: file.type })))
      .then((staged) => {
        readingRef.current -= files.length;
        if (gen !== pasteGenRef.current) return; // 发送已清场——迟到读件丢弃
        commitAttachments([...attachmentsRef.current, ...staged]);
      })
      .catch(() => {
        // 读失败静默丢该批（增强面失败不打扰——与补全弹层 reject 同律）；
        // 在读计数回退（帽位不滞留——后续粘贴不被陈在读件虚占）
        readingRef.current -= files.length;
      });
  };

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
    // 图在场即构成可发送正文（image-only——03 §10.4 批注①空串+images 语义）；
    // 纯空文零图维持不可发（既有律）
    if (trimmed === '' && attachmentsRef.current.length === 0) return;
    closeLayer(); // 发送即清空输入——无 token，防陈旧弹层滞留
    // 纯文单参 / 带附件双参（既有调用面与新增面各零漂移）
    if (attachmentsRef.current.length > 0) onSubmit(trimmed, attachmentsRef.current);
    else onSubmit(trimmed);
    setText('');
    // 附件栏清场：作废在途读件（迟到 chip 不复活）+ 暂存清空 + 提示位清
    pasteGenRef.current++;
    commitAttachments([]);
    setCapNotice(false);
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
    <div className="border-t border-edge bg-canvas px-4 py-3">
      {/* 超帽提示行（客户端前置帽的拒收反馈——文案单源中文白话） */}
      {capNotice ? <p className="pb-1 text-xs text-danger">{ATTACHMENT_CAP_NOTICE}</p> : null}
      {/* chip 附件栏（剪贴板附件批——03 §10.4 批注⑥：缩略图预览 + 删除键 +
          已附计数 N/4；零附件不占位——附件栏形无文内占位符） */}
      {attachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pb-2" aria-label="待发送图片">
          {attachments.map((attachment, index) => (
            <div key={`${index}:${attachment.dataUrl.slice(-24)}`} className="relative">
              <img
                src={attachment.dataUrl}
                alt={`第 ${index + 1} 张图片`}
                className="h-14 w-14 rounded border border-edge-strong bg-panel object-cover"
              />
              <button
                type="button"
                aria-label={`移除第 ${index + 1} 张图片`}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-edge-strong bg-panel text-2xs leading-none text-ink-soft hover:bg-edge"
                onClick={() => removeAttachment(index)}
              >
                ×
              </button>
            </div>
          ))}
          {/* 已附计数（模板串单文本节点——N/4 逐字可锁） */}
          <span className="text-xs text-ink-mute">{`${attachments.length}/${ATTACHMENT_CAP}`}</span>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        {/* relative 容器承载弹层锚（绝对定位挂输入框上方——聊天输入区惯例） */}
        <div className="relative min-w-0 flex-1">
          {items.length > 0 ? (
            <div
              role="listbox"
              aria-label="文件补全候选"
              className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-full overflow-y-auto rounded-lg border border-edge-strong bg-panel py-1 shadow-lg"
            >
              {items.map((item, index) => (
                <div
                  key={`${index}:${item}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`cursor-pointer truncate px-3 py-1 text-left text-xs ${
                    index === activeIndex ? 'bg-edge-strong text-ink-bright' : 'text-ink-soft'
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
            className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded border border-edge-strong bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-ink-mute"
            placeholder="输入消息——Enter 发送，Shift+Enter 换行"
            rows={2}
            value={text}
            onChange={(ev) => {
              setText(ev.target.value);
              handleCaret(ev.target.value, ev.target.selectionStart);
            }}
            onPaste={handlePaste}
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
        {/* 双键同形（界面美化役批⑧——text-sm/py-1.5 收敛为一致点击面 + focus 环） */}
        <button
          type="button"
          className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-canvas hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-40"
          disabled={text.trim() === '' && attachments.length === 0}
          onClick={send}
        >
          发送
        </button>
        <button
          type="button"
          className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink-soft hover:bg-edge focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canInterrupt}
          onClick={onInterrupt}
        >
          打断
        </button>
      </div>
    </div>
  );
}
