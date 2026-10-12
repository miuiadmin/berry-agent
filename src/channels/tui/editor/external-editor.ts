/**
 * 外部编辑器件（挖掘 31 轮 [9]——codex external_editor 对标）。
 *
 * 编舞归 backend（挂起交出形——suspendMain + raw 复先验态 + resumeMain）；
 * 本件只辖命令解析纯逻辑与子进程执行面：
 * - resolveEditorCommand：$VISUAL 优先 $EDITOR 次之（空串/全空白视同未设
 *   ——shell `${VISUAL:-$EDITOR}` 语义）、shlex 最小子集分词（空白切 +
 *   单/双引号成组、无反斜杠转义；不平衡引号 unparseable）——纯函数直测；
 * - runExternalEditor：临时目录中性前缀 .md 播种草稿、stdio 三继承 spawn
 *   （编辑器直接接管终端）、文件路径作末位实参附加、退出读回整文件（
 *   normalizeDraft 规整）、finally 尽力清理。
 * 失败三态（missing-editor / failed / edited）就地呈报归 backend notify。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 编辑器选择环境（$VISUAL 优先 $EDITOR 次之——注入面测试确定性） */
export interface EditorEnv {
  readonly VISUAL?: string;
  readonly EDITOR?: string;
}

/** 命令解析三态（ok = 分词后命令与实参；missing = 双缺席；unparseable = 不平衡引号） */
export type EditorCommand =
  | { readonly kind: 'ok'; readonly words: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unparseable' };

/** 外部编辑器结局三态（backend 就地呈报分诊源） */
export type ExternalEditorOutcome =
  | { readonly status: 'edited'; readonly text: string }
  | { readonly status: 'missing-editor' }
  | { readonly status: 'failed'; readonly message: string };

/**
 * 解析编辑器命令（$VISUAL 优先 $EDITOR 次之；shlex 最小子集分词）。
 *
 * 空串/全白板的值视同未设（落次选；双缺席 → missing）——与 shell
 * `${VISUAL:-$EDITOR}` 展开语义对齐；不平衡引号（如 `code "my editor`）
 * → unparseable（宁拒不猜——错误分词会 spawn 出错命令）。
 */
export function resolveEditorCommand(env: EditorEnv): EditorCommand {
  const pick = (v: string | undefined): string | null => (v !== undefined && v.trim() !== '' ? v : null);
  const raw = pick(env.VISUAL) ?? pick(env.EDITOR);
  if (raw === null) return { kind: 'missing' };
  const words = splitShellWords(raw);
  // 分词空数组理论不可达（raw 已滤全空白），防御归一 unparseable
  return words === null || words.length === 0 ? { kind: 'unparseable' } : { kind: 'ok', words };
}

/**
 * 读回归整（纯函数）：CRLF→LF + 末尾空白串裁剪。
 *
 * 编辑器保存几乎必在文件尾添换行——裁后整替回编辑器才不引幻影空行；
 * 行内与行间空白不动（尊重用户编辑结果）。
 */
export function normalizeDraft(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/**
 * 跑外部编辑器（播种 → 三继承 spawn → 退出读回整替文本）。
 *
 * 子进程接管的终端形态归 backend 编舞（本件不触 raw mode）；文件路径作
 * 末位实参附加（`EDITOR="code -w"` 形 words 与路径拼装）。任何一步失败
 * 归 failed（message 白话可呈报）——草稿不被动过（临时文件独立于编辑器
 * 现货，原草稿只读播种）。
 */
export async function runExternalEditor(seed: string, env: EditorEnv): Promise<ExternalEditorOutcome> {
  const cmd = resolveEditorCommand(env);
  if (cmd.kind === 'missing') return { status: 'missing-editor' };
  if (cmd.kind === 'unparseable') {
    return { status: 'failed', message: '$VISUAL / $EDITOR 的值无法解析为命令（引号不平衡）' };
  }
  // 临时目录中性前缀（命名去品牌化——不携带品牌词）；mkdtemp 随机尾防撞
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), 'draft-'));
  } catch (err) {
    return { status: 'failed', message: `创建临时目录失败：${describeError(err)}` };
  }
  const file = join(dir, 'draft.md');
  try {
    await writeFile(file, seed, 'utf8');
    const code = await runProcess(cmd.words, file);
    if (code !== 0) {
      return { status: 'failed', message: `编辑器异常退出（退出码 ${code}）` };
    }
    const raw = await readFile(file, 'utf8');
    return { status: 'edited', text: normalizeDraft(raw) };
  } catch (err) {
    return { status: 'failed', message: describeError(err) };
  } finally {
    // 尽力清理（清理失败不掩盖主结局——静默吞）
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * shlex 最小子集分词：空白切 + 单/双引号成组（无反斜杠转义、引号内不再
 * 释引）；不平衡引号 → null（宁拒不猜）。空引号成空串词（`''` → ['']）。
 */
function splitShellWords(input: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let hasCur = false; // 开过引号/攒过字符才算成词（首空白不产空词）
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasCur = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (hasCur) {
        words.push(cur);
        cur = '';
        hasCur = false;
      }
      continue;
    }
    cur += ch;
    hasCur = true;
  }
  if (quote !== null) return null;
  if (hasCur) words.push(cur);
  return words;
}

/** spawn 子进程等退出（stdio 三继承——编辑器直接接管终端交互）；spawn 即抛
 * （ENOENT 等启动失败）reject；信号杀（code null）按 -1 失败分诊 */
function runProcess(words: readonly string[], file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(words[0]!, [...words.slice(1), file], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? -1));
  });
}

/** 错误消息单语化（Error 取 message、其余 String——防 [object Object] 形） */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
