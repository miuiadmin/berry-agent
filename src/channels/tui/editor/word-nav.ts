/**
 * 词级导航纯函数（多行输入件 Editor 件族基件）：findWordBackward /
 * findWordForward——词级删除与词向移动共用的边界判定单源。
 *
 * 机制语义承 pi word-navigation.ts（裁 ⓪ 从零重写）：
 * - Intl.Segmenter **word 粒度**切词（与引擎 width 件的 grapheme 粒度不同
 *   面——此处自持单例）；
 * - isWordLike 三分支：词内含 ASCII 标点时切到标点边界（foo.bar 一步到
 *   '.' 前）、非词非空白的标点 run 整段跳、空白跳过；
 * - 纯函数零状态——调用方（编辑模型）自持光标。
 */
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/** ASCII 标点判（词内边界细化用——POSIX 图形字符中的非字母数字段） */
function isPunctuation(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e);
}

/** 词粒度分段（字素串 + isWordLike 标记） */
function segmentWords(text: string): { segment: string; isWordLike: boolean }[] {
  const out: { segment: string; isWordLike: boolean }[] = [];
  for (const seg of wordSegmenter.segment(text)) {
    out.push({ segment: seg.segment, isWordLike: seg.isWordLike === true });
  }
  return out;
}

/** 空白判（词导航语义的空白 = 空白段整体跳过） */
function isWhitespace(text: string): boolean {
  return text.length > 0 && text.trim().length === 0;
}

/**
 * 光标向后移一词：跳过尾部空白，再跳一词（词内含 ASCII 标点切到最近标点
 * 边界、标点 run 整段跳）。返回新光标（UTF-16 下标）——纯函数不改入参。
 */
export function findWordBackward(text: string, cursor: number): number {
  if (cursor <= 0) return 0;
  const segments = segmentWords(text.slice(0, cursor));
  let newCursor = cursor;
  // 先跳尾部空白段
  while (segments.length > 0 && isWhitespace(segments[segments.length - 1]!.segment)) {
    newCursor -= segments.pop()!.segment.length;
  }
  if (segments.length === 0) return newCursor;
  const last = segments[segments.length - 1]!;
  if (last.isWordLike) {
    // 词内含 ASCII 标点：切到词内最后一段标点之后（foo.bar → '.' 前）
    const segment = last.segment;
    let cut = -1;
    for (let ci = 0; ci < segment.length; ci++) {
      if (isPunctuation(segment[ci]!)) cut = ci + 1;
    }
    if (cut >= 0) newCursor -= segment.length - cut;
    else newCursor -= segment.length;
  } else {
    // 非词非空白 run（标点串）整段跳
    while (
      segments.length > 0 &&
      !segments[segments.length - 1]!.isWordLike &&
      !isWhitespace(segments[segments.length - 1]!.segment)
    ) {
      newCursor -= segments.pop()!.segment.length;
    }
  }
  return newCursor;
}

/**
 * 光标向前移一词：跳过前导空白，再跳一词（词内标点切到首个标点前、
 * 标点 run 整段跳）。返回新光标（UTF-16 下标）——纯函数。
 */
export function findWordForward(text: string, cursor: number): number {
  if (cursor >= text.length) return text.length;
  const segments = segmentWords(text.slice(cursor));
  let newCursor = cursor;
  let i = 0;
  // 先跳前导空白段
  while (i < segments.length && isWhitespace(segments[i]!.segment)) {
    newCursor += segments[i]!.segment.length;
    i++;
  }
  if (i >= segments.length) return newCursor;
  const first = segments[i]!;
  if (first.isWordLike) {
    // 词内含 ASCII 标点：切到词内首个标点前（bar.baz → '.' 前）
    let stop = -1;
    for (let ci = 0; ci < first.segment.length; ci++) {
      if (isPunctuation(first.segment[ci]!)) {
        stop = ci;
        break;
      }
    }
    newCursor += stop >= 0 ? stop : first.segment.length;
  } else {
    // 非词非空白 run（标点串）整段跳
    while (i < segments.length && !segments[i]!.isWordLike && !isWhitespace(segments[i]!.segment)) {
      newCursor += segments[i]!.segment.length;
      i++;
    }
  }
  return newCursor;
}
