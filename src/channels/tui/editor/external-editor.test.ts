/**
 * 外部编辑器件单测（挖掘 31 轮 [9]）。
 *
 * 锁面：resolveEditorCommand 三态（VISUAL 优先/空值落次选/双缺席/引号成组
 * 分词/不平衡引号宁拒不猜）、normalizeDraft 读回归整（CRLF→LF+末尾空白串
 * 裁剪、行内空白不动）、runExternalEditor 真子进程链（真 mkdtemp 真播种
 * 真 spawn 真读回——pipeline-spill 先例精神：零 mock，改写器 = node -e
 * 脚本带 argv[1] 校验种子后写回；失败三态 missing-editor / 退出码 / ENOENT）。
 */
import { describe, expect, it } from 'vitest';
import { normalizeDraft, resolveEditorCommand, runExternalEditor, type EditorEnv } from './external-editor.js';

describe('resolveEditorCommand（$VISUAL 优先 $EDITOR 次之）', () => {
  it('VISUAL 优先于 EDITOR（双设在取 VISUAL）', () => {
    expect(resolveEditorCommand({ VISUAL: 'vim', EDITOR: 'nano' })).toEqual({
      kind: 'ok',
      words: ['vim'],
    });
  });

  it('空串/全白板视同未设——落次选（shell `${VISUAL:-$EDITOR}` 语义）', () => {
    expect(resolveEditorCommand({ VISUAL: '', EDITOR: 'nano' })).toEqual({
      kind: 'ok',
      words: ['nano'],
    });
    expect(resolveEditorCommand({ VISUAL: '   ', EDITOR: 'nano' })).toEqual({
      kind: 'ok',
      words: ['nano'],
    });
  });

  it('双缺席 → missing（呈报面 missing-editor 态的真源）', () => {
    expect(resolveEditorCommand({})).toEqual({ kind: 'missing' });
    expect(resolveEditorCommand({ VISUAL: '', EDITOR: '' })).toEqual({ kind: 'missing' });
  });

  it('shlex 最小子集分词：空白切 + 单/双引号成组 + 空引号空串词', () => {
    // 带参命令形（`EDITOR="code -w"` 是对标主形）
    expect(resolveEditorCommand({ EDITOR: 'code -w' })).toEqual({
      kind: 'ok',
      words: ['code', '-w'],
    });
    // 双引号成组（路径带空格）
    expect(resolveEditorCommand({ EDITOR: '"my editor" draft.md' })).toEqual({
      kind: 'ok',
      words: ['my editor', 'draft.md'],
    });
    // 单引号成组；引号内对侧引号是普通字符（最小子集不嵌套）
    expect(resolveEditorCommand({ EDITOR: "'a b' \"c'd\"" })).toEqual({
      kind: 'ok',
      words: ['a b', "c'd"],
    });
    // 空引号成空串词（'' → ['']——诚实空参数不丢位）
    expect(resolveEditorCommand({ EDITOR: "'' x" })).toEqual({
      kind: 'ok',
      words: ['', 'x'],
    });
    // 首尾空白不产空词；换行族同作分隔符
    expect(resolveEditorCommand({ EDITOR: '  vim\n-w ' })).toEqual({
      kind: 'ok',
      words: ['vim', '-w'],
    });
  });

  it('不平衡引号 → unparseable（宁拒不猜——错误分词会 spawn 出错命令）', () => {
    expect(resolveEditorCommand({ EDITOR: 'code "my editor' })).toEqual({ kind: 'unparseable' });
    expect(resolveEditorCommand({ EDITOR: "code 'unclosed" })).toEqual({ kind: 'unparseable' });
  });
});

describe('normalizeDraft（读回归整——纯函数）', () => {
  it('CRLF→LF + 末尾空白串裁剪（编辑器尾添换行不引幻影空行）', () => {
    expect(normalizeDraft('第一行\r\n第二行\r\n')).toBe('第一行\n第二行');
    expect(normalizeDraft('a\nb\n\n\n')).toBe('a\nb');
    expect(normalizeDraft('a  \t\n')).toBe('a');
  });

  it('行内与行间空白不动（尊重编辑结果）；空串直通', () => {
    expect(normalizeDraft('a  b\nc')).toBe('a  b\nc');
    expect(normalizeDraft('')).toBe('');
    expect(normalizeDraft('\n\n')).toBe('');
  });
});

describe('runExternalEditor（真子进程链——零 mock）', () => {
  /** 改写器脚本：校验 argv[1] 播种内容后写回归整靶形（CRLF+尾空白）——
   * 换行用 fromCharCode 构造（零反斜杠——EDITOR 值经 JSON.stringify 与
   * shlex 分词两层直穿，转义序列字面化会破坏写出形） */
  const REWRITER =
    "const fs=require('fs');const f=process.argv[1];" +
    "if(fs.readFileSync(f,'utf8')!=='原草稿')process.exit(9);" +
    'const C=String.fromCharCode(13,10),L=String.fromCharCode(10);' +
    "fs.writeFileSync(f,'第一行'+C+'第二行  x'+L+L+L);";

  it('edited：播种校验 → 子进程改写 → 读回归整整替文本', async () => {
    // EDITOR 值形 = `"${execPath}" -e "<脚本>"`——分词/带参命令/spawn 全链真跑
    const editorValue = `"${process.execPath}" -e ${JSON.stringify(REWRITER)}`;
    const outcome = await runExternalEditor('原草稿', { EDITOR: editorValue });
    // 播种被改写器校验（不符 process.exit(9) 走退出码腿）；读回走 normalizeDraft
    expect(outcome).toEqual({ status: 'edited', text: '第一行\n第二行  x' });
  });

  it('missing-editor：双缺席不 spawn', async () => {
    expect(await runExternalEditor('草稿', {})).toEqual({ status: 'missing-editor' });
  });

  it('failed：不平衡引号（unparseable 白话呈报）', async () => {
    const outcome = await runExternalEditor('草稿', { EDITOR: 'code "x' });
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('无法解析');
  });

  it('failed：非零退出码白话呈报（退出码 3）', async () => {
    const env: EditorEnv = { EDITOR: `"${process.execPath}" -e "process.exit(3);"` };
    const outcome = await runExternalEditor('草稿', env);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('退出码 3');
  });

  it('failed：spawn ENOENT（不存在的编辑器二进制）', async () => {
    const outcome = await runExternalEditor('草稿', { EDITOR: '/no/such/binary-xyz' });
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('ENOENT');
  });
});
