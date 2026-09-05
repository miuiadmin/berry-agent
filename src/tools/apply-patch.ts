/**
 * L2 tools — apply_patch 补丁格式（codex 原创；04 §7 fs 族 edit 段拍板采纳
 * 为本仓 edit 工具格式，in-process 应用——码面按协议新写）。
 *
 * 支持的最小子集（M1）：
 *
 *   *** Begin Patch
 *   *** Update File: path/to/file
 *   context 行（定位锚，原样保留进新内容）
 *   -被删除的行
 *   +替换后的新行
 *   *** Add File: new.txt
 *   +整文件内容逐行
 *   *** Delete File: old.txt
 *   *** End Patch
 *
 * 语义声明（照实文档化，非缺陷）：跨文件顺序应用、**非原子**、无回滚——中
 * 途失败停在失败处（已应用文件保留）。fs 工具族在应用前**全部文件先过
 * CAS + fence 校验、全部补丁先解析算内容**，把「半途而废」窗口压到最小
 * （两阶段：校验段全过 → 顺序应用段——04 §7 edit 细则）。
 */

import { BaseError } from '../contracts/index.js';

/** 补丁操作（解析产物）：Update 携带行流，应用时按序匹配定位 */
export type PatchOperation =
  /** 更新已有文件：行流 = 上下文/删除/新增行序列，逐段顺序匹配替换 */
  | { kind: 'update'; path: string; lines: PatchLine[] }
  /** 新建文件：行流应为全 added */
  | { kind: 'add'; path: string; lines: PatchLine[] }
  /** 删除文件 */
  | { kind: 'delete'; path: string };

/** Update/Add 的一行：context（保留定位）| removed（删）| added（增） */
export type PatchLine = { tag: 'context' | 'removed' | 'added'; text: string };

/** 补丁解析/应用失败统一形态（message 细说行号与原因） */
function patchError(message: string): BaseError {
  return new BaseError('FS_PATCH_FAILED', `[FS_PATCH_FAILED] ${message}`);
}

/**
 * 解析 apply_patch 文本 → 操作列表。
 * 行首标记：`*** ` 段指令；`+` 新增；`-` 删除；空格前缀（或裸空行，宽容收）
 * = 上下文行。首尾必须恰是 Begin/End Patch；空补丁（零文件操作段）拒绝。
 */
export function parseApplyPatch(text: string): PatchOperation[] {
  const lines = text.split('\n');
  // split 的尾部换行产物（空串尾巴）先剥——其余空行是合法的空上下文行
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const first = lines[0];
  if (first === undefined || first.trim() !== '*** Begin Patch') {
    throw patchError(`补丁必须以 "*** Begin Patch" 开头（实际首行：${JSON.stringify(first ?? '')}）`);
  }
  const last = lines[lines.length - 1];
  if (last === undefined || last.trim() !== '*** End Patch') {
    throw patchError(`补丁必须以 "*** End Patch" 结尾（实际末行：${JSON.stringify(last ?? '')}）`);
  }

  const ops: PatchOperation[] = [];
  /** 当前段累积器（Update/Add 的行流；Delete 无行流） */
  let current: PatchOperation | undefined;
  /** 至少出现过一个文件操作段（空补丁拒绝） */
  let sawOperation = false;

  /** 收束当前段入列（空行流校验在收束点——段完整性最末判定） */
  const finishCurrent = (): void => {
    if (current === undefined) return;
    if (current.kind === 'add' && current.lines.length === 0) {
      throw patchError(`*** Add File: ${current.path} 无内容行（新增文件至少一行 "+"）`);
    }
    if (current.kind === 'update' && current.lines.length === 0) {
      throw patchError(`*** Update File: ${current.path} 无行（更新至少一行上下文/增删）`);
    }
    ops.push(current);
    current = undefined;
  };

  // 首尾行已校验，循环体只走中间行
  for (let i = 1; i < lines.length - 1; i++) {
    const raw = lines[i]!;
    if (raw.startsWith('*** ')) {
      // 段指令：收束上一段、开新段
      finishCurrent();
      const directive = raw.slice(4).trim();
      if (directive.startsWith('Update File:')) {
        current = { kind: 'update', path: directive.slice('Update File:'.length).trim(), lines: [] };
      } else if (directive.startsWith('Add File:')) {
        current = { kind: 'add', path: directive.slice('Add File:'.length).trim(), lines: [] };
      } else if (directive.startsWith('Delete File:')) {
        current = { kind: 'delete', path: directive.slice('Delete File:'.length).trim() };
      } else if (directive.startsWith('End Patch')) {
        // 末行已保证 End Patch；中途出现 = 多余段指令
        throw patchError(`第 ${i + 1} 行出现多余的 "*** End Patch"`);
      } else {
        throw patchError(
          `第 ${i + 1} 行未知段指令：${JSON.stringify(directive)}（M1 仅支持 Update File / Add File / Delete File）`,
        );
      }
      sawOperation = true;
      continue;
    }
    if (current === undefined) {
      throw patchError(`第 ${i + 1} 行出现在任何 *** 段指令之前：${JSON.stringify(raw)}`);
    }
    if (current.kind === 'delete') {
      throw patchError(`*** Delete File: ${current.path} 之后不允许行内容（第 ${i + 1} 行）`);
    }
    if (raw.startsWith('+')) {
      current.lines.push({ tag: 'added', text: raw.slice(1) });
    } else if (raw.startsWith('-')) {
      if (current.kind === 'add') {
        throw patchError(`*** Add File: ${current.path} 段内不允许 "-" 删除行（第 ${i + 1} 行）`);
      }
      current.lines.push({ tag: 'removed', text: raw.slice(1) });
    } else if (raw.startsWith(' ')) {
      current.lines.push({ tag: 'context', text: raw.slice(1) });
    } else if (raw === '') {
      // 裸空行按空上下文行收（codex 格式规范形是 " "，裸空行更常见——宽容）
      current.lines.push({ tag: 'context', text: '' });
    } else {
      throw patchError(`第 ${i + 1} 行无行首标记（应为 "+" / "-" / " " 之一）：${JSON.stringify(raw)}`);
    }
  }
  finishCurrent();

  if (!sawOperation) {
    throw patchError('补丁不含任何文件操作段（Update File / Add File / Delete File）');
  }
  return ops;
}

/**
 * 对单文件内容应用 Update 行流：在原行序列中滑窗找**首个**完全匹配点，替
 * 换后返回新内容。匹配 = 行流中 context/removed 行与原文连续片段逐行全等
 * （added 行不参与匹配）；无匹配点 = 补丁基于过时内容，FS_PATCH_FAILED 拒。
 */
export function applyUpdateLines(path: string, source: string, patchLines: PatchLine[]): string {
  const original = source.split('\n');
  // 尾换行剥除记号：原文以 \n 收尾时 split 产空尾，应用后按原样补回
  const hadTrailingNewline = source.endsWith('\n');
  if (hadTrailingNewline) original.pop();

  /** 参与匹配的行（context+removed 按序——added 不参与定位） */
  const matchSeq = patchLines.filter((line) => line.tag !== 'added');
  if (matchSeq.length === 0) {
    throw patchError(`${path}：hunk 无 context/- 行，无法定位（至少一行定位锚）`);
  }

  // 滑窗找首个匹配点（贪心首匹配——多个匹配取最先出现处）
  let matchAt = -1;
  outer: for (let start = 0; start + matchSeq.length <= original.length; start++) {
    for (let j = 0; j < matchSeq.length; j++) {
      if (original[start + j] !== matchSeq[j]!.text) continue outer;
    }
    matchAt = start;
    break;
  }
  if (matchAt < 0) {
    throw patchError(
      `${path}：hunk 定位失败——补丁 context/- 行在文件中无连续匹配（期望片段首行：${JSON.stringify(matchSeq[0]!.text)}）。文件在读取后可能已被修改`,
    );
  }

  // 重组：匹配点之前 + 行流展开（context/added 落为新内容，removed 丢弃）+ 匹配窗口之后
  const replacement: string[] = [];
  for (const line of patchLines) {
    if (line.tag === 'removed') continue;
    replacement.push(line.text);
  }
  const merged = [...original.slice(0, matchAt), ...replacement, ...original.slice(matchAt + matchSeq.length)];
  return merged.length === 0 ? '' : `${merged.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
}

/** Add 行流 → 文件内容（全 added；context 行在 Add 语义下也按内容收——宽容） */
export function addLinesToContent(lines: PatchLine[]): string {
  const texts = lines.map((line) => line.text);
  return texts.length === 0 ? '' : `${texts.join('\n')}\n`;
}
